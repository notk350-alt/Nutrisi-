/**
 * NutriBodySim — OIDC Cryptographic & Security Primitives (MVS-B2.5C.1)
 *
 * Implements pure, isolated cryptographic functions for:
 * - RFC 7636 PKCE (S256 code_verifier and code_challenge generation & verification)
 * - Anti-CSRF state token generation, validation, and constant-time comparison
 * - Replay-mitigation nonce generation and format validation
 * - Timing-attack resistant string comparison using Node.js crypto.timingSafeEqual
 *
 * Security guarantees:
 * - Cryptographically secure pseudo-random number generator (CSPRNG via node:crypto).
 * - Zero reliance on Math.random() or non-cryptographic RNGs.
 * - S256 is the ONLY permitted PKCE challenge method (plain method is strictly rejected).
 * - Timing-safe equality prevents timing side-channel attacks on state and nonce validation.
 * - Strict length and character set validation per RFC 7636 Section 4.1.
 */

import crypto from 'crypto';

/**
 * RFC 7636 Section 4.1 unreserved character set:
 * unreserved = ALPHA / DIGIT / "-" / "." / "_" / "~"
 * Total alphabet size: 26 + 26 + 10 + 4 = 66 characters.
 */
export const PKCE_UNRESERVED_CHARACTERS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';

export const MIN_CODE_VERIFIER_LENGTH = 43;
export const MAX_CODE_VERIFIER_LENGTH = 128;
export const DEFAULT_CODE_VERIFIER_LENGTH = 64;

export const MIN_STATE_BYTES = 32; // 256 bits of entropy
export const MIN_NONCE_BYTES = 16; // 128 bits minimum, 256 bits recommended (32 bytes)
export const DEFAULT_ENTROPY_BYTES = 32;

/**
 * Compares two strings in constant time to prevent timing side-channel attacks.
 * If string lengths differ, performs a dummy comparison against an identical-length buffer
 * to avoid leaking length discrepancies via early exit timing.
 */
export function timingSafeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }

  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');

  if (bufA.length !== bufB.length) {
    // Constant-time dummy comparison to mitigate timing leak on length
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }

  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Generates a cryptographically secure random hexadecimal string with specified byte entropy.
 * Default 32 bytes = 256 bits entropy -> 64 hex characters.
 */
export function generateCryptographicToken(byteLength: number = DEFAULT_ENTROPY_BYTES): string {
  if (typeof byteLength !== 'number' || isNaN(byteLength) || byteLength <= 0) {
    throw new Error('Entropy byteLength must be a positive integer');
  }
  if (byteLength > 1024) {
    throw new Error('Entropy byteLength exceeds safe maximum (1024 bytes)');
  }
  return crypto.randomBytes(byteLength).toString('hex');
}

/**
 * Generates a 256-bit cryptographically secure state parameter for CSRF mitigation.
 * Returns 64 hex characters.
 */
export function generateState(byteLength: number = DEFAULT_ENTROPY_BYTES): string {
  const bytes = byteLength < MIN_STATE_BYTES ? MIN_STATE_BYTES : byteLength;
  return generateCryptographicToken(bytes);
}

/**
 * Alias for generateState.
 */
export const generateStateToken = generateState;

/**
 * Generates a SHA-256 hash of the state parameter for secure indexing in storage.
 */
export function hashState(state: string): string {
  if (!state || typeof state !== 'string') {
    throw new Error('State must be a non-empty string to hash');
  }
  return crypto.createHash('sha256').update(state, 'utf8').digest('hex');
}

/**
 * Validates the format, length, and content of an untrusted state parameter.
 */
export function validateState(state: unknown): { valid: boolean; error?: string } {
  if (typeof state !== 'string') {
    return { valid: false, error: 'State must be a string' };
  }
  const trimmed = state.trim();
  if (trimmed.length < MIN_STATE_BYTES * 2) {
    return {
      valid: false,
      error: `State length (${trimmed.length}) is below required 256-bit entropy (${MIN_STATE_BYTES * 2} characters)`
    };
  }
  if (trimmed.length > 512) {
    return { valid: false, error: 'State length exceeds maximum permitted length (512 characters)' };
  }
  if (!/^[a-fA-F0-9]+$/.test(trimmed)) {
    return { valid: false, error: 'State contains invalid characters (hexadecimal expected)' };
  }
  return { valid: true };
}

/**
 * Boolean validator helper for state token.
 */
export function validateStateToken(state: unknown): boolean {
  return validateState(state).valid;
}

/**
 * Generates a cryptographically secure nonce to mitigate ID Token replay attacks.
 * Default 32 bytes = 256 bits entropy -> 64 hex characters.
 */
export function generateNonce(byteLength: number = DEFAULT_ENTROPY_BYTES): string {
  const bytes = byteLength < MIN_NONCE_BYTES ? MIN_NONCE_BYTES : byteLength;
  return generateCryptographicToken(bytes);
}

/**
 * Validates the format and entropy of a nonce parameter.
 */
export function validateNonce(nonce: unknown): { valid: boolean; error?: string } {
  if (typeof nonce !== 'string') {
    return { valid: false, error: 'Nonce must be a string' };
  }
  const trimmed = nonce.trim();
  if (trimmed.length < MIN_NONCE_BYTES * 2) {
    return {
      valid: false,
      error: `Nonce length (${trimmed.length}) is below required minimum (${MIN_NONCE_BYTES * 2} characters)`
    };
  }
  if (trimmed.length > 512) {
    return { valid: false, error: 'Nonce length exceeds maximum permitted length (512 characters)' };
  }
  if (!/^[a-fA-F0-9_-]+$/.test(trimmed)) {
    return { valid: false, error: 'Nonce contains invalid characters' };
  }
  return { valid: true };
}

