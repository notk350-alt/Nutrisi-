/**
 * NutriBodySim — OIDC Configuration & Environment Validation (MVS-B2.5C.1)
 *
 * Implements strict, fail-closed configuration validation for Google OIDC.
 *
 * Security guarantees:
 * - Clear distinction between DISABLED mode and ACTIVE mode.
 * - When OIDC_ENABLED === 'true', all mandatory settings are validated fail-closed.
 * - Detection and rejection of dangerous placeholder values (e.g. 'YOUR_CLIENT_ID').
 * - HTTPS enforcement in production for redirect URIs and endpoints.
 * - Secrets (client_secret) are sanitized and never leaked in validation logs or error messages.
 */

import { OIDCConfig, OIDCConfigValidationResult } from './types';

export const DEFAULT_OIDC_ISSUER = 'https://accounts.google.com';
export const DEFAULT_OIDC_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
export const DEFAULT_OIDC_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
export const DEFAULT_OIDC_JWKS_URI = 'https://www.googleapis.com/oauth2/v3/certs';
export const DEFAULT_OIDC_SCOPES = ['openid', 'email', 'profile'];
export const DEFAULT_TRANSACTION_TTL_SECONDS = 600; // 10 minutes
export const DEFAULT_CLOCK_SKEW_TOLERANCE_SECONDS = 60; // 1 minute

export const ALLOWED_OIDC_ISSUERS = [
  'https://accounts.google.com',
  'accounts.google.com'
];

const KNOWN_PLACEHOLDERS = [
  'your_client_id',
  'your_client_secret',
  'your-google-client-id',
  'your-google-client-secret',
  'placeholder',
  'changeme',
  'change_me',
  'xxx',
  'test_id',
  'test_secret'
];

/**
 * Validates whether a secret or identifier looks like an unconfigured placeholder.
 */
function isPlaceholder(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return KNOWN_PLACEHOLDERS.some((p) => normalized.includes(p));
}

/**
 * Validates an OIDC configuration object against strict security rules.
 */
