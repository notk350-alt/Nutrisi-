/**
 * NutriBodySim — Identity, Authentication & Governance Drizzle Schema
 * Milestone: MVS-B2.5E.1B.4
 * References: docs/architecture/database/E1B3_POSTGRESQL_SCHEMA.sql
 *
 * Covers 3 tables:
 * - users
 * - external_identities
 * - role_requests
 *
 * Pending Decision 3: No password hash column added; authentication is session & OIDC-based.
 */

import {
  pgTable,
  varchar,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  unique,
  index
} from 'drizzle-orm/pg-core';
import type { Permission, UserRole, AccountStatus, RequestedRole, ApprovalStatus } from '../types';

// ============================================================================
// 9. Users & Credentials (Baseline: 4 records)
// ============================================================================
export const users = pgTable(
  'users',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    email: varchar('email', { length: 255 }).notNull().unique(),
    name: varchar('name', { length: 128 }).notNull(),
    displayName: varchar('display_name', { length: 128 }),
    role: varchar('role', { length: 32 }).$type<UserRole>().notNull(),
    permissions: jsonb('permissions').$type<Permission[]>().notNull().default([]),
    organization: varchar('organization', { length: 255 }),
    avatarUrl: text('avatar_url'),
    accountStatus: varchar('account_status', { length: 32 }).$type<AccountStatus>().notNull().default('ACTIVE'),
    emailVerified: boolean('email_verified').notNull().default(false),
    provider: varchar('provider', { length: 32 }).notNull().default('local'),
    providerSubjectId: varchar('provider_subject_id', { length: 255 }),
    isMainAdmin: boolean('is_main_admin').notNull().default(false),
    governanceGrantedAt: timestamp('governance_granted_at', { withTimezone: true }),
    governanceGrantedBy: varchar('governance_granted_by', { length: 64 }),
    tokenVersion: integer('token_version').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true })
  },
  (table) => [
    index('idx_users_role').on(table.role),
    index('idx_users_account_status').on(table.accountStatus),
    index('idx_users_provider_subject').on(table.provider, table.providerSubjectId)
  ]
);

// ============================================================================
// 10. External Federated Identities (OIDC) (Baseline: 0 records, typed schema)
// ============================================================================
export const externalIdentities = pgTable(
  'external_identities',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    userId: varchar('user_id', { length: 64 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: varchar('provider', { length: 32 }).notNull(),
    providerSubjectId: varchar('provider_subject_id', { length: 255 }).notNull(),
    email: varchar('email', { length: 255 }),
    emailVerified: boolean('email_verified').notNull().default(false),
    linkedAt: timestamp('linked_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    unique('uq_external_identities_provider_subject').on(table.provider, table.providerSubjectId),
    index('idx_external_identities_user_id').on(table.userId)
  ]
);

// ============================================================================
// 11. Role Elevation & Governance Requests (Baseline: 0 records, typed schema)
// ============================================================================
export const roleRequests = pgTable(
  'role_requests',
  {
    requestId: varchar('request_id', { length: 64 }).primaryKey(),
    userId: varchar('user_id', { length: 64 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    requestedRole: varchar('requested_role', { length: 32 }).$type<RequestedRole>().notNull(),
    approvalStatus: varchar('approval_status', { length: 32 }).$type<ApprovalStatus>().notNull().default('PENDING'),
    institution: varchar('institution', { length: 255 }),
    justification: text('justification'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    reviewedBy: varchar('reviewed_by', { length: 64 }).references(() => users.id, { onDelete: 'set null' }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewReason: text('review_reason')
  },
  (table) => [
    index('idx_role_requests_status').on(table.approvalStatus),
    index('idx_role_requests_user').on(table.userId)
  ]
);
