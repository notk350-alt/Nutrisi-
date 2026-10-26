/**
 * NutriBodySim — Research Workspace Service (Phase F1 Application Layer)
 *
 * Connects the UI Workspace Forms to existing Phase E contracts and workflow APIs.
 *
 * Strict Architectural Guarantees:
 * 1. Zero dynamic code execution (no eval, no new Function).
 * 2. REUSES existing Phase E contracts (ResearchProject, DatasetBinding, PlannedVariable, StudyDesign, etc.)
 *    and workflow APIs (ResearchWorkflow, ResearchProjectRegistry, DatasetVersionStore, DataArtifactStore, VariableStore).
 * 3. Does not place any statistical calculations in UI or application code (no D9-D15 duplication).
 * 4. Preserves deep immutability and deterministic provenance hashing.
 * 5. Strictly preserves scientific_validity = 'NOT_ESTABLISHED'.
 * 6. Study design and variable roles are metadata only; never infers causality.
 * 7. Research questions and hypotheses MUST be explicitly user-supplied.
 */

import {
  createDataArtifact,
  createDataset,
  createDatasetVersion,
  DataArtifact,
  DatasetBinding,
  DatasetVersion,
  defaultDataArtifactStore,
  defaultDatasetStore,
  defaultDatasetVersionStore,
  defaultResearchProjectRegistry,
  defaultVariableStore,
  HypothesisDirection,
  ObjectiveType,
  PlannedVariable,
  ProjectStatus,
  ResearchHypothesis,
  ResearchObjective,
  ResearchProject,
  ResearchProjectRegistry,
  ResearchQuestion,
  ResearchQuestionPriority,
  ResearchWorkflow,
  ScientificProjectError,
  StudyDesign,
  StudyDesignType,
  validateResearchProject,
  Variable,
  VariableRole,
  AnalysisPlanContract,
  AnalysisPlanStatus,
  AnalysisPlanType,
  PlannedAnalysis,
  PlannedAnalysisType,
  AnalysisExecutionPreflight,
  AnalysisExecutionRequest,
  PreflightResult,
  ScientificExecutionBridgeError,
  ExecutionPreview,
  ExecutionPreviewErrorCode,
  ExecutionPreviewOptions,
  ExecutionPreviewReadinessStatus,
  ExecutionPreviewValidator,
  ScientificExecutionPreviewError,
  defaultVariableMappingStore,
  ExecutionAuthorization,
  ExecutionAuthorizationErrorCode,
  ExecutionAuthorizationStatus,
  ExecutionAuthorizationGate,
  ExecutionAuthorizationStore,
  defaultExecutionAuthorizationStore,
  ScientificAuthorizationGateError,
  CreateAuthorizationOptions,
  AuthorizedExecutionAdapter,
  AuthorizedExecutionPacket,
  AuthorizedExecutionDispatchResult,
  AuthorizedExecutionDispatchStore,
  defaultAuthorizedExecutionDispatchStore,
  PrepareDispatchOptions,
  ScientificAuthorizedAdapterError,
  AuthorizedStatisticalExecutionEngine,
  AuthorizedStatisticalExecutionResult,
  AuthorizedStatisticalExecutionStore,
  defaultAuthorizedStatisticalExecutionStore,
  ExecuteAuthorizedDispatchOptions,
  StatisticalExecutionRequest,
  ScientificStatisticalExecutionError
} from '../../scientific';

export type {
  AnalysisPlanContract,
  AnalysisPlanStatus,
  AnalysisPlanType,
  AnalysisExecutionRequest,
  PreflightResult,
  ExecutionPreview,
  ExecutionPreviewErrorCode,
  ExecutionPreviewOptions,
  ExecutionPreviewReadinessStatus,
  ExecutionAuthorization,
  ExecutionAuthorizationErrorCode,
  ExecutionAuthorizationStatus,
  AuthorizedExecutionPacket,
  AuthorizedExecutionDispatchResult,
  AuthorizedStatisticalExecutionResult,
  StatisticalExecutionRequest
};

export interface CreateProjectFormData {
  project_id?: string;
  project_version?: string;
  title: string;
  description: string;
  created_by: string;
  // Study Design (Metadata only — never infer causality)
  study_design: {
    design_type: StudyDesignType;
    description: string;
    blinding?: 'NONE' | 'SINGLE' | 'DOUBLE' | 'TRIPLE';
    randomization?: boolean;
    temporal_direction?: 'PROSPECTIVE' | 'RETROSPECTIVE' | 'CROSS_SECTIONAL';
    population?: string;
    setting?: string;
  };
  // Explicitly user-supplied research question
  research_question: {
    question_id?: string;
    question_text: string;
    priority: ResearchQuestionPriority;
  };
  // Explicitly user-supplied objective
  objective: {
    objective_id?: string;
    type: ObjectiveType;
    description: string;
    target_variables?: string[];
  };
  // Explicitly user-supplied hypothesis
  hypothesis: {
    hypothesis_id?: string;
    null_hypothesis: string;
    alternative_hypothesis: string;
    direction: HypothesisDirection;
    planned_alpha?: number;
  };
}

export interface BindDatasetFormData {
  project_id: string;
  dataset_version_id: string;
  data_artifact_id: string;
  binding_notes?: string;
}

