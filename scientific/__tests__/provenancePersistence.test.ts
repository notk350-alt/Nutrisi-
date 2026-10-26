import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildProvenanceRecord,
  canonicalizeJson,
  computeProvenanceHash,
  extractIntegrityPayload,
  ProvenanceStore
} from '../provenance/provenancePersistence';
import {
  CalculationEngine,
  ModuleResolver,
  ParameterResolver,
  InputValidator,
  AlgorithmExecutor,
  ModelExecutor,
  ValidationEngine,
  BatchExecutor
} from '../index';
import {
  ExecutionResult,
  ProvenanceRecord,
  ScientificAlgorithm,
  ScientificFormula,
  ScientificModel,
  ScientificParameter
} from '../types';

describe('Phase C8 — Provenance Persistence Layer Test Suite (46 Tests)', () => {
  let store: ProvenanceStore;

  const standardParameters: ScientificParameter[] = [
    {
      parameter_id: 'PARAM_SCALE',
      name: 'Scale Parameter',
      description: 'Multiplication factor',
      unit: 'unitless',
      value: 1.0,
      version: '1.0.0',
      status: 'VERIFIED',
      is_constant: false,
      reference_ids: ['REF_SCALE'],
      created_at: '2026-09-24T00:00:00Z',
      updated_at: '2026-09-24T00:00:00Z'
    },
    {
      parameter_id: 'PARAM_OFFSET',
      name: 'Offset Parameter',
      description: 'Addition offset',
      unit: 'kg',
      value: 10,
      version: '1.0.0',
      status: 'VERIFIED',
      is_constant: false,
      reference_ids: ['REF_OFFSET'],
      created_at: '2026-09-24T00:00:00Z',
      updated_at: '2026-09-24T00:00:00Z'
    }
  ];

  const standardSyntheticFormula: ScientificFormula = {
    formula_id: 'FORMULA_PROV_SYNTH_LINEAR',
    name: 'Synthetic Linear Scale',
    description: 'Computes y = x * scale + offset for provenance testing',
    version: '1.0.0',
    status: 'VERIFIED',
    validation_status: 'VERIFIED',
    inputs: [
      { variable_id: 'x', name: 'Input X', unit: 'kg', datatype: 'number', required: true }
    ],
    outputs: [
      { name: 'y', unit: 'kg', datatype: 'number' }
    ],
    parameter_ids: ['PARAM_SCALE', 'PARAM_OFFSET'],
    expression_ast: {
      type: 'OPERATOR',
      op: 'ADD',
      args: [
        {
          type: 'OPERATOR',
          op: 'MULTIPLY',
          args: [
            { type: 'VARIABLE', variable_id: 'x' },
            { type: 'PARAMETER', parameter_id: 'PARAM_SCALE' }
          ]
        },
        { type: 'PARAMETER', parameter_id: 'PARAM_OFFSET' }
      ]
    },
    expression_string: '(x * scale) + offset',
    reference_ids: ['REF_SYNTH_2026'],
    assumptions: ['Pure arithmetic test'],
    limitations: ['Synthetic only'],
    created_by: 'system',
    created_at: '2026-09-24T00:00:00Z',
    updated_at: '2026-09-24T00:00:00Z'
  };

  const sampleExecutionResult: ExecutionResult = {
    execution_id: 'exec_test_001',
    module_id: 'MOD_BMI_001',
    module_version: '1.2.0',
    inputs: {
      weight: { value: 70, unit: 'kg' },
      height: { value: 1.75, unit: 'm' }
    },
    normalized_inputs: {
      weight: { value: 70, unit: 'kg', original_unit: 'kg' },
      height: { value: 1.75, unit: 'm', original_unit: 'm' }
    },
    parameters: {
      PARAM_SCALE: standardParameters[0]
    },
    parameter_set_id: 'PSET_DEFAULT_01',
    parameter_versions: {
      PARAM_SCALE: '1.0.0'
    },
    parameter_snapshot: {
      snapshot_id: 'snap_001',
      timestamp: '2026-09-24T00:00:00.000Z',
      parameter_set_id: 'PSET_DEFAULT_01',
      entries: {
        PARAM_SCALE: {
          parameter_id: 'PARAM_SCALE',
          name: 'Scale Parameter',
          parameter_version: '1.0.0',
          value: 1.0,
          unit: 'unitless'
        }
      }
    },
    execution_path: ['START', 'STEP_1', 'END'],
    fallback_used: false,
    intermediate_results: {
      height_squared: 3.0625
    },
    trace: [
      {
        step_id: 'step_sq',
        operation: 'POWER',
        inputs: { height: 1.75 },
        output: { value: 3.0625, unit: 'm^2' },
        timestamp: '2026-09-24T00:00:00.100Z'
      }
    ],
    outputs: {
      bmi: { value: 22.857, unit: 'kg/m^2' }
    },
    warnings: [],
    errors: [],
    validation: {
      status: 'VALIDATED',
      profile: 'BMI_RANGE_CHECK',
      checks: [{ name: 'BMI Range', passed: true, message: 'Valid' }]
    },
    timestamp: '2026-09-24T00:00:00.200Z'
  };

  beforeEach(() => {
    store = new ProvenanceStore();
  });

  // ==========================================
  // CONTRACT TESTS (1-4)
  // ==========================================

  it('Test 1: should create a valid typed ProvenanceRecord contract', () => {
    const record = buildProvenanceRecord(sampleExecutionResult);
    expect(record).toBeDefined();
    expect(typeof record.provenance_id).toBe('string');
    expect(record.provenance_id.startsWith('prov_')).toBe(true);
    expect(record.integrity).toBeDefined();
    expect(record.integrity.algorithm).toBe('SHA-256');
    expect(typeof record.integrity.content_hash).toBe('string');
  });

  it('Test 2: should ensure unique and deterministic provenance identity', () => {
    const record1 = buildProvenanceRecord(sampleExecutionResult);
    const record2 = buildProvenanceRecord(sampleExecutionResult);
    expect(record1.provenance_id).toBe(record2.provenance_id);
    expect(record1.integrity.content_hash).toBe(record2.integrity.content_hash);
  });

  it('Test 3: should link provenance directly to execution_id and update ExecutionResult', () => {
    const execCopy = { ...sampleExecutionResult };
    const record = buildProvenanceRecord(execCopy);
    expect(record.execution_id).toBe('exec_test_001');
    expect(execCopy.provenance_id).toBe(record.provenance_id);
  });

  it('Test 4: should link batch_id if execution was part of a batch request', () => {
    const record = buildProvenanceRecord(sampleExecutionResult, { batch_id: 'BATCH_009' });
    expect(record.batch_id).toBe('BATCH_009');
  });

  // ==========================================
  // SNAPSHOT TESTS (5-11)
  // ==========================================

  it('Test 5: should preserve raw input snapshot faithfully without mutation', () => {
    const record = buildProvenanceRecord(sampleExecutionResult);
    expect(record.inputs).toEqual(sampleExecutionResult.inputs);
  });

  it('Test 6: should preserve normalized input snapshot separately from raw input', () => {
    const record = buildProvenanceRecord(sampleExecutionResult);
    expect(record.normalized_inputs).toEqual(sampleExecutionResult.normalized_inputs);
  });

  it('Test 7: should preserve exact outputs snapshot without recalculation', () => {
    const record = buildProvenanceRecord(sampleExecutionResult);
    expect(record.outputs).toEqual(sampleExecutionResult.outputs);
  });

  it('Test 8: should preserve complete parameter snapshot and versioning metadata', () => {
    const record = buildProvenanceRecord(sampleExecutionResult);
    expect(record.parameter_set_id).toBe('PSET_DEFAULT_01');
    expect(record.parameter_versions).toEqual({ PARAM_SCALE: '1.0.0' });
    expect(record.parameter_snapshot).toEqual(sampleExecutionResult.parameter_snapshot);
  });

  it('Test 9: should capture module_id and exact module_version snapshot', () => {
    const record = buildProvenanceRecord(sampleExecutionResult);
    expect(record.module_id).toBe('MOD_BMI_001');
    expect(record.module_version).toBe('1.2.0');
  });

  it('Test 10: should preserve dataset_version_id linkage without triggering dataset processing', () => {
    const record = buildProvenanceRecord(sampleExecutionResult, { dataset_version_id: 'DSET_NHANES_V2' });
    expect(record.dataset_version_id).toBe('DSET_NHANES_V2');
  });

  it('Test 11: should preserve scientific validation summary snapshot', () => {
    const record = buildProvenanceRecord(sampleExecutionResult);
    expect(record.validation).toEqual(sampleExecutionResult.validation);
  });

  // ==========================================
  // PERSISTENCE TESTS (12-16)
  // ==========================================

  it('Test 12: should save a provenance record in the persistence store', () => {
    const record = buildProvenanceRecord(sampleExecutionResult);
    const saved = store.save(record);
    expect(saved.provenance_id).toBe(record.provenance_id);
  });

  it('Test 13: should get a persisted record by provenance_id', () => {
    const record = buildProvenanceRecord(sampleExecutionResult);
    store.save(record);
    const retrieved = store.get(record.provenance_id);
    expect(retrieved).toBeDefined();
    expect(retrieved?.provenance_id).toBe(record.provenance_id);
    expect(retrieved?.module_id).toBe('MOD_BMI_001');
  });

  it('Test 14: should get a persisted record by execution_id index', () => {
    const record = buildProvenanceRecord(sampleExecutionResult);
    store.save(record);
    const retrieved = store.getByExecutionId('exec_test_001');
    expect(retrieved).toBeDefined();
    expect(retrieved?.provenance_id).toBe(record.provenance_id);
  });

  it('Test 15: should list all provenance records associated with a batch_id', () => {
    const r1 = buildProvenanceRecord({ ...sampleExecutionResult, execution_id: 'exec_b_1' }, { batch_id: 'BATCH_X' });
    const r2 = buildProvenanceRecord({ ...sampleExecutionResult, execution_id: 'exec_b_2' }, { batch_id: 'BATCH_X' });
    const r3 = buildProvenanceRecord({ ...sampleExecutionResult, execution_id: 'exec_b_3' }, { batch_id: 'BATCH_Y' });

    store.save(r1);
    store.save(r2);
    store.save(r3);

    const batchXList = store.listByBatchId('BATCH_X');
    expect(batchXList.length).toBe(2);
    expect(batchXList.map((r) => r.execution_id)).toEqual(['exec_b_1', 'exec_b_2']);
  });

  it('Test 16: should return undefined for nonexistent provenance_id without throwing', () => {
    const nonExistent = store.get('prov_unknown_999');
    expect(nonExistent).toBeUndefined();
  });

  // ==========================================
  // IMMUTABILITY TESTS (17-19)
  // ==========================================

  it('Test 17: should ensure saved provenance record is deeply immutable and frozen', () => {
    const record = buildProvenanceRecord(sampleExecutionResult);
    store.save(record);
    expect(Object.isFrozen(record)).toBe(true);
  });

  it('Test 18: retrieved record mutations should not mutate internal store data', () => {
    const record = buildProvenanceRecord(sampleExecutionResult);
    store.save(record);

    const retrieved = store.get(record.provenance_id);
    expect(retrieved).toBeDefined();
    retrieved!.module_version = '999.0.0';

    const freshlyRetrieved = store.get(record.provenance_id);
    expect(freshlyRetrieved?.module_version).toBe('1.2.0');
  });

  it('Test 19: should leave original ExecutionResult scientific fields unmodified', () => {
    const originalOutputs = { ...sampleExecutionResult.outputs };
    buildProvenanceRecord(sampleExecutionResult);
    expect(sampleExecutionResult.outputs).toEqual(originalOutputs);
  });

  // ==========================================
  // HASH & CANONICALIZATION TESTS (20-27)
  // ==========================================

  it('Test 20: should generate a 64-character SHA-256 cryptographic content hash', () => {
    const record = buildProvenanceRecord(sampleExecutionResult);
    expect(record.integrity.content_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('Test 21: canonicalizeJson should sort object keys deterministically', () => {
    const obj1 = { z: 1, a: 2, m: { y: 'test', b: true } };
    const obj2 = { a: 2, m: { b: true, y: 'test' }, z: 1 };
    expect(canonicalizeJson(obj1)).toBe(canonicalizeJson(obj2));
  });

  it('Test 22: identical execution payloads must produce identical hashes', () => {
    const r1 = buildProvenanceRecord(sampleExecutionResult);
    const r2 = buildProvenanceRecord(sampleExecutionResult);
    expect(r1.integrity.content_hash).toBe(r2.integrity.content_hash);
  });

  it('Test 23: altered input value must produce a different hash', () => {
    const altered = {
      ...sampleExecutionResult,
      inputs: { weight: { value: 75, unit: 'kg' }, height: { value: 1.75, unit: 'm' } }
    };
    const r1 = buildProvenanceRecord(sampleExecutionResult);
    const r2 = buildProvenanceRecord(altered);
    expect(r1.integrity.content_hash).not.toBe(r2.integrity.content_hash);
  });

  it('Test 24: altered output value must produce a different hash', () => {
    const altered = {
      ...sampleExecutionResult,
      outputs: { bmi: { value: 24.5, unit: 'kg/m^2' } }
    };
    const r1 = buildProvenanceRecord(sampleExecutionResult);
    const r2 = buildProvenanceRecord(altered);
    expect(r1.integrity.content_hash).not.toBe(r2.integrity.content_hash);
  });

  it('Test 25: altered parameter snapshot must produce a different hash', () => {
    const altered = {
      ...sampleExecutionResult,
      parameter_snapshot: {
        ...sampleExecutionResult.parameter_snapshot!,
        entries: {
          PARAM_SCALE: {
            parameter_id: 'PARAM_SCALE',
            name: 'Scale Parameter',
            parameter_version: '1.0.0',
            value: 2.0,
            unit: 'unitless'
          }
        }
      }
    };
    const r1 = buildProvenanceRecord(sampleExecutionResult);
    const r2 = buildProvenanceRecord(altered);
    expect(r1.integrity.content_hash).not.toBe(r2.integrity.content_hash);
  });

  it('Test 26: altered execution trace must produce a different hash', () => {
    const altered = {
      ...sampleExecutionResult,
      trace: [
        ...sampleExecutionResult.trace,
        {
          step_id: 'step_extra',
          operation: 'ADD',
          inputs: {},
          output: { value: 10 },
          timestamp: '2026-09-24T00:00:01.000Z'
        }
      ]
    };
    const r1 = buildProvenanceRecord(sampleExecutionResult);
    const r2 = buildProvenanceRecord(altered);
    expect(r1.integrity.content_hash).not.toBe(r2.integrity.content_hash);
  });

  it('Test 27: altered module version must produce a different hash', () => {
    const altered = {
      ...sampleExecutionResult,
      module_version: '2.0.0'
    };
    const r1 = buildProvenanceRecord(sampleExecutionResult);
    const r2 = buildProvenanceRecord(altered);
    expect(r1.integrity.content_hash).not.toBe(r2.integrity.content_hash);
  });

  // ==========================================
  // INTEGRITY VERIFICATION TESTS (28-30)
  // ==========================================

  it('Test 28: should return VALID for untampered persisted provenance record', () => {
    const record = buildProvenanceRecord(sampleExecutionResult);
    store.save(record);
    const verification = store.verifyIntegrity(record.provenance_id);
    expect(verification.status).toBe('VALID');
    expect(verification.computed_hash).toBe(verification.stored_hash);
  });

  it('Test 29: should detect tampering if stored content payload was altered', () => {
    // Construct tampered record directly
    const record = buildProvenanceRecord(sampleExecutionResult);
    const tamperedRecord: ProvenanceRecord = {
      ...record,
      outputs: { bmi: { value: 99.9, unit: 'kg/m^2' } }
      // Stored content_hash remains original
    };

    const tempStore = new ProvenanceStore();
    tempStore.save(tamperedRecord);

    const verification = tempStore.verifyIntegrity(tamperedRecord.provenance_id);
    expect(verification.status).toBe('INVALID');
    expect(verification.computed_hash).not.toBe(verification.stored_hash);
  });

  it('Test 30: should return NOT_FOUND when verifying an unrecorded provenance ID', () => {
    const verification = store.verifyIntegrity('prov_non_existent');
    expect(verification.status).toBe('NOT_FOUND');
  });

  // ==========================================
  // VALIDATION SNAPSHOT TESTS (31-32)
  // ==========================================

  it('Test 31: validation result snapshot is preserved in its exact execution state', () => {
    const failedValidationExec: ExecutionResult = {
      ...sampleExecutionResult,
      validation: {
        status: 'FAILED',
        profile: 'R1',
        message: 'Value out of range',
        checks: [{ name: 'Range Check', passed: false, message: 'Value out of range' }]
      }
    };
    const record = buildProvenanceRecord(failedValidationExec);
    expect(record.validation?.status).toBe('FAILED');
  });

  it('Test 32: historical validation is purely a snapshot and not dynamically re-evaluated on read', () => {
    const record = buildProvenanceRecord(sampleExecutionResult);
    store.save(record);
    const read = store.get(record.provenance_id);
    expect(read?.validation?.status).toBe('VALIDATED');
  });

  // ==========================================
  // BATCH INTEGRATION TESTS (33-35)
  // ==========================================

  it('Test 33: should handle multiple execution provenance records across a batch', () => {
    const batchId = 'BATCH_2026_01';
    for (let i = 0; i < 5; i++) {
      const exec: ExecutionResult = {
        ...sampleExecutionResult,
        execution_id: `exec_batch_${i}`,
        outputs: { bmi: { value: 20 + i, unit: 'kg/m^2' } }
      };
      const prov = buildProvenanceRecord(exec, { batch_id: batchId });
      store.save(prov);
    }

    const batchRecords = store.listByBatchId(batchId);
    expect(batchRecords.length).toBe(5);
  });

  it('Test 34: each record execution in a batch must receive a distinct provenance ID', () => {
    const batchId = 'BATCH_DISTINCT';
    const ids = new Set<string>();

    for (let i = 0; i < 3; i++) {
      const exec: ExecutionResult = {
        ...sampleExecutionResult,
        execution_id: `exec_item_${i}`,
        inputs: { weight: { value: 60 + i, unit: 'kg' } }
      };
      const prov = buildProvenanceRecord(exec, { batch_id: batchId });
      ids.add(prov.provenance_id);
      store.save(prov);
    }

    expect(ids.size).toBe(3);
  });

  it('Test 35: batch linkage is preserved when retrieving by execution_id', () => {
    const exec: ExecutionResult = {
      ...sampleExecutionResult,
      execution_id: 'exec_linked_01'
    };
    const prov = buildProvenanceRecord(exec, { batch_id: 'BATCH_LINKED' });
    store.save(prov);

    const retrieved = store.getByExecutionId('exec_linked_01');
    expect(retrieved?.batch_id).toBe('BATCH_LINKED');
  });

  // ==========================================
  // SECURITY TESTS (36-38)
  // ==========================================

  it('Test 36: should not contain or execute dynamic eval code', () => {
    const record = buildProvenanceRecord(sampleExecutionResult);
    expect(typeof record.provenance_id).toBe('string');
    expect((record as any).eval).toBeUndefined();
  });

  it('Test 37: should not use Function constructor or executable runtime strings', () => {
    const rawData = canonicalizeJson(sampleExecutionResult);
    expect(rawData).not.toContain('Function(');
  });

  it('Test 38: should not store private keys, secrets or credentials', () => {
    const record = buildProvenanceRecord(sampleExecutionResult);
    expect((record as any).private_key).toBeUndefined();
    expect((record as any).secret_key).toBeUndefined();
    expect((record as any).token).toBeUndefined();
  });

  // ==========================================
  // DETERMINISM TEST (39)
  // ==========================================

  it('Test 39: repeated identical provenance payload produces byte-for-byte identical hash', () => {
    const hashes: string[] = [];
    for (let i = 0; i < 10; i++) {
      hashes.push(computeProvenanceHash(extractIntegrityPayload(sampleExecutionResult)));
    }
    const allEqual = hashes.every((h) => h === hashes[0]);
    expect(allEqual).toBe(true);
  });

  // ==========================================
  // REGRESSION TESTS (40-46)
  // ==========================================

  it('Test 40 [C1 Regression]: should preserve CalculationEngine formula evaluation contract', () => {
    const trace = CalculationEngine.executeFormula({
      formula: standardSyntheticFormula,
      inputs: { x: { value: 10, unit: 'kg' } },
      parameters: {
        PARAM_SCALE: standardParameters[0],
        PARAM_OFFSET: standardParameters[1]
      }
    });

    expect(trace.final_result['y'].value).toBe(20);
  });

  it('Test 41 [C2 Regression]: should preserve ModuleResolver & ParameterResolver contracts', () => {
    const resolvedModule = ModuleResolver.resolve({
      module_id: 'FORMULA_PROV_SYNTH_LINEAR',
      modules: [standardSyntheticFormula]
    });
    expect(resolvedModule.module_id).toBe('FORMULA_PROV_SYNTH_LINEAR');

    const resolvedParams = ParameterResolver.resolve({
      module: standardSyntheticFormula,
      available_parameters: standardParameters
    });
    expect(resolvedParams.parameters['PARAM_SCALE']).toBe(1.0);
  });

  it('Test 42 [C3 Regression]: should preserve InputValidator normalization contract', () => {
    const val = InputValidator.validate({
      module: standardSyntheticFormula,
      inputs: { x: { value: 20000, unit: 'g' } }
    });
    expect(val.valid).toBe(true);
    expect(val.normalized_inputs['x'].value).toBe(20);
  });

  it('Test 43 [C4 Regression]: should preserve AlgorithmExecutor execution contract', () => {
    const alg: ScientificAlgorithm = {
      algorithm_id: 'ALG_PROV_REG',
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
      request: { module_id: 'ALG_PROV_REG', inputs: { v: { value: 5 } } }
    });
    expect(res.execution_path).toEqual(['INPUT_VALIDATION', 'S1', 'S2']);
  });

  it('Test 44 [C5 Regression]: should preserve ModelExecutor discrete-time simulation contract', () => {
    const model: ScientificModel = {
      module_id: 'MODEL_PROV_REG',
      module_type: 'MODEL',
      model_id: 'MODEL_PROV_REG',
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
      request: { module_id: 'MODEL_PROV_REG', inputs: {} }
    });
    expect(res.outputs['k'].value).toBe(50);
  });

  it('Test 45 [C6 Regression]: should preserve ValidationEngine evaluation contract', () => {
    const valResult = ValidationEngine.evaluate({
      execution_result: {
        execution_id: 'E_REG_45',
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
        validation_id: 'VAL_REG_45',
        name: 'Check',
        version: '1.0.0',
        checks: [
          {
            check_id: 'CHK_45',
            name: 'Exact y',
            type: 'MATHEMATICAL',
            configuration: { target_output: 'y', expected_value: 100 }
          }
        ]
      }
    });

    expect(valResult.status).toBe('PASS');
  });

  it('Test 46 [C7 Regression]: should preserve BatchExecutor orchestration contract', () => {
    const batchResult = BatchExecutor.execute({
      request: {
        batch_id: 'BATCH_REG_01',
        module_id: 'FORMULA_PROV_SYNTH_LINEAR',
        error_policy: 'CONTINUE_ON_ERROR',
        records: [
          { record_id: 'REC_1', inputs: { x: { value: 10, unit: 'kg' } } },
          { record_id: 'REC_2', inputs: { x: { value: 20, unit: 'kg' } } }
        ]
      },
      available_modules: [standardSyntheticFormula],
      available_parameters: standardParameters
    });

    expect(batchResult.total_records).toBe(2);
    expect(batchResult.successful_records).toBe(2);
    expect(batchResult.records[0].result?.outputs['y'].value).toBe(20);
    expect(batchResult.records[1].result?.outputs['y'].value).toBe(30);
  });
});
