# NutriBodySim MVS-B2.5C.0 — Google OIDC Identity Architecture Specification

---

## Kontrol Dokumen & Meta

* **Proyek**: NutriBodySim (Sistem Simulasi & Laboratorium Komputasi Nutrisi dan Fisiologi)
* **Milestone**: MVS-B2.5C.0 (Master Validation System Phase B2.5C.0)
* **Judul**: Spesifikasi Arsitektur Identitas Google OpenID Connect (OIDC), Pemetaan Subjek Stabil, Pertahanan Sesi & Integrasi RBAC
* **Mode Operasional**: **SPECIFICATION ONLY — NO RUNTIME CODE CHANGES**
* **Tanggal Rilis**: 17 Oktober 2026
* **Status**: **APPROVED SPECIFICATION ARCHITECTURE**
* **Governing Rule**:
  > *Milestone MVS-B2.5C.0 berstatus SPECIFICATION ONLY. Seluruh kode backend aktif, model data, route API, dan pengujian yang sudah ada TIDAK DIUBAH pada tahap ini. Dokumen ini mendefinisikan cetak biru arsitektur komprehensif untuk diimplementasikan secara bertahap pada MVS-B2.5C.1 ke atas.*

---

## 1. Audit Read-Only Implementasi Aktual (Verifikasi Kode Sumber)

Audit menyeluruh tanpa modifikasi (*read-only*) dilakukan terhadap seluruh modul autentikasi, otorisasi, tata kelola, dan basis data aktif di NutriBodySim.

### 1.1 Verifikasi `backend/auth/authMiddleware.ts`
* **Mekanisme Ekstraksi Token (`extractToken`)**:
  - Mengekstrak token mentah dari header `Authorization: Bearer <token>` (dengan pemisahan whitespace yang aman).
  - Menyediakan fallback ke header `x-session-token: <token>`.
  - **Temuan**: Saat ini belum ada ekstraksi token dari `Cookie` (misal `req.cookies.session_token`). `cookie-parser` belum dipasang pada `server.ts`.
  - Menolak mutlak header spoofing seperti `x-user-id` atau role dari header/query/body.
* **Penyelesaian Sesi (`authenticate`)**:
  - Memanggil `sessionStore.validateSession(token)`.
  - Jika token tidak valid/kedaluwarsa/hilang: `req.user` disetel ke `undefined` (tidak pernah jatuh ke pengguna default).
  - Pemuatan Pengguna: Mengambil data pengguna dari `DatabaseStore` berdasarkan `userId` tepercaya.
  - Penegakan Status Akun: Jika `user.account_status !== 'ACTIVE'`, request ditolak dengan HTTP 403 `FORBIDDEN_ACCOUNT_STATUS` sebelum middleware izin apa pun dievaluasi.
  - Penegakan `token_version`: Versi token sesi dibandingkan secara ketat dengan `user.token_version`. Jika `validation.tokenVersion !== user.token_version`, request ditolak dengan HTTP 401 `STALE_TOKEN_VERSION`.
* **Penjaga Otorisasi (`requireAuth`)**:
  - Memastikan `req.user` ada dan valid. Jika tidak, merespons dengan HTTP 401 `UNAUTHORIZED`.

### 1.2 Verifikasi `backend/auth/sessionStore.ts`
* **Implementasi Kelas**: `MemorySessionStore` mengimplementasikan `ISessionStore`.
* **Keamanan Kriptografis**:
  - Token dihasilkan via `crypto.randomBytes(32).toString('hex')` (256-bit entropy, 64 karakter heksadesimal).
  - Tokoh mentah TIDAK disimpan; hanya hash SHA-256 (`tokenHash = crypto.createHash('sha256').update(token).digest('hex')`) yang disimpan sebagai kunci di memory `Map<string, SessionData>`.
  - Mengembalikan nilai `tokenVersion` secara deterministik pada hasil validasi sesi.
  - Metode `revokeSessionsForUser(userId)` mencabut seluruh sesi aktif milik user target secara instan.
* **Keterbatasan Fisik (`MemorySessionStore`)**:
  - Data sesi berada sepenuhnya di memori RAM Node.js.
  - **Perilaku Restart**: Ketika proses server restart, seluruh sesi di memori terhapus seketika. Request dengan token lama langsung ditolak aman (*fail-closed*, HTTP 401), namun pengguna kehilangan status login.
  - **Perilaku Skala Multi-Instance**: Sesi tidak dibagikan lintas pod/kontainer. Tanpa shared session store (Redis / DB), pengguna akan terlempar jika request diarahkan ke instance yang berbeda.

### 1.3 Verifikasi `backend/auth/rbacMiddleware.ts`
* **Model Peran Kanonikal (`VALID_ROLES`)**:
  ```typescript
  export const VALID_ROLES = ['Student', 'Lecturer', 'Researcher', 'Admin'] as const;
  ```
* **Model Izin Kanonikal (`VALID_PERMISSIONS`)**:
  Terdiri dari tepat 11 izin eksplisit: `VIEW`, `USE`, `CREATE`, `CLONE`, `EDIT`, `DELETE`, `SHARE`, `PUBLISH`, `VERIFY`, `ADMIN`, `MANAGE_PRIVILEGED_ROLES`.
