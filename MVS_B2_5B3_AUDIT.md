# NutriBodySim MVS-B2.5B.3 — Secure Role Approval Engine Audit Report

---

## Kontrol Dokumen & Meta

* **Proyek**: NutriBodySim (Laboratorium Riset Komputasi Nutrisi & Pemodelan Fisiologi)
* **Milestone**: MVS-B2.5B.3 (Master Validation System Phase B2.5B.3)
* **Judul**: Secure Role Approval Engine, Risk-Tiered Governance & Session Invalidation Audit
* **Status**: **VERIFIED PASS (IMPLEMENTASI & VERIFIKASI SELESAI)**
* **Tanggal**: 17 Oktober 2026
* **Penulis**: Principal Security Architect & Senior Software Engineer
* **Dokumen Acuan**:
  - `MVS_B2_5B_SPECIFICATION.md` (Spesifikasi Approval Engine, State Machine, & Governance)
  - `MVS_B2_5B1_AUDIT.md` (Laporan Eliminasi Wildcard & RBAC Hardening)
  - `MVS_B2_5B2_AUDIT.md` (Laporan Secure Main Administrator Bootstrap)
  - `backend/auth/roleApprovalEngine.ts` (Layanan Domain Approval Engine)
  - `backend/database/store.ts` (Metode Transaksional Penyimpanan Data)
  - `backend/auth/sessionStore.ts` & `backend/auth/authMiddleware.ts` (Pencabutan Sesi & Token Versioning)
  - `backend/routes/api.ts` (Endpoint HTTP Otoritatif)
  - `backend/__tests__/secureRoleApprovalMVS_B2_5B3.test.ts` (Suite Uji Adversarial 21 Skenario)
* **Status Kesiapan Produksi**: **NOT READY FOR PRODUCTION** (Sesuai governance gate MVS-B2.5B, komponen Google OIDC aktual dan database SQL relational terdistribusi masih dalam tahap roadmap berikutnya).

---

## 1. Eksekutif Ringkasan

Sesuai spesifikasi tata kelola NutriBodySim (`MVS_B2_5B_SPECIFICATION.md`), milestone **MVS-B2.5B.3** menyelesaikan implementasi mesin persetujuan peran (**Secure Role Approval Engine**) yang sepenuhnya dikontrol oleh server (*server-authoritative*).

Implementasi ini menyelesaikan arsitektur siklus hidup permohonan peran (*Role Request Lifecycle*) pasca penghapusan wildcard Admin (MVS-B2.5B.1) dan penyediaan mekanisme bootstrap Main Administrator yang terisolasi (MVS-B2.5B.2).

### Ringkasan Penjaminan Keamanan Utama:
1. **Pemisahan Kewenangan Berbasis Tingkat Risiko (Risk-Tiered Authority)**:
   - Permintaan peran akademik (`Student -> Lecturer/Researcher`, atau perpindahan lateral) dapat disetujui atau ditolak oleh Administrator biasa (`role: 'Admin'` dengan izin `ADMIN`).
   - Permintaan promosi menjadi Administrator (`requested_role: 'Admin'`) **MUTLAK** memerlukan persetujuan Main Administrator aktif (`is_main_admin === true && role === 'Admin'`). Administrator biasa ditolak seketika (HTTP 403 `INSUFFICIENT_ADMIN_PRIVILEGE`).
   - Promosi menjadi Main Administrator dilarang keras dilakukan melalui Approval Engine (atribut `is_main_admin` tidak pernah dapat diberikan oleh API ini).
2. **Penegakan Anti-Self-Review Mutlak**:
   - Tidak ada pengguna yang dapat menyetujui atau menolak permohonan miliknya sendiri (`reviewer.id !== roleRequest.user_id`), menghasilkan HTTP 403 `SELF_APPROVAL_PROHIBITED`.
3. **Immutabilitas State Machine & Pertahanan Replay**:
   - Transisi status: `PENDING -> APPROVED`, `PENDING -> REJECTED`, dan `PENDING -> CANCELLED` (hanya oleh pemilik).
   - Status akhir (`APPROVED`, `REJECTED`, `CANCELLED`) bersifat final dan tidak dapat diubah kembali. Permintaan ulang (*replay*) menghasilkan respons konflik deterministik (HTTP 409 `ALREADY_FINALIZED`).
4. **Verifikasi Keaktifan Pengguna & Peninjau**:
   - Peninjau yang berstatus non-aktif (`SUSPENDED`/`DISABLED`) ditolak memproses permintaan (HTTP 403 `REVIEWER_NOT_ACTIVE`).
   - Permohonan dari pengguna sasaran yang berstatus non-aktif (`SUSPENDED`/`DISABLED`) tidak dapat disetujui (HTTP 403 `TARGET_NOT_ACTIVE`). Persetujuan peran tidak pernah mengaktifkan akun secara otomatis.
