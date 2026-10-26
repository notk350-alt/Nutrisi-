/**
 * NutriBodySim — MVS-B2.4B Adversarial Security Remediation & Regression Test Suite
 * 
 * Comprehensive adversarial verification of:
 * - FINDING-01: Dataset Version IDOR & Cross-Dataset Parent Validation in POST /api/datasets/:id/transform
 * - FINDING-02: Calculation Trace Isolation by User & Project in POST /api/calculations/execute and GET /api/calculations
 * - FINDING-03: Statistics Write Authorization vs Source Read Authorization in POST /api/statistics/run
 * - FINDING-04: Storage Direct Access Defense & Material Sub-resources (Bookmarks, Highlights, Progress)
 * - FINDING-05: Provenance Re-Run Fallback Elimination & Experiment Creation Project Boundaries
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import express, { Express } from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { apiRouter } from '../routes/api';
import { defaultSessionStore } from '../auth/sessionStore';
import { db } from '../database/store';
import { extractToken } from '../auth/authMiddleware';
import { canAccessMaterial } from '../auth/objectAuth';

const storageDir = path.resolve(process.cwd(), 'storage', 'materials');
const orphanFilePath = path.resolve(storageDir, 'unregistered_orphan.txt');
const privateManualPath = path.resolve(storageDir, 'private_lecturer_manual.txt');

function createAdversarialTestApp(): Express {
  const app = express();
  app.use(express.json());

  // Mount storage protection handler identical to server.ts
  app.get('/storage/materials/:filename', (req, res) => {
    const rawFilename = req.params.filename;
    if (rawFilename.includes('..') || rawFilename.includes('/') || rawFilename.includes('\\')) {
      return res.status(400).json({ error: 'Invalid file path' });
    }
    const safePath = path.resolve(storageDir, rawFilename);
    if (!safePath.startsWith(storageDir)) {
      return res.status(403).json({ error: 'Access denied: Path traversal detected' });
    }
    if (!fs.existsSync(safePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    const state = db.getState();
    const material = state.materials.find(m => m.file_path === rawFilename);

    if (!material) {
      return res.status(404).json({ error: 'Material record not found for requested file' });
    }

    const token = extractToken(req);
    const validation = token ? defaultSessionStore.validateSession(token) : null;
    const user = validation?.valid && validation.userId ? state.users.find(u => u.id === validation.userId) : undefined;

    if (user) {
      const auth = canAccessMaterial(user, material, 'READ');
      if (!auth.allowed) {
        db.logAudit(
          user.id,
          'VERIFY',
          'SECURITY_BOLA',
          material.id,
          `BOLA Denied: ${user.name} denied file download for "${material.title}" (${rawFilename})`
        );
        return res.status(403).json({
          error: 'Access denied: You do not have permission to access this file',
          code: 'OBJECT_ACCESS_DENIED'
        });
      }
    } else {
      const isPublic = material.project_ids && material.project_ids.length > 0 && material.project_ids.every(pId => {
        const p = state.projects.find(proj => proj.id === pId);
        return p && p.is_public;
      });
      if (!isPublic) {
        return res.status(401).json({
          error: 'Authentication required to access this file',
          code: 'AUTH_REQUIRED'
        });
      }
    }

    res.sendFile(safePath);
  });

  app.use('/api', apiRouter);
  return app;
}

async function request(
  app: Express,
  method: string,
  url: string,
  body?: any,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: any }> {
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
                body: parsed
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

describe('MVS-B2.4B: Adversarial Security Remediation & Regression Suite', () => {
  const app = createAdversarialTestApp();

  let studentToken: string;     // usr_student
  let researcherToken: string;  // usr_researcher
  let lecturerToken: string;    // usr_lecturer
  let adminToken: string;       // usr_admin

  const privDatasetId = 'ds_lecturer_private';
  const privDsvId = 'dsv_lecturer_private_v1_0';
  const privMaterialId = 'mat_lecturer_private';

  beforeEach(() => {
    db.reseed();
    studentToken = defaultSessionStore.createSession('usr_student').token;
    researcherToken = defaultSessionStore.createSession('usr_researcher').token;
    lecturerToken = defaultSessionStore.createSession('usr_lecturer').token;
    adminToken = defaultSessionStore.createSession('usr_admin').token;

    const state = db.getState();

    // Ensure orphan file exists on disk for testing unmapped static access
    if (!fs.existsSync(orphanFilePath)) {
      fs.writeFileSync(orphanFilePath, 'Unregistered sensitive orphan file data', 'utf8');
    }

    // Ensure private_lecturer_manual.txt exists
    if (!fs.existsSync(privateManualPath)) {
      fs.writeFileSync(privateManualPath, 'Private physiology manual contents', 'utf8');
    }

    // Isolate proj_academic_lab strictly to usr_lecturer
    state.project_members = state.project_members.filter(pm => {
      if (pm.project_id === 'proj_academic_lab' && pm.user_id !== 'usr_lecturer') {
        return false;
      }
      return true;
    });

    // Seed private dataset in proj_academic_lab
    state.datasets.push({
      id: privDatasetId,
      project_id: 'proj_academic_lab',
      name: 'Lecturer Private Clinical Study',
      description: 'Confidential metabolic profiles',
      current_version: 'v1.0',
      uploaded_by: 'usr_lecturer',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });

    state.dataset_versions.push({
      id: privDsvId,
      dataset_id: privDatasetId,
      version_tag: 'v1.0',
      state: 'RAW',
      columns: [{ name: 'fasting_glucose_mg_dl', detected_type: 'number', missing_count: 0, unique_count: 2 }],
      data: [{ fasting_glucose_mg_dl: 95 }, { fasting_glucose_mg_dl: 110 }],
      validation_report: {
        is_valid: true,
        row_count: 2,
        column_count: 1,
        missing_values_count: 0,
        duplicate_rows_count: 0,
        outliers_detected: [],
        type_mismatches: [],
        warnings: []
      },
      transformation_applied: 'None',
      created_by: 'usr_lecturer',
      created_at: new Date().toISOString()
    });

    // Seed private material in proj_academic_lab
    state.materials.push({
      id: privMaterialId,
      title: 'Lecturer Private Handbook',
      author: 'Dr. Lecturer',
      subject: 'Endocrinology',
      type: 'TXT',
      description: 'Confidential clinical guidelines',
      year: 2026,
      language: 'en',
      tags: ['confidential'],
      version: '1.0.0',
      uploaded_by: 'usr_lecturer',
      file_path: 'private_lecturer_manual.txt',
      file_size_bytes: 200,
      mime_type: 'text/plain',
      file_hash: 'hash_priv_manual',
      project_ids: ['proj_academic_lab'],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
  });

  afterAll(() => {
    if (fs.existsSync(orphanFilePath)) {
      try { fs.unlinkSync(orphanFilePath); } catch {}
    }
    if (fs.existsSync(privateManualPath)) {
      try { fs.unlinkSync(privateManualPath); } catch {}
    }
  });

  // =========================================================================
  // TASK 1: FINDING-01 — DATASET VERSION IDOR
  // =========================================================================
  describe('TASK 1 — FINDING-01: Dataset Version IDOR in POST /api/datasets/:id/transform', () => {
    it('1.1. allows valid transformation when version strictly belongs to the target dataset', async () => {
      const state = db.getState();
      const ds = state.datasets.find(d => d.id === 'ds_cohort_alpha')!;
      const dsv = state.dataset_versions.find(v => v.dataset_id === ds.id)!;

      const res = await request(app, 'POST', `/api/datasets/${ds.id}/transform`, {
        source_version_id: dsv.id,
        transformation_type: 'UNIT_CONVERT',
        config: { column: 'fasting_glucose_mg_dl', from_unit: 'mg/dL', to_unit: 'mmol/L' }
      }, {
        'Authorization': `Bearer ${researcherToken}`
      });

      expect(res.status).toBe(201);
      expect(res.body.version).toBeDefined();
      expect(res.body.version.dataset_id).toBe(ds.id);
    });

    it('1.2. blocks IDOR: rejects source_version_id belonging to another private dataset', async () => {
      const state = db.getState();
      const targetDs = state.datasets.find(d => d.id === 'ds_cohort_alpha')!;
      const initialVersionCount = state.dataset_versions.length;

      // Researcher attempts to transform targetDs using private version from lecturer's privDatasetId
      const res = await request(app, 'POST', `/api/datasets/${targetDs.id}/transform`, {
        source_version_id: privDsvId,
        transformation_type: 'UNIT_CONVERT',
        config: { column: 'fasting_glucose_mg_dl', from_unit: 'mg/dL', to_unit: 'mmol/L' }
      }, {
        'Authorization': `Bearer ${researcherToken}`
      });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_PARENT_VERSION');
      expect(res.body.error).toContain('does not belong to the target dataset');

      // Verify zero side effect
      expect(state.dataset_versions.length).toBe(initialVersionCount);
    });

    it('1.3. rejects version from another dataset if applied to an unrelated target dataset', async () => {
      const state = db.getState();
      const targetDs = state.datasets.find(d => d.id === 'ds_cohort_alpha')!;

      // Create a second public dataset
      const otherDsId = `ds_other_${Date.now()}`;
      const otherDsvId = `dsv_other_${Date.now()}`;
      state.datasets.push({
        id: otherDsId,
        project_id: 'proj_metabolic_v1',
        name: 'Other Dataset',
        description: 'Other data',
        current_version: 'v1.0',
        uploaded_by: 'usr_researcher',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
      state.dataset_versions.push({
        id: otherDsvId,
        dataset_id: otherDsId,
        version_tag: 'v1.0',
        state: 'RAW',
        columns: [],
        data: [],
        validation_report: { is_valid: true, row_count: 0, column_count: 0, missing_values_count: 0, duplicate_rows_count: 0, outliers_detected: [], type_mismatches: [], warnings: [] },
        created_by: 'usr_researcher',
        created_at: new Date().toISOString()
      });

      const res = await request(app, 'POST', `/api/datasets/${targetDs.id}/transform`, {
        source_version_id: otherDsvId,
        transformation_type: 'UNIT_CONVERT',
        config: { column: 'weight_kg', from_unit: 'kg', to_unit: 'lbs' }
      }, {
        'Authorization': `Bearer ${researcherToken}`
      });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_PARENT_VERSION');
    });

    it('1.4. returns 404 when source_version_id does not exist', async () => {
      const state = db.getState();
      const ds = state.datasets.find(d => d.id === 'ds_cohort_alpha')!;

      const res = await request(app, 'POST', `/api/datasets/${ds.id}/transform`, {
        source_version_id: 'dsv_non_existent_9999',
        transformation_type: 'UNIT_CONVERT',
        config: { column: 'weight_kg', from_unit: 'kg', to_unit: 'lbs' }
      }, {
        'Authorization': `Bearer ${researcherToken}`
      });

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('VERSION_NOT_FOUND');
    });

    it('1.5. rejects transform request when target dataset is inaccessible to user (403)', async () => {
      // Student has no write access to academic lab
      const res = await request(app, 'POST', `/api/datasets/${privDatasetId}/transform`, {
        source_version_id: privDsvId,
        transformation_type: 'UNIT_CONVERT',
        config: { column: 'fasting_glucose_mg_dl', from_unit: 'mg/dL', to_unit: 'mmol/L' }
      }, {
        'Authorization': `Bearer ${researcherToken}`
      });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('OBJECT_ACCESS_DENIED');
    });

    it('1.6. rejects request when source_version_id parameter is missing (400)', async () => {
      const state = db.getState();
      const ds = state.datasets.find(d => d.id === 'ds_cohort_alpha')!;

      const res = await request(app, 'POST', `/api/datasets/${ds.id}/transform`, {
        transformation_type: 'UNIT_CONVERT',
        config: { column: 'weight_kg', from_unit: 'kg', to_unit: 'lbs' }
      }, {
        'Authorization': `Bearer ${researcherToken}`
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('source_version_id is required');
    });

    it('1.7. logs BOLA audit event on version manipulation attempt without modifying audit state', async () => {
      const state = db.getState();
      const targetDs = state.datasets.find(d => d.id === 'ds_cohort_alpha')!;
      const auditsBefore = state.audit_logs.length;

      await request(app, 'POST', `/api/datasets/${targetDs.id}/transform`, {
        source_version_id: privDsvId,
        transformation_type: 'UNIT_CONVERT',
        config: { column: 'fasting_glucose_mg_dl', from_unit: 'mg/dL', to_unit: 'mmol/L' }
      }, {
        'Authorization': `Bearer ${researcherToken}`
      });

      const auditsAfter = state.audit_logs.length;
      expect(auditsAfter).toBeGreaterThan(auditsBefore);

      const latestLog = state.audit_logs[0];
      expect(latestLog.entity_type).toBe('SECURITY_BOLA');
      expect(latestLog.details).toContain('BOLA Denied');
    });
  });

  // =========================================================================
  // TASK 2: FINDING-02 — CALCULATION TRACE ISOLATION
  // =========================================================================
  describe('TASK 2 — FINDING-02: Calculation Trace Isolation', () => {
    it('2.1. stores executing user_id and tags project_id on formula execution', async () => {
      const res = await request(app, 'POST', '/api/calculations/execute', {
        formula_id: 'FORMULA_DEMO_QUETELET',
        inputs: {
          VAR_DEMO_WEIGHT: { value: 72, unit: 'kg' },
          VAR_DEMO_HEIGHT: { value: 1.78, unit: 'm' }
        },
        project_id: 'proj_metabolic_v1'
      }, {
        'Authorization': `Bearer ${researcherToken}`
      });

      expect(res.status).toBe(200);
      expect(res.body.trace).toBeDefined();
      expect(res.body.trace.user_id).toBe('usr_researcher');
      expect(res.body.trace.project_id).toBe('proj_metabolic_v1');
    });

    it('2.2. isolates calculation traces: User B cannot see User A private calculation in GET /api/calculations', async () => {
      // Lecturer executes a private calculation tied to proj_academic_lab
      const execRes = await request(app, 'POST', '/api/calculations/execute', {
        formula_id: 'FORMULA_DEMO_QUETELET',
        inputs: {
          VAR_DEMO_WEIGHT: { value: 85, unit: 'kg' },
          VAR_DEMO_HEIGHT: { value: 1.82, unit: 'm' }
        },
        project_id: 'proj_academic_lab'
      }, {
        'Authorization': `Bearer ${lecturerToken}`
      });
      const calcId = execRes.body.trace.calculation_id;

      // Researcher (not a member of academic lab) queries calculations
      const listRes = await request(app, 'GET', '/api/calculations', undefined, {
        'Authorization': `Bearer ${researcherToken}`
      });

      expect(listRes.status).toBe(200);
      const visibleIds = listRes.body.calculations.map((c: any) => c.calculation_id);
      expect(visibleIds).not.toContain(calcId);
    });

    it('2.3. denies direct GET /api/calculations/:id for unauthorized user (HTTP 403 BOLA)', async () => {
      // Lecturer creates a private calculation
      const execRes = await request(app, 'POST', '/api/calculations/execute', {
        formula_id: 'FORMULA_DEMO_QUETELET',
        inputs: {
          VAR_DEMO_WEIGHT: { value: 90, unit: 'kg' },
          VAR_DEMO_HEIGHT: { value: 1.70, unit: 'm' }
        },
        project_id: 'proj_academic_lab'
      }, {
        'Authorization': `Bearer ${lecturerToken}`
      });
      const calcId = execRes.body.trace.calculation_id;

      // Researcher probes specific trace ID
      const directRes = await request(app, 'GET', `/api/calculations/${calcId}`, undefined, {
        'Authorization': `Bearer ${researcherToken}`
      });

      expect(directRes.status).toBe(403);
      expect(directRes.body.code).toBe('OBJECT_ACCESS_DENIED');
    });

    it('2.4. allows calculation owner to retrieve their own trace via direct ID', async () => {
      const execRes = await request(app, 'POST', '/api/calculations/execute', {
        formula_id: 'FORMULA_DEMO_QUETELET',
        inputs: {
          VAR_DEMO_WEIGHT: { value: 68, unit: 'kg' },
          VAR_DEMO_HEIGHT: { value: 1.75, unit: 'm' }
        }
      }, {
        'Authorization': `Bearer ${researcherToken}`
      });
      const calcId = execRes.body.trace.calculation_id;

      const directRes = await request(app, 'GET', `/api/calculations/${calcId}`, undefined, {
        'Authorization': `Bearer ${researcherToken}`
      });

      expect(directRes.status).toBe(200);
      expect(directRes.body.trace.calculation_id).toBe(calcId);
    });

    it('2.5. does not expose legacy unattributed calculation traces to unprivileged users', async () => {
      const state = db.getState();
      const orphanCalcId = `calc_legacy_${Date.now()}`;
      state.calculations.push({
        calculation_id: orphanCalcId,
        formula_or_model_id: 'FORMULA_BMI_STANDARD',
        version: '1.0.0',
        inputs_received: {},
        normalized_inputs: {},
        parameters_resolved: {},
        steps: [],
        final_result: { bmi: { value: 24, unit: 'kg/m²' } },
        explanation: 'Legacy unassigned calculation trace',
        provenance_hash: 'legacy_hash',
        created_at: new Date().toISOString()
      });

      const res = await request(app, 'GET', '/api/calculations', undefined, {
        'Authorization': `Bearer ${studentToken}`
      });

      expect(res.status).toBe(200);
      const ids = res.body.calculations.map((c: any) => c.calculation_id);
      expect(ids).not.toContain(orphanCalcId);
    });
  });

  // =========================================================================
  // TASK 3: FINDING-03 — STATISTICS WRITE AUTHORIZATION
  // =========================================================================
  describe('TASK 3 — FINDING-03: Statistics Write Authorization in POST /api/statistics/run', () => {
    it('3.1. permits statistics execution when user has WRITE access to destination project', async () => {
      const state = db.getState();
      const ds = state.datasets.find(d => d.id === 'ds_cohort_alpha')!;
      const dsv = state.dataset_versions.find(v => v.dataset_id === ds.id)!;

      const res = await request(app, 'POST', '/api/statistics/run', {
        project_id: 'proj_metabolic_v1',
        dataset_version_id: dsv.id,
        analysis_type: 'DESCRIPTIVE',
        target_columns: ['fasting_glucose_mg_dl'],
        title: 'Descriptive Glucose'
      }, {
        'Authorization': `Bearer ${researcherToken}`
      });

      expect(res.status).toBe(201);
      expect(res.body.analysis).toBeDefined();
      expect(res.body.analysis.project_id).toBe('proj_metabolic_v1');
    });

    it('3.2. rejects statistics execution when user has only Viewer (READ) role on target project (403)', async () => {
      const state = db.getState();
      const ds = state.datasets.find(d => d.id === 'ds_cohort_alpha')!;
      const dsv = state.dataset_versions.find(v => v.dataset_id === ds.id)!;

      // Demote student to Viewer role on proj_metabolic_v1
      const pm = state.project_members.find(m => m.project_id === 'proj_metabolic_v1' && m.user_id === 'usr_student');
      if (pm) {
        pm.role = 'Viewer';
      }

      const res = await request(app, 'POST', '/api/statistics/run', {
        project_id: 'proj_metabolic_v1',
        dataset_version_id: dsv.id,
        analysis_type: 'DESCRIPTIVE',
        target_columns: ['fasting_glucose_mg_dl'],
        title: 'Unauthorized Student Run'
      }, {
        'Authorization': `Bearer ${studentToken}`
      });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('OBJECT_ACCESS_DENIED');
    });

    it('3.3. blocks IDOR: denies saving statistics into private project of another user', async () => {
      const state = db.getState();
      const ds = state.datasets.find(d => d.id === 'ds_cohort_alpha')!;
      const dsv = state.dataset_versions.find(v => v.dataset_id === ds.id)!;

      // Target project is lecturer's private academic lab
      const res = await request(app, 'POST', '/api/statistics/run', {
        project_id: 'proj_academic_lab',
        dataset_version_id: dsv.id,
        analysis_type: 'DESCRIPTIVE',
        target_columns: ['fasting_glucose_mg_dl']
      }, {
        'Authorization': `Bearer ${researcherToken}`
      });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('OBJECT_ACCESS_DENIED');
    });

    it('3.4. rejects request with non-existent project_id (404)', async () => {
      const state = db.getState();
      const ds = state.datasets.find(d => d.id === 'ds_cohort_alpha')!;
      const dsv = state.dataset_versions.find(v => v.dataset_id === ds.id)!;

      const res = await request(app, 'POST', '/api/statistics/run', {
        project_id: 'proj_non_existent_9999',
        dataset_version_id: dsv.id,
        analysis_type: 'DESCRIPTIVE',
        target_columns: ['fasting_glucose_mg_dl']
      }, {
        'Authorization': `Bearer ${researcherToken}`
      });

      expect(res.status).toBe(404);
    });

    it('3.5. rejects statistics when source dataset is private and unauthorized to user (403)', async () => {
      // Researcher attempts to read lecturer's privDsvId and write into researcher's own writable project
      const res = await request(app, 'POST', '/api/statistics/run', {
        project_id: 'proj_metabolic_v1',
        dataset_version_id: privDsvId,
        analysis_type: 'DESCRIPTIVE',
        target_columns: ['fasting_glucose_mg_dl']
      }, {
        'Authorization': `Bearer ${researcherToken}`
      });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('OBJECT_ACCESS_DENIED');
    });

    it('3.6. ensures zero side effect in statistics_analyses array on rejected request', async () => {
      const state = db.getState();
      const ds = state.datasets.find(d => d.id === 'ds_cohort_alpha')!;
      const dsv = state.dataset_versions.find(v => v.dataset_id === ds.id)!;

      const initialCount = state.statistics_analyses.length;

      await request(app, 'POST', '/api/statistics/run', {
        project_id: 'proj_academic_lab',
        dataset_version_id: dsv.id,
        analysis_type: 'DESCRIPTIVE',
        target_columns: ['fasting_glucose_mg_dl']
      }, {
        'Authorization': `Bearer ${researcherToken}`
      });

      expect(state.statistics_analyses.length).toBe(initialCount);
    });
  });

  // =========================================================================
  // TASK 4: FINDING-04 — FILE STORAGE PROTECTION & MATERIAL SUB-RESOURCES
  // =========================================================================
  describe('TASK 4 — FINDING-04: File Storage Protection & Material Sub-resources', () => {
    it('4.1. returns 404 when requesting static file with no registered material record', async () => {
      const res = await request(app, 'GET', '/storage/materials/unregistered_orphan.txt');
      expect(res.status).toBe(404);
      expect(res.body.error).toContain('Material record not found');
    });

    it('4.2. returns 401 when unauthenticated request attempts to access private material file', async () => {
      const res = await request(app, 'GET', '/storage/materials/private_lecturer_manual.txt');
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('AUTH_REQUIRED');
    });

    it('4.3. returns 403 when authenticated user without project membership requests private material file', async () => {
      const res = await request(app, 'GET', '/storage/materials/private_lecturer_manual.txt', undefined, {
        'Authorization': `Bearer ${researcherToken}`
      });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('OBJECT_ACCESS_DENIED');
    });

    it('4.4. blocks path traversal in static storage route (HTTP 400)', async () => {
      const res = await request(app, 'GET', '/storage/materials/..%2F..%2Fpackage.json');
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid file path');
    });

    it('4.5. verifies authorizeMaterial on GET /api/documents/:id/progress (403 on private material)', async () => {
      const res = await request(app, 'GET', `/api/documents/${privMaterialId}/progress`, undefined, {
        'Authorization': `Bearer ${researcherToken}`
      });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('OBJECT_ACCESS_DENIED');
    });

    it('4.6. verifies authorizeMaterial on POST /api/documents/:id/progress (403 on private material)', async () => {
      const res = await request(app, 'POST', `/api/documents/${privMaterialId}/progress`, {
        last_page: 5,
        total_pages: 50
      }, {
        'Authorization': `Bearer ${researcherToken}`
      });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('OBJECT_ACCESS_DENIED');
    });

    it('4.7. verifies authorizeMaterial on GET and POST /api/materials/:id/bookmarks (403 on private material)', async () => {
      // GET bookmarks
      const getRes = await request(app, 'GET', `/api/materials/${privMaterialId}/bookmarks`, undefined, {
        'Authorization': `Bearer ${researcherToken}`
      });
      expect(getRes.status).toBe(403);

      // POST bookmark
      const postRes = await request(app, 'POST', `/api/materials/${privMaterialId}/bookmarks`, {
        page: 10,
        title: 'Exploit bookmark'
      }, {
        'Authorization': `Bearer ${researcherToken}`
      });
      expect(postRes.status).toBe(403);
    });

    it('4.8. verifies authorizeMaterial on GET and POST /api/materials/:id/highlights (403 on private material)', async () => {
      // GET highlights
      const getRes = await request(app, 'GET', `/api/materials/${privMaterialId}/highlights`, undefined, {
        'Authorization': `Bearer ${researcherToken}`
      });
      expect(getRes.status).toBe(403);

      // POST highlight
      const postRes = await request(app, 'POST', `/api/materials/${privMaterialId}/highlights`, {
        page: 3,
        selected_text: 'Sensitive data snippet'
      }, {
        'Authorization': `Bearer ${researcherToken}`
      });
      expect(postRes.status).toBe(403);
    });
  });

  // =========================================================================
  // TASK 5: FINDING-05 — PROVENANCE RE-RUN & EXPERIMENT BOUNDARY
  // =========================================================================
  describe('TASK 5 — FINDING-05: Provenance Re-Run & Experiment Boundary', () => {
    it('5.1. rejects provenance re-run when provenance_id is omitted (HTTP 400)', async () => {
      const res = await request(app, 'POST', '/api/provenance/re-run', {}, {
        'Authorization': `Bearer ${researcherToken}`
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('provenance_id is required');
    });

    it('5.2. rejects provenance re-run with 404 on non-existent provenance ID (no fallback to record 0)', async () => {
      const res = await request(app, 'POST', '/api/provenance/re-run', {
        provenance_id: 'prov_non_existent_fake_id'
      }, {
        'Authorization': `Bearer ${researcherToken}`
      });

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('Provenance record not found');
    });

    it('5.3. blocks provenance re-run when target provenance belongs to private project of another user (403)', async () => {
      const state = db.getState();
      const privProvId = `prov_academic_${Date.now()}`;
      state.provenance_records.push({
        id: privProvId,
        project_id: 'proj_academic_lab',
        target_entity_type: 'CALCULATION',
        target_entity_id: 'calc_priv_001',
        user_id: 'usr_lecturer',
        environment_specs: 'Node 22 / Linux',
        provenance_hash: 'hash_priv_prov',
        reproducibility_manifest: { formula_id: 'FORMULA_DEMO_QUETELET' },
        created_at: new Date().toISOString()
      });

      // Researcher tries to execute re-run on lecturer's private provenance
      const res = await request(app, 'POST', '/api/provenance/re-run', {
        provenance_id: privProvId
      }, {
        'Authorization': `Bearer ${researcherToken}`
      });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('OBJECT_ACCESS_DENIED');
    });

    it('5.4. allows legitimate provenance re-run on accessible project provenance', async () => {
      const state = db.getState();
      const sharedProv = state.provenance_records.find(p => p.project_id === 'proj_metabolic_v1');
      if (sharedProv) {
        const res = await request(app, 'POST', '/api/provenance/re-run', {
          provenance_id: sharedProv.id
        }, {
          'Authorization': `Bearer ${researcherToken}`
        });

        expect(res.status).toBe(200);
        expect(res.body.status).toBe('VERIFIED_IDENTICAL');
      }
    });

    it('5.5. rejects experiment creation in unauthorized private project (403)', async () => {
      const res = await request(app, 'POST', '/api/experiments', {
        project_id: 'proj_academic_lab',
        title: 'Exploit Experiment',
        baseline_model_id: 'MODEL_ENERGY_BALANCE'
      }, {
        'Authorization': `Bearer ${researcherToken}`
      });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('OBJECT_ACCESS_DENIED');
    });

    it('5.6. rejects experiment creation with non-existent project_id (404)', async () => {
      const res = await request(app, 'POST', '/api/experiments', {
        project_id: 'proj_fake_non_existent',
        title: 'Exploit Experiment',
        baseline_model_id: 'MODEL_ENERGY_BALANCE'
      }, {
        'Authorization': `Bearer ${researcherToken}`
      });

      expect(res.status).toBe(404);
    });
  });
});
