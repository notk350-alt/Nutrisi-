# NutriBodySim MVS-B2.5D.3 — Explicit Account Linking Specification & Security Audit
# Master Validation System Phase B2.5D.3 — Technical Architecture & Threat Model

---

## Kontrol Dokumen & Meta

* **Proyek**: NutriBodySim (Sistem Simulasi & Laboratorium Komputasi Nutrisi dan Fisiologi)
* **Milestone**: MVS-B2.5D.3 (Master Validation System Phase B2.5D.3)
* **Judul**: Audit Kesiapan Keamanan, Spesifikasi Teknis Penautan Akun Eksplisit (Explicit Account Linking), State Machine Transaksional, dan Mitigasi Account Takeover
* **Mode Operasional**: **SPECIFICATION + SECURITY AUDIT ONLY (NO RUNTIME CODE CHANGES)**
* **Tanggal Audit**: 20 Oktober 2026
* **Status Kesiapan**: **PASS WITH BLOCKERS (IMPLEMENTATION BLOCKED)**
* **Status Google Login Publik**: **TETAP TIDAK AKTIF (STRICTLY INACTIVE)**
* **Governing Rule**:
  > *Milestone MVS-B2.5D.3 berstatus SPECIFICATION & SECURITY AUDIT ONLY. Seluruh kode backend aktif, model data, route API, konfigurasi runtime, dan pengujian yang sudah ada DILARANG DIUBAH pada tahap ini. Dokumen ini mendefinisikan audit kesiapan, arsitektur penautan akun eksplisit, state machine, matriks resolusi konflik, dan pemetaan dependensi yang menghalangi implementasi runtime hingga prasyarat terpenuhi.*

---

## 1. Konteks Sistem & Ringkasan Eksekutif

### 1.1 Posisi Milestone dalam Peta Arsitektur NutriBodySim
Hingga milestone **MVS-B2.5D.2**, NutriBodySim telah memverifikasi fondasi autentikasi OIDC dan pemetaan identitas server-side yang terisolasi:
1. **C.1**: Primitif kriptografis PKCE S256, Anti-CSRF state token, nonce token, dan penyimpanan transaksi in-memory atomik berbatas TTL (10 menit).
2. **C.2**: Engine verifikasi Google ID Token dengan validasi tanda tangan RS256 via Google JWKS, penegakan audience, issuer, clock skew, nonce, dan verifikasi email.
3. **C.3**: Handler pertukaran authorization code dengan PKCE verifier dan konsumsi transaksi single-use atomik.
4. **C.4**: Orkestrator alur login dan boundary callback yang menghasilkan objek `VerifiedOIDCIdentity` murni kepada pemanggil internal tepercaya.
5. **D.0**: Cetak biru spesifikasi pemetaan identitas dan kebijakan anti-auto-merge.
6. **D.1**: Fondasi peran dasar unprivileged `RegisteredUser` dengan izin operasional kosong (`[]`).
7. **D.2**: Layanan transaksional `GoogleIdentityProvisioningService` dan `db.provisionGoogleUser` untuk pembuatan akun baru ber-role `RegisteredUser` tanpa auto-merge.

### 1.2 Definisi & Tujuan Explicit Account Linking
*Explicit Account Linking* adalah mekanisme di mana seorang pengguna yang **telah memiliki akun lokal NutriBodySim** dan **sedang terautentikasi dalam sesi aktif yang sah**, secara sengaja dan eksplisit menautkan akun Google miliknya ke akun lokal tersebut.

Tujuan utama dari penautan eksplisit ini adalah:
1. Mengizinkan login di masa depan menggunakan Google SSO tanpa membuat akun duplikat.
2. Memungkinkan migrasi atau konsolidasi identitas bagi pengguna yang sebelumnya terdaftar secara lokal.
3. **Mencegah Account Takeover (ATO)**: Menolak keras penautan implisit/otomatis hanya berdasarkan kesamaan alamat email (*Anti-Auto-Merge Enforcement*).

