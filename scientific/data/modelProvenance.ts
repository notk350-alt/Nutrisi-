/**
 * Phase D11 — Scientific Data Layer: Regression Model Provenance & Cryptographic Binding
 *
 * Reuses C8/D9/D10 provenance infrastructure to bind regression model outputs
 * to exact dataset versions, source artifact SHA-256 checksums, variable selections,
 * model configurations, and computed coefficients/metrics.
 */

import { computeProvenanceHash } from '../provenance/provenancePersistence';
import { RegressionModelRequest, RegressionModelResult } from './regressionContracts';

export interface ModelProvenancePayload {
  model_id: string;
  dataset_version_id: string;
  data_artifact_id: string;
  source_artifact_checksum: string | null;
  model_type: string;
  dependent_variable: string;
  independent_variables: string[];
  filters: unknown[];
  filter_group: unknown;
  configuration: Record<string, unknown>;
  sample_size: number;
  excluded_records: number;
  result_summary: {
    coefficients: Array<{ variable_name: string; coefficient: number }>;
    intercept: { variable_name: string; coefficient: number } | null;
    execution_status: string;
  };
  engine_version: string;
}

/**
 * Computes deterministic SHA-256 provenance hash for regression model result.
 */
export function generateModelProvenanceHash(options: {
  request: RegressionModelRequest;
  sourceArtifactChecksum: string | null;
  sampleSize: number;
  excludedRecords: number;
  coefficients: RegressionModelResult['coefficients'];
  intercept: RegressionModelResult['intercept'];
  executionStatus: string;
  engineVersion: string;
}): string {
  const {
    request,
    sourceArtifactChecksum,
    sampleSize,
    excludedRecords,
    coefficients,
    intercept,
    executionStatus,
    engineVersion
  } = options;

  const payload: ModelProvenancePayload = {
    model_id: request.model_id,
    dataset_version_id: request.dataset_version_id,
    data_artifact_id: request.data_artifact_id,
    source_artifact_checksum: sourceArtifactChecksum,
    model_type: request.model_type,
    dependent_variable: request.dependent_variable,
    independent_variables: request.independent_variables || [],
    filters: request.filters || [],
    filter_group: request.filter_group || null,
    configuration: (request.configuration as Record<string, unknown>) || {},
    sample_size: sampleSize,
    excluded_records: excludedRecords,
    result_summary: {
      coefficients: coefficients.map(c => ({ variable_name: c.variable_name, coefficient: c.coefficient })),
      intercept: intercept ? { variable_name: intercept.variable_name, coefficient: intercept.coefficient } : null,
      execution_status: executionStatus
    },
    engine_version: engineVersion
  };

  return computeProvenanceHash(payload);
}
