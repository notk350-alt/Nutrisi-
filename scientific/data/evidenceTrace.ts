/**
 * Phase D15 — Scientific Data Layer: Evidence Trace Engine
 *
 * Implements deterministic evidence traceability across the pipeline:
 * Interpretation -> Rule -> Analysis -> DataArtifact -> DatasetVersion
 *
 * Invariants:
 * - Deterministic SHA-256 provenance hashing
 * - Immutable, deep-frozen trace records
 * - Complete input snapshot and condition audit
 */

import {
  EvidenceStatus,
  EvidenceTrace,
  MatchedConditionTrace,
  GovernedInterpretationRule,
  InterpretationProfile
} from './interpretationContracts';
import { deepFreeze } from './dataStatePipeline';
import { computeProvenanceHash } from '../provenance/provenancePersistence';

export interface BuildEvidenceTraceOptions {
  interpretation_id: string;
  rule: GovernedInterpretationRule;
  profile: InterpretationProfile;
  dataset_version_id: string;
  data_artifact_id: string;
  source_artifact_checksum: string;
  source_analysis_ids: string[];
  source_visualization_ids?: string[];
  source_report_id?: string;
  input_snapshot: Record<string, unknown>;
  matched_conditions: MatchedConditionTrace[];
  output_interpretation: Record<string, unknown>;
  evidence_status: EvidenceStatus;
  limitations: string[];
  created_at?: string;
  engine_version?: string;
}

export class EvidenceTraceEngine {
  public static readonly ENGINE_VERSION = '1.0.0';

  /**
   * Constructs an immutable, cryptographically verifiable EvidenceTrace.
   */
  public static buildTrace(options: BuildEvidenceTraceOptions): EvidenceTrace {
    const createdAt = options.created_at ?? new Date().toISOString();
    const engineVersion = options.engine_version ?? EvidenceTraceEngine.ENGINE_VERSION;

    const provenancePayload = {
      interpretation_id: options.interpretation_id,
      rule_id: options.rule.rule_id,
      rule_version: options.rule.rule_version,
      profile_id: options.profile.profile_id,
      profile_version: options.profile.profile_version,
      dataset_version_id: options.dataset_version_id,
      data_artifact_id: options.data_artifact_id,
      source_artifact_checksum: options.source_artifact_checksum,
      source_analysis_ids: [...options.source_analysis_ids].sort(),
      source_visualization_ids: options.source_visualization_ids ? [...options.source_visualization_ids].sort() : [],
      source_report_id: options.source_report_id ?? null,
      input_snapshot: options.input_snapshot,
      matched_conditions: options.matched_conditions,
      output_interpretation: options.output_interpretation,
      claim_type: options.rule.claim_type,
      evidence_status: options.evidence_status,
      limitations: [...options.limitations].sort(),
      engine_version: engineVersion
    };

    const provenanceHash = computeProvenanceHash(provenancePayload);

    const trace: EvidenceTrace = {
      interpretation_id: options.interpretation_id,
      rule_id: options.rule.rule_id,
      profile_id: options.profile.profile_id,
      profile_version: options.profile.profile_version,
      dataset_version_id: options.dataset_version_id,
      data_artifact_id: options.data_artifact_id,
      source_artifact_checksum: options.source_artifact_checksum,
      source_analysis_ids: options.source_analysis_ids,
      source_visualization_ids: options.source_visualization_ids,
      source_report_id: options.source_report_id,
      input_snapshot: options.input_snapshot,
      matched_conditions: options.matched_conditions,
      output_interpretation: options.output_interpretation,
      claim_type: options.rule.claim_type,
      evidence_status: options.evidence_status,
      limitations: options.limitations,
      created_at: createdAt,
      engine_version: engineVersion,
      provenance_hash: provenanceHash
    };

    return deepFreeze(trace);
  }
}
