/**
 * Phase D13 — Scientific Data Layer: Non-Parametric & Robust Analysis Engine Pure Math
 *
 * Provides pure, deterministic non-parametric mathematical procedures:
 * 1. Global and Within-Block Ranking with Tie Corrections
 * 2. Mann-Whitney U Test
 * 3. Wilcoxon Signed-Rank Test
 * 4. Kruskal-Wallis Test
 * 5. Friedman Test
 * 6. Spearman Rank Correlation
 * 7. Fisher's Exact Test (2x2 Contingency Table)
 */

import {
  chiSquareCDF,
  logGamma,
  normalCDF,
  calculateStudentTPValue
} from './inferentialAnalysis';
import { NonParametricAlternativeHypothesis } from './nonParametricContracts';

export interface RankResult {
  ranks: number[];
  tieCorrectionSum: number; // sum(t_j^3 - t_j)
  tieCount: number;
}

/**
 * Assigns fractional average ranks to array of numbers with tie correction.
 */
export function assignRanks(values: number[]): RankResult {
  const n = values.length;
  if (n === 0) {
    return { ranks: [], tieCorrectionSum: 0, tieCount: 0 };
  }

  // Create indexed list
  const indexed = values.map((val, idx) => ({ val, idx }));
  indexed.sort((a, b) => a.val - b.val);

  const ranks = new Array<number>(n);
  let tieCorrectionSum = 0;
  let tieCount = 0;

  let i = 0;
  while (i < n) {
    let j = i;
    while (j < n && indexed[j].val === indexed[i].val) {
      j++;
    }

    const count = j - i;
    // Average rank for 1-based indices i+1 ... j
    const avgRank = (i + 1 + j) / 2;

    for (let k = i; k < j; k++) {
      ranks[indexed[k].idx] = avgRank;
    }

    if (count > 1) {
      tieCorrectionSum += count * count * count - count;
      tieCount += count;
    }

    i = j;
  }

  return { ranks, tieCorrectionSum, tieCount };
}

export interface MannWhitneyResult {
  uStatistic: number;
  u1: number;
  u2: number;
  zScore: number;
  pValue: number;
  effectSize: number; // r = |z| / sqrt(N)
  tieCorrectionSum: number;
  tieCount: number;
}

/**
 * Computes Mann-Whitney U test for two independent groups.
 */
export function computeMannWhitneyU(
  groupA: number[],
  groupB: number[],
  altType: NonParametricAlternativeHypothesis
): MannWhitneyResult {
  const n1 = groupA.length;
  const n2 = groupB.length;
  if (n1 === 0 || n2 === 0) {
    throw new Error('Both groups must contain at least 1 observation');
  }

  const combined = [...groupA, ...groupB];
  const N = n1 + n2;
  const { ranks, tieCorrectionSum, tieCount } = assignRanks(combined);

  let r1 = 0;
  for (let i = 0; i < n1; i++) {
    r1 += ranks[i];
  }

  const u1 = n1 * n2 + (n1 * (n1 + 1)) / 2 - r1; // Pairs where A < B
  const u2 = n1 * n2 - u1; // Pairs where A > B

  const eU = (n1 * n2) / 2;
  const varU = ((n1 * n2) / 12) * (N + 1 - tieCorrectionSum / (N * (N - 1) || 1));
  const stdU = Math.sqrt(varU > 0 ? varU : 1e-15);

  let uStat: number;
  let zScore = 0;
  let pValue = 1.0;

  if (altType === 'TWO_SIDED') {
    uStat = Math.min(u1, u2);
    zScore = (Math.abs(u1 - eU) - 0.5) / stdU;
    if (zScore < 0) zScore = 0;
    pValue = 2 * (1 - normalCDF(zScore));
  } else if (altType === 'GREATER_THAN') {
    uStat = u2;
    zScore = (u2 - eU - 0.5) / stdU;
    pValue = 1 - normalCDF(zScore);
  } else {
    uStat = u1;
    zScore = (u1 - eU - 0.5) / stdU;
    pValue = 1 - normalCDF(zScore);
  }

  if (pValue > 1) pValue = 1.0;
  if (pValue < 0) pValue = 0.0;

  const effectSize = Math.abs(zScore) / Math.sqrt(N);

  return {
    uStatistic: uStat,
    u1,
    u2,
    zScore,
    pValue,
    effectSize,
    tieCorrectionSum,
    tieCount
  };
}

