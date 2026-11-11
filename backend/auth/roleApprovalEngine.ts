/**
 * NutriBodySim — Secure Role Approval Engine (MVS-B2.5B.3)
 *
 * Implements server-authoritative state transitions, risk-tiered reviewer authority,
 * anti-self-approval enforcement, idempotency/replay protection, atomic rollback guarantees,
 * session revocation, and immutable audit trails for role elevation workflows.
 */

import { User, RoleRequest, RequestedRole, AuditLog } from '../database/types';
import type { DatabaseStore } from '../database/store';
import type { IDatabaseRepositories } from '../database/contracts';
import { getRuntimeDb, getRuntimeRepositories, getRuntimeSelection, resolveDatabaseProvider } from '../database/runtime';
import { ISessionStore, defaultSessionStore } from './sessionStore';
import { hasPermission, ROLE_DEFAULT_PERMISSIONS } from './rbacMiddleware';

export interface ApprovalAuthorityCheckResult {
  allowed: boolean;
  statusCode?: number;
  errorCode?: string;
  errorMessage?: string;
}

export interface RoleApprovalResult {
  success: boolean;
  message: string;
  role_request: RoleRequest;
  updated_user?: {
    id: string;
    role: string;
    updated_at: string;
    token_version?: number;
  };
  audit_log?: AuditLog;
}

export class RoleApprovalEngine {
  private readonly database?: DatabaseStore | IDatabaseRepositories;
  private sessionStore: ISessionStore;

  constructor(database?: DatabaseStore | IDatabaseRepositories, sessionStore: ISessionStore = defaultSessionStore) {
    this.database = database;
    this.sessionStore = sessionStore;
  }

  private get repositories(): IDatabaseRepositories | undefined {
    const runtime = getRuntimeSelection();
    if (resolveDatabaseProvider() === 'postgres') {
      if (runtime?.provider !== 'postgres') {
        throw new Error('PostgreSQL runtime must be initialized before processing role approvals.');
      }
      if (this.database && this.database !== runtime.repositories) {
        throw new Error('Role approval must use the initialized PostgreSQL repositories.');
      }
      return getRuntimeRepositories();
    }
    if (this.database && 'unitOfWork' in this.database) return this.database;
    return undefined;
  }

  private get store(): DatabaseStore {
    if (this.database && !('unitOfWork' in this.database)) return this.database;
    return getRuntimeDb();
  }

  /**
   * Verifies whether a given reviewer is authorized to process a request for the target role.
   *
   * Risk-Tier Rules:
   * 1. Self-review prohibition: Reviewer cannot approve or reject their own request.
   * 2. Reviewer must have account_status === 'ACTIVE'.
   * 3. Elevation to 'Admin': strictly requires verified Main Administrator holding Admin role.
   * 4. Academic roles ('Lecturer' / 'Researcher'): requires regular Admin holding ADMIN permission.
   * 5. Non-admins cannot review any request.
   */
  public verifyReviewerAuthority(
    reviewer: User,
    roleRequest: RoleRequest
  ): ApprovalAuthorityCheckResult {
    if (!reviewer) {
      return {
        allowed: false,
        statusCode: 401,
        errorCode: 'UNAUTHENTICATED',
        errorMessage: 'Authentication required to process role requests.'
      };
    }

    // 1. Anti-Self-Review
    if (reviewer.id === roleRequest.user_id) {
      return {
        allowed: false,
        statusCode: 403,
        errorCode: 'SELF_APPROVAL_PROHIBITED',
        errorMessage: 'Reviewers cannot approve, reject, or process their own role elevation requests.'
      };
    }

    // 2. Reviewer Account Status Check
    if (reviewer.account_status && reviewer.account_status !== 'ACTIVE') {
      return {
        allowed: false,
        statusCode: 403,
        errorCode: 'REVIEWER_NOT_ACTIVE',
        errorMessage: `Reviewer account is '${reviewer.account_status}'. Inactive or suspended reviewers cannot process requests.`
      };
    }

    // 3. Risk-Tier Policy: Admin Promotion vs Academic Elevation
    if (roleRequest.requested_role === 'Admin') {
      const isMainAdmin = Boolean(reviewer.is_main_admin === true && reviewer.role === 'Admin');
      if (!isMainAdmin) {
        return {
          allowed: false,
          statusCode: 403,
          errorCode: 'INSUFFICIENT_ADMIN_PRIVILEGE',
          errorMessage: 'Promotion to Administrator requires active Main Administrator governance authority (MANAGE_PRIVILEGED_ROLES). Regular Administrators cannot approve Admin elevation.'
        };
      }
      return { allowed: true };
    }

    // Academic Elevation (Student -> Lecturer/Researcher, or lateral)
    if (!hasPermission(reviewer, 'ADMIN')) {
      return {
        allowed: false,
        statusCode: 403,
        errorCode: 'FORBIDDEN',
        errorMessage: 'Administrative privilege (ADMIN permission) is required to review academic role requests.'
      };
    }

    return { allowed: true };
  }

