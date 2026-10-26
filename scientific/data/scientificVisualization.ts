/**
 * Phase D14 — Scientific Data Layer: Pure Visualization Mathematics & Construction
 *
 * Deterministic, pure mathematical builders for converting raw data or
 * Phase D9–D13 analysis results into typed visualization payloads.
 *
 * Separation of Concerns:
 * - No side-effects or external state
 * - Zero dynamic evaluation
 * - Reuses existing statistical metrics
 */

import {
  BarChartItem,
  BarChartVisualizationConfig,
  BoxPlotItem,
  BoxPlotVisualizationConfig,
  ContingencyHeatmapVisualizationConfig,
  CorrelationMatrixVisualizationConfig,
  ErrorBarItem,
  ErrorBarVisualizationConfig,
  FrequencyChartVisualizationConfig,
  HistogramBinItem,
  HistogramVisualizationConfig,
  LineChartPoint,
  LineChartSeries,
  LineChartVisualizationConfig,
  PredictedVsObservedConfig,
  PredictedVsObservedItem,
  ResidualPlotConfig,
  ResidualPointItem,
  RocCurveVisualizationConfig,
  RocPointItem,
  ScatterPlotVisualizationConfig,
  ScatterPointItem,
  ScatterTrendline,
  ScientificVisualizationError
} from './visualizationContracts';
import {
  CategoricalFrequencyResultItem,
  ContingencyTableResult,
  DescriptiveNumericResultItem,
  DistributionSummaryResultItem,
  PairwiseAssociationResult
} from './analysisContracts';
import { InferentialAnalysisResult } from './inferentialContracts';
import { RegressionModelResult } from './regressionContracts';
import { ResearchPowerResult } from './powerContracts';
import { NonParametricContingencyTable } from './nonParametricContracts';

/**
 * Calculates deterministic percentile using linear interpolation between closest ranks.
 */
export function computeQuantileLinear(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const rank = (p / 100) * (sorted.length - 1);
  const lowerIndex = Math.floor(rank);
  const upperIndex = Math.ceil(rank);
  const weight = rank - lowerIndex;
  return sorted[lowerIndex] * (1 - weight) + sorted[upperIndex] * weight;
}

/**
 * Builds a deterministic histogram from numeric values.
 */
export function buildHistogramFromValues(
  values: number[],
  config?: HistogramVisualizationConfig
): { bins: HistogramBinItem[]; total_count: number; bin_width: number } {
  const filtered = values.filter((v) => Number.isFinite(v));
  if (filtered.length === 0) {
    return { bins: [], total_count: 0, bin_width: 0 };
  }

  const minVal = config?.min_value ?? Math.min(...filtered);
  const maxVal = config?.max_value ?? Math.max(...filtered);

  if (minVal === maxVal) {
    return {
      bins: [
        {
          bin_index: 0,
          lower_bound: minVal,
          upper_bound: maxVal,
          midpoint: minVal,
          count: filtered.length,
          percentage: 100.0
        }
      ],
      total_count: filtered.length,
      bin_width: 0
    };
  }

  const n = filtered.length;
  const binCount = config?.bin_count ?? Math.max(1, Math.min(50, Math.ceil(Math.log2(n) + 1)));
  const binWidth = config?.bin_width ?? (maxVal - minVal) / binCount;

  const bins: HistogramBinItem[] = [];
  for (let i = 0; i < binCount; i++) {
    const lower = minVal + i * binWidth;
    const upper = i === binCount - 1 ? maxVal : minVal + (i + 1) * binWidth;
    bins.push({
      bin_index: i,
      lower_bound: Number(lower.toFixed(6)),
      upper_bound: Number(upper.toFixed(6)),
      midpoint: Number(((lower + upper) / 2).toFixed(6)),
      count: 0,
      percentage: 0
    });
  }

  for (const val of filtered) {
    if (val < minVal || val > maxVal) continue;
    let assigned = false;
    for (let i = 0; i < bins.length; i++) {
      const isLast = i === bins.length - 1;
      if ((val >= bins[i].lower_bound && val < bins[i].upper_bound) || (isLast && val <= bins[i].upper_bound)) {
        bins[i].count++;
        assigned = true;
        break;
      }
    }
    if (!assigned && val === maxVal) {
      bins[bins.length - 1].count++;
    }
  }

  for (const bin of bins) {
    bin.percentage = Number(((bin.count / n) * 100).toFixed(4));
  }

  return {
    bins,
    total_count: n,
    bin_width: Number(binWidth.toFixed(6))
  };
}

/**
 * Builds a histogram from a D9 DistributionSummaryResultItem.
 */
