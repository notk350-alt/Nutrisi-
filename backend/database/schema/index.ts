/**
 * NutriBodySim — Complete PostgreSQL Drizzle ORM Schema
 * Milestone: MVS-B2.5E.1B.4
 *
 * Barrel export for all 45 tables (32 domain tables + 13 junction tables)
 * and TypeScript type inference definitions.
 */

// 1. Scientific Registry & Assembly (19 tables)
export * from './scientific';

// 2. Identity, Authentication & Governance (3 tables)
export * from './identity';

// 3. Collaboration, Teams & Projects (4 tables)
export * from './collaboration';

// 4. Academic Materials, Collections & Study Annotations (8 tables)
export * from './materials';

// 5. Datasets, Analyses, Notebooks & Experiments (8 tables)
export * from './research';

// 6. Provenance, Audit Trail & Scientific Calculations (3 tables)
export * from './audit';

// Inferred TypeScript Model Types
import type { InferSelectModel, InferInsertModel } from 'drizzle-orm';
import * as scientificSchema from './scientific';
import * as identitySchema from './identity';
import * as collaborationSchema from './collaboration';
import * as materialsSchema from './materials';
import * as researchSchema from './research';
import * as auditSchema from './audit';

export type UserSelect = InferSelectModel<typeof identitySchema.users>;
export type UserInsert = InferInsertModel<typeof identitySchema.users>;

export type ProjectSelect = InferSelectModel<typeof collaborationSchema.projects>;
export type ProjectInsert = InferInsertModel<typeof collaborationSchema.projects>;

export type ScientificUnitSelect = InferSelectModel<typeof scientificSchema.scientificUnits>;
export type ScientificFormulaSelect = InferSelectModel<typeof scientificSchema.scientificFormulas>;
export type ScientificModelSelect = InferSelectModel<typeof scientificSchema.scientificModels>;

export type DatasetSelect = InferSelectModel<typeof researchSchema.datasets>;
export type DatasetVersionSelect = InferSelectModel<typeof researchSchema.datasetVersions>;
export type ExperimentSelect = InferSelectModel<typeof researchSchema.experiments>;

export type AuditLogSelect = InferSelectModel<typeof auditSchema.auditLogs>;
export type ProvenanceRecordSelect = InferSelectModel<typeof auditSchema.provenanceRecords>;

/**
 * Manifest dictionary of all 45 tables for schema validation and migration auditing
 */
export const schemaTableManifest = {
  // Scientific Registry & Assembly (19)
  scientificUnits: scientificSchema.scientificUnits,
  scientificReferences: scientificSchema.scientificReferences,
  scientificVariables: scientificSchema.scientificVariables,
  scientificParameters: scientificSchema.scientificParameters,
  scientificParameterReferences: scientificSchema.scientificParameterReferences,
  scientificFormulas: scientificSchema.scientificFormulas,
  scientificFormulaParameters: scientificSchema.scientificFormulaParameters,
  scientificFormulaReferences: scientificSchema.scientificFormulaReferences,
  scientificAlgorithms: scientificSchema.scientificAlgorithms,
  scientificAlgorithmParameters: scientificSchema.scientificAlgorithmParameters,
  scientificAlgorithmReferences: scientificSchema.scientificAlgorithmReferences,
  scientificModels: scientificSchema.scientificModels,
  scientificModelVariables: scientificSchema.scientificModelVariables,
  scientificModelFormulas: scientificSchema.scientificModelFormulas,
  scientificModelAlgorithms: scientificSchema.scientificModelAlgorithms,
  scientificModelParameters: scientificSchema.scientificModelParameters,
  scientificModelReferences: scientificSchema.scientificModelReferences,
  scientificInterpretationRules: scientificSchema.scientificInterpretationRules,
  scientificInterpretationRuleReferences: scientificSchema.scientificInterpretationRuleReferences,

  // Identity & Governance (3)
  users: identitySchema.users,
  externalIdentities: identitySchema.externalIdentities,
  roleRequests: identitySchema.roleRequests,

  // Collaboration (4)
  teams: collaborationSchema.teams,
  teamMembers: collaborationSchema.teamMembers,
  projects: collaborationSchema.projects,
  projectMembers: collaborationSchema.projectMembers,

  // Materials & Annotations (8)
  materials: materialsSchema.materials,
  materialProjects: materialsSchema.materialProjects,
  materialCollections: materialsSchema.materialCollections,
  collectionMaterials: materialsSchema.collectionMaterials,
  readingProgress: materialsSchema.readingProgress,
  bookmarks: materialsSchema.bookmarks,
  highlights: materialsSchema.highlights,
  notes: materialsSchema.notes,

  // Research, Datasets & Experiments (8)
  datasets: researchSchema.datasets,
  datasetVersions: researchSchema.datasetVersions,
  statisticsAnalyses: researchSchema.statisticsAnalyses,
  charts: researchSchema.charts,
  notebooks: researchSchema.notebooks,
  notebookCells: researchSchema.notebookCells,
  codeExecutions: researchSchema.codeExecutions,
  experiments: researchSchema.experiments,

  // Audit & Calculations (3)
  provenanceRecords: auditSchema.provenanceRecords,
  auditLogs: auditSchema.auditLogs,
  scientificCalculations: auditSchema.scientificCalculations
} as const;

export const TOTAL_SCHEMA_TABLE_COUNT = Object.keys(schemaTableManifest).length;
