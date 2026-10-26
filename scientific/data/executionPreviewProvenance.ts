/**
 * NutriBodySim — Phase F2.2B: Execution Preview Provenance
 *
 * Implements deterministic canonical SHA-256 digest generation for ExecutionPreview snapshots.
 *
 * Invariants:
 * 1. Deterministic SHA-256 cryptographic hash using canonical JSON.
 * 2. Sensitive to every structural field (project, dataset, variables, alpha, config, module, errors/warnings).
 * 3. Does NOT include volatile values (created_at, local transient IDs) inside the logical hash.
 * 4. Zero dynamic code evaluation (no eval, no new Function).
 */

import * as crypto from 'crypto';
import { canonicalizeJson } from '../provenance/provenancePersistence';

export interface ExecutionPreviewProvenancePayload {
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
  readiness_status: 'READY' | 'BLOCKED';
  errors: string[];
  warnings: string[];
  resolved_parameter_set_id?: string;
  scientific_validity: 'NOT_ESTABLISHED';
}

/**
 * Computes deterministic SHA-256 provenance hash for an ExecutionPreview payload.
 */
export function computeExecutionPreviewProvenanceHash(
  payload: ExecutionPreviewProvenancePayload
): string {
  const normalized = {
    project_id: payload.project_id || '',
    project_version: payload.project_version || '',
    analysis_id: payload.analysis_id || '',
    analysis_plan_version: payload.analysis_plan_version || '1.0.0',
    dataset_version_id: payload.dataset_version_id || '',
    data_artifact_id: payload.data_artifact_id || '',
    source_artifact_checksum: payload.source_artifact_checksum || '',
    analysis_type: payload.analysis_type || '',
    objective_id: payload.objective_id || '',
    hypothesis_id: payload.hypothesis_id || null,
    input_variable_ids: [...(payload.input_variable_ids || [])].sort(),
    grouping_variable_ids: payload.grouping_variable_ids ? [...payload.grouping_variable_ids].sort() : [],
    pairing_variable_ids: payload.pairing_variable_ids ? [...payload.pairing_variable_ids].sort() : [],
    alpha: payload.alpha ?? null,
    confidence_level: payload.confidence_level ?? null,
    configuration: payload.configuration || {},
    resolved_module_id: payload.resolved_module_id || '',
    resolved_module_version: payload.resolved_module_version || '',
    readiness_status: payload.readiness_status,
    errors: [...(payload.errors || [])].sort(),
    warnings: [...(payload.warnings || [])].sort(),
    resolved_parameter_set_id: payload.resolved_parameter_set_id || null,
    scientific_validity: 'NOT_ESTABLISHED' as const
  };

  const canonicalString = canonicalizeJson(normalized);
  return crypto.createHash('sha256').update(canonicalString, 'utf8').digest('hex');
}
