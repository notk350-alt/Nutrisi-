/**
 * Phase D14 — Scientific Data Layer: Research Report & Table Engine
 *
 * Coordinates multi-source statistical synthesis, research table generation,
 * assumption auditing, strict interpretation boundary enforcement,
 * cryptographic provenance hashing, and deep-freezing of report outputs.
 */

import {
  AppliedMethodItem,
  AssumptionAuditItem,
  AssumptionAuditSection,
  createResearchReportResult,
  DataQualitySection,
  DatasetInfoSection,
  DescriptiveSection,
  InferentialReportItem,
  InferentialSection,
  MethodsSection,
  NonParametricReportItem,
  NonParametricSection,
  PowerReportItem,
  PowerSection,
  RegressionReportItem,
  RegressionSection,
  ReportProvenanceSection,
  ResearchReportRequest,
  ResearchReportResult,
  ResearchTable,
  ResearchTableType,
  ScientificReportError,
  validateReportRequest
} from './reportContracts';
import { VisualizationResult } from './visualizationContracts';
import { DatasetVersionStore } from './datasetVersion';
import { DataArtifactStore } from './dataStatePipeline';
import { DataArtifact, DatasetVersion } from '../types';
import { computeProvenanceHash } from '../provenance/provenancePersistence';
import { AnalysisResult } from './analysisContracts';
import { InferentialAnalysisResult } from './inferentialContracts';
import { RegressionModelResult } from './regressionContracts';
import { ResearchPowerResult } from './powerContracts';
import { NonParametricAnalysisResult } from './nonParametricContracts';

export interface ResearchReportExecuteOptions {
  request: ResearchReportRequest;
  dataset_version_store?: DatasetVersionStore;
  data_artifact_store?: DataArtifactStore;
  dataset_version?: DatasetVersion;
  artifact?: DataArtifact;
  analysis_results?: {
    d9?: AnalysisResult | AnalysisResult[];
    d10?: InferentialAnalysisResult | InferentialAnalysisResult[];
    d11?: RegressionModelResult | RegressionModelResult[];
    d12?: ResearchPowerResult | ResearchPowerResult[];
    d13?: NonParametricAnalysisResult | NonParametricAnalysisResult[];
  };
  visualizations?: VisualizationResult[];
}

export class TableEngine {
  /**
   * Builds a DESCRIPTIVE_TABLE from a D9 AnalysisResult.
   */
  public static buildDescriptiveTable(d9Result: AnalysisResult): ResearchTable {
    const numericSummaries = d9Result.result.numeric_summaries ?? {};
    const rows = Object.entries(numericSummaries).map(([varName, item]) => ({
      variable: varName,
      unit: item.canonical_unit ?? '-',
      valid_n: item.valid_count,
      missing_n: item.missing_count,
      missing_pct: `${item.missing_percentage.toFixed(2)}%`,
      mean: item.mean !== null ? Number(item.mean.toFixed(4)) : '-',
      std: item.standard_deviation !== null ? Number(item.standard_deviation.toFixed(4)) : '-',
      median: item.median !== null ? Number(item.median.toFixed(4)) : '-',
      min: item.minimum !== null ? Number(item.minimum.toFixed(4)) : '-',
      max: item.maximum !== null ? Number(item.maximum.toFixed(4)) : '-',
      iqr: item.interquartile_range !== null ? Number(item.interquartile_range.toFixed(4)) : '-'
    }));

    // Deterministic sort by variable name
    rows.sort((a, b) => a.variable.localeCompare(b.variable));

    return {
      table_id: `table_desc_${d9Result.analysis_id}`,
      table_type: 'DESCRIPTIVE_TABLE',
      title: 'Descriptive Statistics Summary',
      description: 'Continuous variable descriptive metrics generated from D9 analysis',
      columns: [
        { key: 'variable', label: 'Variable', format: 'STRING', alignment: 'LEFT' },
        { key: 'unit', label: 'Unit', format: 'STRING', alignment: 'CENTER' },
        { key: 'valid_n', label: 'N (Valid)', format: 'INTEGER', alignment: 'RIGHT' },
        { key: 'missing_n', label: 'Missing', format: 'INTEGER', alignment: 'RIGHT' },
        { key: 'missing_pct', label: 'Missing %', format: 'PERCENT', alignment: 'RIGHT' },
        { key: 'mean', label: 'Mean', format: 'NUMBER', alignment: 'RIGHT' },
        { key: 'std', label: 'Std Dev', format: 'NUMBER', alignment: 'RIGHT' },
        { key: 'median', label: 'Median', format: 'NUMBER', alignment: 'RIGHT' },
        { key: 'min', label: 'Min', format: 'NUMBER', alignment: 'RIGHT' },
        { key: 'max', label: 'Max', format: 'NUMBER', alignment: 'RIGHT' },
        { key: 'iqr', label: 'IQR', format: 'NUMBER', alignment: 'RIGHT' }
      ],
      rows,
      source_references: [
        {
          source_type: 'D9_STATISTICAL_ANALYSIS',
          id: d9Result.analysis_id,
          dataset_version_id: d9Result.dataset_version_id,
          data_artifact_id: d9Result.data_artifact_id
        }
      ]
    };
  }

