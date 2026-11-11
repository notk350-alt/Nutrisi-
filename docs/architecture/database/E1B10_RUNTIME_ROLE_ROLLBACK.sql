-- PREPARED ONLY. Do not execute without an approved incident/rollback decision.
-- This rollback disables application access; it does not delete data, audit events,
-- tables, functions, roles, or schema objects. Keep application writes stopped.

BEGIN;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM nutribodysim_runtime;
REVOKE USAGE ON SCHEMA public FROM nutribodysim_runtime;
REVOKE nutribodysim_runtime FROM nutribodysim_app;
REVOKE nutribodysim_owner FROM nutribodysim_migrator;
DO $$
BEGIN
  EXECUTE format('REVOKE CONNECT ON DATABASE %I FROM nutribodysim_runtime', current_database());
END;
$$;

COMMIT;

-- Do not restore the former owner credential to the application as an automatic
-- fallback. Keep the service stopped until an explicitly approved runtime role and
-- connection mapping have been restored and verified.