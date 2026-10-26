/**
 * Phase D8 — Scientific Data Layer: Dataset Execution Engine
 *
 * Integrates the Scientific Data Layer (Dataset Version, Data Artifact, Variable Mapping,
 * Validation Gate) with the Phase C Scientific Execution Engine (Module Resolver, Input Validator,
 * Unit Engine, Parameter Resolver, Scientific Executor, BatchExecutor, Provenance Persistence).
 *
 * Core Architectural Invariants:
 * 1. Zero Calculation Duplication: Strictly delegates scientific execution to Phase C.
 * 2. Exact Version Pinning: dataset_version_id, data_artifact_id, module_version, and parameter_set_id are pinned.
 * 3. Read-Only Artifact Immutability: Source artifacts are never mutated in-place.
 * 4. Cross-Version Rejection: Disallows executing an artifact against a different dataset_version_id.
 * 5. Deterministic Error Policies: Strict FAIL_FAST and CONTINUE_ON_ERROR execution isolation.
 * 6. Provenance Integration: Every record-level ExecutionResult generates a cryptographic SHA-256 ProvenanceRecord.
 * 7. Security: Zero eval(), zero new Function(), zero dynamic JS execution.
 * 8. Zero Scientific Claims: Execution evidence reporting only; no rankings or automated validity elevation.
 */

import {
  BatchErrorPolicy,
  DataArtifact,
  DatasetColumnMapping,
  DatasetExecutionRequest,
  DatasetRecordExecutionResult,
  DatasetResultSet,
  DatasetVersion,
  ExecutionResult,
  ParameterSet,
  ParameterSnapshot,
  ProvenanceRecord,
  ScientificDatasetExecutionError,
  ScientificParameter,
  ScientificResolverError,
  ScientificVariable,
  ValidationGateResult,
  ValidationProfile
} from '../types';
import { ModuleResolver, ResolvableModule } from '../resolvers/moduleResolver';
import { ParameterResolver } from '../resolvers/parameterResolver';
import { executeModuleRequest } from '../engine/executionAdapter';
import { buildProvenanceRecord, ProvenanceStore } from '../provenance/provenancePersistence';
import { DatasetVersionStore } from './datasetVersion';
import { DataArtifactStore, computeDataArtifactChecksum } from './dataStatePipeline';
import { VariableStore } from './variableRegistry';
import { VariableMappingStore } from './variableMapping';
import { ValidationProfileStore } from './dataValidation';
import { DatasetExecutionRequestValidator, ResultSetValidator } from './datasetExecutionRequest';
import { DatasetInputAssembler } from './datasetInputAssembler';
import { DatasetValidationGate } from './datasetValidationGate';
import crypto from 'crypto';

export interface ExecuteDatasetOptions {
  request: DatasetExecutionRequest;
  dataset_version_store: DatasetVersionStore;
  artifact_store: DataArtifactStore;
  variable_registry?: VariableStore;
  variable_mapping_store?: VariableMappingStore;
  validation_profile_store?: ValidationProfileStore;
  provenance_store?: ProvenanceStore;
  available_modules?: ResolvableModule[];
  available_parameters?: ScientificParameter[];
  parameter_sets?: Record<string, ParameterSet>;
  variables?: Record<string, ScientificVariable>;
  validation_profile?: ValidationProfile;
  records?: Record<string, unknown>[];
  custom_timestamp?: string;
}

function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  Object.freeze(obj);
  for (const key of Object.keys(obj)) {
    const val = (obj as any)[key];
    if (val !== null && typeof val === 'object' && !Object.isFrozen(val)) {
      deepFreeze(val);
    }
  }
  return obj;
}

