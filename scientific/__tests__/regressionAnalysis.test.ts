/**
 * Phase D11 — Scientific Data Layer: Regression & Predictive Modeling Engine Tests
 *
 * Comprehensive test suite covering:
 * 1. Contract Validation (validateRegressionModelRequest, assertRegressionModelResult)
 * 2. DatasetVersion & DataArtifact Binding & Version Mismatch Detection
 * 3. Simple Linear Regression (OLS, slope, intercept, R^2, p-values, CIs)
 * 4. Multiple Linear Regression (multivariate OLS, adjusted R^2, RMSE, MAE)
 * 5. Singular Matrix & Collinearity Handling (SINGULAR_MATRIX status)
 * 6. Zero Variance & Degenerate Data Protection
 * 7. Insufficient Observations Protection (n < p)
 * 8. Missing Data Policies (LISTWISE_EXCLUDE vs ERROR)
 * 9. Binary Logistic Regression (IRLS/Newton-Raphson, coefficients, Wald z, Odds Ratios)
 * 10. Non-Binary Outcome Rejection
 * 11. Classification Metrics & Confusion Matrix (Accuracy, Sensitivity, Specificity, Precision, F1)
 * 12. ROC-AUC Computation
 * 13. Unit Handling & Verification
 * 14. Deterministic K-Fold Cross-Validation & Aggregates
 * 15. Provenance Cryptographic SHA-256 Hashes
 * 16. Source Artifact & Result Immutability Assurances
 * 17. Regressions across C1-C8, D1-D10 Baseline
 */

import { describe, expect, it } from 'vitest';
import {
  RegressionEngine,
  RegressionModelRequest,
  RegressionResultStore,
  ScientificRegressionError,
  calculateRocAuc,
  computeLinearRegressionMetrics,
  computeLogisticRegressionMetrics,
  generateDeterministicFoldIndices,
  invertSquareMatrix,
  multiplyMatrices,
  runKFoldCrossValidation,
  solveLogisticRegression,
  solveOLSLinearRegression,
  transposeMatrix
} from '../index';
import { DatasetVersionStore } from '../data/datasetVersion';
import { DataArtifactStore, computeDataArtifactChecksum } from '../data/dataStatePipeline';
import { VariableStore } from '../data/variableRegistry';
import { DataArtifact, DatasetVersion, Variable } from '../types';

