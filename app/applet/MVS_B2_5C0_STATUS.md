# NutriBodySim MVS-B2.5C.0 — Status Ringkasan & Laporan Checkpoint Arsitektur

---

## 1. Ringkasan Milestone

* **Milestone**: MVS-B2.5C.0 — Google OIDC Identity Architecture Specification
* **Mode Operasi**: **SPECIFICATION ONLY — NO RUNTIME CODE CHANGES**
* **Status**: **VERIFIED ARCHITECTURE COMPLETED (LENGKAP & TERVALIDASI)**
* **Tanggal Penyelesaian**: 17 Oktober 2026
* **Governing Rule Verification**:
  - Runtime code modifications: **0 files changed**.
  - Test suites: **100% lulus (47 test files, 1.435 tes vitest)**.
  - Dokumentasi spesifikasi arsitektur: Diterbitkan pada `MVS_B2_5C0_SPECIFICATION.md`.

---

## 2. Hasil Audit Kode Sumber Aktual (Read-Only Audit)

| Komponen Kode Sumber | Lokasi Berkas | Temuan & Status Keamanan Saat Ini | Kesiapan untuk OIDC (MVS-B2.5C) |
| :--- | :--- | :--- | :--- |
| **Model Identitas Eksternal** | `backend/database/types.ts` | Entitas `ExternalIdentity` telah terdefinisi dengan `provider`, `provider_subject_id`, `user_id`, `email`, `email_verified`, `linked_at`. | Siap dipetakan dengan klaim Google `sub`. |
| **Metode Basis Data Identitas** | `backend/database/store.ts` | `findExternalIdentity` dan `linkExternalIdentity` telah memiliki validasi keunikan subjek dan larangan penggabungan otomatis (*no auto-merge*). | Logika integritas sudah ada, tinggal dipanggil oleh handler OIDC. |
| **Middleware Autentikasi** | `backend/auth/authMiddleware.ts` | Mendukung token Bearer dan header fallback. Menegakkan perbandingan versi token `token_version` dan penolakan instan akun `SUSPENDED`/`DISABLED`. | Perlu penambahan ekstraksi cookie saat runtime OIDC diaktifkan. |
| **Penyimpanan Sesi** | `backend/auth/sessionStore.ts` | Menggunakan `MemorySessionStore` dengan SHA-256 token hashing dan 256-bit entropy. Mendukung `revokeSessionsForUser` dan deterministik `tokenVersion`. | Sesi hilang saat restart; fail-closed terjamin. Perlu persistensi jika multi-pod. |
| **RBAC & Privilege Isolation** | `backend/auth/rbacMiddleware.ts` | 4 role kanonikal (`Student`, `Lecturer`, `Researcher`, `Admin`) dan 11 permission kanonikal. `MANAGE_PRIVILEGED_ROLES` diisolasi mutlak untuk Main Admin. | Mencegah auto-elevasi peran dari data Google profil/domain email. |
| **Main Admin Bootstrap** | `backend/auth/bootstrapMainAdmin.ts` | Terisolasi di CLI, memerlukan atribusi operator non-repudiable, audit trail `MAIN_ADMIN_BOOTSTRAP`. | Terlindungi mutlak dari login Google maupun endpoint publik. |
| **Role Approval Engine** | `backend/auth/roleApprovalEngine.ts` | Verifikasi tingkatan risiko, anti-self-approval, penolakan target non-aktif, kenaikan `token_version` dan pencabutan sesi otomatis. | Menjadi satu-satunya jalur bagi user Google baru untuk naik peran. |
| **Router API & Auth Endpoints** | `backend/routes/api.ts` | Menjalankan middleware auth terpadu, demo login, switch-user, logout, dan logout-all. Belum ada rute OIDC aktif. | Cetak biru rute OIDC telah dirancang di `MVS_B2_5C0_SPECIFICATION.md`. |
| **Konfigurasi Lingkungan** | `.env.example` | Variabel `GOOGLE_CLIENT_ID` dan `GOOGLE_CLIENT_SECRET` belum didefinisikan. | Wajib ditambahkan pada fase implementasi MVS-B2.5C.3. |

