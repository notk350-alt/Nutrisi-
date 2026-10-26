# NutriBodySim MVS-B2.5D.0 — Google Identity Mapping & Account Provisioning Specification
# Master Validation System Phase B2.5D.0 — Security Architecture & Identity Policy

---

## Kontrol Dokumen & Meta

* **Proyek**: NutriBodySim (Sistem Simulasi & Laboratorium Komputasi Nutrisi dan Fisiologi)
* **Milestone**: MVS-B2.5D.0 (Master Validation System Phase B2.5D.0)
* **Judul**: Spesifikasi Keamanan Pemetaan Identitas Google OIDC, Kebijakan Provisioning Akun Lokal, Mitigasi Konflik Email, Tata Kelola RBAC & Audit Trail
* **Mode Operasional**: **SPECIFICATION / SECURITY AUDIT ONLY — NO RUNTIME CODE CHANGES**
* **Tanggal Penyusunan**: 18 Oktober 2026
* **Status**: **APPROVED ARCHITECTURAL SPECIFICATION**
* **Status Google Login Publik**: **TETAP TIDAK AKTIF (STRICTLY INACTIVE)**
* **Governing Rule**:
  > *Milestone MVS-B2.5D.0 berstatus SPECIFICATION ONLY. Seluruh kode backend aktif, model data, route API, konfigurasi runtime, dan pengujian yang sudah ada DILARANG DIUBAH pada tahap ini. Dokumen ini mendefinisikan cetak biru arsitektur dan kebijakan keamanan untuk memetakan `VerifiedOIDCIdentity` (hasil C.2–C.4) ke akun lokal NutriBodySim sebelum implementasi pada MVS-B2.5D.1.*

---

## 1. Ringkasan Eksekutif & Batasan Ruang Lingkup

### 1.1 Latar Belakang & Posisi Milestone
Pada milestone sebelumnya (MVS-B2.5C.1 sampai MVS-B2.5C.4), NutriBodySim telah berhasil membangun dan memverifikasi modul OIDC server-side yang terisolasi secara kriptografis:
1. **C.1**: Primitif kriptografis PKCE S256, Anti-CSRF state token, nonce token, dan penyimpanan transaksi in-memory atomik berbatas TTL.
2. **C.2**: Engine verifikasi Google ID Token dengan validasi tanda tangan RS256 via Google JWKS, penegakan audience, issuer, clock skew, nonce, dan verifikasi email.
3. **C.3**: Handler pertukaran authorization code dengan PKCE verifier dan konsumsi transaksi single-use atomik.
4. **C.4**: Orkestrator alur login dan boundary validasi callback yang mengembalikan objek `VerifiedOIDCIdentity` murni kepada pemanggil internal tepercaya.

Milestone **MVS-B2.5D.0** bertujuan merancang spesifikasi pemetaan (*identity mapping*) dari objek `VerifiedOIDCIdentity` ke dalam basis data entitas pengguna lokal NutriBodySim (`User` dan `ExternalIdentity`).

### 1.2 Batasan Ketat Milestone (Non-Negotiable Boundaries)
Dalam milestone ini berlaku batasan mutlak:
1. **Dilarang Mengubah Runtime**: Tidak ada penambahan endpoint, manipulasi route `api.ts`, penambahan method runtime pada `DatabaseStore`, atau modifikasi kode aktif.
2. **Google Login Publik Tetap Tidak Aktif**: Tidak ada UI login publik yang diaktifkan, tidak ada middleware callback publik yang dibuka.
3. **Dilarang Membuat Sesi Pengguna**: Pemetaan identitas harus dipisahkan secara arsitektural dari pembuatan sesi autentikasi (`createSession`).
4. **Dilarang Auto-Merge Akun Berdasarkan Email**: Penyeragaman akun lokal dengan identitas Google semata-mata karena kesamaan alamat email (`email_verified === true`) dilarang keras karena membuka celah pengambilalihan akun (*Account Takeover* / ATO).
5. **Dilarang Memberikan Hak Istimewa Otomatis**: Tidak ada role elevation, tidak ada inferensi role akademik dari domain email, dan hak istimewa Main Administrator tetap diisolasi pada CLI bootstrap.

---

## 2. Audit Kode & Dokumentasi Aktual (Read-Only Security Audit)

Audit mendalam dilakukan terhadap kode sumber aktual di repositori NutriBodySim untuk memvalidasi kesesuaian antara asumsi konseptual dan implementasi riil.

### 2.1 Audit Entitas Basis Data (`backend/database/types.ts`)
* **Model `ExternalIdentity`** (Baris 38–45):
  ```typescript
  export interface ExternalIdentity {
    provider: 'google' | 'local';
    provider_subject_id: string; // Stable provider subject identifier (e.g. Google 'sub')
    user_id: string;             // Relates to internal User.id
    email?: string;
    email_verified: boolean;
    linked_at: string;
  }
  ```
  *Status*: Tipe telah terdefinisi dengan baik dan memuat pasangan `(provider, provider_subject_id)` serta referensi `user_id`.
* **Model `User`** (Baris 47–73):
  ```typescript
  export interface User {
    id: string;
    user_id?: string;
    email: string;
    name: string;
    display_name?: string;
    role: UserRole;
    permissions: Permission[];
    organization?: string;
    avatar_url?: string;
    created_at: string;
    updated_at?: string;
    last_login_at: string;
    account_status?: AccountStatus; // 'ACTIVE' | 'SUSPENDED' | 'DISABLED'
    email_verified?: boolean;
    provider?: 'google' | 'local';
    provider_subject_id?: string;
    external_identities?: ExternalIdentity[];
    is_main_admin?: boolean;
    governance_granted_at?: string;
    governance_granted_by?: string;
    token_version?: number;
  }
  ```
