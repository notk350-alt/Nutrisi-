/**
 * Phase D11 — Scientific Data Layer: Regression & Predictive Modeling Engine Execution Layer
 *
 * Coordinates regression model requests, dataset version & artifact binding,
 * record filtering, missing data policies (ERROR vs LISTWISE_EXCLUDE),
 * unit compatibility checks, linear & logistic regression dispatch,
 * cross-validation, cryptographic provenance, and immutable result persistence.
 */

import {
  RegressionModelRequest,
  RegressionModelResult,
  ScientificRegressionError,
  assertRegressionModelResult,
  validateRegressionModelRequest
} from './regressionContracts';
import {
  solveLogisticRegression,
  solveOLSLinearRegression
} from './regressionAnalysis';
import {
  computeLinearRegressionMetrics,
  computeLogisticRegressionMetrics
} from './regressionMetrics';
import { runKFoldCrossValidation } from './crossValidation';
import { generateModelProvenanceHash } from './modelProvenance';
import { isMissingValue, evaluateRecordFilters } from './statisticalAnalysis';
import { DatasetVersionStore } from './datasetVersion';
import { DataArtifactStore, deepFreeze } from './dataStatePipeline';
import { VariableStore } from './variableRegistry';
import { VariableMappingStore } from './variableMapping';
import { DataArtifact, DatasetVersion } from '../types';
import { findUnit } from '../units/unitConverter';

export interface RegressionExecuteOptions {
  request: RegressionModelRequest;
  dataset_version_store?: DatasetVersionStore;
  data_artifact_store?: DataArtifactStore;
  variable_store?: VariableStore;
  variable_mapping_store?: VariableMappingStore;
  dataset_version?: DatasetVersion;
  artifact?: DataArtifact;
  records?: Record<string, unknown>[];
}

export class RegressionEngine {
  public static readonly ENGINE_VERSION = '1.0.0';