  /**
   * Processes approval for a pending role request.
   */
  public async approve(params: {
    requestId: string;
    reviewer: User;
    reviewReason?: string;
    ipAddress?: string;
  }): Promise<RoleApprovalResult> {
    const { requestId, reviewer, reviewReason, ipAddress } = params;
    const repositories = this.repositories;
    if (repositories) {
      return this.approveWithRepositories(repositories, params);
    }

    // 1. Storage retrieval & state validation
    const roleRequest = this.store.findRoleRequestById(requestId);
    if (!roleRequest) {
      const err: any = new Error(`Role request '${requestId}' not found.`);
      err.statusCode = 404;
      err.code = 'NOT_FOUND';
      throw err;
    }

    // 2. State Machine Terminal check (Immutability & Replay Defense)
    if (roleRequest.approval_status !== 'PENDING') {
      const err: any = new Error(
        `Role request is already finalized with status '${roleRequest.approval_status}' and cannot be processed again.`
      );
      err.statusCode = 409;
      err.code = 'ALREADY_FINALIZED';
      err.current_status = roleRequest.approval_status;
      throw err;
    }

    // 3. Authority & Governance Policy Check
    const authCheck = this.verifyReviewerAuthority(reviewer, roleRequest);
    if (!authCheck.allowed) {
      const err: any = new Error(authCheck.errorMessage || 'Reviewer authority check failed.');
      err.statusCode = authCheck.statusCode || 403;
      err.code = authCheck.errorCode || 'FORBIDDEN';
      throw err;
    }

    // 4. Validate Target User existence and account status
    const state = this.store.getState();
    const targetUser = state.users.find((u: User) => u.id === roleRequest.user_id);
    if (!targetUser) {
      const err: any = new Error(`Target user '${roleRequest.user_id}' not found in registry.`);
      err.statusCode = 404;
      err.code = 'USER_NOT_FOUND';
      throw err;
    }

    if (targetUser.account_status && targetUser.account_status !== 'ACTIVE') {
      const err: any = new Error(
        `Target user has account status '${targetUser.account_status}'. Role elevation cannot be approved for inactive or suspended users.`
      );
      err.statusCode = 403;
      err.code = 'TARGET_NOT_ACTIVE';
      throw err;
    }

    // 5. Execute atomic transaction in DatabaseStore
    const result = this.store.approveRoleRequest({
      requestId,
      reviewerId: reviewer.id,
      reviewReason,
      ipAddress
    });

    // 6. Invalidate all active sessions for target user
    try {
      this.sessionStore.revokeSessionsForUser(targetUser.id);
    } catch (sessionErr: any) {
      console.error(`Session revocation failed for user ${targetUser.id}:`, sessionErr);
      // Invalidation failure must not be ignored
      const err: any = new Error(`Role approved but session invalidation failed: ${sessionErr.message}`);
      err.statusCode = 500;
      err.code = 'SESSION_INVALIDATION_FAILED';
      throw err;
    }

    return {
      success: true,
      message: 'Role elevation approved successfully.',
      role_request: result.roleRequest,
      updated_user: {
        id: result.updatedUser.id,
        role: result.updatedUser.role,
        updated_at: result.updatedUser.updated_at || new Date().toISOString(),
        token_version: result.updatedUser.token_version
      },
      audit_log: result.auditLog
    };
  }

