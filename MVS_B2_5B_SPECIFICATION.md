# NutriBodySim MVS-B2.5B — Approval Engine & Main Administrator Governance Specification

---

## Kontrol Dokumen & Meta

* **Proyek**: NutriBodySim (Laboratorium Riset Komputasi Nutrisi & Pemodelan Fisiologi)
* **Milestone**: MVS-B2.5B (Master Validation System Phase B2.5B)
* **Judul**: Approval Engine, Main Administrator Governance & Session Revocation Architecture
* **Status**: **SPECIFICATION ONLY (DESAIN ARSITEKTURAL)**
* **Tanggal**: 16 Oktober 2026
* **Penulis**: Principal Security & System Architect
* **Governing Rule**:
  > *Tahap ini adalah SPECIFICATION ONLY. Jangan mengubah source code, database, route, konfigurasi autentikasi, atau hak akses. Jangan mengimplementasikan Google OAuth dan jangan melakukan deployment. Jangan menyatakan sistem siap produksi.*

---

## 1. Audit Baseline Aktual

Pemeriksaan menyeluruh dilakukan terhadap kode sumber aktual NutriBodySim (`backend/auth/*`, `backend/database/*`, `backend/routes/api.ts`, `server.ts`) dan laporan verifikasi sebelumnya (`MVS_B2_5_SPECIFICATION.md` dan `MVS_B2_5A1_AUDIT.md`).

Tabel berikut membedakan fakta kode sumber dari klaim teoritis:

### 1.1 Model Role Efektif yang Digunakan (Source Code Evidence)
* **Definisi Role**: Pada `backend/database/types.ts` (baris 17), tipe role didefinisikan sebagai union 4 nilai:
  ```typescript
  export type UserRole = 'Student' | 'Lecturer' | 'Researcher' | 'Admin';
  ```
* **Fakta**: Tidak ada entitas atau enum role `MainAdministrator`, `SuperAdmin`, atau `GovernanceAdmin` di dalam database maupun type definitions saat ini.
* **Fixtures Pengguna**: Pada `backend/database/store.ts`, terdapat 4 pengguna demo terdaftar:
  - `usr_student`: Alex Chen (`Student`)
  - `usr_lecturer`: Prof. Marcus Brody (`Lecturer`)
  - `usr_researcher`: Dr. Elena Vance (`Researcher`)
  - `usr_admin`: System Administrator (`Admin`)

### 1.2 Cara RBAC Menentukan Izin (Source Code Evidence)
* **Definisi Izin**: Pada `backend/auth/rbacMiddleware.ts` (baris 22–27), permissions kanonikal per role:
  ```typescript
  export const ROLE_DEFAULT_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
    Student: ['VIEW', 'USE', 'CREATE', 'CLONE'],
    Lecturer: ['VIEW', 'USE', 'CREATE', 'CLONE', 'EDIT', 'SHARE', 'PUBLISH'],
    Researcher: ['VIEW', 'USE', 'CREATE', 'CLONE', 'EDIT', 'SHARE', 'PUBLISH'],
    Admin: ['VIEW', 'USE', 'CREATE', 'CLONE', 'EDIT', 'DELETE', 'SHARE', 'PUBLISH', 'VERIFY', 'ADMIN']
  };
  ```
* **Temuan Kritis pada `hasPermission`**: Pada `backend/auth/rbacMiddleware.ts` (baris 46–52):
  ```typescript
  export function hasPermission(user: User, permission: Permission): boolean {
    if (user.role === 'Admin' || (user.permissions && user.permissions.includes('ADMIN'))) {
      return true;
    }
    const effective = getEffectivePermissions(user);
    return effective.has(permission);
  }
  ```
  **Analisis Ancaman**: Saat ini, fungsi `hasPermission` memberikan jalan pintas mutlak (*universal wildcard bypass*) untuk setiap pengguna yang memiliki `user.role === 'Admin'`. Hal ini berarti jika izin tata kelola baru diperkenalkan tanpa mengubah logika `hasPermission`, setiap Admin biasa secara otomatis akan memperoleh izin tata kelola tersebut. Ini melanggar prinsip *least privilege*.

### 1.3 Mekanisme Role Request Aktual (Source Code Evidence)
* **Entitas `RoleRequest`**: Didefinisikan pada `backend/database/types.ts` (baris 68–79):
  ```typescript
  export interface RoleRequest {
    request_id: string;
    user_id: string;
    requested_role: RequestedRole;
    approval_status: ApprovalStatus; // 'PENDING' | 'APPROVED' | 'REJECTED'
    institution?: string;
    justification?: string;
    created_at: string;
    reviewed_by?: string | null;
    reviewed_at?: string | null;
    review_reason?: string | null;
  }
  ```
* **Penyimpanan**: Disimpan di dalam array in-memory `state.role_requests` pada `DatabaseStore` dan diserialisasi ke disk melalui atomic POSIX temporary write (`fs.renameSync`) di `data/nutribodysim_db.json`.
* **Endpoint yang Tersedia di `backend/routes/api.ts`**:
  - `POST /api/role-requests`: Menerima permohonan elevasi, memvalidasi kelayakan hierarki (`checkRoleEligibility`), memaksa status `PENDING`, dan merekam ke audit log.
  - `GET /api/role-requests/me`: Membaca riwayat permintaan milik pengguna yang terautentikasi (`canAccessRoleRequest`).
  - `GET /api/role-requests/:id`: Membaca detail satu permohonan dengan otorisasi objek (pemilik atau Admin).
  - `GET /api/role-requests`: Menampilkan seluruh permohonan sistem (hanya untuk `Admin`).
* **Fakta Kritis**: **Tidak ada endpoint persetujuan atau penolakan (`approve`/`reject`) yang aktif.** Pengujian penetrasi adversarial pada `MVS_B2_5A.1` membuktikan bahwa `POST /api/role-requests/:id/approve` mengembalikan status `HTTP 404 Not Found`.

### 1.4 Mekanisme Audit Log Aktual (Source Code Evidence)
* **Implementasi**: Fungsi `db.logAudit` di `backend/database/store.ts` (baris 222–248).
* **Format**: Entri memuat `id`, `user_id`, `user_name`, `action`, `entity_type`, `entity_id`, `details`, `ip_address`, `timestamp`.
* **Karakteristik & Batasan**:
  - Log disimpan di dalam file JSON utama (`nutribodysim_db.json`).
  - Dibatasi secara arbitrer pada 1.000 entri terakhir (`if (state.audit_logs.length > 1000) state.audit_logs.pop()`). Entri lama dihapus dari memori (*silent FIFO truncation*).
  - **Klasifikasi**: *API-Protected Append-Only Application Log*. **BUKAN** log yang *tamper-evident* (tidak ada hashing kriptografis atau Merkle tree) dan **BUKAN** *hardware-immutable* (tidak menggunakan media WORM/cloud object lock).

