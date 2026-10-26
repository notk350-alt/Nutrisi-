# NUTRIBODYSIM — PostgreSQL Schema & DDL Design Specification

**Dokumen:** E1B3_POSTGRESQL_SCHEMA_DDL.md  
**Milestone:** MVS-B2.5E.1B.3  
**Status Mode:** DATABASE ARCHITECTURE DESIGN ONLY — NO RUNTIME IMPLEMENTATION  
**Tanggal:** 23 Oktober 2026  
**Target Sistem:** PostgreSQL 15+ / Google Cloud SQL for PostgreSQL  
**Baseline Penyimpanan:** `data/nutribodysim_db.json` (57.187 bytes, SHA-256: `a7f7cfa135e5b8c4be091cff49f5b1e2ecc88514776b8f908bd3ccf0d188af14`)  
**Kontrak Rujukan:** `backend/database/contracts.ts`  
**Adapter Rujukan:** `backend/database/adapters/lowdbJsonDatabase.ts`

---

## 1. Ringkasan Arsitektur

Milestone **MVS-B2.5E.1B.3** menetapkan spesifikasi desain skema relasional PostgreSQL dan DDL (Data Definition Language) yang siap dimigrasikan dari database dokumen JSON (`lowdb`).

### Prinsip Desain Kunci:
1. **Preservasi Identitas Domain (Zero ID Regeneration):**  
   Seluruh primary key mempertahankan string identifier historis proyek (`usr_*`, `proj_*`, `mat_*`, `ds_*`, `dsv_*`, `UNIT_*`, `VAR_*`, `PARAM_*`, `FORMULA_*`, `MODEL_*`, `RULE_*`, `REF_*`). Tidak ada penggantian menjadi auto-incrementing integer atau UUID baru yang akan merusak kompatibilitas engine ilmiah dan rute API.
2. **Kesesuaian Tipe Data Fisiologi & Ilmiah (Precision Invariance):**  
   Nilai koefisien konversi, pengali, dan metrik bioenergetik dipetakan ke `DOUBLE PRECISION` (IEEE 754 64-bit float) untuk menjamin nol delta (0.00000000 error) pada perhitungan BMR/BMI/AST di modul `scientific/`.
3. **Arsitektur Hybrid (Relasional Bersih + JSONB Terkendali):**  
   Struktur yang memerlukan integritas referensial dan sering difilter dinormalisasi menjadi tabel relasional murni dan junction table (M:N). Struktur dinamis, pohon evaluasi ekspresi (AST), dan matriks analitik kompleks dipertahankan sebagai `JSONB`.
4. **Isolasi Mutlak & Non-Eksekusi (Zero Runtime Disruption):**  
   Spesifikasi ini dirancang sepenuhnya secara *read-only*. Tidak ada koneksi database aktif, tidak ada eksekusi DDL ke server, tidak ada instalasi dependency baru, dan database aktif (`nutribodysim_db.json`) tetap 100% terlindungi.

---

## 2. Inventaris 32 Koleksi Aktual

Berdasarkan inspeksi statis langsung terhadap `data/nutribodysim_db.json` dan `backend/database/types.ts`:

| No | Nama Koleksi | Jumlah Record | Primary Key (Pola ID) | Tipe Data Utama | Foreign Key / Referensi Entitas |
|:---|:---|:---|:---|:---|:---|
| 1 | `users` | 4 | `id` (`usr_*`) | TEXT, JSONB (permissions), TIMESTAMPTZ, BOOLEAN, INT | Mandiri (Root User) |
| 2 | `teams` | 1 | `id` (`team_*`) | TEXT, TIMESTAMPTZ | `owner_id -> users(id)` |
| 3 | `team_members` | 3 | `id` (`tm_*`) | TEXT, TIMESTAMPTZ | `team_id -> teams(id)`, `user_id -> users(id)` |
| 4 | `projects` | 2 | `id` (`proj_*`) | TEXT, JSONB (tags), BOOLEAN, TIMESTAMPTZ | `owner_id -> users(id)`, `team_id -> teams(id)` (opsional) |
| 5 | `project_members` | 4 | `id` (`pm_*`) | TEXT, TIMESTAMPTZ | `project_id -> projects(id)`, `user_id -> users(id)` |
| 6 | `materials` | 2 | `id` (`mat_*`) | TEXT, INT, BIGINT, JSONB (tags), TIMESTAMPTZ | `uploaded_by -> users(id)`, `project_ids -> projects(id)` (M:N) |
| 7 | `material_collections` | 1 | `id` (`col_*`) | TEXT, TIMESTAMPTZ | `created_by -> users(id)`, `material_ids -> materials(id)` (M:N) |
| 8 | `reading_progress` | 1 | `id` (`rp_*`) | TEXT, INT, DOUBLE PRECISION, TIMESTAMPTZ | `user_id -> users(id)`, `material_id -> materials(id)` |
| 9 | `bookmarks` | 1 | `id` (`bm_*`) | TEXT, INT, TIMESTAMPTZ | `user_id -> users(id)`, `material_id -> materials(id)` |
| 10 | `highlights` | 1 | `id` (`hl_*`) | TEXT, INT, TIMESTAMPTZ | `user_id -> users(id)`, `material_id -> materials(id)` |
| 11 | `notes` | 1 | `id` (`note_*`) | TEXT, INT, TIMESTAMPTZ | `user_id -> users(id)`, `material_id -> materials(id)`, `project_id -> projects(id)` |
| 12 | `units` | 33 | `unit_id` (`UNIT_*`) | TEXT, DOUBLE PRECISION | Mandiri (Unit Registry Standar) |
| 13 | `variables` | 6 | `variable_id` (`VAR_*`) | TEXT, JSONB (allowed_range), TIMESTAMPTZ | `unit -> scientific_units(symbol)`, `source_reference -> references` |
| 14 | `parameters` | 4 | `parameter_id` (`PARAM_*`) | TEXT, JSONB (value, range), BOOLEAN, TIMESTAMPTZ | `unit -> scientific_units(symbol)`, `reference_ids -> references` (M:N) |
| 15 | `formulas` | 5 | `formula_id` (`FORMULA_*`) | TEXT, JSONB (inputs, outputs, AST), TIMESTAMPTZ | `parameter_ids -> parameters` (M:N), `reference_ids -> references` (M:N) |
| 16 | `algorithms` | 0 | `algorithm_id` (`ALG_*`) | TEXT, JSONB (steps, routes), TIMESTAMPTZ | `parameter_ids -> parameters` (M:N), `reference_ids -> references` (M:N) |
| 17 | `models` | 1 | `model_id` (`MODEL_*`) | TEXT, JSONB (assumptions, states), BOOLEAN, TIMESTAMPTZ | `variable_ids`, `formula_ids`, `parameter_ids`, `reference_ids` (M:N) |
| 18 | `references` | 2 | `reference_id` (`REF_*`) | TEXT, INT, JSONB (authors) | Mandiri (Bibliografi Literatur) |
| 19 | `interpretation_rules` | 2 | `rule_id` (`RULE_*`) | TEXT, JSONB (thresholds), TIMESTAMPTZ | `target_variable_or_metric -> variables`, `reference_ids -> references` |
| 20 | `calculations` | 0 | `calculation_id` (`calc_*`) | TEXT, JSONB (inputs, steps, result), TIMESTAMPTZ | `user_id -> users(id)`, `project_id -> projects(id)` |
| 21 | `datasets` | 1 | `id` (`ds_*`) | TEXT, TIMESTAMPTZ | `project_id -> projects(id)`, `uploaded_by -> users(id)` |
| 22 | `dataset_versions` | 2 | `id` (`dsv_*`) | TEXT, JSONB (columns, data, report), TIMESTAMPTZ | `dataset_id -> datasets(id)`, `created_by -> users(id)` |
| 23 | `statistics_analyses` | 1 | `id` (`stat_*`) | TEXT, JSONB (target_cols, results), TIMESTAMPTZ | `project_id -> projects(id)`, `dataset_version_id -> dataset_versions(id)` |
| 24 | `charts` | 1 | `id` (`chart_*`) | TEXT, JSONB (config), TIMESTAMPTZ | `project_id -> projects(id)`, `analysis_id -> statistics_analyses(id)` |
| 25 | `notebooks` | 1 | `id` (`nb_*`) | TEXT, TIMESTAMPTZ | `project_id -> projects(id)`, `created_by -> users(id)` |
| 26 | `notebook_cells` | 5 | `id` (`cell_*`) | TEXT, INT, TIMESTAMPTZ | `notebook_id -> notebooks(id)` |
| 27 | `code_executions` | 0 | `id` (`exec_*`) | TEXT, INT, TIMESTAMPTZ | `project_id -> projects(id)`, `executed_by -> users(id)` |
| 28 | `experiments` | 1 | `id` (`exp_*`) | TEXT, JSONB (mods, output), TIMESTAMPTZ | `project_id -> projects(id)`, `baseline_model_id -> models(model_id)` |
| 29 | `audit_logs` | 1 | `id` (`audit_*`) | TEXT, TIMESTAMPTZ | `user_id -> users(id)` (opsional audit system) |
| 30 | `provenance_records` | 1 | `id` (`prov_*`) | TEXT, JSONB (manifest), TIMESTAMPTZ | `project_id -> projects(id)`, `user_id -> users(id)` |
| 31 | `role_requests` | 0 | `request_id` (`rr_*`) | TEXT, TIMESTAMPTZ | `user_id -> users(id)`, `reviewed_by -> users(id)` |
| 32 | `external_identities` | 0 | `id` (`ext_*`) | TEXT, BOOLEAN, TIMESTAMPTZ | `user_id -> users(id)` |

