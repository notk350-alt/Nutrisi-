/**
 * Phase D9 — Scientific Data Layer: Statistical Analysis Engine Execution Layer
 *
 * Coordinates analysis requests, dataset version & artifact binding, filtering,
 * statistical dispatch, provenance registration, and result persistence.
 */

import {
  AnalysisConfiguration,
  AnalysisFilter,
  AnalysisGrouping,
  AnalysisRequest,
  AnalysisResult,
  AnalysisResultBody,
  CategoricalFrequencyResultItem,
  DescriptiveNumericResultItem,
  DistributionSummaryResultItem,
  MissingnessSummaryResultItem,
  OutlierDetectionResultItem,
  ScientificStatisticalAnalysisError,
  assertAnalysisResult,
  validateAnalysisRequest
} from './analysisContracts';
import {
  computeCategoricalFrequency,
  computeDescriptiveNumeric,
  computeDistributionSummary,
  computeGroupedSummary,
  computeMissingnessSummary,
  computeOutlierDetection,
  computePairwiseAssociation,
  evaluateRecordFilters
} from './statisticalAnalysis';
import { DatasetVersionStore } from './datasetVersion';
import { DataArtifactStore } from './dataStatePipeline';
import { VariableStore } from './variableRegistry';
import { VariableMappingStore } from './variableMapping';
import { DataArtifact, DatasetVersion } from '../types';
import { computeProvenanceHash } from '../provenance/provenancePersistence';
import { deepFreeze } from './dataStatePipeline';

export interface StatisticalAnalysisExecuteOptions {
  request: AnalysisRequest;
  dataset_version_store?: DatasetVersionStore;
  data_artifact_store?: DataArtifactStore;
  variable_store?: VariableStore;
  variable_mapping_store?: VariableMappingStore;
  dataset_version?: DatasetVersion;
  artifact?: DataArtifact;
  records?: Record<string, unknown>[];
}

export class StatisticalAnalysisEngine {
  public static readonly ENGINE_VERSION = '1.0.0';

