/**
 * NutriBodySim — Provenance, Audit Trail & Scientific Calculations Drizzle Schema
 * Milestone: MVS-B2.5E.1B.4
 * References: docs/architecture/database/E1B3_POSTGRESQL_SCHEMA.sql
 *
 * Covers 3 tables:
 * - provenance_records
 * - audit_logs
 * - scientific_calculations
 */

import {
  pgTable,
  varchar,
  text,
  timestamp,
  jsonb,
  index
} from 'drizzle-orm/pg-core';
import { users } from './identity';
import { projects } from './collaboration';
import { datasetVersions } from './research';
import type { TraceStep } from '../../../scientific';

// ============================================================================
// 30. Immutable Provenance Records (Baseline: 1 record)
// ============================================================================
export const provenanceRecords = pgTable(
  'provenance_records',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    projectId: varchar('project_id', { length: 64 })
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    targetEntityType: varchar('target_entity_type', { length: 64 }).notNull(),
    targetEntityId: varchar('target_entity_id', { length: 64 }).notNull(),
    userId: varchar('user_id', { length: 64 })
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    datasetVersionId: varchar('dataset_version_id', { length: 64 }).references(
      () => datasetVersions.id,
      { onDelete: 'set null' }
    ),
    modelVersion: varchar('model_version', { length: 32 }),
    parameterVersion: varchar('parameter_version', { length: 32 }),
    environmentSpecs: text('environment_specs'),
    provenanceHash: varchar('provenance_hash', { length: 128 }).notNull(),
    reproducibilityManifest: jsonb('reproducibility_manifest').$type<Record<string, any>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index('idx_provenance_records_project').on(table.projectId),
    index('idx_provenance_records_target').on(table.targetEntityType, table.targetEntityId),
    index('idx_provenance_records_hash').on(table.provenanceHash)
  ]
);

// ============================================================================
// 31. System Security & Operational Audit Logs (Baseline: 1 record)
// ============================================================================
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    userId: varchar('user_id', { length: 64 }).references(() => users.id, { onDelete: 'set null' }),
    userName: varchar('user_name', { length: 128 }),
    action: varchar('action', { length: 64 }).notNull(),
    entityType: varchar('entity_type', { length: 64 }).notNull(),
    entityId: varchar('entity_id', { length: 64 }).notNull(),
    details: text('details').notNull(),
    ipAddress: varchar('ip_address', { length: 64 }),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index('idx_audit_logs_user_id').on(table.userId),
    index('idx_audit_logs_action').on(table.action),
    index('idx_audit_logs_entity').on(table.entityType, table.entityId),
    index('idx_audit_logs_timestamp').on(table.timestamp)
  ]
);

// ============================================================================
// 32. Scientific Calculation Execution Traces (Baseline: 0 records, typed schema)
// ============================================================================
export const scientificCalculations = pgTable(
  'scientific_calculations',
  {
    calculationId: varchar('calculation_id', { length: 64 }).primaryKey(),
    userId: varchar('user_id', { length: 64 }).references(() => users.id, { onDelete: 'set null' }),
    projectId: varchar('project_id', { length: 64 }).references(() => projects.id, { onDelete: 'set null' }),
    formulaOrModelId: varchar('formula_or_model_id', { length: 64 }).notNull(),
    version: varchar('version', { length: 32 }).notNull().default('1.0.0'),
    inputsReceived: jsonb('inputs_received').$type<Record<string, { value: number | string; unit: string }>>().notNull(),
    normalizedInputs: jsonb('normalized_inputs').$type<Record<string, { value: number; unit: string; original_unit: string }>>().notNull(),
    parametersResolved: jsonb('parameters_resolved').$type<Record<string, { value: number | string; unit: string }>>().notNull(),
    steps: jsonb('steps').$type<TraceStep[]>().notNull(),
    finalResult: jsonb('final_result').$type<Record<string, { value: number | string; unit: string }>>().notNull(),
    explanation: text('explanation'),
    provenanceHash: varchar('provenance_hash', { length: 128 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index('idx_calculations_formula_model').on(table.formulaOrModelId),
    index('idx_calculations_user').on(table.userId),
    index('idx_calculations_project').on(table.projectId),
    index('idx_calculations_hash').on(table.provenanceHash)
  ]
);
