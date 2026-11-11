# Deployment and Recovery Guide

Status: **PREPARATION ONLY - NOT AUTHORIZED FOR PRODUCTION ACTIVATION**

## Environment Configuration

Use separate secret/config sets for development, staging, and production. Do not copy a live secret into `.env.example`, source control, chat, logs, or build output.

- `DATABASE_PROVIDER`: local development may leave this empty for the JSON adapter. PostgreSQL environments must set `postgres` explicitly. The current runtime only permits the approved staging target; production startup is intentionally rejected.
- `DATABASE_RUNTIME_ROLE`: exact PostgreSQL runtime login role. Runtime fails closed if absent or if the live role/ACL/trigger probe fails.
- `DATABASE_URL`: runtime-only connection to the restricted app principal; provide through a secret manager. Never print it.
- `DATABASE_MIGRATION_ROLE`: exact migration login role; must differ from the runtime role and match the migration connection URL username.
- `MIGRATION_DATABASE_URL`: migration-only connection to the owner-capable principal; never expose it to server processes. Drizzle tooling requires this URL and role configuration.
- `ENABLE_DEMO_AUTH`: keep `false` outside local development. Production ignores attempts to enable demo auth.
- `OIDC_ENABLED`: keep `false` until Google credentials and redirect/origin registration are configured and staging acceptance passes.
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`: inject only in the authorized environment. The redirect must be HTTPS except localhost development.
- `SESSION_TTL_SECONDS`: optional positive integer; malformed values fail configuration instead of silently receiving a default.
- `OIDC_TRANSACTION_TTL_SECONDS`, `OIDC_CLOCK_SKEW_SECONDS`: optional integer values subject to OIDC validation bounds.
- `OIDC_COOKIE_SECURE`: production must use `true`.

`.env.example` contains blank database/provider credentials, demo disabled, and OIDC disabled. Do not interpret that template as a production-ready secret bundle.

## Build and Local Verification

The checked Bun lockfile was verified with:

```bash
npx --yes bun@1.3.8 install --frozen-lockfile
npm run lint
npm test -- --maxWorkers=1 --no-file-parallelism --reporter=dot
npm run build
```

Current build emits a Vite warning for a 1,472.16 kB minified client chunk. Automated checks do not constitute staging or production acceptance.

Latest split build: entry JS 252.40 kB (79.02 kB gzip), down from 1,472.16 kB (360.74 kB gzip); Research 319.53 kB; 3D 575.19 kB loaded on demand. A warning remains for the on-demand 3D chunk.

## Database and Migration Safety

- Do not run a migration, cutover, reset, truncate, drop, or restore against the existing database as part of routine deployment.
- The prior operational runbook is authorized for staging/planning only. Its destructive isolated-test examples are not authorization to modify this project's existing databases.
- Before any future migration, obtain explicit target approval, verify target identity/TLS/branch, take an immutable database and asset backup, run dry-run validation, and use only the separately approved migration principal.
- Never use the current owner credential in an application process. Runtime/migration role separation is blocked pending approval and implementation from `F0_RUNTIME_ROLE_DESIGN_PROPOSAL.md`.
- The additive role migration and rollback are `docs/architecture/database/E1B10_RUNTIME_ROLE_MIGRATION.sql` and `E1B10_RUNTIME_ROLE_ROLLBACK.sql`. They were tested twice in a disposable PostgreSQL 16 database, not on staging. Do not execute on staging until a restorable backup is evidenced and the expected migration/runtime credentials are provisioned.
- For backup verification, create a protected, timestamped PostgreSQL custom-format dump using the approved backup principal, verify its archive listing and checksum, and keep the original database untouched. Restore tests must target a separately approved isolated database; never use destructive `--clean` against the source.
- JSON baseline files and `storage/materials/` assets are retained. The eight recovery audit records must not be removed.

## Health, Logging, and Shutdown

- `GET /health` checks application/repository availability and, for PostgreSQL, database identity and TLS.
- Database errors return a sanitized service-unavailable response. Do not add SQL values, connection strings, authorization codes, tokens, or secrets to logs.
- SIGINT/SIGTERM handlers drain the HTTP server, close Vite middleware where present, and close the database pool.
- Do not configure JSON or memory fallback for an environment that requires PostgreSQL. A PostgreSQL initialization failure must remain a failure.

## Recovery Procedure

1. On a failed health check, preserve logs with secret redaction and confirm whether the failure is application, network, or database availability. Do not switch providers as an automatic fallback.
2. For a database outage, keep writes stopped until the approved PostgreSQL target is healthy. Retry only after connection recovery is verified; do not assume an ambiguous commit failed.
3. For an application process failure, restart only the application process after confirming the database target and pool configuration. Verify `/health`, session validation, and repository reads before resuming users.
4. For suspected data corruption, stop writes and preserve the affected database and assets. Restore a verified backup into an isolated recovery target first, compare manifests and audit history, and obtain explicit approval before any cutover.
5. Do not drop/recreate schemas or tables, truncate tables, replace JSON files, delete audit events, or use a restore command against the original database.

## Current Deployment Gate

Staging deployment remains blocked by the current owner-level runtime connection, absent backup/restore evidence, missing app/migrator secret configuration, missing HTTPS host/hosting access, missing Google OAuth configuration, absent shared multi-instance OIDC rate limiting, and untested live recovery workflows. Production activation is not authorized by this guide.