* **Kesenjangan Aktual (GAP 1 — Tidak Ada Base Role Unprivileged)**:
  `UserRole` hanya didefinisikan sebagai:
  ```typescript
  export type UserRole = 'Student' | 'Lecturer' | 'Researcher' | 'Admin';
  ```
  *Temuan Kritis*: Tidak ada peran `RegisteredUser`, `Guest`, atau `Viewer` dalam sistem! Role terendah yang ada saat ini adalah `'Student'`. Namun, role `Student` memiliki permissions `['VIEW', 'USE', 'CREATE', 'CLONE']`, yang memberikan hak operasional untuk membuat dan mengkloning proyek laboratorium. Jika akun yang baru diprovisioning otomatis diberi role `Student`, hal ini melanggar prinsip *least privilege* jika kebijakan institusional mensyaratkan verifikasi status mahasiswa sebelum diberikan izin pembuatan materi/proyek.

### 2.2 Audit Penyimpanan Basis Data (`backend/database/store.ts`)
* **Metode `linkExternalIdentity`** (Baris 278–323):
  - Memeriksa keabsahan `provider`, `provider_subject_id`, dan `user_id`.
  - Memeriksa keberadaan user target: `const user = this.state.users.find(u => u.id === identity.user_id)`.
  - Memeriksa keunikan pasangan `(provider, provider_subject_id)`: melempar error jika identitas eksternal sudah terdaftar.
  - Memperbarui array `state.external_identities` dan `user.external_identities`.
  - Memanggil `this.save()`.
  - *Kesenjangan Aktual (GAP 2 — Kurangnya Pemeriksaan Status Akun & Audit Terintegrasi)*:
    1. `linkExternalIdentity` TIDAK memeriksa `user.account_status`. Identitas eksternal dapat ditautkan ke akun yang berstatus `SUSPENDED` atau `DISABLED`.
    2. `linkExternalIdentity` TIDAK memanggil `this.logAudit` di dalam operasinya. Pemanggilan audit diserahkan sepenuhnya kepada pemanggil eksternal.
* **Kesenjangan Aktual (GAP 3 — Tidak Ada Metode `createUser` / `provisionUser`)**:
  - Pemeriksaan `grep -rn "createUser" backend/` menghasilkan 0 hasil.
  - Dalam implementasi saat ini, pengguna (`User[]`) HANYA dibuat pada saat seeding awal (`generateSeedData()`).
  - Tidak ada fungsi store yang memvalidasi format email, keunikan email pada tabel `users`, inisialisasi default permissions, atau inisialisasi `token_version` pada saat penambahan pengguna baru.

### 2.3 Audit Mekanisme Penyimpanan & Jaminan Transaksional (`saveToDisk`)
* **Implementasi Penyimpanan File**:
  ```typescript
  private saveToDisk(data: DatabaseState) {
    const tmpFile = `${DB_FILE}.tmp.${Date.now()}.${crypto.randomBytes(4).toString('hex')}`;
    fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmpFile, DB_FILE);
  }
  ```
* **Kesenjangan Aktual (GAP 4 — Karakteristik Konkurensi & Risiko Data)**:
  1. Operasi penulisan ke disk menggunakan pola *atomic rename* (`renameSync`), yang menjamin bahwa file tidak akan rusak jika terjadi listrik mati saat proses tulis file sementara.
  2. **TETAPI**, seluruh pembacaan dan pembaruan data terjadi pada objek memori JavaScript `this.state`.
  3. **Tidak ada Mutex / Lock Transaksional**: Jika dua permintaan asinkron berjalan bersamaan dalam event loop Node.js atau terdapat interval `await`, modifikasi terhadap `this.state` rentan terhadap *race condition*.
  4. **Multi-Instance / Horizontally Scaled Failure**: Jika aplikasi dijalankan pada lebih dari 1 proses (cluster mode atau multiple container instances), masing-masing proses memiliki instance `this.state` sendiri. Operasi `saveToDisk` dari Proses A akan menimpa seluruh pembaruan yang baru saja ditulis oleh Proses B (*last-write-wins overwrite anomaly*).
  5. **Mekanisme Rollback Manual**: Pada `approveRoleRequest` dan `bootstrapMainAdmin`, rollback dilakukan dengan cara menyimpan salinan properti sebelum mutasi di memori, lalu mengembalikannya jika `saveToDisk` melempar error. Pola ini rentan jika terjadi kegagalan parsial di luar blok `try-catch`.

### 2.4 Audit Jejak Audit (`backend/database/types.ts` & `store.ts`)
* **Tipe `AuditLog`**:
  ```typescript
  export interface AuditLog {
    id: string;
    user_id: string;
    user_name: string;
    action: 'CREATE' | 'EDIT' | 'CLONE' | 'DELETE' | 'SHARE' | 'PUBLISH' | 'VERIFY' | 'EXECUTE' | 'LOGIN' | 'MAIN_ADMIN_BOOTSTRAP' | 'ROLE_APPROVAL' | 'USER_STATUS_CHANGE' | 'SESSION_REVOCATION';
    entity_type: string;
    entity_id: string;
    details: string;
    ip_address?: string;
    timestamp: string;
    metadata?: Record<string, any>;
  }
  ```