export interface PlanVariableFormData {
  project_id: string;
  variable_id: string;
  role: VariableRole;
  rationale?: string;
  expected_unit?: string;
  transformation?: string;
}

export interface PlanAnalysisFormData {
  project_id: string;
  analysis_id: string;
  objective_id: string;
  hypothesis_id?: string;
  analysis_type: AnalysisPlanType;
  input_variable_ids: string[];
  grouping_variable_ids?: string[];
  pairing_variable_ids?: string[];
  alpha?: number;
  confidence_level?: number;
  configuration?: Record<string, unknown>;
  planned_rationale: string;
}

export class ResearchWorkspaceService {
  private registry: ResearchProjectRegistry;
  private variableStore = defaultVariableStore;
  private datasetStore = defaultDatasetStore;
  private versionStore = defaultDatasetVersionStore;
  private artifactStore = defaultDataArtifactStore;
  private variableMappingStore = defaultVariableMappingStore;
  private authorizationStore = defaultExecutionAuthorizationStore;
  private dispatchStore = defaultAuthorizedExecutionDispatchStore;
  private executionResultStore = defaultAuthorizedStatisticalExecutionStore;

  constructor(registry: ResearchProjectRegistry = defaultResearchProjectRegistry) {
    this.registry = registry;
    this.seedDefaultsIfEmpty();
  }

  /**
   * Returns all registered research projects.
   */
  public listProjects(): ResearchProject[] {
    return this.registry.listProjects();
  }

  /**
   * Retrieves a specific project by ID.
   */
  public getProject(projectId: string, version?: string): ResearchProject | undefined {
    return this.registry.getProject(projectId, version);
  }

  /**
   * Updates project lifecycle status following Phase E lifecycle rules.
   */
  public updateStatus(projectId: string, newStatus: ProjectStatus): ResearchProject {
    return this.registry.updateProjectStatus(projectId, newStatus);
  }

  /**
   * FORM 1: Project Creation
   * Initializes a new ResearchProject with explicit user-supplied questions and hypotheses.
   */
  public createProject(data: CreateProjectFormData): ResearchProject {
    // 1. Validate mandatory project metadata
    if (!data.title || typeof data.title !== 'string' || data.title.trim() === '') {
      throw new ScientificProjectError('PROJECT_INVALID_CONTRACT', 'Project title is required and cannot be blank.');
    }
    if (!data.description || typeof data.description !== 'string' || data.description.trim() === '') {
      throw new ScientificProjectError('PROJECT_INVALID_CONTRACT', 'Project description is required and cannot be blank.');
    }
    if (!data.created_by || typeof data.created_by !== 'string' || data.created_by.trim() === '') {
      throw new ScientificProjectError('PROJECT_INVALID_CONTRACT', 'Created by (author) is required.');
    }

    // 2. Validate study design metadata
    if (!data.study_design || !data.study_design.design_type) {
      throw new ScientificProjectError('PROJECT_INVALID_CONTRACT', 'Study design type is required.');
    }
    if (!data.study_design.description || data.study_design.description.trim() === '') {
      throw new ScientificProjectError('PROJECT_INVALID_CONTRACT', 'Study design description is required.');
    }

    // 3. Validate explicit research question (NO automatic generation)
    if (!data.research_question || !data.research_question.question_text || data.research_question.question_text.trim() === '') {
      throw new ScientificProjectError(
        'PROJECT_INVALID_CONTRACT',
        'Explicit research question is required. Automatic generation of research questions is forbidden.'
      );
    }

    // 4. Validate explicit objective
    if (!data.objective || !data.objective.description || data.objective.description.trim() === '') {
      throw new ScientificProjectError('PROJECT_INVALID_CONTRACT', 'Explicit research objective description is required.');
    }

    // 5. Validate explicit hypothesis (NO automatic generation)
    if (
      !data.hypothesis ||
      !data.hypothesis.null_hypothesis ||
      data.hypothesis.null_hypothesis.trim() === '' ||
      !data.hypothesis.alternative_hypothesis ||
      data.hypothesis.alternative_hypothesis.trim() === ''
    ) {
      throw new ScientificProjectError(
        'PROJECT_INVALID_CONTRACT',
        'Explicit null and alternative hypotheses are required. Automatic generation of hypotheses is forbidden.'
      );
    }

    const projectId = data.project_id?.trim() || `PROJ_${Date.now()}`;
    const version = data.project_version?.trim() || '1.0.0';
    const questionId = data.research_question.question_id?.trim() || `Q_${projectId}_01`;
    const objectiveId = data.objective.objective_id?.trim() || `OBJ_${projectId}_01`;
    const hypothesisId = data.hypothesis.hypothesis_id?.trim() || `HYP_${projectId}_01`;

    const studyDesign: StudyDesign = {
      design_type: data.study_design.design_type,
      description: data.study_design.description.trim(),
      blinding: data.study_design.blinding,
      randomization: data.study_design.randomization,
      temporal_direction: data.study_design.temporal_direction,
      population: data.study_design.population?.trim(),
      setting: data.study_design.setting?.trim(),
      metadata: {
        causality_disclaimer: 'Study design is metadata only. Observational / study design metadata never proves causality.'
      }
    };

    // Step A: Initialize Draft using Phase E API
    let project = ResearchWorkflow.createDraftProject({
      project_id: projectId,
      project_version: version,
      title: data.title.trim(),
      description: data.description.trim(),
      study_design: studyDesign,
      created_by: data.created_by.trim()
    });

    // Step B: Add Objective using Phase E API
    const objective: ResearchObjective = {
      objective_id: objectiveId,
      type: data.objective.type || 'PRIMARY_OBJECTIVE',
      description: data.objective.description.trim(),
      target_variables: data.objective.target_variables,
      status: 'ACTIVE'
    };
    project = ResearchWorkflow.addObjective(project, objective);

    // Step C: Add Research Question using Phase E API
    const question: ResearchQuestion = {
      question_id: questionId,
      question_text: data.research_question.question_text.trim(),
      priority: data.research_question.priority || 'PRIMARY',
      objective_ids: [objectiveId],
      status: 'ACTIVE'
    };
    project = ResearchWorkflow.addResearchQuestion(project, question);

    // Step D: Add Hypothesis using Phase E API
    const hypothesis: ResearchHypothesis = {
      hypothesis_id: hypothesisId,
      question_id: questionId,
      objective_id: objectiveId,
      null_hypothesis: data.hypothesis.null_hypothesis.trim(),
      alternative_hypothesis: data.hypothesis.alternative_hypothesis.trim(),
      direction: data.hypothesis.direction || 'TWO_SIDED',
      planned_alpha: data.hypothesis.planned_alpha ?? 0.05,
      status: 'PROPOSED'
    };
    project = ResearchWorkflow.addHypothesis(project, hypothesis);

    // Step E: Register project in registry
    return this.registry.registerProject(project);
  }

