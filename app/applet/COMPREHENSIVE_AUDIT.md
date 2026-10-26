# NutriBodySim — Comprehensive Repository Audit & Architecture Gap Analysis
# Master Validation System (MVS) — Deep Codebase Reality Check & Strategic Roadmap

---

## Kontrol Dokumen & Status Evaluasi

* **Dokumen**: Comprehensive Repository Audit & Architecture Gap Analysis
* **Aplikasi**: NutriBodySim (Platform Laboratorium Riset Komputasi Nutrisi & Fisiologi)
* **Mode Operasi**: **READ-ONLY AUDIT — ZERO RUNTIME CHANGES**
* **Tanggal Pelaksanaan**: 21 Oktober 2026
* **Status Verifikasi Teknis**:
  - **Vitest Test Suite**: **53 passed (53 total test files)**
  - **Total Tests Executed**: **1.563 passed (1.563 total tests, 100% pass rate)**
  - **TypeScript Compilation (`tsc --noEmit`)**: **0 errors (CLEAN)**
  - **Applet Build (`npm run build`)**: **SUCCEEDED**
  - **Runtime Code Modifications**: **0 baris kode diubah (STRICT ZERO RUNTIME CHANGES)**
  - **Status Google Login Publik**: **TETAP TIDAK AKTIF (STRICTLY INACTIVE)**
  - **Status Database Seed/State**: **Tidak mengalami mutasi atau re-seed**

---

## 1. Ringkasan Eksekutif (Executive Summary)

Audit komprehensif ini dilakukan secara menyeluruh terhadap seluruh kode sumber aktual di repositori NutriBodySim, mencakup direktori `backend/`, `scientific/`, `src/`, `storage/`, `data/`, dan `scripts/`. 

Pemeriksaan ini bertujuan memberikan peta fakta teknis yang independen dan berbasis bukti nyata, mengonfirmasi status kepatuhan dari seluruh milestone sebelumnya (MVS-B1, B2.1–B2.5, C.0–C.4, D.0–D.3), mengidentifikasi celah arsitektur (*architecture gaps*), serta merumuskan rekomendasi rencana aksi yang efisien untuk pengembangan selanjutnya guna menghindari pemborosan token dan pekerjaan berulang (*re-work*).

### Temuan Utama:
1. **Kestabilan Pengujian Luar Biasa**: Repositori memiliki **1.563 unit dan integrasi test** yang seluruhnya berstatus **PASS** dalam waktu ~30 detik, membuktikan fondasi matematika ilmiah, simulasi fisiologi, dan keamanan otorisasi backend memiliki cakupan uji (*test coverage*) yang sangat tinggi.
2. **Kesiapan Modul OIDC & Provisioning**: Engine OIDC (C.1–C.4) dan modul provisioning transaksional identitas Google (D.1–D.2) telah terpasang dengan isolasi ketat di sisi server. Google Login publik tetap aman dan tidak aktif.
3. **Penyekatan Keamanan RBAC & RegisteredUser**: Hirarki peran telah disempurnakan dengan peran dasar nir-hak-akses `RegisteredUser` (`permissions: []`), mencegah eskalasi hak istimewa pada akun baru.
4. **Celah Arsitektur Kritis (Gaps)**:
   - *Database Concurrency*: Penyimpanan data menggunakan file tunggal JSON (`data/nutribodysim_db.json`) dengan manipulasi in-memory dan atomic file rename. Belum mendukung konkurensi multi-proses atau distributed transaction.
   - *Ephemerality Session & OIDC Transaction*: Session store dan OIDC transaction store berbasis memori proses Node.js (`MemorySessionStore` & `MemoryOIDCTransactionStore`).
   - *Ketiadaan Autentikasi Kredensial Produksi*: Endpoint `POST /auth/login` berstatus 501 `PRODUCTION_AUTH_BLOCKED`. Belum ada hash penyimpanan sandi lokal (seperti argon2/bcrypt).
   - *Pemblokir Penautan Akun (D.3)*: Fitur penautan akun (Explicit Account Linking) secara tepat diblokir karena membutuhkan re-autentikasi (step-up auth) dan autentikasi kredensial produksi.

