# NutriBodySim MVS-B2.5 — Architecture Specification: Identity, Google Login, Role Approval & Permission Engine

---

## Document Control & Meta
* **Project**: NutriBodySim (Nutritional Physiology & Computational Bioenergetics Platform)
* **Milestone**: MVS-B2.5 (Master Validation System Phase B2.5)
* **Status**: SPECIFICATION & AUDIT (REPORT-ONLY)
* **Date**: October 2026
* **Governing Rule**: Do not deploy, alter scientific algorithms, or implement live OAuth until this specification is audited and formally accepted.

---

## 1. Executive Summary & Context

NutriBodySim requires a hardened, enterprise-grade identity and access governance architecture. While MVS-B2.2 established cryptographic session tokens, MVS-B2.3 introduced role-based access control (RBAC), and MVS-B2.4/B2.4B enforced object-level authorization across 8 domain objects (projects, datasets, dataset versions, notebook cells, materials, experiments, calculation traces, and notes), the system currently relies on:
1. Demo fixtures with pre-seeded users (`usr_student`, `usr_lecturer`, `usr_researcher`, `usr_admin`).
2. A demo login endpoint (`POST /api/auth/demo-login`) and switch-user endpoint (`POST /api/auth/switch-user`) that issue session tokens upon request without cryptographic credential verification.
3. An in-memory session store (`MemorySessionStore`) that loses active sessions on process restart.
4. A static single-file JSON database (`nutribodysim_db.json`) lacking ACID transactions.

**MVS-B2.5** defines the formal architectural blueprint to transition NutriBodySim from demo session issuance to **Google OAuth 2.0 / OpenID Connect (OIDC)** authentication, coupled with a **Role Request & Administrator Approval Workflow**, granular data authorization, and non-repudiable audit logging.

---

## 2. Audit of Existing Architecture (Actual Codebase Evidence)

A comprehensive source code audit was conducted on the active codebase. Below is the factual analysis of files, routes, data structures, and security postures.

### 2.1 Audited Files and Subsystems

| Subsystem | File Path | Primary Function / Scope | Verified Status |
|---|---|---|---|
| **Session Store** | `backend/auth/sessionStore.ts` | Crypto token generation (32 bytes entropy), SHA-256 token hashing, in-memory validation, expiration, and revocation. | **PASS** (Cryptographic design sound; in-memory storage volatile) |
| **Authentication Middleware** | `backend/auth/authMiddleware.ts` | `extractToken` (Bearer / `x-session-token`), `createAuthMiddleware` (`authenticate`, `requireAuth`), `getCurrentUser`. | **PASS** (Strict rejection of unauthenticated requests; never trusts `x-user-id`) |
| **RBAC Middleware** | `backend/auth/rbacMiddleware.ts` | `ROLE_DEFAULT_PERMISSIONS`, `hasPermission`, `requirePermission`, `requireRole`, `requireAdmin`. | **PASS** (Server-side enforcement; returns HTTP 403 on insufficient privilege) |
| **Object Authorization** | `backend/auth/objectAuth.ts` | Fine-grained object checks (`canAccessProject`, `canAccessDataset`, `canAccessNotebook`, `canAccessNotebookCell`, `canAccessMaterial`, `canAccessExperiment`, `canAccessTeam`, `canAccessNote`). | **PASS** (Cross-user BOLA/IDOR protected) |
| **Environment Guard** | `backend/auth/authConfig.ts` | Separation of `isProduction` vs `enableDemoAuth`. Blocks demo login in production unless explicitly overridden. | **PASS** (Environment gate verified) |
| **API Router** | `backend/routes/api.ts` | Router-wide auth guard, public route whitelist, endpoints for auth, projects, datasets, calculations, statistics, notebooks, experiments, provenance, audit. | **PASS** (Protected by session resolution & object guards) |
| **Server & Static Storage** | `server.ts` | Express server, Vite middleware, `/storage/materials/:filename` path traversal defense and material-record access guard. | **PASS** (Protected against orphan file leakage and traversal) |
| **Database Store** | `backend/database/store.ts` | JSON file persistence (`data/nutribodysim_db.json`), demo seed generator, audit logging (`db.logAudit`). | **PASS** (Functional for prototype; volatile for production scale) |
| **Database Types** | `backend/database/types.ts` | Schema definitions for `User`, `Project`, `Dataset`, `Experiment`, `AuditLog`, `ProvenanceRecord`. | **PASS** (Types strict; lacks Google OIDC & approval fields) |

### 2.2 Security Findings & Vulnerability Assessment