### 1.5 Session Store & Mekanisme Pencabutan Sesi (Source Code Evidence)
* **Implementasi**: `MemorySessionStore` di `backend/auth/sessionStore.ts`.
* **Struktur Data**: `Map<string, SessionData>` in-memory, di mana kunci adalah SHA-256 hash dari token sesi acak 256-bit (32 bytes).
* **Pencabutan Sesi**: Metode `revokeSession(token: string)` mengubah flag `session.revoked = true`.
* **Keterbatasan Operasional Aktual**:
  1. Bersifat in-memory: Setiap kali proses server me-restart atau container Cloud Run mendaur ulang pod, seluruh sesi aktif terhapus seketika.
  2. Tidak ada metode `revokeAllSessionsForUser(userId: string)`: Sesi hanya bisa dicabut jika pemanggil mengetahui token mentahnya.
  3. Tidak dapat berbagi status (*state sharing*) di antara multi-instance/horizontal scaling.

### 1.6 Endpoint yang Dapat Mengubah Role Pengguna (Source Code Evidence)
* **Fakta**: **ZERO (0) endpoint di kode sumber saat ini yang dapat mengubah role pengguna aktif.**
  - `POST /api/role-requests` hanya membuat permintaan berstatus `PENDING`.
  - Tidak ada endpoint administrasi untuk menyunting `user.role` secara langsung.
  - Perubahan role saat ini hanya terjadi secara statis melalui inisialisasi berkas basis data `nutribodysim_db.json`.

### 1.7 Endpoint Demo Login & Switch User (Source Code Evidence)
* `POST /api/auth/demo-login`: Menerbitkan token sesi aktif untuk `user_id` yang dipilih (dibatasi oleh guard `enableDemoAuth`).
* `POST /api/auth/switch-user`: Menerbitkan sesi baru dan mencabut sesi lama pengguna untuk berpindah konteks akun fixture.
* `POST /api/auth/login`: Mengembalikan `HTTP 501 PRODUCTION_AUTH_BLOCKED` bila `NODE_ENV === 'production'`.

### 1.8 Status FINDING-A5 (Main Administrator Governance)
* **Status Aktual**: **BLOCKED (OPEN)**.
* Laporan `MVS_B2_5A1_AUDIT.md` (baris 139–147) menyatakan secara eksplisit:
  > *"Main Administrator Implementation Status: Marked strictly as BLOCKED... There is no separate MainAdministrator role enum or cryptographic governance key in the current database. No synthetic bypass was created."*
* Tidak ada akun atau mekanisme Main Administrator yang aktif saat ini. Klaim bahwa tata kelola administrator telah selesai adalah tidak benar.

---

## 2. Model Kewenangan (Authority & Permission Model)

Untuk mencegah eskalasi hak istimewa (*privilege escalation*) dan monopoli kontrol yang tidak terkendali, sistem harus memisahkan hak administratif operasional biasa dari hak tata kelola tertinggi (*governance authority*).

### 2.1 Pemisahan Tegas Antara Admin Biasa dan Main Administrator

```
+-----------------------------------------------------------------------------+
|                          NUTRIBODYSIM GOVERNANCE                            |
+---------------------------------------+-------------------------------------+
|         REGULAR ADMINISTRATOR         |          MAIN ADMINISTRATOR         |
|         (Operational Admin)           |         (Governance Authority)      |
+---------------------------------------+-------------------------------------+
| * Tinjau permohonan Student/Lecturer/ | * Menyetujui/Menolak permohonan     |
|   Researcher                          |   elevasi ke role "Admin"           |
| * Moderasi materi, dataset & formula  | * Menunjuk & mencabut hak Admin     |
| * Inspeksi audit log operasional      | * Konfigurasi kebijakan keamanan    |
| * Manajemen proyek publik             | * Tindakan pemulihan darurat        |
| * TIDAK BISA: Angkat Admin            | * Transfer hak Main Administrator   |
| * TIDAK BISA: Setujui diri sendiri    | * TIDAK BISA: Self-approval         |
| * TIDAK BISA: Matikan jejak audit     | * TIDAK BISA: Bypass audit log      |
+---------------------------------------+-------------------------------------+
```

#### Tabel Matriks Kewenangan

| Aksi / Kemampuan Sistem | User Biasa | Regular Admin | Main Administrator | Mekanisme Penegakan |
| :--- | :---: | :---: | :---: | :--- |
| **Mengajukan Role Request** | Ya | Ya (ke Admin) | Tidak (Sudah puncak) | `POST /api/role-requests` |
| **Melihat Permintaan Sendiri** | Ya | Ya | Ya | `GET /api/role-requests/me` |
| **Melihat Permintaan Publik/Akademik** | Tidak | Ya | Ya | `canAccessRoleRequest` |
| **Melihat Permintaan Menjadi Admin** | Tidak | **TIDAK (403)** | **YA** | Filter `requested_role === 'Admin'` |
| **Setujui Student -> Lecturer/Researcher** | Tidak | **YA** | Ya | Permission: `APPROVE_ACADEMIC_ROLES` |
| **Setujui Calon Admin Baru** | Tidak | **TIDAK (403)** | **YA** | Permission: `MANAGE_PRIVILEGED_ROLES` |
| **Menurunkan / Mencabut Role Admin** | Tidak | **TIDAK (403)** | **YA** | Permission: `MANAGE_PRIVILEGED_ROLES` |
| **Mengangkat Main Administrator** | Tidak | **TIDAK (403)** | **TIDAK** (Hanya via Bootstrap/Transfer Resmi) | Sealed Governance Procedure |
| **Menonaktifkan / Menghapus Audit Log** | Tidak | **TIDAK (403/404)** | **TIDAK (Dilarang Mutlak)** | Tidak ada endpoint / Immutability |
| **Menyetujui Permintaan Diri Sendiri** | Tidak | **TIDAK (403)** | **TIDAK (403)** | `requester_id !== reviewer_id` |

### 2.2 Desain RBAC: Pemisahan Role dan Permission

#### Opsi 1: Menambahkan Role Baru `MainAdmin` ke dalam `UserRole`
* *Kelebihan*: Sederhana secara konseptual.
* *Kelemahan*: Mengubah tipe fundamental `UserRole`, memerlukan migrasi pada seluruh dependensi komponen UI, skema database, dan berisiko merusak kompatibilitas dengan scientific core engine.

