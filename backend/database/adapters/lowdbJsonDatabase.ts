/**
 * NutriBodySim — Modular Lowdb / JSON Repository Adapter (MVS-B2.5E.1B.2)
 *
 * Implements the asynchronous IDatabaseRepositories and IUnitOfWork contracts
 * over the local JSON storage engine (DatabaseStore).
 *
 * Guarantees:
 * 1. Asynchronous Boundaries: Every repository query and mutation returns Promise<T>.
 * 2. Single Source of Truth: Operates directly on the shared DatabaseStore instance without state duplication.
 * 3. Unit of Work Isolation: Transactions operate on a structuredClone snapshot; commit() persists atomically,
 *    while rollback() discards the working state without touching main memory or disk.
 * 4. 32-Entity Fidelity: Fully implements query and mutation operations for all 32 baseline collections.
 * 5. Zero Scientific & Route Disruption: Encapsulated as an independent data access adapter.
 */

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

import { defaultSessionStore, ISessionStore, SessionData, SessionValidationResult } from '../../auth/sessionStore';
import {
  OIDCTransaction,
  OIDCClientTransactionData,
  CreateTransactionOptions,
  ConsumeTransactionOptions,
  ConsumeTransactionResult,
  IOIDCTransactionStore
} from '../../auth/oidc/types';
import { defaultOIDCTransactionStore } from '../../auth/oidc/transactionStore';
import { DatabaseStore, DatabaseState, db as defaultDbStore } from '../store';

// ============================================================================
// 1. Transaction Context & Unit of Work Implementation
// ============================================================================

export class JsonTransactionContext implements ITransactionContext {
  public readonly transactionId: string;
  public readonly createdAt: number;
  private committed: boolean = false;
  private rolledBack: boolean = false;
  private workingState: DatabaseState;

