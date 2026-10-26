/**
 * Phase E — Scientific Data Layer: Research Workflow Engine
 *
 * Implements end-to-end orchestration for reproducible research projects:
 * 1. Project Initialization & Goal Formulation (Questions, Objectives, Hypotheses)
 * 2. Immutable Dataset & Variable Planning
 * 3. Analysis Planning & Power Planning
 * 4. Result, Visualization, Interpretation, Evidence, and Report Binding
 * 5. Cross-Version Integrity Gates & Plan Deviation Auditing
 *
 * Invariants:
 * - Zero dynamic code execution (no eval, no new Function)
 * - Source artifacts and historical project versions remain strictly immutable
 * - Provenance re-computed deterministically upon any structural addition
 * - Cross-version and cross-artifact mismatches are strictly rejected
 */

import {
  createResearchProject,
  DatasetBinding,
  DeviationType,
  PlanDeviation,
  PlannedAnalysis,
  PlannedPowerAnalysis,
  PlannedVariable,
  ProjectStatus,
  ResearchHypothesis,
  ResearchObjective,
  ResearchProject,
  ResearchQuestion,
  ScientificProjectError,
  StudyDesign,
  validateResearchProject
} from './researchProjectContracts';
import { deepFreeze } from './dataStatePipeline';
import { ResearchProjectProvenance } from './researchProjectProvenance';

export interface CreateProjectDraftOptions {
  project_id: string;
  project_version?: string;
  title: string;
  description: string;
  study_design: StudyDesign;
  created_by: string;
  metadata?: Record<string, unknown>;
}

export class ResearchWorkflow {
  public static readonly ENGINE_VERSION = '1.0.0';

  /**
   * Initializes a fresh ResearchProject draft.
   */
  public static createDraftProject(options: CreateProjectDraftOptions): ResearchProject {
    const now = new Date().toISOString();
    const version = options.project_version ?? '1.0.0';

    const draft: Omit<ResearchProject, 'provenance_hash'> = {
      project_id: options.project_id,
      project_version: version,
      parent_version: null,
      title: options.title,
      description: options.description,
      created_by: options.created_by,
      created_at: now,
      updated_at: now,
      status: 'DRAFT',
      study_design: options.study_design,
      research_questions: [],
      objectives: [],
      hypotheses: [],
      variable_plan: [],
      analysis_plan: [],
      power_plan: [],
      plan_deviations: [],
      execution_history: [],
      result_bindings: {
        d9_results: [],
        d10_results: [],
        d11_results: [],
        d12_results: [],
        d13_results: []
      },
      visualization_bindings: {
        visualization_ids: []
      },
      interpretation_bindings: {
        interpretation_ids: [],
        profile_ids: [],
        rule_ids: []
      },
      evidence_bindings: {
        evidence_trace_ids: []
      },
      report_bindings: {
        report_ids: []
      },
      metadata: options.metadata ?? {},
      scientific_validity: 'NOT_ESTABLISHED',
      engine_version: ResearchWorkflow.ENGINE_VERSION
    };

    const provenanceHash = ResearchProjectProvenance.computeHash(draft);

    return createResearchProject({
      ...draft,
      provenance_hash: provenanceHash
    });
  }

  /**
   * Adds a user-specified research question.
   */
  public static addResearchQuestion(
    project: ResearchProject,
    question: ResearchQuestion
  ): ResearchProject {
    ResearchWorkflow.assertModifiable(project);

    if (project.research_questions.some((q) => q.question_id === question.question_id)) {
      throw new ScientificProjectError(
        'PROJECT_INVALID_CONTRACT',
        `Question with ID '${question.question_id}' already exists in project '${project.project_id}'`
      );
    }

    const updatedQuestions = [...project.research_questions, question];
    return ResearchWorkflow.rebuild(project, { research_questions: updatedQuestions });
  }

  /**
   * Adds an explicit research objective.
   */
  public static addObjective(
    project: ResearchProject,
    objective: ResearchObjective
  ): ResearchProject {
    ResearchWorkflow.assertModifiable(project);

    if (project.objectives.some((o) => o.objective_id === objective.objective_id)) {
      throw new ScientificProjectError(
        'PROJECT_INVALID_CONTRACT',
        `Objective with ID '${objective.objective_id}' already exists in project '${project.project_id}'`
      );
    }

    const updatedObjectives = [...project.objectives, objective];
    return ResearchWorkflow.rebuild(project, { objectives: updatedObjectives });
  }

