/**
 * Phase D7 — Scientific Data Layer: Derived Variable Contract & Validation
 *
 * Implements the typed DerivedVariable contract, structural validation,
 * immutability guarantees, and collision detection.
 *
 * Explicitly decoupled from:
 * - Scientific content / clinical boundaries / physiological interpretation
 * - AST calculations (delegated to Phase C Execution Adapter)
 * - Automatic heuristic column guessing or variable name assumptions
 */

import {
  DataType,
  DerivedVariable,
  DerivedVariableErrorCode,
  DerivedVariableInputContract,
  DerivedVariableModuleType,
  DerivedVariableOutputContract,
  DerivedVariableSourceMapping,
  DerivedVariableStatus,
  MissingPolicy,
  RegistryStatus,
  ScientificDerivedVariableError
} from '../types';
import { findUnit } from '../units/unitConverter';
import { DatasetVersionStore } from './datasetVersion';
import { VariableStore } from './variableRegistry';
import { VariableMappingStore } from './variableMapping';

export const VALID_DERIVED_MODULE_TYPES: ReadonlySet<DerivedVariableModuleType> = new Set<DerivedVariableModuleType>([
  'FORMULA',
  'ALGORITHM',
  'MODEL'
]);

export const VALID_DERIVED_STATUSES: ReadonlySet<RegistryStatus> = new Set<RegistryStatus>([
  'DRAFT',
  'EXPERIMENTAL',
  'VALIDATION',
  'VERIFIED',
  'DEPRECATED'
]);

export const VALID_MISSING_POLICIES: ReadonlySet<MissingPolicy> = new Set<MissingPolicy>([
  'REQUIRED',
  'OPTIONAL',
  'IGNORE',
  'DEFAULT',
  'FALLBACK',
  'ERROR'
]);

export interface DerivedVariableValidationResult {
  isValid: boolean;
  errors: string[];
}

