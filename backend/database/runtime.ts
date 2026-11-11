import type { TLSSocket } from 'tls';
import pg from 'pg';
import type { IDatabaseRepositories } from './contracts';
import type { DatabaseStore } from './store';
import { createPostgresPoolConfig } from './migration/postgresClientConfig';
import { createPostgresRepositories } from './adapters/postgresDatabase';
import {
  isAuthorizedLocalPostgresTestUrl,
  validateRuntimeRoleProbe,
  type RuntimeRoleProbe
} from './runtimeRoleGuard';

export type DatabaseProvider = 'json' | 'postgres';

export interface RuntimeHealthCheck {
  ok: boolean;
  provider: DatabaseProvider;
  databaseName?: string;
  schemaName?: string;
  branchId?: string;
  tlsVerified?: boolean;
  reason?: string;
}

export interface RuntimeDatabaseSelection {
  provider: DatabaseProvider;
  repositories: IDatabaseRepositories;
  pool?: pg.Pool;
  health: RuntimeHealthCheck;
  healthCheck(): Promise<RuntimeHealthCheck>;
  close(): Promise<void>;
  jsonStore?: DatabaseStore;
}

let runtimeSelection: RuntimeDatabaseSelection | null = null;
let runtimeInitialization: Promise<RuntimeDatabaseSelection> | null = null;
let testJsonStore: DatabaseStore | null = null;

export function resolveDatabaseProvider(rawValue?: string): DatabaseProvider {
  const configured = rawValue ?? process.env.DATABASE_PROVIDER;
  if (configured === undefined || configured.trim() === '') {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('DATABASE_PROVIDER must be explicitly configured in production.');
    }
    return 'json';
  }

  const provider = configured.trim().toLowerCase();
  if (provider === 'json' || provider === 'postgres') return provider;

  throw new Error(
    `Unsupported DATABASE_PROVIDER value "${provider}". Allowed values: "json" or "postgres".`
  );
}

export function getRuntimeSelection(): RuntimeDatabaseSelection | null {
  return runtimeSelection;
}

export function getRuntimeRepositories(): IDatabaseRepositories {
  if (!runtimeSelection) {
    throw new Error('Database runtime has not been initialized.');
  }
  return runtimeSelection.repositories;
}

export function getRuntimeDb(): DatabaseStore {
  if (runtimeSelection) {
    if (runtimeSelection.provider === 'json' && runtimeSelection.jsonStore) return runtimeSelection.jsonStore;
    throw new Error('DatabaseStore is not available when the PostgreSQL provider is selected.');
  }
  if (resolveDatabaseProvider() !== 'json') {
    throw new Error('DatabaseStore is not available when the PostgreSQL provider is selected.');
  }
  if ((process.env.VITEST_POOL_ID || process.env.VITEST_WORKER_ID) && testJsonStore) {
    return testJsonStore;
  }
  throw new Error('Initialize the JSON runtime before resolving its legacy DatabaseStore.');
}

export function registerTestJsonStore(store: DatabaseStore): void {
  if (!process.env.VITEST_POOL_ID && !process.env.VITEST_WORKER_ID) {
    throw new Error('registerTestJsonStore may only be used by Vitest setup.');
  }
  testJsonStore = store;
}

function isAuthorizedTls(client: pg.PoolClient): boolean {
  const stream = (client as pg.PoolClient & { connection?: { stream?: TLSSocket } }).connection?.stream;
  return Boolean(stream?.encrypted && stream.authorized);
}

async function initializeJsonRuntime(): Promise<RuntimeDatabaseSelection> {
  const [{ db }, { createLowdbJsonDatabase }] = await Promise.all([
    import('./store'),
    import('./adapters/lowdbJsonDatabase')
  ]);
  const repositories = createLowdbJsonDatabase(db);
  const health: RuntimeHealthCheck = { ok: true, provider: 'json' };
  const selection: RuntimeDatabaseSelection = {
    provider: 'json',
    repositories,
    jsonStore: db,
    health,
    healthCheck: async () => health,
    close: async () => undefined
  };
  runtimeSelection = selection;
  return selection;
}

