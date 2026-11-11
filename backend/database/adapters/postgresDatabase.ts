/**
 * NutriBodySim — Asynchronous PostgreSQL Repository Adapter (MVS-B2.5E.1B.6)
 *
 * Implements IDatabaseRepositories and IUnitOfWork over PostgreSQL using Drizzle ORM.
 *
 * Architectural Guarantees:
 * 1. ACID Transactions: Uses native PostgreSQL transactions (BEGIN / COMMIT / ROLLBACK) via Drizzle tx.
 * 2. Fully Asynchronous: Every repository method returns Promise<T>.
 * 3. Parameterized Queries: All operations use Drizzle type-safe query builders (zero string interpolation).
 * 4. Error Translation: PostgreSQL constraint errors (23505 Unique, 23503 Foreign Key) are translated into domain errors.
 * 5. Isolated Instances: Avoids shared global singletons; connection pool can be closed cleanly via close().
 */

import { eq, and, desc, lt, or, sql } from 'drizzle-orm';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import crypto from 'crypto';
import * as schema from '../schema';
import {
  IDatabaseRepositories,
  IUnitOfWork,
  ITransactionContext,
  IUserRepository,
  IExternalIdentityRepository,
  IRoleRequestRepository,
  IProjectRepository,
  IMembershipRepository,
  IMaterialRepository,
  IDatasetRepository,
  IScientificRegistryRepository,
  IResearchArtifactRepository,
  IAuditLogRepository,
  IAuditLogFilter,
  ISessionRepository,
  IOIDCTransactionRepository
} from '../contracts';
import {
  User,
  Project,
  ProjectMember,
  Team,
  TeamMember,
  Material,
  MaterialCollection,
  ReadingProgress,
  Bookmark,
  Highlight,
  Note,
  Dataset,
  DatasetVersion,
  StatisticsAnalysis,
  ChartRecord,
  NutriNotebook,
  NotebookCell,
  CodeExecutionRecord,
  Experiment,
  AuditLog,
  ProvenanceRecord,
  RoleRequest,
  RequestedRole,
  ApprovalStatus,
  ExternalIdentity,
  AccountStatus
} from '../types';
import {
  ScientificVariable,
  ScientificUnit,
  ScientificFormula,
  ScientificAlgorithm,
  ScientificModel,
  ScientificParameter,
  ScientificReference,
  CalculationTrace,
  InterpretationRule
} from '../../../scientific';
import { SessionData, SessionValidationResult } from '../../auth/sessionStore';
import {
  OIDCTransaction,
  OIDCClientTransactionData,
  CreateTransactionOptions,
  ConsumeTransactionOptions,
  ConsumeTransactionResult
} from '../../auth/oidc/types';
import {
  generateCryptographicToken,
  generateState,
  hashState,
  generateNonce,
  generateCodeVerifier,
  calculateCodeChallenge,
  timingSafeEqual,
  DEFAULT_CODE_VERIFIER_LENGTH
} from '../../auth/oidc/primitives';
import {
  DEFAULT_TRANSACTION_TTL_SECONDS,
  DEFAULT_CLOCK_SKEW_TOLERANCE_SECONDS
} from '../../auth/oidc/config';

// Type alias for Drizzle PostgreSQL Database / Transaction client
export type DrizzlePgExecutor = NodePgDatabase<typeof schema> | any;

// ============================================================================
// 1. PostgreSQL Transaction Context & Unit of Work
// ============================================================================

export class PostgresTransactionContext implements ITransactionContext {
  public readonly transactionId: string;
  public readonly createdAt: number;
  private committed: boolean = false;
  private rolledBack: boolean = false;

  constructor(public readonly executor: DrizzlePgExecutor) {
    this.transactionId = `pg_tx_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    this.createdAt = Date.now();
  }

  public async commit(): Promise<void> {
    if (this.committed) throw new Error(`Transaction ${this.transactionId} already committed.`);
    if (this.rolledBack) throw new Error(`Transaction ${this.transactionId} already rolled back.`);
    if (typeof this.executor?.commit === 'function') {
      await this.executor.commit();
    }
    this.committed = true;
  }

  public async rollback(): Promise<void> {
    if (this.committed) throw new Error(`Transaction ${this.transactionId} already committed.`);
    if (this.rolledBack) throw new Error(`Transaction ${this.transactionId} already rolled back.`);
    this.rolledBack = true;
    if (typeof this.executor?.rollback === 'function') {
      await this.executor.rollback();
    }
  }

  public isCommitted(): boolean {
    return this.committed;
  }

  public isRolledBack(): boolean {
    return this.rolledBack;
  }

  public isActive(): boolean {
    return !this.committed && !this.rolledBack;
  }

  public _markCommitted(): void {
    if (this.rolledBack) {
      throw new Error(`Cannot mark rolled back transaction ${this.transactionId} as committed.`);
    }
    this.committed = true;
  }

  public _markRolledBack(): void {
    this.rolledBack = true;
  }
}

export class PostgresUnitOfWork implements IUnitOfWork {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  public async runInTransaction<T>(work: (tx: ITransactionContext) => Promise<T>): Promise<T> {
    let txCtx: PostgresTransactionContext | undefined;
    try {
      const result = await this.db.transaction(async (drizzleTx) => {
        txCtx = new PostgresTransactionContext(drizzleTx);
        const workResult = await work(txCtx);
        if (txCtx.isRolledBack()) {
          if (typeof drizzleTx.rollback === 'function') {
            await drizzleTx.rollback();
          } else {
            throw new Error(`Transaction ${txCtx.transactionId} was explicitly rolled back by caller.`);
          }
        }
        return workResult;
      });

      // ONLY after this.db.transaction successfully commits without throwing in the DB:
      txCtx?._markCommitted();
      return result;
    } catch (err) {
      txCtx?._markRolledBack();
      throw err;
    }
  }
}

// Base helper for PostgreSQL repositories
abstract class BasePostgresRepository {
  constructor(protected readonly db: NodePgDatabase<typeof schema>) {}

  protected getExecutor(tx?: ITransactionContext): DrizzlePgExecutor {
    if (tx instanceof PostgresTransactionContext) {
      if (!tx.isActive()) {
        throw new Error(
          `Cannot execute repository operation: Transaction ${tx.transactionId} is no longer active (committed: ${tx.isCommitted()}, rolledBack: ${tx.isRolledBack()}).`
        );
      }
      return tx.executor;
    }
    return this.db;
  }
}

// ============================================================================
// 2. User & External Identity Repositories
// ============================================================================

export class PostgresUserRepository extends BasePostgresRepository implements IUserRepository {
  async findById(id: string, tx?: ITransactionContext): Promise<User | null> {
    const rows = await this.getExecutor(tx)
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, id))
      .limit(1);
    return rows[0] ? this.mapUser(rows[0]) : null;
  }

  async findByEmail(email: string, tx?: ITransactionContext): Promise<User | null> {
    const rows = await this.getExecutor(tx)
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, email.toLowerCase()))
      .limit(1);
    return rows[0] ? this.mapUser(rows[0]) : null;
  }

  async listAll(tx?: ITransactionContext): Promise<User[]> {
    const rows = await this.getExecutor(tx).select().from(schema.users);
    return rows.map((r: any) => this.mapUser(r));
  }

  async create(userData: User, tx?: ITransactionContext): Promise<User> {
    const values: any = {
      id: userData.id,
      email: userData.email.toLowerCase(),
      name: userData.name,
      displayName: userData.display_name || userData.name,
      role: userData.role,
      permissions: userData.permissions || [],
      organization: userData.organization || null,
      avatarUrl: userData.avatar_url || null,
      accountStatus: userData.account_status || 'ACTIVE',
      emailVerified: Boolean(userData.email_verified),
      provider: userData.provider || 'local',
      providerSubjectId: userData.provider_subject_id || null,
      isMainAdmin: Boolean(userData.is_main_admin),
      governanceGrantedAt: userData.governance_granted_at ? new Date(userData.governance_granted_at) : null,
      governanceGrantedBy: userData.governance_granted_by || null,
      tokenVersion: userData.token_version ?? 0,
      createdAt: userData.created_at ? new Date(userData.created_at) : new Date(),
      updatedAt: userData.updated_at ? new Date(userData.updated_at) : new Date(),
      lastLoginAt: userData.last_login_at ? new Date(userData.last_login_at) : new Date()
    };

    const inserted = await this.getExecutor(tx).insert(schema.users).values(values).returning();
    return this.mapUser(inserted[0]);
  }

  async update(id: string, updates: Partial<User>, tx?: ITransactionContext): Promise<User> {
    const values: any = { updatedAt: new Date() };
    if (updates.name !== undefined) values.name = updates.name;
    if (updates.display_name !== undefined) values.displayName = updates.display_name;
    if (updates.role !== undefined) values.role = updates.role;
    if (updates.permissions !== undefined) values.permissions = updates.permissions;
    if (updates.organization !== undefined) values.organization = updates.organization;
    if (updates.account_status !== undefined) values.accountStatus = updates.account_status;
    if (updates.token_version !== undefined) values.tokenVersion = updates.token_version;
    if (updates.last_login_at !== undefined) values.lastLoginAt = new Date(updates.last_login_at);
    if (updates.is_main_admin !== undefined) values.isMainAdmin = updates.is_main_admin;
    if (updates.governance_granted_at !== undefined) {
      values.governanceGrantedAt = updates.governance_granted_at
        ? new Date(updates.governance_granted_at)
        : null;
    }
    if (updates.governance_granted_by !== undefined) {
      values.governanceGrantedBy = updates.governance_granted_by;
    }

    const rows = await this.getExecutor(tx)
      .update(schema.users)
      .set(values)
      .where(eq(schema.users.id, id))
      .returning();

    if (!rows[0]) throw new Error(`User not found: ${id}`);
    return this.mapUser(rows[0]);
  }

  async updateAccountStatus(userId: string, status: AccountStatus, tx?: ITransactionContext): Promise<User> {
    return this.update(userId, { account_status: status }, tx);
  }

  async incrementTokenVersion(userId: string, tx?: ITransactionContext): Promise<number> {
    const user = await this.findById(userId, tx);
    if (!user) throw new Error(`User not found: ${userId}`);
    const nextVersion = (user.token_version ?? 0) + 1;
    await this.update(userId, { token_version: nextVersion }, tx);
    return nextVersion;
  }

  async delete(id: string, tx?: ITransactionContext): Promise<boolean> {
    const result = await this.getExecutor(tx)
      .delete(schema.users)
      .where(eq(schema.users.id, id))
      .returning();
    return result.length > 0;
  }

  private mapUser(row: any): User {
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      display_name: row.displayName,
      role: row.role,
      permissions: row.permissions || [],
      organization: row.organization,
      avatar_url: row.avatarUrl,
      account_status: row.accountStatus,
      email_verified: row.emailVerified,
      provider: row.provider,
      provider_subject_id: row.providerSubjectId,
      is_main_admin: row.isMainAdmin,
      governance_granted_at: row.governanceGrantedAt?.toISOString(),
      governance_granted_by: row.governanceGrantedBy,
      token_version: row.tokenVersion,
      created_at: row.createdAt?.toISOString(),
      updated_at: row.updatedAt?.toISOString(),
      last_login_at: row.lastLoginAt?.toISOString()
    };
  }
}

export class PostgresExternalIdentityRepository extends BasePostgresRepository implements IExternalIdentityRepository {
  async findByProviderSubject(provider: string, providerSubjectId: string, tx?: ITransactionContext): Promise<ExternalIdentity | null> {
    const rows = await this.getExecutor(tx)
      .select()
      .from(schema.externalIdentities)
      .where(
        and(
          eq(schema.externalIdentities.provider, provider),
          eq(schema.externalIdentities.providerSubjectId, providerSubjectId)
        )
      )
      .limit(1);

    return rows[0] ? this.mapIdentity(rows[0]) : null;
  }

  async listByUserId(userId: string, tx?: ITransactionContext): Promise<ExternalIdentity[]> {
    const rows = await this.getExecutor(tx)
      .select()
      .from(schema.externalIdentities)
      .where(eq(schema.externalIdentities.userId, userId));
    return rows.map((r: any) => this.mapIdentity(r));
  }

  async linkIdentity(identity: ExternalIdentity, tx?: ITransactionContext): Promise<ExternalIdentity> {
    const values: any = {
      id: (identity as any).id || `ext_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      userId: identity.user_id,
      provider: identity.provider,
      providerSubjectId: identity.provider_subject_id,
      email: identity.email || null,
      emailVerified: Boolean(identity.email_verified),
      linkedAt: identity.linked_at ? new Date(identity.linked_at) : new Date()
    };

