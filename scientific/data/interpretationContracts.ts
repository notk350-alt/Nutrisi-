/**
 * Phase D15 — Scientific Data Layer: Interpretation & Evidence Synthesis Governance Contracts
 *
 * Defines strongly typed contracts for:
 * 1. Interpretation Profiles (lifecycle governance, allowed/forbidden claims, threshold references)
 * 2. Interpretation Rules (declarative conditions, evidence levels, claim boundaries)
 * 3. Evidence Traces (auditable lineage from DatasetVersion -> Artifact -> Analysis -> Rule -> Interpretation)
 * 4. Governed Interpretation Results (deep-frozen, provenance-hashed, strictly non-causal by default)
 *
 * Invariants:
 * - Zero dynamic code execution (no eval, no new Function, no executable strings)
 * - Explicit separation of Statistical, Scientific, Clinical, and Causal interpretations
 * - Causality guard: observational evidence cannot claim causality
 * - Scientific validity remains 'NOT_ESTABLISHED'
 */

import { deepFreeze } from './dataStatePipeline';

export type ClaimType =
  | 'DESCRIPTIVE_CLAIM'
  | 'STATISTICAL_CLAIM'
  | 'ASSOCIATION_CLAIM'
  | 'PREDICTIVE_CLAIM'
  | 'CLINICAL_CLAIM'
  | 'BIOLOGICAL_CLAIM'
  | 'CAUSAL_CLAIM'
  | 'DIAGNOSTIC_CLAIM';

export type EvidenceStatus =
  | 'SUPPORTED'
  | 'PARTIALLY_SUPPORTED'
  | 'NOT_ESTABLISHED'
  | 'CONTRADICTED'
  | 'INSUFFICIENT_EVIDENCE';

export type InterpretationCategory =
  | 'STATISTICAL_INTERPRETATION'
  | 'SCIENTIFIC_INTERPRETATION'
  | 'CLINICAL_INTERPRETATION'
  | 'CAUSAL_INTERPRETATION';

export type ProfileStatus =
  | 'DRAFT'
  | 'REVIEW'
  | 'APPROVED'
  | 'DEPRECATED';

export type RuleStatus =
  | 'DRAFT'
  | 'ACTIVE'
  | 'INACTIVE'
  | 'DEPRECATED';

export type EvidenceLevel =
  | 'EXPLORATORY'
  | 'PRELIMINARY'
  | 'CORRELATIONAL'
  | 'SYSTEMATIC'
  | 'CONFIRMATORY';

export type InterpretationInputType =
  | 'D9_DESCRIPTIVE'
  | 'D10_INFERENTIAL'
  | 'D11_REGRESSION'
  | 'D12_POWER'
  | 'D13_NONPARAMETRIC'
  | 'D14_REPORT'
  | 'RAW_OBSERVATION';

export type ConditionOperator =
  | 'LT'
  | 'LTE'
  | 'GT'
  | 'GTE'
  | 'EQ'
  | 'NEQ'
  | 'BETWEEN'
  | 'IN'
  | 'NOT_IN'
  | 'CONTAINS';

export interface DeclarativeCondition {
  field: string;
  operator: ConditionOperator;
  value: unknown;
  secondary_value?: unknown;
}

export interface RuleConditionGroup {
  logic: 'AND' | 'OR';
  conditions: DeclarativeCondition[];
}

export interface GovernanceMetadata {
  reviewed_by?: string;
  reviewed_at?: string;
  approved_by?: string;
  approved_at?: string;
  approval_notes?: string;
  source_reference?: string;
}

export interface EffectSizeThresholdConfig {
  metric: string;
  weak: number;
  moderate: number;
  strong: number;
  source_reference: string;
}

export interface ClassificationStandardConfig {
  standard_name: string;
  target_variable: string;
  population?: string;
  reference_source: string;
  categories: Array<{
    label: string;
    min?: number;
    max?: number;
    min_inclusive?: boolean;
    max_inclusive?: boolean;
    description: string;
  }>;
}

