# F0 Security Findings

## F0-SF-001 — Audit log mutation by the database owner

**Severity:** P1 data-integrity risk  
**Status:** Mitigated for ordinary DML; residual privileged-owner risk remains  
**Evidence:** The staging role is `neondb_owner` and has `CREATE` in `public` plus `SELECT`, `INSERT`, `UPDATE`, `DELETE`, and `TRUNCATE` on `audit_logs`. PostgreSQL reports it is not superuser, but it has `CREATEROLE`, `CREATEDB`, `REPLICATION`, and `BYPASSRLS`. No trigger existed before this continuation. Staging now has enabled row mutation and truncate triggers. Live tests verified content updates, deletes, and truncate are rejected with SQLSTATE `55000`.

The trigger permits only a user-reference nullification consistent with the existing `ON DELETE SET NULL` foreign key, and the test verified the remaining audit fields are unchanged. This means the log event remains, but its user ID can be cleared; the user name snapshot remains.

**Residual risk:** The current connection role owns the database objects and can disable or drop these triggers; it also has elevated role/database/replication/RLS-bypass attributes. The trigger is not a defense against a malicious or compromised owner. A least-privilege runtime principal separated from the migration/object owner, with separate connection secrets and role verification, is needed to address this threat. A human has authorized only a design proposal; implementation remains unapproved. See [F0_RUNTIME_ROLE_DESIGN_PROPOSAL.md](./F0_RUNTIME_ROLE_DESIGN_PROPOSAL.md).

## F0-SF-002 — Live security coverage is incomplete

**Severity:** P2 assurance gap  
**Status:** BLOCKED / NOT VERIFIED  
**Evidence:** Full automated tests pass, and historical notes report a subset of BOLA/RBAC/session tests. The current continuation did not independently test all API routes, all four roles, Main Administrator protections through live endpoints, or object ownership/membership cases against staging. Do not infer endpoint-level authorization from source inspection or a 404.

## F0-SF-003 — Restart and outage assurance is incomplete

**Severity:** P2 assurance gap  
**Status:** BLOCKED / NOT VERIFIED  
No staging database outage test was run. Historical restart testing is reported but lacks a retained raw execution artifact in the current evidence package. Do not simulate a destructive outage against shared staging.

## Verified mitigations and scope limits

- PostgreSQL target and TLS checks fail closed in runtime initialization.
- The default OIDC orchestration store was verified against the live PostgreSQL runtime; a separate process retrieved, consumed, and replay-rejected one test transaction.
- No production Google credentials or live provider interaction was used.
- No P0 finding was identified by the evidence collected here. This is not a comprehensive independent security review of every route or role.
- No permission, role, authentication bypass, scientific formula, or production setting was weakened or changed.
