/**
 * NutriBodySim — Scientific Validation Engine
 * 
 * Phase C6: Scientific Validation Engine
 * Evaluates whether an ExecutionResult fulfills an explicitly defined ValidationProfile.
 * 
 * Core Architectural Invariants:
 * 1. Software Test != Scientific Validation != Interpretation != Reference Evidence.
 * 2. Pure Read-Only Evaluation: ExecutionResult is never mutated.
 * 3. Zero Scientific Invention: No hardcoded physiological/clinical boundaries, normal ranges, or validity claims.
 * 4. Determinism: Strict reproducible evaluation without wall-clock dependency in decision logic.
 * 5. Security: Zero eval(), zero new Function(), zero dynamic JS execution.
 */

import {
  ExecutionResult,
  ScientificValidationError,
  ValidationCheck,
  ValidationCheckResult,
  ValidationProfile,
  ValidationResult,
  ValidationSeverity,
  ValidationStatus,
  ValidationSummary
} from '../types';

export interface EvaluateValidationOptions {
  execution_result: ExecutionResult;
  profile: ValidationProfile;
  custom_timestamp?: string;
  metadata?: Record<string, unknown>;
}

export class ValidationEngine {
  /**
   * Deterministically evaluates an ExecutionResult against a ValidationProfile.
   * ExecutionResult is treated as strictly read-only and is never mutated.
   */
  static evaluate(options: EvaluateValidationOptions): ValidationResult {
    const { execution_result, profile, custom_timestamp, metadata } = options;

    // 1. Guard check inputs
    if (!execution_result || typeof execution_result !== 'object') {
      throw new ScientificValidationError(
        'EXECUTION_RESULT_INVALID',
        'ExecutionResult is undefined, null, or not an object.'
      );
    }

    if (!profile || typeof profile !== 'object') {
      throw new ScientificValidationError(
        'VALIDATION_PROFILE_INVALID',
        'ValidationProfile is undefined, null, or not an object.'
      );
    }

    if (!profile.validation_id) {
      throw new ScientificValidationError(
        'VALIDATION_PROFILE_INVALID',
        'ValidationProfile is missing required "validation_id".'
      );
    }

    const checks = profile.checks || [];
    if (!Array.isArray(checks)) {
      throw new ScientificValidationError(
        'VALIDATION_PROFILE_INVALID',
        'ValidationProfile "checks" property must be an array.'
      );
    }

    const checkResults: ValidationCheckResult[] = [];

    // 2. Evaluate each check deterministically
    for (const check of checks) {
      if (!check || !check.check_id || !check.type) {
        throw new ScientificValidationError(
          'VALIDATION_CHECK_INVALID',
          'ValidationCheck is missing required "check_id" or "type".'
        );
      }

      const result = ValidationEngine.evaluateCheck(check, execution_result);
      checkResults.push(result);
    }

    // 3. Compute summary statistics
    const summary: ValidationSummary = {
      total: checkResults.length,
      passed: checkResults.filter(c => c.status === 'PASS').length,
      failed: checkResults.filter(c => c.status === 'FAIL').length,
      warnings: checkResults.filter(c => c.status === 'WARNING').length,
      unestablished: checkResults.filter(c => c.status === 'UNESTABLISHED').length,
      not_configured: checkResults.filter(c => c.status === 'NOT_CONFIGURED').length
    };

    // 4. Compute overall validation status
    const overallStatus = ValidationEngine.computeOverallStatus(checkResults);

    return {
      validation_id: profile.validation_id,
      validation_version: profile.version || '1.0.0',
      status: overallStatus,
      checks: checkResults,
      summary,
      timestamp: custom_timestamp || new Date().toISOString(),
      metadata: metadata || {}
    };
  }

  /**
   * Evaluates an individual check against an ExecutionResult.
   */
  private static evaluateCheck(
    check: ValidationCheck,
    execResult: ExecutionResult
  ): ValidationCheckResult {
    const config = check.configuration || {};
    const severity: ValidationSeverity = check.severity || 'ERROR';

    switch (check.type) {
      case 'STRUCTURAL':
        return ValidationEngine.evaluateStructural(check, execResult, config, severity);

      case 'MATHEMATICAL':
        return ValidationEngine.evaluateMathematical(check, execResult, config, severity);

      case 'UNIT':
        return ValidationEngine.evaluateUnit(check, execResult, config, severity);

      case 'BOUNDARY':
        return ValidationEngine.evaluateBoundary(check, execResult, config, severity);

      case 'EDGE_CASE':
        return ValidationEngine.evaluateEdgeCase(check, execResult, config, severity);

      case 'REGRESSION':
        return ValidationEngine.evaluateRegression(check, execResult, config, severity);

      case 'REFERENCE_COMPARISON':
        return ValidationEngine.evaluateReferenceComparison(check, execResult, config, severity);

      case 'SENSITIVITY':
        return ValidationEngine.evaluateSensitivity(check, execResult, config, severity);

      case 'DATASET_VALIDATION':
        return ValidationEngine.evaluateDatasetValidation(check, execResult, config, severity);

      default:
        return {
          check_id: check.check_id,
          name: check.name,
          type: check.type,
          status: 'NOT_CONFIGURED',
          severity,
          message: `Unsupported validation check type "${(check as any).type}".`
        };
    }
  }

