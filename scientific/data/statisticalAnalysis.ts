/**
 * Phase D9 — Scientific Data Layer: Statistical Analysis Engine
 *
 * Provides pure, deterministic mathematical and statistical functions:
 * - Descriptive numeric summaries
 * - Categorical frequency distributions
 * - Missingness audits
 * - Distribution summaries & deterministic binning
 * - Grouped & stratified analyses
 * - Typed record filtering (zero eval/new Function)
 * - Pairwise associations (Pearson correlation & Contingency tables)
 * - Unit verification & conversions
 * - Outlier detection (IQR & Z-score, non-destructive flagging)
 */

import {
  AnalysisConfiguration,
  AnalysisFilter,
  CategoricalFrequencyResultItem,
  CategoryFrequencyItem,
  ContingencyTableResult,
  DescriptiveNumericResultItem,
  DistributionHistogramBin,
  DistributionSummaryResultItem,
  FilterGroup,
  GroupedAnalysisGroupItem,
  GroupedSummaryResult,
  MissingnessSummaryResultItem,
  OutlierDetectionResultItem,
  PairwiseAssociationResult,
  PearsonAssociationItem,
  ScientificStatisticalAnalysisError
} from './analysisContracts';
import { convertUnit, findUnit } from '../units/unitConverter';
import { VariableStore } from './variableRegistry';

const DEFAULT_MISSING_TOKENS = ['NA', 'N/A', 'null', 'NULL', 'NaN', '999', '-1', '-'];

/**
 * Checks if a value is considered missing.
 */
export function isMissingValue(
  val: unknown,
  customTokens?: string[]
): boolean {
  if (val === null || val === undefined || val === '') {
    return true;
  }

  if (typeof val === 'number' && isNaN(val)) {
    return true;
  }

  const tokens = customTokens || DEFAULT_MISSING_TOKENS;
  if (typeof val === 'string' && tokens.includes(val.trim())) {
    return true;
  }

  return false;
}

/**
 * Evaluates a single filter condition on a record without dynamic evaluation.
 */
export function evaluateFilterCondition(
  record: Record<string, unknown>,
  filter: AnalysisFilter
): boolean {
  const { variable_id, operator, value } = filter;
  const rawVal = record[variable_id];

  // If missing and checking equality to null
  if (isMissingValue(rawVal)) {
    if (operator === '==') return value === null || value === 'null';
    if (operator === '!=') return value !== null && value !== 'null';
    return false;
  }

  switch (operator) {
    case '==':
      return String(rawVal) === String(value);

    case '!=':
      return String(rawVal) !== String(value);

    case '<':
      return Number(rawVal) < Number(value);

    case '<=':
      return Number(rawVal) <= Number(value);

    case '>':
      return Number(rawVal) > Number(value);

    case '>=':
      return Number(rawVal) >= Number(value);

    case 'IN':
      return Array.isArray(value) && value.map(String).includes(String(rawVal));

    case 'NOT_IN':
      return Array.isArray(value) && !value.map(String).includes(String(rawVal));

    default:
      throw new ScientificStatisticalAnalysisError(
        'ANALYSIS_FILTER_INVALID',
        `Unsupported filter operator "${operator}".`
      );
  }
}

/**
 * Evaluates filters and optional filter groups on a dataset record.
 */
export function evaluateRecordFilters(
  record: Record<string, unknown>,
  filters?: AnalysisFilter[],
  filterGroup?: FilterGroup
): boolean {
  if (filters && filters.length > 0) {
    for (const filter of filters) {
      if (!evaluateFilterCondition(record, filter)) {
        return false;
      }
    }
  }

  if (filterGroup && filterGroup.filters.length > 0) {
    const { logic, filters: groupFilters } = filterGroup;
    if (logic === 'AND') {
      for (const filter of groupFilters) {
        if (!evaluateFilterCondition(record, filter)) {
          return false;
        }
      }
    } else if (logic === 'OR') {
      let matched = false;
      for (const filter of groupFilters) {
        if (evaluateFilterCondition(record, filter)) {
          matched = true;
          break;
        }
      }
      if (!matched) return false;
    }
  }

  return true;
}

/**
 * Safely converts linear percentile rank (0 to 1) from a sorted numeric array.
 */
