# NutriBodySim MVS-B2.5C.1 — Laporan Audit & Verifikasi Keamanan
# OIDC Security Primitives & Transaction Foundation

---

## 1. Ringkasan Eksekutif & Status Milestone

* **Milestone**: MVS-B2.5C.1 — OIDC Security Primitives & Transaction Foundation
* **Mode Operasi**: **IMPLEMENTATION — FOUNDATIONAL COMPONENTS ONLY**
* **Status**: **PASS / READY FOR MVS-B2.5C.2**
* **Tanggal Penyelesaian**: 18 Oktober 2026
* **Cakupan Kode Sumber**:
  - `backend/auth/oidc/types.ts`: Kontrak tipe, konfigurasi, model transaksi, dan proyeksi klien.
  - `backend/auth/oidc/primitives.ts`: Primitif kriptografi murni (PKCE S256, State, Nonce, Timing-Safe).
  - `backend/auth/oidc/config.ts`: Validasi konfigurasi fail-closed, proteksi placeholder, sanitasi log.
  - `backend/auth/oidc/transactionStore.ts`: Abstraksi dan implementasi `MemoryOIDCTransactionStore` dengan mitigasi memory leak.
  - `backend/auth/oidc/index.ts`: Barrel export modul OIDC.
  - `backend/__tests__/oidcPrimitivesTransactionMVS_B2_5C1.test.ts`: 30 unit & adversarial test cases.
* **Hasil Pengujian**:
  - Test suite OIDC MVS-B2.5C.1: **30 dari 30 tes LULUS (100%)**.
  - Test suite Backend Keseluruhan: **11 file tes, 278 tes LULUS (100%)**.
  - TypeScript Compiler (`tsc --noEmit`): **0 errors (CLEAN)**.
  - Applet Build (`compile_applet`): **SUCCEEDED**.

---

## 2. Kepatuhan Batasan Scope (Strict Scope Boundary Compliance)

Sesuai instruksi MVS-B2.5C.1, batasan berikut dipatuhi 100%:
1. **Google Login Belum Diaktifkan**: Tidak ada login otomatis atau rute OIDC publik yang dibuka pada runtime.
2. **Endpoint Callback Belum Dibuat**: Endpoint pertukaran token dan callback belum dipasang pada `api.ts`.
3. **ID Token Produksi Belum Diproses**: Belum ada verifikasi token publik atau pembentukan sesi user OIDC.
4. **Isolasi Penuh dari Sesi Pengguna**: Transaksi OIDC disimpan dalam `MemoryOIDCTransactionStore` terpisah dan tidak dicampur dengan `MemorySessionStore`.
5. **Tidak Ada Perubahan RBAC / Role**: Model peran (`Student`, `Lecturer`, `Researcher`, `Admin`), permission, `ExternalIdentity`, dan `bootstrapMainAdmin` tidak dimodifikasi.
6. **Demo Login Dipertahankan**: Alur pengujian lokal tetap utuh tanpa gangguan.
7. **Zero External Supply-Chain Risk**: **0 dependensi npm baru**. Semua primitif kriptografi dibangun di atas modul native `node:crypto`.

---

## 3. Matriks Tipe & Kontrak yang Diimplementasikan

### 3.1. `OIDCConfig` & `OIDCConfigValidationResult`
* Mengunci parameter Google OAuth/OIDC: `clientId`, `clientSecret`, `issuer`, `authorizationEndpoint`, `tokenEndpoint`, `jwksUri`, `redirectUri`, `allowedScopes`, `transactionTtlSeconds`, `clockSkewToleranceSeconds`, `cookieSameSite`, `cookieSecure`.
* Validasi fail-closed: jika `enabled === true`, seluruh parameter wajib divalidasi.
* Menolak placeholder (misal `YOUR_CLIENT_ID`, `YOUR_CLIENT_SECRET`, `changeme`).
* Menolak issuer arbitrer: hanya mengizinkan `https://accounts.google.com` dan `accounts.google.com`.
* Mewajibkan HTTPS pada `redirectUri` di lingkungan produksi.

