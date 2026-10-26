/**
 * NutriBodySim — Session Invalidation & Authentication Consistency Adversarial Test Suite (MVS-B2.5B.4)
 *
 * Verifies:
 * 1. Stale token rejection after role approval (401 STALE_TOKEN_VERSION).
 * 2. Immediate rejection when user account status changes to SUSPENDED or DISABLED.
 * 3. Multiple sessions per user: all legacy sessions invalidated on access/status changes.
 * 4. Inter-user session isolation: invalidating User A never affects User B.
 * 5. Strict token_version increment on all permission/governance/status mutations.
 * 6. Immunity to client token_version spoofing (headers, body, query tampering).
 * 7. Explicitly revoked token replay defense (401 UNAUTHORIZED).
 * 8. Server restart / in-memory session loss fail-closed safety (401 UNAUTHORIZED).
 * 9. Resilience to partial failure / atomic rollback: no phantom token_version increment.
 * 10. Evaluation order: status and token_version evaluated strictly before permissions.
 * 11. POST /api/auth/logout-all global session invalidation.
 * 12. POST /api/admin/users/:id/status administrative endpoint and governance protection.
 * 13. POST /api/admin/users/:id/revoke-sessions administrative emergency revocation.
 * 14. Demo login and switch-user blocking for inactive accounts (403 FORBIDDEN_ACCOUNT_STATUS).
 * 15. Dual-layer defense: database token_version protects even if memory revocation is bypassed.
 * 16. Corrupted/missing session tokenVersion fail-closed rejection.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import http from 'http';
import { apiRouter } from '../routes/api';
import { db } from '../database/store';
import { defaultSessionStore } from '../auth/sessionStore';
import { defaultRoleApprovalEngine } from '../auth/roleApprovalEngine';
import { User } from '../database/types';

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

describe('NutriBodySim MVS-B2.5B.4 — Session Invalidation & Authentication Consistency', () => {
  let app: express.Express;
  let adminToken: string;
  let studentToken: string;
  let researcherToken: string;
  let lecturerToken: string;

  beforeEach(() => {
    db.reseed();
    defaultSessionStore.clear();
    app = createTestApp();

    // Ensure users have clean token_version = 1 and account_status = 'ACTIVE'
    const state = db.getState();
    for (const u of state.users) {
      u.account_status = 'ACTIVE';
      u.token_version = 1;
    }
    db.save();

    // Issue initial sessions with tokenVersion 1
    adminToken = defaultSessionStore.createSession('usr_admin', 3600, 1).token;
    studentToken = defaultSessionStore.createSession('usr_student', 3600, 1).token;
    researcherToken = defaultSessionStore.createSession('usr_researcher', 3600, 1).token;
    lecturerToken = defaultSessionStore.createSession('usr_lecturer', 3600, 1).token;
  });

  // ----------------------------------------------------
  // TEST 1: Stale Token Rejection After Role Elevation
  // ----------------------------------------------------
  it('1. rejects stale session token with 401 STALE_TOKEN_VERSION after role approval', async () => {
    // Student submits role request for Lecturer
    const { roleRequest: roleReq } = db.createRoleRequest({
      userId: 'usr_student',
      requestedRole: 'Lecturer',
      institution: 'Faculty of Health Sciences',
      justification: 'Teaching nutrition computational biology course for graduate students.'
    });

    // Verify student token works prior to approval
    const preRes = await makeRequest(app, 'GET', '/api/auth/me', undefined, {
      Authorization: `Bearer ${studentToken}`
    });
    expect(preRes.status).toBe(200);
    expect(preRes.body.user.role).toBe('Student');

    // Admin approves the request
    const approveRes = await makeRequest(
      app,
      'POST',
      `/api/role-requests/${roleReq.request_id}/approve`,
      { review_reason: 'Verified faculty appointment credentials.' },
      { Authorization: `Bearer ${adminToken}` }
    );
    expect(approveRes.status).toBe(200);

    // Old student session token MUST be rejected with 401 (revoked or STALE_TOKEN_VERSION)
    const postRes = await makeRequest(app, 'GET', '/api/auth/me', undefined, {
      Authorization: `Bearer ${studentToken}`
    });
    expect(postRes.status).toBe(401);
    expect(['UNAUTHORIZED', 'STALE_TOKEN_VERSION']).toContain(postRes.body.code);

    // New session issued with new token_version works and reflects elevated role
    const updatedStudent = db.getState().users.find(u => u.id === 'usr_student')!;
    expect(updatedStudent.role).toBe('Lecturer');
    expect(updatedStudent.token_version).toBe(2);

    const newStudentToken = defaultSessionStore.createSession('usr_student', 3600, updatedStudent.token_version).token;
    const newMeRes = await makeRequest(app, 'GET', '/api/auth/me', undefined, {
      Authorization: `Bearer ${newStudentToken}`
    });
    expect(newMeRes.status).toBe(200);
    expect(newMeRes.body.user.role).toBe('Lecturer');
  });

  // ----------------------------------------------------
  // TEST 2: Immediate Rejection on Account Status Suspension / Disabling
  // ----------------------------------------------------
  it('2. immediately rejects requests when user status becomes SUSPENDED or DISABLED without relying on session revocation', async () => {
    // 2A. Suspend student in database
    const student = db.getState().users.find(u => u.id === 'usr_student')!;
    student.account_status = 'SUSPENDED';
    db.save();

    // Student token (still marked unrevoked in memory) MUST be rejected with 403
    const suspRes = await makeRequest(app, 'GET', '/api/auth/me', undefined, {
      Authorization: `Bearer ${studentToken}`
    });
    expect(suspRes.status).toBe(403);
    expect(suspRes.body.code).toBe('FORBIDDEN_ACCOUNT_STATUS');
    expect(suspRes.body.account_status).toBe('SUSPENDED');

    // 2B. Disable student in database
    student.account_status = 'DISABLED';
    db.save();

    const disRes = await makeRequest(app, 'GET', '/api/auth/me', undefined, {
      Authorization: `Bearer ${studentToken}`
    });
    expect(disRes.status).toBe(403);
    expect(disRes.body.code).toBe('FORBIDDEN_ACCOUNT_STATUS');
    expect(disRes.body.account_status).toBe('DISABLED');
  });

  // ----------------------------------------------------
  // TEST 3: Multi-Session Invalidation Per User
  // ----------------------------------------------------
  it('3. invalidates all concurrent sessions of a user when credentials or status mutate', async () => {
    // Issue 3 concurrent sessions for student (e.g., Desktop, Mobile, Tablet)
    const tokenDesktop = defaultSessionStore.createSession('usr_student', 3600, 1).token;
    const tokenMobile = defaultSessionStore.createSession('usr_student', 3600, 1).token;
    const tokenTablet = defaultSessionStore.createSession('usr_student', 3600, 1).token;

    // Verify all 3 work initially
    for (const t of [tokenDesktop, tokenMobile, tokenTablet]) {
      const res = await makeRequest(app, 'GET', '/api/auth/me', undefined, {
        Authorization: `Bearer ${t}`
      });
      expect(res.status).toBe(200);
    }

    // Admin suspends student via emergency status change
    const updateResult = db.updateUserAccountStatus({
      userId: 'usr_student',
      newStatus: 'SUSPENDED',
      actorId: 'usr_admin',
      reason: 'Investigating anomalous computational payload requests'
    });
    expect(updateResult.revokedSessionsCount).toBeGreaterThanOrEqual(3);

    // ALL 3 sessions must now be rejected
    for (const t of [tokenDesktop, tokenMobile, tokenTablet]) {
      const res = await makeRequest(app, 'GET', '/api/auth/me', undefined, {
        Authorization: `Bearer ${t}`
      });
      // Rejected either as revoked (401 UNAUTHORIZED) or inactive status (403 FORBIDDEN_ACCOUNT_STATUS)
      expect([401, 403]).toContain(res.status);
    }
  });

  // ----------------------------------------------------
  // TEST 4: User Session Isolation
  // ----------------------------------------------------
  it('4. guarantees session isolation: invalidating User A sessions never affects User B', async () => {
    // Both Student and Researcher have active sessions
    const resA1 = await makeRequest(app, 'GET', '/api/auth/me', undefined, {
      Authorization: `Bearer ${studentToken}`
    });
    expect(resA1.status).toBe(200);

    const resB1 = await makeRequest(app, 'GET', '/api/auth/me', undefined, {
      Authorization: `Bearer ${researcherToken}`
    });
    expect(resB1.status).toBe(200);

    // Emergency revoke all sessions for User A (Student)
    db.emergencyRevokeUserSessions({
      userId: 'usr_student',
      actorId: 'usr_admin',
      reason: 'Routine session maintenance for student account'
    });

    // User A's session is now rejected
    const resA2 = await makeRequest(app, 'GET', '/api/auth/me', undefined, {
      Authorization: `Bearer ${studentToken}`
    });
    expect([401, 403]).toContain(resA2.status);

    // User B's session remains completely valid and unimpacted
    const resB2 = await makeRequest(app, 'GET', '/api/auth/me', undefined, {
      Authorization: `Bearer ${researcherToken}`
    });
    expect(resB2.status).toBe(200);
    expect(resB2.body.user.id).toBe('usr_researcher');
  });

  // ----------------------------------------------------
  // TEST 5: Token Version Increment on All Privilege & Status Mutations
  // ----------------------------------------------------
  it('5. strictly increments token_version on role approval, bootstrap, status change, and emergency revocation', async () => {
    const student = db.getState().users.find(u => u.id === 'usr_student')!;
    expect(student.token_version).toBe(1);

    // 5A: Status change
    db.updateUserAccountStatus({
      userId: 'usr_student',
      newStatus: 'SUSPENDED',
      actorId: 'usr_admin',
      reason: 'Temporary suspension for audit'
    });
    expect(student.token_version).toBe(2);

    // 5B: Status re-activation
    db.updateUserAccountStatus({
      userId: 'usr_student',
      newStatus: 'ACTIVE',
      actorId: 'usr_admin',
      reason: 'Audit complete, restoring active status'
    });
    expect(student.token_version).toBe(3);

    // 5C: Emergency session revocation
    db.emergencyRevokeUserSessions({
      userId: 'usr_student',
      actorId: 'usr_admin',
      reason: 'Security reset'
    });
    expect(student.token_version).toBe(4);

    // 5D: Role approval
    const { roleRequest: roleReq } = db.createRoleRequest({
      userId: 'usr_student',
      requestedRole: 'Researcher',
      institution: 'Computational Physiology Lab',
      justification: 'Completed doctoral degree defense successfully.'
    });
    db.approveRoleRequest({
      requestId: roleReq.request_id,
      reviewerId: 'usr_admin',
      reviewReason: 'Verified doctoral diploma.'
    });
    expect(student.token_version).toBe(5);

    // 5E: Main Admin bootstrap
    db.bootstrapMainAdmin({
      targetUserId: 'usr_student',
      operator: 'ops_system_engineer',
      reason: 'Designated secondary institutional administrator',
      forceRecovery: true
    });
    expect(student.token_version).toBe(6);
    expect(student.is_main_admin).toBe(true);
  });

  // ----------------------------------------------------
  // TEST 6: Immunity to Client Token Version Spoofing
  // ----------------------------------------------------
  it('6. ignores and rejects client-supplied token_version in headers, query, or body', async () => {
    // Advance token_version in database to 2 without revoking memory session
    const student = db.getState().users.find(u => u.id === 'usr_student')!;
    student.token_version = 2;
    db.save();
    expect(student.token_version).toBe(2);

    // Attacker sends old token with client-supplied version headers/params
    const resHeaders = await makeRequest(
      app,
      'GET',
      '/api/auth/me?token_version=2',
      { token_version: 2, user: { token_version: 2 } },
      {
        Authorization: `Bearer ${studentToken}`,
        'x-token-version': '2',
        'x-session-version': '2'
      }
    );

    // MUST be rejected with STALE_TOKEN_VERSION: client cannot spoof server-held session record
    expect(resHeaders.status).toBe(401);
    expect(resHeaders.body.code).toBe('STALE_TOKEN_VERSION');
  });

  // ----------------------------------------------------
  // TEST 7: Replay of Explicitly Revoked Token
  // ----------------------------------------------------
  it('7. rejects replay of logged-out token with 401 UNAUTHORIZED', async () => {
    // Student logs out
    const logoutRes = await makeRequest(app, 'POST', '/api/auth/logout', undefined, {
      Authorization: `Bearer ${studentToken}`
    });
    expect(logoutRes.status).toBe(200);

    // Replaying the revoked token MUST fail with 401
    const replayRes = await makeRequest(app, 'GET', '/api/auth/me', undefined, {
      Authorization: `Bearer ${studentToken}`
    });
    expect(replayRes.status).toBe(401);
    expect(replayRes.body.code).toBe('UNAUTHORIZED');
  });

  // ----------------------------------------------------
  // TEST 8: Server Restart / In-Memory Session Loss (Fail-Closed)
  // ----------------------------------------------------
  it('8. safely fails closed with 401 UNAUTHORIZED if session store is wiped (server restart)', async () => {
    // Verify token works
    const preRes = await makeRequest(app, 'GET', '/api/auth/me', undefined, {
      Authorization: `Bearer ${researcherToken}`
    });
    expect(preRes.status).toBe(200);

    // Simulate complete process memory wipe / cache reboot
    defaultSessionStore.clear();

    // Token should now be completely unrecognized and rejected
    const postRes = await makeRequest(app, 'GET', '/api/auth/me', undefined, {
      Authorization: `Bearer ${researcherToken}`
    });
    expect(postRes.status).toBe(401);
    expect(postRes.body.code).toBe('UNAUTHORIZED');
    expect(postRes.body.error).toMatch(/Session not found|Authentication failed/);
  });

  // ----------------------------------------------------
  // TEST 9: Resilience to Partial Failure / Atomic Rollback
  // ----------------------------------------------------
  it('9. does not increment token_version or corrupt sessions if database transaction rolls back', async () => {
    const student = db.getState().users.find(u => u.id === 'usr_student')!;
    const initialVersion = student.token_version || 1;

    // Spy on saveToDisk to simulate disk failure during status update
    const saveSpy = vi.spyOn(db as any, 'saveToDisk').mockImplementationOnce(() => {
      throw new Error('EIO: Disk I/O simulated failure');
    });

    expect(() => {
      db.updateUserAccountStatus({
        userId: 'usr_student',
        newStatus: 'SUSPENDED',
        actorId: 'usr_admin',
        reason: 'Attempted status change during disk failure'
      });
    }).toThrow(/Failed to persist account status change atomically/);

    // State MUST be cleanly rolled back:
    expect(student.account_status).toBe('ACTIVE');
    expect(student.token_version).toBe(initialVersion);

    // Student session remains valid and consistent
    const checkRes = await makeRequest(app, 'GET', '/api/auth/me', undefined, {
      Authorization: `Bearer ${studentToken}`
    });
    expect(checkRes.status).toBe(200);
    saveSpy.mockRestore();
  });

  // ----------------------------------------------------
  // TEST 10: Pre-Authorization Evaluation Order
  // ----------------------------------------------------
  it('10. evaluates account_status and token_version BEFORE permission checks on protected endpoints', async () => {
    // Admin has full operational permissions.
    // 10A. Suspend Admin
    const admin = db.getState().users.find(u => u.id === 'usr_admin')!;
    admin.account_status = 'SUSPENDED';
    db.save();

    // Calling an administrative or project creation endpoint
    const resPriv = await makeRequest(
      app,
      'POST',
      '/api/projects',
      { name: 'Malicious Project While Suspended' },
      { Authorization: `Bearer ${adminToken}` }
    );
    // MUST be blocked at status verification with 403 FORBIDDEN_ACCOUNT_STATUS, not permission logic
    expect(resPriv.status).toBe(403);
    expect(resPriv.body.code).toBe('FORBIDDEN_ACCOUNT_STATUS');

    // 10B. Re-activate Admin, but invalidate token version
    admin.account_status = 'ACTIVE';
    admin.token_version = 99; // Bump token version in DB
    db.save();

    const resStale = await makeRequest(
      app,
      'POST',
      '/api/projects',
      { name: 'Project With Stale Token' },
      { Authorization: `Bearer ${adminToken}` }
    );
    // MUST be blocked at token_version check with 401 STALE_TOKEN_VERSION
    expect(resStale.status).toBe(401);
    expect(resStale.body.code).toBe('STALE_TOKEN_VERSION');
  });

  // ----------------------------------------------------
  // TEST 11: Global Logout (POST /api/auth/logout-all)
  // ----------------------------------------------------
  it('11. revokes all sessions across devices via POST /api/auth/logout-all', async () => {
    const t1 = defaultSessionStore.createSession('usr_lecturer', 3600, 1).token;
    const t2 = defaultSessionStore.createSession('usr_lecturer', 3600, 1).token;

    const resLogoutAll = await makeRequest(app, 'POST', '/api/auth/logout-all', undefined, {
      Authorization: `Bearer ${t1}`
    });
    expect(resLogoutAll.status).toBe(200);
    expect(resLogoutAll.body.success).toBe(true);
    expect(resLogoutAll.body.new_token_version).toBe(2);

    // Both previous tokens must now fail
    const resT1 = await makeRequest(app, 'GET', '/api/auth/me', undefined, {
      Authorization: `Bearer ${t1}`
    });
    expect([401, 403]).toContain(resT1.status);

    const resT2 = await makeRequest(app, 'GET', '/api/auth/me', undefined, {
      Authorization: `Bearer ${t2}`
    });
    expect([401, 403]).toContain(resT2.status);
  });

  // ----------------------------------------------------
  // TEST 12: Administrative Endpoint POST /api/admin/users/:id/status
  // ----------------------------------------------------
  it('12. allows Admin to suspend user via API and enforces Main Administrator protection', async () => {
    // 12A: Admin suspends student
    const suspendRes = await makeRequest(
      app,
      'POST',
      '/api/admin/users/usr_student/status',
      { status: 'SUSPENDED', reason: 'Violation of data sharing policy' },
      { Authorization: `Bearer ${adminToken}` }
    );
    expect(suspendRes.status).toBe(200);
    expect(suspendRes.body.user.account_status).toBe('SUSPENDED');

    // Student session is revoked and rejected
    const checkRes = await makeRequest(app, 'GET', '/api/auth/me', undefined, {
      Authorization: `Bearer ${studentToken}`
    });
    expect([401, 403]).toContain(checkRes.status);

    // Any new session issued for the suspended user is strictly rejected with 403 FORBIDDEN_ACCOUNT_STATUS
    const newSuspendedToken = defaultSessionStore.createSession('usr_student', 3600, 2).token;
    const checkNewRes = await makeRequest(app, 'GET', '/api/auth/me', undefined, {
      Authorization: `Bearer ${newSuspendedToken}`
    });
    expect(checkNewRes.status).toBe(403);
    expect(checkNewRes.body.code).toBe('FORBIDDEN_ACCOUNT_STATUS');

    // 12B: Regular Admin CANNOT suspend active Main Administrator
    // Bootstrap researcher as Main Admin first
    db.bootstrapMainAdmin({
      targetUserId: 'usr_researcher',
      operator: 'ops_system_engineer',
      reason: 'Bootstrap for institutional authority test',
      forceRecovery: true
    });

    const targetMainAdmin = db.getState().users.find(u => u.id === 'usr_researcher')!;
    expect(targetMainAdmin.is_main_admin).toBe(true);

    const attackRes = await makeRequest(
      app,
      'POST',
      '/api/admin/users/usr_researcher/status',
      { status: 'SUSPENDED', reason: 'Attempt by regular admin to suspend main administrator' },
      { Authorization: `Bearer ${adminToken}` }
    );
    expect(attackRes.status).toBe(403);
    expect(attackRes.body.code).toBe('INSUFFICIENT_PRIVILEGE');

    // 12C: Non-admin caller blocked
    const nonAdminAttackRes = await makeRequest(
      app,
      'POST',
      '/api/admin/users/usr_admin/status',
      { status: 'SUSPENDED', reason: 'Attempt by non-admin to suspend admin' },
      { Authorization: `Bearer ${lecturerToken}` }
    );
    expect(nonAdminAttackRes.status).toBe(403);
    expect(nonAdminAttackRes.body.code).toBe('FORBIDDEN');
  });

  // ----------------------------------------------------
  // TEST 13: Emergency Revocation Endpoint POST /api/admin/users/:id/revoke-sessions
  // ----------------------------------------------------
  it('13. executes emergency session revocation via POST /api/admin/users/:id/revoke-sessions', async () => {
    const res = await makeRequest(
      app,
      'POST',
      '/api/admin/users/usr_researcher/revoke-sessions',
      { reason: 'Suspected token leakage on public repository' },
      { Authorization: `Bearer ${adminToken}` }
    );
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.user_id).toBe('usr_researcher');
    expect(res.body.new_token_version).toBe(2);

    // Researcher's previous session token is rejected
    const checkRes = await makeRequest(app, 'GET', '/api/auth/me', undefined, {
      Authorization: `Bearer ${researcherToken}`
    });
    expect([401, 403]).toContain(checkRes.status);
  });

  // ----------------------------------------------------
  // TEST 14: Demo Login & Switch User Inactive Account Blocking
  // ----------------------------------------------------
  it('14. rejects demo login and user switching for SUSPENDED or DISABLED accounts with 403', async () => {
    const student = db.getState().users.find(u => u.id === 'usr_student')!;
    student.account_status = 'SUSPENDED';
    db.save();

    // Demo login attempt
    const loginRes = await makeRequest(app, 'POST', '/api/auth/demo-login', {
      user_id: 'usr_student'
    });
    expect(loginRes.status).toBe(403);
    expect(loginRes.body.code).toBe('FORBIDDEN_ACCOUNT_STATUS');

    // Switch user attempt
    const switchRes = await makeRequest(app, 'POST', '/api/auth/switch-user', {
      user_id: 'usr_student'
    });
    expect(switchRes.status).toBe(403);
    expect(switchRes.body.code).toBe('FORBIDDEN_ACCOUNT_STATUS');
  });

  // ----------------------------------------------------
  // TEST 15: Dual-Layer Defense: Database token_version Protects Even If Memory Revocation Fails
  // ----------------------------------------------------
  it('15. rejects stale token via token_version mismatch even if memory session revocation was bypassed or dropped', async () => {
    // Manually increment token_version in database WITHOUT calling sessionStore.revokeSessionsForUser
    const researcher = db.getState().users.find(u => u.id === 'usr_researcher')!;
    researcher.token_version = 2;
    db.save();

    // Verify session store still has researcher's token with revoked = false
    const validation = defaultSessionStore.validateSession(researcherToken);
    expect(validation.valid).toBe(true);
    expect(validation.tokenVersion).toBe(1); // Old version stored

    // Request MUST be rejected because authMiddleware validates tokenVersion against database user.token_version
    const reqRes = await makeRequest(app, 'GET', '/api/auth/me', undefined, {
      Authorization: `Bearer ${researcherToken}`
    });
    expect(reqRes.status).toBe(401);
    expect(reqRes.body.code).toBe('STALE_TOKEN_VERSION');
  });

  // ----------------------------------------------------
  // TEST 16: Corrupted or Missing Session tokenVersion Handling
  // ----------------------------------------------------
  it('16. fails closed and rejects session if session tokenVersion is missing, malformed, or NaN', async () => {
    // Manually inject a session with missing tokenVersion
    const badToken = 'a'.repeat(64);
    (defaultSessionStore as any).sessions.set(
      defaultSessionStore.hashToken(badToken),
      {
        tokenHash: defaultSessionStore.hashToken(badToken),
        userId: 'usr_student',
        createdAt: Date.now(),
        expiresAt: Date.now() + 3600000,
        revoked: false,
        tokenVersion: undefined // Corrupted/missing version
      }
    );

    const res = await makeRequest(app, 'GET', '/api/auth/me', undefined, {
      Authorization: `Bearer ${badToken}`
    });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('STALE_TOKEN_VERSION');
  });
});
