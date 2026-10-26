/**
 * Phase D10 — Scientific Data Layer: Inferential Statistics & Hypothesis Testing Engine Execution Layer
 *
 * Coordinates hypothesis testing analysis requests, dataset version & artifact binding,
 * record filtering, statistical dispatch (1-sample t, 2-sample t, paired t, Pearson r test, Chi-square),
 * assumption audits, decision rules, provenance registration, and result persistence.
 */

import {
  InferentialAnalysisRequest,
  InferentialAnalysisResult,
  InferentialDecision,
  InferentialExecutionStatus,
  ScientificInferentialAnalysisError,
  assertInferentialAnalysisResult,
  validateInferentialAnalysisRequest
} from './inferentialContracts';
import {
  applyMultipleTestingCorrection,
  calculateCohensD,
  calculateCramersV,
  calculateStudentTPValue,
  calculateTConfidenceInterval,
  chiSquareCDF,
  deriveInferentialDecision,
  normalQuantile,
  studentTCDF
} from './inferentialAnalysis';
import { isMissingValue } from './statisticalAnalysis';
import { evaluateRecordFilters } from './statisticalAnalysis';
import { DatasetVersionStore } from './datasetVersion';
import { DataArtifactStore, deepFreeze } from './dataStatePipeline';
import { VariableStore } from './variableRegistry';
import { VariableMappingStore } from './variableMapping';
import { DataArtifact, DatasetVersion } from '../types';
import { computeProvenanceHash } from '../provenance/provenancePersistence';
import { convertUnit, findUnit } from '../units/unitConverter';

export interface InferentialAnalysisExecuteOptions {
  request: InferentialAnalysisRequest;
  dataset_version_store?: DatasetVersionStore;
  data_artifact_store?: DataArtifactStore;
  variable_store?: VariableStore;
  variable_mapping_store?: VariableMappingStore;
  dataset_version?: DatasetVersion;
  artifact?: DataArtifact;
  records?: Record<string, unknown>[];
}

export class InferentialAnalysisEngine {
  public static readonly ENGINE_VERSION = '1.0.0';

