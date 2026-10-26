# NutriBodySim MVS-B2.5C.2 — Laporan Audit & Verifikasi Keamanan
# Google OIDC ID Token Verification Engine

---

## 1. Ringkasan Eksekutif & Status Milestone

* **Milestone**: MVS-B2.5C.2 — Google OIDC ID Token Verification Engine
* **Mode Operasi**: **IMPLEMENTATION — ISOLATED SERVER-SIDE VERIFIER ONLY**
* **Status**: **PASS / READY FOR MVS-B2.5C.3**
* **Status Google Login**: **NOT ACTIVE (Belum Ada Rute Publik / Belum Diaktifkan)**
* **Tanggal Penyelesaian**: 18 Oktober 2026
* **Cakupan Kode Sumber**:
  - `backend/auth/oidc/types.ts`: Kontrak tipe verifier (`VerifyIDTokenOptions`, `VerifyIDTokenResult`, `VerifiedOIDCIdentity`, `OIDCVerificationErrorCode`, `GoogleJWK`, `IJWKSClient`).
  - `backend/auth/oidc/jwks.ts`: Klien JWKS resmi Google (`GoogleJWKSClient`), in-memory cache ber-TTL, proteksi anti-SSRF, penanganan rotasi kunci, dan mitigasi anti-DoS (cooldown rate-limiting pada `kid` miss).
  - `backend/auth/oidc/verifier.ts`: Mesin verifikasi kriptografis terisolasi (`verifyGoogleIDToken`) dengan evaluasi 12 langkah ketat zero-trust.
  - `backend/auth/oidc/index.ts`: Barrel export modul OIDC terpadu.
  - `backend/__tests__/oidcTokenVerifierMVS_B2_5C2.test.ts`: 28 unit & adversarial test cases dengan simulasi pasangan kunci RSA 2048-bit terisolasi.
* **Hasil Pengujian**:
  - Test suite OIDC Verifier MVS-B2.5C.2: **28 dari 28 tes LULUS (100%)**.
  - Test suite OIDC Primitives MVS-B2.5C.1: **30 dari 30 tes LULUS (100%)**.
  - Test suite Backend Keseluruhan: **12 file tes, 306 tes LULUS (100%)**.
  - TypeScript Compiler (`tsc --noEmit` / `npm run lint`): **0 errors (CLEAN)**.
  - Applet Build (`compile_applet` / `npm run build`): **SUCCEEDED**.
  - Pemeriksaan Git: Lingkungan bukan repositori Git (`fatal: not a git repository`). Sesuai aturan, Git baru tidak diinisialisasi.

---

## 2. Temuan Pre-Flight Audit

1. **Audit Kontrak C1 (`backend/auth/oidc/`)**:
   - Kontrak tipe C1 (`types.ts`), primitif PKCE S256 (`primitives.ts`), validasi konfigurasi (`config.ts`), dan `MemoryOIDCTransactionStore` telah diaudit dan diverifikasi beroperasi dengan stabil.
   - Nonce yang dihasilkan oleh C1 bertipe string heksadesimal 256-bit ber-entropi tinggi dan siap digunakan sebagai jangkar binding verifikasi ID Token.
2. **Audit Dependensi**:
   - Dependensi `jose` versi 6.2.12 ditambahkan untuk mendukung standar ekosistem JWT/OIDC. Namun, implementasi verifier inti dan transformasi JWK dieksekusi menggunakan modul native `node:crypto` (`createPublicKey`, `createVerify`, `timingSafeEqual`) guna menjamin interoperabilitas native tingkat rendah dan ketiadaan overhead eksternal tak terkontrol.
3. **Audit Batasan Keamanan Milestone**:
   - Tidak ada rute publik baru pada `backend/routes/api.ts`.
   - Tidak ada modifikasi pada `backend/auth/rbacMiddleware.ts`, `backend/auth/roleApprovalEngine.ts`, `backend/auth/bootstrapMainAdmin.ts`, maupun skema database.
   - Demo-login dan switch-user tetap utuh dan fungsional.

---

## 3. Kontrak Verifier & Trusted Caller

