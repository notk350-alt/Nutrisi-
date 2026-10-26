/**
 * Phase D11 — Scientific Data Layer: Regression & Predictive Modeling Contracts
 *
 * Defines explicit, typed request and result contracts for deterministic
 * linear and logistic regression models.
 *
 * Strict Separation of Concerns:
 * 1. Mathematical Computation (Regression Engine)
 * 2. Statistical Decision Metrics ($R^2$, $p$-values, RMSE, Classification metrics)
 * 3. Scientific Validation (NOT ESTABLISHED)
 * 4. Clinical/Physiological Interpretation (Explicit profiles only)
 */

import { AnalysisFilter, FilterGroup } from './analysisContracts';
import { deepFreeze } from './dataStatePipeline';

export type RegressionModelType =
  | 'SIMPLE_LINEAR_REGRESSION'
  | 'MULTIPLE_LINEAR_REGRESSION'
  | 'LOGISTIC_REGRESSION';

export type RegressionMissingValuePolicy = 'ERROR' | 'LISTWISE_EXCLUDE';

export interface CrossValidationConfig {
  k: number;
  seed?: number;
  shuffle?: boolean;
}

export interface RegressionConfiguration {
  include_intercept?: boolean;
  classification_threshold?: number;
  missing_policy?: RegressionMissingValuePolicy;
  missing_tokens?: string[];
  confidence_level?: number;
  max_iterations?: number;
  tolerance?: number;
  cross_validation?: CrossValidationConfig;
  metadata?: Record<string, unknown>;
}

export interface RegressionModelRequest {
  model_id: string;
  dataset_version_id: string;
  data_artifact_id: string;
  model_type: RegressionModelType;
  dependent_variable: string;
  independent_variables: string[];
  filters?: AnalysisFilter[];
  filter_group?: FilterGroup;
  configuration?: RegressionConfiguration;
  created_by: string;
  created_at: string;
  engine_version?: string;
}

export interface CoefficientConfidenceInterval {
  lower_bound: number | null;
  upper_bound: number | null;
  confidence_level: number;
}

export interface RegressionCoefficient {
  variable_name: string;
  coefficient: number;
  standard_error: number | null;
  statistic: number | null;
  p_value: number | null;
  confidence_interval: CoefficientConfidenceInterval | null;
  odds_ratio?: number | null;
  odds_ratio_ci?: { lower_bound: number | null; upper_bound: number | null } | null;
}

export interface ConfusionMatrix {
  true_positives: number;
  false_positives: number;
  true_negatives: number;
  false_negatives: number;
}

export interface LinearRegressionMetrics {
  r2: number | null;
  adjusted_r2: number | null;
  rmse: number | null;
  mae: number | null;
  sse: number | null;
  sst: number | null;
}

export interface LogisticRegressionMetrics {
  accuracy: number | null;
  sensitivity: number | null;
  specificity: number | null;
  precision: number | null;
  recall: number | null;
  f1_score: number | null;
  roc_auc: number | null;
  confusion_matrix: ConfusionMatrix | null;
}

export interface RegressionMetrics {
  linear?: LinearRegressionMetrics | null;
  logistic?: LogisticRegressionMetrics | null;
}

export interface FoldMetricResult {
  fold: number;
  sample_size: number;
  metrics: Record<string, number | null>;
}

export interface AggregateMetricSummary {
  mean: number | null;
  std: number | null;
  min: number | null;
  max: number | null;
}

export interface CrossValidationResult {
  k: number;
  folds: FoldMetricResult[];
  aggregate_metrics: Record<string, AggregateMetricSummary>;
}

export type RegressionExecutionStatus =
  | 'COMPLETED'
  | 'INSUFFICIENT_DATA'
  | 'SINGULAR_MATRIX'
  | 'CONVERGENCE_FAILURE'
  | 'INVALID_CONFIGURATION'
  | 'NON_BINARY_OUTCOME'
  | 'NUMERICAL_ERROR';

export interface RegressionModelResult {
  model_id: string;
  model_type: RegressionModelType;
  dataset_version_id: string;
  data_artifact_id: string;
  sample_size: number;
  excluded_records: number;
  coefficients: RegressionCoefficient[];
  intercept: RegressionCoefficient | null;
  predictions: number[];
  residuals: number[] | null;
  predicted_probabilities?: number[] | null;
  model_metrics: RegressionMetrics;
  cross_validation?: CrossValidationResult | null;
  diagnostics: Record<string, unknown>;
  warnings: string[];
  execution_status: RegressionExecutionStatus;
  scientific_validity: 'NOT_ESTABLISHED';
  engine_version: string;
  provenance_hash: string;
  created_at: string;
  checksum: string;
}

