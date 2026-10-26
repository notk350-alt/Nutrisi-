/**
 * NutriBodySim — Phase F2.2A: Analysis Plan -> Execution Contract Bridge Test Suite
 *
 * Verifies all 20+ requirements:
 * 1. Contract creation & READY request
 * 2. BLOCKED request behavior
 * 3. Project & version validation
 * 4. Analysis & PLANNED status validation
 * 5. Objective binding validation
 * 6. Hypothesis binding validation
 * 7. Variable validation (inputs, grouping, pairing)
 * 8. Dataset inheritance & cross-version mismatch rejection
 * 9. Checksum & lineage mismatch rejection
 * 10. Authoritative module resolution (D9-D13)
 * 11. Unsupported analysis type rejection
 * 12. Alpha & confidence level parameter validation
 * 13. Configuration security validation (zero functions, zero eval)
 * 14. Immutability & defensive cloning
 * 15. Provenance determinism & sensitivity
 * 16. Execution boundary: no statistical calculation, no result generation
 * 17. Scientific boundary: scientific_validity = NOT_ESTABLISHED
 * 18. Security audit: 0 eval(), 0 new Function()
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  ResearchProjectRegistry,
  ResearchWorkflow,
  ResearchProject,
  PlannedAnalysis,
  createDataset,
  createDatasetVersion,
  createDataArtifact,
  DatasetVersionStore,
  DataArtifactStore,
  VariableStore,
  defaultDatasetVersionStore,
  defaultDataArtifactStore,
  defaultVariableStore,
  AnalysisExecutionPreflight,
  AnalysisExecutionRequest,
  PreflightResult,
  ANALYSIS_MODULE_REGISTRY,
  ScientificExecutionBridgeError,
  computeExecutionRequestProvenanceHash
} from '../index';
import { ResearchWorkspaceService } from '../../src/services/researchWorkspaceService';

describe('Phase F2.2A — Analysis Plan -> Execution Contract Bridge', () => {
  let registry: ResearchProjectRegistry;
  let service: ResearchWorkspaceService;
  let activeProject: ResearchProject;

  beforeEach(() => {
    registry = new ResearchProjectRegistry();
    service = new ResearchWorkspaceService(registry);

    // 1. Create baseline draft project
    const draft = service.createProject({
      title: 'Soluble Fiber Glycemic Investigation',
      description: 'Prospective observational cohort on dietary fiber and glycemic regulation.',
      created_by: 'Dr. Sarah Connor',
      study_design: {
        design_type: 'COHORT',
        description: 'Prospective observational study'
      },
      research_question: {
        question_id: 'Q_PRIMARY',
        question_text: 'Does soluble fiber reduce fasting plasma glucose?',
        priority: 'PRIMARY'
      },
      objective: {
        objective_id: 'OBJ_PRIMARY',
        type: 'PRIMARY_OBJECTIVE',
        description: 'Quantify correlation between soluble fiber and fasting glucose'
      },
      hypothesis: {
        hypothesis_id: 'HYP_PRIMARY',
        null_hypothesis: 'Fiber has no correlation with glucose (r = 0)',
        alternative_hypothesis: 'Fiber is negatively correlated with glucose (r < 0)',
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
      analysis_id: 'AP_FIBER_GLUCOSE_01',
      objective_id: 'OBJ_PRIMARY',
      hypothesis_id: 'HYP_PRIMARY',
      analysis_type: 'INFERENTIAL',
      input_variable_ids: ['VAR_FASTING_GLUCOSE', 'VAR_SOLUBLE_FIBER'],
      grouping_variable_ids: ['VAR_INTERVENTION_ARM'],
      alpha: 0.05,
      confidence_level: 0.95,
      planned_rationale: 'Pre-specified two-sample independent t-test',
      configuration: { test_procedure: 'two_sample_t_test' }
    });
  });

  // --------------------------------------------------------------------------
  // 1. Contract Creation & READY Request
  // --------------------------------------------------------------------------
  it('1. should successfully generate a READY AnalysisExecutionRequest from a valid planned analysis', () => {
    const preflight = AnalysisExecutionPreflight.validate({
      project: activeProject,
      analysis_id: 'AP_FIBER_GLUCOSE_01'
    });

    expect(preflight.status).toBe('READY');
    expect(preflight.errors).toHaveLength(0);
    expect(preflight.resolved_module_id).toBe('D10_INFERENTIAL_STATISTICS');
    expect(preflight.resolved_module_version).toBe('1.0.0');
    expect(preflight.provenance_hash).toBeDefined();
    expect(preflight.scientific_validity).toBe('NOT_ESTABLISHED');
    expect(preflight.request).toBeDefined();

    const req = preflight.request!;
    expect(req.execution_request_id).toMatch(/^EXREQ_/);
    expect(req.project_id).toBe(activeProject.project_id);
    expect(req.project_version).toBe(activeProject.project_version);
    expect(req.analysis_id).toBe('AP_FIBER_GLUCOSE_01');
    expect(req.dataset_version_id).toBe('DSV_GLYCEMIC_V1');
    expect(req.data_artifact_id).toBe('ART_GLYCEMIC_ANALYSIS_READY_01');
    expect(req.source_artifact_checksum).toBe(activeProject.dataset_binding!.source_artifact_checksum);
    expect(req.analysis_type).toBe('INFERENTIAL');
    expect(req.objective_id).toBe('OBJ_PRIMARY');
    expect(req.hypothesis_id).toBe('HYP_PRIMARY');
    expect(req.input_variable_ids).toEqual(['VAR_FASTING_GLUCOSE', 'VAR_SOLUBLE_FIBER']);
    expect(req.grouping_variable_ids).toEqual(['VAR_INTERVENTION_ARM']);
    expect(req.alpha).toBe(0.05);
    expect(req.confidence_level).toBe(0.95);
    expect(req.requested_module_id).toBe('D10_INFERENTIAL_STATISTICS');
    expect(req.requested_module_version).toBe('1.0.0');
    expect(req.status).toBe('READY');
    expect(req.scientific_validity).toBe('NOT_ESTABLISHED');
  });

  it('2. should create request via createExecutionRequest helper method or service wrapper', () => {
    const req = AnalysisExecutionPreflight.createExecutionRequest({
      project: activeProject,
      analysis_id: 'AP_FIBER_GLUCOSE_01'
    });

    expect(req).toBeDefined();
    expect(req.status).toBe('READY');

    const serviceReq = service.createAnalysisExecutionRequest(
      activeProject.project_id,
      'AP_FIBER_GLUCOSE_01'
    );
    expect(serviceReq).toBeDefined();
    expect(serviceReq.analysis_id).toBe('AP_FIBER_GLUCOSE_01');
  });

  // --------------------------------------------------------------------------
  // 2. Project Validation
  // --------------------------------------------------------------------------
  it('3. should reject preflight when project is missing or invalid', () => {
    const preflight = AnalysisExecutionPreflight.validate({
      project: null as unknown as ResearchProject,
      analysis_id: 'AP_FIBER_GLUCOSE_01'
    });

    expect(preflight.status).toBe('BLOCKED');
    expect(preflight.errors[0]).toContain('EXECUTION_PROJECT_NOT_FOUND');
  });

  it('4. should reject preflight when requested project version does not match', () => {
    const preflight = AnalysisExecutionPreflight.validate({
      project: activeProject,
      analysis_id: 'AP_FIBER_GLUCOSE_01',
      project_version: '9.9.9' // Mismatched version
    });

    expect(preflight.status).toBe('BLOCKED');
    expect(preflight.errors.some((e) => e.includes('EXECUTION_PROJECT_VERSION_MISMATCH'))).toBe(true);
  });

  // --------------------------------------------------------------------------
  // 3. Analysis Plan & Status Validation
  // --------------------------------------------------------------------------
  it('5. should reject preflight when analysis is not found in project plan', () => {
    const preflight = AnalysisExecutionPreflight.validate({
      project: activeProject,
      analysis_id: 'AP_NON_EXISTENT_99'
    });

    expect(preflight.status).toBe('BLOCKED');
    expect(preflight.errors.some((e) => e.includes('EXECUTION_ANALYSIS_NOT_FOUND'))).toBe(true);
  });

  it('6. should reject preflight when analysis status is not PLANNED', () => {
    // Manually mutate analysis status to EXECUTED or SKIPPED
    const mutatedProject = {
      ...activeProject,
      analysis_plan: activeProject.analysis_plan.map((a) =>
        a.analysis_id === 'AP_FIBER_GLUCOSE_01' ? { ...a, status: 'EXECUTED' as const } : a
      )
    };

    const preflight = AnalysisExecutionPreflight.validate({
      project: mutatedProject as ResearchProject,
      analysis_id: 'AP_FIBER_GLUCOSE_01'
    });

    expect(preflight.status).toBe('BLOCKED');
    expect(preflight.errors.some((e) => e.includes('EXECUTION_ANALYSIS_NOT_PLANNED'))).toBe(true);
  });

  // --------------------------------------------------------------------------
  // 4. Objective & Hypothesis Binding
  // --------------------------------------------------------------------------
  it('7. should reject preflight when referenced objective does not exist in project', () => {
    const mutatedProject = {
      ...activeProject,
      analysis_plan: activeProject.analysis_plan.map((a) =>
        a.analysis_id === 'AP_FIBER_GLUCOSE_01' ? { ...a, objective_id: 'OBJ_GHOST_999' } : a
      )
    };

    const preflight = AnalysisExecutionPreflight.validate({
      project: mutatedProject as ResearchProject,
      analysis_id: 'AP_FIBER_GLUCOSE_01'
    });

    expect(preflight.status).toBe('BLOCKED');
    expect(preflight.errors.some((e) => e.includes('EXECUTION_OBJECTIVE_NOT_FOUND'))).toBe(true);
  });

  it('8. should reject preflight when referenced hypothesis does not exist in project', () => {
    const mutatedProject = {
      ...activeProject,
      analysis_plan: activeProject.analysis_plan.map((a) =>
        a.analysis_id === 'AP_FIBER_GLUCOSE_01' ? { ...a, hypothesis_id: 'HYP_GHOST_999' } : a
      )
    };

    const preflight = AnalysisExecutionPreflight.validate({
      project: mutatedProject as ResearchProject,
      analysis_id: 'AP_FIBER_GLUCOSE_01'
    });

    expect(preflight.status).toBe('BLOCKED');
    expect(preflight.errors.some((e) => e.includes('EXECUTION_HYPOTHESIS_NOT_FOUND'))).toBe(true);
  });

  it('9. should accept omitted hypothesis for descriptive or exploratory analysis', () => {
    // Add descriptive analysis without hypothesis
    const updated = service.planAnalysis({
      project_id: activeProject.project_id,
      analysis_id: 'AP_DESCRIPTIVE_TEST',
      objective_id: 'OBJ_PRIMARY',
      hypothesis_id: undefined,
      analysis_type: 'DESCRIPTIVE',
      input_variable_ids: ['VAR_FASTING_GLUCOSE'],
      planned_rationale: 'Descriptive glucose distribution'
    });

    const preflight = AnalysisExecutionPreflight.validate({
      project: updated,
      analysis_id: 'AP_DESCRIPTIVE_TEST'
    });

    expect(preflight.status).toBe('READY');
    expect(preflight.request?.hypothesis_id).toBeUndefined();
    expect(preflight.resolved_module_id).toBe('D9_DESCRIPTIVE_STATISTICS');
  });

  // --------------------------------------------------------------------------
  // 5. Variable Validation
  // --------------------------------------------------------------------------
  it('10. should reject preflight when input variables are empty', () => {
    const mutatedProject = {
      ...activeProject,
      analysis_plan: activeProject.analysis_plan.map((a) =>
        a.analysis_id === 'AP_FIBER_GLUCOSE_01'
          ? { ...a, input_variables: [], input_variable_ids: [] }
          : a
      )
    };

    const preflight = AnalysisExecutionPreflight.validate({
      project: mutatedProject as ResearchProject,
      analysis_id: 'AP_FIBER_GLUCOSE_01'
    });

    expect(preflight.status).toBe('BLOCKED');
    expect(preflight.errors.some((e) => e.includes('EXECUTION_REQUIRED_INPUT_MISSING'))).toBe(true);
  });

  it('11. should reject preflight when input variables are not in Variable Registry', () => {
    const mutatedProject = {
      ...activeProject,
      analysis_plan: activeProject.analysis_plan.map((a) =>
        a.analysis_id === 'AP_FIBER_GLUCOSE_01'
          ? { ...a, input_variables: ['VAR_UNREGISTERED_999'], input_variable_ids: ['VAR_UNREGISTERED_999'] }
          : a
      )
    };

    const preflight = AnalysisExecutionPreflight.validate({
      project: mutatedProject as ResearchProject,
      analysis_id: 'AP_FIBER_GLUCOSE_01'
    });

    expect(preflight.status).toBe('BLOCKED');
    expect(preflight.errors.some((e) => e.includes('EXECUTION_VARIABLE_NOT_FOUND'))).toBe(true);
  });

  it('12. should reject preflight when grouping variable is not in Variable Registry', () => {
    const mutatedProject = {
      ...activeProject,
      analysis_plan: activeProject.analysis_plan.map((a) =>
        a.analysis_id === 'AP_FIBER_GLUCOSE_01'
          ? { ...a, grouping_variable: 'VAR_UNKNOWN_GROUP', grouping_variable_ids: ['VAR_UNKNOWN_GROUP'] }
          : a
      )
    };

    const preflight = AnalysisExecutionPreflight.validate({
      project: mutatedProject as ResearchProject,
      analysis_id: 'AP_FIBER_GLUCOSE_01'
    });

    expect(preflight.status).toBe('BLOCKED');
    expect(preflight.errors.some((e) => e.includes('EXECUTION_VARIABLE_NOT_FOUND'))).toBe(true);
  });

  it('13. should reject preflight when pairing variable is not in Variable Registry', () => {
    const mutatedProject = {
      ...activeProject,
      analysis_plan: activeProject.analysis_plan.map((a) =>
        a.analysis_id === 'AP_FIBER_GLUCOSE_01'
          ? { ...a, pairing_variable: 'VAR_UNKNOWN_PAIR', pairing_variable_ids: ['VAR_UNKNOWN_PAIR'] }
          : a
      )
    };

    const preflight = AnalysisExecutionPreflight.validate({
      project: mutatedProject as ResearchProject,
      analysis_id: 'AP_FIBER_GLUCOSE_01'
    });

    expect(preflight.status).toBe('BLOCKED');
    expect(preflight.errors.some((e) => e.includes('EXECUTION_VARIABLE_NOT_FOUND'))).toBe(true);
  });

  // --------------------------------------------------------------------------
  // 6. Dataset Inheritance & Integrity
  // --------------------------------------------------------------------------
  it('14. should inherit dataset binding from ResearchProject and reject unbound projects', () => {
    const unboundProject = service.createProject({
      title: 'Unbound Study',
      description: 'Test unbound',
      created_by: 'Researcher',
      study_design: { design_type: 'COHORT', description: 'Test' },
      research_question: { question_id: 'Q1', question_text: 'Q1', priority: 'PRIMARY' },
      objective: { objective_id: 'OBJ1', type: 'PRIMARY_OBJECTIVE', description: 'OBJ1' },
      hypothesis: { hypothesis_id: 'H1', null_hypothesis: 'H0', alternative_hypothesis: 'H1', direction: 'TWO_SIDED' }
    });

    const preflight = AnalysisExecutionPreflight.validate({
      project: unboundProject,
      analysis_id: 'AP_FIBER_GLUCOSE_01'
    });

    expect(preflight.status).toBe('BLOCKED');
    expect(preflight.errors.some((e) => e.includes('EXECUTION_DATASET_NOT_FOUND'))).toBe(true);
  });

  it('15. should reject preflight when artifact belongs to a different dataset version (cross-version mismatch)', () => {
    const customVersionStore = new DatasetVersionStore();
    const customArtifactStore = new DataArtifactStore();

    // Register version 1 and version 2
    const v1 = createDatasetVersion({
      version_id: 'DSV_TEST_V1',
      dataset_id: 'DS_TEST',
      version_number: 1,
      record_count: 50,
      column_count: 4,
      status: 'SEALED',
      created_by: 'STEWARD'
    });
    customVersionStore.create(v1);

    // Create RAW artifact belonging to V2
    const artV2 = createDataArtifact({
      artifact_id: 'ART_V2_MISMATCH',
      dataset_version_id: 'DSV_TEST_V2', // Belongs to V2
      state: 'RAW',
      record_count: 50,
      column_count: 4,
      created_by: 'STEWARD'
    });
    customArtifactStore.create(artV2);

    // Project binds to V1 but references artV2
    const mutatedProject: ResearchProject = {
      ...activeProject,
      dataset_binding: {
        dataset_version_id: 'DSV_TEST_V1',
        data_artifact_id: 'ART_V2_MISMATCH',
        source_artifact_checksum: artV2.checksum,
        bound_at: new Date().toISOString()
      }
    };

    const preflight = AnalysisExecutionPreflight.validate({
      project: mutatedProject,
      analysis_id: 'AP_FIBER_GLUCOSE_01',
      dataset_version_store: customVersionStore,
      data_artifact_store: customArtifactStore
    });

    expect(preflight.status).toBe('BLOCKED');
    expect(preflight.errors.some((e) => e.includes('EXECUTION_ARTIFACT_VERSION_MISMATCH'))).toBe(true);
  });

  it('16. should reject preflight when artifact checksum mismatches binding', () => {
    const mutatedProject: ResearchProject = {
      ...activeProject,
      dataset_binding: {
        ...activeProject.dataset_binding!,
        source_artifact_checksum: 'CORRUPTED_CHECKSUM_HASH_00000000000000000000'
      }
    };

    const preflight = AnalysisExecutionPreflight.validate({
      project: mutatedProject,
      analysis_id: 'AP_FIBER_GLUCOSE_01'
    });

    expect(preflight.status).toBe('BLOCKED');
    expect(preflight.errors.some((e) => e.includes('EXECUTION_CHECKSUM_MISMATCH'))).toBe(true);
  });

  it('17. should reject preflight when artifact parent lineage is corrupted', () => {
    const customVersionStore = new DatasetVersionStore();
    const customArtifactStore = new DataArtifactStore();

    const v1 = createDatasetVersion({
      version_id: 'DSV_LINEAGE_V1',
      dataset_id: 'DS_LINEAGE',
      version_number: 1,
      record_count: 10,
      column_count: 2,
      status: 'SEALED',
      created_by: 'STEWARD'
    });
    customVersionStore.create(v1);

    const artParent = createDataArtifact({
      artifact_id: 'ART_PARENT_01',
      dataset_version_id: 'DSV_LINEAGE_V1',
      state: 'RAW',
      record_count: 10,
      column_count: 2,
      created_by: 'STEWARD'
    });
    customArtifactStore.create(artParent);

    const artChild = createDataArtifact({
      artifact_id: 'ART_CHILD_INVALID',
      dataset_version_id: 'DSV_LINEAGE_V1',
      parent_artifact_id: 'ART_PARENT_01',
      state: 'ANALYSIS_READY',
      record_count: 10,
      column_count: 2,
      created_by: 'STEWARD'
    });
    customArtifactStore.create(artChild);

    // Delete parent from store to simulate broken lineage
    (customArtifactStore as any).artifacts.delete('ART_PARENT_01');

    const mutatedProject: ResearchProject = {
      ...activeProject,
      dataset_binding: {
        dataset_version_id: 'DSV_LINEAGE_V1',
        data_artifact_id: 'ART_CHILD_INVALID',
        source_artifact_checksum: artChild.checksum,
        bound_at: new Date().toISOString()
      }
    };

    const preflight = AnalysisExecutionPreflight.validate({
      project: mutatedProject,
      analysis_id: 'AP_FIBER_GLUCOSE_01',
      dataset_version_store: customVersionStore,
      data_artifact_store: customArtifactStore
    });

    expect(preflight.status).toBe('BLOCKED');
    expect(preflight.errors.some((e) => e.includes('EXECUTION_INVALID_LINEAGE'))).toBe(true);
  });

  // --------------------------------------------------------------------------
  // 7. Authoritative Module Resolution
  // --------------------------------------------------------------------------
  it('18. should deterministically resolve authoritative scientific module identities across D9-D13', () => {
    const testCases: Array<{ type: string; expectedModuleId: string }> = [
      { type: 'DESCRIPTIVE', expectedModuleId: 'D9_DESCRIPTIVE_STATISTICS' },
      { type: 'INFERENTIAL', expectedModuleId: 'D10_INFERENTIAL_STATISTICS' },
      { type: 'REGRESSION', expectedModuleId: 'D11_REGRESSION_MODELING' },
      { type: 'POWER_ANALYSIS', expectedModuleId: 'D12_POWER_ANALYSIS' },
      { type: 'POWER', expectedModuleId: 'D12_POWER_ANALYSIS' },
      { type: 'NON_PARAMETRIC', expectedModuleId: 'D13_NON_PARAMETRIC_STATISTICS' },
      { type: 'NONPARAMETRIC', expectedModuleId: 'D13_NON_PARAMETRIC_STATISTICS' }
    ];

    for (const tc of testCases) {
      const plan: PlannedAnalysis = {
        analysis_id: `PLAN_TEST_${tc.type}`,
        objective_id: 'OBJ_PRIMARY',
        analysis_type: tc.type as any,
        input_variables: ['VAR_FASTING_GLUCOSE'],
        alpha: tc.type === 'DESCRIPTIVE' ? undefined : 0.05,
        confidence_level: 0.95,
        planned_rationale: 'Validation test',
        status: 'PLANNED'
      };

      const prj: ResearchProject = {
        ...activeProject,
        analysis_plan: [plan]
      };

      const res = AnalysisExecutionPreflight.validate({
        project: prj,
        analysis_id: plan.analysis_id
      });

      expect(res.status).toBe('READY');
      expect(res.resolved_module_id).toBe(tc.expectedModuleId);
      expect(res.resolved_module_version).toBe('1.0.0');
    }
  });

  it('19. should reject unsupported analysis types', () => {
    const plan: PlannedAnalysis = {
      analysis_id: 'PLAN_UNKNOWN',
      objective_id: 'OBJ_PRIMARY',
      analysis_type: 'DEEP_NEURAL_MAGIC' as any,
      input_variables: ['VAR_FASTING_GLUCOSE'],
      planned_rationale: 'Test unsupported',
      status: 'PLANNED'
    };

    const prj: ResearchProject = { ...activeProject, analysis_plan: [plan] };

    const res = AnalysisExecutionPreflight.validate({
      project: prj,
      analysis_id: plan.analysis_id
    });

    expect(res.status).toBe('BLOCKED');
    expect(res.errors.some((e) => e.includes('EXECUTION_INVALID_ANALYSIS_TYPE'))).toBe(true);
  });

  // --------------------------------------------------------------------------
  // 8. Parameter Validation
  // --------------------------------------------------------------------------
  it('20. should validate alpha boundaries (0 < alpha < 1 exclusive)', () => {
    // Alpha = 0
    let mutatedProject = {
      ...activeProject,
      analysis_plan: activeProject.analysis_plan.map((a) =>
        a.analysis_id === 'AP_FIBER_GLUCOSE_01' ? { ...a, alpha: 0 } : a
      )
    };
    let res = AnalysisExecutionPreflight.validate({
      project: mutatedProject as ResearchProject,
      analysis_id: 'AP_FIBER_GLUCOSE_01'
    });
    expect(res.status).toBe('BLOCKED');
    expect(res.errors.some((e) => e.includes('EXECUTION_INVALID_ALPHA'))).toBe(true);

    // Alpha = 1
    mutatedProject = {
      ...activeProject,
      analysis_plan: activeProject.analysis_plan.map((a) =>
        a.analysis_id === 'AP_FIBER_GLUCOSE_01' ? { ...a, alpha: 1 } : a
      )
    };
    res = AnalysisExecutionPreflight.validate({
      project: mutatedProject as ResearchProject,
      analysis_id: 'AP_FIBER_GLUCOSE_01'
    });
    expect(res.status).toBe('BLOCKED');
    expect(res.errors.some((e) => e.includes('EXECUTION_INVALID_ALPHA'))).toBe(true);
  });

  it('21. should validate confidence level boundaries (0 < conf < 1 exclusive)', () => {
    const mutatedProject = {
      ...activeProject,
      analysis_plan: activeProject.analysis_plan.map((a) =>
        a.analysis_id === 'AP_FIBER_GLUCOSE_01' ? { ...a, confidence_level: 1.5 } : a
      )
    };

    const res = AnalysisExecutionPreflight.validate({
      project: mutatedProject as ResearchProject,
      analysis_id: 'AP_FIBER_GLUCOSE_01'
    });

    expect(res.status).toBe('BLOCKED');
    expect(res.errors.some((e) => e.includes('EXECUTION_INVALID_CONFIDENCE_LEVEL'))).toBe(true);
  });

  // --------------------------------------------------------------------------
  // 9. Configuration Security Validation (Zero eval, Zero functions)
  // --------------------------------------------------------------------------
  it('22. should reject configuration containing executable functions or code strings', () => {
    // Executable function
    let mutatedProject = {
      ...activeProject,
      analysis_plan: activeProject.analysis_plan.map((a) =>
        a.analysis_id === 'AP_FIBER_GLUCOSE_01'
          ? { ...a, configuration: { badFn: () => 42 } }
          : a
      )
    };

    let res = AnalysisExecutionPreflight.validate({
      project: mutatedProject as ResearchProject,
      analysis_id: 'AP_FIBER_GLUCOSE_01'
    });

    expect(res.status).toBe('BLOCKED');
    expect(res.errors.some((e) => e.includes('EXECUTION_CONFIGURATION_INVALID'))).toBe(true);

    // Dynamic execution string
    mutatedProject = {
      ...activeProject,
      analysis_plan: activeProject.analysis_plan.map((a) =>
        a.analysis_id === 'AP_FIBER_GLUCOSE_01'
          ? { ...a, configuration: { payload: 'eval(console.log(1))' } }
          : a
      )
    };

    res = AnalysisExecutionPreflight.validate({
      project: mutatedProject as ResearchProject,
      analysis_id: 'AP_FIBER_GLUCOSE_01'
    });

    expect(res.status).toBe('BLOCKED');
    expect(res.errors.some((e) => e.includes('EXECUTION_CONFIGURATION_INVALID'))).toBe(true);
  });

  // --------------------------------------------------------------------------
  // 10. Immutability & Defensive Freezing
  // --------------------------------------------------------------------------
  it('23. should return a deeply frozen, immutable AnalysisExecutionRequest', () => {
    const req = AnalysisExecutionPreflight.createExecutionRequest({
      project: activeProject,
      analysis_id: 'AP_FIBER_GLUCOSE_01'
    });

    expect(Object.isFrozen(req)).toBe(true);
    expect(Object.isFrozen(req.input_variable_ids)).toBe(true);
    expect(Object.isFrozen(req.configuration)).toBe(true);

    // Modifying frozen object throws in strict mode
    expect(() => {
      (req as any).status = 'BLOCKED';
    }).toThrow();
  });

  // --------------------------------------------------------------------------
  // 11. Provenance Determinism & Sensitivity
  // --------------------------------------------------------------------------
  it('24. should compute deterministic SHA-256 provenance hashes sensitive to any structural parameter', () => {
    const req1 = AnalysisExecutionPreflight.createExecutionRequest({
      project: activeProject,
      analysis_id: 'AP_FIBER_GLUCOSE_01'
    });

    const req2 = AnalysisExecutionPreflight.createExecutionRequest({
      project: activeProject,
      analysis_id: 'AP_FIBER_GLUCOSE_01'
    });

    expect(req1.provenance_hash).toBe(req2.provenance_hash);

    // Any structural change (e.g. alpha changed from 0.05 to 0.01) must alter hash
    const mutatedProject = {
      ...activeProject,
      analysis_plan: activeProject.analysis_plan.map((a) =>
        a.analysis_id === 'AP_FIBER_GLUCOSE_01' ? { ...a, alpha: 0.01 } : a
      )
    };

    const reqMutated = AnalysisExecutionPreflight.createExecutionRequest({
      project: mutatedProject as ResearchProject,
      analysis_id: 'AP_FIBER_GLUCOSE_01'
    });

    expect(reqMutated.provenance_hash).not.toBe(req1.provenance_hash);
  });

  // --------------------------------------------------------------------------
  // 12. Execution Boundary (No Statistical Execution, No Result Generation)
  // --------------------------------------------------------------------------
  it('25. should strictly enforce the execution boundary: zero statistical results produced, zero engine dispatch', () => {
    const initialExecutionHistoryCount = activeProject.execution_history.length;
    const initialD9Results = activeProject.result_bindings.d9_results.length;
    const initialD10Results = activeProject.result_bindings.d10_results.length;

    const res = AnalysisExecutionPreflight.validate({
      project: activeProject,
      analysis_id: 'AP_FIBER_GLUCOSE_01'
    });

    expect(res.status).toBe('READY');

    // No statistical values present on result or request
    expect((res as any).mean).toBeUndefined();
    expect((res as any).p_value).toBeUndefined();
    expect((res as any).effect_size).toBeUndefined();
    expect((res as any).r_squared).toBeUndefined();
    expect((res as any).power).toBeUndefined();

    // Active project execution history and result bindings remain untouched
    expect(activeProject.execution_history.length).toBe(initialExecutionHistoryCount);
    expect(activeProject.result_bindings.d9_results.length).toBe(initialD9Results);
    expect(activeProject.result_bindings.d10_results.length).toBe(initialD10Results);
  });

  // --------------------------------------------------------------------------
  // 13. Scientific Validity Invariant
  // --------------------------------------------------------------------------
  it('26. should strictly maintain scientific_validity = NOT_ESTABLISHED', () => {
    const res = AnalysisExecutionPreflight.validate({
      project: activeProject,
      analysis_id: 'AP_FIBER_GLUCOSE_01'
    });

    expect(res.scientific_validity).toBe('NOT_ESTABLISHED');
    expect(res.request?.scientific_validity).toBe('NOT_ESTABLISHED');
  });

  // --------------------------------------------------------------------------
  // 14. Security Audit (Zero eval, Zero new Function)
  // --------------------------------------------------------------------------
  it('27. should verify zero eval() and zero new Function() across all newly created F2.2A bridge files', () => {
    const targetFiles = [
      path.resolve(process.cwd(), 'scientific/data/analysisExecutionContracts.ts'),
      path.resolve(process.cwd(), 'scientific/data/analysisExecutionProvenance.ts'),
      path.resolve(process.cwd(), 'scientific/data/analysisExecutionPreflight.ts'),
      path.resolve(process.cwd(), 'src/services/researchWorkspaceService.ts')
    ];

    for (const filePath of targetFiles) {
      expect(fs.existsSync(filePath), `File exists: ${filePath}`).toBe(true);
      const code = fs.readFileSync(filePath, 'utf8');

      const evalMatches = code.match(/\beval\s*\(/g);
      expect(evalMatches, `eval() found in ${filePath}`).toBeNull();

      const newFunctionMatches = code.match(/new\s+Function\s*\(/g);
      expect(newFunctionMatches, `new Function() found in ${filePath}`).toBeNull();
    }
  });
});
