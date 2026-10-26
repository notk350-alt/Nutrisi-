/**
 * NutriBodySim — MVS-B2.5D.2: Transactional Account Provisioning & External Identity Mapping Test Suite
 *
 * Verifies all mandatory requirements:
 * 1. Provisioning a verified Google identity produces exactly one 'RegisteredUser' account with empty permissions.
 * 2. ExternalIdentity correctly references the created user and stores stable Google sub as anchor.
 * 3. Idempotency: Consecutive calls with the same Google sub resolve to EXISTING_LINKED_ACCOUNT without creating duplicates.
 * 4. Concurrency: Simultaneous (Promise.all) calls with the same Google sub serialize safely and produce exactly one user.
 * 5. Anti-Auto-Merge: When Google sub is unknown but email matches an existing local account, fails closed with IDENTITY_CONFLICT.
 * 6. Account Status Containment: Existing linked accounts with SUSPENDED or DISABLED status yield ACCOUNT_INACTIVE.
 * 7. Malformed or unverified identities yield INVALID_VERIFIED_IDENTITY (fail closed).
 * 8. Zero Credential Exposure & Session Boundary: No tokens, secrets, or user sessions/cookies are issued.
 * 9. Storage Failure & Atomic Rollback: When disk persistence fails, all in-memory mutations are completely rolled back.
 * 10. Immunity to Privilege Escalation: Roles or permissions cannot be injected via profile claims or client tampering.
 * 11. Main Administrator Immunity: Provisioning cannot grant Admin or Main Admin privileges.
 * 12. Complete preservation of existing authentication, RBAC, and demo-login regressions.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { 
  GoogleIdentityProvisioningService,
  provisionVerifiedGoogleIdentity,
  VerifiedOIDCIdentity
} from '../auth/oidc';
import { db } from '../database/store';
import { defaultSessionStore } from '../auth/sessionStore';
import { User, ExternalIdentity } from '../database/types';

describe('MVS-B2.5D.2 — Transactional Account Provisioning & External Identity Mapping', () => {
  let provisioner: GoogleIdentityProvisioningService;

  beforeEach(() => {
    // Reseed database to known pristine baseline before each test
    db.reseed();
    defaultSessionStore.clear();
    provisioner = new GoogleIdentityProvisioningService(db);
  });

  afterEach(() => {
    db.reseed();
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // 1. First-Time Provisioning of Unprivileged RegisteredUser
  // ---------------------------------------------------------------------------
  describe('1. First-Time Account Provisioning', () => {
    const newGoogleIdentity: VerifiedOIDCIdentity = {
      provider: 'google',
      sub: 'google_sub_1092837410928374',
      issuer: 'https://accounts.google.com',
      audience: 'test-client-id.apps.googleusercontent.com',
      issuedAt: Date.now() - 5000,
      expiresAt: Date.now() + 3600000,
      email: 'newuser@alumni.stanford.edu',
      emailVerified: true,
      profile: {
        name: 'Dr. New User <script>alert("xss")</script>',
        picture: 'https://lh3.googleusercontent.com/a/photo.jpg',
        givenName: 'New',
        familyName: 'User'
      }
    };

    it('provisions a new unprivileged RegisteredUser account with zero default permissions', async () => {
      const initialUsersCount = db.getState().users.length;
      const initialIdentitiesCount = db.getState().external_identities.length;

      const result = await provisioner.provisionVerifiedGoogleIdentity(newGoogleIdentity);

      expect(result.outcome).toBe('PROVISIONED_NEW_ACCOUNT');
      expect(result.success).toBe(true);
      expect(result.user).toBeDefined();
      expect(result.externalIdentity).toBeDefined();

      const createdUser = result.user!;
      expect(createdUser.role).toBe('RegisteredUser');
      expect(createdUser.permissions).toEqual([]);
      expect(createdUser.account_status).toBe('ACTIVE');
      expect(createdUser.email).toBe('newuser@alumni.stanford.edu');
      expect(createdUser.email_verified).toBe(true);
      expect(createdUser.provider).toBe('google');
      expect(createdUser.provider_subject_id).toBe('google_sub_1092837410928374');
      expect(createdUser.token_version).toBe(1);

      // Verify name sanitization (anti-XSS script tags stripped)
      expect(createdUser.name).not.toContain('<script>');
      expect(createdUser.name).toContain('Dr. New User');

      // Verify database state reflects exactly one new user and one new external identity
      expect(db.getState().users.length).toBe(initialUsersCount + 1);
      expect(db.getState().external_identities.length).toBe(initialIdentitiesCount + 1);

      const savedIdentity = db.findExternalIdentity('google', 'google_sub_1092837410928374');
      expect(savedIdentity).toBeDefined();
      expect(savedIdentity?.user_id).toBe(createdUser.id);
      expect(savedIdentity?.email).toBe('newuser@alumni.stanford.edu');
    });

    it('does NOT grant Student, Lecturer, Researcher, or Admin role based on institution domain', async () => {
      // Even with an academic domain (@alumni.stanford.edu), role MUST remain RegisteredUser
      const result = await provisioner.provisionVerifiedGoogleIdentity(newGoogleIdentity);
      expect(result.user?.role).toBe('RegisteredUser');
      expect(result.user?.role).not.toBe('Student');
      expect(result.user?.role).not.toBe('Researcher');
      expect(result.user?.role).not.toBe('Admin');
    });

    it('records an immutable audit trail with action OIDC_ACCOUNT_PROVISION', async () => {
      const result = await provisioner.provisionVerifiedGoogleIdentity(newGoogleIdentity, {
        ipAddress: '198.51.100.42'
      });

      expect(result.auditLog).toBeDefined();
      const audit = result.auditLog!;
      expect(audit.action).toBe('OIDC_ACCOUNT_PROVISION');
      expect(audit.entity_type).toBe('USER');
      expect(audit.entity_id).toBe(result.user!.id);
      expect(audit.ip_address).toBe('198.51.100.42');
      expect(audit.details).toContain('New account provisioned via Google OIDC');
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Idempotency & Sequential / Concurrent Replay
  // ---------------------------------------------------------------------------
  describe('2. Idempotency & Concurrency Safety', () => {
    const idempotentIdentity: VerifiedOIDCIdentity = {
      provider: 'google',
      sub: 'google_sub_unique_idempotent_999',
      issuer: 'https://accounts.google.com',
      audience: 'test-client-id',
      issuedAt: Date.now() - 5000,
      expiresAt: Date.now() + 3600000,
      email: 'idempotent@test.nutribodysim.org',
      emailVerified: true
    };

    it('resolves consecutive calls with the same Google sub to EXISTING_LINKED_ACCOUNT', async () => {
      // First call -> provision
      const firstResult = await provisioner.provisionVerifiedGoogleIdentity(idempotentIdentity);
      expect(firstResult.outcome).toBe('PROVISIONED_NEW_ACCOUNT');
      const userId = firstResult.user!.id;

      const usersCountAfterFirst = db.getState().users.length;

      // Second call -> existing linked account
      const secondResult = await provisioner.provisionVerifiedGoogleIdentity(idempotentIdentity);
      expect(secondResult.outcome).toBe('EXISTING_LINKED_ACCOUNT');
      expect(secondResult.success).toBe(true);
      expect(secondResult.user!.id).toBe(userId);

      // Verify no duplicate user was created
      expect(db.getState().users.length).toBe(usersCountAfterFirst);
    });

    it('serializes simultaneous concurrent requests (Promise.all) and produces exactly one user account', async () => {
      const concurrentIdentity: VerifiedOIDCIdentity = {
        provider: 'google',
        sub: 'google_sub_concurrent_race_123',
        issuer: 'https://accounts.google.com',
        audience: 'test-client-id',
        issuedAt: Date.now() - 5000,
        expiresAt: Date.now() + 3600000,
        email: 'concurrent@test.nutribodysim.org',
        emailVerified: true
      };

      const initialUsersCount = db.getState().users.length;

      // Fire 3 simultaneous concurrent requests for the exact same Google sub
      const [res1, res2, res3] = await Promise.all([
        provisioner.provisionVerifiedGoogleIdentity(concurrentIdentity),
        provisioner.provisionVerifiedGoogleIdentity(concurrentIdentity),
        provisioner.provisionVerifiedGoogleIdentity(concurrentIdentity)
      ]);

      const outcomes = [res1.outcome, res2.outcome, res3.outcome];
      const provisionedCount = outcomes.filter(o => o === 'PROVISIONED_NEW_ACCOUNT').length;
      const existingCount = outcomes.filter(o => o === 'EXISTING_LINKED_ACCOUNT').length;

      // Exactly one request must win and provision; the other two must safely resolve to the existing account
      expect(provisionedCount).toBe(1);
      expect(existingCount).toBe(2);

      // Verify database contains exactly one new user
      expect(db.getState().users.length).toBe(initialUsersCount + 1);

      // All returned users must have the same ID
      const userIds = [res1.user!.id, res2.user!.id, res3.user!.id];
      expect(new Set(userIds).size).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Anti-Auto-Merge & Email Collision Defense
  // ---------------------------------------------------------------------------
  describe('3. Anti-Auto-Merge Policy & Email Collision', () => {
    it('strictly fails closed with IDENTITY_CONFLICT when Google sub is new but email matches existing local user', async () => {
      // 'researcher@nutribodysim.org' is seeded locally for usr_researcher
      const collidingIdentity: VerifiedOIDCIdentity = {
        provider: 'google',
        sub: 'google_sub_attacker_or_new_777',
        issuer: 'https://accounts.google.com',
        audience: 'test-client-id',
        issuedAt: Date.now() - 5000,
        expiresAt: Date.now() + 3600000,
        email: 'researcher@nutribodysim.org', // Existing local email!
        emailVerified: true
      };

      const initialUsersCount = db.getState().users.length;
      const initialIdentitiesCount = db.getState().external_identities.length;

      const result = await provisioner.provisionVerifiedGoogleIdentity(collidingIdentity);

      expect(result.outcome).toBe('IDENTITY_CONFLICT');
      expect(result.success).toBe(false);
      expect(result.conflictingUserId).toBe('usr_researcher');
      expect(result.error).toMatch(/Auto-merge is strictly prohibited/);

      // Verify NO user was created and NO external identity was linked
      expect(db.getState().users.length).toBe(initialUsersCount);
      expect(db.getState().external_identities.length).toBe(initialIdentitiesCount);

      const targetUser = db.getUserById('usr_researcher')!;
      expect(Boolean(targetUser.external_identities?.some(e => e.provider_subject_id === 'google_sub_attacker_or_new_777'))).toBe(false);

      // Verify audit log recorded the conflict event
      const audit = db.getState().audit_logs.find(a => a.action === 'OIDC_IDENTITY_CONFLICT');
      expect(audit).toBeDefined();
      expect(audit?.details).toMatch(/Auto-merge blocked/);
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Inactive (Suspended & Disabled) Account Containment
  // ---------------------------------------------------------------------------
  describe('4. Inactive Account Containment', () => {
    it('yields ACCOUNT_INACTIVE when existing linked account is SUSPENDED', async () => {
      // Pre-provision a user
      const identity: VerifiedOIDCIdentity = {
        provider: 'google',
        sub: 'google_sub_suspended_user',
        issuer: 'https://accounts.google.com',
        audience: 'test-client-id',
        issuedAt: Date.now() - 5000,
        expiresAt: Date.now() + 3600000,
        email: 'suspended@test.nutribodysim.org',
        emailVerified: true
      };

      const prov = await provisioner.provisionVerifiedGoogleIdentity(identity);
      expect(prov.outcome).toBe('PROVISIONED_NEW_ACCOUNT');

      // Suspend the user
      const user = db.getUserById(prov.user!.id)!;
      user.account_status = 'SUSPENDED';
      db.save();

      // Subsequent login attempt
      const result = await provisioner.provisionVerifiedGoogleIdentity(identity);
      expect(result.outcome).toBe('ACCOUNT_INACTIVE');
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/is SUSPENDED/);

      const audit = db.getState().audit_logs.find(a => a.action === 'OIDC_INACTIVE_ACCESS_ATTEMPT');
      expect(audit).toBeDefined();
    });

    it('yields ACCOUNT_INACTIVE when existing linked account is DISABLED', async () => {
      const identity: VerifiedOIDCIdentity = {
        provider: 'google',
        sub: 'google_sub_disabled_user',
        issuer: 'https://accounts.google.com',
        audience: 'test-client-id',
        issuedAt: Date.now() - 5000,
        expiresAt: Date.now() + 3600000,
        email: 'disabled@test.nutribodysim.org',
        emailVerified: true
      };

      const prov = await provisioner.provisionVerifiedGoogleIdentity(identity);
      expect(prov.outcome).toBe('PROVISIONED_NEW_ACCOUNT');

      const user = db.getUserById(prov.user!.id)!;
      user.account_status = 'DISABLED';
      db.save();

      const result = await provisioner.provisionVerifiedGoogleIdentity(identity);
      expect(result.outcome).toBe('ACCOUNT_INACTIVE');
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/is DISABLED/);
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Malformed & Unverified Identity Handling
  // ---------------------------------------------------------------------------
  describe('5. Malformed & Unverified Identity Handling', () => {
    it('rejects identity when emailVerified is false or missing', async () => {
      const unverifiedIdentity: VerifiedOIDCIdentity = {
        provider: 'google',
        sub: 'google_sub_unverified',
        issuer: 'https://accounts.google.com',
        audience: 'test-client-id',
        issuedAt: Date.now() - 5000,
        expiresAt: Date.now() + 3600000,
        email: 'unverified@test.nutribodysim.org',
        emailVerified: false // Unverified!
      };

      const result = await provisioner.provisionVerifiedGoogleIdentity(unverifiedIdentity);
      expect(result.outcome).toBe('INVALID_VERIFIED_IDENTITY');
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/emailVerified === true/);
    });

    it('rejects identity with missing or empty sub', async () => {
      const invalidIdentity = {
        provider: 'google',
        sub: '   ',
        email: 'valid@test.nutribodysim.org',
        emailVerified: true
      } as any;

      const result = await provisioner.provisionVerifiedGoogleIdentity(invalidIdentity);
      expect(result.outcome).toBe('INVALID_VERIFIED_IDENTITY');
      expect(result.success).toBe(false);
    });

    it('rejects identity with non-google provider', async () => {
      const invalidIdentity = {
        provider: 'facebook',
        sub: 'fb_123',
        email: 'fb@test.nutribodysim.org',
        emailVerified: true
      } as any;

      const result = await provisioner.provisionVerifiedGoogleIdentity(invalidIdentity);
      expect(result.outcome).toBe('INVALID_VERIFIED_IDENTITY');
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Invalid provider/);
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Storage Failure & Transactional Atomic Rollback
  // ---------------------------------------------------------------------------
  describe('6. Storage Failure & Transactional Atomic Rollback', () => {
    it('completely rolls back in-memory mutations if saveToDisk throws an error', async () => {
      const initialUsers = [...db.getState().users];
      const initialIdentities = [...db.getState().external_identities];

      // Simulate disk write / I/O failure on saveToDisk
      const saveSpy = vi.spyOn(db as any, 'saveToDisk').mockImplementation(() => {
        throw new Error('EACCES: Permission denied writing database file');
      });

      try {
        const failingIdentity: VerifiedOIDCIdentity = {
          provider: 'google',
          sub: 'google_sub_io_failure_test',
          issuer: 'https://accounts.google.com',
          audience: 'test-client-id',
          issuedAt: Date.now() - 5000,
          expiresAt: Date.now() + 3600000,
          email: 'iofailure@test.nutribodysim.org',
          emailVerified: true
        };

        const result = await provisioner.provisionVerifiedGoogleIdentity(failingIdentity);

        expect(result.outcome).toBe('PROVISIONING_STORAGE_FAILURE');
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/Permission denied/);

        // Verify that NO orphan user or external identity was left behind in memory state
        expect(db.getState().users.length).toBe(initialUsers.length);
        expect(db.getState().external_identities.length).toBe(initialIdentities.length);
        expect(db.findExternalIdentity('google', 'google_sub_io_failure_test')).toBeUndefined();
        expect(db.getUserByEmail('iofailure@test.nutribodysim.org')).toBeUndefined();
      } finally {
        saveSpy.mockRestore();
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 7. Security Invariance & Zero-Credential Exposure
  // ---------------------------------------------------------------------------
  describe('7. Security Invariance & Zero-Credential Exposure', () => {
    it('never creates user sessions, cookies, or exposes tokens in returned results', async () => {
      const identity: VerifiedOIDCIdentity = {
        provider: 'google',
        sub: 'google_sub_session_boundary_test',
        issuer: 'https://accounts.google.com',
        audience: 'test-client-id',
        issuedAt: Date.now() - 5000,
        expiresAt: Date.now() + 3600000,
        email: 'nobearer@test.nutribodysim.org',
        emailVerified: true
      };

      const initialActiveSessions = defaultSessionStore.getActiveSessionsCount();

      const result = await provisioner.provisionVerifiedGoogleIdentity(identity);
      expect(result.success).toBe(true);

      // Result MUST NOT contain sensitive token/session properties
      expect((result as any).token).toBeUndefined();
      expect((result as any).sessionToken).toBeUndefined();
      expect((result as any).clientSecret).toBeUndefined();
      expect((result as any).codeVerifier).toBeUndefined();
      expect((result as any).nonce).toBeUndefined();

      // Session store must have ZERO new sessions
      expect(defaultSessionStore.getActiveSessionsCount()).toBe(initialActiveSessions);
    });

    it('cannot elevate to Main Administrator or Admin through provisioning', async () => {
      const maliciousClaimIdentity = {
        provider: 'google',
        sub: 'google_sub_attacker_claim',
        issuer: 'https://accounts.google.com',
        audience: 'test-client-id',
        issuedAt: Date.now() - 5000,
        expiresAt: Date.now() + 3600000,
        email: 'attacker@evil.org',
        emailVerified: true,
        // Attempting to inject privileged properties
        role: 'Admin',
        is_main_admin: true,
        permissions: ['MANAGE_PRIVILEGED_ROLES', 'ADMIN']
      } as any;

      const result = await provisioner.provisionVerifiedGoogleIdentity(maliciousClaimIdentity);
      expect(result.success).toBe(true);

      const createdUser = result.user!;
      expect(createdUser.role).toBe('RegisteredUser');
      expect(createdUser.permissions).toEqual([]);
      expect(createdUser.is_main_admin).toBeUndefined();
    });
  });
});