Mesin verifikasi dirancang untuk dipanggil **HANYA** oleh komponen server internal tepercaya (misal token exchange handler pada MVS-B2.5C.3), **BUKAN** sebagai endpoint publik yang menerima token langsung dari browser.

### 3.1. Antarmuka Pemanggilan (`VerifyIDTokenOptions`)
```typescript
export interface VerifyIDTokenOptions {
  idToken: string;
  expectedNonce?: string;
  expectedClientId?: string;
  currentTime?: number;
  clockSkewToleranceSeconds?: number;
  transactionId?: string;
  transactionStore?: IOIDCTransactionStore;
}
```

### 3.2. Objek Identitas Terverifikasi (`VerifiedOIDCIdentity`)
Jika dan hanya jika verifikasi lolos seluruh tahapan validasi, fungsi mengembalikan objek identitas bersih tanpa memuat material sensitif:
```typescript
export interface VerifiedOIDCIdentity {
  provider: 'google';
  sub: string;
  issuer: string;
  audience: string | string[];
  issuedAt: number;
  expiresAt: number;
  email?: string;
  emailVerified?: boolean;
  profile?: {
    name?: string;
    picture?: string;
    givenName?: string;
    familyName?: string;
    locale?: string;
  };
}
```

---

## 4. Kebijakan Keamanan Kriptografis & Klaim Token

| Parameter / Klaim | Kebijakan Keamanan NutriBodySim | Perilaku Saat Pelanggaran (Fail-Closed) |
| :--- | :--- | :--- |
| **Struktur JWT** | Wajib tepat 3 segmen dot-separated (`header.payload.signature`). Base64URL valid. | Ditolak dengan `OIDC_TOKEN_MALFORMED`. |
| **Algoritma (`alg`)** | Wajib tepat `'RS256'`. Algoritma `'none'`, `'HS256'`, atau lainnya ditolak mutlak. | Ditolak dengan `OIDC_ALGORITHM_NOT_ALLOWED`. |
| **Key ID (`kid`)** | Wajib ada dan merupakan string non-kosong yang terdaftar di Google JWKS. | Ditolak dengan `OIDC_TOKEN_MALFORMED` atau `OIDC_KEY_NOT_FOUND`. |
| **Anti-SSRF Header** | Header `jku`, `x5u`, `jwk`, `x5c` **DITOLAK SECARA MUTLAK**. | Ditolak dengan `OIDC_TOKEN_MALFORMED`. |
| **Signature** | Diverifikasi secara kriptografis menggunakan kunci publik RSA dari JWKS Google. | Ditolak dengan `OIDC_SIGNATURE_INVALID`. |
| **Issuer (`iss`)** | Wajib tepat `'https://accounts.google.com'` atau `'accounts.google.com'`. | Ditolak dengan `OIDC_ISSUER_INVALID`. |
| **Audience (`aud`)** | Wajib mencakup Client ID NutriBodySim (`GOOGLE_CLIENT_ID`). | Ditolak dengan `OIDC_AUDIENCE_INVALID`. |
| **Multi-Audience (`azp`)**| Jika `aud` memiliki beberapa nilai, klaim `azp` wajib ada dan cocok dengan Client ID. | Ditolak dengan `OIDC_AUDIENCE_INVALID`. |
| **Kedaluwarsa (`exp`)** | `now <= exp + clockSkew` (toleransi maksimal 60 detik). | Ditolak dengan `OIDC_TOKEN_EXPIRED`. |
| **Waktu Terbit (`iat`)** | `iat <= now + clockSkew` (tidak boleh diterbitkan di masa depan). | Ditolak dengan `OIDC_REQUIRED_CLAIM_MISSING`. |
| **Subjek (`sub`)** | Wajib string non-kosong, panjang maksimal 255 karakter. Primary immutable anchor. | Ditolak dengan `OIDC_REQUIRED_CLAIM_MISSING`. |
| **Nonce (`nonce`)** | Wajib sama persis dengan nonce transaksi pre-auth server via `timingSafeEqual`. | Ditolak dengan `OIDC_NONCE_INVALID`. |
| **Email Status** | `email_verified` harus boolean `true`. String `'true'` atau number `1` dianggap unverified. | `emailVerified` di-set `false`. |

---

