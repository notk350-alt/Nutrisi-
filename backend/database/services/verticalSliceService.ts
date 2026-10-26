/**
 * NutriBodySim — Vertical Slice Service (MVS-B2.5E.1B.5–E.1B.8 Phase E)
 *
 * Demonstrates a representative domain service that relies strictly on the
 * abstract IDatabaseRepositories and IUnitOfWork contracts.
 *
 * This service operates identically regardless of whether the underlying storage
 * is LowdbJsonDatabase or PostgresDatabaseRepositories, proving migration readiness
 * without mutating existing API routes.
 */

import { IDatabaseRepositories, ITransactionContext } from '../contracts';
import { Project, ProjectMember, ProjectType, TeamRole } from '../types';

export interface CreateProjectWithGovernanceInput {
  name: string;
  description: string;
  type?: ProjectType;
  ownerId: string;
  isPublic?: boolean;
  tags?: string[];
}

export interface TransferOwnershipInput {
  projectId: string;
  currentOwnerId: string;
  newOwnerId: string;
  reason: string;
}

export class ResearchProjectGovernanceService {
  constructor(private readonly repos: IDatabaseRepositories) {}

  /**
   * Creates a research project, assigns the creator as Owner member,
   * and records an immutable audit log atomically within a single Unit of Work.
   */
  public async createProjectWithGovernance(
    input: CreateProjectWithGovernanceInput
  ): Promise<{ project: Project; membership: ProjectMember; auditLogId: string }> {
    return this.repos.unitOfWork.runInTransaction(async (tx: ITransactionContext) => {
      // 1. Verify owner exists
      const owner = await this.repos.users.findById(input.ownerId, tx);
      if (!owner) {
        throw new Error(`Owner user '${input.ownerId}' does not exist.`);
      }

      const now = new Date().toISOString();
      const projectId = `proj_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

      // 2. Create the Project
      const newProject: Project = {
        id: projectId,
        name: input.name,
        description: input.description,
        type: input.type || 'Research',
        owner_id: input.ownerId,
        is_public: Boolean(input.isPublic),
        tags: input.tags || [],
        created_at: now,
        updated_at: now
      };

      const project = await this.repos.projects.create(newProject, tx);

      // 3. Add owner as member
      const memberRecord: ProjectMember = {
        id: `pm_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        project_id: projectId,
        user_id: input.ownerId,
        role: 'Owner',
        joined_at: now
      };

      await this.repos.memberships.addProjectMember(memberRecord, tx);

      // 4. Record Governance Audit Log via appendLog
      const auditLogId = `audit_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      await this.repos.auditLogs.appendLog(
        {
          id: auditLogId,
          user_id: input.ownerId,
          user_name: owner.name,
          action: 'CREATE',
          entity_type: 'PROJECT',
          entity_id: projectId,
          details: JSON.stringify({
            projectName: input.name,
            projectType: newProject.type,
            isPublic: newProject.is_public
          }),
          timestamp: now
        },
        tx
      );

      return { project, membership: memberRecord, auditLogId };
    });
  }

  /**
   * Transfers ownership of a project to another user, updates project and membership,
   * and records audit logs atomically.
   */
  public async transferOwnership(
    input: TransferOwnershipInput
  ): Promise<{ success: boolean; newOwnerId: string }> {
    return this.repos.unitOfWork.runInTransaction(async (tx: ITransactionContext) => {
      const project = await this.repos.projects.findById(input.projectId, tx);
      if (!project) {
        throw new Error(`Project '${input.projectId}' not found.`);
      }

      if (project.owner_id !== input.currentOwnerId) {
        throw new Error(
          `User '${input.currentOwnerId}' is not the current owner of project '${input.projectId}'.`
        );
      }

      const newOwner = await this.repos.users.findById(input.newOwnerId, tx);
      if (!newOwner) {
        throw new Error(`Target user '${input.newOwnerId}' does not exist.`);
      }

      // Update project owner
      await this.repos.projects.update(
        input.projectId,
        {
          owner_id: input.newOwnerId,
          updated_at: new Date().toISOString()
        },
        tx
      );

      // Record transfer audit log via appendLog
      await this.repos.auditLogs.appendLog(
        {
          id: `audit_transfer_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          user_id: input.currentOwnerId,
          user_name: project.owner_id,
          action: 'EDIT',
          entity_type: 'PROJECT',
          entity_id: input.projectId,
          details: JSON.stringify({
            previousOwnerId: input.currentOwnerId,
            newOwnerId: input.newOwnerId,
            reason: input.reason
          }),
          timestamp: new Date().toISOString()
        },
        tx
      );

      return { success: true, newOwnerId: input.newOwnerId };
    });
  }
}
