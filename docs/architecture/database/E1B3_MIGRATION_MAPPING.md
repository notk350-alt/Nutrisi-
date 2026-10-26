# NUTRIBODYSIM — JSON to PostgreSQL Migration Mapping Specification

**Dokumen:** E1B3_MIGRATION_MAPPING.md  
**Milestone:** MVS-B2.5E.1B.3  
**Status:** ARCHITECTURE DESIGN ONLY (NO RUNTIME MIGRATION)  
**Tanggal:** 23 Oktober 2026  
**Target Engine:** PostgreSQL 15+ / Cloud SQL for PostgreSQL  
**Sumber Data:** `data/nutribodysim_db.json` (57.187 bytes, SHA-256: `a7f7cfa135e5b8c4be091cff49f5b1e2ecc88514776b8f908bd3ccf0d188af14`)

---

## 1. Ikhtisar & Prinsip Migrasi

Tujuan pemetaan ini adalah menjamin transformasi data dari file tunggal `lowdb` (`nutribodysim_db.json`) menuju skema relasional PostgreSQL dilakukan secara deterministik, tanpa kehilangan data (*zero data loss*), tanpa degradasi presisi kalkulasi ilmiah, dan dengan kepatuhan penuh terhadap integritas referensial.

### Prinsip Utama:
1. **Preservasi Identitas Primer:** Seluruh ID domain (`usr_*`, `proj_*`, `mat_*`, `ds_*`, `dsv_*`, `UNIT_*`, `VAR_*`, `PARAM_*`, `FORMULA_*`, `MODEL_*`, `RULE_*`, `REF_*`) dipertahankan secara identik sebagai Primary Key tipe `VARCHAR(64)` / `TEXT`. Tidak ada pembuatan UUID baru yang menggantikan ID eksisting.
2. **Preservasi Presisi Ilmiah:** Nilai biometrik, koefisien biokinetik, dan pengali konversi satuan (`to_base_multiplier`, `progress_pct`, `anthropometric_ratio`) dipetakan ke `DOUBLE PRECISION` (IEEE 754 64-bit float) untuk mencegah distorsi pembulatan pada scientific calculation engine.
3. **Pemisahan Data Relasional vs JSONB:**
   - Field relasional murni (foreign key 1:1, 1:N) dipetakan ke kolom relasional standar.
   - Relasi Many-to-Many (N:M) dipetakan ke *junction tables* eksplisit (`material_projects`, `collection_materials`, `formula_parameters`, dll.).
   - Struktur dinamis, pohon abstrak (AST), dan payload analitik fleksibel (`expression_ast`, `validation_report`, `results`, `reproducibility_manifest`) disimpan sebagai `JSONB`.
4. **Zero Dual-Writer:** Proses migrasi dijalankan dalam mode satu arah (JSON -> PostgreSQL) secara *offline batch cutover*, menghindari kompleksitas dan risiko inkonsistensi konkurensi dual-writer.

---

## 2. Pemetaan Koleksi JSON ke Tabel PostgreSQL