export interface InterpretationProfile {
  profile_id: string;
  profile_version: string;
  name: string;
  description: string;
  domain: string;
  rules: GovernedInterpretationRule[];
  allowed_claim_types: ClaimType[];
  forbidden_claim_types: ClaimType[];
  source_references: Array<{
    title: string;
    citation: string;
    uri?: string;
    doi?: string;
  }>;
  status: ProfileStatus;
  created_by: string;
  created_at: string;
  updated_at: string;
  governance_metadata?: GovernanceMetadata;
  effect_size_thresholds?: Record<string, EffectSizeThresholdConfig>;
  classification_standards?: Record<string, ClassificationStandardConfig>;
  metadata?: Record<string, unknown>;
}

export interface RuleOutputInterpretation {
  statement_template: string;
  conclusion_code: string;
  statistical_decision?: 'REJECT_NULL' | 'DO_NOT_REJECT_NULL' | 'INCONCLUSIVE';
  effect_magnitude?: string;
  clinical_meaning?: string;
  qualifiers?: string[];
}

export interface GovernedInterpretationRule {
  rule_id: string;
  profile_id: string;
  rule_version: string;
  name: string;
  description: string;
  input_type: InterpretationInputType;
  target_variable_or_test?: string;
  category: InterpretationCategory;
  claim_type: ClaimType;
  evidence_level: EvidenceLevel;
  conditions: RuleConditionGroup;
  output_interpretation: RuleOutputInterpretation;
  limitations: string[];
  source_reference: string;
  status: RuleStatus;
  requires_governance_approval?: boolean;
}

export type InterpretationRule = GovernedInterpretationRule;

export interface MatchedConditionTrace {
  field: string;
  operator: ConditionOperator;
  expected: unknown;
  actual: unknown;
  satisfied: boolean;
}

export interface EvidenceTrace {
  interpretation_id: string;
  rule_id: string;
  profile_id: string;
  profile_version: string;
  dataset_version_id: string;
  data_artifact_id: string;
  source_artifact_checksum: string;
  source_analysis_ids: string[];
  source_visualization_ids?: string[];
  source_report_id?: string;
  input_snapshot: Record<string, unknown>;
  matched_conditions: MatchedConditionTrace[];
  output_interpretation: Record<string, unknown>;
  claim_type: ClaimType;
  evidence_status: EvidenceStatus;
  limitations: string[];
  created_at: string;
  engine_version: string;
  provenance_hash: string;
}

export interface InterpretationResult {
  interpretation_id: string;
  source_analysis_ids: string[];
  dataset_version_id: string;
  data_artifact_id: string;
  source_artifact_checksum: string;
  profile_id: string;
  profile_version: string;
  rule_id: string;
  rule_version: string;
  interpretation_text: string;
  structured_findings: Record<string, unknown>;
  category: InterpretationCategory;
  claim_type: ClaimType;
  evidence_status: EvidenceStatus;
  statistical_evidence: Record<string, unknown>;
  limitations: string[];
  warnings: string[];
  trace: EvidenceTrace;
  provenance_hash: string;
  scientific_validity: 'NOT_ESTABLISHED';
  created_at: string;
  engine_version: string;
}

export interface InterpretationConflictResult {
  status: 'INTERPRETATION_CONFLICT';
  conflicting_rules: Array<{
    rule_id: string;
    profile_id: string;
    rule_version: string;
    claim_type: ClaimType;
    output: RuleOutputInterpretation;
  }>;
  message: string;
  requires_human_resolution: true;
}

export type InterpretationErrorCode =
  | 'INTERPRETATION_INVALID_PROFILE'
  | 'INTERPRETATION_INVALID_RULE'
  | 'INTERPRETATION_INVALID_LIFECYCLE_TRANSITION'
  | 'INTERPRETATION_UNAPPROVED_PROFILE'
  | 'INTERPRETATION_FORBIDDEN_CLAIM_TYPE'
  | 'INTERPRETATION_CAUSAL_VIOLATION'
  | 'INTERPRETATION_CONFLICT'
  | 'INTERPRETATION_SOURCE_MISMATCH'
  | 'INTERPRETATION_ANALYSIS_NOT_FOUND'
  | 'INTERPRETATION_INSUFFICIENT_EVIDENCE'
  | 'INTERPRETATION_MISSING_DATA'
  | 'INTERPRETATION_SECURITY_VIOLATION'
  | 'INTERPRETATION_INVALID_CONTRACT';

