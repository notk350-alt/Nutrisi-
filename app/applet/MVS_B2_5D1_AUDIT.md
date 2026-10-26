# NutriBodySim MVS-B2.5D.1 — Laporan Audit & Verifikasi Keamanan
# Unprivileged Registered User & Permission Foundation

---

## 1. Ringkasan Eksekutif & Status Milestone

* **Milestone**: MVS-B2.5D.1 — Unprivileged Registered User & Permission Foundation
* **Mode Operasi**: **IMPLEMENTATION — ISOLATED AUTHORIZATION FOUNDATION**
* **Status**: **PASS / READY FOR EVALUATION**
* **Status Google Login Publik**: **TETAP TIDAK AKTIF (STRICTLY INACTIVE)**
* **Provisioning Akun**: **BELUM DIIMPLEMENTASIKAN**
* **Identity Linking**: **BELUM DIIMPLEMENTASIKAN**
* **Tanggal Penyelesaian**: 20 Oktober 2026
* **Governing Rule Verification**:
  - Runtime Routes Added: **0 public routes added** (`api.ts` tidak membuka rute publik baru).
  - User Sessions Created: **0 sessions created** (fondasi otorisasi terisolasi, tidak ada sesi/cookie diterbitkan).
  - Database Side-Effects: **0 records modified** (`nutribodysim_db.json` tidak bermutasi).
  - External Dependencies Added: **0 dependencies** (menggunakan dependensi internal yang ada).
  - Unit & Adversarial Tests: **26 tes RegisteredUser lulus (100%)**.
  - Total Backend Tests: **15 berkas tes, 362 tes lulus (100%)**.
  - TypeScript Compiler (`tsc --noEmit`): **0 errors (CLEAN)**.
  - Applet Build (`compile_applet`): **SUCCEEDED**.

---

## 2. Resolusi Kesenjangan GAP 1 dari MVS-B2.5D.0

### Latar Belakang Masalah
Pada audit MVS-B2.5D.0, ditemukan bahwa `UserRole` hanya terdiri dari empat role:
`'Student' | 'Lecturer' | 'Researcher' | 'Admin'`.
Role terendah (`Student`) memiliki izin operasional aktif: `['VIEW', 'USE', 'CREATE', 'CLONE']`.
Jika akun baru hasil OIDC otomatis diberi role `Student`, pengguna tersebut dapat langsung membuat proyek, mengeksekusi perhitungan bioenergetika, dan mengkloning model fisiologis tanpa verifikasi administratif atau akademik sebelumnya.

### Solusi yang Diimplementasikan
Fondasi peran unprivileged **`RegisteredUser`** telah dibuat dengan prinsip keamanan *fail-closed* dan *zero-privilege default*:
1. `RegisteredUser` didaftarkan secara eksplisit dalam `VALID_ROLES`.
2. Himpunan default permission `RegisteredUser` ditetapkan sebagai **himpunan kosong (`[]`)**.
3. `RegisteredUser` ditempatkan pada **Rank 0** dalam `ROLE_HIERARCHY`, di bawah `Student` (Rank 1).
4. `RegisteredUser` tidak memiliki izin administratif, tidak memiliki hak persetujuan permohonan role (`RoleRequest`), dan tidak dapat mengakses objek milik pengguna lain.

---

## 3. Berkas yang Diubah & Rincian Perubahan

| Berkas | Jenis Perubahan | Deskripsi & Rationale Keamanan |
| :--- | :--- | :--- |
| `backend/database/types.ts` | Tipe Data | Menambahkan `'RegisteredUser'` ke dalam union `UserRole = 'RegisteredUser' \| 'Student' \| 'Lecturer' \| 'Researcher' \| 'Admin'`. |
| `src/types.ts` | Tipe Data Frontend | Menyelaraskan union `UserRole` di frontend agar mengenali `'RegisteredUser'`. |
| `backend/auth/rbacMiddleware.ts` | RBAC Policy | Menambahkan `'RegisteredUser'` ke array kanonikal `VALID_ROLES`. Menetapkan `ROLE_DEFAULT_PERMISSIONS.RegisteredUser = []` (zero permissions). |
| `backend/auth/roleRequestValidation.ts` | Hierarki Role | Menambahkan `RegisteredUser: 0` ke dalam `ROLE_HIERARCHY`. Memungkinkan RegisteredUser mengajukan permohonan elevasi peran ke Student, Lecturer, Researcher, atau Admin. |
| `backend/database/store.ts` | Mapping Persistensi | Menambahkan `RegisteredUser: []` ke `rolePermissionsMap` di dalam method `approveRoleRequest`. |
| `src/components/dashboard/DashboardView.tsx` | UI Label | Menambahkan `RegisteredUser: 'Pengguna Terdaftar'` ke pemetaan `ROLE_LABELS_ID`. |
| `src/components/layout/Header.tsx` | UI Label | Menambahkan `RegisteredUser: 'Pengguna Terdaftar'` ke pemetaan `ROLE_LABELS_ID`. |
| `backend/__tests__/registeredUserRbacMVS_B2_5D1.test.ts` | Pengujian Keamanan | Berkas pengujian unit dan adversarial baru (26 tes) khusus memvalidasi perilaku RegisteredUser, penolakan izin, dan imunitas tampering. |