export interface WilcoxonSignedRankResult {
  wStatistic: number;
  wPositive: number;
  wNegative: number;
  zScore: number;
  pValue: number;
  effectSize: number;
  totalPairs: number;
  zeroDifferencesRemoved: number;
  effectivePairs: number;
  tieCount: number;
}

/**
 * Computes Wilcoxon Signed-Rank test for paired observations.
 */
export function computeWilcoxonSignedRank(
  pairs: { x: number; y: number }[],
  altType: NonParametricAlternativeHypothesis
): WilcoxonSignedRankResult {
  const totalPairs = pairs.length;
  if (totalPairs === 0) {
    throw new Error('Must provide at least 1 paired observation');
  }

  // Calculate differences and remove zeroes
  const nonZeroPairs: { diff: number; absDiff: number; sign: number }[] = [];
  let zeroCount = 0;

  for (const p of pairs) {
    const diff = p.x - p.y;
    if (diff === 0) {
      zeroCount++;
    } else {
      nonZeroPairs.push({
        diff,
        absDiff: Math.abs(diff),
        sign: diff > 0 ? 1 : -1
      });
    }
  }

  const Nr = nonZeroPairs.length;
  if (Nr === 0) {
    return {
      wStatistic: 0,
      wPositive: 0,
      wNegative: 0,
      zScore: 0,
      pValue: 1.0,
      effectSize: 0,
      totalPairs,
      zeroDifferencesRemoved: zeroCount,
      effectivePairs: 0,
      tieCount: 0
    };
  }

  const absDiffs = nonZeroPairs.map((p) => p.absDiff);
  const { ranks, tieCorrectionSum, tieCount } = assignRanks(absDiffs);

  let wPos = 0;
  let wNeg = 0;

  for (let i = 0; i < Nr; i++) {
    if (nonZeroPairs[i].sign > 0) {
      wPos += ranks[i];
    } else {
      wNeg += ranks[i];
    }
  }

  let wStat: number;
  if (altType === 'TWO_SIDED') {
    wStat = Math.min(wPos, wNeg);
  } else if (altType === 'GREATER_THAN') {
    wStat = wPos;
  } else {
    wStat = wNeg;
  }

  const eW = (Nr * (Nr + 1)) / 4;
  const varW = (Nr * (Nr + 1) * (2 * Nr + 1)) / 24 - tieCorrectionSum / 48;
  const stdW = Math.sqrt(varW > 0 ? varW : 1e-15);

  let zScore = 0;
  let pValue = 1.0;

  if (altType === 'TWO_SIDED') {
    zScore = (Math.abs(wPos - eW) - 0.5) / stdW;
    if (zScore < 0) zScore = 0;
    pValue = 2 * (1 - normalCDF(zScore));
  } else if (altType === 'GREATER_THAN') {
    zScore = (wPos - eW - 0.5) / stdW;
    pValue = 1 - normalCDF(zScore);
  } else {
    zScore = (wNeg - eW - 0.5) / stdW;
    pValue = 1 - normalCDF(zScore);
  }

  if (pValue > 1) pValue = 1.0;
  if (pValue < 0) pValue = 0.0;

  const effectSize = Math.abs(zScore) / Math.sqrt(Nr);

  return {
    wStatistic: wStat,
    wPositive: wPos,
    wNegative: wNeg,
    zScore,
    pValue,
    effectSize,
    totalPairs,
    zeroDifferencesRemoved: zeroCount,
    effectivePairs: Nr,
    tieCount
  };
}

export interface KruskalWallisResult {
  hStatistic: number;
  hAdjusted: number;
  degreesOfFreedom: number;
  pValue: number;
  effectSize: number; // eta^2 = (H_adj - k + 1) / (N - k)
  groupSizes: Record<string, number>;
  totalObservations: number;
  tieCorrectionSum: number;
  tieCount: number;
}

/**
 * Computes Kruskal-Wallis non-parametric ANOVA test.
 */
