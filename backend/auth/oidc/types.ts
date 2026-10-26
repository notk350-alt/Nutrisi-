/**
 * NutriBodySim — OIDC Identity & Security Types (MVS-B2.5C.1)
 *
 * Defines typed configuration contracts, transaction models,
 * client-safe projections, and transaction store abstractions.
 *
 * Security guarantees:
 * - Clear separation between server-only secrets and client-safe data.
 * - Server secrets (code_verifier, client_secret) are never exposed to clients.
 * - Strongly typed transaction lifecycle (creation, verification, consumption, revocation).
 */

export interface OIDCConfig {
  /**
   * Whether Google OIDC authentication is enabled.
   * If false, the system operates in safe disabled/stub mode.
   */
  enabled: boolean;

  /**
   * Google OAuth 2.0 Client ID.
   * Required if enabled is true.
   */
  clientId: string;

  /**
   * Google OAuth 2.0 Client Secret.
   * Required if enabled is true. Never exposed or logged.
   */
  clientSecret: string;

  /**
   * Expected OpenID Connect Issuer URL.
   * Default: 'https://accounts.google.com'
   */
  issuer: string;

  /**
   * Google Authorization Endpoint.
   * Default: 'https://accounts.google.com/o/oauth2/v2/auth'
   */
  authorizationEndpoint: string;

  /**
   * Google Token Exchange Endpoint.
   * Default: 'https://oauth2.googleapis.com/token'
   */
  tokenEndpoint: string;

  /**
   * Google JWKS URI for public key verification.
   * Default: 'https://www.googleapis.com/oauth2/v3/certs'
   */
  jwksUri: string;

  /**
   * Redirect URI registered in Google Cloud Console.
   */
  redirectUri: string;

  /**
   * Allowed OAuth 2.0 scopes. Must include 'openid'.
   * Default: ['openid', 'email', 'profile']
   */
  allowedScopes: string[];

  /**
   * Lifespan of pre-auth OIDC transactions in seconds.
   * Default: 600 (10 minutes).
   */
  transactionTtlSeconds: number;

  /**
   * Clock skew tolerance for expiration comparisons in seconds.
   * Default: 60 (1 minute).
   */
  clockSkewToleranceSeconds: number;

  /**
   * Cookie SameSite setting for OIDC transaction/session cookies.
   * 'none' for AI Studio iframe preview, 'lax' for standalone production.
   */
  cookieSameSite: 'none' | 'lax' | 'strict';

  /**
   * Cookie Secure flag. Must be true in production or when SameSite is 'none'.
   */
  cookieSecure: boolean;
}

export interface OIDCConfigValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Server-side complete OIDC transaction entity.
 * Contains sensitive cryptographic artifacts (code_verifier, nonce)
 * that MUST NEVER be sent to the browser/client.
 */
export interface OIDCTransaction {
  /**
   * Cryptographically secure 256-bit internal transaction ID (64 hex chars).
   */
  id: string;

  /**
   * Cryptographically secure 256-bit state value (64 hex chars).
   */
  state: string;

  /**
   * SHA-256 hash of the state value for indexed lookup.
   */
  stateHash: string;

  /**
   * Cryptographically secure 256-bit nonce for ID token replay mitigation.
   */
  nonce: string;

  /**
   * RFC 7636 PKCE code_verifier (43-128 unreserved characters).
   * MUST REMAIN ON SERVER ONLY.
   */
  codeVerifier: string;

  /**
   * RFC 7636 PKCE code_challenge (Base64url SHA-256 of codeVerifier).
   */
  codeChallenge: string;

  /**
   * RFC 7636 PKCE challenge method. Strictly 'S256'.
   */
  codeChallengeMethod: 'S256';

  /**
   * Timestamp (epoch ms) when the transaction was initialized.
   */
  createdAt: number;

  /**
   * Timestamp (epoch ms) when the transaction expires.
   */
  expiresAt: number;

  /**
   * Whether this transaction has already been consumed in a token exchange.
   * Enforces strict single-use semantics to prevent replay attacks.
   */
  consumed: boolean;

  /**
   * Timestamp (epoch ms) when the transaction was consumed.
   */
  consumedAt?: number;

