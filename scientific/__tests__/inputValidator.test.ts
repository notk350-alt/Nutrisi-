/**
 * NutriBodySim — Phase C3 Test Suite: Standalone Input Validator
 * 
 * Verifies all 24 required test cases:
 * 1. required input present
 * 2. required input missing
 * 3. optional input missing
 * 4. IGNORE policy
 * 5. DEFAULT policy
 * 6. FALLBACK signal
 * 7. ERROR policy
 * 8. valid datatype
 * 9. invalid datatype
 * 10. null handling
 * 11. compatible unit
 * 12. incompatible unit
 * 13. unit normalization
 * 14. lower range violation
 * 15. upper range violation
 * 16. exact boundary
 * 17. normalized value used for range
 * 18. warning propagation
 * 19. error blocks execution
 * 20. fallback does not select algorithm branch
 * 21. deterministic result
 * 22. C1 compatibility
 * 23. C2 compatibility
 * 24. existing calculation regression
 */

import { describe, it, expect } from 'vitest';
import {
  InputValidator,
  executeModuleRequest,
  CalculationEngine,
  ScientificFormula,
  ScientificVariable,
  ScientificParameter,
  ModuleRequest,
  DEMO_FORMULAS,
  DEMO_PARAMETERS,
  DEMO_VARIABLES
} from '../index';

