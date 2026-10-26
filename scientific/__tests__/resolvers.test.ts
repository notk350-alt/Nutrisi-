/**
 * NutriBodySim — Phase C2 Test Suite: Module Resolver & Parameter Resolver
 * 
 * Verifies deterministic module resolution, exact semantic version pinning,
 * lifecycle compliance, parameter set resolution, immutable parameter snapshots,
 * explicit error codes, and regression invariance against C1 execution contracts.
 */

import { describe, it, expect } from 'vitest';
import {
  ModuleResolver,
  ParameterResolver,
  ScientificResolverError,
  executeModuleRequest,
  ModuleRequest,
  ExecutionResult,
  ScientificFormula,
  ScientificParameter,
  ScientificVariable,
  ParameterSet,
  DEMO_FORMULAS,
  DEMO_PARAMETERS,
  DEMO_VARIABLES
} from '../index';

describe('Phase C2: Module Resolver & Parameter Resolver Foundation', () => {
  // Common fixtures
  const paramMap: Record<string, ScientificParameter> = {};
  DEMO_PARAMETERS.forEach(p => { paramMap[p.parameter_id] = { ...p }; });

  const varMap: Record<string, ScientificVariable> = {};
  DEMO_VARIABLES.forEach(v => { varMap[v.variable_id] = { ...v }; });

  // ---------------------------------------------------------------------------
  // TEST 1 — Exact Module Version Resolution
  // ---------------------------------------------------------------------------
  describe('Test 1 — Exact Module Version Resolution', () => {
    it('should resolve the exact requested semantic version of a module', () => {
      const resolved = ModuleResolver.resolve({
        module_id: 'FORMULA_BMR_MIFFLIN',
        requested_version: '1.2.0',
        modules: DEMO_FORMULAS
      });

      expect(resolved.module_id).toBe('FORMULA_BMR_MIFFLIN');
      expect(resolved.module_version).toBe('1.2.0');
      expect(resolved.module.formula_id).toBe('FORMULA_BMR_MIFFLIN');
      expect(resolved.module.version).toBe('1.2.0');
      expect(resolved.status).toBe('VERIFIED');
      expect(resolved.resolution_reason).toContain('Exact requested version');
      expect(resolved.is_historical_explicit).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // TEST 2 — Missing Module
  // ---------------------------------------------------------------------------
  describe('Test 2 — Missing Module', () => {
    it('should throw explicit MODULE_NOT_FOUND error if module_id does not exist', () => {
      try {
        ModuleResolver.resolve({
          module_id: 'FORMULA_NON_EXISTENT_999',
          modules: DEMO_FORMULAS
        });
        expect.unreachable('Should have thrown MODULE_NOT_FOUND');
      } catch (err: any) {
        expect(err).toBeInstanceOf(ScientificResolverError);
        expect(err.code).toBe('MODULE_NOT_FOUND');
        expect(err.message).toContain('FORMULA_NON_EXISTENT_999');
      }
    });
  });

  // ---------------------------------------------------------------------------
  // TEST 3 — Missing Requested Version
  // ---------------------------------------------------------------------------
  describe('Test 3 — Missing Requested Version', () => {
    it('should throw explicit MODULE_VERSION_NOT_FOUND without silent fallback when requested version is absent', () => {
      try {
        ModuleResolver.resolve({
          module_id: 'FORMULA_BMR_MIFFLIN',
          requested_version: '99.0.0-fictional',
          modules: DEMO_FORMULAS
        });
        expect.unreachable('Should have thrown MODULE_VERSION_NOT_FOUND');
      } catch (err: any) {
        expect(err).toBeInstanceOf(ScientificResolverError);
        expect(err.code).toBe('MODULE_VERSION_NOT_FOUND');
        expect(err.message).toContain('99.0.0-fictional');
        expect(err.details?.available_versions).toBeDefined();
      }
    });
  });

  // ---------------------------------------------------------------------------
  // TEST 4 — Lifecycle Restriction (DRAFT Prohibited in Normal Execution)
  // ---------------------------------------------------------------------------
  describe('Test 4 — Lifecycle Restriction', () => {
    const baseFormula = DEMO_FORMULAS.find(f => f.formula_id === 'FORMULA_BMI_QUETELET')!;

    const draftModule: ScientificFormula = {
      ...baseFormula,
      formula_id: 'FORMULA_TEST_DRAFT',
      version: '0.9.0-draft',
      status: 'DRAFT'
    };

    it('should throw MODULE_VERSION_NOT_EXECUTABLE if resolved module is DRAFT in normal execution', () => {
      try {
        ModuleResolver.resolve({
          module_id: 'FORMULA_TEST_DRAFT',
          requested_version: '0.9.0-draft',
          modules: [draftModule]
        });
        expect.unreachable('Should have thrown MODULE_VERSION_NOT_EXECUTABLE');
      } catch (err: any) {
        expect(err).toBeInstanceOf(ScientificResolverError);
        expect(err.code).toBe('MODULE_VERSION_NOT_EXECUTABLE');
        expect(err.message).toContain('DRAFT');
      }
    });

    it('should permit DRAFT execution when execution_context.allow_draft is explicitly true', () => {
      const resolved = ModuleResolver.resolve({
        module_id: 'FORMULA_TEST_DRAFT',
        requested_version: '0.9.0-draft',
        execution_context: { allow_draft: true },
        modules: [draftModule]
      });
      expect(resolved.status).toBe('DRAFT');
      expect(resolved.module_version).toBe('0.9.0-draft');
    });
  });

  // ---------------------------------------------------------------------------
  // TEST 5 — Deterministic Default Version Resolution
  // ---------------------------------------------------------------------------
  describe('Test 5 — Deterministic Default Version Resolution', () => {
    const base = DEMO_FORMULAS.find(f => f.formula_id === 'FORMULA_BMI_QUETELET')!;

    const multiVersionPool: ScientificFormula[] = [
      { ...base, formula_id: 'FORMULA_MULTI_VER', version: '1.0.0', status: 'EXPERIMENTAL' },
      { ...base, formula_id: 'FORMULA_MULTI_VER', version: '1.1.0', status: 'VALIDATED' },
      { ...base, formula_id: 'FORMULA_MULTI_VER', version: '1.2.0', status: 'VERIFIED' },
      { ...base, formula_id: 'FORMULA_MULTI_VER', version: '1.3.0', status: 'EXPERIMENTAL' },
      { ...base, formula_id: 'FORMULA_MULTI_VER', version: '2.0.0', status: 'DRAFT' } // Must never be chosen unversioned
    ];

    it('should deterministically resolve highest lifecycle tier (VERIFIED) over higher unverified semvers', () => {
      const resolved = ModuleResolver.resolve({
        module_id: 'FORMULA_MULTI_VER',
        modules: multiVersionPool
      });

      expect(resolved.module_version).toBe('1.2.0');
      expect(resolved.status).toBe('VERIFIED');
    });

    it('should produce identical resolution regardless of array ordering', () => {
      const reversedPool = [...multiVersionPool].reverse();
      const resolved = ModuleResolver.resolve({
        module_id: 'FORMULA_MULTI_VER',
        modules: reversedPool
      });

      expect(resolved.module_version).toBe('1.2.0');
      expect(resolved.status).toBe('VERIFIED');
    });

    it('should select highest semver when multiple versions exist within the same highest lifecycle tier', () => {
      const poolWithTwoVerified: ScientificFormula[] = [
        { ...base, formula_id: 'FORMULA_MULTI_VER', version: '1.2.0', status: 'VERIFIED' },
        { ...base, formula_id: 'FORMULA_MULTI_VER', version: '1.2.1', status: 'VERIFIED' }
      ];

      const resolved = ModuleResolver.resolve({
        module_id: 'FORMULA_MULTI_VER',
        modules: poolWithTwoVerified
      });

      expect(resolved.module_version).toBe('1.2.1');
    });
  });

  // ---------------------------------------------------------------------------
  // TEST 6 — Deprecated / Historical Explicit Resolution Behavior
  // ---------------------------------------------------------------------------
  describe('Test 6 — Deprecated / Historical Explicit Resolution', () => {
    const base = DEMO_FORMULAS.find(f => f.formula_id === 'FORMULA_BMI_QUETELET')!;

    const deprecatedPool: ScientificFormula[] = [
      { ...base, formula_id: 'FORMULA_DEP_HIST', version: '1.0.0', status: 'DEPRECATED' },
      { ...base, formula_id: 'FORMULA_DEP_HIST', version: '2.0.0', status: 'VERIFIED' }
    ];

    it('should never select a DEPRECATED version for default unversioned execution', () => {
      const resolved = ModuleResolver.resolve({
        module_id: 'FORMULA_DEP_HIST',
        modules: deprecatedPool
      });
      expect(resolved.module_version).toBe('2.0.0');
      expect(resolved.status).toBe('VERIFIED');
      expect(resolved.is_historical_explicit).toBe(false);
    });

    it('should allow explicit historical resolution of DEPRECATED version when requested explicitly', () => {
      const resolved = ModuleResolver.resolve({
        module_id: 'FORMULA_DEP_HIST',
        requested_version: '1.0.0',
        modules: deprecatedPool
      });

      expect(resolved.module_version).toBe('1.0.0');
      expect(resolved.status).toBe('DEPRECATED');
      expect(resolved.is_historical_explicit).toBe(true);
      expect(resolved.resolution_reason).toContain('Explicit historical version requested');
    });

    it('should throw MODULE_VERSION_NOT_EXECUTABLE if all versions of a module are DEPRECATED and no version requested', () => {
      const onlyDeprecatedPool: ScientificFormula[] = [
        { ...base, formula_id: 'FORMULA_ALL_DEP', version: '1.0.0', status: 'DEPRECATED' }
      ];

      expect(() => {
        ModuleResolver.resolve({
          module_id: 'FORMULA_ALL_DEP',
          modules: onlyDeprecatedPool
        });
      }).toThrowError(/MODULE_VERSION_NOT_EXECUTABLE/);
    });
  });

  // ---------------------------------------------------------------------------
  // TEST 7 — Parameter Set Resolution
  // ---------------------------------------------------------------------------
  describe('Test 7 — Parameter Set Resolution', () => {
    const formula = DEMO_FORMULAS.find(f => f.formula_id === 'FORMULA_BMI_QUETELET')!;

    const customParamSet: ParameterSet = {
      set_id: 'PARAM_SET_RESEARCH_PEDIATRIC',
      name: 'Pediatric Research Exponent Set',
      description: 'Experimental power factor exponent parameter bundle',
      version: '1.0.0',
      status: 'EXPERIMENTAL',
      module_id: 'FORMULA_BMI_QUETELET',
      parameters: {
        PARAM_DEMO_HEIGHT_EXPONENT: {
          parameter_id: 'PARAM_DEMO_HEIGHT_EXPONENT',
          parameter_version: '1.0.0',
          value_override: 2.1
        }
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    it('should resolve parameters using the specified ParameterSet and apply value overrides', () => {
      const resolved = ParameterResolver.resolve({
        module: formula,
        parameter_set_id: 'PARAM_SET_RESEARCH_PEDIATRIC',
        available_parameters: DEMO_PARAMETERS,
        available_parameter_sets: [customParamSet]
      });

      expect(resolved.parameter_set_id).toBe('PARAM_SET_RESEARCH_PEDIATRIC');
      expect(resolved.parameters.PARAM_DEMO_HEIGHT_EXPONENT).toBe(2.1);
      expect(resolved.snapshot.entries.PARAM_DEMO_HEIGHT_EXPONENT.value).toBe(2.1);
      expect(resolved.parameter_versions.PARAM_DEMO_HEIGHT_EXPONENT).toBe('1.0.0');
    });
  });

  // ---------------------------------------------------------------------------
  // TEST 8 — Parameter Version Tracking
  // ---------------------------------------------------------------------------
  describe('Test 8 — Parameter Version Tracking', () => {
    const formula = DEMO_FORMULAS.find(f => f.formula_id === 'FORMULA_BMR_MIFFLIN')!;

    it('should accurately track individual parameter versions in resolved metadata', () => {
      const resolved = ParameterResolver.resolve({
        module: formula,
        available_parameters: DEMO_PARAMETERS
      });

      expect(resolved.parameter_versions).toBeDefined();
      expect(resolved.parameter_versions.PARAM_BMR_SEX_OFFSET).toBe('1.0.0');
      expect(resolved.snapshot.entries.PARAM_BMR_SEX_OFFSET.parameter_version).toBe('1.0.0');
      expect(resolved.snapshot.entries.PARAM_BMR_SEX_OFFSET.name).toContain('Offset');
    });
  });

  // ---------------------------------------------------------------------------
  // TEST 9 — Immutable Parameter Snapshot Behavior
  // ---------------------------------------------------------------------------
  describe('Test 9 — Immutable Parameter Snapshot Behavior', () => {
    const formula = DEMO_FORMULAS.find(f => f.formula_id === 'FORMULA_BMI_QUETELET')!;

    it('should ensure parameter snapshot remains strictly immutable even if database/pool is mutated afterwards', () => {
      // Create mutable pool
      const mutablePool: ScientificParameter[] = [
        {
          parameter_id: 'PARAM_DEMO_HEIGHT_EXPONENT',
          name: 'Height Power Exponent',
          description: 'Power factor for height in BMI formula',
          value: 2.0,
          unit: '',
          version: '1.0.0',
          status: 'VERIFIED',
          is_constant: true,
          reference_ids: ['REF_QUETELET_1832'],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }
      ];

      // Resolve E1
      const resolvedE1 = ParameterResolver.resolve({
        module: formula,
        available_parameters: mutablePool
      });

      const snapshotE1 = resolvedE1.snapshot;
      expect(snapshotE1.entries.PARAM_DEMO_HEIGHT_EXPONENT.value).toBe(2.0);

      // Now mutate the underlying database/pool object (simulating later update)
      mutablePool[0].value = 99.0;
      mutablePool[0].version = '2.0.0';

      // Historical E1 MUST NOT CHANGE
      expect(snapshotE1.entries.PARAM_DEMO_HEIGHT_EXPONENT.value).toBe(2.0);
      expect(snapshotE1.entries.PARAM_DEMO_HEIGHT_EXPONENT.parameter_version).toBe('1.0.0');

      // Attempting to mutate snapshot entry should fail or be protected
      expect(Object.isFrozen(snapshotE1)).toBe(true);
      expect(Object.isFrozen(snapshotE1.entries)).toBe(true);
      expect(Object.isFrozen(snapshotE1.entries.PARAM_DEMO_HEIGHT_EXPONENT)).toBe(true);

      // A new execution resolves the updated version
      const resolvedE2 = ParameterResolver.resolve({
        module: formula,
        available_parameters: mutablePool
      });
      expect(resolvedE2.snapshot.entries.PARAM_DEMO_HEIGHT_EXPONENT.value).toBe(99.0);
      expect(resolvedE2.snapshot.entries.PARAM_DEMO_HEIGHT_EXPONENT.parameter_version).toBe('2.0.0');
    });
  });

  // ---------------------------------------------------------------------------
  // TEST 10 — Missing Parameter Set
  // ---------------------------------------------------------------------------
  describe('Test 10 — Missing Parameter Set', () => {
    const formula = DEMO_FORMULAS.find(f => f.formula_id === 'FORMULA_BMI_QUETELET')!;

    it('should throw explicit PARAMETER_SET_NOT_FOUND when parameter_set_id is not in registry', () => {
      try {
        ParameterResolver.resolve({
          module: formula,
          parameter_set_id: 'NON_EXISTENT_SET_XYZ',
          available_parameters: DEMO_PARAMETERS,
          available_parameter_sets: []
        });
        expect.unreachable('Should have thrown PARAMETER_SET_NOT_FOUND');
      } catch (err: any) {
        expect(err).toBeInstanceOf(ScientificResolverError);
        expect(err.code).toBe('PARAMETER_SET_NOT_FOUND');
        expect(err.message).toContain('NON_EXISTENT_SET_XYZ');
      }
    });
  });

  // ---------------------------------------------------------------------------
  // TEST 11 — Ambiguous Parameter Resolution
  // ---------------------------------------------------------------------------
  describe('Test 11 — Ambiguous Parameter Resolution', () => {
    const formula = DEMO_FORMULAS.find(f => f.formula_id === 'FORMULA_BMI_QUETELET')!;

    it('should throw PARAMETER_RESOLUTION_AMBIGUOUS if multiple identical versions exist in highest tier', () => {
      const ambiguousPool: ScientificParameter[] = [
        {
          parameter_id: 'PARAM_DEMO_HEIGHT_EXPONENT',
          name: 'Exponent A',
          description: 'Def A',
          value: 2.0,
          unit: '',
          version: '1.0.0',
          status: 'VERIFIED',
          is_constant: true,
          reference_ids: [],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        },
        {
          parameter_id: 'PARAM_DEMO_HEIGHT_EXPONENT',
          name: 'Exponent B',
          description: 'Def B',
          value: 2.05,
          unit: '',
          version: '1.0.0', // Identical status and identical version
          status: 'VERIFIED',
          is_constant: true,
          reference_ids: [],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }
      ];

      try {
        ParameterResolver.resolve({
          module: formula,
          available_parameters: ambiguousPool
        });
        expect.unreachable('Should have thrown PARAMETER_RESOLUTION_AMBIGUOUS');
      } catch (err: any) {
        expect(err).toBeInstanceOf(ScientificResolverError);
        expect(err.code).toBe('PARAMETER_RESOLUTION_AMBIGUOUS');
        expect(err.message).toContain('PARAM_DEMO_HEIGHT_EXPONENT');
      }
    });
  });

  // ---------------------------------------------------------------------------
  // TEST 12 — C1 Backward Compatibility & End-to-End Pipeline
  // ---------------------------------------------------------------------------
  describe('Test 12 — C1 Backward Compatibility & End-to-End Pipeline', () => {
    const queteletFormula = DEMO_FORMULAS.find(f => f.formula_id === 'FORMULA_DEMO_QUETELET')!;
    const mifflinFormula = DEMO_FORMULAS.find(f => f.formula_id === 'FORMULA_BMR_MIFFLIN')!;

    it('should maintain 100% backward compatibility when direct formula and parameters are passed (C1 signature)', () => {
      const request: ModuleRequest = {
        module_id: 'FORMULA_DEMO_QUETELET',
        inputs: {
          VAR_DEMO_WEIGHT: { value: 70, unit: 'kg' },
          VAR_DEMO_HEIGHT: { value: 1.75, unit: 'm' }
        }
      };

      const result: ExecutionResult = executeModuleRequest(request, queteletFormula, paramMap, varMap);

      expect(result.module_id).toBe('FORMULA_DEMO_QUETELET');
      expect(result.module_version).toBe('1.0.0');
      expect(result.outputs.anthropometric_ratio.value).toBeCloseTo(22.8571, 3);
      expect(result.outputs.anthropometric_ratio.unit).toBe('kg/m^2');
      expect(result.warnings).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
      expect(result.validation?.status).toBe('UNVALIDATED');
    });

    it('should seamlessly execute via the complete resolver pipeline (ModuleRequest -> ModuleResolver -> ParameterResolver -> Result)', () => {
      const request: ModuleRequest = {
        module_id: 'FORMULA_BMR_MIFFLIN',
        requested_version: '1.2.0',
        inputs: {
          VAR_DEMO_WEIGHT: { value: 70, unit: 'kg' },
          VAR_DEMO_HEIGHT: { value: 175, unit: 'cm' },
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
      expect(result.outputs.bmr_kcal.unit).toBe('kcal/day');
      expect(result.parameter_versions?.PARAM_BMR_SEX_OFFSET).toBe('1.0.0');
      expect(result.parameter_snapshot).toBeDefined();
      expect(result.parameter_snapshot?.entries.PARAM_BMR_SEX_OFFSET.value).toBe(5);
      expect(result.provenance_id).toHaveLength(64);
    });
  });
});