* **Kesenjangan Aktual (GAP 5 — Limitasi Logging & Enum Action)**:
  1. `AuditLog['action']` saat ini belum memuat aksi identitas OIDC seperti `OIDC_ACCOUNT_PROVISION`, `OIDC_IDENTITY_LINK`, `OIDC_IDENTITY_CONFLICT`, `OIDC_LINK_REJECTED`, atau `OIDC_STORAGE_FAILURE`.
  2. Implementasi `logAudit` membatasi log maksimal 1.000 baris dengan pemotongan FIFO (`this.state.audit_logs.pop()`). Log audit lama akan terhapus otomatis seiring bertambahnya aktivitas sistem.
  3. Log audit tersimpan dalam file JSON biasa (`nutribodysim_db.json`) bersama data aplikasi, sehingga tidak memenuhi standar *tamper-proof / append-only ledger* standar industri tanpa integrasi log eksternal.

---

## 3. Kebijakan Identitas & Pemetaan Akun (Identity Policy Constitution)

Untuk memastikan sistem tidak rentan terhadap serangan manipulasi identitas, kebijakan identitas berikut ditetapkan sebagai aturan absolut.

```
       +-------------------------------------------------------------+
       |             VerifiedOIDCIdentity (Google OIDC)              |
       |  provider: 'google'                                         |
       |  sub: '109823471092837410928'  <-- ANCHOR UTAMA STABIL      |
       |  email: 'researcher@gmail.com' <-- KLAIM PROFIL SEKUNDER    |
       |  emailVerified: true                                        |
       +-------------------------------------------------------------+
                                      │
                                      ▼
                      [ Pencarian ExternalIdentity ]
                      (provider='google', provider_subject_id=sub)
                                      │
                 ┌────────────────────┴────────────────────┐
                 │                                         │
        [ Ditemukan (Linked) ]                   [ Tidak Ditemukan ]
                 │                                         │
                 ▼                                         ▼
      [ Ambil Akun Lokal ]                      [ Cek Konflik Email ]
      user = db.getUser(e.user_id)              users.find(u => u.email === token.email)
                 │                                         │
        ┌────────┴────────┐                       ┌────────┴────────┐
        │                 │                       │                 │
   [ ACTIVE ]      [ NON-ACTIVE ]            [ Email Ada ]    [ Email Unik ]
        │                 │                       │                 │
        ▼                 ▼                       ▼                 ▼
   IZINKAN AKSES   TOLAK: HTTP 403           TOLAK: KONFLIK    PROVISION AKUN
   (Identity Match) FORBIDDEN_STATUS         (Gagal Aman,       (Role Minimal,
                                              Wajib Linking)     Status ACTIVE)
```

### 3.1 Identitas Google sebagai Anchor Utama
1. **Pasangan Kunci `(provider, provider_subject_id)`**:
   - `provider`: Secara mutlak bernilai `'google'`.
   - `provider_subject_id`: Nilai klaim `sub` dari Google ID Token yang telah diverifikasi (string numerik hingga 255 karakter, unik dan tidak pernah didaur ulang oleh Google).
2. **Larangan Menjadikan Email sebagai Primary Identity Anchor**:
   - Alamat email dapat diubah oleh pengguna pada akun Google mereka, dialihkan ke orang lain setelah akun dihapus, atau memiliki alias/domain routing berbeda.
   - Sistem **DILARANG** memperbarui atau mengubah pengikatan `provider_subject_id` hanya karena perubahan alamat email.
3. **Imunitas terhadap Masukan Klien**:
   - Parameter `provider`, `provider_subject_id`, `email`, `role`, `permissions`, atau `is_main_admin` dari body, query, maupun header HTTP klien **DITOLAK SECARA MUTLAK**. Seluruh data identitas harus bersumber eksklusif dari objek `VerifiedOIDCIdentity` yang dihasilkan engine verifikasi C.2–C.4 internal.

### 3.2 First Login & Provisioning Akun Baru
Ketika pengguna melakukan autentikasi Google dan `sub` belum terdaftar dalam tabel `external_identities`:
1. **Pemeriksaan Konflik Email Pra-Provisioning**:
   - Sebelum akun dibuat, sistem harus memeriksa apakah `email` dari identitas Google bertabrakan dengan email akun lokal yang sudah ada. Jika ada tabrakan, provisioning **DIBATALKAN** (lihat Seksi 3.3).
2. **Prinsip Peran Minimum (Least Privilege Default)**:
   - Pengguna baru **DILARANG** diberikan role `Lecturer`, `Researcher`, `Admin`, atau `Main Admin` secara otomatis.
   - Domain email institusi (seperti `@university.ac.id`, `@stanford.edu`, `@gov.org`) atau nama institusi pada profil Google **DILARANG** dijadikan dasar penentuan role akademik secara otomatis. Seluruh elevasi role wajib melalui alur pengajuan `RoleRequest` dan persetujuan bertingkat (*Tiered Role Approval*).
   - *Penanganan Kesenjangan Model*: Karena saat ini `UserRole` belum memiliki role unprivileged (seperti `RegisteredUser`), implementasi D.1 wajib menetapkan role `'Student'` dengan status akun `ACTIVE` hanya jika kebijakan produk mengizinkan akses mandiri mahasiswa, ATAU menahan akun dalam status `PENDING_ROLE` tanpa izin operasional hingga peran ditetapkan oleh administrator.
3. **Sanitasi Data Profil**:
   - Nama pengguna diambil dari klaim `profile.name` atau `email`.
   - Nilai string wajib disanitasi: memangkas whitespace, menghapus karakter kontrol, menolak tag HTML/skrip (`<script>`, `<iframe>`), dan membatasi panjang maksimal 100 karakter.
   - Avatar URL wajib divalidasi protokolnya (hanya `https://`) dan dibatasi panjangnya maksimal 500 karakter.
