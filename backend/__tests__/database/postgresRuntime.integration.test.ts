import crypto from 'crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPostgresPoolConfig } from '../../database/migration/postgresClientConfig';
import { createPostgresRepositories } from '../../database/adapters/postgresDatabase';
import {
  closeRuntimeDatabase,
  getRuntimeSelection,
  initializeRuntimeDatabase,
  type RuntimeDatabaseSelection
} from '../../database/runtime';
import { isAuthorizedLocalPostgresTestUrl } from '../../database/runtimeRoleGuard';

const testDatabaseUrl = process.env.NUTRIBODYSIM_POSTGRES_TEST_URL;
const enabled = Boolean(testDatabaseUrl);
const environmentKeys = [
  'NODE_ENV',
  'DATABASE_PROVIDER',
  'DATABASE_URL',
  'DATABASE_RUNTIME_ROLE',
  'NUTRIBODYSIM_POSTGRES_TEST_MODE'
] as const;
const previousEnvironment = Object.fromEntries(environmentKeys.map(key => [key, process.env[key]]));

let runtime: RuntimeDatabaseSelection | undefined;
let persistedSessionToken: string | undefined;

describe.skipIf(!enabled)('PostgreSQL runtime persistence integration', () => {
  beforeAll(async () => {
    if (!testDatabaseUrl || !isAuthorizedLocalPostgresTestUrl(testDatabaseUrl)) {
      throw new Error('NUTRIBODYSIM_POSTGRES_TEST_URL must target loopback database nutribodysim_test.');
    }

    await closeRuntimeDatabase();
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_PROVIDER = 'postgres';
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.DATABASE_RUNTIME_ROLE = 'nutribodysim_app';
    process.env.NUTRIBODYSIM_POSTGRES_TEST_MODE = 'true';

    runtime = await initializeRuntimeDatabase();
  });

  afterAll(async () => {
    await closeRuntimeDatabase();
    for (const key of environmentKeys) {
      const value = previousEnvironment[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await initializeRuntimeDatabase();
  });

  it('persists OIDC transactions and sessions across independent pools and runtime reinitialization', async () => {
    expect(runtime?.provider).toBe('postgres');
    expect(runtime?.health.ok).toBe(true);

    const repositories = runtime!.repositories;
    const userId = `usr_pgtest_${crypto.randomBytes(12).toString('hex')}`;
    const now = new Date().toISOString();
    await repositories.users.create({
      id: userId,
      email: `${userId}@example.invalid`,
      name: 'Local PostgreSQL Runtime Test',
      role: 'RegisteredUser',
      permissions: [],
      created_at: now,
      updated_at: now,
      last_login_at: now,
      account_status: 'ACTIVE',
      token_version: 1
    });
    const auditEvent = await repositories.auditLogs.appendLog({
      user_id: userId,
      user_name: 'Local PostgreSQL Runtime Test',
      action: 'LOGIN',
      entity_type: 'USER',
      entity_id: userId,
      details: 'PostgreSQL runtime audit append integration test'
    });

    const session = await repositories.sessions.createSession(userId, 300, 1);
    persistedSessionToken = session.token;
    const transaction = await repositories.oidcTransactions.createTransaction({
      redirectUri: 'http://localhost/api/auth/google/callback',
      ttlSeconds: 300
    });

    const secondPool = new pg.Pool(createPostgresPoolConfig(testDatabaseUrl!));
    try {
      const secondInstance = createPostgresRepositories(secondPool);
      const persistedSession = await secondInstance.sessions.validateSession(session.token);
      const persistedTransaction = await secondInstance.oidcTransactions.getTransactionByState(
        transaction.transaction.state
      );
      const persistedAudit = await secondInstance.auditLogs.queryLogs({ userId });
      expect(persistedSession.valid).toBe(true);
      expect(persistedSession.userId).toBe(userId);
      expect(persistedTransaction?.id).toBe(transaction.transaction.id);
      expect(persistedAudit.some(event => event.id === auditEvent.id)).toBe(true);

      const consumed = await secondInstance.oidcTransactions.consumeTransaction({
        transactionId: transaction.transaction.id,
        state: transaction.transaction.state
      });
      expect(consumed.success).toBe(true);
      const replay = await repositories.oidcTransactions.consumeTransaction({
        transactionId: transaction.transaction.id,
        state: transaction.transaction.state
      });
      expect(replay.success).toBe(false);
    } finally {
      await secondPool.end();
    }

    await closeRuntimeDatabase();
    runtime = await initializeRuntimeDatabase();
    expect(runtime.provider).toBe('postgres');
    expect((await runtime.repositories.sessions.validateSession(session.token)).valid).toBe(true);
  });

  it('fails closed on unavailable PostgreSQL and recovers without switching providers', async () => {
    expect(persistedSessionToken).toBeDefined();
    await closeRuntimeDatabase();
    runtime = undefined;

    const unavailableUrl = new URL(testDatabaseUrl!);
    unavailableUrl.port = '1';
    process.env.DATABASE_URL = unavailableUrl.toString();

    await expect(initializeRuntimeDatabase()).rejects.toThrow(
      'PostgreSQL staging runtime could not initialize; verify the approved target and connectivity.'
    );
    expect(getRuntimeSelection()).toBeNull();

    process.env.DATABASE_URL = testDatabaseUrl;
    runtime = await initializeRuntimeDatabase();
    expect(runtime.provider).toBe('postgres');
    expect((await runtime.repositories.sessions.validateSession(persistedSessionToken!)).valid).toBe(true);
  });
});