---

## 3. Matriks Keputusan Desain Arsitektur OIDC

1. **Protokol Inti**:
   - Authorization Code Flow dengan **PKCE (RFC 7636, S256)** untuk mitigasi code interception.
   - Nonce acak 256-bit untuk mitigasi ID Token replay.
   - State acak 256-bit dengan double-submit signed cookie untuk mitigasi CSRF.
2. **Validasi ID Token Server-Side**:
   - Zero-trust: ID Token wajib divalidasi di server menggunakan Google JWKS (`https://www.googleapis.com/oauth2/v3/certs`) via algoritma `RS256`.
   - Pemeriksaan ketat: `iss`, `aud`, `exp`, `iat`, `nonce`, `sub`, dan `email_verified === true`.
   - Rotasi kunci otomatis dengan caching ber-TTL (sesuai header `Cache-Control`) dan proteksi DoS pada *bypass refresh*.
3. **Penetapan Identitas & Hak Akses**:
   - Subjek Google (`sub`) adalah *primary immutable identity anchor*.
   - Tidak ada penggabungan akun otomatis (*anti-pre-hijacking / anti-account takeover*).
   - Pengguna Google baru selalu mendapatkan peran terendah: `Student`.
   - Main Administrator tidak dapat dipromosikan melalui Google OIDC dalam kondisi apa pun.
4. **Session Cookie & Keamanan Web**:
   - `HttpOnly: true` (anti-XSS), `Secure: true` (HTTPS only).
   - `SameSite: 'none'` untuk konteks iframe Google AI Studio Preview; `'lax'` untuk standalone production.
   - Rotasi ID sesi wajib diterapkan saat login berhasil untuk mencegah *session fixation*.
   - Idle timeout 60 menit dan absolute timeout 24 jam.

---

## 4. Evaluasi Kejujuran Batas Arsitektur (Architecture Honesty Review)

* **Deployment Kontainer Mandiri (Single Instance)**:
  - Arsitektur OIDC dan `MemorySessionStore` saat ini aman dan konsisten.
  - Jika kontainer di-restart, seluruh sesi di memori terhapus dan ditolak dengan HTTP 401 (*fail-closed*).
* **Deployment Skala Horisontal (Multi-Instance)**:
  - `MemorySessionStore` **BELUM SIAP** untuk deployment multi-instance tanpa session affinity (*sticky session*).
  - Status produksi multi-instance ditandai sebagai **BLOCKED** hingga modul `PersistentSessionStore` (Redis atau basis data bersama) diprovisikan.

---

## 5. Status Verifikasi Pengujian Sistem

Seluruh 47 berkas pengujian sistem dieksekusi untuk memastikan integritas dan ketiadaan regresi:

```
Test Files  47 passed (47)
     Tests  1435 passed (1435)
  Duration  17.2s
```

* **TypeScript Compilation**: `npx tsc --noEmit` menghasilkan 0 error.
* **Applet Integrity**: Terverifikasi utuh.

---

## 6. Checkpoint & Rekomendasi Tahap Lanjutan

Milestone **MVS-B2.5C.0** dinyatakan **SELESAI (PASS)**. Seluruh spesifikasi arsitektur telah didokumentasikan secara presisi dan siap diimplementasikan pada:
* **MVS-B2.5C.1**: Implementasi Core Google OIDC Engine & JWKS Token Verifier.
* **MVS-B2.5C.2**: Implementasi Endpoint OIDC (`init`, `exchange`, `link`) & Pemetaan Identitas Aman.
* **MVS-B2.5C.3**: Integrasi Cookie Sesi Dual-Environment & Komponen Frontend Google Sign-In.
* **MVS-B2.5C.4**: Pengujian Penetrasi Menyeluruh & Verifikasi E2E.