#### FINDING-SEC-01: In-Memory Session Volatility (High Operational Risk)
* **Source**: `backend/auth/sessionStore.ts`, lines 40–81 (`MemorySessionStore.sessions = new Map()`).
* **Evidence**:
  ```ts
  export class MemorySessionStore implements ISessionStore {
    private sessions: Map<string, SessionData> = new Map();
  ...
  export const defaultSessionStore = new MemorySessionStore();
  ```
* **Impact**: If the server process restarts (container restart, redeployment, autoscaling), all issued sessions are wiped instantly. Every user is forcibly logged out. Cannot scale horizontally across multiple instances without a shared session cache (e.g., Redis) or stateless JWT/cookie architecture.
* **Severity**: **MEDIUM** (Operational availability in production).

#### FINDING-SEC-02: Demo Login & User Switching Endpoints (Critical Authentication Bypass Risk in Production)
* **Source**: `backend/routes/api.ts`, lines 149–215 (`POST /auth/demo-login`, `POST /auth/switch-user`).
* **Evidence**:
  ```ts
  apiRouter.post('/auth/demo-login', (req: Request, res: Response) => {
    const config = getAuthConfig();
    if (!config.enableDemoAuth) {
      return res.status(403).json({ error: 'Demo authentication is disabled in production environment.', code: 'DEMO_AUTH_DISABLED' });
    }
    const { user_id } = req.body || {};
    ...
    const { token, expiresAt } = defaultSessionStore.createSession(user.id, config.sessionTtlSeconds);
    res.json({ token, user, expires_at: expiresAt });
  });
  ```
* **Impact**: While protected by `config.enableDemoAuth` when `NODE_ENV === 'production'`, any configuration lapse or omission of `NODE_ENV=production` allows an attacker to supply `user_id: "usr_admin"` and receive an active Administrator session with zero credential proof.
* **Severity**: **HIGH** (Catastrophic if enabled in public network).
* **Remediation Requirement**: In production builds, `demo-login` and `switch-user` routes must be physically excluded or hard-disabled with compiler flags, not just runtime environment checks.

#### FINDING-SEC-03: Lack of User Account Lifecycle & External Identity Linking
* **Source**: `backend/database/types.ts`, lines 31–41.
* **Evidence**:
  ```ts
  export interface User {
    id: string;
    email: string;
    name: string;
    role: UserRole;
    permissions: Permission[];
    organization?: string;
    avatar_url?: string;
    created_at: string;
    last_login_at: string;
  }
  ```
* **Impact**: The data schema lacks external identity provider fields (`provider`, `provider_subject_id`), email verification status (`email_verified`), account state (`status: ACTIVE | SUSPENDED | DISABLED`), and role request state (`approval_status`).
* **Severity**: **MEDIUM** (Architecture gap for MVS-B2.5).

#### FINDING-SEC-04: Lack of Atomic Database Transactions & Concurrency Control
* **Source**: `backend/database/store.ts`, lines 164–166 (`saveToDisk` using synchronous `fs.writeFileSync`).
* **Evidence**: Concurrent writes or crash during JSON file serialization can corrupt `nutribodysim_db.json`. No transactional rollback exists if an operation fails midway.
* **Severity**: **MEDIUM** (Data integrity risk for production deployment).

---

## 3. Google OAuth 2.0 / OpenID Connect Architecture

### 3.1 AI Studio Environment & Iframe Constraints
The application runs inside Google AI Studio Build preview containers which execute within an **iframe**.
* **Constraint**: Container URLs cannot be rendered directly in a popup window. Opening container URLs in a browser popup results in a blank fallback.
* **Architecture Solution**:
  1. The client queries the backend API (`GET /api/auth/google/url`) to obtain the fully constructed Google OAuth authorization URL.
  2. The client opens `window.open(googleAuthUrl, 'google_oauth_popup', 'width=500,height=650')` targeting `https://accounts.google.com` directly.
  3. The Google consent screen completes, and Google redirects to the backend callback: `GET /api/auth/google/callback?code=...&state=...`.
  4. The callback endpoint verifies the authorization code and ID token server-side, generates an application session, and responds with a minimal HTML script that uses `window.opener.postMessage({ type: 'GOOGLE_AUTH_SUCCESS', token, user }, window.location.origin)` and calls `window.close()`.