export function buildHistogramFromD9Summary(
  summary: DistributionSummaryResultItem
): { bins: HistogramBinItem[]; total_count: number; bin_width: number } {
  if (summary.histogram_bins && summary.histogram_bins.length > 0) {
    const total = summary.histogram_bins.reduce((acc, b) => acc + b.count, 0);
    const bins: HistogramBinItem[] = summary.histogram_bins.map((b) => ({
      bin_index: b.bin_index,
      lower_bound: b.lower_bound,
      upper_bound: b.upper_bound,
      midpoint: Number(((b.lower_bound + b.upper_bound) / 2).toFixed(6)),
      count: b.count,
      percentage: b.percentage
    }));
    const width = bins.length > 0 ? bins[0].upper_bound - bins[0].lower_bound : 0;
    return {
      bins,
      total_count: total,
      bin_width: Number(width.toFixed(6))
    };
  }

  // Fallback to min/max if bins not pre-computed
  const min = summary.minimum ?? 0;
  const max = summary.maximum ?? 0;
  return buildHistogramFromValues([min, max]);
}

/**
 * Builds a box plot item from raw numeric observations.
 */
export function buildBoxPlotFromValues(
  values: number[],
  variable: string,
  groupKey?: string,
  config?: BoxPlotVisualizationConfig
): BoxPlotItem {
  const filtered = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (filtered.length === 0) {
    return {
      variable,
      group_key: groupKey,
      min: 0,
      q1: 0,
      median: 0,
      q3: 0,
      max: 0,
      iqr: 0,
      mean: null,
      outliers: []
    };
  }

  const q1 = computeQuantileLinear(filtered, 25);
  const median = computeQuantileLinear(filtered, 50);
  const q3 = computeQuantileLinear(filtered, 75);
  const iqr = q3 - q1;
  const multiplier = config?.iqr_multiplier ?? 1.5;
  const lowerThreshold = q1 - multiplier * iqr;
  const upperThreshold = q3 + multiplier * iqr;

  const outliers: number[] = [];
  const inliers: number[] = [];

  for (const v of filtered) {
    if (v < lowerThreshold || v > upperThreshold) {
      outliers.push(v);
    } else {
      inliers.push(v);
    }
  }

  const min = inliers.length > 0 ? Math.min(...inliers) : filtered[0];
  const max = inliers.length > 0 ? Math.max(...inliers) : filtered[filtered.length - 1];
  const mean = filtered.reduce((a, b) => a + b, 0) / filtered.length;

  return {
    variable,
    group_key: groupKey,
    min: Number(min.toFixed(6)),
    q1: Number(q1.toFixed(6)),
    median: Number(median.toFixed(6)),
    q3: Number(q3.toFixed(6)),
    max: Number(max.toFixed(6)),
    iqr: Number(iqr.toFixed(6)),
    mean: Number(mean.toFixed(6)),
    outliers: config?.show_outliers === false ? [] : outliers.map((o) => Number(o.toFixed(6)))
  };
}

/**
 * Builds a box plot item from a D9 DescriptiveNumericResultItem.
 */
export function buildBoxPlotFromD9Summary(
  item: DescriptiveNumericResultItem,
  groupKey?: string
): BoxPlotItem {
  const q1 = item.percentile_25 ?? item.minimum ?? 0;
  const median = item.median ?? item.percentile_50 ?? 0;
  const q3 = item.percentile_75 ?? item.maximum ?? 0;
  const min = item.minimum ?? q1;
  const max = item.maximum ?? q3;
  const iqr = item.interquartile_range ?? (q3 - q1);

  return {
    variable: item.variable_id,
    group_key: groupKey,
    min: Number(min.toFixed(6)),
    q1: Number(q1.toFixed(6)),
    median: Number(median.toFixed(6)),
    q3: Number(q3.toFixed(6)),
    max: Number(max.toFixed(6)),
    iqr: Number(iqr.toFixed(6)),
    mean: item.mean !== null ? Number(item.mean.toFixed(6)) : null,
    outliers: []
  };
}

/**
 * Builds a deterministic scatter plot with optional linear trendline.
 */
