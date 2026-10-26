/**
 * NutriBodySim — Session Store & Manager (MVS-B2.2)
 *
 * Provides cryptographic session token generation, hashing, validation,
 * expiration, and revocation.
 *
 * Security guarantees:
 * - High-entropy tokens generated using Node.js crypto.randomBytes(32).
 * - Only SHA-256 token hashes are stored, preventing credential exposure.
 * - Raw tokens are never logged or stored in persistent representations.
 * - Strict TTL enforcement with automatic expired session cleanup.
 */

import crypto from 'crypto';

export interface SessionData {
  tokenHash: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
  revoked: boolean;
  tokenVersion?: number;
}

export interface SessionValidationResult {
  valid: boolean;
  userId?: string;
  expiresAt?: number;
  tokenVersion?: number;
  error?: string;
}

export interface ISessionStore {
  createSession(userId: string, ttlSeconds?: number, tokenVersion?: number): { token: string; expiresAt: number; session: Omit<SessionData, 'tokenHash'> };
  validateSession(token: string): SessionValidationResult;
  revokeSession(token: string): boolean;
  revokeSessionsForUser(userId: string): number;
  cleanExpiredSessions(): number;
  clear(): void;
  getActiveSessionsCount(): number;
}

export class MemorySessionStore implements ISessionStore {
  private sessions: Map<string, SessionData> = new Map();
  private defaultTtlSeconds: number;

  constructor(defaultTtlSeconds: number = 86400) {
    this.defaultTtlSeconds = defaultTtlSeconds;
  }

  /**
   * Generates a SHA-256 hash of the raw token for secure internal indexing.
   */
  public hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /**
   * Generates a 256-bit cryptographic token, records its hash in memory,
   * and returns the raw token to be delivered to the client.
   */
  public createSession(
    userId: string, 
    ttlSeconds?: number, 
    tokenVersion?: number
  ): { token: string; expiresAt: number; session: Omit<SessionData, 'tokenHash'> } {
    if (!userId || typeof userId !== 'string') {
      throw new Error('Valid userId is required to create a session');
    }

    const ttl = ttlSeconds !== undefined ? ttlSeconds : this.defaultTtlSeconds;
    const now = Date.now();
    const expiresAt = now + ttl * 1000;

    // 32 bytes = 256 bits of cryptographic entropy -> 64 hex characters
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(token);

    const effectiveVersion = typeof tokenVersion === 'number' && !Number.isNaN(tokenVersion) ? tokenVersion : 1;

    const sessionRecord: SessionData = {
      tokenHash,
      userId,
      createdAt: now,
      expiresAt,
      revoked: false,
      tokenVersion: effectiveVersion
    };

    this.sessions.set(tokenHash, sessionRecord);

    return {
      token,
      expiresAt,
      session: {
        userId: sessionRecord.userId,
        createdAt: sessionRecord.createdAt,
        expiresAt: sessionRecord.expiresAt,
        revoked: sessionRecord.revoked,
        tokenVersion: sessionRecord.tokenVersion
      }
    };
  }

  /**
   * Validates a raw token against stored session hashes.
   * Enforces format validation, presence, revocation, and expiration checks.
   */
  public validateSession(token: string): SessionValidationResult {
    if (!token || typeof token !== 'string') {
      return { valid: false, error: 'Token is missing or not a string' };
    }

    const trimmed = token.trim();
    // Enforce 64-character hex format
    if (!/^[a-f0-9]{64}$/i.test(trimmed)) {
      return { valid: false, error: 'Malformed session token format' };
    }

    const tokenHash = this.hashToken(trimmed);
    const session = this.sessions.get(tokenHash);

    if (!session) {
      return { valid: false, error: 'Session not found' };
    }

    if (session.revoked) {
      return { valid: false, error: 'Session has been revoked' };
    }

    if (Date.now() > session.expiresAt) {
      return { valid: false, error: 'Session has expired' };
    }

    return {
      valid: true,
      userId: session.userId,
      expiresAt: session.expiresAt,
      tokenVersion: session.tokenVersion
    };
  }

  /**
   * Revokes a session given its raw token.
   */
  public revokeSession(token: string): boolean {
    if (!token || typeof token !== 'string') return false;
    const tokenHash = this.hashToken(token.trim());
    const session = this.sessions.get(tokenHash);
    if (!session) return false;

    session.revoked = true;
    return true;
  }

  /**
   * Revokes all active sessions for a given user.
   */
  public revokeSessionsForUser(userId: string): number {
    if (!userId || typeof userId !== 'string') return 0;
    let revoked = 0;
    for (const session of this.sessions.values()) {
      if (session.userId === userId && !session.revoked) {
        session.revoked = true;
        revoked++;
      }
    }
    return revoked;
  }

  /**
   * Cleans up expired and revoked sessions to prevent memory bloat.
   */
  public cleanExpiredSessions(): number {
    const now = Date.now();
    let cleaned = 0;
    for (const [hash, session] of this.sessions.entries()) {
      if (session.revoked || now > session.expiresAt) {
        this.sessions.delete(hash);
        cleaned++;
      }
    }
    return cleaned;
  }

  /**
   * Clears all sessions (useful for tests or explicit reset).
   */
  public clear(): void {
    this.sessions.clear();
  }

  /**
   * Returns active non-revoked non-expired session count.
   */
  public getActiveSessionsCount(): number {
    const now = Date.now();
    let active = 0;
    for (const session of this.sessions.values()) {
      if (!session.revoked && now <= session.expiresAt) {
        active++;
      }
    }
    return active;
  }
}

// Global singleton instance
export const defaultSessionStore = new MemorySessionStore();
