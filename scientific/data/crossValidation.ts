/**
 * Phase D11 — Scientific Data Layer: Deterministic Cross-Validation Engine
 *
 * Implements deterministic K-Fold cross-validation for regression models.
 * Replaces non-deterministic random state with seeded Mulberry32 pseudo-random generator
 * or deterministic index-modulo partitioning.
 */

import {
  AggregateMetricSummary,
  CrossValidationConfig,
  CrossValidationResult,
  FoldMetricResult,
  RegressionModelType
} from './regressionContracts';

/**
 * Seeded Mulberry32 Pseudo-Random Number Generator.
 * Guarantees 100% deterministic fold shuffling for reproducible cross-validation.
 */
export function createDeterministicPRNG(seed: number = 42) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface KFoldSplitOptions {
  sampleSize: number;
  k: number;
  seed?: number;
  shuffle?: boolean;
}

/**
 * Generates deterministic fold indices array of length N, where value at index i
 * indicates fold assignment (0 to k-1).
 */
export function generateDeterministicFoldIndices(options: KFoldSplitOptions): number[] {
  const { sampleSize, k, seed = 42, shuffle = false } = options;

  if (sampleSize <= 0 || k < 2) {
    throw new Error(`Invalid fold parameters: sampleSize=${sampleSize}, k=${k}. Requires sampleSize > 0 and k >= 2.`);
  }

  const indices = Array.from({ length: sampleSize }, (_, i) => i);

  if (shuffle) {
    const prng = createDeterministicPRNG(seed);
    // Fisher-Yates shuffle with deterministic PRNG
    for (let i = sampleSize - 1; i > 0; i--) {
      const j = Math.floor(prng() * (i + 1));
      const temp = indices[i];
      indices[i] = indices[j];
      indices[j] = temp;
    }
  }

  const foldAssignments = new Array<number>(sampleSize);
  for (let i = 0; i < sampleSize; i++) {
    const originalIdx = indices[i];
    foldAssignments[originalIdx] = i % k;
  }

  return foldAssignments;
}

export interface EvaluateFoldRunnerOptions<TRecord> {
  records: TRecord[];
  config: CrossValidationConfig;
  trainAndEvaluateFold: (trainRecords: TRecord[], testRecords: TRecord[]) => Record<string, number | null>;
}

/**
 * Executes K-Fold cross validation and aggregates fold metrics.
 */
export function runKFoldCrossValidation<TRecord>(
  options: EvaluateFoldRunnerOptions<TRecord>
): CrossValidationResult | null {
  const { records, config, trainAndEvaluateFold } = options;
  const n = records.length;
  const k = config.k;

  if (n < k || k < 2) {
    return null; // Insufficient observations for k folds
  }

  const foldAssignments = generateDeterministicFoldIndices({
    sampleSize: n,
    k,
    seed: config.seed ?? 42,
    shuffle: config.shuffle ?? true
  });

  const foldResults: FoldMetricResult[] = [];
  const metricValuesMap = new Map<string, Array<number | null>>();

  for (let fold = 0; fold < k; fold++) {
    const trainRecords: TRecord[] = [];
    const testRecords: TRecord[] = [];

    for (let i = 0; i < n; i++) {
      if (foldAssignments[i] === fold) {
        testRecords.push(records[i]);
      } else {
        trainRecords.push(records[i]);
      }
    }

    const foldMetrics = trainAndEvaluateFold(trainRecords, testRecords);

    foldResults.push({
      fold: fold + 1,
      sample_size: testRecords.length,
      metrics: foldMetrics
    });

    for (const [metricKey, metricValue] of Object.entries(foldMetrics)) {
      if (!metricValuesMap.has(metricKey)) {
        metricValuesMap.set(metricKey, []);
      }
      metricValuesMap.get(metricKey)!.push(metricValue);
    }
  }

  // Aggregate metrics across folds
  const aggregateMetrics: Record<string, AggregateMetricSummary> = {};

  for (const [metricKey, values] of metricValuesMap.entries()) {
    const validValues = values.filter((v): v is number => v !== null && !isNaN(v));

    if (validValues.length === 0) {
      aggregateMetrics[metricKey] = { mean: null, std: null, min: null, max: null };
      continue;
    }

    const mean = validValues.reduce((a, b) => a + b, 0) / validValues.length;
    const min = Math.min(...validValues);
    const max = Math.max(...validValues);

    let std: number | null = null;
    if (validValues.length > 1) {
      const varSum = validValues.reduce((a, b) => a + Math.pow(b - mean, 2), 0);
      std = Math.sqrt(varSum / (validValues.length - 1));
    } else {
      std = 0;
    }

    aggregateMetrics[metricKey] = {
      mean,
      std,
      min,
      max
    };
  }

  return {
    k,
    folds: foldResults,
    aggregate_metrics: aggregateMetrics
  };
}
