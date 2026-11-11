/**
 * NutriBodySim — Academic Materials, Collections & Study Annotations Drizzle Schema
 * Milestone: MVS-B2.5E.1B.4
 * References: docs/architecture/database/E1B3_POSTGRESQL_SCHEMA.sql
 *
 * Covers 8 domain & junction tables:
 * - materials
 * - material_projects (Junction M:N)
 * - material_collections
 * - collection_materials (Junction M:N)
 * - reading_progress
 * - bookmarks
 * - highlights
 * - notes
 */

import {
  pgTable,
  varchar,
  text,
  integer,
  bigint,
  doublePrecision,
  timestamp,
  jsonb,
  primaryKey,
  unique,
  index,
  check
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './identity';
import { projects } from './collaboration';
import type { MaterialType } from '../types';

// ============================================================================
// 16. Academic & Reference Materials (Baseline: 2 records)
// ============================================================================
export const materials = pgTable(
  'materials',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    title: varchar('title', { length: 255 }).notNull(),
    author: varchar('author', { length: 255 }),
    subject: varchar('subject', { length: 128 }),
    type: varchar('type', { length: 32 }).$type<MaterialType>().notNull(),
    description: text('description'),
    year: integer('year'),
    publisher: varchar('publisher', { length: 255 }),
    language: varchar('language', { length: 16 }).default('en'),
    url: text('url'),
    source: varchar('source', { length: 255 }),
    license: varchar('license', { length: 64 }),
    tags: jsonb('tags').$type<string[]>().notNull().default([]),
    version: varchar('version', { length: 32 }).default('1.0.0'),
    uploadedBy: varchar('uploaded_by', { length: 64 })
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    filePath: text('file_path').notNull(),
    fileSizeBytes: bigint('file_size_bytes', { mode: 'number' }).notNull(),
    mimeType: varchar('mime_type', { length: 64 }).notNull(),
    fileHash: varchar('file_hash', { length: 128 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    check('materials_type_check', sql`${table.type} IN ('PDF', 'TXT', 'EPUB', 'DOCX', 'PPTX', 'XLSX', 'CSV', 'IMAGE')`),
    check('materials_year_check', sql`${table.year} IS NULL OR (${table.year} >= 1800 AND ${table.year} <= 2100)`),
    check('materials_file_size_bytes_check', sql`${table.fileSizeBytes} >= 0`),
    index('idx_materials_uploaded_by').on(table.uploadedBy),
    index('idx_materials_type').on(table.type)
  ]
);

// Junction: Material to Projects (M:N)
export const materialProjects = pgTable(
  'material_projects',
  {
    materialId: varchar('material_id', { length: 64 })
      .notNull()
      .references(() => materials.id, { onDelete: 'cascade' }),
    projectId: varchar('project_id', { length: 64 })
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' })
  },
  (table) => [
    primaryKey({ columns: [table.materialId, table.projectId] })
  ]
);

// ============================================================================
// 17. Material Curated Collections (Baseline: 1 record)
// ============================================================================
export const materialCollections = pgTable(
  'material_collections',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    name: varchar('name', { length: 128 }).notNull(),
    description: text('description'),
    color: varchar('color', { length: 32 }),
    createdBy: varchar('created_by', { length: 64 })
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  }
);

// Junction: Collection to Materials (M:N)
export const collectionMaterials = pgTable(
  'collection_materials',
  {
    collectionId: varchar('collection_id', { length: 64 })
      .notNull()
      .references(() => materialCollections.id, { onDelete: 'cascade' }),
    materialId: varchar('material_id', { length: 64 })
      .notNull()
      .references(() => materials.id, { onDelete: 'cascade' })
  },
  (table) => [
    primaryKey({ columns: [table.collectionId, table.materialId] })
  ]
);

// ============================================================================
// 18. Reading Progress Tracking (Baseline: 1 record)
// ============================================================================
export const readingProgress = pgTable(
  'reading_progress',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    userId: varchar('user_id', { length: 64 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    materialId: varchar('material_id', { length: 64 })
      .notNull()
      .references(() => materials.id, { onDelete: 'cascade' }),
    lastPage: integer('last_page').notNull().default(1),
    totalPages: integer('total_pages').notNull().default(1),
    progressPct: doublePrecision('progress_pct').notNull().default(0.0),
    scrollPosition: doublePrecision('scroll_position').default(0.0),
    lastAccessed: timestamp('last_accessed', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    unique('uq_reading_progress_user_material').on(table.userId, table.materialId),
    check(
      'reading_progress_progress_pct_check',
      sql`${table.progressPct} >= 0.0 AND ${table.progressPct} <= 100.0`
    ),
    index('idx_reading_progress_user').on(table.userId)
  ]
);

// ============================================================================
// 19. Academic Bookmarks (Baseline: 1 record)
// ============================================================================
export const bookmarks = pgTable(
  'bookmarks',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    userId: varchar('user_id', { length: 64 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    materialId: varchar('material_id', { length: 64 })
      .notNull()
      .references(() => materials.id, { onDelete: 'cascade' }),
    page: integer('page').notNull(),
    title: varchar('title', { length: 255 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    check('bookmarks_page_check', sql`${table.page} >= 1`),
    index('idx_bookmarks_user_material').on(table.userId, table.materialId)
  ]
);

// ============================================================================
// 20. Study Highlights (Baseline: 1 record)
// ============================================================================
export const highlights = pgTable(
  'highlights',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    userId: varchar('user_id', { length: 64 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    materialId: varchar('material_id', { length: 64 })
      .notNull()
      .references(() => materials.id, { onDelete: 'cascade' }),
    page: integer('page').notNull(),
    selectedText: text('selected_text').notNull(),
    color: varchar('color', { length: 32 }).notNull().default('yellow'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    check('highlights_page_check', sql`${table.page} >= 1`),
    index('idx_highlights_user_material').on(table.userId, table.materialId)
  ]
);

// ============================================================================
// 21. Study & Research Notes (Baseline: 1 record)
// ============================================================================
export const notes = pgTable(
  'notes',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    userId: varchar('user_id', { length: 64 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 255 }).notNull(),
    content: text('content').notNull(),
    materialId: varchar('material_id', { length: 64 }).references(() => materials.id, { onDelete: 'cascade' }),
    page: integer('page'),
    selectedText: text('selected_text'),
    projectId: varchar('project_id', { length: 64 }).references(() => projects.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index('idx_notes_user_project').on(table.userId, table.projectId),
    index('idx_notes_material').on(table.materialId)
  ]
);
