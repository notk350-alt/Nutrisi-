/**
 * Phase D7 — Scientific Data Layer: Derived Data Artifact Builder
 *
 * Produces new, immutable DataArtifacts containing appended derived variable outputs,
 * strictly guaranteeing that source artifacts are NEVER mutated in-place,
 * preserving SHA-256 integrity, lineage, state transitions, and collision protection.
 *
 * Core Invariants:
 * 1. Source Immutability: Source artifact (RAW, WORKING_COPY, CLEANED, VALIDATED, ANALYSIS_READY) is never mutated.
 * 2. Strict Lineage: New artifact sets parent_artifact_id = source_artifact.artifact_id.
 * 3. Cross-Version Rejection: Rejects if source artifact dataset_version_id !== derived_variable.dataset_version_id.
 * 4. Collision Protection: Forbids duplicate derived column names without explicit override.
 * 5. Cryptographic Integrity: Computes deterministic SHA-256 via computeDataArtifactChecksum.
 */

import {
  DataArtifact,
  DataState,
  DerivedVariable,
  DerivedVariableBatchExecutionResult,
  ScientificDerivedVariableError
} from '../types';
import {
  ALLOWED_STATE_TRANSITIONS,
  computeDataArtifactChecksum,
  DataArtifactValidator
} from './dataStatePipeline';
import { deepFreeze } from './derivedVariable';

export interface CreateDerivedArtifactOptions {
  source_artifact: DataArtifact;
  derived_variable: DerivedVariable;
  execution_result: DerivedVariableBatchExecutionResult;
  target_column_name?: string;
  new_artifact_id?: string;
  target_state?: DataState;
  created_by?: string;
  description?: string;
  allow_overwrite_column?: boolean;
  custom_timestamp?: string;
  metadata?: Record<string, unknown>;
}

