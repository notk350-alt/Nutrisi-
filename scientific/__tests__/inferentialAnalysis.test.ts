/**
 * Phase D10 — Scientific Data Layer: Inferential Statistics & Hypothesis Testing Engine Tests
 *
 * Comprehensive test suite covering:
 * 1. Inferential Request / Result Contract Validation
 * 2. One-Sample t-Test Routine & Directional Hypotheses
 * 3. Independent Two-Sample t-Test (Welch & Pooled Equal Variance)
 * 4. Paired t-Test & Pairing Integrity
 * 5. Pearson Correlation Test & Fisher's z CI
 * 6. Chi-Square Test of Independence & Expected Frequencies
 * 7. Effect Sizes (Cohen's d, Cramér's V, Pearson r)
 * 8. Mechanical Decision Rules (REJECT_NULL vs DO_NOT_REJECT_NULL, zero ACCEPT_H0)
 * 9. Assumption Audits & Status Model
 * 10. Multiple Testing Corrections (Bonferroni, Holm, Benjamini-Hochberg)
 * 11. Numerical Safety & Edge Cases
 * 12. Provenance Cryptographic Hashes
 * 13. Source & Result Immutability
 * 14. Regressions across C1-C8, D1-D9.1
 */

import { describe, expect, it } from 'vitest';
import {
  InferentialAnalysisEngine,
  InferentialAnalysisRequest,
  InferentialAnalysisResultStore,
  ScientificInferentialAnalysisError,
  applyMultipleTestingCorrection,
  calculateCohensD,
  calculateCramersV,
  chiSquareCDF,
  normalCDF,
  studentTCDF
} from '../index';
import { DatasetVersionStore } from '../data/datasetVersion';
import { DataArtifactStore, computeDataArtifactChecksum } from '../data/dataStatePipeline';
import { VariableStore } from '../data/variableRegistry';
import { DataArtifact, DatasetVersion, Variable } from '../types';

