/**
 * NutriBodySim — Collaboration, Teams & Projects Drizzle Schema
 * Milestone: MVS-B2.5E.1B.4
 * References: docs/architecture/database/E1B3_POSTGRESQL_SCHEMA.sql
 *
 * Covers 4 tables:
 * - teams
 * - team_members
 * - projects
 * - project_members
 */

import {
  pgTable,
  varchar,
  text,
  boolean,
  timestamp,
  jsonb,
  unique,
  index
} from 'drizzle-orm/pg-core';
import { users } from './identity';
import type { ProjectType, TeamRole } from '../types';

// ============================================================================
// 12. Teams (Baseline: 1 record)
// ============================================================================
export const teams = pgTable(
  'teams',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    name: varchar('name', { length: 128 }).notNull(),
    description: text('description'),
    ownerId: varchar('owner_id', { length: 64 })
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index('idx_teams_owner_id').on(table.ownerId)
  ]
);

// ============================================================================
// 13. Team Memberships (Baseline: 3 records)
// ============================================================================
export const teamMembers = pgTable(
  'team_members',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    teamId: varchar('team_id', { length: 64 })
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    userId: varchar('user_id', { length: 64 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: varchar('role', { length: 32 }).notNull(),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    unique('uq_team_members_team_user').on(table.teamId, table.userId),
    index('idx_team_members_user').on(table.userId)
  ]
);

// ============================================================================
// 14. Projects (Baseline: 2 records)
// ============================================================================
export const projects = pgTable(
  'projects',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    name: varchar('name', { length: 128 }).notNull(),
    description: text('description'),
    type: varchar('type', { length: 32 }).$type<ProjectType>().notNull(),
    ownerId: varchar('owner_id', { length: 64 })
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    teamId: varchar('team_id', { length: 64 }).references(() => teams.id, { onDelete: 'set null' }),
    isPublic: boolean('is_public').notNull().default(false),
    tags: jsonb('tags').$type<string[]>().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index('idx_projects_owner_id').on(table.ownerId),
    index('idx_projects_team_id').on(table.teamId),
    index('idx_projects_is_public').on(table.isPublic)
  ]
);

// ============================================================================
// 15. Project Memberships (Baseline: 4 records)
// ============================================================================
export const projectMembers = pgTable(
  'project_members',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    projectId: varchar('project_id', { length: 64 })
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: varchar('user_id', { length: 64 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: varchar('role', { length: 32 }).$type<TeamRole>().notNull(),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    unique('uq_project_members_project_user').on(table.projectId, table.userId),
    index('idx_project_members_user').on(table.userId)
  ]
);
