# NutriBodySim MVS-B2.5C.4 — Laporan Audit & Verifikasi Keamanan
# Google OIDC Login Orchestration & Callback Boundary

---

## 1. Ringkasan Eksekutif & Status Milestone

* **Milestone**: MVS-B2.5C.4 — Google OIDC Login Orchestration & Callback Boundary
* **Mode Operasi**: **IMPLEMENTATION — ISOLATED AUTHENTICATION ORCHESTRATION**
* **Status**: **PASS / READY FOR EVALUATION**
* **Status Google Login Publik**: **TETAP TIDAK AKTIF (NOT ACTIVE)**
* **Tanggal Penyelesaian**: 18 Oktober 2026
* **Cakupan Kode Sumber**:
  - `backend/auth/oidc/types.ts`: Kontrak tipe orchestrator (`InitiateLoginOptions`, `InitiateLoginResult`, `HandleCallbackOptions`, `HandleCallbackResult`, `OrchestratorDependencies`, `OIDCOrchestrationErrorCode`).
  - `backend/auth/oidc/orchestrator.ts`: Orkestrator terisolasi yang mengoordinasikan inisiasi login (`initiateGoogleLogin`) dan penanganan callback (`handleGoogleCallback`), menghubungkan C.1 (Fondasi Transaksi), C.2 (Verifier ID Token), dan C.3 (Handler Token Exchange).
  - `backend/auth/oidc/index.ts`: Barrel export modul OIDC terpadu.
  - `backend/__tests__/oidcOrchestrationMVS_B2_5C4.test.ts`: 14 unit & adversarial test cases menguji alur inisiasi, validasi callback, penolakan replay, penolakan parameter bertentangan, anti-SSRF, ketiadaan efek samping, dan integritas arsitektural.
* **Hasil Pengujian Aktual**:
  - Test suite OIDC Orchestrator MVS-B2.5C.4: **14 dari 14 tes LULUS (100%)**.
  - Test suite Token Exchange MVS-B2.5C.3: **16 dari 16 tes LULUS (100%)**.
  - Test suite ID Token Verifier MVS-B2.5C.2: **28 dari 28 tes LULUS (100%)**.
  - Test suite OIDC Primitives MVS-B2.5C.1: **30 dari 30 tes LULUS (100%)**.
  - Test suite Backend Keseluruhan: **14 berkas tes, 336 tes LULUS (100%)**.
  - TypeScript Compiler (`tsc --noEmit` / `npm run lint`): **0 errors (CLEAN)**.
  - Applet Build (`compile_applet` / `npm run build`): **SUCCEEDED**.
  - Pemeriksaan Git: Lingkungan bukan repositori Git (`fatal: not a git repository`). Sesuai aturan, Git baru tidak diinisialisasi.

---

## 2. Diagram Alur Orkestrasi (Initiation to Callback Boundary)

```
[ Internal Server Caller ]
           │
           │ 1. initiateGoogleLogin(options)
           ▼
[ OIDC Orchestrator ]
   ├── Validasi Konfigurasi (Fail-closed: clientId, redirectUri, authEndpoint)
   ├── C.1 Transaction Store: Simpan Transaksi Pre-Auth Server
   │   (id, state, nonce, codeVerifier, codeChallenge [S256], expiresAt)
   ├── C.1 Primitives: constructAuthorizationUrl(...)
   └── Return: { success: true, authorizationUrl, clientData }
           │
           │ (Pengguna diarahkan ke Google Consent Screen secara eksternal)
           ▼
[ Browser / Google Callback Redirect ]
           │
           │ 2. handleGoogleCallback(query: code, state, error, etc.)
           ▼
[ OIDC Orchestrator ]
   ├── Validasi Input & Tipe Parameter
   ├── Deteksi Kontradiksi (Tolak jika memuat code DAN error sekaligus)
   ├── Penanganan Provider Error (e.g. access_denied -> OIDC_CALLBACK_PROVIDER_DENIED)
   ├── Pre-validasi State & Transaksi (Pastikan ada, unconsumed, & belum expired)
   │
   │ 3. Delegasi ke C.3 Token Exchange (exchangeGoogleAuthorizationCode)
   ▼
[ C.3 Token Exchange Handler ]
   ├── Konsumsi Transaksi Atomik (Single-Use, stateHash dihapus seketika)
   ├── Ambil Parameter Tepercaya Server: codeVerifier, nonce, redirectUri
   ├── HTTP POST: https://oauth2.googleapis.com/token (grant_type=authorization_code)
   │   (Timeout 5s, redirect='error', tanpa retry otomatis)
   │
   │ 4. Delegasi Verifikasi ID Token ke C.2 Verifier (verifyGoogleIDToken)
   ▼
[ C.2 ID Token Verifier ]
   ├── Validasi Struktur JWT & Signature RS256 via Google JWKS
   ├── Validasi iss, aud, azp, exp, iat, sub, nonce, email_verified
   └── Return: VerifiedOIDCIdentity
           │
           ▼
[ OIDC Orchestrator ]
   └── Return: { success: true, identity: VerifiedOIDCIdentity }
       (ZERO side-effects: Tanpa pembuatan user, sesi, atau cookie)
```

