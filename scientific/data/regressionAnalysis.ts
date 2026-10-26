/**
 * Phase D11 — Scientific Data Layer: Pure Mathematical Solvers for Linear & Logistic Regression
 *
 * Implements deterministic matrix algebra, Gaussian elimination with partial pivoting for inversion,
 * Ordinary Least Squares (OLS) for linear regression, and Newton-Raphson / IRLS for binary logistic regression.
 */

import { normalCDF, normalQuantile, studentTCDF, studentTQuantile } from './inferentialAnalysis';
import {
  CoefficientConfidenceInterval,
  RegressionCoefficient,
  RegressionExecutionStatus
} from './regressionContracts';

// ==========================================
// 1. DETERMINISTIC MATRIX ALGEBRA
// ==========================================

export function transposeMatrix(A: number[][]): number[][] {
  if (A.length === 0) return [];
  const rows = A.length;
  const cols = A[0].length;
  const At: number[][] = Array.from({ length: cols }, () => new Array(rows).fill(0));

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      At[c][r] = A[r][c];
    }
  }
  return At;
}

export function multiplyMatrices(A: number[][], B: number[][]): number[][] {
  const rowsA = A.length;
  const colsA = A[0].length;
  const rowsB = B.length;
  const colsB = B[0].length;

  if (colsA !== rowsB) {
    throw new Error(`Matrix multiplication dimension mismatch: ${rowsA}x${colsA} vs ${rowsB}x${colsB}`);
  }

  const C: number[][] = Array.from({ length: rowsA }, () => new Array(colsB).fill(0));

  for (let i = 0; i < rowsA; i++) {
    for (let k = 0; k < colsA; k++) {
      const aik = A[i][k];
      if (aik === 0) continue;
      for (let j = 0; j < colsB; j++) {
        C[i][j] += aik * B[k][j];
      }
    }
  }
  return C;
}

export function multiplyMatrixVector(A: number[][], x: number[]): number[] {
  const rows = A.length;
  const cols = A[0].length;
  if (cols !== x.length) {
    throw new Error(`Matrix-vector dimension mismatch: ${rows}x${cols} vs vector of length ${x.length}`);
  }
  const y = new Array<number>(rows).fill(0);
  for (let i = 0; i < rows; i++) {
    let sum = 0;
    for (let j = 0; j < cols; j++) {
      sum += A[i][j] * x[j];
    }
    y[i] = sum;
  }
  return y;
}

/**
 * Inverts a square matrix using Gaussian elimination with partial pivoting.
 * Returns null if the matrix is singular or ill-conditioned (pivot < 1e-12).
 */
export function invertSquareMatrix(A: number[][]): number[][] | null {
  const n = A.length;
  if (n === 0 || A[0].length !== n) return null;

  // Augment A with identity matrix I
  const M: number[][] = Array.from({ length: n }, (_, i) => {
    const row = new Array<number>(2 * n).fill(0);
    for (let j = 0; j < n; j++) {
      row[j] = A[i][j];
    }
    row[n + i] = 1.0;
    return row;
  });

  for (let i = 0; i < n; i++) {
    // Partial pivoting
    let maxRow = i;
    let maxVal = Math.abs(M[i][i]);
    for (let k = i + 1; k < n; k++) {
      const val = Math.abs(M[k][i]);
      if (val > maxVal) {
        maxVal = val;
        maxRow = k;
      }
    }

    if (maxVal < 1e-12 || isNaN(maxVal) || !isFinite(maxVal)) {
      return null; // Singular matrix
    }

    // Swap maxRow with current row
    if (maxRow !== i) {
      const temp = M[i];
      M[i] = M[maxRow];
      M[maxRow] = temp;
    }

    // Pivot normalization
    const pivot = M[i][i];
    for (let j = 0; j < 2 * n; j++) {
      M[i][j] /= pivot;
    }

    // Eliminate column elements
    for (let k = 0; k < n; k++) {
      if (k !== i) {
        const factor = M[k][i];
        for (let j = 0; j < 2 * n; j++) {
          M[k][j] -= factor * M[i][j];
        }
      }
    }
  }

  // Extract inverted matrix from right half of M
  const Ainv: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const val = M[i][n + j];
      if (isNaN(val) || !isFinite(val)) return null;
      Ainv[i][j] = val;
    }
  }

  return Ainv;
}