---

## 2. Inventarisasi Direktori & Kode Sumber Aktual

### 2.1 Struktur Pohon Direktori Utama
```
NutriBodySim/
├── backend/
│   ├── auth/
│   │   ├── oidc/                   # Mesin Google OIDC & Identity Mapping (MVS-B2.5C & D)
│   │   │   ├── config.ts           # Konfigurasi runtime OIDC & environment guard
│   │   │   ├── index.ts            # Barrel exports OIDC
│   │   │   ├── jwks.ts             # Google JWKS cache & dynamic public key fetcher
│   │   │   ├── orchestrator.ts     # Boundary callback & validasi state/nonce OIDC
│   │   │   ├── primitives.ts       # Cryptographic primitives (timingSafeEqual, SHA-256)
│   │   │   ├── provisioner.ts      # GoogleIdentityProvisioningService & mutex lock
│   │   │   ├── tokenExchange.ts    # Code-to-token HTTPS exchange handler
│   │   │   ├── transactionStore.ts # Pre-auth OIDC transaction store (TTL 10 min)
│   │   │   ├── types.ts            # Kontrak TypeScript OIDC & VerifiedOIDCIdentity
│   │   │   └── verifier.ts         # Google ID Token verifier (RS256, audience, nonce)
│   │   ├── authConfig.ts           # Pemisahan mode demo vs mode produksi
│   │   ├── authMiddleware.ts       # Token extractor, requireAuth, object authorization
│   │   ├── bootstrapMainAdmin.ts   # Logika isolasi bootstrap Main Administrator
│   │   ├── objectAuth.ts           # Kontrak otorisasi objek domain BOLA
│   │   ├── rbacMiddleware.ts       # Engine RBAC, VALID_ROLES, VALID_PERMISSIONS
│   │   ├── roleApprovalEngine.ts   # Persetujuan peran berpemerintahan MANAGE_PRIVILEGED_ROLES
│   │   ├── roleRequestValidation.ts# Validasi pengajuan peran & sanitasi teks
│   │   └── sessionStore.ts         # MemorySessionStore (SHA-256 token hashing)
│   ├── database/
│   │   ├── store.ts                # DatabaseStore: atomic saveToDisk, rollback memory, audit
│   │   └── types.ts                # Tipe entitas DB (User, Project, Dataset, Material, dll.)
│   ├── routes/
│   │   └── api.ts                  # Main REST API Express router (2.472 baris)
│   └── __tests__/                  # 16 Backend Test Suites (376 tests)
│       ├── adversarialRemediationMVS_B2_4B.test.ts
│       ├── adversarialVerificationMVS_B2_5A1.test.ts
│       ├── authSessionMVS_B2.test.ts
│       ├── identityRoleRequestMVS_B2_5A.test.ts
│       ├── mainAdminBootstrapMVS_B2_5B2.test.ts
│       ├── objectAuthorizationMVS_B2_4.test.ts
│       ├── oidcAccountProvisioningMVS_B2_5D2.test.ts
│       ├── oidcOrchestrationMVS_B2_5C4.test.ts
│       ├── oidcPrimitivesTransactionMVS_B2_5C1.test.ts
│       ├── oidcTokenExchangeMVS_B2_5C3.test.ts
│       ├── oidcTokenVerifierMVS_B2_5C2.test.ts
│       ├── rbacHardeningMVS_B2_5B1.test.ts
│       ├── rbacPermissionMVS_B2_3.test.ts
│       ├── registeredUserRbacMVS_B2_5D1.test.ts
│       ├── secureRoleApprovalMVS_B2_5B3.test.ts
│       └── sessionConsistencyMVS_B2_5B4.test.ts
├── scientific/                     # Mesin Inti Komputasi Ilmiah & Fisiologi (Bebas UI)
│   ├── data/                       # Pipeline dataset, versioning, inferensial, regresi
│   ├── engine/                     # AST Evaluator, CalculationEngine, ValidationEngine
│   ├── provenance/                 # Persistence silsilah data ilmiah
│   ├── registry/                   # Modul demo & formula terdaftar
│   ├── resolvers/                  # Parameter & module resolver
│   ├── units/                      # Konverter satuan dimensional
│   ├── validator/                  # Input validation engine
│   ├── index.ts                    # Public barrel export modul scientific
│   ├── types.ts                    # Tipe kontrak ilmiah
│   └── __tests__/                  # 37 Scientific Test Suites (1.187 tests)
├── src/                            # Antarmuka Pengguna (React 19 + Vite + Tailwind CSS v4)
│   ├── components/                 # Komponen UI modular
│   │   ├── calculator/             # Kalkulator metabolisme & rumus
│   │   ├── codelab/                # Lingkungan eksekusi formula berbasis AST
│   │   ├── common/                 # Error boundary & komponen bersama
│   │   ├── dashboard/              # Dasbor analitik, TreeOfLife3D, OrganEducationModal
│   │   ├── datalab/                # Eksplorasi dataset & visualisasi distribusi
│   │   ├── docs/                   # Panduan kontribusi ilmiah
│   │   ├── experiments/            # Sandbox pengujian hipotesis
│   │   ├── layout/                 # Header (user switcher, global search), Sidebar
│   │   ├── materials/              # Bank materi ilmiah, DocumentReader (PDF/TXT)
│   │   ├── notebook/               # Buku catatan komputasi interaktif
│   │   ├── projects/               # Manajemen proyek riset
│   │   ├── provenance/             # Audit jejak silsilah riset ilmiah
│   │   ├── research/               # ResearchWorkspace (perencanaan variabel & analisis)
│   │   ├── scientific/             # Registri modul & formula ilmiah
│   │   ├── search/                 # Modal pencarian global (Ctrl+K)
│   │   └── statistics/             # Laboratorium inferensial & statistik
│   ├── data/                       # Dataset edukasi organ & nutrisi
│   ├── services/                   # Service client workspace riset
│   ├── api.ts                      # Client API HTTP singleton dengan session manager
│   ├── App.tsx                     # Root React component
│   ├── index.css                   # Global Tailwind CSS (@import "tailwindcss";)
│   ├── main.tsx                    # Entry point DOM React
│   └── types.ts                    # Kontrak tipe TypeScript frontend
├── storage/                        # Penyimpanan lokal berkas materi
│   └── materials/                  # Berkas materi terlindungi (BOLA & path traversal check)
├── data/
│   ├── nutribodysim_db.json        # Database lokal JSON utama
│   └── temp_uploads/               # Direktori sementara unggahan multer
├── scripts/
│   └── bootstrap-main-admin.ts     # CLI utilitas Main Administrator bootstrap
├── app/applet/                     # Arsip spesifikasi dan status MVS (C.0–D.3)
├── package.json                    # Dependensi dan build scripts
├── server.ts                       # Entry point Express full-stack + Vite integration
├── tsconfig.json                   # Konfigurasi TypeScript
└── vite.config.ts                  # Konfigurasi Vite
```

