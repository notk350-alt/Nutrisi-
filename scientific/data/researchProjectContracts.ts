/**
 * Phase E — Scientific Data Layer: Research Workflow & Reproducible Research Project Contracts
 *
 * Defines strongly typed contracts for:
 * 1. ResearchProject (container binding questions, designs, hypotheses, datasets, plans, executions, results, interpretations, reports)
 * 2. Research Questions, Study Designs, Objectives, and Hypotheses
 * 3. Dataset & Variable Planning
 * 4. Planned vs Executed Analysis & Plan Deviations
 * 5. Power Planning & Result Bindings
 * 6. Cryptographic Provenance & Strict Lifecycle Management
 *
 * Invariants:
 * - Zero dynamic code execution (no eval, no new Function)
 * - Deep immutability & defensive cloning
 * - Strict lifecycle transitions (no skipping)
 * - Version pinning & cross-version rejection
 * - Scientific validity remains 'NOT_ESTABLISHED'
 * - Observational / study design metadata never proves causality
 */

import { deepFreeze } from './dataStatePipeline';

export type ProjectStatus =
  | 'DRAFT'
  | 'PLANNED'
  | 'DATA_BOUND'
  | 'ANALYSIS_READY'
  | 'EXECUTING'
  | 'ANALYZED'
  | 'INTERPRETED'
  | 'REPORT_READY'
  | 'FINALIZED'
  | 'ARCHIVED';

export type StudyDesignType =
  | 'OBSERVATIONAL'
  | 'EXPERIMENTAL'
  | 'QUASI_EXPERIMENTAL'
  | 'CROSS_SECTIONAL'
  | 'COHORT'
  | 'CASE_CONTROL'
  | 'RANDOMIZED_CONTROLLED'
  | 'REPEATED_MEASURES'
  | 'OTHER';

export interface StudyDesign {
  design_type: StudyDesignType;
  description: string;
  blinding?: 'NONE' | 'SINGLE' | 'DOUBLE' | 'TRIPLE';
  randomization?: boolean;
  temporal_direction?: 'PROSPECTIVE' | 'RETROSPECTIVE' | 'CROSS_SECTIONAL';
  population?: string;
  setting?: string;
  metadata?: Record<string, unknown>;
}

export type ResearchQuestionPriority = 'PRIMARY' | 'SECONDARY' | 'EXPLORATORY';

export type ResearchQuestionStatus = 'ACTIVE' | 'ANSWERED' | 'INCONCLUSIVE' | 'ABANDONED';

export interface ResearchQuestion {
  question_id: string;
  question_text: string;
  priority: ResearchQuestionPriority;
  objective_ids: string[];
  status: ResearchQuestionStatus;
  created_at?: string;
}

export type ObjectiveType = 'PRIMARY_OBJECTIVE' | 'SECONDARY_OBJECTIVE' | 'EXPLORATORY_OBJECTIVE';

export interface ResearchObjective {
  objective_id: string;
  type: ObjectiveType;
  description: string;
  target_variables?: string[];
  status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
}

export type HypothesisDirection = 'TWO_SIDED' | 'GREATER' | 'LESS';

export interface ResearchHypothesis {
  hypothesis_id: string;
  question_id: string;
  objective_id: string;
  null_hypothesis: string;
  alternative_hypothesis: string;
  direction: HypothesisDirection;
  status: 'PROPOSED' | 'TESTED' | 'SUPPORTED' | 'REJECTED' | 'INCONCLUSIVE';
  planned_alpha?: number;
}

export interface DatasetBinding {
  dataset_version_id: string;
  data_artifact_id: string;
  source_artifact_checksum: string;
  bound_at: string;
  binding_notes?: string;
}

export type VariableRole =
  | 'OUTCOME'
  | 'EXPOSURE'
  | 'PREDICTOR'
  | 'COVARIATE'
  | 'GROUPING'
  | 'PAIRING'
  | 'TIME'
  | 'STRATIFICATION'
  | 'OTHER';

export interface PlannedVariable {
  variable_id: string;
  role: VariableRole;
  rationale?: string;
  transformation?: string;
  expected_unit?: string;
}

export type PlannedAnalysisType =
  | 'DESCRIPTIVE'
  | 'INFERENTIAL'
  | 'REGRESSION'
  | 'POWER'
  | 'POWER_ANALYSIS'
  | 'NONPARAMETRIC'
  | 'NON_PARAMETRIC'
  | 'VISUALIZATION'
  | 'REPORT';

export type AnalysisPlanType =
  | 'DESCRIPTIVE'
  | 'INFERENTIAL'
  | 'REGRESSION'
  | 'POWER_ANALYSIS'
  | 'NON_PARAMETRIC';

export type PlannedAnalysisStatus = 'PLANNED' | 'EXECUTED' | 'SKIPPED' | 'DEVIATED';
export type AnalysisPlanStatus = 'PLANNED';

export interface AnalysisPlanContract {
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
  status: AnalysisPlanStatus;
}

