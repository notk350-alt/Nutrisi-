/**
 * Phase D10 — Scientific Data Layer: Inferential Analysis Mathematical Infrastructure
 *
 * Provides pure, deterministic mathematical distributions (Normal, Student's t, Chi-Square),
 * p-value calculations, critical value quantiles, hypothesis decision rules,
 * effect size calculations (Cohen's d, Pearson r, Cramér's V), and multiple testing adjustments.
 */

import {
  AlternativeHypothesis,
  ConfidenceIntervalResult,
  EffectSizeResult,
  HypothesisType,
  InferentialDecision,
  MultipleTestingMethod
} from './inferentialContracts';

// ==========================================
// 1. DETERMINISTIC MATHEMATICAL DISTRIBUTIONS
// ==========================================

/**
 * Log Gamma function ln(Gamma(a)) via Lanczos 9-term approximation.
 */
export function logGamma(a: number): number {
  if (a <= 0) return NaN;

  const p = [
    0.99999999999980993,
    676.5203681218851,
    -1259.139216722289,
    771.32342877765313,
    -176.61502916214059,
    12.507343278686905,
    -0.13857109526572012,
    9.9843695780195716e-6,
    1.5056327351493116e-7
  ];

  if (a < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * a)) - logGamma(1 - a);
  }

  a -= 1;
  let x = p[0];
  for (let i = 1; i < p.length; i++) {
    x += p[i] / (a + i);
  }

  const t = a + p.length - 1.5;
  return Math.log(Math.sqrt(2 * Math.PI)) + Math.log(x) + (a + 0.5) * Math.log(t) - t;
}

/**
 * Standard Normal Error Function erf(x).
 */
export function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);

  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) * Math.exp(-x * x);

  return sign * y;
}

/**
 * Standard Normal Cumulative Distribution Function Phi(z).
 */
export function normalCDF(z: number): number {
  return 0.5 * (1.0 + erf(z / Math.SQRT2));
}

/**
 * Inverse Standard Normal Quantile Function z_p = Phi^-1(p).
 */
export function normalQuantile(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  if (p === 0.5) return 0;

  // Beasley-Springer-Moro rational approximation
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.383577518672690e2, -3.066479806614716e1, 2.506628277459239e0
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838e0,
    -2.549732539343734e0, 4.374664141464968e0, 2.938163982698783e0
  ];
  const d = [
    7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996e0,
    3.754408661907416e0
  ];

  const pLow = 0.02425;
  const pHigh = 1 - pLow;
  let q: number, r: number;

  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }

  if (p <= pHigh) {
    q = p - 0.5;
    r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }

  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
    ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

/**
 * Regularized Incomplete Beta Function I_x(a, b).
 */
export function incompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;

  // Use symmetry transformation if needed for convergence
  if (x > (a + 1) / (a + b + 2)) {
    return 1 - incompleteBeta(1 - x, b, a);
  }

  const lbeta = logGamma(a) + logGamma(b) - logGamma(a + b);
  const front = Math.exp(a * Math.log(x) + b * Math.log(1 - x) - lbeta) / a;

  // Continued fraction (Lentz's method)
  const maxIter = 200;
  const eps = 3e-15;

  let f = 1.0;
  let C = 1.0;
  let D = 0.0;

  for (let m = 1; m <= maxIter; m++) {
    let numerator: number;
    if (m % 2 === 0) {
      const k = m / 2;
      numerator = (k * (b - k) * x) / ((a + 2 * k - 1) * (a + 2 * k));
    } else {
      const k = (m - 1) / 2;
      numerator = -((a + k) * (a + b + k) * x) / ((a + 2 * k) * (a + 2 * k + 1));
    }

    D = 1.0 + numerator * D;
    if (Math.abs(D) < eps) D = eps;
    D = 1.0 / D;

    C = 1.0 + numerator / C;
    if (Math.abs(C) < eps) C = eps;

    const delta = C * D;
    f *= delta;

    if (Math.abs(delta - 1.0) < eps) break;
  }

  return front * f;
}

