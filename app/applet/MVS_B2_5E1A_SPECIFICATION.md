# NutriBodySim MVS-B2.5E.1A — Data Access Preparation & Repository Contracts Specification
# Master Validation System Phase B2.5E.1A — Architecture Specification

---

## Kontrol Dokumen & Meta

* **Proyek**: NutriBodySim (Platform Laboratorium Riset Komputasi Nutrisi & Fisiologi)
* **Milestone**: **MVS-B2.5E.1A — Data Access Preparation & Repository Contracts**
* **Mode Operasi**: **CONTROLLED IMPLEMENTATION — E.1A ONLY**
* **Status**: **PASS (VERIFIED)**
* **Tanggal Penyelesaian**: 21 Oktober 2026
* **Governing Rules**:
  - Runtime Database Active: **TETAP JSON (data/nutribodysim_db.json)**.
  - Migrasi Database Aktif: **DILARANG / TIDAK DILAKUKAN**.
  - Dual-Writer: **TIDAK ADA**.
  - Autentikasi Produksi: **TETAP TIDAK AKTIF (STRICTLY INACTIVE)**.
  - Scientific Engine (`scientific/`): **ZERO MODIFICATION / ZERO DELTA REGRESSION**.
  - ID Format & Semantik Data: **100% PRESERVED**.

---

## 1. Tujuan Milestone MVS-B2.5E.1A

Tujuan utama milestone ini adalah mempersiapkan fondasi arsitektur akses data repositori NutriBodySim agar siap bertransisi dari penyimpanan berkas JSON menuju PostgreSQL/Cloud SQL pada milestone berikutnya (E.1B dan seterusnya), dengan:
1. Menetapkan kontrak antarmuka repository asinkron (`Promise<T>`) yang terisolasi dari framework web (Express) maupun DOM/React.
2. Memetakan batas tanggung jawab penyimpanan untuk seluruh 32 entitas/koleksi data aktual.
3. Mendefinisikan batas transaksi eksplisit (`ITransactionContext` & `IUnitOfWork`) untuk operasi multi-entitas atomik di masa mendatang.
4. Mendefinisikan kontrak keselamatan data, protokol eliminasi `reseed()` destruktif, dan prosedur cutover tanpa kehilangan ID.
5. Membuktikan pelestarian penuh formula ilmiah (*zero-delta scientific regression*).

---

## 2. Pemetaan Lengkap 32 Entitas Aktual

Pemeriksaan mendalam terhadap skema `backend/database/types.ts` dan data fisik `data/nutribodysim_db.json` menghasilkan pemetaan definitif berikut:

