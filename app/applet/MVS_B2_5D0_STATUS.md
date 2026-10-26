# NutriBodySim MVS-B2.5D.0 — Status Ringkasan & Laporan Audit Arsitektur
# Google Identity Mapping & Account Provisioning Specification

---

## 1. Ringkasan Milestone

* **Milestone**: MVS-B2.5D.0 — Google Identity Mapping & Account Provisioning Specification
* **Mode Operasi**: **SPECIFICATION / SECURITY AUDIT ONLY (NO RUNTIME CODE CHANGES)**
* **Status**: **PASS / READY FOR EVALUATION**
* **Status Google Login Publik**: **TETAP TIDAK AKTIF (NOT ACTIVE)**
* **Tanggal Penyelesaian**: 18 Oktober 2026
* **Governing Rule Verification**:
  - Runtime Code Files Modified: **0 files** (Dilarang mengubah kode runtime pada fase spesifikasi).
  - Public Routes Added: **0 routes** (`api.ts` tidak dimodifikasi).
  - User Sessions Created: **0 sessions** (tidak ada sesi, token, atau cookie yang diterbitkan).
  - Database Side-Effects: **0 records modified** (`nutribodysim_db.json` tidak bermutasi).
  - Test Suite Baseline: **14 test suites, 336 tests PASS (100%)**.
  - TypeScript Compiler (`tsc --noEmit`): **0 errors (CLEAN)**.
  - Applet Build (`compile_applet`): **SUCCEEDED**.
  - Dokumen Spesifikasi Utama: Diterbitkan pada `app/applet/MVS_B2_5D0_SPECIFICATION.md`.

---

## 2. Berkas yang Diaudit & Dibuat (Audit Trail of Inspected & Generated Files)

### A. Berkas yang Dibaca & Diaudit (Read-Only):
1. `app/applet/MVS_B2_5C0_SPECIFICATION.md` — Spesifikasi arsitektur OIDC awal.
2. `app/applet/MVS_B2_5C1_AUDIT.md` & `MVS_B2_5C1_STATUS.md` — Audit dan status primitif keamanan C.1.
3. `app/applet/MVS_B2_5C2_AUDIT.md` & `MVS_B2_5C2_STATUS.md` — Audit dan status verifier ID Token C.2.
4. `app/applet/MVS_B2_5C3_AUDIT.md` & `MVS_B2_5C3_STATUS.md` — Audit dan status token exchange handler C.3.
5. `app/applet/MVS_B2_5C4_AUDIT.md` & `MVS_B2_5C4_STATUS.md` — Audit dan status login orchestrator C.4.
6. `backend/database/types.ts` — Skema entitas `User`, `ExternalIdentity`, `RoleRequest`, `AuditLog`, `UserRole`, dan `AccountStatus`.
7. `backend/database/store.ts` — Implementasi `DatabaseStore`, `findExternalIdentity`, `linkExternalIdentity`, `saveToDisk`, dan pola rollback.
8. `backend/auth/roleRequestValidation.ts` — Hierarki role dan validasi pengajuan role elevation.
9. `backend/auth/roleApprovalEngine.ts` — Evaluasi otoritas reviewer bertingkat dan anti-self-approval.
10. `backend/auth/bootstrapMainAdmin.ts` — Layanan CLI terisolasi untuk penetapan Main Administrator.
11. `backend/auth/sessionStore.ts` — Store sesi memori berbasis SHA-256 token hash dan penegakan `token_version`.
12. `backend/auth/authMiddleware.ts` — Resolusi sesi, penolakan akun `SUSPENDED`/`DISABLED`, dan middleware RBAC.
13. `backend/auth/oidc/types.ts` — Kontrak `VerifiedOIDCIdentity`, `OIDCConfig`, dan error codes OIDC.
14. `backend/routes/api.ts` — Konfigurasi router, whitelist rute publik, dan endpoint autentikasi demo.

### B. Berkas Dokumentasi yang Dihasilkan:
1. `app/applet/MVS_B2_5D0_SPECIFICATION.md` — Dokumen arsitektur komprehensif memuat kebijakan identitas, larangan auto-merge, penanganan konflik email, analisis konkurensi database, kontrak konseptual, dan matriks keamanan 13 skenario.
2. `app/applet/MVS_B2_5D0_STATUS.md` — Laporan status eksekutif dan verifikasi tata kelola.

---

## 3. Temuan Kesenjangan Aktual (Gaps & Architectural Risks Identified)

Audit kode aktual menemukan sejumlah fakta kritis yang tidak boleh diasumsikan:

1. **GAP 1: Ketiadaan Base Role Unprivileged dalam `UserRole`**:
   - `UserRole` saat ini hanya terdiri dari: `'Student' | 'Lecturer' | 'Researcher' | 'Admin'`.
   - Tidak ada peran `RegisteredUser` atau `Guest`. Role terendah saat ini adalah `Student`, yang memiliki izin operasional `['VIEW', 'USE', 'CREATE', 'CLONE']`.
   - *Rekomendasi Spesifikasi*: Menahan akun baru dalam status tanpa izin administratif, atau menetapkan role `Student` hanya jika model bisnis mengizinkan akses mandiri mahasiswa, sementara elevasi role akademik tetap wajib melalui persetujuan manual.
2. **GAP 2: Ketiadaan Metode `createUser` / `provisionUser` pada `store.ts`**:
   - Seluruh pengguna saat ini hanya dibuat melalui seeding statis `generateSeedData()`. Belum ada fungsi store yang menangani pembuatan user baru secara aman dengan validasi keunikan email dan audit logging.
3. **GAP 3: `linkExternalIdentity` Belum Memvalidasi Status Akun & Audit Terintegrasi**:
   - Metode `linkExternalIdentity` yang ada tidak memeriksa apakah `targetUser.account_status === 'ACTIVE'` dan tidak secara otomatis memanggil `logAudit`.
4. **GAP 4: Batasan Database File JSON (`nutribodysim_db.json`)**:
   - Database saat ini berbasis in-memory `DatabaseState` yang diserialisasi ke disk menggunakan atomic rename (`tmp` file + `renameSync`).
   - Sistem tidak memiliki mekanisme lock lintas proses (*cross-process locking*), sehingga tidak aman untuk penskalaan multi-instance (multi-container / horizontal scale) tanpa migrasi ke database relasional ACID (seperti Cloud SQL PostgreSQL).
5. **GAP 5: Kapasitas & Integritas Jejak Audit (`AuditLog`)**:
   - `AuditLog` di-cap pada 1.000 record dengan pemotongan FIFO. File JSON lokal tidak bersifat tamper-proof terhadap akses sistem langsung. Enum `AuditLog['action']` saat ini belum mencakup aksi identitas OIDC.

---

## 4. Matriks Ringkasan Kebijakan Keamanan (Security Policy Summary)

| Kebijakan | Ketetapan Spesifikasi MVS-B2.5D.0 |
| :--- | :--- |
| **Identity Anchor** | Pasangan `(provider='google', provider_subject_id=sub)` adalah satu-satunya anchor identitas stabil. Email dan nama display dilarang menjadi primary anchor. |
| **Auto-Merge Policy** | **DILARANG KERAS**. Kesamaan alamat email tidak boleh menyebabkan penggabungan identitas otomatis karena berisiko Account Takeover (ATO). |
| **Email Conflict** | Jika email cocok dengan akun lokal tetapi Google `sub` belum terhubung, sistem gagal aman (HTTP 409/400) dan mewajibkan alur *Explicit Account Linking* dari sesi lokal aktif. |
| **Least Privilege Role** | Akun baru tidak boleh otomatis mendapatkan role Lecturer, Researcher, Admin, atau Main Admin. Domain email institusi tidak boleh digunakan untuk auto-approval role. |
| **Account Status Enforcement** | Akun lokal dengan status `SUSPENDED` atau `DISABLED` ditolak mutlak dari login OIDC maupun linking. |
| **Main Administrator Immunity** | Status Main Admin tidak pernah diberikan melalui login OIDC, provisioning, atau role request biasa; hanya melalui CLI bootstrap terisolasi. |
| **Session Boundary Separation** | Engine pemetaan identitas hanya menghasilkan objek identitas/user terverifikasi; pembuatan sesi (`createSession`) berada di luar tanggung jawab engine pemetaan. |

---

## 5. Status Verifikasi Teknis Repositori

```
Test Suites: 14 passed, 14 total
Tests:       336 passed, 336 total
Snapshots:   0 total
Time:        15.38s
TypeScript:  0 errors (tsc --noEmit CLEAN)
Build:       npm run build SUCCEEDED
Runtime Code Modified: 0 lines
```

---

## 6. Stop Condition & Langkah Selanjutnya

Milestone **MVS-B2.5D.0** telah selesai dengan sempurna sesuai mandat instruksi:
- Spesifikasi keamanan lengkap telah didokumentasikan di `MVS_B2_5D0_SPECIFICATION.md`.
- Tidak ada kode runtime yang diubah.
- Google Login publik tetap tidak aktif.
- Sistem berhenti dan menunggu peninjauan serta persetujuan pengguna sebelum melanjutkan ke implementasi terisolasi pada milestone **MVS-B2.5D.1**.
