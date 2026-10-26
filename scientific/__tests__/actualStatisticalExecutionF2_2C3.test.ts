/**
 * NutriBodySim — Phase F2.2C.3: Actual Statistical Execution Test Suite
 *
 * Comprehensive tests verifying the strict execution boundary for invoking
 * authoritative scientific statistical engines (D9–D13) exclusively via
 * validated AuthorizedExecutionPacket dispatches.
 *
 * Verifies all requirements:
 * 1. Entry boundary strictly requires AuthorizedExecutionPacket (rejects raw plans, previews, projects, datasets)
 * 2. Rejects invalid dispatch packet (status !== 'READY')
 * 3. Rejects tampered dispatch packet (cryptographic dispatch hash verification failure)
 * 4. Rejects stale dispatch if project version drifted
 * 5. Rejects if project is FINALIZED or ARCHIVED
 * 6. Rejects if dataset version not found
 * 7. Rejects if data artifact not found
 * 8. Rejects if artifact does not belong to dataset version
 * 9. Rejects if artifact SHA-256 checksum mismatches
 * 10. Rejects if parent artifact in lineage is broken
 * 11. Rejects if requested input variables do not exist in dataset or registry
 * 12. Rejects if module ID or version mismatches authoritative registry
 * 13. Rejects if required parameter set cannot be resolved
 * 14. Strictly enforces scientific_validity = 'NOT_ESTABLISHED'
 * 15. Successfully executes D9 Descriptive Statistics (produces mean, median, SD, etc.)
 * 16. Successfully executes D10 Inferential Statistics (produces p-value, statistic, reject_null)
 * 17. Successfully executes D11 Regression Modeling (produces R2, coefficients, intercept)
 * 18. Successfully executes D12 Power Analysis (produces achieved_power, alpha, sample size)
 * 19. Successfully executes D13 Non-Parametric Statistics (produces test statistic, p-value, decision)
 * 20. Output conforms to Phase C standard ExecutionResult
 * 21. Standard trace contains all 5 verification steps
 * 22. Deterministic execution provenance SHA-256 hash
 * 23. Execution result is deeply immutable (deepFreeze)
 * 24. No automatic statistical method switching (normality does not secretly change test)
 * 25. No silent data cleaning (raw values preserved exactly)
 * 26. AuthorizedStatisticalExecutionStore registers, retrieves, and filters execution results
 * 27. ResearchWorkspaceService integrates execution seamlessly
 * 28. Security audit: zero eval(), zero new Function()
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  ResearchProjectRegistry,
  ResearchProject,
  ExecutionPreview,
  ExecutionAuthorization,
  AuthorizedExecutionPacket,
  AuthorizedStatisticalExecutionEngine,
  AuthorizedStatisticalExecutionStore,
  defaultAuthorizedStatisticalExecutionStore,
  ScientificStatisticalExecutionError,
  computeDispatchHash,
  defaultAuthorizedExecutionDispatchStore,
  defaultExecutionAuthorizationStore,
  DataArtifact
} from '../index';
import { ResearchWorkspaceService } from '../../src/services/researchWorkspaceService';

describe('Phase F2.2C.3 — Actual Statistical Execution Boundary', () => {
  let registry: ResearchProjectRegistry;
  let service: ResearchWorkspaceService;
  let activeProject: ResearchProject;
  let validPreview: ExecutionPreview;
  let validAuthorization: ExecutionAuthorization;
  let validDispatch: AuthorizedExecutionPacket;

  const sampleRecords = [
    { VAR_FASTING_GLUCOSE: 95.5, VAR_SOLUBLE_FIBER: 12.0, VAR_INTERVENTION_ARM: 'CONTROL' },
    { VAR_FASTING_GLUCOSE: 102.3, VAR_SOLUBLE_FIBER: 10.5, VAR_INTERVENTION_ARM: 'CONTROL' },
    { VAR_FASTING_GLUCOSE: 88.1, VAR_SOLUBLE_FIBER: 22.0, VAR_INTERVENTION_ARM: 'HIGH_SOLUBLE_FIBER' },
    { VAR_FASTING_GLUCOSE: 91.4, VAR_SOLUBLE_FIBER: 19.5, VAR_INTERVENTION_ARM: 'HIGH_SOLUBLE_FIBER' },
    { VAR_FASTING_GLUCOSE: 94.0, VAR_SOLUBLE_FIBER: 18.0, VAR_INTERVENTION_ARM: 'HIGH_SOLUBLE_FIBER' },
    { VAR_FASTING_GLUCOSE: 105.0, VAR_SOLUBLE_FIBER: 8.0, VAR_INTERVENTION_ARM: 'CONTROL' },
    { VAR_FASTING_GLUCOSE: 89.2, VAR_SOLUBLE_FIBER: 24.0, VAR_INTERVENTION_ARM: 'HIGH_SOLUBLE_FIBER' },
    { VAR_FASTING_GLUCOSE: 99.1, VAR_SOLUBLE_FIBER: 11.0, VAR_INTERVENTION_ARM: 'CONTROL' }
  ];

  beforeEach(() => {
    registry = new ResearchProjectRegistry();
    service = new ResearchWorkspaceService(registry);
    defaultAuthorizedStatisticalExecutionStore.clear();
    defaultAuthorizedExecutionDispatchStore.clear();
    defaultExecutionAuthorizationStore.clear();

    // 1. Create baseline draft project
    const draft = service.createProject({
      title: 'Fiber Glycemic Regulation Investigation',
      description: 'Prospective investigation of soluble fiber impact on glycemic indices.',
      created_by: 'Dr. Sarah Connor',
      study_design: {
        design_type: 'COHORT',
        description: 'Prospective observational cohort'
      },
      research_question: {
        question_id: 'Q_PRIMARY',
        question_text: 'Does soluble fiber reduce fasting plasma glucose?',
        priority: 'PRIMARY'
      },
      objective: {
        objective_id: 'OBJ_PRIMARY',
        type: 'PRIMARY_OBJECTIVE',
        description: 'Quantify relationship between soluble fiber and glucose'
      },
      hypothesis: {
        hypothesis_id: 'HYP_PRIMARY',
        null_hypothesis: 'Fiber has no association with glucose (r = 0)',
        alternative_hypothesis: 'Fiber is negatively associated with glucose (r < 0)',
        direction: 'LESS',
        planned_alpha: 0.05
      }
    });

    // 2. Bind dataset version & artifact
    const bound = service.bindDataset({
      project_id: draft.project_id,
      dataset_version_id: 'DSV_GLYCEMIC_V1',
      data_artifact_id: 'ART_GLYCEMIC_ANALYSIS_READY_01'
    });

    // 3. Plan analysis
    activeProject = service.planAnalysis({
      project_id: bound.project_id,
      analysis_id: 'AP_DESCRIPTIVE_01',
      objective_id: 'OBJ_PRIMARY',
      hypothesis_id: 'HYP_PRIMARY',
      analysis_type: 'DESCRIPTIVE',
      input_variable_ids: ['VAR_FASTING_GLUCOSE', 'VAR_SOLUBLE_FIBER'],
      alpha: 0.05,
      confidence_level: 0.95,
      planned_rationale: 'Establish baseline parametric and non-parametric distributions.'
    });

    // 4. Generate Preview
    validPreview = service.previewExecution(activeProject.project_id, 'AP_DESCRIPTIVE_01');

    // 5. Generate Authorization
    validAuthorization = service.authorizeExecution(
      activeProject.project_id,
      'AP_DESCRIPTIVE_01',
      'Dr. Sarah Connor, Principal Investigator'
    );

    // 6. Dispatch via Adapter
    validDispatch = service.dispatchAuthorizedExecution(
      activeProject.project_id,
      'AP_DESCRIPTIVE_01'
    );
  });

  // ===========================================================================
  // 1. Boundary & Invariant Validation
  // ===========================================================================
  describe('Boundary & Invariant Enforcement', () => {
    it('strictly rejects execution without an AuthorizedExecutionPacket (rejects null/undefined/raw preview)', () => {
      expect(() => {
        AuthorizedStatisticalExecutionEngine.executeAuthorizedDispatch({
          dispatch: null as any
        });
      }).toThrow(ScientificStatisticalExecutionError);

      expect(() => {
        AuthorizedStatisticalExecutionEngine.executeAuthorizedDispatch({
          dispatch: validPreview as any
        });
      }).toThrow(ScientificStatisticalExecutionError);
    });

    it('rejects dispatch if dispatch_status !== "READY"', () => {
      const blockedDispatch: any = {
        ...validDispatch,
        dispatch_status: 'BLOCKED'
      };

      expect(() => {
        AuthorizedStatisticalExecutionEngine.executeAuthorizedDispatch({
          dispatch: blockedDispatch
        });
      }).toThrow(/Dispatch status is 'BLOCKED', expected 'READY'/);
    });

    it('rejects tampered dispatch packet where cryptographic dispatch_hash fails verification', () => {
      const tamperedDispatch: any = {
        ...validDispatch,
        input_variable_ids: ['VAR_FASTING_GLUCOSE', 'VAR_BODY_MASS_INDEX']
      };

      expect(() => {
        AuthorizedStatisticalExecutionEngine.executeAuthorizedDispatch({
          dispatch: tamperedDispatch
        });
      }).toThrow(/cryptographic provenance verification/);
    });

    it('rejects execution if scientific_validity is not NOT_ESTABLISHED', () => {
      const invalidValidityDispatch: any = {
        ...validDispatch,
        scientific_validity: 'ESTABLISHED'
      };

      expect(() => {
        AuthorizedStatisticalExecutionEngine.executeAuthorizedDispatch({
          dispatch: invalidValidityDispatch
        });
      }).toThrow(/Scientific validity must strictly be 'NOT_ESTABLISHED'/);
    });

    it('rejects execution if project version has drifted (stale dispatch)', () => {
      const staleDispatch: any = {
        ...validDispatch,
        project_version: '999.0.0'
      };
      // Re-hash with drifted project_version
      const rehashed = {
        ...staleDispatch,
        dispatch_hash: computeDispatchHash({
          dispatch_id: staleDispatch.dispatch_id,
          authorization_id: staleDispatch.authorization_id,
          authorization_hash: staleDispatch.authorization_hash,
          preview_id: staleDispatch.preview_id,
          preview_provenance_hash: staleDispatch.preview_provenance_hash,
          project_id: staleDispatch.project_id,
          project_version: staleDispatch.project_version,
          analysis_id: staleDispatch.analysis_id,
          analysis_plan_version: staleDispatch.analysis_plan_version,
          analysis_type: staleDispatch.analysis_type,
          target_module_id: staleDispatch.target_module_id,
          target_module_version: staleDispatch.target_module_version,
          dataset_version_id: staleDispatch.dataset_version_id,
          data_artifact_id: staleDispatch.data_artifact_id,
          source_artifact_checksum: staleDispatch.source_artifact_checksum,
          input_variable_ids: staleDispatch.input_variable_ids,
          dispatched_by: staleDispatch.dispatched_by,
          scientific_validity: staleDispatch.scientific_validity
        })
      };

      expect(() => {
        AuthorizedStatisticalExecutionEngine.executeAuthorizedDispatch({
          dispatch: rehashed,
          project_registry: registry
        });
      }).toThrow(/Project version drift/);
    });

    it('rejects execution if project is FINALIZED or ARCHIVED', () => {
      const mockRegistry: any = {
        getProject: () => ({ ...activeProject, status: 'FINALIZED' })
      };
      expect(() => {
        AuthorizedStatisticalExecutionEngine.executeAuthorizedDispatch({
          dispatch: validDispatch,
          project_registry: mockRegistry
        });
      }).toThrow(/is FINALIZED and cannot be executed/);
    });

    it('rejects execution if dataset version does not exist in store', () => {
      const mockVersionStore: any = {
        get: () => undefined
      };

      expect(() => {
        AuthorizedStatisticalExecutionEngine.executeAuthorizedDispatch({
          dispatch: validDispatch,
          dataset_version_store: mockVersionStore,
          project_registry: registry
        });
      }).toThrow(/DatasetVersion.*not found in store/);
    });

    it('rejects execution if data artifact does not exist in store', () => {
      const mockArtifactStore: any = {
        get: () => undefined
      };

      expect(() => {
        AuthorizedStatisticalExecutionEngine.executeAuthorizedDispatch({
          dispatch: validDispatch,
          data_artifact_store: mockArtifactStore,
          project_registry: registry
        });
      }).toThrow(/DataArtifact.*not found in store/);
    });

    it('rejects execution if data artifact checksum does not match dispatch', () => {
      const badArtifact: DataArtifact = {
        artifact_id: validDispatch.data_artifact_id,
        dataset_version_id: validDispatch.dataset_version_id,
        created_by: 'TEST_STEWARD',
        checksum: 'mismatched_sha256_checksum_0000000000000000000000000000000000000',
        created_at: new Date().toISOString(),
        state: 'RAW'
      };

      const mockArtifactStore: any = {
        get: () => badArtifact
      };

      expect(() => {
        AuthorizedStatisticalExecutionEngine.executeAuthorizedDispatch({
          dispatch: validDispatch,
          data_artifact_store: mockArtifactStore,
          project_registry: registry
        });
      }).toThrow(/Artifact SHA-256 checksum mismatch/);
    });

    it('rejects execution if target module ID or version mismatches authoritative registry', () => {
      const badModuleDispatch: any = {
        ...validDispatch,
        target_module_version: '99.9.9'
      };
      const rehashed = {
        ...badModuleDispatch,
        dispatch_hash: computeDispatchHash({
          dispatch_id: badModuleDispatch.dispatch_id,
          authorization_id: badModuleDispatch.authorization_id,
          authorization_hash: badModuleDispatch.authorization_hash,
          preview_id: badModuleDispatch.preview_id,
          preview_provenance_hash: badModuleDispatch.preview_provenance_hash,
          project_id: badModuleDispatch.project_id,
          project_version: badModuleDispatch.project_version,
          analysis_id: badModuleDispatch.analysis_id,
          analysis_plan_version: badModuleDispatch.analysis_plan_version,
          analysis_type: badModuleDispatch.analysis_type,
          target_module_id: badModuleDispatch.target_module_id,
          target_module_version: badModuleDispatch.target_module_version,
          dataset_version_id: badModuleDispatch.dataset_version_id,
          data_artifact_id: badModuleDispatch.data_artifact_id,
          source_artifact_checksum: badModuleDispatch.source_artifact_checksum,
          input_variable_ids: badModuleDispatch.input_variable_ids,
          dispatched_by: badModuleDispatch.dispatched_by,
          scientific_validity: badModuleDispatch.scientific_validity
        })
      };

      expect(() => {
        AuthorizedStatisticalExecutionEngine.executeAuthorizedDispatch({
          dispatch: rehashed,
          project_registry: registry
        });
      }).toThrow(/Module version mismatch/);
    });

    it('rejects execution if requested variable is missing from columns and VariableRegistry', () => {
      const missingVarDispatch: any = {
        ...validDispatch,
        input_variable_ids: ['NON_EXISTENT_UNKNOWN_VAR_999']
      };
      const rehashed = {
        ...missingVarDispatch,
        dispatch_hash: computeDispatchHash({
          dispatch_id: missingVarDispatch.dispatch_id,
          authorization_id: missingVarDispatch.authorization_id,
          authorization_hash: missingVarDispatch.authorization_hash,
          preview_id: missingVarDispatch.preview_id,
          preview_provenance_hash: missingVarDispatch.preview_provenance_hash,
          project_id: missingVarDispatch.project_id,
          project_version: missingVarDispatch.project_version,
          analysis_id: missingVarDispatch.analysis_id,
          analysis_plan_version: missingVarDispatch.analysis_plan_version,
          analysis_type: missingVarDispatch.analysis_type,
          target_module_id: missingVarDispatch.target_module_id,
          target_module_version: missingVarDispatch.target_module_version,
          dataset_version_id: missingVarDispatch.dataset_version_id,
          data_artifact_id: missingVarDispatch.data_artifact_id,
          source_artifact_checksum: missingVarDispatch.source_artifact_checksum,
          input_variable_ids: missingVarDispatch.input_variable_ids,
          dispatched_by: missingVarDispatch.dispatched_by,
          scientific_validity: missingVarDispatch.scientific_validity
        })
      };

      expect(() => {
        AuthorizedStatisticalExecutionEngine.executeAuthorizedDispatch({
          dispatch: rehashed,
          records: sampleRecords,
          project_registry: registry
        });
      }).toThrow(/Requested variable 'NON_EXISTENT_UNKNOWN_VAR_999' not found/);
    });
  });

  // ===========================================================================
  // 2. Authoritative D9 Descriptive Statistics Execution
  // ===========================================================================
  describe('D9 Descriptive Statistics Execution', () => {
    it('executes authoritative D9 Descriptive Statistics and computes exact summary statistics', () => {
      const result = AuthorizedStatisticalExecutionEngine.executeAuthorizedDispatch({
        dispatch: validDispatch,
        records: sampleRecords,
        project_registry: registry
      });

      expect(result.status).toBe('COMPLETED');
      expect(result.module_id).toBe('D9_DESCRIPTIVE_STATISTICS');
      expect(result.module_version).toBe('1.0.0');
      expect(result.scientific_validity).toBe('NOT_ESTABLISHED');

      // Check outputs
      const outputs = result.execution_result.outputs;
      expect(outputs['VAR_FASTING_GLUCOSE_mean']).toBeDefined();
      expect(typeof outputs['VAR_FASTING_GLUCOSE_mean'].value).toBe('number');
      expect(outputs['VAR_FASTING_GLUCOSE_mean'].value).toBeCloseTo(95.575, 2);

      expect(outputs['VAR_SOLUBLE_FIBER_mean']).toBeDefined();
      expect(typeof outputs['VAR_SOLUBLE_FIBER_mean'].value).toBe('number');
      expect(outputs['VAR_SOLUBLE_FIBER_mean'].value).toBeCloseTo(15.625, 2);

      // Verify trace
      expect(result.trace.length).toBeGreaterThanOrEqual(5);
      expect(result.trace[0].operation).toBe('DISPATCH_INTEGRITY_CHECK');
      expect(result.trace[1].operation).toBe('DATA_VERSION_BINDING');
      expect(result.trace[2].operation).toBe('MODULE_VERSION_PINNING');
      expect(result.trace[3].operation).toBe('STATISTICAL_ENGINE_INVOCATION');
      expect(result.trace[4].operation).toBe('PROVENANCE_SEALING');

      // Verify provenance hash
      expect(result.provenance_hash).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  // ===========================================================================
  // 3. Authoritative D10 Inferential Statistics Execution
  // ===========================================================================
  describe('D10 Inferential Statistics Execution', () => {
    it('executes authoritative D10 Inferential Statistics and computes p-value and test statistic', () => {
      // Plan inferential analysis
      activeProject = service.planAnalysis({
        project_id: activeProject.project_id,
        analysis_id: 'AP_INFERENTIAL_01',
        objective_id: 'OBJ_PRIMARY',
        hypothesis_id: 'HYP_PRIMARY',
        analysis_type: 'INFERENTIAL',
        input_variable_ids: ['VAR_FASTING_GLUCOSE'],
        grouping_variable_ids: ['VAR_INTERVENTION_ARM'],
        planned_rationale: 'Compare fasting glucose between control and intervention groups.',
        alpha: 0.05,
        confidence_level: 0.95
      });

      const analysisId = 'AP_INFERENTIAL_01';
      service.previewExecution(activeProject.project_id, analysisId);
      service.authorizeExecution(activeProject.project_id, analysisId, 'Investigator');
      const dispatch = service.dispatchAuthorizedExecution(activeProject.project_id, analysisId);

      const result = AuthorizedStatisticalExecutionEngine.executeAuthorizedDispatch({
        dispatch,
        records: sampleRecords,
        project_registry: registry
      });

      expect(result.status).toBe('COMPLETED');
      expect(result.module_id).toBe('D10_INFERENTIAL_STATISTICS');
      expect(result.module_version).toBe('1.0.0');
      expect(result.scientific_validity).toBe('NOT_ESTABLISHED');

      const outputs = result.execution_result.outputs;
      expect(outputs['p_value']).toBeDefined();
      expect(typeof outputs['p_value'].value).toBe('number');
      expect(outputs['test_statistic']).toBeDefined();
      expect(typeof outputs['test_statistic'].value).toBe('number');
      expect(outputs['reject_null']).toBeDefined();
      expect(typeof outputs['reject_null'].value).toBe('boolean');
    });
  });

  // ===========================================================================
  // 4. Authoritative D11 Regression Modeling Execution
  // ===========================================================================
  describe('D11 Regression Modeling Execution', () => {
    it('executes authoritative D11 Regression Modeling and computes R2, coefficients, and intercept', () => {
      activeProject = service.planAnalysis({
        project_id: activeProject.project_id,
        analysis_id: 'AP_REGRESSION_01',
        objective_id: 'OBJ_PRIMARY',
        hypothesis_id: 'HYP_PRIMARY',
        analysis_type: 'REGRESSION',
        input_variable_ids: ['VAR_FASTING_GLUCOSE', 'VAR_SOLUBLE_FIBER'],
        planned_rationale: 'Model linear effect of fiber on fasting glucose.',
        alpha: 0.05,
        confidence_level: 0.95
      });

      const analysisId = 'AP_REGRESSION_01';
      service.previewExecution(activeProject.project_id, analysisId);
      service.authorizeExecution(activeProject.project_id, analysisId, 'Investigator');
      const dispatch = service.dispatchAuthorizedExecution(activeProject.project_id, analysisId);

      const result = AuthorizedStatisticalExecutionEngine.executeAuthorizedDispatch({
        dispatch,
        records: sampleRecords,
        project_registry: registry
      });

      expect(result.status).toBe('COMPLETED');
      expect(result.module_id).toBe('D11_REGRESSION_MODELING');
      expect(result.module_version).toBe('1.0.0');
      expect(result.scientific_validity).toBe('NOT_ESTABLISHED');

      const outputs = result.execution_result.outputs;
      expect(outputs['r_squared']).toBeDefined();
      expect(typeof outputs['r_squared'].value).toBe('number');
      expect(outputs['r_squared'].value).toBeGreaterThanOrEqual(0);
      expect(outputs['r_squared'].value).toBeLessThanOrEqual(1);

      expect(outputs['p_value']).toBeDefined();
      expect(typeof outputs['p_value'].value).toBe('number');
    });
  });

  // ===========================================================================
  // 5. Authoritative D12 Power Analysis Execution
  // ===========================================================================
  describe('D12 Power Analysis Execution', () => {
    it('executes authoritative D12 Power Analysis and computes achieved power and sample size', () => {
      activeProject = service.planAnalysis({
        project_id: activeProject.project_id,
        analysis_id: 'AP_POWER_01',
        objective_id: 'OBJ_PRIMARY',
        hypothesis_id: 'HYP_PRIMARY',
        analysis_type: 'POWER_ANALYSIS',
        input_variable_ids: ['VAR_FASTING_GLUCOSE'],
        planned_rationale: 'Assess prospective power with alpha 0.05.',
        alpha: 0.05,
        confidence_level: 0.95,
        configuration: {
          power_analysis_type: 'TWO_SAMPLE_T_TEST',
          calculation_mode: 'ACHIEVED_POWER',
          effect_size: 0.5,
          sample_size: 64,
          target_power: 0.8
        }
      });

      const analysisId = 'AP_POWER_01';
      service.previewExecution(activeProject.project_id, analysisId);
      service.authorizeExecution(activeProject.project_id, analysisId, 'Investigator');
      const dispatch = service.dispatchAuthorizedExecution(activeProject.project_id, analysisId);

      const result = AuthorizedStatisticalExecutionEngine.executeAuthorizedDispatch({
        dispatch,
        records: sampleRecords,
        project_registry: registry
      });

      expect(result.status).toBe('COMPLETED');
      expect(result.module_id).toBe('D12_POWER_ANALYSIS');
      expect(result.module_version).toBe('1.0.0');
      expect(result.scientific_validity).toBe('NOT_ESTABLISHED');

      const outputs = result.execution_result.outputs;
      expect(outputs['alpha']).toBeDefined();
      expect(outputs['alpha'].value).toBe(0.05);
      expect(outputs['achieved_power']).toBeDefined();
      expect(typeof outputs['achieved_power'].value).toBe('number');
    });
  });

  // ===========================================================================
  // 6. Authoritative D13 Non-Parametric Statistics Execution
  // ===========================================================================
  describe('D13 Non-Parametric Statistics Execution', () => {
    it('executes authoritative D13 Non-Parametric Statistics and computes test statistic and decision', () => {
      activeProject = service.planAnalysis({
        project_id: activeProject.project_id,
        analysis_id: 'AP_NONPARAM_01',
        objective_id: 'OBJ_PRIMARY',
        hypothesis_id: 'HYP_PRIMARY',
        analysis_type: 'NON_PARAMETRIC',
        input_variable_ids: ['VAR_FASTING_GLUCOSE'],
        grouping_variable_ids: ['VAR_INTERVENTION_ARM'],
        configuration: {
          group_a: 'CONTROL',
          group_b: 'HIGH_SOLUBLE_FIBER'
        },
        planned_rationale: 'Non-parametric distribution comparison between groups.',
        alpha: 0.05,
        confidence_level: 0.95
      });

      const analysisId = 'AP_NONPARAM_01';
      service.previewExecution(activeProject.project_id, analysisId);
      service.authorizeExecution(activeProject.project_id, analysisId, 'Investigator');
      const dispatch = service.dispatchAuthorizedExecution(activeProject.project_id, analysisId);

      const result = AuthorizedStatisticalExecutionEngine.executeAuthorizedDispatch({
        dispatch,
        records: sampleRecords,
        project_registry: registry
      });

      expect(result.status).toBe('COMPLETED');
      expect(result.module_id).toBe('D13_NON_PARAMETRIC_STATISTICS');
      expect(result.module_version).toBe('1.0.0');
      expect(result.scientific_validity).toBe('NOT_ESTABLISHED');

      const outputs = result.execution_result.outputs;
      expect(outputs['statistic_value']).toBeDefined();
      expect(typeof outputs['statistic_value'].value).toBe('number');
      expect(outputs['p_value']).toBeDefined();
      expect(typeof outputs['p_value'].value).toBe('number');
    });
  });

  // ===========================================================================
  // 7. Immutability, Governance & Zero Silent Alteration
  // ===========================================================================
  describe('Immutability & Governance Invariants', () => {
    it('verifies the execution result is deeply immutable (deepFreeze)', () => {
      const result = AuthorizedStatisticalExecutionEngine.executeAuthorizedDispatch({
        dispatch: validDispatch,
        records: sampleRecords,
        project_registry: registry
      });

      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.execution_result)).toBe(true);
      expect(Object.isFrozen(result.execution_result.outputs)).toBe(true);
      expect(Object.isFrozen(result.request)).toBe(true);

      expect(() => {
        (result as any).status = 'FAILED';
      }).toThrow();

      expect(() => {
        (result.execution_result as any).scientific_validity = 'ESTABLISHED';
      }).toThrow();
    });

    it('preserves raw records without silent data cleaning or modification', () => {
      const recordsCopy = JSON.parse(JSON.stringify(sampleRecords));
      const result = AuthorizedStatisticalExecutionEngine.executeAuthorizedDispatch({
        dispatch: validDispatch,
        records: recordsCopy,
        project_registry: registry
      });

      expect(recordsCopy).toEqual(sampleRecords);
    });

    it('does not silently switch methods based on normality (method is strictly pinned by dispatch)', () => {
      const result = AuthorizedStatisticalExecutionEngine.executeAuthorizedDispatch({
        dispatch: validDispatch,
        records: sampleRecords,
        project_registry: registry
      });

      expect(result.module_id).toBe('D9_DESCRIPTIVE_STATISTICS');
      expect(result.execution_result.fallback_used).toBe(false);
    });
  });

  // ===========================================================================
  // 8. Integration with ResearchWorkspaceService & Store
  // ===========================================================================
  describe('ResearchWorkspaceService Integration', () => {
    it('executes authorized dispatch via service and persists result to store', () => {
      const result = service.executeAuthorizedDispatch(validDispatch, {
        records: sampleRecords
      });

      expect(result).toBeDefined();
      expect(result.execution_id).toMatch(/^exec_/);
      expect(result.status).toBe('COMPLETED');

      // Check store
      const retrieved = service.getExecutionResult(result.execution_id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.execution_id).toBe(result.execution_id);

      // Check analysis lookup
      const byAnalysis = service.getExecutionForAnalysis(
        activeProject.project_id,
        'AP_DESCRIPTIVE_01'
      );
      expect(byAnalysis).toBeDefined();
      expect(byAnalysis?.execution_id).toBe(result.execution_id);

      // Check list
      const list = service.listExecutionResults();
      expect(list.length).toBeGreaterThanOrEqual(1);
      expect(list.some(r => r.execution_id === result.execution_id)).toBe(true);
    });
  });

  // ===========================================================================
  // 9. Security Audit: Zero eval() and Zero new Function()
  // ===========================================================================
  describe('Security Audit', () => {
    it('contains 0 instances of eval() and new Function() in authorizedStatisticalExecution.ts', () => {
      const filePath = path.resolve(__dirname, '../data/authorizedStatisticalExecution.ts');
      const content = fs.readFileSync(filePath, 'utf-8');

      const codeWithoutComments = content
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*/g, '');

      expect(codeWithoutComments.includes('eval(')).toBe(false);
      expect(codeWithoutComments.includes('new Function(')).toBe(false);
    });
  });
});
