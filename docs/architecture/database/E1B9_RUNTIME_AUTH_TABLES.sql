-- Additive runtime-auth storage. This does not alter the 45-table migration
-- baseline or any migrated domain records.
CREATE TABLE IF NOT EXISTS runtime_sessions (
  token_hash varchar(64) PRIMARY KEY,
  user_id varchar(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_version integer NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_runtime_sessions_user_id ON runtime_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_runtime_sessions_expiration ON runtime_sessions(expires_at);

CREATE TABLE IF NOT EXISTS oidc_transactions (
  id varchar(64) PRIMARY KEY,
  state_hash varchar(64) NOT NULL UNIQUE,
  state varchar(512) NOT NULL,
  nonce varchar(512) NOT NULL,
  code_verifier varchar(128) NOT NULL,
  code_challenge varchar(128) NOT NULL,
  code_challenge_method varchar(8) NOT NULL CHECK (code_challenge_method = 'S256'),
  purpose varchar(32) NOT NULL DEFAULT 'login',
  target_user_id varchar(64) REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed boolean NOT NULL DEFAULT false,
  consumed_at timestamptz,
  client_binding varchar(255),
  return_url varchar(2048),
  redirect_uri varchar(2048),
  CHECK (purpose IN ('login', 'link-account'))
);

CREATE INDEX IF NOT EXISTS idx_oidc_transactions_expiration ON oidc_transactions(expires_at);
CREATE INDEX IF NOT EXISTS idx_oidc_transactions_target_user ON oidc_transactions(target_user_id);

CREATE OR REPLACE FUNCTION reject_audit_log_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.user_id IS NOT NULL
      AND NEW.user_id IS NULL
      AND (to_jsonb(OLD) - 'user_id') = (to_jsonb(NEW) - 'user_id') THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'audit_logs is append-only; only user_id nullification is permitted'
      USING ERRCODE = '55000';
  END IF;

  RAISE EXCEPTION 'audit_logs is append-only; DELETE is prohibited'
    USING ERRCODE = '55000';
END;
$$;

CREATE OR REPLACE FUNCTION reject_audit_log_truncate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only; TRUNCATE is prohibited'
    USING ERRCODE = '55000';
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'audit_logs_reject_mutation'
      AND tgrelid = 'public.audit_logs'::regclass
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER audit_logs_reject_mutation
      BEFORE UPDATE OR DELETE ON public.audit_logs
      FOR EACH ROW EXECUTE FUNCTION reject_audit_log_mutation();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'audit_logs_reject_truncate'
      AND tgrelid = 'public.audit_logs'::regclass
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER audit_logs_reject_truncate
      BEFORE TRUNCATE ON public.audit_logs
      FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_log_truncate();
  END IF;
END;
$$;
