/**
 * NutriBodySim — Google OIDC Authorization Code Exchange Handler (MVS-B2.5C.3)
 *
 * Implements isolated, server-side exchange of Google Authorization Codes
 * for verified OpenID Connect identities using PKCE S256.
 *
 * Security guarantees:
 * - Fixed Token Endpoint: Locked to 'https://oauth2.googleapis.com/token' (anti-SSRF).
 * - Atomic Single-Use Consumption: Transaction consumed in store BEFORE network dispatch.
 * - Server-Authoritative PKCE & Nonce: Verifier and nonce strictly resolved from server transaction.
 * - No Automatic Retry: Prevents reuse of single-use authorization code on ambiguous network failure.
 * - Anti-Redirect: HTTP redirects from token endpoint are rejected explicitly.
 * - Bounded Timeout: 5-second network timeout via AbortController.
 * - Single Verification Source: ID token verified exclusively via MVS-B2.5C.2 verifier.
 * - Zero Leakage: Raw tokens, client secrets, code verifiers, and nonces are never returned or logged.
 * - Side-Effect Absence: Zero database mutations, zero user session creation, zero public endpoints.
 */

import {
  ExchangeAuthorizationCodeOptions,
  ExchangeAuthorizationCodeResult,
  ExchangeDependencies,
  OIDCExchangeErrorCode
} from './types';
import { getRuntimeOIDCTransactionStore } from './runtimeTransactionStore';
import { defaultGoogleJWKSClient } from './jwks';
import { verifyGoogleIDToken } from './verifier';
import { getOIDCConfig } from './config';

export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
export const TOKEN_REQUEST_TIMEOUT_MS = 5000;
export const MAX_ERROR_BODY_LENGTH = 512;

/**
 * Maps transaction consumption error codes to token exchange error codes.
 */
function mapTransactionErrorCode(code?: string): OIDCExchangeErrorCode {
  switch (code) {
    case 'TRANSACTION_EXPIRED':
      return 'OIDC_TRANSACTION_EXPIRED';
    case 'TRANSACTION_ALREADY_CONSUMED':
      return 'OIDC_TRANSACTION_ALREADY_CONSUMED';
    case 'TRANSACTION_NOT_FOUND':
    case 'INVALID_STATE':
    case 'CLIENT_BINDING_MISMATCH':
    default:
      return 'OIDC_TRANSACTION_NOT_FOUND';
  }
}

/**
 * Sanitizes an error message from the token endpoint to prevent logging sensitive details.
 */
function sanitizeEndpointError(raw: string): string {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      const error = typeof parsed.error === 'string' ? parsed.error : 'unknown_error';
      const desc = typeof parsed.error_description === 'string' ? parsed.error_description : '';
      return desc ? `${error}: ${desc}`.slice(0, MAX_ERROR_BODY_LENGTH) : error;
    }
  } catch {
    // Non-JSON error text
  }
  return raw.replace(/[\r\n\t]/g, ' ').slice(0, MAX_ERROR_BODY_LENGTH);
}

/**
 * Exchanges a Google Authorization Code for a verified OIDC Identity.
 *
 * @param options Client callback parameters (code, state, transactionId)
 * @param dependencies Optional injectable dependencies for testing (store, jwks, config, fetch)
 */