export function calculatePercentile(sortedValues: number[], p: number): number | null {
  if (sortedValues.length === 0) return null;
  if (sortedValues.length === 1) return sortedValues[0];

  const index = p * (sortedValues.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;

  if (upper >= sortedValues.length) return sortedValues[sortedValues.length - 1];
  return sortedValues[lower] + weight * (sortedValues[upper] - sortedValues[lower]);
}

/**
 * Calculates descriptive numeric statistics for a single variable across records.
 */
export function computeDescriptiveNumeric(options: {
  variable_id: string;
  records: Record<string, unknown>[];
  target_unit?: string;
  column_unit?: string;
  missing_tokens?: string[];
  variable_store?: VariableStore;
}): DescriptiveNumericResultItem {
  const {
    variable_id,
    records,
    target_unit,
    column_unit,
    missing_tokens,
    variable_store
  } = options;

  let canonicalUnit = target_unit || column_unit;

  if (variable_store) {
    const registeredVar = variable_store.get(variable_id);
    if (registeredVar) {
      canonicalUnit = canonicalUnit || registeredVar.unit;
    }
  }

  const validNumbers: number[] = [];
  let missingCount = 0;
  let invalidCount = 0;

  for (const rec of records) {
    const rawVal = rec[variable_id];

    if (isMissingValue(rawVal, missing_tokens)) {
      missingCount++;
      continue;
    }

    let numVal = typeof rawVal === 'number' ? rawVal : Number(rawVal);

    if (isNaN(numVal) || !isFinite(numVal)) {
      invalidCount++;
      continue;
    }

    // Unit conversion if units differ
    if (column_unit && target_unit && column_unit.trim() !== target_unit.trim()) {
      const fromUnitDef = findUnit(column_unit);
      const toUnitDef = findUnit(target_unit);

      if (fromUnitDef && toUnitDef && fromUnitDef.measurement_type !== toUnitDef.measurement_type) {
        throw new ScientificStatisticalAnalysisError(
          'ANALYSIS_UNIT_MISMATCH',
          `Dimension mismatch: Cannot convert "${column_unit}" (${fromUnitDef.measurement_type}) to "${target_unit}" (${toUnitDef.measurement_type}) for variable "${variable_id}".`
        );
      }

      try {
        const convRes = convertUnit(numVal, column_unit, target_unit);
        numVal = convRes.targetValue;
      } catch (err: any) {
        throw new ScientificStatisticalAnalysisError(
          'ANALYSIS_UNIT_MISMATCH',
          `Unit conversion failed for "${variable_id}" (${column_unit} -> ${target_unit}): ${err.message}`
        );
      }
    }

    validNumbers.push(numVal);
  }

  const totalRecords = records.length;
  const validCount = validNumbers.length;
  const missingPercentage = totalRecords > 0 ? (missingCount / totalRecords) * 100 : 0;

  if (validCount === 0) {
    return {
      variable_id,
      canonical_unit: canonicalUnit,
      total_records: totalRecords,
      valid_count: 0,
      missing_count: missingCount,
      missing_percentage: missingPercentage,
      invalid_count: invalidCount,
      minimum: null,
      maximum: null,
      sum: null,
      mean: null,
      median: null,
      variance: null,
      standard_deviation: null,
      percentile_25: null,
      percentile_50: null,
      percentile_75: null,
      interquartile_range: null,
      constant_value_flag: false,
      zero_variance_flag: false,
      notes: ['INSUFFICIENT_OBSERVATIONS: No valid numeric observations found.']
    };
  }

  // Sort ascending
  validNumbers.sort((a, b) => a - b);

  const minimum = validNumbers[0];
  const maximum = validNumbers[validNumbers.length - 1];
  const sum = validNumbers.reduce((acc, v) => acc + v, 0);
  const mean = sum / validCount;

  // Median
  const median = calculatePercentile(validNumbers, 0.5);

  // Variance & Standard Deviation
  let variance: number | null = null;
  let standardDeviation: number | null = null;
  let zeroVarianceFlag = false;
  const notes: string[] = [];

  if (validCount === 1) {
    variance = null;
    standardDeviation = null;
    zeroVarianceFlag = false;
    notes.push('INSUFFICIENT_OBSERVATIONS: Sample variance requires at least 2 observations (n >= 2).');
  } else {
    const sumSqDiff = validNumbers.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0);
    variance = sumSqDiff / (validCount - 1);
    if (variance === 0 || Math.abs(variance) < 1e-15) {
      variance = 0;
      zeroVarianceFlag = true;
    }
    standardDeviation = Math.sqrt(variance);
  }

  // Quartiles
  const p25 = calculatePercentile(validNumbers, 0.25);
  const p50 = median;
  const p75 = calculatePercentile(validNumbers, 0.75);
  const iqr = p25 !== null && p75 !== null ? p75 - p25 : null;

  const constantValueFlag = minimum === maximum;

  return {
    variable_id,
    canonical_unit: canonicalUnit,
    total_records: totalRecords,
    valid_count: validCount,
    missing_count: missingCount,
    missing_percentage: missingPercentage,
    invalid_count: invalidCount,
    minimum,
    maximum,
    sum,
    mean,
    median,
    variance,
    standard_deviation: standardDeviation,
    percentile_25: p25,
    percentile_50: p50,
    percentile_75: p75,
    interquartile_range: iqr,
    constant_value_flag: constantValueFlag,
    zero_variance_flag: zeroVarianceFlag,
    notes: notes.length > 0 ? notes : undefined
  };
}

