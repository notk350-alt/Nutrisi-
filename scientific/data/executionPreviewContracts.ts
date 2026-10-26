/**
 * NutriBodySim — Phase F2.2B: Execution Preview Contracts
 *
 * Strongly typed declarative contracts for deterministic, read-only
 * execution preview and governance preflight validation.
 *
 * Invariants:
 * 1. Zero statistical calculation or dynamic code evaluation (eval / new Function = 0).
 * 2. Status is strictly 'READY' or 'BLOCKED' (no EXECUTING, COMPLETED, FAILED, or RESULT states).
 * 3. Deeply immutable snapshot (no mutation of project, plan, dataset, or variables).
 * 4. Deterministic SHA-256 provenance digest.
 * 5. scientific_validity = 'NOT_ESTABLISHED' strictly preserved.
 */

import { ResearchProject, PlannedAnalysis } from './researchProjectContracts';
import { AnalysisExecutionRequest } from './analysisExecutionContracts';
import { DatasetVersionStore } from './datasetVersion';
import { DataArtifactStore } from './dataStatePipeline';
import { VariableStore } from './variableRegistry';
import { VariableMappingStore } from './variableMapping';
import { ParameterSet } from '../types';

export type ExecutionPreviewReadinessStatus = 'READY' | 'BLOCKED';

export type ExecutionPreviewErrorCode =
  | 'PROJECT_NOT_FOUND'
  | 'PROJECT_VERSION_NOT_FOUND'
  | 'PROJECT_FINALIZED'
  | 'PROJECT_ARCHIVED'
  | 'ANALYSIS_NOT_FOUND'
  | 'ANALYSIS_NOT_PLANNED'
  | 'ANALYSIS_VERSION_MISMATCH'
  | 'OBJECTIVE_NOT_FOUND'
  | 'HYPOTHESIS_NOT_FOUND'
  | 'DATASET_BINDING_MISMATCH'
  | 'ARTIFACT_BINDING_MISMATCH'
  | 'CHECKSUM_MISMATCH'
  | 'LINEAGE_INVALID'
  | 'VARIABLE_NOT_FOUND'
  | 'VARIABLE_MAPPING_INVALID'
  | 'VARIABLE_SCHEMA_MISMATCH'
  | 'MODULE_NOT_FOUND'
  | 'MODULE_VERSION_NOT_FOUND'
  | 'INVALID_CONFIGURATION'
  | 'INVALID_ALPHA'
  | 'INVALID_CONFIDENCE_LEVEL'
  | 'PARAMETER_VERSION_NOT_FOUND';

export class ScientificExecutionPreviewError extends Error {
  public readonly code: ExecutionPreviewErrorCode;
  public readonly details?: unknown;

  constructor(code: ExecutionPreviewErrorCode, message: string, details?: unknown) {
    super(`[${code}] ${message}`);
    this.name = 'ScientificExecutionPreviewError';
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, ScientificExecutionPreviewError.prototype);
  }
}

/**
 * Immutable ExecutionPreview Contract (Phase F2.2B).
 * Snapshot representing exactly what would be executed if proceeding downstream.
 */
export interface ExecutionPreview {
  readonly preview_id: string;
  readonly execution_request_id?: string;
  readonly project_id: string;
  readonly project_version: string;
  readonly analysis_id: string;
  readonly analysis_plan_version: string;
  readonly analysis_type: string;
  readonly objective_id: string;
  readonly hypothesis_id?: string;
  readonly dataset_version_id: string;
  readonly data_artifact_id: string;
  readonly source_artifact_checksum: string;
  readonly input_variable_ids: string[];
  readonly grouping_variable_ids?: string[];
  readonly pairing_variable_ids?: string[];
  readonly alpha?: number;
  readonly confidence_level?: number;
  readonly configuration: Record<string, unknown>;
  readonly resolved_module_id: string;
  readonly resolved_module_version: string;
  readonly readiness_status: ExecutionPreviewReadinessStatus;
  readonly errors: string[];
  readonly warnings: string[];
  readonly provenance_hash: string;
  readonly scientific_validity: 'NOT_ESTABLISHED';
  readonly created_at: string;
  readonly resolved_parameter_set_id?: string;
}

/**
 * Input options for generating an ExecutionPreview.
 */
export interface ExecutionPreviewOptions {
  project?: ResearchProject;
  project_id?: string;
  analysis_id?: string;
  analysis_plan?: PlannedAnalysis;
  project_version?: string;
  analysis_plan_version?: string;
  execution_request?: AnalysisExecutionRequest;
  dataset_version_store?: DatasetVersionStore;
  data_artifact_store?: DataArtifactStore;
  variable_store?: VariableStore;
  variable_mapping_store?: VariableMappingStore;
  available_parameter_sets?: ParameterSet[];
  strict_variable_mapping?: boolean;
}