export function buildScatterPlotFromValues(
  xVals: number[],
  yVals: number[],
  ids?: string[],
  config?: ScatterPlotVisualizationConfig
): { points: ScatterPointItem[]; trendline?: ScatterTrendline } {
  const n = Math.min(xVals.length, yVals.length);
  const points: ScatterPointItem[] = [];

  let sumX = 0;
  let sumY = 0;
  let validN = 0;

  for (let i = 0; i < n; i++) {
    const x = xVals[i];
    const y = yVals[i];
    if (Number.isFinite(x) && Number.isFinite(y)) {
      points.push({
        x: Number(x.toFixed(6)),
        y: Number(y.toFixed(6)),
        id: ids && ids[i] ? ids[i] : undefined
      });
      sumX += x;
      sumY += y;
      validN++;
    }
  }

  let trendline: ScatterTrendline | undefined;
  if (config?.include_trendline !== false && validN >= 2) {
    const meanX = sumX / validN;
    const meanY = sumY / validN;
    let num = 0;
    let denX = 0;
    let denY = 0;

    for (const p of points) {
      const dx = p.x - meanX;
      const dy = p.y - meanY;
      num += dx * dy;
      denX += dx * dx;
      denY += dy * dy;
    }

    if (denX > 0) {
      const slope = num / denX;
      const intercept = meanY - slope * meanX;
      const r = denY > 0 ? num / Math.sqrt(denX * denY) : 0;
      trendline = {
        slope: Number(slope.toFixed(6)),
        intercept: Number(intercept.toFixed(6)),
        r_squared: Number((r * r).toFixed(6))
      };
    }
  }

  return { points, trendline };
}

/**
 * Builds a bar chart or frequency chart from categorical counts.
 */
export function buildBarChartFromCategories(
  categories: Array<{ category: string; count: number; percentage: number }>,
  config?: BarChartVisualizationConfig
): BarChartItem[] {
  let items: BarChartItem[] = categories.map((c) => ({
    category: c.category,
    value: c.count,
    count: c.count,
    percentage: Number(c.percentage.toFixed(4))
  }));

  if (config?.sort_order === 'DESCENDING') {
    items.sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
  } else if (config?.sort_order === 'ASCENDING') {
    items.sort((a, b) => a.count - b.count || a.category.localeCompare(b.category));
  } else {
    items.sort((a, b) => a.category.localeCompare(b.category));
  }

  if (config?.top_n && config.top_n > 0 && items.length > config.top_n) {
    items = items.slice(0, config.top_n);
  }

  return items;
}

/**
 * Builds a frequency chart from a D9 CategoricalFrequencyResultItem.
 */
export function buildFrequencyChartFromD9(
  item: CategoricalFrequencyResultItem,
  config?: FrequencyChartVisualizationConfig
): { items: BarChartItem[]; total_count: number } {
  const items = buildBarChartFromCategories(
    item.categories.map((c) => ({
      category: c.category,
      count: c.count,
      percentage: c.percentage
    })),
    {
      sort_order: 'DESCENDING',
      top_n: config?.top_n
    }
  );

  return {
    items,
    total_count: item.total_records
  };
}

/**
 * Builds a deterministic line chart series.
 */
export function buildLineChartFromSeries(
  seriesList: LineChartSeries[],
  config?: LineChartVisualizationConfig
): LineChartSeries[] {
  return seriesList.map((s) => {
    const sortedPoints = [...s.points];
    if (config?.sort_by_x !== false) {
      sortedPoints.sort((a, b) => a.x - b.x);
    }
    return {
      series_id: s.series_id,
      label: s.label,
      points: sortedPoints.map((p) => ({
        x: Number(p.x.toFixed(6)),
        y: Number(p.y.toFixed(6)),
        label: p.label
      }))
    };
  });
}

/**
 * Builds a line chart from D12 ResearchPowerResult sensitivity results.
 */
export function buildLineChartFromD12(powerResult: ResearchPowerResult): LineChartSeries[] {
  if (!powerResult.sensitivity_results || powerResult.sensitivity_results.length === 0) {
    return [];
  }

  const points: LineChartPoint[] = [];
  for (const s of powerResult.sensitivity_results) {
    if (s.sample_size !== undefined && s.power !== undefined) {
      points.push({
        x: s.sample_size,
        y: Number(s.power.toFixed(4)),
        label: `N=${s.sample_size}, Power=${s.power.toFixed(4)}`
      });
    } else if (s.effect_size !== undefined && s.power !== undefined) {
      points.push({
        x: s.effect_size,
        y: Number(s.power.toFixed(4)),
        label: `Effect=${s.effect_size}, Power=${s.power.toFixed(4)}`
      });
    }
  }

  points.sort((a, b) => a.x - b.x);

  return [
    {
      series_id: `${powerResult.power_analysis_id}_power_curve`,
      label: `${powerResult.analysis_type} Power Curve (α=${powerResult.alpha})`,
      points
    }
  ];
}

/**
 * Builds an error bar visualization from D10 InferentialAnalysisResult.
 */