4. **Status Akun Baru**:
   - Akun baru harus diinisialisasi dengan `account_status: 'ACTIVE'`, `email_verified: true`, `created_at: ISO8601`, `token_version: 1`, dan array `external_identities` yang memuat record Google identity terkait.

### 3.3 Penanganan Konflik Email (Anti-Auto-Merge Policy)
**KEBIJAKAN MUTLAK: DILARANG MELAKUKAN AUTO-MERGE BERDASARKAN EMAIL.**

Auto-merge otomatis (menautkan identitas Google ke akun lokal yang sudah ada hanya karena email-nya sama) merupakan kerentanan fatal yang memungkinkan penyerang mengambil alih akun lokal korban (*Account Takeover*). Contoh skenario serangan: jika akun lokal dibuat di masa lalu tanpa verifikasi email yang ketat, atau penyerang mendaftarkan email korban di penyedia identitas eksternal.

#### Matriks Penanganan Skenario Konflik:
1. **Google `sub` Belum Dikenal, Email Cocok dengan Akun Lokal yang Ada**:
   - **Keputusan**: TOLAK provisioning baru dan TOLAK akses ke akun lokal.
   - **Tindakan**: Fails closed. Jangan buat record `User` baru, jangan buat `ExternalIdentity`.
   - **Respon Klien**: Berikan pesan netral yang aman: *"Authentication requires explicit account linking. Please sign in to your local account and connect Google Identity from Account Settings."*
   - **Pencegahan User Enumeration**: Respon tidak boleh mengonfirmasi secara gamblang apakah akun lokal dengan email tersebut aktif atau berstatus tertentu kepada penyerang yang tidak terautentikasi.
   - **Pencatatan Audit**: Catat event `OIDC_IDENTITY_CONFLICT` dengan detail email yang bertabrakan, Google `sub`, dan alamat IP penyerang/pengguna.
2. **Email Cocok dengan Akun yang Berstatus `SUSPENDED` atau `DISABLED`**:
   - **Keputusan**: TOLAK mutlak.
   - **Tindakan**: Tidak ada perubahan data. Jangan tautkan identitas baru. Akun yang dinonaktifkan dilarang dipulihkan atau diakses melalui saluran SSO eksternal.
3. **Email Berubah pada Google Identity yang Sudah Terhubung**:
   - **Skenario**: Akun lokal A sudah terhubung ke Google `sub: 123` dengan email awal `lama@domain.com`. Pengguna mengubah email Google-nya menjadi `baru@domain.com`.
   - **Keputusan**: Tetap izinkan login ke Akun Lokal A karena `sub: 123` adalah anchor utama.
   - **Tindakan**: Perbarui kolom `email` pada record `ExternalIdentity`, namun **JANGAN** mengubah `email` primer pada akun lokal `User` tanpa verifikasi kepemilikan lokal tambahan.
   - **Pencatatan Audit**: Catat event `OIDC_EXTERNAL_EMAIL_CHANGED` di audit log.
4. **Dua Transaksi Provisioning Bersamaan dengan Google `sub` yang Sama**:
   - **Keputusan**: Hanya 1 transaksi yang diizinkan berhasil; transaksi kedua harus mendeteksi bahwa akun telah dibuat (*idempotent resolution* atau *unique constraint violation*).
   - **Tindakan**: Fails closed pada transaksi kedua tanpa membuat duplikasi user di memori.
5. **Akun Lokal dengan Data Usang atau Email Duplikat di Database**:
   - **Keputusan**: Fails closed. Sistem mendeteksi anomali integritas data dan menolak pemetaan otomatis.
   - **Tindakan**: Catat event anomali pada audit log dan instruksikan operator sistem untuk menyelesaikan konflik data.

### 3.4 Penautan Akun Eksplisit (Explicit Account Linking Flow)
Penautan akun lokal dengan identitas Google hanya boleh dilakukan melalui alur eksplisit dengan pembuktian ganda (*Dual Ownership Proof*).

```
[ Pengguna Terautentikasi ] --( Membawa Sesi Lokal Aktif )--> [ POST /auth/oidc/link/initiate ]
                                                                      │
                                                                      ▼
                                                       [ Simpan Transaksi Linking ]
                                                       purpose: 'ACCOUNT_LINKING'
                                                       target_user_id: req.user.id
                                                                      │
                                                                      ▼
                                                       [ Google Consent Screen ]
                                                                      │
                                                                      ▼
[ Callback OIDC Google ] --( Validasi State, PKCE, ID Token )--> [ Handler Linking Server ]
                                                                      │
                                                                      ▼
                                                       [ Validasi Kepemilikan Ganda ]
                                                       1. Sesi lokal masih valid & ACTIVE
                                                       2. target_user_id === req.user.id
                                                       3. Google sub belum dimiliki akun lain
                                                                      │
                                                                      ▼
                                                       [ Atomic linkExternalIdentity ]
```

#### Persyaratan Ketat Linking:
1. **Sesi Lokal Tepercaya**:
   - Pengguna WAJIB telah login dengan akun lokal NutriBodySim dan memiliki sesi aktif yang valid (`req.user.account_status === 'ACTIVE'`).
   - `target_user_id` diambil dari `req.user.id` yang dijamin oleh `authMiddleware`, **BUKAN** dari request body atau parameter URL.
2. **Binding Transaksi OIDC**:
   - Transaksi OIDC yang dibuat pada saat inisiasi linking wajib memuat metadata khusus:
     `metadata: { purpose: 'ACCOUNT_LINKING', target_user_id: req.user.id }`.
   - Pada saat callback diterima, orkestrator wajib memverifikasi bahwa `target_user_id` pada transaksi cocok dengan user ID sesi lokal yang sedang aktif.