describe('Phase C3: Standalone Input Validator', () => {
  const varMap: Record<string, ScientificVariable> = {};
  DEMO_VARIABLES.forEach(v => { varMap[v.variable_id] = { ...v }; });

  const paramMap: Record<string, ScientificParameter> = {};
  DEMO_PARAMETERS.forEach(p => { paramMap[p.parameter_id] = { ...p }; });

  const queteletFormula = DEMO_FORMULAS.find(f => f.formula_id === 'FORMULA_DEMO_QUETELET')!;
  const bmiFormula = DEMO_FORMULAS.find(f => f.formula_id === 'FORMULA_BMI_QUETELET')!;

  // ---------------------------------------------------------------------------
  // TEST 1 — Required Input Present
  // ---------------------------------------------------------------------------
  describe('Test 1 — Required Input Present', () => {
    it('should validate successfully when all required inputs are present', () => {
      const result = InputValidator.validate({
        module: queteletFormula,
        inputs: {
          VAR_DEMO_WEIGHT: { value: 70, unit: 'kg' },
          VAR_DEMO_HEIGHT: { value: 1.75, unit: 'm' }
        },
        variables: varMap
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.normalized_inputs.VAR_DEMO_WEIGHT.value).toBe(70);
      expect(result.normalized_inputs.VAR_DEMO_HEIGHT.value).toBe(1.75);
      expect(result.validation_details.VAR_DEMO_WEIGHT.status).toBe('VALID');
      expect(result.validation_details.VAR_DEMO_HEIGHT.status).toBe('VALID');
    });
  });

  // ---------------------------------------------------------------------------
  // TEST 2 — Required Input Missing
  // ---------------------------------------------------------------------------
  describe('Test 2 — Required Input Missing', () => {
    it('should fail with explicit error when a required input is completely missing', () => {
      const result = InputValidator.validate({
        module: queteletFormula,
        inputs: {
          VAR_DEMO_WEIGHT: { value: 70, unit: 'kg' }
          // VAR_DEMO_HEIGHT omitted
        },
        variables: varMap
      });

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('Required variable "Height" (VAR_DEMO_HEIGHT) is missing');
      expect(result.validation_details.VAR_DEMO_HEIGHT.status).toBe('ERROR');
    });
  });

  // ---------------------------------------------------------------------------
  // TEST 3 — Optional Input Missing
  // ---------------------------------------------------------------------------
  describe('Test 3 — Optional Input Missing', () => {
    const formulaWithOptional: ScientificFormula = {
      ...queteletFormula,
      inputs: [
        ...queteletFormula.inputs,
        {
          variable_id: 'VAR_OPTIONAL_WAIST',
          name: 'Waist Circumference',
          unit: 'cm',
          required: false,
          missing_policy: 'OPTIONAL'
        }
      ]
    };

    it('should succeed when an optional input is omitted without creating silent fake values', () => {
      const result = InputValidator.validate({
        module: formulaWithOptional,
        inputs: {
          VAR_DEMO_WEIGHT: { value: 70, unit: 'kg' },
          VAR_DEMO_HEIGHT: { value: 1.75, unit: 'm' }
        },
        variables: varMap
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.normalized_inputs.VAR_OPTIONAL_WAIST).toBeUndefined();
      expect(result.validation_details.VAR_OPTIONAL_WAIST.status).toBe('SKIPPED');
    });
  });

  // ---------------------------------------------------------------------------
  // TEST 4 — IGNORE Policy
  // ---------------------------------------------------------------------------
  describe('Test 4 — IGNORE Policy', () => {
    const formulaWithIgnore: ScientificFormula = {
      ...queteletFormula,
      inputs: [
        ...queteletFormula.inputs,
        {
          variable_id: 'VAR_IGNORED_META',
          name: 'Telemetry Meta',
          unit: 'unitless',
          required: false,
          missing_policy: 'IGNORE'
        }
      ]
    };

    it('should completely skip inputs flagged with IGNORE policy whether provided or not', () => {
      const result = InputValidator.validate({
        module: formulaWithIgnore,
        inputs: {
          VAR_DEMO_WEIGHT: { value: 70, unit: 'kg' },
          VAR_DEMO_HEIGHT: { value: 1.75, unit: 'm' },
          VAR_IGNORED_META: { value: 'some_telemetry_payload', unit: 'unitless' }
        },
        variables: varMap
      });

      expect(result.valid).toBe(true);
      expect(result.normalized_inputs.VAR_IGNORED_META).toBeUndefined();
      expect(result.validation_details.VAR_IGNORED_META.status).toBe('SKIPPED');
    });
  });

  // ---------------------------------------------------------------------------
  // TEST 5 — DEFAULT Policy
  // ---------------------------------------------------------------------------
  describe('Test 5 — DEFAULT Policy', () => {
    const formulaWithDefault: ScientificFormula = {
      ...queteletFormula,
      inputs: [
        ...queteletFormula.inputs,
        {
          variable_id: 'VAR_ACTIVITY_FACTOR',
          name: 'Activity Physical Factor',
          unit: 'ratio',
          required: false,
          missing_policy: 'DEFAULT',
          default_value: 1.2
        }
      ]
    };

    it('should apply the specified default value and emit a warning when missing', () => {
      const result = InputValidator.validate({
        module: formulaWithDefault,
        inputs: {
          VAR_DEMO_WEIGHT: { value: 70, unit: 'kg' },
          VAR_DEMO_HEIGHT: { value: 1.75, unit: 'm' }
        },
        variables: varMap
      });

      expect(result.valid).toBe(true);
      expect(result.normalized_inputs.VAR_ACTIVITY_FACTOR.value).toBe(1.2);
      expect(result.validation_details.VAR_ACTIVITY_FACTOR.status).toBe('DEFAULT_APPLIED');
      expect(result.warnings.some(w => w.includes('Default value 1.2'))).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // TEST 6 — FALLBACK Signal
  // ---------------------------------------------------------------------------
  describe('Test 6 — FALLBACK Signal', () => {
    const formulaWithFallback: ScientificFormula = {
      ...queteletFormula,
      inputs: [
        {
          variable_id: 'VAR_DEMO_WEIGHT',
          name: 'Body Weight',
          unit: 'kg',
          required: false,
          missing_policy: 'FALLBACK'
        },
        {
          variable_id: 'VAR_DEMO_HEIGHT',
          name: 'Height',
          unit: 'm',
          required: true
        }
      ]
    };

    it('should set fallback_required signal without picking an algorithm branch', () => {
      const result = InputValidator.validate({
        module: formulaWithFallback,
        inputs: {
          VAR_DEMO_HEIGHT: { value: 1.75, unit: 'm' }
          // Weight omitted, triggers fallback signal
        },
        variables: varMap
      });

      expect(result.fallback_required).toBe(true);
      expect(result.validation_details.VAR_DEMO_WEIGHT.status).toBe('FALLBACK_SIGNAL');
      // Must not contain algorithm branch selection (that is C4)
      expect((result as any).fallback_branch).toBeUndefined();
      expect((result as any).alternative_module).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // TEST 7 — ERROR Policy
  // ---------------------------------------------------------------------------
  describe('Test 7 — ERROR Policy', () => {
    const formulaWithErrorPolicy: ScientificFormula = {
      ...queteletFormula,
      inputs: [
        {
          variable_id: 'VAR_DEMO_WEIGHT',
          name: 'Body Weight',
          unit: 'kg',
          required: false,
          missing_policy: 'ERROR'
        }
      ]
    };

    it('should block execution with explicit error under ERROR policy', () => {
      const result = InputValidator.validate({
        module: formulaWithErrorPolicy,
        inputs: {},
        variables: varMap
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('missing under ERROR policy'))).toBe(true);
      expect(result.validation_details.VAR_DEMO_WEIGHT.status).toBe('ERROR');
    });
  });

  // ---------------------------------------------------------------------------
  // TEST 8 — Valid Datatype
  // ---------------------------------------------------------------------------
  describe('Test 8 — Valid Datatype', () => {
    const formulaDatatypes: ScientificFormula = {
      ...queteletFormula,
      inputs: [
        { variable_id: 'VAR_NUM', name: 'Num', unit: 'unitless', required: true, datatype: 'number' },
        { variable_id: 'VAR_INT', name: 'Int', unit: 'unitless', required: true, datatype: 'integer' },
        { variable_id: 'VAR_BOOL', name: 'Bool', unit: 'unitless', required: true, datatype: 'boolean' },
        { variable_id: 'VAR_STR', name: 'Str', unit: 'unitless', required: true, datatype: 'string' }
      ]
    };

    it('should accept valid number, integer, boolean, and string values', () => {
      const result = InputValidator.validate({
        module: formulaDatatypes,
        inputs: {
          VAR_NUM: { value: 42.5, unit: 'unitless' },
          VAR_INT: { value: 42, unit: 'unitless' },
          VAR_BOOL: { value: true, unit: 'unitless' },
          VAR_STR: { value: 'normative_cohort', unit: 'unitless' }
        },
        variables: varMap
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // TEST 9 — Invalid Datatype
  // ---------------------------------------------------------------------------
  describe('Test 9 — Invalid Datatype', () => {
    it('should reject non-numeric string for number datatype', () => {
      const result = InputValidator.validate({
        module: queteletFormula,
        inputs: {
          VAR_DEMO_WEIGHT: { value: 'not-a-number', unit: 'kg' },
          VAR_DEMO_HEIGHT: { value: 1.75, unit: 'm' }
        },
        variables: varMap
      });

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Datatype Error: Input "Weight" must be a valid number');
    });

    it('should reject float value for integer datatype', () => {
      const intFormula: ScientificFormula = {
        ...queteletFormula,
        inputs: [
          { variable_id: 'VAR_AGE_INT', name: 'Age Integer', unit: 'yr', required: true, datatype: 'integer' }
        ]
      };

      const result = InputValidator.validate({
        module: intFormula,
        inputs: {
          VAR_AGE_INT: { value: 30.7, unit: 'yr' }
        },
        variables: varMap
      });

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('must be an integer');
    });
  });

  // ---------------------------------------------------------------------------
  // TEST 10 — Null Handling
  // ---------------------------------------------------------------------------
  describe('Test 10 — Null Handling', () => {
    it('should distinguish null value from missing and never coerce null to 0', () => {
      const result = InputValidator.validate({
        module: queteletFormula,
        inputs: {
          VAR_DEMO_WEIGHT: { value: null as any, unit: 'kg' },
          VAR_DEMO_HEIGHT: { value: 1.75, unit: 'm' }
        },
        variables: varMap
      });

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('was provided as null');
      expect(result.normalized_inputs.VAR_DEMO_WEIGHT).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // TEST 11 — Compatible Unit
  // ---------------------------------------------------------------------------
  describe('Test 11 — Compatible Unit', () => {
    it('should accept and validate compatible units (e.g. grams for kilograms)', () => {
      const result = InputValidator.validate({
        module: queteletFormula,
        inputs: {
          VAR_DEMO_WEIGHT: { value: 70000, unit: 'g' },
          VAR_DEMO_HEIGHT: { value: 1.75, unit: 'm' }
        },
        variables: varMap
      });

      expect(result.valid).toBe(true);
      expect(result.normalized_inputs.VAR_DEMO_WEIGHT.value).toBe(70);
      expect(result.normalized_inputs.VAR_DEMO_WEIGHT.unit).toBe('kg');
      expect(result.normalized_inputs.VAR_DEMO_WEIGHT.original_unit).toBe('g');
    });
  });

  // ---------------------------------------------------------------------------
  // TEST 12 — Incompatible Unit / Dimension Mismatch
  // ---------------------------------------------------------------------------
  describe('Test 12 — Incompatible Unit', () => {
    it('should reject dimensionally incompatible units (e.g. length unit meters for weight input)', () => {
      const result = InputValidator.validate({
        module: queteletFormula,
        inputs: {
          VAR_DEMO_WEIGHT: { value: 70, unit: 'm' }, // Error: meters (length) given for weight (mass)
          VAR_DEMO_HEIGHT: { value: 1.75, unit: 'm' }
        },
        variables: varMap
      });

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Dimension Error');
      expect(result.errors[0]).toContain('expects dimension "mass" (kg), but received incompatible dimension "length" (m)');
    });
  });

  // ---------------------------------------------------------------------------
  // TEST 13 — Unit Normalization
  // ---------------------------------------------------------------------------
  describe('Test 13 — Unit Normalization', () => {
    it('should accurately convert height from cm to meters (175 cm -> 1.75 m)', () => {
      const result = InputValidator.validate({
        module: queteletFormula,
        inputs: {
          VAR_DEMO_WEIGHT: { value: 70, unit: 'kg' },
          VAR_DEMO_HEIGHT: { value: 175, unit: 'cm' }
        },
        variables: varMap
      });

      expect(result.valid).toBe(true);
      expect(result.normalized_inputs.VAR_DEMO_HEIGHT.value).toBe(1.75);
      expect(result.normalized_inputs.VAR_DEMO_HEIGHT.unit).toBe('m');
      expect(result.normalized_inputs.VAR_DEMO_HEIGHT.original_unit).toBe('cm');
    });
  });

  // ---------------------------------------------------------------------------
  // TEST 14 — Lower Range Violation
  // ---------------------------------------------------------------------------
  describe('Test 14 — Lower Range Violation', () => {
    it('should reject values strictly below allowed range minimum (e.g. weight < 2 kg)', () => {
      const result = InputValidator.validate({
        module: queteletFormula,
        inputs: {
          VAR_DEMO_WEIGHT: { value: 0.5, unit: 'kg' }, // Below 2.0 kg min
          VAR_DEMO_HEIGHT: { value: 1.75, unit: 'm' }
        },
        variables: varMap
      });

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Range Error: Variable "Weight" value 0.5 is below the valid minimum of 2 kg');
    });
  });

  // ---------------------------------------------------------------------------
  // TEST 15 — Upper Range Violation
  // ---------------------------------------------------------------------------
  describe('Test 15 — Upper Range Violation', () => {
    it('should reject values strictly exceeding allowed range maximum (e.g. height > 2.8 m)', () => {
      const result = InputValidator.validate({
        module: queteletFormula,
        inputs: {
          VAR_DEMO_WEIGHT: { value: 70, unit: 'kg' },
          VAR_DEMO_HEIGHT: { value: 3.5, unit: 'm' } // Above 2.8 m max
        },
        variables: varMap
      });

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Range Error: Variable "Height" value 3.5 exceeds the valid maximum of 2.8 m');
    });
  });

  // ---------------------------------------------------------------------------
  // TEST 16 — Exact Boundary Check
  // ---------------------------------------------------------------------------
  describe('Test 16 — Exact Boundary Check', () => {
    const boundaryFormula: ScientificFormula = {
      ...queteletFormula,
      inputs: [
        {
          variable_id: 'VAR_INCLUSIVE',
          name: 'Inclusive Input',
          unit: 'unitless',
          required: true,
          allowed_range: { min: 10, max: 20, min_inclusive: true, max_inclusive: true }
        },
        {
          variable_id: 'VAR_EXCLUSIVE',
          name: 'Exclusive Input',
          unit: 'unitless',
          required: true,
          allowed_range: { min: 10, max: 20, min_inclusive: false, max_inclusive: false }
        }
      ]
    };

    it('should allow exact boundary value when inclusive is true', () => {
      const result = InputValidator.validate({
        module: boundaryFormula,
        inputs: {
          VAR_INCLUSIVE: { value: 10, unit: 'unitless' },
          VAR_EXCLUSIVE: { value: 15, unit: 'unitless' }
        }
      });

      expect(result.valid).toBe(true);
    });

    it('should reject exact boundary value when inclusive is false', () => {
      const result = InputValidator.validate({
        module: boundaryFormula,
        inputs: {
          VAR_INCLUSIVE: { value: 15, unit: 'unitless' },
          VAR_EXCLUSIVE: { value: 10, unit: 'unitless' } // Exact min with min_inclusive: false
        }
      });

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('is less than or equal to exclusive minimum of 10');
    });
  });

  // ---------------------------------------------------------------------------
  // TEST 17 — Normalized Value Used For Range Evaluation
  // ---------------------------------------------------------------------------
  describe('Test 17 — Normalized Value Used For Range Evaluation', () => {
    it('should evaluate allowed_range against normalized value (70000 g -> 70 kg), not raw 70000', () => {
      // VAR_DEMO_WEIGHT max is 650 kg.
      // Raw 70000 would fail if evaluated unnormalized, but normalizes to 70 kg which is valid!
      const result = InputValidator.validate({
        module: queteletFormula,
        inputs: {
          VAR_DEMO_WEIGHT: { value: 70000, unit: 'g' },
          VAR_DEMO_HEIGHT: { value: 1.75, unit: 'm' }
        },
        variables: varMap
      });

      expect(result.valid).toBe(true);
      expect(result.normalized_inputs.VAR_DEMO_WEIGHT.value).toBe(70);
    });
  });

  // ---------------------------------------------------------------------------
  // TEST 18 — Warning Propagation
  // ---------------------------------------------------------------------------
  describe('Test 18 — Warning Propagation', () => {
    it('should propagate warning message and trace step when warning threshold is breached without blocking valid execution', () => {
      // VAR_DEMO_WEIGHT has warning_max: 250 kg. Input 260 kg should trigger warning, not error.
      const result = InputValidator.validate({
        module: queteletFormula,
        inputs: {
          VAR_DEMO_WEIGHT: { value: 260, unit: 'kg' },
          VAR_DEMO_HEIGHT: { value: 1.75, unit: 'm' }
        },
        variables: varMap
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('Variable "Weight" is unusually high');
      expect(result.trace_steps.some(s => s.action === 'RANGE_WARNING')).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // TEST 19 — Error Blocks Execution
  // ---------------------------------------------------------------------------
  describe('Test 19 — Error Blocks Execution', () => {
    it('should throw and block CalculationEngine execution when validation fails', () => {
      expect(() => {
        CalculationEngine.executeFormula({
          formula: queteletFormula,
          inputs: {
            VAR_DEMO_WEIGHT: { value: 70, unit: 'm' }, // Incompatible unit
            VAR_DEMO_HEIGHT: { value: 1.75, unit: 'm' }
          },
          variables: varMap
        });
      }).toThrowError(/Dimension Error/);
    });
  });

  // ---------------------------------------------------------------------------
  // TEST 20 — Fallback Does Not Select Algorithm Branch
  // ---------------------------------------------------------------------------
  describe('Test 20 — Fallback Does Not Select Algorithm Branch', () => {
    const fallbackFormula: ScientificFormula = {
      ...queteletFormula,
      inputs: [
        {
          variable_id: 'VAR_DEMO_WEIGHT',
          name: 'Body Weight',
          unit: 'kg',
          required: false,
          missing_policy: 'FALLBACK'
        }
      ]
    };

    it('should only provide fallback signal and not specify execution branch', () => {
      const result = InputValidator.validate({
        module: fallbackFormula,
        inputs: {}
      });

      expect(result.fallback_required).toBe(true);
      expect((result as any).branch_id).toBeUndefined();
      expect((result as any).selected_formula).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // TEST 21 — Deterministic Result
  // ---------------------------------------------------------------------------
  describe('Test 21 — Deterministic Result', () => {
    it('should produce identical validation result across multiple invocations with identical input', () => {
      const options = {
        module: queteletFormula,
        inputs: {
          VAR_DEMO_WEIGHT: { value: 70, unit: 'kg' },
          VAR_DEMO_HEIGHT: { value: 175, unit: 'cm' }
        },
        variables: varMap
      };

      const res1 = InputValidator.validate(options);
      const res2 = InputValidator.validate(options);

      expect(res1.valid).toBe(res2.valid);
      expect(res1.normalized_inputs).toEqual(res2.normalized_inputs);
      expect(res1.warnings).toEqual(res2.warnings);
      expect(res1.errors).toEqual(res2.errors);
      expect(res1.fallback_required).toBe(res2.fallback_required);
    });
  });

  // ---------------------------------------------------------------------------
  // TEST 22 — C1 Compatibility
  // ---------------------------------------------------------------------------
  describe('Test 22 — C1 Compatibility', () => {
    it('should execute seamlessly via executeModuleRequest C1 interface', () => {
      const request: ModuleRequest = {
        module_id: 'FORMULA_DEMO_QUETELET',
        inputs: {
          VAR_DEMO_WEIGHT: { value: 70, unit: 'kg' },
          VAR_DEMO_HEIGHT: { value: 1.75, unit: 'm' }
        }
      };

      const result = executeModuleRequest(request, queteletFormula, paramMap, varMap);

      expect(result.module_id).toBe('FORMULA_DEMO_QUETELET');
      expect(result.module_version).toBe('1.0.0');
      expect(result.outputs.anthropometric_ratio.value).toBeCloseTo(22.8571, 3);
      expect(result.errors).toHaveLength(0);
      expect(result.provenance_id).toHaveLength(64);
    });
  });

  // ---------------------------------------------------------------------------
  // TEST 23 — C2 Compatibility
  // ---------------------------------------------------------------------------
  describe('Test 23 — C2 Compatibility', () => {
    it('should resolve module and parameters through C2 pipeline and validate inputs through C3 validator', () => {
      const request: ModuleRequest = {
        module_id: 'FORMULA_BMR_MIFFLIN',
        requested_version: '1.2.0',
        inputs: {
          VAR_DEMO_WEIGHT: { value: 70000, unit: 'g' }, // 70 kg
          VAR_DEMO_HEIGHT: { value: 175, unit: 'cm' }, // 1.75 m
          VAR_DEMO_AGE: { value: 30, unit: 'yr' }
        }
      };

      const result = executeModuleRequest(request, undefined, undefined, varMap, {
        available_modules: DEMO_FORMULAS,
        available_parameters: DEMO_PARAMETERS
      });

      expect(result.module_id).toBe('FORMULA_BMR_MIFFLIN');
      expect(result.module_version).toBe('1.2.0');
      expect(result.outputs.bmr_kcal.value).toBe(1648.75);
      expect(result.parameter_versions?.PARAM_BMR_SEX_OFFSET).toBe('1.0.0');
      expect(result.parameter_snapshot).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // TEST 24 — Existing Calculation Regression
  // ---------------------------------------------------------------------------
  describe('Test 24 — Existing Calculation Regression', () => {
    it('should guarantee exact mathematical invariance with historical calculation trace', () => {
      const trace = CalculationEngine.executeFormula({
        formula: queteletFormula,
        inputs: {
          VAR_DEMO_WEIGHT: { value: 70, unit: 'kg' },
          VAR_DEMO_HEIGHT: { value: 1.75, unit: 'm' }
        },
        parameters: paramMap,
        variables: varMap
      });

      // Anthropometric ratio for 70 kg, 1.75 m: 70 / (1.75 ^ 2) = 22.857143 (rounded to 6 decimals)
      expect(trace.final_result.anthropometric_ratio.value).toBe(22.857143);
      expect(trace.normalized_inputs.VAR_DEMO_HEIGHT.value).toBe(1.75);
      expect(trace.normalized_inputs.VAR_DEMO_WEIGHT.value).toBe(70);
      expect(trace.steps.some(s => s.action === 'INPUT_VALIDATION')).toBe(true);
    });
  });
});
