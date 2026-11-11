/**
 * NutriBodySim — Authentication Configuration & Environment Guard (MVS-B2.2)
 *
 * Ensures strict separation between DEMO mode and PRODUCTION mode.
 * Demo mode is always blocked in PRODUCTION, regardless of environment overrides.
 */

export interface AuthConfig {
  isProduction: boolean;
  enableDemoAuth: boolean;
  sessionTtlSeconds: number;
}

export function getAuthConfig(): AuthConfig {
  const environment = process.env.NODE_ENV;
  const isProduction = environment === 'production';
  const demoEnvironment = environment === undefined || environment === 'development' || environment === 'test';
  const enableDemoAuth = demoEnvironment && process.env.ENABLE_DEMO_AUTH === 'true';

  const rawSessionTtl = process.env.SESSION_TTL_SECONDS?.trim();
  const sessionTtlSeconds = rawSessionTtl ? Number(rawSessionTtl) : 86400;
  if (!Number.isSafeInteger(sessionTtlSeconds) || sessionTtlSeconds <= 0) {
    throw new Error('SESSION_TTL_SECONDS must be a positive integer.');
  }

  return {
    isProduction,
    enableDemoAuth,
    sessionTtlSeconds
  };
}