  /**
   * 1. STRUCTURAL VALIDATION
   * Validates presence of outputs, execution error status, datatypes, and module metadata.
   */
  private static evaluateStructural(
    check: ValidationCheck,
    exec: ExecutionResult,
    config: Record<string, unknown>,
    severity: ValidationSeverity
  ): ValidationCheckResult {
    // 1.1 Required outputs check
    if (config.required_outputs && Array.isArray(config.required_outputs)) {
      const missingOutputs: string[] = [];
      for (const reqOut of config.required_outputs) {
        if (!exec.outputs || exec.outputs[reqOut] === undefined || exec.outputs[reqOut]?.value === undefined) {
          missingOutputs.push(reqOut);
        }
      }

      if (missingOutputs.length > 0) {
        return {
          check_id: check.check_id,
          name: check.name,
          type: 'STRUCTURAL',
          status: 'FAIL',
          severity,
          expected: config.required_outputs,
          observed: Object.keys(exec.outputs || {}),
          message: `Structural validation failed: Missing required outputs [${missingOutputs.join(', ')}].`,
          evidence: { missing_outputs: missingOutputs }
        };
      }
    }

    // 1.2 Datatype check
    if (config.expected_datatypes && typeof config.expected_datatypes === 'object') {
      const typeMismatches: Array<{ output: string; expected: string; observed: string }> = [];
      const expectedTypes = config.expected_datatypes as Record<string, string>;

      for (const [outName, expectedType] of Object.entries(expectedTypes)) {
        const outEntry = exec.outputs?.[outName];
        if (outEntry !== undefined && outEntry.value !== undefined) {
          const actualType = typeof outEntry.value;
          if (expectedType === 'integer') {
            if (typeof outEntry.value !== 'number' || !Number.isInteger(outEntry.value)) {
              typeMismatches.push({ output: outName, expected: 'integer', observed: actualType });
            }
          } else if (actualType !== expectedType) {
            typeMismatches.push({ output: outName, expected: expectedType, observed: actualType });
          }
        }
      }

      if (typeMismatches.length > 0) {
        return {
          check_id: check.check_id,
          name: check.name,
          type: 'STRUCTURAL',
          status: 'FAIL',
          severity,
          expected: config.expected_datatypes,
          observed: typeMismatches,
          message: `Structural validation failed: Output datatype mismatch on [${typeMismatches.map(m => m.output).join(', ')}].`,
          evidence: { mismatches: typeMismatches }
        };
      }
    }

    // 1.3 Error-free execution check
    if (config.require_no_errors === true) {
      if (exec.errors && exec.errors.length > 0) {
        return {
          check_id: check.check_id,
          name: check.name,
          type: 'STRUCTURAL',
          status: 'FAIL',
          severity,
          expected: '0 errors',
          observed: `${exec.errors.length} errors`,
          message: `Structural validation failed: Execution produced fatal errors [${exec.errors.join('; ')}].`,
          evidence: { errors: exec.errors }
        };
      }
    }

    // 1.4 Module identity / version check
    if (config.require_module_id === true && !exec.module_id) {
      return {
        check_id: check.check_id,
        name: check.name,
        type: 'STRUCTURAL',
        status: 'FAIL',
        severity,
        expected: 'Non-empty module_id',
        observed: exec.module_id,
        message: 'Structural validation failed: ExecutionResult is missing module_id.'
      };
    }

    if (config.require_module_version === true && !exec.module_version) {
      return {
        check_id: check.check_id,
        name: check.name,
        type: 'STRUCTURAL',
        status: 'FAIL',
        severity,
        expected: 'Non-empty module_version',
        observed: exec.module_version,
        message: 'Structural validation failed: ExecutionResult is missing module_version.'
      };
    }

    return {
      check_id: check.check_id,
      name: check.name,
      type: 'STRUCTURAL',
      status: 'PASS',
      severity,
      expected: 'Valid execution structure',
      observed: 'Valid execution structure',
      message: 'Structural validation passed.'
    };
  }

