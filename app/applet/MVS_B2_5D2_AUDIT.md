# NutriBodySim MVS-B2.5D.2 — Laporan Audit & Verifikasi Keamanan
# Transactional Account Provisioning & External Identity Mapping

---

## 1. Ringkasan Eksekutif & Status Milestone

* **Milestone**: MVS-B2.5D.2 — Transactional Account Provisioning & External Identity Mapping
* **Mode Operasi**: **IMPLEMENTATION — ISOLATED DATABASE SERVICE**
* **Status**: **PASS / READY FOR EVALUATION**
* **Status Google Login Publik**: **TETAP TIDAK AKTIF (STRICTLY INACTIVE)**
* **Public Routes Added**: **0 routes** (`api.ts` tidak dimodifikasi).
* **Session & Cookie Creation**: **DI LUAR CAKUPAN / 0 SESSIONS CREATED** (hanya memetakan identitas ke user, tanpa menerbitkan token sesi atau cookie).
* **Tanggal Penyelesaian**: 20 Oktober 2026
* **Governing Rule Verification**:
  - Runtime Routes Added: **0 routes**.
  - User Sessions Created: **0 sessions**.
  - Database Side-Effects: **0 records modified in baseline seed data** (pengujian terisolasi penuh dengan rollback/reseed).
  - External Dependencies Added: **0 dependencies** (menggunakan modul dan dependensi internal yang ada).
  - Unit & Adversarial Tests: **14 tes Provisioning lulus (100%)**.
  - Total Backend Tests: **16 berkas tes, 376 tes lulus (100%)**.
  - TypeScript Compiler (`tsc --noEmit`): **0 errors (CLEAN)**.
  - Applet Build (`compile_applet`): **SUCCEEDED**.

---

## 2. Kontrak Layanan & Pemisahan Hasil (Service Contract & Outcomes)

Layanan provisioning internal diimplementasikan melalui kelas `GoogleIdentityProvisioningService` dan fungsi `provisionVerifiedGoogleIdentity` pada `backend/auth/oidc/provisioner.ts`.

### 2.1 Tipe Hasil (Outcomes Enum)
Sesuai rancangan pada MVS-B2.5D.0, layanan membedakan 6 hasil secara tegas:

```typescript
export type IdentityProvisioningOutcome =
  | 'EXISTING_LINKED_ACCOUNT'      // Google sub telah terhubung ke akun lokal aktif
  | 'PROVISIONED_NEW_ACCOUNT'      // Akun baru RegisteredUser berhasil dibuat bersama ExternalIdentity
  | 'IDENTITY_CONFLICT'           // Email cocok dengan akun lokal (Anti-Auto-Merge) atau relasi dangling
  | 'ACCOUNT_INACTIVE'             // Akun terhubung berstatus SUSPENDED atau DISABLED
  | 'PROVISIONING_STORAGE_FAILURE' // Kegagalan penyimpanan disk fisik / rollback dieksekusi
  | 'INVALID_VERIFIED_IDENTITY';   // Input tidak memenuhi kontrak VerifiedOIDCIdentity
```

### 2.2 Penegakan Batas Keamanan Zero-Credential & Sesi
1. **Zero Credential Exposure**:
   Objek hasil (`ProvisionGoogleIdentityResult`) **DILARANG DAN TIDAK PERNAH** memuat atau mengembalikan ID Token mentah, Google Access/Refresh Token, Client Secret, OIDC `nonce`, atau PKCE `code_verifier`.
2. **Session Boundary**:
   Layanan ini murni merupakan *Identity Resolution and Provisioning Engine*. Layanan **TIDAK PERNAH** memanggil `sessionStore.createSession`, tidak menghasilkan Bearer token, dan tidak menyetel header `Set-Cookie`. Penerbitan sesi tetap menjadi tanggung jawab otentikasi lapisan atas pada controller masa depan.

---

## 3. Berkas yang Diubah & Rincian Implementasi

