/**
 * NutriBodySim — Google OIDC JWKS Client & Key Rotation Manager (MVS-B2.5C.2)
 *
 * Implements strict, isolated Google Public Key retrieval, caching,
 * and key rotation handling per OIDC Core 1.0 and RFC 7517.
 *
 * Security guarantees:
 * - Hardcoded destination constraint: Only Google certs URL is permitted.
 * - Anti-SSRF: Token-supplied URIs ('jku', 'x5u') are strictly ignored and rejected.
 * - In-memory key caching based on HTTP Cache-Control max-age header.
 * - Anti-DoS on unknown 'kid': Strict cooldown throttling prevents flood attacks.
 * - Network timeouts (5s) via AbortSignal to avoid hanging threads.
 * - Fail-closed: Never bypasses signature checks on JWKS network failure.
 * - Zero token or secret logging.
 */

import crypto from 'crypto';
import { GoogleJWK, GoogleJWKSResponse, IJWKSClient } from './types';
import { DEFAULT_OIDC_JWKS_URI } from './config';

export const OFFICIAL_GOOGLE_JWKS_HOST = 'www.googleapis.com';
export const OFFICIAL_GOOGLE_JWKS_PATH = '/oauth2/v3/certs';
export const DEFAULT_JWKS_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
export const MIN_JWKS_CACHE_TTL_MS = 5 * 60 * 1000;         // 5 minutes
export const MAX_JWKS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;   // 24 hours
export const REFRESH_COOLDOWN_MS = 10 * 1000;               // 10 seconds rate-limit between forced refreshes
export const FETCH_TIMEOUT_MS = 5000;                       // 5 seconds network timeout

export class GoogleJWKSClient implements IJWKSClient {
  private readonly jwksUri: string;
  private readonly keyCache = new Map<string, crypto.KeyObject>();
  private cacheExpiresAt: number = 0;
  private lastFetchTime: number = 0;
  private mockKeys: Map<string, crypto.KeyObject> | null = null;
  private fetchFunction: typeof fetch;

  constructor(options?: {
    jwksUri?: string;
    customFetch?: typeof fetch;
  }) {
    const targetUri = options?.jwksUri ?? DEFAULT_OIDC_JWKS_URI;
    this.validateJwksUri(targetUri);
    this.jwksUri = targetUri;
    this.fetchFunction = options?.customFetch ?? fetch;
  }

  /**
   * Validates that the JWKS URI strictly targets the official Google certs endpoint.
   */
  private validateJwksUri(uri: string): void {
    const parsed = new URL(uri);
    if (parsed.protocol !== 'https:') {
      throw new Error(`Insecure JWKS URI rejected. Protocol must be HTTPS: ${uri}`);
    }
    if (parsed.hostname !== OFFICIAL_GOOGLE_JWKS_HOST) {
      throw new Error(`Untrusted JWKS host '${parsed.hostname}'. Only '${OFFICIAL_GOOGLE_JWKS_HOST}' is permitted.`);
    }
    if (parsed.pathname !== OFFICIAL_GOOGLE_JWKS_PATH) {
      throw new Error(`Invalid JWKS endpoint path '${parsed.pathname}'. Expected '${OFFICIAL_GOOGLE_JWKS_PATH}'.`);
    }
  }

  /**
   * Parses the HTTP Cache-Control header to determine cache lifetime.
   */
  private parseCacheControlTtl(cacheControlHeader: string | null): number {
    if (!cacheControlHeader) return DEFAULT_JWKS_CACHE_TTL_MS;

    const maxAgeMatch = cacheControlHeader.match(/max-age=(\d+)/i);
    if (maxAgeMatch && maxAgeMatch[1]) {
      const seconds = parseInt(maxAgeMatch[1], 10);
      if (!isNaN(seconds) && seconds > 0) {
        const ms = seconds * 1000;
        return Math.min(Math.max(ms, MIN_JWKS_CACHE_TTL_MS), MAX_JWKS_CACHE_TTL_MS);
      }
    }

    return DEFAULT_JWKS_CACHE_TTL_MS;
  }

  /**
   * Injects mock keys for testing without network requests.
   */
  public setMockKeys(keys: Map<string, crypto.KeyObject>): void {
    this.mockKeys = keys;
  }