    const inserted = await this.getExecutor(tx)
      .insert(schema.externalIdentities)
      .values(values)
      .returning();

    return this.mapIdentity(inserted[0]);
  }

  async unlinkIdentity(provider: string, providerSubjectId: string, tx?: ITransactionContext): Promise<boolean> {
    const res = await this.getExecutor(tx)
      .delete(schema.externalIdentities)
      .where(
        and(
          eq(schema.externalIdentities.provider, provider),
          eq(schema.externalIdentities.providerSubjectId, providerSubjectId)
        )
      )
      .returning();
    return res.length > 0;
  }

  private mapIdentity(row: any): ExternalIdentity {
    return {
      provider: row.provider,
      provider_subject_id: row.providerSubjectId,
      user_id: row.userId,
      email: row.email,
      email_verified: row.emailVerified,
      linked_at: row.linkedAt?.toISOString()
    };
  }
}

// ============================================================================
// 3. Role Requests Repository
// ============================================================================

export class PostgresRoleRequestRepository extends BasePostgresRepository implements IRoleRequestRepository {
  async create(request: RoleRequest, tx?: ITransactionContext): Promise<RoleRequest> {
    const values: any = {
      requestId: request.request_id || (request as any).id || `rr_${Date.now()}`,
      userId: request.user_id,
      requestedRole: request.requested_role,
      approvalStatus: request.approval_status || 'PENDING',
      institution: request.institution || null,
      justification: request.justification || null,
      createdAt: request.created_at ? new Date(request.created_at) : new Date(),
      reviewedBy: request.reviewed_by || null,
      reviewedAt: request.reviewed_at ? new Date(request.reviewed_at) : null,
      reviewReason: request.review_reason || null
    };

    const inserted = await this.getExecutor(tx)
      .insert(schema.roleRequests)
      .values(values)
      .returning();

    return this.mapRoleRequest(inserted[0]);
  }

  async findById(requestId: string, tx?: ITransactionContext): Promise<RoleRequest | null> {
    const rows = await this.getExecutor(tx)
      .select()
      .from(schema.roleRequests)
      .where(eq(schema.roleRequests.requestId, requestId))
      .limit(1);
    return rows[0] ? this.mapRoleRequest(rows[0]) : null;
  }

  async listAll(tx?: ITransactionContext): Promise<RoleRequest[]> {
    const rows = await this.getExecutor(tx).select().from(schema.roleRequests);
    return rows.map((row: any) => this.mapRoleRequest(row));
  }

  async listPending(tx?: ITransactionContext): Promise<RoleRequest[]> {
    const rows = await this.getExecutor(tx)
      .select()
      .from(schema.roleRequests)
      .where(eq(schema.roleRequests.approvalStatus, 'PENDING'));
    return rows.map((r: any) => this.mapRoleRequest(r));
  }

  async listByUserId(userId: string, tx?: ITransactionContext): Promise<RoleRequest[]> {
    const rows = await this.getExecutor(tx)
      .select()
      .from(schema.roleRequests)
      .where(eq(schema.roleRequests.userId, userId));
    return rows.map((r: any) => this.mapRoleRequest(r));
  }

  async findPendingByUserAndRole(userId: string, requestedRole: RequestedRole, tx?: ITransactionContext): Promise<RoleRequest | null> {
    const rows = await this.getExecutor(tx)
      .select()
      .from(schema.roleRequests)
      .where(
        and(
          eq(schema.roleRequests.userId, userId),
          eq(schema.roleRequests.requestedRole, requestedRole),
          eq(schema.roleRequests.approvalStatus, 'PENDING')
        )
      )
      .limit(1);
    return rows[0] ? this.mapRoleRequest(rows[0]) : null;
  }

  async updateStatus(
    requestId: string,
    status: ApprovalStatus,
    reviewerId: string,
    reviewReason?: string | null,
    tx?: ITransactionContext,
    expectedStatus?: ApprovalStatus
  ): Promise<RoleRequest> {
    const conditions = [eq(schema.roleRequests.requestId, requestId)];
    if (expectedStatus) conditions.push(eq(schema.roleRequests.approvalStatus, expectedStatus));
    const rows = await this.getExecutor(tx)
      .update(schema.roleRequests)
      .set({
        approvalStatus: status,
        reviewedBy: reviewerId,
        reviewedAt: new Date(),
        reviewReason: reviewReason || null
      })
      .where(and(...conditions))
      .returning();

    if (!rows[0]) {
      if (expectedStatus) {
        const current = await this.findById(requestId, tx);
        if (current) {
          throw Object.assign(
            new Error(`Role request is already finalized with status '${current.approval_status}'.`),
            { statusCode: 409, code: 'ALREADY_FINALIZED', current_status: current.approval_status }
          );
        }
      }
      throw new Error(`Role request not found: ${requestId}`);
    }
    return this.mapRoleRequest(rows[0]);
  }

  private mapRoleRequest(row: any): RoleRequest {
    return {
      request_id: row.requestId,
      user_id: row.userId,
      requested_role: row.requestedRole,
      approval_status: row.approvalStatus,
      institution: row.institution,
      justification: row.justification,
      created_at: row.createdAt?.toISOString(),
      reviewed_by: row.reviewedBy,
      reviewed_at: row.reviewedAt?.toISOString() ?? null,
      review_reason: row.reviewReason ?? null
    };
  }
}

// ============================================================================
// 4. Project & Collaboration Repositories
// ============================================================================

export class PostgresProjectRepository extends BasePostgresRepository implements IProjectRepository {
  async findById(id: string, tx?: ITransactionContext): Promise<Project | null> {
    const rows = await this.getExecutor(tx)
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, id))
      .limit(1);
    return rows[0] ? this.mapProject(rows[0]) : null;
  }

  async listAll(tx?: ITransactionContext): Promise<Project[]> {
    const rows = await this.getExecutor(tx).select().from(schema.projects);
    return rows.map((row: any) => this.mapProject(row));
  }

  async listPublic(tx?: ITransactionContext): Promise<Project[]> {
    const rows = await this.getExecutor(tx)
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.isPublic, true));
    return rows.map((r: any) => this.mapProject(r));
  }

  async listByOwner(ownerId: string, tx?: ITransactionContext): Promise<Project[]> {
    const rows = await this.getExecutor(tx)
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.ownerId, ownerId));
    return rows.map((r: any) => this.mapProject(r));
  }

  async listForUser(userId: string, tx?: ITransactionContext): Promise<Project[]> {
    const memberRows = await this.getExecutor(tx)
      .select({ projectId: schema.projectMembers.projectId })
      .from(schema.projectMembers)
      .where(eq(schema.projectMembers.userId, userId));

    const memberProjectIds = memberRows.map((r: any) => r.projectId);

    const rows = await this.getExecutor(tx).select().from(schema.projects);
    const set = new Set(memberProjectIds);
    return rows
      .filter((p: any) => p.ownerId === userId || set.has(p.id))
      .map((r: any) => this.mapProject(r));
  }

  async create(project: Project, tx?: ITransactionContext): Promise<Project> {
    const values: any = {
      id: project.id,
      name: project.name || (project as any).title,
      description: project.description || null,
      type: project.type || 'Research',
      ownerId: project.owner_id,
      teamId: project.team_id || null,
      isPublic: Boolean(project.is_public),
      tags: project.tags || [],
      createdAt: project.created_at ? new Date(project.created_at) : new Date(),
      updatedAt: project.updated_at ? new Date(project.updated_at) : new Date()
    };

    const inserted = await this.getExecutor(tx).insert(schema.projects).values(values).returning();
    return this.mapProject(inserted[0]);
  }

  async update(id: string, updates: Partial<Project>, tx?: ITransactionContext): Promise<Project> {
    const values: any = { updatedAt: new Date() };
    if (updates.name !== undefined) values.name = updates.name;
    if (updates.description !== undefined) values.description = updates.description;
    if (updates.type !== undefined) values.type = updates.type;
    if (updates.is_public !== undefined) values.isPublic = updates.is_public;
    if (updates.tags !== undefined) values.tags = updates.tags;

    const rows = await this.getExecutor(tx)
      .update(schema.projects)
      .set(values)
      .where(eq(schema.projects.id, id))
      .returning();

    if (!rows[0]) throw new Error(`Project not found: ${id}`);
    return this.mapProject(rows[0]);
  }

  async delete(id: string, tx?: ITransactionContext): Promise<boolean> {
    const res = await this.getExecutor(tx)
      .delete(schema.projects)
      .where(eq(schema.projects.id, id))
      .returning();
    return res.length > 0;
  }

  private mapProject(row: any): Project {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      type: row.type,
      owner_id: row.ownerId,
      team_id: row.teamId,
      is_public: row.isPublic,
      tags: row.tags || [],
      created_at: row.createdAt?.toISOString(),
      updated_at: row.updatedAt?.toISOString()
    };
  }
}

export class PostgresMembershipRepository extends BasePostgresRepository implements IMembershipRepository {
  async getTeams(tx?: ITransactionContext): Promise<Team[]> {
    const rows = await this.getExecutor(tx).select().from(schema.teams);
    return rows.map((row: any) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      owner_id: row.ownerId,
      created_at: row.createdAt?.toISOString()
    }));
  }

  async createTeam(team: Team, tx?: ITransactionContext): Promise<Team> {
    const rows = await this.getExecutor(tx).insert(schema.teams).values({
      id: team.id,
      name: team.name,
      description: team.description || null,
      ownerId: team.owner_id,
      createdAt: team.created_at ? new Date(team.created_at) : new Date()
    }).returning();
    return {
      id: rows[0].id,
      name: rows[0].name,
      description: rows[0].description,
      owner_id: rows[0].ownerId,
      created_at: rows[0].createdAt?.toISOString()
    };
  }

  async getProjectMembers(projectId: string, tx?: ITransactionContext): Promise<ProjectMember[]> {
    const rows = await this.getExecutor(tx)
      .select()
      .from(schema.projectMembers)
      .where(eq(schema.projectMembers.projectId, projectId));
    return rows.map((r: any) => ({
      id: r.id,
      project_id: r.projectId,
      user_id: r.userId,
      role: r.role,
      joined_at: r.joinedAt?.toISOString()
    }));
  }

  async addProjectMember(member: ProjectMember, tx?: ITransactionContext): Promise<ProjectMember> {
    const values: any = {
      id: member.id || `pm_${Date.now()}`,
      projectId: member.project_id,
      userId: member.user_id,
      role: member.role,
      joinedAt: member.joined_at ? new Date(member.joined_at) : new Date()
    };

    const inserted = await this.getExecutor(tx)
      .insert(schema.projectMembers)
      .values(values)
      .onConflictDoUpdate({
        target: [schema.projectMembers.projectId, schema.projectMembers.userId],
        set: { role: values.role }
      })
      .returning();

    return {
      id: inserted[0].id,
      project_id: inserted[0].projectId,
      user_id: inserted[0].userId,
      role: inserted[0].role,
      joined_at: inserted[0].joinedAt?.toISOString()
    };
  }

  async removeProjectMember(projectId: string, userId: string, tx?: ITransactionContext): Promise<boolean> {
    const res = await this.getExecutor(tx)
      .delete(schema.projectMembers)
      .where(
        and(
          eq(schema.projectMembers.projectId, projectId),
          eq(schema.projectMembers.userId, userId)
        )
      )
      .returning();
    return res.length > 0;
  }

  async getTeam(teamId: string, tx?: ITransactionContext): Promise<Team | null> {
    const rows = await this.getExecutor(tx)
      .select()
      .from(schema.teams)
      .where(eq(schema.teams.id, teamId))
      .limit(1);
    return rows[0]
      ? {
          id: rows[0].id,
          name: rows[0].name,
          description: rows[0].description,
          owner_id: rows[0].ownerId,
          created_at: rows[0].createdAt?.toISOString()
        }
      : null;
  }

  async getTeamMembers(teamId: string, tx?: ITransactionContext): Promise<TeamMember[]> {
    const rows = await this.getExecutor(tx)
      .select()
      .from(schema.teamMembers)
      .where(eq(schema.teamMembers.teamId, teamId));
    return rows.map((r: any) => ({
      id: r.id,
      team_id: r.teamId,
      user_id: r.userId,
      role: r.role,
      joined_at: r.joinedAt?.toISOString()
    }));
  }

  async addTeamMember(member: TeamMember, tx?: ITransactionContext): Promise<TeamMember> {
    const values: any = {
      id: member.id || `tm_${Date.now()}`,
      teamId: member.team_id,
      userId: member.user_id,
      role: member.role,
      joinedAt: member.joined_at ? new Date(member.joined_at) : new Date()
    };
    const res = await this.getExecutor(tx)
      .insert(schema.teamMembers)
      .values(values)
      .onConflictDoUpdate({
        target: [schema.teamMembers.teamId, schema.teamMembers.userId],
        set: { role: values.role }
      })
      .returning();
    return {
      id: res[0].id,
      team_id: res[0].teamId,
      user_id: res[0].userId,
      role: res[0].role,
      joined_at: res[0].joinedAt?.toISOString()
    };
  }

  async removeTeamMember(teamId: string, userId: string, tx?: ITransactionContext): Promise<boolean> {
    const res = await this.getExecutor(tx)
      .delete(schema.teamMembers)
      .where(
        and(
          eq(schema.teamMembers.teamId, teamId),
          eq(schema.teamMembers.userId, userId)
        )
      )
      .returning();
    return res.length > 0;
  }
}