  /**
   * Processes rejection for a pending role request.
   */
  public async reject(params: {
    requestId: string;
    reviewer: User;
    reviewReason: string;
    ipAddress?: string;
  }): Promise<RoleApprovalResult> {
    const { requestId, reviewer, reviewReason, ipAddress } = params;
    const repositories = this.repositories;
    if (repositories) {
      return this.rejectWithRepositories(repositories, params);
    }

    // 1. Storage retrieval & state validation
    const roleRequest = this.store.findRoleRequestById(requestId);
    if (!roleRequest) {
      const err: any = new Error(`Role request '${requestId}' not found.`);
      err.statusCode = 404;
      err.code = 'NOT_FOUND';
      throw err;
    }

    // 2. State Machine Terminal check (Immutability & Replay Defense)
    if (roleRequest.approval_status !== 'PENDING') {
      const err: any = new Error(
        `Role request is already finalized with status '${roleRequest.approval_status}' and cannot be processed again.`
      );
      err.statusCode = 409;
      err.code = 'ALREADY_FINALIZED';
      err.current_status = roleRequest.approval_status;
      throw err;
    }

    // 3. Authority & Governance Policy Check
    const authCheck = this.verifyReviewerAuthority(reviewer, roleRequest);
    if (!authCheck.allowed) {
      const err: any = new Error(authCheck.errorMessage || 'Reviewer authority check failed.');
      err.statusCode = authCheck.statusCode || 403;
      err.code = authCheck.errorCode || 'FORBIDDEN';
      throw err;
    }

    // 4. Validate Review Reason (Mandatory for rejection)
    if (!reviewReason || typeof reviewReason !== 'string' || reviewReason.trim().length < 5) {
      const err: any = new Error('A comprehensive review_reason (minimum 5 characters) is required for role request rejection.');
      err.statusCode = 400;
      err.code = 'REVIEW_REASON_REQUIRED';
      throw err;
    }

    // 5. Execute atomic rejection in DatabaseStore
    const result = this.store.rejectRoleRequest({
      requestId,
      reviewerId: reviewer.id,
      reviewReason,
      ipAddress
    });

    return {
      success: true,
      message: 'Role elevation rejected.',
      role_request: result.roleRequest,
      audit_log: result.auditLog
    };
  }

  /**
   * Allows the original requester to cancel their own pending request.
   */
  public async cancel(params: {
    requestId: string;
    caller: User;
    ipAddress?: string;
  }): Promise<RoleApprovalResult> {
    const { requestId, caller, ipAddress } = params;
    const repositories = this.repositories;
    if (repositories) {
      return this.cancelWithRepositories(repositories, params);
    }

    const roleRequest = this.store.findRoleRequestById(requestId);
    if (!roleRequest) {
      const err: any = new Error(`Role request '${requestId}' not found.`);
      err.statusCode = 404;
      err.code = 'NOT_FOUND';
      throw err;
    }

    // Terminal check
    if (roleRequest.approval_status !== 'PENDING') {
      const err: any = new Error(
        `Role request is already finalized with status '${roleRequest.approval_status}' and cannot be cancelled.`
      );
      err.statusCode = 409;
      err.code = 'ALREADY_FINALIZED';
      err.current_status = roleRequest.approval_status;
      throw err;
    }

    // Ownership check: only owner can cancel
    if (roleRequest.user_id !== caller.id) {
      const err: any = new Error('You may only cancel your own role elevation requests.');
      err.statusCode = 403;
      err.code = 'FORBIDDEN_NOT_OWNER';
      throw err;
    }

    const result = this.store.cancelRoleRequest({
      requestId,
      callerId: caller.id,
      ipAddress
    });

    return {
      success: true,
      message: 'Role request cancelled by owner.',
      role_request: result.roleRequest,
      audit_log: result.auditLog
    };
  }