5. **Transaksional & Atomicity Rollback**:
   - Operasi persetujuan mengoordinasikan mutasi status permohonan, elevasi role pengguna, pembaruan izin, rotasi `token_version`, dan pencatatan audit log `ROLE_APPROVAL`.
   - Apabila serialisasi penyimpanan gagal (misal simulasi `ENOSPC`/disk error), seluruh state memori dibatalkan (*rollback*) secara atomik tanpa inkonsistensi data.
6. **Pencabutan Sesi Seketika & Token Versioning**:
   - Setelah persetujuan berhasil, seluruh sesi aktif milik pengguna sasaran dicabut seketika (`revokeSessionsForUser`).
   - Token sesi lama ditolak pada pemanggilan berikutnya oleh middleware melalui verifikasi `token_version` (HTTP 401 `STALE_TOKEN_VERSION` / `UNAUTHORIZED`).
7. **Verifikasi Penuh**:
   - 21 uji skenario baru pada `secureRoleApprovalMVS_B2_5B3.test.ts` dan seluruh 46 file pengujian (1.419 pengujian vitest) lulus **100% (PASS)**.
   - Tidak ada regresi pada modul biometrik sains maupun modul tata kelola sebelumnya.

---

## 2. Tahap A — Audit Kode Aktual & Kondisi Baseline

Sebelum implementasi MVS-B2.5B.3:
1. **Model & Endpoint Role Request Awal**:
   - MVS-B2.5A telah mengimplementasikan `POST /api/role-requests`, `GET /api/role-requests/me`, `GET /api/role-requests/:id`, dan `GET /api/role-requests`.
   - Namun, endpoint pemrosesan persetujuan (`/approve`, `/reject`, `/cancel`) belum tersedia di API router.
2. **Pengecekan Izin Tanpa Approval Engine**:
   - Admin biasa masih berpotensi menyetujui seluruh permintaan seandainya endpoint dibuat secara naif tanpa pemeriksaan tingkat risiko (*risk-tier*).
3. **Stale Session Risk**:
   - Field `token_version` telah ditambahkan ke skema `User` pada MVS-B2.5B.2, tetapi middleware `authMiddleware.ts` belum memverifikasi kesesuaian versi token sesi dengan nilai `token_version` pengguna di database.

---

## 3. Tahap B — Desain State Machine & Transisi Permintaan

### 3.1 Diagram Transisi State Machine
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
        |
        +---> 1. user.role = requested_role
              2. user.permissions = ROLE_DEFAULT_PERMISSIONS[role]
              3. user.token_version += 1
              4. sessionStore.revokeSessionsForUser(user.id)
              5. AuditLog (action: 'ROLE_APPROVAL')
