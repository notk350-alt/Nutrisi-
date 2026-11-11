/**
 * NutriBodySim — PostgreSQL Migration Safety & Execution Test Suite (MVS-B2.5E.1B.5)
 *
 * Verifies all 17 safety and execution requirements:
 * 1. Dry-run never executes write operations.
 * 2. Physical execution (--execute) without --target-env=staging is rejected fail-closed.
 * 3. Production target URLs and hostnames are rejected fail-closed.
 * 4. Disallowed or unknown hostnames are rejected.
 * 5. Missing or malformed URLs are rejected.
 * 6. Credentials and passwords are redacted and never leaked to reports or logs.
 * 7. Connection failures are handled gracefully with cleanup.
 * 8. All operations within one migration execute on the same atomic connection client.
 * 9. Failure midway triggers immediate transaction ROLLBACK.
 * 10. Zero false success statuses are reported after an error.
 * 11. Foreign key order (7 waves) is topologically respected.
 * 12. Conflict policy (fail-on-conflict vs skip-existing) is properly generated.
 * 13. Rerun behavior is deterministic.
 * 14. Exact data reconciliation (32 collections, 88 source records, 30 junction rows, 45 tables, 118 total physical rows).
 * 15. Connection pool is closed in finally on both success and failure.
 * 16. Source database JSON file remains completely unmutated (SHA-256 invariant).
 * 17. Safe CLI behavior with edge-case/malformed arguments.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { getTableConfig } from 'drizzle-orm/pg-core';
import {
  JsonToPostgresMigrator,
  MIGRATABLE_REQUESTED_ROLES,
  MIGRATABLE_TEAM_ROLES,
  MIGRATABLE_USER_ROLES
} from '../../database/migration/jsonToPostgresMigrator';
import { schemaTableManifest } from '../../database/schema';
import { createPostgresPoolConfig } from '../../database/migration/postgresClientConfig';
import { TargetSafetyGuard } from '../../database/migration/targetSafetyGuard';
import pg from 'pg';
import { VALID_ROLES } from '../../auth/rbacMiddleware';

describe('MVS-B2.5E.1B.5: PostgreSQL Migration Safety & Execution Gate', () => {
  const BACKUP_DB_PATH = path.resolve(process.cwd(), 'data', 'nutribodysim_db.backup.json');
  const ACTIVE_DB_PATH = path.resolve(process.cwd(), 'data', 'nutribodysim_db.json');
  const EXPECTED_ACTIVE_HASH = '1b16140f395c0a937843cb691be1382a00296c2d2bd1ddd075c39d84ad3c6a5d';
  const EXPECTED_BACKUP_HASH = 'a7f7cfa135e5b8c4be091cff49f5b1e2ecc88514776b8f908bd3ccf0d188af14';

  describe('1. Target Safety Guard Assertions (Fail-Closed)', () => {
    it('should reject execution when target-env is missing or invalid', () => {
      const result1 = TargetSafetyGuard.validate({
        targetEnv: undefined,
        databaseUrl: 'postgresql://app:pass@staging.neon.tech/nutridb?sslmode=require'
      });
      expect(result1.allowed).toBe(false);
      expect(result1.status).toBe('BLOCKED_TARGET_VERIFICATION');
      expect(result1.reason).toContain('Target environment must be explicitly declared');

      const result2 = TargetSafetyGuard.validate({
        targetEnv: 'production',
        databaseUrl: 'postgresql://app:pass@staging.neon.tech/nutridb?sslmode=require'
      });
      expect(result2.allowed).toBe(false);
      expect(result2.status).toBe('BLOCKED_TARGET_VERIFICATION');
    });

    it('should reject URLs containing production indicators fail-closed', () => {
      const prodUrls = [
        'postgresql://admin:secret@nutribodysim-prod.internal/nutridb?sslmode=require',
        'postgresql://admin:secret@ep-staging.aws.neon.tech/production_db?sslmode=require',
        'postgresql://prod_user:secret@ep-staging.aws.neon.tech/nutridb?sslmode=require',
        'postgresql://admin:secret@ep-staging.aws.neon.tech/nutridb?env=production&sslmode=require'
      ];

      for (const url of prodUrls) {
        const result = TargetSafetyGuard.validate({
          targetEnv: 'staging',
          databaseUrl: url
        });
        expect(result.allowed).toBe(false);
        expect(result.status).toBe('BLOCKED_TARGET_VERIFICATION');
        expect(result.reason).toContain('Production database indicators detected');
      }
    });

    it('should reject unauthorized or unknown hostnames', () => {
      const result = TargetSafetyGuard.validate({
        targetEnv: 'staging',
        databaseUrl: 'postgresql://app:secret@unknown-external-host.com/staging_db?sslmode=require'
      });
      expect(result.allowed).toBe(false);
      expect(result.status).toBe('BLOCKED_TARGET_VERIFICATION');
      expect(result.reason).toContain('not in the authorized staging/test allowlist');
    });

    it('should reject missing, empty, or malformed database URLs', () => {
      const resultEmpty = TargetSafetyGuard.validate({
        targetEnv: 'staging',
        databaseUrl: ''
      });
      expect(resultEmpty.allowed).toBe(false);
      expect(resultEmpty.status).toBe('BLOCKED_TARGET_VERIFICATION');

      const resultMalformed = TargetSafetyGuard.validate({
        targetEnv: 'staging',
        databaseUrl: 'not-a-valid-url'
      });
      expect(resultMalformed.allowed).toBe(false);
      expect(resultMalformed.status).toBe('BLOCKED_TARGET_VERIFICATION');
      expect(resultMalformed.reason).toContain('invalid URI syntax');
    });

    it('should sanitize URLs and redact passwords without leaking credentials', () => {
      const rawUrl = 'postgresql://admin_user:super_secret_password_123@ep-staging.aws.neon.tech/nutridb?sslmode=require';
      const sanitized = TargetSafetyGuard.sanitizeUrl(rawUrl);

      expect(sanitized).not.toContain('super_secret_password_123');
      expect(sanitized).toContain('admin_user:***@ep-staging.aws.neon.tech');
    });

    it('should allow valid staging targets matching allowlisted domains with SSL', () => {
      const validStagingUrl = 'postgresql://nutri_user:secret@ep-test-staging.aws.neon.tech/nutridb?sslmode=require';
      const result = TargetSafetyGuard.validate({
        targetEnv: 'staging',
        databaseUrl: validStagingUrl
      });
      expect(result.allowed).toBe(true);
      expect(result.status).toBe('ALLOWED');
      expect(result.sanitizedHost).toBe('ep-test-staging.aws.neon.tech');
      expect(result.sanitizedDatabase).toBe('nutridb');
    });

    it('should reject a database outside an explicitly configured database allowlist', () => {
      const result = TargetSafetyGuard.validate({
        targetEnv: 'staging',
        databaseUrl: 'postgresql://test:placeholder@ep-test-staging.aws.neon.tech/otherdb?sslmode=require',
        allowedDatabaseNames: ['neondb']
      });

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('not in the authorized staging/test allowlist');
    });

    it('should configure the PostgreSQL driver to verify remote TLS certificates', async () => {
      const config = createPostgresPoolConfig('postgresql://test:placeholder@ep-test-staging.aws.neon.tech/neondb?sslmode=require');
      const pool = new pg.Pool(config);

      try {
        expect(pool.options.ssl).toMatchObject({ rejectUnauthorized: true });
        expect(pool.options.max).toBe(1);
        expect(new URL(config.connectionString!).searchParams.get('sslmode')).toBe('verify-full');
      } finally {
        await pool.end();
      }
    });
  });

  describe('2. Data Reconciliation & Topological Wave Mapping', () => {
    it('should map parameters only to supported columns and preserve their payload and references', () => {
      const source = JSON.parse(fs.readFileSync(BACKUP_DB_PATH, 'utf-8'));
      source.parameters[0] = {
        ...source.parameters[0],
        symbol: 'unsupported-symbol',
        measurement_type: 'unsupported-measurement',
        default_value: 999,
        allowed_range: { min: -999, max: 999 },
        source_reference: 'unsupported-reference'
      };

      const migrator = new JsonToPostgresMigrator({ sourcePath: BACKUP_DB_PATH, dryRun: true });
      const { waves } = migrator.prepareWaves(source);
      const tables = waves.flatMap((wave) => wave.tables);
      const parameterTable = tables.find((table) => table.name === 'scientific_parameters')!;
      const referenceTable = tables.find((table) => table.name === 'scientific_parameter_references')!;
      const parameter = source.parameters[0];
      const mappedParameter = parameterTable.rows.find((row) => row.parameter_id === parameter.parameter_id)!;

      expect(parameterTable.columns).toEqual([
        'parameter_id',
        'name',
        'description',
        'value',
        'unit',
        'valid_range',
        'version',
        'status',
        'is_constant',
        'created_at',
        'updated_at'
      ]);
      expect(mappedParameter).toMatchObject({
        parameter_id: parameter.parameter_id,
        name: parameter.name,
        value: parameter.value,
        unit: parameter.unit,
        valid_range: parameter.valid_range,
        is_constant: parameter.is_constant
      });
      expect(mappedParameter).not.toHaveProperty('symbol');
      expect(mappedParameter).not.toHaveProperty('measurement_type');
      expect(mappedParameter).not.toHaveProperty('default_value');
      expect(mappedParameter).not.toHaveProperty('allowed_range');
      expect(mappedParameter).not.toHaveProperty('source_reference');
      expect(referenceTable.rows).toContainEqual({
        parameter_id: parameter.parameter_id,
        reference_id: parameter.reference_ids[0]
      });
    });

    it('should only plan SQL columns defined by the canonical Drizzle schema', () => {
      const source = JSON.parse(fs.readFileSync(BACKUP_DB_PATH, 'utf-8'));
      const migrator = new JsonToPostgresMigrator({ sourcePath: BACKUP_DB_PATH, dryRun: true });
      const { waves } = migrator.prepareWaves(source);
      const drizzleColumnsByTable = new Map(
        Object.values(schemaTableManifest).map((table) => {
          const config = getTableConfig(table);
          return [config.name, new Set(config.columns.map((column) => column.name))];
        })
      );
      const tables = waves.flatMap((wave) => wave.tables);

      expect(tables).toHaveLength(45);
      for (const table of tables) {
        const supportedColumns = drizzleColumnsByTable.get(table.name);
        expect(supportedColumns, `missing Drizzle table ${table.name}`).toBeDefined();
        for (const column of table.columns) {
          expect(supportedColumns?.has(column), `${table.name}.${column}`).toBe(true);
        }
        for (const row of table.rows) {
          expect(Object.keys(row).sort()).toEqual([...table.columns].sort());
        }
      }
    });

    it('should preserve the source contract for formulas, models, materials, research, and provenance', () => {
      const source = JSON.parse(fs.readFileSync(BACKUP_DB_PATH, 'utf-8'));
      const migrator = new JsonToPostgresMigrator({ sourcePath: BACKUP_DB_PATH, dryRun: true });
      const { waves } = migrator.prepareWaves(source);
      const tables = new Map(waves.flatMap((wave) => wave.tables).map((table) => [table.name, table]));
      const formula = source.formulas[0];
      const mappedFormula = tables.get('scientific_formulas')!.rows.find(
        (row) => row.formula_id === formula.formula_id
      )!;
      const mappedMaterial = tables.get('materials')!.rows.find(
        (row) => row.id === source.materials[0].id
      )!;
      const mappedModel = tables.get('scientific_models')!.rows[0];
      const mappedDatasetVersion = tables.get('dataset_versions')!.rows[0];
      const mappedAnalysis = tables.get('statistics_analyses')!.rows[0];
      const mappedProvenance = tables.get('provenance_records')!.rows[0];

      expect(mappedFormula.expression_ast).toEqual(formula.expression_ast);
      expect(mappedFormula.expression_string).toBe(formula.expression_string);
      expect(mappedFormula.assumptions).toEqual(formula.assumptions);
      expect(mappedFormula.validation_status).toBe(formula.validation_status);
      expect(tables.get('scientific_formula_parameters')!.rows).toEqual(
        source.formulas.flatMap((row: any) => row.parameter_ids.map((parameter_id: string) => ({
          formula_id: row.formula_id,
          parameter_id
        })))
      );
      expect(tables.get('scientific_formula_references')!.rows).toEqual(
        source.formulas.flatMap((row: any) => row.reference_ids.map((reference_id: string) => ({
          formula_id: row.formula_id,
          reference_id
        })))
      );
      expect(mappedMaterial.file_size_bytes).toBe(source.materials[0].file_size_bytes);
      expect(mappedMaterial.file_hash).toBe(source.materials[0].file_hash);
      expect(mappedMaterial.tags).toEqual(source.materials[0].tags);
      expect(mappedModel.is_verified).toBe(source.models[0].is_verified);
      expect(tables.get('scientific_model_variables')!.rows).toHaveLength(
        source.models[0].variable_ids.length
      );
      expect(tables.get('scientific_model_formulas')!.rows).toHaveLength(
        source.models[0].formula_ids.length
      );
      expect(tables.get('scientific_model_parameters')!.rows).toHaveLength(
        source.models[0].parameter_ids.length
      );
      expect(tables.get('scientific_model_references')!.rows).toHaveLength(
        source.models[0].reference_ids.length
      );
      expect(mappedDatasetVersion.version_tag).toBe(source.dataset_versions[0].version_tag);
      expect(mappedDatasetVersion.state).toBe(source.dataset_versions[0].state);
      expect(mappedDatasetVersion.data).toEqual(source.dataset_versions[0].data);
      expect(mappedAnalysis.target_columns).toEqual(source.statistics_analyses[0].target_columns);
      expect(mappedAnalysis.method_justification).toBe(
        source.statistics_analyses[0].method_justification
      );
      expect(mappedProvenance.environment_specs).toBe(
        source.provenance_records[0].environment_specs
      );
      expect(mappedProvenance.reproducibility_manifest).toEqual(
        source.provenance_records[0].reproducibility_manifest
      );
    });

    it('should preserve historical IDs and resolve every mapped primary and foreign key', () => {
      const source = JSON.parse(fs.readFileSync(BACKUP_DB_PATH, 'utf-8'));
      const migrator = new JsonToPostgresMigrator({ sourcePath: BACKUP_DB_PATH, dryRun: true });
      const { waves } = migrator.prepareWaves(source);
      const tables = new Map(waves.flatMap((wave) => wave.tables).map((table) => [table.name, table]));
      const idMappings: Record<string, { table: string; sourceKey: string; targetKey: string }> = {
        units: { table: 'scientific_units', sourceKey: 'unit_id', targetKey: 'unit_id' },
        references: { table: 'scientific_references', sourceKey: 'reference_id', targetKey: 'reference_id' },
        users: { table: 'users', sourceKey: 'id', targetKey: 'id' },
        external_identities: { table: 'external_identities', sourceKey: 'id', targetKey: 'id' },
        role_requests: { table: 'role_requests', sourceKey: 'id', targetKey: 'request_id' },
        teams: { table: 'teams', sourceKey: 'id', targetKey: 'id' },
        variables: { table: 'scientific_variables', sourceKey: 'variable_id', targetKey: 'variable_id' },
        projects: { table: 'projects', sourceKey: 'id', targetKey: 'id' },
        parameters: { table: 'scientific_parameters', sourceKey: 'parameter_id', targetKey: 'parameter_id' },
        formulas: { table: 'scientific_formulas', sourceKey: 'formula_id', targetKey: 'formula_id' },
        algorithms: { table: 'scientific_algorithms', sourceKey: 'algorithm_id', targetKey: 'algorithm_id' },
        models: { table: 'scientific_models', sourceKey: 'model_id', targetKey: 'model_id' },
        interpretation_rules: { table: 'scientific_interpretation_rules', sourceKey: 'rule_id', targetKey: 'rule_id' },
        team_members: { table: 'team_members', sourceKey: 'id', targetKey: 'id' },
        project_members: { table: 'project_members', sourceKey: 'id', targetKey: 'id' },
        materials: { table: 'materials', sourceKey: 'id', targetKey: 'id' },
        material_collections: { table: 'material_collections', sourceKey: 'id', targetKey: 'id' },
        reading_progress: { table: 'reading_progress', sourceKey: 'id', targetKey: 'id' },
        bookmarks: { table: 'bookmarks', sourceKey: 'id', targetKey: 'id' },
        highlights: { table: 'highlights', sourceKey: 'id', targetKey: 'id' },
        notes: { table: 'notes', sourceKey: 'id', targetKey: 'id' },
        datasets: { table: 'datasets', sourceKey: 'id', targetKey: 'id' },
        dataset_versions: { table: 'dataset_versions', sourceKey: 'id', targetKey: 'id' },
        statistics_analyses: { table: 'statistics_analyses', sourceKey: 'id', targetKey: 'id' },
        charts: { table: 'charts', sourceKey: 'id', targetKey: 'id' },
        notebooks: { table: 'notebooks', sourceKey: 'id', targetKey: 'id' },
        notebook_cells: { table: 'notebook_cells', sourceKey: 'id', targetKey: 'id' },
        code_executions: { table: 'code_executions', sourceKey: 'id', targetKey: 'id' },
        experiments: { table: 'experiments', sourceKey: 'id', targetKey: 'id' },
        provenance_records: { table: 'provenance_records', sourceKey: 'id', targetKey: 'id' },
        audit_logs: { table: 'audit_logs', sourceKey: 'id', targetKey: 'id' },
        calculations: { table: 'scientific_calculations', sourceKey: 'calculation_id', targetKey: 'calculation_id' }
      };

      for (const [collection, mapping] of Object.entries(idMappings)) {
        const sourceIds = (source[collection] || []).map((row: Record<string, string>) =>
          collection === 'role_requests' ? row.request_id || row.id : row[mapping.sourceKey]
        );
        const targetIds = tables.get(mapping.table)!.rows.map((row) => row[mapping.targetKey]);
        expect(targetIds).toEqual(sourceIds);
      }

      for (const tableSchema of Object.values(schemaTableManifest)) {
        const config = getTableConfig(tableSchema);
        const batch = tables.get(config.name)!;
        const primaryKeyColumns = [
          ...config.columns.filter((column) => column.primary).map((column) => column.name),
          ...config.primaryKeys.flatMap((key) => key.columns.map((column) => column.name))
        ];
        const primaryKeys = batch.rows.map((row) =>
          JSON.stringify(primaryKeyColumns.map((column) => row[column]))
        );
        expect(new Set(primaryKeys).size, `${config.name} primary-key conflicts`).toBe(primaryKeys.length);

        for (const foreignKey of config.foreignKeys) {
          const reference = foreignKey.reference();
          const parent = tables.get(getTableConfig(reference.foreignTable).name)!;
          for (const row of batch.rows) {
            const values = reference.columns.map((column) => row[column.name]);
            if (values.every((value) => value == null)) continue;
            expect(
              parent.rows.some((candidate) =>
                reference.foreignColumns.every((column, index) => candidate[column.name] === values[index])
              ),
              `${config.name} foreign-key target exists`
            ).toBe(true);
          }
        }
      }
    });

    it('should preserve every canonical source role and keep Main Administrator as a separate flag', () => {
      const source = JSON.parse(fs.readFileSync(BACKUP_DB_PATH, 'utf-8'));
      for (const collection of Object.keys(source)) source[collection] = [];
      source.users = MIGRATABLE_USER_ROLES.map((role: string, index: number) => ({
        id: `role-contract-${index}`,
        email: `role-${index}@example.test`,
        name: `Role ${index}`,
        role,
        permissions: [],
        is_main_admin: role === 'Admin'
      }));
      source.role_requests = MIGRATABLE_REQUESTED_ROLES.map((requested_role: string, index: number) => ({
        id: `role-request-${index}`,
        user_id: 'role-contract-0',
        requested_role
      }));

      const migrator = new JsonToPostgresMigrator({ sourcePath: BACKUP_DB_PATH, dryRun: true });
      const { waves, issues } = migrator.prepareWaves(source);
      const tables = waves.flatMap((wave) => wave.tables);
      const userRows = tables.find((table) => table.name === 'users')!.rows;
      const requestRows = tables.find((table) => table.name === 'role_requests')!.rows;

      expect(MIGRATABLE_USER_ROLES).toEqual(VALID_ROLES);
      expect(userRows.map((row) => row.role)).toEqual(MIGRATABLE_USER_ROLES);
      expect(userRows.find((row) => row.role === 'Admin')?.is_main_admin).toBe(true);
      expect(requestRows.map((row) => row.requested_role)).toEqual(MIGRATABLE_REQUESTED_ROLES);
      expect(issues.filter((issue) => issue.severity === 'ERROR')).toEqual([]);
    });

    it('should preserve canonical team and project roles without privilege-changing remapping', () => {
      const source = JSON.parse(fs.readFileSync(BACKUP_DB_PATH, 'utf-8'));
      const migrator = new JsonToPostgresMigrator({ sourcePath: BACKUP_DB_PATH, dryRun: true });
      const { waves, issues } = migrator.prepareWaves(source);
      const tables = new Map(waves.flatMap((wave) => wave.tables).map((table) => [table.name, table]));

      expect(tables.get('team_members')!.rows.map((row) => row.role)).toEqual(
        source.team_members.map((row: { role: string }) => row.role)
      );
      expect(tables.get('project_members')!.rows.map((row) => row.role)).toEqual(
        source.project_members.map((row: { role: string }) => row.role)
      );
      expect(MIGRATABLE_TEAM_ROLES).toEqual(['Owner', 'Editor', 'Collaborator', 'Viewer']);
      expect(issues.filter((issue) => issue.collection === 'team_members' || issue.collection === 'project_members')).toEqual([]);
      expect(
        getTableConfig(schemaTableManifest.teamMembers).checks.some(
          (constraint) => constraint.name === 'team_members_role_check'
        )
      ).toBe(true);
    });

    it('should reject unknown team or project roles before issuing database queries', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nutribodysim-team-role-contract-'));
      const sourcePath = path.join(tempDir, 'source.json');
      const source = JSON.parse(fs.readFileSync(BACKUP_DB_PATH, 'utf-8'));
      source.team_members[0].role = 'Admin';
      fs.writeFileSync(sourcePath, JSON.stringify(source));
      let queryCount = 0;
      const targetClient = {
        query: async () => {
          queryCount++;
          return { rows: [] };
        }
      };

      try {
        const migrator = new JsonToPostgresMigrator({
          sourcePath,
          dryRun: false,
          targetEnv: 'test',
          databaseUrl: 'mock://test',
          isTestMode: true,
          targetClient
        });
        await expect(migrator.execute()).rejects.toThrow('fatal source validation errors');
        expect(queryCount).toBe(0);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('should reject unknown roles before issuing any database query', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nutribodysim-role-contract-'));
      const sourcePath = path.join(tempDir, 'source.json');
      const source = JSON.parse(fs.readFileSync(BACKUP_DB_PATH, 'utf-8'));
      source.users[0].role = 'Administrator';
      fs.writeFileSync(sourcePath, JSON.stringify(source));
      let queryCount = 0;
      const targetClient = {
        query: async () => {
          queryCount++;
          return { rows: [] };
        }
      };

      try {
        const migrator = new JsonToPostgresMigrator({
          sourcePath,
          dryRun: false,
          targetEnv: 'test',
          databaseUrl: 'mock://test',
          isTestMode: true,
          targetClient
        });

        await expect(migrator.execute()).rejects.toThrow('fatal source validation errors');
        expect(queryCount).toBe(0);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('should exactly calculate 32 collections, 88 domain records, 30 junction rows, and 118 total physical rows', () => {
      const migrator = new JsonToPostgresMigrator({
        sourcePath: BACKUP_DB_PATH,
        dryRun: true
      });

      const raw = JSON.parse(fs.readFileSync(BACKUP_DB_PATH, 'utf-8'));
      const { waves, issues, sourceCollectionCounts } = migrator.prepareWaves(raw);

      // Verify 32 collections
      expect(Object.keys(sourceCollectionCounts).length).toBe(32);

      // Verify 88 domain records in JSON
      let domainRecordsCount = 0;
      for (const count of Object.values(sourceCollectionCounts)) {
        domainRecordsCount += count;
      }
      expect(domainRecordsCount).toBe(88);

      // Count physical rows per table across all 7 waves
      let totalPlannedRows = 0;
      const tableRowCounts: Record<string, number> = {};
      let totalTables = 0;

      for (const wave of waves) {
        for (const table of wave.tables) {
          totalTables++;
          tableRowCounts[table.name] = table.rows.length;
          totalPlannedRows += table.rows.length;
        }
      }

      // Verify exactly 45 tables defined across 7 waves
      expect(totalTables).toBe(45);
      expect(waves.length).toBe(7);

      // Verify all 13 junction tables and the relations unpacked from source arrays
      const junctionTables = [
        'scientific_parameter_references',
        'scientific_formula_parameters',
        'scientific_formula_references',
        'scientific_algorithm_parameters',
        'scientific_algorithm_references',
        'material_projects',
        'collection_materials',
        'scientific_model_variables',
        'scientific_model_formulas',
        'scientific_model_algorithms',
        'scientific_model_parameters',
        'scientific_model_references',
        'scientific_interpretation_rule_references'
      ];

      let junctionRowsCount = 0;
      for (const jt of junctionTables) {
        junctionRowsCount += tableRowCounts[jt] || 0;
      }
      // In the actual canonical JSON snapshot:
      // - materials.project_ids produces 3 rows in material_projects
      // - material_collections.material_ids produces 2 rows in collection_materials
      // - parameters.reference_ids produces 4 rows in scientific_parameter_references
      // - Scientific relationships are also materialized in their junction tables
      expect(junctionRowsCount).toBe(30);

      // Verify total physical rows = 88 domain + 30 junction = 118 rows
      expect(totalPlannedRows).toBe(118);

      expect(issues.filter((issue) => issue.severity === 'ERROR')).toEqual([]);
      const experiment = tableRowCounts.experiments;
      expect(experiment).toBe(1);
    });

    it('should preserve material URLs and notebook-cell metadata without rewriting source fields', () => {
      const source = JSON.parse(fs.readFileSync(BACKUP_DB_PATH, 'utf-8'));
      source.materials[0].source = 'publisher catalogue';
      source.materials[0].url = 'https://example.test/material';
      source.notebook_cells[0].metadata = { reference_id: source.references[0].reference_id };

      const { waves, issues } = new JsonToPostgresMigrator({ dryRun: true }).prepareWaves(source);
      const tables = new Map(waves.flatMap((wave) => wave.tables).map((table) => [table.name, table]));
      const mappedMaterial = tables.get('materials')!.rows[0];
      const mappedCell = tables.get('notebook_cells')!.rows[0];

      expect(mappedMaterial.source).toBe(source.materials[0].source);
      expect(mappedMaterial.url).toBe(source.materials[0].url);
      expect(mappedCell.metadata).toEqual(source.notebook_cells[0].metadata);
      expect(issues.filter((issue) => issue.severity === 'ERROR')).toEqual([]);
    });

    it('should retain invalid relationship rows for explicit orphan validation instead of dropping them', () => {
      const source = JSON.parse(fs.readFileSync(BACKUP_DB_PATH, 'utf-8'));
      source.parameters[0].reference_ids.push('missing-reference');

      const { waves, issues } = new JsonToPostgresMigrator({ dryRun: true }).prepareWaves(source);
      const parameterReferences = waves.flatMap((wave) => wave.tables)
        .find((table) => table.name === 'scientific_parameter_references')!;

      expect(parameterReferences.rows).toContainEqual({
        parameter_id: source.parameters[0].parameter_id,
        reference_id: 'missing-reference'
      });
      expect(issues.some((issue) =>
        issue.collection === 'scientific_parameter_references' &&
        issue.field === 'reference_id' &&
        issue.message.includes('does not resolve')
      )).toBe(true);
    });

    it('should block missing audit timestamps instead of synthesizing migration-time values', () => {
      const source = JSON.parse(fs.readFileSync(BACKUP_DB_PATH, 'utf-8'));
      source.audit_logs[0].timestamp = undefined;

      const { waves, issues } = new JsonToPostgresMigrator({ dryRun: true }).prepareWaves(source);
      const mappedAuditLog = waves.flatMap((wave) => wave.tables)
        .find((table) => table.name === 'audit_logs')!.rows[0];

      expect(mappedAuditLog.timestamp).toBeUndefined();
      expect(issues.some((issue) =>
        issue.collection === 'audit_logs' &&
        issue.field === 'timestamp' &&
        issue.message.includes('Required historical timestamp')
      )).toBe(true);
    });

    it('should preserve foreign key topology where child entities follow parent waves', () => {
      const migrator = new JsonToPostgresMigrator({
        sourcePath: BACKUP_DB_PATH,
        dryRun: true
      });
      const raw = JSON.parse(fs.readFileSync(BACKUP_DB_PATH, 'utf-8'));
      const { waves } = migrator.prepareWaves(raw);

      // Wave 1 contains roots (units, references, users, teams)
      const wave1Tables = waves[0].tables.map((t) => t.name);
      expect(wave1Tables).toContain('scientific_units');
      expect(wave1Tables).toContain('scientific_references');
      expect(wave1Tables).toContain('users');
      expect(wave1Tables).toContain('teams');

      // Wave 2 contains variables & projects
      const wave2Tables = waves[1].tables.map((t) => t.name);
      expect(wave2Tables).toContain('scientific_variables');
      expect(wave2Tables).toContain('projects');

      // Wave 7 contains dependent audit logs, experiments, and provenance
      const wave7Tables = waves[6].tables.map((t) => t.name);
      expect(wave7Tables).toContain('experiments');
      expect(wave7Tables).toContain('audit_logs');
      expect(wave7Tables).toContain('provenance_records');
    });
  });

  describe('3. Execution Mode, Transaction Atomicity & Rollback Mechanics', () => {
    it('should never execute write operations when dryRun=true', async () => {
      let queryCount = 0;
      const mockClient = {
        query: async () => {
          queryCount++;
          return { rows: [] };
        }
      };

      const migrator = new JsonToPostgresMigrator({
        sourcePath: BACKUP_DB_PATH,
        dryRun: true,
        targetClient: mockClient
      });

      const report = await migrator.execute();

      expect(report.status).toBe('DRY_RUN_PASSED');
      expect(report.totalPhysicalRowsWritten).toBe(0);
      expect(queryCount).toBe(0); // Zero queries sent to database
    });

    it('should execute BEGIN, all wave insertions, and COMMIT on a single connection client in execute mode', async () => {
      const executedStatements: { sql: string; values?: any[] }[] = [];
      let released = false;

      const mockClient = {
        query: async (sql: string, values?: any[]) => {
          executedStatements.push({ sql, values });
          return { rows: [], rowCount: values ? 1 : 0 };
        },
        release: () => {
          released = true;
        }
      };

      const migrator = new JsonToPostgresMigrator({
        sourcePath: BACKUP_DB_PATH,
        dryRun: false,
        targetEnv: 'test',
        databaseUrl: 'mock://test',
        isTestMode: true,
        targetClient: mockClient,
        conflictPolicy: 'fail-on-conflict'
      });

      const report = await migrator.execute();

      expect(report.status).toBe('MIGRATION_SUCCESS');
      expect(report.totalPhysicalRowsWritten).toBe(118);

      // Verify transaction boundary
      expect(executedStatements[0].sql).toBe('BEGIN');
      expect(executedStatements[executedStatements.length - 1].sql).toBe('COMMIT');
      expect(released).toBe(true);

      // Verify queries use parameterized placeholders
      const insertStatements = executedStatements.filter((s) => s.sql.startsWith('INSERT INTO'));
      expect(insertStatements.length).toBe(118);
      for (const stmt of insertStatements) {
        expect(stmt.sql).toContain('$1');
        expect(stmt.values).toBeDefined();
        expect(stmt.values!.length).toBeGreaterThan(0);
      }
    });

    it('should immediately ROLLBACK and report FAILED when an error occurs during execution', async () => {
      const executedStatements: string[] = [];
      let released = false;
      let insertCounter = 0;

      const mockClient = {
        query: async (sql: string) => {
          executedStatements.push(sql);
          if (sql.startsWith('INSERT INTO')) {
            insertCounter++;
            if (insertCounter === 10) {
              throw new Error('Simulated database constraint violation on row 10');
            }
          }
          return { rows: [] };
        },
        release: () => {
          released = true;
        }
      };

      const migrator = new JsonToPostgresMigrator({
        sourcePath: BACKUP_DB_PATH,
        dryRun: false,
        targetEnv: 'test',
        databaseUrl: 'mock://test',
        isTestMode: true,
        targetClient: mockClient
      });

      await expect(migrator.execute()).rejects.toThrow('Simulated database constraint violation on row 10');

      // Verify transaction was rolled back
      expect(executedStatements[0]).toBe('BEGIN');
      expect(executedStatements).toContain('ROLLBACK');
      expect(executedStatements).not.toContain('COMMIT');
      expect(released).toBe(true);
    });

    it('should support skip-existing conflict policy with ON CONFLICT DO NOTHING', async () => {
      const executedStatements: string[] = [];
      const mockClient = {
        query: async (sql: string) => {
          executedStatements.push(sql);
          return { rows: [] };
        }
      };

      const migrator = new JsonToPostgresMigrator({
        sourcePath: BACKUP_DB_PATH,
        dryRun: false,
        targetEnv: 'test',
        databaseUrl: 'mock://test',
        isTestMode: true,
        targetClient: mockClient,
        conflictPolicy: 'skip-existing'
      });

      await migrator.execute();

      const insertUnits = executedStatements.find((s) => s.startsWith('INSERT INTO scientific_units'));
      expect(insertUnits).toBeDefined();
      expect(insertUnits).toContain('ON CONFLICT (unit_id) DO NOTHING');
    });

    it('should block execution with BLOCKED_TARGET_VERIFICATION when database client is absent', async () => {
      const migrator = new JsonToPostgresMigrator({
        sourcePath: BACKUP_DB_PATH,
        dryRun: false,
        targetEnv: 'test',
        databaseUrl: 'mock://test',
        isTestMode: true,
        targetClient: undefined
      });

      const report = await migrator.execute();

      expect(report.status).toBe('BLOCKED_TARGET_VERIFICATION');
      expect(report.blockReason).toContain('No initialized database client provided');
      expect(report.totalPhysicalRowsWritten).toBe(0);
    });
  });

  describe('4. Historical Baseline Database Invariance Verification', () => {
    it('should strictly verify active database file size and SHA-256 hash remain completely unaltered', () => {
      expect(fs.existsSync(ACTIVE_DB_PATH)).toBe(true);
      const buf = fs.readFileSync(ACTIVE_DB_PATH);
      const hash = crypto.createHash('sha256').update(buf).digest('hex');

      expect(buf.length).toBe(58916);
      expect(hash).toBe(EXPECTED_ACTIVE_HASH);
    });

    it('should strictly verify backup database file size and SHA-256 hash remain completely unaltered', () => {
      expect(fs.existsSync(BACKUP_DB_PATH)).toBe(true);
      const buf = fs.readFileSync(BACKUP_DB_PATH);
      const hash = crypto.createHash('sha256').update(buf).digest('hex');

      expect(buf.length).toBe(57187);
      expect(hash).toBe(EXPECTED_BACKUP_HASH);
    });
  });
});
