import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  ResearchWorkflow,
  ResearchProjectRegistry,
  ResearchExecutionEngine,
  ResearchProjectProvenance,
  validateResearchProject,
  createResearchProject,
  ScientificProjectError,
  ResearchProject,
  StudyDesign,
  ResearchQuestion,
  ResearchObjective,
  ResearchHypothesis,
  DatasetBinding,
  PlannedVariable,
  PlannedAnalysis,
  PlannedPowerAnalysis,
  PlanDeviation
} from '../index';

describe('Phase E — Research Workflow & Reproducible Research Project Engine', () => {
  let registry: ResearchProjectRegistry;

  const datasetVersionId = 'DSV_2026_COHORT_01';
  const dataArtifactId = 'ART_2026_CLEANED_01';
  const sourceChecksum = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

  const baseStudyDesign: StudyDesign = {
    design_type: 'COHORT',
    description: 'Prospective observational study on dietary fiber intake and glycemic variability',
    blinding: 'NONE',
    randomization: false,
    temporal_direction: 'PROSPECTIVE',
    population: 'Adults aged 25-60 with prediabetes'
  };

  const sampleQuestion: ResearchQuestion = {
    question_id: 'Q_01',
    question_text: 'Does daily soluble fiber intake correlate with reductions in fasting glucose?',
    priority: 'PRIMARY',
    objective_ids: ['OBJ_01'],
    status: 'ACTIVE'
  };

  const sampleObjective: ResearchObjective = {
    objective_id: 'OBJ_01',
    type: 'PRIMARY_OBJECTIVE',
    description: 'Evaluate the association between soluble fiber intake and fasting blood glucose',
    target_variables: ['fiber_intake_g', 'fasting_glucose_mg_dl'],
    status: 'ACTIVE'
  };

  const sampleHypothesis: ResearchHypothesis = {
    hypothesis_id: 'HYP_01',
    question_id: 'Q_01',
    objective_id: 'OBJ_01',
    null_hypothesis: 'There is no correlation between dietary fiber and fasting blood glucose (r = 0)',
    alternative_hypothesis: 'There is a negative correlation between dietary fiber and fasting blood glucose (r < 0)',
    direction: 'LESS',
    status: 'PROPOSED',
    planned_alpha: 0.05
  };

  const sampleDatasetBinding: DatasetBinding = {
    dataset_version_id: datasetVersionId,
    data_artifact_id: dataArtifactId,
    source_artifact_checksum: sourceChecksum,
    bound_at: '2026-09-26T12:00:00Z',
    binding_notes: 'Analysis-ready artifact after outliers removal'
  };

  beforeEach(() => {
    registry = new ResearchProjectRegistry();
  });

  describe('1. Contract Validation', () => {
    it('should validate a structurally sound ResearchProject contract', () => {
      const project = ResearchWorkflow.createDraftProject({
        project_id: 'PROJ_001',
        title: 'Glycemic Biomarker Cohort',
        description: 'Comprehensive investigation of dietary biomarkers',
        study_design: baseStudyDesign,
        created_by: 'LEAD_INVESTIGATOR'
      });

      const validation = validateResearchProject(project);
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should reject invalid project missing mandatory fields', () => {
      expect(() => {
        validateResearchProject({} as any);
      }).toThrow(ScientificProjectError);

      expect(() => {
        validateResearchProject({
          project_id: 'PROJ_BAD',
          project_version: '1.0.0',
          title: ''
        } as any);
      }).toThrow(ScientificProjectError);
    });

    it('should enforce scientific_validity = NOT_ESTABLISHED invariant', () => {
      const project = ResearchWorkflow.createDraftProject({
        project_id: 'PROJ_001',
        title: 'Title',
        description: 'Desc',
        study_design: baseStudyDesign,
        created_by: 'INVESTIGATOR'
      });

      expect(project.scientific_validity).toBe('NOT_ESTABLISHED');

      expect(() => {
        validateResearchProject({
          ...project,
          scientific_validity: 'VALIDATED' as any
        });
      }).toThrowError(/scientific_validity must strictly be 'NOT_ESTABLISHED'/);
    });
  });

  describe('2. Project Creation', () => {
    it('should initialize a DRAFT project with empty collections and valid provenance hash', () => {
      const project = ResearchWorkflow.createDraftProject({
        project_id: 'PROJ_INIT',
        title: 'Initial Project Draft',
        description: 'Testing initialization',
        study_design: baseStudyDesign,
        created_by: 'RESEARCHER_A'
      });

      expect(project.project_id).toBe('PROJ_INIT');
      expect(project.status).toBe('DRAFT');
      expect(project.research_questions).toHaveLength(0);
      expect(project.objectives).toHaveLength(0);
      expect(project.hypotheses).toHaveLength(0);
      expect(project.variable_plan).toHaveLength(0);
      expect(project.analysis_plan).toHaveLength(0);
      expect(project.execution_history).toHaveLength(0);
      expect(project.provenance_hash).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('3. Lifecycle Transitions', () => {
    it('should successfully progress through the valid lifecycle: DRAFT -> PLANNED -> DATA_BOUND -> ANALYSIS_READY -> EXECUTING -> ANALYZED -> INTERPRETED -> REPORT_READY -> FINALIZED -> ARCHIVED', () => {
      // 1. DRAFT
      let project = ResearchWorkflow.createDraftProject({
        project_id: 'PROJ_FLOW',
        title: 'Lifecycle Flow Test',
        description: 'Progression test',
        study_design: baseStudyDesign,
        created_by: 'LEAD_INVESTIGATOR'
      });
      project = ResearchWorkflow.addObjective(project, sampleObjective);
      project = ResearchWorkflow.addResearchQuestion(project, sampleQuestion);
      registry.registerProject(project);

      // 2. DRAFT -> PLANNED
      project = registry.updateProjectStatus(project.project_id, 'PLANNED');
      expect(project.status).toBe('PLANNED');

      // 3. PLANNED -> DATA_BOUND
      project = ResearchWorkflow.bindDataset(project, sampleDatasetBinding);
      registry.registerProject(project);
      expect(project.status).toBe('DATA_BOUND');

      // 4. DATA_BOUND -> ANALYSIS_READY
      project = ResearchWorkflow.planVariable(project, { variable_id: 'fiber_intake_g', role: 'EXPOSURE' });
      project = ResearchWorkflow.planAnalysis(project, {
        analysis_id: 'PLAN_01',
        objective_id: 'OBJ_01',
        analysis_type: 'DESCRIPTIVE',
        input_variables: ['fiber_intake_g'],
        planned_rationale: 'Baseline dietary summaries',
        status: 'PLANNED'
      });
      registry.registerProject(project);
      project = registry.updateProjectStatus(project.project_id, 'ANALYSIS_READY');
      expect(project.status).toBe('ANALYSIS_READY');

      // 5. ANALYSIS_READY -> EXECUTING
      project = registry.updateProjectStatus(project.project_id, 'EXECUTING');
      expect(project.status).toBe('EXECUTING');

      // 6. EXECUTING -> ANALYZED
      project = ResearchWorkflow.bindAnalysisResult(project, 'd9', 'D9_RESULT_01');
      registry.registerProject(project);
      project = registry.updateProjectStatus(project.project_id, 'ANALYZED');
      expect(project.status).toBe('ANALYZED');

      // 7. ANALYZED -> INTERPRETED
      project = ResearchWorkflow.bindInterpretationResult(project, 'INTERP_01', 'PROF_01');
      registry.registerProject(project);
      project = registry.updateProjectStatus(project.project_id, 'INTERPRETED');
      expect(project.status).toBe('INTERPRETED');

      // 8. INTERPRETED -> REPORT_READY
      project = ResearchWorkflow.bindReportResult(project, 'REPORT_01');
      registry.registerProject(project);
      project = registry.updateProjectStatus(project.project_id, 'REPORT_READY');
      expect(project.status).toBe('REPORT_READY');

      // 9. REPORT_READY -> FINALIZED
      project = registry.updateProjectStatus(project.project_id, 'FINALIZED');
      expect(project.status).toBe('FINALIZED');

      // 10. FINALIZED -> ARCHIVED
      project = registry.updateProjectStatus(project.project_id, 'ARCHIVED');
      expect(project.status).toBe('ARCHIVED');
    });
  });

  describe('4. Illegal Lifecycle Transitions', () => {
    it('should reject direct DRAFT -> FINALIZED transition', () => {
      const project = ResearchWorkflow.createDraftProject({
        project_id: 'PROJ_ILLEGAL',
        title: 'Illegal Skip',
        description: 'Skip test',
        study_design: baseStudyDesign,
        created_by: 'LEAD'
      });
      registry.registerProject(project);

      expect(() => {
        registry.updateProjectStatus(project.project_id, 'FINALIZED');
      }).toThrowError(/Illegal lifecycle transition/);
    });

    it('should reject any transition out of ARCHIVED status', () => {
      let project = ResearchWorkflow.createDraftProject({
        project_id: 'PROJ_TERM',
        title: 'Terminal Test',
        description: 'Archive test',
        study_design: baseStudyDesign,
        created_by: 'LEAD'
      });
      registry.registerProject(project);

      project = registry.updateProjectStatus(project.project_id, 'ARCHIVED');
      expect(project.status).toBe('ARCHIVED');

      expect(() => {
        registry.updateProjectStatus(project.project_id, 'DRAFT');
      }).toThrow(ScientificProjectError);
    });
  });

  describe('5. Project Versioning', () => {
    it('should create immutable new project version with parent linkage', () => {
      let v1 = ResearchWorkflow.createDraftProject({
        project_id: 'PROJ_VERS',
        project_version: '1.0.0',
        title: 'Version 1.0 Title',
        description: 'First version',
        study_design: baseStudyDesign,
        created_by: 'LEAD'
      });
      registry.registerProject(v1);

      const v2 = registry.createProjectVersion('PROJ_VERS', '1.1.0', {
        title: 'Version 1.1 Updated Title'
      }, 'CO_INVESTIGATOR');

      expect(v2.project_version).toBe('1.1.0');
      expect(v2.parent_version).toBe('1.0.0');
      expect(v2.title).toBe('Version 1.1 Updated Title');

      // Verify v1 in registry is untouched
      const storedV1 = registry.getProject('PROJ_VERS', '1.0.0');
      expect(storedV1?.title).toBe('Version 1.0 Title');
      expect(storedV1?.project_version).toBe('1.0.0');
    });

    it('should prevent mutating a finalized project version', () => {
      let project = ResearchWorkflow.createDraftProject({
        project_id: 'PROJ_FIN_MUT',
        title: 'Finalized Protection',
        description: 'Test',
        study_design: baseStudyDesign,
        created_by: 'LEAD'
      });
      project = ResearchWorkflow.addObjective(project, sampleObjective);
      project = ResearchWorkflow.addResearchQuestion(project, sampleQuestion);
      project = ResearchWorkflow.bindDataset(project, sampleDatasetBinding);
      project = ResearchWorkflow.planVariable(project, { variable_id: 'var1', role: 'OUTCOME' });
      project = ResearchWorkflow.planAnalysis(project, {
        analysis_id: 'A1',
        objective_id: 'OBJ_01',
        analysis_type: 'DESCRIPTIVE',
        input_variables: ['var1'],
        planned_rationale: 'r',
        status: 'PLANNED'
      });
      registry.registerProject(project);

      // Walk through to FINALIZED
      registry.updateProjectStatus(project.project_id, 'PLANNED');
      registry.updateProjectStatus(project.project_id, 'DATA_BOUND');
      registry.updateProjectStatus(project.project_id, 'ANALYSIS_READY');
      registry.updateProjectStatus(project.project_id, 'EXECUTING');
      registry.updateProjectStatus(project.project_id, 'ANALYZED');
      registry.updateProjectStatus(project.project_id, 'INTERPRETED');
      registry.updateProjectStatus(project.project_id, 'REPORT_READY');
      const finalized = registry.updateProjectStatus(project.project_id, 'FINALIZED');

      expect(() => {
        ResearchWorkflow.addResearchQuestion(finalized, {
          question_id: 'Q_LATE',
          question_text: 'Late question',
          priority: 'SECONDARY',
          objective_ids: [],
          status: 'ACTIVE'
        });
      }).toThrowError(/Cannot modify project/);
    });
  });

  describe('6. Research Question Binding', () => {
    it('should bind research questions explicitly and reject duplicate question IDs', () => {
      let project = ResearchWorkflow.createDraftProject({
        project_id: 'PROJ_Q',
        title: 'Question Project',
        description: 'Test',
        study_design: baseStudyDesign,
        created_by: 'LEAD'
      });

      project = ResearchWorkflow.addResearchQuestion(project, sampleQuestion);
      expect(project.research_questions).toHaveLength(1);
      expect(project.research_questions[0].question_id).toBe('Q_01');

      expect(() => {
        ResearchWorkflow.addResearchQuestion(project, sampleQuestion);
      }).toThrowError(/already exists/);
    });
  });

  describe('7. Objective Binding', () => {
    it('should bind research objectives and reject duplicate objective IDs', () => {
      let project = ResearchWorkflow.createDraftProject({
        project_id: 'PROJ_OBJ',
        title: 'Objective Project',
        description: 'Test',
        study_design: baseStudyDesign,
        created_by: 'LEAD'
      });

      project = ResearchWorkflow.addObjective(project, sampleObjective);
      expect(project.objectives).toHaveLength(1);
      expect(project.objectives[0].type).toBe('PRIMARY_OBJECTIVE');

      expect(() => {
        ResearchWorkflow.addObjective(project, sampleObjective);
      }).toThrowError(/already exists/);
    });
  });

  describe('8. Hypothesis Binding', () => {
    it('should bind hypotheses linked to existing question and objective', () => {
      let project = ResearchWorkflow.createDraftProject({
        project_id: 'PROJ_HYP',
        title: 'Hypothesis Project',
        description: 'Test',
        study_design: baseStudyDesign,
        created_by: 'LEAD'
      });
      project = ResearchWorkflow.addObjective(project, sampleObjective);
      project = ResearchWorkflow.addResearchQuestion(project, sampleQuestion);

      project = ResearchWorkflow.addHypothesis(project, sampleHypothesis);
      expect(project.hypotheses).toHaveLength(1);
      expect(project.hypotheses[0].direction).toBe('LESS');
    });

    it('should reject hypotheses referencing non-existent objective or question', () => {
      let project = ResearchWorkflow.createDraftProject({
        project_id: 'PROJ_HYP_ERR',
        title: 'Hypothesis Err',
        description: 'Test',
        study_design: baseStudyDesign,
        created_by: 'LEAD'
      });

      expect(() => {
        ResearchWorkflow.addHypothesis(project, sampleHypothesis);
      }).toThrowError(/references non-existent objective/);
    });
  });

  describe('9. Dataset Version Binding', () => {
    it('should bind dataset version and data artifact to the project', () => {
      let project = ResearchWorkflow.createDraftProject({
        project_id: 'PROJ_BIND_DS',
        title: 'Dataset Binding Project',
        description: 'Test',
        study_design: baseStudyDesign,
        created_by: 'LEAD'
      });

      project = ResearchWorkflow.bindDataset(project, sampleDatasetBinding);
      expect(project.dataset_binding).toBeDefined();
      expect(project.dataset_binding?.dataset_version_id).toBe(datasetVersionId);
      expect(project.dataset_binding?.data_artifact_id).toBe(dataArtifactId);
    });
  });

  describe('10. Artifact Checksum Binding', () => {
    it('should reject binding when artifact checksum does not match expected', () => {
      let project = ResearchWorkflow.createDraftProject({
        project_id: 'PROJ_CHKSUM',
        title: 'Checksum Project',
        description: 'Test',
        study_design: baseStudyDesign,
        created_by: 'LEAD'
      });

      expect(() => {
        ResearchWorkflow.bindDataset(project, sampleDatasetBinding, {
          expected_checksum: 'DIFFERENT_CHECKSUM_HASH_0000000000000000000000000000000000'
        });
      }).toThrow(ScientificProjectError);
    });
  });

  describe('11. Variable Planning', () => {
    it('should support research variable roles: OUTCOME, EXPOSURE, PREDICTOR, COVARIATE, GROUPING', () => {
      let project = ResearchWorkflow.createDraftProject({
        project_id: 'PROJ_VARS',
        title: 'Variable Plan Project',
        description: 'Test',
        study_design: baseStudyDesign,
        created_by: 'LEAD'
      });

      const outcomeVar: PlannedVariable = { variable_id: 'fasting_glucose', role: 'OUTCOME', expected_unit: 'mg/dL' };
      const exposureVar: PlannedVariable = { variable_id: 'fiber_intake', role: 'EXPOSURE', expected_unit: 'g/day' };
      const covariateVar: PlannedVariable = { variable_id: 'age_years', role: 'COVARIATE' };

      project = ResearchWorkflow.planVariable(project, outcomeVar);
      project = ResearchWorkflow.planVariable(project, exposureVar);
      project = ResearchWorkflow.planVariable(project, covariateVar);

      expect(project.variable_plan).toHaveLength(3);
      expect(project.variable_plan.find((v) => v.variable_id === 'fasting_glucose')?.role).toBe('OUTCOME');
      expect(project.variable_plan.find((v) => v.variable_id === 'fiber_intake')?.role).toBe('EXPOSURE');
      expect(project.variable_plan.find((v) => v.variable_id === 'age_years')?.role).toBe('COVARIATE');
    });
  });

  describe('12. Analysis Planning', () => {
    it('should bind planned analysis tied to objective and input variables', () => {
      let project = ResearchWorkflow.createDraftProject({
        project_id: 'PROJ_PLAN_A',
        title: 'Planned Analysis Project',
        description: 'Test',
        study_design: baseStudyDesign,
        created_by: 'LEAD'
      });
      project = ResearchWorkflow.addObjective(project, sampleObjective);

      const planned: PlannedAnalysis = {
        analysis_id: 'PLAN_OLS_01',
        objective_id: 'OBJ_01',
        analysis_type: 'REGRESSION',
        input_variables: ['fiber_intake_g', 'fasting_glucose_mg_dl', 'age_years'],
        alpha: 0.05,
        planned_rationale: 'Multiple linear regression controlling for age',
        status: 'PLANNED'
      };

      project = ResearchWorkflow.planAnalysis(project, planned);
      expect(project.analysis_plan).toHaveLength(1);
      expect(project.analysis_plan[0].analysis_type).toBe('REGRESSION');
      expect(project.analysis_plan[0].status).toBe('PLANNED');
    });
  });

  describe('13. Planned vs Executed Comparison', () => {
    const plannedAnalysis: PlannedAnalysis = {
      analysis_id: 'PA_01',
      objective_id: 'OBJ_01',
      analysis_type: 'INFERENTIAL',
      input_variables: ['var_a', 'var_b'],
      alpha: 0.05,
      configuration: { equal_variance: true },
      planned_rationale: 'Student t-test',
      status: 'PLANNED'
    };

    it('should detect METHOD_CHANGE deviation when execution uses a different procedure', () => {
      const executed = {
        analysis_id: 'PA_01',
        analysis_type: 'NONPARAMETRIC', // Changed from INFERENTIAL
        input_variables: ['var_a', 'var_b'],
        alpha: 0.05
      };

      const deviation = ResearchExecutionEngine.comparePlannedVsExecuted(plannedAnalysis, executed, 'ANALYST_A');
      expect(deviation).toBeDefined();
      expect(deviation?.deviation_type).toBe('METHOD_CHANGE');
      expect(deviation?.reason).toContain("Analysis type changed from planned 'INFERENTIAL' to executed 'NONPARAMETRIC'");
    });

    it('should detect VARIABLE_SUBSTITUTION deviation when execution changes variables', () => {
      const executed = {
        analysis_id: 'PA_01',
        analysis_type: 'INFERENTIAL',
        input_variables: ['var_a', 'var_c'], // var_c substituted
        alpha: 0.05
      };

      const deviation = ResearchExecutionEngine.comparePlannedVsExecuted(plannedAnalysis, executed, 'ANALYST_A');
      expect(deviation).toBeDefined();
      expect(deviation?.deviation_type).toBe('VARIABLE_SUBSTITUTION');
    });

    it('should detect ALPHA_ADJUSTMENT deviation when significance threshold changes', () => {
      const executed = {
        analysis_id: 'PA_01',
        analysis_type: 'INFERENTIAL',
        input_variables: ['var_a', 'var_b'],
        alpha: 0.01 // Changed from 0.05
      };

      const deviation = ResearchExecutionEngine.comparePlannedVsExecuted(plannedAnalysis, executed, 'ANALYST_A');
      expect(deviation).toBeDefined();
      expect(deviation?.deviation_type).toBe('ALPHA_ADJUSTMENT');
    });

    it('should detect PARAMETER_MISMATCH when configuration differs', () => {
      const executed = {
        analysis_id: 'PA_01',
        analysis_type: 'INFERENTIAL',
        input_variables: ['var_a', 'var_b'],
        alpha: 0.05,
        configuration: { equal_variance: false } // Changed from true
      };

      const deviation = ResearchExecutionEngine.comparePlannedVsExecuted(plannedAnalysis, executed, 'ANALYST_A');
      expect(deviation).toBeDefined();
      expect(deviation?.deviation_type).toBe('PARAMETER_MISMATCH');
    });

    it('should return null when execution exactly conforms to the planned analysis', () => {
      const executed = {
        analysis_id: 'PA_01',
        analysis_type: 'INFERENTIAL',
        input_variables: ['var_a', 'var_b'],
        alpha: 0.05,
        configuration: { equal_variance: true }
      };

      const deviation = ResearchExecutionEngine.comparePlannedVsExecuted(plannedAnalysis, executed, 'ANALYST_A');
      expect(deviation).toBeNull();
    });
  });

  describe('14. Plan Deviation Recording', () => {
    it('should record plan deviations and automatically mark planned analysis as DEVIATED', () => {
      let project = ResearchWorkflow.createDraftProject({
        project_id: 'PROJ_DEV',
        title: 'Deviation Tracking',
        description: 'Test',
        study_design: baseStudyDesign,
        created_by: 'LEAD'
      });
      project = ResearchWorkflow.addObjective(project, sampleObjective);
      project = ResearchWorkflow.bindDataset(project, sampleDatasetBinding);

      const planned: PlannedAnalysis = {
        analysis_id: 'PA_TTEST',
        objective_id: 'OBJ_01',
        analysis_type: 'INFERENTIAL',
        input_variables: ['glucose'],
        alpha: 0.05,
        planned_rationale: 'Initial t-test',
        status: 'PLANNED'
      };
      project = ResearchWorkflow.planAnalysis(project, planned);

      // Record execution that deviates
      project = ResearchExecutionEngine.recordExecution(project, {
        execution_id: 'EXEC_001',
        started_at: '2026-09-26T12:00:00Z',
        completed_at: '2026-09-26T12:01:00Z',
        status: 'SUCCESS',
        executed_analyses: [
          {
            analysis_id: 'PA_TTEST',
            analysis_type: 'NONPARAMETRIC', // Deviated
            input_variables: ['glucose'],
            alpha: 0.05
          }
        ],
        result_references: ['NP_RES_01'],
        user: 'RESEARCH_ANALYST'
      });

      expect(project.plan_deviations).toHaveLength(1);
      expect(project.plan_deviations[0].deviation_type).toBe('METHOD_CHANGE');
      expect(project.analysis_plan.find((a) => a.analysis_id === 'PA_TTEST')?.status).toBe('DEVIATED');
      expect(project.execution_history).toHaveLength(1);
    });
  });

  describe('15. Power Plan Binding', () => {
    it('should bind pre-specified power analysis parameters to the project', () => {
      let project = ResearchWorkflow.createDraftProject({
        project_id: 'PROJ_PWR',
        title: 'Power Plan Project',
        description: 'Test',
        study_design: baseStudyDesign,
        created_by: 'LEAD'
      });

      const powerPlan: PlannedPowerAnalysis = {
        analysis_id: 'PWR_PLAN_01',
        target_power: 0.80,
        alpha: 0.05,
        effect_size: 0.50,
        required_sample_size: 128,
        expected_attrition: 0.10
      };

      project = ResearchWorkflow.planPower(project, powerPlan);
      expect(project.power_plan).toHaveLength(1);
      expect(project.power_plan[0].target_power).toBe(0.80);
      expect(project.power_plan[0].required_sample_size).toBe(128);
    });
  });

  describe('16–20. Result Bindings (D9–D13)', () => {
    it('should bind D9, D10, D11, D12, and D13 result references', () => {
      let project = ResearchWorkflow.createDraftProject({
        project_id: 'PROJ_RESULTS',
        title: 'Results Binding Project',
        description: 'Test',
        study_design: baseStudyDesign,
        created_by: 'LEAD'
      });
      project = ResearchWorkflow.bindDataset(project, sampleDatasetBinding);

      project = ResearchWorkflow.bindAnalysisResult(project, 'd9', 'D9_001', {
        dataset_version_id: datasetVersionId,
        data_artifact_id: dataArtifactId
      });
      project = ResearchWorkflow.bindAnalysisResult(project, 'd10', 'D10_001', {
        dataset_version_id: datasetVersionId,
        data_artifact_id: dataArtifactId
      });
      project = ResearchWorkflow.bindAnalysisResult(project, 'd11', 'D11_001', {
        dataset_version_id: datasetVersionId,
        data_artifact_id: dataArtifactId
      });
      project = ResearchWorkflow.bindAnalysisResult(project, 'd12', 'D12_001', {
        dataset_version_id: datasetVersionId,
        data_artifact_id: dataArtifactId
      });
      project = ResearchWorkflow.bindAnalysisResult(project, 'd13', 'D13_001', {
        dataset_version_id: datasetVersionId,
        data_artifact_id: dataArtifactId
      });

      expect(project.result_bindings.d9_results).toContain('D9_001');
      expect(project.result_bindings.d10_results).toContain('D10_001');
      expect(project.result_bindings.d11_results).toContain('D11_001');
      expect(project.result_bindings.d12_results).toContain('D12_001');
      expect(project.result_bindings.d13_results).toContain('D13_001');
    });
  });

  describe('21–24. Visualization, Interpretation, Evidence, and Report Bindings', () => {
    it('should bind D14 visualizations, D15 interpretations, evidence traces, and reports', () => {
      let project = ResearchWorkflow.createDraftProject({
        project_id: 'PROJ_BIND_ADV',
        title: 'Advanced Bindings',
        description: 'Test',
        study_design: baseStudyDesign,
        created_by: 'LEAD'
      });
      project = ResearchWorkflow.bindDataset(project, sampleDatasetBinding);

      project = ResearchWorkflow.bindVisualizationResult(project, 'VIS_001', {
        dataset_version_id: datasetVersionId
      });
      project = ResearchWorkflow.bindInterpretationResult(project, 'INTERP_001', 'PROF_001', 'RULE_001', {
        dataset_version_id: datasetVersionId
      });
      project = ResearchWorkflow.bindEvidenceTrace(project, 'TRACE_001', {
        dataset_version_id: datasetVersionId
      });
      project = ResearchWorkflow.bindReportResult(project, 'REPORT_001', {
        dataset_version_id: datasetVersionId
      });

      expect(project.visualization_bindings.visualization_ids).toContain('VIS_001');
      expect(project.interpretation_bindings.interpretation_ids).toContain('INTERP_001');
      expect(project.interpretation_bindings.profile_ids).toContain('PROF_001');
      expect(project.interpretation_bindings.rule_ids).toContain('RULE_001');
      expect(project.evidence_bindings.evidence_trace_ids).toContain('TRACE_001');
      expect(project.report_bindings.report_ids).toContain('REPORT_001');
    });
  });

  describe('25. Cross-Version Rejection Gate', () => {
    it('should strictly reject binding a result from a different dataset version', () => {
      let project = ResearchWorkflow.createDraftProject({
        project_id: 'PROJ_CROSS_VER',
        title: 'Cross Version Gate',
        description: 'Test',
        study_design: baseStudyDesign,
        created_by: 'LEAD'
      });
      project = ResearchWorkflow.bindDataset(project, sampleDatasetBinding);

      expect(() => {
        ResearchWorkflow.bindAnalysisResult(project, 'd10', 'D10_CROSS', {
          dataset_version_id: 'DIFFERENT_DATASET_VERSION_99',
          data_artifact_id: dataArtifactId
        });
      }).toThrowError(/dataset version 'DIFFERENT_DATASET_VERSION_99' does not match project binding/);
    });

    it('should strictly reject binding a result from a different data artifact', () => {
      let project = ResearchWorkflow.createDraftProject({
        project_id: 'PROJ_CROSS_ART',
        title: 'Cross Artifact Gate',
        description: 'Test',
        study_design: baseStudyDesign,
        created_by: 'LEAD'
      });
      project = ResearchWorkflow.bindDataset(project, sampleDatasetBinding);

      expect(() => {
        ResearchWorkflow.bindAnalysisResult(project, 'd10', 'D10_CROSS_ART', {
          dataset_version_id: datasetVersionId,
          data_artifact_id: 'DIFFERENT_DATA_ARTIFACT_99'
        });
      }).toThrowError(/data artifact 'DIFFERENT_DATA_ARTIFACT_99' does not match project binding/);
    });
  });

  describe('26. Provenance Determinism', () => {
    it('should produce identical SHA-256 provenance hashes for identical project structures', () => {
      const p1 = ResearchWorkflow.createDraftProject({
        project_id: 'PROJ_DET',
        title: 'Deterministic Test',
        description: 'Checking determinism',
        study_design: baseStudyDesign,
        created_by: 'USER_1'
      });

      const p2 = ResearchWorkflow.createDraftProject({
        project_id: 'PROJ_DET',
        title: 'Deterministic Test',
        description: 'Checking determinism',
        study_design: baseStudyDesign,
        created_by: 'USER_1'
      });

      expect(p1.provenance_hash).toBe(p2.provenance_hash);
    });
  });

  describe('27. Provenance Sensitivity', () => {
    it('should produce a different hash whenever questions, objectives, or plans change', () => {
      let base = ResearchWorkflow.createDraftProject({
        project_id: 'PROJ_SENS',
        title: 'Sensitivity Test',
        description: 'Checking sensitivity',
        study_design: baseStudyDesign,
        created_by: 'USER_1'
      });
      const initialHash = base.provenance_hash;

      // Add objective
      base = ResearchWorkflow.addObjective(base, sampleObjective);
      const hashWithObj = base.provenance_hash;
      expect(hashWithObj).not.toBe(initialHash);

      // Add question
      base = ResearchWorkflow.addResearchQuestion(base, sampleQuestion);
      const hashWithQ = base.provenance_hash;
      expect(hashWithQ).not.toBe(hashWithObj);

      // Add hypothesis
      base = ResearchWorkflow.addHypothesis(base, sampleHypothesis);
      const hashWithHyp = base.provenance_hash;
      expect(hashWithHyp).not.toBe(hashWithQ);
    });
  });

  describe('28. Immutability', () => {
    it('should ensure ResearchProject instances are deep-frozen and cannot be mutated in place', () => {
      const project = ResearchWorkflow.createDraftProject({
        project_id: 'PROJ_IMMUTABLE',
        title: 'Immutability Test',
        description: 'Checking deepFreeze',
        study_design: baseStudyDesign,
        created_by: 'USER_1'
      });

      expect(Object.isFrozen(project)).toBe(true);
      expect(Object.isFrozen(project.research_questions)).toBe(true);
      expect(Object.isFrozen(project.study_design)).toBe(true);

      expect(() => {
        (project as any).title = 'Tampered Title';
      }).toThrow();
    });
  });

  describe('29. Defensive Cloning', () => {
    it('should return defensive clones from registry ensuring store encapsulation', () => {
      const project = ResearchWorkflow.createDraftProject({
        project_id: 'PROJ_DEFENSE',
        title: 'Encapsulation Test',
        description: 'Checking defensive copies',
        study_design: baseStudyDesign,
        created_by: 'USER_1'
      });
      registry.registerProject(project);

      const retrieved1 = registry.getProject('PROJ_DEFENSE')!;
      const retrieved2 = registry.getProject('PROJ_DEFENSE')!;

      expect(retrieved1).toEqual(retrieved2);
      expect(retrieved1).not.toBe(retrieved2); // Different object references
      expect(Object.isFrozen(retrieved1)).toBe(true);
    });
  });

  describe('30. Security: Zero eval() or new Function()', () => {
    it('should verify that all Phase E implementation files contain zero eval() or new Function() calls', () => {
      const filesToCheck = [
        path.join(__dirname, '../data/researchProjectContracts.ts'),
        path.join(__dirname, '../data/researchProjectProvenance.ts'),
        path.join(__dirname, '../data/researchProjectRegistry.ts'),
        path.join(__dirname, '../data/researchWorkflow.ts'),
        path.join(__dirname, '../data/researchExecution.ts')
      ];

      for (const file of filesToCheck) {
        const content = fs.readFileSync(file, 'utf-8');
        expect(content).not.toMatch(/\beval\s*\(/);
        expect(content).not.toMatch(/\bnew\s+Function\s*\(/);
      }
    });
  });

  describe('31. Scientific Validity Boundary', () => {
    it('should maintain scientific_validity = NOT_ESTABLISHED across all project lifecycle states and outputs', () => {
      let project = ResearchWorkflow.createDraftProject({
        project_id: 'PROJ_VALIDITY',
        title: 'Scientific Boundary Test',
        description: 'Verifying validity boundary',
        study_design: baseStudyDesign,
        created_by: 'USER_1'
      });
      expect(project.scientific_validity).toBe('NOT_ESTABLISHED');

      project = ResearchWorkflow.addObjective(project, sampleObjective);
      project = ResearchWorkflow.addResearchQuestion(project, sampleQuestion);
      project = ResearchWorkflow.bindDataset(project, sampleDatasetBinding);
      registry.registerProject(project);

      expect(project.scientific_validity).toBe('NOT_ESTABLISHED');

      // Even when updating to FINALIZED or ARCHIVED
      project = registry.updateProjectStatus(project.project_id, 'PLANNED');
      project = registry.updateProjectStatus(project.project_id, 'DATA_BOUND');
      project = ResearchWorkflow.planVariable(project, { variable_id: 'v1', role: 'PREDICTOR' });
      project = ResearchWorkflow.planAnalysis(project, {
        analysis_id: 'A1',
        objective_id: 'OBJ_01',
        analysis_type: 'DESCRIPTIVE',
        input_variables: ['v1'],
        planned_rationale: 'r',
        status: 'PLANNED'
      });
      project = registry.registerProject(project);
      project = registry.updateProjectStatus(project.project_id, 'ANALYSIS_READY');
      project = registry.updateProjectStatus(project.project_id, 'EXECUTING');
      project = registry.updateProjectStatus(project.project_id, 'ANALYZED');
      project = registry.updateProjectStatus(project.project_id, 'INTERPRETED');
      project = registry.updateProjectStatus(project.project_id, 'REPORT_READY');
      const finalized = registry.updateProjectStatus(project.project_id, 'FINALIZED');

      expect(finalized.scientific_validity).toBe('NOT_ESTABLISHED');
    });
  });

  describe('32. Regression Against All C1–D15 Baseline', () => {
    it('should verify that ResearchProject integrates existing C1–D15 contracts without modifying their behavior', () => {
      // Create project referencing D9 through D15 identifiers
      let project = ResearchWorkflow.createDraftProject({
        project_id: 'PROJ_INTEGRATION',
        title: 'Full Pipeline Integration Project',
        description: 'End-to-end integration audit',
        study_design: baseStudyDesign,
        created_by: 'CHIEF_SCIENTIST'
      });
      project = ResearchWorkflow.addObjective(project, sampleObjective);
      project = ResearchWorkflow.addResearchQuestion(project, sampleQuestion);
      project = ResearchWorkflow.addHypothesis(project, sampleHypothesis);
      project = ResearchWorkflow.bindDataset(project, sampleDatasetBinding);

      project = ResearchWorkflow.bindAnalysisResult(project, 'd9', 'D9_STAT_001');
      project = ResearchWorkflow.bindAnalysisResult(project, 'd10', 'D10_INF_001');
      project = ResearchWorkflow.bindAnalysisResult(project, 'd11', 'D11_REG_001');
      project = ResearchWorkflow.bindAnalysisResult(project, 'd12', 'D12_PWR_001');
      project = ResearchWorkflow.bindAnalysisResult(project, 'd13', 'D13_NP_001');
      project = ResearchWorkflow.bindVisualizationResult(project, 'D14_VIS_001');
      project = ResearchWorkflow.bindInterpretationResult(project, 'D15_INTERP_001', 'PROF_WHO_ADULT', 'RULE_BMI_OVERWEIGHT');
      project = ResearchWorkflow.bindEvidenceTrace(project, 'D15_TRACE_001');
      project = ResearchWorkflow.bindReportResult(project, 'D14_REPORT_001');

      expect(project.result_bindings.d9_results).toContain('D9_STAT_001');
      expect(project.result_bindings.d10_results).toContain('D10_INF_001');
      expect(project.result_bindings.d11_results).toContain('D11_REG_001');
      expect(project.result_bindings.d12_results).toContain('D12_PWR_001');
      expect(project.result_bindings.d13_results).toContain('D13_NP_001');
      expect(project.visualization_bindings.visualization_ids).toContain('D14_VIS_001');
      expect(project.interpretation_bindings.interpretation_ids).toContain('D15_INTERP_001');
      expect(project.evidence_bindings.evidence_trace_ids).toContain('D15_TRACE_001');
      expect(project.report_bindings.report_ids).toContain('D14_REPORT_001');
      expect(project.scientific_validity).toBe('NOT_ESTABLISHED');
    });
  });
});