#### Opsi 2 (Direkomendasikan): Mempertahankan `UserRole`, Menambah Atribut `is_main_admin` dan Scoped Permissions
* **Desain yang Dipilih**:
  1. Tetap mempertahankan `UserRole = 'Student' | 'Lecturer' | 'Researcher' | 'Admin'`.
  2. Menambahkan atribut sistem pada `User`:
     ```typescript
     is_main_admin?: boolean;
     governance_granted_at?: string;
     governance_granted_by?: string;
     ```
  3. Memperkenalkan permission administratif baru dalam `Permission`:
     - `APPROVE_ACADEMIC_ROLES`: Hak menyetujui elevasi ke `Lecturer` atau `Researcher`.
     - `MANAGE_PRIVILEGED_ROLES`: Hak eksklusif untuk menyetujui elevasi ke `Admin`, mengubah role `Admin`, atau menangguhkan akun administratif.
  4. **Pembersihan Wildcard Bypass pada `hasPermission`**:
     Fungsi `hasPermission` di `backend/auth/rbacMiddleware.ts` harus diubah dari bypass liar menjadi pengecekan berbasis hak eksplisit:
     ```typescript
     // ARSITEKTUR YANG DIUSULKAN (B2.5B):
     export function hasPermission(user: User, permission: Permission): boolean {
       // Regular Admin TIDAK LAGI otomatis memiliki hak MANAGE_PRIVILEGED_ROLES!
       if (permission === 'MANAGE_PRIVILEGED_ROLES') {
         return Boolean(user.is_main_admin && user.role === 'Admin');
       }
       if (user.role === 'Admin') {
         // Admin biasa mendapatkan hak operasional default
         return ROLE_DEFAULT_PERMISSIONS.Admin.includes(permission);
       }
       const effective = getEffectivePermissions(user);
       return effective.has(permission);
     }
     ```
* **Alasan Pemilihan**:
  Mencegah regresi pada model RBAC yang sudah teruji pada MVS-B2.3 dan MVS-B2.4, sembari mengisolasi hak istimewa tata kelola tertinggi hanya pada pemegang sah atribut `is_main_admin`.

### 2.3 Larangan Validasi Berbasis Klaim Klien
* Sistem **DILARANG MENGGUNAKAN**:
  1. Nilai role, header `x-admin`, atau payload JSON yang dikirimkan oleh browser/klien.
  2. Domain email (misalnya menganggap `@nutribodysim.org` otomatis sebagai Admin).
  3. Nama, institusi, atau jabatan formal dalam string profil.
  4. Kehadiran `request_id` semata tanpa mencocokkan sesi verifikasi pengguna.
* Otoritas tata kelola **HANYA BERLAKU** jika server memvalidasi secara langsung dari data persisten yang terhubung ke sesi aktif yang valid.

---

## 3. Bootstrap Main Administrator (Solusi FINDING-A5)

FINDING-A5 menegaskan bahwa tidak ada mekanisme bootstrap yang aman di dalam sistem saat ini. Jalur inisialisasi awal ini adalah fondasi keamanan terpenting sebelum persetujuan role dapat dijalankan.

### 3.1 Evaluasi Opsi Desain Bootstrap

| Opsi | Deskripsi | Analisis Keamanan | Keputusan |
| :--- | :--- | :--- | :--- |
| **A. Public Registration / First-User Win** | Pengguna pertama yang mendaftar otomatis menjadi Main Administrator. | **SANGAT BERBAHAYA**. Rawan *race condition* dan pengambilalihan instan oleh bot di jaringan publik. | **DITOLAK** |
| **B. Hardcoded Credentials / Default Account** | Menggunakan akun fixture bawaan (misal `usr_admin` dengan secret statis). | **BERBAHAYA**. Kredensial mudah bocor di repositori publik, tidak ada jaminan identitas operator asli. | **DITOLAK** |
| **C. IdP Allowlist Server Environment** | Mendaftarkan email tertentu dalam env var (misal `MAIN_ADMIN_EMAIL=root@domain`). | Cukup baik, namun sebelum Google OIDC aktif dan terverifikasi secara kriptografis, email mudah dipalsukan. | **DITANGGUHKAN HINGGA OAUTH AKTIF** |
| **D. Local CLI Provisioning Script di Lingkungan Tepercaya (Isolated Operator CLI)** | Perintah administratif yang dijalankan langsung di server console / runtime container tepercaya oleh operator deployment. | **SANGAT AMAN**. Memerlukan akses langsung ke shell container, terisolasi dari lalu lintas HTTP luar, dapat diaudit secara lokal, dan bersifat idempotent. | **DITERIMA SEBAGAI DESAIN UTAMA** |

### 3.2 Desain Terpilih: Isolated Operator CLI (`scripts/bootstrap-main-admin.ts`)

Mekanisme bootstrap dirancang sebagai utilitas konsol berbasis Node.js yang dijalankan oleh operator infrastruktur:

```bash
# Contoh eksekusi di lingkungan tepercaya:
npm run admin:bootstrap -- --user-id="usr_admin" --operator="infra-lead@nutribodysim.org"
```

#### Persyaratan Wajib yang Dipenuhi:
1. **Zero Public Exposure**: Tidak ada rute API HTTP publik yang dapat memicu bootstrap.
2. **No Self-Elevation**: Pengguna melalui browser tidak dapat mengangkat dirinya sendiri.
3. **No Hardcoded Secrets**: Tidak ada kata sandi bawaan atau token statis di dalam repositori atau berkas build klien.
4. **Operator Attribution**: Skrip mewajibkan parameter `--operator` yang mengidentifikasi personel penanggung jawab operasi infrastruktur.
5. **Idempotensi & Anti-Takeover**:
   - Jika sistem mendeteksi sudah ada pengguna dengan `is_main_admin === true` dan akun tersebut `ACTIVE`, proses bootstrap akan **DITOLAK (FAIL-SAFE)** dengan pesan kesalahan: `GOVERNANCE_ALREADY_INITIALIZED`.
   - Re-running skrip tidak akan mengubah Main Administrator tanpa prosedur *break-glass* eksplisit.
6. **Audit Trail Mutlak**:
   - Skrip wajib menulis entri audit log ke database secara atomic:
     `action: 'MAIN_ADMIN_BOOTSTRAP'`, `entity_type: 'USER'`, `entity_id: targetUserId`, `details: "Main Administrator provisioned by operator <email>"`.
7. **Pencegahan Ketiadaan Admin (Orphan State Defense)**:
   - Jika belum ada Main Administrator, seluruh rute persetujuan role atau tindakan `MANAGE_PRIVILEGED_ROLES` di server akan terkunci dalam kondisi **FAIL-CLOSED (HTTP 403 / 503 SERVICE_UNAVAILABLE)**.
8. **Disaster Recovery / Break-Glass Protocol**:
   - Pemulihan darurat dilakukan melalui CLI dengan flag khusus `--force-recovery` dan `--reason="Disaster recovery incident #123"`. Tindakan ini secara otomatis mencabut seluruh sesi pengguna lama yang berstatus Main Administrator.

