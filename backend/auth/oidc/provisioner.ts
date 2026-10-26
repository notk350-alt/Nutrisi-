/**
 * NutriBodySim — Google Identity Provisioning & Resolution Service (MVS-B2.5D.2)
 *
 * Implements isolated, server-authoritative mapping and transactional provisioning
 * of VerifiedOIDCIdentity into local NutriBodySim accounts.
 *
 * Security Guarantees:
 * 1. Isolated Server Boundary: Strictly internal caller service; never invoked directly from browser/client request.
 * 2. Stable Anchor: Pasangan (provider='google', provider_subject_id=sub) sebagai identitas eksternal permanen.
 * 3. Anti-Auto-Merge: DILARANG KERAS menggabungkan akun lokal secara otomatis berdasarkan kesamaan email (fails closed with IDENTITY_CONFLICT).
 * 4. Least-Privilege Role: Akun baru selalu dan hanya memperoleh role 'RegisteredUser' dengan permission default [].
 * 5. Inactive Account Containment: Akun berstatus SUSPENDED atau DISABLED langsung menghasilkan ACCOUNT_INACTIVE.
 * 6. Concurrency & Idempotency: Keyed async locking per sub & per email prevents duplicate race-condition provisioning within single process.
 * 7. Zero Credential Exposure: Tidak pernah mengembalikan token, client secret, nonce, atau PKCE verifier.
 * 8. Session Boundary: Tidak membuat sesi atau cookie pengguna.
 */

import { VerifiedOIDCIdentity, IdentityProvisioningOutcome, ProvisionGoogleIdentityOptions, ProvisionGoogleIdentityResult } from './types';
import { DatabaseStore, db } from '../../database/store';
import { User, ExternalIdentity } from '../../database/types';

export class GoogleIdentityProvisioningService {
  private database: DatabaseStore;
  private locks: Map<string, Promise<void>> = new Map();

  constructor(database: DatabaseStore = db) {
    this.database = database;
  }

  /**
   * Internal mutex to serialize operations sharing the same Google sub or email
   * within this process, eliminating concurrent race-condition duplicates.
   */
  private async withKeyedLock<T>(keys: string[], action: () => Promise<T>): Promise<T> {
    while (keys.some(k => this.locks.has(k))) {
      const activeLocks = keys.map(k => this.locks.get(k)).filter(Boolean) as Promise<void>[];
      if (activeLocks.length > 0) {
        await Promise.all(activeLocks);
      }
    }

    let releaseLock!: () => void;
    const lockPromise = new Promise<void>(resolve => {
      releaseLock = resolve;
    });

    for (const key of keys) {
      this.locks.set(key, lockPromise);
    }

    try {
      return await action();
    } finally {
      for (const key of keys) {
        this.locks.delete(key);
      }
      releaseLock();
    }
  }

  /**
   * Validates structural contract of VerifiedOIDCIdentity.
   */
  private validateIdentityContract(identity: unknown): { valid: boolean; error?: string } {
    if (!identity || typeof identity !== 'object') {
      return { valid: false, error: 'Identity must be a non-null object.' };
    }

    const id = identity as Partial<VerifiedOIDCIdentity>;

    if (id.provider !== 'google') {
      return { valid: false, error: `Invalid provider '${id.provider}'. Strictly requires 'google'.` };
    }

    if (typeof id.sub !== 'string' || !id.sub.trim()) {
      return { valid: false, error: 'Identity must contain a valid, non-empty Google sub.' };
    }

    if (typeof id.email !== 'string' || !id.email.trim() || !id.email.includes('@')) {
      return { valid: false, error: 'Identity must contain a valid, non-empty email address.' };
    }

    if (id.emailVerified !== true) {
      return { valid: false, error: 'Google email verification claim must be explicitly true (emailVerified === true).' };
    }

    return { valid: true };
  }