async function initializePostgresRuntime(): Promise<RuntimeDatabaseSelection> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('PostgreSQL runtime activation is restricted to the approved staging environment.');
  }
  const localPostgresTestMode = process.env.NODE_ENV === 'test' &&
    process.env.NUTRIBODYSIM_POSTGRES_TEST_MODE === 'true';

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl?.trim()) {
    throw new Error('DATABASE_PROVIDER=postgres requires a non-empty DATABASE_URL value.');
  }
  if (localPostgresTestMode && !isAuthorizedLocalPostgresTestUrl(databaseUrl)) {
    throw new Error('PostgreSQL integration test mode requires a loopback nutribodysim_test database.');
  }
  const expectedRuntimeRole = process.env.DATABASE_RUNTIME_ROLE?.trim();
  if (!expectedRuntimeRole) {
    throw new Error('DATABASE_PROVIDER=postgres requires DATABASE_RUNTIME_ROLE to be explicitly configured.');
  }

  const pool = new pg.Pool(createPostgresPoolConfig(databaseUrl));
  try {
    const client = await pool.connect();
    let identity: RuntimeHealthCheck;
    let roleProbe: RuntimeRoleProbe;
    try {
      const result = await client.query(
        'SELECT current_database() AS database_name, current_schema() AS schema_name, current_setting(\'neon.branch_id\', true) AS branch_id'
      );
      const row = result.rows[0] ?? {};
      const tlsVerified = isAuthorizedTls(client);
      identity = {
        ok: true,
        provider: 'postgres',
        databaseName: typeof row.database_name === 'string' ? row.database_name : undefined,
        schemaName: typeof row.schema_name === 'string' ? row.schema_name : undefined,
        branchId: typeof row.branch_id === 'string' ? row.branch_id : undefined,
        tlsVerified
      };
      roleProbe = await inspectRuntimeRole(client);
    } finally {
      client.release();
    }

    const targetMatches = localPostgresTestMode
      ? identity.databaseName === 'nutribodysim_test' && identity.schemaName === 'public' && identity.tlsVerified === false
      : identity.databaseName === 'neondb' &&
        identity.schemaName === 'public' &&
        identity.branchId === 'br-billowing-band-b53087vi' &&
        identity.tlsVerified === true;
    if (!targetMatches) {
      throw new Error('PostgreSQL target identity or TLS verification does not match the approved staging target.');
    }
    if (validateRuntimeRoleProbe(roleProbe, expectedRuntimeRole).length > 0) {
      throw new Error('PostgreSQL runtime role does not meet the approved least-privilege requirements.');
    }

    const repositories = createPostgresRepositories(pool);
    const healthCheck = async (): Promise<RuntimeHealthCheck> => {
      let healthClient: pg.PoolClient | undefined;
      try {
        healthClient = await pool.connect();
        const result = await healthClient.query(
          'SELECT current_database() AS database_name, current_schema() AS schema_name, current_setting(\'neon.branch_id\', true) AS branch_id'
        );
        const row = result.rows[0] ?? {};
        const tlsVerified = isAuthorizedTls(healthClient);
        const roleProbe = await inspectRuntimeRole(healthClient);
        const roleCompliant = validateRuntimeRoleProbe(roleProbe, expectedRuntimeRole).length === 0;
        const healthTargetMatches = localPostgresTestMode
          ? row.database_name === 'nutribodysim_test' && row.schema_name === 'public' && !tlsVerified
          : row.database_name === 'neondb' &&
            row.schema_name === 'public' &&
            row.branch_id === 'br-billowing-band-b53087vi' &&
            tlsVerified;
        const health: RuntimeHealthCheck = {
          ok: healthTargetMatches && roleCompliant,
          provider: 'postgres',
          databaseName: typeof row.database_name === 'string' ? row.database_name : undefined,
          schemaName: typeof row.schema_name === 'string' ? row.schema_name : undefined,
          branchId: typeof row.branch_id === 'string' ? row.branch_id : undefined,
          tlsVerified
        };
        if (!health.ok) health.reason = roleCompliant
          ? 'PostgreSQL health identity check failed.'
          : 'PostgreSQL runtime role or audit protection check failed.';
        return health;
      } catch {
        return {
          ok: false,
          provider: 'postgres',
          reason: 'PostgreSQL health query failed.'
        };
      } finally {
        healthClient?.release();
      }
    };

    const selection: RuntimeDatabaseSelection = {
      provider: 'postgres',
      repositories,
      pool,
      health: identity,
      healthCheck,
      close: async () => pool.end()
    };
    runtimeSelection = selection;
    return selection;
  } catch (error) {
    try {
      await pool.end();
    } catch {
      console.error('[NutriBodySim] PostgreSQL pool cleanup failed after initialization error.');
    }
    if (error instanceof Error && (
      error.message.startsWith('PostgreSQL target identity') ||
      error.message.startsWith('PostgreSQL runtime role')
    )) {
      throw error;
    }
    throw new Error('PostgreSQL staging runtime could not initialize; verify the approved target and connectivity.');
  }
}

