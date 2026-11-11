import { boolean, check, index, integer, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './identity';

export const runtimeSessions = pgTable(
  'runtime_sessions',
  {
    tokenHash: varchar('token_hash', { length: 64 }).primaryKey(),
    userId: varchar('user_id', { length: 64 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenVersion: integer('token_version').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revoked: boolean('revoked').notNull().default(false)
  },
  (table) => [
    index('idx_runtime_sessions_user_id').on(table.userId),
    index('idx_runtime_sessions_expiration').on(table.expiresAt)
  ]
);

export const oidcTransactions = pgTable(
  'oidc_transactions',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    stateHash: varchar('state_hash', { length: 64 }).notNull().unique(),
    state: varchar('state', { length: 512 }).notNull(),
    nonce: varchar('nonce', { length: 512 }).notNull(),
    codeVerifier: varchar('code_verifier', { length: 128 }).notNull(),
    codeChallenge: varchar('code_challenge', { length: 128 }).notNull(),
    codeChallengeMethod: varchar('code_challenge_method', { length: 8 }).notNull(),
    purpose: varchar('purpose', { length: 32 }).notNull().default('login'),
    targetUserId: varchar('target_user_id', { length: 64 }).references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumed: boolean('consumed').notNull().default(false),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    clientBinding: varchar('client_binding', { length: 255 }),
    returnUrl: varchar('return_url', { length: 2048 }),
    redirectUri: varchar('redirect_uri', { length: 2048 })
  },
  (table) => [
    check('oidc_transactions_method_check', sql`${table.codeChallengeMethod} = 'S256'`),
    check('oidc_transactions_purpose_check', sql`${table.purpose} IN ('login', 'link-account')`),
    index('idx_oidc_transactions_expiration').on(table.expiresAt),
    index('idx_oidc_transactions_target_user').on(table.targetUserId)
  ]
);