  /**
   * Transactionally maps a verified Google identity to an existing account,
   * detects email collisions, or provisions an unprivileged RegisteredUser account.
   */
  public async provisionVerifiedGoogleIdentity(
    identity: VerifiedOIDCIdentity,
    options?: ProvisionGoogleIdentityOptions
  ): Promise<ProvisionGoogleIdentityResult> {
    // 1. Contract Validation
    const validation = this.validateIdentityContract(identity);
    if (!validation.valid) {
      return {
        outcome: 'INVALID_VERIFIED_IDENTITY',
        success: false,
        error: validation.error || 'Identity input failed structural validation.'
      };
    }

    const trimmedSub = identity.sub.trim();
    const normalizedEmail = identity.email!.trim().toLowerCase();

    const subLockKey = `sub:${trimmedSub}`;
    const emailLockKey = `email:${normalizedEmail}`;

    // 2. Concurrency Serialization
    return this.withKeyedLock([subLockKey, emailLockKey], async () => {
      // 3. Search for Existing External Identity
      const existingIdentity = this.database.findExternalIdentity('google', trimmedSub);

      if (existingIdentity) {
        const user = this.database.getUserById(existingIdentity.user_id);

        if (!user) {
          this.database.logAudit(
            'SYSTEM',
            'OIDC_IDENTITY_CONFLICT',
            'EXTERNAL_IDENTITY',
            trimmedSub,
            `Dangling Google external identity found for sub '${trimmedSub}': user '${existingIdentity.user_id}' does not exist in registry.`,
            options?.ipAddress
          );

          return {
            outcome: 'IDENTITY_CONFLICT',
            success: false,
            error: `Integrity anomaly: External identity (google, ${trimmedSub}) references non-existent user '${existingIdentity.user_id}'.`
          };
        }

        // Account status check
        if (user.account_status && user.account_status !== 'ACTIVE') {
          this.database.logAudit(
            user.id,
            'OIDC_INACTIVE_ACCESS_ATTEMPT',
            'USER',
            user.id,
            `OIDC login attempt for Google sub '${trimmedSub}' rejected because account is ${user.account_status}.`,
            options?.ipAddress
          );

          return {
            outcome: 'ACCOUNT_INACTIVE',
            success: false,
            user,
            externalIdentity: existingIdentity,
            error: `User account '${user.id}' is ${user.account_status}. Access is forbidden.`
          };
        }

        // Maintain claim anomaly audit if Google email changed, but NEVER alter local user primary email
        if (existingIdentity.email && existingIdentity.email.toLowerCase() !== normalizedEmail) {
          this.database.logAudit(
            user.id,
            'OIDC_CLAIM_ANOMALY',
            'USER',
            user.id,
            `Google email claim changed from '${existingIdentity.email}' to '${normalizedEmail}' for sub '${trimmedSub}'. Primary user email preserved.`,
            options?.ipAddress
          );
          existingIdentity.email = normalizedEmail;
          this.database.save();
        }

        return {
          outcome: 'EXISTING_LINKED_ACCOUNT',
          success: true,
          user,
          externalIdentity: existingIdentity
        };
      }

      // 4. Check for Email Collision on Local Accounts (Anti-Auto-Merge Policy)
      const conflictingUser = this.database.getUserByEmail(normalizedEmail);
      if (conflictingUser) {
        this.database.logAudit(
          conflictingUser.id,
          'OIDC_IDENTITY_CONFLICT',
          'USER',
          conflictingUser.id,
          `Google OIDC login attempt for email '${normalizedEmail}' conflicted with existing local account '${conflictingUser.id}'. Auto-merge blocked. Explicit linking required.`,
          options?.ipAddress
        );

        return {
          outcome: 'IDENTITY_CONFLICT',
          success: false,
          conflictingUserId: conflictingUser.id,
          error: `Identity conflict: Email '${normalizedEmail}' matches an existing local account. Auto-merge is strictly prohibited. Explicit account linking required.`
        };
      }

      // 5. Transactional Provisioning of Unprivileged RegisteredUser
      try {
        const provisionResult = this.database.provisionGoogleUser({
          identity: {
            provider: 'google',
            sub: trimmedSub,
            email: normalizedEmail,
            emailVerified: true,
            profile: identity.profile
          },
          ipAddress: options?.ipAddress,
          currentTime: options?.currentTime
        });

        return {
          outcome: 'PROVISIONED_NEW_ACCOUNT',
          success: true,
          user: provisionResult.user,
          externalIdentity: provisionResult.externalIdentity,
          auditLog: provisionResult.auditLog
        };
      } catch (provisionErr: any) {
        try {
          this.database.logAudit(
            'SYSTEM',
            'OIDC_STORAGE_FAILURE',
            'USER',
            'UNKNOWN',
            `Failed to provision Google account for sub '${trimmedSub}' (${normalizedEmail}): ${provisionErr?.message || 'Storage error'}.`,
            options?.ipAddress
          );
        } catch {
          // If storage failure prevents audit write to disk, fail closed safely
        }

        return {
          outcome: 'PROVISIONING_STORAGE_FAILURE',
          success: false,
          error: `Provisioning storage failure: ${provisionErr?.message || 'Internal store error'}`
        };
      }
    });
  }
}

export const defaultGoogleProvisioner = new GoogleIdentityProvisioningService();

/**
 * Convenience function to provision a verified Google identity using default service.
 */
export async function provisionVerifiedGoogleIdentity(
  identity: VerifiedOIDCIdentity,
  options?: ProvisionGoogleIdentityOptions
): Promise<ProvisionGoogleIdentityResult> {
  return defaultGoogleProvisioner.provisionVerifiedGoogleIdentity(identity, options);
}
