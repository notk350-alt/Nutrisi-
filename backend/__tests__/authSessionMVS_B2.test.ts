/**
 * NutriBodySim — MVS-B2.2 Authentication & Session Management Test Suite
 *
 * Verifies all 12+ mandatory security requirements:
 * 1. Valid session token accepted on protected routes.
 * 2. Fake / unrecognized token rejected with HTTP 401.
 * 3. Expired token rejected with HTTP 401.
 * 4. Revoked token rejected with HTTP 401.
 * 5. Logout successfully revokes session token.
 * 6. Unauthenticated requests to protected routes rejected with HTTP 401.
 * 7. Header "x-user-id: usr_admin" does NOT grant identity or bypass auth.
 * 8. User ID in request body/query cannot override verified session identity.
 * 9. Demo login and user switching rejected with HTTP 403 when demo mode is disabled.
 * 10. Authentication responses never leak token hashes, password hashes, or internal secrets.
 * 11. Failed authentication requests do not write false LOGIN audit log entries.
 * 12. Session store reset/restart behavior follows documented memory store lifecycle.
 * 13. Whitelisted public routes remain accessible without session token.
 * 14. Production login returns explicit 501 BLOCKED status when no IdP configured.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import express, { Express } from 'express';
import http from 'http';
import { apiRouter, PUBLIC_ROUTES } from '../routes/api';
import { MemorySessionStore, defaultSessionStore } from '../auth/sessionStore';
import { getAuthConfig } from '../auth/authConfig';
import { db } from '../database/store';

// Helper to instantiate isolated test express app
function createTestApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  return app;
}

// Local HTTP helper using Node.js http
async function makeRequest(
  app: Express,
  method: string,
  url: string,
  body?: any,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: any; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as any;
      const port = addr.port;
      const dataStr = body ? JSON.stringify(body) : undefined;

      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path: url,
          method,
          headers: {
            'Content-Type': 'application/json',
            ...(dataStr ? { 'Content-Length': Buffer.byteLength(dataStr) } : {}),
            ...headers
          }
        },
        res => {
          let resData = '';
          res.on('data', chunk => {
            resData += chunk;
          });
          res.on('end', () => {
            server.close(() => {
              let parsed: any;
              try {
                parsed = JSON.parse(resData);
              } catch {
                parsed = resData;
              }
              resolve({
                status: res.statusCode || 500,
                body: parsed,
                headers: res.headers
              });
            });
          });
        }
      );

      req.on('error', err => {
        server.close(() => reject(err));
      });

      if (dataStr) {
        req.write(dataStr);
      }
      req.end();
    });
  });
}

describe('MVS-B2.2: Authentication & Session Management', () => {
  const testApp = createTestApp();

  describe('Authentication environment configuration', () => {
    it('does not enable demo auth in staging even when explicitly requested', () => {
      const originalNodeEnv = process.env.NODE_ENV;
      const originalDemoAuth = process.env.ENABLE_DEMO_AUTH;
      process.env.NODE_ENV = 'staging';
      process.env.ENABLE_DEMO_AUTH = 'true';
      try {
        expect(getAuthConfig().enableDemoAuth).toBe(false);
      } finally {
        if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = originalNodeEnv;
        if (originalDemoAuth === undefined) delete process.env.ENABLE_DEMO_AUTH;
        else process.env.ENABLE_DEMO_AUTH = originalDemoAuth;
      }
    });

    it('rejects an invalid session lifetime instead of silently using the default', () => {
      const originalTtl = process.env.SESSION_TTL_SECONDS;
      process.env.SESSION_TTL_SECONDS = 'not-a-number';
      try {
        expect(() => getAuthConfig()).toThrow('SESSION_TTL_SECONDS must be a positive integer.');
      } finally {
        if (originalTtl === undefined) delete process.env.SESSION_TTL_SECONDS;
        else process.env.SESSION_TTL_SECONDS = originalTtl;
      }
    });
  });

  beforeEach(() => {
    // Ensure clean session store state for test isolation
    defaultSessionStore.cleanExpiredSessions();
  });

  // -------------------------------------------------------------------------
  // 1. Session Store Unit Tests
  // -------------------------------------------------------------------------
  describe('Session Store Cryptography & Lifecycle', () => {
    it('generates high-entropy 64-hex tokens and stores only SHA-256 hashes', () => {
      const store = new MemorySessionStore(3600);
      const { token, session } = store.createSession('usr_student');

      expect(token).toMatch(/^[a-f0-9]{64}$/i);
      expect(session.userId).toBe('usr_student');
      expect((session as any).tokenHash).toBeUndefined(); // raw session object does not leak hash

      const validation = store.validateSession(token);
      expect(validation.valid).toBe(true);
      expect(validation.userId).toBe('usr_student');
    });

    it('rejects malformed token strings immediately', () => {
      const store = new MemorySessionStore(3600);
      expect(store.validateSession('').valid).toBe(false);
      expect(store.validateSession('short_token').valid).toBe(false);
      expect(store.validateSession('not-a-valid-hex-64-character-string-123456789012345678901234567890').valid).toBe(false);
    });

    it('rejects expired tokens accurately', () => {
      const store = new MemorySessionStore(1); // 1 second TTL
      const { token } = store.createSession('usr_researcher', -10); // already expired 10s ago

      const res = store.validateSession(token);
      expect(res.valid).toBe(false);
      expect(res.error).toBe('Session has expired');
    });

    it('rejects revoked tokens and cleans up expired sessions', () => {
      const store = new MemorySessionStore(3600);
      const { token } = store.createSession('usr_lecturer');

      expect(store.validateSession(token).valid).toBe(true);
      const revoked = store.revokeSession(token);
      expect(revoked).toBe(true);

      const res = store.validateSession(token);
      expect(res.valid).toBe(false);
      expect(res.error).toBe('Session has been revoked');

      const cleaned = store.cleanExpiredSessions();
      expect(cleaned).toBeGreaterThanOrEqual(1);
    });
  });

  // -------------------------------------------------------------------------
  // 2. HTTP Authentication & Route Protection
  // -------------------------------------------------------------------------
  describe('HTTP Authentication Guard & Route Policies', () => {
    it('1. accepts valid session token on /api/auth/me', async () => {
      const { token } = defaultSessionStore.createSession('usr_researcher');
      const res = await makeRequest(testApp, 'GET', '/api/auth/me', undefined, {
        'Authorization': `Bearer ${token}`
      });

      expect(res.status).toBe(200);
      expect(res.body.user).toBeDefined();
      expect(res.body.user.id).toBe('usr_researcher');
      expect(res.body.user.role).toBe('Researcher');
    });

    it('2. rejects fake or nonexistent token with HTTP 401', async () => {
      const fakeToken = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      const res = await makeRequest(testApp, 'GET', '/api/auth/me', undefined, {
        'Authorization': `Bearer ${fakeToken}`
      });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
      expect(res.body.error).toContain('Session not found');
    });

    it('3. rejects expired token with HTTP 401', async () => {
      const { token } = defaultSessionStore.createSession('usr_student', -5); // expired 5 seconds ago
      const res = await makeRequest(testApp, 'GET', '/api/auth/me', undefined, {
        'Authorization': `Bearer ${token}`
      });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
      expect(res.body.error).toContain('Session has expired');
    });

    it('4. rejects revoked token with HTTP 401', async () => {
      const { token } = defaultSessionStore.createSession('usr_lecturer');
      defaultSessionStore.revokeSession(token);

      const res = await makeRequest(testApp, 'GET', '/api/auth/me', undefined, {
        'Authorization': `Bearer ${token}`
      });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
      expect(res.body.error).toContain('Session has been revoked');
    });

    it('5. logout endpoint explicitly revokes session token', async () => {
      const { token } = defaultSessionStore.createSession('usr_researcher');

      // Logout request
      const logoutRes = await makeRequest(testApp, 'POST', '/api/auth/logout', undefined, {
        'Authorization': `Bearer ${token}`
      });
      expect(logoutRes.status).toBe(200);
      expect(logoutRes.body.success).toBe(true);

      // Verify token is now dead
      const followUp = await makeRequest(testApp, 'GET', '/api/auth/me', undefined, {
        'Authorization': `Bearer ${token}`
      });
      expect(followUp.status).toBe(401);
    });

    it('6. rejects unauthenticated requests on protected routes with HTTP 401', async () => {
      // Test across multiple sensitive modules
      const endpoints = [
        { method: 'GET', url: '/api/projects' },
        { method: 'POST', url: '/api/projects', body: { name: 'Unauthorized Project' } },
        { method: 'GET', url: '/api/users' },
        { method: 'GET', url: '/api/audit' },
        { method: 'GET', url: '/api/notes' },
        { method: 'GET', url: '/api/notebooks' },
        { method: 'POST', url: '/api/variables', body: { variable_id: 'VAR_TEST', name: 'Test' } },
        { method: 'POST', url: '/api/calculations/execute', body: { formula_id: 'FORMULA_BMR_MIFFLIN' } }
      ];

      for (const ep of endpoints) {
        const res = await makeRequest(testApp, ep.method, ep.url, ep.body);
        expect(res.status, `Expected 401 for ${ep.method} ${ep.url}`).toBe(401);
        expect(res.body.code).toBe('UNAUTHORIZED');
      }
    });

    it('6a. non-admin users cannot list user profiles outside explicit demo mode', async () => {
      const originalNodeEnv = process.env.NODE_ENV;
      const originalDemoAuth = process.env.ENABLE_DEMO_AUTH;
      process.env.NODE_ENV = 'test';
      process.env.ENABLE_DEMO_AUTH = 'true';

      try {
        const login = await makeRequest(testApp, 'POST', '/api/auth/demo-login', { user_id: 'usr_researcher' });
        expect(login.status).toBe(200);

        process.env.NODE_ENV = 'production';
        const response = await makeRequest(testApp, 'GET', '/api/users', undefined, {
          Authorization: `Bearer ${login.body.token}`
        });
        expect(response.status).toBe(403);
        expect(response.body.code).toBe('INSUFFICIENT_PERMISSION');
      } finally {
        process.env.NODE_ENV = originalNodeEnv;
        if (originalDemoAuth === undefined) delete process.env.ENABLE_DEMO_AUTH;
        else process.env.ENABLE_DEMO_AUTH = originalDemoAuth;
      }
    });

    it('7. header "x-user-id: usr_admin" does NOT bypass authentication or grant identity', async () => {
      const res = await makeRequest(testApp, 'GET', '/api/projects', undefined, {
        'x-user-id': 'usr_admin'
      });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
    });

    it('8. user ID in body or query cannot override verified session identity', async () => {
      // Issue session for student
      const { token } = defaultSessionStore.createSession('usr_student');

      // Attempt to forge note creation as researcher or admin via body params
      const res = await makeRequest(testApp, 'POST', '/api/notes', {
        title: 'Tampered Note',
        content: 'Testing identity override resistance',
        user_id: 'usr_admin' // attempted override
      }, {
        'Authorization': `Bearer ${token}`
      });

      expect(res.status).toBe(201);
      // Backend must bind user_id strictly to the session user ('usr_student')
      expect(res.body.note.user_id).toBe('usr_student');
      expect(res.body.note.user_id).not.toBe('usr_admin');
    });

    it('9. demo endpoint rejects request if demo mode is disabled', async () => {
      // Temporarily mock environment to production without explicit demo flag
      const origEnv = process.env.NODE_ENV;
      const origDemo = process.env.ENABLE_DEMO_AUTH;
      process.env.NODE_ENV = 'production';
      delete process.env.ENABLE_DEMO_AUTH;

      try {
        const res = await makeRequest(testApp, 'POST', '/api/auth/demo-login', {
          user_id: 'usr_researcher'
        });
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('DEMO_AUTH_DISABLED');
      } finally {
        process.env.NODE_ENV = origEnv;
        if (origDemo !== undefined) process.env.ENABLE_DEMO_AUTH = origDemo;
      }
    });

    it('9a. demo authentication stays disabled in production when explicitly enabled', async () => {
      const origEnv = process.env.NODE_ENV;
      const origDemo = process.env.ENABLE_DEMO_AUTH;
      process.env.NODE_ENV = 'production';
      process.env.ENABLE_DEMO_AUTH = 'true';

      try {
        const res = await makeRequest(testApp, 'POST', '/api/auth/demo-login', {
          user_id: 'usr_admin'
        });
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('DEMO_AUTH_DISABLED');
      } finally {
        process.env.NODE_ENV = origEnv;
        if (origDemo !== undefined) process.env.ENABLE_DEMO_AUTH = origDemo;
        else delete process.env.ENABLE_DEMO_AUTH;
      }
    });

    it('10. authentication responses never leak token hashes, password hashes, or internal secrets', async () => {
      const res = await makeRequest(testApp, 'POST', '/api/auth/demo-login', {
        user_id: 'usr_researcher'
      });

      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();
      expect(res.body.tokenHash).toBeUndefined();
      expect(res.body.user.password_hash).toBeUndefined();
      expect(res.body.user.salt).toBeUndefined();
    });

    it('11. failed unauthenticated requests do not emit a false LOGIN audit event', async () => {
      const initialLogCount = db.getState().audit_logs.length;

      // Send unauthenticated and malformed attempts
      await makeRequest(testApp, 'GET', '/api/auth/me');
      await makeRequest(testApp, 'GET', '/api/auth/me', undefined, { 'Authorization': 'Bearer bad_token' });
      await makeRequest(testApp, 'POST', '/api/auth/demo-login', { user_id: 'nonexistent_user_999' });

      const finalLogs = db.getState().audit_logs;
      const newLoginLogs = finalLogs.slice(0, finalLogs.length - initialLogCount).filter(l => l.action === 'LOGIN');
      expect(newLoginLogs.length).toBe(0);
    });

    it('12. session store memory reset clears all active sessions (restart simulation)', () => {
      const { token } = defaultSessionStore.createSession('usr_lecturer');
      expect(defaultSessionStore.validateSession(token).valid).toBe(true);

      // Simulate process memory restart
      defaultSessionStore.clear();

      expect(defaultSessionStore.validateSession(token).valid).toBe(false);
      expect(defaultSessionStore.validateSession(token).error).toBe('Session not found');
    });

    it('13. public routes remain accessible without session token', async () => {
      const publicEndpoints = [
        '/api/units',
        '/api/variables',
        '/api/parameters',
        '/api/formulas',
        '/api/models',
        '/api/references',
        '/api/interpretations'
      ];

      for (const url of publicEndpoints) {
        const res = await makeRequest(testApp, 'GET', url);
        expect(res.status, `Public endpoint ${url} should return 200 without auth`).toBe(200);
      }
    });

    it('14. production login returns 501 PRODUCTION_AUTH_BLOCKED when no IdP is configured', async () => {
      const origEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      try {
        const res = await makeRequest(testApp, 'POST', '/api/auth/login', {
          email: 'admin@nutribodysim.org',
          password: 'SecretPassword123!'
        });

        expect(res.status).toBe(501);
        expect(res.body.code).toBe('PRODUCTION_AUTH_BLOCKED');
      } finally {
        process.env.NODE_ENV = origEnv;
      }
    });
  });
});