  /**
   * Executes a statistical analysis request on a validated dataset artifact.
   */
  public static analyze(options: StatisticalAnalysisExecuteOptions): AnalysisResult {
    const startTime = Date.now();

    // 1. Validate analysis request
    const request = validateAnalysisRequest(options.request);

    // 2. Resolve DatasetVersion
    let datasetVersion = options.dataset_version;
    if (!datasetVersion && options.dataset_version_store) {
      datasetVersion = options.dataset_version_store.get(request.dataset_version_id);
    }

    if (!datasetVersion) {
      throw new ScientificStatisticalAnalysisError(
        'ANALYSIS_DATASET_NOT_FOUND',
        `DatasetVersion "${request.dataset_version_id}" not found.`
      );
    }

    // 3. Resolve DataArtifact
    let artifact = options.artifact;
    if (!artifact && options.data_artifact_store) {
      artifact = options.data_artifact_store.get(request.data_artifact_id);
    }

    if (!artifact) {
      throw new ScientificStatisticalAnalysisError(
        'ANALYSIS_ARTIFACT_NOT_FOUND',
        `DataArtifact "${request.data_artifact_id}" not found.`
      );
    }

    // 4. Assert Version & Artifact Binding
    if (artifact.dataset_version_id !== request.dataset_version_id) {
      throw new ScientificStatisticalAnalysisError(
        'ANALYSIS_VERSION_MISMATCH',
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

    // 6. Apply Record Filters
    const filteredRecords = records.filter(rec =>
      evaluateRecordFilters(rec, request.filters, request.filter_group)
    );

    // 7. Validate Requested Variables
    if (!request.requested_variables || request.requested_variables.length === 0) {
      throw new ScientificStatisticalAnalysisError(
        'ANALYSIS_VARIABLE_NOT_FOUND',
        'Analysis request must specify at least one variable in "requested_variables".'
      );
    }

    // Check variable existence across records or variable store
    if (records.length > 0) {
      const sampleRec = records[0];
      for (const reqVar of request.requested_variables) {
        const inRecord = reqVar in sampleRec;
        const inReg = options.variable_store ? Boolean(options.variable_store.get(reqVar)) : false;

        if (!inRecord && !inReg) {
          throw new ScientificStatisticalAnalysisError(
            'ANALYSIS_VARIABLE_NOT_FOUND',
            `Requested variable "${reqVar}" not found in dataset columns or VariableRegistry.`
          );
        }
      }
    }

    // 8. Execute Analysis Strategy
    const resultBody: AnalysisResultBody = {};

    switch (request.analysis_type) {
      case 'DESCRIPTIVE_NUMERIC': {
        const summaries: Record<string, DescriptiveNumericResultItem> = {};
        for (const reqVar of request.requested_variables) {
          summaries[reqVar] = computeDescriptiveNumeric({
            variable_id: reqVar,
            records: filteredRecords,
            missing_tokens: request.configuration?.missing_tokens,
            variable_store: options.variable_store
          });
        }
        resultBody.numeric_summaries = summaries;
        break;
      }

      case 'CATEGORICAL_FREQUENCY': {
        const summaries: Record<string, CategoricalFrequencyResultItem> = {};
        for (const reqVar of request.requested_variables) {
          summaries[reqVar] = computeCategoricalFrequency({
            variable_id: reqVar,
            records: filteredRecords,
            missing_tokens: request.configuration?.missing_tokens
          });
        }
        resultBody.categorical_summaries = summaries;
        break;
      }

      case 'MISSINGNESS_SUMMARY': {
        const summaries: Record<string, MissingnessSummaryResultItem> = {};
        for (const reqVar of request.requested_variables) {
          summaries[reqVar] = computeMissingnessSummary({
            variable_id: reqVar,
            records: filteredRecords,
            missing_tokens: request.configuration?.missing_tokens
          });
        }
        resultBody.missingness_summaries = summaries;
        break;
      }

      case 'DISTRIBUTION_SUMMARY': {
        const summaries: Record<string, DistributionSummaryResultItem> = {};
        for (const reqVar of request.requested_variables) {
          summaries[reqVar] = computeDistributionSummary({
            variable_id: reqVar,
            records: filteredRecords,
            config: request.configuration
          });
        }
        resultBody.distribution_summaries = summaries;
        break;
      }

      case 'GROUPED_STRATIFIED': {
        if (!request.grouping || !request.grouping.group_by_variables || request.grouping.group_by_variables.length === 0) {
          throw new ScientificStatisticalAnalysisError(
            'ANALYSIS_GROUP_INVALID',
            'GROUPED_STRATIFIED analysis requires non-empty "grouping.group_by_variables".'
          );
        }
        resultBody.grouped_summaries = computeGroupedSummary({
          requested_variables: request.requested_variables,
          group_by_variables: request.grouping.group_by_variables,
          records: filteredRecords,
          config: request.configuration
        });
        break;
      }

      case 'PAIRWISE_ASSOCIATION': {
        if (request.requested_variables.length < 2) {
          throw new ScientificStatisticalAnalysisError(
            'ANALYSIS_VARIABLE_NOT_FOUND',
            'PAIRWISE_ASSOCIATION requires at least 2 requested variables.'
          );
        }
        resultBody.pairwise_associations = computePairwiseAssociation({
          requested_variables: request.requested_variables,
          records: filteredRecords,
          config: request.configuration
        });
        break;
      }

      case 'OUTLIER_DETECTION': {
        const summaries: Record<string, OutlierDetectionResultItem> = {};
        for (const reqVar of request.requested_variables) {
          summaries[reqVar] = computeOutlierDetection({
            variable_id: reqVar,
            records: filteredRecords,
            config: request.configuration
          });
        }
        resultBody.outlier_summaries = summaries;
        break;
      }

      default:
        throw new ScientificStatisticalAnalysisError(
          'ANALYSIS_CONFIGURATION_INVALID',
          `Unhandled analysis type "${request.analysis_type}".`
        );
    }

    const durationMs = Date.now() - startTime;

    // 9. Generate Cryptographic Provenance Checksum
    const provenanceData = {
      analysis_id: request.analysis_id,
      dataset_version_id: request.dataset_version_id,
      data_artifact_id: request.data_artifact_id,
      source_artifact_checksum: artifact.checksum || null,
      analysis_type: request.analysis_type,
      requested_variables: request.requested_variables,
      filters: request.filters || [],
      filter_group: request.filter_group || null,
      grouping: request.grouping || null,
      configuration: request.configuration || {},
      filtered_record_count: filteredRecords.length,
      result: resultBody,
      engine_version: StatisticalAnalysisEngine.ENGINE_VERSION
    };

    const checksum = computeProvenanceHash(provenanceData);

    const result: AnalysisResult = {
      analysis_id: request.analysis_id,
      dataset_version_id: request.dataset_version_id,
      data_artifact_id: request.data_artifact_id,
      analysis_type: request.analysis_type,
      requested_variables: request.requested_variables,
      filters: request.filters || [],
      grouping: request.grouping || null,
      configuration: request.configuration || {},
      result: resultBody,
      execution_metadata: {
        execution_time_ms: durationMs,
        total_records_in_artifact: totalRecordsInArtifact,
        filtered_record_count: filteredRecords.length
      },
      scientific_validity: 'NOT_ESTABLISHED',
      created_at: new Date().toISOString(),
      engine_version: StatisticalAnalysisEngine.ENGINE_VERSION,
      provenance_reference: checksum,
      checksum
    };

    return assertAnalysisResult(result);
  }
}

/**
 * In-memory store for saving, retrieving, and searching AnalysisResults.
 */
export class AnalysisResultStore {
  private readonly store = new Map<string, AnalysisResult>();

  public save(result: AnalysisResult): AnalysisResult {
    const verified = assertAnalysisResult(result);
    this.store.set(verified.analysis_id, verified);
    return verified;
  }

  public get(analysis_id: string): AnalysisResult | undefined {
    return this.store.get(analysis_id);
  }

  public has(analysis_id: string): boolean {
    return this.store.has(analysis_id);
  }

  public list(): AnalysisResult[] {
    return Array.from(this.store.values());
  }

  public findByDatasetVersion(dataset_version_id: string): AnalysisResult[] {
    return this.list().filter(r => r.dataset_version_id === dataset_version_id);
  }

  public findByArtifact(data_artifact_id: string): AnalysisResult[] {
    return this.list().filter(r => r.data_artifact_id === data_artifact_id);
  }

  public clear(): void {
    this.store.clear();
  }
}