// ============================================================================
// 5. Academic Materials Repository
// ============================================================================

export class PostgresMaterialRepository extends BasePostgresRepository implements IMaterialRepository {
  async findById(id: string, tx?: ITransactionContext): Promise<Material | null> {
    const rows = await this.getExecutor(tx)
      .select()
      .from(schema.materials)
      .where(eq(schema.materials.id, id))
      .limit(1);
    return rows[0] ? this.mapMaterial(rows[0], tx) : null;
  }

  async findByFilePath(filePath: string, tx?: ITransactionContext): Promise<Material | null> {
    const rows = await this.getExecutor(tx)
      .select()
      .from(schema.materials)
      .where(eq(schema.materials.filePath, filePath))
      .limit(1);
    return rows[0] ? this.mapMaterial(rows[0], tx) : null;
  }

  async listAll(tx?: ITransactionContext): Promise<Material[]> {
    const rows = await this.getExecutor(tx).select().from(schema.materials);
    const materials = await Promise.all(rows.map((r: any) => this.mapMaterial(r, tx)));
    return materials;
  }

  async listByProject(projectId: string, tx?: ITransactionContext): Promise<Material[]> {
    const junctions = await this.getExecutor(tx)
      .select({ materialId: schema.materialProjects.materialId })
      .from(schema.materialProjects)
      .where(eq(schema.materialProjects.projectId, projectId));

    const ids = new Set(junctions.map((j: any) => j.materialId));
    const all = await this.listAll(tx);
    return all.filter((m) => ids.has(m.id));
  }

  async create(material: Material, tx?: ITransactionContext): Promise<Material> {
    const values: any = {
      id: material.id,
      title: material.title,
      author: material.author || null,
      subject: material.subject || null,
      type: material.type || 'DOCUMENT',
      description: material.description || null,
      year: material.year || null,
      publisher: material.publisher || null,
      language: material.language || 'en',
      source: material.source || null,
      license: material.license || null,
      tags: material.tags || [],
      version: material.version || '1.0.0',
      uploadedBy: material.uploaded_by,
      filePath: material.file_path,
      fileSizeBytes: material.file_size_bytes,
      mimeType: material.mime_type,
      fileHash: material.file_hash || null,
      createdAt: material.created_at ? new Date(material.created_at) : new Date(),
      updatedAt: material.updated_at ? new Date(material.updated_at) : new Date()
    };

    const inserted = await this.getExecutor(tx).insert(schema.materials).values(values).returning();
    for (const projectId of material.project_ids || []) {
      await this.getExecutor(tx).insert(schema.materialProjects).values({
        materialId: material.id,
        projectId
      }).onConflictDoNothing();
    }
    return this.mapMaterial(inserted[0], tx);
  }

  async update(id: string, updates: Partial<Material>, tx?: ITransactionContext): Promise<Material> {
    const values: any = { updatedAt: new Date() };
    if (updates.title !== undefined) values.title = updates.title;
    if (updates.description !== undefined) values.description = updates.description;

    const rows = await this.getExecutor(tx)
      .update(schema.materials)
      .set(values)
      .where(eq(schema.materials.id, id))
      .returning();

    if (!rows[0]) throw new Error(`Material not found: ${id}`);
    return this.mapMaterial(rows[0], tx);
  }

  async linkToProject(materialId: string, projectId: string, tx?: ITransactionContext): Promise<Material | null> {
    const rows = await this.getExecutor(tx).select().from(schema.materials)
      .where(eq(schema.materials.id, materialId)).limit(1);
    if (!rows[0]) return null;
    await this.getExecutor(tx).insert(schema.materialProjects).values({ materialId, projectId }).onConflictDoNothing();
    await this.getExecutor(tx).update(schema.materials).set({ updatedAt: new Date() })
      .where(eq(schema.materials.id, materialId));
    return this.findById(materialId, tx);
  }

  async delete(id: string, tx?: ITransactionContext): Promise<boolean> {
    const res = await this.getExecutor(tx)
      .delete(schema.materials)
      .where(eq(schema.materials.id, id))
      .returning();
    return res.length > 0;
  }

  async getCollections(tx?: ITransactionContext): Promise<MaterialCollection[]> {
    const rows = await this.getExecutor(tx).select().from(schema.materialCollections);
    return rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      color: r.color,
      material_ids: [],
      created_by: r.createdBy,
      created_at: r.createdAt?.toISOString()
    }));
  }

  async getReadingProgress(userId: string, materialId: string, tx?: ITransactionContext): Promise<ReadingProgress | null> {
    const rows = await this.getExecutor(tx)
      .select()
      .from(schema.readingProgress)
      .where(
        and(
          eq(schema.readingProgress.userId, userId),
          eq(schema.readingProgress.materialId, materialId)
        )
      )
      .limit(1);

    return rows[0]
      ? {
          id: rows[0].id,
          user_id: rows[0].userId,
          material_id: rows[0].materialId,
          last_page: rows[0].lastPage,
          total_pages: rows[0].totalPages,
          progress_pct: rows[0].progressPct,
          scroll_position: rows[0].scrollPosition,
          last_accessed: rows[0].lastAccessed?.toISOString()
        }
      : null;
  }

  async saveReadingProgress(progress: ReadingProgress, tx?: ITransactionContext): Promise<ReadingProgress> {
    const values: any = {
      id: progress.id || `rp_${Date.now()}`,
      userId: progress.user_id,
      materialId: progress.material_id,
      lastPage: progress.last_page,
      totalPages: progress.total_pages,
      progressPct: progress.progress_pct,
      scrollPosition: progress.scroll_position || 0,
      lastAccessed: new Date()
    };

    const inserted = await this.getExecutor(tx)
      .insert(schema.readingProgress)
      .values(values)
      .onConflictDoUpdate({
        target: [schema.readingProgress.userId, schema.readingProgress.materialId],
        set: {
          lastPage: values.lastPage,
          totalPages: values.totalPages,
          progressPct: values.progressPct,
          scrollPosition: values.scrollPosition,
          lastAccessed: values.lastAccessed
        }
      })
      .returning();

    return {
      id: inserted[0].id,
      user_id: inserted[0].userId,
      material_id: inserted[0].materialId,
      last_page: inserted[0].lastPage,
      total_pages: inserted[0].totalPages,
      progress_pct: inserted[0].progressPct,
      scroll_position: inserted[0].scrollPosition,
      last_accessed: inserted[0].lastAccessed?.toISOString()
    };
  }

  async getBookmarks(userId: string, materialId?: string, tx?: ITransactionContext): Promise<Bookmark[]> {
    const conditions = [eq(schema.bookmarks.userId, userId)];
    if (materialId) conditions.push(eq(schema.bookmarks.materialId, materialId));

    const rows = await this.getExecutor(tx)
      .select()
      .from(schema.bookmarks)
      .where(and(...conditions));

    return rows.map((r: any) => ({
      id: r.id,
      user_id: r.userId,
      material_id: r.materialId,
      page: r.page,
      title: r.title,
      created_at: r.createdAt?.toISOString()
    }));
  }

  async getAllBookmarks(materialId?: string, tx?: ITransactionContext): Promise<Bookmark[]> {
    const rows = await this.getExecutor(tx).select().from(schema.bookmarks);
    return rows.filter((row: any) => !materialId || row.materialId === materialId).map((r: any) => ({
      id: r.id,
      user_id: r.userId,
      material_id: r.materialId,
      page: r.page,
      title: r.title,
      created_at: r.createdAt?.toISOString()
    }));
  }

  async saveBookmark(bookmark: Bookmark, tx?: ITransactionContext): Promise<Bookmark> {
    const values: any = {
      id: bookmark.id || `bm_${Date.now()}`,
      userId: bookmark.user_id,
      materialId: bookmark.material_id,
      page: bookmark.page,
      title: bookmark.title,
      createdAt: bookmark.created_at ? new Date(bookmark.created_at) : new Date()
    };
    const res = await this.getExecutor(tx).insert(schema.bookmarks).values(values).returning();
    return {
      id: res[0].id,
      user_id: res[0].userId,
      material_id: res[0].materialId,
      page: res[0].page,
      title: res[0].title,
      created_at: res[0].createdAt?.toISOString()
    };
  }

  async deleteBookmark(id: string, tx?: ITransactionContext): Promise<boolean> {
    const res = await this.getExecutor(tx)
      .delete(schema.bookmarks)
      .where(eq(schema.bookmarks.id, id))
      .returning();
    return res.length > 0;
  }

  async getHighlights(userId: string, materialId?: string, tx?: ITransactionContext): Promise<Highlight[]> {
    const conditions = [eq(schema.highlights.userId, userId)];
    if (materialId) conditions.push(eq(schema.highlights.materialId, materialId));

    const rows = await this.getExecutor(tx)
      .select()
      .from(schema.highlights)
      .where(and(...conditions));

    return rows.map((r: any) => ({
      id: r.id,
      user_id: r.userId,
      material_id: r.materialId,
      page: r.page,
      selected_text: r.selectedText,
      color: r.color,
      created_at: r.createdAt?.toISOString()
    }));
  }

  async getAllHighlights(materialId?: string, tx?: ITransactionContext): Promise<Highlight[]> {
    const rows = await this.getExecutor(tx).select().from(schema.highlights);
    return rows.filter((row: any) => !materialId || row.materialId === materialId).map((r: any) => ({
      id: r.id,
      user_id: r.userId,
      material_id: r.materialId,
      page: r.page,
      selected_text: r.selectedText,
      color: r.color,
      created_at: r.createdAt?.toISOString()
    }));
  }

  async saveHighlight(highlight: Highlight, tx?: ITransactionContext): Promise<Highlight> {
    const values: any = {
      id: highlight.id || `hl_${Date.now()}`,
      userId: highlight.user_id,
      materialId: highlight.material_id,
      page: highlight.page,
      selectedText: highlight.selected_text,
      color: highlight.color,
      createdAt: highlight.created_at ? new Date(highlight.created_at) : new Date()
    };
    const res = await this.getExecutor(tx).insert(schema.highlights).values(values).returning();
    return {
      id: res[0].id,
      user_id: res[0].userId,
      material_id: res[0].materialId,
      page: res[0].page,
      selected_text: res[0].selectedText,
      color: res[0].color,
      created_at: res[0].createdAt?.toISOString()
    };
  }

  async deleteHighlight(id: string, tx?: ITransactionContext): Promise<boolean> {
    const res = await this.getExecutor(tx)
      .delete(schema.highlights)
      .where(eq(schema.highlights.id, id))
      .returning();
    return res.length > 0;
  }

  async getNotes(userId: string, materialId?: string, projectId?: string, tx?: ITransactionContext): Promise<Note[]> {
    const conditions = [eq(schema.notes.userId, userId)];
    if (materialId) conditions.push(eq(schema.notes.materialId, materialId));
    if (projectId) conditions.push(eq(schema.notes.projectId, projectId));

    const rows = await this.getExecutor(tx).select().from(schema.notes).where(and(...conditions));
    return rows.map((r: any) => ({
      id: r.id,
      user_id: r.userId,
      title: r.title,
      content: r.content,
      material_id: r.materialId,
      page: r.page,
      selected_text: r.selectedText,
      project_id: r.projectId,
      created_at: r.createdAt?.toISOString(),
      updated_at: r.updatedAt?.toISOString()
    }));
  }

  async getAllNotes(tx?: ITransactionContext): Promise<Note[]> {
    const rows = await this.getExecutor(tx).select().from(schema.notes);
    return rows.map((r: any) => ({
      id: r.id,
      user_id: r.userId,
      title: r.title,
      content: r.content,
      material_id: r.materialId,
      page: r.page,
      selected_text: r.selectedText,
      project_id: r.projectId,
      created_at: r.createdAt?.toISOString(),
      updated_at: r.updatedAt?.toISOString()
    }));
  }

  async saveNote(note: Note, tx?: ITransactionContext): Promise<Note> {
    const values: any = {
      id: note.id || `note_${Date.now()}`,
      userId: note.user_id,
      title: note.title,
      content: note.content,
      materialId: note.material_id || null,
      page: note.page || null,
      selectedText: note.selected_text || null,
      projectId: note.project_id || null,
      createdAt: note.created_at ? new Date(note.created_at) : new Date(),
      updatedAt: note.updated_at ? new Date(note.updated_at) : new Date()
    };
    const res = await this.getExecutor(tx).insert(schema.notes).values(values)
      .onConflictDoUpdate({
        target: schema.notes.id,
        set: {
          title: values.title,
          content: values.content,
          materialId: values.materialId,
          page: values.page,
          selectedText: values.selectedText,
          projectId: values.projectId,
          updatedAt: values.updatedAt
        }
      }).returning();
    return {
      id: res[0].id,
      user_id: res[0].userId,
      title: res[0].title,
      content: res[0].content,
      material_id: res[0].materialId,
      page: res[0].page,
      selected_text: res[0].selectedText,
      project_id: res[0].projectId,
      created_at: res[0].createdAt?.toISOString(),
      updated_at: res[0].updatedAt?.toISOString()
    };
  }

  async deleteNote(id: string, tx?: ITransactionContext): Promise<boolean> {
    const res = await this.getExecutor(tx).delete(schema.notes).where(eq(schema.notes.id, id)).returning();
    return res.length > 0;
  }

  private async mapMaterial(row: any, tx?: ITransactionContext): Promise<Material> {
    const projectRows = await this.getExecutor(tx)
      .select({ projectId: schema.materialProjects.projectId })
      .from(schema.materialProjects)
      .where(eq(schema.materialProjects.materialId, row.id));
    return {
      id: row.id,
      title: row.title,
      author: row.author,
      subject: row.subject,
      type: row.type,
      description: row.description,
      year: row.year,
      publisher: row.publisher,
      language: row.language,
      source: row.source,
      license: row.license,
      tags: row.tags || [],
      version: row.version,
      uploaded_by: row.uploadedBy,
      file_path: row.filePath,
      file_size_bytes: row.fileSizeBytes,
      mime_type: row.mimeType,
      file_hash: row.fileHash,
      project_ids: projectRows.map((project: any) => project.projectId),
      created_at: row.createdAt?.toISOString(),
      updated_at: row.updatedAt?.toISOString()
    };
  }
}