  /**
   * 2. MATHEMATICAL VALIDATION
   * Validates explicit mathematical/numerical criteria (exact equality or explicit tolerance).
   * Never hardcodes arbitrary tolerances; missing tolerance on inexact continuous values yields NOT_CONFIGURED.
   */
  private static evaluateMathematical(
    check: ValidationCheck,
    exec: ExecutionResult,
    config: Record<string, unknown>,
    severity: ValidationSeverity
  ): ValidationCheckResult {
    const targetOutput = config.target_output as string;
    if (!targetOutput) {
      return {
        check_id: check.check_id,
        name: check.name,
        type: 'MATHEMATICAL',
        status: 'NOT_CONFIGURED',
        severity,
        message: 'Mathematical validation rule missing target_output configuration.'
      };
    }

    const expectedValue = config.expected_value;
    if (expectedValue === undefined || expectedValue === null) {
      return {
        check_id: check.check_id,
        name: check.name,
        type: 'MATHEMATICAL',
        status: 'NOT_CONFIGURED',
        severity,
        message: `Mathematical validation rule for "${targetOutput}" is missing expected_value.`
      };
    }

    const outputEntry = exec.outputs?.[targetOutput];
    if (!outputEntry || outputEntry.value === undefined) {
      return {
        check_id: check.check_id,
        name: check.name,
        type: 'MATHEMATICAL',
        status: 'FAIL',
        severity,
        expected: expectedValue,
        observed: undefined,
        message: `Target output "${targetOutput}" was not found in ExecutionResult.`
      };
    }

    const observedValue = outputEntry.value;

    // Numerical comparison
    if (typeof expectedValue === 'number') {
      const numObserved = Number(observedValue);
      if (typeof observedValue !== 'number' || isNaN(numObserved) || !isFinite(numObserved)) {
        return {
          check_id: check.check_id,
          name: check.name,
          type: 'MATHEMATICAL',
          status: 'FAIL',
          severity,
          expected: expectedValue,
          observed: observedValue,
          message: `Observed value for "${targetOutput}" is not a finite number: "${observedValue}".`
        };
      }

      // Check if tolerance is provided
      const tolerance = config.tolerance !== undefined ? Number(config.tolerance) : undefined;
      const requireTolerance = config.require_tolerance === true;

      if (tolerance !== undefined) {
        if (isNaN(tolerance) || tolerance < 0) {
          return {
            check_id: check.check_id,
            name: check.name,
            type: 'MATHEMATICAL',
            status: 'NOT_CONFIGURED',
            severity,
            message: `Mathematical validation tolerance "${config.tolerance}" is invalid (must be a non-negative number).`
          };
        }

        const diff = Math.abs(numObserved - expectedValue);
        const passed = diff <= tolerance;

        return {
          check_id: check.check_id,
          name: check.name,
          type: 'MATHEMATICAL',
          status: passed ? 'PASS' : 'FAIL',
          severity,
          expected: `${expectedValue} (±${tolerance})`,
          observed: numObserved,
          message: passed
            ? `Mathematical tolerance validation passed (delta=${diff} <= tol=${tolerance}).`
            : `Mathematical tolerance validation failed: observed=${numObserved}, expected=${expectedValue}, delta=${diff} > tol=${tolerance}.`,
          evidence: { delta: diff, tolerance }
        };
      }

      // Exact numerical match requested
      if (numObserved === expectedValue) {
        return {
          check_id: check.check_id,
          name: check.name,
          type: 'MATHEMATICAL',
          status: 'PASS',
          severity,
          expected: expectedValue,
          observed: numObserved,
          message: `Mathematical exact match validation passed (${numObserved} === ${expectedValue}).`
        };
      }

      // If exact match failed and tolerance was required but not configured:
      if (requireTolerance) {
        return {
          check_id: check.check_id,
          name: check.name,
          type: 'MATHEMATICAL',
          status: 'NOT_CONFIGURED',
          severity,
          expected: expectedValue,
          observed: numObserved,
          message: `Mathematical tolerance is required for "${targetOutput}" but was not configured in the profile.`
        };
      }

      return {
        check_id: check.check_id,
        name: check.name,
        type: 'MATHEMATICAL',
        status: 'FAIL',
        severity,
        expected: expectedValue,
        observed: numObserved,
        message: `Mathematical exact match failed: observed ${numObserved} !== expected ${expectedValue}.`
      };
    }

    // Non-numeric equality comparison (strings, booleans)
    if (observedValue === expectedValue) {
      return {
        check_id: check.check_id,
        name: check.name,
        type: 'MATHEMATICAL',
        status: 'PASS',
        severity,
        expected: expectedValue,
        observed: observedValue,
        message: 'Mathematical value comparison passed.'
      };
    }

    return {
      check_id: check.check_id,
      name: check.name,
      type: 'MATHEMATICAL',
      status: 'FAIL',
      severity,
      expected: expectedValue,
      observed: observedValue,
      message: `Mathematical value mismatch: observed "${observedValue}" !== expected "${expectedValue}".`
    };
  }

