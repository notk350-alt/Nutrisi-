/**
 * Phase D14 — Scientific Data Layer: Visualization Engine Execution Layer
 *
 * Coordinates visualization requests, dataset version & artifact binding,
 * source analysis integrity verification, dispatching to mathematical builders,
 * cryptographic provenance hashing, and immutable result creation.
 */

import {
  createVisualizationResult,
  ScientificVisualizationError,
  validateVisualizationRequest,
  VisualizationAxes,
  VisualizationPayload,
  VisualizationRequest,
  VisualizationResult
} from './visualizationContracts';
import {
  buildBarChartFromCategories,
  buildBoxPlotFromD9Summary,
  buildBoxPlotFromValues,
  buildContingencyHeatmapFromD13,
  buildContingencyHeatmapFromD9,
  buildCorrelationMatrixFromD9,
  buildErrorBarFromD10,
  buildFrequencyChartFromD9,
  buildHistogramFromD9Summary,
  buildHistogramFromValues,
  buildLineChartFromD12,
  buildLineChartFromSeries,
  buildPredictedVsObservedFromD11,
  buildResidualPlotFromD11,
  buildRocCurveFromProbabilities,
  buildScatterPlotFromValues
} from './scientificVisualization';
import { DatasetVersionStore } from './datasetVersion';
import { DataArtifactStore } from './dataStatePipeline';
import { VariableStore } from './variableRegistry';
import { DataArtifact, DatasetVersion } from '../types';
import { computeProvenanceHash } from '../provenance/provenancePersistence';
import { evaluateRecordFilters } from './statisticalAnalysis';
import { AnalysisResult } from './analysisContracts';
import { InferentialAnalysisResult } from './inferentialContracts';
import { RegressionModelResult } from './regressionContracts';
import { ResearchPowerResult } from './powerContracts';
import { NonParametricAnalysisResult } from './nonParametricContracts';

export interface VisualizationExecuteOptions {
  request: VisualizationRequest;
  dataset_version_store?: DatasetVersionStore;
  data_artifact_store?: DataArtifactStore;
  variable_store?: VariableStore;
  dataset_version?: DatasetVersion;
  artifact?: DataArtifact;
  records?: Record<string, unknown>[];
  analysis_results?: {
    d9?: AnalysisResult | AnalysisResult[];
    d10?: InferentialAnalysisResult | InferentialAnalysisResult[];
    d11?: RegressionModelResult | RegressionModelResult[];
    d12?: ResearchPowerResult | ResearchPowerResult[];
    d13?: NonParametricAnalysisResult | NonParametricAnalysisResult[];
  };
}

export class VisualizationEngine {
  public static readonly ENGINE_VERSION = '1.0.0';

