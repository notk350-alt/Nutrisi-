/**
 * NutriBodySim — Google OIDC Login Orchestration & Callback Boundary (MVS-B2.5C.4)
 *
 * Implements isolated, end-to-end orchestration connecting:
 * - C.1: Cryptographic state, nonce, and PKCE S256 transaction store.
 * - C.2: Zero-trust server-side Google ID Token verification engine.
 * - C.3: Atomic single-use Authorization Code exchange handler.
 *
 * Security guarantees:
 * - Pure Orchestration: Connects C.1 -> C.2 -> C.3 without bypassing any security primitive.
 * - Anti-SSRF: Hardcoded authorization endpoint and token endpoint boundaries.
 * - Pre-auth Transaction Binding: State and code_verifier remain server-authoritative.
 * - Strict Callback Validation: Validates types, rejects conflicting parameters (code + error).
 * - Provider Error Sanitization: Safely handles access_denied / user cancellations.
 * - Replay Mitigation: Double-submit replay or race condition fails closed atomically.
 * - Zero Side-Effects: NO database mutations, NO user creation, NO ExternalIdentity linking,
 *   NO session creation, and NO public API endpoints.
 */

import {
  InitiateLoginOptions,
  InitiateLoginResult,
  HandleCallbackOptions,
  HandleCallbackResult,
  OrchestratorDependencies
} from './types';
import { constructAuthorizationUrl, timingSafeEqual } from './primitives';
import { defaultOIDCTransactionStore } from './transactionStore';
import { defaultGoogleJWKSClient } from './jwks';
import { exchangeGoogleAuthorizationCode } from './tokenExchange';
import { getOIDCConfig, validateOIDCConfig } from './config';

export const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_AUTH_HOST = 'accounts.google.com';
export const MAX_PARAM_LENGTH = 1024;

/**
 * Validates that an authorization endpoint targets the official Google OAuth 2.0 host.
 */
function validateAuthorizationEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return url.protocol === 'https:' && url.hostname === GOOGLE_AUTH_HOST;
  } catch {
    return false;
  }
}

/**
 * Initiates an isolated Google OIDC Login flow.
 * Generates cryptographic state, nonce, and PKCE S256 verifier/challenge,
 * registers the pre-auth transaction in the store, and constructs the authorization URL.
 *
 * @param options Initiation parameters (clientBinding, returnUrl, ttlSeconds, currentTime)
 * @param dependencies Injectable dependencies for testing (store, config)
 */
export async function initiateGoogleLogin(
  options?: InitiateLoginOptions,
  dependencies?: OrchestratorDependencies
): Promise<InitiateLoginResult> {
  // 1. Resolve & Validate Configuration
  const config = dependencies?.config ?? getOIDCConfig();
  const configValidation = validateOIDCConfig(config);

  if (!configValidation.valid) {
    return {
      success: false,
      code: 'OIDC_INIT_INVALID_CONFIGURATION',
      error: `Invalid OIDC configuration: ${configValidation.errors.join('; ')}`
    };
  }

  const authEndpoint = config.authorizationEndpoint || GOOGLE_AUTH_ENDPOINT;
  if (!validateAuthorizationEndpoint(authEndpoint)) {
    return {
      success: false,
      code: 'OIDC_INIT_INVALID_CONFIGURATION',
      error: `Untrusted authorization endpoint '${authEndpoint}'. Host must be '${GOOGLE_AUTH_HOST}'`
    };
  }

  if (!config.clientId || !config.redirectUri) {
    return {
      success: false,
      code: 'OIDC_INIT_INVALID_CONFIGURATION',
      error: 'Client ID and Redirect URI must be configured to initiate Google login'
    };
  }

  // 2. Create Pre-Auth Server Transaction
  const store = dependencies?.transactionStore ?? defaultOIDCTransactionStore;
  let created: ReturnType<typeof store.createTransaction>;

  try {
    created = store.createTransaction({
      clientBinding: options?.clientBinding,
      returnUrl: options?.returnUrl,
      ttlSeconds: options?.ttlSeconds,
      currentTime: options?.currentTime,
      redirectUri: config.redirectUri
    });
  } catch (storeError: any) {
    return {
      success: false,
      code: 'OIDC_INIT_TRANSACTION_CREATION_FAILED',
      error: `Transaction store rejected transaction creation: ${storeError?.message || 'Storage limit reached'}`
    };
  }

  const { transaction, clientData } = created;

  // 3. Construct Google Authorization URL
  let authorizationUrl: string;
  try {
    authorizationUrl = constructAuthorizationUrl({
      authorizationEndpoint: authEndpoint,
      clientId: config.clientId,
      redirectUri: config.redirectUri,
      state: transaction.state,
      nonce: transaction.nonce,
      codeChallenge: transaction.codeChallenge,
      codeChallengeMethod: 'S256',
      scopes: config.allowedScopes,
      prompt: 'select_account',
      accessType: 'online'
    });
  } catch (constructError: any) {
    return {
      success: false,
      code: 'OIDC_INIT_TRANSACTION_CREATION_FAILED',
      error: `Failed to construct authorization URL: ${constructError?.message || 'Parameter error'}`
    };
  }

  // 4. Return safe client projection (MUST NOT expose code_verifier, stateHash, or secrets)
  clientData.authorizationUrl = authorizationUrl;

  return {
    success: true,
    authorizationUrl,
    clientData
  };
}

