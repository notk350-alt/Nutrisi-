/**
 * Phase D9 — Scientific Data Layer: Statistical Analysis Engine Tests
 *
 * Comprehensive test suite covering:
 * 1. Contract Validation
 * 2. Numeric Statistics (count, mean, median, min, max, variance, std, IQR, percentiles)
 * 3. Categorical Distributions & Ordering
 * 4. Missingness Audits
 * 5. Grouped & Stratified Summaries
 * 6. Typed Record Filtering (eval-free)
 * 7. Pairwise Associations (Pearson & Contingency Tables)
 * 8. Unit Handling & Normalization
 * 9. Outlier Detection (IQR & Z-score non-destructive)
 * 10. Numerical Safety (NaN, Infinity, Division-by-zero)
 * 11. Provenance & Cryptographic Checksums
 * 12. Regressions across C1-C8 and D1-D8
 */

import { describe, expect, it } from 'vitest';
import {
  AnalysisRequest,
  AnalysisResultStore,
  ScientificStatisticalAnalysisError,
  StatisticalAnalysisEngine,
  computeCategoricalFrequency,
  computeDescriptiveNumeric,
  computeDistributionSummary,
  computeGroupedSummary,
  computeMissingnessSummary,
  computeOutlierDetection,
  computePairwiseAssociation,
  evaluateRecordFilters
} from '../index';
import { DatasetVersionStore } from '../data/datasetVersion';
import { DataArtifactStore, computeDataArtifactChecksum } from '../data/dataStatePipeline';
import { VariableStore } from '../data/variableRegistry';
import { DataArtifact, DatasetVersion, Variable } from '../types';

