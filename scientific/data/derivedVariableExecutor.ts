/**
 * Phase D7 — Scientific Data Layer: Derived Variable Execution Engine
 *
 * Orchestrates deterministic execution of DerivedVariables against single records
 * and batches of data artifacts by directly delegating to Phase C Scientific Execution Engine:
 * Module Resolver -> Input Validator -> Unit Engine -> Parameter Resolver -> Scientific Executor -> Validation Engine -> Provenance.
 *
 * Core Architectural Invariants:
 * 1. Zero Calculation Duplication: Never implements formula/algorithm/model execution.
 * 2. Exact Version Pinning: Pins exact module_version, parameter_snapshot, and dataset_version_id.
 * 3. BatchExecutor Reuse: Reuses Phase C BatchExecutor with FAIL_FAST and CONTINUE_ON_ERROR.
 * 4. Record Isolation: Zero state leakage between records.
 * 5. Strict Immutability: Source records and artifacts are never mutated.
 * 6. Provenance Integration: Every successful execution generates a cryptographic SHA-256 ProvenanceRecord.
 * 7. Security: Zero eval(), zero new Function().
 */

import {
  BatchErrorPolicy,
  BatchExecutionRequest,
  BatchRecord,
  DerivedVariable,
  DerivedVariableBatchExecutionResult,
  DerivedVariableRecordExecution,
  ExecutionResult,
  MissingPolicy,
  ParameterSet,
  ParameterSnapshot,
  ProvenanceRecord,
  ScientificBatchError,
  ScientificDerivedVariableError,
  ScientificParameter,
  ScientificResolverError,
  ScientificVariable,
  ValidationProfile
} from '../types';
import { ResolvableModule } from '../resolvers/moduleResolver';
import { findUnit } from '../units/unitConverter';
import { executeModuleRequest } from '../engine/executionAdapter';
import { BatchExecutor } from '../engine/batchExecutor';
import { buildProvenanceRecord, ProvenanceStore } from '../provenance/provenancePersistence';
import { areUnitsCompatible, DerivedVariableValidator } from './derivedVariable';

export interface ExecuteDerivedVariableOptions {
  derived_variable: DerivedVariable;
  records: Array<Record<string, unknown> | { record_id: string | number; data: Record<string, unknown> }>;
  source_artifact_id?: string;
  error_policy?: BatchErrorPolicy;
  available_modules?: ResolvableModule[];
  available_parameters?: ScientificParameter[];
  available_parameter_sets?: Record<string, ParameterSet>;
  variables?: Record<string, ScientificVariable>;
  validation_profile?: ValidationProfile;
  provenance_store?: ProvenanceStore;
  custom_timestamp?: string;
  metadata?: Record<string, unknown>;
}

export interface ExecuteSingleDerivedVariableOptions {
  derived_variable: DerivedVariable;
  record: Record<string, unknown>;
  record_id?: string | number;
  source_artifact_id?: string;
  available_modules?: ResolvableModule[];
  available_parameters?: ScientificParameter[];
  available_parameter_sets?: Record<string, ParameterSet>;
  variables?: Record<string, ScientificVariable>;
  validation_profile?: ValidationProfile;
  provenance_store?: ProvenanceStore;
  custom_timestamp?: string;
}

export class DerivedVariableExecutor {
  /**
   * Prepares inputs for a single record according to DerivedVariable source_mappings and contracts.
   */
  public static extractInputs(
    derived_variable: DerivedVariable,
    recordData: Record<string, unknown>
  ): {
    inputs: Record<string, { value: unknown; unit?: string } | undefined>;
    missingInputs: string[];
    fallbackUsed: boolean;
    warnings: string[];
  } {
    const inputs: Record<string, { value: unknown; unit?: string } | undefined> = {};
    const missingInputs: string[] = [];
    const warnings: string[] = [];
    let fallbackUsed = false;

    const inputContract = derived_variable.input_contract?.inputs || {};

    for (const mapping of derived_variable.source_mappings) {
      const inputName = mapping.module_input_name;
      const srcVarId = mapping.source_variable_id;
      const colName = mapping.column_name;
      const spec = inputContract[inputName];

      // Try reading value in precedence:
      // 1. colName (if configured)
      // 2. srcVarId
      // 3. inputName
      let rawVal: unknown = undefined;
      if (colName && recordData[colName] !== undefined) {
        rawVal = recordData[colName];
      } else if (recordData[srcVarId] !== undefined) {
        rawVal = recordData[srcVarId];
      } else if (recordData[inputName] !== undefined) {
        rawVal = recordData[inputName];
      }

      // Check if missing
      const isMissing = rawVal === undefined || rawVal === null || rawVal === '';
      const effectiveMissingPolicy: MissingPolicy =
        spec?.missing_policy || derived_variable.missing_policy || 'REQUIRED';

      if (isMissing) {
        if (effectiveMissingPolicy === 'REQUIRED' || effectiveMissingPolicy === 'ERROR') {
          missingInputs.push(inputName);
        } else if (effectiveMissingPolicy === 'DEFAULT') {
          if (spec?.datatype === 'number' || spec?.datatype === 'INTEGER') {
            rawVal = 0;
          } else {
            rawVal = null;
          }
          warnings.push(`Missing value for "${inputName}" defaulted.`);
        } else if (effectiveMissingPolicy === 'FALLBACK') {
          fallbackUsed = true;
          warnings.push(`Fallback signal triggered for missing "${inputName}".`);
        } else if (effectiveMissingPolicy === 'IGNORE') {
          continue;
        }
      }

      // Check unit
      const unit = mapping.unit || spec?.unit;
      inputs[inputName] = rawVal !== undefined ? { value: rawVal, unit } : undefined;
    }

    return {
      inputs,
      missingInputs,
      fallbackUsed,
      warnings
    };
  }