/**
 * Calculates categorical frequency distributions for a variable.
 */
export function computeCategoricalFrequency(options: {
  variable_id: string;
  records: Record<string, unknown>[];
  missing_tokens?: string[];
}): CategoricalFrequencyResultItem {
  const { variable_id, records, missing_tokens } = options;

  const countsMap = new Map<string, number>();
  let missingCount = 0;
  let validCount = 0;

  for (const rec of records) {
    const rawVal = rec[variable_id];

    if (isMissingValue(rawVal, missing_tokens)) {
      missingCount++;
      continue;
    }

    const catStr = String(rawVal).trim();
    countsMap.set(catStr, (countsMap.get(catStr) || 0) + 1);
    validCount++;
  }

  const totalRecords = records.length;
  const missingPercentage = totalRecords > 0 ? (missingCount / totalRecords) * 100 : 0;

  // Deterministically sort categories by category string
  const sortedCategories = Array.from(countsMap.keys()).sort();

  const categories: CategoryFrequencyItem[] = sortedCategories.map(cat => {
    const count = countsMap.get(cat)!;
    const percentage = validCount > 0 ? (count / validCount) * 100 : 0;
    return {
      category: cat,
      count,
      percentage
    };
  });

  return {
    variable_id,
    total_records: totalRecords,
    valid_count: validCount,
    missing_count: missingCount,
    missing_percentage: missingPercentage,
    unique_category_count: categories.length,
    categories
  };
}

/**
 * Calculates missingness summary for a requested variable.
 */
export function computeMissingnessSummary(options: {
  variable_id: string;
  records: Record<string, unknown>[];
  missing_tokens?: string[];
}): MissingnessSummaryResultItem {
  const { variable_id, records, missing_tokens } = options;

  let missingCount = 0;
  let validCount = 0;
  let invalidCount = 0;

  for (const rec of records) {
    const rawVal = rec[variable_id];

    if (isMissingValue(rawVal, missing_tokens)) {
      missingCount++;
    } else {
      validCount++;
    }
  }

  const totalRecords = records.length;
  const missingPercentage = totalRecords > 0 ? (missingCount / totalRecords) * 100 : 0;

  return {
    variable_id,
    total_records: totalRecords,
    valid_count: validCount,
    missing_count: missingCount,
    missing_percentage: missingPercentage,
    invalid_count: invalidCount
  };
}

/**
 * Computes distribution summary and deterministic histogram binning for a numeric variable.
 */