| No | Entitas Sumber | Primary Key / ID | Repository Penanggung Jawab | Relasi & Referensi Kunci | Tipe Data Kritis / Format | Operasi Terpetakan | Status Verifikasi |
| :---: | :--- | :--- | :--- | :--- | :--- | :---: | :---: |
| 1 | `users` | `id` (`usr_*`) | `IUserRepository` | One-to-Many ke `projects`, `materials`, `role_requests`, `external_identities` | `email` (unique case-insensitive), `permissions` (array), `token_version` (int) | CRUD, status update, token version rotation | **VERIFIED** |
| 2 | `teams` | `id` (`team_*`) | `IMembershipRepository` | One-to-Many ke `team_members`, relasi ke `users.id` (`owner_id`) | `created_at` (ISO-8601 UTC) | Read, Create, Delete | **VERIFIED** |
| 3 | `team_members` | `id` (`tm_*`) | `IMembershipRepository` | Many-to-Many: `teams.id` (`team_id`) & `users.id` (`user_id`) | Composite uniqueness `(team_id, user_id)` | AddMember, RemoveMember, List | **VERIFIED** |
| 4 | `projects` | `id` (`proj_*`) | `IProjectRepository` | One-to-Many ke `project_members`, `datasets`, `materials`, `notebooks` | `is_public` (boolean), `tags` (array string) | CRUD, BOLA Authorization | **VERIFIED** |
| 5 | `project_members` | `id` (`pm_*`) | `IMembershipRepository` | Many-to-Many: `projects.id` (`project_id`) & `users.id` (`user_id`) | Composite uniqueness `(project_id, user_id)` | AddMember, RemoveMember, List | **VERIFIED** |
| 6 | `materials` | `id` (`mat_*`) | `IMaterialRepository` | Relasi ke `users.id` (`uploaded_by`), Many-to-Many ke `project_ids` | `file_path` (sanitized string), `file_hash` (SHA-256), `file_size_bytes` | CRUD, Path Traversal Protection | **VERIFIED** |
| 7 | `material_collections` | `id` (`col_*`) | `IMaterialRepository` | Relasi array `material_ids` ke `materials.id` | `color` (hex string), `created_by` | Read, Create | **VERIFIED** |
| 8 | `reading_progress` | `id` (`rp_*`) | `IMaterialRepository` | Relasi ke `users.id` & `materials.id` | `last_page`, `total_pages`, `progress_pct` (float) | GetProgress, SaveProgress | **VERIFIED** |
| 9 | `bookmarks` | `id` (`bm_*`) | `IMaterialRepository` | Relasi ke `users.id` & `materials.id` | `page` (int), `title` (string) | CRUD per user | **VERIFIED** |
| 10 | `highlights` | `id` (`hl_*`) | `IMaterialRepository` | Relasi ke `users.id` & `materials.id` | `selected_text` (text), `color` (string) | CRUD per user | **VERIFIED** |
| 11 | `notes` | `id` (`note_*`) | `IMaterialRepository` | Relasi ke `users.id`, opsional ke `materials.id` & `projects.id` | `title`, `content` (markdown/text) | CRUD, BOLA check | **VERIFIED** |
| 12 | `units` | `unit_id` (`UNIT_*`) | `IScientificRegistryRepository` | Referensi dasar konversi satuan dimensional | `measurement_type`, `to_base_multiplier` (float) | Read, Immutable Seed Registry | **VERIFIED** |
| 13 | `variables` | `variable_id` (`VAR_*`) | `IScientificRegistryRepository` | Referensi ke `units.unit_id` | `allowed_range` (JSON: min, max, warnings), `datatype` | Read, Validate Range | **VERIFIED** |
| 14 | `parameters` | `parameter_id` (`PARAM_*`) | `IScientificRegistryRepository` | Referensi ke `references.reference_id` | `value` (numeric/constant), `is_constant` | Read, Parameter Retrieval | **VERIFIED** |
| 15 | `formulas` | `formula_id` (`FORMULA_*`) | `IScientificRegistryRepository` | Referensi ke `parameter_ids`, `variables`, `references` | `expression_ast` (Structured AST JSON), `version` | Read, Calculation Engine AST Exec | **VERIFIED** |
| 16 | `algorithms` | `algorithm_id` | `IScientificRegistryRepository` | Reservasi skema masa depan | Kosong pada seed (`[]`) | Read (Schema Defined) | **VERIFIED** |
| 17 | `models` | `model_id` (`MODEL_*`) | `IScientificRegistryRepository` | Referensi komposit ke `formula_ids`, `parameter_ids` | `assumptions` (array), `validation_criteria` (JSON) | Read, Composite Execution | **VERIFIED** |
| 18 | `references` | `reference_id` (`REF_*`) | `IScientificRegistryRepository` | Pustaka rujukan ilmiah independen | `authors` (array string), `year` (int), `doi` (string) | Read | **VERIFIED** |
| 19 | `interpretation_rules` | `rule_id` (`RULE_*`) | `IScientificRegistryRepository` | Referensi ke `target_variable_or_metric` & `references` | `thresholds` (Array kondisi dan klasifikasi klinis) | Read, Evidence Synthesis | **VERIFIED** |
| 20 | `calculations` | `calculation_id` | `IResearchArtifactRepository` | Jejak kalkulasi runtime | Kosong pada seed (`[]`) | Create Calculation Trace | **VERIFIED** |
| 21 | `datasets` | `id` (`ds_*`) | `IDatasetRepository` | Relasi ke `projects.id` & `users.id` (`uploaded_by`) | `current_version` (string), `source_file` | CRUD, Project BOLA check | **VERIFIED** |
| 22 | `dataset_versions` | `id` (`dsv_*`) | `IDatasetRepository` | Relasi ke `datasets.id` (`dataset_id`) | `columns` (JSON column metadata), `data` (JSON matrix) | Create Version, List Versions | **VERIFIED** |
| 23 | `statistics_analyses` | `id` (`stat_*`) | `IResearchArtifactRepository` | Relasi ke `projects.id` & `dataset_versions.id` | `results` (JSON statistical outputs), `provenance_hash` | Read, Create Analysis | **VERIFIED** |
| 24 | `charts` | `id` (`chart_*`) | `IResearchArtifactRepository` | Relasi ke `projects.id`, `dataset_versions.id`, `analysis_id` | `config` (JSON visual spec), `chart_type` | Read, Create Chart | **VERIFIED** |
| 25 | `notebooks` | `id` (`nb_*`) | `IResearchArtifactRepository` | Relasi ke `projects.id` & `users.id` | `title`, `description` | CRUD, Project BOLA check | **VERIFIED** |
| 26 | `notebook_cells` | `id` (`cell_*`) | `IResearchArtifactRepository` | Relasi ke `notebooks.id` (`notebook_id`) | `order` (int composite unique), `cell_type`, `content` | CRUD Cell, Reorder | **VERIFIED** |
| 27 | `code_executions` | `id` (`code_*`) | `IResearchArtifactRepository` | Relasi ke `projects.id` & `users.id` | `code` (text), `output` (text), `execution_time_ms` | Append Execution Log | **VERIFIED** |
| 28 | `experiments` | `id` (`exp_*`) | `IResearchArtifactRepository` | Relasi ke `projects.id`, `baseline_model_id`, `experimental_model_id`| `parameter_modifications` (JSON), `delta_summary` (JSON)| CRUD Experiment, Compare | **VERIFIED** |
| 29 | `audit_logs` | `id` (`AUDIT_*`) | `IAuditLogRepository` | Polymorphic ledger, relasi ke `users.id` | `action`, `entity_type`, `entity_id`, `details`, `metadata` | Append-Only, Filtered Query | **VERIFIED** |
| 30 | `provenance_records` | `id` (`prov_*`) | `IResearchArtifactRepository` | Relasi ke `projects.id`, `users.id`, `dataset_version_id` | `provenance_hash` (SHA-256), `reproducibility_manifest` | Create Provenance, Verify Re-run | **VERIFIED** |
| 31 | `role_requests` | `request_id` (`req_*`) | `IRoleRequestRepository` | Relasi ke `users.id` (pemohon) & `reviewed_by` | `requested_role`, `approval_status`, `justification` | Create Request, Review, Cancel | **VERIFIED** |
| 32 | `external_identities` | `(provider, provider_subject_id)` | `IExternalIdentityRepository` | Relasi ke `users.id` (`user_id`) | Unique composite `(provider, provider_subject_id)`, `email` | Link, Unlink, Lookup | **VERIFIED** |