export interface PlannedAnalysis {
  analysis_id: string;
  objective_id: string;
  hypothesis_id?: string;
  analysis_type: PlannedAnalysisType;
  input_variables: string[];
  input_variable_ids?: string[];
  grouping_variable?: string;
  grouping_variable_ids?: string[];
  pairing_variable?: string;
  pairing_variable_ids?: string[];
  alpha?: number;
  confidence_level?: number;
  configuration?: Record<string, unknown>;
  planned_rationale: string;
  status: PlannedAnalysisStatus;
}

export type DeviationType =
  | 'PARAMETER_MISMATCH'
  | 'VARIABLE_SUBSTITUTION'
  | 'METHOD_CHANGE'
  | 'DATA_RESTRICTION'
  | 'UNPLANNED_ANALYSIS'
  | 'ANALYSIS_OMITTED'
  | 'ALPHA_ADJUSTMENT'
  | 'OTHER';

export interface PlanDeviation {
  deviation_id: string;
  planned_analysis_id: string;
  executed_analysis_id?: string;
  deviation_type: DeviationType;
  reason: string;
  timestamp: string;
  user: string;
  resulting_execution_reference?: string;
}

export interface PlannedPowerAnalysis {
  analysis_id: string;
  target_power: number;
  alpha: number;
  effect_size: number;
  effect_size_type?: string;
  expected_attrition?: number;
  allocation_ratio?: number;
  required_sample_size?: number;
  available_sample_size?: number;
  power_result_reference?: string;
}

export type ProjectExecutionStatus = 'SUCCESS' | 'PARTIAL' | 'FAILED';

export interface ProjectExecutionRecord {
  execution_id: string;
  project_id: string;
  project_version: string;
  dataset_version_id: string;
  data_artifact_id: string;
  source_artifact_checksum: string;
  analysis_plan_version: string;
  engine_versions: Record<string, string>;
  started_at: string;
  completed_at: string;
  status: ProjectExecutionStatus;
  executed_analyses: string[];
  result_references: string[];
  deviations: PlanDeviation[];
  warnings: string[];
  provenance_hash: string;
}

export interface ResultBindings {
  d9_results: string[];
  d10_results: string[];
  d11_results: string[];
  d12_results: string[];
  d13_results: string[];
}

export interface VisualizationBindings {
  visualization_ids: string[];
}

export interface InterpretationBindings {
  interpretation_ids: string[];
  profile_ids: string[];
  rule_ids: string[];
}

export interface EvidenceBindings {
  evidence_trace_ids: string[];
}

export interface ReportBinding {
  report_ids: string[];
}

export interface ResearchProject {
  project_id: string;
  project_version: string;
  parent_version?: string | null;
  title: string;
  description: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  status: ProjectStatus;
  study_design: StudyDesign;
  research_questions: ResearchQuestion[];
  objectives: ResearchObjective[];
  hypotheses: ResearchHypothesis[];
  dataset_binding?: DatasetBinding;
  variable_plan: PlannedVariable[];
  analysis_plan: PlannedAnalysis[];
  power_plan: PlannedPowerAnalysis[];
  plan_deviations: PlanDeviation[];
  execution_history: ProjectExecutionRecord[];
  result_bindings: ResultBindings;
  visualization_bindings: VisualizationBindings;
  interpretation_bindings: InterpretationBindings;
  evidence_bindings: EvidenceBindings;
  report_bindings: ReportBinding;
  metadata?: Record<string, unknown>;
  provenance_hash: string;
  scientific_validity: 'NOT_ESTABLISHED';
  engine_version: string;
}

export type ProjectErrorCode =
  | 'PROJECT_INVALID_CONTRACT'
  | 'PROJECT_INVALID_LIFECYCLE_TRANSITION'
  | 'PROJECT_DATASET_NOT_FOUND'
  | 'PROJECT_ARTIFACT_NOT_FOUND'
  | 'PROJECT_VERSION_MISMATCH'
  | 'PROJECT_CHECKSUM_MISMATCH'
  | 'PROJECT_IMMUTABILITY_VIOLATION'
  | 'PROJECT_ANALYSIS_NOT_FOUND'
  | 'PROJECT_VARIABLE_NOT_FOUND'
  | 'PROJECT_PLAN_DEVIATION_UNRESOLVED'
  | 'PROJECT_NOT_FOUND'
  | 'PROJECT_ALREADY_EXISTS'
  | 'PROJECT_EXECUTION_FAILED'
  | 'PROJECT_UNAUTHORIZED';

export class ScientificProjectError extends Error {
  readonly code: ProjectErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: ProjectErrorCode, message: string, details?: Record<string, unknown>) {
    super(`[${code}] ${message}`);
    this.name = 'ScientificProjectError';
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, ScientificProjectError.prototype);
  }
}

/**
 * Valid transitions map for strict project lifecycle.
 */