### 3.2. `OIDCTransaction` (Server-Only Entity)
Menyimpan data kriptografis sensitif yang **HARUS TETAP DI SERVER**:
* `id`: 256-bit CSPRNG token (64 hex characters).
* `state`: 256-bit CSPRNG token (64 hex characters).
* `stateHash`: SHA-256 hash dari state untuk indeks pencarian cepat O(1) tanpa memicu kebocoran waktu.
* `nonce`: 256-bit CSPRNG token untuk mitigasi replay token.
* `codeVerifier`: 43–128 karakter unreserved RFC 7636 (default 64 karakter).
* `codeChallenge`: SHA-256 base64url hash dari code_verifier.
* `codeChallengeMethod`: Strictly `'S256'`.
* `consumed`: boolean flag pencegah replay.
* `clientBinding`: binding fingerprint browser (opsional).
* `createdAt` & `expiresAt`: timestamp siklus hidup transaksi.

### 3.3. `OIDCClientTransactionData` (Client-Safe Projection)
Proyeksi publik yang aman dikirim ke browser / frontend:
* **HANYA BERISI**: `transactionId`, `state`, `codeChallenge`, `codeChallengeMethod`, `expiresAt`.
* **SECRETS EXCLUDED**: `codeVerifier`, `stateHash`, `clientSecret`, `consumed` status **TIDAK PERNAH DIBOCORKAN**.

### 3.4. `IOIDCTransactionStore` & `MemoryOIDCTransactionStore`
* Kontrak penyimpanan dengan metode: `createTransaction`, `getTransaction`, `getTransactionByState`, `consumeTransaction`, `deleteTransaction`, `cleanExpiredTransactions`, `getActiveTransactionsCount`, `getCapacity`.
* Mendukung batasan kapasitas maksimum (default: 5.000 transaksi) dengan pembersihan otomatis (*proactive expired cleanup*) dan FIFO eviction untuk mencegah memory leak dan serangan DoS.

---

## 4. Bukti Validasi Kriptografi & RFC 7636 Compliance

### 4.1. PKCE S256 Test Vector Resmi (RFC 7636 Appendix B)
* **Code Verifier**: `dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk`
* **Expected Challenge**: `E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM`
* **Hasil Uji**:
  ```ts
  const computedChallenge = generateCodeChallenge(rfcVerifier, 'S256');
  expect(computedChallenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'); // PASS
  expect(verifyCodeChallenge(rfcVerifier, computedChallenge, 'S256')).toBe(true);  // PASS
  ```
* **Penolakan Plain Method**:
  Metode `'plain'` ditolak secara mutlak (`Insecure PKCE challenge method 'plain' rejected. NutriBodySim strictly requires 'S256'`).

### 4.2. Penolakan Modifikasi Verifier
Perubahan 1 karakter pada verifier menggagalkan verifikasi tantangan secara instan (`verifyCodeChallenge` menghasilkan `false`).

---

## 5. Hasil Pengujian Matriks Keamanan (30/30 Tests PASS)