---

## 2. Audit Kode Aktual & Identifikasi Kesenjangan Kritis (Pre-flight Audit)

Audit mendalam berbasis kode sumber aktual (*read-only*) dilakukan untuk memverifikasi kesiapan infrastruktur aplikasi dalam mendukung penautan akun.

```
+---------------------------------------------------------------------------------------------------------+
|                                    HASIL AUDIT KOMPONEN AKTUAL                                          |
+---------------------------------------------------------------------------------------------------------+
| Modul / Fitur             | Kondisi Kode Sumber Aktual                       | Kesiapan Linking         |
+---------------------------+--------------------------------------------------+--------------------------+
| 1. Autentikasi Lokal Prod | POST /auth/login melempar HTTP 501               | CRITICAL BLOCKER         |
|                           | (PRODUCTION_AUTH_BLOCKED, belum ada auth prod)   | (Tidak ada sesi prod)    |
| 2. Re-autentikasi         | Tidak ada endpoint / fungsi re-auth              | CRITICAL BLOCKER         |
|                           | (password/passkey challenge tidak tersedia)      | (Rentan Session Hijack)  |
| 3. OIDCTransaction        | OIDCTransaction tidak memiliki field purpose,    | ARCHITECTURAL GAP        |
|                           | targetUserId, atau initiatorSessionHash          | (Rentan Linking CSRF)    |
| 4. linkExternalIdentity   | Tidak cek user.account_status, tidak cek         | STORAGE VULNERABILITY    |
|                           | duplicate google identity, tidak ada audit log,  | (Perlu pengerasan store) |
|                           | tidak ada atomic rollback pada saveToDisk        |                          |
| 5. Pengelolaan Cookie     | Tidak ada cookie-parser di server.ts             | ARCHITECTURAL LIMITATION |
|                           | (autentikasi hanya via header Authorization)     | (Callback OIDC lintas-tab)|
| 6. Database Storage       | Single-process in-memory + atomic file rename.   | CONCURRENCY LIMITATION   |
|                           | Tidak ada lock lintas-proses (multi-instance).   | (Aman single-process)    |
+---------------------------------------------------------------------------------------------------------+
```

### 2.1 Audit Autentikasi Lokal & Manajemen Sesi (`backend/routes/api.ts`, `server.ts`)
* **Implementasi Endpoint Login (`/auth/login`)**:
  ```typescript
  apiRouter.post('/auth/login', (req: Request, res: Response) => {
    const config = getAuthConfig();
    if (config.isProduction) {
      return res.status(501).json({
        error: 'Production credential store / Identity Provider is not configured. Real authentication required for production deployment.',
        code: 'PRODUCTION_AUTH_BLOCKED'
      });
    }
    return res.status(400).json({
      error: 'Please use POST /api/auth/demo-login in demo environment.',
      code: 'USE_DEMO_LOGIN'
    });
  });
  ```
* **Temuan Audit (TEMUAN 1 — BLOCKER UTAMA)**:
  - NutriBodySim **BELUM MEMILIKI** sistem kredensial lokal produksi (tidak ada hash password, tabel kredensial, alur verifikasi email lokal, atau MFA).
  - Autentikasi saat ini hanya berjalan di lingkungan demo melalui `POST /auth/demo-login` yang langsung menerbitkan sesi berdasarkan `user_id` dari fixture statis.
  - Sesi yang dihasilkan disimpan di `MemorySessionStore` dan hanya dikirimkan via header `Authorization: Bearer <token>` atau `x-session-token`.
  - Tidak ada middleware `cookie-parser` di `server.ts`, sehingga sesi tidak tersimpan di cookie browser yang aman (`HttpOnly`, `SameSite`, `Secure`).

