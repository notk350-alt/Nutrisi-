# Final Test Results

Date: 2026-11-02  
Overall: **LOCAL AUTOMATED AND POSTGRES CHECKS PASS; STAGING/REAL OAUTH ACCEPTANCE BLOCKED**

## Current Worktree Checks

| Check | Result | Evidence |
|---|---|---|
| TypeScript | PASS | `npm run lint` exited 0 (`tsc --noEmit`). |
| Unit/integration/regression | PASS | `npm test -- --maxWorkers=1 --no-file-parallelism --reporter=dot`: 68 files passed, 1 skipped; 1,693 tests passed, 2 skipped. |
| Production build | PASS WITH WARNING | `npm run build` exited 0. Initial entry: 252.40 kB / 79.02 kB gzip, down from 1,472.16 kB. Dashboard: 36.70 kB; Research: 319.53 kB; 3D: 575.19 kB on-demand. Vite still warns for the on-demand 3D chunk. |
| OIDC API integration | PASS | 8 focused tests include URL generation, disabled mode, configuration bounds, redirect policy, mock signed callback, provisioning, session validation, and provider denial. |
| Auth/session hardening | PASS | 22 focused tests include staging/production demo rejection, invalid TTL, and non-admin directory denial. |
| Local PostgreSQL roles | PASS | PostgreSQL 16 local test: app/migrator separation, no runtime DDL/audit mutation, trigger enabled/SECURITY INVOKER/search_path pinned, migration applied twice. |
| Local PostgreSQL integration | PASS | `npm run test:postgres-runtime` with dedicated loopback DB: 2 tests passed for session/OIDC/audit persistence, second pool, pool reinitialization, fail-closed startup, and reconnect. |
| Dependency lock reproducibility | PASS | Bun 1.3.8 frozen install: 240 installs / 331 packages checked, no changes. |
| Dependency vulnerability scan | PASS WITH CAVEAT | Bun audit reports no vulnerabilities after exact esbuild override. npm audit is unavailable because the project has no npm lockfile (`ENOLOCK`). |
| Drizzle migration config | PASS | `drizzle-kit check` succeeded using a dummy local migration identity; no database connection was made. |

## Not Verified

- Real Google Cloud consent, callback, key rotation, and production-origin behavior.
- Staging role migration; the staging read-only probe still shows `neondb_owner` with excessive privileges.
- Live staging callback/session/role matrix for the latest route code.
- Full-row database snapshot comparison and independent live BOLA/RBAC matrix.
- Database outage, reconnection, process restart, and independent HTTP multi-instance behavior.
- Backup and restore execution against an isolated staging target.
- Browser E2E on desktop/mobile.
- Production behavior. Production runtime activation is explicitly blocked and was not attempted.
- A restore-tested PostgreSQL staging backup. Local JSON backup files are not proof of a restorable PostgreSQL snapshot.

## Historical Evidence

`docs/architecture/database/F0_STATUS.md` and `F0_TEST_REPORT.md` report earlier staging checks and older test counts. The fresh staging evidence in this continuation is read-only identity/privilege/row-count inspection only; no staging migration, real OAuth, or deployment was done.