export function buildErrorBarFromD10(
  result: InferentialAnalysisResult,
  config?: ErrorBarVisualizationConfig
): ErrorBarItem[] {
  const items: ErrorBarItem[] = [];

  if (
    result.confidence_interval &&
    result.confidence_interval.lower_bound !== null &&
    result.confidence_interval.upper_bound !== null
  ) {
    const lower = result.confidence_interval.lower_bound;
    const upper = result.confidence_interval.upper_bound;
    if (typeof lower === 'number' && typeof upper === 'number') {
      const center = (lower + upper) / 2;
      const margin = Math.abs(upper - center);

      items.push({
        label: `${result.test_type} Estimate`,
        value: Number(center.toFixed(6)),
        error_lower: Number(lower.toFixed(6)),
        error_upper: Number(upper.toFixed(6)),
        margin_of_error: Number(margin.toFixed(6))
      });
    }
  } else if (result.statistic !== null) {
    const val = result.statistic;
    items.push({
      label: `${result.test_type} Statistic`,
      value: Number(val.toFixed(6)),
      error_lower: Number(val.toFixed(6)),
      error_upper: Number(val.toFixed(6)),
      margin_of_error: 0
    });
  }

  return items;
}

/**
 * Builds a correlation matrix from D9 PairwiseAssociationResult.
 */
export function buildCorrelationMatrixFromD9(
  pairwise: PairwiseAssociationResult,
  config?: CorrelationMatrixVisualizationConfig
): { variables: string[]; matrix: number[][] } {
  const associations = pairwise.numeric_associations ?? [];
  const varSet = new Set<string>();

  for (const a of associations) {
    varSet.add(a.var1);
    varSet.add(a.var2);
  }

  const variables = Array.from(varSet).sort();
  const n = variables.length;
  const matrix: number[][] = Array.from({ length: n }, () => Array(n).fill(1));

  const varIndex = new Map<string, number>();
  variables.forEach((v, idx) => varIndex.set(v, idx));

  for (const a of associations) {
    const i = varIndex.get(a.var1);
    const j = varIndex.get(a.var2);
    if (i !== undefined && j !== undefined) {
      const val = a.pearson_correlation !== null ? Number(a.pearson_correlation.toFixed(6)) : 0;
      matrix[i][j] = val;
      matrix[j][i] = val;
    }
  }

  return { variables, matrix };
}

/**
 * Builds a contingency heatmap from D9 ContingencyTableResult.
 */
export function buildContingencyHeatmapFromD9(
  table: ContingencyTableResult,
  config?: ContingencyHeatmapVisualizationConfig
): {
  row_categories: string[];
  col_categories: string[];
  matrix: number[][];
  percentages: number[][];
  total_count: number;
} {
  const total = table.total_count || 1;
  const percentages: number[][] = table.matrix.map((row) =>
    row.map((val) => Number(((val / total) * 100).toFixed(4)))
  );

  return {
    row_categories: table.var1_categories,
    col_categories: table.var2_categories,
    matrix: table.matrix,
    percentages,
    total_count: table.total_count
  };
}

/**
 * Builds a contingency heatmap from D13 NonParametricContingencyTable.
 */
export function buildContingencyHeatmapFromD13(
  table: NonParametricContingencyTable,
  rowLabels?: string[],
  colLabels?: string[]
): {
  row_categories: string[];
  col_categories: string[];
  matrix: number[][];
  percentages: number[][];
  total_count: number;
} {
  const total = table.marginal_rows.reduce((acc, v) => acc + v, 0) || 1;
  const percentages: number[][] = table.observed.map((row) =>
    row.map((val) => Number(((val / total) * 100).toFixed(4)))
  );

  const rowCount = table.observed.length;
  const colCount = table.observed[0]?.length || 0;

  return {
    row_categories:
      rowLabels && rowLabels.length === rowCount
        ? rowLabels
        : Array.from({ length: rowCount }, (_, i) => `Row_${i + 1}`),
    col_categories:
      colLabels && colLabels.length === colCount
        ? colLabels
        : Array.from({ length: colCount }, (_, i) => `Col_${i + 1}`),
    matrix: table.observed,
    percentages,
    total_count: total
  };
}

/**
 * Builds a residual plot from D11 RegressionModelResult.
 */
