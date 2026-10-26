# NutriBodySim MVS-B2.5B.1 — RBAC Hardening & Privilege Boundary Enforcement Audit Report

---

## Kontrol Dokumen & Meta

* **Proyek**: NutriBodySim (Laboratorium Riset Komputasi Nutrisi & Pemodelan Fisiologi)
* **Milestone**: MVS-B2.5B.1 (Master Validation System Phase B2.5B.1)
* **Judul**: RBAC Hardening, Wildcard Bypass Elimination & Privilege Boundary Enforcement Audit
* **Status**: **VERIFIED PASS (IMPLEMENTASI & VERIFIKASI SELESAI)**
* **Tanggal**: 16 Oktober 2026
* **Penulis**: Principal Security Architect & Senior Software Engineer
* **Dokumen Acuan**:
  - `MVS_B2_5B_SPECIFICATION.md` (Spesifikasi Approval Engine & Governance)
  - `MVS_B2_5A1_AUDIT.md` (Laporan Verifikasi Penetratif MVS-B2.5A.1)
  - `backend/auth/rbacMiddleware.ts` (Implementasi RBAC yang telah diperkeras)
  - `backend/auth/objectAuth.ts` (Otorisasi Level Objek)
  - `backend/__tests__/rbacHardeningMVS_B2_5B1.test.ts` (Suite Pengujian 24 Skenario)
* **Status Produksi Keseluruhan**: **NOT READY FOR PRODUCTION** (Sesuai governance gate MVS-B2.5B, komponen Main Administrator Governance, Approval Engine, dan Google OIDC masih menunggu implementasi tahap berikutnya).

---

## 1. Eksekutif Ringkasan

Sesuai arahan audit arsitektur pada spesifikasi `MVS_B2_5B_SPECIFICATION.md` (temuan **SEC-RBAC-01**), implementasi RBAC awal NutriBodySim memiliki kerentanan struktural berupa **universal wildcard bypass** pada fungsi `hasPermission()`, di mana setiap pengguna dengan `user.role === 'Admin'` secara implisit dan otomatis memperoleh seluruh permission apa pun tanpa enumerasi eksplisit.

Pada tahap **MVS-B2.5B.1**, seluruh privilege implisit wildcard telah **dihapuskan sepenuhnya**. Setiap otorisasi kini diatur secara deterministik oleh matriks izin tertutup (*closed-set permission matrix*), penolakan izin dan role tak dikenal secara *default-deny*, pemisahan mutlak hak istimewa tata kelola (`MANAGE_PRIVILEGED_ROLES`), pencabutan instan seluruh izin untuk akun non-aktif/ditangguhkan (`SUSPENDED`/`DISABLED`), serta penegakan integritas otorisasi level objek (BOLA/IDOR defense) yang kebal terhadap manipulasi parameter klien.

Seluruh 24 pengujian skenario pengetatan RBAC pada `rbacHardeningMVS_B2_5B1.test.ts` dan seluruh 44 berkas rangkaian regresi sistem (1.376 pengujian) telah dinyatakan **LULUS 100% (PASS)** tanpa ada degradasi fungsionalitas komputasi sains.

---

## 2. Tahap A — Audit Kode Aktual Baseline (Sebelum Perubahan)

### 2.1 Analisis Bukti Kode Sumber Sebelum Perbaikan
Pada berkas asli `backend/auth/rbacMiddleware.ts` (baris 46–55):
```typescript
// SEBELUM PERBAIKAN (VULNERABLE WILDCARD BYPASS)
export function hasPermission(user: User, permission: Permission): boolean {
  if (user.role === 'Admin' || (user.permissions && user.permissions.includes('ADMIN'))) {
    return true; // <-- KERENTANAN KRITIS: Wildcard bypass instan untuk Admin!
  }
  const effective = getEffectivePermissions(user);
  return effective.has(permission);
}
```

