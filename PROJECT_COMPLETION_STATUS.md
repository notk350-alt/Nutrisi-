# NutriBodySim Project Completion Status

Status diperbarui: 2026-11-02

## Overall

**BLOCKED - STAGING TRIAL NOT DEPLOYED.** Production was not activated. No staging DDL, credential provisioning, deployment, or data mutation was performed in this continuation.

## Completion Evidence

Each row uses exactly one requested evidence status.

| Work item | Status | Evidence / remaining work |
|---|---|---|
| Staging target and audit snapshot | VERIFIED IN STAGING | Read-only probe: `neondb/public`, branch `br-billowing-band-b53087vi`, TLS verified, 47 public tables, 8 audit rows, 0 sessions, 0 OIDC transactions. Connected role is `neondb_owner`; it has CREATEROLE/CREATEDB/REPLICATION/BYPASSRLS, schema CREATE, and audit UPDATE/DELETE/TRUNCATE. Both triggers are enabled and SECURITY INVOKER, but their function `search_path` is unset. |
| Runtime role guard and migration separation | VERIFIED IN CODE | Runtime requires exact `DATABASE_RUNTIME_ROLE`; migrator and Drizzle require `MIGRATION_DATABASE_URL` and a distinct `DATABASE_MIGRATION_ROLE`. Migration preflight verifies actual connected login, owner membership, target, TLS, and role flags. |
| Role migration and rollback SQL | VERIFIED IN LOCAL POSTGRES | PostgreSQL 16 disposable DB: schema + E1B9 tables, role migration applied twice, rollback revoked app ACLs without deleting test audit rows, migration reapplied, and runtime access restored. Staging SQL was not run. |
| Runtime app-role privileges | VERIFIED IN LOCAL POSTGRES | App principal has audit SELECT/INSERT only; CREATE, trigger disable/drop, audit UPDATE/DELETE/TRUNCATE denied. It is not owner/member of owner. Migrator principal is distinct, owner member, and has no cluster-level elevated flags. |
| Persistent session/OIDC/audit behavior | VERIFIED IN LOCAL POSTGRES | Two integration tests passed: independent pool reads, OIDC single-use consumption/replay rejection, audit append/read, runtime pool reinitialization persistence, failed PostgreSQL startup without provider fallback, and reconnect to valid local DB. Not a real server-process restart or staging outage test. |
| OIDC protocol and popup flow | VERIFIED BY AUTOMATED TEST | Mock RS256 callback, state/nonce/PKCE, issuer/audience/expiry/email_verified validation, least-privilege provisioning, persisted session, and user DTO are covered. |
| Demo/RBAC and directory guard | VERIFIED BY AUTOMATED TEST | Demo is restricted to development/test; user-list endpoint is gated; role/session tests pass. Full staging four-role workflow is not evidenced. |
| Scientific browser crypto | VERIFIED BY AUTOMATED TEST | Portable SHA-256 vectors pass and scientific suite passes; formulas/canonical payloads are unchanged. |
| Full local suite and typecheck | VERIFIED BY AUTOMATED TEST | 68 test files passed, 1 PostgreSQL integration file skipped by default; 1,693 tests passed, 2 skipped. `npm run lint` passed. |
| Frontend production build | VERIFIED BY AUTOMATED TEST | Build passed. Entry chunk 252.40 kB (79.02 kB gzip), down from 1,472.16 kB; Dashboard 36.70 kB; Research 319.53 kB; 3D 575.19 kB is on-demand. A large on-demand 3D chunk warning remains. |
| Dependency reproducibility/security | VERIFIED BY AUTOMATED TEST | Bun 1.3.8 frozen install passed with no changes; Bun audit reports no vulnerabilities; Drizzle CLI config check passed. `npm audit` unavailable without npm lockfile. |
| Real Google account login | BLOCKED | No Google client, redirect registration, approved HTTPS staging host, or staging secret-manager config is present. |
| Live least-privilege deployment | BLOCKED | Staging still uses owner-level connection. Role migration/rollback are prepared and locally verified, but a restore-tested backup is not evidenced; no staging DDL was run. |
| Shared OIDC rate limiting | NOT IMPLEMENTED | No shared/distributed limit is present for initiation/callback; required before a real multi-instance trial. |
| Staging deployment and first user trial | BLOCKED | No hosting/domain deployment manifest or staging URL is available; see `FIRST_TRIAL_GUIDE.md` for prerequisites. |
| Production activation | BLOCKED | Explicitly not authorized and not attempted. |

## Constraints and Blockers

- The pre-existing worktree is substantially dirty, including JSON data, reports, local tests, and uploaded files. All were preserved.
- The only staging DB action was a read-only probe; no DDL or data mutation occurred.
- A recoverable, restore-tested PostgreSQL staging backup is not evidenced. Staging role migration remains blocked until its availability and restore procedure are verified.
- `DATABASE_URL` is set but identifies the current staging owner role. `MIGRATION_DATABASE_URL`, both expected role names, Google credentials, and staging host configuration are absent from this environment.
- OIDC endpoint initiation/callback has no shared multi-instance rate limiter; it must be implemented and tested before production acceptance.
- Production startup is intentionally blocked in `backend/database/runtime.ts` until the approved runtime-role/target design is implemented.
- Production environment activation is prohibited.

## Required Evidence Statuses

Use only: `VERIFIED IN CODE`, `VERIFIED BY AUTOMATED TEST`, `VERIFIED IN LOCAL POSTGRES`, `VERIFIED IN STAGING`, `VERIFIED WITH REAL GOOGLE ACCOUNT`, `VERIFIED IN PRODUCTION`, `BLOCKED`, `NOT IMPLEMENTED`.

`VERIFIED WITH REAL GOOGLE ACCOUNT` and `VERIFIED IN PRODUCTION` have no current evidence. Earlier F0 reports remain historical and are not promoted to current verification.