# NutriBodySim MVS-B2.5D.2 — Status Ringkasan & Laporan Checkpoint
# Transactional Account Provisioning & External Identity Mapping

---

## 1. Ringkasan Milestone

* **Milestone**: MVS-B2.5D.2 — Transactional Account Provisioning & External Identity Mapping
* **Mode Operasi**: **IMPLEMENTATION — ISOLATED DATABASE SERVICE**
* **Status**: **PASS / READY FOR EVALUATION**
* **Status Google Login Publik**: **TETAP TIDAK AKTIF (STRICTLY INACTIVE)**
* **Public Routes Added**: **0 routes** (`api.ts` tidak dimodifikasi).
* **Session Creation**: **DI LUAR CAKUPAN (0 sessions/cookies created)**.
* **Tanggal Penyelesaian**: 20 Oktober 2026
* **Governing Rule Verification**:
  - Runtime Routes Added: **0 routes**.
  - User Sessions Created: **0 sessions**.
  - Database Side-Effects: **0 records modified in baseline fixtures**.
  - External Dependencies Added: **0 dependencies** (menggunakan dependensi internal).
  - Unit & Adversarial Tests: **14 tes Provisioning lulus (100%)**.
  - Total Backend Tests: **16 berkas tes, 376 tes lulus (100%)**.
  - TypeScript Compiler (`tsc --noEmit`): **0 errors (CLEAN)**.
  - Applet Build (`compile_applet`): **SUCCEEDED**.
  - Laporan Audit Lengkap: Diterbitkan pada `MVS_B2_5D2_AUDIT.md`.

---

## 2. Artefak Kode yang Dimodifikasi & Ditambahkan

| Modul / Berkas | Fungsi Utama & Jaminan Keamanan | Status |
| :--- | :--- | :--- |
| `backend/database/types.ts` | Memperluas union `AuditLog['action']` dengan aksi OIDC: `'OIDC_ACCOUNT_PROVISION'`, `'OIDC_IDENTITY_CONFLICT'`, `'OIDC_INACTIVE_ACCESS_ATTEMPT'`, `'OIDC_STORAGE_FAILURE'`, dan `'OIDC_CLAIM_ANOMALY'`. | **TERVERIFIKASI** |
| `backend/auth/oidc/types.ts` | Mendefinisikan kontrak output `IdentityProvisioningOutcome` (6 distinct outcomes), `ProvisionGoogleIdentityOptions`, dan `ProvisionGoogleIdentityResult`. | **TERVERIFIKASI** |
| `backend/database/store.ts` | Menambahkan method `getUserById`, `getUserByEmail`, dan method transaksional `provisionGoogleUser` dengan pembuatan user `RegisteredUser`, `permissions: []`, `account_status: 'ACTIVE'`, `ExternalIdentity`, dan snapshot rollback penuh jika `saveToDisk` gagal. | **TERVERIFIKASI** |
| `backend/auth/oidc/provisioner.ts` | Mengimplementasikan `GoogleIdentityProvisioningService` dan fungsi `provisionVerifiedGoogleIdentity` dengan in-memory keyed lock per `sub` & per `email`, validasi kontrak ketat, penegakan anti-auto-merge, containment akun nonaktif, sanitasi profil, dan pencatatan audit. | **TERVERIFIKASI** |
| `backend/auth/oidc/index.ts` | Mengekspor modul `provisioner.ts` pada barrel OIDC. | **TERVERIFIKASI** |
| `backend/__tests__/oidcAccountProvisioningMVS_B2_5D2.test.ts` | 14 tes adversarial memvalidasi alur provisioning, idempotensi, race-condition konkurensi paralel, kegagalan I/O storage dengan rollback, penolakan auto-merge, penolakan akun suspended/disabled, imunitas privilese, dan zero-credential exposure. | **TERVERIFIKASI** |

---

## 3. Matriks Hasil Pengujian (Test Results Matrix)

```
Test Files  16 passed (16)
     Tests  376 passed (376)
  Duration  11.17s

✓ backend/__tests__/oidcAccountProvisioningMVS_B2_5D2.test.ts (14 tests)
  ✓ 1. First-Time Account Provisioning (3 tests)
  ✓ 2. Idempotency & Concurrency Safety (2 tests)
  ✓ 3. Anti-Auto-Merge Policy & Email Collision (1 test)
  ✓ 4. Inactive Account Containment (2 tests)
  ✓ 5. Malformed & Unverified Identity Handling (3 tests)
  ✓ 6. Storage Failure & Transactional Atomic Rollback (1 test)
  ✓ 7. Security Invariance & Zero-Credential Exposure (2 tests)
```

---

## 4. Batasan Keamanan yang Tetap Terjaga

- **Google Login Publik**: **TETAP TIDAK AKTIF (NOT ACTIVE)**.
- **Rute Publik**: Tidak ada rute API publik baru yang dibuka (`api.ts` tidak diubah).
- **Sesi Pengguna**: Tidak ada sesi atau cookie autentikasi yang dibuat.
- **Basis Data**: Tidak ada migrasi format penyimpanan; data seed baseline tetap utuh.
- **Auto-Merge**: Dilarang keras; kesamaan email dengan akun lokal selalu menghasilkan `IDENTITY_CONFLICT` dan menuntut penautan eksplisit.
- **Main Administrator**: Tetap terisolasi penuh pada script CLI bootstrap server.

---

## 5. Kondisi Berhenti (Stop Condition)

Milestone **MVS-B2.5D.2** telah selesai.
Sistem berhenti pada kondisi bersih (*clean build & zero lint errors*) dan menunggu evaluasi pengguna sebelum melanjutkan ke milestone berikutnya.
