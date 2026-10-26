/**
 * Phase D8 — Scientific Data Layer: Dataset Execution Request & ResultSet Contracts
 *
 * Implements validation and structural verification for DatasetExecutionRequest
 * and DatasetResultSet.
 *
 * Core Invariants:
 * 1. Exact Version Pinning: dataset_version_id, module_id, and module_version must be non-empty and pinned.
 * 2. Deterministic Validation: Invalid contracts are rejected before execution starts.
 * 3. Immutable Representations: Defensive deep freezing of request and result sets.
 */

import {
  DatasetExecutionConfiguration,
  DatasetExecutionRequest,
  DatasetMappingConfiguration,
  DatasetResultSet,
  ScientificDatasetExecutionError,
  ValidationGatePolicy
} from '../types';

export const VALID_BATCH_POLICIES = new Set(['FAIL_FAST', 'CONTINUE_ON_ERROR']);
export const VALID_GATE_POLICIES: Set<ValidationGatePolicy> = new Set([
  'BLOCK_ON_ERROR',
  'BLOCK_ON_WARNING_OR_ERROR',
  'PERMISSIVE',
  'NOT_CONFIGURED'
]);
export const VALID_RESULT_SET_STATUSES = new Set([
  'SUCCESS',
  'PARTIAL_SUCCESS',
  'FAILED',
  'BLOCKED'
]);

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

export class DatasetExecutionRequestValidator {
  /**
   * Asserts that a DatasetExecutionRequest is structurally valid and non-empty.
   */
  public static assertValid(request: unknown): asserts request is DatasetExecutionRequest {
    if (!request || typeof request !== 'object') {
      throw new ScientificDatasetExecutionError(
        'DATASET_EXECUTION_INVALID_REQUEST',
        'DatasetExecutionRequest must be a non-null object.'
      );
    }

    const req = request as Partial<DatasetExecutionRequest>;

    // 1. dataset_version_id
    if (!req.dataset_version_id || typeof req.dataset_version_id !== 'string' || !req.dataset_version_id.trim()) {
      throw new ScientificDatasetExecutionError(
        'DATASET_EXECUTION_INVALID_REQUEST',
        'DatasetExecutionRequest must contain a non-empty "dataset_version_id".'
      );
    }

    // 2. data_artifact_id
    if (!req.data_artifact_id || typeof req.data_artifact_id !== 'string' || !req.data_artifact_id.trim()) {
      throw new ScientificDatasetExecutionError(
        'DATASET_EXECUTION_INVALID_REQUEST',
        'DatasetExecutionRequest must contain a non-empty "data_artifact_id".'
      );
    }

    // 3. module_id
    if (!req.module_id || typeof req.module_id !== 'string' || !req.module_id.trim()) {
      throw new ScientificDatasetExecutionError(
        'DATASET_EXECUTION_INVALID_REQUEST',
        'DatasetExecutionRequest must contain a non-empty "module_id".'
      );
    }

    // 4. module_version
    if (!req.module_version || typeof req.module_version !== 'string' || !req.module_version.trim()) {
      throw new ScientificDatasetExecutionError(
        'DATASET_EXECUTION_INVALID_REQUEST',
        'DatasetExecutionRequest must contain a non-empty "module_version".'
      );
    }

    // 5. mapping_configuration
    if (!req.mapping_configuration || typeof req.mapping_configuration !== 'object') {
      throw new ScientificDatasetExecutionError(
        'DATASET_EXECUTION_INVALID_REQUEST',
        'DatasetExecutionRequest must contain a "mapping_configuration" object.'
      );
    }

    const mappingConfig = req.mapping_configuration as DatasetMappingConfiguration;
    const hasMappingId = typeof mappingConfig.mapping_id === 'string' && mappingConfig.mapping_id.trim().length > 0;
    const hasColumnMappings = Array.isArray(mappingConfig.column_mappings) && mappingConfig.column_mappings.length > 0;

    if (!hasMappingId && !hasColumnMappings) {
      throw new ScientificDatasetExecutionError(
        'DATASET_EXECUTION_INVALID_REQUEST',
        'mapping_configuration must provide either "mapping_id" or non-empty "column_mappings".'
      );
    }

    if (hasColumnMappings) {
      for (let i = 0; i < mappingConfig.column_mappings!.length; i++) {
        const cm = mappingConfig.column_mappings![i];
        if (!cm.source_column || typeof cm.source_column !== 'string' || !cm.source_column.trim()) {
          throw new ScientificDatasetExecutionError(
            'DATASET_EXECUTION_INVALID_REQUEST',
            `column_mappings[${i}] is missing non-empty "source_column".`
          );
        }
        if (!cm.module_input_name || typeof cm.module_input_name !== 'string' || !cm.module_input_name.trim()) {
          throw new ScientificDatasetExecutionError(
            'DATASET_EXECUTION_INVALID_REQUEST',
            `column_mappings[${i}] is missing non-empty "module_input_name".`
          );
        }
      }
    }

    // 6. execution_configuration
    if (!req.execution_configuration || typeof req.execution_configuration !== 'object') {
      throw new ScientificDatasetExecutionError(
        'DATASET_EXECUTION_INVALID_REQUEST',
        'DatasetExecutionRequest must contain an "execution_configuration" object.'
      );
    }

    const execConfig = req.execution_configuration as DatasetExecutionConfiguration;
    if (!VALID_BATCH_POLICIES.has(execConfig.batch_policy)) {
      throw new ScientificDatasetExecutionError(
        'DATASET_EXECUTION_INVALID_REQUEST',
        `Invalid batch_policy "${execConfig.batch_policy}". Must be one of: FAIL_FAST, CONTINUE_ON_ERROR.`
      );
    }

    // 7. validation_gate_policy (optional, defaults to BLOCK_ON_ERROR)
    if (req.validation_gate_policy && !VALID_GATE_POLICIES.has(req.validation_gate_policy)) {
      throw new ScientificDatasetExecutionError(
        'DATASET_EXECUTION_INVALID_REQUEST',
        `Invalid validation_gate_policy "${req.validation_gate_policy}". Must be one of: ${Array.from(
          VALID_GATE_POLICIES
        ).join(', ')}.`
      );
    }
  }
}