  /**
   * Builds a GROUPED_SUMMARY_TABLE from a D9 AnalysisResult with grouped summaries.
   */
  public static buildGroupedSummaryTable(d9Result: AnalysisResult): ResearchTable {
    const grouped = d9Result.result.grouped_summaries;
    const rows: Record<string, unknown>[] = [];

    if (grouped && grouped.groups) {
      for (const g of grouped.groups) {
        if (g.descriptive_numeric) {
          for (const [varName, item] of Object.entries(g.descriptive_numeric)) {
            rows.push({
              group_key: g.group_key,
              variable: varName,
              record_count: g.record_count,
              mean: item.mean !== null ? Number(item.mean.toFixed(4)) : '-',
              std: item.standard_deviation !== null ? Number(item.standard_deviation.toFixed(4)) : '-',
              median: item.median !== null ? Number(item.median.toFixed(4)) : '-'
            });
          }
        }
      }
    }

    // Deterministic sort
    rows.sort((a, b) =>
      String(a.group_key).localeCompare(String(b.group_key)) ||
      String(a.variable).localeCompare(String(b.variable))
    );

    return {
      table_id: `table_grouped_${d9Result.analysis_id}`,
      table_type: 'GROUPED_SUMMARY_TABLE',
      title: 'Grouped Descriptive Summary',
      description: 'Stratified metrics across distinct cohort groups',
      columns: [
        { key: 'group_key', label: 'Group', format: 'STRING', alignment: 'LEFT' },
        { key: 'variable', label: 'Variable', format: 'STRING', alignment: 'LEFT' },
        { key: 'record_count', label: 'Count', format: 'INTEGER', alignment: 'RIGHT' },
        { key: 'mean', label: 'Mean', format: 'NUMBER', alignment: 'RIGHT' },
        { key: 'std', label: 'Std Dev', format: 'NUMBER', alignment: 'RIGHT' },
        { key: 'median', label: 'Median', format: 'NUMBER', alignment: 'RIGHT' }
      ],
      rows,
      source_references: [
        {
          source_type: 'D9_STATISTICAL_ANALYSIS',
          id: d9Result.analysis_id,
          dataset_version_id: d9Result.dataset_version_id,
          data_artifact_id: d9Result.data_artifact_id
        }
      ]
    };
  }

  /**
   * Builds an INFERENTIAL_RESULT_TABLE from D10 InferentialAnalysisResult list.
   */
  public static buildInferentialTable(d10Results: InferentialAnalysisResult[]): ResearchTable {
    const rows = d10Results.map((r) => ({
      analysis_id: r.analysis_id,
      test_type: r.test_type,
      alpha: r.alpha,
      statistic: r.statistic !== null ? Number(r.statistic.toFixed(4)) : '-',
      degrees_of_freedom: r.degrees_of_freedom !== null ? r.degrees_of_freedom : '-',
      p_value: r.p_value !== null ? Number(r.p_value.toFixed(6)) : '-',
      decision: r.decision,
      effect_size: r.effect_size ? `${r.effect_size.metric}=${r.effect_size.value?.toFixed(4)}` : '-'
    }));

    rows.sort((a, b) => a.analysis_id.localeCompare(b.analysis_id));

    return {
      table_id: 'table_inferential_summary',
      table_type: 'INFERENTIAL_RESULT_TABLE',
      title: 'Hypothesis Testing & Inferential Results',
      description: 'Parametric inferential statistical tests with formal decision rules',
      columns: [
        { key: 'analysis_id', label: 'Analysis ID', format: 'STRING', alignment: 'LEFT' },
        { key: 'test_type', label: 'Test Type', format: 'STRING', alignment: 'LEFT' },
        { key: 'statistic', label: 'Statistic', format: 'NUMBER', alignment: 'RIGHT' },
        { key: 'degrees_of_freedom', label: 'df', format: 'INTEGER', alignment: 'RIGHT' },
        { key: 'p_value', label: 'p-value', format: 'P_VALUE', alignment: 'RIGHT' },
        { key: 'alpha', label: 'α', format: 'NUMBER', alignment: 'RIGHT' },
        { key: 'decision', label: 'Decision', format: 'STRING', alignment: 'CENTER' },
        { key: 'effect_size', label: 'Effect Size', format: 'STRING', alignment: 'RIGHT' }
      ],
      rows,
      source_references: d10Results.map((r) => ({
        source_type: 'D10_INFERENTIAL_ANALYSIS',
        id: r.analysis_id,
        dataset_version_id: r.dataset_version_id,
        data_artifact_id: r.data_artifact_id
      }))
    };
  }