---

## 3. Audit Lapisan Stack Teknologi & Build Pipeline

### 3.1 Ringkasan Dependensi (`package.json`)
* **Framework Frontend**: React 19.0.1, React-DOM 19.0.1.
* **Styling**: Tailwind CSS v4.3.3 (`@tailwindcss/vite` v4.3.3).
* **Ikonografi & Animasi**: `lucide-react` v0.546.0, `motion` v12.23.24.
* **Grafika 3D**: `three` v0.186.0 (digunakan pada `TreeOfLife3D.tsx`).
* **Server Backend**: Express 4.21.2, `multer` 2.4.0 (unggah berkas), `dotenv` 17.2.3.
* **Kriptografi & OIDC**: `jose` v6.2.12 (verifikasi RS256 JWKS & manipulasi JWT).
* **AI Integration**: `@google/genai` v2.4.0 (tercantum, namun belum diintegrasikan ke endpoint publik).
* **Tooling Build & Test**: `vite` 8.3.0, `esbuild` 0.25.0, `tsx` 4.21.0, `typescript` 7.0.2, `vitest` 5.0.1.

### 3.2 Audit Pipeline Skrip
* `npm run dev`: Menjalankan `tsx server.ts`. Server Express berjalan di port 3000 dan memuat Vite dalam *middleware mode*.
* `npm run build`: Menjalankan `vite build` (kompilasi aset SPA ke `dist/`) dilanjutkan `esbuild server.ts --bundle --platform=node --format=cjs --packages=external --sourcemap --outfile=dist/server.cjs`.
* `npm run start`: Menjalankan `node dist/server.cjs` (mode produksi terbundel).
* `npm run lint`: Menjalankan `tsc --noEmit` (pemeriksaan sintaks & tipe bebas error).
* `npm test`: Menjalankan `vitest run` secara headless.
* `npm run admin:bootstrap`: Menjalankan CLI `scripts/bootstrap-main-admin.ts`.