  /**
   * 3. UNIT VALIDATION
   * Validates unit and dimension consistency without inventing synthetic units.
   */
  private static evaluateUnit(
    check: ValidationCheck,
    exec: ExecutionResult,
    config: Record<string, unknown>,
    severity: ValidationSeverity
  ): ValidationCheckResult {
    const targetOutput = config.target_output as string;
    if (!targetOutput) {
      return {
        check_id: check.check_id,
        name: check.name,
        type: 'UNIT',
        status: 'NOT_CONFIGURED',
        severity,
        message: 'Unit validation check missing target_output configuration.'
      };
    }

    const expectedUnit = config.expected_unit as string;
    if (!expectedUnit) {
      return {
        check_id: check.check_id,
        name: check.name,
        type: 'UNIT',
        status: 'NOT_CONFIGURED',
        severity,
        message: `Unit validation check for "${targetOutput}" is missing expected_unit.`
      };
    }

    const outputEntry = exec.outputs?.[targetOutput];
    if (!outputEntry) {
      return {
        check_id: check.check_id,
        name: check.name,
        type: 'UNIT',
        status: 'FAIL',
        severity,
        expected: expectedUnit,
        observed: undefined,
        message: `Target output "${targetOutput}" not found in ExecutionResult.`
      };
    }

    const observedUnit = outputEntry.unit || '';

    // Unit match
    if (observedUnit === expectedUnit) {
      return {
        check_id: check.check_id,
        name: check.name,
        type: 'UNIT',
        status: 'PASS',
        severity,
        expected: expectedUnit,
        observed: observedUnit,
        message: `Unit validation passed for "${targetOutput}" (unit="${observedUnit}").`
      };
    }

    // Explicit unestablished unit verification
    if (config.unestablished_unit === true || observedUnit === 'UNKNOWN') {
      return {
        check_id: check.check_id,
        name: check.name,
        type: 'UNIT',
        status: 'UNESTABLISHED',
        severity,
        expected: expectedUnit,
        observed: observedUnit,
        message: `Unit "${observedUnit}" for "${targetOutput}" cannot be established in scientific core.`
      };
    }

    return {
      check_id: check.check_id,
      name: check.name,
      type: 'UNIT',
      status: 'FAIL',
      severity,
      expected: expectedUnit,
      observed: observedUnit,
      message: `Unit validation failed for "${targetOutput}": expected "${expectedUnit}", observed "${observedUnit}".`
    };
  }

  /**
   * 4. BOUNDARY VALIDATION
   * Checks explicit min/max boundaries without inventing physiological cutoff ranges.
   */
  private static evaluateBoundary(
    check: ValidationCheck,
    exec: ExecutionResult,
    config: Record<string, unknown>,
    severity: ValidationSeverity
  ): ValidationCheckResult {
    const targetOutput = config.target_output as string;
    if (!targetOutput) {
      return {
        check_id: check.check_id,
        name: check.name,
        type: 'BOUNDARY',
        status: 'NOT_CONFIGURED',
        severity,
        message: 'Boundary validation missing target_output configuration.'
      };
    }

    const min = config.min !== undefined ? Number(config.min) : undefined;
    const max = config.max !== undefined ? Number(config.max) : undefined;
    const minInclusive = config.min_inclusive !== false;
    const maxInclusive = config.max_inclusive !== false;

    if (min === undefined && max === undefined) {
      return {
        check_id: check.check_id,
        name: check.name,
        type: 'BOUNDARY',
        status: 'NOT_CONFIGURED',
        severity,
        message: `Boundary validation for "${targetOutput}" has neither min nor max boundary configured.`
      };
    }

    const outputEntry = exec.outputs?.[targetOutput];
    if (!outputEntry || outputEntry.value === undefined) {
      return {
        check_id: check.check_id,
        name: check.name,
        type: 'BOUNDARY',
        status: 'FAIL',
        severity,
        expected: { min, max },
        observed: undefined,
        message: `Target output "${targetOutput}" not found in ExecutionResult.`
      };
    }

    const numVal = Number(outputEntry.value);
    if (typeof outputEntry.value !== 'number' || isNaN(numVal) || !isFinite(numVal)) {
      return {
        check_id: check.check_id,
        name: check.name,
        type: 'BOUNDARY',
        status: 'FAIL',
        severity,
        expected: { min, max },
        observed: outputEntry.value,
        message: `Observed value for "${targetOutput}" is not a finite number: "${outputEntry.value}".`
      };
    }

    // Min boundary check
    if (min !== undefined) {
      if (minInclusive ? numVal < min : numVal <= min) {
        return {
          check_id: check.check_id,
          name: check.name,
          type: 'BOUNDARY',
          status: 'FAIL',
          severity,
          expected: minInclusive ? `>= ${min}` : `> ${min}`,
          observed: numVal,
          message: `Boundary validation failed: observed value ${numVal} violates lower bound ${min}.`,
          evidence: { min, min_inclusive: minInclusive, value: numVal }
        };
      }
    }

    // Max boundary check
    if (max !== undefined) {
      if (maxInclusive ? numVal > max : numVal >= max) {
        return {
          check_id: check.check_id,
          name: check.name,
          type: 'BOUNDARY',
          status: 'FAIL',
          severity,
          expected: maxInclusive ? `<= ${max}` : `< ${max}`,
          observed: numVal,
          message: `Boundary validation failed: observed value ${numVal} violates upper bound ${max}.`,
          evidence: { max, max_inclusive: maxInclusive, value: numVal }
        };
      }
    }

    return {
      check_id: check.check_id,
      name: check.name,
      type: 'BOUNDARY',
      status: 'PASS',
      severity,
      expected: { min, max },
      observed: numVal,
      message: `Boundary validation passed for "${targetOutput}" (${numVal} within configured bounds).`
    };
  }

