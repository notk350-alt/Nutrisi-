import type { PoolConfig } from 'pg';

export function createPostgresPoolConfig(databaseUrl: string): PoolConfig {
  const connectionUrl = new URL(databaseUrl);
  const { hostname } = connectionUrl;
  const isLoopback = ['localhost', '127.0.0.1', '::1'].includes(hostname);

  connectionUrl.searchParams.delete('ssl');
  if (isLoopback) {
    connectionUrl.searchParams.delete('sslmode');
    connectionUrl.searchParams.delete('sslcert');
    connectionUrl.searchParams.delete('sslkey');
    connectionUrl.searchParams.delete('sslrootcert');
  } else {
    connectionUrl.searchParams.set('sslmode', 'verify-full');
  }

  return {
    connectionString: connectionUrl.toString(),
    max: 1,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000,
    ssl: isLoopback ? false : { rejectUnauthorized: true }
  };
}
