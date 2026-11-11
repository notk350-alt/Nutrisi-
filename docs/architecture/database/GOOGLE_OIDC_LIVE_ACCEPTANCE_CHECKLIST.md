# Google OIDC Live Acceptance Checklist

Status: **BLOCKED - provider credentials and Google Console configuration are not verified.** OIDC remains disabled by default. This checklist does not authorize staging or production activation.

## Secret and Environment Setup

- Create/verify the Google Cloud project, OAuth consent screen, support contact, and Web application OAuth client.
- Store `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in the approved environment secret manager. Never add them to source control, `.env.example`, frontend variables, CI logs, screenshots, or chat.
- Configure `GOOGLE_REDIRECT_URI` exactly as `https://<approved-host>/api/auth/google/callback`; register that exact URI in Google Console. Production and staging redirects must use HTTPS.
- Configure only the approved web origin. Do not use wildcard origins or callbacks.
- Keep `OIDC_ENABLED=false` until the complete preflight and test matrix below has passed in staging.
- Keep `DATABASE_RUNTIME_ROLE` set to the dedicated restricted login. Keep `MIGRATION_DATABASE_URL` unavailable to web/server processes.
- Never use Google login, email matching, a public endpoint, or this flow to create or promote a Main Administrator.

## Protocol and Identity Checks

- Authorization URL origin is exactly `https://accounts.google.com`; client ID and redirect URI match approved configuration.
- State, nonce, and PKCE verifier are cryptographically random and server-side; challenge method is `S256`.
- Callback is one-time, checks state and expiry, consumes transaction atomically before token exchange, and rejects replay.
- Token exchange uses the fixed Google token endpoint, POST, bounded timeout, redirects disabled, and server-held client secret/verifier.
- ID token accepts only RS256 from Google's official JWKS; validates signature, issuer, exact audience/authorized party, `exp`, `iat`, nonce, nonempty subject, and `email_verified === true`.
- Unverified email, unknown key, invalid signature, invalid issuer/audience, expiry, nonce mismatch, provider denial, missing state, and replay all fail closed.
- Existing local email collisions do not auto-merge. Existing linked account role is preserved; new users receive only `RegisteredUser` with no permissions.
- Account status must be ACTIVE. Main Administrator governance remains limited to the approved offline bootstrap procedure.

## Browser and Session Checks

- Popup receives only the Google authorization URL, and `postMessage` is accepted only from the configured redirect origin and expected popup window.
- Callback response sets `Cache-Control: no-store`, restrictive CSP, `Referrer-Policy: no-referrer`, and does not place application tokens in URLs or logs.
- Successful callback creates a repository-backed session and audit event transactionally. Verify session in a second application instance.
- Verify logout, logout-all/token-version revocation, expiry, suspended/disabled account rejection, and restart persistence.
- Verify all four role workflows and representative object-ownership checks using approved staging fixtures; do not use or create a Main Administrator through OIDC.

## Operations and Rollback

- Confirm database health, TLS, `current_user`, no DDL rights, no audit update/delete/truncate, audit trigger ownership/state, and absence of JSON/memory fallback before enabling OIDC.
- Verify shared multi-instance rate limiting exists for initiation and callback before live use. It is currently not implemented.
- Monitor sanitized counters/error codes only. Do not log authorization codes, state, nonce, PKCE verifier, access/ID tokens, session tokens, client secret, or full connection strings.
- If acceptance fails, set `OIDC_ENABLED=false` through approved configuration, preserve sessions/audit/data, and investigate. Do not reset tables, remove historical audit records, or fall back to owner credentials.
- Production activation requires separate explicit authorization after staging acceptance; this checklist alone is not activation approval.