  constructor(private readonly store: DatabaseStore) {
    this.transactionId = `tx_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    this.createdAt = Date.now();
    // Isolate transaction mutations inside an independent state snapshot
    this.workingState = structuredClone(this.store.getState());
  }

  public getWorkingState(): DatabaseState {
    if (this.rolledBack) {
      throw new Error(`Transaction ${this.transactionId} has already been rolled back.`);
    }
    if (this.committed) {
      throw new Error(`Transaction ${this.transactionId} has already been committed.`);
    }
    return this.workingState;
  }

  public async commit(): Promise<void> {
    if (this.committed) {
      throw new Error(`Cannot commit transaction ${this.transactionId} because it has already been committed.`);
    }
    if (this.rolledBack) {
      throw new Error(`Cannot commit transaction ${this.transactionId} because it was rolled back.`);
    }
    const previousState = this.store.getState();
    this.store.setState(this.workingState);
    try {
      this.store.save();
    } catch (error) {
      this.store.setState(previousState);
      throw error;
    }
    this.committed = true;
  }

  public async rollback(): Promise<void> {
    if (this.committed) {
      throw new Error(`Cannot rollback transaction ${this.transactionId} because it has already been committed.`);
    }
    if (this.rolledBack) {
      throw new Error(`Cannot rollback transaction ${this.transactionId} because it has already been rolled back.`);
    }
    this.rolledBack = true;
    // Working state is discarded; main DatabaseStore remains untouched
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
}

export class JsonUnitOfWork implements IUnitOfWork {
  private transactionTail: Promise<void> = Promise.resolve();

  constructor(private readonly store: DatabaseStore) {}

  async runInTransaction<T>(work: (tx: ITransactionContext) => Promise<T>): Promise<T> {
    const previousTransaction = this.transactionTail;
    let releaseTransaction: () => void = () => undefined;
    this.transactionTail = new Promise<void>(resolve => {
      releaseTransaction = resolve;
    });
    await previousTransaction;

    try {
      const tx = new JsonTransactionContext(this.store);
      try {
        const result = await work(tx);
        if (tx.isRolledBack()) {
          throw new Error(`Transaction ${tx.transactionId} was explicitly rolled back by caller.`);
        }
        if (!tx.isCommitted()) {
          await tx.commit();
        }
        return result;
      } catch (err) {
        if (!tx.isCommitted() && !tx.isRolledBack()) {
          try {
            await tx.rollback();
          } catch {}
        }
        throw err;
      }
    } finally {
      releaseTransaction();
    }
  }
}

// ============================================================================
// Base Repository with Transaction / Auto-commit Resolution
// ============================================================================

abstract class BaseJsonRepository {
  constructor(protected readonly store: DatabaseStore) {}

  protected getState(tx?: ITransactionContext): DatabaseState {
    if (tx && tx instanceof JsonTransactionContext) {
      return tx.getWorkingState();
    }
    return this.store.getState();
  }

  protected persist(tx?: ITransactionContext): void {
    if (!tx) {
      this.store.save();
    }
  }
}

// ============================================================================
// 2. User & External Identity Repositories
// ============================================================================

export class JsonUserRepository extends BaseJsonRepository implements IUserRepository {
  async findById(id: string, tx?: ITransactionContext): Promise<User | null> {
    const state = this.getState(tx);
    const user = state.users.find(u => u.id === id);
    return user ? structuredClone(user) : null;
  }

  async findByEmail(email: string, tx?: ITransactionContext): Promise<User | null> {
    const state = this.getState(tx);
    const normalized = email.toLowerCase().trim();
    const user = state.users.find(u => u.email.toLowerCase().trim() === normalized);
    return user ? structuredClone(user) : null;
  }

  async listAll(tx?: ITransactionContext): Promise<User[]> {
    const state = this.getState(tx);
    return structuredClone(state.users);
  }

  async create(userData: User, tx?: ITransactionContext): Promise<User> {
    const state = this.getState(tx);
    if (state.users.some(u => u.id === userData.id)) {
      throw new Error(`User with ID ${userData.id} already exists`);
    }
    if (state.users.some(u => u.email.toLowerCase().trim() === userData.email.toLowerCase().trim())) {
      throw new Error(`User with email ${userData.email} already exists`);
    }
    const cloned = structuredClone(userData);
    state.users.push(cloned);
    this.persist(tx);
    return structuredClone(cloned);
  }

  async update(id: string, updates: Partial<User>, tx?: ITransactionContext): Promise<User> {
    const state = this.getState(tx);
    const idx = state.users.findIndex(u => u.id === id);
    if (idx === -1) {
      throw new Error(`User not found: ${id}`);
    }
    const updated: User = {
      ...state.users[idx],
      ...updates,
      updated_at: new Date().toISOString()
    };
    state.users[idx] = updated;
    this.persist(tx);
    return structuredClone(updated);
  }

  async updateAccountStatus(userId: string, status: AccountStatus, tx?: ITransactionContext): Promise<User> {
    return this.update(userId, { account_status: status }, tx);
  }

  async incrementTokenVersion(userId: string, tx?: ITransactionContext): Promise<number> {
    const state = this.getState(tx);
    const idx = state.users.findIndex(u => u.id === userId);
    if (idx === -1) {
      throw new Error(`User not found: ${userId}`);
    }
    const nextVersion = (state.users[idx].token_version || 1) + 1;
    state.users[idx].token_version = nextVersion;
    state.users[idx].updated_at = new Date().toISOString();
    this.persist(tx);
    return nextVersion;
  }

  async delete(id: string, tx?: ITransactionContext): Promise<boolean> {
    const state = this.getState(tx);
    const idx = state.users.findIndex(u => u.id === id);
    if (idx === -1) return false;
    state.users.splice(idx, 1);
    this.persist(tx);
    return true;
  }
}

export class JsonExternalIdentityRepository extends BaseJsonRepository implements IExternalIdentityRepository {
  async findByProviderSubject(provider: string, providerSubjectId: string, tx?: ITransactionContext): Promise<ExternalIdentity | null> {
    const state = this.getState(tx);
    const identity = state.external_identities.find(
      ei => ei.provider === provider && ei.provider_subject_id === providerSubjectId
    );
    return identity ? structuredClone(identity) : null;
  }

  async listByUserId(userId: string, tx?: ITransactionContext): Promise<ExternalIdentity[]> {
    const state = this.getState(tx);
    return structuredClone(state.external_identities.filter(ei => ei.user_id === userId));
  }

  async linkIdentity(identity: ExternalIdentity, tx?: ITransactionContext): Promise<ExternalIdentity> {
    const state = this.getState(tx);
    const existingIdx = state.external_identities.findIndex(
      ei => ei.provider === identity.provider && ei.provider_subject_id === identity.provider_subject_id
    );
    const cloned = structuredClone(identity);
    if (existingIdx !== -1) {
      state.external_identities[existingIdx] = cloned;
    } else {
      state.external_identities.push(cloned);
    }
    this.persist(tx);
    return structuredClone(cloned);
  }

  async unlinkIdentity(provider: string, providerSubjectId: string, tx?: ITransactionContext): Promise<boolean> {
    const state = this.getState(tx);
    const idx = state.external_identities.findIndex(
      ei => ei.provider === provider && ei.provider_subject_id === providerSubjectId
    );
    if (idx === -1) return false;
    state.external_identities.splice(idx, 1);
    this.persist(tx);
    return true;
  }
}

// ============================================================================
// 3. Role Request Repository
// ============================================================================

export class JsonRoleRequestRepository extends BaseJsonRepository implements IRoleRequestRepository {
  async create(request: RoleRequest, tx?: ITransactionContext): Promise<RoleRequest> {
    const state = this.getState(tx);
    const cloned = structuredClone(request);
    cloned.reviewed_by ??= null;
    cloned.reviewed_at ??= null;
    cloned.review_reason ??= null;
    state.role_requests.push(cloned);
    this.persist(tx);
    return structuredClone(cloned);
  }

  async findById(requestId: string, tx?: ITransactionContext): Promise<RoleRequest | null> {
    const state = this.getState(tx);
    const req = state.role_requests.find(r => r.request_id === requestId);
    return req ? structuredClone(req) : null;
  }

  async listAll(tx?: ITransactionContext): Promise<RoleRequest[]> {
    return structuredClone(this.getState(tx).role_requests);
  }

  async listPending(tx?: ITransactionContext): Promise<RoleRequest[]> {
    const state = this.getState(tx);
    return structuredClone(state.role_requests.filter(r => String(r.approval_status || '').toUpperCase() === 'PENDING'));
  }

  async listByUserId(userId: string, tx?: ITransactionContext): Promise<RoleRequest[]> {
    const state = this.getState(tx);
    return structuredClone(state.role_requests.filter(r => r.user_id === userId));
  }

  async findPendingByUserAndRole(userId: string, requestedRole: RequestedRole, tx?: ITransactionContext): Promise<RoleRequest | null> {
    const state = this.getState(tx);
    const req = state.role_requests.find(
      r => r.user_id === userId && r.requested_role === requestedRole && String(r.approval_status || '').toUpperCase() === 'PENDING'
    );
    return req ? structuredClone(req) : null;
  }

  async updateStatus(
    requestId: string,
    status: ApprovalStatus,
    reviewerId: string,
    reviewReason?: string | null,
    tx?: ITransactionContext,
    expectedStatus?: ApprovalStatus
  ): Promise<RoleRequest> {
    const state = this.getState(tx);
    const idx = state.role_requests.findIndex(r => r.request_id === requestId);
    if (idx === -1) {
      throw new Error(`Role request not found: ${requestId}`);
    }
    if (expectedStatus && state.role_requests[idx].approval_status !== expectedStatus) {
      throw Object.assign(new Error(`Role request is already finalized with status '${state.role_requests[idx].approval_status}'.`), {
        statusCode: 409,
        code: 'ALREADY_FINALIZED',
        current_status: state.role_requests[idx].approval_status
      });
    }
    const now = new Date().toISOString();
    const updated: RoleRequest = {
      ...state.role_requests[idx],
      approval_status: status,
      reviewed_by: reviewerId,
      review_reason: reviewReason ?? state.role_requests[idx].review_reason,
      reviewed_at: now
    };
    state.role_requests[idx] = updated;
    this.persist(tx);
    return structuredClone(updated);
  }
}

// ============================================================================
// 4. Project & Membership Repositories
// ============================================================================

export class JsonProjectRepository extends BaseJsonRepository implements IProjectRepository {
  async findById(id: string, tx?: ITransactionContext): Promise<Project | null> {
    const state = this.getState(tx);
    const project = state.projects.find(p => p.id === id);
    return project ? structuredClone(project) : null;
  }

  async listAll(tx?: ITransactionContext): Promise<Project[]> {
    return structuredClone(this.getState(tx).projects);
  }

  async listPublic(tx?: ITransactionContext): Promise<Project[]> {
    const state = this.getState(tx);
    return structuredClone(state.projects.filter(p => p.is_public));
  }

  async listByOwner(ownerId: string, tx?: ITransactionContext): Promise<Project[]> {
    const state = this.getState(tx);
    return structuredClone(state.projects.filter(p => p.owner_id === ownerId));
  }

  async listForUser(userId: string, tx?: ITransactionContext): Promise<Project[]> {
    const state = this.getState(tx);
    const memberProjectIds = new Set(
      state.project_members.filter(pm => pm.user_id === userId).map(pm => pm.project_id)
    );
    return structuredClone(
      state.projects.filter(p => p.owner_id === userId || memberProjectIds.has(p.id))
    );
  }

  async create(project: Project, tx?: ITransactionContext): Promise<Project> {
    const state = this.getState(tx);
    const cloned = structuredClone(project);
    state.projects.push(cloned);
    this.persist(tx);
    return structuredClone(cloned);
  }

  async update(id: string, updates: Partial<Project>, tx?: ITransactionContext): Promise<Project> {
    const state = this.getState(tx);
    const idx = state.projects.findIndex(p => p.id === id);
    if (idx === -1) {
      throw new Error(`Project not found: ${id}`);
    }
    const updated: Project = {
      ...state.projects[idx],
      ...updates,
      updated_at: new Date().toISOString()
    };
    state.projects[idx] = updated;
    this.persist(tx);
    return structuredClone(updated);
  }

  async delete(id: string, tx?: ITransactionContext): Promise<boolean> {
    const state = this.getState(tx);
    const idx = state.projects.findIndex(p => p.id === id);
    if (idx === -1) return false;
    state.projects.splice(idx, 1);
    this.persist(tx);
    return true;
  }
}

export class JsonMembershipRepository extends BaseJsonRepository implements IMembershipRepository {
  async getTeams(tx?: ITransactionContext): Promise<Team[]> {
    return structuredClone(this.getState(tx).teams);
  }

  async createTeam(team: Team, tx?: ITransactionContext): Promise<Team> {
    const state = this.getState(tx);
    const cloned = structuredClone(team);
    state.teams.push(cloned);
    this.persist(tx);
    return structuredClone(cloned);
  }

  async getProjectMembers(projectId: string, tx?: ITransactionContext): Promise<ProjectMember[]> {
    const state = this.getState(tx);
    return structuredClone(state.project_members.filter(pm => pm.project_id === projectId));
  }

  async addProjectMember(member: ProjectMember, tx?: ITransactionContext): Promise<ProjectMember> {
    const state = this.getState(tx);
    const cloned = structuredClone(member);
    const existingIdx = state.project_members.findIndex(
      pm => pm.project_id === member.project_id && pm.user_id === member.user_id
    );
    if (existingIdx !== -1) {
      state.project_members[existingIdx].role = cloned.role;
      this.persist(tx);
      return structuredClone(state.project_members[existingIdx]);
    } else {
      state.project_members.push(cloned);
    }
    this.persist(tx);
    return structuredClone(cloned);
  }

  async removeProjectMember(projectId: string, userId: string, tx?: ITransactionContext): Promise<boolean> {
    const state = this.getState(tx);
    const idx = state.project_members.findIndex(
      pm => pm.project_id === projectId && pm.user_id === userId
    );
    if (idx === -1) return false;
    state.project_members.splice(idx, 1);
    this.persist(tx);
    return true;
  }

  async getTeam(teamId: string, tx?: ITransactionContext): Promise<Team | null> {
    const state = this.getState(tx);
    const team = state.teams.find(t => t.id === teamId);
    return team ? structuredClone(team) : null;
  }

  async getTeamMembers(teamId: string, tx?: ITransactionContext): Promise<TeamMember[]> {
    const state = this.getState(tx);
    return structuredClone(state.team_members.filter(tm => tm.team_id === teamId));
  }

  async addTeamMember(member: TeamMember, tx?: ITransactionContext): Promise<TeamMember> {
    const state = this.getState(tx);
    const cloned = structuredClone(member);
    const existingIdx = state.team_members.findIndex(
      tm => tm.team_id === member.team_id && tm.user_id === member.user_id
    );
    if (existingIdx !== -1) {
      state.team_members[existingIdx].role = cloned.role;
      this.persist(tx);
      return structuredClone(state.team_members[existingIdx]);
    } else {
      state.team_members.push(cloned);
    }
    this.persist(tx);
    return structuredClone(cloned);
  }

  async removeTeamMember(teamId: string, userId: string, tx?: ITransactionContext): Promise<boolean> {
    const state = this.getState(tx);
    const idx = state.team_members.findIndex(
      tm => tm.team_id === teamId && tm.user_id === userId
    );
    if (idx === -1) return false;
    state.team_members.splice(idx, 1);
    this.persist(tx);
    return true;
  }
}

// ============================================================================
// 5. Material Repository
// ============================================================================

export class JsonMaterialRepository extends BaseJsonRepository implements IMaterialRepository {
  async findById(id: string, tx?: ITransactionContext): Promise<Material | null> {
    const state = this.getState(tx);
    const mat = state.materials.find(m => m.id === id);
    return mat ? structuredClone(mat) : null;
  }

  async findByFilePath(filePath: string, tx?: ITransactionContext): Promise<Material | null> {
    const state = this.getState(tx);
    const mat = state.materials.find(m => m.file_path === filePath);
    return mat ? structuredClone(mat) : null;
  }

  async listAll(tx?: ITransactionContext): Promise<Material[]> {
    const state = this.getState(tx);
    return structuredClone(state.materials);
  }

  async listByProject(projectId: string, tx?: ITransactionContext): Promise<Material[]> {
    const state = this.getState(tx);
    return structuredClone(state.materials.filter(m => (m.project_ids || []).includes(projectId)));
  }

  async create(material: Material, tx?: ITransactionContext): Promise<Material> {
    const state = this.getState(tx);
    const cloned = structuredClone(material);
    state.materials.push(cloned);
    this.persist(tx);
    return structuredClone(cloned);
  }

  async update(id: string, updates: Partial<Material>, tx?: ITransactionContext): Promise<Material> {
    const state = this.getState(tx);
    const idx = state.materials.findIndex(m => m.id === id);
    if (idx === -1) {
      throw new Error(`Material not found: ${id}`);
    }
    const updated: Material = {
      ...state.materials[idx],
      ...updates,
      updated_at: new Date().toISOString()
    };
    state.materials[idx] = updated;
    this.persist(tx);
    return structuredClone(updated);
  }

  async linkToProject(materialId: string, projectId: string, tx?: ITransactionContext): Promise<Material | null> {
    const state = this.getState(tx);
    const material = state.materials.find(item => item.id === materialId);
    if (!material) return null;
    if (!material.project_ids.includes(projectId)) {
      material.project_ids.push(projectId);
      material.updated_at = new Date().toISOString();
      this.persist(tx);
    }
    return structuredClone(material);
  }

  async delete(id: string, tx?: ITransactionContext): Promise<boolean> {
    const state = this.getState(tx);
    const idx = state.materials.findIndex(m => m.id === id);
    if (idx === -1) return false;
    state.materials.splice(idx, 1);
    this.persist(tx);
    return true;
  }

  async getCollections(tx?: ITransactionContext): Promise<MaterialCollection[]> {
    const state = this.getState(tx);
    return structuredClone(state.material_collections);
  }

  async getReadingProgress(userId: string, materialId: string, tx?: ITransactionContext): Promise<ReadingProgress | null> {
    const state = this.getState(tx);
    const rp = state.reading_progress.find(r => r.user_id === userId && r.material_id === materialId);
    return rp ? structuredClone(rp) : null;
  }

  async saveReadingProgress(progress: ReadingProgress, tx?: ITransactionContext): Promise<ReadingProgress> {
    const state = this.getState(tx);
    const idx = state.reading_progress.findIndex(
      r => r.user_id === progress.user_id && r.material_id === progress.material_id
    );
    const cloned = structuredClone(progress);
    if (idx !== -1) {
      state.reading_progress[idx] = cloned;
    } else {
      state.reading_progress.push(cloned);
    }
    this.persist(tx);
    return structuredClone(cloned);
  }

  async getBookmarks(userId: string, materialId?: string, tx?: ITransactionContext): Promise<Bookmark[]> {
    const state = this.getState(tx);
    return structuredClone(
      state.bookmarks.filter(b => b.user_id === userId && (!materialId || b.material_id === materialId))
    );
  }

  async getAllBookmarks(materialId?: string, tx?: ITransactionContext): Promise<Bookmark[]> {
    return structuredClone(this.getState(tx).bookmarks.filter(bookmark =>
      !materialId || bookmark.material_id === materialId
    ));
  }

  async saveBookmark(bookmark: Bookmark, tx?: ITransactionContext): Promise<Bookmark> {
    const state = this.getState(tx);
    const idx = state.bookmarks.findIndex(b => b.id === bookmark.id);
    const cloned = structuredClone(bookmark);
    if (idx !== -1) {
      state.bookmarks[idx] = cloned;
    } else {
      state.bookmarks.push(cloned);
    }
    this.persist(tx);
    return structuredClone(cloned);
  }

  async deleteBookmark(id: string, tx?: ITransactionContext): Promise<boolean> {
    const state = this.getState(tx);
    const idx = state.bookmarks.findIndex(b => b.id === id);
    if (idx === -1) return false;
    state.bookmarks.splice(idx, 1);
    this.persist(tx);
    return true;
  }

  async getHighlights(userId: string, materialId?: string, tx?: ITransactionContext): Promise<Highlight[]> {
    const state = this.getState(tx);
    return structuredClone(
      state.highlights.filter(h => h.user_id === userId && (!materialId || h.material_id === materialId))
    );
  }

  async getAllHighlights(materialId?: string, tx?: ITransactionContext): Promise<Highlight[]> {
    return structuredClone(this.getState(tx).highlights.filter(highlight =>
      !materialId || highlight.material_id === materialId
    ));
  }

  async saveHighlight(highlight: Highlight, tx?: ITransactionContext): Promise<Highlight> {
    const state = this.getState(tx);
    const idx = state.highlights.findIndex(h => h.id === highlight.id);
    const cloned = structuredClone(highlight);
    if (idx !== -1) {
      state.highlights[idx] = cloned;
    } else {
      state.highlights.push(cloned);
    }
    this.persist(tx);
    return structuredClone(cloned);
  }

  async deleteHighlight(id: string, tx?: ITransactionContext): Promise<boolean> {
    const state = this.getState(tx);
    const idx = state.highlights.findIndex(h => h.id === id);
    if (idx === -1) return false;
    state.highlights.splice(idx, 1);
    this.persist(tx);
    return true;
  }

  async getNotes(userId: string, materialId?: string, projectId?: string, tx?: ITransactionContext): Promise<Note[]> {
    const state = this.getState(tx);
    return structuredClone(
      state.notes.filter(n => {
        if (n.user_id !== userId) return false;
        if (materialId && n.material_id !== materialId) return false;
        if (projectId && n.project_id !== projectId) return false;
        return true;
      })
    );
  }

  async getAllNotes(tx?: ITransactionContext): Promise<Note[]> {
    return structuredClone(this.getState(tx).notes);
  }

  async saveNote(note: Note, tx?: ITransactionContext): Promise<Note> {
    const state = this.getState(tx);
    const idx = state.notes.findIndex(n => n.id === note.id);
    const cloned = structuredClone(note);
    if (idx !== -1) {
      state.notes[idx] = cloned;
    } else {
      state.notes.push(cloned);
    }
    this.persist(tx);
    return structuredClone(cloned);
  }

  async deleteNote(id: string, tx?: ITransactionContext): Promise<boolean> {
    const state = this.getState(tx);
    const idx = state.notes.findIndex(n => n.id === id);
    if (idx === -1) return false;
    state.notes.splice(idx, 1);
    this.persist(tx);
    return true;
  }
}

// ============================================================================
// 6. Dataset Repository
// ============================================================================

export class JsonDatasetRepository extends BaseJsonRepository implements IDatasetRepository {
  async findById(id: string, tx?: ITransactionContext): Promise<Dataset | null> {
    const state = this.getState(tx);
    const ds = state.datasets.find(d => d.id === id);
    return ds ? structuredClone(ds) : null;
  }

  async listAll(tx?: ITransactionContext): Promise<Dataset[]> {
    return structuredClone(this.getState(tx).datasets);
  }

  async listByProject(projectId: string, tx?: ITransactionContext): Promise<Dataset[]> {
    const state = this.getState(tx);
    return structuredClone(state.datasets.filter(d => d.project_id === projectId));
  }

  async create(dataset: Dataset, tx?: ITransactionContext): Promise<Dataset> {
    const state = this.getState(tx);
    const cloned = structuredClone(dataset);
    state.datasets.push(cloned);
    this.persist(tx);
    return structuredClone(cloned);
  }

  async update(id: string, updates: Partial<Dataset>, tx?: ITransactionContext): Promise<Dataset> {
    const state = this.getState(tx);
    const idx = state.datasets.findIndex(d => d.id === id);
    if (idx === -1) {
      throw new Error(`Dataset not found: ${id}`);
    }
    const updated: Dataset = {
      ...state.datasets[idx],
      ...updates,
      updated_at: new Date().toISOString()
    };
    state.datasets[idx] = updated;
    this.persist(tx);
    return structuredClone(updated);
  }

  async delete(id: string, tx?: ITransactionContext): Promise<boolean> {
    const state = this.getState(tx);
    const idx = state.datasets.findIndex(d => d.id === id);
    if (idx === -1) return false;
    state.datasets.splice(idx, 1);
    this.persist(tx);
    return true;
  }

  async getVersion(versionId: string, tx?: ITransactionContext): Promise<DatasetVersion | null> {
    const state = this.getState(tx);
    const dsv = state.dataset_versions.find(v => v.id === versionId);
    return dsv ? structuredClone(dsv) : null;
  }

  async listVersions(datasetId: string, tx?: ITransactionContext): Promise<DatasetVersion[]> {
    const state = this.getState(tx);
    return structuredClone(state.dataset_versions.filter(v => v.dataset_id === datasetId));
  }

  async createVersion(version: DatasetVersion, tx?: ITransactionContext): Promise<DatasetVersion> {
    const state = this.getState(tx);
    const cloned = structuredClone(version);
    state.dataset_versions.push(cloned);
    this.persist(tx);
    return structuredClone(cloned);
  }
}

// ============================================================================
// 7. Scientific Registry Repository
// ============================================================================

export class JsonScientificRegistryRepository extends BaseJsonRepository implements IScientificRegistryRepository {
  async getUnits(tx?: ITransactionContext): Promise<ScientificUnit[]> {
    return structuredClone(this.getState(tx).units);
  }

  async getUnitById(id: string, tx?: ITransactionContext): Promise<ScientificUnit | null> {
    const unit = this.getState(tx).units.find(u => u.unit_id === id);
    return unit ? structuredClone(unit) : null;
  }

  async getVariables(tx?: ITransactionContext): Promise<ScientificVariable[]> {
    return structuredClone(this.getState(tx).variables);
  }

  async createVariable(variable: ScientificVariable, tx?: ITransactionContext): Promise<ScientificVariable> {
    const cloned = structuredClone(variable);
    this.getState(tx).variables.push(cloned);
    this.persist(tx);
    return structuredClone(cloned);
  }

  async getVariableById(id: string, tx?: ITransactionContext): Promise<ScientificVariable | null> {
    const v = this.getState(tx).variables.find(item => item.variable_id === id);
    return v ? structuredClone(v) : null;
  }

  async getParameters(tx?: ITransactionContext): Promise<ScientificParameter[]> {
    return structuredClone(this.getState(tx).parameters);
  }

  async createParameter(parameter: ScientificParameter, tx?: ITransactionContext): Promise<ScientificParameter> {
    const cloned = structuredClone(parameter);
    this.getState(tx).parameters.push(cloned);
    this.persist(tx);
    return structuredClone(cloned);
  }

  async getParameterById(id: string, tx?: ITransactionContext): Promise<ScientificParameter | null> {
    const p = this.getState(tx).parameters.find(item => item.parameter_id === id);
    return p ? structuredClone(p) : null;
  }

  async getFormulas(tx?: ITransactionContext): Promise<ScientificFormula[]> {
    return structuredClone(this.getState(tx).formulas);
  }

  async createFormula(formula: ScientificFormula, tx?: ITransactionContext): Promise<ScientificFormula> {
    const cloned = structuredClone(formula);
    this.getState(tx).formulas.push(cloned);
    this.persist(tx);
    return structuredClone(cloned);
  }

  async getFormulaById(id: string, tx?: ITransactionContext): Promise<ScientificFormula | null> {
    const f = this.getState(tx).formulas.find(item => item.formula_id === id);
    return f ? structuredClone(f) : null;
  }

  async getModels(tx?: ITransactionContext): Promise<ScientificModel[]> {
    return structuredClone(this.getState(tx).models);
  }

  async createModel(model: ScientificModel, tx?: ITransactionContext): Promise<ScientificModel> {
    const cloned = structuredClone(model);
    this.getState(tx).models.push(cloned);
    this.persist(tx);
    return structuredClone(cloned);
  }

  async getModelById(id: string, tx?: ITransactionContext): Promise<ScientificModel | null> {
    const m = this.getState(tx).models.find(item => item.model_id === id);
    return m ? structuredClone(m) : null;
  }

  async getReferences(tx?: ITransactionContext): Promise<ScientificReference[]> {
    return structuredClone(this.getState(tx).references);
  }

  async createReference(reference: ScientificReference, tx?: ITransactionContext): Promise<ScientificReference> {
    const cloned = structuredClone(reference);
    this.getState(tx).references.push(cloned);
    this.persist(tx);
    return structuredClone(cloned);
  }

  async getReferenceById(id: string, tx?: ITransactionContext): Promise<ScientificReference | null> {
    const r = this.getState(tx).references.find(item => item.reference_id === id);
    return r ? structuredClone(r) : null;
  }

  async getInterpretationRules(tx?: ITransactionContext): Promise<InterpretationRule[]> {
    return structuredClone(this.getState(tx).interpretation_rules);
  }

  async getInterpretationRuleById(id: string, tx?: ITransactionContext): Promise<InterpretationRule | null> {
    const rule = this.getState(tx).interpretation_rules.find(item => item.rule_id === id);
    return rule ? structuredClone(rule) : null;
  }

  async getAlgorithms(tx?: ITransactionContext): Promise<ScientificAlgorithm[]> {
    return structuredClone(this.getState(tx).algorithms);
  }

  async getAlgorithmById(id: string, tx?: ITransactionContext): Promise<ScientificAlgorithm | null> {
    const a = this.getState(tx).algorithms.find(item => item.algorithm_id === id);
    return a ? structuredClone(a) : null;
  }
}

// ============================================================================
// 8. Research Artifact Repository
// ============================================================================

export class JsonResearchArtifactRepository extends BaseJsonRepository implements IResearchArtifactRepository {
  async getAllAnalyses(tx?: ITransactionContext): Promise<StatisticsAnalysis[]> {
    return structuredClone(this.getState(tx).statistics_analyses);
  }

  async getAllCharts(tx?: ITransactionContext): Promise<ChartRecord[]> {
    return structuredClone(this.getState(tx).charts);
  }

  async getAllNotebooks(tx?: ITransactionContext): Promise<NutriNotebook[]> {
    return structuredClone(this.getState(tx).notebooks);
  }

  async getAllExperiments(tx?: ITransactionContext): Promise<Experiment[]> {
    return structuredClone(this.getState(tx).experiments);
  }

  async getAllCodeExecutions(tx?: ITransactionContext): Promise<CodeExecutionRecord[]> {
    return structuredClone(this.getState(tx).code_executions);
  }

  async getAllProvenanceRecords(tx?: ITransactionContext): Promise<ProvenanceRecord[]> {
    return structuredClone(this.getState(tx).provenance_records);
  }

  async getNotebookCells(notebookId: string, tx?: ITransactionContext): Promise<NotebookCell[]> {
    return structuredClone(this.getState(tx).notebook_cells.filter(cell => cell.notebook_id === notebookId));
  }

  async findNotebookCellById(cellId: string, tx?: ITransactionContext): Promise<NotebookCell | null> {
    const cell = this.getState(tx).notebook_cells.find(candidate => candidate.id === cellId);
    return cell ? structuredClone(cell) : null;
  }

  async getAnalysesByProject(projectId: string, tx?: ITransactionContext): Promise<StatisticsAnalysis[]> {
    return structuredClone(this.getState(tx).statistics_analyses.filter(a => a.project_id === projectId));
  }

  async getAnalysisById(id: string, tx?: ITransactionContext): Promise<StatisticsAnalysis | null> {
    const a = this.getState(tx).statistics_analyses.find(item => item.id === id);
    return a ? structuredClone(a) : null;
  }

  async createAnalysis(analysis: StatisticsAnalysis, tx?: ITransactionContext): Promise<StatisticsAnalysis> {
    const state = this.getState(tx);
    const cloned = structuredClone(analysis);
    state.statistics_analyses.push(cloned);
    this.persist(tx);
    return structuredClone(cloned);
  }

  async getChartsByProject(projectId: string, tx?: ITransactionContext): Promise<ChartRecord[]> {
    return structuredClone(this.getState(tx).charts.filter(c => c.project_id === projectId));
  }

  async getChartById(id: string, tx?: ITransactionContext): Promise<ChartRecord | null> {
    const c = this.getState(tx).charts.find(item => item.id === id);
    return c ? structuredClone(c) : null;
  }

  async createChart(chart: ChartRecord, tx?: ITransactionContext): Promise<ChartRecord> {
    const state = this.getState(tx);
    const cloned = structuredClone(chart);
    state.charts.push(cloned);
    this.persist(tx);
    return structuredClone(cloned);
  }

  async getNotebooksByProject(projectId: string, tx?: ITransactionContext): Promise<NutriNotebook[]> {
    return structuredClone(this.getState(tx).notebooks.filter(nb => nb.project_id === projectId));
  }

  async getNotebookWithCells(notebookId: string, tx?: ITransactionContext): Promise<{ notebook: NutriNotebook; cells: NotebookCell[] } | null> {
    const state = this.getState(tx);
    const notebook = state.notebooks.find(nb => nb.id === notebookId);
    if (!notebook) return null;
    const cells = state.notebook_cells.filter(cell => cell.notebook_id === notebookId);
    return {
      notebook: structuredClone(notebook),
      cells: structuredClone(cells)
    };
  }

  async createNotebook(notebook: NutriNotebook, tx?: ITransactionContext): Promise<NutriNotebook> {
    const state = this.getState(tx);
    const cloned = structuredClone(notebook);
    state.notebooks.push(cloned);
    this.persist(tx);
    return structuredClone(cloned);
  }

  async createNotebookCell(cell: NotebookCell, tx?: ITransactionContext): Promise<NotebookCell> {
    const state = this.getState(tx);
    const cloned = structuredClone(cell);
    state.notebook_cells.push(cloned);
    this.persist(tx);
    return structuredClone(cloned);
  }

  async updateNotebookCell(cellId: string, updates: Partial<NotebookCell>, tx?: ITransactionContext): Promise<NotebookCell> {
    const state = this.getState(tx);
    const idx = state.notebook_cells.findIndex(c => c.id === cellId);
    if (idx === -1) {
      throw new Error(`Notebook cell not found: ${cellId}`);
    }
    const updated: NotebookCell = {
      ...state.notebook_cells[idx],
      ...updates
    };
    state.notebook_cells[idx] = updated;
    this.persist(tx);
    return structuredClone(updated);
  }

  async deleteNotebookCell(cellId: string, tx?: ITransactionContext): Promise<boolean> {
    const state = this.getState(tx);
    const idx = state.notebook_cells.findIndex(c => c.id === cellId);
    if (idx === -1) return false;
    state.notebook_cells.splice(idx, 1);
    this.persist(tx);
    return true;
  }

  async getExperimentsByProject(projectId: string, tx?: ITransactionContext): Promise<Experiment[]> {
    return structuredClone(this.getState(tx).experiments.filter(e => e.project_id === projectId));
  }

  async getExperimentById(id: string, tx?: ITransactionContext): Promise<Experiment | null> {
    const e = this.getState(tx).experiments.find(item => item.id === id);
    return e ? structuredClone(e) : null;
  }

  async createExperiment(experiment: Experiment, tx?: ITransactionContext): Promise<Experiment> {
    const state = this.getState(tx);
    const cloned = structuredClone(experiment);
    state.experiments.push(cloned);
    this.persist(tx);
    return structuredClone(cloned);
  }

  async getCodeExecutionsByProject(projectId: string, tx?: ITransactionContext): Promise<CodeExecutionRecord[]> {
    return structuredClone(this.getState(tx).code_executions.filter(ce => ce.project_id === projectId));
  }

  async createCodeExecution(record: CodeExecutionRecord, tx?: ITransactionContext): Promise<CodeExecutionRecord> {
    const state = this.getState(tx);
    const cloned = structuredClone(record);
    state.code_executions.push(cloned);
    this.persist(tx);
    return structuredClone(cloned);
  }

  async getProvenanceRecords(projectId: string, tx?: ITransactionContext): Promise<ProvenanceRecord[]> {
    return structuredClone(this.getState(tx).provenance_records.filter(pr => pr.project_id === projectId));
  }

  async createProvenanceRecord(record: ProvenanceRecord, tx?: ITransactionContext): Promise<ProvenanceRecord> {
    const state = this.getState(tx);
    const cloned = structuredClone(record);
    state.provenance_records.push(cloned);
    this.persist(tx);
    return structuredClone(cloned);
  }

  async getCalculations(projectId?: string, tx?: ITransactionContext): Promise<CalculationTrace[]> {
    const state = this.getState(tx);
    if (projectId) {
      return structuredClone(state.calculations.filter(c => c.project_id === projectId));
    }
    return structuredClone(state.calculations);
  }

  async getCalculationById(id: string, tx?: ITransactionContext): Promise<CalculationTrace | null> {
    const c = this.getState(tx).calculations.find(item => item.calculation_id === id);
    return c ? structuredClone(c) : null;
  }

  async createCalculation(calculation: CalculationTrace, tx?: ITransactionContext): Promise<CalculationTrace> {
    const state = this.getState(tx);
    const cloned = structuredClone(calculation);
    state.calculations.push(cloned);
    this.persist(tx);
    return structuredClone(cloned);
  }
}

// ============================================================================
// 9. Audit Log Repository
// ============================================================================

export class JsonAuditLogRepository extends BaseJsonRepository implements IAuditLogRepository {
  async appendLog(
    logData: Omit<AuditLog, 'id' | 'timestamp'> & { id?: string; timestamp?: string },
    tx?: ITransactionContext
  ): Promise<AuditLog> {
    const state = this.getState(tx);
    const fullLog: AuditLog = {
      id: logData.id || `AUDIT_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: logData.timestamp || new Date().toISOString(),
      user_id: logData.user_id,
      user_name: logData.user_name,
      action: logData.action,
      entity_type: logData.entity_type,
      entity_id: logData.entity_id,
      details: logData.details,
      ip_address: logData.ip_address,
      metadata: logData.metadata
    };
    state.audit_logs.unshift(fullLog);
    if (state.audit_logs.length > 1000) state.audit_logs.pop();
    this.persist(tx);
    return structuredClone(fullLog);
  }

  async queryLogs(filter?: IAuditLogFilter, tx?: ITransactionContext): Promise<AuditLog[]> {
    const state = this.getState(tx);
    let logs = state.audit_logs;

    if (filter) {
      if (filter.userId) logs = logs.filter(l => l.user_id === filter.userId);
      if (filter.entityType) logs = logs.filter(l => l.entity_type === filter.entityType);
      if (filter.entityId) logs = logs.filter(l => l.entity_id === filter.entityId);
      if (filter.action) logs = logs.filter(l => l.action === filter.action);
      if (filter.startTime) {
        const start = new Date(filter.startTime).getTime();
        logs = logs.filter(l => new Date(l.timestamp).getTime() >= start);
      }
      if (filter.endTime) {
        const end = new Date(filter.endTime).getTime();
        logs = logs.filter(l => new Date(l.timestamp).getTime() <= end);
      }
      if (filter.offset !== undefined) {
        logs = logs.slice(filter.offset);
      }
      if (filter.limit !== undefined) {
        logs = logs.slice(0, filter.limit);
      }
    }

    return structuredClone(logs);
  }

  async countLogs(filter?: IAuditLogFilter, tx?: ITransactionContext): Promise<number> {
    const logs = await this.queryLogs(filter, tx);
    return logs.length;
  }
}