  /**
   * Executes a scientific visualization request.
   */
  public static visualize(options: VisualizationExecuteOptions): VisualizationResult {
    const { request } = options;

    // 1. Contract Validation
    validateVisualizationRequest(request);

    // 2. Dataset Version Resolution & Binding
    let datasetVersion = options.dataset_version;
    if (!datasetVersion && options.dataset_version_store) {
      datasetVersion = options.dataset_version_store.get(request.dataset_version_id);
    }

    if (!datasetVersion) {
      throw new ScientificVisualizationError(
        'VISUALIZATION_DATASET_NOT_FOUND',
        `Dataset version '${request.dataset_version_id}' not found`
      );
    }

    if (datasetVersion.version_id !== request.dataset_version_id) {
      throw new ScientificVisualizationError(
        'VISUALIZATION_VERSION_MISMATCH',
        `Requested dataset version '${request.dataset_version_id}' does not match bound version '${datasetVersion.version_id}'`
      );
    }

    // 3. Data Artifact Resolution & Binding
    let artifact = options.artifact;
    if (!artifact && options.data_artifact_store) {
      artifact = options.data_artifact_store.get(request.data_artifact_id);
    }

    if (!artifact) {
      throw new ScientificVisualizationError(
        'VISUALIZATION_ARTIFACT_NOT_FOUND',
        `Data artifact '${request.data_artifact_id}' not found`
      );
    }

    if (artifact.artifact_id !== request.data_artifact_id) {
      throw new ScientificVisualizationError(
        'VISUALIZATION_ARTIFACT_NOT_FOUND',
        `Artifact ID mismatch: expected '${request.data_artifact_id}', found '${artifact.artifact_id}'`
      );
    }

    if (artifact.dataset_version_id !== request.dataset_version_id) {
      throw new ScientificVisualizationError(
        'VISUALIZATION_VERSION_MISMATCH',
        `Data artifact '${artifact.artifact_id}' belongs to dataset version '${artifact.dataset_version_id}', expected '${request.dataset_version_id}'`
      );
    }

    const sourceArtifactChecksum = artifact.checksum;

    // 4. Source Analysis Results Verification
    const d9List = options.analysis_results?.d9
      ? Array.isArray(options.analysis_results.d9)
        ? options.analysis_results.d9
        : [options.analysis_results.d9]
      : [];
    const d10List = options.analysis_results?.d10
      ? Array.isArray(options.analysis_results.d10)
        ? options.analysis_results.d10
        : [options.analysis_results.d10]
      : [];
    const d11List = options.analysis_results?.d11
      ? Array.isArray(options.analysis_results.d11)
        ? options.analysis_results.d11
        : [options.analysis_results.d11]
      : [];
    const d12List = options.analysis_results?.d12
      ? Array.isArray(options.analysis_results.d12)
        ? options.analysis_results.d12
        : [options.analysis_results.d12]
      : [];
    const d13List = options.analysis_results?.d13
      ? Array.isArray(options.analysis_results.d13)
        ? options.analysis_results.d13
        : [options.analysis_results.d13]
      : [];

    const allAnalysisMap = new Map<string, { dataset_version_id?: string; data_artifact_id?: string; id: string }>();

    for (const r of d9List) {
      if (r.dataset_version_id !== request.dataset_version_id || r.data_artifact_id !== request.data_artifact_id) {
        throw new ScientificVisualizationError(
          'VISUALIZATION_SOURCE_MISMATCH',
          `D9 analysis '${r.analysis_id}' version/artifact mismatch with visualization request`
        );
      }
      allAnalysisMap.set(r.analysis_id, { dataset_version_id: r.dataset_version_id, data_artifact_id: r.data_artifact_id, id: r.analysis_id });
    }

    for (const r of d10List) {
      if (r.dataset_version_id !== request.dataset_version_id || r.data_artifact_id !== request.data_artifact_id) {
        throw new ScientificVisualizationError(
          'VISUALIZATION_SOURCE_MISMATCH',
          `D10 analysis '${r.analysis_id}' version/artifact mismatch with visualization request`
        );
      }
      allAnalysisMap.set(r.analysis_id, { dataset_version_id: r.dataset_version_id, data_artifact_id: r.data_artifact_id, id: r.analysis_id });
    }

    for (const r of d11List) {
      if (r.dataset_version_id !== request.dataset_version_id || r.data_artifact_id !== request.data_artifact_id) {
        throw new ScientificVisualizationError(
          'VISUALIZATION_SOURCE_MISMATCH',
          `D11 model '${r.model_id}' version/artifact mismatch with visualization request`
        );
      }
      allAnalysisMap.set(r.model_id, { dataset_version_id: r.dataset_version_id, data_artifact_id: r.data_artifact_id, id: r.model_id });
    }

    for (const r of d12List) {
      // D12 is research planning, but if bound to an artifact, verify
      allAnalysisMap.set(r.power_analysis_id, { id: r.power_analysis_id });
    }

    for (const r of d13List) {
      if (r.dataset_version_id !== request.dataset_version_id || r.data_artifact_id !== request.data_artifact_id) {
        throw new ScientificVisualizationError(
          'VISUALIZATION_SOURCE_MISMATCH',
          `D13 analysis '${r.analysis_id}' version/artifact mismatch with visualization request`
        );
      }
      allAnalysisMap.set(r.analysis_id, { dataset_version_id: r.dataset_version_id, data_artifact_id: r.data_artifact_id, id: r.analysis_id });
    }

    if (request.source_analysis_result_ids && request.source_analysis_result_ids.length > 0) {
      for (const reqId of request.source_analysis_result_ids) {
        if (!allAnalysisMap.has(reqId)) {
          throw new ScientificVisualizationError(
            'VISUALIZATION_ANALYSIS_NOT_FOUND',
            `Requested source analysis result '${reqId}' not provided in options`
          );
        }
      }
    }

    // 5. Data Records Preparation
    let rawRecords: Record<string, unknown>[] = options.records ?? [];
    if (rawRecords.length === 0 && (artifact as any).records) {
      rawRecords = (artifact as any).records;
    } else if (rawRecords.length === 0 && artifact.data_reference && Array.isArray((artifact.data_reference as any).records)) {
      rawRecords = (artifact.data_reference as any).records;
    }

    if (request.filters && request.filters.length > 0 && rawRecords.length > 0) {
      rawRecords = rawRecords.filter((r) => evaluateRecordFilters(r, request.filters));
    }

    // 6. Variable Validation
    if (options.variable_store && request.variables.length > 0) {
      for (const varId of request.variables) {
        // Only validate against store if variable exists in store or records
        const existsInStore = options.variable_store.get(varId) !== undefined;
        const existsInRecords = rawRecords.length > 0 && varId in rawRecords[0];
        if (!existsInStore && !existsInRecords) {
          throw new ScientificVisualizationError(
            'VISUALIZATION_VARIABLE_NOT_FOUND',
            `Variable '${varId}' not found in variable registry or dataset records`
          );
        }
      }
    }

    // 7. Dispatch Visualization Construction
    const payload: VisualizationPayload = {};
    const warnings: string[] = [];
    const summaryStats: Record<string, unknown> = {};
    const diagnostics: Record<string, unknown> = {};

    const axes: VisualizationAxes = {
      x_label: request.variables[0],
      y_label: request.variables[1],
      units: {}
    };

    const config = request.configuration || {};

    switch (request.visualization_type) {
      case 'HISTOGRAM': {
        const primaryVar = request.variables[0];
        // Check if D9 distribution summary is available
        const d9Match = d9List.find((d) => d.result.distribution_summaries?.[primaryVar]);
        if (d9Match && d9Match.result.distribution_summaries?.[primaryVar]) {
          payload.histogram = buildHistogramFromD9Summary(
            d9Match.result.distribution_summaries[primaryVar]
          );
          summaryStats.source = 'D9_DISTRIBUTION_SUMMARY';
        } else {
          const values = rawRecords
            .map((r) => r[primaryVar])
            .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
          payload.histogram = buildHistogramFromValues(values, config);
          summaryStats.total_records = values.length;
        }
        break;
      }

      case 'BOX_PLOT': {
        const items = [];
        for (const vName of request.variables) {
          // Check if D9 descriptive summary is available
          const d9Match = d9List.find((d) => d.result.numeric_summaries?.[vName]);
          if (d9Match && d9Match.result.numeric_summaries?.[vName]) {
            items.push(buildBoxPlotFromD9Summary(d9Match.result.numeric_summaries[vName]));
          } else {
            const values = rawRecords
              .map((r) => r[vName])
              .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
            items.push(buildBoxPlotFromValues(values, vName, undefined, config));
          }
        }
        payload.box_plot = { items };
        summaryStats.item_count = items.length;
        break;
      }

      case 'SCATTER_PLOT': {
        const xVar = request.variables[0];
        const yVar = request.variables[1] ?? request.variables[0];
        const xVals: number[] = [];
        const yVals: number[] = [];
        const ids: string[] = [];

        rawRecords.forEach((r, idx) => {
          const x = r[xVar];
          const y = r[yVar];
          if (typeof x === 'number' && Number.isFinite(x) && typeof y === 'number' && Number.isFinite(y)) {
            xVals.push(x);
            yVals.push(y);
            ids.push(typeof r.id === 'string' ? r.id : `rec_${idx}`);
          }
        });

        payload.scatter_plot = buildScatterPlotFromValues(xVals, yVals, ids, config);
        summaryStats.points_count = payload.scatter_plot.points.length;
        if (payload.scatter_plot.trendline) {
          diagnostics.trendline = payload.scatter_plot.trendline;
        }
        break;
      }

      case 'BAR_CHART': {
        const catVar = request.variables[0];
        const d9Match = d9List.find((d) => d.result.categorical_summaries?.[catVar]);
        if (d9Match && d9Match.result.categorical_summaries?.[catVar]) {
          const freq = buildFrequencyChartFromD9(d9Match.result.categorical_summaries[catVar], config);
          payload.bar_chart = { items: freq.items, is_grouped: false };
        } else {
          const counts: Record<string, number> = {};
          let total = 0;
          for (const r of rawRecords) {
            const val = String(r[catVar] ?? 'UNKNOWN');
            counts[val] = (counts[val] || 0) + 1;
            total++;
          }
          const catList = Object.entries(counts).map(([category, count]) => ({
            category,
            count,
            percentage: total > 0 ? (count / total) * 100 : 0
          }));
          payload.bar_chart = {
            items: buildBarChartFromCategories(catList, config),
            is_grouped: false
          };
        }
        break;
      }

      case 'FREQUENCY_CHART': {
        const catVar = request.variables[0];
        const d9Match = d9List.find((d) => d.result.categorical_summaries?.[catVar]);
        if (d9Match && d9Match.result.categorical_summaries?.[catVar]) {
          payload.frequency_chart = buildFrequencyChartFromD9(
            d9Match.result.categorical_summaries[catVar],
            config
          );
        } else {
          const counts: Record<string, number> = {};
          let total = 0;
          for (const r of rawRecords) {
            const val = String(r[catVar] ?? 'UNKNOWN');
            counts[val] = (counts[val] || 0) + 1;
            total++;
          }
          const catList = Object.entries(counts).map(([category, count]) => ({
            category,
            count,
            percentage: total > 0 ? (count / total) * 100 : 0
          }));
          payload.frequency_chart = {
            items: buildBarChartFromCategories(catList, config),
            total_count: total
          };
        }
        break;
      }

      case 'LINE_CHART': {
        // Can be built from raw time/sequence data or D12 power curves
        if (d12List.length > 0) {
          const allSeries = d12List.flatMap((d12) => buildLineChartFromD12(d12));
          payload.line_chart = { series: buildLineChartFromSeries(allSeries, config) };
          axes.x_label = 'Sample Size / Effect Size';
          axes.y_label = 'Statistical Power';
        } else {
          const xVar = request.variables[0];
          const yVar = request.variables[1] ?? request.variables[0];
          const pts = [];
          for (const r of rawRecords) {
            const x = r[xVar];
            const y = r[yVar];
            if (typeof x === 'number' && Number.isFinite(x) && typeof y === 'number' && Number.isFinite(y)) {
              pts.push({ x, y });
            }
          }
          payload.line_chart = {
            series: buildLineChartFromSeries(
              [{ series_id: 'series_1', label: `${yVar} vs ${xVar}`, points: pts }],
              config
            )
          };
        }
        break;
      }

      case 'ERROR_BAR': {
        if (d10List.length > 0) {
          const items = d10List.flatMap((d10) => buildErrorBarFromD10(d10, config));
          payload.error_bar = { items };
          summaryStats.item_count = items.length;
        } else {
          warnings.push('No D10 inferential result provided; generating error bar from raw records');
          const primaryVar = request.variables[0];
          const values = rawRecords
            .map((r) => r[primaryVar])
            .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
          const n = values.length;
          const mean = n > 0 ? values.reduce((a, b) => a + b, 0) / n : 0;
          const variance = n > 1 ? values.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1) : 0;
          const se = Math.sqrt(variance / (n || 1));
          const margin = 1.96 * se;
          payload.error_bar = {
            items: [
              {
                label: primaryVar,
                value: Number(mean.toFixed(6)),
                error_lower: Number((mean - margin).toFixed(6)),
                error_upper: Number((mean + margin).toFixed(6)),
                margin_of_error: Number(margin.toFixed(6))
              }
            ]
          };
        }
        break;
      }

      case 'CORRELATION_MATRIX': {
        const d9Match = d9List.find((d) => d.result.pairwise_associations?.numeric_associations);
        if (d9Match && d9Match.result.pairwise_associations) {
          payload.correlation_matrix = buildCorrelationMatrixFromD9(
            d9Match.result.pairwise_associations,
            config
          );
        } else {
          // Build pairwise correlations from numeric variables in raw records
          const numVars = request.variables;
          const matrix: number[][] = Array.from({ length: numVars.length }, () =>
            Array(numVars.length).fill(1)
          );
          for (let i = 0; i < numVars.length; i++) {
            for (let j = i + 1; j < numVars.length; j++) {
              const xVals: number[] = [];
              const yVals: number[] = [];
              for (const r of rawRecords) {
                const x = r[numVars[i]];
                const y = r[numVars[j]];
                if (typeof x === 'number' && Number.isFinite(x) && typeof y === 'number' && Number.isFinite(y)) {
                  xVals.push(x);
                  yVals.push(y);
                }
              }
              const scatter = buildScatterPlotFromValues(xVals, yVals, undefined, { include_trendline: true });
              const rVal = scatter.trendline ? Math.sqrt(scatter.trendline.r_squared) : 0;
              matrix[i][j] = Number(rVal.toFixed(6));
              matrix[j][i] = Number(rVal.toFixed(6));
            }
          }
          payload.correlation_matrix = { variables: numVars, matrix };
        }
        break;
      }

      case 'CONTINGENCY_HEATMAP': {
        const d13Match = d13List.find((d) => d.contingency_table);
        const d9Match = d9List.find((d) => d.result.pairwise_associations?.categorical_associations?.length);

        if (d13Match && d13Match.contingency_table) {
          const rowLabels = (config.row_labels as string[] | undefined) ?? (d13Match.sample_info?.group_sizes ? Object.keys(d13Match.sample_info.group_sizes) : undefined);
          const colLabels = (config.col_labels as string[] | undefined) ?? ((d13Match.contingency_table as any).col_labels as string[] | undefined);
          payload.contingency_heatmap = buildContingencyHeatmapFromD13(
            d13Match.contingency_table,
            rowLabels,
            colLabels
          );
        } else if (
          d9Match &&
          d9Match.result.pairwise_associations?.categorical_associations?.[0]
        ) {
          payload.contingency_heatmap = buildContingencyHeatmapFromD9(
            d9Match.result.pairwise_associations.categorical_associations[0],
            config
          );
        } else {
          warnings.push('No contingency table available from D9 or D13 source analyses');
        }
        break;
      }

      case 'ROC_CURVE': {
        const d11Match = d11List.find(
          (d) => d.predicted_probabilities && d.predicted_probabilities.length > 0
        );
        if (d11Match && d11Match.predicted_probabilities) {
          const outcomeVar = request.variables[1] ?? request.variables[0];
          const actual = rawRecords.map((r) => (Number(r[outcomeVar]) === 1 ? 1 : 0));
          payload.roc_curve = buildRocCurveFromProbabilities(
            d11Match.predicted_probabilities,
            actual,
            config
          );
          diagnostics.auc = payload.roc_curve.auc;
        } else {
          warnings.push('No D11 model with predicted probabilities found for ROC curve');
        }
        break;
      }

      case 'RESIDUAL_PLOT': {
        const d11Match = d11List[0];
        if (d11Match) {
          payload.residual_plot = buildResidualPlotFromD11(d11Match, config);
          axes.x_label = 'Fitted Values (Predicted)';
          axes.y_label = config.standardized ? 'Standardized Residuals' : 'Residuals';
        } else {
          warnings.push('No D11 regression result available for residual plot');
        }
        break;
      }

      case 'PREDICTED_VS_OBSERVED': {
        const d11Match = d11List[0];
        if (d11Match) {
          const depVar = request.variables[0];
          const observed = rawRecords
            .map((r) => r[depVar])
            .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
          payload.predicted_vs_observed = buildPredictedVsObservedFromD11(observed, d11Match, config);
          axes.x_label = 'Observed';
          axes.y_label = 'Predicted';
        } else {
          warnings.push('No D11 regression result available for predicted vs observed plot');
        }
        break;
      }
    }