### 2.2 Audit Ketiadaan Re-Autentikasi (Step-Up Authentication)
* **Temuan Audit (TEMUAN 2 — RISIKO HIJACKING)**:
  - Operasi sensitif seperti penautan akun eksternal secara standar industri mewajibkan *step-up authentication* (pengguna wajib memasukkan kembali password lokal atau membuktikan kepemilikan akun sesaat sebelum penautan).
  - Karena tidak ada kredensial lokal dan tidak ada endpoint re-autentikasi (`POST /auth/reauthenticate`), pengguna yang sesi browser-nya tertinggal atau dicuri dapat langsung ditautkan ke akun Google milik penyerang.

### 2.3 Audit Model Transaksi OIDC (`backend/auth/oidc/types.ts`)
* **Struktur `OIDCTransaction` Saat Ini**:
  Hanya memuat: `id`, `state`, `stateHash`, `nonce`, `codeVerifier`, `codeChallenge`, `codeChallengeMethod`, `createdAt`, `expiresAt`, `consumed`, `consumedAt`, `clientBinding`, `returnUrl`, `redirectUri`.
* **Temuan Audit (TEMUAN 3 — KESENJANGAN KONTEKS TRANSAKSI)**:
  - Transaksi OIDC saat ini tidak memiliki pembeda apakah alur tersebut dipicu untuk **LOGIN** atau **ACCOUNT_LINKING**.
  - Transaksi tidak menyimpan `targetUserId` (ID pengguna lokal yang meminta penautan) maupun hash sesi inisiator.
  - Tanpa pengikatan (*cryptographic binding*) antara transaksi OIDC dan ID pengguna lokal di sisi server, sistem rentan terhadap serangan **Linking CSRF**.

### 2.4 Audit Metode Penyimpanan `db.linkExternalIdentity` (`backend/database/store.ts`)
* **Implementasi Saat Ini (Baris 278–323)**:
  ```typescript
  public linkExternalIdentity(identity: ExternalIdentity): ExternalIdentity {
    // Validasi provider, provider_subject_id, user_id
    // Validasi target user exists
    // Validasi unique constraint (provider, provider_subject_id)
    this.state.external_identities.push(normalizedIdentity);
    user.external_identities.push(normalizedIdentity);
    user.updated_at = new Date().toISOString();
    this.save();
    return normalizedIdentity;
  }
  ```
* **Temuan Audit (TEMUAN 4 — KERENTANAN LOGIKA PENYIMPANAN)**:
  1. **Tidak Memeriksa `user.account_status`**: Akun berstatus `SUSPENDED` atau `DISABLED` tetap dapat ditautkan identitas eksternal baru.
  2. **Tidak Menegakkan Batasan 1-to-1 Google Identity**: Tidak ada validasi apakah user target sudah memiliki identitas Google lain (`user.external_identities.some(e => e.provider === 'google')`).
  3. **Ketiadaan Audit Logging**: Method `linkExternalIdentity` tidak memanggil `this.logAudit`.
  4. **Ketiadaan Snapshot Rollback**: Mutasi memori dilakukan sebelum `this.save()`, namun jika `saveToDisk` melempar error, memori tidak dikembalikan ke state awal (*dirty memory state*).

---

## 3. Kebijakan Keamanan Mutlak Penautan Akun (Security Constitution)

Untuk mencegah eksploitasi, kebijakan keamanan berikut ditetapkan sebagai standar absolut yang wajib dipatuhi sebelum penautan akun diimplementasikan:

```
+---------------------------------------------------------------------------------------------------------+
|                                    PRINSIP KEAMANAN PENAUTAN AKUN                                       |
+---------------------------------------------------------------------------------------------------------+
| 1. Dual Ownership Proof    | Pembuktian ganda: Pengguna wajib memegang sesi lokal aktif yang valid      |
|                            | DAN menyelesaikan alur OIDC Google dengan ID token terverifikasi.          |
| 2. Server Binding Only     | targetUserId diikat dari req.user.id server; DILARANG menerima user_id     |
|                            | dari request body/query klien.                                             |
| 3. Anti-Auto-Merge         | Kesamaan alamat email TIDAK BOLEH menautkan akun secara otomatis.          |
| 4. 1-to-1 Constraint       | 1 Akun Google (sub) <---> Tepat 1 Akun Lokal NutriBodySim.                 |
| 5. Zero Privilege Impact   | Penautan akun TIDAK MENGUBAH role, permissions, atau hak Main Admin.       |
| 6. Inactive Containment    | Akun SUSPENDED / DISABLED ditolak mutlak dari penautan.                    |
| 7. Zero Credential Exposure| Tidak pernah menyimpan atau mengekspos token mentah, verifier, atau secret.|
+---------------------------------------------------------------------------------------------------------+
```

### 3.1 Kebijakan Autentikasi Pemilik Akun Lokal
1. **Inisiasi dari Sesi Terverifikasi**: Alur penautan hanya dapat diinisiasi oleh pengguna yang telah login ke akun lokal NutriBodySim dengan status `req.user.account_status === 'ACTIVE'`.
2. **Server-Side Context Binding**: Server mengekstrak `user_id` dari sesi tepercaya (`req.user.id`). Klien dilarang mengirimkan `user_id`, `role`, atau status akun dalam payload HTTP.
3. **Persyaratan Re-Autentikasi (Step-Up Auth)**: Pengguna wajib membuktikan kembali kepemilikan akun lokal sesaat sebelum penautan dimulai (misal via token re-otentikasi berbatas waktu 5 menit).

### 3.2 Kebijakan Verifikasi Identitas Google
1. **Jalur Verifikasi Server-Side Murni**: Identitas Google wajib diverifikasi melalui engine verifikasi C.2–C.4 internal (RS256 JWKS signature, issuer, audience, clock skew, nonce, `email_verified: true`).
2. **Anchor Utama Stabil**: Pasangan `(provider='google', provider_subject_id=sub)` adalah satu-satunya acuan identitas eksternal. Alamat email atau nama tampilan dilarang dijadikan identitas acuan permanen.
3. **Imunitas Manipulasi Parameter**: Subjek Google, email, atau status verifikasi dari body/query klien ditolak mutlak.

### 3.3 Kebijakan Batas Hak Istimewa (Zero Privilege Impact)
1. Penautan akun eksternal **TIDAK BOLEH** mengubah `role` (misal dari `Student` ke `Researcher`, atau sebaliknya).
2. Penautan akun eksternal **TIDAK BOLEH** memberikan hak `Admin` atau hak istimewa `MANAGE_PRIVILEGED_ROLES`.
3. Status Main Administrator tetap terisolasi pada mekanisme bootstrap CLI server (`executeBootstrapMainAdmin`).
4. Elevasi peran akademik tetap wajib melalui pengajuan `RoleRequest` dan persetujuan bertingkat (*Tiered Role Approval*).

---

## 4. Matriks Resolusi Konflik (Conflict Matrix)

Tabel berikut mendefinisikan keputusan sistem, respons aman, mutasi data, tindakan audit, dan tingkat risiko untuk setiap kemungkinan skenario penautan:

| ID | Skenario Masukan / Kondisi State | Keputusan Sistem | Respons Klien Aman | Mutasi Data | Aksi Audit Log | Tingkat Risiko & Mitigasi |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **LK-01** | Google `sub` belum tertaut, akun lokal aktif, belum punya Google identity | **LINKING DIIZINKAN** | HTTP 200: Penautan berhasil (`LINKING_SUCCESSFUL`) | Tautkan `ExternalIdentity` ke user lokal | `OIDC_IDENTITY_LINK` | **Low**. Alur normal penautan akun. |
| **LK-02** | Google `sub` sudah tertaut ke akun lokal yang sama saat ini | **IDEMPOTEN / NO-OP** | HTTP 200: Identitas telah tertaut (`ALREADY_LINKED_SAME_ACCOUNT`) | Tidak ada mutasi duplikat | `OIDC_IDENTITY_LINK` | **Low**. Aman dari pemanggilan ulang. |
| **LK-03** | Google `sub` sudah tertaut ke akun lokal lain di sistem | **TOLAK MUTLAK** | HTTP 409: `GOOGLE_ACCOUNT_ALREADY_LINKED` ("Google account is already connected to another user.") | Tidak ada mutasi (Fails closed) | `OIDC_LINK_REJECTED` | **Critical**. Mencegah Account Hijacking lintas-pengguna. |
| **LK-04** | Akun lokal pemohon berstatus `SUSPENDED` | **TOLAK MUTLAK** | HTTP 403: `FORBIDDEN_ACCOUNT_STATUS` ("Account is suspended.") | Tidak ada mutasi | `OIDC_LINK_REJECTED` | **High**. Menolak modifikasi identitas pada akun yang ditangguhkan. |
| **LK-05** | Akun lokal pemohon berstatus `DISABLED` | **TOLAK MUTLAK** | HTTP 403: `FORBIDDEN_ACCOUNT_STATUS` ("Account is disabled.") | Tidak ada mutasi | `OIDC_LINK_REJECTED` | **High**. Menolak modifikasi identitas pada akun yang dinonaktifkan. |
| **LK-06** | Sesi lokal tidak ada, kadaluwarsa, atau `user_id` tidak ditemukan | **TOLAK MUTLAK** | HTTP 401: `UNAUTHORIZED` ("Active local session required.") | Tidak ada mutasi | - | **High**. Menolak penautan anonim tanpa otentikasi lokal. |
| **LK-07** | Email Google cocok dengan akun lokal lain, tetapi Google `sub` belum tertaut | **TOLAK KONFLIK** | HTTP 409: `EMAIL_OWNED_BY_ANOTHER_ACCOUNT` ("Google email matches a different local account.") | Tidak ada mutasi | `OIDC_IDENTITY_CONFLICT` | **Critical**. Mencegah penautan identitas yang menggunakan email milik korban. |
| **LK-08** | Dua transaksi penautan paralel dengan Google `sub` yang sama | **SERIALISASI MUTEX** | Request 1: Sukses. Request 2: Tertolak `ALREADY_LINKED` | Tepat 1 record `ExternalIdentity` dibuat | `OIDC_IDENTITY_LINK` | **High**. Menghilangkan race condition duplikasi. |
| **LK-09** | Penyimpanan basis data gagal (`saveToDisk` I/O error) saat linking | **ATOMIC ROLLBACK** | HTTP 500: `LINKING_STORAGE_FAILURE` ("Storage write error.") | Rollback mutasi memori (Zero orphan records) | `OIDC_STORAGE_FAILURE` | **High**. Menjaga integritas referensial database. |
| **LK-10** | Akun lokal sudah memiliki identitas Google lain yang tertaut | **TOLAK PENAUTAN GANDA** | HTTP 409: `ACCOUNT_ALREADY_HAS_GOOGLE_IDENTITY` ("Local account is already linked to another Google account.") | Tidak ada mutasi | `OIDC_LINK_REJECTED` | **Medium**. Mempertahankan batasan ketat 1 Google ID per user. |

---

## 5. Rancangan State Machine Transaksional Penautan Akun

State machine berikut menjelaskan siklus hidup transaksi penautan akun dari inisiasi hingga terminasi:

```
[ 1. IDLE / UNLINKED ]
       │
       │ Pengguna aktif meminta penautan: POST /auth/oidc/link/initiate
       ▼
[ 2. LOCAL_SESSION_VERIFICATION ]
       ├── Validasi Sesi: token valid, token_version cocok, account_status === 'ACTIVE'
       ├── Validasi Batasan: user.external_identities belum memiliki provider 'google'
       └── Verifikasi Step-Up: re-autentikasi password/kredensial lokal valid
       │
       │ Sesi valid & belum tertaut
       ▼
[ 3. LINKING_TRANSACTION_CREATION ]
       ├── Generate CSPRNG: state (256-bit), nonce (256-bit), PKCE verifier (S256)
       ├── Simpan Transaksi Pre-Auth Server:
       │   purpose: 'ACCOUNT_LINKING'
       │   target_user_id: req.user.id
       │   initiator_session_hash: sha256(sessionToken)
       │   expiresAt: now + 600s (TTL 10 menit)
       └── Konstruksi Google Auth URL (scope: openid, email, profile)
       │
       │ Redirect ke Google
       ▼
[ 4. GOOGLE_CONSENT_PENDING ]
       │
       │ Pengguna menyetujui di Google Consent Screen & browser redirect ke callback
       ▼
[ 5. CALLBACK_VALIDATION ]
       ├── Validasi Query: state ada, code ada, tidak ada provider error
       ├── Single-Use Atomic Consumption: stateHash ditemukan, unconsumed, expiresAt > now
       └── Verifikasi Transaksi: purpose === 'ACCOUNT_LINKING'
       │
       │ Transaksi valid & dikonsumsi
       ▼
[ 6. GOOGLE_IDENTITY_VERIFICATION ]
       ├── C.3 Token Exchange: tukar authorization code dengan ID token via POST Google
       └── C.2 Token Verifier: validasi RS256 JWKS, issuer, audience, nonce, email_verified
       │
       │ ID Token valid -> Dihasilkan VerifiedOIDCIdentity
       ▼
[ 7. PRECONDITIONS_&_CONFLICT_CHECK ]
       ├── Verifikasi Sesi Aktif: req.user.id === transaction.target_user_id
       ├── Verifikasi Status Akun: user.account_status === 'ACTIVE'
       ├── Verifikasi Unik sub: findExternalIdentity('google', sub) === undefined
       ├── Verifikasi Unik user: user belum punya Google identity
       └── Verifikasi Konflik Email: email Google tidak dimiliki akun lokal lain
       │
       ├──────────────────────────────────────────────┐
       │ Semua prakondisi terpenuhi                   │ Ditemukan konflik / non-aktif
       ▼                                              ▼
[ 8. ATOMIC_RELATION_PERSISTENCE ]           [ 10. LINKING_REJECTED / FAILS CLOSED ]
       ├── Snapshot State Memori                     ├── Pencatatan Audit: OIDC_LINK_REJECTED /
       ├── Mutasi: user.external_identities.push     │   OIDC_IDENTITY_CONFLICT
       │   state.external_identities.push            ├── Transaksi dibatalkan
       ├── Audit: OIDC_IDENTITY_LINK                 └── Return HTTP 403 / 409
       ├── saveToDisk(state)
       │
       ├──────────────────────────────┐
       │ Sukses                       │ I/O Failure
       ▼                              ▼
[ 9. LINKING_SUCCESSFUL ]     [ 11. STORAGE_FAILURE_ROLLBACK ]
       ├── Return HTTP 200            ├── Rollback in-memory state
       └── Konfirmasi aman            ├── Audit: OIDC_STORAGE_FAILURE
                                      └── Return HTTP 500
```

---

## 6. Threat Model & Analisis Skenario Penyalahgunaan (Abuse Scenarios)

### 6.1 Skenario Ancaman 1: Linking CSRF (Account Hijacking Backdoor)
* **Vektor Serangan**:
  Penyerang menginisiasi alur penautan akun dengan akun Google miliknya, menangkap parameter authorization URL (state & code), lalu memancing korban yang sedang login di NutriBodySim untuk mengeklik tautan callback callback penyerang.
