/**
 * NutriBodySim — Authentication Configuration & Environment Guard (MVS-B2.2)
 *
 * Ensures strict separation between DEMO mode and PRODUCTION mode.
 * In PRODUCTION (process.env.NODE_ENV === 'production'), demo mode is BLOCKED
 * unless explicitly enabled via ENABLE_DEMO_AUTH === 'true'.
 */

export interface AuthConfig {
  isProduction: boolean;
  enableDemoAuth: boolean;
  sessionTtlSeconds: number;
}

export function getAuthConfig(): AuthConfig {
  const isProduction = process.env.NODE_ENV === 'production';
  // If in production, demo authentication MUST NOT be active unless explicitly overridden
  const enableDemoAuth = isProduction
    ? process.env.ENABLE_DEMO_AUTH === 'true'
    : process.env.ENABLE_DEMO_AUTH !== 'false';

  const sessionTtlSeconds = process.env.SESSION_TTL_SECONDS
    ? Number(process.env.SESSION_TTL_SECONDS)
    : 86400; // 24 hours default

  return {
    isProduction,
    enableDemoAuth,
    sessionTtlSeconds: isNaN(sessionTtlSeconds) || sessionTtlSeconds <= 0 ? 86400 : sessionTtlSeconds
  };
}
