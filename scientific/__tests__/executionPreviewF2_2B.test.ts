/**
 * NutriBodySim — Phase F2.2B: Execution Preview & Preflight Validation Test Suite
 *
 * Verifies all 28 requirements:
 * 1. Valid READY preview
 * 2. Blocked preview
 * 3. Project mismatch
 * 4. Project version mismatch
 * 5. Finalized project blocked
 * 6. Archived project blocked
 * 7. Analysis not PLANNED blocked
 * 8. Dataset version mismatch
 * 9. Artifact mismatch
 * 10. Checksum mismatch
 * 11. Lineage failure
 * 12. Missing variable
 * 13. Invalid variable mapping
 * 14. Module resolution
 * 15. Exact module version preservation
 * 16. Invalid alpha
 * 17. Invalid confidence level
 * 18. Immutable preview
 * 19. Deterministic preview hash
 * 20. Same input → same preview
 * 21. Different input → different hash
 * 22. scientific_validity remains NOT_ESTABLISHED
 * 23. No statistical execution
 * 24. No generated result
 * 25. No automatic variable inference
 * 26. No automatic hypothesis generation
 * 27. No automatic statistical test selection
 * 28. Security scan remains clean (0 eval, 0 new Function)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  ResearchProjectRegistry,
  ResearchProject,
  createDataArtifact,
  DatasetVersionStore,
  DataArtifactStore,
  VariableStore,
  VariableMappingStore,
  defaultDatasetVersionStore,
  defaultDataArtifactStore,
  defaultVariableStore,
  defaultVariableMappingStore,
  ExecutionPreviewValidator,
  ExecutionPreview,
  computeExecutionPreviewProvenanceHash,
  ANALYSIS_MODULE_REGISTRY,
  deepFreeze
} from '../index';
import { ResearchWorkspaceService } from '../../src/services/researchWorkspaceService';

describe('Phase F2.2B — Execution Preview & Preflight Validation', () => {
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
  });

  // --------------------------------------------------------------------------
  // 1. Valid READY preview
  // --------------------------------------------------------------------------
  it('1. should generate a valid READY ExecutionPreview for a compliant planned analysis', () => {
    const preview = service.previewExecution(activeProject.project_id, 'AP_FIBER_GLUCOSE_01');

    expect(preview.readiness_status).toBe('READY');
    expect(preview.errors).toHaveLength(0);
    expect(preview.preview_id).toMatch(/^PREVIEW_/);
    expect(preview.project_id).toBe(activeProject.project_id);
    expect(preview.analysis_id).toBe('AP_FIBER_GLUCOSE_01');
    expect(preview.analysis_type).toBe('INFERENTIAL');
    expect(preview.resolved_module_id).toBe('D10_INFERENTIAL_STATISTICS');
    expect(preview.resolved_module_version).toBe('1.0.0');
    expect(preview.dataset_version_id).toBe('DSV_GLYCEMIC_V1');
    expect(preview.data_artifact_id).toBe('ART_GLYCEMIC_ANALYSIS_READY_01');
    expect(preview.source_artifact_checksum).toBeDefined();
    expect(preview.input_variable_ids).toEqual(['VAR_FASTING_GLUCOSE', 'VAR_SOLUBLE_FIBER']);
    expect(preview.grouping_variable_ids).toEqual(['VAR_INTERVENTION_ARM']);
    expect(preview.alpha).toBe(0.05);
    expect(preview.confidence_level).toBe(0.95);
    expect(preview.provenance_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(preview.scientific_validity).toBe('NOT_ESTABLISHED');
  });

  // --------------------------------------------------------------------------
  // 2. Blocked preview
  // --------------------------------------------------------------------------
  it('2. should mark preview as BLOCKED when structural requirements fail', () => {
    // Project without dataset binding
    const unboundProject = service.createProject({
      title: 'Unbound Study',
      description: 'Study with no bound dataset',
      created_by: 'Researcher',
      study_design: { design_type: 'CROSS_SECTIONAL', description: 'Cross sectional study' },
      research_question: { question_text: 'Question', priority: 'PRIMARY' },
      objective: { objective_id: 'OBJ_1', type: 'PRIMARY_OBJECTIVE', description: 'Objective 1' },
      hypothesis: {
        hypothesis_id: 'HYP_1',
        null_hypothesis: 'Null hypothesis',
        alternative_hypothesis: 'Alternative hypothesis',
        direction: 'TWO_SIDED'
      }
    });

    const preview = ExecutionPreviewValidator.generatePreview({
      project: unboundProject,
      analysis_id: 'NON_EXISTENT_ANALYSIS'
    });

    expect(preview.readiness_status).toBe('BLOCKED');
    expect(preview.errors.length).toBeGreaterThan(0);
    expect(preview.errors.some((e) => e.includes('DATASET_BINDING_MISMATCH'))).toBe(true);
    expect(preview.errors.some((e) => e.includes('ANALYSIS_NOT_FOUND'))).toBe(true);
  });

  // --------------------------------------------------------------------------
  // 3. Project mismatch
  // --------------------------------------------------------------------------
  it('3. should block preview if project object is missing or invalid', () => {
    const preview = ExecutionPreviewValidator.generatePreview({
      project: undefined as unknown as ResearchProject,
      project_id: 'MISSING_PROJECT',
      analysis_id: 'AP_FIBER_GLUCOSE_01'
    });

    expect(preview.readiness_status).toBe('BLOCKED');
    expect(preview.errors.some((e) => e.includes('PROJECT_NOT_FOUND'))).toBe(true);
  });

  // --------------------------------------------------------------------------
  // 4. Project version mismatch
  // --------------------------------------------------------------------------
  it('4. should block preview if requested project version does not match', () => {
    const preview = ExecutionPreviewValidator.generatePreview({
      project: activeProject,
      analysis_id: 'AP_FIBER_GLUCOSE_01',
      project_version: '9.9.9'
    });

    expect(preview.readiness_status).toBe('BLOCKED');
    expect(preview.errors.some((e) => e.includes('PROJECT_VERSION_NOT_FOUND'))).toBe(true);
  });

  // --------------------------------------------------------------------------
  // 5. Finalized project blocked
  // --------------------------------------------------------------------------
  it('5. should block preview if project is FINALIZED', () => {
    const finalized = { ...activeProject, status: 'FINALIZED' as const };
    const preview = ExecutionPreviewValidator.generatePreview({
      project: finalized,
      analysis_id: 'AP_FIBER_GLUCOSE_01'
    });

    expect(preview.readiness_status).toBe('BLOCKED');
    expect(preview.errors.some((e) => e.includes('PROJECT_FINALIZED'))).toBe(true);
  });

  // --------------------------------------------------------------------------
  // 6. Archived project blocked
  // --------------------------------------------------------------------------
  it('6. should block preview if project is ARCHIVED', () => {
    const archived = { ...activeProject, status: 'ARCHIVED' as const };
    const preview = ExecutionPreviewValidator.generatePreview({
      project: archived,
      analysis_id: 'AP_FIBER_GLUCOSE_01'
    });

    expect(preview.readiness_status).toBe('BLOCKED');
    expect(preview.errors.some((e) => e.includes('PROJECT_ARCHIVED'))).toBe(true);
  });

  // --------------------------------------------------------------------------
  // 7. Analysis not PLANNED blocked
  // --------------------------------------------------------------------------
  it('7. should block preview if planned analysis status is not PLANNED', () => {
    const corruptedProject: ResearchProject = {
      ...activeProject,
      analysis_plan: [
        {
          ...activeProject.analysis_plan[0],
          status: 'EXECUTED' as any
        }
      ]
    };

    const preview = ExecutionPreviewValidator.generatePreview({
      project: corruptedProject,
      analysis_id: 'AP_FIBER_GLUCOSE_01'
    });

    expect(preview.readiness_status).toBe('BLOCKED');
    expect(preview.errors.some((e) => e.includes('ANALYSIS_NOT_PLANNED'))).toBe(true);
  });

  // --------------------------------------------------------------------------
  // 8. Dataset version mismatch
  // --------------------------------------------------------------------------
  it('8. should block preview if dataset version does not exist in store', () => {
    const invalidBindingProject: ResearchProject = {
      ...activeProject,
      dataset_binding: {
        ...activeProject.dataset_binding!,
        dataset_version_id: 'NON_EXISTENT_VERSION_999'
      }
    };

    const preview = ExecutionPreviewValidator.generatePreview({
      project: invalidBindingProject,
      analysis_id: 'AP_FIBER_GLUCOSE_01'
    });

    expect(preview.readiness_status).toBe('BLOCKED');
    expect(preview.errors.some((e) => e.includes('DATASET_BINDING_MISMATCH'))).toBe(true);
  });

  // --------------------------------------------------------------------------
  // 9. Artifact mismatch
  // --------------------------------------------------------------------------
  it('9. should block preview if data artifact does not exist or belongs to another version', () => {
    const invalidArtifactProject: ResearchProject = {
      ...activeProject,
      dataset_binding: {
        ...activeProject.dataset_binding!,
        data_artifact_id: 'NON_EXISTENT_ARTIFACT_999'
      }
    };

    const preview = ExecutionPreviewValidator.generatePreview({
      project: invalidArtifactProject,
      analysis_id: 'AP_FIBER_GLUCOSE_01'
    });

    expect(preview.readiness_status).toBe('BLOCKED');
    expect(preview.errors.some((e) => e.includes('ARTIFACT_BINDING_MISMATCH'))).toBe(true);
  });

  // --------------------------------------------------------------------------
  // 10. Checksum mismatch
  // --------------------------------------------------------------------------
  it('10. should block preview if artifact checksum does not match recorded binding', () => {
    const tamperedBindingProject: ResearchProject = {
      ...activeProject,
      dataset_binding: {
        ...activeProject.dataset_binding!,
        source_artifact_checksum: 'tampered_sha256_checksum_0000000000000000000000000000000000'
      }
    };

    const preview = ExecutionPreviewValidator.generatePreview({
      project: tamperedBindingProject,
      analysis_id: 'AP_FIBER_GLUCOSE_01'
    });

    expect(preview.readiness_status).toBe('BLOCKED');
    expect(preview.errors.some((e) => e.includes('CHECKSUM_MISMATCH'))).toBe(true);
  });

  // --------------------------------------------------------------------------
  // 11. Lineage failure
  // --------------------------------------------------------------------------
  it('11. should block preview if artifact parent lineage chain is broken or across versions', () => {
    const customArtifactStore = new DataArtifactStore();

    const artParent = createDataArtifact({
      artifact_id: 'ART_PARENT_PREVIEW_01',
      dataset_version_id: 'DSV_GLYCEMIC_V1',
      state: 'RAW',
      record_count: 50,
      column_count: 5,
      created_by: 'system'
    });
    customArtifactStore.create(artParent);

    const artChild = createDataArtifact({
      artifact_id: 'ART_CHILD_PREVIEW_01',
      dataset_version_id: 'DSV_GLYCEMIC_V1',
      parent_artifact_id: 'ART_PARENT_PREVIEW_01',
      state: 'ANALYSIS_READY',
      record_count: 50,
      column_count: 5,
      created_by: 'system'
    });
    customArtifactStore.create(artChild);

    // Delete parent from store to simulate broken lineage
    (customArtifactStore as any).artifacts.delete('ART_PARENT_PREVIEW_01');

    const projectWithBrokenLineage: ResearchProject = {
      ...activeProject,
      dataset_binding: {
        ...activeProject.dataset_binding!,
        data_artifact_id: 'ART_CHILD_PREVIEW_01',
        source_artifact_checksum: artChild.checksum
      }
    };

    const preview = ExecutionPreviewValidator.generatePreview({
      project: projectWithBrokenLineage,
      analysis_id: 'AP_FIBER_GLUCOSE_01',
      data_artifact_store: customArtifactStore
    });

    expect(preview.readiness_status).toBe('BLOCKED');
    expect(preview.errors.some((e) => e.includes('LINEAGE_INVALID'))).toBe(true);
  });

  // --------------------------------------------------------------------------
  // 12. Missing variable
  // --------------------------------------------------------------------------
  it('12. should block preview if an input or grouping variable is not in Variable Registry', () => {
    const missingVarProject: ResearchProject = {
      ...activeProject,
      analysis_plan: [
        {
          ...activeProject.analysis_plan[0],
          input_variable_ids: ['VAR_FASTING_GLUCOSE', 'VAR_UNREGISTERED_VARIABLE_999']
        }
      ]
    };

    const preview = ExecutionPreviewValidator.generatePreview({
      project: missingVarProject,
      analysis_id: 'AP_FIBER_GLUCOSE_01'
    });

    expect(preview.readiness_status).toBe('BLOCKED');
    expect(preview.errors.some((e) => e.includes('VARIABLE_NOT_FOUND'))).toBe(true);
  });

  // --------------------------------------------------------------------------
  // 13. Invalid variable mapping
  // --------------------------------------------------------------------------
  it('13. should block preview when strict variable mapping is enabled and mapping is missing or conflicting', () => {
    const customMappingStore = new VariableMappingStore();
    // No mappings registered in this isolated store

    const preview = ExecutionPreviewValidator.generatePreview({
      project: activeProject,
      analysis_id: 'AP_FIBER_GLUCOSE_01',
      variable_mapping_store: customMappingStore,
      strict_variable_mapping: true
    });

    expect(preview.readiness_status).toBe('BLOCKED');
    expect(preview.errors.some((e) => e.includes('VARIABLE_MAPPING_INVALID'))).toBe(true);
  });

  // --------------------------------------------------------------------------
  // 14. Module resolution
  // --------------------------------------------------------------------------
  it('14. should resolve authoritative module identities across all supported analysis types', () => {
    const typesToTest = [
      { type: 'DESCRIPTIVE', expectedModule: 'D9_DESCRIPTIVE_STATISTICS' },
      { type: 'INFERENTIAL', expectedModule: 'D10_INFERENTIAL_STATISTICS' },
      { type: 'REGRESSION', expectedModule: 'D11_REGRESSION_MODELING' },
      { type: 'POWER_ANALYSIS', expectedModule: 'D12_POWER_ANALYSIS' },
      { type: 'NON_PARAMETRIC', expectedModule: 'D13_NON_PARAMETRIC_STATISTICS' }
    ];

    for (const item of typesToTest) {
      const proj: ResearchProject = {
        ...activeProject,
        analysis_plan: [
          {
            ...activeProject.analysis_plan[0],
            analysis_type: item.type as any,
            alpha: 0.05
          }
        ]
      };

      const preview = ExecutionPreviewValidator.generatePreview({
        project: proj,
        analysis_id: 'AP_FIBER_GLUCOSE_01'
      });

      expect(preview.resolved_module_id).toBe(item.expectedModule);
    }
  });

  // --------------------------------------------------------------------------
  // 15. Exact module version preservation
  // --------------------------------------------------------------------------
  it('15. should preserve exact module version 1.0.0 without guessing or drift', () => {
    const preview = service.previewExecution(activeProject.project_id, 'AP_FIBER_GLUCOSE_01');
    expect(preview.resolved_module_version).toBe('1.0.0');
    expect(ANALYSIS_MODULE_REGISTRY.INFERENTIAL.module_version).toBe('1.0.0');
  });

  // --------------------------------------------------------------------------
  // 16. Invalid alpha
  // --------------------------------------------------------------------------
  it('16. should block preview if alpha is outside (0, 1) or missing for hypothesis testing', () => {
    const invalidAlphas = [-0.05, 0, 1, 1.5, NaN];

    for (const badAlpha of invalidAlphas) {
      const proj: ResearchProject = {
        ...activeProject,
        analysis_plan: [
          {
            ...activeProject.analysis_plan[0],
            alpha: badAlpha
          }
        ]
      };

      const preview = ExecutionPreviewValidator.generatePreview({
        project: proj,
        analysis_id: 'AP_FIBER_GLUCOSE_01'
      });

      expect(preview.readiness_status).toBe('BLOCKED');
      expect(preview.errors.some((e) => e.includes('INVALID_ALPHA'))).toBe(true);
    }
  });

  // --------------------------------------------------------------------------
  // 17. Invalid confidence level
  // --------------------------------------------------------------------------
  it('17. should block preview if confidence level is outside (0, 1)', () => {
    const invalidCIs = [-0.1, 0, 1, 1.2, NaN];

    for (const badCI of invalidCIs) {
      const proj: ResearchProject = {
        ...activeProject,
        analysis_plan: [
          {
            ...activeProject.analysis_plan[0],
            confidence_level: badCI
          }
        ]
      };

      const preview = ExecutionPreviewValidator.generatePreview({
        project: proj,
        analysis_id: 'AP_FIBER_GLUCOSE_01'
      });

      expect(preview.readiness_status).toBe('BLOCKED');
      expect(preview.errors.some((e) => e.includes('INVALID_CONFIDENCE_LEVEL'))).toBe(true);
    }
  });

  // --------------------------------------------------------------------------
  // 18. Immutable preview
  // --------------------------------------------------------------------------
  it('18. should produce a deeply frozen, immutable ExecutionPreview snapshot', () => {
    const preview = service.previewExecution(activeProject.project_id, 'AP_FIBER_GLUCOSE_01');

    expect(Object.isFrozen(preview)).toBe(true);
    expect(Object.isFrozen(preview.errors)).toBe(true);
    expect(Object.isFrozen(preview.warnings)).toBe(true);

    expect(() => {
      (preview as any).readiness_status = 'BLOCKED';
    }).toThrow();

    expect(() => {
      (preview.errors as any).push('tampered error');
    }).toThrow();
  });

  // --------------------------------------------------------------------------
  // 19. Deterministic preview hash
  // --------------------------------------------------------------------------
  it('19. should generate a deterministic SHA-256 preview provenance hash', () => {
    const preview = service.previewExecution(activeProject.project_id, 'AP_FIBER_GLUCOSE_01');

    expect(preview.provenance_hash).toBeDefined();
    expect(preview.provenance_hash).toHaveLength(64);
    expect(preview.provenance_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  // --------------------------------------------------------------------------
  // 20. Same input → same preview
  // --------------------------------------------------------------------------
  it('20. should generate the exact same provenance hash for identical inputs', () => {
    const preview1 = service.previewExecution(activeProject.project_id, 'AP_FIBER_GLUCOSE_01');
    const preview2 = service.previewExecution(activeProject.project_id, 'AP_FIBER_GLUCOSE_01');

    expect(preview1.provenance_hash).toBe(preview2.provenance_hash);
    expect(preview1.preview_id).toBe(preview2.preview_id);
  });

  // --------------------------------------------------------------------------
  // 21. Different input → different hash
  // --------------------------------------------------------------------------
  it('21. should generate a different provenance hash when any input parameter changes', () => {
    const previewOriginal = service.previewExecution(activeProject.project_id, 'AP_FIBER_GLUCOSE_01');

    // Change alpha
    const projAlpha: ResearchProject = {
      ...activeProject,
      analysis_plan: [{ ...activeProject.analysis_plan[0], alpha: 0.01 }]
    };
    const previewAlpha = ExecutionPreviewValidator.generatePreview({
      project: projAlpha,
      analysis_id: 'AP_FIBER_GLUCOSE_01'
    });
    expect(previewAlpha.provenance_hash).not.toBe(previewOriginal.provenance_hash);

    // Change variables
    const projVars: ResearchProject = {
      ...activeProject,
      analysis_plan: [{ ...activeProject.analysis_plan[0], input_variable_ids: ['VAR_FASTING_GLUCOSE'] }]
    };
    const previewVars = ExecutionPreviewValidator.generatePreview({
      project: projVars,
      analysis_id: 'AP_FIBER_GLUCOSE_01'
    });
    expect(previewVars.provenance_hash).not.toBe(previewOriginal.provenance_hash);
  });

  // --------------------------------------------------------------------------
  // 22. scientific_validity remains NOT_ESTABLISHED
  // --------------------------------------------------------------------------
  it('22. should strictly preserve scientific_validity as NOT_ESTABLISHED', () => {
    const preview = service.previewExecution(activeProject.project_id, 'AP_FIBER_GLUCOSE_01');
    expect(preview.scientific_validity).toBe('NOT_ESTABLISHED');

    // Even on blocked preview
    const blockedPreview = ExecutionPreviewValidator.generatePreview({
      project: undefined as any
    });
    expect(blockedPreview.scientific_validity).toBe('NOT_ESTABLISHED');
  });

  // --------------------------------------------------------------------------
  // 23. No statistical execution
  // --------------------------------------------------------------------------
  it('23. should not execute any statistical engine during preview generation', () => {
    const executionHistoryBefore = activeProject.execution_history ? [...activeProject.execution_history] : [];

    const preview = service.previewExecution(activeProject.project_id, 'AP_FIBER_GLUCOSE_01');

    // Project state must remain unmodified
    const projectAfter = registry.getProject(activeProject.project_id);
    expect(projectAfter?.execution_history || []).toEqual(executionHistoryBefore);
    expect(projectAfter?.status).toBe(activeProject.status);
    expect(preview.readiness_status).toBe('READY');
  });

  // --------------------------------------------------------------------------
  // 24. No generated result
  // --------------------------------------------------------------------------
  it('24. should not generate statistical results (p-value, CI, test-statistic, beta) in the preview', () => {
    const preview = service.previewExecution(activeProject.project_id, 'AP_FIBER_GLUCOSE_01');

    expect((preview as any).p_value).toBeUndefined();
    expect((preview as any).test_statistic).toBeUndefined();
    expect((preview as any).confidence_interval).toBeUndefined();
    expect((preview as any).effect_size).toBeUndefined();
    expect((preview as any).r_squared).toBeUndefined();
    expect((preview as any).beta).toBeUndefined();
    expect((preview as any).result).toBeUndefined();
    expect((preview as any).results).toBeUndefined();
  });

  // --------------------------------------------------------------------------
  // 25. No automatic variable inference
  // --------------------------------------------------------------------------
  it('25. should not automatically infer or inject variables', () => {
    const preview = service.previewExecution(activeProject.project_id, 'AP_FIBER_GLUCOSE_01');

    expect(preview.input_variable_ids).toEqual(['VAR_FASTING_GLUCOSE', 'VAR_SOLUBLE_FIBER']);
    expect(preview.grouping_variable_ids).toEqual(['VAR_INTERVENTION_ARM']);
    expect(preview.pairing_variable_ids).toBeUndefined();
  });

  // --------------------------------------------------------------------------
  // 26. No automatic hypothesis generation
  // --------------------------------------------------------------------------
  it('26. should not automatically generate hypotheses when none is planned', () => {
    const unhypothesizedProject = service.planAnalysis({
      project_id: activeProject.project_id,
      analysis_id: 'AP_DESCRIPTIVE_UNHYPOTHESIZED',
      objective_id: 'OBJ_PRIMARY',
      analysis_type: 'DESCRIPTIVE',
      input_variable_ids: ['VAR_FASTING_GLUCOSE'],
      planned_rationale: 'Descriptive characterization without hypothesis'
    });

    const preview = service.previewExecution(
      unhypothesizedProject.project_id,
      'AP_DESCRIPTIVE_UNHYPOTHESIZED'
    );

    expect(preview.hypothesis_id).toBeUndefined();
    expect(preview.readiness_status).toBe('READY');
  });

  // --------------------------------------------------------------------------
  // 27. No automatic statistical test selection
  // --------------------------------------------------------------------------
  it('27. should not mutate or alter the planned configuration or test choice', () => {
    const preview = service.previewExecution(activeProject.project_id, 'AP_FIBER_GLUCOSE_01');

    expect(preview.configuration).toEqual({ test_procedure: 'two_sample_t_test' });
    expect(preview.analysis_type).toBe('INFERENTIAL');
  });

  // --------------------------------------------------------------------------
  // 28. Security scan remains clean
  // --------------------------------------------------------------------------
  it('28. should confirm 0 eval() and 0 new Function() in F2.2B codebase', () => {
    const f22bFiles = [
      path.resolve(process.cwd(), 'scientific/data/executionPreviewContracts.ts'),
      path.resolve(process.cwd(), 'scientific/data/executionPreviewProvenance.ts'),
      path.resolve(process.cwd(), 'scientific/data/executionPreviewValidator.ts'),
      path.resolve(process.cwd(), 'src/components/research/ExecutionPreview.tsx')
    ];

    const evalRegex = /\beval\s*\(/;
    const newFunctionRegex = /new\s+Function\s*\(/;

    for (const filePath of f22bFiles) {
      expect(fs.existsSync(filePath), `File exists: ${filePath}`).toBe(true);
      const content = fs.readFileSync(filePath, 'utf-8');

      // Ensure no executable eval or new Function calls
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Skip comment lines or string pattern definitions
        if (line.trim().startsWith('//') || line.trim().startsWith('*') || line.includes("RegExp")) {
          continue;
        }
        expect(evalRegex.test(line), `eval() found in ${filePath}:${i + 1}`).toBe(false);
        expect(newFunctionRegex.test(line), `new Function() found in ${filePath}:${i + 1}`).toBe(false);
      }
    }
  });
});
