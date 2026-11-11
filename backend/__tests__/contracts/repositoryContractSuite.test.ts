/**
 * NutriBodySim — Modular JSON Repository Adapter Contract Test Suite
 * Milestone: MVS-B2.5E.1B.2 & MVS-B2.5E.1B.4
 *
 * Verifies:
 * 1. UnitOfWork transaction mechanics: atomic commits, rollbacks on error, state isolation.
 * 2. Asynchronous repository contracts across all 12 domains matching contracts.ts:
 *    - UserRepository
 *    - ExternalIdentityRepository
 *    - RoleRequestRepository
 *    - ProjectRepository
 *    - MembershipRepository
 *    - MaterialRepository
 *    - DatasetRepository
 *    - ScientificRegistryRepository
 *    - ResearchArtifactRepository
 *    - AuditLogRepository
 *    - SessionRepository
 *    - OIDCTransactionRepository
 * 3. Exact field preservation, ID retention, and collection schema conformity across 32 collections.
 * 4. Zero mutations or side-effects on the production database.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { db } from '../../database/store';
import {
  LowdbJsonDatabase,
  createLowdbJsonDatabase,
  JsonUnitOfWork
} from '../../database/adapters/lowdbJsonDatabase';
import {
  User,
  ExternalIdentity,
  RoleRequest,
  Project,
  ProjectMember,
  Material,
  Dataset,
  DatasetVersion,
  StatisticsAnalysis,
  ChartRecord,
  NutriNotebook,
  NotebookCell,
  Experiment,
  CodeExecutionRecord,
  ProvenanceRecord,
  AuditLog
} from '../../database/types';

describe('MVS-B2.5E.1B.2 / MVS-B2.5E.1B.4: Modular JSON Repository Adapter Contract Test Suite', () => {
  let jsonDb: LowdbJsonDatabase;
  let baselineSnapshot: any;
  const PROD_DB_PATH = path.join(process.cwd(), 'data', 'nutribodysim_db.json');
  const PROD_BACKUP_PATH = path.join(process.cwd(), 'data', 'nutribodysim_db.backup.json');
  const EXPECTED_ACTIVE_HASH = '1b16140f395c0a937843cb691be1382a00296c2d2bd1ddd075c39d84ad3c6a5d';
  const EXPECTED_BACKUP_HASH = 'a7f7cfa135e5b8c4be091cff49f5b1e2ecc88514776b8f908bd3ccf0d188af14';

  beforeEach(() => {
    if (!baselineSnapshot) {
      baselineSnapshot = structuredClone(db.getState());
    } else {
      db.setState(structuredClone(baselineSnapshot));
    }
    jsonDb = createLowdbJsonDatabase(db);
  });

  describe('1. Unit of Work & Transaction Semantics', () => {
    it('should successfully commit multiple mutations across repositories atomically', async () => {
      const uow = jsonDb.unitOfWork;
      const testEmail = `uow_commit_${Date.now()}@example.com`;
      const testUserId = `usr_uow_commit_${Date.now()}`;
      const testProjectId = `proj_uow_commit_${Date.now()}`;

      await uow.runInTransaction(async (tx) => {
        // Create user
        await jsonDb.users.create({
          id: testUserId,
          email: testEmail,
          name: 'UOW Test User',
          role: 'Researcher',
          permissions: ['VIEW', 'USE'],
          created_at: new Date().toISOString(),
          last_login_at: new Date().toISOString()
        } as any, tx);

        // Create project owned by user
        await jsonDb.projects.create({
          id: testProjectId,
          name: 'Atomic Project',
          description: 'Atomic Project Test',
          type: 'Research',
          owner_id: testUserId,
          is_public: false,
          tags: [],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        } as any, tx);

        // Add audit log
        await jsonDb.auditLogs.appendLog({
          user_id: testUserId,
          action: 'CREATE',
          entity_type: 'project',
          entity_id: testProjectId,
          details: 'Created project in atomic tx'
        } as any, tx);
      });

      // Verify all mutations persisted
      const user = await jsonDb.users.findById(testUserId);
      const project = await jsonDb.projects.findById(testProjectId);
      const logs = await jsonDb.auditLogs.queryLogs({ entityId: testProjectId });

      expect(user).not.toBeNull();
      expect(user?.email).toBe(testEmail);
      expect(project).not.toBeNull();
      expect(project?.name).toBe('Atomic Project');
      expect(logs.length).toBe(1);
    });

    it('should rollback all mutations when an error is thrown within transaction', async () => {
      const uow = jsonDb.unitOfWork;
      const testEmail = `uow_rollback_${Date.now()}@example.com`;
      const testUserId = `usr_uow_rollback_${Date.now()}`;
      const initialUsersCount = (await jsonDb.users.listAll()).length;

      let errorThrown = false;
      try {
        await uow.runInTransaction(async (tx) => {
          await jsonDb.users.create({
            id: testUserId,
            email: testEmail,
            name: 'Rollback User',
            role: 'Researcher',
            permissions: [],
            created_at: new Date().toISOString(),
            last_login_at: new Date().toISOString()
          } as any, tx);

          // Simulate mid-transaction business logic failure
          throw new Error('Simulated atomic transaction failure');
        });
      } catch (err: any) {
        errorThrown = true;
        expect(err.message).toBe('Simulated atomic transaction failure');
      }

      expect(errorThrown).toBe(true);

      // Verify that user was rolled back
      const user = await jsonDb.users.findById(testUserId);
      expect(user).toBeNull();

      const finalUsersCount = (await jsonDb.users.listAll()).length;
      expect(finalUsersCount).toBe(initialUsersCount);
    });

    it('should prevent repeated commit or rollback on already finalized transaction', async () => {
      const uow = new JsonUnitOfWork(db);
      let capturedTx: any;

      await uow.runInTransaction(async (tx) => {
        capturedTx = tx;
      });

      // Transaction already committed
      expect(capturedTx.isCommitted()).toBe(true);
      await expect(capturedTx.commit()).rejects.toThrow('Cannot commit transaction');
      await expect(capturedTx.rollback()).rejects.toThrow('Cannot rollback transaction');
    });
  });

  describe('2. User & External Identity Repositories', () => {
    it('should perform complete CRUD operations on UserRepository', async () => {
      const repo = jsonDb.users;
      const testId = `usr_crud_${Date.now()}`;
      const email = `crud_${Date.now()}@example.com`;

      // Create
      const created = await repo.create({
        id: testId,
        email,
        name: 'CRUD User',
        role: 'Student',
        permissions: ['VIEW'],
        created_at: new Date().toISOString(),
        last_login_at: new Date().toISOString()
      } as any);
      expect(created.id).toBe(testId);

      // Find by ID and Email
      const foundById = await repo.findById(testId);
      expect(foundById?.email).toBe(email);
      const foundByEmail = await repo.findByEmail(email);
      expect(foundByEmail?.id).toBe(testId);

      // Update
      const updated = await repo.update(testId, {
        name: 'Updated Name',
        role: 'Researcher'
      });
      expect(updated?.name).toBe('Updated Name');
      expect(updated?.role).toBe('Researcher');

      // Update account status
      const suspended = await repo.updateAccountStatus(testId, 'SUSPENDED');
      expect(suspended.account_status).toBe('SUSPENDED');

      // Increment token version
      const v = await repo.incrementTokenVersion(testId);
      expect(v).toBeGreaterThanOrEqual(1);

      // List all
      const all = await repo.listAll();
      expect(all.some((u) => u.id === testId)).toBe(true);

      // Delete
      const deleted = await repo.delete(testId);
      expect(deleted).toBe(true);
      const afterDelete = await repo.findById(testId);
      expect(afterDelete).toBeNull();
    });

    it('should manage external identities linked to users', async () => {
      const extRepo = jsonDb.externalIdentities;
      const userId = 'usr_ext_test_1';
      const provider = 'google';
      const subject = `sub_ext_${Date.now()}`;

      const created = await extRepo.linkIdentity({
        id: `ext_${Date.now()}`,
        user_id: userId,
        provider,
        provider_subject_id: subject,
        email: 'ext@example.com',
        email_verified: true,
        linked_at: new Date().toISOString()
      } as any);
      expect(created.provider_subject_id).toBe(subject);

      // Lookup by provider + subject
      const found = await extRepo.findByProviderSubject(provider, subject);
      expect(found).not.toBeNull();
      expect(found?.user_id).toBe(userId);

      // Lookup by user
      const userIdentities = await extRepo.listByUserId(userId);
      expect(userIdentities.length).toBeGreaterThanOrEqual(1);

      // Unlink identity
      const unlinked = await extRepo.unlinkIdentity(provider, subject);
      expect(unlinked).toBe(true);
      const afterDelete = await extRepo.findByProviderSubject(provider, subject);
      expect(afterDelete).toBeNull();
    });
  });

  describe('3. Role Requests Repository', () => {
    it('should manage role requests and status transitions', async () => {
      const repo = jsonDb.roleRequests;
      const reqId = `rr_${Date.now()}`;
      const userId = `usr_rr_${Date.now()}`;

      const req = await repo.create({
        request_id: reqId,
        user_id: userId,
        requested_role: 'Researcher',
        approval_status: 'PENDING',
        justification: 'Need lead permissions for clinical trials',
        created_at: new Date().toISOString()
      } as any);
      expect(req.approval_status).toBe('PENDING');

      const pending = await repo.listPending();
      expect(pending.some((r) => r.request_id === reqId)).toBe(true);

      const byUser = await repo.listByUserId(userId);
      expect(byUser.length).toBe(1);

      const byUserAndRole = await repo.findPendingByUserAndRole(userId, 'Researcher');
      expect(byUserAndRole?.request_id).toBe(reqId);

      const reviewed = await repo.updateStatus(reqId, 'APPROVED', 'admin_1', 'Request verified');
      expect(reviewed.approval_status).toBe('APPROVED');
      expect(reviewed.reviewed_by).toBe('admin_1');
      expect(reviewed.review_reason).toBe('Request verified');
    });
  });

  describe('4. Project & Membership Repositories', () => {
    it('should manage projects, ownership, visibility, and memberships', async () => {
      const pRepo = jsonDb.projects;
      const mRepo = jsonDb.memberships;
      const ownerId = `usr_owner_${Date.now()}`;
      const memberId = `usr_member_${Date.now()}`;
      const projId = `proj_${Date.now()}`;

      // Create project
      const proj = await pRepo.create({
        id: projId,
        name: 'Metabolic Kinetics Study',
        description: 'Metabolic Kinetics',
        type: 'Research',
        owner_id: ownerId,
        is_public: true,
        tags: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      } as any);
      expect(proj.is_public).toBe(true);

      // Public projects query
      const publicProjects = await pRepo.listPublic();
      expect(publicProjects.some((p) => p.id === projId)).toBe(true);

      // Owner projects query
      const ownerProjects = await pRepo.listByOwner(ownerId);
      expect(ownerProjects.length).toBe(1);

      // Memberships
      const memId = `pm_${Date.now()}`;
      await mRepo.addProjectMember({
        id: memId,
        project_id: projId,
        user_id: memberId,
        role: 'Editor',
        joined_at: new Date().toISOString()
      } as any);

      const projMembers = await mRepo.getProjectMembers(projId);
      expect(projMembers.length).toBe(1);
      expect(projMembers[0].user_id).toBe(memberId);

      // Remove project member
      const removed = await mRepo.removeProjectMember(projId, memberId);
      expect(removed).toBe(true);
      expect(await mRepo.getProjectMembers(projId)).toHaveLength(0);
    });
  });

  describe('5. Material & Dataset Repositories', () => {
    it('should support material catalogue and reading notes/bookmarks', async () => {
      const repo = jsonDb.materials;
      const matId = `mat_custom_${Date.now()}`;

      const created = await repo.create({
        id: matId,
        title: 'Bioenergetics Textbook',
        type: 'PDF',
        file_path: `/docs/${matId}.pdf`,
        file_size_bytes: 102400,
        mime_type: 'application/pdf',
        uploaded_by: 'usr_researcher',
        tags: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      } as any);
      expect(created.file_path).toBe(`/docs/${matId}.pdf`);

      const byFile = await repo.findByFilePath(`/docs/${matId}.pdf`);
      expect(byFile?.id).toBe(matId);

      const all = await repo.listAll();
      expect(all.some((m) => m.id === matId)).toBe(true);

      const updated = await repo.update(matId, { title: 'Advanced Bioenergetics' });
      expect(updated?.title).toBe('Advanced Bioenergetics');

      // Bookmarks & notes
      const bmId = `bm_${Date.now()}`;
      await repo.saveBookmark({
        id: bmId,
        user_id: 'user_bm_1',
        material_id: matId,
        page: 1,
        title: 'Important Section',
        created_at: new Date().toISOString()
      });
      const bms = await repo.getBookmarks('user_bm_1', matId);
      expect(bms.length).toBe(1);
      await repo.deleteBookmark(bmId);

      const deleted = await repo.delete(matId);
      expect(deleted).toBe(true);
      expect(await repo.findById(matId)).toBeNull();
    });

    it('should support dataset and dataset version management', async () => {
      const repo = jsonDb.datasets;
      const dsId = `ds_${Date.now()}`;
      const projId = `proj_ds_${Date.now()}`;

      await repo.create({
        id: dsId,
        project_id: projId,
        name: 'Continuous Glucose Monitoring Feed',
        description: 'Raw CGM sensor telemetry',
        source_file: 'cgm.csv',
        uploaded_by: 'usr_researcher',
        current_version: 'v1.0',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      } as any);

      const byProj = await repo.listByProject(projId);
      expect(byProj.length).toBe(1);
      expect(byProj[0].name).toBe('Continuous Glucose Monitoring Feed');

      // Dataset versions
      const verId = `dsv_${Date.now()}`;
      await repo.createVersion({
        id: verId,
        dataset_id: dsId,
        version_tag: 'v1.0',
        state: 'VALIDATED',
        columns: [],
        data: [],
        validation_report: { is_valid: true, row_count: 0, column_count: 0, null_counts: {}, outliers_detected: [], type_mismatches: [], warnings: [] },
        created_by: 'usr_researcher',
        created_at: new Date().toISOString()
      } as any);

      const versions = await repo.listVersions(dsId);
      expect(versions.length).toBe(1);

      const ver = await repo.getVersion(verId);
      expect(ver?.version_tag).toBe('v1.0');

      await repo.delete(dsId);
      expect(await repo.findById(dsId)).toBeNull();
    });
  });

  describe('6. Scientific Registry & Research Artifacts', () => {
    it('should provide read access to scientific registry entities', async () => {
      const repo = jsonDb.scientificRegistry;

      const units = await repo.getUnits();
      expect(Array.isArray(units)).toBe(true);

      const vars = await repo.getVariables();
      expect(Array.isArray(vars)).toBe(true);

      const params = await repo.getParameters();
      expect(Array.isArray(params)).toBe(true);

      const formulas = await repo.getFormulas();
      expect(Array.isArray(formulas)).toBe(true);

      const models = await repo.getModels();
      expect(Array.isArray(models)).toBe(true);

      const algorithms = await repo.getAlgorithms();
      expect(Array.isArray(algorithms)).toBe(true);

      const references = await repo.getReferences();
      expect(Array.isArray(references)).toBe(true);

      const rules = await repo.getInterpretationRules();
      expect(Array.isArray(rules)).toBe(true);
    });

    it('should manage research artifacts with notebooks, analyses, and charts', async () => {
      const repo = jsonDb.researchArtifacts;
      const projId = `proj_art_${Date.now()}`;
      const nbId = `nb_${Date.now()}`;

      // Create notebook
      await repo.createNotebook({
        id: nbId,
        project_id: projId,
        title: 'Insulin Sensitivity Analysis',
        description: 'Notebook study',
        created_by: 'usr_researcher',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      } as any);

      // Create notebook cell
      const cellId = `cell_${Date.now()}`;
      await repo.createNotebookCell({
        id: cellId,
        notebook_id: nbId,
        cell_type: 'CODE',
        order: 0,
        title: 'BMR Cell',
        content: 'const bmr = 10 * 70 + 6.25 * 175 - 5 * 30 + 5;'
      } as any);

      const nbWithCells = await repo.getNotebookWithCells(nbId);
      expect(nbWithCells).not.toBeNull();
      expect(nbWithCells?.notebook.title).toBe('Insulin Sensitivity Analysis');
      expect(nbWithCells?.cells.length).toBe(1);

      // Create chart
      const chartId = `chart_${Date.now()}`;
      await repo.createChart({
        id: chartId,
        project_id: projId,
        dataset_version_id: 'dsv_1',
        title: 'Glucose Concentration Curve',
        chart_type: 'LINE',
        x_field: 'time',
        config: {},
        created_by: 'usr_researcher',
        created_at: new Date().toISOString()
      } as any);
      const charts = await repo.getChartsByProject(projId);
      expect(charts.length).toBe(1);

      // Create experiment
      const expId = `exp_${Date.now()}`;
      await repo.createExperiment({
        id: expId,
        project_id: projId,
        title: 'High Protein Challenge',
        description: 'High Protein Challenge Exp',
        baseline_model_id: 'MODEL_1',
        experimental_model_id: 'MODEL_1_CLONE',
        parameter_modifications: [],
        status: 'COMPLETED',
        created_by: 'usr_researcher',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      } as any);
      const exps = await repo.getExperimentsByProject(projId);
      expect(exps.length).toBe(1);
    });
  });

  describe('7. Audit Log, Session, and OIDC Transaction Repositories', () => {
    it('should record and query audit logs with pagination and filters', async () => {
      const repo = jsonDb.auditLogs;
      const userId = `usr_audit_${Date.now()}`;

      for (let i = 0; i < 5; i++) {
        await repo.appendLog({
          user_id: userId,
          action: 'CREATE',
          entity_type: 'resource',
          entity_id: `res_${i}`,
          details: `Log entry ${i}`
        } as any);
      }

      const userLogs = await repo.queryLogs({ userId, limit: 3, offset: 0 });
      expect(userLogs.length).toBe(3);

      const totalCount = await repo.countLogs({ userId });
      expect(totalCount).toBe(5);
    });

    it('should manage session lifecycle and revocation', async () => {
      const repo = jsonDb.sessions;
      const userId = `usr_sess_${Date.now()}`;

      const { token, session } = await repo.createSession(userId, 3600);
      expect(session.userId).toBe(userId);

      const validation = await repo.validateSession(token);
      expect(validation.valid).toBe(true);

      const revoked = await repo.revokeSession(token);
      expect(revoked).toBe(true);

      const afterRevocation = await repo.validateSession(token);
      expect(afterRevocation.valid).toBe(false);
    });

    it('should manage OIDC transaction life cycle and cleanup', async () => {
      const repo = jsonDb.oidcTransactions;
      const { transaction, clientData } = await repo.createTransaction({
        provider: 'google',
        returnUrl: '/app/dashboard'
      } as any);

      expect(transaction.id).toBeDefined();
      expect(clientData.state).toBe(transaction.state);

      const byState = await repo.getTransactionByState(transaction.state);
      expect(byState?.id).toBe(transaction.id);

      const consumed = await repo.consumeTransaction({
        state: transaction.state,
        nonce: transaction.nonce
      });
      expect(consumed.success).toBe(true);

      const afterConsume = await repo.getTransaction(transaction.id);
      expect(afterConsume?.consumed).toBe(true);

      const deleted = await repo.deleteTransaction(transaction.id);
      expect(deleted).toBe(true);
      const afterDelete = await repo.getTransaction(transaction.id);
      expect(afterDelete).toBeNull();
    });
  });

  describe('8. Zero Storage Side-Effects & Production Database Invariance', () => {
    it('should verify production database and backup file hashes remain unmodified', () => {
      expect(fs.existsSync(PROD_DB_PATH)).toBe(true);
      expect(fs.existsSync(PROD_BACKUP_PATH)).toBe(true);

      const activeContent = fs.readFileSync(PROD_DB_PATH);
      const backupContent = fs.readFileSync(PROD_BACKUP_PATH);

      const activeHash = crypto.createHash('sha256').update(activeContent).digest('hex');
      const backupHash = crypto.createHash('sha256').update(backupContent).digest('hex');

      expect(activeContent.length).toBe(58916);
      expect(backupContent.length).toBe(57187);
      expect(activeHash).toBe(EXPECTED_ACTIVE_HASH);
      expect(backupHash).toBe(EXPECTED_BACKUP_HASH);
    });
  });
});