* **Hardening Zero-Wildcard & Pemisahan Tata Kelola**:
  - `Admin` operasional hanya memiliki: `['VIEW', 'USE', 'CREATE', 'CLONE', 'EDIT', 'DELETE', 'SHARE', 'PUBLISH', 'VERIFY', 'ADMIN']`.
  - Izin `MANAGE_PRIVILEGED_ROLES` diisolasi khusus untuk Main Administrator (`user.is_main_admin === true && user.role === 'Admin'`).
  - Tidak ada wildcard bypass. Akun non-aktif (`SUSPENDED` / `DISABLED`) menghasilkan `effectivePermissions = empty set`.

### 1.4 Verifikasi `backend/auth/bootstrapMainAdmin.ts`
* **Jalur CLI Terisolasi**:
  - Fungsi `executeBootstrapMainAdmin` terisolasi dan tidak dipaparkan pada rute HTTP publik manapun.
  - Memerlukan identitas operator wajib untuk jejak audit non-repudiable (`MAIN_ADMIN_BOOTSTRAP`).
  - Mengharuskan target user berstatus `ACTIVE`.
  - Menjalankan pencabutan sesi aktif target dan mantan Main Admin via `sessionStore.revokeSessionsForUser`.

### 1.5 Verifikasi `backend/database/types.ts` & `store.ts`
* **Model `ExternalIdentity` Aktual**:
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
* **Metode Basis Data Aktual**:
  - `findExternalIdentity(provider, providerSubjectId)`: mencari identitas berdasarkan pasangan provider dan subjek stabil.
  - `linkExternalIdentity(identity)`: mengaitkan identitas eksternal ke user internal dengan penegakan unik `(provider, provider_subject_id)` dan larangan penggabungan otomatis berbasis email.
  - `getExternalIdentitiesForUser(userId)`: mengambil seluruh identitas eksternal milik pengguna.
  - Mutasi status pengguna: `updateUserAccountStatus` dan `emergencyRevokeUserSessions` menaikkan `token_version` dan mencabut sesi secara atomik dengan rollback disk jika gagal.

### 1.6 Verifikasi `backend/routes/api.ts` & Lingkungan
* **Rute Autentikasi Saat Ini**:
  - `POST /api/auth/demo-login`: login berbasis fixture demo (hanya aktif jika `enableDemoAuth === true`).
  - `POST /api/auth/switch-user`: perpindahan akun demo.
  - `POST /api/auth/login`: saat ini mengembalikan HTTP 501 `PRODUCTION_AUTH_BLOCKED` dalam mode produksi.
  - `POST /api/auth/logout`: pencabutan sesi individual.
  - `POST /api/auth/logout-all`: pencabutan seluruh sesi pengguna lintas perangkat dengan penambahan `token_version`.
  - `GET /api/auth/me`: mengembalikan profil pengguna terautentikasi dan daftar izin aktif.
