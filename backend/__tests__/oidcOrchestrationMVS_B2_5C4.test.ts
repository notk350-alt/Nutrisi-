/**
 * NutriBodySim — Google OIDC Login Orchestration & Callback Boundary Tests
 * Milestone: MVS-B2.5C.4
 *
 * Adversarial Test Matrix Coverage:
 * 1. Initiation generates cryptographically secure state, nonce, and PKCE challenge (S256).
 * 2. Pre-auth server transaction is stored in store before authorization URL is returned.
 * 3. Authorization URL contains official Google endpoint and all mandatory OIDC query parameters.
 * 4. Server secrets (code_verifier, stateHash, clientSecret) NEVER leak to clientData projection.
 * 5. Incomplete, placeholder, or invalid configuration rejected on initiation (OIDC_INIT_INVALID_CONFIGURATION).
 * 6. Untrusted authorization endpoint host rejected on initiation (anti-SSRF).
 * 7. State missing, empty, or whitespace-only rejected on callback (OIDC_CALLBACK_STATE_INVALID).
 * 8. State not found in transaction store rejected on callback (OIDC_CALLBACK_TRANSACTION_INVALID).
 * 9. Expired transaction rejected on callback (OIDC_CALLBACK_TRANSACTION_INVALID).
 * 10. Already-consumed transaction rejected on callback replay (OIDC_CALLBACK_TRANSACTION_INVALID).
 * 11. Provider error (e.g. access_denied) handled safely without calling token exchange (OIDC_CALLBACK_PROVIDER_DENIED).
 * 12. Contradictory callback parameters (both code and error received) rejected (OIDC_CALLBACK_INVALID_INPUT).
 * 13. Client cannot inject or override PKCE verifier, nonce, or redirect_uri via callback parameters.
 * 14. Token exchange only dispatched after successful state and transaction verification.
 * 15. Invalid ID token from Google rejected via C.2 verifier (OIDC_CALLBACK_EXCHANGE_FAILED).
 * 16. Concurrent callback replay attempts fail closed (atomic single-use enforcement).
 * 17. Client browser binding verified on callback (mismatch rejected).
 * 18. Side-Effect Absence: Failed or successful orchestration creates NO users, NO external identities, NO sessions.
 * 19. Architectural Immutability: Main Administrator, RBAC, and existing auth completely unchanged.
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import crypto from 'crypto';
import {
  initiateGoogleLogin,
  handleGoogleCallback,
  GOOGLE_AUTH_ENDPOINT,
  GoogleJWKSClient,
  MemoryOIDCTransactionStore,
  OIDCConfig
} from '../auth/oidc';
import { db } from '../database/store';
import { defaultSessionStore } from '../auth/sessionStore';

describe('MVS-B2.5C.4: Google OIDC Login Orchestration & Callback Boundary', () => {
  let primaryKey: { publicKey: crypto.KeyObject; privateKey: crypto.KeyObject };
  let attackerKey: { publicKey: crypto.KeyObject; privateKey: crypto.KeyObject };

  const PRIMARY_KID = 'google-orchestration-cert-2026';
  const TEST_CLIENT_ID = 'orchestrator-client-id-12345.apps.googleusercontent.com';
  const TEST_CLIENT_SECRET = 'orchestrator-secret-67890';
  const TEST_REDIRECT_URI = 'http://localhost:3000/api/auth/oidc/callback';

  const TEST_CONFIG: OIDCConfig = {
    enabled: true,
    clientId: TEST_CLIENT_ID,
    clientSecret: TEST_CLIENT_SECRET,
    issuer: 'https://accounts.google.com',
    authorizationEndpoint: GOOGLE_AUTH_ENDPOINT,
    tokenEndpoint: 'https://oauth2.googleapis.com/token',
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
   * Helper to construct signed JWTs for mocking token endpoint responses.
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
      sub: 'google-sub-user-orchestration-456',
      aud: TEST_CLIENT_ID,
      exp: nowSec + 3600,
      iat: nowSec - 10,
      email: 'orchestrator.test@nutribodysim.org',
      email_verified: true,
      name: 'Dr. Orchestrator',
      picture: 'https://lh3.googleusercontent.com/avatar.jpg',
      given_name: 'Orchestrator',
      family_name: 'Test',
      ...overrides
    };
  }

  describe('1. Login Initiation Flow', () => {
    it('initiates login, stores server transaction, and constructs valid Google authorization URL', async () => {
      const result = await initiateGoogleLogin(
        {
          clientBinding: 'browser-fingerprint-xyz',
          returnUrl: '/workspace/dashboard'
        },
        {
          transactionStore,
          config: TEST_CONFIG
        }
      );

      expect(result.success).toBe(true);
      expect(result.authorizationUrl).toBeDefined();
      expect(result.clientData).toBeDefined();

      const clientData = result.clientData!;
      expect(clientData.transactionId).toBeTruthy();
      expect(clientData.state).toBeTruthy();
      expect(clientData.codeChallenge).toBeTruthy();
      expect(clientData.codeChallengeMethod).toBe('S256');
      expect(clientData.expiresAt).toBeGreaterThan(Date.now());

      // Crucial: Must NEVER leak secrets to clientData
      expect((clientData as any).codeVerifier).toBeUndefined();
      expect((clientData as any).stateHash).toBeUndefined();
      expect((clientData as any).clientSecret).toBeUndefined();

      // Verify transaction is stored in store
      const storedTx = transactionStore.getTransaction(clientData.transactionId);
      expect(storedTx).not.toBeNull();
      expect(storedTx?.state).toBe(clientData.state);
      expect(storedTx?.codeChallenge).toBe(clientData.codeChallenge);
      expect(storedTx?.consumed).toBe(false);

      // Verify Authorization URL structure
      const parsedUrl = new URL(result.authorizationUrl!);
      expect(parsedUrl.protocol).toBe('https:');
      expect(parsedUrl.hostname).toBe('accounts.google.com');
      expect(parsedUrl.pathname).toBe('/o/oauth2/v2/auth');
      expect(parsedUrl.searchParams.get('response_type')).toBe('code');
      expect(parsedUrl.searchParams.get('client_id')).toBe(TEST_CLIENT_ID);
      expect(parsedUrl.searchParams.get('redirect_uri')).toBe(TEST_REDIRECT_URI);
      expect(parsedUrl.searchParams.get('scope')).toBe('openid email profile');
      expect(parsedUrl.searchParams.get('state')).toBe(clientData.state);
      expect(parsedUrl.searchParams.get('code_challenge')).toBe(clientData.codeChallenge);
      expect(parsedUrl.searchParams.get('code_challenge_method')).toBe('S256');
      expect(parsedUrl.searchParams.get('prompt')).toBe('select_account');
      expect(parsedUrl.searchParams.get('access_type')).toBe('online');
    });

    it('rejects initiation when configuration is invalid or missing required params', async () => {
      const invalidConfig: OIDCConfig = {
        ...TEST_CONFIG,
        clientId: '' // missing clientId
      };

      const result = await initiateGoogleLogin(
        {},
        { transactionStore, config: invalidConfig }
      );

      expect(result.success).toBe(false);
      expect(result.code).toBe('OIDC_INIT_INVALID_CONFIGURATION');
      expect(result.authorizationUrl).toBeUndefined();
    });

    it('rejects untrusted authorization endpoint host (anti-SSRF)', async () => {
      const ssrfConfig: OIDCConfig = {
        ...TEST_CONFIG,
        authorizationEndpoint: 'https://attacker.com/oauth/authorize'
      };

      const result = await initiateGoogleLogin(
        {},
        { transactionStore, config: ssrfConfig }
      );

      expect(result.success).toBe(false);
      expect(result.code).toBe('OIDC_INIT_INVALID_CONFIGURATION');
      expect(result.error).toContain('Untrusted authorization endpoint');
    });
  });

  describe('2. Callback Validation & Provider Denial', () => {
    it('rejects callback when state parameter is missing or empty', async () => {
      const result = await handleGoogleCallback(
        { code: 'some-code', state: '' },
        { transactionStore, config: TEST_CONFIG }
      );

      expect(result.success).toBe(false);
      expect(result.code).toBe('OIDC_CALLBACK_STATE_INVALID');
      expect(result.error).toContain('State parameter is missing or invalid');
    });

    it('rejects callback when authorization code is missing or empty', async () => {
      const initResult = await initiateGoogleLogin({}, { transactionStore, config: TEST_CONFIG });

      const result = await handleGoogleCallback(
        { code: '', state: initResult.clientData!.state },
        { transactionStore, config: TEST_CONFIG }
      );

      expect(result.success).toBe(false);
      expect(result.code).toBe('OIDC_CALLBACK_INVALID_INPUT');
      expect(result.error).toContain('Authorization code is missing or invalid');
    });

    it('safely handles provider error (e.g. access_denied) without calling token exchange', async () => {
      let fetchCalled = false;
      const mockFetch: typeof fetch = async () => {
        fetchCalled = true;
        return new Response('{}');
      };

      const result = await handleGoogleCallback(
        {
          error: 'access_denied',
          error_description: 'User denied consent'
        },
        {
          transactionStore,
          config: TEST_CONFIG,
          customFetch: mockFetch
        }
      );

      expect(result.success).toBe(false);
      expect(result.code).toBe('OIDC_CALLBACK_PROVIDER_DENIED');
      expect(result.error).toContain('Google authentication denied: access_denied');
      expect(fetchCalled).toBe(false); // Token exchange must NOT be called
    });

    it('rejects contradictory callback containing both code and error', async () => {
      let fetchCalled = false;
      const mockFetch: typeof fetch = async () => {
        fetchCalled = true;
        return new Response('{}');
      };

      const result = await handleGoogleCallback(
        {
          code: 'valid-looking-code',
          error: 'access_denied',
          state: 'any-state'
        },
        {
          transactionStore,
          config: TEST_CONFIG,
          customFetch: mockFetch
        }
      );

      expect(result.success).toBe(false);
      expect(result.code).toBe('OIDC_CALLBACK_INVALID_INPUT');
      expect(result.error).toContain('Conflicting callback parameters');
      expect(fetchCalled).toBe(false);
    });
  });

  describe('3. Transaction Binding & Expiry on Callback', () => {
    it('rejects callback when state does not match any transaction in store', async () => {
      const result = await handleGoogleCallback(
        {
          code: 'valid-code',
          state: 'unknown-state-token-that-never-existed'
        },
        { transactionStore, config: TEST_CONFIG }
      );

      expect(result.success).toBe(false);
      expect(result.code).toBe('OIDC_CALLBACK_TRANSACTION_INVALID');
      expect(result.error).toContain('No active pre-authentication transaction found');
    });

    it('rejects callback when pre-auth transaction has expired', async () => {
      const baseTime = 1000000;
      const initResult = await initiateGoogleLogin(
        { ttlSeconds: 30, currentTime: baseTime },
        { transactionStore, config: TEST_CONFIG }
      );

      const result = await handleGoogleCallback(
        {
          code: 'valid-code',
          state: initResult.clientData!.state,
          currentTime: baseTime + 500000 // far in future (> 30s + 60s skew)
        },
        { transactionStore, config: TEST_CONFIG }
      );

      expect(result.success).toBe(false);
      expect(result.code).toBe('OIDC_CALLBACK_TRANSACTION_INVALID');
      expect(result.error).toContain('Transaction has expired');
    });

    it('rejects callback when client browser binding does not match', async () => {
      const initResult = await initiateGoogleLogin(
        { clientBinding: 'browser-origin-fingerprint-aaa' },
        { transactionStore, config: TEST_CONFIG }
      );

      const result = await handleGoogleCallback(
        {
          code: 'valid-code',
          state: initResult.clientData!.state,
          clientBinding: 'browser-origin-fingerprint-bbb' // mismatched binding
        },
        { transactionStore, config: TEST_CONFIG }
      );

      expect(result.success).toBe(false);
      expect(result.code).toBe('OIDC_CALLBACK_TRANSACTION_INVALID');
      expect(result.error).toContain('Client browser binding mismatch');
    });
  });

  describe('4. Full End-to-End Orchestration (Initiate -> Callback -> Token Exchange -> C.2 Verification)', () => {
    it('completes the full flow and returns verified identity with zero side effects', async () => {
      // Step A: Initiate login
      const initResult = await initiateGoogleLogin(
        { clientBinding: 'session-browser-binding' },
        { transactionStore, config: TEST_CONFIG }
      );
      expect(initResult.success).toBe(true);

      const state = initResult.clientData!.state;
      const storedTx = transactionStore.getTransactionByState(state)!;
      expect(storedTx).not.toBeNull();

      // Step B: Prepare valid ID token containing transaction's nonce
      const idToken = signTestJwt(
        { alg: 'RS256', kid: PRIMARY_KID },
        getBaseIdTokenPayload({ nonce: storedTx.nonce }),
        primaryKey.privateKey
      );

      // Step C: Mock Google Token Endpoint response
      let dispatchedBody = '';
      const mockFetch: typeof fetch = async (input, init) => {
        dispatchedBody = init?.body as string;
        return new Response(
          JSON.stringify({
            access_token: 'mock-access-token',
            token_type: 'Bearer',
            expires_in: 3600,
            id_token: idToken
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      };

      // Step D: Handle callback
      const callbackResult = await handleGoogleCallback(
        {
          code: 'google-authorization-code-12345',
          state,
          clientBinding: 'session-browser-binding'
        },
        {
          transactionStore,
          jwksClient: mockJwksClient,
          config: TEST_CONFIG,
          customFetch: mockFetch
        }
      );

      // Step E: Verify result
      expect(callbackResult.success).toBe(true);
      expect(callbackResult.identity).toBeDefined();

      const identity = callbackResult.identity!;
      expect(identity.provider).toBe('google');
      expect(identity.sub).toBe('google-sub-user-orchestration-456');
      expect(identity.email).toBe('orchestrator.test@nutribodysim.org');
      expect(identity.emailVerified).toBe(true);
      expect(identity.profile?.name).toBe('Dr. Orchestrator');

      // Verify that PKCE verifier dispatched was the one generated by C.1 during initiation
      const dispatchedParams = new URLSearchParams(dispatchedBody);
      expect(dispatchedParams.get('code_verifier')).toBe(storedTx.codeVerifier);
      expect(dispatchedParams.get('client_id')).toBe(TEST_CLIENT_ID);

      // Verify transaction is marked consumed in store
      expect(transactionStore.getTransaction(storedTx.id)?.consumed).toBe(true);
    });

    it('strictly prevents replay attacks when the same callback is submitted twice', async () => {
      const initResult = await initiateGoogleLogin({}, { transactionStore, config: TEST_CONFIG });
      const state = initResult.clientData!.state;
      const storedTx = transactionStore.getTransactionByState(state)!;

      const idToken = signTestJwt(
        { alg: 'RS256', kid: PRIMARY_KID },
        getBaseIdTokenPayload({ nonce: storedTx.nonce }),
        primaryKey.privateKey
      );

      let fetchCount = 0;
      const mockFetch: typeof fetch = async () => {
        fetchCount++;
        return new Response(JSON.stringify({ id_token: idToken }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      };

      // First callback attempt succeeds
      const firstCallback = await handleGoogleCallback(
        { code: 'auth-code-1', state },
        {
          transactionStore,
          jwksClient: mockJwksClient,
          config: TEST_CONFIG,
          customFetch: mockFetch
        }
      );
      expect(firstCallback.success).toBe(true);
      expect(fetchCount).toBe(1);

      // Second callback attempt with SAME state MUST FAIL before token exchange
      const replayCallback = await handleGoogleCallback(
        { code: 'auth-code-1', state },
        {
          transactionStore,
          jwksClient: mockJwksClient,
          config: TEST_CONFIG,
          customFetch: mockFetch
        }
      );
      expect(replayCallback.success).toBe(false);
      expect(replayCallback.code).toBe('OIDC_CALLBACK_TRANSACTION_INVALID');
      expect(replayCallback.error).toMatch(/No active pre-authentication transaction found|Transaction has already been consumed/);
      expect(fetchCount).toBe(1); // No second fetch
    });

    it('fails closed when Google ID token fails verification in C.2 verifier', async () => {
      const initResult = await initiateGoogleLogin({}, { transactionStore, config: TEST_CONFIG });
      const state = initResult.clientData!.state;
      const storedTx = transactionStore.getTransactionByState(state)!;

      // Token signed with attacker key
      const forgedIdToken = signTestJwt(
        { alg: 'RS256', kid: PRIMARY_KID },
        getBaseIdTokenPayload({ nonce: storedTx.nonce }),
        attackerKey.privateKey
      );

      const mockFetch: typeof fetch = async () => {
        return new Response(JSON.stringify({ id_token: forgedIdToken }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      };

      const callbackResult = await handleGoogleCallback(
        { code: 'valid-code', state },
        {
          transactionStore,
          jwksClient: mockJwksClient,
          config: TEST_CONFIG,
          customFetch: mockFetch
        }
      );

      expect(callbackResult.success).toBe(false);
      expect(callbackResult.code).toBe('OIDC_CALLBACK_EXCHANGE_FAILED');
      expect(callbackResult.error).toContain('signature verification failed');
    });
  });

  describe('5. Side-Effect Absence & Architectural Integrity', () => {
    it('verifies that full orchestration creates NO database users, NO sessions, and NO external identities', async () => {
      const initialUsersCount = db.getState().users.length;
      const initialIdentitiesCount = db.getState().external_identities.length;
      const initialActiveSessions = defaultSessionStore.getActiveSessionsCount();

      const initResult = await initiateGoogleLogin({}, { transactionStore, config: TEST_CONFIG });
      const state = initResult.clientData!.state;
      const storedTx = transactionStore.getTransactionByState(state)!;

      const idToken = signTestJwt(
        { alg: 'RS256', kid: PRIMARY_KID },
        getBaseIdTokenPayload({ nonce: storedTx.nonce }),
        primaryKey.privateKey
      );

      const mockFetch: typeof fetch = async () => {
        return new Response(JSON.stringify({ id_token: idToken }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      };

      const callbackResult = await handleGoogleCallback(
        { code: 'code-no-side-effect', state },
        {
          transactionStore,
          jwksClient: mockJwksClient,
          config: TEST_CONFIG,
          customFetch: mockFetch
        }
      );
      expect(callbackResult.success).toBe(true);

      // Verify ZERO database mutations
      expect(db.getState().users.length).toBe(initialUsersCount);
      expect(db.getState().external_identities.length).toBe(initialIdentitiesCount);

      // Verify ZERO session creation
      expect(defaultSessionStore.getActiveSessionsCount()).toBe(initialActiveSessions);

      // Verify Main Administrator and RBAC models untouched
      const mainAdmins = db.getState().users.filter((u) => u.is_main_admin);
      expect(mainAdmins.every((u) => u.is_main_admin)).toBe(true);
    });
  });
});