### 2.2 Dampak Keamanan & Vektor Serangan Baseline
1. **Universal Permission Inheritance**: Jika izin baru atau izin tata kelola istimewa didefinisikan (misalnya `MANAGE_PRIVILEGED_ROLES`, `GRANT_ROOT`, atau izin modifikasi audit), Admin biasa secara otomatis memilikinya tanpa evaluasi kelayakan.
2. **Ketiadaan Validasi Set Izin Tertutup**: Jika sebuah parameter izin fiktif dikirimkan (misalnya `'SUPER_USER'` atau `'ARBITRARY_PERMISSION'`), fungsi `hasPermission` tetap mengembalikan `true` bagi Admin.
3. **Akun Ditangguhkan Tetap Berdaya**: Jika akun Admin ditandai sebagai `SUSPENDED` atau `DISABLED` di database, `user.role === 'Admin'` tetap mengevaluasi ke `true` jika pemeriksaan status akun terlewat di tingkat middleware.
4. **Manipulasi Parameter Klien**: Klien yang mencoba mengirimkan atribut `role: "Admin"` atau array `permissions` fiktif berpotensi mengeksploitasi celah otorisasi jika tidak divalidasi dari sesi terverifikasi server.

---

## 3. Tahap B — Implementasi Penghapusan Wildcard & Pengetatan Boundary

Perubahan arsitektur berikut telah diterapkan pada `backend/auth/rbacMiddleware.ts`:

### 3.1 Closed-Set Permitted Enums & Validations
Didefinisikan daftar izin dan role yang valid secara kanonikal:
```typescript
export const VALID_PERMISSIONS: readonly Permission[] = [
  'VIEW',
  'USE',
  'CREATE',
  'CLONE',
  'EDIT',
  'DELETE',
  'SHARE',
  'PUBLISH',
  'VERIFY',
  'ADMIN',
  'MANAGE_PRIVILEGED_ROLES'
] as const;

export const VALID_ROLES: readonly UserRole[] = [
  'Student',
  'Lecturer',
  'Researcher',
  'Admin'
] as const;
```

### 3.2 Matriks Hak Akses Default Eksplisit (Tanpa Wildcard)
Hak akses role Admin kini dibatasi hanya pada 10 izin operasional yang ditentukan secara definitif. Izin istimewa `MANAGE_PRIVILEGED_ROLES` **TIDAK DIBERIKAN** kepada Admin:
```typescript
export const ROLE_DEFAULT_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  Student: ['VIEW', 'USE', 'CREATE', 'CLONE'],
  Lecturer: ['VIEW', 'USE', 'CREATE', 'CLONE', 'EDIT', 'SHARE', 'PUBLISH'],
  Researcher: ['VIEW', 'USE', 'CREATE', 'CLONE', 'EDIT', 'SHARE', 'PUBLISH'],
  Admin: ['VIEW', 'USE', 'CREATE', 'CLONE', 'EDIT', 'DELETE', 'SHARE', 'PUBLISH', 'VERIFY', 'ADMIN']
};
```

### 3.3 Pengetatan `getEffectivePermissions` & Isolasi Privileged Governance
Fungsi `getEffectivePermissions(user: User)` menerapkan aturan:
1. Role tidak dikenal atau data rusak -> mengembalikan `Set` kosong (0 permission).
2. Status akun tidak `ACTIVE` (`SUSPENDED` atau `DISABLED`) -> mengembalikan `Set` kosong (0 permission).
3. Hanya izin yang ada di `VALID_PERMISSIONS` yang dapat ditambahkan.
4. Izin `MANAGE_PRIVILEGED_ROLES` **tidak dapat diperoleh** melalui array `user.permissions` kecuali pengguna telah terverifikasi secara server-side memegang otoritas tata kelola (`user.is_main_admin === true && user.role === 'Admin'`).

### 3.4 Penghapusan Total Wildcard pada `hasPermission`
```typescript
export function hasPermission(user: User, permission: Permission): boolean {
  if (!user || !user.role || typeof permission !== 'string') {
    return false;
  }
  if (!VALID_PERMISSIONS.includes(permission as Permission)) {
    return false; // Default deny untuk permission tak dikenal
  }
  if (!VALID_ROLES.includes(user.role)) {
    return false; // Default deny untuk role tak dikenal / rusak
  }
  if (user.account_status && user.account_status !== 'ACTIVE') {
    return false; // Default deny untuk akun suspended/disabled
  }

  const effective = getEffectivePermissions(user);
  return effective.has(permission as Permission);
}
```