* **Dampak**: Akun Google penyerang tertaut ke akun lokal korban. Penyerang kini dapat login ke akun korban kapan saja melalui Google SSO.
* **Mitigasi Wajib**:
  1. Parameter `initiator_session_hash` disimpan pada transaksi OIDC di sisi server.
  2. Saat callback diterima, server memeriksa apakah sesi browser yang sedang melakukan request cocok dengan sesi yang menginisiasi penautan (`sha256(current_token) === transaction.initiator_session_hash`). Jika tidak cocok, transaksi **DITOLAK**.

### 6.2 Skenario Ancaman 2: Cross-Account Hijacking via Parameter Tampering
* **Vektor Serangan**:
  Pengguna biasa (Attacker) mengirimkan request `POST /auth/oidc/link` dengan payload JSON `{ user_id: 'usr_admin' }` dalam upaya menautkan Google identitasnya ke akun Administrator.
* **Dampak**: Eskalasi hak istimewa (*Privilege Escalation*) dan pengambilalihan akun Administrator.
* **Mitigasi Wajib**:
  Server secara mutlak **MENGABAIKAN** parameter `user_id` dari request body/query/headers klien. Target user ID diambil eksklusif dari objek `req.user.id` yang dihasilkan oleh middleware autentikasi tepercaya.

### 6.3 Skenario Ancaman 3: Bypass Penangguhan Akun (Suspended Account Re-activation)
* **Vektor Serangan**:
  Pengguna yang akun lokalnya berstatus `SUSPENDED` atau `DISABLED` mencoba menautkan akun Google baru dengan harapan status akunnya pulih menjadi `ACTIVE` atau dapat login bypass.
* **Dampak**: Pelanggaran kebijakan penangguhan akun.
* **Mitigasi Wajib**:
  Middleware `authMiddleware` dan logika `linkExternalIdentity` memeriksa `account_status`. Akun nonaktif ditolak dari semua operasi penautan (HTTP 403). Penautan akun dilarang memodifikasi kolom `account_status`.

---

## 7. Dependensi yang Belum Tersedia & Keterbatasan Sistem (Blockers)

Implementasi runtime penautan akun **DIBLOKIR (BLOCKED)** oleh ketiadaan prasyarat infrastruktur berikut:

### 7.1 BLOCKER 1: Ketiadaan Sistem Kredensial & Autentikasi Lokal Produksi
* **Deskripsi**:
  Aplikasi NutriBodySim saat ini tidak memiliki sistem registrasi atau login kredensial lokal produksi (endpoint `POST /auth/login` mengembalikan `501 PRODUCTION_AUTH_BLOCKED`).
* **Dampak terhadap Linking**:
  Penautan akun lokal mensyaratkan pengguna telah terdaftar dan login dengan akun lokal yang sah. Tanpa sistem autentikasi lokal produksi, penautan akun tidak memiliki jangkar sesi lokal yang aman untuk dioperasikan di lingkungan produksi.
* **Rekomendasi**: Membangun modul autentikasi kredensial lokal produksi (hashing password dengan Argon2/bcrypt, verifikasi email, session management) sebelum mengaktifkan penautan akun.

### 7.2 BLOCKER 2: Ketiadaan Mekanisme Re-Autentikasi (Step-Up Authentication)
* **Deskripsi**:
  Aplikasi belum memiliki protokol untuk memverifikasi ulang password/kredensial pengguna aktif sebelum melakukan tindakan berkategori risiko tinggi (*high-risk actions*).
* **Dampak terhadap Linking**:
  Membuka alur penautan akun tanpa re-autentikasi membuka celah serangan pengambilalihan akun jika perangkat pengguna ditinggalkan tanpa pengawasan (*unattended workstation vulnerability*).

### 7.3 BLOCKER 3: Ekstensi Skema Transaksi OIDC Belum Terpasang
* **Deskripsi**:
  Interface `OIDCTransaction` dan kelas `MemoryOIDCTransactionStore` pada `backend/auth/oidc/` belum memuat field:
  - `purpose: 'LOGIN' | 'ACCOUNT_LINKING'`
  - `targetUserId: string`
  - `initiatorSessionHash: string`
