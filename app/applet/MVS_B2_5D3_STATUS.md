# NutriBodySim MVS-B2.5D.3 — Status Ringkasan & Laporan Audit Kesiapan
# Explicit Account Linking: Security Specification & Readiness Audit

---

## 1. Ringkasan Milestone

* **Milestone**: MVS-B2.5D.3 — Explicit Account Linking: Security Specification & Readiness Audit
* **Mode Operasi**: **SPECIFICATION + SECURITY AUDIT ONLY (NO RUNTIME CODE CHANGES)**
* **Status Evaluasi**: **PASS WITH BLOCKERS (IMPLEMENTATION BLOCKED)**
* **Status Google Login Publik**: **TETAP TIDAK AKTIF (STRICTLY INACTIVE)**
* **Tanggal Penyelesaian**: 20 Oktober 2026
* **Governing Rule Verification**:
  - Runtime Code Files Modified: **0 files** (Dilarang mengubah kode runtime pada fase audit/spesifikasi).
  - Public Routes Added: **0 routes** (`api.ts` tidak dimodifikasi).
  - User Sessions Created: **0 sessions** (tidak ada sesi, token, atau cookie yang diterbitkan).
  - Database Side-Effects: **0 records modified in baseline fixtures**.
  - Test Suite Baseline: **16 test suites, 376 tests PASS (100%)**.
  - TypeScript Compiler (`tsc --noEmit`): **0 errors (CLEAN)**.
  - Applet Build (`compile_applet`): **SUCCEEDED**.
  - Dokumen Spesifikasi Utama: Diterbitkan pada `app/applet/MVS_B2_5D3_SPECIFICATION.md`.

---

## 2. Berkas yang Diperiksa & Dihasilkan

### A. Berkas yang Diaudit Berdasarkan Kode Aktual (*Read-Only*):
1. `backend/auth/oidc/types.ts` — Kontrak OIDC transaksi, verified identity, dan hasil provisioning.
2. `backend/auth/oidc/index.ts` — Barrel export OIDC.
3. `backend/auth/oidc/provisioner.ts` — Layanan provisioning internal, keyed lock, dan kebijakan anti-auto-merge.
4. `backend/auth/oidc/tokenExchange.ts` — Handler penukaran authorization code via POST Google.
5. `backend/auth/oidc/verifier.ts` — Engine verifikasi Google ID Token RS256 JWKS.
6. `backend/auth/oidc/transactionStore.ts` — In-memory pre-auth OIDC transaction store.
7. `backend/database/types.ts` — Skema entitas `User`, `ExternalIdentity`, `RoleRequest`, `AuditLog`, `UserRole`.
8. `backend/database/store.ts` — Implementasi `linkExternalIdentity`, `getUserById`, `getUserByEmail`, `saveToDisk`.
9. `backend/auth/sessionStore.ts` — `MemorySessionStore` berbasis token hash SHA-256.
10. `backend/auth/authMiddleware.ts` — Resolusi sesi, pemeriksaan status akun `SUSPENDED`/`DISABLED`, token versioning.
11. `backend/auth/authConfig.ts` & `server.ts` — Konfigurasi environment auth, ketiadaan cookie-parser, ketiadaan endpoint auth produksi.
12. `backend/routes/api.ts` — Route `/auth/login` (501 NOT IMPLEMENTED) dan `/auth/demo-login`.
13. Seluruh 16 berkas pengujian backend eksis (RBAC, OIDC, registered user, provisioning, bootstrap Main Admin).

### B. Berkas Dokumentasi yang Dihasilkan:
1. `app/applet/MVS_B2_5D3_SPECIFICATION.md` — Spesifikasi teknis komprehensif penautan akun eksplisit, state machine transaksional, matriks resolusi konflik 10 skenario, threat model, dan identifikasi blocker dependensi.
2. `app/applet/MVS_B2_5D3_STATUS.md` — Dokumen ringkasan eksekutif dan status kesiapan sistem.

---

## 3. Temuan Kritis & Dependensi Pemblokir (Blocking Dependencies)

Berdasarkan audit kode sumber aktual, implementasi runtime penautan akun **DIBLOKIR** oleh 3 dependensi prasyarat yang belum tersedia:

1. **BLOCKER 1: Ketiadaan Sistem Autentikasi Kredensial Lokal Produksi**:
   - Endpoint `POST /auth/login` saat ini secara eksplisit mengembalikan `501 PRODUCTION_AUTH_BLOCKED`.
   - Autentikasi yang ada saat ini hanya demo-login berbasis fixture statis di lingkungan non-produksi.
   - Penautan akun lokal mensyaratkan pengguna memiliki akun lokal dan sesi produksi yang sah. Mengaktifkan penautan akun tanpa sistem autentikasi lokal produksi adalah cacat arsitektur.
2. **BLOCKER 2: Ketiadaan Protokol Re-Autentikasi (Step-Up Authentication)**:
   - Tidak ada endpoint atau mekanisme untuk memverifikasi ulang password/kredensial pengguna sebelum penautan akun dilakukan.
   - Tanpa re-autentikasi, penautan akun rentan terhadap pembajakan sesi (*session hijacking*) atau serangan pada workstation yang tertinggal.
3. **BLOCKER 3: Keterbatasan Skema Transaksi OIDC Saat Ini**:
   - `OIDCTransaction` belum mendukung metadata `purpose: 'ACCOUNT_LINKING'`, `targetUserId`, dan `initiatorSessionHash`.
   - Tanpa pengikatan server-side ini, penautan akun rentan terhadap serangan **Linking CSRF**.
4. **KERENTANAN PADA `db.linkExternalIdentity` SAAT INI**:
   - Method `linkExternalIdentity` di `store.ts` belum memeriksa apakah status akun `ACTIVE`, belum membatasi 1 akun Google per user, tidak mencatat audit log, dan tidak memiliki snapshot rollback jika penulisan disk gagal.

---

## 4. Matriks Ringkasan Kebijakan Penautan Akun

| Aspek Kebijakan | Ketetapan Spesifikasi MVS-B2.5D.3 |
| :--- | :--- |
| **Otorisasi Sesi Lokal** | Sesi lokal aktif (`account_status === 'ACTIVE'`) adalah syarat mutlak. Server mengikat `targetUserId` dari `req.user.id`; input klien dilarang menentukan ID user target. |
| **Verifikasi Google** | Identitas Google diverifikasi murni di server via OIDC JWKS (RS256, audience, issuer, nonce, `email_verified: true`). Subjek Google (`sub`) adalah anchor stabil permanen. |
| **Anti-Auto-Merge** | Dilarang keras menautkan akun secara implisit berdasarkan kesamaan email. Email Google yang bertabrakan dengan akun lain menghasilkan penolakan aman (`EMAIL_OWNED_BY_ANOTHER_ACCOUNT`). |
| **Batasan 1-to-1** | 1 Akun Google (`sub`) hanya dapat ditautkan ke tepat 1 akun lokal NutriBodySim, dan 1 akun lokal hanya dapat ditautkan ke 1 akun Google. |
| **Zero Privilege Impact** | Penautan akun tidak pernah mengubah role pengguna (`Student`, `Lecturer`, `Researcher`, `Admin`), tidak memberikan izin administratif, dan tidak mengubah status Main Administrator. |
| **Inactive Containment** | Akun berstatus `SUSPENDED` atau `DISABLED` ditolak mutlak dari seluruh alur penautan. |

---

## 5. Status Verifikasi Teknis Repositori

```
Test Suites: 16 passed, 16 total
Tests:       376 passed, 376 total
Snapshots:   0 total
Duration:    13.10s
TypeScript:  0 errors (tsc --noEmit CLEAN)
Build:       npm run build SUCCEEDED
Runtime Code Modified: 0 lines
```

---

## 6. Keputusan Kesiapan & Rekomendasi Langkah Selanjutnya

* **Keputusan Kesiapan**: **PASS WITH BLOCKERS (IMPLEMENTATION BLOCKED)**.
  - Dokumen spesifikasi dan audit telah lengkap dan terverifikasi.
  - Implementasi runtime belum boleh dijalankan sampai dependensi kredensial lokal dan ekstensi transaksi OIDC diselesaikan.
* **Rekomendasi Satu Milestone Berikutnya**:
  - **MVS-B2.5E.0**: Perancangan spesifikasi atau implementasi fondasi kredensial lokal produksi / step-up re-autentikasi dan penguatan skema transaksi OIDC untuk membuka blokir penautan akun.
* **Stop Condition**: Eksekusi dihentikan sesuai instruksi. Tidak ada perubahan runtime, tidak ada sesi yang dibuat, dan Google Login publik tetap tidak aktif. Menunggu evaluasi pengguna.
