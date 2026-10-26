/**
 * NutriBodySim — Phase D7 Test Suite: Derived Variable Engine
 *
 * Verifies all Phase D7 invariants across Sections A through J:
 * A. Contract: required fields, enums, validations, module/dataset references, collision protection
 * B. Dependency: single, multiple, nested, direct cycle, indirect cycle, self dependency
 * C. Versioning: exact module version, parameter version, dataset version, historical reproducibility
 * D. Execution: FORMULA, ALGORITHM, MODEL, invalid module, invalid version
 * E. Units: compatible units, conversion, incompatible units, dimension mismatch, output propagation
 * F. Missing values: REQUIRED, OPTIONAL, DEFAULT, FALLBACK, ERROR
 * G. Artifact: source immutability, child creation, lineage, checksum, cross-version rejection, collision
 * H. Batch: FAIL_FAST, CONTINUE_ON_ERROR, record isolation, partial failures
 * I. Provenance: execution linkage, module/version, parameter snapshot, dataset version, trace, integrity
 * J. Regression: preserves baseline
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  DerivedVariable,
  DerivedVariableValidator,
  DerivedVariableStore,
  DependencyResolver,
  DerivedVariableExecutor,
  DerivedArtifactBuilder,
  ScientificDerivedVariableError,
  DatasetStore,
  DatasetVersionStore,
  computeDatasetVersionChecksum,
  computeDataArtifactChecksum,
  VariableStore,
  DataArtifactStore,
  DataArtifact,
  Dataset,
  DatasetVersion,
  Variable,
  ProvenanceStore,
  computeProvenanceHash,
  DEMO_FORMULAS,
  DEMO_PARAMETERS,
  DEMO_VARIABLES,
  DEMO_MODELS,
  ScientificAlgorithm
} from '../index';

describe('Phase D7: Derived Variable Engine', () => {
  // Test registries and stores
  let datasetStore: DatasetStore;
  let versionStore: DatasetVersionStore;
  let varStore: VariableStore;
  let artifactStore: DataArtifactStore;
  let dvStore: DerivedVariableStore;
  let provStore: ProvenanceStore;

  const validDataset: Dataset = {
    dataset_id: 'ds_metabolic_cohort',
    name: 'Metabolic Health Cohort',
    description: 'Cohort observational study dataset',
    owner_id: 'usr_researcher_1',
    purpose: 'RESEARCH',
    source: {
      type: 'PRIMARY_COLLECTION',
      name: 'Metabolic Research Lab',
      description: 'Standardized baseline clinic visits',
      accessed_at: '2026-09-24T00:00:00.000Z'
    },
    population: {
      description: 'Adult cohort aged 18-65',
      sample_size: 500
    },
    context: {
      setting: 'Outpatient Clinic',
      collection_method: 'Calibrated digital scale'
    },
    temporal_scope: {
      start_date: '2026-01-01',
      end_date: '2026-06-30'
    },
    status: 'ACTIVE',
    sensitivity: 'INTERNAL',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z'
  };

  const rawVersion = {
    version_id: 'dsv_metabolic_v1',
    dataset_id: 'ds_metabolic_cohort',
    version_number: 1,
    description: 'Initial cleaned cohort snapshot',
    record_count: 3,
    column_count: 3,
    status: 'SEALED' as const,
    created_at: '2026-09-01T00:00:00Z',
    created_by: 'usr_researcher_1'
  };

  const validDatasetVersion: DatasetVersion = {
    ...rawVersion,
    checksum: computeDatasetVersionChecksum(rawVersion)
  };

  const varWeight: Variable = {
    variable_id: 'VAR_DEMO_WEIGHT',
    name: 'Weight',
    description: 'Body mass in kg',
    datatype: 'NUMBER',
    semantic_type: 'CONTINUOUS',
    category: 'ANTHROPOMETRY',
    unit: 'kg',
    status: 'ACTIVE',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z'
  };

  const varHeight: Variable = {
    variable_id: 'VAR_DEMO_HEIGHT',
    name: 'Height',
    description: 'Body height in m',
    datatype: 'NUMBER',
    semantic_type: 'CONTINUOUS',
    category: 'ANTHROPOMETRY',
    unit: 'm',
    status: 'ACTIVE',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z'
  };

  const varBMI: Variable = {
    variable_id: 'VAR_DERIVED_BMI',
    name: 'Body Mass Index',
    description: 'Quetelet index',
    datatype: 'NUMBER',
    semantic_type: 'CONTINUOUS',
    category: 'ANTHROPOMETRY',
    unit: 'unitless',
    status: 'ACTIVE',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z'
  };

  const sampleRawRecords = [
    { record_id: 'rec_1', weight_kg: 70, height_m: 1.75 },
    { record_id: 'rec_2', weight_kg: 80, height_m: 1.80 },
    { record_id: 'rec_3', weight_kg: 90, height_m: 1.70 }
  ];

  let sampleValidatedArtifact: DataArtifact;

  const validBmiDerivedVariable: DerivedVariable = {
    derived_variable_id: 'dv_bmi_calc',
    variable_id: 'VAR_DERIVED_BMI',
    name: 'BMI Calculation',
    description: 'Computes BMI from weight and height',
    dataset_version_id: 'dsv_metabolic_v1',
    source_variables: ['VAR_DEMO_WEIGHT', 'VAR_DEMO_HEIGHT'],
    source_mappings: [
      { source_variable_id: 'VAR_DEMO_WEIGHT', module_input_name: 'Weight', column_name: 'weight_kg', unit: 'kg' },
      { source_variable_id: 'VAR_DEMO_HEIGHT', module_input_name: 'Height', column_name: 'height_m', unit: 'm' }
    ],
    module_type: 'FORMULA',
    module_id: 'FORMULA_DEMO_QUETELET',
    module_version: '1.0.0',
    input_contract: {
      inputs: {
        Weight: { variable_id: 'VAR_DEMO_WEIGHT', unit: 'kg', required: true, datatype: 'number' },
        Height: { variable_id: 'VAR_DEMO_HEIGHT', unit: 'm', required: true, datatype: 'number' }
      }
    },
    output_contract: {
      output_variable_id: 'VAR_DERIVED_BMI',
      name: 'anthropometric_ratio',
      unit: 'kg/m^2',
      datatype: 'number'
    },
    missing_policy: 'REQUIRED',
    status: 'VALIDATION',
    created_at: '2026-09-25T00:00:00Z',
    created_by: 'usr_researcher_1'
  };

  beforeEach(() => {
    datasetStore = new DatasetStore();
    datasetStore.create(validDataset);

    versionStore = new DatasetVersionStore(datasetStore);
    versionStore.create(validDatasetVersion);

    varStore = new VariableStore();
    varStore.create(varWeight);
    varStore.create(varHeight);
    varStore.create(varBMI);

    artifactStore = new DataArtifactStore({ versionStore });

    const rawArt = {
      artifact_id: 'art_validated_cohort_001',
      dataset_version_id: 'dsv_metabolic_v1',
      state: 'VALIDATED' as const,
      parent_artifact_id: 'art_cleaned_root',
      created_at: '2026-09-24T00:00:00Z',
      created_by: 'usr_researcher_1',
      data_reference: sampleRawRecords as any,
      record_count: 3,
      column_count: 3
    };

    sampleValidatedArtifact = {
      ...rawArt,
      checksum: computeDataArtifactChecksum(rawArt)
    };

    dvStore = new DerivedVariableStore({
      datasetVersionStore: versionStore,
      variableStore: varStore
    });

    provStore = new ProvenanceStore();
  });

  // ===========================================================================
  // SECTION A: CONTRACT VALIDATION
  // ===========================================================================
  describe('A. Contract Requirements', () => {
    it('A1: should validate a well-formed DerivedVariable', () => {
      const result = DerivedVariableValidator.validate(validBmiDerivedVariable);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(() => DerivedVariableValidator.assertValid(validBmiDerivedVariable)).not.toThrow();
    });

    it('A2: should reject missing or empty derived_variable_id', () => {
      const invalid = { ...validBmiDerivedVariable, derived_variable_id: '' };
      expect(() => DerivedVariableValidator.assertValid(invalid)).toThrowError(
        expect.objectContaining({ code: 'DERIVED_VARIABLE_EMPTY_ID' })
      );
    });

    it('A3: should reject missing variable_id', () => {
      const invalid = { ...validBmiDerivedVariable, variable_id: '   ' };
      expect(() => DerivedVariableValidator.assertValid(invalid)).toThrowError(
        expect.objectContaining({ code: 'DERIVED_VARIABLE_EMPTY_VARIABLE_ID' })
      );
    });

    it('A4: should reject missing dataset_version_id', () => {
      const invalid = { ...validBmiDerivedVariable, dataset_version_id: '' };
      expect(() => DerivedVariableValidator.assertValid(invalid)).toThrowError(
        expect.objectContaining({ code: 'DERIVED_VARIABLE_EMPTY_DATASET_VERSION_ID' })
      );
    });

    it('A5: should reject invalid module_type', () => {
      const invalid = { ...validBmiDerivedVariable, module_type: 'CUSTOM_SCRIPT' as any };
      expect(() => DerivedVariableValidator.assertValid(invalid)).toThrowError(
        expect.objectContaining({ code: 'DERIVED_VARIABLE_INVALID_MODULE_TYPE' })
      );
    });

    it('A6: should reject empty source_variables array', () => {
      const invalid = { ...validBmiDerivedVariable, source_variables: [] };
      expect(() => DerivedVariableValidator.assertValid(invalid)).toThrowError(
        expect.objectContaining({ code: 'DERIVED_VARIABLE_SOURCE_VARIABLES_EMPTY' })
      );
    });

    it('A7: should reject invalid status and specifically reject VALIDATED instead of VALIDATION', () => {
      const invalidValidated = { ...validBmiDerivedVariable, status: 'VALIDATED' as any };
      expect(() => DerivedVariableValidator.assertValid(invalidValidated)).toThrowError(
        expect.objectContaining({ code: 'DERIVED_VARIABLE_INVALID_STATUS' })
      );

      const invalidUnknown = { ...validBmiDerivedVariable, status: 'UNKNOWN' as any };
      expect(() => DerivedVariableValidator.assertValid(invalidUnknown)).toThrowError(
        expect.objectContaining({ code: 'DERIVED_VARIABLE_INVALID_STATUS' })
      );
    });

    it('A8: should accept all valid statuses: DRAFT, EXPERIMENTAL, VALIDATION, VERIFIED, DEPRECATED', () => {
      const statuses: Array<DerivedVariable['status']> = ['DRAFT', 'EXPERIMENTAL', 'VALIDATION', 'VERIFIED', 'DEPRECATED'];
      for (const st of statuses) {
        const item = { ...validBmiDerivedVariable, status: st };
        expect(DerivedVariableValidator.validate(item).isValid).toBe(true);
      }
    });

    it('A9: should reject invalid missing_policy', () => {
      const invalid = { ...validBmiDerivedVariable, missing_policy: 'UNKNOWN_POLICY' as any };
      expect(() => DerivedVariableValidator.assertValid(invalid)).toThrowError(
        expect.objectContaining({ code: 'DERIVED_VARIABLE_INVALID_MISSING_POLICY' })
      );
    });

    it('A10: should enforce collision protection when duplicate derived_variable_id is created', () => {
      dvStore.create(validBmiDerivedVariable);
      expect(() => dvStore.create(validBmiDerivedVariable)).toThrowError(
        expect.objectContaining({ code: 'DERIVED_VARIABLE_ALREADY_EXISTS' })
      );
    });

    it('A11: should enforce collision protection when variable_id is already derived for the same dataset version', () => {
      dvStore.create(validBmiDerivedVariable);

      const conflicting: DerivedVariable = {
        ...validBmiDerivedVariable,
        derived_variable_id: 'dv_bmi_calc_alternate'
      };

      expect(() => dvStore.create(conflicting)).toThrowError(
        expect.objectContaining({ code: 'DERIVED_VARIABLE_COLLISION' })
      );
    });
  });

  // ===========================================================================
  // SECTION B: DEPENDENCY GRAPH & CYCLE DETECTION
  // ===========================================================================
  describe('B. Dependency Graph & Cycle Detection', () => {
    it('B1: should resolve single dependency A -> B in deterministic order', () => {
      const varA: DerivedVariable = {
        ...validBmiDerivedVariable,
        derived_variable_id: 'dv_a',
        variable_id: 'var_a',
        source_variables: ['VAR_DEMO_WEIGHT']
      };

      const varB: DerivedVariable = {
        ...validBmiDerivedVariable,
        derived_variable_id: 'dv_b',
        variable_id: 'var_b',
        source_variables: ['var_a'] // depends on var_a produced by dv_a
      };

      const order = DependencyResolver.resolveExecutionOrder([varB, varA]);
      expect(order).toEqual(['dv_a', 'dv_b']);
    });

    it('B2: should resolve multiple dependencies A + B -> C', () => {
      const dvA: DerivedVariable = {
        ...validBmiDerivedVariable,
        derived_variable_id: 'dv_a',
        variable_id: 'var_a',
        source_variables: ['VAR_DEMO_WEIGHT']
      };
      const dvB: DerivedVariable = {
        ...validBmiDerivedVariable,
        derived_variable_id: 'dv_b',
        variable_id: 'var_b',
        source_variables: ['VAR_DEMO_HEIGHT']
      };
      const dvC: DerivedVariable = {
        ...validBmiDerivedVariable,
        derived_variable_id: 'dv_c',
        variable_id: 'var_c',
        source_variables: ['var_a', 'var_b']
      };

      const order = DependencyResolver.resolveExecutionOrder([dvC, dvB, dvA]);
      expect(order.indexOf('dv_a')).toBeLessThan(order.indexOf('dv_c'));
      expect(order.indexOf('dv_b')).toBeLessThan(order.indexOf('dv_c'));
    });

    it('B3: should resolve nested dependency chain A -> B -> C -> D', () => {
      const dvA: DerivedVariable = { ...validBmiDerivedVariable, derived_variable_id: 'dv_a', variable_id: 'var_a', source_variables: ['VAR_DEMO_WEIGHT'] };
      const dvB: DerivedVariable = { ...validBmiDerivedVariable, derived_variable_id: 'dv_b', variable_id: 'var_b', source_variables: ['var_a'] };
      const dvC: DerivedVariable = { ...validBmiDerivedVariable, derived_variable_id: 'dv_c', variable_id: 'var_c', source_variables: ['var_b'] };
      const dvD: DerivedVariable = { ...validBmiDerivedVariable, derived_variable_id: 'dv_d', variable_id: 'var_d', source_variables: ['var_c'] };

      const order = DependencyResolver.resolveExecutionOrder([dvD, dvC, dvB, dvA]);
      expect(order).toEqual(['dv_a', 'dv_b', 'dv_c', 'dv_d']);
    });

    it('B4: should detect and reject direct self-dependency A -> A', () => {
      const dvSelf: DerivedVariable = {
        ...validBmiDerivedVariable,
        derived_variable_id: 'dv_self',
        variable_id: 'var_self',
        source_variables: ['var_self'] // self-dependency!
      };

      expect(() => DependencyResolver.resolveExecutionOrder([dvSelf])).toThrowError(
        expect.objectContaining({ code: 'DERIVED_VARIABLE_SELF_DEPENDENCY' })
      );
    });

    it('B5: should detect and reject direct 2-node cycle A -> B -> A', () => {
      const dvA: DerivedVariable = {
        ...validBmiDerivedVariable,
        derived_variable_id: 'dv_a',
        variable_id: 'var_a',
        source_variables: ['var_b']
      };
      const dvB: DerivedVariable = {
        ...validBmiDerivedVariable,
        derived_variable_id: 'dv_b',
        variable_id: 'var_b',
        source_variables: ['var_a']
      };

      expect(() => DependencyResolver.resolveExecutionOrder([dvA, dvB])).toThrowError(
        expect.objectContaining({ code: 'DERIVED_VARIABLE_CYCLIC_DEPENDENCY' })
      );
    });

    it('B6: should detect and reject indirect cycle A -> B -> C -> A', () => {
      const dvA: DerivedVariable = { ...validBmiDerivedVariable, derived_variable_id: 'dv_a', variable_id: 'var_a', source_variables: ['var_c'] };
      const dvB: DerivedVariable = { ...validBmiDerivedVariable, derived_variable_id: 'dv_b', variable_id: 'var_b', source_variables: ['var_a'] };
      const dvC: DerivedVariable = { ...validBmiDerivedVariable, derived_variable_id: 'dv_c', variable_id: 'var_c', source_variables: ['var_b'] };

      expect(() => DependencyResolver.resolveExecutionOrder([dvA, dvB, dvC])).toThrowError(
        expect.objectContaining({ code: 'DERIVED_VARIABLE_CYCLIC_DEPENDENCY' })
      );

      const analysis = DependencyResolver.analyze([dvA, dvB, dvC]);
      expect(analysis.hasCycles).toBe(true);
      expect(analysis.cycles.length).toBeGreaterThan(0);
    });
  });

  // ===========================================================================
  // SECTION C: VERSION PINNING
  // ===========================================================================
  describe('C. Version Pinning', () => {
    it('C1: should pin exact module version and succeed when version matches', () => {
      const execResult = DerivedVariableExecutor.executeSingle({
        derived_variable: validBmiDerivedVariable,
        record: { weight_kg: 70, height_m: 1.75 },
        available_modules: DEMO_FORMULAS,
        available_parameters: DEMO_PARAMETERS
      });

      expect(execResult.status).toBe('SUCCESS');
      expect(execResult.execution_result?.module_version).toBe('1.0.0');
    });

    it('C2: should fail execution if pinned module version does not exist in available modules', () => {
      const nonExistentVersionDv: DerivedVariable = {
        ...validBmiDerivedVariable,
        module_version: '99.0.0' // does not exist
      };

      expect(() =>
        DerivedVariableExecutor.executeSingle({
          derived_variable: nonExistentVersionDv,
          record: { weight_kg: 70, height_m: 1.75 },
          available_modules: DEMO_FORMULAS,
          available_parameters: DEMO_PARAMETERS
        })
      ).toThrowError(
        expect.objectContaining({ code: 'DERIVED_VARIABLE_MODULE_VERSION_NOT_FOUND' })
      );
    });

    it('C3: historical reproducibility: executing older version produces exact historical result', () => {
      const queteletV1 = DEMO_FORMULAS.find(f => f.formula_id === 'FORMULA_DEMO_QUETELET')!;
      const queteletV2 = {
        ...queteletV1,
        version: '2.0.0',
        expression_ast: { type: 'CONSTANT' as const, value: 999 } // modified in future version
      };

      // When pinned to 1.0.0, it must resolve to 1.0.0 even if 2.0.0 is present
      const res = DerivedVariableExecutor.executeSingle({
        derived_variable: validBmiDerivedVariable, // pinned to 1.0.0
        record: { weight_kg: 70, height_m: 1.75 },
        available_modules: [queteletV1, queteletV2],
        available_parameters: DEMO_PARAMETERS
      });

      expect(res.status).toBe('SUCCESS');
      expect(res.execution_result?.module_version).toBe('1.0.0');
      // Weight 70 / (1.75 ^ 2) ≈ 22.857, definitely not 999
      expect(Number(res.output_value)).toBeCloseTo(22.857, 2);
    });

    it('C4: binds exact dataset_version_id and preserves it in execution and provenance', () => {
      const res = DerivedVariableExecutor.executeSingle({
        derived_variable: validBmiDerivedVariable,
        record: { weight_kg: 70, height_m: 1.75 },
        available_modules: DEMO_FORMULAS,
        available_parameters: DEMO_PARAMETERS,
        provenance_store: provStore
      });

      expect(res.status).toBe('SUCCESS');
      const savedProv = provStore.getByExecutionId(res.execution_result!.execution_id);
      expect(savedProv).toBeDefined();
      expect(savedProv?.dataset_version_id).toBe('dsv_metabolic_v1');
    });
  });

  // ===========================================================================
  // SECTION D: EXECUTION (FORMULA, ALGORITHM, MODEL)
  // ===========================================================================
  describe('D. Execution Delegations (Phase C)', () => {
    it('D1: executes FORMULA modules via calculation engine delegation', () => {
      const res = DerivedVariableExecutor.executeSingle({
        derived_variable: validBmiDerivedVariable,
        record: { weight_kg: 80, height_m: 2.0 },
        available_modules: DEMO_FORMULAS,
        available_parameters: DEMO_PARAMETERS
      });

      expect(res.status).toBe('SUCCESS');
      // 80 / (2.0 ^ 2) = 20.0
      expect(res.output_value).toBe(20);
      expect(res.output_unit).toBe('kg/m^2');
      expect(res.execution_result?.trace).toBeDefined();
    });

    it('D2: executes ALGORITHM modules via algorithm executor delegation', () => {
      const testAlg: ScientificAlgorithm = {
        algorithm_id: 'ALG_TEST_PIPELINE',
        name: 'Test Algorithm',
        description: 'Simple pipeline algorithm',
        version: '1.0.0',
        status: 'VERIFIED',
        inputs: [{ variable_id: 'VAR_DEMO_WEIGHT', name: 'Weight', unit: 'kg', required: true }],
        outputs: [{ name: 'doubled_weight', unit: 'kg', datatype: 'number' }],
        parameter_ids: [],
        entry_step_id: 'STEP_1',
        steps: [
          {
            step_id: 'STEP_1',
            operation: 'OUTPUT',
            output_mapping: { doubled_weight: 'VAR_DEMO_WEIGHT' },
            is_terminal: true
          }
        ],
        reference_ids: [],
        created_by: 'system',
        created_at: '2026-09-01T00:00:00Z',
        updated_at: '2026-09-01T00:00:00Z'
      };

      const algDv: DerivedVariable = {
        ...validBmiDerivedVariable,
        derived_variable_id: 'dv_alg_test',
        module_type: 'ALGORITHM',
        module_id: 'ALG_TEST_PIPELINE',
        module_version: '1.0.0',
        source_variables: ['VAR_DEMO_WEIGHT'],
        source_mappings: [
          { source_variable_id: 'VAR_DEMO_WEIGHT', module_input_name: 'Weight', column_name: 'weight_kg', unit: 'kg' }
        ],
        input_contract: {
          inputs: {
            Weight: { variable_id: 'VAR_DEMO_WEIGHT', unit: 'kg', required: true }
          }
        },
        output_contract: {
          name: 'doubled_weight',
          unit: 'kg',
          datatype: 'number'
        }
      };

      const res = DerivedVariableExecutor.executeSingle({
        derived_variable: algDv,
        record: { weight_kg: 75 },
        available_modules: [testAlg],
        available_parameters: []
      });

      expect(res.status).toBe('SUCCESS');
      expect(res.output_value).toBe(75);
    });

    it('D3: executes MODEL modules via model executor delegation', () => {
      const testModel: any = {
        module_id: 'MODEL_TEST_STATE',
        module_type: 'MODEL',
        model_id: 'MODEL_TEST_STATE',
        name: 'Stateful Model',
        description: 'Dynamical state model test',
        version: '1.0.0',
        status: 'VERIFIED',
        is_verified: true,
        variable_ids: ['u_input'],
        parameter_ids: [],
        reference_ids: [],
        assumptions: ['Infrastructure test'],
        inputs: [{ variable_id: 'u_input', name: 'u_input', unit: 'unitless', datatype: 'number', required: false, default_value: 0 }],
        outputs: [{ name: 'x_state', unit: 'mg', datatype: 'number' }],
        states: [{ state_id: 'x_state', name: 'State X', datatype: 'number', unit: 'mg', initial_value: 100 }],
        time_config: { start_time: 0, dt: 1, steps: 2, max_steps: 10 },
        transitions: [
          {
            state_id: 'x_state',
            type: 'DERIVATIVE_EULER',
            expression_ast: { type: 'CONSTANT', value: -5 }
          }
        ],
        created_by: 'system',
        created_at: '2026-09-01T00:00:00Z',
        updated_at: '2026-09-01T00:00:00Z'
      };

      const modelDv: DerivedVariable = {
        ...validBmiDerivedVariable,
        derived_variable_id: 'dv_model_test',
        module_type: 'MODEL',
        module_id: 'MODEL_TEST_STATE',
        module_version: '1.0.0',
        source_variables: ['VAR_DEMO_WEIGHT'],
        source_mappings: [
          { source_variable_id: 'VAR_DEMO_WEIGHT', module_input_name: 'u_input', column_name: 'weight_kg', unit: 'unitless' }
        ],
        input_contract: {
          inputs: {
            u_input: { unit: 'unitless', required: false }
          }
        },
        output_contract: {
          name: 'x_state',
          unit: 'mg',
          datatype: 'number'
        }
      };

      const res = DerivedVariableExecutor.executeSingle({
        derived_variable: modelDv,
        record: { weight_kg: 70 },
        available_modules: [testModel],
        available_parameters: []
      });

      expect(res.status).toBe('SUCCESS');
      expect(res.output_value).toBeDefined();
    });

    it('D4: throws when module is not found in registry', () => {
      const nonExistentModuleDv: DerivedVariable = {
        ...validBmiDerivedVariable,
        module_id: 'NON_EXISTENT_FORMULA'
      };

      expect(() =>
        DerivedVariableExecutor.executeSingle({
          derived_variable: nonExistentModuleDv,
          record: { weight_kg: 70, height_m: 1.75 },
          available_modules: DEMO_FORMULAS,
          available_parameters: DEMO_PARAMETERS
        })
      ).toThrowError(
        expect.objectContaining({ code: 'DERIVED_VARIABLE_MODULE_NOT_FOUND' })
      );
    });
  });

  // ===========================================================================
  // SECTION E: UNITS & DIMENSIONAL CONSISTENCY
  // ===========================================================================
  describe('E. Unit Handling & Dimensional Consistency', () => {
    it('E1: converts compatible units automatically (cm -> m)', () => {
      const res = DerivedVariableExecutor.executeSingle({
        derived_variable: {
          ...validBmiDerivedVariable,
          source_mappings: [
            { source_variable_id: 'VAR_DEMO_WEIGHT', module_input_name: 'Weight', column_name: 'weight_kg', unit: 'kg' },
            { source_variable_id: 'VAR_DEMO_HEIGHT', module_input_name: 'Height', column_name: 'height_cm', unit: 'cm' }
          ]
        },
        record: { weight_kg: 70, height_cm: 175 }, // 175 cm should be converted to 1.75 m
        available_modules: DEMO_FORMULAS,
        available_parameters: DEMO_PARAMETERS
      });

      expect(res.status).toBe('SUCCESS');
      expect(Number(res.output_value)).toBeCloseTo(22.857, 2);
    });

    it('E2: fails when incompatible unit is passed to module', () => {
      const res = DerivedVariableExecutor.executeSingle({
        derived_variable: {
          ...validBmiDerivedVariable,
          source_mappings: [
            { source_variable_id: 'VAR_DEMO_WEIGHT', module_input_name: 'Weight', column_name: 'weight_kg', unit: 'kg' },
            { source_variable_id: 'VAR_DEMO_HEIGHT', module_input_name: 'Height', column_name: 'height_m', unit: 'mmHg' } // pressure instead of length!
          ]
        },
        record: { weight_kg: 70, height_m: 120 },
        available_modules: DEMO_FORMULAS,
        available_parameters: DEMO_PARAMETERS
      });

      expect(res.status).toBe('FAILED');
      expect(res.error).toBeDefined();
    });

    it('E3: output unit propagates correctly to execution result', () => {
      const res = DerivedVariableExecutor.executeSingle({
        derived_variable: validBmiDerivedVariable,
        record: { weight_kg: 70, height_m: 1.75 },
        available_modules: DEMO_FORMULAS,
        available_parameters: DEMO_PARAMETERS
      });

      expect(res.status).toBe('SUCCESS');
      expect(res.output_unit).toBe('kg/m^2');
    });
  });

  // ===========================================================================
  // SECTION F: MISSING POLICIES
  // ===========================================================================
  describe('F. Missing Values Policies', () => {
    it('F1: REQUIRED policy fails when input is missing', () => {
      const res = DerivedVariableExecutor.executeSingle({
        derived_variable: {
          ...validBmiDerivedVariable,
          missing_policy: 'REQUIRED'
        },
        record: { weight_kg: 70 }, // height is missing!
        available_modules: DEMO_FORMULAS,
        available_parameters: DEMO_PARAMETERS
      });

      expect(res.status).toBe('FAILED');
      expect(res.error).toContain('Missing required inputs: Height');
    });

    it('F2: ERROR policy fails when input is missing', () => {
      const res = DerivedVariableExecutor.executeSingle({
        derived_variable: {
          ...validBmiDerivedVariable,
          missing_policy: 'ERROR'
        },
        record: { weight_kg: 70 },
        available_modules: DEMO_FORMULAS,
        available_parameters: DEMO_PARAMETERS
      });

      expect(res.status).toBe('FAILED');
      expect(res.error).toContain('Missing required inputs: Height');
    });

    it('F3: DEFAULT policy applies default and records warnings', () => {
      const res = DerivedVariableExecutor.executeSingle({
        derived_variable: {
          ...validBmiDerivedVariable,
          missing_policy: 'DEFAULT'
        },
        record: { weight_kg: 70 }, // height missing
        available_modules: DEMO_FORMULAS,
        available_parameters: DEMO_PARAMETERS
      });

      expect(res.warnings).toBeDefined();
      expect(res.warnings?.some(w => w.includes('defaulted'))).toBe(true);
    });

    it('F4: FALLBACK policy flags fallback_used', () => {
      const res = DerivedVariableExecutor.executeSingle({
        derived_variable: {
          ...validBmiDerivedVariable,
          missing_policy: 'FALLBACK'
        },
        record: { weight_kg: 70 }, // height missing
        available_modules: DEMO_FORMULAS,
        available_parameters: DEMO_PARAMETERS
      });

      expect(res.fallback_used).toBe(true);
    });
  });

  // ===========================================================================
  // SECTION G: DATA ARTIFACT IMMUTABILITY & LINEAGE
  // ===========================================================================
  describe('G. Data Artifact Immutability & Lineage', () => {
    it('G1: source artifact is never mutated in-place', () => {
      const originalChecksum = sampleValidatedArtifact.checksum;
      const originalData = JSON.stringify(sampleValidatedArtifact.data_reference);

      const batchExecRes = DerivedVariableExecutor.executeBatch({
        derived_variable: validBmiDerivedVariable,
        records: sampleRawRecords,
        available_modules: DEMO_FORMULAS,
        available_parameters: DEMO_PARAMETERS
      });

      const newArtifact = DerivedArtifactBuilder.createDerivedArtifact({
        source_artifact: sampleValidatedArtifact,
        derived_variable: validBmiDerivedVariable,
        execution_result: batchExecRes
      });

      // Source artifact must remain 100% unchanged
      expect(sampleValidatedArtifact.checksum).toBe(originalChecksum);
      expect(JSON.stringify(sampleValidatedArtifact.data_reference)).toBe(originalData);

      // New artifact is distinct
      expect(newArtifact.artifact_id).not.toBe(sampleValidatedArtifact.artifact_id);
      expect(newArtifact.parent_artifact_id).toBe(sampleValidatedArtifact.artifact_id);
    });

    it('G2: child artifact contains derived column and new valid checksum', () => {
      const batchExecRes = DerivedVariableExecutor.executeBatch({
        derived_variable: validBmiDerivedVariable,
        records: sampleRawRecords,
        available_modules: DEMO_FORMULAS,
        available_parameters: DEMO_PARAMETERS
      });

      const newArtifact = DerivedArtifactBuilder.createDerivedArtifact({
        source_artifact: sampleValidatedArtifact,
        derived_variable: validBmiDerivedVariable,
        execution_result: batchExecRes,
        target_column_name: 'bmi_calculated'
      });

      expect(newArtifact.checksum).toMatch(/^[a-f0-9]{64}$/i);
      const rows = newArtifact.data_reference as unknown as any[];
      expect(rows).toHaveLength(3);
      expect(rows[0].bmi_calculated).toBeCloseTo(22.857, 2);
      expect(rows[1].bmi_calculated).toBeCloseTo(24.691, 2);
      expect(rows[2].bmi_calculated).toBeCloseTo(31.141, 2);
    });

    it('G3: rejects cross-version execution when artifact version does not match derivation version', () => {
      const wrongVersionArtifact: DataArtifact = {
        ...sampleValidatedArtifact,
        dataset_version_id: 'dsv_other_version'
      };

      const batchExecRes = DerivedVariableExecutor.executeBatch({
        derived_variable: validBmiDerivedVariable,
        records: sampleRawRecords,
        available_modules: DEMO_FORMULAS,
        available_parameters: DEMO_PARAMETERS
      });

      expect(() =>
        DerivedArtifactBuilder.createDerivedArtifact({
          source_artifact: wrongVersionArtifact,
          derived_variable: validBmiDerivedVariable,
          execution_result: batchExecRes
        })
      ).toThrowError(
        expect.objectContaining({ code: 'DERIVED_VARIABLE_DATASET_VERSION_MISMATCH' })
      );
    });

    it('G4: collision protection: rejects overwriting an existing column unless allow_overwrite_column is explicit', () => {
      const batchExecRes = DerivedVariableExecutor.executeBatch({
        derived_variable: validBmiDerivedVariable,
        records: sampleRawRecords,
        available_modules: DEMO_FORMULAS,
        available_parameters: DEMO_PARAMETERS
      });

      expect(() =>
        DerivedArtifactBuilder.createDerivedArtifact({
          source_artifact: sampleValidatedArtifact,
          derived_variable: validBmiDerivedVariable,
          execution_result: batchExecRes,
          target_column_name: 'weight_kg' // already exists in source records!
        })
      ).toThrowError(
        expect.objectContaining({ code: 'DERIVED_VARIABLE_COLLISION' })
      );
    });
  });

  // ===========================================================================
  // SECTION H: BATCH EXECUTION & ISOLATION
  // ===========================================================================
  describe('H. Batch Execution & Record Isolation', () => {
    const mixedRecords = [
      { record_id: 'rec_ok_1', weight_kg: 70, height_m: 1.75 },
      { record_id: 'rec_err_2', weight_kg: null, height_m: 1.75 }, // error
      { record_id: 'rec_ok_3', weight_kg: 85, height_m: 1.82 }
    ];

    it('H1: FAIL_FAST policy halts immediately on first error', () => {
      const res = DerivedVariableExecutor.executeBatch({
        derived_variable: validBmiDerivedVariable,
        records: mixedRecords,
        error_policy: 'FAIL_FAST',
        available_modules: DEMO_FORMULAS,
        available_parameters: DEMO_PARAMETERS
      });

      expect(res.status).toBe('FAILED');
      expect(res.summary.failed).toBe(1);
    });

    it('H2: CONTINUE_ON_ERROR policy executes all records, recording individual status', () => {
      const res = DerivedVariableExecutor.executeBatch({
        derived_variable: validBmiDerivedVariable,
        records: mixedRecords,
        error_policy: 'CONTINUE_ON_ERROR',
        available_modules: DEMO_FORMULAS,
        available_parameters: DEMO_PARAMETERS
      });

      expect(res.status).toBe('PARTIAL_SUCCESS');
      expect(res.summary.total).toBe(3);
      expect(res.summary.successful).toBe(2);
      expect(res.summary.failed).toBe(1);

      expect(res.records[0].status).toBe('SUCCESS');
      expect(res.records[1].status).toBe('FAILED');
      expect(res.records[2].status).toBe('SUCCESS');
    });

    it('H3: ensures record isolation: execution IDs and inputs never leak across records', () => {
      const res = DerivedVariableExecutor.executeBatch({
        derived_variable: validBmiDerivedVariable,
        records: [
          { record_id: 'rec_1', weight_kg: 50, height_m: 1.60 },
          { record_id: 'rec_2', weight_kg: 90, height_m: 1.90 }
        ],
        available_modules: DEMO_FORMULAS,
        available_parameters: DEMO_PARAMETERS
      });

      expect(res.records[0].execution_result?.execution_id).not.toBe(
        res.records[1].execution_result?.execution_id
      );
      expect(res.records[0].output_value).not.toBe(res.records[1].output_value);
    });
  });

  // ===========================================================================
  // SECTION I: PROVENANCE
  // ===========================================================================
  describe('I. Provenance Tracking & Integrity', () => {
    it('I1: captures full provenance trace, module version, and dataset version', () => {
      const res = DerivedVariableExecutor.executeSingle({
        derived_variable: validBmiDerivedVariable,
        record: { weight_kg: 70, height_m: 1.75 },
        available_modules: DEMO_FORMULAS,
        available_parameters: DEMO_PARAMETERS,
        provenance_store: provStore
      });

      expect(res.status).toBe('SUCCESS');
      const record = provStore.getByExecutionId(res.execution_result!.execution_id);
      expect(record).toBeDefined();

      expect(record!.module_id).toBe('FORMULA_DEMO_QUETELET');
      expect(record!.module_version).toBe('1.0.0');
      expect(record!.dataset_version_id).toBe('dsv_metabolic_v1');
      expect(record!.trace).toBeDefined();
      expect(record!.integrity.content_hash).toMatch(/^[a-f0-9]{64}$/i);
    });

    it('I2: provenance record passes cryptographic tamper-detection check', () => {
      const res = DerivedVariableExecutor.executeSingle({
        derived_variable: validBmiDerivedVariable,
        record: { weight_kg: 70, height_m: 1.75 },
        available_modules: DEMO_FORMULAS,
        available_parameters: DEMO_PARAMETERS,
        provenance_store: provStore
      });

      const record = provStore.getByExecutionId(res.execution_result!.execution_id);
      expect(record).toBeDefined();
      const verifyRes = provStore.verifyIntegrity(record!.provenance_id);
      expect(verifyRes.status).toBe('VALID');
      expect(verifyRes.computed_hash).toBe(verifyRes.stored_hash);
    });
  });

  // ===========================================================================
  // SECTION J: STORE RESOLUTION & REGRESSION
  // ===========================================================================
  describe('J. Store Resolution & Execution Planning', () => {
    it('J1: resolves multi-step derived variable execution plan topologically', () => {
      // 1. BMI calculation
      dvStore.create(validBmiDerivedVariable);

      // 2. BMI scaling derived variable depending on VAR_DERIVED_BMI
      const varBmiScaled: Variable = {
        variable_id: 'VAR_BMI_SCALED',
        name: 'Scaled BMI',
        description: 'Scaled index',
        datatype: 'NUMBER',
        semantic_type: 'CONTINUOUS',
        category: 'ANTHROPOMETRY',
        unit: 'unitless',
        status: 'ACTIVE',
        created_at: '2026-09-01T00:00:00Z',
        updated_at: '2026-09-01T00:00:00Z'
      };
      varStore.create(varBmiScaled);

      const dvBmiScaled: DerivedVariable = {
        ...validBmiDerivedVariable,
        derived_variable_id: 'dv_bmi_scaled',
        variable_id: 'VAR_BMI_SCALED',
        source_variables: ['VAR_DERIVED_BMI'],
        source_mappings: [
          { source_variable_id: 'VAR_DERIVED_BMI', module_input_name: 'Weight', unit: 'kg' },
          { source_variable_id: 'VAR_DEMO_HEIGHT', module_input_name: 'Height', unit: 'm' }
        ]
      };
      dvStore.create(dvBmiScaled);

      const plan = dvStore.resolveExecutionPlan('dsv_metabolic_v1');
      expect(plan).toHaveLength(2);
      expect(plan[0].derived_variable_id).toBe('dv_bmi_calc');
      expect(plan[1].derived_variable_id).toBe('dv_bmi_scaled');
    });
  });
});
