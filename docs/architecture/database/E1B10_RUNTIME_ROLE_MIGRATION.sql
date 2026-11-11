-- PREPARED ONLY. Do not execute against staging or production without explicit approval.
-- Run only against the approved target after a verified backup and owner-role review.
-- This transaction changes PostgreSQL catalog ownership/ACLs; it does not modify rows.
-- Login principals and passwords must be provisioned by the approved secret manager,
-- not embedded in this file or passed as command-line literals.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.audit_logs') IS NULL THEN
    RAISE EXCEPTION 'public.audit_logs is required before runtime-role migration';
  END IF;
  IF (
    SELECT count(*) FROM pg_trigger
    WHERE tgrelid = 'public.audit_logs'::regclass
      AND tgname IN ('audit_logs_reject_mutation', 'audit_logs_reject_truncate')
      AND NOT tgisinternal
  ) <> 2 THEN
    RAISE EXCEPTION 'Both expected audit triggers must exist before runtime-role migration';
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nutribodysim_owner') THEN
    CREATE ROLE nutribodysim_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nutribodysim_runtime') THEN
    CREATE ROLE nutribodysim_runtime NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nutribodysim_app') THEN
    CREATE ROLE nutribodysim_app LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nutribodysim_migrator') THEN
    CREATE ROLE nutribodysim_migrator LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END;
$$;

ALTER ROLE nutribodysim_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE nutribodysim_runtime NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE nutribodysim_app LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE nutribodysim_migrator LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO nutribodysim_runtime', current_database());
END;
$$;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM nutribodysim_runtime;
REVOKE CREATE ON SCHEMA public FROM nutribodysim_app;
REVOKE CREATE ON SCHEMA public FROM nutribodysim_migrator;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO nutribodysim_owner;
GRANT USAGE ON SCHEMA public TO nutribodysim_runtime;
GRANT USAGE ON SCHEMA public TO nutribodysim_app;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM nutribodysim_app;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM nutribodysim_migrator;
DO $$
BEGIN
  IF pg_has_role('nutribodysim_app', 'nutribodysim_owner', 'MEMBER') THEN
    EXECUTE 'REVOKE nutribodysim_owner FROM nutribodysim_app';
  END IF;
END;
$$;

-- The migration LOGIN remains a member of the NOLOGIN owner group. It is never
-- the runtime LOGIN, and it receives no ADMIN OPTION on that group.
DO $$
BEGIN
  IF NOT pg_has_role(current_user, 'nutribodysim_owner', 'MEMBER') THEN
    EXECUTE format('GRANT nutribodysim_owner TO %I', current_user);
  END IF;
END;
$$;

