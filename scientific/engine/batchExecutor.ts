/**
 * NutriBodySim — Batch Execution Engine
 * 
 * Phase C7: Batch Execution Engine
 * Orchestrates deterministic multi-record execution against a single resolved ScientificModule.
 * 
 * Core Architectural Invariants:
 * 1. Orchestration Layer Only: Never duplicates formula/algorithm/model execution or validation logic.
 * 2. Source of Truth: Each record is dispatched through the unified C1–C6 execution & validation pipeline.
 * 3. Parameter Snapshot: Pinned & frozen once at batch initialization across all records.
 * 4. Error Policies: Strict deterministic FAIL_FAST or CONTINUE_ON_ERROR handling.
 * 5. Execution Isolation: Independent execution IDs, zero state bleed between records.
 * 6. No Statistics: Accounting metrics only (total, success, failed, skipped).
 * 7. Security: Zero eval(), zero new Function(), zero dynamic JS string execution.
 */

import {
  BatchErrorPolicy,
  BatchExecutionRequest,
  BatchExecutionResult,
  BatchExecutionSummary,
  BatchRecord,
  BatchRecordResult,
  BatchStatus,
  ExecutionResult,
  ParameterSet,
  ParameterSnapshot,
  ScientificBatchError,
  ScientificParameter,
  ScientificResolverError,
  ScientificVariable,
  ValidationProfile
} from '../types';
import { ModuleResolver, ResolvableModule } from '../resolvers/moduleResolver';
import { ParameterResolver } from '../resolvers/parameterResolver';
import { executeModuleRequest } from './executionAdapter';
import { ValidationEngine } from './validationEngine';
import crypto from 'crypto';

export interface ExecuteBatchOptions {
  request: BatchExecutionRequest;
  available_modules?: ResolvableModule[];
  available_parameters?: ScientificParameter[];
  parameter_sets?: Record<string, ParameterSet>;
  variables?: Record<string, ScientificVariable>;
  validation_profile?: ValidationProfile;
  max_records?: number;
  custom_timestamp?: string;
  metadata?: Record<string, unknown>;
}

export class BatchExecutor {
  /**
   * Deterministically executes a batch of input records against a resolved ScientificModule.
   */
  static execute(options: ExecuteBatchOptions): BatchExecutionResult {
    const {
      request,
      available_modules = [],
      available_parameters = [],
      parameter_sets = {},
      variables = {},
      validation_profile,
      max_records: optionMaxRecords,
      custom_timestamp,
      metadata = {}
    } = options;

    // 1. Guard check request structure
    if (!request || typeof request !== 'object') {
      throw new ScientificBatchError('BATCH_INVALID_REQUEST', 'BatchExecutionRequest is required and must be an object.');
    }

    if (!request.batch_id || typeof request.batch_id !== 'string' || !request.batch_id.trim()) {
      throw new ScientificBatchError('BATCH_INVALID_REQUEST', 'BatchExecutionRequest is missing a valid "batch_id".');
    }

    if (!request.module_id || typeof request.module_id !== 'string' || !request.module_id.trim()) {
      throw new ScientificBatchError('BATCH_INVALID_REQUEST', 'BatchExecutionRequest is missing a valid "module_id".');
    }

    const records: BatchRecord[] = request.records || [];
    if (!Array.isArray(records)) {
      throw new ScientificBatchError('BATCH_INVALID_REQUEST', 'BatchExecutionRequest "records" property must be an array.');
    }

    // 2. Validate batch sizing constraints
    const maxRecords = request.configuration?.max_records || optionMaxRecords;
    if (maxRecords !== undefined && maxRecords > 0 && records.length > maxRecords) {
      throw new ScientificBatchError(
        'BATCH_SIZE_LIMIT_EXCEEDED',
        `Batch record count (${records.length}) exceeds configured maximum limit (${maxRecords}). No records were truncated.`,
        { record_count: records.length, max_records: maxRecords }
      );
    }

    // 3. Validate unique and non-empty record identifiers
    const seenRecordIds = new Set<string>();
    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      if (!record || typeof record !== 'object') {
        throw new ScientificBatchError(
          'BATCH_INVALID_REQUEST',
          `Batch record at index ${i} is invalid or null.`
        );
      }

      const recId = record.record_id;
      if (!recId || typeof recId !== 'string' || !recId.trim()) {
        throw new ScientificBatchError(
          'BATCH_EMPTY_RECORD_ID',
          `Batch record at index ${i} is missing a non-empty "record_id".`
        );
      }

      if (seenRecordIds.has(recId)) {
        throw new ScientificBatchError(
          'BATCH_DUPLICATE_RECORD_ID',
          `Duplicate record_id "${recId}" detected at index ${i}. Record IDs must be strictly unique.`,
          { duplicate_id: recId, index: i }
        );
      }
      seenRecordIds.add(recId);
    }

    // 4. Resolve Target Module once for the entire batch
    let resolvedTargetModule: ResolvableModule;
    let moduleVersion: string;
    try {
      const resolvedModuleMeta = ModuleResolver.resolve({
        module_id: request.module_id,
        requested_version: request.requested_version,
        modules: available_modules
      });
      resolvedTargetModule = resolvedModuleMeta.module;
      moduleVersion = resolvedModuleMeta.module_version || resolvedTargetModule.version || '1.0.0';
    } catch (err: any) {
      if (err instanceof ScientificResolverError) {
        if (err.code === 'MODULE_VERSION_NOT_FOUND') {
          throw new ScientificBatchError(
            'BATCH_VERSION_RESOLUTION_FAILED',
            `Batch module version resolution failed for "${request.module_id}": ${err.message}`,
            { module_id: request.module_id, requested_version: request.requested_version }
          );
        }
        throw new ScientificBatchError(
          'BATCH_MODULE_NOT_FOUND',
          `Batch module resolution failed: ${err.message}`,
          { module_id: request.module_id }
        );
      }
      throw new ScientificBatchError(
        'BATCH_MODULE_NOT_FOUND',
        `Unexpected error during batch module resolution: ${err?.message || err}`,
        { module_id: request.module_id }
      );
    }