  /**
   * Builds a REGRESSION_COEFFICIENT_TABLE from a D11 RegressionModelResult.
   */
  public static buildRegressionCoefficientTable(d11Result: RegressionModelResult): ResearchTable {
    const rows: Record<string, unknown>[] = [];

    if (d11Result.intercept) {
      rows.push({
        term: '(Intercept)',
        estimate: Number(d11Result.intercept.coefficient.toFixed(6)),
        std_error: d11Result.intercept.standard_error !== null ? Number(d11Result.intercept.standard_error.toFixed(6)) : '-',
        t_or_z: d11Result.intercept.statistic !== null ? Number(d11Result.intercept.statistic.toFixed(4)) : '-',
        p_value: d11Result.intercept.p_value !== null ? Number(d11Result.intercept.p_value.toFixed(6)) : '-',
        ci_lower: d11Result.intercept.confidence_interval?.lower_bound !== null && d11Result.intercept.confidence_interval?.lower_bound !== undefined ? Number(d11Result.intercept.confidence_interval.lower_bound.toFixed(6)) : '-',
        ci_upper: d11Result.intercept.confidence_interval?.upper_bound !== null && d11Result.intercept.confidence_interval?.upper_bound !== undefined ? Number(d11Result.intercept.confidence_interval.upper_bound.toFixed(6)) : '-'
      });
    }

    for (const c of d11Result.coefficients) {
      rows.push({
        term: c.variable_name,
        estimate: Number(c.coefficient.toFixed(6)),
        std_error: c.standard_error !== null ? Number(c.standard_error.toFixed(6)) : '-',
        t_or_z: c.statistic !== null ? Number(c.statistic.toFixed(4)) : '-',
        p_value: c.p_value !== null ? Number(c.p_value.toFixed(6)) : '-',
        ci_lower: c.confidence_interval?.lower_bound !== null && c.confidence_interval?.lower_bound !== undefined ? Number(c.confidence_interval.lower_bound.toFixed(6)) : '-',
        ci_upper: c.confidence_interval?.upper_bound !== null && c.confidence_interval?.upper_bound !== undefined ? Number(c.confidence_interval.upper_bound.toFixed(6)) : '-'
      });
    }

    const r2Val = d11Result.model_metrics.linear?.r2;
    return {
      table_id: `table_reg_${d11Result.model_id}`,
      table_type: 'REGRESSION_COEFFICIENT_TABLE',
      title: `Regression Coefficients — ${d11Result.model_id} (${d11Result.model_type})`,
      description: `Model fit metrics: R²=${r2Val !== null && r2Val !== undefined ? r2Val.toFixed(4) : 'N/A'}, N=${d11Result.sample_size}`,
      columns: [
        { key: 'term', label: 'Term', format: 'STRING', alignment: 'LEFT' },
        { key: 'estimate', label: 'Estimate', format: 'NUMBER', alignment: 'RIGHT' },
        { key: 'std_error', label: 'Std. Error', format: 'NUMBER', alignment: 'RIGHT' },
        { key: 't_or_z', label: 'Statistic', format: 'NUMBER', alignment: 'RIGHT' },
        { key: 'p_value', label: 'p-value', format: 'P_VALUE', alignment: 'RIGHT' },
        { key: 'ci_lower', label: 'CI Lower', format: 'NUMBER', alignment: 'RIGHT' },
        { key: 'ci_upper', label: 'CI Upper', format: 'NUMBER', alignment: 'RIGHT' }
      ],
      rows,
      source_references: [
        {
          source_type: 'D11_REGRESSION_MODEL',
          id: d11Result.model_id,
          dataset_version_id: d11Result.dataset_version_id,
          data_artifact_id: d11Result.data_artifact_id
        }
      ]
    };
  }

  /**
   * Builds a NONPARAMETRIC_RESULT_TABLE from D13 NonParametricAnalysisResult list.
   */
  public static buildNonParametricTable(d13Results: NonParametricAnalysisResult[]): ResearchTable {
    const rows = d13Results.map((r) => ({
      analysis_id: r.analysis_id,
      test_type: r.test_type,
      statistic: r.test_statistic !== null ? Number(r.test_statistic.toFixed(4)) : '-',
      df: r.degrees_of_freedom !== null ? r.degrees_of_freedom : '-',
      p_value: r.p_value !== null ? Number(r.p_value.toFixed(6)) : '-',
      alpha: r.alpha,
      decision: r.decision ?? '-',
      effect_size: r.effect_size ? `${r.effect_size.metric}=${r.effect_size.value?.toFixed(4)}` : '-'
    }));

    rows.sort((a, b) => a.analysis_id.localeCompare(b.analysis_id));

    return {
      table_id: 'table_nonparam_summary',
      table_type: 'NONPARAMETRIC_RESULT_TABLE',
      title: 'Non-Parametric & Robust Statistical Tests',
      description: 'Distribution-free tests with tie corrections and effect size metrics',
      columns: [
        { key: 'analysis_id', label: 'Analysis ID', format: 'STRING', alignment: 'LEFT' },
        { key: 'test_type', label: 'Test Type', format: 'STRING', alignment: 'LEFT' },
        { key: 'statistic', label: 'Statistic', format: 'NUMBER', alignment: 'RIGHT' },
        { key: 'df', label: 'df', format: 'INTEGER', alignment: 'RIGHT' },
        { key: 'p_value', label: 'p-value', format: 'P_VALUE', alignment: 'RIGHT' },
        { key: 'alpha', label: 'α', format: 'NUMBER', alignment: 'RIGHT' },
        { key: 'decision', label: 'Decision', format: 'STRING', alignment: 'CENTER' },
        { key: 'effect_size', label: 'Effect Size', format: 'STRING', alignment: 'RIGHT' }
      ],
      rows,
      source_references: d13Results.map((r) => ({
        source_type: 'D13_NONPARAMETRIC_ANALYSIS',
        id: r.analysis_id,
        dataset_version_id: r.dataset_version_id,
        data_artifact_id: r.data_artifact_id
      }))
    };
  }