---

## 4. Audit Lapisan Basis Data & Persistence (`store.ts`)

### 4.1 Mekanisme Penyimpanan
* Data disimpan dalam satu berkas JSON: `data/nutribodysim_db.json`.
* State runtime ditampung dalam memori (`this.state: DatabaseState`).
* **Operasi Tulis ke Disk**: Menggunakan fungsi privat `saveToDisk()` dengan metode penulisan berkas temporer acak (`tmpFile = ${DB_FILE}.tmp.${Date.now()}.${random}`) dilanjutkan dengan `fs.renameSync(tmpFile, DB_FILE)`. Metode ini memberikan jaminan atomisitas filesystem POSIX pada tingkat single-machine (tidak akan menghasilkan file JSON korup setengah tulis jika proses mati mendadak).

### 4.2 Snapshot & Rollback In-Memory
* Pada operasi kritis seperti `provisionGoogleUser` dan `bootstrapMainAdmin`, sistem mencatat indeks dan state sebelum mutasi dilakukan.
* Jika `saveToDisk()` melempar eksepsi (misalnya kehabisan disk space atau kesalahan IO), blok `catch` secara manual menghapus entitas baru dari array memori (`this.state.users`, `this.state.external_identities`, `this.state.audit_logs`) untuk mencegah *dirty reads* atau inkonsistensi memori.

### 4.3 Data Aktual di `nutribodysim_db.json`
* **Users (4 akun dasar)**:
  1. `usr_researcher`: Dr. Elena Rostova (Researcher, ACTIVE, `researcher@nutribodysim.org`)
  2. `usr_lecturer`: Prof. Marcus Vance (Lecturer, ACTIVE, `lecturer@nutribodysim.org`)
  3. `usr_student`: Alex Chen (Student, ACTIVE, `student@nutribodysim.org`)
  4. `usr_admin`: Sarah Jenkins (Admin, ACTIVE, `admin@nutribodysim.org`)
* **Proyek Riset**: 2 proyek dasar.
* **Materi/Dokumen**: 2 materi terdaftar dengan file fisik tersimpan di `storage/materials/`.
* **Formula Ilmiah**: 5 formula (termasuk BMR Mifflin-St Jeor, Harris-Benedict, TDEE).
* **Variabel & Parameter**: 6 variabel, 4 parameter.
* **Audit Logs**: 11 entri log terdaftar.
* **Role Requests & External Identities**: 0 entri (bersih dari state sisa pengujian).

---

## 5. Audit Lapisan Autentikasi, Sesi, dan RBAC

### 5.1 Arsitektur Sesi (`sessionStore.ts`)
* Berbasis token acak berentropi tinggi 256-bit (`crypto.randomBytes(32).toString('hex')`).
* Token tidak disimpan dalam bentuk teks polos; di-hash menggunakan SHA-256 (`crypto.createHash('sha256').update(token).digest('hex')`).
* Sesi memiliki atribut `expiresAt` dan `tokenVersion`. Jika `token_version` pengguna dinaikkan pada database (misalnya saat logout-all atau penurunan peran), seluruh sesi lama seketika tidak valid (*stale token version*).

