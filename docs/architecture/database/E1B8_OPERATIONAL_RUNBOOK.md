# NutriBodySim — PostgreSQL Migration, Operational Runbook & Cutover Protocol
**Milestone**: MVS-B2.5E.1B.5 – E.1B.8  
**Scope**: Migration Execution, Verification, Rollback, Asset Integrity, and Production Cutover  
**Document Status**: AUTHORIZED FOR STAGING & PLANNING — PRODUCTION CUTOVER REQUIRES EXPLICIT AUTHORIZATION  

---

## 1. Executive Summary & Core Principles

This runbook establishes standard operating procedures for migrating NutriBodySim from its historical single-file JSON storage (`data/nutribodysim_db.json`) to an enterprise-grade PostgreSQL relational schema managed via Drizzle ORM.

### Key Guarantees
1. **Zero Data Loss**: Strict cryptographic verification (SHA-256) of legacy state prior to any migration actions.
2. **Determinism**: 7-wave topological ingestion ensuring parent records exist before foreign key relations are resolved.
3. **No Dual-Writers**: At no point shall both JSON and PostgreSQL adapters accept live concurrent writes.
4. **Instant Rollback**: Immediate zero-friction fallback to the JSON engine by reverting configuration if any gate fails.
5. **Scientific Engine Isolation**: The core scientific computation library (`scientific/**`) remains completely decoupled from persistence details.

---

## 2. Pre-Migration Prerequisites & Environment Configuration

### 2.1 Target Infrastructure Requirements
- **PostgreSQL Version**: 15+ (PostgreSQL 16 recommended).
- **Extensions**: `pgcrypto` or `uuid-ossp` for UUID utilities.
- **Connection String**: Provided via standard environment variable `DATABASE_URL`.
  ```bash
  DATABASE_URL="postgres://nutri_user:strong_password@prod-db.internal:5432/nutribodysim?sslmode=require"
  ```
- **Connection Pool Configuration**:
  - Maximum connections: 20 per app instance.
  - Idle timeout: 10,000 ms.
  - Connection timeout: 5,000 ms.

### 2.2 Storage Engine & Directory Verification
Verify write permissions and disk space on the migration host:
```bash
# Verify materials asset directory exists
ls -la storage/materials/
# Verify database files
ls -la data/nutribodysim_db.json data/nutribodysim_db.backup.json
```

---

## 3. Pre-Migration Baseline & Snapshot Procedure

Before initiating any database migration or applying DDL schemas, take an immutable snapshot of both the active database and file assets.

### 3.1 Checksum Verification
Execute the SHA-256 integrity verification:
```bash
sha256sum data/nutribodysim_db.json
sha256sum data/nutribodysim_db.backup.json
```
**Expected Historical SHA-256 Checksum**:
`a7f7cfa135e5b8c4be091cff49f5b1e2ecc88514776b8f908bd3ccf0d188af14` (Exactly 57,187 bytes).

### 3.2 Cold Backup Creation
```bash
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
mkdir -p backups/pre_migration_${TIMESTAMP}
cp -p data/nutribodysim_db.json backups/pre_migration_${TIMESTAMP}/nutribodysim_db.json
cp -p data/nutribodysim_db.backup.json backups/pre_migration_${TIMESTAMP}/nutribodysim_db.backup.json
tar -czf backups/pre_migration_${TIMESTAMP}/materials_assets.tar.gz storage/materials/
```

Verify archive integrity:
```bash
tar -tzf backups/pre_migration_${TIMESTAMP}/materials_assets.tar.gz > /dev/null
echo "Backup successfully archived and validated."
```

---

## 4. Migration Execution Procedure

The migration is executed through the offline determinism engine `scripts/run-migration.ts`.

### 4.1 Step 1: Pre-Migration Dry-Run Gate
Always run the dry-run simulation first to test JSON extraction, foreign key graph consistency, and record transformation without network side effects:
```bash
npx tsx scripts/run-migration.ts --dry-run
```
**Gate Requirement**:
- Exit code must be `0`.
- All 32 collections parsed successfully.
- 0 fatal integrity errors.
- Output report `docs/architecture/database/E1B5_MIGRATION_AUDIT_REPORT.json` generated.

### 4.2 Step 2: PostgreSQL DDL Schema Provisioning
Provision the clean relational schema (45 tables: 32 domain + 13 junction tables) against the target database:
```bash
# Using DDL SQL script directly:
psql "$DATABASE_URL" -f docs/architecture/database/E1B3_POSTGRESQL_SCHEMA.sql
```
*Note: Verify table creation count:*
```sql
SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';
-- Expected: 45 tables
```