---

## 3. Keputusan Tipe Data dan Integritas

| Jenis Data | Tipe Sumber JSON | Tipe Target PostgreSQL | Rationale & Aturan Integritas |
|:---|:---|:---|:---|
| **Identifier Utama** | `string` (`usr_*`, `proj_*`) | `VARCHAR(64)` / `TEXT` | Mempertahankan string ID domain historis tanpa mutasi. |
| **Integer / Posisi** | `number` (cth: `1`, `2024`) | `INTEGER` | Nilai bilangan bulat (tahun, halaman, order cell, token version). |
| **Ukuran File Bita** | `number` (cth: `2218`) | `BIGINT` | Mendukung ukuran berkas akademik besar tanpa batas 32-bit. |
| **Pecahan / Fisiologi** | `number` (cth: `1.85`, `71.31`) | `DOUBLE PRECISION` | Presisi floating point IEEE 754 64-bit identik dengan V8 runtime Node.js. |
| **Boolean Flag** | `boolean` (`true`/`false`) | `BOOLEAN` | Standar boolean SQL (NOT NULL dengan default `FALSE` jika relevan). |
| **Waktu / Timestamp** | `string` ISO-8601 UTC | `TIMESTAMPTZ` | Timestamp dengan zona waktu; selalu dinormalisasi ke UTC saat penyimpanan. |
| **Pohon AST / Matriks** | `object` bersarang | `JSONB` | AST formula matematika, matriks koefisien, dan dictionary analitik. |
| **Koleksi Relasi N:M** | `array of strings` | `Junction Table` | Dinormalisasikan ke tabel relasional bersambung untuk menjamin FK. |
| **Daftar Tag Sederhana**| `array of strings` | `JSONB` / `TEXT[]` | Disimpan sebagai `JSONB DEFAULT '[]'` untuk kemudahan query flexibel. |

---

## 4. Dependency Graph & Urutan Pembuatan Tabel

```
                      +-------------------+      +-----------------------+
                      |  scientific_units |      | scientific_references |
                      +---------+---------+      +-----------+-----------+
                                |                            |
                                v                            v
                      +-------------------+      +-----------------------+
                      | scientific_vars   |      | scientific_parameters |
                      +---------+---------+      +-----------+-----------+
                                |                            |
                                +--------------+-------------+
                                               |
                                               v
                                  +------------------------+
                                  |  scientific_formulas   |
                                  +------------+-----------+
                                               |
                                               v
                                  +------------------------+
                                  |    scientific_models   |
                                  +------------+-----------+
                                               |
                                               v
+-------------+                   +------------------------+
|    users    +------------------>+  scientific_interp_... |
+------+------+                   +------------------------+
       |
       +---------> external_identities, role_requests
       |
       +---------> teams -------> team_members
       |             |
       |             v
       +---------> projects ----> project_members
                     |
                     +----------> materials ----> material_collections
                     |             |
                     |             +------------> reading_progress, bookmarks, highlights, notes
                     |
                     +----------> datasets -----> dataset_versions
                     |                              |
                     |                              +------> statistics_analyses
                     |                              |             |
                     |                              +------------>+------> charts
                     |
                     +----------> notebooks ----> notebook_cells
                     |
                     +----------> code_executions, experiments, scientific_calculations
                     |
                     +----------> provenance_records, audit_logs
```