  /**
   * Adds an explicit scientific hypothesis.
   */
  public static addHypothesis(
    project: ResearchProject,
    hypothesis: ResearchHypothesis
  ): ResearchProject {
    ResearchWorkflow.assertModifiable(project);

    if (project.hypotheses.some((h) => h.hypothesis_id === hypothesis.hypothesis_id)) {
      throw new ScientificProjectError(
        'PROJECT_INVALID_CONTRACT',
        `Hypothesis with ID '${hypothesis.hypothesis_id}' already exists in project '${project.project_id}'`
      );
    }

    // Verify referenced objective exists
    if (!project.objectives.some((o) => o.objective_id === hypothesis.objective_id)) {
      throw new ScientificProjectError(
        'PROJECT_INVALID_CONTRACT',
        `Hypothesis references non-existent objective '${hypothesis.objective_id}'`
      );
    }

    // Verify referenced question exists
    if (!project.research_questions.some((q) => q.question_id === hypothesis.question_id)) {
      throw new ScientificProjectError(
        'PROJECT_INVALID_CONTRACT',
        `Hypothesis references non-existent research question '${hypothesis.question_id}'`
      );
    }

    const updatedHypotheses = [...project.hypotheses, hypothesis];
    return ResearchWorkflow.rebuild(project, { hypotheses: updatedHypotheses });
  }

  /**
   * Binds dataset version and artifact to the project with strict integrity verification.
   */
  public static bindDataset(
    project: ResearchProject,
    binding: DatasetBinding,
    options?: {
      expected_checksum?: string;
      verifyArtifact?: {
        dataset_version_id: string;
        data_artifact_id: string;
        checksum: string;
      };
    }
  ): ResearchProject {
    ResearchWorkflow.assertModifiable(project);

    if (!binding.dataset_version_id) {
      throw new ScientificProjectError('PROJECT_DATASET_NOT_FOUND', 'dataset_version_id is required');
    }
    if (!binding.data_artifact_id) {
      throw new ScientificProjectError('PROJECT_ARTIFACT_NOT_FOUND', 'data_artifact_id is required');
    }

    // Cross-version / artifact integrity validation
    if (options?.verifyArtifact) {
      if (options.verifyArtifact.dataset_version_id !== binding.dataset_version_id) {
        throw new ScientificProjectError(
          'PROJECT_VERSION_MISMATCH',
          `DataArtifact belongs to dataset version '${options.verifyArtifact.dataset_version_id}', expected '${binding.dataset_version_id}'`
        );
      }
      if (options.verifyArtifact.data_artifact_id !== binding.data_artifact_id) {
        throw new ScientificProjectError(
          'PROJECT_ARTIFACT_NOT_FOUND',
          `Artifact ID mismatch: expected '${binding.data_artifact_id}', got '${options.verifyArtifact.data_artifact_id}'`
        );
      }
      if (options.verifyArtifact.checksum !== binding.source_artifact_checksum) {
        throw new ScientificProjectError(
          'PROJECT_CHECKSUM_MISMATCH',
          `Artifact checksum mismatch: expected '${binding.source_artifact_checksum}', got '${options.verifyArtifact.checksum}'`
        );
      }
    }

    if (options?.expected_checksum && options.expected_checksum !== binding.source_artifact_checksum) {
      throw new ScientificProjectError(
        'PROJECT_CHECKSUM_MISMATCH',
        `Binding checksum '${binding.source_artifact_checksum}' does not match expected '${options.expected_checksum}'`
      );
    }

    let newStatus = project.status;
    if (project.status === 'PLANNED') {
      newStatus = 'DATA_BOUND';
    }

    return ResearchWorkflow.rebuild(project, {
      dataset_binding: binding,
      status: newStatus
    });
  }

  /**
   * Plans a variable with an assigned research role.
   */
  public static planVariable(
    project: ResearchProject,
    variable: PlannedVariable
  ): ResearchProject {
    ResearchWorkflow.assertModifiable(project);

    const existingIndex = project.variable_plan.findIndex((v) => v.variable_id === variable.variable_id);
    const updated = [...project.variable_plan];

    if (existingIndex >= 0) {
      updated[existingIndex] = variable;
    } else {
      updated.push(variable);
    }

    return ResearchWorkflow.rebuild(project, { variable_plan: updated });
  }

