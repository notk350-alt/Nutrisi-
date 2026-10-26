/**
 * NutriBodySim — Phase C4 Test Suite: Scientific Algorithm Executor
 * 
 * Verifies all 27 mandatory test cases:
 * 1. simple sequence A → B → C
 * 2. sequence failure
 * 3. condition true
 * 4. condition false
 * 5. branch A
 * 6. branch B
 * 7. fallback primary success
 * 8. fallback primary failure
 * 9. fallback_required signal from C3
 * 10. no fallback defined
 * 11. fallback order deterministic
 * 12. intermediate result propagation
 * 13. execution path recording
 * 14. fallback_used flag
 * 15. formula reference
 * 16. formula version resolution
 * 17. parameter snapshot usage
 * 18. trace generation
 * 19. cycle detection
 * 20. missing step
 * 21. invalid branch target
 * 22. invalid condition
 * 23. deterministic repeated execution
 * 24. execution isolation
 * 25. C1 regression
 * 26. C2 regression
 * 27. C3 regression
 */

import { describe, it, expect } from 'vitest';
import {
  AlgorithmExecutor,
  executeModuleRequest,
  CalculationEngine,
  InputValidator,
  ScientificAlgorithm,
  ScientificFormula,
  ScientificVariable,
  ScientificParameter,
  ModuleRequest,
  ParameterSnapshot,
  ScientificAlgorithmError,
  DEMO_FORMULAS,
  DEMO_PARAMETERS,
  DEMO_VARIABLES
} from '../index';