export function computeDistributionSummary(options: {
  variable_id: string;
  records: Record<string, unknown>[];
  config?: AnalysisConfiguration;
}): DistributionSummaryResultItem {
  const desc = computeDescriptiveNumeric({
    variable_id: options.variable_id,
    records: options.records,
    missing_tokens: options.config?.missing_tokens
  });

  let histogramBins: DistributionHistogramBin[] | undefined = undefined;

  if (
    desc.valid_count > 0 &&
    desc.minimum !== null &&
    desc.maximum !== null &&
    options.config?.bin_count &&
    options.config.bin_count > 0
  ) {
    const binCount = options.config.bin_count;
    const min = desc.minimum;
    const max = desc.maximum;
    const range = max - min;

    const binWidth = range === 0 ? 1 : range / binCount;
    const bins: DistributionHistogramBin[] = [];

    for (let i = 0; i < binCount; i++) {
      const lower = min + i * binWidth;
      const upper = i === binCount - 1 ? max : min + (i + 1) * binWidth;
      bins.push({
        bin_index: i,
        lower_bound: lower,
        upper_bound: upper,
        count: 0,
        percentage: 0
      });
    }

    // Populate counts
    for (const rec of options.records) {
      const rawVal = rec[options.variable_id];
      if (isMissingValue(rawVal, options.config?.missing_tokens)) continue;

      const numVal = Number(rawVal);
      if (isNaN(numVal) || !isFinite(numVal)) continue;

      let binIdx = range === 0 ? 0 : Math.floor((numVal - min) / binWidth);
      if (binIdx >= binCount) binIdx = binCount - 1;
      if (binIdx < 0) binIdx = 0;

      bins[binIdx].count++;
    }

    for (const b of bins) {
      b.percentage = desc.valid_count > 0 ? (b.count / desc.valid_count) * 100 : 0;
    }

    histogramBins = bins;
  }

  return {
    variable_id: options.variable_id,
    canonical_unit: desc.canonical_unit,
    minimum: desc.minimum,
    maximum: desc.maximum,
    mean: desc.mean,
    median: desc.median,
    variance: desc.variance,
    standard_deviation: desc.standard_deviation,
    quartiles: {
      q1: desc.percentile_25,
      q2: desc.median,
      q3: desc.percentile_75
    },
    iqr: desc.interquartile_range,
    histogram_bins: histogramBins
  };
}

/**
 * Computes grouped/stratified analysis across 1 or more categorical grouping variables.
 */
export function computeGroupedSummary(options: {
  requested_variables: string[];
  group_by_variables: string[];
  records: Record<string, unknown>[];
  config?: AnalysisConfiguration;
}): GroupedSummaryResult {
  const { requested_variables, group_by_variables, records, config } = options;

  if (group_by_variables.length === 0) {
    throw new ScientificStatisticalAnalysisError(
      'ANALYSIS_GROUP_INVALID',
      'Grouping requires at least one grouping variable.'
    );
  }

  const groupBuckets = new Map<string, { group_values: Record<string, unknown>; records: Record<string, unknown>[] }>();

  for (const rec of records) {
    const groupValObj: Record<string, unknown> = {};
    const keyParts: string[] = [];

    for (const gVar of group_by_variables) {
      const rawGVal = rec[gVar];
      const gStr = isMissingValue(rawGVal, config?.missing_tokens) ? 'MISSING' : String(rawGVal).trim();
      groupValObj[gVar] = gStr;
      keyParts.push(`${gVar}=${gStr}`);
    }

    const groupKey = keyParts.join('::');

    if (!groupBuckets.has(groupKey)) {
      groupBuckets.set(groupKey, { group_values: groupValObj, records: [] });
    }

    groupBuckets.get(groupKey)!.records.push(rec);
  }

  // Deterministically sort group keys
  const sortedGroupKeys = Array.from(groupBuckets.keys()).sort();

  const groups: GroupedAnalysisGroupItem[] = sortedGroupKeys.map(groupKey => {
    const bucket = groupBuckets.get(groupKey)!;
    const descNumeric: Record<string, DescriptiveNumericResultItem> = {};
    const catFreq: Record<string, CategoricalFrequencyResultItem> = {};

    for (const reqVar of requested_variables) {
      // Check first non-missing value or default to numeric
      const firstVal = bucket.records.find(r => !isMissingValue(r[reqVar]))?.[reqVar];

      if (typeof firstVal === 'number' || (!isNaN(Number(firstVal)) && firstVal !== '')) {
        descNumeric[reqVar] = computeDescriptiveNumeric({
          variable_id: reqVar,
          records: bucket.records,
          missing_tokens: config?.missing_tokens
        });
      } else {
        catFreq[reqVar] = computeCategoricalFrequency({
          variable_id: reqVar,
          records: bucket.records,
          missing_tokens: config?.missing_tokens
        });
      }
    }

    return {
      group_key: groupKey,
      group_values: bucket.group_values,
      record_count: bucket.records.length,
      descriptive_numeric: Object.keys(descNumeric).length > 0 ? descNumeric : undefined,
      categorical_frequency: Object.keys(catFreq).length > 0 ? catFreq : undefined
    };
  });

  return {
    group_by_variables,
    groups
  };
}