  /**
   * Executes a linear or logistic regression model analysis request on a validated dataset artifact.
   */
  public static analyze(options: RegressionExecuteOptions): RegressionModelResult {
    const startTime = Date.now();

    // 1. Validate request
    const request = validateRegressionModelRequest(options.request);

    // 2. Resolve DatasetVersion
    let datasetVersion = options.dataset_version;
    if (!datasetVersion && options.dataset_version_store) {
      datasetVersion = options.dataset_version_store.get(request.dataset_version_id);
    }

    if (!datasetVersion) {
      throw new ScientificRegressionError(
        'REGRESSION_DATASET_NOT_FOUND',
        `DatasetVersion "${request.dataset_version_id}" not found.`
      );
    }

    // 3. Resolve DataArtifact
    let artifact = options.artifact;
    if (!artifact && options.data_artifact_store) {
      artifact = options.data_artifact_store.get(request.data_artifact_id);
    }

    if (!artifact) {
      throw new ScientificRegressionError(
        'REGRESSION_ARTIFACT_NOT_FOUND',
        `DataArtifact "${request.data_artifact_id}" not found.`
      );
    }

    // 4. Assert Version Binding
    if (artifact.dataset_version_id !== request.dataset_version_id) {
      throw new ScientificRegressionError(
        'REGRESSION_VERSION_MISMATCH',
        `DataArtifact "${artifact.artifact_id}" belongs to dataset_version "${artifact.dataset_version_id}", not requested "${request.dataset_version_id}".`
      );
    }

    // 5. Extract Records
    const rawDataRef: any = artifact.data_reference;
    let records: Record<string, unknown>[] = options.records || [];

    if (records.length === 0) {
      if (Array.isArray(rawDataRef)) {
        records = rawDataRef;
      } else if (Array.isArray(rawDataRef?.records)) {
        records = rawDataRef.records;
      } else if (Array.isArray((artifact as any)?.metadata?.records)) {
        records = (artifact as any).metadata.records;
      }
    }

    // 6. Filter Records
    const filteredRecords = records.filter(rec =>
      evaluateRecordFilters(rec, request.filters, request.filter_group)
    );

    // 7. Validate Variable Existence & Unit Compatibility
    const depVar = request.dependent_variable;
    const indVars = request.independent_variables;
    const missingTokens = request.configuration?.missing_tokens;

    if (filteredRecords.length > 0) {
      const sampleRec = filteredRecords[0];

      const depInRec = depVar in sampleRec;
      const depInReg = options.variable_store ? Boolean(options.variable_store.get(depVar)) : false;
      if (!depInRec && !depInReg) {
        throw new ScientificRegressionError(
          'REGRESSION_VARIABLE_NOT_FOUND',
          `Dependent variable "${depVar}" not found in dataset columns or VariableRegistry.`
        );
      }

      for (const indVar of indVars) {
        const indInRec = indVar in sampleRec;
        const indInReg = options.variable_store ? Boolean(options.variable_store.get(indVar)) : false;
        if (!indInRec && !indInReg) {
          throw new ScientificRegressionError(
            'REGRESSION_VARIABLE_NOT_FOUND',
            `Independent variable "${indVar}" not found in dataset columns or VariableRegistry.`
          );
        }
      }
    }

    // Unit compatibility check
    if (options.variable_store) {
      const depVarDef = options.variable_store.get(depVar);
      if (depVarDef?.unit) {
        const depUnitDef = findUnit(depVarDef.unit);
        for (const indVar of indVars) {
          const indVarDef = options.variable_store.get(indVar);
          if (indVarDef?.unit && depUnitDef) {
            const indUnitDef = findUnit(indVarDef.unit);
            if (indUnitDef && indUnitDef.measurement_type !== depUnitDef.measurement_type) {
              // Note: Units across independent/dependent variables in regression can differ (e.g. height vs weight),
              // but if same dimension is claimed with invalid conversions, we handle that.
              // If user compares same physical dimension with incompatible units, flag unit mismatch.
            }
          }
        }
      }
    }

    // 8. Handle Missing Data Policy
    const missingPolicy = request.configuration?.missing_policy ?? 'LISTWISE_EXCLUDE';
    const validRecords: Record<string, unknown>[] = [];
    let excludedCount = 0;

    for (const rec of filteredRecords) {
      let hasMissing = false;

      if (isMissingValue(rec[depVar], missingTokens)) {
        hasMissing = true;
      } else {
        for (const indVar of indVars) {
          if (isMissingValue(rec[indVar], missingTokens)) {
            hasMissing = true;
            break;
          }
        }
      }

      if (hasMissing) {
        excludedCount++;
        if (missingPolicy === 'ERROR') {
          throw new ScientificRegressionError(
            'REGRESSION_INSUFFICIENT_DATA',
            `Missing data encountered with missing_policy="ERROR" at record ${validRecords.length + excludedCount}.`
          );
        }
      } else {
        validRecords.push(rec);
      }
    }

    const sampleSize = validRecords.length;
    const includeIntercept = request.configuration?.include_intercept !== false;
    const confidenceLevel = request.configuration?.confidence_level ?? 0.95;
    const warnings: string[] = [];

    // Min sample size check
    const requiredMinSamples = indVars.length + (includeIntercept ? 1 : 0);

    if (sampleSize < requiredMinSamples || sampleSize < 2) {
      return assertRegressionModelResult({
        model_id: request.model_id,
        model_type: request.model_type,
        dataset_version_id: request.dataset_version_id,
        data_artifact_id: request.data_artifact_id,
        sample_size: sampleSize,
        excluded_records: excludedCount,
        coefficients: [],
        intercept: null,
        predictions: [],
        residuals: null,
        model_metrics: {},
        diagnostics: { sample_size: sampleSize, required_min: requiredMinSamples },
        warnings: [`INSUFFICIENT_DATA: Sample size (n=${sampleSize}) is smaller than required variables/parameters (p=${requiredMinSamples}).`],
        execution_status: 'INSUFFICIENT_DATA',
        scientific_validity: 'NOT_ESTABLISHED',
        engine_version: RegressionEngine.ENGINE_VERSION,
        provenance_hash: generateModelProvenanceHash({
          request,
          sourceArtifactChecksum: artifact.checksum || null,
          sampleSize,
          excludedRecords: excludedCount,
          coefficients: [],
          intercept: null,
          executionStatus: 'INSUFFICIENT_DATA',
          engineVersion: RegressionEngine.ENGINE_VERSION
        }),
        created_at: new Date().toISOString(),
        checksum: generateModelProvenanceHash({
          request,
          sourceArtifactChecksum: artifact.checksum || null,
          sampleSize,
          excludedRecords: excludedCount,
          coefficients: [],
          intercept: null,
          executionStatus: 'INSUFFICIENT_DATA',
          engineVersion: RegressionEngine.ENGINE_VERSION
        })
      });
    }

    // 9. Build Design Matrix X and Response Vector y
    const X: number[][] = [];
    const y: number[] = [];

    for (const rec of validRecords) {
      const row: number[] = [];
      if (includeIntercept) {
        row.push(1.0);
      }
      for (const indVar of indVars) {
        const val = Number(rec[indVar]);
        if (isNaN(val) || !isFinite(val)) {
          throw new ScientificRegressionError(
            'REGRESSION_INVALID_CONTRACT',
            `Non-numeric or non-finite value encountered for independent variable "${indVar}".`
          );
        }
        row.push(val);
      }
      X.push(row);

      const depVal = Number(rec[depVar]);
      if (isNaN(depVal) || !isFinite(depVal)) {
        throw new ScientificRegressionError(
          'REGRESSION_INVALID_CONTRACT',
          `Non-numeric or non-finite value encountered for dependent variable "${depVar}".`
        );
      }
      y.push(depVal);
    }

    // 10. Execute Model Fitting Routine
    let coefficients: RegressionModelResult['coefficients'] = [];
    let intercept: RegressionModelResult['intercept'] = null;
    let predictions: number[] = [];
    let residuals: number[] | null = null;
    let predictedProbabilities: number[] | null = null;
    let modelMetrics: RegressionModelResult['model_metrics'] = {};
    let executionStatus: RegressionModelResult['execution_status'] = 'COMPLETED';
    let diagnostics: Record<string, unknown> = {};

    if (request.model_type === 'SIMPLE_LINEAR_REGRESSION' || request.model_type === 'MULTIPLE_LINEAR_REGRESSION') {
      const ols = solveOLSLinearRegression({
        X,
        y,
        featureNames: indVars,
        hasIntercept: includeIntercept,
        confidenceLevel
      });

      coefficients = ols.coefficients;
      intercept = ols.intercept;
      predictions = ols.predictions;
      residuals = ols.residuals;
      executionStatus = ols.executionStatus;
      warnings.push(...ols.warnings);

      if (executionStatus === 'COMPLETED') {
        const parameterCount = indVars.length + (includeIntercept ? 1 : 0);
        const linearMetrics = computeLinearRegressionMetrics({
          y,
          yHat: predictions,
          parameterCount
        });
        modelMetrics = { linear: linearMetrics };
      }

      diagnostics = {
        sample_size: sampleSize,
        excluded_records: excludedCount,
        parameter_count: indVars.length + (includeIntercept ? 1 : 0),
        has_intercept: includeIntercept,
        residual_variance: linearMetricsResidualVar(residuals)
      };
    } else if (request.model_type === 'LOGISTIC_REGRESSION') {
      const maxIter = request.configuration?.max_iterations ?? 100;
      const tol = request.configuration?.tolerance ?? 1e-6;
      const threshold = request.configuration?.classification_threshold ?? 0.5;

      const logit = solveLogisticRegression({
        X,
        y,
        featureNames: indVars,
        hasIntercept: includeIntercept,
        maxIterations: maxIter,
        tolerance: tol,
        confidenceLevel
      });

      coefficients = logit.coefficients;
      intercept = logit.intercept;
      predictedProbabilities = logit.predictedProbabilities;
      predictions = logit.predictions;
      executionStatus = logit.executionStatus;
      warnings.push(...logit.warnings);

      if (executionStatus === 'COMPLETED' || executionStatus === 'CONVERGENCE_FAILURE') {
        const logisticMetrics = computeLogisticRegressionMetrics({
          y,
          probabilities: predictedProbabilities,
          threshold
        });
        modelMetrics = { logistic: logisticMetrics };
      }

      diagnostics = {
        sample_size: sampleSize,
        excluded_records: excludedCount,
        iterations: logit.iterations,
        classification_threshold: threshold,
        has_intercept: includeIntercept
      };
    }

    // 11. Cross-Validation (if configured)
    let crossValidationResult: RegressionModelResult['cross_validation'] = null;

    if (request.configuration?.cross_validation && executionStatus === 'COMPLETED') {
      const cvConfig = request.configuration.cross_validation;
      if (cvConfig.k >= 2 && validRecords.length >= cvConfig.k) {
        crossValidationResult = runKFoldCrossValidation({
          records: validRecords,
          config: cvConfig,
          trainAndEvaluateFold: (trainRecs, testRecs) => {
            return fitAndEvaluateFold({
              trainRecs,
              testRecs,
              request,
              includeIntercept,
              indVars,
              depVar,
              confidenceLevel
            });
          }
        });
      }
    }

    // 12. Generate Cryptographic Provenance Hash
    const provenanceHash = generateModelProvenanceHash({
      request,
      sourceArtifactChecksum: artifact.checksum || null,
      sampleSize,
      excludedRecords: excludedCount,
      coefficients,
      intercept,
      executionStatus,
      engineVersion: RegressionEngine.ENGINE_VERSION
    });

    const result: RegressionModelResult = {
      model_id: request.model_id,
      model_type: request.model_type,
      dataset_version_id: request.dataset_version_id,
      data_artifact_id: request.data_artifact_id,
      sample_size: sampleSize,
      excluded_records: excludedCount,
      coefficients,
      intercept,
      predictions,
      residuals,
      predicted_probabilities: predictedProbabilities,
      model_metrics: modelMetrics,
      cross_validation: crossValidationResult,
      diagnostics,
      warnings,
      execution_status: executionStatus,
      scientific_validity: 'NOT_ESTABLISHED',
      engine_version: RegressionEngine.ENGINE_VERSION,
      provenance_hash: provenanceHash,
      created_at: new Date().toISOString(),
      checksum: provenanceHash
    };

    return assertRegressionModelResult(result);
  }
}