### 3.3 Analisis Kebutuhan Cryptographic Governance Key
* *Pertimbangan*: Apakah diperlukan pasangan kunci asimetris (RSA/Ed25519) untuk menandatangani tindakan Main Administrator?
* *Analisis*: Pada arsitektur NutriBodySim saat ini (single-database JSON, monolitik Express di lingkungan AI Studio Build/Cloud Run), pengenalan private key file introduces high operational complexity (risiko kehilangan kunci, kebocoran file key di persistent disk).
* *Rekomendasi*: **Fase MVS-B2.5B belum mewajibkan Cryptographic Governance Key asimetris**. Tata kelola ditegakkan melalui server-side isolation, flag `is_main_admin` di database tertutup, dan token sesi bertanda waktu dengan rotasi audit ketat. Kunci asimetris baru dipertimbangkan saat migrasi ke multi-node cluster atau desentralisasi verifikasi.

### 3.4 Perencanaan Tanpa Adanya Google OAuth Aktif
Karena Google OAuth belum diimplementasikan, bootstrap saat ini dirancang untuk mengikat identitas internal (`User.id`). Begitu Google OIDC selesai pada fase berikutnya, akun Main Administrator akan diikat secara kriptografis ke `provider_subject_id` (Google `sub`) yang tidak dapat diubah, mencegah pemalsuan identitas berbasis email semata.

---

## 4. Approval Engine Architecture

Approval Engine adalah mesin transisi status yang mengatur perubahan permohonan peran dari pengajuan hingga eksekusi hak akses.

### 4.1 State Machine Transisi Status

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
(Oleh Admin/Main Admin)  (Oleh Admin/Main Admin)     (Oleh Pemohon)
         |                         |                         |
         v                         v                         v
   +-----------+             +-----------+             +-----------+
   | APPROVED  |             | REJECTED  |             | CANCELLED |
   +-----------+             +-----------+             +-----------+
    (FINAL/IMMUTABLE)         (FINAL/IMMUTABLE)         (FINAL/IMMUTABLE)
         |                         |
         |                         +---> [Cooldown Selesai] ---> Pengajuan Baru
         |
         +---> 1. Mutasi Role Pengguna
               2. Inkrementasi Token Version
               3. Invalidation Sesi Lama
               4. Audit Log Non-Repudiable