### 4.3 Step 3: Live Data Ingestion
Execute the migration tool against the provisioned database:
```bash
npx tsx scripts/run-migration.ts --execute
```
The migration proceeds sequentially across the 7 topological waves:
1. **Wave 1 — Independent Identifiers**: `users`, `units`, `external_identities`, `role_requests` (18 records).
2. **Wave 2 — Core Science & Collaboration Roots**: `variables`, `teams`, `projects` (13 records).
3. **Wave 3 — Formulas & Parameters**: `parameters`, `formulas` (7 records).
4. **Wave 4 — Algorithms, Materials & Team Memberships**: `algorithms`, `materials`, `team_members`, `project_members`, `material_collections` (18 records).
5. **Wave 5 — Models, Datasets & Reading State**: `models`, `datasets`, `reading_progress`, `bookmarks`, `highlights`, `notes` (16 records).
6. **Wave 6 — Interpretations, Notebooks, Calculations & Versions**: `interpretation_rules`, `notebooks`, `calculations`, `dataset_versions`, `statistics_analyses`, `charts` (11 records).
7. **Wave 7 — Dependent Artifacts & Audit Logs**: `notebook_cells`, `code_executions`, `experiments`, `audit_logs`, `provenance_records` (5 records).

**Total Migrated Records**: Exactly 88 records distributed across 45 target tables.

---

## 5. Post-Migration Verification & Acceptance Gates

Execute the post-migration audit script and queries to verify completeness:

### 5.1 Record Count Reconciliations
Run query on PostgreSQL to match JSON collection totals:
```sql
SELECT 'users' AS entity, count(*) FROM users
UNION ALL SELECT 'projects', count(*) FROM projects
UNION ALL SELECT 'materials', count(*) FROM materials
UNION ALL SELECT 'datasets', count(*) FROM datasets
UNION ALL SELECT 'scientific_variables', count(*) FROM scientific_variables
UNION ALL SELECT 'scientific_formulas', count(*) FROM scientific_formulas
UNION ALL SELECT 'scientific_algorithms', count(*) FROM scientific_algorithms
UNION ALL SELECT 'scientific_models', count(*) FROM scientific_models
UNION ALL SELECT 'audit_logs', count(*) FROM audit_logs;
```

### 5.2 Referential Integrity Validation
Run consistency query checking for orphaned foreign keys:
```sql
-- Check project owners
SELECT p.id, p.owner_id FROM projects p LEFT JOIN users u ON p.owner_id = u.id WHERE u.id IS NULL;
-- Check formula variables
SELECT fv.formula_id, fv.variable_id FROM formula_variables fv LEFT JOIN scientific_variables sv ON fv.variable_id = sv.id WHERE sv.id IS NULL;
```
*Expected result: 0 rows returned for both queries.*

### 5.3 Special Design Decision Assertions
1. **`experiments.experimental_model_id`**:
   The baseline record `exp-1` contains model reference `'MODEL_DEMO_ANTHROPOMETRY_V1_CLONE'`. This clone tag is preserved as a text identifier and must not cause foreign key errors.
2. **`scientific_units.symbol`**:
   Verify unique constraint on symbol to ensure variables (`variables.unit`) resolve consistently.
3. **No Password Hash**:
   Verify `users` table has no password column; authentication is session & OIDC-based.

---

## 6. Physical File & Asset Storage Management

NutriBodySim manages uploaded files, scientific papers, and material attachments in `storage/materials/`.

### 6.1 Storage Strategy
- **Database Role**: PostgreSQL stores metadata, mime-types, file sizes, SHA-256 hashes, and local relative file paths in table `materials`.
- **Filesystem Role**: Physical binaries reside in `storage/materials/{material_id}.{ext}` or object storage (GCS/S3 in cloud deployments).
- **Integrity Rule**: During migration, no file assets are relocated. File references in `materials.file_path` are normalized relative to root.
- **Integrity Check**:
  ```bash
  # Check if all registered files in materials exist on disk
  npx tsx -e "
    const fs = require('fs');
    const db = JSON.parse(fs.readFileSync('data/nutribodysim_db.json'));
    db.materials.forEach(m => {
      if (m.file_path && !fs.existsSync(m.file_path)) {
        console.warn('Missing asset:', m.file_path);
      }
    });
    console.log('Asset path scan completed.');
  "
  ```

---

## 7. Rollback & Disaster Recovery Protocol

If any verification gate fails, anomalies are detected during staging testing, or data inconsistency occurs:

### 7.1 Abort Criteria (Automatic Rollback Triggers)
- Migration tool encounters an unhandled rejection or database connection loss.
- Row counts in PostgreSQL do not match the expected 88 records.
- Foreign key violation detected during topological wave execution.
- Any regression observed in the domain contract tests.

