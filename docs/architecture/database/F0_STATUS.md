# F0 Status

**Status: PARTIAL — staging acceptance not complete.**

## Verified in this continuation

- Previous E1B9 marker and cleanup state recovered before new live OIDC writes.
- Staging identity/TLS/provider confirmed: `neondb/public`, Neon branch `br-billowing-band-b53087vi`, PostgreSQL provider, authorized TLS.
- Direct `COUNT(*)` for all 45 manifest tables: total 125, including seven intentionally preserved historical audit events.
- `runtime_sessions=0`, `oidc_transactions=0`; no old listeners on ports 3111–3113.
- Actual OIDC runtime orchestration selected the PostgreSQL transaction repository. A second process read/consumed the transaction; state hash and PKCE S256 were checked; replay was rejected; the exact transaction was deleted.
- Audit append-only triggers rejected content update, delete, and truncate. The existing user FK `ON DELETE SET NULL` behavior was tested inside a rolled-back transaction.
- 77/77 foreign keys validated; no table lacked a primary key.
- `npm test -- --maxWorkers=1 --no-file-parallelism --reporter=dot`: 64 files / 1,657 tests passed; `npm run lint` and `npm run build` passed.
- JSON sizes and SHA-256 values match recovered baselines.

## Blockers and gaps

- The staging connection role `neondb_owner` can disable/drop audit triggers and has `CREATEROLE`, `CREATEDB`, `REPLICATION`, and `BYPASSRLS`. A least-privilege runtime-role design proposal is authorized, but implementation is not. See [F0_RUNTIME_ROLE_DESIGN_PROPOSAL.md](./F0_RUNTIME_ROLE_DESIGN_PROPOSAL.md).
- Full live session, route, BOLA, RBAC/Main Administrator, HTTP two-server, restart, and outage acceptance is not independently verified here. Historical reports are labelled as such in [F0_ACCEPTANCE_REPORT.md](./F0_ACCEPTANCE_REPORT.md).
- The full-row identity comparison is incomplete; current row counts and the seven known audit IDs were checked.
- Default parallel `npm test` was terminated by SIGTERM twice; the serial full suite then passed. Build warnings remain documented.

## Worktree and changes

The repository was dirty before this continuation. Existing tracked and untracked changes—including runtime, repositories, route/auth changes, JSON, local test DBs, and storage files—were preserved. This continuation changed only [E1B9_RUNTIME_AUTH_TABLES.sql](./E1B9_RUNTIME_AUTH_TABLES.sql) and added the nine F0 reports. No commit was made; no JSON, runtime code, route, authentication, or scientific code was changed.

See:

- [F0_E1B9_SPECIFICATION.md](./F0_E1B9_SPECIFICATION.md)
- [F0_RECOVERY_AUDIT.md](./F0_RECOVERY_AUDIT.md)
- [F0_IMPLEMENTATION_REPORT.md](./F0_IMPLEMENTATION_REPORT.md)
- [F0_TEST_REPORT.md](./F0_TEST_REPORT.md)
- [F0_SECURITY_FINDINGS.md](./F0_SECURITY_FINDINGS.md)
- [F0_RUNTIME_ROLE_DESIGN_PROPOSAL.md](./F0_RUNTIME_ROLE_DESIGN_PROPOSAL.md)
- [F0_DATA_INTEGRITY_REPORT.md](./F0_DATA_INTEGRITY_REPORT.md)
- [F0_CLEANUP_REPORT.md](./F0_CLEANUP_REPORT.md)
- [F0_ACCEPTANCE_REPORT.md](./F0_ACCEPTANCE_REPORT.md)

Production activation, cutover, and F1 remain prohibited.
