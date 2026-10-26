/**
 * NutriBodySim — Google OIDC ID Token Verification Engine (MVS-B2.5C.2)
 *
 * Implements strictly isolated, server-side cryptographic verification
 * of Google OpenID Connect ID Tokens.
 *
 * Security guarantees:
 * - Zero-Trust: Never trusts client-side decode or unverified payload.
 * - RS256 signature verification against Google's official public keys (via JWKS).
 * - Alg 'none' and non-RS256 algorithms are strictly rejected.
 * - Anti-SSRF: Never fetches keys from token-controlled headers (jku, x5u, jwk).
 * - Exact Issuer verification ('https://accounts.google.com' or 'accounts.google.com').
 * - Exact Audience verification with OIDC Core azp multi-audience validation.
 * - Strict expiration and issuance time boundaries with bounded clock-skew.
 * - Nonce validation bound to internal server pre-auth transactions.
 * - sub validation as immutable primary identity anchor (email is never used as anchor).
 * - email_verified strict boolean true check.
 * - Complete isolation: zero user session creation, zero DB mutations, zero public routes.
 * - Fail-closed: Never returns partial identities upon any validation failure.
 */

import crypto from 'crypto';
import {
  VerifyIDTokenOptions,
  VerifyIDTokenResult,
  VerifiedOIDCIdentity,
  IJWKSClient,
  OIDCConfig
} from './types';
import { timingSafeEqual } from './primitives';
import { defaultGoogleJWKSClient } from './jwks';
import { getOIDCConfig, ALLOWED_OIDC_ISSUERS } from './config';

/**
 * Standard JWT Header structure.
 */
interface JWTHeader {
  alg: string;
  kid?: string;
  typ?: string;
  jku?: unknown;
  x5u?: unknown;
  jwk?: unknown;
  x5c?: unknown;
}

/**
 * Google OIDC ID Token Payload structure per OpenID Connect Core 1.0.
 */
interface GoogleIDTokenPayload {
  iss: string;
  sub: string;
  aud: string | string[];
  exp: number;
  iat: number;
  nonce?: string;
  azp?: string;
  email?: string;
  email_verified?: boolean | string;
  name?: string;
  picture?: string;
  given_name?: string;
  family_name?: string;
  locale?: string;
}

/**
 * Decodes a base64url encoded string into a UTF-8 string safely.
 */
function decodeBase64Url(segment: string): string {
  try {
    return Buffer.from(segment, 'base64url').toString('utf8');
  } catch {
    throw new Error('BASE64URL_DECODE_FAILED');
  }
}

/**
 * Verifies a Google OIDC ID Token server-side with fail-closed security semantics.
 *
 * @param options Token string and expected parameters (nonce, audience, timestamps)
 * @param jwksClient Optional JWKS client instance (defaults to defaultGoogleJWKSClient)
 * @param config Optional OIDC configuration (defaults to runtime getOIDCConfig())
 */