export function buildResidualPlotFromD11(
  regression: RegressionModelResult,
  config?: ResidualPlotConfig
): { points: ResidualPointItem[]; reference_line: number; is_standardized: boolean } {
  if (!regression.residuals || regression.residuals.length === 0) {
    return { points: [], reference_line: 0, is_standardized: false };
  }

  const residuals = regression.residuals;
  const predictions = regression.predictions;
  const isStandardized = config?.standardized ?? false;

  let stdDev = 1;
  if (isStandardized) {
    const mean = residuals.reduce((a, b) => a + b, 0) / residuals.length;
    const variance =
      residuals.reduce((acc, r) => acc + (r - mean) * (r - mean), 0) / (residuals.length - 1 || 1);
    stdDev = Math.sqrt(variance) || 1;
  }

  const points: ResidualPointItem[] = [];
  for (let i = 0; i < residuals.length; i++) {
    const r = residuals[i];
    const p = predictions[i] ?? 0;
    points.push({
      predicted: Number(p.toFixed(6)),
      residual: Number(r.toFixed(6)),
      standardized_residual: isStandardized ? Number((r / stdDev).toFixed(6)) : undefined,
      id: `obs_${i}`
    });
  }

  return {
    points,
    reference_line: 0,
    is_standardized: isStandardized
  };
}

/**
 * Builds a predicted vs observed plot from D11 RegressionModelResult.
 */
export function buildPredictedVsObservedFromD11(
  observed: number[],
  regression: RegressionModelResult,
  config?: PredictedVsObservedConfig
): { points: PredictedVsObservedItem[]; identity_line: { slope: 1; intercept: 0 } } {
  const predictions = regression.predictions;
  const n = Math.min(observed.length, predictions.length);
  const points: PredictedVsObservedItem[] = [];

  for (let i = 0; i < n; i++) {
    points.push({
      observed: Number(observed[i].toFixed(6)),
      predicted: Number(predictions[i].toFixed(6)),
      id: `obs_${i}`
    });
  }

  return {
    points,
    identity_line: { slope: 1, intercept: 0 }
  };
}

/**
 * Builds a deterministic ROC curve and computes trapezoidal AUC.
 */
export function buildRocCurveFromProbabilities(
  probabilities: number[],
  actual: number[],
  config?: RocCurveConfig
): { points: RocPointItem[]; auc: number; reference_line: Array<{ fpr: number; tpr: number }> } {
  const n = Math.min(probabilities.length, actual.length);
  const pairs: Array<{ p: number; y: number }> = [];

  let posCount = 0;
  let negCount = 0;

  for (let i = 0; i < n; i++) {
    const y = actual[i] === 1 ? 1 : 0;
    if (y === 1) posCount++;
    else negCount++;
    pairs.push({ p: probabilities[i], y });
  }

  if (posCount === 0 || negCount === 0) {
    return {
      points: [
        { fpr: 0, tpr: 0, threshold: 1 },
        { fpr: 1, tpr: 1, threshold: 0 }
      ],
      auc: 0.5,
      reference_line: [
        { fpr: 0, tpr: 0 },
        { fpr: 1, tpr: 1 }
      ]
    };
  }

  // Sort pairs by descending probability
  pairs.sort((a, b) => b.p - a.p);

  const rawPoints: RocPointItem[] = [{ fpr: 0, tpr: 0, threshold: pairs[0].p + 1e-6 }];
  let tp = 0;
  let fp = 0;

  for (let i = 0; i < pairs.length; i++) {
    if (pairs[i].y === 1) {
      tp++;
    } else {
      fp++;
    }

    // Only record point if next threshold is different or this is the last item
    const isLast = i === pairs.length - 1;
    if (isLast || pairs[i].p !== pairs[i + 1].p) {
      rawPoints.push({
        fpr: Number((fp / negCount).toFixed(6)),
        tpr: Number((tp / posCount).toFixed(6)),
        threshold: Number(pairs[i].p.toFixed(6))
      });
    }
  }

  // Ensure end point is at (1, 1)
  if (rawPoints[rawPoints.length - 1].fpr < 1 || rawPoints[rawPoints.length - 1].tpr < 1) {
    rawPoints.push({ fpr: 1, tpr: 1, threshold: 0 });
  }

  // Calculate Trapezoidal AUC
  let auc = 0;
  for (let i = 1; i < rawPoints.length; i++) {
    const dx = rawPoints[i].fpr - rawPoints[i - 1].fpr;
    const avgY = (rawPoints[i].tpr + rawPoints[i - 1].tpr) / 2;
    auc += dx * avgY;
  }

  return {
    points: rawPoints,
    auc: Number(Math.max(0, Math.min(1, auc)).toFixed(6)),
    reference_line: [
      { fpr: 0, tpr: 0 },
      { fpr: 1, tpr: 1 }
    ]
  };
}

export interface RocCurveConfig {
  show_auc?: boolean;
  include_reference_line?: boolean;
}
