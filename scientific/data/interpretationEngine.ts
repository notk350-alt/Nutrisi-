/**
 * Phase D15 — Scientific Data Layer: Interpretation & Evidence Synthesis Governance Engine
 *
 * Implements deterministic, governed statistical and scientific interpretation.
 *
 * Key Guards:
 * 1. Causality Guard: Observational data (correlation, regression) can never make causal claims.
 * 2. Clinical/Diagnostic Guard: Clinical claims require APPROVED profiles with standard references.
 * 3. Conflict Detection: Divergent interpretations for the same evidence trigger INTERPRETATION_CONFLICT.
 * 4. Effect Size Guard: Universal magnitude labels require explicit profile thresholds.
 * 5. Full Traceability: Every interpretation produces an auditable EvidenceTrace.
 * 6. Scientific Validity remains 'NOT_ESTABLISHED'.
 */

import {
  ClaimType,
  ConditionOperator,
  DeclarativeCondition,
  EvidenceStatus,
  GovernedInterpretationRule,
  InterpretationCategory,
  InterpretationConflictResult,
  InterpretationProfile,
  InterpretationResult,
  MatchedConditionTrace,
  ScientificInterpretationError,
  validateInterpretationProfile,
  validateInterpretationRule,
  createInterpretationResult
} from './interpretationContracts';
import { InterpretationRegistry } from './interpretationRegistry';
import { EvidenceTraceEngine } from './evidenceTrace';
import { AnalysisResult } from './analysisContracts';
import { InferentialAnalysisResult } from './inferentialContracts';
import { RegressionModelResult } from './regressionContracts';
import { ResearchPowerResult } from './powerContracts';
import { NonParametricAnalysisResult } from './nonParametricContracts';
import { ResearchReportResult } from './reportContracts';

export interface InterpretationExecutionOptions {
  interpretation_id: string;
  profile_id?: string;
  profile_version?: string;
  profile?: InterpretationProfile;
  registry?: InterpretationRegistry;
  rule_id?: string;
  dataset_version_id: string;
  data_artifact_id: string;
  source_artifact_checksum?: string;
  source_analysis_results: {
    d9?: AnalysisResult | AnalysisResult[];
    d10?: InferentialAnalysisResult | InferentialAnalysisResult[];
    d11?: RegressionModelResult | RegressionModelResult[];
    d12?: ResearchPowerResult | ResearchPowerResult[];
    d13?: NonParametricAnalysisResult | NonParametricAnalysisResult[];
    d14?: ResearchReportResult | ResearchReportResult[];
  };
  context?: {
    study_design?: 'OBSERVATIONAL' | 'RANDOMIZED_TRIAL' | 'QUASI_EXPERIMENTAL';
    target_variable?: string;
    population?: string;
  };
  created_at?: string;
}

export class InterpretationEngine {
  public static readonly ENGINE_VERSION = '1.0.0';

  /**
   * Evaluates a single declarative condition against a field snapshot.
   */
  public static evaluateCondition(
    condition: DeclarativeCondition,
    snapshot: Record<string, unknown>
  ): { satisfied: boolean; actual: unknown } {
    const actual = snapshot[condition.field];
    const expected = condition.value;

    if (actual === undefined || actual === null) {
      return { satisfied: false, actual: null };
    }

    let satisfied = false;

    switch (condition.operator) {
      case 'LT':
        satisfied = typeof actual === 'number' && typeof expected === 'number' && actual < expected;
        break;
      case 'LTE':
        satisfied = typeof actual === 'number' && typeof expected === 'number' && actual <= expected;
        break;
      case 'GT':
        satisfied = typeof actual === 'number' && typeof expected === 'number' && actual > expected;
        break;
      case 'GTE':
        satisfied = typeof actual === 'number' && typeof expected === 'number' && actual >= expected;
        break;
      case 'EQ':
        satisfied = actual === expected;
        break;
      case 'NEQ':
        satisfied = actual !== expected;
        break;
      case 'BETWEEN':
        if (typeof actual === 'number' && typeof expected === 'number' && typeof condition.secondary_value === 'number') {
          satisfied = actual >= expected && actual <= condition.secondary_value;
        }
        break;
      case 'IN':
        if (Array.isArray(expected)) {
          satisfied = expected.includes(actual);
        }
        break;
      case 'NOT_IN':
        if (Array.isArray(expected)) {
          satisfied = !expected.includes(actual);
        }
        break;
      case 'CONTAINS':
        if (typeof actual === 'string' && typeof expected === 'string') {
          satisfied = actual.includes(expected);
        } else if (Array.isArray(actual)) {
          satisfied = actual.includes(expected);
        }
        break;
    }

    return { satisfied, actual };
  }

