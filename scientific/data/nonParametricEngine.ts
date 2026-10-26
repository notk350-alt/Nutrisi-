/**
 * Phase D13 — Scientific Data Layer: Non-Parametric & Robust Engine Execution Layer
 *
 * Coordinates non-parametric analysis requests, dataset version & artifact binding,
 * record filtering, unit verification, statistical procedure dispatch, assumption audits,
 * statistical decisions, provenance registration, and result deep-freezing.
 */

import { DatasetVersionStore } from './datasetVersion';
import { DataArtifactStore } from './dataStatePipeline';
import { VariableStore } from './variableRegistry';
import { VariableMappingStore } from './variableMapping';
import { DataArtifact, DatasetVersion } from '../types';
import { computeProvenanceHash } from '../provenance/provenancePersistence';
import { findUnit } from '../units/unitConverter';
import { evaluateRecordFilters, isMissingValue } from './statisticalAnalysis';
import {
  computeFisherExact,
  computeFriedman,
  computeKruskalWallis,
  computeMannWhitneyU,
  computeSpearmanCorrelation,
  computeWilcoxonSignedRank
} from './nonParametricAnalysis';
import {
  createNonParametricResult,
  NonParametricAnalysisRequest,
  NonParametricAnalysisResult,
  NonParametricContingencyTable,
  NonParametricExecutionStatus,
  NonParametricSampleInfo,
  ScientificNonParametricError,
  validateNonParametricRequest
} from './nonParametricContracts';

export interface NonParametricExecuteOptions {
  request: NonParametricAnalysisRequest;
  dataset_version_store?: DatasetVersionStore;
  data_artifact_store?: DataArtifactStore;
  variable_store?: VariableStore;
  variable_mapping_store?: VariableMappingStore;
  dataset_version?: DatasetVersion;
  artifact?: DataArtifact;
  records?: Record<string, unknown>[];
}

export class NonParametricEngine {
  public static readonly ENGINE_VERSION = '1.0.0';

