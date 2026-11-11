import { afterEach, describe, expect, it } from 'vitest';
import { createAuthMiddleware } from '../auth/authMiddleware';
import { executeBootstrapMainAdmin } from '../auth/bootstrapMainAdmin';
import { GoogleIdentityProvisioningService } from '../auth/oidc/provisioner';
import { defaultOIDCTransactionStore } from '../auth/oidc/transactionStore';
import { getRuntimeOIDCTransactionStore } from '../auth/oidc/runtimeTransactionStore';
import { RoleApprovalEngine } from '../auth/roleApprovalEngine';
import type { User } from '../database/types';

const originalProvider = process.env.DATABASE_PROVIDER;

afterEach(() => {
  if (originalProvider === undefined) delete process.env.DATABASE_PROVIDER;
  else process.env.DATABASE_PROVIDER = originalProvider;
});

describe('runtime OIDC transaction store selection', () => {
  it('uses the in-memory transaction store for an uninitialized JSON runtime', () => {
    process.env.DATABASE_PROVIDER = 'json';
    expect(getRuntimeOIDCTransactionStore()).toBe(defaultOIDCTransactionStore);
  });

  it('fails closed instead of falling back to memory for an uninitialized PostgreSQL runtime', () => {
    process.env.DATABASE_PROVIDER = 'postgres';
    expect(() => getRuntimeOIDCTransactionStore()).toThrow(
      'PostgreSQL runtime must be initialized before resolving OIDC transaction storage.'
    );
  });

  it('rejects legacy JSON injection in PostgreSQL authentication and governance services', async () => {
    process.env.DATABASE_PROVIDER = 'postgres';
    expect(() => createAuthMiddleware()).toThrow(/PostgreSQL runtime must be initialized/);

    const reviewer: User = {
      id: 'reviewer',
      email: 'reviewer@example.invalid',
      name: 'Reviewer',
      role: 'Admin',
      permissions: ['ADMIN'],
      created_at: new Date().toISOString(),
      last_login_at: new Date().toISOString()
    };
    await expect(new RoleApprovalEngine().approve({ requestId: 'request', reviewer }))
      .rejects.toThrow(/PostgreSQL runtime must be initialized/);
    await expect(executeBootstrapMainAdmin({ targetUserId: 'target', operator: 'test operator' }))
      .rejects.toThrow(/PostgreSQL runtime must be initialized/);
    await expect(new GoogleIdentityProvisioningService().provisionVerifiedGoogleIdentity({
      provider: 'google',
      sub: 'test-subject',
      issuer: 'https://accounts.google.com',
      audience: 'test-client',
      issuedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      email: 'test@example.invalid',
      emailVerified: true
    })).rejects.toThrow(/PostgreSQL runtime must be initialized/);
  });
});