  /**
   * Builds a POWER_ANALYSIS_TABLE from D12 ResearchPowerResult list.
   */
  public static buildPowerAnalysisTable(d12Results: ResearchPowerResult[]): ResearchTable {
    const rows = d12Results.map((r) => ({
      analysis_id: r.power_analysis_id,
      analysis_type: r.analysis_type,
      calculation_mode: r.calculation_mode,
      alpha: r.alpha,
      target_power: r.target_power !== null ? Number(r.target_power.toFixed(4)) : '-',
      effect_size: r.effect_size !== null ? Number(r.effect_size.toFixed(4)) : '-',
      required_sample_size: r.required_sample_size ?? '-',
      achieved_power: r.achieved_power !== null ? Number(r.achieved_power.toFixed(4)) : '-',
      mde: r.minimum_detectable_effect !== null ? Number(r.minimum_detectable_effect.toFixed(4)) : '-'
    }));

    rows.sort((a, b) => a.analysis_id.localeCompare(b.analysis_id));

    return {
      table_id: 'table_power_summary',
      table_type: 'POWER_ANALYSIS_TABLE',
      title: 'Statistical Power & Sample Size Planning',
      description: 'Research sample size sizing, achieved power, and minimum detectable effect metrics',
      columns: [
        { key: 'analysis_id', label: 'Analysis ID', format: 'STRING', alignment: 'LEFT' },
        { key: 'analysis_type', label: 'Analysis Type', format: 'STRING', alignment: 'LEFT' },
        { key: 'calculation_mode', label: 'Mode', format: 'STRING', alignment: 'CENTER' },
        { key: 'alpha', label: 'α', format: 'NUMBER', alignment: 'RIGHT' },
        { key: 'target_power', label: 'Target Power', format: 'NUMBER', alignment: 'RIGHT' },
        { key: 'effect_size', label: 'Effect Size', format: 'NUMBER', alignment: 'RIGHT' },
        { key: 'required_sample_size', label: 'Req. N', format: 'INTEGER', alignment: 'RIGHT' },
        { key: 'achieved_power', label: 'Achieved Power', format: 'NUMBER', alignment: 'RIGHT' },
        { key: 'mde', label: 'MDE', format: 'NUMBER', alignment: 'RIGHT' }
      ],
      rows,
      source_references: d12Results.map((r) => ({
        source_type: 'D12_POWER_ANALYSIS',
        id: r.power_analysis_id
      }))
    };
  }

  /**
   * Builds an ASSUMPTION_AUDIT_TABLE across all executed analyses.
   */
  public static buildAssumptionAuditTable(analyses: {
    d10?: InferentialAnalysisResult[];
    d11?: RegressionModelResult[];
    d12?: ResearchPowerResult[];
    d13?: NonParametricAnalysisResult[];
  }): ResearchTable {
    const rows: AssumptionAuditItem[] = [];

    if (analyses.d10) {
      for (const d10 of analyses.d10) {
        for (const [key, val] of Object.entries(d10.assumptions)) {
          rows.push({
            source_id: d10.analysis_id,
            source_type: 'D10_INFERENTIAL',
            assumption: key,
            status: 'AUDITED',
            details: typeof val === 'object' ? JSON.stringify(val) : String(val)
          });
        }
      }
    }

    if (analyses.d11) {
      for (const d11 of analyses.d11) {
        for (const [key, val] of Object.entries(d11.diagnostics)) {
          rows.push({
            source_id: d11.model_id,
            source_type: 'D11_REGRESSION',
            assumption: key,
            status: 'AUDITED',
            details: typeof val === 'object' ? JSON.stringify(val) : String(val)
          });
        }
      }
    }

    if (analyses.d12) {
      for (const d12 of analyses.d12) {
        for (const a of d12.assumptions) {
          rows.push({
            source_id: d12.power_analysis_id,
            source_type: 'D12_POWER',
            assumption: a,
            status: 'AUDITED'
          });
        }
      }
    }

    if (analyses.d13) {
      for (const d13 of analyses.d13) {
        for (const a of d13.assumption_audit) {
          rows.push({
            source_id: d13.analysis_id,
            source_type: 'D13_NONPARAMETRIC',
            assumption: a,
            status: 'AUDITED'
          });
        }
      }
    }

    rows.sort((a, b) => a.source_id.localeCompare(b.source_id) || a.assumption.localeCompare(b.assumption));

    return {
      table_id: 'table_assumption_audit',
      table_type: 'ASSUMPTION_AUDIT_TABLE',
      title: 'Statistical Assumption Audit',
      description: 'Audit records of mathematical and distribution conditions checked during execution',
      columns: [
        { key: 'source_id', label: 'Analysis ID', format: 'STRING', alignment: 'LEFT' },
        { key: 'source_type', label: 'Layer', format: 'STRING', alignment: 'LEFT' },
        { key: 'assumption', label: 'Assumption', format: 'STRING', alignment: 'LEFT' },
        { key: 'status', label: 'Audit Status', format: 'STRING', alignment: 'CENTER' },
        { key: 'details', label: 'Details', format: 'STRING', alignment: 'LEFT' }
      ],
      rows: rows.map((r) => ({ ...r })),
      source_references: []
    };
  }

