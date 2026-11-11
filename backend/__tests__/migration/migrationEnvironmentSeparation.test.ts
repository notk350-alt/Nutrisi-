import { afterEach, describe, expect, it, vi } from 'vitest';
import { JsonToPostgresMigrator } from '../../database/migration/jsonToPostgresMigrator';

const previousRuntimeUrl = process.env.DATABASE_URL;
const previousMigrationUrl = process.env.MIGRATION_DATABASE_URL;
const previousMigrationRole = process.env.DATABASE_MIGRATION_ROLE;
const previousRuntimeRole = process.env.DATABASE_RUNTIME_ROLE;

afterEach(() => {
  if (previousRuntimeUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousRuntimeUrl;
  if (previousMigrationUrl === undefined) delete process.env.MIGRATION_DATABASE_URL;
  else process.env.MIGRATION_DATABASE_URL = previousMigrationUrl;
  if (previousMigrationRole === undefined) delete process.env.DATABASE_MIGRATION_ROLE;
  else process.env.DATABASE_MIGRATION_ROLE = previousMigrationRole;
  if (previousRuntimeRole === undefined) delete process.env.DATABASE_RUNTIME_ROLE;
  else process.env.DATABASE_RUNTIME_ROLE = previousRuntimeRole;
  vi.resetModules();
});

describe('migration credential separation', () => {
  it('does not use the runtime connection for migration operations', () => {
    process.env.DATABASE_URL = 'runtime-url-placeholder';
    delete process.env.MIGRATION_DATABASE_URL;

    const migrator = new JsonToPostgresMigrator({ dryRun: true });
    expect((migrator as unknown as { databaseUrl?: string }).databaseUrl).toBeUndefined();
  });

  it('uses the migration-only connection when explicitly configured', () => {
    process.env.DATABASE_URL = 'runtime-url-placeholder';
    process.env.MIGRATION_DATABASE_URL = 'migration-url-placeholder';
    process.env.DATABASE_MIGRATION_ROLE = 'nutribodysim_migrator';
    process.env.DATABASE_MIGRATION_ROLE = 'nutribodysim_migrator';

    const migrator = new JsonToPostgresMigrator({ dryRun: true });
    expect((migrator as unknown as { databaseUrl?: string }).databaseUrl).toBe('migration-url-placeholder');
  });

  it('requires MIGRATION_DATABASE_URL when loading Drizzle tooling config', async () => {
    process.env.DATABASE_URL = 'runtime-url-placeholder';
    delete process.env.MIGRATION_DATABASE_URL;
    vi.resetModules();

    await expect(import('../../../drizzle.config')).rejects.toThrow(
      'MIGRATION_DATABASE_URL is required for Drizzle tooling.'
    );

    process.env.MIGRATION_DATABASE_URL = 'postgresql://nutribodysim_migrator@localhost/nutribodysim_test';
    process.env.DATABASE_MIGRATION_ROLE = 'nutribodysim_migrator';
    process.env.DATABASE_RUNTIME_ROLE = 'nutribodysim_app';
    vi.resetModules();
    const { default: config } = await import('../../../drizzle.config');
    expect((config as { dbCredentials: { url: string } }).dbCredentials.url)
      .toBe('postgresql://nutribodysim_migrator@localhost/nutribodysim_test');
  });
});