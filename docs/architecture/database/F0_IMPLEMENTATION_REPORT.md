# F0 Implementation Report

## Summary

The E1B9 implementation changes were already present in the worktree at the start of this continuation. They were preserved and tested; this continuation did not modify application runtime, authentication, routes, scientific code, JSON source, or database table definitions.

### Previously present implementation areas

- PostgreSQL runtime selection and fail-closed target/TLS checks in `backend/database/runtime.ts`.
- PostgreSQL repository adapters and schema for sessions and OIDC transactions.
- Runtime OIDC transaction-store selection in `backend/auth/oidc/runtimeTransactionStore.ts`, used by the OIDC orchestration and token-exchange paths.
- Fail-closed guards at authentication, role approval, Main Administrator bootstrap, and OIDC provisioning boundaries.
- Repository-backed route and object-authorization paths.
- Migration safety and target guards.

These are **VERIFIED IN CODE**. Automated verification results are in [F0_TEST_REPORT.md](./F0_TEST_REPORT.md); live evidence is separately classified in [F0_ACCEPTANCE_REPORT.md](./F0_ACCEPTANCE_REPORT.md).

## Finding F0-DB-001 — audit log rows were mutable

**Priority:** P1 data-integrity risk  
**Root cause:** Staging had no audit mutation trigger. The connected `neondb_owner` role possessed `UPDATE`, `DELETE`, and `TRUNCATE` privileges on `audit_logs`; application interfaces being append-only did not protect the table from direct SQL.

**Repair:** Added idempotent trigger functions and triggers to `E1B9_RUNTIME_AUTH_TABLES.sql`:

- `UPDATE` and `DELETE` are rejected with SQLSTATE `55000`, except an exact `user_id` non-NULL-to-NULL transition that leaves every other field identical.
- `TRUNCATE` is rejected with SQLSTATE `55000`.
- The narrow exception preserves the existing FK `ON DELETE SET NULL` behavior while retaining the audit event and `user_name`.

**Verification:** Live staging rejected content `UPDATE`, `DELETE`, and `TRUNCATE`; a rollback-only FK test deleted a temporary user and verified that its audit event remained intact with only `user_id` nulled. The entire test transaction was rolled back and baseline counts were unchanged.

**Regression assessment:** Existing audit inserts remain allowed; existing user-deletion FK semantics remain compatible. The trigger does not defend against the table owner disabling/dropping triggers. A least-privilege application role separate from the owner may be needed to close that gap; doing so changes connection-role architecture and is not included without approval.

## Files changed in this continuation

- `docs/architecture/database/E1B9_RUNTIME_AUTH_TABLES.sql` — narrow append-only enforcement and FK-compatible exception.
- Nine F0 evidence documents listed in [F0_STATUS.md](./F0_STATUS.md).

No commit was created. All other dirty files were pre-existing and preserved.

## Remaining work

Full live session, route, BOLA/RBAC, restart, and outage acceptance is incomplete. See the acceptance matrix and security finding in [F0_ACCEPTANCE_REPORT.md](./F0_ACCEPTANCE_REPORT.md) and [F0_SECURITY_FINDINGS.md](./F0_SECURITY_FINDINGS.md).