```

### 3.2 Immutabilitas Status Final
- Status `APPROVED`, `REJECTED`, dan `CANCELLED` adalah terminal.
- Server melakukan evaluasi status pada saat operasi dijalankan (*runtime check-and-set*). Jika status bukan `PENDING`, server mengembalikan respons HTTP 409 Conflict:
  ```json
  {
    "error": "Role request is already finalized with status 'APPROVED' and cannot be processed again.",
    "code": "ALREADY_FINALIZED",
    "current_status": "APPROVED"
  }
  ```

---

## 4. Tahap C — Matriks Kewenangan Reviewer & Kebijakan Tingkat Risiko

| Aktor Peninjau | Status Akun | Peran yang Diminta | Status Izin & Persetujuan | Kode Respons |
| :--- | :--- | :--- | :--- | :--- |
| **Pemohon Sendiri** | ACTIVE | Apa pun | **DITOLAK (Self-Review)** | `403 SELF_APPROVAL_PROHIBITED` |
| **Non-Admin (Student/Lecturer/Researcher)** | ACTIVE | Apa pun | **DITOLAK (Bukan Admin)** | `403 FORBIDDEN` |
| **Admin Biasa** | ACTIVE | `Lecturer` / `Researcher` | **DIIZINKAN** | `200 OK` |
| **Admin Biasa** | ACTIVE | `Admin` | **DITOLAK (Kurang Hak Istimewa)** | `403 INSUFFICIENT_ADMIN_PRIVILEGE` |
| **Main Administrator** | ACTIVE | `Admin` | **DIIZINKAN** | `200 OK` |
| **Main Administrator** | ACTIVE | `is_main_admin` | **DITOLAK MUTLAK (Bukan via Engine)** | Tidak Ada Endpoint |
| **Peninjau Mana Pun** | SUSPENDED / DISABLED | Apa pun | **DITOLAK (Reviewer Tidak Aktif)** | `403 REVIEWER_NOT_ACTIVE` |
| **Target Pengguna** | SUSPENDED / DISABLED | Apa pun | **DITOLAK (Target Tidak Aktif)** | `403 TARGET_NOT_ACTIVE` |

---

## 5. Tahap D — Spesifikasi Endpoint API Otoritatif

### 5.1 Persetujuan Permintaan (`POST /api/role-requests/:id/approve`)
- **Autentikasi**: Wajib Bearer Token.
- **Otorisasi**: Memeriksa peninjau aktif, non-self-approval, dan kesesuaian tingkat risiko.
- **Payload Input**: Optional `{ "review_reason": "string" }`.
- **Sanitasi**: Input klien seperti `role`, `is_main_admin`, `permissions`, `user_id`, `approval_status`, atau `reviewed_by` diabaikan sepenuhnya; identitas peninjau diambil eksklusif dari `req.user.id` yang telah diautentikasi.
- **Respons Berhasil (HTTP 200)**:
  ```json
  {
    "success": true,
    "message": "Role elevation approved successfully.",
    "role_request": { ... },
    "updated_user": { "id": "usr_student", "role": "Researcher", "token_version": 2 },
    "audit_log": { ... }
  }
  ```

### 5.2 Penolakan Permintaan (`POST /api/role-requests/:id/reject`)
- **Autentikasi**: Wajib Bearer Token.
- **Payload Input**: Wajib `{ "review_reason": "string" }` (minimal 5 karakter).
- **Respons Berhasil (HTTP 200)**:
  ```json
  {
    "success": true,
    "message": "Role elevation rejected.",
    "role_request": { ... },
    "audit_log": { ... }
  }
  ```

### 5.3 Pembatalan oleh Pemilik (`POST /api/role-requests/:id/cancel`)
- **Autentikasi**: Wajib Bearer Token.
- **Otorisasi Level Objek (IDOR Defense)**: Hanya pemohon asli (`roleRequest.user_id === req.user.id`) yang dapat membatalkan. Pengguna lain menerima HTTP 403 `FORBIDDEN_NOT_OWNER`.
- **Respons Berhasil (HTTP 200)**:
  ```json
  {
    "success": true,
    "message": "Role request cancelled by owner.",
    "role_request": { "approval_status": "CANCELLED", ... }
  }
  ```

---

## 6. Tahap E — Transaksi Penyimpanan & Atomicity Rollback

### 6.1 Implementasi Transaksional di `DatabaseStore`
Metode `approveRoleRequest`, `rejectRoleRequest`, dan `cancelRoleRequest` menerapkan pola *Snapshot & Rollback*:
```typescript
// Snapshot state
const prevTargetRole = targetUser.role;
const prevTargetPermissions = [...targetUser.permissions];
const prevTargetTokenVersion = targetUser.token_version;
const prevReqStatus = roleRequest.approval_status;
// ... Mutasi state memori ...
try {
  this.saveToDisk(this.state);
} catch (saveError) {
  // Rollback targetUser
  targetUser.role = prevTargetRole;
  targetUser.permissions = prevTargetPermissions;
  targetUser.token_version = prevTargetTokenVersion;
  // Rollback roleRequest
  roleRequest.approval_status = prevReqStatus;
  // Rollback auditLog
  const auditIdx = this.state.audit_logs.findIndex(a => a.id === auditLog.id);
  if (auditIdx !== -1) this.state.audit_logs.splice(auditIdx, 1);
  throw saveError;
}
```

### 6.2 Integritas Jejak Audit
Setiap keputusan dicatat dalam entri `AuditLog` dengan tipe aksi `ROLE_APPROVAL`, mencakup:
- ID Permintaan, ID Pemohon, ID Peninjau.
- Role sebelum dan sesudah perubahan.
- Status sebelum dan sesudah perubahan.
- Alasan peninjauan yang telah disanitasi dari tag HTML.
- Metadata tersusun rapi tanpa menyimpan token sesi atau data sensitif.

---

## 7. Tahap F — Mekanisme Pencabutan Sesi & Token Versioning

### 7.1 Deteksi Sesi Usang (Stale Token Defense)
1. Setiap sesi baru menyimpan nilai `tokenVersion` pengguna saat login.
2. Ketika elevasi peran disetujui:
   - `targetUser.token_version = (targetUser.token_version || 1) + 1;`
   - `sessionStore.revokeSessionsForUser(targetUser.id);`
3. Middleware `authMiddleware.ts` memeriksa token pada setiap request:
   ```typescript
   if (
     validation.tokenVersion !== undefined &&
     user.token_version !== undefined &&
     validation.tokenVersion < user.token_version
   ) {
     return res.status(401).json({
       error: 'Session has been invalidated due to privilege or security updates. Please authenticate again.',
       code: 'STALE_TOKEN_VERSION'
     });
   }
   ```
4. Klien yang menggunakan token lama ditolak seketika dengan HTTP 401.

---

## 8. Tahap G — Bukti Verifikasi Pengujian Adversarial (21 Skenario)

Rangkaian uji komprehensif pada `backend/__tests__/secureRoleApprovalMVS_B2_5B3.test.ts` mencakup:

| No | Kategori | Skenario Pengujian | Hasil |
|:---|:---|:---|:---:|
| 1 | Valid Workflow | Admin menyetujui elevasi Student -> Researcher (role & izin diperbarui) | **PASS** |
| 2 | Valid Workflow | Admin menolak permintaan role dengan review_reason yang valid | **PASS** |
| 3 | Input Validation | Penolakan gagal jika review_reason kosong atau < 5 karakter (HTTP 400) | **PASS** |
| 4 | Anti-Self-Review | Peninjau dilarang menyetujui permohonan miliknya sendiri (HTTP 403) | **PASS** |
| 5 | Anti-Self-Review | Peninjau dilarang menolak permohonan miliknya sendiri (HTTP 403) | **PASS** |
| 6 | Risk-Tier Boundary | Admin biasa dilarang menyetujui promosi menjadi Admin (HTTP 403) | **PASS** |
| 7 | Risk-Tier Boundary | Main Administrator dapat menyetujui promosi menjadi Admin | **PASS** |
| 8 | Risk-Tier Boundary | Approval Engine tidak memberikan `is_main_admin` kepada Admin baru | **PASS** |
| 9 | Risk-Tier Boundary | Non-admin (Student/Lecturer/Researcher) dilarang me-review permintaan (HTTP 403) | **PASS** |
| 10 | Status Constraint | Peninjau berstatus SUSPENDED ditolak memproses permintaan (HTTP 403) | **PASS** |
| 11 | Status Constraint | Target berstatus SUSPENDED ditolak dielevasi dan akun tetap SUSPENDED | **PASS** |
| 12 | State Machine | Replay persetujuan pada permintaan yang sudah APPROVED menghasilkan HTTP 409 | **PASS** |
| 13 | State Machine | Percobaan penolakan pada permintaan yang sudah APPROVED menghasilkan HTTP 409 | **PASS** |
| 14 | State Machine | Percobaan persetujuan pada permintaan yang sudah REJECTED menghasilkan HTTP 409 | **PASS** |
| 15 | Concurrency | Dua peninjau memproses permintaan secara bersamaan: eksekusi kedua menerima HTTP 409 | **PASS** |
| 16 | Cancellation | Pemohon asli dapat membatalkan permintaannya sendiri (PENDING -> CANCELLED) | **PASS** |
| 17 | IDOR / BOLA | Pengguna lain dilarang membatalkan permintaan milik orang lain (HTTP 403) | **PASS** |
| 18 | IDOR / BOLA | Pengguna lain dilarang membaca detail permintaan via GET :id (HTTP 403) | **PASS** |
| 19 | Tampering Defense | Payload manipulasi klien (role, is_main_admin, reviewed_by) diabaikan total | **PASS** |
| 20 | Session Invalidation | Token lama pengguna yang dielevasi langsung ditolak (HTTP 401) | **PASS** |
| 21 | Storage Atomicity | Kegagalan disk (simulasi ENOSPC) membatalkan seluruh mutasi memori (HTTP 500) | **PASS** |

### 8.1 Hasil Rangkaian Regresi Penuh
- **Total Test Files**: 46 passed (46 files)
- **Total Tests**: 1.419 passed (1.419 tests)
- **TypeScript Compiler (`tsc --noEmit`)**: 0 error
- **Vite Build**: Succeeded

---

## 9. Keterbatasan Database & Batas Implementasi

1. **Penyimpanan Berbasis Berkas JSON**:
   - `saveToDisk` menggunakan mekanisme penulisan berkas temporer (`.tmp`) dan `fs.renameSync` yang atomik pada level filesystem POSIX lokal tunggal.
   - Belum mendukung transaksi database SQL terdistribusi (*two-phase commit*). Batasan ini didokumentasikan secara transparan.
2. **In-Memory Session Store**:
   - `MemorySessionStore` beroperasi di memori instance tunggal. Pada arsitektur multi-instance (multi-container cluster), pencabutan sesi membutuhkan shared state store (seperti Redis) yang berada di luar cakupan milestone ini.
3. **Non-Claims**:
   - Sistem tidak mengklaim kesiapan produksi sebelum integrasi Google OIDC kriptografis selesai.
   - Core biometrik sains tidak diubah dan tetap murni 100%.

---

## 10. Kesimpulan

Milestone **MVS-B2.5B.3 (Secure Role Approval Engine)** telah diselesaikan dengan standar rekayasa perangkat lunak dan arsitektur keamanan tertinggi. Sistem siap untuk evaluasi dan fase berikutnya.
