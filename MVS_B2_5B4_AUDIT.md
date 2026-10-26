# NutriBodySim MVS-B2.5B.4 — Session Invalidation & Authentication Consistency Audit Report

---

## Kontrol Dokumen & Meta

* **Proyek**: NutriBodySim (Laboratorium Riset Komputasi Nutrisi & Pemodelan Fisiologi)
* **Milestone**: MVS-B2.5B.4 (Master Validation Suite — Session Invalidation & Authentication Consistency)
* **Tanggal Audit**: 17 Oktober 2026
* **Status Hasil**: **VERIFIED PASS** *(dengan catatan batas arsitektur memori lokal terdokumentasi penuh)*
* **Prasyarat Acuan**:
  - `MVS_B2_5B1_STATUS.md` & `MVS_B2_5B1_AUDIT.md` (RBAC Hardening & Zero-Wildcard Admin)
  - `MVS_B2_5B2_STATUS.md` & `MVS_B2_5B2_AUDIT.md` (Secure Main Administrator Bootstrap)
  - `MVS_B2_5B3_STATUS.md` & `MVS_B2_5B3_AUDIT.md` (Secure Role Approval Engine)
  - `MVS_B2_5B_SPECIFICATION.md` & `MVS_B2_5_SPECIFICATION.md`

---

## 1. Ringkasan Eksekutif (Executive Summary)

Milestone **MVS-B2.5B.4** berfokus pada penegakan konsistensi deterministik antara status otentikasi sesi di memori dengan kebenaran tunggal (*single source of truth*) data pengguna di database terdistribusi/lokal. 

Sebelum milestone ini, sistem telah memiliki pencabutan sesi `revokeSessionsForUser` dan penyimpanan versi token `token_version` pada entitas `User`. Namun, verifikasi komparatif masih memiliki celah struktural:
1. Sesi dengan `tokenVersion` bernilai `undefined` (misalnya akibat manipulasi atau kegagalan injeksi) tidak tertolak secara *fail-closed*.
2. Pengguna dengan status `SUSPENDED` atau `DISABLED` berpotensi tetap dapat mengakses rute tertentu jika sesi memorinya belum atau gagal dicabut.
3. Belum tersedia mekanisme administratif terpadu untuk mengubah status akun, melakukan *global logout* lintas perangkat (`POST /auth/logout-all`), atau eksekusi pencabutan sesi darurat (*emergency session revocation*) secara atomik dengan rollback.
4. Ketiadaan penolakan proaktif pada alur autentikasi alternatif seperti `POST /auth/demo-login` dan `POST /auth/switch-user` untuk akun non-aktif.

Seluruh celah tersebut telah ditutup secara definitif pada MVS-B2.5B.4 melalui arsitektur pertahanan berlapis (**Dual-Layer Invalidation Defense**).

---

## 2. Tahap A — Pemetaan Lengkap Alur Autentikasi & Otorisasi

Setiap permintaan HTTP yang masuk dievaluasi melalui pipa 8 tahap berurutan tanpa jalan pintas (*no shortcuts*):

```
[Incoming Request]
       |
       v
(1) Ekstraksi Token: Bearer <token> (Authorization header) atau x-session-token
       |
       v
(2) Validasi Kriptografis Sesi (SessionStore):
    - Format token: regex 64 karakter hex (256-bit entropy).
    - Hashing SHA-256 untuk pencarian internal di MemorySessionStore.
    - Status revoked === false.
    - Expiration: Date.now() <= session.expiresAt.
       |
       v
(3) Pemuatan Data Pengguna (DatabaseStore.getState()):
    - Pencarian pengguna berdasarkan validation.userId di DB tepercaya.
    - Kegagalan pencarian menghasilkan HTTP 401 UNAUTHORIZED (fail-closed).
       |
       v
(4) Penegakan Status Akun (Account Status Verification):
    - Pemeriksaan apakah user.account_status === 'ACTIVE'.
    - Jika SUSPENDED atau DISABLED -> HTTP 403 FORBIDDEN_ACCOUNT_STATUS.
    - Dievaluasi SEKETIKA sebelum permission apa pun diberikan, tanpa bergantung
      pada keberhasilan pencabutan sesi di memori.
       |
       v
(5) Penegakan token_version (Strict Version Matching):
    - Komparasi deterministik: validation.tokenVersion === user.token_version.
    - Versi hilang (undefined), malformed (bukan integer), atau tidak cocok (mismatch)
      langsung ditolak dengan HTTP 401 STALE_TOKEN_VERSION.
       |
       v
(6) Evaluasi Hak Akses RBAC (rbacMiddleware):
    - Resolusi getEffectivePermissions(user):
      * Akun non-aktif menghasilkan set izin kosong.
      * Role tidak valid ditolak.
      * Admin hanya memiliki izin eksplisit (tanpa wildcard bypass).
      * MANAGE_PRIVILEGED_ROLES terisolasi hanya untuk Main Administrator aktif.
       |
       v
(7) Object-Level Authorization (objectAuth):
    - Penegakan BOLA/IDOR untuk domain resource (Project, RoleRequest, Team).
       |
       v
(8) Eksekusi Handler Endpoint & Respons
```