  /**
   * Main entry point to execute a NonParametricAnalysisRequest.
   */
  public static analyze(options: NonParametricExecuteOptions): NonParametricAnalysisResult {
    const executedAt = new Date().toISOString();
    const engineVersion = options.request.engine_version || NonParametricEngine.ENGINE_VERSION;

    // 1. Validate request structure
    const validation = validateNonParametricRequest(options.request);
    if (!validation.valid) {
      throw new ScientificNonParametricError(
        'NONPARAMETRIC_UNSUPPORTED_CONFIGURATION',
        `Invalid request: ${validation.errors.join('; ')}`
      );
    }

    const request = options.request;

    // 2. Resolve DatasetVersion
    let datasetVersion = options.dataset_version;
    if (!datasetVersion && options.dataset_version_store) {
      datasetVersion = options.dataset_version_store.get(request.dataset_version_id);
    }

    if (!datasetVersion) {
      throw new ScientificNonParametricError(
        'NONPARAMETRIC_DATASET_NOT_FOUND',
        `DatasetVersion "${request.dataset_version_id}" not found.`
      );
    }

    // 3. Resolve DataArtifact
    let artifact = options.artifact;
    if (!artifact && options.data_artifact_store) {
      artifact = options.data_artifact_store.get(request.data_artifact_id);
    }

    if (!artifact) {
      throw new ScientificNonParametricError(
        'NONPARAMETRIC_ARTIFACT_NOT_FOUND',
        `DataArtifact "${request.data_artifact_id}" not found.`
      );
    }

    // 4. Assert Version Binding
    if (artifact.dataset_version_id !== request.dataset_version_id) {
      throw new ScientificNonParametricError(
        'NONPARAMETRIC_VERSION_MISMATCH',
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
    const filteredRecords = records.filter((rec) =>
      evaluateRecordFilters(rec, request.filters, request.filter_group)
    );

    const missingTokens = request.configuration?.missing_tokens;
    const isDirectFisherObserved = request.test_type === 'FISHER_EXACT' && Boolean(request.configuration?.metadata?.observed);

    // 7. Verify Variables in Registry / Sample Records
    if (records.length > 0 && !isDirectFisherObserved) {
      const sampleRec = records[0];

      const depInRec = request.dependent_variable in sampleRec;
      const depInReg = options.variable_store ? Boolean(options.variable_store.get(request.dependent_variable)) : false;
      if (!depInRec && !depInReg) {
        throw new ScientificNonParametricError(
          'NONPARAMETRIC_VARIABLE_NOT_FOUND',
          `Dependent variable "${request.dependent_variable}" not found in dataset columns or VariableRegistry.`
        );
      }

      if (request.grouping_variable) {
        const groupInRec = request.grouping_variable in sampleRec;
        const groupInReg = options.variable_store ? Boolean(options.variable_store.get(request.grouping_variable)) : false;
        if (!groupInRec && !groupInReg) {
          throw new ScientificNonParametricError(
            'NONPARAMETRIC_GROUP_INVALID',
            `Grouping variable "${request.grouping_variable}" not found in dataset columns or VariableRegistry.`
          );
        }
      }

      if (request.paired_variable) {
        const pairedInRec = request.paired_variable in sampleRec;
        const pairedInReg = options.variable_store ? Boolean(options.variable_store.get(request.paired_variable)) : false;
        if (!pairedInRec && !pairedInReg) {
          throw new ScientificNonParametricError(
            'NONPARAMETRIC_VARIABLE_NOT_FOUND',
            `Paired variable "${request.paired_variable}" not found in dataset columns or VariableRegistry.`
          );
        }

        // Unit compatibility verification for paired variables
        if (options.variable_store) {
          const var1 = options.variable_store.get(request.dependent_variable);
          const var2 = options.variable_store.get(request.paired_variable);
          if (var1 && var2 && var1.unit && var2.unit) {
            const u1 = findUnit(var1.unit);
            const u2 = findUnit(var2.unit);
            if (u1 && u2 && u1.measurement_type !== u2.measurement_type) {
              throw new ScientificNonParametricError(
                'NONPARAMETRIC_UNIT_MISMATCH',
                `Unit mismatch between "${request.dependent_variable}" (${var1.unit}, type: ${u1.measurement_type}) and "${request.paired_variable}" (${var2.unit}, type: ${u2.measurement_type}).`
              );
            }
          }
        }
      }
    }

    const assumptionAudit: string[] = [
      `Alpha significance level = ${request.alpha}`,
      `Alternative hypothesis = ${request.alternative_hypothesis.type}`,
      `Data artifact pinned = ${request.data_artifact_id}`,
      `Dataset version pinned = ${request.dataset_version_id}`
    ];
    const warnings: string[] = [];

    let testStat: number | null = null;
    let df: number | null = null;
    let pValue: number | null = null;
    let decision: 'REJECT_NULL' | 'DO_NOT_REJECT_NULL' | null = null;
    let effectSize: { metric: string; value: number | null } | null = null;
    let contingencyTable: NonParametricContingencyTable | null = null;
    let executionStatus: NonParametricExecutionStatus = 'COMPLETED';

    const sampleInfo: NonParametricSampleInfo = {
      total_records: totalRecordsInArtifact,
      valid_observations: 0,
      missing_observations: 0,
      excluded_observations: totalRecordsInArtifact - filteredRecords.length
    };

    const altType = request.alternative_hypothesis.type;

    // 8. Dispatch Test Implementation
    switch (request.test_type) {
      case 'MANN_WHITNEY_U': {
        const groupVar = request.grouping_variable || (request.independent_variables && request.independent_variables[0]);
        if (!groupVar) {
          throw new ScientificNonParametricError(
            'NONPARAMETRIC_GROUP_INVALID',
            'Mann-Whitney U test requires a grouping_variable or independent_variables[0].'
          );
        }

        const groupAKey = request.group_a || request.configuration?.group_a || 'A';
        const groupBKey = request.group_b || request.configuration?.group_b || 'B';

        const groupAVals: number[] = [];
        const groupBVals: number[] = [];
        let missingCount = 0;

        for (const rec of filteredRecords) {
          const depVal = rec[request.dependent_variable];
          const grpVal = rec[groupVar];

          if (isMissingValue(depVal, missingTokens) || isMissingValue(grpVal, missingTokens)) {
            missingCount++;
            continue;
          }

          const numVal = Number(depVal);
          const grpStr = String(grpVal);

          if (!Number.isFinite(numVal)) {
            missingCount++;
            continue;
          }

          if (grpStr === groupAKey) {
            groupAVals.push(numVal);
          } else if (grpStr === groupBKey) {
            groupBVals.push(numVal);
          }
        }

        sampleInfo.valid_observations = groupAVals.length + groupBVals.length;
        sampleInfo.missing_observations = missingCount;
        sampleInfo.group_sizes = { [groupAKey]: groupAVals.length, [groupBKey]: groupBVals.length };

        if (groupAVals.length === 0 || groupBVals.length === 0) {
          executionStatus = 'INSUFFICIENT_DATA';
          warnings.push('Insufficient observations in one or both groups for Mann-Whitney U test');
          break;
        }

        const mwRes = computeMannWhitneyU(groupAVals, groupBVals, altType);
        testStat = mwRes.uStatistic;
        pValue = mwRes.pValue;
        effectSize = { metric: 'RANK_BISERIAL_R', value: mwRes.effectSize };
        sampleInfo.tie_count = mwRes.tieCount;

        assumptionAudit.push('Independent two-group non-parametric rank sum test evaluated');
        if (mwRes.tieCount > 0) {
          assumptionAudit.push(`Tie correction applied across ${mwRes.tieCount} tied values`);
        }
        break;
      }

      case 'WILCOXON_SIGNED_RANK': {
        const pairs: { x: number; y: number }[] = [];
        let missingCount = 0;

        if (request.paired_variable) {
          for (const rec of filteredRecords) {
            const val1 = rec[request.dependent_variable];
            const val2 = rec[request.paired_variable];

            if (isMissingValue(val1, missingTokens) || isMissingValue(val2, missingTokens)) {
              missingCount++;
              continue;
            }

            const num1 = Number(val1);
            const num2 = Number(val2);

            if (!Number.isFinite(num1) || !Number.isFinite(num2)) {
              missingCount++;
              continue;
            }

            pairs.push({ x: num1, y: num2 });
          }
        } else if (request.configuration?.paired_key && request.grouping_variable) {
          const pairedKey = request.configuration.paired_key;
          const groupVar = request.grouping_variable;
          const groupAKey = request.group_a || request.configuration?.group_a || 'A';
          const groupBKey = request.group_b || request.configuration?.group_b || 'B';

          const mapA = new Map<string, number>();
          const mapB = new Map<string, number>();

          for (const rec of filteredRecords) {
            const key = rec[pairedKey];
            const depVal = rec[request.dependent_variable];
            const grpVal = rec[groupVar];

            if (isMissingValue(key) || isMissingValue(depVal, missingTokens) || isMissingValue(grpVal, missingTokens)) {
              missingCount++;
              continue;
            }

            const keyStr = String(key);
            const numVal = Number(depVal);
            const grpStr = String(grpVal);

            if (!Number.isFinite(numVal)) {
              missingCount++;
              continue;
            }

            if (grpStr === groupAKey) {
              if (mapA.has(keyStr)) {
                throw new ScientificNonParametricError(
                  'NONPARAMETRIC_PAIRING_INVALID',
                  `Duplicate paired_key "${keyStr}" detected in group A.`
                );
              }
              mapA.set(keyStr, numVal);
            } else if (grpStr === groupBKey) {
              if (mapB.has(keyStr)) {
                throw new ScientificNonParametricError(
                  'NONPARAMETRIC_PAIRING_INVALID',
                  `Duplicate paired_key "${keyStr}" detected in group B.`
                );
              }
              mapB.set(keyStr, numVal);
            }
          }

          for (const [k, vA] of mapA.entries()) {
            if (mapB.has(k)) {
              pairs.push({ x: vA, y: mapB.get(k)! });
            } else {
              missingCount++;
            }
          }
        } else {
          throw new ScientificNonParametricError(
            'NONPARAMETRIC_PAIRING_INVALID',
            'Wilcoxon signed-rank test requires paired_variable or (paired_key and grouping_variable).'
          );
        }

        sampleInfo.valid_observations = pairs.length * 2;
        sampleInfo.missing_observations = missingCount;

        if (pairs.length === 0) {
          executionStatus = 'INSUFFICIENT_DATA';
          warnings.push('Zero valid paired observations available for Wilcoxon signed-rank test');
          break;
        }

        const wilcRes = computeWilcoxonSignedRank(pairs, altType);
        testStat = wilcRes.wStatistic;
        pValue = wilcRes.pValue;
        effectSize = { metric: 'MATCHED_PAIRS_R', value: wilcRes.effectSize };
        sampleInfo.zero_differences_removed = wilcRes.zeroDifferencesRemoved;
        sampleInfo.tie_count = wilcRes.tieCount;

        assumptionAudit.push(`Paired non-parametric signed rank test across ${wilcRes.effectivePairs} non-zero difference pairs`);
        if (wilcRes.zeroDifferencesRemoved > 0) {
          assumptionAudit.push(`Explicitly removed ${wilcRes.zeroDifferencesRemoved} zero difference pairs`);
        }
        break;
      }

      case 'KRUSKAL_WALLIS': {
        const groupVar = request.grouping_variable || (request.independent_variables && request.independent_variables[0]);
        if (!groupVar) {
          throw new ScientificNonParametricError(
            'NONPARAMETRIC_GROUP_INVALID',
            'Kruskal-Wallis test requires grouping_variable or independent_variables[0].'
          );
        }

        const groupsData: Record<string, number[]> = {};
        let missingCount = 0;

        for (const rec of filteredRecords) {
          const depVal = rec[request.dependent_variable];
          const grpVal = rec[groupVar];

          if (isMissingValue(depVal, missingTokens) || isMissingValue(grpVal, missingTokens)) {
            missingCount++;
            continue;
          }

          const numVal = Number(depVal);
          const grpStr = String(grpVal);

          if (!Number.isFinite(numVal)) {
            missingCount++;
            continue;
          }

          if (!groupsData[grpStr]) {
            groupsData[grpStr] = [];
          }
          groupsData[grpStr].push(numVal);
        }

        const keys = Object.keys(groupsData);
        if (keys.length < 2) {
          executionStatus = 'INSUFFICIENT_DATA';
          warnings.push('Kruskal-Wallis test requires at least 2 distinct independent groups with data');
          sampleInfo.missing_observations = missingCount;
          break;
        }

        const kwRes = computeKruskalWallis(groupsData);
        testStat = kwRes.hAdjusted;
        df = kwRes.degreesOfFreedom;
        pValue = kwRes.pValue;
        effectSize = { metric: 'ETA_SQUARED_H', value: kwRes.effectSize };
        sampleInfo.valid_observations = kwRes.totalObservations;
        sampleInfo.missing_observations = missingCount;
        sampleInfo.group_sizes = kwRes.groupSizes;
        sampleInfo.tie_count = kwRes.tieCount;

        assumptionAudit.push(`Kruskal-Wallis omnibus non-parametric ANOVA evaluated across ${keys.length} groups`);
        break;
      }

      case 'FRIEDMAN': {
        const blockVar = request.block_variable || request.configuration?.block_variable || request.configuration?.paired_key;
        const indVars = request.independent_variables;

        if (!blockVar) {
          throw new ScientificNonParametricError(
            'NONPARAMETRIC_UNSUPPORTED_CONFIGURATION',
            'Friedman test requires block_variable or configuration.paired_key.'
          );
        }

        let matrix: number[][] = [];

        if (indVars && indVars.length >= 3) {
          // Conditions are columns in the record
          const blockMap = new Map<string, number[]>();
          let missingCount = 0;

          for (const rec of filteredRecords) {
            const blkVal = rec[blockVar];
            if (isMissingValue(blkVal, missingTokens)) {
              missingCount++;
              continue;
            }
            const blkKey = String(blkVal);

            const rowVals: number[] = [];
            let validRow = true;

            for (const indV of indVars) {
              const v = rec[indV];
              if (isMissingValue(v, missingTokens) || !Number.isFinite(Number(v))) {
                validRow = false;
                break;
              }
              rowVals.push(Number(v));
            }

            if (validRow) {
              blockMap.set(blkKey, rowVals);
            } else {
              missingCount++;
            }
          }

          matrix = Array.from(blockMap.values());
          sampleInfo.missing_observations = missingCount;
        } else if (request.grouping_variable) {
          const groupVar = request.grouping_variable;
          const blockMap = new Map<string, Map<string, number>>();
          const allConditions = new Set<string>();

          for (const rec of filteredRecords) {
            const blkVal = rec[blockVar];
            const grpVal = rec[groupVar];
            const depVal = rec[request.dependent_variable];

            if (isMissingValue(blkVal, missingTokens) || isMissingValue(grpVal, missingTokens) || isMissingValue(depVal, missingTokens)) {
              continue;
            }

            const blkStr = String(blkVal);
            const grpStr = String(grpVal);
            const numVal = Number(depVal);

            if (!Number.isFinite(numVal)) continue;

            allConditions.add(grpStr);
            if (!blockMap.has(blkStr)) {
              blockMap.set(blkStr, new Map());
            }
            blockMap.get(blkStr)!.set(grpStr, numVal);
          }

          const condList = Array.from(allConditions).sort();
          if (condList.length < 3) {
            executionStatus = 'INSUFFICIENT_DATA';
            warnings.push('Friedman test requires at least 3 distinct conditions');
            break;
          }

          for (const [_, condMap] of blockMap.entries()) {
            if (condMap.size === condList.length) {
              const row = condList.map((c) => condMap.get(c)!);
              matrix.push(row);
            }
          }
        } else {
          throw new ScientificNonParametricError(
            'NONPARAMETRIC_UNSUPPORTED_CONFIGURATION',
            'Friedman test requires independent_variables (>= 3 columns) or grouping_variable.'
          );
        }

        if (matrix.length === 0) {
          executionStatus = 'INSUFFICIENT_DATA';
          warnings.push('No complete blocks found for Friedman test');
          break;
        }

        const friedRes = computeFriedman(matrix);
        testStat = friedRes.qStatistic;
        df = friedRes.degreesOfFreedom;
        pValue = friedRes.pValue;
        effectSize = { metric: 'KENDALLS_W', value: friedRes.effectSize };
        sampleInfo.total_records = totalRecordsInArtifact;
        sampleInfo.complete_blocks = friedRes.completeBlocks;
        sampleInfo.incomplete_blocks_excluded = friedRes.excludedBlocks;
        sampleInfo.valid_observations = friedRes.completeBlocks * friedRes.conditionCount;

        assumptionAudit.push(`Friedman repeated-measures non-parametric test evaluated across ${friedRes.completeBlocks} complete blocks`);
        break;
      }

      case 'SPEARMAN_CORRELATION': {
        const otherVar = (request.independent_variables && request.independent_variables[0]) || request.paired_variable;
        if (!otherVar) {
          throw new ScientificNonParametricError(
            'NONPARAMETRIC_VARIABLE_NOT_FOUND',
            'Spearman correlation requires independent_variables[0] or paired_variable.'
          );
        }

        const xVals: number[] = [];
        const yVals: number[] = [];
        let missingCount = 0;

        for (const rec of filteredRecords) {
          const v1 = rec[request.dependent_variable];
          const v2 = rec[otherVar];

          if (isMissingValue(v1, missingTokens) || isMissingValue(v2, missingTokens)) {
            missingCount++;
            continue;
          }

          const n1 = Number(v1);
          const n2 = Number(v2);

          if (!Number.isFinite(n1) || !Number.isFinite(n2)) {
            missingCount++;
            continue;
          }

          xVals.push(n1);
          yVals.push(n2);
        }

        sampleInfo.valid_observations = xVals.length;
        sampleInfo.missing_observations = missingCount;

        if (xVals.length < 3) {
          executionStatus = 'INSUFFICIENT_DATA';
          warnings.push('Spearman correlation requires at least 3 paired numeric observations');
          break;
        }

        // Zero variance check
        const xSame = xVals.every((v) => v === xVals[0]);
        const ySame = yVals.every((v) => v === yVals[0]);
        if (xSame || ySame) {
          throw new ScientificNonParametricError(
            'NONPARAMETRIC_ZERO_VARIANCE',
            'Zero variance detected in one or both variables for Spearman correlation.'
          );
        }

        const speaRes = computeSpearmanCorrelation(xVals, yVals, altType);
        testStat = speaRes.rho;
        df = speaRes.degreesOfFreedom;
        pValue = speaRes.pValue;
        effectSize = { metric: 'SPEARMAN_RHO', value: speaRes.rho };
        sampleInfo.tie_count = speaRes.tieCount;

        assumptionAudit.push('Spearman rank correlation coefficient evaluated');
        break;
      }

      case 'FISHER_EXACT': {
        let a = 0,
          b = 0,
          c = 0,
          d = 0;

        if (request.configuration?.metadata?.observed && Array.isArray(request.configuration.metadata.observed)) {
          const obs: number[][] = request.configuration.metadata.observed as any;
          if (obs.length === 2 && obs[0].length === 2 && obs[1].length === 2) {
            a = Number(obs[0][0]);
            b = Number(obs[0][1]);
            c = Number(obs[1][0]);
            d = Number(obs[1][1]);
          } else {
            throw new ScientificNonParametricError(
              'NONPARAMETRIC_CONTINGENCY_INVALID',
              'Fisher exact test requires a 2x2 contingency table.'
            );
          }
        } else {
          const varX = request.dependent_variable;
          const varY = request.grouping_variable || (request.independent_variables && request.independent_variables[0]);

          if (!varX || !varY) {
            throw new ScientificNonParametricError(
              'NONPARAMETRIC_CONTINGENCY_INVALID',
              'Fisher exact test requires dependent_variable and grouping_variable / independent_variables[0].'
            );
          }

          const catXKeys = new Set<string>();
          const catYKeys = new Set<string>();
          const countsMap = new Map<string, number>();

          for (const rec of filteredRecords) {
            const vX = rec[varX];
            const vY = rec[varY];

            if (isMissingValue(vX, missingTokens) || isMissingValue(vY, missingTokens)) {
              continue;
            }

            const kX = String(vX);
            const kY = String(vY);

            catXKeys.add(kX);
            catYKeys.add(kY);

            const comboKey = `${kX}|||${kY}`;
            countsMap.set(comboKey, (countsMap.get(comboKey) || 0) + 1);
          }

          const listX = Array.from(catXKeys).sort();
          const listY = Array.from(catYKeys).sort();

          if (listX.length !== 2 || listY.length !== 2) {
            throw new ScientificNonParametricError(
              'NONPARAMETRIC_CONTINGENCY_INVALID',
              `Fisher exact test requires exactly 2x2 categorical outcome levels; found ${listX.length}x${listY.length}.`
            );
          }

          a = countsMap.get(`${listX[0]}|||${listY[0]}`) || 0;
          b = countsMap.get(`${listX[0]}|||${listY[1]}`) || 0;
          c = countsMap.get(`${listX[1]}|||${listY[0]}`) || 0;
          d = countsMap.get(`${listX[1]}|||${listY[1]}`) || 0;
        }

        const fishRes = computeFisherExact(a, b, c, d, altType);
        testStat = fishRes.oddsRatio;
        pValue = fishRes.pValue;
        effectSize = { metric: 'ODDS_RATIO', value: fishRes.oddsRatio };
        sampleInfo.valid_observations = fishRes.sampleSize;
        sampleInfo.contingency_dimensions = '2x2';

        contingencyTable = {
          observed: fishRes.observed,
          marginal_rows: fishRes.marginalRows,
          marginal_cols: fishRes.marginalCols,
          odds_ratio: fishRes.oddsRatio
        };

        assumptionAudit.push('Fisher exact hypergeometric probability evaluated for 2x2 contingency table');
        break;
      }
    }

    // 9. Derive decision
    if (pValue !== null && !isNaN(pValue) && executionStatus === 'COMPLETED') {
      decision = pValue < request.alpha ? 'REJECT_NULL' : 'DO_NOT_REJECT_NULL';
    }

    // 10. Compute cryptographic provenance hash
    const provenancePayload = {
      analysis_id: request.analysis_id,
      dataset_version_id: request.dataset_version_id,
      data_artifact_id: request.data_artifact_id,
      source_artifact_checksum: artifact.checksum || null,
      test_type: request.test_type,
      dependent_variable: request.dependent_variable,
      independent_variables: request.independent_variables || null,
      paired_variable: request.paired_variable || null,
      block_variable: request.block_variable || null,
      grouping_variable: request.grouping_variable || null,
      null_hypothesis: request.null_hypothesis,
      alternative_hypothesis: request.alternative_hypothesis,
      alpha: request.alpha,
      filters: request.filters || null,
      configuration: request.configuration || null,
      computed: {
        test_statistic: testStat,
        degrees_of_freedom: df,
        p_value: pValue,
        decision,
        effect_size: effectSize
      },
      engine_version: engineVersion
    };

    const provenanceHash = computeProvenanceHash(provenancePayload);

    return createNonParametricResult({
      analysis_id: request.analysis_id,
      dataset_version_id: request.dataset_version_id,
      data_artifact_id: request.data_artifact_id,
      test_type: request.test_type,
      status: executionStatus,
      alpha: request.alpha,
      null_hypothesis: request.null_hypothesis,
      alternative_hypothesis: request.alternative_hypothesis,
      sample_info: sampleInfo,
      test_statistic: testStat,
      degrees_of_freedom: df,
      p_value: pValue,
      decision,
      effect_size: effectSize,
      contingency_table: contingencyTable,
      assumption_audit: assumptionAudit,
      warnings,
      numerical_status: executionStatus,
      provenance_hash: provenanceHash,
      executed_at: executedAt,
      engine_version: engineVersion
    });
  }
}