### 3.5 Middleware Baru: `requirePrivilegedRole()` & Fail-Closed Guarantee
Dibuat middleware `requirePrivilegedRole()` untuk melindungi rute tata kelola tingkat tinggi:
```typescript
export function requirePrivilegedRole(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required.', code: 'UNAUTHORIZED' });
    }
    if (req.user.account_status && req.user.account_status !== 'ACTIVE') {
      return res.status(403).json({ code: 'FORBIDDEN_ACCOUNT_STATUS', account_status: req.user.account_status });
    }
    if (!hasPermission(req.user, 'MANAGE_PRIVILEGED_ROLES')) {
      return res.status(403).json({
        error: 'Forbidden: Main Administrator privilege required (MANAGE_PRIVILEGED_ROLES).',
        code: 'FORBIDDEN_PRIVILEGED_ROLE',
        required_permission: 'MANAGE_PRIVILEGED_ROLES',
        user_role: req.user.role
      });
    }
    return next();
  };
}
```

---

## 4. Tahap C — Preservasi Otorisasi Tingkat Objek (BOLA/IDOR Defense)

Pengetatan RBAC tidak melonggarkan otorisasi level objek di `backend/auth/objectAuth.ts`:

1. **Akun Non-Aktif Diblokir pada Seluruh Objek**:
   Semua fungsi validator objek (`canAccessProject`, `canAccessDataset`, `canAccessNotebook`, `canAccessRoleRequest`) memeriksa status akun pada baris pertama:
   ```typescript
   if (user.account_status && user.account_status !== 'ACTIVE') {
     return {
       allowed: false,
       reason: `Account is ${user.account_status}. Access to resource is forbidden.`
     };
   }
   ```
2. **Isolasi Kepemilikan Objek**:
   - Pengguna biasa (`Student`, `Researcher`, `Lecturer`) tidak dapat membaca atau memodifikasi objek milik pengguna lain meskipun memiliki permission global (seperti `EDIT` atau `VIEW`), kecuali objek tersebut bersifat publik atau pengguna terdaftar sebagai anggota tim/proyek.
   - Mengganti ID pada parameter URL, query, atau body request menghasilkan penolakan `HTTP 403 OBJECT_ACCESS_DENIED`.
3. **Pencatatan Audit Pelanggaran Otorisasi**:
   Setiap kegagalan otorisasi objek dan penolakan permission dicatat ke dalam audit log sistem melalui `db.logAudit()` dengan kategori `SECURITY_RBAC` dan `SECURITY_BOLA`.

---

## 5. Tahap D — Verifikasi dan Rincian Hasil Pengujian

Suite pengujian khusus `backend/__tests__/rbacHardeningMVS_B2_5B1.test.ts` memuat 24 skenario pengujian komprehensif yang memvalidasi setiap aspek pengetatan:

