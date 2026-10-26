import { describe, it, expect } from 'vitest';
import { CalculationEngine } from '../engine/calculationEngine';
import { 
  DEMO_FORMULAS, 
  DEMO_PARAMETERS, 
  DEMO_VARIABLES 
} from '../registry/demoModules';
import { ScientificVariable, ScientificParameter } from '../types';

describe('Scientific Calculation Engine (calculationEngine)', () => {
  const varMap: Record<string, ScientificVariable> = {};
  DEMO_VARIABLES.forEach(v => { varMap[v.variable_id] = v; });

  const paramMap: Record<string, ScientificParameter> = {};
  DEMO_PARAMETERS.forEach(p => { paramMap[p.parameter_id] = p; });

  describe('Quetelet Ratio / BMI AST evaluation', () => {
    const queteletFormula = DEMO_FORMULAS.find(f => f.formula_id === 'FORMULA_DEMO_QUETELET')!;

    it('should calculate BMI accurately for normal adult metrics', () => {
      const trace = CalculationEngine.executeFormula({
        formula: queteletFormula,
        inputs: {
          VAR_DEMO_WEIGHT: { value: 70, unit: 'kg' },
          VAR_DEMO_HEIGHT: { value: 1.75, unit: 'm' }
        },
        parameters: paramMap,
        variables: varMap
      });

      const bmiResult = Number(trace.final_result.anthropometric_ratio.value);
      // 70 / (1.75 ^ 2) = 22.857142857
      expect(bmiResult).toBeCloseTo(22.8571, 3);
      expect(trace.final_result.anthropometric_ratio.unit).toBe('kg/m^2');
      expect(trace.provenance_hash).toHaveLength(64);
    });

    it('should automatically convert centimeter inputs to meters before AST evaluation', () => {
      const trace = CalculationEngine.executeFormula({
        formula: queteletFormula,
        inputs: {
          VAR_DEMO_WEIGHT: { value: 70, unit: 'kg' },
          VAR_DEMO_HEIGHT: { value: 175, unit: 'cm' }
        },
        parameters: paramMap,
        variables: varMap
      });

      const bmiResult = Number(trace.final_result.anthropometric_ratio.value);
      expect(bmiResult).toBeCloseTo(22.8571, 3);
    });
  });

  describe('Mifflin-St Jeor BMR AST Evaluation (Phase A decoupled parameter architecture)', () => {
    const mifflinFormula = DEMO_FORMULAS.find(f => f.formula_id === 'FORMULA_BMR_MIFFLIN')!;

    it('should compute Male BMR using the default PARAM_BMR_SEX_OFFSET (+5 kcal/day)', () => {
      const trace = CalculationEngine.executeFormula({
        formula: mifflinFormula,
        inputs: {
          VAR_DEMO_WEIGHT: { value: 70, unit: 'kg' },
          VAR_DEMO_HEIGHT: { value: 1.75, unit: 'm' },
          VAR_DEMO_AGE: { value: 28, unit: 'yr' }
        },
        parameters: paramMap,
        variables: varMap
      });

      // (10 * 70) + (625 * 1.75) - (5 * 28) + 5 = 700 + 1093.75 - 140 + 5 = 1658.75
      const bmrVal = Number(trace.final_result.bmr_kcal.value);
      expect(bmrVal).toBeCloseTo(1658.75, 4);
      expect(trace.final_result.bmr_kcal.unit).toBe('kcal/day');

      // Check parameter resolution trace
      const paramStep = trace.steps.find(s => s.action === 'PARAMETER_RESOLVED');
      expect(paramStep).toBeDefined();
      expect(paramStep?.detail).toContain('PARAM_BMR_SEX_OFFSET');
    });

    it('should compute Female BMR when PARAM_BMR_SEX_OFFSET is dynamically overridden to -161 kcal/day', () => {
      const femaleParams = {
        ...paramMap,
        PARAM_BMR_SEX_OFFSET: {
          ...paramMap.PARAM_BMR_SEX_OFFSET,
          value: -161
        }
      };

      const trace = CalculationEngine.executeFormula({
        formula: mifflinFormula,
        inputs: {
          VAR_DEMO_WEIGHT: { value: 70, unit: 'kg' },
          VAR_DEMO_HEIGHT: { value: 1.75, unit: 'm' },
          VAR_DEMO_AGE: { value: 28, unit: 'yr' }
        },
        parameters: femaleParams,
        variables: varMap
      });

      // (10 * 70) + (625 * 1.75) - (5 * 28) - 161 = 700 + 1093.75 - 140 - 161 = 1492.75
      const bmrVal = Number(trace.final_result.bmr_kcal.value);
      expect(bmrVal).toBeCloseTo(1492.75, 4);
    });
  });

  describe('Mean Arterial Pressure (MAP) AST Evaluation', () => {
    const mapFormula = DEMO_FORMULAS.find(f => f.formula_id === 'FORMULA_MAP_HEMODYNAMICS')!;

    it('should calculate MAP correctly from normal SBP and DBP (120/80 mmHg)', () => {
      const trace = CalculationEngine.executeFormula({
        formula: mapFormula,
        inputs: {
          VAR_DEMO_SBP: { value: 120, unit: 'mmHg' },
          VAR_DEMO_DBP: { value: 80, unit: 'mmHg' }
        },
        parameters: paramMap,
        variables: varMap
      });

      // 80 + ((120 - 80) / 3) = 80 + 13.3333 = 93.3333
      const mapVal = Number(trace.final_result.map_pressure.value);
      expect(mapVal).toBeCloseTo(93.3333, 3);
      expect(trace.final_result.map_pressure.unit).toBe('mmHg');
    });
  });

  describe('Error handling & AST boundary validation', () => {
    const queteletFormula = DEMO_FORMULAS.find(f => f.formula_id === 'FORMULA_DEMO_QUETELET')!;

    it('should throw an error if a required input is omitted', () => {
      expect(() => {
        CalculationEngine.executeFormula({
          formula: queteletFormula,
          inputs: {
            VAR_DEMO_WEIGHT: { value: 70, unit: 'kg' }
            // VAR_DEMO_HEIGHT is missing
          },
          parameters: paramMap,
          variables: varMap
        });
      }).toThrowError(/Required variable.*is missing/);
    });

    it('should throw an error if a declared parameter is missing from the environment', () => {
      const mifflinFormula = DEMO_FORMULAS.find(f => f.formula_id === 'FORMULA_BMR_MIFFLIN')!;
      expect(() => {
        CalculationEngine.executeFormula({
          formula: mifflinFormula,
          inputs: {
            VAR_DEMO_WEIGHT: { value: 70, unit: 'kg' },
            VAR_DEMO_HEIGHT: { value: 1.75, unit: 'm' },
            VAR_DEMO_AGE: { value: 28, unit: 'yr' }
          },
          parameters: {}, // empty parameters
          variables: varMap
        });
      }).toThrowError(/Required parameter "PARAM_BMR_SEX_OFFSET" is not registered/);
    });
  });
});