## 5. Desain JWKS Cache, Anti-SSRF, & Rotasi Kunci

1. **Pembatasan Endpoint Resmi (Strict Target Boundary)**:
   - Host dibatasi mutlak pada `www.googleapis.com` dengan path `/oauth2/v3/certs`.
   - Menolak URL HTTP atau hostname pihak ketiga.
2. **Manajemen Cache Ber-TTL**:
   - Header `Cache-Control` dari Google diparsing untuk membaca `max-age` (default 6 jam, di-clamp antara 5 menit hingga 24 jam).
   - Kunci disimpan dalam memori instance (`Map<string, crypto.KeyObject>`).
3. **Mitigasi Serangan DoS pada Rotasi Kunci (`kid` Miss)**:
   - Jika incoming token membawa `kid` yang belum ada di cache, sistem melakukan refresh ke Google.
   - **Rate-Limit Cooldown**: Refresh dibatasi maksimal 1 kali setiap 10 detik (`REFRESH_COOLDOWN_MS = 10000`). Upaya penyerang mengirimkan `kid` acak secara masif tidak akan membanjiri server Google atau memicu resource exhaustion.
4. **Batas Waktu Jaringan (Timeout)**:
   - Request JWKS menggunakan `AbortController` dengan timeout 5.000 ms (5 detik).
   - Jika endpoint tidak dapat dihubungi atau timeout, verifier gagal tertutup dengan kode `OIDC_JWKS_UNAVAILABLE`.

---

## 6. Penanganan Error & Ketiadaan Efek Samping (Side-Effect Absence)

1. **Kode Error Terkategori**:
   - `OIDC_TOKEN_MALFORMED`: Format token rusak atau header ilegal.
   - `OIDC_SIGNATURE_INVALID`: Tanda tangan kriptografis tidak cocok.
   - `OIDC_ISSUER_INVALID`: Issuer bukan domain Google resmi.
   - `OIDC_AUDIENCE_INVALID`: Audience atau azp tidak cocok dengan Client ID.
   - `OIDC_TOKEN_EXPIRED`: Token telah kedaluwarsa di luar toleransi waktu.
   - `OIDC_NONCE_INVALID`: Nonce hilang atau tidak cocok dengan transaksi server.
   - `OIDC_REQUIRED_CLAIM_MISSING`: Klaim penting (`sub`, `exp`, `iat`) hilang/rusak.
   - `OIDC_JWKS_UNAVAILABLE`: Masalah jaringan saat menghubungi Google JWKS.
   - `OIDC_KEY_NOT_FOUND`: Key ID tidak ditemukan di JWKS Google.
   - `OIDC_CONFIGURATION_INVALID`: Konfigurasi OIDC lokal tidak lengkap.
   - `OIDC_ALGORITHM_NOT_ALLOWED`: Algoritma selain RS256 atau 'none'.
2. **Ketiadaan Kebocoran Data (Zero-Leakage Policy)**:
   - Raw token JWT, authorization code, dan client secret tidak dicatat ke log konsol atau string error.
3. **Ketiadaan Efek Samping pada Basis Data & Sesi**:
   - Pemanggilan verifier adalah operasi murni (*pure verification*).
   - Terverifikasi secara adversarial: kegagalan verifikasi maupun keberhasilan verifikasi pada milestone ini **TIDAK MENGUBAH** tabel `users`, tabel `external_identities`, maupun `defaultSessionStore`.

---

## 7. Matriks Hasil Pengujian Adversarial (28/28 Tests PASS)