  /**
   * 5. EDGE CASE VALIDATION
   * Validates behavior on extreme/edge conditions (NaN, Infinity, Zero, Negative, Missing Input).
   */
  private static evaluateEdgeCase(
    check: ValidationCheck,
    exec: ExecutionResult,
    config: Record<string, unknown>,
    severity: ValidationSeverity
  ): ValidationCheckResult {
    const edgeType = (config.edge_case_type as string) || 'GENERAL';

    // 5.1 NaN detection
    if (edgeType === 'NAN_CHECK') {
      const targetOutput = config.target_output as string;
      if (targetOutput) {
        const val = exec.outputs?.[targetOutput]?.value;
        const isNanVal = val === undefined || (typeof val === 'number' && isNaN(val));
        const expectNan = config.expect_nan === true;

        if (isNanVal && !expectNan) {
          return {
            check_id: check.check_id,
            name: check.name,
            type: 'EDGE_CASE',
            status: 'FAIL',
            severity,
            expected: 'Finite number (no NaN)',
            observed: 'NaN',
            message: `Edge case validation failed: Output "${targetOutput}" evaluated to NaN.`
          };
        }
        if (!isNanVal && expectNan) {
          return {
            check_id: check.check_id,
            name: check.name,
            type: 'EDGE_CASE',
            status: 'FAIL',
            severity,
            expected: 'NaN',
            observed: val,
            message: `Edge case validation failed: Expected NaN but observed ${val}.`
          };
        }
        return {
          check_id: check.check_id,
          name: check.name,
          type: 'EDGE_CASE',
          status: 'PASS',
          severity,
          expected: expectNan ? 'NaN' : 'No NaN',
          observed: isNanVal ? 'NaN' : 'Clean',
          message: 'Edge case NaN validation passed.'
        };
      }

      // Check all outputs for unexpected NaN
      const nanOutputs: string[] = [];
      for (const [outKey, outVal] of Object.entries(exec.outputs || {})) {
        if (typeof outVal.value === 'number' && isNaN(outVal.value)) {
          nanOutputs.push(outKey);
        }
      }

      if (nanOutputs.length > 0) {
        return {
          check_id: check.check_id,
          name: check.name,
          type: 'EDGE_CASE',
          status: 'FAIL',
          severity,
          expected: 'No NaN values in outputs',
          observed: nanOutputs,
          message: `Edge case validation failed: NaN detected in outputs [${nanOutputs.join(', ')}].`,
          evidence: { nan_outputs: nanOutputs }
        };
      }

      return {
        check_id: check.check_id,
        name: check.name,
        type: 'EDGE_CASE',
        status: 'PASS',
        severity,
        expected: 'No NaN values',
        observed: 'Clean',
        message: 'Edge case NaN check passed.'
      };
    }

    // 5.2 Infinity detection
    if (edgeType === 'INFINITY_CHECK') {
      const infOutputs: string[] = [];
      for (const [outKey, outVal] of Object.entries(exec.outputs || {})) {
        if (typeof outVal.value === 'number' && !isFinite(outVal.value)) {
          infOutputs.push(outKey);
        }
      }

      if (infOutputs.length > 0) {
        return {
          check_id: check.check_id,
          name: check.name,
          type: 'EDGE_CASE',
          status: 'FAIL',
          severity,
          expected: 'Finite output values',
          observed: infOutputs,
          message: `Edge case validation failed: Non-finite / Infinity detected in outputs [${infOutputs.join(', ')}].`,
          evidence: { non_finite_outputs: infOutputs }
        };
      }

      return {
        check_id: check.check_id,
        name: check.name,
        type: 'EDGE_CASE',
        status: 'PASS',
        severity,
        expected: 'Finite values',
        observed: 'Clean',
        message: 'Edge case Infinity check passed.'
      };
    }

    // 5.3 Zero handling
    if (edgeType === 'ZERO_HANDLING') {
      const targetOutput = config.target_output as string;
      const expectedBehavior = config.expected_behavior;

      if (!targetOutput || expectedBehavior === undefined) {
        return {
          check_id: check.check_id,
          name: check.name,
          type: 'EDGE_CASE',
          status: 'NOT_CONFIGURED',
          severity,
          message: 'Zero handling edge case rule missing target_output or expected_behavior configuration.'
        };
      }

      const val = exec.outputs?.[targetOutput]?.value;
      const matches = val === expectedBehavior || (typeof val === 'number' && val === Number(expectedBehavior));

      return {
        check_id: check.check_id,
        name: check.name,
        type: 'EDGE_CASE',
        status: matches ? 'PASS' : 'FAIL',
        severity,
        expected: expectedBehavior,
        observed: val,
        message: matches
          ? `Zero handling edge case passed for "${targetOutput}".`
          : `Zero handling edge case failed: observed ${val}, expected ${expectedBehavior}.`
      };
    }

    // 5.4 Negative handling
    if (edgeType === 'NEGATIVE_HANDLING') {
      const targetOutput = config.target_output as string;
      const expectedBehavior = config.expected_behavior;

      if (!targetOutput || expectedBehavior === undefined) {
        return {
          check_id: check.check_id,
          name: check.name,
          type: 'EDGE_CASE',
          status: 'NOT_CONFIGURED',
          severity,
          message: 'Negative handling edge case rule missing target_output or expected_behavior configuration.'
        };
      }

      const val = exec.outputs?.[targetOutput]?.value;
      const matches = val === expectedBehavior || (typeof val === 'number' && val === Number(expectedBehavior));

      return {
        check_id: check.check_id,
        name: check.name,
        type: 'EDGE_CASE',
        status: matches ? 'PASS' : 'FAIL',
        severity,
        expected: expectedBehavior,
        observed: val,
        message: matches
          ? `Negative handling edge case passed for "${targetOutput}".`
          : `Negative handling edge case failed: observed ${val}, expected ${expectedBehavior}.`
      };
    }

    // 5.5 Missing input handling
    if (edgeType === 'MISSING_INPUT') {
      const expectedFallback = config.expected_fallback_used === true;
      if (config.expected_fallback_used !== undefined) {
        const matches = exec.fallback_used === expectedFallback;
        return {
          check_id: check.check_id,
          name: check.name,
          type: 'EDGE_CASE',
          status: matches ? 'PASS' : 'FAIL',
          severity,
          expected: `fallback_used=${expectedFallback}`,
          observed: `fallback_used=${exec.fallback_used}`,
          message: matches
            ? 'Missing input edge case fallback validation passed.'
            : `Missing input edge case failed: expected fallback_used=${expectedFallback}, observed ${exec.fallback_used}.`
        };
      }
      return {
        check_id: check.check_id,
        name: check.name,
        type: 'EDGE_CASE',
        status: 'PASS',
        severity,
        message: 'Missing input edge case check passed.'
      };
    }

    return {
      check_id: check.check_id,
      name: check.name,
      type: 'EDGE_CASE',
      status: 'NOT_CONFIGURED',
      severity,
      message: `Unknown edge case type "${edgeType}".`
    };
  }