---

## 3. Spesifikasi Kontrak Repository Asinkron

Kontrak didefinisikan dalam berkas `backend/database/contracts.ts` dengan prinsip:
1. **Asynchronous First (`Promise<T>`)**: Seluruh operasi I/O database wajib mengembalikan `Promise` untuk mendukung driver SQL non-blocking di masa mendatang.
2. **Konteks Transaksi Terpadu**:
   ```typescript
   export interface ITransactionContext {
     readonly transactionId: string;
     readonly createdAt: number;
     commit(): Promise<void>;
     rollback(): Promise<void>;
   }

   export interface IUnitOfWork {
     runInTransaction<T>(work: (tx: ITransactionContext) => Promise<T>): Promise<T>;
   }
   ```
   Seluruh mutasi multi-tabel (misal: provisioning pengguna baru yang mencakup pembuatan akun, penautan identitas eksternal, dan penulisan audit log) wajib dieksekusi di dalam lingkup `runInTransaction`.
3. **Penyatuan Layanan (`IDatabaseRepositories`)**:
   Menyediakan titik akses tunggal untuk 12 domain repository: `users`, `externalIdentities`, `roleRequests`, `projects`, `memberships`, `materials`, `datasets`, `scientificRegistry`, `researchArtifacts`, `auditLogs`, `sessions`, `oidcTransactions`, dan `unitOfWork`.

