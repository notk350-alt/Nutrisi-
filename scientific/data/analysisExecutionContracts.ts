/**
 * NutriBodySim — Phase F2.2A: Analysis Execution Request Contracts
 *
 * Strongly typed declarative contracts for bridging ResearchProject PlannedAnalysis
 * to an execution-ready declarative request.
 *
 * Strict Architectural Guarantees:
 * 1. Zero dynamic code execution (no eval, no new Function).
 * 2. Strictly declarative: status is READY or BLOCKED only.
 * 3. Never calculates statistics or runs D9–D13 engines.
 * 4. Deeply immutable and deterministic.
 * 5. Strictly preserves scientific_validity = 'NOT_ESTABLISHED'.
 */

export type ExecutionRequestStatus = 'READY' | 'BLOCKED';

export type AnalysisExecutionErrorCode =
  | 'EXECUTION_PROJECT_NOT_FOUND'
  | 'EXECUTION_PROJECT_VERSION_MISMATCH'
  | 'EXECUTION_ANALYSIS_NOT_FOUND'
  | 'EXECUTION_ANALYSIS_NOT_PLANNED'
  | 'EXECUTION_DATASET_NOT_FOUND'
  | 'EXECUTION_ARTIFACT_NOT_FOUND'
  | 'EXECUTION_ARTIFACT_VERSION_MISMATCH'
  | 'EXECUTION_CHECKSUM_MISMATCH'
  | 'EXECUTION_INVALID_LINEAGE'
  | 'EXECUTION_OBJECTIVE_NOT_FOUND'
  | 'EXECUTION_HYPOTHESIS_NOT_FOUND'
  | 'EXECUTION_VARIABLE_NOT_FOUND'
  | 'EXECUTION_INVALID_ANALYSIS_TYPE'
  | 'EXECUTION_MODULE_NOT_FOUND'
  | 'EXECUTION_INVALID_ALPHA'
  | 'EXECUTION_INVALID_CONFIDENCE_LEVEL'
  | 'EXECUTION_CONFIGURATION_INVALID'
  | 'EXECUTION_IMMUTABLE_PROJECT'
  | 'EXECUTION_REQUIRED_INPUT_MISSING';

export class ScientificExecutionBridgeError extends Error {
  public readonly code: AnalysisExecutionErrorCode;
  public readonly details?: unknown;

  constructor(code: AnalysisExecutionErrorCode, message: string, details?: unknown) {
    super(`[${code}] ${message}`);
    this.name = 'ScientificExecutionBridgeError';
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, ScientificExecutionBridgeError.prototype);
  }
}

export interface AuthoritativeModuleIdentity {
  module_id: string;
  module_name: string;
  module_version: string;
  engine_version: string;
}

/**
 * Authoritative module identity resolution registry for D9–D13 modules.
 * Deterministically maps declarative analysis types to exact scientific module identities.
 */
export const ANALYSIS_MODULE_REGISTRY: Readonly<Record<string, AuthoritativeModuleIdentity>> = Object.freeze({
  DESCRIPTIVE: Object.freeze({
    module_id: 'D9_DESCRIPTIVE_STATISTICS',
    module_name: 'D9 Descriptive Statistics & Exploratory Engine',
    module_version: '1.0.0',
    engine_version: '1.0.0'
  }),
  INFERENTIAL: Object.freeze({
    module_id: 'D10_INFERENTIAL_STATISTICS',
    module_name: 'D10 Inferential Statistics & Hypothesis Testing Engine',
    module_version: '1.0.0',
    engine_version: '1.0.0'
  }),
  REGRESSION: Object.freeze({
    module_id: 'D11_REGRESSION_MODELING',
    module_name: 'D11 Regression & Predictive Modeling Engine',
    module_version: '1.0.0',
    engine_version: '1.0.0'
  }),
  POWER: Object.freeze({
    module_id: 'D12_POWER_ANALYSIS',
    module_name: 'D12 Statistical Power & Sample Size Engine',
    module_version: '1.0.0',
    engine_version: '1.0.0'
  }),
  POWER_ANALYSIS: Object.freeze({
    module_id: 'D12_POWER_ANALYSIS',
    module_name: 'D12 Statistical Power & Sample Size Engine',
    module_version: '1.0.0',
    engine_version: '1.0.0'
  }),
  NONPARAMETRIC: Object.freeze({
    module_id: 'D13_NON_PARAMETRIC_STATISTICS',
    module_name: 'D13 Non-Parametric & Distribution-Free Statistics Engine',
    module_version: '1.0.0',
    engine_version: '1.0.0'
  }),
  NON_PARAMETRIC: Object.freeze({
    module_id: 'D13_NON_PARAMETRIC_STATISTICS',
    module_name: 'D13 Non-Parametric & Distribution-Free Statistics Engine',
    module_version: '1.0.0',
    engine_version: '1.0.0'
  })
});

/**
 * Declarative Analysis Execution Request contract.
 * Represents an immutable, preflight-validated request ready for downstream execution.
 */
export interface AnalysisExecutionRequest {
  execution_request_id: string;
  project_id: string;
  project_version: string;
  analysis_id: string;
  analysis_plan_version: string;
  dataset_version_id: string;
  data_artifact_id: string;
  source_artifact_checksum: string;
  analysis_type: string;
  objective_id: string;
  hypothesis_id?: string;
  input_variable_ids: string[];
  grouping_variable_ids?: string[];
  pairing_variable_ids?: string[];
  alpha?: number;
  confidence_level?: number;
  configuration: Record<string, unknown>;
  requested_module_id: string;
  requested_module_version: string;
  status: ExecutionRequestStatus;
  created_at: string;
  provenance_hash: string;
  scientific_validity: 'NOT_ESTABLISHED';
}

/**
 * Pre-flight validation result output.
 */
export interface PreflightResult {
  status: ExecutionRequestStatus;
  execution_request_id?: string;
  errors: string[];
  warnings: string[];
  resolved_module_id?: string;
  resolved_module_version?: string;
  dataset_version_id?: string;
  data_artifact_id?: string;
  source_artifact_checksum?: string;
  provenance_hash?: string;
  scientific_validity: 'NOT_ESTABLISHED';
  request?: AnalysisExecutionRequest;
}