/**
 * Computes Pearson correlation for numeric variables and contingency tables for categorical variables.
 */
export function computePairwiseAssociation(options: {
  requested_variables: string[];
  records: Record<string, unknown>[];
  config?: AnalysisConfiguration;
}): PairwiseAssociationResult {
  const { requested_variables, records, config } = options;

  const numericAssocs: PearsonAssociationItem[] = [];
  const categoricalAssocs: ContingencyTableResult[] = [];

  for (let i = 0; i < requested_variables.length; i++) {
    for (let j = i + 1; j < requested_variables.length; j++) {
      const var1 = requested_variables[i];
      const var2 = requested_variables[j];

      // Sample first non-missing values
      const val1Sample = records.find(r => !isMissingValue(r[var1], config?.missing_tokens))?.[var1];
      const val2Sample = records.find(r => !isMissingValue(r[var2], config?.missing_tokens))?.[var2];

      const isVar1Numeric = typeof val1Sample === 'number' || (!isNaN(Number(val1Sample)) && val1Sample !== '');
      const isVar2Numeric = typeof val2Sample === 'number' || (!isNaN(Number(val2Sample)) && val2Sample !== '');

      if (isVar1Numeric && isVar2Numeric) {
        // Pearson correlation
        const pairs: Array<{ x: number; y: number }> = [];

        for (const rec of records) {
          const v1 = rec[var1];
          const v2 = rec[var2];

          if (isMissingValue(v1, config?.missing_tokens) || isMissingValue(v2, config?.missing_tokens)) {
            continue;
          }

          const num1 = Number(v1);
          const num2 = Number(v2);

          if (!isNaN(num1) && isFinite(num1) && !isNaN(num2) && isFinite(num2)) {
            pairs.push({ x: num1, y: num2 });
          }
        }

        if (pairs.length < 2) {
          numericAssocs.push({
            var1,
            var2,
            pearson_correlation: null,
            pair_count: pairs.length,
            valid_count: pairs.length,
            constant_variable_flag: false,
            notes: 'Insufficient observations for Pearson correlation (n < 2).'
          });
          continue;
        }

        const meanX = pairs.reduce((acc, p) => acc + p.x, 0) / pairs.length;
        const meanY = pairs.reduce((acc, p) => acc + p.y, 0) / pairs.length;

        let num = 0;
        let denX = 0;
        let denY = 0;

        for (const p of pairs) {
          const dx = p.x - meanX;
          const dy = p.y - meanY;
          num += dx * dy;
          denX += dx * dx;
          denY += dy * dy;
        }

        if (denX === 0 || denY === 0) {
          numericAssocs.push({
            var1,
            var2,
            pearson_correlation: null,
            pair_count: pairs.length,
            valid_count: pairs.length,
            constant_variable_flag: true,
            notes: 'One or both variables are constant (zero variance).'
          });
          continue;
        }

        let r = num / Math.sqrt(denX * denY);
        if (r > 1) r = 1;
        if (r < -1) r = -1;

        numericAssocs.push({
          var1,
          var2,
          pearson_correlation: r,
          pair_count: pairs.length,
          valid_count: pairs.length,
          constant_variable_flag: false
        });
      } else {
        // Contingency table for categorical pair
        const cat1Set = new Set<string>();
        const cat2Set = new Set<string>();
        const validPairs: Array<{ v1: string; v2: string }> = [];

        for (const rec of records) {
          const raw1 = rec[var1];
          const raw2 = rec[var2];

          if (isMissingValue(raw1, config?.missing_tokens) || isMissingValue(raw2, config?.missing_tokens)) {
            continue;
          }

          const str1 = String(raw1).trim();
          const str2 = String(raw2).trim();

          cat1Set.add(str1);
          cat2Set.add(str2);
          validPairs.push({ v1: str1, v2: str2 });
        }

        const cat1List = Array.from(cat1Set).sort();
        const cat2List = Array.from(cat2Set).sort();

        const matrix: number[][] = cat1List.map(() => new Array(cat2List.length).fill(0));

        for (const pair of validPairs) {
          const rIdx = cat1List.indexOf(pair.v1);
          const cIdx = cat2List.indexOf(pair.v2);
          if (rIdx >= 0 && cIdx >= 0) {
            matrix[rIdx][cIdx]++;
          }
        }

        categoricalAssocs.push({
          var1,
          var2,
          var1_categories: cat1List,
          var2_categories: cat2List,
          matrix,
          total_count: validPairs.length
        });
      }
    }
  }

  return {
    numeric_associations: numericAssocs.length > 0 ? numericAssocs : undefined,
    categorical_associations: categoricalAssocs.length > 0 ? categoricalAssocs : undefined
  };
}

