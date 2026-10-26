/**
 * NutriBodySim — MVS-B2.3 Role-Based Access Control (RBAC) & Permission Enforcement Test Suite
 *
 * Verifies all mandatory security requirements:
 * 1. Role hierarchy and effective permission resolution (Student, Lecturer, Researcher, Admin).
 * 2. Administrative endpoint protection (/api/audit restricted strictly to Admin).
 * 3. Prevention of privilege escalation (Student cannot escalate to Lecturer/Researcher/Admin).
 * 4. Scientific registry write protection (PUBLISH required for variables, parameters, formulas, references).
 * 5. Model cloning permitted for Student via CLONE permission.
 * 6. Dataset transformation restricted via EDIT permission.
 * 7. Material publishing restricted via PUBLISH permission.
 * 8. Notebook cell edit restricted via EDIT permission.
 * 9. Notebook cell deletion restricted strictly via DELETE permission (Admin only).
 * 10. Physiological calculation and safe structured math execution permitted via USE permission.
 * 11. Complete immunity to client-supplied role, permission, or x-user-id headers in request body/query.
 * 12. Security violation logging in the server audit trail.
 * 13. Strict separation of 401 Unauthorized (unauthenticated) vs 403 Forbidden (authenticated but lacking permission).
 * 14. Full preservation of MVS-B1 secure code execution and MVS-B2.2 bearer session authentication.
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
  ROLE_DEFAULT_PERMISSIONS 
} from '../auth/rbacMiddleware';
import { db } from '../database/store';
import { User } from '../database/types';

// Helper to instantiate isolated test express app
function createTestApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  return app;
}

// HTTP helper using Node.js http
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

describe('MVS-B2.3: RBAC & Permission Enforcement Engine', () => {
  const testApp = createTestApp();

  let studentToken: string;
  let researcherToken: string;
  let lecturerToken: string;
  let adminToken: string;

  beforeEach(() => {
    // Generate fresh sessions for each seeded test user
    studentToken = defaultSessionStore.createSession('usr_student').token;
    researcherToken = defaultSessionStore.createSession('usr_researcher').token;
    lecturerToken = defaultSessionStore.createSession('usr_lecturer').token;
    adminToken = defaultSessionStore.createSession('usr_admin').token;
  });

  // -------------------------------------------------------------------------
  // 1. RBAC Policy & Permission Resolution Unit Tests
  // -------------------------------------------------------------------------
  describe('RBAC Permission Matrix & Evaluation Logic', () => {
    it('1. verifies Student role has least-privilege permissions only', () => {
      const studentUser = db.getState().users.find(u => u.id === 'usr_student')!;
      expect(studentUser).toBeDefined();
      expect(studentUser.role).toBe('Student');

      const perms = getEffectivePermissions(studentUser);
      expect(perms.has('VIEW')).toBe(true);
      expect(perms.has('USE')).toBe(true);
      expect(perms.has('CREATE')).toBe(true);
      expect(perms.has('CLONE')).toBe(true);

      // Forbidden for Student:
      expect(perms.has('EDIT')).toBe(false);
      expect(perms.has('DELETE')).toBe(false);
      expect(perms.has('SHARE')).toBe(false);
      expect(perms.has('PUBLISH')).toBe(false);
      expect(perms.has('VERIFY')).toBe(false);
      expect(perms.has('ADMIN')).toBe(false);

      expect(hasPermission(studentUser, 'EDIT')).toBe(false);
      expect(hasPermission(studentUser, 'PUBLISH')).toBe(false);
      expect(hasPermission(studentUser, 'ADMIN')).toBe(false);
    });

    it('2. verifies Researcher and Lecturer roles have scientific authoring permissions', () => {
      const researcherUser = db.getState().users.find(u => u.id === 'usr_researcher')!;
      const lecturerUser = db.getState().users.find(u => u.id === 'usr_lecturer')!;

      for (const u of [researcherUser, lecturerUser]) {
        expect(hasPermission(u, 'VIEW')).toBe(true);
        expect(hasPermission(u, 'USE')).toBe(true);
        expect(hasPermission(u, 'CREATE')).toBe(true);
        expect(hasPermission(u, 'CLONE')).toBe(true);
        expect(hasPermission(u, 'EDIT')).toBe(true);
        expect(hasPermission(u, 'SHARE')).toBe(true);
        expect(hasPermission(u, 'PUBLISH')).toBe(true);

        // Neither researcher nor lecturer has DELETE or ADMIN
        expect(hasPermission(u, 'DELETE')).toBe(false);
        expect(hasPermission(u, 'ADMIN')).toBe(false);
      }
    });

    it('3. verifies Admin role has full governance and destructive permissions', () => {
      const adminUser = db.getState().users.find(u => u.id === 'usr_admin')!;
      expect(hasPermission(adminUser, 'ADMIN')).toBe(true);
      expect(hasPermission(adminUser, 'DELETE')).toBe(true);
      expect(hasPermission(adminUser, 'VERIFY')).toBe(true);
      expect(hasAllPermissions(adminUser, ['VIEW', 'USE', 'CREATE', 'CLONE', 'EDIT', 'DELETE', 'SHARE', 'PUBLISH', 'VERIFY', 'ADMIN'])).toBe(true);
    });

    it('4. checks hasRole accurately distinguishes user roles', () => {
      const studentUser = db.getState().users.find(u => u.id === 'usr_student')!;
      expect(hasRole(studentUser, 'Student')).toBe(true);
      expect(hasRole(studentUser, 'Lecturer', 'Researcher', 'Admin')).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // 2. Administrative Protection (/api/audit)
  // -------------------------------------------------------------------------
  describe('Administrative Endpoint Protection (/api/audit)', () => {
    it('5. allows Admin access to /api/audit with HTTP 200', async () => {
      const res = await makeRequest(testApp, 'GET', '/api/audit', undefined, {
        'Authorization': `Bearer ${adminToken}`
      });
      expect(res.status).toBe(200);
      expect(res.body.logs).toBeDefined();
      expect(Array.isArray(res.body.logs)).toBe(true);
    });

    it('6. blocks Student access to /api/audit with HTTP 403 Forbidden', async () => {
      const res = await makeRequest(testApp, 'GET', '/api/audit', undefined, {
        'Authorization': `Bearer ${studentToken}`
      });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
      expect(res.body.error).toContain('Administrative privilege required');
      expect(res.body.user_role).toBe('Student');
    });

    it('7. blocks Researcher and Lecturer access to /api/audit with HTTP 403 Forbidden', async () => {
      const res1 = await makeRequest(testApp, 'GET', '/api/audit', undefined, {
        'Authorization': `Bearer ${researcherToken}`
      });
      expect(res1.status).toBe(403);
      expect(res1.body.code).toBe('FORBIDDEN');

      const res2 = await makeRequest(testApp, 'GET', '/api/audit', undefined, {
        'Authorization': `Bearer ${lecturerToken}`
      });
      expect(res2.status).toBe(403);
      expect(res2.body.code).toBe('FORBIDDEN');
    });

    it('8. distinguishes 401 Unauthorized (unauthenticated) from 403 Forbidden (authenticated non-admin)', async () => {
      // Unauthenticated request -> 401
      const unauthRes = await makeRequest(testApp, 'GET', '/api/audit');
      expect(unauthRes.status).toBe(401);
      expect(unauthRes.body.code).toBe('UNAUTHORIZED');

      // Authenticated as Student -> 403
      const studentRes = await makeRequest(testApp, 'GET', '/api/audit', undefined, {
        'Authorization': `Bearer ${studentToken}`
      });
      expect(studentRes.status).toBe(403);
      expect(studentRes.body.code).toBe('FORBIDDEN');
    });
  });

  // -------------------------------------------------------------------------
  // 3. Scientific Registry Protection (PUBLISH permission)
  // -------------------------------------------------------------------------
  describe('Scientific Registry Mutation Protection', () => {
    it('9. blocks Student from registering new variables with HTTP 403', async () => {
      const res = await makeRequest(testApp, 'POST', '/api/variables', {
        variable_id: 'VAR_UNAUTH',
        name: 'Unauthorized Student Variable'
      }, {
        'Authorization': `Bearer ${studentToken}`
      });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
      expect(res.body.missing_permissions).toContain('PUBLISH');
    });

    it('10. allows Researcher to register new variables with HTTP 201', async () => {
      const vId = `VAR_RSC_${Date.now()}`;
      const res = await makeRequest(testApp, 'POST', '/api/variables', {
        variable_id: vId,
        name: 'Researcher Fasting Insulin'
      }, {
        'Authorization': `Bearer ${researcherToken}`
      });
      expect(res.status).toBe(201);
      expect(res.body.variable.variable_id).toBe(vId);
    });

    it('11. blocks Student from registering new scientific formulas with HTTP 403', async () => {
      const res = await makeRequest(testApp, 'POST', '/api/formulas', {
        formula_id: 'FORMULA_STUDENT_TEST',
        name: 'Student Formula',
        expression_ast: { type: 'identifier', name: 'x' }
      }, {
        'Authorization': `Bearer ${studentToken}`
      });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('12. allows Lecturer to register new scientific parameters with HTTP 201', async () => {
      const pId = `PARAM_LEC_${Date.now()}`;
      const res = await makeRequest(testApp, 'POST', '/api/parameters', {
        parameter_id: pId,
        name: 'Lecturer Reference Parameter',
        value: 42.5
      }, {
        'Authorization': `Bearer ${lecturerToken}`
      });
      expect(res.status).toBe(201);
      expect(res.body.parameter.parameter_id).toBe(pId);
    });

    it('13. blocks Student from registering scientific references with HTTP 403', async () => {
      const res = await makeRequest(testApp, 'POST', '/api/references', {
        title: 'Unverified Student Bibliography'
      }, {
        'Authorization': `Bearer ${studentToken}`
      });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('14. allows Student to CLONE models into experimental branch with HTTP 201', async () => {
      // Model cloning is permitted because Student has CLONE permission
      const baseModel = db.getState().models[0];
      expect(baseModel).toBeDefined();

      const res = await makeRequest(testApp, 'POST', `/api/models/${baseModel.model_id}/clone`, {
        new_name: 'Student Sensitivity Study Clone'
      }, {
        'Authorization': `Bearer ${studentToken}`
      });
      expect(res.status).toBe(201);
      expect(res.body.model.status).toBe('EXPERIMENTAL');
      expect(res.body.model.is_verified).toBe(false);
      expect(res.body.model.parent_model_id).toBe(baseModel.model_id);
    });
  });

  // -------------------------------------------------------------------------
  // 4. Data Lab & Transformation Protection (EDIT vs CREATE)
  // -------------------------------------------------------------------------
  describe('Dataset Lab Access Control', () => {
    it('15. allows Student to import new raw dataset with HTTP 201 (CREATE permission)', async () => {
      const res = await makeRequest(testApp, 'POST', '/api/datasets/import', {
        name: 'Student Dietary Observation',
        raw_data: [{ subject: 'S1', calories: 2100 }, { subject: 'S2', calories: 1950 }]
      }, {
        'Authorization': `Bearer ${studentToken}`
      });
      expect(res.status).toBe(201);
      expect(res.body.dataset.name).toBe('Student Dietary Observation');
      expect(res.body.version.state).toBe('RAW');
    });

    it('16. blocks Student from transforming dataset with HTTP 403 (requires EDIT permission)', async () => {
      const state = db.getState();
      const ds = state.datasets[0];
      const dsv = state.dataset_versions.find(v => v.dataset_id === ds.id);

      const res = await makeRequest(testApp, 'POST', `/api/datasets/${ds.id}/transform`, {
        source_version_id: dsv?.id,
        transformation_type: 'FILTER_OUTLIERS',
        config: { column: 'weight', min: 40, max: 150 }
      }, {
        'Authorization': `Bearer ${studentToken}`
      });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
      expect(res.body.missing_permissions).toContain('EDIT');
    });

    it('17. allows Researcher to transform dataset with HTTP 201', async () => {
      const state = db.getState();
      const ds = state.datasets[0];
      const dsv = state.dataset_versions.find(v => v.dataset_id === ds.id);

      const res = await makeRequest(testApp, 'POST', `/api/datasets/${ds.id}/transform`, {
        source_version_id: dsv?.id,
        transformation_type: 'FILTER_OUTLIERS',
        config: { column: 'weight', min: 40, max: 150 }
      }, {
        'Authorization': `Bearer ${researcherToken}`
      });
      expect(res.status).toBe(201);
      expect(res.body.version.state).toBe('CLEANED');
    });
  });

  // -------------------------------------------------------------------------
  // 5. Material Bank Protection (PUBLISH vs EDIT)
  // -------------------------------------------------------------------------
  describe('Material Bank Governance', () => {
    it('18. blocks Student from uploading/publishing material with HTTP 403', async () => {
      const res = await makeRequest(testApp, 'POST', '/api/materials/upload', {
        title: 'Student Unverified Paper',
        content: 'Draft content without peer review'
      }, {
        'Authorization': `Bearer ${studentToken}`
      });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
      expect(res.body.missing_permissions).toContain('PUBLISH');
    });

    it('19. allows Lecturer to upload/publish educational material with HTTP 201', async () => {
      const res = await makeRequest(testApp, 'POST', '/api/materials/upload', {
        title: 'Nutritional Biochemistry Lecture Notes 2026',
        subject: 'Biochemistry',
        content: 'Lecture notes covering metabolic pathways and energetic scaling.'
      }, {
        'Authorization': `Bearer ${lecturerToken}`
      });
      expect(res.status).toBe(201);
      expect(res.body.material.title).toBe('Nutritional Biochemistry Lecture Notes 2026');
    });

    it('20. blocks Student from linking materials to projects with HTTP 403 (EDIT required)', async () => {
      const mat = db.getState().materials[0];
      const res = await makeRequest(testApp, 'POST', `/api/materials/${mat.id}/link-project`, {
        project_id: 'proj_metabolic_v1'
      }, {
        'Authorization': `Bearer ${studentToken}`
      });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });
  });

  // -------------------------------------------------------------------------
  // 6. NutriNotebook Protection (EDIT vs DELETE)
  // -------------------------------------------------------------------------
  describe('NutriNotebook Granular Cell Control', () => {
    it('21. allows Student to add notebook cell with HTTP 201 (CREATE permission)', async () => {
      const nb = db.getState().notebooks[0];
      const res = await makeRequest(testApp, 'POST', `/api/notebooks/${nb.id}/cells`, {
        cell_type: 'TEXT',
        title: 'Alex Study Cell',
        content: '# Personal calculation notes'
      }, {
        'Authorization': `Bearer ${studentToken}`
      });
      expect(res.status).toBe(201);
      expect(res.body.cell.title).toBe('Alex Study Cell');
    });

    it('22. blocks Student from editing existing notebook cell with HTTP 403 (EDIT required)', async () => {
      const cell = db.getState().notebook_cells[0];
      const res = await makeRequest(testApp, 'PUT', `/api/notebooks/cells/${cell.id}`, {
        title: 'Student Tampered Cell'
      }, {
        'Authorization': `Bearer ${studentToken}`
      });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('23. blocks Researcher and Lecturer from deleting notebook cells with HTTP 403 (DELETE required)', async () => {
      const cell = db.getState().notebook_cells[0];

      // Researcher lacks DELETE
      const rscRes = await makeRequest(testApp, 'DELETE', `/api/notebooks/cells/${cell.id}`, undefined, {
        'Authorization': `Bearer ${researcherToken}`
      });
      expect(rscRes.status).toBe(403);
      expect(rscRes.body.code).toBe('FORBIDDEN');
      expect(rscRes.body.missing_permissions).toContain('DELETE');

      // Lecturer lacks DELETE
      const lecRes = await makeRequest(testApp, 'DELETE', `/api/notebooks/cells/${cell.id}`, undefined, {
        'Authorization': `Bearer ${lecturerToken}`
      });
      expect(lecRes.status).toBe(403);
      expect(lecRes.body.code).toBe('FORBIDDEN');
    });

    it('24. allows Admin to delete notebook cell with HTTP 200', async () => {
      // Create a temporary cell first
      const nb = db.getState().notebooks[0];
      const cellRes = await makeRequest(testApp, 'POST', `/api/notebooks/${nb.id}/cells`, {
        cell_type: 'TEXT',
        title: 'Temporary Admin Cell',
        content: 'To be deleted'
      }, {
        'Authorization': `Bearer ${adminToken}`
      });
      const tempCellId = cellRes.body.cell.id;

      // Admin has DELETE permission
      const delRes = await makeRequest(testApp, 'DELETE', `/api/notebooks/cells/${tempCellId}`, undefined, {
        'Authorization': `Bearer ${adminToken}`
      });
      expect(delRes.status).toBe(200);
      expect(delRes.body.success).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // 7. Scientific Computations & Safe Code Execution (USE permission)
  // -------------------------------------------------------------------------
  describe('Scientific Execution & Preservation of MVS-B1', () => {
    it('25. allows Student to execute physiological calculation (USE permission)', async () => {
      const queteletFormula = db.getState().formulas.find(f => f.formula_id === 'FORMULA_DEMO_QUETELET') || db.getState().formulas[0];
      const res = await makeRequest(testApp, 'POST', '/api/calculations/execute', {
        formula_id: queteletFormula.formula_id,
        inputs: {
          VAR_DEMO_WEIGHT: { value: 70, unit: 'kg' },
          VAR_DEMO_HEIGHT: { value: 1.75, unit: 'm' }
        }
      }, {
        'Authorization': `Bearer ${studentToken}`
      });
      expect(res.status).toBe(200);
      expect(res.body.trace).toBeDefined();
      expect(res.body.trace.formula_or_model_id).toBe(queteletFormula.formula_id);
    });

    it('26. allows Student to run safe structured math code (MVS-B1 & USE permission)', async () => {
      const res = await makeRequest(testApp, 'POST', '/api/code/execute', {
        language: 'MATH',
        code: '2 * 3.14159 * 10'
      }, {
        'Authorization': `Bearer ${studentToken}`
      });
      expect(res.status).toBe(200);
      expect(res.body.result.status).toBe('success');
      expect(res.body.result.output).toContain('62.8318');
    });

    it('27. strictly preserves MVS-B1: arbitrary Python execution remains unsupported regardless of role', async () => {
      for (const token of [studentToken, researcherToken, adminToken]) {
        const res = await makeRequest(testApp, 'POST', '/api/code/execute', {
          language: 'PYTHON',
          code: 'import os; print(os.listdir("."))'
        }, {
          'Authorization': `Bearer ${token}`
        });
        expect(res.status).toBe(200);
        expect(res.body.result.status).toBe('unsupported');
        expect(res.body.result.error).toContain('Isolated execution runner for PYTHON is not provisioned');
      }
    });
  });

  // -------------------------------------------------------------------------
  // 8. Role Escalation Defenses & Client-Supplied Claim Rejection
  // -------------------------------------------------------------------------
  describe('Privilege Escalation & Client Claim Immunization', () => {
    it('28. rejects attempts by Student to pass x-user-id: usr_admin to access /api/audit', async () => {
      const res = await makeRequest(testApp, 'GET', '/api/audit', undefined, {
        'Authorization': `Bearer ${studentToken}`,
        'x-user-id': 'usr_admin',
        'X-Role': 'Admin'
      });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('29. ignores role or permissions in request body when creating resources', async () => {
      const res = await makeRequest(testApp, 'POST', '/api/projects', {
        name: 'Escalation Attempt Project',
        role: 'Admin',
        permissions: ['ADMIN', 'DELETE']
      }, {
        'Authorization': `Bearer ${studentToken}`
      });
      expect(res.status).toBe(201);
      // Verify user's role in DB is still Student
      const studentInDb = db.getState().users.find(u => u.id === 'usr_student')!;
      expect(studentInDb.role).toBe('Student');
      expect(studentInDb.permissions).not.toContain('ADMIN');
    });

    it('30. logs security violation audit trails on authorization denial', async () => {
      const auditCountBefore = db.getState().audit_logs.length;

      // Trigger 403 by Student accessing /api/audit
      await makeRequest(testApp, 'GET', '/api/audit', undefined, {
        'Authorization': `Bearer ${studentToken}`
      });

      const auditLogs = db.getState().audit_logs;
      expect(auditLogs.length).toBeGreaterThan(auditCountBefore);

      const latestLog = auditLogs[0];
      expect(latestLog.user_id).toBe('usr_student');
      expect(latestLog.entity_type).toBe('SECURITY_RBAC');
      expect(latestLog.details).toContain('Admin access denied');
    });
  });
});