  /**
   * FORM 2: Dataset Binding
   * Binds dataset version and data artifact to an existing research project.
   */
  public bindDataset(data: BindDatasetFormData): ResearchProject {
    const project = this.registry.getProject(data.project_id);
    if (!project) {
      throw new ScientificProjectError('PROJECT_NOT_FOUND', `Project '${data.project_id}' not found.`);
    }

    if (project.status === 'FINALIZED' || project.status === 'ARCHIVED') {
      throw new ScientificProjectError(
        'PROJECT_IMMUTABILITY_VIOLATION',
        `Cannot modify project '${project.project_id}' in finalized or archived status '${project.status}'`
      );
    }

    if (!data.dataset_version_id || data.dataset_version_id.trim() === '') {
      throw new ScientificProjectError('PROJECT_DATASET_NOT_FOUND', 'dataset_version_id is required.');
    }
    if (!data.data_artifact_id || data.data_artifact_id.trim() === '') {
      throw new ScientificProjectError('PROJECT_ARTIFACT_NOT_FOUND', 'data_artifact_id is required.');
    }

    // 1. Verify dataset version existence in store
    const version = this.versionStore.get(data.dataset_version_id);
    if (!version) {
      throw new ScientificProjectError(
        'PROJECT_DATASET_NOT_FOUND',
        `Dataset version '${data.dataset_version_id}' does not exist in the Dataset Version Store.`
      );
    }

    // 2. Verify artifact existence in store
    const artifact = this.artifactStore.get(data.data_artifact_id);
    if (!artifact) {
      throw new ScientificProjectError(
        'PROJECT_ARTIFACT_NOT_FOUND',
        `Data artifact '${data.data_artifact_id}' does not exist in the Data Artifact Store.`
      );
    }

    // 3. Cross-version rejection: artifact must belong to the specified dataset_version_id
    if (artifact.dataset_version_id !== data.dataset_version_id) {
      throw new ScientificProjectError(
        'PROJECT_VERSION_MISMATCH',
        `DataArtifact '${data.data_artifact_id}' belongs to dataset version '${artifact.dataset_version_id}', expected '${data.dataset_version_id}'.`
      );
    }

    // 4. Verify artifact checksum integrity
    const checksumCheck = this.artifactStore.verifyChecksum(artifact.artifact_id);
    if (!checksumCheck.matches) {
      throw new ScientificProjectError(
        'PROJECT_CHECKSUM_MISMATCH',
        `Artifact checksum mismatch for '${data.data_artifact_id}': recorded '${checksumCheck.storedChecksum}', calculated '${checksumCheck.computedChecksum}'.`
      );
    }

    // 5. Lineage validation: verify parent artifact lineage if present
    if (artifact.parent_artifact_id) {
      const parent = this.artifactStore.get(artifact.parent_artifact_id);
      if (!parent || parent.dataset_version_id !== data.dataset_version_id) {
        throw new ScientificProjectError(
          'PROJECT_VERSION_MISMATCH',
          `Artifact lineage broken: parent artifact '${artifact.parent_artifact_id}' does not belong to version '${data.dataset_version_id}'.`
        );
      }
    }

    const binding: DatasetBinding = {
      dataset_version_id: data.dataset_version_id,
      data_artifact_id: data.data_artifact_id,
      source_artifact_checksum: artifact.checksum,
      bound_at: new Date().toISOString(),
      binding_notes: data.binding_notes?.trim()
    };

    // Call Phase E API with strict verification options
    const updatedProject = ResearchWorkflow.bindDataset(project, binding, {
      expected_checksum: artifact.checksum,
      verifyArtifact: {
        dataset_version_id: artifact.dataset_version_id,
        data_artifact_id: artifact.artifact_id,
        checksum: artifact.checksum
      }
    });

    return this.registry.registerProject(updatedProject);
  }

