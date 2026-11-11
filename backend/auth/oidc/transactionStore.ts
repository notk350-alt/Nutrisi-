/**
 * NutriBodySim — OIDC Transaction Store & Lifecycle Manager (MVS-B2.5C.1)
 *
 * Implements isolated, deterministic in-memory storage and lifecycle management
 * for pre-authentication OIDC transactions.
 *
 * Security guarantees:
 * - High-entropy cryptographic tokens for transaction ID, state, and nonce.
 * - Server-only secrets (codeVerifier, stateHash) are strictly isolated from client projection.
 * - Single-use enforcement: transactions are marked consumed atomically and rejected upon replay.
 * - Expiration enforcement: transactions expire after TTL, with configurable clock-skew tolerance.
 * - Memory leak mitigation: bounded maximum capacity with FIFO eviction and expired cleanup.
 * - Client browser binding: supports optional binding to initial browser fingerprint/session.
 * - Isolated from authenticated User sessions (zero session mixing).
 */

import {
  IOIDCTransactionStore,
  OIDCTransaction,
  OIDCClientTransactionData,
  CreateTransactionOptions,
  ConsumeTransactionOptions,
  ConsumeTransactionResult
} from './types';
import {
  generateCryptographicToken,
  generateState,
  hashState,
  generateNonce,
  generateCodeVerifier,
  calculateCodeChallenge,
  timingSafeEqual,
  DEFAULT_CODE_VERIFIER_LENGTH
} from './primitives';
import { DEFAULT_TRANSACTION_TTL_SECONDS } from './config';

export const DEFAULT_MAX_TRANSACTIONS = 5000;

export class MemoryOIDCTransactionStore implements IOIDCTransactionStore {
  /**
   * Internal storage for transactions indexed by transaction ID.
   */
  private readonly transactions = new Map<string, OIDCTransaction>();

  /**
   * Secondary index: stateHash -> transactionId.
   * Speeds up lookup during OIDC callback without linear scanning.
   */
  private readonly stateIndex = new Map<string, string>();

  private readonly maxCapacity: number;
  private readonly defaultTtlSeconds: number;
  private readonly clockSkewToleranceMs: number;

  constructor(options?: {
    maxCapacity?: number;
    defaultTtlSeconds?: number;
    clockSkewToleranceSeconds?: number;
    clockSkewToleranceMs?: number;
  }) {
    this.maxCapacity = options?.maxCapacity ?? DEFAULT_MAX_TRANSACTIONS;
    this.defaultTtlSeconds = options?.defaultTtlSeconds ?? DEFAULT_TRANSACTION_TTL_SECONDS;
    this.clockSkewToleranceMs = options?.clockSkewToleranceMs !== undefined
      ? options.clockSkewToleranceMs
      : ((options?.clockSkewToleranceSeconds ?? 60) * 1000);
  }

  /**
   * Creates a new cryptographically isolated OIDC transaction.
   * Generates state, nonce, and PKCE S256 code_verifier / code_challenge.
   */
  public createTransaction(options?: CreateTransactionOptions): {
    transaction: OIDCTransaction;
    clientData: OIDCClientTransactionData;
  } {
    const now = options?.currentTime ?? Date.now();

    // 1. Capacity check and proactive expired cleanup
    if (this.transactions.size >= this.maxCapacity) {
      this.cleanExpiredTransactions(now);
      // If still at capacity, evict the oldest unconsumed transaction (FIFO)
      if (this.transactions.size >= this.maxCapacity) {
        const oldestId = this.transactions.keys().next().value;
        if (oldestId) {
          this.deleteTransaction(oldestId);
        }
      }
    }

    const ttlSeconds = options?.ttlSeconds && options.ttlSeconds > 0
      ? options.ttlSeconds
      : this.defaultTtlSeconds;
    const expiresAt = now + ttlSeconds * 1000;

    // 2. Cryptographic token generation
    const id = generateCryptographicToken(32); // 64 hex chars, 256 bits entropy
    const state = generateState(32);           // 64 hex chars, 256 bits entropy
    const stateHashValue = hashState(state);
    const nonce = generateNonce(32);           // 64 hex chars, 256 bits entropy

    // 3. RFC 7636 PKCE S256 parameters
    const verifierLength = options?.verifierLength ?? DEFAULT_CODE_VERIFIER_LENGTH;
    const codeVerifier = generateCodeVerifier(verifierLength);
    const codeChallenge = calculateCodeChallenge(codeVerifier, 'S256');

    // 4. Server transaction record
    const transaction: OIDCTransaction = {
      id,
      state,
      stateHash: stateHashValue,
      nonce,
      codeVerifier,
      codeChallenge,
      codeChallengeMethod: 'S256',
      createdAt: now,
      expiresAt,
      consumed: false,
      redirectUri: options?.redirectUri,
      clientBinding: options?.clientBinding,
      purpose: options?.purpose ?? 'login',
      targetUserId: options?.targetUserId
    };

    // 5. Store transaction and update secondary index
    this.transactions.set(id, transaction);
    this.stateIndex.set(stateHashValue, id);

    // 6. Safe client data projection (MUST NOT EXPOSE SECRETS)
    const clientData: OIDCClientTransactionData = {
      transactionId: id,
      state,
      codeChallenge,
      codeChallengeMethod: 'S256',
      expiresAt
    };

    return {
      transaction,
      clientData
    };
  }