### Urutan Eksekusi Pembuatan Tabel (Topological Order):
1. `scientific_units`, `scientific_references`
2. `scientific_variables`, `scientific_parameters`, `scientific_parameter_references`
3. `scientific_formulas`, `scientific_formula_parameters`, `scientific_formula_references`
4. `scientific_algorithms`, `scientific_algorithm_parameters`, `scientific_algorithm_references`
5. `scientific_models` dan junction tables (`model_variables`, `model_formulas`, `model_algorithms`, `model_parameters`, `model_references`)
6. `scientific_interpretation_rules`, `scientific_interpretation_rule_references`
7. `users`
8. `external_identities`, `role_requests`
9. `teams`, `team_members`
10. `projects`, `project_members`
11. `materials`, `material_projects`
12. `material_collections`, `collection_materials`
13. `reading_progress`, `bookmarks`, `highlights`, `notes`
14. `datasets`, `dataset_versions`
15. `statistics_analyses`
16. `charts`
17. `notebooks`, `notebook_cells`
18. `code_executions`
19. `experiments`
20. `provenance_records`
21. `audit_logs`
22. `scientific_calculations`

---

## 5. Strategi Constraints, Foreign Keys & Indeks

### 5.1 Kebijakan Foreign Key `ON DELETE`:
- **`ON DELETE CASCADE`**: Digunakan untuk entitas subordinat yang tidak memiliki makna mandiri tanpa induknya:
  - `team_members`, `project_members`, `notebook_cells`, `dataset_versions`
  - Seluruh junction table (`material_projects`, `collection_materials`, dll.)
  - Study annotations: `bookmarks`, `highlights`, `reading_progress`
- **`ON DELETE RESTRICT`**: Digunakan untuk mencegah penghapusan entitas master yang masih dirujuk data aktif penting:
  - `projects.owner_id -> users(id)`
  - `materials.uploaded_by -> users(id)`
  - `datasets.uploaded_by -> users(id)`
  - `experiments.baseline_model_id -> scientific_models(model_id)`
- **`ON DELETE SET NULL`**: Digunakan untuk referensi opsional atau pencatatan audit:
  - `projects.team_id -> teams(id)`
  - `notes.project_id -> projects(id)`
  - `audit_logs.user_id -> users(id)` (menjaga integritas riwayat log meskipun user dihapus)
  - `role_requests.reviewed_by -> users(id)`

### 5.2 Strategi Indeks Efisien (Zero Duplicate Indexing):
- Primary key otomatis memiliki B-tree index unik.
- Indeks sekunder dipasang secara spesifik pada:
  - Foreign key kolaboratif (`user_id`, `project_id`, `team_id`, `material_id`).
  - Kolom query frekuensi tinggi: `users.email`, `users.role`, `users.account_status`.
  - Jejak audit & analitik: `audit_logs.timestamp`, `audit_logs(entity_type, entity_id)`, `provenance_records.provenance_hash`.

---

## 6. Keputusan Normalisasi vs JSONB

| Kelompok Data | Keputusan | Rationale Teknis |
|:---|:---|:---|
| **32 Koleksi Entitas Utama** | **RELATIONAL** | Menjamin integritas ACID, foreign key cascading, dan query performa tinggi. |
| **Relasi N:M (Project-Material, Collection, Model Assembly)** | **RELATIONAL (Junction Tables)** | Menghindari array search (`JSONB @>`) yang mahal; memungkinkan constraint FK dua arah. |
| **Pohon Ekspresi Matematika AST (`expression_ast`)** | **JSONB** | Struktur AST bersifat rekursif dan bervariasi (unary, binary, call node, constant). Normalisasi ke tabel node terpisah akan menghasilkan ratusan join per evaluasi formula. |
| **Skema Tabular & Data Dataset (`columns`, `data`)** | **JSONB** | Dataset klinis memiliki skema kolom dinamis yang ditentukan oleh file CSV yang diunggah pengguna. |
| **Matriks Hasil Analisis (`statistics_analyses.results`)** | **JSONB** | Berisi dictionary multidimensi (mean, median, p-value, ANOVA F-test, matriks korelasi). |
| **Manifest Lingkungan & Provenance (`reproducibility_manifest`)** | **JSONB** | Snapshot lingkungan eksekusi deterministik untuk replikasi ilmiah. |