export type RegressionErrorCode =
  | 'REGRESSION_DATASET_NOT_FOUND'
  | 'REGRESSION_ARTIFACT_NOT_FOUND'
  | 'REGRESSION_VERSION_MISMATCH'
  | 'REGRESSION_VARIABLE_NOT_FOUND'
  | 'REGRESSION_SINGULAR_MATRIX'
  | 'REGRESSION_NON_BINARY_OUTCOME'
  | 'REGRESSION_UNIT_MISMATCH'
  | 'REGRESSION_ALPHA_INVALID'
  | 'REGRESSION_INSUFFICIENT_DATA'
  | 'REGRESSION_CONVERGENCE_FAILURE'
  | 'REGRESSION_INVALID_CONTRACT';

export class ScientificRegressionError extends Error {
  readonly code: RegressionErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: RegressionErrorCode, message: string, details?: Record<string, unknown>) {
    super(`[${code}] ${message}`);
    this.name = 'ScientificRegressionError';
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, ScientificRegressionError.prototype);
  }
}

/**
 * Validates the structure and contracts of a RegressionModelRequest.
 */
export function validateRegressionModelRequest(request: unknown): RegressionModelRequest {
  if (!request || typeof request !== 'object') {
    throw new ScientificRegressionError(
      'REGRESSION_INVALID_CONTRACT',
      'Regression model request must be a non-null object.'
    );
  }

  const req = request as Record<string, unknown>;

  if (typeof req.model_id !== 'string' || !req.model_id.trim()) {
    throw new ScientificRegressionError(
      'REGRESSION_INVALID_CONTRACT',
      'Missing required non-empty string "model_id".'
    );
  }

  if (typeof req.dataset_version_id !== 'string' || !req.dataset_version_id.trim()) {
    throw new ScientificRegressionError(
      'REGRESSION_INVALID_CONTRACT',
      'Missing required non-empty string "dataset_version_id".'
    );
  }

  if (typeof req.data_artifact_id !== 'string' || !req.data_artifact_id.trim()) {
    throw new ScientificRegressionError(
      'REGRESSION_INVALID_CONTRACT',
      'Missing required non-empty string "data_artifact_id".'
    );
  }

  const validModelTypes: RegressionModelType[] = [
    'SIMPLE_LINEAR_REGRESSION',
    'MULTIPLE_LINEAR_REGRESSION',
    'LOGISTIC_REGRESSION'
  ];

  if (!validModelTypes.includes(req.model_type as RegressionModelType)) {
    throw new ScientificRegressionError(
      'REGRESSION_INVALID_CONTRACT',
      `Model type "${String(req.model_type)}" is invalid.`
    );
  }

  if (typeof req.dependent_variable !== 'string' || !req.dependent_variable.trim()) {
    throw new ScientificRegressionError(
      'REGRESSION_INVALID_CONTRACT',
      'Missing required non-empty string "dependent_variable".'
    );
  }

  if (!Array.isArray(req.independent_variables) || req.independent_variables.length === 0) {
    throw new ScientificRegressionError(
      'REGRESSION_INVALID_CONTRACT',
      'Missing required non-empty array "independent_variables".'
    );
  }

  if (req.model_type === 'SIMPLE_LINEAR_REGRESSION' && req.independent_variables.length !== 1) {
    throw new ScientificRegressionError(
      'REGRESSION_INVALID_CONTRACT',
      'SIMPLE_LINEAR_REGRESSION requires exactly 1 independent variable.'
    );
  }

  // Configuration check
  if (req.configuration && typeof req.configuration === 'object') {
    const config = req.configuration as Record<string, unknown>;
    if (config.confidence_level !== undefined) {
      const conf = Number(config.confidence_level);
      if (isNaN(conf) || conf <= 0 || conf >= 1) {
        throw new ScientificRegressionError(
          'REGRESSION_ALPHA_INVALID',
          `Confidence level must be strictly between 0 and 1. Got: ${String(config.confidence_level)}.`
        );
      }
    }
  }

  return req as unknown as RegressionModelRequest;
}

/**
 * Asserts structural integrity and immutability of RegressionModelResult.
 */
export function assertRegressionModelResult(result: unknown): RegressionModelResult {
  if (!result || typeof result !== 'object') {
    throw new ScientificRegressionError(
      'REGRESSION_INVALID_CONTRACT',
      'Regression model result must be a non-null object.'
    );
  }

  const res = result as Record<string, unknown>;

  if (!res.model_id || !res.dataset_version_id || !res.data_artifact_id || !res.checksum) {
    throw new ScientificRegressionError(
      'REGRESSION_INVALID_CONTRACT',
      'Regression model result missing required identification fields or checksum.'
    );
  }

  if (res.scientific_validity !== 'NOT_ESTABLISHED') {
    throw new ScientificRegressionError(
      'REGRESSION_INVALID_CONTRACT',
      'Regression model result scientific_validity must strictly be "NOT_ESTABLISHED".'
    );
  }

  return deepFreeze(res as unknown as RegressionModelResult);
}