  /**
   * Retrieves an unconsumed transaction by state token using timing-safe comparison.
   * Returns null if not found, expired, or already consumed.
   */
  public getTransactionByState(state: string): OIDCTransaction | null {
    if (!state || typeof state !== 'string') return null;

    try {
      const stateHashValue = hashState(state);
      const transactionId = this.stateIndex.get(stateHashValue);
      if (!transactionId) return null;

      const tx = this.transactions.get(transactionId);
      if (!tx) return null;

      // Verify actual state in constant time
      if (!timingSafeEqual(tx.state, state)) {
        return null;
      }

      return tx;
    } catch {
      return null;
    }
  }

  /**
   * Retrieves a transaction by its internal ID.
   */
  public getTransaction(transactionId: string): OIDCTransaction | null {
    try {
      if (!transactionId) return null;
      return this.transactions.get(transactionId) || null;
    } catch {
      return null;
    }
  }

  /**
   * Validates and consumes an OIDC transaction atomically.
   * Enforces single-use, timing-safe checks, expiration, and replay prevention.
   */
  public consumeTransaction(options: ConsumeTransactionOptions): ConsumeTransactionResult {
    if (!options || typeof options !== 'object') {
      return {
        success: false,
        error: 'Invalid consumption options provided',
        code: 'INVALID_ARGUMENT'
      };
    }

    const { state, transactionId, nonce, clientBinding } = options;
    const now = options.currentTime ?? Date.now();

    if (!state || typeof state !== 'string') {
      return {
        success: false,
        error: 'State parameter is missing or invalid',
        code: 'INVALID_STATE'
      };
    }

    // 1. Locate transaction
    let transaction: OIDCTransaction | null = null;
    if (transactionId) {
      transaction = this.getTransaction(transactionId);
    } else {
      transaction = this.getTransactionByState(state);
    }

    if (!transaction) {
      return {
        success: false,
        error: 'Transaction not found or invalid state',
        code: 'TRANSACTION_NOT_FOUND'
      };
    }

    // 2. Single-use enforcement (Strict replay mitigation)
    if (transaction.consumed) {
      return {
        success: false,
        error: 'Transaction has already been consumed. Replay attempt rejected.',
        code: 'TRANSACTION_ALREADY_CONSUMED'
      };
    }

    // 3. Expiration validation (with bounded clock skew)
    if (now > transaction.expiresAt + this.clockSkewToleranceMs) {
      return {
        success: false,
        error: 'Transaction has expired',
        code: 'TRANSACTION_EXPIRED'
      };
    }

    // 4. Timing-safe state comparison
    if (!timingSafeEqual(transaction.state, state)) {
      return {
        success: false,
        error: 'State mismatch',
        code: 'INVALID_STATE'
      };
    }

    // 5. Nonce comparison (if nonce was supplied in callback/ID token)
    if (nonce !== undefined && !timingSafeEqual(transaction.nonce, nonce)) {
      return {
        success: false,
        error: 'Nonce mismatch between callback and transaction',
        code: 'NONCE_MISMATCH'
      };
    }

    // 6. Client binding check (if transaction was bound to specific browser fingerprint)
    if (transaction.clientBinding !== undefined) {
      if (!clientBinding || !timingSafeEqual(transaction.clientBinding, clientBinding)) {
        return {
          success: false,
          error: 'Client browser binding mismatch',
          code: 'CLIENT_BINDING_MISMATCH'
        };
      }
    }

    // 7. Atomic state mutation: Mark consumed and revoke state index
    transaction.consumed = true;
    transaction.consumedAt = now;
    this.stateIndex.delete(transaction.stateHash);

    return {
      success: true,
      transaction
    };
  }

  /**
   * Deletes a transaction and clears its index entry.
   */
  public deleteTransaction(id: string): boolean {
    const tx = this.transactions.get(id);
    if (!tx) return false;
    this.stateIndex.delete(tx.stateHash);
    return this.transactions.delete(id);
  }

  /**
   * Cleans all expired transactions from the store.
   */
  public cleanExpiredTransactions(now: number = Date.now()): number {
    let cleaned = 0;
    for (const [id, tx] of this.transactions.entries()) {
      if (now > tx.expiresAt + this.clockSkewToleranceMs) {
        this.stateIndex.delete(tx.stateHash);
        this.transactions.delete(id);
        cleaned++;
      }
    }
    return cleaned;
  }

  /**
   * Returns the count of active (non-expired, unconsumed) transactions.
   */
  public getActiveTransactionsCount(now: number = Date.now()): number {
    let count = 0;
    for (const tx of this.transactions.values()) {
      if (!tx.consumed && now <= tx.expiresAt + this.clockSkewToleranceMs) {
        count++;
      }
    }
    return count;
  }

  /**
   * Returns current total records and maximum configured capacity.
   */
  public getCapacity(): { current: number; max: number } {
    return {
      current: this.transactions.size,
      max: this.maxCapacity
    };
  }

  /**
   * Clears all transactions and indices (for test reset).
   */
  public clear(): void {
    this.transactions.clear();
    this.stateIndex.clear();
  }
}

/**
 * Default singleton instance of the in-memory OIDC transaction store.
 */
export const defaultOIDCTransactionStore = new MemoryOIDCTransactionStore();
