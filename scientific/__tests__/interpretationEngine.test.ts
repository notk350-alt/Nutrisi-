import { describe, it, expect, beforeEach } from 'vitest';
import {
  InterpretationRegistry,
  InterpretationEngine,
  EvidenceTraceEngine,
  ScientificInterpretationError,
  InterpretationProfile,
  GovernedInterpretationRule,
  validateInterpretationProfile,
  validateInterpretationRule,
  createInterpretationResult
} from '../index';
import { AnalysisResult } from '../data/analysisContracts';
import { InferentialAnalysisResult } from '../data/inferentialContracts';
import { RegressionModelResult } from '../data/regressionContracts';
import { ResearchPowerResult } from '../data/powerContracts';
import { NonParametricAnalysisResult } from '../data/nonParametricContracts';
import { ResearchReportResult } from '../data/reportContracts';

describe('Phase D15 — Scientific Interpretation & Evidence Synthesis Governance Engine', () => {
  let registry: InterpretationRegistry;

  const datasetVersionId = 'DSV_2026_TEST_01';
  const dataArtifactId = 'ART_2026_TEST_01';
  const checksum = 'a1b2c3d4e5f67890123456789abcdef0123456789abcdef0123456789abcdef0';

  // Base Valid Interpretation Profile
  const createBaseProfile = (status: 'DRAFT' | 'REVIEW' | 'APPROVED' | 'DEPRECATED' = 'DRAFT'): InterpretationProfile => ({
    profile_id: 'PROF_STAT_INFERENCE_01',
    profile_version: '1.0.0',
    name: 'Standard Inferential Statistics Interpretation Profile',
    description: 'Governs interpretations of two-sample hypothesis testing and effect size synthesis',
    domain: 'BIOSTATISTICS',
    rules: [],
    allowed_claim_types: ['STATISTICAL_CLAIM', 'ASSOCIATION_CLAIM', 'DESCRIPTIVE_CLAIM'],
    forbidden_claim_types: ['CAUSAL_CLAIM', 'DIAGNOSTIC_CLAIM'],
    source_references: [
      {
        title: 'Statistical Inference Principles',
        citation: 'Fisher, R.A. (1925). Statistical Methods for Research Workers. Oliver & Boyd.',
        doi: '10.1000/182'
      }
    ],
    status,
    created_by: 'GOVERNANCE_BOARD',
    created_at: '2026-09-26T00:00:00Z',
    updated_at: '2026-09-26T00:00:00Z',
    governance_metadata: status === 'APPROVED' ? {
      approved_by: 'CHIEF_SCIENTIST',
      approved_at: '2026-09-26T00:00:00Z',
      approval_notes: 'Fully reviewed against biostatistical benchmarks',
      source_reference: 'Fisher (1925)'
    } : undefined,
    effect_size_thresholds: {
      COHENS_D: {
        metric: 'COHENS_D',
        weak: 0.2,
        moderate: 0.5,
        strong: 0.8,
        source_reference: 'Cohen, J. (1988). Statistical Power Analysis for the Behavioral Sciences.'
      }
    }
  });

  // Base Valid Interpretation Rule
  const createBaseRule = (overrides?: Partial<GovernedInterpretationRule>): GovernedInterpretationRule => ({
    rule_id: 'RULE_HYPOTHESIS_SIGNIFICANT',
    profile_id: 'PROF_STAT_INFERENCE_01',
    rule_version: '1.0.0',
    name: 'Statistically Significant Two-Sample Difference',
    description: 'Interprets p < alpha as rejection of null hypothesis with associated effect size',
    input_type: 'D10_INFERENTIAL',
    category: 'STATISTICAL_INTERPRETATION',
    claim_type: 'STATISTICAL_CLAIM',
    evidence_level: 'CONFIRMATORY',
    conditions: {
      logic: 'AND',
      conditions: [
        { field: 'p_value', operator: 'LT', value: 0.05 },
        { field: 'decision', operator: 'EQ', value: 'REJECT_NULL' }
      ]
    },
    output_interpretation: {
      statement_template: 'Statistically significant group difference observed',
      conclusion_code: 'STAT_SIGNIFICANT_DIFF',
      statistical_decision: 'REJECT_NULL',
      effect_magnitude: 'MODERATE'
    },
    limitations: ['CONFIRMATORY_ONLY_FOR_SPECIFIED_ALPHA', 'OBSERVATIONAL_RESTRICTION'],
    source_reference: 'Neyman-Pearson Framework (1933)',
    status: 'ACTIVE',
    ...overrides
  });

  // Mock Analysis Results
  const mockD10Result: InferentialAnalysisResult = {
    analysis_id: 'INF_TEST_01',
    dataset_version_id: datasetVersionId,
    data_artifact_id: dataArtifactId,
    test_type: 'INDEPENDENT_TWO_SAMPLE_T_TEST',
    variables: {
      dependent_variable: 'fasting_glucose',
      grouping_variable: 'diet_group',
      group_a: 'Control',
      group_b: 'Interv'
    },
    hypotheses: {
      null_hypothesis: { statement: 'Mean difference is zero', value: 0 },
      alternative_hypothesis: { type: 'TWO_SIDED', statement: 'Mean difference is non-zero' }
    },
    statistic: 2.74,
    degrees_of_freedom: 98,
    p_value: 0.0073,
    alpha: 0.05,
    confidence_level: 0.95,
    sample_information: {
      sample_size_per_group: { Control: 50, Interv: 50 },
      mean_per_group: { Control: 95.2, Interv: 90.7 }
    },
    decision: 'REJECT_NULL',
    confidence_interval: {
      confidence_level: 0.95,
      lower_bound: 1.2,
      upper_bound: 7.8,
      method: 'STUDENT_T'
    },
    effect_size: {
      metric: 'COHENS_D',
      value: 0.55
    },
    assumptions: {
      all_passed: true,
      checks: []
    },
    warnings: [],
    status: 'COMPLETED',
    checksum: checksum,
    provenance_reference: 'prov_d10_hash_001',
    created_at: '2026-09-26T00:00:00Z',
    engine_version: '1.0.0',
    scientific_validity: 'NOT_ESTABLISHED'
  };

  const mockD9Result: AnalysisResult = {
    analysis_id: 'D9_TEST_01',
    dataset_version_id: datasetVersionId,
    data_artifact_id: dataArtifactId,
    analysis_type: 'DESCRIPTIVE_NUMERIC',
    requested_variables: ['fasting_glucose'],
    filters: [],
    grouping: null,
    configuration: {},
    result: {
      numeric_summaries: {
        fasting_glucose: {
          variable_id: 'fasting_glucose',
          total_records: 100,
          valid_count: 100,
          missing_count: 0,
          missing_percentage: 0,
          invalid_count: 0,
          mean: 92.5,
          median: 91.0,
          standard_deviation: 8.2,
          variance: 67.24,
          minimum: 75,
          maximum: 120,
          sum: 9250,
          percentile_25: 86,
          percentile_50: 91,
          percentile_75: 98,
          interquartile_range: 12,
          constant_value_flag: false,
          zero_variance_flag: false
        }
      },
      pairwise_associations: {
        numeric_associations: [
          {
            var1: 'fasting_glucose',
            var2: 'hba1c',
            pearson_correlation: 0.68,
            pair_count: 100,
            valid_count: 100,
            constant_variable_flag: false
          }
        ]
      }
    },
    execution_metadata: {
      execution_time_ms: 10,
      total_records_in_artifact: 100,
      filtered_record_count: 100
    },
    provenance_reference: 'prov_d9_hash_001',
    checksum: checksum,
    created_at: '2026-09-26T00:00:00Z',
    engine_version: '1.0.0',
    scientific_validity: 'NOT_ESTABLISHED'
  };

  const mockD11Result: RegressionModelResult = {
    model_id: 'REG_TEST_01',
    dataset_version_id: datasetVersionId,
    data_artifact_id: dataArtifactId,
    model_type: 'MULTIPLE_LINEAR_REGRESSION',
    sample_size: 100,
    excluded_records: 0,
    coefficients: [
      {
        variable_name: 'bmi',
        coefficient: 1.45,
        standard_error: 0.32,
        statistic: 4.53,
        p_value: 0.00002,
        confidence_interval: { lower_bound: 0.81, upper_bound: 2.09, confidence_level: 0.95 }
      }
    ],
    intercept: null,
    predictions: [92.5],
    residuals: [0.0],
    model_metrics: {
      linear: {
        r2: 0.42,
        adjusted_r2: 0.41,
        rmse: 6.2,
        mae: 4.9,
        sse: 3728.4,
        sst: 6428.3
      }
    },
    diagnostics: {},
    warnings: [],
    execution_status: 'COMPLETED',
    provenance_hash: 'prov_d11_hash_001',
    checksum: checksum,
    created_at: '2026-09-26T00:00:00Z',
    engine_version: '1.0.0',
    scientific_validity: 'NOT_ESTABLISHED'
  };

  const mockD12Result: ResearchPowerResult = {
    power_analysis_id: 'PWR_TEST_01',
    analysis_type: 'TWO_SAMPLE_MEAN',
    calculation_mode: 'ACHIEVED_POWER',
    status: 'COMPLETED',
    alpha: 0.05,
    target_power: 0.80,
    effect_size: 0.55,
    effect_size_type: 'COHEN_D',
    sample_size: 100,
    required_sample_size: 86,
    achieved_power: 0.88,
    minimum_detectable_effect: 0.48,
    statistical_sample_size: 100,
    attrition_adjusted_sample_size: null,
    group_sample_sizes: { Control: 50, Interv: 50 },
    sensitivity_results: [],
    assumptions: [],
    warnings: [],
    numerical_status: 'NORMAL',
    provenance_hash: 'prov_d12_hash_001',
    scientific_validity: 'NOT_ESTABLISHED',
    default_applied: false,
    executed_at: '2026-09-26T00:00:00Z',
    engine_version: '1.0.0'
  };
  (mockD12Result as any).dataset_version_id = datasetVersionId;
  (mockD12Result as any).data_artifact_id = dataArtifactId;

  const mockD13Result: NonParametricAnalysisResult = {
    analysis_id: 'NP_TEST_01',
    dataset_version_id: datasetVersionId,
    data_artifact_id: dataArtifactId,
    test_type: 'MANN_WHITNEY_U',
    status: 'COMPLETED',
    alpha: 0.05,
    null_hypothesis: { statement: 'Distributions are identical' },
    alternative_hypothesis: { type: 'TWO_SIDED', statement: 'Distributions differ' },
    sample_info: {
      total_records: 100,
      valid_observations: 100,
      missing_observations: 0,
      excluded_observations: 0,
      group_sizes: { Control: 50, Interv: 50 }
    },
    test_statistic: 850.5,
    degrees_of_freedom: null,
    p_value: 0.012,
    decision: 'REJECT_NULL',
    effect_size: { metric: 'RANK_BISERIAL', value: 0.38 },
    assumption_audit: [],
    warnings: [],
    numerical_status: 'NORMAL',
    provenance_hash: 'prov_d13_hash_001',
    scientific_validity: 'NOT_ESTABLISHED',
    executed_at: '2026-09-26T00:00:00Z',
    engine_version: '1.0.0'
  };

  const mockD14Result: ResearchReportResult = {
    report_id: 'REP_TEST_01',
    dataset_version_id: datasetVersionId,
    data_artifact_id: dataArtifactId,
    source_artifact_checksum: checksum,
    title: 'Biomarker Cohort Study Report',
    description: 'Comprehensive evaluation of glycemic responses',
    sections: {
      dataset_info: {
        dataset_version_id: datasetVersionId,
        data_artifact_id: dataArtifactId,
        source_artifact_checksum: checksum,
        record_count: 100,
        variable_count: 3,
        variable_names: ['fasting_glucose', 'age', 'bmi']
      },
      data_quality: {
        total_records: 100,
        valid_records: 100,
        missing_values_count: 0,
        missingness_percentage: 0,
        outlier_count: 0,
        quality_flags: []
      },
      methods: {
        methods_applied: [
          { layer: 'D10', method_name: 'INDEPENDENT_TWO_SAMPLE_T_TEST', parameters: { alpha: 0.05 } }
        ],
        software_version: '1.0.0'
      },
      tables: [],
      figures: [],
      warnings: ['Preliminary analysis only']
    },
    scientific_validity: 'NOT_ESTABLISHED',
    created_at: '2026-09-26T00:00:00Z',
    engine_version: '1.0.0',
    provenance_hash: 'prov_d14_hash_001'
  };

  beforeEach(() => {
    registry = new InterpretationRegistry();
  });

  describe('1. Interpretation Profile Lifecycle & Governance', () => {
    it('should register a valid DRAFT profile', () => {
      const profile = createBaseProfile('DRAFT');
      registry.registerProfile(profile);

      const retrieved = registry.getProfile(profile.profile_id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.profile_id).toBe(profile.profile_id);
      expect(retrieved?.status).toBe('DRAFT');
    });

    it('should reject invalid profile structure without required fields', () => {
      expect(() => {
        validateInterpretationProfile({} as any);
      }).toThrow(ScientificInterpretationError);
    });

    it('should enforce strict lifecycle transitions: DRAFT -> REVIEW -> APPROVED -> DEPRECATED', () => {
      const profile = createBaseProfile('DRAFT');
      registry.registerProfile(profile);

      // DRAFT -> REVIEW: OK
      const inReview = registry.updateProfileStatus(profile.profile_id, 'REVIEW');
      expect(inReview.status).toBe('REVIEW');

      // REVIEW -> APPROVED with governance metadata: OK
      const approved = registry.updateProfileStatus(profile.profile_id, 'APPROVED', {
        approved_by: 'SCIENTIFIC_COMMITTEE',
        approved_at: '2026-09-26T12:00:00Z',
        source_reference: 'Peer-reviewed protocol v1'
      });
      expect(approved.status).toBe('APPROVED');

      // APPROVED -> DEPRECATED: OK
      const deprecated = registry.updateProfileStatus(profile.profile_id, 'DEPRECATED');
      expect(deprecated.status).toBe('DEPRECATED');
    });

    it('should reject direct DRAFT -> APPROVED transition (skipping REVIEW)', () => {
      const profile = createBaseProfile('DRAFT');
      registry.registerProfile(profile);

      expect(() => {
        registry.updateProfileStatus(profile.profile_id, 'APPROVED', {
          approved_by: 'CHIEF',
          approved_at: '2026-09-26T00:00:00Z',
          source_reference: 'Ref 1'
        });
      }).toThrowError(/Cannot transition profile status from 'DRAFT' to 'APPROVED'/);
    });

    it('should reject APPROVED status transition without explicit governance metadata', () => {
      const profile = createBaseProfile('DRAFT');
      registry.registerProfile(profile);
      registry.updateProfileStatus(profile.profile_id, 'REVIEW');

      expect(() => {
        registry.updateProfileStatus(profile.profile_id, 'APPROVED'); // missing approved_by, approved_at
      }).toThrow(ScientificInterpretationError);
    });

    it('should prevent adding rules to a DEPRECATED profile', () => {
      const profile = createBaseProfile('DRAFT');
      registry.registerProfile(profile);
      registry.updateProfileStatus(profile.profile_id, 'DEPRECATED');

      const rule = createBaseRule();
      expect(() => {
        registry.addRuleToProfile(profile.profile_id, rule);
      }).toThrowError(/Cannot add rules to a DEPRECATED profile/);
    });

    it('should store deep-frozen defensive copies preventing in-place mutations', () => {
      const profile = createBaseProfile('DRAFT');
      registry.registerProfile(profile);

      const retrieved1 = registry.getProfile(profile.profile_id)!;
      expect(Object.isFrozen(retrieved1)).toBe(true);

      expect(() => {
        (retrieved1 as any).name = 'Tampered Profile Name';
      }).toThrow();
    });
  });

  describe('2. Declarative Rule Conditions & Zero Dynamic Execution', () => {
    it('should validate declarative operators correctly: LT, LTE, GT, GTE, EQ, NEQ', () => {
      const snapshot = { val: 42, label: 'CONTROL' };

      expect(InterpretationEngine.evaluateCondition({ field: 'val', operator: 'LT', value: 50 }, snapshot).satisfied).toBe(true);
      expect(InterpretationEngine.evaluateCondition({ field: 'val', operator: 'LTE', value: 42 }, snapshot).satisfied).toBe(true);
      expect(InterpretationEngine.evaluateCondition({ field: 'val', operator: 'GT', value: 40 }, snapshot).satisfied).toBe(true);
      expect(InterpretationEngine.evaluateCondition({ field: 'val', operator: 'GTE', value: 42 }, snapshot).satisfied).toBe(true);
      expect(InterpretationEngine.evaluateCondition({ field: 'val', operator: 'EQ', value: 42 }, snapshot).satisfied).toBe(true);
      expect(InterpretationEngine.evaluateCondition({ field: 'val', operator: 'NEQ', value: 99 }, snapshot).satisfied).toBe(true);
      expect(InterpretationEngine.evaluateCondition({ field: 'val', operator: 'EQ', value: 99 }, snapshot).satisfied).toBe(false);
    });

    it('should validate range and set operators: BETWEEN, IN, NOT_IN, CONTAINS', () => {
      const snapshot = { score: 75, tags: ['GLUCOSE', 'LIPID'], status: 'NORMAL_WEIGHT' };

      expect(InterpretationEngine.evaluateCondition({ field: 'score', operator: 'BETWEEN', value: 70, secondary_value: 80 }, snapshot).satisfied).toBe(true);
      expect(InterpretationEngine.evaluateCondition({ field: 'score', operator: 'BETWEEN', value: 80, secondary_value: 90 }, snapshot).satisfied).toBe(false);
      expect(InterpretationEngine.evaluateCondition({ field: 'status', operator: 'IN', value: ['UNDERWEIGHT', 'NORMAL_WEIGHT'] }, snapshot).satisfied).toBe(true);
      expect(InterpretationEngine.evaluateCondition({ field: 'status', operator: 'NOT_IN', value: ['OBESE'] }, snapshot).satisfied).toBe(true);
      expect(InterpretationEngine.evaluateCondition({ field: 'tags', operator: 'CONTAINS', value: 'GLUCOSE' }, snapshot).satisfied).toBe(true);
      expect(InterpretationEngine.evaluateCondition({ field: 'tags', operator: 'CONTAINS', value: 'INSULIN' }, snapshot).satisfied).toBe(false);
    });

    it('should reject invalid rule definitions missing mandatory fields', () => {
      expect(() => {
        validateInterpretationRule({} as any);
      }).toThrow(ScientificInterpretationError);

      expect(() => {
        validateInterpretationRule({
          rule_id: 'R1',
          profile_id: 'P1',
          rule_version: '1.0.0',
          input_type: 'D10_INFERENTIAL',
          // missing conditions, output, claim_type
        } as any);
      }).toThrow(ScientificInterpretationError);
    });
  });

  describe('3. Source Integrity & Version Pinning', () => {
    it('should reject execution when dataset_version_id mismatches source analysis', () => {
      const profile = createBaseProfile('DRAFT');
      const rule = createBaseRule();
      profile.rules.push(rule);

      expect(() => {
        InterpretationEngine.interpret({
          interpretation_id: 'INTERP_01',
          profile,
          dataset_version_id: 'WRONG_DATASET_VERSION',
          data_artifact_id: dataArtifactId,
          source_analysis_results: { d10: mockD10Result }
        });
      }).toThrowError(/belongs to dataset version/);
    });

    it('should reject execution when data_artifact_id mismatches source analysis', () => {
      const profile = createBaseProfile('DRAFT');
      const rule = createBaseRule();
      profile.rules.push(rule);

      expect(() => {
        InterpretationEngine.interpret({
          interpretation_id: 'INTERP_01',
          profile,
          dataset_version_id: datasetVersionId,
          data_artifact_id: 'WRONG_ARTIFACT_ID',
          source_analysis_results: { d10: mockD10Result }
        });
      }).toThrowError(/belongs to data artifact/);
    });

    it('should reject execution when no source analyses are provided', () => {
      const profile = createBaseProfile('DRAFT');
      expect(() => {
        InterpretationEngine.interpret({
          interpretation_id: 'INTERP_01',
          profile,
          dataset_version_id: datasetVersionId,
          data_artifact_id: dataArtifactId,
          source_analysis_results: {}
        });
      }).toThrowError(/No source analyses provided/);
    });

    it('should reject execution when requested rule_id does not exist in profile', () => {
      const profile = createBaseProfile('DRAFT');
      expect(() => {
        InterpretationEngine.interpret({
          interpretation_id: 'INTERP_01',
          profile,
          rule_id: 'NON_EXISTENT_RULE',
          dataset_version_id: datasetVersionId,
          data_artifact_id: dataArtifactId,
          source_analysis_results: { d10: mockD10Result }
        });
      }).toThrowError(/Specified rule 'NON_EXISTENT_RULE' not found/);
    });
  });

  describe('4. Multi-Layer Input Integration (D9–D14)', () => {
    it('should correctly interpret D10 inferential results (p-value, alpha, decision, Cohen d)', () => {
      const profile = createBaseProfile('DRAFT');
      const rule = createBaseRule();
      profile.rules.push(rule);

      const result = InterpretationEngine.interpret({
        interpretation_id: 'INTERP_D10_01',
        profile,
        dataset_version_id: datasetVersionId,
        data_artifact_id: dataArtifactId,
        source_analysis_results: { d10: mockD10Result }
      });

      expect('status' in result && result.status === 'INTERPRETATION_CONFLICT').toBe(false);
      const res = result as any;
      expect(res.category).toBe('STATISTICAL_INTERPRETATION');
      expect(res.claim_type).toBe('STATISTICAL_CLAIM');
      expect(res.evidence_status).toBe('SUPPORTED');
      expect(res.structured_findings.conclusion_code).toBe('STAT_SIGNIFICANT_DIFF');
      expect(res.structured_findings.statistical_decision).toBe('REJECT_NULL');
      expect(res.interpretation_text).toContain('Statistically significant group difference observed');
      expect(res.interpretation_text).toContain('p = 0.0073');
      expect(res.interpretation_text).toContain('[Decision: REJECT_NULL]');
      expect(res.scientific_validity).toBe('NOT_ESTABLISHED');
    });

    it('should correctly interpret D9 descriptive statistics (means, standard deviations, correlations)', () => {
      const profile = createBaseProfile('DRAFT');
      const rule = createBaseRule({
        rule_id: 'RULE_D9_CORRELATION',
        input_type: 'D9_DESCRIPTIVE',
        claim_type: 'ASSOCIATION_CLAIM',
        conditions: {
          logic: 'AND',
          conditions: [
            { field: 'pearson_r', operator: 'GT', value: 0.5 }
          ]
        },
        output_interpretation: {
          statement_template: 'Positive linear association observed between biomarkers',
          conclusion_code: 'POSITIVE_LINEAR_ASSOCIATION'
        }
      });
      profile.rules.push(rule);

      const result = InterpretationEngine.interpret({
        interpretation_id: 'INTERP_D9_01',
        profile,
        dataset_version_id: datasetVersionId,
        data_artifact_id: dataArtifactId,
        source_analysis_results: { d9: mockD9Result }
      }) as any;

      expect(result.claim_type).toBe('ASSOCIATION_CLAIM');
      expect(result.structured_findings.conclusion_code).toBe('POSITIVE_LINEAR_ASSOCIATION');
      expect(result.statistical_evidence.pearson_r).toBe(0.68);
    });

    it('should correctly interpret D11 regression models (R², coefficients, p-values)', () => {
      const profile = createBaseProfile('DRAFT');
      const rule = createBaseRule({
        rule_id: 'RULE_D11_PREDICTIVE',
        input_type: 'D11_REGRESSION',
        claim_type: 'PREDICTIVE_CLAIM',
        conditions: {
          logic: 'AND',
          conditions: [
            { field: 'r_squared', operator: 'GT', value: 0.3 },
            { field: 'primary_coef_p_value', operator: 'LT', value: 0.001 }
          ]
        },
        output_interpretation: {
          statement_template: 'Statistically significant predictor accounted for substantial variance',
          conclusion_code: 'SIGNIFICANT_REGRESSION_PREDICTOR'
        }
      });
      profile.allowed_claim_types.push('PREDICTIVE_CLAIM');
      profile.rules.push(rule);

      const result = InterpretationEngine.interpret({
        interpretation_id: 'INTERP_D11_01',
        profile,
        dataset_version_id: datasetVersionId,
        data_artifact_id: dataArtifactId,
        source_analysis_results: { d11: mockD11Result }
      }) as any;

      expect(result.claim_type).toBe('PREDICTIVE_CLAIM');
      expect(result.statistical_evidence.r_squared).toBe(0.42);
      expect(result.statistical_evidence.primary_coefficient).toBe(1.45);
    });

    it('should correctly interpret D12 power analysis (achieved power & sample adequacy)', () => {
      const profile = createBaseProfile('DRAFT');
      const rule = createBaseRule({
        rule_id: 'RULE_D12_ADEQUATE_POWER',
        input_type: 'D12_POWER',
        claim_type: 'STATISTICAL_CLAIM',
        conditions: {
          logic: 'AND',
          conditions: [
            { field: 'achieved_power', operator: 'GTE', value: 0.8 }
          ]
        },
        output_interpretation: {
          statement_template: 'Statistical study design achieved adequate statistical power (>= 80%)',
          conclusion_code: 'ADEQUATE_POWER_ACHIEVED'
        }
      });
      profile.rules.push(rule);

      const result = InterpretationEngine.interpret({
        interpretation_id: 'INTERP_D12_01',
        profile,
        dataset_version_id: datasetVersionId,
        data_artifact_id: dataArtifactId,
        source_analysis_results: { d12: mockD12Result }
      }) as any;

      expect(result.structured_findings.conclusion_code).toBe('ADEQUATE_POWER_ACHIEVED');
      expect(result.statistical_evidence.achieved_power).toBe(0.88);
    });

    it('should correctly interpret D13 non-parametric tests (Mann-Whitney, rank-biserial)', () => {
      const profile = createBaseProfile('DRAFT');
      const rule = createBaseRule({
        rule_id: 'RULE_D13_RANK_DIFF',
        input_type: 'D13_NONPARAMETRIC',
        claim_type: 'STATISTICAL_CLAIM',
        conditions: {
          logic: 'AND',
          conditions: [
            { field: 'p_value', operator: 'LT', value: 0.05 },
            { field: 'nonparam_decision', operator: 'EQ', value: 'REJECT_NULL' }
          ]
        },
        output_interpretation: {
          statement_template: 'Significant distributional shift confirmed by non-parametric rank test',
          conclusion_code: 'NONPARAMETRIC_SIGNIFICANT_SHIFT',
          statistical_decision: 'REJECT_NULL'
        }
      });
      profile.rules.push(rule);

      const result = InterpretationEngine.interpret({
        interpretation_id: 'INTERP_D13_01',
        profile,
        dataset_version_id: datasetVersionId,
        data_artifact_id: dataArtifactId,
        source_analysis_results: { d13: mockD13Result }
      }) as any;

      expect(result.structured_findings.conclusion_code).toBe('NONPARAMETRIC_SIGNIFICANT_SHIFT');
      expect(result.statistical_evidence.nonparam_test_type).toBe('MANN_WHITNEY_U');
      expect(result.statistical_evidence.nonparam_effect_size_value).toBe(0.38);
    });

    it('should correctly integrate D14 research report context into evidence trace', () => {
      const profile = createBaseProfile('DRAFT');
      const rule = createBaseRule();
      profile.rules.push(rule);

      const result = InterpretationEngine.interpret({
        interpretation_id: 'INTERP_D14_01',
        profile,
        dataset_version_id: datasetVersionId,
        data_artifact_id: dataArtifactId,
        source_analysis_results: {
          d10: mockD10Result,
          d14: mockD14Result
        }
      }) as any;

      expect(result.trace.source_report_id).toBe(mockD14Result.report_id);
      expect(result.trace.source_analysis_ids).toContain(mockD10Result.analysis_id);
      expect(result.trace.source_analysis_ids).toContain(mockD14Result.report_id);
    });
  });

  describe('5. Causality Guard & Scientific Boundary Enforcement', () => {
    it('should reject CAUSAL_CLAIM asserted on observational data', () => {
      const profile = createBaseProfile('DRAFT');
      profile.allowed_claim_types.push('CAUSAL_CLAIM');
      profile.forbidden_claim_types = [];

      const causalRule = createBaseRule({
        rule_id: 'RULE_INVALID_CAUSAL',
        claim_type: 'CAUSAL_CLAIM',
        output_interpretation: {
          statement_template: 'Dietary intervention causes reduction in blood glucose',
          conclusion_code: 'CAUSAL_EFFECT_ESTABLISHED'
        }
      });
      profile.rules.push(causalRule);

      expect(() => {
        InterpretationEngine.interpret({
          interpretation_id: 'INTERP_CAUSAL_01',
          profile,
          dataset_version_id: datasetVersionId,
          data_artifact_id: dataArtifactId,
          source_analysis_results: { d10: mockD10Result },
          context: { study_design: 'OBSERVATIONAL' }
        });
      }).toThrow(ScientificInterpretationError);
    });

    it('should attach CAUSAL_INFERENCE_NOT_ESTABLISHED limitation to all observational analyses', () => {
      const profile = createBaseProfile('DRAFT');
      const rule = createBaseRule();
      profile.rules.push(rule);

      const result = InterpretationEngine.interpret({
        interpretation_id: 'INTERP_OBS_01',
        profile,
        dataset_version_id: datasetVersionId,
        data_artifact_id: dataArtifactId,
        source_analysis_results: { d10: mockD10Result },
        context: { study_design: 'OBSERVATIONAL' }
      }) as any;

      expect(result.limitations).toContain('CAUSAL_INFERENCE_NOT_ESTABLISHED');
    });

    it('should reject forbidden claim types defined by the profile', () => {
      const profile = createBaseProfile('DRAFT');
      profile.forbidden_claim_types = ['DIAGNOSTIC_CLAIM'];

      const rule = createBaseRule({
        rule_id: 'RULE_DIAGNOSTIC',
        claim_type: 'DIAGNOSTIC_CLAIM',
        output_interpretation: {
          statement_template: 'Patient is diagnosed with impaired glucose tolerance',
          conclusion_code: 'DIAGNOSIS_IGT'
        }
      });
      profile.rules.push(rule);

      expect(() => {
        InterpretationEngine.interpret({
          interpretation_id: 'INTERP_FORBIDDEN_01',
          profile,
          dataset_version_id: datasetVersionId,
          data_artifact_id: dataArtifactId,
          source_analysis_results: { d10: mockD10Result }
        });
      }).toThrowError(/attempts forbidden claim type/);
    });

    it('should reject CLINICAL_CLAIM when profile is not APPROVED', () => {
      const profile = createBaseProfile('DRAFT');
      profile.allowed_claim_types.push('CLINICAL_CLAIM');
      profile.forbidden_claim_types = [];

      const clinicalRule = createBaseRule({
        rule_id: 'RULE_CLINICAL_BENEFIT',
        claim_type: 'CLINICAL_CLAIM',
        category: 'CLINICAL_INTERPRETATION',
        output_interpretation: {
          statement_template: 'Observed difference constitutes clinically meaningful improvement',
          conclusion_code: 'CLINICAL_IMPROVEMENT'
        }
      });
      profile.rules.push(clinicalRule);

      expect(() => {
        InterpretationEngine.interpret({
          interpretation_id: 'INTERP_CLINICAL_01',
          profile,
          dataset_version_id: datasetVersionId,
          data_artifact_id: dataArtifactId,
          source_analysis_results: { d10: mockD10Result }
        });
      }).toThrowError(/requires an APPROVED interpretation profile/);
    });

    it('should allow CLINICAL_CLAIM when profile is APPROVED and include mandatory diagnosis distinction disclaimer', () => {
      const profile = createBaseProfile('APPROVED');
      profile.allowed_claim_types.push('CLINICAL_CLAIM');
      profile.forbidden_claim_types = [];

      const clinicalRule = createBaseRule({
        rule_id: 'RULE_CLINICAL_BENEFIT',
        claim_type: 'CLINICAL_CLAIM',
        category: 'CLINICAL_INTERPRETATION',
        output_interpretation: {
          statement_template: 'Observed difference meets clinical significance criterion',
          conclusion_code: 'CLINICAL_SIGNIFICANCE'
        }
      });
      profile.rules.push(clinicalRule);

      const result = InterpretationEngine.interpret({
        interpretation_id: 'INTERP_CLINICAL_APPROVED_01',
        profile,
        dataset_version_id: datasetVersionId,
        data_artifact_id: dataArtifactId,
        source_analysis_results: { d10: mockD10Result }
      }) as any;

      expect(result.claim_type).toBe('CLINICAL_CLAIM');
      expect(result.limitations.some((l: string) => l.includes('CLINICAL_DIAGNOSIS_DISTINCTION_REQUIRED'))).toBe(true);
    });
  });

  describe('6. Conflict Detection & Divergence Handling', () => {
    it('should detect conflicting rules producing divergent statistical decisions', () => {
      const profile = createBaseProfile('DRAFT');

      const ruleA = createBaseRule({
        rule_id: 'RULE_A',
        conditions: { logic: 'AND', conditions: [{ field: 'p_value', operator: 'LT', value: 0.05 }] },
        output_interpretation: {
          statement_template: 'Reject null',
          conclusion_code: 'CODE_REJECT',
          statistical_decision: 'REJECT_NULL'
        }
      });

      const ruleB = createBaseRule({
        rule_id: 'RULE_B',
        conditions: { logic: 'AND', conditions: [{ field: 'alpha', operator: 'GTE', value: 0.01 }] },
        output_interpretation: {
          statement_template: 'Do not reject null',
          conclusion_code: 'CODE_DO_NOT_REJECT',
          statistical_decision: 'DO_NOT_REJECT_NULL'
        }
      });

      profile.rules.push(ruleA, ruleB);

      const result = InterpretationEngine.interpret({
        interpretation_id: 'INTERP_CONFLICT_01',
        profile,
        dataset_version_id: datasetVersionId,
        data_artifact_id: dataArtifactId,
        source_analysis_results: { d10: mockD10Result }
      });

      expect('status' in result && result.status === 'INTERPRETATION_CONFLICT').toBe(true);
      const conflict = result as any;
      expect(conflict.requires_human_resolution).toBe(true);
      expect(conflict.conflicting_rules.length).toBe(2);
      expect(conflict.message).toContain('Conflicting interpretations detected');
    });

    it('should return INSUFFICIENT_EVIDENCE result when zero rules match', () => {
      const profile = createBaseProfile('DRAFT');
      const impossibleRule = createBaseRule({
        rule_id: 'RULE_IMPOSSIBLE',
        conditions: { logic: 'AND', conditions: [{ field: 'p_value', operator: 'LT', value: 0.0000001 }] }
      });
      profile.rules.push(impossibleRule);

      const result = InterpretationEngine.interpret({
        interpretation_id: 'INTERP_NO_MATCH_01',
        profile,
        dataset_version_id: datasetVersionId,
        data_artifact_id: dataArtifactId,
        source_analysis_results: { d10: mockD10Result }
      }) as any;

      expect(result.evidence_status).toBe('INSUFFICIENT_EVIDENCE');
      expect(result.rule_id).toBe('RULE_NO_MATCH');
      expect(result.structured_findings.match_count).toBe(0);
      expect(result.limitations).toContain('NO_MATCHING_RULE');
    });
  });

  describe('7. Evidence Trace & Cryptographic Lineage', () => {
    it('should generate an auditable, deterministic SHA-256 evidence trace', () => {
      const profile = createBaseProfile('DRAFT');
      const rule = createBaseRule();
      profile.rules.push(rule);

      const result = InterpretationEngine.interpret({
        interpretation_id: 'INTERP_TRACE_01',
        profile,
        dataset_version_id: datasetVersionId,
        data_artifact_id: dataArtifactId,
        source_artifact_checksum: checksum,
        source_analysis_results: { d10: mockD10Result },
        created_at: '2026-09-26T12:00:00Z'
      }) as any;

      const trace = result.trace;
      expect(trace).toBeDefined();
      expect(trace.interpretation_id).toBe('INTERP_TRACE_01');
      expect(trace.rule_id).toBe(rule.rule_id);
      expect(trace.profile_id).toBe(profile.profile_id);
      expect(trace.dataset_version_id).toBe(datasetVersionId);
      expect(trace.data_artifact_id).toBe(dataArtifactId);
      expect(trace.source_artifact_checksum).toBe(checksum);
      expect(trace.provenance_hash).toMatch(/^[a-f0-9]{64}$/);
      expect(result.provenance_hash).toBe(trace.provenance_hash);

      // Reproducibility test: identical inputs must yield identical hash
      const result2 = InterpretationEngine.interpret({
        interpretation_id: 'INTERP_TRACE_01',
        profile,
        dataset_version_id: datasetVersionId,
        data_artifact_id: dataArtifactId,
        source_artifact_checksum: checksum,
        source_analysis_results: { d10: mockD10Result },
        created_at: '2026-09-26T12:00:00Z'
      }) as any;

      expect(result2.provenance_hash).toBe(result.provenance_hash);
    });

    it('should ensure InterpretationResult is deep-frozen and immutable', () => {
      const profile = createBaseProfile('DRAFT');
      const rule = createBaseRule();
      profile.rules.push(rule);

      const result = InterpretationEngine.interpret({
        interpretation_id: 'INTERP_IMMUTABLE_01',
        profile,
        dataset_version_id: datasetVersionId,
        data_artifact_id: dataArtifactId,
        source_analysis_results: { d10: mockD10Result }
      }) as any;

      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.trace)).toBe(true);
      expect(Object.isFrozen(result.limitations)).toBe(true);

      expect(() => {
        result.interpretation_text = 'Altered Text';
      }).toThrow();
    });

    it('should enforce scientific_validity = NOT_ESTABLISHED across all outputs', () => {
      const profile = createBaseProfile('APPROVED');
      const rule = createBaseRule();
      profile.rules.push(rule);

      const result = InterpretationEngine.interpret({
        interpretation_id: 'INTERP_VALIDITY_01',
        profile,
        dataset_version_id: datasetVersionId,
        data_artifact_id: dataArtifactId,
        source_analysis_results: { d10: mockD10Result }
      }) as any;

      expect(result.scientific_validity).toBe('NOT_ESTABLISHED');
    });
  });

  describe('8. Effect Size Threshold Governance', () => {
    it('should issue warning and limitation when effect magnitude lacks formal profile thresholds', () => {
      const profile = createBaseProfile('DRAFT');
      profile.effect_size_thresholds = undefined; // Profile lacks formal thresholds

      const rule = createBaseRule({
        output_interpretation: {
          statement_template: 'Group difference observed with effect magnitude',
          conclusion_code: 'DIFF_WITH_MAGNITUDE',
          effect_magnitude: 'LARGE'
        }
      });
      profile.rules.push(rule);

      const result = InterpretationEngine.interpret({
        interpretation_id: 'INTERP_EFFECT_WARN_01',
        profile,
        dataset_version_id: datasetVersionId,
        data_artifact_id: dataArtifactId,
        source_analysis_results: { d10: mockD10Result }
      }) as any;

      expect(result.warnings.some((w: string) => w.includes('Profile lacks formal effect size thresholds'))).toBe(true);
      expect(result.limitations).toContain('EFFECT_SIZE_THRESHOLD_NOT_FORMALLY_GOVERNED');
    });
  });
});
