/**
 * NutriBodySim — PostgreSQL Migration CLI Runner (MVS-B2.5E.1B.5)
 *
 * Usage:
 *   npx tsx scripts/run-migration.ts [--dry-run]
 *   npx tsx scripts/run-migration.ts --execute --target-env=staging [--conflict-policy=fail-on-conflict|skip-existing]
 */

import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import type { TLSSocket } from 'tls';
import pg from 'pg';
import { JsonToPostgresMigrator, ConflictPolicy } from '../backend/database/migration/jsonToPostgresMigrator';
import { createPostgresPoolConfig } from '../backend/database/migration/postgresClientConfig';
import { TargetSafetyGuard } from '../backend/database/migration/targetSafetyGuard';

const EXPECTED_DATABASE = 'neondb';
const EXPECTED_BRANCH_ID = 'br-billowing-band-b53087vi';
const EXPECTED_SOURCE_SHA256 = 'a7f7cfa135e5b8c4be091cff49f5b1e2ecc88514776b8f908bd3ccf0d188af14';
const EXPECTED_SOURCE_SIZE = 57187;

function assertJsonBaseline(filePath: string): void {
  const contents = fs.readFileSync(filePath);
  const sha256 = crypto.createHash('sha256').update(contents).digest('hex');
  if (contents.length !== EXPECTED_SOURCE_SIZE || sha256 !== EXPECTED_SOURCE_SHA256) {
    throw new Error(`JSON integrity check failed for ${path.basename(filePath)}.`);
  }
}

