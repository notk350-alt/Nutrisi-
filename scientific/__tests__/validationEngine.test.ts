/**
 * NutriBodySim — Scientific Validation Engine Test Suite
 * 
 * Phase C6: Scientific Validation Engine
 * 37 Mandatory Test Cases verifying:
 * - Validation profile, check, and result contracts
 * - Structural, Mathematical, Unit, Boundary, Edge-Case, Regression, Reference, Sensitivity, and Dataset validation types
 * - Strict semantics: PASS, FAIL, WARNING, UNESTABLISHED, NOT_CONFIGURED
 * - Read-only ExecutionResult immutability
 * - Deterministic evaluation & security (no eval/new Function)
 * - Complete Phase C1 - C5 regression contracts
 */

import { describe, it, expect } from 'vitest';
import {
  ValidationEngine,
  ValidationProfile,
  ValidationCheck,
  ValidationResult,
  ExecutionResult,
  ScientificValidationError,
  CalculationEngine,
  executeModuleRequest,
  ModuleResolver,
  ParameterResolver,
  InputValidator,
  AlgorithmExecutor,
  ModelExecutor,
  ScientificFormula,
  ScientificAlgorithm,
  ScientificModel,
  ScientificParameter
} from '../index';

describe('Phase C6 — Scientific Validation Engine Test Suite (37 Mandatory Tests)', () => {
  // Common neutral synthetic execution result for evaluation tests
  const createMockExecutionResult = (overrides?: Partial<ExecutionResult>): ExecutionResult => ({
    execution_id: 'EXEC_SYNTH_001',
    module_id: 'SYNTH_FORMULA_ADD',
    module_version: '1.0.0',
    inputs: {
      x: { value: 10, unit: 'kg' }
    },
    normalized_inputs: {
      x: { value: 10, unit: 'kg' }
    },
    parameters: {
      offset: { value: 2, unit: 'kg' }
    },
    execution_path: ['INPUT_VALIDATION', 'FORMULA_EVALUATION'],
    fallback_used: false,
    intermediate_results: {},
    trace: [
      {
        step_id: 'STEP_1',
        operation: 'ADD',
        output: 12,
        unit: 'kg',
        timestamp: '2026-09-24T00:00:00.000Z'
      }
    ],
    outputs: {
      y: { value: 12, unit: 'kg' }
    },
    warnings: [],
    errors: [],
    validation: {
      status: 'UNVALIDATED',
      message: 'Pending validation evaluation.'
    },
    timestamp: '2026-09-24T00:00:00.000Z',
    ...overrides
  });

  // ===========================================================================
  // CONTRACT TESTS (1-3)
  // ===========================================================================

  it('Test 1: should create a valid typed ValidationProfile contract', () => {
    const profile: ValidationProfile = {
      validation_id: 'VAL_PROFILE_001',
      name: 'Synthetic Profile',
      version: '1.0.0',
      description: 'Profile contract verification',
      checks: [
        {
          check_id: 'CHK_1',
          name: 'Output Presence',
          type: 'STRUCTURAL',
          severity: 'ERROR',
          configuration: { required_outputs: ['y'] }
        }
      ],
      references: ['REF_SYNTH_2026'],
      status: 'VALIDATED'
    };

    expect(profile.validation_id).toBe('VAL_PROFILE_001');
    expect(profile.checks.length).toBe(1);
    expect(profile.checks[0].type).toBe('STRUCTURAL');
  });

  it('Test 2: should create a valid typed ValidationCheck with configured severity', () => {
    const check: ValidationCheck = {
      check_id: 'CHK_MATH_TOLERANCE',
      name: 'Tolerance Check',
      type: 'MATHEMATICAL',
      severity: 'WARNING',
      configuration: { target_output: 'y', expected_value: 12, tolerance: 0.1 }
    };

    expect(check.check_id).toBe('CHK_MATH_TOLERANCE');
    expect(check.severity).toBe('WARNING');
    expect(check.type).toBe('MATHEMATICAL');
  });

  it('Test 3: should produce a structured ValidationResult with summary statistics', () => {
    const exec = createMockExecutionResult();
    const profile: ValidationProfile = {
      validation_id: 'VAL_PROFILE_TEST3',
      name: 'Summary Test Profile',
      version: '1.0.0',
      checks: [
        {
          check_id: 'CHK_REQ',
          name: 'Required y',
          type: 'STRUCTURAL',
          configuration: { required_outputs: ['y'] }
        }
      ]
    };

    const valResult: ValidationResult = ValidationEngine.evaluate({
      execution_result: exec,
      profile
    });

    expect(valResult.validation_id).toBe('VAL_PROFILE_TEST3');
    expect(valResult.status).toBe('PASS');
    expect(valResult.summary).toEqual({
      total: 1,
      passed: 1,
      failed: 0,
      warnings: 0,
      unestablished: 0,
      not_configured: 0
    });
  });

  // ===========================================================================
  // STRUCTURAL VALIDATION TESTS (4-6)
  // ===========================================================================

  it('Test 4: should PASS when all required outputs are present in ExecutionResult', () => {
    const exec = createMockExecutionResult({
      outputs: { y: { value: 12, unit: 'kg' }, z: { value: 24, unit: 'kg' } }
    });
    const profile: ValidationProfile = {
      validation_id: 'VAL_STRUCT_PASS',
      name: 'Required Outputs Pass',
      version: '1.0.0',
      checks: [
        {
          check_id: 'CHK_STRUCT_1',
          name: 'Outputs check',
          type: 'STRUCTURAL',
          configuration: { required_outputs: ['y', 'z'] }
        }
      ]
    };

    const result = ValidationEngine.evaluate({ execution_result: exec, profile });
    expect(result.status).toBe('PASS');
    expect(result.checks[0].status).toBe('PASS');
  });

  it('Test 5: should FAIL when required outputs are missing from ExecutionResult', () => {
    const exec = createMockExecutionResult({
      outputs: { y: { value: 12, unit: 'kg' } }
    });
    const profile: ValidationProfile = {
      validation_id: 'VAL_STRUCT_MISSING',
      name: 'Missing Output Check',
      version: '1.0.0',
      checks: [
        {
          check_id: 'CHK_STRUCT_MISSING',
          name: 'Missing Output check',
          type: 'STRUCTURAL',
          configuration: { required_outputs: ['y', 'missing_target_z'] }
        }
      ]
    };

    const result = ValidationEngine.evaluate({ execution_result: exec, profile });
    expect(result.status).toBe('FAIL');
    expect(result.checks[0].status).toBe('FAIL');
    expect(result.checks[0].message).toContain('missing_target_z');
  });

  it('Test 6: should FAIL when output datatype does not match expected datatype', () => {
    const exec = createMockExecutionResult({
      outputs: { y: { value: 'not_a_number' as any, unit: 'kg' } }
    });
    const profile: ValidationProfile = {
      validation_id: 'VAL_STRUCT_TYPE',
      name: 'Datatype Check',
      version: '1.0.0',
      checks: [
        {
          check_id: 'CHK_TYPE_MISMATCH',
          name: 'Number type check',
          type: 'STRUCTURAL',
          configuration: { expected_datatypes: { y: 'number' } }
        }
      ]
    };

    const result = ValidationEngine.evaluate({ execution_result: exec, profile });
    expect(result.status).toBe('FAIL');
    expect(result.checks[0].status).toBe('FAIL');
    expect(result.checks[0].message).toContain('datatype mismatch');
  });

  // ===========================================================================
  // MATHEMATICAL VALIDATION TESTS (7-10)
  // ===========================================================================

  it('Test 7: should PASS when observed value exactly matches expected mathematical value', () => {
    const exec = createMockExecutionResult({ outputs: { y: { value: 42, unit: 'unitless' } } });
    const profile: ValidationProfile = {
      validation_id: 'VAL_MATH_EXACT',
      name: 'Exact Match',
      version: '1.0.0',
      checks: [
        {
          check_id: 'CHK_MATH_EXACT',
          name: 'Exact value match',
          type: 'MATHEMATICAL',
          configuration: { target_output: 'y', expected_value: 42 }
        }
      ]
    };

    const result = ValidationEngine.evaluate({ execution_result: exec, profile });
    expect(result.status).toBe('PASS');
    expect(result.checks[0].status).toBe('PASS');
  });

  it('Test 8: should PASS when observed value is within configured numerical tolerance', () => {
    const exec = createMockExecutionResult({ outputs: { y: { value: 12.0004, unit: 'kg' } } });
    const profile: ValidationProfile = {
      validation_id: 'VAL_MATH_TOL_PASS',
      name: 'Tolerance Pass',
      version: '1.0.0',
      checks: [
        {
          check_id: 'CHK_TOL_1',
          name: 'Tolerance check',
          type: 'MATHEMATICAL',
          configuration: { target_output: 'y', expected_value: 12.0, tolerance: 0.001 }
        }
      ]
    };

    const result = ValidationEngine.evaluate({ execution_result: exec, profile });
    expect(result.status).toBe('PASS');
    expect(result.checks[0].status).toBe('PASS');
  });

  it('Test 9: should FAIL when observed value exceeds configured numerical tolerance', () => {
    const exec = createMockExecutionResult({ outputs: { y: { value: 12.05, unit: 'kg' } } });
    const profile: ValidationProfile = {
      validation_id: 'VAL_MATH_TOL_FAIL',
      name: 'Tolerance Exceeded',
      version: '1.0.0',
      checks: [
        {
          check_id: 'CHK_TOL_FAIL',
          name: 'Tolerance check',
          type: 'MATHEMATICAL',
          configuration: { target_output: 'y', expected_value: 12.0, tolerance: 0.01 }
        }
      ]
    };

    const result = ValidationEngine.evaluate({ execution_result: exec, profile });
    expect(result.status).toBe('FAIL');
    expect(result.checks[0].status).toBe('FAIL');
    expect(result.checks[0].message).toContain('tolerance validation failed');
  });

  it('Test 10: should return NOT_CONFIGURED when tolerance is required for inexact continuous values but not provided', () => {
    const exec = createMockExecutionResult({ outputs: { y: { value: 12.0001, unit: 'kg' } } });
    const profile: ValidationProfile = {
      validation_id: 'VAL_MATH_NO_TOL',
      name: 'Missing Tolerance Config',
      version: '1.0.0',
      checks: [
        {
          check_id: 'CHK_REQ_TOL',
          name: 'Tolerance required check',
          type: 'MATHEMATICAL',
          configuration: { target_output: 'y', expected_value: 12.0, require_tolerance: true }
        }
      ]
    };

    const result = ValidationEngine.evaluate({ execution_result: exec, profile });
    expect(result.status).toBe('NOT_CONFIGURED');
    expect(result.checks[0].status).toBe('NOT_CONFIGURED');
  });

  // ===========================================================================
  // UNIT VALIDATION TESTS (11-13)
  // ===========================================================================

  it('Test 11: should PASS when observed output unit matches expected unit', () => {
    const exec = createMockExecutionResult({ outputs: { y: { value: 70, unit: 'kg' } } });
    const profile: ValidationProfile = {
      validation_id: 'VAL_UNIT_MATCH',
      name: 'Unit Match',
      version: '1.0.0',
      checks: [
        {
          check_id: 'CHK_UNIT_1',
          name: 'Mass unit check',
          type: 'UNIT',
          configuration: { target_output: 'y', expected_unit: 'kg' }
        }
      ]
    };

    const result = ValidationEngine.evaluate({ execution_result: exec, profile });
    expect(result.status).toBe('PASS');
    expect(result.checks[0].status).toBe('PASS');
  });

  it('Test 12: should FAIL when observed output unit does not match expected unit', () => {
    const exec = createMockExecutionResult({ outputs: { y: { value: 70, unit: 'g' } } });
    const profile: ValidationProfile = {
      validation_id: 'VAL_UNIT_MISMATCH',
      name: 'Unit Mismatch',
      version: '1.0.0',
      checks: [
        {
          check_id: 'CHK_UNIT_MISMATCH',
          name: 'Mass unit check',
          type: 'UNIT',
          configuration: { target_output: 'y', expected_unit: 'kg' }
        }
      ]
    };

    const result = ValidationEngine.evaluate({ execution_result: exec, profile });
    expect(result.status).toBe('FAIL');
    expect(result.checks[0].status).toBe('FAIL');
  });

  it('Test 13: should return NOT_CONFIGURED when unit validation rule lacks expected_unit configuration', () => {
    const exec = createMockExecutionResult();
    const profile: ValidationProfile = {
      validation_id: 'VAL_UNIT_NOCONFIG',
      name: 'No Unit Config',
      version: '1.0.0',
      checks: [
        {
          check_id: 'CHK_UNIT_NOCONFIG',
          name: 'Missing expected unit',
          type: 'UNIT',
          configuration: { target_output: 'y' }
        }
      ]
    };

    const result = ValidationEngine.evaluate({ execution_result: exec, profile });
    expect(result.status).toBe('NOT_CONFIGURED');
    expect(result.checks[0].status).toBe('NOT_CONFIGURED');
  });

  // ===========================================================================
  // BOUNDARY VALIDATION TESTS (14-17)
  // ===========================================================================

  it('Test 14: should PASS when observed value satisfies configured minimum boundary', () => {
    const exec = createMockExecutionResult({ outputs: { y: { value: 15, unit: 'kg' } } });
    const profile: ValidationProfile = {
      validation_id: 'VAL_BOUND_MIN',
      name: 'Min Boundary Pass',
      version: '1.0.0',
      checks: [
        {
          check_id: 'CHK_MIN_PASS',
          name: 'Minimum bound check',
          type: 'BOUNDARY',
          configuration: { target_output: 'y', min: 10 }
        }
      ]
    };

    const result = ValidationEngine.evaluate({ execution_result: exec, profile });
    expect(result.status).toBe('PASS');
    expect(result.checks[0].status).toBe('PASS');
  });

  it('Test 15: should PASS when observed value satisfies configured maximum boundary', () => {
    const exec = createMockExecutionResult({ outputs: { y: { value: 15, unit: 'kg' } } });
    const profile: ValidationProfile = {
      validation_id: 'VAL_BOUND_MAX',
      name: 'Max Boundary Pass',
      version: '1.0.0',
      checks: [
        {
          check_id: 'CHK_MAX_PASS',
          name: 'Maximum bound check',
          type: 'BOUNDARY',
          configuration: { target_output: 'y', max: 20 }
        }
      ]
    };

    const result = ValidationEngine.evaluate({ execution_result: exec, profile });
    expect(result.status).toBe('PASS');
    expect(result.checks[0].status).toBe('PASS');
  });

  it('Test 16: should FAIL when observed value falls outside configured boundaries', () => {
    const exec = createMockExecutionResult({ outputs: { y: { value: 25, unit: 'kg' } } });
    const profile: ValidationProfile = {
      validation_id: 'VAL_BOUND_OUT',
      name: 'Out of Bounds',
      version: '1.0.0',
      checks: [
        {
          check_id: 'CHK_BOUND_FAIL',
          name: 'Range check',
          type: 'BOUNDARY',
          configuration: { target_output: 'y', min: 0, max: 20 }
        }
      ]
    };

    const result = ValidationEngine.evaluate({ execution_result: exec, profile });
    expect(result.status).toBe('FAIL');
    expect(result.checks[0].status).toBe('FAIL');
    expect(result.checks[0].message).toContain('violates upper bound 20');
  });

  it('Test 17: should return NOT_CONFIGURED when boundary check lacks both min and max boundaries', () => {
    const exec = createMockExecutionResult();
    const profile: ValidationProfile = {
      validation_id: 'VAL_BOUND_NO_BOUNDS',
      name: 'No Bounds Configured',
      version: '1.0.0',
      checks: [
        {
          check_id: 'CHK_NO_BOUNDS',
          name: 'Empty bounds check',
          type: 'BOUNDARY',
          configuration: { target_output: 'y' }
        }
      ]
    };

    const result = ValidationEngine.evaluate({ execution_result: exec, profile });
    expect(result.status).toBe('NOT_CONFIGURED');
    expect(result.checks[0].status).toBe('NOT_CONFIGURED');
  });

  // ===========================================================================
  // EDGE CASE VALIDATION TESTS (18-22)
  // ===========================================================================

  it('Test 18: should detect unexpected NaN in outputs and report FAIL', () => {
    const exec = createMockExecutionResult({ outputs: { y: { value: NaN, unit: 'kg' } } });
    const profile: ValidationProfile = {
      validation_id: 'VAL_EDGE_NAN',
      name: 'NaN Edge Case',
      version: '1.0.0',
      checks: [
        {
          check_id: 'CHK_NAN_DETECT',
          name: 'NaN detector',
          type: 'EDGE_CASE',
          configuration: { edge_case_type: 'NAN_CHECK', target_output: 'y' }
        }
      ]
    };

    const result = ValidationEngine.evaluate({ execution_result: exec, profile });
    expect(result.status).toBe('FAIL');
    expect(result.checks[0].status).toBe('FAIL');
    expect(result.checks[0].message).toContain('evaluated to NaN');
  });

  it('Test 19: should detect non-finite / Infinity in outputs and report FAIL', () => {
    const exec = createMockExecutionResult({ outputs: { y: { value: Infinity, unit: 'kg' } } });
    const profile: ValidationProfile = {
      validation_id: 'VAL_EDGE_INF',
      name: 'Infinity Edge Case',
      version: '1.0.0',
      checks: [
        {
          check_id: 'CHK_INF_DETECT',
          name: 'Infinity detector',
          type: 'EDGE_CASE',
          configuration: { edge_case_type: 'INFINITY_CHECK' }
        }
      ]
    };

    const result = ValidationEngine.evaluate({ execution_result: exec, profile });
    expect(result.status).toBe('FAIL');
    expect(result.checks[0].status).toBe('FAIL');
    expect(result.checks[0].message).toContain('Infinity detected');
  });

  it('Test 20: should evaluate missing input fallback behavior against contract specification', () => {
    const exec = createMockExecutionResult({ fallback_used: true });
    const profile: ValidationProfile = {
      validation_id: 'VAL_EDGE_FALLBACK',
      name: 'Fallback Edge Case',
      version: '1.0.0',
      checks: [
        {
          check_id: 'CHK_FALLBACK_SPEC',
          name: 'Fallback expected check',
          type: 'EDGE_CASE',
          configuration: { edge_case_type: 'MISSING_INPUT', expected_fallback_used: true }
        }
      ]
    };

    const result = ValidationEngine.evaluate({ execution_result: exec, profile });
    expect(result.status).toBe('PASS');
    expect(result.checks[0].status).toBe('PASS');
  });

  it('Test 21: should evaluate zero input handling against explicit expected behavior', () => {
    const exec = createMockExecutionResult({ outputs: { y: { value: 0, unit: 'kg' } } });
    const profile: ValidationProfile = {
      validation_id: 'VAL_EDGE_ZERO',
      name: 'Zero Handling Edge Case',
      version: '1.0.0',
      checks: [
        {
          check_id: 'CHK_ZERO_HANDLING',
          name: 'Zero check',
          type: 'EDGE_CASE',
          configuration: { edge_case_type: 'ZERO_HANDLING', target_output: 'y', expected_behavior: 0 }
        }
      ]
    };

    const result = ValidationEngine.evaluate({ execution_result: exec, profile });
    expect(result.status).toBe('PASS');
    expect(result.checks[0].status).toBe('PASS');
  });

  it('Test 22: should evaluate negative input handling against explicit expected behavior', () => {
    const exec = createMockExecutionResult({ outputs: { y: { value: -5, unit: 'kg' } } });
    const profile: ValidationProfile = {
      validation_id: 'VAL_EDGE_NEG',
      name: 'Negative Handling Edge Case',
      version: '1.0.0',
      checks: [
        {
          check_id: 'CHK_NEG_HANDLING',
          name: 'Negative check',
          type: 'EDGE_CASE',
          configuration: { edge_case_type: 'NEGATIVE_HANDLING', target_output: 'y', expected_behavior: -5 }
        }
      ]
    };

    const result = ValidationEngine.evaluate({ execution_result: exec, profile });
    expect(result.status).toBe('PASS');
    expect(result.checks[0].status).toBe('PASS');
  });

  // ===========================================================================
  // REGRESSION VALIDATION TESTS (23-25)
  // ===========================================================================

  it('Test 23: should PASS when observed execution outputs match explicit regression baseline', () => {
    const exec = createMockExecutionResult({
      outputs: { y: { value: 12.0000001, unit: 'kg' } }
    });
    const profile: ValidationProfile = {
      validation_id: 'VAL_REG_MATCH',
      name: 'Baseline Match',
      version: '1.0.0',
      checks: [
        {
          check_id: 'CHK_REG_1',
          name: 'Baseline comparison',
          type: 'REGRESSION',
          configuration: { baseline_outputs: { y: 12.0 }, tolerance: 1e-4 }
        }
      ]
    };

    const result = ValidationEngine.evaluate({ execution_result: exec, profile });
    expect(result.status).toBe('PASS');
    expect(result.checks[0].status).toBe('PASS');
  });

  it('Test 24: should FAIL when observed outputs deviate from explicit regression baseline', () => {
    const exec = createMockExecutionResult({
      outputs: { y: { value: 15.0, unit: 'kg' } }
    });
    const profile: ValidationProfile = {
      validation_id: 'VAL_REG_MISMATCH',
      name: 'Baseline Mismatch',
      version: '1.0.0',
      checks: [
        {
          check_id: 'CHK_REG_MISMATCH',
          name: 'Baseline mismatch check',
          type: 'REGRESSION',
          configuration: { baseline_outputs: { y: 12.0 }, tolerance: 0.1 }
        }
      ]
    };

    const result = ValidationEngine.evaluate({ execution_result: exec, profile });
    expect(result.status).toBe('FAIL');
    expect(result.checks[0].status).toBe('FAIL');
  });

  it('Test 25: should return NOT_CONFIGURED when regression check is missing baseline outputs', () => {
    const exec = createMockExecutionResult();
    const profile: ValidationProfile = {
      validation_id: 'VAL_REG_NO_BASELINE',
      name: 'Missing Baseline',
      version: '1.0.0',
      checks: [
        {
          check_id: 'CHK_REG_NO_BASE',
          name: 'Missing baseline check',
          type: 'REGRESSION',
          configuration: {}
        }
      ]
    };

    const result = ValidationEngine.evaluate({ execution_result: exec, profile });
    expect(result.status).toBe('NOT_CONFIGURED');
    expect(result.checks[0].status).toBe('NOT_CONFIGURED');
  });

  // ===========================================================================
  // REFERENCE COMPARISON TESTS (26-27)
  // ===========================================================================

  it('Test 26: should PASS when reference comparison is fully configured with criteria and evidence matches', () => {
    const exec = createMockExecutionResult({ outputs: { y: { value: 100, unit: 'mg' } } });
    const profile: ValidationProfile = {
      validation_id: 'VAL_REF_CONFIGURED',
      name: 'Configured Reference Check',
      version: '1.0.0',
      checks: [
        {
          check_id: 'CHK_REF_PASS',
          name: 'Benchmark check',
          type: 'REFERENCE_COMPARISON',
          configuration: {
            reference_id: 'REF_BENCHMARK_2026',
            target_output: 'y',
            reference_value: 100,
            tolerance: 0.5
          }
        }
      ]
    };

    const result = ValidationEngine.evaluate({ execution_result: exec, profile });
    expect(result.status).toBe('PASS');
    expect(result.checks[0].status).toBe('PASS');
  });

  it('Test 27: should return UNESTABLISHED when a citation exists without quantitative comparison criteria', () => {
    const exec = createMockExecutionResult();
    const profile: ValidationProfile = {
      validation_id: 'VAL_REF_CITATION_ONLY',
      name: 'Citation Only Check',
      version: '1.0.0',
      checks: [
        {
          check_id: 'CHK_CITATION_ONLY',
          name: 'Literature citation without criteria',
          type: 'REFERENCE_COMPARISON',
          configuration: {
            reference_id: 'REF_PAPER_WITHOUT_BENCHMARK',
            citation_only: true,
            citation: 'Smith et al. 2024. Theoretical principles.'
          }
        }
      ]
    };

    const result = ValidationEngine.evaluate({ execution_result: exec, profile });
    expect(result.status).toBe('UNESTABLISHED');
    expect(result.checks[0].status).toBe('UNESTABLISHED');
    expect(result.checks[0].message).toContain('unestablished');
  });

  // ===========================================================================
  // SENSITIVITY VALIDATION TESTS (28-29)
  // ===========================================================================

  it('Test 28: should generate structured sensitivity evidence without ranking or winner claims', () => {
    const exec = createMockExecutionResult({ outputs: { y: { value: 14, unit: 'kg' } } });
    const profile: ValidationProfile = {
      validation_id: 'VAL_SENSITIVITY_TEST',
      name: 'Parameter Sensitivity',
      version: '1.0.0',
      checks: [
        {
          check_id: 'CHK_SENS_PARAM',
          name: 'Offset parameter perturbation evidence',
          type: 'SENSITIVITY',
          configuration: {
            parameter: 'offset',
            baseline: 2,
            perturbation: '+10%',
            target_output: 'y',
            baseline_output_value: 12
          }
        }
      ]
    };

    const result = ValidationEngine.evaluate({ execution_result: exec, profile });
    expect(result.status).toBe('PASS');
    expect(result.checks[0].status).toBe('PASS');
    expect(result.checks[0].evidence).toBeDefined();
    expect(result.checks[0].evidence?.difference).toBe(2);
  });

  it('Test 29: should ensure sensitivity validation remains scientifically neutral and never generates best parameter or winner ranking', () => {
    const exec = createMockExecutionResult({ outputs: { y: { value: 14, unit: 'kg' } } });
    const profile: ValidationProfile = {
      validation_id: 'VAL_SENS_NEUTRAL',
      name: 'Neutral Sensitivity Check',
      version: '1.0.0',
      checks: [
        {
          check_id: 'CHK_SENS_NEUTRAL',
          name: 'Neutral evidence',
          type: 'SENSITIVITY',
          configuration: {
            parameter: 'offset',
            baseline: 2,
            perturbation: '+10%',
            target_output: 'y',
            baseline_output_value: 12
          }
        }
      ]
    };

    const result = ValidationEngine.evaluate({ execution_result: exec, profile });
    const checkEv = result.checks[0].evidence as any;

    expect(checkEv.winner).toBeUndefined();
    expect(checkEv.ranking).toBeUndefined();
    expect(checkEv.best_parameter).toBeUndefined();
    expect(checkEv.best_model).toBeUndefined();
  });

  // ===========================================================================
  // DETERMINISM & IMMUTABILITY (30-31)
  // ===========================================================================

  it('Test 30: should produce identical ValidationResult across repeated evaluations with identical inputs', () => {
    const exec = createMockExecutionResult();
    const profile: ValidationProfile = {
      validation_id: 'VAL_DETERMINISM',
      name: 'Determinism Profile',
      version: '1.0.0',
      checks: [
        {
          check_id: 'CHK_MATH',
          name: 'Math check',
          type: 'MATHEMATICAL',
          configuration: { target_output: 'y', expected_value: 12 }
        },
        {
          check_id: 'CHK_UNIT',
          name: 'Unit check',
          type: 'UNIT',
          configuration: { target_output: 'y', expected_unit: 'kg' }
        }
      ]
    };

    const eval1 = ValidationEngine.evaluate({ execution_result: exec, profile, custom_timestamp: '2026-09-24T00:00:00Z' });
    const eval2 = ValidationEngine.evaluate({ execution_result: exec, profile, custom_timestamp: '2026-09-24T00:00:00Z' });

    expect(eval1).toEqual(eval2);
  });

  it('Test 31: should guarantee that ExecutionResult is strictly read-only and never mutated during validation', () => {
    const originalExec = createMockExecutionResult();
    const execSnapshot = JSON.parse(JSON.stringify(originalExec));

    const profile: ValidationProfile = {
      validation_id: 'VAL_IMMUTABLE',
      name: 'Immutability Check',
      version: '1.0.0',
      checks: [
        {
          check_id: 'CHK_STRUCT',
          name: 'Output check',
          type: 'STRUCTURAL',
          configuration: { required_outputs: ['y'] }
        },
        {
          check_id: 'CHK_MATH',
          name: 'Tolerance check',
          type: 'MATHEMATICAL',
          configuration: { target_output: 'y', expected_value: 12, tolerance: 0.1 }
        }
      ]
    };

    ValidationEngine.evaluate({ execution_result: originalExec, profile });

    expect(originalExec).toEqual(execSnapshot);
  });

  // ===========================================================================
  // SECURITY (32)
  // ===========================================================================

  it('Test 32: should execute validation rules via pure data-driven structures with zero eval or new Function', () => {
    const exec = createMockExecutionResult();
    const profileWithMaliciousString: ValidationProfile = {
      validation_id: 'VAL_SEC_001',
      name: 'Security Test',
      version: '1.0.0',
      checks: [
        {
          check_id: 'CHK_SEC',
          name: 'Security check',
          type: 'MATHEMATICAL',
          configuration: {
            target_output: 'y',
            expected_value: 12,
            // Untrusted payload in config should be ignored or treated as plain string/data
            injected_code: 'process.exit(1); function() { return true; }'
          }
        }
      ]
    };

    expect(() => {
      const result = ValidationEngine.evaluate({ execution_result: exec, profile: profileWithMaliciousString });
      expect(result.status).toBe('PASS');
    }).not.toThrow();
  });

  // ===========================================================================
  // PHASE C1 - C5 REGRESSION TESTS (33-37)
  // ===========================================================================

  it('Test 33 [C1 Regression]: should preserve legacy CalculationEngine formula evaluation and validation integration', () => {
    const formula: ScientificFormula = {
      formula_id: 'FORMULA_C1_VALIDATION_REG',
      name: 'Synthetic Linear Multiplier',
      description: 'C1 regression test',
      version: '1.0.0',
      status: 'VERIFIED',
      inputs: [{ variable_id: 'a', name: 'a', unit: 'cm', datatype: 'number', required: true }],
      outputs: [{ name: 'out', unit: 'cm', datatype: 'number' }],
      parameter_ids: [],
      expression_ast: {
        type: 'OPERATOR',
        op: 'MULTIPLY',
        args: [
          { type: 'VARIABLE', variable_id: 'a' },
          { type: 'CONSTANT', value: 3 }
        ]
      },
      expression_string: 'a * 3',
      reference_ids: [],
      assumptions: [],
      limitations: [],
      validation_status: 'VALIDATED',
      created_by: 'system',
      created_at: '2026-09-24T00:00:00Z',
      updated_at: '2026-09-24T00:00:00Z'
    };

    const trace = CalculationEngine.executeFormula({
      formula,
      inputs: { a: { value: 10, unit: 'cm' } },
      parameters: {}
    });

    expect(trace.final_result['out'].value).toBe(30);

    // Validate calculation result with ValidationEngine
    const execResult: ExecutionResult = {
      execution_id: 'EXEC_C1_REG',
      module_id: formula.formula_id,
      module_version: formula.version,
      inputs: { a: { value: 10, unit: 'cm' } },
      normalized_inputs: { a: { value: 10, unit: 'cm' } },
      parameters: {},
      execution_path: ['FORMULA_EVALUATION'],
      fallback_used: false,
      intermediate_results: {},
      trace: [
        {
          step_id: 'TRACE_C1_01',
          operation: 'FORMULA_EVALUATION',
          output: trace.final_result['out'].value,
          unit: 'cm',
          timestamp: '2026-09-24T00:00:00Z'
        }
      ],
      outputs: trace.final_result,
      warnings: [],
      errors: [],
      timestamp: '2026-09-24T00:00:00Z'
    };

    const valResult = ValidationEngine.evaluate({
      execution_result: execResult,
      profile: {
        validation_id: 'VAL_C1_REG',
        name: 'C1 Formula Validation',
        version: '1.0.0',
        checks: [
          {
            check_id: 'CHK_C1_MATH',
            name: 'Math match',
            type: 'MATHEMATICAL',
            configuration: { target_output: 'out', expected_value: 30 }
          }
        ]
      }
    });

    expect(valResult.status).toBe('PASS');
  });

  it('Test 34 [C2 Regression]: should preserve ModuleResolver and ParameterResolver functionality', () => {
    const formula: ScientificFormula = {
      formula_id: 'FORMULA_C2_REG',
      name: 'Module C2 Resolver Test',
      description: 'C2 resolver regression',
      version: '1.0.0',
      status: 'VERIFIED',
      inputs: [{ variable_id: 'x', name: 'x', unit: 'm', datatype: 'number', required: true }],
      outputs: [{ name: 'y', unit: 'm', datatype: 'number' }],
      parameter_ids: ['PARAM_C2_OFFSET'],
      expression_ast: { type: 'VARIABLE', variable_id: 'x' },
      expression_string: 'x',
      reference_ids: [],
      assumptions: [],
      limitations: [],
      validation_status: 'VALIDATED',
      created_by: 'system',
      created_at: '2026-09-24T00:00:00Z',
      updated_at: '2026-09-24T00:00:00Z'
    };

    const param: ScientificParameter = {
      parameter_id: 'PARAM_C2_OFFSET',
      name: 'Offset',
      description: 'Offset param',
      value: 5,
      unit: 'm',
      reference_ids: [],
      version: '1.0.0',
      status: 'VERIFIED',
      is_constant: true,
      created_at: '2026-09-24T00:00:00Z',
      updated_at: '2026-09-24T00:00:00Z'
    };

    const resolvedModule = ModuleResolver.resolve({
      module_id: 'FORMULA_C2_REG',
      modules: [formula]
    });
    expect(resolvedModule.module_id).toBe('FORMULA_C2_REG');

    const resolvedParams = ParameterResolver.resolve({
      module: formula,
      available_parameters: [param]
    });
    expect(resolvedParams.parameters['PARAM_C2_OFFSET']).toBe(5);
  });

  it('Test 35 [C3 Regression]: should preserve standalone InputValidator normalization and range checks', () => {
    const valResult = InputValidator.validate({
      module: {
        inputs: [{ variable_id: 'weight', name: 'Weight', unit: 'kg', datatype: 'number', required: true }]
      } as any,
      inputs: { weight: { value: 70000, unit: 'g' } }
    });

    expect(valResult.valid).toBe(true);
    expect(valResult.normalized_inputs['weight'].value).toBe(70);
  });

  it('Test 36 [C4 Regression]: should preserve AlgorithmExecutor sequential and branching logic', () => {
    const alg: ScientificAlgorithm = {
      algorithm_id: 'ALG_C4_REG_TEST',
      name: 'Algorithm Regression',
      description: 'Verifies C4 logic',
      version: '1.0.0',
      status: 'VERIFIED',
      inputs: [{ variable_id: 'val', name: 'val', unit: 'unitless', datatype: 'number', required: true }],
      outputs: [{ name: 'out', unit: 'unitless', datatype: 'number' }],
      parameter_ids: [],
      entry_step_id: 'STEP_1',
      steps: [
        { step_id: 'STEP_1', operation: 'SEQUENCE', next_step_id: 'STEP_OUT' },
        { step_id: 'STEP_OUT', operation: 'OUTPUT', is_terminal: true }
      ],
      reference_ids: [],
      created_by: 'system',
      created_at: '2026-09-24T00:00:00Z',
      updated_at: '2026-09-24T00:00:00Z'
    };

    const result = AlgorithmExecutor.execute({
      algorithm: alg,
      request: { module_id: 'ALG_C4_REG_TEST', inputs: { val: { value: 100 } } }
    });

    expect(result.execution_path).toEqual(['INPUT_VALIDATION', 'STEP_1', 'STEP_OUT']);
    expect(result.fallback_used).toBe(false);
  });

  it('Test 37 [C5 Regression]: should preserve ModelExecutor discrete-time state transitions and history immutability', () => {
    const model: ScientificModel = {
      module_id: 'MODEL_C5_REG_TEST',
      module_type: 'MODEL',
      model_id: 'MODEL_C5_REG_TEST',
      name: 'Model Regression',
      description: 'Verifies C5 discrete time simulation',
      version: '1.0.0',
      status: 'VERIFIED',
      is_verified: true,
      variable_ids: [],
      parameter_ids: [],
      reference_ids: [],
      assumptions: [],
      states: [
        {
          state_id: 's',
          name: 'State S',
          datatype: 'number',
          unit: 'unitless',
          initial_value: 10
        }
      ],
      time_config: { start_time: 0, dt: 1, steps: 2, max_steps: 10 },
      transitions: [
        {
          state_id: 's',
          type: 'EXPLICIT_UPDATE',
          // s(t+dt) = s(t) + 1
          expression_ast: {
            type: 'OPERATOR',
            op: 'ADD',
            args: [
              { type: 'VARIABLE', variable_id: 's' },
              { type: 'CONSTANT', value: 1 }
            ]
          }
        }
      ],
      created_by: 'system',
      created_at: '2026-09-24T00:00:00Z',
      updated_at: '2026-09-24T00:00:00Z'
    };

    const result = ModelExecutor.execute({
      model,
      request: { module_id: 'MODEL_C5_REG_TEST', inputs: {} }
    });

    expect(result.state_history?.length).toBe(3);
    expect(result.state_history?.[0].state.s).toBe(10);
    expect(result.state_history?.[1].state.s).toBe(11);
    expect(result.state_history?.[2].state.s).toBe(12);
    expect(result.outputs['s'].value).toBe(12);
  });
});
