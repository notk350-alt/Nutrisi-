import crypto from 'crypto';
import express from 'express';
import http from 'http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRouter } from '../routes/api';
import { defaultGoogleJWKSClient } from '../auth/oidc/jwks';
import { defaultOIDCTransactionStore } from '../auth/oidc/transactionStore';
import { getOIDCConfig, validateOIDCConfig } from '../auth/oidc/config';

const environmentKeys = [
  'NODE_ENV',
  'OIDC_ENABLED',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_REDIRECT_URI'
] as const;
const originalEnvironment = Object.fromEntries(environmentKeys.map(key => [key, process.env[key]]));

async function request(path: string): Promise<{ status: number; body: string }> {
  const app = express();
  app.use('/api', apiRouter);
  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };

  try {
    return await new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port: address.port, path, method: 'GET' }, res => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', chunk => body += chunk);
        res.on('end', () => resolve({ status: res.statusCode || 500, body }));
      });
      req.on('error', reject);
      req.end();
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

function configureOIDC(): void {
  process.env.NODE_ENV = 'test';
  process.env.OIDC_ENABLED = 'true';
  process.env.GOOGLE_CLIENT_ID = 'nutribodysim-test-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'local-client-secret-123456789';
  process.env.GOOGLE_REDIRECT_URI = 'http://localhost/api/auth/google/callback';
}

function signIdToken(
  payload: Record<string, unknown>,
  privateKey: crypto.KeyObject,
  kid: string
): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signingInput = `${header}.${body}`;
  const signature = crypto.createSign('RSA-SHA256').update(signingInput).sign(privateKey, 'base64url');
  return `${signingInput}.${signature}`;
}