  /**
   * Executes a single record against a DerivedVariable definition.
   */
  public static executeSingle(options: ExecuteSingleDerivedVariableOptions): DerivedVariableRecordExecution {
    const {
      derived_variable,
      record,
      record_id = 0,
      source_artifact_id,
      available_modules = [],
      available_parameters = [],
      available_parameter_sets = {},
      variables = {},
      validation_profile,
      provenance_store,
      custom_timestamp
    } = options;

    DerivedVariableValidator.assertValid(derived_variable);

    // Extract inputs
    const extraction = this.extractInputs(derived_variable, record);

    if (extraction.missingInputs.length > 0) {
      const errMsg = `Missing required inputs: ${extraction.missingInputs.join(', ')}`;
      if (derived_variable.missing_policy === 'ERROR' || derived_variable.missing_policy === 'REQUIRED') {
        return {
          record_id,
          status: 'FAILED',
          error: `[DERIVED_VARIABLE_MISSING_INPUT] ${errMsg}`,
          warnings: extraction.warnings
        };
      }
    }

    // Execute via Phase C executeModuleRequest
    const parametersMap: Record<string, ScientificParameter> = {};
    for (const p of available_parameters) {
      parametersMap[p.parameter_id] = p;
    }

    try {
      const execResult = executeModuleRequest(
        {
          module_id: derived_variable.module_id,
          requested_version: derived_variable.module_version,
          parameter_set_id: derived_variable.parameter_set_id,
          inputs: extraction.inputs as any
        },
        undefined,
        parametersMap,
        variables,
        {
          available_modules,
          available_parameters,
          available_parameter_sets: Object.values(available_parameter_sets),
          parameter_snapshot: derived_variable.parameter_snapshot
        }
      );

      // Check primary output value
      let outputVal: unknown = undefined;
      let finalUnit: string = derived_variable.output_contract.unit;
      const targetVarId = derived_variable.variable_id;
      let selectedOutput: { value: number | string | boolean; unit?: string } | undefined = undefined;

      if (execResult.outputs && execResult.outputs[targetVarId] !== undefined) {
        selectedOutput = execResult.outputs[targetVarId];
      } else if (execResult.outputs && execResult.outputs[derived_variable.output_contract?.name || ''] !== undefined) {
        selectedOutput = execResult.outputs[derived_variable.output_contract?.name || ''];
      } else if (execResult.outputs) {
        const keys = Object.keys(execResult.outputs);
        if (keys.length > 0) {
          selectedOutput = execResult.outputs[keys[0]];
        }
      }

      if (selectedOutput) {
        outputVal = selectedOutput.value;
        if (selectedOutput.unit) {
          finalUnit = selectedOutput.unit;
        }
      }

      // Check output unit compatibility
      if (derived_variable.output_contract?.unit && finalUnit) {
        const isComp = areUnitsCompatible(derived_variable.output_contract.unit, finalUnit);
        if (!isComp) {
          throw new ScientificDerivedVariableError(
            'DERIVED_VARIABLE_INCOMPATIBLE_UNIT',
            `Execution output unit "${finalUnit}" is incompatible with output contract unit "${derived_variable.output_contract.unit}".`
          );
        }
      }

      // Persist provenance if store provided
      let provRecord: ProvenanceRecord | undefined;
      if (provenance_store) {
        provRecord = buildProvenanceRecord(execResult, {
          dataset_version_id: derived_variable.dataset_version_id,
          created_at: custom_timestamp
        });
        provenance_store.save(provRecord);
      }

      return {
        record_id,
        status: 'SUCCESS',
        output_value: outputVal,
        output_unit: finalUnit,
        execution_result: execResult,
        warnings: [...extraction.warnings, ...(execResult.warnings || [])],
        fallback_used: extraction.fallbackUsed || execResult.fallback_used
      };
    } catch (err: any) {
      if (err instanceof ScientificResolverError) {
        if (err.code === 'MODULE_VERSION_NOT_FOUND') {
          throw new ScientificDerivedVariableError(
            'DERIVED_VARIABLE_MODULE_VERSION_NOT_FOUND',
            `Pinned module version "${derived_variable.module_version}" for module "${derived_variable.module_id}" could not be resolved: ${err.message}`
          );
        }
        if (err.code === 'MODULE_NOT_FOUND') {
          throw new ScientificDerivedVariableError(
            'DERIVED_VARIABLE_MODULE_NOT_FOUND',
            `Pinned module "${derived_variable.module_id}" not found: ${err.message}`
          );
        }
      }
      return {
        record_id,
        status: 'FAILED',
        error: err?.message || String(err),
        warnings: extraction.warnings,
        fallback_used: extraction.fallbackUsed
      };
    }
  }

