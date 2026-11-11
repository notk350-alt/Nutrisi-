import type { IOIDCTransactionRepository } from '../../database/contracts';
import { getRuntimeSelection, resolveDatabaseProvider } from '../../database/runtime';
import { defaultOIDCTransactionStore } from './transactionStore';
import type { IOIDCTransactionStore, IAsyncOIDCTransactionStore } from './types';

export type RuntimeOIDCTransactionStore = IOIDCTransactionStore | IAsyncOIDCTransactionStore | IOIDCTransactionRepository;

export function getRuntimeOIDCTransactionStore(): RuntimeOIDCTransactionStore {
  const provider = resolveDatabaseProvider();
  const runtime = getRuntimeSelection();

  if (provider === 'postgres') {
    if (runtime?.provider === 'postgres') return runtime.repositories.oidcTransactions;
    throw new Error('PostgreSQL runtime must be initialized before resolving OIDC transaction storage.');
  }

  if (runtime?.provider === 'postgres') {
    throw new Error('DATABASE_PROVIDER does not match the initialized PostgreSQL runtime.');
  }

  return defaultOIDCTransactionStore;
}