export class DerivedArtifactBuilder {
  /**
   * Builds a new immutable DataArtifact with derived variable results appended.
   * Source artifact remains 100% untouched.
   */
  public static createDerivedArtifact(options: CreateDerivedArtifactOptions): DataArtifact {
    const {
      source_artifact,
      derived_variable,
      execution_result,
      target_column_name,
      new_artifact_id = `art_derived_${derived_variable.derived_variable_id}_${Date.now()}`,
      target_state,
      created_by = source_artifact.created_by,
      description,
      allow_overwrite_column = false,
      custom_timestamp = new Date().toISOString(),
      metadata = {}
    } = options;

    // 1. Guard check contracts
    DataArtifactValidator.assertValid(source_artifact);

    // 2. Cross-version rejection
    if (source_artifact.dataset_version_id !== derived_variable.dataset_version_id) {
      throw new ScientificDerivedVariableError(
        'DERIVED_VARIABLE_DATASET_VERSION_MISMATCH',
        `Dataset version mismatch: Source artifact version "${source_artifact.dataset_version_id}" does not match DerivedVariable version "${derived_variable.dataset_version_id}".`
      );
    }

    if (execution_result.dataset_version_id !== derived_variable.dataset_version_id) {
      throw new ScientificDerivedVariableError(
        'DERIVED_VARIABLE_DATASET_VERSION_MISMATCH',
        `Execution result dataset version "${execution_result.dataset_version_id}" does not match DerivedVariable version "${derived_variable.dataset_version_id}".`
      );
    }

    // 3. Determine target column name
    const colName =
      target_column_name ||
      derived_variable.output_contract?.name ||
      derived_variable.variable_id;

    // 4. Extract records from source artifact safely without mutating
    const rawRef = source_artifact.data_reference;
    let sourceRecords: Record<string, unknown>[] = [];

    if (Array.isArray(rawRef)) {
      sourceRecords = rawRef as Record<string, unknown>[];
    } else if (rawRef && typeof rawRef === 'object' && Array.isArray((rawRef as any).records)) {
      sourceRecords = (rawRef as any).records;
    } else if (source_artifact.metadata?.records && Array.isArray(source_artifact.metadata.records)) {
      sourceRecords = source_artifact.metadata.records as Record<string, unknown>[];
    }

    // 5. Collision protection: Check if colName already exists in source records
    if (sourceRecords.length > 0) {
      const firstRow = sourceRecords[0];
      if (firstRow && Object.prototype.hasOwnProperty.call(firstRow, colName) && !allow_overwrite_column) {
        throw new ScientificDerivedVariableError(
          'DERIVED_VARIABLE_COLLISION',
          `Derived column "${colName}" already exists in source artifact records. Collision protection forbids automatic renaming (e.g. ${colName} -> ${colName}_2).`
        );
      }
    }

    // 6. Build new records with derived column added
    const recordResultMap = new Map<string, unknown>();
    for (let i = 0; i < execution_result.records.length; i++) {
      const recExec = execution_result.records[i];
      recordResultMap.set(String(recExec.record_id), recExec.output_value);
      // Also map numeric index
      recordResultMap.set(String(i), recExec.output_value);
      recordResultMap.set(`rec_${i + 1}`, recExec.output_value);
    }

    const newRecords: Record<string, unknown>[] = [];
    for (let i = 0; i < sourceRecords.length; i++) {
      const oldRow = sourceRecords[i];
      const recId = (oldRow as any).record_id !== undefined ? String((oldRow as any).record_id) : `rec_${i + 1}`;
      
      const derivedVal = recordResultMap.has(recId)
        ? recordResultMap.get(recId)
        : recordResultMap.has(String(i))
          ? recordResultMap.get(String(i))
          : null;

      newRecords.push({
        ...oldRow,
        [colName]: derivedVal !== undefined ? derivedVal : null
      });
    }

    // 7. Resolve target state respecting ALLOWED_STATE_TRANSITIONS
    let effectiveTargetState: DataState;
    if (target_state) {
      effectiveTargetState = target_state;
    } else {
      // Default to source state if allowed to stay in same state, otherwise legal next state
      if (source_artifact.state === 'RAW') {
        effectiveTargetState = 'WORKING_COPY';
      } else {
        effectiveTargetState = source_artifact.state;
      }
    }

    // Verify state transition legality
    const allowedTransitions = ALLOWED_STATE_TRANSITIONS.get(source_artifact.state);
    if (!allowedTransitions || !allowedTransitions.has(effectiveTargetState)) {
      throw new ScientificDerivedVariableError(
        'DERIVED_VARIABLE_INVALID_CONTRACT',
        `Illegal state transition from "${source_artifact.state}" to "${effectiveTargetState}" for derived artifact.`
      );
    }

    // 8. Calculate new column and record counts
    const newColCount =
      sourceRecords.length > 0
        ? Object.keys(newRecords[0]).length
        : (source_artifact.column_count || 0) + 1;

    const newRecordCount =
      sourceRecords.length > 0 ? newRecords.length : source_artifact.record_count || 0;

    // 9. Construct raw artifact and compute checksum
    const rawArtifact: Omit<DataArtifact, 'checksum'> = {
      artifact_id: new_artifact_id,
      dataset_version_id: source_artifact.dataset_version_id,
      state: effectiveTargetState,
      parent_artifact_id: source_artifact.artifact_id,
      created_at: custom_timestamp,
      created_by,
      data_reference: newRecords as any,
      record_count: newRecordCount,
      column_count: newColCount,
      description:
        description ||
        `Derived artifact produced by "${derived_variable.derived_variable_id}" (${derived_variable.name}) from parent "${source_artifact.artifact_id}".`,
      metadata: {
        ...metadata,
        derived_variable_id: derived_variable.derived_variable_id,
        variable_id: derived_variable.variable_id,
        derived_column: colName,
        module_id: derived_variable.module_id,
        module_version: derived_variable.module_version,
        derivation_timestamp: custom_timestamp
      }
    };

    const checksum = computeDataArtifactChecksum(rawArtifact);

    const finalArtifact: DataArtifact = {
      ...rawArtifact,
      checksum
    };

    DataArtifactValidator.assertValid(finalArtifact);

    return deepFreeze(JSON.parse(JSON.stringify(finalArtifact)));
  }
}