  /**
   * Plans an analysis step tied to a research objective.
   */
  public static planAnalysis(
    project: ResearchProject,
    planned: PlannedAnalysis
  ): ResearchProject {
    ResearchWorkflow.assertModifiable(project);

    if (!project.objectives.some((o) => o.objective_id === planned.objective_id)) {
      throw new ScientificProjectError(
        'PROJECT_ANALYSIS_NOT_FOUND',
        `Planned analysis references non-existent objective '${planned.objective_id}'`
      );
    }

    if (planned.hypothesis_id && !project.hypotheses.some((h) => h.hypothesis_id === planned.hypothesis_id)) {
      throw new ScientificProjectError(
        'PROJECT_ANALYSIS_NOT_FOUND',
        `Planned analysis references non-existent hypothesis '${planned.hypothesis_id}'`
      );
    }

    const existingIndex = project.analysis_plan.findIndex((a) => a.analysis_id === planned.analysis_id);
    const updated = [...project.analysis_plan];

    if (existingIndex >= 0) {
      updated[existingIndex] = planned;
    } else {
      updated.push(planned);
    }

    return ResearchWorkflow.rebuild(project, { analysis_plan: updated });
  }

  /**
   * Plans power analysis expectations.
   */
  public static planPower(
    project: ResearchProject,
    power: PlannedPowerAnalysis
  ): ResearchProject {
    ResearchWorkflow.assertModifiable(project);

    const existingIndex = project.power_plan.findIndex((p) => p.analysis_id === power.analysis_id);
    const updated = [...project.power_plan];

    if (existingIndex >= 0) {
      updated[existingIndex] = power;
    } else {
      updated.push(power);
    }

    return ResearchWorkflow.rebuild(project, { power_plan: updated });
  }

  /**
   * Records a plan deviation when execution diverges from the pre-specified plan.
   */
  public static recordPlanDeviation(
    project: ResearchProject,
    deviation: PlanDeviation
  ): ResearchProject {
    ResearchWorkflow.assertModifiable(project);

    const updatedDeviations = [...project.plan_deviations, deviation];

    // Mark planned analysis as DEVIATED if applicable
    const updatedAnalysisPlan = project.analysis_plan.map((a) => {
      if (a.analysis_id === deviation.planned_analysis_id) {
        return { ...a, status: 'DEVIATED' as const };
      }
      return a;
    });

    return ResearchWorkflow.rebuild(project, {
      plan_deviations: updatedDeviations,
      analysis_plan: updatedAnalysisPlan
    });
  }

  /**
   * Binds an existing statistical analysis result (D9, D10, D11, D12, D13) with source version verification.
   */
  public static bindAnalysisResult(
    project: ResearchProject,
    layer: 'd9' | 'd10' | 'd11' | 'd12' | 'd13',
    resultId: string,
    resultObject?: { dataset_version_id?: string; data_artifact_id?: string }
  ): ResearchProject {
    ResearchWorkflow.assertModifiable(project);

    // Cross-version / artifact integrity gate
    if (project.dataset_binding && resultObject) {
      if (resultObject.dataset_version_id && resultObject.dataset_version_id !== project.dataset_binding.dataset_version_id) {
        throw new ScientificProjectError(
          'PROJECT_VERSION_MISMATCH',
          `Cannot bind result '${resultId}': dataset version '${resultObject.dataset_version_id}' does not match project binding '${project.dataset_binding.dataset_version_id}'`
        );
      }
      if (resultObject.data_artifact_id && resultObject.data_artifact_id !== project.dataset_binding.data_artifact_id) {
        throw new ScientificProjectError(
          'PROJECT_VERSION_MISMATCH',
          `Cannot bind result '${resultId}': data artifact '${resultObject.data_artifact_id}' does not match project binding '${project.dataset_binding.data_artifact_id}'`
        );
      }
    }

    const key = `${layer}_results` as keyof typeof project.result_bindings;
    const existingList = project.result_bindings[key];

    if (!existingList.includes(resultId)) {
      const updatedResults = {
        ...project.result_bindings,
        [key]: [...existingList, resultId]
      };
      return ResearchWorkflow.rebuild(project, { result_bindings: updatedResults });
    }

    return project;
  }

  /**
   * Binds a D14 visualization result.
   */
  public static bindVisualizationResult(
    project: ResearchProject,
    visualizationId: string,
    visObject?: { dataset_version_id?: string; data_artifact_id?: string }
  ): ResearchProject {
    ResearchWorkflow.assertModifiable(project);

    if (project.dataset_binding && visObject) {
      if (visObject.dataset_version_id && visObject.dataset_version_id !== project.dataset_binding.dataset_version_id) {
        throw new ScientificProjectError(
          'PROJECT_VERSION_MISMATCH',
          `Visualization '${visualizationId}' dataset version mismatch`
        );
      }
    }

    if (!project.visualization_bindings.visualization_ids.includes(visualizationId)) {
      const updatedVis = {
        ...project.visualization_bindings,
        visualization_ids: [...project.visualization_bindings.visualization_ids, visualizationId]
      };
      return ResearchWorkflow.rebuild(project, { visualization_bindings: updatedVis });
    }

    return project;
  }

