/**
 * Phase D11 — Scientific Data Layer: Regression & Predictive Model Metrics
 *
 * Computes deterministic model performance metrics for linear and logistic regression models.
 * All metrics remain strictly mathematical/statistical outputs without automatic clinical claims.
 */

import {
  ConfusionMatrix,
  LinearRegressionMetrics,
  LogisticRegressionMetrics
} from './regressionContracts';

/**
 * Computes performance metrics for Ordinary Least Squares Linear Regression.
 */
export function computeLinearRegressionMetrics(options: {
  y: number[];
  yHat: number[];
  parameterCount: number; // includes intercept if present
}): LinearRegressionMetrics {
  const { y, yHat, parameterCount } = options;
  const n = y.length;

  if (n === 0) {
    return {
      r2: null,
      adjusted_r2: null,
      rmse: null,
      mae: null,
      sse: null,
      sst: null
    };
  }

  const meanY = y.reduce((a, b) => a + b, 0) / n;

  let sst = 0;
  let sse = 0;
  let absErrorSum = 0;

  for (let i = 0; i < n; i++) {
    const act = y[i];
    const pred = yHat[i];
    const residual = act - pred;

    sst += Math.pow(act - meanY, 2);
    sse += Math.pow(residual, 2);
    absErrorSum += Math.abs(residual);
  }

  let r2: number | null = null;
  if (sst > 0) {
    r2 = 1 - sse / sst;
  } else if (sst === 0 && sse === 0) {
    r2 = 1.0; // Perfect fit for constant outcome matching constant prediction
  }

  let adjustedR2: number | null = null;
  if (r2 !== null && n > parameterCount && n > 1) {
    adjustedR2 = 1 - ((1 - r2) * (n - 1)) / (n - parameterCount);
  }

  const rmse = Math.sqrt(sse / n);
  const mae = absErrorSum / n;

  return {
    r2,
    adjusted_r2: adjustedR2,
    rmse,
    mae,
    sse,
    sst
  };
}

/**
 * Computes confusion matrix and classification metrics for Binary Logistic Regression.
 */
export function computeLogisticRegressionMetrics(options: {
  y: number[]; // binary actuals (0 or 1)
  probabilities: number[];
  threshold: number;
}): LogisticRegressionMetrics {
  const { y, probabilities, threshold } = options;
  const n = y.length;

  if (n === 0) {
    return {
      accuracy: null,
      sensitivity: null,
      specificity: null,
      precision: null,
      recall: null,
      f1_score: null,
      roc_auc: null,
      confusion_matrix: null
    };
  }

  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;

  for (let i = 0; i < n; i++) {
    const act = y[i];
    const pred = probabilities[i] >= threshold ? 1 : 0;

    if (act === 1 && pred === 1) tp++;
    else if (act === 0 && pred === 1) fp++;
    else if (act === 0 && pred === 0) tn++;
    else if (act === 1 && pred === 0) fn++;
  }

  const confusionMatrix: ConfusionMatrix = {
    true_positives: tp,
    false_positives: fp,
    true_negatives: tn,
    false_negatives: fn
  };

  const accuracy = (tp + tn) / n;
  const sensitivity = tp + fn > 0 ? tp / (tp + fn) : null;
  const recall = sensitivity;
  const specificity = tn + fp > 0 ? tn / (tn + fp) : null;
  const precision = tp + fp > 0 ? tp / (tp + fp) : null;

  let f1Score: number | null = null;
  if (precision !== null && recall !== null && precision + recall > 0) {
    f1Score = (2 * precision * recall) / (precision + recall);
  }

  // ROC-AUC computation (trapezoidal rule)
  const rocAuc = calculateRocAuc(y, probabilities);

  return {
    accuracy,
    sensitivity,
    specificity,
    precision,
    recall,
    f1_score: f1Score,
    roc_auc: rocAuc,
    confusion_matrix: confusionMatrix
  };
}

/**
 * Computes Area Under the Receiver Operating Characteristic Curve (ROC-AUC)
 * using rank-based trapezoidal integration (equivalent to Mann-Whitney U statistic).
 */
export function calculateRocAuc(y: number[], probabilities: number[]): number | null {
  const n = y.length;
  if (n === 0) return null;

  const positives = y.filter(val => val === 1).length;
  const negatives = n - positives;

  if (positives === 0 || negatives === 0) {
    return null; // Undefined when only one class exists
  }

  // Combine and sort by predicted probability descending
  const paired = y.map((label, idx) => ({ label, proba: probabilities[idx] }));

  // Sort descending by proba
  paired.sort((a, b) => b.proba - a.proba);

  let rankSumPositive = 0;
  let i = 0;

  while (i < n) {
    let j = i;
    while (j < n && paired[j].proba === paired[i].proba) {
      j++;
    }
    // Average rank for tied probabilities (1-indexed ranks from n down to 1)
    const averageRank = n - (i + j - 1) / 2;

    for (let k = i; k < j; k++) {
      if (paired[k].label === 1) {
        rankSumPositive += averageRank;
      }
    }
    i = j;
  }

  // Mann-Whitney U statistic
  const u = rankSumPositive - (positives * (positives + 1)) / 2;
  const auc = u / (positives * negatives);

  return auc;
}