### 7.2 Immediate Rollback Procedure (Zero Downtime / Zero Loss)
1. **Automatic Transaction Rollback**:
   The migrator runs all 7 waves within an atomic PostgreSQL transaction (`BEGIN ... COMMIT`).
   - If an error occurs at any point before `COMMIT`, PostgreSQL immediately executes `ROLLBACK`.
   - The database remains 100% clean with zero partial writes. No manual table dropping is needed.
2. **Handling Connection Loss or Ambiguous Commit State**:
   - If connection terminates unexpectedly before receiving commit confirmation, do NOT rerun blindly.
   - Run audit query to verify whether rows exist:
     ```sql
     SELECT count(*) FROM users;
     ```
   - If row count is 0, transaction was rolled back cleanly by PostgreSQL connection drop; safe to retry.
   - If row count matches expected 4 users, verify full record manifest before proceeding.
3. **Staging Isolation via Branching**:
   - In Neon or modern cloud databases, perform migration against a disposable test branch (e.g. `migration-test`).
   - If aborted or corrupted, simply drop the test branch (`neon branches delete migration-test`) without touching primary staging or production.
4. **Isolated Manifest Table Teardown (Strictly Test/Staging Only)**:
   - NEVER use `DROP SCHEMA public CASCADE`, which destructively destroys schema permissions, extensions, and unrelated objects.
   - For an authorized reset of an isolated test database, drop ONLY the 45 NutriBodySim tables in reverse dependency order:
     ```sql
     DROP TABLE IF EXISTS
       audit_logs, provenance_records, scientific_calculations, experiments,
       code_executions, notebook_cells, notebooks, charts, statistics_analyses,
       dataset_versions, datasets, notes, highlights, bookmarks, reading_progress,
       collection_materials, material_collections, material_projects, materials,
       scientific_algorithm_references, scientific_algorithm_parameters, scientific_algorithms,
       project_members, team_members, scientific_formula_references, scientific_formula_parameters,
       scientific_formulas, scientific_parameter_references, scientific_parameters,
       projects, scientific_variables, teams, role_requests, external_identities, users,
       scientific_interpretation_rule_references, scientific_interpretation_rules,
       scientific_model_references, scientific_model_parameters, scientific_model_algorithms,
       scientific_model_formulas, scientific_model_variables, scientific_models,
       scientific_references, scientific_units CASCADE;
     ```
   - STRICT PROHIBITION: Never execute table teardown scripts on production or unverified targets.
5. **JSON Storage State Guarantee**:
   The application continues operating on the primary JSON engine (`STORAGE_ADAPTER=json`). The source database file remains completely isolated and read-only.
4. **Verify JSON Database Unmodified**:
   ```bash
   sha256sum data/nutribodysim_db.json
   # Must match: a7f7cfa135e5b8c4be091cff49f5b1e2ecc88514776b8f908bd3ccf0d188af14
   ```
   If hash differs for any reason, immediately restore from cold snapshot:
   ```bash
   cp backups/pre_migration_${TIMESTAMP}/nutribodysim_db.json data/nutribodysim_db.json
   ```
5. **Restart Application Services**:
   ```bash
   npm run start
   ```
6. **Log Incident & Post-Mortem**: Document root cause in `docs/architecture/database/MIGRATION_INCIDENTS.md`.

---

## 8. Production Cutover Protocol (When Authorized)

> ⚠️ **IMPORTANT**: Production cutover is **NOT AUTHORIZED** in milestone E.1B.8.  
> This protocol describes the authorized process for future milestone execution when explicit authorization is granted.

### 8.1 Maintenance Window Protocol
1. Announce scheduled maintenance window (recommended duration: 30 minutes).
2. Set API gateway / load balancer to read-only or maintenance mode (`503 Service Temporarily Unavailable` with maintenance page).
3. Drain all active client sessions and pending requests.

### 8.2 Execution Checklist
- [ ] **Step 1**: Freeze JSON store. Mark `data/nutribodysim_db.json` as read-only (`chmod 444`).
- [ ] **Step 2**: Take final pre-cutover cold snapshot with SHA-256 verification.
- [ ] **Step 3**: Run `npx tsx scripts/run-migration.ts --execute` against target PostgreSQL.
- [ ] **Step 4**: Run automated verification test suite (`npm test`).
- [ ] **Step 5**: Update application environment configuration:
  ```env
  STORAGE_ADAPTER=postgres
  DATABASE_URL=postgres://nutri_prod:secret@postgres-cluster.internal:5432/nutribodysim
  ```
- [ ] **Step 6**: Deploy application backend with `PostgresDatabaseRepositories` active.
- [ ] **Step 7**: Execute health checks on core endpoints (`/api/health`, `/api/auth/me`, `/api/projects`).
- [ ] **Step 8**: Disable maintenance mode; allow user traffic.
- [ ] **Step 9**: Post-cutover monitoring (monitor error rates, connection pool metrics, and transaction durations for 60 minutes).