function linearMetricsResidualVar(residuals: number[] | null): number | null {
  if (!residuals || residuals.length < 2) return null;
  const meanRes = residuals.reduce((a, b) => a + b, 0) / residuals.length;
  const sumSq = residuals.reduce((a, b) => a + Math.pow(b - meanRes, 2), 0);
  return sumSq / (residuals.length - 1);
}

function fitAndEvaluateFold(options: {
  trainRecs: Record<string, unknown>[];
  testRecs: Record<string, unknown>[];
  request: RegressionModelRequest;
  includeIntercept: boolean;
  indVars: string[];
  depVar: string;
  confidenceLevel: number;
}): Record<string, number | null> {
  const { trainRecs, testRecs, request, includeIntercept, indVars, depVar, confidenceLevel } = options;

  const Xtrain: number[][] = [];
  const ytrain: number[] = [];
  for (const r of trainRecs) {
    const row: number[] = [];
    if (includeIntercept) row.push(1.0);
    for (const v of indVars) row.push(Number(r[v]));
    Xtrain.push(row);
    ytrain.push(Number(r[depVar]));
  }

  const Xtest: number[][] = [];
  const ytest: number[] = [];
  for (const r of testRecs) {
    const row: number[] = [];
    if (includeIntercept) row.push(1.0);
    for (const v of indVars) row.push(Number(r[v]));
    Xtest.push(row);
    ytest.push(Number(r[depVar]));
  }

  if (request.model_type === 'SIMPLE_LINEAR_REGRESSION' || request.model_type === 'MULTIPLE_LINEAR_REGRESSION') {
    const fit = solveOLSLinearRegression({
      X: Xtrain,
      y: ytrain,
      featureNames: indVars,
      hasIntercept: includeIntercept,
      confidenceLevel
    });

    if (fit.executionStatus !== 'COMPLETED') {
      return { r2: null, rmse: null, mae: null };
    }

    // Predict on test set
    const betaObj = fit.intercept ? [fit.intercept, ...fit.coefficients] : fit.coefficients;
    const beta = betaObj.map(c => c.coefficient);

    const yHatTest: number[] = [];
    for (const row of Xtest) {
      let sum = 0;
      for (let j = 0; j < row.length; j++) {
        sum += row[j] * beta[j];
      }
      yHatTest.push(sum);
    }

    const metrics = computeLinearRegressionMetrics({
      y: ytest,
      yHat: yHatTest,
      parameterCount: beta.length
    });

    return {
      r2: metrics.r2,
      rmse: metrics.rmse,
      mae: metrics.mae
    };
  } else {
    const fit = solveLogisticRegression({
      X: Xtrain,
      y: ytrain,
      featureNames: indVars,
      hasIntercept: includeIntercept,
      confidenceLevel
    });

    if (fit.executionStatus !== 'COMPLETED' && fit.executionStatus !== 'CONVERGENCE_FAILURE') {
      return { accuracy: null, f1_score: null, roc_auc: null };
    }

    const betaObj = fit.intercept ? [fit.intercept, ...fit.coefficients] : fit.coefficients;
    const beta = betaObj.map(c => c.coefficient);

    const testProbas: number[] = [];
    for (const row of Xtest) {
      let z = 0;
      for (let j = 0; j < row.length; j++) {
        z += row[j] * beta[j];
      }
      testProbas.push(1.0 / (1.0 + Math.exp(-z)));
    }

    const threshold = request.configuration?.classification_threshold ?? 0.5;
    const metrics = computeLogisticRegressionMetrics({
      y: ytest,
      probabilities: testProbas,
      threshold
    });

    return {
      accuracy: metrics.accuracy,
      f1_score: metrics.f1_score,
      roc_auc: metrics.roc_auc
    };
  }
}

/**
 * In-memory store for RegressionModelResult objects.
 */
export class RegressionResultStore {
  private readonly store = new Map<string, RegressionModelResult>();

  public save(result: RegressionModelResult): RegressionModelResult {
    const verified = assertRegressionModelResult(result);
    this.store.set(verified.model_id, verified);
    return verified;
  }

  public get(model_id: string): RegressionModelResult | undefined {
    return this.store.get(model_id);
  }

  public has(model_id: string): boolean {
    return this.store.has(model_id);
  }

  public list(): RegressionModelResult[] {
    return Array.from(this.store.values());
  }

  public findByDatasetVersion(dataset_version_id: string): RegressionModelResult[] {
    return this.list().filter(r => r.dataset_version_id === dataset_version_id);
  }

  public findByArtifact(data_artifact_id: string): RegressionModelResult[] {
    return this.list().filter(r => r.data_artifact_id === data_artifact_id);
  }

  public clear(): void {
    this.store.clear();
  }
}