---

## 4. Evaluasi Izin Final RegisteredUser & Pembenaran (Permission Rationale)

Himpunan izin default `RegisteredUser`: **`[]` (Himpunan Kosong)**.

| Permission | Status untuk RegisteredUser | Alasan / Pembenaran Keamanan |
| :--- | :--- | :--- |
| `VIEW` | **DITOLAK (DENIED)** | Mencegah pembacaan repositori atau artefak pribadi non-publik sebelum diverifikasi. Artefak publik tetap dapat diakses melalui rute publik tanpa memerlukan permission eksplisit. |
| `USE` | **DITOLAK (DENIED)** | Mencegah eksekusi perhitungan komputasi, simulasi fisiologi, dan sandbox kode yang menggunakan sumber daya server. |
| `CREATE` | **DITOLAK (DENIED)** | Mencegah pembuatan proyek laboratorium, tim, dataset, atau notebook tanpa izin akademik. |
| `CLONE` | **DITOLAK (DENIED)** | Mencegah duplikasi dan pengkloningan model ilmiah berhak cipta. |
| `EDIT` | **DITOLAK (DENIED)** | Mencegah modifikasi dataset, materi, atau catatan penelitian. |
| `DELETE` | **DITOLAK (DENIED)** | Hak destruktif dibatasi secara ketat untuk Administrator. |
| `SHARE` | **DITOLAK (DENIED)** | Mencegah manipulasi keanggotaan proyek dan kolaborasi tim. |
| `PUBLISH` | **DITOLAK (DENIED)** | Mencegah penerbitan materi atau rumus ke dalam registri ilmiah resmi tanpa hak reviewer/dosen/peneliti. |
| `VERIFY` | **DITOLAK (DENIED)** | Hak kurasi ilmiah dan sertifikasi data hanya untuk Administrator. |
| `ADMIN` | **DITOLAK (DENIED)** | Hak administratif operasional hanya untuk Administrator. |
| `MANAGE_PRIVILEGED_ROLES` | **DITOLAK (DENIED)** | Hak tata kelola istimewa mutlak terisolasi pada Main Administrator aktif. |

---

## 5. Matriks Hasil Pengujian (Test Results Matrix)