ALTER TABLE public.scientific_units OWNER TO nutribodysim_owner;
ALTER TABLE public.scientific_references OWNER TO nutribodysim_owner;
ALTER TABLE public.scientific_variables OWNER TO nutribodysim_owner;
ALTER TABLE public.scientific_parameters OWNER TO nutribodysim_owner;
ALTER TABLE public.scientific_parameter_references OWNER TO nutribodysim_owner;
ALTER TABLE public.scientific_formulas OWNER TO nutribodysim_owner;
ALTER TABLE public.scientific_formula_parameters OWNER TO nutribodysim_owner;
ALTER TABLE public.scientific_formula_references OWNER TO nutribodysim_owner;
ALTER TABLE public.scientific_algorithms OWNER TO nutribodysim_owner;
ALTER TABLE public.scientific_algorithm_parameters OWNER TO nutribodysim_owner;
ALTER TABLE public.scientific_algorithm_references OWNER TO nutribodysim_owner;
ALTER TABLE public.scientific_models OWNER TO nutribodysim_owner;
ALTER TABLE public.scientific_model_variables OWNER TO nutribodysim_owner;
ALTER TABLE public.scientific_model_formulas OWNER TO nutribodysim_owner;
ALTER TABLE public.scientific_model_algorithms OWNER TO nutribodysim_owner;
ALTER TABLE public.scientific_model_parameters OWNER TO nutribodysim_owner;
ALTER TABLE public.scientific_model_references OWNER TO nutribodysim_owner;
ALTER TABLE public.scientific_interpretation_rules OWNER TO nutribodysim_owner;
ALTER TABLE public.scientific_interpretation_rule_references OWNER TO nutribodysim_owner;
ALTER TABLE public.users OWNER TO nutribodysim_owner;
ALTER TABLE public.external_identities OWNER TO nutribodysim_owner;
ALTER TABLE public.role_requests OWNER TO nutribodysim_owner;
ALTER TABLE public.teams OWNER TO nutribodysim_owner;
ALTER TABLE public.team_members OWNER TO nutribodysim_owner;
ALTER TABLE public.projects OWNER TO nutribodysim_owner;
ALTER TABLE public.project_members OWNER TO nutribodysim_owner;
ALTER TABLE public.materials OWNER TO nutribodysim_owner;
ALTER TABLE public.material_projects OWNER TO nutribodysim_owner;
ALTER TABLE public.material_collections OWNER TO nutribodysim_owner;
ALTER TABLE public.collection_materials OWNER TO nutribodysim_owner;
ALTER TABLE public.reading_progress OWNER TO nutribodysim_owner;
ALTER TABLE public.bookmarks OWNER TO nutribodysim_owner;
ALTER TABLE public.highlights OWNER TO nutribodysim_owner;
ALTER TABLE public.notes OWNER TO nutribodysim_owner;
ALTER TABLE public.datasets OWNER TO nutribodysim_owner;
ALTER TABLE public.dataset_versions OWNER TO nutribodysim_owner;
ALTER TABLE public.statistics_analyses OWNER TO nutribodysim_owner;
ALTER TABLE public.charts OWNER TO nutribodysim_owner;
ALTER TABLE public.notebooks OWNER TO nutribodysim_owner;
ALTER TABLE public.notebook_cells OWNER TO nutribodysim_owner;
ALTER TABLE public.code_executions OWNER TO nutribodysim_owner;
ALTER TABLE public.experiments OWNER TO nutribodysim_owner;
ALTER TABLE public.provenance_records OWNER TO nutribodysim_owner;
ALTER TABLE public.audit_logs OWNER TO nutribodysim_owner;
ALTER TABLE public.scientific_calculations OWNER TO nutribodysim_owner;
ALTER TABLE public.runtime_sessions OWNER TO nutribodysim_owner;
ALTER TABLE public.oidc_transactions OWNER TO nutribodysim_owner;

ALTER FUNCTION public.reject_audit_log_mutation() OWNER TO nutribodysim_owner;
ALTER FUNCTION public.reject_audit_log_mutation() SECURITY INVOKER;
ALTER FUNCTION public.reject_audit_log_mutation() SET search_path = pg_catalog;
REVOKE ALL ON FUNCTION public.reject_audit_log_mutation() FROM PUBLIC;

ALTER FUNCTION public.reject_audit_log_truncate() OWNER TO nutribodysim_owner;
ALTER FUNCTION public.reject_audit_log_truncate() SECURITY INVOKER;
ALTER FUNCTION public.reject_audit_log_truncate() SET search_path = pg_catalog;
REVOKE ALL ON FUNCTION public.reject_audit_log_truncate() FROM PUBLIC;

ALTER TABLE public.audit_logs ENABLE TRIGGER audit_logs_reject_mutation;
ALTER TABLE public.audit_logs ENABLE TRIGGER audit_logs_reject_truncate;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'scientific_units', 'scientific_references', 'scientific_variables',
    'scientific_parameters', 'scientific_parameter_references', 'scientific_formulas',
    'scientific_formula_parameters', 'scientific_formula_references',
    'scientific_algorithms', 'scientific_algorithm_parameters',
    'scientific_algorithm_references', 'scientific_models', 'scientific_model_variables',
    'scientific_model_formulas', 'scientific_model_algorithms',
    'scientific_model_parameters', 'scientific_model_references',
    'scientific_interpretation_rules', 'scientific_interpretation_rule_references',
    'users', 'external_identities', 'role_requests',
    'teams', 'team_members', 'projects', 'project_members',
    'materials', 'material_projects', 'material_collections',
    'collection_materials', 'reading_progress', 'bookmarks',
    'highlights', 'notes', 'datasets', 'dataset_versions',
    'statistics_analyses', 'charts', 'notebooks', 'notebook_cells',
    'code_executions', 'experiments', 'provenance_records',
    'audit_logs', 'scientific_calculations', 'runtime_sessions',
    'oidc_transactions'
  ] LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', table_name);
  END LOOP;