export function computeKruskalWallis(groups: Record<string, number[]>): KruskalWallisResult {
  const groupKeys = Object.keys(groups);
  const k = groupKeys.length;

  if (k < 2) {
    throw new Error('Kruskal-Wallis test requires at least 2 independent groups');
  }

  const combined: number[] = [];
  const groupSizes: Record<string, number> = {};
  const groupIndices: Record<string, number[]> = {};

  let currentIndex = 0;
  for (const key of groupKeys) {
    const vals = groups[key];
    if (vals.length === 0) {
      throw new Error(`Group '${key}' contains no valid observations`);
    }
    groupSizes[key] = vals.length;
    groupIndices[key] = [];

    for (const v of vals) {
      combined.push(v);
      groupIndices[key].push(currentIndex++);
    }
  }

  const N = combined.length;
  const { ranks, tieCorrectionSum, tieCount } = assignRanks(combined);

  let rankSumSqOverN = 0;
  for (const key of groupKeys) {
    const indices = groupIndices[key];
    let rankSum = 0;
    for (const idx of indices) {
      rankSum += ranks[idx];
    }
    rankSumSqOverN += (rankSum * rankSum) / groups[key].length;
  }

  const hUnadj = (12 / (N * (N + 1))) * rankSumSqOverN - 3 * (N + 1);
  const tieFactor = 1 - tieCorrectionSum / (N * N * N - N || 1);
  const hAdj = tieFactor > 0 ? hUnadj / tieFactor : hUnadj;

  const df = k - 1;
  const pValue = 1 - chiSquareCDF(Math.max(0, hAdj), df);
  const etaSquared = Math.max(0, (hAdj - k + 1) / (N - k || 1));

  return {
    hStatistic: hUnadj,
    hAdjusted: hAdj,
    degreesOfFreedom: df,
    pValue,
    effectSize: etaSquared,
    groupSizes,
    totalObservations: N,
    tieCorrectionSum,
    tieCount
  };
}

export interface FriedmanResult {
  qStatistic: number;
  degreesOfFreedom: number;
  pValue: number;
  effectSize: number; // Kendall's W = Q / (b * (k - 1))
  totalBlocks: number;
  completeBlocks: number;
  excludedBlocks: number;
  conditionCount: number;
}

/**
 * Computes Friedman test for repeated measures / block design.
 * Matrix shape: [block_i][condition_j]
 */
export function computeFriedman(matrix: number[][]): FriedmanResult {
  const totalBlocks = matrix.length;
  if (totalBlocks === 0) {
    throw new Error('Friedman test requires at least 1 block');
  }

  const k = matrix[0].length;
  if (k < 3) {
    throw new Error('Friedman test requires at least 3 conditions');
  }

  // Filter complete blocks
  const completeRows: number[][] = [];
  let excludedBlocks = 0;

  for (const row of matrix) {
    if (row.length === k && row.every((val) => typeof val === 'number' && Number.isFinite(val))) {
      completeRows.push(row);
    } else {
      excludedBlocks++;
    }
  }

  const b = completeRows.length;
  if (b === 0) {
    throw new Error('No complete blocks available for Friedman test');
  }

  // Rank conditions within each block
  const conditionRankSums = new Array<number>(k).fill(0);

  for (let i = 0; i < b; i++) {
    const row = completeRows[i];
    const { ranks } = assignRanks(row);
    for (let j = 0; j < k; j++) {
      conditionRankSums[j] += ranks[j];
    }
  }

  let rankSumSq = 0;
  for (let j = 0; j < k; j++) {
    rankSumSq += conditionRankSums[j] * conditionRankSums[j];
  }

  const qStat = (12 / (b * k * (k + 1))) * rankSumSq - 3 * b * (k + 1);
  const df = k - 1;
  const pValue = 1 - chiSquareCDF(Math.max(0, qStat), df);
  const kendallsW = qStat / (b * (k - 1));

  return {
    qStatistic: qStat,
    degreesOfFreedom: df,
    pValue,
    effectSize: Math.min(1.0, Math.max(0, kendallsW)),
    totalBlocks,
    completeBlocks: b,
    excludedBlocks,
    conditionCount: k
  };
}

export interface SpearmanResult {
  rho: number;
  tStatistic: number;
  degreesOfFreedom: number;
  pValue: number;
  sampleSize: number;
  tieCount: number;
}

/**
 * Computes Spearman rank correlation coefficient and significance test.
 */
