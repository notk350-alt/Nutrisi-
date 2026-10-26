/**
 * NutriBodySim — Phase F2.1 Analysis Plan Workspace Test Suite
 *
 * Verifies all 22 required items:
 * 1. form contract creation
 * 2. required analysis ID
 * 3. objective binding
 * 4. hypothesis binding
 * 5. analysis type validation
 * 6. variable registry validation
 * 7. grouping variable validation
 * 8. pairing variable validation
 * 9. alpha validation
 * 10. confidence level validation
 * 11. rationale validation
 * 12. dataset binding dependency
 * 13. variable registry immutability
 * 14. planned status
 * 15. finalized project rejection
 * 16. archived project rejection
 * 17. no statistical execution
 * 18. no automatic hypothesis generation
 * 19. no automatic objective generation
 * 20. scientific_validity remains NOT_ESTABLISHED
 * 21. zero eval()
 * 22. zero new Function()
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  ResearchProjectRegistry,
  ResearchWorkflow,
  ScientificProjectError,
  ResearchProject,
  AnalysisPlanContract,
  AnalysisPlanType,
  defaultVariableStore
} from '../index';
import {
  ResearchWorkspaceService,
  CreateProjectFormData,
  BindDatasetFormData,
  PlanAnalysisFormData
} from '../../src/services/researchWorkspaceService';

describe('Phase F2.1 — Analysis Plan Workspace & Contract', () => {
  let service: ResearchWorkspaceService;
  let registry: ResearchProjectRegistry;
  let activeProject: ResearchProject;

  const validProjectData: CreateProjectFormData = {
    title: 'Glycemic Biomarker Study',
    description: 'Prospective observational study on dietary soluble fiber and glycemic control.',
    created_by: 'Dr. Jane Doe',
    study_design: {
      design_type: 'COHORT',
      description: 'Prospective observational cohort.'
    },
    research_question: {
      question_id: 'Q_PRIMARY',
      question_text: 'Does dietary soluble fiber lower fasting glucose?',
      priority: 'PRIMARY'
    },
    objective: {
      objective_id: 'OBJ_PRIMARY',
      type: 'PRIMARY_OBJECTIVE',
      description: 'Assess effect of soluble fiber on fasting glucose.'
    },
    hypothesis: {
      hypothesis_id: 'HYP_PRIMARY',
      null_hypothesis: 'Soluble fiber has no effect on fasting glucose.',
      alternative_hypothesis: 'Soluble fiber reduces fasting glucose.',
      direction: 'LESS',
      planned_alpha: 0.05
    }
  };

  beforeEach(() => {
    registry = new ResearchProjectRegistry();
    service = new ResearchWorkspaceService(registry);

    // 1. Create baseline draft project
    const draft = service.createProject(validProjectData);

    // 2. Bind active dataset
    const bindingData: BindDatasetFormData = {
      project_id: draft.project_id,
      dataset_version_id: 'DSV_GLYCEMIC_V1',
      data_artifact_id: 'ART_GLYCEMIC_ANALYSIS_READY_01'
    };
    activeProject = service.bindDataset(bindingData);
  });

  const getValidAnalysisPlanData = (overrides?: Partial<PlanAnalysisFormData>): PlanAnalysisFormData => ({
    project_id: activeProject.project_id,
    analysis_id: 'AP_FIBER_GLUCOSE_01',
    objective_id: 'OBJ_PRIMARY',
    hypothesis_id: 'HYP_PRIMARY',
    analysis_type: 'INFERENTIAL',
    input_variable_ids: ['VAR_FASTING_GLUCOSE', 'VAR_SOLUBLE_FIBER'],
    grouping_variable_ids: ['VAR_INTERVENTION_ARM'],
    alpha: 0.05,
    confidence_level: 0.95,
    planned_rationale: 'Pre-specified two-sample comparison between high-fiber and control cohorts.',
    configuration: { test_type: 'two_sample_t_test' },
    ...overrides
  });

  // 1. Form Contract Creation
  it('1. should successfully create and register a valid Analysis Plan contract', () => {
    const planData = getValidAnalysisPlanData();
    const updatedProject = service.planAnalysis(planData);

    expect(updatedProject).toBeDefined();
    expect(updatedProject.analysis_plan).toHaveLength(1);

    const savedPlan = updatedProject.analysis_plan[0];
    expect(savedPlan.analysis_id).toBe('AP_FIBER_GLUCOSE_01');
    expect(savedPlan.objective_id).toBe('OBJ_PRIMARY');
    expect(savedPlan.hypothesis_id).toBe('HYP_PRIMARY');
    expect(savedPlan.analysis_type).toBe('INFERENTIAL');
    expect(savedPlan.input_variables).toEqual(['VAR_FASTING_GLUCOSE', 'VAR_SOLUBLE_FIBER']);
    expect(savedPlan.input_variable_ids).toEqual(['VAR_FASTING_GLUCOSE', 'VAR_SOLUBLE_FIBER']);
    expect(savedPlan.grouping_variable).toBe('VAR_INTERVENTION_ARM');
    expect(savedPlan.grouping_variable_ids).toEqual(['VAR_INTERVENTION_ARM']);
    expect(savedPlan.alpha).toBe(0.05);
    expect(savedPlan.confidence_level).toBe(0.95);
    expect(savedPlan.status).toBe('PLANNED');
    expect(savedPlan.planned_rationale).toBe(
      'Pre-specified two-sample comparison between high-fiber and control cohorts.'
    );
  });

  // 2. Required Analysis ID
  it('2. should reject empty or blank analysis ID', () => {
    expect(() => {
      service.planAnalysis(getValidAnalysisPlanData({ analysis_id: '' }));
    }).toThrow(ScientificProjectError);

    expect(() => {
      service.planAnalysis(getValidAnalysisPlanData({ analysis_id: '   ' }));
    }).toThrow(/Analysis ID is required/i);
  });

  // 3. Objective Binding
  it('3. should reject missing or non-existent objective binding', () => {
    expect(() => {
      service.planAnalysis(getValidAnalysisPlanData({ objective_id: '' }));
    }).toThrow(/Objective is required/i);

    expect(() => {
      service.planAnalysis(getValidAnalysisPlanData({ objective_id: 'NON_EXISTENT_OBJ_999' }));
    }).toThrow(/references non-existent objective/i);
  });

  // 4. Hypothesis Binding
  it('4. should reject non-existent hypothesis when supplied, while allowing omitted hypothesis', () => {
    // Non-existent hypothesis rejection
    expect(() => {
      service.planAnalysis(getValidAnalysisPlanData({ hypothesis_id: 'HYP_GHOST_123' }));
    }).toThrow(/references non-existent hypothesis/i);

    // Omitted hypothesis is valid (e.g. descriptive or exploratory)
    const descriptiveData = getValidAnalysisPlanData({
      analysis_id: 'AP_DESCRIPTIVE_01',
      analysis_type: 'DESCRIPTIVE',
      hypothesis_id: undefined,
      alpha: undefined,
      planned_rationale: 'Baseline participant characterization.'
    });
    const updated = service.planAnalysis(descriptiveData);
    expect(updated.analysis_plan.find((a) => a.analysis_id === 'AP_DESCRIPTIVE_01')?.hypothesis_id).toBeUndefined();
  });

  // 5. Analysis Type Validation
  it('5. should validate analysis type and reject unsupported or empty types', () => {
    expect(() => {
      service.planAnalysis(getValidAnalysisPlanData({ analysis_type: '' as unknown as AnalysisPlanType }));
    }).toThrow(/Analysis type is required/i);

    expect(() => {
      service.planAnalysis(getValidAnalysisPlanData({ analysis_type: 'INVALID_TYPE' as unknown as AnalysisPlanType }));
    }).toThrow(/Analysis type is required and must be one of/i);

    // All 5 supported types must succeed
    const supportedTypes: AnalysisPlanType[] = [
      'DESCRIPTIVE',
      'INFERENTIAL',
      'REGRESSION',
      'POWER_ANALYSIS',
      'NON_PARAMETRIC'
    ];

    supportedTypes.forEach((type, idx) => {
      const plan = service.planAnalysis(
        getValidAnalysisPlanData({
          analysis_id: `AP_TYPE_TEST_${idx}`,
          analysis_type: type,
          alpha: type === 'DESCRIPTIVE' ? undefined : 0.05
        })
      );
      expect(plan.analysis_plan.some((a) => a.analysis_type === type)).toBe(true);
    });
  });

  // 6. Variable Registry Validation
  it('6. should reject unregistered input variables', () => {
    expect(() => {
      service.planAnalysis(getValidAnalysisPlanData({ input_variable_ids: ['VAR_FASTING_GLUCOSE', 'VAR_NON_EXISTENT'] }));
    }).toThrow(/Variable 'VAR_NON_EXISTENT' is not registered in the Variable Registry/i);

    expect(() => {
      service.planAnalysis(getValidAnalysisPlanData({ input_variable_ids: [] }));
    }).toThrow(/At least one input variable is required/i);
  });

  // 7. Grouping Variable Validation
  it('7. should validate grouping variable against Variable Registry', () => {
    // Non-existent grouping variable
    expect(() => {
      service.planAnalysis(getValidAnalysisPlanData({ grouping_variable_ids: ['VAR_GHOST_GROUP'] }));
    }).toThrow(/Variable 'VAR_GHOST_GROUP' is not registered in the Variable Registry/i);

    // Valid registered grouping variable
    const updated = service.planAnalysis(
      getValidAnalysisPlanData({
        analysis_id: 'AP_GROUP_VALID_01',
        grouping_variable_ids: ['VAR_INTERVENTION_ARM']
      })
    );
    expect(updated.analysis_plan.find((a) => a.analysis_id === 'AP_GROUP_VALID_01')?.grouping_variable).toBe(
      'VAR_INTERVENTION_ARM'
    );
  });

  // 8. Pairing Variable Validation
  it('8. should validate pairing variable against Variable Registry', () => {
    // Non-existent pairing variable
    expect(() => {
      service.planAnalysis(getValidAnalysisPlanData({ pairing_variable_ids: ['VAR_UNREGISTERED_SUBJECT'] }));
    }).toThrow(/Variable 'VAR_UNREGISTERED_SUBJECT' is not registered in the Variable Registry/i);

    // Valid registered pairing variable (e.g. VAR_AGE_YEARS as a matching index)
    const updated = service.planAnalysis(
      getValidAnalysisPlanData({
        analysis_id: 'AP_PAIRING_VALID_01',
        pairing_variable_ids: ['VAR_AGE_YEARS']
      })
    );
    expect(updated.analysis_plan.find((a) => a.analysis_id === 'AP_PAIRING_VALID_01')?.pairing_variable).toBe(
      'VAR_AGE_YEARS'
    );
  });

  // 9. Alpha Validation
  it('9. should strictly validate alpha to be probability between 0 and 1 exclusive', () => {
    // Alpha <= 0
    expect(() => {
      service.planAnalysis(getValidAnalysisPlanData({ alpha: 0 }));
    }).toThrow(/Alpha must be a valid probability strictly between 0 and 1/i);

    // Alpha >= 1
    expect(() => {
      service.planAnalysis(getValidAnalysisPlanData({ alpha: 1.0 }));
    }).toThrow(/Alpha must be a valid probability strictly between 0 and 1/i);

    // Alpha negative
    expect(() => {
      service.planAnalysis(getValidAnalysisPlanData({ alpha: -0.05 }));
    }).toThrow(/Alpha must be a valid probability strictly between 0 and 1/i);

    // Alpha NaN
    expect(() => {
      service.planAnalysis(getValidAnalysisPlanData({ alpha: NaN }));
    }).toThrow(/Alpha must be a valid probability strictly between 0 and 1/i);

    // Missing alpha for inferential test
    expect(() => {
      service.planAnalysis(getValidAnalysisPlanData({ analysis_type: 'INFERENTIAL', alpha: undefined }));
    }).toThrow(/Alpha is required for INFERENTIAL/i);
  });

  // 10. Confidence Level Validation
  it('10. should validate confidence level to be probability strictly between 0 and 1 exclusive', () => {
    // Confidence level <= 0
    expect(() => {
      service.planAnalysis(getValidAnalysisPlanData({ confidence_level: 0 }));
    }).toThrow(/Confidence level must be a valid probability strictly between 0 and 1/i);

    // Confidence level >= 1
    expect(() => {
      service.planAnalysis(getValidAnalysisPlanData({ confidence_level: 1 }));
    }).toThrow(/Confidence level must be a valid probability strictly between 0 and 1/i);

    // Confidence level NaN
    expect(() => {
      service.planAnalysis(getValidAnalysisPlanData({ confidence_level: NaN }));
    }).toThrow(/Confidence level must be a valid probability strictly between 0 and 1/i);

    // Valid confidence level e.g. 0.99
    const updated = service.planAnalysis(getValidAnalysisPlanData({ confidence_level: 0.99 }));
    expect(updated.analysis_plan[0].confidence_level).toBe(0.99);
  });

  // 11. Rationale Validation
  it('11. should reject empty, whitespace, or missing planned rationale', () => {
    expect(() => {
      service.planAnalysis(getValidAnalysisPlanData({ planned_rationale: '' }));
    }).toThrow(/Planned rationale is required and cannot be blank/i);

    expect(() => {
      service.planAnalysis(getValidAnalysisPlanData({ planned_rationale: '   \n  ' }));
    }).toThrow(/Planned rationale is required and cannot be blank/i);
  });

  // 12. Dataset Binding Dependency
  it('12. should strictly reject analysis planning if project has no valid dataset binding', () => {
    // Create unbound project
    const unboundProject = service.createProject({
      ...validProjectData,
      title: 'Unbound Project'
    });

    expect(() => {
      service.planAnalysis({
        ...getValidAnalysisPlanData(),
        project_id: unboundProject.project_id
      });
    }).toThrow(/Analysis planning requires an active dataset binding on the project/i);
  });

  // 13. Variable Registry Immutability
  it('13. should never mutate the Variable Registry during analysis planning', () => {
    const initialVariableCount = defaultVariableStore.list().length;
    const initialVariablesSnapshot = JSON.stringify(defaultVariableStore.list());

    service.planAnalysis(getValidAnalysisPlanData());

    expect(defaultVariableStore.list().length).toBe(initialVariableCount);
    expect(JSON.stringify(defaultVariableStore.list())).toBe(initialVariablesSnapshot);
  });

  // 14. Planned Status
  it('14. should register analysis strictly in PLANNED status (never EXECUTED in F2.1)', () => {
    const updated = service.planAnalysis(getValidAnalysisPlanData());
    const plan = updated.analysis_plan[0];

    expect(plan.status).toBe('PLANNED');
    // Ensure no executed status or result bindings were populated
    expect(updated.result_bindings.d9_results).toEqual([]);
    expect(updated.result_bindings.d10_results).toEqual([]);
    expect(updated.result_bindings.d11_results).toEqual([]);
    expect(updated.result_bindings.d12_results).toEqual([]);
    expect(updated.result_bindings.d13_results).toEqual([]);
  });

  // 15. Finalized Project Rejection
  it('15. should reject planning analyses on finalized projects', () => {
    const finalized = { ...activeProject, project_id: 'PROJ_FINALIZED_TEST', status: 'FINALIZED' as const };
    registry.registerProject(finalized);

    expect(() => {
      service.planAnalysis(getValidAnalysisPlanData({ project_id: 'PROJ_FINALIZED_TEST' }));
    }).toThrow(/Cannot modify project '.*' in finalized or archived status 'FINALIZED'/i);
  });

  // 16. Archived Project Rejection
  it('16. should reject planning analyses on archived projects', () => {
    const archived = { ...activeProject, project_id: 'PROJ_ARCHIVED_TEST', status: 'ARCHIVED' as const };
    registry.registerProject(archived);

    expect(() => {
      service.planAnalysis(getValidAnalysisPlanData({ project_id: 'PROJ_ARCHIVED_TEST' }));
    }).toThrow(/Cannot modify project '.*' in finalized or archived status 'ARCHIVED'/i);
  });

  // 17. No Statistical Execution
  it('17. should not execute any statistical calculation engine during planAnalysis', () => {
    const updated = service.planAnalysis(getValidAnalysisPlanData());

    // Verify execution history remains empty
    expect(updated.execution_history).toHaveLength(0);
    // Verify result references remain empty
    expect(updated.result_bindings.d9_results).toHaveLength(0);
    expect(updated.result_bindings.d10_results).toHaveLength(0);
    expect(updated.result_bindings.d11_results).toHaveLength(0);
    expect(updated.result_bindings.d12_results).toHaveLength(0);
    expect(updated.result_bindings.d13_results).toHaveLength(0);
    // Project status remains unchanged from activeProject status
    expect(updated.status).toBe(activeProject.status);
  });

  // 18. No Automatic Hypothesis Generation
  it('18. should not auto-generate hypotheses if none is provided', () => {
    const planWithoutHyp = service.planAnalysis(
      getValidAnalysisPlanData({
        hypothesis_id: undefined,
        analysis_type: 'DESCRIPTIVE',
        alpha: undefined
      })
    );

    const saved = planWithoutHyp.analysis_plan.find((a) => a.hypothesis_id === undefined);
    expect(saved).toBeDefined();
    // Project hypotheses count must not have grown
    expect(planWithoutHyp.hypotheses).toHaveLength(1);
  });

  // 19. No Automatic Objective Generation
  it('19. should not auto-generate objectives when none or unknown is referenced', () => {
    expect(() => {
      service.planAnalysis(getValidAnalysisPlanData({ objective_id: 'AUTO_GEN_OBJ' }));
    }).toThrow(/references non-existent objective/i);

    expect(activeProject.objectives).toHaveLength(1);
  });

  // 20. Scientific Validity Remains NOT_ESTABLISHED
  it('20. should strictly preserve scientific_validity = NOT_ESTABLISHED', () => {
    const updated = service.planAnalysis(getValidAnalysisPlanData());
    expect(updated.scientific_validity).toBe('NOT_ESTABLISHED');
  });

  // 21. Zero eval() in codebase
  it('21. should ensure 0 instances of eval() across scientific and UI research code', () => {
    const targetFiles = [
      path.resolve(process.cwd(), 'src/services/researchWorkspaceService.ts'),
      path.resolve(process.cwd(), 'src/components/research/AnalysisPlanForm.tsx'),
      path.resolve(process.cwd(), 'src/components/research/ResearchWorkspaceView.tsx'),
      path.resolve(process.cwd(), 'src/components/research/ProjectCreationForm.tsx'),
      path.resolve(process.cwd(), 'src/components/research/DatasetBindingForm.tsx'),
      path.resolve(process.cwd(), 'src/components/research/VariablePlanningForm.tsx'),
      path.resolve(process.cwd(), 'scientific/data/researchProjectContracts.ts'),
      path.resolve(process.cwd(), 'scientific/data/researchWorkflow.ts')
    ];

    for (const filePath of targetFiles) {
      expect(fs.existsSync(filePath), `File exists: ${filePath}`).toBe(true);
      const code = fs.readFileSync(filePath, 'utf8');

      // Check for eval()
      const evalMatches = code.match(/\beval\s*\(/g);
      expect(evalMatches, `eval() found in ${filePath}`).toBeNull();
    }
  });

  // 22. Zero new Function() in codebase
  it('22. should ensure 0 instances of new Function() across scientific and UI research code', () => {
    const targetFiles = [
      path.resolve(process.cwd(), 'src/services/researchWorkspaceService.ts'),
      path.resolve(process.cwd(), 'src/components/research/AnalysisPlanForm.tsx'),
      path.resolve(process.cwd(), 'src/components/research/ResearchWorkspaceView.tsx'),
      path.resolve(process.cwd(), 'src/components/research/ProjectCreationForm.tsx'),
      path.resolve(process.cwd(), 'src/components/research/DatasetBindingForm.tsx'),
      path.resolve(process.cwd(), 'src/components/research/VariablePlanningForm.tsx'),
      path.resolve(process.cwd(), 'scientific/data/researchProjectContracts.ts'),
      path.resolve(process.cwd(), 'scientific/data/researchWorkflow.ts')
    ];

    for (const filePath of targetFiles) {
      expect(fs.existsSync(filePath), `File exists: ${filePath}`).toBe(true);
      const code = fs.readFileSync(filePath, 'utf8');

      // Check for new Function()
      const newFunctionMatches = code.match(/new\s+Function\s*\(/g);
      expect(newFunctionMatches, `new Function() found in ${filePath}`).toBeNull();
    }
  });
});