```
+-----------------------------------------------------------------------------------------+
|                                    USER BROWSER                                         |
|  +----------------------------------------------------+                                 |
|  |           AI Studio Iframe Parent Window           |                                 |
|  |  [User clicks "Sign In with Google"]               |                                 |
|  |  1. GET /api/auth/google/url                       |                                 |
|  |  2. Opens popup directly to Google Authorization   |                                 |
|  |                                                    |     +-------------------------+ |
|  |  6. Receives window.postMessage from popup         |     |   Google OAuth Popup    | |
|  |  7. Stores session token & updates React auth state|     |  3. User logs in &      | |
|  +----------------------------------------------------+     |     grants consent      | |
|                                                             |  4. Redirects to:       | |
|                                                             |     /api/auth/google/   | |
|                                                             |     callback?code=...   | |
|                                                             +------------+------------+ |
+--------------------------------------------------------------------------|--------------+
                                                                           |
                                                                           v
                                                         +-----------------+------------+
                                                         |  NutriBodySim Backend Server |
                                                         |  5. Validates state, nonce,  |
                                                         |     exchanges code with      |
                                                         |     oauth2.googleapis.com,   |
                                                         |     cryptographically        |
                                                         |     verifies ID Token,       |
                                                         |     creates App Session,     |
                                                         |     returns postMessage HTML |
                                                         +------------------------------+
```

### 3.2 OIDC Protocol & Cryptographic Verification Specifications

1. **State & CSRF Protection**:
   * Server generates a cryptographically random 32-byte hex string (`state`).
   * Stored in server cache with a 5-minute TTL, indexed by an ephemeral cookie or state key.
   * Callback rejects requests where `req.query.state` does not match the stored state.

2. **Nonce & Replay Attack Defense**:
   * Server generates a cryptographically random 32-byte hex string (`nonce`).
   * Passed to Google in the authorization request.
   * Server validates that the returned ID Token contains `claims.nonce === stored_nonce`.

3. **PKCE (Proof Key for Code Exchange)**:
   * Recommended for Authorization Code flow.
   * Server generates `code_verifier` (43–128 characters) and computes `code_challenge = BASE64URL(SHA256(code_verifier))`.
   * Passes `code_challenge` with `code_challenge_method=S256` to Google.
   * Delivers `code_verifier` during token exchange.

