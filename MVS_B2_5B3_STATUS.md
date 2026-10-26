# NutriBodySim MVS-B2.5B.3 — Status Ringkasan & Laporan Checkpoint

---

## 1. Audit Kondisi Awal (Baseline State)

Sebelum milestone MVS-B2.5B.3 diimplementasikan:
* **MVS-B2.5A & MVS-B2.5A.1**: Mesin pengajuan permohonan peran (`RoleRequest`) telah berjalan dengan endpoint pengajuan (`POST /api/role-requests`), pembacaan koleksi (`GET /api/role-requests`), dan pembacaan individu (`GET /api/role-requests/:id`), serta audit penetrasi anti-BOLA/IDOR.
* **MVS-B2.5B.1**: Penghapusan universal wildcard pada role `Admin` telah diselesaikan; role `Admin` hanya memiliki daftar izin eksplisit, dan izin istimewa `MANAGE_PRIVILEGED_ROLES` dipisahkan.
* **MVS-B2.5B.2**: Mekanisme isolated CLI bootstrap untuk Main Administrator (`scripts/bootstrap-main-admin.ts`) telah tersedia dengan perlindungan anti-takeover, idempotensi, dan break-glass recovery.
* **Kesenjangan (Gaps)**:
  1. Belum ada endpoint API untuk memproses persetujuan (`/approve`), penolakan (`/reject`), atau pembatalan (`/cancel`) permohonan peran.
  2. Belum ada pemisahan kewenangan bertingkat (*risk-tier*): regular Admin tidak boleh menyetujui calon Admin baru.
  3. Mekanisme `token_version` pada `User` belum dihubungkan dengan middleware autentikasi dan pembuatan sesi untuk menolak token lama secara deterministik pasca elevasi hak akses.

---

## 2. Berkas yang Diubah dan Ditambahkan

1. `backend/database/types.ts`:
   - Memperluas tipe `ApprovalStatus` menjadi `'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'`.
   - Menambahkan aksi `'ROLE_APPROVAL'` dan field `metadata?: Record<string, any>` pada antarmuka `AuditLog`.
2. `backend/auth/sessionStore.ts`:
   - Menambahkan field `tokenVersion?: number` pada `SessionData`, `SessionValidationResult`, dan `ISessionStore.createSession`.
   - Mengembalikan `tokenVersion` pada hasil validasi sesi (`validateSession`).
3. `backend/auth/authMiddleware.ts`:
   - Mengimplementasikan verifikasi komparatif `token_version` pada middleware `authenticate` dan `requireAuth`. Menolak sesi jika `validation.tokenVersion < user.token_version` dengan HTTP 401 `STALE_TOKEN_VERSION`.
4. `backend/auth/roleApprovalEngine.ts` (*Berkas Baru*):
   - Layanan domain terisolasi yang mengoordinasikan aturan otorisasi berbasis tingkat risiko (*risk-tier*), anti-self-approval, validasi alasan penolakan, mutasi penyimpanan atomik, dan pencabutan sesi.
5. `backend/database/store.ts`:
   - Mengekspor kelas `DatabaseStore`.
   - Mengimplementasikan metode penyimpanan terpadu: `approveRoleRequest()`, `rejectRoleRequest()`, dan `cancelRoleRequest()` dengan garansi rollback memori atomik jika serialisasi berkas disk gagal.
6. `backend/routes/api.ts`:
   - Mendaftarkan endpoint:
     - `POST /api/role-requests/:id/approve`
     - `POST /api/role-requests/:id/reject`
     - `POST /api/role-requests/:id/cancel`
   - Memastikan sesi login demo meneruskan nilai `user.token_version || 1`.
7. `backend/__tests__/secureRoleApprovalMVS_B2_5B3.test.ts` (*Berkas Baru*):
   - Suite pengujian adversarial komprehensif mencakup 21 skenario pengujian.
8. `MVS_B2_5B3_AUDIT.md`:
   - Laporan audit arsitektur keamanan detail untuk milestone MVS-B2.5B.3.

---

## 3. Diagram & Deskripsi State Machine

