/**
 * Phase D14 — Scientific Data Layer: Visualization Contracts
 *
 * Defines the strict, typed request/result contracts for scientific visualizations.
 * 
 * Invariants:
 * 1. DatasetVersion and DataArtifact pinning
 * 2. Immutable, deep-frozen results
 * 3. Cryptographic SHA-256 provenance tracking
 * 4. Zero dynamic code execution (no eval, no new Function, no executable strings)
 * 5. Scientific validity = 'NOT_ESTABLISHED'
 */

import { AnalysisFilter, AnalysisGrouping } from './analysisContracts';
import { deepFreeze } from './dataStatePipeline';

export type VisualizationType =
  | 'HISTOGRAM'
  | 'BOX_PLOT'
  | 'SCATTER_PLOT'
  | 'BAR_CHART'
  | 'FREQUENCY_CHART'
  | 'LINE_CHART'
  | 'ERROR_BAR'
  | 'CORRELATION_MATRIX'
  | 'CONTINGENCY_HEATMAP'
  | 'ROC_CURVE'
  | 'RESIDUAL_PLOT'
  | 'PREDICTED_VS_OBSERVED';

export interface HistogramVisualizationConfig {
  bin_count?: number;
  bin_width?: number;
  normalize?: boolean;
  min_value?: number;
  max_value?: number;
}

export interface BoxPlotVisualizationConfig {
  orientation?: 'VERTICAL' | 'HORIZONTAL';
  show_outliers?: boolean;
  iqr_multiplier?: number;
}

export interface ScatterPlotVisualizationConfig {
  include_trendline?: boolean;
  jitter?: boolean;
  jitter_amount?: number;
  alpha?: number;
}

export interface BarChartVisualizationConfig {
  orientation?: 'VERTICAL' | 'HORIZONTAL';
  sort_order?: 'ASCENDING' | 'DESCENDING' | 'NONE';
  top_n?: number;
}

export interface FrequencyChartVisualizationConfig {
  chart_style?: 'BAR' | 'PIE' | 'DONUT';
  top_n?: number;
  include_other?: boolean;
}

export interface LineChartVisualizationConfig {
  sort_by_x?: boolean;
  show_markers?: boolean;
  curve_type?: 'LINEAR' | 'SMOOTH';
}

export interface ErrorBarVisualizationConfig {
  error_type?: 'CONFIDENCE_INTERVAL' | 'STANDARD_ERROR' | 'STANDARD_DEVIATION';
  confidence_level?: number;
}

export interface CorrelationMatrixVisualizationConfig {
  color_scale?: string;
  show_values?: boolean;
  sort_variables?: boolean;
}

export interface ContingencyHeatmapVisualizationConfig {
  display_percentages?: boolean;
  show_margins?: boolean;
}

export interface RocCurveVisualizationConfig {
  show_auc?: boolean;
  include_reference_line?: boolean;
  threshold_count?: number;
}

export interface ResidualPlotConfig {
  standardized?: boolean;
  reference_line?: boolean;
}

export interface PredictedVsObservedConfig {
  include_identity_line?: boolean;
}

export type VisualizationConfiguration =
  | (HistogramVisualizationConfig &
     BoxPlotVisualizationConfig &
     ScatterPlotVisualizationConfig &
     BarChartVisualizationConfig &
     FrequencyChartVisualizationConfig &
     LineChartVisualizationConfig &
     ErrorBarVisualizationConfig &
     CorrelationMatrixVisualizationConfig &
     ContingencyHeatmapVisualizationConfig &
     RocCurveVisualizationConfig &
     ResidualPlotConfig &
     PredictedVsObservedConfig &
     Record<string, unknown>);

export interface VisualizationRequest {
  visualization_id: string;
  dataset_version_id: string;
  data_artifact_id: string;
  source_analysis_result_ids?: string[];
  visualization_type: VisualizationType;
  variables: string[];
  filters?: AnalysisFilter[];
  grouping?: AnalysisGrouping | null;
  configuration?: VisualizationConfiguration;
  created_by?: string;
  created_at?: string;
  engine_version?: string;
}

export interface VisualizationAxes {
  x_label?: string;
  y_label?: string;
  z_label?: string;
  x_unit?: string;
  y_unit?: string;
  units?: Record<string, string>;
}

export interface HistogramBinItem {
  bin_index: number;
  lower_bound: number;
  upper_bound: number;
  midpoint: number;
  count: number;
  percentage: number;
}

export interface BoxPlotItem {
  group_key?: string;
  variable: string;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  iqr: number;
  mean?: number | null;
  outliers: number[];
}

export interface ScatterPointItem {
  x: number;
  y: number;
  id?: string;
  group?: string;
}

export interface ScatterTrendline {
  slope: number;
  intercept: number;
  r_squared: number;
}

export interface BarChartItem {
  category: string;
  value: number;
  count: number;
  percentage: number;
  group?: string;
}

export interface LineChartPoint {
  x: number;
  y: number;
  label?: string;
}

export interface LineChartSeries {
  series_id: string;
  label: string;
  points: LineChartPoint[];
}

export interface ErrorBarItem {
  label: string;
  value: number;
  error_lower: number;
  error_upper: number;
  margin_of_error: number;
  group?: string;
}

export interface RocPointItem {
  fpr: number;
  tpr: number;
  threshold: number;
}

export interface ResidualPointItem {
  predicted: number;
  residual: number;
  standardized_residual?: number;
  id?: string;
}