  /**
   * 6. REGRESSION VALIDATION
   * Compares actual execution outputs against an explicit baseline without hidden database calls.
   */
  private static evaluateRegression(
    check: ValidationCheck,
    exec: ExecutionResult,
    config: Record<string, unknown>,
    severity: ValidationSeverity
  ): ValidationCheckResult {
    const baselineOutputs = (config.baseline_outputs || config.baseline_output) as Record<string, unknown>;

    if (!baselineOutputs || typeof baselineOutputs !== 'object') {
      return {
        check_id: check.check_id,
        name: check.name,
        type: 'REGRESSION',
        status: 'NOT_CONFIGURED',
        severity,
        message: 'Regression validation rule is missing baseline_outputs configuration.'
      };
    }

    const tolerance = config.tolerance !== undefined ? Number(config.tolerance) : 1e-6;
    const mismatches: Array<{ output: string; baseline: unknown; observed: unknown; diff?: number }> = [];

    for (const [key, baseVal] of Object.entries(baselineOutputs)) {
      const observedEntry = exec.outputs?.[key];
      if (!observedEntry || observedEntry.value === undefined) {
        mismatches.push({ output: key, baseline: baseVal, observed: undefined });
        continue;
      }

      const obsVal = observedEntry.value;

      if (typeof baseVal === 'number' && typeof obsVal === 'number') {
        const diff = Math.abs(obsVal - baseVal);
        if (diff > tolerance) {
          mismatches.push({ output: key, baseline: baseVal, observed: obsVal, diff });
        }
      } else if (obsVal !== baseVal) {
        mismatches.push({ output: key, baseline: baseVal, observed: obsVal });
      }
    }

    if (mismatches.length > 0) {
      return {
        check_id: check.check_id,
        name: check.name,
        type: 'REGRESSION',
        status: 'FAIL',
        severity,
        expected: baselineOutputs,
        observed: mismatches,
        message: `Regression validation failed on outputs [${mismatches.map(m => m.output).join(', ')}].`,
        evidence: { mismatches, tolerance }
      };
    }

    return {
      check_id: check.check_id,
      name: check.name,
      type: 'REGRESSION',
      status: 'PASS',
      severity,
      expected: baselineOutputs,
      observed: exec.outputs,
      message: 'Regression validation passed: all outputs match baseline.'
    };
  }

