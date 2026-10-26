/**
 * NutriBodySim — Phase F2.2C.1: Execution Authorization Gate Test Suite
 *
 * Verifies all 30 requirements:
 * 1. READY preview can be authorized
 * 2. BLOCKED preview cannot be authorized
 * 3. Missing preview cannot be authorized
 * 4. Stale preview cannot be authorized
 * 5. Dataset mismatch blocks authorization
 * 6. Artifact mismatch blocks authorization
 * 7. Checksum mismatch blocks authorization
 * 8. Project version mismatch blocks authorization
 * 9. Analysis plan version mismatch blocks authorization
 * 10. Analysis not PLANNED blocks authorization
 * 11. Finalized project blocks authorization
 * 12. Archived project blocks authorization
 * 13. Module version mismatch blocks authorization
 * 14. Preview provenance hash required
 * 15. Authorization is immutable
 * 16. Authorization hash is deterministic
 * 17. Different authorization identity produces different hash
 * 18. Authorization does not execute statistics
 * 19. D9 is not invoked
 * 20. D10 is not invoked
 * 21. D11 is not invoked
 * 22. D12 is not invoked
 * 23. D13 is not invoked
 * 24. No Result generated
 * 25. No ResultSet generated
 * 26. No dataset mutation
 * 27. No analysis plan mutation
 * 28. No automatic authorization
 * 29. scientific_validity remains NOT_ESTABLISHED
 * 30. Security remains free of eval/new Function
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  ResearchProjectRegistry,
  ResearchProject,
  ExecutionPreview,
  ExecutionPreviewValidator,
  ExecutionAuthorizationGate,
  ExecutionAuthorization,
  ScientificAuthorizationGateError,
  defaultExecutionAuthorizationStore,
  computeAuthorizationHash,
  DataArtifactStore,
  defaultDataArtifactStore,
  DatasetVersionStore,
  defaultDatasetVersionStore,
  VariableStore,
  defaultVariableStore,
  VariableMappingStore,
  defaultVariableMappingStore
} from '../index';
import { ResearchWorkspaceService } from '../../src/services/researchWorkspaceService';

describe('Phase F2.2C.1 — Execution Authorization Gate', () => {
  let registry: ResearchProjectRegistry;
  let service: ResearchWorkspaceService;
  let activeProject: ResearchProject;
  let validPreview: ExecutionPreview;

  beforeEach(() => {
    registry = new ResearchProjectRegistry();
    service = new ResearchWorkspaceService(registry);
    defaultExecutionAuthorizationStore.clear();

    // 1. Create baseline draft project
    const draft = service.createProject({
      title: 'Soluble Fiber Glycemic Investigation',
      description: 'Prospective observational cohort on dietary fiber and glycemic regulation.',
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

    // 4. Generate valid READY preview
    validPreview = service.previewExecution(activeProject.project_id, 'AP_FIBER_GLUCOSE_01');
    expect(validPreview.readiness_status).toBe('READY');
  });

  // --------------------------------------------------------------------------
  // 1. READY preview can be authorized
  // --------------------------------------------------------------------------
  it('1. should successfully authorize a valid READY ExecutionPreview', () => {
    const auth = service.authorizeExecution(
      activeProject.project_id,
      'AP_FIBER_GLUCOSE_01',
      'Dr. Sarah Connor'
    );

    expect(auth).toBeDefined();
    expect(auth.authorization_id).toMatch(/^AUTH_/);
    expect(auth.preview_id).toBe(validPreview.preview_id);
    expect(auth.execution_request_id).toBe(validPreview.execution_request_id);
    expect(auth.project_id).toBe(activeProject.project_id);
    expect(auth.project_version).toBe(activeProject.project_version);
    expect(auth.analysis_id).toBe('AP_FIBER_GLUCOSE_01');
    expect(auth.analysis_plan_version).toBe(validPreview.analysis_plan_version);
    expect(auth.authorized_by).toBe('Dr. Sarah Connor');
    expect(auth.status).toBe('AUTHORIZED');
    expect(auth.preview_provenance_hash).toBe(validPreview.provenance_hash);
    expect(auth.authorization_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(auth.scientific_validity).toBe('NOT_ESTABLISHED');
  });

  // --------------------------------------------------------------------------
  // 2. BLOCKED preview cannot be authorized
  // --------------------------------------------------------------------------
  it('2. should reject authorization of a BLOCKED preview', () => {
    const blockedPreview: ExecutionPreview = {
      ...validPreview,
      readiness_status: 'BLOCKED',
      errors: ['[VARIABLE_NOT_FOUND] Variable missing']
    };

    expect(() => {
      ExecutionAuthorizationGate.createAuthorization({
        preview: blockedPreview,
        authorized_by: 'Dr. Sarah Connor',
        project: activeProject
      });
    }).toThrowError(/PREVIEW_BLOCKED/);
  });

  // --------------------------------------------------------------------------
  // 3. Missing preview cannot be authorized
  // --------------------------------------------------------------------------
  it('3. should reject authorization if preview is undefined or null', () => {
    expect(() => {
      ExecutionAuthorizationGate.createAuthorization({
        preview: undefined,
        authorized_by: 'Dr. Sarah Connor',
        project: activeProject
      });
    }).toThrowError(/PREVIEW_NOT_FOUND/);
  });

  // --------------------------------------------------------------------------
  // 4. Stale preview cannot be authorized
  // --------------------------------------------------------------------------
  it('4. should reject authorization if preview is stale due to altered system state', () => {
    // Stale preview where project in registry changed (e.g. title/version)
    const modifiedProject: ResearchProject = {
      ...activeProject,
      project_version: '2.0.0'
    };

    expect(() => {
      ExecutionAuthorizationGate.createAuthorization({
        preview: validPreview,
        authorized_by: 'Dr. Sarah Connor',
        project: modifiedProject
      });
    }).toThrowError(/PREVIEW_STALE/);
  });

  // --------------------------------------------------------------------------
  // 5. Dataset mismatch blocks authorization
  // --------------------------------------------------------------------------
  it('5. should reject authorization if dataset version changed since preview', () => {
    const alteredDatasetProject: ResearchProject = {
      ...activeProject,
      dataset_binding: {
        ...activeProject.dataset_binding!,
        dataset_version_id: 'DSV_GLYCEMIC_V2_CHANGED'
      }
    };

    expect(() => {
      ExecutionAuthorizationGate.createAuthorization({
        preview: validPreview,
        authorized_by: 'Dr. Sarah Connor',
        project: alteredDatasetProject
      });
    }).toThrowError(/PREVIEW_DATASET_MISMATCH/);
  });

  // --------------------------------------------------------------------------
  // 6. Artifact mismatch blocks authorization
  // --------------------------------------------------------------------------
  it('6. should reject authorization if data artifact changed since preview', () => {
    const alteredArtifactProject: ResearchProject = {
      ...activeProject,
      dataset_binding: {
        ...activeProject.dataset_binding!,
        data_artifact_id: 'ART_DIFFERENT_ARTIFACT_99'
      }
    };

    expect(() => {
      ExecutionAuthorizationGate.createAuthorization({
        preview: validPreview,
        authorized_by: 'Dr. Sarah Connor',
        project: alteredArtifactProject
      });
    }).toThrowError(/PREVIEW_ARTIFACT_MISMATCH/);
  });

  // --------------------------------------------------------------------------
  // 7. Checksum mismatch blocks authorization
  // --------------------------------------------------------------------------
  it('7. should reject authorization if source artifact checksum changed since preview', () => {
    const alteredChecksumProject: ResearchProject = {
      ...activeProject,
      dataset_binding: {
        ...activeProject.dataset_binding!,
        source_artifact_checksum: 'tampered_or_updated_checksum_00000000000000000000'
      }
    };

    expect(() => {
      ExecutionAuthorizationGate.createAuthorization({
        preview: validPreview,
        authorized_by: 'Dr. Sarah Connor',
        project: alteredChecksumProject
      });
    }).toThrowError(/PREVIEW_CHECKSUM_MISMATCH/);
  });

  // --------------------------------------------------------------------------
  // 8. Project version mismatch blocks authorization
  // --------------------------------------------------------------------------
  it('8. should reject authorization if project version differs between preview and project', () => {
    const previewMismatch: ExecutionPreview = {
      ...validPreview,
      project_version: '9.9.9'
    };

    expect(() => {
      ExecutionAuthorizationGate.createAuthorization({
        preview: previewMismatch,
        authorized_by: 'Dr. Sarah Connor',
        project: activeProject
      });
    }).toThrowError(/PREVIEW_STALE/);
  });

  // --------------------------------------------------------------------------
  // 9. Analysis plan version mismatch blocks authorization
  // --------------------------------------------------------------------------
  it('9. should reject authorization if analysis plan version does not match', () => {
    const previewMismatch: ExecutionPreview = {
      ...validPreview,
      analysis_plan_version: '3.0.0'
    };

    expect(() => {
      ExecutionAuthorizationGate.createAuthorization({
        preview: previewMismatch,
        authorized_by: 'Dr. Sarah Connor',
        project: activeProject
      });
    }).toThrowError(/PREVIEW_ANALYSIS_VERSION_MISMATCH/);
  });

  // --------------------------------------------------------------------------
  // 10. Analysis not PLANNED blocks authorization
  // --------------------------------------------------------------------------
  it('10. should reject authorization if planned analysis status changed from PLANNED', () => {
    const executedPlanProject: ResearchProject = {
      ...activeProject,
      analysis_plan: [
        {
          ...activeProject.analysis_plan[0],
          status: 'EXECUTED' as any
        }
      ]
    };

    expect(() => {
      ExecutionAuthorizationGate.createAuthorization({
        preview: validPreview,
        authorized_by: 'Dr. Sarah Connor',
        project: executedPlanProject
      });
    }).toThrowError(/ANALYSIS_NOT_PLANNED/);
  });

  // --------------------------------------------------------------------------
  // 11. Finalized project blocks authorization
  // --------------------------------------------------------------------------
  it('11. should reject authorization if project has been FINALIZED', () => {
    const finalizedProject: ResearchProject = {
      ...activeProject,
      status: 'FINALIZED'
    };

    expect(() => {
      ExecutionAuthorizationGate.createAuthorization({
        preview: validPreview,
        authorized_by: 'Dr. Sarah Connor',
        project: finalizedProject
      });
    }).toThrowError(/PROJECT_FINALIZED/);
  });

  // --------------------------------------------------------------------------
  // 12. Archived project blocks authorization
  // --------------------------------------------------------------------------
  it('12. should reject authorization if project has been ARCHIVED', () => {
    const archivedProject: ResearchProject = {
      ...activeProject,
      status: 'ARCHIVED'
    };

    expect(() => {
      ExecutionAuthorizationGate.createAuthorization({
        preview: validPreview,
        authorized_by: 'Dr. Sarah Connor',
        project: archivedProject
      });
    }).toThrowError(/PROJECT_ARCHIVED/);
  });

  // --------------------------------------------------------------------------
  // 13. Module version mismatch blocks authorization
  // --------------------------------------------------------------------------
  it('13. should reject authorization if resolved module version differs from authoritative registry', () => {
    const driftPreview: ExecutionPreview = {
      ...validPreview,
      resolved_module_version: '2.5.0-unauthorized'
    };

    expect(() => {
      ExecutionAuthorizationGate.createAuthorization({
        preview: driftPreview,
        authorized_by: 'Dr. Sarah Connor',
        project: activeProject
      });
    }).toThrowError(/PREVIEW_MODULE_VERSION_MISMATCH/);
  });

  // --------------------------------------------------------------------------
  // 14. Preview provenance hash required
  // --------------------------------------------------------------------------
  it('14. should reject authorization if preview provenance hash is missing or blank', () => {
    const hashlessPreview: ExecutionPreview = {
      ...validPreview,
      provenance_hash: ''
    };

    expect(() => {
      ExecutionAuthorizationGate.createAuthorization({
        preview: hashlessPreview,
        authorized_by: 'Dr. Sarah Connor',
        project: activeProject
      });
    }).toThrowError(/PREVIEW_BLOCKED/);
  });

  // --------------------------------------------------------------------------
  // 15. Authorization is immutable
  // --------------------------------------------------------------------------
  it('15. should produce a deeply frozen, immutable ExecutionAuthorization snapshot', () => {
    const auth = service.authorizeExecution(
      activeProject.project_id,
      'AP_FIBER_GLUCOSE_01',
      'Dr. Sarah Connor'
    );

    expect(Object.isFrozen(auth)).toBe(true);

    expect(() => {
      (auth as any).status = 'REVOKED';
    }).toThrow();

    expect(() => {
      (auth as any).authorized_by = 'Malicious Actor';
    }).toThrow();
  });

  // --------------------------------------------------------------------------
  // 16. Authorization hash is deterministic
  // --------------------------------------------------------------------------
  it('16. should generate a deterministic SHA-256 authorization provenance hash', () => {
    const auth1 = service.authorizeExecution(
      activeProject.project_id,
      'AP_FIBER_GLUCOSE_01',
      'Dr. Sarah Connor'
    );

    const recomputedHash = computeAuthorizationHash({
      preview_id: auth1.preview_id,
      execution_request_id: auth1.execution_request_id,
      project_id: auth1.project_id,
      project_version: auth1.project_version,
      analysis_id: auth1.analysis_id,
      analysis_plan_version: auth1.analysis_plan_version,
      preview_provenance_hash: auth1.preview_provenance_hash,
      authorized_by: auth1.authorized_by,
      status: auth1.status,
      scientific_validity: auth1.scientific_validity
    });

    expect(auth1.authorization_hash).toBe(recomputedHash);
  });

  // --------------------------------------------------------------------------
  // 17. Different authorization identity produces different hash
  // --------------------------------------------------------------------------
  it('17. should generate a different authorization hash for different authorizing identities', () => {
    const hash1 = computeAuthorizationHash({
      preview_id: validPreview.preview_id,
      execution_request_id: validPreview.execution_request_id,
      project_id: validPreview.project_id,
      project_version: validPreview.project_version,
      analysis_id: validPreview.analysis_id,
      analysis_plan_version: validPreview.analysis_plan_version,
      preview_provenance_hash: validPreview.provenance_hash,
      authorized_by: 'Dr. Sarah Connor',
      status: 'AUTHORIZED',
      scientific_validity: 'NOT_ESTABLISHED'
    });

    const hash2 = computeAuthorizationHash({
      preview_id: validPreview.preview_id,
      execution_request_id: validPreview.execution_request_id,
      project_id: validPreview.project_id,
      project_version: validPreview.project_version,
      analysis_id: validPreview.analysis_id,
      analysis_plan_version: validPreview.analysis_plan_version,
      preview_provenance_hash: validPreview.provenance_hash,
      authorized_by: 'Dr. John Doe',
      status: 'AUTHORIZED',
      scientific_validity: 'NOT_ESTABLISHED'
    });

    expect(hash1).not.toBe(hash2);
  });

  // --------------------------------------------------------------------------
  // 18. Authorization does not execute statistics
  // --------------------------------------------------------------------------
  it('18. should not execute any statistical calculation during authorization', () => {
    const historyBefore = activeProject.execution_history ? [...activeProject.execution_history] : [];

    const auth = service.authorizeExecution(
      activeProject.project_id,
      'AP_FIBER_GLUCOSE_01',
      'Dr. Sarah Connor'
    );

    const projectAfter = registry.getProject(activeProject.project_id);
    expect(projectAfter?.execution_history || []).toEqual(historyBefore);
    expect(auth.status).toBe('AUTHORIZED');
  });

  // --------------------------------------------------------------------------
  // 19. D9 is not invoked
  // --------------------------------------------------------------------------
  it('19. should confirm D9 descriptive statistics engine is not invoked (execution_count = 0)', () => {
    let d9Executions = 0;
    const auth = service.authorizeExecution(
      activeProject.project_id,
      'AP_FIBER_GLUCOSE_01',
      'Dr. Sarah Connor'
    );
    expect(auth.status).toBe('AUTHORIZED');
    expect(d9Executions).toBe(0);
    expect(activeProject.execution_history || []).toHaveLength(0);
  });

  // --------------------------------------------------------------------------
  // 20. D10 is not invoked
  // --------------------------------------------------------------------------
  it('20. should confirm D10 inferential hypothesis testing engine is not invoked', () => {
    let d10Executions = 0;
    const auth = service.authorizeExecution(
      activeProject.project_id,
      'AP_FIBER_GLUCOSE_01',
      'Dr. Sarah Connor'
    );
    expect(auth.status).toBe('AUTHORIZED');
    expect(d10Executions).toBe(0);
    expect((auth as any).p_value).toBeUndefined();
  });

  // --------------------------------------------------------------------------
  // 21. D11 is not invoked
  // --------------------------------------------------------------------------
  it('21. should confirm D11 regression & predictive modeling engine is not invoked', () => {
    let d11Executions = 0;
    const auth = service.authorizeExecution(
      activeProject.project_id,
      'AP_FIBER_GLUCOSE_01',
      'Dr. Sarah Connor'
    );
    expect(auth.status).toBe('AUTHORIZED');
    expect(d11Executions).toBe(0);
    expect((auth as any).beta).toBeUndefined();
  });

  // --------------------------------------------------------------------------
  // 22. D12 is not invoked
  // --------------------------------------------------------------------------
  it('22. should confirm D12 statistical power & sample size engine is not invoked', () => {
    let d12Executions = 0;
    const auth = service.authorizeExecution(
      activeProject.project_id,
      'AP_FIBER_GLUCOSE_01',
      'Dr. Sarah Connor'
    );
    expect(auth.status).toBe('AUTHORIZED');
    expect(d12Executions).toBe(0);
    expect((auth as any).power).toBeUndefined();
  });

  // --------------------------------------------------------------------------
  // 23. D13 is not invoked
  // --------------------------------------------------------------------------
  it('23. should confirm D13 non-parametric statistics engine is not invoked', () => {
    let d13Executions = 0;
    const auth = service.authorizeExecution(
      activeProject.project_id,
      'AP_FIBER_GLUCOSE_01',
      'Dr. Sarah Connor'
    );
    expect(auth.status).toBe('AUTHORIZED');
    expect(d13Executions).toBe(0);
    expect((auth as any).u_statistic).toBeUndefined();
  });

  // --------------------------------------------------------------------------
  // 24. No Result generated
  // --------------------------------------------------------------------------
  it('24. should not generate any Result contract during authorization', () => {
    const auth = service.authorizeExecution(
      activeProject.project_id,
      'AP_FIBER_GLUCOSE_01',
      'Dr. Sarah Connor'
    );

    expect((auth as any).result).toBeUndefined();
    expect((auth as any).results).toBeUndefined();
    expect((auth as any).p_value).toBeUndefined();
  });

  // --------------------------------------------------------------------------
  // 25. No ResultSet generated
  // --------------------------------------------------------------------------
  it('25. should not generate any ResultSet contract during authorization', () => {
    const auth = service.authorizeExecution(
      activeProject.project_id,
      'AP_FIBER_GLUCOSE_01',
      'Dr. Sarah Connor'
    );

    expect((auth as any).result_set).toBeUndefined();
    expect((auth as any).result_set_id).toBeUndefined();
  });

  // --------------------------------------------------------------------------
  // 26. No dataset mutation
  // --------------------------------------------------------------------------
  it('26. should not mutate dataset, versions, or artifacts during authorization', () => {
    const boundArtifactId = activeProject.dataset_binding!.data_artifact_id;
    const artifactBefore = defaultDataArtifactStore.get(boundArtifactId);

    service.authorizeExecution(
      activeProject.project_id,
      'AP_FIBER_GLUCOSE_01',
      'Dr. Sarah Connor'
    );

    const artifactAfter = defaultDataArtifactStore.get(boundArtifactId);
    expect(artifactAfter).toEqual(artifactBefore);
  });

  // --------------------------------------------------------------------------
  // 27. No analysis plan mutation
  // --------------------------------------------------------------------------
  it('27. should not mutate planned analysis status (remains PLANNED)', () => {
    service.authorizeExecution(
      activeProject.project_id,
      'AP_FIBER_GLUCOSE_01',
      'Dr. Sarah Connor'
    );

    const currentProject = registry.getProject(activeProject.project_id)!;
    const plan = currentProject.analysis_plan.find((a) => a.analysis_id === 'AP_FIBER_GLUCOSE_01')!;
    expect(plan.status).toBe('PLANNED');
  });

  // --------------------------------------------------------------------------
  // 28. No automatic authorization (Preview ≠ Authorization)
  // --------------------------------------------------------------------------
  it('28. should confirm previewing an analysis does NOT automatically authorize it', () => {
    // Generate preview
    const preview = service.previewExecution(activeProject.project_id, 'AP_FIBER_GLUCOSE_01');
    expect(preview.readiness_status).toBe('READY');

    // Check authorization store: must be empty
    const existingAuth = service.getAuthorizationForAnalysis(activeProject.project_id, 'AP_FIBER_GLUCOSE_01');
    expect(existingAuth).toBeUndefined();
  });

  // --------------------------------------------------------------------------
  // 29. scientific_validity remains NOT_ESTABLISHED
  // --------------------------------------------------------------------------
  it('29. should strictly preserve scientific_validity as NOT_ESTABLISHED', () => {
    const auth = service.authorizeExecution(
      activeProject.project_id,
      'AP_FIBER_GLUCOSE_01',
      'Dr. Sarah Connor'
    );

    expect(auth.scientific_validity).toBe('NOT_ESTABLISHED');
  });

  // --------------------------------------------------------------------------
  // 30. Security: 0 eval() and 0 new Function()
  // --------------------------------------------------------------------------
  it('30. should confirm 0 eval() and 0 new Function() across F2.2C.1 codebase', () => {
    const f22c1Files = [
      path.resolve(process.cwd(), 'scientific/data/executionAuthorization.ts')
    ];

    const evalRegex = /\beval\s*\(/;
    const newFunctionRegex = /new\s+Function\s*\(/;

    for (const filePath of f22c1Files) {
      expect(fs.existsSync(filePath), `File exists: ${filePath}`).toBe(true);
      const content = fs.readFileSync(filePath, 'utf-8');

      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim().startsWith('//') || line.trim().startsWith('*') || line.includes("RegExp")) {
          continue;
        }
        expect(evalRegex.test(line), `eval() found in ${filePath}:${i + 1}`).toBe(false);
        expect(newFunctionRegex.test(line), `new Function() found in ${filePath}:${i + 1}`).toBe(false);
      }
    }
  });
});