3. **Larangan One-to-Many & Many-to-One**:
   - Satu Google `sub` hanya dapat ditautkan ke TEPAT SATU akun lokal.
   - Satu akun lokal hanya dapat ditautkan ke SATU identitas Google pada provider yang sama.
4. **Status Operasional Saat Ini (BLOCKED DEPENDENCY)**:
   - *Status*: **BLOCKED FOR RUNTIME IMPLEMENTATION**.
   - *Alasan*: Aplikasi saat ini belum mengimplementasikan sistem login lokal berbasis kredensial produksi (hanya demo-login pada lingkungan pengembangan). Alur linking eksplisit yang aman membutuhkan autentikasi lokal produksi dan re-autentikasi sebelum dapat diaktifkan di runtime.

---

## 4. Pemisahan Hak Istimewa (Privilege Separation & RBAC Integrity)

Sistem wajib mempertahankan dinding pemisah yang tegas di antara 5 domain kewenangan:

```
+-----------------------------------------------------------------------------------+
| 1. Google OIDC Identity (sub, email, profile)                                     |
|    - Hanya bukti otentikasi bahwa subjek telah diautentikasi oleh Google.         |
|    - Nol kewenangan aplikasi.                                                     |
+-----------------------------------------------------------------------------------+
                                          │ (Mapping Terkontrol)
                                          ▼
+-----------------------------------------------------------------------------------+
| 2. Akun Lokal NutriBodySim (User, id, account_status)                             |
|    - Subjek entitas di dalam database. Wajib ACTIVE untuk beroperasi.             |
+-----------------------------------------------------------------------------------+
                                          │ (Assigned via Governance)
                                          ▼
+-----------------------------------------------------------------------------------+
| 3. Peran Aplikasi (UserRole: Student, Lecturer, Researcher, Admin)                |
|    - Menentukan hierarki dan baseline izin operasional.                           |
+-----------------------------------------------------------------------------------+
                                          │ (Enumerated Grants)
                                          ▼
+-----------------------------------------------------------------------------------+
| 4. Izin Operasional (Permission: VIEW, USE, CREATE, CLONE, EDIT, DELETE, ...)     |
|    - Hak akses granular pada artefak laboratorium dan simulasi.                   |
+-----------------------------------------------------------------------------------+
                                          │ (Isolated CLI Bootstrap Only)
                                          ▼
+-----------------------------------------------------------------------------------+
| 5. Main Administrator (is_main_admin === true && role === 'Admin')                |
|    - Hak tata kelola istimewa: MANAGE_PRIVILEGED_ROLES.                           |
|    - TIDAK DAPAT DIPEROLEH DARI OIDC, PROVISIONING, MAUPUN ROLE APPROVAL BIASA.  |
+-----------------------------------------------------------------------------------+
```

### 4.1 Imunitas Main Administrator dari OIDC
1. **Isolasi Penuh**:
   - Pengguna dengan identitas Google, bahkan yang memiliki email administrator atau klaim eksternal apa pun, **TIDAK PERNAH** memperoleh status `is_main_admin: true` melalui login OIDC.
2. **Satu-satunya Jalur Penetapan**:
   - Status Main Administrator hanya dapat diberikan atau dialihkan melalui script CLI terisolasi `executeBootstrapMainAdmin` yang mensyaratkan operator manusia eksplisit, audit trail non-repudiable, verifikasi user yang sudah ada dan berstatus `ACTIVE`, serta pencabutan sesi global.
3. **Pemberian Role Admin**:
   - Pengguna biasa hanya dapat dinaikkan menjadi `Admin` melalui `RoleApprovalEngine` yang disetujui secara eksplisit oleh Main Administrator aktif. Proses provisioning OIDC dilarang memberikan role `Admin`.

---

## 5. Analisis Konkurensi, Idempotensi & Risiko Penyimpanan Basis Data

### 5.1 Keterbatasan Arsitektur `DatabaseStore` Saat Ini
Berdasarkan audit Seksi 2.3, mekanisme penyimpanan database NutriBodySim saat ini (`nutribodysim_db.json`) memiliki karakteristik fisik:
- **In-Memory Cache**: Seluruh mutasi dilakukan langsung pada objek `this.state` di memori RAM.
- **Disk Serialization**: Dipanggil via `saveToDisk(this.state)`, yang menulis file sementara lalu melakukan `renameSync`.
- **Ketiadaan Lock Lintas-Proses**: File lock berbasis sistem operasi (`flock` atau `fcntl`) tidak diimplementasikan.

### 5.2 Analisis Skenario Konkurensi & Mitigasi Desain