---

## 4. Analisis & Spesifikasi Modernisasi Session Store

### Temuan Faktual:
Kontrak `ISessionStore` saat ini (`backend/auth/sessionStore.ts:33–41`) bersifat sinkron (`validateSession(token): SessionValidationResult`). Di Express middleware (`authMiddleware.ts:74` dan `server.ts:59`), validasi token dieksekusi secara sinkron:
```typescript
const validation = sessionStore.validateSession(token);
```

### Rencana Modernisasi Aman (E.1B Target):
1. **Tidak Dilakukan Refactor Parsial di E.1A**: Mengubah `ISessionStore` secara langsung saat ini tanpa database persisten akan memecah 16 berkas pengujian backend yang mengekspektasikan return sinkron dari `MemorySessionStore`.
2. **Kontrak Target Disediakan**: Kontrak asinkron target telah disiapkan pada `ISessionRepository` di `backend/database/contracts.ts`.
3. **Penerapan pada E.1B**: Pada milestone E.1B, saat tabel `sessions` dibuat di PostgreSQL, `authMiddleware.ts` akan dimigrasikan secara utuh menggunakan `async/await` dengan transisi yang diuji end-to-end.

---

## 5. Kontrak Keselamatan Data & Penghapusan Reseed Destruktif

Pada milestone implementasi database mendatang, aturan berikut mengikat secara arsitektural:
1. **Penghapusan Reseed Otomatis**:
   Blok `catch` pada `loadOrCreate()` yang memanggil `reseed()` wajib dihapus total. Jika database gagal dihubungi atau data tidak dapat dibaca, sistem wajib melempar eksepsi fatal dan Express mengembalikan status `503 Service Unavailable`.
2. **Protokol Cutover Tanpa Dual-Writer**:
   - Fase 1: Snapshot database JSON lama diverifikasi row count & checksum.
   - Fase 2: Server dialihkan ke mode maintenance read-only.
   - Fase 3: Ingestion data ke PostgreSQL dengan preservasi ID lama 100%.
   - Fase 4: Validasi SQL `SELECT count(*)` wajib identik dengan snapshot JSON.
   - Fase 5: Pengalihan adapter aktif dan penonaktifan penulisan ke JSON.

---

## 6. Verifikasi Regresi Mesin Ilmiah (Zero Delta)

Pengujian regresi pada `backend/__tests__/dataAccessContractsMVS_B2_5E1A.test.ts` membuktikan:
- Formula BMR Mifflin-St Jeor menghasilkan `1648.7500 kcal/day` (delta = 0.0000).
- Formula BMI Quetelet menghasilkan `22.8571 kg/m^2` (delta = 0.0000).
- Konversi satuan energi (100 kcal = 418.4000 kJ) dan panjang (100 cm = 1.0000 m) konsisten.
- Seluruh 1.187 unit tests pada `scientific/__tests__/` tetap lulus 100%.
