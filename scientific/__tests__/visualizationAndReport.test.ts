import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { DataArtifactStore } from '../data/dataStatePipeline';
import { DatasetVersionStore, computeDatasetVersionChecksum } from '../data/datasetVersion';
import { VariableStore } from '../data/variableRegistry';
import { DataArtifact, DatasetVersion, Variable } from '../types';
import {
  ScientificVisualizationError,
  validateVisualizationRequest,
  VisualizationRequest
} from '../data/visualizationContracts';
import {
  computeQuantileLinear,
  buildHistogramFromValues,
  buildBoxPlotFromValues,
  buildScatterPlotFromValues,
  buildBarChartFromCategories,
  buildLineChartFromSeries,
  buildRocCurveFromProbabilities
} from '../data/scientificVisualization';
import { VisualizationEngine } from '../data/visualizationEngine';
import {
  ResearchReportRequest,
  ScientificReportError,
  validateReportRequest
} from '../data/reportContracts';
import { ResearchReportEngine, TableEngine } from '../data/researchReportEngine';
import { AnalysisResult } from '../data/analysisContracts';
import { InferentialAnalysisResult } from '../data/inferentialContracts';
import { RegressionModelResult } from '../data/regressionContracts';
import { ResearchPowerResult } from '../data/powerContracts';
import { NonParametricAnalysisResult } from '../data/nonParametricContracts';

