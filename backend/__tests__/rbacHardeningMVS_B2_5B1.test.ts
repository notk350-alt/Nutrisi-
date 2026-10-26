/**
 * NutriBodySim — MVS-B2.5B.1: RBAC Hardening & Privilege Boundary Enforcement Test Suite
 *
 * Validates the complete elimination of wildcard Admin bypass,
 * strict rejection of unknown permissions and roles,
 * isolation of privileged governance permission (MANAGE_PRIVILEGED_ROLES),
 * inactive/suspended account protection across RBAC and Object Authorization,
 * and resistance to client parameter tampering.
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
  canAccessProject,
  canAccessDataset,
  canAccessNotebook,
  canAccessRoleRequest
} from '../auth/objectAuth';
import { db } from '../database/store';
import { User, Permission, UserRole } from '../database/types';

import { createAuthMiddleware } from '../auth/authMiddleware';

// Helper to instantiate isolated test express app
function createTestApp(): Express {
  const app = express();
  app.use(express.json());
  
  const auth = createAuthMiddleware(db, defaultSessionStore);

  // Test route for privileged governance role
  app.post('/api/governance/manage-roles', auth.authenticate, requirePrivilegedRole(), (req, res) => {
    res.json({ success: true, message: 'Privileged governance operation granted' });
  });

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

describe('MVS-B2.5B.1: RBAC Hardening & Privilege Boundary Enforcement', () => {
  const testApp = createTestApp();

  let studentToken: string;
  let researcherToken: string;
  let lecturerToken: string;
  let adminToken: string;

  beforeEach(() => {
    // Generate fresh sessions for test fixtures
    studentToken = defaultSessionStore.createSession('usr_student').token;
    researcherToken = defaultSessionStore.createSession('usr_researcher').token;
    lecturerToken = defaultSessionStore.createSession('usr_lecturer').token;
    adminToken = defaultSessionStore.createSession('usr_admin').token;
  });

  // -------------------------------------------------------------------------
  // 1. Elimination of Wildcard Bypass & Explicit Permission Enumeration
  // -------------------------------------------------------------------------
  describe('Unit: Wildcard Elimination & Permission Matrix', () => {
    const adminUser = db.getState().users.find(u => u.id === 'usr_admin')!;

    it('1. Admin does NOT automatically receive arbitrary or unknown permissions (wildcard eliminated)', () => {
      // Prior to hardening, hasPermission returned true for ANY permission if user.role === 'Admin'
      const fakePerm1 = 'ARBITRARY_PERMISSION' as Permission;
      const fakePerm2 = 'SUPER_ROOT_PRIVILEGE' as Permission;
      const fakePerm3 = 'EXECUTE_UNCONSTRAINED' as Permission;

      expect(hasPermission(adminUser, fakePerm1)).toBe(false);
      expect(hasPermission(adminUser, fakePerm2)).toBe(false);
      expect(hasPermission(adminUser, fakePerm3)).toBe(false);
    });

    it('2. Admin does NOT automatically receive MANAGE_PRIVILEGED_ROLES', () => {
      // Privileged governance must NOT be inherited by regular Admin
      expect(hasPermission(adminUser, 'MANAGE_PRIVILEGED_ROLES')).toBe(false);
      const effective = getEffectivePermissions(adminUser);
      expect(effective.has('MANAGE_PRIVILEGED_ROLES')).toBe(false);
    });

    it('3. Admin only possesses strictly enumerated operational permissions', () => {
      const explicitAdminPerms: Permission[] = [
        'VIEW', 'USE', 'CREATE', 'CLONE', 'EDIT', 'DELETE', 'SHARE', 'PUBLISH', 'VERIFY', 'ADMIN'
      ];

      for (const p of explicitAdminPerms) {
        expect(hasPermission(adminUser, p)).toBe(true);
      }

      // Check exact count of effective permissions matches ROLE_DEFAULT_PERMISSIONS.Admin
      const effective = getEffectivePermissions(adminUser);
      expect(effective.size).toBe(explicitAdminPerms.length);
      for (const p of explicitAdminPerms) {
        expect(effective.has(p)).toBe(true);
      }
    });

    it('4. Unknown permissions are strictly rejected by default across all roles', () => {
      const allFixtures = db.getState().users;
      const invalidPermissions = ['ROOT', 'BYPASS_ALL', '', 'null', 'undefined', 'SUPERADMIN'] as any[];

      for (const user of allFixtures) {
        for (const p of invalidPermissions) {
          expect(hasPermission(user, p)).toBe(false);
        }
      }
    });

    it('5. Corrupted, invalid, or unrecognized roles are strictly rejected with 0 permissions', () => {
      const corruptedUser: User = {
        id: 'usr_corrupt',
        email: 'corrupt@test.org',
        name: 'Corrupt User',
        role: 'SuperAdmin' as UserRole, // Invalid role
        permissions: ['ADMIN', 'VIEW', 'DELETE'],
        created_at: new Date().toISOString(),
        last_login_at: new Date().toISOString(),
        account_status: 'ACTIVE'
      };

      expect(hasPermission(corruptedUser, 'VIEW')).toBe(false);
      expect(hasPermission(corruptedUser, 'ADMIN')).toBe(false);
      expect(hasPermission(corruptedUser, 'DELETE')).toBe(false);
      expect(hasRole(corruptedUser, 'Admin')).toBe(false);
      expect(getEffectivePermissions(corruptedUser).size).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // 2. Account Status Enforcement (Suspended & Disabled Accounts)
  // -------------------------------------------------------------------------
  describe('Unit: Inactive & Suspended Account Containment', () => {
    it('6. Suspended Admin account loses all effective permissions', () => {
      const suspendedAdmin: User = {
        ...db.getState().users.find(u => u.id === 'usr_admin')!,
        account_status: 'SUSPENDED'
      };

      expect(hasPermission(suspendedAdmin, 'ADMIN')).toBe(false);
      expect(hasPermission(suspendedAdmin, 'VIEW')).toBe(false);
      expect(hasPermission(suspendedAdmin, 'DELETE')).toBe(false);
      expect(hasAllPermissions(suspendedAdmin, ['VIEW', 'USE'])).toBe(false);
      expect(hasAnyPermission(suspendedAdmin, ['VIEW', 'ADMIN'])).toBe(false);
      expect(hasRole(suspendedAdmin, 'Admin')).toBe(false);
      expect(getEffectivePermissions(suspendedAdmin).size).toBe(0);
    });

    it('7. Disabled Researcher account loses all effective permissions', () => {
      const disabledResearcher: User = {
        ...db.getState().users.find(u => u.id === 'usr_researcher')!,
        account_status: 'DISABLED'
      };

      expect(hasPermission(disabledResearcher, 'PUBLISH')).toBe(false);
      expect(hasPermission(disabledResearcher, 'CREATE')).toBe(false);
      expect(hasRole(disabledResearcher, 'Researcher')).toBe(false);
      expect(getEffectivePermissions(disabledResearcher).size).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // 3. Privileged Governance Boundary & Client Spoofing Immunity
  // -------------------------------------------------------------------------
  describe('Unit: Privileged Governance Boundary & Client Tampering Defense', () => {
    it('8. User cannot acquire MANAGE_PRIVILEGED_ROLES merely by appending it to user.permissions', () => {
      const studentAttemptingPrivilege: User = {
        ...db.getState().users.find(u => u.id === 'usr_student')!,
        permissions: ['VIEW', 'USE', 'CREATE', 'CLONE', 'MANAGE_PRIVILEGED_ROLES'] as Permission[],
        is_main_admin: false
      };

      expect(hasPermission(studentAttemptingPrivilege, 'MANAGE_PRIVILEGED_ROLES')).toBe(false);
      expect(getEffectivePermissions(studentAttemptingPrivilege).has('MANAGE_PRIVILEGED_ROLES')).toBe(false);
    });

    it('9. Regular Admin cannot acquire MANAGE_PRIVILEGED_ROLES merely by appending it to user.permissions', () => {
      const adminAttemptingPrivilege: User = {
        ...db.getState().users.find(u => u.id === 'usr_admin')!,
        permissions: ['ADMIN', 'DELETE', 'MANAGE_PRIVILEGED_ROLES'] as Permission[],
        is_main_admin: false
      };

      expect(hasPermission(adminAttemptingPrivilege, 'MANAGE_PRIVILEGED_ROLES')).toBe(false);
      expect(getEffectivePermissions(adminAttemptingPrivilege).has('MANAGE_PRIVILEGED_ROLES')).toBe(false);
    });

    it('10. Non-Admin user cannot acquire MANAGE_PRIVILEGED_ROLES even if is_main_admin flag is true', () => {
      // Must be BOTH an Admin and is_main_admin to prevent Student/Researcher spoofing
      const studentWithMainAdminFlag: User = {
        ...db.getState().users.find(u => u.id === 'usr_student')!,
        permissions: ['VIEW', 'MANAGE_PRIVILEGED_ROLES'] as Permission[],
        is_main_admin: true
      };

      expect(hasPermission(studentWithMainAdminFlag, 'MANAGE_PRIVILEGED_ROLES')).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // 4. HTTP Route Authorization & Middleware Enforcement
  // -------------------------------------------------------------------------
  describe('Integration: Route Security & Middleware Enforcement', () => {
    it('11. Regular Admin is strictly BLOCKED from routes requiring MANAGE_PRIVILEGED_ROLES', async () => {
      const res = await makeRequest(testApp, 'POST', '/api/governance/manage-roles', {}, {
        'Authorization': `Bearer ${adminToken}`
      });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN_PRIVILEGED_ROLE');
      expect(res.body.required_permission).toBe('MANAGE_PRIVILEGED_ROLES');
    });

    it('12. Student and Researcher are strictly BLOCKED from routes requiring MANAGE_PRIVILEGED_ROLES', async () => {
      const studentRes = await makeRequest(testApp, 'POST', '/api/governance/manage-roles', {}, {
        'Authorization': `Bearer ${studentToken}`
      });
      expect(studentRes.status).toBe(403);
      expect(studentRes.body.code).toBe('FORBIDDEN_PRIVILEGED_ROLE');

      const researcherRes = await makeRequest(testApp, 'POST', '/api/governance/manage-roles', {}, {
        'Authorization': `Bearer ${researcherToken}`
      });
      expect(researcherRes.status).toBe(403);
      expect(researcherRes.body.code).toBe('FORBIDDEN_PRIVILEGED_ROLE');
    });

    it('13. Regular Admin retains access to standard administrative routes (/api/audit)', async () => {
      const res = await makeRequest(testApp, 'GET', '/api/audit', undefined, {
        'Authorization': `Bearer ${adminToken}`
      });

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.logs)).toBe(true);
    });

    it('14. Regular Admin retains access to list all role elevation requests (/api/role-requests)', async () => {
      const res = await makeRequest(testApp, 'GET', '/api/role-requests', undefined, {
        'Authorization': `Bearer ${adminToken}`
      });

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.role_requests)).toBe(true);
    });

    it('15. Student attempting to list all role elevation requests is rejected with HTTP 403', async () => {
      const res = await makeRequest(testApp, 'GET', '/api/role-requests', undefined, {
        'Authorization': `Bearer ${studentToken}`
      });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('16. Client parameter tampering in request body does NOT escalate privileges', async () => {
      // Student sends body attempting to claim Admin role, admin permissions, and main admin flag
      const tamperedBody = {
        name: 'Injected Privilege Project',
        description: 'Attempting to inject admin attributes via body',
        role: 'Admin',
        permissions: ['ADMIN', 'DELETE', 'MANAGE_PRIVILEGED_ROLES'],
        is_main_admin: true,
        user_id: 'usr_admin' // Attempted IDOR override
      };

      const res = await makeRequest(testApp, 'POST', '/api/projects', tamperedBody, {
        'Authorization': `Bearer ${studentToken}`
      });

      expect(res.status).toBe(201);
      // Project owner must strictly be 'usr_student' (derived from session), not injected 'usr_admin'
      expect(res.body.project.owner_id).toBe('usr_student');
      expect(res.body.project.owner_id).not.toBe('usr_admin');
    });

    it('17. Inactive / Suspended account is blocked from administrative routes with HTTP 403', async () => {
      // Temporarily mark admin as suspended
      const state = db.getState();
      const admin = state.users.find(u => u.id === 'usr_admin')!;
      const origStatus = admin.account_status;
      admin.account_status = 'SUSPENDED';

      try {
        const res = await makeRequest(testApp, 'GET', '/api/audit', undefined, {
          'Authorization': `Bearer ${adminToken}`
        });

        expect(res.status).toBe(403);
        expect(res.body.code).toBe('FORBIDDEN_ACCOUNT_STATUS');
        expect(res.body.account_status).toBe('SUSPENDED');
      } finally {
        admin.account_status = origStatus;
      }
    });
  });

  // -------------------------------------------------------------------------
  // 5. Object-Level Authorization Integrity (BOLA / IDOR Defense)
  // -------------------------------------------------------------------------
  describe('Integration: Object-Level Authorization Integrity', () => {
    it('18. Student cannot access another user private project (BOLA defense)', () => {
      const student = db.getState().users.find(u => u.id === 'usr_student')!;
      const privateResearcherProject = {
        id: 'proj_private_researcher',
        name: 'Private Researcher Bioenergetics',
        description: 'Confidential project',
        type: 'Research' as const,
        owner_id: 'usr_researcher',
        is_public: false,
        tags: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      const authResult = canAccessProject(student, privateResearcherProject, 'READ');
      expect(authResult.allowed).toBe(false);
      expect(authResult.reason).toContain('does not have READ permission');
    });

    it('19. Suspended user cannot access any project regardless of ownership', () => {
      const suspendedStudent: User = {
        ...db.getState().users.find(u => u.id === 'usr_student')!,
        account_status: 'SUSPENDED'
      };

      const ownProject = {
        id: 'proj_student_1',
        name: 'Own Student Project',
        description: 'Student project',
        type: 'Academic' as const,
        owner_id: suspendedStudent.id,
        is_public: false,
        tags: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      const authResult = canAccessProject(suspendedStudent, ownProject, 'READ');
      expect(authResult.allowed).toBe(false);
      expect(authResult.reason).toContain('Account is SUSPENDED');
    });

    it('20. Suspended user cannot access any dataset regardless of ownership', () => {
      const suspendedResearcher: User = {
        ...db.getState().users.find(u => u.id === 'usr_researcher')!,
        account_status: 'SUSPENDED'
      };

      const ownDataset = {
        id: 'ds_res_1',
        name: 'Biomarker Dataset',
        uploaded_by: suspendedResearcher.id,
        project_id: 'proj_1',
        row_count: 50,
        column_count: 5,
        created_at: new Date().toISOString()
      } as any;

      const authResult = canAccessDataset(suspendedResearcher, ownDataset, 'READ');
      expect(authResult.allowed).toBe(false);
      expect(authResult.reason).toContain('Account is SUSPENDED');
    });

    it('21. Suspended user cannot access any notebook regardless of ownership', () => {
      const suspendedLecturer: User = {
        ...db.getState().users.find(u => u.id === 'usr_lecturer')!,
        account_status: 'SUSPENDED'
      };

      const ownNotebook = {
        id: 'nb_lec_1',
        title: 'Nutritional Dynamics',
        created_by: suspendedLecturer.id,
        project_id: 'proj_1',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      } as any;

      const authResult = canAccessNotebook(suspendedLecturer, ownNotebook, 'READ');
      expect(authResult.allowed).toBe(false);
      expect(authResult.reason).toContain('Account is SUSPENDED');
    });

    it('22. Suspended Admin cannot access other users role requests via admin override', () => {
      const suspendedAdmin: User = {
        ...db.getState().users.find(u => u.id === 'usr_admin')!,
        account_status: 'SUSPENDED'
      };

      const roleReq = {
        request_id: 'req_test_1',
        user_id: 'usr_student',
        requested_role: 'Lecturer' as const,
        approval_status: 'PENDING' as const,
        created_at: new Date().toISOString()
      };

      const authResult = canAccessRoleRequest(suspendedAdmin, roleReq, 'READ');
      expect(authResult.allowed).toBe(false);
      expect(authResult.reason).toContain('Account is SUSPENDED');
    });

    it('23. Active Admin can view other users role requests with audited admin override', () => {
      const activeAdmin = db.getState().users.find(u => u.id === 'usr_admin')!;
      const roleReq = {
        request_id: 'req_test_2',
        user_id: 'usr_student',
        requested_role: 'Researcher' as const,
        approval_status: 'PENDING' as const,
        created_at: new Date().toISOString()
      };

      const authResult = canAccessRoleRequest(activeAdmin, roleReq, 'READ');
      expect(authResult.allowed).toBe(true);
      expect(authResult.isAdminOverride).toBe(true);
    });

    it('24. Student attempting to view another student role request is denied with BOLA rejection', () => {
      const student = db.getState().users.find(u => u.id === 'usr_student')!;
      const peerStudentReq = {
        request_id: 'req_peer_student',
        user_id: 'usr_peer_student_999',
        requested_role: 'Lecturer' as const,
        approval_status: 'PENDING' as const,
        created_at: new Date().toISOString()
      };

      const authResult = canAccessRoleRequest(student, peerStudentReq, 'READ');
      expect(authResult.allowed).toBe(false);
      expect(authResult.reason).toContain('Users may only view their own role elevation requests');
    });
  });
});
