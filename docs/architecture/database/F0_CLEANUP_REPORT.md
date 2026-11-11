# F0 Cleanup Report

## Recovered prior execution

Recovered marker: `E1B9_ACCEPTANCE_4C148DF8D7EA44C89802895B88709993`. Earlier failed marker: `E1B9_ACCEPTANCE_9776923E22304837A51E236E261EE902`; the failed attempt stopped before staging writes.

The successful earlier test's staging cleanup is supported by the recovered read-only state: its project and test users were absent, `runtime_sessions=0`, and `oidc_transactions=0`. Seven audit events were retained intentionally. No old server listener remained on ports 3111–3113. See [F0_RECOVERY_AUDIT.md](./F0_RECOVERY_AUDIT.md).

## Current continuation

| Execution | Created resource | Cleanup result |
|---|---|---|
| OIDC live test, marker `F0_E1B9_OIDC_RUNTIME_d4b90603-edb0-4ed1-bf3f-1f445afc0afb` | One OIDC transaction `eef9b368343bda0d46db48930bb5c96e0f02a167f9935378cb3286f801ac1717` | Deleted by exact ID; no OIDC row remained |
| Audit trigger compatibility exercise | Temporary user and audit row inside an explicit DB transaction | Full transaction rolled back; row counts matched baseline |
| Append-only mutation tests | UPDATE, DELETE, TRUNCATE attempts inside savepoints | Each rejected; savepoints and outer transaction rolled back |
| Full automated suite | Two timestamped test material files and two timestamped JSON test DB files | Only the four files created during this continuation were removed |

Final staging counts: `runtime_sessions=0`, `oidc_transactions=0`; no listener on ports 3111–3113. The seven historical acceptance audit events remain by design and were not deleted.

## Preservation

No broad test directory or storage directory was cleaned. Older `data/.test_dbs` entries, existing `storage/materials` files, the tracked sample physiology file, all pre-existing worktree changes, and both JSON source files were preserved. No commit was made.
