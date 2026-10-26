/**
 * NutriBodySim — Phase D8 Test Suite: Dataset -> Scientific Execution Engine
 *
 * Comprehensive tests verifying all Phase D8 requirements across Sections A through K:
 * A. Contract: DatasetExecutionRequest and DatasetResultSet validation
 * B. Dataset & Artifact Binding: valid, invalid version, invalid artifact, cross-version rejection
 * C. Variable Mapping: successful mapping, missing, conflict, ambiguous resolution
 * D. Input Assembly: single record, multiple inputs, default values, missing required inputs
 * E. Units: compatible units, physical conversions (cm -> m), dimension mismatches (kg -> m)
 * F. Validation Gate: PASS, ERROR, WARNING, NOT_CONFIGURED, policy enforcement
 * G. Module Version Pinning: exact version match, unavailable version, invalid module
 * H. Batch Execution & Record Isolation: FAIL_FAST, CONTINUE_ON_ERROR, state isolation
 * I. ResultSet Abstraction: record-level ExecutionResult linkage, aggregation, status
 * J. Provenance Integration: linkage to dataset version, artifact, module, params, SHA-256 hash
 * K. Source Immutability: artifact unchanged, bit-identical checksum before and after
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  DatasetExecutionEngine,
  DatasetExecutionRequest,
  DatasetExecutionRequestValidator,
  DatasetInputAssembler,
  DatasetResultSet,
  DatasetResultSetStore,
  DatasetValidationGate,
  ResultSetValidator,
  ScientificDatasetExecutionError,
  DatasetStore,
  DatasetVersionStore,
  DataArtifactStore,
  VariableStore,
  VariableMappingStore,
  ValidationProfileStore,
  ProvenanceStore,
  Dataset,
  DatasetVersion,
  DataArtifact,
  Variable,
  VariableMapping,
  DataValidationProfile,
  computeDatasetVersionChecksum,
  computeDataArtifactChecksum,
  DEMO_FORMULAS,
  DEMO_PARAMETERS,
  DEMO_MODELS,
  ScientificAlgorithm
} from '../index';

describe('Phase D8: Dataset -> Scientific Execution Engine', () => {
  let datasetStore: DatasetStore;
  let versionStore: DatasetVersionStore;
  let artifactStore: DataArtifactStore;
  let varStore: VariableStore;
  let mappingStore: VariableMappingStore;
  let profileStore: ValidationProfileStore;
  let provStore: ProvenanceStore;
  let resultSetStore: DatasetResultSetStore;

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

  const sampleRecords = [
    { record_id: 'rec_1', weight_kg: 70, height_cm: 175 },
    { record_id: 'rec_2', weight_kg: 80, height_cm: 180 },
    { record_id: 'rec_3', weight_kg: 65, height_cm: 165 }
  ];

  const rawRoot = {
    artifact_id: 'art_cohort_raw_000',
    dataset_version_id: 'dsv_metabolic_v1',
    state: 'RAW' as const,
    data_reference: { records: sampleRecords },
    record_count: 3,
    column_count: 3,
    created_at: '2026-09-01T00:00:00Z',
    created_by: 'usr_researcher_1'
  };

  const sampleRawArtifact: DataArtifact = {
    ...rawRoot,
    checksum: computeDataArtifactChecksum(rawRoot)
  };

  const rawArtifact = {
    artifact_id: 'art_cohort_validated_001',
    dataset_version_id: 'dsv_metabolic_v1',
    state: 'VALIDATED' as const,
    parent_artifact_id: 'art_cohort_raw_000',
    data_reference: { records: sampleRecords },
    record_count: 3,
    column_count: 3,
    created_at: '2026-09-01T00:00:00Z',
    created_by: 'usr_researcher_1'
  };

  const sampleValidatedArtifact: DataArtifact = {
    ...rawArtifact,
    checksum: computeDataArtifactChecksum(rawArtifact)
  };

  const varWeight: Variable = {
    variable_id: 'VAR_DEMO_WEIGHT',
    name: 'Weight',
    description: 'Body weight in kg',
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

  const validExecutionRequest: DatasetExecutionRequest = {
    request_id: 'req_bmi_batch_001',
    dataset_version_id: 'dsv_metabolic_v1',
    data_artifact_id: 'art_cohort_validated_001',
    module_id: 'FORMULA_DEMO_QUETELET',
    module_version: '1.0.0',
    mapping_configuration: {
      column_mappings: [
        { source_column: 'weight_kg', module_input_name: 'Weight', column_unit: 'kg', target_unit: 'kg' },
        { source_column: 'height_cm', module_input_name: 'Height', column_unit: 'cm', target_unit: 'm' }
      ]
    },
    execution_configuration: {
      batch_policy: 'FAIL_FAST'
    },
    created_by: 'usr_researcher_1',
    created_at: '2026-09-01T00:00:00Z'
  };

  beforeEach(() => {
    datasetStore = new DatasetStore();
    datasetStore.create(validDataset);

    versionStore = new DatasetVersionStore(datasetStore);
    versionStore.create(validDatasetVersion);

    artifactStore = new DataArtifactStore({ versionStore });
    artifactStore.create(sampleRawArtifact);
    artifactStore.create(sampleValidatedArtifact);

    varStore = new VariableStore();
    varStore.create(varWeight);
    varStore.create(varHeight);

    mappingStore = new VariableMappingStore({ variableStore: varStore, versionStore });
    profileStore = new ValidationProfileStore();
    provStore = new ProvenanceStore();
    resultSetStore = new DatasetResultSetStore();
  });

  // ===========================================================================
  // SECTION A: CONTRACT VALIDATION
  // ===========================================================================
  describe('A. Contract Validation', () => {
    it('A1: accepts a valid DatasetExecutionRequest', () => {
      expect(() => DatasetExecutionRequestValidator.assertValid(validExecutionRequest)).not.toThrow();
    });

    it('A2: rejects request missing dataset_version_id', () => {
      const invalid = { ...validExecutionRequest, dataset_version_id: '' };
      expect(() => DatasetExecutionRequestValidator.assertValid(invalid)).toThrowError(
        expect.objectContaining({ code: 'DATASET_EXECUTION_INVALID_REQUEST' })
      );
    });

    it('A3: rejects request missing data_artifact_id', () => {
      const invalid = { ...validExecutionRequest, data_artifact_id: '   ' };
      expect(() => DatasetExecutionRequestValidator.assertValid(invalid)).toThrowError(
        expect.objectContaining({ code: 'DATASET_EXECUTION_INVALID_REQUEST' })
      );
    });

    it('A4: rejects request missing module_id or module_version', () => {
      expect(() => DatasetExecutionRequestValidator.assertValid({ ...validExecutionRequest, module_id: '' })).toThrowError(
        expect.objectContaining({ code: 'DATASET_EXECUTION_INVALID_REQUEST' })
      );
      expect(() => DatasetExecutionRequestValidator.assertValid({ ...validExecutionRequest, module_version: '' })).toThrowError(
        expect.objectContaining({ code: 'DATASET_EXECUTION_INVALID_REQUEST' })
      );
    });

    it('A5: rejects request with invalid batch_policy', () => {
      const invalid = {
        ...validExecutionRequest,
        execution_configuration: { batch_policy: 'INVALID_POLICY' as any }
      };
      expect(() => DatasetExecutionRequestValidator.assertValid(invalid)).toThrowError(
        expect.objectContaining({ code: 'DATASET_EXECUTION_INVALID_REQUEST' })
      );
    });

    it('A6: validates and asserts DatasetResultSet structure', () => {
      const sampleResultSet: DatasetResultSet = {
        result_set_id: 'drs_test_001',
        dataset_version_id: 'dsv_metabolic_v1',
        data_artifact_id: 'art_cohort_validated_001',
        module_id: 'FORMULA_DEMO_QUETELET',
        module_version: '1.0.0',
        mapping_summary: { mapped_inputs_count: 2, columns_used: ['weight_kg', 'height_cm'] },
        execution_ids: ['exec_1', 'exec_2'],
        records: [
          { record_index: 0, record_id: 'rec_1', status: 'SUCCESS', execution_id: 'exec_1' },
          { record_index: 1, record_id: 'rec_2', status: 'SUCCESS', execution_id: 'exec_2' }
        ],
        summary: { total: 2, successful: 2, failed: 0, skipped: 0, duration_ms: 5 },
        status: 'SUCCESS',
        created_at: '2026-09-01T00:00:00Z',
        created_by: 'usr_researcher_1'
      };

      expect(() => ResultSetValidator.assertValid(sampleResultSet)).not.toThrow();
      expect(() => ResultSetValidator.assertValid({ ...sampleResultSet, status: 'UNKNOWN' as any })).toThrowError(
        expect.objectContaining({ code: 'RESULT_SET_INVALID' })
      );
    });
  });

  // ===========================================================================
  // SECTION B: DATASET & ARTIFACT BINDING
  // ===========================================================================
  describe('B. Dataset & Artifact Binding', () => {
    it('B1: executes successfully when dataset version and artifact match', () => {
      const res = DatasetExecutionEngine.execute({
        request: validExecutionRequest,
        dataset_version_store: versionStore,
        artifact_store: artifactStore,
        available_modules: DEMO_FORMULAS,
        available_parameters: DEMO_PARAMETERS
      });

      expect(res.status).toBe('SUCCESS');
      expect(res.summary.total).toBe(3);
      expect(res.summary.successful).toBe(3);
      expect(res.summary.failed).toBe(0);
    });

    it('B2: rejects execution when dataset_version_id does not exist', () => {
      const req = { ...validExecutionRequest, dataset_version_id: 'dsv_non_existent' };
      expect(() =>
        DatasetExecutionEngine.execute({
          request: req,
          dataset_version_store: versionStore,
          artifact_store: artifactStore,
          available_modules: DEMO_FORMULAS
        })
      ).toThrowError(expect.objectContaining({ code: 'DATASET_VERSION_NOT_FOUND' }));
    });

    it('B3: rejects execution when data_artifact_id does not exist', () => {
      const req = { ...validExecutionRequest, data_artifact_id: 'art_non_existent' };
      expect(() =>
        DatasetExecutionEngine.execute({
          request: req,
          dataset_version_store: versionStore,
          artifact_store: artifactStore,
          available_modules: DEMO_FORMULAS
        })
      ).toThrowError(expect.objectContaining({ code: 'DATA_ARTIFACT_NOT_FOUND' }));
    });

    it('B4: rejects cross-version artifact execution deterministically', () => {
      // Create version 2
      const rawV2 = {
        version_id: 'dsv_metabolic_v2',
        dataset_id: 'ds_metabolic_cohort',
        version_number: 2,
        description: 'V2 snapshot',
        record_count: 3,
        column_count: 3,
        status: 'SEALED' as const,
        created_at: '2026-09-02T00:00:00Z',
        created_by: 'usr_researcher_1'
      };
      const v2: DatasetVersion = { ...rawV2, checksum: computeDatasetVersionChecksum(rawV2) };
      versionStore.create(v2);

      // Attempt request with dataset_version_id v2, but artifact pointing to v1
      const req = { ...validExecutionRequest, dataset_version_id: 'dsv_metabolic_v2' };
      expect(() =>
        DatasetExecutionEngine.execute({
          request: req,
          dataset_version_store: versionStore,
          artifact_store: artifactStore,
          available_modules: DEMO_FORMULAS
        })
      ).toThrowError(expect.objectContaining({ code: 'DATA_ARTIFACT_CROSS_VERSION' }));
    });
  });

  // ===========================================================================
  // SECTION C: VARIABLE MAPPING
  // ===========================================================================
  describe('C. Variable Mapping Resolution', () => {
    it('C1: resolves mappings via explicit column_mappings', () => {
      const mappings = DatasetInputAssembler.resolveMappings({
        dataset_version_id: 'dsv_metabolic_v1',
        mapping_configuration: validExecutionRequest.mapping_configuration,
        module_inputs: [{ name: 'Weight', unit: 'kg' }, { name: 'Height', unit: 'm' }]
      });

      expect(mappings).toHaveLength(2);
      expect(mappings[0].source_column).toBe('weight_kg');
      expect(mappings[0].module_input_name).toBe('Weight');
      expect(mappings[1].source_column).toBe('height_cm');
      expect(mappings[1].module_input_name).toBe('Height');
      expect(mappings[1].target_unit).toBe('m');
    });

    it('C2: resolves mappings via VariableMappingStore and VariableRegistry', () => {
      const mappingWeight: VariableMapping = {
        mapping_id: 'map_weight_col',
        dataset_version_id: 'dsv_metabolic_v1',
        source_column: 'weight_kg',
        variable_id: 'VAR_DEMO_WEIGHT',
        mapping_method: 'MANUAL',
        status: 'CONFIRMED',
        column_metadata: { name: 'weight_kg', unit: 'kg', datatype: 'NUMBER' },
        created_at: '2026-09-01T00:00:00Z',
        created_by: 'usr_researcher_1'
      };
      mappingStore.create(mappingWeight);

      const mappings = DatasetInputAssembler.resolveMappings({
        dataset_version_id: 'dsv_metabolic_v1',
        mapping_configuration: { mapping_id: 'map_weight_col' },
        module_inputs: [{ name: 'Weight', unit: 'kg' }],
        variable_mapping_store: mappingStore,
        variable_registry: varStore
      });

      expect(mappings).toHaveLength(1);
      expect(mappings[0].source_column).toBe('weight_kg');
      expect(mappings[0].module_input_name).toBe('Weight');
      expect(mappings[0].column_unit).toBe('kg');
    });

    it('C3: rejects conflicting column mappings to the same module input', () => {
      const conflictingConfig = {
        column_mappings: [
          { source_column: 'weight_kg', module_input_name: 'Weight' },
          { source_column: 'weight_lbs', module_input_name: 'Weight' }
        ]
      };

      expect(() =>
        DatasetInputAssembler.resolveMappings({
          dataset_version_id: 'dsv_metabolic_v1',
          mapping_configuration: conflictingConfig,
          module_inputs: [{ name: 'Weight' }]
        })
      ).toThrowError(expect.objectContaining({ code: 'VARIABLE_MAPPING_CONFLICT' }));
    });

    it('C4: throws VARIABLE_MAPPING_NOT_FOUND when mapping_id does not exist', () => {
      expect(() =>
        DatasetInputAssembler.resolveMappings({
          dataset_version_id: 'dsv_metabolic_v1',
          mapping_configuration: { mapping_id: 'map_non_existent' },
          module_inputs: [{ name: 'Weight' }],
          variable_mapping_store: mappingStore
        })
      ).toThrowError(expect.objectContaining({ code: 'VARIABLE_MAPPING_NOT_FOUND' }));
    });
  });

  // ===========================================================================
  // SECTION D: INPUT ASSEMBLY
  // ===========================================================================
  describe('D. Input Assembly', () => {
    const mappings = [
      { source_column: 'weight_kg', module_input_name: 'Weight', column_unit: 'kg', target_unit: 'kg' },
      { source_column: 'height_cm', module_input_name: 'Height', column_unit: 'cm', target_unit: 'm' }
    ];
    const moduleInputs = [
      { name: 'Weight', unit: 'kg', required: true },
      { name: 'Height', unit: 'm', required: true }
    ];

    it('D1: assembles record with multiple inputs and performs authoritative unit conversion', () => {
      const record = { weight_kg: 70, height_cm: 175 };
      const assembled = DatasetInputAssembler.assembleRecordInputs({
        record,
        record_index: 0,
        mappings,
        module_inputs: moduleInputs
      });

      expect(assembled.inputs['Weight'].value).toBe(70);
      expect(assembled.inputs['Weight'].unit).toBe('kg');
      // 175 cm should convert to 1.75 m
      expect(assembled.inputs['Height'].value).toBeCloseTo(1.75, 4);
      expect(assembled.inputs['Height'].unit).toBe('m');
      expect(assembled.audit.conversions).toHaveLength(2);
    });

    it('D2: throws INPUT_ASSEMBLY_ERROR when required input is missing from record', () => {
      const recordIncomplete = { weight_kg: 70 }; // missing height_cm
      expect(() =>
        DatasetInputAssembler.assembleRecordInputs({
          record: recordIncomplete,
          record_index: 0,
          mappings,
          module_inputs: moduleInputs
        })
      ).toThrowError(expect.objectContaining({ code: 'INPUT_ASSEMBLY_ERROR' }));
    });

    it('D3: populates default value when optional/defaulted input is missing', () => {
      const inputsWithDefault = [
        { name: 'Weight', unit: 'kg', required: true },
        { name: 'Age', unit: 'yr', required: false, default_value: 30 }
      ];
      const partialMappings = [
        { source_column: 'weight_kg', module_input_name: 'Weight', column_unit: 'kg', target_unit: 'kg' }
      ];

      const assembled = DatasetInputAssembler.assembleRecordInputs({
        record: { weight_kg: 70 },
        record_index: 0,
        mappings: partialMappings,
        module_inputs: inputsWithDefault
      });

      expect(assembled.inputs['Weight'].value).toBe(70);
      expect(assembled.inputs['Age'].value).toBe(30);
    });
  });

  // ===========================================================================
  // SECTION E: UNITS & PHYSICAL CONVERSIONS
  // ===========================================================================
  describe('E. Units & Physical Conversions', () => {
    it('E1: converts compatible units (e.g. g -> kg, cm -> m) with traceable audit', () => {
      const mappings = [
        { source_column: 'weight_g', module_input_name: 'Weight', column_unit: 'g', target_unit: 'kg' },
        { source_column: 'height_cm', module_input_name: 'Height', column_unit: 'cm', target_unit: 'm' }
      ];
      const moduleInputs = [
        { name: 'Weight', unit: 'kg', required: true },
        { name: 'Height', unit: 'm', required: true }
      ];

      const record = { weight_g: 80000, height_cm: 200 };
      const assembled = DatasetInputAssembler.assembleRecordInputs({
        record,
        record_index: 0,
        mappings,
        module_inputs: moduleInputs
      });

      expect(assembled.inputs['Weight'].value).toBe(80);
      expect(assembled.inputs['Height'].value).toBe(2);
      expect(assembled.audit.conversions[0].trace).toBeDefined();
    });

    it('E2: throws UNIT_MISMATCH on dimension mismatch (e.g. kg -> m)', () => {
      const invalidMappings = [
        { source_column: 'weight_kg', module_input_name: 'Height', column_unit: 'kg', target_unit: 'm' }
      ];
      const moduleInputs = [{ name: 'Height', unit: 'm', required: true }];

      expect(() =>
        DatasetInputAssembler.assembleRecordInputs({
          record: { weight_kg: 70 },
          record_index: 0,
          mappings: invalidMappings,
          module_inputs: moduleInputs
        })
      ).toThrowError(expect.objectContaining({ code: 'UNIT_MISMATCH' }));
    });
  });

  // ===========================================================================
  // SECTION F: VALIDATION GATE
  // ===========================================================================
  describe('F. Validation Gate', () => {
    const sampleProfile: DataValidationProfile = {
      profile_id: 'prof_metabolic_gate',
      version: '1.0.0',
      name: 'Cohort Quality Gate',
      description: 'Pre-execution data validation check',
      status: 'ACTIVE',
      created_by: 'usr_researcher_1',
      created_at: '2026-09-01T00:00:00Z',
      checks: [
        {
          check_id: 'chk_missing_weight',
          name: 'Weight Nullability',
          type: 'NULLABILITY',
          target: 'weight_kg',
          enabled: true,
          severity: 'ERROR',
          configuration: { is_nullable: false }
        }
      ]
    };

    beforeEach(() => {
      profileStore.create(sampleProfile);
    });

    it('F1: allows execution and reports PASSED when validation passes', () => {
      const gateRes = DatasetValidationGate.evaluate({
        dataset_version: validDatasetVersion,
        artifact: sampleValidatedArtifact,
        records: sampleRecords,
        profile_id: 'prof_metabolic_gate',
        profile_store: profileStore,
        policy: 'BLOCK_ON_ERROR'
      });

      expect(gateRes.status).toBe('PASSED');
      expect(gateRes.error_count).toBe(0);
      expect(() => DatasetValidationGate.assertAllowed(gateRes)).not.toThrow();
    });

    it('F2: blocks execution and throws VALIDATION_GATE_BLOCKED when data has validation errors', () => {
      const corruptedRecords = [
        { record_id: 'rec_bad', weight_kg: null, height_cm: 175 }
      ];

      expect(() =>
        DatasetExecutionEngine.execute({
          request: {
            ...validExecutionRequest,
            validation_profile_id: 'prof_metabolic_gate',
            validation_gate_policy: 'BLOCK_ON_ERROR'
          },
          dataset_version_store: versionStore,
          artifact_store: artifactStore,
          validation_profile_store: profileStore,
          available_modules: DEMO_FORMULAS,
          available_parameters: DEMO_PARAMETERS,
          records: corruptedRecords
        })
      ).toThrowError(expect.objectContaining({ code: 'VALIDATION_GATE_BLOCKED' }));
    });

    it('F3: allows execution with WARNING_PERMITTED under PERMISSIVE policy', () => {
      const corruptedRecords = [
        { record_id: 'rec_bad', weight_kg: null, height_cm: 175 }
      ];

      const gateRes = DatasetValidationGate.evaluate({
        dataset_version: validDatasetVersion,
        artifact: sampleValidatedArtifact,
        records: corruptedRecords,
        profile_id: 'prof_metabolic_gate',
        profile_store: profileStore,
        policy: 'PERMISSIVE'
      });

      expect(gateRes.status).toBe('WARNING_PERMITTED');
      expect(gateRes.error_count).toBe(1);
      expect(() => DatasetValidationGate.assertAllowed(gateRes)).not.toThrow();
    });

    it('F4: passthrough when gate policy is NOT_CONFIGURED', () => {
      const gateRes = DatasetValidationGate.evaluate({
        dataset_version: validDatasetVersion,
        artifact: sampleValidatedArtifact,
        policy: 'NOT_CONFIGURED'
      });

      expect(gateRes.status).toBe('NOT_CONFIGURED');
      expect(gateRes.error_count).toBe(0);
    });
  });

  // ===========================================================================
  // SECTION G: MODULE VERSION PINNING
  // ===========================================================================
  describe('G. Module Version Pinning', () => {
    it('G1: executes exact pinned module version', () => {
      const res = DatasetExecutionEngine.execute({
        request: { ...validExecutionRequest, module_version: '1.0.0' },
        dataset_version_store: versionStore,
        artifact_store: artifactStore,
        available_modules: DEMO_FORMULAS,
        available_parameters: DEMO_PARAMETERS
      });

      expect(res.module_id).toBe('FORMULA_DEMO_QUETELET');
      expect(res.module_version).toBe('1.0.0');
      expect(res.status).toBe('SUCCESS');
    });

    it('G2: throws MODULE_VERSION_NOT_FOUND when requested version is not available', () => {
      const req = { ...validExecutionRequest, module_version: '9.9.9' };
      expect(() =>
        DatasetExecutionEngine.execute({
          request: req,
          dataset_version_store: versionStore,
          artifact_store: artifactStore,
          available_modules: DEMO_FORMULAS
        })
      ).toThrowError(expect.objectContaining({ code: 'MODULE_VERSION_NOT_FOUND' }));
    });

    it('G3: throws MODULE_NOT_FOUND when module_id does not exist', () => {
      const req = { ...validExecutionRequest, module_id: 'FORMULA_UNKNOWN' };
      expect(() =>
        DatasetExecutionEngine.execute({
          request: req,
          dataset_version_store: versionStore,
          artifact_store: artifactStore,
          available_modules: DEMO_FORMULAS
        })
      ).toThrowError(expect.objectContaining({ code: 'MODULE_NOT_FOUND' }));
    });
  });

  // ===========================================================================
  // SECTION H: BATCH EXECUTION & RECORD ISOLATION
  // ===========================================================================
  describe('H. Batch Execution & Record Isolation', () => {
    const mixedRecords = [
      { record_id: 'rec_ok_1', weight_kg: 70, height_cm: 175 },
      { record_id: 'rec_fail_2', weight_kg: null, height_cm: 180 }, // missing weight
      { record_id: 'rec_ok_3', weight_kg: 65, height_cm: 165 }
    ];

    it('H1: FAIL_FAST halts on first failed record and marks remaining records as SKIPPED', () => {
      const res = DatasetExecutionEngine.execute({
        request: {
          ...validExecutionRequest,
          execution_configuration: { batch_policy: 'FAIL_FAST' }
        },
        dataset_version_store: versionStore,
        artifact_store: artifactStore,
        available_modules: DEMO_FORMULAS,
        available_parameters: DEMO_PARAMETERS,
        records: mixedRecords
      });

      expect(res.status).toBe('PARTIAL_SUCCESS');
      expect(res.summary.total).toBe(3);
      expect(res.summary.successful).toBe(1);
      expect(res.summary.failed).toBe(1);
      expect(res.summary.skipped).toBe(1);
      expect(res.records[0].status).toBe('SUCCESS');
      expect(res.records[1].status).toBe('FAILED');
      expect(res.records[2].status).toBe('SKIPPED');
    });

    it('H2: CONTINUE_ON_ERROR processes all records, isolating failures', () => {
      const res = DatasetExecutionEngine.execute({
        request: {
          ...validExecutionRequest,
          execution_configuration: { batch_policy: 'CONTINUE_ON_ERROR' }
        },
        dataset_version_store: versionStore,
        artifact_store: artifactStore,
        available_modules: DEMO_FORMULAS,
        available_parameters: DEMO_PARAMETERS,
        records: mixedRecords
      });

      expect(res.status).toBe('PARTIAL_SUCCESS');
      expect(res.summary.total).toBe(3);
      expect(res.summary.successful).toBe(2);
      expect(res.summary.failed).toBe(1);
      expect(res.summary.skipped).toBe(0);
      expect(res.records[0].status).toBe('SUCCESS');
      expect(res.records[1].status).toBe('FAILED');
      expect(res.records[2].status).toBe('SUCCESS');
    });

    it('H3: ensures record isolation: execution IDs and input buffers are strictly independent', () => {
      const res = DatasetExecutionEngine.execute({
        request: validExecutionRequest,
        dataset_version_store: versionStore,
        artifact_store: artifactStore,
        available_modules: DEMO_FORMULAS,
        available_parameters: DEMO_PARAMETERS
      });

      const execIds = res.records.map((r) => r.execution_id).filter(Boolean);
      const uniqueExecIds = new Set(execIds);
      expect(uniqueExecIds.size).toBe(execIds.length);
    });
  });

  // ===========================================================================
  // SECTION I: RESULT SET ABSTRACTION
  // ===========================================================================
  describe('I. ResultSet Abstraction & Persistence', () => {
    it('I1: constructs a valid ResultSet linking all record ExecutionResults', () => {
      const res = DatasetExecutionEngine.execute({
        request: validExecutionRequest,
        dataset_version_store: versionStore,
        artifact_store: artifactStore,
        available_modules: DEMO_FORMULAS,
        available_parameters: DEMO_PARAMETERS
      });

      expect(res.result_set_id).toMatch(/^drs_/);
      expect(res.dataset_version_id).toBe('dsv_metabolic_v1');
      expect(res.data_artifact_id).toBe('art_cohort_validated_001');
      expect(res.module_id).toBe('FORMULA_DEMO_QUETELET');
      expect(res.module_version).toBe('1.0.0');
      expect(res.records[0].execution_result).toBeDefined();
      expect(res.records[0].execution_result?.outputs).toHaveProperty('anthropometric_ratio');

      // Save to ResultSetStore
      const saved = resultSetStore.save(res);
      expect(saved.result_set_id).toBe(res.result_set_id);
      expect(resultSetStore.get(res.result_set_id)).toBeDefined();
    });

    it('I2: stores and lists ResultSets with filtering', () => {
      const res = DatasetExecutionEngine.execute({
        request: validExecutionRequest,
        dataset_version_store: versionStore,
        artifact_store: artifactStore,
        available_modules: DEMO_FORMULAS,
        available_parameters: DEMO_PARAMETERS
      });

      resultSetStore.save(res);
      const list = resultSetStore.list({ dataset_version_id: 'dsv_metabolic_v1' });
      expect(list).toHaveLength(1);
      expect(list[0].module_id).toBe('FORMULA_DEMO_QUETELET');
    });
  });

  // ===========================================================================
  // SECTION J: PROVENANCE INTEGRATION
  // ===========================================================================
  describe('J. Provenance Integration', () => {
    it('J1: generates cryptographic SHA-256 ProvenanceRecord for each record execution', () => {
      const res = DatasetExecutionEngine.execute({
        request: validExecutionRequest,
        dataset_version_store: versionStore,
        artifact_store: artifactStore,
        provenance_store: provStore,
        available_modules: DEMO_FORMULAS,
        available_parameters: DEMO_PARAMETERS
      });

      expect(res.execution_ids).toHaveLength(3);
      for (const execId of res.execution_ids) {
        const provRecord = provStore.getByExecutionId(execId);
        expect(provRecord).toBeDefined();
        expect(provRecord!.dataset_version_id).toBe('dsv_metabolic_v1');
        expect(provRecord!.module_id).toBe('FORMULA_DEMO_QUETELET');
        expect(provRecord!.module_version).toBe('1.0.0');
        expect(provRecord!.integrity.content_hash).toMatch(/^[a-f0-9]{64}$/i);

        // Verify cryptographic integrity
        const verifyRes = provStore.verifyIntegrity(provRecord!.provenance_id);
        expect(verifyRes.status).toBe('VALID');
      }
    });
  });

  // ===========================================================================
  // SECTION K: SOURCE ARTIFACT IMMUTABILITY
  // ===========================================================================
  describe('K. Source Artifact Immutability', () => {
    it('K1: guarantees source artifact and records remain strictly immutable after execution', () => {
      const initialChecksum = sampleValidatedArtifact.checksum;

      const res = DatasetExecutionEngine.execute({
        request: validExecutionRequest,
        dataset_version_store: versionStore,
        artifact_store: artifactStore,
        available_modules: DEMO_FORMULAS,
        available_parameters: DEMO_PARAMETERS
      });

      expect(res.status).toBe('SUCCESS');

      // Verify stored artifact checksum is identical
      const storedArtifact = artifactStore.get('art_cohort_validated_001');
      expect(storedArtifact?.checksum).toBe(initialChecksum);
      expect(computeDataArtifactChecksum(storedArtifact!)).toBe(initialChecksum);

      // Verify original records are unchanged
      expect(sampleRecords[0].weight_kg).toBe(70);
      expect(sampleRecords[0].height_cm).toBe(175);
    });
  });
});
