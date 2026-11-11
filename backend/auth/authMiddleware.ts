/**
 * NutriBodySim — Authentication Middleware (MVS-B2.2)
 *
 * Enforces session token extraction, verification against SessionStore,
 * and attaches verified User identity to req.user.
 *
 * Security guarantees:
 * - Never trusts x-user-id header.
 * - Never falls back to default researcher user on auth failure.
 * - Rejects missing, malformed, revoked, or expired tokens with HTTP 401.
 */

import { Request, Response, NextFunction } from 'express';
import {
  defaultSessionStore,
  ISessionStore,
  SessionValidationResult
} from './sessionStore';
import type { ISessionRepository, IDatabaseRepositories } from '../database/contracts';
import type { DatabaseStore } from '../database/store';
import { getRuntimeDb, getRuntimeSelection, resolveDatabaseProvider } from '../database/runtime';
import { User } from '../database/types';

// Augment Express Request
declare global {
  namespace Express {
    interface Request {
      user?: User;
      sessionToken?: string;
    }
  }
}

/**
 * Extracts raw bearer token from Authorization header or cookie.
 */
export function extractToken(req: Request): string | null {
  const authHeader = req.headers['authorization'];
  if (authHeader && typeof authHeader === 'string') {
    const parts = authHeader.trim().split(/\s+/);
    if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
      return parts[1];
    }
  }

  // Optional fallback to x-session-token header
  const sessionHeader = req.headers['x-session-token'];
  if (sessionHeader && typeof sessionHeader === 'string') {
    return sessionHeader.trim();
  }

  return null;
}

/**
 * Returns the authenticated user from the request context, or throws if unauthenticated.
 */
export function getCurrentUser(req: Request): User {
  if (req.user) {
    return req.user;
  }
  throw new Error('Unauthenticated request: req.user is undefined. Ensure authentication middleware is applied.');
}

/**
 * Middleware factory for authenticating session token against database and session store.
 */
type AuthDatabase = DatabaseStore | IDatabaseRepositories;
type AuthSessionStore = ISessionStore | ISessionRepository;

function isRepositoryDatabase(database: AuthDatabase): database is IDatabaseRepositories {
  return 'users' in database && 'sessions' in database;
}

function findUser(database: AuthDatabase, userId: string): User | null | Promise<User | null> {
  return isRepositoryDatabase(database)
    ? database.users.findById(userId)
    : database.getState().users.find((user) => user.id === userId) ?? null;
}

export function createAuthMiddleware(
  database?: AuthDatabase,
  sessionStore?: AuthSessionStore
) {
  const runtime = getRuntimeSelection();
  if (resolveDatabaseProvider() === 'postgres') {
    if (runtime?.provider !== 'postgres') {
      throw new Error('PostgreSQL runtime must be initialized before creating authentication middleware.');
    }
    if (database && database !== runtime.repositories) {
      throw new Error('Authentication middleware must use the initialized PostgreSQL repositories.');
    }
    if (sessionStore && sessionStore !== runtime.repositories.sessions) {
      throw new Error('Authentication middleware must use the initialized PostgreSQL session repository.');
    }
  }
  const selectedDatabase = database ?? (
    runtime?.provider === 'postgres' ? runtime.repositories : getRuntimeDb()
  );
  const selectedSessionStore = sessionStore ?? (
    runtime?.provider === 'postgres' ? runtime.repositories.sessions : defaultSessionStore
  );

  return {
    /**
     * Optional session resolution middleware: populates req.user if a valid token is provided.
     */
    async authenticate(req: Request, res: Response, next: NextFunction) {
      const token = extractToken(req);
      if (!token) {
        req.user = undefined;
        return next();
      }

      let validation: SessionValidationResult;
      try {
        validation = await selectedSessionStore.validateSession(token);
      } catch (error) {
        return next(error);
      }
      if (!validation.valid || !validation.userId) {
        req.user = undefined;
        (req as any).authError = validation.error;
        return next();
      }

      let user: User | null;
      try {
        user = await findUser(selectedDatabase, validation.userId);
      } catch (error) {
        return next(error);
      }
      if (!user) {
        req.user = undefined;
        (req as any).authError = 'User associated with session not found';
        return next();
      }

      // 1. Account status check: suspended or disabled accounts are marked immediately
      if (user.account_status && user.account_status !== 'ACTIVE') {
        req.user = user;
        (req as any).authError = `Account is ${user.account_status}. Access to this resource is forbidden.`;
        (req as any).authCode = 'FORBIDDEN_ACCOUNT_STATUS';
        (req as any).accountStatus = user.account_status;
        return next();
      }

      // 2. Strict token_version enforcement: must be a valid integer and match user.token_version exactly
      const expectedVersion = user.token_version ?? 1;
      const actualVersion = validation.tokenVersion;

      if (
        actualVersion === undefined ||
        typeof actualVersion !== 'number' ||
        Number.isNaN(actualVersion) ||
        actualVersion !== expectedVersion
      ) {
        req.user = undefined;
        (req as any).authError = 'Session has been invalidated due to privilege or security updates. Please authenticate again.';
        (req as any).authCode = 'STALE_TOKEN_VERSION';
        return next();
      }

      req.user = user;
      req.sessionToken = token;
      return next();
    },

    /**
     * Strict route guard: requires an active, verified session token.
     * Returns HTTP 401 if missing, expired, revoked, or invalid.
     * Returns HTTP 403 if account is suspended or disabled.
     */
    async requireAuth(req: Request, res: Response, next: NextFunction) {
      const token = extractToken(req);
      if (!token) {
        return res.status(401).json({
          error: 'Authentication required. Missing Bearer session token in Authorization header.',
          code: 'UNAUTHORIZED'
        });
      }

      let validation: SessionValidationResult;
      try {
        validation = await selectedSessionStore.validateSession(token);
      } catch (error) {
        return next(error);
      }
      if (!validation.valid || !validation.userId) {
        return res.status(401).json({
          error: `Authentication failed: ${validation.error || 'Invalid session'}.`,
          code: 'UNAUTHORIZED'
        });
      }

      let user: User | null;
      try {
        user = await findUser(selectedDatabase, validation.userId);
      } catch (error) {
        return next(error);
      }
      if (!user) {
        return res.status(401).json({
          error: 'User associated with session token does not exist in registry.',
          code: 'UNAUTHORIZED'
        });
      }

      // 1. Account status verification
      if (user.account_status && user.account_status !== 'ACTIVE') {
        return res.status(403).json({
          error: `Account is ${user.account_status}. Access to this resource is forbidden.`,
          code: 'FORBIDDEN_ACCOUNT_STATUS',
          account_status: user.account_status
        });
      }

      // 2. Strict token_version enforcement
      const expectedVersion = user.token_version ?? 1;
      const actualVersion = validation.tokenVersion;

      if (
        actualVersion === undefined ||
        typeof actualVersion !== 'number' ||
        Number.isNaN(actualVersion) ||
        actualVersion !== expectedVersion
      ) {
        return res.status(401).json({
          error: 'Session has been invalidated due to privilege or security updates. Please authenticate again.',
          code: 'STALE_TOKEN_VERSION'
        });
      }

      req.user = user;
      req.sessionToken = token;
      return next();
    }
  };
}

export * from './rbacMiddleware';
export * from './objectAuth';
