# F0 Data Integrity Report

## Verified staging target

Fresh read-only and guarded write-test connections reported PostgreSQL database `neondb`, schema `public`, branch `br-billowing-band-b53087vi`, with encrypted TLS and an authorized certificate. The Node runtime was explicitly started with `DATABASE_PROVIDER=postgres`. The connection string and credentials were not printed.

## Final direct row counts

All 45 non-operational manifest tables were queried directly using `COUNT(*)`. All were found. Their total is 125 rows: 118 recovered baseline rows plus seven intentionally retained historical audit events.

| Table | Rows | Table | Rows | Table | Rows |
|---|---:|---|---:|---|---:|
| `audit_logs` | 8 | `bookmarks` | 1 | `charts` | 1 |
| `code_executions` | 0 | `collection_materials` | 2 | `dataset_versions` | 2 |
| `datasets` | 1 | `experiments` | 1 | `external_identities` | 0 |
| `highlights` | 1 | `material_collections` | 1 | `material_projects` | 3 |
| `materials` | 2 | `notebook_cells` | 5 | `notebooks` | 1 |
| `notes` | 1 | `project_members` | 4 | `projects` | 2 |
| `provenance_records` | 1 | `reading_progress` | 1 | `role_requests` | 0 |
| `scientific_algorithm_parameters` | 0 | `scientific_algorithm_references` | 0 | `scientific_algorithms` | 0 |
| `scientific_calculations` | 0 | `scientific_formula_parameters` | 4 | `scientific_formula_references` | 5 |
| `scientific_formulas` | 5 | `scientific_interpretation_rule_references` | 2 | `scientific_interpretation_rules` | 2 |
| `scientific_model_algorithms` | 0 | `scientific_model_formulas` | 2 | `scientific_model_parameters` | 2 |
| `scientific_model_references` | 2 | `scientific_model_variables` | 4 | `scientific_models` | 1 |
| `scientific_parameter_references` | 4 | `scientific_parameters` | 4 | `scientific_references` | 2 |
| `scientific_units` | 33 | `scientific_variables` | 6 | `statistics_analyses` | 1 |
| `team_members` | 3 | `teams` | 1 | `users` | 4 |

Operational tables outside the 45-table migration manifest:

| Table | Final rows |
|---|---:|
| `runtime_sessions` | 0 |
| `oidc_transactions` | 0 |

## Relational integrity and audit protections

- 77 foreign-key constraints were found; 0 were unvalidated.
- No manifest or operational table was missing a primary key.
- All seven known historical acceptance audit IDs were present.
- Both audit triggers were enabled: `audit_logs_reject_mutation` and `audit_logs_reject_truncate`.
- Live rollback-only tests rejected content update, deletion, and truncate. The FK `ON DELETE SET NULL` path retained the event and all other audit fields.
- The only persistent schema change in this continuation is the pair of triggers and their functions. Table definitions and data rows were not changed by the trigger tests.

The evidence confirms counts, constraint catalog state, the seven named historical audit records, and targeted test cleanup. It is not a byte-for-byte snapshot comparison of every pre-existing row identity.

## JSON source and backup

| File | Size | SHA-256 | Result |
|---|---:|---|---|
| `data/nutribodysim_db.json` | 58,916 bytes | `1b16140f395c0a937843cb691be1382a00296c2d2bd1ddd075c39d84ad3c6a5d` | Matches recovered baseline |
| `data/nutribodysim_db.backup.json` | 57,187 bytes | `a7f7cfa135e5b8c4be091cff49f5b1e2ecc88514776b8f908bd3ccf0d188af14` | Matches recovered baseline |

Neither file was edited in this continuation.
