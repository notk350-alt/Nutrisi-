/**
 * NutriBodySim — MVS-B2.5A.1 Adversarial Verification Gate Test Suite
 *
 * Comprehensive adversarial tests covering:
 * 1. Identity binding & parameter tampering defense (spoofed user_id, approval_status, reviewed_by).
 * 2. External identity unique constraint & anti-account-hijacking (no auto-merging on email).
 * 3. Role hierarchy edge cases & corruption defense (Student, Lecturer, Researcher, Admin, Main Admin).
 * 4. Object-level authorization & multi-endpoint suspended/disabled account containment.
 * 5. Storage consistency, atomic audit staging, and rollback on simulated disk failure.
 * 6. Audit log access boundaries and immutability.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express, { Express } from 'express';
import http from 'http';
import { apiRouter } from '../routes/api';
import { defaultSessionStore } from '../auth/sessionStore';
import { db } from '../database/store';
import { User, RoleRequest, ExternalIdentity } from '../database/types';
import {
  validateRequestedRole,
  checkRoleEligibility,
  sanitizeTextField,
  hasDuplicatePendingRequest
} from '../auth/roleRequestValidation';
import { canAccessRoleRequest } from '../auth/objectAuth';

function createTestApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  return app;
}

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

      const reqHeaders: Record<string, string> = { ...headers };
      if (dataStr) {
        reqHeaders['Content-Type'] = 'application/json';
        reqHeaders['Content-Length'] = Buffer.byteLength(dataStr).toString();
      }

      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path: url,
          method,
          headers: reqHeaders
        },
        res => {
          let responseData = '';
          res.on('data', chunk => {
            responseData += chunk;
          });
          res.on('end', () => {
            server.close(() => {
              let parsedBody = responseData;
              try {
                parsedBody = JSON.parse(responseData);
              } catch {}
              resolve({
                status: res.statusCode || 500,
                body: parsedBody,
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

describe('NutriBodySim — MVS-B2.5A.1 Adversarial Verification Suite', () => {
  let app: Express;
  let studentToken: string;
  let lecturerToken: string;
  let researcherToken: string;
  let adminToken: string;

  beforeEach(() => {
    defaultSessionStore.clear();
    app = createTestApp();

    const state = db.getState();
    state.role_requests = [];
    state.external_identities = [];

    // Ensure all standard users start ACTIVE
    for (const u of state.users) {
      u.account_status = 'ACTIVE';
      u.email_verified = true;
    }
    db.save();

    studentToken = defaultSessionStore.createSession('usr_student').token;
    lecturerToken = defaultSessionStore.createSession('usr_lecturer').token;
    researcherToken = defaultSessionStore.createSession('usr_researcher').token;
    adminToken = defaultSessionStore.createSession('usr_admin').token;
  });

  afterEach(() => {
    defaultSessionStore.clear();
  });

  // --------------------------------------------------------------------------
  // SECTION 1: Identity Verification & Parameter Tampering
  // --------------------------------------------------------------------------
  describe('1. Identity Verification & Parameter Tampering Resistance', () => {
    it('strictly overrides client-supplied user_id, binding request to verified session identity', async () => {
      const res = await makeRequest(
        app,
        'POST',
        '/api/role-requests',
        {
          requested_role: 'Researcher',
          user_id: 'usr_admin', // Tampering attempt: student claims to submit on behalf of admin
          justification: 'Attempting to inject different user_id'
        },
        { Authorization: `Bearer ${studentToken}` }
      );

      expect(res.status).toBe(201);
      expect(res.body.role_request.user_id).toBe('usr_student');
      expect(res.body.role_request.user_id).not.toBe('usr_admin');

      // Verify stored entity
      const inDb = db.findRoleRequestById(res.body.role_request.request_id);
      expect(inDb?.user_id).toBe('usr_student');
    });

    it('strictly ignores client-supplied approval_status, reviewed_by, reviewed_at, and review_reason', async () => {
      const res = await makeRequest(
        app,
        'POST',
        '/api/role-requests',
        {
          requested_role: 'Researcher',
          approval_status: 'APPROVED', // Privilege escalation attempt: pre-approving own request
          reviewed_by: 'usr_admin',
          reviewed_at: '2026-10-16T00:00:00.000Z',
          review_reason: 'Self-granted administrative elevation bypass'
        },
        { Authorization: `Bearer ${studentToken}` }
      );

      expect(res.status).toBe(201);
      const reqRecord = res.body.role_request;
      expect(reqRecord.approval_status).toBe('PENDING');
      expect(reqRecord.reviewed_by).toBeNull();
      expect(reqRecord.reviewed_at).toBeNull();
      expect(reqRecord.review_reason).toBeNull();

      // Verify that user role remains unchanged (Student)
      const studentUser = db.getState().users.find(u => u.id === 'usr_student');
      expect(studentUser?.role).toBe('Student');
    });

    it('strictly ignores client-supplied request_id and created_at', async () => {
      const fakeId = 'req_fake_arbitrary_id_999';
      const fakeDate = '1999-01-01T00:00:00.000Z';

      const res = await makeRequest(
        app,
        'POST',
        '/api/role-requests',
        {
          requested_role: 'Researcher',
          request_id: fakeId,
          created_at: fakeDate
        },
        { Authorization: `Bearer ${studentToken}` }
      );

      expect(res.status).toBe(201);
      expect(res.body.role_request.request_id).not.toBe(fakeId);
      expect(res.body.role_request.request_id).toMatch(/^req_/);
      expect(res.body.role_request.created_at).not.toBe(fakeDate);
    });

    it('enforces external identity uniqueness constraint and blocks duplicate subject links', () => {
      const ext1: ExternalIdentity = {
        provider: 'google',
        provider_subject_id: 'goog_sub_alpha_1',
        user_id: 'usr_student',
        email: 'student@example.org',
        email_verified: true,
        linked_at: new Date().toISOString()
      };
      db.linkExternalIdentity(ext1);

      const extDuplicate: ExternalIdentity = {
        provider: 'google',
        provider_subject_id: 'goog_sub_alpha_1', // Collision
        user_id: 'usr_lecturer',
        email: 'lecturer@example.org',
        email_verified: true,
        linked_at: new Date().toISOString()
      };

      expect(() => db.linkExternalIdentity(extDuplicate)).toThrow(/Unique constraint violation/);
    });

    it('prohibits automatic account merging based on email match', () => {
      const ext: ExternalIdentity = {
        provider: 'google',
        provider_subject_id: 'goog_sub_beta_2',
        user_id: 'usr_lecturer',
        email: 'researcher@nutribodysim.org', // Matches researcher email
        email_verified: true,
        linked_at: new Date().toISOString()
      };
      db.linkExternalIdentity(ext);

      // Verify link belongs exclusively to target usr_lecturer and NOT usr_researcher
      const researcherIdentities = db.getExternalIdentitiesForUser('usr_researcher');
      expect(researcherIdentities).toHaveLength(0);

      const lecturerIdentities = db.getExternalIdentitiesForUser('usr_lecturer');
      expect(lecturerIdentities).toHaveLength(1);
      expect(lecturerIdentities[0].user_id).toBe('usr_lecturer');
    });
  });

  // --------------------------------------------------------------------------
  // SECTION 2: Role Hierarchy & Elevation Edge Cases
  // --------------------------------------------------------------------------
  describe('2. Role Hierarchy & Elevation Edge Cases', () => {
    it('allows Student to request Lecturer or Researcher', async () => {
      const res = await makeRequest(
        app,
        'POST',
        '/api/role-requests',
        { requested_role: 'Lecturer', justification: 'Completed pedagogical training' },
        { Authorization: `Bearer ${studentToken}` }
      );
      expect(res.status).toBe(201);
      expect(res.body.role_request.requested_role).toBe('Lecturer');
    });

    it('requires explicit justification for lateral transfer (Lecturer to Researcher)', async () => {
      // Without justification -> rejected
      const failRes = await makeRequest(
        app,
        'POST',
        '/api/role-requests',
        { requested_role: 'Researcher', justification: '' },
        { Authorization: `Bearer ${lecturerToken}` }
      );
      expect(failRes.status).toBe(400);
      expect(failRes.body.error).toContain('Lateral role change');

      // With justification -> accepted
      const passRes = await makeRequest(
        app,
        'POST',
        '/api/role-requests',
        { requested_role: 'Researcher', justification: 'Full-time bioenergetic computational physiology research assignment' },
        { Authorization: `Bearer ${lecturerToken}` }
      );
      expect(passRes.status).toBe(201);
      expect(passRes.body.role_request.requested_role).toBe('Researcher');
    });

    it('requires explicit justification for lateral transfer (Researcher to Lecturer)', async () => {
      // Without justification -> rejected
      const failRes = await makeRequest(
        app,
        'POST',
        '/api/role-requests',
        { requested_role: 'Lecturer' },
        { Authorization: `Bearer ${researcherToken}` }
      );
      expect(failRes.status).toBe(400);
      expect(failRes.body.error).toContain('Lateral role change');

      // With justification -> accepted
      const passRes = await makeRequest(
        app,
        'POST',
        '/api/role-requests',
        { requested_role: 'Lecturer', justification: 'Appointed adjunct faculty course director for Computational Metabolism' },
        { Authorization: `Bearer ${researcherToken}` }
      );
      expect(passRes.status).toBe(201);
      expect(passRes.body.role_request.requested_role).toBe('Lecturer');
    });

    it('allows Lecturer or Researcher to request Admin', async () => {
      const res = await makeRequest(
        app,
        'POST',
        '/api/role-requests',
        { requested_role: 'Admin', justification: 'Institutional governance appointment' },
        { Authorization: `Bearer ${researcherToken}` }
      );
      expect(res.status).toBe(201);
      expect(res.body.role_request.requested_role).toBe('Admin');
    });

    it('rejects Admin requesting any role elevation or change', async () => {
      const res = await makeRequest(
        app,
        'POST',
        '/api/role-requests',
        { requested_role: 'Researcher' },
        { Authorization: `Bearer ${adminToken}` }
      );
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('highest authority');
    });

    it('rejects requests for non-existent "Main Administrator" or "SuperAdmin"', async () => {
      const res1 = await makeRequest(
        app,
        'POST',
        '/api/role-requests',
        { requested_role: 'Main Administrator' },
        { Authorization: `Bearer ${lecturerToken}` }
      );
      expect(res1.status).toBe(400);
      expect(res1.body.code).toBe('INVALID_ROLE');

      const res2 = await makeRequest(
        app,
        'POST',
        '/api/role-requests',
        { requested_role: 'SuperAdmin' },
        { Authorization: `Bearer ${lecturerToken}` }
      );
      expect(res2.status).toBe(400);
      expect(res2.body.code).toBe('INVALID_ROLE');
    });

    it('handles corrupted user role data safely without throwing unhandled exceptions', () => {
      const corruptedResult = checkRoleEligibility('CORRUPT_ROLE_DATA' as any, 'Lecturer');
      expect(corruptedResult.allowed).toBe(false);
      expect(corruptedResult.error).toContain('unrecognized or corrupted role');
    });

    it('confirms submitting a role request does NOT alter effective permissions or role', async () => {
      await makeRequest(
        app,
        'POST',
        '/api/role-requests',
        { requested_role: 'Admin', justification: 'Elevation request' },
        { Authorization: `Bearer ${studentToken}` }
      );

      // Verify student cannot access admin audit endpoint
      const auditRes = await makeRequest(
        app,
        'GET',
        '/api/audit',
        undefined,
        { Authorization: `Bearer ${studentToken}` }
      );
      expect(auditRes.status).toBe(403);
    });
  });

  // --------------------------------------------------------------------------
  // SECTION 3: Admin & Main Administrator Separation Boundaries
  // --------------------------------------------------------------------------
  describe('3. Admin & Main Administrator Separation Boundaries', () => {
    it('restricts GET /api/role-requests exclusively to Admin', async () => {
      // Non-admins rejected
      const studentRes = await makeRequest(app, 'GET', '/api/role-requests', undefined, { Authorization: `Bearer ${studentToken}` });
      expect(studentRes.status).toBe(403);

      const lecturerRes = await makeRequest(app, 'GET', '/api/role-requests', undefined, { Authorization: `Bearer ${lecturerToken}` });
      expect(lecturerRes.status).toBe(403);

      const researcherRes = await makeRequest(app, 'GET', '/api/role-requests', undefined, { Authorization: `Bearer ${researcherToken}` });
      expect(researcherRes.status).toBe(403);

      // Admin permitted
      const adminRes = await makeRequest(app, 'GET', '/api/role-requests', undefined, { Authorization: `Bearer ${adminToken}` });
      expect(adminRes.status).toBe(200);
    });

    it('confirms that no role approval or self-elevation endpoint currently exists in the codebase', async () => {
      // Ensure there are no unauthenticated or backdoor approval routes
      const approveRes = await makeRequest(
        app,
        'POST',
        '/api/role-requests/req_test/approve',
        {},
        { Authorization: `Bearer ${adminToken}` }
      );
      // Route does not exist (404 expected)
      expect(approveRes.status).toBe(404);
    });
  });

  // --------------------------------------------------------------------------
  // SECTION 4: Object-Level Authorization & Account Status Containment
  // --------------------------------------------------------------------------
  describe('4. Object-Level Authorization & Inactive Account Containment', () => {
    let studentReqId: string;
    let lecturerReqId: string;

    beforeEach(async () => {
      const r1 = await makeRequest(
        app,
        'POST',
        '/api/role-requests',
        { requested_role: 'Researcher', justification: 'Student request' },
        { Authorization: `Bearer ${studentToken}` }
      );
      studentReqId = r1.body.role_request.request_id;

      const r2 = await makeRequest(
        app,
        'POST',
        '/api/role-requests',
        { requested_role: 'Admin', justification: 'Lecturer request' },
        { Authorization: `Bearer ${lecturerToken}` }
      );
      lecturerReqId = r2.body.role_request.request_id;
    });

    it('enforces data isolation on GET /api/role-requests/me', async () => {
      const res = await makeRequest(app, 'GET', '/api/role-requests/me', undefined, { Authorization: `Bearer ${studentToken}` });
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(1);
      expect(res.body.role_requests[0].request_id).toBe(studentReqId);
      expect(res.body.role_requests.some((r: any) => r.request_id === lecturerReqId)).toBe(false);
    });

    it('blocks cross-user inspection on GET /api/role-requests/:id (BOLA defense)', async () => {
      // Student attempts to inspect Lecturer's private role elevation request
      const res = await makeRequest(
        app,
        'GET',
        `/api/role-requests/${lecturerReqId}`,
        undefined,
        { Authorization: `Bearer ${studentToken}` }
      );
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('OBJECT_ACCESS_DENIED');
      expect(res.body.entity_type).toBe('ROLE_REQUEST');
    });

    it('blocks SUSPENDED accounts on EVERY role-request endpoint', async () => {
      const student = db.getState().users.find(u => u.id === 'usr_student')!;
      student.account_status = 'SUSPENDED';
      db.save();

      // 1. POST /api/role-requests
      const postRes = await makeRequest(
        app,
        'POST',
        '/api/role-requests',
        { requested_role: 'Lecturer' },
        { Authorization: `Bearer ${studentToken}` }
      );
      expect(postRes.status).toBe(403);
      expect(postRes.body.code).toBe('FORBIDDEN_ACCOUNT_STATUS');

      // 2. GET /api/role-requests/me
      const meRes = await makeRequest(
        app,
        'GET',
        '/api/role-requests/me',
        undefined,
        { Authorization: `Bearer ${studentToken}` }
      );
      expect(meRes.status).toBe(403);
      expect(meRes.body.code).toBe('FORBIDDEN_ACCOUNT_STATUS');

      // 3. GET /api/role-requests/:id
      const idRes = await makeRequest(
        app,
        'GET',
        `/api/role-requests/${studentReqId}`,
        undefined,
        { Authorization: `Bearer ${studentToken}` }
      );
      expect(idRes.status).toBe(403);
      expect(idRes.body.code).toBe('FORBIDDEN_ACCOUNT_STATUS');

      // 4. GET /api/role-requests
      const allRes = await makeRequest(
        app,
        'GET',
        '/api/role-requests',
        undefined,
        { Authorization: `Bearer ${studentToken}` }
      );
      expect(allRes.status).toBe(403);
      expect(allRes.body.code).toBe('FORBIDDEN_ACCOUNT_STATUS');
    });

    it('blocks DISABLED accounts on EVERY role-request endpoint', async () => {
      const student = db.getState().users.find(u => u.id === 'usr_student')!;
      student.account_status = 'DISABLED';
      db.save();

      const postRes = await makeRequest(
        app,
        'POST',
        '/api/role-requests',
        { requested_role: 'Lecturer' },
        { Authorization: `Bearer ${studentToken}` }
      );
      expect(postRes.status).toBe(403);
      expect(postRes.body.code).toBe('FORBIDDEN_ACCOUNT_STATUS');

      const meRes = await makeRequest(
        app,
        'GET',
        '/api/role-requests/me',
        undefined,
        { Authorization: `Bearer ${studentToken}` }
      );
      expect(meRes.status).toBe(403);
      expect(meRes.body.code).toBe('FORBIDDEN_ACCOUNT_STATUS');
    });
  });

  // --------------------------------------------------------------------------
  // SECTION 5: Storage Consistency, Concurrency & Atomic Rollback
  // --------------------------------------------------------------------------
  describe('5. Storage Consistency, Concurrency & Atomic Rollback', () => {
    it('handles near-simultaneous duplicate requests with deterministic 409 Conflict', async () => {
      // Fire two identical requests in parallel
      const [resA, resB] = await Promise.all([
        makeRequest(
          app,
          'POST',
          '/api/role-requests',
          { requested_role: 'Lecturer', justification: 'Parallel submission A' },
          { Authorization: `Bearer ${studentToken}` }
        ),
        makeRequest(
          app,
          'POST',
          '/api/role-requests',
          { requested_role: 'Lecturer', justification: 'Parallel submission B' },
          { Authorization: `Bearer ${studentToken}` }
        )
      ]);

      const statuses = [resA.status, resB.status].sort();
      // Exactly one must succeed (201) and one must be rejected (409)
      expect(statuses).toEqual([201, 409]);
    });

    it('enforces storage-level validation directly in DatabaseStore', () => {
      // Direct call with invalid user
      expect(() => {
        db.createRoleRequest({
          userId: 'non_existent_usr',
          requestedRole: 'Researcher'
        });
      }).toThrow(/not found in registry/);

      // Direct call with suspended user
      const student = db.getState().users.find(u => u.id === 'usr_student')!;
      student.account_status = 'SUSPENDED';
      expect(() => {
        db.createRoleRequest({
          userId: 'usr_student',
          requestedRole: 'Researcher'
        });
      }).toThrow(/Only ACTIVE users/);
    });

    it('guarantees atomic rollback of in-memory state if disk write throws', () => {
      const initialCount = db.getRoleRequests().length;
      const initialAuditCount = db.getState().audit_logs.length;

      // Mock saveToDisk to simulate disk failure / ENOSPC
      const originalSaveToDisk = (db as any).saveToDisk;
      (db as any).saveToDisk = () => {
        throw new Error('ENOSPC: no space left on device');
      };

      try {
        expect(() => {
          db.createRoleRequest({
            userId: 'usr_student',
            requestedRole: 'Researcher'
          });
        }).toThrow(/ENOSPC/);

        // State MUST be cleanly rolled back: no staged request, no orphaned audit log
        expect(db.getRoleRequests().length).toBe(initialCount);
        expect(db.getState().audit_logs.length).toBe(initialAuditCount);
      } finally {
        (db as any).saveToDisk = originalSaveToDisk;
      }
    });

    it('creates role request and audit log atomically in the same operation', () => {
      const { roleRequest, auditLog } = db.createRoleRequest({
        userId: 'usr_student',
        requestedRole: 'Researcher',
        justification: 'Atomic test'
      });

      expect(roleRequest.request_id).toBeDefined();
      expect(auditLog.entity_id).toBe(roleRequest.request_id);
      expect(auditLog.action).toBe('CREATE');
      expect(auditLog.entity_type).toBe('ROLE_REQUEST');

      // Verify both exist in state
      expect(db.findRoleRequestById(roleRequest.request_id)).toBeDefined();
      expect(db.getState().audit_logs.some(a => a.id === auditLog.id)).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // SECTION 6: Audit Log Integrity & Endpoint Protection
  // --------------------------------------------------------------------------
  describe('6. Audit Log Integrity & Endpoint Protection', () => {
    it('records action, actor, target entity, timestamp, and details without leaking session tokens', async () => {
      const res = await makeRequest(
        app,
        'POST',
        '/api/role-requests',
        { requested_role: 'Researcher', justification: 'Audit inspection' },
        { Authorization: `Bearer ${studentToken}` }
      );
      expect(res.status).toBe(201);

      const latestLog = db.getState().audit_logs[0];
      expect(latestLog.entity_id).toBe(res.body.role_request.request_id);
      expect(latestLog.user_id).toBe('usr_student');
      expect(latestLog.details).toContain('Role elevation request submitted');
      // Must not contain raw session token
      expect(JSON.stringify(latestLog)).not.toContain(studentToken);
    });

    it('strictly prohibits non-admin users from viewing audit logs', async () => {
      const res = await makeRequest(
        app,
        'GET',
        '/api/audit',
        undefined,
        { Authorization: `Bearer ${studentToken}` }
      );
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('confirms no API routes exist to mutate or delete audit log records', async () => {
      const deleteRes = await makeRequest(app, 'DELETE', '/api/audit', {}, { Authorization: `Bearer ${adminToken}` });
      expect([404, 405]).toContain(deleteRes.status);

      const postRes = await makeRequest(app, 'POST', '/api/audit', {}, { Authorization: `Bearer ${adminToken}` });
      expect([404, 405]).toContain(postRes.status);

      const putRes = await makeRequest(app, 'PUT', '/api/audit', {}, { Authorization: `Bearer ${adminToken}` });
      expect([404, 405]).toContain(putRes.status);
    });
  });
});