describe('Google OIDC API routes', () => {
  beforeEach(() => {
    process.env.OIDC_ENABLED = 'false';
    defaultOIDCTransactionStore.clear();
  });

  afterEach(() => {
    defaultOIDCTransactionStore.clear();
    vi.unstubAllGlobals();
    for (const key of environmentKeys) {
      const value = originalEnvironment[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('keeps Google login disabled unless explicitly configured', async () => {
    const response = await request('/api/auth/google/url');
    expect(response.status).toBe(404);
    expect(JSON.parse(response.body).code).toBe('OIDC_DISABLED');
  });

  it('marks malformed OIDC duration environment values invalid', () => {
    const config = getOIDCConfig({
      NODE_ENV: 'test',
      OIDC_ENABLED: 'true',
      GOOGLE_CLIENT_ID: 'nutribodysim-test-client-id',
      GOOGLE_CLIENT_SECRET: 'local-client-secret-123456789',
      GOOGLE_REDIRECT_URI: 'http://localhost/api/auth/google/callback',
      OIDC_TRANSACTION_TTL_SECONDS: '600seconds',
      OIDC_CLOCK_SKEW_SECONDS: '60seconds'
    });
    const validation = validateOIDCConfig(config, false);
    expect(validation.valid).toBe(false);
    expect(validation.errors).toContain('transactionTtlSeconds must be a number');
    expect(validation.errors).toContain('clockSkewToleranceSeconds must be a number');
  });

  it('requires secure OIDC cookies in production regardless of SameSite mode', () => {
    const config = getOIDCConfig({
      NODE_ENV: 'production',
      OIDC_ENABLED: 'true',
      GOOGLE_CLIENT_ID: 'nutribodysim-test-client-id',
      GOOGLE_CLIENT_SECRET: 'local-client-secret-123456789',
      GOOGLE_REDIRECT_URI: 'https://app.example.invalid/api/auth/google/callback',
      OIDC_COOKIE_SAMESITE: 'lax',
      OIDC_COOKIE_SECURE: 'false'
    });
    const validation = validateOIDCConfig(config, true);
    expect(validation.valid).toBe(false);
    expect(validation.errors).toContain('cookieSecure must be true in production');
  });

  it('returns a Google authorization URL without exposing server secrets', async () => {
    configureOIDC();
    const response = await request('/api/auth/google/url');
    expect(response.status).toBe(200);

    const url = new URL(JSON.parse(response.body).url);
    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.searchParams.get('client_id')).toBe(process.env.GOOGLE_CLIENT_ID);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toMatch(/^[a-f0-9]{64}$/);
    expect(url.searchParams.get('nonce')).toMatch(/^[a-f0-9]{64}$/);
    expect(response.body).not.toContain(process.env.GOOGLE_CLIENT_SECRET);
    expect(response.body).not.toContain('code_verifier');
  });

  it('rejects an unencrypted non-local callback before creating an OIDC transaction', async () => {
    configureOIDC();
    process.env.GOOGLE_REDIRECT_URI = 'http://untrusted.example/api/auth/google/callback';
    const activeTransactions = defaultOIDCTransactionStore.getActiveTransactionsCount();

    const response = await request('/api/auth/google/url');

    expect(response.status).toBe(503);
    expect(JSON.parse(response.body).code).toBe('OIDC_CONFIGURATION_INVALID');
    expect(defaultOIDCTransactionStore.getActiveTransactionsCount()).toBe(activeTransactions);
  });

  it('rejects invalid callbacks without issuing a session', async () => {
    configureOIDC();
    const response = await request('/api/auth/google/callback');
    expect(response.status).toBe(400);
    expect(response.body).toContain('GOOGLE_AUTH_ERROR');
    expect(response.body).toContain('OIDC_CALLBACK_STATE_INVALID');
    expect(response.body).not.toContain('token');
  });

  it('returns a client error for an explicit Google authorization denial', async () => {
    configureOIDC();
    const response = await request('/api/auth/google/callback?error=access_denied');
    expect(response.status).toBe(400);
    expect(response.body).toContain('GOOGLE_AUTH_ERROR');
    expect(response.body).toContain('OIDC_CALLBACK_PROVIDER_DENIED');
  });

  it('provisions an unprivileged user and issues a persisted session on a verified callback', async () => {
    configureOIDC();
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const keyId = `route-test-${crypto.randomBytes(6).toString('hex')}`;
    defaultGoogleJWKSClient.setMockKeys(new Map([[keyId, publicKey]]));

    const startResponse = await request('/api/auth/google/url');
    const authorizationUrl = new URL(JSON.parse(startResponse.body).url);
    const state = authorizationUrl.searchParams.get('state')!;
    const nonce = authorizationUrl.searchParams.get('nonce')!;
    const now = Math.floor(Date.now() / 1000);
    const idToken = signIdToken({
      iss: 'https://accounts.google.com',
      sub: '109876543210987654321',
      aud: process.env.GOOGLE_CLIENT_ID,
      exp: now + 300,
      iat: now,
      nonce,
      email: `oidc-route-${keyId}@example.invalid`,
      email_verified: true,
      name: 'OIDC Route Test'
    }, privateKey, keyId);

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id_token: idToken }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })));

    const callbackResponse = await request(`/api/auth/google/callback?code=mock-code&state=${state}`);
    expect(callbackResponse.status).toBe(200);

    const messageMatch = callbackResponse.body.match(/postMessage\((\{.*\}), "http:\/\/localhost"\)/);
    expect(messageMatch).not.toBeNull();
    const message = JSON.parse(messageMatch![1]);
    expect(message.type).toBe('GOOGLE_AUTH_SUCCESS');
    expect(message.user.role).toBe('RegisteredUser');
    expect(message.user.is_main_admin).toBe(false);
    expect(message.user.password_hash).toBeUndefined();

    const authenticatedResponse = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const app = express();
      app.use('/api', apiRouter);
      const server = http.createServer(app);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address() as { port: number };
        const req = http.request({
          hostname: '127.0.0.1',
          port: address.port,
          path: '/api/auth/me',
          method: 'GET',
          headers: { Authorization: `Bearer ${message.token}` }
        }, res => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', chunk => body += chunk);
          res.on('end', () => server.close(() => resolve({ status: res.statusCode || 500, body })));
        });
        req.on('error', error => server.close(() => reject(error)));
        req.end();
      });
    });

    expect(authenticatedResponse.status).toBe(200);
    expect(JSON.parse(authenticatedResponse.body).user.id).toBe(message.user.id);
  });
});