### 5.2 Otorisasi Berbasis Peran (RBAC) & Izin
* **Daftar Peran Sah (`VALID_ROLES`)**:
  - `RegisteredUser`: Peran dasar pengguna terverifikasi nir-hak-akses (default permissions: `[]`).
  - `Student`: Mahasiswa riset (permissions: `['VIEW', 'USE', 'CLONE']`).
  - `Lecturer`: Dosen pembimbing (permissions: `['VIEW', 'USE', 'CREATE', 'CLONE', 'EDIT', 'SHARE', 'VERIFY']`).
  - `Researcher`: Peneliti mandiri (permissions: `['VIEW', 'USE', 'CREATE', 'CLONE', 'VERIFY']`).
  - `Admin`: Administrator operasional (seluruh izin operasional standar).
  - *Main Administrator*: Ditentukan oleh flag `is_main_admin === true`, memegang otoritas tunggal `MANAGE_PRIVILEGED_ROLES`.

### 5.3 Otorisasi Objek Domain (BOLA Defense)
* Modul `backend/auth/objectAuth.ts` dan middleware `canAccess*` pada `backend/auth/authMiddleware.ts` memvalidasi kepemilikan objek (projects, datasets, notebooks, materials, notes, teams, experiments).
* Pengguna dilarang mengakses objek privat milik pengguna lain meskipun memiliki izin global `VIEW` atau `EDIT`.

### 5.4 Mesin Pengajuan & Persetujuan Peran (`roleApprovalEngine.ts`)
* Validasi pengajuan peran (`roleRequestValidation.ts`) memeriksa syarat teks, sanitasi XSS/karakter kontrol, dan hierarki peran yang diperbolehkan.
* Menggunakan transaksi aman di `store.ts` untuk menyetujui (`approveRoleRequest`) atau menolak (`rejectRoleRequest`).
* Administrator tidak dapat menyetujui pengajuan perannya sendiri (*self-approval prevention*).
* Eskalasi peran ke `Admin` hanya dapat disetujui oleh Main Administrator (`MANAGE_PRIVILEGED_ROLES`).

---

## 6. Audit Lapisan OIDC & Google Identity (`backend/auth/oidc/`)

### 6.1 Status Implementasi Komponen OIDC
1. **`primitives.ts`**: Fungsi utilitas kriptografi murni (`timingSafeStringEqual`, `sha256Hex`, `generateNonce`, `generatePKCECodes`).
2. **`jwks.ts`**: Pengambil dan penyimpan cache kunci publik Google (`https://www.googleapis.com/oauth2/v3/certs`) dengan rotasi berbasis HTTP Cache-Control `max-age`.
3. **`verifier.ts`**: Mesin verifikasi Google ID Token RS256 menggunakan `jose.jwtVerify`. Memvalidasi audience (`GOOGLE_CLIENT_ID`), issuer (`https://accounts.google.com` atau `accounts.google.com`), format sub, kedaluwarsa waktu, dan klaim `nonce`.
4. **`tokenExchange.ts`**: Handler penukaran kode otorisasi via HTTPS POST ke Google Token Endpoint, dengan dukungan penuh PKCE (`code_verifier`).
5. **`transactionStore.ts`**: Penyimpanan transaksi pra-autentikasi OIDC in-memory dengan kedaluwarsa 10 menit (600 detik) dan penghapusan otomatis transaksi kadaluwarsa.
6. **`orchestrator.ts`**: Boundary orkestrasi callback yang memvalidasi `state`, mencocokkan `nonce`, menukar kode otorisasi, dan memverifikasi token tanpa menyentuh database.
7. **`provisioner.ts` (`GoogleIdentityProvisioningService`)**: Layanan pemetaan internal transaksional. Mengunci sub & email dengan async mutex (`withKeyedLock`), menolak penggabungan otomatis (Anti-Auto-Merge), dan menetapkan akun baru secara default ke `RegisteredUser` dengan izin `[]`.

### 6.2 Status Aktivasi Publik
* **Google Login Publik**: **100% NON-AKTIF**.
* Tidak ada route OIDC publik yang dipasang pada `backend/routes/api.ts`.
* Layanan OIDC hanya dieksekusi melalui isolasi modul dan diverifikasi lewat unit/integration test.

---

## 7. Audit Lapisan Ilmiah & Simulasi (`scientific/`)

