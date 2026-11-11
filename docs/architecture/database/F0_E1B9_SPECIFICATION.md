# F0 / E1B9 Staging Acceptance Specification

## Purpose and boundaries

F0 verifies the PostgreSQL runtime and the E1B9 persistence, authentication, authorization, OIDC, data-integrity, and cleanup work against the approved staging target only.

| Property | Requirement |
|---|---|
| Database | `neondb` |
| Schema | `public` |
| Neon branch | `br-billowing-band-b53087vi` |
| Provider | PostgreSQL, explicitly selected |
| TLS | Encrypted connection with an authorized certificate |
| Production activation / cutover | Prohibited |
| F1 | Out of scope |

This phase preserves the ratified repository-based database architecture, the established Student/Lecturer/Researcher/Admin roles, Main Administrator governance, session revocation/versioning, Google OIDC Authorization Code Flow with PKCE S256, persistent sessions and OIDC transactions, and separation of scientific core from runtime/UI. It does not change scientific algorithms or enable production Google login.

## Evidence labels

Reports use these labels consistently:

- **VERIFIED IN CODE** — established by direct source inspection.
- **VERIFIED BY TEST** — an actual automated test ran and its result is recorded.
- **VERIFIED AGAINST LIVE STAGING** — a fresh connection verified database, schema, branch, TLS, and the behavior under test.
- **REPORTED BUT NOT VERIFIED** — described in prior execution records, but not independently reproduced from retained primary evidence in this continuation.
- **BLOCKED** — acceptance needs more evidence or a human architectural decision.
- **NOT APPLICABLE** — explicitly outside F0.

## Acceptance boundary

Acceptance requires the previous execution to be recovered; target guards before every live write; runtime persistence and actual OIDC dependency wiring; session and OIDC cross-instance behavior; BOLA/RBAC and transaction behavior; restart/outage behavior; audit integrity; deterministic cleanup; baseline and JSON integrity; automated regression checks; and documented findings.

Passing source tests or a partial live staging exercise is not a PASS. Criteria that were not exercised against staging remain BLOCKED or NOT VERIFIED. Production activation, cutover, and starting F1 require separate human authorization.

## Current disposition

F0 is **PARTIAL**. The recovery, target checks, live OIDC runtime-store path, audit trigger behavior, data counts, cleanup, checksums, type-check, build, and current automated suite have evidence. Full live session/RBAC/API coverage, restart/outage acceptance, and the privileged database-owner limitation remain unresolved. See [F0_STATUS.md](./F0_STATUS.md) and [F0_ACCEPTANCE_REPORT.md](./F0_ACCEPTANCE_REPORT.md).