END;
$$;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM nutribodysim_runtime;

-- Scientific registry is readable. Writes are limited to tables with repository insert paths.
GRANT SELECT ON TABLE
  public.scientific_units, public.scientific_references, public.scientific_variables,
  public.scientific_parameters, public.scientific_parameter_references, public.scientific_formulas,
  public.scientific_formula_parameters, public.scientific_formula_references,
  public.scientific_algorithms, public.scientific_algorithm_parameters,
  public.scientific_algorithm_references, public.scientific_models, public.scientific_model_variables,
  public.scientific_model_formulas, public.scientific_model_algorithms,
  public.scientific_model_parameters, public.scientific_model_references,
  public.scientific_interpretation_rules, public.scientific_interpretation_rule_references
TO nutribodysim_runtime;
GRANT INSERT ON TABLE
  public.scientific_variables, public.scientific_parameters, public.scientific_formulas,
  public.scientific_formula_parameters, public.scientific_formula_references,
  public.scientific_models, public.scientific_references
TO nutribodysim_runtime;

GRANT SELECT, INSERT, UPDATE ON TABLE public.users, public.role_requests TO nutribodysim_runtime;
GRANT SELECT, INSERT, DELETE ON TABLE public.external_identities TO nutribodysim_runtime;
GRANT SELECT, INSERT ON TABLE public.teams TO nutribodysim_runtime;
GRANT SELECT, INSERT, DELETE ON TABLE public.team_members, public.project_members TO nutribodysim_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.projects TO nutribodysim_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.materials TO nutribodysim_runtime;
GRANT SELECT, INSERT, DELETE ON TABLE public.material_projects, public.collection_materials TO nutribodysim_runtime;
GRANT SELECT ON TABLE public.material_collections TO nutribodysim_runtime;
GRANT SELECT, INSERT, UPDATE ON TABLE public.reading_progress TO nutribodysim_runtime;
GRANT SELECT, INSERT, DELETE ON TABLE public.bookmarks, public.highlights, public.notes TO nutribodysim_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.datasets TO nutribodysim_runtime;
GRANT SELECT, INSERT ON TABLE
  public.dataset_versions, public.statistics_analyses, public.charts, public.notebooks,
  public.code_executions, public.experiments, public.provenance_records,
  public.scientific_calculations
TO nutribodysim_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.notebook_cells TO nutribodysim_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.runtime_sessions, public.oidc_transactions TO nutribodysim_runtime;

-- Audit events are readable and appendable only. No UPDATE, DELETE, or TRUNCATE.
GRANT SELECT, INSERT ON TABLE public.audit_logs TO nutribodysim_runtime;

DO $$
BEGIN
  IF NOT pg_has_role('nutribodysim_app', 'nutribodysim_runtime', 'MEMBER') THEN
    EXECUTE 'GRANT nutribodysim_runtime TO nutribodysim_app';
  END IF;
END;
$$;
DO $$
BEGIN
  IF NOT pg_has_role('nutribodysim_migrator', 'nutribodysim_owner', 'MEMBER') THEN
    EXECUTE 'GRANT nutribodysim_owner TO nutribodysim_migrator';
  END IF;
END;
$$;

COMMIT;

-- No passwords are created here. Provision/rotate credentials for each LOGIN only
-- through the approved secret manager. Set DATABASE_RUNTIME_ROLE=nutribodysim_app
-- and DATABASE_MIGRATION_ROLE=nutribodysim_migrator. The migrator inherits owner
-- privileges but must never be supplied to a web/server/background-worker process.