Modul `scientific/` adalah mesin komputasi mandiri tanpa dependensi DOM/frontend, terbagi dalam:
1. **AST Math Evaluator & Calculator Engine**: Mengevaluasi ekspresi matematika fisiologi secara aman tanpa menggunakan fungsi berbahaya `eval()` atau `Function()`.
2. **Konversi Satuan & Analisis Dimensional**: Menjaga integritas satuan energi (kcal, kJ, MJ), massa (kg, g, mg), konsentrasi darah (mg/dL, mmol/L), dan waktu.
3. **Pipeline Dataset & Analisis Statistik**:
   - `inferentialEngine.ts`: Uji t-Student (paired & independent), ANOVA satu arah, Chi-square.
   - `regressionEngine.ts`: Regresi linier sederhana & berganda, R², p-value, interval kepercayaan.
   - `powerEngine.ts`: Analisis kekuatan statistik (*statistical power*), ukuran sampel minimum, dan effect size (Cohen's d).
   - `nonParametricEngine.ts`: Uji Mann-Whitney U, Wilcoxon signed-rank, Kruskal-Wallis.
4. **Silsilah Data (Data Provenance)**: Setiap kalkulasi dan transformasi dataset mencatat riwayat run, versi formula, dan checksum input.

---

## 8. Audit Lapisan Frontend (`src/`)

1. **State & Navigasi**:
   - Navigasi berbasis state tab pada `Sidebar.tsx` (Dashboard, Projects, Materials, Scientific Registry, Calculator, DataLab, StatisticsLab, CodeLab, Notebook, Experiments, Provenance, Research Workspace).
   - `Header.tsx` menyediakan tombol pencarian global (Ctrl+K) dan pemilih peran pengguna demo (*user switcher*).
2. **Integrasi Klien API (`src/api.ts`)**:
   - Berkomunikasi melalui Bearer token yang disimpan pada `sessionStorage`.
   - Menggunakan metode `acquireSessionToken` yang memanggil `POST /api/auth/demo-login` secara otomatis jika sesi belum ada di lingkungan demo.
3. **Keterbatasan Frontend Terkait Auth Produksi**:
   - Frontend saat ini belum memiliki halaman login/register formal (email + password form) atau tombol "Sign in with Google" karena endpoint produksi belum diaktifkan.

---

## 9. Hasil Verifikasi Pengujian Aktual

Seluruh pengujian dijalankan ulang secara langsung pada sesi audit ini dengan hasil sebagai berikut:

```
Test Files  53 passed (53)
Tests       1563 passed (1563)
Start at    05:25:28
Duration    30.22s

Rincian Test Suites:
- Backend Auth, RBAC, OIDC, & Governance: 16 test files (376 tests)
- Scientific Computation, Fisiologi, & Dataset: 37 test files (1.187 tests)

Pemeriksaan Tipe (TypeScript):
$ npx tsc --noEmit
Exit Code: 0 (Zero errors / Clean)

Pemeriksaan Build:
$ npm run build
vite build completed in 680ms
esbuild server.ts completed successfully -> dist/server.cjs
```

---

## 10. Architecture Gap Analysis (Analisis Kesenjangan Arsitektur)

Berdasarkan pemeriksaan langsung terhadap kode aktual, berikut adalah inventaris kesenjangan arsitektur yang perlu diperhatikan:

### 10.1 GAP 1: Ketiadaan Sistem Autentikasi Kredensial Lokal Produksi
* **Kondisi Aktual**: `POST /api/auth/login` mengembalikan respon `501 PRODUCTION_AUTH_BLOCKED`. Database `User` tidak memiliki kolom `password_hash` atau salt.
* **Dampak**: Sistem sepenuhnya bergantung pada `demo-login` fixture. Belum ada pengguna luar yang bisa mendaftar secara mandiri menggunakan kredensial lokal yang aman.
* **Rekomendasi**: Rancang skema penyimpanan kredensial berstandar industri (misal Argon2id atau scrypt) dengan pembatasan laju (*rate limiting*) dan mekanisme reset kata sandi sebelum membuka akses publik.

### 10.2 GAP 2: Persistensi Konkurensi & File Lock JSON Database
* **Kondisi Aktual**: Basis data berupa file `data/nutribodysim_db.json`. Meskipun `fs.renameSync` bersifat atomik, jika terdapat beberapa proses node (misalnya clustering horizontal di Cloud Run) membaca dan menulis file yang sama secara bersamaan, kondisi *lost update* dapat terjadi.
* **Dampak**: Terbatas pada deployment single-process Node.js.
* **Rekomendasi**: Untuk lingkungan produksi berskala besar, pisahkan penyimpanan relational ke database sesungguhnya (PostgreSQL / Cloud SQL) atau pasang distributed advisory lock.

### 10.3 GAP 3: Ephemerality Sesi dan OIDC Transaction Store
* **Kondisi Aktual**: Sesi dan transaksi OIDC disimpan di memori RAM proses Node.js (`MemorySessionStore` dan `MemoryOIDCTransactionStore`).
* **Dampak**: Saat server di-restart atau terjadi auto-scaling, sesi pengguna dan transaksi OIDC yang sedang berjalan akan hilang.
* **Rekomendasi**: Siapkan adaptor penyimpanan sesi persisten (misalnya Redis atau tabel database sesi) untuk mendukung ketersediaan tinggi (*high availability*).

### 10.4 GAP 4: Prasyarat Penautan Akun Eksplisit (Explicit Account Linking Blocker)
* **Kondisi Aktual**: Milestone MVS-B2.5D.3 mengidentifikasi bahwa implementasi runtime penautan akun terblokir karena:
  1. Ketiadaan autentikasi kredensial produksi lokal.
  2. Ketiadaan protokol re-autentikasi (step-up authentication).
  3. Skema transaksi OIDC belum membawa metadata `purpose: 'ACCOUNT_LINKING'`.
* **Dampak**: Pengguna lama belum dapat menautkan akun Google ke akun lokal mereka secara mandiri.
* **Rekomendasi**: Selesaikan fondasi kredensial lokal dan step-up auth sebelum mengimplementasikan penautan akun.

---

## 11. Rekomendasi Peta Jalan Pengembangan (Next Steps Roadmap)

Untuk menjaga efisiensi pengembangan dan memastikan kepatuhan tata kelola keamanan, urutan langkah selanjutnya direkomendasikan sebagai berikut:

```
+-------------------------------------------------------------------------+
| Tahap Selanjutnya: Fondasi Kredensial Lokal & Re-autentikasi (B2.5E)     |
| 1. Spesifikasi skema password hashing (Argon2id/scrypt) & rate-limiting |
| 2. Endpoint re-autentikasi (step-up auth) untuk operasi sensitif         |
+-------------------------------------------------------------------------+
                                    │
                                    ▼
+-------------------------------------------------------------------------+
| Tahap Lanjutan: Pembukaan Blokir Penautan Akun Eksplisit (B2.5F)       |
| 1. Ekstensi OIDCTransaction dengan purpose: 'ACCOUNT_LINKING'           |
| 2. Implementasi runtime Account Linking Service & UI integrasi           |
+-------------------------------------------------------------------------+
                                    │
                                    ▼
+-------------------------------------------------------------------------+
| Tahap Produksi: Aktivasi Terkendali Google Login Publik & Persistensi   |
| 1. Migrasi sesi ke penyimpanan persisten / multi-instance ready         |
| 2. Pembuatan rute callback publik & integrasi UI tombol masuk Google    |
+-------------------------------------------------------------------------+
```

---

## 12. Kesimpulan Akhir

Repositori NutriBodySim berada dalam kondisi **sangat sehat, bersih, dan terstruktur rapi**. Seluruh 1.563 pengujian lulus 100%, kompilasi TypeScript bersih tanpa galat, dan pemisahan antara mesin ilmiah, kontrol otorisasi RBAC, serta subsistem OIDC berjalan sesuai standar arsitektur terisolasi. 

Audit ini mengonfirmasi bahwa tidak ada regresi teknis dan repositori siap melanjutkan ke fase perencanaan berikutnya sesuai arahan pengguna.