export function deepFreeze<T>(obj: T): T {
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

/**
 * Checks physical unit compatibility between two unit symbols.
 */
export function areUnitsCompatible(unitA?: string, unitB?: string): boolean {
  if (!unitA || !unitB) return true;
  const aNorm = unitA.trim().toLowerCase();
  const bNorm = unitB.trim().toLowerCase();
  if (aNorm === bNorm) return true;

  if (
    aNorm === 'unitless' || bNorm === 'unitless' ||
    aNorm === 'dimensionless' || bNorm === 'dimensionless' ||
    aNorm === 'none' || bNorm === 'none'
  ) {
    return true;
  }

  const defA = findUnit(unitA);
  const defB = findUnit(unitB);
  if (!defA || !defB) {
    return true;
  }

  return (
    defA.measurement_type === defB.measurement_type ||
    defA.measurement_type === 'dimensionless' ||
    defB.measurement_type === 'dimensionless'
  );
}

/**
 * Structural contract validator for DerivedVariable entities.
 */
export class DerivedVariableValidator {
  public static validate(data: unknown): DerivedVariableValidationResult {
    const errors: string[] = [];

    if (!data || typeof data !== 'object') {
      return {
        isValid: false,
        errors: ['DerivedVariable payload must be a non-null object.']
      };
    }

    const dv = data as Partial<DerivedVariable>;

    // 1. derived_variable_id
    if (!dv.derived_variable_id || typeof dv.derived_variable_id !== 'string' || dv.derived_variable_id.trim() === '') {
      errors.push('derived_variable_id is required and must be a non-empty string identifier.');
    }

    // 2. variable_id
    if (!dv.variable_id || typeof dv.variable_id !== 'string' || dv.variable_id.trim() === '') {
      errors.push('variable_id is required and must be a non-empty string identifier.');
    }

    // 3. name
    if (!dv.name || typeof dv.name !== 'string' || dv.name.trim() === '') {
      errors.push('name is required and must be a non-empty string.');
    }

    // 4. description
    if (!dv.description || typeof dv.description !== 'string' || dv.description.trim() === '') {
      errors.push('description is required and must be a non-empty string.');
    }

    // 5. dataset_version_id
    if (!dv.dataset_version_id || typeof dv.dataset_version_id !== 'string' || dv.dataset_version_id.trim() === '') {
      errors.push('dataset_version_id is required and must be a non-empty string identifier.');
    }

    // 6. source_variables
    if (!Array.isArray(dv.source_variables) || dv.source_variables.length === 0) {
      errors.push('source_variables is required and must be a non-empty array of source variable IDs.');
    } else {
      for (let i = 0; i < dv.source_variables.length; i++) {
        const sv = dv.source_variables[i];
        if (!sv || typeof sv !== 'string' || sv.trim() === '') {
          errors.push(`source_variables[${i}] must be a non-empty string identifier.`);
        }
      }
    }

    // 7. source_mappings
    if (!Array.isArray(dv.source_mappings)) {
      errors.push('source_mappings is required and must be an array.');
    } else {
      for (let i = 0; i < dv.source_mappings.length; i++) {
        const sm = dv.source_mappings[i];
        if (!sm || typeof sm !== 'object') {
          errors.push(`source_mappings[${i}] must be an object.`);
          continue;
        }
        if (!sm.source_variable_id || typeof sm.source_variable_id !== 'string' || sm.source_variable_id.trim() === '') {
          errors.push(`source_mappings[${i}].source_variable_id is required and must be a non-empty string.`);
        }
        if (!sm.module_input_name || typeof sm.module_input_name !== 'string' || sm.module_input_name.trim() === '') {
          errors.push(`source_mappings[${i}].module_input_name is required and must be a non-empty string.`);
        }
      }
    }

    // 8. module_type
    if (!dv.module_type || !VALID_DERIVED_MODULE_TYPES.has(dv.module_type as DerivedVariableModuleType)) {
      errors.push(
        `module_type is required and must be one of: ${Array.from(VALID_DERIVED_MODULE_TYPES).join(', ')}.`
      );
    }

    // 9. module_id
    if (!dv.module_id || typeof dv.module_id !== 'string' || dv.module_id.trim() === '') {
      errors.push('module_id is required and must be a non-empty string identifier.');
    }

    // 10. module_version
    if (!dv.module_version || typeof dv.module_version !== 'string' || dv.module_version.trim() === '') {
      errors.push('module_version is required and must be a non-empty string representing exact pinned version.');
    }

    // 11. input_contract
    if (!dv.input_contract || typeof dv.input_contract !== 'object' || typeof dv.input_contract.inputs !== 'object') {
      errors.push('input_contract is required and must have an "inputs" record.');
    }

    // 12. output_contract
    if (!dv.output_contract || typeof dv.output_contract !== 'object') {
      errors.push('output_contract is required and must be an object.');
    } else {
      if (!dv.output_contract.unit || typeof dv.output_contract.unit !== 'string' || dv.output_contract.unit.trim() === '') {
        errors.push('output_contract.unit is required and must be a non-empty unit string.');
      }
      if (!dv.output_contract.datatype || typeof dv.output_contract.datatype !== 'string') {
        errors.push('output_contract.datatype is required and must be a string.');
      }
    }

    // 13. missing_policy
    if (!dv.missing_policy || !VALID_MISSING_POLICIES.has(dv.missing_policy as MissingPolicy)) {
      errors.push(
        `missing_policy is required and must be one of: ${Array.from(VALID_MISSING_POLICIES).join(', ')}.`
      );
    }

    // 14. status
    if (dv.status === ('VALIDATED' as any)) {
      errors.push('Status "VALIDATED" is not permitted. Use "VALIDATION" or "VERIFIED".');
    } else if (!dv.status || !VALID_DERIVED_STATUSES.has(dv.status as RegistryStatus)) {
      errors.push(
        `status is required and must be one of: ${Array.from(VALID_DERIVED_STATUSES).join(', ')}.`
      );
    }

    // 15. created_at
    if (!dv.created_at || typeof dv.created_at !== 'string' || Number.isNaN(Date.parse(dv.created_at))) {
      errors.push('created_at is required and must be a valid ISO 8601 timestamp string.');
    }

    // 16. created_by
    if (!dv.created_by || typeof dv.created_by !== 'string' || dv.created_by.trim() === '') {
      errors.push('created_by is required and must be a non-empty string identifier.');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  public static assertValid(data: unknown): asserts data is DerivedVariable {
    const result = DerivedVariableValidator.validate(data);
    if (!result.isValid) {
      const firstErr = result.errors[0] || 'Invalid DerivedVariable contract.';
      const lower = firstErr.toLowerCase();
      let code: DerivedVariableErrorCode = 'DERIVED_VARIABLE_INVALID_CONTRACT';

      if (lower.includes('derived_variable_id')) code = 'DERIVED_VARIABLE_EMPTY_ID';
      else if (lower.includes('variable_id is required')) code = 'DERIVED_VARIABLE_EMPTY_VARIABLE_ID';
      else if (lower.includes('dataset_version_id')) code = 'DERIVED_VARIABLE_EMPTY_DATASET_VERSION_ID';
      else if (lower.includes('module_type')) code = 'DERIVED_VARIABLE_INVALID_MODULE_TYPE';
      else if (lower.includes('module_id')) code = 'DERIVED_VARIABLE_EMPTY_MODULE_ID';
      else if (lower.includes('module_version')) code = 'DERIVED_VARIABLE_EMPTY_MODULE_VERSION';
      else if (lower.includes('source_variables')) code = 'DERIVED_VARIABLE_SOURCE_VARIABLES_EMPTY';
      else if (lower.includes('missing_policy')) code = 'DERIVED_VARIABLE_INVALID_MISSING_POLICY';
      else if (lower.includes('status')) code = 'DERIVED_VARIABLE_INVALID_STATUS';

      throw new ScientificDerivedVariableError(code, firstErr, { errors: result.errors });
    }
  }
}
