/**
 * Phase D10 — Scientific Data Layer: Inferential Statistics & Hypothesis Testing Contracts
 *
 * Defines explicit, version-pinned request/result contracts for deterministic
 * inferential statistical analysis and hypothesis testing.
 *
 * Strict Separation of Concerns:
 * 1. Mathematical Computation (D10 Engine)
 * 2. Statistical Decision Rules (p_value vs alpha)
 * 3. Scientific Validation (NOT ESTABLISHED)
 * 4. Clinical/Physiological Interpretation (Explicit profiles only)
 */

import { AnalysisFilter, FilterGroup } from './analysisContracts';
import { deepFreeze } from './dataStatePipeline';

export type InferentialTestType =
  | 'ONE_SAMPLE_T_TEST'
  | 'INDEPENDENT_TWO_SAMPLE_T_TEST'
  | 'PAIRED_T_TEST'
  | 'PEARSON_CORRELATION_TEST'
  | 'CHI_SQUARE_INDEPENDENCE';

export type HypothesisType = 'TWO_SIDED' | 'GREATER_THAN' | 'LESS_THAN';

export interface NullHypothesis {
  statement: string;
  value?: number;
}

export interface AlternativeHypothesis {
  type: HypothesisType;
  statement: string;
  value?: number;
}

export type MultipleTestingMethod = 'BONFERRONI' | 'HOLM' | 'BENJAMINI_HOCHBERG';

export interface InferentialConfiguration {
  equal_variance?: boolean;
  paired_key?: string;
  missing_tokens?: string[];
  multiple_testing_method?: MultipleTestingMethod;
  metadata?: Record<string, unknown>;
}

export interface InferentialAnalysisRequest {
  analysis_id: string;
  dataset_version_id: string;
  data_artifact_id: string;
  test_type: InferentialTestType;
  dependent_variable: string;
  independent_variables?: string[];
  paired_variable?: string;
  grouping_variable?: string;
  group_a?: string;
  group_b?: string;
  null_hypothesis: NullHypothesis;
  alternative_hypothesis: AlternativeHypothesis;
  alpha: number;
  confidence_level?: number;
  filters?: AnalysisFilter[];
  filter_group?: FilterGroup;
  configuration?: InferentialConfiguration;
  created_by: string;
  created_at: string;
  engine_version?: string;
}

export type InferentialDecision = 'REJECT_NULL' | 'DO_NOT_REJECT_NULL';

export type InferentialExecutionStatus =
  | 'COMPLETED'
  | 'INSUFFICIENT_DATA'
  | 'ASSUMPTION_NOT_ESTABLISHED'
  | 'INVALID_CONFIGURATION'
  | 'NUMERICAL_ERROR';

export interface EffectSizeResult {
  metric: 'COHENS_D' | 'PEARSON_R' | 'CRAMERS_V';
  value: number | null;
}

export interface ConfidenceIntervalResult {
  confidence_level: number;
  lower_bound: number | null;
  upper_bound: number | null;
  method: string;
}

export interface InferentialAnalysisVariables {
  dependent_variable: string;
  independent_variables?: string[];
  paired_variable?: string;
  grouping_variable?: string;
  group_a?: string;
  group_b?: string;
}

export interface InferentialHypotheses {
  null_hypothesis: NullHypothesis;
  alternative_hypothesis: AlternativeHypothesis;
}

export interface InferentialAnalysisResult {
  analysis_id: string;
  dataset_version_id: string;
  data_artifact_id: string;
  test_type: InferentialTestType;
  variables: InferentialAnalysisVariables;
  hypotheses: InferentialHypotheses;
  alpha: number;
  confidence_level: number;
  sample_information: Record<string, unknown>;
  statistic: number | null;
  degrees_of_freedom: number | null;
  p_value: number | null;
  adjusted_p_value?: number | null;
  effect_size?: EffectSizeResult | null;
  confidence_interval?: ConfidenceIntervalResult | null;
  assumptions: Record<string, unknown>;
  decision: InferentialDecision;
  warnings: string[];
  status: InferentialExecutionStatus;
  scientific_validity: 'NOT_ESTABLISHED';
  engine_version: string;
  provenance_reference: string;
  created_at: string;
  checksum: string;
}

export type InferentialErrorCode =
  | 'INFERENTIAL_DATASET_NOT_FOUND'
  | 'INFERENTIAL_ARTIFACT_NOT_FOUND'
  | 'INFERENTIAL_VERSION_MISMATCH'
  | 'INFERENTIAL_VARIABLE_NOT_FOUND'
  | 'INFERENTIAL_VARIABLE_TYPE_INVALID'
  | 'INFERENTIAL_UNIT_MISMATCH'
  | 'INFERENTIAL_ALPHA_INVALID'
  | 'INFERENTIAL_HYPOTHESIS_INVALID'
  | 'INFERENTIAL_GROUP_INVALID'
  | 'INFERENTIAL_PAIRING_INVALID'
  | 'INFERENTIAL_INSUFFICIENT_DATA'
  | 'INFERENTIAL_ASSUMPTION_UNESTABLISHED'
  | 'INFERENTIAL_NUMERICAL_ERROR'
  | 'INFERENTIAL_EXPECTED_FREQUENCY_INVALID'
  | 'INFERENTIAL_INVALID_CONTRACT';

