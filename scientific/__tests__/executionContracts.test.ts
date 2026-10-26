import { describe, it, expect } from 'vitest';
import { 
  executeModuleRequest, 
  adaptTraceStepToStandard, 
  adaptCalculationTraceToExecutionResult,
  CalculationEngine
} from '../index';
import { 
  DEMO_FORMULAS, 
  DEMO_PARAMETERS, 
  DEMO_VARIABLES 
} from '../registry/demoModules';
import { 
  ModuleRequest, 
  ExecutionResult, 
  TraceStep, 
  ScientificVariable, 
  ScientificParameter 
} from '../types';

describe('Phase C1: Scientific Execution Contracts Foundation', () => {
  const varMap: Record<string, ScientificVariable> = {};
  DEMO_VARIABLES.forEach(v => { varMap[v.variable_id] = v; });

  const paramMap: Record<string, ScientificParameter> = {};
  DEMO_PARAMETERS.forEach(p => { paramMap[p.parameter_id] = p; });

  const queteletFormula = DEMO_FORMULAS.find(f => f.formula_id === 'FORMULA_DEMO_QUETELET')!;
  const mifflinFormula = DEMO_FORMULAS.find(f => f.formula_id === 'FORMULA_BMR_MIFFLIN')!;

  describe('Test 1 — ModuleRequest Contract', () => {
    it('should construct a valid minimal ModuleRequest with required fields', () => {
      const minimalRequest: ModuleRequest = {
        module_id: 'FORMULA_DEMO_QUETELET',
        inputs: {
          VAR_DEMO_WEIGHT: { value: 70, unit: 'kg' },
          VAR_DEMO_HEIGHT: { value: 1.75, unit: 'm' }
        }
      };

      expect(minimalRequest.module_id).toBe('FORMULA_DEMO_QUETELET');
      expect(minimalRequest.inputs.VAR_DEMO_WEIGHT.value).toBe(70);
      expect(minimalRequest.requested_version).toBeUndefined();
      expect(minimalRequest.parameter_set_id).toBeUndefined();
      expect(minimalRequest.dataset_version_id).toBeUndefined();
    });

    it('should construct a fully-specified ModuleRequest with all optional metadata', () => {
      const fullRequest: ModuleRequest = {
        module_id: 'FORMULA_BMR_MIFFLIN',
        requested_version: '1.2.0',
        inputs: {
          VAR_DEMO_WEIGHT: { value: 72, unit: 'kg' },
          VAR_DEMO_HEIGHT: { value: 178, unit: 'cm' },
          VAR_DEMO_AGE: { value: 29, unit: 'yr' }
        },
        parameter_set_id: 'PARAM_SET_ADULT_MALE_DEFAULT',
        dataset_version_id: 'DSET_VER_2026_09_A',
        configuration: {
          numerical_tolerance: 1e-6,
          debug_trace: true
        },
        execution_context: {
          user_id: 'USR_TEST_001',
          project_id: 'PRJ_RESEARCH_ALPHA',
          environment: 'unit-test',
          client_timestamp: '2026-09-23T12:00:00Z'
        }
      };

      expect(fullRequest.module_id).toBe('FORMULA_BMR_MIFFLIN');
      expect(fullRequest.requested_version).toBe('1.2.0');
      expect(fullRequest.parameter_set_id).toBe('PARAM_SET_ADULT_MALE_DEFAULT');
      expect(fullRequest.dataset_version_id).toBe('DSET_VER_2026_09_A');
      expect(fullRequest.configuration?.numerical_tolerance).toBe(1e-6);
      expect(fullRequest.execution_context?.project_id).toBe('PRJ_RESEARCH_ALPHA');
    });

    it('should throw an error if executeModuleRequest receives mismatched module_id', () => {
      const mismatchedRequest: ModuleRequest = {
        module_id: 'FORMULA_UNKNOWN_XYZ',
        inputs: {
          VAR_DEMO_WEIGHT: { value: 70, unit: 'kg' }
        }
      };

      expect(() => {
        executeModuleRequest(mismatchedRequest, queteletFormula, paramMap, varMap);
      }).toThrow(/Module Mismatch/);
    });
  });

  describe('Test 2 — ExecutionResult Contract', () => {
    it('should produce a complete standardized ExecutionResult structure', () => {
      const request: ModuleRequest = {
        module_id: 'FORMULA_DEMO_QUETELET',
        inputs: {
          VAR_DEMO_WEIGHT: { value: 68, unit: 'kg' },
          VAR_DEMO_HEIGHT: { value: 1.70, unit: 'm' }
        }
      };

      const result: ExecutionResult = executeModuleRequest(request, queteletFormula, paramMap, varMap);

      // Verify all required Phase C result fields exist
      expect(result.execution_id).toMatch(/^CALC_/);
      expect(result.module_id).toBe('FORMULA_DEMO_QUETELET');
      expect(result.module_version).toBe('1.0.0');
      expect(result.inputs).toBeDefined();
      expect(result.normalized_inputs).toBeDefined();
      expect(result.parameters).toBeDefined();
      expect(Array.isArray(result.execution_path)).toBe(true);
      expect(result.execution_path.length).toBeGreaterThan(0);
      expect(result.fallback_used).toBe(false);
      expect(typeof result.intermediate_results).toBe('object');
      expect(Array.isArray(result.trace)).toBe(true);
      expect(result.trace.length).toBeGreaterThan(0);
      expect(result.outputs).toBeDefined();
      expect(Array.isArray(result.warnings)).toBe(true);
      expect(Array.isArray(result.errors)).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.timestamp).toBeDefined();
      expect(result.provenance_id).toHaveLength(64); // SHA-256 hash
    });

    it('should distinguish warnings from fatal errors in ExecutionResult', () => {
      // VAR_DEMO_WEIGHT warning_max is 250 kg. Input 260 kg should trigger a warning, not fatal error.
      const request: ModuleRequest = {
        module_id: 'FORMULA_DEMO_QUETELET',
        inputs: {
          VAR_DEMO_WEIGHT: { value: 260, unit: 'kg' },
          VAR_DEMO_HEIGHT: { value: 1.80, unit: 'm' }
        }
      };

      const result: ExecutionResult = executeModuleRequest(request, queteletFormula, paramMap, varMap);

      expect(result.errors).toHaveLength(0);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('unusually high');
      expect(result.outputs.anthropometric_ratio.value).toBeDefined();
    });

    it('should truthfully report UNVALIDATED status when runtime ValidationEngine is inactive', () => {
      const request: ModuleRequest = {
        module_id: 'FORMULA_DEMO_QUETELET',
        inputs: {
          VAR_DEMO_WEIGHT: { value: 70, unit: 'kg' },
          VAR_DEMO_HEIGHT: { value: 1.75, unit: 'm' }
        }
      };

      const result = executeModuleRequest(request, queteletFormula, paramMap, varMap);

      expect(result.validation).toBeDefined();
      expect(result.validation?.status).toBe('UNVALIDATED');
      expect(result.validation?.message).toContain('Phase C1');
    });
  });

  describe('Test 3 — Trace Adapter Contract', () => {
    it('should adapt an internal TraceStep to a standardized StandardTraceStep', () => {
      const legacyStep: TraceStep = {
        step: 3,
        action: 'INPUT_NORMALIZATION',
        detail: 'Converted 175 cm * 0.01 = 1.75 m',
        intermediate_value: 1.75,
        unit: 'm',
        timestamp: '2026-09-23T12:00:00.000Z'
      };

      const standardStep = adaptTraceStepToStandard(legacyStep);

      expect(standardStep.step_id).toBe('STEP_3_input_normalization');
      expect(standardStep.operation).toBe('INPUT_NORMALIZATION');
      expect(standardStep.output).toBe(1.75);
      expect(standardStep.unit).toBe('m');
      expect(standardStep.timestamp).toBe('2026-09-23T12:00:00.000Z');
      expect(standardStep.metadata?.detail).toBe('Converted 175 cm * 0.01 = 1.75 m');
      expect(standardStep.metadata?.step_number).toBe(3);
    });

    it('should adapt legacy CalculationTrace without data loss into ExecutionResult', () => {
      const legacyTrace = CalculationEngine.executeFormula({
        formula: queteletFormula,
        inputs: {
          VAR_DEMO_WEIGHT: { value: 75, unit: 'kg' },
          VAR_DEMO_HEIGHT: { value: 1.80, unit: 'm' }
        },
        parameters: paramMap,
        variables: varMap
      });

      const adaptedResult = adaptCalculationTraceToExecutionResult(legacyTrace);

      expect(adaptedResult.execution_id).toBe(legacyTrace.calculation_id);
      expect(adaptedResult.module_id).toBe(legacyTrace.formula_or_model_id);
      expect(adaptedResult.module_version).toBe(legacyTrace.version);
      expect(adaptedResult.outputs.anthropometric_ratio.value).toBe(legacyTrace.final_result.anthropometric_ratio.value);
      expect(adaptedResult.provenance_id).toBe(legacyTrace.provenance_hash);
      expect(adaptedResult.trace.length).toBe(legacyTrace.steps.length);
    });
  });

  describe('Test 4 — Regression & Numerical Invariance', () => {
    it('should produce identical numerical result and provenance hash for Quetelet formula', () => {
      const inputs = {
        VAR_DEMO_WEIGHT: { value: 72, unit: 'kg' },
        VAR_DEMO_HEIGHT: { value: 1.75, unit: 'm' }
      };

      const legacyTrace = CalculationEngine.executeFormula({
        formula: queteletFormula,
        inputs,
        parameters: paramMap,
        variables: varMap
      });

      const request: ModuleRequest = {
        module_id: 'FORMULA_DEMO_QUETELET',
        inputs
      };

      const newResult = executeModuleRequest(request, queteletFormula, paramMap, varMap);

      // Exact numerical invariance
      expect(newResult.outputs.anthropometric_ratio.value).toBe(legacyTrace.final_result.anthropometric_ratio.value);
      expect(newResult.outputs.anthropometric_ratio.unit).toBe(legacyTrace.final_result.anthropometric_ratio.unit);
      
      // Exact normalized input invariance
      expect(newResult.normalized_inputs.VAR_DEMO_HEIGHT.value).toBe(legacyTrace.normalized_inputs.VAR_DEMO_HEIGHT.value);
      expect(newResult.normalized_inputs.VAR_DEMO_WEIGHT.value).toBe(legacyTrace.normalized_inputs.VAR_DEMO_WEIGHT.value);

      // Provenance hash validity
      expect(newResult.provenance_id).toHaveLength(64);
      expect(adaptCalculationTraceToExecutionResult(legacyTrace).provenance_id).toBe(legacyTrace.provenance_hash);
    });

    it('should produce identical numerical result for Mifflin-St Jeor formula with unit conversions', () => {
      const inputs = {
        VAR_DEMO_WEIGHT: { value: 70, unit: 'kg' },
        VAR_DEMO_HEIGHT: { value: 175, unit: 'cm' }, // requires unit normalization cm -> m
        VAR_DEMO_AGE: { value: 30, unit: 'yr' }
      };

      const legacyTrace = CalculationEngine.executeFormula({
        formula: mifflinFormula,
        inputs,
        parameters: paramMap,
        variables: varMap
      });

      const request: ModuleRequest = {
        module_id: 'FORMULA_BMR_MIFFLIN',
        inputs
      };

      const newResult = executeModuleRequest(request, mifflinFormula, paramMap, varMap);

      expect(newResult.outputs.bmr_kcal.value).toBe(legacyTrace.final_result.bmr_kcal.value);
      expect(newResult.outputs.bmr_kcal.unit).toBe('kcal/day');
      expect(newResult.normalized_inputs.VAR_DEMO_HEIGHT.value).toBe(1.75);
      expect(newResult.normalized_inputs.VAR_DEMO_HEIGHT.unit).toBe('m');
      expect(newResult.provenance_id).toHaveLength(64);
      expect(adaptCalculationTraceToExecutionResult(legacyTrace).provenance_id).toBe(legacyTrace.provenance_hash);
    });
  });
});