| Kategori Tes | Kasus Uji | Hasil |
| :--- | :--- | :--- |
| **PKCE S256** | RFC 7636 Appendix B test vector | **PASS** |
| **PKCE S256** | Karakter unreserved RFC 7636 Section 4.1 (66 karakter, bebas bias modulo) | **PASS** |
| **PKCE S256** | Penegakan batas panjang verifier (43 - 128 karakter) | **PASS** |
| **PKCE S256** | Penolakan metode plain | **PASS** |
| **PKCE S256** | Deteksi modifikasi sekecil apa pun pada verifier | **PASS** |
| **Anti-CSRF State** | Entropi CSPRNG 256-bit base64url | **PASS** |
| **Anti-CSRF State** | Penolakan state kosong, null, pendek, atau karakter ilegal | **PASS** |
| **Nonce Tokens** | Entropi CSPRNG 256-bit | **PASS** |
| **Nonce Tokens** | Penolakan nonce tidak valid, kosong, atau pendek | **PASS** |
| **Timing-Safe Equal** | Komparasi identik string | **PASS** |
| **Timing-Safe Equal** | Penolakan string berbeda | **PASS** |
| **Timing-Safe Equal** | Komparasi panjang berbeda tanpa kebocoran waktu | **PASS** |
| **Timing-Safe Equal** | Penanganan aman input null / undefined | **PASS** |
| **Lifecycle Transaksi** | Proyeksi data klien tidak membocorkan rahasia server | **PASS** |
| **Lifecycle Transaksi** | Konsumsi sukses pada state & nonce yang cocok | **PASS** |
| **Single-Use Replay** | Penolakan konsumsi kedua kali (`TRANSACTION_ALREADY_CONSUMED`) | **PASS** |
| **State Tampering** | Penolakan state yang dipalsukan (`INVALID_STATE`) | **PASS** |
| **Nonce Tampering** | Penolakan nonce yang tidak sesuai (`NONCE_MISMATCH`) | **PASS** |
| **Browser Binding** | Validasi fingerprint sesi klien (mismatch ditolak, match diterima) | **PASS** |
| **Kedaluwarsa (Expiry)** | Penolakan transaksi melewati batas TTL + toleransi clock skew | **PASS** |
| **Konkurensi** | Isolasi transaksi bersamaan tanpa benturan data | **PASS** |
| **ID Transaksi** | Penanganan ID fiktif / tidak ditemukan (`TRANSACTION_NOT_FOUND`) | **PASS** |
| **Storage Bounding** | Kapasitas memori terbatas dan FIFO eviction saat penuh | **PASS** |
| **Pembersihan Memori** | Pembersihan transaksi kedaluwarsa secara akurat | **PASS** |
| **Validasi Konfigurasi**| Mode DISABLED diizinkan beroperasi aman | **PASS** |
| **Validasi Konfigurasi**| Mode ENABLED fail-closed jika atribut wajib hilang | **PASS** |
| **Validasi Konfigurasi**| Penolakan nilai placeholder | **PASS** |
| **Validasi Konfigurasi**| Penolakan issuer arbitrer / tidak tepercaya | **PASS** |
| **Validasi Konfigurasi**| Penegakan HTTPS di produksi untuk redirect URI | **PASS** |
| **Sanitasi Log** | `clientSecret` dibersihkan dari objek konfigurasi untuk log publik | **PASS** |

---

## 6. Keputusan Arsitektur & Justifikasi Teknis

1. **Penggunaan Native `node:crypto` vs Library Eksternal**:
   - Meminimalkan *attack surface* dan *dependency supply-chain risk*.
   - Fungsi `crypto.randomBytes`, `crypto.createHash`, dan `crypto.timingSafeEqual` tersedia secara bawaan di Node.js runtime, berkinerja tinggi, dan stabil.
2. **Rejection Sampling untuk Karakter Verifier PKCE**:
   - Menghilangkan *modulo bias* matematis pada pemilihan karakter `[A-Za-z0-9-._~]`, menjamin entropi seragam 100%.
3. **Double Hash Indeks State**:
   - State di-hash menggunakan SHA-256 untuk pemetaan kunci internal pada Map penyimpanan, menghindari kebocoran perbandingan string saat pencarian awal, kemudian diverifikasi menggunakan `timingSafeEqual`.
4. **Mitigasi DoS & Memory Leak**:
   - Penyimpanan `MemoryOIDCTransactionStore` dibatasi dengan `maxCapacity` dan FIFO eviction.
   - Pembersihan kedaluwarsa (`cleanExpiredTransactions`) dijalankan secara proaktif saat kapasitas terisi.

---

## 7. Dependensi & Kesiapan Milestone Berikutnya

* **Dependensi Baru**: **0**. Tidak ada package eksternal yang di-install ke `package.json`.
* **Kesiapan untuk MVS-B2.5C.2 (OIDC Network & Token Exchange)**:
  - Modul OIDC foundation telah siap diekspor via `backend/auth/oidc/index.ts`.
  - Pada milestone MVS-B2.5C.2, handler pertukaran kode Google ke Google Token Endpoint (`https://oauth2.googleapis.com/token`) dan verifikasi tanda tangan ID Token via JWKS Google dapat mengonsumsi `codeVerifier` dan `nonce` yang disediakan oleh `MemoryOIDCTransactionStore.consumeTransaction`.
* **Batasan Multi-Instance**:
  - `MemoryOIDCTransactionStore` berbasis memori lokal instance. Untuk arsitektur multi-pod / horizontal scaling pada fase produksi akhir, interface `IOIDCTransactionStore` telah dirancang siap diganti dengan implementasi Redis atau Firestore tanpa mengubah kontrak antarmuka.

---

## 8. Status Akhir

**STATUS: PASS / READY FOR MVS-B2.5C.2**
Dokumentasi audit ini diterbitkan untuk checkpoint milestone MVS-B2.5C.1 NutriBodySim.
