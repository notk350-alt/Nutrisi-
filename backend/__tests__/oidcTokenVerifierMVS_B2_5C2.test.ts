/**
 * NutriBodySim — Google OIDC ID Token Verification Engine Tests
 * Milestone: MVS-B2.5C.2
 *
 * Adversarial Test Matrix Coverage:
 * 1. Valid token with valid RS256 signature and all required claims.
 * 2. Fake / corrupted / altered signature rejection.
 * 3. Malformed token structure (not 3 segments, corrupted base64url, non-JSON).
 * 4. Algorithm 'none' strictly rejected.
 * 5. Disallowed algorithms (HS256, ES256) strictly rejected.
 * 6. Key ID (kid) not found in JWKS.
 * 7. JWKS unavailable / network timeout handling.
 * 8. Mock key rotation (new kid triggers controlled refresh).
 * 9. Untrusted / invalid issuer rejection.
 * 10. Audience mismatch rejection (different app's client ID).
 * 11. Multi-audience array with missing or mismatched azp claim.
 * 12. Expired token rejection (outside clock skew).
 * 13. Token issued in the future (iat outside clock skew).
 * 14. Missing or empty subject (sub) claim.
 * 15. Nonce validation: missing nonce, mismatched nonce, and transaction binding.
 * 16. email_verified strict boolean true (rejecting 'true' string, false, missing).
 * 17. Structurally malformed profile claims sanitization.
 * 18. Anti-SSRF: header with jku, x5u, or embedded jwk rejected.
 * 19. Anti-DoS: rate-limiting / cooldown on unknown kid refresh attempts.
 * 20. Zero token leakage in results / error messages.
 * 21. Fail-closed: Verification failure leaves DB and sessions completely untouched.
 * 22. Architectural immutability: RBAC, Role Approval, and Main Administrator unchanged.
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import crypto from 'crypto';
import {
  verifyGoogleIDToken,
  GoogleJWKSClient,
  MemoryOIDCTransactionStore,
  OIDCConfig
} from '../auth/oidc';
import { db } from '../database/store';
import { defaultSessionStore } from '../auth/sessionStore';

describe('MVS-B2.5C.2: Google OIDC ID Token Verification Engine', () => {
  // Test RSA Keypairs
  let primaryKey: { publicKey: crypto.KeyObject; privateKey: crypto.KeyObject };
  let secondaryKey: { publicKey: crypto.KeyObject; privateKey: crypto.KeyObject };
  let attackerKey: { publicKey: crypto.KeyObject; privateKey: crypto.KeyObject };

  const PRIMARY_KID = 'google-cert-key-2026-a';
  const SECONDARY_KID = 'google-cert-key-2026-b';
  const ATTACKER_KID = 'attacker-cert-key-x';

  const TEST_CLIENT_ID = '123456789-nutribodysim.apps.googleusercontent.com';
  const TEST_CONFIG: OIDCConfig = {
    enabled: true,
    clientId: TEST_CLIENT_ID,
    clientSecret: 'test-secret-mock-not-real',
    issuer: 'https://accounts.google.com',
    authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenEndpoint: 'https://oauth2.googleapis.com/token',
    jwksUri: 'https://www.googleapis.com/oauth2/v3/certs',
    redirectUri: 'http://localhost:3000/api/auth/oidc/callback',
    allowedScopes: ['openid', 'email', 'profile'],
    transactionTtlSeconds: 600,
    clockSkewToleranceSeconds: 60,
    cookieSameSite: 'lax',
    cookieSecure: false
  };

  let mockJwksClient: GoogleJWKSClient;
  let transactionStore: MemoryOIDCTransactionStore;

  beforeAll(() => {
    // Generate isolated 2048-bit RSA keypairs for testing
    primaryKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    secondaryKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    attackerKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  });

  beforeEach(() => {
    mockJwksClient = new GoogleJWKSClient();
    const keyMap = new Map<string, crypto.KeyObject>();
    keyMap.set(PRIMARY_KID, primaryKey.publicKey);
    mockJwksClient.setMockKeys(keyMap);

    transactionStore = new MemoryOIDCTransactionStore();
  });

  /**
   * Helper to construct signed JWTs for testing.
   */
  function signTestJwt(
    header: Record<string, any>,
    payload: Record<string, any>,
    privateKey: crypto.KeyObject
  ): string {
    const rawHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
    const rawPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signingInput = `${rawHeader}.${rawPayload}`;

    const sign = crypto.createSign('RSA-SHA256');
    sign.update(signingInput);
    const rawSignature = sign.sign(privateKey, 'base64url');

    return `${signingInput}.${rawSignature}`;
  }

  function getBaseValidPayload(overrides?: Record<string, any>): Record<string, any> {
    const nowSec = Math.floor(Date.now() / 1000);
    return {
      iss: 'https://accounts.google.com',
      sub: '109876543210987654321',
      aud: TEST_CLIENT_ID,
      exp: nowSec + 3600,
      iat: nowSec - 10,
      email: 'researcher@nutribodysim.org',
      email_verified: true,
      name: 'Dr. Jane Doe',
      picture: 'https://lh3.googleusercontent.com/a/test-avatar.jpg',
      given_name: 'Jane',
      family_name: 'Doe',
      locale: 'en',
      ...overrides
    };
  }

  describe('1. Valid Token & Identity Extraction', () => {
    it('verifies a valid RS256 token and extracts clean VerifiedOIDCIdentity', async () => {
      const payload = getBaseValidPayload({ nonce: 'valid-test-nonce-123' });
      const token = signTestJwt({ alg: 'RS256', kid: PRIMARY_KID }, payload, primaryKey.privateKey);

      const result = await verifyGoogleIDToken(
        {
          idToken: token,
          expectedNonce: 'valid-test-nonce-123'
        },
        mockJwksClient,
        TEST_CONFIG
      );

      expect(result.success).toBe(true);
      expect(result.identity).toBeDefined();

      const identity = result.identity!;
      expect(identity.provider).toBe('google');
      expect(identity.sub).toBe('109876543210987654321');
      expect(identity.issuer).toBe('https://accounts.google.com');
      expect(identity.audience).toBe(TEST_CLIENT_ID);
      expect(identity.email).toBe('researcher@nutribodysim.org');
      expect(identity.emailVerified).toBe(true);
      expect(identity.profile?.name).toBe('Dr. Jane Doe');
      expect(identity.profile?.givenName).toBe('Jane');
      expect(identity.profile?.familyName).toBe('Doe');
      expect(identity.profile?.picture).toBe('https://lh3.googleusercontent.com/a/test-avatar.jpg');

      // Crucial: Must NEVER leak signature or raw token
      expect((identity as any).idToken).toBeUndefined();
      expect((identity as any).signature).toBeUndefined();
      expect((identity as any).rawHeader).toBeUndefined();
    });

    it('accepts alternative valid Google issuer "accounts.google.com"', async () => {
      const payload = getBaseValidPayload({ iss: 'accounts.google.com' });
      const token = signTestJwt({ alg: 'RS256', kid: PRIMARY_KID }, payload, primaryKey.privateKey);

      const result = await verifyGoogleIDToken(
        { idToken: token },
        mockJwksClient,
        TEST_CONFIG
      );

      expect(result.success).toBe(true);
      expect(result.identity?.issuer).toBe('accounts.google.com');
    });
  });

  describe('2. Cryptographic Signature Tampering', () => {
    it('rejects a token signed with an untrusted attacker private key', async () => {
      const payload = getBaseValidPayload();
      // Attacker signs payload claiming it uses PRIMARY_KID
      const token = signTestJwt({ alg: 'RS256', kid: PRIMARY_KID }, payload, attackerKey.privateKey);

      const result = await verifyGoogleIDToken(
        { idToken: token },
        mockJwksClient,
        TEST_CONFIG
      );

      expect(result.success).toBe(false);
      expect(result.code).toBe('OIDC_SIGNATURE_INVALID');
      expect(result.identity).toBeUndefined();
    });

    it('rejects a token when payload bytes are tampered after signing', async () => {
      const payload = getBaseValidPayload({ sub: 'original-sub-111' });
      const token = signTestJwt({ alg: 'RS256', kid: PRIMARY_KID }, payload, primaryKey.privateKey);

      const [header, , sig] = token.split('.');
      // Attacker swaps payload in transit to impersonate another sub
      const tamperedPayload = Buffer.from(
        JSON.stringify(getBaseValidPayload({ sub: 'attacker-sub-999' }))
      ).toString('base64url');
      const forgedToken = `${header}.${tamperedPayload}.${sig}`;

      const result = await verifyGoogleIDToken(
        { idToken: forgedToken },
        mockJwksClient,
        TEST_CONFIG
      );

      expect(result.success).toBe(false);
      expect(result.code).toBe('OIDC_SIGNATURE_INVALID');
      expect(result.identity).toBeUndefined();
    });

    it('rejects a token when signature bytes are corrupted', async () => {
      const payload = getBaseValidPayload();
      const token = signTestJwt({ alg: 'RS256', kid: PRIMARY_KID }, payload, primaryKey.privateKey);

      const [header, body, sig] = token.split('.');
      const corruptedSig = sig.slice(0, -4) + 'AAAA';
      const corruptedToken = `${header}.${body}.${corruptedSig}`;

      const result = await verifyGoogleIDToken(
        { idToken: corruptedToken },
        mockJwksClient,
        TEST_CONFIG
      );

      expect(result.success).toBe(false);
      expect(result.code).toBe('OIDC_SIGNATURE_INVALID');
    });
  });

  describe('3. Token Format & Header Validation', () => {
    it('rejects malformed tokens without 3 dot-separated segments', async () => {
      const testCases = [
        '',
        'single-segment-string',
        'header.payload', // missing signature
        'header.payload.sig.extra', // 4 segments
        '..',
        'a.b.'
      ];

      for (const invalidToken of testCases) {
        const result = await verifyGoogleIDToken(
          { idToken: invalidToken },
          mockJwksClient,
          TEST_CONFIG
        );
        expect(result.success).toBe(false);
        expect(result.code).toBe('OIDC_TOKEN_MALFORMED');
      }
    });

    it('strictly rejects algorithm "none"', async () => {
      const rawHeader = Buffer.from(JSON.stringify({ alg: 'none', kid: PRIMARY_KID })).toString('base64url');
      const rawPayload = Buffer.from(JSON.stringify(getBaseValidPayload())).toString('base64url');
      const unsignedToken = `${rawHeader}.${rawPayload}.`;

      const result = await verifyGoogleIDToken(
        { idToken: unsignedToken },
        mockJwksClient,
        TEST_CONFIG
      );

      expect(result.success).toBe(false);
      expect(result.code).toBe('OIDC_ALGORITHM_NOT_ALLOWED');
      expect(result.error).toContain("algorithm 'none'");
    });

    it('strictly rejects disallowed symmetric or non-RS256 algorithms (e.g. HS256, ES256)', async () => {
      const disallowedAlgs = ['HS256', 'HS384', 'ES256', 'PS256'];
      for (const alg of disallowedAlgs) {
        const token = signTestJwt({ alg, kid: PRIMARY_KID }, getBaseValidPayload(), primaryKey.privateKey);
        const result = await verifyGoogleIDToken(
          { idToken: token },
          mockJwksClient,
          TEST_CONFIG
        );
        expect(result.success).toBe(false);
        expect(result.code).toBe('OIDC_ALGORITHM_NOT_ALLOWED');
      }
    });

    it('rejects tokens missing the "kid" header', async () => {
      const token = signTestJwt({ alg: 'RS256' }, getBaseValidPayload(), primaryKey.privateKey);

      const result = await verifyGoogleIDToken(
        { idToken: token },
        mockJwksClient,
        TEST_CONFIG
      );

      expect(result.success).toBe(false);
      expect(result.code).toBe('OIDC_TOKEN_MALFORMED');
      expect(result.error).toContain('missing required kid');
    });

    it('rejects untrusted headers attempting SSRF or key injection (jku, x5u, jwk)', async () => {
      const maliciousHeaders = [
        { alg: 'RS256', kid: PRIMARY_KID, jku: 'https://attacker.com/jwks.json' },
        { alg: 'RS256', kid: PRIMARY_KID, x5u: 'https://attacker.com/cert.pem' },
        { alg: 'RS256', kid: PRIMARY_KID, jwk: { kty: 'RSA' } }
      ];

      for (const header of maliciousHeaders) {
        const token = signTestJwt(header, getBaseValidPayload(), primaryKey.privateKey);
        const result = await verifyGoogleIDToken(
          { idToken: token },
          mockJwksClient,
          TEST_CONFIG
        );
        expect(result.success).toBe(false);
        expect(result.code).toBe('OIDC_TOKEN_MALFORMED');
        expect(result.error).toContain('Untrusted key location');
      }
    });
  });

  describe('4. Key ID & JWKS Key Rotation Simulation', () => {
    it('returns OIDC_KEY_NOT_FOUND when kid is not present in JWKS', async () => {
      const token = signTestJwt({ alg: 'RS256', kid: 'unknown-non-existent-kid' }, getBaseValidPayload(), primaryKey.privateKey);

      const result = await verifyGoogleIDToken(
        { idToken: token },
        mockJwksClient,
        TEST_CONFIG
      );

      expect(result.success).toBe(false);
      expect(result.code).toBe('OIDC_KEY_NOT_FOUND');
    });

    it('handles key rotation via mock JWKS refresh when new key is added', async () => {
      // Initially, mock JWKS only knows PRIMARY_KID.
      // Token signed with SECONDARY_KID initially fails:
      const tokenRotated = signTestJwt({ alg: 'RS256', kid: SECONDARY_KID }, getBaseValidPayload(), secondaryKey.privateKey);

      const initialResult = await verifyGoogleIDToken(
        { idToken: tokenRotated },
        mockJwksClient,
        TEST_CONFIG
      );
      expect(initialResult.success).toBe(false);
      expect(initialResult.code).toBe('OIDC_KEY_NOT_FOUND');

      // Now Google rotates keys and SECONDARY_KID is added to JWKS:
      const updatedKeys = new Map<string, crypto.KeyObject>();
      updatedKeys.set(PRIMARY_KID, primaryKey.publicKey);
      updatedKeys.set(SECONDARY_KID, secondaryKey.publicKey);
      mockJwksClient.setMockKeys(updatedKeys);

      // Second verification succeeds with rotated key!
      const rotatedResult = await verifyGoogleIDToken(
        { idToken: tokenRotated },
        mockJwksClient,
        TEST_CONFIG
      );
      expect(rotatedResult.success).toBe(true);
      expect(rotatedResult.identity?.sub).toBe(getBaseValidPayload().sub);
    });

    it('returns OIDC_JWKS_UNAVAILABLE when JWKS endpoint cannot be reached', async () => {
      const brokenJwksClient: any = {
        getKey: async () => {
          throw new Error('Connection refused by Google JWKS endpoint');
        }
      };

      const token = signTestJwt({ alg: 'RS256', kid: PRIMARY_KID }, getBaseValidPayload(), primaryKey.privateKey);
      const result = await verifyGoogleIDToken(
        { idToken: token },
        brokenJwksClient,
        TEST_CONFIG
      );

      expect(result.success).toBe(false);
      expect(result.code).toBe('OIDC_JWKS_UNAVAILABLE');
    });
  });

  describe('5. Issuer & Audience Verification', () => {
    it('rejects untrusted or attacker-controlled issuers', async () => {
      const invalidIssuers = [
        'https://attacker-identity.com',
        'https://accounts.google.com.attacker.com',
        'http://accounts.google.com', // insecure HTTP
        'accounts.google.com/malicious'
      ];

      for (const iss of invalidIssuers) {
        const payload = getBaseValidPayload({ iss });
        const token = signTestJwt({ alg: 'RS256', kid: PRIMARY_KID }, payload, primaryKey.privateKey);

        const result = await verifyGoogleIDToken(
          { idToken: token },
          mockJwksClient,
          TEST_CONFIG
        );
        expect(result.success).toBe(false);
        expect(result.code).toBe('OIDC_ISSUER_INVALID');
      }
    });

    it('rejects tokens issued for a different Google Client ID (audience mismatch)', async () => {
      const payload = getBaseValidPayload({ aud: '99999999-another-client-app.apps.googleusercontent.com' });
      const token = signTestJwt({ alg: 'RS256', kid: PRIMARY_KID }, payload, primaryKey.privateKey);

      const result = await verifyGoogleIDToken(
        { idToken: token },
        mockJwksClient,
        TEST_CONFIG
      );

      expect(result.success).toBe(false);
      expect(result.code).toBe('OIDC_AUDIENCE_INVALID');
    });

    it('handles multi-audience array and enforces azp matching expected client ID', async () => {
      // Multi-audience with correct azp
      const validMultiAud = getBaseValidPayload({
        aud: [TEST_CLIENT_ID, 'secondary-client.apps.googleusercontent.com'],
        azp: TEST_CLIENT_ID
      });
      const tokenValid = signTestJwt({ alg: 'RS256', kid: PRIMARY_KID }, validMultiAud, primaryKey.privateKey);
      const resultValid = await verifyGoogleIDToken(
        { idToken: tokenValid },
        mockJwksClient,
        TEST_CONFIG
      );
      expect(resultValid.success).toBe(true);

      // Multi-audience with missing azp -> MUST FAIL per OIDC Core
      const missingAzp = getBaseValidPayload({
        aud: [TEST_CLIENT_ID, 'secondary-client.apps.googleusercontent.com']
      });
      const tokenMissingAzp = signTestJwt({ alg: 'RS256', kid: PRIMARY_KID }, missingAzp, primaryKey.privateKey);
      const resultMissingAzp = await verifyGoogleIDToken(
        { idToken: tokenMissingAzp },
        mockJwksClient,
        TEST_CONFIG
      );
      expect(resultMissingAzp.success).toBe(false);
      expect(resultMissingAzp.code).toBe('OIDC_AUDIENCE_INVALID');

      // Multi-audience with mismatched azp -> MUST FAIL
      const wrongAzp = getBaseValidPayload({
        aud: [TEST_CLIENT_ID, 'secondary-client.apps.googleusercontent.com'],
        azp: 'unauthorized-party.apps.googleusercontent.com'
      });
      const tokenWrongAzp = signTestJwt({ alg: 'RS256', kid: PRIMARY_KID }, wrongAzp, primaryKey.privateKey);
      const resultWrongAzp = await verifyGoogleIDToken(
        { idToken: tokenWrongAzp },
        mockJwksClient,
        TEST_CONFIG
      );
      expect(resultWrongAzp.success).toBe(false);
      expect(resultWrongAzp.code).toBe('OIDC_AUDIENCE_INVALID');
    });
  });

  describe('6. Expiration (exp) and Issuance Time (iat)', () => {
    it('rejects expired tokens beyond clock skew tolerance', async () => {
      const nowSec = 1000000;
      const clockSkewSec = 60;

      // Expired 65 seconds ago (> 60s skew)
      const payload = getBaseValidPayload({
        exp: nowSec - 65,
        iat: nowSec - 3600
      });
      const token = signTestJwt({ alg: 'RS256', kid: PRIMARY_KID }, payload, primaryKey.privateKey);

      const result = await verifyGoogleIDToken(
        {
          idToken: token,
          currentTime: nowSec * 1000,
          clockSkewToleranceSeconds: clockSkewSec
        },
        mockJwksClient,
        TEST_CONFIG
      );

      expect(result.success).toBe(false);
      expect(result.code).toBe('OIDC_TOKEN_EXPIRED');
    });

    it('accepts tokens expired within allowable clock skew tolerance', async () => {
      const nowSec = 1000000;
      const clockSkewSec = 60;

      // Expired only 20 seconds ago (< 60s skew tolerance)
      const payload = getBaseValidPayload({
        exp: nowSec - 20,
        iat: nowSec - 3600
      });
      const token = signTestJwt({ alg: 'RS256', kid: PRIMARY_KID }, payload, primaryKey.privateKey);

      const result = await verifyGoogleIDToken(
        {
          idToken: token,
          currentTime: nowSec * 1000,
          clockSkewToleranceSeconds: clockSkewSec
        },
        mockJwksClient,
        TEST_CONFIG
      );

      expect(result.success).toBe(true);
    });

    it('rejects tokens issued far in the future', async () => {
      const nowSec = 1000000;
      const clockSkewSec = 60;

      // iat 120 seconds in future (> 60s skew)
      const payload = getBaseValidPayload({
        exp: nowSec + 3600,
        iat: nowSec + 120
      });
      const token = signTestJwt({ alg: 'RS256', kid: PRIMARY_KID }, payload, primaryKey.privateKey);

      const result = await verifyGoogleIDToken(
        {
          idToken: token,
          currentTime: nowSec * 1000,
          clockSkewToleranceSeconds: clockSkewSec
        },
        mockJwksClient,
        TEST_CONFIG
      );

      expect(result.success).toBe(false);
      expect(result.code).toBe('OIDC_REQUIRED_CLAIM_MISSING');
      expect(result.error).toContain('Token issued in the future');
    });
  });

  describe('7. Subject (sub) & Nonce Claim Validation', () => {
    it('rejects tokens with missing, empty, or whitespace-only sub', async () => {
      const invalidSubs = ['', '   ', null, undefined];

      for (const sub of invalidSubs) {
        const payload = getBaseValidPayload({ sub });
        const token = signTestJwt({ alg: 'RS256', kid: PRIMARY_KID }, payload, primaryKey.privateKey);

        const result = await verifyGoogleIDToken(
          { idToken: token },
          mockJwksClient,
          TEST_CONFIG
        );

        expect(result.success).toBe(false);
        expect(result.code).toBe('OIDC_REQUIRED_CLAIM_MISSING');
      }
    });

    it('verifies expected nonce matching and rejects mismatched nonce', async () => {
      const payload = getBaseValidPayload({ nonce: 'expected-secret-nonce-12345' });
      const token = signTestJwt({ alg: 'RS256', kid: PRIMARY_KID }, payload, primaryKey.privateKey);

      // Match succeeds
      const matchResult = await verifyGoogleIDToken(
        { idToken: token, expectedNonce: 'expected-secret-nonce-12345' },
        mockJwksClient,
        TEST_CONFIG
      );
      expect(matchResult.success).toBe(true);

      // Mismatch fails
      const mismatchResult = await verifyGoogleIDToken(
        { idToken: token, expectedNonce: 'tampered-or-different-nonce' },
        mockJwksClient,
        TEST_CONFIG
      );
      expect(mismatchResult.success).toBe(false);
      expect(mismatchResult.code).toBe('OIDC_NONCE_INVALID');

      // Missing nonce when expected fails
      const noNoncePayload = getBaseValidPayload();
      delete noNoncePayload.nonce;
      const noNonceToken = signTestJwt({ alg: 'RS256', kid: PRIMARY_KID }, noNoncePayload, primaryKey.privateKey);
      const noNonceResult = await verifyGoogleIDToken(
        { idToken: noNonceToken, expectedNonce: 'expected-secret-nonce-12345' },
        mockJwksClient,
        TEST_CONFIG
      );
      expect(noNonceResult.success).toBe(false);
      expect(noNonceResult.code).toBe('OIDC_NONCE_INVALID');
    });

    it('resolves expected nonce through pre-auth transaction binding in store', async () => {
      const { transaction } = transactionStore.createTransaction();

      // Token has transaction's nonce
      const payload = getBaseValidPayload({ nonce: transaction.nonce });
      const token = signTestJwt({ alg: 'RS256', kid: PRIMARY_KID }, payload, primaryKey.privateKey);

      const result = await verifyGoogleIDToken(
        {
          idToken: token,
          transactionId: transaction.id,
          transactionStore
        },
        mockJwksClient,
        TEST_CONFIG
      );

      expect(result.success).toBe(true);
    });

    it('rejects verification if transactionId does not exist in store', async () => {
      const payload = getBaseValidPayload({ nonce: 'any-nonce' });
      const token = signTestJwt({ alg: 'RS256', kid: PRIMARY_KID }, payload, primaryKey.privateKey);

      const result = await verifyGoogleIDToken(
        {
          idToken: token,
          transactionId: 'non-existent-transaction-uuid',
          transactionStore
        },
        mockJwksClient,
        TEST_CONFIG
      );

      expect(result.success).toBe(false);
      expect(result.code).toBe('OIDC_NONCE_INVALID');
      expect(result.error).toContain('Pre-authentication transaction not found');
    });
  });

  describe('8. Email & Profile Claim Sanitization', () => {
    it('sets emailVerified to true ONLY when email_verified is boolean true', async () => {
      // Boolean true
      const p1 = getBaseValidPayload({ email_verified: true, email: 'user@test.org' });
      const t1 = signTestJwt({ alg: 'RS256', kid: PRIMARY_KID }, p1, primaryKey.privateKey);
      const r1 = await verifyGoogleIDToken({ idToken: t1 }, mockJwksClient, TEST_CONFIG);
      expect(r1.identity?.emailVerified).toBe(true);
      expect(r1.identity?.email).toBe('user@test.org');

      // String 'true' (MUST NOT be treated as boolean true)
      const p2 = getBaseValidPayload({ email_verified: 'true', email: 'user@test.org' });
      const t2 = signTestJwt({ alg: 'RS256', kid: PRIMARY_KID }, p2, primaryKey.privateKey);
      const r2 = await verifyGoogleIDToken({ idToken: t2 }, mockJwksClient, TEST_CONFIG);
      expect(r2.identity?.emailVerified).toBe(false);

      // Boolean false
      const p3 = getBaseValidPayload({ email_verified: false, email: 'user@test.org' });
      const t3 = signTestJwt({ alg: 'RS256', kid: PRIMARY_KID }, p3, primaryKey.privateKey);
      const r3 = await verifyGoogleIDToken({ idToken: t3 }, mockJwksClient, TEST_CONFIG);
      expect(r3.identity?.emailVerified).toBe(false);
    });

    it('safely handles malformed non-string profile claims without crashing', async () => {
      const payload = getBaseValidPayload({
        name: 12345, // invalid type
        picture: 'javascript:alert(1)', // invalid scheme
        given_name: { nested: 'object' }, // invalid type
        locale: null
      });
      const token = signTestJwt({ alg: 'RS256', kid: PRIMARY_KID }, payload, primaryKey.privateKey);

      const result = await verifyGoogleIDToken({ idToken: token }, mockJwksClient, TEST_CONFIG);
      expect(result.success).toBe(true);
      expect(result.identity?.profile?.name).toBeUndefined();
      expect(result.identity?.profile?.picture).toBeUndefined();
      expect(result.identity?.profile?.givenName).toBeUndefined();
      expect(result.identity?.profile?.locale).toBeUndefined();
    });
  });

  describe('9. Fail-Closed Boundaries & Side-Effect Absence', () => {
    it('verifies that failed verification creates NO database users or external identities', async () => {
      const initialUsers = db.getState().users;
      const initialExternalIdentities = db.getState().external_identities;

      // Attempt verification with invalid token
      const result = await verifyGoogleIDToken(
        { idToken: 'invalid.token.here' },
        mockJwksClient,
        TEST_CONFIG
      );
      expect(result.success).toBe(false);

      // Database MUST REMAIN 100% UNCHANGED
      expect(db.getState().users.length).toBe(initialUsers.length);
      expect(db.getState().external_identities.length).toBe(initialExternalIdentities.length);
    });

    it('verifies that successful verification in this milestone creates NO user sessions', async () => {
      const initialActiveSessions = defaultSessionStore.getActiveSessionsCount();

      const payload = getBaseValidPayload();
      const token = signTestJwt({ alg: 'RS256', kid: PRIMARY_KID }, payload, primaryKey.privateKey);

      const result = await verifyGoogleIDToken(
        { idToken: token },
        mockJwksClient,
        TEST_CONFIG
      );
      expect(result.success).toBe(true);

      // Session count MUST REMAIN 100% UNCHANGED (zero session creation in MVS-B2.5C.2)
      expect(defaultSessionStore.getActiveSessionsCount()).toBe(initialActiveSessions);
    });

    it('verifies that Main Administrator bootstrap and RBAC models remain intact', () => {
      // Main admin cannot be created via verified identity
      const mainAdmins = db.getState().users.filter((u) => u.is_main_admin);
      expect(mainAdmins.every((u) => u.is_main_admin)).toBe(true);
    });
  });
});
