/**
 * NutriBodySim — Datasets, Statistical Analyses, Notebooks & Experiments Drizzle Schema
 * Milestone: MVS-B2.5E.1B.4
 * References: docs/architecture/database/E1B3_POSTGRESQL_SCHEMA.sql
 *
 * Covers 8 tables:
 * - datasets
 * - dataset_versions
 * - statistics_analyses
 * - charts
 * - notebooks
 * - notebook_cells
 * - code_executions
 * - experiments
 *
 * Pending Decision 1: experiments.experimental_model_id retains varchar(64).notNull()
 * without foreign key to scientific_models, as it holds clone variant tags ('MODEL_DEMO_ANTHROPOMETRY_V1_CLONE').
 */

import {
  pgTable,
  varchar,
  text,
  integer,
  timestamp,
  jsonb,
  unique,
  index
} from 'drizzle-orm/pg-core';
import { users } from './identity';
import { projects } from './collaboration';
import { scientificModels } from './scientific';
import type {
  DatasetColumnMeta,
  DatasetValidationReport
} from '../types';

export type AnalysisType =
  | 'DESCRIPTIVE'
  | 'TWO_GROUP_COMPARISON'
  | 'MULTIPLE_GROUP_ANOVA'
  | 'CORRELATION'
  | 'LINEAR_REGRESSION'
  | 'DIAGNOSTICS';

export type ChartType = 'LINE' | 'BAR' | 'HISTOGRAM' | 'SCATTER' | 'BOX_PLOT';

export type ExperimentStatus = 'DRAFT' | 'RUNNING' | 'COMPLETED' | 'FAILED';

// ============================================================================
// 22. Clinical Datasets (Baseline: 1 record)
// ============================================================================
export const datasets = pgTable(
  'datasets',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    projectId: varchar('project_id', { length: 64 })
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 128 }).notNull(),
    description: text('description'),
    sourceFile: varchar('source_file', { length: 255 }).notNull(),
    uploadedBy: varchar('uploaded_by', { length: 64 })
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    currentVersion: varchar('current_version', { length: 32 }).default('v1.0'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index('idx_datasets_project_id').on(table.projectId)
  ]
);

// ============================================================================
// 23. Immutable Dataset Versions (Baseline: 2 records)
// ============================================================================
export const datasetVersions = pgTable(
  'dataset_versions',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    datasetId: varchar('dataset_id', { length: 64 })
      .notNull()
      .references(() => datasets.id, { onDelete: 'cascade' }),
    versionTag: varchar('version_tag', { length: 32 }).notNull(),
    parentVersionTag: varchar('parent_version_tag', { length: 32 }),
    state: varchar('state', { length: 32 }).notNull(), // 'RAW' | 'WORKING_COPY' | 'CLEANED' | 'VALIDATED' | 'ANALYSIS_READY'
    columns: jsonb('columns').$type<DatasetColumnMeta[]>().notNull(),
    data: jsonb('data').$type<Record<string, any>[]>().notNull(),
    validationReport: jsonb('validation_report').$type<DatasetValidationReport>().notNull(),
    transformationApplied: text('transformation_applied'),
    createdBy: varchar('created_by', { length: 64 })
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    unique('uq_dataset_versions_dataset_tag').on(table.datasetId, table.versionTag),
    index('idx_dataset_versions_dataset').on(table.datasetId),
    index('idx_dataset_versions_state').on(table.state)
  ]
);

// ============================================================================
// 24. Inferential & Statistical Analyses (Baseline: 1 record)
// ============================================================================
export const statisticsAnalyses = pgTable(
  'statistics_analyses',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    projectId: varchar('project_id', { length: 64 })
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    datasetVersionId: varchar('dataset_version_id', { length: 64 })
      .notNull()
      .references(() => datasetVersions.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 255 }).notNull(),
    analysisType: varchar('analysis_type', { length: 64 }).$type<AnalysisType>().notNull(),
    targetColumns: jsonb('target_columns').$type<string[]>().notNull(),
    groupingColumn: varchar('grouping_column', { length: 64 }),
    methodJustification: text('method_justification').notNull(),
    results: jsonb('results').$type<Record<string, any>>().notNull(),
    provenanceHash: varchar('provenance_hash', { length: 128 }).notNull(),
    createdBy: varchar('created_by', { length: 64 })
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index('idx_statistics_analyses_project').on(table.projectId),
    index('idx_statistics_analyses_dataset_ver').on(table.datasetVersionId)
  ]
);