async function inspectRuntimeRole(client: pg.PoolClient): Promise<RuntimeRoleProbe> {
  const roleResult = await client.query(
    `SELECT r.rolname AS role_name,
            r.rolsuper AS is_superuser,
            r.rolcreaterole AS can_create_role,
            r.rolcreatedb AS can_create_database,
            r.rolreplication AS can_replicate,
            r.rolbypassrls AS can_bypass_rls,
            has_schema_privilege(current_user, 'public', 'CREATE') AS can_create_in_public,
            CASE WHEN to_regrole('nutribodysim_owner') IS NULL THEN false
                 ELSE pg_has_role(current_user, 'nutribodysim_owner', 'MEMBER') END AS is_member_of_owner,
            EXISTS (
              SELECT 1 FROM pg_class c
              JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public'
                AND c.relkind IN ('r', 'p', 'v', 'm', 'S')
                AND (c.relowner = current_user::regrole OR pg_has_role(current_user, c.relowner, 'MEMBER'))
            ) OR EXISTS (
              SELECT 1 FROM pg_proc p
              JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public'
                AND (p.proowner = current_user::regrole OR pg_has_role(current_user, p.proowner, 'MEMBER'))
            ) AS can_manage_public_objects,
            EXISTS (
              SELECT 1 FROM pg_class c
              JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public' AND c.relname = 'audit_logs'
                AND (c.relowner = current_user::regrole OR pg_has_role(current_user, c.relowner, 'MEMBER'))
            ) AS can_manage_audit_table,
            has_table_privilege(current_user, 'public.audit_logs', 'SELECT') AS can_read_audit,
            has_table_privilege(current_user, 'public.audit_logs', 'INSERT') AS can_insert_audit,
            (has_table_privilege(current_user, 'public.audit_logs', 'UPDATE') OR
             has_any_column_privilege(current_user, 'public.audit_logs', 'UPDATE')) AS can_update_audit,
            has_table_privilege(current_user, 'public.audit_logs', 'DELETE') AS can_delete_audit,
            has_table_privilege(current_user, 'public.audit_logs', 'TRUNCATE') AS can_truncate_audit
       FROM pg_roles r
      WHERE r.rolname = current_user`
  );
  const row = roleResult.rows[0];
  if (!row) throw new Error('PostgreSQL runtime role probe returned no role.');

  const triggerResult = await client.query(
    `SELECT t.tgname AS name,
            t.tgenabled IN ('O', 'A') AS enabled,
            p.prosecdef AS security_definer,
            (p.proowner = current_user::regrole OR pg_has_role(current_user, p.proowner, 'MEMBER')) AS owned_by_runtime,
            COALESCE(p.proconfig, ARRAY[]::text[]) AS function_config
       FROM pg_trigger t
       JOIN pg_proc p ON p.oid = t.tgfoid
       JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = 'audit_logs'
        AND t.tgname IN ('audit_logs_reject_mutation', 'audit_logs_reject_truncate')
        AND NOT t.tgisinternal`
  );

  return {
    roleName: String(row.role_name),
    isSuperuser: row.is_superuser === true,
    canCreateRole: row.can_create_role === true,
    canCreateDatabase: row.can_create_database === true,
    canReplicate: row.can_replicate === true,
    canBypassRls: row.can_bypass_rls === true,
    canCreateInPublic: row.can_create_in_public === true,
    isMemberOfOwner: row.is_member_of_owner === true,
    canManagePublicObjects: row.can_manage_public_objects === true,
    canManageAuditTable: row.can_manage_audit_table === true,
    canReadAudit: row.can_read_audit === true,
    canInsertAudit: row.can_insert_audit === true,
    canUpdateAudit: row.can_update_audit === true,
    canDeleteAudit: row.can_delete_audit === true,
    canTruncateAudit: row.can_truncate_audit === true,
    auditTriggers: triggerResult.rows.map(trigger => ({
      name: String(trigger.name),
      enabled: trigger.enabled === true,
      securityDefiner: trigger.security_definer === true,
      ownedByRuntime: trigger.owned_by_runtime === true,
      functionConfig: Array.isArray(trigger.function_config) ? trigger.function_config.map(String) : []
    }))
  };
}

export async function initializeRuntimeDatabase(): Promise<RuntimeDatabaseSelection> {
  if (runtimeSelection) return runtimeSelection;
  if (runtimeInitialization) return runtimeInitialization;

  runtimeInitialization = resolveDatabaseProvider() === 'postgres'
    ? initializePostgresRuntime()
    : initializeJsonRuntime();
  try {
    return await runtimeInitialization;
  } catch (error) {
    runtimeInitialization = null;
    throw error;
  }
}

export async function closeRuntimeDatabase(): Promise<void> {
  const selection = runtimeSelection;
  runtimeSelection = null;
  runtimeInitialization = null;
  if (selection) await selection.close();
}
