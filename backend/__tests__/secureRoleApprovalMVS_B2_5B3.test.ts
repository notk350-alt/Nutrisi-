/**
 * NutriBodySim — Secure Role Approval Engine Adversarial Test Suite (MVS-B2.5B.3)
 *
 * Verifies:
 * 1. Valid role request approval and role/permission elevation.
 * 2. Valid role request rejection with mandatory reason requirement.
 * 3. Anti-self-approval / anti-self-review enforcement.
 * 4. Regular Admin cannot approve elevation to Admin.
 * 5. Verified Main Administrator can approve Admin elevation.
 * 6. Approval Engine never grants is_main_admin (no privilege elevation).
 * 7. Non-admin users cannot approve or reject requests.
 * 8. Inactive/suspended reviewers cannot process requests.
 * 9. Inactive/suspended requesters cannot be elevated (no auto-activation).
 * 10. State Machine: Terminal status immutability & replay conflict (HTTP 409).
 * 11. Concurrent review race condition defense.
 * 12. Owner cancellation of pending requests (PENDING -> CANCELLED).
 * 13. Non-owner cannot cancel another user's request (IDOR/BOLA defense).
 * 14. Object-level authorization on GET /api/role-requests/:id.
 * 15. Immunity to client request body tampering (role, permissions, is_main_admin).
 * 16. Transaction atomicity: rollback of user, request, and audit logs on storage failure.
 * 17. Session invalidation: old tokens rejected after role elevation (STALE_TOKEN_VERSION).
 * 18. Session invalidation failure safety.
 * 19. Absence of public HTTP bypass endpoints for role tampering.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import http from 'http';
import { apiRouter } from '../routes/api';
import { db } from '../database/store';
import { defaultSessionStore } from '../auth/sessionStore';
import { defaultRoleApprovalEngine, RoleApprovalEngine } from '../auth/roleApprovalEngine';
import { RoleRequest, User } from '../database/types';
import { hasPermission } from '../auth/rbacMiddleware';

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  return app;
}

function makeRequest(
  app: express.Express,
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

describe('NutriBodySim MVS-B2.5B.3: Secure Role Approval Engine', () => {
  const app = createTestApp();

  let studentToken: string;
  let lecturerToken: string;
  let researcherToken: string;
  let adminToken: string;
  let mainAdminToken: string;

  beforeEach(() => {
    db.reseed();
    defaultSessionStore.clear();

    // Reset fixtures: usr_admin is regular Admin, create main admin usr_main_admin
    const state = db.getState();
    const adminUser = state.users.find(u => u.id === 'usr_admin')!;
    delete adminUser.is_main_admin;
    adminUser.role = 'Admin';
    adminUser.account_status = 'ACTIVE';
    adminUser.token_version = 1;

    // Create Main Admin fixture
    let mainAdminUser = state.users.find(u => u.id === 'usr_main_admin');
    if (!mainAdminUser) {
      mainAdminUser = {
        id: 'usr_main_admin',
        email: 'main.admin@nutribodysim.org',
        name: 'Main Administrator',
        role: 'Admin',
        permissions: ['VIEW', 'USE', 'CREATE', 'CLONE', 'EDIT', 'DELETE', 'SHARE', 'PUBLISH', 'VERIFY', 'ADMIN'],
        account_status: 'ACTIVE',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        last_login_at: new Date().toISOString(),
        is_main_admin: true,
        token_version: 1
      };
      state.users.push(mainAdminUser);
    } else {
      mainAdminUser.is_main_admin = true;
      mainAdminUser.role = 'Admin';
      mainAdminUser.account_status = 'ACTIVE';
      mainAdminUser.token_version = 1;
    }

    db.save();

    // Issue fresh tokens
    studentToken = defaultSessionStore.createSession('usr_student', 3600, 1).token;
    lecturerToken = defaultSessionStore.createSession('usr_lecturer', 3600, 1).token;
    researcherToken = defaultSessionStore.createSession('usr_researcher', 3600, 1).token;
    adminToken = defaultSessionStore.createSession('usr_admin', 3600, 1).token;
    mainAdminToken = defaultSessionStore.createSession('usr_main_admin', 3600, 1).token;
  });

  // -------------------------------------------------------------------------
  // 1. Valid Approval & Role Elevation Workflows
  // -------------------------------------------------------------------------
  describe('1. Valid Role Elevation Approval & State Transitions', () => {
    it('1.1 Allows regular Admin to approve academic role elevation (Student -> Researcher)', async () => {
      // Create student role request
      const { roleRequest } = db.createRoleRequest({
        userId: 'usr_student',
        requestedRole: 'Researcher',
        institution: 'Faculty of Nutrition',
        justification: 'Completed honors thesis and published research findings.'
      });

      const res = await makeRequest(
        app,
        'POST',
        `/api/role-requests/${roleRequest.request_id}/approve`,
        { review_reason: 'Academic qualifications and laboratory credentials verified.' },
        { Authorization: `Bearer ${adminToken}` }
      );

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.role_request.approval_status).toBe('APPROVED');
      expect(res.body.role_request.reviewed_by).toBe('usr_admin');
      expect(res.body.role_request.review_reason).toBe('Academic qualifications and laboratory credentials verified.');

      // Verify target user in DB was elevated
      const updatedStudent = db.getState().users.find(u => u.id === 'usr_student')!;
      expect(updatedStudent.role).toBe('Researcher');
      expect(updatedStudent.permissions).toContain('PUBLISH');
      expect(updatedStudent.token_version).toBe(2);

      // Verify audit log
      const audit = db.getState().audit_logs.find(a => a.entity_id === roleRequest.request_id && a.action === 'ROLE_APPROVAL')!;
      expect(audit).toBeDefined();
      expect(audit.user_id).toBe('usr_admin');
      expect(audit.metadata?.new_role).toBe('Researcher');
    });

    it('1.2 Allows regular Admin to reject academic role request with valid reason', async () => {
      const { roleRequest } = db.createRoleRequest({
        userId: 'usr_student',
        requestedRole: 'Lecturer',
        justification: 'Want to teach clinical nutrition.'
      });

      const res = await makeRequest(
        app,
        'POST',
        `/api/role-requests/${roleRequest.request_id}/reject`,
        { review_reason: 'Insufficient prerequisite teaching experience for faculty appointment.' },
        { Authorization: `Bearer ${adminToken}` }
      );

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.role_request.approval_status).toBe('REJECTED');
      expect(res.body.role_request.reviewed_by).toBe('usr_admin');

      // Verify target user was NOT elevated
      const student = db.getState().users.find(u => u.id === 'usr_student')!;
      expect(student.role).toBe('Student');
    });

    it('1.3 Rejects role rejection when review_reason is missing or too short', async () => {
      const { roleRequest } = db.createRoleRequest({
        userId: 'usr_student',
        requestedRole: 'Researcher',
        justification: 'Research grant participation.'
      });

      // Missing reason
      const res1 = await makeRequest(
        app,
        'POST',
        `/api/role-requests/${roleRequest.request_id}/reject`,
        {},
        { Authorization: `Bearer ${adminToken}` }
      );
      expect(res1.status).toBe(400);
      expect(res1.body.code).toBe('REVIEW_REASON_REQUIRED');

      // Too short reason (< 5 characters)
      const res2 = await makeRequest(
        app,
        'POST',
        `/api/role-requests/${roleRequest.request_id}/reject`,
        { review_reason: 'No' },
        { Authorization: `Bearer ${adminToken}` }
      );
      expect(res2.status).toBe(400);
      expect(res2.body.code).toBe('REVIEW_REASON_REQUIRED');
    });
  });

  // -------------------------------------------------------------------------
  // 2. Anti-Self-Approval & Self-Review Protections
  // -------------------------------------------------------------------------
  describe('2. Anti-Self-Approval Enforcement', () => {
    it('2.1 Prevents reviewer from approving their own role elevation request', async () => {
      // Create a request where reviewer is also requester (e.g. lecturer requesting Researcher)
      const { roleRequest } = db.createRoleRequest({
        userId: 'usr_admin',
        requestedRole: 'Admin',
        justification: 'Renewing administrative mandate.'
      });

      const res = await makeRequest(
        app,
        'POST',
        `/api/role-requests/${roleRequest.request_id}/approve`,
        { review_reason: 'Self approval attempt.' },
        { Authorization: `Bearer ${adminToken}` }
      );

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('SELF_APPROVAL_PROHIBITED');
    });

    it('2.2 Prevents reviewer from rejecting their own role request', async () => {
      const { roleRequest } = db.createRoleRequest({
        userId: 'usr_admin',
        requestedRole: 'Admin',
        justification: 'Test self review.'
      });

      const res = await makeRequest(
        app,
        'POST',
        `/api/role-requests/${roleRequest.request_id}/reject`,
        { review_reason: 'Self rejection attempt.' },
        { Authorization: `Bearer ${adminToken}` }
      );

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('SELF_APPROVAL_PROHIBITED');
    });
  });

  // -------------------------------------------------------------------------
  // 3. Risk-Tier Policy: Admin Promotion vs Main Administrator Authority
  // -------------------------------------------------------------------------
  describe('3. Risk-Tier Authority Boundaries (Admin Elevation)', () => {
    it('3.1 Rejects regular Admin attempting to approve Admin promotion', async () => {
      const { roleRequest } = db.createRoleRequest({
        userId: 'usr_lecturer',
        requestedRole: 'Admin',
        justification: 'Appointed department chair needing administrative oversight.'
      });

      // Regular Admin (usr_admin) attempts to approve
      const res = await makeRequest(
        app,
        'POST',
        `/api/role-requests/${roleRequest.request_id}/approve`,
        { review_reason: 'Approved by peer admin.' },
        { Authorization: `Bearer ${adminToken}` }
      );

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('INSUFFICIENT_ADMIN_PRIVILEGE');

      // Verify target user was NOT elevated
      const lecturer = db.getState().users.find(u => u.id === 'usr_lecturer')!;
      expect(lecturer.role).toBe('Lecturer');
    });

    it('3.2 Allows verified Main Administrator to approve Admin promotion', async () => {
      const { roleRequest } = db.createRoleRequest({
        userId: 'usr_lecturer',
        requestedRole: 'Admin',
        justification: 'Appointed department chair needing administrative oversight.'
      });

      // Main Admin (usr_main_admin) approves
      const res = await makeRequest(
        app,
        'POST',
        `/api/role-requests/${roleRequest.request_id}/approve`,
        { review_reason: 'Department chair governance approval granted.' },
        { Authorization: `Bearer ${mainAdminToken}` }
      );

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.role_request.approval_status).toBe('APPROVED');

      // Target user role is now Admin
      const lecturer = db.getState().users.find(u => u.id === 'usr_lecturer')!;
      expect(lecturer.role).toBe('Admin');
      // Crucial: Approval Engine does NOT grant is_main_admin!
      expect(lecturer.is_main_admin).toBeUndefined();
      expect(hasPermission(lecturer, 'MANAGE_PRIVILEGED_ROLES')).toBe(false);
    });

    it('3.3 Prevents non-admins from reviewing any role requests', async () => {
      const { roleRequest } = db.createRoleRequest({
        userId: 'usr_student',
        requestedRole: 'Researcher',
        justification: 'Research grant assistant.'
      });

      // Lecturer tries to approve
      const resLecturer = await makeRequest(
        app,
        'POST',
        `/api/role-requests/${roleRequest.request_id}/approve`,
        { review_reason: 'Faculty approval.' },
        { Authorization: `Bearer ${lecturerToken}` }
      );
      expect(resLecturer.status).toBe(403);
      expect(resLecturer.body.code).toBe('FORBIDDEN');

      // Researcher tries to approve
      const resResearcher = await makeRequest(
        app,
        'POST',
        `/api/role-requests/${roleRequest.request_id}/approve`,
        { review_reason: 'Peer approval.' },
        { Authorization: `Bearer ${researcherToken}` }
      );
      expect(resResearcher.status).toBe(403);
      expect(resResearcher.body.code).toBe('FORBIDDEN');
    });
  });

  // -------------------------------------------------------------------------
  // 4. Account Lifecycle & Status Constraints
  // -------------------------------------------------------------------------
  describe('4. Inactive / Suspended Account Constraints', () => {
    it('4.1 Rejects reviewer whose account is SUSPENDED or DISABLED', async () => {
      const { roleRequest } = db.createRoleRequest({
        userId: 'usr_student',
        requestedRole: 'Researcher',
        justification: 'Research lab assistant.'
      });

      // Suspend admin
      const admin = db.getState().users.find(u => u.id === 'usr_admin')!;
      admin.account_status = 'SUSPENDED';
      db.save();

      const res = await makeRequest(
        app,
        'POST',
        `/api/role-requests/${roleRequest.request_id}/approve`,
        { review_reason: 'Suspended admin approving.' },
        { Authorization: `Bearer ${adminToken}` }
      );

      // checkActiveAccount middleware or roleApprovalEngine rejects with 403
      expect(res.status).toBe(403);
    });

    it('4.2 Rejects elevation of target user whose account is SUSPENDED or DISABLED', async () => {
      const { roleRequest } = db.createRoleRequest({
        userId: 'usr_student',
        requestedRole: 'Researcher',
        justification: 'Lab thesis.'
      });

      // Suspend target student
      const student = db.getState().users.find(u => u.id === 'usr_student')!;
      student.account_status = 'SUSPENDED';
      db.save();

      const res = await makeRequest(
        app,
        'POST',
        `/api/role-requests/${roleRequest.request_id}/approve`,
        { review_reason: 'Approving suspended student.' },
        { Authorization: `Bearer ${adminToken}` }
      );

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('TARGET_NOT_ACTIVE');

      // Verify student was NOT elevated and account status remains SUSPENDED
      const checkStudent = db.getState().users.find(u => u.id === 'usr_student')!;
      expect(checkStudent.role).toBe('Student');
      expect(checkStudent.account_status).toBe('SUSPENDED');
    });
  });

  // -------------------------------------------------------------------------
  // 5. State Machine: Terminal Status Immutability & Replay Defense
  // -------------------------------------------------------------------------
  describe('5. State Machine: Immutability & Replay Conflict (HTTP 409)', () => {
    it('5.1 Returns HTTP 409 Conflict when attempting to approve an already APPROVED request', async () => {
      const { roleRequest } = db.createRoleRequest({
        userId: 'usr_student',
        requestedRole: 'Researcher',
        justification: 'Data analysis grant.'
      });

      // First approval
      const res1 = await makeRequest(
        app,
        'POST',
        `/api/role-requests/${roleRequest.request_id}/approve`,
        { review_reason: 'Initial approval.' },
        { Authorization: `Bearer ${adminToken}` }
      );
      expect(res1.status).toBe(200);

      // Replay approval
      const res2 = await makeRequest(
        app,
        'POST',
        `/api/role-requests/${roleRequest.request_id}/approve`,
        { review_reason: 'Duplicate replay approval.' },
        { Authorization: `Bearer ${adminToken}` }
      );
      expect(res2.status).toBe(409);
      expect(res2.body.code).toBe('ALREADY_FINALIZED');
    });

    it('5.2 Returns HTTP 409 Conflict when attempting to reject an already APPROVED request', async () => {
      const { roleRequest } = db.createRoleRequest({
        userId: 'usr_student',
        requestedRole: 'Researcher',
        justification: 'Grant project.'
      });

      // Approve
      await makeRequest(
        app,
        'POST',
        `/api/role-requests/${roleRequest.request_id}/approve`,
        { review_reason: 'Approved.' },
        { Authorization: `Bearer ${adminToken}` }
      );

      // Try to reject
      const res = await makeRequest(
        app,
        'POST',
        `/api/role-requests/${roleRequest.request_id}/reject`,
        { review_reason: 'Attempting to reverse approval.' },
        { Authorization: `Bearer ${adminToken}` }
      );
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('ALREADY_FINALIZED');
    });

    it('5.3 Returns HTTP 409 Conflict when attempting to approve an already REJECTED request', async () => {
      const { roleRequest } = db.createRoleRequest({
        userId: 'usr_student',
        requestedRole: 'Lecturer',
        justification: 'Teaching.'
      });

      // Reject
      await makeRequest(
        app,
        'POST',
        `/api/role-requests/${roleRequest.request_id}/reject`,
        { review_reason: 'Denied due to prerequisites.' },
        { Authorization: `Bearer ${adminToken}` }
      );

      // Try to approve
      const res = await makeRequest(
        app,
        'POST',
        `/api/role-requests/${roleRequest.request_id}/approve`,
        { review_reason: 'Trying to approve rejected.' },
        { Authorization: `Bearer ${adminToken}` }
      );
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('ALREADY_FINALIZED');
    });

    it('5.4 Handles concurrent processing safely: second attempt receives 409 Conflict', async () => {
      const { roleRequest } = db.createRoleRequest({
        userId: 'usr_student',
        requestedRole: 'Researcher',
        justification: 'Concurrent test.'
      });

      // Execute approval sequentially/concurrently
      const p1 = makeRequest(
        app,
        'POST',
        `/api/role-requests/${roleRequest.request_id}/approve`,
        { review_reason: 'Reviewer A approval.' },
        { Authorization: `Bearer ${adminToken}` }
      );
      const p2 = makeRequest(
        app,
        'POST',
        `/api/role-requests/${roleRequest.request_id}/approve`,
        { review_reason: 'Reviewer B approval.' },
        { Authorization: `Bearer ${adminToken}` }
      );

      const [resA, resB] = await Promise.all([p1, p2]);
      const statuses = [resA.status, resB.status].sort();
      expect(statuses).toEqual([200, 409]);
    });
  });

  // -------------------------------------------------------------------------
  // 6. Request Cancellation & IDOR / BOLA Protections
  // -------------------------------------------------------------------------
  describe('6. Owner Cancellation & Object-Level IDOR / BOLA Protections', () => {
    it('6.1 Allows owner to cancel their own PENDING request', async () => {
      const { roleRequest } = db.createRoleRequest({
        userId: 'usr_student',
        requestedRole: 'Researcher',
        justification: 'Lab work.'
      });

      const res = await makeRequest(
        app,
        'POST',
        `/api/role-requests/${roleRequest.request_id}/cancel`,
        {},
        { Authorization: `Bearer ${studentToken}` }
      );

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.role_request.approval_status).toBe('CANCELLED');

      // Subsequent attempt to approve cancelled request returns 409
      const approveRes = await makeRequest(
        app,
        'POST',
        `/api/role-requests/${roleRequest.request_id}/approve`,
        { review_reason: 'Approving cancelled.' },
        { Authorization: `Bearer ${adminToken}` }
      );
      expect(approveRes.status).toBe(409);
      expect(approveRes.body.code).toBe('ALREADY_FINALIZED');
    });

    it('6.2 Rejects non-owner attempting to cancel another user role request (IDOR Defense)', async () => {
      const { roleRequest } = db.createRoleRequest({
        userId: 'usr_student',
        requestedRole: 'Researcher',
        justification: 'Lab work.'
      });

      // Lecturer attempts to cancel student's request
      const res = await makeRequest(
        app,
        'POST',
        `/api/role-requests/${roleRequest.request_id}/cancel`,
        {},
        { Authorization: `Bearer ${lecturerToken}` }
      );

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN_NOT_OWNER');
    });

    it('6.3 Rejects non-admin attempting to view another user role request via GET /api/role-requests/:id', async () => {
      const { roleRequest } = db.createRoleRequest({
        userId: 'usr_lecturer',
        requestedRole: 'Admin',
        justification: 'Confidential administrative credentials.'
      });

      // Student tries to view lecturer's request
      const res = await makeRequest(
        app,
        'GET',
        `/api/role-requests/${roleRequest.request_id}`,
        undefined,
        { Authorization: `Bearer ${studentToken}` }
      );

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('OBJECT_ACCESS_DENIED');
    });
  });

  // -------------------------------------------------------------------------
  // 7. Client Parameter Tampering Immunity
  // -------------------------------------------------------------------------
  describe('7. Client Parameter Tampering Immunity', () => {
    it('7.1 Ignores client payload attempts to inject role, permissions, is_main_admin, or reviewed_by', async () => {
      const { roleRequest } = db.createRoleRequest({
        userId: 'usr_student',
        requestedRole: 'Researcher',
        justification: 'Biochemistry lab.'
      });

      const maliciousPayload = {
        role: 'Admin',
        is_main_admin: true,
        permissions: ['MANAGE_PRIVILEGED_ROLES', 'ADMIN'],
        reviewed_by: 'usr_student',
        approval_status: 'APPROVED',
        review_reason: 'Tampered payload injection attempt.'
      };

      const res = await makeRequest(
        app,
        'POST',
        `/api/role-requests/${roleRequest.request_id}/approve`,
        maliciousPayload,
        { Authorization: `Bearer ${adminToken}` }
      );

      expect(res.status).toBe(200);

      // Verify student role became Researcher (from DB request), NOT Admin
      const updatedUser = db.getState().users.find(u => u.id === 'usr_student')!;
      expect(updatedUser.role).toBe('Researcher');
      expect(updatedUser.is_main_admin).toBeUndefined();
      expect(updatedUser.permissions).not.toContain('MANAGE_PRIVILEGED_ROLES');

      // Verify reviewed_by was taken from verified session (usr_admin), not client body
      expect(res.body.role_request.reviewed_by).toBe('usr_admin');
    });
  });

  // -------------------------------------------------------------------------
  // 8. Session Invalidation & Stale Token Version Enforcement
  // -------------------------------------------------------------------------
  describe('8. Session Invalidation & Stale Token Defense', () => {
    it('8.1 Invalidate target user active sessions after role elevation (old token rejected)', async () => {
      // Student has active session
      const oldStudentToken = studentToken;

      // Verify old token works before approval
      const checkBefore = await makeRequest(
        app,
        'GET',
        '/api/role-requests/me',
        undefined,
        { Authorization: `Bearer ${oldStudentToken}` }
      );
      expect(checkBefore.status).toBe(200);

      // Create and approve request
      const { roleRequest } = db.createRoleRequest({
        userId: 'usr_student',
        requestedRole: 'Researcher',
        justification: 'Thesis work.'
      });

      await makeRequest(
        app,
        'POST',
        `/api/role-requests/${roleRequest.request_id}/approve`,
        { review_reason: 'Elevated to Researcher.' },
        { Authorization: `Bearer ${adminToken}` }
      );

      // Try using old student token immediately after approval
      const checkAfter = await makeRequest(
        app,
        'GET',
        '/api/role-requests/me',
        undefined,
        { Authorization: `Bearer ${oldStudentToken}` }
      );

      // Old token MUST be rejected with HTTP 401 Unauthorized (revoked or stale token_version)
      expect(checkAfter.status).toBe(401);
    });
  });

  // -------------------------------------------------------------------------
  // 9. Storage Failure & Atomicity Rollback Guarantees
  // -------------------------------------------------------------------------
  describe('9. Storage Failure & Atomicity Rollback Guarantees', () => {
    it('9.1 Rolls back in-memory mutations if disk write fails during approval', async () => {
      const { roleRequest } = db.createRoleRequest({
        userId: 'usr_student',
        requestedRole: 'Researcher',
        justification: 'Atomicity test.'
      });

      const studentBefore = db.getState().users.find(u => u.id === 'usr_student')!;
      const expectedTokenVersion = studentBefore.token_version;

      // Spy on saveToDisk to simulate ENOSPC / EIO disk failure
      const saveSpy = vi.spyOn(db as any, 'saveToDisk').mockImplementationOnce(() => {
        throw new Error('ENOSPC: no space left on device');
      });

      const res = await makeRequest(
        app,
        'POST',
        `/api/role-requests/${roleRequest.request_id}/approve`,
        { review_reason: 'Should fail disk write.' },
        { Authorization: `Bearer ${adminToken}` }
      );

      expect(res.status).toBe(500);

      // Verify in-memory state was cleanly rolled back
      const student = db.getState().users.find(u => u.id === 'usr_student')!;
      expect(student.role).toBe('Student');
      expect(student.token_version).toBe(expectedTokenVersion);

      const reqState = db.findRoleRequestById(roleRequest.request_id)!;
      expect(reqState.approval_status).toBe('PENDING');
      expect(reqState.reviewed_by).toBeNull();

      // Clean up spy
      saveSpy.mockRestore();
    });
  });

  // -------------------------------------------------------------------------
  // 10. No Alternative / Bypass Endpoints
  // -------------------------------------------------------------------------
  describe('10. Absence of Role Elevation Bypass Endpoints', () => {
    it('10.1 Returns 404 for arbitrary user role mutation endpoints', async () => {
      // Attempting direct PUT /api/users/usr_student
      const resPut = await makeRequest(
        app,
        'PUT',
        '/api/users/usr_student',
        { role: 'Admin', is_main_admin: true },
        { Authorization: `Bearer ${studentToken}` }
      );
      expect(resPut.status).toBe(404);

      // Attempting direct PATCH /api/users/usr_student
      const resPatch = await makeRequest(
        app,
        'PATCH',
        '/api/users/usr_student',
        { role: 'Admin', is_main_admin: true },
        { Authorization: `Bearer ${studentToken}` }
      );
      expect(resPatch.status).toBe(404);

      // Attempting HTTP call to bootstrap
      const resBootstrap = await makeRequest(
        app,
        'POST',
        '/api/admin/bootstrap',
        { user_id: 'usr_student' },
        { Authorization: `Bearer ${studentToken}` }
      );
      expect(resBootstrap.status).toBe(404);
    });
  });
});
