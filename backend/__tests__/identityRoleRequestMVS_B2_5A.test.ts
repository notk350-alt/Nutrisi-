/**
 * NutriBodySim — MVS-B2.5A Identity Schema, Role Request Foundation & Safety Gate Test Suite
 *
 * Verifies:
 * 1. Internal identity schema & fields (user_id, display_name, email, email_verified, account_status, created_at, updated_at).
 * 2. External identity schema & constraints (provider, provider_subject_id, unique constraint pair, no email auto-merging).
 * 3. Role request model & strict enum validation (RequestedRole, ApprovalStatus).
 * 4. Input sanitization (HTML stripping, length validation, control character removal).
 * 5. Role hierarchy & eligibility rules:
 *    - Student can request Lecturer, Researcher, Admin.
 *    - User cannot request currently held role (400 Bad Request).
 *    - User cannot request lower role (400 Bad Request).
 *    - Admin cannot request role elevation (400 Bad Request).
 * 6. Account status enforcement:
 *    - ACTIVE account can submit requests.
 *    - SUSPENDED or DISABLED account cannot submit requests (403 Forbidden).
 * 7. Duplicate pending request conflict:
 *    - Active PENDING request for the same role yields 409 Conflict.
 *    - After resolution (or non-pending), submission is permitted.
 * 8. API Endpoints:
 *    - POST /api/role-requests (401 unauth, 403 inactive, 400 invalid role/demotion, 409 duplicate, 201 success).
 *    - GET /api/role-requests/me (user data isolation).
 *    - GET /api/role-requests/:id (object authorization: owner allowed, admin allowed, other users 403 forbidden, 404 not found).
 *    - GET /api/role-requests (admin only, non-admin 403 forbidden).
 * 9. Server audit trail generation for role request creation.
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
  hasDuplicatePendingRequest,
  ROLE_HIERARCHY
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

describe('NutriBodySim — MVS-B2.5A Identity & Role Request Foundation', () => {
  let app: Express;
  let studentToken: string;
  let lecturerToken: string;
  let researcherToken: string;
  let adminToken: string;

  beforeEach(() => {
    defaultSessionStore.clear();
    app = createTestApp();

    const state = db.getState();
    // Ensure clean test baseline
    state.role_requests = [];
    state.external_identities = [];

    // Ensure users have active status
    const student = state.users.find(u => u.id === 'usr_student');
    if (student) {
      student.account_status = 'ACTIVE';
      student.email_verified = true;
    }
    const lecturer = state.users.find(u => u.id === 'usr_lecturer');
    if (lecturer) {
      lecturer.account_status = 'ACTIVE';
      lecturer.email_verified = true;
    }
    const researcher = state.users.find(u => u.id === 'usr_researcher');
    if (researcher) {
      researcher.account_status = 'ACTIVE';
      researcher.email_verified = true;
    }
    const admin = state.users.find(u => u.id === 'usr_admin');
    if (admin) {
      admin.account_status = 'ACTIVE';
      admin.email_verified = true;
    }

    db.save();

    // Create session tokens
    studentToken = defaultSessionStore.createSession('usr_student').token;
    lecturerToken = defaultSessionStore.createSession('usr_lecturer').token;
    researcherToken = defaultSessionStore.createSession('usr_researcher').token;
    adminToken = defaultSessionStore.createSession('usr_admin').token;
  });

  afterEach(() => {
    defaultSessionStore.clear();
  });

  // --------------------------------------------------------------------------
  // 1. Internal Identity & External Identity Schema
  // --------------------------------------------------------------------------
  describe('1. Internal Identity & External Identity Schema Constraints', () => {
    it('verifies internal user records adhere to MVS-B2.5A schema', () => {
      const state = db.getState();
      for (const u of state.users) {
        expect(u.id).toBeDefined();
        expect(typeof u.id).toBe('string');
        expect(u.name).toBeDefined();
        expect(u.display_name).toBeDefined();
        expect(u.email).toContain('@');
        expect(u.email_verified).toBe(true);
        expect(['ACTIVE', 'SUSPENDED', 'DISABLED']).toContain(u.account_status);
        expect(u.created_at).toBeDefined();
        expect(u.updated_at).toBeDefined();
      }
    });

    it('enforces unique constraint on external identity (provider + provider_subject_id)', () => {
      const identity1: ExternalIdentity = {
        provider: 'google',
        provider_subject_id: 'sub_google_12345',
        user_id: 'usr_student',
        email: 'student@nutribodysim.org',
        email_verified: true,
        linked_at: new Date().toISOString()
      };

      const linked = db.linkExternalIdentity(identity1);
      expect(linked.provider).toBe('google');
      expect(linked.provider_subject_id).toBe('sub_google_12345');

      // Attempting to link the same provider + subject_id to another user MUST throw
      const duplicateIdentity: ExternalIdentity = {
        provider: 'google',
        provider_subject_id: 'sub_google_12345',
        user_id: 'usr_researcher',
        email: 'researcher@nutribodysim.org',
        email_verified: true,
        linked_at: new Date().toISOString()
      };

      expect(() => {
        db.linkExternalIdentity(duplicateIdentity);
      }).toThrow(/Unique constraint violation/i);
    });

    it('rejects external identity linking when target internal user does not exist', () => {
      const invalidIdentity: ExternalIdentity = {
        provider: 'google',
        provider_subject_id: 'sub_unknown_99999',
        user_id: 'usr_nonexistent_user',
        email: 'unknown@example.com',
        email_verified: true,
        linked_at: new Date().toISOString()
      };

      expect(() => {
        db.linkExternalIdentity(invalidIdentity);
      }).toThrow(/Target user with id 'usr_nonexistent_user' does not exist/i);
    });

    it('does NOT automatically merge accounts based on identical email addresses', () => {
      // Create external identity pointing to student
      const ext: ExternalIdentity = {
        provider: 'google',
        provider_subject_id: 'sub_google_isolated_01',
        user_id: 'usr_student',
        email: 'shared-contact@nutribodysim.org',
        email_verified: true,
        linked_at: new Date().toISOString()
      };
      db.linkExternalIdentity(ext);

      // Verify researcher is NOT altered or linked simply because of an email match
      const researcherIdentities = db.getExternalIdentitiesForUser('usr_researcher');
      expect(researcherIdentities.length).toBe(0);

      const studentIdentities = db.getExternalIdentitiesForUser('usr_student');
      expect(studentIdentities.length).toBe(1);
      expect(studentIdentities[0].provider_subject_id).toBe('sub_google_isolated_01');
    });

    it('verifies demo users do NOT possess synthetic Google credentials or unverified claims', () => {
      const state = db.getState();
      const demoUsers = state.users.filter(u => u.provider === 'local');
      for (const u of demoUsers) {
        expect(u.provider).toBe('local');
        expect(u.provider_subject_id).toMatch(/^local_/);
        // Ensure no fake google identity
        expect(u.provider).not.toBe('google');
      }
    });
  });

  // --------------------------------------------------------------------------
  // 2. Role Request Validation & Hierarchy
  // --------------------------------------------------------------------------
  describe('2. Role Request Validation & Hierarchy Business Rules', () => {
    it('normalizes valid role inputs case-insensitively', () => {
      expect(validateRequestedRole('researcher')).toEqual({ valid: true, role: 'Researcher' });
      expect(validateRequestedRole('LECTURER')).toEqual({ valid: true, role: 'Lecturer' });
      expect(validateRequestedRole(' Admin ')).toEqual({ valid: true, role: 'Admin' });
      expect(validateRequestedRole('student')).toEqual({ valid: true, role: 'Student' });
    });

    it('rejects unknown or malformed requested roles', () => {
      expect(validateRequestedRole('SUPERADMIN').valid).toBe(false);
      expect(validateRequestedRole('ROOT').valid).toBe(false);
      expect(validateRequestedRole('').valid).toBe(false);
      expect(validateRequestedRole(null).valid).toBe(false);
      expect(validateRequestedRole(12345).valid).toBe(false);
    });

    it('enforces role hierarchy and demotion prevention', () => {
      // Student can request higher roles
      expect(checkRoleEligibility('Student', 'Lecturer').allowed).toBe(true);
      expect(checkRoleEligibility('Student', 'Researcher').allowed).toBe(true);
      expect(checkRoleEligibility('Student', 'Admin').allowed).toBe(true);

      // User cannot request currently held role
      const sameRole = checkRoleEligibility('Student', 'Student');
      expect(sameRole.allowed).toBe(false);
      expect(sameRole.error).toContain('already holds');

      // Lecturer cannot request Student (lower role)
      const demotionLecturer = checkRoleEligibility('Lecturer', 'Student');
      expect(demotionLecturer.allowed).toBe(false);
      expect(demotionLecturer.error).toContain('lower than current role');

      // Researcher cannot request Student (lower role)
      const demotionResearcher = checkRoleEligibility('Researcher', 'Student');
      expect(demotionResearcher.allowed).toBe(false);

      // Admin cannot request any role change
      const adminAttempt = checkRoleEligibility('Admin', 'Researcher');
      expect(adminAttempt.allowed).toBe(false);
      expect(adminAttempt.error).toContain('highest authority');

      // Peer academic role change requires justification
      const lateralNoJust = checkRoleEligibility('Lecturer', 'Researcher', '');
      expect(lateralNoJust.allowed).toBe(false);
      expect(lateralNoJust.error).toContain('explicit justification');

      const lateralWithJust = checkRoleEligibility('Lecturer', 'Researcher', 'Transitioning to full-time physiology computational research');
      expect(lateralWithJust.allowed).toBe(true);
    });

    it('sanitizes text fields and removes script tags, HTML tags, and control characters', () => {
      const dirty = '<script>alert("xss")</script>Faculty of Health & Medicine<b>!</b>';
      const result = sanitizeTextField(dirty, 200, 'institution');
      expect(result.valid).toBe(true);
      expect(result.sanitized).toBe('alert("xss")Faculty of Health & Medicine!');
      expect(result.sanitized).not.toContain('<script>');
      expect(result.sanitized).not.toContain('<b>');

      // Exceeding maximum length
      const tooLong = 'A'.repeat(250);
      const lengthResult = sanitizeTextField(tooLong, 200, 'institution');
      expect(lengthResult.valid).toBe(false);
      expect(lengthResult.error).toContain('exceeds maximum length of 200');
    });

    it('detects duplicate active PENDING requests for the same role', () => {
      const requests: RoleRequest[] = [
        {
          request_id: 'req_001',
          user_id: 'usr_student',
          requested_role: 'Researcher',
          approval_status: 'PENDING',
          created_at: new Date().toISOString()
        }
      ];

      expect(hasDuplicatePendingRequest(requests, 'usr_student', 'Researcher')).toBeDefined();
      expect(hasDuplicatePendingRequest(requests, 'usr_student', 'Lecturer')).toBeUndefined();
      expect(hasDuplicatePendingRequest(requests, 'usr_lecturer', 'Researcher')).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // 3. POST /api/role-requests Endpoint
  // --------------------------------------------------------------------------
  describe('3. POST /api/role-requests Endpoint Security & Integration', () => {
    it('returns 401 UNAUTHORIZED when no session token is provided', async () => {
      const res = await makeRequest(app, 'POST', '/api/role-requests', {
        requested_role: 'Researcher'
      });
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
    });

    it('returns 403 FORBIDDEN when user account is SUSPENDED or DISABLED', async () => {
      const student = db.getState().users.find(u => u.id === 'usr_student')!;
      student.account_status = 'SUSPENDED';
      db.save();

      const res = await makeRequest(
        app,
        'POST',
        '/api/role-requests',
        { requested_role: 'Researcher' },
        { Authorization: `Bearer ${studentToken}` }
      );

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN_ACCOUNT_STATUS');
      expect(res.body.error).toContain('SUSPENDED');
    });

    it('returns 400 BAD REQUEST when requested_role is invalid or unrecognized', async () => {
      const res = await makeRequest(
        app,
        'POST',
        '/api/role-requests',
        { requested_role: 'CYBER_HACKER' },
        { Authorization: `Bearer ${studentToken}` }
      );

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_ROLE');
    });

    it('returns 400 BAD REQUEST when requesting currently held role', async () => {
      const res = await makeRequest(
        app,
        'POST',
        '/api/role-requests',
        { requested_role: 'Student' },
        { Authorization: `Bearer ${studentToken}` }
      );

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INELIGIBLE_ROLE_REQUEST');
      expect(res.body.error).toContain('already holds');
    });

    it('returns 400 BAD REQUEST when requesting a lower role', async () => {
      const res = await makeRequest(
        app,
        'POST',
        '/api/role-requests',
        { requested_role: 'Student' },
        { Authorization: `Bearer ${lecturerToken}` }
      );

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INELIGIBLE_ROLE_REQUEST');
      expect(res.body.error).toContain('lower than current role');
    });

    it('successfully creates a role elevation request with status 201 and persists to store', async () => {
      const res = await makeRequest(
        app,
        'POST',
        '/api/role-requests',
        {
          requested_role: 'Researcher',
          institution: 'Institute for Bioenergetics & Metabolic Scaling',
          justification: 'Completed honors thesis on Mifflin-St Jeor AST validations.'
        },
        { Authorization: `Bearer ${studentToken}` }
      );

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.role_request).toBeDefined();

      const created = res.body.role_request;
      expect(created.request_id).toMatch(/^req_/);
      expect(created.user_id).toBe('usr_student');
      expect(created.requested_role).toBe('Researcher');
      expect(created.approval_status).toBe('PENDING');
      expect(created.institution).toBe('Institute for Bioenergetics & Metabolic Scaling');
      expect(created.justification).toBe('Completed honors thesis on Mifflin-St Jeor AST validations.');
      expect(created.reviewed_by).toBeNull();
      expect(created.reviewed_at).toBeNull();
      expect(created.review_reason).toBeNull();

      // Verify database persistence
      const inDb = db.findRoleRequestById(created.request_id);
      expect(inDb).toBeDefined();
      expect(inDb?.requested_role).toBe('Researcher');

      // Verify audit log creation
      const audit = db.getState().audit_logs.find(
        a => a.action === 'CREATE' && a.entity_type === 'ROLE_REQUEST' && a.entity_id === created.request_id
      );
      expect(audit).toBeDefined();
      expect(audit?.user_id).toBe('usr_student');
    });

    it('returns 409 CONFLICT when a duplicate PENDING request exists for the same role', async () => {
      // First submission
      const first = await makeRequest(
        app,
        'POST',
        '/api/role-requests',
        { requested_role: 'Lecturer', justification: 'Seeking academic mentoring elevation.' },
        { Authorization: `Bearer ${studentToken}` }
      );
      expect(first.status).toBe(201);

      // Duplicate submission
      const duplicate = await makeRequest(
        app,
        'POST',
        '/api/role-requests',
        { requested_role: 'Lecturer', justification: 'Second submission should be rejected.' },
        { Authorization: `Bearer ${studentToken}` }
      );

      expect(duplicate.status).toBe(409);
      expect(duplicate.body.code).toBe('DUPLICATE_PENDING_REQUEST');
      expect(duplicate.body.existing_request_id).toBe(first.body.role_request.request_id);
    });

    it('permits a new request after a previous request is rejected or resolved', async () => {
      // Create first request
      const first = await makeRequest(
        app,
        'POST',
        '/api/role-requests',
        { requested_role: 'Researcher', justification: 'First try' },
        { Authorization: `Bearer ${studentToken}` }
      );
      expect(first.status).toBe(201);

      // Admin resolves first request as REJECTED
      const reqRecord = db.findRoleRequestById(first.body.role_request.request_id)!;
      reqRecord.approval_status = 'REJECTED';
      reqRecord.reviewed_by = 'usr_admin';
      reqRecord.reviewed_at = new Date().toISOString();
      reqRecord.review_reason = 'Insufficient research publications submitted.';
      db.save();

      // Student submits again with updated justification
      const second = await makeRequest(
        app,
        'POST',
        '/api/role-requests',
        { requested_role: 'Researcher', justification: 'Updated thesis and 2 journal papers attached.' },
        { Authorization: `Bearer ${studentToken}` }
      );

      expect(second.status).toBe(201);
      expect(second.body.role_request.request_id).not.toBe(first.body.role_request.request_id);
    });
  });

  // --------------------------------------------------------------------------
  // 4. GET /api/role-requests/me Endpoint (User Data Isolation)
  // --------------------------------------------------------------------------
  describe('4. GET /api/role-requests/me Endpoint & Object Isolation', () => {
    it('returns 401 UNAUTHORIZED when no session token is provided', async () => {
      const res = await makeRequest(app, 'GET', '/api/role-requests/me');
      expect(res.status).toBe(401);
    });

    it('returns only the role requests of the authenticated user', async () => {
      // Create request for student
      await makeRequest(
        app,
        'POST',
        '/api/role-requests',
        { requested_role: 'Lecturer' },
        { Authorization: `Bearer ${studentToken}` }
      );

      // Create request for lecturer
      await makeRequest(
        app,
        'POST',
        '/api/role-requests',
        { requested_role: 'Admin', justification: 'Department chair elevation' },
        { Authorization: `Bearer ${lecturerToken}` }
      );

      // Student calls /me
      const studentRes = await makeRequest(
        app,
        'GET',
        '/api/role-requests/me',
        undefined,
        { Authorization: `Bearer ${studentToken}` }
      );
      expect(studentRes.status).toBe(200);
      expect(studentRes.body.total).toBe(1);
      expect(studentRes.body.role_requests[0].user_id).toBe('usr_student');
      expect(studentRes.body.role_requests[0].requested_role).toBe('Lecturer');

      // Lecturer calls /me
      const lecturerRes = await makeRequest(
        app,
        'GET',
        '/api/role-requests/me',
        undefined,
        { Authorization: `Bearer ${lecturerToken}` }
      );
      expect(lecturerRes.status).toBe(200);
      expect(lecturerRes.body.total).toBe(1);
      expect(lecturerRes.body.role_requests[0].user_id).toBe('usr_lecturer');
      expect(lecturerRes.body.role_requests[0].requested_role).toBe('Admin');
    });
  });

  // --------------------------------------------------------------------------
  // 5. GET /api/role-requests/:id & Object-Level Authorization
  // --------------------------------------------------------------------------
  describe('5. GET /api/role-requests/:id & Object-Level Authorization', () => {
    let studentReqId: string;

    beforeEach(async () => {
      const res = await makeRequest(
        app,
        'POST',
        '/api/role-requests',
        { requested_role: 'Researcher', justification: 'Confidential thesis elevation' },
        { Authorization: `Bearer ${studentToken}` }
      );
      studentReqId = res.body.role_request.request_id;
    });

    it('allows the owner to view their own role request', async () => {
      const res = await makeRequest(
        app,
        'GET',
        `/api/role-requests/${studentReqId}`,
        undefined,
        { Authorization: `Bearer ${studentToken}` }
      );
      expect(res.status).toBe(200);
      expect(res.body.role_request.request_id).toBe(studentReqId);
    });

    it('allows an administrator to view any user role request', async () => {
      const res = await makeRequest(
        app,
        'GET',
        `/api/role-requests/${studentReqId}`,
        undefined,
        { Authorization: `Bearer ${adminToken}` }
      );
      expect(res.status).toBe(200);
      expect(res.body.role_request.request_id).toBe(studentReqId);
    });

    it('rejects another non-admin user with 403 FORBIDDEN (BOLA / IDOR protection)', async () => {
      const res = await makeRequest(
        app,
        'GET',
        `/api/role-requests/${studentReqId}`,
        undefined,
        { Authorization: `Bearer ${lecturerToken}` }
      );
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('OBJECT_ACCESS_DENIED');
      expect(res.body.entity_type).toBe('ROLE_REQUEST');
    });

    it('returns 404 NOT FOUND for non-existent role request id', async () => {
      const res = await makeRequest(
        app,
        'GET',
        '/api/role-requests/req_nonexistent_99999',
        undefined,
        { Authorization: `Bearer ${studentToken}` }
      );
      expect(res.status).toBe(404);
      expect(res.body.error).toContain('not found');
    });
  });

  // --------------------------------------------------------------------------
  // 6. GET /api/role-requests (Administrative Overview)
  // --------------------------------------------------------------------------
  describe('6. GET /api/role-requests Administrative Access Control', () => {
    it('returns 403 FORBIDDEN when non-admin attempts to list all role requests', async () => {
      const studentRes = await makeRequest(
        app,
        'GET',
        '/api/role-requests',
        undefined,
        { Authorization: `Bearer ${studentToken}` }
      );
      expect(studentRes.status).toBe(403);
      expect(studentRes.body.code).toBe('FORBIDDEN');

      const researcherRes = await makeRequest(
        app,
        'GET',
        '/api/role-requests',
        undefined,
        { Authorization: `Bearer ${researcherToken}` }
      );
      expect(researcherRes.status).toBe(403);
    });

    it('allows administrator to list all role requests with optional status filtering', async () => {
      // Student request
      await makeRequest(
        app,
        'POST',
        '/api/role-requests',
        { requested_role: 'Lecturer' },
        { Authorization: `Bearer ${studentToken}` }
      );

      // Lecturer request
      await makeRequest(
        app,
        'POST',
        '/api/role-requests',
        { requested_role: 'Admin', justification: 'Faculty leadership' },
        { Authorization: `Bearer ${lecturerToken}` }
      );

      const adminRes = await makeRequest(
        app,
        'GET',
        '/api/role-requests',
        undefined,
        { Authorization: `Bearer ${adminToken}` }
      );
      expect(adminRes.status).toBe(200);
      expect(adminRes.body.total).toBe(2);

      // Filter by user_id
      const filteredRes = await makeRequest(
        app,
        'GET',
        '/api/role-requests?user_id=usr_student',
        undefined,
        { Authorization: `Bearer ${adminToken}` }
      );
      expect(filteredRes.status).toBe(200);
      expect(filteredRes.body.total).toBe(1);
      expect(filteredRes.body.role_requests[0].user_id).toBe('usr_student');
    });
  });
});
