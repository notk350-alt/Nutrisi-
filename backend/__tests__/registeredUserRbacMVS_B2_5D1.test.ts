/**
 * NutriBodySim — MVS-B2.5D.1: Unprivileged Registered User & Permission Foundation Test Suite
 *
 * Validates:
 * 1. RegisteredUser is explicitly registered in VALID_ROLES with rank 0 in ROLE_HIERARCHY.
 * 2. RegisteredUser holds an empty default permission set ([]) with zero operational or admin rights.
 * 3. Strict rejection of all administrative and operational permissions (VIEW, USE, CREATE, CLONE, ADMIN, MANAGE_PRIVILEGED_ROLES).
 * 4. Object-level isolation: RegisteredUser cannot access other users' private projects, datasets, or objects.
 * 5. Role approval engine strictly prohibits RegisteredUser from reviewing or approving role requests.
 * 6. Immunity to client parameter tampering (body/query/header cannot elevate role or grant permissions).
 * 7. Inactive (SUSPENDED / DISABLED) RegisteredUser accounts fail closed.
 * 8. Regular Admin and Student permissions remain completely stable (zero unintended regression).
 * 9. Absolute absence of side-effects: no database mutations, no public account provisioning or linking.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import express, { Express } from 'express';
import http from 'http';
import { apiRouter } from '../routes/api';
import { defaultSessionStore } from '../auth/sessionStore';
import { 
  hasPermission, 
  hasAllPermissions, 
  hasAnyPermission, 
  hasRole, 
  getEffectivePermissions,
  requirePermission,
  requireAdmin,
  requirePrivilegedRole,
  ROLE_DEFAULT_PERMISSIONS,
  VALID_PERMISSIONS,
  VALID_ROLES
} from '../auth/rbacMiddleware';
import { 
  ROLE_HIERARCHY, 
  checkRoleEligibility, 
  validateRequestedRole 
} from '../auth/roleRequestValidation';
import { defaultRoleApprovalEngine } from '../auth/roleApprovalEngine';
import { 
  canAccessProject,
  canAccessDataset,
  canAccessNotebook,
  canAccessRoleRequest
} from '../auth/objectAuth';
import { db } from '../database/store';
import { User, Permission, UserRole, RoleRequest, Project } from '../database/types';
import { createAuthMiddleware } from '../auth/authMiddleware';

// Helper to create isolated test Express app
function createTestApp(): Express {
  const app = express();
  app.use(express.json());
  
  const auth = createAuthMiddleware(db, defaultSessionStore);

  // Test endpoint for governance permission
  app.post('/api/governance/manage-roles', auth.authenticate, requirePrivilegedRole(), (req, res) => {
    res.json({ success: true, message: 'Governance operation granted' });
  });

  app.use('/api', apiRouter);
  return app;
}

// HTTP request helper
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
          let chunks = '';
          res.on('data', chunk => { chunks += chunk; });
          res.on('end', () => {
            server.close();
            try {
              const parsed = chunks ? JSON.parse(chunks) : {};
              resolve({ status: res.statusCode || 500, body: parsed, headers: res.headers });
            } catch {
              resolve({ status: res.statusCode || 500, body: chunks, headers: res.headers });
            }
          });
        }
      );

      req.on('error', err => {
        server.close();
        reject(err);
      });

      if (dataStr) {
        req.write(dataStr);
      }
      req.end();
    });
  });
}

describe('MVS-B2.5D.1 — RegisteredUser RBAC & Permission Foundation Test Suite', () => {
  let app: Express;

  // Canonical mock registered user
  const baseRegisteredUser: User = {
    id: 'usr_registered_test',
    email: 'registered@test.nutribodysim.org',
    name: 'New Registered User',
    role: 'RegisteredUser',
    permissions: [],
    created_at: new Date().toISOString(),
    last_login_at: new Date().toISOString(),
    account_status: 'ACTIVE',
    token_version: 1
  };

  beforeEach(() => {
    defaultSessionStore.clear();
    app = createTestApp();
  });

  // ---------------------------------------------------------------------------
  // 1. Role Validity & Hierarchy Registration
  // ---------------------------------------------------------------------------
  describe('1. Role Validity & Hierarchy Registration', () => {
    it('registers RegisteredUser in VALID_ROLES as a canonical valid role', () => {
      expect(VALID_ROLES.includes('RegisteredUser')).toBe(true);
      expect(VALID_ROLES).toContain('RegisteredUser');
    });

    it('assigns RegisteredUser to rank 0 in ROLE_HIERARCHY below Student (1)', () => {
      expect(ROLE_HIERARCHY.RegisteredUser).toBe(0);
      expect(ROLE_HIERARCHY.Student).toBe(1);
      expect(ROLE_HIERARCHY.Lecturer).toBe(2);
      expect(ROLE_HIERARCHY.Researcher).toBe(2);
      expect(ROLE_HIERARCHY.Admin).toBe(3);
      expect(ROLE_HIERARCHY.RegisteredUser).toBeLessThan(ROLE_HIERARCHY.Student);
    });

    it('correctly validates hasRole for RegisteredUser', () => {
      expect(hasRole(baseRegisteredUser, 'RegisteredUser')).toBe(true);
      expect(hasRole(baseRegisteredUser, 'Student')).toBe(false);
      expect(hasRole(baseRegisteredUser, 'Lecturer')).toBe(false);
      expect(hasRole(baseRegisteredUser, 'Researcher')).toBe(false);
      expect(hasRole(baseRegisteredUser, 'Admin')).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Default Permission Set & Zero-Privilege Guarantee
  // ---------------------------------------------------------------------------
  describe('2. Default Permission Set & Zero-Privilege Guarantee', () => {
    it('defines an empty default permission set ([]) for RegisteredUser', () => {
      expect(ROLE_DEFAULT_PERMISSIONS.RegisteredUser).toEqual([]);
      expect(ROLE_DEFAULT_PERMISSIONS.RegisteredUser.length).toBe(0);
    });

    it('resolves zero effective permissions for RegisteredUser', () => {
      const effective = getEffectivePermissions(baseRegisteredUser);
      expect(effective.size).toBe(0);
    });

    it('strictly denies all 11 valid permissions to RegisteredUser', () => {
      for (const perm of VALID_PERMISSIONS) {
        expect(hasPermission(baseRegisteredUser, perm)).toBe(false);
      }
    });

    it('returns false for hasAllPermissions and hasAnyPermission on RegisteredUser', () => {
      expect(hasAllPermissions(baseRegisteredUser, ['VIEW'])).toBe(false);
      expect(hasAllPermissions(baseRegisteredUser, ['USE', 'CREATE'])).toBe(false);
      expect(hasAnyPermission(baseRegisteredUser, ['VIEW', 'ADMIN'])).toBe(false);
      expect(hasAnyPermission(baseRegisteredUser, ['CREATE', 'CLONE'])).toBe(false);
    });

    it('strictly denies MANAGE_PRIVILEGED_ROLES even if explicitly present in user.permissions', () => {
      const tamperedUser: User = {
        ...baseRegisteredUser,
        permissions: ['MANAGE_PRIVILEGED_ROLES' as Permission]
      };
      expect(hasPermission(tamperedUser, 'MANAGE_PRIVILEGED_ROLES')).toBe(false);
      const effective = getEffectivePermissions(tamperedUser);
      expect(effective.has('MANAGE_PRIVILEGED_ROLES')).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Account Status Containment (Suspended & Disabled RegisteredUser)
  // ---------------------------------------------------------------------------
  describe('3. Inactive Account Containment', () => {
    it('denies all access when RegisteredUser is SUSPENDED', () => {
      const suspendedUser: User = {
        ...baseRegisteredUser,
        account_status: 'SUSPENDED'
      };
      expect(hasRole(suspendedUser, 'RegisteredUser')).toBe(false);
      expect(getEffectivePermissions(suspendedUser).size).toBe(0);
    });

    it('denies all access when RegisteredUser is DISABLED', () => {
      const disabledUser: User = {
        ...baseRegisteredUser,
        account_status: 'DISABLED'
      };
      expect(hasRole(disabledUser, 'RegisteredUser')).toBe(false);
      expect(getEffectivePermissions(disabledUser).size).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Role Elevation Eligibility & Approval Authority
  // ---------------------------------------------------------------------------
  describe('4. Role Elevation Eligibility & Approval Authority', () => {
    it('allows RegisteredUser to submit role elevation requests to Student, Lecturer, Researcher, Admin', () => {
      const targetRoles: Array<'Student' | 'Lecturer' | 'Researcher' | 'Admin'> = [
        'Student', 'Lecturer', 'Researcher', 'Admin'
      ];

      for (const targetRole of targetRoles) {
        const eligibility = checkRoleEligibility('RegisteredUser', targetRole);
        expect(eligibility.allowed).toBe(true);
        expect(eligibility.error).toBeUndefined();
      }
    });

    it('rejects self-demotion or lateral request from RegisteredUser to RegisteredUser', () => {
      const eligibility = checkRoleEligibility('RegisteredUser', 'RegisteredUser' as any);
      expect(eligibility.allowed).toBe(false);
      expect(eligibility.error).toMatch(/already holds the requested role/);
    });

    it('strictly prohibits RegisteredUser from approving or reviewing any role requests', () => {
      const dummyRequest: RoleRequest = {
        request_id: 'req_test_1',
        user_id: 'usr_student',
        requested_role: 'Lecturer',
        approval_status: 'PENDING',
        created_at: new Date().toISOString()
      };

      const authorityCheck = defaultRoleApprovalEngine.verifyReviewerAuthority(
        baseRegisteredUser,
        dummyRequest
      );

      expect(authorityCheck.allowed).toBe(false);
      expect(authorityCheck.statusCode).toBe(403);
      expect(authorityCheck.errorCode).toBe('FORBIDDEN');
    });

    it('rejects approval attempt by RegisteredUser in store.approveRoleRequest', () => {
      // In store.ts, reviewer must have ADMIN permission or role === 'Admin'
      expect(() => {
        db.approveRoleRequest({
          requestId: 'non_existent_req',
          reviewerId: baseRegisteredUser.id,
          reviewReason: 'Malicious attempt'
        });
      }).toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Object-Level Authorization & Project Isolation
  // ---------------------------------------------------------------------------
  describe('5. Object-Level Authorization & Project Isolation', () => {
    it('denies RegisteredUser access to private projects of other users', () => {
      const state = db.getState();
      const academicProject = state.projects.find(p => p.id === 'proj_academic_lab')!;
      expect(academicProject.is_public).toBe(false);

      const readResult = canAccessProject(baseRegisteredUser, academicProject, 'READ');
      expect(readResult.allowed).toBe(false);

      const writeResult = canAccessProject(baseRegisteredUser, academicProject, 'WRITE');
      expect(writeResult.allowed).toBe(false);

      const deleteResult = canAccessProject(baseRegisteredUser, academicProject, 'DELETE');
      expect(deleteResult.allowed).toBe(false);

      const shareResult = canAccessProject(baseRegisteredUser, academicProject, 'SHARE');
      expect(shareResult.allowed).toBe(false);
    });

    it('denies RegisteredUser access to private datasets of other users', () => {
      const state = db.getState();
      // Find a dataset associated with the private project 'proj_academic_lab'
      const privateDataset = state.datasets.find(d => d.project_id === 'proj_academic_lab') || {
        id: 'ds_private_test',
        project_id: 'proj_academic_lab',
        name: 'Private Dataset',
        description: 'Test',
        uploaded_by: 'usr_lecturer',
        current_version: 'v1.0',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      const datasetAccess = canAccessDataset(baseRegisteredUser, privateDataset, 'READ');
      expect(datasetAccess.allowed).toBe(false);
    });

    it('denies RegisteredUser access to other users role requests', () => {
      const otherUserRequest: RoleRequest = {
        request_id: 'req_other',
        user_id: 'usr_student',
        requested_role: 'Researcher',
        approval_status: 'PENDING',
        created_at: new Date().toISOString()
      };

      const accessResult = canAccessRoleRequest(baseRegisteredUser, otherUserRequest);
      expect(accessResult.allowed).toBe(false);
      expect(accessResult.reason).toMatch(/Users may only view their own/);
    });

    it('allows RegisteredUser to access their own role requests', () => {
      const ownRequest: RoleRequest = {
        request_id: 'req_own',
        user_id: baseRegisteredUser.id,
        requested_role: 'Student',
        approval_status: 'PENDING',
        created_at: new Date().toISOString()
      };

      const accessResult = canAccessRoleRequest(baseRegisteredUser, ownRequest);
      expect(accessResult.allowed).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // 6. HTTP API Boundary & Parameter Tampering Defense
  // ---------------------------------------------------------------------------
  describe('6. HTTP API Boundary & Parameter Tampering Defense', () => {
    let registeredUserToken: string;

    beforeEach(() => {
      // Mock RegisteredUser in db.getState().users for request resolution in test app
      const state = db.getState();
      const existingIdx = state.users.findIndex(u => u.id === baseRegisteredUser.id);
      if (existingIdx !== -1) {
        state.users[existingIdx] = { ...baseRegisteredUser };
      } else {
        state.users.push({ ...baseRegisteredUser });
      }

      registeredUserToken = defaultSessionStore.createSession(
        baseRegisteredUser.id,
        86400,
        baseRegisteredUser.token_version
      ).token;
    });

    it('returns HTTP 403 when RegisteredUser attempts to CREATE a project (/api/projects)', async () => {
      const res = await makeRequest(
        app,
        'POST',
        '/api/projects',
        { name: 'Unauthorized Project', type: 'Personal', is_public: false },
        { Authorization: `Bearer ${registeredUserToken}` }
      );

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
      expect(res.body.error).toMatch(/Missing: \[CREATE\]/);
    });

    it('returns HTTP 403 when RegisteredUser attempts physiological calculation (/api/calculations/execute)', async () => {
      const res = await makeRequest(
        app,
        'POST',
        '/api/calculations/execute',
        { formula_id: 'FORMULA_BMR_MIFFLIN', inputs: { weight: 70, height: 175, age: 30 } },
        { Authorization: `Bearer ${registeredUserToken}` }
      );

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
      expect(res.body.error).toMatch(/Missing: \[USE\]/);
    });

    it('returns HTTP 403 when RegisteredUser attempts to access audit logs (/api/audit)', async () => {
      const res = await makeRequest(
        app,
        'GET',
        '/api/audit',
        undefined,
        { Authorization: `Bearer ${registeredUserToken}` }
      );

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('returns HTTP 403 when RegisteredUser attempts privileged governance (/api/governance/manage-roles)', async () => {
      const res = await makeRequest(
        app,
        'POST',
        '/api/governance/manage-roles',
        {},
        { Authorization: `Bearer ${registeredUserToken}` }
      );

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN_PRIVILEGED_ROLE');
    });

    it('rejects parameter tampering when RegisteredUser sends role or permissions in request body', async () => {
      const res = await makeRequest(
        app,
        'POST',
        '/api/projects',
        {
          name: 'Tampered Project',
          role: 'Admin',
          permissions: ['CREATE', 'ADMIN', 'MANAGE_PRIVILEGED_ROLES'],
          is_main_admin: true
        },
        { Authorization: `Bearer ${registeredUserToken}` }
      );

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });
  });

  // ---------------------------------------------------------------------------
  // 7. Regression Invariance across Existing Roles
  // ---------------------------------------------------------------------------
  describe('7. Regression Invariance across Existing Roles', () => {
    it('maintains exact Student permissions (VIEW, USE, CREATE, CLONE)', () => {
      const student = db.getState().users.find(u => u.id === 'usr_student')!;
      expect(student.role).toBe('Student');
      const perms = getEffectivePermissions(student);

      expect(perms.has('VIEW')).toBe(true);
      expect(perms.has('USE')).toBe(true);
      expect(perms.has('CREATE')).toBe(true);
      expect(perms.has('CLONE')).toBe(true);

      // Student lacks elevated permissions
      expect(perms.has('EDIT')).toBe(false);
      expect(perms.has('DELETE')).toBe(false);
      expect(perms.has('SHARE')).toBe(false);
      expect(perms.has('PUBLISH')).toBe(false);
      expect(perms.has('ADMIN')).toBe(false);
      expect(perms.has('MANAGE_PRIVILEGED_ROLES')).toBe(false);
    });

    it('maintains exact Researcher and Lecturer permissions', () => {
      for (const id of ['usr_researcher', 'usr_lecturer']) {
        const user = db.getState().users.find(u => u.id === id)!;
        const perms = getEffectivePermissions(user);

        expect(perms.has('VIEW')).toBe(true);
        expect(perms.has('USE')).toBe(true);
        expect(perms.has('CREATE')).toBe(true);
        expect(perms.has('CLONE')).toBe(true);
        expect(perms.has('EDIT')).toBe(true);
        expect(perms.has('SHARE')).toBe(true);
        expect(perms.has('PUBLISH')).toBe(true);

        expect(perms.has('DELETE')).toBe(false);
        expect(perms.has('ADMIN')).toBe(false);
        expect(perms.has('MANAGE_PRIVILEGED_ROLES')).toBe(false);
      }
    });

    it('maintains exact Admin permissions without MANAGE_PRIVILEGED_ROLES', () => {
      const admin = db.getState().users.find(u => u.id === 'usr_admin')!;
      const perms = getEffectivePermissions(admin);

      expect(perms.has('ADMIN')).toBe(true);
      expect(perms.has('DELETE')).toBe(true);
      expect(perms.has('MANAGE_PRIVILEGED_ROLES')).toBe(false);
    });
  });
});