| No | Kategori | Skenario Pengujian | Hasil |
| :---: | :--- | :--- | :---: |
| 1 | **Wildcard Elimination** | Admin tidak otomatis memperoleh izin fiktif/tak dikenal (`ARBITRARY_PERMISSION`, `SUPER_ROOT_PRIVILEGE`, `EXECUTE_UNCONSTRAINED`) | **PASS** |
| 2 | **Wildcard Elimination** | Admin tidak otomatis mewarisi `MANAGE_PRIVILEGED_ROLES` | **PASS** |
| 3 | **Enumerated Matrix** | Admin hanya memiliki 10 izin operasional eksplisit terdaftar di `ROLE_DEFAULT_PERMISSIONS` | **PASS** |
| 4 | **Default Deny** | Permission tak dikenal ditolak secara default untuk seluruh role (`ROOT`, `BYPASS_ALL`, dll.) | **PASS** |
| 5 | **Corrupted Role Defense** | Role tak dikenal atau rusak (`SuperAdmin`) ditolak dengan 0 permissions | **PASS** |
| 6 | **Account Status** | Akun Admin berstatus `SUSPENDED` kehilangan seluruh permissions (`hasPermission` & `hasRole` = false) | **PASS** |
| 7 | **Account Status** | Akun Researcher berstatus `DISABLED` kehilangan seluruh permissions | **PASS** |
| 8 | **Spoofing Defense** | Student tidak dapat memperoleh `MANAGE_PRIVILEGED_ROLES` via injeksi atribut `user.permissions` | **PASS** |
| 9 | **Spoofing Defense** | Regular Admin tidak dapat memperoleh `MANAGE_PRIVILEGED_ROLES` via injeksi atribut `user.permissions` tanpa verifikasi otoritas | **PASS** |
| 10 | **Spoofing Defense** | Non-Admin tidak dapat memperoleh `MANAGE_PRIVILEGED_ROLES` meskipun memanipulasi flag `is_main_admin: true` | **PASS** |
| 11 | **Route Enforcement** | Regular Admin ditolak secara tegas dari rute ber-permission `MANAGE_PRIVILEGED_ROLES` (HTTP 403 `FORBIDDEN_PRIVILEGED_ROLE`) | **PASS** |
| 12 | **Route Enforcement** | Student & Researcher diblokir dari endpoint `MANAGE_PRIVILEGED_ROLES` | **PASS** |
| 13 | **Operational Integrity** | Regular Admin tetap dapat mengakses rute administratif rutin (`GET /api/audit`) | **PASS** |
| 14 | **Operational Integrity** | Regular Admin tetap dapat membaca daftar permohonan role (`GET /api/role-requests`) | **PASS** |
| 15 | **Privilege Separation** | Student diblokir dari melihat seluruh permohonan role sistem (HTTP 403 `FORBIDDEN`) | **PASS** |
| 16 | **Parameter Tampering** | Manipulasi body request (`role: Admin`, `user_id: usr_admin`, `is_main_admin: true`) diabaikan; kepemilikan proyek tetap terikat pada token sesi terverifikasi | **PASS** |
| 17 | **Account Status** | Admin dengan akun `SUSPENDED` diblokir dari rute administratif dengan HTTP 403 `FORBIDDEN_ACCOUNT_STATUS` | **PASS** |
| 18 | **BOLA Defense** | Student tidak dapat mengakses proyek privat milik Researcher (HTTP 403) | **PASS** |
| 19 | **BOLA Defense** | Akun `SUSPENDED` tidak dapat mengakses proyek miliknya sendiri | **PASS** |
| 20 | **BOLA Defense** | Akun `SUSPENDED` tidak dapat mengakses dataset miliknya sendiri | **PASS** |
| 21 | **BOLA Defense** | Akun `SUSPENDED` tidak dapat mengakses notebook miliknya sendiri | **PASS** |
| 22 | **BOLA Defense** | Admin `SUSPENDED` tidak dapat membaca permohonan role pengguna lain via admin override | **PASS** |
| 23 | **Admin Override** | Admin aktif dapat menginspeksi permohonan role pengguna lain dengan flag audit `isAdminOverride: true` | **PASS** |
| 24 | **BOLA Defense** | Student yang mencoba melihat permohonan role milik student lain ditolak dengan pelanggaran BOLA | **PASS** |

### 5.1 Hasil Rangkaian Regresi Keseluruhan (Full Regression Suite)
* **Total Berkas Tes**: 44 files
* **Total Kasus Uji**: 1.376 tests
* **Status**: **1.376 PASSED (100% Lulus, 0 Gagal)**
* **Waktu Eksekusi**: ~23 detik
* **Status Linter (`npm run lint` / `tsc --noEmit`)**: **PASS (0 Errors)**
* **Status Kompilasi (`npm run build`)**: **PASS (Build Succeeded)**

---

## 6. Status Kesiapan & Langkah Selanjutnya

| Temuan / Milestone | Status Aktual | Catatan |
| :--- | :---: | :--- |
| **SEC-RBAC-01** (Wildcard Bypass) | **RESOLVED** | Wildcard bypass telah dihapus total; seluruh permission terenumerasi eksplisit. |
| **FINDING-A5** (Main Administrator Bootstrap) | **BLOCKED** | Masih menunggu implementasi skrip bootstrap lokal yang aman sesuai `MVS_B2_5B_SPECIFICATION.md`. |
| **Approval Engine** (`/approve`, `/reject`) | **BLOCKED** | Menunggu implementasi state machine transaksional dan token versioning. |
| **Google OIDC / OAuth 2.0** | **BLOCKED** | Belum diimplementasikan (sesuai tata kelola penundaan hingga tahap foundation selesai). |
| **Status Produksi Keseluruhan** | **NOT READY** | Sistem aman pada boundary yang terpasang, namun belum siap untuk rilis produksi publik. |

---

## 7. Kesimpulan

Tahap **MVS-B2.5B.1 (RBAC Hardening & Privilege Boundary Enforcement)** telah **berhasil diselesaikan dan diverifikasi penuh**. Celah keamanan *universal wildcard Admin bypass* telah dieliminasi dari arsitektur NutriBodySim, memastikan tidak ada eskalasi hak istimewa secara implisit, isolasi penuh terhadap izin tata kelola, perlindungan akun yang ditangguhkan, dan kebal terhadap serangan manipulasi parameter klien.