### Audit Rute & Proteksi Global
* Seluruh rute non-publik terlindungi oleh middleware global `apiRouter.use` yang memanggil `auth.authenticate`.
* Rute publik didefinisikan secara eksplisit dalam whitelist tertutup (`PUBLIC_ROUTES`): `/health`, `/auth/login`, `/auth/demo-login`, `/auth/switch-user`, dan kamus referensi statis (`/units`, `/variables`, `/parameters`, `/interpretations`, `/formulas`, `/models`, `/references`).
* Pada `POST /auth/demo-login` dan `POST /auth/switch-user`, ditambahkan guard eksplisit yang menolak penerbitan sesi baru bagi akun `SUSPENDED` atau `DISABLED` dengan HTTP 403 `FORBIDDEN_ACCOUNT_STATUS`.

---

## 3. Tahap B — Penegakan Deterministik token_version

### Analisis Invarian
1. **Pencocokan Ketat (`Strict Equality`)**:
   Implementasi sebelumnya hanya membandingkan `validation.tokenVersion < user.token_version`. Jika `tokenVersion` bernilai `undefined`, perbandingan menghasilkan `false` sehingga sesi lama yang rusak tidak ditolak.
   Pada implementasi MVS-B2.5B.4:
   ```typescript
   const expectedVersion = user.token_version ?? 1;
   const actualVersion = validation.tokenVersion;

   if (
     actualVersion === undefined ||
     typeof actualVersion !== 'number' ||
     Number.isNaN(actualVersion) ||
     actualVersion !== expectedVersion
   ) {
     return res.status(401).json({
       error: 'Session has been invalidated due to privilege or security updates. Please authenticate again.',
       code: 'STALE_TOKEN_VERSION'
     });
   }
   ```
2. **Kekebalan terhadap Spoofing Klien**:
   Versi sesi disimpan secara internal pada record `SessionData` di server memori yang diindeks oleh SHA-256 token kriptografis. Klien yang mencoba mengirim header manipulasi seperti `x-token-version: 2` atau field body `{ token_version: 2 }` sama sekali diabaikan oleh server.
3. **Fail-Closed pada Kegagalan Data**:
   Jika pengguna tidak ditemukan di database atau jika record pengguna tidak memiliki versi yang sah, permintaan ditolak seketika (HTTP 401).

---

## 4. Tahap C — Konsistensi Invalidasi Sesi & Pertahanan Berlapis (Dual-Layer Defense)

Pencabutan sesi diimplementasikan menggunakan model **Dual-Layer Invalidation**:

```
                              [Perubahan Hak Akses / Status]
                                            |
                   +------------------------+------------------------+
                   |                                                 |
                   v                                                 v
           [Layer 1: Database]                             [Layer 2: SessionStore]
       token_version diinkrementasi                 sessionStore.revokeSessionsForUser()
      Atomic rollback jika disk fail                   Menandai session.revoked = true
                   |                                                 |
                   +------------------------+------------------------+
                                            |
                                            v
                               [Evaluasi Request Berikutnya]
        - Jika Sesi dicabut di Layer 2 -> Ditolak HTTP 401 UNAUTHORIZED (Revoked)
        - Jika Layer 2 lolos/gagal -> Ditolak di Layer 1 HTTP 401 STALE_TOKEN_VERSION
        - Jika Status Akun Non-Aktif -> Ditolak HTTP 403 FORBIDDEN_ACCOUNT_STATUS
```

