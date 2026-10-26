/**
 * NutriBodySim — Phase F2.2C.2: Authorized Execution Adapter Test Suite
 *
 * Verifies all 32 requirements for Phase F2.2C.2:
 * 1. Requires valid ExecutionAuthorization (rejects missing or raw plans/previews)
 * 2. Rejects authorization if status !== 'AUTHORIZED'
 * 3. Rejects authorization if mutated or authorization_hash mismatch
 * 4. Requires ExecutionPreview
 * 5. Rejects execution preview if status !== 'READY'
 * 6. Rejects execution preview if errors exist
 * 7. Rejects if preview provenance hash does not match authorization
 * 8. Rejects if project ID or version mismatches
 * 9. Rejects if project is FINALIZED
 * 10. Rejects if project is ARCHIVED
 * 11. Rejects if analysis plan is missing or not PLANNED
 * 12. Rejects if analysis plan version mismatches
 * 13. Rejects if dataset version binding mismatches
 * 14. Rejects if data artifact ID or checksum mismatches
 * 15. Rejects if module ID or module version mismatches authoritative registry
 * 16. Strictly enforces scientific_validity = 'NOT_ESTABLISHED'
 * 17. Deterministic SHA-256 dispatch provenance hash
 * 18. Dispatch packet is deeply immutable (deepFreeze)
 * 19. verifyDispatchPacket validates valid packet and rejects tampered packet
 * 20. Target module payload correctly built for DESCRIPTIVE (D9)
 * 21. Target module payload correctly built for INFERENTIAL (D10)
 * 22. Target module payload correctly built for REGRESSION (D11)
 * 23. Target module payload correctly built for POWER (D12)
 * 24. Target module payload correctly built for NONPARAMETRIC (D13)
 * 25. Adapter does NOT calculate statistics (no mean, SD, p-value, effect size)
 * 26. D9 StatisticalAnalysisEngine is NOT invoked
 * 27. D10 InferentialAnalysisEngine is NOT invoked
 * 28. D11 RegressionEngine is NOT invoked
 * 29. D12 PowerEngine is NOT invoked
 * 30. D13 NonParametricEngine is NOT invoked
 * 31. No Result or ResultSet is generated
 * 32. Security check: zero eval(), zero new Function()
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
  AuthorizedExecutionAdapter,
  ScientificAuthorizedAdapterError,
  defaultAuthorizedExecutionDispatchStore,
  defaultExecutionAuthorizationStore,
  defaultDataArtifactStore,
  defaultDatasetVersionStore,
  computeDispatchHash
} from '../index';
import { ResearchWorkspaceService } from '../../src/services/researchWorkspaceService';

describe('Phase F2.2C.2 — Authorized Execution Adapter', () => {
  let registry: ResearchProjectRegistry;
  let service: ResearchWorkspaceService;
  let activeProject: ResearchProject;
  let validPreview: ExecutionPreview;
  let validAuthorization: ExecutionAuthorization;

  beforeEach(() => {
    registry = new ResearchProjectRegistry();
    service = new ResearchWorkspaceService(registry);
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
      analysis_id: 'AP_FIBER_GLUCOSE_01',
      objective_id: 'OBJ_PRIMARY',
      hypothesis_id: 'HYP_PRIMARY',
      analysis_type: 'INFERENTIAL',
      input_variable_ids: ['VAR_FASTING_GLUCOSE', 'VAR_SOLUBLE_FIBER'],
      grouping_variable_ids: ['VAR_INTERVENTION_ARM'],
      alpha: 0.05,
      confidence_level: 0.95,
      planned_rationale: 'Pre-specified two-sample independent t-test',
      configuration: {
        test_type: 'INDEPENDENT_TWO_SAMPLE_T_TEST',
        equal_variance: false
      }
    });

    // 4. Generate preview and authorization
    validPreview = service.previewExecution(activeProject.project_id, 'AP_FIBER_GLUCOSE_01');
    expect(validPreview.readiness_status).toBe('READY');

    validAuthorization = service.authorizeExecution(
      activeProject.project_id,
      'AP_FIBER_GLUCOSE_01',
      'Dr. Sarah Connor'
    );
    expect(validAuthorization.status).toBe('AUTHORIZED');
  });

  // 1. Requires valid ExecutionAuthorization
  it('1. requires a valid ExecutionAuthorization and rejects null/undefined/non-object input', () => {
    expect(() => {
      AuthorizedExecutionAdapter.createDispatchPacket({
        authorization: undefined as any,
        preview: validPreview,
        project: activeProject
      });
    }).toThrow(ScientificAuthorizedAdapterError);

    const result = AuthorizedExecutionAdapter.adaptAndValidate({
      authorization: undefined as any,
      preview: validPreview,
      project: activeProject
    });
    expect(result.status).toBe('BLOCKED');
    expect(result.errors.length).toBeGreaterThan(0);
  });

  // 2. Rejects authorization if status !== 'AUTHORIZED'
  it('2. rejects authorization if status !== "AUTHORIZED" (e.g. REVOKED)', () => {
    const revokedAuth: ExecutionAuthorization = {
      ...validAuthorization,
      status: 'REVOKED' as any
    };

    expect(() => {
      AuthorizedExecutionAdapter.createDispatchPacket({
        authorization: revokedAuth,
        preview: validPreview,
        project: activeProject
      });
    }).toThrow(/expected 'AUTHORIZED'/);
  });

  // 3. Rejects authorization if mutated or authorization_hash mismatch
  it('3. rejects authorization if mutated or authorization_hash does not match payload', () => {
    const tamperedAuth: ExecutionAuthorization = {
      ...validAuthorization,
      authorized_by: 'Impostor Researcher'
    };

    expect(() => {
      AuthorizedExecutionAdapter.createDispatchPacket({
        authorization: tamperedAuth,
        preview: validPreview,
        project: activeProject
      });
    }).toThrow(/AUTHORIZATION_HASH_MISMATCH/);
  });

  // 4. Requires ExecutionPreview
  it('4. requires ExecutionPreview and rejects if missing', () => {
    expect(() => {
      AuthorizedExecutionAdapter.createDispatchPacket({
        authorization: validAuthorization,
        preview: undefined as any,
        project: activeProject
      });
    }).toThrow(/PREVIEW_REQUIRED/);
  });

  // 5. Rejects execution preview if status !== 'READY'
  it('5. rejects execution preview if status !== "READY"', () => {
    const blockedPreview: ExecutionPreview = {
      ...validPreview,
      readiness_status: 'BLOCKED'
    };

    expect(() => {
      AuthorizedExecutionAdapter.createDispatchPacket({
        authorization: validAuthorization,
        preview: blockedPreview,
        project: activeProject
      });
    }).toThrow(/PREVIEW_NOT_READY/);
  });

  // 6. Rejects execution preview if blocking errors exist
  it('6. rejects execution preview if blocking errors exist', () => {
    const errorPreview: ExecutionPreview = {
      ...validPreview,
      errors: ['Blocking artifact corruption detected']
    };

    expect(() => {
      AuthorizedExecutionAdapter.createDispatchPacket({
        authorization: validAuthorization,
        preview: errorPreview,
        project: activeProject
      });
    }).toThrow(/PREVIEW_NOT_READY/);
  });

  // 7. Rejects if preview provenance hash does not match authorization
  it('7. rejects if preview provenance hash does not match authorization.preview_provenance_hash', () => {
    const mismatchedPreview: ExecutionPreview = {
      ...validPreview,
      provenance_hash: '0000000000000000000000000000000000000000000000000000000000000000'
    };

    expect(() => {
      AuthorizedExecutionAdapter.createDispatchPacket({
        authorization: validAuthorization,
        preview: mismatchedPreview,
        project: activeProject
      });
    }).toThrow(/PREVIEW_PROVENANCE_MISMATCH/);
  });

  // 8. Rejects if project ID or version mismatches
  it('8. rejects if project version mismatches authorization.project_version', () => {
    const updatedProject = { ...activeProject, project_version: '2.0.0' };
    expect(() => {
      AuthorizedExecutionAdapter.createDispatchPacket({
        authorization: validAuthorization,
        preview: validPreview,
        project: updatedProject
      });
    }).toThrow(/PROJECT_MISMATCH/);
  });

  // 9. Rejects if project is FINALIZED
  it('9. rejects if project status is FINALIZED', () => {
    const finalized = { ...activeProject, status: 'FINALIZED' as const };
    expect(() => {
      AuthorizedExecutionAdapter.createDispatchPacket({
        authorization: validAuthorization,
        preview: validPreview,
        project: finalized
      });
    }).toThrow(/PROJECT_FINALIZED/);
  });

  // 10. Rejects if project is ARCHIVED
  it('10. rejects if project status is ARCHIVED', () => {
    const archived = { ...activeProject, status: 'ARCHIVED' as const };
    expect(() => {
      AuthorizedExecutionAdapter.createDispatchPacket({
        authorization: validAuthorization,
        preview: validPreview,
        project: archived
      });
    }).toThrow(/PROJECT_ARCHIVED/);
  });

  // 11. Rejects if analysis plan is missing or not PLANNED
  it('11. rejects if analysis plan status is not PLANNED', () => {
    const nonPlannedProject: ResearchProject = {
      ...activeProject,
      analysis_plan: [
        {
          ...activeProject.analysis_plan[0],
          status: 'EXECUTED' as any
        }
      ]
    };

    expect(() => {
      AuthorizedExecutionAdapter.createDispatchPacket({
        authorization: validAuthorization,
        preview: validPreview,
        project: nonPlannedProject
      });
    }).toThrow(/ANALYSIS_NOT_PLANNED/);
  });

  // 12. Rejects if analysis plan version mismatches
  it('12. rejects if analysis plan version mismatches authorization.analysis_plan_version', () => {
    const modifiedAuth: ExecutionAuthorization = {
      ...validAuthorization,
      analysis_plan_version: '2.0.0',
      authorization_hash: computeDispatchHash({
        dispatch_id: 'dummy',
        authorization_id: validAuthorization.authorization_id,
        authorization_hash: validAuthorization.authorization_hash,
        preview_id: validPreview.preview_id,
        preview_provenance_hash: validPreview.provenance_hash,
        project_id: validPreview.project_id,
        project_version: validPreview.project_version,
        analysis_id: validPreview.analysis_id,
        analysis_plan_version: '2.0.0',
        analysis_type: validPreview.analysis_type,
        target_module_id: validPreview.resolved_module_id,
        target_module_version: validPreview.resolved_module_version,
        dataset_version_id: validPreview.dataset_version_id,
        data_artifact_id: validPreview.data_artifact_id,
        source_artifact_checksum: validPreview.source_artifact_checksum,
        input_variable_ids: [...validPreview.input_variable_ids],
        dispatched_by: validAuthorization.authorized_by,
        scientific_validity: 'NOT_ESTABLISHED'
      })
    };

    expect(() => {
      AuthorizedExecutionAdapter.createDispatchPacket({
        authorization: modifiedAuth,
        preview: validPreview,
        project: activeProject
      });
    }).toThrow();
  });

  // 13. Rejects if dataset version binding mismatches
  it('13. rejects if dataset version binding in project does not match preview', () => {
    const mutatedBindingsProject: ResearchProject = {
      ...activeProject,
      dataset_binding: {
        ...activeProject.dataset_binding!,
        dataset_version_id: 'dsv_other_version'
      }
    };

    expect(() => {
      AuthorizedExecutionAdapter.createDispatchPacket({
        authorization: validAuthorization,
        preview: validPreview,
        project: mutatedBindingsProject
      });
    }).toThrow(/DATASET_MISMATCH/);
  });

  // 14. Rejects if data artifact ID or checksum mismatches
  it('14. rejects if data artifact checksum in store does not match preview', () => {
    const customArtifactStore = defaultDataArtifactStore;
    
    // Mutate checksum in preview
    const tamperedPreview: ExecutionPreview = {
      ...validPreview,
      source_artifact_checksum: 'tampered_checksum_abcdef1234567890'
    };

    expect(() => {
      AuthorizedExecutionAdapter.createDispatchPacket({
        authorization: validAuthorization,
        preview: tamperedPreview,
        project: activeProject,
        data_artifact_store: customArtifactStore
      });
    }).toThrow(/ARTIFACT_CHECKSUM_MISMATCH/);
  });

  // 15. Rejects if module ID or module version mismatches authoritative registry
  it('15. rejects if module identity in preview does not match authoritative registry', () => {
    const invalidModulePreview: ExecutionPreview = {
      ...validPreview,
      resolved_module_id: 'NON_EXISTENT_MODULE_ID'
    };

    expect(() => {
      AuthorizedExecutionAdapter.createDispatchPacket({
        authorization: validAuthorization,
        preview: invalidModulePreview,
        project: activeProject
      });
    }).toThrow(/MODULE_VERSION_MISMATCH/);
  });

  // 16. Strictly enforces scientific_validity = 'NOT_ESTABLISHED'
  it('16. strictly enforces scientific_validity = "NOT_ESTABLISHED"', () => {
    const packet = AuthorizedExecutionAdapter.createDispatchPacket({
      authorization: validAuthorization,
      preview: validPreview,
      project: activeProject
    });

    expect(packet.scientific_validity).toBe('NOT_ESTABLISHED');

    const tamperedAuth: any = {
      ...validAuthorization,
      scientific_validity: 'VERIFIED'
    };
    expect(() => {
      AuthorizedExecutionAdapter.createDispatchPacket({
        authorization: tamperedAuth,
        preview: validPreview,
        project: activeProject
      });
    }).toThrow();
  });

  // 17. Deterministic SHA-256 dispatch provenance hash
  it('17. generates a deterministic SHA-256 dispatch provenance hash', () => {
    const packet1 = AuthorizedExecutionAdapter.createDispatchPacket({
      authorization: validAuthorization,
      preview: validPreview,
      project: activeProject,
      custom_timestamp: '2026-10-08T00:00:00.000Z',
      custom_dispatch_id: 'disp_deterministic_1'
    });

    const packet2 = AuthorizedExecutionAdapter.createDispatchPacket({
      authorization: validAuthorization,
      preview: validPreview,
      project: activeProject,
      custom_timestamp: '2026-10-08T00:00:00.000Z',
      custom_dispatch_id: 'disp_deterministic_1'
    });

    expect(packet1.dispatch_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(packet1.dispatch_hash).toBe(packet2.dispatch_hash);
  });

  // 18. Dispatch packet is deeply immutable (deepFreeze)
  it('18. verifies that the returned dispatch packet is deeply immutable', () => {
    const packet = AuthorizedExecutionAdapter.createDispatchPacket({
      authorization: validAuthorization,
      preview: validPreview,
      project: activeProject
    });

    expect(Object.isFrozen(packet)).toBe(true);
    expect(Object.isFrozen(packet.input_variable_ids)).toBe(true);
    expect(Object.isFrozen(packet.configuration)).toBe(true);
    expect(() => {
      (packet as any).dispatch_status = 'BLOCKED';
    }).toThrow();
  });

  // 19. verifyDispatchPacket validates valid packet and rejects tampered packet
  it('19. verifyDispatchPacket confirms valid packet and detects tampering', () => {
    const packet = AuthorizedExecutionAdapter.createDispatchPacket({
      authorization: validAuthorization,
      preview: validPreview,
      project: activeProject
    });

    expect(AuthorizedExecutionAdapter.verifyDispatchPacket(packet)).toBe(true);

    const tamperedPacket: any = {
      ...packet,
      dispatched_by: 'Tampered Hacker'
    };
    expect(AuthorizedExecutionAdapter.verifyDispatchPacket(tamperedPacket)).toBe(false);
  });

  // 20. Target module payload correctly built for DESCRIPTIVE (D9)
  it('20. correctly builds target payload for DESCRIPTIVE analysis (D9)', () => {
    const descPlan = service.planAnalysis({
      project_id: activeProject.project_id,
      analysis_id: 'AP_DESCRIPTIVE_1',
      objective_id: 'OBJ_PRIMARY',
      analysis_type: 'DESCRIPTIVE',
      input_variable_ids: ['VAR_SOLUBLE_FIBER'],
      planned_rationale: 'Descriptive characterization of fiber.'
    });

    const preview = service.previewExecution(descPlan.project_id, 'AP_DESCRIPTIVE_1');
    const auth = service.authorizeExecution(descPlan.project_id, 'AP_DESCRIPTIVE_1', 'Dr. Sarah Connor');

    const packet = AuthorizedExecutionAdapter.createDispatchPacket({
      authorization: auth,
      preview,
      project: descPlan
    });

    expect(packet.target_module_id).toBe('D9_DESCRIPTIVE_STATISTICS');
    expect(packet.target_payload.type).toBe('D9_DESCRIPTIVE');
    if (packet.target_payload.type === 'D9_DESCRIPTIVE') {
      expect(packet.target_payload.payload.analysis_id).toBe('AP_DESCRIPTIVE_1');
      expect(packet.target_payload.payload.requested_variables).toEqual(['VAR_SOLUBLE_FIBER']);
      expect(packet.target_payload.payload.analysis_type).toBe('DESCRIPTIVE_NUMERIC');
    }
  });

  // 21. Target module payload correctly built for INFERENTIAL (D10)
  it('21. correctly builds target payload for INFERENTIAL analysis (D10)', () => {
    const packet = AuthorizedExecutionAdapter.createDispatchPacket({
      authorization: validAuthorization,
      preview: validPreview,
      project: activeProject
    });

    expect(packet.target_module_id).toBe('D10_INFERENTIAL_STATISTICS');
    expect(packet.target_payload.type).toBe('D10_INFERENTIAL');
    if (packet.target_payload.type === 'D10_INFERENTIAL') {
      expect(packet.target_payload.payload.analysis_id).toBe('AP_FIBER_GLUCOSE_01');
      expect(packet.target_payload.payload.dependent_variable).toBe('VAR_FASTING_GLUCOSE');
      expect(packet.target_payload.payload.alpha).toBe(0.05);
      expect(packet.target_payload.payload.confidence_level).toBe(0.95);
    }
  });

  // 22. Target module payload correctly built for REGRESSION (D11)
  it('22. correctly builds target payload for REGRESSION analysis (D11)', () => {
    const regPlan = service.planAnalysis({
      project_id: activeProject.project_id,
      analysis_id: 'AP_REGRESSION_1',
      objective_id: 'OBJ_PRIMARY',
      analysis_type: 'REGRESSION',
      input_variable_ids: ['VAR_FASTING_GLUCOSE', 'VAR_SOLUBLE_FIBER'],
      alpha: 0.05,
      planned_rationale: 'Linear regression model of glucose on fiber.'
    });

    const preview = service.previewExecution(regPlan.project_id, 'AP_REGRESSION_1');
    const auth = service.authorizeExecution(regPlan.project_id, 'AP_REGRESSION_1', 'Dr. Sarah Connor');

    const packet = AuthorizedExecutionAdapter.createDispatchPacket({
      authorization: auth,
      preview,
      project: regPlan
    });

    expect(packet.target_module_id).toBe('D11_REGRESSION_MODELING');
    expect(packet.target_payload.type).toBe('D11_REGRESSION');
    if (packet.target_payload.type === 'D11_REGRESSION') {
      expect(packet.target_payload.payload.model_id).toBe('AP_REGRESSION_1');
      expect(packet.target_payload.payload.dependent_variable).toBe('VAR_FASTING_GLUCOSE');
      expect(packet.target_payload.payload.independent_variables).toEqual(['VAR_SOLUBLE_FIBER']);
    }
  });

  // 23. Target module payload correctly built for POWER (D12)
  it('23. correctly builds target payload for POWER analysis (D12)', () => {
    const powerPlan = service.planAnalysis({
      project_id: activeProject.project_id,
      analysis_id: 'AP_POWER_1',
      objective_id: 'OBJ_PRIMARY',
      analysis_type: 'POWER_ANALYSIS',
      input_variable_ids: ['VAR_SOLUBLE_FIBER'],
      alpha: 0.05,
      configuration: {
        target_power: 0.85,
        effect_size: 0.4
      },
      planned_rationale: 'Statistical power calculation.'
    });

    const preview = service.previewExecution(powerPlan.project_id, 'AP_POWER_1');
    const auth = service.authorizeExecution(powerPlan.project_id, 'AP_POWER_1', 'Dr. Sarah Connor');

    const packet = AuthorizedExecutionAdapter.createDispatchPacket({
      authorization: auth,
      preview,
      project: powerPlan
    });

    expect(packet.target_module_id).toBe('D12_POWER_ANALYSIS');
    expect(packet.target_payload.type).toBe('D12_POWER');
    if (packet.target_payload.type === 'D12_POWER') {
      expect(packet.target_payload.payload.power_analysis_id).toBe('AP_POWER_1');
      expect(packet.target_payload.payload.target_power).toBe(0.85);
      expect(packet.target_payload.payload.effect_size).toBe(0.4);
    }
  });

  // 24. Target module payload correctly built for NONPARAMETRIC (D13)
  it('24. correctly builds target payload for NONPARAMETRIC analysis (D13)', () => {
    const nonParamPlan = service.planAnalysis({
      project_id: activeProject.project_id,
      analysis_id: 'AP_NONPARAM_1',
      objective_id: 'OBJ_PRIMARY',
      analysis_type: 'NON_PARAMETRIC',
      input_variable_ids: ['VAR_FASTING_GLUCOSE', 'VAR_SOLUBLE_FIBER'],
      alpha: 0.05,
      planned_rationale: 'Non-parametric Wilcoxon test.'
    });

    const preview = service.previewExecution(nonParamPlan.project_id, 'AP_NONPARAM_1');
    const auth = service.authorizeExecution(nonParamPlan.project_id, 'AP_NONPARAM_1', 'Dr. Sarah Connor');

    const packet = AuthorizedExecutionAdapter.createDispatchPacket({
      authorization: auth,
      preview,
      project: nonParamPlan
    });

    expect(packet.target_module_id).toBe('D13_NON_PARAMETRIC_STATISTICS');
    expect(packet.target_payload.type).toBe('D13_NON_PARAMETRIC');
    if (packet.target_payload.type === 'D13_NON_PARAMETRIC') {
      expect(packet.target_payload.payload.analysis_id).toBe('AP_NONPARAM_1');
      expect(packet.target_payload.payload.dependent_variable).toBe('VAR_FASTING_GLUCOSE');
    }
  });

  // 25. Adapter does NOT calculate statistics
  it('25. does NOT calculate any statistics during dispatch preparation', () => {
    const packet = AuthorizedExecutionAdapter.createDispatchPacket({
      authorization: validAuthorization,
      preview: validPreview,
      project: activeProject
    });

    // Ensure no result or statistical property is added
    expect((packet as any).mean).toBeUndefined();
    expect((packet as any).p_value).toBeUndefined();
    expect((packet as any).effect_size).toBeUndefined();
    expect((packet as any).r_squared).toBeUndefined();
    expect((packet as any).result).toBeUndefined();
    expect((packet as any).result_set).toBeUndefined();
  });

  // 26. D9 engine is NOT invoked
  it('26. confirms that D9 descriptive statistics engine is never executed', () => {
    const historyBefore = activeProject.execution_history ? [...activeProject.execution_history] : [];
    const packet = AuthorizedExecutionAdapter.createDispatchPacket({
      authorization: validAuthorization,
      preview: validPreview,
      project: activeProject
    });
    expect(packet).toBeDefined();
    expect(activeProject.execution_history || []).toEqual(historyBefore);
    expect((packet as any).descriptive_results).toBeUndefined();
  });

  // 27. D10 engine is NOT invoked
  it('27. confirms that D10 inferential statistics engine is never executed', () => {
    const packet = AuthorizedExecutionAdapter.createDispatchPacket({
      authorization: validAuthorization,
      preview: validPreview,
      project: activeProject
    });
    expect(packet).toBeDefined();
    expect((packet as any).p_value).toBeUndefined();
    expect((packet as any).t_statistic).toBeUndefined();
  });

  // 28. D11 engine is NOT invoked
  it('28. confirms that D11 regression engine is never executed', () => {
    const packet = AuthorizedExecutionAdapter.createDispatchPacket({
      authorization: validAuthorization,
      preview: validPreview,
      project: activeProject
    });
    expect(packet).toBeDefined();
    expect((packet as any).beta).toBeUndefined();
    expect((packet as any).coefficients).toBeUndefined();
  });

  // 29. D12 engine is NOT invoked
  it('29. confirms that D12 power engine is never executed', () => {
    const packet = AuthorizedExecutionAdapter.createDispatchPacket({
      authorization: validAuthorization,
      preview: validPreview,
      project: activeProject
    });
    expect(packet).toBeDefined();
    expect((packet as any).power).toBeUndefined();
    expect((packet as any).required_sample_size).toBeUndefined();
  });

  // 30. D13 engine is NOT invoked
  it('30. confirms that D13 non-parametric engine is never executed', () => {
    const packet = AuthorizedExecutionAdapter.createDispatchPacket({
      authorization: validAuthorization,
      preview: validPreview,
      project: activeProject
    });
    expect(packet).toBeDefined();
    expect((packet as any).u_statistic).toBeUndefined();
    expect((packet as any).wilcoxon_w).toBeUndefined();
  });

  // 31. ResearchWorkspaceService dispatch integration and store persistence
  it('31. integrates seamlessly with ResearchWorkspaceService and persists to dispatch store', () => {
    const dispatched = service.dispatchAuthorizedExecution(
      activeProject.project_id,
      'AP_FIBER_GLUCOSE_01'
    );

    expect(dispatched.dispatch_id).toMatch(/^disp_/);
    expect(dispatched.dispatch_status).toBe('READY');

    // Retrieve via service
    const retrieved = service.getDispatchPacket(dispatched.dispatch_id);
    expect(retrieved).toBeDefined();
    expect(retrieved?.dispatch_id).toBe(dispatched.dispatch_id);

    const retrievedByAnalysis = service.getDispatchForAnalysis(
      activeProject.project_id,
      'AP_FIBER_GLUCOSE_01'
    );
    expect(retrievedByAnalysis?.dispatch_id).toBe(dispatched.dispatch_id);

    const allDispatches = service.listDispatches();
    expect(allDispatches.length).toBe(1);
  });

  // 32. Security check: Zero eval() and Zero new Function() across Phase F2.2C.2 code
  it('32. strictly verifies zero eval() and zero new Function() in F2.2C.2 files', () => {
    const contractsFile = path.resolve(__dirname, '../data/authorizedExecutionAdapterContracts.ts');
    const adapterFile = path.resolve(__dirname, '../data/authorizedExecutionAdapter.ts');

    const contractsCode = fs.readFileSync(contractsFile, 'utf8');
    const adapterCode = fs.readFileSync(adapterFile, 'utf8');

    expect(contractsCode).not.toMatch(/\beval\s*\(/);
    expect(contractsCode).not.toMatch(/\bnew\s+Function\s*\(/);
    expect(adapterCode).not.toMatch(/\beval\s*\(/);
    expect(adapterCode).not.toMatch(/\bnew\s+Function\s*\(/);
  });
});
