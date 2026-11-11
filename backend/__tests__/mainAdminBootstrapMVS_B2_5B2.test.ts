/**
 * NutriBodySim — Main Administrator Bootstrap Adversarial & Boundary Test Suite (MVS-B2.5B.2)
 *
 * Verifies:
 * 1. Isolated CLI / server-side bootstrap execution with mandatory operator attribution.
 * 2. Rejection of unverified, ghost, suspended, or disabled target accounts.
 * 3. Anti-takeover defense: Rejects subsequent bootstrap when Main Admin is already active.
 * 4. Idempotent re-execution for the existing Main Administrator.
 * 5. Emergency break-glass governance transfer with strict justification validation.
 * 6. Session revocation for target and prior administrators.
 * 7. RBAC boundary: MANAGE_PRIVILEGED_ROLES is granted ONLY to active is_main_admin with role Admin.
 * 8. Regular Admin is strictly denied MANAGE_PRIVILEGED_ROLES and fails requirePrivilegedRole().
 * 9. Account suspension immediately revokes all governance permissions (fail-closed).
 * 10. Atomic rollback guarantee upon persistent storage failures.
 * 11. Zero HTTP exposure and immunity against client parameter injection.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express, { Express, Request, Response } from 'express';
import http from 'http';
import { db } from '../database/store';
import { createLowdbJsonDatabase } from '../database/adapters/lowdbJsonDatabase';
import { defaultSessionStore } from '../auth/sessionStore';
import { executeBootstrapMainAdmin } from '../auth/bootstrapMainAdmin';
import { 
  hasPermission, 
  getEffectivePermissions, 
  requirePrivilegedRole,
  requireAdmin
} from '../auth/rbacMiddleware';
import { createAuthMiddleware } from '../auth/authMiddleware';
import { apiRouter } from '../routes/api';
import { User } from '../database/types';

// Native Node.js http helper to avoid external dependencies
function makeRequest(
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
      const dataStr = body !== undefined ? JSON.stringify(body) : undefined;

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

describe('NutriBodySim MVS-B2.5B.2: Secure Main Administrator Bootstrap & Governance', () => {
  beforeEach(() => {
    db.reseed();
    defaultSessionStore.clear();
    // Clean any prior main admin flags from fixtures to start fresh
    for (const u of db.getState().users) {
      delete u.is_main_admin;
      delete u.governance_granted_at;
      delete u.governance_granted_by;
      u.permissions = u.permissions.filter(p => p !== 'MANAGE_PRIVILEGED_ROLES');
    }
    db.save();
  });

  it('supports asynchronous repository-backed bootstrap with transactional session revocation', async () => {
    const repositories = createLowdbJsonDatabase(db);
    const session = defaultSessionStore.createSession('usr_admin');

    const result = await executeBootstrapMainAdmin({
      targetUserId: 'usr_admin',
      operator: 'repository-test-operator',
      database: repositories
    });

    expect(result.user.is_main_admin).toBe(true);
    expect(result.user.governance_granted_by).toBe('repository-test-operator');
    expect(result.auditLog.action).toBe('MAIN_ADMIN_BOOTSTRAP');
    expect(defaultSessionStore.validateSession(session.token).valid).toBe(false);
  });

  describe('1. Provisioning & Operator Attribution Verification', () => {
    it('successfully provisions Main Administrator for a valid active user with full audit trail', async () => {
      const targetUser = db.getState().users.find(u => u.id === 'usr_admin')!;
      expect(targetUser.is_main_admin).toBeFalsy();

      const result = await executeBootstrapMainAdmin({
        targetUserId: 'usr_admin',
        operator: 'devops-lead@nutribodysim.org',
        verifyEmail: 'admin@nutribodysim.org'
      });

      expect(result.success).toBe(true);
      expect(result.idempotent).toBe(false);
      expect(result.user.id).toBe('usr_admin');
      expect(result.user.is_main_admin).toBe(true);
      expect(result.user.role).toBe('Admin');
      expect(result.user.permissions).toContain('MANAGE_PRIVILEGED_ROLES');
      expect(result.user.governance_granted_by).toBe('devops-lead@nutribodysim.org');
      expect(result.user.governance_granted_at).toBeDefined();
      expect(result.user.token_version).toBeGreaterThan(0);

      // Verify audit log persisted
      const latestAudit = db.getState().audit_logs[0];
      expect(latestAudit.action).toBe('MAIN_ADMIN_BOOTSTRAP');
      expect(latestAudit.entity_id).toBe('usr_admin');
      expect(latestAudit.details).toContain('devops-lead@nutribodysim.org');
    });

    it('rejects bootstrap when operator attribution is missing or empty string', async () => {
      await expect(executeBootstrapMainAdmin({
          targetUserId: 'usr_admin',
          operator: ''
        })).rejects.toThrow(/Operator identity is mandatory/i);

      await expect(executeBootstrapMainAdmin({
          targetUserId: 'usr_admin',
          operator: '   '
        })).rejects.toThrow(/Operator identity is mandatory/i);
    });

    it('rejects bootstrap when targetUserId is missing or empty', async () => {
      await expect(executeBootstrapMainAdmin({
          targetUserId: '',
          operator: 'ops@nutribodysim.org'
        })).rejects.toThrow(/Target user_id is required/i);
    });

    it('rejects bootstrap when target user does not exist in registry', async () => {
      await expect(executeBootstrapMainAdmin({
          targetUserId: 'usr_nonexistent_attacker',
          operator: 'ops@nutribodysim.org'
        })).rejects.toThrow(/TARGET_NOT_FOUND.*usr_nonexistent_attacker/i);
    });

    it('rejects bootstrap if target account is SUSPENDED or DISABLED', async () => {
      const state = db.getState();
      const adminUser = state.users.find(u => u.id === 'usr_admin')!;
      adminUser.account_status = 'SUSPENDED';
      db.save();

      await expect(executeBootstrapMainAdmin({
          targetUserId: 'usr_admin',
          operator: 'ops@nutribodysim.org'
        })).rejects.toThrow(/ACCOUNT_NOT_ACTIVE.*SUSPENDED/i);

      // Test DISABLED status
      adminUser.account_status = 'DISABLED';
      db.save();

      await expect(executeBootstrapMainAdmin({
          targetUserId: 'usr_admin',
          operator: 'ops@nutribodysim.org'
        })).rejects.toThrow(/ACCOUNT_NOT_ACTIVE.*DISABLED/i);
    });

    it('rejects bootstrap when verifyEmail does not match target user email in registry', async () => {
      await expect(executeBootstrapMainAdmin({
          targetUserId: 'usr_admin',
          operator: 'ops@nutribodysim.org',
          verifyEmail: 'imposter@nutribodysim.org'
        })).rejects.toThrow(/IDENTITY_MISMATCH/i);
    });
  });

  describe('2. Anti-Takeover & Idempotency Controls', () => {
    it('blocks subsequent bootstrap by another user when an active Main Admin exists (Anti-Takeover)', async () => {
      // First bootstrap succeeds
      await executeBootstrapMainAdmin({
        targetUserId: 'usr_admin',
        operator: 'ops@nutribodysim.org'
      });

      // Attacker tries to bootstrap another user without break-glass flags
      await expect(executeBootstrapMainAdmin({
          targetUserId: 'usr_researcher',
          operator: 'malicious-operator'
        })).rejects.toThrow(/GOVERNANCE_ALREADY_INITIALIZED/i);

      // Confirm usr_admin is still the only Main Admin
      const state = db.getState();
      const admin = state.users.find(u => u.id === 'usr_admin')!;
      const researcher = state.users.find(u => u.id === 'usr_researcher')!;
      expect(admin.is_main_admin).toBe(true);
      expect(researcher.is_main_admin).toBeFalsy();
    });

    it('handles idempotent re-execution cleanly for the current active Main Administrator', async () => {
      await executeBootstrapMainAdmin({
        targetUserId: 'usr_admin',
        operator: 'ops@nutribodysim.org'
      });

      // Second execution on same user
      const result = await executeBootstrapMainAdmin({
        targetUserId: 'usr_admin',
        operator: 'ops@nutribodysim.org'
      });

      expect(result.success).toBe(true);
      expect(result.idempotent).toBe(true);
      expect(result.user.is_main_admin).toBe(true);

      const latestAudit = db.getState().audit_logs[0];
      expect(latestAudit.action).toBe('MAIN_ADMIN_BOOTSTRAP');
      expect(latestAudit.details).toContain('Idempotent bootstrap check');
    });

    it('enforces emergency break-glass recovery when --force-recovery is supplied with valid reason', async () => {
      // 1. Initial Main Admin
      await executeBootstrapMainAdmin({
        targetUserId: 'usr_admin',
        operator: 'ops@nutribodysim.org'
      });

      // Issue active session for initial admin
      const oldSession = defaultSessionStore.createSession('usr_admin');
      expect(defaultSessionStore.validateSession(oldSession.token).valid).toBe(true);

      // 2. Break-glass governance transfer to another user
      const reason = 'Emergency Incident INC-9901: Primary keys lost; authorized failover';
      const result = await executeBootstrapMainAdmin({
        targetUserId: 'usr_researcher',
        operator: 'chief-security-officer',
        forceRecovery: true,
        reason
      });

      expect(result.success).toBe(true);
      expect(result.idempotent).toBe(false);
      expect(result.previousMainAdmin?.id).toBe('usr_admin');
      expect(result.user.id).toBe('usr_researcher');
      expect(result.user.is_main_admin).toBe(true);
      expect(result.user.role).toBe('Admin');
      expect(result.user.permissions).toContain('MANAGE_PRIVILEGED_ROLES');

      // 3. Verify prior Main Admin governance is revoked
      const oldAdmin = db.getState().users.find(u => u.id === 'usr_admin')!;
      expect(oldAdmin.is_main_admin).toBe(false);
      expect(oldAdmin.permissions).not.toContain('MANAGE_PRIVILEGED_ROLES');

      // 4. Verify old session was revoked
      expect(defaultSessionStore.validateSession(oldSession.token).valid).toBe(false);

      // 5. Verify audit log captures emergency transfer
      const latestAudit = db.getState().audit_logs[0];
      expect(latestAudit.details).toContain('Emergency break-glass governance transfer');
      expect(latestAudit.details).toContain('INC-9901');
    });

    it('rejects break-glass recovery if reason is missing or shorter than 10 characters', async () => {
      await executeBootstrapMainAdmin({
        targetUserId: 'usr_admin',
        operator: 'ops@nutribodysim.org'
      });

      // Missing reason
      await expect(executeBootstrapMainAdmin({
          targetUserId: 'usr_researcher',
          operator: 'chief-sec',
          forceRecovery: true
        })).rejects.toThrow(/INVALID_RECOVERY_REASON/i);

      // Too short reason (< 10 chars)
      await expect(executeBootstrapMainAdmin({
          targetUserId: 'usr_researcher',
          operator: 'chief-sec',
          forceRecovery: true,
          reason: 'Short'
        })).rejects.toThrow(/INVALID_RECOVERY_REASON/i);
    });
  });

  describe('3. Privilege Boundary Enforcement & RBAC Isolation', () => {
    it('regular Admin without is_main_admin DOES NOT possess MANAGE_PRIVILEGED_ROLES', () => {
      const regularAdmin: User = {
        id: 'usr_regular_admin',
        email: 'regular_admin@nutribodysim.org',
        name: 'Regular Admin',
        role: 'Admin',
        permissions: ['VIEW', 'USE', 'CREATE', 'CLONE', 'EDIT', 'DELETE', 'SHARE', 'PUBLISH', 'VERIFY', 'ADMIN'],
        created_at: new Date().toISOString(),
        last_login_at: new Date().toISOString(),
        account_status: 'ACTIVE'
      };

      expect(hasPermission(regularAdmin, 'ADMIN')).toBe(true);
      expect(hasPermission(regularAdmin, 'MANAGE_PRIVILEGED_ROLES')).toBe(false);
      expect(getEffectivePermissions(regularAdmin).has('MANAGE_PRIVILEGED_ROLES')).toBe(false);
    });

    it('rejects client attempt to inject MANAGE_PRIVILEGED_ROLES in permissions if is_main_admin is false', () => {
      const maliciousAdmin: User = {
        id: 'usr_attacker',
        email: 'attacker@nutribodysim.org',
        name: 'Malicious Attacker',
        role: 'Admin',
        permissions: ['ADMIN', 'MANAGE_PRIVILEGED_ROLES'],
        is_main_admin: false,
        created_at: new Date().toISOString(),
        last_login_at: new Date().toISOString(),
        account_status: 'ACTIVE'
      };

      expect(hasPermission(maliciousAdmin, 'MANAGE_PRIVILEGED_ROLES')).toBe(false);
      expect(getEffectivePermissions(maliciousAdmin).has('MANAGE_PRIVILEGED_ROLES')).toBe(false);
    });

    it('non-Admin role (e.g. Student) with fraudulent is_main_admin flag does NOT receive MANAGE_PRIVILEGED_ROLES', () => {
      const fakeAdminStudent: User = {
        id: 'usr_fake_student',
        email: 'fake@nutribodysim.org',
        name: 'Fake Admin Student',
        role: 'Student',
        permissions: ['VIEW', 'USE', 'CREATE', 'CLONE', 'MANAGE_PRIVILEGED_ROLES'],
        is_main_admin: true,
        created_at: new Date().toISOString(),
        last_login_at: new Date().toISOString(),
        account_status: 'ACTIVE'
      };

      // Must hold role 'Admin' to have administrative governance
      expect(hasPermission(fakeAdminStudent, 'MANAGE_PRIVILEGED_ROLES')).toBe(false);
    });

    it('verified active Main Administrator with role Admin POSSESSES MANAGE_PRIVILEGED_ROLES', async () => {
      await executeBootstrapMainAdmin({
        targetUserId: 'usr_admin',
        operator: 'ops@nutribodysim.org'
      });

      const bootstrapped = db.getState().users.find(u => u.id === 'usr_admin')!;
      expect(hasPermission(bootstrapped, 'MANAGE_PRIVILEGED_ROLES')).toBe(true);
      expect(getEffectivePermissions(bootstrapped).has('MANAGE_PRIVILEGED_ROLES')).toBe(true);
    });

    it('account suspension of Main Administrator immediately revokes all permissions (Fail-Closed)', async () => {
      await executeBootstrapMainAdmin({
        targetUserId: 'usr_admin',
        operator: 'ops@nutribodysim.org'
      });

      const mainAdmin = db.getState().users.find(u => u.id === 'usr_admin')!;
      mainAdmin.account_status = 'SUSPENDED';

      expect(hasPermission(mainAdmin, 'MANAGE_PRIVILEGED_ROLES')).toBe(false);
      expect(hasPermission(mainAdmin, 'ADMIN')).toBe(false);
      expect(getEffectivePermissions(mainAdmin).size).toBe(0);
    });
  });

  describe('4. Middleware Route Guard Integration', () => {
    let app: express.Express;

    beforeEach(() => {
      app = express();
      app.use(express.json());

      const authMw = createAuthMiddleware(db, defaultSessionStore);

      // Route requiring regular ADMIN permission
      app.get('/test/admin-only', authMw.requireAuth, requireAdmin(), (req: Request, res: Response) => {
        res.json({ message: 'admin access granted' });
      });

      // Route requiring privileged governance MANAGE_PRIVILEGED_ROLES
      app.post('/test/privileged-governance', authMw.requireAuth, requirePrivilegedRole(), (req: Request, res: Response) => {
        res.json({ message: 'privileged governance granted' });
      });
    });

    it('regular Admin is allowed on requireAdmin() but forbidden on requirePrivilegedRole()', async () => {
      // Create session for unbootstrapped regular Admin
      const { token } = defaultSessionStore.createSession('usr_admin');

      // 1. Regular admin route -> 200 OK
      const resAdmin = await makeRequest(app, 'GET', '/test/admin-only', undefined, {
        Authorization: `Bearer ${token}`
      });
      expect(resAdmin.status).toBe(200);

      // 2. Privileged governance route -> 403 FORBIDDEN_PRIVILEGED_ROLE
      const resPriv = await makeRequest(app, 'POST', '/test/privileged-governance', undefined, {
        Authorization: `Bearer ${token}`
      });
      expect(resPriv.status).toBe(403);
      expect(resPriv.body.code).toBe('FORBIDDEN_PRIVILEGED_ROLE');
    });

    it('bootstrapped Main Administrator is allowed on requirePrivilegedRole()', async () => {
      await executeBootstrapMainAdmin({
        targetUserId: 'usr_admin',
        operator: 'ops@nutribodysim.org'
      });

      const { token } = defaultSessionStore.createSession('usr_admin');

      const resPriv = await makeRequest(app, 'POST', '/test/privileged-governance', undefined, {
        Authorization: `Bearer ${token}`
      });
      expect(resPriv.status).toBe(200);
      expect(resPriv.body.message).toBe('privileged governance granted');
    });

    it('suspended Main Administrator is rejected with 403 FORBIDDEN_ACCOUNT_STATUS', async () => {
      await executeBootstrapMainAdmin({
        targetUserId: 'usr_admin',
        operator: 'ops@nutribodysim.org'
      });

      const { token } = defaultSessionStore.createSession('usr_admin');

      // Suspend account
      const mainAdmin = db.getState().users.find(u => u.id === 'usr_admin')!;
      mainAdmin.account_status = 'SUSPENDED';

      const resPriv = await makeRequest(app, 'POST', '/test/privileged-governance', undefined, {
        Authorization: `Bearer ${token}`
      });
      expect(resPriv.status).toBe(403);
      expect(resPriv.body.code).toBe('FORBIDDEN_ACCOUNT_STATUS');
    });
  });

  describe('5. Zero HTTP Exposure & Client Parameter Injection Immunity', () => {
    let apiApp: express.Express;

    beforeEach(() => {
      apiApp = express();
      apiApp.use(express.json());
      apiApp.use('/api', apiRouter);
    });

    it('confirms no HTTP endpoint exists for /api/admin/bootstrap or similar', async () => {
      const resPost = await makeRequest(apiApp, 'POST', '/api/admin/bootstrap');
      expect([401, 404]).toContain(resPost.status);

      const resPut = await makeRequest(apiApp, 'PUT', '/api/auth/bootstrap');
      expect([401, 404]).toContain(resPut.status);
    });

    it('rejects attempt to request Main Administrator role via POST /api/role-requests', async () => {
      const { token } = defaultSessionStore.createSession('usr_student');

      const res = await makeRequest(apiApp, 'POST', '/api/role-requests', {
        requested_role: 'Main Admin',
        institution: 'Infiltration University',
        justification: 'Attempting to self-elevate to governance authority'
      }, {
        Authorization: `Bearer ${token}`
      });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_ROLE');
    });

    it('ignores client injection of is_main_admin in POST /api/projects', async () => {
      const { token } = defaultSessionStore.createSession('usr_researcher');

      const res = await makeRequest(apiApp, 'POST', '/api/projects', {
        name: 'Tampering Test Project',
        description: 'Testing if request body parameter overrides user object',
        is_main_admin: true,
        role: 'Admin'
      }, {
        Authorization: `Bearer ${token}`
      });

      expect(res.status).toBe(201);
      const researcher = db.getState().users.find(u => u.id === 'usr_researcher')!;
      expect(researcher.is_main_admin).toBeFalsy();
      expect(researcher.role).toBe('Researcher');
    });
  });

  describe('6. Storage Failure & Atomic Rollback Verification', () => {
    it('rolls back target user and audit log completely if disk save fails', async () => {
      const targetUser = db.getState().users.find(u => u.id === 'usr_admin')!;
      const originalPermissions = [...targetUser.permissions];
      const initialAuditCount = db.getState().audit_logs.length;

      // Mock saveToDisk to simulate ENOSPC / disk failure
      const originalSave = (db as any).saveToDisk;
      (db as any).saveToDisk = vi.fn().mockImplementation(() => {
        throw new Error('ENOSPC: no space left on device');
      });

      try {
        await expect(executeBootstrapMainAdmin({
            targetUserId: 'usr_admin',
            operator: 'ops@nutribodysim.org'
          })).rejects.toThrow(/ENOSPC/);

        // Verify target user was restored
        expect(targetUser.is_main_admin).toBeFalsy();
        expect(targetUser.permissions).toEqual(originalPermissions);
        expect(targetUser.governance_granted_at).toBeUndefined();

        // Verify audit log was not kept
        expect(db.getState().audit_logs.length).toBe(initialAuditCount);
      } finally {
        (db as any).saveToDisk = originalSave;
      }
    });
  });
});
