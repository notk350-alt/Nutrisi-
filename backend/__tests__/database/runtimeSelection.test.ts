import { describe, it, expect } from 'vitest';
import {
  closeRuntimeDatabase,
  getRuntimeDb,
  initializeRuntimeDatabase,
  resolveDatabaseProvider
} from '../../database/runtime';

describe('database runtime selection', () => {
  it('defaults to json when no provider is configured', () => {
    expect(resolveDatabaseProvider('')).toBe('json');
    expect(resolveDatabaseProvider('json')).toBe('json');
  });

  it('accepts explicit postgres provider selection', () => {
    expect(resolveDatabaseProvider('postgres')).toBe('postgres');
  });

  it('never exposes the JSON store when postgres is explicitly selected', async () => {
    const previous = process.env.DATABASE_PROVIDER;
    await closeRuntimeDatabase();
    process.env.DATABASE_PROVIDER = 'postgres';

    try {
      expect(() => getRuntimeDb()).toThrow(/DatabaseStore is not available/);
    } finally {
      if (previous === undefined) delete process.env.DATABASE_PROVIDER;
      else process.env.DATABASE_PROVIDER = previous;
    }
  });

  it('fails early when postgres is selected without DATABASE_URL', async () => {
    const previous = process.env.DATABASE_PROVIDER;
    const previousUrl = process.env.DATABASE_URL;
    await closeRuntimeDatabase();
    process.env.DATABASE_PROVIDER = 'postgres';
    delete process.env.DATABASE_URL;

    try {
      await expect(initializeRuntimeDatabase()).rejects.toThrow(/DATABASE_PROVIDER=postgres requires a non-empty DATABASE_URL/);
    } finally {
      if (previous === undefined) delete process.env.DATABASE_PROVIDER;
      else process.env.DATABASE_PROVIDER = previous;

      if (previousUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousUrl;
    }
  });

  it('fails closed before opening a pool when the expected runtime role is missing', async () => {
    const previous = {
      provider: process.env.DATABASE_PROVIDER,
      url: process.env.DATABASE_URL,
      role: process.env.DATABASE_RUNTIME_ROLE
    };
    await closeRuntimeDatabase();
    process.env.DATABASE_PROVIDER = 'postgres';
    process.env.DATABASE_URL = 'postgresql://localhost/nutribodysim_test';
    delete process.env.DATABASE_RUNTIME_ROLE;

    try {
      await expect(initializeRuntimeDatabase()).rejects.toThrow(
        'DATABASE_PROVIDER=postgres requires DATABASE_RUNTIME_ROLE to be explicitly configured.'
      );
    } finally {
      if (previous.provider === undefined) delete process.env.DATABASE_PROVIDER;
      else process.env.DATABASE_PROVIDER = previous.provider;
      if (previous.url === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previous.url;
      if (previous.role === undefined) delete process.env.DATABASE_RUNTIME_ROLE;
      else process.env.DATABASE_RUNTIME_ROLE = previous.role;
    }
  });
});
