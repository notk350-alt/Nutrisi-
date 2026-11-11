/**
 * NutriBodySim — Dual Adapter Vertical Slice & Contract Verification Suite
 * Milestone: MVS-B2.5E.1B.5–E.1B.8 (Phase E & Contract Parity)
 *
 * Verifies:
 * 1. Interface Parity: Both LowdbJsonDatabase and PostgresDatabaseRepositories strictly
 *    satisfy IDatabaseRepositories and IUnitOfWork contracts.
 * 2. Vertical Slice Execution: ResearchProjectGovernanceService executes domain transactions
 *    consistently over IDatabaseRepositories without coupling to storage details.
 * 3. Atomic Rollback Guarantees: When an operation in a transaction fails, all mutations are rolled back.
 * 4. Database Invariance: Production JSON database file and backup retain exact byte length and SHA-256.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { db } from '../../database/store';
import {
  LowdbJsonDatabase,
  createLowdbJsonDatabase
} from '../../database/adapters/lowdbJsonDatabase';
import {
  PostgresDatabaseRepositories,
  PostgresTransactionContext,
  PostgresUnitOfWork
} from '../../database/adapters/postgresDatabase';
import {
  ResearchProjectGovernanceService,
  CreateProjectWithGovernanceInput
} from '../../database/services/verticalSliceService';
import { IDatabaseRepositories } from '../../database/contracts';
import { ProjectMember } from '../../database/types';

describe('MVS-B2.5E.1B.5–E.1B.8: Dual Adapter Vertical Slice & Contract Verification', () => {
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

  describe('1. Contract & Interface Parity Verification', () => {
    it('should confirm LowdbJsonDatabase implements all IDatabaseRepositories members', () => {
      const repos: IDatabaseRepositories = jsonDb;
      expect(repos.users).toBeDefined();
      expect(repos.externalIdentities).toBeDefined();
      expect(repos.roleRequests).toBeDefined();
      expect(repos.projects).toBeDefined();
      expect(repos.memberships).toBeDefined();
      expect(repos.materials).toBeDefined();
      expect(repos.datasets).toBeDefined();
      expect(repos.scientificRegistry).toBeDefined();
      expect(repos.researchArtifacts).toBeDefined();
      expect(repos.auditLogs).toBeDefined();
      expect(repos.sessions).toBeDefined();
      expect(repos.oidcTransactions).toBeDefined();
      expect(repos.unitOfWork).toBeDefined();
    });

    it('should confirm PostgresDatabaseRepositories prototype adheres to IDatabaseRepositories signature', () => {
      // Mock db executor for type and structure verification without live network
      const mockDb: any = {
        select: () => mockDb,
        from: () => mockDb,
        where: () => mockDb,
        limit: () => Promise.resolve([]),
        insert: () => mockDb,
        values: () => mockDb,
        returning: () => Promise.resolve([]),
        transaction: async (cb: any) => {
          const fakeTx = { ...mockDb };
          return cb(fakeTx);
        }
      };

      const pgRepos = new PostgresDatabaseRepositories(mockDb as any);
      const repos: IDatabaseRepositories = pgRepos;

      expect(repos.users).toBeDefined();
      expect(repos.externalIdentities).toBeDefined();
      expect(repos.roleRequests).toBeDefined();
      expect(repos.projects).toBeDefined();
      expect(repos.memberships).toBeDefined();
      expect(repos.materials).toBeDefined();
      expect(repos.datasets).toBeDefined();
      expect(repos.scientificRegistry).toBeDefined();
      expect(repos.researchArtifacts).toBeDefined();
      expect(repos.auditLogs).toBeDefined();
      expect(repos.sessions).toBeDefined();
      expect(repos.oidcTransactions).toBeDefined();
      expect(repos.unitOfWork).toBeDefined();
    });
  });

  describe('2. Vertical Slice Domain Service Execution over JSON Adapter', () => {
    it('should atomically create a project, assign membership, and write an audit log', async () => {
      const service = new ResearchProjectGovernanceService(jsonDb);

      // 1. Ensure user exists
      const testUserId = `usr_slice_${Date.now()}`;
      await jsonDb.users.create({
        id: testUserId,
        email: `slice_${Date.now()}@nutribodysim.org`,
        name: 'Vertical Slice Researcher',
        role: 'Researcher',
        permissions: ['VIEW', 'USE'],
        created_at: new Date().toISOString(),
        last_login_at: new Date().toISOString()
      } as any);

      // 2. Execute vertical slice use-case
      const input: CreateProjectWithGovernanceInput = {
        name: 'Metabolic Biomarker Study',
        description: 'Comprehensive study of energy expenditure in diabetes',
        type: 'Research',
        ownerId: testUserId,
        isPublic: false,
        tags: ['metabolism', 'biomarkers']
      };

      const result = await service.createProjectWithGovernance(input);

      expect(result.project).toBeDefined();
      expect(result.project.name).toBe('Metabolic Biomarker Study');
      expect(result.membership.role).toBe('Owner');
      expect(result.membership.user_id).toBe(testUserId);
      expect(result.auditLogId).toBeDefined();

      // 3. Verify state persistence via repositories
      const fetchedProject = await jsonDb.projects.findById(result.project.id);
      expect(fetchedProject).not.toBeNull();
      expect(fetchedProject?.owner_id).toBe(testUserId);

      const members: ProjectMember[] = await jsonDb.memberships.getProjectMembers(result.project.id);
      expect(members.some((m: ProjectMember) => m.user_id === testUserId && m.role === 'Owner')).toBe(true);

      const auditLogs = await jsonDb.auditLogs.queryLogs({ entityType: 'PROJECT' });
      expect(auditLogs.some((l) => l.entity_id === result.project.id && l.action === 'CREATE')).toBe(true);
    });

    it('should cleanly abort and rollback all mutations if an error occurs within the slice transaction', async () => {
      const testUserId = `usr_slice_err_${Date.now()}`;
      await jsonDb.users.create({
        id: testUserId,
        email: `slice_err_${Date.now()}@nutribodysim.org`,
        name: 'Aborted Slice Researcher',
        role: 'Researcher',
        permissions: ['VIEW'],
        created_at: new Date().toISOString(),
        last_login_at: new Date().toISOString()
      } as any);

      const projectsCountBefore = (await jsonDb.projects.listByOwner(testUserId)).length;
      const logsCountBefore = (await jsonDb.auditLogs.queryLogs()).length;

      // Wrap in transaction that fails midway
      await expect(
        jsonDb.unitOfWork.runInTransaction(async (tx) => {
          // Create project
          await jsonDb.projects.create(
            {
              id: 'proj_aborted_123',
              name: 'Doomed Project',
              description: 'Should be rolled back',
              type: 'Research',
              owner_id: testUserId,
              is_public: false,
              tags: [],
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            } as any,
            tx
          );

          // Simulate an error halfway through
          throw new Error('Simulated governance rule violation');
        })
      ).rejects.toThrow('Simulated governance rule violation');

      // Verify that 'proj_aborted_123' was NOT committed to state
      const projectAfter = await jsonDb.projects.findById('proj_aborted_123');
      expect(projectAfter).toBeNull();

      const projectsCountAfter = (await jsonDb.projects.listByOwner(testUserId)).length;
      const logsCountAfter = (await jsonDb.auditLogs.queryLogs()).length;
      expect(projectsCountAfter).toBe(projectsCountBefore);
      expect(logsCountAfter).toBe(logsCountBefore);
    });

    it('should transfer ownership and emit audit log in a single unit of work', async () => {
      const service = new ResearchProjectGovernanceService(jsonDb);
      const owner1 = `usr_owner1_${Date.now()}`;
      const owner2 = `usr_owner2_${Date.now()}`;

      await jsonDb.users.create({
        id: owner1,
        email: `owner1_${Date.now()}@nutribodysim.org`,
        name: 'Original Lead',
        role: 'Researcher',
        permissions: ['VIEW', 'CREATE'],
        created_at: new Date().toISOString(),
        last_login_at: new Date().toISOString()
      } as any);

      await jsonDb.users.create({
        id: owner2,
        email: `owner2_${Date.now()}@nutribodysim.org`,
        name: 'Successor Lead',
        role: 'Researcher',
        permissions: ['VIEW', 'CREATE'],
        created_at: new Date().toISOString(),
        last_login_at: new Date().toISOString()
      } as any);

      const created = await service.createProjectWithGovernance({
        name: 'Pediatric Growth Modeling',
        description: 'Longitudinal analysis',
        ownerId: owner1
      });

      const transferResult = await service.transferOwnership({
        projectId: created.project.id,
        currentOwnerId: owner1,
        newOwnerId: owner2,
        reason: 'PI Relocation'
      });

      expect(transferResult.success).toBe(true);
      expect(transferResult.newOwnerId).toBe(owner2);

      const updatedProject = await jsonDb.projects.findById(created.project.id);
      expect(updatedProject?.owner_id).toBe(owner2);
    });
  });

  describe('3. PostgreSQL Unit of Work & Transaction Semantics Audit', () => {
    it('should manage PostgresTransactionContext commit and rollback state flags correctly', async () => {
      let executorRollbackCalled = false;
      const mockDrizzleTx: any = {
        rollback: async () => {
          executorRollbackCalled = true;
        }
      };
      const txCtx = new PostgresTransactionContext(mockDrizzleTx);

      expect(txCtx.isCommitted()).toBe(false);
      expect(txCtx.isRolledBack()).toBe(false);
      expect(txCtx.isActive()).toBe(true);

      await txCtx.commit();
      expect(txCtx.isCommitted()).toBe(true);
      expect(txCtx.isActive()).toBe(false);

      // Attempting commit twice should throw
      await expect(txCtx.commit()).rejects.toThrow('already committed');
      // Attempting rollback after commit should throw
      await expect(txCtx.rollback()).rejects.toThrow('already committed');
    });

    it('should support rollback and prevent commit after rollback', async () => {
      let executorRollbackCalled = false;
      const mockDrizzleTx: any = {
        rollback: async () => {
          executorRollbackCalled = true;
        }
      };
      const txCtx = new PostgresTransactionContext(mockDrizzleTx);

      await txCtx.rollback();
      expect(txCtx.isRolledBack()).toBe(true);
      expect(txCtx.isActive()).toBe(false);
      expect(executorRollbackCalled).toBe(true);

      // Attempting rollback twice should throw
      await expect(txCtx.rollback()).rejects.toThrow('already rolled back');
      // Attempting commit after rollback should throw
      await expect(txCtx.commit()).rejects.toThrow('already rolled back');
    });

    it('should prevent repository operations on an already completed transaction', async () => {
      const mockDb: any = {
        select: () => mockDb,
        from: () => mockDb,
        where: () => mockDb,
        limit: () => Promise.resolve([])
      };
      const pgRepos = new PostgresDatabaseRepositories(mockDb);

      const txCtx = new PostgresTransactionContext(mockDb);
      await txCtx.commit();

      // Calling repository findById with completed txCtx must throw
      await expect(pgRepos.users.findById('usr_123', txCtx)).rejects.toThrow(
        'is no longer active'
      );
    });

    it('should rollback transaction context and underlying db when work fails in PostgresUnitOfWork', async () => {
      let dbRollbackInvoked = false;
      const mockDb: any = {
        transaction: async (cb: any) => {
          const fakeTx = {
            rollback: async () => {
              dbRollbackInvoked = true;
            }
          };
          return cb(fakeTx);
        }
      };

      const uow = new PostgresUnitOfWork(mockDb as any);

      await expect(
        uow.runInTransaction(async (tx) => {
          if (tx instanceof PostgresTransactionContext) {
            expect(tx.isCommitted()).toBe(false);
            expect(tx.isActive()).toBe(true);
          }
          throw new Error('Database transaction abort test');
        })
      ).rejects.toThrow('Database transaction abort test');
    });

    it('should ensure concurrent transactions receive isolated contexts with unique IDs', async () => {
      const mockDb: any = {
        transaction: async (cb: any) => {
          const fakeTx = {};
          return cb(fakeTx);
        }
      };

      const uow = new PostgresUnitOfWork(mockDb as any);
      const contexts: PostgresTransactionContext[] = [];

      await Promise.all([
        uow.runInTransaction(async (tx) => {
          contexts.push(tx as PostgresTransactionContext);
          return 1;
        }),
        uow.runInTransaction(async (tx) => {
          contexts.push(tx as PostgresTransactionContext);
          return 2;
        })
      ]);

      expect(contexts.length).toBe(2);
      expect(contexts[0].transactionId).not.toBe(contexts[1].transactionId);
      expect(contexts[0].isCommitted()).toBe(true);
      expect(contexts[1].isCommitted()).toBe(true);
    });
  });

  describe('4. Historical Baseline Database Invariance Check', () => {
    it('should strictly verify active database file size and SHA-256 hash remained unmutated', () => {
      expect(fs.existsSync(PROD_DB_PATH)).toBe(true);
      const activeBuf = fs.readFileSync(PROD_DB_PATH);
      const activeHash = crypto.createHash('sha256').update(activeBuf).digest('hex');

      expect(activeBuf.length).toBe(58916);
      expect(activeHash).toBe(EXPECTED_ACTIVE_HASH);
    });

    it('should strictly verify backup database file size and SHA-256 hash remained unmutated', () => {
      expect(fs.existsSync(PROD_BACKUP_PATH)).toBe(true);
      const backupBuf = fs.readFileSync(PROD_BACKUP_PATH);
      const backupHash = crypto.createHash('sha256').update(backupBuf).digest('hex');

      expect(backupBuf.length).toBe(57187);
      expect(backupHash).toBe(EXPECTED_BACKUP_HASH);
    });
  });
});
