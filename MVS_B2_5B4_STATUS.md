# NutriBodySim MVS-B2.5B.4 — Status Ringkasan & Laporan Checkpoint

---

## 1. Ringkasan Milestone

* **Milestone**: MVS-B2.5B.4 — Session Invalidation & Authentication Consistency
* **Status**: **VERIFIED PASS (SELESAI & TERUJI)**
* **Tanggal Selesai**: 17 Oktober 2026
* **Cakupan Pengujian**: 
  - Suite Baru: `backend/__tests__/sessionConsistencyMVS_B2_5B4.test.ts` (16 skenario uji adversarial, 100% lulus).
  - Regresi Menyeluruh: 47 berkas pengujian sistem (1.435 tes vitest, 100% lulus).
  - Kompilasi Applet: Berhasil.
  - TypeScript Typecheck (`tsc --noEmit`): 0 Error.

---

## 2. Inventaris Berkas yang Dimodifikasi dan Ditambahkan

1. `backend/database/types.ts`:
   - Menambahkan aksi `'USER_STATUS_CHANGE'` dan `'SESSION_REVOCATION'` ke dalam serikat tipe `AuditLog.action`.
2. `backend/auth/sessionStore.ts`:
   - Menjamin nilai default `tokenVersion = 1` saat pembuatan sesi jika tidak disuplai secara eksplisit.
   - Mengembalikan `tokenVersion` secara deterministik pada hasil validasi sesi.
3. `backend/auth/authMiddleware.ts`:
   - Memperketat perbandingan `token_version`: versi yang hilang, malformed (bukan integer / NaN), atau tidak cocok ditolak secara aman (*fail-closed*) dengan HTTP 401 `STALE_TOKEN_VERSION`.
   - Menegakkan pemeriksaan status akun: akun dengan status `SUSPENDED` atau `DISABLED` ditolak seketika dengan HTTP 403 `FORBIDDEN_ACCOUNT_STATUS` pada middleware `authenticate` dan `requireAuth` sebelum izin apa pun dievaluasi.
4. `backend/database/store.ts`:
   - Mengintegrasikan pemanggilan `defaultSessionStore.revokeSessionsForUser` langsung pada `approveRoleRequest` dan `bootstrapMainAdmin`.
   - Mengimplementasikan `updateUserAccountStatus`: mutasi status akun dengan verifikasi hak tata kelola Main Administrator, kenaikan `token_version`, pencabutan sesi aktif, audit trail, dan rollback atomik jika serialisasi disk gagal.
   - Mengimplementasikan `emergencyRevokeUserSessions`: pencabutan sesi darurat untuk pengguna target dengan kenaikan `token_version` dan audit trail `'SESSION_REVOCATION'`.
   - Menginisialisasi `token_version = 1` dan `account_status = 'ACTIVE'` secara default untuk seluruh data benih (*seed users*).
5. `backend/routes/api.ts`:
   - Memperbarui penjaga rute global `apiRouter.use` untuk merespons dengan kode `STALE_TOKEN_VERSION` dan `FORBIDDEN_ACCOUNT_STATUS`.
   - Menambahkan penolakan autentikasi akun non-aktif pada `POST /auth/demo-login` dan `POST /auth/switch-user`.
   - Menambahkan endpoint `POST /auth/logout-all` untuk pembatalan serentak seluruh sesi pengguna lintas perangkat.
   - Menambahkan endpoint administratif:
     - `POST /api/admin/users/:id/status` (dijaga oleh `requireAuth` dan `requireAdmin`).
     - `POST /api/admin/users/:id/revoke-sessions` (dijaga oleh `requireAuth` dan `requireAdmin`).
6. `backend/__tests__/sessionConsistencyMVS_B2_5B4.test.ts` (*Berkas Baru*):
   - Suite pengujian adversarial lengkap yang mencakup 16 kasus uji konsistensi sesi, pertahanan berlapis, isolasi pengguna, dan ketahanan rollback.
7. `MVS_B2_5B4_AUDIT.md` (*Berkas Baru*):
   - Laporan audit arsitektur keamanan detail untuk milestone MVS-B2.5B.4.

---

## 3. Matriks Jaminan Konsistensi & Pertahanan Berlapis (Dual-Layer Defense)

| Kondisi Mutasi | Tindakan Database | Tindakan Session Store | Efek terhadap Sesi Lama | Efek terhadap Sesi Baru |
| :--- | :--- | :--- | :--- | :--- |
| **Persetujuan Role** | Role diperbarui, `token_version` naik | `revokeSessionsForUser()` | Ditolak HTTP 401 (`revoked` atau `STALE_TOKEN_VERSION`) | Menerima token versi baru dengan hak akses terkini |
| **Penonaktifan Akun (SUSPENDED)** | `account_status = 'SUSPENDED'`, `token_version` naik | `revokeSessionsForUser()` | Ditolak HTTP 403 `FORBIDDEN_ACCOUNT_STATUS` | Ditolak login/switch-user (HTTP 403) |
| **Penonaktifan Akun (DISABLED)** | `account_status = 'DISABLED'`, `token_version` naik | `revokeSessionsForUser()` | Ditolak HTTP 403 `FORBIDDEN_ACCOUNT_STATUS` | Ditolak login/switch-user (HTTP 403) |
| **Bootstrap Main Admin** | `is_main_admin = true`, `token_version` naik (target & mantan) | `revokeSessionsForUser()` | Sesi lama mantan & target ditolak HTTP 401 | Sesi baru membawa hak tata kelola tertinggi |
| **Logout Global (`logout-all`)** | `token_version` naik | `revokeSessionsForUser()` | Seluruh sesi aktif di semua perangkat mati (401) | Sesi baru dapat dibuat normal |
| **Pencabutan Darurat Admin** | `token_version` naik | `revokeSessionsForUser()` | Seluruh sesi aktif target mati (401) | Target dipaksa autentikasi ulang |
| **Kegagalan Disk / Rollback** | State DB dibatalkan utuh, versi tidak naik | Tidak ada sesi dicabut | Sesi lama tetap konsisten | Tidak ada token hantu |

---

## 4. Evaluasi Kejujuran Batas Arsitektur

* **Konsistensi Single-Node**: 100% konsisten deterministik melalui pertahanan berlapis (*dual-layer*).
* **Batas Multi-Instance**: `MemorySessionStore` bersifat lokal per proses Node.js. Dalam skenario replika jamak tanpa sticky session, lapisan basis data (`user.token_version`) tetap memblokir token basi secara sentral, namun untuk efisiensi instan disarankan penggunaan Redis / shared session store jika hendak diskalakan horizontal.
* **Fail-Closed**: Jika proses restart atau memori sesi hilang, seluruh token tidak dikenal ditolak aman dengan HTTP 401 UNAUTHORIZED tanpa pernah jatuh ke identitas *fallback*.

---

## 5. Checkpoint Status

Milestone **MVS-B2.5B.4** selesai secara tuntas, terverifikasi, dan siap untuk evaluasi tahap berikutnya.