```
                       [Pengajuan Role Request]
                                  |
                                  v
                            +-----------+
                            |  PENDING  |
                            +-----+-----+
                                  |
        +-------------------------+-------------------------+
        |                         |                         |
        v                         v                         v
  [Approve Action]         [Reject Action]          [Cancel Action]
(Admin / Main Admin)     (Admin / Main Admin)         (Oleh Pemilik)
        |                         |                         |
        v                         v                         v
  +-----------+             +-----------+             +-----------+
  | APPROVED  |             | REJECTED  |             | CANCELLED |
  +-----------+             +-----------+             +-----------+
(FINAL/IMMUTABLE)         (FINAL/IMMUTABLE)         (FINAL/IMMUTABLE)
```

* **Aturan Transisi**:
  1. `PENDING -> APPROVED`: Memutasi role target, menginkrementasi `token_version`, memperbarui izin eksplisit, mencabut sesi lama pengguna target, dan mencatat audit.
  2. `PENDING -> REJECTED`: Menolak elevasi peran dengan mewajibkan alasan tertulis non-kosong (`review_reason` minimal 5 karakter), mencatat audit, role pengguna target tidak berubah.
  3. `PENDING -> CANCELLED`: Dibatalkan oleh pemohon asli sebelum diproses oleh reviewer.
  4. **Immutabilitas**: Status `APPROVED`, `REJECTED`, dan `CANCELLED` bersifat final. Permintaan replay atau modifikasi status terminal menghasilkan HTTP 409 Conflict (`ALREADY_FINALIZED`).

---

## 4. Matriks Kewenangan Reviewer Berdasarkan Tingkat Risiko

| Peninjau | Status Akun | Target Role | Otorisasi | Hasil & Kode Respons |
| :--- | :--- | :--- | :--- | :--- |
| **Pemohon Sendiri** | ACTIVE | Apa pun | DILARANG (Anti-Self-Review) | `403 SELF_APPROVAL_PROHIBITED` |
| **Non-Admin** | ACTIVE | Apa pun | DILARANG (Bukan Admin) | `403 FORBIDDEN` |
| **Admin Biasa** | ACTIVE | `Lecturer` / `Researcher` | DIIZINKAN (Izin `ADMIN`) | `200 OK` |
| **Admin Biasa** | ACTIVE | `Admin` | DILARANG (Kurang Hak Istimewa) | `403 INSUFFICIENT_ADMIN_PRIVILEGE` |
| **Main Administrator** | ACTIVE | `Admin` | DIIZINKAN (`MANAGE_PRIVILEGED_ROLES`) | `200 OK` |
| **Main Administrator** | ACTIVE | `is_main_admin` | DILARANG (Di Luar Cakupan Engine) | Tidak Ada Endpoint |
| **Peninjau Non-Aktif** | SUSPENDED / DISABLED | Apa pun | DILARANG (Reviewer Non-Aktif) | `403 REVIEWER_NOT_ACTIVE` |
| **Target Non-Aktif** | SUSPENDED / DISABLED | Apa pun | DILARANG (Target Non-Aktif) | `403 TARGET_NOT_ACTIVE` |

---

## 5. Daftar Endpoint Sensitif

1. `POST /api/role-requests/:id/approve`
   - Memerlukan autentikasi, akun peninjau aktif, dan izin sesuai target role.
   - Mengabaikan seluruh parameter body selain `review_reason` (sanitized).
2. `POST /api/role-requests/:id/reject`
   - Memerlukan autentikasi, akun peninjau aktif, dan alasan penolakan wajib.
3. `POST /api/role-requests/:id/cancel`
   - Memerlukan autentikasi; penegakan BOLA/IDOR: hanya pemohon asli (`user_id === req.user.id`) yang dapat membatalkan.
4. `GET /api/role-requests/:id`
   - Dibatasi hanya untuk pemilik permohonan atau Administrator. Pengguna lain menerima HTTP 403 `OBJECT_ACCESS_DENIED`.

---

## 6. Strategi Transaksi dan Konsistensi