    // 8. Deterministic Provenance Payload
    const provenancePayload = {
      visualization_id: request.visualization_id,
      visualization_type: request.visualization_type,
      dataset_version_id: request.dataset_version_id,
      data_artifact_id: request.data_artifact_id,
      source_artifact_checksum: sourceArtifactChecksum,
      source_analysis_result_ids: request.source_analysis_result_ids ?? [],
      variables: [...request.variables].sort(),
      filters: request.filters ?? [],
      grouping: request.grouping ?? null,
      configuration: config,
      payload,
      engine_version: VisualizationEngine.ENGINE_VERSION
    };

    const provenanceHash = computeProvenanceHash(provenancePayload);

    // 9. Construct and Deep-Freeze Result
    const result: VisualizationResult = {
      visualization_id: request.visualization_id,
      visualization_type: request.visualization_type,
      dataset_version_id: request.dataset_version_id,
      data_artifact_id: request.data_artifact_id,
      source_artifact_checksum: sourceArtifactChecksum,
      source_analysis_result_ids: request.source_analysis_result_ids ?? [],
      title: `${request.visualization_type} — ${request.variables.join(', ')}`,
      description: `Scientific visualization rendered from artifact ${request.data_artifact_id}`,
      variables: request.variables,
      axes,
      payload,
      summary_statistics: summaryStats,
      diagnostics,
      warnings,
      execution_status: 'COMPLETED',
      provenance_hash: provenanceHash,
      scientific_validity: 'NOT_ESTABLISHED',
      executed_at: request.created_at ?? new Date().toISOString(),
      engine_version: VisualizationEngine.ENGINE_VERSION
    };

    return createVisualizationResult(result);
  }
}