export class ScientificInterpretationError extends Error {
  readonly code: InterpretationErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: InterpretationErrorCode, message: string, details?: Record<string, unknown>) {
    super(`[${code}] ${message}`);
    this.name = 'ScientificInterpretationError';
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, ScientificInterpretationError.prototype);
  }
}

/**
 * Validates structural integrity of an InterpretationProfile.
 */
export function validateInterpretationProfile(profile: InterpretationProfile): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!profile || typeof profile !== 'object') {
    throw new ScientificInterpretationError(
      'INTERPRETATION_INVALID_PROFILE',
      'InterpretationProfile must be a non-null object'
    );
  }

  if (!profile.profile_id || typeof profile.profile_id !== 'string') {
    errors.push('profile_id is required and must be a non-empty string');
  }

  if (!profile.profile_version || typeof profile.profile_version !== 'string') {
    errors.push('profile_version is required and must be a non-empty string');
  }

  if (!profile.name || typeof profile.name !== 'string') {
    errors.push('name is required and must be a non-empty string');
  }

  const validStatuses: ProfileStatus[] = ['DRAFT', 'REVIEW', 'APPROVED', 'DEPRECATED'];
  if (!validStatuses.includes(profile.status)) {
    errors.push(`status must be one of: ${validStatuses.join(', ')}`);
  }

  if (!Array.isArray(profile.rules)) {
    errors.push('rules must be an array');
  }

  if (!Array.isArray(profile.allowed_claim_types)) {
    errors.push('allowed_claim_types must be an array');
  }

  if (!Array.isArray(profile.forbidden_claim_types)) {
    errors.push('forbidden_claim_types must be an array');
  }

  if (profile.status === 'APPROVED') {
    if (!profile.governance_metadata?.approved_by) {
      errors.push('APPROVED status requires governance_metadata.approved_by');
    }
    if (!profile.governance_metadata?.approved_at) {
      errors.push('APPROVED status requires governance_metadata.approved_at');
    }
    if (!profile.governance_metadata?.source_reference && (!profile.source_references || profile.source_references.length === 0)) {
      errors.push('APPROVED status requires at least one source reference or governance source_reference');
    }
  }

  if (errors.length > 0) {
    throw new ScientificInterpretationError(
      'INTERPRETATION_INVALID_PROFILE',
      `Profile validation failed: ${errors.join('; ')}`,
      { errors }
    );
  }

  return { valid: true, errors: [] };
}

/**
 * Validates structural integrity of a GovernedInterpretationRule.
 */
export function validateInterpretationRule(rule: GovernedInterpretationRule): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!rule || typeof rule !== 'object') {
    throw new ScientificInterpretationError(
      'INTERPRETATION_INVALID_RULE',
      'InterpretationRule must be a non-null object'
    );
  }

  if (!rule.rule_id || typeof rule.rule_id !== 'string') {
    errors.push('rule_id is required');
  }

  if (!rule.profile_id || typeof rule.profile_id !== 'string') {
    errors.push('profile_id is required');
  }

  if (!rule.rule_version || typeof rule.rule_version !== 'string') {
    errors.push('rule_version is required');
  }

  if (!rule.input_type || typeof rule.input_type !== 'string') {
    errors.push('input_type is required');
  }

  if (!rule.conditions || !Array.isArray(rule.conditions.conditions)) {
    errors.push('conditions must contain a valid conditions array');
  }

  if (!rule.output_interpretation || !rule.output_interpretation.conclusion_code) {
    errors.push('output_interpretation with conclusion_code is required');
  }

  if (!rule.claim_type) {
    errors.push('claim_type is required');
  }

  if (errors.length > 0) {
    throw new ScientificInterpretationError(
      'INTERPRETATION_INVALID_RULE',
      `Rule validation failed: ${errors.join('; ')}`,
      { errors }
    );
  }

  return { valid: true, errors: [] };
}

/**
 * Creates an immutable, deep-frozen InterpretationResult.
 */
export function createInterpretationResult(result: InterpretationResult): InterpretationResult {
  return deepFreeze({
    ...result,
    scientific_validity: 'NOT_ESTABLISHED'
  });
}