* **Penyimpanan Aktual**: Basis data berkas JSON (`data/nutribodysim_db.json`) dengan mekanisme penulisan berkas temporer (`.tmp.${Date.now()}.${random}`) dan penggantian nama atomik (`fs.renameSync`).
* **Pola Snapshot & Rollback**:
  - Sebelum mutasi in-memory diterapkan, snapshot dari `targetUser` (role, permissions, token_version, updated_at) dan snapshot `roleRequest` (status, reviewed_by, reviewed_at, review_reason) disimpan.
  - Jika `saveToDisk` melemparkan pengecualian (misalnya disk penuh `ENOSPC`), seluruh state in-memory dikembalikan ke snapshot awal dan entri audit log dibatalkan.
  - Pengujian `9.1 Rolls back in-memory mutations if disk write fails during approval` membuktikan konsistensi atomik ini.

---

## 7. Bukti Efektivitas Invalidasi Sesi

1. **Pencabutan Langsung di Store**:
   - Fungsi `sessionStore.revokeSessionsForUser(targetUser.id)` membalikkan bendera `revoked: true` pada seluruh sesi aktif target user.
2. **Penolakan Berbasis Versi Token (Epoch Invalidation)**:
   - Nilai `targetUser.token_version` dinaikkan dari `N` ke `N + 1`.
   - Setiap token sesi menyimpan `tokenVersion: N` saat diterbitkan.
   - Begitu middleware `authMiddleware.ts` menerima token lama, ia mendeteksi bahwa versi token sesi (`N`) lebih kecil dari versi di database (`N + 1`), lalu mengembalikan HTTP 401 `STALE_TOKEN_VERSION`.
3. Pengujian `8.1 Invalidate target user active sessions after role elevation (old token rejected)` membuktikan penolakan seketika atas token lama.

---

## 8. Hasil Tes Adversarial dan Regresi Penuh

* **Suite Uji Baru (`backend/__tests__/secureRoleApprovalMVS_B2_5B3.test.ts`)**:
  - **21 Skenario LULUS (100% PASS)**
* **Seluruh Suite Uji Sistem**:
  - **46 Berkas Pengujian LULUS (100% PASS)**
  - **1.419 Pengujian Vitest LULUS (100% PASS)**
* **Typecheck (`npm run lint` / `tsc --noEmit`)**:
  - Bersih, 0 error.
* **Kompilasi Aplikasi (`npm run build` / `compile_applet`)**:
  - Build berhasil.

---

## 9. Temuan yang Belum Selesai (Pending Findings)

1. **Google OIDC Identity Provider**:
   - Pengikatan identitas kriptografis (`provider_subject_id` Google) belum diintegrasikan, saat ini mengandalkan internal user ID yang tervalidasi.
2. **Ketiadaan Token Asimetris (Public/Private Key JWT)**:
   - Token sesi saat ini bertipe opaque SHA-256 random bytes yang disimpan di memori container.

---

## 10. Keterbatasan Database dan Audit Log

1. **Keterbatasan Database Berkas JSON**:
   - Atomisitas dijamin oleh POSIX `renameSync` pada node tunggal. Lingkungan multi-container atau shared cluster memerlukan basis data SQL relasional eksternal (misal PostgreSQL/Cloud SQL) dengan isolasi transaksi ACID penuh.
2. **Audit Log Non-Immutable**:
   - Audit log disimpan di dalam berkas JSON yang sama. Tanpa WORM storage atau blockchain ledger, administrator infrastruktur dengan akses file system fisik secara teoritis masih dapat menyunting file. Log dilindungi dari manipulasi level aplikasi/HTTP.

---

## 11. Status Kesiapan Produksi (Production Readiness)

* **STATUS**: **NOT READY FOR PRODUCTION (NON-PRODUCTION)**.
* **Alasan Governance Gate**:
  - Implementasi Google Workspace OIDC asli belum aktif.
  - Database terdistribusi dan session store cluster belum diimplementasikan.
  - Sesuai instruksi protokol MVS-B2.5B, aplikasi tetap berada pada gate pengujian verifikasi terkontrol.

---

## 12. Rekomendasi untuk Milestone Berikutnya

1. **MVS-B2.5C — Google Workspace OIDC Authentication**:
   - Mengintegrasikan autentikasi OAuth Google secara aman, mengikat `ExternalIdentity` internal dengan Google `sub`.
2. **MVS-B2.5D — Persistent Database & Distributed Session Architecture**:
   - Evaluasi migrasi penyimpanan dari single-file JSON ke relational storage terkelola jika diperlukan skalabilitas multi-container.
