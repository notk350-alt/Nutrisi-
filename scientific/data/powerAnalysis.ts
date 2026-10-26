/**
 * Phase D12 — Scientific Data Layer: Power Analysis Pure Mathematics Engine
 *
 * Implements deterministic, numerically stable mathematical functions for:
 * 1. Standard Normal distribution CDF and Quantile functions
 * 2. Statistical power calculations
 * 3. Sample size determination with integer ceiling rules
 * 4. Minimum Detectable Effect (MDE) calculations
 * 5. Attrition / Dropout adjustment
 * 6. Sensitivity analysis across parameter grids
 */

import {
  PowerAnalysisType,
  PowerCalculationMode,
  PowerTestDirection,
  SensitivityResult
} from './powerContracts';

/**
 * High-precision approximation of Error Function erf(x)
 * Abramowitz and Stegun 7.1.26 (max error 1.5e-7)
 */
export function erf(x: number): number {
  if (x === 0) {
    return 0;
  }
  if (!Number.isFinite(x)) {
    return x > 0 ? 1 : -1;
  }
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);

  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const t = 1.0 / (1.0 + p * absX);
  const y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);

  return sign * y;
}

/**
 * Standard Normal Cumulative Distribution Function Phi(z)
 */
export function normalCdf(z: number): number {
  if (!Number.isFinite(z)) {
    return z > 0 ? 1 : 0;
  }
  return 0.5 * (1.0 + erf(z / Math.SQRT2));
}

/**
 * Beasley-Springer-Moro inverse normal CDF approximation (quantile function)
 */