```
Test Files  15 passed (15)
     Tests  362 passed (362)
  Duration  12.00s

✓ backend/__tests__/registeredUserRbacMVS_B2_5D1.test.ts (26 tests) [NEW]
  ✓ 1. Role Validity & Hierarchy Registration (3 tests)
    ✓ registers RegisteredUser in VALID_ROLES as a canonical valid role
    ✓ assigns RegisteredUser to rank 0 in ROLE_HIERARCHY below Student (1)
    ✓ correctly validates hasRole for RegisteredUser
  ✓ 2. Default Permission Set & Zero-Privilege Guarantee (5 tests)
    ✓ defines an empty default permission set ([]) for RegisteredUser
    ✓ resolves zero effective permissions for RegisteredUser
    ✓ strictly denies all 11 valid permissions to RegisteredUser
    ✓ returns false for hasAllPermissions and hasAnyPermission on RegisteredUser
    ✓ strictly denies MANAGE_PRIVILEGED_ROLES even if explicitly present in user.permissions
  ✓ 3. Inactive Account Containment (2 tests)
    ✓ denies all access when RegisteredUser is SUSPENDED
    ✓ denies all access when RegisteredUser is DISABLED
  ✓ 4. Role Elevation Eligibility & Approval Authority (4 tests)
    ✓ allows RegisteredUser to submit role elevation requests to Student, Lecturer, Researcher, Admin
    ✓ rejects self-demotion or lateral request from RegisteredUser to RegisteredUser
    ✓ strictly prohibits RegisteredUser from approving or reviewing any role requests
    ✓ rejects approval attempt by RegisteredUser in store.approveRoleRequest
  ✓ 5. Object-Level Authorization & Project Isolation (4 tests)
    ✓ denies RegisteredUser access to private projects of other users
    ✓ denies RegisteredUser access to private datasets of other users
    ✓ denies RegisteredUser access to other users role requests
    ✓ allows RegisteredUser to access their own role requests
  ✓ 6. HTTP API Boundary & Parameter Tampering Defense (5 tests)
    ✓ returns HTTP 403 when RegisteredUser attempts to CREATE a project (/api/projects)
    ✓ returns HTTP 403 when RegisteredUser attempts physiological calculation (/api/calculations/execute)
    ✓ returns HTTP 403 when RegisteredUser attempts to access audit logs (/api/audit)
    ✓ returns HTTP 403 when RegisteredUser attempts privileged governance (/api/governance/manage-roles)
    ✓ rejects parameter tampering when RegisteredUser sends role or permissions in request body
  ✓ 7. Regression Invariance across Existing Roles (3 tests)
    ✓ maintains exact Student permissions (VIEW, USE, CREATE, CLONE)
    ✓ maintains exact Researcher and Lecturer permissions
    ✓ maintains exact Admin permissions without MANAGE_PRIVILEGED_ROLES
```

---

## 6. Audit Dampak Kompatibilitas Lintas Sistem

1. **API Endpoints**:
   - Seluruh rute API yang dilindungi `requirePermission` atau `requireRole` menolak akses pengguna ber-role `RegisteredUser` dengan HTTP 403 Forbidden.
   - Parameter tampering pada request body (seperti menyisipkan `role: 'Admin'` atau `permissions: ['ADMIN']`) tidak mempengaruhi role tepercaya pada server.
2. **Object Authorization**:
   - `canAccessProject`, `canAccessDataset`, dan `canAccessRoleRequest` mempertahankan isolasi total: `RegisteredUser` hanya dapat mengakses entitas yang dibuat oleh dirinya sendiri dan ditolak mutlak dari proyek pribadi milik orang lain.
3. **Role Approval Workflow**:
   - `RegisteredUser` dapat mengajukan permohonan menjadi `Student` melalui endpoint `/api/role-requests`.
   - `RegisteredUser` ditolak mutlak dari memproses persetujuan (`/api/role-requests/:id/approve` melempar HTTP 403).
4. **Database & Seeding**:
   - Data seeding statis (`users` fixture) tidak diubah.
   - Database disk `nutribodysim_db.json` tidak mengalami modifikasi.
5. **Main Administrator Bootstrap**:
   - CLI bootstrap `executeBootstrapMainAdmin` tetap tidak terpengaruh dan hanya dapat dijalankan melalui interface operator server.

---

## 7. Risiko Tersisa & Dependensi Milestone Selanjutnya

1. **Penyimpanan Transaksional Akun Baru (GAP 2 dari D.0)**:
   - Meskipun role `RegisteredUser` telah terdefinisi dan aman, sistem belum memiliki metode penyimpanan `db.createUser` yang transaksional dengan rollback otomatis dan perlindungan race-condition.
   - Mitigasi: Diimplementasikan pada milestone **MVS-B2.5D.2**.
2. **Keterbatasan Database JSON (GAP 4 dari D.0)**:
   - File JSON `nutribodysim_db.json` belum mendukung locking lintas proses. Untuk lingkungan multi-instance produksi, migrasi ke Cloud SQL / PostgreSQL tetap direkomendasikan.

---

## 8. Kesimpulan & Stop Condition

Milestone **MVS-B2.5D.1** telah selesai 100% dengan status **PASS**:
- Fondasi peran `RegisteredUser` telah terpasang dengan himpunan izin kosong (`[]`).
- Seluruh 362 tes regresi lulus tanpa kesalahan.
- Tidak ada alur provisioning publik atau Google Login yang diaktifkan.
- Sistem berhenti dan menunggu evaluasi pengguna sebelum melanjutkan ke implementasi provisioning pada MVS-B2.5D.2.
