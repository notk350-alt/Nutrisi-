# F0 Runtime Database Role Design Proposal

**Status:** PREPARED FOR REVIEW. No roles, grants, credentials, connection settings, or live database objects were changed in this continuation.

## Current evidence

The live connection was rechecked read-only against `neondb/public`, branch `br-billowing-band-b53087vi`, with verified TLS. `current_user` is `neondb_owner`. PostgreSQL reports:

| Attribute / privilege | Current value |
|---|---|
| Superuser | No |
| Create role | Yes |
| Create database | Yes |
| Replication | Yes |
| Bypass row-level security | Yes |
| `CREATE` in `public` | Yes |
| `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE` on `audit_logs` | Yes |

Both audit triggers are enabled, but the current owner can alter or remove them. `backend/database/runtime.ts` and `scripts/run-migration.ts` currently both read `DATABASE_URL`; the runtime verifies database, schema, branch, and TLS but does not verify a restricted `current_user`.

## Recommended separation

1. **Object/migration owner:** `nutribodysim_owner` is `NOLOGIN` and owns application tables and trigger functions. A distinct migration login may `SET ROLE` to it only in an approved migration job; neither identity is used by web servers.
2. **Runtime group and login:** `nutribodysim_runtime` is `NOLOGIN` with no cluster privileges. `nutribodysim_app` is a distinct `LOGIN` principal, inherits only the runtime group, and has no owner membership, schema `CREATE`, object ownership, trigger-management, or DDL rights. Its credential is assigned outside SQL through the secret manager.
3. **Repository-derived grants:** The prepared matrix grants only the current adapter operations. Registry tables are read/insert, mutable application resources receive the specific select/insert/update/delete operations implemented by their repositories, and append-only execution/audit records receive read/insert only. There are no sequences in the 47-table schema manifest.
4. **Operational tables:** `runtime_sessions` receives select/insert/update/delete for validation, revocation, and expiry cleanup. `oidc_transactions` receives select/insert/update/delete for lookup, single-use consume, replay protection, and expiry cleanup. Neither receives DDL privileges.
5. **Audit table:** Runtime receives only `SELECT` and `INSERT`. It receives no table/column `UPDATE`, `DELETE`, `TRUNCATE`, ownership, or trigger-management privilege. Trigger functions are owned by `nutribodysim_owner`, explicitly `SECURITY INVOKER`, and pin `search_path=pg_catalog`; the table owner is not the runtime role.
6. **Hard-delete conflict:** The current repository contract includes `users.delete`, while `audit_logs.user_id` has `ON DELETE SET NULL`. Granting runtime no audit update means hard user deletion cannot complete through that FK action. No public deletion route was found in the inspected route surface. Keep `users.delete` ungranted; any future requirement to hard-delete users needs a separate reviewed retention/audit policy decision.
7. **Connection configuration:** Runtime reads `DATABASE_URL` and requires exact `DATABASE_RUNTIME_ROLE`. Migration and Drizzle tooling read only `MIGRATION_DATABASE_URL`. A web process must never inherit the migration credential.
8. **Identity and trigger guard:** Startup and health checks verify expected role, cluster flags, schema DDL, ownership/membership, audit ACLs, both enabled triggers, invoker security, and pinned search path. Any mismatch aborts startup without JSON fallback.
9. **Secret handling:** Provision/rotate credentials through the approved secret manager. Never print connection strings, passwords, or tokens. Keep TLS certificate verification enabled.

## Prepared Local Artifacts

- `E1B10_RUNTIME_ROLE_MIGRATION.sql` creates the non-login groups, a login principal with no embedded password, transfers ownership of the exact 47 application/operational tables and audit functions, and applies the repository-derived ACL matrix. It is idempotent and was applied twice to a disposable local PostgreSQL 16 database.
- `E1B10_RUNTIME_ROLE_ROLLBACK.sql` revokes runtime access and membership without deleting data, audit events, roles, or schema objects. It was executed against that disposable database; the runtime then failed closed.
- `backend/database/runtimeRoleGuard.ts` and `backend/__tests__/database/runtimeRoleGuard.test.ts` validate the intended privileges locally.
- `backend/__tests__/database/postgresRuntime.integration.test.ts` verifies actual PostgreSQL selection, session/OIDC cross-pool persistence, single-use consumption, and pool reinitialization. Run only with the guarded local test target using `npm run test:postgres-runtime`.

## Required implementation and rollout gates

The role SQL remains **BLOCKED FOR LIVE EXECUTION** until the user approves privilege changes. Before rollout:

- Generate and review per-table privileges from repository methods and all runtime code paths.
- Review the explicit no-hard-delete-on-users consequence. `ON DELETE SET NULL` for audit references cannot execute without audit UPDATE privileges.
- Verify the Neon role can perform normal repository operations, FK actions, audit append/query, session revocation, OIDC consumption, and cleanup, while DDL and audit deletion/truncation fail.
- Add a runtime `current_user` guard and tests for wrong-role fail-closed behavior.
- Run migration tooling only with the owner credential in a distinct process.
- Re-run all 45-table integrity checks and targeted staging integration tests on the approved branch.
- Maintain a rollback path that restores the prior secret mapping without granting owner credentials to runtime.

## Explicit non-actions

No live role, grant, credential, connection setting, staging object, or production object was changed. Do not execute the prepared SQL until privilege-change approval and a verified target/backup plan are recorded.