| Berkas | Jenis Perubahan | Deskripsi & Rationale Keamanan |
| :--- | :--- | :--- |
| `backend/database/types.ts` | Skema Tipe | Memperluas union `AuditLog['action']` dengan 5 aksi OIDC: `'OIDC_ACCOUNT_PROVISION'`, `'OIDC_IDENTITY_CONFLICT'`, `'OIDC_INACTIVE_ACCESS_ATTEMPT'`, `'OIDC_STORAGE_FAILURE'`, dan `'OIDC_CLAIM_ANOMALY'`. |
| `backend/auth/oidc/types.ts` | Kontrak Tipe | Mendefinisikan `IdentityProvisioningOutcome`, `ProvisionGoogleIdentityOptions`, dan `ProvisionGoogleIdentityResult`. |
| `backend/database/store.ts` | Engine Database | Menambahkan method `getUserById(userId)`, `getUserByEmail(email)`, dan method transaksional `provisionGoogleUser(params)`. Mengimplementasikan pembuatan entitas `User` (role: `RegisteredUser`, status: `ACTIVE`, permissions: `[]`), `ExternalIdentity`, dan `AuditLog` dengan snapshot rollback jika `saveToDisk` melempar error. |
| `backend/auth/oidc/provisioner.ts` | Service Terisolasi | Mengimplementasikan `GoogleIdentityProvisioningService` dengan mutex berbasis keyed-promise (`sub:<id>` dan `email:<email>`), validasi kontrak identitas ketat, penegakan anti-auto-merge, pemeriksaan status akun (`SUSPENDED`/`DISABLED`), sanitasi profil, dan pencatatan audit. |
| `backend/auth/oidc/index.ts` | Barrel Export | Mengekspor modul `provisioner.ts` ke dalam barrel OIDC. |
| `backend/__tests__/oidcAccountProvisioningMVS_B2_5D2.test.ts` | Pengujian Keamanan | 14 tes adversarial komprehensif menguji alur provisioning pertama kali, idempotensi sekuensial, race-condition konkurensi paralel (`Promise.all`), penolakan auto-merge, containment akun nonaktif, input malformed, rollback kegagalan storage I/O, imunitas privilese, dan zero-credential. |

---

## 4. Analisis Kebijakan Identitas & Pertahanan Keamanan

### 4.1 Anti-Auto-Merge Policy (Perlindungan Account Takeover)
* **Kondisi**: Google `sub` belum dikenal, tetapi alamat email cocok dengan akun lokal NutriBodySim yang sudah ada.
* **Perilaku Sistem**: **FAILS CLOSED**. Sistem mengembalikan `outcome: 'IDENTITY_CONFLICT'` dan melempar pesan aman:
  *"Identity conflict: Email matches an existing local account. Auto-merge is strictly prohibited. Explicit account linking required."*
* **Efek Basis Data**: **NOL**. Tidak ada akun baru yang dibuat, dan identitas Google **TIDAK DITAUTKAN** ke akun lokal tersebut.
* **Audit**: Sistem mencatat `OIDC_IDENTITY_CONFLICT` yang mendokumentasikan user lokal target dan upaya login eksternal.

### 4.2 Least-Privilege Role Assignment (RegisteredUser)
* Akun baru yang diprovisioning otomatis melalui Google OIDC selalu dan hanya memperoleh role **`RegisteredUser`**.
* Seluruh hak operasional (`VIEW`, `USE`, `CREATE`, `CLONE`, `EDIT`, `DELETE`, `SHARE`, `PUBLISH`, `VERIFY`) dan hak administratif (`ADMIN`, `MANAGE_PRIVILEGED_ROLES`) bernilai **`false`**.
* Domain email institusi (seperti `@alumni.stanford.edu`) tidak pernah digunakan untuk menyimpulkan role atau memberikan elevasi peran secara otomatis.

### 4.3 Sanitasi Data Profil
* Nama profil diambil dari klaim Google dan disanitasi: menghapus tag HTML/skrip (`<script>`), membuang karakter kontrol biner, memotong whitespace, dan dibatasi maksimal 100 karakter.
* Avatar URL divalidasi protokolnya (hanya mengizinkan `https://`) dan dibatasi maksimal 500 karakter.

---

## 5. Analisis Transaksionalitas, Idempotensi & Batasan Konkurensi

### 5.1 Jaminan Atomisitas & Rollback Single-Process
* Mutasi memori pada `this.state.users`, `this.state.external_identities`, dan `this.state.audit_logs` dibungkus dalam blok `try-catch` di sekitar pemanggilan `saveToDisk(this.state)`.
* Jika proses penulisan file fisik atau serialisasi gagal (misalnya error I/O `EACCES` atau disk full), blok `catch` secara deterministik menghapus user yang baru ditambahkan, menghapus external identity yang baru dibuat, dan menghapus record audit sementara dari memori.
* Hal ini menjamin tidak ada record yatim (*orphan user* tanpa identitas eksternal, atau sebaliknya) yang tertinggal di memori.

### 5.2 Jaminan Konkurensi Single-Process (Keyed Async Lock)
* Di dalam satu proses Node.js, `GoogleIdentityProvisioningService` mengimplementasikan keyed mutex berbasis `sub` dan `email`.
* Jika beberapa request asinkron masuk bersamaan (`Promise.all`) untuk Google sub atau email yang sama, request tersebut diserialisasi secara ketat.
* Request pertama memenangkan lock dan mem-provisioning akun baru.
* Request kedua yang menunggu di antrian lock akan langsung mendeteksi bahwa akun telah dibuat pada pembacaan berikutnya dan secara aman mengembalikan `EXISTING_LINKED_ACCOUNT` tanpa membuat duplikasi entitas.

