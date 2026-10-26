import { describe, it, expect, beforeEach } from 'vitest';
import {
  createDataset,
  DatasetContractValidator,
  DatasetStore,
  VALID_DATASET_PURPOSES,
  VALID_DATASET_SENSITIVITIES,
  VALID_DATASET_SOURCE_TYPES,
  VALID_DATASET_STATUSES
} from '../data/datasetContract';
import {
  Dataset,
  DatasetPurpose,
  DatasetSensitivity,
  DatasetSourceType,
  DatasetStatus,
  ScientificDatasetError,
  ScientificAlgorithm,
  ScientificFormula,
  ScientificModel,
  ScientificParameter
} from '../types';
import {
  CalculationEngine,
  ModuleResolver,
  ParameterResolver,
  InputValidator,
  AlgorithmExecutor,
  ModelExecutor,
  ValidationEngine,
  BatchExecutor,
  buildProvenanceRecord,
  ProvenanceStore
} from '../index';

describe('Phase D1 — Scientific Data Layer: Dataset Contract Test Suite', () => {
  let store: DatasetStore;

  const validSampleParams = {
    dataset_id: 'DS_ANTHRO_2026',
    name: 'Anthropometry Study Cohort 2026',
    description: 'De-identified baseline observational anthropometric metrics',
    owner_id: 'usr_researcher_01',
    project_id: 'proj_metabolic_sim',
    purpose: 'RESEARCH' as DatasetPurpose,
    source: {
      type: 'PRIMARY_COLLECTION' as DatasetSourceType,
      name: 'Metabolic Clinical Trial Lab',
      description: 'Standardized baseline clinic visits',
      location: 'Jakarta Clinical Research Center',
      accessed_at: '2026-09-24T00:00:00.000Z'
    },
    population: {
      description: 'Adult cohort aged 18-65 without acute metabolic decompensation',
      age_range: { min: 18, max: 65, unit: 'years' },
      sex_scope: 'ALL',
      geographic_scope: 'Indonesia',
      sample_size: 500,
      inclusion_notes: 'BMI >= 18.5, fasting glucose recorded',
      exclusion_notes: 'Pregnancy, acute hospitalization'
    },
    context: {
      setting: 'Outpatient Clinic',
      collection_method: 'Calibrated digital scale and stadiometer',
      measurement_context: 'Morning fasting state',
      clinical_context: 'Metabolic syndrome risk factor profiling',
      research_context: 'Longitudinal nutritional modeling study'
    },
    temporal_scope: {
      start_date: '2026-01-01',
      end_date: '2026-06-30',
      timezone: 'Asia/Jakarta',
      description: 'Six-month baseline enrollment window'
    },
    sensitivity: 'INTERNAL' as DatasetSensitivity,
    status: 'ACTIVE' as DatasetStatus,
    created_at: '2026-09-24T00:00:00.000Z',
    updated_at: '2026-09-24T00:00:00.000Z',
    metadata: {
      study_protocol: 'PROTO-2026-B',
      ethics_approval: 'IRB-2026-088'
    }
  };

  beforeEach(() => {
    store = new DatasetStore();
  });

  // ===========================================================================
  // 1. CONTRACT TESTS
  // ===========================================================================

  it('Test 1: should construct a valid typed Dataset entity with mandatory and optional metadata', () => {
    const ds = createDataset(validSampleParams);
    expect(ds.dataset_id).toBe('DS_ANTHRO_2026');
    expect(ds.name).toBe('Anthropometry Study Cohort 2026');
    expect(ds.owner_id).toBe('usr_researcher_01');
    expect(ds.project_id).toBe('proj_metabolic_sim');
    expect(ds.purpose).toBe('RESEARCH');
    expect(ds.source.type).toBe('PRIMARY_COLLECTION');
    expect(ds.status).toBe('ACTIVE');
    expect(ds.sensitivity).toBe('INTERNAL');
    expect(ds.created_at).toBe('2026-09-24T00:00:00.000Z');
  });

  it('Test 2: should reject empty or whitespace dataset_id with DATASET_EMPTY_ID', () => {
    expect(() =>
      createDataset({ ...validSampleParams, dataset_id: '' })
    ).toThrowError(ScientificDatasetError);

    expect(() =>
      createDataset({ ...validSampleParams, dataset_id: '   ' })
    ).toThrowError(/dataset_id is required/);
  });

  it('Test 3: should reject empty name with DATASET_EMPTY_NAME', () => {
    expect(() =>
      createDataset({ ...validSampleParams, name: '' })
    ).toThrowError(/name is required/);

    expect(() =>
      createDataset({ ...validSampleParams, name: '   ' })
    ).toThrowError(/name is required/);
  });

  it('Test 4: should reject empty owner_id with DATASET_EMPTY_OWNER', () => {
    expect(() =>
      createDataset({ ...validSampleParams, owner_id: '' })
    ).toThrowError(/owner_id is required/);
  });

  it('Test 5: should accept all valid DatasetPurpose values', () => {
    for (const purpose of VALID_DATASET_PURPOSES) {
      const ds = createDataset({ ...validSampleParams, dataset_id: `DS_${purpose}`, purpose });
      expect(ds.purpose).toBe(purpose);
    }
  });

  it('Test 6: should reject invalid purpose with DATASET_INVALID_PURPOSE', () => {
    expect(() =>
      createDataset({ ...validSampleParams, purpose: 'INVALID_PURPOSE' as any })
    ).toThrowError(/purpose is required and must be one of/);
  });

  it('Test 7: should accept all valid DatasetSourceType values', () => {
    for (const type of VALID_DATASET_SOURCE_TYPES) {
      const ds = createDataset({
        ...validSampleParams,
        dataset_id: `DS_SRC_${type}`,
        source: { type }
      });
      expect(ds.source.type).toBe(type);
    }
  });

  it('Test 8: should reject invalid source type with DATASET_INVALID_SOURCE', () => {
    expect(() =>
      createDataset({ ...validSampleParams, source: { type: 'UNKNOWN_SOURCE' as any } })
    ).toThrowError(/source.type is required and must be one of/);
  });

  it('Test 9: should accept all valid DatasetStatus values', () => {
    for (const status of VALID_DATASET_STATUSES) {
      const ds = createDataset({ ...validSampleParams, dataset_id: `DS_ST_${status}`, status });
      expect(ds.status).toBe(status);
    }
  });

  it('Test 10: should reject invalid status with DATASET_INVALID_STATUS', () => {
    expect(() =>
      createDataset({ ...validSampleParams, status: 'INVALID_STATUS' as any })
    ).toThrowError(/status is required and must be one of/);
  });

  it('Test 11: should accept all valid DatasetSensitivity values', () => {
    for (const sensitivity of VALID_DATASET_SENSITIVITIES) {
      const ds = createDataset({ ...validSampleParams, dataset_id: `DS_SENS_${sensitivity}`, sensitivity });
      expect(ds.sensitivity).toBe(sensitivity);
    }
  });

  it('Test 12: should reject invalid timestamp strings', () => {
    expect(() =>
      createDataset({ ...validSampleParams, created_at: 'not-a-date' })
    ).toThrowError(/created_at is required and must be a valid ISO 8601 timestamp string/);

    expect(() =>
      createDataset({ ...validSampleParams, updated_at: 'invalid-iso' })
    ).toThrowError(/updated_at is required and must be a valid ISO 8601 timestamp string/);
  });

  // ===========================================================================
  // 2. IDENTITY & IMMUTABILITY TESTS
  // ===========================================================================

  it('Test 13: dataset_id remains stable across metadata updates', () => {
    const ds = createDataset(validSampleParams);
    store.create(ds);

    const updated = store.update(ds.dataset_id, {
      name: 'Updated Name Study 2026',
      description: 'New revised description'
    });

    expect(updated.dataset_id).toBe(ds.dataset_id);
    expect(updated.name).toBe('Updated Name Study 2026');
  });

  it('Test 14: attempt to mutate dataset_id via update is strictly rejected with DATASET_IMMUTABLE_ID_VIOLATION', () => {
    const ds = createDataset(validSampleParams);
    store.create(ds);

    expect(() =>
      store.update(ds.dataset_id, {
        dataset_id: 'DS_ALTERED_ID'
      } as any)
    ).toThrowError(/dataset_id is immutable/);
  });

  it('Test 15: original created_at timestamp is preserved during update', () => {
    const ds = createDataset(validSampleParams);
    store.create(ds);

    const updated = store.update(ds.dataset_id, {
      status: 'ARCHIVED'
    });

    expect(updated.created_at).toBe(ds.created_at);
  });

  // ===========================================================================
  // 3. OPTIONAL METADATA SUB-STRUCTURE TESTS
  // ===========================================================================

  it('Test 16: population metadata structure is preserved faithfully', () => {
    const ds = createDataset(validSampleParams);
    expect(ds.population).toBeDefined();
    expect(ds.population?.sample_size).toBe(500);
    expect(ds.population?.geographic_scope).toBe('Indonesia');
  });

  it('Test 17: context metadata structure is preserved faithfully', () => {
    const ds = createDataset(validSampleParams);
    expect(ds.context).toBeDefined();
    expect(ds.context?.setting).toBe('Outpatient Clinic');
    expect(ds.context?.collection_method).toBe('Calibrated digital scale and stadiometer');
  });

  it('Test 18: temporal_scope metadata structure is preserved faithfully', () => {
    const ds = createDataset(validSampleParams);
    expect(ds.temporal_scope).toBeDefined();
    expect(ds.temporal_scope?.start_date).toBe('2026-01-01');
    expect(ds.temporal_scope?.end_date).toBe('2026-06-30');
    expect(ds.temporal_scope?.timezone).toBe('Asia/Jakarta');
  });

  it('Test 19: arbitrary custom metadata dictionary is preserved without parameter smuggling', () => {
    const ds = createDataset({
      ...validSampleParams,
      metadata: { department: 'Endocrinology', batch_tag: '2026-Q1' }
    });
    expect(ds.metadata?.department).toBe('Endocrinology');
    expect(ds.metadata?.batch_tag).toBe('2026-Q1');
  });

  // ===========================================================================
  // 4. STORAGE (DatasetStore) TESTS
  // ===========================================================================

  it('Test 20: should create and retrieve a Dataset entity from DatasetStore', () => {
    const ds = createDataset(validSampleParams);
    store.create(ds);

    const retrieved = store.get(ds.dataset_id);
    expect(retrieved).toBeDefined();
    expect(retrieved?.dataset_id).toBe(ds.dataset_id);
    expect(retrieved?.name).toBe(ds.name);
  });

  it('Test 21: should reject registering a duplicate dataset_id with DATASET_ALREADY_EXISTS', () => {
    const ds = createDataset(validSampleParams);
    store.create(ds);

    expect(() => store.create(ds)).toThrowError(ScientificDatasetError);
    expect(() => store.create(ds)).toThrowError(/already exists/);
  });

  it('Test 22: should update dataset status from DRAFT to ACTIVE to ARCHIVED', () => {
    const ds = createDataset({ ...validSampleParams, status: 'DRAFT' });
    store.create(ds);

    const activated = store.update(ds.dataset_id, { status: 'ACTIVE' });
    expect(activated.status).toBe('ACTIVE');

    const archived = store.update(ds.dataset_id, { status: 'ARCHIVED' });
    expect(archived.status).toBe('ARCHIVED');
  });

  it('Test 23: should return undefined when requesting a nonexistent dataset_id', () => {
    const nonExistent = store.get('DS_UNKNOWN_999');
    expect(nonExistent).toBeUndefined();
  });

  it('Test 24: should filter datasets by owner_id, project_id, status, and purpose', () => {
    store.create(createDataset({ ...validSampleParams, dataset_id: 'DS_1', owner_id: 'usr_A', project_id: 'proj_X', status: 'ACTIVE', purpose: 'RESEARCH' }));
    store.create(createDataset({ ...validSampleParams, dataset_id: 'DS_2', owner_id: 'usr_A', project_id: 'proj_Y', status: 'DRAFT', purpose: 'LEARNING' }));
    store.create(createDataset({ ...validSampleParams, dataset_id: 'DS_3', owner_id: 'usr_B', project_id: 'proj_X', status: 'ACTIVE', purpose: 'SIMULATION' }));

    expect(store.list({ owner_id: 'usr_A' }).length).toBe(2);
    expect(store.list({ project_id: 'proj_X' }).length).toBe(2);
    expect(store.list({ status: 'ACTIVE' }).length).toBe(2);
    expect(store.list({ purpose: 'LEARNING' }).length).toBe(1);
    expect(store.list({ owner_id: 'usr_A', project_id: 'proj_X' }).length).toBe(1);
  });

  it('Test 25: store operations must deep clone datasets to prevent external caller mutation', () => {
    const ds = createDataset(validSampleParams);
    store.create(ds);

    const retrieved = store.get(ds.dataset_id);
    expect(retrieved).toBeDefined();
    retrieved!.name = 'Mutated Externally';

    const freshRead = store.get(ds.dataset_id);
    expect(freshRead?.name).toBe('Anthropometry Study Cohort 2026');
  });

  // ===========================================================================
  // 5. ARCHITECTURAL BOUNDARIES & TYPE SEPARATION TESTS
  // ===========================================================================

  it('Test 26: Dataset contract is independent and does not require DatasetVersion (Phase D2)', () => {
    const ds = createDataset(validSampleParams);
    expect((ds as any).versions).toBeUndefined();
    expect((ds as any).dataset_version_id).toBeUndefined();
    expect((ds as any).current_version_id).toBeUndefined();
  });

  it('Test 27: Dataset contract does not store or require row data arrays', () => {
    const ds = createDataset(validSampleParams);
    expect((ds as any).rows).toBeUndefined();
    expect((ds as any).data).toBeUndefined();
    expect((ds as any).records).toBeUndefined();
  });

  it('Test 28: Dataset contract does not require VariableRegistry or VariableMapping', () => {
    const ds = createDataset(validSampleParams);
    expect((ds as any).variable_mappings).toBeUndefined();
    expect((ds as any).variables).toBeUndefined();
    expect((ds as any).derived_variables).toBeUndefined();
  });

  it('Test 29: Dataset contract does not embed ScientificModule, AST nodes, or formulas', () => {
    const ds = createDataset(validSampleParams);
    expect((ds as any).formula_id).toBeUndefined();
    expect((ds as any).algorithm_id).toBeUndefined();
    expect((ds as any).model_id).toBeUndefined();
    expect((ds as any).expression_ast).toBeUndefined();
  });

  it('Test 30: Dataset contract acts purely as descriptive metadata and makes no scientific truth claims', () => {
    const ds = createDataset(validSampleParams);
    expect((ds as any).is_scientifically_valid).toBeUndefined();
    expect((ds as any).evidence_level).toBeUndefined();
    expect((ds as any).clinical_accuracy).toBeUndefined();
  });

  // ===========================================================================
  // 6. SECURITY TESTS
  // ===========================================================================

  it('Test 31: should not invoke eval, Function constructor, or dynamic execution', () => {
    const rawString = JSON.stringify(createDataset(validSampleParams));
    expect(rawString).not.toContain('eval(');
    expect(rawString).not.toContain('Function(');
  });

  // ===========================================================================
  // 7. REGRESSION TESTS (PHASES C1 - C8)
  // ===========================================================================

  const standardParameters: ScientificParameter[] = [
    {
      parameter_id: 'PARAM_D1_SCALE',
      name: 'Scale',
      description: 'Multiplier',
      unit: 'unitless',
      value: 1.5,
      version: '1.0.0',
      status: 'VERIFIED',
      is_constant: false,
      reference_ids: ['REF_1'],
      created_at: '2026-09-24T00:00:00Z',
      updated_at: '2026-09-24T00:00:00Z'
    }
  ];

  const standardFormula: ScientificFormula = {
    formula_id: 'FORMULA_D1_REG',
    name: 'Formula D1 Reg',
    description: 'Scale formula',
    version: '1.0.0',
    status: 'VERIFIED',
    validation_status: 'VERIFIED',
    inputs: [{ variable_id: 'x', name: 'X', unit: 'kg', datatype: 'number', required: true }],
    outputs: [{ name: 'y', unit: 'kg', datatype: 'number' }],
    parameter_ids: ['PARAM_D1_SCALE'],
    expression_ast: {
      type: 'OPERATOR',
      op: 'MULTIPLY',
      args: [
        { type: 'VARIABLE', variable_id: 'x' },
        { type: 'PARAMETER', parameter_id: 'PARAM_D1_SCALE' }
      ]
    },
    expression_string: 'x * scale',
    reference_ids: ['REF_1'],
    assumptions: [],
    limitations: [],
    created_by: 'system',
    created_at: '2026-09-24T00:00:00Z',
    updated_at: '2026-09-24T00:00:00Z'
  };

  it('Test 32 [C1 Regression]: should preserve CalculationEngine formula evaluation', () => {
    const trace = CalculationEngine.executeFormula({
      formula: standardFormula,
      inputs: { x: { value: 10, unit: 'kg' } },
      parameters: { PARAM_D1_SCALE: standardParameters[0] }
    });
    expect(trace.final_result['y'].value).toBe(15);
  });

  it('Test 33 [C2 Regression]: should preserve ModuleResolver & ParameterResolver contracts', () => {
    const resolvedModule = ModuleResolver.resolve({
      module_id: 'FORMULA_D1_REG',
      modules: [standardFormula]
    });
    expect(resolvedModule.module_id).toBe('FORMULA_D1_REG');

    const resolvedParams = ParameterResolver.resolve({
      module: standardFormula,
      available_parameters: standardParameters
    });
    expect(resolvedParams.parameters['PARAM_D1_SCALE']).toBe(1.5);
  });

  it('Test 34 [C3 Regression]: should preserve InputValidator normalization contract', () => {
    const val = InputValidator.validate({
      module: standardFormula,
      inputs: { x: { value: 5000, unit: 'g' } }
    });
    expect(val.valid).toBe(true);
    expect(val.normalized_inputs['x'].value).toBe(5);
  });

  it('Test 35 [C4 Regression]: should preserve AlgorithmExecutor execution contract', () => {
    const alg: ScientificAlgorithm = {
      algorithm_id: 'ALG_D1_REG',
      name: 'Algorithm Reg',
      description: 'Demo',
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
      request: { module_id: 'ALG_D1_REG', inputs: { v: { value: 10 } } }
    });
    expect(res.execution_path).toEqual(['INPUT_VALIDATION', 'S1', 'S2']);
  });

  it('Test 36 [C5 Regression]: should preserve ModelExecutor discrete-time simulation contract', () => {
    const model: ScientificModel = {
      module_id: 'MODEL_D1_REG',
      module_type: 'MODEL',
      model_id: 'MODEL_D1_REG',
      name: 'Model Reg',
      description: 'Demo',
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
          expression_ast: { type: 'CONSTANT', value: 88 }
        }
      ],
      created_by: 'system',
      created_at: '2026-09-24T00:00:00Z',
      updated_at: '2026-09-24T00:00:00Z'
    };

    const res = ModelExecutor.execute({
      model,
      request: { module_id: 'MODEL_D1_REG', inputs: {} }
    });
    expect(res.outputs['k'].value).toBe(88);
  });

  it('Test 37 [C6 Regression]: should preserve ValidationEngine evaluation contract', () => {
    const valResult = ValidationEngine.evaluate({
      execution_result: {
        execution_id: 'E_REG_37',
        module_id: 'M_REG',
        module_version: '1.0.0',
        inputs: {},
        normalized_inputs: {},
        parameters: {},
        execution_path: [],
        fallback_used: false,
        intermediate_results: {},
        trace: [],
        outputs: { y: { value: 200 } },
        warnings: [],
        errors: [],
        timestamp: '2026-09-24T00:00:00Z'
      },
      profile: {
        validation_id: 'VAL_REG_37',
        name: 'Check',
        version: '1.0.0',
        checks: [
          {
            check_id: 'CHK_37',
            name: 'Exact y',
            type: 'MATHEMATICAL',
            configuration: { target_output: 'y', expected_value: 200 }
          }
        ]
      }
    });
    expect(valResult.status).toBe('PASS');
  });

  it('Test 38 [C7 Regression]: should preserve BatchExecutor orchestration contract', () => {
    const batchResult = BatchExecutor.execute({
      request: {
        batch_id: 'BATCH_D1_REG',
        module_id: 'FORMULA_D1_REG',
        error_policy: 'CONTINUE_ON_ERROR',
        records: [
          { record_id: 'R1', inputs: { x: { value: 10, unit: 'kg' } } },
          { record_id: 'R2', inputs: { x: { value: 20, unit: 'kg' } } }
        ]
      },
      available_modules: [standardFormula],
      available_parameters: standardParameters
    });

    expect(batchResult.total_records).toBe(2);
    expect(batchResult.successful_records).toBe(2);
    expect(batchResult.records[0].result?.outputs['y'].value).toBe(15);
    expect(batchResult.records[1].result?.outputs['y'].value).toBe(30);
  });

  it('Test 39 [C8 Regression]: should preserve ProvenanceStore cryptographic integrity contract', () => {
    const provStore = new ProvenanceStore();
    const prov = buildProvenanceRecord({
      execution_id: 'EXEC_D1_REG',
      module_id: 'FORMULA_D1_REG',
      module_version: '1.0.0',
      inputs: {},
      normalized_inputs: {},
      parameters: {},
      execution_path: ['START', 'END'],
      fallback_used: false,
      intermediate_results: {},
      trace: [],
      outputs: { y: { value: 15 } },
      warnings: [],
      errors: [],
      timestamp: '2026-09-24T00:00:00Z'
    });

    provStore.save(prov);
    const verification = provStore.verifyIntegrity(prov.provenance_id);
    expect(verification.status).toBe('VALID');
    expect(verification.computed_hash).toBe(prov.integrity.content_hash);
  });
});
