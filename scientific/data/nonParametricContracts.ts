/**
 * Phase D13 — Scientific Data Layer: Non-Parametric & Robust Statistical Analysis Contracts
 *
 * Defines strongly typed contracts, execution status models, sample auditing structs,
 * and error handling classes for non-parametric statistical procedures.
 *
 * Strict Separation of Concerns:
 * 1. Mathematical / Non-Parametric Computation (D13 Engine)
 * 2. Statistical Decision Rules (p_value vs alpha)
 * 3. Scientific Validation (NOT ESTABLISHED)
 * 4. Clinical / Diagnostic / Physiological Interpretation (Decoupled)
 */

import { AnalysisFilter, FilterGroup } from './analysisContracts';
import { deepFreeze } from './dataStatePipeline';
import { NullHypothesis } from './inferentialContracts';

export type NonParametricTestType =
  | 'MANN_WHITNEY_U'
  | 'WILCOXON_SIGNED_RANK'
  | 'KRUSKAL_WALLIS'
  | 'FRIEDMAN'
  | 'SPEARMAN_CORRELATION'
  | 'FISHER_EXACT';

export type NonParametricAlternativeHypothesis = 'TWO_SIDED' | 'GREATER_THAN' | 'LESS_THAN';

export interface NonParametricAlternativeHypothesisObject {
  type: NonParametricAlternativeHypothesis;
  statement: string;
  value?: number;
}

export interface NonParametricConfiguration {
  paired_key?: string;
  block_variable?: string;
  group_a?: string;
  group_b?: string;
  missing_tokens?: string[];
  metadata?: Record<string, unknown>;
}

export interface NonParametricAnalysisRequest {
  analysis_id: string;
  dataset_version_id: string;
  data_artifact_id: string;
  test_type: NonParametricTestType;
  dependent_variable: string;
  independent_variables?: string[];
  paired_variable?: string;
  block_variable?: string;
  grouping_variable?: string;
  group_a?: string;
  group_b?: string;
  null_hypothesis: NullHypothesis;
  alternative_hypothesis: NonParametricAlternativeHypothesisObject;
  alpha: number;
  confidence_level?: number;
  filters?: AnalysisFilter[];
  filter_group?: FilterGroup;
  configuration?: NonParametricConfiguration;
  created_by?: string;
  created_at?: string;
  engine_version?: string;
}

export type NonParametricExecutionStatus =
  | 'COMPLETED'
  | 'INSUFFICIENT_DATA'
  | 'ASSUMPTION_NOT_ESTABLISHED'
  | 'INVALID_INPUT'
  | 'INVALID_CONFIGURATION'
  | 'NUMERICAL_ERROR';

export interface NonParametricSampleInfo {
  total_records: number;
  valid_observations: number;
  missing_observations: number;
  excluded_observations: number;
  group_sizes?: Record<string, number>;
  zero_differences_removed?: number;
  complete_blocks?: number;
  incomplete_blocks_excluded?: number;
  tie_count?: number;
  contingency_dimensions?: string;
}

export interface NonParametricContingencyTable {
  observed: number[][];
  marginal_rows: number[];
  marginal_cols: number[];
  odds_ratio: number | null;
}

export interface NonParametricAnalysisResult {
  analysis_id: string;
  dataset_version_id: string;
  data_artifact_id: string;
  test_type: NonParametricTestType;
  status: NonParametricExecutionStatus;
  alpha: number;
  null_hypothesis: NullHypothesis;
  alternative_hypothesis: NonParametricAlternativeHypothesisObject;
  sample_info: NonParametricSampleInfo;
  test_statistic: number | null;
  degrees_of_freedom: number | null;
  p_value: number | null;
  decision: 'REJECT_NULL' | 'DO_NOT_REJECT_NULL' | null;
  effect_size: { metric: string; value: number | null } | null;
  contingency_table?: NonParametricContingencyTable | null;
  assumption_audit: string[];
  warnings: string[];
  numerical_status: string;
  provenance_hash: string;
  scientific_validity: 'NOT_ESTABLISHED';
  executed_at: string;
  engine_version: string;
}

export type NonParametricErrorCode =
  | 'NONPARAMETRIC_DATASET_NOT_FOUND'
  | 'NONPARAMETRIC_ARTIFACT_NOT_FOUND'
  | 'NONPARAMETRIC_VERSION_MISMATCH'
  | 'NONPARAMETRIC_VARIABLE_NOT_FOUND'
  | 'NONPARAMETRIC_UNIT_MISMATCH'
  | 'NONPARAMETRIC_GROUP_INVALID'
  | 'NONPARAMETRIC_PAIRING_INVALID'
  | 'NONPARAMETRIC_INSUFFICIENT_DATA'
  | 'NONPARAMETRIC_ZERO_VARIANCE'
  | 'NONPARAMETRIC_CONTINGENCY_INVALID'
  | 'NONPARAMETRIC_NUMERICAL_ERROR'
  | 'NONPARAMETRIC_UNSUPPORTED_CONFIGURATION';

export class ScientificNonParametricError extends Error {
  readonly code: NonParametricErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: NonParametricErrorCode, message: string, details?: Record<string, unknown>) {
    super(`[${code}] ${message}`);
    this.name = 'ScientificNonParametricError';
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, ScientificNonParametricError.prototype);
  }
}

/**
 * Validates structural parameters of a NonParametricAnalysisRequest.
 */
export function validateNonParametricRequest(request: NonParametricAnalysisRequest): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!request.analysis_id || typeof request.analysis_id !== 'string') {
    errors.push('analysis_id is required and must be a non-empty string');
  }

  if (!request.dataset_version_id || typeof request.dataset_version_id !== 'string') {
    errors.push('dataset_version_id is required and must be a non-empty string');
  }

  if (!request.data_artifact_id || typeof request.data_artifact_id !== 'string') {
    errors.push('data_artifact_id is required and must be a non-empty string');
  }

  const validTypes: NonParametricTestType[] = [
    'MANN_WHITNEY_U',
    'WILCOXON_SIGNED_RANK',
    'KRUSKAL_WALLIS',
    'FRIEDMAN',
    'SPEARMAN_CORRELATION',
    'FISHER_EXACT'
  ];

  if (!validTypes.includes(request.test_type)) {
    errors.push(`test_type must be one of: ${validTypes.join(', ')}`);
  }

  if (typeof request.alpha !== 'number' || !Number.isFinite(request.alpha) || request.alpha <= 0 || request.alpha >= 1) {
    errors.push('alpha must be a finite number in the open interval (0, 1)');
  }

  if (!request.null_hypothesis || !request.null_hypothesis.statement) {
    errors.push('null_hypothesis with a valid statement is required');
  }

  if (!request.alternative_hypothesis || !request.alternative_hypothesis.type || !request.alternative_hypothesis.statement) {
    errors.push('alternative_hypothesis with a valid type and statement is required');
  }

  const validAltTypes: NonParametricAlternativeHypothesis[] = ['TWO_SIDED', 'GREATER_THAN', 'LESS_THAN'];
  if (request.alternative_hypothesis && !validAltTypes.includes(request.alternative_hypothesis.type)) {
    errors.push(`alternative_hypothesis.type must be one of: ${validAltTypes.join(', ')}`);
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Creates an immutable, deeply frozen NonParametricAnalysisResult object.
 */
export function createNonParametricResult(
  data: Omit<NonParametricAnalysisResult, 'scientific_validity'>
): NonParametricAnalysisResult {
  const result: NonParametricAnalysisResult = {
    ...data,
    scientific_validity: 'NOT_ESTABLISHED'
  };

  return deepFreeze(result);
}
