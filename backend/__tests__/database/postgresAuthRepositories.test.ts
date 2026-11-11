import { describe, expect, it } from 'vitest';
import {
  PostgresDatabaseRepositories,
  PostgresOIDCTransactionRepository,
  PostgresSessionRepository
} from '../../database/adapters/postgresDatabase';

describe('PostgreSQL runtime authentication repositories', () => {
  it('wires both authentication stores to PostgreSQL repository implementations', () => {
    const repositories = new PostgresDatabaseRepositories({} as never);

    expect(repositories.sessions).toBeInstanceOf(PostgresSessionRepository);
    expect(repositories.oidcTransactions).toBeInstanceOf(PostgresOIDCTransactionRepository);
    expect('getState' in repositories).toBe(false);
  });

  it('returns promises for durable session and OIDC operations', () => {
    const repositories = new PostgresDatabaseRepositories({} as never);

    expect(repositories.sessions.createSession.constructor.name).toBe('AsyncFunction');
    expect(repositories.sessions.validateSession.constructor.name).toBe('AsyncFunction');
    expect(repositories.oidcTransactions.createTransaction.constructor.name).toBe('AsyncFunction');
    expect(repositories.oidcTransactions.consumeTransaction.constructor.name).toBe('AsyncFunction');
  });
});