export async function verifyGoogleIDToken(
  options: VerifyIDTokenOptions,
  jwksClient: IJWKSClient = defaultGoogleJWKSClient,
  config?: OIDCConfig
): Promise<VerifyIDTokenResult> {
  // 1. Validate argument presence
  if (!options || typeof options !== 'object') {
    return {
      success: false,
      code: 'OIDC_CONFIGURATION_INVALID',
      error: 'Invalid verification options'
    };
  }

  const { idToken } = options;
  if (!idToken || typeof idToken !== 'string') {
    return {
      success: false,
      code: 'OIDC_TOKEN_MALFORMED',
      error: 'ID Token must be a non-empty string'
    };
  }

  // 2. Resolve configuration & expected audience
  const effectiveConfig = config ?? getOIDCConfig();
  const expectedClientId = options.expectedClientId || effectiveConfig.clientId;
  if (!expectedClientId) {
    return {
      success: false,
      code: 'OIDC_CONFIGURATION_INVALID',
      error: 'Expected Google Client ID is not configured'
    };
  }

  // 3. Parse JWT segments (header.payload.signature)
  const segments = idToken.trim().split('.');
  if (segments.length !== 3) {
    return {
      success: false,
      code: 'OIDC_TOKEN_MALFORMED',
      error: `Invalid JWT format: expected 3 dot-separated segments, received ${segments.length}`
    };
  }

  const [rawHeader, rawPayload, rawSignature] = segments;
  if (!rawHeader || !rawPayload) {
    return {
      success: false,
      code: 'OIDC_TOKEN_MALFORMED',
      error: 'JWT contains empty header or payload segment'
    };
  }

  // 4. Decode & Validate Header
  let header: JWTHeader;
  try {
    const decodedHeader = decodeBase64Url(rawHeader);
    header = JSON.parse(decodedHeader);
  } catch {
    return {
      success: false,
      code: 'OIDC_TOKEN_MALFORMED',
      error: 'Failed to decode or parse JWT header JSON'
    };
  }

  if (!header || typeof header !== 'object') {
    return {
      success: false,
      code: 'OIDC_TOKEN_MALFORMED',
      error: 'JWT header must be a JSON object'
    };
  }

  // Anti-SSRF: Strictly forbid token-controlled key URLs or embedded keys
  if (header.jku !== undefined || header.x5u !== undefined || header.jwk !== undefined || header.x5c !== undefined) {
    return {
      success: false,
      code: 'OIDC_TOKEN_MALFORMED',
      error: 'Untrusted key location or embedded key found in header (jku/x5u/jwk/x5c rejected)'
    };
  }

  // Algorithm allowlist check: RS256 is strictly enforced
  if (!header.alg || typeof header.alg !== 'string') {
    return {
      success: false,
      code: 'OIDC_ALGORITHM_NOT_ALLOWED',
      error: 'JWT header is missing alg claim'
    };
  }

  if (header.alg === 'none') {
    return {
      success: false,
      code: 'OIDC_ALGORITHM_NOT_ALLOWED',
      error: "Unsigned JWTs with algorithm 'none' are strictly rejected"
    };
  }

  if (header.alg !== 'RS256') {
    return {
      success: false,
      code: 'OIDC_ALGORITHM_NOT_ALLOWED',
      error: `Unsupported algorithm '${header.alg}'. NutriBodySim strictly requires 'RS256'`
    };
  }

  if (!rawSignature) {
    return {
      success: false,
      code: 'OIDC_TOKEN_MALFORMED',
      error: 'JWT signature segment is empty'
    };
  }

  // Key ID (kid) presence check
  if (!header.kid || typeof header.kid !== 'string' || !header.kid.trim()) {
    return {
      success: false,
      code: 'OIDC_TOKEN_MALFORMED',
      error: 'JWT header is missing required kid (Key ID)'
    };
  }

  // 5. Retrieve Public Key from JWKS
  let publicKey: crypto.KeyObject | null;
  try {
    publicKey = await jwksClient.getKey(header.kid);
  } catch (jwksErr: any) {
    return {
      success: false,
      code: 'OIDC_JWKS_UNAVAILABLE',
      error: `Google JWKS is temporarily unavailable: ${jwksErr?.message || 'Network error'}`
    };
  }

  if (!publicKey) {
    return {
      success: false,
      code: 'OIDC_KEY_NOT_FOUND',
      error: `Key ID '${header.kid}' was not found in Google JWKS`
    };
  }

  // 6. Cryptographic Signature Verification
  try {
    const signingInput = `${rawHeader}.${rawPayload}`;
    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(signingInput);
    const isValid = verifier.verify(publicKey, rawSignature, 'base64url');

    if (!isValid) {
      return {
        success: false,
        code: 'OIDC_SIGNATURE_INVALID',
        error: 'Cryptographic signature verification failed'
      };
    }
  } catch {
    return {
      success: false,
      code: 'OIDC_SIGNATURE_INVALID',
      error: 'Signature verification error'
    };
  }

  // 7. Decode & Parse Payload
  let payload: GoogleIDTokenPayload;
  try {
    const decodedPayload = decodeBase64Url(rawPayload);
    payload = JSON.parse(decodedPayload);
  } catch {
    return {
      success: false,
      code: 'OIDC_TOKEN_MALFORMED',
      error: 'Failed to decode or parse JWT payload JSON'
    };
  }

  if (!payload || typeof payload !== 'object') {
    return {
      success: false,
      code: 'OIDC_TOKEN_MALFORMED',
      error: 'JWT payload must be a JSON object'
    };
  }

  // 8. Issuer Verification
  if (!payload.iss || typeof payload.iss !== 'string') {
    return {
      success: false,
      code: 'OIDC_ISSUER_INVALID',
      error: 'Token issuer (iss) claim is missing or invalid'
    };
  }

  if (!ALLOWED_OIDC_ISSUERS.includes(payload.iss)) {
    return {
      success: false,
      code: 'OIDC_ISSUER_INVALID',
      error: `Untrusted token issuer '${payload.iss}'. Allowed: ${ALLOWED_OIDC_ISSUERS.join(', ')}`
    };
  }

  // 9. Audience & Authorized Party (azp) Verification
  if (!payload.aud) {
    return {
      success: false,
      code: 'OIDC_REQUIRED_CLAIM_MISSING',
      error: 'Token audience (aud) claim is missing'
    };
  }

  if (typeof payload.aud === 'string') {
    if (payload.aud !== expectedClientId) {
      return {
        success: false,
        code: 'OIDC_AUDIENCE_INVALID',
        error: `Audience mismatch. Expected '${expectedClientId}'`
      };
    }
  } else if (Array.isArray(payload.aud)) {
    if (!payload.aud.includes(expectedClientId)) {
      return {
        success: false,
        code: 'OIDC_AUDIENCE_INVALID',
        error: `Audience list does not contain expected client ID '${expectedClientId}'`
      };
    }

    // OIDC Core 1.0 Section 3.1.3.7:
    // If ID Token contains multiple audiences, azp Claim MUST be present and match Client ID
    if (payload.aud.length > 1) {
      if (!payload.azp || payload.azp !== expectedClientId) {
        return {
          success: false,
          code: 'OIDC_AUDIENCE_INVALID',
          error: `Multiple audiences require authorized party (azp) matching '${expectedClientId}'`
        };
      }
    }
  } else {
    return {
      success: false,
      code: 'OIDC_AUDIENCE_INVALID',
      error: 'Audience claim must be a string or array of strings'
    };
  }

  // If azp is present (even with single audience), it must match expected client ID
  if (payload.azp !== undefined && payload.azp !== expectedClientId) {
    return {
      success: false,
      code: 'OIDC_AUDIENCE_INVALID',
      error: `Authorized party (azp) '${payload.azp}' does not match client ID '${expectedClientId}'`
    };
  }

  // 10. Expiration (exp) and Issuance Time (iat) Verification with Clock Skew
  const clockSkewSec = options.clockSkewToleranceSeconds ?? effectiveConfig.clockSkewToleranceSeconds ?? 60;
  const currentEpochMs = options.currentTime ?? Date.now();
  const currentEpochSec = Math.floor(currentEpochMs / 1000);

  if (typeof payload.exp !== 'number' || isNaN(payload.exp)) {
    return {
      success: false,
      code: 'OIDC_REQUIRED_CLAIM_MISSING',
      error: 'Expiration claim (exp) is missing or invalid'
    };
  }

  if (currentEpochSec > payload.exp + clockSkewSec) {
    return {
      success: false,
      code: 'OIDC_TOKEN_EXPIRED',
      error: `ID Token has expired (exp: ${payload.exp}, current: ${currentEpochSec}, clockSkew: ${clockSkewSec}s)`
    };
  }

  if (typeof payload.iat !== 'number' || isNaN(payload.iat)) {
    return {
      success: false,
      code: 'OIDC_REQUIRED_CLAIM_MISSING',
      error: 'Issued-at claim (iat) is missing or invalid'
    };
  }

  // Reject tokens issued excessively far in the future
  if (payload.iat > currentEpochSec + clockSkewSec) {
    return {
      success: false,
      code: 'OIDC_REQUIRED_CLAIM_MISSING',
      error: `Token issued in the future (iat: ${payload.iat}, current: ${currentEpochSec}, clockSkew: ${clockSkewSec}s)`
    };
  }

  // 11. Subject (sub) Verification
  if (!payload.sub || typeof payload.sub !== 'string' || !payload.sub.trim()) {
    return {
      success: false,
      code: 'OIDC_REQUIRED_CLAIM_MISSING',
      error: 'Subject identifier (sub) claim is missing or empty'
    };
  }

  if (payload.sub.length > 255) {
    return {
      success: false,
      code: 'OIDC_REQUIRED_CLAIM_MISSING',
      error: 'Subject identifier exceeds maximum 255 characters'
    };
  }

  // 12. Nonce Verification (Replay Mitigation bound to pre-auth server context)
  let expectedNonce = options.expectedNonce;

  // If transactionId and transactionStore were provided, resolve nonce from server transaction
  if (options.transactionId && options.transactionStore) {
    const tx = options.transactionStore.getTransaction(options.transactionId);
    if (!tx) {
      return {
        success: false,
        code: 'OIDC_NONCE_INVALID',
        error: 'Pre-authentication transaction not found in store'
      };
    }
    expectedNonce = tx.nonce;
  }

  if (expectedNonce !== undefined) {
    if (!payload.nonce || typeof payload.nonce !== 'string') {
      return {
        success: false,
        code: 'OIDC_NONCE_INVALID',
        error: "Token is missing expected 'nonce' claim"
      };
    }

    if (!timingSafeEqual(payload.nonce, expectedNonce)) {
      return {
        success: false,
        code: 'OIDC_NONCE_INVALID',
        error: 'Nonce mismatch between ID Token and expected server transaction'
      };
    }
  }

  // 13. Email & Profile Claims Validation
  let emailVerified: boolean | undefined = undefined;
  if (payload.email_verified !== undefined) {
    // Must be boolean true; string 'true' or number 1 is not accepted as verified
    emailVerified = payload.email_verified === true;
  }

  let email: string | undefined = undefined;
  if (typeof payload.email === 'string' && payload.email.includes('@')) {
    email = payload.email.trim();
  }

  // Structurally validated non-privileged profile data
  const profile: VerifiedOIDCIdentity['profile'] = {};
  if (typeof payload.name === 'string' && payload.name.trim()) {
    profile.name = payload.name.trim();
  }
  if (typeof payload.picture === 'string' && (payload.picture.startsWith('https://') || payload.picture.startsWith('http://'))) {
    profile.picture = payload.picture.trim();
  }
  if (typeof payload.given_name === 'string' && payload.given_name.trim()) {
    profile.givenName = payload.given_name.trim();
  }
  if (typeof payload.family_name === 'string' && payload.family_name.trim()) {
    profile.familyName = payload.family_name.trim();
  }
  if (typeof payload.locale === 'string' && payload.locale.trim()) {
    profile.locale = payload.locale.trim();
  }

  // 14. Construct Clean Verified Identity Object
  const identity: VerifiedOIDCIdentity = {
    provider: 'google',
    sub: payload.sub,
    issuer: payload.iss,
    audience: payload.aud,
    issuedAt: payload.iat * 1000,
    expiresAt: payload.exp * 1000,
    email,
    emailVerified,
    profile: Object.keys(profile).length > 0 ? profile : undefined
  };

  return {
    success: true,
    identity
  };
}
