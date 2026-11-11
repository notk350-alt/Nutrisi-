# F0 Recovery Audit

## Scope and recovered state

Recovery was completed before the new live OIDC test. The pre-existing worktree was already dirty and included tracked and untracked E1B9 work, local test databases, storage files, and a changed JSON source file. Those changes were preserved; no reset, checkout, stash, commit, or broad cleanup was performed.

The prior successful acceptance marker was recovered as:

- `E1B9_ACCEPTANCE_4C148DF8D7EA44C89802895B88709993`
- Earlier failed-before-database marker: `E1B9_ACCEPTANCE_9776923E22304837A51E236E261EE902`

The earlier failed attempt did not reach staging writes. The successful run's cleanup and completion are supported by the recovered database observations and prior execution record; the original full test script/transcript was not available as a durable artifact in this continuation.

## Historical cleanup and residuals

| Resource | Recovery result |
|---|---|
| Test project `proj_1793586269615_7uf4` | Not present |
| Test-created users | Not present |
| `runtime_sessions` | 0 |
| `oidc_transactions` | 0 |
| Prior test server listeners on ports 3111–3113 | None |
| Test audit events | Seven retained; intentionally not deleted |
| Historical non-operational data | 44 tables matched the recovered baseline counts |

The seven preserved audit IDs were:

`audit_1793586270489_60uf`, `audit_1793586274397_8wcu`, `audit_1793586275491_63z6`, `audit_1793586276625_ilrp`, `audit_1793586277270_kt4g`, `audit_1793586292259_f64n`, and `audit_1793586295694_tj8i`.

The recovered baseline was 118 rows across 45 manifest tables. The current count is 125 because the seven historical audit events are retained. The original audit row plus those events give `audit_logs=8`; other manifest table counts remain at the recorded baseline.

## JSON baseline

| File | Recovered size | Recovered SHA-256 |
|---|---:|---|
| `data/nutribodysim_db.json` | 58,916 bytes | `1b16140f395c0a937843cb691be1382a00296c2d2bd1ddd075c39d84ad3c6a5d` |
| `data/nutribodysim_db.backup.json` | 57,187 bytes | `a7f7cfa135e5b8c4be091cff49f5b1e2ecc88514776b8f908bd3ccf0d188af14` |

The values were rechecked after the current test run; see [F0_DATA_INTEGRITY_REPORT.md](./F0_DATA_INTEGRITY_REPORT.md).

## Current-turn changes after recovery

The only staging schema addition in this continuation was append-only enforcement for `audit_logs`, documented in [E1B9_RUNTIME_AUTH_TABLES.sql](./E1B9_RUNTIME_AUTH_TABLES.sql). It adds two triggers and two trigger functions; it does not change table rows or existing columns. The FK `ON DELETE SET NULL` behavior is preserved only when the audit row's other fields are unchanged.

A live OIDC runtime test then created one temporary transaction under marker `F0_E1B9_OIDC_RUNTIME_d4b90603-edb0-4ed1-bf3f-1f445afc0afb`, verified cross-process retrieval and consumption, and deleted only its recorded transaction (`eef9b368343bda0d46db48930bb5c96e0f02a167f9935378cb3286f801ac1717`). Final checks found no remaining OIDC transactions or runtime sessions.

The complete final Git state, including pre-existing changes, remains uncommitted and is recorded in [F0_STATUS.md](./F0_STATUS.md). No credentials or connection strings are included in this report.