```

#### Aturan Transisi:
1. **`PENDING` -> `APPROVED`**:
   - Hanya dapat dilakukan oleh aktor yang berwenang (Admin untuk role akademik; Main Administrator untuk role Admin).
   - Pengguna target dinaikkan ke role baru.
   - Sesi pengguna di-refresh/di-invalidasi untuk menerapkan izin baru.
2. **`PENDING` -> `REJECTED`**:
   - Dapat dilakukan oleh peninjau yang berwenang dengan alasan tertulis wajib (`review_reason`, minimal 10 karakter).
   - Role pengguna target tidak berubah.
3. **`PENDING` -> `CANCELLED`**:
   - Hanya dapat dilakukan oleh pemohon itu sendiri sebelum ditinjau.
4. **Immutabilitas Status Final**:
   - Status `APPROVED`, `REJECTED`, dan `CANCELLED` adalah **FINAL**. Permintaan yang sudah berada pada status ini tidak dapat diubah lagi oleh siapa pun.
   - Upaya mengubah permintaan yang sudah final akan ditolak dengan **`HTTP 409 Conflict`**.
5. **Re-submission (Pengajuan Ulang)**:
   - Pemohon yang ditolak dapat mengajukan permohonan baru setelah status permohonan sebelumnya menjadi `REJECTED`, asalkan tidak ada permohonan `PENDING` lain yang aktif.

### 4.2 Persyaratan Integritas & Otorisasi

1. **Anti-Self-Approval**:
   `req.user.id !== roleRequest.user_id`. Upaya menyetujui permintaan diri sendiri menghasilkan **`HTTP 403 FORBIDDEN (SELF_APPROVAL_PROHIBITED)`**.
2. **Pembatasan Admin Biasa**:
   Admin biasa yang mencoba menyetujui permintaan di mana `requested_role === 'Admin'` akan ditolak dengan **`HTTP 403 FORBIDDEN (INSUFFICIENT_ADMIN_PRIVILEGE)`**.
3. **Verifikasi Akun Aktif Peninjau**:
   Peninjau wajib berstatus `account_status === 'ACTIVE'`. Peninjau yang berstatus `SUSPENDED` atau `DISABLED` ditolak seketika.
4. **Pencegahan Race Condition (Atomic Check-and-Set)**:
   Sebelum mutasi dilakukan, sistem memeriksa ulang bahwa permintaan target masih berada dalam status `PENDING`. Jika dua keputusan tiba secara bersamaan, eksekusi pertama akan berhasil, dan eksekusi kedua akan menerima `HTTP 409 Conflict`.
5. **Atomic Staging & Rollback Consistency**:
   Operasi persetujuan terdiri atas 4 mutasi simultan:
   - Update status permohonan (`RoleRequest.approval_status = 'APPROVED'`).
   - Elevasi role target (`User.role = requestedRole`).
   - Inkrementasi versi token pengguna (`User.token_version += 1`).
   - Pencatatan log audit (`AuditLog`).
   Semua mutasi ini harus dilakukan dalam satu transaksi terpadu di `DatabaseStore`. Jika serialisasi disk gagal (`saveToDisk` melempar `ENOSPC` atau `EIO`), seluruh state memori dibatalkan (*rollback*) dan respons menghasilkan `HTTP 500 INTERNAL_STORAGE_ERROR` tanpa hak akses baru yang terpasang.

### 4.3 Spesifikasi Rancangan Endpoint API

#### A. Persetujuan Permintaan (`POST /api/role-requests/:id/approve`)
* **Headers**: `Authorization: Bearer <sessionToken>`
* **Method**: `POST`
* **Route**: `/api/role-requests/:id/approve`
* **Payload**:
  ```json
  {
    "review_reason": "Kualifikasi akademik dan verifikasi laboratorium valid."
  }
  ```
* **Respons Berhasil (HTTP 200 OK)**:
  ```json
  {
    "success": true,
    "message": "Role elevation approved successfully.",
    "role_request": {
      "request_id": "req_1792235000_a1b2",
      "user_id": "usr_student",
      "requested_role": "Researcher",
      "approval_status": "APPROVED",
      "reviewed_by": "usr_admin",
      "reviewed_at": "2026-10-16T12:00:00.000Z",
      "review_reason": "Kualifikasi akademik dan verifikasi laboratorium valid."
    },
    "updated_user": {
      "id": "usr_student",
      "role": "Researcher",
      "updated_at": "2026-10-16T12:00:00.000Z"
    }
  }
  ```

#### B. Penolakan Permintaan (`POST /api/role-requests/:id/reject`)
* **Headers**: `Authorization: Bearer <sessionToken>`
* **Method**: `POST`
* **Route**: `/api/role-requests/:id/reject`
* **Payload**:
  ```json
  {
    "review_reason": "Justifikasi belum mencukupi standar publikasi ilmiah."
  }
  ```
* **Respons Berhasil (HTTP 200 OK)**:
  ```json
  {
    "success": true,
    "message": "Role elevation rejected.",
    "role_request": {
      "request_id": "req_1792235000_a1b2",
      "user_id": "usr_student",
      "requested_role": "Researcher",
      "approval_status": "REJECTED",
      "reviewed_by": "usr_admin",
      "reviewed_at": "2026-10-16T12:00:00.000Z",
      "review_reason": "Justifikasi belum mencukupi standar publikasi ilmiah."
    }
  }
  ```

#### C. Pembatalan Permintaan oleh Pemohon (`POST /api/role-requests/:id/cancel`)
* **Headers**: `Authorization: Bearer <sessionToken>`
* **Method**: `POST`
* **Route**: `/api/role-requests/:id/cancel`
* **Respons Berhasil (HTTP 200 OK)**:
  ```json
  {
    "success": true,
    "message": "Role request cancelled by owner.",
    "role_request": {
      "request_id": "req_1792235000_a1b2",
      "approval_status": "CANCELLED"
    }
  }
  ```

#### Matriks Kesalahan (HTTP Error Codes):
* `HTTP 400 Bad Request`: Payload tidak lengkap (misal `review_reason` kosong pada penolakan).
* `HTTP 401 Unauthorized`: Token sesi tidak valid, expired, atau tidak ada.
* `HTTP 403 Forbidden`: Peninjau mencoba menyetujui diri sendiri, bukan Admin, Admin biasa mencoba menyetujui role Admin, atau akun berstatus non-ACTIVE.
* `HTTP 404 Not Found`: Permintaan dengan ID tersebut tidak ditemukan.
* `HTTP 409 Conflict`: Permintaan sudah diproses sebelumnya (`ALREADY_FINALIZED`), atau sedang mengalami modifikasi bersamaan.
* `HTTP 500 Internal Server Error`: Kegagalan penyimpanan fisik pada storage disk.

---

## 5. Pencabutan Sesi & Invalidation Hak Akses

Salah satu celah keamanan terbesar pada arsitektur berbasis token adalah *stale session privilege retention* (sesi yang tetap mempertahankan hak lama meskipun akun telah diturunkan atau ditangguhkan).

### 5.1 Strategi Deteksi Perubahan Hak Akses

Dua opsi arsitektural dievaluasi:

| Strategi | Mekanisme | Kelebihan | Kelemahan |
| :--- | :--- | :--- | :--- |
| **Opsi 1: Stateful Session Store Scan** | Setiap kali role berubah, lakukan perulangan pada seluruh Map sesi dan tandai `revoked = true` untuk `userId` terkait. | Cepat diimplementasikan pada memori lokal tunggal. | Memerlukan traversal Map O(N), tidak berfungsi jika session store multi-node tanpa koordinasi pesan. |
| **Opsi 2 (Direkomendasikan): Token Versioning / Role Epoch Check** | Setiap akun memiliki integer `token_version` (default: 1). Setiap kali sesi diterbitkan, `token_version` pengguna saat itu dicatat di dalam session metadata. Saat role berubah atau akun ditangguhkan, `user.token_version += 1`. | **O(1) Check pada middleware**. Begitu middleware memvalidasi token, ia mencocokkan versi token sesi dengan versi pengguna di database. Jika berbeda, sesi dianggap hangus secara seketika. | Membutuhkan penambahan 1 field integer pada entitas User. |

### 5.2 Desain Reaksi Sistem Terhadap Perubahan Status

```
+-----------------------------------+-----------------------------------------+
| Skenario Peristiwa                | Reaksi Sistem & Tindakan Sesi           |
+-----------------------------------+-----------------------------------------+
| 1. Role Dinaikkan                 | Inkrementasi token_version. Sesi lama   |
|    (Elevasi: Student -> Lecturer) | dicabut agar klien meminta sesi baru    |
|                                   | dengan hak akses terelevasi.            |
+-----------------------------------+-----------------------------------------+
| 2. Role Diturunkan / Dicabut      | Inkrementasi token_version seketika.    |
|    (Demotion: Admin -> Lecturer)  | Semua token aktif hangus dalam hitungan |
|                                   | milidetik (mencegah eksploitasi hak).   |
+-----------------------------------+-----------------------------------------+
| 3. Akun Ditangguhkan / Disabled   | Inkrementasi token_version. Inactive    |
|    (SUSPENDED / DISABLED)         | guard menolak seluruh request (403).    |
+-----------------------------------+-----------------------------------------+
| 4. Main Admin Diganti / Transfer  | Sesi Main Admin lama dicabut mutlak.    |
|    (Governance Transfer)          | Audit log keamanan kategori CRITICAL.   |
+-----------------------------------+-----------------------------------------+
| 5. Logout Manual                  | Pencabutan spesifik token via           |
|                                   | `sessionStore.revokeSession(token)`.    |
+-----------------------------------+-----------------------------------------+
```

### 5.3 Analisis Keterbatasan In-Memory Session Store (`MemorySessionStore`)
* **Status**: **NOT PRODUCTION READY**.
* **Konsekuensi Operasional**:
  1. *Restart Volatility*: Begitu server diperbarui atau container restart, seluruh user ter-logout paksa.
  2. *Multi-Instance Desynchronization*: Jika NutriBodySim dijalankan di balik load balancer (misal beberapa container Cloud Run), pencabutan sesi di container A tidak diketahui oleh container B.
  3. *Memory Leaks*: Sesi yang ditinggalkan oleh pengguna menumpuk di memori sebelum dibersihkan oleh `cleanExpiredSessions`.
* **Rekomendasi Arsitektur Masa Depan**: Pada fase produksi, `MemorySessionStore` wajib digantikan oleh distributed high-speed persistent store (seperti Redis cluster atau PostgreSQL relational session table). Namun, **pada tahap spesifikasi ini, dilarang mengubah kode implementasi session store**.

---

## 6. Audit Log & Akuntabilitas

Audit log adalah instrumen kepatuhan dan forensik utama dalam tata kelola ilmiah NutriBodySim.

### 6.1 Daftar Event Wajib yang Direkam

| Kode Event | Kategori | Keterangan | Level Sensitivitas |
| :--- | :--- | :--- | :---: |
| `ROLE_REQUEST_CREATE` | Akses | Permohonan elevasi diajukan oleh pengguna | NORMAL |
| `ROLE_REQUEST_CANCEL` | Akses | Permohonan dibatalkan oleh pemohon | NORMAL |
| `ROLE_REQUEST_APPROVE`| Tata Kelola | Permohonan disetujui oleh peninjau yang berwenang | **HIGH** |
| `ROLE_REQUEST_REJECT` | Tata Kelola | Permohonan ditolak oleh peninjau | **HIGH** |
| `USER_ROLE_CHANGE`    | Tata Kelola | Mutasi role efektif pada akun pengguna | **CRITICAL** |
| `MAIN_ADMIN_BOOTSTRAP`| Tata Kelola | Inisialisasi awal Main Administrator via CLI | **CRITICAL** |
| `MAIN_ADMIN_TRANSFER` | Tata Kelola | Penyerahan wewenang Main Administrator | **CRITICAL** |
| `ACCOUNT_STATUS_CHANGE`| Keamanan | Akun diaktifkan, disuspend, atau dinonaktifkan | **HIGH** |
| `SESSION_REVOKE_ALL`  | Keamanan | Seluruh sesi pengguna dicabut serentak | **HIGH** |
| `SECURITY_ADMIN_VIOLATION`| Ancaman | Percobaan akses administratif tanpa izin | **CRITICAL** |
| `SENSITIVE_OP_FAILURE`| Sistem | Kegagalan teknis pada operasi berhak tinggi | **CRITICAL** |

### 6.2 Skema Data Entri Audit Log

Setiap entri audit log harus mematuhi struktur non-repudiable berikut:

```typescript
export interface GovernanceAuditLog {
  id: string;                     // AUDIT_<timestamp>_<entropy>
  timestamp: string;              // ISO 8601 UTC
  actor_id: string;               // ID pengguna peninjau/operator
  actor_name: string;             // Nama lengkap aktor
  actor_role: UserRole;           // Role aktor saat kejadian
  action: string;                 // Kode event (dari tabel 6.1)
  entity_type: string;            // 'ROLE_REQUEST' | 'USER' | 'GOVERNANCE'
  entity_id: string;              // Target ID yang diubah
  details: string;                // Keterangan terstruktur dan ringkas
  ip_address: string;             // Alamat IP klien (sanitized)
  user_agent?: string;            // Client User-Agent
  correlation_id?: string;        // Request ID untuk pelacakan transaksi
  result: 'SUCCESS' | 'FAILURE';  // Hasil operasi
  error_code?: string;            // Kode error jika operasi gagal
}
```

### 6.3 Perlindungan Privasi Data Log
* **Dilarang Dicatat**:
  - Raw session tokens, Authorization Bearer headers, refresh tokens.
  - Kata sandi, hash kredensial, atau kunci kriptografis privat.
  - Data pribadi non-akademik (nomor KTP, nomor telepon, data finansial).
* **Klasifikasi Immutabilitas Aktual**:
  - Audit log saat ini dilindungi dari manipulasi melalui lapisan API (tidak ada endpoint `PUT`, `POST`, atau `DELETE` pada `/api/audit`).
  - Namun, penyimpanan fisik masih berada di dalam file JSON lokal yang dapat terpotong jika melewati 1.000 entri. Sistem ini **BUKAN hardware-immutable WORM** dan **BUKAN cryptographic hash-chained ledger**. Klaim bahwa log tidak dapat diretas sama sekali adalah salah.

### 6.4 Prinsip Fail-Closed pada Kegagalan Audit
Apabila fungsi `db.logAudit` mengalami kegagalan (misalnya karena memori penuh, kegagalan I/O, atau disk lock):
* Seluruh operasi administratif sensitif (seperti `approve`, `reject`, atau `role change`) **WAJIB DIGAGALKAN (FAIL-CLOSED)**.
* Database store harus membatalkan transaksi role change dan mengembalikan `HTTP 500 AUDIT_LOGGING_FAILED`.
* Tidak boleh ada pengguna yang mendapatkan kenaikan hak tanpa jejak audit yang berhasil ditulis ke media persisten.

---

## 7. Data & Privasi (Data Minimization & Confidentiality)

### 7.1 Prinsip Minimum Data Pengajuan Peran
Permohonan kenaikan role hanya membutuhkan data proporsional untuk memverifikasi kelayakan akademik:
1. `requested_role`: Pilihan role target (`Lecturer`, `Researcher`, `Admin`).
2. `institution`: Nama institusi akademik atau laboratorium penelitian (maksimal 100 karakter).
3. `justification`: Uraian singkat tujuan penelitian atau kurikulum akademik (minimal 10 karakter, maksimal 500 karakter).
* **Larangan**: Sistem **DILARANG** meminta pemindaian KTP, paspor, kartu kredit, atau berkas pribadi rahasia tanpa dasar kebutuhan fungsional.

### 7.2 Pembatasan Akses Informasi Sensitif
* **Pemohon**: Hanya dapat melihat permintaan miliknya sendiri (`GET /api/role-requests/me`).
* **Regular Admin**: Dapat melihat permintaan untuk `Lecturer` dan `Researcher`. Tidak dapat melihat alasan pengajuan permohonan ke role `Admin`.
* **Main Administrator**: Memiliki akses inspeksi penuh terhadap seluruh permohonan dan alasan review.
* **Audit atas Akses Data**: Setiap kali Admin membuka endpoint daftar permohonan peran (`GET /api/role-requests`), tindakan pembacaan ini harus dicatat di audit log untuk mencegah penyalahgunaan intip data (*data scraping* internal).

### 7.3 Masa Retensi & Hak untuk Dilupakan (Right to Be Forgotten)
* **Permohonan `REJECTED` dan `CANCELLED`**: Disimpan selama 90 hari kalender untuk keperluan pencegahan spam dan audit konsistensi, kemudian dihapus otomatis atau dianonimkan.
* **Permohonan `APPROVED`**: Disimpan permanen sebagai catatan bukti sejarah kepemilikan role (*provenance record*).
* **Penghapusan Akun**: Jika pengguna dihapus sesuai regulasi privasi (misal GDPR), data pada `RoleRequest` dianonimkan (`user_name: 'ANONYMIZED_USER'`) tanpa menghapus jejak peristiwa tata kelola.

---

## 8. Test Plan Adversarial (Rencana Pengujian Penetrasi)

Pengujian komprehensif dirancang untuk memvalidasi bahwa sistem kebal terhadap eksploitasi sebelum implementasi disahkan. Seluruh pengujian dikategorikan ke dalam Unit Test, Integration Test, dan Operational Test.

### Tabel Matriks Pengujian Adversarial

| ID Uji | Kategori | Vektor Serangan / Skenario Uji | Kondisi Awal & Input | Hasil yang Diharapkan | Status |
| :--- | :--- | :--- | :--- | :--- | :---: |
| **TEST-ADV-01** | Integration | **Self-Approval Bypass**: Pengguna biasa / Admin mencoba menyetujui permintaannya sendiri | `req.user.id === roleRequest.user_id`, panggil `POST /approve` | Ditolak dengan `HTTP 403 (SELF_APPROVAL_PROHIBITED)` | `NOT_TESTED` |
| **TEST-ADV-02** | Integration | **Admin Self-Promotion**: Admin biasa mencoba mengangkat diri menjadi Main Administrator | Admin login, kirim payload mutasi hak governance | Ditolak dengan `HTTP 403 (FORBIDDEN_GOVERNANCE_MUTATION)` | `NOT_TESTED` |
| **TEST-ADV-03** | Integration | **Peer Admin Privilege Escalation**: Admin biasa menyetujui pengguna lain menjadi Admin | Regular Admin menyetujui permohonan `requested_role: 'Admin'` | Ditolak dengan `HTTP 403 (INSUFFICIENT_ADMIN_PRIVILEGE)` | `NOT_TESTED` |
| **TEST-ADV-04** | Unit | **Forged Role Input**: Pengguna mengirimkan string role palsu ("SuperUser", "MainAdmin") | Payload: `requested_role: 'SuperUser'` | Ditolak dengan `HTTP 400 (INVALID_ROLE)` | `NOT_TESTED` |
| **TEST-ADV-05** | Integration | **Actor ID Spoofing**: Peninjau menyertakan body `reviewer_id: "usr_main_admin"` palsu | Body injection saat approve | Server mengabaikan body, mengikat identitas strictly ke session | `NOT_TESTED` |
| **TEST-ADV-06** | Integration | **Final State Replay Attack**: Mengirim ulang persetujuan pada request yang sudah `APPROVED` atau `REJECTED` | Request ID berstatus `APPROVED` dipanggil `/approve` | Ditolak dengan `HTTP 409 (ALREADY_FINALIZED)` | `NOT_TESTED` |
| **TEST-ADV-07** | Integration | **Concurrent Approval Race Condition**: Dua request approve ditembakkan bersamaan secara paralel | Parallel HTTP POST ke `/approve` pada request yang sama | Tepat 1 request berhasil (200), request kedua konflik (409) | `NOT_TESTED` |
| **TEST-ADV-08** | Integration | **Stale Session Post-Demotion**: Menggunakan token sesi lama setelah role diturunkan | Sesi dibuat saat Admin, role diturunkan ke Student, akses `/api/audit` | Ditolak seketika dengan `HTTP 403 (FORBIDDEN)` | `NOT_TESTED` |
| **TEST-ADV-09** | Integration | **Suspended Admin Approval**: Admin yang berstatus `SUSPENDED` mencoba mengeksekusi review | Peninjau memiliki `account_status: 'SUSPENDED'` | Ditolak seketika dengan `HTTP 403 (FORBIDDEN_ACCOUNT_STATUS)` | `NOT_TESTED` |
| **TEST-ADV-10** | Integration | **No Active Main Administrator**: Eksekusi persetujuan Admin saat belum ada Main Admin aktif | Sistem belum memiliki Main Admin, request Admin disetujui | Fail-closed: Ditolak dengan `HTTP 503 (GOVERNANCE_NOT_INITIALIZED)` | `NOT_TESTED` |
| **TEST-ADV-11** | Operational | **Repeated Bootstrap Probe**: Operator menjalankan skrip bootstrap untuk kedua kalinya | Eksekusi CLI bootstrap pada sistem yang sudah memiliki Main Admin | Ditolak aman: Error `GOVERNANCE_ALREADY_INITIALIZED` | `NOT_TESTED` |
| **TEST-ADV-12** | Operational | **Unauthorized Bootstrap Execution**: Pihak non-operator menjalankan bootstrap tanpa kredensial | Eksekusi tanpa parameter operator sah atau env lock | Ditolak: Exit code non-zero, tidak ada mutasi state | `NOT_TESTED` |
| **TEST-ADV-13** | Integration | **Audit Log Failure Rollback**: Disk write error disimulasikan saat penulisan audit log | Simulasikan error pada `db.logAudit` selama approve | Fail-closed: Role tidak dinaikkan, database di-rollback (500) | `NOT_TESTED` |
| **TEST-ADV-14** | Integration | **Storage Failure Rollback (ENOSPC)**: Disk penuh saat menyimpan mutasi database | Mock `fs.writeFileSync` melempar `ENOSPC` | In-memory arrays di-rollback bersih via splice, zero dirty state | `NOT_TESTED` |
| **TEST-ADV-15** | Integration | **Cross-User BOLA / IDOR**: User A mencoba membatalkan request milik User B | User A panggil `POST /role-requests/:id_b/cancel` | Ditolak dengan `HTTP 403 (OBJECT_ACCESS_DENIED)` | `NOT_TESTED` |

*Catatan Kepatuhan: Seluruh pengujian di atas berstatus **NOT_TESTED** karena berada pada tahap spesifikasi. Dilarang mengklaim pengujian telah lulus sebelum kode diimplementasikan dan tes dijalankan secara riil.*

---

## 9. Urutan Implementasi yang Aman (Implementation Sequence)

Implementasi tahap MVS-B2.5B hanya boleh dilakukan setelah spesifikasi ini ditinjau dan disetujui. Urutan langkah-langkah kerja harus mengikuti tahapan berikut:

```
[Tahap 1: Persiapan Skema Data & Types]
  └── Tambah atribut `is_main_admin`, `token_version` pada `User`.
  └── Perbarui `Permission` dengan scoped permissions baru.
  └── Verifikasi integritas tipe via `npm run lint`.

