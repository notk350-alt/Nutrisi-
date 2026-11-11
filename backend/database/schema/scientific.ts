/**
 * NutriBodySim — Scientific Registry & Computational Engine Drizzle Schema
 * Milestone: MVS-B2.5E.1B.4
 * References: docs/architecture/database/E1B3_POSTGRESQL_SCHEMA.sql
 *
 * Covers 19 tables:
 * - 8 Domain Tables: scientific_units, scientific_references, scientific_variables,
 *   scientific_parameters, scientific_formulas, scientific_algorithms,
 *   scientific_models, scientific_interpretation_rules
 * - 11 Junction Tables: parameter_references, formula_parameters, formula_references,
 *   algorithm_parameters, algorithm_references, model_variables, model_formulas,
 *   model_algorithms, model_parameters, model_references, interpretation_rule_references
 */

import {
  pgTable,
  varchar,
  text,
  integer,
  doublePrecision,
  boolean,
  timestamp,
  jsonb,
  primaryKey,
  index,
  check
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type {
  ASTNode,
  FormulaInputSpec,
  FormulaOutputSpec,
  AlgorithmStep,
  AlgorithmFallbackRoute,
  InterpretationThreshold,
  ModelStateVariable,
  ModelTimeConfig,
  ModelTransitionDefinition,
  DataType,
  RegistryStatus
} from '../../../scientific';

// ============================================================================
// 1. Scientific Units of Measurement (Baseline: 33 records)
// ============================================================================
export const scientificUnits = pgTable(
  'scientific_units',
  {
    unitId: varchar('unit_id', { length: 64 }).primaryKey(),
    symbol: varchar('symbol', { length: 32 }).notNull().unique(),
    name: varchar('name', { length: 128 }).notNull(),
    measurementType: varchar('measurement_type', { length: 64 }).notNull(),
    baseUnit: varchar('base_unit', { length: 32 }).notNull(),
    toBaseMultiplier: doublePrecision('to_base_multiplier').notNull(),
    toBaseOffset: doublePrecision('to_base_offset').notNull().default(0.0),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index('idx_units_measurement_type').on(table.measurementType),
    index('idx_units_symbol').on(table.symbol)
  ]
);

// ============================================================================
// 2. Scientific Literature References & Citations (Baseline: 2 records)
// ============================================================================
export const scientificReferences = pgTable(
  'scientific_references',
  {
    referenceId: varchar('reference_id', { length: 64 }).primaryKey(),
    title: text('title').notNull(),
    authors: jsonb('authors').$type<string[]>().notNull(),
    year: integer('year').notNull(),
    journalOrPublisher: text('journal_or_publisher').notNull(),
    doi: varchar('doi', { length: 128 }),
    citationKey: varchar('citation_key', { length: 64 }).unique(),
    abstract: text('abstract'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    check('scientific_references_year_check', sql`${table.year} >= 1800 AND ${table.year} <= 2100`),
    index('idx_scientific_references_year').on(table.year),
    index('idx_scientific_references_citation_key').on(table.citationKey)
  ]
);

// ============================================================================
// 3. Scientific Variables (Physiological Registry) (Baseline: 6 records)
// ============================================================================
export const scientificVariables = pgTable(
  'scientific_variables',
  {
    variableId: varchar('variable_id', { length: 64 }).primaryKey(),
    name: varchar('name', { length: 128 }).notNull(),
    label: varchar('label', { length: 128 }).notNull(),
    definition: text('definition'),
    datatype: varchar('datatype', { length: 32 }).$type<DataType>().notNull(),
    unit: varchar('unit', { length: 32 })
      .notNull()
      .references(() => scientificUnits.symbol, { onDelete: 'restrict' }),
    measurementType: varchar('measurement_type', { length: 64 }).notNull(),
    allowedRange: jsonb('allowed_range').$type<{
      min?: number;
      max?: number;
      warning_min?: number;
      warning_max?: number;
    }>(),
    population: varchar('population', { length: 128 }),
    sourceReference: varchar('source_reference', { length: 64 }).references(
      () => scientificReferences.referenceId,
      { onDelete: 'set null' }
    ),
    version: varchar('version', { length: 32 }).notNull().default('1.0.0'),
    status: varchar('status', { length: 32 }).$type<RegistryStatus>().notNull().default('EXPERIMENTAL'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    check(
      'scientific_variables_datatype_check',
      sql`${table.datatype} IN ('number', 'integer', 'boolean', 'string', 'vector', 'matrix')`
    ),
    check(
      'scientific_variables_status_check',
      sql`${table.status} IN ('DRAFT', 'UNDER_REVIEW', 'VALIDATED', 'VALIDATION', 'VERIFIED', 'EXPERIMENTAL', 'DEPRECATED')`
    ),
    index('idx_variables_measurement_type').on(table.measurementType),
    index('idx_variables_status').on(table.status)
  ]
);

// ============================================================================
// 4. Scientific Parameters (Baseline: 4 records)
// ============================================================================
export const scientificParameters = pgTable(
  'scientific_parameters',
  {
    parameterId: varchar('parameter_id', { length: 64 }).primaryKey(),
    name: varchar('name', { length: 128 }).notNull(),
    description: text('description'),
    value: jsonb('value').notNull(), // scalar number | string | boolean | number[]
    unit: varchar('unit', { length: 32 })
      .notNull()
      .references(() => scientificUnits.symbol, { onDelete: 'restrict' }),
    validRange: jsonb('valid_range').$type<{ min?: number; max?: number }>(),
    version: varchar('version', { length: 32 }).notNull().default('1.0.0'),
    status: varchar('status', { length: 32 }).$type<RegistryStatus>().notNull().default('EXPERIMENTAL'),
    isConstant: boolean('is_constant').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    check(
      'scientific_parameters_status_check',
      sql`${table.status} IN ('DRAFT', 'UNDER_REVIEW', 'VALIDATED', 'VALIDATION', 'VERIFIED', 'EXPERIMENTAL', 'DEPRECATED')`
    ),
    index('idx_parameters_status').on(table.status)
  ]
);

// Junction: Parameter to References (M:N)
export const scientificParameterReferences = pgTable(
  'scientific_parameter_references',
  {
    parameterId: varchar('parameter_id', { length: 64 })
      .notNull()
      .references(() => scientificParameters.parameterId, { onDelete: 'cascade' }),
    referenceId: varchar('reference_id', { length: 64 })
      .notNull()
      .references(() => scientificReferences.referenceId, { onDelete: 'cascade' })
  },
  (table) => [
    primaryKey({ columns: [table.parameterId, table.referenceId] })
  ]
);

// ============================================================================
// 5. Scientific Mathematical Formulas & AST (Baseline: 5 records)
// ============================================================================
export const scientificFormulas = pgTable(
  'scientific_formulas',
  {
    formulaId: varchar('formula_id', { length: 64 }).primaryKey(),
    moduleId: varchar('module_id', { length: 64 }),
    moduleType: varchar('module_type', { length: 64 }).default('FORMULA'),
    name: varchar('name', { length: 128 }).notNull(),
    description: text('description'),
    version: varchar('version', { length: 32 }).notNull().default('1.0.0'),
    status: varchar('status', { length: 32 }).$type<RegistryStatus>().notNull().default('EXPERIMENTAL'),
    inputs: jsonb('inputs').$type<FormulaInputSpec[]>().notNull().default([]),
    outputs: jsonb('outputs').$type<FormulaOutputSpec[]>().notNull().default([]),
    expressionAst: jsonb('expression_ast').$type<ASTNode>().notNull(),
    expressionString: text('expression_string').notNull(),
    assumptions: jsonb('assumptions').$type<string[]>().notNull().default([]),
    limitations: jsonb('limitations').$type<string[]>().notNull().default([]),
    validationStatus: varchar('validation_status', { length: 64 }).notNull().default('UNVERIFIED'),
    createdBy: varchar('created_by', { length: 64 }).notNull().default('SYSTEM'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    check(
      'scientific_formulas_status_check',
      sql`${table.status} IN ('DRAFT', 'UNDER_REVIEW', 'VALIDATED', 'VALIDATION', 'VERIFIED', 'EXPERIMENTAL', 'DEPRECATED')`
    ),
    index('idx_formulas_status').on(table.status),
    index('idx_formulas_validation_status').on(table.validationStatus)
  ]
);

// Junction: Formula to Parameters (M:N)
export const scientificFormulaParameters = pgTable(
  'scientific_formula_parameters',
  {
    formulaId: varchar('formula_id', { length: 64 })
      .notNull()
      .references(() => scientificFormulas.formulaId, { onDelete: 'cascade' }),
    parameterId: varchar('parameter_id', { length: 64 })
      .notNull()
      .references(() => scientificParameters.parameterId, { onDelete: 'cascade' })
  },
  (table) => [
    primaryKey({ columns: [table.formulaId, table.parameterId] })
  ]
);

// Junction: Formula to References (M:N)
export const scientificFormulaReferences = pgTable(
  'scientific_formula_references',
  {
    formulaId: varchar('formula_id', { length: 64 })
      .notNull()
      .references(() => scientificFormulas.formulaId, { onDelete: 'cascade' }),
    referenceId: varchar('reference_id', { length: 64 })
      .notNull()
      .references(() => scientificReferences.referenceId, { onDelete: 'cascade' })
  },
  (table) => [
    primaryKey({ columns: [table.formulaId, table.referenceId] })
  ]
);

// ============================================================================
// 6. Scientific Computational Algorithms (Baseline: 0 records, typed schema)
// ============================================================================
export const scientificAlgorithms = pgTable(
  'scientific_algorithms',
  {
    algorithmId: varchar('algorithm_id', { length: 64 }).primaryKey(),
    moduleId: varchar('module_id', { length: 64 }),
    moduleType: varchar('module_type', { length: 64 }).default('ALGORITHM'),
    name: varchar('name', { length: 128 }).notNull(),
    description: text('description'),
    version: varchar('version', { length: 32 }).notNull().default('1.0.0'),
    status: varchar('status', { length: 32 }).$type<RegistryStatus>().notNull().default('EXPERIMENTAL'),
    inputs: jsonb('inputs').$type<FormulaInputSpec[]>().notNull().default([]),
    outputs: jsonb('outputs').$type<FormulaOutputSpec[]>().notNull().default([]),
    entryStepId: varchar('entry_step_id', { length: 64 }),
    steps: jsonb('steps').$type<AlgorithmStep[]>().notNull().default([]),
    fallbackRoutes: jsonb('fallback_routes').$type<AlgorithmFallbackRoute[]>().default([]),
    assumptions: jsonb('assumptions').$type<string[]>().default([]),
    limitations: jsonb('limitations').$type<string[]>().default([]),
    validationStatus: varchar('validation_status', { length: 64 }),
    createdBy: varchar('created_by', { length: 64 }).notNull().default('SYSTEM'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    check(
      'scientific_algorithms_status_check',
      sql`${table.status} IN ('DRAFT', 'UNDER_REVIEW', 'VALIDATED', 'VALIDATION', 'VERIFIED', 'EXPERIMENTAL', 'DEPRECATED')`
    )
  ]
);

// Junction: Algorithm to Parameters (M:N)
export const scientificAlgorithmParameters = pgTable(
  'scientific_algorithm_parameters',
  {
    algorithmId: varchar('algorithm_id', { length: 64 })
      .notNull()
      .references(() => scientificAlgorithms.algorithmId, { onDelete: 'cascade' }),
    parameterId: varchar('parameter_id', { length: 64 })
      .notNull()
      .references(() => scientificParameters.parameterId, { onDelete: 'cascade' })
  },
  (table) => [
    primaryKey({ columns: [table.algorithmId, table.parameterId] })
  ]
);

// Junction: Algorithm to References (M:N)
export const scientificAlgorithmReferences = pgTable(
  'scientific_algorithm_references',
  {
    algorithmId: varchar('algorithm_id', { length: 64 })
      .notNull()
      .references(() => scientificAlgorithms.algorithmId, { onDelete: 'cascade' }),
    referenceId: varchar('reference_id', { length: 64 })
      .notNull()
      .references(() => scientificReferences.referenceId, { onDelete: 'cascade' })
  },
  (table) => [
    primaryKey({ columns: [table.algorithmId, table.referenceId] })
  ]
);

// ============================================================================
// 7. Scientific Composite Models (Baseline: 1 record)
// ============================================================================
export const scientificModels = pgTable(
  'scientific_models',
  {
    modelId: varchar('model_id', { length: 64 }).primaryKey(),
    moduleId: varchar('module_id', { length: 64 }),
    moduleType: varchar('module_type', { length: 64 }).default('MODEL'),
    name: varchar('name', { length: 128 }).notNull(),
    description: text('description'),
    version: varchar('version', { length: 32 }).notNull().default('1.0.0'),
    status: varchar('status', { length: 32 }).$type<RegistryStatus>().notNull().default('EXPERIMENTAL'),
    isVerified: boolean('is_verified').notNull().default(false),
    parentModelId: varchar('parent_model_id', { length: 64 }),
    assumptions: jsonb('assumptions').$type<string[]>().notNull().default([]),
    validationCriteria: text('validation_criteria'),
    changedNotes: text('changed_notes'),
    inputs: jsonb('inputs').$type<FormulaInputSpec[]>().default([]),
    outputs: jsonb('outputs').$type<FormulaOutputSpec[]>().default([]),
    states: jsonb('states').$type<ModelStateVariable[]>().default([]),
    timeConfig: jsonb('time_config').$type<ModelTimeConfig>().default(sql`'{}'::jsonb`),
    transitions: jsonb('transitions').$type<ModelTransitionDefinition[]>().default([]),
    createdBy: varchar('created_by', { length: 64 }).notNull().default('SYSTEM'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    check(
      'scientific_models_status_check',
      sql`${table.status} IN ('DRAFT', 'UNDER_REVIEW', 'VALIDATED', 'VALIDATION', 'VERIFIED', 'EXPERIMENTAL', 'DEPRECATED')`
    ),
    index('idx_models_status').on(table.status)
  ]
);

// Junction: Model to Variables (M:N)
export const scientificModelVariables = pgTable(
  'scientific_model_variables',
  {
    modelId: varchar('model_id', { length: 64 })
      .notNull()
      .references(() => scientificModels.modelId, { onDelete: 'cascade' }),
    variableId: varchar('variable_id', { length: 64 })
      .notNull()
      .references(() => scientificVariables.variableId, { onDelete: 'cascade' })
  },
  (table) => [
    primaryKey({ columns: [table.modelId, table.variableId] })
  ]
);

// Junction: Model to Formulas (M:N)
export const scientificModelFormulas = pgTable(
  'scientific_model_formulas',
  {
    modelId: varchar('model_id', { length: 64 })
      .notNull()
      .references(() => scientificModels.modelId, { onDelete: 'cascade' }),
    formulaId: varchar('formula_id', { length: 64 })
      .notNull()
      .references(() => scientificFormulas.formulaId, { onDelete: 'cascade' })
  },
  (table) => [
    primaryKey({ columns: [table.modelId, table.formulaId] })
  ]
);

// Junction: Model to Algorithms (M:N)
export const scientificModelAlgorithms = pgTable(
  'scientific_model_algorithms',
  {
    modelId: varchar('model_id', { length: 64 })
      .notNull()
      .references(() => scientificModels.modelId, { onDelete: 'cascade' }),
    algorithmId: varchar('algorithm_id', { length: 64 })
      .notNull()
      .references(() => scientificAlgorithms.algorithmId, { onDelete: 'cascade' })
  },
  (table) => [
    primaryKey({ columns: [table.modelId, table.algorithmId] })
  ]
);

// Junction: Model to Parameters (M:N)
export const scientificModelParameters = pgTable(
  'scientific_model_parameters',
  {
    modelId: varchar('model_id', { length: 64 })
      .notNull()
      .references(() => scientificModels.modelId, { onDelete: 'cascade' }),
    parameterId: varchar('parameter_id', { length: 64 })
      .notNull()
      .references(() => scientificParameters.parameterId, { onDelete: 'cascade' })
  },
  (table) => [
    primaryKey({ columns: [table.modelId, table.parameterId] })
  ]
);

// Junction: Model to References (M:N)
export const scientificModelReferences = pgTable(
  'scientific_model_references',
  {
    modelId: varchar('model_id', { length: 64 })
      .notNull()
      .references(() => scientificModels.modelId, { onDelete: 'cascade' }),
    referenceId: varchar('reference_id', { length: 64 })
      .notNull()
      .references(() => scientificReferences.referenceId, { onDelete: 'cascade' })
  },
  (table) => [
    primaryKey({ columns: [table.modelId, table.referenceId] })
  ]
);

// ============================================================================
// 8. Clinical Interpretation Rules (Baseline: 2 records)
// ============================================================================
export const scientificInterpretationRules = pgTable(
  'scientific_interpretation_rules',
  {
    ruleId: varchar('rule_id', { length: 64 }).primaryKey(),
    moduleId: varchar('module_id', { length: 64 }).notNull(),
    moduleType: varchar('module_type', { length: 64 }).notNull().default('INTERPRETATION'),
    name: varchar('name', { length: 128 }).notNull(),
    description: text('description'),
    version: varchar('version', { length: 32 }).notNull().default('1.0.0'),
    status: varchar('status', { length: 32 }).$type<RegistryStatus>().notNull().default('VERIFIED'),
    targetVariableOrMetric: varchar('target_variable_or_metric', { length: 64 }).notNull(),
    unit: varchar('unit', { length: 32 }).notNull(),
    population: varchar('population', { length: 128 }),
    thresholds: jsonb('thresholds').$type<InterpretationThreshold[]>().notNull(),
    createdBy: varchar('created_by', { length: 64 }).notNull().default('SYSTEM'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    check(
      'scientific_interpretation_rules_status_check',
      sql`${table.status} IN ('DRAFT', 'UNDER_REVIEW', 'VALIDATED', 'VALIDATION', 'VERIFIED', 'EXPERIMENTAL', 'DEPRECATED')`
    ),
    index('idx_interpretation_rules_target').on(table.targetVariableOrMetric)
  ]
);

// Junction: Interpretation Rule to References (M:N)
export const scientificInterpretationRuleReferences = pgTable(
  'scientific_interpretation_rule_references',
  {
    ruleId: varchar('rule_id', { length: 64 })
      .notNull()
      .references(() => scientificInterpretationRules.ruleId, { onDelete: 'cascade' }),
    referenceId: varchar('reference_id', { length: 64 })
      .notNull()
      .references(() => scientificReferences.referenceId, { onDelete: 'cascade' })
  },
  (table) => [
    primaryKey({ columns: [table.ruleId, table.referenceId] })
  ]
);
