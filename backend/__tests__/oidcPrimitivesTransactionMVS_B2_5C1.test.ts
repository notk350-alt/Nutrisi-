/**
 * NutriBodySim — OIDC Security Primitives & Transaction Foundation Tests
 * Milestone: MVS-B2.5C.1
 *
 * Test Matrix Coverage:
 * 1. PKCE (RFC 7636 Appendix B test vector, S256 challenge generation, verification, plain rejection).
 * 2. Cryptographic state (generation, entropy, timing-safe validation, tampering rejection).
 * 3. Cryptographic nonce (generation, entropy, validation, tampering rejection).
 * 4. Timing-safe equality (constant-time, length discrepancy handling, null/undefined safety).
 * 5. Single-use transaction & strict replay rejection.
 * 6. Expiration & clock skew tolerance boundaries.
 * 7. Client-safe projection: Server secrets (code_verifier, stateHash) NEVER leaked to client.
 * 8. Two concurrent transactions isolation.
 * 9. Browser / Client session binding verification (matching vs mismatch).
 * 10. Memory leak mitigation, bounded capacity, FIFO eviction, and expired cleanup.
 * 11. Configuration validation: fail-closed, missing params, placeholder rejection, invalid URIs, invalid issuers.
 * 12. Sanitized config for logging (zero secret leakage).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateCodeVerifier,
  generateCodeChallenge,
  verifyCodeChallenge,
  generateStateToken,
  validateStateToken,
  generateNonce,
  validateNonce,
  validateNonceToken,
  timingSafeEqual,
  MIN_CODE_VERIFIER_LENGTH,
  MAX_CODE_VERIFIER_LENGTH,
  PKCE_UNRESERVED_CHARACTERS
} from '../auth/oidc/primitives';
import {
  validateOIDCConfig,
  getSanitizedOIDCConfig,
  DEFAULT_OIDC_ISSUER,
  DEFAULT_OIDC_AUTH_ENDPOINT,
  DEFAULT_OIDC_TOKEN_ENDPOINT,
  DEFAULT_OIDC_JWKS_URI
} from '../auth/oidc/config';
import {
  MemoryOIDCTransactionStore
} from '../auth/oidc/transactionStore';
import { OIDCConfig } from '../auth/oidc/types';

describe('MVS-B2.5C.1: OIDC Cryptographic Primitives', () => {
  describe('PKCE S256 (RFC 7636 Compliance)', () => {
    it('accurately verifies RFC 7636 Appendix B test vector', () => {
      // Official RFC 7636 Appendix B test vector
      const rfcVerifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
      const rfcChallenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

      const computedChallenge = generateCodeChallenge(rfcVerifier, 'S256');
      expect(computedChallenge).toBe(rfcChallenge);

      const isValid = verifyCodeChallenge(rfcVerifier, rfcChallenge, 'S256');
      expect(isValid).toBe(true);
    });

    it('generates random code_verifier with valid unreserved characters and length', () => {
      const verifier = generateCodeVerifier(64);
      expect(verifier.length).toBe(64);

      for (let i = 0; i < verifier.length; i++) {
        expect(PKCE_UNRESERVED_CHARACTERS).toContain(verifier[i]);
      }
    });

    it('enforces code_verifier length between 43 and 128 per RFC 7636', () => {
      expect(() => generateCodeVerifier(20)).toThrow(
        /Code verifier length must be between 43 and 128 per RFC 7636/
      );
      expect(() => generateCodeVerifier(200)).toThrow(
        /Code verifier length must be between 43 and 128 per RFC 7636/
      );

      const minVerifier = generateCodeVerifier(43);
      expect(minVerifier.length).toBe(43);
      const maxVerifier = generateCodeVerifier(128);
      expect(maxVerifier.length).toBe(128);
    });

    it('rejects plain PKCE challenge method (S256 is strictly required)', () => {
      const verifier = generateCodeVerifier(64);
      expect(() => generateCodeChallenge(verifier, 'plain')).toThrow(
        /strictly requires 'S256'/
      );
      expect(verifyCodeChallenge(verifier, verifier, 'plain')).toBe(false);
    });

    it('fails verification when verifier is altered by even 1 character', () => {
      const verifier = generateCodeVerifier(64);
      const challenge = generateCodeChallenge(verifier, 'S256');

      const corruptedVerifier = verifier.slice(0, -1) + (verifier.slice(-1) === 'A' ? 'B' : 'A');
      expect(verifyCodeChallenge(corruptedVerifier, challenge, 'S256')).toBe(false);
    });
  });

  describe('Anti-CSRF State Tokens', () => {
    it('generates high-entropy base64url state tokens', () => {
      const state1 = generateStateToken(32);
      const state2 = generateStateToken(32);

      expect(state1).not.toBe(state2);
      expect(state1.length).toBeGreaterThanOrEqual(43); // 32 bytes base64url is 43 chars
      expect(validateStateToken(state1)).toBe(true);
      expect(validateStateToken(state2)).toBe(true);
    });

    it('rejects invalid, empty, or short state tokens', () => {
      expect(validateStateToken('')).toBe(false);
      expect(validateStateToken(null)).toBe(false);
      expect(validateStateToken(undefined)).toBe(false);
      expect(validateStateToken('short-state')).toBe(false);
      expect(validateStateToken('invalid chars with spaces!@#$%^')).toBe(false);
    });
  });

  describe('Nonce Tokens', () => {
    it('generates high-entropy base64url nonce tokens', () => {
      const nonce1 = generateNonce(32);
      const nonce2 = generateNonce(32);

      expect(nonce1).not.toBe(nonce2);
      expect(nonce1.length).toBeGreaterThanOrEqual(43);
      expect(validateNonceToken(nonce1)).toBe(true);
      expect(validateNonce(nonce1).valid).toBe(true);
      expect(validateNonceToken(nonce2)).toBe(true);
    });

    it('rejects invalid, empty, or short nonces', () => {
      expect(validateNonceToken('')).toBe(false);
      expect(validateNonce('').valid).toBe(false);
      expect(validateNonce('').error).toBeDefined();
      expect(validateNonceToken(null)).toBe(false);
      expect(validateNonceToken('short')).toBe(false);
    });
  });

  describe('Timing-Safe String Comparison', () => {
    it('accurately identifies matching strings', () => {
      const a = 'super-secret-random-token-1234567890';
      const b = 'super-secret-random-token-1234567890';
      expect(timingSafeEqual(a, b)).toBe(true);
    });

    it('accurately rejects mismatched strings', () => {
      const a = 'super-secret-random-token-1234567890';
      const b = 'super-secret-random-token-1234567891';
      expect(timingSafeEqual(a, b)).toBe(false);
    });

    it('safely handles length differences without leaking timing or throwing', () => {
      const a = 'short';
      const b = 'long-super-secret-random-token';
      expect(timingSafeEqual(a, b)).toBe(false);
      expect(timingSafeEqual('', 'non-empty')).toBe(false);
    });

    it('safely handles null or undefined inputs', () => {
      expect(timingSafeEqual(null, 'test')).toBe(false);
      expect(timingSafeEqual('test', undefined)).toBe(false);
      expect(timingSafeEqual(null, null)).toBe(false);
    });
  });
});

describe('MVS-B2.5C.1: OIDC Transaction Store & Lifecycle', () => {
  let store: MemoryOIDCTransactionStore;

  beforeEach(() => {
    store = new MemoryOIDCTransactionStore({
      maxCapacity: 10,
      defaultTtlSeconds: 300,
      clockSkewToleranceMs: 5000
    });
  });

  it('creates transaction with all server primitives and returns safe client projection', () => {
    const { transaction, clientData } = store.createTransaction({
      redirectUri: 'http://localhost:3000/api/auth/oidc/callback',
      clientBinding: 'browser-session-fingerprint-xyz'
    });

    // Server transaction record inspection
    expect(transaction.id).toBeTruthy();
    expect(transaction.state).toBeTruthy();
    expect(transaction.nonce).toBeTruthy();
    expect(transaction.codeVerifier).toBeTruthy();
    expect(transaction.codeChallenge).toBeTruthy();
    expect(transaction.codeChallengeMethod).toBe('S256');
    expect(transaction.consumed).toBe(false);
    expect(transaction.clientBinding).toBe('browser-session-fingerprint-xyz');

    // Client data projection verification (MUST NEVER LEAK SECRETS)
    expect(clientData.transactionId).toBe(transaction.id);
    expect(clientData.state).toBe(transaction.state);
    expect(clientData.codeChallenge).toBe(transaction.codeChallenge);
    expect(clientData.codeChallengeMethod).toBe('S256');
    expect(clientData.expiresAt).toBe(transaction.expiresAt);

    // Verify secrets are NOT present in clientData
    expect((clientData as any).codeVerifier).toBeUndefined();
    expect((clientData as any).stateHash).toBeUndefined();
    expect((clientData as any).consumed).toBeUndefined();
  });

  it('successfully consumes transaction on valid state and nonce matching', () => {
    const { transaction } = store.createTransaction();

    const consumeResult = store.consumeTransaction({
      state: transaction.state,
      transactionId: transaction.id,
      nonce: transaction.nonce
    });

    expect(consumeResult.success).toBe(true);
    expect(consumeResult.transaction).toBeDefined();
    expect(consumeResult.transaction?.id).toBe(transaction.id);
    expect(consumeResult.transaction?.consumed).toBe(true);
  });

  it('strictly rejects replay attacks (consuming twice)', () => {
    const { transaction } = store.createTransaction();

    // First consumption succeeds
    const firstAttempt = store.consumeTransaction({
      state: transaction.state,
      transactionId: transaction.id
    });
    expect(firstAttempt.success).toBe(true);

    // Second consumption MUST FAIL (single-use enforcement)
    const secondAttempt = store.consumeTransaction({
      state: transaction.state,
      transactionId: transaction.id
    });
    expect(secondAttempt.success).toBe(false);
    expect(secondAttempt.code).toBe('TRANSACTION_ALREADY_CONSUMED');
    expect(secondAttempt.error).toContain('Replay attempt rejected');
  });

  it('rejects consumption with invalid or forged state', () => {
    const { transaction } = store.createTransaction();

    const result = store.consumeTransaction({
      state: 'forged-or-tampered-state-token-value-here',
      transactionId: transaction.id
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe('INVALID_STATE');
  });

  it('rejects consumption when nonce does not match ID token nonce', () => {
    const { transaction } = store.createTransaction();

    const result = store.consumeTransaction({
      state: transaction.state,
      transactionId: transaction.id,
      nonce: 'mismatched-tampered-nonce'
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe('NONCE_MISMATCH');
  });

  it('enforces client browser binding if configured', () => {
    const { transaction } = store.createTransaction({
      clientBinding: 'valid-client-session-binding-123'
    });

    // Mismatched client binding
    const failResult = store.consumeTransaction({
      state: transaction.state,
      transactionId: transaction.id,
      clientBinding: 'different-client-session'
    });
    expect(failResult.success).toBe(false);
    expect(failResult.code).toBe('CLIENT_BINDING_MISMATCH');

    // Matching client binding
    const okResult = store.consumeTransaction({
      state: transaction.state,
      transactionId: transaction.id,
      clientBinding: 'valid-client-session-binding-123'
    });
    expect(okResult.success).toBe(true);
  });

  it('rejects expired transactions past clock skew threshold', () => {
    const now = 1000000;
    const ttlSeconds = 60; // 60 seconds TTL

    const { transaction } = store.createTransaction({
      currentTime: now,
      ttlSeconds
    });

    // Valid just before expiry + skew (skew tolerance = 5000ms = 5s)
    const beforeExpiry = store.consumeTransaction({
      state: transaction.state,
      transactionId: transaction.id,
      currentTime: now + 64000 // 64s: within 60s + 5s skew
    });
    expect(beforeExpiry.success).toBe(true);

    // Create another one and check past expiry + skew
    const { transaction: tx2 } = store.createTransaction({
      currentTime: now,
      ttlSeconds
    });

    const afterExpiry = store.consumeTransaction({
      state: tx2.state,
      transactionId: tx2.id,
      currentTime: now + 66000 // 66s: exceeds 60s + 5s skew
    });
    expect(afterExpiry.success).toBe(false);
    expect(afterExpiry.code).toBe('TRANSACTION_EXPIRED');
  });

  it('correctly handles concurrent transactions with strict isolation', () => {
    const tx1 = store.createTransaction({ clientBinding: 'session-1' });
    const tx2 = store.createTransaction({ clientBinding: 'session-2' });

    expect(tx1.transaction.id).not.toBe(tx2.transaction.id);
    expect(tx1.transaction.state).not.toBe(tx2.transaction.state);
    expect(tx1.transaction.codeVerifier).not.toBe(tx2.transaction.codeVerifier);
    expect(tx1.transaction.codeChallenge).not.toBe(tx2.transaction.codeChallenge);

    // Consume tx2 first
    const consume2 = store.consumeTransaction({
      state: tx2.transaction.state,
      transactionId: tx2.transaction.id,
      clientBinding: 'session-2'
    });
    expect(consume2.success).toBe(true);

    // tx1 must still be active and consumable
    const consume1 = store.consumeTransaction({
      state: tx1.transaction.state,
      transactionId: tx1.transaction.id,
      clientBinding: 'session-1'
    });
    expect(consume1.success).toBe(true);
  });

  it('rejects non-existent transaction IDs cleanly', () => {
    const result = store.consumeTransaction({
      state: 'valid-looking-state-string-here-1234567890',
      transactionId: '00000000-0000-0000-0000-000000000000'
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe('TRANSACTION_NOT_FOUND');
  });

  it('bounds memory capacity and performs FIFO eviction when full', () => {
    const boundedStore = new MemoryOIDCTransactionStore({
      maxCapacity: 3,
      defaultTtlSeconds: 300
    });

    const tx1 = boundedStore.createTransaction();
    const tx2 = boundedStore.createTransaction();
    const tx3 = boundedStore.createTransaction();

    expect(boundedStore.getCapacity().current).toBe(3);

    // Adding 4th must evict oldest (tx1)
    const tx4 = boundedStore.createTransaction();
    expect(boundedStore.getCapacity().current).toBe(3);

    expect(boundedStore.getTransaction(tx1.transaction.id)).toBeNull();
    expect(boundedStore.getTransaction(tx2.transaction.id)).not.toBeNull();
    expect(boundedStore.getTransaction(tx3.transaction.id)).not.toBeNull();
    expect(boundedStore.getTransaction(tx4.transaction.id)).not.toBeNull();
  });

  it('cleans expired transactions accurately', () => {
    const baseTime = 10000000;
    store.createTransaction({ currentTime: baseTime, ttlSeconds: 10 });
    store.createTransaction({ currentTime: baseTime, ttlSeconds: 10 });
    store.createTransaction({ currentTime: baseTime, ttlSeconds: 600 }); // Still valid

    expect(store.getCapacity().current).toBe(3);

    // Clean at baseTime + 20 seconds (both 10s txs are expired, 600s is not)
    const cleaned = store.cleanExpiredTransactions(baseTime + 20000);
    expect(cleaned).toBe(2);
    expect(store.getCapacity().current).toBe(1);
  });
});

describe('MVS-B2.5C.1: OIDC Configuration Validation & Sanitization', () => {
  it('allows disabled mode without throwing or failing validation', () => {
    const result = validateOIDCConfig({ enabled: false }, false);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('fails closed when enabled is true but required fields are missing', () => {
    const result = validateOIDCConfig({ enabled: true }, false);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('clientId is required'),
        expect.stringContaining('clientSecret is required'),
        expect.stringContaining('redirectUri is required')
      ])
    );
  });

  it('rejects known placeholder values', () => {
    const result = validateOIDCConfig(
      {
        enabled: true,
        clientId: 'YOUR_CLIENT_ID.apps.googleusercontent.com',
        clientSecret: 'YOUR_CLIENT_SECRET',
        redirectUri: 'http://localhost:3000/api/auth/oidc/callback'
      },
      false
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('clientId contains placeholder value'),
        expect.stringContaining('clientSecret contains placeholder value')
      ])
    );
  });

  it('rejects non-standard or untrusted OIDC issuers', () => {
    const result = validateOIDCConfig(
      {
        enabled: true,
        clientId: 'valid-client-id-12345.apps.googleusercontent.com',
        clientSecret: 'valid-secret-67890-abcdef',
        redirectUri: 'http://localhost:3000/api/auth/oidc/callback',
        issuer: 'https://evil-hacker-site.com'
      },
      false
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining('Invalid OIDC issuer')])
    );
  });

  it('enforces HTTPS for redirectUri in production environment', () => {
    const result = validateOIDCConfig(
      {
        enabled: true,
        clientId: 'valid-client-id-12345.apps.googleusercontent.com',
        clientSecret: 'valid-secret-67890-abcdef',
        redirectUri: 'http://my-insecure-site.com/callback'
      },
      true // production
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('redirectUri must use HTTPS in production')
      ])
    );
  });

  it('sanitizes clientSecret in sanitized config output to prevent log leakage', () => {
    const config: OIDCConfig = {
      enabled: true,
      clientId: 'valid-client-id-12345.apps.googleusercontent.com',
      clientSecret: 'SUPER_CONFIDENTIAL_SECRET_123',
      issuer: DEFAULT_OIDC_ISSUER,
      authorizationEndpoint: DEFAULT_OIDC_AUTH_ENDPOINT,
      tokenEndpoint: DEFAULT_OIDC_TOKEN_ENDPOINT,
      jwksUri: DEFAULT_OIDC_JWKS_URI,
      redirectUri: 'http://localhost:3000/api/auth/oidc/callback',
      allowedScopes: ['openid', 'email', 'profile'],
      transactionTtlSeconds: 600,
      clockSkewToleranceSeconds: 60,
      cookieSameSite: 'lax',
      cookieSecure: false
    };

    const sanitized = getSanitizedOIDCConfig(config);
    expect((sanitized as any).clientSecret).toBeUndefined();
    expect(sanitized.hasClientSecret).toBe(true);
    expect(JSON.stringify(sanitized)).not.toContain('SUPER_CONFIDENTIAL_SECRET_123');
  });
});