  /**
   * Binds a D15 interpretation result, profile, and rules.
   */
  public static bindInterpretationResult(
    project: ResearchProject,
    interpretationId: string,
    profileId?: string,
    ruleId?: string,
    interpObject?: { dataset_version_id?: string; data_artifact_id?: string }
  ): ResearchProject {
    ResearchWorkflow.assertModifiable(project);

    if (project.dataset_binding && interpObject) {
      if (interpObject.dataset_version_id && interpObject.dataset_version_id !== project.dataset_binding.dataset_version_id) {
        throw new ScientificProjectError(
          'PROJECT_VERSION_MISMATCH',
          `Interpretation '${interpretationId}' dataset version mismatch`
        );
      }
    }

    const current = project.interpretation_bindings;
    const updatedInterpIds = current.interpretation_ids.includes(interpretationId)
      ? current.interpretation_ids
      : [...current.interpretation_ids, interpretationId];

    const updatedProfileIds = profileId && !current.profile_ids.includes(profileId)
      ? [...current.profile_ids, profileId]
      : current.profile_ids;

    const updatedRuleIds = ruleId && !current.rule_ids.includes(ruleId)
      ? [...current.rule_ids, ruleId]
      : current.rule_ids;

    return ResearchWorkflow.rebuild(project, {
      interpretation_bindings: {
        interpretation_ids: updatedInterpIds,
        profile_ids: updatedProfileIds,
        rule_ids: updatedRuleIds
      }
    });
  }

  /**
   * Binds an auditable D15 EvidenceTrace.
   */
  public static bindEvidenceTrace(
    project: ResearchProject,
    evidenceTraceId: string,
    traceObject?: { dataset_version_id?: string; data_artifact_id?: string }
  ): ResearchProject {
    ResearchWorkflow.assertModifiable(project);

    if (project.dataset_binding && traceObject) {
      if (traceObject.dataset_version_id && traceObject.dataset_version_id !== project.dataset_binding.dataset_version_id) {
        throw new ScientificProjectError(
          'PROJECT_VERSION_MISMATCH',
          `Evidence trace '${evidenceTraceId}' dataset version mismatch`
        );
      }
    }

    if (!project.evidence_bindings.evidence_trace_ids.includes(evidenceTraceId)) {
      return ResearchWorkflow.rebuild(project, {
        evidence_bindings: {
          evidence_trace_ids: [...project.evidence_bindings.evidence_trace_ids, evidenceTraceId]
        }
      });
    }

    return project;
  }

  /**
   * Binds a finalized D14 ResearchReportResult.
   */
  public static bindReportResult(
    project: ResearchProject,
    reportId: string,
    reportObject?: { dataset_version_id?: string; data_artifact_id?: string }
  ): ResearchProject {
    ResearchWorkflow.assertModifiable(project);

    if (project.dataset_binding && reportObject) {
      if (reportObject.dataset_version_id && reportObject.dataset_version_id !== project.dataset_binding.dataset_version_id) {
        throw new ScientificProjectError(
          'PROJECT_VERSION_MISMATCH',
          `Report '${reportId}' dataset version mismatch`
        );
      }
    }

    if (!project.report_bindings.report_ids.includes(reportId)) {
      return ResearchWorkflow.rebuild(project, {
        report_bindings: {
          report_ids: [...project.report_bindings.report_ids, reportId]
        }
      });
    }

    return project;
  }

  /**
   * Asserts that a project is in a mutable lifecycle state.
   */
  private static assertModifiable(project: ResearchProject): void {
    if (project.status === 'FINALIZED' || project.status === 'ARCHIVED') {
      throw new ScientificProjectError(
        'PROJECT_IMMUTABILITY_VIOLATION',
        `Cannot modify project '${project.project_id}' in finalized or archived status '${project.status}'`
      );
    }
  }

  /**
   * Helper to rebuild a project draft, update timestamp, recompute provenance hash, and deepFreeze.
   */
  private static rebuild(
    project: ResearchProject,
    patch: Partial<ResearchProject>
  ): ResearchProject {
    const updatedDraft: ResearchProject = {
      ...project,
      ...patch,
      updated_at: new Date().toISOString(),
      provenance_hash: ''
    };

    const newHash = ResearchProjectProvenance.computeHash(updatedDraft);
    updatedDraft.provenance_hash = newHash;

    return createResearchProject(updatedDraft);
  }
}