* **Dampak terhadap Linking**:
  Callback handler tidak dapat membedakan alur login biasa dengan alur penautan akun, serta tidak dapat memverifikasi keterikatan sesi pemohon.

### 7.4 Keterbatasan Penyimpanan Database File JSON
* **Deskripsi**:
  Penyimpanan data `nutribodysim_db.json` berbasis in-memory state dengan penulisan file fisik atomic rename (`renameSync`).
* **Batasan**:
  Aman untuk single-process Node.js menggunakan in-memory keyed mutex, namun **TIDAK AMAN** untuk skala multi-instance (multi-container) karena tidak ada lock lintas-proses sistem operasi.

---

## 8. Kriteria Penerimaan (Acceptance Criteria) untuk Milestone Implementasi Masa Depan

Ketika dependensi prasyarat telah terpenuhi dan implementasi runtime diizinkan, kriteria penerimaan berikut wajib diuji:

1. **Dual Proof Enforcement**:
   - Upaya penautan tanpa sesi lokal aktif ditolak dengan HTTP 401 Unauthorized.
   - Upaya penautan dengan sesi lokal tidak aktif (`SUSPENDED`/`DISABLED`) ditolak dengan HTTP 403 Forbidden.
2. **Anti-CSRF Session Binding**:
   - Upaya menukar callback Google pada sesi browser yang berbeda dari sesi inisiator ditolak mutlak.
3. **Anti-Auto-Merge & Conflict Enforcement**:
   - Upaya menautkan akun Google yang sudah terhubung ke pengguna lain ditolak dengan HTTP 409 Conflict.
   - Upaya menautkan akun Google dengan email yang dimiliki akun lokal lain ditolak dengan HTTP 409 Conflict.
   - Penautan berulang dengan akun Google yang sama pada akun lokal yang sama bersifat idempoten (HTTP 200, no duplicate record).
4. **Zero Privilege Impact**:
   - Penautan akun terbukti tidak mengubah role pengguna (`Student`, `Lecturer`, `Researcher`, `Admin`).
   - Penautan akun tidak pernah memberikan izin `ADMIN` atau hak `Main Administrator`.
5. **Atomic Rollback on Storage Failure**:
   - Simulasi kegagalan penulisan disk saat penautan identitas memicu rollback memori penuh tanpa orphan `ExternalIdentity`.
6. **Zero Credential Logging**:
   - Seluruh jejak audit `OIDC_IDENTITY_LINK` dan `OIDC_LINK_REJECTED` diverifikasi bersih dari ID token mentah, verifier, secret, atau nonce.

---

## 9. Kesimpulan & Status Kesiapan (Readiness Verdict)

### Status Kesiapan: **PASS WITH BLOCKERS (IMPLEMENTATION BLOCKED)**

1. **Evaluasi Keamanan**:
   Audit spesifikasi teknis dan analisis ancaman telah selesai 100% dengan formulasi state machine, matriks konflik 10 skenario, dan aturan tata kelola RBAC yang lengkap.
2. **Kondisi Pemblokir (Blockers)**:
   Implementasi runtime **DIBATASI DAN DIBLOKIR** karena ketiadaan:
   - Sistem autentikasi dan kredensial lokal produksi (saat ini 501 NOT IMPLEMENTED).
   - Mekanisme step-up re-autentikasi pengguna aktif.
   - Ekstensi metadata `purpose` dan `targetUserId` pada transaksi OIDC.
3. **Rekomendasi Milestone Berikutnya**:
   - Jangan langsung mengimplementasikan penautan akun runtime.
   - Rancang dan selesaikan terlebih dahulu dependensi prasyarat (modul kredensial lokal / re-autentikasi dan penguatan skema transaksi OIDC).