  /**
   * FORM 3: Variable Plan
   * Assigns a research role to a variable from the Variable Registry.
   */
  public planVariable(data: PlanVariableFormData): ResearchProject {
    const project = this.registry.getProject(data.project_id);
    if (!project) {
      throw new ScientificProjectError('PROJECT_NOT_FOUND', `Project '${data.project_id}' not found.`);
    }

    if (project.status === 'FINALIZED' || project.status === 'ARCHIVED') {
      throw new ScientificProjectError(
        'PROJECT_IMMUTABILITY_VIOLATION',
        `Cannot modify project '${project.project_id}' in finalized or archived status '${project.status}'`
      );
    }

    if (!data.variable_id || data.variable_id.trim() === '') {
      throw new ScientificProjectError('PROJECT_VARIABLE_NOT_FOUND', 'variable_id is required.');
    }
    if (!data.role) {
      throw new ScientificProjectError('PROJECT_INVALID_CONTRACT', 'Variable role is required.');
    }

    // 1. Verify variable exists in the Variable Registry
    const registryVariable = this.variableStore.get(data.variable_id);
    if (!registryVariable) {
      throw new ScientificProjectError(
        'PROJECT_VARIABLE_NOT_FOUND',
        `Variable '${data.variable_id}' is not registered in the Variable Registry.`
      );
    }

    // 2. Validate role is one of the 9 allowed roles
    const allowedRoles: ReadonlySet<VariableRole> = new Set<VariableRole>([
      'OUTCOME',
      'EXPOSURE',
      'PREDICTOR',
      'COVARIATE',
      'GROUPING',
      'PAIRING',
      'TIME',
      'STRATIFICATION',
      'OTHER'
    ]);

    if (!allowedRoles.has(data.role)) {
      throw new ScientificProjectError(
        'PROJECT_INVALID_CONTRACT',
        `Invalid variable role '${data.role}'. Must be one of: ${Array.from(allowedRoles).join(', ')}.`
      );
    }

    // 3. Assemble planned variable (metadata only — never alters underlying variable registry)
    const planned: PlannedVariable = {
      variable_id: data.variable_id,
      role: data.role,
      rationale: data.rationale?.trim(),
      expected_unit: data.expected_unit?.trim() || registryVariable.unit,
      transformation: data.transformation?.trim()
    };

    // Call Phase E API
    const updatedProject = ResearchWorkflow.planVariable(project, planned);
    return this.registry.registerProject(updatedProject);
  }