export function normalQuantile(p: number): number {
  if (p <= 0 || p >= 1 || !Number.isFinite(p)) {
    throw new RangeError('Probability p must be strictly between 0 and 1');
  }

  // Rational approximation for central region
  const a = [
    -3.969683028665376e1,
    2.209460984245205e2,
    -2.759285104469687e2,
    1.383577518672690e2,
    -3.066479806614716e1,
    2.506628277459239e0
  ];

  const b = [
    -5.447609879822406e1,
    1.615858368580409e2,
    -1.556989798598866e2,
    6.680131188771972e1,
    -1.328068155288572e1
  ];

  const c = [
    -7.784894002430293e-3,
    -3.223964580411365e-1,
    -2.400758277161838e0,
    -2.549732539343734e0,
    4.374664141464968e0,
    2.938163982698783e0
  ];

  const d = [
    7.784695709041462e-3,
    3.224671290700398e-1,
    2.445134137142996e0,
    3.754408661907416e0
  ];

  const pLow = 0.02425;
  const pHigh = 1 - pLow;

  let q: number, r: number;

  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (
      ((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]
    ) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p <= pHigh) {
    q = p - 0.5;
    r = q * q;
    return (
      ((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]
    ) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return (
      -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
}

/**
 * Fisher's z transform for correlation coefficient r
 */
export function fisherZ(r: number): number {
  if (Math.abs(r) >= 1) {
    throw new RangeError('Correlation r must be strictly between -1 and 1');
  }
  return 0.5 * Math.log((1 + r) / (1 - r));
}

/**
 * Inverse Fisher's z transform
 */
export function invFisherZ(z: number): number {
  return Math.tanh(z);
}

export interface CalculationInput {
  analysis_type: PowerAnalysisType;
  mode: PowerCalculationMode;
  alpha: number;
  target_power?: number | null;
  effect_size?: number | null;
  sample_size?: number | null;
  direction?: PowerTestDirection;
  allocation_ratio?: number;
  groups?: number;
  dropout_rate?: number;
  num_predictors?: number;
  degrees_of_freedom?: number;
  baseline_proportion?: number;
}

export interface CalculationOutput {
  required_sample_size: number | null;
  statistical_sample_size: number | null;
  attrition_adjusted_sample_size: number | null;
  achieved_power: number | null;
  minimum_detectable_effect: number | null;
  group_sample_sizes: Record<string, number> | null;
  assumptions: string[];
  warnings: string[];
}

/**
 * Computes critical z-value based on alpha and direction.
 */
export function getCriticalZ(alpha: number, direction: PowerTestDirection = 'TWO_SIDED'): number {
  if (direction === 'TWO_SIDED') {
    return normalQuantile(1 - alpha / 2);
  }
  return normalQuantile(1 - alpha);
}

/**
 * Core mathematical calculation engine for power, sample size, and MDE.
 */
export function computePowerMetrics(input: CalculationInput): CalculationOutput {
  const {
    analysis_type,
    mode,
    alpha,
    direction = 'TWO_SIDED',
    allocation_ratio = 1.0,
    groups = 3,
    dropout_rate = 0,
    num_predictors = 1,
    baseline_proportion = 0.5
  } = input;

  const zAlpha = getCriticalZ(alpha, direction);
  const assumptions: string[] = [
    `Significance level alpha = ${alpha}`,
    `Direction = ${direction}`
  ];
  const warnings: string[] = [];

  let reqSampleSize: number | null = null;
  let statSampleSize: number | null = null;
  let adjSampleSize: number | null = null;
  let achievedPower: number | null = null;
  let mde: number | null = null;
  let groupSizes: Record<string, number> | null = null;

  if (mode === 'SAMPLE_SIZE') {
    const targetPower = input.target_power;
    const effectSize = input.effect_size;

    if (targetPower == null || effectSize == null || effectSize <= 0) {
      throw new Error('SAMPLE_SIZE mode requires non-null target_power and positive effect_size');
    }

    const zBeta = normalQuantile(targetPower);
    assumptions.push(`Target statistical power = ${targetPower}`);
    assumptions.push(`Effect size = ${effectSize}`);

    switch (analysis_type) {
      case 'ONE_SAMPLE_MEAN':
      case 'PAIRED_MEAN':
      case 'ONE_PROPORTION':
      case 'CHI_SQUARE': {
        const rawN = Math.pow((zAlpha + zBeta) / effectSize, 2);
        statSampleSize = Math.ceil(rawN);
        reqSampleSize = statSampleSize;
        assumptions.push('Single cohort or paired design');
        break;
      }
      case 'TWO_SAMPLE_MEAN':
      case 'TWO_PROPORTIONS': {
        const mult = 1 + 1 / allocation_ratio;
        const n1Raw = mult * Math.pow((zAlpha + zBeta) / effectSize, 2);
        const n1 = Math.ceil(n1Raw);
        const n2 = Math.ceil(n1 * allocation_ratio);
        statSampleSize = n1 + n2;
        reqSampleSize = statSampleSize;
        groupSizes = { group_a: n1, group_b: n2 };
        assumptions.push(`Two independent cohorts with allocation ratio ${allocation_ratio} (group_a : group_b)`);
        break;
      }
      case 'CORRELATION': {
        const zR = fisherZ(effectSize);
        const rawN = 3 + Math.pow((zAlpha + zBeta) / zR, 2);
        statSampleSize = Math.ceil(rawN);
        reqSampleSize = statSampleSize;
        assumptions.push("Fisher's z transformation applied for Pearson correlation");
        break;
      }
      case 'ANOVA': {
        const k = Math.max(2, groups);
        const nPerGroupRaw = Math.pow(zAlpha + zBeta, 2) / (k * Math.pow(effectSize, 2));
        const nPerGroup = Math.ceil(nPerGroupRaw);
        statSampleSize = k * nPerGroup;
        reqSampleSize = statSampleSize;
        const groupObj: Record<string, number> = {};
        for (let i = 1; i <= k; i++) {
          groupObj[`group_${i}`] = nPerGroup;
        }
        groupSizes = groupObj;
        assumptions.push(`One-way ANOVA with ${k} balanced groups`);
        break;
      }
      case 'LINEAR_REGRESSION': {
        const u = Math.max(1, num_predictors);
        const rawN = u + 1 + Math.pow((zAlpha + zBeta) / Math.sqrt(effectSize), 2);
        statSampleSize = Math.ceil(rawN);
        reqSampleSize = statSampleSize;
        assumptions.push(`Multiple linear regression with ${u} predictor(s)`);
        break;
      }
      case 'LOGISTIC_REGRESSION': {
        const p0 = baseline_proportion;
        const theta = Math.abs(Math.log(effectSize));
        if (theta === 0) {
          throw new Error('Logistic regression Odds Ratio must be non-equal to 1.0');
        }
        const rawN = Math.pow(zAlpha + zBeta, 2) / (Math.pow(theta, 2) * p0 * (1 - p0));
        statSampleSize = Math.ceil(rawN);
        reqSampleSize = statSampleSize;
        assumptions.push(`Logistic regression with baseline event rate ${p0}`);
        break;
      }
    }
  } else if (mode === 'ACHIEVED_POWER') {
    const N = input.sample_size;
    const effectSize = input.effect_size;

    if (N == null || N <= 0 || effectSize == null || effectSize <= 0) {
      throw new Error('ACHIEVED_POWER mode requires positive sample_size and effect_size');
    }

    statSampleSize = Math.ceil(N);
    assumptions.push(`Provided statistical sample size N = ${statSampleSize}`);
    assumptions.push(`Effect size = ${effectSize}`);

    switch (analysis_type) {
      case 'ONE_SAMPLE_MEAN':
      case 'PAIRED_MEAN':
      case 'ONE_PROPORTION':
      case 'CHI_SQUARE': {
        const zBeta = effectSize * Math.sqrt(statSampleSize) - zAlpha;
        achievedPower = normalCdf(zBeta);
        break;
      }
      case 'TWO_SAMPLE_MEAN':
      case 'TWO_PROPORTIONS': {
        const n1 = Math.ceil(statSampleSize / (1 + allocation_ratio));
        const n2 = statSampleSize - n1;
        const nHarmonic = (n1 * n2) / (n1 + n2);
        groupSizes = { group_a: n1, group_b: n2 };
        const zBeta = effectSize * Math.sqrt(nHarmonic) - zAlpha;
        achievedPower = normalCdf(zBeta);
        break;
      }
      case 'CORRELATION': {
        const zR = fisherZ(effectSize);
        const effN = Math.max(1, statSampleSize - 3);
        const zBeta = zR * Math.sqrt(effN) - zAlpha;
        achievedPower = normalCdf(zBeta);
        break;
      }
      case 'ANOVA': {
        const k = Math.max(2, groups);
        const nPerGroup = Math.floor(statSampleSize / k);
        const groupObj: Record<string, number> = {};
        for (let i = 1; i <= k; i++) {
          groupObj[`group_${i}`] = nPerGroup;
        }
        groupSizes = groupObj;
        const zBeta = effectSize * Math.sqrt(k * nPerGroup) - zAlpha;
        achievedPower = normalCdf(zBeta);
        break;
      }
      case 'LINEAR_REGRESSION': {
        const u = Math.max(1, num_predictors);
        const effN = Math.max(1, statSampleSize - u - 1);
        const zBeta = Math.sqrt(effectSize * effN) - zAlpha;
        achievedPower = normalCdf(zBeta);
        break;
      }
      case 'LOGISTIC_REGRESSION': {
        const p0 = baseline_proportion;
        const theta = Math.abs(Math.log(effectSize));
        const zBeta = theta * Math.sqrt(statSampleSize * p0 * (1 - p0)) - zAlpha;
        achievedPower = normalCdf(zBeta);
        break;
      }
    }
  } else if (mode === 'MINIMUM_DETECTABLE_EFFECT') {
    const N = input.sample_size;
    const targetPower = input.target_power;

    if (N == null || N <= 0 || targetPower == null) {
      throw new Error('MINIMUM_DETECTABLE_EFFECT mode requires positive sample_size and target_power');
    }

    statSampleSize = Math.ceil(N);
    const zBeta = normalQuantile(targetPower);
    assumptions.push(`Provided statistical sample size N = ${statSampleSize}`);
    assumptions.push(`Target statistical power = ${targetPower}`);

    switch (analysis_type) {
      case 'ONE_SAMPLE_MEAN':
      case 'PAIRED_MEAN':
      case 'ONE_PROPORTION':
      case 'CHI_SQUARE': {
        mde = (zAlpha + zBeta) / Math.sqrt(statSampleSize);
        break;
      }
      case 'TWO_SAMPLE_MEAN':
      case 'TWO_PROPORTIONS': {
        const n1 = Math.ceil(statSampleSize / (1 + allocation_ratio));
        const n2 = statSampleSize - n1;
        const nHarmonic = (n1 * n2) / (n1 + n2);
        groupSizes = { group_a: n1, group_b: n2 };
        mde = (zAlpha + zBeta) / Math.sqrt(nHarmonic);
        break;
      }
      case 'CORRELATION': {
        const effN = Math.max(1, statSampleSize - 3);
        const zR = (zAlpha + zBeta) / Math.sqrt(effN);
        mde = invFisherZ(zR);
        break;
      }
      case 'ANOVA': {
        const k = Math.max(2, groups);
        mde = (zAlpha + zBeta) / Math.sqrt(statSampleSize);
        const nPerGroup = Math.floor(statSampleSize / k);
        const groupObj: Record<string, number> = {};
        for (let i = 1; i <= k; i++) {
          groupObj[`group_${i}`] = nPerGroup;
        }
        groupSizes = groupObj;
        break;
      }
      case 'LINEAR_REGRESSION': {
        const u = Math.max(1, num_predictors);
        const effN = Math.max(1, statSampleSize - u - 1);
        mde = Math.pow((zAlpha + zBeta) / Math.sqrt(effN), 2);
        break;
      }
      case 'LOGISTIC_REGRESSION': {
        const p0 = baseline_proportion;
        const theta = (zAlpha + zBeta) / Math.sqrt(statSampleSize * p0 * (1 - p0));
        mde = Math.exp(theta);
        break;
      }
    }
  }

  // Dropout / Attrition adjustment
  if (statSampleSize != null) {
    if (dropout_rate > 0 && dropout_rate < 1) {
      adjSampleSize = Math.ceil(statSampleSize / (1 - dropout_rate));
      assumptions.push(`Dropout / attrition adjustment rate = ${dropout_rate} (${dropout_rate * 100}%)`);
      warnings.push(`Sample size rounded up to ${adjSampleSize} to compensate for ${dropout_rate * 100}% expected attrition`);
    } else {
      adjSampleSize = statSampleSize;
    }
  }

  warnings.push('Sample size calculations apply explicit ceiling rule (integer rounding up)');

  return {
    required_sample_size: reqSampleSize,
    statistical_sample_size: statSampleSize,
    attrition_adjusted_sample_size: adjSampleSize,
    achieved_power: achievedPower,
    minimum_detectable_effect: mde,
    group_sample_sizes: groupSizes,
    assumptions,
    warnings
  };
}

/**
 * Computes deterministic sensitivity analysis grid across sample sizes.
 */
export function computeSensitivityGrid(
  baseInput: CalculationInput,
  sampleSizes: number[]
): SensitivityResult[] {
  const results: SensitivityResult[] = [];

  for (const n of sampleSizes) {
    if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) {
      continue;
    }

    if (baseInput.mode === 'ACHIEVED_POWER') {
      const output = computePowerMetrics({ ...baseInput, sample_size: n });
      results.push({
        sample_size: Math.ceil(n),
        effect_size: baseInput.effect_size ?? undefined,
        power: output.achieved_power ?? undefined
      });
    } else if (baseInput.mode === 'MINIMUM_DETECTABLE_EFFECT') {
      const output = computePowerMetrics({ ...baseInput, sample_size: n });
      results.push({
        sample_size: Math.ceil(n),
        effect_size: output.minimum_detectable_effect ?? undefined,
        power: baseInput.target_power ?? undefined
      });
    } else {
      // For sample size mode sensitivity, calculate achieved power for candidate Ns
      const output = computePowerMetrics({
        ...baseInput,
        mode: 'ACHIEVED_POWER',
        sample_size: n
      });
      results.push({
        sample_size: Math.ceil(n),
        effect_size: baseInput.effect_size ?? undefined,
        power: output.achieved_power ?? undefined
      });
    }
  }

  return results;
}