  /**
   * Executes an inferential statistical hypothesis test on a validated dataset artifact.
   */
  public static analyze(options: InferentialAnalysisExecuteOptions): InferentialAnalysisResult {
    const startTime = Date.now();

    // 1. Validate request
    const request = validateInferentialAnalysisRequest(options.request);

    // 2. Resolve DatasetVersion
    let datasetVersion = options.dataset_version;
    if (!datasetVersion && options.dataset_version_store) {
      datasetVersion = options.dataset_version_store.get(request.dataset_version_id);
    }

    if (!datasetVersion) {
      throw new ScientificInferentialAnalysisError(
        'INFERENTIAL_DATASET_NOT_FOUND',
        `DatasetVersion "${request.dataset_version_id}" not found.`
      );
    }

    // 3. Resolve DataArtifact
    let artifact = options.artifact;
    if (!artifact && options.data_artifact_store) {
      artifact = options.data_artifact_store.get(request.data_artifact_id);
    }

    if (!artifact) {
      throw new ScientificInferentialAnalysisError(
        'INFERENTIAL_ARTIFACT_NOT_FOUND',
        `DataArtifact "${request.data_artifact_id}" not found.`
      );
    }

    // 4. Assert Version Binding
    if (artifact.dataset_version_id !== request.dataset_version_id) {
      throw new ScientificInferentialAnalysisError(
        'INFERENTIAL_VERSION_MISMATCH',
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

    const totalRecordsInArtifact = records.length;

    // 6. Apply Filtering
    const filteredRecords = records.filter(rec =>
      evaluateRecordFilters(rec, request.filters, request.filter_group)
    );

    // Validate variable existence in dataset or VariableRegistry
    if (records.length > 0) {
      const sampleRec = records[0];

      // Check dependent variable
      const depInRec = request.dependent_variable in sampleRec;
      const depInReg = options.variable_store ? Boolean(options.variable_store.get(request.dependent_variable)) : false;
      if (!depInRec && !depInReg) {
        throw new ScientificInferentialAnalysisError(
          'INFERENTIAL_VARIABLE_NOT_FOUND',
          `Dependent variable "${request.dependent_variable}" not found in dataset columns or VariableRegistry.`
        );
      }

      // Check grouping variable if specified
      if (request.grouping_variable) {
        const groupInRec = request.grouping_variable in sampleRec;
        const groupInReg = options.variable_store ? Boolean(options.variable_store.get(request.grouping_variable)) : false;
        if (!groupInRec && !groupInReg) {
          throw new ScientificInferentialAnalysisError(
            'INFERENTIAL_GROUP_INVALID',
            `Grouping variable "${request.grouping_variable}" not found in dataset columns or VariableRegistry.`
          );
        }
      }

      // Check paired variable if specified
      if (request.paired_variable) {
        const pairedInRec = request.paired_variable in sampleRec;
        const pairedInReg = options.variable_store ? Boolean(options.variable_store.get(request.paired_variable)) : false;
        if (!pairedInRec && !pairedInReg) {
          throw new ScientificInferentialAnalysisError(
            'INFERENTIAL_VARIABLE_NOT_FOUND',
            `Paired variable "${request.paired_variable}" not found in dataset columns or VariableRegistry.`
          );
        }
      }

      // Check independent variables if specified
      if (request.independent_variables && request.independent_variables.length > 0) {
        for (const indVar of request.independent_variables) {
          const indInRec = indVar in sampleRec;
          const indInReg = options.variable_store ? Boolean(options.variable_store.get(indVar)) : false;
          if (!indInRec && !indInReg) {
            throw new ScientificInferentialAnalysisError(
              'INFERENTIAL_VARIABLE_NOT_FOUND',
              `Independent variable "${indVar}" not found in dataset columns or VariableRegistry.`
            );
          }
        }
      }
    }

    const confidenceLevel = request.confidence_level ?? (1 - request.alpha);
    const warnings: string[] = [];
    let status: InferentialExecutionStatus = 'COMPLETED';

    // Execution outputs
    let sampleInformation: Record<string, unknown> = {};
    let statistic: number | null = null;
    let degreesOfFreedom: number | null = null;
    let pValue: number | null = null;
    let adjustedPValue: number | null = null;
    let effectSize: InferentialAnalysisResult['effect_size'] = null;
    let confidenceInterval: InferentialAnalysisResult['confidence_interval'] = null;
    let assumptions: Record<string, unknown> = {};

    const missingTokens = request.configuration?.missing_tokens;

    // 7. Dispatch Hypothesis Test Routine
    switch (request.test_type) {
      case 'ONE_SAMPLE_T_TEST': {
        const depVar = request.dependent_variable;
        const targetMean = request.null_hypothesis.value ?? 0;

        const validValues: number[] = [];
        let missingCount = 0;

        for (const rec of filteredRecords) {
          const val = rec[depVar];
          if (isMissingValue(val, missingTokens)) {
            missingCount++;
            continue;
          }
          const num = Number(val);
          if (isNaN(num) || !isFinite(num)) {
            missingCount++;
            continue;
          }
          validValues.push(num);
        }

        const n = validValues.length;
        if (n < 2) {
          status = 'INSUFFICIENT_DATA';
          warnings.push('INSUFFICIENT_DATA: One-sample t-test requires at least 2 valid observations.');
          assumptions = { sample_size: n, missing_count: missingCount, variance_status: 'UNDEFINED' };
          sampleInformation = { n, missing_count: missingCount, target_mean: targetMean };
          break;
        }

        const sampleMean = validValues.reduce((a, b) => a + b, 0) / n;
        const sumSqDiff = validValues.reduce((a, b) => a + Math.pow(b - sampleMean, 2), 0);
        const variance = sumSqDiff / (n - 1);
        const sampleStd = Math.sqrt(variance);

        sampleInformation = {
          n,
          missing_count: missingCount,
          sample_mean: sampleMean,
          sample_std: sampleStd,
          target_mean: targetMean
        };

        if (sampleStd === 0) {
          status = 'ASSUMPTION_NOT_ESTABLISHED';
          warnings.push('ASSUMPTION_NOT_ESTABLISHED: Sample has zero variance.');
          assumptions = { sample_size: n, zero_variance: true };
          break;
        }

        const se = sampleStd / Math.sqrt(n);
        statistic = (sampleMean - targetMean) / se;
        degreesOfFreedom = n - 1;
        pValue = calculateStudentTPValue(statistic, degreesOfFreedom, request.alternative_hypothesis.type);

        effectSize = calculateCohensD(sampleMean - targetMean, sampleStd);
        confidenceInterval = calculateTConfidenceInterval({
          estimate: sampleMean,
          se,
          df: degreesOfFreedom,
          confidenceLevel,
          method: 'One-Sample t Confidence Interval'
        });

        assumptions = {
          sample_size: n,
          missing_count: missingCount,
          zero_variance: false,
          normality_assumption: 'ASSUMPTION_NOT_ESTABLISHED'
        };
        break;
      }

      case 'INDEPENDENT_TWO_SAMPLE_T_TEST': {
        const depVar = request.dependent_variable;
        const groupVar = request.grouping_variable || request.independent_variables?.[0];

        if (!groupVar) {
          throw new ScientificInferentialAnalysisError(
            'INFERENTIAL_GROUP_INVALID',
            'Independent two-sample t-test requires "grouping_variable" or "independent_variables[0]".'
          );
        }

        let groupA = request.group_a;
        let groupB = request.group_b;

        // Auto-detect groups if not provided
        if (!groupA || !groupB) {
          const uniqueCats = Array.from(
            new Set(
              filteredRecords
                .map(r => r[groupVar])
                .filter(v => !isMissingValue(v, missingTokens))
                .map(String)
            )
          ).sort();

          if (uniqueCats.length < 2) {
            throw new ScientificInferentialAnalysisError(
              'INFERENTIAL_GROUP_INVALID',
              `Grouping variable "${groupVar}" does not contain at least 2 distinct groups.`
            );
          }
          groupA = groupA || uniqueCats[0];
          groupB = groupB || uniqueCats[1];
        }

        const valsA: number[] = [];
        const valsB: number[] = [];

        for (const rec of filteredRecords) {
          const gVal = String(rec[groupVar]);
          const dVal = rec[depVar];

          if (isMissingValue(dVal, missingTokens) || isMissingValue(rec[groupVar], missingTokens)) {
            continue;
          }

          const num = Number(dVal);
          if (isNaN(num) || !isFinite(num)) continue;

          if (gVal === groupA) valsA.push(num);
          else if (gVal === groupB) valsB.push(num);
        }

        const nA = valsA.length;
        const nB = valsB.length;

        sampleInformation = {
          group_var: groupVar,
          group_a: groupA,
          group_b: groupB,
          n_group_a: nA,
          n_group_b: nB
        };

        if (nA < 2 || nB < 2) {
          status = 'INSUFFICIENT_DATA';
          warnings.push(`INSUFFICIENT_DATA: Independent groups require at least 2 valid observations per group (A=${nA}, B=${nB}).`);
          assumptions = { n_a: nA, n_b: nB, status: 'INSUFFICIENT_DATA' };
          break;
        }

        const meanA = valsA.reduce((a, b) => a + b, 0) / nA;
        const meanB = valsB.reduce((a, b) => a + b, 0) / nB;

        const varA = valsA.reduce((a, b) => a + Math.pow(b - meanA, 2), 0) / (nA - 1);
        const varB = valsB.reduce((a, b) => a + Math.pow(b - meanB, 2), 0) / (nB - 1);

        const stdA = Math.sqrt(varA);
        const stdB = Math.sqrt(varB);

        sampleInformation = {
          ...sampleInformation,
          mean_group_a: meanA,
          mean_group_b: meanB,
          std_group_a: stdA,
          std_group_b: stdB,
          mean_difference: meanA - meanB
        };

        if (stdA === 0 && stdB === 0) {
          status = 'ASSUMPTION_NOT_ESTABLISHED';
          warnings.push('ASSUMPTION_NOT_ESTABLISHED: Both groups have zero variance.');
          assumptions = { zero_variance_both: true };
          break;
        }

        const equalVariance = request.configuration?.equal_variance === true;

        if (equalVariance) {
          // Pooled Equal Variance
          const pooledVar = ((nA - 1) * varA + (nB - 1) * varB) / (nA + nB - 2);
          const pooledStd = Math.sqrt(pooledVar);
          const se = Math.sqrt(pooledVar * (1 / nA + 1 / nB));

          statistic = (meanA - meanB) / se;
          degreesOfFreedom = nA + nB - 2;
          pValue = calculateStudentTPValue(statistic, degreesOfFreedom, request.alternative_hypothesis.type);

          effectSize = calculateCohensD(meanA - meanB, pooledStd);
          confidenceInterval = calculateTConfidenceInterval({
            estimate: meanA - meanB,
            se,
            df: degreesOfFreedom,
            confidenceLevel,
            method: 'Equal-Variance Two-Sample t Confidence Interval'
          });
        } else {
          // Welch's t-test (Default)
          const se = Math.sqrt(varA / nA + varB / nB);
          statistic = (meanA - meanB) / se;

          // Welch-Satterthwaite df
          const numDf = Math.pow(varA / nA + varB / nB, 2);
          const denDf = Math.pow(varA / nA, 2) / (nA - 1) + Math.pow(varB / nB, 2) / (nB - 1);
          degreesOfFreedom = denDf > 0 ? numDf / denDf : nA + nB - 2;

          pValue = calculateStudentTPValue(statistic, degreesOfFreedom, request.alternative_hypothesis.type);

          const pooledStd = Math.sqrt(((nA - 1) * varA + (nB - 1) * varB) / (nA + nB - 2));
          effectSize = calculateCohensD(meanA - meanB, pooledStd);
          confidenceInterval = calculateTConfidenceInterval({
            estimate: meanA - meanB,
            se,
            df: degreesOfFreedom,
            confidenceLevel,
            method: "Welch's Two-Sample t Confidence Interval"
          });
        }

        assumptions = {
          n_a: nA,
          n_b: nB,
          equal_variance_assumed: equalVariance,
          variance_a: varA,
          variance_b: varB,
          normality_assumption: 'ASSUMPTION_NOT_ESTABLISHED'
        };
        break;
      }

      case 'PAIRED_T_TEST': {
        const varA = request.dependent_variable;
        const varB = request.paired_variable || request.independent_variables?.[0];

        if (!varB) {
          throw new ScientificInferentialAnalysisError(
            'INFERENTIAL_PAIRING_INVALID',
            'Paired t-test requires "paired_variable" or "independent_variables[0]".'
          );
        }

        // Verify dimensional unit compatibility
        if (options.variable_store) {
          const vA = options.variable_store.get(varA);
          const vB = options.variable_store.get(varB);
          if (vA?.unit && vB?.unit) {
            const defA = findUnit(vA.unit);
            const defB = findUnit(vB.unit);
            if (defA && defB && defA.measurement_type !== defB.measurement_type) {
              throw new ScientificInferentialAnalysisError(
                'INFERENTIAL_UNIT_MISMATCH',
                `Incompatible dimensions for paired t-test: "${varA}" (${defA.measurement_type}) vs "${varB}" (${defB.measurement_type}).`
              );
            }
          }
        }

        const pairedKey = request.configuration?.paired_key;
        const pairs: Array<{ a: number; b: number; diff: number }> = [];

        if (pairedKey) {
          // Explicit pairing by key
          const mapA = new Map<string, number>();
          const mapB = new Map<string, number>();

          for (const rec of filteredRecords) {
            const keyVal = rec[pairedKey];
            if (isMissingValue(keyVal, missingTokens)) continue;
            const kStr = String(keyVal);

            const vA = rec[varA];
            const vB = rec[varB];

            if (!isMissingValue(vA, missingTokens) && !isNaN(Number(vA))) {
              mapA.set(kStr, Number(vA));
            }
            if (!isMissingValue(vB, missingTokens) && !isNaN(Number(vB))) {
              mapB.set(kStr, Number(vB));
            }
          }

          for (const [k, valA] of mapA.entries()) {
            if (mapB.has(k)) {
              const valB = mapB.get(k)!;
              pairs.push({ a: valA, b: valB, diff: valA - valB });
            }
          }
        } else {
          // In-record pairing
          for (const rec of filteredRecords) {
            const valA = rec[varA];
            const valB = rec[varB];

            if (isMissingValue(valA, missingTokens) || isMissingValue(valB, missingTokens)) {
              continue;
            }

            const numA = Number(valA);
            const numB = Number(valB);

            if (!isNaN(numA) && isFinite(numA) && !isNaN(numB) && isFinite(numB)) {
              pairs.push({ a: numA, b: numB, diff: numA - numB });
            }
          }
        }

        const nPairs = pairs.length;
        sampleInformation = { n_pairs: nPairs, variable_a: varA, variable_b: varB, paired_key: pairedKey || 'IN_RECORD' };

        if (nPairs < 2) {
          status = 'INSUFFICIENT_DATA';
          warnings.push('INSUFFICIENT_DATA: Paired t-test requires at least 2 valid paired observations.');
          assumptions = { n_pairs: nPairs, status: 'INSUFFICIENT_DATA' };
          break;
        }

        const diffs = pairs.map(p => p.diff);
        const meanDiff = diffs.reduce((a, b) => a + b, 0) / nPairs;
        const sumSqDiff = diffs.reduce((a, b) => a + Math.pow(b - meanDiff, 2), 0);
        const varDiff = sumSqDiff / (nPairs - 1);
        const stdDiff = Math.sqrt(varDiff);

        sampleInformation = {
          ...sampleInformation,
          mean_a: pairs.reduce((a, b) => a + b.a, 0) / nPairs,
          mean_b: pairs.reduce((a, b) => a + b.b, 0) / nPairs,
          mean_difference: meanDiff,
          std_difference: stdDiff
        };

        if (stdDiff === 0) {
          status = 'ASSUMPTION_NOT_ESTABLISHED';
          warnings.push('ASSUMPTION_NOT_ESTABLISHED: Paired differences have zero variance.');
          assumptions = { zero_variance_diff: true };
          break;
        }

        const seDiff = stdDiff / Math.sqrt(nPairs);
        statistic = meanDiff / seDiff;
        degreesOfFreedom = nPairs - 1;
        pValue = calculateStudentTPValue(statistic, degreesOfFreedom, request.alternative_hypothesis.type);

        effectSize = calculateCohensD(meanDiff, stdDiff);
        confidenceInterval = calculateTConfidenceInterval({
          estimate: meanDiff,
          se: seDiff,
          df: degreesOfFreedom,
          confidenceLevel,
          method: 'Paired Difference Confidence Interval'
        });

        assumptions = {
          n_pairs: nPairs,
          paired_integrity: 'VERIFIED',
          zero_variance_diff: false,
          normality_assumption: 'ASSUMPTION_NOT_ESTABLISHED'
        };
        break;
      }

      case 'PEARSON_CORRELATION_TEST': {
        const var1 = request.dependent_variable;
        const var2 = request.paired_variable || request.independent_variables?.[0];

        if (!var2) {
          throw new ScientificInferentialAnalysisError(
            'INFERENTIAL_VARIABLE_NOT_FOUND',
            'Pearson correlation test requires "independent_variables[0]" or "paired_variable".'
          );
        }

        const pairs: Array<{ x: number; y: number }> = [];

        for (const rec of filteredRecords) {
          const v1 = rec[var1];
          const v2 = rec[var2];

          if (isMissingValue(v1, missingTokens) || isMissingValue(v2, missingTokens)) continue;

          const n1 = Number(v1);
          const n2 = Number(v2);

          if (!isNaN(n1) && isFinite(n1) && !isNaN(n2) && isFinite(n2)) {
            pairs.push({ x: n1, y: n2 });
          }
        }

        const n = pairs.length;
        sampleInformation = { n, var1, var2 };

        if (n < 3) {
          status = 'INSUFFICIENT_DATA';
          warnings.push('INSUFFICIENT_DATA: Pearson correlation test requires at least 3 paired observations (df >= 1).');
          assumptions = { n, status: 'INSUFFICIENT_DATA' };
          break;
        }

        const meanX = pairs.reduce((a, b) => a + b.x, 0) / n;
        const meanY = pairs.reduce((a, b) => a + b.y, 0) / n;

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
          status = 'ASSUMPTION_NOT_ESTABLISHED';
          warnings.push('ASSUMPTION_NOT_ESTABLISHED: One or both variables have zero variance (constant value).');
          assumptions = { zero_variance: true };
          break;
        }

        let r = num / Math.sqrt(denX * denY);
        if (r > 1) r = 1;
        if (r < -1) r = -1;

        degreesOfFreedom = n - 2;

        if (Math.abs(r) === 1) {
          statistic = r * Infinity;
          pValue = 0;
        } else {
          statistic = (r * Math.sqrt(n - 2)) / Math.sqrt(1 - r * r);
          pValue = calculateStudentTPValue(statistic, degreesOfFreedom, request.alternative_hypothesis.type);
        }

        effectSize = { metric: 'PEARSON_R', value: r };

        // Fisher's z CI for Pearson r
        if (Math.abs(r) < 1 && n > 3) {
          const z = 0.5 * Math.log((1 + r) / (1 - r));
          const seZ = 1 / Math.sqrt(n - 3);
          const zAlpha = Math.abs(normalQuantile(1 - (1 - confidenceLevel) / 2));

          const zLower = z - zAlpha * seZ;
          const zUpper = z + zAlpha * seZ;

          const rLower = (Math.exp(2 * zLower) - 1) / (Math.exp(2 * zLower) + 1);
          const rUpper = (Math.exp(2 * zUpper) - 1) / (Math.exp(2 * zUpper) + 1);

          confidenceInterval = {
            confidence_level: confidenceLevel,
            lower_bound: rLower,
            upper_bound: rUpper,
            method: "Fisher's z-Transformation Confidence Interval"
          };
        }

        sampleInformation = { ...sampleInformation, pearson_r: r };
        assumptions = { n, degrees_of_freedom: degreesOfFreedom, zero_variance: false };
        break;
      }

      case 'CHI_SQUARE_INDEPENDENCE': {
        const var1 = request.dependent_variable;
        const var2 = request.grouping_variable || request.independent_variables?.[0];

        if (!var2) {
          throw new ScientificInferentialAnalysisError(
            'INFERENTIAL_VARIABLE_NOT_FOUND',
            'Chi-Square test of independence requires "grouping_variable" or "independent_variables[0]".'
          );
        }

        const cat1Set = new Set<string>();
        const cat2Set = new Set<string>();
        const validPairs: Array<{ v1: string; v2: string }> = [];

        for (const rec of filteredRecords) {
          const raw1 = rec[var1];
          const raw2 = rec[var2];

          if (isMissingValue(raw1, missingTokens) || isMissingValue(raw2, missingTokens)) continue;

          const s1 = String(raw1).trim();
          const s2 = String(raw2).trim();

          cat1Set.add(s1);
          cat2Set.add(s2);
          validPairs.push({ v1: s1, v2: s2 });
        }

        const rows = Array.from(cat1Set).sort();
        const cols = Array.from(cat2Set).sort();
        const N = validPairs.length;

        if (rows.length < 2 || cols.length < 2 || N === 0) {
          status = 'INSUFFICIENT_DATA';
          warnings.push(`INSUFFICIENT_DATA: Chi-square test requires at least 2 categories per variable (R=${rows.length}, C=${cols.length}, N=${N}).`);
          assumptions = { rows: rows.length, cols: cols.length, N, status: 'INSUFFICIENT_DATA' };
          break;
        }

        const observed: number[][] = rows.map(() => new Array(cols.length).fill(0));
        for (const p of validPairs) {
          const rIdx = rows.indexOf(p.v1);
          const cIdx = cols.indexOf(p.v2);
          if (rIdx >= 0 && cIdx >= 0) {
            observed[rIdx][cIdx]++;
          }
        }

        const rowTotals = observed.map(row => row.reduce((a, b) => a + b, 0));
        const colTotals = cols.map((_, cIdx) => observed.reduce((acc, row) => acc + row[cIdx], 0));

        let chi2 = 0;
        let cellsWithExpLessThan5 = 0;
        let minExp = Infinity;

        const expected: number[][] = rows.map(() => new Array(cols.length).fill(0));

        for (let i = 0; i < rows.length; i++) {
          for (let j = 0; j < cols.length; j++) {
            const exp = (rowTotals[i] * colTotals[j]) / N;
            expected[i][j] = exp;
            if (exp < minExp) minExp = exp;
            if (exp < 5) cellsWithExpLessThan5++;

            if (exp > 0) {
              chi2 += Math.pow(observed[i][j] - exp, 2) / exp;
            }
          }
        }

        const totalCells = rows.length * cols.length;
        const pctExpLessThan5 = (cellsWithExpLessThan5 / totalCells) * 100;

        if (minExp < 1 || pctExpLessThan5 > 20) {
          status = 'ASSUMPTION_NOT_ESTABLISHED';
          warnings.push(`ASSUMPTION_NOT_ESTABLISHED: Expected frequencies violated (min_exp=${minExp.toFixed(2)}, cells < 5: ${pctExpLessThan5.toFixed(1)}%).`);
        }

        statistic = chi2;
        degreesOfFreedom = (rows.length - 1) * (cols.length - 1);
        pValue = 1 - chiSquareCDF(chi2, degreesOfFreedom);

        effectSize = calculateCramersV(chi2, N, rows.length, cols.length);

        sampleInformation = {
          n: N,
          rows: rows.length,
          cols: cols.length,
          row_categories: rows,
          col_categories: cols,
          contingency_table: observed,
          expected_frequencies: expected
        };

        assumptions = {
          n: N,
          min_expected_frequency: minExp,
          pct_cells_expected_less_than_5: pctExpLessThan5,
          degrees_of_freedom: degreesOfFreedom
        };
        break;
      }

      default:
        throw new ScientificInferentialAnalysisError(
          'INFERENTIAL_INVALID_CONTRACT',
          `Unhandled test type "${request.test_type}".`
        );
    }

    // 8. Derive Statistical Decision
    const decision: InferentialDecision = deriveInferentialDecision(pValue, request.alpha);

    // 9. Multiple Testing Adjustment (if configured)
    if (pValue !== null && request.configuration?.multiple_testing_method) {
      const adjustedArr = applyMultipleTestingCorrection([pValue], request.configuration.multiple_testing_method);
      adjustedPValue = adjustedArr[0];
    }

    const durationMs = Date.now() - startTime;

    // 10. Generate Cryptographic Provenance Reference Hash
    const provenanceData = {
      analysis_id: request.analysis_id,
      dataset_version_id: request.dataset_version_id,
      data_artifact_id: request.data_artifact_id,
      source_artifact_checksum: artifact.checksum || null,
      test_type: request.test_type,
      variables: {
        dependent_variable: request.dependent_variable,
        independent_variables: request.independent_variables || [],
        paired_variable: request.paired_variable || null,
        grouping_variable: request.grouping_variable || null,
        group_a: request.group_a || null,
        group_b: request.group_b || null
      },
      null_hypothesis: request.null_hypothesis,
      alternative_hypothesis: request.alternative_hypothesis,
      alpha: request.alpha,
      confidence_level: confidenceLevel,
      filters: request.filters || [],
      filter_group: request.filter_group || null,
      configuration: request.configuration || {},
      filtered_record_count: filteredRecords.length,
      result: {
        statistic,
        degrees_of_freedom: degreesOfFreedom,
        p_value: pValue,
        decision,
        status
      },
      engine_version: InferentialAnalysisEngine.ENGINE_VERSION
    };

    const checksum = computeProvenanceHash(provenanceData);

    const result: InferentialAnalysisResult = {
      analysis_id: request.analysis_id,
      dataset_version_id: request.dataset_version_id,
      data_artifact_id: request.data_artifact_id,
      test_type: request.test_type,
      variables: {
        dependent_variable: request.dependent_variable,
        independent_variables: request.independent_variables,
        paired_variable: request.paired_variable,
        grouping_variable: request.grouping_variable,
        group_a: request.group_a,
        group_b: request.group_b
      },
      hypotheses: {
        null_hypothesis: request.null_hypothesis,
        alternative_hypothesis: request.alternative_hypothesis
      },
      alpha: request.alpha,
      confidence_level: confidenceLevel,
      sample_information: sampleInformation,
      statistic,
      degrees_of_freedom: degreesOfFreedom,
      p_value: pValue,
      adjusted_p_value: adjustedPValue,
      effect_size: effectSize,
      confidence_interval: confidenceInterval,
      assumptions,
      decision,
      warnings,
      status,
      scientific_validity: 'NOT_ESTABLISHED',
      engine_version: InferentialAnalysisEngine.ENGINE_VERSION,
      provenance_reference: checksum,
      created_at: new Date().toISOString(),
      checksum
    };

    return assertInferentialAnalysisResult(result);
  }
}

/**
 * In-memory repository for saving, retrieving, and searching InferentialAnalysisResult objects.
 */
export class InferentialAnalysisResultStore {
  private readonly store = new Map<string, InferentialAnalysisResult>();

  public save(result: InferentialAnalysisResult): InferentialAnalysisResult {
    const verified = assertInferentialAnalysisResult(result);
    this.store.set(verified.analysis_id, verified);
    return verified;
  }

  public get(analysis_id: string): InferentialAnalysisResult | undefined {
    return this.store.get(analysis_id);
  }

  public has(analysis_id: string): boolean {
    return this.store.has(analysis_id);
  }

  public list(): InferentialAnalysisResult[] {
    return Array.from(this.store.values());
  }

  public findByDatasetVersion(dataset_version_id: string): InferentialAnalysisResult[] {
    return this.list().filter(r => r.dataset_version_id === dataset_version_id);
  }

  public findByArtifact(data_artifact_id: string): InferentialAnalysisResult[] {
    return this.list().filter(r => r.data_artifact_id === data_artifact_id);
  }

  public clear(): void {
    this.store.clear();
  }
}