  /**
   * FORM 4: Analysis Plan (Phase F2.1)
   * Creates an explicit planned analysis tied to an existing project, objective, optional hypothesis,
   * dataset binding, and registered variables.
   *
   * Architectural & Scientific Guarantees:
   * 1. Status is strictly 'PLANNED' — zero statistical engines (D9-D13) execute.
   * 2. Preserves deep immutability: rejects finalized or archived projects.
   * 3. Requires an active, validated dataset binding.
   * 4. Variables must exist in the Variable Registry; does not alter Variable Registry.
   * 5. Variables and roles are metadata only; never infers causality.
   * 6. Strictly preserves scientific_validity = 'NOT_ESTABLISHED'.
   * 7. Declarative contract only: zero dynamic evaluation or executable strings.
   */
  public planAnalysis(data: PlanAnalysisFormData): ResearchProject {
    const project = this.registry.getProject(data.project_id);
    if (!project) {
      throw new ScientificProjectError('PROJECT_NOT_FOUND', `Project '${data.project_id}' not found.`);
    }

    if (project.status === 'FINALIZED' || project.status === 'ARCHIVED') {
      throw new ScientificProjectError(
        'PROJECT_IMMUTABILITY_VIOLATION',
        `Cannot modify project '${project.project_id}' in finalized or archived status '${project.status}'`
      );
    }

    // 1. Dataset Safety: Analysis plan must remain bound to project's active dataset binding
    if (!project.dataset_binding || !project.dataset_binding.dataset_version_id || !project.dataset_binding.data_artifact_id) {
      throw new ScientificProjectError(
        'PROJECT_DATASET_NOT_FOUND',
        'Analysis planning requires an active dataset binding on the project. No dataset is currently bound.'
      );
    }

    // 2. Required Analysis ID
    if (!data.analysis_id || typeof data.analysis_id !== 'string' || data.analysis_id.trim() === '') {
      throw new ScientificProjectError('PROJECT_INVALID_CONTRACT', 'Analysis ID is required and cannot be blank.');
    }

    // 3. Required Objective & Existence
    if (!data.objective_id || typeof data.objective_id !== 'string' || data.objective_id.trim() === '') {
      throw new ScientificProjectError('PROJECT_INVALID_CONTRACT', 'Objective is required.');
    }
    const objectiveExists = project.objectives.some((o) => o.objective_id === data.objective_id.trim());
    if (!objectiveExists) {
      throw new ScientificProjectError(
        'PROJECT_ANALYSIS_NOT_FOUND',
        `Planned analysis references non-existent objective '${data.objective_id}'`
      );
    }

    // 4. Hypothesis Binding & Existence (when supplied)
    if (data.hypothesis_id && data.hypothesis_id.trim() !== '') {
      const hypothesisExists = project.hypotheses.some((h) => h.hypothesis_id === data.hypothesis_id!.trim());
      if (!hypothesisExists) {
        throw new ScientificProjectError(
          'PROJECT_ANALYSIS_NOT_FOUND',
          `Planned analysis references non-existent hypothesis '${data.hypothesis_id}'`
        );
      }
    }

    // 5. Analysis Type Validation
    const allowedTypes: readonly AnalysisPlanType[] = [
      'DESCRIPTIVE',
      'INFERENTIAL',
      'REGRESSION',
      'POWER_ANALYSIS',
      'NON_PARAMETRIC'
    ];
    if (!data.analysis_type || !allowedTypes.includes(data.analysis_type)) {
      throw new ScientificProjectError(
        'PROJECT_INVALID_CONTRACT',
        `Analysis type is required and must be one of: ${allowedTypes.join(', ')}.`
      );
    }

    // 6. Planned Rationale
    if (!data.planned_rationale || typeof data.planned_rationale !== 'string' || data.planned_rationale.trim() === '') {
      throw new ScientificProjectError('PROJECT_INVALID_CONTRACT', 'Planned rationale is required and cannot be blank.');
    }

    // 7. Input Variables Validation
    if (!data.input_variable_ids || !Array.isArray(data.input_variable_ids) || data.input_variable_ids.length === 0) {
      throw new ScientificProjectError('PROJECT_INVALID_CONTRACT', 'At least one input variable is required for an analysis plan.');
    }

    // 8. Variable Registry Validation (Variables must exist in registry; do NOT mutate registry)
    const allVarIds: string[] = [
      ...data.input_variable_ids,
      ...(data.grouping_variable_ids || []),
      ...(data.pairing_variable_ids || [])
    ]
      .map((id) => (typeof id === 'string' ? id.trim() : ''))
      .filter((id) => id.length > 0);

    for (const varId of allVarIds) {
      const registered = this.variableStore.get(varId);
      if (!registered) {
        throw new ScientificProjectError(
          'PROJECT_VARIABLE_NOT_FOUND',
          `Variable '${varId}' is not registered in the Variable Registry.`
        );
      }
    }

    // 9. Alpha Validation
    if (data.alpha !== undefined && data.alpha !== null) {
      if (typeof data.alpha !== 'number' || isNaN(data.alpha) || data.alpha <= 0 || data.alpha >= 1) {
        throw new ScientificProjectError(
          'PROJECT_INVALID_CONTRACT',
          'Alpha must be a valid probability strictly between 0 and 1 (exclusive), e.g. 0.05.'
        );
      }
    } else if (['INFERENTIAL', 'REGRESSION', 'POWER_ANALYSIS', 'NON_PARAMETRIC'].includes(data.analysis_type)) {
      throw new ScientificProjectError(
        'PROJECT_INVALID_CONTRACT',
        `Alpha is required for ${data.analysis_type} analyses and must be strictly between 0 and 1.`
      );
    }

    // 10. Confidence Level Validation
    if (data.confidence_level !== undefined && data.confidence_level !== null) {
      if (
        typeof data.confidence_level !== 'number' ||
        isNaN(data.confidence_level) ||
        data.confidence_level <= 0 ||
        data.confidence_level >= 1
      ) {
        throw new ScientificProjectError(
          'PROJECT_INVALID_CONTRACT',
          'Confidence level must be a valid probability strictly between 0 and 1 (exclusive), e.g. 0.95.'
        );
      }
    }

    // 11. Declarative Contract Security (No executable strings or functions)
    if (data.configuration && typeof data.configuration === 'object') {
      for (const [, val] of Object.entries(data.configuration)) {
        if (typeof val === 'function') {
          throw new ScientificProjectError(
            'PROJECT_INVALID_CONTRACT',
            'Executable functions in configuration are strictly forbidden.'
          );
        }
      }
    }

    // 12. Build Planned Analysis Contract (status is strictly PLANNED; no statistical engines execute)
    const planned: PlannedAnalysis = {
      analysis_id: data.analysis_id.trim(),
      objective_id: data.objective_id.trim(),
      hypothesis_id: data.hypothesis_id?.trim() || undefined,
      analysis_type: data.analysis_type,
      input_variables: data.input_variable_ids.map((v) => v.trim()),
      input_variable_ids: data.input_variable_ids.map((v) => v.trim()),
      grouping_variable: data.grouping_variable_ids?.[0]?.trim() || undefined,
      grouping_variable_ids: data.grouping_variable_ids?.map((v) => v.trim()),
      pairing_variable: data.pairing_variable_ids?.[0]?.trim() || undefined,
      pairing_variable_ids: data.pairing_variable_ids?.map((v) => v.trim()),
      alpha: data.alpha,
      confidence_level: data.confidence_level,
      configuration: data.configuration,
      planned_rationale: data.planned_rationale.trim(),
      status: 'PLANNED'
    };

    // Rebuild project through Phase E API
    const updatedProject = ResearchWorkflow.planAnalysis(project, planned);
    return this.registry.registerProject(updatedProject);
  }

  /**
   * Phase F2.2A: Preflight Validation for Planned Analysis
   * Performs deterministic structural preflight validation without executing any statistical engine.
   */
  public preflightAnalysis(projectId: string, analysisId: string): PreflightResult {
    const project = this.registry.getProject(projectId);
    if (!project) {
      return {
        status: 'BLOCKED',
        errors: [`[EXECUTION_PROJECT_NOT_FOUND] Project '${projectId}' not found.`],
        warnings: [],
        scientific_validity: 'NOT_ESTABLISHED'
      };
    }

    return AnalysisExecutionPreflight.validate({
      project,
      analysis_id: analysisId,
      dataset_version_store: this.versionStore,
      data_artifact_store: this.artifactStore,
      variable_store: this.variableStore
    });
  }