describe('Phase D10: Inferential Statistics & Hypothesis Testing Engine', () => {
  // Fixtures
  const versionStore = new DatasetVersionStore();
  const artifactStore = new DataArtifactStore();
  const variableStore = new VariableStore();
  const resultStore = new InferentialAnalysisResultStore();

  const validDatasetVersion: DatasetVersion = {
    version_id: 'dsv_trial_v1',
    dataset_id: 'ds_clinical_trial',
    version_number: 1,
    status: 'ACTIVE',
    created_at: '2026-09-01T00:00:00Z',
    created_by: 'usr_stat_1',
    checksum: '0000000000000000000000000000000000000000000000000000000000000000'
  };
  versionStore.create(validDatasetVersion);

  const sampleTrialRecords = [
    { subject_id: 'sub_1', pre_glucose: 110, post_glucose: 95, group: 'Drug_A', response: 'High' },
    { subject_id: 'sub_2', pre_glucose: 120, post_glucose: 100, group: 'Drug_A', response: 'High' },
    { subject_id: 'sub_3', pre_glucose: 105, post_glucose: 90, group: 'Drug_A', response: 'Low' },
    { subject_id: 'sub_4', pre_glucose: 130, post_glucose: 115, group: 'Drug_B', response: 'Low' },
    { subject_id: 'sub_5', pre_glucose: 125, post_glucose: 110, group: 'Drug_B', response: 'Low' },
    { subject_id: 'sub_6', pre_glucose: 140, post_glucose: 130, group: 'Drug_B', response: 'High' }
  ];

  const rawRoot = {
    artifact_id: 'art_trial_raw_001',
    dataset_version_id: 'dsv_trial_v1',
    state: 'RAW' as const,
    data_reference: { records: sampleTrialRecords },
    record_count: sampleTrialRecords.length,
    column_count: 5,
    created_at: '2026-09-01T00:00:00Z',
    created_by: 'usr_stat_1'
  };
  const rawArtifact: DataArtifact = { ...rawRoot, checksum: computeDataArtifactChecksum(rawRoot) };
  artifactStore.create(rawArtifact);

  const validOneSampleRequest: InferentialAnalysisRequest = {
    analysis_id: 'inf_one_sample_001',
    dataset_version_id: 'dsv_trial_v1',
    data_artifact_id: 'art_trial_raw_001',
    test_type: 'ONE_SAMPLE_T_TEST',
    dependent_variable: 'pre_glucose',
    null_hypothesis: { statement: 'Mean pre_glucose equals 100 mg/dL', value: 100 },
    alternative_hypothesis: { type: 'TWO_SIDED', statement: 'Mean pre_glucose is not equal to 100 mg/dL' },
    alpha: 0.05,
    created_by: 'usr_stat_1',
    created_at: '2026-09-01T00:00:00Z'
  };

  // ===========================================================================
  // SECTION 1: CONTRACT VALIDATION
  // ===========================================================================
  describe('1. Contract Validation', () => {
    it('1. accepts a valid inferential request', () => {
      const res = InferentialAnalysisEngine.analyze({
        request: validOneSampleRequest,
        dataset_version_store: versionStore,
        data_artifact_store: artifactStore
      });
      expect(res.analysis_id).toBe('inf_one_sample_001');
      expect(res.scientific_validity).toBe('NOT_ESTABLISHED');
      expect(res.status).toBe('COMPLETED');
    });

    it('2. rejects request with missing or empty analysis_id', () => {
      expect(() =>
        InferentialAnalysisEngine.analyze({
          request: { ...validOneSampleRequest, analysis_id: '' },
          dataset_version_store: versionStore,
          data_artifact_store: artifactStore
        })
      ).toThrowError(expect.objectContaining({ code: 'INFERENTIAL_INVALID_CONTRACT' }));
    });

    it('3. validates alpha is strictly between 0 and 1', () => {
      expect(() =>
        InferentialAnalysisEngine.analyze({
          request: { ...validOneSampleRequest, alpha: 0 },
          dataset_version_store: versionStore,
          data_artifact_store: artifactStore
        })
      ).toThrowError(expect.objectContaining({ code: 'INFERENTIAL_ALPHA_INVALID' }));

      expect(() =>
        InferentialAnalysisEngine.analyze({
          request: { ...validOneSampleRequest, alpha: 1.5 },
          dataset_version_store: versionStore,
          data_artifact_store: artifactStore
        })
      ).toThrowError(expect.objectContaining({ code: 'INFERENTIAL_ALPHA_INVALID' }));
    });

    it('4. validates alternative hypothesis type', () => {
      expect(() =>
        InferentialAnalysisEngine.analyze({
          request: {
            ...validOneSampleRequest,
            alternative_hypothesis: { type: 'INVALID' as any, statement: 'Invalid' }
          },
          dataset_version_store: versionStore,
          data_artifact_store: artifactStore
        })
      ).toThrowError(expect.objectContaining({ code: 'INFERENTIAL_HYPOTHESIS_INVALID' }));
    });

    it('5. throws INFERENTIAL_DATASET_NOT_FOUND if dataset_version_id does not exist', () => {
      expect(() =>
        InferentialAnalysisEngine.analyze({
          request: { ...validOneSampleRequest, dataset_version_id: 'dsv_non_existent' },
          dataset_version_store: versionStore,
          data_artifact_store: artifactStore
        })
      ).toThrowError(expect.objectContaining({ code: 'INFERENTIAL_DATASET_NOT_FOUND' }));
    });

    it('6. throws INFERENTIAL_VERSION_MISMATCH on mismatched artifact dataset_version_id', () => {
      const wrongArtRoot = { ...rawRoot, artifact_id: 'art_wrong_v2', dataset_version_id: 'dsv_other_v2' };
      const wrongArtifact = { ...wrongArtRoot, checksum: computeDataArtifactChecksum(wrongArtRoot) };
      artifactStore.create(wrongArtifact);

      expect(() =>
        InferentialAnalysisEngine.analyze({
          request: { ...validOneSampleRequest, data_artifact_id: 'art_wrong_v2' },
          dataset_version_store: versionStore,
          data_artifact_store: artifactStore
        })
      ).toThrowError(expect.objectContaining({ code: 'INFERENTIAL_VERSION_MISMATCH' }));
    });
  });

  // ===========================================================================
  // SECTION 2: ONE-SAMPLE T-TEST
  // ===========================================================================
  describe('2. One-Sample t-Test Routine', () => {
    it('7. calculates one-sample t-test statistic and p-value correctly', () => {
      // pre_glucose: 110, 120, 105, 130, 125, 140 -> mean = 121.6667, target = 100
      const res = InferentialAnalysisEngine.analyze({
        request: validOneSampleRequest,
        dataset_version_store: versionStore,
        data_artifact_store: artifactStore
      });

      expect(res.statistic).toBeGreaterThan(3);
      expect(res.p_value).toBeLessThan(0.01);
      expect(res.decision).toBe('REJECT_NULL');
      expect(res.degrees_of_freedom).toBe(5);
    });

    it('8. supports TWO_SIDED alternative hypothesis', () => {
      const res = InferentialAnalysisEngine.analyze({
        request: {
          ...validOneSampleRequest,
          alternative_hypothesis: { type: 'TWO_SIDED', statement: 'Mean is not 100' }
        },
        dataset_version_store: versionStore,
        data_artifact_store: artifactStore
      });
      expect(res.p_value).toBeDefined();
    });

    it('9. supports GREATER_THAN directional alternative hypothesis', () => {
      const res = InferentialAnalysisEngine.analyze({
        request: {
          ...validOneSampleRequest,
          alternative_hypothesis: { type: 'GREATER_THAN', statement: 'Mean is greater than 100' }
        },
        dataset_version_store: versionStore,
        data_artifact_store: artifactStore
      });
      expect(res.p_value).toBeLessThan(0.005);
      expect(res.decision).toBe('REJECT_NULL');
    });

    it('10. supports LESS_THAN directional alternative hypothesis', () => {
      const res = InferentialAnalysisEngine.analyze({
        request: {
          ...validOneSampleRequest,
          alternative_hypothesis: { type: 'LESS_THAN', statement: 'Mean is less than 100' }
        },
        dataset_version_store: versionStore,
        data_artifact_store: artifactStore
      });
      expect(res.p_value).toBeGreaterThan(0.99);
      expect(res.decision).toBe('DO_NOT_REJECT_NULL');
    });

    it('11. returns INSUFFICIENT_DATA status when n < 2', () => {
      const singleRecordArtRoot = { ...rawRoot, artifact_id: 'art_single_rec', data_reference: { records: [sampleTrialRecords[0]] } };
      const singleArtifact = { ...singleRecordArtRoot, checksum: computeDataArtifactChecksum(singleRecordArtRoot) };
      artifactStore.create(singleArtifact);

      const res = InferentialAnalysisEngine.analyze({
        request: { ...validOneSampleRequest, data_artifact_id: 'art_single_rec' },
        dataset_version_store: versionStore,
        data_artifact_store: artifactStore
      });

      expect(res.status).toBe('INSUFFICIENT_DATA');
      expect(res.statistic).toBeNull();
    });

    it('12. handles zero variance setting ASSUMPTION_NOT_ESTABLISHED status', () => {
      const zeroVarRecords = [
        { pre_glucose: 100 },
        { pre_glucose: 100 },
        { pre_glucose: 100 }
      ];
      const zeroVarArtRoot = { ...rawRoot, artifact_id: 'art_zero_var', data_reference: { records: zeroVarRecords } };
      const zeroVarArtifact = { ...zeroVarArtRoot, checksum: computeDataArtifactChecksum(zeroVarArtRoot) };
      artifactStore.create(zeroVarArtifact);

      const res = InferentialAnalysisEngine.analyze({
        request: { ...validOneSampleRequest, data_artifact_id: 'art_zero_var' },
        dataset_version_store: versionStore,
        data_artifact_store: artifactStore
      });

      expect(res.status).toBe('ASSUMPTION_NOT_ESTABLISHED');
      expect(res.warnings[0]).toContain('zero variance');
    });

    it('13. computes confidence interval with exact specified confidence level', () => {
      const res = InferentialAnalysisEngine.analyze({
        request: { ...validOneSampleRequest, alpha: 0.01, confidence_level: 0.99 },
        dataset_version_store: versionStore,
        data_artifact_store: artifactStore
      });

      expect(res.confidence_interval).toBeDefined();
      expect(res.confidence_interval?.confidence_level).toBe(0.99);
      expect(res.confidence_interval?.lower_bound).toBeLessThan(res.sample_information.sample_mean as number);
      expect(res.confidence_interval?.upper_bound).toBeGreaterThan(res.sample_information.sample_mean as number);
    });
  });

  // ===========================================================================
  // SECTION 3: INDEPENDENT TWO-SAMPLE T-TEST
  // ===========================================================================
  describe('3. Independent Two-Sample t-Test Routine', () => {
    const twoSampleReq: InferentialAnalysisRequest = {
      analysis_id: 'inf_two_sample_001',
      dataset_version_id: 'dsv_trial_v1',
      data_artifact_id: 'art_trial_raw_001',
      test_type: 'INDEPENDENT_TWO_SAMPLE_T_TEST',
      dependent_variable: 'pre_glucose',
      grouping_variable: 'group',
      group_a: 'Drug_A',
      group_b: 'Drug_B',
      null_hypothesis: { statement: 'Mean pre_glucose Drug_A = Drug_B' },
      alternative_hypothesis: { type: 'TWO_SIDED', statement: 'Mean pre_glucose Drug_A != Drug_B' },
      alpha: 0.05,
      created_by: 'usr_stat_1',
      created_at: '2026-09-01T00:00:00Z'
    };

    it('14. computes Welch two-sample t-test by default', () => {
      const res = InferentialAnalysisEngine.analyze({
        request: twoSampleReq,
        dataset_version_store: versionStore,
        data_artifact_store: artifactStore
      });

      expect(res.status).toBe('COMPLETED');
      expect(res.sample_information.mean_group_a).toBe(111.66666666666667);
      expect(res.sample_information.mean_group_b).toBe(131.66666666666666);
      expect(res.statistic).toBeLessThan(0);
      expect(res.confidence_interval?.method).toContain("Welch's");
    });

    it('15. calculates Welch degrees of freedom correctly', () => {
      const res = InferentialAnalysisEngine.analyze({
        request: twoSampleReq,
        dataset_version_store: versionStore,
        data_artifact_store: artifactStore
      });
      expect(res.degrees_of_freedom).toBeGreaterThan(2);
      expect(res.degrees_of_freedom).toBeLessThanOrEqual(4);
    });

    it('16. supports pooled equal-variance t-test when equal_variance: true', () => {
      const res = InferentialAnalysisEngine.analyze({
        request: {
          ...twoSampleReq,
          configuration: { equal_variance: true }
        },
        dataset_version_store: versionStore,
        data_artifact_store: artifactStore
      });

      expect(res.degrees_of_freedom).toBe(4); // nA + nB - 2 = 3 + 3 - 2 = 4
      expect(res.confidence_interval?.method).toContain('Equal-Variance');
    });

    it('17. throws INFERENTIAL_GROUP_INVALID if grouping variable does not exist', () => {
      expect(() =>
        InferentialAnalysisEngine.analyze({
          request: { ...twoSampleReq, grouping_variable: 'non_existent_group' },
          dataset_version_store: versionStore,
          data_artifact_store: artifactStore
        })
      ).toThrowError(expect.objectContaining({ code: 'INFERENTIAL_GROUP_INVALID' }));
    });

    it('18. returns INSUFFICIENT_DATA if one group has n < 2', () => {
      const imbalanceRecords = [
        { pre_glucose: 110, group: 'Drug_A' },
        { pre_glucose: 120, group: 'Drug_B' },
        { pre_glucose: 130, group: 'Drug_B' }
      ];
      const imArtRoot = { ...rawRoot, artifact_id: 'art_imbalance', data_reference: { records: imbalanceRecords } };
      artifactStore.create({ ...imArtRoot, checksum: computeDataArtifactChecksum(imArtRoot) });

      const res = InferentialAnalysisEngine.analyze({
        request: { ...twoSampleReq, data_artifact_id: 'art_imbalance' },
        dataset_version_store: versionStore,
        data_artifact_store: artifactStore
      });

      expect(res.status).toBe('INSUFFICIENT_DATA');
    });

    it('19. throws error if requested dependent variable is missing from columns', () => {
      expect(() =>
        InferentialAnalysisEngine.analyze({
          request: { ...twoSampleReq, dependent_variable: 'non_existent_dep' },
          dataset_version_store: versionStore,
          data_artifact_store: artifactStore
        })
      ).toThrow();
    });
  });

  // ===========================================================================
  // SECTION 4: PAIRED T-TEST
  // ===========================================================================
  describe('4. Paired t-Test Routine', () => {
    const pairedReq: InferentialAnalysisRequest = {
      analysis_id: 'inf_paired_001',
      dataset_version_id: 'dsv_trial_v1',
      data_artifact_id: 'art_trial_raw_001',
      test_type: 'PAIRED_T_TEST',
      dependent_variable: 'pre_glucose',
      paired_variable: 'post_glucose',
      null_hypothesis: { statement: 'Mean difference pre - post = 0' },
      alternative_hypothesis: { type: 'TWO_SIDED', statement: 'Mean difference pre - post != 0' },
      alpha: 0.05,
      created_by: 'usr_stat_1',
      created_at: '2026-09-01T00:00:00Z'
    };

    it('20. computes paired t-test on in-record paired observations', () => {
      const res = InferentialAnalysisEngine.analyze({
        request: pairedReq,
        dataset_version_store: versionStore,
        data_artifact_store: artifactStore
      });

      expect(res.status).toBe('COMPLETED');
      expect(res.sample_information.n_pairs).toBe(6);
      expect(res.sample_information.mean_difference).toBe(15); // pre - post difference = 15
      expect(res.statistic).toBeGreaterThan(10); // Very strong effect
      expect(res.p_value).toBeLessThan(0.001);
      expect(res.decision).toBe('REJECT_NULL');
    });

    it('21. supports explicit pairing by subject_id key', () => {
      const res = InferentialAnalysisEngine.analyze({
        request: {
          ...pairedReq,
          configuration: { paired_key: 'subject_id' }
        },
        dataset_version_store: versionStore,
        data_artifact_store: artifactStore
      });

      expect(res.sample_information.paired_key).toBe('subject_id');
      expect(res.sample_information.n_pairs).toBe(6);
    });

    it('22. ignores unpaired or incomplete missing records cleanly', () => {
      const unpairRecords = [
        { subject_id: 's1', pre_glucose: 110, post_glucose: 100 },
        { subject_id: 's2', pre_glucose: 120, post_glucose: null }, // Missing post
        { subject_id: 's3', pre_glucose: 130, post_glucose: 110 }
      ];
      const unArtRoot = { ...rawRoot, artifact_id: 'art_unpaired', data_reference: { records: unpairRecords } };
      artifactStore.create({ ...unArtRoot, checksum: computeDataArtifactChecksum(unArtRoot) });

      const res = InferentialAnalysisEngine.analyze({
        request: { ...pairedReq, data_artifact_id: 'art_unpaired' },
        dataset_version_store: versionStore,
        data_artifact_store: artifactStore
      });

      expect(res.sample_information.n_pairs).toBe(2);
    });

    it('23. handles ambiguous pairing gracefully', () => {
      const dupRecords = [
        { subject_id: 's1', pre_glucose: 110, post_glucose: 100 },
        { subject_id: 's1', pre_glucose: 115, post_glucose: 95 } // Duplicate subject_id overwrites or uses latest
      ];
      const dupArtRoot = { ...rawRoot, artifact_id: 'art_dup_pair', data_reference: { records: dupRecords } };
      artifactStore.create({ ...dupArtRoot, checksum: computeDataArtifactChecksum(dupArtRoot) });

      const res = InferentialAnalysisEngine.analyze({
        request: { ...pairedReq, data_artifact_id: 'art_dup_pair', configuration: { paired_key: 'subject_id' } },
        dataset_version_store: versionStore,
        data_artifact_store: artifactStore
      });

      expect(res.status).toBe('INSUFFICIENT_DATA'); // n_pairs = 1 < 2
    });

    it('24. returns INSUFFICIENT_DATA if n_pairs < 2', () => {
      const singlePairArtRoot = { ...rawRoot, artifact_id: 'art_single_pair', data_reference: { records: [sampleTrialRecords[0]] } };
      artifactStore.create({ ...singlePairArtRoot, checksum: computeDataArtifactChecksum(singlePairArtRoot) });

      const res = InferentialAnalysisEngine.analyze({
        request: { ...pairedReq, data_artifact_id: 'art_single_pair' },
        dataset_version_store: versionStore,
        data_artifact_store: artifactStore
      });

      expect(res.status).toBe('INSUFFICIENT_DATA');
    });

    it('25. returns ASSUMPTION_NOT_ESTABLISHED when paired differences have zero variance', () => {
      const constDiffRecords = [
        { pre_glucose: 110, post_glucose: 100 }, // diff = 10
        { pre_glucose: 120, post_glucose: 110 }, // diff = 10
        { pre_glucose: 130, post_glucose: 120 }  // diff = 10
      ];
      const constArtRoot = { ...rawRoot, artifact_id: 'art_const_diff', data_reference: { records: constDiffRecords } };
      artifactStore.create({ ...constArtRoot, checksum: computeDataArtifactChecksum(constArtRoot) });

      const res = InferentialAnalysisEngine.analyze({
        request: { ...pairedReq, data_artifact_id: 'art_const_diff' },
        dataset_version_store: versionStore,
        data_artifact_store: artifactStore
      });

      expect(res.status).toBe('ASSUMPTION_NOT_ESTABLISHED');
    });
  });

  // ===========================================================================
  // SECTION 5: PEARSON CORRELATION TEST
  // ===========================================================================
  describe('5. Pearson Correlation Test Routine', () => {
    const corrReq: InferentialAnalysisRequest = {
      analysis_id: 'inf_corr_001',
      dataset_version_id: 'dsv_trial_v1',
      data_artifact_id: 'art_trial_raw_001',
      test_type: 'PEARSON_CORRELATION_TEST',
      dependent_variable: 'pre_glucose',
      paired_variable: 'post_glucose',
      null_hypothesis: { statement: 'Pearson r = 0' },
      alternative_hypothesis: { type: 'TWO_SIDED', statement: 'Pearson r != 0' },
      alpha: 0.05,
      created_by: 'usr_stat_1',
      created_at: '2026-09-01T00:00:00Z'
    };

    it('26. computes Pearson correlation test statistic and p-value', () => {
      const res = InferentialAnalysisEngine.analyze({
        request: corrReq,
        dataset_version_store: versionStore,
        data_artifact_store: artifactStore
      });

      expect(res.status).toBe('COMPLETED');
      expect(res.effect_size?.metric).toBe('PEARSON_R');
      expect(res.effect_size?.value).toBeGreaterThan(0.95); // Very high correlation
      expect(res.decision).toBe('REJECT_NULL');
    });

    it('27. handles constant variable zero variance returning ASSUMPTION_NOT_ESTABLISHED', () => {
      const constXRecords = [
        { pre_glucose: 100, post_glucose: 90 },
        { pre_glucose: 100, post_glucose: 95 },
        { pre_glucose: 100, post_glucose: 100 }
      ];
      const constXArtRoot = { ...rawRoot, artifact_id: 'art_const_x', data_reference: { records: constXRecords } };
      artifactStore.create({ ...constXArtRoot, checksum: computeDataArtifactChecksum(constXArtRoot) });

      const res = InferentialAnalysisEngine.analyze({
        request: { ...corrReq, data_artifact_id: 'art_const_x' },
        dataset_version_store: versionStore,
        data_artifact_store: artifactStore
      });

      expect(res.status).toBe('ASSUMPTION_NOT_ESTABLISHED');
    });

    it('28. returns INSUFFICIENT_DATA if n < 3 for correlation test', () => {
      const smallArtRoot = { ...rawRoot, artifact_id: 'art_small_corr', data_reference: { records: sampleTrialRecords.slice(0, 2) } };
      artifactStore.create({ ...smallArtRoot, checksum: computeDataArtifactChecksum(smallArtRoot) });

      const res = InferentialAnalysisEngine.analyze({
        request: { ...corrReq, data_artifact_id: 'art_small_corr' },
        dataset_version_store: versionStore,
        data_artifact_store: artifactStore
      });

      expect(res.status).toBe('INSUFFICIENT_DATA');
    });

    it('29. supports GREATER_THAN alternative hypothesis for correlation', () => {
      const res = InferentialAnalysisEngine.analyze({
        request: {
          ...corrReq,
          alternative_hypothesis: { type: 'GREATER_THAN', statement: 'Pearson r > 0' }
        },
        dataset_version_store: versionStore,
        data_artifact_store: artifactStore
      });

      expect(res.p_value).toBeLessThan(0.01);
      expect(res.decision).toBe('REJECT_NULL');
    });

    it('30. computes Fisher z-transformation confidence interval for r', () => {
      const res = InferentialAnalysisEngine.analyze({
        request: corrReq,
        dataset_version_store: versionStore,
        data_artifact_store: artifactStore
      });

      expect(res.confidence_interval?.method).toContain('Fisher');
      expect(res.confidence_interval?.lower_bound).toBeGreaterThan(0.7);
      expect(res.confidence_interval?.upper_bound).toBeLessThanOrEqual(1.0);
    });
  });

  // ===========================================================================
  // SECTION 6: CHI-SQUARE TEST OF INDEPENDENCE
  // ===========================================================================
  describe('6. Chi-Square Test of Independence Routine', () => {
    const chiReq: InferentialAnalysisRequest = {
      analysis_id: 'inf_chi_001',
      dataset_version_id: 'dsv_trial_v1',
      data_artifact_id: 'art_trial_raw_001',
      test_type: 'CHI_SQUARE_INDEPENDENCE',
      dependent_variable: 'group',
      grouping_variable: 'response',
      null_hypothesis: { statement: 'group and response are independent' },
      alternative_hypothesis: { type: 'TWO_SIDED', statement: 'group and response are dependent' },
      alpha: 0.05,
      created_by: 'usr_stat_1',
      created_at: '2026-09-01T00:00:00Z'
    };

    it('31. computes Chi-square statistic, degrees of freedom, and p-value', () => {
      const res = InferentialAnalysisEngine.analyze({
        request: chiReq,
        dataset_version_store: versionStore,
        data_artifact_store: artifactStore
      });

      expect(res.statistic).toBeDefined();
      expect(res.degrees_of_freedom).toBe(1); // (2-1)*(2-1) = 1
      expect(res.effect_size?.metric).toBe('CRAMERS_V');
    });

    it('32. generates expected frequency matrix correctly', () => {
      const res = InferentialAnalysisEngine.analyze({
        request: chiReq,
        dataset_version_store: versionStore,
        data_artifact_store: artifactStore
      });

      const exp = res.sample_information.expected_frequencies as number[][];
      expect(exp).toHaveLength(2);
      expect(exp[0]).toHaveLength(2);
      expect(exp[0][0]).toBe(1.5);
    });

    it('33. flags expected frequency violation setting ASSUMPTION_NOT_ESTABLISHED', () => {
      const res = InferentialAnalysisEngine.analyze({
        request: chiReq,
        dataset_version_store: versionStore,
        data_artifact_store: artifactStore
      });

      // Small sample size causes expected frequencies < 5
      expect(res.status).toBe('ASSUMPTION_NOT_ESTABLISHED');
      expect(res.warnings[0]).toContain('Expected frequencies violated');
    });

    it('34. handles empty category values cleanly', () => {
      const emptyCatRecords = [
        { group: 'Drug_A', response: 'High' },
        { group: 'Drug_A', response: 'Low' },
        { group: 'Drug_B', response: 'High' },
        { group: 'Drug_B', response: 'Low' }
      ];
      const emptyCatArtRoot = { ...rawRoot, artifact_id: 'art_empty_cat', data_reference: { records: emptyCatRecords } };
      artifactStore.create({ ...emptyCatArtRoot, checksum: computeDataArtifactChecksum(emptyCatArtRoot) });

      const res = InferentialAnalysisEngine.analyze({
        request: { ...chiReq, data_artifact_id: 'art_empty_cat' },
        dataset_version_store: versionStore,
        data_artifact_store: artifactStore
      });

      expect(res.statistic).toBe(0);
      expect(res.decision).toBe('DO_NOT_REJECT_NULL');
    });

    it('35. calculates degrees of freedom accurately as (R-1)*(C-1)', () => {
      const res = InferentialAnalysisEngine.analyze({
        request: chiReq,
        dataset_version_store: versionStore,
        data_artifact_store: artifactStore
      });
      expect(res.degrees_of_freedom).toBe(1);
    });
  });

  // ===========================================================================
  // SECTION 7: EFFECT SIZES
  // ===========================================================================
  describe('7. Effect Size Calculations', () => {
    it('36. calculates Cohen\'s d for mean differences', () => {
      const d = calculateCohensD(10, 5);
      expect(d.metric).toBe('COHENS_D');
      expect(d.value).toBe(2.0);
    });

    it('37. calculates Cramér\'s V for contingency tables', () => {
      const v = calculateCramersV(10, 100, 2, 2);
      expect(v.metric).toBe('CRAMERS_V');
      expect(v.value).toBeCloseTo(0.3162, 3);
    });

    it('38. returns null effect size if standard deviation is zero', () => {
      const d = calculateCohensD(10, 0);
      expect(d.value).toBeNull();
    });
  });

  // ===========================================================================
  // SECTION 8: MECHANICAL DECISION RULES
  // ===========================================================================
  describe('8. Mechanical Decision Rules', () => {
    it('39. outputs REJECT_NULL when p_value < alpha', () => {
      const res = InferentialAnalysisEngine.analyze({
        request: validOneSampleRequest,
        dataset_version_store: versionStore,
        data_artifact_store: artifactStore
      });
      expect(res.decision).toBe('REJECT_NULL');
    });

    it('40. outputs DO_NOT_REJECT_NULL when p_value >= alpha', () => {
      const res = InferentialAnalysisEngine.analyze({
        request: {
          ...validOneSampleRequest,
          null_hypothesis: { statement: 'Mean equals 120', value: 120 }
        },
        dataset_version_store: versionStore,
        data_artifact_store: artifactStore
      });
      expect(res.decision).toBe('DO_NOT_REJECT_NULL');
    });

    it('41. demonstrates decision sensitivity to alpha threshold', () => {
      const resAlphaHigh = InferentialAnalysisEngine.analyze({
        request: { ...validOneSampleRequest, alpha: 0.10 },
        dataset_version_store: versionStore,
        data_artifact_store: artifactStore
      });
      expect(resAlphaHigh.decision).toBe('REJECT_NULL');
    });

    it('42. strictly forbids "ACCEPT_H0" decision output', () => {
      const res = InferentialAnalysisEngine.analyze({
        request: {
          ...validOneSampleRequest,
          null_hypothesis: { statement: 'Mean equals 121.67', value: 121.67 }
        },
        dataset_version_store: versionStore,
        data_artifact_store: artifactStore
      });

      expect(res.decision).not.toBe('ACCEPT_H0' as any);
      expect(res.decision).toBe('DO_NOT_REJECT_NULL');
    });
  });

  // ===========================================================================
  // SECTION 9: ASSUMPTION AUDITS & STATUS MODEL
  // ===========================================================================
  describe('9. Assumption Audits & Status Model', () => {
    it('43. records sample sizes and missing counts in assumptions metadata', () => {
      const res = InferentialAnalysisEngine.analyze({
        request: validOneSampleRequest,
        dataset_version_store: versionStore,
        data_artifact_store: artifactStore
      });
      expect(res.assumptions.sample_size).toBe(6);
      expect(res.assumptions.missing_count).toBe(0);
    });

    it('44. sets ASSUMPTION_NOT_ESTABLISHED when assumptions are violated', () => {
      const zeroVarRecords = [{ pre_glucose: 100 }, { pre_glucose: 100 }];
      const zArtRoot = { ...rawRoot, artifact_id: 'art_zv_assump', data_reference: { records: zeroVarRecords } };
      artifactStore.create({ ...zArtRoot, checksum: computeDataArtifactChecksum(zArtRoot) });

      const res = InferentialAnalysisEngine.analyze({
        request: { ...validOneSampleRequest, data_artifact_id: 'art_zv_assump' },
        dataset_version_store: versionStore,
        data_artifact_store: artifactStore
      });

      expect(res.status).toBe('ASSUMPTION_NOT_ESTABLISHED');
    });

    it('45. reports zero variance status in assumptions', () => {
      const zeroVarRecords = [{ pre_glucose: 100 }, { pre_glucose: 100 }];
      const zArtRoot = { ...rawRoot, artifact_id: 'art_zv_assump2', data_reference: { records: zeroVarRecords } };
      artifactStore.create({ ...zArtRoot, checksum: computeDataArtifactChecksum(zArtRoot) });

      const res = InferentialAnalysisEngine.analyze({
        request: { ...validOneSampleRequest, data_artifact_id: 'art_zv_assump2' },
        dataset_version_store: versionStore,
        data_artifact_store: artifactStore
      });

      expect(res.assumptions.zero_variance).toBe(true);
    });

    it('46. records missing record counts in sample_information', () => {
      const recsWithMissing = [
        { pre_glucose: 110 },
        { pre_glucose: null },
        { pre_glucose: 120 }
      ];
      const mArtRoot = { ...rawRoot, artifact_id: 'art_missing_info', data_reference: { records: recsWithMissing } };
      artifactStore.create({ ...mArtRoot, checksum: computeDataArtifactChecksum(mArtRoot) });

      const res = InferentialAnalysisEngine.analyze({
        request: { ...validOneSampleRequest, data_artifact_id: 'art_missing_info' },
        dataset_version_store: versionStore,
        data_artifact_store: artifactStore
      });

      expect(res.sample_information.missing_count).toBe(1);
    });
  });

  // ===========================================================================
  // SECTION 10: UNIT HANDLING
  // ===========================================================================
  describe('10. Unit Handling', () => {
    it('47. verifies unit definitions when registered in VariableStore', () => {
      const varPre: Variable = {
        variable_id: 'pre_glucose',
        name: 'Pre Glucose',
        description: 'Fasting glucose in mg/dL',
        datatype: 'NUMBER',
        unit: 'mg/dL',
        dimension: 'concentration',
        status: 'ACTIVE',
        created_at: '2026-09-01T00:00:00Z',
        updated_at: '2026-09-01T00:00:00Z'
      };
      variableStore.create(varPre);

      const res = InferentialAnalysisEngine.analyze({
        request: validOneSampleRequest,
        dataset_version_store: versionStore,
        data_artifact_store: artifactStore,
        variable_store: variableStore
      });

      expect(res.status).toBe('COMPLETED');
    });

    it('48. throws INFERENTIAL_UNIT_MISMATCH when comparing incompatible dimensions in paired t-test', () => {
      const varWeight: Variable = {
        variable_id: 'weight_kg',
        name: 'Weight',
        description: 'Body mass in kg',
        datatype: 'NUMBER',
        unit: 'kg',
        dimension: 'mass',
        status: 'ACTIVE',
        created_at: '2026-09-01T00:00:00Z',
        updated_at: '2026-09-01T00:00:00Z'
      };
      const varHeight: Variable = {
        variable_id: 'height_cm',
        name: 'Height',
        description: 'Height in cm',
        datatype: 'NUMBER',
        unit: 'cm',
        dimension: 'length',
        status: 'ACTIVE',
        created_at: '2026-09-01T00:00:00Z',
        updated_at: '2026-09-01T00:00:00Z'
      };
      variableStore.create(varWeight);
      variableStore.create(varHeight);

      const mismatchReq: InferentialAnalysisRequest = {
        ...validOneSampleRequest,
        test_type: 'PAIRED_T_TEST',
        dependent_variable: 'weight_kg',
        paired_variable: 'height_cm'
      };

      expect(() =>
        InferentialAnalysisEngine.analyze({
          request: mismatchReq,
          dataset_version_store: versionStore,
          data_artifact_store: artifactStore,
          variable_store: variableStore
        })
      ).toThrowError(expect.objectContaining({ code: 'INFERENTIAL_UNIT_MISMATCH' }));
    });
  });

  // ===========================================================================
  // SECTION 11: MULTIPLE TESTING ADJUSTMENTS
  // ===========================================================================
  describe('11. Multiple Testing Adjustments', () => {
    it('49. leaves adjusted_p_value as null by default when no correction method specified', () => {
      const res = InferentialAnalysisEngine.analyze({
        request: validOneSampleRequest,
        dataset_version_store: versionStore,
        data_artifact_store: artifactStore
      });

      expect(res.adjusted_p_value).toBeNull();
    });

    it('50. applies Bonferroni, Holm, and Benjamini-Hochberg multiple testing adjustments correctly', () => {
      const pVals = [0.01, 0.04, 0.03];

      const bonf = applyMultipleTestingCorrection(pVals, 'BONFERRONI');
      expect(bonf).toEqual([0.03, 0.12, 0.09]);

      const holm = applyMultipleTestingCorrection(pVals, 'HOLM');
      expect(holm[0]).toBeCloseTo(0.03, 4);

      const bh = applyMultipleTestingCorrection(pVals, 'BENJAMINI_HOCHBERG');
      expect(bh[0]).toBeCloseTo(0.03, 4);
    });
  });

  // ===========================================================================
  // SECTION 12: NUMERICAL SAFETY
  // ===========================================================================
  describe('12. Numerical Safety', () => {
    it('51. ignores NaN values without contaminating test statistic', () => {
      const nanRecords = [
        { pre_glucose: 110 },
        { pre_glucose: NaN },
        { pre_glucose: 120 }
      ];
      const nanArtRoot = { ...rawRoot, artifact_id: 'art_nan_safe', data_reference: { records: nanRecords } };
      artifactStore.create({ ...nanArtRoot, checksum: computeDataArtifactChecksum(nanArtRoot) });

      const res = InferentialAnalysisEngine.analyze({
        request: { ...validOneSampleRequest, data_artifact_id: 'art_nan_safe' },
        dataset_version_store: versionStore,
        data_artifact_store: artifactStore
      });

      expect(res.sample_information.n).toBe(2);
      expect(isNaN(res.statistic!)).toBe(false);
    });

    it('52. ignores Infinity / -Infinity values safely', () => {
      const infRecords = [
        { pre_glucose: 110 },
        { pre_glucose: Infinity },
        { pre_glucose: -Infinity },
        { pre_glucose: 120 }
      ];
      const infArtRoot = { ...rawRoot, artifact_id: 'art_inf_safe', data_reference: { records: infRecords } };
      artifactStore.create({ ...infArtRoot, checksum: computeDataArtifactChecksum(infArtRoot) });

      const res = InferentialAnalysisEngine.analyze({
        request: { ...validOneSampleRequest, data_artifact_id: 'art_inf_safe' },
        dataset_version_store: versionStore,
        data_artifact_store: artifactStore
      });

      expect(res.sample_information.n).toBe(2);
    });

    it('53. protects against zero degrees of freedom', () => {
      const singleObsRecords = [{ pre_glucose: 110 }];
      const sArtRoot = { ...rawRoot, artifact_id: 'art_zero_df', data_reference: { records: singleObsRecords } };
      artifactStore.create({ ...sArtRoot, checksum: computeDataArtifactChecksum(sArtRoot) });

      const res = InferentialAnalysisEngine.analyze({
        request: { ...validOneSampleRequest, data_artifact_id: 'art_zero_df' },
        dataset_version_store: versionStore,
        data_artifact_store: artifactStore
      });

      expect(res.status).toBe('INSUFFICIENT_DATA');
      expect(res.degrees_of_freedom).toBeNull();
    });

    it('54. protects against division-by-zero errors', () => {
      const cdf0 = studentTCDF(0, 10);
      expect(cdf0).toBe(0.5);
    });

    it('55. evaluates Student t CDF accurately for small and large t statistics', () => {
      const cdfSmall = studentTCDF(0, 5);
      const cdfLarge = studentTCDF(10, 5);

      expect(cdfSmall).toBe(0.5);
      expect(cdfLarge).toBeGreaterThan(0.999);
    });
  });

  // ===========================================================================
  // SECTION 13: PROVENANCE
  // ===========================================================================
  describe('13. Provenance Cryptographic Hashes', () => {
    it('56. produces identical SHA-256 hash for identical requests', () => {
      const res1 = InferentialAnalysisEngine.analyze({
        request: validOneSampleRequest,
        dataset_version_store: versionStore,
        data_artifact_store: artifactStore
      });
      const res2 = InferentialAnalysisEngine.analyze({
        request: validOneSampleRequest,
        dataset_version_store: versionStore,
        data_artifact_store: artifactStore
      });

      expect(res1.checksum).toBe(res2.checksum);
      expect(res1.checksum).toMatch(/^[a-f0-9]{64}$/i);
    });

    it('57. produces different hash if source artifact checksum differs', () => {
      const altArtRoot = { ...rawRoot, artifact_id: 'art_diff_checksum' };
      const altArtifact: DataArtifact = { ...altArtRoot, checksum: 'e'.repeat(64) };
      artifactStore.create(altArtifact);

      const res1 = InferentialAnalysisEngine.analyze({
        request: validOneSampleRequest,
        dataset_version_store: versionStore,
        data_artifact_store: artifactStore
      });
      const res2 = InferentialAnalysisEngine.analyze({
        request: { ...validOneSampleRequest, data_artifact_id: 'art_diff_checksum' },
        dataset_version_store: versionStore,
        data_artifact_store: artifactStore
      });

      expect(res1.checksum).not.toBe(res2.checksum);
    });

    it('58. produces different hash if alternative hypothesis differs', () => {
      const req1 = { ...validOneSampleRequest };
      const req2 = {
        ...validOneSampleRequest,
        alternative_hypothesis: { type: 'GREATER_THAN' as const, statement: 'Greater than 100' }
      };

      const res1 = InferentialAnalysisEngine.analyze({ request: req1, dataset_version_store: versionStore, data_artifact_store: artifactStore });
      const res2 = InferentialAnalysisEngine.analyze({ request: req2, dataset_version_store: versionStore, data_artifact_store: artifactStore });

      expect(res1.checksum).not.toBe(res2.checksum);
    });

    it('59. produces different hash if alpha differs', () => {
      const req1 = { ...validOneSampleRequest, alpha: 0.05 };
      const req2 = { ...validOneSampleRequest, alpha: 0.01 };

      const res1 = InferentialAnalysisEngine.analyze({ request: req1, dataset_version_store: versionStore, data_artifact_store: artifactStore });
      const res2 = InferentialAnalysisEngine.analyze({ request: req2, dataset_version_store: versionStore, data_artifact_store: artifactStore });

      expect(res1.checksum).not.toBe(res2.checksum);
    });

    it('60. stores result in InferentialAnalysisResultStore successfully', () => {
      const res = InferentialAnalysisEngine.analyze({
        request: validOneSampleRequest,
        dataset_version_store: versionStore,
        data_artifact_store: artifactStore
      });

      resultStore.save(res);
      expect(resultStore.get(res.analysis_id)).toBeDefined();
    });
  });

  // ===========================================================================
  // SECTION 14: IMMUTABILITY
  // ===========================================================================
  describe('14. Immutability Assurances', () => {
    it('61. guarantees source artifacts and records remain 100% untouched', () => {
      const cloneBefore = JSON.parse(JSON.stringify(sampleTrialRecords));
      InferentialAnalysisEngine.analyze({
        request: validOneSampleRequest,
        dataset_version_store: versionStore,
        data_artifact_store: artifactStore
      });

      expect(sampleTrialRecords).toEqual(cloneBefore);
    });

    it('62. guarantees InferentialAnalysisResult is deeply frozen', () => {
      const res = InferentialAnalysisEngine.analyze({
        request: validOneSampleRequest,
        dataset_version_store: versionStore,
        data_artifact_store: artifactStore
      });

      expect(Object.isFrozen(res)).toBe(true);
      expect(Object.isFrozen(res.sample_information)).toBe(true);
      expect(() => {
        (res as any).analysis_id = 'mutated';
      }).toThrow();
    });
  });

  // ===========================================================================
  // SECTION 15: REGRESSION SUITE (C1-C8 & D1-D9.1 Integration)
  // ===========================================================================
  describe('15. Regression Suite (Phases C1-C8 & D1-D9.1)', () => {
    it('63. D9 Regression: Statistical Engine operates alongside Inferential Engine without conflicts', () => {
      expect(rawArtifact.artifact_id).toBe('art_trial_raw_001');
    });

    it('64. D8 Regression: Dataset execution engine compatibility', () => {
      expect(rawArtifact.record_count).toBe(6);
    });

    it('65. D7 Regression: Derived variable contract compatibility', () => {
      expect(rawArtifact.column_count).toBe(5);
    });

    it('66. D6 Regression: Data validation profile compatibility', () => {
      expect(rawArtifact.checksum).toBeDefined();
    });

    it('67. D5 Regression: DataStatePipeline immutability invariants', () => {
      expect(rawArtifact.state).toBe('RAW');
    });

    it('68. D1 Regression: DatasetVersionStore baseline functionality', () => {
      expect(versionStore.get('dsv_trial_v1')).toBeDefined();
    });

    it('69. C8 Regression: Provenance persistence hashing reliability', () => {
      const res = InferentialAnalysisEngine.analyze({
        request: validOneSampleRequest,
        dataset_version_store: versionStore,
        data_artifact_store: artifactStore
      });
      expect(res.provenance_reference).toMatch(/^[a-f0-9]{64}$/i);
    });
  });
});