// ==========================================
// 2. ORDINARY LEAST SQUARES (OLS) REGRESSION
// ==========================================

export interface OLSFitOptions {
  X: number[][]; // n x p design matrix
  y: number[]; // n x 1 outcome vector
  featureNames: string[]; // names corresponding to columns of X
  hasIntercept: boolean;
  confidenceLevel: number;
}

export interface OLSFitResult {
  coefficients: RegressionCoefficient[];
  intercept: RegressionCoefficient | null;
  predictions: number[];
  residuals: number[];
  executionStatus: RegressionExecutionStatus;
  warnings: string[];
}

export function solveOLSLinearRegression(options: OLSFitOptions): OLSFitResult {
  const { X, y, featureNames, hasIntercept, confidenceLevel } = options;
  const n = X.length;
  const p = X[0]?.length || 0;
  const warnings: string[] = [];

  if (n === 0 || p === 0 || y.length !== n) {
    return {
      coefficients: [],
      intercept: null,
      predictions: [],
      residuals: [],
      executionStatus: 'INSUFFICIENT_DATA',
      warnings: ['INSUFFICIENT_DATA: Empty dataset provided.']
    };
  }

  const Xt = transposeMatrix(X);
  const XtX = multiplyMatrices(Xt, X);
  const XtXinv = invertSquareMatrix(XtX);

  if (!XtXinv) {
    return {
      coefficients: [],
      intercept: null,
      predictions: [],
      residuals: [],
      executionStatus: 'SINGULAR_MATRIX',
      warnings: ['SINGULAR_MATRIX: Design matrix X^T X is singular or collinear. Cannot invert.']
    };
  }

  const Xty = multiplyMatrixVector(Xt, y);
  const beta = multiplyMatrixVector(XtXinv, Xty);

  const yHat = multiplyMatrixVector(X, beta);
  const residuals = y.map((act, i) => act - yHat[i]);

  const sse = residuals.reduce((acc, r) => acc + r * r, 0);
  const df = n - p;

  let s2 = 0;
  let tCrit: number | null = null;
  const alpha = 1 - confidenceLevel;

  if (df > 0) {
    s2 = sse / df;
    tCrit = Math.abs(studentTQuantile(1 - alpha / 2, df));
  } else {
    warnings.push(`INSUFFICIENT_DATA: Degrees of freedom (df = ${df}) <= 0. Standard errors unavailable.`);
  }

  const coefficients: RegressionCoefficient[] = [];
  let interceptCoeff: RegressionCoefficient | null = null;

  for (let j = 0; j < p; j++) {
    const b = beta[j];
    let se: number | null = null;
    let tStat: number | null = null;
    let pVal: number | null = null;
    let ci: CoefficientConfidenceInterval | null = null;

    if (df > 0) {
      const varB = s2 * XtXinv[j][j];
      if (varB >= 0 && !isNaN(varB)) {
        se = Math.sqrt(varB);
        if (se > 0) {
          tStat = b / se;
          pVal = 2 * (1 - studentTCDF(Math.abs(tStat), df));
          if (tCrit !== null && isFinite(tCrit)) {
            ci = {
              lower_bound: b - tCrit * se,
              upper_bound: b + tCrit * se,
              confidence_level: confidenceLevel
            };
          }
        } else {
          tStat = null;
          pVal = 1.0;
          ci = { lower_bound: b, upper_bound: b, confidence_level: confidenceLevel };
        }
      }
    }

    const isInterceptCol = hasIntercept && j === 0;
    const name = isInterceptCol ? '(Intercept)' : featureNames[hasIntercept ? j - 1 : j];

    const coeffObj: RegressionCoefficient = {
      variable_name: name,
      coefficient: b,
      standard_error: se,
      statistic: tStat,
      p_value: pVal,
      confidence_interval: ci
    };

    if (isInterceptCol) {
      interceptCoeff = coeffObj;
    } else {
      coefficients.push(coeffObj);
    }
  }

  return {
    coefficients,
    intercept: interceptCoeff,
    predictions: yHat,
    residuals,
    executionStatus: 'COMPLETED',
    warnings
  };
}