export class DatasetExecutionEngine {
  /**
   * Orchestrates full end-to-end dataset scientific execution.
   */
  public static execute(options: ExecuteDatasetOptions): DatasetResultSet {
    const startTime = Date.now();
    const {
      request,
      dataset_version_store,
      artifact_store,
      variable_registry,
      variable_mapping_store,
      validation_profile_store,
      provenance_store,
      available_modules = [],
      available_parameters = [],
      parameter_sets = {},
      variables = {},
      validation_profile,
      records: explicitRecords,
      custom_timestamp
    } = options;

    const createdAt = custom_timestamp || request.created_at || new Date().toISOString();
    const resultSetId =
      request.request_id ? `drs_${request.request_id}` : `drs_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

    // 1. Validate request structure
    DatasetExecutionRequestValidator.assertValid(request);

    // 2. Resolve & bind DatasetVersion
    const datasetVersion = dataset_version_store.get(request.dataset_version_id);
    if (!datasetVersion) {
      throw new ScientificDatasetExecutionError(
        'DATASET_VERSION_NOT_FOUND',
        `DatasetVersion "${request.dataset_version_id}" not found in DatasetVersionStore.`
      );
    }

    // 3. Resolve & bind DataArtifact
    const artifact = artifact_store.get(request.data_artifact_id);
    if (!artifact) {
      throw new ScientificDatasetExecutionError(
        'DATA_ARTIFACT_NOT_FOUND',
        `DataArtifact "${request.data_artifact_id}" not found in DataArtifactStore.`
      );
    }

    // 4. Cross-Version Rejection
    if (artifact.dataset_version_id !== request.dataset_version_id) {
      throw new ScientificDatasetExecutionError(
        'DATA_ARTIFACT_CROSS_VERSION',
        `DataArtifact "${artifact.artifact_id}" belongs to dataset version "${artifact.dataset_version_id}", rejecting execution against requested dataset version "${request.dataset_version_id}".`
      );
    }

    // 5. Source Immutability Check: record baseline checksum
    const initialChecksum = artifact.checksum || computeDataArtifactChecksum(artifact);

    // 6. Extract records safely
    let records: Record<string, unknown>[] = [];
    if (explicitRecords && Array.isArray(explicitRecords)) {
      records = explicitRecords;
    } else if (Array.isArray(artifact.data_reference)) {
      records = artifact.data_reference as Record<string, unknown>[];
    } else if (Array.isArray((artifact.data_reference as any)?.records)) {
      records = (artifact.data_reference as any).records;
    } else if (Array.isArray(artifact.metadata?.records)) {
      records = artifact.metadata.records as Record<string, unknown>[];
    }

    // 7. Data Validation Gate
    let gateResult: ValidationGateResult | undefined = undefined;
    try {
      gateResult = DatasetValidationGate.evaluate({
        dataset_version: datasetVersion,
        artifact,
        records,
        profile_id: request.validation_profile_id,
        profile_store: validation_profile_store,
        policy: request.validation_gate_policy,
        variable_registry,
        variable_mapping: variable_mapping_store
      });

      DatasetValidationGate.assertAllowed(gateResult);
    } catch (err: any) {
      if (err instanceof ScientificDatasetExecutionError && err.code === 'VALIDATION_GATE_BLOCKED') {
        throw err;
      }
      throw err;
    }

    // 8. Resolve ScientificModule via Phase C ModuleResolver
    let resolvedTargetModule: ResolvableModule;
    let moduleVersion: string;
    try {
      const resolvedMeta = ModuleResolver.resolve({
        module_id: request.module_id,
        requested_version: request.module_version,
        modules: available_modules
      });
      resolvedTargetModule = resolvedMeta.module;
      moduleVersion = resolvedMeta.module_version || resolvedTargetModule.version || '1.0.0';

      // Pin exact version: fail if requested version does not match
      if (request.module_version && moduleVersion !== request.module_version) {
        throw new ScientificDatasetExecutionError(
          'MODULE_VERSION_NOT_FOUND',
          `Pinned module version mismatch: Requested "${request.module_version}", but resolved version is "${moduleVersion}".`
        );
      }
    } catch (err: any) {
      if (err instanceof ScientificDatasetExecutionError) {
        throw err;
      }
      if (err instanceof ScientificResolverError) {
        if (err.code === 'MODULE_VERSION_NOT_FOUND') {
          throw new ScientificDatasetExecutionError(
            'MODULE_VERSION_NOT_FOUND',
            `Pinned module version "${request.module_version}" not found for module "${request.module_id}".`
          );
        }
        throw new ScientificDatasetExecutionError(
          'MODULE_NOT_FOUND',
          `Scientific module "${request.module_id}" not found: ${err.message}`
        );
      }
      throw new ScientificDatasetExecutionError(
        'MODULE_NOT_FOUND',
        `Unexpected error during module resolution: ${err?.message || err}`
      );
    }

    // 9. Resolve Parameters via Phase C ParameterResolver
    let parameterSnapshot: ParameterSnapshot | undefined;
    const parametersMap: Record<string, ScientificParameter> = {};
    for (const p of available_parameters) {
      parametersMap[p.parameter_id] = p;
    }

    if (request.parameter_snapshot) {
      parameterSnapshot = request.parameter_snapshot as unknown as ParameterSnapshot;
    } else {
      try {
        const paramResolution = ParameterResolver.resolve({
          module: resolvedTargetModule as any,
          parameter_set_id: request.parameter_set_id,
          available_parameters,
          available_parameter_sets: Object.values(parameter_sets)
        });
        parameterSnapshot = Object.freeze(paramResolution.snapshot);
      } catch (err: any) {
        // Parameter set error
        throw new ScientificDatasetExecutionError(
          'SCIENTIFIC_EXECUTION_ERROR',
          `Parameter resolution failed for module "${request.module_id}": ${err?.message || err}`
        );
      }
    }

    // 10. Extract module inputs & resolve variable mappings
    const moduleInputs = DatasetInputAssembler.extractModuleInputs(resolvedTargetModule);
    const resolvedMappings = DatasetInputAssembler.resolveMappings({
      dataset_version_id: request.dataset_version_id,
      mapping_configuration: request.mapping_configuration,
      module_inputs: moduleInputs,
      variable_mapping_store,
      variable_registry
    });

    const columnsUsed = Array.from(new Set(resolvedMappings.map((m) => m.source_column)));

    // 11. Execute Batch over Records
    const batchPolicy: BatchErrorPolicy = request.execution_configuration.batch_policy;
    const maxRecords = request.execution_configuration.max_records;
    const effectiveRecords = maxRecords && maxRecords > 0 ? records.slice(0, maxRecords) : records;

    const recordResults: DatasetRecordExecutionResult[] = [];
    const executionIds: string[] = [];
    let successfulCount = 0;
    let failedCount = 0;
    let skippedCount = 0;

    for (let i = 0; i < effectiveRecords.length; i++) {
      const rawRec = effectiveRecords[i];
      const recordId = (rawRec as any)?.record_id ?? (rawRec as any)?.id ?? `rec_${i}`;

      // A. Input Assembly for this isolated record
      let assembled;
      try {
        assembled = DatasetInputAssembler.assembleRecordInputs({
          record: rawRec,
          record_index: i,
          mappings: resolvedMappings,
          module_inputs: moduleInputs,
          allow_unmapped_inputs: request.execution_configuration.allow_unmapped_inputs
        });
      } catch (err: any) {
        failedCount++;
        const errMsg = err?.message || String(err);
        recordResults.push({
          record_index: i,
          record_id: recordId,
          status: 'FAILED',
          error: errMsg
        });

        if (batchPolicy === 'FAIL_FAST') {
          // If FAIL_FAST, mark remaining as SKIPPED and break
          for (let j = i + 1; j < effectiveRecords.length; j++) {
            const nextRaw = effectiveRecords[j];
            const nextId = (nextRaw as any)?.record_id ?? (nextRaw as any)?.id ?? `rec_${j}`;
            recordResults.push({
              record_index: j,
              record_id: nextId,
              status: 'SKIPPED'
            });
            skippedCount++;
          }
          break;
        }
        continue;
      }

      // B. Isolated Scientific Execution via Phase C executeModuleRequest
      try {
        const execResult = executeModuleRequest(
          {
            module_id: request.module_id,
            requested_version: moduleVersion,
            parameter_set_id: request.parameter_set_id,
            inputs: assembled.inputs as any
          },
          resolvedTargetModule,
          parametersMap,
          variables,
          {
            available_modules,
            available_parameters,
            available_parameter_sets: Object.values(parameter_sets),
            parameter_snapshot: parameterSnapshot
          }
        );

        executionIds.push(execResult.execution_id);

        // C. Record Provenance
        let provId: string | undefined = undefined;
        if (provenance_store) {
          const provRecord = buildProvenanceRecord(execResult, {
            dataset_version_id: request.dataset_version_id,
            batch_id: resultSetId,
            metadata: {
              data_artifact_id: request.data_artifact_id,
              record_index: i,
              record_id: recordId
            },
            created_at: createdAt
          });
          provenance_store.save(provRecord);
          provId = provRecord.provenance_id;
        }

        successfulCount++;
        recordResults.push({
          record_index: i,
          record_id: recordId,
          status: 'SUCCESS',
          execution_id: execResult.execution_id,
          execution_result: execResult,
          assembled_inputs: assembled.inputs,
          warnings: execResult.warnings
        });
      } catch (err: any) {
        failedCount++;
        const errMsg = err?.message || String(err);
        recordResults.push({
          record_index: i,
          record_id: recordId,
          status: 'FAILED',
          assembled_inputs: assembled.inputs,
          error: errMsg
        });

        if (batchPolicy === 'FAIL_FAST') {
          for (let j = i + 1; j < effectiveRecords.length; j++) {
            const nextRaw = effectiveRecords[j];
            const nextId = (nextRaw as any)?.record_id ?? (nextRaw as any)?.id ?? `rec_${j}`;
            recordResults.push({
              record_index: j,
              record_id: nextId,
              status: 'SKIPPED'
            });
            skippedCount++;
          }
          break;
        }
      }
    }

    // 12. Immutability Verification: Ensure source artifact was untouched
    const finalChecksum = computeDataArtifactChecksum(artifact);
    if (finalChecksum !== initialChecksum) {
      throw new ScientificDatasetExecutionError(
        'DATASET_EXECUTION_IMMUTABILITY_VIOLATION',
        `CRITICAL: Source DataArtifact "${artifact.artifact_id}" checksum changed during execution! Immutability violated.`
      );
    }

    // 13. Determine Overall Status
    let overallStatus: DatasetResultSet['status'];
    if (failedCount === 0 && skippedCount === 0) {
      overallStatus = 'SUCCESS';
    } else if (successfulCount > 0) {
      overallStatus = 'PARTIAL_SUCCESS';
    } else {
      overallStatus = 'FAILED';
    }

    const durationMs = Date.now() - startTime;

    const resultSet: DatasetResultSet = {
      result_set_id: resultSetId,
      request_id: request.request_id,
      dataset_version_id: request.dataset_version_id,
      data_artifact_id: request.data_artifact_id,
      module_id: request.module_id,
      module_version: moduleVersion,
      parameter_set_id: request.parameter_set_id,
      parameter_versions: request.parameter_versions,
      mapping_summary: {
        mapped_inputs_count: resolvedMappings.length,
        columns_used: columnsUsed
      },
      validation_gate_result: gateResult,
      execution_ids: executionIds,
      records: recordResults,
      summary: {
        total: effectiveRecords.length,
        successful: successfulCount,
        failed: failedCount,
        skipped: skippedCount,
        duration_ms: durationMs
      },
      status: overallStatus,
      provenance_reference: `batch_prov_${resultSetId}`,
      created_at: createdAt,
      created_by: request.created_by || 'SYSTEM',
      metadata: request.metadata
    };

    // 14. Validate ResultSet structure & return deep-frozen object
    ResultSetValidator.assertValid(resultSet);
    return deepFreeze(resultSet);
  }
}

/**
 * In-memory repository for DatasetResultSet instances.
 */
export class DatasetResultSetStore {
  private resultSets: Map<string, DatasetResultSet> = new Map();

  public save(resultSet: DatasetResultSet): DatasetResultSet {
    ResultSetValidator.assertValid(resultSet);
    if (this.resultSets.has(resultSet.result_set_id)) {
      throw new ScientificDatasetExecutionError(
        'RESULT_SET_INVALID',
        `ResultSet with ID "${resultSet.result_set_id}" already exists.`
      );
    }
    const cloned = deepFreeze(JSON.parse(JSON.stringify(resultSet)));
    this.resultSets.set(resultSet.result_set_id, cloned);
    return cloned;
  }

  public get(resultSetId: string): DatasetResultSet | undefined {
    const found = this.resultSets.get(resultSetId);
    return found ? deepFreeze(JSON.parse(JSON.stringify(found))) : undefined;
  }

  public list(filter?: {
    dataset_version_id?: string;
    data_artifact_id?: string;
    module_id?: string;
    status?: DatasetResultSet['status'];
  }): DatasetResultSet[] {
    let all = Array.from(this.resultSets.values());
    if (filter?.dataset_version_id) {
      all = all.filter((r) => r.dataset_version_id === filter.dataset_version_id);
    }
    if (filter?.data_artifact_id) {
      all = all.filter((r) => r.data_artifact_id === filter.data_artifact_id);
    }
    if (filter?.module_id) {
      all = all.filter((r) => r.module_id === filter.module_id);
    }
    if (filter?.status) {
      all = all.filter((r) => r.status === filter.status);
    }
    return all.map((r) => deepFreeze(JSON.parse(JSON.stringify(r))));
  }

  public clear(): void {
    this.resultSets.clear();
  }
}