export function validateOIDCConfig(
  config: Partial<OIDCConfig>,
  isProduction: boolean = process.env.NODE_ENV === 'production'
): OIDCConfigValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const enabled = Boolean(config.enabled);

  if (!enabled) {
    warnings.push('OIDC authentication is currently DISABLED. System operates in safe stub mode.');
    return {
      valid: true,
      errors,
      warnings
    };
  }

  // --- 1. Client ID Validation ---
  if (!config.clientId || typeof config.clientId !== 'string' || !config.clientId.trim()) {
    errors.push('clientId is required when OIDC is enabled');
  } else if (isPlaceholder(config.clientId)) {
    errors.push('clientId contains placeholder value');
  } else if (config.clientId.length < 10) {
    errors.push('clientId is suspiciously short (< 10 characters)');
  }

  // --- 2. Client Secret Validation ---
  if (!config.clientSecret || typeof config.clientSecret !== 'string' || !config.clientSecret.trim()) {
    errors.push('clientSecret is required when OIDC is enabled');
  } else if (isPlaceholder(config.clientSecret)) {
    errors.push('clientSecret contains placeholder value');
  } else if (config.clientSecret.length < 10) {
    errors.push('clientSecret is suspiciously short (< 10 characters)');
  }

  // --- 3. Redirect URI Validation ---
  if (!config.redirectUri || typeof config.redirectUri !== 'string' || !config.redirectUri.trim()) {
    errors.push('redirectUri is required when OIDC is enabled');
  } else {
    try {
      const redirectUrl = new URL(config.redirectUri);
      if (isProduction && redirectUrl.protocol !== 'https:') {
        errors.push(`redirectUri must use HTTPS in production (received '${redirectUrl.protocol}')`);
      } else if (!isProduction && redirectUrl.protocol !== 'https:' && redirectUrl.hostname !== 'localhost' && redirectUrl.hostname !== '127.0.0.1') {
        warnings.push(`redirectUri uses unencrypted HTTP on non-localhost hostname '${redirectUrl.hostname}'`);
      }
    } catch {
      errors.push('redirectUri is not a valid absolute URL');
    }
  }

  // --- 4. Issuer Validation ---
  const issuer = config.issuer ?? DEFAULT_OIDC_ISSUER;
  if (!issuer || typeof issuer !== 'string') {
    errors.push('issuer is required');
  } else {
    try {
      const issuerUrl = new URL(issuer);
      if (issuerUrl.protocol !== 'https:') {
        errors.push(`issuer must use HTTPS (received '${issuerUrl.protocol}')`);
      }
      if (!ALLOWED_OIDC_ISSUERS.includes(issuer) && !ALLOWED_OIDC_ISSUERS.includes(issuerUrl.origin)) {
        errors.push(`Invalid OIDC issuer '${issuer}'. Permitted issuers: ${ALLOWED_OIDC_ISSUERS.join(', ')}`);
      }
    } catch {
      errors.push(`Invalid OIDC issuer '${issuer}'. Not a valid URL`);
    }
  }

  // --- 5. Authorization & Token Endpoints Validation ---
  const authEndpoint = config.authorizationEndpoint ?? DEFAULT_OIDC_AUTH_ENDPOINT;
  const tokenEndpoint = config.tokenEndpoint ?? DEFAULT_OIDC_TOKEN_ENDPOINT;
  const jwksUri = config.jwksUri ?? DEFAULT_OIDC_JWKS_URI;

  const endpoints = [
    { name: 'authorizationEndpoint', val: authEndpoint },
    { name: 'tokenEndpoint', val: tokenEndpoint },
    { name: 'jwksUri', val: jwksUri }
  ];

  for (const ep of endpoints) {
    if (!ep.val || typeof ep.val !== 'string') {
      errors.push(`${ep.name} is required`);
    } else {
      try {
        const u = new URL(ep.val);
        if (u.protocol !== 'https:') {
          errors.push(`${ep.name} must use HTTPS (received '${u.protocol}')`);
        }
      } catch {
        errors.push(`${ep.name} is not a valid absolute URL`);
      }
    }
  }

  // --- 6. Scopes Validation ---
  const scopes = config.allowedScopes ?? DEFAULT_OIDC_SCOPES;
  if (!Array.isArray(scopes) || scopes.length === 0) {
    errors.push('allowedScopes must be a non-empty array');
  } else {
    if (!scopes.includes('openid')) {
      errors.push("allowedScopes must include the 'openid' scope");
    }
  }

  // --- 7. Transaction TTL Validation ---
  const ttl = config.transactionTtlSeconds ?? DEFAULT_TRANSACTION_TTL_SECONDS;
  if (typeof ttl !== 'number' || isNaN(ttl)) {
    errors.push('transactionTtlSeconds must be a number');
  } else if (ttl <= 0) {
    errors.push('transactionTtlSeconds must be strictly greater than 0');
  } else if (ttl > 3600) {
    errors.push('transactionTtlSeconds exceeds safe maximum of 3600 seconds (1 hour)');
  }

  // --- 8. Clock Skew Validation ---
  const skew = config.clockSkewToleranceSeconds ?? DEFAULT_CLOCK_SKEW_TOLERANCE_SECONDS;
  if (typeof skew !== 'number' || isNaN(skew)) {
    errors.push('clockSkewToleranceSeconds must be a number');
  } else if (skew < 0) {
    errors.push('clockSkewToleranceSeconds cannot be negative');
  } else if (skew > 300) {
    errors.push('clockSkewToleranceSeconds exceeds safe maximum of 300 seconds (5 minutes)');
  }

  // --- 9. Cookie Policy Validation ---
  if (config.cookieSameSite && !['none', 'lax', 'strict'].includes(config.cookieSameSite)) {
    errors.push("cookieSameSite must be 'none', 'lax', or 'strict'");
  }
  if (config.cookieSameSite === 'none' && !config.cookieSecure && isProduction) {
    errors.push("cookieSecure must be true when cookieSameSite is 'none' in production");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Sanitizes an OIDC configuration object for logging or public diagnostics.
 * Masks and completely strips sensitive client secret material.
 */
export function getSanitizedOIDCConfig(config: OIDCConfig): Omit<OIDCConfig, 'clientSecret'> & { hasClientSecret: boolean } {
  const { clientSecret, ...rest } = config;
  return {
    ...rest,
    hasClientSecret: Boolean(clientSecret && clientSecret.length > 0)
  };
}

/**
 * Loads OIDC configuration from process.env and defaults.
 */
export function getOIDCConfig(env: NodeJS.ProcessEnv = process.env): OIDCConfig {
  const enabled = env.OIDC_ENABLED === 'true';
  const isProduction = env.NODE_ENV === 'production';

  const transactionTtl = env.OIDC_TRANSACTION_TTL_SECONDS
    ? parseInt(env.OIDC_TRANSACTION_TTL_SECONDS, 10)
    : DEFAULT_TRANSACTION_TTL_SECONDS;

  const clockSkew = env.OIDC_CLOCK_SKEW_SECONDS
    ? parseInt(env.OIDC_CLOCK_SKEW_SECONDS, 10)
    : DEFAULT_CLOCK_SKEW_TOLERANCE_SECONDS;

  const cookieSameSite = (env.OIDC_COOKIE_SAMESITE as 'none' | 'lax' | 'strict') || (isProduction ? 'none' : 'lax');
  const cookieSecure = env.OIDC_COOKIE_SECURE ? env.OIDC_COOKIE_SECURE === 'true' : isProduction;

  const scopes = env.OIDC_SCOPES
    ? env.OIDC_SCOPES.split(',').map((s) => s.trim()).filter(Boolean)
    : DEFAULT_OIDC_SCOPES;

  return {
    enabled,
    clientId: env.GOOGLE_CLIENT_ID || '',
    clientSecret: env.GOOGLE_CLIENT_SECRET || '',
    issuer: env.OIDC_ISSUER || DEFAULT_OIDC_ISSUER,
    authorizationEndpoint: env.OIDC_AUTH_ENDPOINT || DEFAULT_OIDC_AUTH_ENDPOINT,
    tokenEndpoint: env.OIDC_TOKEN_ENDPOINT || DEFAULT_OIDC_TOKEN_ENDPOINT,
    jwksUri: env.OIDC_JWKS_URI || DEFAULT_OIDC_JWKS_URI,
    redirectUri: env.GOOGLE_REDIRECT_URI || '',
    allowedScopes: scopes.includes('openid') ? scopes : ['openid', ...scopes],
    transactionTtlSeconds: isNaN(transactionTtl) ? DEFAULT_TRANSACTION_TTL_SECONDS : transactionTtl,
    clockSkewToleranceSeconds: isNaN(clockSkew) ? DEFAULT_CLOCK_SKEW_TOLERANCE_SECONDS : clockSkew,
    cookieSameSite,
    cookieSecure
  };
}