| Skenario Konkurensi | Risiko pada Database Saat Ini | Desain Mitigasi untuk Implementasi D.1 |
| :--- | :--- | :--- |
| **Dua First-Login Bersamaan untuk Google `sub` yang Sama** | Dua request dieksekusi hampir bersamaan. Jika keduanya membaca `findExternalIdentity` sebelum salah satunya memanggil `push`, dapat tercipta dua akun lokal untuk 1 `sub`. | Implementasikan **In-Memory Async Mutex / Keyed Lock** pada proses Node.js berdasarkan `sub`. Request kedua wajib menunggu hingga request pertama selesai dan langsung mendeteksi akun yang sudah dibuat. |
| **Dua Request Mencoba Membuat `ExternalIdentity` yang Sama** | Potensi duplikasi data pada array `state.external_identities`. | Penegakan cek keunikan ketat di dalam fungsi penyimpanan atomik sebelum melakukan mutasi memori. |
| **Akun Lokal Dibuat, tetapi Penyimpanan `ExternalIdentity` Gagal** | Akun lokal menjadi "yatim" (*orphan account*) yang tidak memiliki pengikatan identitas eksternal. | **Atomic Mutation Block with Rollback**: Inisialisasi User dan ExternalIdentity dalam 1 transaksi logis memori sebelum `saveToDisk`. Jika `saveToDisk` gagal, hapus user dan external identity dari memori. |
| **Data Tersimpan di Disk, tetapi Respon HTTP Terputus** | Client menganggap login gagal, namun akun telah dibuat di server. | Transaksi bersifat idempoten: jika pengguna mencoba login ulang dengan `sub` yang sama, request kedua langsung memetakan ke akun yang telah dibuat tanpa error duplikasi. |
| **Proses Mati / Crash di Tengah Operasi** | File JSON database berpotensi korup jika operasi tulis parsial. | Pola penulisan ke `.tmp` dan `renameSync` saat ini sudah mencegah korupsi file fisik di disk. Objek memori akan di-reload dari file disk yang valid saat restart. |
| **Dua Permintaan Linking Saling Berlomba** | Dua akun lokal berbeda mencoba menautkan Google `sub` yang sama secara paralel. | Mutex berbasis `sub` mencegah eksekusi paralel. Request pertama menautkan identitas, request kedua melempar error `Unique constraint violation`. |
| **Sistem Berjalan pada Multi-Instance (Horizontal Scaling)** | Instance A dan Instance B memiliki memori terpisah. Instance A menulis ke file JSON, menimpa perubahan yang dibuat oleh Instance B. | **Dokumentasi Batasan Arsitektural**: Penyimpanan file JSON lokal hanya aman untuk **single-instance single-process**. Untuk multi-instance, aplikasi memerlukan migrasi ke basis data relasional ACID (seperti Cloud SQL / PostgreSQL) yang mendukung transaksi row-level locking. |

---

## 6. Audit Trail & Privasi Data

### 6.1 Definisi Aksi Audit Minimum (OIDC Identity Actions)
Pada implementasi D.1, tipe `AuditLog['action']` harus diperluas untuk mencakup aksi-aksi identitas berikut:

```typescript
export type OIDCIdentityAuditAction =
  | 'OIDC_ACCOUNT_PROVISION'     // Akun lokal baru berhasil dibuat via OIDC
  | 'OIDC_IDENTITY_LINK'          // Identitas eksternal berhasil ditautkan ke akun lokal
  | 'OIDC_IDENTITY_CONFLICT'      // Konflik email/identitas terdeteksi (gagal aman)
  | 'OIDC_LINK_REJECTED'          // Upaya penautan ditolak (sesi tidak valid/akun non-aktif)
  | 'OIDC_STORAGE_FAILURE'        // Kegagalan penulisan basis data dan eksekusi rollback
  | 'OIDC_INACTIVE_ACCESS_ATTEMPT'// Percobaan login pada akun SUSPENDED/DISABLED
  | 'OIDC_CLAIM_ANOMALY';         // Ketidaksesuaian atau perubahan email pada Google sub yang ada
```

### 6.2 Standar Privasi & Penegakan Zero-Credential Logging
Jejak audit harus mematuhi standar privasi data dan kepatuhan keamanan:
1. **Data yang WAJIB Dicatat**:
   - `user_id`: ID akun lokal (atau `'SYSTEM'` / `'UNPROVISIONED'` jika belum ada akun).
   - `action`: Salah satu aksi OIDC di atas.
   - `entity_type`: `'USER'` atau `'EXTERNAL_IDENTITY'`.
   - `entity_id`: ID user lokal atau Google `sub`.
   - `ip_address`: Alamat IP klien yang tepercaya.
   - `timestamp`: Timestamp ISO 8601 server.
   - `metadata`: Memuat Google `sub`, status email terverifikasi, alasan penolakan, dan nama display yang disanitasi.
2. **Data yang DILARANG KERAS Dicatat (Zero-Credential Policy)**:
   - Raw ID Token JWT.
   - Google Access Token atau Refresh Token.
   - PKCE `code_verifier`.
   - OIDC `nonce` atau `state` token mentah.
   - Password atau kredensial autentikasi apa pun.

### 6.3 Evaluasi Keandalan Audit Log Saat Ini
- **Kondisi Aktual**: Log audit disimpan di array `state.audit_logs` pada file JSON lokal, dengan batasan 1.000 entri terakhir (FIFO).
- **Keterbatasan**: Tidak bersifat *tamper-proof* (dapat diedit jika file disk diakses langsung), rentan terpotong jika beban sistem tinggi, dan hilang jika file database di-reset.
- **Rekomendasi Produksi**: Untuk lingkungan produksi komersial/regulasi medis, log audit harus dikirimkan secara asinkron ke layanan *append-only log management* terisolasi (seperti Cloud Logging / SIEM).

---

## 7. Desain Kontrak Konseptual (Conceptual Interface Contracts)

Berikut adalah kontrak tipe konseptual yang dirancang untuk diimplementasikan pada MVS-B2.5D.1. Kontrak ini menjamin pemisahan tanggung jawab (*separation of concerns*) yang jelas.

### 7.1 Input & Resolusi Identitas (`resolveIdentityMapping`)