export class ScientificInferentialAnalysisError extends Error {
  readonly code: InferentialErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: InferentialErrorCode, message: string, details?: Record<string, unknown>) {
    super(`[${code}] ${message}`);
    this.name = 'ScientificInferentialAnalysisError';
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, ScientificInferentialAnalysisError.prototype);
  }
}

/**
 * Validates the schema and structure of an InferentialAnalysisRequest.
 */
export function validateInferentialAnalysisRequest(request: unknown): InferentialAnalysisRequest {
  if (!request || typeof request !== 'object') {
    throw new ScientificInferentialAnalysisError(
      'INFERENTIAL_INVALID_CONTRACT',
      'Inferential analysis request must be a non-null object.'
    );
  }

  const req = request as Record<string, unknown>;

  if (typeof req.analysis_id !== 'string' || !req.analysis_id.trim()) {
    throw new ScientificInferentialAnalysisError(
      'INFERENTIAL_INVALID_CONTRACT',
      'Missing required non-empty string "analysis_id".'
    );
  }

  if (typeof req.dataset_version_id !== 'string' || !req.dataset_version_id.trim()) {
    throw new ScientificInferentialAnalysisError(
      'INFERENTIAL_INVALID_CONTRACT',
      'Missing required non-empty string "dataset_version_id".'
    );
  }

  if (typeof req.data_artifact_id !== 'string' || !req.data_artifact_id.trim()) {
    throw new ScientificInferentialAnalysisError(
      'INFERENTIAL_INVALID_CONTRACT',
      'Missing required non-empty string "data_artifact_id".'
    );
  }

  const validTestTypes: InferentialTestType[] = [
    'ONE_SAMPLE_T_TEST',
    'INDEPENDENT_TWO_SAMPLE_T_TEST',
    'PAIRED_T_TEST',
    'PEARSON_CORRELATION_TEST',
    'CHI_SQUARE_INDEPENDENCE'
  ];

  if (!validTestTypes.includes(req.test_type as InferentialTestType)) {
    throw new ScientificInferentialAnalysisError(
      'INFERENTIAL_INVALID_CONTRACT',
      `Test type "${String(req.test_type)}" is invalid.`
    );
  }

  if (typeof req.dependent_variable !== 'string' || !req.dependent_variable.trim()) {
    throw new ScientificInferentialAnalysisError(
      'INFERENTIAL_INVALID_CONTRACT',
      'Missing required non-empty string "dependent_variable".'
    );
  }

  // Alpha validation: 0 < alpha < 1
  if (typeof req.alpha !== 'number' || isNaN(req.alpha) || req.alpha <= 0 || req.alpha >= 1) {
    throw new ScientificInferentialAnalysisError(
      'INFERENTIAL_ALPHA_INVALID',
      `Alpha must be a numeric value strictly between 0 and 1. Got: ${String(req.alpha)}.`
    );
  }

  // Null & Alternative hypothesis validation
  if (!req.null_hypothesis || typeof req.null_hypothesis !== 'object') {
    throw new ScientificInferentialAnalysisError(
      'INFERENTIAL_HYPOTHESIS_INVALID',
      'Missing required "null_hypothesis" object.'
    );
  }

  if (!req.alternative_hypothesis || typeof req.alternative_hypothesis !== 'object') {
    throw new ScientificInferentialAnalysisError(
      'INFERENTIAL_HYPOTHESIS_INVALID',
      'Missing required "alternative_hypothesis" object.'
    );
  }

  const alt = req.alternative_hypothesis as Record<string, unknown>;
  const validHypTypes: HypothesisType[] = ['TWO_SIDED', 'GREATER_THAN', 'LESS_THAN'];
  if (!validHypTypes.includes(alt.type as HypothesisType)) {
    throw new ScientificInferentialAnalysisError(
      'INFERENTIAL_HYPOTHESIS_INVALID',
      `Alternative hypothesis type "${String(alt.type)}" is invalid.`
    );
  }

  return req as unknown as InferentialAnalysisRequest;
}

/**
 * Asserts structural integrity and immutability of InferentialAnalysisResult.
 */
export function assertInferentialAnalysisResult(result: unknown): InferentialAnalysisResult {
  if (!result || typeof result !== 'object') {
    throw new ScientificInferentialAnalysisError(
      'INFERENTIAL_INVALID_CONTRACT',
      'Inferential analysis result must be a non-null object.'
    );
  }

  const res = result as Record<string, unknown>;

  if (!res.analysis_id || !res.dataset_version_id || !res.data_artifact_id || !res.checksum) {
    throw new ScientificInferentialAnalysisError(
      'INFERENTIAL_INVALID_CONTRACT',
      'Inferential analysis result missing required identification fields or checksum.'
    );
  }

  if (res.scientific_validity !== 'NOT_ESTABLISHED') {
    throw new ScientificInferentialAnalysisError(
      'INFERENTIAL_INVALID_CONTRACT',
      'Inferential analysis result scientific_validity must strictly be "NOT_ESTABLISHED".'
    );
  }

  if (res.decision !== 'REJECT_NULL' && res.decision !== 'DO_NOT_REJECT_NULL') {
    throw new ScientificInferentialAnalysisError(
      'INFERENTIAL_INVALID_CONTRACT',
      'Decision must strictly be "REJECT_NULL" or "DO_NOT_REJECT_NULL".'
    );
  }

  return deepFreeze(res as unknown as InferentialAnalysisResult);
}
