/**
 * NutriBodySim — PostgreSQL Migration CLI Runner (MVS-B2.5E.1B.5)
 *
 * Usage:
 *   npx tsx scripts/run-migration.ts [--dry-run]
 *   npx tsx scripts/run-migration.ts --execute --target-env=staging [--conflict-policy=fail-on-conflict|skip-existing]
 */

import path from 'path';
import pg from 'pg';
import { JsonToPostgresMigrator, ConflictPolicy } from '../backend/database/migration/jsonToPostgresMigrator';
import { TargetSafetyGuard } from '../backend/database/migration/targetSafetyGuard';

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
  const databaseUrl = process.env.DATABASE_URL;
  if (!isDryRun) {
    const guardResult = TargetSafetyGuard.validate({
      targetEnv,
      databaseUrl
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
    pool = new pg.Pool({
      connectionString: databaseUrl,
      max: 2,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 5000,
      ssl: databaseUrl.includes('localhost') ? false : { rejectUnauthorized: false }
    });
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
