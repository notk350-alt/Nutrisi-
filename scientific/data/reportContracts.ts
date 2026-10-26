/**
 * Phase D14 — Scientific Data Layer: Research Reporting & Table Contracts
 *
 * Defines the strict, typed request/result contracts for Research Tables,
 * Multi-section Research Reports, and cryptographic integrity provenance.
 *
 * Invariants:
 * 1. Version and artifact pinning across all report components
 * 2. Immutable, deep-frozen results
 * 3. Strictly presentation and auditing (zero automatic causal/clinical claims)
 * 4. Scientific validity = 'NOT_ESTABLISHED'
 */

import { VisualizationResult } from './visualizationContracts';
import { deepFreeze } from './dataStatePipeline';

export type ResearchTableType =
  | 'DESCRIPTIVE_TABLE'
  | 'GROUPED_SUMMARY_TABLE'
  | 'INFERENTIAL_RESULT_TABLE'
  | 'REGRESSION_COEFFICIENT_TABLE'
  | 'NONPARAMETRIC_RESULT_TABLE'
  | 'POWER_ANALYSIS_TABLE'
  | 'ASSUMPTION_AUDIT_TABLE'
  | 'DATA_QUALITY_TABLE';

export interface ResearchTableColumn {
  key: string;
  label: string;
  unit?: string;
  format?: 'NUMBER' | 'PERCENT' | 'P_VALUE' | 'STRING' | 'INTEGER';
  alignment?: 'LEFT' | 'CENTER' | 'RIGHT';
}

export interface ResearchTableSourceReference {
  source_type: string;
  id: string;
  dataset_version_id?: string;
  data_artifact_id?: string;
}

export interface ResearchTable {
  table_id: string;
  table_type: ResearchTableType;
  title: string;
  description?: string;
  columns: ResearchTableColumn[];
  rows: Array<Record<string, unknown>>;
  source_references: ResearchTableSourceReference[];
  metadata?: Record<string, unknown>;
}

export interface DatasetInfoSection {
  dataset_version_id: string;
  data_artifact_id: string;
  source_artifact_checksum: string;
  record_count: number;
  variable_count: number;
  variable_names: string[];
  created_at?: string;
  metadata?: Record<string, unknown>;
}

export interface DataQualitySection {
  total_records: number;
  valid_records: number;
  missing_values_count: number;
  missingness_percentage: number;
  outlier_count: number;
  quality_flags: string[];
}

export interface AppliedMethodItem {
  layer: 'D9' | 'D10' | 'D11' | 'D12' | 'D13' | 'RAW';
  method_name: string;
  parameters: Record<string, unknown>;
}

export interface MethodsSection {
  methods_applied: AppliedMethodItem[];
  default_alpha?: number;
  default_confidence_level?: number;
  software_version: string;
}

export interface DescriptiveSection {
  numeric_summaries?: Record<string, unknown>;
  categorical_summaries?: Record<string, unknown>;
  item_count: number;
}

export interface InferentialReportItem {
  analysis_id: string;
  test_type: string;
  null_hypothesis: string;
  alternative_hypothesis: string;
  statistic: number | null;
  degrees_of_freedom: number | null;
  p_value: number | null;
  alpha: number;
  decision: string;
  effect_size?: Record<string, unknown> | null;
  confidence_interval?: Record<string, unknown> | null;
}

export interface InferentialSection {
  tests: InferentialReportItem[];
  total_tests: number;
}

export interface RegressionReportItem {
  model_id: string;
  model_type: string;
  sample_size: number;
  r_squared: number | null;
  adjusted_r_squared: number | null;
  f_statistic: number | null;
  p_value: number | null;
  execution_status: string;
  coefficients: Array<{
    name: string;
    estimate: number;
    std_error: number | null;
    t_or_z: number | null;
    p_value: number | null;
  }>;
}

export interface RegressionSection {
  models: RegressionReportItem[];
  total_models: number;
}

export interface NonParametricReportItem {
  analysis_id: string;
  test_type: string;
  test_statistic: number | null;
  degrees_of_freedom: number | null;
  p_value: number | null;
  decision: string;
  effect_size?: Record<string, unknown> | null;
}

export interface NonParametricSection {
  tests: NonParametricReportItem[];
  total_tests: number;
}

export interface PowerReportItem {
  power_analysis_id: string;
  analysis_type: string;
  calculation_mode: string;
  alpha: number;
  target_power: number | null;
  effect_size: number | null;
  required_sample_size: number | null;
  achieved_power: number | null;
  minimum_detectable_effect: number | null;
}

export interface PowerSection {
  analyses: PowerReportItem[];
  total_analyses: number;
}