    // 5. Resolve & Freeze Parameter Snapshot once for the entire batch
    let parameterSnapshot: ParameterSnapshot | undefined;
    let resolvedParametersMap: Record<string, ScientificParameter> = {};

    try {
      const paramResolution = ParameterResolver.resolve({
        module: resolvedTargetModule as any,
        parameter_set_id: request.parameter_set_id,
        available_parameters,
        available_parameter_sets: Object.values(parameter_sets)
      });

      parameterSnapshot = Object.freeze(paramResolution.snapshot);

      // Build parameters dictionary for execution pipeline
      for (const p of available_parameters) {
        resolvedParametersMap[p.parameter_id] = p;
      }
    } catch (err: any) {
      throw new ScientificBatchError(
        'BATCH_PARAMETER_RESOLUTION_FAILED',
        `Batch parameter resolution failed for module "${request.module_id}": ${err?.message || err}`,
        { parameter_set_id: request.parameter_set_id }
      );
    }

    // Determine error policy
    const errorPolicy: BatchErrorPolicy =
      request.error_policy ||
      request.configuration?.error_policy ||
      'CONTINUE_ON_ERROR';

    // Active validation profile (from request or options)
    const activeValidationProfile = request.validation_profile || validation_profile;

    const recordResults: BatchRecordResult[] = [];
    let failFastTriggered = false;

    // 6. Handle Empty Batch edge case cleanly
    if (records.length === 0) {
      return {
        batch_id: request.batch_id,
        module_id: request.module_id,
        module_version: moduleVersion,
        dataset_version_id: request.dataset_version_id,
        parameter_set_id: request.parameter_set_id,
        total_records: 0,
        successful_records: 0,
        failed_records: 0,
        skipped_records: 0,
        status: 'COMPLETED',
        records: [],
        summary: {
          total_records: 0,
          successful_records: 0,
          failed_records: 0,
          skipped_records: 0
        },
        timestamp: custom_timestamp || new Date().toISOString(),
        metadata
      };
    }

    // 7. Execute Records Sequentially
    for (let idx = 0; idx < records.length; idx++) {
      const record = records[idx];

      // If FAIL_FAST was triggered by a prior record, mark as SKIPPED
      if (failFastTriggered) {
        recordResults.push({
          record_id: record.record_id,
          status: 'SKIPPED',
          warnings: [],
          errors: ['Execution skipped due to prior failure under FAIL_FAST policy.']
        });
        continue;
      }

      // Generate distinct execution identifier for this record
      const recordExecutionId = `EXEC_${request.batch_id}_${record.record_id}_${crypto.randomBytes(4).toString('hex')}`;

      try {
        // Execute record through standard C1–C5 execution pipeline
        const execResult: ExecutionResult = executeModuleRequest(
          {
            module_id: request.module_id,
            requested_version: moduleVersion,
            inputs: record.inputs as any,
            parameter_set_id: request.parameter_set_id
          },
          resolvedTargetModule,
          resolvedParametersMap,
          variables,
          {
            available_modules,
            parameter_snapshot: parameterSnapshot,
            execution_id: recordExecutionId
          }
        );

        // Run Phase C6 Validation if a profile is configured
        let validationResult: any = undefined;
        if (activeValidationProfile) {
          validationResult = ValidationEngine.evaluate({
            execution_result: execResult,
            profile: activeValidationProfile
          });
        }

        recordResults.push({
          record_id: record.record_id,
          status: 'SUCCESS',
          execution_id: execResult.execution_id,
          result: execResult,
          validation: validationResult,
          warnings: execResult.warnings || [],
          errors: execResult.errors || []
        });
      } catch (execErr: any) {
        const errorMsg = execErr?.message || String(execErr);

        recordResults.push({
          record_id: record.record_id,
          status: 'FAILED',
          execution_id: recordExecutionId,
          result: undefined,
          validation: undefined,
          warnings: [],
          errors: [errorMsg]
        });

        if (errorPolicy === 'FAIL_FAST') {
          failFastTriggered = true;
        }
      }
    }

    // 8. Compile Accounting Summary
    const totalRecords = recordResults.length;
    const successfulRecords = recordResults.filter(r => r.status === 'SUCCESS').length;
    const failedRecords = recordResults.filter(r => r.status === 'FAILED').length;
    const skippedRecords = recordResults.filter(r => r.status === 'SKIPPED').length;

    let overallStatus: BatchStatus = 'COMPLETED';
    if (successfulRecords === 0 && totalRecords > 0) {
      overallStatus = 'FAILED';
    } else if (failedRecords > 0 || skippedRecords > 0) {
      overallStatus = 'COMPLETED_WITH_ERRORS';
    }

    const summary: BatchExecutionSummary = {
      total_records: totalRecords,
      successful_records: successfulRecords,
      failed_records: failedRecords,
      skipped_records: skippedRecords
    };

    return {
      batch_id: request.batch_id,
      module_id: request.module_id,
      module_version: moduleVersion,
      dataset_version_id: request.dataset_version_id,
      parameter_set_id: request.parameter_set_id,
      total_records: totalRecords,
      successful_records: successfulRecords,
      failed_records: failedRecords,
      skipped_records: skippedRecords,
      status: overallStatus,
      records: recordResults,
      summary,
      timestamp: custom_timestamp || new Date().toISOString(),
      metadata
    };
  }
}