  /**
   * Optional browser or session binding identifier (e.g., hashed client fingerprint).
   */
  clientBinding?: string;

  /**
   * Optional application return URL after successful authentication.
   */
  returnUrl?: string;

  /**
   * Optional redirect URI configured for this transaction.
   */
  redirectUri?: string;
}

/**
 * Client-safe projection of an OIDC transaction.
 * Contains ONLY public parameters required to construct or initiate the authorization request.
 * Crucially EXCLUDES codeVerifier, clientSecret, internal state hashes, or database IDs.
 */
export interface OIDCClientTransactionData {
  transactionId: string;
  state: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
  expiresAt: number;
  authorizationUrl?: string;
}

export interface CreateTransactionOptions {
  ttlSeconds?: number;
  clientBinding?: string;
  returnUrl?: string;
  verifierLength?: number;
  currentTime?: number;
  redirectUri?: string;
}

export type SanitizedOIDCConfig = Omit<OIDCConfig, 'clientSecret'> & { hasClientSecret: boolean };

export interface ConsumeTransactionOptions {
  transactionId?: string;
  state: string;
  nonce?: string;
  clientBinding?: string;
  currentTime?: number;
}

export type OIDCConsumeErrorCode =
  | 'INVALID_STATE'
  | 'TRANSACTION_NOT_FOUND'
  | 'TRANSACTION_EXPIRED'
  | 'TRANSACTION_ALREADY_CONSUMED'
  | 'NONCE_MISMATCH'
  | 'CLIENT_BINDING_MISMATCH'
  | 'INVALID_ARGUMENT';

export interface ConsumeTransactionResult {
  success: boolean;
  error?: string;
  code?: OIDCConsumeErrorCode;
  transaction?: OIDCTransaction;
}

export interface IOIDCTransactionStore {
  /**
   * Creates and registers a new cryptographically secure OIDC transaction.
   * Returns both the full server record and client-safe data.
   */
  createTransaction(options?: CreateTransactionOptions): {
    transaction: OIDCTransaction;
    clientData: OIDCClientTransactionData;
  };

  /**
   * Retrieves an active transaction by internal transaction ID.
   */
  getTransaction(id: string): OIDCTransaction | null;

  /**
   * Retrieves an active transaction by state parameter.
   */
  getTransactionByState(state: string): OIDCTransaction | null;

  /**
   * Validates and atomically marks a transaction as consumed (single-use enforcement).
   * Rejects expired, non-existent, tampered, or already-consumed transactions.
   */
  consumeTransaction(options: ConsumeTransactionOptions): ConsumeTransactionResult;

  /**
   * Deletes a transaction from storage.
   */
  deleteTransaction(id: string): boolean;

  /**
   * Cleans up expired transactions to prevent memory leaks and resource exhaustion.
   */
  cleanExpiredTransactions(now?: number): number;

  /**
   * Returns the count of currently active (non-expired, unconsumed) transactions.
   */
  getActiveTransactionsCount(): number;

  /**
   * Returns current capacity and maximum capacity metrics.
   */
  getCapacity(): { current: number; max: number };

  /**
   * Resets all stored transactions (used primarily for test isolation).
   */
  clear(): void;
}

/**
 * Categorized error codes for OIDC ID Token verification failures.
 * Used internally for security auditing and telemetry without leaking secrets.
 */
export type OIDCVerificationErrorCode =
  | 'OIDC_TOKEN_MALFORMED'
  | 'OIDC_SIGNATURE_INVALID'
  | 'OIDC_ISSUER_INVALID'
  | 'OIDC_AUDIENCE_INVALID'
  | 'OIDC_TOKEN_EXPIRED'
  | 'OIDC_NONCE_INVALID'
  | 'OIDC_REQUIRED_CLAIM_MISSING'
  | 'OIDC_JWKS_UNAVAILABLE'
  | 'OIDC_KEY_NOT_FOUND'
  | 'OIDC_CONFIGURATION_INVALID'
  | 'OIDC_ALGORITHM_NOT_ALLOWED';

/**
 * Standard JSON Web Key (JWK) structure published by Google JWKS endpoint.
 */
export interface GoogleJWK {
  kty: string;
  alg?: string;
  use?: string;
  kid: string;
  n: string;
  e: string;
}