// ============================================================================
// 6. Datasets & Versioning Repository
// ============================================================================

export class PostgresDatasetRepository extends BasePostgresRepository implements IDatasetRepository {
  async findById(id: string, tx?: ITransactionContext): Promise<Dataset | null> {
    const rows = await this.getExecutor(tx)
      .select()
      .from(schema.datasets)
      .where(eq(schema.datasets.id, id))
      .limit(1);
    return rows[0] ? this.mapDataset(rows[0]) : null;
  }

  async listAll(tx?: ITransactionContext): Promise<Dataset[]> {
    const rows = await this.getExecutor(tx).select().from(schema.datasets);
    return rows.map((row: any) => this.mapDataset(row));
  }

  async listByProject(projectId: string, tx?: ITransactionContext): Promise<Dataset[]> {
    const rows = await this.getExecutor(tx)
      .select()
      .from(schema.datasets)
      .where(eq(schema.datasets.projectId, projectId));
    return rows.map((r: any) => this.mapDataset(r));
  }

  async create(dataset: Dataset, tx?: ITransactionContext): Promise<Dataset> {
    const values: any = {
      id: dataset.id,
      projectId: dataset.project_id,
      name: dataset.name || (dataset as any).title,
      description: dataset.description || null,
      sourceFile: dataset.source_file || 'raw.csv',
      uploadedBy: dataset.uploaded_by,
      currentVersion: dataset.current_version || 'v1.0',
      createdAt: dataset.created_at ? new Date(dataset.created_at) : new Date(),
      updatedAt: dataset.updated_at ? new Date(dataset.updated_at) : new Date()
    };

    const inserted = await this.getExecutor(tx).insert(schema.datasets).values(values).returning();
    return this.mapDataset(inserted[0]);
  }

  async update(id: string, updates: Partial<Dataset>, tx?: ITransactionContext): Promise<Dataset> {
    const values: any = { updatedAt: new Date() };
    if (updates.name !== undefined) values.name = updates.name;
    if (updates.description !== undefined) values.description = updates.description;
    if (updates.current_version !== undefined) values.currentVersion = updates.current_version;

    const rows = await this.getExecutor(tx)
      .update(schema.datasets)
      .set(values)
      .where(eq(schema.datasets.id, id))
      .returning();

    if (!rows[0]) throw new Error(`Dataset not found: ${id}`);
    return this.mapDataset(rows[0]);
  }

  async delete(id: string, tx?: ITransactionContext): Promise<boolean> {
    const res = await this.getExecutor(tx)
      .delete(schema.datasets)
      .where(eq(schema.datasets.id, id))
      .returning();
    return res.length > 0;
  }

  async getVersion(versionId: string, tx?: ITransactionContext): Promise<DatasetVersion | null> {
    const rows = await this.getExecutor(tx)
      .select()
      .from(schema.datasetVersions)
      .where(eq(schema.datasetVersions.id, versionId))
      .limit(1);
    return rows[0] ? this.mapDatasetVersion(rows[0]) : null;
  }

  async listVersions(datasetId: string, tx?: ITransactionContext): Promise<DatasetVersion[]> {
    const rows = await this.getExecutor(tx)
      .select()
      .from(schema.datasetVersions)
      .where(eq(schema.datasetVersions.datasetId, datasetId));
    return rows.map((r: any) => this.mapDatasetVersion(r));
  }

  async createVersion(version: DatasetVersion, tx?: ITransactionContext): Promise<DatasetVersion> {
    const values: any = {
      id: version.id,
      datasetId: version.dataset_id,
      versionTag: version.version_tag,
      parentVersionTag: version.parent_version_tag || null,
      state: version.state,
      columns: version.columns || [],
      data: version.data || [],
      validationReport: version.validation_report,
      transformationApplied: version.transformation_applied || null,
      createdBy: version.created_by,
      createdAt: version.created_at ? new Date(version.created_at) : new Date()
    };

    const inserted = await this.getExecutor(tx)
      .insert(schema.datasetVersions)
      .values(values)
      .returning();

    return this.mapDatasetVersion(inserted[0]);
  }

  private mapDataset(row: any): Dataset {
    return {
      id: row.id,
      project_id: row.projectId,
      name: row.name,
      description: row.description,
      source_file: row.sourceFile,
      uploaded_by: row.uploadedBy,
      current_version: row.currentVersion,
      created_at: row.createdAt?.toISOString(),
      updated_at: row.updatedAt?.toISOString()
    };
  }

  private mapDatasetVersion(row: any): DatasetVersion {
    return {
      id: row.id,
      dataset_id: row.datasetId,
      version_tag: row.versionTag,
      parent_version_tag: row.parentVersionTag,
      state: row.state,
      columns: row.columns || [],
      data: row.data || [],
      validation_report: row.validationReport,
      transformation_applied: row.transformationApplied,
      created_by: row.createdBy,
      created_at: row.createdAt?.toISOString()
    };
  }
}

// ============================================================================
// 7. Scientific Registry Repository
// ============================================================================

export class PostgresScientificRegistryRepository extends BasePostgresRepository implements IScientificRegistryRepository {
  private async mapFormula(row: any, tx?: ITransactionContext): Promise<ScientificFormula> {
    const executor = this.getExecutor(tx);
    const [parameterRows, referenceRows] = await Promise.all([
      executor.select({ parameterId: schema.scientificFormulaParameters.parameterId })
        .from(schema.scientificFormulaParameters)
        .where(eq(schema.scientificFormulaParameters.formulaId, row.formulaId)),
      executor.select({ referenceId: schema.scientificFormulaReferences.referenceId })
        .from(schema.scientificFormulaReferences)
        .where(eq(schema.scientificFormulaReferences.formulaId, row.formulaId))
    ]);
    return {
      formula_id: row.formulaId,
      module_id: row.moduleId,
      module_type: row.moduleType,
      name: row.name,
      description: row.description,
      version: row.version,
      status: row.status,
      inputs: row.inputs || [],
      outputs: row.outputs || [],
      parameter_ids: parameterRows.map((entry: any) => entry.parameterId),
      expression_ast: row.expressionAst,
      expression_string: row.expressionString,
      reference_ids: referenceRows.map((entry: any) => entry.referenceId),
      assumptions: row.assumptions || [],
      limitations: row.limitations || [],
      validation_status: row.validationStatus,
      created_by: row.createdBy,
      created_at: row.createdAt?.toISOString(),
      updated_at: row.updatedAt?.toISOString()
    };
  }

  private async mapModel(row: any, tx?: ITransactionContext): Promise<ScientificModel> {
    const executor = this.getExecutor(tx);
    const [variableRows, formulaRows, algorithmRows, parameterRows, referenceRows] = await Promise.all([
      executor.select({ variableId: schema.scientificModelVariables.variableId })
        .from(schema.scientificModelVariables)
        .where(eq(schema.scientificModelVariables.modelId, row.modelId)),
      executor.select({ formulaId: schema.scientificModelFormulas.formulaId })
        .from(schema.scientificModelFormulas)
        .where(eq(schema.scientificModelFormulas.modelId, row.modelId)),
      executor.select({ algorithmId: schema.scientificModelAlgorithms.algorithmId })
        .from(schema.scientificModelAlgorithms)
        .where(eq(schema.scientificModelAlgorithms.modelId, row.modelId)),
      executor.select({ parameterId: schema.scientificModelParameters.parameterId })
        .from(schema.scientificModelParameters)
        .where(eq(schema.scientificModelParameters.modelId, row.modelId)),
      executor.select({ referenceId: schema.scientificModelReferences.referenceId })
        .from(schema.scientificModelReferences)
        .where(eq(schema.scientificModelReferences.modelId, row.modelId))
    ]);
    return {
      model_id: row.modelId,
      module_id: row.moduleId,
      module_type: row.moduleType,
      name: row.name,
      description: row.description,
      version: row.version,
      status: row.status,
      is_verified: row.isVerified,
      parent_model_id: row.parentModelId,
      variable_ids: variableRows.map((entry: any) => entry.variableId),
      formula_ids: formulaRows.map((entry: any) => entry.formulaId),
      algorithm_ids: algorithmRows.map((entry: any) => entry.algorithmId),
      parameter_ids: parameterRows.map((entry: any) => entry.parameterId),
      reference_ids: referenceRows.map((entry: any) => entry.referenceId),
      assumptions: row.assumptions || [],
      validation_criteria: row.validationCriteria,
      changed_notes: row.changedNotes,
      created_by: row.createdBy,
      created_at: row.createdAt?.toISOString(),
      updated_at: row.updatedAt?.toISOString()
    };
  }

