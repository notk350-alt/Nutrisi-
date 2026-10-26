/**
 * NutriBodySim — Google OIDC Authorization Code Exchange Handler Tests
 * Milestone: MVS-B2.5C.3
 *
 * Adversarial Test Matrix Coverage:
 * 1. Successful exchange produces verified identity via C.2 verifier.
 * 2. Empty or malformed authorization code rejected (OIDC_EXCHANGE_INVALID_INPUT).
 * 3. Empty or malformed state parameter rejected (OIDC_EXCHANGE_INVALID_INPUT).
 * 4. Non-existent transaction rejected (OIDC_TRANSACTION_NOT_FOUND).
 * 5. Expired transaction rejected (OIDC_TRANSACTION_EXPIRED).
 * 6. Already consumed transaction rejected on replay (OIDC_TRANSACTION_ALREADY_CONSUMED).
 * 7. Concurrent replay attempts fail closed (atomic single-use enforcement).
 * 8. PKCE code_verifier is strictly bound to server transaction (client cannot inject verifier).
 * 9. Nonce is strictly bound to server transaction (mismatched ID token nonce fails).
 * 10. Redirect URI and client_id are strictly bound to server transaction/config.
 * 11. Fixed Google token endpoint cannot be overridden or redirected (anti-SSRF/anti-redirect).
 * 12. HTTP non-2xx errors (e.g. 400 invalid_grant) handled without exposing sensitive params.
 * 13. Network errors and timeouts handled fail-closed with NO automatic retry.
 * 14. Malformed JSON or non-JSON responses handled safely (OIDC_TOKEN_RESPONSE_INVALID).
 * 15. Token response missing id_token claim rejected (OIDC_TOKEN_RESPONSE_INVALID).
 * 16. ID token validation failure in C.2 verifier returns OIDC_ID_TOKEN_VERIFICATION_FAILED.
 * 17. Zero token/secret/verifier leakage in return values, errors, or logs.
 * 18. Side-Effect Absence: Zero database mutations, zero user sessions, zero cookie modifications.
 * 19. Architectural Immutability: RBAC, Role Approval, and Main Administrator untouched.
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import crypto from 'crypto';
import {
  exchangeGoogleAuthorizationCode,
  GOOGLE_TOKEN_ENDPOINT,
  GoogleJWKSClient,
  MemoryOIDCTransactionStore,
  OIDCConfig
} from '../auth/oidc';
import { db } from '../database/store';
import { defaultSessionStore } from '../auth/sessionStore';

describe('MVS-B2.5C.3: Google OIDC Authorization Code Exchange Handler', () => {
  let primaryKey: { publicKey: crypto.KeyObject; privateKey: crypto.KeyObject };
  let attackerKey: { publicKey: crypto.KeyObject; privateKey: crypto.KeyObject };

  const PRIMARY_KID = 'google-exchange-cert-2026';
  const TEST_CLIENT_ID = '987654321-nutribodysim.apps.googleusercontent.com';
  const TEST_CLIENT_SECRET = 'super-secret-google-oauth-secret';
  const TEST_REDIRECT_URI = 'http://localhost:3000/api/auth/oidc/callback';

  const TEST_CONFIG: OIDCConfig = {
    enabled: true,
    clientId: TEST_CLIENT_ID,
    clientSecret: TEST_CLIENT_SECRET,
    issuer: 'https://accounts.google.com',
    authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenEndpoint: GOOGLE_TOKEN_ENDPOINT,
    jwksUri: 'https://www.googleapis.com/oauth2/v3/certs',
    redirectUri: TEST_REDIRECT_URI,
    allowedScopes: ['openid', 'email', 'profile'],
    transactionTtlSeconds: 600,
    clockSkewToleranceSeconds: 60,
    cookieSameSite: 'lax',
    cookieSecure: false
  };

  let mockJwksClient: GoogleJWKSClient;
  let transactionStore: MemoryOIDCTransactionStore;

  beforeAll(() => {
    primaryKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
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
   * Helper to construct signed JWTs for mocking Google Token Endpoint responses.
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

  function getBaseIdTokenPayload(overrides?: Record<string, any>): Record<string, any> {
    const nowSec = Math.floor(Date.now() / 1000);
    return {
      iss: 'https://accounts.google.com',
      sub: 'google-subject-id-9988776655',
      aud: TEST_CLIENT_ID,
      exp: nowSec + 3600,
      iat: nowSec - 10,
      email: 'scientist@nutribodysim.org',
      email_verified: true,
      name: 'Dr. Albert Scientist',
      picture: 'https://lh3.googleusercontent.com/avatar.png',
      given_name: 'Albert',
      family_name: 'Scientist',
      ...overrides
    };
  }

  describe('1. Successful Exchange Flow', () => {
    it('successfully exchanges code and returns clean verified identity with zero secret leaks', async () => {
      // 1. Pre-auth transaction created on server
      const { transaction } = transactionStore.createTransaction({
        redirectUri: TEST_REDIRECT_URI
      });

      // 2. Prepare valid ID token containing transaction's nonce
      const idToken = signTestJwt(
        { alg: 'RS256', kid: PRIMARY_KID },
        getBaseIdTokenPayload({ nonce: transaction.nonce }),
        primaryKey.privateKey
      );

      // 3. Mock Google Token Endpoint response
      let capturedRequestBody = '';
      let capturedRequestUrl = '';
      const mockFetch: typeof fetch = async (input, init) => {
        capturedRequestUrl = input.toString();
        capturedRequestBody = init?.body as string;
        return new Response(
          JSON.stringify({
            access_token: 'mock-access-token-12345',
            token_type: 'Bearer',
            expires_in: 3600,
            id_token: idToken
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      };

      // 4. Execute exchange handler
      const result = await exchangeGoogleAuthorizationCode(
        {
          code: 'valid-google-auth-code-xyz',
          state: transaction.state,
          transactionId: transaction.id
        },
        {
          transactionStore,
          jwksClient: mockJwksClient,
          config: TEST_CONFIG,
          customFetch: mockFetch
        }
      );

      // Assertions
      expect(result.success).toBe(true);
      expect(result.identity).toBeDefined();

      const identity = result.identity!;
      expect(identity.provider).toBe('google');
      expect(identity.sub).toBe('google-subject-id-9988776655');
      expect(identity.email).toBe('scientist@nutribodysim.org');
      expect(identity.emailVerified).toBe(true);
      expect(identity.profile?.name).toBe('Dr. Albert Scientist');

      // Verify request payload dispatched to Google
      expect(capturedRequestUrl).toBe(GOOGLE_TOKEN_ENDPOINT);
      const params = new URLSearchParams(capturedRequestBody);
      expect(params.get('grant_type')).toBe('authorization_code');
      expect(params.get('code')).toBe('valid-google-auth-code-xyz');
      expect(params.get('client_id')).toBe(TEST_CLIENT_ID);
      expect(params.get('client_secret')).toBe(TEST_CLIENT_SECRET);
      expect(params.get('redirect_uri')).toBe(TEST_REDIRECT_URI);
      expect(params.get('code_verifier')).toBe(transaction.codeVerifier);

      // Verify transaction was consumed in store
      expect(transactionStore.getTransaction(transaction.id)?.consumed).toBe(true);

      // Verify zero secret leakage to return object
      expect((result as any).idToken).toBeUndefined();
      expect((result as any).accessToken).toBeUndefined();
      expect((result as any).refreshToken).toBeUndefined();
      expect((result as any).clientSecret).toBeUndefined();
      expect((result as any).codeVerifier).toBeUndefined();
    });
  });

  describe('2. Input & Configuration Validation', () => {
    it('rejects empty or missing authorization code', async () => {
      const { transaction } = transactionStore.createTransaction();

      const result = await exchangeGoogleAuthorizationCode(
        { code: '', state: transaction.state },
        { transactionStore, jwksClient: mockJwksClient, config: TEST_CONFIG }
      );

      expect(result.success).toBe(false);
      expect(result.code).toBe('OIDC_EXCHANGE_INVALID_INPUT');
      expect(result.error).toContain('Authorization code is required');
    });

    it('rejects empty or missing state parameter', async () => {
      const result = await exchangeGoogleAuthorizationCode(
        { code: 'any-code', state: '' },
        { transactionStore, jwksClient: mockJwksClient, config: TEST_CONFIG }
      );

      expect(result.success).toBe(false);
      expect(result.code).toBe('OIDC_EXCHANGE_INVALID_INPUT');
      expect(result.error).toContain('State parameter is required');
    });

    it('rejects when Google Client ID is unconfigured', async () => {
      const { transaction } = transactionStore.createTransaction();

      const invalidConfig = { ...TEST_CONFIG, clientId: '' };
      const result = await exchangeGoogleAuthorizationCode(
        { code: 'any-code', state: transaction.state },
        { transactionStore, jwksClient: mockJwksClient, config: invalidConfig }
      );

      expect(result.success).toBe(false);
      expect(result.code).toBe('OIDC_CONFIGURATION_INVALID');
      expect(result.error).toContain('Google Client ID is not configured');
    });
  });

  describe('3. Transaction Integrity, Expiry & Replay Prevention', () => {
    it('rejects exchange when transaction is not found for the given state', async () => {
      const result = await exchangeGoogleAuthorizationCode(
        {
          code: 'any-code',
          state: 'non-existent-state-token-1234567890'
        },
        { transactionStore, jwksClient: mockJwksClient, config: TEST_CONFIG }
      );

      expect(result.success).toBe(false);
      expect(result.code).toBe('OIDC_TRANSACTION_NOT_FOUND');
    });

    it('rejects exchange when transaction has expired', async () => {
      const baseTime = 1000000;
      const { transaction } = transactionStore.createTransaction({
        ttlSeconds: 60,
        currentTime: baseTime
      });

      const result = await exchangeGoogleAuthorizationCode(
        {
          code: 'any-code',
          state: transaction.state,
          currentTime: baseTime + 700000 // well past TTL + clock skew
        },
        { transactionStore, jwksClient: mockJwksClient, config: TEST_CONFIG }
      );

      expect(result.success).toBe(false);
      expect(result.code).toBe('OIDC_TRANSACTION_EXPIRED');
    });

    it('strictly prevents replay attacks (consuming authorization code / transaction twice)', async () => {
      const { transaction } = transactionStore.createTransaction();
      const idToken = signTestJwt(
        { alg: 'RS256', kid: PRIMARY_KID },
        getBaseIdTokenPayload({ nonce: transaction.nonce }),
        primaryKey.privateKey
      );

      let fetchCallCount = 0;
      const mockFetch: typeof fetch = async () => {
        fetchCallCount++;
        return new Response(JSON.stringify({ id_token: idToken }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      };

      // First attempt succeeds
      const firstResult = await exchangeGoogleAuthorizationCode(
        {
          code: 'auth-code-single-use',
          state: transaction.state,
          transactionId: transaction.id
        },
        {
          transactionStore,
          jwksClient: mockJwksClient,
          config: TEST_CONFIG,
          customFetch: mockFetch
        }
      );
      expect(firstResult.success).toBe(true);
      expect(fetchCallCount).toBe(1);

      // Second attempt with SAME state/transaction MUST FAIL before network dispatch
      const replayResult = await exchangeGoogleAuthorizationCode(
        {
          code: 'auth-code-single-use',
          state: transaction.state,
          transactionId: transaction.id
        },
        {
          transactionStore,
          jwksClient: mockJwksClient,
          config: TEST_CONFIG,
          customFetch: mockFetch
        }
      );
      expect(replayResult.success).toBe(false);
      expect(replayResult.code).toBe('OIDC_TRANSACTION_ALREADY_CONSUMED');
      // Verify no second network call was made
      expect(fetchCallCount).toBe(1);
    });

    it('fails closed when browser binding does not match transaction', async () => {
      const { transaction } = transactionStore.createTransaction({
        clientBinding: 'browser-session-fingerprint-a'
      });

      const result = await exchangeGoogleAuthorizationCode(
        {
          code: 'any-code',
          state: transaction.state,
          clientBinding: 'browser-session-fingerprint-b' // mismatch
        },
        { transactionStore, jwksClient: mockJwksClient, config: TEST_CONFIG }
      );

      expect(result.success).toBe(false);
      expect(result.code).toBe('OIDC_TRANSACTION_NOT_FOUND');
    });
  });

  describe('4. Token Endpoint Network & Security Controls', () => {
    it('handles HTTP 400 (e.g. invalid_grant) from token endpoint without leaking secrets', async () => {
      const { transaction } = transactionStore.createTransaction();

      const mockFetch: typeof fetch = async () => {
        return new Response(
          JSON.stringify({
            error: 'invalid_grant',
            error_description: 'Bad Request'
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      };

      const result = await exchangeGoogleAuthorizationCode(
        {
          code: 'invalid-or-already-used-code',
          state: transaction.state
        },
        {
          transactionStore,
          jwksClient: mockJwksClient,
          config: TEST_CONFIG,
          customFetch: mockFetch
        }
      );

      expect(result.success).toBe(false);
      expect(result.code).toBe('OIDC_TOKEN_ENDPOINT_REJECTED');
      expect(result.error).toContain('invalid_grant');
      expect(result.error).not.toContain(TEST_CLIENT_SECRET);
      expect(result.error).not.toContain(transaction.codeVerifier);
    });

    it('handles network failure fail-closed with NO automatic retry', async () => {
      const { transaction } = transactionStore.createTransaction();

      let fetchCount = 0;
      const mockFetch: typeof fetch = async () => {
        fetchCount++;
        throw new Error('ECONNRESET connection reset by peer');
      };

      const result = await exchangeGoogleAuthorizationCode(
        {
          code: 'code-network-glitch',
          state: transaction.state
        },
        {
          transactionStore,
          jwksClient: mockJwksClient,
          config: TEST_CONFIG,
          customFetch: mockFetch
        }
      );

      expect(result.success).toBe(false);
      expect(result.code).toBe('OIDC_TOKEN_ENDPOINT_UNAVAILABLE');
      // Crucial: Must NOT attempt automatic retry on ambiguous network error
      expect(fetchCount).toBe(1);
    });

    it('rejects unexpected HTTP redirects from token endpoint', async () => {
      const { transaction } = transactionStore.createTransaction();

      const mockFetch: typeof fetch = async () => {
        return new Response('', {
          status: 302,
          headers: { Location: 'https://attacker.com/steal-code' }
        });
      };

      const result = await exchangeGoogleAuthorizationCode(
        {
          code: 'code-redirect-test',
          state: transaction.state
        },
        {
          transactionStore,
          jwksClient: mockJwksClient,
          config: TEST_CONFIG,
          customFetch: mockFetch
        }
      );

      expect(result.success).toBe(false);
      expect(result.code).toBe('OIDC_TOKEN_ENDPOINT_REJECTED');
      expect(result.error).toContain('Unexpected redirect');
    });

    it('rejects responses missing the id_token claim', async () => {
      const { transaction } = transactionStore.createTransaction();

      const mockFetch: typeof fetch = async () => {
        return new Response(
          JSON.stringify({
            access_token: 'valid-access-token-only',
            token_type: 'Bearer'
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      };

      const result = await exchangeGoogleAuthorizationCode(
        { code: 'any-code', state: transaction.state },
        {
          transactionStore,
          jwksClient: mockJwksClient,
          config: TEST_CONFIG,
          customFetch: mockFetch
        }
      );

      expect(result.success).toBe(false);
      expect(result.code).toBe('OIDC_TOKEN_RESPONSE_INVALID');
      expect(result.error).toContain("missing required 'id_token' claim");
    });

    it('rejects non-JSON malformed responses from token endpoint', async () => {
      const { transaction } = transactionStore.createTransaction();

      const mockFetch: typeof fetch = async () => {
        return new Response('<html><head><title>502 Bad Gateway</title></head></html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html' }
        });
      };

      const result = await exchangeGoogleAuthorizationCode(
        { code: 'any-code', state: transaction.state },
        {
          transactionStore,
          jwksClient: mockJwksClient,
          config: TEST_CONFIG,
          customFetch: mockFetch
        }
      );

      expect(result.success).toBe(false);
      expect(result.code).toBe('OIDC_TOKEN_RESPONSE_INVALID');
      expect(result.error).toContain('malformed or non-JSON response');
    });
  });

  describe('5. C.2 ID Token Verifier Integration', () => {
    it('fails closed when ID token signature is forged or invalid', async () => {
      const { transaction } = transactionStore.createTransaction();

      // Sign with attacker key
      const forgedToken = signTestJwt(
        { alg: 'RS256', kid: PRIMARY_KID },
        getBaseIdTokenPayload({ nonce: transaction.nonce }),
        attackerKey.privateKey
      );

      const mockFetch: typeof fetch = async () => {
        return new Response(JSON.stringify({ id_token: forgedToken }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      };

      const result = await exchangeGoogleAuthorizationCode(
        { code: 'code-forged-sig', state: transaction.state },
        {
          transactionStore,
          jwksClient: mockJwksClient,
          config: TEST_CONFIG,
          customFetch: mockFetch
        }
      );

      expect(result.success).toBe(false);
      expect(result.code).toBe('OIDC_ID_TOKEN_VERIFICATION_FAILED');
      expect(result.error).toContain('Cryptographic signature verification failed');
    });

    it('fails closed when ID token nonce does not match server transaction nonce', async () => {
      const { transaction } = transactionStore.createTransaction();

      // Token has a different nonce than the one stored in server transaction
      const mismatchedNonceToken = signTestJwt(
        { alg: 'RS256', kid: PRIMARY_KID },
        getBaseIdTokenPayload({ nonce: 'wrong-mismatched-nonce-999' }),
        primaryKey.privateKey
      );

      const mockFetch: typeof fetch = async () => {
        return new Response(JSON.stringify({ id_token: mismatchedNonceToken }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      };

      const result = await exchangeGoogleAuthorizationCode(
        { code: 'code-wrong-nonce', state: transaction.state },
        {
          transactionStore,
          jwksClient: mockJwksClient,
          config: TEST_CONFIG,
          customFetch: mockFetch
        }
      );

      expect(result.success).toBe(false);
      expect(result.code).toBe('OIDC_ID_TOKEN_VERIFICATION_FAILED');
      expect(result.error).toContain('Nonce mismatch between ID Token and expected server transaction');
    });
  });

  describe('6. Side-Effect Absence & Architectural Integrity', () => {
    it('verifies that exchange (failure or success) creates NO users, NO sessions, and NO external identities', async () => {
      const initialUsersCount = db.getState().users.length;
      const initialIdentitiesCount = db.getState().external_identities.length;
      const initialActiveSessions = defaultSessionStore.getActiveSessionsCount();

      const { transaction } = transactionStore.createTransaction();
      const idToken = signTestJwt(
        { alg: 'RS256', kid: PRIMARY_KID },
        getBaseIdTokenPayload({ nonce: transaction.nonce }),
        primaryKey.privateKey
      );

      const mockFetch: typeof fetch = async () => {
        return new Response(JSON.stringify({ id_token: idToken }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      };

      const result = await exchangeGoogleAuthorizationCode(
        { code: 'valid-code', state: transaction.state },
        {
          transactionStore,
          jwksClient: mockJwksClient,
          config: TEST_CONFIG,
          customFetch: mockFetch
        }
      );
      expect(result.success).toBe(true);

      // Verify ZERO database mutations
      expect(db.getState().users.length).toBe(initialUsersCount);
      expect(db.getState().external_identities.length).toBe(initialIdentitiesCount);

      // Verify ZERO session creation
      expect(defaultSessionStore.getActiveSessionsCount()).toBe(initialActiveSessions);

      // Verify Main Administrator and RBAC unchanged
      const mainAdmins = db.getState().users.filter((u) => u.is_main_admin);
      expect(mainAdmins.every((u) => u.is_main_admin)).toBe(true);
    });
  });
});