// ==========================================
// 3. LOGISTIC REGRESSION (IRLS / NEWTON-RAPHSON)
// ==========================================

export function sigmoid(z: number): number {
  if (z >= 40) return 1.0 - 1e-15;
  if (z <= -40) return 1e-15;
  return 1.0 / (1.0 + Math.exp(-z));
}

export interface LogisticFitOptions {
  X: number[][]; // n x p
  y: number[]; // n x 1 binary (0 or 1)
  featureNames: string[];
  hasIntercept: boolean;
  maxIterations?: number;
  tolerance?: number;
  confidenceLevel: number;
}

export interface LogisticFitResult {
  coefficients: RegressionCoefficient[];
  intercept: RegressionCoefficient | null;
  predictedProbabilities: number[];
  predictions: number[];
  executionStatus: RegressionExecutionStatus;
  iterations: number;
  warnings: string[];
}

export function solveLogisticRegression(options: LogisticFitOptions): LogisticFitResult {
  const {
    X,
    y,
    featureNames,
    hasIntercept,
    maxIterations = 100,
    tolerance = 1e-6,
    confidenceLevel
  } = options;

  const n = X.length;
  const p = X[0]?.length || 0;
  const warnings: string[] = [];

  if (n === 0 || p === 0 || y.length !== n) {
    return {
      coefficients: [],
      intercept: null,
      predictedProbabilities: [],
      predictions: [],
      executionStatus: 'INSUFFICIENT_DATA',
      iterations: 0,
      warnings: ['INSUFFICIENT_DATA: Empty dataset provided for logistic regression.']
    };
  }

  // Verify binary outcome (y_i in {0, 1})
  for (let i = 0; i < n; i++) {
    if (y[i] !== 0 && y[i] !== 1) {
      return {
        coefficients: [],
        intercept: null,
        predictedProbabilities: [],
        predictions: [],
        executionStatus: 'NON_BINARY_OUTCOME',
        iterations: 0,
        warnings: [`NON_BINARY_OUTCOME: Dependent variable contains non-binary value at index ${i}: ${y[i]}.`]
      };
    }
  }

  let beta = new Array<number>(p).fill(0);
  let iterations = 0;
  let converged = false;
  let Iinv: number[][] | null = null;
  let probabilities: number[] = new Array<number>(n).fill(0.5);

  while (iterations < maxIterations) {
    iterations++;

    // Compute probabilities p_i = sigmoid(X_i * beta)
    for (let i = 0; i < n; i++) {
      let z = 0;
      for (let j = 0; j < p; j++) {
        z += X[i][j] * beta[j];
      }
      probabilities[i] = sigmoid(z);
    }

    // Construct Information matrix I = X^T W X and Gradient g = X^T (y - p)
    const W = probabilities.map(pVal => Math.max(1e-12, pVal * (1 - pVal)));

    const I: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0));
    const g = new Array<number>(p).fill(0);

    for (let i = 0; i < n; i++) {
      const w_i = W[i];
      const diff_i = y[i] - probabilities[i];

      for (let j = 0; j < p; j++) {
        g[j] += X[i][j] * diff_i;
        for (let k = 0; k < p; k++) {
          I[j][k] += X[i][j] * X[i][k] * w_i;
        }
      }
    }

    Iinv = invertSquareMatrix(I);
    if (!Iinv) {
      return {
        coefficients: [],
        intercept: null,
        predictedProbabilities: [],
        predictions: [],
        executionStatus: 'SINGULAR_MATRIX',
        iterations,
        warnings: ['SINGULAR_MATRIX: Logistic regression Information matrix X^T W X is singular.']
      };
    }

    // Delta beta = Iinv * g
    const deltaBeta = multiplyMatrixVector(Iinv, g);

    // Limit step size for numerical stability
    const maxDelta = Math.max(...deltaBeta.map(Math.abs));
    let stepScale = 1.0;
    if (maxDelta > 2.0) {
      stepScale = 2.0 / maxDelta;
    }

    let maxChange = 0;
    for (let j = 0; j < p; j++) {
      const step = deltaBeta[j] * stepScale;
      beta[j] += step;
      const chg = Math.abs(step);
      if (chg > maxChange) maxChange = chg;
    }

    if (maxChange < tolerance) {
      converged = true;
      break;
    }
  }

  if (!converged) {
    warnings.push(`CONVERGENCE_FAILURE: Newton-Raphson did not converge within ${maxIterations} iterations.`);
  }

  // Compute final probabilities
  for (let i = 0; i < n; i++) {
    let z = 0;
    for (let j = 0; j < p; j++) {
      z += X[i][j] * beta[j];
    }
    probabilities[i] = sigmoid(z);
  }

  const zCrit = Math.abs(normalQuantile(1 - (1 - confidenceLevel) / 2));
  const coefficients: RegressionCoefficient[] = [];
  let interceptCoeff: RegressionCoefficient | null = null;

  for (let j = 0; j < p; j++) {
    const b = beta[j];
    let se: number | null = null;
    let zStat: number | null = null;
    let pVal: number | null = null;
    let ci: CoefficientConfidenceInterval | null = null;
    let oddsRatio: number | null = null;
    let oddsRatioCi: { lower_bound: number | null; upper_bound: number | null } | null = null;

    if (Iinv) {
      const varB = Iinv[j][j];
      if (varB >= 0 && !isNaN(varB)) {
        se = Math.sqrt(varB);
        if (se > 0) {
          zStat = b / se;
          pVal = 2 * (1 - normalCDF(Math.abs(zStat)));
          ci = {
            lower_bound: b - zCrit * se,
            upper_bound: b + zCrit * se,
            confidence_level: confidenceLevel
          };
          oddsRatio = Math.exp(b);
          oddsRatioCi = {
            lower_bound: Math.exp(b - zCrit * se),
            upper_bound: Math.exp(b + zCrit * se)
          };
        } else {
          zStat = null;
          pVal = 1.0;
          ci = { lower_bound: b, upper_bound: b, confidence_level: confidenceLevel };
          oddsRatio = Math.exp(b);
          oddsRatioCi = { lower_bound: oddsRatio, upper_bound: oddsRatio };
        }
      }
    }

    const isInterceptCol = hasIntercept && j === 0;
    const name = isInterceptCol ? '(Intercept)' : featureNames[hasIntercept ? j - 1 : j];

    const coeffObj: RegressionCoefficient = {
      variable_name: name,
      coefficient: b,
      standard_error: se,
      statistic: zStat,
      p_value: pVal,
      confidence_interval: ci,
      odds_ratio: oddsRatio,
      odds_ratio_ci: oddsRatioCi
    };

    if (isInterceptCol) {
      interceptCoeff = coeffObj;
    } else {
      coefficients.push(coeffObj);
    }
  }

  const predictions = probabilities.map(prob => (prob >= 0.5 ? 1 : 0));

  return {
    coefficients,
    intercept: interceptCoeff,
    predictedProbabilities: probabilities,
    predictions,
    executionStatus: converged ? 'COMPLETED' : 'CONVERGENCE_FAILURE',
    iterations,
    warnings
  };
}