  private async approveWithRepositories(
    repositories: IDatabaseRepositories,
    params: { requestId: string; reviewer: User; reviewReason?: string; ipAddress?: string }
  ): Promise<RoleApprovalResult> {
    return repositories.unitOfWork.runInTransaction(async tx => {
      const roleRequest = await repositories.roleRequests.findById(params.requestId, tx);
      if (!roleRequest) throw this.roleRequestError(params.requestId, 'NOT_FOUND', 404);
      if (roleRequest.approval_status !== 'PENDING') {
        throw this.finalizedError(roleRequest, 'cannot be processed again.');
      }

      const reviewer = await repositories.users.findById(params.reviewer.id, tx);
      if (!reviewer) throw this.domainError(`Reviewer '${params.reviewer.id}' not found in registry.`, 'REVIEWER_NOT_FOUND', 404);
      const authCheck = this.verifyReviewerAuthority(reviewer, roleRequest);
      if (!authCheck.allowed) {
        throw this.domainError(authCheck.errorMessage || 'Reviewer authority check failed.', authCheck.errorCode || 'FORBIDDEN', authCheck.statusCode || 403);
      }

      const targetUser = await repositories.users.findById(roleRequest.user_id, tx);
      if (!targetUser) throw this.domainError(`Target user '${roleRequest.user_id}' not found in registry.`, 'USER_NOT_FOUND', 404);
      if (targetUser.account_status && targetUser.account_status !== 'ACTIVE') {
        throw this.domainError(
          `Target user has account status '${targetUser.account_status}'. Role elevation cannot be approved for inactive or suspended users.`,
          'TARGET_NOT_ACTIVE',
          403
        );
      }

      const now = new Date().toISOString();
      const sanitizedReason = params.reviewReason?.trim().replace(/<[^>]*>/g, '') || 'Role elevation approved by administrator.';
      const updatedUser = await repositories.users.update(targetUser.id, {
        role: roleRequest.requested_role,
        permissions: [...(ROLE_DEFAULT_PERMISSIONS[roleRequest.requested_role] || [])],
        token_version: (targetUser.token_version || 1) + 1,
        updated_at: now
      }, tx);
      const updatedRequest = await repositories.roleRequests.updateStatus(
        roleRequest.request_id,
        'APPROVED',
        reviewer.id,
        sanitizedReason,
        tx,
        'PENDING'
      );
      await repositories.sessions.revokeSessionsForUser(targetUser.id, tx);
      const auditLog = await repositories.auditLogs.appendLog({
        user_id: reviewer.id,
        user_name: reviewer.name,
        action: 'ROLE_APPROVAL',
        entity_type: 'ROLE_REQUEST',
        entity_id: roleRequest.request_id,
        details: `Role request ${roleRequest.request_id} APPROVED by ${reviewer.name} (${reviewer.id}): ${targetUser.name} (${targetUser.id}) elevated from ${targetUser.role} to ${updatedUser.role}.`,
        ip_address: params.ipAddress || '127.0.0.1',
        timestamp: now,
        metadata: {
          request_id: roleRequest.request_id,
          requester_id: targetUser.id,
          reviewer_id: reviewer.id,
          previous_role: targetUser.role,
          new_role: updatedUser.role,
          review_reason: sanitizedReason
        }
      }, tx);

      return {
        success: true,
        message: 'Role elevation approved successfully.',
        role_request: updatedRequest,
        updated_user: {
          id: updatedUser.id,
          role: updatedUser.role,
          updated_at: updatedUser.updated_at || now,
          token_version: updatedUser.token_version
        },
        audit_log: auditLog
      };
    });
  }