// ============================================================================
// 25. Visualization Charts (Baseline: 1 record)
// ============================================================================
export const charts = pgTable(
  'charts',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    projectId: varchar('project_id', { length: 64 })
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    datasetVersionId: varchar('dataset_version_id', { length: 64 }).references(
      () => datasetVersions.id,
      { onDelete: 'set null' }
    ),
    analysisId: varchar('analysis_id', { length: 64 }).references(
      () => statisticsAnalyses.id,
      { onDelete: 'set null' }
    ),
    title: varchar('title', { length: 255 }).notNull(),
    chartType: varchar('chart_type', { length: 32 }).$type<ChartType>().notNull(),
    xField: varchar('x_field', { length: 64 }),
    yField: varchar('y_field', { length: 64 }),
    groupBy: varchar('group_by', { length: 64 }),
    config: jsonb('config').$type<Record<string, any>>().notNull().default({}),
    createdBy: varchar('created_by', { length: 64 })
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index('idx_charts_project').on(table.projectId),
    index('idx_charts_analysis').on(table.analysisId)
  ]
);

// ============================================================================
// 26. Computational Research Notebooks (Baseline: 1 record)
// ============================================================================
export const notebooks = pgTable(
  'notebooks',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    projectId: varchar('project_id', { length: 64 })
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 255 }).notNull(),
    description: text('description'),
    createdBy: varchar('created_by', { length: 64 })
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index('idx_notebooks_project').on(table.projectId)
  ]
);

// ============================================================================
// 27. Notebook Cells (Baseline: 5 records)
// ============================================================================
export const notebookCells = pgTable(
  'notebook_cells',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    notebookId: varchar('notebook_id', { length: 64 })
      .notNull()
      .references(() => notebooks.id, { onDelete: 'cascade' }),
    cellType: varchar('cell_type', { length: 32 }).notNull(), // 'TEXT' | 'CODE' | 'ANALYSIS_ATTACHMENT' | 'CHART_ATTACHMENT'
    orderIndex: integer('order_index').notNull(),
    title: varchar('title', { length: 255 }),
    content: text('content').notNull()
  },
  (table) => [
    unique('uq_notebook_cells_order').on(table.notebookId, table.orderIndex),
    index('idx_notebook_cells_notebook').on(table.notebookId)
  ]
);

// ============================================================================
// 28. Isolated Code Execution Logs (Baseline: 0 records, typed schema)
// ============================================================================
export const codeExecutions = pgTable(
  'code_executions',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    projectId: varchar('project_id', { length: 64 })
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    language: varchar('language', { length: 32 }).notNull(), // 'PYTHON' | 'R' | 'SQL' | 'JAVASCRIPT'
    code: text('code').notNull(),
    output: text('output').notNull(),
    error: text('error'),
    executionTimeMs: integer('execution_time_ms').notNull(),
    environmentInfo: text('environment_info').notNull(),
    executedBy: varchar('executed_by', { length: 64 })
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index('idx_code_executions_project').on(table.projectId),
    index('idx_code_executions_user').on(table.executedBy)
  ]
);

// ============================================================================
// 29. In Silico Controlled Experiments (Baseline: 1 record)
// ============================================================================
export const experiments = pgTable(
  'experiments',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    projectId: varchar('project_id', { length: 64 })
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 255 }).notNull(),
    description: text('description'),
    baselineModelId: varchar('baseline_model_id', { length: 64 })
      .notNull()
      .references(() => scientificModels.modelId, { onDelete: 'restrict' }),
    // Pending Decision 1: Experimental model ID refers to clone ('MODEL_DEMO_ANTHROPOMETRY_V1_CLONE')
    // No direct FK to scientificModels is placed until formal clone registry schema is adopted.
    experimentalModelId: varchar('experimental_model_id', { length: 64 }).notNull(),
    parameterModifications: jsonb('parameter_modifications').notNull(),
    baselineOutput: jsonb('baseline_output').notNull(),
    experimentalOutput: jsonb('experimental_output').notNull(),
    deltaSummary: text('delta_summary'),
    status: varchar('status', { length: 32 }).$type<ExperimentStatus>().notNull().default('COMPLETED'),
    provenanceHash: varchar('provenance_hash', { length: 128 }).notNull(),
    createdBy: varchar('created_by', { length: 64 })
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index('idx_experiments_project').on(table.projectId),
    index('idx_experiments_baseline_model').on(table.baselineModelId)
  ]
);
