import { describe, expect, it } from 'vitest';
import { DataArtifactStore, computeDataArtifactChecksum } from '../data/dataStatePipeline';
import { DatasetVersionStore, computeDatasetVersionChecksum } from '../data/datasetVersion';
import {
  computeFisherExact,
  computeFriedman,
  computeKruskalWallis,
  computeMannWhitneyU,
  computeSpearmanCorrelation,
  computeWilcoxonSignedRank
} from '../data/nonParametricAnalysis';
import {
  NonParametricAnalysisRequest,
  ScientificNonParametricError,
  validateNonParametricRequest
} from '../data/nonParametricContracts';
import { NonParametricEngine } from '../data/nonParametricEngine';
import { VariableStore } from '../data/variableRegistry';
import { DataArtifact, DatasetVersion, Variable } from '../types';

describe('Phase D13 — Non-Parametric & Robust Statistical Analysis Engine', () => {
  // Test Fixtures & In-Memory Stores Setup
  const dsvStore = new DatasetVersionStore();
  const artStore = new DataArtifactStore();
  const varStore = new VariableStore();

  const datasetVersionData = {
    version_id: 'dsv_nonpar_v1',
    dataset_id: 'ds_metabolic_cohort',
    version_number: 1,
    status: 'ACTIVE' as const,
    created_at: '2026-09-01T00:00:00Z',
    created_by: 'system'
  };

  const datasetVersion: DatasetVersion = {
    ...datasetVersionData,
    checksum: computeDatasetVersionChecksum(datasetVersionData)
  };
  dsvStore.create(datasetVersion);

  const rawArtifact: DataArtifact = {
    artifact_id: 'art_raw_nonpar',
    dataset_version_id: 'dsv_nonpar_v1',
    state: 'RAW',
    data_reference: { records: [] },
    record_count: 0,
    column_count: 5,
    checksum: 'a1b2c3d4e5f678901234567890abcdef1234567890abcdef1234567890abcdef',
    created_at: '2026-09-01T00:00:00Z',
    created_by: 'system'
  };
  artStore.create(rawArtifact);

  const sampleRecords = [
    { id: '1', diet: 'A', glucose: 110, insulin: 12, pre_sys: 120, post_sys: 110, score1: 5, score2: 6, score3: 7 },
    { id: '2', diet: 'A', glucose: 115, insulin: 14, pre_sys: 125, post_sys: 112, score1: 6, score2: 7, score3: 8 },
    { id: '3', diet: 'A', glucose: 120, insulin: 15, pre_sys: 130, post_sys: 115, score1: 7, score2: 8, score3: 9 },
    { id: '4', diet: 'A', glucose: 125, insulin: 16, pre_sys: 135, post_sys: 118, score1: 8, score2: 9, score3: 10 },
    { id: '5', diet: 'A', glucose: 130, insulin: 18, pre_sys: 140, post_sys: 120, score1: 9, score2: 10, score3: 11 },
    { id: '6', diet: 'B', glucose: 80, insulin: 6, pre_sys: 110, post_sys: 105, score1: 4, score2: 5, score3: 6 },
    { id: '7', diet: 'B', glucose: 85, insulin: 7, pre_sys: 112, post_sys: 106, score1: 5, score2: 6, score3: 7 },
    { id: '8', diet: 'B', glucose: 90, insulin: 8, pre_sys: 115, post_sys: 108, score1: 6, score2: 7, score3: 8 },
    { id: '9', diet: 'B', glucose: 92, insulin: 9, pre_sys: 118, post_sys: 110, score1: 7, score2: 8, score3: 9 },
    { id: '10', diet: 'B', glucose: 95, insulin: 10, pre_sys: 120, post_sys: 112, score1: 8, score2: 9, score3: 10 },
    { id: '11', diet: 'C', glucose: 140, insulin: 20, pre_sys: 150, post_sys: 140, score1: 9, score2: 10, score3: 11 },
    { id: '12', diet: 'C', glucose: 145, insulin: 22, pre_sys: 155, post_sys: 142, score1: 10, score2: 11, score3: 12 }
  ];

  const valArtifact: DataArtifact = {
    artifact_id: 'art_val_nonpar',
    dataset_version_id: 'dsv_nonpar_v1',
    state: 'VALIDATED',
    parent_artifact_id: 'art_raw_nonpar',
    data_reference: { records: sampleRecords },
    record_count: sampleRecords.length,
    column_count: 9,
    checksum: computeDataArtifactChecksum({
      artifact_id: 'art_val_nonpar',
      dataset_version_id: 'dsv_nonpar_v1',
      state: 'VALIDATED'
    }),
    created_at: '2026-09-01T00:00:00Z',
    created_by: 'system'
  };
  artStore.create(valArtifact);

  const varGlucose: Variable = {
    variable_id: 'glucose',
    name: 'Blood Glucose',
    description: 'Fasting blood glucose in mg/dL',
    datatype: 'NUMBER',
    unit: 'mg/dL',
    dimension: 'concentration',
    status: 'ACTIVE',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z'
  };
  varStore.create(varGlucose);

  const defaultRequestBase: Omit<NonParametricAnalysisRequest, 'test_type'> = {
    analysis_id: 'np_req_001',
    dataset_version_id: 'dsv_nonpar_v1',
    data_artifact_id: 'art_val_nonpar',
    dependent_variable: 'glucose',
    null_hypothesis: { statement: 'Distributions are identical' },
    alternative_hypothesis: { type: 'TWO_SIDED', statement: 'Distributions differ' },
    alpha: 0.05
  };

  // ==========================================
  // 1. CONTRACT & VALIDATION TESTS
  // ==========================================
  describe('1. Contract & Request Validation', () => {
    it('1. Validates a structurally sound request', () => {
      const req: NonParametricAnalysisRequest = {
        ...defaultRequestBase,
        test_type: 'MANN_WHITNEY_U',
        grouping_variable: 'diet'
      };
      const val = validateNonParametricRequest(req);
      expect(val.valid).toBe(true);
      expect(val.errors).toHaveLength(0);
    });

    it('2. Flags invalid or missing dataset_version_id', () => {
      const req = {
        ...defaultRequestBase,
        dataset_version_id: '',
        test_type: 'MANN_WHITNEY_U'
      } as NonParametricAnalysisRequest;
      const val = validateNonParametricRequest(req);
      expect(val.valid).toBe(false);
      expect(val.errors.some((e) => e.includes('dataset_version_id'))).toBe(true);
    });

    it('3. Throws ScientificNonParametricError on missing DatasetVersion', () => {
      const req: NonParametricAnalysisRequest = {
        ...defaultRequestBase,
        dataset_version_id: 'dsv_nonexistent',
        test_type: 'MANN_WHITNEY_U'
      };

      expect(() => {
        NonParametricEngine.analyze({
          request: req,
          dataset_version_store: dsvStore,
          data_artifact_store: artStore
        });
      }).toThrowError(ScientificNonParametricError);
    });

    it('4. Throws ScientificNonParametricError on version mismatch', () => {
      const wrongVersionData = {
        ...datasetVersionData,
        version_id: 'dsv_wrong_v2',
        version_number: 2
      };
      const wrongVersion: DatasetVersion = {
        ...wrongVersionData,
        checksum: computeDatasetVersionChecksum(wrongVersionData)
      };
      dsvStore.create(wrongVersion);

      const req: NonParametricAnalysisRequest = {
        ...defaultRequestBase,
        dataset_version_id: 'dsv_wrong_v2',
        data_artifact_id: 'art_val_nonpar',
        test_type: 'MANN_WHITNEY_U'
      };

      expect(() => {
        NonParametricEngine.analyze({
          request: req,
          dataset_version_store: dsvStore,
          data_artifact_store: artStore
        });
      }).toThrowError(ScientificNonParametricError);
    });

    it('5. Throws ScientificNonParametricError on missing variable', () => {
      const req: NonParametricAnalysisRequest = {
        ...defaultRequestBase,
        dependent_variable: 'nonexistent_var',
        test_type: 'MANN_WHITNEY_U',
        grouping_variable: 'diet'
      };

      expect(() => {
        NonParametricEngine.analyze({
          request: req,
          dataset_version_store: dsvStore,
          data_artifact_store: artStore,
          variable_store: varStore
        });
      }).toThrowError(ScientificNonParametricError);
    });
  });

  // ==========================================
  // 2. MANN–WHITNEY U TESTS
  // ==========================================
  describe('2. Mann-Whitney U Test', () => {
    it('6. Computes basic two-group Mann-Whitney U test accurately', () => {
      const groupA = [110, 115, 120, 125, 130];
      const groupB = [80, 85, 90, 92, 95];
      const res = computeMannWhitneyU(groupA, groupB, 'TWO_SIDED');

      expect(res.uStatistic).toBe(0); // All B < all A
      expect(res.u1).toBe(0);
      expect(res.u2).toBe(25);
      expect(res.pValue).toBeLessThan(0.05);
    });

    it('7. Handles tied values with tie correction', () => {
      const groupA = [100, 100, 110];
      const groupB = [90, 100, 105];
      const res = computeMannWhitneyU(groupA, groupB, 'TWO_SIDED');

      expect(res.tieCount).toBe(3); // 100 occurs 3 times
      expect(res.tieCorrectionSum).toBe(3 * 3 * 3 - 3); // 24
      expect(res.pValue).toBeGreaterThan(0);
    });

    it('8. Evaluates Mann-Whitney U via Engine end-to-end', () => {
      const req: NonParametricAnalysisRequest = {
        ...defaultRequestBase,
        test_type: 'MANN_WHITNEY_U',
        dependent_variable: 'glucose',
        grouping_variable: 'diet',
        group_a: 'A',
        group_b: 'B'
      };

      const res = NonParametricEngine.analyze({
        request: req,
        dataset_version_store: dsvStore,
        data_artifact_store: artStore
      });

      expect(res.status).toBe('COMPLETED');
      expect(res.test_statistic).toBeDefined();
      expect(res.decision).toBe('REJECT_NULL');
      expect(res.sample_info.group_sizes).toEqual({ A: 5, B: 5 });
    });

    it('9. Supports directional alternative hypothesis (GREATER_THAN)', () => {
      const groupA = [110, 115, 120, 125, 130];
      const groupB = [80, 85, 90, 92, 95];
      const res = computeMannWhitneyU(groupA, groupB, 'GREATER_THAN');
      expect(res.pValue).toBeLessThan(0.05);
    });
  });

  // ==========================================
  // 3. WILCOXON SIGNED-RANK TESTS
  // ==========================================
  describe('3. Wilcoxon Signed-Rank Test', () => {
    it('10. Computes Wilcoxon signed-rank for paired observations', () => {
      const pairs = [
        { x: 120, y: 110 },
        { x: 125, y: 112 },
        { x: 130, y: 115 },
        { x: 135, y: 118 },
        { x: 140, y: 120 },
        { x: 150, y: 125 }
      ];

      const res = computeWilcoxonSignedRank(pairs, 'TWO_SIDED');
      expect(res.effectivePairs).toBe(6);
      expect(res.wNegative).toBe(0);
      expect(res.wPositive).toBe(21);
      expect(res.pValue).toBeLessThan(0.05);
    });

    it('11. Properly removes and documents zero differences', () => {
      const pairs = [
        { x: 120, y: 120 }, // Zero difference
        { x: 125, y: 118 },
        { x: 130, y: 125 }
      ];

      const res = computeWilcoxonSignedRank(pairs, 'TWO_SIDED');
      expect(res.totalPairs).toBe(3);
      expect(res.zeroDifferencesRemoved).toBe(1);
      expect(res.effectivePairs).toBe(2);
    });

    it('12. Evaluates Wilcoxon signed-rank via Engine using paired_variable', () => {
      const req: NonParametricAnalysisRequest = {
        ...defaultRequestBase,
        test_type: 'WILCOXON_SIGNED_RANK',
        dependent_variable: 'pre_sys',
        paired_variable: 'post_sys'
      };

      const res = NonParametricEngine.analyze({
        request: req,
        dataset_version_store: dsvStore,
        data_artifact_store: artStore
      });

      expect(res.status).toBe('COMPLETED');
      expect(res.sample_info.zero_differences_removed).toBe(0);
      expect(res.decision).toBe('REJECT_NULL');
    });

    it('13. Throws on duplicate paired keys when using paired_key', () => {
      const dupRecords = [
        { subject_id: 'sub1', group: 'A', val: 10 },
        { subject_id: 'sub1', group: 'A', val: 12 }, // Duplicate key
        { subject_id: 'sub1', group: 'B', val: 8 }
      ];

      const dupArtifact: DataArtifact = {
        artifact_id: 'art_dup_pair',
        dataset_version_id: 'dsv_nonpar_v1',
        state: 'VALIDATED',
        parent_artifact_id: 'art_raw_nonpar',
        data_reference: { records: dupRecords },
        record_count: 3,
        column_count: 3,
        checksum: computeDataArtifactChecksum({
          artifact_id: 'art_dup_pair',
          dataset_version_id: 'dsv_nonpar_v1',
          state: 'VALIDATED'
        }),
        created_at: '2026-09-01T00:00:00Z',
        created_by: 'system'
      };
      artStore.create(dupArtifact);

      const req: NonParametricAnalysisRequest = {
        ...defaultRequestBase,
        data_artifact_id: 'art_dup_pair',
        test_type: 'WILCOXON_SIGNED_RANK',
        dependent_variable: 'val',
        grouping_variable: 'group',
        group_a: 'A',
        group_b: 'B',
        configuration: { paired_key: 'subject_id' }
      };

      expect(() => {
        NonParametricEngine.analyze({
          request: req,
          dataset_version_store: dsvStore,
          data_artifact_store: artStore
        });
      }).toThrowError(ScientificNonParametricError);
    });
  });

  // ==========================================
  // 4. KRUSKAL–WALLIS TESTS
  // ==========================================
  describe('4. Kruskal-Wallis Test', () => {
    it('14. Computes Kruskal-Wallis test across 3 groups', () => {
      const groups = {
        A: [105, 110, 115],
        B: [95, 98, 100],
        C: [130, 135]
      };

      const res = computeKruskalWallis(groups);
      expect(res.degreesOfFreedom).toBe(2);
      expect(res.hAdjusted).toBeGreaterThan(0);
      expect(res.pValue).toBeLessThan(0.05);
    });

    it('15. Evaluates Kruskal-Wallis via Engine across diets A, B, C', () => {
      const req: NonParametricAnalysisRequest = {
        ...defaultRequestBase,
        test_type: 'KRUSKAL_WALLIS',
        dependent_variable: 'glucose',
        grouping_variable: 'diet'
      };

      const res = NonParametricEngine.analyze({
        request: req,
        dataset_version_store: dsvStore,
        data_artifact_store: artStore
      });

      expect(res.status).toBe('COMPLETED');
      expect(res.degrees_of_freedom).toBe(2);
      expect(res.decision).toBe('REJECT_NULL');
      expect(res.effect_size?.metric).toBe('ETA_SQUARED_H');
    });
  });

  // ==========================================
  // 5. FRIEDMAN TESTS
  // ==========================================
  describe('5. Friedman Test', () => {
    it('16. Computes Friedman test for 3 repeated conditions', () => {
      const matrix = [
        [5, 6, 7],
        [6, 7, 8],
        [7, 8, 9],
        [4, 5, 6],
        [5, 6, 7],
        [6, 7, 8],
        [8, 9, 10],
        [9, 10, 11]
      ];

      const res = computeFriedman(matrix);
      expect(res.conditionCount).toBe(3);
      expect(res.completeBlocks).toBe(8);
      expect(res.degreesOfFreedom).toBe(2);
      expect(res.pValue).toBeLessThan(0.05);
      expect(res.effectSize).toBe(1.0); // Perfect consistent ranking
    });

    it('17. Evaluates Friedman test via Engine using independent_variables columns', () => {
      const req: NonParametricAnalysisRequest = {
        ...defaultRequestBase,
        test_type: 'FRIEDMAN',
        dependent_variable: 'score1',
        independent_variables: ['score1', 'score2', 'score3'],
        block_variable: 'id'
      };

      const res = NonParametricEngine.analyze({
        request: req,
        dataset_version_store: dsvStore,
        data_artifact_store: artStore
      });

      expect(res.status).toBe('COMPLETED');
      expect(res.degrees_of_freedom).toBe(2);
      expect(res.decision).toBe('REJECT_NULL');
      expect(res.sample_info.complete_blocks).toBe(12);
    });
  });

  // ==========================================
  // 6. SPEARMAN CORRELATION TESTS
  // ==========================================
  describe('6. Spearman Correlation Test', () => {
    it('18. Computes positive Spearman correlation accurately', () => {
      const x = [10, 20, 30, 40, 50];
      const y = [15, 25, 35, 45, 55];

      const res = computeSpearmanCorrelation(x, y, 'TWO_SIDED');
      expect(res.rho).toBe(1.0);
      expect(res.pValue).toBeLessThan(0.05);
    });

    it('19. Computes negative Spearman correlation accurately', () => {
      const x = [10, 20, 30, 40, 50];
      const y = [50, 40, 30, 20, 10];

      const res = computeSpearmanCorrelation(x, y, 'TWO_SIDED');
      expect(res.rho).toBe(-1.0);
      expect(res.pValue).toBeLessThan(0.05);
    });

    it('20. Throws ScientificNonParametricError on zero variance', () => {
      const req: NonParametricAnalysisRequest = {
        ...defaultRequestBase,
        test_type: 'SPEARMAN_CORRELATION',
        dependent_variable: 'glucose',
        independent_variables: ['constant_col']
      };

      const zeroVarRecords = [
        { glucose: 100, constant_col: 5 },
        { glucose: 110, constant_col: 5 },
        { glucose: 120, constant_col: 5 }
      ];

      const zeroArtifact: DataArtifact = {
        artifact_id: 'art_zero_var',
        dataset_version_id: 'dsv_nonpar_v1',
        state: 'VALIDATED',
        parent_artifact_id: 'art_raw_nonpar',
        data_reference: { records: zeroVarRecords },
        record_count: 3,
        column_count: 2,
        checksum: computeDataArtifactChecksum({
          artifact_id: 'art_zero_var',
          dataset_version_id: 'dsv_nonpar_v1',
          state: 'VALIDATED'
        }),
        created_at: '2026-09-01T00:00:00Z',
        created_by: 'system'
      };
      artStore.create(zeroArtifact);

      const reqZero: NonParametricAnalysisRequest = {
        ...req,
        data_artifact_id: 'art_zero_var'
      };

      expect(() => {
        NonParametricEngine.analyze({
          request: reqZero,
          dataset_version_store: dsvStore,
          data_artifact_store: artStore
        });
      }).toThrowError(ScientificNonParametricError);
    });
  });

  // ==========================================
  // 7. FISHER'S EXACT TEST (2x2)
  // ==========================================
  describe('7. Fisher Exact Test', () => {
    it('21. Computes Fisher exact test for 2x2 contingency table', () => {
      // Table: [[10, 2], [1, 11]]
      const res = computeFisherExact(10, 2, 1, 11, 'TWO_SIDED');
      expect(res.oddsRatio).toBe(55);
      expect(res.pValue).toBeLessThan(0.01);
      expect(res.sampleSize).toBe(24);
    });

    it('22. Evaluates Fisher exact test via Engine', () => {
      const req: NonParametricAnalysisRequest = {
        ...defaultRequestBase,
        test_type: 'FISHER_EXACT',
        dependent_variable: 'outcome',
        grouping_variable: 'treatment',
        configuration: {
          metadata: {
            observed: [
              [10, 2],
              [1, 11]
            ]
          }
        }
      };

      const res = NonParametricEngine.analyze({
        request: req,
        dataset_version_store: dsvStore,
        data_artifact_store: artStore
      });

      expect(res.status).toBe('COMPLETED');
      expect(res.contingency_table?.odds_ratio).toBe(55);
      expect(res.decision).toBe('REJECT_NULL');
    });

    it('23. Throws on invalid non-2x2 contingency matrix', () => {
      const req: NonParametricAnalysisRequest = {
        ...defaultRequestBase,
        test_type: 'FISHER_EXACT',
        dependent_variable: 'outcome',
        configuration: {
          metadata: {
            observed: [
              [10, 2, 3],
              [1, 11, 4]
            ]
          }
        }
      };

      expect(() => {
        NonParametricEngine.analyze({
          request: req,
          dataset_version_store: dsvStore,
          data_artifact_store: artStore
        });
      }).toThrowError(ScientificNonParametricError);
    });
  });

  // ==========================================
  // 8. PROVENANCE INTEGRITY TESTS
  // ==========================================
  describe('8. Provenance Integrity', () => {
    it('24. Same request produces identical provenance hash digest', () => {
      const req: NonParametricAnalysisRequest = {
        ...defaultRequestBase,
        test_type: 'MANN_WHITNEY_U',
        grouping_variable: 'diet',
        group_a: 'A',
        group_b: 'B'
      };

      const res1 = NonParametricEngine.analyze({
        request: req,
        dataset_version_store: dsvStore,
        data_artifact_store: artStore
      });

      const res2 = NonParametricEngine.analyze({
        request: req,
        dataset_version_store: dsvStore,
        data_artifact_store: artStore
      });

      expect(res1.provenance_hash).toBe(res2.provenance_hash);
      expect(res1.provenance_hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('25. Changed alpha alters provenance hash digest', () => {
      const req1: NonParametricAnalysisRequest = {
        ...defaultRequestBase,
        test_type: 'MANN_WHITNEY_U',
        grouping_variable: 'diet',
        alpha: 0.05
      };

      const req2: NonParametricAnalysisRequest = {
        ...req1,
        alpha: 0.01
      };

      const res1 = NonParametricEngine.analyze({
        request: req1,
        dataset_version_store: dsvStore,
        data_artifact_store: artStore
      });

      const res2 = NonParametricEngine.analyze({
        request: req2,
        dataset_version_store: dsvStore,
        data_artifact_store: artStore
      });

      expect(res1.provenance_hash).not.toBe(res2.provenance_hash);
    });

    it('26. Changed test type alters provenance hash digest', () => {
      const req1: NonParametricAnalysisRequest = {
        ...defaultRequestBase,
        test_type: 'MANN_WHITNEY_U',
        grouping_variable: 'diet'
      };

      const req2: NonParametricAnalysisRequest = {
        ...defaultRequestBase,
        test_type: 'KRUSKAL_WALLIS',
        grouping_variable: 'diet'
      };

      const res1 = NonParametricEngine.analyze({
        request: req1,
        dataset_version_store: dsvStore,
        data_artifact_store: artStore
      });

      const res2 = NonParametricEngine.analyze({
        request: req2,
        dataset_version_store: dsvStore,
        data_artifact_store: artStore
      });

      expect(res1.provenance_hash).not.toBe(res2.provenance_hash);
    });
  });

  // ==========================================
  // 9. IMMUTABILITY & SECURITY TESTS
  // ==========================================
  describe('9. Immutability & Security Audit', () => {
    it('27. Result object is deeply frozen', () => {
      const req: NonParametricAnalysisRequest = {
        ...defaultRequestBase,
        test_type: 'MANN_WHITNEY_U',
        grouping_variable: 'diet'
      };

      const res = NonParametricEngine.analyze({
        request: req,
        dataset_version_store: dsvStore,
        data_artifact_store: artStore
      });

      expect(Object.isFrozen(res)).toBe(true);
      expect(Object.isFrozen(res.sample_info)).toBe(true);
      expect(Object.isFrozen(res.assumption_audit)).toBe(true);

      expect(() => {
        (res as any).alpha = 0.01;
      }).toThrow();
    });

    it('28. Input request object is not mutated', () => {
      const req: NonParametricAnalysisRequest = {
        ...defaultRequestBase,
        test_type: 'MANN_WHITNEY_U',
        grouping_variable: 'diet'
      };

      const reqCopy = JSON.parse(JSON.stringify(req));
      NonParametricEngine.analyze({
        request: req,
        dataset_version_store: dsvStore,
        data_artifact_store: artStore
      });

      expect(req).toEqual(reqCopy);
    });

    it('29. Result scientific_validity is ALWAYS NOT_ESTABLISHED', () => {
      const req: NonParametricAnalysisRequest = {
        ...defaultRequestBase,
        test_type: 'MANN_WHITNEY_U',
        grouping_variable: 'diet'
      };

      const res = NonParametricEngine.analyze({
        request: req,
        dataset_version_store: dsvStore,
        data_artifact_store: artStore
      });

      expect(res.scientific_validity).toBe('NOT_ESTABLISHED');
    });

    it('30. Security Audit: Engine contains zero eval or dynamic execution', () => {
      const code = NonParametricEngine.toString() + computeMannWhitneyU.toString();
      expect(code).not.toContain('eval(');
      expect(code).not.toContain('new Function(');
    });
  });
});
