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
 * 6. Concurrency & Idempotency: Repository provisioning relies on transactional unique constraints; legacy JSON tests retain keyed locks.
 * 7. Zero Credential Exposure: Tidak pernah mengembalikan token, client secret, nonce, atau PKCE verifier.
 * 8. Session Boundary: Tidak membuat sesi atau cookie pengguna.
 */

import { VerifiedOIDCIdentity, ProvisionGoogleIdentityOptions, ProvisionGoogleIdentityResult } from './types';
import type { DatabaseStore } from '../../database/store';
import type { IDatabaseRepositories } from '../../database/contracts';
import { getRuntimeDb, getRuntimeRepositories, getRuntimeSelection, resolveDatabaseProvider } from '../../database/runtime';
import { User, ExternalIdentity } from '../../database/types';
import crypto from 'crypto';

export class GoogleIdentityProvisioningService {
  private readonly database?: DatabaseStore | IDatabaseRepositories;
  private locks: Map<string, Promise<void>> = new Map();

  constructor(database?: DatabaseStore | IDatabaseRepositories) {
    this.database = database;
  }

  private get repositories(): IDatabaseRepositories | undefined {
    const runtime = getRuntimeSelection();
    if (resolveDatabaseProvider() === 'postgres') {
      if (runtime?.provider !== 'postgres') {
        throw new Error('PostgreSQL runtime must be initialized before OIDC provisioning.');
      }
      if (this.database && this.database !== runtime.repositories) {
        throw new Error('OIDC provisioning must use the initialized PostgreSQL repositories.');
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
   * Legacy JSON-store serialization. Repository-backed provisioning relies on
   * transactional unique constraints instead of this process-local lock.
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

    const repositories = this.repositories;
    if (repositories) {
      return this.provisionWithRepositories(repositories, identity, trimmedSub, normalizedEmail, options);
    }

    const subLockKey = `sub:${trimmedSub}`;
    const emailLockKey = `email:${normalizedEmail}`;

    // 2. Concurrency Serialization
    return this.withKeyedLock([subLockKey, emailLockKey], async () => {
      // 3. Search for Existing External Identity
      const existingIdentity = this.store.findExternalIdentity('google', trimmedSub);

      if (existingIdentity) {
        const user = this.store.getUserById(existingIdentity.user_id);

        if (!user) {
          this.store.logAudit(
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
          this.store.logAudit(
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
          this.store.logAudit(
            user.id,
            'OIDC_CLAIM_ANOMALY',
            'USER',
            user.id,
            `Google email claim changed from '${existingIdentity.email}' to '${normalizedEmail}' for sub '${trimmedSub}'. Primary user email preserved.`,
            options?.ipAddress
          );
          existingIdentity.email = normalizedEmail;
          this.store.save();
        }

        return {
          outcome: 'EXISTING_LINKED_ACCOUNT',
          success: true,
          user,
          externalIdentity: existingIdentity
        };
      }

      // 4. Check for Email Collision on Local Accounts (Anti-Auto-Merge Policy)
      const conflictingUser = this.store.getUserByEmail(normalizedEmail);
      if (conflictingUser) {
        this.store.logAudit(
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
        const provisionResult = this.store.provisionGoogleUser({
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
          this.store.logAudit(
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

  private async provisionWithRepositories(
    repositories: IDatabaseRepositories,
    identity: VerifiedOIDCIdentity,
    trimmedSub: string,
    normalizedEmail: string,
    options?: ProvisionGoogleIdentityOptions
  ): Promise<ProvisionGoogleIdentityResult> {
    try {
      return await repositories.unitOfWork.runInTransaction(async tx => {
        const existingIdentity = await repositories.externalIdentities.findByProviderSubject('google', trimmedSub, tx);
        if (existingIdentity) {
          const user = await repositories.users.findById(existingIdentity.user_id, tx);
          if (!user) {
            const details = `Dangling Google external identity found for sub '${trimmedSub}': user '${existingIdentity.user_id}' does not exist in registry.`;
            const auditLog = await repositories.auditLogs.appendLog({
              user_id: 'SYSTEM',
              user_name: 'SYSTEM',
              action: 'OIDC_IDENTITY_CONFLICT',
              entity_type: 'EXTERNAL_IDENTITY',
              entity_id: trimmedSub,
              details,
              ip_address: options?.ipAddress
            }, tx);
            return {
              outcome: 'IDENTITY_CONFLICT',
              success: false,
              error: `Integrity anomaly: External identity (google, ${trimmedSub}) references non-existent user '${existingIdentity.user_id}'.`,
              auditLog
            };
          }

          if (user.account_status && user.account_status !== 'ACTIVE') {
            const auditLog = await repositories.auditLogs.appendLog({
              user_id: user.id,
              user_name: user.name,
              action: 'OIDC_INACTIVE_ACCESS_ATTEMPT',
              entity_type: 'USER',
              entity_id: user.id,
              details: `OIDC login attempt for Google sub '${trimmedSub}' rejected because account is ${user.account_status}.`,
              ip_address: options?.ipAddress
            }, tx);
            return {
              outcome: 'ACCOUNT_INACTIVE',
              success: false,
              user,
              externalIdentity: existingIdentity,
              auditLog,
              error: `User account '${user.id}' is ${user.account_status}. Access is forbidden.`
            };
          }

          if (existingIdentity.email && existingIdentity.email.toLowerCase() !== normalizedEmail) {
            const auditLog = await repositories.auditLogs.appendLog({
              user_id: user.id,
              user_name: user.name,
              action: 'OIDC_CLAIM_ANOMALY',
              entity_type: 'USER',
              entity_id: user.id,
              details: `Google email claim changed from '${existingIdentity.email}' to '${normalizedEmail}' for sub '${trimmedSub}'. Primary user email preserved.`,
              ip_address: options?.ipAddress
            }, tx);
            const updatedIdentity: ExternalIdentity = { ...existingIdentity, email: normalizedEmail };
            await repositories.externalIdentities.unlinkIdentity('google', trimmedSub, tx);
            await repositories.externalIdentities.linkIdentity(updatedIdentity, tx);
            return {
              outcome: 'EXISTING_LINKED_ACCOUNT',
              success: true,
              user,
              externalIdentity: updatedIdentity,
              auditLog
            };
          }

          return { outcome: 'EXISTING_LINKED_ACCOUNT', success: true, user, externalIdentity: existingIdentity };
        }

        const conflictingUser = await repositories.users.findByEmail(normalizedEmail, tx);
        if (conflictingUser) {
          const details = `Google OIDC login attempt for email '${normalizedEmail}' conflicted with existing local account '${conflictingUser.id}'. Auto-merge blocked. Explicit linking required.`;
          const auditLog = await repositories.auditLogs.appendLog({
            user_id: conflictingUser.id,
            user_name: conflictingUser.name,
            action: 'OIDC_IDENTITY_CONFLICT',
            entity_type: 'USER',
            entity_id: conflictingUser.id,
            details,
            ip_address: options?.ipAddress
          }, tx);
          return {
            outcome: 'IDENTITY_CONFLICT',
            success: false,
            conflictingUserId: conflictingUser.id,
            auditLog,
            error: `Identity conflict: Email '${normalizedEmail}' matches an existing local account. Auto-merge is strictly prohibited. Explicit account linking required.`
          };
        }

        const rawName = identity.profile?.name?.trim() ||
          [identity.profile?.givenName, identity.profile?.familyName].filter(Boolean).join(' ').trim() ||
          normalizedEmail.split('@')[0] || 'Google User';
        const sanitizedName = rawName.replace(/<[^>]*>/g, '').replace(/[\x00-\x1F\x7F]/g, '').trim().substring(0, 100);
        const picture = identity.profile?.picture?.trim();
        const now = options?.currentTime ? new Date(options.currentTime).toISOString() : new Date().toISOString();
        const userId = `usr_google_${crypto.randomBytes(8).toString('hex')}`;
        const user: User = {
          id: userId,
          user_id: userId,
          email: normalizedEmail,
          name: sanitizedName,
          display_name: sanitizedName,
          role: 'RegisteredUser',
          permissions: [],
          avatar_url: picture?.startsWith('https://') ? picture.substring(0, 500) : undefined,
          created_at: now,
          updated_at: now,
          last_login_at: now,
          account_status: 'ACTIVE',
          email_verified: true,
          provider: 'google',
          provider_subject_id: trimmedSub,
          token_version: 1
        };
        const externalIdentity: ExternalIdentity = {
          provider: 'google',
          provider_subject_id: trimmedSub,
          user_id: userId,
          email: normalizedEmail,
          email_verified: true,
          linked_at: now
        };
        const createdUser = await repositories.users.create(user, tx);
        await repositories.externalIdentities.linkIdentity(externalIdentity, tx);
        const auditLog = await repositories.auditLogs.appendLog({
          user_id: userId,
          user_name: sanitizedName,
          action: 'OIDC_ACCOUNT_PROVISION',
          entity_type: 'USER',
          entity_id: userId,
          details: `New account provisioned via Google OIDC for ${sanitizedName} (${normalizedEmail}) with unprivileged role RegisteredUser.`,
          ip_address: options?.ipAddress,
          timestamp: now
        }, tx);
        return {
          outcome: 'PROVISIONED_NEW_ACCOUNT',
          success: true,
          user: createdUser,
          externalIdentity,
          auditLog
        };
      });
    } catch (provisionErr: any) {
      try {
        const linkedIdentity = await repositories.externalIdentities.findByProviderSubject('google', trimmedSub);
        if (linkedIdentity) {
          const user = await repositories.users.findById(linkedIdentity.user_id);
          if (user) {
            if (user.account_status && user.account_status !== 'ACTIVE') {
              return {
                outcome: 'ACCOUNT_INACTIVE',
                success: false,
                user,
                externalIdentity: linkedIdentity,
                error: `User account '${user.id}' is ${user.account_status}. Access is forbidden.`
              };
            }
            return { outcome: 'EXISTING_LINKED_ACCOUNT', success: true, user, externalIdentity: linkedIdentity };
          }
        }

        const conflictingUser = await repositories.users.findByEmail(normalizedEmail);
        if (conflictingUser) {
          await repositories.unitOfWork.runInTransaction(async tx => {
            await repositories.auditLogs.appendLog({
              user_id: conflictingUser.id,
              user_name: conflictingUser.name,
              action: 'OIDC_IDENTITY_CONFLICT',
              entity_type: 'USER',
              entity_id: conflictingUser.id,
              details: `Google OIDC login attempt for email '${normalizedEmail}' conflicted with existing local account '${conflictingUser.id}'. Auto-merge blocked. Explicit linking required.`,
              ip_address: options?.ipAddress
            }, tx);
          });
          return {
            outcome: 'IDENTITY_CONFLICT',
            success: false,
            conflictingUserId: conflictingUser.id,
            error: `Identity conflict: Email '${normalizedEmail}' matches an existing local account. Auto-merge is strictly prohibited. Explicit account linking required.`
          };
        }
      } catch {
        // A failed transaction cannot be treated as a successful identity resolution.
      }

      try {
        await repositories.unitOfWork.runInTransaction(async tx => {
          await repositories.auditLogs.appendLog({
            user_id: 'SYSTEM',
            user_name: 'SYSTEM',
            action: 'OIDC_STORAGE_FAILURE',
            entity_type: 'USER',
            entity_id: 'UNKNOWN',
            details: `Failed to provision Google account for sub '${trimmedSub}' (${normalizedEmail}): ${provisionErr?.message || 'Storage error'}.`,
            ip_address: options?.ipAddress
          }, tx);
        });
      } catch {
        // Fail closed when the repository is unavailable.
      }
      return {
        outcome: 'PROVISIONING_STORAGE_FAILURE',
        success: false,
        error: `Provisioning storage failure: ${provisionErr?.message || 'Internal store error'}`
      };
    }
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