/**
 * Student's t Cumulative Distribution Function T_df(t).
 */
export function studentTCDF(t: number, df: number): number {
  if (isNaN(t) || isNaN(df) || df <= 0) return NaN;
  if (t === 0) return 0.5;

  const x = df / (df + t * t);
  const ibeta = incompleteBeta(x, df / 2, 0.5);

  if (t > 0) {
    return 1 - 0.5 * ibeta;
  } else {
    return 0.5 * ibeta;
  }
}

/**
 * Inverse Student's t Quantile Function t_crit = T_df^-1(p) via Bisection + Newton-Raphson.
 */
export function studentTQuantile(p: number, df: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  if (p === 0.5) return 0;

  // Normal approximation as initial guess
  let t = normalQuantile(p);
  if (df > 100) return t;

  // Bisection/Newton refinement
  for (let i = 0; i < 30; i++) {
    const cdf = studentTCDF(t, df);
    const diff = cdf - p;
    if (Math.abs(diff) < 1e-12) break;

    // Student's t PDF
    const pdf = Math.exp(logGamma((df + 1) / 2) - logGamma(df / 2)) /
      (Math.sqrt(df * Math.PI) * Math.pow(1 + (t * t) / df, (df + 1) / 2));

    if (pdf === 0) break;
    t -= diff / pdf;
  }

  return t;
}

/**
 * Regularized Lower Incomplete Gamma Function P(a, x) = gamma(a, x) / Gamma(a).
 */
export function incompleteGammaP(a: number, x: number): number {
  if (x <= 0) return 0;

  if (x < a + 1) {
    // Series expansion
    let sum = 1 / a;
    let term = 1 / a;
    for (let n = 1; n < 200; n++) {
      term *= x / (a + n);
      sum += term;
      if (Math.abs(term) < 1e-15 * Math.abs(sum)) break;
    }
    return sum * Math.exp(a * Math.log(x) - x - logGamma(a));
  } else {
    // Continued fraction expansion
    let b = x + 1 - a;
    let c = 1 / 1e-30;
    let d = 1 / b;
    let h = d;

    for (let i = 1; i < 200; i++) {
      const an = -i * (i - a);
      b += 2;
      d = an * d + b;
      if (Math.abs(d) < 1e-30) d = 1e-30;
      c = b + an / c;
      if (Math.abs(c) < 1e-30) c = 1e-30;
      d = 1 / d;
      const del = d * c;
      h *= del;
      if (Math.abs(del - 1) < 1e-15) break;
    }

    return 1 - Math.exp(a * Math.log(x) - x - logGamma(a)) * h;
  }
}

/**
 * Chi-Square Cumulative Distribution Function F_df(chi2).
 */
export function chiSquareCDF(chi2: number, df: number): number {
  if (chi2 <= 0 || df <= 0) return 0;
  return incompleteGammaP(df / 2, chi2 / 2);
}

// ==========================================
// 2. HYPOTHESIS TESTING DECISION & P-VALUES
// ==========================================

/**
 * Computes p-value for Student's t test based on test statistic, degrees of freedom, and hypothesis type.
 */
export function calculateStudentTPValue(
  t: number,
  df: number,
  hypType: HypothesisType
): number {
  if (isNaN(t) || isNaN(df) || df <= 0) return NaN;

  if (hypType === 'TWO_SIDED') {
    return 2 * (1 - studentTCDF(Math.abs(t), df));
  } else if (hypType === 'GREATER_THAN') {
    return 1 - studentTCDF(t, df);
  } else {
    // LESS_THAN
    return studentTCDF(t, df);
  }
}

/**
 * Mechanically derives the statistical decision from p_value and alpha.
 * Strict rule: NEVER return "ACCEPT_H0"; use "DO_NOT_REJECT_NULL".
 */
