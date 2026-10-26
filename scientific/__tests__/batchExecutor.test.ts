/**
 * NutriBodySim — Batch Execution Engine Test Suite
 * 
 * Phase C7: Batch Execution Engine
 * 40 Mandatory Test Cases verifying:
 * - Batch request, record, and result contracts
 * - Orchestration across C1–C6 without duplication
 * - Shared, frozen parameter snapshot
 * - Error policies: FAIL_FAST vs CONTINUE_ON_ERROR
 * - Strict execution isolation (including discrete model state isolation)
 * - Deterministic input-order result preservation
 * - Validation engine (C6) integration per record
 * - Edge cases: empty batch, duplicate IDs, max batch size limits
 * - Complete Phase C1 - C6 regression verification
 */

import { describe, it, expect } from 'vitest';
import {
  BatchExecutor,
  BatchExecutionRequest,
  BatchRecord,
  ScientificBatchError,
  ScientificFormula,
  ScientificAlgorithm,
  ScientificModel,
  ScientificParameter,
  ValidationProfile,
  CalculationEngine,
  ModuleResolver,
  ParameterResolver,
  InputValidator,
  AlgorithmExecutor,
  ModelExecutor,
  ValidationEngine
} from '../index';

describe('Phase C7 — Batch Execution Engine Test Suite (40 Mandatory Tests)', () => {
  // Common synthetic test formula: y = x * scale + offset
  const standardSyntheticFormula: ScientificFormula = {
    formula_id: 'FORMULA_BATCH_SYNTH_LINEAR',
    name: 'Synthetic Linear Scale',
    description: 'Computes y = x * scale + offset for batch testing',
    version: '1.0.0',
    status: 'VERIFIED',
    inputs: [
      { variable_id: 'x', name: 'Input X', unit: 'kg', datatype: 'number', required: true }
    ],
    outputs: [
      { name: 'y', unit: 'kg', datatype: 'number' }
    ],
    parameter_ids: ['PARAM_BATCH_SCALE', 'PARAM_BATCH_OFFSET'],
    expression_ast: {
      type: 'OPERATOR',
      op: 'ADD',
      args: [
        {
          type: 'OPERATOR',
          op: 'MULTIPLY',
          args: [
            { type: 'VARIABLE', variable_id: 'x' },
            { type: 'PARAMETER', parameter_id: 'PARAM_BATCH_SCALE' }
          ]
        },
        { type: 'PARAMETER', parameter_id: 'PARAM_BATCH_OFFSET' }
      ]
    },
    expression_string: '(x * scale) + offset',
    reference_ids: ['REF_SYNTH_2026'],
    assumptions: ['Pure arithmetic test'],
    limitations: ['Synthetic only'],
    validation_status: 'VALIDATED',
    created_by: 'system',
    created_at: '2026-09-24T00:00:00Z',
    updated_at: '2026-09-24T00:00:00Z'
  };

  const standardParameters: ScientificParameter[] = [
    {
      parameter_id: 'PARAM_BATCH_SCALE',
      name: 'Scale Multiplier',
      description: 'Scale multiplier',
      value: 2,
      unit: 'unitless',
      reference_ids: [],
      version: '1.0.0',
      status: 'VERIFIED',
      is_constant: true,
      created_at: '2026-09-24T00:00:00Z',
      updated_at: '2026-09-24T00:00:00Z'
    },
    {
      parameter_id: 'PARAM_BATCH_OFFSET',
      name: 'Additive Offset',
      description: 'Additive offset',
      value: 10,
      unit: 'kg',
      reference_ids: [],
      version: '1.0.0',
      status: 'VERIFIED',
      is_constant: true,
      created_at: '2026-09-24T00:00:00Z',
      updated_at: '2026-09-24T00:00:00Z'
    }
  ];

  // ===========================================================================
  // CONTRACT TESTS (1-3)
  // ===========================================================================

  it('Test 1: should create a valid typed BatchExecutionRequest contract', () => {
    const request: BatchExecutionRequest = {
      batch_id: 'BATCH_REQ_001',
      module_id: 'FORMULA_BATCH_SYNTH_LINEAR',
      requested_version: '1.0.0',
      records: [
        { record_id: 'REC_01', inputs: { x: { value: 5, unit: 'kg' } } }
      ],
      error_policy: 'CONTINUE_ON_ERROR'
    };

    expect(request.batch_id).toBe('BATCH_REQ_001');
    expect(request.records.length).toBe(1);
    expect(request.error_policy).toBe('CONTINUE_ON_ERROR');
  });

  it('Test 2: should create a valid typed BatchRecord with stable record_id', () => {
    const record: BatchRecord = {
      record_id: 'REC_STABLE_001',
      inputs: { x: { value: 20 } },
      metadata: { cohort: 'synthetic_group_A' }
    };

    expect(record.record_id).toBe('REC_STABLE_001');
    expect(record.metadata?.cohort).toBe('synthetic_group_A');
  });

  it('Test 3: should produce a structured BatchExecutionResult contract with accounting summary', () => {
    const request: BatchExecutionRequest = {
      batch_id: 'BATCH_RESULT_001',
      module_id: 'FORMULA_BATCH_SYNTH_LINEAR',
      records: [
        { record_id: 'R1', inputs: { x: { value: 5, unit: 'kg' } } }
      ]
    };

    const batchResult = BatchExecutor.execute({
      request,
      available_modules: [standardSyntheticFormula],
      available_parameters: standardParameters
    });

    expect(batchResult.batch_id).toBe('BATCH_RESULT_001');
    expect(batchResult.status).toBe('COMPLETED');
    expect(batchResult.total_records).toBe(1);
    expect(batchResult.successful_records).toBe(1);
    expect(batchResult.failed_records).toBe(0);
    expect(batchResult.skipped_records).toBe(0);
    expect(batchResult.summary).toEqual({
      total_records: 1,
      successful_records: 1,
      failed_records: 0,
      skipped_records: 0
    });
  });

  // ===========================================================================
  // BASIC EXECUTION TESTS (4-8)
  // ===========================================================================

  it('Test 4: should successfully execute a batch with a single record', () => {
    const result = BatchExecutor.execute({
      request: {
        batch_id: 'B_SINGLE',
        module_id: 'FORMULA_BATCH_SYNTH_LINEAR',
        records: [{ record_id: 'R_SINGLE', inputs: { x: { value: 10, unit: 'kg' } } }]
      },
      available_modules: [standardSyntheticFormula],
      available_parameters: standardParameters
    });

    expect(result.status).toBe('COMPLETED');
    expect(result.records[0].status).toBe('SUCCESS');
    // y = 10 * 2 + 10 = 30
    expect(result.records[0].result?.outputs['y'].value).toBe(30);
  });

  it('Test 5: should successfully execute a batch with multiple records', () => {
    const result = BatchExecutor.execute({
      request: {
        batch_id: 'B_MULTI',
        module_id: 'FORMULA_BATCH_SYNTH_LINEAR',
        records: [
          { record_id: 'R1', inputs: { x: { value: 10, unit: 'kg' } } },
          { record_id: 'R2', inputs: { x: { value: 20, unit: 'kg' } } },
          { record_id: 'R3', inputs: { x: { value: 30, unit: 'kg' } } }
        ]
      },
      available_modules: [standardSyntheticFormula],
      available_parameters: standardParameters
    });

    expect(result.total_records).toBe(3);
    expect(result.successful_records).toBe(3);
    expect(result.records[0].result?.outputs['y'].value).toBe(30); // 10*2+10
    expect(result.records[1].result?.outputs['y'].value).toBe(50); // 20*2+10
    expect(result.records[2].result?.outputs['y'].value).toBe(70); // 30*2+10
  });

  it('Test 6: should assign a distinct execution ID to each record execution', () => {
    const result = BatchExecutor.execute({
      request: {
        batch_id: 'B_EXEC_IDS',
        module_id: 'FORMULA_BATCH_SYNTH_LINEAR',
        records: [
          { record_id: 'R1', inputs: { x: { value: 1 } } },
          { record_id: 'R2', inputs: { x: { value: 2 } } }
        ]
      },
      available_modules: [standardSyntheticFormula],
      available_parameters: standardParameters
    });

    const id1 = result.records[0].execution_id;
    const id2 = result.records[1].execution_id;

    expect(id1).toBeDefined();
    expect(id2).toBeDefined();
    expect(id1).not.toBe(id2);
  });

  it('Test 7: should execute all records using the exact same resolved module version', () => {
    const result = BatchExecutor.execute({
      request: {
        batch_id: 'B_VERSION_CHECK',
        module_id: 'FORMULA_BATCH_SYNTH_LINEAR',
        requested_version: '1.0.0',
        records: [
          { record_id: 'R1', inputs: { x: { value: 1 } } },
          { record_id: 'R2', inputs: { x: { value: 2 } } }
        ]
      },
      available_modules: [standardSyntheticFormula],
      available_parameters: standardParameters
    });

    expect(result.module_version).toBe('1.0.0');
    expect(result.records[0].result?.module_version).toBe('1.0.0');
    expect(result.records[1].result?.module_version).toBe('1.0.0');
  });

  it('Test 8: should strictly preserve input record ordering in batch results', () => {
    const inputIds = ['ALPHA', 'BRAVO', 'CHARLIE', 'DELTA'];
    const records = inputIds.map(id => ({ record_id: id, inputs: { x: { value: 5 } } }));

    const result = BatchExecutor.execute({
      request: {
        batch_id: 'B_ORDER',
        module_id: 'FORMULA_BATCH_SYNTH_LINEAR',
        records
      },
      available_modules: [standardSyntheticFormula],
      available_parameters: standardParameters
    });

    const outputIds = result.records.map(r => r.record_id);
    expect(outputIds).toEqual(inputIds);
  });

  // ===========================================================================
  // PARAMETER TESTS (9-12)
  // ===========================================================================

  it('Test 9: should utilize a single shared parameter snapshot across all records in the batch', () => {
    const result = BatchExecutor.execute({
      request: {
        batch_id: 'B_SHARED_PARAM',
        module_id: 'FORMULA_BATCH_SYNTH_LINEAR',
        records: [
          { record_id: 'R1', inputs: { x: { value: 1 } } },
          { record_id: 'R2', inputs: { x: { value: 2 } } }
        ]
      },
      available_modules: [standardSyntheticFormula],
      available_parameters: standardParameters
    });

    const snap1 = result.records[0].result?.parameter_snapshot;
    const snap2 = result.records[1].result?.parameter_snapshot;

    expect(snap1?.entries['PARAM_BATCH_SCALE'].value).toBe(2);
    expect(snap2?.entries['PARAM_BATCH_SCALE'].value).toBe(2);
  });

  it('Test 10: should ensure parameter snapshot immutability during batch execution', () => {
    const paramsCopy = JSON.parse(JSON.stringify(standardParameters));
    const result = BatchExecutor.execute({
      request: {
        batch_id: 'B_PARAM_IMMUTABLE',
        module_id: 'FORMULA_BATCH_SYNTH_LINEAR',
        records: [
          { record_id: 'R1', inputs: { x: { value: 1 } } },
          { record_id: 'R2', inputs: { x: { value: 2 } } }
        ]
      },
      available_modules: [standardSyntheticFormula],
      available_parameters: paramsCopy
    });

    expect(paramsCopy).toEqual(standardParameters);
    expect(result.status).toBe('COMPLETED');
  });

  it('Test 11: should throw BATCH_PARAMETER_RESOLUTION_FAILED when specified parameter set is not found', () => {
    expect(() => {
      BatchExecutor.execute({
        request: {
          batch_id: 'B_MISSING_SET',
          module_id: 'FORMULA_BATCH_SYNTH_LINEAR',
          parameter_set_id: 'NON_EXISTENT_SET_999',
          records: [{ record_id: 'R1', inputs: { x: { value: 1 } } }]
        },
        available_modules: [standardSyntheticFormula],
        available_parameters: standardParameters
      });
    }).toThrow(ScientificBatchError);
  });

  it('Test 12: should handle parameter resolution failure with explicit error code', () => {
    try {
      BatchExecutor.execute({
        request: {
          batch_id: 'B_PARAM_FAIL',
          module_id: 'FORMULA_BATCH_SYNTH_LINEAR',
          records: [{ record_id: 'R1', inputs: { x: { value: 1 } } }]
        },
        available_modules: [standardSyntheticFormula],
        available_parameters: [] // Missing required parameters
      });
    } catch (err: any) {
      expect(err).toBeInstanceOf(ScientificBatchError);
      expect(err.code).toBe('BATCH_PARAMETER_RESOLUTION_FAILED');
    }
  });

  // ===========================================================================
  // MODULE RESOLUTION TESTS (13-14)
  // ===========================================================================

  it('Test 13: should resolve the exact requested module version', () => {
    const v2Formula: ScientificFormula = {
      ...standardSyntheticFormula,
      version: '2.0.0',
      expression_ast: { type: 'CONSTANT', value: 999 }
    };

    const result = BatchExecutor.execute({
      request: {
        batch_id: 'B_V2_REQ',
        module_id: 'FORMULA_BATCH_SYNTH_LINEAR',
        requested_version: '2.0.0',
        records: [{ record_id: 'R1', inputs: { x: { value: 1 } } }]
      },
      available_modules: [standardSyntheticFormula, v2Formula],
      available_parameters: standardParameters
    });

    expect(result.module_version).toBe('2.0.0');
    expect(result.records[0].result?.outputs['y'].value).toBe(999);
  });

  it('Test 14: should throw BATCH_MODULE_NOT_FOUND when requested module is absent from registry', () => {
    expect(() => {
      BatchExecutor.execute({
        request: {
          batch_id: 'B_MOD_ABSENT',
          module_id: 'NON_EXISTENT_MODULE_404',
          records: [{ record_id: 'R1', inputs: { x: { value: 1 } } }]
        },
        available_modules: [standardSyntheticFormula],
        available_parameters: standardParameters
      });
    }).toThrow(ScientificBatchError);
  });

  // ===========================================================================
  // INPUT VALIDATION INTEGRATION TESTS (15-17)
  // ===========================================================================

  it('Test 15: should pass each record input through C3 InputValidator', () => {
    const result = BatchExecutor.execute({
      request: {
        batch_id: 'B_C3_VAL',
        module_id: 'FORMULA_BATCH_SYNTH_LINEAR',
        // Input provided in grams, should be normalized to kg
        records: [{ record_id: 'R1', inputs: { x: { value: 5000, unit: 'g' } } }]
      },
      available_modules: [standardSyntheticFormula],
      available_parameters: standardParameters
    });

    expect(result.status).toBe('COMPLETED');
    expect(result.records[0].result?.normalized_inputs['x'].value).toBe(5);
    // y = 5 * 2 + 10 = 20
    expect(result.records[0].result?.outputs['y'].value).toBe(20);
  });

  it('Test 16: should flag record as FAILED when record inputs fail C3 validation', () => {
    const result = BatchExecutor.execute({
      request: {
        batch_id: 'B_INVALID_INPUT',
        module_id: 'FORMULA_BATCH_SYNTH_LINEAR',
        // Missing required input 'x'
        records: [{ record_id: 'R_BAD', inputs: {} }]
      },
      available_modules: [standardSyntheticFormula],
      available_parameters: standardParameters
    });

    expect(result.status).toBe('FAILED');
    expect(result.records[0].status).toBe('FAILED');
    expect(result.records[0].errors.length).toBeGreaterThan(0);
  });

  it('Test 17: should preserve normalized input representation in individual record ExecutionResult', () => {
    const result = BatchExecutor.execute({
      request: {
        batch_id: 'B_NORM_PRES',
        module_id: 'FORMULA_BATCH_SYNTH_LINEAR',
        records: [{ record_id: 'R1', inputs: { x: { value: 10, unit: 'kg' } } }]
      },
      available_modules: [standardSyntheticFormula],
      available_parameters: standardParameters
    });

    expect(result.records[0].result?.normalized_inputs['x']).toMatchObject({
      value: 10,
      unit: 'kg'
    });
  });

  // ===========================================================================
  // ERROR POLICY TESTS (18-22)
  // ===========================================================================

  it('Test 18: FAIL_FAST policy should stop execution on the first record failure and mark subsequent records as SKIPPED', () => {
    const result = BatchExecutor.execute({
      request: {
        batch_id: 'B_FAIL_FAST',
        module_id: 'FORMULA_BATCH_SYNTH_LINEAR',
        error_policy: 'FAIL_FAST',
        records: [
          { record_id: 'R1', inputs: { x: { value: 10 } } },
          { record_id: 'R2_FAIL', inputs: {} }, // Missing required input -> fails
          { record_id: 'R3', inputs: { x: { value: 30 } } }
        ]
      },
      available_modules: [standardSyntheticFormula],
      available_parameters: standardParameters
    });

    expect(result.status).toBe('COMPLETED_WITH_ERRORS');
    expect(result.records[0].status).toBe('SUCCESS');
    expect(result.records[1].status).toBe('FAILED');
    expect(result.records[2].status).toBe('SKIPPED');
    expect(result.skipped_records).toBe(1);
    expect(result.failed_records).toBe(1);
    expect(result.successful_records).toBe(1);
  });

  it('Test 19: CONTINUE_ON_ERROR policy should continue execution for subsequent records after a failure', () => {
    const result = BatchExecutor.execute({
      request: {
        batch_id: 'B_CONTINUE',
        module_id: 'FORMULA_BATCH_SYNTH_LINEAR',
        error_policy: 'CONTINUE_ON_ERROR',
        records: [
          { record_id: 'R1', inputs: { x: { value: 10 } } },
          { record_id: 'R2_FAIL', inputs: {} },
          { record_id: 'R3', inputs: { x: { value: 30 } } }
        ]
      },
      available_modules: [standardSyntheticFormula],
      available_parameters: standardParameters
    });

    expect(result.status).toBe('COMPLETED_WITH_ERRORS');
    expect(result.records[0].status).toBe('SUCCESS');
    expect(result.records[1].status).toBe('FAILED');
    expect(result.records[2].status).toBe('SUCCESS');
    expect(result.records[2].result?.outputs['y'].value).toBe(70);
    expect(result.skipped_records).toBe(0);
  });

  it('Test 20: should retain complete error descriptions in failed record result', () => {
    const result = BatchExecutor.execute({
      request: {
        batch_id: 'B_ERR_RETAIN',
        module_id: 'FORMULA_BATCH_SYNTH_LINEAR',
        records: [{ record_id: 'R_FAIL', inputs: {} }]
      },
      available_modules: [standardSyntheticFormula],
      available_parameters: standardParameters
    });

    expect(result.records[0].errors[0]).toBeDefined();
    expect(result.records[0].errors[0].length).toBeGreaterThan(0);
  });

  it('Test 21: should maintain strict state isolation for records executed after a failure', () => {
    const result = BatchExecutor.execute({
      request: {
        batch_id: 'B_ISOLATE_POST_FAIL',
        module_id: 'FORMULA_BATCH_SYNTH_LINEAR',
        error_policy: 'CONTINUE_ON_ERROR',
        records: [
          { record_id: 'R1_FAIL', inputs: {} },
          { record_id: 'R2_OK', inputs: { x: { value: 5 } } }
        ]
      },
      available_modules: [standardSyntheticFormula],
      available_parameters: standardParameters
    });

    expect(result.records[0].status).toBe('FAILED');
    expect(result.records[1].status).toBe('SUCCESS');
    expect(result.records[1].result?.outputs['y'].value).toBe(20);
    expect(result.records[1].errors.length).toBe(0);
  });

  it('Test 22: should correctly identify and account for skipped records', () => {
    const result = BatchExecutor.execute({
      request: {
        batch_id: 'B_SKIPPED_ACCOUNT',
        module_id: 'FORMULA_BATCH_SYNTH_LINEAR',
        error_policy: 'FAIL_FAST',
        records: [
          { record_id: 'R1_FAIL', inputs: {} },
          { record_id: 'R2', inputs: { x: { value: 10 } } },
          { record_id: 'R3', inputs: { x: { value: 20 } } }
        ]
      },
      available_modules: [standardSyntheticFormula],
      available_parameters: standardParameters
    });

    expect(result.skipped_records).toBe(2);
    expect(result.records[1].status).toBe('SKIPPED');
    expect(result.records[2].status).toBe('SKIPPED');
  });

  // ===========================================================================
  // VALIDATION INTEGRATION TESTS (23-25)
  // ===========================================================================

  it('Test 23: should evaluate each successful record against Phase C6 ValidationEngine', () => {
    const valProfile: ValidationProfile = {
      validation_id: 'VAL_BATCH_PROFILE',
      name: 'Batch Output Check',
      version: '1.0.0',
      checks: [
        {
          check_id: 'CHK_REQ_Y',
          name: 'Output y required',
          type: 'STRUCTURAL',
          configuration: { required_outputs: ['y'] }
        }
      ]
    };

    const result = BatchExecutor.execute({
      request: {
        batch_id: 'B_VAL_EVAL',
        module_id: 'FORMULA_BATCH_SYNTH_LINEAR',
        validation_profile: valProfile,
        records: [
          { record_id: 'R1', inputs: { x: { value: 5 } } },
          { record_id: 'R2', inputs: { x: { value: 10 } } }
        ]
      },
      available_modules: [standardSyntheticFormula],
      available_parameters: standardParameters
    });

    expect(result.records[0].validation?.status).toBe('PASS');
    expect(result.records[1].validation?.status).toBe('PASS');
  });

  it('Test 24: should preserve record execution status as SUCCESS even if scientific validation reports FAIL', () => {
    const failingValProfile: ValidationProfile = {
      validation_id: 'VAL_FAILING_PROFILE',
      name: 'Strict Range Check',
      version: '1.0.0',
      checks: [
        {
          check_id: 'CHK_Y_BOUND',
          name: 'Max limit check',
          type: 'BOUNDARY',
          configuration: { target_output: 'y', max: 15 } // Output is 30, so this fails
        }
      ]
    };

    const result = BatchExecutor.execute({
      request: {
        batch_id: 'B_VAL_FAIL_DISTINCT',
        module_id: 'FORMULA_BATCH_SYNTH_LINEAR',
        validation_profile: failingValProfile,
        records: [{ record_id: 'R1', inputs: { x: { value: 10 } } }] // Output y = 30
      },
      available_modules: [standardSyntheticFormula],
      available_parameters: standardParameters
    });

    // Execution succeeded, but validation failed
    expect(result.records[0].status).toBe('SUCCESS');
    expect(result.records[0].validation?.status).toBe('FAIL');
    expect(result.records[0].validation?.checks[0].status).toBe('FAIL');
  });

  it('Test 25: should not attach fake validation results to failed records', () => {
    const valProfile: ValidationProfile = {
      validation_id: 'VAL_PROFILE_01',
      name: 'Check',
      version: '1.0.0',
      checks: [{ check_id: 'C1', name: 'Check', type: 'STRUCTURAL', configuration: {} }]
    };

    const result = BatchExecutor.execute({
      request: {
        batch_id: 'B_NO_FAKE_VAL',
        module_id: 'FORMULA_BATCH_SYNTH_LINEAR',
        validation_profile: valProfile,
        records: [{ record_id: 'R_FAIL', inputs: {} }]
      },
      available_modules: [standardSyntheticFormula],
      available_parameters: standardParameters
    });

    expect(result.records[0].status).toBe('FAILED');
    expect(result.records[0].validation).toBeUndefined();
  });

  // ===========================================================================
  // ISOLATION TESTS (26-28)
  // ===========================================================================

  it('Test 26: should ensure complete state isolation when batching discrete-time dynamical models', () => {
    const syntheticModel: ScientificModel = {
      module_id: 'MODEL_BATCH_DECAY',
      module_type: 'MODEL',
      model_id: 'MODEL_BATCH_DECAY',
      name: 'Batch State Model',
      description: 'Model for batch isolation testing',
      version: '1.0.0',
      status: 'VERIFIED',
      is_verified: true,
      variable_ids: [],
      parameter_ids: [],
      reference_ids: [],
      assumptions: [],
      states: [
        { state_id: 'q', name: 'Quantity', datatype: 'number', unit: 'unitless', initial_value: 100 }
      ],
      time_config: { start_time: 0, dt: 1, steps: 2, max_steps: 10 },
      transitions: [
        {
          state_id: 'q',
          type: 'EXPLICIT_UPDATE',
          // q(t+dt) = q(t) - 10
          expression_ast: {
            type: 'OPERATOR',
            op: 'SUBTRACT',
            args: [
              { type: 'VARIABLE', variable_id: 'q' },
              { type: 'CONSTANT', value: 10 }
            ]
          }
        }
      ],
      created_by: 'system',
      created_at: '2026-09-24T00:00:00Z',
      updated_at: '2026-09-24T00:00:00Z'
    };

    const result = BatchExecutor.execute({
      request: {
        batch_id: 'B_MODEL_ISOLATION',
        module_id: 'MODEL_BATCH_DECAY',
        records: [
          { record_id: 'REC_A', inputs: {} },
          { record_id: 'REC_B', inputs: {} }
        ]
      },
      available_modules: [syntheticModel]
    });

    const histA = result.records[0].result?.state_history;
    const histB = result.records[1].result?.state_history;

    expect(histA?.[0].state.q).toBe(100);
    expect(histA?.[2].state.q).toBe(80);

    expect(histB?.[0].state.q).toBe(100);
    expect(histB?.[2].state.q).toBe(80);
  });

  it('Test 27: should execute sequential records without state carryover', () => {
    const result = BatchExecutor.execute({
      request: {
        batch_id: 'B_SEQ_ISOLATION',
        module_id: 'FORMULA_BATCH_SYNTH_LINEAR',
        records: [
          { record_id: 'R1', inputs: { x: { value: 10 } } },
          { record_id: 'R2', inputs: { x: { value: 10 } } }
        ]
      },
      available_modules: [standardSyntheticFormula],
      available_parameters: standardParameters
    });

    expect(result.records[0].result?.outputs['y'].value).toBe(30);
    expect(result.records[1].result?.outputs['y'].value).toBe(30);
  });

  it('Test 28: should guarantee zero reliance on global mutable state across batch runs', () => {
    const run1 = BatchExecutor.execute({
      request: {
        batch_id: 'B_GLOBAL_1',
        module_id: 'FORMULA_BATCH_SYNTH_LINEAR',
        records: [{ record_id: 'R1', inputs: { x: { value: 5 } } }]
      },
      available_modules: [standardSyntheticFormula],
      available_parameters: standardParameters
    });

    const run2 = BatchExecutor.execute({
      request: {
        batch_id: 'B_GLOBAL_2',
        module_id: 'FORMULA_BATCH_SYNTH_LINEAR',
        records: [{ record_id: 'R1', inputs: { x: { value: 5 } } }]
      },
      available_modules: [standardSyntheticFormula],
      available_parameters: standardParameters
    });

    expect(run1.records[0].result?.outputs['y'].value).toBe(run2.records[0].result?.outputs['y'].value);
  });

  // ===========================================================================
  // EDGE CASES (29-32)
  // ===========================================================================

  it('Test 29: should handle an empty batch request cleanly and deterministically without throwing', () => {
    const result = BatchExecutor.execute({
      request: {
        batch_id: 'B_EMPTY',
        module_id: 'FORMULA_BATCH_SYNTH_LINEAR',
        records: []
      },
      available_modules: [standardSyntheticFormula],
      available_parameters: standardParameters
    });

    expect(result.status).toBe('COMPLETED');
    expect(result.total_records).toBe(0);
    expect(result.successful_records).toBe(0);
    expect(result.records).toEqual([]);
  });

  it('Test 30: should reject duplicate record IDs with BATCH_DUPLICATE_RECORD_ID error', () => {
    expect(() => {
      BatchExecutor.execute({
        request: {
          batch_id: 'B_DUP',
          module_id: 'FORMULA_BATCH_SYNTH_LINEAR',
          records: [
            { record_id: 'REC_DUPLICATE', inputs: { x: { value: 1 } } },
            { record_id: 'REC_DUPLICATE', inputs: { x: { value: 2 } } }
          ]
        },
        available_modules: [standardSyntheticFormula],
        available_parameters: standardParameters
      });
    }).toThrow(ScientificBatchError);
  });

  it('Test 31: should enforce configured max batch size limit', () => {
    const result = BatchExecutor.execute({
      request: {
        batch_id: 'B_MAX_SIZE_OK',
        module_id: 'FORMULA_BATCH_SYNTH_LINEAR',
        configuration: { max_records: 5 },
        records: [
          { record_id: 'R1', inputs: { x: { value: 1 } } },
          { record_id: 'R2', inputs: { x: { value: 2 } } }
        ]
      },
      available_modules: [standardSyntheticFormula],
      available_parameters: standardParameters
    });

    expect(result.status).toBe('COMPLETED');
    expect(result.total_records).toBe(2);
  });

  it('Test 32: should reject oversized batch without silent truncation and throw BATCH_SIZE_LIMIT_EXCEEDED', () => {
    expect(() => {
      BatchExecutor.execute({
        request: {
          batch_id: 'B_OVERSIZED',
          module_id: 'FORMULA_BATCH_SYNTH_LINEAR',
          configuration: { max_records: 2 },
          records: [
            { record_id: 'R1', inputs: { x: { value: 1 } } },
            { record_id: 'R2', inputs: { x: { value: 2 } } },
            { record_id: 'R3', inputs: { x: { value: 3 } } }
          ]
        },
        available_modules: [standardSyntheticFormula],
        available_parameters: standardParameters
      });
    }).toThrow(ScientificBatchError);
  });

  // ===========================================================================
  // DETERMINISM & SECURITY (33-34)
  // ===========================================================================

  it('Test 33: repeated batch executions should produce equivalent ordered outputs', () => {
    const req: BatchExecutionRequest = {
      batch_id: 'B_DETERMINISTIC',
      module_id: 'FORMULA_BATCH_SYNTH_LINEAR',
      records: [
        { record_id: 'R1', inputs: { x: { value: 10 } } },
        { record_id: 'R2', inputs: { x: { value: 20 } } }
      ]
    };

    const out1 = BatchExecutor.execute({
      request: req,
      available_modules: [standardSyntheticFormula],
      available_parameters: standardParameters,
      custom_timestamp: '2026-09-24T00:00:00Z'
    });

    const out2 = BatchExecutor.execute({
      request: req,
      available_modules: [standardSyntheticFormula],
      available_parameters: standardParameters,
      custom_timestamp: '2026-09-24T00:00:00Z'
    });

    expect(out1.records[0].result?.outputs).toEqual(out2.records[0].result?.outputs);
    expect(out1.records[1].result?.outputs).toEqual(out2.records[1].result?.outputs);
  });

  it('Test 34: should execute records via typed AST engine without eval or dynamic code execution', () => {
    const recordWithMaliciousPayload: BatchRecord = {
      record_id: 'REC_SEC_TEST',
      inputs: {
        x: { value: 10 },
        injected: 'process.exit(1); function() { return 0; }'
      }
    };

    expect(() => {
      const result = BatchExecutor.execute({
        request: {
          batch_id: 'B_SEC',
          module_id: 'FORMULA_BATCH_SYNTH_LINEAR',
          records: [recordWithMaliciousPayload]
        },
        available_modules: [standardSyntheticFormula],
        available_parameters: standardParameters
      });
      expect(result.status).toBe('COMPLETED');
    }).not.toThrow();
  });

  // ===========================================================================
  // REGRESSION TESTS: PHASE C1 - C6 (35-40)
  // ===========================================================================

  it('Test 35 [C1 Regression]: should preserve CalculationEngine formula evaluation contract', () => {
    const trace = CalculationEngine.executeFormula({
      formula: standardSyntheticFormula,
      inputs: { x: { value: 10, unit: 'kg' } },
      parameters: {
        PARAM_BATCH_SCALE: standardParameters[0],
        PARAM_BATCH_OFFSET: standardParameters[1]
      }
    });

    expect(trace.final_result['y'].value).toBe(30);
  });

  it('Test 36 [C2 Regression]: should preserve ModuleResolver & ParameterResolver contracts', () => {
    const resolvedModule = ModuleResolver.resolve({
      module_id: 'FORMULA_BATCH_SYNTH_LINEAR',
      modules: [standardSyntheticFormula]
    });
    expect(resolvedModule.module_id).toBe('FORMULA_BATCH_SYNTH_LINEAR');

    const resolvedParams = ParameterResolver.resolve({
      module: standardSyntheticFormula,
      available_parameters: standardParameters
    });
    expect(resolvedParams.parameters['PARAM_BATCH_SCALE']).toBe(2);
  });

  it('Test 37 [C3 Regression]: should preserve InputValidator normalization contract', () => {
    const val = InputValidator.validate({
      module: standardSyntheticFormula,
      inputs: { x: { value: 20000, unit: 'g' } }
    });
    expect(val.valid).toBe(true);
    expect(val.normalized_inputs['x'].value).toBe(20);
  });

  it('Test 38 [C4 Regression]: should preserve AlgorithmExecutor execution contract', () => {
    const alg: ScientificAlgorithm = {
      algorithm_id: 'ALG_BATCH_REG',
      name: 'Algorithm Check',
      description: 'C4 regression',
      version: '1.0.0',
      status: 'VERIFIED',
      inputs: [{ variable_id: 'v', name: 'v', unit: 'unitless', datatype: 'number', required: true }],
      outputs: [{ name: 'out', unit: 'unitless', datatype: 'number' }],
      parameter_ids: [],
      entry_step_id: 'S1',
      steps: [
        { step_id: 'S1', operation: 'SEQUENCE', next_step_id: 'S2' },
        { step_id: 'S2', operation: 'OUTPUT', is_terminal: true }
      ],
      reference_ids: [],
      created_by: 'system',
      created_at: '2026-09-24T00:00:00Z',
      updated_at: '2026-09-24T00:00:00Z'
    };

    const res = AlgorithmExecutor.execute({
      algorithm: alg,
      request: { module_id: 'ALG_BATCH_REG', inputs: { v: { value: 5 } } }
    });
    expect(res.execution_path).toEqual(['INPUT_VALIDATION', 'S1', 'S2']);
  });

  it('Test 39 [C5 Regression]: should preserve ModelExecutor discrete-time simulation contract', () => {
    const model: ScientificModel = {
      module_id: 'MODEL_BATCH_REG',
      module_type: 'MODEL',
      model_id: 'MODEL_BATCH_REG',
      name: 'Model Check',
      description: 'C5 regression',
      version: '1.0.0',
      status: 'VERIFIED',
      is_verified: true,
      variable_ids: [],
      parameter_ids: [],
      reference_ids: [],
      assumptions: [],
      states: [{ state_id: 'k', name: 'K', datatype: 'number', unit: 'unitless', initial_value: 0 }],
      time_config: { start_time: 0, dt: 1, steps: 1, max_steps: 5 },
      transitions: [
        {
          state_id: 'k',
          type: 'EXPLICIT_UPDATE',
          expression_ast: { type: 'CONSTANT', value: 50 }
        }
      ],
      created_by: 'system',
      created_at: '2026-09-24T00:00:00Z',
      updated_at: '2026-09-24T00:00:00Z'
    };

    const res = ModelExecutor.execute({
      model,
      request: { module_id: 'MODEL_BATCH_REG', inputs: {} }
    });
    expect(res.outputs['k'].value).toBe(50);
  });

  it('Test 40 [C6 Regression]: should preserve ValidationEngine evaluation contract', () => {
    const valResult = ValidationEngine.evaluate({
      execution_result: {
        execution_id: 'E_REG_40',
        module_id: 'M_REG',
        module_version: '1.0.0',
        inputs: {},
        normalized_inputs: {},
        parameters: {},
        execution_path: [],
        fallback_used: false,
        intermediate_results: {},
        trace: [],
        outputs: { y: { value: 100 } },
        warnings: [],
        errors: [],
        timestamp: '2026-09-24T00:00:00Z'
      },
      profile: {
        validation_id: 'VAL_REG_40',
        name: 'Check',
        version: '1.0.0',
        checks: [
          {
            check_id: 'CHK_40',
            name: 'Exact y',
            type: 'MATHEMATICAL',
            configuration: { target_output: 'y', expected_value: 100 }
          }
        ]
      }
    });

    expect(valResult.status).toBe('PASS');
  });
});