/**
 * Boolean validator helper for nonce token.
 */
export function validateNonceToken(nonce: unknown): boolean {
  return validateNonce(nonce).valid;
}

/**
 * Generates an RFC 7636 PKCE code_verifier using rejection sampling over
 * the unreserved character set [A-Za-z0-9-._~] to eliminate modulo bias.
 *
 * @param length Desired length, must be between 43 and 128 (default 64)
 */
export function generateCodeVerifier(length: number = DEFAULT_CODE_VERIFIER_LENGTH): string {
  if (typeof length !== 'number' || isNaN(length)) {
    throw new Error('Code verifier length must be a valid number');
  }
  if (length < MIN_CODE_VERIFIER_LENGTH || length > MAX_CODE_VERIFIER_LENGTH) {
    throw new Error(
      `Code verifier length must be between ${MIN_CODE_VERIFIER_LENGTH} and ${MAX_CODE_VERIFIER_LENGTH} per RFC 7636`
    );
  }

  const charset = PKCE_UNRESERVED_CHARACTERS;
  const charsetLength = charset.length; // 66
  // Rejection sampling upper bound to ensure perfectly uniform distribution:
  // Largest multiple of 66 less than 256 is 66 * 3 = 198
  const maxValidByte = 256 - (256 % charsetLength);

  let result = '';
  while (result.length < length) {
    const bytesNeeded = (length - result.length) * 2;
    const randomBytes = crypto.randomBytes(bytesNeeded);
    for (let i = 0; i < randomBytes.length && result.length < length; i++) {
      const byte = randomBytes[i];
      if (byte < maxValidByte) {
        result += charset[byte % charsetLength];
      }
    }
  }

  return result;
}

/**
 * Validates whether an incoming code_verifier satisfies RFC 7636 Section 4.1 syntax:
 * - Length between 43 and 128 characters inclusive
 * - Composed entirely of unreserved characters: [A-Z], [a-z], [0-9], "-", ".", "_", "~"
 */
export function validateCodeVerifier(verifier: unknown): { valid: boolean; error?: string } {
  if (typeof verifier !== 'string') {
    return { valid: false, error: 'Code verifier must be a string' };
  }
  if (verifier.length < MIN_CODE_VERIFIER_LENGTH) {
    return {
      valid: false,
      error: `Code verifier length (${verifier.length}) is below RFC 7636 minimum of ${MIN_CODE_VERIFIER_LENGTH}`
    };
  }
  if (verifier.length > MAX_CODE_VERIFIER_LENGTH) {
    return {
      valid: false,
      error: `Code verifier length (${verifier.length}) exceeds RFC 7636 maximum of ${MAX_CODE_VERIFIER_LENGTH}`
    };
  }
  // Check characters against unreserved set
  for (let i = 0; i < verifier.length; i++) {
    if (!PKCE_UNRESERVED_CHARACTERS.includes(verifier[i])) {
      return {
        valid: false,
        error: 'Code verifier contains invalid characters not allowed by RFC 7636 Section 4.1'
      };
    }
  }
  return { valid: true };
}

/**
 * Calculates the RFC 7636 PKCE code_challenge from a code_verifier.
 *
 * Algorithm:
 * BASE64URL-ENCODE(SHA256(ASCII(code_verifier)))
 *
 * NOTE: The 'plain' method is explicitly prohibited for security hardening.
 */
export function calculateCodeChallenge(
  verifier: string,
  method: 'S256' | 'plain' = 'S256'
): string {
  if (method !== 'S256') {
    throw new Error(
      `Insecure PKCE challenge method '${method}' rejected. NutriBodySim strictly requires 'S256'`
    );
  }

  const validation = validateCodeVerifier(verifier);
  if (!validation.valid) {
    throw new Error(`Invalid code verifier: ${validation.error}`);
  }

  return crypto
    .createHash('sha256')
    .update(verifier, 'ascii')
    .digest('base64url');
}

/**
 * Alias for calculateCodeChallenge.
 */
export const generateCodeChallenge = calculateCodeChallenge;

/**
 * Verifies a code_verifier against an expected code_challenge in constant time.
 */
export function verifyCodeChallenge(
  verifier: string,
  expectedChallenge: string,
  method: 'S256' | 'plain' = 'S256'
): boolean {
  try {
    const computed = calculateCodeChallenge(verifier, method);
    return timingSafeEqual(computed, expectedChallenge);
  } catch {
    return false;
  }
}

/**
 * Constructs an RFC 6749 / OIDC Core 1.0 Authorization URL with strict query parameter encoding.
 * Pure utility function — does NOT initiate network connections or browser redirects.
 */
export function constructAuthorizationUrl(params: {
  authorizationEndpoint: string;
  clientId: string;
  redirectUri: string;
  state: string;
  nonce: string;
  codeChallenge: string;
  codeChallengeMethod?: 'S256';
  scopes?: string[];
  prompt?: string;
  accessType?: string;
}): string {
  const {
    authorizationEndpoint,
    clientId,
    redirectUri,
    state,
    nonce,
    codeChallenge,
    codeChallengeMethod = 'S256',
    scopes = ['openid', 'email', 'profile'],
    prompt = 'select_account',
    accessType = 'online'
  } = params;

  if (!authorizationEndpoint || !clientId || !redirectUri || !state || !nonce || !codeChallenge) {
    throw new Error('Missing required parameters to construct authorization URL');
  }

  const url = new URL(authorizationEndpoint);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', scopes.join(' '));
  url.searchParams.set('state', state);
  url.searchParams.set('nonce', nonce);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', codeChallengeMethod);
  url.searchParams.set('prompt', prompt);
  url.searchParams.set('access_type', accessType);

  return url.toString();
}