```
Test Files  1 passed (1)
     Tests  28 passed (28)
  Duration  244ms

✓ 1. Valid Token & Identity Extraction
  ✓ verifies a valid RS256 token and extracts clean VerifiedOIDCIdentity
  ✓ accepts alternative valid Google issuer "accounts.google.com"
✓ 2. Cryptographic Signature Tampering
  ✓ rejects a token signed with an untrusted attacker private key
  ✓ rejects a token when payload bytes are tampered after signing
  ✓ rejects a token when signature bytes are corrupted
✓ 3. Token Format & Header Validation
  ✓ rejects malformed tokens without 3 dot-separated segments
  ✓ strictly rejects algorithm "none"
  ✓ strictly rejects disallowed symmetric or non-RS256 algorithms (e.g. HS256, ES256)
  ✓ rejects tokens missing the "kid" header
  ✓ rejects untrusted headers attempting SSRF or key injection (jku, x5u, jwk)
✓ 4. Key ID & JWKS Key Rotation Simulation
  ✓ returns OIDC_KEY_NOT_FOUND when kid is not present in JWKS
  ✓ handles key rotation via mock JWKS refresh when new key is added
  ✓ returns OIDC_JWKS_UNAVAILABLE when JWKS endpoint cannot be reached
✓ 5. Issuer & Audience Verification
  ✓ rejects untrusted or attacker-controlled issuers
  ✓ rejects tokens issued for a different Google Client ID (audience mismatch)
  ✓ handles multi-audience array and enforces azp matching expected client ID
✓ 6. Expiration (exp) and Issuance Time (iat)
  ✓ rejects expired tokens beyond clock skew tolerance
  ✓ accepts tokens expired within allowable clock skew tolerance
  ✓ rejects tokens issued far in the future
✓ 7. Subject (sub) & Nonce Claim Validation
  ✓ rejects tokens with missing, empty, or whitespace-only sub
  ✓ verifies expected nonce matching and rejects mismatched nonce
  ✓ resolves expected nonce through pre-auth transaction binding in store
  ✓ rejects verification if transactionId does not exist in store
✓ 8. Email & Profile Claim Sanitization
  ✓ sets emailVerified to true ONLY when email_verified is boolean true
  ✓ safely handles malformed non-string profile claims without crashing
✓ 9. Fail-Closed Boundaries & Side-Effect Absence
  ✓ verifies that failed verification creates NO database users or external identities
  ✓ verifies that successful verification in this milestone creates NO user sessions
  ✓ verifies that Main Administrator bootstrap and RBAC models remain intact
```

---

## 8. Acceptance Criteria & Kriteria untuk Milestone Berikutnya

### Kriteria yang Telah Terpenuhi di MVS-B2.5C.2:
- [x] Engine verifikasi ID Token terisolasi di sisi server telah diimplementasikan.
- [x] Validasi signature RS256 menggunakan kunci publik Google via JWKS.
- [x] Evaluasi seluruh klaim wajib (`iss`, `aud`, `azp`, `exp`, `iat`, `sub`, `nonce`, `email_verified`).
- [x] Penolakan mutlak algoritma 'none', algoritma simetris, dan header SSRF (`jku`, `x5u`, `jwk`).
- [x] Caching JWKS ber-TTL dengan mitigasi DoS pada rotasi kunci.
- [x] 100% lulus 28 uji adversarial, 0 regresi pada 278 tes lama (total 306 backend tests).
- [x] TypeScript build dan applet compilation sukses.

### Batasan yang Belum Dikerjakan (Scope Boundaries):
- Belum ada penukaran authorization code via HTTP POST ke `oauth2.googleapis.com/token`.
- Belum ada endpoint callback publik `/api/auth/oidc/google/callback`.
- Belum ada pembuatan akun pengguna atau penautan `ExternalIdentity`.
- Belum ada pembuatan sesi login atau cookie browser.

### Kriteria Masuk untuk MVS-B2.5C.3 (OIDC Network & Token Exchange):
1. Mengintegrasikan penukaran authorization code dengan PKCE `code_verifier` dari transaksi C1.
2. Mengonsumsi transaksi pre-auth secara atomik melalui `MemoryOIDCTransactionStore.consumeTransaction`.
3. Memanggil `verifyGoogleIDToken` dengan `id_token` hasil penukaran.
4. Menerapkan protokol pemetaan akun (`ExternalIdentity`) tanpa auto-merge (*anti-pre-hijacking*).
5. Membentuk sesi pengguna terautentikasi dan merotasi session ID (*anti-session-fixation*).

---

## 9. Status Akhir

**STATUS: PASS / READY FOR MVS-B2.5C.3**
**GOOGLE LOGIN: NOT ACTIVE**
Laporan audit ini diterbitkan sebagai rekam jejak checkpoint arsitektural milestone MVS-B2.5C.2 NutriBodySim.