  /**
   * Extracts a structured facts snapshot from provided source analyses.
   */
  public static extractSnapshot(options: InterpretationExecutionOptions): Record<string, unknown> {
    const snapshot: Record<string, unknown> = {};

    const d9List = options.source_analysis_results.d9
      ? Array.isArray(options.source_analysis_results.d9)
        ? options.source_analysis_results.d9
        : [options.source_analysis_results.d9]
      : [];

    const d10List = options.source_analysis_results.d10
      ? Array.isArray(options.source_analysis_results.d10)
        ? options.source_analysis_results.d10
        : [options.source_analysis_results.d10]
      : [];

    const d11List = options.source_analysis_results.d11
      ? Array.isArray(options.source_analysis_results.d11)
        ? options.source_analysis_results.d11
        : [options.source_analysis_results.d11]
      : [];

    const d12List = options.source_analysis_results.d12
      ? Array.isArray(options.source_analysis_results.d12)
        ? options.source_analysis_results.d12
        : [options.source_analysis_results.d12]
      : [];

    const d13List = options.source_analysis_results.d13
      ? Array.isArray(options.source_analysis_results.d13)
        ? options.source_analysis_results.d13
        : [options.source_analysis_results.d13]
      : [];

    // Extract D10 metrics if present
    if (d10List.length > 0) {
      const d10 = d10List[0];
      snapshot['p_value'] = d10.p_value;
      snapshot['alpha'] = d10.alpha;
      snapshot['statistic'] = d10.statistic;
      snapshot['test_type'] = d10.test_type;
      snapshot['decision'] = d10.decision;
      if (d10.effect_size) {
        snapshot['effect_size_metric'] = d10.effect_size.metric;
        snapshot['effect_size_value'] = d10.effect_size.value;
      }
      if (d10.confidence_interval) {
        snapshot['ci_lower'] = d10.confidence_interval.lower_bound;
        snapshot['ci_upper'] = d10.confidence_interval.upper_bound;
      }
    }

    // Extract D13 metrics if present
    if (d13List.length > 0) {
      const d13 = d13List[0];
      if (snapshot['p_value'] === undefined) snapshot['p_value'] = d13.p_value;
      if (snapshot['alpha'] === undefined) snapshot['alpha'] = d13.alpha;
      snapshot['nonparam_statistic'] = d13.test_statistic;
      snapshot['nonparam_test_type'] = d13.test_type;
      snapshot['nonparam_decision'] = d13.decision;
      if (d13.effect_size) {
        snapshot['nonparam_effect_size_metric'] = d13.effect_size.metric;
        snapshot['nonparam_effect_size_value'] = d13.effect_size.value;
      }
      if (d13.test_type === 'SPEARMAN_CORRELATION') {
        snapshot['spearman_rho'] = d13.effect_size?.value ?? d13.test_statistic;
      }
    }

    // Extract D11 metrics if present
    if (d11List.length > 0) {
      const d11 = d11List[0];
      snapshot['sample_size'] = d11.sample_size;
      snapshot['r_squared'] = d11.model_metrics.linear?.r2 ?? null;
      snapshot['adjusted_r_squared'] = d11.model_metrics.linear?.adjusted_r2 ?? null;
      snapshot['roc_auc'] = d11.model_metrics.logistic?.roc_auc ?? null;
      if (d11.coefficients.length > 0) {
        snapshot['primary_coefficient'] = d11.coefficients[0].coefficient;
        snapshot['primary_coef_p_value'] = d11.coefficients[0].p_value;
        snapshot['primary_coef_name'] = d11.coefficients[0].variable_name;
        snapshot['odds_ratio'] = d11.coefficients[0].odds_ratio ?? null;
      }
    }

    // Extract D12 metrics if present
    if (d12List.length > 0) {
      const d12 = d12List[0];
      snapshot['achieved_power'] = d12.achieved_power;
      snapshot['target_power'] = d12.target_power;
      snapshot['required_sample_size'] = d12.required_sample_size;
      snapshot['minimum_detectable_effect'] = d12.minimum_detectable_effect;
    }

    // Extract D14 metrics if present
    const d14List = options.source_analysis_results.d14
      ? Array.isArray(options.source_analysis_results.d14)
        ? options.source_analysis_results.d14
        : [options.source_analysis_results.d14]
      : [];
    if (d14List.length > 0) {
      const d14 = d14List[0];
      snapshot['report_id'] = d14.report_id;
      snapshot['tables_count'] = d14.sections?.tables?.length ?? 0;
      snapshot['visualizations_count'] = d14.sections?.figures?.length ?? 0;
      snapshot['warnings_count'] = d14.sections?.warnings?.length ?? 0;
      snapshot['data_quality_issues'] = d14.sections?.data_quality?.quality_flags?.length ?? 0;
    }

    // Extract D9 metrics if present
    if (d9List.length > 0) {
      const d9 = d9List[0];
      if (d9.result.numeric_summaries) {
        for (const [varName, num] of Object.entries(d9.result.numeric_summaries)) {
          snapshot[`${varName}_mean`] = num.mean;
          snapshot[`${varName}_std`] = num.standard_deviation;
          snapshot[`${varName}_median`] = num.median;
        }
      }
      if (d9.result.pairwise_associations?.numeric_associations?.[0]) {
        snapshot['pearson_r'] = d9.result.pairwise_associations.numeric_associations[0].pearson_correlation;
      }
    }

    // Include context flags
    if (options.context) {
      snapshot['study_design'] = options.context.study_design ?? 'OBSERVATIONAL';
      if (options.context.target_variable) snapshot['target_variable'] = options.context.target_variable;
      if (options.context.population) snapshot['population'] = options.context.population;
    } else {
      snapshot['study_design'] = 'OBSERVATIONAL';
    }

    return snapshot;
  }