export interface PredictedVsObservedItem {
  observed: number;
  predicted: number;
  id?: string;
}

export interface VisualizationPayload {
  histogram?: {
    bins: HistogramBinItem[];
    total_count: number;
    bin_width: number;
  };
  box_plot?: {
    items: BoxPlotItem[];
  };
  scatter_plot?: {
    points: ScatterPointItem[];
    trendline?: ScatterTrendline;
  };
  bar_chart?: {
    items: BarChartItem[];
    is_grouped?: boolean;
  };
  frequency_chart?: {
    items: BarChartItem[];
    total_count: number;
  };
  line_chart?: {
    series: LineChartSeries[];
  };
  error_bar?: {
    items: ErrorBarItem[];
  };
  correlation_matrix?: {
    variables: string[];
    matrix: number[][];
    annotations?: Record<string, unknown>;
  };
  contingency_heatmap?: {
    row_categories: string[];
    col_categories: string[];
    matrix: number[][];
    percentages: number[][];
    total_count: number;
  };
  roc_curve?: {
    points: RocPointItem[];
    auc: number;
    reference_line: Array<{ fpr: number; tpr: number }>;
  };
  residual_plot?: {
    points: ResidualPointItem[];
    reference_line: number;
    is_standardized: boolean;
  };
  predicted_vs_observed?: {
    points: PredictedVsObservedItem[];
    identity_line: { slope: 1; intercept: 0 };
  };
}

export type VisualizationExecutionStatus = 'COMPLETED' | 'EMPTY_DATA' | 'INSUFFICIENT_DATA';

export interface VisualizationResult {
  visualization_id: string;
  visualization_type: VisualizationType;
  dataset_version_id: string;
  data_artifact_id: string;
  source_artifact_checksum: string;
  source_analysis_result_ids: string[];
  title: string;
  description?: string;
  variables: string[];
  axes: VisualizationAxes;
  payload: VisualizationPayload;
  summary_statistics: Record<string, unknown>;
  diagnostics: Record<string, unknown>;
  warnings: string[];
  execution_status: VisualizationExecutionStatus;
  provenance_hash: string;
  scientific_validity: 'NOT_ESTABLISHED';
  executed_at: string;
  engine_version: string;
}

export type VisualizationErrorCode =
  | 'VISUALIZATION_DATASET_NOT_FOUND'
  | 'VISUALIZATION_ARTIFACT_NOT_FOUND'
  | 'VISUALIZATION_VERSION_MISMATCH'
  | 'VISUALIZATION_ANALYSIS_NOT_FOUND'
  | 'VISUALIZATION_VARIABLE_NOT_FOUND'
  | 'VISUALIZATION_INVALID_CONFIGURATION'
  | 'VISUALIZATION_SOURCE_MISMATCH'
  | 'VISUALIZATION_INVALID_CONTRACT'
  | 'VISUALIZATION_EMPTY_DATA'
  | 'VISUALIZATION_DATA_PROCESSING_ERROR';

export class ScientificVisualizationError extends Error {
  readonly code: VisualizationErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: VisualizationErrorCode, message: string, details?: Record<string, unknown>) {
    super(`[${code}] ${message}`);
    this.name = 'ScientificVisualizationError';
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, ScientificVisualizationError.prototype);
  }
}

/**
 * Validates structural parameters of a VisualizationRequest.
 */
export function validateVisualizationRequest(request: VisualizationRequest): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!request || typeof request !== 'object') {
    throw new ScientificVisualizationError(
      'VISUALIZATION_INVALID_CONTRACT',
      'Request must be a non-null object'
    );
  }

  if (!request.visualization_id || typeof request.visualization_id !== 'string') {
    errors.push('visualization_id is required and must be a non-empty string');
  }

  if (!request.dataset_version_id || typeof request.dataset_version_id !== 'string') {
    errors.push('dataset_version_id is required and must be a non-empty string');
  }

  if (!request.data_artifact_id || typeof request.data_artifact_id !== 'string') {
    errors.push('data_artifact_id is required and must be a non-empty string');
  }

  const validTypes: VisualizationType[] = [
    'HISTOGRAM',
    'BOX_PLOT',
    'SCATTER_PLOT',
    'BAR_CHART',
    'FREQUENCY_CHART',
    'LINE_CHART',
    'ERROR_BAR',
    'CORRELATION_MATRIX',
    'CONTINGENCY_HEATMAP',
    'ROC_CURVE',
    'RESIDUAL_PLOT',
    'PREDICTED_VS_OBSERVED'
  ];

  if (!validTypes.includes(request.visualization_type)) {
    errors.push(`visualization_type must be one of: ${validTypes.join(', ')}`);
  }

  if (!Array.isArray(request.variables) || request.variables.length === 0) {
    errors.push('variables must be a non-empty array of strings');
  }

  if (request.configuration && typeof request.configuration !== 'object') {
    errors.push('configuration must be an object if specified');
  }

  if (errors.length > 0) {
    throw new ScientificVisualizationError(
      'VISUALIZATION_INVALID_CONTRACT',
      `Visualization contract validation failed: ${errors.join('; ')}`,
      { errors }
    );
  }

  return { valid: true, errors: [] };
}

/**
 * Creates an immutable, deep-frozen VisualizationResult.
 */
export function createVisualizationResult(result: VisualizationResult): VisualizationResult {
  return deepFreeze({
    ...result,
    scientific_validity: 'NOT_ESTABLISHED'
  });
}