  /**
   * Phase F2.2A: Creates an immutable AnalysisExecutionRequest if preflight passes.
   * Throws ScientificExecutionBridgeError if validation is BLOCKED.
   */
  public createAnalysisExecutionRequest(projectId: string, analysisId: string): AnalysisExecutionRequest {
    const project = this.registry.getProject(projectId);
    if (!project) {
      throw new ScientificExecutionBridgeError(
        'EXECUTION_PROJECT_NOT_FOUND',
        `Project '${projectId}' not found.`
      );
    }

    return AnalysisExecutionPreflight.createExecutionRequest({
      project,
      analysis_id: analysisId,
      dataset_version_store: this.versionStore,
      data_artifact_store: this.artifactStore,
      variable_store: this.variableStore
    });
  }

  /**
   * Phase F2.2B: Deterministic Execution Preview & Governance Preflight
   * Returns an immutable ExecutionPreview snapshot without invoking any statistical engines.
   */
  public previewExecution(
    projectId: string,
    analysisId: string,
    options?: Partial<ExecutionPreviewOptions>
  ): ExecutionPreview {
    const project = this.registry.getProject(projectId);
    return ExecutionPreviewValidator.generatePreview({
      project,
      project_id: projectId,
      analysis_id: analysisId,
      dataset_version_store: this.versionStore,
      data_artifact_store: this.artifactStore,
      variable_store: this.variableStore,
      variable_mapping_store: this.variableMappingStore,
      ...options
    });
  }

  /**
   * Phase F2.2B: Alias for previewExecution ensuring contract compliance.
   */
  public createExecutionPreview(
    projectId: string,
    analysisId: string,
    options?: Partial<ExecutionPreviewOptions>
  ): ExecutionPreview {
    return this.previewExecution(projectId, analysisId, options);
  }

  /**
   * Phase F2.2C.1: Execution Authorization Gate
   * Explicitly authorizes a READY ExecutionPreview after re-verifying current system state.
   * Does NOT execute any statistical engines (D9-D13 remain untouched).
   */
  public authorizeExecution(
    projectId: string,
    analysisId: string,
    authorizedBy: string,
    options?: Partial<CreateAuthorizationOptions>
  ): ExecutionAuthorization {
    const project = this.registry.getProject(projectId);
    if (!project) {
      throw new ScientificAuthorizationGateError(
        'PROJECT_NOT_EXECUTABLE',
        `Project '${projectId}' not found in registry.`
      );
    }

    const preview = options?.preview || this.previewExecution(projectId, analysisId);

    const authorization = ExecutionAuthorizationGate.createAuthorization({
      preview,
      authorized_by: authorizedBy,
      project,
      project_registry: this.registry,
      dataset_version_store: this.versionStore,
      data_artifact_store: this.artifactStore,
      variable_store: this.variableStore,
      variable_mapping_store: this.variableMappingStore,
      ...options
    });

    return this.authorizationStore.register(authorization);
  }

  /**
   * Retrieves an authorization record by authorization_id.
   */
  public getAuthorization(authorizationId: string): ExecutionAuthorization | undefined {
    return this.authorizationStore.get(authorizationId);
  }

  /**
   * Retrieves active authorization for a specific project and analysis.
   */
  public getAuthorizationForAnalysis(projectId: string, analysisId: string): ExecutionAuthorization | undefined {
    return this.authorizationStore.findByAnalysis(projectId, analysisId);
  }

  /**
   * Lists all execution authorizations.
   */
  public listAuthorizations(): ExecutionAuthorization[] {
    return this.authorizationStore.list();
  }

  /**
   * Phase F2.2C.2: Authorized Execution Adapter
   * Strictly adapts an ExecutionAuthorization into an immutable AuthorizedExecutionPacket.
   * Enforces all 13 boundary invariants and delegates to AuthorizedExecutionAdapter.
   * Does NOT execute any statistical calculations or D9–D13 engines.
   */
  public dispatchAuthorizedExecution(
    projectId: string,
    analysisId: string,
    options?: Partial<PrepareDispatchOptions>
  ): AuthorizedExecutionPacket {
    const project = this.registry.getProject(projectId);
    if (!project) {
      throw new ScientificAuthorizedAdapterError(
        'PROJECT_NOT_EXECUTABLE',
        `Project '${projectId}' not found in registry.`
      );
    }

    const authorization =
      options?.authorization || this.getAuthorizationForAnalysis(projectId, analysisId);
    if (!authorization) {
      throw new ScientificAuthorizedAdapterError(
        'AUTHORIZATION_REQUIRED',
        `No authorization found for project '${projectId}' and analysis '${analysisId}'.`
      );
    }

    const preview = options?.preview || this.previewExecution(projectId, analysisId);

    const packet = AuthorizedExecutionAdapter.createDispatchPacket({
      authorization,
      preview,
      project,
      project_registry: this.registry,
      dataset_version_store: this.versionStore,
      data_artifact_store: this.artifactStore,
      ...options
    });

    return this.dispatchStore.register(packet);
  }