  /**
   * 7. REFERENCE COMPARISON VALIDATION
   * Enforces that citations are never automatically promoted to validation evidence.
   * Only PASS if reference comparison is configured, criteria are provided, comparison method exists, and criteria are satisfied.
   */
  private static evaluateReferenceComparison(
    check: ValidationCheck,
    exec: ExecutionResult,
    config: Record<string, unknown>,
    severity: ValidationSeverity
  ): ValidationCheckResult {
    // 7.1 Citation without criteria -> UNESTABLISHED
    if (config.citation_only === true || (!config.expected_value && !config.comparison_criteria && !config.reference_value)) {
      return {
        check_id: check.check_id,
        name: check.name,
        type: 'REFERENCE_COMPARISON',
        status: 'UNESTABLISHED',
        severity,
        expected: 'Validation comparison criteria and evidence',
        observed: config.reference_id || 'Citation without quantitative comparison criteria',
        message: 'Reference citation is registered, but scientific validation comparison criteria are unestablished.',
        evidence: { reference_id: config.reference_id, citation: config.citation }
      };
    }

    const targetOutput = config.target_output as string;
    if (!targetOutput) {
      return {
        check_id: check.check_id,
        name: check.name,
        type: 'REFERENCE_COMPARISON',
        status: 'NOT_CONFIGURED',
        severity,
        message: 'Reference comparison rule missing target_output configuration.'
      };
    }

    const refValue = config.reference_value !== undefined ? config.reference_value : config.expected_value;
    const tolerance = config.tolerance !== undefined ? Number(config.tolerance) : undefined;
    const outputVal = exec.outputs?.[targetOutput]?.value;

    if (outputVal === undefined) {
      return {
        check_id: check.check_id,
        name: check.name,
        type: 'REFERENCE_COMPARISON',
        status: 'FAIL',
        severity,
        expected: refValue,
        observed: undefined,
        message: `Reference comparison target "${targetOutput}" not found in ExecutionResult.`
      };
    }

    if (typeof refValue === 'number' && typeof outputVal === 'number') {
      const tol = tolerance !== undefined ? tolerance : 0;
      const diff = Math.abs(outputVal - refValue);
      const passed = diff <= tol;

      return {
        check_id: check.check_id,
        name: check.name,
        type: 'REFERENCE_COMPARISON',
        status: passed ? 'PASS' : 'FAIL',
        severity,
        expected: `${refValue} (ref: ${config.reference_id || 'unspecified'})`,
        observed: outputVal,
        message: passed
          ? `Reference comparison passed against benchmark reference ${config.reference_id || ''}.`
          : `Reference comparison failed against benchmark reference: observed ${outputVal} != ref ${refValue} (delta=${diff} > tol=${tol}).`,
        evidence: { reference_id: config.reference_id, delta: diff, tolerance: tol }
      };
    }

    if (outputVal === refValue) {
      return {
        check_id: check.check_id,
        name: check.name,
        type: 'REFERENCE_COMPARISON',
        status: 'PASS',
        severity,
        expected: refValue,
        observed: outputVal,
        message: 'Reference comparison passed.'
      };
    }

    return {
      check_id: check.check_id,
      name: check.name,
      type: 'REFERENCE_COMPARISON',
      status: 'FAIL',
      severity,
      expected: refValue,
      observed: outputVal,
      message: `Reference comparison mismatch: observed "${outputVal}" !== reference "${refValue}".`
    };
  }