  async getUnits(tx?: ITransactionContext): Promise<ScientificUnit[]> {
    const rows = await this.getExecutor(tx).select().from(schema.scientificUnits);
    return rows.map((r: any) => ({
      unit_id: r.unitId,
      symbol: r.symbol,
      name: r.name,
      measurement_type: r.measurementType,
      base_unit: r.baseUnit,
      to_base_multiplier: r.toBaseMultiplier,
      to_base_offset: r.toBaseOffset,
      description: r.description
    }));
  }

  async getUnitById(id: string, tx?: ITransactionContext): Promise<ScientificUnit | null> {
    const rows = await this.getExecutor(tx)
      .select()
      .from(schema.scientificUnits)
      .where(eq(schema.scientificUnits.unitId, id))
      .limit(1);
    return rows[0]
      ? {
          unit_id: rows[0].unitId,
          symbol: rows[0].symbol,
          name: rows[0].name,
          measurement_type: rows[0].measurementType,
          base_unit: rows[0].baseUnit,
          to_base_multiplier: rows[0].toBaseMultiplier,
          to_base_offset: rows[0].toBaseOffset,
          description: rows[0].description
        }
      : null;
  }

  async getVariables(tx?: ITransactionContext): Promise<ScientificVariable[]> {
    const rows = await this.getExecutor(tx).select().from(schema.scientificVariables);
    return rows.map((r: any) => ({
      variable_id: r.variableId,
      name: r.name,
      label: r.label,
      definition: r.definition,
      datatype: r.datatype,
      unit: r.unit,
      measurement_type: r.measurementType,
      allowed_range: r.allowedRange,
      population: r.population,
      source_reference: r.sourceReference,
      version: r.version,
      status: r.status,
      created_at: r.createdAt?.toISOString(),
      updated_at: r.updatedAt?.toISOString()
    }));
  }

  async createVariable(variable: ScientificVariable, tx?: ITransactionContext): Promise<ScientificVariable> {
    await this.getExecutor(tx).insert(schema.scientificVariables).values({
      variableId: variable.variable_id,
      name: variable.name,
      label: variable.label,
      definition: variable.definition || null,
      datatype: variable.datatype,
      unit: variable.unit,
      measurementType: variable.measurement_type,
      allowedRange: variable.allowed_range,
      population: variable.population || null,
      sourceReference: variable.source_reference || null,
      version: variable.version || '1.0.0',
      status: variable.status || 'EXPERIMENTAL',
      createdAt: variable.created_at ? new Date(variable.created_at) : new Date(),
      updatedAt: variable.updated_at ? new Date(variable.updated_at) : new Date()
    });
    return structuredClone(variable);
  }

  async getVariableById(id: string, tx?: ITransactionContext): Promise<ScientificVariable | null> {
    const rows = await this.getExecutor(tx)
      .select()
      .from(schema.scientificVariables)
      .where(eq(schema.scientificVariables.variableId, id))
      .limit(1);
    return rows[0] ? (rows[0] as any) : null;
  }

  async getParameters(tx?: ITransactionContext): Promise<ScientificParameter[]> {
    const rows = await this.getExecutor(tx).select().from(schema.scientificParameters);
    return rows.map((r: any) => ({
      parameter_id: r.parameterId,
      name: r.name,
      description: r.description,
      value: r.value,
      unit: r.unit,
      valid_range: r.validRange,
      reference_ids: [],
      version: r.version,
      status: r.status,
      is_constant: r.isConstant,
      created_at: r.createdAt?.toISOString(),
      updated_at: r.updatedAt?.toISOString()
    }));
  }

  async createParameter(parameter: ScientificParameter, tx?: ITransactionContext): Promise<ScientificParameter> {
    await this.getExecutor(tx).insert(schema.scientificParameters).values({
      parameterId: parameter.parameter_id,
      name: parameter.name,
      description: parameter.description || null,
      value: parameter.value,
      unit: parameter.unit,
      validRange: parameter.valid_range,
      version: parameter.version || '1.0.0',
      status: parameter.status || 'EXPERIMENTAL',
      isConstant: Boolean(parameter.is_constant),
      createdAt: parameter.created_at ? new Date(parameter.created_at) : new Date(),
      updatedAt: parameter.updated_at ? new Date(parameter.updated_at) : new Date()
    });
    return structuredClone(parameter);
  }

  async getParameterById(id: string, tx?: ITransactionContext): Promise<ScientificParameter | null> {
    const rows = await this.getExecutor(tx)
      .select()
      .from(schema.scientificParameters)
      .where(eq(schema.scientificParameters.parameterId, id))
      .limit(1);
    return rows[0] ? (rows[0] as any) : null;
  }

  async getFormulas(tx?: ITransactionContext): Promise<ScientificFormula[]> {
    const rows = await this.getExecutor(tx).select().from(schema.scientificFormulas);
    return Promise.all(rows.map((row: any) => this.mapFormula(row, tx)));
  }

  async createFormula(formula: ScientificFormula, tx?: ITransactionContext): Promise<ScientificFormula> {
    await this.getExecutor(tx).insert(schema.scientificFormulas).values({
      formulaId: formula.formula_id,
      moduleId: formula.module_id || null,
      moduleType: formula.module_type || 'FORMULA',
      name: formula.name,
      description: formula.description || null,
      version: formula.version || '1.0.0',
      status: formula.status || 'EXPERIMENTAL',
      inputs: formula.inputs || [],
      outputs: formula.outputs || [],
      expressionAst: formula.expression_ast,
      expressionString: formula.expression_string || null,
      assumptions: formula.assumptions || [],
      limitations: formula.limitations || [],
      validationStatus: formula.validation_status || 'UNVERIFIED_EXPERIMENTAL',
      createdBy: formula.created_by || null,
      createdAt: formula.created_at ? new Date(formula.created_at) : new Date(),
      updatedAt: formula.updated_at ? new Date(formula.updated_at) : new Date()
    });
    for (const parameterId of formula.parameter_ids || []) {
      await this.getExecutor(tx).insert(schema.scientificFormulaParameters).values({
        formulaId: formula.formula_id,
        parameterId
      }).onConflictDoNothing();
    }
    for (const referenceId of formula.reference_ids || []) {
      await this.getExecutor(tx).insert(schema.scientificFormulaReferences).values({
        formulaId: formula.formula_id,
        referenceId
      }).onConflictDoNothing();
    }
    return structuredClone(formula);
  }

  async getFormulaById(id: string, tx?: ITransactionContext): Promise<ScientificFormula | null> {
    const rows = await this.getExecutor(tx)
      .select()
      .from(schema.scientificFormulas)
      .where(eq(schema.scientificFormulas.formulaId, id))
      .limit(1);
    return rows[0] ? this.mapFormula(rows[0], tx) : null;
  }

  async getModels(tx?: ITransactionContext): Promise<ScientificModel[]> {
    const rows = await this.getExecutor(tx).select().from(schema.scientificModels);
    return Promise.all(rows.map((row: any) => this.mapModel(row, tx)));
  }

  async createModel(model: ScientificModel, tx?: ITransactionContext): Promise<ScientificModel> {
    await this.getExecutor(tx).insert(schema.scientificModels).values({
      modelId: model.model_id,
      moduleId: model.module_id || null,
      moduleType: model.module_type || 'MODEL',
      name: model.name,
      description: model.description || null,
      version: model.version || '1.0.0',
      status: model.status || 'EXPERIMENTAL',
      isVerified: Boolean(model.is_verified),
      parentModelId: model.parent_model_id || null,
      assumptions: model.assumptions || [],
      validationCriteria: model.validation_criteria || null,
      changedNotes: model.changed_notes || null,
      createdBy: model.created_by || null,
      createdAt: model.created_at ? new Date(model.created_at) : new Date(),
      updatedAt: model.updated_at ? new Date(model.updated_at) : new Date()
    });
    const relations: Array<[any, string, string[]]> = [
      [schema.scientificModelVariables, 'variableId', model.variable_ids || []],
      [schema.scientificModelFormulas, 'formulaId', model.formula_ids || []],
      [schema.scientificModelAlgorithms, 'algorithmId', model.algorithm_ids || []],
      [schema.scientificModelParameters, 'parameterId', model.parameter_ids || []],
      [schema.scientificModelReferences, 'referenceId', model.reference_ids || []]
    ];
    for (const [table, column, ids] of relations) {
      for (const relatedId of ids) {
        await this.getExecutor(tx).insert(table).values({ modelId: model.model_id, [column]: relatedId })
          .onConflictDoNothing();
      }
    }
    return structuredClone(model);
  }

  async getModelById(id: string, tx?: ITransactionContext): Promise<ScientificModel | null> {
    const rows = await this.getExecutor(tx)
      .select()
      .from(schema.scientificModels)
      .where(eq(schema.scientificModels.modelId, id))
      .limit(1);
    return rows[0] ? this.mapModel(rows[0], tx) : null;
  }

  async getReferences(tx?: ITransactionContext): Promise<ScientificReference[]> {
    const rows = await this.getExecutor(tx).select().from(schema.scientificReferences);
    return rows.map((r: any) => ({
      reference_id: r.referenceId,
      title: r.title,
      authors: r.authors,
      year: r.year,
      journal_or_publisher: r.journalOrPublisher,
      doi: r.doi,
      citation_key: r.citationKey,
      abstract: r.abstract
    }));
  }

  async createReference(reference: ScientificReference, tx?: ITransactionContext): Promise<ScientificReference> {
    await this.getExecutor(tx).insert(schema.scientificReferences).values({
      referenceId: reference.reference_id,
      title: reference.title,
      authors: reference.authors || [],
      year: reference.year,
      journalOrPublisher: reference.journal_or_publisher || '',
      doi: reference.doi || null,
      citationKey: reference.citation_key || null,
      abstract: reference.abstract || null,
      createdAt: reference.created_at ? new Date(reference.created_at) : new Date()
    });
    return structuredClone(reference);
  }

  async getReferenceById(id: string, tx?: ITransactionContext): Promise<ScientificReference | null> {
    const rows = await this.getExecutor(tx)
      .select()
      .from(schema.scientificReferences)
      .where(eq(schema.scientificReferences.referenceId, id))
      .limit(1);
    return rows[0] ? (rows[0] as any) : null;
  }

  async getInterpretationRules(tx?: ITransactionContext): Promise<InterpretationRule[]> {
    const rows = await this.getExecutor(tx).select().from(schema.scientificInterpretationRules);
    return rows.map((r: any) => ({
      rule_id: r.ruleId,
      module_id: r.moduleId,
      module_type: r.moduleType,
      name: r.name,
      description: r.description,
      version: r.version,
      status: r.status,
      target_variable_or_metric: r.targetVariableOrMetric,
      unit: r.unit,
      population: r.population,
      thresholds: r.thresholds,
      reference_ids: [],
      created_by: r.createdBy,
      created_at: r.createdAt?.toISOString(),
      updated_at: r.updatedAt?.toISOString()
    }));
  }

  async getInterpretationRuleById(id: string, tx?: ITransactionContext): Promise<InterpretationRule | null> {
    const rows = await this.getExecutor(tx)
      .select()
      .from(schema.scientificInterpretationRules)
      .where(eq(schema.scientificInterpretationRules.ruleId, id))
      .limit(1);
    return rows[0] ? (rows[0] as any) : null;
  }

  async getAlgorithms(tx?: ITransactionContext): Promise<ScientificAlgorithm[]> {
    const rows = await this.getExecutor(tx).select().from(schema.scientificAlgorithms);
    return rows.map((r: any) => ({
      algorithm_id: r.algorithmId,
      module_id: r.moduleId,
      module_type: r.moduleType,
      name: r.name,
      description: r.description,
      version: r.version,
      status: r.status,
      inputs: r.inputs,
      outputs: r.outputs,
      parameter_ids: [],
      steps: r.steps,
      fallback_routes: r.fallbackRoutes,
      reference_ids: [],
      assumptions: r.assumptions,
      limitations: r.limitations,
      validation_status: r.validationStatus,
      created_by: r.createdBy,
      created_at: r.createdAt?.toISOString(),
      updated_at: r.updatedAt?.toISOString()
    }));
  }