  /**
   * Phase F2.2C.2: Prepares and validates dispatch without throwing.
   */
  public prepareAuthorizedDispatch(
    projectId: string,
    analysisId: string,
    options?: Partial<PrepareDispatchOptions>
  ): AuthorizedExecutionDispatchResult {
    const project = this.registry.getProject(projectId);
    if (!project) {
      return {
        status: 'BLOCKED',
        errors: [`Project '${projectId}' not found in registry.`],
        warnings: [],
        scientific_validity: 'NOT_ESTABLISHED'
      };
    }

    const authorization =
      options?.authorization || this.getAuthorizationForAnalysis(projectId, analysisId);
    if (!authorization) {
      return {
        status: 'BLOCKED',
        errors: [`No authorization found for project '${projectId}' and analysis '${analysisId}'.`],
        warnings: [],
        scientific_validity: 'NOT_ESTABLISHED'
      };
    }

    const preview = options?.preview || this.previewExecution(projectId, analysisId);

    return AuthorizedExecutionAdapter.adaptAndValidate({
      authorization,
      preview,
      project,
      project_registry: this.registry,
      dataset_version_store: this.versionStore,
      data_artifact_store: this.artifactStore,
      ...options
    });
  }

  /**
   * Retrieves a dispatch packet by dispatch_id.
   */
  public getDispatchPacket(dispatchId: string): AuthorizedExecutionPacket | undefined {
    return this.dispatchStore.get(dispatchId);
  }

  /**
   * Retrieves active dispatch packet for a specific project and analysis.
   */
  public getDispatchForAnalysis(projectId: string, analysisId: string): AuthorizedExecutionPacket | undefined {
    return this.dispatchStore.findByAnalysis(projectId, analysisId);
  }

  /**
   * Lists all execution dispatch packets.
   */
  public listDispatches(): AuthorizedExecutionPacket[] {
    return this.dispatchStore.list();
  }

  /**
   * Phase F2.2C.3: Actual Statistical Execution
   * Executes an authoritative statistical engine (D9–D13) strictly from a validated AuthorizedExecutionPacket.
   * Produces an immutable AuthorizedStatisticalExecutionResult sealed with SHA-256 provenance.
   * Preserves scientific_validity = 'NOT_ESTABLISHED'.
   */
  public executeAuthorizedDispatch(
    dispatch: AuthorizedExecutionPacket,
    options?: Partial<ExecuteAuthorizedDispatchOptions>
  ): AuthorizedStatisticalExecutionResult {
    const result = AuthorizedStatisticalExecutionEngine.executeAuthorizedDispatch({
      dispatch,
      dataset_version_store: this.versionStore,
      data_artifact_store: this.artifactStore,
      variable_store: this.variableStore,
      variable_mapping_store: this.variableMappingStore,
      project_registry: this.registry,
      ...options
    });

    return this.executionResultStore.register(result);
  }

  /**
   * Retrieves an execution result by execution_id.
   */
  public getExecutionResult(executionId: string): AuthorizedStatisticalExecutionResult | undefined {
    return this.executionResultStore.get(executionId);
  }

  /**
   * Retrieves the latest execution result for a specific project and analysis.
   */
  public getExecutionForAnalysis(projectId: string, analysisId: string): AuthorizedStatisticalExecutionResult | undefined {
    return this.executionResultStore.findByAnalysis(projectId, analysisId);
  }

  /**
   * Lists all statistical execution results.
   */
  public listExecutionResults(): AuthorizedStatisticalExecutionResult[] {
    return this.executionResultStore.list();
  }

  /**
   * Helper: Lists available dataset versions.
   */
  public listDatasetVersions(): DatasetVersion[] {
    return this.versionStore.list();
  }

  /**
   * Helper: Lists data artifacts for a dataset version.
   */
  public listArtifacts(datasetVersionId?: string): DataArtifact[] {
    if (datasetVersionId) {
      return this.artifactStore.findByDatasetVersion(datasetVersionId);
    }
    return this.artifactStore.list();
  }

  /**
   * Helper: Lists available variables from the Variable Registry.
   */
  public listVariables(): Variable[] {
    return this.variableStore.list();
  }

  /**
   * Helper: Retrieves a specific variable from the Variable Registry.
   */
  public getVariable(variableId: string): Variable | undefined {
    return this.variableStore.get(variableId);
  }