### 5.3 Keterbatasan Lintas-Proses / Multi-Instance (Jujur & Terdokumentasi)
* **Kondisi Aktual**: Basis data NutriBodySim saat ini berbasis file JSON lokal (`nutribodysim_db.json`).
* **Batasan Multi-Instance**: Sistem file lokal tidak memiliki lock lintas kontainer (*cross-process advisory lock*). Jika aplikasi dideploy ke lingkungan *horizontal scale* (multiple container/pod tanpa shared state), dua proses yang berjalan di pod berbeda tidak berbagi memori mutex in-memory.
* **Status Tata Kelola**:
  - Untuk **Single-Process / Standalone Instance** (kondisi applet saat ini): **AMAN DAN TERUJI 100%**.
  - Untuk **Multi-Instance Cloud Deployment**: **BLOCKED** sampai repositori dimigrasikan ke database relasional ACID (seperti Cloud SQL PostgreSQL) yang mendukung transaksi tingkat baris (*row-level locking / unique constraints*).

---

## 6. Matriks Hasil Pengujian (Test Results Matrix)

```
Test Files  16 passed (16)
     Tests  376 passed (376)
  Duration  11.17s

✓ backend/__tests__/oidcAccountProvisioningMVS_B2_5D2.test.ts (14 tests) [NEW]
  ✓ 1. First-Time Account Provisioning (3 tests)
    ✓ provisions a new unprivileged RegisteredUser account with zero default permissions
    ✓ does NOT grant Student, Lecturer, Researcher, or Admin role based on institution domain
    ✓ records an immutable audit trail with action OIDC_ACCOUNT_PROVISION
  ✓ 2. Idempotency & Concurrency Safety (2 tests)
    ✓ resolves consecutive calls with the same Google sub to EXISTING_LINKED_ACCOUNT
    ✓ serializes simultaneous concurrent requests (Promise.all) and produces exactly one user account
  ✓ 3. Anti-Auto-Merge Policy & Email Collision (1 test)
    ✓ strictly fails closed with IDENTITY_CONFLICT when Google sub is new but email matches existing local user
  ✓ 4. Inactive Account Containment (2 tests)
    ✓ yields ACCOUNT_INACTIVE when existing linked account is SUSPENDED
    ✓ yields ACCOUNT_INACTIVE when existing linked account is DISABLED
  ✓ 5. Malformed & Unverified Identity Handling (3 tests)
    ✓ rejects identity when emailVerified is false or missing
    ✓ rejects identity with missing or empty sub
    ✓ rejects identity with non-google provider
  ✓ 6. Storage Failure & Transactional Atomic Rollback (1 test)
    ✓ completely rolls back in-memory mutations if saveToDisk throws an error
  ✓ 7. Security Invariance & Zero-Credential Exposure (2 tests)
    ✓ never creates user sessions, cookies, or exposes tokens in returned results
    ✓ cannot elevate to Main Administrator or Admin through provisioning
```

---

## 7. Status Pengujian Regresi Keseluruhan

Seluruh 16 berkas pengujian backend lulus 100%:
1. `objectAuthorizationMVS_B2_4.test.ts`: 33 passed
2. `adversarialRemediationMVS_B2_4B.test.ts`: 32 passed
3. `secureRoleApprovalMVS_B2_5B3.test.ts`: 21 passed
4. `oidcTokenVerifierMVS_B2_5C2.test.ts`: 28 passed
5. `identityRoleRequestMVS_B2_5A.test.ts`: 26 passed
6. `sessionConsistencyMVS_B2_5B4.test.ts`: 16 passed
7. `adversarialVerificationMVS_B2_5A1.test.ts`: 26 passed
8. `rbacPermissionMVS_B2_3.test.ts`: 30 passed
9. `oidcTokenExchangeMVS_B2_5C3.test.ts`: 16 passed
10. `oidcOrchestrationMVS_B2_5C4.test.ts`: 14 passed
11. `mainAdminBootstrapMVS_B2_5B2.test.ts`: 22 passed
12. `rbacHardeningMVS_B2_5B1.test.ts`: 24 passed
13. `oidcPrimitivesTransactionMVS_B2_5C1.test.ts`: 30 passed
14. `authSessionMVS_B2.test.ts`: 18 passed
15. `registeredUserRbacMVS_B2_5D1.test.ts`: 26 passed
16. `oidcAccountProvisioningMVS_B2_5D2.test.ts`: 14 passed
*Total Tests*: **376 passed (100%)**.

---

## 8. Kesimpulan & Stop Condition

Milestone **MVS-B2.5D.2** telah selesai 100% dengan status **PASS**:
- Layanan pemetaan identitas dan provisioning transaksional telah terpasang di sisi backend internal.
- Kebijakan *anti-auto-merge*, *least-privilege RegisteredUser*, dan penanganan *fail-closed* terbukti lulus seluruh uji adversarial.
- Google Login tetap **TIDAK AKTIF** secara publik, tidak ada endpoint publik baru, dan tidak ada sesi/cookie yang dibuat.
- Sistem berhenti dan menunggu evaluasi pengguna sebelum melanjutkan ke milestone berikutnya.