export interface GoogleJWKSResponse {
  keys: GoogleJWK[];
}

/**
 * Abstract interface for Google JWKS fetching, caching, and key rotation.
 */
export interface IJWKSClient {
  /**
   * Retrieves an RSA public key matching the specified kid.
   * If key is not in cache, triggers controlled rate-limited fetch.
   */
  getKey(kid: string): Promise<any | null>;

  /**
   * Refreshes public keys from the official JWKS endpoint.
   */
  refreshKeys(force?: boolean): Promise<void>;

  /**
   * Clears the in-memory key cache.
   */
  clearCache(): void;

  /**
   * Injects mock keys for testing without network requests.
   */
  setMockKeys?(keys: Map<string, any>): void;
}

/**
 * Verified user identity extracted from a cryptographically validated Google ID Token.
 * Free from raw signatures, sensitive server secrets, or unverified claims.
 */
export interface VerifiedOIDCIdentity {
  /**
   * Static identity provider identifier, strictly fixed to 'google'.
   */
  provider: 'google';

  /**
   * Immutable Google Subject ID (unique 255-char numeric string).
   * Primary identity anchor for NutriBodySim.
   */
  sub: string;

  /**
   * Validated token issuer ('https://accounts.google.com' or 'accounts.google.com').
   */
  issuer: string;

  /**
   * Validated target audience matching configured client ID.
   */
  audience: string | string[];

  /**
   * Token issuance timestamp (epoch milliseconds).
   */
  issuedAt: number;

  /**
   * Token expiration timestamp (epoch milliseconds).
   */
  expiresAt: number;

  /**
   * User email address if present and verified.
   */
  email?: string;

  /**
   * Whether Google verified ownership of the email address.
   */
  emailVerified?: boolean;

  /**
   * Structurally validated public profile claims (non-privileged).
   */
  profile?: {
    name?: string;
    picture?: string;
    givenName?: string;
    familyName?: string;
    locale?: string;
  };
}

/**
 * Options for verifying a Google OpenID Connect ID Token.
 */
export interface VerifyIDTokenOptions {
  /**
   * Raw ID Token JWT string received from trusted server context.
   */
  idToken: string;

  /**
   * Expected nonce value to verify against token's 'nonce' claim.
   */
  expectedNonce?: string;

  /**
   * Expected Client ID (defaults to config.clientId).
   */
  expectedClientId?: string;

  /**
   * Current epoch time in milliseconds (for deterministic testing).
   */
  currentTime?: number;

  /**
   * Clock skew tolerance in seconds (defaults to config.clockSkewToleranceSeconds or 60).
   */
  clockSkewToleranceSeconds?: number;

  /**
   * Optional transaction ID to bind against in transaction store.
   */
  transactionId?: string;

  /**
   * Transaction store instance to resolve transactionId.
   */
  transactionStore?: IOIDCTransactionStore;
}

/**
 * Result of Google ID Token verification.
 */
export interface VerifyIDTokenResult {
  success: boolean;
  identity?: VerifiedOIDCIdentity;
  error?: string;
  code?: OIDCVerificationErrorCode;
}

/**
 * Categorized error codes for Authorization Code Exchange failures (MVS-B2.5C.3).
 */
export type OIDCExchangeErrorCode =
  | 'OIDC_EXCHANGE_INVALID_INPUT'
  | 'OIDC_TRANSACTION_NOT_FOUND'
  | 'OIDC_TRANSACTION_EXPIRED'
  | 'OIDC_TRANSACTION_ALREADY_CONSUMED'
  | 'OIDC_CONFIGURATION_INVALID'
  | 'OIDC_TOKEN_ENDPOINT_UNAVAILABLE'
  | 'OIDC_TOKEN_ENDPOINT_REJECTED'
  | 'OIDC_TOKEN_RESPONSE_INVALID'
  | 'OIDC_ID_TOKEN_VERIFICATION_FAILED';

/**
 * Options for exchanging a Google Authorization Code for tokens.
 */
export interface ExchangeAuthorizationCodeOptions {
  /**
   * Untrusted authorization code received from callback query parameters.
   */
  code: string;

  /**
   * State parameter returned by Google callback, used to locate and consume transaction.
   */
  state: string;