| No | Koleksi JSON Sumber | Tabel PostgreSQL Target | Junction Table Tambahan | Strategi Penyimpanan |
|:---|:---|:---|:---|:---|
| 1 | `units` (33) | `scientific_units` | - | Relational Murni |
| 2 | `references` (2) | `scientific_references` | - | Hybrid (Authors JSONB) |
| 3 | `variables` (6) | `scientific_variables` | - | Hybrid (Allowed Range JSONB) |
| 4 | `parameters` (4) | `scientific_parameters` | `scientific_parameter_references` | Hybrid (Value & Range JSONB, Refs Junction) |
| 5 | `formulas` (5) | `scientific_formulas` | `scientific_formula_parameters`, `scientific_formula_references` | Hybrid (Inputs/Outputs/AST JSONB, Refs Junction) |
| 6 | `algorithms` (0) | `scientific_algorithms` | `scientific_algorithm_parameters`, `scientific_algorithm_references` | Hybrid (Steps/Routes JSONB, Refs Junction) |
| 7 | `models` (1) | `scientific_models` | `scientific_model_variables`, `scientific_model_formulas`, `scientific_model_parameters`, `scientific_model_references` | Hybrid (Assumptions/States JSONB, Assembly Junctions) |
| 8 | `interpretation_rules` (2) | `scientific_interpretation_rules` | `scientific_interpretation_rule_references` | Hybrid (Thresholds JSONB, Refs Junction) |
| 9 | `users` (4) | `users` | - | Hybrid (Permissions JSONB) |
| 10 | `external_identities` (0) | `external_identities` | - | Relational Murni |
| 11 | `role_requests` (0) | `role_requests` | - | Relational Murni |
| 12 | `teams` (1) | `teams` | - | Relational Murni |
| 13 | `team_members` (3) | `team_members` | - | Relational Murni |
| 14 | `projects` (2) | `projects` | - | Hybrid (Tags JSONB) |
| 15 | `project_members` (4) | `project_members` | - | Relational Murni |
| 16 | `materials` (2) | `materials` | `material_projects` | Hybrid (Tags JSONB, Project IDs Junction) |
| 17 | `material_collections` (1) | `material_collections` | `collection_materials` | Relational + Junction (Material IDs Junction) |
| 18 | `reading_progress` (1) | `reading_progress` | - | Relational Murni |
| 19 | `bookmarks` (1) | `bookmarks` | - | Relational Murni |
| 20 | `highlights` (1) | `highlights` | - | Relational Murni |
| 21 | `notes` (1) | `notes` | - | Relational Murni |
| 22 | `datasets` (1) | `datasets` | - | Relational Murni |
| 23 | `dataset_versions` (2) | `dataset_versions` | - | Hybrid (Columns, Data, Report JSONB) |
| 24 | `statistics_analyses` (1) | `statistics_analyses` | - | Hybrid (Target Columns, Results JSONB) |
| 25 | `charts` (1) | `charts` | - | Hybrid (Config JSONB) |
| 26 | `notebooks` (1) | `notebooks` | - | Relational Murni |
| 27 | `notebook_cells` (5) | `notebook_cells` | - | Relational Murni |
| 28 | `code_executions` (0) | `code_executions` | - | Relational Murni |
| 29 | `experiments` (1) | `experiments` | - | Hybrid (Modifications, Outputs JSONB) |
| 30 | `provenance_records` (1) | `provenance_records` | - | Hybrid (Manifest JSONB) |
| 31 | `audit_logs` (1) | `audit_logs` | - | Relational Murni |
| 32 | `calculations` (0) | `scientific_calculations` | - | Hybrid (Inputs, Steps, Results JSONB) |

---

## 3. Aturan Transformasi Data Detail (Field-Level)

### 3.1 Format Temporal (Tanggal & Waktu)
- **Sumber JSON:** String ISO-8601 UTC (contoh: `"2026-09-21T10:00:00.000Z"` atau `"2026-09-01T00:00:00Z"`).
- **Target PostgreSQL:** `TIMESTAMPTZ` (Timestamp with time zone).
- **Aturan Konversi:** Diparsing menggunakan parser waktu standar UTC. Jika bernilai `null` atau `undefined` pada kolom opsional, disimpan sebagai `NULL`. Pada kolom audit wajib, jika kosong diberi fallback `CURRENT_TIMESTAMP`.

### 3.2 Tipe Numerik & Pecahan Ilmiah
- **Besaran Skalar Fisika & Konversi Satuan:**
  - `to_base_multiplier`, `to_base_offset` -> `DOUBLE PRECISION`
  - `progress_pct`, `scroll_position` -> `DOUBLE PRECISION`
  - `anthropometric_ratio`, `estimated_rmr` dalam JSON payload eksperimen -> dipertahankan presisinya di dalam `JSONB`.
