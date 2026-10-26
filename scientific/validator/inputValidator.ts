/**
 * NutriBodySim — Standalone Scientific Input Validator
 * 
 * Phase C3: Standalone Input Validator
 * Decouples input validation from CalculationEngine into an independent component.
 * Validates: required/optional fields, missing policies, datatypes, unit compatibility,
 * dimensional consistency, unit normalization, and physiological/clinical ranges.
 * 
 * Pure Scientific Core component: Zero dependencies on DOM, React, Express, or Database.
 */

import {
  DataType,
  FormulaInputSpec,
  MissingPolicy,
  ScientificFormula,
  ScientificVariable,
  ValidationDetail,
  InputValidationResult
} from '../types';
import { convertUnit, findUnit } from '../units/unitConverter';

export interface ValidateInputsOptions {
  module: ScientificFormula;
  inputs: Record<string, { value: unknown; unit?: string } | undefined>;
  variables?: Record<string, ScientificVariable>;
  execution_context?: Record<string, unknown>;
}

export interface InputValidatorStep {
  action: string;
  detail: string;
  intermediate_value?: number | string | boolean | null;
  unit?: string;
}

export interface ExtendedValidationResult extends InputValidationResult {
  trace_steps: InputValidatorStep[];
}

export class InputValidator {
  /**
   * Deterministically validates, normalizes, and range-checks inputs against module input specifications.
   */
  static validate(options: ValidateInputsOptions): ExtendedValidationResult {
    const { module, inputs, variables = {} } = options;

    const normalized_inputs: Record<string, { value: number; unit: string; original_unit?: string }> = {};
    const warnings: string[] = [];
    const errors: string[] = [];
    let fallback_required = false;
    const validation_details: Record<string, ValidationDetail> = {};
    const trace_steps: InputValidatorStep[] = [];

    const specs: FormulaInputSpec[] = module.inputs || [];

    for (const spec of specs) {
      const varId = spec.variable_id;
      const varName = spec.name;
      const varMeta = variables[varId];

      // Resolve effective missing policy
      let policy: MissingPolicy = spec.missing_policy || (
        spec.required
          ? 'REQUIRED'
          : (spec.default_value !== undefined ? 'DEFAULT' : 'OPTIONAL')
      );

      // Locate input entry (lookup by variable_id or name)
      const rawEntry = inputs[varId] !== undefined ? inputs[varId] : inputs[varName];

      // Distinguish missing vs null vs provided
      const isNotProvided = rawEntry === undefined;
      const isNull = rawEntry !== undefined && (rawEntry === null || rawEntry.value === null);
      const isEmpty = rawEntry !== undefined && rawEntry.value === '';
      const isMissing = isNotProvided || isNull || isEmpty;

      // Handle IGNORE policy first
      if (policy === 'IGNORE') {
        validation_details[varId] = {
          variable_id: varId,
          name: varName,
          status: 'SKIPPED',
          message: `Input "${varName}" skipped under IGNORE policy.`
        };
        continue;
      }

      // Handle Missing scenarios
      if (isMissing) {
        if (policy === 'REQUIRED') {
          const detailMsg = isNull
            ? `Required variable "${varName}" (${varId}) was provided as null.`
            : `Required variable "${varName}" (${varId}) is missing.`;
          errors.push(`Validation Error: ${detailMsg}`);
          validation_details[varId] = {
            variable_id: varId,
            name: varName,
            status: 'ERROR',
            message: detailMsg,
            original_value: isNull ? null : undefined
          };
          continue;
        }

        if (policy === 'ERROR') {
          const detailMsg = `Input "${varName}" (${varId}) failed: missing under ERROR policy.`;
          errors.push(`Validation Error: ${detailMsg}`);
          validation_details[varId] = {
            variable_id: varId,
            name: varName,
            status: 'ERROR',
            message: detailMsg
          };
          continue;
        }

        if (policy === 'OPTIONAL') {
          validation_details[varId] = {
            variable_id: varId,
            name: varName,
            status: 'SKIPPED',
            message: `Optional input "${varName}" omitted.`
          };
          continue;
        }

        if (policy === 'FALLBACK') {
          fallback_required = true;
          validation_details[varId] = {
            variable_id: varId,
            name: varName,
            status: 'FALLBACK_SIGNAL',
            message: `Input "${varName}" is missing; fallback signal triggered (branch selection deferred to AlgorithmExecutor).`
          };
          continue;
        }

        if (policy === 'DEFAULT') {
          if (spec.default_value !== undefined) {
            const defVal = spec.default_value;
            normalized_inputs[varId] = {
              value: defVal,
              unit: spec.unit,
              original_unit: spec.unit
            };
            warnings.push(`Default value ${defVal} ${spec.unit} applied for "${varName}".`);
            validation_details[varId] = {
              variable_id: varId,
              name: varName,
              status: 'DEFAULT_APPLIED',
              message: `Default value ${defVal} applied.`,
              normalized_value: defVal,
              normalized_unit: spec.unit
            };
            trace_steps.push({
              action: 'INPUT_DEFAULT_APPLIED',
              detail: `Default value ${defVal} ${spec.unit} applied for "${varName}".`,
              intermediate_value: defVal,
              unit: spec.unit
            });
            continue;
          } else {
            const detailMsg = `Input "${varName}" (${varId}) specified DEFAULT policy, but no default_value is defined in specification.`;
            errors.push(`Validation Error: ${detailMsg}`);
            validation_details[varId] = {
              variable_id: varId,
              name: varName,
              status: 'ERROR',
              message: detailMsg
            };
            continue;
          }
        }
      }

      // If we reach here, rawEntry and rawEntry.value exist
      const rawValue = rawEntry!.value;
      const originalUnit = rawEntry!.unit || spec.unit;
      const expectedUnit = spec.unit;
      const expectedDatatype: DataType = spec.datatype || varMeta?.datatype || 'number';

      // 1. Datatype Validation
      let parsedNumber: number | null = null;

      if (expectedDatatype === 'number' || expectedDatatype === 'integer') {
        if (typeof rawValue === 'boolean' || typeof rawValue === 'object') {
          const msg = `Datatype Error: Input "${varName}" must be a ${expectedDatatype}, received ${typeof rawValue} (${JSON.stringify(rawValue)}).`;
          errors.push(msg);
          validation_details[varId] = {
            variable_id: varId,
            name: varName,
            status: 'ERROR',
            message: msg,
            original_value: rawValue
          };
          continue;
        }

        const num = Number(rawValue);
        if (isNaN(num) || !isFinite(num)) {
          const msg = `Datatype Error: Input "${varName}" must be a valid number, received "${rawValue}".`;
          errors.push(msg);
          validation_details[varId] = {
            variable_id: varId,
            name: varName,
            status: 'ERROR',
            message: msg,
            original_value: rawValue
          };
          continue;
        }

        if (expectedDatatype === 'integer' && !Number.isInteger(num)) {
          const msg = `Datatype Error: Input "${varName}" must be an integer, received float "${rawValue}".`;
          errors.push(msg);
          validation_details[varId] = {
            variable_id: varId,
            name: varName,
            status: 'ERROR',
            message: msg,
            original_value: rawValue
          };
          continue;
        }

        parsedNumber = num;
      } else if (expectedDatatype === 'boolean') {
        if (typeof rawValue !== 'boolean' && rawValue !== 'true' && rawValue !== 'false') {
          const msg = `Datatype Error: Input "${varName}" must be a boolean, received "${rawValue}".`;
          errors.push(msg);
          validation_details[varId] = {
            variable_id: varId,
            name: varName,
            status: 'ERROR',
            message: msg,
            original_value: rawValue
          };
          continue;
        }
      } else if (expectedDatatype === 'string') {
        if (typeof rawValue !== 'string') {
          const msg = `Datatype Error: Input "${varName}" must be a string, received ${typeof rawValue}.`;
          errors.push(msg);
          validation_details[varId] = {
            variable_id: varId,
            name: varName,
            status: 'ERROR',
            message: msg,
            original_value: rawValue
          };
          continue;
        }
      }

      // 2. Unit and Dimensional Validation
      let normalizedVal = parsedNumber !== null ? parsedNumber : rawValue;
      let unitConversionTrace: string | undefined;

      if (parsedNumber !== null) {
        const sourceUnitObj = findUnit(originalUnit);
        const targetUnitObj = findUnit(expectedUnit);

        if (!sourceUnitObj) {
          const msg = `Unit Error: Unsupported source unit "${originalUnit}" for input "${varName}".`;
          errors.push(msg);
          validation_details[varId] = {
            variable_id: varId,
            name: varName,
            status: 'ERROR',
            message: msg,
            original_value: rawValue,
            original_unit: originalUnit
          };
          continue;
        }

        if (!targetUnitObj) {
          const msg = `Unit Error: Unsupported target unit "${expectedUnit}" for specification "${varName}".`;
          errors.push(msg);
          validation_details[varId] = {
            variable_id: varId,
            name: varName,
            status: 'ERROR',
            message: msg,
            original_value: rawValue,
            original_unit: originalUnit
          };
          continue;
        }

        // Dimension compatibility check
        if (
          sourceUnitObj.measurement_type !== targetUnitObj.measurement_type &&
          sourceUnitObj.measurement_type !== 'dimensionless' &&
          targetUnitObj.measurement_type !== 'dimensionless'
        ) {
          const msg = `Dimension Error: Input "${varName}" expects dimension "${targetUnitObj.measurement_type}" (${expectedUnit}), but received incompatible dimension "${sourceUnitObj.measurement_type}" (${originalUnit}).`;
          errors.push(msg);
          validation_details[varId] = {
            variable_id: varId,
            name: varName,
            status: 'ERROR',
            message: msg,
            original_value: rawValue,
            original_unit: originalUnit
          };
          continue;
        }

        // Normalization conversion
        if (originalUnit !== expectedUnit) {
          try {
            const conv = convertUnit(parsedNumber, originalUnit, expectedUnit);
            normalizedVal = conv.targetValue;
            unitConversionTrace = conv.trace;
            trace_steps.push({
              action: 'UNIT_CONVERSION',
              detail: `Converted "${varName}": ${conv.trace}`,
              intermediate_value: conv.targetValue,
              unit: expectedUnit
            });
          } catch (convErr: any) {
            const msg = `Conversion Error for "${varName}": ${convErr.message}`;
            errors.push(msg);
            validation_details[varId] = {
              variable_id: varId,
              name: varName,
              status: 'ERROR',
              message: msg,
              original_value: rawValue,
              original_unit: originalUnit
            };
            continue;
          }
        } else {
          trace_steps.push({
            action: 'UNIT_CHECK',
            detail: `Input "${varName}" verified in expected unit: ${parsedNumber} ${expectedUnit}`,
            intermediate_value: parsedNumber,
            unit: expectedUnit
          });
        }

        normalized_inputs[varId] = {
          value: normalizedVal as number,
          unit: expectedUnit,
          original_unit: originalUnit
        };

        // 3. Allowed Range Validation (evaluated AFTER unit normalization)
        const allowedRange = spec.allowed_range || varMeta?.allowed_range;
        if (allowedRange) {
          let checkVal = normalizedVal as number;
          if (varMeta?.unit && expectedUnit && varMeta.unit !== expectedUnit) {
            checkVal = convertUnit(normalizedVal as number, expectedUnit, varMeta.unit).targetValue;
          }

          const { min, max, min_inclusive = true, max_inclusive = true, warning_min, warning_max } = allowedRange;

          // Lower bound check
          if (min !== undefined) {
            const lowerViolation = min_inclusive ? checkVal < min : checkVal <= min;
            if (lowerViolation) {
              const boundaryMsg = min_inclusive
                ? `is below the valid minimum of ${min}`
                : `is less than or equal to exclusive minimum of ${min}`;
              const msg = `Range Error: Variable "${varName}" value ${checkVal} ${boundaryMsg} ${varMeta?.unit || expectedUnit}.`;
              errors.push(msg);
              validation_details[varId] = {
                variable_id: varId,
                name: varName,
                status: 'ERROR',
                message: msg,
                original_value: rawValue,
                normalized_value: checkVal,
                normalized_unit: expectedUnit
              };
              continue;
            }
          }

          // Upper bound check
          if (max !== undefined) {
            const upperViolation = max_inclusive ? checkVal > max : checkVal >= max;
            if (upperViolation) {
              const boundaryMsg = max_inclusive
                ? `exceeds the valid maximum of ${max}`
                : `is greater than or equal to exclusive maximum of ${max}`;
              const msg = `Range Error: Variable "${varName}" value ${checkVal} ${boundaryMsg} ${varMeta?.unit || expectedUnit}.`;
              errors.push(msg);
              validation_details[varId] = {
                variable_id: varId,
                name: varName,
                status: 'ERROR',
                message: msg,
                original_value: rawValue,
                normalized_value: checkVal,
                normalized_unit: expectedUnit
              };
              continue;
            }
          }

          // Warnings: Non-fatal thresholds
          if (warning_min !== undefined && checkVal < warning_min) {
            const wMsg = `Variable "${varName}" is unusually low (${checkVal} < warning threshold ${warning_min}).`;
            warnings.push(wMsg);
            trace_steps.push({
              action: 'RANGE_WARNING',
              detail: wMsg,
              intermediate_value: checkVal,
              unit: expectedUnit
            });
          }

          if (warning_max !== undefined && checkVal > warning_max) {
            const wMsg = `Variable "${varName}" is unusually high (${checkVal} > warning threshold ${warning_max}).`;
            warnings.push(wMsg);
            trace_steps.push({
              action: 'RANGE_WARNING',
              detail: wMsg,
              intermediate_value: checkVal,
              unit: expectedUnit
            });
          }
        }
      }

      // Validated successfully
      validation_details[varId] = {
        variable_id: varId,
        name: varName,
        status: 'VALID',
        original_value: rawValue,
        original_unit: originalUnit,
        normalized_value: normalizedVal as number | string | boolean,
        normalized_unit: expectedUnit,
        message: unitConversionTrace ? `Converted and verified: ${unitConversionTrace}` : 'Verified valid.'
      };
    }

    if (errors.length === 0) {
      trace_steps.push({
        action: 'INPUT_VALIDATION',
        detail: 'All required inputs verified and normalized against formula specification.'
      });
    }

    return {
      valid: errors.length === 0,
      normalized_inputs,
      warnings,
      errors,
      fallback_required,
      validation_details,
      trace_steps
    };
  }
}