  private async rejectWithRepositories(
    repositories: IDatabaseRepositories,
    params: { requestId: string; reviewer: User; reviewReason: string; ipAddress?: string }
  ): Promise<RoleApprovalResult> {
    return repositories.unitOfWork.runInTransaction(async tx => {
      const roleRequest = await repositories.roleRequests.findById(params.requestId, tx);
      if (!roleRequest) throw this.roleRequestError(params.requestId, 'NOT_FOUND', 404);
      if (roleRequest.approval_status !== 'PENDING') {
        throw this.finalizedError(roleRequest, 'cannot be processed again.');
      }

      const reviewer = await repositories.users.findById(params.reviewer.id, tx);
      if (!reviewer) throw this.domainError(`Reviewer '${params.reviewer.id}' not found in registry.`, 'REVIEWER_NOT_FOUND', 404);
      const authCheck = this.verifyReviewerAuthority(reviewer, roleRequest);
      if (!authCheck.allowed) {
        throw this.domainError(authCheck.errorMessage || 'Reviewer authority check failed.', authCheck.errorCode || 'FORBIDDEN', authCheck.statusCode || 403);
      }
      if (!params.reviewReason || typeof params.reviewReason !== 'string' || params.reviewReason.trim().length < 5) {
        throw this.domainError('A comprehensive review_reason (minimum 5 characters) is required for role request rejection.', 'REVIEW_REASON_REQUIRED', 400);
      }

      const now = new Date().toISOString();
      const sanitizedReason = params.reviewReason.trim().replace(/<[^>]*>/g, '');
      const updatedRequest = await repositories.roleRequests.updateStatus(
        roleRequest.request_id,
        'REJECTED',
        reviewer.id,
        sanitizedReason,
        tx,
        'PENDING'
      );
      const auditLog = await repositories.auditLogs.appendLog({
        user_id: reviewer.id,
        user_name: reviewer.name,
        action: 'ROLE_APPROVAL',
        entity_type: 'ROLE_REQUEST',
        entity_id: roleRequest.request_id,
        details: `Role request ${roleRequest.request_id} REJECTED by ${reviewer.name} (${reviewer.id}) for requested role ${roleRequest.requested_role}. Reason: ${sanitizedReason}`,
        ip_address: params.ipAddress || '127.0.0.1',
        timestamp: now
      }, tx);
      return { success: true, message: 'Role elevation rejected.', role_request: updatedRequest, audit_log: auditLog };
    });
  }

  private async cancelWithRepositories(
    repositories: IDatabaseRepositories,
    params: { requestId: string; caller: User; ipAddress?: string }
  ): Promise<RoleApprovalResult> {
    return repositories.unitOfWork.runInTransaction(async tx => {
      const roleRequest = await repositories.roleRequests.findById(params.requestId, tx);
      if (!roleRequest) throw this.roleRequestError(params.requestId, 'NOT_FOUND', 404);
      if (roleRequest.approval_status !== 'PENDING') {
        throw this.finalizedError(roleRequest, 'cannot be cancelled.');
      }
      if (roleRequest.user_id !== params.caller.id) {
        throw this.domainError('You may only cancel your own role elevation requests.', 'FORBIDDEN_NOT_OWNER', 403);
      }

      const caller = await repositories.users.findById(params.caller.id, tx);
      const now = new Date().toISOString();
      const updatedRequest = await repositories.roleRequests.updateStatus(
        roleRequest.request_id,
        'CANCELLED',
        params.caller.id,
        'Cancelled by requester.',
        tx,
        'PENDING'
      );
      const auditLog = await repositories.auditLogs.appendLog({
        user_id: params.caller.id,
        user_name: caller?.name || params.caller.name,
        action: 'ROLE_APPROVAL',
        entity_type: 'ROLE_REQUEST',
        entity_id: roleRequest.request_id,
        details: `Role request ${roleRequest.request_id} CANCELLED by owner ${caller?.name || params.caller.name}.`,
        ip_address: params.ipAddress || '127.0.0.1',
        timestamp: now
      }, tx);
      return { success: true, message: 'Role request cancelled by owner.', role_request: updatedRequest, audit_log: auditLog };
    });
  }

  private domainError(message: string, code: string, statusCode: number): Error {
    return Object.assign(new Error(message), { code, statusCode });
  }

  private roleRequestError(requestId: string, code: string, statusCode: number): Error {
    return this.domainError(`Role request '${requestId}' not found.`, code, statusCode);
  }

  private finalizedError(roleRequest: RoleRequest, suffix: string): Error {
    return Object.assign(
      this.domainError(
        `Role request is already finalized with status '${roleRequest.approval_status}' and ${suffix}`,
        'ALREADY_FINALIZED',
        409
      ),
      { current_status: roleRequest.approval_status }
    );
  }
}

export const defaultRoleApprovalEngine = new RoleApprovalEngine();