[Tahap 2: Refaktorisasi RBAC Middleware]
  └── Cabut wildcard bypass Admin pada `hasPermission`.
  └── Buat middleware `requireMainAdmin()` dan `requirePermission('MANAGE_PRIVILEGED_ROLES')`.
  └── Tambahkan validasi token_version pada `auth.authenticate`.

[Tahap 3: Implementasi Script Bootstrap Terisolasi]
  └── Buat `scripts/bootstrap-main-admin.ts` dengan perlindungan idempotensi.
  └── Tulis audit log otomatis pada eksekusi bootstrap.

[Tahap 4: Approval Engine di DatabaseStore]
  └── Implementasikan metode atomic `approveRoleRequest` dan `rejectRoleRequest`.
  └── Pastikan mekanisme rollback in-memory jika `saveToDisk` gagal.

[Tahap 5: Pembangunan Rute API & Guard Otorisasi]
  └── Tambahkan endpoint `/approve`, `/reject`, `/cancel` pada `backend/routes/api.ts`.
  └── Terapkan `checkActiveAccount`, anti-self-approval, dan privilege boundary.

[Tahap 6: Eksekusi Test Suite Adversarial]
  └── Buat `backend/__tests__/approvalEngineMVS_B2_5B.test.ts`.
  └── Jalankan seluruh 15 pengujian adversarial.

