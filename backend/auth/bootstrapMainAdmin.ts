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

import type { DatabaseStore } from '../database/store';
import type { IDatabaseRepositories } from '../database/contracts';
import { getRuntimeDb, getRuntimeRepositories, getRuntimeSelection, resolveDatabaseProvider } from '../database/runtime';
import { defaultSessionStore, ISessionStore } from './sessionStore';
import { User, AuditLog } from '../database/types';

export interface BootstrapMainAdminOptions {
  targetUserId: string;
  operator: string;
  reason?: string;
  forceRecovery?: boolean;
  verifyEmail?: string;
  ipAddress?: string;
  database?: DatabaseStore | IDatabaseRepositories;
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
export async function executeBootstrapMainAdmin(options: BootstrapMainAdminOptions): Promise<BootstrapMainAdminResult> {
  const {
    targetUserId,
    operator,
    reason,
    forceRecovery = false,
    verifyEmail,
    ipAddress = '127.0.0.1 (CLI)',
    database: injectedDatabase,
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

  const runtime = getRuntimeSelection();
  let repositories: IDatabaseRepositories | undefined;
  if (resolveDatabaseProvider() === 'postgres') {
    if (runtime?.provider !== 'postgres') {
      throw new Error('PostgreSQL runtime must be initialized before Main Administrator bootstrap.');
    }
    if (injectedDatabase && injectedDatabase !== runtime.repositories) {
      throw new Error('Main Administrator bootstrap must use the initialized PostgreSQL repositories.');
    }
    repositories = getRuntimeRepositories();
  } else if (injectedDatabase && 'unitOfWork' in injectedDatabase) {
    repositories = injectedDatabase;
  }

  if (repositories) {
    const result = await repositories.unitOfWork.runInTransaction(async tx => {
      const targetUser = await repositories.users.findById(trimmedTargetId, tx);
      if (!targetUser) {
        throw new Error(`TARGET_NOT_FOUND: User with ID '${trimmedTargetId}' does not exist in the server registry.`);
      }

      if (verifyEmail && typeof verifyEmail === 'string' &&
        targetUser.email.toLowerCase() !== verifyEmail.trim().toLowerCase()) {
        throw new Error(
          `IDENTITY_MISMATCH: Provided verification email '${verifyEmail}' does not match registered email '${targetUser.email}' for user '${trimmedTargetId}'.`
        );
      }

      if (targetUser.account_status && targetUser.account_status !== 'ACTIVE') {
        throw new Error(
          `ACCOUNT_NOT_ACTIVE: Target user '${trimmedTargetId}' is in '${targetUser.account_status}' state. Only ACTIVE accounts may be provisioned as Main Administrator.`
        );
      }

      const activeUsers = (await repositories.users.listAll(tx)).filter(
        user => user.is_main_admin === true && (!user.account_status || user.account_status === 'ACTIVE')
      );
      const existingMainAdmin = activeUsers[0];
      const trimmedOperator = operator.trim();
      const now = new Date().toISOString();
      if (existingMainAdmin?.id === targetUser.id) {
        const auditLog = await repositories.auditLogs.appendLog({
          user_id: targetUser.id,
          user_name: targetUser.name,
          action: 'MAIN_ADMIN_BOOTSTRAP',
          entity_type: 'USER',
          entity_id: targetUser.id,
          details: `Idempotent bootstrap check: ${targetUser.name} (${targetUser.id}) is already active Main Administrator. Requested by operator ${trimmedOperator}.`,
          ip_address: ipAddress,
          timestamp: now
        }, tx);
        await repositories.sessions.revokeSessionsForUser(targetUser.id, tx);
        return { user: targetUser, auditLog, idempotent: true };
      }

      if (existingMainAdmin && !forceRecovery) {
        throw new Error(
          `GOVERNANCE_ALREADY_INITIALIZED: Active Main Administrator already exists (${existingMainAdmin.name} - ${existingMainAdmin.id}). Direct bootstrap blocked to prevent takeover. Use emergency break-glass recovery (--force-recovery) with detailed reason if authorized.`
        );
      }

      if (existingMainAdmin && forceRecovery && (!reason || reason.trim().length < 10)) {
        throw new Error(
          'INVALID_RECOVERY_REASON: Emergency break-glass recovery requires a comprehensive justification reason (at least 10 characters).'
        );
      }

      let previousMainAdmin: User | undefined;
      if (existingMainAdmin && existingMainAdmin.id !== targetUser.id) {
        previousMainAdmin = await repositories.users.update(existingMainAdmin.id, {
          is_main_admin: false,
          permissions: existingMainAdmin.permissions.filter(permission => permission !== 'MANAGE_PRIVILEGED_ROLES'),
          governance_granted_at: null,
          governance_granted_by: null,
          token_version: (existingMainAdmin.token_version || 0) + 1,
          updated_at: now
        }, tx);
        if (previousMainAdmin.is_main_admin !== false) {
          throw new Error('MAIN_ADMIN_REPOSITORY_UPDATE_UNSUPPORTED: Repository did not persist governance revocation.');
        }
        await repositories.sessions.revokeSessionsForUser(previousMainAdmin.id, tx);
      }

      const targetPermissions = [...targetUser.permissions];
      if (!targetPermissions.includes('ADMIN')) targetPermissions.push('ADMIN');
      if (!targetPermissions.includes('MANAGE_PRIVILEGED_ROLES')) targetPermissions.push('MANAGE_PRIVILEGED_ROLES');
      const updatedUser = await repositories.users.update(targetUser.id, {
        is_main_admin: true,
        role: 'Admin',
        permissions: targetPermissions,
        governance_granted_at: now,
        governance_granted_by: operator.trim(),
        token_version: (targetUser.token_version || 0) + 1,
        updated_at: now
      }, tx);
      if (
        updatedUser.is_main_admin !== true ||
        updatedUser.governance_granted_at !== now ||
        updatedUser.governance_granted_by !== trimmedOperator
      ) {
        throw new Error('MAIN_ADMIN_REPOSITORY_UPDATE_UNSUPPORTED: Repository did not persist Main Administrator governance fields.');
      }
      const auditLog = await repositories.auditLogs.appendLog({
        user_id: updatedUser.id,
        user_name: updatedUser.name,
        action: 'MAIN_ADMIN_BOOTSTRAP',
        entity_type: 'USER',
        entity_id: updatedUser.id,
        details: previousMainAdmin
          ? `Emergency break-glass governance transfer to ${updatedUser.name} (${updatedUser.id}) from ${previousMainAdmin.name} (${previousMainAdmin.id}) by operator ${trimmedOperator}. Reason: ${reason!.trim()}`
          : `Main Administrator initial bootstrap provisioned for ${updatedUser.name} (${updatedUser.id}) by operator ${trimmedOperator}.`,
        ip_address: ipAddress,
        timestamp: now
      }, tx);
      await repositories.sessions.revokeSessionsForUser(updatedUser.id, tx);
      return { user: updatedUser, auditLog, previousMainAdmin };
    });

    return formatBootstrapResult(result);
  }

  const database = (injectedDatabase as DatabaseStore | undefined) ?? getRuntimeDb();

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

  return formatBootstrapResult(result);
}

function formatBootstrapResult(result: {
  user: User;
  auditLog: AuditLog;
  previousMainAdmin?: User;
  idempotent?: boolean;
}): BootstrapMainAdminResult {
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