  /**
   * Retrieves a public key by kid.
   * If not cached or expired, refreshes keys from JWKS endpoint.
   */
  public async getKey(kid: string): Promise<crypto.KeyObject | null> {
    if (!kid || typeof kid !== 'string') {
      return null;
    }

    // Use mock keys if injected
    if (this.mockKeys) {
      return this.mockKeys.get(kid) ?? null;
    }

    const now = Date.now();

    // 1. Check if key is already in valid cache
    if (this.keyCache.has(kid) && now < this.cacheExpiresAt) {
      return this.keyCache.get(kid)!;
    }

    // 2. Key miss or cache expired: perform rate-limited refresh
    const timeSinceLastFetch = now - this.lastFetchTime;
    if (timeSinceLastFetch >= REFRESH_COOLDOWN_MS || this.keyCache.size === 0) {
      try {
        await this.refreshKeys(true);
      } catch (err) {
        // If refresh fails but we have a stale key matching kid, we still fail-closed if key is absent
        if (!this.keyCache.has(kid)) {
          throw err;
        }
      }
    }

    return this.keyCache.get(kid) ?? null;
  }

  /**
   * Fetches the latest public keys from the official Google JWKS endpoint.
   */
  public async refreshKeys(force: boolean = false): Promise<void> {
    const now = Date.now();
    if (!force && now < this.cacheExpiresAt && this.keyCache.size > 0) {
      return;
    }

    // Rate limiting cooldown check
    if (this.lastFetchTime > 0 && now - this.lastFetchTime < REFRESH_COOLDOWN_MS) {
      return;
    }

    this.lastFetchTime = now;

    let response: Response;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      response = await this.fetchFunction(this.jwksUri, {
        method: 'GET',
        headers: {
          Accept: 'application/json'
        },
        signal: controller.signal
      });

      clearTimeout(timeoutId);
    } catch (networkError: any) {
      throw new Error(`JWKS_FETCH_FAILED: Unable to reach Google JWKS endpoint: ${networkError?.message || 'Network error'}`);
    }

    if (!response.ok) {
      throw new Error(`JWKS_HTTP_ERROR: Google JWKS returned HTTP ${response.status}`);
    }

    let jwksData: GoogleJWKSResponse;
    try {
      jwksData = (await response.json()) as GoogleJWKSResponse;
    } catch {
      throw new Error('JWKS_PARSE_ERROR: Failed to parse Google JWKS JSON response');
    }

    if (!jwksData || !Array.isArray(jwksData.keys) || jwksData.keys.length === 0) {
      throw new Error('JWKS_EMPTY_ERROR: Google JWKS response contains no valid keys');
    }

    // Determine cache TTL from Cache-Control header
    const cacheControl = response.headers.get('cache-control');
    const ttlMs = this.parseCacheControlTtl(cacheControl);
    this.cacheExpiresAt = now + ttlMs;

    // Convert each RSA JWK into a Node KeyObject
    const newKeys = new Map<string, crypto.KeyObject>();
    for (const key of jwksData.keys) {
      if (this.isValidRsaJwk(key)) {
        try {
          const keyObject = crypto.createPublicKey({
            key: {
              kty: key.kty,
              n: key.n,
              e: key.e
            },
            format: 'jwk'
          });
          newKeys.set(key.kid, keyObject);
        } catch {
          // Ignore invalid individual keys to keep valid ones
        }
      }
    }

    if (newKeys.size === 0) {
      throw new Error('JWKS_NO_USABLE_KEYS: No valid RSA public keys found in Google JWKS');
    }

    // Atomic update of cache
    this.keyCache.clear();
    for (const [kid, keyObj] of newKeys.entries()) {
      this.keyCache.set(kid, keyObj);
    }
  }

  /**
   * Validates whether a JWK is a valid RSA public signing key.
   */
  private isValidRsaJwk(key: GoogleJWK): boolean {
    if (!key || typeof key !== 'object') return false;
    if (key.kty !== 'RSA') return false;
    if (!key.kid || typeof key.kid !== 'string') return false;
    if (!key.n || typeof key.n !== 'string') return false;
    if (!key.e || typeof key.e !== 'string') return false;
    if (key.use && key.use !== 'sig') return false;
    if (key.alg && key.alg !== 'RS256') return false;
    return true;
  }

  /**
   * Clears in-memory key cache.
   */
  public clearCache(): void {
    this.keyCache.clear();
    this.cacheExpiresAt = 0;
    this.lastFetchTime = 0;
    this.mockKeys = null;
  }
}

/**
 * Singleton instance of GoogleJWKSClient.
 */
export const defaultGoogleJWKSClient = new GoogleJWKSClient();
