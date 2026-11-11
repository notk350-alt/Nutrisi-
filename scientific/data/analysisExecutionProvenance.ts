/**
 * NutriBodySim — Phase F2.2A: Analysis Execution Request Provenance
 *
 * Implements deterministic canonical provenance digest generation for AnalysisExecutionRequest.
 *
 * Invariants:
 * 1. Deterministic SHA-256 cryptographic hash using canonical JSON.
 * 2. Sensitive to every structural field (project, dataset, variables, alpha, config, module).
 * 3. Zero dynamic code evaluation (no eval, no new Function).
 */

import { sha256Hex } from '../crypto';
import { canonicalizeJson } from '../provenance/provenancePersistence';

export interface AnalysisExecutionProvenancePayload {
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
  resolved_module_id: string;
  resolved_module_version: string;
  scientific_validity: 'NOT_ESTABLISHED';
}

/**
 * Computes deterministic SHA-256 provenance hash for an AnalysisExecutionRequest payload.
 */
export function computeExecutionRequestProvenanceHash(
  payload: AnalysisExecutionProvenancePayload
): string {
  // Sort array fields deterministically for canonical consistency
  const normalized = {
    project_id: payload.project_id,
    project_version: payload.project_version,
    analysis_id: payload.analysis_id,
    analysis_plan_version: payload.analysis_plan_version,
    dataset_version_id: payload.dataset_version_id,
    data_artifact_id: payload.data_artifact_id,
    source_artifact_checksum: payload.source_artifact_checksum,
    analysis_type: payload.analysis_type,
    objective_id: payload.objective_id,
    hypothesis_id: payload.hypothesis_id || null,
    input_variable_ids: [...payload.input_variable_ids].sort(),
    grouping_variable_ids: payload.grouping_variable_ids ? [...payload.grouping_variable_ids].sort() : [],
    pairing_variable_ids: payload.pairing_variable_ids ? [...payload.pairing_variable_ids].sort() : [],
    alpha: payload.alpha ?? null,
    confidence_level: payload.confidence_level ?? null,
    configuration: payload.configuration || {},
    resolved_module_id: payload.resolved_module_id,
    resolved_module_version: payload.resolved_module_version,
    scientific_validity: 'NOT_ESTABLISHED' as const
  };

  const canonicalString = canonicalizeJson(normalized);
  return sha256Hex(canonicalString);
}
