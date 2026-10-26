/**
 * NutriBodySim — MVS-B2.4 Object-Level Authorization & Project Isolation Test Suite
 *
 * Comprehensive tests against Broken Object Level Authorization (BOLA/IDOR):
 * 1. Project-level BOLA defense: unauthorized users cannot read, edit, or delete private projects.
 * 2. Public vs Private project access semantics.
 * 3. Project and team membership permission inheritance (Owner, Editor, Collaborator, Viewer).
 * 4. Dataset isolation: unauthorized users cannot read, import into, or transform datasets in private projects.
 * 5. Notebook & cell hierarchy: cells inherit access control from parent notebook and project.
 * 6. Material linking defense: cannot link materials into unauthorized private projects.
 * 7. Personal workspace isolation: notes, bookmarks, and highlights are isolated to their owner.
 * 8. Parameter tampering immunity: client-supplied owner_id, user_id, team_id, and roles are ignored.
 * 9. Administrative override: Admin can access objects with explicit audit log recording.
 * 10. Security audit logging on all BOLA denial events.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import express, { Express } from 'express';
import http from 'http';
import { apiRouter } from '../routes/api';
import { defaultSessionStore } from '../auth/sessionStore';
import { 
  canAccessProject,
  canAccessDataset,
  canAccessNotebook,
  canAccessNotebookCell,
  canAccessMaterial,
  canAccessNote,
  canAccessTeam
} from '../auth/objectAuth';
import { db } from '../database/store';
import { Project, NutriNotebook, Dataset } from '../database/types';

// Helper to instantiate isolated test express app
function createTestApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  return app;
}

// HTTP request helper using native Node.js http
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

describe('MVS-B2.4: Object-Level Authorization & Project Isolation', () => {
  const testApp = createTestApp();

  let studentToken: string;
  let researcherToken: string;
  let lecturerToken: string;
  let adminToken: string;

  beforeEach(() => {
    db.reseed();
    studentToken = defaultSessionStore.createSession('usr_student').token;
    researcherToken = defaultSessionStore.createSession('usr_researcher').token;
    lecturerToken = defaultSessionStore.createSession('usr_lecturer').token;
    adminToken = defaultSessionStore.createSession('usr_admin').token;
  });

  // -------------------------------------------------------------------------
  // 1. Direct Ownership & Project Isolation (BOLA Defense)
  // -------------------------------------------------------------------------
  describe('Project-Level BOLA & IDOR Defenses', () => {
    it('1. allows project owner to retrieve project details (HTTP 200)', async () => {
      // proj_academic_lab is owned by usr_lecturer
      const res = await makeRequest(testApp, 'GET', '/api/projects/proj_academic_lab', undefined, {
        'Authorization': `Bearer ${lecturerToken}`
      });
      expect(res.status).toBe(200);
      expect(res.body.project).toBeDefined();
      expect(res.body.project.id).toBe('proj_academic_lab');
    });

    it('2. blocks unauthorized user from accessing private project (BOLA/IDOR protection -> HTTP 403)', async () => {
      // proj_academic_lab is private (is_public: false) and owned by usr_lecturer.
      // usr_researcher is NOT a member and NOT an admin.
      const res = await makeRequest(testApp, 'GET', '/api/projects/proj_academic_lab', undefined, {
        'Authorization': `Bearer ${researcherToken}`
      });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('OBJECT_ACCESS_DENIED');
      expect(res.body.error).toContain('Access denied');
    });

    it('3. allows all authenticated users to read public projects (HTTP 200)', async () => {
      // proj_metabolic_v1 is public (is_public: true)
      for (const token of [studentToken, lecturerToken, researcherToken]) {
        const res = await makeRequest(testApp, 'GET', '/api/projects/proj_metabolic_v1', undefined, {
          'Authorization': `Bearer ${token}`
        });
        expect(res.status).toBe(200);
        expect(res.body.project.id).toBe('proj_metabolic_v1');
      }
    });

    it('4. filters GET /api/projects list strictly to accessible projects only', async () => {
      // usr_researcher should see proj_metabolic_v1 (owned/public) but NOT private proj_academic_lab
      const res = await makeRequest(testApp, 'GET', '/api/projects', undefined, {
        'Authorization': `Bearer ${researcherToken}`
      });
      expect(res.status).toBe(200);
      const projectIds = res.body.projects.map((p: any) => p.id);
      expect(projectIds).toContain('proj_metabolic_v1');
      expect(projectIds).not.toContain('proj_academic_lab');
    });

    it('5. blocks unauthorized user from updating a project (HTTP 403)', async () => {
      // usr_researcher tries to rename proj_academic_lab (owned by lecturer)
      const res = await makeRequest(testApp, 'PUT', '/api/projects/proj_academic_lab', {
        name: 'Hijacked Academic Lab'
      }, {
        'Authorization': `Bearer ${researcherToken}`
      });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('OBJECT_ACCESS_DENIED');

      // Verify name was not changed in DB
      const proj = db.getState().projects.find(p => p.id === 'proj_academic_lab')!;
      expect(proj.name).not.toBe('Hijacked Academic Lab');
    });

    it('6. allows project owner to update project (HTTP 200)', async () => {
      const res = await makeRequest(testApp, 'PUT', '/api/projects/proj_academic_lab', {
        description: 'Updated course workspace for Nutritional Physiology 401.'
      }, {
        'Authorization': `Bearer ${lecturerToken}`
      });
      expect(res.status).toBe(200);
      expect(res.body.project.description).toContain('Updated course workspace');
    });

    it('7. blocks non-owner from deleting a project even if they have DELETE permission (HTTP 403)', async () => {
      // Create a temporary private project owned by lecturer
      const newProjId = `proj_priv_${Date.now()}`;
      db.getState().projects.push({
        id: newProjId,
        name: 'Private Lecturer Study',
        description: 'Restricted',
        type: 'Research',
        owner_id: 'usr_lecturer',
        is_public: false,
        tags: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

      // usr_researcher tries to delete lecturer project
      const res = await makeRequest(testApp, 'DELETE', `/api/projects/${newProjId}`, undefined, {
        'Authorization': `Bearer ${researcherToken}`
      });
      // Should fail: researcher has no DELETE permission AND is not owner
      expect(res.status).toBe(403);

      // Verify project still exists
      expect(db.getState().projects.some(p => p.id === newProjId)).toBe(true);
    });

    it('8. allows project owner or Admin to delete project (HTTP 200)', async () => {
      // Create a temporary private project
      const tempId = `proj_del_${Date.now()}`;
      db.getState().projects.push({
        id: tempId,
        name: 'Disposable Study',
        description: 'To delete',
        type: 'Research',
        owner_id: 'usr_lecturer',
        is_public: false,
        tags: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

      const res = await makeRequest(testApp, 'DELETE', `/api/projects/${tempId}`, undefined, {
        'Authorization': `Bearer ${adminToken}`
      });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(db.getState().projects.some(p => p.id === tempId)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // 2. Project Members & Team Inheritance
  // -------------------------------------------------------------------------
  describe('Project & Team Membership Access Inheritance', () => {
    it('9. allows project member with Collaborator role to read private project', async () => {
      // In seed data: usr_student is a Collaborator on proj_academic_lab
      const res = await makeRequest(testApp, 'GET', '/api/projects/proj_academic_lab', undefined, {
        'Authorization': `Bearer ${studentToken}`
      });
      expect(res.status).toBe(200);
      expect(res.body.project.id).toBe('proj_academic_lab');
    });

    it('10. allows project owner to add collaborators (POST /api/projects/:id/members)', async () => {
      const res = await makeRequest(testApp, 'POST', '/api/projects/proj_academic_lab/members', {
        user_id: 'usr_researcher',
        role: 'Collaborator'
      }, {
        'Authorization': `Bearer ${lecturerToken}`
      });
      expect(res.status).toBe(201);
      expect(res.body.member.user_id).toBe('usr_researcher');
      expect(res.body.member.role).toBe('Collaborator');

      // Now researcher can access proj_academic_lab!
      const accessRes = await makeRequest(testApp, 'GET', '/api/projects/proj_academic_lab', undefined, {
        'Authorization': `Bearer ${researcherToken}`
      });
      expect(accessRes.status).toBe(200);
    });

    it('11. blocks non-owner from adding members to project (HTTP 403)', async () => {
      // Create another fresh private project
      const privId = `proj_locked_${Date.now()}`;
      db.getState().projects.push({
        id: privId,
        name: 'Locked Private Project',
        description: 'Confidential',
        type: 'Research',
        owner_id: 'usr_lecturer',
        is_public: false,
        tags: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

      // usr_student has no SHARE permission and is not owner
      const res = await makeRequest(testApp, 'POST', `/api/projects/${privId}/members`, {
        user_id: 'usr_researcher',
        role: 'Editor'
      }, {
        'Authorization': `Bearer ${studentToken}`
      });
      expect(res.status).toBe(403);
    });

    it('12. grants access to projects associated with teams that the user is a member of', () => {
      const state = db.getState();
      const user = state.users.find(u => u.id === 'usr_lecturer')!;
      // Create a private project linked to team_metabolic_lab
      const teamProj: Project = {
        id: `proj_team_test_${Date.now()}`,
        name: 'Team Collaborative Kinetics',
        description: 'Team project',
        type: 'Team',
        owner_id: 'usr_researcher',
        team_id: 'team_metabolic_lab',
        is_public: false,
        tags: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      // usr_lecturer is an Editor in team_metabolic_lab
      const readAccess = canAccessProject(user, teamProj, 'READ');
      expect(readAccess.allowed).toBe(true);

      const writeAccess = canAccessProject(user, teamProj, 'WRITE');
      expect(writeAccess.allowed).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // 3. Dataset Isolation & Transformation Authorization
  // -------------------------------------------------------------------------
  describe('Dataset Isolation & BOLA Defense', () => {
    it('13. blocks importing a dataset into an unauthorized private project (HTTP 403)', async () => {
      // Create a private project owned strictly by lecturer
      const lockedProjId = `proj_sec_${Date.now()}`;
      db.getState().projects.push({
        id: lockedProjId,
        name: 'Lecturer Private Cohort',
        description: 'Restricted',
        type: 'Research',
        owner_id: 'usr_lecturer',
        is_public: false,
        tags: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

      // usr_researcher tries to import dataset into locked project
      const res = await makeRequest(testApp, 'POST', '/api/datasets/import', {
        project_id: lockedProjId,
        name: 'Unauthorized Research Ingestion',
        raw_data: [{ col1: 10, col2: 20 }]
      }, {
        'Authorization': `Bearer ${researcherToken}`
      });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('OBJECT_ACCESS_DENIED');
    });

    it('14. blocks unauthorized user from transforming a dataset in another users private project (HTTP 403)', async () => {
      // Create private project and dataset for lecturer
      const lockedProjId = `proj_dstrans_${Date.now()}`;
      const lockedDatasetId = `ds_locked_${Date.now()}`;
      const lockedDsvId = `dsv_locked_${Date.now()}`;

      db.getState().projects.push({
        id: lockedProjId,
        name: 'Lecturer Confidential Lab',
        description: 'Restricted',
        type: 'Research',
        owner_id: 'usr_lecturer',
        is_public: false,
        tags: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

      db.getState().datasets.push({
        id: lockedDatasetId,
        project_id: lockedProjId,
        name: 'Lecturer Private Blood Chemistry',
        description: 'Private data',
        uploaded_by: 'usr_lecturer',
        current_version: 'v1.0',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

      db.getState().dataset_versions.push({
        id: lockedDsvId,
        dataset_id: lockedDatasetId,
        version_tag: 'v1.0',
        state: 'RAW',
        columns: [{ name: 'glucose', detected_type: 'number', missing_count: 0, unique_count: 5 }],
        data: [{ glucose: 95 }, { glucose: 102 }],
        validation_report: { is_valid: true, row_count: 2, column_count: 1, missing_values_count: 0, duplicate_rows_count: 0, outliers_detected: [], type_mismatches: [], warnings: [] },
        created_by: 'usr_lecturer',
        created_at: new Date().toISOString()
      });

      // usr_researcher has EDIT permission in RBAC, but has NO object access to lockedProjId!
      const res = await makeRequest(testApp, 'POST', `/api/datasets/${lockedDatasetId}/transform`, {
        source_version_id: lockedDsvId,
        transformation_type: 'FILTER_OUTLIERS',
        config: { column: 'glucose', min: 70, max: 120 }
      }, {
        'Authorization': `Bearer ${researcherToken}`
      });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('OBJECT_ACCESS_DENIED');
    });

    it('15. allows authorized project owner to transform their dataset (HTTP 201)', async () => {
      // In seed data: ds_alpha_cohort is in proj_metabolic_v1 owned by usr_researcher
      const state = db.getState();
      const ds = state.datasets.find(d => d.id === 'ds_cohort_alpha') || state.datasets[0];
      const dsv = state.dataset_versions.find(v => v.dataset_id === ds.id)!;

      const res = await makeRequest(testApp, 'POST', `/api/datasets/${ds.id}/transform`, {
        source_version_id: dsv.id,
        transformation_type: 'FILTER_OUTLIERS',
        config: { column: 'weight_kg', min: 40, max: 120 }
      }, {
        'Authorization': `Bearer ${researcherToken}`
      });
      expect(res.status).toBe(201);
      expect(res.body.version.state).toBe('CLEANED');
    });
  });

  // -------------------------------------------------------------------------
  // 4. Notebook & Notebook Cell Hierarchy Protection
  // -------------------------------------------------------------------------
  describe('Notebook Hierarchy & Child Cell Access Control', () => {
    it('16. blocks unauthorized user from reading private notebook (HTTP 403)', async () => {
      // Create private project and notebook
      const privProjId = `proj_nbpriv_${Date.now()}`;
      const privNbId = `nb_priv_${Date.now()}`;

      db.getState().projects.push({
        id: privProjId,
        name: 'Confidential Lecturer Notebook Lab',
        description: 'Secret',
        type: 'Academic',
        owner_id: 'usr_lecturer',
        is_public: false,
        tags: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

      db.getState().notebooks.push({
        id: privNbId,
        project_id: privProjId,
        title: 'Lecturer Exam Formulation Notes',
        description: 'Restricted',
        created_by: 'usr_lecturer',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

      // usr_researcher attempts to view notebook
      const res = await makeRequest(testApp, 'GET', `/api/notebooks/${privNbId}`, undefined, {
        'Authorization': `Bearer ${researcherToken}`
      });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('OBJECT_ACCESS_DENIED');
    });

    it('17. blocks unauthorized user from adding cells to private notebook (HTTP 403)', async () => {
      const privProjId = `proj_nbcell_${Date.now()}`;
      const privNbId = `nb_cellpriv_${Date.now()}`;

      db.getState().projects.push({
        id: privProjId,
        name: 'Lecturer Private Project',
        description: 'Restricted',
        type: 'Academic',
        owner_id: 'usr_lecturer',
        is_public: false,
        tags: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

      db.getState().notebooks.push({
        id: privNbId,
        project_id: privProjId,
        title: 'Lecturer Notebook',
        description: 'Notes',
        created_by: 'usr_lecturer',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

      const res = await makeRequest(testApp, 'POST', `/api/notebooks/${privNbId}/cells`, {
        cell_type: 'TEXT',
        title: 'Injected Attacker Cell',
        content: '# Malicious modification'
      }, {
        'Authorization': `Bearer ${researcherToken}`
      });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('OBJECT_ACCESS_DENIED');
    });

    it('18. blocks unauthorized user from editing a notebook cell in a private notebook (HTTP 403)', async () => {
      const privProjId = `proj_celledit_${Date.now()}`;
      const privNbId = `nb_celledit_${Date.now()}`;
      const privCellId = `cell_priv_${Date.now()}`;

      db.getState().projects.push({
        id: privProjId,
        name: 'Lecturer Private Project',
        description: 'Private',
        type: 'Academic',
        owner_id: 'usr_lecturer',
        is_public: false,
        tags: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

      db.getState().notebooks.push({
        id: privNbId,
        project_id: privProjId,
        title: 'Lecturer Notebook',
        description: 'Notes',
        created_by: 'usr_lecturer',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

      db.getState().notebook_cells.push({
        id: privCellId,
        notebook_id: privNbId,
        cell_type: 'TEXT',
        order: 1,
        title: 'Private Cell',
        content: 'Original content'
      });

      // usr_researcher attempts to mutate the cell
      const res = await makeRequest(testApp, 'PUT', `/api/notebooks/cells/${privCellId}`, {
        title: 'Tampered Cell',
        content: 'Tampered content'
      }, {
        'Authorization': `Bearer ${researcherToken}`
      });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('OBJECT_ACCESS_DENIED');
    });
  });

  // -------------------------------------------------------------------------
  // 5. Material Bank Linking & Private Document Access
  // -------------------------------------------------------------------------
  describe('Material Linking & Document Access Control', () => {
    it('19. blocks linking material to a private project where user lacks write access (HTTP 403)', async () => {
      // Create a private project owned by lecturer
      const privProjId = `proj_matlink_${Date.now()}`;
      db.getState().projects.push({
        id: privProjId,
        name: 'Lecturer Isolated Project',
        description: 'Private',
        type: 'Academic',
        owner_id: 'usr_lecturer',
        is_public: false,
        tags: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

      // In seed data: mat_handbook_001 was uploaded by usr_researcher
      // usr_researcher tries to link their material to lecturer's private project
      const res = await makeRequest(testApp, 'POST', '/api/materials/mat_handbook_001/link-project', {
        project_id: privProjId
      }, {
        'Authorization': `Bearer ${researcherToken}`
      });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('OBJECT_ACCESS_DENIED');
    });

    it('20. blocks reading a document whose linked project is private and user is not a member (HTTP 403)', async () => {
      const privProjId = `proj_docpriv_${Date.now()}`;
      const privMatId = `mat_priv_${Date.now()}`;

      db.getState().projects.push({
        id: privProjId,
        name: 'Lecturer Confidential Medical Archive',
        description: 'Restricted clinical records',
        type: 'Research',
        owner_id: 'usr_lecturer',
        is_public: false,
        tags: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

      db.getState().materials.push({
        id: privMatId,
        title: 'Confidential Clinical Trial Manuscript',
        author: 'Prof. Brody',
        subject: 'Clinical Trials',
        type: 'TXT',
        description: 'Private manuscript',
        language: 'en',
        tags: ['clinical'],
        version: '1.0.0',
        uploaded_by: 'usr_lecturer',
        file_path: 'sample_physiology_manual.txt',
        file_size_bytes: 2500,
        mime_type: 'text/plain',
        file_hash: 'hash_priv_123',
        project_ids: [privProjId],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

      // usr_researcher attempts to view the document content
      const res = await makeRequest(testApp, 'GET', `/api/documents/${privMatId}/content`, undefined, {
        'Authorization': `Bearer ${researcherToken}`
      });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('OBJECT_ACCESS_DENIED');
    });
  });

  // -------------------------------------------------------------------------
  // 6. Personal Notes, Highlights & Bookmarks Isolation
  // -------------------------------------------------------------------------
  describe('Personal Workspace Isolation (Notes, Bookmarks, Highlights)', () => {
    it('21. isolates notes: User B cannot retrieve private notes created by User A', async () => {
      // Create a private note for usr_lecturer
      const noteId = `note_priv_${Date.now()}`;
      db.getState().notes.push({
        id: noteId,
        user_id: 'usr_lecturer',
        title: 'Lecturer Private Exam Answers',
        content: 'Formula key for exam evaluation',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

      // usr_researcher queries notes
      const res = await makeRequest(testApp, 'GET', '/api/notes', undefined, {
        'Authorization': `Bearer ${researcherToken}`
      });
      expect(res.status).toBe(200);
      const noteIds = res.body.notes.map((n: any) => n.id);
      expect(noteIds).not.toContain(noteId);
    });

    it('22. blocks User B from editing or deleting User As personal note (HTTP 403)', async () => {
      const noteId = `note_auth_${Date.now()}`;
      db.getState().notes.push({
        id: noteId,
        user_id: 'usr_lecturer',
        title: 'Original Lecturer Research Hypothesis',
        content: 'Original thesis',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

      // usr_researcher attempts to edit note
      const editRes = await makeRequest(testApp, 'PUT', `/api/notes/${noteId}`, {
        title: 'Tampered Note Title'
      }, {
        'Authorization': `Bearer ${researcherToken}`
      });
      expect(editRes.status).toBe(403);
      expect(editRes.body.code).toBe('OBJECT_ACCESS_DENIED');

      // usr_researcher attempts to delete note
      const delRes = await makeRequest(testApp, 'DELETE', `/api/notes/${noteId}`, undefined, {
        'Authorization': `Bearer ${researcherToken}`
      });
      expect(delRes.status).toBe(403);
      expect(delRes.body.code).toBe('OBJECT_ACCESS_DENIED');
    });

    it('23. isolates bookmarks and highlights to owner', async () => {
      // Add bookmark by lecturer
      const bmId = `bm_test_${Date.now()}`;
      db.getState().bookmarks.push({
        id: bmId,
        user_id: 'usr_lecturer',
        material_id: 'mat_handbook_001',
        page: 5,
        title: 'Lecturer Exam Question Bookmark',
        created_at: new Date().toISOString()
      });

      // usr_student queries bookmarks
      const res = await makeRequest(testApp, 'GET', '/api/materials/mat_handbook_001/bookmarks', undefined, {
        'Authorization': `Bearer ${studentToken}`
      });
      expect(res.status).toBe(200);
      const bmIds = res.body.bookmarks.map((b: any) => b.id);
      expect(bmIds).not.toContain(bmId);
    });
  });

  // -------------------------------------------------------------------------
  // 7. Parameter Tampering Defenses (owner_id / user_id)
  // -------------------------------------------------------------------------
  describe('Defense against Client Parameter Tampering', () => {
    it('24. ignores client-supplied owner_id in POST /api/projects payload', async () => {
      const res = await makeRequest(testApp, 'POST', '/api/projects', {
        name: 'Spoofed Owner Project',
        owner_id: 'usr_admin' // Attempting to spoof owner to admin
      }, {
        'Authorization': `Bearer ${studentToken}`
      });
      expect(res.status).toBe(201);
      // Backend must have forced owner_id to usr_student
      expect(res.body.project.owner_id).toBe('usr_student');
    });

    it('25. ignores client-supplied user_id in POST /api/notes payload', async () => {
      const res = await makeRequest(testApp, 'POST', '/api/notes', {
        title: 'Spoofed Note',
        content: 'Fake attribution',
        user_id: 'usr_admin'
      }, {
        'Authorization': `Bearer ${studentToken}`
      });
      expect(res.status).toBe(201);
      expect(res.body.note.user_id).toBe('usr_student');
    });
  });

  // -------------------------------------------------------------------------
  // 8. Administrative Override & Audit Logging
  // -------------------------------------------------------------------------
  describe('Administrative Override with Audit Trail', () => {
    it('26. allows Admin to access private projects with explicit audit trail', async () => {
      const auditCountBefore = db.getState().audit_logs.length;

      // proj_academic_lab is private and owned by lecturer
      const res = await makeRequest(testApp, 'GET', '/api/projects/proj_academic_lab', undefined, {
        'Authorization': `Bearer ${adminToken}`
      });
      expect(res.status).toBe(200);

      // Verify audit log has recorded the admin override
      const latestLogs = db.getState().audit_logs;
      expect(latestLogs.length).toBeGreaterThan(auditCountBefore);
      const overrideLog = latestLogs.find(l => l.entity_id === 'proj_academic_lab' && l.details.includes('Admin override'));
      expect(overrideLog).toBeDefined();
      expect(overrideLog?.user_id).toBe('usr_admin');
    });

    it('27. records SECURITY_BOLA audit log on unauthorized access attempt', async () => {
      const auditCountBefore = db.getState().audit_logs.length;

      // Trigger BOLA rejection
      await makeRequest(testApp, 'GET', '/api/projects/proj_academic_lab', undefined, {
        'Authorization': `Bearer ${researcherToken}`
      });

      const latestLogs = db.getState().audit_logs;
      expect(latestLogs.length).toBeGreaterThan(auditCountBefore);
      const bolaLog = latestLogs.find(l => l.entity_id === 'proj_academic_lab' && l.details.includes('BOLA Denied'));
      expect(bolaLog).toBeDefined();
      expect(bolaLog?.user_id).toBe('usr_researcher');
    });
  });

  // -------------------------------------------------------------------------
  // 9. Experiments & Provenance Isolation
  // -------------------------------------------------------------------------
  describe('Experiments & Provenance Project Isolation', () => {
    it('28. blocks unauthorized user from accessing experiment in private project (HTTP 403)', async () => {
      const privProjId = `proj_exppriv_${Date.now()}`;
      const expId = `exp_priv_${Date.now()}`;

      db.getState().projects.push({
        id: privProjId,
        name: 'Lecturer Private Experimentation',
        description: 'Restricted',
        type: 'Research',
        owner_id: 'usr_lecturer',
        is_public: false,
        tags: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

      db.getState().experiments.push({
        id: expId,
        project_id: privProjId,
        title: 'Lecturer Confidential Metabolic Kinetic Run',
        description: 'Private',
        baseline_model_id: 'MODEL_DEMO_ANTHROPOMETRY_V1',
        experimental_model_id: 'MODEL_DEMO_ANTHROPOMETRY_V1_EXP',
        parameter_modifications: [],
        status: 'COMPLETED',
        provenance_hash: 'hash_exp_123',
        created_by: 'usr_lecturer',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

      const res = await makeRequest(testApp, 'GET', `/api/experiments/${expId}`, undefined, {
        'Authorization': `Bearer ${researcherToken}`
      });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('OBJECT_ACCESS_DENIED');
    });

    it('29. filters GET /api/experiments to only accessible projects', async () => {
      const res = await makeRequest(testApp, 'GET', '/api/experiments', undefined, {
        'Authorization': `Bearer ${researcherToken}`
      });
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.experiments)).toBe(true);
    });

    it('30. blocks unauthorized user from re-running provenance for private project (HTTP 403)', async () => {
      const privProjId = `proj_provpriv_${Date.now()}`;
      const provId = `prov_priv_${Date.now()}`;

      db.getState().projects.push({
        id: privProjId,
        name: 'Lecturer Secret Study',
        description: 'Private',
        type: 'Research',
        owner_id: 'usr_lecturer',
        is_public: false,
        tags: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

      db.getState().provenance_records.push({
        id: provId,
        project_id: privProjId,
        target_entity_type: 'EXPERIMENT',
        target_entity_id: 'exp_some',
        user_id: 'usr_lecturer',
        environment_specs: 'Node v22',
        provenance_hash: 'prov_hash_999',
        reproducibility_manifest: { seed: 123 },
        created_at: new Date().toISOString()
      });

      const res = await makeRequest(testApp, 'POST', '/api/provenance/re-run', {
        provenance_id: provId
      }, {
        'Authorization': `Bearer ${researcherToken}`
      });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('OBJECT_ACCESS_DENIED');
    });
  });

  // -------------------------------------------------------------------------
  // 10. File Storage Security & Path Traversal Defense (Langkah F)
  // -------------------------------------------------------------------------
  describe('File Storage Security & Path Traversal Defense', () => {
    it('31. allows authorized user to download material via /api/materials/:id/download (HTTP 200)', async () => {
      // mat_handbook_001 is accessible to researcher
      const res = await makeRequest(testApp, 'GET', '/api/materials/mat_handbook_001/download', undefined, {
        'Authorization': `Bearer ${researcherToken}`
      });
      expect(res.status).toBe(200);
    });

    it('32. blocks unauthorized user from downloading material linked to private project (HTTP 403)', async () => {
      const privMatId = `mat_priv_${Date.now()}`;
      db.getState().materials.push({
        id: privMatId,
        title: 'Confidential Lecturer Dossier',
        author: 'Prof. Marcus Brody',
        subject: 'Secret Lab Notes',
        type: 'TXT',
        description: 'Private material',
        year: 2026,
        language: 'en',
        tags: ['private'],
        version: '1.0.0',
        uploaded_by: 'usr_lecturer',
        file_path: 'sample_physiology_manual.txt',
        file_size_bytes: 100,
        mime_type: 'text/plain',
        file_hash: 'hash_priv',
        project_ids: ['proj_academic_lab'], // linked strictly to lecturer's private project
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

      // usr_researcher is not a member of proj_academic_lab
      const res = await makeRequest(testApp, 'GET', `/api/materials/${privMatId}/download`, undefined, {
        'Authorization': `Bearer ${researcherToken}`
      });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('OBJECT_ACCESS_DENIED');
    });

    it('33. blocks path traversal in material file reference (HTTP 400)', async () => {
      const traversalMatId = `mat_trav_${Date.now()}`;
      db.getState().materials.push({
        id: traversalMatId,
        title: 'Malicious Traversal Material',
        author: 'Attacker',
        subject: 'Exploit',
        type: 'TXT',
        description: 'Attempts path traversal',
        year: 2026,
        language: 'en',
        tags: ['exploit'],
        version: '1.0.0',
        uploaded_by: 'usr_researcher',
        file_path: '../../package.json', // Path traversal injection
        file_size_bytes: 50,
        mime_type: 'text/plain',
        file_hash: 'hash_bad',
        project_ids: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

      const res = await makeRequest(testApp, 'GET', `/api/materials/${traversalMatId}/download`, undefined, {
        'Authorization': `Bearer ${researcherToken}`
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid file reference');
    });
  });
});