---

## 3. Kontrak Tipe & Antarmuka Orkestrasi

### 3.1. Inisiasi Login (`InitiateLoginOptions` & `InitiateLoginResult`)
```typescript
export interface InitiateLoginOptions {
  clientBinding?: string;
  returnUrl?: string;
  ttlSeconds?: number;
  currentTime?: number;
}

export interface InitiateLoginResult {
  success: boolean;
  authorizationUrl?: string;
  clientData?: OIDCClientTransactionData;
  error?: string;
  code?: OIDCOrchestrationErrorCode;
}
```

### 3.2. Penanganan Callback (`HandleCallbackOptions` & `HandleCallbackResult`)
```typescript
export interface HandleCallbackOptions {
  code?: unknown;
  state?: unknown;
  error?: unknown;
  error_description?: unknown;
  clientBinding?: string;
  currentTime?: number;
}

export interface HandleCallbackResult {
  success: boolean;
  identity?: VerifiedOIDCIdentity;
  error?: string;
  code?: OIDCOrchestrationErrorCode;
}
```

### 3.3. Kode Error Terstruktur (`OIDCOrchestrationErrorCode`)
* `OIDC_INIT_INVALID_CONFIGURATION`: Konfigurasi tidak lengkap, tidak aman, atau placeholder.
* `OIDC_INIT_TRANSACTION_CREATION_FAILED`: Kegagalan pembuatan transaksi pada store.
* `OIDC_CALLBACK_INVALID_INPUT`: Parameter code/state hilang, malformed, atau bertentangan.
* `OIDC_CALLBACK_STATE_INVALID`: State parameter hilang, kosong, atau melebihi batas panjang.
* `OIDC_CALLBACK_TRANSACTION_INVALID`: Transaksi tidak ditemukan, sudah dikonsumsi, atau kadaluwarsa.
* `OIDC_CALLBACK_PROVIDER_DENIED`: Google menolak autentikasi (user menolak consent/batal).
* `OIDC_CALLBACK_EXCHANGE_FAILED`: Kegagalan pada level pertukaran token C.3 atau verifikasi C.2.
* `OIDC_ORCHESTRATION_INTERNAL_ERROR`: Kesalahan internal tak terduga.

---

## 4. Jaminan Keamanan State & Transaksi

1. **Server-Authoritative Secrets**:
   - `code_verifier`, `stateHash`, `nonce`, dan `clientSecret` disimpan strictly di sisi server.
   - Proyeksi `clientData` yang dikembalikan ke pemanggil **TIDAK PERNAH** memuat rahasia server.
2. **Anti-SSRF Endpoint Constraint**:
   - Authorization endpoint terkunci pada `accounts.google.com` dengan protokol HTTPS. Host arbitrer ditolak seketika pada saat inisiasi.
3. **Pemeriksaan Kontradiksi Parameter Callback**:
   - Jika callback memuat `code` dan `error` secara bersamaan, request langsung ditolak dengan kode `OIDC_CALLBACK_INVALID_INPUT`.
4. **Pencegahan Replay & Race Conditions**:
   - State diverifikasi keberadaannya sebelum pertukaran token.
   - Konsumsi final dilakukan secara atomik di dalam C.3, di mana `stateIndex` dihapus seketika dan `transaction.consumed` di-set menjadi `true`. Percobaan kedua dengan state yang sama akan ditolak dengan `OIDC_CALLBACK_TRANSACTION_INVALID`.
5. **Keterbatasan Storage In-Memory**:
   - `MemoryOIDCTransactionStore` saat ini adalah in-memory store untuk satu proses instans.
   - Transaksi tidak bertahan setelah restart server dan tidak otomatis tersinkronisasi lintas multi-pod tanpa shared persistent storage (e.g. Redis). Keterbatasan ini diakui secara eksplisit dan fail-closed.

---

## 5. Matriks Hasil Pengujian Adversarial (14/14 Tests PASS)

