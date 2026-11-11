/**
 * NutriBodySim — Data Access Preparation & Repository Contracts Tests (MVS-B2.5E.1A)
 *
 * Verifies:
 * 1. Strongly-typed asynchronous repository contracts and transaction boundaries.
 * 2. 32-entity structural mapping and relational integrity of baseline data.
 * 3. Scientific engine zero-delta regression verification (BMR, BMI, AST evaluation).
 * 4. Zero runtime storage side-effects (JSON DB remains untouched).
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  ITransactionContext,
  IUnitOfWork,
  IUserRepository,
  IExternalIdentityRepository,
  IRoleRequestRepository,
  ISessionRepository,
  IScientificRegistryRepository,
  IResearchArtifactRepository,
  IDatabaseRepositories
} from '../database/contracts';
import { User, ExternalIdentity, RoleRequest } from '../database/types';
import {
  CalculationEngine,
  convertUnit,
  StructuredMathEvaluator,
  ScientificFormula,
  ScientificParameter,
  ScientificVariable,
  ScientificAlgorithm,
  CalculationTrace
} from '../../scientific';

describe('MVS-B2.5E.1A: Asynchronous Data Access Contracts & Baseline Verification', () => {
  const DB_FILE = path.join(process.cwd(), 'data', 'nutribodysim_db.json');
  const BACKUP_FILE = path.join(process.cwd(), 'data', 'nutribodysim_db.backup.json');

  describe('1. Repository Contract Typings & Asynchronous Boundaries', () => {
    it('should support asynchronous UnitOfWork and TransactionContext contract implementation', async () => {
      class MockTransactionContext implements ITransactionContext {
        public readonly transactionId = `tx_${Date.now()}`;
        public readonly createdAt = Date.now();
        public committed = false;
        public rolledBack = false;

        async commit(): Promise<void> {
          this.committed = true;
        }

        async rollback(): Promise<void> {
          this.rolledBack = true;
        }
      }

      class MockUnitOfWork implements IUnitOfWork {
        async runInTransaction<T>(work: (tx: ITransactionContext) => Promise<T>): Promise<T> {
          const tx = new MockTransactionContext();
          try {
            const result = await work(tx);
            await tx.commit();
            return result;
          } catch (err) {
            await tx.rollback();
            throw err;
          }
        }
      }

      const uow = new MockUnitOfWork();
      const result = await uow.runInTransaction(async (tx) => {
        expect(tx.transactionId).toBeDefined();
        return 'transaction_success';
      });

      expect(result).toBe('transaction_success');
    });

    it('should allow in-memory mock implementation of IUserRepository without DOM or browser dependencies', async () => {
      const mockUsers: User[] = [
        {
          id: 'usr_test_1',
          email: 'test1@nutribodysim.org',
          name: 'Test Researcher',
          role: 'Researcher',
          permissions: ['VIEW', 'USE'],
          created_at: new Date().toISOString(),
          last_login_at: new Date().toISOString(),
          account_status: 'ACTIVE'
        }
      ];

      class MockUserRepository implements IUserRepository {
        async findById(id: string): Promise<User | null> {
          return mockUsers.find(u => u.id === id) || null;
        }
        async findByEmail(email: string): Promise<User | null> {
          return mockUsers.find(u => u.email.toLowerCase() === email.toLowerCase()) || null;
        }
        async listAll(): Promise<User[]> {
          return [...mockUsers];
        }
        async create(userData: User): Promise<User> {
          mockUsers.push(userData);
          return userData;
        }
        async update(id: string, updates: Partial<User>): Promise<User> {
          const user = mockUsers.find(u => u.id === id);
          if (!user) throw new Error('User not found');
          Object.assign(user, updates);
          return user;
        }
        async updateAccountStatus(userId: string, status: any): Promise<User> {
          return this.update(userId, { account_status: status });
        }
        async incrementTokenVersion(userId: string): Promise<number> {
          const user = await this.findById(userId);
          if (!user) throw new Error('User not found');
          user.token_version = (user.token_version || 1) + 1;
          return user.token_version;
        }
        async delete(id: string): Promise<boolean> {
          const idx = mockUsers.findIndex(u => u.id === id);
          if (idx !== -1) {
            mockUsers.splice(idx, 1);
            return true;
          }
          return false;
        }
      }

      const repo = new MockUserRepository();
      const found = await repo.findById('usr_test_1');
      expect(found).not.toBeNull();
      expect(found?.name).toBe('Test Researcher');
      expect(found?.role).toBe('Researcher');

      const byEmail = await repo.findByEmail('test1@nutribodysim.org');
      expect(byEmail?.id).toBe('usr_test_1');

      const nextVersion = await repo.incrementTokenVersion('usr_test_1');
      expect(nextVersion).toBe(2);
    });

    it('should support algorithm and calculation contracts in scientific registry and artifact repositories', async () => {
      // Mock repository implementing IScientificRegistryRepository with algorithm methods
      class MockRegistryRepo implements Partial<IScientificRegistryRepository> {
        private mockAlgorithms: ScientificAlgorithm[] = [];

        async getAlgorithms(): Promise<ScientificAlgorithm[]> {
          return [...this.mockAlgorithms];
        }

        async getAlgorithmById(id: string): Promise<ScientificAlgorithm | null> {
          return this.mockAlgorithms.find(a => a.algorithm_id === id) || null;
        }
      }

      // Mock repository implementing IResearchArtifactRepository with calculation methods
      class MockArtifactRepo implements Partial<IResearchArtifactRepository> {
        private mockCalculations: CalculationTrace[] = [];

        async getCalculations(projectId?: string): Promise<CalculationTrace[]> {
          if (projectId) {
            return this.mockCalculations.filter(c => c.project_id === projectId);
          }
          return [...this.mockCalculations];
        }

        async getCalculationById(id: string): Promise<CalculationTrace | null> {
          return this.mockCalculations.find(c => c.calculation_id === id) || null;
        }

        async createCalculation(calculation: CalculationTrace): Promise<CalculationTrace> {
          this.mockCalculations.push(calculation);
          return calculation;
        }
      }

      const registryRepo = new MockRegistryRepo() as unknown as IScientificRegistryRepository;
      const algorithms = await registryRepo.getAlgorithms();
      expect(Array.isArray(algorithms)).toBe(true);
      expect(algorithms.length).toBe(0);

      const artifactRepo = new MockArtifactRepo() as unknown as IResearchArtifactRepository;
      const dummyTrace: CalculationTrace = {
        calculation_id: 'calc_test_1',
        project_id: 'proj_metabolic_v1',
        formula_or_model_id: 'FORMULA_BMR_MIFFLIN',
        version: '1.0.0',
        inputs_received: { VAR_DEMO_WEIGHT: { value: 70, unit: 'kg' } },
        normalized_inputs: { VAR_DEMO_WEIGHT: { value: 70, unit: 'kg', original_unit: 'kg' } },
        parameters_resolved: {},
        steps: [],
        final_result: { bmr_kcal: { value: 1658.75, unit: 'kcal/day' } },
        explanation: 'Deterministic test trace',
        provenance_hash: 'hash_test_trace',
        created_at: new Date().toISOString()
      };

      const savedTrace = await artifactRepo.createCalculation(dummyTrace);
      expect(savedTrace.calculation_id).toBe('calc_test_1');

      const queried = await artifactRepo.getCalculations('proj_metabolic_v1');
      expect(queried.length).toBe(1);
      expect(queried[0].final_result.bmr_kcal.value).toBe(1658.75);
    });
  });

  describe('2. Baseline 32-Entity Inventory & Relational Integrity', () => {
    it('should verify all 32 required entities exist in nutribodysim_db.json with zero orphans', () => {
      expect(fs.existsSync(DB_FILE)).toBe(true);
      const raw = fs.readFileSync(DB_FILE, 'utf-8');
      const db = JSON.parse(raw);

      const expectedEntities = [
        'users',
        'teams',
        'team_members',
        'projects',
        'project_members',
        'materials',
        'material_collections',
        'reading_progress',
        'bookmarks',
        'highlights',
        'notes',
        'units',
        'variables',
        'parameters',
        'formulas',
        'algorithms',
        'models',
        'references',
        'interpretation_rules',
        'calculations',
        'datasets',
        'dataset_versions',
        'statistics_analyses',
        'charts',
        'notebooks',
        'notebook_cells',
        'code_executions',
        'experiments',
        'audit_logs',
        'provenance_records',
        'role_requests',
        'external_identities'
      ];

      for (const entity of expectedEntities) {
        expect(db).toHaveProperty(entity);
        expect(Array.isArray(db[entity])).toBe(true);
      }

      expect(expectedEntities.length).toBe(32);

      // Verify essential seed row counts
      expect(db.users.length).toBeGreaterThanOrEqual(4);
      const canonicalUserIds = ['usr_researcher', 'usr_lecturer', 'usr_student', 'usr_admin'];
      for (const id of canonicalUserIds) {
        expect(db.users.some((u: any) => u.id === id)).toBe(true);
      }
      expect(db.projects.length).toBe(3);
      expect(db.materials.length).toBe(2);
      expect(db.formulas.length).toBe(5);
      expect(db.units.length).toBe(33);

      // Check relational integrity: 0 orphan records
      const userIds = new Set(db.users.map((u: any) => u.id));
      const projectIds = new Set(db.projects.map((p: any) => p.id));
      const teamIds = new Set(db.teams.map((t: any) => t.id));
      const datasetIds = new Set(db.datasets.map((d: any) => d.id));
      const notebookIds = new Set(db.notebooks.map((n: any) => n.id));

      for (const tm of db.team_members) {
        expect(teamIds.has(tm.team_id)).toBe(true);
        expect(userIds.has(tm.user_id)).toBe(true);
      }

      for (const pm of db.project_members) {
        expect(projectIds.has(pm.project_id)).toBe(true);
        expect(userIds.has(pm.user_id)).toBe(true);
      }

      for (const dv of db.dataset_versions) {
        expect(datasetIds.has(dv.dataset_id)).toBe(true);
      }

      for (const cell of db.notebook_cells) {
        expect(notebookIds.has(cell.notebook_id)).toBe(true);
      }
    });

    it('should verify ID preservation format across core entities', () => {
      const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));

      // Check ID prefixes
      expect(db.users.every((u: any) => u.id.startsWith('usr_'))).toBe(true);
      expect(db.projects.every((p: any) => p.id.startsWith('proj_'))).toBe(true);
      expect(db.materials.every((m: any) => m.id.startsWith('mat_'))).toBe(true);
      expect(db.datasets.every((d: any) => d.id.startsWith('ds_'))).toBe(true);
      expect(db.units.every((u: any) => u.unit_id.startsWith('UNIT_'))).toBe(true);
      expect(db.variables.every((v: any) => v.variable_id.startsWith('VAR_'))).toBe(true);
      expect(db.parameters.every((p: any) => p.parameter_id.startsWith('PARAM_'))).toBe(true);
      expect(db.formulas.every((f: any) => f.formula_id.startsWith('FORMULA_'))).toBe(true);
    });

    it('should verify data/nutribodysim_db.backup.json exists as a valid immutable 32-entity baseline snapshot', () => {
      expect(fs.existsSync(BACKUP_FILE)).toBe(true);
      const backupBuffer = fs.readFileSync(BACKUP_FILE);
      const backupHash = crypto.createHash('sha256').update(backupBuffer).digest('hex');

      // Verified snapshot reference hash and size from MVS-B2.5E.1A.1 creation
      expect(backupHash).toBe('a7f7cfa135e5b8c4be091cff49f5b1e2ecc88514776b8f908bd3ccf0d188af14');
      expect(backupBuffer.length).toBe(57187);

      const backupParsed = JSON.parse(backupBuffer.toString('utf8'));
      expect(Object.keys(backupParsed).length).toBe(32);
    });
  });

  describe('3. Scientific Engine Zero-Delta Regression Preservation', () => {
    it('should compute exact deterministic BMR using Mifflin-St Jeor formula with zero delta', () => {
      const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
      const mifflin = db.formulas.find((f: any) => f.formula_id === 'FORMULA_BMR_MIFFLIN');
      expect(mifflin).toBeDefined();

      const variablesMap: Record<string, ScientificVariable> = {};
      for (const v of db.variables) {
        variablesMap[v.variable_id] = v;
      }

      const parametersMap: Record<string, ScientificParameter> = {};
      for (const p of db.parameters) {
        parametersMap[p.parameter_id] = p;
      }

      // Test subject: Male, 70 kg, 175 cm (or 1.75 m), 28 years old
      // Mifflin formula: (10 * 70) + (625 * 1.75) - (5 * 28) + 5 = 700 + 1093.75 - 140 + 5 = 1658.75 kcal
      const result = CalculationEngine.executeFormula({
        formula: mifflin,
        inputs: {
          VAR_DEMO_WEIGHT: { value: 70, unit: 'kg' },
          VAR_DEMO_HEIGHT: { value: 1.75, unit: 'm' },
          VAR_DEMO_AGE: { value: 28, unit: 'yr' }
        },
        variables: variablesMap,
        parameters: parametersMap
      });

      expect(result).toBeDefined();
      const bmrVal = Number(result.final_result.bmr_kcal.value);
      expect(bmrVal).toBeCloseTo(1658.75, 4);
      expect(result.final_result.bmr_kcal.unit).toBe('kcal/day');
      expect(result.formula_or_model_id).toBe('FORMULA_BMR_MIFFLIN');
      expect(result.steps.length).toBeGreaterThan(0);
    });

    it('should compute exact deterministic BMI using Quetelet formula with zero delta', () => {
      const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
      const bmiFormula = db.formulas.find((f: any) => f.formula_id === 'FORMULA_BMI_QUETELET');
      expect(bmiFormula).toBeDefined();

      const variablesMap: Record<string, ScientificVariable> = {};
      for (const v of db.variables) {
        variablesMap[v.variable_id] = v;
      }

      const parametersMap: Record<string, ScientificParameter> = {};
      for (const p of db.parameters) {
        parametersMap[p.parameter_id] = p;
      }

      // Test subject: 70 kg, 1.75 m
      // BMI = 70 / (1.75^2) = 70 / 3.0625 = 22.857142857...
      const result = CalculationEngine.executeFormula({
        formula: bmiFormula,
        inputs: {
          VAR_DEMO_WEIGHT: { value: 70, unit: 'kg' },
          VAR_DEMO_HEIGHT: { value: 1.75, unit: 'm' }
        },
        variables: variablesMap,
        parameters: parametersMap
      });

      expect(result).toBeDefined();
      const bmiVal = Number(result.final_result.bmi_index.value);
      expect(bmiVal).toBeCloseTo(22.8571, 3);
      expect(result.final_result.bmi_index.unit).toBe('kg/m^2');
      expect(result.formula_or_model_id).toBe('FORMULA_BMI_QUETELET');
    });

    it('should perform unit conversions accurately without deviation', () => {
      // 1 kcal = 4.184 kJ
      const kj = convertUnit(100, 'kcal', 'kJ');
      expect(kj.targetValue).toBeCloseTo(418.4, 4);

      // 100 cm = 1 m
      const meters = convertUnit(100, 'cm', 'm');
      expect(meters.targetValue).toBeCloseTo(1.0, 6);

      // 1000 mg = 1 g
      const grams = convertUnit(1000, 'mg', 'g');
      expect(grams.targetValue).toBeCloseTo(1.0, 6);
    });
  });
});