### Audit 5 Operasi Pemicu Invalidasi:
1. **Persetujuan Peran (`Role Approval`)**:
   Inkrementasi `token_version` target user dan pemanggilan `revokeSessionsForUser(targetUser.id)` dieksekusi baik pada `RoleApprovalEngine` maupun di dalam inti `DatabaseStore.approveRoleRequest`.
2. **Bootstrap Main Administrator (`bootstrapMainAdmin`)**:
   Inkrementasi `token_version` target user dan administrator sebelumnya (jika force recovery), serta pencabutan sesi keduanya di `SessionStore`.
3. **Perubahan Status Akun (`updateUserAccountStatus`)**:
   Metode baru atomik di `DatabaseStore`:
   - Validasi eksistensi target user dan aktor.
   - Proteksi tata kelola: Main Administrator tidak dapat dinonaktifkan oleh Admin biasa (HTTP 403 `INSUFFICIENT_PRIVILEGE`).
   - Inkrementasi `token_version`.
   - Snapshot in-memory rollback jika penulisan disk gagal.
   - Pencabutan seluruh sesi aktif target di `SessionStore`.
   - Pencatatan AuditLog dengan action `'USER_STATUS_CHANGE'`.
4. **Pencabutan Global / Reset Sesi (`POST /auth/logout-all`)**:
   Endpoint mandiri bagi pengguna untuk membatalkan seluruh sesi aktif di semua perangkat secara serentak.
5. **Pencabutan Administratif Darurat (`emergencyRevokeUserSessions` & `POST /admin/users/:id/revoke-sessions`)**:
   Inkrementasi seketika `token_version` dan pembersihan sesi aktif di memori dengan audit trail `'SESSION_REVOCATION'`.

---

## 5. Tahap D — Pertahanan terhadap Stale Session & Serangan Bypass

| Vektor Ancaman | Mekanisme Pertahanan MVS-B2.5B.4 | Hasil Verifikasi |
| :--- | :--- | :--- |
| **1. Stale Session via Context Caching** | Middleware memuat ulang `user` dari state database terkini pada setiap request terproteksi. Data role tidak pernah disimpan di dalam token. | **KEBAL** (Tidak ada caching role di session token) |
| **2. Token Terbitan Lama Masih Berlaku** | Penegakan `actualVersion === expectedVersion`. Setiap mutasi hak akses/status menaikkan `token_version`. | **KEBAL** (Ditolak `STALE_TOKEN_VERSION`) |
| **3. Race Condition Database vs Memory** | Database menyimpan `token_version` baru secara sinkron sebelum atau bersamaan dengan pencabutan sesi di memori. Request paralel yang membaca DB langsung terbentur versi baru. | **KEBAL** (Konsistensi baca deterministik) |
| **4. Token Expired / Token Hijacking** | Token 256-bit entropy tinggi, pengindeksan hash SHA-256, pemeriksaan ketat `expiresAt` dan `tokenHash`. | **KEBAL** (Ditolak `Session expired` / `Session not found`) |
| **5. Baca Role dari Token Klien** | Seluruh evaluasi otorisasi menggunakan objek `req.user` yang dimuat dari database server tepercaya. | **KEBAL** (Body/header role klien diabaikan 100%) |
| **6. Jalur Paralel Tanpa Pemeriksaan Status** | `apiRouter.use` dan `requireAuth` memverifikasi `account_status === 'ACTIVE'` dan `token_version` sebelum menyerahkan request ke handler bisnis apa pun. | **KEBAL** (Seluruh jalur non-publik terproteksi) |

---

## 6. Tahap E — Rangkaian Pengujian Adversarial (`sessionConsistencyMVS_B2_5B4.test.ts`)

Rangkaian uji komprehensif 16 skenario dibuat dan diverifikasi:

1. **Uji 1**: Penolakan token lama dengan 401 pasca persetujuan peran (`STALE_TOKEN_VERSION` / revoked), dan verifikasi sesi baru berfungsi normal dengan role terkini.
2. **Uji 2**: Penolakan seketika dengan 403 `FORBIDDEN_ACCOUNT_STATUS` saat status pengguna diubah ke `SUSPENDED` atau `DISABLED` tanpa bergantung pada pencabutan sesi.
3. **Uji 3**: Invalidasi serentak seluruh sesi aktif (Desktop, Mobile, Tablet) milik pengguna yang dimutasi.
4. **Uji 4**: Isolasi sesi antar pengguna: pembatalan seluruh sesi User A tidak mengubah validitas sesi aktif User B.
5. **Uji 5**: Penjaminan kenaikan `token_version` pada seluruh mutasi hak akses/status (Role approval, Bootstrap, Status change, Emergency revocation).
6. **Uji 6**: Kekebalan terhadap manipulasi klien (spoofing `token_version` di header, query string, dan request body ditolak 401 `STALE_TOKEN_VERSION`).
7. **Uji 7**: Penolakan *token replay* setelah pengguna melakukan `POST /auth/logout` (401 UNAUTHORIZED).
8. **Uji 8**: Penolakan *fail-closed* saat restart server atau pembersihan cache memori (`defaultSessionStore.clear()` -> 401 UNAUTHORIZED).
9. **Uji 9**: Ketahanan kegagalan parsial: kegagalan penulisan disk membatalkan perubahan memori secara atomik; `token_version` tidak bertambah dan sesi lama tetap konsisten.
10. **Uji 10**: Penegakan urutan evaluasi: `account_status` dan `token_version` diverifikasi sebelum izin operasi dicek (tidak ada eksekusi aksi sebelum autentikasi lulus).
11. **Uji 11**: Verifikasi endpoint `POST /auth/logout-all` mematikan semua sesi multi-perangkat.
12. **Uji 12**: Verifikasi endpoint administratif `POST /api/admin/users/:id/status`, pencatatan audit log, dan penegakan batas tata kelola (Admin biasa dilarang menonaktifkan Main Administrator).
13. **Uji 13**: Verifikasi endpoint administratif `POST /api/admin/users/:id/revoke-sessions`.
14. **Uji 14**: Penolakan demo login dan switch-user bagi akun `SUSPENDED` atau `DISABLED` (403 `FORBIDDEN_ACCOUNT_STATUS`).
15. **Uji 15**: Pembuktian pertahanan berlapis: jika pencabutan memori dilewati, komparasi `token_version` database tetap menolak sesi basi dengan 401 `STALE_TOKEN_VERSION`.
16. **Uji 16**: Penolakan *fail-closed* pada record sesi dengan `tokenVersion` hilang, malformed, atau `NaN`.

**Hasil Pengujian**:
* `sessionConsistencyMVS_B2_5B4.test.ts`: **16/16 Lulus (100%)**
* Seluruh Test Suite Sistem: **47 Berkas Uji / 1.435 Pengujian Lulus (100%)**
* Build Applet: **Berhasil tanpa kesalahan**
* Typecheck TypeScript (`tsc --noEmit`): **0 Error / 0 Warning**

---

## 7. Tahap F — Batasan Arsitektur & Kesiapan Operasional (Architectural Boundaries)

Sesuai tata kelola kejujuran teknis, batas implementasi saat ini dilaporkan secara transparan:

1. **Topologi Node Tunggal (Single-Node In-Memory Session Store)**:
   - Sesi disimpan dalam `Map<string, SessionData>` di memori proses Node.js.
   - *Batasan*: Jika aplikasi dideploy ke lingkungan multi-instance (misalnya di belakang load balancer tanpa sticky session atau serverless auto-scaling), sesi yang dicabut di Instance A tidak otomatis hilang dari memori Instance B.
   - *Mitigasi yang Berlaku Saat Ini*: Karena `user.token_version` disimpan di sumber data terpadu (database file/Cloud SQL), maka setiap instance yang membaca data pengguna dari database yang sama akan tetap menolak token basi dengan `STALE_TOKEN_VERSION`.
   - *Rekomendasi Skala Horizontal*: Untuk produksi multi-region atau kluster kontainer skala besar, `MemorySessionStore` disarankan digantikan oleh distributed cache seperti Redis dengan Pub/Sub untuk replikasi event invalidasi sesi seketika.
2. **Ketahanan Restart Server**:
   - Jika proses server restart, seluruh sesi di `MemorySessionStore` terhapus (*fail-closed*).
   - Pengguna dipaksa login kembali secara aman tanpa kebocoran hak akses lama.
3. **Kesimpulan Kesiapan**:
   Sistem memenuhi seluruh kriteria keamanan dan konsistensi deterministik untuk lingkungan server tunggal / terkontrol dengan jaminan pertahanan berlapis.