export const ALLOWED_PROJECT_LIFECYCLE_TRANSITIONS: ReadonlyMap<ProjectStatus, ReadonlySet<ProjectStatus>> = new Map([
  ['DRAFT', new Set<ProjectStatus>(['PLANNED', 'ARCHIVED'])],
  ['PLANNED', new Set<ProjectStatus>(['DATA_BOUND', 'DRAFT', 'ARCHIVED'])],
  ['DATA_BOUND', new Set<ProjectStatus>(['ANALYSIS_READY', 'PLANNED', 'ARCHIVED'])],
  ['ANALYSIS_READY', new Set<ProjectStatus>(['EXECUTING', 'DATA_BOUND', 'ARCHIVED'])],
  ['EXECUTING', new Set<ProjectStatus>(['ANALYZED', 'ANALYSIS_READY', 'ARCHIVED'])],
  ['ANALYZED', new Set<ProjectStatus>(['INTERPRETED', 'EXECUTING', 'ARCHIVED'])],
  ['INTERPRETED', new Set<ProjectStatus>(['REPORT_READY', 'ANALYZED', 'ARCHIVED'])],
  ['REPORT_READY', new Set<ProjectStatus>(['FINALIZED', 'INTERPRETED', 'ARCHIVED'])],
  ['FINALIZED', new Set<ProjectStatus>(['ARCHIVED'])],
  ['ARCHIVED', new Set<ProjectStatus>()]
]);

/**
 * Validates structural integrity of a ResearchProject contract.
 */
export function validateResearchProject(project: ResearchProject): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!project || typeof project !== 'object') {
    throw new ScientificProjectError('PROJECT_INVALID_CONTRACT', 'ResearchProject must be a non-null object');
  }

  if (!project.project_id || typeof project.project_id !== 'string') {
    errors.push('project_id is required and must be a string');
  }

  if (!project.project_version || typeof project.project_version !== 'string') {
    errors.push('project_version is required and must be a string');
  }

  if (!project.title || typeof project.title !== 'string') {
    errors.push('title is required and must be a non-empty string');
  }

  if (!project.study_design || typeof project.study_design !== 'object' || !project.study_design.design_type) {
    errors.push('study_design with design_type is required');
  }

  if (!Array.isArray(project.research_questions)) {
    errors.push('research_questions must be an array');
  }

  if (!Array.isArray(project.objectives)) {
    errors.push('objectives must be an array');
  }

  if (!Array.isArray(project.hypotheses)) {
    errors.push('hypotheses must be an array');
  }

  if (!Array.isArray(project.variable_plan)) {
    errors.push('variable_plan must be an array');
  }

  if (!Array.isArray(project.analysis_plan)) {
    errors.push('analysis_plan must be an array');
  }

  if (!Array.isArray(project.power_plan)) {
    errors.push('power_plan must be an array');
  }

  if (!Array.isArray(project.plan_deviations)) {
    errors.push('plan_deviations must be an array');
  }

  if (!Array.isArray(project.execution_history)) {
    errors.push('execution_history must be an array');
  }

  if (!project.result_bindings || typeof project.result_bindings !== 'object') {
    errors.push('result_bindings object is required');
  }

  if (!project.visualization_bindings || typeof project.visualization_bindings !== 'object') {
    errors.push('visualization_bindings object is required');
  }

  if (!project.interpretation_bindings || typeof project.interpretation_bindings !== 'object') {
    errors.push('interpretation_bindings object is required');
  }

  if (!project.evidence_bindings || typeof project.evidence_bindings !== 'object') {
    errors.push('evidence_bindings object is required');
  }

  if (!project.report_bindings || typeof project.report_bindings !== 'object') {
    errors.push('report_bindings object is required');
  }

  if (project.scientific_validity !== 'NOT_ESTABLISHED') {
    errors.push("scientific_validity must strictly be 'NOT_ESTABLISHED'");
  }

  // Lifecycle-specific gate checks
  if (project.status === 'PLANNED') {
    if (project.research_questions.length === 0) {
      errors.push('Status PLANNED requires at least one research question');
    }
    if (project.objectives.length === 0) {
      errors.push('Status PLANNED requires at least one research objective');
    }
  }

  if (project.status === 'DATA_BOUND' || project.status === 'ANALYSIS_READY' || project.status === 'EXECUTING' || project.status === 'ANALYZED' || project.status === 'INTERPRETED' || project.status === 'REPORT_READY' || project.status === 'FINALIZED') {
    if (!project.dataset_binding?.dataset_version_id || !project.dataset_binding?.data_artifact_id) {
      errors.push(`Status '${project.status}' requires an active dataset_binding with dataset_version_id and data_artifact_id`);
    }
  }

  if (project.status === 'ANALYSIS_READY') {
    if (project.variable_plan.length === 0) {
      errors.push('Status ANALYSIS_READY requires at least one variable in variable_plan');
    }
    if (project.analysis_plan.length === 0) {
      errors.push('Status ANALYSIS_READY requires at least one planned analysis in analysis_plan');
    }
  }

  if (errors.length > 0) {
    throw new ScientificProjectError('PROJECT_INVALID_CONTRACT', `ResearchProject contract validation failed: ${errors.join('; ')}`, { errors });
  }

  return { valid: true, errors: [] };
}

/**
 * Creates a validated, deep-frozen ResearchProject.
 */
export function createResearchProject(project: ResearchProject): ResearchProject {
  validateResearchProject(project);
  return deepFreeze({
    ...project,
    scientific_validity: 'NOT_ESTABLISHED'
  });
}