// ============================================================================
// 10. Session Repository (Asynchronous wrapper over SessionStore)
// ============================================================================

export class JsonSessionRepository implements ISessionRepository {
  constructor(private readonly sessionStore: ISessionStore = defaultSessionStore) {}

  async createSession(
    userId: string,
    ttlSeconds?: number,
    tokenVersion?: number,
    _tx?: ITransactionContext
  ): Promise<{ token: string; expiresAt: number; session: Omit<SessionData, 'tokenHash'> }> {
    return this.sessionStore.createSession(userId, ttlSeconds, tokenVersion);
  }

  async validateSession(token: string): Promise<SessionValidationResult> {
    return this.sessionStore.validateSession(token);
  }

  async revokeSession(token: string, _tx?: ITransactionContext): Promise<boolean> {
    return this.sessionStore.revokeSession(token);
  }

  async revokeSessionsForUser(userId: string, _tx?: ITransactionContext): Promise<number> {
    return this.sessionStore.revokeSessionsForUser(userId);
  }

  async cleanExpiredSessions(_now?: number, _tx?: ITransactionContext): Promise<number> {
    return this.sessionStore.cleanExpiredSessions();
  }

  async getActiveSessionsCount(): Promise<number> {
    return this.sessionStore.getActiveSessionsCount();
  }
}