---

## 7. Evaluasi & Perbandingan ORM

| Kriteria Evaluasi | Drizzle ORM | Kysely | Prisma | Native Driver (`pg`) + Managed SQL |
|:---|:---|:---|:---|:---|
| **TypeScript Type-Safety** | Sangat Kuat (Schema-driven) | Sangat Kuat (Query builder) | Kuat (Generated types) | Parsial (Perlu manual typing) |
| **SQL Control & Transparansi** | Penuh (1:1 SQL representation) | Penuh (Raw SQL friendly) | Terbatas (Prisma Engine abstraction) | Mutlak (SQL murni) |
| **Beban Dependensi / Binary** | Sangat Ringan (Zero binary) | Sangat Ringan (Zero binary) | Berat (Prisma Rust query engine) | Sangat Ringan |
| **Dukungan JSONB & Typed Column**| Unggul (`jsonb<T>()` helpers) | Sangat Baik | Cukup (Json type generic) | Manual serialize/deserialize |
| **Kesesuaian Repository Pattern** | **Sangat Tinggi (Recommended)** | Tinggi | Sedang (Prisma model lock-in) | Tinggi |
| **Overhead Bundle / Server Start** | Minimal (<5ms) | Minimal (<5ms) | Signifikan (>100ms cold start) | Nol |

### Rekomendasi Arsitektural:
- **Pilihan 1 (Rekomendasi Utama): Drizzle ORM.** Menawarkan kontrol penuh atas DDL SQL, representasi skema TypeScript yang deklaratif, dukungan typed JSONB kelas satu untuk data ilmiah AST, serta tanpa overhead runtime binary engine.
- **Pilihan 2 (Alternatif): Kysely.** Query builder bertipe ketat yang sangat cocok jika tim menginginkan SQL murni dengan compiler type check tanpa ORM magic.
- **Catatan Status:** Keputusan ORM ini bersifat rekomendatif dan **belum diadopsi atau diinstal** pada milestone ini sesuai batasan mutlak ruang lingkup.

---

## 8. Isu Terbuka, Asumsi & Keputusan Tertunda ([DECISION_PENDING])

1. **`experiments.experimental_model_id`:**  
   - **Fakta Data:** Pada record `exp_001`, `baseline_model_id = 'MODEL_DEMO_ANTHROPOMETRY_V1'` (terdaftar di `models`), namun `experimental_model_id = 'MODEL_DEMO_ANTHROPOMETRY_V1_CLONE'` (tidak ada di tabel `models`).  
   - **Tindakan Desain:** Pada DDL, `experimental_model_id` didefinisikan sebagai `VARCHAR(64) NOT NULL` tanpa foreign key constraint langsung ke `scientific_models(model_id)` untuk mencegah kegagalan migrasi baseline data.  
   - **Usulan Penyelesaian:** Pada E.1B.4, putuskan apakah model clone harus didaftarkan secara eksplisit sebagai row di `scientific_models` dengan `parent_model_id` terisi, atau tetap sebagai dynamic branch tag.
2. **Kesesuaian Simbol Satuan vs ID Satuan:**  
   - **Fakta Data:** `variables.unit` dan `parameters.unit` menyimpan string simbol (contoh `"kg"`, `"m"`, `"yr"`, `"unitless"`), bukan `unit_id` (contoh `"UNIT_KG"`).  
   - **Tindakan Desain:** Kolom `scientific_units.symbol` diberi constraint `UNIQUE`, sehingga foreign key dapat diarahkan ke `scientific_units(symbol)` secara valid.
3. **Penyimpanan Password Hash Pengguna:**  
   - **Fakta Data:** Baseline `users` belum memiliki kolom password hash (autentikasi demo saat ini menggunakan token sesi langsung dan mock/local).  
   - **Tindakan Desain:** Tidak ditambahkan kolom password hash pada tabel aktif demi menjaga keselarasan baseline. Perluasan autentikasi akan dimasukkan dalam milestone tata kelola autentikasi masa depan.
