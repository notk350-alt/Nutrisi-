# NutriBodySim MVS-B2.5D.1 — Status Ringkasan & Laporan Checkpoint
# Unprivileged Registered User & Permission Foundation

---

## 1. Ringkasan Milestone

* **Milestone**: MVS-B2.5D.1 — Unprivileged Registered User & Permission Foundation
* **Mode Operasi**: **IMPLEMENTATION — ISOLATED AUTHORIZATION FOUNDATION**
* **Status**: **PASS / READY FOR EVALUATION**
* **Status Google Login Publik**: **TETAP TIDAK AKTIF (STRICTLY INACTIVE)**
* **Provisioning Akun**: **BELUM DIIMPLEMENTASIKAN**
* **Identity Linking**: **BELUM DIIMPLEMENTASIKAN**
* **Tanggal Penyelesaian**: 20 Oktober 2026
* **Governing Rule Verification**:
  - Runtime Public Routes: **0 routes added** (`api.ts` tidak membuka rute publik OIDC baru).
  - User Sessions Created: **0 sessions created** (fondasi otorisasi terisolasi, tidak ada sesi/cookie dibuat).
  - Database Side-Effects: **0 records modified** (`nutribodysim_db.json` tidak berubah).
  - External Dependencies Added: **0 dependencies** (menggunakan modul dan dependensi internal yang ada).
  - Unit & Adversarial Tests: **26 tes RegisteredUser lulus (100%)**.
  - Total Backend Tests: **15 berkas tes, 362 tes lulus (100%)**.
  - TypeScript Compiler (`tsc --noEmit`): **0 errors (CLEAN)**.
  - Applet Build (`compile_applet`): **SUCCEEDED**.
  - Laporan Audit Lengkap: Diterbitkan pada `MVS_B2_5D1_AUDIT.md`.

---

## 2. Artefak Kode yang Dimodifikasi & Ditambahkan

| Modul / Berkas | Fungsi Utama & Jaminan Keamanan | Status |
| :--- | :--- | :--- |
| `backend/database/types.ts` | Memperluas union `UserRole` dengan menyertakan `'RegisteredUser'`. | **TERVERIFIKASI** |
| `src/types.ts` | Menyelaraskan union `UserRole` pada tipe bersama frontend. | **TERVERIFIKASI** |
| `backend/auth/rbacMiddleware.ts` | Mendaftarkan `'RegisteredUser'` ke dalam `VALID_ROLES` dan menetapkan default permission `RegisteredUser: []` (empty array). | **TERVERIFIKASI** |
| `backend/auth/roleRequestValidation.ts` | Menetapkan rank `RegisteredUser: 0` dalam `ROLE_HIERARCHY`, memungkinkan permohonan elevasi peran ke Student, Lecturer, Researcher, atau Admin. | **TERVERIFIKASI** |
| `backend/database/store.ts` | Menambahkan pemetaan `RegisteredUser: []` ke `rolePermissionsMap` pada operasi persetujuan role request. | **TERVERIFIKASI** |
| `src/components/dashboard/DashboardView.tsx` | Menambahkan label UI bahasa Indonesia `'Pengguna Terdaftar'` untuk `RegisteredUser`. | **TERVERIFIKASI** |
| `src/components/layout/Header.tsx` | Menambahkan label UI bahasa Indonesia `'Pengguna Terdaftar'` untuk `RegisteredUser`. | **TERVERIFIKASI** |
| `backend/__tests__/registeredUserRbacMVS_B2_5D1.test.ts` | 26 tes adversarial menguji zero-privilege, penolakan seluruh permission operasional & administratif, penolakan review permohonan peran, proteksi objek, dan imunitas tampering. | **TERVERIFIKASI** |

---

## 3. Matriks Hasil Pengujian (Test Results Matrix)

```
Test Files  15 passed (15)
     Tests  362 passed (362)
  Duration  12.00s

✓ backend/__tests__/registeredUserRbacMVS_B2_5D1.test.ts (26 tests)
  ✓ 1. Role Validity & Hierarchy Registration (3 tests)
  ✓ 2. Default Permission Set & Zero-Privilege Guarantee (5 tests)
  ✓ 3. Inactive Account Containment (2 tests)
  ✓ 4. Role Elevation Eligibility & Approval Authority (4 tests)
  ✓ 5. Object-Level Authorization & Project Isolation (4 tests)
  ✓ 6. HTTP API Boundary & Parameter Tampering Defense (5 tests)
  ✓ 7. Regression Invariance across Existing Roles (3 tests)
```

---

## 4. Batasan Keamanan yang Tetap Terjaga

- **Google Login Publik**: **TETAP TIDAK AKTIF (NOT ACTIVE)**.
- **Rute Publik**: Tidak ada rute API publik baru yang dibuka (`api.ts` tidak dimodifikasi rutenya).
- **Sesi Pengguna**: Tidak ada sesi atau cookie autentikasi yang dibuat.
- **Basis Data**: Tidak ada perubahan atau mutasi pada data pengguna atau entitas di `nutribodysim_db.json`.
- **Provisioning**: Belum diimplementasikan (akan dibangun pada MVS-B2.5D.2).
- **Main Administrator**: Tetap terisolasi penuh pada script bootstrap CLI server.

---

## 5. Kondisi Berhenti (Stop Condition)

Milestone **MVS-B2.5D.1** telah selesai.
Sistem berhenti pada kondisi bersih (*clean build & zero lint errors*) dan menunggu evaluasi pengguna sebelum melanjutkan ke implementasi transaksional provisioning pada milestone **MVS-B2.5D.2**.