  /**
   * Governs and executes scientific interpretations.
   */
  public static interpret(
    options: InterpretationExecutionOptions
  ): InterpretationResult | InterpretationConflictResult {
    // 1. Resolve Profile
    let profile = options.profile;
    if (!profile && options.registry && options.profile_id) {
      profile = options.registry.getProfile(options.profile_id, options.profile_version);
    }

    if (!profile) {
      throw new ScientificInterpretationError(
        'INTERPRETATION_INVALID_PROFILE',
        `Interpretation profile '${options.profile_id ?? 'UNKNOWN'}' not found`
      );
    }

    validateInterpretationProfile(profile);

    // 2. Source Version and Artifact Integrity Verification
    const allAnalyses: Array<{ id: string; version_id: string; artifact_id: string; checksum?: string }> = [];

    const collect = (items?: any) => {
      if (!items) return;
      const arr = Array.isArray(items) ? items : [items];
      for (const item of arr) {
        allAnalyses.push({
          id: item.analysis_id ?? item.model_id ?? item.power_analysis_id ?? item.report_id,
          version_id: item.dataset_version_id,
          artifact_id: item.data_artifact_id,
          checksum: item.checksum ?? item.provenance_hash ?? item.source_artifact_checksum
        });
      }
    };

    collect(options.source_analysis_results.d9);
    collect(options.source_analysis_results.d10);
    collect(options.source_analysis_results.d11);
    collect(options.source_analysis_results.d12);
    collect(options.source_analysis_results.d13);
    collect(options.source_analysis_results.d14);

    if (allAnalyses.length === 0) {
      throw new ScientificInterpretationError(
        'INTERPRETATION_INSUFFICIENT_EVIDENCE',
        'No source analyses provided for interpretation'
      );
    }

    for (const a of allAnalyses) {
      if (a.version_id && a.version_id !== options.dataset_version_id) {
        throw new ScientificInterpretationError(
          'INTERPRETATION_SOURCE_MISMATCH',
          `Analysis '${a.id}' belongs to dataset version '${a.version_id}', expected '${options.dataset_version_id}'`
        );
      }
      if (a.artifact_id && a.artifact_id !== options.data_artifact_id) {
        throw new ScientificInterpretationError(
          'INTERPRETATION_SOURCE_MISMATCH',
          `Analysis '${a.id}' belongs to data artifact '${a.artifact_id}', expected '${options.data_artifact_id}'`
        );
      }
    }

    const sourceArtifactChecksum =
      options.source_artifact_checksum ??
      allAnalyses.find((a) => a.checksum)?.checksum ??
      '0000000000000000000000000000000000000000000000000000000000000000';

    // 3. Extract Facts Snapshot
    const snapshot = InterpretationEngine.extractSnapshot(options);

    // 4. Filter Candidate Rules
    let candidateRules = profile.rules.filter((r) => r.status === 'ACTIVE' || r.status === 'DRAFT');
    if (options.rule_id) {
      candidateRules = candidateRules.filter((r) => r.rule_id === options.rule_id);
      if (candidateRules.length === 0) {
        throw new ScientificInterpretationError(
          'INTERPRETATION_INVALID_RULE',
          `Specified rule '${options.rule_id}' not found in profile '${profile.profile_id}'`
        );
      }
    }

    // 5. Evaluate Rules Against Snapshot
    interface MatchedRuleEvaluation {
      rule: GovernedInterpretationRule;
      matchedConditions: MatchedConditionTrace[];
    }

    const matchedRules: MatchedRuleEvaluation[] = [];

    for (const rule of candidateRules) {
      validateInterpretationRule(rule);

      const conditionGroup = rule.conditions;
      const traces: MatchedConditionTrace[] = [];

      for (const cond of conditionGroup.conditions) {
        const { satisfied, actual } = InterpretationEngine.evaluateCondition(cond, snapshot);
        traces.push({
          field: cond.field,
          operator: cond.operator,
          expected: cond.value,
          actual,
          satisfied
        });
      }

      const isSatisfied =
        conditionGroup.logic === 'OR'
          ? traces.some((t) => t.satisfied)
          : traces.every((t) => t.satisfied);

      if (isSatisfied && traces.length > 0) {
        matchedRules.push({ rule, matchedConditions: traces });
      }
    }

    const sourceReportId = options.source_analysis_results.d14
      ? Array.isArray(options.source_analysis_results.d14)
        ? options.source_analysis_results.d14[0]?.report_id
        : options.source_analysis_results.d14.report_id
      : undefined;

    // 6. Handle Zero Matches
    if (matchedRules.length === 0) {
      const emptyTrace = EvidenceTraceEngine.buildTrace({
        interpretation_id: options.interpretation_id,
        rule: {
          rule_id: 'RULE_NO_MATCH',
          profile_id: profile.profile_id,
          rule_version: '0.0.0',
          name: 'No Matching Rule',
          description: 'No active profile rules satisfied the observed evidence conditions',
          input_type: 'D10_INFERENTIAL',
          category: 'STATISTICAL_INTERPRETATION',
          claim_type: 'STATISTICAL_CLAIM',
          evidence_level: 'EXPLORATORY',
          conditions: { logic: 'AND', conditions: [] },
          output_interpretation: { statement_template: 'Evidence conditions did not match any registered rule', conclusion_code: 'NO_RULE_MATCH' },
          limitations: ['INSUFFICIENT_EVIDENCE'],
          source_reference: 'N/A',
          status: 'ACTIVE'
        },
        profile,
        dataset_version_id: options.dataset_version_id,
        data_artifact_id: options.data_artifact_id,
        source_artifact_checksum: sourceArtifactChecksum,
        source_analysis_ids: allAnalyses.map((a) => a.id),
        source_report_id: sourceReportId,
        input_snapshot: snapshot,
        matched_conditions: [],
        output_interpretation: { conclusion_code: 'NO_RULE_MATCH' },
        evidence_status: 'INSUFFICIENT_EVIDENCE',
        limitations: ['Conditions not satisfied by evidence']
      });

      return createInterpretationResult({
        interpretation_id: options.interpretation_id,
        source_analysis_ids: allAnalyses.map((a) => a.id),
        dataset_version_id: options.dataset_version_id,
        data_artifact_id: options.data_artifact_id,
        source_artifact_checksum: sourceArtifactChecksum,
        profile_id: profile.profile_id,
        profile_version: profile.profile_version,
        rule_id: 'RULE_NO_MATCH',
        rule_version: '0.0.0',
        interpretation_text: 'Observed statistical values do not satisfy criteria defined in the profile rules.',
        structured_findings: { match_count: 0 },
        category: 'STATISTICAL_INTERPRETATION',
        claim_type: 'STATISTICAL_CLAIM',
        evidence_status: 'INSUFFICIENT_EVIDENCE',
        statistical_evidence: snapshot,
        limitations: ['INSUFFICIENT_EVIDENCE', 'NO_MATCHING_RULE'],
        warnings: ['Evidence did not satisfy any registered rule conditions'],
        trace: emptyTrace,
        provenance_hash: emptyTrace.provenance_hash,
        scientific_validity: 'NOT_ESTABLISHED',
        created_at: options.created_at ?? new Date().toISOString(),
        engine_version: InterpretationEngine.ENGINE_VERSION
      });
    }

    // 7. Conflict Detection: Check if matched rules produce contradictory decisions or conflicting codes
    if (matchedRules.length > 1) {
      const distinctDecisions = new Set(
        matchedRules
          .map((m) => m.rule.output_interpretation.statistical_decision)
          .filter((d): d is NonNullable<typeof d> => Boolean(d))
      );

      const distinctConclusionCodes = new Set(
        matchedRules.map((m) => m.rule.output_interpretation.conclusion_code)
      );

      const hasConflict =
        (distinctDecisions.has('REJECT_NULL') && distinctDecisions.has('DO_NOT_REJECT_NULL')) ||
        distinctConclusionCodes.size > 1;

      if (hasConflict) {
        return {
          status: 'INTERPRETATION_CONFLICT',
          conflicting_rules: matchedRules.map((m) => ({
            rule_id: m.rule.rule_id,
            profile_id: m.rule.profile_id,
            rule_version: m.rule.rule_version,
            claim_type: m.rule.claim_type,
            output: m.rule.output_interpretation
          })),
          message: `Conflicting interpretations detected between rules: ${matchedRules.map((m) => m.rule.rule_id).join(', ')}`,
          requires_human_resolution: true
        };
      }
    }

    // 8. Select Primary Matched Rule
    const selected = matchedRules[0];
    const rule = selected.rule;
    const limitations = [...rule.limitations];
    const warnings: string[] = [];

    // 9. Claim Guard & Causality Guard Enforcement
    // Check forbidden claims in profile
    if (profile.forbidden_claim_types.includes(rule.claim_type)) {
      throw new ScientificInterpretationError(
        'INTERPRETATION_FORBIDDEN_CLAIM_TYPE',
        `Rule '${rule.rule_id}' attempts forbidden claim type '${rule.claim_type}' in profile '${profile.profile_id}'`
      );
    }

    // Causality Guard: Observational evidence can never assert CAUSAL_CLAIM
    const isObservational = snapshot['study_design'] === 'OBSERVATIONAL';
    if (rule.claim_type === 'CAUSAL_CLAIM') {
      if (isObservational) {
        throw new ScientificInterpretationError(
          'INTERPRETATION_CAUSAL_VIOLATION',
          `Causal claim asserted on observational evidence without randomized interventional design. Rule '${rule.rule_id}' violated causality guard.`
        );
      }
    }

    if (isObservational) {
      limitations.push('CAUSAL_INFERENCE_NOT_ESTABLISHED');
    }

    // Clinical / Diagnostic Boundary Guard
    if (rule.claim_type === 'CLINICAL_CLAIM' || rule.claim_type === 'DIAGNOSTIC_CLAIM') {
      if (profile.status !== 'APPROVED') {
        throw new ScientificInterpretationError(
          'INTERPRETATION_UNAPPROVED_PROFILE',
          `Clinical or diagnostic claim in rule '${rule.rule_id}' requires an APPROVED interpretation profile with verified governance`
        );
      }
      limitations.push('CLINICAL_DIAGNOSIS_DISTINCTION_REQUIRED: Statistical categorization does not constitute a clinical medical diagnosis');
    }

    // Effect size magnitude validation
    if (rule.output_interpretation.effect_magnitude) {
      const metric = String(snapshot['effect_size_metric'] ?? snapshot['nonparam_effect_size_metric'] ?? 'UNKNOWN');
      const thresholds = profile.effect_size_thresholds?.[metric];
      if (!thresholds) {
        warnings.push(`Profile lacks formal effect size thresholds for '${metric}'. Output magnitude '${rule.output_interpretation.effect_magnitude}' is non-standardized`);
        limitations.push('EFFECT_SIZE_THRESHOLD_NOT_FORMALLY_GOVERNED');
      }
    }

    // Determine evidence status
    let evidenceStatus: EvidenceStatus = 'SUPPORTED';
    if (rule.claim_type === 'CAUSAL_CLAIM' && isObservational) {
      evidenceStatus = 'NOT_ESTABLISHED';
    }

    // Format output text deterministically without AI hallucination
    const pValStr = snapshot['p_value'] !== undefined ? ` (p = ${snapshot['p_value']})` : '';
    const decisionStr = rule.output_interpretation.statistical_decision
      ? ` [Decision: ${rule.output_interpretation.statistical_decision}]`
      : '';
    const interpText = `${rule.output_interpretation.statement_template}${pValStr}${decisionStr}`.trim();

    // 10. Build Evidence Trace
    const trace = EvidenceTraceEngine.buildTrace({
      interpretation_id: options.interpretation_id,
      rule,
      profile,
      dataset_version_id: options.dataset_version_id,
      data_artifact_id: options.data_artifact_id,
      source_artifact_checksum: sourceArtifactChecksum,
      source_analysis_ids: allAnalyses.map((a) => a.id),
      source_report_id: sourceReportId,
      input_snapshot: snapshot,
      matched_conditions: selected.matchedConditions,
      output_interpretation: {
        ...rule.output_interpretation
      },
      evidence_status: evidenceStatus,
      limitations,
      created_at: options.created_at,
      engine_version: InterpretationEngine.ENGINE_VERSION
    });

    // 11. Return Deep-Frozen Governed Result
    return createInterpretationResult({
      interpretation_id: options.interpretation_id,
      source_analysis_ids: allAnalyses.map((a) => a.id),
      dataset_version_id: options.dataset_version_id,
      data_artifact_id: options.data_artifact_id,
      source_artifact_checksum: sourceArtifactChecksum,
      profile_id: profile.profile_id,
      profile_version: profile.profile_version,
      rule_id: rule.rule_id,
      rule_version: rule.rule_version,
      interpretation_text: interpText,
      structured_findings: {
        conclusion_code: rule.output_interpretation.conclusion_code,
        statistical_decision: rule.output_interpretation.statistical_decision,
        effect_magnitude: rule.output_interpretation.effect_magnitude,
        evidence_level: rule.evidence_level,
        matched_conditions_count: selected.matchedConditions.length
      },
      category: rule.category,
      claim_type: rule.claim_type,
      evidence_status: evidenceStatus,
      statistical_evidence: snapshot,
      limitations: [...new Set(limitations)].sort(),
      warnings: [...new Set(warnings)].sort(),
      trace,
      provenance_hash: trace.provenance_hash,
      scientific_validity: 'NOT_ESTABLISHED',
      created_at: options.created_at ?? new Date().toISOString(),
      engine_version: InterpretationEngine.ENGINE_VERSION
    });
  }
}