describe('Phase C4: Scientific Algorithm Executor', () => {
  const varMap: Record<string, ScientificVariable> = {};
  DEMO_VARIABLES.forEach(v => { varMap[v.variable_id] = { ...v }; });

  const paramMap: Record<string, ScientificParameter> = {};
  DEMO_PARAMETERS.forEach(p => { paramMap[p.parameter_id] = { ...p }; });

  const queteletFormula = DEMO_FORMULAS.find(f => f.formula_id === 'FORMULA_DEMO_QUETELET')!;

  // ---------------------------------------------------------------------------
  // TEST 1 — Simple Sequence A -> B -> C
  // ---------------------------------------------------------------------------
  describe('Test 1 — Simple Sequence A -> B -> C', () => {
    const seqAlgorithm: ScientificAlgorithm = {
      algorithm_id: 'ALG_SEQ_TEST',
      name: 'Sequential Pipeline',
      description: 'Executes A -> B -> C sequentially',
      version: '1.0.0',
      status: 'VERIFIED',
      inputs: [
        { variable_id: 'VAR_DEMO_WEIGHT', name: 'Weight', unit: 'kg', required: true }
      ],
      outputs: [
        { name: 'final_score', unit: 'unitless', datatype: 'number' }
      ],
      parameter_ids: [],
      entry_step_id: 'STEP_A',
      steps: [
        { step_id: 'STEP_A', operation: 'SEQUENCE', next_step_id: 'STEP_B' },
        { step_id: 'STEP_B', operation: 'SEQUENCE', next_step_id: 'STEP_C' },
        {
          step_id: 'STEP_C',
          operation: 'OUTPUT',
          output_mapping: { final_score: 'VAR_DEMO_WEIGHT' },
          is_terminal: true
        }
      ],
      reference_ids: [],
      created_by: 'system',
      created_at: '2026-09-23T00:00:00Z',
      updated_at: '2026-09-23T00:00:00Z'
    };

    it('should execute steps A, B, and C in strict sequential order', () => {
      const result = AlgorithmExecutor.execute({
        algorithm: seqAlgorithm,
        request: {
          module_id: 'ALG_SEQ_TEST',
          inputs: { VAR_DEMO_WEIGHT: { value: 70, unit: 'kg' } }
        },
        variables: varMap
      });

      expect(result.execution_path).toEqual(['INPUT_VALIDATION', 'STEP_A', 'STEP_B', 'STEP_C']);
      expect(result.outputs.final_score.value).toBe(70);
      expect(result.fallback_used).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // TEST 2 — Sequence Failure
  // ---------------------------------------------------------------------------
  describe('Test 2 — Sequence Failure', () => {
    const invalidStepAlg: ScientificAlgorithm = {
      algorithm_id: 'ALG_SEQ_FAIL',
      name: 'Failing Sequence',
      description: 'Step references invalid operation',
      version: '1.0.0',
      status: 'VERIFIED',
      inputs: [],
      outputs: [{ name: 'out', unit: 'unitless', datatype: 'number' }],
      parameter_ids: [],
      steps: [
        { step_id: 'STEP_A', operation: 'INVALID_OP' as any }
      ],
      reference_ids: [],
      created_by: 'system',
      created_at: '2026-09-23T00:00:00Z',
      updated_at: '2026-09-23T00:00:00Z'
    };

    it('should abort and throw explicit error when a step operation is invalid', () => {
      expect(() => {
        AlgorithmExecutor.execute({
          algorithm: invalidStepAlg,
          request: { module_id: 'ALG_SEQ_FAIL', inputs: {} }
        });
      }).toThrowError(/Unknown operation/);
    });
  });

  // ---------------------------------------------------------------------------
  // TEST 3 & 4 & 5 & 6 — Condition True / False and Branch A / B
  // ---------------------------------------------------------------------------
  describe('Tests 3-6 — Condition Evaluation and Explicit Branching', () => {
    const branchAlg: ScientificAlgorithm = {
      algorithm_id: 'ALG_BRANCH_TEST',
      name: 'Branching Classifier',
      description: 'Branches based on age threshold >= 18',
      version: '1.0.0',
      status: 'VERIFIED',
      inputs: [
        { variable_id: 'VAR_DEMO_AGE', name: 'Age', unit: 'yr', required: true }
      ],
      outputs: [
        { name: 'classification', unit: 'unitless', datatype: 'string' }
      ],
      parameter_ids: [],
      entry_step_id: 'STEP_CHECK',
      steps: [
        {
          step_id: 'STEP_CHECK',
          operation: 'BRANCH',
          condition: {
            left_operand: { type: 'input', key: 'VAR_DEMO_AGE' },
            operator: '>=',
            right_operand: { type: 'constant', value: 18 },
            true_step_id: 'STEP_ADULT',
            false_step_id: 'STEP_PEDIATRIC'
          }
        },
        {
          step_id: 'STEP_ADULT',
          operation: 'OUTPUT',
          output_mapping: { classification: 'VAR_DEMO_AGE' },
          is_terminal: true
        },
        {
          step_id: 'STEP_PEDIATRIC',
          operation: 'OUTPUT',
          output_mapping: { classification: 'VAR_DEMO_AGE' },
          is_terminal: true
        }
      ],
      reference_ids: [],
      created_by: 'system',
      created_at: '2026-09-23T00:00:00Z',
      updated_at: '2026-09-23T00:00:00Z'
    };

    it('Test 3: should evaluate condition to true when input meets threshold', () => {
      const result = AlgorithmExecutor.execute({
        algorithm: branchAlg,
        request: {
          module_id: 'ALG_BRANCH_TEST',
          inputs: { VAR_DEMO_AGE: { value: 25, unit: 'yr' } }
        },
        variables: varMap
      });

      expect(result.intermediate_results.STEP_CHECK_condition).toBe(true);
    });

    it('Test 4: should evaluate condition to false when input does not meet threshold', () => {
      const result = AlgorithmExecutor.execute({
        algorithm: branchAlg,
        request: {
          module_id: 'ALG_BRANCH_TEST',
          inputs: { VAR_DEMO_AGE: { value: 14, unit: 'yr' } }
        },
        variables: varMap
      });

      expect(result.intermediate_results.STEP_CHECK_condition).toBe(false);
    });

    it('Test 5: should branch to Branch A (STEP_ADULT) when condition evaluates to true', () => {
      const result = AlgorithmExecutor.execute({
        algorithm: branchAlg,
        request: {
          module_id: 'ALG_BRANCH_TEST',
          inputs: { VAR_DEMO_AGE: { value: 25, unit: 'yr' } }
        },
        variables: varMap
      });

      expect(result.execution_path).toEqual(['INPUT_VALIDATION', 'STEP_CHECK', 'STEP_ADULT']);
      expect(result.execution_path).not.toContain('STEP_PEDIATRIC');
    });

    it('Test 6: should branch to Branch B (STEP_PEDIATRIC) when condition evaluates to false', () => {
      const result = AlgorithmExecutor.execute({
        algorithm: branchAlg,
        request: {
          module_id: 'ALG_BRANCH_TEST',
          inputs: { VAR_DEMO_AGE: { value: 14, unit: 'yr' } }
        },
        variables: varMap
      });

      expect(result.execution_path).toEqual(['INPUT_VALIDATION', 'STEP_CHECK', 'STEP_PEDIATRIC']);
      expect(result.execution_path).not.toContain('STEP_ADULT');
    });
  });

  // ---------------------------------------------------------------------------
  // TEST 7 & 8 & 9 & 10 & 11 — Fallback Routing & Signals
  // ---------------------------------------------------------------------------
  describe('Tests 7-11 — Fallback Routing and Signals', () => {
    const fallbackAlg: ScientificAlgorithm = {
      algorithm_id: 'ALG_FALLBACK_TEST',
      name: 'Primary with Fallback Routing',
      description: 'Uses primary weight or falls back to alternate path',
      version: '1.0.0',
      status: 'VERIFIED',
      inputs: [
        {
          variable_id: 'VAR_DEMO_WEIGHT',
          name: 'Weight',
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
      ],
      outputs: [
        { name: 'status_code', unit: 'unitless', datatype: 'string' }
      ],
      parameter_ids: [],
      entry_step_id: 'STEP_PRIMARY',
      fallback_routes: [
        { condition_signal: 'FALLBACK_REQUIRED', target_step_id: 'STEP_FALLBACK' }
      ],
      steps: [
        {
          step_id: 'STEP_PRIMARY',
          operation: 'SEQUENCE',
          next_step_id: 'STEP_FINISH'
        },
        {
          step_id: 'STEP_FALLBACK',
          operation: 'SEQUENCE',
          next_step_id: 'STEP_FINISH'
        },
        {
          step_id: 'STEP_FINISH',
          operation: 'OUTPUT',
          output_mapping: { status_code: 'VAR_DEMO_HEIGHT' },
          is_terminal: true
        }
      ],
      reference_ids: [],
      created_by: 'system',
      created_at: '2026-09-23T00:00:00Z',
      updated_at: '2026-09-23T00:00:00Z'
    };

    it('Test 7: should execute primary path when input is present without triggering fallback', () => {
      const result = AlgorithmExecutor.execute({
        algorithm: fallbackAlg,
        request: {
          module_id: 'ALG_FALLBACK_TEST',
          inputs: {
            VAR_DEMO_WEIGHT: { value: 70, unit: 'kg' },
            VAR_DEMO_HEIGHT: { value: 1.75, unit: 'm' }
          }
        },
        variables: varMap
      });

      expect(result.fallback_used).toBe(false);
      expect(result.execution_path).toContain('STEP_PRIMARY');
      expect(result.execution_path).not.toContain('STEP_FALLBACK');
    });

    it('Test 8: should route to fallback when explicit FALLBACK step operation is traversed', () => {
      const explicitFallbackAlg: ScientificAlgorithm = {
        ...fallbackAlg,
        steps: [
          { step_id: 'STEP_TRIGGER_FALLBACK', operation: 'FALLBACK', fallback_step_id: 'STEP_FALLBACK' },
          { step_id: 'STEP_FALLBACK', operation: 'OUTPUT', output_mapping: { status_code: 'VAR_DEMO_HEIGHT' } }
        ],
        entry_step_id: 'STEP_TRIGGER_FALLBACK'
      };

      const result = AlgorithmExecutor.execute({
        algorithm: explicitFallbackAlg,
        request: {
          module_id: 'ALG_FALLBACK_TEST',
          inputs: {
            VAR_DEMO_WEIGHT: { value: 70, unit: 'kg' },
            VAR_DEMO_HEIGHT: { value: 1.75, unit: 'm' }
          }
        },
        variables: varMap
      });

      expect(result.fallback_used).toBe(true);
      expect(result.execution_path).toContain('STEP_FALLBACK');
    });

    it('Test 9: should intercept C3 fallback_required signal and route to defined fallback target', () => {
      const result = AlgorithmExecutor.execute({
        algorithm: fallbackAlg,
        request: {
          module_id: 'ALG_FALLBACK_TEST',
          inputs: {
            // VAR_DEMO_WEIGHT is omitted, triggering C3 fallback signal
            VAR_DEMO_HEIGHT: { value: 1.75, unit: 'm' }
          }
        },
        variables: varMap
      });

      expect(result.fallback_used).toBe(true);
      expect(result.execution_path).toContain('FALLBACK_SIGNAL_ROUTED');
      expect(result.execution_path).toContain('STEP_FALLBACK');
      expect(result.execution_path).not.toContain('STEP_PRIMARY');
    });

    it('Test 10: should throw NO_FALLBACK_DEFINED when C3 emits fallback_required but algorithm lacks fallback routes', () => {
      const noFallbackAlg: ScientificAlgorithm = {
        ...fallbackAlg,
        fallback_routes: [],
        steps: [
          { step_id: 'STEP_ONLY', operation: 'OUTPUT' }
        ]
      };

      expect(() => {
        AlgorithmExecutor.execute({
          algorithm: noFallbackAlg,
          request: {
            module_id: 'ALG_FALLBACK_TEST',
            inputs: { VAR_DEMO_HEIGHT: { value: 1.75, unit: 'm' } }
          },
          variables: varMap
        });
      }).toThrowError(/defines no fallback routes/);
    });

    it('Test 11: should deterministically follow fallback route order defined in the algorithm contract', () => {
      const multiFallbackAlg: ScientificAlgorithm = {
        ...fallbackAlg,
        fallback_routes: [
          { target_step_id: 'STEP_FALLBACK' },
          { target_step_id: 'STEP_SECONDARY_FALLBACK' }
        ],
        steps: [
          ...fallbackAlg.steps,
          {
            step_id: 'STEP_SECONDARY_FALLBACK',
            operation: 'OUTPUT',
            output_mapping: { status_code: 'VAR_DEMO_HEIGHT' },
            is_terminal: true
          }
        ]
      };

      const res1 = AlgorithmExecutor.execute({
        algorithm: multiFallbackAlg,
        request: { module_id: 'ALG_FALLBACK_TEST', inputs: { VAR_DEMO_HEIGHT: { value: 1.75, unit: 'm' } } },
        variables: varMap
      });

      const res2 = AlgorithmExecutor.execute({
        algorithm: multiFallbackAlg,
        request: { module_id: 'ALG_FALLBACK_TEST', inputs: { VAR_DEMO_HEIGHT: { value: 1.75, unit: 'm' } } },
        variables: varMap
      });

      expect(res1.execution_path).toEqual(res2.execution_path);
      expect(res1.execution_path).toContain('STEP_FALLBACK');
    });
  });

  // ---------------------------------------------------------------------------
  // TEST 12 — Intermediate Result Propagation
  // ---------------------------------------------------------------------------
  describe('Test 12 — Intermediate Result Propagation', () => {
    const intermediateAlg: ScientificAlgorithm = {
      algorithm_id: 'ALG_INTERMEDIATE_TEST',
      name: 'Intermediate Value Propagator',
      description: 'Produces intermediate result and passes to subsequent step',
      version: '1.0.0',
      status: 'VERIFIED',
      inputs: [
        { variable_id: 'VAR_DEMO_WEIGHT', name: 'Weight', unit: 'kg', required: true },
        { variable_id: 'VAR_DEMO_HEIGHT', name: 'Height', unit: 'm', required: true }
      ],
      outputs: [
        { name: 'ratio_output', unit: 'unitless', datatype: 'number' }
      ],
      parameter_ids: [],
      entry_step_id: 'STEP_CALL_FORMULA',
      steps: [
        {
          step_id: 'STEP_CALL_FORMULA',
          operation: 'FORMULA_REFERENCE',
          formula_reference: {
            formula_id: 'FORMULA_DEMO_QUETELET',
            output_variable_id: 'intermediate_ratio'
          },
          next_step_id: 'STEP_USE_INTERMEDIATE'
        },
        {
          step_id: 'STEP_USE_INTERMEDIATE',
          operation: 'OUTPUT',
          output_mapping: { ratio_output: 'intermediate_ratio' },
          is_terminal: true
        }
      ],
      reference_ids: [],
      created_by: 'system',
      created_at: '2026-09-23T00:00:00Z',
      updated_at: '2026-09-23T00:00:00Z'
    };

    it('should capture and propagate intermediate output from formula reference to output mapping', () => {
      const result = AlgorithmExecutor.execute({
        algorithm: intermediateAlg,
        request: {
          module_id: 'ALG_INTERMEDIATE_TEST',
          inputs: {
            VAR_DEMO_WEIGHT: { value: 70, unit: 'kg' },
            VAR_DEMO_HEIGHT: { value: 1.75, unit: 'm' }
          }
        },
        variables: varMap,
        available_modules: DEMO_FORMULAS,
        available_parameters: DEMO_PARAMETERS
      });

      expect(result.intermediate_results.intermediate_ratio).toBeCloseTo(22.857143, 4);
      expect(result.outputs.ratio_output.value).toBeCloseTo(22.857143, 4);
    });
  });

  // ---------------------------------------------------------------------------
  // TEST 13 & 14 — Execution Path and Fallback Used Flag
  // ---------------------------------------------------------------------------
  describe('Test 13 & 14 — Execution Path and Fallback Used Flag', () => {
    const alg: ScientificAlgorithm = {
      algorithm_id: 'ALG_PATH_TEST',
      name: 'Path Tracker',
      description: 'Verifies path order',
      version: '1.0.0',
      status: 'VERIFIED',
      inputs: [],
      outputs: [{ name: 'dummy', unit: 'unitless', datatype: 'number' }],
      parameter_ids: [],
      entry_step_id: 'STEP_1',
      steps: [
        { step_id: 'STEP_1', operation: 'SEQUENCE', next_step_id: 'STEP_2' },
        { step_id: 'STEP_2', operation: 'SEQUENCE', next_step_id: 'STEP_3' },
        { step_id: 'STEP_3', operation: 'OUTPUT', is_terminal: true }
      ],
      reference_ids: [],
      created_by: 'system',
      created_at: '2026-09-23T00:00:00Z',
      updated_at: '2026-09-23T00:00:00Z'
    };

    it('Test 13: should accurately record execution_path in sequential order', () => {
      const result = AlgorithmExecutor.execute({
        algorithm: alg,
        request: { module_id: 'ALG_PATH_TEST', inputs: {} }
      });

      expect(result.execution_path).toEqual(['INPUT_VALIDATION', 'STEP_1', 'STEP_2', 'STEP_3']);
    });

    it('Test 14: should accurately record fallback_used flag as false on normal execution and true on fallback', () => {
      const normalResult = AlgorithmExecutor.execute({
        algorithm: alg,
        request: { module_id: 'ALG_PATH_TEST', inputs: {} }
      });
      expect(normalResult.fallback_used).toBe(false);

      const fallbackAlg: ScientificAlgorithm = {
        ...alg,
        steps: [
          { step_id: 'STEP_FB', operation: 'FALLBACK', fallback_step_id: 'STEP_END' },
          { step_id: 'STEP_END', operation: 'OUTPUT', is_terminal: true }
        ],
        entry_step_id: 'STEP_FB'
      };

      const fallbackResult = AlgorithmExecutor.execute({
        algorithm: fallbackAlg,
        request: { module_id: 'ALG_PATH_TEST', inputs: {} }
      });
      expect(fallbackResult.fallback_used).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // TEST 15 & 16 — Formula Reference & Version Resolution
  // ---------------------------------------------------------------------------
  describe('Test 15 & 16 — Formula Reference and Version Resolution', () => {
    it('Test 15: should resolve and execute a referenced formula cleanly', () => {
      const algWithFormula: ScientificAlgorithm = {
        algorithm_id: 'ALG_FORMULA_REF',
        name: 'Formula Caller',
        description: 'Calls Quetelet ratio formula',
        version: '1.0.0',
        status: 'VERIFIED',
        inputs: [
          { variable_id: 'VAR_DEMO_WEIGHT', name: 'Weight', unit: 'kg', required: true },
          { variable_id: 'VAR_DEMO_HEIGHT', name: 'Height', unit: 'm', required: true }
        ],
        outputs: [{ name: 'ratio', unit: 'kg/m2', datatype: 'number' }],
        parameter_ids: [],
        steps: [
          {
            step_id: 'STEP_EXEC_FORMULA',
            operation: 'FORMULA_REFERENCE',
            formula_reference: {
              formula_id: 'FORMULA_DEMO_QUETELET',
              version: '1.0.0'
            },
            is_terminal: true
          }
        ],
        reference_ids: [],
        created_by: 'system',
        created_at: '2026-09-23T00:00:00Z',
        updated_at: '2026-09-23T00:00:00Z'
      };

      const result = AlgorithmExecutor.execute({
        algorithm: algWithFormula,
        request: {
          module_id: 'ALG_FORMULA_REF',
          inputs: {
            VAR_DEMO_WEIGHT: { value: 70, unit: 'kg' },
            VAR_DEMO_HEIGHT: { value: 1.75, unit: 'm' }
          }
        },
        variables: varMap,
        available_modules: DEMO_FORMULAS,
        available_parameters: DEMO_PARAMETERS
      });

      expect(result.intermediate_results.STEP_EXEC_FORMULA).toBeCloseTo(22.857143, 4);
    });

    it('Test 16: should throw FORMULA_REFERENCE_INVALID when specified formula version does not exist', () => {
      const algBadVersion: ScientificAlgorithm = {
        algorithm_id: 'ALG_BAD_VERSION',
        name: 'Bad Version Caller',
        description: 'Requests missing formula version',
        version: '1.0.0',
        status: 'VERIFIED',
        inputs: [],
        outputs: [],
        parameter_ids: [],
        steps: [
          {
            step_id: 'STEP_1',
            operation: 'FORMULA_REFERENCE',
            formula_reference: {
              formula_id: 'FORMULA_DEMO_QUETELET',
              version: '9.9.9'
            }
          }
        ],
        reference_ids: [],
        created_by: 'system',
        created_at: '2026-09-23T00:00:00Z',
        updated_at: '2026-09-23T00:00:00Z'
      };

      expect(() => {
        AlgorithmExecutor.execute({
          algorithm: algBadVersion,
          request: { module_id: 'ALG_BAD_VERSION', inputs: {} },
          available_modules: DEMO_FORMULAS
        });
      }).toThrowError(/version "9.9.9" not found/);
    });
  });

  // ---------------------------------------------------------------------------
  // TEST 17 — Parameter Snapshot Usage
  // ---------------------------------------------------------------------------
  describe('Test 17 — Parameter Snapshot Usage', () => {
    it('should consume parameters from frozen ParameterSnapshot without database lookups', () => {
      const snapshot: ParameterSnapshot = {
        snapshot_id: 'SNAP_TEST_001',
        timestamp: '2026-09-23T00:00:00Z',
        entries: {
          PARAM_SAMPLE: {
            parameter_id: 'PARAM_SAMPLE',
            parameter_version: '1.0.0',
            name: 'Sample Constant',
            value: 42,
            unit: 'unitless',
            status: 'VERIFIED',
            is_constant: true
          }
        }
      };

      const algWithParam: ScientificAlgorithm = {
        algorithm_id: 'ALG_PARAM_TEST',
        name: 'Param Snapshot Tester',
        description: 'Branches based on frozen snapshot parameter',
        version: '1.0.0',
        status: 'VERIFIED',
        inputs: [],
        outputs: [{ name: 'out', unit: 'unitless', datatype: 'number' }],
        parameter_ids: ['PARAM_SAMPLE'],
        entry_step_id: 'STEP_CHECK_PARAM',
        steps: [
          {
            step_id: 'STEP_CHECK_PARAM',
            operation: 'BRANCH',
            condition: {
              left_operand: { type: 'parameter', key: 'PARAM_SAMPLE' },
              operator: '==',
              right_operand: { type: 'constant', value: 42 },
              true_step_id: 'STEP_MATCH',
              false_step_id: 'STEP_MISMATCH'
            }
          },
          { step_id: 'STEP_MATCH', operation: 'OUTPUT', is_terminal: true },
          { step_id: 'STEP_MISMATCH', operation: 'OUTPUT', is_terminal: true }
        ],
        reference_ids: [],
        created_by: 'system',
        created_at: '2026-09-23T00:00:00Z',
        updated_at: '2026-09-23T00:00:00Z'
      };

      const result = AlgorithmExecutor.execute({
        algorithm: algWithParam,
        request: { module_id: 'ALG_PARAM_TEST', inputs: {} },
        parameters: { PARAM_SAMPLE: snapshot.entries.PARAM_SAMPLE },
        parameter_snapshot: snapshot
      });

      expect(result.execution_path).toContain('STEP_MATCH');
      expect(result.parameter_snapshot?.snapshot_id).toBe('SNAP_TEST_001');
    });
  });

  // ---------------------------------------------------------------------------
  // TEST 18 — Trace Generation
  // ---------------------------------------------------------------------------
  describe('Test 18 — Trace Generation', () => {
    it('should generate standardized StandardTraceStep audit steps for every phase', () => {
      const alg: ScientificAlgorithm = {
        algorithm_id: 'ALG_TRACE_TEST',
        name: 'Trace Tester',
        description: 'Tests trace generation',
        version: '1.0.0',
        status: 'VERIFIED',
        inputs: [
          { variable_id: 'VAR_DEMO_WEIGHT', name: 'Weight', unit: 'kg', required: true }
        ],
        outputs: [{ name: 'res', unit: 'unitless', datatype: 'number' }],
        parameter_ids: [],
        entry_step_id: 'STEP_1',
        steps: [
          { step_id: 'STEP_1', operation: 'SEQUENCE', next_step_id: 'STEP_2' },
          { step_id: 'STEP_2', operation: 'OUTPUT', is_terminal: true }
        ],
        reference_ids: [],
        created_by: 'system',
        created_at: '2026-09-23T00:00:00Z',
        updated_at: '2026-09-23T00:00:00Z'
      };

      const result = AlgorithmExecutor.execute({
        algorithm: alg,
        request: {
          module_id: 'ALG_TRACE_TEST',
          inputs: { VAR_DEMO_WEIGHT: { value: 70, unit: 'kg' } }
        },
        variables: varMap
      });

      expect(result.trace.length).toBeGreaterThanOrEqual(3);
      expect(result.trace.some(t => t.operation === 'UNIT_CHECK' || t.operation === 'INPUT_VALIDATION')).toBe(true);
      expect(result.trace.some(t => t.operation === 'ALGORITHM_STEP_SEQUENCE')).toBe(true);
      expect(result.trace.some(t => t.operation === 'ALGORITHM_OUTPUT_ASSEMBLY')).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // TEST 19 — Cycle Detection
  // ---------------------------------------------------------------------------
  describe('Test 19 — Cycle Detection', () => {
    it('should detect execution cycles (A -> B -> A) and throw EXECUTION_CYCLE_DETECTED', () => {
      const cycleAlg: ScientificAlgorithm = {
        algorithm_id: 'ALG_CYCLE_TEST',
        name: 'Cyclic Graph',
        description: 'Contains infinite loop',
        version: '1.0.0',
        status: 'VERIFIED',
        inputs: [],
        outputs: [],
        parameter_ids: [],
        entry_step_id: 'STEP_A',
        steps: [
          { step_id: 'STEP_A', operation: 'SEQUENCE', next_step_id: 'STEP_B' },
          { step_id: 'STEP_B', operation: 'SEQUENCE', next_step_id: 'STEP_A' } // Cycle back to A!
        ],
        reference_ids: [],
        created_by: 'system',
        created_at: '2026-09-23T00:00:00Z',
        updated_at: '2026-09-23T00:00:00Z'
      };

      expect(() => {
        AlgorithmExecutor.execute({
          algorithm: cycleAlg,
          request: { module_id: 'ALG_CYCLE_TEST', inputs: {} }
        });
      }).toThrowError(/Cycle detected: step "STEP_A" was revisited/);
    });
  });

  // ---------------------------------------------------------------------------
  // TEST 20 — Missing Step
  // ---------------------------------------------------------------------------
  describe('Test 20 — Missing Step', () => {
    it('should throw STEP_NOT_FOUND when a step points to a non-existent next_step_id', () => {
      const missingStepAlg: ScientificAlgorithm = {
        algorithm_id: 'ALG_MISSING_STEP',
        name: 'Missing Step Alg',
        description: 'References non-existent step',
        version: '1.0.0',
        status: 'VERIFIED',
        inputs: [],
        outputs: [],
        parameter_ids: [],
        entry_step_id: 'STEP_A',
        steps: [
          { step_id: 'STEP_A', operation: 'SEQUENCE', next_step_id: 'GHOST_STEP' }
        ],
        reference_ids: [],
        created_by: 'system',
        created_at: '2026-09-23T00:00:00Z',
        updated_at: '2026-09-23T00:00:00Z'
      };

      expect(() => {
        AlgorithmExecutor.execute({
          algorithm: missingStepAlg,
          request: { module_id: 'ALG_MISSING_STEP', inputs: {} }
        });
      }).toThrowError(/Step "GHOST_STEP" not found/);
    });
  });

  // ---------------------------------------------------------------------------
  // TEST 21 — Invalid Branch Target
  // ---------------------------------------------------------------------------
  describe('Test 21 — Invalid Branch Target', () => {
    it('should throw BRANCH_TARGET_INVALID when condition points to non-existent target step', () => {
      const badBranchAlg: ScientificAlgorithm = {
        algorithm_id: 'ALG_BAD_BRANCH',
        name: 'Bad Branch Target',
        description: 'Branch points to missing step',
        version: '1.0.0',
        status: 'VERIFIED',
        inputs: [],
        outputs: [],
        parameter_ids: [],
        steps: [
          {
            step_id: 'STEP_1',
            operation: 'BRANCH',
            condition: {
              left_operand: { type: 'constant', value: 1 },
              operator: '==',
              right_operand: { type: 'constant', value: 1 },
              true_step_id: 'NON_EXISTENT_BRANCH',
              false_step_id: 'STEP_1'
            }
          }
        ],
        reference_ids: [],
        created_by: 'system',
        created_at: '2026-09-23T00:00:00Z',
        updated_at: '2026-09-23T00:00:00Z'
      };

      expect(() => {
        AlgorithmExecutor.execute({
          algorithm: badBranchAlg,
          request: { module_id: 'ALG_BAD_BRANCH', inputs: {} }
        });
      }).toThrowError(/target step "NON_EXISTENT_BRANCH" does not exist/);
    });
  });

  // ---------------------------------------------------------------------------
  // TEST 22 — Invalid Condition
  // ---------------------------------------------------------------------------
  describe('Test 22 — Invalid Condition', () => {
    it('should throw CONDITION_INVALID when condition is malformed or missing operands', () => {
      const badConditionAlg: ScientificAlgorithm = {
        algorithm_id: 'ALG_BAD_COND',
        name: 'Bad Condition Alg',
        description: 'Lacks condition definition',
        version: '1.0.0',
        status: 'VERIFIED',
        inputs: [],
        outputs: [],
        parameter_ids: [],
        steps: [
          {
            step_id: 'STEP_1',
            operation: 'BRANCH'
            // condition missing!
          }
        ],
        reference_ids: [],
        created_by: 'system',
        created_at: '2026-09-23T00:00:00Z',
        updated_at: '2026-09-23T00:00:00Z'
      };

      expect(() => {
        AlgorithmExecutor.execute({
          algorithm: badConditionAlg,
          request: { module_id: 'ALG_BAD_COND', inputs: {} }
        });
      }).toThrowError(/lacks a valid condition/);
    });
  });

  // ---------------------------------------------------------------------------
  // TEST 23 — Deterministic Repeated Execution
  // ---------------------------------------------------------------------------
  describe('Test 23 — Deterministic Repeated Execution', () => {
    const deterministicAlg: ScientificAlgorithm = {
      algorithm_id: 'ALG_DETERMINISM',
      name: 'Deterministic Test',
      description: 'Verifies reproducible results',
      version: '1.0.0',
      status: 'VERIFIED',
      inputs: [
        { variable_id: 'VAR_DEMO_WEIGHT', name: 'Weight', unit: 'kg', required: true },
        { variable_id: 'VAR_DEMO_HEIGHT', name: 'Height', unit: 'm', required: true }
      ],
      outputs: [{ name: 'ratio', unit: 'kg/m2', datatype: 'number' }],
      parameter_ids: [],
      steps: [
        {
          step_id: 'STEP_EVAL',
          operation: 'FORMULA_REFERENCE',
          formula_reference: { formula_id: 'FORMULA_DEMO_QUETELET' },
          is_terminal: true
        }
      ],
      reference_ids: [],
      created_by: 'system',
      created_at: '2026-09-23T00:00:00Z',
      updated_at: '2026-09-23T00:00:00Z'
    };

    it('should produce identical execution_path, outputs, and intermediate_results across multiple runs', () => {
      const opts = {
        algorithm: deterministicAlg,
        request: {
          module_id: 'ALG_DETERMINISM',
          inputs: {
            VAR_DEMO_WEIGHT: { value: 70, unit: 'kg' },
            VAR_DEMO_HEIGHT: { value: 1.75, unit: 'm' }
          }
        },
        variables: varMap,
        available_modules: DEMO_FORMULAS,
        available_parameters: DEMO_PARAMETERS
      };

      const res1 = AlgorithmExecutor.execute(opts);
      const res2 = AlgorithmExecutor.execute(opts);

      expect(res1.execution_path).toEqual(res2.execution_path);
      expect(res1.outputs).toEqual(res2.outputs);
      expect(res1.intermediate_results).toEqual(res2.intermediate_results);
      expect(res1.fallback_used).toBe(res2.fallback_used);
    });
  });

  // ---------------------------------------------------------------------------
  // TEST 24 — Execution Isolation
  // ---------------------------------------------------------------------------
  describe('Test 24 — Execution Isolation', () => {
    it('should isolate execution contexts so that separate executions do not leak state', () => {
      const isolAlg: ScientificAlgorithm = {
        algorithm_id: 'ALG_ISOL_TEST',
        name: 'Isolation Test',
        description: 'Tests state isolation',
        version: '1.0.0',
        status: 'VERIFIED',
        inputs: [{ variable_id: 'VAR_DEMO_WEIGHT', name: 'Weight', unit: 'kg', required: true }],
        outputs: [{ name: 'out', unit: 'kg', datatype: 'number' }],
        parameter_ids: [],
        steps: [
          { step_id: 'STEP_1', operation: 'OUTPUT', output_mapping: { out: 'VAR_DEMO_WEIGHT' } }
        ],
        reference_ids: [],
        created_by: 'system',
        created_at: '2026-09-23T00:00:00Z',
        updated_at: '2026-09-23T00:00:00Z'
      };

      const run1 = AlgorithmExecutor.execute({
        algorithm: isolAlg,
        request: { module_id: 'ALG_ISOL_TEST', inputs: { VAR_DEMO_WEIGHT: { value: 60, unit: 'kg' } } },
        variables: varMap
      });

      const run2 = AlgorithmExecutor.execute({
        algorithm: isolAlg,
        request: { module_id: 'ALG_ISOL_TEST', inputs: { VAR_DEMO_WEIGHT: { value: 90, unit: 'kg' } } },
        variables: varMap
      });

      expect(run1.outputs.out.value).toBe(60);
      expect(run2.outputs.out.value).toBe(90);
      expect(run1.inputs.VAR_DEMO_WEIGHT.value).toBe(60);
      expect(run2.inputs.VAR_DEMO_WEIGHT.value).toBe(90);
    });
  });

  // ---------------------------------------------------------------------------
  // TEST 25 — C1 Regression (ModuleRequest / ExecutionResult compatibility)
  // ---------------------------------------------------------------------------
  describe('Test 25 — C1 Regression', () => {
    it('should maintain 100% numerical invariance for Quetelet formula calculation', () => {
      const request: ModuleRequest = {
        module_id: 'FORMULA_DEMO_QUETELET',
        inputs: {
          VAR_DEMO_WEIGHT: { value: 70, unit: 'kg' },
          VAR_DEMO_HEIGHT: { value: 1.75, unit: 'm' }
        }
      };

      const result = executeModuleRequest(request, queteletFormula, paramMap, varMap);

      expect(result.module_id).toBe('FORMULA_DEMO_QUETELET');
      expect(result.outputs.anthropometric_ratio.value).toBeCloseTo(22.857143, 4);
      expect(result.provenance_id).toHaveLength(64);
    });
  });

  // ---------------------------------------------------------------------------
  // TEST 26 — C2 Regression (Module & Parameter Resolvers)
  // ---------------------------------------------------------------------------
  describe('Test 26 — C2 Regression', () => {
    it('should maintain exact resolution and calculation of Mifflin BMR through C2 resolvers', () => {
      const request: ModuleRequest = {
        module_id: 'FORMULA_BMR_MIFFLIN',
        requested_version: '1.2.0',
        inputs: {
          VAR_DEMO_WEIGHT: { value: 70, unit: 'kg' },
          VAR_DEMO_HEIGHT: { value: 1.75, unit: 'm' },
          VAR_DEMO_AGE: { value: 30, unit: 'yr' }
        }
      };

      const result = executeModuleRequest(request, undefined, undefined, varMap, {
        available_modules: DEMO_FORMULAS,
        available_parameters: DEMO_PARAMETERS
      });

      expect(result.outputs.bmr_kcal.value).toBe(1648.75);
      expect(result.parameter_versions?.PARAM_BMR_SEX_OFFSET).toBe('1.0.0');
      expect(result.parameter_snapshot).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // TEST 27 — C3 Regression (Standalone Input Validator)
  // ---------------------------------------------------------------------------
  describe('Test 27 — C3 Regression', () => {
    it('should preserve all InputValidator behavior including unit normalization and boundary checks', () => {
      const validation = InputValidator.validate({
        module: queteletFormula,
        inputs: {
          VAR_DEMO_WEIGHT: { value: 70000, unit: 'g' }, // 70 kg
          VAR_DEMO_HEIGHT: { value: 175, unit: 'cm' }  // 1.75 m
        },
        variables: varMap
      });

      expect(validation.valid).toBe(true);
      expect(validation.normalized_inputs.VAR_DEMO_WEIGHT.value).toBe(70);
      expect(validation.normalized_inputs.VAR_DEMO_HEIGHT.value).toBe(1.75);
    });
  });
});