```typescript
import { VerifiedOIDCIdentity } from './oidc/types';
import { User, ExternalIdentity, AccountStatus } from './database/types';

/**
 * Status hasil evaluasi pemetaan identitas.
 */
export type IdentityMappingDecision =
  | 'EXISTING_LINKED_ACCOUNT'   // sub sudah terhubung ke akun lokal aktif
  | 'PROVISION_NEW_ACCOUNT'     // sub belum dikenal dan email aman untuk akun baru
  | 'EMAIL_CONFLICT_REQUIRES_LINKING' // email bertabrakan dengan akun lokal yang ada
  | 'ACCOUNT_INACTIVE'          // akun lokal yang terhubung dalam status SUSPENDED/DISABLED
  | 'CLAIM_VALIDATION_FAILED'   // klaim identitas tidak memenuhi syarat (e.g. email unverified)
  | 'INTERNAL_ERROR';           // kegagalan sistem internal

/**
 * Hasil dari evaluasi pemetaan identitas sebelum aksi persistensi.
 */
export interface IdentityResolutionResult {
  decision: IdentityMappingDecision;
  provider: 'google';
  sub: string;
  email?: string;
  emailVerified: boolean;
  targetUser?: User;            // Ada jika EXISTING_LINKED_ACCOUNT atau ACCOUNT_INACTIVE
  conflictingUser?: {           // Proyeksi aman akun yang bertabrakan (tanpa data sensitif)
    id: string;
    account_status?: AccountStatus;
  };
  errorMessage?: string;
  safeClientCode?: string;
}
```

### 7.2 Kontrak Provisioning Akun Baru (`provisionOIDCUser`)

```typescript
export interface ProvisionOIDCUserParams {
  identity: VerifiedOIDCIdentity;
  ipAddress?: string;
  // Memastikan bahwa parameter role atau hak istimewa TIDAK DAPAT di-override oleh caller
}

export interface ProvisionOIDCUserResult {
  success: boolean;
  user?: User;
  externalIdentity?: ExternalIdentity;
  auditLogId?: string;
  error?: {
    code: string;
    message: string;
    isConflict?: boolean;
  };
}
```

### 7.3 Kontrak Penautan Akun Eksplisit (`linkOIDCAccount`)

```typescript
export interface LinkOIDCAccountParams {
  authenticatedUserId: string;  // Berasal dari req.user.id sesi lokal tepercaya
  identity: VerifiedOIDCIdentity;
  ipAddress?: string;
}

export interface LinkOIDCAccountResult {
  success: boolean;
  externalIdentity?: ExternalIdentity;
  auditLogId?: string;
  error?: {
    code: string;
    message: string;
  };
}
```

### 7.4 Batas Antara Identity Mapping dan Pembuatan Sesi (Session Boundary)
Modul Identity Mapping **HANYA** bertanggung jawab untuk:
1. Memvalidasi status akun lokal.
2. Memetakan `VerifiedOIDCIdentity` ke `User`.
3. Mengembalikan objek `User` yang valid dan aktif.

Modul Identity Mapping **TIDAK BERTANGGUNG JAWAB** untuk:
1. Memanggil `sessionStore.createSession`.
2. Menghasilkan cookie sesi `Set-Cookie`.
3. Mengirimkan token Bearer ke browser.

Pembuatan sesi dilakukan oleh controller autentikasi terpisah setelah fungsi pemetaan identitas mengembalikan `User` yang sah dan berstatus `ACTIVE`.

---

## 8. Matriks Skenario Keamanan & Keputusan Sistem

Matriks komprehensif ini mengatur seluruh skenario operasional dan serangan (*adversarial cases*) yang wajib dipatuhi:

| ID | Skenario Masukan | Kondisi State Sistem | Keputusan Sistem | Respon Klien Aman | Mutasi Data | Aksi Audit | Tingkat Risiko & Mitigasi |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **SC-01** | Google `sub` valid & cocok dengan `ExternalIdentity` | Akun lokal ditemukan, `account_status === 'ACTIVE'` | **LOGIN DIIZINKAN** | HTTP 200: Sesi dibuat via Auth Controller | Perbarui `last_login_at` | `LOGIN` | **Low**. Alur normal returning user. |
| **SC-02** | Google `sub` valid & cocok dengan `ExternalIdentity` | Akun lokal ditemukan, `account_status === 'SUSPENDED'` | **LOGIN DITOLAK** | HTTP 403: `FORBIDDEN_ACCOUNT_STATUS` ("Account is suspended.") | Tidak ada mutasi | `OIDC_INACTIVE_ACCESS_ATTEMPT` | **High**. Mencegah bypass penangguhan akun via SSO. |
| **SC-03** | Google `sub` valid & cocok dengan `ExternalIdentity` | Akun lokal ditemukan, `account_status === 'DISABLED'` | **LOGIN DITOLAK** | HTTP 403: `FORBIDDEN_ACCOUNT_STATUS` ("Account is disabled.") | Tidak ada mutasi | `OIDC_INACTIVE_ACCESS_ATTEMPT` | **High**. Akun yang dinonaktifkan dilarang login. |
| **SC-04** | Google `sub` belum dikenal, `email_verified === true` | Email unik (belum ada di tabel `users`) | **PROVISION AKUN BARU** | HTTP 200: Akun baru dibuat, sesi diterbitkan | Buat `User` (Role minimal: Student) & `ExternalIdentity` | `OIDC_ACCOUNT_PROVISION` | **Medium**. Registrasi otomatis terisolasi least-privilege. |
| **SC-05** | Google `sub` belum dikenal, `email_verified === true` | Email cocok dengan akun lokal yang ada | **TOLAK & BLOKIR AUTO-MERGE** | HTTP 409 / 400: `IDENTITY_LINKING_REQUIRED` ("Account linking required.") | Tidak ada mutasi | `OIDC_IDENTITY_CONFLICT` | **Critical**. Mencegah Account Takeover (ATO). |
| **SC-06** | Google `sub` belum dikenal, `email_verified === false` | Email unik atau ada | **TOLAK KLAIM IDENTITAS** | HTTP 400: `UNVERIFIED_EMAIL` ("Email not verified by Google.") | Tidak ada mutasi | `OIDC_CLAIM_ANOMALY` | **High**. Menolak identitas Google yang emailnya belum diverifikasi. |
| **SC-07** | Google `sub` dikenal, namun email Google berubah | Akun lokal ditemukan dan `ACTIVE` | **LOGIN DIIZINKAN (Anchor sub)** | HTTP 200: Sesi diterbitkan untuk akun lokal terkait | Perbarui email di `ExternalIdentity` (email User tidak diubah) | `OIDC_CLAIM_ANOMALY` | **Medium**. Mempertahankan stabilitas subjek terlepas dari email. |
| **SC-08** | Dua transaksi provisioning paralel dengan `sub` yang sama | Belum ada akun di awal kedua transaksi | **IDEMPOTEN / SINGLE-WINNER** | Transaksi 1: Sukses. Transaksi 2: Menunggu lock dan me-resolve akun yang baru dibuat. | 1 User & 1 ExternalIdentity dibuat (tidak ada duplikasi) | `OIDC_ACCOUNT_PROVISION` | **High**. Perlindungan terhadap race condition. |
| **SC-09** | Permintaan linking eksplisit tanpa sesi lokal | Header `Authorization` kosong / token tidak valid | **TOLAK LINKING** | HTTP 401: `UNAUTHORIZED` ("Authentication required to link account.") | Tidak ada mutasi | `OIDC_LINK_REJECTED` | **High**. Linking wajib dibuktikan dengan sesi lokal aktif. |
| **SC-10** | Permintaan linking ke akun yang berstatus `DISABLED` | Sesi lokal kadaluwarsa / user non-aktif | **TOLAK LINKING** | HTTP 403: `FORBIDDEN_ACCOUNT_STATUS` | Tidak ada mutasi | `OIDC_LINK_REJECTED` | **High**. Akun non-aktif dilarang menautkan identitas baru. |
| **SC-11** | Caller mengirimkan `role: 'Admin'` pada request body | Request OIDC callback atau provisioning | **ABAIKAN & TOLAK MASUKAN** | Input diabaikan sepenuhnya; role default tetap minimal | Tidak ada hak istimewa diberikan | - | **Critical**. Mencegah privilege escalation via parameter tampering. |
| **SC-12** | Database write gagal di tengah proses provisioning | `User` ditambahkan ke memori, tapi `saveToDisk` melempar I/O error | **ROLLBACK ATOMIK** | HTTP 500: `INTERNAL_STORAGE_ERROR` | Objek memori di-rollback ke snapshot sebelumnya | `OIDC_STORAGE_FAILURE` | **High**. Mencegah orphan state dan dirty memory. |
| **SC-13** | Akun lokal legacy memiliki email duplikat atau corrupt | Integritas data tidak konsisten | **FAILS CLOSED** | HTTP 500 / 409: `DATA_INTEGRITY_ANOMALY` | Tidak ada mutasi | `OIDC_IDENTITY_CONFLICT` | **Medium**. Mencegah ambiguitas pemetaan akun. |

---

## 9. Rencana Implementasi & Acceptance Criteria untuk MVS-B2.5D.1

Milestone berikutnya (**MVS-B2.5D.1**) akan mengimplementasikan komponen pemetaan identitas dan provisioning akun di sisi server secara terisolasi.

### 9.1 Kriteria Penerimaan (Acceptance Criteria) MVS-B2.5D.1:
1. **Modul Terisolasi `backend/auth/oidc/identityMapper.ts`**:
   - Mengimplementasikan fungsi murni server-side untuk resolusi identitas (`resolveIdentityMapping`) dan provisioning (`provisionOIDCUser`).
   - Tidak membuka route publik apa pun.
2. **Pemeriksaan Anti-Auto-Merge**:
   - Suite pengujian unit wajib memverifikasi bahwa akun lokal dengan email yang sama TIDAK AKAN PERNAH digabungkan secara otomatis dengan Google `sub` baru.
3. **Pemberian Role Paling Rendah**:
   - Akun baru hanya memperoleh role terendah yang diizinkan sistem tanpa izin administratif atau persetujuan role request otomatis.
4. **Perlindungan Terhadap Akun Non-Aktif**:
   - Pengujian memvalidasi penolakan mutlak bagi akun lokal yang berstatus `SUSPENDED` atau `DISABLED`.
5. **Jaminan Rollback & Atomisitas Penyimpanan**:
   - Kegagalan simulasi I/O disk saat penulisan akun baru harus memicu rollback memori penuh sehingga tidak ada orphan record.
6. **Zero-Credential Logging**:
   - Log audit diverifikasi tidak memuat raw tokens, secrets, atau parameter sensitif.
7. **Kerapian Sistem**:
   - `compile_applet` dan `lint_applet` tetap 0 errors (CLEAN), dan seluruh 336 baseline test sebelumnya tetap 100% lulus.

---

## 10. Stop Condition & Konfirmasi Verifikasi

Spesifikasi arsitektur **MVS-B2.5D.0** telah selesai dirumuskan secara komprehensif.

* **Mode Operasi**: **SPECIFICATION / SECURITY AUDIT ONLY**.
* **Modifikasi Runtime**: **0 baris kode runtime diubah** (tidak ada perubahan pada `backend/`, `src/`, atau `package.json`).
* **Status Google Login Publik**: **TETAP TIDAK AKTIF (NOT ACTIVE)**.
* **Tindakan Lanjutan**: Menunggu persetujuan pengguna sebelum melanjutkan ke implementasi terisolasi MVS-B2.5D.1.
