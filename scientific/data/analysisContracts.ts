/**
 * Phase D9 — Scientific Data Layer: Statistical Analysis Contracts
 *
 * Defines the strict, typed request/result contracts for reproducible dataset analysis.
 *
 * Separation of Concerns:
 * 1. Data Quality (D6)
 * 2. Statistical Computation (D9)
 * 3. Scientific Validation (Not Established)
 * 4. Clinical Interpretation (Explicit contracts only)
 */

import { deepFreeze } from './dataStatePipeline';

export type AnalysisType =
  | 'DESCRIPTIVE_NUMERIC'
  | 'CATEGORICAL_FREQUENCY'
  | 'MISSINGNESS_SUMMARY'
  | 'DISTRIBUTION_SUMMARY'
  | 'GROUPED_STRATIFIED'
  | 'PAIRWISE_ASSOCIATION'
  | 'OUTLIER_DETECTION';

export type AnalysisFilterOperator =
  | '=='
  | '!='
  | '<'
  | '<='
  | '>'
  | '>='
  | 'IN'
  | 'NOT_IN';

export interface AnalysisFilter {
  variable_id: string; // or column name in dataset
  operator: AnalysisFilterOperator;
  value: unknown;
}

export interface FilterGroup {
  logic: 'AND' | 'OR';
  filters: AnalysisFilter[];
}

export interface AnalysisGrouping {
  group_by_variables: string[];
}

export type MissingValuePolicy = 'IGNORE_MISSING' | 'INCLUDE_MISSING_CATEGORY';

export interface AnalysisConfiguration {
  missing_policy?: MissingValuePolicy;
  missing_tokens?: string[];
  bin_count?: number;
  bin_width?: number;
  outlier_method?: 'IQR' | 'Z_SCORE';
  z_threshold?: number;
  iqr_multiplier?: number;
  target_units?: Record<string, string>;
  metadata?: Record<string, unknown>;
}

export interface AnalysisRequest {
  analysis_id: string;
  dataset_version_id: string;
  data_artifact_id: string;
  requested_variables: string[];
  analysis_type: AnalysisType;
  filters?: AnalysisFilter[];
  filter_group?: FilterGroup;
  grouping?: AnalysisGrouping;
  configuration?: AnalysisConfiguration;
  created_by: string;
  created_at: string;
}

export interface DescriptiveNumericResultItem {
  variable_id: string;
  canonical_unit?: string;
  total_records: number;
  valid_count: number;
  missing_count: number;
  missing_percentage: number;
  invalid_count: number;
  minimum: number | null;
  maximum: number | null;
  sum: number | null;
  mean: number | null;
  median: number | null;
  variance: number | null;
  standard_deviation: number | null;
  percentile_25: number | null;
  percentile_50: number | null;
  percentile_75: number | null;
  interquartile_range: number | null;
  constant_value_flag: boolean;
  zero_variance_flag: boolean;
  notes?: string[];
}

export interface CategoryFrequencyItem {
  category: string;
  count: number;
  percentage: number;
}

export interface CategoricalFrequencyResultItem {
  variable_id: string;
  total_records: number;
  valid_count: number;
  missing_count: number;
  missing_percentage: number;
  unique_category_count: number;
  categories: CategoryFrequencyItem[];
}

export interface MissingnessSummaryResultItem {
  variable_id: string;
  total_records: number;
  valid_count: number;
  missing_count: number;
  missing_percentage: number;
  invalid_count: number;
}

export interface DistributionHistogramBin {
  bin_index: number;
  lower_bound: number;
  upper_bound: number;
  count: number;
  percentage: number;
}

export interface DistributionSummaryResultItem {
  variable_id: string;
  canonical_unit?: string;
  minimum: number | null;
  maximum: number | null;
  mean: number | null;
  median: number | null;
  variance: number | null;
  standard_deviation: number | null;
  quartiles: {
    q1: number | null;
    q2: number | null;
    q3: number | null;
  };
  iqr: number | null;
  histogram_bins?: DistributionHistogramBin[];
}

export interface GroupedAnalysisGroupItem {
  group_key: string;
  group_values: Record<string, unknown>;
  record_count: number;
  descriptive_numeric?: Record<string, DescriptiveNumericResultItem>;
  categorical_frequency?: Record<string, CategoricalFrequencyResultItem>;
}

export interface GroupedSummaryResult {
  group_by_variables: string[];
  groups: GroupedAnalysisGroupItem[];
}

export interface PearsonAssociationItem {
  var1: string;
  var2: string;
  pearson_correlation: number | null;
  pair_count: number;
  valid_count: number;
  constant_variable_flag: boolean;
  notes?: string;
}

export interface ContingencyTableResult {
  var1: string;
  var2: string;
  var1_categories: string[];
  var2_categories: string[];
  matrix: number[][];
  total_count: number;
}

export interface PairwiseAssociationResult {
  numeric_associations?: PearsonAssociationItem[];
  categorical_associations?: ContingencyTableResult[];
}

export interface OutlierDetectionResultItem {
  variable_id: string;
  method: 'IQR' | 'Z_SCORE';
  threshold: number;
  lower_bound: number | null;
  upper_bound: number | null;
  flagged_count: number;
  flagged_percentage: number;
  flagged_record_ids: string[];
  flagged_values: unknown[];
  notes?: string;
}

