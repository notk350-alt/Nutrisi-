import { defineConfig } from 'drizzle-kit';

const databaseUrl = process.env.MIGRATION_DATABASE_URL?.trim();
const migrationRole = process.env.DATABASE_MIGRATION_ROLE?.trim();
const runtimeRole = process.env.DATABASE_RUNTIME_ROLE?.trim();
if (!databaseUrl) {
  throw new Error('MIGRATION_DATABASE_URL is required for Drizzle tooling.');
}
if (!migrationRole) {
  throw new Error('DATABASE_MIGRATION_ROLE is required for Drizzle tooling.');
}
if (!runtimeRole || runtimeRole === migrationRole) {
  throw new Error('DATABASE_MIGRATION_ROLE must be distinct from DATABASE_RUNTIME_ROLE.');
}
let migrationUrlRole = '';
try {
  migrationUrlRole = decodeURIComponent(new URL(databaseUrl).username);
} catch {
  throw new Error('MIGRATION_DATABASE_URL must be a valid PostgreSQL URL.');
}
if (!migrationUrlRole || migrationUrlRole !== migrationRole) {
  throw new Error('MIGRATION_DATABASE_URL username does not match DATABASE_MIGRATION_ROLE.');
}

export default defineConfig({
  schema: './backend/database/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: databaseUrl,
  },
});