  /**
   * Builds a DATA_QUALITY_TABLE from artifact metadata and D9 analysis.
   */
  public static buildDataQualityTable(d9Result?: AnalysisResult, artifact?: DataArtifact): ResearchTable {
    const rows: Array<{ metric: string; value: string | number; status: string; notes: string }> = [];

    const totalRecords = (artifact as any)?.records
      ? (artifact as any).records.length
      : Array.isArray((artifact?.data_reference as any)?.records)
      ? (artifact!.data_reference as any).records.length
      : d9Result?.execution_metadata.total_records_in_artifact ?? 0;
    rows.push({
      metric: 'Total Observations',
      value: totalRecords,
      status: totalRecords > 0 ? 'VALID' : 'EMPTY',
      notes: 'Records in source data artifact'
    });

    if (d9Result?.result.missingness_summaries) {
      for (const [varName, item] of Object.entries(d9Result.result.missingness_summaries)) {
        rows.push({
          metric: `Missingness: ${varName}`,
          value: `${item.missing_count} (${item.missing_percentage.toFixed(2)}%)`,
          status: item.missing_percentage === 0 ? 'COMPLETE' : 'MISSING_DATA',
          notes: `Valid records: ${item.valid_count}`
        });
      }
    }

    if (d9Result?.result.outlier_summaries) {
      for (const [varName, item] of Object.entries(d9Result.result.outlier_summaries)) {
        rows.push({
          metric: `Outliers (${item.method}): ${varName}`,
          value: item.flagged_count,
          status: item.flagged_count === 0 ? 'NO_OUTLIERS' : 'OUTLIERS_FLAGGED',
          notes: `${item.flagged_percentage.toFixed(2)}% of records flagged`
        });
      }
    }

    return {
      table_id: 'table_data_quality',
      table_type: 'DATA_QUALITY_TABLE',
      title: 'Dataset Quality & Integrity Assessment',
      description: 'Systematic audit of completeness, missing values, and outlier counts',
      columns: [
        { key: 'metric', label: 'Metric', format: 'STRING', alignment: 'LEFT' },
        { key: 'value', label: 'Observed Value', format: 'STRING', alignment: 'RIGHT' },
        { key: 'status', label: 'Integrity Status', format: 'STRING', alignment: 'CENTER' },
        { key: 'notes', label: 'Notes', format: 'STRING', alignment: 'LEFT' }
      ],
      rows,
      source_references: artifact
        ? [
            {
              source_type: 'DATA_ARTIFACT',
              id: artifact.artifact_id,
              dataset_version_id: artifact.dataset_version_id
            }
          ]
        : []
    };
  }
}

export class ResearchReportEngine {
  public static readonly ENGINE_VERSION = '1.0.0';