- **Ukuran File & Integer:**
  - `file_size_bytes` -> `BIGINT`
  - `page`, `total_pages`, `year`, `order_index`, `execution_time_ms`, `token_version` -> `INTEGER`.

### 3.3 Normalisasi Array Menjadi Junction Tables
Beberapa entitas JSON menyimpan relasi many-to-many dalam bentuk array of strings. Pada PostgreSQL, array tersebut dinormalisasikan ke *junction table* untuk mendukung query relational join:
1. `materials.project_ids` -> Diekstrak menjadi baris di `material_projects (material_id, project_id)`.
2. `material_collections.material_ids` -> Diekstrak menjadi baris di `collection_materials (collection_id, material_id)`.
3. `parameters.reference_ids` -> Diekstrak menjadi `scientific_parameter_references (parameter_id, reference_id)`.
4. `formulas.parameter_ids` -> Diekstrak menjadi `scientific_formula_parameters (formula_id, parameter_id)`.
5. `formulas.reference_ids` -> Diekstrak menjadi `scientific_formula_references (formula_id, reference_id)`.
6. `models.variable_ids` -> Diekstrak menjadi `scientific_model_variables (model_id, variable_id)`.
7. `models.formula_ids` -> Diekstrak menjadi `scientific_model_formulas (model_id, formula_id)`.
8. `models.parameter_ids` -> Diekstrak menjadi `scientific_model_parameters (model_id, parameter_id)`.
9. `models.reference_ids` -> Diekstrak menjadi `scientific_model_references (model_id, reference_id)`.
10. `interpretation_rules.reference_ids` -> Diekstrak menjadi `scientific_interpretation_rule_references (rule_id, reference_id)`.

### 3.4 Penyimpanan JSONB Terpilih
Struktur data berikut sengaja dipertahankan sebagai `JSONB` karena sifatnya yang dinamis, bersarang (*deeply nested*), atau berupa skema eksternal:
- `scientific_formulas.expression_ast`: Pohon ekspresi matematika AST yang diproses rekursif oleh `scientific/engine/calculationEngine.ts`.
- `scientific_variables.allowed_range` & `scientific_parameters.valid_range`: Rentang dinamis opsional `{ min, max, warning_min, warning_max }`.
- `scientific_parameters.value`: Nilai parameter yang dapat bertipe angka, string, array, atau matriks koefisien.
- `dataset_versions.columns`, `dataset_versions.data`, `dataset_versions.validation_report`: Matriks tabular dan laporan validasi dataset dinamis.
- `statistics_analyses.results`: Dictionary hasil kalkulasi inferensial/deskriptif beragam dimensi.
- `provenance_records.reproducibility_manifest`: Manifest hash environment dan dependensi.

---

## 4. Urutan Pemindahan Data (Topological Migration Sequence)

Untuk mencegah galat *foreign key constraint violation* selama migrasi, pemuatan data wajib mengikuti 7 gelombang dependensi berikut:

```
[Gelombang 1: Master Standar Ilmiah]
  scientific_units, scientific_references

[Gelombang 2: Variabel & Parameter Ilmiah]
  scientific_variables, scientific_parameters
  -> scientific_parameter_references

[Gelombang 3: Formula, Algoritma, Model & Aturan Interpretasi]
  scientific_formulas, scientific_algorithms, scientific_models, scientific_interpretation_rules
  -> scientific_formula_parameters, scientific_formula_references
  -> scientific_algorithm_parameters, scientific_algorithm_references
  -> scientific_model_variables, scientific_model_formulas, scientific_model_parameters, scientific_model_references
  -> scientific_interpretation_rule_references

[Gelombang 4: Identitas, Tim & Proyek Utama]
  users
  -> external_identities, role_requests
  -> teams -> team_members
  -> projects -> project_members

[Gelombang 5: Academic Materials & Dataset Workspace]
  materials -> material_projects
  material_collections -> collection_materials
  reading_progress, bookmarks, highlights, notes
  datasets -> dataset_versions

[Gelombang 6: Analisis, Visualisasi & Komputasi Riset]
  statistics_analyses
  charts
  notebooks -> notebook_cells
  code_executions
  experiments
  scientific_calculations

[Gelombang 7: Jejak Audit & Provenance]
  provenance_records
  audit_logs
```