```
Test Files  1 passed (1)
     Tests  14 passed (14)
  Duration  215ms

✓ 1. Login Initiation Flow
  ✓ initiates login, stores server transaction, and constructs valid Google authorization URL
  ✓ rejects initiation when configuration is invalid or missing required params
  ✓ rejects untrusted authorization endpoint host (anti-SSRF)
✓ 2. Callback Validation & Provider Denial
  ✓ rejects callback when state parameter is missing or empty
  ✓ rejects callback when authorization code is missing or empty
  ✓ safely handles provider error (e.g. access_denied) without calling token exchange
  ✓ rejects contradictory callback containing both code and error
✓ 3. Transaction Binding & Expiry on Callback
  ✓ rejects callback when state does not match any transaction in store
  ✓ rejects callback when pre-auth transaction has expired
  ✓ rejects callback when client browser binding does not match
✓ 4. Full End-to-End Orchestration (Initiate -> Callback -> Token Exchange -> C.2 Verification)
  ✓ completes the full flow and returns verified identity with zero side effects
  ✓ strictly prevents replay attacks when the same callback is submitted twice
  ✓ fails closed when Google ID token fails verification in C.2 verifier
✓ 5. Side-Effect Absence & Architectural Integrity
  ✓ verifies that full orchestration creates NO database users, NO sessions, and NO external identities
```

---

## 6. Laporan Angka Aktual (Regression & Verification)

* **Jumlah Tes Baru MVS-B2.5C.4**: **14 lulus, 0 gagal (100%)**.
* **Total Test Suite Backend**: **14 berkas tes, 336 tes lulus, 0 gagal (100%)**.
  - `authSessionMVS_B2.test.ts` (18)
  - `mainAdminBootstrapMVS_B2_5B2.test.ts` (22)
  - `rbacPermissionMVS_B2_3.test.ts` (30)
  - `objectAuthorizationMVS_B2_4.test.ts` (33)
  - `sessionConsistencyMVS_B2_5B4.test.ts` (16)
  - `adversarialRemediationMVS_B2_4B.test.ts` (32)
  - `adversarialVerificationMVS_B2_5A1.test.ts` (26)
  - `secureRoleApprovalMVS_B2_5B3.test.ts` (21)
  - `identityRoleRequestMVS_B2_5A.test.ts` (26)
  - `rbacHardeningMVS_B2_5B1.test.ts` (24)
  - `oidcPrimitivesTransactionMVS_B2_5C1.test.ts` (30)
  - `oidcTokenVerifierMVS_B2_5C2.test.ts` (28)
  - `oidcTokenExchangeMVS_B2_5C3.test.ts` (16)
  - `oidcOrchestrationMVS_B2_5C4.test.ts` (14)
* **Hasil Typecheck & Lint (`tsc --noEmit`)**: **0 errors / Clean**.
* **Hasil Build (`compile_applet`)**: **Build succeeded**.
* **File yang Dibuat / Diubah**:
  - `backend/auth/oidc/types.ts` (ditambahkan tipe orkestrator & kode error)
  - `backend/auth/oidc/orchestrator.ts` (dibuat baru)
  - `backend/auth/oidc/index.ts` (diperbarui)
  - `backend/__tests__/oidcOrchestrationMVS_B2_5C4.test.ts` (dibuat baru)
  - `app/applet/MVS_B2_5C4_AUDIT.md` & `MVS_B2_5C4_AUDIT.md` (dibuat)
  - `app/applet/MVS_B2_5C4_STATUS.md` & `MVS_B2_5C4_STATUS.md` (dibuat)
* **Dependensi Baru**: **0**.
* **Perubahan Runtime Publik**: **TIDAK ADA**. Google login publik tetap tidak aktif.

---

## 7. Batasan yang Dipatuhi (Stop Condition Adherence)

Sesuai instruksi mutlak MVS-B2.5C.4:
- Tidak membuat endpoint login atau callback publik pada `backend/routes/api.ts`.
- Tidak mengaktifkan tombol Google Login di UI.
- Tidak membuat akun pengguna baru di tabel `users`.
- Tidak menautkan `ExternalIdentity`.
- Tidak membuat sesi pengguna atau cookie browser.
- Tidak mengubah role, permission, atau status Main Administrator.
- Tidak mengaktifkan auto-merge akun.
- Tidak mengubah alur demo-login atau switch-user.

---

## 8. Status Akhir

**STATUS: PASS / READY FOR EVALUATION**  
**GOOGLE LOGIN PUBLIK: TETAP TIDAK AKTIF**  
Laporan audit ini diterbitkan sebagai rekam jejak checkpoint arsitektural milestone MVS-B2.5C.4 NutriBodySim.
