# F0 Test Report

## Automated checks

| Command | Exit | Actual result | Duration |
|---|---:|---|---|
| `npm test` | 143 | Vitest process was terminated by SIGTERM before reporting results. This occurred twice, including one isolated retry. | Not reported |
| `npx vitest run backend/__tests__/oidcRuntimeTransactionStore.test.ts --pool=forks --maxWorkers=1 --minWorkers=1 --reporter=verbose` | 1 | Invocation rejected before tests; this Vitest version does not support the supplied `--minWorkers` option. | Immediate |
| `npm test -- --maxWorkers=1 --no-file-parallelism --reporter=dot` | 0 | **64 test files passed; 1,657 tests passed.** | 66.30 seconds |
| `npm run lint` | 0 | `tsc --noEmit` passed. | Not reported |
| `npm run build` | 0 | Vite client build and bundled server build passed. | Vite 4.77 seconds; esbuild 451 ms |

Build warnings: the frontend build externalized Node `crypto` imports from scientific modules for browser compatibility and emitted the existing >500 kB chunk-size warning. Neither warning failed the build; they remain review items and were not altered in F0.

The VS Code `runTests` client disconnected without returning a result. It is not counted as a passing test.

## Live staging verification

Every live check below connected with `DATABASE_PROVIDER=postgres`, `current_database()=neondb`, `current_schema()=public`, Neon branch `br-billowing-band-b53087vi`, and encrypted TLS with an authorized certificate. No connection string or credential was printed.

| Check | Result |
|---|---|
| Direct counts for all 45 manifest tables | 45/45 found; total 125; see [F0_DATA_INTEGRITY_REPORT.md](./F0_DATA_INTEGRITY_REPORT.md) |
| PostgreSQL runtime target/health guard | Passed |
| Actual `initiateGoogleLogin()` default store selection | Passed; persisted through PostgreSQL runtime repository |
| OIDC process separation | Second Node process initialized its own runtime, retrieved the transaction, consumed it, and rejected replay |
| OIDC state and PKCE | SHA-256 state hash and PKCE S256 challenge checked against the stored verifier |
| OIDC cleanup | Exact temporary transaction deleted; `oidc_transactions=0`, `runtime_sessions=0` |
| Audit append-only | `UPDATE`, `DELETE`, and `TRUNCATE` rejected with SQLSTATE `55000` |
| Audit FK deletion behavior | Rollback-only temporary user deletion preserved audit row and nulled only `user_id` |
| FK catalog | 77 foreign keys; 0 unvalidated |
| Primary keys | No manifest or operational table lacked a primary key |
| Historical test records | Seven prior acceptance audit rows remained present |
| Test listeners | Ports 3111–3113 had no listener at final check |

The OIDC test did not contact Google, exchange a real authorization code, enable production login, or test HTTP server session behavior.

## Historical reports not counted as current independent verification

The recovered E1B9 run record describes two server processes and some project/session/BOLA/RBAC, foreign-key rollback, restart, and audit tests. The original complete test script and durable raw output were not recovered as artifacts. Those items are therefore **REPORTED BUT NOT VERIFIED** for this continuation; they are not promoted to PASS. Database outage testing against staging was not performed.

## Regression and cleanup

The serial full suite passed. Tests produced two timestamped local material files and two timestamped files under `data/.test_dbs/` during this continuation; only those four identified test-generated files were removed. The tracked `sample_physiology_manual.txt`, older test-database files, storage files, and all other pre-existing worktree changes were preserved.

The JSON checksums and sizes remained unchanged. No test-generated database row remains from the current OIDC/trigger tests; intentional historical audit events remain.
