# NutriBodySim First Controlled Trial Guide

Status: **BLOCKED - staging deployment and real Google login are not available yet**

This guide is preparation for a first staging trial. It is not production authorization and does not prove that the current application has been deployed.

## Current Gate

Do not start user onboarding until every blocking item below has been verified:

- An approved HTTPS staging hostname and hosting access are available.
- A recoverable, recent PostgreSQL backup or provider snapshot is documented and restore-tested in an isolated target.
- Runtime and migration credentials are provisioned separately through a secret manager; `nutribodysim_app` must be the runtime login and `nutribodysim_migrator` the migration login.
- The approved role migration is reviewed, then applied through the migration principal only after the staging target is reconfirmed.
- Google OAuth client, consent screen, allowed origin, and exact HTTPS callback are configured in Google Cloud Console.
- Shared multi-instance rate limiting for OIDC initiation/callback is implemented and tested.
- Staging acceptance passes for auth, authorization, restart, recovery, and role workflows.

## Google Cloud Console Values

Use values only after the hosting owner confirms the real staging host:

- Authorized JavaScript origin: `https://<confirmed-staging-host>`
- Authorized redirect URI: `https://<confirmed-staging-host>/api/auth/google/callback`
- OAuth scopes: `openid`, `email`, `profile`
- Keep `GOOGLE_CLIENT_SECRET` in the staging secret manager. Never place secrets in this guide, source control, chat, shell history, screenshots, or logs.
- Set `OIDC_ENABLED=true` only after all configuration and staging gates pass. Keep it `false` until then.

## Trial Roles and Accounts

- Student, Lecturer, and Researcher access must be assigned through the existing role-request and approval governance, not inferred from Google email, domain, or claims.
- New Google accounts receive only `RegisteredUser` with no permissions.
- Main Administrator setup remains an approved offline/bootstrap procedure. Never create or promote one through Google login or a public route.
- Use only accounts whose owners explicitly consent to the test. Do not copy production personal data into staging.

## Trial Sequence

1. Open the confirmed HTTPS staging URL and record the deployment/build identifier.
2. Verify `/health` is healthy and reveals no connection strings, credentials, token values, or sensitive database information.
3. Sign in with an approved test Google account. Verify callback success, correct Google `sub` mapping, verified email, `RegisteredUser` default, and persistent session.
4. Verify logout, login again, session expiry, logout-all/token-version revocation, and rejection of inactive accounts.
5. Request each governed role with separate approved accounts. Verify approval/rejection permissions, audit events, and role persistence. Do not use Main Administrator account bootstrap as an interactive trial path.
6. Exercise dashboard, materials, calculator, research workspace, data workflows, and representative object ownership for each role. Record unavailable features as NOT IMPLEMENTED rather than simulating success.
7. Verify cross-user data isolation and forbidden-role/API access returns the expected denial without mutating unrelated data.
8. Confirm the same session and OIDC transaction behavior across two backend instances and after a server restart. Verify database outage fails closed and recovers without JSON/memory fallback.
9. Have trial users log out; confirm audit append-only behavior and ensure no session/token values appear in logs.
10. Record issues, environment/build identifiers, test accounts by non-sensitive aliases, and evidence labels. Do not include raw tokens, codes, email addresses, or credentials in the report.

## Stop Conditions

Stop the trial and disable OIDC through the approved staging secret manager if any of the following occurs: wrong redirect origin, invalid state/nonce accepted, replay accepted, session not persisted, privilege granted without approval, cross-user access allowed, audit mutation succeeds, health reports a wrong target, or database failure silently falls back to another provider.

Do not clear or reset the staging database, delete historical audit events, or use production accounts/data as a recovery shortcut.