  /**
   * 8. SENSITIVITY VALIDATION
   * Generates sensitivity evidence without producing rankings, model winners, or optimization claims.
   */
  private static evaluateSensitivity(
    check: ValidationCheck,
    exec: ExecutionResult,
    config: Record<string, unknown>,
    severity: ValidationSeverity
  ): ValidationCheckResult {
    const parameter = config.parameter as string;
    const baseline = config.baseline;
    const perturbation = config.perturbation;
    const targetOutput = config.target_output as string;

    if (!parameter || baseline === undefined || perturbation === undefined || !targetOutput) {
      return {
        check_id: check.check_id,
        name: check.name,
        type: 'SENSITIVITY',
        status: 'NOT_CONFIGURED',
        severity,
        message: 'Sensitivity validation rule missing required configuration (parameter, baseline, perturbation, target_output).'
      };
    }

    const observedValue = exec.outputs?.[targetOutput]?.value;
    const baselineValue = config.baseline_output_value;

    const evidence: Record<string, unknown> = {
      parameter,
      baseline,
      perturbation,
      target_output: targetOutput,
      observed_result: observedValue
    };

    if (baselineValue !== undefined && typeof observedValue === 'number' && typeof baselineValue === 'number') {
      evidence.difference = observedValue - baselineValue;
      evidence.relative_change = baselineValue !== 0 ? (observedValue - baselineValue) / baselineValue : 0;
    }

    return {
      check_id: check.check_id,
      name: check.name,
      type: 'SENSITIVITY',
      status: 'PASS',
      severity,
      expected: 'Neutral sensitivity evidence documentation',
      observed: evidence,
      message: `Sensitivity evidence captured for parameter "${parameter}" (no rankings or optimizations generated).`,
      evidence
    };
  }

  /**
   * 9. DATASET VALIDATION (Single Execution Contract)
   * Evaluates ExecutionResult against dataset test row criteria. No batch looping.
   */
  private static evaluateDatasetValidation(
    check: ValidationCheck,
    exec: ExecutionResult,
    config: Record<string, unknown>,
    severity: ValidationSeverity
  ): ValidationCheckResult {
    const datasetId = config.dataset_id as string;
    const sampleId = config.sample_id as string;
    const criteria = config.expected_outputs as Record<string, unknown>;

    if (!datasetId || !criteria) {
      return {
        check_id: check.check_id,
        name: check.name,
        type: 'DATASET_VALIDATION',
        status: 'NOT_CONFIGURED',
        severity,
        message: 'Dataset validation rule missing dataset_id or expected_outputs configuration.'
      };
    }

    const tolerance = config.tolerance !== undefined ? Number(config.tolerance) : 1e-4;
    const mismatches: Array<{ output: string; expected: unknown; observed: unknown }> = [];

    for (const [outKey, expVal] of Object.entries(criteria)) {
      const obsVal = exec.outputs?.[outKey]?.value;
      if (obsVal === undefined) {
        mismatches.push({ output: outKey, expected: expVal, observed: undefined });
        continue;
      }

      if (typeof expVal === 'number' && typeof obsVal === 'number') {
        if (Math.abs(obsVal - expVal) > tolerance) {
          mismatches.push({ output: outKey, expected: expVal, observed: obsVal });
        }
      } else if (obsVal !== expVal) {
        mismatches.push({ output: outKey, expected: expVal, observed: obsVal });
      }
    }

    if (mismatches.length > 0) {
      return {
        check_id: check.check_id,
        name: check.name,
        type: 'DATASET_VALIDATION',
        status: 'FAIL',
        severity,
        expected: criteria,
        observed: mismatches,
        message: `Dataset sample validation failed for dataset "${datasetId}" (sample "${sampleId}").`,
        evidence: { dataset_id: datasetId, sample_id: sampleId, mismatches }
      };
    }

    return {
      check_id: check.check_id,
      name: check.name,
      type: 'DATASET_VALIDATION',
      status: 'PASS',
      severity,
      expected: criteria,
      observed: exec.outputs,
      message: `Dataset validation passed for dataset "${datasetId}" (sample "${sampleId}").`,
      evidence: { dataset_id: datasetId, sample_id: sampleId }
    };
  }

  /**
   * Computes aggregate validation status across all checks with strict semantic priority.
   * Priority:
   * 1. Total checks == 0 -> NOT_CONFIGURED
   * 2. Any ERROR check is FAIL -> FAIL
   * 3. Any check is UNESTABLISHED -> UNESTABLISHED
   * 4. Any WARNING check is FAIL or status is WARNING -> WARNING
   * 5. All checks NOT_CONFIGURED -> NOT_CONFIGURED
   * 6. All evaluated checks PASS -> PASS
   */
  private static computeOverallStatus(checkResults: ValidationCheckResult[]): ValidationStatus {
    if (checkResults.length === 0) {
      return 'NOT_CONFIGURED';
    }

    const hasErrorFail = checkResults.some(
      c => c.status === 'FAIL' && (!c.severity || c.severity === 'ERROR')
    );
    if (hasErrorFail) {
      return 'FAIL';
    }

    const hasUnestablished = checkResults.some(c => c.status === 'UNESTABLISHED');
    if (hasUnestablished) {
      return 'UNESTABLISHED';
    }

    const hasWarning = checkResults.some(
      c => c.status === 'WARNING' || (c.status === 'FAIL' && c.severity === 'WARNING')
    );
    if (hasWarning) {
      return 'WARNING';
    }

    const allNotConfigured = checkResults.every(c => c.status === 'NOT_CONFIGURED');
    if (allNotConfigured) {
      return 'NOT_CONFIGURED';
    }

    return 'PASS';
  }
}