  /**
   * Seeds standard reference datasets, versions, artifacts, and variables if stores are empty.
   */
  private seedDefaultsIfEmpty(): void {
    // 1. Seed Variables if empty
    if (this.variableStore.list().length === 0) {
      const defaultVars: Variable[] = [
        {
          variable_id: 'VAR_FASTING_GLUCOSE',
          name: 'Fasting Plasma Glucose',
          description: 'Fasting blood glucose concentration measured after an 8-hour fast.',
          datatype: 'NUMBER',
          unit: 'mg/dL',
          dimension: 'concentration',
          semantic_type: 'CONTINUOUS',
          category: 'LABORATORY',
          required: true,
          allowed_range: { min: 40, max: 600, warning_min: 70, warning_max: 126 },
          missing_policy: 'REQUIRED',
          status: 'ACTIVE',
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z'
        },
        {
          variable_id: 'VAR_SOLUBLE_FIBER',
          name: 'Dietary Soluble Fiber Intake',
          description: 'Average daily soluble fiber intake from validated food frequency records.',
          datatype: 'NUMBER',
          unit: 'g',
          dimension: 'mass',
          semantic_type: 'CONTINUOUS',
          category: 'NUTRITION',
          required: true,
          allowed_range: { min: 0, max: 100, warning_min: 5, warning_max: 50 },
          missing_policy: 'OPTIONAL',
          status: 'ACTIVE',
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z'
        },
        {
          variable_id: 'VAR_BODY_MASS_INDEX',
          name: 'Body Mass Index',
          description: 'Quetelet index calculated as weight in kilograms divided by height in meters squared.',
          datatype: 'NUMBER',
          unit: 'kg/m2',
          dimension: 'dimensionless',
          semantic_type: 'CONTINUOUS',
          category: 'ANTHROPOMETRY',
          required: true,
          allowed_range: { min: 10, max: 80, warning_min: 15, warning_max: 45 },
          missing_policy: 'REQUIRED',
          status: 'ACTIVE',
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z'
        },
        {
          variable_id: 'VAR_AGE_YEARS',
          name: 'Age in Completed Years',
          description: 'Chronological age in completed solar years at time of recruitment.',
          datatype: 'NUMBER',
          unit: 'yr',
          dimension: 'time',
          semantic_type: 'DISCRETE',
          category: 'DEMOGRAPHIC',
          required: true,
          allowed_range: { min: 18, max: 100 },
          missing_policy: 'REQUIRED',
          status: 'ACTIVE',
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z'
        },
        {
          variable_id: 'VAR_SYSTOLIC_BP',
          name: 'Systolic Blood Pressure',
          description: 'Resting seated systolic blood pressure measured in standardized clinical setting.',
          datatype: 'NUMBER',
          unit: 'mmHg',
          dimension: 'pressure',
          semantic_type: 'CONTINUOUS',
          category: 'PHYSIOLOGICAL',
          required: false,
          allowed_range: { min: 60, max: 260, warning_min: 90, warning_max: 180 },
          missing_policy: 'OPTIONAL',
          status: 'ACTIVE',
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z'
        },
        {
          variable_id: 'VAR_INTERVENTION_ARM',
          name: 'Intervention Arm Assignment',
          description: 'Categorical study treatment arm assignment.',
          datatype: 'CATEGORICAL',
          categories: ['CONTROL', 'LOW_FIBER', 'HIGH_SOLUBLE_FIBER'],
          semantic_type: 'NOMINAL',
          category: 'OTHER',
          required: false,
          missing_policy: 'OPTIONAL',
          status: 'ACTIVE',
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z'
        }
      ];

      for (const v of defaultVars) {
        try {
          this.variableStore.create(v);
        } catch {
          // ignore if already present
        }
      }
    }

    // 2. Seed Dataset & Versions & Artifacts if empty
    if (this.versionStore.list().length === 0) {
      const datasetId1 = 'DS_GLYCEMIC_COHORT_2026';
      const versionId1 = 'DSV_GLYCEMIC_V1';

      try {
        const ds1 = createDataset({
          dataset_id: datasetId1,
          name: 'Glycemic Biomarker Cohort Dataset',
          description: 'Prospective observational study on dietary fiber and glycemic variability.',
          purpose: 'RESEARCH',
          source: {
            type: 'PRIMARY_COLLECTION',
            name: 'NutriBodySim Prospective Ingest'
          },
          status: 'ACTIVE',
          sensitivity: 'RESTRICTED',
          owner_id: 'LEAD_INVESTIGATOR',
          context: {
            research_context: 'Glycemic Biomarker Cohort'
          }
        });
        this.datasetStore.create(ds1);
      } catch {
        // ignore if already present
      }

      try {
        const v1 = createDatasetVersion({
          version_id: versionId1,
          dataset_id: datasetId1,
          version_number: 1,
          version_tag: 'v1.0.0-sealed',
          created_by: 'DATA_STEWARD',
          record_count: 120,
          column_count: 6,
          status: 'SEALED',
          description: 'Baseline sealed release of Glycemic Biomarker Cohort'
        });
        this.versionStore.create(v1);
      } catch {
        // ignore if already present
      }

      // Root RAW Artifact
      const rawArtifactId = 'ART_GLYCEMIC_RAW_01';
      try {
        const rawArt = createDataArtifact({
          artifact_id: rawArtifactId,
          dataset_version_id: versionId1,
          state: 'RAW',
          created_by: 'DATA_STEWARD',
          record_count: 120,
          column_count: 6,
          description: 'Raw observational glycemic cohort ingest'
        });
        this.artifactStore.create(rawArt);
      } catch {
        // ignore
      }

      // Analysis Ready Artifact (Lineage from RAW)
      const analysisArtifactId = 'ART_GLYCEMIC_ANALYSIS_READY_01';
      try {
        const readyArt = createDataArtifact({
          artifact_id: analysisArtifactId,
          dataset_version_id: versionId1,
          state: 'ANALYSIS_READY',
          parent_artifact_id: rawArtifactId,
          created_by: 'DATA_STEWARD',
          record_count: 118,
          column_count: 6,
          description: 'Cleaned and validated analysis-ready cohort artifact'
        });
        this.artifactStore.create(readyArt);
      } catch {
        // ignore
      }
    }
  }
}

// Global default workspace service instance
export const defaultResearchWorkspaceService = new ResearchWorkspaceService();