  async getAlgorithmById(id: string, tx?: ITransactionContext): Promise<ScientificAlgorithm | null> {
    const rows = await this.getExecutor(tx)
      .select()
      .from(schema.scientificAlgorithms)
      .where(eq(schema.scientificAlgorithms.algorithmId, id))
      .limit(1);
    return rows[0] ? (rows[0] as any) : null;
  }
}

// ============================================================================
// 8. Research Artifacts Repository
// ============================================================================

export class PostgresResearchArtifactRepository extends BasePostgresRepository implements IResearchArtifactRepository {
  async getAllAnalyses(tx?: ITransactionContext): Promise<StatisticsAnalysis[]> {
    const rows = await this.getExecutor(tx).select().from(schema.statisticsAnalyses);
    return rows.map((r: any) => ({
      id: r.id,
      project_id: r.projectId,
      dataset_version_id: r.datasetVersionId,
      title: r.title,
      analysis_type: r.analysisType,
      target_columns: r.targetColumns,
      grouping_column: r.groupingColumn,
      method_justification: r.methodJustification,
      results: r.results,
      provenance_hash: r.provenanceHash,
      created_by: r.createdBy,
      created_at: r.createdAt?.toISOString()
    }));
  }

  async getAllCharts(tx?: ITransactionContext): Promise<ChartRecord[]> {
    const rows = await this.getExecutor(tx).select().from(schema.charts);
    return rows.map((r: any) => ({
      id: r.id,
      project_id: r.projectId,
      dataset_version_id: r.datasetVersionId,
      analysis_id: r.analysisId,
      title: r.title,
      chart_type: r.chartType,
      x_field: r.xField,
      y_field: r.yField,
      group_by: r.groupBy,
      config: r.config,
      created_by: r.createdBy,
      created_at: r.createdAt?.toISOString()
    }));
  }

  async getAllNotebooks(tx?: ITransactionContext): Promise<NutriNotebook[]> {
    const rows = await this.getExecutor(tx).select().from(schema.notebooks);
    return rows.map((r: any) => ({
      id: r.id,
      project_id: r.projectId,
      title: r.title,
      description: r.description,
      created_by: r.createdBy,
      created_at: r.createdAt?.toISOString(),
      updated_at: r.updatedAt?.toISOString()
    }));
  }

  async getAllExperiments(tx?: ITransactionContext): Promise<Experiment[]> {
    const rows = await this.getExecutor(tx).select().from(schema.experiments);
    return rows.map((r: any) => ({
      id: r.id,
      project_id: r.projectId,
      title: r.title,
      description: r.description,
      baseline_model_id: r.baselineModelId,
      experimental_model_id: r.experimentalModelId,
      parameter_modifications: r.parameterModifications,
      baseline_output: r.baselineOutput,
      experimental_output: r.experimentalOutput,
      delta_summary: r.deltaSummary,
      status: r.status,
      provenance_hash: r.provenanceHash,
      created_by: r.createdBy,
      created_at: r.createdAt?.toISOString(),
      updated_at: r.updatedAt?.toISOString()
    }));
  }

  async getAllCodeExecutions(tx?: ITransactionContext): Promise<CodeExecutionRecord[]> {
    const rows = await this.getExecutor(tx).select().from(schema.codeExecutions);
    return rows.map((r: any) => ({
      id: r.id,
      project_id: r.projectId,
      language: r.language,
      code: r.code,
      output: r.output,
      error: r.error,
      execution_time_ms: r.executionTimeMs,
      environment_info: r.environmentInfo,
      executed_by: r.executedBy,
      created_at: r.createdAt?.toISOString()
    }));
  }

  async getAllProvenanceRecords(tx?: ITransactionContext): Promise<ProvenanceRecord[]> {
    const rows = await this.getExecutor(tx).select().from(schema.provenanceRecords);
    return rows.map((r: any) => ({
      id: r.id,
      project_id: r.projectId,
      target_entity_type: r.targetEntityType,
      target_entity_id: r.targetEntityId,
      user_id: r.userId,
      dataset_version_id: r.datasetVersionId,
      model_version: r.modelVersion,
      parameter_version: r.parameterVersion,
      environment_specs: r.environmentSpecs,
      provenance_hash: r.provenanceHash,
      reproducibility_manifest: r.reproducibilityManifest,
      created_at: r.createdAt?.toISOString()
    }));
  }

  async getNotebookCells(notebookId: string, tx?: ITransactionContext): Promise<NotebookCell[]> {
    const rows = await this.getExecutor(tx).select().from(schema.notebookCells)
      .where(eq(schema.notebookCells.notebookId, notebookId));
    return rows.map((r: any) => ({
      id: r.id,
      notebook_id: r.notebookId,
      cell_type: r.cellType,
      order: r.orderIndex,
      title: r.title,
      content: r.content,
      metadata: r.metadata || {}
    }));
  }

  async findNotebookCellById(cellId: string, tx?: ITransactionContext): Promise<NotebookCell | null> {
    const rows = await this.getExecutor(tx).select().from(schema.notebookCells)
      .where(eq(schema.notebookCells.id, cellId)).limit(1);
    if (!rows[0]) return null;
    return {
      id: rows[0].id,
      notebook_id: rows[0].notebookId,
      cell_type: rows[0].cellType,
      order: rows[0].orderIndex,
      title: rows[0].title,
      content: rows[0].content,
      metadata: rows[0].metadata || {}
    };
  }

  async getAnalysesByProject(projectId: string, tx?: ITransactionContext): Promise<StatisticsAnalysis[]> {
    const rows = await this.getExecutor(tx)
      .select()
      .from(schema.statisticsAnalyses)
      .where(eq(schema.statisticsAnalyses.projectId, projectId));
    return rows.map((r: any) => ({
      id: r.id,
      project_id: r.projectId,
      dataset_version_id: r.datasetVersionId,
      title: r.title,
      analysis_type: r.analysisType,
      target_columns: r.targetColumns,
      grouping_column: r.groupingColumn,
      method_justification: r.methodJustification,
      results: r.results,
      provenance_hash: r.provenanceHash,
      created_by: r.createdBy,
      created_at: r.createdAt?.toISOString()
    }));
  }

  async getAnalysisById(id: string, tx?: ITransactionContext): Promise<StatisticsAnalysis | null> {
    const rows = await this.getExecutor(tx)
      .select()
      .from(schema.statisticsAnalyses)
      .where(eq(schema.statisticsAnalyses.id, id))
      .limit(1);
    return rows[0] ? (rows[0] as any) : null;
  }

  async createAnalysis(analysis: StatisticsAnalysis, tx?: ITransactionContext): Promise<StatisticsAnalysis> {
    const values: any = {
      id: analysis.id,
      projectId: analysis.project_id,
      datasetVersionId: analysis.dataset_version_id,
      title: analysis.title,
      analysisType: analysis.analysis_type,
      targetColumns: analysis.target_columns,
      groupingColumn: analysis.grouping_column || null,
      methodJustification: analysis.method_justification,
      results: analysis.results,
      provenanceHash: analysis.provenance_hash,
      createdBy: analysis.created_by,
      createdAt: analysis.created_at ? new Date(analysis.created_at) : new Date()
    };
    await this.getExecutor(tx).insert(schema.statisticsAnalyses).values(values).returning();
    return structuredClone(analysis);
  }

  async getChartsByProject(projectId: string, tx?: ITransactionContext): Promise<ChartRecord[]> {
    const rows = await this.getExecutor(tx)
      .select()
      .from(schema.charts)
      .where(eq(schema.charts.projectId, projectId));
    return rows.map((r: any) => ({
      id: r.id,
      project_id: r.projectId,
      dataset_version_id: r.datasetVersionId,
      analysis_id: r.analysisId,
      title: r.title,
      chart_type: r.chartType,
      x_field: r.xField,
      y_field: r.yField,
      group_by: r.groupBy,
      config: r.config,
      created_by: r.createdBy,
      created_at: r.createdAt?.toISOString()
    }));
  }

  async getChartById(id: string, tx?: ITransactionContext): Promise<ChartRecord | null> {
    const rows = await this.getExecutor(tx).select().from(schema.charts).where(eq(schema.charts.id, id)).limit(1);
    return rows[0] ? (rows[0] as any) : null;
  }

  async createChart(chart: ChartRecord, tx?: ITransactionContext): Promise<ChartRecord> {
    const values: any = {
      id: chart.id,
      projectId: chart.project_id,
      datasetVersionId: chart.dataset_version_id || null,
      analysisId: chart.analysis_id || null,
      title: chart.title,
      chartType: chart.chart_type,
      xField: chart.x_field || null,
      yField: chart.y_field || null,
      groupBy: chart.group_by || null,
      config: chart.config || {},
      createdBy: chart.created_by,
      createdAt: chart.created_at ? new Date(chart.created_at) : new Date()
    };
    const res = await this.getExecutor(tx).insert(schema.charts).values(values).returning();
    return res[0] as any;
  }

  async getNotebooksByProject(projectId: string, tx?: ITransactionContext): Promise<NutriNotebook[]> {
    const rows = await this.getExecutor(tx)
      .select()
      .from(schema.notebooks)
      .where(eq(schema.notebooks.projectId, projectId));
    return rows.map((r: any) => ({
      id: r.id,
      project_id: r.projectId,
      title: r.title,
      description: r.description,
      created_by: r.createdBy,
      created_at: r.createdAt?.toISOString(),
      updated_at: r.updatedAt?.toISOString()
    }));
  }

  async getNotebookWithCells(notebookId: string, tx?: ITransactionContext): Promise<{ notebook: NutriNotebook; cells: NotebookCell[] } | null> {
    const nbRows = await this.getExecutor(tx)
      .select()
      .from(schema.notebooks)
      .where(eq(schema.notebooks.id, notebookId))
      .limit(1);
    if (!nbRows[0]) return null;

    const cellRows = await this.getExecutor(tx)
      .select()
      .from(schema.notebookCells)
      .where(eq(schema.notebookCells.notebookId, notebookId));

    return {
      notebook: {
        id: nbRows[0].id,
        project_id: nbRows[0].projectId,
        title: nbRows[0].title,
        description: nbRows[0].description,
        created_by: nbRows[0].createdBy,
        created_at: nbRows[0].createdAt?.toISOString(),
        updated_at: nbRows[0].updatedAt?.toISOString()
      },
      cells: cellRows.map((c: any) => ({
        id: c.id,
        notebook_id: c.notebookId,
        cell_type: c.cellType,
        order: c.orderIndex,
        title: c.title,
        content: c.content,
        metadata: c.metadata || {}
      }))
    };
  }

  async createNotebook(notebook: NutriNotebook, tx?: ITransactionContext): Promise<NutriNotebook> {
    const values: any = {
      id: notebook.id,
      projectId: notebook.project_id,
      title: notebook.title,
      description: notebook.description || null,
      createdBy: notebook.created_by,
      createdAt: notebook.created_at ? new Date(notebook.created_at) : new Date(),
      updatedAt: notebook.updated_at ? new Date(notebook.updated_at) : new Date()
    };
    const res = await this.getExecutor(tx).insert(schema.notebooks).values(values).returning();
    return res[0] as any;
  }

  async createNotebookCell(cell: NotebookCell, tx?: ITransactionContext): Promise<NotebookCell> {
    const values: any = {
      id: cell.id,
      notebookId: cell.notebook_id,
      cellType: cell.cell_type,
      orderIndex: cell.order,
      title: cell.title || null,
      content: cell.content,
      metadata: cell.metadata || {}
    };
    await this.getExecutor(tx).insert(schema.notebookCells).values(values).returning();
    return structuredClone(cell);
  }