describe('Phase D14 — Scientific Visualization & Research Reporting Engine', () => {
  // Test Fixtures & In-Memory Stores
  const dsvStore = new DatasetVersionStore();
  const artStore = new DataArtifactStore();
  const varStore = new VariableStore();

  const datasetVersionData = {
    version_id: 'dsv_viz_v1',
    dataset_id: 'ds_cohort_alpha',
    version_number: 1,
    status: 'ACTIVE' as const,
    created_at: '2026-09-01T00:00:00Z',
    created_by: 'researcher_1'
  };

  const datasetVersion: DatasetVersion = {
    ...datasetVersionData,
    checksum: computeDatasetVersionChecksum(datasetVersionData)
  };
  dsvStore.create(datasetVersion);

  const sampleRecords = [
    { id: 'rec_1', group: 'A', glucose: 95, insulin: 12, outcome: 0, bmi: 22.4 },
    { id: 'rec_2', group: 'A', glucose: 100, insulin: 14, outcome: 0, bmi: 23.1 },
    { id: 'rec_3', group: 'A', glucose: 105, insulin: 15, outcome: 0, bmi: 24.0 },
    { id: 'rec_4', group: 'A', glucose: 110, insulin: 16, outcome: 1, bmi: 25.2 },
    { id: 'rec_5', group: 'B', glucose: 130, insulin: 22, outcome: 1, bmi: 28.5 },
    { id: 'rec_6', group: 'B', glucose: 135, insulin: 24, outcome: 1, bmi: 29.0 },
    { id: 'rec_7', group: 'B', glucose: 140, insulin: 25, outcome: 1, bmi: 30.2 },
    { id: 'rec_8', group: 'B', glucose: 145, insulin: 28, outcome: 1, bmi: 31.5 }
  ];

  const rawArtifact: DataArtifact = {
    artifact_id: 'art_viz_raw_1',
    dataset_version_id: 'dsv_viz_v1',
    state: 'RAW',
    data_reference: { records: sampleRecords },
    record_count: sampleRecords.length,
    column_count: 6,
    checksum: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    created_at: '2026-09-01T00:00:00Z',
    created_by: 'researcher_1'
  };
  artStore.create(rawArtifact);

  // Register Variables
  const variables: Variable[] = [
    {
      variable_id: 'glucose',
      name: 'glucose',
      description: 'Fasting blood glucose in mg/dL',
      datatype: 'NUMBER',
      status: 'ACTIVE',
      created_at: '2026-09-01T00:00:00Z',
      updated_at: '2026-09-01T00:00:00Z'
    },
    {
      variable_id: 'insulin',
      name: 'insulin',
      description: 'Serum insulin in uIU/mL',
      datatype: 'NUMBER',
      status: 'ACTIVE',
      created_at: '2026-09-01T00:00:00Z',
      updated_at: '2026-09-01T00:00:00Z'
    },
    {
      variable_id: 'group',
      name: 'group',
      description: 'Cohort study group assignment',
      datatype: 'STRING',
      status: 'ACTIVE',
      created_at: '2026-09-01T00:00:00Z',
      updated_at: '2026-09-01T00:00:00Z'
    }
  ];
  variables.forEach((v) => varStore.create(v));

  // Mock Analysis Results for D9, D10, D11, D12, D13
  const mockD9Result: AnalysisResult = {
    analysis_id: 'd9_analysis_1',
    dataset_version_id: 'dsv_viz_v1',
    data_artifact_id: 'art_viz_raw_1',
    analysis_type: 'DESCRIPTIVE_NUMERIC',
    requested_variables: ['glucose', 'insulin'],
    filters: [],
    grouping: null,
    configuration: {},
    result: {
      numeric_summaries: {
        glucose: {
          variable_id: 'glucose',
          total_records: 8,
          valid_count: 8,
          missing_count: 0,
          missing_percentage: 0,
          invalid_count: 0,
          minimum: 95,
          maximum: 145,
          sum: 960,
          mean: 120,
          median: 120,
          variance: 350,
          standard_deviation: 18.7,
          percentile_25: 102.5,
          percentile_50: 120,
          percentile_75: 137.5,
          interquartile_range: 35,
          constant_value_flag: false,
          zero_variance_flag: false
        }
      },
      categorical_summaries: {
        group: {
          variable_id: 'group',
          total_records: 8,
          valid_count: 8,
          missing_count: 0,
          missing_percentage: 0,
          unique_category_count: 2,
          categories: [
            { category: 'A', count: 4, percentage: 50 },
            { category: 'B', count: 4, percentage: 50 }
          ]
        }
      },
      distribution_summaries: {
        glucose: {
          variable_id: 'glucose',
          minimum: 95,
          maximum: 145,
          mean: 120,
          median: 120,
          variance: 350,
          standard_deviation: 18.7,
          quartiles: { q1: 102.5, q2: 120, q3: 137.5 },
          iqr: 35,
          histogram_bins: [
            { bin_index: 0, lower_bound: 95, upper_bound: 110, count: 4, percentage: 50 },
            { bin_index: 1, lower_bound: 110, upper_bound: 145, count: 4, percentage: 50 }
          ]
        }
      },
      pairwise_associations: {
        numeric_associations: [
          {
            var1: 'glucose',
            var2: 'insulin',
            pearson_correlation: 0.98,
            pair_count: 8,
            valid_count: 8,
            constant_variable_flag: false
          }
        ],
        categorical_associations: [
          {
            var1: 'group',
            var2: 'outcome',
            var1_categories: ['A', 'B'],
            var2_categories: ['0', '1'],
            matrix: [
              [3, 1],
              [0, 4]
            ],
            total_count: 8
          }
        ]
      }
    },
    execution_metadata: {
      execution_time_ms: 12,
      total_records_in_artifact: 8,
      filtered_record_count: 8
    },
    scientific_validity: 'NOT_ESTABLISHED',
    created_at: '2026-09-01T00:00:00Z',
    engine_version: '1.0.0',
    provenance_reference: 'prov_d9_1',
    checksum: 'mock_d9_checksum_111111111111111111111111111111111111111111111111'
  };

  const mockD10Result: InferentialAnalysisResult = {
    analysis_id: 'd10_inferential_1',
    test_type: 'INDEPENDENT_TWO_SAMPLE_T_TEST',
    dataset_version_id: 'dsv_viz_v1',
    data_artifact_id: 'art_viz_raw_1',
    variables: { dependent_variable: 'glucose', grouping_variable: 'group' },
    hypotheses: {
      null_hypothesis: { statement: 'Mean glucose group A = group B' },
      alternative_hypothesis: { statement: 'Mean glucose group A != group B', type: 'TWO_SIDED' }
    },
    alpha: 0.05,
    confidence_level: 0.95,
    sample_information: { n_A: 4, n_B: 4 },
    statistic: -5.4,
    degrees_of_freedom: 6,
    p_value: 0.0016,
    effect_size: { metric: 'COHENS_D', value: 3.82 },
    confidence_interval: { lower_bound: -48.2, upper_bound: -19.8, confidence_level: 0.95, method: 'STUDENT_T' },
    assumptions: { normality: 'MET', equal_variance: 'MET' },
    decision: 'REJECT_NULL',
    warnings: [],
    status: 'COMPLETED',
    scientific_validity: 'NOT_ESTABLISHED',
    engine_version: '1.0.0',
    provenance_reference: 'prov_d10_1',
    created_at: '2026-09-01T00:00:00Z',
    checksum: 'mock_d10_checksum_222222222222222222222222222222222222222222222222'
  };

  const mockD11Result: RegressionModelResult = {
    model_id: 'd11_regression_1',
    model_type: 'SIMPLE_LINEAR_REGRESSION',
    dataset_version_id: 'dsv_viz_v1',
    data_artifact_id: 'art_viz_raw_1',
    sample_size: 8,
    excluded_records: 0,
    coefficients: [
      {
        variable_name: 'insulin',
        coefficient: 3.12,
        standard_error: 0.25,
        statistic: 12.48,
        p_value: 0.00002,
        confidence_interval: { lower_bound: 2.5, upper_bound: 3.74, confidence_level: 0.95 }
      }
    ],
    intercept: {
      variable_name: '(Intercept)',
      coefficient: 57.5,
      standard_error: 4.8,
      statistic: 11.98,
      p_value: 0.00003,
      confidence_interval: { lower_bound: 45.8, upper_bound: 69.2, confidence_level: 0.95 }
    },
    predictions: [94.9, 101.2, 104.3, 107.4, 126.1, 132.4, 135.5, 144.9],
    residuals: [0.1, -1.2, 0.7, 2.6, 3.9, 2.6, 4.5, 0.1],
    predicted_probabilities: [0.05, 0.1, 0.15, 0.65, 0.85, 0.9, 0.95, 0.98],
    model_metrics: {
      linear: {
        r2: 0.963,
        adjusted_r2: 0.957,
        rmse: 2.65,
        mae: 2.1,
        sse: 20,
        sst: 540
      }
    },
    diagnostics: { durbin_watson: 1.85 },
    warnings: [],
    execution_status: 'COMPLETED',
    scientific_validity: 'NOT_ESTABLISHED',
    engine_version: '1.0.0',
    provenance_hash: 'mock_d11_hash_333333333333333333333333333333333333333333333333',
    created_at: '2026-09-01T00:00:00Z',
    checksum: 'mock_d11_checksum_333333333333333333333333333333333333333333333333'
  };

  const mockD12Result: ResearchPowerResult = {
    power_analysis_id: 'd12_power_1',
    analysis_type: 'TWO_SAMPLE_MEAN',
    calculation_mode: 'SAMPLE_SIZE',
    status: 'COMPLETED',
    alpha: 0.05,
    target_power: 0.8,
    effect_size: 0.8,
    effect_size_type: 'COHEN_D',
    sample_size: 52,
    required_sample_size: 52,
    achieved_power: 0.807,
    minimum_detectable_effect: 0.8,
    statistical_sample_size: 52,
    attrition_adjusted_sample_size: 58,
    group_sample_sizes: { group1: 26, group2: 26 },
    sensitivity_results: [
      { sample_size: 20, power: 0.45 },
      { sample_size: 30, power: 0.62 },
      { sample_size: 40, power: 0.74 },
      { sample_size: 52, power: 0.807 },
      { sample_size: 60, power: 0.86 }
    ],
    assumptions: ['Normal distribution in both groups', 'Equal variance'],
    warnings: [],
    numerical_status: 'CONVERGED',
    provenance_hash: 'mock_d12_hash_444444444444444444444444444444444444444444444444',
    scientific_validity: 'NOT_ESTABLISHED',
    default_applied: false,
    executed_at: '2026-09-01T00:00:00Z',
    engine_version: '1.0.0'
  };

  const mockD13Result: NonParametricAnalysisResult = {
    analysis_id: 'd13_nonparam_1',
    dataset_version_id: 'dsv_viz_v1',
    data_artifact_id: 'art_viz_raw_1',
    test_type: 'MANN_WHITNEY_U',
    status: 'COMPLETED',
    alpha: 0.05,
    null_hypothesis: { statement: 'Distributions are identical' },
    alternative_hypothesis: { statement: 'Distributions differ', type: 'TWO_SIDED' },
    sample_info: {
      total_records: 8,
      valid_observations: 8,
      missing_observations: 0,
      excluded_observations: 0,
      group_sizes: { A: 4, B: 4 }
    },
    test_statistic: 0,
    degrees_of_freedom: null,
    p_value: 0.0286,
    decision: 'REJECT_NULL',
    effect_size: { metric: 'rank_biserial_r', value: 1.0 },
    contingency_table: {
      observed: [
        [4, 0],
        [0, 4]
      ],
      marginal_rows: [4, 4],
      marginal_cols: [4, 4],
      odds_ratio: null
    },
    assumption_audit: ['Ordinal or continuous scale: MET', 'Independent samples: MET'],
    warnings: [],
    numerical_status: 'EXACT',
    provenance_hash: 'mock_d13_hash_555555555555555555555555555555555555555555555555',
    scientific_validity: 'NOT_ESTABLISHED',
    executed_at: '2026-09-01T00:00:00Z',
    engine_version: '1.0.0'
  };

  // ==========================================
  // 1. CONTRACT TESTS
  // ==========================================
  describe('1. Visualization Contract Validation', () => {
    it('accepts a fully valid VisualizationRequest', () => {
      const validReq: VisualizationRequest = {
        visualization_id: 'viz_valid_1',
        dataset_version_id: 'dsv_viz_v1',
        data_artifact_id: 'art_viz_raw_1',
        visualization_type: 'HISTOGRAM',
        variables: ['glucose'],
        configuration: { bin_count: 5 }
      };
      const result = validateVisualizationRequest(validReq);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('rejects request with missing or invalid fields', () => {
      expect(() =>
        validateVisualizationRequest({
          visualization_id: '',
          dataset_version_id: 'dsv_viz_v1',
          data_artifact_id: 'art_viz_raw_1',
          visualization_type: 'HISTOGRAM',
          variables: ['glucose']
        } as unknown as VisualizationRequest)
      ).toThrow(ScientificVisualizationError);

      expect(() =>
        validateVisualizationRequest({
          visualization_id: 'viz_err_1',
          dataset_version_id: '',
          data_artifact_id: 'art_viz_raw_1',
          visualization_type: 'HISTOGRAM',
          variables: ['glucose']
        } as unknown as VisualizationRequest)
      ).toThrow(ScientificVisualizationError);
    });

    it('rejects unsupported visualization type', () => {
      expect(() =>
        validateVisualizationRequest({
          visualization_id: 'viz_err_2',
          dataset_version_id: 'dsv_viz_v1',
          data_artifact_id: 'art_viz_raw_1',
          visualization_type: 'UNSUPPORTED_3D_SURFACE' as any,
          variables: ['glucose']
        })
      ).toThrow(ScientificVisualizationError);
    });

    it('rejects request with empty variables array', () => {
      expect(() =>
        validateVisualizationRequest({
          visualization_id: 'viz_err_3',
          dataset_version_id: 'dsv_viz_v1',
          data_artifact_id: 'art_viz_raw_1',
          visualization_type: 'BOX_PLOT',
          variables: []
        })
      ).toThrow(ScientificVisualizationError);
    });
  });

  // ==========================================
  // 2. DATASET & ARTIFACT BINDING
  // ==========================================
  describe('2. Dataset Version & Artifact Binding', () => {
    it('throws VISUALIZATION_DATASET_NOT_FOUND when dataset version does not exist', () => {
      expect(() =>
        VisualizationEngine.visualize({
          request: {
            visualization_id: 'viz_test_ds_not_found',
            dataset_version_id: 'dsv_non_existent',
            data_artifact_id: 'art_viz_raw_1',
            visualization_type: 'HISTOGRAM',
            variables: ['glucose']
          },
          dataset_version_store: dsvStore,
          data_artifact_store: artStore
        })
      ).toThrowError(/VISUALIZATION_DATASET_NOT_FOUND/);
    });

    it('throws VISUALIZATION_ARTIFACT_NOT_FOUND when artifact does not exist', () => {
      expect(() =>
        VisualizationEngine.visualize({
          request: {
            visualization_id: 'viz_test_art_not_found',
            dataset_version_id: 'dsv_viz_v1',
            data_artifact_id: 'art_non_existent',
            visualization_type: 'HISTOGRAM',
            variables: ['glucose']
          },
          dataset_version_store: dsvStore,
          data_artifact_store: artStore
        })
      ).toThrowError(/VISUALIZATION_ARTIFACT_NOT_FOUND/);
    });

    it('throws VISUALIZATION_VERSION_MISMATCH on cross-version artifact binding', () => {
      const wrongVersionArtifact: DataArtifact = {
        artifact_id: 'art_wrong_ver',
        dataset_version_id: 'dsv_other_version',
        state: 'RAW',
        data_reference: { records: [] },
        record_count: 0,
        column_count: 1,
        checksum: '1111111111111111111111111111111111111111111111111111111111111111',
        created_at: '2026-09-01T00:00:00Z',
        created_by: 'system'
      };
      artStore.create(wrongVersionArtifact);

      expect(() =>
        VisualizationEngine.visualize({
          request: {
            visualization_id: 'viz_test_ver_mismatch',
            dataset_version_id: 'dsv_viz_v1',
            data_artifact_id: 'art_wrong_ver',
            visualization_type: 'HISTOGRAM',
            variables: ['glucose']
          },
          dataset_version_store: dsvStore,
          data_artifact_store: artStore
        })
      ).toThrowError(/VISUALIZATION_VERSION_MISMATCH/);
    });
  });

  // ==========================================
  // 3. SOURCE ANALYSIS BINDING
  // ==========================================
  describe('3. Source Analysis Results Binding', () => {
    it('throws VISUALIZATION_SOURCE_MISMATCH if analysis result is from different dataset version', () => {
      const crossVersionD9: AnalysisResult = {
        ...mockD9Result,
        dataset_version_id: 'dsv_other_version'
      };

      expect(() =>
        VisualizationEngine.visualize({
          request: {
            visualization_id: 'viz_test_source_mismatch',
            dataset_version_id: 'dsv_viz_v1',
            data_artifact_id: 'art_viz_raw_1',
            visualization_type: 'HISTOGRAM',
            variables: ['glucose']
          },
          dataset_version_store: dsvStore,
          data_artifact_store: artStore,
          analysis_results: { d9: crossVersionD9 }
        })
      ).toThrowError(/VISUALIZATION_SOURCE_MISMATCH/);
    });

    it('throws VISUALIZATION_ANALYSIS_NOT_FOUND when explicitly requested analysis ID is missing', () => {
      expect(() =>
        VisualizationEngine.visualize({
          request: {
            visualization_id: 'viz_test_missing_id',
            dataset_version_id: 'dsv_viz_v1',
            data_artifact_id: 'art_viz_raw_1',
            source_analysis_result_ids: ['d9_missing_analysis_id'],
            visualization_type: 'HISTOGRAM',
            variables: ['glucose']
          },
          dataset_version_store: dsvStore,
          data_artifact_store: artStore,
          analysis_results: { d9: mockD9Result }
        })
      ).toThrowError(/VISUALIZATION_ANALYSIS_NOT_FOUND/);
    });
  });

  // ==========================================
  // 4. ALL 12 VISUALIZATION TYPES
  // ==========================================
  describe('4. Supported Visualization Types Execution', () => {
    it('renders 1. HISTOGRAM from raw records and D9 distribution summary', () => {
      const resRaw = VisualizationEngine.visualize({
        request: {
          visualization_id: 'viz_hist_raw',
          dataset_version_id: 'dsv_viz_v1',
          data_artifact_id: 'art_viz_raw_1',
          visualization_type: 'HISTOGRAM',
          variables: ['glucose'],
          configuration: { bin_count: 4 }
        },
        dataset_version_store: dsvStore,
        data_artifact_store: artStore
      });
      expect(resRaw.payload.histogram?.bins).toBeDefined();
      expect(resRaw.payload.histogram?.bins.length).toBe(4);
      expect(resRaw.payload.histogram?.total_count).toBe(8);

      const resD9 = VisualizationEngine.visualize({
        request: {
          visualization_id: 'viz_hist_d9',
          dataset_version_id: 'dsv_viz_v1',
          data_artifact_id: 'art_viz_raw_1',
          visualization_type: 'HISTOGRAM',
          variables: ['glucose']
        },
        dataset_version_store: dsvStore,
        data_artifact_store: artStore,
        analysis_results: { d9: mockD9Result }
      });
      expect(resD9.payload.histogram?.bins.length).toBe(2);
      expect(resD9.summary_statistics.source).toBe('D9_DISTRIBUTION_SUMMARY');
    });

    it('renders 2. BOX_PLOT from raw values and D9 numeric summaries', () => {
      const res = VisualizationEngine.visualize({
        request: {
          visualization_id: 'viz_box_1',
          dataset_version_id: 'dsv_viz_v1',
          data_artifact_id: 'art_viz_raw_1',
          visualization_type: 'BOX_PLOT',
          variables: ['glucose']
        },
        dataset_version_store: dsvStore,
        data_artifact_store: artStore,
        analysis_results: { d9: mockD9Result }
      });
      const item = res.payload.box_plot?.items[0];
      expect(item).toBeDefined();
      expect(item?.min).toBe(95);
      expect(item?.median).toBe(120);
      expect(item?.max).toBe(145);
    });

    it('renders 3. SCATTER_PLOT with linear trendline and R²', () => {
      const res = VisualizationEngine.visualize({
        request: {
          visualization_id: 'viz_scatter_1',
          dataset_version_id: 'dsv_viz_v1',
          data_artifact_id: 'art_viz_raw_1',
          visualization_type: 'SCATTER_PLOT',
          variables: ['insulin', 'glucose'],
          configuration: { include_trendline: true }
        },
        dataset_version_store: dsvStore,
        data_artifact_store: artStore
      });
      expect(res.payload.scatter_plot?.points.length).toBe(8);
      expect(res.payload.scatter_plot?.trendline).toBeDefined();
      expect(res.payload.scatter_plot?.trendline?.r_squared).toBeGreaterThan(0.9);
    });

    it('renders 4. BAR_CHART for categorical frequencies', () => {
      const res = VisualizationEngine.visualize({
        request: {
          visualization_id: 'viz_bar_1',
          dataset_version_id: 'dsv_viz_v1',
          data_artifact_id: 'art_viz_raw_1',
          visualization_type: 'BAR_CHART',
          variables: ['group']
        },
        dataset_version_store: dsvStore,
        data_artifact_store: artStore,
        analysis_results: { d9: mockD9Result }
      });
      expect(res.payload.bar_chart?.items.length).toBe(2);
      expect(res.payload.bar_chart?.items[0].count).toBe(4);
    });

    it('renders 5. FREQUENCY_CHART with percentage distribution', () => {
      const res = VisualizationEngine.visualize({
        request: {
          visualization_id: 'viz_freq_1',
          dataset_version_id: 'dsv_viz_v1',
          data_artifact_id: 'art_viz_raw_1',
          visualization_type: 'FREQUENCY_CHART',
          variables: ['group']
        },
        dataset_version_store: dsvStore,
        data_artifact_store: artStore,
        analysis_results: { d9: mockD9Result }
      });
      expect(res.payload.frequency_chart?.total_count).toBe(8);
      expect(res.payload.frequency_chart?.items[0].percentage).toBe(50);
    });

    it('renders 6. LINE_CHART from D12 research power sensitivity curve', () => {
      const res = VisualizationEngine.visualize({
        request: {
          visualization_id: 'viz_line_power',
          dataset_version_id: 'dsv_viz_v1',
          data_artifact_id: 'art_viz_raw_1',
          visualization_type: 'LINE_CHART',
          variables: ['sample_size', 'power']
        },
        dataset_version_store: dsvStore,
        data_artifact_store: artStore,
        analysis_results: { d12: mockD12Result }
      });
      const series = res.payload.line_chart?.series[0];
      expect(series).toBeDefined();
      expect(series?.points.length).toBe(5);
      expect(series?.points[0].x).toBe(20);
      expect(series?.points[3].x).toBe(52);
      expect(series?.points[3].y).toBeCloseTo(0.807, 3);
    });

    it('renders 7. ERROR_BAR from D10 inferential confidence interval', () => {
      const res = VisualizationEngine.visualize({
        request: {
          visualization_id: 'viz_error_bar_1',
          dataset_version_id: 'dsv_viz_v1',
          data_artifact_id: 'art_viz_raw_1',
          visualization_type: 'ERROR_BAR',
          variables: ['glucose']
        },
        dataset_version_store: dsvStore,
        data_artifact_store: artStore,
        analysis_results: { d10: mockD10Result }
      });
      const item = res.payload.error_bar?.items[0];
      expect(item).toBeDefined();
      expect(item?.value).toBe(-34);
      expect(item?.error_lower).toBe(-48.2);
      expect(item?.error_upper).toBe(-19.8);
      expect(item?.margin_of_error).toBeCloseTo(14.2, 1);
    });

    it('renders 8. CORRELATION_MATRIX from D9 pairwise associations', () => {
      const res = VisualizationEngine.visualize({
        request: {
          visualization_id: 'viz_corr_matrix_1',
          dataset_version_id: 'dsv_viz_v1',
          data_artifact_id: 'art_viz_raw_1',
          visualization_type: 'CORRELATION_MATRIX',
          variables: ['glucose', 'insulin']
        },
        dataset_version_store: dsvStore,
        data_artifact_store: artStore,
        analysis_results: { d9: mockD9Result }
      });
      const matrix = res.payload.correlation_matrix;
      expect(matrix?.variables).toEqual(['glucose', 'insulin']);
      expect(matrix?.matrix[0][0]).toBe(1);
      expect(matrix?.matrix[0][1]).toBe(0.98);
      expect(matrix?.matrix[1][0]).toBe(0.98);
    });

    it('renders 9. CONTINGENCY_HEATMAP from D13 contingency table', () => {
      const res = VisualizationEngine.visualize({
        request: {
          visualization_id: 'viz_contingency_1',
          dataset_version_id: 'dsv_viz_v1',
          data_artifact_id: 'art_viz_raw_1',
          visualization_type: 'CONTINGENCY_HEATMAP',
          variables: ['group', 'outcome'],
          configuration: {
            col_labels: ['Low', 'High']
          }
        },
        dataset_version_store: dsvStore,
        data_artifact_store: artStore,
        analysis_results: { d13: mockD13Result }
      });
      const heat = res.payload.contingency_heatmap;
      expect(heat?.row_categories).toEqual(['A', 'B']);
      expect(heat?.col_categories).toEqual(['Low', 'High']);
      expect(heat?.matrix).toEqual([
        [4, 0],
        [0, 4]
      ]);
      expect(heat?.percentages[0][0]).toBe(50);
    });

    it('renders 10. ROC_CURVE with trapezoidal AUC computation', () => {
      const res = VisualizationEngine.visualize({
        request: {
          visualization_id: 'viz_roc_1',
          dataset_version_id: 'dsv_viz_v1',
          data_artifact_id: 'art_viz_raw_1',
          visualization_type: 'ROC_CURVE',
          variables: ['predicted_probabilities', 'outcome']
        },
        dataset_version_store: dsvStore,
        data_artifact_store: artStore,
        analysis_results: { d11: mockD11Result }
      });
      const roc = res.payload.roc_curve;
      expect(roc?.points.length).toBeGreaterThan(2);
      expect(roc?.auc).toBeGreaterThan(0.7);
      expect(roc?.reference_line).toHaveLength(2);
    });

    it('renders 11. RESIDUAL_PLOT from D11 regression residuals', () => {
      const res = VisualizationEngine.visualize({
        request: {
          visualization_id: 'viz_residuals_1',
          dataset_version_id: 'dsv_viz_v1',
          data_artifact_id: 'art_viz_raw_1',
          visualization_type: 'RESIDUAL_PLOT',
          variables: ['glucose'],
          configuration: { standardized: true }
        },
        dataset_version_store: dsvStore,
        data_artifact_store: artStore,
        analysis_results: { d11: mockD11Result }
      });
      const plot = res.payload.residual_plot;
      expect(plot?.points.length).toBe(8);
      expect(plot?.reference_line).toBe(0);
      expect(plot?.is_standardized).toBe(true);
      expect(plot?.points[0].standardized_residual).toBeDefined();
    });

    it('renders 12. PREDICTED_VS_OBSERVED with 45-degree identity line', () => {
      const res = VisualizationEngine.visualize({
        request: {
          visualization_id: 'viz_pred_obs_1',
          dataset_version_id: 'dsv_viz_v1',
          data_artifact_id: 'art_viz_raw_1',
          visualization_type: 'PREDICTED_VS_OBSERVED',
          variables: ['glucose']
        },
        dataset_version_store: dsvStore,
        data_artifact_store: artStore,
        analysis_results: { d11: mockD11Result }
      });
      const predObs = res.payload.predicted_vs_observed;
      expect(predObs?.points.length).toBe(8);
      expect(predObs?.points[0].observed).toBe(95);
      expect(predObs?.points[0].predicted).toBeCloseTo(94.9, 1);
      expect(predObs?.identity_line).toEqual({ slope: 1, intercept: 0 });
    });
  });

  // ==========================================
  // 5. RESEARCH TABLES
  // ==========================================
  describe('5. Research Table Generation Engine', () => {
    it('builds 1. DESCRIPTIVE_TABLE from D9', () => {
      const table = TableEngine.buildDescriptiveTable(mockD9Result);
      expect(table.table_type).toBe('DESCRIPTIVE_TABLE');
      expect(table.rows).toHaveLength(1);
      expect(table.rows[0].variable).toBe('glucose');
      expect(table.rows[0].mean).toBe(120);
      expect(table.columns.map((c) => c.key)).toContain('mean');
    });

    it('builds 2. GROUPED_SUMMARY_TABLE from D9', () => {
      const groupedD9: AnalysisResult = {
        ...mockD9Result,
        result: {
          ...mockD9Result.result,
          grouped_summaries: {
            group_by_variables: ['group'],
            groups: [
              {
                group_key: 'A',
                group_values: { group: 'A' },
                record_count: 4,
                descriptive_numeric: {
                  glucose: mockD9Result.result.numeric_summaries!.glucose
                }
              }
            ]
          }
        }
      };
      const table = TableEngine.buildGroupedSummaryTable(groupedD9);
      expect(table.table_type).toBe('GROUPED_SUMMARY_TABLE');
      expect(table.rows).toHaveLength(1);
      expect(table.rows[0].group_key).toBe('A');
    });

    it('builds 3. INFERENTIAL_RESULT_TABLE from D10', () => {
      const table = TableEngine.buildInferentialTable([mockD10Result]);
      expect(table.table_type).toBe('INFERENTIAL_RESULT_TABLE');
      expect(table.rows[0].decision).toBe('REJECT_NULL');
      expect(table.rows[0].p_value).toBe(0.0016);
    });

    it('builds 4. REGRESSION_COEFFICIENT_TABLE from D11', () => {
      const table = TableEngine.buildRegressionCoefficientTable(mockD11Result);
      expect(table.table_type).toBe('REGRESSION_COEFFICIENT_TABLE');
      expect(table.rows).toHaveLength(2); // intercept + insulin
      expect(table.rows[0].term).toBe('(Intercept)');
      expect(table.rows[1].term).toBe('insulin');
    });

    it('builds 5. NONPARAMETRIC_RESULT_TABLE from D13', () => {
      const table = TableEngine.buildNonParametricTable([mockD13Result]);
      expect(table.table_type).toBe('NONPARAMETRIC_RESULT_TABLE');
      expect(table.rows[0].test_type).toBe('MANN_WHITNEY_U');
      expect(table.rows[0].decision).toBe('REJECT_NULL');
    });

    it('builds 6. POWER_ANALYSIS_TABLE from D12', () => {
      const table = TableEngine.buildPowerAnalysisTable([mockD12Result]);
      expect(table.table_type).toBe('POWER_ANALYSIS_TABLE');
      expect(table.rows[0].required_sample_size).toBe(52);
      expect(table.rows[0].achieved_power).toBe(0.807);
    });

    it('builds 7. ASSUMPTION_AUDIT_TABLE across all analyses', () => {
      const table = TableEngine.buildAssumptionAuditTable({
        d10: [mockD10Result],
        d11: [mockD11Result],
        d12: [mockD12Result],
        d13: [mockD13Result]
      });
      expect(table.table_type).toBe('ASSUMPTION_AUDIT_TABLE');
      expect(table.rows.length).toBeGreaterThanOrEqual(4);
    });

    it('builds 8. DATA_QUALITY_TABLE from artifact and D9 analysis', () => {
      const table = TableEngine.buildDataQualityTable(mockD9Result, rawArtifact);
      expect(table.table_type).toBe('DATA_QUALITY_TABLE');
      expect(table.rows[0].metric).toBe('Total Observations');
      expect(table.rows[0].value).toBe(8);
    });
  });

  // ==========================================
  // 6. RESEARCH REPORT ENGINE
  // ==========================================
  describe('6. Research Report Compilation', () => {
    it('generates a complete 13-section research report', () => {
      const report = ResearchReportEngine.generateReport({
        request: {
          report_id: 'rep_full_1',
          dataset_version_id: 'dsv_viz_v1',
          data_artifact_id: 'art_viz_raw_1',
          title: 'Metabolic Biomarker Cohort Analysis',
          description: 'Comprehensive statistical synthesis across D9–D13'
        },
        dataset_version_store: dsvStore,
        data_artifact_store: artStore,
        analysis_results: {
          d9: [mockD9Result],
          d10: [mockD10Result],
          d11: [mockD11Result],
          d12: [mockD12Result],
          d13: [mockD13Result]
        }
      });

      expect(report.report_id).toBe('rep_full_1');
      expect(report.scientific_validity).toBe('NOT_ESTABLISHED');
      expect(report.sections.dataset_info).toBeDefined();
      expect(report.sections.dataset_info?.record_count).toBe(8);
      expect(report.sections.data_quality).toBeDefined();
      expect(report.sections.methods).toBeDefined();
      expect(report.sections.descriptive_statistics).toBeDefined();
      expect(report.sections.inferential_statistics).toBeDefined();
      expect(report.sections.regression_analysis).toBeDefined();
      expect(report.sections.non_parametric_analysis).toBeDefined();
      expect(report.sections.power_analysis).toBeDefined();
      expect(report.sections.tables).toBeDefined();
      expect(report.sections.tables?.length).toBeGreaterThanOrEqual(5);
      expect(report.sections.assumption_audit).toBeDefined();
      expect(report.sections.provenance).toBeDefined();
      expect(report.sections.provenance?.provenance_hash).toBe(report.provenance_hash);
    });

    it('supports partial section selection via include_sections', () => {
      const report = ResearchReportEngine.generateReport({
        request: {
          report_id: 'rep_partial_1',
          dataset_version_id: 'dsv_viz_v1',
          data_artifact_id: 'art_viz_raw_1',
          title: 'Methods and Inferential Only',
          include_sections: ['METHODS', 'INFERENTIAL', 'PROVENANCE']
        },
        dataset_version_store: dsvStore,
        data_artifact_store: artStore,
        analysis_results: {
          d10: [mockD10Result]
        }
      });

      expect(report.sections.methods).toBeDefined();
      expect(report.sections.inferential_statistics).toBeDefined();
      expect(report.sections.provenance).toBeDefined();
      expect(report.sections.dataset_info).toBeUndefined();
      expect(report.sections.regression_analysis).toBeUndefined();
    });

    it('rejects cross-version analysis in report generation', () => {
      const badD10 = { ...mockD10Result, dataset_version_id: 'dsv_wrong_1' };
      expect(() =>
        ResearchReportEngine.generateReport({
          request: {
            report_id: 'rep_bad_source_1',
            dataset_version_id: 'dsv_viz_v1',
            data_artifact_id: 'art_viz_raw_1',
            title: 'Cross Version Report'
          },
          dataset_version_store: dsvStore,
          data_artifact_store: artStore,
          analysis_results: { d10: badD10 }
        })
      ).toThrowError(/REPORT_SOURCE_MISMATCH/);
    });
  });

  // ==========================================
  // 7. IMMUTABILITY TESTS
  // ==========================================
  describe('7. Immutability & Deep-Freezing', () => {
    it('deep-freezes VisualizationResult to prevent in-place mutation', () => {
      const res = VisualizationEngine.visualize({
        request: {
          visualization_id: 'viz_immut_1',
          dataset_version_id: 'dsv_viz_v1',
          data_artifact_id: 'art_viz_raw_1',
          visualization_type: 'HISTOGRAM',
          variables: ['glucose']
        },
        dataset_version_store: dsvStore,
        data_artifact_store: artStore
      });

      expect(Object.isFrozen(res)).toBe(true);
      expect(Object.isFrozen(res.payload)).toBe(true);
      expect(Object.isFrozen(res.payload.histogram)).toBe(true);
      expect(Object.isFrozen(res.axes)).toBe(true);

      expect(() => {
        (res as any).title = 'Mutated Title';
      }).toThrow();
    });

    it('deep-freezes ResearchReportResult to prevent in-place mutation', () => {
      const report = ResearchReportEngine.generateReport({
        request: {
          report_id: 'rep_immut_1',
          dataset_version_id: 'dsv_viz_v1',
          data_artifact_id: 'art_viz_raw_1',
          title: 'Immutable Report'
        },
        dataset_version_store: dsvStore,
        data_artifact_store: artStore
      });

      expect(Object.isFrozen(report)).toBe(true);
      expect(Object.isFrozen(report.sections)).toBe(true);
      expect(() => {
        (report as any).title = 'Modified Title';
      }).toThrow();
    });
  });

  // ==========================================
  // 8. PROVENANCE & DETERMINISM
  // ==========================================
  describe('8. Cryptographic Provenance & Determinism', () => {
    it('produces identical provenance hash for identical visualization requests', () => {
      const req: VisualizationRequest = {
        visualization_id: 'viz_hash_1',
        dataset_version_id: 'dsv_viz_v1',
        data_artifact_id: 'art_viz_raw_1',
        visualization_type: 'HISTOGRAM',
        variables: ['glucose'],
        configuration: { bin_count: 5 },
        created_at: '2026-09-01T00:00:00Z'
      };

      const res1 = VisualizationEngine.visualize({
        request: req,
        dataset_version_store: dsvStore,
        data_artifact_store: artStore
      });
      const res2 = VisualizationEngine.visualize({
        request: req,
        dataset_version_store: dsvStore,
        data_artifact_store: artStore
      });

      expect(res1.provenance_hash).toBe(res2.provenance_hash);
      expect(res1.provenance_hash).toHaveLength(64);
    });

    it('produces different provenance hash when configuration or variable changes', () => {
      const res1 = VisualizationEngine.visualize({
        request: {
          visualization_id: 'viz_hash_diff_1',
          dataset_version_id: 'dsv_viz_v1',
          data_artifact_id: 'art_viz_raw_1',
          visualization_type: 'HISTOGRAM',
          variables: ['glucose'],
          configuration: { bin_count: 5 },
          created_at: '2026-09-01T00:00:00Z'
        },
        dataset_version_store: dsvStore,
        data_artifact_store: artStore
      });

      const res2 = VisualizationEngine.visualize({
        request: {
          visualization_id: 'viz_hash_diff_1',
          dataset_version_id: 'dsv_viz_v1',
          data_artifact_id: 'art_viz_raw_1',
          visualization_type: 'HISTOGRAM',
          variables: ['glucose'],
          configuration: { bin_count: 10 },
          created_at: '2026-09-01T00:00:00Z'
        },
        dataset_version_store: dsvStore,
        data_artifact_store: artStore
      });

      expect(res1.provenance_hash).not.toBe(res2.provenance_hash);
    });
  });

  // ==========================================
  // 9. SECURITY & AUDIT
  // ==========================================
  describe('9. Security Audit & Zero Dynamic Code Execution', () => {
    it('contains zero eval() or new Function() calls across all D14 source files', () => {
      const d14Files = [
        path.resolve(__dirname, '../data/visualizationContracts.ts'),
        path.resolve(__dirname, '../data/scientificVisualization.ts'),
        path.resolve(__dirname, '../data/visualizationEngine.ts'),
        path.resolve(__dirname, '../data/reportContracts.ts'),
        path.resolve(__dirname, '../data/researchReportEngine.ts')
      ];

      for (const file of d14Files) {
        expect(fs.existsSync(file)).toBe(true);
        const content = fs.readFileSync(file, 'utf8');
        expect(content).not.toMatch(/\beval\s*\(/);
        expect(content).not.toMatch(/\bnew\s+Function\s*\(/);
      }
    });
  });

  // ==========================================
  // 10. SCIENTIFIC BOUNDARY
  // ==========================================
  describe('10. Scientific Boundary & Neutral Presentation', () => {
    it('strictly preserves scientific_validity = NOT_ESTABLISHED on all outputs', () => {
      const viz = VisualizationEngine.visualize({
        request: {
          visualization_id: 'viz_scival_1',
          dataset_version_id: 'dsv_viz_v1',
          data_artifact_id: 'art_viz_raw_1',
          visualization_type: 'HISTOGRAM',
          variables: ['glucose']
        },
        dataset_version_store: dsvStore,
        data_artifact_store: artStore
      });
      expect(viz.scientific_validity).toBe('NOT_ESTABLISHED');

      const rep = ResearchReportEngine.generateReport({
        request: {
          report_id: 'rep_scival_1',
          dataset_version_id: 'dsv_viz_v1',
          data_artifact_id: 'art_viz_raw_1',
          title: 'Neutral Presentation Report'
        },
        dataset_version_store: dsvStore,
        data_artifact_store: artStore
      });
      expect(rep.scientific_validity).toBe('NOT_ESTABLISHED');
    });
  });
});