/**
 * Detects outliers using IQR or Z-Score method without deleting or modifying records.
 */
export function computeOutlierDetection(options: {
  variable_id: string;
  records: Record<string, unknown>[];
  config?: AnalysisConfiguration;
}): OutlierDetectionResultItem {
  const { variable_id, records, config } = options;
  const method = config?.outlier_method || 'IQR';

  const desc = computeDescriptiveNumeric({
    variable_id,
    records,
    missing_tokens: config?.missing_tokens
  });

  if (desc.valid_count === 0) {
    return {
      variable_id,
      method,
      threshold: method === 'IQR' ? config?.iqr_multiplier ?? 1.5 : config?.z_threshold ?? 3.0,
      lower_bound: null,
      upper_bound: null,
      flagged_count: 0,
      flagged_percentage: 0,
      flagged_record_ids: [],
      flagged_values: [],
      notes: 'No valid numeric observations available for outlier detection.'
    };
  }

  let lowerBound: number | null = null;
  let upperBound: number | null = null;
  const flaggedRecordIds: string[] = [];
  const flaggedValues: unknown[] = [];

  if (method === 'IQR') {
    const mult = config?.iqr_multiplier ?? 1.5;
    const q1 = desc.percentile_25!;
    const q3 = desc.percentile_75!;
    const iqr = desc.interquartile_range ?? (q3 - q1);

    lowerBound = q1 - mult * iqr;
    upperBound = q3 + mult * iqr;

    for (let idx = 0; idx < records.length; idx++) {
      const rec = records[idx];
      const rawVal = rec[variable_id];
      if (isMissingValue(rawVal, config?.missing_tokens)) continue;

      const numVal = Number(rawVal);
      if (isNaN(numVal) || !isFinite(numVal)) continue;

      if (numVal < lowerBound || numVal > upperBound) {
        const recordId = String(rec.record_id || rec.id || `row_${idx}`);
        flaggedRecordIds.push(recordId);
        flaggedValues.push(numVal);
      }
    }

    return {
      variable_id,
      method: 'IQR',
      threshold: mult,
      lower_bound: lowerBound,
      upper_bound: upperBound,
      flagged_count: flaggedRecordIds.length,
      flagged_percentage: desc.valid_count > 0 ? (flaggedRecordIds.length / desc.valid_count) * 100 : 0,
      flagged_record_ids: flaggedRecordIds,
      flagged_values: flaggedValues
    };
  } else {
    // Z-Score
    const zThresh = config?.z_threshold ?? 3.0;
    const mean = desc.mean!;
    const std = desc.standard_deviation!;

    if (std === 0) {
      return {
        variable_id,
        method: 'Z_SCORE',
        threshold: zThresh,
        lower_bound: mean,
        upper_bound: mean,
        flagged_count: 0,
        flagged_percentage: 0,
        flagged_record_ids: [],
        flagged_values: [],
        notes: 'Zero variance / constant variable; no Z-score outliers flagged.'
      };
    }

    lowerBound = mean - zThresh * std;
    upperBound = mean + zThresh * std;

    for (let idx = 0; idx < records.length; idx++) {
      const rec = records[idx];
      const rawVal = rec[variable_id];
      if (isMissingValue(rawVal, config?.missing_tokens)) continue;

      const numVal = Number(rawVal);
      if (isNaN(numVal) || !isFinite(numVal)) continue;

      const z = Math.abs((numVal - mean) / std);
      if (z > zThresh) {
        const recordId = String(rec.record_id || rec.id || `row_${idx}`);
        flaggedRecordIds.push(recordId);
        flaggedValues.push(numVal);
      }
    }

    return {
      variable_id,
      method: 'Z_SCORE',
      threshold: zThresh,
      lower_bound: lowerBound,
      upper_bound: upperBound,
      flagged_count: flaggedRecordIds.length,
      flagged_percentage: desc.valid_count > 0 ? (flaggedRecordIds.length / desc.valid_count) * 100 : 0,
      flagged_record_ids: flaggedRecordIds,
      flagged_values: flaggedValues
    };
  }
}