  async updateNotebookCell(cellId: string, updates: Partial<NotebookCell>, tx?: ITransactionContext): Promise<NotebookCell> {
    const values: any = {};
    if (updates.title !== undefined) values.title = updates.title;
    if (updates.content !== undefined) values.content = updates.content;
    if (updates.metadata !== undefined) values.metadata = updates.metadata;
    const res = await this.getExecutor(tx)
      .update(schema.notebookCells)
      .set(values)
      .where(eq(schema.notebookCells.id, cellId))
      .returning();
    return {
      id: res[0].id,
      notebook_id: res[0].notebookId,
      cell_type: res[0].cellType,
      order: res[0].orderIndex,
      title: res[0].title,
      content: res[0].content,
      metadata: res[0].metadata || {}
    };
  }

  async deleteNotebookCell(cellId: string, tx?: ITransactionContext): Promise<boolean> {
    const res = await this.getExecutor(tx)
      .delete(schema.notebookCells)
      .where(eq(schema.notebookCells.id, cellId))
      .returning();
    return res.length > 0;
  }

  async getExperimentsByProject(projectId: string, tx?: ITransactionContext): Promise<Experiment[]> {
    const rows = await this.getExecutor(tx)
      .select()
      .from(schema.experiments)
      .where(eq(schema.experiments.projectId, projectId));
    return rows.map((r: any) => ({
      id: r.id,
      project_id: r.projectId,
      title: r.title,
      description: r.description,
      baseline_model_id: r.baselineModelId,
      experimental_model_id: r.experimentalModelId,
      parameter_modifications: r.parameterModifications,
      baseline_output: r.baselineOutput,
      experimental_output: r.experimentalOutput,
      delta_summary: r.deltaSummary,
      status: r.status,
      provenance_hash: r.provenanceHash,
      created_by: r.createdBy,
      created_at: r.createdAt?.toISOString(),
      updated_at: r.updatedAt?.toISOString()
    }));
  }

  async getExperimentById(id: string, tx?: ITransactionContext): Promise<Experiment | null> {
    const rows = await this.getExecutor(tx).select().from(schema.experiments).where(eq(schema.experiments.id, id)).limit(1);
    if (!rows[0]) return null;
    const r = rows[0] as any;
    return {
      id: r.id,
      project_id: r.projectId,
      title: r.title,
      description: r.description,
      baseline_model_id: r.baselineModelId,
      experimental_model_id: r.experimentalModelId,
      parameter_modifications: r.parameterModifications,
      baseline_output: r.baselineOutput,
      experimental_output: r.experimentalOutput,
      delta_summary: r.deltaSummary,
      status: r.status,
      provenance_hash: r.provenanceHash,
      created_by: r.createdBy,
      created_at: r.createdAt?.toISOString(),
      updated_at: r.updatedAt?.toISOString()
    };
  }

  async createExperiment(experiment: Experiment, tx?: ITransactionContext): Promise<Experiment> {
    const values: any = {
      id: experiment.id,
      projectId: experiment.project_id,
      title: experiment.title,
      description: experiment.description || null,
      baselineModelId: experiment.baseline_model_id,
      experimentalModelId: experiment.experimental_model_id,
      parameterModifications: experiment.parameter_modifications || [],
      baselineOutput: experiment.baseline_output || {},
      experimentalOutput: experiment.experimental_output || {},
      deltaSummary: experiment.delta_summary || null,
      status: experiment.status || 'COMPLETED',
      provenanceHash: experiment.provenance_hash || 'hash',
      createdBy: experiment.created_by,
      createdAt: experiment.created_at ? new Date(experiment.created_at) : new Date(),
      updatedAt: experiment.updated_at ? new Date(experiment.updated_at) : new Date()
    };
    await this.getExecutor(tx).insert(schema.experiments).values(values).returning();
    return structuredClone(experiment);
  }

  async getCodeExecutionsByProject(projectId: string, tx?: ITransactionContext): Promise<CodeExecutionRecord[]> {
    const rows = await this.getExecutor(tx).select().from(schema.codeExecutions).where(eq(schema.codeExecutions.projectId, projectId));
    return rows as any;
  }

  async createCodeExecution(record: CodeExecutionRecord, tx?: ITransactionContext): Promise<CodeExecutionRecord> {
    const values: any = {
      id: record.id,
      projectId: record.project_id,
      language: record.language,
      code: record.code,
      output: record.output,
      error: record.error || null,
      executionTimeMs: record.execution_time_ms,
      environmentInfo: record.environment_info,
      executedBy: record.executed_by,
      createdAt: record.created_at ? new Date(record.created_at) : new Date()
    };
    await this.getExecutor(tx).insert(schema.codeExecutions).values(values).returning();
    return structuredClone(record);
  }

  async getProvenanceRecords(projectId: string, tx?: ITransactionContext): Promise<ProvenanceRecord[]> {
    const rows = await this.getExecutor(tx).select().from(schema.provenanceRecords).where(eq(schema.provenanceRecords.projectId, projectId));
    return rows as any;
  }

  async createProvenanceRecord(record: ProvenanceRecord, tx?: ITransactionContext): Promise<ProvenanceRecord> {
    const values: any = {
      id: record.id,
      projectId: record.project_id,
      targetEntityType: record.target_entity_type,
      targetEntityId: record.target_entity_id,
      userId: record.user_id,
      datasetVersionId: record.dataset_version_id || null,
      modelVersion: record.model_version || null,
      parameterVersion: record.parameter_version || null,
      environmentSpecs: record.environment_specs || null,
      provenanceHash: record.provenance_hash,
      reproducibilityManifest: record.reproducibility_manifest,
      createdAt: record.created_at ? new Date(record.created_at) : new Date()
    };
    const res = await this.getExecutor(tx).insert(schema.provenanceRecords).values(values).returning();
    return res[0] as any;
  }

  async getCalculations(projectId?: string, tx?: ITransactionContext): Promise<CalculationTrace[]> {
    const executor = this.getExecutor(tx);
    const rows = projectId
      ? await executor.select().from(schema.scientificCalculations).where(eq(schema.scientificCalculations.projectId, projectId))
      : await executor.select().from(schema.scientificCalculations);
    return rows.map((r: any) => ({
      calculation_id: r.calculationId,
      user_id: r.userId,
      project_id: r.projectId,
      formula_or_model_id: r.formulaOrModelId,
      version: r.version,
      inputs_received: r.inputsReceived,
      normalized_inputs: r.normalizedInputs,
      parameters_resolved: r.parametersResolved,
      steps: r.steps,
      final_result: r.finalResult,
      explanation: r.explanation,
      provenance_hash: r.provenanceHash,
      created_at: r.createdAt?.toISOString()
    }));
  }

  async getCalculationById(id: string, tx?: ITransactionContext): Promise<CalculationTrace | null> {
    const rows = await this.getExecutor(tx).select().from(schema.scientificCalculations).where(eq(schema.scientificCalculations.calculationId, id)).limit(1);
    if (!rows[0]) return null;
    const r = rows[0] as any;
    return {
      calculation_id: r.calculationId,
      user_id: r.userId,
      project_id: r.projectId,
      formula_or_model_id: r.formulaOrModelId,
      version: r.version,
      inputs_received: r.inputsReceived,
      normalized_inputs: r.normalizedInputs,
      parameters_resolved: r.parametersResolved,
      steps: r.steps,
      final_result: r.finalResult,
      explanation: r.explanation,
      provenance_hash: r.provenanceHash,
      created_at: r.createdAt?.toISOString()
    };
  }

  async createCalculation(calculation: CalculationTrace, tx?: ITransactionContext): Promise<CalculationTrace> {
    const values: any = {
      calculationId: calculation.calculation_id,
      userId: calculation.user_id || null,
      projectId: calculation.project_id || null,
      formulaOrModelId: calculation.formula_or_model_id,
      version: calculation.version || '1.0.0',
      inputsReceived: calculation.inputs_received,
      normalizedInputs: calculation.normalized_inputs,
      parametersResolved: calculation.parameters_resolved,
      steps: calculation.steps,
      finalResult: calculation.final_result,
      explanation: calculation.explanation || null,
      provenanceHash: calculation.provenance_hash,
      createdAt: calculation.created_at ? new Date(calculation.created_at) : new Date()
    };
    await this.getExecutor(tx).insert(schema.scientificCalculations).values(values).returning();
    return structuredClone(calculation);
  }
}

// ============================================================================
// 9. Immutable Audit Trail Repository
// ============================================================================

