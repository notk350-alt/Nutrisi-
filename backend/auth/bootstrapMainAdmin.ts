/**
 * NutriBodySim — Main Administrator Bootstrap Service (MVS-B2.5B.2)
 *
 * Provides isolated, server-authoritative provisioning and emergency break-glass
 * recovery for the Main Administrator role and MANAGE_PRIVILEGED_ROLES governance authority.
 *
 * Security Principles:
 * 1. CLI/Server Isolation: Never exposed via public HTTP endpoints or client RPCs.
 * 2. Immutable Attribution: Mandatory operator identifier for every invocation.
 * 3. Anti-Takeover & Idempotency: Fails closed if Main Admin already exists unless explicit break-glass flags provided.
 * 4. Active Verified Identity: Target user must exist and have account_status === 'ACTIVE'.
 * 5. Session Revocation: Invalidation of active sessions for previous and target users.
 * 6. Audit Trail: Full non-repudiable audit log with action MAIN_ADMIN_BOOTSTRAP.
 */

import { db } from '../database/store';
import { defaultSessionStore, ISessionStore } from './sessionStore';
import { User, AuditLog } from '../database/types';

export interface BootstrapMainAdminOptions {
  targetUserId: string;
  operator: string;
  reason?: string;
  forceRecovery?: boolean;
  verifyEmail?: string;
  ipAddress?: string;
  database?: typeof db;
  sessionStore?: ISessionStore;
}

export interface BootstrapMainAdminResult {
  success: boolean;
  message: string;
  idempotent: boolean;
  user: User;
  auditLog: AuditLog;
  previousMainAdmin?: User;
}

/**
 * Executes Main Administrator bootstrap or emergency break-glass governance transfer.
 */
export function executeBootstrapMainAdmin(options: BootstrapMainAdminOptions): BootstrapMainAdminResult {
  const {
    targetUserId,
    operator,
    reason,
    forceRecovery = false,
    verifyEmail,
    ipAddress = '127.0.0.1 (CLI)',
    database = db,
    sessionStore = defaultSessionStore
  } = options;

  // 1. Mandatory operator verification
  if (!operator || typeof operator !== 'string' || !operator.trim()) {
    throw new Error('BOOTSTRAP_VALIDATION_ERROR: Operator identity is mandatory for non-repudiable audit attribution.');
  }

  // 2. Mandatory target user identifier
  if (!targetUserId || typeof targetUserId !== 'string' || !targetUserId.trim()) {
    throw new Error('BOOTSTRAP_VALIDATION_ERROR: Target user_id is required.');
  }

  const trimmedTargetId = targetUserId.trim();

  // 3. Target existence and verification in server registry
  const state = database.getState();
  const targetUser = state.users.find(u => u.id === trimmedTargetId);
  if (!targetUser) {
    throw new Error(`TARGET_NOT_FOUND: User with ID '${trimmedTargetId}' does not exist in the server registry.`);
  }

  // 4. Stable identity verification: If email is provided for cross-check, must match exactly
  if (verifyEmail && typeof verifyEmail === 'string') {
    if (targetUser.email.toLowerCase() !== verifyEmail.trim().toLowerCase()) {
      throw new Error(
        `IDENTITY_MISMATCH: Provided verification email '${verifyEmail}' does not match registered email '${targetUser.email}' for user '${trimmedTargetId}'.`
      );
    }
  }

  // 5. Account status check
  if (targetUser.account_status && targetUser.account_status !== 'ACTIVE') {
    throw new Error(
      `ACCOUNT_NOT_ACTIVE: Target user '${trimmedTargetId}' is in '${targetUser.account_status}' state. Only ACTIVE accounts may be provisioned as Main Administrator.`
    );
  }

  // 6. Invoke store-level atomic bootstrap with rollback guarantees
  const result = database.bootstrapMainAdmin({
    targetUserId: trimmedTargetId,
    operator: operator.trim(),
    reason: reason?.trim(),
    forceRecovery,
    ipAddress
  });

  // 7. Revoke active sessions for target and previous admin so privileges are refreshed immediately
  if (sessionStore) {
    if (result.previousMainAdmin) {
      sessionStore.revokeSessionsForUser(result.previousMainAdmin.id);
    }
    sessionStore.revokeSessionsForUser(result.user.id);
  }

  let message = `Main Administrator successfully provisioned for user ${result.user.name} (${result.user.id}).`;
  if (result.idempotent) {
    message = `Idempotent operation: User ${result.user.name} (${result.user.id}) is already the active Main Administrator.`;
  } else if (result.previousMainAdmin) {
    message = `Emergency break-glass recovery complete: Governance transferred from ${result.previousMainAdmin.name} (${result.previousMainAdmin.id}) to ${result.user.name} (${result.user.id}).`;
  }

  return {
    success: true,
    message,
    idempotent: Boolean(result.idempotent),
    user: result.user,
    auditLog: result.auditLog,
    previousMainAdmin: result.previousMainAdmin
  };
}