  /**
   * Optional transaction ID if tracked via session or cookie context.
   */
  transactionId?: string;

  /**
   * Optional client browser binding to verify matching origin browser.
   */
  clientBinding?: string;

  /**
   * Current epoch time in milliseconds (for deterministic testing).
   */
  currentTime?: number;
}

/**
 * Injectable dependencies for the Authorization Code Exchange handler.
 */
export interface ExchangeDependencies {
  transactionStore?: IOIDCTransactionStore;
  jwksClient?: IJWKSClient;
  config?: OIDCConfig;
  customFetch?: typeof fetch;
}

/**
 * Result of the Authorization Code Exchange operation.
 */
export interface ExchangeAuthorizationCodeResult {
  success: boolean;
  identity?: VerifiedOIDCIdentity;
  error?: string;
  code?: OIDCExchangeErrorCode;
}

/**
 * Categorized error codes for OIDC Orchestration operations (MVS-B2.5C.4).
 */
export type OIDCOrchestrationErrorCode =
  | 'OIDC_INIT_INVALID_CONFIGURATION'
  | 'OIDC_INIT_TRANSACTION_CREATION_FAILED'
  | 'OIDC_CALLBACK_INVALID_INPUT'
  | 'OIDC_CALLBACK_STATE_INVALID'
  | 'OIDC_CALLBACK_TRANSACTION_INVALID'
  | 'OIDC_CALLBACK_PROVIDER_DENIED'
  | 'OIDC_CALLBACK_EXCHANGE_FAILED'
  | 'OIDC_ORCHESTRATION_INTERNAL_ERROR';

/**
 * Options for initiating an isolated Google OIDC Login flow.
 */
export interface InitiateLoginOptions {
  clientBinding?: string;
  returnUrl?: string;
  ttlSeconds?: number;
  currentTime?: number;
}

/**
 * Result of initiating a Google OIDC login flow.
 */
export interface InitiateLoginResult {
  success: boolean;
  authorizationUrl?: string;
  clientData?: OIDCClientTransactionData;
  error?: string;
  code?: OIDCOrchestrationErrorCode;
}

/**
 * Untrusted parameters received from the Google callback.
 */
export interface HandleCallbackOptions {
  code?: unknown;
  state?: unknown;
  error?: unknown;
  error_description?: unknown;
  clientBinding?: string;
  currentTime?: number;
}

/**
 * Injectable dependencies for the OIDC Orchestrator.
 */
export interface OrchestratorDependencies {
  transactionStore?: IOIDCTransactionStore;
  jwksClient?: IJWKSClient;
  config?: OIDCConfig;
  customFetch?: typeof fetch;
}

/**
 * Result of handling a Google callback through the isolated orchestrator.
 */
export interface HandleCallbackResult {
  success: boolean;
  identity?: VerifiedOIDCIdentity;
  error?: string;
  code?: OIDCOrchestrationErrorCode;
}

/**
 * Outcomes for Google Identity Provisioning & Resolution (MVS-B2.5D.2)
 */
export type IdentityProvisioningOutcome =
  | 'EXISTING_LINKED_ACCOUNT'
  | 'PROVISIONED_NEW_ACCOUNT'
  | 'IDENTITY_CONFLICT'
  | 'ACCOUNT_INACTIVE'
  | 'PROVISIONING_STORAGE_FAILURE'
  | 'INVALID_VERIFIED_IDENTITY';

/**
 * Options for internal Google Identity Provisioning.
 */
export interface ProvisionGoogleIdentityOptions {
  ipAddress?: string;
  currentTime?: number;
}

/**
 * Result of internal Google Identity Provisioning service.
 * Zero-credential guarantee: never returns raw tokens, client secret, nonce, or PKCE verifiers.
 * Session boundary: does NOT create or return user sessions or cookies.
 */
export interface ProvisionGoogleIdentityResult {
  outcome: IdentityProvisioningOutcome;
  success: boolean;
  user?: import('../../database/types').User;
  externalIdentity?: import('../../database/types').ExternalIdentity;
  conflictingUserId?: string;
  auditLog?: import('../../database/types').AuditLog;
  error?: string;
  code?: string;
}