export class PostgresAuditLogRepository extends BasePostgresRepository implements IAuditLogRepository {
  async appendLog(
    logData: Omit<AuditLog, 'id' | 'timestamp'> & { id?: string; timestamp?: string },
    tx?: ITransactionContext
  ): Promise<AuditLog> {
    const values: any = {
      id: logData.id || `audit_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      userId: logData.user_id || null,
      userName: (logData as any).user_name || null,
      action: logData.action,
      entityType: logData.entity_type,
      entityId: logData.entity_id,
      details: logData.details,
      ipAddress: (logData as any).ip_address || null,
      timestamp: logData.timestamp ? new Date(logData.timestamp) : new Date()
    };

    const inserted = await this.getExecutor(tx).insert(schema.auditLogs).values(values).returning();
    return {
      id: inserted[0].id,
      user_id: inserted[0].userId || 'SYSTEM',
      user_name: inserted[0].userName || undefined,
      action: inserted[0].action as any,
      entity_type: inserted[0].entityType,
      entity_id: inserted[0].entityId,
      details: inserted[0].details,
      ip_address: inserted[0].ipAddress || undefined,
      timestamp: inserted[0].timestamp?.toISOString()
    };
  }

  async queryLogs(filter?: IAuditLogFilter, tx?: ITransactionContext): Promise<AuditLog[]> {
    const conditions: any[] = [];
    if (filter?.userId) conditions.push(eq(schema.auditLogs.userId, filter.userId));
    if (filter?.entityType) conditions.push(eq(schema.auditLogs.entityType, filter.entityType));
    if (filter?.entityId) conditions.push(eq(schema.auditLogs.entityId, filter.entityId));
    if (filter?.action) conditions.push(eq(schema.auditLogs.action, filter.action));

    let query = this.getExecutor(tx)
      .select()
      .from(schema.auditLogs)
      .orderBy(desc(schema.auditLogs.timestamp));

    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as any;
    }
    if (filter?.limit) {
      query = query.limit(filter.limit) as any;
    }
    if (filter?.offset) {
      query = query.offset(filter.offset) as any;
    }

    const rows = await query;
    return rows.map((r: any) => ({
      id: r.id,
      user_id: r.userId || 'SYSTEM',
      user_name: r.userName || undefined,
      action: r.action as any,
      entity_type: r.entityType,
      entity_id: r.entityId,
      details: r.details,
      ip_address: r.ipAddress || undefined,
      timestamp: r.timestamp?.toISOString()
    }));
  }

  async countLogs(filter?: IAuditLogFilter, tx?: ITransactionContext): Promise<number> {
    const logs = await this.queryLogs(filter, tx);
    return logs.length;
  }
}

export class PostgresSessionRepository extends BasePostgresRepository implements ISessionRepository {
  async createSession(
    userId: string,
    ttlSeconds = 86400,
    tokenVersion = 1,
    tx?: ITransactionContext
  ): Promise<{ token: string; expiresAt: number; session: Omit<SessionData, 'tokenHash'> }> {
    if (!userId || typeof userId !== 'string') {
      throw new Error('Valid userId is required to create a session');
    }

    const now = Date.now();
    const expiresAt = now + ttlSeconds * 1000;
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    await this.getExecutor(tx).insert(schema.runtimeSessions).values({
      tokenHash,
      userId,
      tokenVersion,
      createdAt: new Date(now),
      expiresAt: new Date(expiresAt),
      revoked: false
    });

    return {
      token,
      expiresAt,
      session: {
        userId,
        createdAt: now,
        expiresAt,
        revoked: false,
        tokenVersion
      }
    };
  }

  async validateSession(token: string): Promise<SessionValidationResult> {
    if (!token || typeof token !== 'string') {
      return { valid: false, error: 'Token is missing or not a string' };
    }

    const normalized = token.trim();
    if (!/^[a-f0-9]{64}$/i.test(normalized)) {
      return { valid: false, error: 'Malformed session token format' };
    }

    const tokenHash = crypto.createHash('sha256').update(normalized).digest('hex');
    const rows = await this.db
      .select()
      .from(schema.runtimeSessions)
      .where(eq(schema.runtimeSessions.tokenHash, tokenHash))
      .limit(1);
    const session = rows[0];

    if (!session) return { valid: false, error: 'Session not found' };
    if (session.revoked) return { valid: false, error: 'Session has been revoked' };
    if (Date.now() > session.expiresAt.getTime()) {
      return { valid: false, error: 'Session has expired' };
    }

    return {
      valid: true,
      userId: session.userId,
      expiresAt: session.expiresAt.getTime(),
      tokenVersion: session.tokenVersion
    };
  }

  async revokeSession(token: string, tx?: ITransactionContext): Promise<boolean> {
    if (!token || typeof token !== 'string') return false;
    const normalized = token.trim();
    if (!/^[a-f0-9]{64}$/i.test(normalized)) return false;
    const tokenHash = crypto.createHash('sha256').update(normalized).digest('hex');
    const rows = await this.getExecutor(tx)
      .update(schema.runtimeSessions)
      .set({ revoked: true })
      .where(and(eq(schema.runtimeSessions.tokenHash, tokenHash), eq(schema.runtimeSessions.revoked, false)))
      .returning({ tokenHash: schema.runtimeSessions.tokenHash });
    return rows.length > 0;
  }

  async revokeSessionsForUser(userId: string, tx?: ITransactionContext): Promise<number> {
    const rows = await this.getExecutor(tx)
      .update(schema.runtimeSessions)
      .set({ revoked: true })
      .where(and(eq(schema.runtimeSessions.userId, userId), eq(schema.runtimeSessions.revoked, false)))
      .returning({ tokenHash: schema.runtimeSessions.tokenHash });
    return rows.length;
  }

  async cleanExpiredSessions(now = Date.now(), tx?: ITransactionContext): Promise<number> {
    const rows = await this.getExecutor(tx)
      .delete(schema.runtimeSessions)
      .where(or(eq(schema.runtimeSessions.revoked, true), lt(schema.runtimeSessions.expiresAt, new Date(now))))
      .returning({ tokenHash: schema.runtimeSessions.tokenHash });
    return rows.length;
  }

  async getActiveSessionsCount(): Promise<number> {
    const result = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.runtimeSessions)
      .where(and(
        eq(schema.runtimeSessions.revoked, false),
        sql`${schema.runtimeSessions.expiresAt} >= now()`
      ));
    return result[0]?.count ?? 0;
  }
}

export class PostgresOIDCTransactionRepository extends BasePostgresRepository implements IOIDCTransactionRepository {
  private readonly clockSkewToleranceMs = DEFAULT_CLOCK_SKEW_TOLERANCE_SECONDS * 1000;

  private mapTransaction(row: typeof schema.oidcTransactions.$inferSelect): OIDCTransaction {
    return {
      id: row.id,
      state: row.state,
      stateHash: row.stateHash,
      nonce: row.nonce,
      codeVerifier: row.codeVerifier,
      codeChallenge: row.codeChallenge,
      codeChallengeMethod: 'S256',
      createdAt: row.createdAt.getTime(),
      expiresAt: row.expiresAt.getTime(),
      consumed: row.consumed,
      consumedAt: row.consumedAt?.getTime(),
      clientBinding: row.clientBinding ?? undefined,
      returnUrl: row.returnUrl ?? undefined,
      redirectUri: row.redirectUri ?? undefined,
      purpose: row.purpose as OIDCTransaction['purpose'],
      targetUserId: row.targetUserId ?? undefined
    };
  }

  async createTransaction(
    options?: CreateTransactionOptions,
    tx?: ITransactionContext
  ): Promise<{ transaction: OIDCTransaction; clientData: OIDCClientTransactionData }> {
    const now = options?.currentTime ?? Date.now();
    const ttlSeconds = options?.ttlSeconds && options.ttlSeconds > 0
      ? options.ttlSeconds
      : DEFAULT_TRANSACTION_TTL_SECONDS;
    const id = generateCryptographicToken(32);
    const state = generateState(32);
    const stateHash = hashState(state);
    const nonce = generateNonce(32);
    const codeVerifier = generateCodeVerifier(options?.verifierLength ?? DEFAULT_CODE_VERIFIER_LENGTH);
    const codeChallenge = calculateCodeChallenge(codeVerifier, 'S256');
    const expiresAt = now + ttlSeconds * 1000;

    const rows = await this.getExecutor(tx)
      .insert(schema.oidcTransactions)
      .values({
        id,
        stateHash,
        state,
        nonce,
        codeVerifier,
        codeChallenge,
        codeChallengeMethod: 'S256',
        purpose: options?.purpose ?? 'login',
        targetUserId: options?.targetUserId,
        createdAt: new Date(now),
        expiresAt: new Date(expiresAt),
        consumed: false,
        clientBinding: options?.clientBinding,
        returnUrl: options?.returnUrl,
        redirectUri: options?.redirectUri
      })
      .returning();

    const transaction = this.mapTransaction(rows[0]);
    return {
      transaction,
      clientData: {
        transactionId: id,
        state,
        codeChallenge,
        codeChallengeMethod: 'S256',
        expiresAt
      }
    };
  }

  async getTransaction(id: string, tx?: ITransactionContext): Promise<OIDCTransaction | null> {
    const rows = await this.getExecutor(tx)
      .select()
      .from(schema.oidcTransactions)
      .where(eq(schema.oidcTransactions.id, id))
      .limit(1);
    return rows[0] ? this.mapTransaction(rows[0]) : null;
  }

  async getTransactionByState(state: string, tx?: ITransactionContext): Promise<OIDCTransaction | null> {
    if (!state || typeof state !== 'string') return null;
    const rows = await this.getExecutor(tx)
      .select()
      .from(schema.oidcTransactions)
      .where(eq(schema.oidcTransactions.stateHash, hashState(state)))
      .limit(1);
    if (!rows[0]) return null;
    const transaction = this.mapTransaction(rows[0]);
    return timingSafeEqual(transaction.state, state) ? transaction : null;
  }

  async consumeTransaction(
    options: ConsumeTransactionOptions,
    tx?: ITransactionContext
  ): Promise<ConsumeTransactionResult> {
    if (!options || typeof options !== 'object') {
      return { success: false, error: 'Invalid consumption options provided', code: 'INVALID_ARGUMENT' };
    }
    if (!options.state || typeof options.state !== 'string') {
      return { success: false, error: 'State parameter is missing or invalid', code: 'INVALID_STATE' };
    }

    const transaction = options.transactionId
      ? await this.getTransaction(options.transactionId, tx)
      : await this.getTransactionByState(options.state, tx);
    if (!transaction) {
      return { success: false, error: 'Transaction not found or invalid state', code: 'TRANSACTION_NOT_FOUND' };
    }
    if (transaction.consumed) {
      return {
        success: false,
        error: 'Transaction has already been consumed. Replay attempt rejected.',
        code: 'TRANSACTION_ALREADY_CONSUMED'
      };
    }

    const now = options.currentTime ?? Date.now();
    if (now > transaction.expiresAt + this.clockSkewToleranceMs) {
      return { success: false, error: 'Transaction has expired', code: 'TRANSACTION_EXPIRED' };
    }
    if (!timingSafeEqual(transaction.state, options.state)) {
      return { success: false, error: 'State mismatch', code: 'INVALID_STATE' };
    }
    if (options.nonce !== undefined && !timingSafeEqual(transaction.nonce, options.nonce)) {
      return {
        success: false,
        error: 'Nonce mismatch between callback and transaction',
        code: 'NONCE_MISMATCH'
      };
    }
    if (transaction.clientBinding !== undefined &&
      (!options.clientBinding || !timingSafeEqual(transaction.clientBinding, options.clientBinding))) {
      return { success: false, error: 'Client browser binding mismatch', code: 'CLIENT_BINDING_MISMATCH' };
    }

    const consumedRows = await this.getExecutor(tx)
      .update(schema.oidcTransactions)
      .set({ consumed: true, consumedAt: new Date(now) })
      .where(and(
        eq(schema.oidcTransactions.id, transaction.id),
        eq(schema.oidcTransactions.consumed, false),
        sql`${schema.oidcTransactions.expiresAt} >= ${new Date(now - this.clockSkewToleranceMs)}`
      ))
      .returning();
    if (!consumedRows[0]) {
      const current = await this.getTransaction(transaction.id, tx);
      if (!current) {
        return { success: false, error: 'Transaction not found or invalid state', code: 'TRANSACTION_NOT_FOUND' };
      }
      if (!current.consumed && now > current.expiresAt + this.clockSkewToleranceMs) {
        return { success: false, error: 'Transaction has expired', code: 'TRANSACTION_EXPIRED' };
      }
      return {
        success: false,
        error: 'Transaction has already been consumed. Replay attempt rejected.',
        code: 'TRANSACTION_ALREADY_CONSUMED'
      };
    }

    return { success: true, transaction: this.mapTransaction(consumedRows[0]) };
  }

  async deleteTransaction(id: string, tx?: ITransactionContext): Promise<boolean> {
    const rows = await this.getExecutor(tx)
      .delete(schema.oidcTransactions)
      .where(eq(schema.oidcTransactions.id, id))
      .returning({ id: schema.oidcTransactions.id });
    return rows.length > 0;
  }

  async cleanExpiredTransactions(now = Date.now(), tx?: ITransactionContext): Promise<number> {
    const rows = await this.getExecutor(tx)
      .delete(schema.oidcTransactions)
      .where(lt(schema.oidcTransactions.expiresAt, new Date(now - this.clockSkewToleranceMs)))
      .returning({ id: schema.oidcTransactions.id });
    return rows.length;
  }
}

// ============================================================================
// 10. PostgreSQL Composition Root / Database Repositories
// ============================================================================

export class PostgresDatabaseRepositories implements IDatabaseRepositories {
  public readonly users: IUserRepository;
  public readonly externalIdentities: IExternalIdentityRepository;
  public readonly roleRequests: IRoleRequestRepository;
  public readonly projects: IProjectRepository;
  public readonly memberships: IMembershipRepository;
  public readonly materials: IMaterialRepository;
  public readonly datasets: IDatasetRepository;
  public readonly scientificRegistry: IScientificRegistryRepository;
  public readonly researchArtifacts: IResearchArtifactRepository;
  public readonly auditLogs: IAuditLogRepository;
  public readonly sessions: ISessionRepository;
  public readonly oidcTransactions: IOIDCTransactionRepository;
  public readonly unitOfWork: IUnitOfWork;

  constructor(
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly pool?: pg.Pool
  ) {
    this.users = new PostgresUserRepository(this.db);
    this.externalIdentities = new PostgresExternalIdentityRepository(this.db);
    this.roleRequests = new PostgresRoleRequestRepository(this.db);
    this.projects = new PostgresProjectRepository(this.db);
    this.memberships = new PostgresMembershipRepository(this.db);
    this.materials = new PostgresMaterialRepository(this.db);
    this.datasets = new PostgresDatasetRepository(this.db);
    this.scientificRegistry = new PostgresScientificRegistryRepository(this.db);
    this.researchArtifacts = new PostgresResearchArtifactRepository(this.db);
    this.auditLogs = new PostgresAuditLogRepository(this.db);
    this.sessions = new PostgresSessionRepository(this.db);
    this.oidcTransactions = new PostgresOIDCTransactionRepository(this.db);
    this.unitOfWork = new PostgresUnitOfWork(this.db);
  }

  /**
   * Safely closes the underlying PostgreSQL connection pool.
   */
  public async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
    }
  }

  public getDb(): NodePgDatabase<typeof schema> {
    return this.db;
  }
}

/**
 * Factory for creating PostgresDatabaseRepositories from connection config or pool.
 */
export function createPostgresRepositories(
  poolOrConfig: pg.Pool | pg.PoolConfig
): PostgresDatabaseRepositories {
  const pool = poolOrConfig instanceof pg.Pool ? poolOrConfig : new pg.Pool(poolOrConfig);
  const db = drizzle(pool, { schema });
  return new PostgresDatabaseRepositories(db, pool);
}