[Tahap 7: Audit Akhir & Verifikasi Regresi]
  └── Jalankan full regression suite (1.350+ tests).
  └── Pastikan build applet lulus tanpa error (`compile_applet`).
```

---

## 10. Daftar Dependency & Konfigurasi yang Belum Tersedia

Implementasi MVS-B2.5B dan kesiapan produksi sesungguhnya masih terhambat oleh komponen infrastruktur yang belum terpasang:

1. **Google OAuth 2.0 / OpenID Connect (OIDC)**:
   - Client ID dan Client Secret belum dikonfigurasi.
   - Belum ada rute pertukaran token OIDC di frontend maupun backend.
2. **Distributed Persistent Session Store**:
   - Belum ada Redis atau Memcached. Sistem masih bergantung pada `MemorySessionStore` lokal.
3. **Transactional Database Engine**:
   - Sistem masih menggunakan basis data berbasis berkas JSON (`nutribodysim_db.json`) dengan penguncian berkas sederhana, belum menggunakan PostgreSQL/Cloud SQL dengan transaksi ACID.
4. **Tamper-Evident / Immutable Log Storage**:
   - Belum ada integrasi ke Google Cloud Logging, AWS CloudTrail, atau WORM storage untuk audit trail kepatuhan HIPAA/FDA 21 CFR Part 11.
5. **Environment Secrets**:
   - Variabel konfigurasi lingkungan operasional untuk kunci enkripsi dan governance operator belum diinjeksikan ke `.env`.

---

## 11. Risiko & Temuan yang Masih Terbuka (Status Matrix)

| ID Temuan | Area Fokus | Status | Deskripsi Risiko Aktual |
| :--- | :--- | :---: | :--- |
| **FINDING-A5** | Main Administrator Governance | **BLOCKED** | Belum ada entitas Main Administrator aktif atau script bootstrap terverifikasi. Masih menunggu persetujuan spesifikasi ini. |
| **SEC-SES-01** | In-Memory Session Store Volatility | **BLOCKED** | Sesi hilang saat restart server; desinkronisasi multi-instance. Belum siap produksi. |
| **SEC-LOG-01** | Audit Log FIFO Eviction Cap (1.000) | **BLOCKED** | Entri audit ke-1.001 akan terhapus otomatis dari JSON database, menghilangkan rekam jejak historis jangka panjang. |
| **SEC-RBAC-01** | Wildcard Admin Bypass di `hasPermission` | **BLOCKED** | Admin biasa mewarisi seluruh izin tanpa batasan; menunggu refaktorisasi pada tahap implementasi B2.5B. |
| **SEC-IDP-01** | Google OIDC Provider Linking | **BLOCKED** | Autentikasi eksternal belum diaktifkan; demo fixtures masih aktif untuk keperluan preview. |
| **SEC-STOR-01** | Non-Transactional JSON Persistence | **BLOCKED** | Meskipun aman dari pemotongan berkas via atomic rename, tidak ada rollback transaksi ACID di level multi-tabel. |

---

## 12. Kriteria Penerimaan Tahap Implementasi Berikutnya (Acceptance Criteria)

Sebelum tahap implementasi MVS-B2.5B dinyatakan selesai dan dapat dilanjutkan ke integrasi OAuth, seluruh kriteria penerimaan berikut **WAJIB TERPENUHI SECARA VERIFIABLE**:

- [ ] **AC-01**: Tipe dan model role memisahkan kewenangan Regular Admin dan Main Administrator secara eksplisit tanpa mengandalkan data kiriman klien.
- [ ] **AC-02**: Skrip bootstrap Main Administrator berhasil diuji coba secara lokal dengan jaminan idempotensi dan penolakan eksekusi ganda.
- [ ] **AC-03**: Wildcard bypass pada `hasPermission` untuk role `Admin` telah dicabut dan digantikan oleh scoped permission checks.
- [ ] **AC-04**: Endpoint persetujuan dan penolakan (`/approve`, `/reject`, `/cancel`) berfungsi dengan penolakan mutlak terhadap self-approval dan privilege escalation.
- [ ] **AC-05**: Status `APPROVED`, `REJECTED`, dan `CANCELLED` bersifat final dan kebal terhadap *replay attack* atau modifikasi ulang (mengembalikan HTTP 409).
- [ ] **AC-06**: Transaksi persetujuan role menerapkan *atomic staging* dan *rollback* sempurna jika serialisasi storage disk mengalami kegagalan.
- [ ] **AC-07**: Perubahan role atau penangguhan akun secara instan membatalkan sesi lama pengguna via token versioning atau session invalidation.
- [ ] **AC-08**: Seluruh event tata kelola tercatat ke dalam audit trail dengan mekanisme *fail-closed* jika logging gagal.
- [ ] **AC-09**: Seluruh 15 skenario pengujian adversarial pada Bab 8 telah dibuatkan berkas tes otomatisnya (`.test.ts`) dan dinyatakan **PASS 100%**.
- [ ] **AC-10**: Full regression test suite (1.350+ tes saintifik dan backend) tetap lulus 100% tanpa ada fitur yang rusak.
- [ ] **AC-11**: Kode lolos linter (`npm run lint`) dan build server/client (`npm run build`) tanpa peringatan tipe atau kompilasi.

---

## 13. Kesimpulan

Tahap **MVS-B2.5B** telah didefinisikan secara lengkap sebagai **SPESIFIKASI ARSITEKTUR TERTUTUP**. 

Dokumen ini menetapkan pemisahan mutlak antara Admin biasa dan Main Administrator, mendesain prosedur bootstrap aman untuk menutup FINDING-A5, menyusun state machine Approval Engine dengan transaksi atomic dan rollback, serta merumuskan invalidasi sesi berbasis token versioning dan rencana pengujian penetrasi 15 skenario.

Sesuai instruksi:
1. **Tidak ada kode sumber, database, konfigurasi autentikasi, atau hak akses yang diubah.**
2. **Tidak ada Google OAuth yang diimplementasikan.**
3. **Tidak ada deployment yang dijalankan.**
4. **Sistem dinyatakan BELUM SIAP PRODUKSI (NOT READY FOR PRODUCTION).**

Implementasi teknis baru boleh dimulai setelah spesifikasi ini diulas dan disetujui secara resmi oleh dewan tata kelola arsitektur.