/**
 * Handles the Google OAuth 2.0 / OIDC callback boundary.
 * Strictly validates untrusted query parameters, verifies transaction presence and state,
 * and delegates atomic token exchange and ID token verification to C.3 and C.2.
 *
 * @param options Untrusted parameters received from Google callback query string
 * @param dependencies Injectable dependencies for testing (store, jwks, config, customFetch)
 */
export async function handleGoogleCallback(
  options: HandleCallbackOptions,
  dependencies?: OrchestratorDependencies
): Promise<HandleCallbackResult> {
  // 1. Validate Input Object
  if (!options || typeof options !== 'object') {
    return {
      success: false,
      code: 'OIDC_CALLBACK_INVALID_INPUT',
      error: 'Invalid callback parameters provided'
    };
  }

  const { code, state, error, error_description, clientBinding, currentTime } = options;

  // 2. Detect Contradictory / Conflicting Parameters
  const hasCode = typeof code === 'string' && code.trim().length > 0;
  const hasError = typeof error === 'string' && error.trim().length > 0;

  if (hasCode && hasError) {
    return {
      success: false,
      code: 'OIDC_CALLBACK_INVALID_INPUT',
      error: 'Conflicting callback parameters: both code and error received from provider'
    };
  }

  // 3. Handle Provider Errors (e.g. user cancelled, interaction_required)
  if (hasError) {
    const sanitizedError = (error as string).trim().slice(0, 128);
    const sanitizedDesc = typeof error_description === 'string' ? error_description.trim().slice(0, 256) : '';
    return {
      success: false,
      code: 'OIDC_CALLBACK_PROVIDER_DENIED',
      error: `Google authentication denied: ${sanitizedError}${sanitizedDesc ? ` (${sanitizedDesc})` : ''}`
    };
  }

  // 4. Validate State Parameter
  if (!state || typeof state !== 'string' || !state.trim()) {
    return {
      success: false,
      code: 'OIDC_CALLBACK_STATE_INVALID',
      error: 'State parameter is missing or invalid'
    };
  }

  const trimmedState = state.trim();
  if (trimmedState.length > MAX_PARAM_LENGTH) {
    return {
      success: false,
      code: 'OIDC_CALLBACK_STATE_INVALID',
      error: 'State parameter exceeds maximum permitted length'
    };
  }

  // 5. Validate Authorization Code Parameter
  if (!code || typeof code !== 'string' || !code.trim()) {
    return {
      success: false,
      code: 'OIDC_CALLBACK_INVALID_INPUT',
      error: 'Authorization code is missing or invalid'
    };
  }

  const trimmedCode = code.trim();
  if (trimmedCode.length > MAX_PARAM_LENGTH) {
    return {
      success: false,
      code: 'OIDC_CALLBACK_INVALID_INPUT',
      error: 'Authorization code exceeds maximum permitted length'
    };
  }

  // 6. Pre-Validate Transaction Presence & Expiry (Without Premature Consumption)
  const store = dependencies?.transactionStore ?? defaultOIDCTransactionStore;
  const existingTx = store.getTransactionByState(trimmedState);

  if (!existingTx) {
    return {
      success: false,
      code: 'OIDC_CALLBACK_TRANSACTION_INVALID',
      error: 'No active pre-authentication transaction found for state'
    };
  }

  if (existingTx.consumed) {
    return {
      success: false,
      code: 'OIDC_CALLBACK_TRANSACTION_INVALID',
      error: 'Transaction has already been consumed'
    };
  }

  const config = dependencies?.config ?? getOIDCConfig();
  const now = currentTime ?? Date.now();
  const clockSkewToleranceMs = (config.clockSkewToleranceSeconds ?? 60) * 1000;

  if (now > existingTx.expiresAt + clockSkewToleranceMs) {
    return {
      success: false,
      code: 'OIDC_CALLBACK_TRANSACTION_INVALID',
      error: 'Transaction has expired'
    };
  }

  if (existingTx.clientBinding !== undefined) {
    if (!clientBinding || !timingSafeEqual(existingTx.clientBinding, clientBinding)) {
      return {
        success: false,
        code: 'OIDC_CALLBACK_TRANSACTION_INVALID',
        error: 'Client browser binding mismatch'
      };
    }
  }

  // 7. Delegate Atomic Token Exchange to C.3 Handler
  const exchangeResult = await exchangeGoogleAuthorizationCode(
    {
      code: trimmedCode,
      state: trimmedState,
      transactionId: existingTx.id,
      clientBinding,
      currentTime
    },
    {
      transactionStore: store,
      jwksClient: dependencies?.jwksClient ?? defaultGoogleJWKSClient,
      config,
      customFetch: dependencies?.customFetch
    }
  );

  if (!exchangeResult.success || !exchangeResult.identity) {
    return {
      success: false,
      code: 'OIDC_CALLBACK_EXCHANGE_FAILED',
      error: exchangeResult.error || 'Token exchange failed'
    };
  }

  // 8. Return Clean Verified Identity (Zero Side-Effects)
  return {
    success: true,
    identity: exchangeResult.identity
  };
}