export interface AssumptionAuditItem {
  source_id: string;
  source_type: string;
  assumption: string;
  status: 'MET' | 'VIOLATED' | 'UNESTABLISHED' | 'AUDITED';
  details?: string;
}

export interface AssumptionAuditSection {
  items: AssumptionAuditItem[];
  total_audits: number;
}

export interface ReportProvenanceSection {
  report_id: string;
  dataset_version_id: string;
  data_artifact_id: string;
  source_artifact_checksum: string;
  source_analysis_hashes: Record<string, string>;
  engine_version: string;
  generated_at: string;
  provenance_hash: string;
}

export type ReportSectionType =
  | 'DATASET_INFO'
  | 'DATA_QUALITY'
  | 'METHODS'
  | 'DESCRIPTIVE'
  | 'INFERENTIAL'
  | 'REGRESSION'
  | 'NONPARAMETRIC'
  | 'POWER'
  | 'TABLES'
  | 'FIGURES'
  | 'ASSUMPTIONS'
  | 'WARNINGS'
  | 'PROVENANCE';

export interface ResearchReportRequest {
  report_id: string;
  dataset_version_id: string;
  data_artifact_id: string;
  title: string;
  description?: string;
  include_sections?: ReportSectionType[];
  source_analysis_results?: {
    d9?: string[];
    d10?: string[];
    d11?: string[];
    d12?: string[];
    d13?: string[];
  };
  visualization_ids?: string[];
  table_types?: ResearchTableType[];
  created_by?: string;
  created_at?: string;
  engine_version?: string;
}

export interface ResearchReportResult {
  report_id: string;
  dataset_version_id: string;
  data_artifact_id: string;
  source_artifact_checksum: string;
  title: string;
  description?: string;
  sections: {
    dataset_info?: DatasetInfoSection;
    data_quality?: DataQualitySection;
    methods?: MethodsSection;
    descriptive_statistics?: DescriptiveSection;
    inferential_statistics?: InferentialSection;
    regression_analysis?: RegressionSection;
    non_parametric_analysis?: NonParametricSection;
    power_analysis?: PowerSection;
    tables?: ResearchTable[];
    figures?: VisualizationResult[];
    assumption_audit?: AssumptionAuditSection;
    warnings?: string[];
    provenance?: ReportProvenanceSection;
  };
  scientific_validity: 'NOT_ESTABLISHED';
  created_at: string;
  engine_version: string;
  provenance_hash: string;
}

export type ReportErrorCode =
  | 'REPORT_DATASET_NOT_FOUND'
  | 'REPORT_ARTIFACT_NOT_FOUND'
  | 'REPORT_VERSION_MISMATCH'
  | 'REPORT_SOURCE_MISMATCH'
  | 'REPORT_INVALID_REQUEST'
  | 'REPORT_MISSING_SECTION'
  | 'REPORT_ANALYSIS_NOT_FOUND'
  | 'REPORT_NUMERICAL_ERROR';

export class ScientificReportError extends Error {
  readonly code: ReportErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: ReportErrorCode, message: string, details?: Record<string, unknown>) {
    super(`[${code}] ${message}`);
    this.name = 'ScientificReportError';
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, ScientificReportError.prototype);
  }
}

/**
 * Validates structural parameters of a ResearchReportRequest.
 */
export function validateReportRequest(request: ResearchReportRequest): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!request || typeof request !== 'object') {
    throw new ScientificReportError('REPORT_INVALID_REQUEST', 'Request must be a non-null object');
  }

  if (!request.report_id || typeof request.report_id !== 'string') {
    errors.push('report_id is required and must be a non-empty string');
  }

  if (!request.dataset_version_id || typeof request.dataset_version_id !== 'string') {
    errors.push('dataset_version_id is required and must be a non-empty string');
  }

  if (!request.data_artifact_id || typeof request.data_artifact_id !== 'string') {
    errors.push('data_artifact_id is required and must be a non-empty string');
  }

  if (!request.title || typeof request.title !== 'string') {
    errors.push('title is required and must be a non-empty string');
  }

  if (errors.length > 0) {
    throw new ScientificReportError(
      'REPORT_INVALID_REQUEST',
      `Report contract validation failed: ${errors.join('; ')}`,
      { errors }
    );
  }

  return { valid: true, errors: [] };
}

/**
 * Creates an immutable, deep-frozen ResearchReportResult.
 */
export function createResearchReportResult(result: ResearchReportResult): ResearchReportResult {
  return deepFreeze({
    ...result,
    scientific_validity: 'NOT_ESTABLISHED'
  });
}