export interface AnalysisResultBody {
  numeric_summaries?: Record<string, DescriptiveNumericResultItem>;
  categorical_summaries?: Record<string, CategoricalFrequencyResultItem>;
  missingness_summaries?: Record<string, MissingnessSummaryResultItem>;
  distribution_summaries?: Record<string, DistributionSummaryResultItem>;
  grouped_summaries?: GroupedSummaryResult;
  pairwise_associations?: PairwiseAssociationResult;
  outlier_summaries?: Record<string, OutlierDetectionResultItem>;
}

export interface AnalysisExecutionMetadata {
  execution_time_ms: number;
  total_records_in_artifact: number;
  filtered_record_count: number;
}

export interface AnalysisResult {
  analysis_id: string;
  dataset_version_id: string;
  data_artifact_id: string;
  analysis_type: AnalysisType;
  requested_variables: string[];
  filters: AnalysisFilter[];
  grouping: AnalysisGrouping | null;
  configuration: AnalysisConfiguration;
  result: AnalysisResultBody;
  execution_metadata: AnalysisExecutionMetadata;
  scientific_validity: 'NOT_ESTABLISHED';
  created_at: string;
  engine_version: string;
  provenance_reference: string;
  checksum: string;
}

export type AnalysisErrorCode =
  | 'ANALYSIS_DATASET_NOT_FOUND'
  | 'ANALYSIS_ARTIFACT_NOT_FOUND'
  | 'ANALYSIS_VERSION_MISMATCH'
  | 'ANALYSIS_VARIABLE_NOT_FOUND'
  | 'ANALYSIS_VARIABLE_TYPE_INVALID'
  | 'ANALYSIS_UNIT_MISMATCH'
  | 'ANALYSIS_FILTER_INVALID'
  | 'ANALYSIS_GROUP_INVALID'
  | 'ANALYSIS_EMPTY_DATA'
  | 'ANALYSIS_INSUFFICIENT_OBSERVATIONS'
  | 'ANALYSIS_NUMERICAL_ERROR'
  | 'ANALYSIS_CONFIGURATION_INVALID'
  | 'ANALYSIS_INVALID_CONTRACT';

export class ScientificStatisticalAnalysisError extends Error {
  readonly code: AnalysisErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: AnalysisErrorCode, message: string, details?: Record<string, unknown>) {
    super(`[${code}] ${message}`);
    this.name = 'ScientificStatisticalAnalysisError';
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, ScientificStatisticalAnalysisError.prototype);
  }
}

/**
 * Validates the schema and structure of an AnalysisRequest.
 */
export function validateAnalysisRequest(request: unknown): AnalysisRequest {
  if (!request || typeof request !== 'object') {
    throw new ScientificStatisticalAnalysisError(
      'ANALYSIS_INVALID_CONTRACT',
      'Analysis request must be a non-null object.'
    );
  }

  const req = request as Record<string, unknown>;

  if (typeof req.analysis_id !== 'string' || !req.analysis_id.trim()) {
    throw new ScientificStatisticalAnalysisError(
      'ANALYSIS_INVALID_CONTRACT',
      'Analysis request missing required non-empty string "analysis_id".'
    );
  }

  if (typeof req.dataset_version_id !== 'string' || !req.dataset_version_id.trim()) {
    throw new ScientificStatisticalAnalysisError(
      'ANALYSIS_INVALID_CONTRACT',
      'Analysis request missing required non-empty string "dataset_version_id".'
    );
  }

  if (typeof req.data_artifact_id !== 'string' || !req.data_artifact_id.trim()) {
    throw new ScientificStatisticalAnalysisError(
      'ANALYSIS_INVALID_CONTRACT',
      'Analysis request missing required non-empty string "data_artifact_id".'
    );
  }

  if (!Array.isArray(req.requested_variables)) {
    throw new ScientificStatisticalAnalysisError(
      'ANALYSIS_INVALID_CONTRACT',
      'Analysis request missing required array "requested_variables".'
    );
  }

  const validTypes: AnalysisType[] = [
    'DESCRIPTIVE_NUMERIC',
    'CATEGORICAL_FREQUENCY',
    'MISSINGNESS_SUMMARY',
    'DISTRIBUTION_SUMMARY',
    'GROUPED_STRATIFIED',
    'PAIRWISE_ASSOCIATION',
    'OUTLIER_DETECTION'
  ];

  if (!validTypes.includes(req.analysis_type as AnalysisType)) {
    throw new ScientificStatisticalAnalysisError(
      'ANALYSIS_INVALID_CONTRACT',
      `Analysis type "${String(req.analysis_type)}" is invalid.`
    );
  }

  return req as unknown as AnalysisRequest;
}

/**
 * Asserts structural integrity and immutability of AnalysisResult.
 */
export function assertAnalysisResult(result: unknown): AnalysisResult {
  if (!result || typeof result !== 'object') {
    throw new ScientificStatisticalAnalysisError(
      'ANALYSIS_INVALID_CONTRACT',
      'Analysis result must be a non-null object.'
    );
  }

  const res = result as Record<string, unknown>;

  if (!res.analysis_id || !res.dataset_version_id || !res.data_artifact_id || !res.checksum) {
    throw new ScientificStatisticalAnalysisError(
      'ANALYSIS_INVALID_CONTRACT',
      'Analysis result missing required identification fields or checksum.'
    );
  }

  if (res.scientific_validity !== 'NOT_ESTABLISHED') {
    throw new ScientificStatisticalAnalysisError(
      'ANALYSIS_INVALID_CONTRACT',
      'Analysis result scientific_validity must strictly be "NOT_ESTABLISHED".'
    );
  }

  return deepFreeze(res as unknown as AnalysisResult);
}