export async function exchangeGoogleAuthorizationCode(
  options: ExchangeAuthorizationCodeOptions,
  dependencies?: ExchangeDependencies
): Promise<ExchangeAuthorizationCodeResult> {
  // 1. Input Validation
  if (!options || typeof options !== 'object') {
    return {
      success: false,
      code: 'OIDC_EXCHANGE_INVALID_INPUT',
      error: 'Invalid exchange options provided'
    };
  }

  const { code, state, transactionId, clientBinding, currentTime } = options;

  if (!code || typeof code !== 'string' || !code.trim()) {
    return {
      success: false,
      code: 'OIDC_EXCHANGE_INVALID_INPUT',
      error: 'Authorization code is required and must be a non-empty string'
    };
  }

  if (!state || typeof state !== 'string' || !state.trim()) {
    return {
      success: false,
      code: 'OIDC_EXCHANGE_INVALID_INPUT',
      error: 'State parameter is required and must be a non-empty string'
    };
  }

  // 2. Resolve Configuration
  const config = dependencies?.config ?? getOIDCConfig();
  if (!config.clientId || typeof config.clientId !== 'string') {
    return {
      success: false,
      code: 'OIDC_CONFIGURATION_INVALID',
      error: 'Google Client ID is not configured'
    };
  }

  // 3. Atomic Transaction Consumption (Single-Use Enforcement)
  const store = dependencies?.transactionStore ?? getRuntimeOIDCTransactionStore();
  const consumeResult = await store.consumeTransaction({
    state,
    transactionId,
    clientBinding,
    currentTime
  });

  if (!consumeResult.success || !consumeResult.transaction) {
    return {
      success: false,
      code: mapTransactionErrorCode(consumeResult.code),
      error: consumeResult.error || 'Failed to consume pre-authentication transaction'
    };
  }

  const transaction = consumeResult.transaction;
  const codeVerifier = transaction.codeVerifier;
  const expectedNonce = transaction.nonce;
  const redirectUri = transaction.redirectUri || config.redirectUri;

  if (!codeVerifier) {
    return {
      success: false,
      code: 'OIDC_CONFIGURATION_INVALID',
      error: 'Transaction record is missing PKCE code_verifier'
    };
  }

  if (!redirectUri) {
    return {
      success: false,
      code: 'OIDC_CONFIGURATION_INVALID',
      error: 'No redirect URI configured in transaction or system settings'
    };
  }

  // 4. Construct Form-URLEncoded Request Body
  const bodyParams = new URLSearchParams();
  bodyParams.set('grant_type', 'authorization_code');
  bodyParams.set('code', code.trim());
  bodyParams.set('client_id', config.clientId);
  bodyParams.set('redirect_uri', redirectUri);
  bodyParams.set('code_verifier', codeVerifier);

  if (config.clientSecret) {
    bodyParams.set('client_secret', config.clientSecret);
  }

  // 5. Execute HTTP POST to Fixed Google Token Endpoint
  const fetchFn = dependencies?.customFetch ?? fetch;
  let response: Response;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TOKEN_REQUEST_TIMEOUT_MS);

    response = await fetchFn(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json'
      },
      body: bodyParams.toString(),
      redirect: 'error',
      signal: controller.signal
    });

    clearTimeout(timeoutId);
  } catch (networkError: any) {
    // CRITICAL: NO AUTOMATIC RETRY.
    // Authorization code is single-use and could have already been consumed by Google.
    return {
      success: false,
      code: 'OIDC_TOKEN_ENDPOINT_UNAVAILABLE',
      error: `Token endpoint communication failed: ${networkError?.message || 'Network error'}`
    };
  }

  // 6. Handle HTTP Redirects (Anti-Redirection Enforcement)
  if (response.status >= 300 && response.status < 400) {
    return {
      success: false,
      code: 'OIDC_TOKEN_ENDPOINT_REJECTED',
      error: `Unexpected redirect (HTTP ${response.status}) received from token endpoint`
    };
  }

  // 7. Handle Non-2xx HTTP Responses
  if (!response.ok) {
    let errorDetails = '';
    try {
      const rawBody = await response.text();
      errorDetails = sanitizeEndpointError(rawBody);
    } catch {
      errorDetails = `HTTP ${response.status}`;
    }

    return {
      success: false,
      code: 'OIDC_TOKEN_ENDPOINT_REJECTED',
      error: `Google token endpoint rejected authorization code (HTTP ${response.status}: ${errorDetails})`
    };
  }

  // 8. Parse and Validate Token Response Structure
  let tokenData: any;
  try {
    tokenData = await response.json();
  } catch {
    return {
      success: false,
      code: 'OIDC_TOKEN_RESPONSE_INVALID',
      error: 'Token endpoint returned malformed or non-JSON response'
    };
  }

  if (!tokenData || typeof tokenData !== 'object') {
    return {
      success: false,
      code: 'OIDC_TOKEN_RESPONSE_INVALID',
      error: 'Token endpoint response is not a valid JSON object'
    };
  }

  if (!tokenData.id_token || typeof tokenData.id_token !== 'string' || !tokenData.id_token.trim()) {
    return {
      success: false,
      code: 'OIDC_TOKEN_RESPONSE_INVALID',
      error: "Token endpoint response is missing required 'id_token' claim"
    };
  }

  // 9. Verify ID Token via MVS-B2.5C.2 Verifier
  const jwksClient = dependencies?.jwksClient ?? defaultGoogleJWKSClient;
  const verifyResult = await verifyGoogleIDToken(
    {
      idToken: tokenData.id_token,
      expectedNonce,
      expectedClientId: config.clientId,
      currentTime,
      clockSkewToleranceSeconds: config.clockSkewToleranceSeconds
    },
    jwksClient,
    config
  );

  if (!verifyResult.success || !verifyResult.identity) {
    return {
      success: false,
      code: 'OIDC_ID_TOKEN_VERIFICATION_FAILED',
      error: verifyResult.error || 'ID Token verification failed'
    };
  }

  // 10. Return Clean Verified Identity (Zero Token or Secret Leakage)
  return {
    success: true,
    identity: verifyResult.identity
  };
}