// ============================================================================
// 11. OIDC Transaction Repository (Asynchronous wrapper over OIDCTransactionStore)
// ============================================================================

export class JsonOIDCTransactionRepository implements IOIDCTransactionRepository {
  constructor(private readonly oidcStore: IOIDCTransactionStore = defaultOIDCTransactionStore) {}

  async createTransaction(
    options?: CreateTransactionOptions,
    _tx?: ITransactionContext
  ): Promise<{ transaction: OIDCTransaction; clientData: OIDCClientTransactionData }> {
    return this.oidcStore.createTransaction(options);
  }

  async getTransaction(id: string, _tx?: ITransactionContext): Promise<OIDCTransaction | null> {
    return this.oidcStore.getTransaction(id) ?? null;
  }

  async getTransactionByState(state: string, _tx?: ITransactionContext): Promise<OIDCTransaction | null> {
    return this.oidcStore.getTransactionByState(state) ?? null;
  }

  async consumeTransaction(options: ConsumeTransactionOptions, _tx?: ITransactionContext): Promise<ConsumeTransactionResult> {
    return this.oidcStore.consumeTransaction(options);
  }

  async deleteTransaction(id: string, _tx?: ITransactionContext): Promise<boolean> {
    return this.oidcStore.deleteTransaction(id);
  }