  /**
   * Executes and compiles a complete, version-bound Research Report.
   */
  public static generateReport(options: ResearchReportExecuteOptions): ResearchReportResult {
    const { request } = options;

    // 1. Contract Validation
    validateReportRequest(request);

    // 2. Dataset Version Resolution & Binding
    let datasetVersion = options.dataset_version;
    if (!datasetVersion && options.dataset_version_store) {
      datasetVersion = options.dataset_version_store.get(request.dataset_version_id);
    }

    if (!datasetVersion) {
      throw new ScientificReportError(
        'REPORT_DATASET_NOT_FOUND',
        `Dataset version '${request.dataset_version_id}' not found`
      );
    }

    if (datasetVersion.version_id !== request.dataset_version_id) {
      throw new ScientificReportError(
        'REPORT_VERSION_MISMATCH',
        `Requested dataset version '${request.dataset_version_id}' does not match bound version '${datasetVersion.version_id}'`
      );
    }

    // 3. Data Artifact Resolution & Binding
    let artifact = options.artifact;
    if (!artifact && options.data_artifact_store) {
      artifact = options.data_artifact_store.get(request.data_artifact_id);
    }

    if (!artifact) {
      throw new ScientificReportError(
        'REPORT_ARTIFACT_NOT_FOUND',
        `Data artifact '${request.data_artifact_id}' not found`
      );
    }

    if (artifact.artifact_id !== request.data_artifact_id) {
      throw new ScientificReportError(
        'REPORT_ARTIFACT_NOT_FOUND',
        `Artifact ID mismatch: expected '${request.data_artifact_id}', found '${artifact.artifact_id}'`
      );
    }

    if (artifact.dataset_version_id !== request.dataset_version_id) {
      throw new ScientificReportError(
        'REPORT_VERSION_MISMATCH',
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

    const sourceAnalysisHashes: Record<string, string> = {};

    for (const r of d9List) {
      if (r.dataset_version_id !== request.dataset_version_id || r.data_artifact_id !== request.data_artifact_id) {
        throw new ScientificReportError(
          'REPORT_SOURCE_MISMATCH',
          `D9 analysis '${r.analysis_id}' version/artifact mismatch with report request`
        );
      }
      sourceAnalysisHashes[r.analysis_id] = r.checksum;
    }

    for (const r of d10List) {
      if (r.dataset_version_id !== request.dataset_version_id || r.data_artifact_id !== request.data_artifact_id) {
        throw new ScientificReportError(
          'REPORT_SOURCE_MISMATCH',
          `D10 analysis '${r.analysis_id}' version/artifact mismatch with report request`
        );
      }
      sourceAnalysisHashes[r.analysis_id] = r.checksum;
    }

    for (const r of d11List) {
      if (r.dataset_version_id !== request.dataset_version_id || r.data_artifact_id !== request.data_artifact_id) {
        throw new ScientificReportError(
          'REPORT_SOURCE_MISMATCH',
          `D11 model '${r.model_id}' version/artifact mismatch with report request`
        );
      }
      sourceAnalysisHashes[r.model_id] = r.checksum;
    }

    for (const r of d12List) {
      sourceAnalysisHashes[r.power_analysis_id] = r.provenance_hash;
    }

    for (const r of d13List) {
      if (r.dataset_version_id !== request.dataset_version_id || r.data_artifact_id !== request.data_artifact_id) {
        throw new ScientificReportError(
          'REPORT_SOURCE_MISMATCH',
          `D13 analysis '${r.analysis_id}' version/artifact mismatch with report request`
        );
      }
      sourceAnalysisHashes[r.analysis_id] = r.provenance_hash;
    }

    // Verify explicitly requested source analysis IDs if specified
    if (request.source_analysis_results) {
      const checkIds = (ids: string[] | undefined) => {
        if (!ids) return;
        for (const id of ids) {
          if (!sourceAnalysisHashes[id]) {
            throw new ScientificReportError(
              'REPORT_ANALYSIS_NOT_FOUND',
              `Requested source analysis result '${id}' not found in provided options`
            );
          }
        }
      };
      checkIds(request.source_analysis_results.d9);
      checkIds(request.source_analysis_results.d10);
      checkIds(request.source_analysis_results.d11);
      checkIds(request.source_analysis_results.d12);
      checkIds(request.source_analysis_results.d13);
    }

    // 5. Build Report Sections (13 Core Sections)
    const include = request.include_sections
      ? new Set(request.include_sections)
      : new Set<string>([
          'DATASET_INFO',
          'DATA_QUALITY',
          'METHODS',
          'DESCRIPTIVE',
          'INFERENTIAL',
          'REGRESSION',
          'NONPARAMETRIC',
          'POWER',
          'TABLES',
          'FIGURES',
          'ASSUMPTIONS',
          'WARNINGS',
          'PROVENANCE'
        ]);

    // Section 1: Dataset Info
    let datasetInfoSection: DatasetInfoSection | undefined;
    if (include.has('DATASET_INFO')) {
      const recordsArray = Array.isArray((artifact?.data_reference as any)?.records)
        ? (artifact!.data_reference as any).records
        : (artifact as any)?.records;
      const varNames = (artifact as any)?.schema?.columns
        ? Object.keys((artifact as any).schema.columns)
        : Array.isArray(recordsArray) && recordsArray[0]
        ? Object.keys(recordsArray[0])
        : [];
      datasetInfoSection = {
        dataset_version_id: request.dataset_version_id,
        data_artifact_id: request.data_artifact_id,
        source_artifact_checksum: sourceArtifactChecksum,
        record_count: Array.isArray(recordsArray) ? recordsArray.length : 0,
        variable_count: varNames.length,
        variable_names: varNames.sort(),
        created_at: artifact.created_at
      };
    }

    // Section 2: Data Quality
    let dataQualitySection: DataQualitySection | undefined;
    if (include.has('DATA_QUALITY')) {
      const recordsArray = Array.isArray((artifact?.data_reference as any)?.records)
        ? (artifact!.data_reference as any).records
        : (artifact as any)?.records;
      const totalRecs = Array.isArray(recordsArray) ? recordsArray.length : 0;
      let missingCount = 0;
      let outlierCount = 0;
      const flags: string[] = [];

      for (const d9 of d9List) {
        if (d9.result.missingness_summaries) {
          for (const m of Object.values(d9.result.missingness_summaries)) {
            missingCount += m.missing_count;
          }
        }
        if (d9.result.outlier_summaries) {
          for (const o of Object.values(d9.result.outlier_summaries)) {
            outlierCount += o.flagged_count;
          }
        }
      }

      if (missingCount > 0) flags.push(`Missing values observed: ${missingCount}`);
      if (outlierCount > 0) flags.push(`Outlier values flagged: ${outlierCount}`);

      dataQualitySection = {
        total_records: totalRecs,
        valid_records: totalRecs,
        missing_values_count: missingCount,
        missingness_percentage: totalRecs > 0 ? (missingCount / totalRecs) * 100 : 0,
        outlier_count: outlierCount,
        quality_flags: flags
      };
    }

    // Section 3: Methods
    let methodsSection: MethodsSection | undefined;
    if (include.has('METHODS')) {
      const methods: AppliedMethodItem[] = [];
      for (const d9 of d9List) {
        methods.push({
          layer: 'D9',
          method_name: d9.analysis_type,
          parameters: { requested_variables: d9.requested_variables }
        });
      }
      for (const d10 of d10List) {
        methods.push({
          layer: 'D10',
          method_name: d10.test_type,
          parameters: { alpha: d10.alpha, hypotheses: d10.hypotheses }
        });
      }
      for (const d11 of d11List) {
        methods.push({
          layer: 'D11',
          method_name: d11.model_type,
          parameters: { sample_size: d11.sample_size }
        });
      }
      for (const d12 of d12List) {
        methods.push({
          layer: 'D12',
          method_name: d12.analysis_type,
          parameters: { calculation_mode: d12.calculation_mode, alpha: d12.alpha }
        });
      }
      for (const d13 of d13List) {
        methods.push({
          layer: 'D13',
          method_name: d13.test_type,
          parameters: { alpha: d13.alpha }
        });
      }

      methodsSection = {
        methods_applied: methods,
        default_alpha: 0.05,
        default_confidence_level: 0.95,
        software_version: ResearchReportEngine.ENGINE_VERSION
      };
    }

    // Section 4: Descriptive Statistics
    let descriptiveSection: DescriptiveSection | undefined;
    if (include.has('DESCRIPTIVE')) {
      const numSum: Record<string, unknown> = {};
      const catSum: Record<string, unknown> = {};
      let count = 0;
      for (const d9 of d9List) {
        if (d9.result.numeric_summaries) {
          Object.assign(numSum, d9.result.numeric_summaries);
          count += Object.keys(d9.result.numeric_summaries).length;
        }
        if (d9.result.categorical_summaries) {
          Object.assign(catSum, d9.result.categorical_summaries);
          count += Object.keys(d9.result.categorical_summaries).length;
        }
      }
      descriptiveSection = {
        numeric_summaries: numSum,
        categorical_summaries: catSum,
        item_count: count
      };
    }

    // Section 5: Inferential Statistics
    let inferentialSection: InferentialSection | undefined;
    if (include.has('INFERENTIAL')) {
      const tests: InferentialReportItem[] = d10List.map((d10) => ({
        analysis_id: d10.analysis_id,
        test_type: d10.test_type,
        null_hypothesis: d10.hypotheses.null_hypothesis.statement,
        alternative_hypothesis: d10.hypotheses.alternative_hypothesis.statement,
        statistic: d10.statistic,
        degrees_of_freedom: d10.degrees_of_freedom,
        p_value: d10.p_value,
        alpha: d10.alpha,
        decision: d10.decision,
        effect_size: d10.effect_size ? { metric: d10.effect_size.metric, value: d10.effect_size.value } : null,
        confidence_interval: d10.confidence_interval
          ? { lower: d10.confidence_interval.lower_bound, upper: d10.confidence_interval.upper_bound }
          : null
      }));
      inferentialSection = {
        tests,
        total_tests: tests.length
      };
    }

    // Section 6: Regression Analysis
    let regressionSection: RegressionSection | undefined;
    if (include.has('REGRESSION')) {
      const models: RegressionReportItem[] = d11List.map((d11) => ({
        model_id: d11.model_id,
        model_type: d11.model_type,
        sample_size: d11.sample_size,
        r_squared: d11.model_metrics.linear?.r2 ?? null,
        adjusted_r_squared: d11.model_metrics.linear?.adjusted_r2 ?? null,
        f_statistic: null,
        p_value: null,
        execution_status: d11.execution_status,
        coefficients: d11.coefficients.map((c) => ({
          name: c.variable_name,
          estimate: c.coefficient,
          std_error: c.standard_error,
          t_or_z: c.statistic,
          p_value: c.p_value
        }))
      }));
      regressionSection = {
        models,
        total_models: models.length
      };
    }

    // Section 7: Non-Parametric Analysis
    let nonParametricSection: NonParametricSection | undefined;
    if (include.has('NONPARAMETRIC')) {
      const tests: NonParametricReportItem[] = d13List.map((d13) => ({
        analysis_id: d13.analysis_id,
        test_type: d13.test_type,
        test_statistic: d13.test_statistic,
        degrees_of_freedom: d13.degrees_of_freedom,
        p_value: d13.p_value,
        decision: d13.decision ?? 'UNDETERMINED',
        effect_size: d13.effect_size
      }));
      nonParametricSection = {
        tests,
        total_tests: tests.length
      };
    }

    // Section 8: Power Analysis
    let powerSection: PowerSection | undefined;
    if (include.has('POWER')) {
      const analyses: PowerReportItem[] = d12List.map((d12) => ({
        power_analysis_id: d12.power_analysis_id,
        analysis_type: d12.analysis_type,
        calculation_mode: d12.calculation_mode,
        alpha: d12.alpha,
        target_power: d12.target_power,
        effect_size: d12.effect_size,
        required_sample_size: d12.required_sample_size,
        achieved_power: d12.achieved_power,
        minimum_detectable_effect: d12.minimum_detectable_effect
      }));
      powerSection = {
        analyses,
        total_analyses: analyses.length
      };
    }

    // Section 9: Tables
    let tables: ResearchTable[] | undefined;
    if (include.has('TABLES')) {
      const tableList: ResearchTable[] = [];
      const requestedTypes = request.table_types ? new Set(request.table_types) : null;

      const shouldAdd = (type: ResearchTableType) => !requestedTypes || requestedTypes.has(type);

      // Data Quality Table
      if (shouldAdd('DATA_QUALITY_TABLE')) {
        tableList.push(TableEngine.buildDataQualityTable(d9List[0], artifact));
      }

      // Descriptive Tables
      for (const d9 of d9List) {
        if (d9.result.numeric_summaries && shouldAdd('DESCRIPTIVE_TABLE')) {
          tableList.push(TableEngine.buildDescriptiveTable(d9));
        }
        if (d9.result.grouped_summaries && shouldAdd('GROUPED_SUMMARY_TABLE')) {
          tableList.push(TableEngine.buildGroupedSummaryTable(d9));
        }
      }

      // Inferential Table
      if (d10List.length > 0 && shouldAdd('INFERENTIAL_RESULT_TABLE')) {
        tableList.push(TableEngine.buildInferentialTable(d10List));
      }

      // Regression Tables
      for (const d11 of d11List) {
        if (shouldAdd('REGRESSION_COEFFICIENT_TABLE')) {
          tableList.push(TableEngine.buildRegressionCoefficientTable(d11));
        }
      }

      // Non-Parametric Table
      if (d13List.length > 0 && shouldAdd('NONPARAMETRIC_RESULT_TABLE')) {
        tableList.push(TableEngine.buildNonParametricTable(d13List));
      }

      // Power Table
      if (d12List.length > 0 && shouldAdd('POWER_ANALYSIS_TABLE')) {
        tableList.push(TableEngine.buildPowerAnalysisTable(d12List));
      }

      // Assumption Audit Table
      if (shouldAdd('ASSUMPTION_AUDIT_TABLE')) {
        tableList.push(
          TableEngine.buildAssumptionAuditTable({
            d10: d10List,
            d11: d11List,
            d12: d12List,
            d13: d13List
          })
        );
      }

      tables = tableList;
    }

    // Section 10: Figures (Visualizations)
    let figures: VisualizationResult[] | undefined;
    if (include.has('FIGURES')) {
      figures = options.visualizations ? [...options.visualizations] : [];
    }

    // Section 11: Assumption Audit
    let assumptionAuditSection: AssumptionAuditSection | undefined;
    if (include.has('ASSUMPTIONS')) {
      const items: AssumptionAuditItem[] = [];

      for (const d10 of d10List) {
        for (const [key, val] of Object.entries(d10.assumptions)) {
          items.push({
            source_id: d10.analysis_id,
            source_type: 'D10_INFERENTIAL',
            assumption: key,
            status: 'AUDITED',
            details: typeof val === 'object' ? JSON.stringify(val) : String(val)
          });
        }
      }

      for (const d11 of d11List) {
        for (const [key, val] of Object.entries(d11.diagnostics)) {
          items.push({
            source_id: d11.model_id,
            source_type: 'D11_REGRESSION',
            assumption: key,
            status: 'AUDITED',
            details: typeof val === 'object' ? JSON.stringify(val) : String(val)
          });
        }
      }

      for (const d12 of d12List) {
        for (const a of d12.assumptions) {
          items.push({
            source_id: d12.power_analysis_id,
            source_type: 'D12_POWER',
            assumption: a,
            status: 'AUDITED'
          });
        }
      }

      for (const d13 of d13List) {
        for (const a of d13.assumption_audit) {
          items.push({
            source_id: d13.analysis_id,
            source_type: 'D13_NONPARAMETRIC',
            assumption: a,
            status: 'AUDITED'
          });
        }
      }

      assumptionAuditSection = {
        items,
        total_audits: items.length
      };
    }

    // Section 12: Warnings
    const warnings: string[] = [];
    if (include.has('WARNINGS')) {
      d9List.forEach((d) => d.result.numeric_summaries && Object.values(d.result.numeric_summaries).forEach((n) => n.notes && warnings.push(...n.notes)));
      d10List.forEach((d) => warnings.push(...d.warnings));
      d11List.forEach((d) => warnings.push(...d.warnings));
      d12List.forEach((d) => warnings.push(...d.warnings));
      d13List.forEach((d) => warnings.push(...d.warnings));
    }

    // Section 13: Provenance
    const generatedAt = request.created_at ?? new Date().toISOString();

    const provenancePayload = {
      report_id: request.report_id,
      dataset_version_id: request.dataset_version_id,
      data_artifact_id: request.data_artifact_id,
      source_artifact_checksum: sourceArtifactChecksum,
      source_analysis_hashes: sourceAnalysisHashes,
      sections_included: Array.from(include).sort(),
      engine_version: ResearchReportEngine.ENGINE_VERSION
    };

    const provenanceHash = computeProvenanceHash(provenancePayload);

    let provenanceSection: ReportProvenanceSection | undefined;
    if (include.has('PROVENANCE')) {
      provenanceSection = {
        report_id: request.report_id,
        dataset_version_id: request.dataset_version_id,
        data_artifact_id: request.data_artifact_id,
        source_artifact_checksum: sourceArtifactChecksum,
        source_analysis_hashes: sourceAnalysisHashes,
        engine_version: ResearchReportEngine.ENGINE_VERSION,
        generated_at: generatedAt,
        provenance_hash: provenanceHash
      };
    }

    const reportResult: ResearchReportResult = {
      report_id: request.report_id,
      dataset_version_id: request.dataset_version_id,
      data_artifact_id: request.data_artifact_id,
      source_artifact_checksum: sourceArtifactChecksum,
      title: request.title,
      description: request.description,
      sections: {
        dataset_info: datasetInfoSection,
        data_quality: dataQualitySection,
        methods: methodsSection,
        descriptive_statistics: descriptiveSection,
        inferential_statistics: inferentialSection,
        regression_analysis: regressionSection,
        non_parametric_analysis: nonParametricSection,
        power_analysis: powerSection,
        tables,
        figures,
        assumption_audit: assumptionAuditSection,
        warnings: include.has('WARNINGS') ? warnings : undefined,
        provenance: provenanceSection
      },
      scientific_validity: 'NOT_ESTABLISHED',
      created_at: generatedAt,
      engine_version: ResearchReportEngine.ENGINE_VERSION,
      provenance_hash: provenanceHash
    };

    return createResearchReportResult(reportResult);
  }
}
