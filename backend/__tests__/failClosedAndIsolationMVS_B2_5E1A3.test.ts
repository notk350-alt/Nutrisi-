/**
 * NutriBodySim — Test Isolation & Fail-Closed Database Protection Test Suite (MVS-B2.5E.1A.3)
 *
 * Verifies:
 * 1. Storage Isolation:
 *    - db.save() writes only to isolated test storage path.
 *    - Active working database (data/nutribodysim_db.json) is NEVER touched.
 *    - Storage path resolution correctly respects NUTRIBODYSIM_DB_PATH and setStoragePath.
 *    - Hard fail-safe prevents any test-mode writes to production database.
 * 2. Fail-Closed Database Protection:
 *    - Corrupt JSON throws DatabaseInitializationError (no reseed, no write).
 *    - Corrupt file remains byte-for-byte identical after failed load attempt.
 *    - Unreadable/permission error preserves original error cause (error chaining).
 *    - Valid database file loads successfully without modification.
 *    - Non-existent database triggers legitimate seed bootstrap without error.
 * 3. Scientific Invariance:
 *    - Deterministic BMR and BMI calculations remain unchanged.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { DatabaseStore, DatabaseInitializationError, db } from '../database/store';
import { CalculationEngine, convertUnit } from '../../scientific';

function computeSha256(filePath: string): string {
  if (!fs.existsSync(filePath)) return '';
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

describe('MVS-B2.5E.1A.3: Test Isolation & Fail-Closed Database Protection', () => {
  const ACTIVE_DB = path.resolve(process.cwd(), 'data', 'nutribodysim_db.json');
  const BACKUP_DB = path.resolve(process.cwd(), 'data', 'nutribodysim_db.backup.json');
  const TEST_SANDBOX_DIR = path.resolve(process.cwd(), 'data', '.test_dbs', 'sandbox_e1a3');

  beforeEach(() => {
    fs.mkdirSync(TEST_SANDBOX_DIR, { recursive: true });
  });

  afterEach(() => {
    // Clean up temporary test sandbox files
    if (fs.existsSync(TEST_SANDBOX_DIR)) {
      try {
        const files = fs.readdirSync(TEST_SANDBOX_DIR);
        for (const file of files) {
          fs.unlinkSync(path.join(TEST_SANDBOX_DIR, file));
        }
        fs.rmdirSync(TEST_SANDBOX_DIR);
      } catch {}
    }
  });

  // =========================================================================
  // 1. STORAGE ISOLATION TESTS
  // =========================================================================
  describe('1. Storage Isolation Guarantees', () => {
    it('1.1 Isolated DatabaseStore instance writes exclusively to its configured test path', () => {
      const customDbPath = path.join(TEST_SANDBOX_DIR, 'custom_isolated_db.json');
      fs.copyFileSync(BACKUP_DB, customDbPath);

      const isolatedStore = new DatabaseStore(customDbPath);
      expect(isolatedStore.getDbFilePath()).toBe(customDbPath);

      const state = isolatedStore.getState();
      const initialUsersCount = state.users.length;

      // Add a test user and save
      state.users.push({
        id: 'usr_isolation_test',
        email: 'isolation@test.org',
        name: 'Isolation Test User',
        role: 'Student',
        permissions: ['VIEW'],
        created_at: new Date().toISOString(),
        last_login_at: new Date().toISOString()
      });
      isolatedStore.save();

      // Verify the custom file was written with the new user
      const savedRaw = JSON.parse(fs.readFileSync(customDbPath, 'utf-8'));
      expect(savedRaw.users.length).toBe(initialUsersCount + 1);
      expect(savedRaw.users.some((u: any) => u.id === 'usr_isolation_test')).toBe(true);

      // Verify active working database was completely untouched
      const activeRaw = JSON.parse(fs.readFileSync(ACTIVE_DB, 'utf-8'));
      expect(activeRaw.users.some((u: any) => u.id === 'usr_isolation_test')).toBe(false);
    });

    it('1.2 Hard safety barrier blocks any saveToDisk or reseed targeting active working DB in test mode', () => {
      // Create a store that explicitly points to the active working database
      const unsafeStore = new DatabaseStore(ACTIVE_DB);

      // Attempting to call save() or reseed() on active DB in test mode MUST throw a fatal safety error
      expect(() => {
        unsafeStore.save();
      }).toThrow(/FATAL SAFETY VIOLATION: Write operation to active working database/);

      expect(() => {
        unsafeStore.reseed();
      }).toThrow(/FATAL SAFETY VIOLATION: Reseed of active working database/);
    });

    it('1.3 Runtime singleton db responds to setStoragePath without affecting active DB file', () => {
      const activeHashBefore = computeSha256(ACTIVE_DB);
      const tempPath = path.join(TEST_SANDBOX_DIR, 'singleton_redirect_db.json');
      fs.copyFileSync(BACKUP_DB, tempPath);

      // Point singleton to temporary path
      db.setStoragePath(tempPath);
      expect(db.getDbFilePath()).toBe(tempPath);

      // Mutate and save via singleton
      const state = db.getState();
      state.audit_logs.push({
        id: 'AUDIT_ISOLATION_CHECK',
        user_id: 'usr_admin',
        user_name: 'Admin',
        action: 'LOGIN',
        entity_type: 'SESSION',
        entity_id: 'sess_iso_1',
        details: 'Testing isolation redirect',
        timestamp: new Date().toISOString()
      });
      db.save();

      // Verify temp file has the new audit log
      const tempJson = JSON.parse(fs.readFileSync(tempPath, 'utf-8'));
      expect(tempJson.audit_logs.some((l: any) => l.id === 'AUDIT_ISOLATION_CHECK')).toBe(true);

      // Verify active database was untouched
      const activeHashAfter = computeSha256(ACTIVE_DB);
      expect(activeHashAfter).toBe(activeHashBefore);
    });
  });

  // =========================================================================
  // 2. FAIL-CLOSED DATABASE PROTECTION TESTS
  // =========================================================================
  describe('2. Fail-Closed Error Handling on Read / Parse Failures', () => {
    it('2.1 Corrupt JSON throws DatabaseInitializationError and NEVER overwrites or reseeds the file', () => {
      const corruptDbPath = path.join(TEST_SANDBOX_DIR, 'corrupt_syntax_db.json');
      const corruptContent = '{"users": [ {"id": "usr_broken", "name": "Broken User" ... MALFORMED JSON';
      fs.writeFileSync(corruptDbPath, corruptContent, 'utf-8');

      const hashBefore = computeSha256(corruptDbPath);
      const sizeBefore = fs.readFileSync(corruptDbPath).length;

      // Initializing store with corrupt file MUST throw DatabaseInitializationError
      expect(() => {
        new DatabaseStore(corruptDbPath);
      }).toThrow(DatabaseInitializationError);

      try {
        new DatabaseStore(corruptDbPath);
      } catch (err: any) {
        expect(err.name).toBe('DatabaseInitializationError');
        expect(err.filePath).toBe(corruptDbPath);
        expect(err.cause).toBeDefined(); // Underlying SyntaxError is chained
        expect((err.cause as Error).name).toBe('SyntaxError');
      }

      // Assert the corrupt file was NOT overwritten, deleted, or re-seeded
      const hashAfter = computeSha256(corruptDbPath);
      const sizeAfter = fs.readFileSync(corruptDbPath).length;
      expect(hashAfter).toBe(hashBefore);
      expect(sizeAfter).toBe(sizeBefore);
      expect(fs.readFileSync(corruptDbPath, 'utf-8')).toBe(corruptContent);
    });

    it('2.2 Non-object root JSON (e.g., array or primitive) throws DatabaseInitializationError', () => {
      const invalidRootPath = path.join(TEST_SANDBOX_DIR, 'invalid_root_db.json');
      fs.writeFileSync(invalidRootPath, JSON.stringify(['not', 'an', 'object']), 'utf-8');

      expect(() => {
        new DatabaseStore(invalidRootPath);
      }).toThrow(DatabaseInitializationError);
    });

    it.each([
      ['missing', (state: Record<string, unknown>) => { delete state.users; }],
      ['wrong type', (state: Record<string, unknown>) => { state.users = {}; }]
    ])('2.3 Rejects a %s collection without modifying the persistent file', (_description, corruptCollection) => {
      const invalidDbPath = path.join(TEST_SANDBOX_DIR, 'invalid_collection_db.json');
      const state = JSON.parse(fs.readFileSync(BACKUP_DB, 'utf-8')) as Record<string, unknown>;
      corruptCollection(state);
      const invalidContent = JSON.stringify(state);
      fs.writeFileSync(invalidDbPath, invalidContent, 'utf-8');

      expect(() => new DatabaseStore(invalidDbPath)).toThrow(DatabaseInitializationError);
      expect(fs.readFileSync(invalidDbPath, 'utf-8')).toBe(invalidContent);
    });

    it('2.3 Valid JSON database loads successfully without throwing and preserves all data', () => {
      const validDbPath = path.join(TEST_SANDBOX_DIR, 'valid_db.json');
      fs.copyFileSync(BACKUP_DB, validDbPath);

      const validStore = new DatabaseStore(validDbPath);
      const state = validStore.getState();
      expect(state.users.length).toBeGreaterThanOrEqual(4);
      expect(state.units.length).toBe(33);
      expect(state.formulas.length).toBe(5);
    });

    it('2.4 Email lookup safely skips users with invalid email values and rejects invalid queries', () => {
      const validDbPath = path.join(TEST_SANDBOX_DIR, 'email_lookup_db.json');
      fs.copyFileSync(BACKUP_DB, validDbPath);
      const store = new DatabaseStore(validDbPath);
      const malformedUser = { ...store.getState().users[0], id: 'usr_invalid_email', email: 'placeholder@example.org' };
      Object.defineProperty(malformedUser, 'email', { value: null });
      store.getState().users.unshift(malformedUser);

      expect(store.getUserByEmail('admin@nutribodysim.org')?.id).toBe('usr_admin');
      expect(store.getUserByEmail(null as unknown as string)).toBeUndefined();
    });

    it('2.5 Non-existent database triggers legitimate bootstrap creation without error', () => {
      const newDbPath = path.join(TEST_SANDBOX_DIR, 'new_bootstrap_db.json');
      expect(fs.existsSync(newDbPath)).toBe(false);

      const freshStore = new DatabaseStore(newDbPath);
      expect(fs.existsSync(newDbPath)).toBe(true);

      const state = freshStore.getState();
      expect(state.users.length).toBe(4);
      expect(state.units.length).toBe(33);
      expect(state.projects.length).toBe(2);
    });
  });

  // =========================================================================
  // 3. SCIENTIFIC INVARIANCE & ZERO-DELTA VERIFICATION
  // =========================================================================
  describe('3. Scientific Engine Zero-Delta Invariance', () => {
    it('3.1 BMR and BMI calculations produce exact deterministic values across isolated storage', () => {
      const validDbPath = path.join(TEST_SANDBOX_DIR, 'sci_test_db.json');
      fs.copyFileSync(BACKUP_DB, validDbPath);

      const store = new DatabaseStore(validDbPath);
      const state = store.getState();

      const mifflin = state.formulas.find(f => f.formula_id === 'FORMULA_BMR_MIFFLIN')!;
      const varMap: Record<string, any> = {};
      state.variables.forEach(v => { varMap[v.variable_id] = v; });
      const paramMap: Record<string, any> = {};
      state.parameters.forEach(p => { paramMap[p.parameter_id] = p; });

      // Male, 70 kg, 1.75 m, 28 yr
      const bmrTrace = CalculationEngine.executeFormula({
        formula: mifflin,
        inputs: {
          VAR_DEMO_WEIGHT: { value: 70, unit: 'kg' },
          VAR_DEMO_HEIGHT: { value: 1.75, unit: 'm' },
          VAR_DEMO_AGE: { value: 28, unit: 'yr' }
        },
        parameters: paramMap,
        variables: varMap
      });

      expect(Number(bmrTrace.final_result.bmr_kcal.value)).toBe(1658.75);

      // BMI Quetelet
      const bmiFormula = state.formulas.find(f => f.formula_id === 'FORMULA_BMI_QUETELET')!;
      const bmiTrace = CalculationEngine.executeFormula({
        formula: bmiFormula,
        inputs: {
          VAR_DEMO_WEIGHT: { value: 70, unit: 'kg' },
          VAR_DEMO_HEIGHT: { value: 1.75, unit: 'm' }
        },
        parameters: paramMap,
        variables: varMap
      });

      expect(Number(bmiTrace.final_result.bmi_index.value)).toBeCloseTo(22.8571, 3);
    });
  });
});