  /**
   * Executes a batch of records against a DerivedVariable definition by delegating to Phase C BatchExecutor.
   */
  public static executeBatch(options: ExecuteDerivedVariableOptions): DerivedVariableBatchExecutionResult {
    const {
      derived_variable,
      records,
      source_artifact_id,
      error_policy = 'CONTINUE_ON_ERROR',
      available_modules = [],
      available_parameters = [],
      available_parameter_sets = {},
      variables = {},
      validation_profile,
      provenance_store,
      custom_timestamp = new Date().toISOString(),
      metadata = {}
    } = options;

    DerivedVariableValidator.assertValid(derived_variable);

    // 1. Prepare batch records and check missing inputs upfront
    const batchRecords: BatchRecord[] = [];
    const recordExecutions: DerivedVariableRecordExecution[] = [];
    const provenanceRecords: ProvenanceRecord[] = [];

    const precomputedMissing = new Map<string, { errMsg: string; warnings: string[] }>();

    for (let i = 0; i < records.length; i++) {
      const rec = records[i];
      const record_id = (rec as any).record_id !== undefined ? String((rec as any).record_id) : `rec_${i + 1}`;
      const recordData = (rec as any).data !== undefined ? (rec as any).data : (rec as Record<string, unknown>);

      const extraction = this.extractInputs(derived_variable, recordData);

      if (extraction.missingInputs.length > 0 &&
         (derived_variable.missing_policy === 'ERROR' || derived_variable.missing_policy === 'REQUIRED')) {
        const errMsg = `[DERIVED_VARIABLE_MISSING_INPUT] Missing required inputs: ${extraction.missingInputs.join(', ')}`;
        precomputedMissing.set(record_id, { errMsg, warnings: extraction.warnings });

        if (error_policy === 'FAIL_FAST') {
          // Immediately record failure and fail batch
          return {
            derived_variable_id: derived_variable.derived_variable_id,
            dataset_version_id: derived_variable.dataset_version_id,
            source_artifact_id,
            module_id: derived_variable.module_id,
            module_version: derived_variable.module_version,
            status: 'FAILED',
            records: [
              {
                record_id,
                status: 'FAILED',
                error: errMsg,
                warnings: extraction.warnings
              }
            ],
            summary: {
              total: records.length,
              successful: 0,
              failed: 1,
              skipped: records.length - 1
            },
            created_at: custom_timestamp
          };
        }
      }

      batchRecords.push({
        record_id,
        inputs: extraction.inputs
      });
    }

    // 2. Delegate to Phase C BatchExecutor
    const batchRequest: BatchExecutionRequest = {
      batch_id: `batch_${derived_variable.derived_variable_id}_${Date.now()}`,
      module_id: derived_variable.module_id,
      requested_version: derived_variable.module_version,
      parameter_set_id: derived_variable.parameter_set_id,
      error_policy,
      records: batchRecords
    };

    let batchResult;
    try {
      batchResult = BatchExecutor.execute({
        request: batchRequest,
        available_modules,
        available_parameters,
        parameter_sets: available_parameter_sets,
        variables,
        validation_profile,
        custom_timestamp,
        metadata
      });
    } catch (err: any) {
      if (err instanceof ScientificResolverError) {
        if (err.code === 'MODULE_VERSION_NOT_FOUND') {
          throw new ScientificDerivedVariableError(
            'DERIVED_VARIABLE_MODULE_VERSION_NOT_FOUND',
            `Pinned module version "${derived_variable.module_version}" for module "${derived_variable.module_id}" could not be resolved: ${err.message}`
          );
        }
        if (err.code === 'MODULE_NOT_FOUND') {
          throw new ScientificDerivedVariableError(
            'DERIVED_VARIABLE_MODULE_NOT_FOUND',
            `Pinned module "${derived_variable.module_id}" not found: ${err.message}`
          );
        }
      }
      throw err;
    }

    // 3. Process BatchExecutor results into DerivedVariableRecordExecution
    let successfulCount = 0;
    let failedCount = 0;
    let skippedCount = 0;

    for (const bRecord of batchResult.records) {
      const missingInfo = precomputedMissing.get(bRecord.record_id);
      if (missingInfo) {
        recordExecutions.push({
          record_id: bRecord.record_id,
          status: 'FAILED',
          error: missingInfo.errMsg,
          warnings: missingInfo.warnings
        });
        failedCount++;
        continue;
      }

      const execRes = (bRecord as any).result || (bRecord as any).execution_result;
      if (bRecord.status === 'SUCCESS' && execRes) {
        // Locate target output value
        let val: unknown = undefined;
        let finalUnit: string = derived_variable.output_contract.unit;
        const targetVarId = derived_variable.variable_id;
        let selectedOutput: { value: number | string | boolean; unit?: string } | undefined = undefined;

        if (execRes.outputs && execRes.outputs[targetVarId] !== undefined) {
          selectedOutput = execRes.outputs[targetVarId];
        } else if (execRes.outputs && execRes.outputs[derived_variable.output_contract?.name || ''] !== undefined) {
          selectedOutput = execRes.outputs[derived_variable.output_contract?.name || ''];
        } else if (execRes.outputs) {
          const keys = Object.keys(execRes.outputs);
          if (keys.length > 0) selectedOutput = execRes.outputs[keys[0]];
        }

        if (selectedOutput) {
          val = selectedOutput.value;
          if (selectedOutput.unit) {
            finalUnit = selectedOutput.unit;
          }
        }

        // Check output unit
        if (derived_variable.output_contract?.unit && finalUnit) {
          const isComp = areUnitsCompatible(derived_variable.output_contract.unit, finalUnit);
          if (!isComp) {
            recordExecutions.push({
              record_id: bRecord.record_id,
              status: 'FAILED',
              error: `[DERIVED_VARIABLE_INCOMPATIBLE_UNIT] Output unit "${finalUnit}" incompatible with contract unit "${derived_variable.output_contract.unit}".`
            });
            failedCount++;
            continue;
          }
        }

        // Provenance record
        const prov = buildProvenanceRecord(execRes, {
          batch_id: batchRequest.batch_id,
          dataset_version_id: derived_variable.dataset_version_id,
          created_at: custom_timestamp
        });
        provenanceRecords.push(prov);
        if (provenance_store) {
          provenance_store.save(prov);
        }

        recordExecutions.push({
          record_id: bRecord.record_id,
          status: 'SUCCESS',
          output_value: val,
          output_unit: finalUnit,
          execution_result: execRes,
          warnings: execRes.warnings,
          fallback_used: execRes.fallback_used
        });
        successfulCount++;
      } else if (bRecord.status === 'SKIPPED') {
        recordExecutions.push({
          record_id: bRecord.record_id,
          status: 'SKIPPED',
          error: (bRecord as any).errors?.[0] || 'Skipped'
        });
        skippedCount++;
      } else {
        recordExecutions.push({
          record_id: bRecord.record_id,
          status: 'FAILED',
          error: (bRecord as any).errors?.[0] || 'Execution failed'
        });
        failedCount++;
      }
    }

    const batchStatus =
      failedCount === 0 ? 'SUCCESS' : successfulCount > 0 ? 'PARTIAL_SUCCESS' : 'FAILED';

    return {
      derived_variable_id: derived_variable.derived_variable_id,
      dataset_version_id: derived_variable.dataset_version_id,
      source_artifact_id,
      module_id: derived_variable.module_id,
      module_version: derived_variable.module_version,
      status: batchStatus,
      records: recordExecutions,
      summary: {
        total: records.length,
        successful: successfulCount,
        failed: failedCount,
        skipped: skippedCount
      },
      provenance_records: provenanceRecords,
      created_at: custom_timestamp
    };
  }
}