export function deriveInferentialDecision(
  pValue: number | null,
  alpha: number
): InferentialDecision {
  if (pValue === null || isNaN(pValue)) {
    return 'DO_NOT_REJECT_NULL';
  }
  return pValue < alpha ? 'REJECT_NULL' : 'DO_NOT_REJECT_NULL';
}

// ==========================================
// 3. EFFECT SIZE CALCULATIONS
// ==========================================

/**
 * Calculates Cohen's d for one sample or two samples.
 */
export function calculateCohensD(
  meanDiff: number,
  std: number
): EffectSizeResult {
  if (std === 0 || isNaN(std) || isNaN(meanDiff)) {
    return { metric: 'COHENS_D', value: null };
  }
  return { metric: 'COHENS_D', value: meanDiff / std };
}

/**
 * Calculates Cramér's V for Chi-Square test of independence.
 */
export function calculateCramersV(
  chi2: number,
  n: number,
  rows: number,
  cols: number
): EffectSizeResult {
  const minDim = Math.min(rows - 1, cols - 1);
  if (n <= 0 || minDim <= 0 || isNaN(chi2)) {
    return { metric: 'CRAMERS_V', value: null };
  }
  const v = Math.sqrt(chi2 / (n * minDim));
  return { metric: 'CRAMERS_V', value: v };
}

// ==========================================
// 4. CONFIDENCE INTERVAL CALCULATIONS
// ==========================================

/**
 * Calculates confidence interval for mean or mean difference using Student's t distribution.
 */
export function calculateTConfidenceInterval(options: {
  estimate: number;
  se: number;
  df: number;
  confidenceLevel: number;
  method: string;
}): ConfidenceIntervalResult | null {
  const { estimate, se, df, confidenceLevel, method } = options;

  if (se <= 0 || df <= 0 || isNaN(se) || isNaN(estimate) || isNaN(df)) {
    return null;
  }

  const alpha = 1 - confidenceLevel;
  const tCrit = Math.abs(studentTQuantile(1 - alpha / 2, df));

  if (!isFinite(tCrit)) return null;

  const marginOfError = tCrit * se;

  return {
    confidence_level: confidenceLevel,
    lower_bound: estimate - marginOfError,
    upper_bound: estimate + marginOfError,
    method
  };
}

// ==========================================
// 5. MULTIPLE TESTING ADJUSTMENT
// ==========================================

/**
 * Applies multiple testing correction to p-values without mutating raw p-values.
 */
export function applyMultipleTestingCorrection(
  pValues: number[],
  method: MultipleTestingMethod
): number[] {
  const m = pValues.length;
  if (m === 0) return [];

  if (method === 'BONFERRONI') {
    return pValues.map(p => Math.min(1.0, p * m));
  }

  if (method === 'HOLM') {
    const indexed = pValues.map((p, idx) => ({ p, idx }));
    indexed.sort((a, b) => a.p - b.p);

    const adjusted = new Array<number>(m);
    let maxP = 0;

    for (let i = 0; i < m; i++) {
      const rawP = indexed[i].p;
      const adjP = Math.min(1.0, rawP * (m - i));
      maxP = Math.max(maxP, adjP);
      adjusted[indexed[i].idx] = Math.min(1.0, maxP);
    }

    return adjusted;
  }

  if (method === 'BENJAMINI_HOCHBERG') {
    const indexed = pValues.map((p, idx) => ({ p, idx }));
    indexed.sort((a, b) => a.p - b.p);

    const adjusted = new Array<number>(m);
    let minP = 1.0;

    for (let i = m - 1; i >= 0; i--) {
      const rawP = indexed[i].p;
      const rank = i + 1;
      const adjP = Math.min(1.0, (rawP * m) / rank);
      minP = Math.min(minP, adjP);
      adjusted[indexed[i].idx] = minP;
    }

    return adjusted;
  }

  return pValues;
}