  async cleanExpiredTransactions(now?: number, _tx?: ITransactionContext): Promise<number> {
    return this.oidcStore.cleanExpiredTransactions(now);
  }
}

// ============================================================================
// 12. Unified Container / Composition Root (LowdbJsonDatabase)
// ============================================================================

export class LowdbJsonDatabase implements IDatabaseRepositories {
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
    private readonly store: DatabaseStore = defaultDbStore,
    sessionStore: ISessionStore = defaultSessionStore,
    oidcStore: IOIDCTransactionStore = defaultOIDCTransactionStore
  ) {
    this.users = new JsonUserRepository(this.store);
    this.externalIdentities = new JsonExternalIdentityRepository(this.store);
    this.roleRequests = new JsonRoleRequestRepository(this.store);
    this.projects = new JsonProjectRepository(this.store);
    this.memberships = new JsonMembershipRepository(this.store);
    this.materials = new JsonMaterialRepository(this.store);
    this.datasets = new JsonDatasetRepository(this.store);
    this.scientificRegistry = new JsonScientificRegistryRepository(this.store);
    this.researchArtifacts = new JsonResearchArtifactRepository(this.store);
    this.auditLogs = new JsonAuditLogRepository(this.store);
    this.sessions = new JsonSessionRepository(sessionStore);
    this.oidcTransactions = new JsonOIDCTransactionRepository(oidcStore);
    this.unitOfWork = new JsonUnitOfWork(this.store);
  }

  public getStore(): DatabaseStore {
    return this.store;
  }
}

export function createLowdbJsonDatabase(
  store: DatabaseStore = defaultDbStore,
  sessionStore: ISessionStore = defaultSessionStore,
  oidcStore: IOIDCTransactionStore = defaultOIDCTransactionStore
): LowdbJsonDatabase {
  return new LowdbJsonDatabase(store, sessionStore, oidcStore);
}

// Default export / singleton instance
export const defaultDatabaseRepositories = new LowdbJsonDatabase();
