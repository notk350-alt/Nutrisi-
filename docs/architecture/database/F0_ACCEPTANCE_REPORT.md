# F0 Acceptance Report

## Recommendation: PARTIAL

F0 is **not recommended for acceptance** yet. The code suite, PostgreSQL runtime target guards, one actual OIDC runtime path, audit triggers, final data counts, cleanup, and JSON checksums have evidence. Several required live behavior categories remain unverified in this continuation, and a database-owner privilege limitation requires an approved security/operations decision.

## Acceptance matrix

| Criterion | Status | Evidence / limitation |
|---|---|---|
| Previous execution recovery completed before new writes | VERIFIED AGAINST LIVE STAGING | Marker recovered; no test project/users/sessions/OIDC transaction remained; historical audit events retained |
| Target database/schema/branch/TLS/provider guard | VERIFIED AGAINST LIVE STAGING | `neondb/public`, branch `br-billowing-band-b53087vi`, authorized TLS, explicit PostgreSQL provider |
| Runtime PostgreSQL initialization and health; no JSON fallback | VERIFIED IN CODE / VERIFIED AGAINST LIVE STAGING | Runtime guard and actual OIDC runtime process initialization |
| Schema compatibility and integrity | VERIFIED AGAINST LIVE STAGING | 47 total tables (45 manifest + 2 operational); 77 validated FKs; no missing PK |
| OIDC actual runtime orchestration selects PostgreSQL repository | VERIFIED AGAINST LIVE STAGING | Called `initiateGoogleLogin()` without injecting a transaction store |
| OIDC cross-process persistence, S256, state hash, consumption, replay rejection | VERIFIED AGAINST LIVE STAGING | Independent Node process retrieved and consumed the transaction; replay rejected |
| OIDC restart persistence and real callback/token exchange | BLOCKED / NOT VERIFIED | No live provider interaction or complete callback flow in this continuation |
| Session create/validate/logout/logout-all/version/expiry across live instances | REPORTED BUT NOT VERIFIED | Earlier execution record describes session tests; primary raw artifact not retained here |
| BOLA and object ownership/membership through live routes | REPORTED BUT NOT VERIFIED | Historical subset reported; not all resources/routes retested |
| Four-role RBAC and Main Administrator governance through live routes | BLOCKED / NOT VERIFIED | Automated tests pass; comprehensive live endpoint matrix not performed |
| Transaction rollback / FK integrity | VERIFIED BY TEST / VERIFIED AGAINST LIVE STAGING | Rollback-only trigger/FK tests live; earlier business transaction rollback is historically reported, not independently reverified |
| Multi-instance server behavior | PARTIAL | Cross-process OIDC repository behavior verified; two independent HTTP server coverage is historical only |
| Restart behavior | REPORTED BUT NOT VERIFIED | Historical record only |
| Database outage and recovery | BLOCKED / NOT VERIFIED | No outage induced against shared staging; local failure behavior is not equivalent |
| Audit append-only integrity | PARTIAL | Ordinary mutation blocked and tested; owner can disable/drop triggers |
| Cleanup of current test-created records | VERIFIED AGAINST LIVE STAGING | Exact OIDC transaction deleted; session/OIDC operational tables empty; rollback-only test data absent |
| Historical audit evidence preserved | VERIFIED AGAINST LIVE STAGING | Seven known prior test audit rows remain |
| Existing unrelated data preserved | PARTIAL | All 45 counts match the recovered baseline plus seven retained audits; not a complete snapshot/hash comparison of every row |
| JSON baseline | VERIFIED | Both SHA-256 values and sizes match recovered values |
| Unit/integration/regression suite | VERIFIED BY TEST | 64 files / 1,657 tests passed serially |
| TypeScript, lint, production build | VERIFIED BY TEST | `npm run lint` and `npm run build` exit 0; build warnings documented |
| No unresolved P0/P1 | BLOCKED | No P0 found; P1 remains for owner-level audit-trigger bypass |
| F0 documentation package | VERIFIED IN CODE | All nine requested documents created |
| Production activation, cutover, F1 | NOT APPLICABLE | Prohibited and not performed |

## Required human decision

The human reviewer authorized a least-privilege runtime-role **design proposal only**, documented in [F0_RUNTIME_ROLE_DESIGN_PROPOSAL.md](./F0_RUNTIME_ROLE_DESIGN_PROPOSAL.md). Implementing role creation, grants, secret separation, or runtime identity guards still requires separate explicit approval. This is required to make audit immutability meaningful against a compromised runtime credential; it changes deployment/connection-role architecture and must not be improvised in this phase.

## Stop boundary

No production activation, cutover, runtime switch, or F1 work was performed. Do not call this **PASS** or **ACCEPTED** until remaining criteria have actual evidence and the privileged-owner risk is resolved through an approved design.