export class ResultSetValidator {
  /**
   * Asserts that a DatasetResultSet is structurally valid.
   */
  public static assertValid(resultSet: unknown): asserts resultSet is DatasetResultSet {
    if (!resultSet || typeof resultSet !== 'object') {
      throw new ScientificDatasetExecutionError(
        'RESULT_SET_INVALID',
        'DatasetResultSet must be a non-null object.'
      );
    }

    const rs = resultSet as Partial<DatasetResultSet>;

    if (!rs.result_set_id || typeof rs.result_set_id !== 'string' || !rs.result_set_id.trim()) {
      throw new ScientificDatasetExecutionError(
        'RESULT_SET_INVALID',
        'DatasetResultSet must contain a non-empty "result_set_id".'
      );
    }

    if (!rs.dataset_version_id || typeof rs.dataset_version_id !== 'string' || !rs.dataset_version_id.trim()) {
      throw new ScientificDatasetExecutionError(
        'RESULT_SET_INVALID',
        'DatasetResultSet must contain a non-empty "dataset_version_id".'
      );
    }

    if (!rs.data_artifact_id || typeof rs.data_artifact_id !== 'string' || !rs.data_artifact_id.trim()) {
      throw new ScientificDatasetExecutionError(
        'RESULT_SET_INVALID',
        'DatasetResultSet must contain a non-empty "data_artifact_id".'
      );
    }

    if (!rs.module_id || typeof rs.module_id !== 'string' || !rs.module_id.trim()) {
      throw new ScientificDatasetExecutionError(
        'RESULT_SET_INVALID',
        'DatasetResultSet must contain a non-empty "module_id".'
      );
    }

    if (!rs.module_version || typeof rs.module_version !== 'string' || !rs.module_version.trim()) {
      throw new ScientificDatasetExecutionError(
        'RESULT_SET_INVALID',
        'DatasetResultSet must contain a non-empty "module_version".'
      );
    }

    if (!VALID_RESULT_SET_STATUSES.has(rs.status as any)) {
      throw new ScientificDatasetExecutionError(
        'RESULT_SET_INVALID',
        `Invalid ResultSet status "${rs.status}".`
      );
    }

    if (!rs.summary || typeof rs.summary !== 'object') {
      throw new ScientificDatasetExecutionError(
        'RESULT_SET_INVALID',
        'DatasetResultSet must contain a "summary" object.'
      );
    }

    if (!Array.isArray(rs.records)) {
      throw new ScientificDatasetExecutionError(
        'RESULT_SET_INVALID',
        'DatasetResultSet must contain a "records" array.'
      );
    }

    if (!Array.isArray(rs.execution_ids)) {
      throw new ScientificDatasetExecutionError(
        'RESULT_SET_INVALID',
        'DatasetResultSet must contain an "execution_ids" array.'
      );
    }
  }
}