---

## 5. Prosedur Validasi Kesetaraan Data (Post-Migration Verification)

Setelah proses pemuatan data selesai, wajib dijalankan audit verifikasi otomatis:

1. **Uji Kuantitas Record (Row Count Audit):**
   - Memastikan `COUNT(*)` pada setiap tabel PostgreSQL sama persis dengan panjang array pada koleksi JSON sumber.
   - Total record pada 32 koleksi dasar:
     - `scientific_units`: 33
     - `scientific_references`: 2
     - `scientific_variables`: 6
     - `scientific_parameters`: 4
     - `scientific_formulas`: 5
     - `scientific_algorithms`: 0
     - `scientific_models`: 1
     - `scientific_interpretation_rules`: 2
     - `users`: 4
     - `external_identities`: 0
     - `role_requests`: 0
     - `teams`: 1
     - `team_members`: 3
     - `projects`: 2
     - `project_members`: 4
     - `materials`: 2
     - `material_collections`: 1
     - `reading_progress`: 1
     - `bookmarks`: 1
     - `highlights`: 1
     - `notes`: 1
     - `datasets`: 1
     - `dataset_versions`: 2
     - `statistics_analyses`: 1
     - `charts`: 1
     - `notebooks`: 1
     - `notebook_cells`: 5
     - `code_executions`: 0
     - `experiments`: 1
     - `provenance_records`: 1
     - `audit_logs`: 1
     - `scientific_calculations`: 0
     - **Total Baseline Record:** 83 record.

2. **Uji Kesetaraan Deep Value & Hash (Zero-Delta Audit):**
   - Menghitung SHA-256 canonical JSON representation dari data yang diekstrak kembali dari PostgreSQL dan membandingkannya dengan sumber JSON asli.
   - Memvalidasi formula kunci: `FORMULA_DEMO_QUETELET`, `FORMULA_BMI_QUETELET`, `FORMULA_BMR_MIFFLIN`.
   - Menjalankan suite pengujian kalkulasi ilmiah (`scientific/__tests__/*.test.ts`) terhadap data yang ditarik dari PostgreSQL untuk membuktikan delta numerik = 0.00000000.

3. **Uji Integritas Referensial & Relasi:**
   - Memverifikasi tidak ada foreign key yang menghasilkan status *orphan*.
   - Memverifikasi integritas relasi pada `team_members`, `project_members`, `material_projects`, dan `collection_materials`.

---

## 6. Rencana Rollback & Kriteria Keberhasilan/Kegagalan

### 6.1 Kriteria Keberhasilan (Success Gates)
- 100% dari 32 tabel terisi tanpa galat constraint.
- Seluruh 83 record dasar termuat dengan ID primer utuh.
- Seluruh baris relasi pada 10 junction tables terverifikasi.
- Zero floating-point drift pada evaluasi formula AST dan kalkulasi BMR/BMI.

### 6.2 Kriteria Kegagalan (Failure Triggers)
- Terjadi kegagalan constraint foreign key yang tidak tertangani.
- Pemotongan string (truncation) atau konversi tipe yang menyebabkan data loss.
- Ketidaksesuaian jumlah baris (*row count mismatch*).
- Kegagalan uji kalkulasi ilmiah pada modul `scientific/`.

### 6.3 Prosedur Rollback Cepat
1. Database PostgreSQL target dibersihkan (`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`).
2. Aplikasi tetap sepenuhnya terhubung ke adapter JSON operasional (`LowdbJsonDatabase` / `nutribodysim_db.json`).
3. Laporan audit galat disusun untuk mengidentifikasi penyebab kegagalan sebelum mencoba ulang.