async function verifyStagingPreflight(
  pool: pg.Pool,
    tables: { name: string; rows: Record<string, unknown>[] }[],
    expectedMigrationRole: string
): Promise<void> {
  const client = await pool.connect();
  let transactionOpen = false;

  try {
    const identityResult = await client.query<{
      database_name: string;
      current_schema: string | null;
      branch_id: string | null;
      public_schema_exists: boolean;
        migration_role: string;
        can_use_owner: boolean;
        is_superuser: boolean;
        can_create_role: boolean;
        can_create_database: boolean;
        can_replicate: boolean;
        can_bypass_rls: boolean;
    }>(`
      SELECT
        current_database() AS database_name,
        current_schema() AS current_schema,
        current_setting('neon.branch_id', true) AS branch_id,
        EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'public') AS public_schema_exists,
        r.rolname AS migration_role,
        pg_has_role(current_user, 'nutribodysim_owner', 'MEMBER') AS can_use_owner,
        r.rolsuper AS is_superuser,
        r.rolcreaterole AS can_create_role,
        r.rolcreatedb AS can_create_database,
        r.rolreplication AS can_replicate,
        r.rolbypassrls AS can_bypass_rls
        FROM pg_roles r
        WHERE r.rolname = current_user AND r.rolname = $1
      `, [expectedMigrationRole]);
    const identity = identityResult.rows[0];
    const tlsSocket = client.connection.stream as TLSSocket;
    const tlsVerified = tlsSocket.encrypted === true && tlsSocket.authorized === true;

    if (
        identity?.database_name !== EXPECTED_DATABASE ||
        identity?.current_schema !== 'public' ||
        identity?.branch_id !== EXPECTED_BRANCH_ID ||
        !tlsVerified ||
        identity?.public_schema_exists !== true ||
        identity?.migration_role !== expectedMigrationRole ||
        identity?.can_use_owner !== true ||
        identity?.is_superuser !== false ||
        identity?.can_create_role !== false ||
        identity?.can_create_database !== false ||
        identity?.can_replicate !== false ||
        identity?.can_bypass_rls !== false
    ) {
      throw new Error('Connected database, schema, branch, or verified TLS does not match the authorized staging target.');
    }
    console.log(`Verified staging target: database=${EXPECTED_DATABASE}, schema=public, branch=${EXPECTED_BRANCH_ID}, TLS=verified`);

    await client.query('BEGIN READ ONLY');
    transactionOpen = true;

    for (const table of tables) {
      try {
        const result = await client.query<{ count: string }>(
          `SELECT COUNT(*) FROM public."${table.name}"`
        );
        if (result.rows[0]?.count !== '0') {
          throw new Error(`Target table ${table.name} is not empty.`);
        }
      } catch (error) {
        const code = (error as { code?: string }).code;
        throw new Error(`Read-only preflight failed for table ${table.name}${code ? ` (database code ${code})` : ''}.`);
      }
    }

    await client.query('COMMIT');
    transactionOpen = false;
    console.log(`Read-only preflight passed: ${tables.length} manifest tables exist and are empty.`);
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.query('ROLLBACK');
        transactionOpen = false;
      } catch {
        throw new Error('Preflight failed and its read-only transaction could not be rolled back.');
      }
    }
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const isDryRun = !args.includes('--execute');

  const sourceArg = args.find((a) => a.startsWith('--source='));
  const reportArg = args.find((a) => a.startsWith('--report='));
  const targetEnvArg = args.find((a) => a.startsWith('--target-env='));
  const conflictArg = args.find((a) => a.startsWith('--conflict-policy='));

  const targetEnv = targetEnvArg ? targetEnvArg.split('=')[1] : isDryRun ? 'dry-run' : '';
  const conflictPolicy: ConflictPolicy = (conflictArg ? conflictArg.split('=')[1] : 'fail-on-conflict') as ConflictPolicy;

  const sourcePath = sourceArg
    ? sourceArg.split('=')[1]
    : path.resolve(process.cwd(), 'data', 'nutribodysim_db.json');

  const reportOutputPath = reportArg
    ? reportArg.split('=')[1]
    : path.resolve(process.cwd(), 'docs', 'architecture', 'database', 'E1B5_MIGRATION_AUDIT_REPORT.json');

  console.log('================================================================');
  console.log('NutriBodySim — PostgreSQL Deterministic Migration CLI Runner');
  console.log('================================================================');
  console.log(`Source Path:      ${sourcePath}`);
  console.log(`Execution Mode:   ${isDryRun ? 'DRY-RUN (Safe Read-Only Validation)' : 'PHYSICAL MIGRATION (--execute)'}`);
  console.log(`Target Env:       ${targetEnv || '[NOT_SPECIFIED]'}`);
  console.log(`Conflict Policy:  ${conflictPolicy}`);
  console.log(`Report Path:      ${reportOutputPath}`);
  console.log('----------------------------------------------------------------');

  // FAIL-CLOSED GATE 1: Physical execution requires explicit target environment
  if (!isDryRun && (!targetEnv || !['staging', 'test'].includes(targetEnv.toLowerCase()))) {
    console.error('FATAL SAFETY VIOLATION: Physical execution (--execute) strictly requires an explicit allowed target environment:');
    console.error('  Usage: npx tsx scripts/run-migration.ts --execute --target-env=staging');
    process.exit(1);
  }

  // FAIL-CLOSED GATE 2: Target parameter and URL safety check
  const databaseUrl = process.env.MIGRATION_DATABASE_URL;
  const migrationRole = process.env.DATABASE_MIGRATION_ROLE?.trim();
  const runtimeRole = process.env.DATABASE_RUNTIME_ROLE?.trim();
  if (!isDryRun) {
    if (!databaseUrl || !migrationRole || !runtimeRole || migrationRole === runtimeRole) {
      console.error('CRITICAL SAFETY BLOCK: Migration requires separate runtime/migration roles and a migration-only connection.');
      process.exit(1);
    }
    if (conflictPolicy !== 'fail-on-conflict') {
      console.error('CRITICAL SAFETY BLOCK: Staging migration requires --conflict-policy=fail-on-conflict.');
      process.exit(1);
    }

    const guardResult = TargetSafetyGuard.validate({
      targetEnv,
      databaseUrl,
      allowedDatabaseNames: [EXPECTED_DATABASE]
    });

    if (!guardResult.allowed) {
      console.error('CRITICAL SAFETY BLOCK: Target database verification failed:');
      console.error(`  Reason: ${guardResult.reason}`);
      console.error(`  Sanitized Host: ${guardResult.sanitizedHost || 'N/A'}`);
      console.error(`  Sanitized DB:   ${guardResult.sanitizedDatabase || 'N/A'}`);
      process.exit(1);
    }
  }

  let pool: pg.Pool | undefined;
  if (!isDryRun && databaseUrl) {
    pool = new pg.Pool(createPostgresPoolConfig(databaseUrl));
  }

  try {
    const migrator = new JsonToPostgresMigrator({
      sourcePath,
      dryRun: isDryRun,
      targetEnv: targetEnv || 'dry-run',
      databaseUrl,
      targetClient: pool,
      conflictPolicy,
      reportOutputPath
    });

    if (!isDryRun) {
      assertJsonBaseline(sourcePath);
      assertJsonBaseline(path.resolve(path.dirname(sourcePath), 'nutribodysim_db.backup.json'));
      const sourceDb = JSON.parse(fs.readFileSync(sourcePath, 'utf-8'));
      const { waves } = migrator.prepareWaves(sourceDb);
      const tables = waves.flatMap((wave) => wave.tables);
      if (tables.length !== 45 || new Set(tables.map((table) => table.name)).size !== 45) {
        throw new Error('Migration manifest must contain exactly 45 unique target tables.');
      }
      if (!pool) {
        throw new Error('Physical migration requires an initialized PostgreSQL connection pool.');
      }
        await verifyStagingPreflight(pool, tables, migrationRole!);
    }

    const report = await migrator.execute();

    console.log(`Status:                  ${report.status}`);
    console.log(`Source Checksum:         ${report.sourceSha256}`);
    console.log(`Source File Size:        ${report.sourceSizeBytes.toLocaleString()} bytes`);
    console.log(`Total Source Collections:${report.totalSourceCollections}`);
    console.log(`Total Source Records:    ${report.totalSourceRecords}`);
    console.log(`Total Target Tables:     ${report.totalTargetTables}`);
    console.log(`Total Rows Planned:      ${report.totalPhysicalRowsPlanned}`);
    console.log(`Total Rows Written:      ${report.totalPhysicalRowsWritten}`);
    console.log(`Duration:                ${report.durationMs}ms`);

    if (report.blockReason) {
      console.log(`\nBlock Reason:            ${report.blockReason}`);
    }

    if (report.issues.length > 0) {
      console.log('\nValidation & Dependency Issues Found:');
      report.issues.forEach((i) => {
        console.log(`  [${i.severity}] ${i.collection} (${i.recordId}): ${i.message}`);
      });
    }

    console.log(`\nAudit report generated at: ${reportOutputPath}`);

    if (report.status === 'FAILED') {
      process.exit(1);
    }
  } catch (err: any) {
    console.error('Fatal execution error:', err?.message || err);
    process.exit(1);
  } finally {
    if (pool) {
      await pool.end();
    }
  }
}

main().catch((err) => {
  console.error('Fatal CLI runner error:', err);
  process.exit(1);
});
