# Security Remediation Report

Date: 2026-11-02  
Assessment status: **REMEDIATIONS IMPLEMENTED; INDEPENDENT SECURITY ACCEPTANCE PENDING**

## Verified in Code and Tests

- Demo login and role switching are impossible in staging/production regardless of `ENABLE_DEMO_AUTH`; demo auth is explicit opt-in only in development/test or local mode. Regression tests cover staging and production overrides.
- `GET /users` requires Admin unless explicit development/test demo mode is enabled. Production UI does not render the demo role selector.
- OIDC login is disabled by default. Initiation validates configuration and uses Google authorization URL, server-held state/nonce/PKCE, and HTTPS redirect; only localhost HTTP is accepted for non-production development.
- OIDC callback validates provider responses, provisions only an unprivileged `RegisteredUser`, preserves existing roles, blocks email auto-merge, and creates session, last-login update, and login audit within a repository transaction.
- Callback `postMessage` is limited to the configured redirect origin; response JSON escapes HTML-significant characters, uses a CSP nonce, and sets no-store/referrer protections. Session token and user DTO are not written to logs or placed in URLs.
- OIDC duration values are validated strictly; production cookies require `Secure`.
- Scientific Core hashing no longer imports Node `crypto` into browser bundles. SHA-256 and random values use maintained SHA-256 code plus Web Crypto while preserving existing synchronous contracts and canonical payloads.
- PostgreSQL runtime requires `DATABASE_RUNTIME_ROLE`; migration tooling uses only `MIGRATION_DATABASE_URL`, checks `DATABASE_MIGRATION_ROLE` is distinct, and matches its URL username.
- Runtime role guard checks database identity/TLS, expected current role, cluster flags, schema CREATE, public object ownership/membership, audit SELECT/INSERT only, trigger state, SECURITY INVOKER, function ownership, and pinned `search_path`.
- Draft role migration/rollback is limited to the exact 47-table NutriBodySim manifest; role migration was applied twice in a disposable PostgreSQL 16 database. Rollback revoked runtime ACLs without deleting test audit rows, then reapply restored access.
- App-role probes in local PostgreSQL denied CREATE, trigger disable, and audit UPDATE/DELETE/TRUNCATE. Migration login was distinct, owner-group member, and had no superuser/CREATEROLE/CREATEDB/REPLICATION/BYPASSRLS flags.
- Scientific Core hashing no longer imports Node `crypto` into browser bundles. SHA-256 and random values use maintained SHA-256 code plus Web Crypto while preserving existing synchronous contracts and canonical payloads.
- Bun audit reports no vulnerabilities after pinning `esbuild@0.25.12`; frozen installation and Drizzle config check pass. npm audit is unavailable because there is no npm lockfile.

## Automated Evidence

- Auth/session suite: 22 tests passed.
- OIDC route tests: 8 tests passed, including a locally generated RS256 token and persisted-session verification.
- OIDC configuration and primitive tests: 38 tests passed together.
- Full suite: 68 test files passed, 1 skipped; 1,693 tests passed, 2 skipped. Typecheck and build passed.
- Local PostgreSQL runtime integration: 2 tests passed for session/OIDC/audit persistence, second pool, pool reinitialization, fail-closed startup, and recovery.

## Open Findings and Blockers

- **BLOCKED - staging database owner privilege:** Read-only probe confirms `neondb_owner` currently has CREATEROLE/CREATEDB/REPLICATION/BYPASSRLS, schema CREATE, and audit UPDATE/DELETE/TRUNCATE. The proposed role migration has only been verified on local PostgreSQL. Staging backup availability/restore is not evidenced, so no DDL was run.
- **VERIFIED IN STAGING - read-only scope only:** Target is `neondb/public`, branch `br-billowing-band-b53087vi`, TLS verified, 47 public tables, 8 audit rows, 0 sessions, 0 OIDC transactions. Audit triggers are enabled and SECURITY INVOKER, but have no pinned `search_path` on staging.
- **NOT IMPLEMENTED - shared OIDC rate limiting:** No distributed/shared limit for `/auth/google/url` and callback exists. Add and test a shared mechanism before production acceptance; a process-local map would not satisfy multi-instance behavior.
- **BLOCKED - live provider verification:** Google credentials, consent screen, origin, exact HTTPS callback, and staging host are unavailable/unverified. OIDC remains disabled by default.
- **BLOCKED - production database runtime:** `backend/database/runtime.ts` explicitly rejects production activation and validates only the approved staging target. Do not weaken this guard without approval and the approved target/role design.
- **BLOCKED - deploy/first trial:** No hosting manifest, approved staging domain, or platform access is present; no staging deployment or real account trial occurred.
- **NOT VERIFIED - independent audit:** No independent security audit or production penetration test was performed, by instruction.

No production credentials were provisioned or activated. The staging database was queried read-only only; no staging database mutation was performed for this report.