export function computeSpearmanCorrelation(
  xVals: number[],
  yVals: number[],
  altType: NonParametricAlternativeHypothesis
): SpearmanResult {
  const N = xVals.length;
  if (N !== yVals.length) {
    throw new Error('X and Y arrays must have equal length');
  }
  if (N < 3) {
    throw new Error('Spearman correlation requires at least 3 paired observations');
  }

  const { ranks: rX, tieCount: tieX } = assignRanks(xVals);
  const { ranks: rY, tieCount: tieY } = assignRanks(yVals);

  let meanX = 0;
  let meanY = 0;
  for (let i = 0; i < N; i++) {
    meanX += rX[i];
    meanY += rY[i];
  }
  meanX /= N;
  meanY /= N;

  let num = 0;
  let denX = 0;
  let denY = 0;

  for (let i = 0; i < N; i++) {
    const dX = rX[i] - meanX;
    const dY = rY[i] - meanY;
    num += dX * dY;
    denX += dX * dX;
    denY += dY * dY;
  }

  if (denX === 0 || denY === 0) {
    throw new Error('Zero variance encountered in ranked variables');
  }

  const rho = num / Math.sqrt(denX * denY);
  const clampedRho = Math.min(1.0, Math.max(-1.0, rho));

  const df = N - 2;
  const tStat = (clampedRho * Math.sqrt(df)) / Math.sqrt(Math.max(1e-15, 1 - clampedRho * clampedRho));

  let pVal = calculateStudentTPValue(tStat, df, altType);
  if (isNaN(pVal) || pVal > 1) pVal = 1.0;
  if (pVal < 0) pVal = 0.0;

  return {
    rho: clampedRho,
    tStatistic: tStat,
    degreesOfFreedom: df,
    pValue: pVal,
    sampleSize: N,
    tieCount: tieX + tieY
  };
}

export interface FisherExactResult {
  oddsRatio: number | null;
  pValue: number;
  observed: number[][];
  marginalRows: number[];
  marginalCols: number[];
  sampleSize: number;
}

/**
 * Computes Fisher's Exact Test for 2x2 contingency table.
 */
export function computeFisherExact(
  a: number,
  b: number,
  c: number,
  d: number,
  altType: NonParametricAlternativeHypothesis
): FisherExactResult {
  if (a < 0 || b < 0 || c < 0 || d < 0) {
    throw new Error('Contingency table counts must be non-negative');
  }

  const N = a + b + c + d;
  if (N === 0) {
    throw new Error('Contingency table must have total count > 0');
  }

  const r1 = a + b;
  const r2 = c + d;
  const c1 = a + c;
  const c2 = b + d;

  let oddsRatio: number | null = null;
  if (b * c === 0) {
    oddsRatio = a * d === 0 ? null : Infinity;
  } else {
    oddsRatio = (a * d) / (b * c);
  }

  // Hypergeometric probability log formula
  const logProb = (x: number): number => {
    return (
      logGamma(r1 + 1) +
      logGamma(r2 + 1) +
      logGamma(c1 + 1) +
      logGamma(c2 + 1) -
      (logGamma(x + 1) +
        logGamma(r1 - x + 1) +
        logGamma(c1 - x + 1) +
        logGamma(r2 - c1 + x + 1) +
        logGamma(N + 1))
    );
  };

  const minX = Math.max(0, c1 - r2);
  const maxX = Math.min(r1, c1);
  const obsLogP = logProb(a);

  let pVal = 0;

  for (let x = minX; x <= maxX; x++) {
    const lp = logProb(x);
    const prob = Math.exp(lp);

    if (altType === 'TWO_SIDED') {
      if (lp <= obsLogP + 1e-11) {
        pVal += prob;
      }
    } else if (altType === 'GREATER_THAN') {
      if (x >= a) {
        pVal += prob;
      }
    } else {
      // LESS_THAN
      if (x <= a) {
        pVal += prob;
      }
    }
  }

  if (pVal > 1) pVal = 1.0;
  if (pVal < 0) pVal = 0.0;

  return {
    oddsRatio,
    pValue: pVal,
    observed: [
      [a, b],
      [c, d]
    ],
    marginalRows: [r1, r2],
    marginalCols: [c1, c2],
    sampleSize: N
  };
}