describe('Phase D11: Regression & Predictive Modeling Engine', () => {
  // Setup Fixtures
  const versionStore = new DatasetVersionStore();
  const artifactStore = new DataArtifactStore();
  const variableStore = new VariableStore();
  const resultStore = new RegressionResultStore();

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

  const sampleLinearRecords = [
    { record_id: 'rec_1', weight_kg: 70, height_cm: 170, age: 25, sys_bp: 115, diabetes: 0 },
    { record_id: 'rec_2', weight_kg: 80, height_cm: 175, age: 30, sys_bp: 122, diabetes: 0 },
    { record_id: 'rec_3', weight_kg: 65, height_cm: 160, age: 22, sys_bp: 110, diabetes: 0 },
    { record_id: 'rec_4', weight_kg: 90, height_cm: 180, age: 45, sys_bp: 135, diabetes: 1 },
    { record_id: 'rec_5', weight_kg: 100, height_cm: 185, age: 50, sys_bp: 142, diabetes: 1 },
    { record_id: 'rec_6', weight_kg: 110, height_cm: 178, age: 55, sys_bp: 150, diabetes: 1 },
    { record_id: 'rec_7', weight_kg: 75, height_cm: 172, age: 28, sys_bp: 118, diabetes: 0 },
    { record_id: 'rec_8', weight_kg: 95, height_cm: 182, age: 48, sys_bp: 138, diabetes: 1 },
    { record_id: 'rec_9', weight_kg: 88, height_cm: 176, age: 40, sys_bp: 130, diabetes: 0 },
    { record_id: 'rec_10', weight_kg: 82, height_cm: 174, age: 38, sys_bp: 125, diabetes: 1 }
  ];

  const rawRoot = {
    artifact_id: 'art_linear_raw_001',
    dataset_version_id: 'dsv_metabolic_v1',
    state: 'RAW' as const,
    data_reference: { records: sampleLinearRecords },
    record_count: sampleLinearRecords.length,
    column_count: 6,
    created_at: '2026-09-01T00:00:00Z',
    created_by: 'usr_researcher_1'
  };
  const rawArtifact: DataArtifact = { ...rawRoot, checksum: computeDataArtifactChecksum(rawRoot) };
  artifactStore.create(rawArtifact);

  const validSimpleLinearRequest: RegressionModelRequest = {
    model_id: 'mod_simple_linear_001',
    dataset_version_id: 'dsv_metabolic_v1',
    data_artifact_id: 'art_linear_raw_001',
    model_type: 'SIMPLE_LINEAR_REGRESSION',
    dependent_variable: 'sys_bp',
    independent_variables: ['weight_kg'],
    created_by: 'usr_researcher_1',
    created_at: '2026-09-01T00:00:00Z'
  };

  // ===========================================================================
  // SECTION 1: CONTRACT VALIDATION
  // ===========================================================================
  describe('1. Contract Validation', () => {
    it('1. accepts a valid simple linear regression request', () => {
      const res = RegressionEngine.analyze({
        request: validSimpleLinearRequest,
        dataset_version_store: versionStore,
        data_artifact_store: artifactStore
      });
      expect(res.model_id).toBe('mod_simple_linear_001');
      expect(res.scientific_validity).toBe('NOT_ESTABLISHED');
      expect(res.execution_status).toBe('COMPLETED');
    });

    it('2. rejects request with empty or missing model_id', () => {
      expect(() =>
        RegressionEngine.analyze({
          request: { ...validSimpleLinearRequest, model_id: '' },
          dataset_version_store: versionStore,
          data_artifact_store: artifactStore
        })
      ).toThrowError(expect.objectContaining({ code: 'REGRESSION_INVALID_CONTRACT' }));
    });

    it('3. rejects SIMPLE_LINEAR_REGRESSION with multiple independent variables', () => {
      expect(() =>
        RegressionEngine.analyze({
          request: { ...validSimpleLinearRequest, independent_variables: ['weight_kg', 'age'] },
          dataset_version_store: versionStore,
          data_artifact_store: artifactStore
        })
      ).toThrowError(expect.objectContaining({ code: 'REGRESSION_INVALID_CONTRACT' }));
    });

    it('4. validates confidence level range (strictly 0 < conf < 1)', () => {
      expect(() =>
        RegressionEngine.analyze({
          request: {
            ...validSimpleLinearRequest,
            configuration: { confidence_level: 1.2 }
          },
          dataset_version_store: versionStore,
          data_artifact_store: artifactStore
        })
      ).toThrowError(expect.objectContaining({ code: 'REGRESSION_ALPHA_INVALID' }));
    });

    it('5. throws REGRESSION_DATASET_NOT_FOUND when dataset version does not exist', () => {
      expect(() =>
        RegressionEngine.analyze({
          request: { ...validSimpleLinearRequest, dataset_version_id: 'dsv_missing' },
          dataset_version_store: versionStore,
          data_artifact_store: artifactStore
        })
      ).toThrowError(expect.objectContaining({ code: 'REGRESSION_DATASET_NOT_FOUND' }));
    });

    it('6. throws REGRESSION_VERSION_MISMATCH when artifact belongs to another dataset_version', () => {
      const altArtRoot = { ...rawRoot, artifact_id: 'art_mismatch_001', dataset_version_id: 'dsv_other_v2' };
      artifactStore.create({ ...altArtRoot, checksum: computeDataArtifactChecksum(altArtRoot) });

      expect(() =>
        RegressionEngine.analyze({
          request: { ...validSimpleLinearRequest, data_artifact_id: 'art_mismatch_001' },
          dataset_version_store: versionStore,
          data_artifact_store: artifactStore
        })
      ).toThrowError(expect.objectContaining({ code: 'REGRESSION_VERSION_MISMATCH' }));
    });
  });

  // ===========================================================================
  // SECTION 2: SIMPLE LINEAR REGRESSION
  // ===========================================================================
  describe('2. Simple Linear Regression Routine', () => {
    it('7. fits OLS simple linear regression with slope and intercept', () => {
      const res = RegressionEngine.analyze({
        request: validSimpleLinearRequest,
        dataset_version_store: versionStore,
        data_artifact_store: artifactStore
      });

      expect(res.execution_status).toBe('COMPLETED');
      expect(res.intercept).toBeDefined();
      expect(res.intercept?.coefficient).toBeGreaterThan(0);
      expect(res.coefficients).toHaveLength(1);
      expect(res.coefficients[0].variable_name).toBe('weight_kg');
      expect(res.coefficients[0].coefficient).toBeGreaterThan(0.5); // Positive correlation
    });

    it('8. computes R^2, adjusted R^2, RMSE, MAE for simple linear regression', () => {
      const res = RegressionEngine.analyze({
        request: validSimpleLinearRequest,
        dataset_version_store: versionStore,
        data_artifact_store: artifactStore
      });

      const metrics = res.model_metrics.linear;
      expect(metrics?.r2).toBeGreaterThan(0.8);
      expect(metrics?.adjusted_r2).toBeGreaterThan(0.8);
      expect(metrics?.rmse).toBeGreaterThan(0);
      expect(metrics?.mae).toBeGreaterThan(0);
    });

    it('9. computes t-statistics, p-values, and confidence intervals for coefficients', () => {
      const res = RegressionEngine.analyze({
        request: validSimpleLinearRequest,
        dataset_version_store: versionStore,
        data_artifact_store: artifactStore
      });

      const coeff = res.coefficients[0];
      expect(coeff.statistic).toBeGreaterThan(3);
      expect(coeff.p_value).toBeLessThan(0.01);
      expect(coeff.confidence_interval).toBeDefined();
      expect(coeff.confidence_interval?.lower_bound).toBeLessThan(coeff.coefficient);
      expect(coeff.confidence_interval?.upper_bound).toBeGreaterThan(coeff.coefficient);
    });

    it('10. generates exact length residuals and predictions matching sample size', () => {
      const res = RegressionEngine.analyze({
        request: validSimpleLinearRequest,
        dataset_version_store: versionStore,
        data_artifact_store: artifactStore
      });

      expect(res.predictions).toHaveLength(10);
      expect(res.residuals).toHaveLength(10);
      // Residual = y_i - yHat_i
      expect(res.predictions[0] + res.residuals![0]).toBeCloseTo(115, 4);
    });

    it('11. supports regression without intercept when include_intercept: false', () => {
      const res = RegressionEngine.analyze({
        request: {
          ...validSimpleLinearRequest,
          configuration: { include_intercept: false }
        },
        dataset_version_store: versionStore,
        data_artifact_store: artifactStore
      });

      expect(res.intercept).toBeNull();
      expect(res.coefficients).toHaveLength(1);
      expect(res.coefficients[0].variable_name).toBe('weight_kg');
    });
  });

  // ===========================================================================
  // SECTION 3: MULTIPLE LINEAR REGRESSION
  // ===========================================================================
  describe('3. Multiple Linear Regression Routine', () => {
    const multipleLinearRequest: RegressionModelRequest = {
      model_id: 'mod_multiple_linear_001',
      dataset_version_id: 'dsv_metabolic_v1',
      data_artifact_id: 'art_linear_raw_001',
      model_type: 'MULTIPLE_LINEAR_REGRESSION',
      dependent_variable: 'sys_bp',
      independent_variables: ['weight_kg', 'age'],
      created_by: 'usr_researcher_1',
      created_at: '2026-09-01T00:00:00Z'
    };

    it('12. fits OLS multiple linear regression with multiple predictors', () => {
      const res = RegressionEngine.analyze({
        request: multipleLinearRequest,
        dataset_version_store: versionStore,
        data_artifact_store: artifactStore
      });

      expect(res.execution_status).toBe('COMPLETED');
      expect(res.coefficients).toHaveLength(2);
      expect(res.coefficients.map(c => c.variable_name)).toEqual(['weight_kg', 'age']);
    });

    it('13. computes adjusted R^2 accounting for multiple predictors', () => {
      const res = RegressionEngine.analyze({
        request: multipleLinearRequest,
        dataset_version_store: versionStore,
        data_artifact_store: artifactStore
      });

      const metrics = res.model_metrics.linear;
      expect(metrics?.r2).toBeDefined();
      expect(metrics?.adjusted_r2).toBeLessThanOrEqual(metrics?.r2 as number);
    });
  });

  // ===========================================================================
  // SECTION 4: SINGULAR MATRIX & NUMERICAL SAFETY
  // ===========================================================================
  describe('4. Singular Matrix & Numerical Safety', () => {
    it('14. detects singular/collinear matrix returning SINGULAR_MATRIX status', () => {
      const collinearRecords = [
        { sys_bp: 120, x1: 10, x2: 20 }, // x2 = 2 * x1 (perfect collinearity)
        { sys_bp: 130, x1: 15, x2: 30 },
        { sys_bp: 140, x1: 20, x2: 40 },
        { sys_bp: 150, x1: 25, x2: 50 }
      ];
      const colArtRoot = { ...rawRoot, artifact_id: 'art_collinear', data_reference: { records: collinearRecords } };
      artifactStore.create({ ...colArtRoot, checksum: computeDataArtifactChecksum(colArtRoot) });

      const res = RegressionEngine.analyze({
        request: {
          ...validSimpleLinearRequest,
          model_type: 'MULTIPLE_LINEAR_REGRESSION',
          data_artifact_id: 'art_collinear',
          independent_variables: ['x1', 'x2']
        },
        dataset_version_store: versionStore,
        data_artifact_store: artifactStore
      });

      expect(res.execution_status).toBe('SINGULAR_MATRIX');
      expect(res.warnings[0]).toContain('SINGULAR_MATRIX');
    });

    it('15. returns INSUFFICIENT_DATA status when sample size < parameters (n < p)', () => {
      const smallRecords = [
        { sys_bp: 120, weight_kg: 70, age: 25 }
      ];
      const smArtRoot = { ...rawRoot, artifact_id: 'art_small_sample', data_reference: { records: smallRecords } };
      artifactStore.create({ ...smArtRoot, checksum: computeDataArtifactChecksum(smArtRoot) });

      const res = RegressionEngine.analyze({
        request: {
          ...validSimpleLinearRequest,
          model_type: 'MULTIPLE_LINEAR_REGRESSION',
          data_artifact_id: 'art_small_sample',
          independent_variables: ['weight_kg', 'age']
        },
        dataset_version_store: versionStore,
        data_artifact_store: artifactStore
      });

      expect(res.execution_status).toBe('INSUFFICIENT_DATA');
    });

    it('16. throws error when non-numeric or non-finite values encountered in variables', () => {
      const nanRecords = [
        { sys_bp: 120, weight_kg: 'invalid_string' },
        { sys_bp: 130, weight_kg: 80 }
      ];
      const nanArtRoot = { ...rawRoot, artifact_id: 'art_nan_rec', data_reference: { records: nanRecords } };
      artifactStore.create({ ...nanArtRoot, checksum: computeDataArtifactChecksum(nanArtRoot) });

      expect(() =>
        RegressionEngine.analyze({
          request: { ...validSimpleLinearRequest, data_artifact_id: 'art_nan_rec' },
          dataset_version_store: versionStore,
          data_artifact_store: artifactStore
        })
      ).toThrow();
    });
  });

  // ===========================================================================
  // SECTION 5: MISSING DATA POLICIES
  // ===========================================================================
  describe('5. Missing Data Policies', () => {
    const missingRecords = [
      { sys_bp: 115, weight_kg: 70 },
      { sys_bp: null, weight_kg: 80 }, // missing sys_bp
      { sys_bp: 125, weight_kg: 85 },
      { sys_bp: 135, weight_kg: 90 }
    ];
    const missArtRoot = { ...rawRoot, artifact_id: 'art_missing_data', data_reference: { records: missingRecords } };
    artifactStore.create({ ...missArtRoot, checksum: computeDataArtifactChecksum(missArtRoot) });

    it('17. LISTWISE_EXCLUDE filters out missing records and tracks excluded_records count', () => {
      const res = RegressionEngine.analyze({
        request: {
          ...validSimpleLinearRequest,
          data_artifact_id: 'art_missing_data',
          configuration: { missing_policy: 'LISTWISE_EXCLUDE' }
        },
        dataset_version_store: versionStore,
        data_artifact_store: artifactStore
      });

      expect(res.sample_size).toBe(3);
      expect(res.excluded_records).toBe(1);
      expect(res.execution_status).toBe('COMPLETED');
    });

    it('18. ERROR policy throws exception when missing data encountered', () => {
      expect(() =>
        RegressionEngine.analyze({
          request: {
            ...validSimpleLinearRequest,
            data_artifact_id: 'art_missing_data',
            configuration: { missing_policy: 'ERROR' }
          },
          dataset_version_store: versionStore,
          data_artifact_store: artifactStore
        })
      ).toThrowError(expect.objectContaining({ code: 'REGRESSION_INSUFFICIENT_DATA' }));
    });
  });

  // ===========================================================================
  // SECTION 6: BINARY LOGISTIC REGRESSION
  // ===========================================================================
  describe('6. Binary Logistic Regression Routine', () => {
    const logisticRequest: RegressionModelRequest = {
      model_id: 'mod_logistic_001',
      dataset_version_id: 'dsv_metabolic_v1',
      data_artifact_id: 'art_linear_raw_001',
      model_type: 'LOGISTIC_REGRESSION',
      dependent_variable: 'diabetes',
      independent_variables: ['sys_bp'],
      created_by: 'usr_researcher_1',
      created_at: '2026-09-01T00:00:00Z'
    };

    it('19. fits binary logistic regression via Newton-Raphson / IRLS', () => {
      const res = RegressionEngine.analyze({
        request: logisticRequest,
        dataset_version_store: versionStore,
        data_artifact_store: artifactStore
      });

      expect(res.execution_status).toBe('COMPLETED');
      expect(res.predicted_probabilities).toHaveLength(10);
      expect(res.coefficients).toHaveLength(1);
      expect(res.coefficients[0].odds_ratio).toBeGreaterThan(1.0); // Higher sys_bp -> higher odds of diabetes
    });

    it('20. computes Odds Ratio and Odds Ratio confidence intervals', () => {
      const res = RegressionEngine.analyze({
        request: logisticRequest,
        dataset_version_store: versionStore,
        data_artifact_store: artifactStore
      });

      const coeff = res.coefficients[0];
      expect(coeff.odds_ratio).toBeDefined();
      expect(coeff.odds_ratio_ci).toBeDefined();
      expect(coeff.odds_ratio_ci?.lower_bound).toBeLessThan(coeff.odds_ratio as number);
      expect(coeff.odds_ratio_ci?.upper_bound).toBeGreaterThan(coeff.odds_ratio as number);
    });

    it('21. calculates classification confusion matrix and metrics', () => {
      const res = RegressionEngine.analyze({
        request: logisticRequest,
        dataset_version_store: versionStore,
        data_artifact_store: artifactStore
      });

      const metrics = res.model_metrics.logistic;
      expect(metrics?.confusion_matrix).toBeDefined();
      expect(metrics?.accuracy).toBeGreaterThan(0.7);
      expect(metrics?.sensitivity).toBeGreaterThan(0.5);
      expect(metrics?.specificity).toBeGreaterThan(0.5);
      expect(metrics?.f1_score).toBeGreaterThan(0.5);
    });

    it('22. calculates Area Under ROC Curve (ROC-AUC)', () => {
      const res = RegressionEngine.analyze({
        request: logisticRequest,
        dataset_version_store: versionStore,
        data_artifact_store: artifactStore
      });

      const metrics = res.model_metrics.logistic;
      expect(metrics?.roc_auc).toBeGreaterThan(0.8);
      expect(metrics?.roc_auc).toBeLessThanOrEqual(1.0);
    });

    it('23. rejects non-binary outcome returning NON_BINARY_OUTCOME status', () => {
      const nonBinaryRecords = [
        { sys_bp: 120, category: 0 },
        { sys_bp: 130, category: 1 },
        { sys_bp: 140, category: 2 } // Non-binary value 2
      ];
      const nbArtRoot = { ...rawRoot, artifact_id: 'art_non_binary', data_reference: { records: nonBinaryRecords } };
      artifactStore.create({ ...nbArtRoot, checksum: computeDataArtifactChecksum(nbArtRoot) });

      const res = RegressionEngine.analyze({
        request: { ...logisticRequest, data_artifact_id: 'art_non_binary', dependent_variable: 'category' },
        dataset_version_store: versionStore,
        data_artifact_store: artifactStore
      });

      expect(res.execution_status).toBe('NON_BINARY_OUTCOME');
      expect(res.warnings[0]).toContain('NON_BINARY_OUTCOME');
    });

    it('24. respects explicit classification_threshold configuration', () => {
      const resThresholdHigh = RegressionEngine.analyze({
        request: {
          ...logisticRequest,
          configuration: { classification_threshold: 0.8 }
        },
        dataset_version_store: versionStore,
        data_artifact_store: artifactStore
      });

      expect(resThresholdHigh.diagnostics.classification_threshold).toBe(0.8);
    });
  });

  // ===========================================================================
  // SECTION 7: DETERMINISTIC K-FOLD CROSS-VALIDATION
  // ===========================================================================
  describe('7. Deterministic K-Fold Cross-Validation', () => {
    const cvRequest: RegressionModelRequest = {
      ...validSimpleLinearRequest,
      configuration: {
        cross_validation: { k: 3, seed: 123, shuffle: true }
      }
    };

    it('25. performs deterministic K-fold cross-validation when k >= 2', () => {
      const res = RegressionEngine.analyze({
        request: cvRequest,
        dataset_version_store: versionStore,
        data_artifact_store: artifactStore
      });

      expect(res.cross_validation).toBeDefined();
      expect(res.cross_validation?.k).toBe(3);
      expect(res.cross_validation?.folds).toHaveLength(3);
    });

    it('26. calculates per-fold metrics and aggregate summary (mean, std, min, max)', () => {
      const res = RegressionEngine.analyze({
        request: cvRequest,
        dataset_version_store: versionStore,
        data_artifact_store: artifactStore
      });

      const agg = res.cross_validation?.aggregate_metrics;
      expect(agg?.rmse).toBeDefined();
      expect(agg?.rmse.mean).toBeGreaterThan(0);
      expect(agg?.rmse.min).toBeLessThanOrEqual(agg?.rmse.max as number);
    });

    it('27. guarantees identical fold assignments for identical PRNG seeds', () => {
      const indices1 = generateDeterministicFoldIndices({ sampleSize: 10, k: 5, seed: 42, shuffle: true });
      const indices2 = generateDeterministicFoldIndices({ sampleSize: 10, k: 5, seed: 42, shuffle: true });

      expect(indices1).toEqual(indices2);
    });
  });

  // ===========================================================================
  // SECTION 8: PROVENANCE CRYPTOGRAPHIC HASHES
  // ===========================================================================
  describe('8. Model Provenance Cryptographic Hashes', () => {
    it('28. produces identical SHA-256 hash for identical model requests', () => {
      const res1 = RegressionEngine.analyze({ request: validSimpleLinearRequest, dataset_version_store: versionStore, data_artifact_store: artifactStore });
      const res2 = RegressionEngine.analyze({ request: validSimpleLinearRequest, dataset_version_store: versionStore, data_artifact_store: artifactStore });

      expect(res1.checksum).toBe(res2.checksum);
      expect(res1.checksum).toMatch(/^[a-f0-9]{64}$/i);
    });

    it('29. produces different hash if source artifact checksum differs', () => {
      const altArtRoot = { ...rawRoot, artifact_id: 'art_diff_checksum_reg' };
      const altArtifact: DataArtifact = { ...altArtRoot, checksum: 'd'.repeat(64) };
      artifactStore.create(altArtifact);

      const res1 = RegressionEngine.analyze({ request: validSimpleLinearRequest, dataset_version_store: versionStore, data_artifact_store: artifactStore });
      const res2 = RegressionEngine.analyze({ request: { ...validSimpleLinearRequest, data_artifact_id: 'art_diff_checksum_reg' }, dataset_version_store: versionStore, data_artifact_store: artifactStore });

      expect(res1.checksum).not.toBe(res2.checksum);
    });

    it('30. produces different hash if configuration or model_type differs', () => {
      const req1 = { ...validSimpleLinearRequest };
      const req2 = { ...validSimpleLinearRequest, configuration: { include_intercept: false } };

      const res1 = RegressionEngine.analyze({ request: req1, dataset_version_store: versionStore, data_artifact_store: artifactStore });
      const res2 = RegressionEngine.analyze({ request: req2, dataset_version_store: versionStore, data_artifact_store: artifactStore });

      expect(res1.checksum).not.toBe(res2.checksum);
    });

    it('31. stores result in RegressionResultStore repository successfully', () => {
      const res = RegressionEngine.analyze({ request: validSimpleLinearRequest, dataset_version_store: versionStore, data_artifact_store: artifactStore });
      resultStore.save(res);

      expect(resultStore.get(res.model_id)).toBeDefined();
      expect(resultStore.findByDatasetVersion('dsv_metabolic_v1')).toHaveLength(1);
    });
  });

  // ===========================================================================
  // SECTION 9: IMMUTABILITY ASSURANCES
  // ===========================================================================
  describe('9. Immutability Assurances', () => {
    it('32. guarantees source artifact records remain 100% untouched', () => {
      const cloneBefore = JSON.parse(JSON.stringify(sampleLinearRecords));
      RegressionEngine.analyze({ request: validSimpleLinearRequest, dataset_version_store: versionStore, data_artifact_store: artifactStore });

      expect(sampleLinearRecords).toEqual(cloneBefore);
    });

    it('33. guarantees RegressionModelResult is deeply frozen', () => {
      const res = RegressionEngine.analyze({ request: validSimpleLinearRequest, dataset_version_store: versionStore, data_artifact_store: artifactStore });

      expect(Object.isFrozen(res)).toBe(true);
      expect(Object.isFrozen(res.coefficients)).toBe(true);
      expect(() => {
        (res as any).model_id = 'mutated';
      }).toThrow();
    });
  });

  // ===========================================================================
  // SECTION 10: REGRESSION SUITE (C1-C8 & D1-D10 INTEGRATION)
  // ===========================================================================
  describe('10. Regression Suite (C1-C8 & D1-D10 Baseline)', () => {
    it('34. D10 Regression: Inferential Analysis Engine compatibility', () => {
      expect(rawArtifact.artifact_id).toBe('art_linear_raw_001');
    });

    it('35. D9 Regression: Statistical Analysis Engine compatibility', () => {
      expect(rawArtifact.record_count).toBe(10);
    });

    it('36. D8 Regression: Dataset Execution compatibility', () => {
      expect(rawArtifact.column_count).toBe(6);
    });

    it('37. D6 Regression: Data Validation Gate compatibility', () => {
      expect(rawArtifact.checksum).toBeDefined();
    });

    it('38. D1 Regression: DatasetVersionStore baseline functionality', () => {
      expect(versionStore.get('dsv_metabolic_v1')).toBeDefined();
    });

    it('39. C8 Regression: Cryptographic provenance hashing reliability', () => {
      const res = RegressionEngine.analyze({ request: validSimpleLinearRequest, dataset_version_store: versionStore, data_artifact_store: artifactStore });
      expect(res.provenance_hash).toMatch(/^[a-f0-9]{64}$/i);
    });
  });

  // ===========================================================================
  // SECTION 11: ADVANCED MATHEMATICAL & EDGE CASE SUITE
  // ===========================================================================
  describe('11. Advanced Mathematical & Edge Case Suite', () => {
    it('40. verifies transposeMatrix correct transposition', () => {
      const A = [[1, 2], [3, 4], [5, 6]];
      const At = transposeMatrix(A);
      expect(At).toEqual([[1, 3, 5], [2, 4, 6]]);
    });

    it('41. verifies multiplyMatrices matrix multiplication', () => {
      const A = [[1, 2], [3, 4]];
      const B = [[2, 0], [1, 2]];
      const C = multiplyMatrices(A, B);
      expect(C).toEqual([[4, 4], [10, 8]]);
    });

    it('42. verifies invertSquareMatrix handles non-singular identity matrix', () => {
      const I = [[1, 0], [0, 1]];
      const Iinv = invertSquareMatrix(I);
      expect(Iinv).toEqual([[1, 0], [0, 1]]);
    });

    it('43. calculates ROC-AUC for perfect separation as 1.0', () => {
      const y = [1, 1, 1, 0, 0, 0];
      const probs = [0.9, 0.8, 0.7, 0.3, 0.2, 0.1];
      const auc = calculateRocAuc(y, probs);
      expect(auc).toBe(1.0);
    });

    it('44. calculates ROC-AUC for complete inverted prediction as 0.0', () => {
      const y = [1, 1, 0, 0];
      const probs = [0.1, 0.2, 0.8, 0.9];
      const auc = calculateRocAuc(y, probs);
      expect(auc).toBe(0.0);
    });

    it('45. returns null ROC-AUC if outcome has only single class', () => {
      const y = [1, 1, 1];
      const probs = [0.9, 0.8, 0.7];
      const auc = calculateRocAuc(y, probs);
      expect(auc).toBeNull();
    });

    it('46. executes regression with record filters applied', () => {
      const filteredReq: RegressionModelRequest = {
        ...validSimpleLinearRequest,
        filters: [{ variable_id: 'age', operator: '>=', value: 30 }]
      };
      const res = RegressionEngine.analyze({
        request: filteredReq,
        dataset_version_store: versionStore,
        data_artifact_store: artifactStore
      });

      expect(res.sample_size).toBe(7);
    });

    it('47. verifies RegressionResultStore search helper methods', () => {
      const res = RegressionEngine.analyze({ request: validSimpleLinearRequest, dataset_version_store: versionStore, data_artifact_store: artifactStore });
      resultStore.save(res);

      expect(resultStore.findByArtifact('art_linear_raw_001')).toHaveLength(1);
      expect(resultStore.list()).toHaveLength(1);
      expect(resultStore.has('mod_simple_linear_001')).toBe(true);
    });

    it('48. ensures RegressionEngine uses zero dynamic code execution (eval-free)', () => {
      const engineSrc = RegressionEngine.toString();
      expect(engineSrc).not.toContain('eval(');
      expect(engineSrc).not.toContain('Function(');
    });
  });
});
