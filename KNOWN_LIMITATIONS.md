# Known Limitations

Status: **OPEN - blocks completion and production readiness**

## External and Approval Blockers

- Google Cloud project, OAuth consent configuration, client credentials, authorized origins, and redirect URI have not been verified. OIDC is disabled by default; local mock tokens do not prove provider acceptance.
- Read-only staging probe verified the current login remains `neondb_owner` with cluster/schema privileges and audit UPDATE/DELETE/TRUNCATE. The prepared role migration/rollback are verified only in local PostgreSQL; staging backup/restore evidence is absent, so no role DDL was applied.
- Production runtime is intentionally rejected by `backend/database/runtime.ts` and the database target remains bound to approved staging. Do not remove the guard without an approved target and role design.
- No production environment was activated, deployed, or verified.

## Functional and Operational Gaps

- No shared/multi-instance rate limiting is implemented for public OIDC initiation and callback endpoints.
- Browser popup message handling is implemented but has not been exercised in a browser E2E test; the local backend callback uses a generated signing key and mocked token endpoint/JWKS.
- Student, lecturer, researcher, and administrator workflows have not been run as full end-to-end sessions in staging.
- Local PostgreSQL tested two-pool persistence, pool reinitialization, failed connection startup, and recovery. Actual server-process restart, staging outage/reconnect, independent HTTP instances, and backup/restore remain unverified.
- Full-row identity comparison for staging data and a current live route-level BOLA/RBAC matrix remain unverified.
- Account linking and step-up re-authentication remain blocked by existing MVS-B2.5D.3 prerequisites; do not infer that login provisions or links existing local accounts by email.
- A backup/recovery guide exists, but backup automation and a restore drill are not implemented or verified here.

## Build and Dependency Caveats

- Vite build succeeds with entry JS 252.40 kB (79.02 kB gzip); `TreeOfLife3D` remains 575.19 kB but is on-demand. The build still emits a large-chunk warning for that lazy chunk.
- Bun audit reports no vulnerabilities after exact esbuild override to 0.25.12; Bun frozen installation does not change the lockfile. `npm audit` is unavailable because there is no npm lockfile.
- No independent security audit was performed. This report does not claim that all critical/high findings have been ruled out.

## Historical Evidence Caveat

Earlier F0 and milestone reports record staging/test evidence from prior snapshots. They remain historical reports and may not correspond to every current worktree change. Current local automated evidence is listed in `FINAL_TEST_RESULTS.md`.