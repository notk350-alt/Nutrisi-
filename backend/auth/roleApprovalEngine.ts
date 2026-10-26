/**
 * NutriBodySim — Secure Role Approval Engine (MVS-B2.5B.3)
 *
 * Implements server-authoritative state transitions, risk-tiered reviewer authority,
 * anti-self-approval enforcement, idempotency/replay protection, atomic rollback guarantees,
 * session revocation, and immutable audit trails for role elevation workflows.
 */

import { User, RoleRequest, RequestedRole, AuditLog } from '../database/types';
import { DatabaseStore, db } from '../database/store';
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
  private database: DatabaseStore;
  private sessionStore: ISessionStore;

  constructor(database: DatabaseStore = db, sessionStore: ISessionStore = defaultSessionStore) {
    this.database = database;
    this.sessionStore = sessionStore;
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

    // 1. Storage retrieval & state validation
    const roleRequest = this.database.findRoleRequestById(requestId);
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
    const state = this.database.getState();
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
    const result = this.database.approveRoleRequest({
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

    // 1. Storage retrieval & state validation
    const roleRequest = this.database.findRoleRequestById(requestId);
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
    const result = this.database.rejectRoleRequest({
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

    const roleRequest = this.database.findRoleRequestById(requestId);
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

    const result = this.database.cancelRoleRequest({
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
}

export const defaultRoleApprovalEngine = new RoleApprovalEngine();