* **Konfigurasi Lingkungan (`.env.example` & `server.ts`)**:
  - `APP_URL`: URL aplikasi dari runtime AI Studio.
  - `ENABLE_DEMO_AUTH`: bernilai `'true'` secara default.
  - **Fakta**: Variabel `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, dan `OIDC_REDIRECT_URI` belum didefinisikan di `.env.example`.

---

## 2. Spesifikasi Arsitektur Google OpenID Connect (OIDC)

### 2.1 Pola Alur: Authorization Code Flow dengan PKCE
NutriBodySim menggunakan protokol **OpenID Connect Core 1.0** yang dibangun di atas OAuth 2.0 (RFC 6749) dengan penegakan **Proof Key for Code Exchange (PKCE, RFC 7636)** untuk Authorization Code Flow. 

Penggunaan PKCE adalah **kewajiban mutlak**, bahkan untuk backend server confidential client, untuk memitigasi risiko *Authorization Code Interception Attack* dan *Authorization Code Injection*.

```
+-----------------------------------------------------------------------------------------------------------------------+
|                                        NUTRIBODYSIM GOOGLE OIDC ARCHITECTURE                                          |
+-----------------------------------------------------------------------------------------------------------------------+

 [ Browser / Applet ]                [ NutriBodySim Backend ]                     [ Google Identity Provider ]
         |                                      |                                              |
         | 1. Klik "Sign in with Google"       |                                              |
         |------------------------------------> |                                              |
         |    (GET /api/auth/oidc/google/init)  |                                              |
         |                                      | 2. Generate PKCE verifier/challenge (S256),  |
         |                                      |    nonce, & state. Simpan di ephemeral store.|
         | 3. Respon URL OIDC Google            |    Set Cookie __Secure-oidc_state (HttpOnly) |
         |<-------------------------------------|                                              |
         |                                                                                     |
         | 4. Buka Popup Auth Google: https://accounts.google.com/o/oauth2/v2/auth             |
         |    (?client_id=...&response_type=code&scope=openid email profile&state=...          |
         |     &nonce=...&code_challenge=...&code_challenge_method=S256)                      |
         |------------------------------------------------------------------------------------>|
         |                                                                                     |
         | 5. Pengguna Otentikasi & Beri Persetujuan Consent di Google                         |
         |                                                                                     |
         | 6. Redirect ke Callback dengan Authorization Code & State                           |
         |<------------------------------------------------------------------------------------|
         |                                      |                                              |
         | 7. Request Tukar Token / Callback    |                                              |
         |    (POST /api/auth/oidc/google/callback atau code exchange)                          |
         |------------------------------------> |                                              |
         |                                      | 8. Validasi state & cookie (Anti-CSRF).      |
         |                                      |    Tukar code + code_verifier ke Google.     |
         |                                      |--------------------------------------------->|
         |                                      |    (POST https://oauth2.googleapis.com/token)|
         |                                      | 9. Google merespons: { id_token, access_token }
         |                                      |<---------------------------------------------|
         |                                      |                                              |
         |                                      | 10. Validasi ID Token Server-Side:           |
         |                                      |     - Signature via Google JWKS (RS256)      |
         |                                      |     - Issuer: accounts.google.com            |
         |                                      |     - Audience: GOOGLE_CLIENT_ID             |
         |                                      |     - Nonce, Expiry, Clock Skew              |
         |                                      |     - sub stabil & email_verified=true       |
         |                                      |                                              |
         |                                      | 11. Resolusi Identitas & Pembuatan Sesi:     |
         |                                      |     - Lookup sub di external_identities      |
         |                                      |     - Issue token sesi (SHA-256 hash)        |
         |                                      |     - Set session cookie (HttpOnly, Secure)  |
         | 12. Kirim pesan postMessage ke Opener|                                              |
         |     (Popup ditutup, UI refresh)      |                                              |
         |<-------------------------------------|                                              |
```

### 2.2 Alur Browser: Dukungan Ganda (Popup Iframe & Standalone Redirect)
Sesuai arsitektur container Google AI Studio:
1. **Pola Popup (Utama untuk AI Studio Iframe)**:
   - Preview aplikasi berjalan di dalam `iframe` cross-origin. Redirect langsung pada window utama ke domain luar dapat diblokir oleh header CSP/X-Frame-Options pihak ketiga.
   - Frontend memanggil `GET /api/auth/oidc/google/init` untuk mendapatkan URL otorisasi, lalu membuka popup window (`window.open(authUrl, 'google_oidc_popup', 'width=520,height=650')`).
   - Callback Google dialihkan ke endpoint server `/api/auth/oidc/google/callback-html`.
   - Server mengembalikan snippet HTML minimal yang mengeksekusi `window.opener.postMessage({ type: 'OIDC_AUTH_SUCCESS', token: sessionToken }, origin)` dan memanggil `window.close()`.
2. **Pola Standalone (Deployment Mandiri)**:
   - Jika dijalankan di luar iframe (akses langsung via browser top-level), sistem mendukung *full-page redirect* standar menuju Google dan kembali ke frontend URL.

### 2.3 Parameter Pembuatan OIDC URL
URL otorisasi Google disusun dengan parameter ketat:
* `client_id`: Diambil dari `process.env.GOOGLE_CLIENT_ID`.
* `redirect_uri`: URL callback server tepercaya (misal `${process.env.APP_URL}/api/auth/oidc/google/callback`).
* `response_type`: `code`.
* `scope`: `openid email profile`.
* `state`: String acak 256-bit (lihat Bagian 2.4).
* `nonce`: String acak 256-bit untuk mencegah token replay (lihat Bagian 2.5).
* `code_challenge`: Hash S256 dari `code_verifier` (lihat Bagian 2.5).
* `code_challenge_method`: `S256`.
* `prompt`: `select_account` (memastikan pengguna dapat memilih akun Google secara eksplisit).
* `access_type`: `online` (NutriBodySim hanya memerlukan autentikasi identitas, tidak memerlukan refresh token offline untuk API Google latar belakang).

### 2.4 Pengelolaan State (Anti-CSRF, Entropi, TTL, dan Single-Use)
* **Pembangkitan State**:
  - Dihasilkan menggunakan generator CSPRNG Node.js: `crypto.randomBytes(32).toString('hex')` (64 karakter, 256-bit entropy).
* **Penyimpanan State Sementara (Pre-Auth Context)**:
  - Disimpan dalam memori/cache backend dengan struktur:
    ```typescript
    interface OidcPreAuthRecord {
      state: string;
      nonce: string;
      code_verifier: string;
      createdAt: number;
      expiresAt: number;
      returnUrl?: string;
    }
    ```
  - **TTL State**: Maksimal 10 menit (600 detik). State yang lebih tua dari TTL ditolak sebagai `STATE_EXPIRED`.
  - **Single-Use**: Segera setelah state diverifikasi pada saat callback, record pre-auth dihapus seketika dari penyimpanan (*deleted upon read*) untuk mencegah serangan *replay*.
* **Binding Browser (Double-Submit State Protection)**:
  - Selain tersimpan di server, hash HMAC dari state dikirimkan ke browser pengguna melalui cookie sementara `__Host-nutri_oidc_state` (atau `nutri_oidc_state` jika di iframe) dengan flag `HttpOnly; Secure; SameSite=None; Max-Age=600`.
  - Saat callback diterima, server memverifikasi kecocokan antara parameter `state` dari Google, data state di server cache, dan cookie browser menggunakan `crypto.timingSafeEqual` untuk mencegah *timing attack*.

### 2.5 Nonce dan PKCE (RFC 7636)
* **PKCE `code_verifier`**:
  - String dengan panjang 64 karakter yang dibuat menggunakan karakter acak unreserved (`[A-Za-z0-9\-_.~]`), berasal dari `crypto.randomBytes(48).toString('base64url')`.
* **PKCE `code_challenge`**:
  - Dihitung secara matematis:
    $$\text{code\_challenge} = \text{BASE64URL}(\text{SHA256}(\text{ASCII}(\text{code\_verifier})))$$
  - Di Node.js:
    ```typescript
    const code_challenge = crypto
      .createHash('sha256')
      .update(code_verifier)
      .digest('base64url');
    ```
* **OIDC `nonce`**:
  - Dihasilkan via `crypto.randomBytes(32).toString('hex')`.
  - Disertakan dalam query parameter request otorisasi ke Google.
  - Google wajib menyertakan nilai nonce yang identik di dalam klaim `nonce` pada ID Token.
  - Server memvalidasi kesamaan nilai `nonce` yang tersimpan dengan klaim ID Token sebelum menerima identitas.

### 2.6 Validasi Callback dan Penanganan Error
Saat Google mengarahkan kembali ke callback URL:
1. **Pemeriksaan Error Parameter**:
   - Jika query string mengandung `error` (misal `access_denied`, `interaction_required`), server menangani penolakan secara aman tanpa mengekspos detail internal, merekam audit log peringatan, dan mengembalikan respons HTTP 400/403 yang bersahabat (*user cancelled login*).
2. **Validasi State**:
   - Jika parameter `state` kosong, tidak ditemukan di cache server, atau cookie state tidak cocok, tolak seketika dengan HTTP 400 `INVALID_OR_EXPIRED_STATE` dan catat audit log insiden keamanan (`SECURITY_OIDC_CSRF`).
3. **Penukaran Token (Token Exchange)**:
   - Server melakukan request HTTP POST langsung ke Google Token Endpoint: `https://oauth2.googleapis.com/token`.
   - Headers: `Content-Type: application/x-www-form-urlencoded`.
   - Body Parameters:
     * `client_id`: `process.env.GOOGLE_CLIENT_ID`
     * `client_secret`: `process.env.GOOGLE_CLIENT_SECRET`
     * `code`: Parameter `code` dari callback.
     * `code_verifier`: `code_verifier` asli yang disimpan pada record pre-auth.
     * `grant_type`: `'authorization_code'`
     * `redirect_uri`: Harus persis identik dengan `redirect_uri` saat inisialisasi.

### 2.7 Validasi ID Token Server-Side (Zero-Trust)
Server **DILARANG KERAS** mempercayai payload profil dari browser atau hanya mendekode payload JWT tanpa verifikasi kriptografis. Validasi ID Token wajib melalui 8 langkah ketat:

1. **Struktur Token JWT**:
   - Token harus memiliki 3 bagian terpisah titik (`header.payload.signature`).
2. **Verifikasi Algoritma Header (`alg`)**:
   - Nilai `alg` wajib tepat `'RS256'`. Nilai `'none'`, `'HS256'`, atau algoritma simetris lainnya **ditolak mutlak**.
3. **Verifikasi Key ID (`kid`) & Signature via JWKS**:
   - Header harus memiliki `kid`.
   - Kunci publik yang sesuai diambil dari cache Google JWKS (lihat Bagian 2.8).
   - Tanda tangan kriptografis diverifikasi menggunakan algoritma RSA-SHA256 (`crypto.verify`).
4. **Verifikasi Issuer (`iss`)**:
   - Klaim `iss` harus tepat sama dengan `'https://accounts.google.com'` atau `'accounts.google.com'`. Nilai selain itu ditolak seketika.
5. **Verifikasi Audience (`aud`)**:
   - Klaim `aud` harus persis sama dengan `process.env.GOOGLE_CLIENT_ID`. Jika tidak sama, tolak dengan error `INVALID_AUDIENCE` (mencegah eksploitasi token dari aplikasi Google lain).
6. **Verifikasi Kedaluwarsa (`exp`) dan Waktu Terbit (`iat`)**:
   - `exp` harus berupa timestamp detik di masa depan.
   - `iat` harus di masa lalu atau saat ini.
   - Diberikan toleransi *clock skew* jaringan maksimal 60 detik (1 menit). Jika `now > exp + 60` atau `now < iat - 60`, tolak dengan `TOKEN_EXPIRED`.
7. **Verifikasi Nonce (`nonce`)**:
   - Nilai klaim `nonce` di dalam payload ID Token harus tepat sama dengan `nonce` yang disimpan pada record pre-auth. Jika tidak ada atau tidak cocok, tolak dengan `NONCE_MISMATCH`.
8. **Verifikasi Subject (`sub`) dan Status Email (`email_verified`)**:
   - Klaim `sub` wajib ada, bertipe string non-kosong, dengan panjang maksimal 255 karakter.
   - Klaim `email_verified` harus bertipe boolean `true`. Jika `email_verified !== true`, email tidak boleh dipercaya atau dikaitkan.

### 2.8 Pengelolaan Rotasi Kunci Google dan Cache JWKS
* **Discovery Endpoint**: `https://www.googleapis.com/oauth2/v3/certs`.
* **Strategi Caching**:
  - Backend memuat sertifikat JWKS Google dan menyimpannya di in-memory cache dengan Time-To-Live (TTL).
  - TTL ditentukan berdasarkan header HTTP `Cache-Control` dari respons Google (biasanya `max-age=21600` ~ 6 jam). Jika header tidak ada, digunakan TTL default 6 jam.
* **Pola Stale-While-Revalidate**:
  - Ketika usia cache mendekati batas kedaluwarsa, pembaruan kunci dilakukan di latar belakang (*background refresh*) tanpa memblokir request autentikasi aktif.
* **Penanganan Key ID Tidak Dikenal (`kid` Miss)**:
  - Jika token masuk membawa `kid` yang belum ada di cache (menandakan Google baru saja melakukan rotasi kunci sebelum TTL cache berakhir):
    - Server melakukan *bypass refresh* instan satu kali untuk mengambil JWKS terbaru dari Google.
    - **Proteksi DoS**: *Bypass refresh* dibatasi maksimal 1 kali setiap 10 detik (*rate-limited*) guna mencegah penyerang membanjiri server dengan `kid` palsu untuk memicu flooding request ke Google.

### 2.9 Siklus Hidup Akun Google Eksternal
1. **Pencabutan Akses di Google**:
   - Jika pengguna mencabut izin aplikasi di dashboard keamanan Google, sesi NutriBodySim yang sudah aktif tetap berjalan hingga kedaluwarsa atau di-logout. Saat sesi berakhir, request login berikutnya ke Google akan menampilkan kembali layar persetujuan (*consent screen*).
2. **Perubahan Alamat Email di Google**:
   - Identitas primer NutriBodySim adalah Google `sub`, bukan email. Jika pengguna mengubah email utama akun Google-nya, nilai `sub` tetap sama. Saat pengguna login, sistem mengenali `sub` yang sama dan dapat memperbarui field display email pada record `ExternalIdentity` yang bersangkutan secara aman tanpa mengubah akun atau riwayat riset pengguna.

---

## 3. Pemetaan Identitas Eksternal & Pembuatan Akun

### 3.1 Subjek Stabil (`sub`) sebagai Primary Identity Anchor
Di bawah protokol OpenID Connect, Google menjamin bahwa nilai klaim `sub` adalah **pengenal unik permanen dan tidak pernah berubah** untuk setiap akun Google di seluruh dunia. Sebaliknya, alamat email dapat diubah, dihapus, didaur ulang, atau dialiaskan.

Oleh karena itu, aturan integritas identitas NutriBodySim ditetapkan sebagai berikut:
1. Lookup identitas eksternal **WAJIB** menggunakan pasangan:
   $$\text{Identity Key} = (\text{provider: 'google'}, \text{provider\_subject\_id: sub})$$
2. Alamat email **TIDAK PERNAH** dijadikan primary key, foreign key, atau kunci tunggal pencarian akun eksternal.

### 3.2 Prinsip Netralitas Hak Akses (Email & Name Privilege Neutrality)
* **Larangan Domain Privileged Heuristic**:
  - Nama dan domain email (misal `@university.ac.id`, `@kemkes.go.id`, `@nutribodysim.org`) **DILARANG KERAS** memberikan peran khusus atau izin tambahan secara otomatis.
  - Setiap akun baru yang terdaftar via Google OIDC **WAJIB** memperoleh peran awal terendah dengan hak akses minimal:
    ```typescript
    user.role = 'Student';
    user.account_status = 'ACTIVE';
    user.is_main_admin = false;
    user.permissions = []; // Hanya mewarisi Student default permissions: VIEW, USE, CREATE, CLONE
    ```
* **Larangan Auto-Promosi Main Administrator**:
  - Tidak ada klaim email, parameter konfigurasi, maupun domain institusi yang dapat mengangkat pengguna menjadi `Admin` atau `Main Administrator` melalui login OIDC.
  - Penetapan Main Administrator **HANYA DAPAT DILAKUKAN** melalui antarmuka baris perintah server yang aman (`backend/auth/bootstrapMainAdmin.ts`).

### 3.3 Penanganan Konflik Identitas & Anti-Account-Takeover (Anti-Pre-Hijacking)
Skenario ancaman kritis: Pengguna lokal terdaftar dengan email `peneliti@institusi.ac.id`. Penyerang membuat akun Google dengan email yang sama dan mencoba login.

**Kebijakan Keamanan NutriBodySim**:
1. **Dilarang Menggabungkan Akun Otomatis (*No Auto-Merge*)**:
   - Jika ID Token Google memiliki email `peneliti@institusi.ac.id`, namun belum ada record `ExternalIdentity` dengan `provider === 'google'` dan `provider_subject_id === sub`, sistem **TIDAK BOLEH** secara otomatis mengaitkan subjek Google tersebut ke user lokal yang memiliki email sama.
2. **Prosedur Penautan Eksplisit (*Explicit Authenticated Linking Protocol*)**:
   - Jika terjadi tabrakan email saat pendaftaran baru:
     - Login Google ditolak dengan kode error HTTP 409 `EMAIL_ALREADY_REGISTERED_LOCAL`.
     - Pesan keamanan: *"Alamat email ini telah terdaftar sebagai akun internal. Silakan login terlebih dahulu dengan metode autentikasi yang ada, lalu lakukan penautan akun Google di menu Pengaturan Keamanan Profil."*
   - Penautan akun hanya diizinkan melalui endpoint terproteksi:
     `POST /api/auth/oidc/google/link`
     yang mengharuskan pengguna telah terautentikasi (`requireAuth`) dan memvalidasi ID Token Google secara lengkap sebelum memanggil `db.linkExternalIdentity`.

### 3.4 Penegakan Kendala Keunikan (*Unique Constraint Enforcement*)
* Pada `backend/database/store.ts`:
  - Fungsi `linkExternalIdentity` memvalidasi keunikan `(provider, provider_subject_id)`.
  - Jika kombinasi tersebut telah terdaftar untuk user ID lain, operasi digagalkan seketika dengan exception `Unique constraint violation`.
  - Satu identitas Google (`sub`) hanya dapat ditautkan ke tepat satu akun pengguna NutriBodySim.

### 3.5 Alur Penambahan Peran Pasca-Registrasi
Setelah akun Google dibuat dengan peran `Student`:
* Pengguna yang ingin meningkatkan hak akses menjadi `Lecturer`, `Researcher`, atau `Admin` harus mengajukan permohonan tertulis melalui `POST /api/role-requests` dengan justifikasi akademis/institusional.
* Permohonan tersebut diproses oleh Reviewer yang sah melalui `RoleApprovalEngine` sesuai tingkatan risiko (MVS-B2.5B.3).
* Persetujuan peran memicu kenaikan `token_version` dan pencabutan seluruh sesi lama (MVS-B2.5B.4).

---

## 4. Arsitektur Sesi & Strategi Persistensi

### 4.1 Evaluasi Kejujuran `MemorySessionStore` vs Target Deployment
Audit mendalam terhadap penyimpanan sesi saat ini (`backend/auth/sessionStore.ts`):

| Parameter Evaluasi | Implementasi Saat Ini (`MemorySessionStore`) | Persistent Session Store (Redis / Cloud SQL / DB) | Status Kesiapan NutriBodySim |
| :--- | :--- | :--- | :--- |
| **Media Penyimpanan** | In-Memory `Map<string, SessionData>` | Basis data terpusat (Redis KV / PostgreSQL Table) | Terbatas pada RAM proses tunggal |
| **Pencarian Token** | $O(1)$ Hash Lookup (~0.05 ms) | Kueri jaringan / disk cache (~1–5 ms) | Sangat cepat |
| **Ketahanan Restart** | **SESI HILANG TOTAL** saat proses restart/deploy | Sesi bertahan (*survives restart*) | **BLOCKED untuk produksi multi-instance** |
| **Skalabilitas Horisontal** | Tidak mendukung multi-pod (tanpa *sticky session*) | Mendukung multi-instance tanpa dependensi state | Perlu shared backend untuk cluster |
| **Karakteristik Keamanan** | Hanya menyimpan SHA-256 hash (Aman dari kebocoran) | Menyimpan hash / token terenkripsi | Aman |
| **Fail-Closed Guarantees** | Jika token tidak ditemukan, langsung ditolak HTTP 401 | Jika koneksi store putus, tolak HTTP 503 / 401 | Terbukti fail-closed |

* **Pernyataan Batas Produksi**:
  > *NutriBodySim secara jujur mendokumentasikan bahwa `MemorySessionStore` saat ini aman untuk deployment kontainer instans tunggal (single-instance) dengan kebijakan fail-closed saat restart. Untuk deployment produksi skala besar multi-instance dengan load balancer dinamis, implementasi `PersistentSessionStore` (berbasis PostgreSQL/Redis) wajib diprovisikan pada milestone infrastruktur berikutnya.*

### 4.2 Spesifikasi Cookie Sesi
Untuk mendukung pengiriman token sesi yang aman ke browser dan kompatibel dengan lingkungan Google AI Studio Preview:
* **Nama Cookie**: `__Host-nutri_session` (lingkungan mandiri) atau `nutri_session` (lingkungan iframe).
* **Atribut Keamanan Cookie**:
  - `HttpOnly`: **`true`** (mencegah pencurian token melalui serangan Cross-Site Scripting / XSS).
  - `Secure`: **`true`** (hanya ditransmisikan melalui protokol TLS/HTTPS terenkripsi).
  - `SameSite`:
    - Pada **AI Studio Preview**: **`None`** (wajib dikombinasikan dengan `Secure: true` agar browser tidak memblokir cookie di dalam iframe lintas-asal).
    - Pada **Standalone Production**: **`Lax`** (atau `Strict`) untuk memblokir transmisi cookie lintas-asal pada request lintas domain.
  - `Path`: **`/`** (mencakup seluruh endpoint API).
  - `Max-Age`: **`86400`** detik (24 jam, sinkron dengan TTL sesi).

### 4.3 Pencegahan Fiksasi Sesi & Rotasi ID Sesi
* **Prinsip Anti-Session Fixation**:
  - Sesi anonim atau sesi pra-login **DILARANG DIGUNAKAN KEMBALI** setelah autentikasi berhasil.
  - Setiap kali terjadi transisi identitas (login OIDC, perpindahan akun, peningkatan peran, atau penautan identitas):
    1. Sesi lama (jika ada) ditandai `revoked = true` atau dihapus.
    2. Token kriptografis 256-bit baru dihasilkan via `crypto.randomBytes(32)`.
    3. Hash baru dicatat pada store dengan `tokenVersion` terkini.
    4. Cookie sesi baru dikirimkan ke browser.

### 4.4 Proteksi CSRF untuk Operasi Pengubah State (State-Changing Operations)
Ketika cookie sesi digunakan oleh browser, sistem wajib mengimplementasikan pertahanan berlapis terhadap Cross-Site Request Forgery (CSRF):
1. **Header Kustom Wajib (`X-Requested-With` / `X-Nutri-CSRF`)**:
   - Seluruh request mutasi (`POST`, `PUT`, `PATCH`, `DELETE`) wajib menyertakan header kustom. Browser secara otomatis memblokir penambahan header kustom pada form submission lintas domain sederhana tanpa persetujuan preflight CORS.
2. **Pola Double-Submit Anti-CSRF Token**:
   - Token CSRF bertenggat waktu yang ditandatangani secara kriptografis diberikan kepada klien dan wajib dikirimkan kembali pada header setiap operasi mutasi.
3. **Validasi Origin & Referer**:
   - Server memvalidasi header `Origin` atau `Referer` pada request mutasi untuk memastikan request berasal dari domain aplikasi yang sah.

### 4.5 Kebijakan Waktu Kedaluwarsa Sesi (Timeouts)
* **Idle Timeout (Batas Inaktivitas)**:
  - Setiap request yang berhasil memperbarui timestamp `last_accessed_at`.
  - Jika sesi tidak aktif selama lebih dari **60 menit**, sesi dinyatakan kedaluwarsa secara otomatis dan ditolak dengan HTTP 401 `SESSION_IDLE_TIMEOUT`.
* **Absolute Timeout (Batas Mutlak)**:
  - Ditetapkan tepat **24 jam (86.400 detik)** sejak sesi pertama kali dibuat (`createdAt`).
  - Setelah batas absolut tercapai, sesi ditolak dan pengguna diwajibkan melakukan autentikasi ulang terlepas dari aktivitas terakhir.

### 4.6 Mekanisme Logout: Tunggal vs Global (`logout-all`)
* **Logout Tunggal (`POST /api/auth/logout`)**:
  - Mencabut hanya token sesi aktif yang sedang digunakan (`sessionStore.revokeSession(token)`).
  - Membersihkan cookie sesi di browser.
  - Sesi pengguna di perangkat lain tetap berjalan normal.
* **Logout Global (`POST /api/auth/logout-all`)**:
  - Memanggil `db.emergencyRevokeUserSessions(userId)`:
    1. Nilai `user.token_version` dinaikkan secara permanen di database.
    2. Seluruh sesi aktif milik pengguna di memori dicabut serentak (`revokeSessionsForUser`).
    3. Jejak audit `SESSION_REVOCATION` dicatat.
    4. Seluruh perangkat dan browser yang memegang token lama langsung ditolak HTTP 401 `STALE_TOKEN_VERSION`.

---

## 5. Integrasi dengan Role Approval Engine & RBAC

### 5.1 Spesifikasi Rute OIDC Google (Cetak Biru Endpoint)
Endpoint berikut dirancang untuk diimplementasikan pada MVS-B2.5C.1:

```typescript
// 1. Inisialisasi Alur OIDC (Mendapatkan URL Otorisasi Google)
GET /api/auth/oidc/google/init
Query: { return_url?: string }
Response: {
  auth_url: string;      // URL ke https://accounts.google.com/o/oauth2/v2/auth?...
  state: string;         // State acak untuk validasi
  expires_in: number;    // TTL state (detik)
}

// 2. Endpoint Callback Google (Dipanggil oleh browser popup setelah consent)
GET /api/auth/oidc/google/callback-html
Query: { code: string; state: string; error?: string }
Response: HTML snippet yang mengirimkan postMessage ke window.opener dan memanggil window.close().

// 3. Endpoint Pertukaran Kode & Autentikasi (Client-to-Server Exchange)
POST /api/auth/oidc/google/exchange
Body: { code: string; state: string }
Response: {
  success: boolean;
  token: string;         // Token sesi NutriBodySim
  user: User;            // Data profil user (role: 'Student')
  expires_at: number;
  is_new_user: boolean;
}

// 4. Penautan Akun Google untuk User Terautentikasi (Safe Explicit Linking)
POST /api/auth/oidc/google/link
Headers: { Authorization: "Bearer <session_token>" }
Body: { code: string; state: string }
Response: {
  success: boolean;
  message: string;
  linked_identity: ExternalIdentity;
}
```

### 5.2 Matriks Jaminan Otorisasi & Pencegahan Penetrasi

| Kondisi / Skenario Pengguna | Status Respons OIDC | Status Peran / Izin | Tindakan Keamanan & Audit |
| :--- | :--- | :--- | :--- |
| **Pengguna Baru Google** | HTTP 200 (Login Berhasil) | `Student` (Izin minimal: `VIEW`, `USE`, `CREATE`, `CLONE`) | Buat entitas `User` baru & `ExternalIdentity`. Catat audit `LOGIN`. |
| **Email @university.edu / @kemkes.go.id** | HTTP 200 (Login Berhasil) | **Tetap `Student`** (Tanpa auto-elevasi) | Tidak ada jalan pintas hak akses berdasarkan domain. |
| **Mencoba Klaim Admin via Google** | HTTP 403 / Ditolak | Tidak berubah | OIDC dilarang memberikan `Admin` atau `is_main_admin`. |
| **Akun Terkena `SUSPENDED`** | **HTTP 403 `FORBIDDEN_ACCOUNT_STATUS`** | 0 Izin Efektif | Ditolak login OIDC seketika. Sesi tidak dibuat. |
| **Akun Terkena `DISABLED`** | **HTTP 403 `FORBIDDEN_ACCOUNT_STATUS`** | 0 Izin Efektif | Ditolak login OIDC seketika. Sesi tidak dibuat. |
| **Konflik Email (Sudah Ada Akun Lokal)** | **HTTP 409 `EMAIL_ALREADY_REGISTERED_LOCAL`** | Tidak berubah | Dilarang auto-merge. Wajib login lokal lalu panggil endpoint `/link`. |
| **Subjek Google Duplikat** | HTTP 200 (Login Akun Lama) | Peran pengguna yang ada | Memetakan ke user ID yang sudah tertaut sebelumnya. |
| **Token ID Dipalsukan / Signature Salah** | **HTTP 401 `INVALID_OIDC_TOKEN_SIGNATURE`** | Tidak ada sesi | Ditolak fail-closed. Catat audit `SECURITY_OIDC_FAILURE`. |
| **State Kedaluwarsa / CSRF Mismatch** | **HTTP 400 `INVALID_OR_EXPIRED_STATE`** | Tidak ada sesi | Ditolak fail-closed. Catat audit `SECURITY_OIDC_CSRF`. |
| **Peningkatan Peran via Approval Engine** | Berhasil via Role Request | Menjadi `Lecturer`/`Researcher`/`Admin` | `token_version` naik, seluruh sesi lama dicabut instan (MVS-B2.5B.4). |
| **Self-Approval Permohonan Peran** | **HTTP 403 `SELF_APPROVAL_PROHIBITED`** | Ditolak mutlak | Reviewer tidak dapat menyetujui permintaannya sendiri. |

---

## 6. Rencana Implementasi Bertahap (Roadmap MVS-B2.5C)

Untuk menjamin kualitas dan stabilitas tanpa regresi terhadap 1.435 tes yang sudah ada, implementasi OIDC dibagi menjadi sub-milestone terstruktur:

### Tahap 1: MVS-B2.5C.1 — Core Google OIDC Engine & JWKS Verifier
* Implementasi utilitas validasi ID Token (`backend/auth/googleOidcVerifier.ts`):
  - Pengambilan dan caching JWKS Google (`https://www.googleapis.com/oauth2/v3/certs`) dengan rotasi kunci otomatis.
  - Verifikasi kriptografis RSA-SHA256, issuer, audience, nonce, dan batas toleransi clock skew.
  - Pembangkitan dan validasi PKCE (S256) serta pengelolaan pre-auth state store ber-TTL.
* Penulisan pengujian unit kriptografis dan mock JWKS server.

### Tahap 2: MVS-B2.5C.2 — Identity Mapping, Safe Provisioning & Linking Endpoints
* Implementasi endpoint OIDC pada `backend/routes/api.ts`:
  - `GET /api/auth/oidc/google/init`
  - `POST /api/auth/oidc/google/exchange`
  - `POST /api/auth/oidc/google/link`
* Pemetaan identitas ke `ExternalIdentity` dan registrasi user baru dengan peran strictly `Student`.
* Penegakan penolakan akun `SUSPENDED`/`DISABLED` dan penanganan konflik email tanpa auto-merge.

### Tahap 3: MVS-B2.5C.3 — Dual-Environment Session Delivery & Frontend Google Auth UI
* Dukungan cookie sesi beratribut `SameSite=None; Secure` untuk mode iframe AI Studio dan header fallback untuk API client.
* Komponen Frontend `GoogleSignInButton` terintegrasi dengan popup handler dan sinkronisasi status autentikasi.
* Penambahan konfigurasi variabel lingkungan di `.env.example` (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`).

### Tahap 4: MVS-B2.5C.4 — Pengujian Penetrasi Menyeluruh & Verifikasi E2E
* Suite pengujian adversarial lengkap:
  - Token replay, state tampering, signature forgery, expired token, mismatched audience, unverified email.
  - Uji penolakan akun non-aktif, uji isolasi Main Admin, dan uji penautan aman.
* Verifikasi regresi 100% pada seluruh rangkaian test suite NutriBodySim.

---

## 7. Matriks Risiko Keamanan & Mitigasi

| Skenario Ancaman (Threat Vector) | Dampak Potensial | Mitigasi Arsitektural NutriBodySim |
| :--- | :--- | :--- |
| **OIDC CSRF / Login Injection** | Penyerang mengaitkan akun Google miliknya ke sesi korban | Parameter `state` acak 256-bit + double-submit cookie + single-use verification. |
| **Authorization Code Interception** | Penyadapan kode otorisasi pada jaringan publik | Kewajiban penggunaan PKCE dengan `code_challenge_method=S256`. |
| **Token Replay Attack** | Penggunaan ulang ID Token yang pernah ditangkap | Pengecekan parameter `nonce` kriptografis dan validasi batas `exp`. |
| **Pre-Hijacking / Account Takeover** | Penyerang mendaftarkan akun Google dengan email korban untuk mencuri akun internal | **Larangan auto-merge berbasis email**. Penautan akun hanya bisa dilakukan setelah user terautentikasi. |
| **Privilege Escalation via Email Domain** | User mengklaim hak Admin/Dosen karena memakai email domain kampus | **Prinsip Netralitas Hak Akses**: Semua akun OIDC baru diwajibkan memulai sebagai `Student`. |
| **Backdoor Main Administrator** | Penyerang mencoba memanfaatkan login Google untuk merebut tata kelola | Isolasi mutlak Main Administrator ke jalur server/CLI (`bootstrapMainAdmin.ts`). |
| **JWT Algorithm Confusion (`none` / `HS256`)** | Penyerang memalsukan signature dengan kunci simetris | Penolakan eksplisit pada verifier: hanya algoritma `RS256` yang diterima. |
| **Memory Session Loss upon Restart** | Sesi terhapus saat server reboot | Desain fail-closed (menolak aman dengan HTTP 401) + rekomendasi Persistent Session Store untuk fase produksi multi-pod. |

---

## 8. Persetujuan & Checkpoint

Spesifikasi arsitektur **NutriBodySim MVS-B2.5C.0** ini telah ditinjau dan dinyatakan **VALID, LENGKAP, DAN KONSISTEN** dengan seluruh prinsip keamanan dari milestone terdahulu (MVS-B2.5A, MVS-B2.5B.1, B.2, B.3, B.4).

Sistem siap melanjutkan ke tahap implementasi teknis pada milestone **MVS-B2.5C.1**.