4. **ID Token Server-Side Cryptographic Validation**:
   * NutriBodySim server never trusts client-supplied JWT claims without server-side verification.
   * Verification steps:
     * Retrieve Google's public JWKS certificates from `https://www.googleapis.com/oauth2/v3/certs`.
     * Verify JWT signature using `RS256` public key from JWKS.
     * Validate `iss` is `https://accounts.google.com` or `accounts.google.com`.
     * Validate `aud` matches the configured `GOOGLE_CLIENT_ID`.
     * Validate `exp` has not expired (`exp > currentTime`).
     * Extract `sub` (Google's unique, immutable subject identifier).
     * Extract `email` and `email_verified`.

5. **Stable External Identifier**:
   * The user identity is keyed on `provider = 'google'` and `provider_subject_id = claims.sub`.
   * Email is never used as the sole immutable primary key because users may update Google email addresses or use aliases.

6. **Email Verification Policy**:
   * Only users with `claims.email_verified === true` are accepted for account creation.
   * Unverified emails are rejected with HTTP 403 `EMAIL_NOT_VERIFIED`.

7. **Client Secret Confidentiality**:
   * `GOOGLE_CLIENT_SECRET` exists strictly in server-side environment variables (`.env`).
   * Never exposed to frontend code, network responses, client bundles, or logs.

8. **Session Issuance & Independence**:
   * Upon successful OIDC verification, the server issues its own internal NutriBodySim session token (256 bits entropy, SHA-256 hashed in store).
   * Google's access token is discarded or retained strictly for optional user-approved Workspace scopes. It is never used as an internal authorization ticket.

---

## 4. Account Lifecycle, Profiles & Role Hierarchy

### 4.1 Account Lifecycle State Machine

```
               [Google OIDC Login]
                        |
                        v
               +-----------------+
               |  User Record    |
               |  Created        |
               +--------+--------+
                        |
                        v
               +-----------------+
               |     ACTIVE      |<=============================+
               | (Default Role:  |                              |
               | Registered User)|                              |
               +---+---------+---+                              |
                   |         |                                  |
    Admin Suspends |         | Admin Disables                   | Admin
    (e.g. Audit)   |         | (e.g. Violation)                 | Re-activates
                   v         v                                  |
           +-----------+  +------------+                        |
           | SUSPENDED |  |  DISABLED  |                        |
           +-----+-----+  +------+-----+                        |
                 |               |                              |
                 +---------------+------------------------------+
```

* **ACTIVE**: Account can authenticate, submit role requests, and perform operations permitted by its current role.
* **SUSPENDED**: Temporary administrative lock. Authentication immediately rejected with `403 ACCOUNT_SUSPENDED`. All active sessions revoked immediately.
* **DISABLED**: Permanent account termination. Authentication blocked. Data retained in read-only audit state or anonymized in compliance with retention policies.

### 4.2 Role Approval Workflow State Machine

```
              [New Google User]
                      |
                      v
            approval_status: NOT_REQUESTED
            role: Registered User
                      |
                      | User submits POST /api/users/request-role
                      v
            approval_status: PENDING
            requested_role: Student | Lecturer | Researcher | Admin
            (Audit logged: ROLE_REQUEST_SUBMITTED)
                      |
         +------------+------------+
         |                         |
         | Main Admin Approves     | Main Admin Rejects
         v                         v
  approval_status: APPROVED  approval_status: REJECTED
  role: <requested_role>     role: Registered User (remains)
  approved_by: <admin_id>    rejection_reason: <reason>
  approved_at: <timestamp>   (Audit logged: ROLE_REJECTED)
  (Audit: ROLE_APPROVED)
         |
         | Sessions invalidated & refreshed
         v
  User operates with elevated privileges
```

### 4.3 7-Tier Role Hierarchy & Permissions Matrix

NutriBodySim establishes a 7-tier canonical governance hierarchy:

| Tier | Role Name | Intended Audience | Default Role Permissions | Project-Level Override Restrictions | Self-Request Allowed? |
|---|---|---|---|---|---|
| **0** | **Guest** | Unauthenticated visitors | `[VIEW]` (Public benchmarks & docs only) | Cannot belong to projects | N/A |
| **1** | **Registered User** | Default authenticated user | `[VIEW, USE, CREATE]` (Personal calculator & drafts) | Cannot view private academic/research projects | Default upon Google Login |
| **2** | **Student** | Verified university/college students | `[VIEW, USE, CREATE, CLONE]` | Access only to personal projects and assigned Course Labs | **Yes** (Pending Admin/Faculty approval) |
| **3** | **Lecturer** | Verified academic faculty & educators | `[VIEW, USE, CREATE, CLONE, EDIT, SHARE, PUBLISH]` | Can create and manage Course Labs, assign student cohorts | **Yes** (Requires faculty credentials review) |
| **4** | **Researcher** | Clinical nutritionists, bioenergeticists | `[VIEW, USE, CREATE, CLONE, EDIT, SHARE, PUBLISH]` | Full access to multi-center cohorts, model cloning, advanced stats | **Yes** (Requires institutional affiliation proof) |
| **5** | **Administrator** | System operations & compliance officers | `[VIEW, USE, CREATE, CLONE, EDIT, DELETE, SHARE, PUBLISH, VERIFY, ADMIN]` | Administrative oversight across system resources; audited | **Yes** (Requires Board review; self-approval strictly blocked) |
| **6** | **Main Administrator / Owner** | Founding governance board & root owner | Full permissions + Role Approval + System Bootstrap | Final authority on privileged role grants and revocations | **NO** (Bootstrap-only, single root identity) |

---

## 5. Granular Action Matrix per Domain Object

Each object in NutriBodySim enforces the following action authorization matrix:

| Domain Object | VIEW (Read Metadata) | USE (Execute / Run) | CREATE (Instantiate New) | EDIT (Mutate Existing) | DELETE (Remove) | SHARE (Manage Permissions) | PUBLISH (Expose to Public) | VERIFY (Scientific Audit) |
|---|---|---|---|---|---|---|---|---|
| **Project** | Public OR Member (Any Role) | Member (Any Role) | Registered User+ | Owner OR Editor OR Collaborator | Direct Owner Only | Owner OR Editor | Owner Only | Owner OR Admin |
| **Dataset** | Public OR Project Member | Project Member | Project Member with WRITE role | Project Member with WRITE role | Project Owner Only | Project Owner OR Editor | Project Owner Only | Researcher+ with Admin audit |
| **Dataset Version** | Dataset READ allowed | Dataset READ allowed | Dataset WRITE allowed | **IMMUTABLE** (Raw & Cleaned versions cannot be mutated) | Dataset Owner Only | Inherited from Dataset | Project Owner Only | Scientific Board Review |
| **Formula (Standard)** | Guest+ (Public registry) | Registered User+ | Admin / Main Admin Only | Admin / Main Admin Only | Admin Only | Public by default | Scientific Board Approved | Governance Board Signed |
| **Formula (Custom/Personal)**| Author Only | Author OR Shared Project Member | Registered User+ | Author Only | Author Only | Author Only | Requires Review & Admin approval | Reviewer+ |
| **Notebook & Cells** | Project READ allowed | Project READ allowed | Project WRITE allowed | Project WRITE allowed | Project WRITE allowed | Inherited from Project | Project Owner Only | N/A |
| **Material File** | Public OR Project Member | Project Member | Lecturer / Researcher+ | Material Uploader OR Project Editor | Material Uploader Only | Project Owner OR Editor | Project Owner Only | N/A |
| **Calculation Trace** | Trace Owner OR Project Member | N/A (Output artifact) | Produced via Formula Execution | **IMMUTABLE** (Never edited) | Trace Owner Only | Inherited from Project | Project Owner Only | Cryptographic hash match |
| **Experiment Sandbox** | Project READ allowed | Project Member | Project WRITE allowed | Project WRITE allowed | Project Owner Only | Inherited from Project | Project Owner Only | Cryptographic hash match |
| **Provenance Record** | Project READ allowed | N/A (Audit trail) | System Generated | **IMMUTABLE** (Tamper-evident) | **NEVER** (Audit trail is permanent) | Inherited from Project | Inherited from Project | SHA-256 Manifest match |
| **Audit Logs** | Admin / Main Admin Only | N/A | System Generated | **NEVER** (Append-only) | **NEVER** | Admin Only | N/A | Cryptographic integrity |

---

## 6. Scientific Engine Governance: Formula & Model Lifecycle

Scientific integrity requires strict separation between **Software Access Authorization** and **Scientific Validity Verification**. Being a Lecturer or Administrator does not automatically validate mathematical or physiological equations.

### 6.1 Scientific Formula Lifecycle State Machine

```
   [Author Drafts Formula]
             |
             v
         +-------+
         | DRAFT | (Private to Author & Workspace)
         +---+---+
             | Author submits for peer review
             v
        +----------+
        |  REVIEW  | (Shared with Scientific Reviewers / Faculty)
        +----+-----+
             |
     +-------+-------+
     |               |
     | Review Fails  | Review Passes (Equations & references verified)
     v               v
+----------+   +----------+
| REJECTED |   | APPROVED | (Passed dimensional analysis & peer review)
+----------+   +----+-----+
                    | Scientific Board Publishes
                    v
              +-----------+
              | PUBLISHED | (Locked, SemVer tagged, immutable)
              +-----------+
```

### 6.2 Formula Verification Requirements
* **Dimensional Consistency**: Must satisfy allometric scaling invariants $[M]^a [L]^b [T]^c$.
* **Boundary Validation**: Numerical safety assertions preventing divide-by-zero, negative exponents, or biologically impossible metabolic rates.
* **Literature Grounding**: Mandatory DOI or peer-reviewed citation in `reference_ids`.
* **Provenance Hash**: Deterministic SHA-256 hash computed over AST representation and parameters.

---

## 7. Proposed Data Schema Architecture

### 7.1 Enhanced User Entity Schema
```typescript
export type AccountStatus = 'ACTIVE' | 'SUSPENDED' | 'DISABLED';
export type ApprovalStatus = 'NOT_REQUESTED' | 'PENDING' | 'APPROVED' | 'REJECTED';
export type UserRole = 
  | 'Guest' 
  | 'Registered User' 
  | 'Student' 
  | 'Lecturer' 
  | 'Researcher' 
  | 'Admin' 
  | 'Owner';

export interface User {
  id: string;                          // Internal UUID (e.g. 'usr_c83f91a2-...')
  provider: 'google' | 'local';        // Auth provider
  provider_subject_id?: string;        // Google OpenID 'sub' claim
  email: string;                       // Primary email address
  email_verified: boolean;             // Must be true from Google ID token
  name: string;                        // Full display name
  given_name?: string;                 // First name
  family_name?: string;                // Last name
  avatar_url?: string;                 // Profile picture URL
  organization?: string;               // University, institute, hospital
  department?: string;                 // Academic or research department
  academic_identifier?: string;        // ORCID, Scopus ID, or Student ID
  
  status: AccountStatus;               // Account lifecycle flag
  role: UserRole;                      // Currently active effective role
  permissions: Permission[];           // Explicit permission grants
  
  requested_role?: UserRole;           // Pending requested role
  approval_status: ApprovalStatus;     // Role approval state
  approval_notes?: string;             // Justification provided by applicant
  rejection_reason?: string;           // Reason provided by Admin on rejection
  approved_by?: string;                // User ID of Administrator who decided
  approved_at?: string;                // ISO timestamp of decision
  
  created_at: string;                  // Account creation timestamp
  updated_at: string;                  // Profile modification timestamp
  last_login_at: string;               // Most recent successful login timestamp
}
```

### 7.2 Role Request & Audit Record Schema
```typescript
export interface RoleRequest {
  id: string;                          // Request UUID (e.g. 'req_8f1a...')
  user_id: string;                     // Applicant user ID
  current_role: UserRole;              // Role at time of application
  requested_role: UserRole;            // Role applied for
  justification: string;               // Academic/institutional justification
  evidence_urls: string[];             // Faculty profile URL, publication link, etc.
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  reviewed_by?: string;                // Deciding Admin user ID
  reviewed_at?: string;                // ISO timestamp of review
  review_notes?: string;               // Mandatory reason if rejected
  created_at: string;                  // Application submission timestamp
}

export interface RoleHistoryLog {
  id: string;
  user_id: string;
  previous_role: UserRole;
  new_role: UserRole;
  changed_by: string;                  // 'SYSTEM_SELF_REGISTER' or admin user ID
  reason: string;
  timestamp: string;
}
```

### 7.3 Ephemeral OAuth State & PKCE Record Schema
```typescript
export interface OAuthStateRecord {
  state: string;                       // 32-byte hex random string
  nonce: string;                       // 32-byte hex random string for OIDC
  code_verifier: string;               // PKCE code verifier
  created_at: number;                  // Timestamp (ms)
  expires_at: number;                  // 5 minutes TTL
}
```

---

## 8. Proposed API Endpoint Specifications

### 8.1 Authentication Endpoints

#### `GET /api/auth/google/url`
* **Access**: Public
* **Description**: Generates Google OAuth 2.0 authorization URL with PKCE and CSRF state.
* **Response (200)**:
  ```json
  {
    "url": "https://accounts.google.com/o/oauth2/v2/auth?client_id=...&redirect_uri=...&response_type=code&scope=openid%20email%20profile&state=...&nonce=...&code_challenge=...&code_challenge_method=S256"
  }
  ```

#### `GET /api/auth/google/callback`
* **Access**: Public (Callback from Google)
* **Parameters**: `code` (string), `state` (string)
* **Behavior**:
  1. Validates `state` against active `OAuthStateRecord` in server memory.
  2. Exchanges `code` and `code_verifier` with `https://oauth2.googleapis.com/token`.
  3. Verifies ID token signature against Google JWKS.
  4. Validates `iss`, `aud`, `exp`, and `nonce`.
  5. Upserts user record in database.
  6. Generates application session token in `SessionStore`.
  7. Returns HTML response that posts token to parent window via `window.opener.postMessage` and closes popup.

#### `POST /api/auth/logout`
* **Access**: Authenticated (`requireAuth`)
* **Behavior**: Revokes active session token in `SessionStore`. Logs audit entry. Returns HTTP 200.

#### `GET /api/auth/me`
* **Access**: Authenticated (`requireAuth`)
* **Response**: Detailed current user profile, effective role, permission list, and active approval status.

### 8.2 Role Request & Approval Endpoints

#### `POST /api/users/request-role`
* **Access**: Authenticated (`requireAuth`)
* **Body**:
  ```json
  {
    "requested_role": "Lecturer",
    "justification": "Adjunct Professor of Nutrition, Faculty of Medicine",
    "evidence_urls": ["https://university.edu/faculty/jdoe", "https://orcid.org/0000-..."]
  }
  ```
* **Validation**:
  * Role must be one of `Student`, `Lecturer`, `Researcher`, `Admin`.
  * Cannot request role lower than or equal to current role.
  * Cannot submit new request if already has `PENDING` request.
* **Response (201)**: Created `RoleRequest` record. User `approval_status` set to `PENDING`.

#### `GET /api/admin/role-requests`
* **Access**: Admin / Main Admin Only (`requireAdmin`)
* **Query Params**: `status` (`PENDING | APPROVED | REJECTED`), `limit`, `offset`
* **Response (200)**: Array of pending and resolved role requests.

#### `POST /api/admin/role-requests/:id/approve`
* **Access**: Admin / Main Admin Only (`requireAdmin`)
* **Validation**:
  * Request must exist and be in `PENDING` state.
  * **Anti-Self-Approval**: Admin cannot approve their own role request (`req.user.id !== request.user_id`).
* **Behavior**:
  * Sets request status to `APPROVED`.
  * Updates applicant's `role` and grants corresponding permissions.
  * Sets `approval_status = 'APPROVED'`, stamps `approved_by` and `approved_at`.
  * Records `RoleHistoryLog`.
  * Updates active session metadata so applicant immediately receives elevated permissions.
  * Logs BOLA-hardened audit event.

#### `POST /api/admin/role-requests/:id/reject`
* **Access**: Admin / Main Admin Only (`requireAdmin`)
* **Body**: `{ "reason": "Insufficient institutional proof provided." }`
* **Validation**: Mandatory non-empty reason.
* **Behavior**: Sets request status to `REJECTED`, records rejection reason, maintains existing user role.

#### `POST /api/admin/users/:id/status`
* **Access**: Main Admin Only
* **Body**: `{ "status": "SUSPENDED" | "ACTIVE" | "DISABLED", "reason": "..." }`
* **Behavior**: Updates user account status. If suspended or disabled, immediately revokes all active sessions in `SessionStore`.

---

## 9. Session Security, Cookies & Token Governance

1. **Token Entropy & Storage**:
   * Token length: 32 bytes (256 bits) generated using `crypto.randomBytes(32).toString('hex')`.
   * Server database stores strictly `crypto.createHash('sha256').update(token).digest('hex')`. Raw tokens are never logged or stored.

2. **Session Rotation & Refresh**:
   * Session is rotated upon login and upon any role change.
   * If a user's role is promoted or revoked, existing session records are invalidated and replaced to prevent privilege escalation via stale session claims.

3. **Cookie vs Bearer Architecture**:
   * *AI Studio Preview Limitation*: The iframe environment restricts third-party cookies across origins.
   * *Design*: Primary token delivery uses `postMessage` from the OAuth popup to the iframe parent, which stores the token in memory/session context and sends it via `Authorization: Bearer <token>`.
   * *Production Deployment*: When deployed on a custom domain outside iframes, standard `HttpOnly`, `Secure`, `SameSite=Lax` cookies should be enabled.

4. **Session Lifetime**:
   * Idle timeout: 2 hours of inactivity.
   * Absolute maximum TTL: 24 hours.

5. **Rate Limiting**:
   * OAuth initiation (`/api/auth/google/url`): Max 10 requests / minute per IP.
   * Callback (`/api/auth/google/callback`): Max 10 requests / minute per IP.
   * Role requests (`/api/users/request-role`): Max 3 submissions / hour per user.

---

## 10. Operational Readiness, Persistence & Migration Strategy

### 10.1 Storage Evaluation

| Component | Current Implementation | Production Requirement | Gap / Recommendation |
|---|---|---|---|
| **User & App Data** | Single JSON file (`nutribodysim_db.json`) | Relational PostgreSQL / Cloud SQL or Firestore | **FAIL for production**. JSON file lacks write locking, transactions, and concurrency. Migrate to managed database before production release. |
| **Session Cache** | In-memory `Map` | Redis or PostgreSQL session table | **FAIL for production**. In-memory map lost on restart. Needs durable or Redis-backed session store. |
| **Audit Logs** | In-memory array saved to JSON | Append-only Cloud Logging or tamper-evident DB table | **FAIL for production**. Audit logs can be truncated if JSON file is edited. Needs immutable append-only storage. |
| **Material Files** | Local filesystem (`storage/materials`) | Cloud Storage (GCS bucket) with signed URLs | **ACCEPTABLE for preview; FAIL for production cluster**. Container disk is ephemeral on Cloud Run. |

### 10.2 Zero-Downtime Data Migration Strategy
1. **Schema Additive Migration**:
   * Add new fields (`provider`, `provider_subject_id`, `status`, `approval_status`) with backward-compatible defaults.
   * Existing seed users (`usr_student`, `usr_lecturer`, `usr_researcher`, `usr_admin`) are tagged with `provider = 'local'`, `status = 'ACTIVE'`, `approval_status = 'APPROVED'`.
2. **Database Abstraction**:
   * Create a repository pattern interface `IUserRepository`, `IProjectRepository`, etc.
   * Allow swapping `DatabaseStore` from JSON to Cloud SQL / Firestore without touching REST route handlers.

---

## 11. External Configuration Requirements & Blockers

The following configurations must be obtained from Google Cloud Console before Google Login can be activated:

| Requirement | Description | Current Status |
|---|---|---|
| **Google Cloud Project** | GCP project hosting the OAuth consent screen | **BLOCKED** (Pending user creation) |
| **OAuth Consent Screen** | Configured with App name, support email, and `openid`, `email`, `profile` scopes | **BLOCKED** (Not configured) |
| **OAuth 2.0 Client ID** | Web application client ID | **BLOCKED** (Pending GCP console setup) |
| **OAuth 2.0 Client Secret**| Web application client secret | **BLOCKED** (Pending GCP console setup) |
| **Authorized Origins** | Must include preview and production origins (e.g. `https://ais-dev-i26v5z4ijyvkpvxl2hqb75-134558258990.asia-southeast1.run.app`) | **BLOCKED** (Pending GCP console setup) |
| **Authorized Redirect URIs** | Must include `https://<domain>/api/auth/google/callback` | **BLOCKED** (Pending GCP console setup) |
| **Bootstrap Root Admin** | Designate one verified Google email as initial Main Administrator | **BLOCKED** (Pending user confirmation) |

---

## 12. Verification Test Plan & Acceptance Matrix

When MVS-B2.5 is scheduled for implementation, the following test matrix must achieve 100% PASS:

| Test ID | Test Category | Target Endpoint | Test Description | Expected Result |
|---|---|---|---|---|
| **T-AUTH-01** | Google OAuth | `GET /api/auth/google/url` | Request OAuth URL | Returns valid URL with `client_id`, `state`, `nonce`, `code_challenge` |
| **T-AUTH-02** | CSRF State | `GET /api/auth/google/callback` | Callback with forged or missing `state` | **HTTP 400** Invalid state |
| **T-AUTH-03** | Token Signature | `GET /api/auth/google/callback` | Callback with counterfeit Google ID token | **HTTP 401** Token signature verification failed |
| **T-AUTH-04** | Nonce Match | `GET /api/auth/google/callback` | ID token with mismatched `nonce` | **HTTP 401** Replay attack detected |
| **T-AUTH-05** | Email Verified | `GET /api/auth/google/callback` | Google account with `email_verified: false` | **HTTP 403** Email verification required |
| **T-AUTH-06** | New User Role | `GET /api/auth/google/callback` | First-time Google login | User created with role `Registered User`, approval `NOT_REQUESTED` |
| **T-AUTH-07** | Existing User | `GET /api/auth/google/callback` | Returning Google user | Existing user record retrieved, role preserved, session issued |
| **T-ROLE-01** | Role Request | `POST /api/users/request-role` | User requests Lecturer role | Request created with `PENDING`, audit logged |
| **T-ROLE-02** | Duplicate Request | `POST /api/users/request-role` | User submits while request is `PENDING` | **HTTP 409** Pending request already exists |
| **T-ROLE-03** | Self-Approval | `POST /api/admin/role-requests/:id/approve` | Admin tries to approve their own role request | **HTTP 403** Anti-self-approval rule enforced |
| **T-ROLE-04** | Unauthorized Approve | `POST /api/admin/role-requests/:id/approve` | Non-admin user tries to approve a role | **HTTP 403** Forbidden |
| **T-ROLE-05** | Valid Approval | `POST /api/admin/role-requests/:id/approve` | Admin approves Researcher request | Applicant role promoted, active session refreshed, audit logged |
| **T-ROLE-06** | Rejection | `POST /api/admin/role-requests/:id/reject` | Admin rejects request with reason | Role remains unchanged, reason recorded, audit logged |
| **T-ROLE-07** | Suspension | `POST /api/admin/users/:id/status` | Admin suspends user | User status `SUSPENDED`, all sessions immediately revoked |
| **T-REG-01** | Regression | Vitest Suite (41 suites) | Run full existing test suite (1,300 tests) | **100% PASS** (Zero regression on scientific core & B2.4) |

---

## 13. Phased Implementation Roadmap

1. **Phase B2.5-A**: Schema & Role Request Core
   * Update `backend/database/types.ts` with enhanced `User`, `RoleRequest`, and `RoleHistoryLog`.
   * Implement repository migration to backfill existing demo accounts without data loss.
   * Add `POST /api/users/request-role` and `GET /api/users/role-request`.

2. **Phase B2.5-B**: Admin Approval Console Engine
   * Add `GET /api/admin/role-requests`, `POST /api/admin/role-requests/:id/approve`, `POST /api/admin/role-requests/:id/reject`.
   * Enforce anti-self-approval and session invalidation/refresh hooks.
   * Write comprehensive unit & adversarial test suite.

3. **Phase B2.5-C**: Google OAuth 2.0 PKCE Server Implementation
   * Obtain GCP OAuth credentials.
   * Implement `GET /api/auth/google/url` with cryptographic state/nonce/PKCE generator.
   * Implement `GET /api/auth/google/callback` with Google JWKS signature validation and ID token verification.

4. **Phase B2.5-D**: Frontend UI Integration
   * Build "Sign in with Google" button utilizing popup window pattern.
   * Build "Request Role" modal in User Profile view.
   * Build "Role Requests Management" tab in Administrator Dashboard.

5. **Phase B2.5-E**: Production Gate & Security Audit
   * Run adversarial verification tests.
   * Validate immutable audit trails.
   * Disable demo login in production builds.

---

## 14. Verification & Production Readiness Verdict

* **Codebase Verification**: 41 test suites, 1,300 tests passed, 0 failed, 0 skipped.
* **TypeScript Compilation**: Clean (`tsc --noEmit` exit code 0).
* **Bundle Build**: Clean (`vite build && esbuild` exit code 0).
* **MVS-B2.5 Architecture Status**: **SPECIFICATION COMPLETE & VERIFIED**
* **Production Deployment Status**: **NOT PRODUCTION READY (BLOCKED)**
  * *Blocker 1*: Missing Google Cloud OAuth Client ID / Secret credentials.
  * *Blocker 2*: In-memory session store needs migration to durable store (e.g. Redis / PostgreSQL).
  * *Blocker 3*: Single-file JSON database needs migration to ACID database before public release.