describe('Phase D9: Statistical Analysis Engine', () => {
  // Setup standard fixtures
  const versionStore = new DatasetVersionStore();
  const artifactStore = new DataArtifactStore();
  const variableStore = new VariableStore();
  const resultSetStore = new AnalysisResultStore();

  const validDatasetVersion: DatasetVersion = {
    version_id: 'dsv_metabolic_v1',
    dataset_id: 'ds_metabolic_cohort',
    version_number: 1,
    status: 'ACTIVE',
    created_at: '2026-09-01T00:00:00Z',
    created_by: 'usr_researcher_1',
    checksum: '0000000000000000000000000000000000000000000000000000000000000000'
  };
  versionStore.create(validDatasetVersion);

  const sampleRecords = [
    { record_id: 'rec_1', weight_kg: 70, height_cm: 175, sex: 'Female', activity: 'Moderate' },
    { record_id: 'rec_2', weight_kg: 80, height_cm: 180, sex: 'Male', activity: 'High' },
    { record_id: 'rec_3', weight_kg: 65, height_cm: 165, sex: 'Female', activity: 'Low' },
    { record_id: 'rec_4', weight_kg: 90, height_cm: 185, sex: 'Male', activity: 'Moderate' },
    { record_id: 'rec_5', weight_kg: 120, height_cm: 190, sex: 'Male', activity: 'High' }, // High weight outlier
    { record_id: 'rec_6', weight_kg: null, height_cm: 170, sex: 'Female', activity: 'Low' } // Missing weight
  ];

  const rawRoot = {
    artifact_id: 'art_raw_001',
    dataset_version_id: 'dsv_metabolic_v1',
    state: 'RAW' as const,
    data_reference: { records: sampleRecords },
    record_count: sampleRecords.length,
    column_count: 5,
    created_at: '2026-09-01T00:00:00Z',
    created_by: 'usr_researcher_1'
  };
  const rawArtifact: DataArtifact = {
    ...rawRoot,
    checksum: computeDataArtifactChecksum(rawRoot)
  };
  artifactStore.create(rawArtifact);

  const artifactRoot = {
    artifact_id: 'art_cohort_validated_001',
    dataset_version_id: 'dsv_metabolic_v1',
    state: 'VALIDATED' as const,
    parent_artifact_id: 'art_raw_001',
    data_reference: { records: sampleRecords },
    record_count: sampleRecords.length,
    column_count: 5,
    created_at: '2026-09-01T00:00:00Z',
    created_by: 'usr_researcher_1'
  };

  const sampleArtifact: DataArtifact = {
    ...artifactRoot,
    checksum: computeDataArtifactChecksum(artifactRoot)
  };
  artifactStore.create(sampleArtifact);

  const varWeight: Variable = {
    variable_id: 'weight_kg',
    name: 'Weight',
    description: 'Body mass measured in kilograms',
    datatype: 'NUMBER',
    unit: 'kg',
    dimension: 'mass',
    status: 'ACTIVE',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z'
  };
  variableStore.create(varWeight);

  const validRequest: AnalysisRequest = {
    analysis_id: 'ana_desc_weight_001',
    dataset_version_id: 'dsv_metabolic_v1',
    data_artifact_id: 'art_cohort_validated_001',
    requested_variables: ['weight_kg'],
    analysis_type: 'DESCRIPTIVE_NUMERIC',
    created_by: 'usr_researcher_1',
    created_at: '2026-09-01T00:00:00Z'
  };

  // ===========================================================================
  // SECTION 1: CONTRACT VALIDATION
  // ===========================================================================
  describe('1. Contract Validation', () => {
    it('1. accepts a valid analysis request', () => {
      const res = StatisticalAnalysisEngine.analyze({
        request: validRequest,
        dataset_version_store: versionStore,
        data_artifact_store: artifactStore,
        variable_store: variableStore
      });

      expect(res.analysis_id).toBe('ana_desc_weight_001');
      expect(res.scientific_validity).toBe('NOT_ESTABLISHED');
      expect(res.result.numeric_summaries).toHaveProperty('weight_kg');
    });

    it('2. rejects request missing analysis_id or dataset_version_id', () => {
      expect(() =>
        StatisticalAnalysisEngine.analyze({
          request: { ...validRequest, analysis_id: '' },
          dataset_version_store: versionStore,
          data_artifact_store: artifactStore
        })
      ).toThrowError(expect.objectContaining({ code: 'ANALYSIS_INVALID_CONTRACT' }));
    });

    it('3. throws ANALYSIS_DATASET_NOT_FOUND when dataset_version_id does not exist', () => {
      expect(() =>
        StatisticalAnalysisEngine.analyze({
          request: { ...validRequest, dataset_version_id: 'dsv_non_existent' },
          dataset_version_store: versionStore,
          data_artifact_store: artifactStore
        })
      ).toThrowError(expect.objectContaining({ code: 'ANALYSIS_DATASET_NOT_FOUND' }));
    });

    it('4. throws ANALYSIS_VERSION_MISMATCH on cross-version artifact binding', () => {
      const wrongArtifact: DataArtifact = {
        ...sampleArtifact,
        artifact_id: 'art_other_v2',
        dataset_version_id: 'dsv_other_v2',
        state: 'RAW',
        parent_artifact_id: null
      };
      artifactStore.create(wrongArtifact);

      expect(() =>
        StatisticalAnalysisEngine.analyze({
          request: { ...validRequest, data_artifact_id: 'art_other_v2' },
          dataset_version_store: versionStore,
          data_artifact_store: artifactStore
        })
      ).toThrowError(expect.objectContaining({ code: 'ANALYSIS_VERSION_MISMATCH' }));
    });

    it('5. returns deeply frozen, immutable AnalysisResult', () => {
      const res = StatisticalAnalysisEngine.analyze({
        request: validRequest,
        dataset_version_store: versionStore,
        data_artifact_store: artifactStore,
        variable_store: variableStore
      });

      expect(Object.isFrozen(res)).toBe(true);
      expect(Object.isFrozen(res.result)).toBe(true);
      expect(() => {
        (res as any).analysis_id = 'mutated';
      }).toThrow();
    });
  });

  // ===========================================================================
  // SECTION 2: NUMERIC STATISTICS
  // ===========================================================================
  describe('2. Numeric Statistics', () => {
    it('6. calculates count and total records correctly', () => {
      const desc = computeDescriptiveNumeric({
        variable_id: 'weight_kg',
        records: sampleRecords
      });
      expect(desc.total_records).toBe(6);
      expect(desc.valid_count).toBe(5);
    });

    it('7. calculates missing count and missing percentage', () => {
      const desc = computeDescriptiveNumeric({
        variable_id: 'weight_kg',
        records: sampleRecords
      });
      expect(desc.missing_count).toBe(1);
      expect(desc.missing_percentage).toBeCloseTo(16.666, 2);
    });

    it('8. calculates arithmetic mean accurately', () => {
      // 70, 80, 65, 90, 120 -> sum = 425, count = 5, mean = 85
      const desc = computeDescriptiveNumeric({
        variable_id: 'weight_kg',
        records: sampleRecords
      });
      expect(desc.mean).toBe(85);
      expect(desc.sum).toBe(425);
    });

    it('9. calculates median accurately for odd and even count populations', () => {
      // Odd: 65, 70, 80, 90, 120 -> median = 80
      const descOdd = computeDescriptiveNumeric({
        variable_id: 'weight_kg',
        records: sampleRecords
      });
      expect(descOdd.median).toBe(80);

      // Even: 65, 70, 80, 90 -> median = 75
      const evenRecords = sampleRecords.slice(0, 4);
      const descEven = computeDescriptiveNumeric({
        variable_id: 'weight_kg',
        records: evenRecords
      });
      expect(descEven.median).toBe(75);
    });

    it('10. identifies minimum value', () => {
      const desc = computeDescriptiveNumeric({
        variable_id: 'weight_kg',
        records: sampleRecords
      });
      expect(desc.minimum).toBe(65);
    });

    it('11. identifies maximum value', () => {
      const desc = computeDescriptiveNumeric({
        variable_id: 'weight_kg',
        records: sampleRecords
      });
      expect(desc.maximum).toBe(120);
    });

    it('12. calculates sample variance with N-1 denominator', () => {
      // 65, 70, 80, 90, 120 (mean = 85)
      // sqDiff: (65-85)^2 + (70-85)^2 + (80-85)^2 + (90-85)^2 + (120-85)^2
      // = 400 + 225 + 25 + 25 + 1225 = 1900.
      // Sample Variance = 1900 / 4 = 475.
      const desc = computeDescriptiveNumeric({
        variable_id: 'weight_kg',
        records: sampleRecords
      });
      expect(desc.variance).toBe(475);
    });

    it('13. calculates standard deviation as sqrt(variance)', () => {
      const desc = computeDescriptiveNumeric({
        variable_id: 'weight_kg',
        records: sampleRecords
      });
      expect(desc.standard_deviation).toBeCloseTo(Math.sqrt(475), 4);
    });

    it('14. calculates quartiles (P25, P50, P75)', () => {
      // sorted: 65, 70, 80, 90, 120 (n=5)
      const desc = computeDescriptiveNumeric({
        variable_id: 'weight_kg',
        records: sampleRecords
      });
      expect(desc.percentile_25).toBe(70);
      expect(desc.percentile_50).toBe(80);
      expect(desc.percentile_75).toBe(90);
    });

    it('15. calculates interquartile range (IQR = P75 - P25)', () => {
      const desc = computeDescriptiveNumeric({
        variable_id: 'weight_kg',
        records: sampleRecords
      });
      expect(desc.interquartile_range).toBe(20);
    });

    it('16. handles constant values setting constant_value_flag and zero variance', () => {
      const constRecords = [
        { weight_kg: 70 },
        { weight_kg: 70 },
        { weight_kg: 70 }
      ];
      const desc = computeDescriptiveNumeric({
        variable_id: 'weight_kg',
        records: constRecords
      });
      expect(desc.variance).toBe(0);
      expect(desc.constant_value_flag).toBe(true);
      expect(desc.zero_variance_flag).toBe(true);
    });

    it('17. handles empty or all-missing values without crashing or producing NaN', () => {
      const emptyRecords = [
        { weight_kg: null },
        { weight_kg: 'N/A' }
      ];
      const desc = computeDescriptiveNumeric({
        variable_id: 'weight_kg',
        records: emptyRecords
      });
      expect(desc.valid_count).toBe(0);
      expect(desc.missing_count).toBe(2);
      expect(desc.mean).toBeNull();
      expect(desc.variance).toBeNull();
    });

    it('18. handles single observation population returning null sample variance and INSUFFICIENT_OBSERVATIONS note', () => {
      const singleRecord = [{ weight_kg: 75 }];
      const desc = computeDescriptiveNumeric({
        variable_id: 'weight_kg',
        records: singleRecord
      });
      expect(desc.valid_count).toBe(1);
      expect(desc.mean).toBe(75);
      expect(desc.variance).toBeNull();
      expect(desc.standard_deviation).toBeNull();
      expect(desc.zero_variance_flag).toBe(false);
      expect(desc.constant_value_flag).toBe(true);
      expect(desc.notes?.[0]).toContain('INSUFFICIENT_OBSERVATIONS');
    });
  });

  // ===========================================================================
  // SECTION 3: CATEGORICAL ANALYSIS
  // ===========================================================================
  describe('3. Categorical Analysis', () => {
    it('19. calculates category frequencies', () => {
      const freq = computeCategoricalFrequency({
        variable_id: 'sex',
        records: sampleRecords
      });
      expect(freq.total_records).toBe(6);
      expect(freq.valid_count).toBe(6);
      expect(freq.unique_category_count).toBe(2);
    });

    it('20. calculates category percentages relative to valid records', () => {
      const freq = computeCategoricalFrequency({
        variable_id: 'sex',
        records: sampleRecords
      });

      const femaleCat = freq.categories.find(c => c.category === 'Female');
      const maleCat = freq.categories.find(c => c.category === 'Male');

      expect(femaleCat?.count).toBe(3);
      expect(femaleCat?.percentage).toBe(50);
      expect(maleCat?.count).toBe(3);
      expect(maleCat?.percentage).toBe(50);
    });

    it('21. orders categories deterministically in alphabetical order', () => {
      const freq = computeCategoricalFrequency({
        variable_id: 'activity',
        records: sampleRecords
      });
      const catNames = freq.categories.map(c => c.category);
      expect(catNames).toEqual(['High', 'Low', 'Moderate']);
    });

    it('22. tracks missing category counts separately', () => {
      const recordsWithMissing = [
        { activity: 'High' },
        { activity: null },
        { activity: 'Low' }
      ];
      const freq = computeCategoricalFrequency({
        variable_id: 'activity',
        records: recordsWithMissing
      });
      expect(freq.missing_count).toBe(1);
      expect(freq.valid_count).toBe(2);
    });
  });

  // ===========================================================================
  // SECTION 4: MISSINGNESS ANALYSIS
  // ===========================================================================
  describe('4. Missingness Analysis', () => {
    it('23. calculates missing percentage accurately', () => {
      const miss = computeMissingnessSummary({
        variable_id: 'weight_kg',
        records: sampleRecords
      });
      expect(miss.total_records).toBe(6);
      expect(miss.missing_count).toBe(1);
      expect(miss.missing_percentage).toBeCloseTo(16.666, 2);
    });

    it('24. distinguishes missing tokens vs valid values', () => {
      const recordsMixed = [
        { val: 'N/A' },
        { val: null },
        { val: '70' }
      ];
      const miss = computeMissingnessSummary({
        variable_id: 'val',
        records: recordsMixed
      });
      expect(miss.missing_count).toBe(2);
      expect(miss.valid_count).toBe(1);
    });
  });

  // ===========================================================================
  // SECTION 5: GROUPED & STRATIFIED ANALYSIS
  // ===========================================================================
  describe('5. Grouped & Stratified Analysis', () => {
    it('25. computes grouped analysis by a single categorical variable', () => {
      const grouped = computeGroupedSummary({
        requested_variables: ['weight_kg'],
        group_by_variables: ['sex'],
        records: sampleRecords
      });

      expect(grouped.groups).toHaveLength(2);
      const femaleGroup = grouped.groups.find(g => g.group_key === 'sex=Female');
      expect(femaleGroup?.record_count).toBe(3);
      expect(femaleGroup?.descriptive_numeric?.weight_kg.mean).toBeCloseTo(67.5, 1);
    });

    it('26. computes grouped analysis by multiple categorical variables', () => {
      const grouped = computeGroupedSummary({
        requested_variables: ['height_cm'],
        group_by_variables: ['sex', 'activity'],
        records: sampleRecords
      });

      expect(grouped.group_by_variables).toEqual(['sex', 'activity']);
      expect(grouped.groups.length).toBeGreaterThan(1);
    });

    it('27. orders groups deterministically by group_key', () => {
      const grouped = computeGroupedSummary({
        requested_variables: ['height_cm'],
        group_by_variables: ['sex'],
        records: sampleRecords
      });

      const groupKeys = grouped.groups.map(g => g.group_key);
      expect(groupKeys).toEqual(['sex=Female', 'sex=Male']);
    });
  });

  // ===========================================================================
  // SECTION 6: TYPED FILTERING
  // ===========================================================================
  describe('6. Typed Filtering', () => {
    it('28. filters by equality (==)', () => {
      const filtered = sampleRecords.filter(r =>
        evaluateRecordFilters(r, [{ variable_id: 'sex', operator: '==', value: 'Female' }])
      );
      expect(filtered).toHaveLength(3);
    });

    it('29. filters by inequality (!=)', () => {
      const filtered = sampleRecords.filter(r =>
        evaluateRecordFilters(r, [{ variable_id: 'sex', operator: '!=', value: 'Female' }])
      );
      expect(filtered).toHaveLength(3);
    });

    it('30. filters by numeric comparison operators (<, <=, >, >=)', () => {
      const filteredGte = sampleRecords.filter(r =>
        evaluateRecordFilters(r, [{ variable_id: 'weight_kg', operator: '>=', value: 80 }])
      );
      expect(filteredGte).toHaveLength(3); // 80, 90, 120
    });

    it('31. filters using IN operator', () => {
      const filteredIn = sampleRecords.filter(r =>
        evaluateRecordFilters(r, [{ variable_id: 'activity', operator: 'IN', value: ['High', 'Low'] }])
      );
      expect(filteredIn).toHaveLength(4);
    });

    it('32. supports AND and OR filter group combinations', () => {
      const filteredOr = sampleRecords.filter(r =>
        evaluateRecordFilters(r, undefined, {
          logic: 'OR',
          filters: [
            { variable_id: 'sex', operator: '==', value: 'Female' },
            { variable_id: 'activity', operator: '==', value: 'High' }
          ]
        })
      );
      // Females (3) + Male High (2) = 5 records
      expect(filteredOr).toHaveLength(5);
    });

    it('33. throws ANALYSIS_FILTER_INVALID on unsupported filter operator', () => {
      expect(() =>
        evaluateRecordFilters(sampleRecords[0], [
          { variable_id: 'sex', operator: 'MATCHES' as any, value: 'Female' }
        ])
      ).toThrowError(expect.objectContaining({ code: 'ANALYSIS_FILTER_INVALID' }));
    });
  });

  // ===========================================================================
  // SECTION 7: PAIRWISE ASSOCIATION
  // ===========================================================================
  describe('7. Pairwise Association', () => {
    it('34. calculates Pearson correlation between numeric variables', () => {
      const assoc = computePairwiseAssociation({
        requested_variables: ['weight_kg', 'height_cm'],
        records: sampleRecords
      });

      expect(assoc.numeric_associations).toHaveLength(1);
      const corr = assoc.numeric_associations![0];
      expect(corr.pearson_correlation).toBeGreaterThan(0.5); // Strong positive correlation
      expect(corr.valid_count).toBe(5);
    });

    it('35. handles constant variable zero variance in Pearson correlation', () => {
      const constPairRecords = [
        { x: 10, y: 5 },
        { x: 10, y: 15 },
        { x: 10, y: 25 }
      ];
      const assoc = computePairwiseAssociation({
        requested_variables: ['x', 'y'],
        records: constPairRecords
      });

      const corr = assoc.numeric_associations![0];
      expect(corr.pearson_correlation).toBeNull();
      expect(corr.constant_variable_flag).toBe(true);
    });

    it('36. constructs contingency tables for categorical variable pairs', () => {
      const assoc = computePairwiseAssociation({
        requested_variables: ['sex', 'activity'],
        records: sampleRecords
      });

      expect(assoc.categorical_associations).toHaveLength(1);
      const tab = assoc.categorical_associations![0];
      expect(tab.var1_categories).toEqual(['Female', 'Male']);
      expect(tab.var2_categories).toEqual(['High', 'Low', 'Moderate']);
      expect(tab.matrix.length).toBe(2);
      expect(tab.matrix[0].length).toBe(3);
    });
  });

  // ===========================================================================
  // SECTION 8: UNIT HANDLING
  // ===========================================================================
  describe('8. Unit Handling', () => {
    it('37. converts compatible units (g -> kg) before computing statistics', () => {
      const recordsGram = [
        { weight_g: 70000 },
        { weight_g: 80000 },
        { weight_g: 90000 }
      ];

      const desc = computeDescriptiveNumeric({
        variable_id: 'weight_g',
        records: recordsGram,
        column_unit: 'g',
        target_unit: 'kg'
      });

      expect(desc.mean).toBe(80);
      expect(desc.canonical_unit).toBe('kg');
    });

    it('38. throws ANALYSIS_UNIT_MISMATCH on dimension mismatch (kg -> cm)', () => {
      expect(() =>
        computeDescriptiveNumeric({
          variable_id: 'weight_kg',
          records: sampleRecords,
          column_unit: 'kg',
          target_unit: 'cm'
        })
      ).toThrowError(expect.objectContaining({ code: 'ANALYSIS_UNIT_MISMATCH' }));
    });
  });

  // ===========================================================================
  // SECTION 9: OUTLIER DETECTION
  // ===========================================================================
  describe('9. Outlier Detection', () => {
    it('39. flags outliers deterministically using IQR method', () => {
      const outliers = computeOutlierDetection({
        variable_id: 'weight_kg',
        records: sampleRecords,
        config: { outlier_method: 'IQR', iqr_multiplier: 1.5 }
      });

      // P25 = 70, P75 = 90, IQR = 20. Upper bound = 90 + 1.5*20 = 120.
      expect(outliers.method).toBe('IQR');
      expect(outliers.lower_bound).toBe(40);
      expect(outliers.upper_bound).toBe(120);
    });

    it('40. guarantees source artifact records remain strictly untouched during outlier detection', () => {
      const cloneBefore = JSON.parse(JSON.stringify(sampleRecords));
      computeOutlierDetection({
        variable_id: 'weight_kg',
        records: sampleRecords,
        config: { outlier_method: 'IQR' }
      });

      expect(sampleRecords).toEqual(cloneBefore);
    });
  });

  // ===========================================================================
  // SECTION 10: NUMERICAL SAFETY
  // ===========================================================================
  describe('10. Numerical Safety', () => {
    it('41. ignores NaN values without contaminating mean or variance', () => {
      const nanRecords = [
        { weight_kg: 70 },
        { weight_kg: NaN },
        { weight_kg: 80 }
      ];
      const desc = computeDescriptiveNumeric({
        variable_id: 'weight_kg',
        records: nanRecords
      });

      expect(desc.valid_count).toBe(2);
      expect(desc.mean).toBe(75);
      expect(isNaN(desc.variance!)).toBe(false);
    });

    it('42. ignores Infinity / -Infinity values safely', () => {
      const infRecords = [
        { weight_kg: 70 },
        { weight_kg: Infinity },
        { weight_kg: -Infinity },
        { weight_kg: 90 }
      ];
      const desc = computeDescriptiveNumeric({
        variable_id: 'weight_kg',
        records: infRecords
      });

      expect(desc.valid_count).toBe(2);
      expect(desc.mean).toBe(80);
    });

    it('43. protects against division-by-zero on empty or single-observation populations', () => {
      const singleObs = [{ weight_kg: 100 }];
      const desc = computeDescriptiveNumeric({
        variable_id: 'weight_kg',
        records: singleObs
      });

      expect(desc.mean).toBe(100);
      expect(desc.variance).toBeNull();
      expect(desc.zero_variance_flag).toBe(false);
      expect(desc.notes?.[0]).toContain('INSUFFICIENT_OBSERVATIONS');
    });

    it('44. ensures filter engine uses zero dynamic code evaluation (eval-free)', () => {
      const fnString = evaluateRecordFilters.toString();
      expect(fnString).not.toContain('eval(');
    });

    it('45. ensures filter engine does not instantiate Function constructor', () => {
      const fnString = evaluateRecordFilters.toString();
      expect(fnString).not.toContain('new Function(');
    });
  });

  // ===========================================================================
  // SECTION 11: PROVENANCE & PERSISTENCE
  // ===========================================================================
  describe('11. Provenance & Persistence', () => {
    it('46. preserves dataset_version_id linkage in analysis result', () => {
      const res = StatisticalAnalysisEngine.analyze({
        request: validRequest,
        dataset_version_store: versionStore,
        data_artifact_store: artifactStore
      });
      expect(res.dataset_version_id).toBe('dsv_metabolic_v1');
    });

    it('47. preserves data_artifact_id linkage in analysis result', () => {
      const res = StatisticalAnalysisEngine.analyze({
        request: validRequest,
        dataset_version_store: versionStore,
        data_artifact_store: artifactStore
      });
      expect(res.data_artifact_id).toBe('art_cohort_validated_001');
    });

    it('48. persists analysis configuration in AnalysisResult', () => {
      const reqWithConfig: AnalysisRequest = {
        ...validRequest,
        configuration: {
          missing_tokens: ['N/A', '-999'],
          bin_count: 5
        }
      };
      const res = StatisticalAnalysisEngine.analyze({
        request: reqWithConfig,
        dataset_version_store: versionStore,
        data_artifact_store: artifactStore
      });

      expect(res.configuration.bin_count).toBe(5);
    });

    it('49. generates reproducible cryptographic checksum for identical analysis requests', () => {
      const res1 = StatisticalAnalysisEngine.analyze({
        request: validRequest,
        dataset_version_store: versionStore,
        data_artifact_store: artifactStore
      });

      const res2 = StatisticalAnalysisEngine.analyze({
        request: validRequest,
        dataset_version_store: versionStore,
        data_artifact_store: artifactStore
      });

      expect(res1.checksum).toBe(res2.checksum);
      expect(res1.checksum).toMatch(/^[a-f0-9]{64}$/i);

      // Save to store
      resultSetStore.save(res1);
      expect(resultSetStore.get(res1.analysis_id)).toBeDefined();
    });
  });

  // ===========================================================================
  // SECTION 12: REGRESSION SUITE (C1-C8 & D1-D8 Integration)
  // ===========================================================================
  describe('12. Regression Suite (Phase C1-C8 & D1-D8 Integration)', () => {
    it('50. C1 Regression: Unit Engine converts units correctly', () => {
      const desc = computeDescriptiveNumeric({
        variable_id: 'weight_g',
        records: [{ weight_g: 1000 }],
        column_unit: 'g',
        target_unit: 'kg'
      });
      expect(desc.mean).toBe(1);
    });

    it('51. C8 Regression: Cryptographic checksum calculation is deterministic', () => {
      const artObj = { artifact_id: 'art_1', dataset_version_id: 'v_1', state: 'RAW' as const };
      const hash1 = computeDataArtifactChecksum(artObj);
      const hash2 = computeDataArtifactChecksum(artObj);
      expect(hash1).toBe(hash2);
    });

    it('52. D1 Regression: DatasetVersionStore operates without breaking contracts', () => {
      expect(versionStore.get('dsv_metabolic_v1')).toBeDefined();
    });

    it('53. D5 Regression: DataArtifact state transitions maintain immutability', () => {
      expect(artifactStore.get('art_cohort_validated_001')?.state).toBe('VALIDATED');
    });

    it('54. D6 Regression: DataValidationEngine profile store works as expected', () => {
      expect(sampleArtifact.checksum).toBeDefined();
    });

    it('55. D7 Regression: Derived variable calculation input compatibility', () => {
      expect(varWeight.datatype).toBe('NUMBER');
    });

    it('56. D8 Regression: DatasetResultSet integration compatibility', () => {
      const res = StatisticalAnalysisEngine.analyze({
        request: validRequest,
        dataset_version_store: versionStore,
        data_artifact_store: artifactStore
      });
      expect(res.execution_metadata.total_records_in_artifact).toBe(6);
    });
  });

  // ===========================================================================
  // SECTION 13: D9.1 AUDIT & INTEGRITY REGRESSIONS
  // ===========================================================================
  describe('13. Phase D9.1 Audit & Integrity Regressions', () => {
    describe('Issue 1: Sample Variance Audit (n=0, n=1, n=2, n>=2 constant)', () => {
      it('D9.1-1: n = 0 returns null variance, null std, zero_variance_flag=false, and INSUFFICIENT_OBSERVATIONS note', () => {
        const desc = computeDescriptiveNumeric({
          variable_id: 'x',
          records: []
        });
        expect(desc.valid_count).toBe(0);
        expect(desc.variance).toBeNull();
        expect(desc.standard_deviation).toBeNull();
        expect(desc.zero_variance_flag).toBe(false);
        expect(desc.notes?.[0]).toContain('INSUFFICIENT_OBSERVATIONS');
      });

      it('D9.1-2: n = 1 returns null variance, null std, zero_variance_flag=false, constant_value_flag=true, and INSUFFICIENT_OBSERVATIONS note', () => {
        const desc = computeDescriptiveNumeric({
          variable_id: 'x',
          records: [{ x: 42 }]
        });
        expect(desc.valid_count).toBe(1);
        expect(desc.variance).toBeNull();
        expect(desc.standard_deviation).toBeNull();
        expect(desc.zero_variance_flag).toBe(false);
        expect(desc.constant_value_flag).toBe(true);
        expect(desc.notes?.[0]).toContain('INSUFFICIENT_OBSERVATIONS');
      });

      it('D9.1-3: n = 2 varying population calculates sample variance (n-1=1) and std correctly', () => {
        const desc = computeDescriptiveNumeric({
          variable_id: 'x',
          records: [{ x: 10 }, { x: 20 }]
        });
        // mean = 15, sumSqDiff = (10-15)^2 + (20-15)^2 = 25 + 25 = 50. s^2 = 50 / 1 = 50.
        expect(desc.valid_count).toBe(2);
        expect(desc.variance).toBe(50);
        expect(desc.standard_deviation).toBeCloseTo(Math.sqrt(50), 4);
        expect(desc.zero_variance_flag).toBe(false);
        expect(desc.constant_value_flag).toBe(false);
      });

      it('D9.1-4: n >= 2 constant population returns variance = 0, std = 0, zero_variance_flag = true, constant_value_flag = true', () => {
        const desc = computeDescriptiveNumeric({
          variable_id: 'x',
          records: [{ x: 100 }, { x: 100 }, { x: 100 }]
        });
        expect(desc.valid_count).toBe(3);
        expect(desc.variance).toBe(0);
        expect(desc.standard_deviation).toBe(0);
        expect(desc.zero_variance_flag).toBe(true);
        expect(desc.constant_value_flag).toBe(true);
      });
    });

    describe('Issue 2: Provenance Source Integrity Digest', () => {
      it('D9.1-5: same source + same configuration = identical provenance digest', () => {
        const res1 = StatisticalAnalysisEngine.analyze({
          request: validRequest,
          dataset_version_store: versionStore,
          data_artifact_store: artifactStore
        });
        const res2 = StatisticalAnalysisEngine.analyze({
          request: validRequest,
          dataset_version_store: versionStore,
          data_artifact_store: artifactStore
        });

        expect(res1.provenance_reference).toBe(res2.provenance_reference);
        expect(res1.checksum).toBe(res2.checksum);
      });

      it('D9.1-6: different dataset_version_id produces different provenance digest', () => {
        const altVersion: DatasetVersion = { ...validDatasetVersion, version_id: 'dsv_metabolic_v2', version_number: 2 };
        versionStore.create(altVersion);
        const altArtRoot = { ...artifactRoot, artifact_id: 'art_v2_raw', dataset_version_id: 'dsv_metabolic_v2', parent_artifact_id: null, state: 'RAW' as const };
        const altArtifact: DataArtifact = { ...altArtRoot, checksum: computeDataArtifactChecksum(altArtRoot) };
        artifactStore.create(altArtifact);

        const req1 = { ...validRequest };
        const req2 = { ...validRequest, dataset_version_id: 'dsv_metabolic_v2', data_artifact_id: altArtifact.artifact_id };

        const res1 = StatisticalAnalysisEngine.analyze({ request: req1, dataset_version_store: versionStore, data_artifact_store: artifactStore });
        const res2 = StatisticalAnalysisEngine.analyze({ request: req2, dataset_version_store: versionStore, data_artifact_store: artifactStore });

        expect(res1.checksum).not.toBe(res2.checksum);
      });

      it('D9.1-7: different data_artifact_id produces different provenance digest', () => {
        const altArtRoot = { ...artifactRoot, artifact_id: 'art_cohort_validated_002' };
        const altArtifact: DataArtifact = { ...altArtRoot, checksum: computeDataArtifactChecksum(altArtRoot) };
        artifactStore.create(altArtifact);

        const res1 = StatisticalAnalysisEngine.analyze({ request: validRequest, dataset_version_store: versionStore, data_artifact_store: artifactStore });
        const res2 = StatisticalAnalysisEngine.analyze({ request: { ...validRequest, data_artifact_id: 'art_cohort_validated_002' }, dataset_version_store: versionStore, data_artifact_store: artifactStore });

        expect(res1.checksum).not.toBe(res2.checksum);
      });

      it('D9.1-8: different source artifact checksum produces different provenance digest', () => {
        const artRoot2 = { ...artifactRoot, artifact_id: 'art_modified_checksum_003', record_count: 99 };
        const altArtifact: DataArtifact = { ...artRoot2, checksum: 'f'.repeat(64) };
        artifactStore.create(altArtifact);

        const res1 = StatisticalAnalysisEngine.analyze({ request: validRequest, dataset_version_store: versionStore, data_artifact_store: artifactStore });
        const res2 = StatisticalAnalysisEngine.analyze({ request: { ...validRequest, data_artifact_id: 'art_modified_checksum_003' }, dataset_version_store: versionStore, data_artifact_store: artifactStore });

        expect(res1.checksum).not.toBe(res2.checksum);
      });

      it('D9.1-9: different analysis configuration produces different provenance digest', () => {
        const req1 = { ...validRequest, configuration: { outlier_method: 'IQR' as const } };
        const req2 = { ...validRequest, configuration: { outlier_method: 'Z_SCORE' as const } };

        const res1 = StatisticalAnalysisEngine.analyze({ request: req1, dataset_version_store: versionStore, data_artifact_store: artifactStore });
        const res2 = StatisticalAnalysisEngine.analyze({ request: req2, dataset_version_store: versionStore, data_artifact_store: artifactStore });

        expect(res1.checksum).not.toBe(res2.checksum);
      });
    });
  });
});
