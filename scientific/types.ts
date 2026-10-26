/**
 * NutriBodySim — Scientific Types and Abstract Syntax Tree (AST) Definitions
 * 
 * Strict architectural rule: Separates Platform Engine from Scientific Content.
 * Formulas are not hardcoded in the UI; they are represented as executable AST nodes.
 */

export type DataType = 'number' | 'integer' | 'boolean' | 'string' | 'vector' | 'matrix';

export type MeasurementType = 
  | 'mass'
  | 'length'
  | 'time'
  | 'energy'
  | 'volume'
  | 'temperature'
  | 'percentage'
  | 'concentration'
  | 'ratio'
  | 'pressure'
  | 'dimensionless';

export type RegistryStatus = 
  | 'DRAFT'
  | 'UNDER_REVIEW'
  | 'VALIDATED'
  | 'VALIDATION'
  | 'VERIFIED'
  | 'EXPERIMENTAL'
  | 'DEPRECATED';

export interface ScientificUnit {
  unit_id: string;
  symbol: string;
  name: string;
  measurement_type: MeasurementType;
  base_unit: string;
  to_base_multiplier: number; // base = value * multiplier + offset
  to_base_offset?: number;
  description?: string;
}

export interface AllowedRange {
  min?: number;
  max?: number;
  min_inclusive?: boolean;
  max_inclusive?: boolean;
  warning_min?: number;
  warning_max?: number;
}

export interface ScientificVariable {
  variable_id: string;
  name: string;
  label: string;
  definition: string;
  datatype: DataType;
  unit: string; // unit symbol or unit_id
  measurement_type: MeasurementType;
  allowed_range?: AllowedRange;
  population?: string;
  source_reference?: string;
  version: string;
  status: RegistryStatus;
  created_at: string;
  updated_at: string;
}

export interface ScientificParameter {
  parameter_id: string;
  name: string;
  description: string;
  value: number | string | boolean | number[];
  unit: string;
  valid_range?: AllowedRange;
  population?: string;
  reference_ids: string[];
  version: string;
  status: RegistryStatus;
  is_constant: boolean;
  created_at: string;
  updated_at: string;
}

export interface ScientificReference {
  reference_id: string;
  title: string;
  authors: string[];
  year: number;
  journal_or_publisher?: string;
  doi?: string;
  pmid?: string;
  url?: string;
  citation_key: string;
  abstract?: string;
  license?: string;
  created_at?: string;
}

// AST Expression Nodes for Structured Formulas
export type OperatorType = 
  | 'ADD'
  | 'SUBTRACT'
  | 'MULTIPLY'
  | 'DIVIDE'
  | 'POWER'
  | 'SQRT'
  | 'LOG'
  | 'EXP'
  | 'ABS'
  | 'MIN'
  | 'MAX';

export type ASTNode = 
  | { type: 'CONSTANT'; value: number; unit?: string }
  | { type: 'VARIABLE'; variable_id: string; expected_unit?: string }
  | { type: 'PARAMETER'; parameter_id: string; expected_unit?: string }
  | { type: 'OPERATOR'; op: OperatorType; args: ASTNode[] }
  | { 
      type: 'CONDITION'; 
      condition: { left: ASTNode; op: '==' | '!=' | '<' | '<=' | '>' | '>='; right: ASTNode };
      then_branch: ASTNode;
      else_branch: ASTNode;
    };

export type ScientificModuleType = 
  | 'FORMULA' 
  | 'ALGORITHM' 
  | 'MODEL' 
  | 'INTERPRETATION' 
  | 'CALCULATOR';

export interface ScientificModuleBase {
  module_id: string;
  module_type: ScientificModuleType;
  name: string;
  description: string;
  version: string;
  status: RegistryStatus;
  created_by: string;
  created_at: string;
  updated_at: string;
  assumptions?: string[];
  limitations?: string[];
  reference_ids?: string[];
}

export interface InterpretationThreshold {
  label: string;
  min?: number;
  max?: number;
  min_inclusive?: boolean;
  max_inclusive?: boolean;
  clinical_status: string;
  badge_color: string;
  description: string;
}

export interface InterpretationRule extends ScientificModuleBase {
  rule_id: string; // primary identifier (equals module_id)
  target_variable_or_metric: string;
  unit: string;
  population?: string;
  thresholds: InterpretationThreshold[];
}

export type MissingPolicy = 
  | 'REQUIRED'
  | 'OPTIONAL'
  | 'IGNORE'
  | 'DEFAULT'
  | 'FALLBACK'
  | 'ERROR';

export interface FormulaInputSpec {
  variable_id: string;
  name: string;
  unit: string;
  required: boolean;
  default_value?: number;
  description?: string;
  datatype?: DataType;
  missing_policy?: MissingPolicy;
  allowed_range?: AllowedRange;
}

export interface ValidationDetail {
  variable_id: string;
  name: string;
  status: 'VALID' | 'WARNING' | 'ERROR' | 'DEFAULT_APPLIED' | 'SKIPPED' | 'FALLBACK_SIGNAL';
  message?: string;
  original_value?: unknown;
  original_unit?: string;
  normalized_value?: number | string | boolean;
  normalized_unit?: string;
}

export interface InputValidationResult {
  valid: boolean;
  normalized_inputs: Record<string, { value: number; unit: string; original_unit?: string }>;
  warnings: string[];
  errors: string[];
  fallback_required: boolean;
  validation_details: Record<string, ValidationDetail>;
}


export interface FormulaOutputSpec {
  variable_id?: string;
  name: string;
  unit: string;
  datatype: DataType;
  description?: string;
}

export interface ScientificFormula {
  module_id?: string;
  module_type?: ScientificModuleType;
  formula_id: string;
  name: string;
  description: string;
  version: string;
  status: RegistryStatus;
  inputs: FormulaInputSpec[];
  outputs: FormulaOutputSpec[];
  parameter_ids: string[];
  expression_ast: ASTNode;
  expression_string: string; // readable representation, e.g. "weight / (height ^ 2)"
  reference_ids: string[];
  assumptions: string[];
  limitations: string[];
  validation_status: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export type AlgorithmOperation = 
  | 'SEQUENCE'
  | 'CONDITION'
  | 'BRANCH'
  | 'FALLBACK'
  | 'FORMULA_REFERENCE'
  | 'OUTPUT';

export interface AlgorithmOperand {
  type: 'input' | 'intermediate' | 'parameter' | 'constant';
  key?: string;
  value?: number | string | boolean;
}

export interface AlgorithmCondition {
  expression?: ASTNode;
  left_operand?: AlgorithmOperand;
  operator?: '==' | '!=' | '<' | '<=' | '>' | '>=';
  right_operand?: AlgorithmOperand;
  true_step_id: string;
  false_step_id: string;
}

export interface AlgorithmFormulaReference {
  formula_id: string;
  version?: string;
  input_mapping?: Record<string, string>;
  output_variable_id?: string;
}

export interface AlgorithmFallbackRoute {
  condition_signal?: 'FALLBACK_REQUIRED' | 'STEP_FAILURE';
  source_step_id?: string;
  target_step_id: string;
  description?: string;
}

export interface AlgorithmStep {
  step_id: string;
  step_number?: number;
  name?: string;
  description?: string;
  operation?: AlgorithmOperation;
  next_step_id?: string;
  condition?: AlgorithmCondition;
  branch?: {
    condition: AlgorithmCondition;
  };
  formula_reference?: AlgorithmFormulaReference;
  formula_id?: string;
  transformation_logic?: string;
  fallback_step_id?: string;
  output_mapping?: Record<string, string>;
  is_terminal?: boolean;
}

export interface ScientificAlgorithm {
  module_id?: string;
  module_type?: ScientificModuleType;
  algorithm_id: string;
  name: string;
  description: string;
  version: string;
  inputs: FormulaInputSpec[];
  outputs: FormulaOutputSpec[];
  parameter_ids: string[];
  entry_step_id?: string;
  steps: AlgorithmStep[];
  fallback_routes?: AlgorithmFallbackRoute[];
  reference_ids: string[];
  status: RegistryStatus;
  assumptions?: string[];
  limitations?: string[];
  validation_status?: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface ModelStateVariable {
  state_id: string;
  name: string;
  datatype: DataType;
  unit: string;
  dimension?: string;
  initial_value: number;
  description?: string;
  min?: number;
  max?: number;
}

export interface ModelTimeConfig {
  start_time: number;
  dt: number;
  steps: number;
  max_steps?: number;
}

export type ModelTransitionType = 'EXPLICIT_UPDATE' | 'DERIVATIVE_EULER' | 'AST_EXPRESSION';

export interface ModelTransitionDefinition {
  state_id: string;
  type?: ModelTransitionType;
  expression_ast?: ASTNode;
  expression_string?: string;
  description?: string;
}

export interface ModelStateHistoryEntry {
  step: number;
  time: number;
  state: Record<string, number>;
  inputs?: Record<string, number>;
  intermediate?: Record<string, unknown>;
}

export interface ScientificModel {
  module_id?: string;
  module_type?: ScientificModuleType;
  model_id: string;
  name: string;
  description: string;
  version: string;
  status: RegistryStatus;
  is_verified: boolean;
  parent_model_id?: string; // For experimental clones
  variable_ids: string[];
  formula_ids?: string[];
  algorithm_ids?: string[];
  parameter_ids: string[];
  reference_ids: string[];
  assumptions: string[];
  validation_criteria?: string;
  changed_notes?: string;

  // Phase C5: Model discrete-time execution specification
  inputs?: FormulaInputSpec[];
  outputs?: FormulaOutputSpec[];
  states?: ModelStateVariable[];
  time_config?: ModelTimeConfig;
  transitions?: ModelTransitionDefinition[];

  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface TraceStep {
  step: number;
  action: string;
  detail: string;
  intermediate_value?: number | string | boolean | null;
  unit?: string;
  timestamp: string;
}

export interface CalculationTrace {
  calculation_id: string;
  user_id?: string;
  project_id?: string;
  formula_or_model_id: string;
  version: string;
  inputs_received: Record<string, { value: number | string; unit: string }>;
  normalized_inputs: Record<string, { value: number; unit: string; original_unit: string }>;
  parameters_resolved: Record<string, { value: number | string; unit: string }>;
  steps: TraceStep[];
  final_result: Record<string, { value: number | string; unit: string }>;
  explanation: string;
  provenance_hash: string;
  created_at: string;
}

/**
 * Formal request contract for executing a scientific module (formula, algorithm, or model).
 * Pure scientific boundary: Framework-independent, zero DOM/browser/DB coupling.
 */
export interface ModuleRequest {
  /** Required unique identifier of the target scientific module */
  module_id: string;

  /** Optional requested semantic version. If omitted, latest active/verified version is used. */
  requested_version?: string;

  /** Required input variable values and optional client-specified units */
  inputs: Record<string, { value: number | string | boolean; unit?: string }>;

  /** Optional parameter set identifier (for preset or customized parameter bundles) */
  parameter_set_id?: string;

  /** Optional dataset version identifier for dataset-bound calculations */
  dataset_version_id?: string;

  /** Optional runtime configuration overrides (e.g. numerical tolerances, flags) */
  configuration?: Record<string, unknown>;

  /** Optional contextual metadata (user ID, project ID, client timestamp, environment) */
  execution_context?: {
    user_id?: string;
    project_id?: string;
    client_timestamp?: string;
    environment?: string;
    [key: string]: unknown;
  };
}

/**
 * Standardized scientific trace step conforming to the locked Phase C target architecture.
 */
export interface StandardTraceStep {
  /** Deterministic unique identifier of the execution trace step */
  step_id: string;

  /** Human- and machine-readable operation name (e.g. 'INPUT_NORMALIZATION', 'AST_OP', 'PROVENANCE_SEAL') */
  operation: string;

  /** Optional step-specific input values */
  inputs?: Record<string, unknown>;

  /** Optional step-specific parameter values */
  parameters?: Record<string, unknown>;

  /** Intermediate or final computed value of the operation */
  output?: unknown;

  /** Physical or clinical measurement unit of the output */
  unit?: string;

  /** ISO 8601 UTC timestamp of step execution */
  timestamp: string;

  /** Contextual step metadata (detailed explanation, rule IDs, AST node references) */
  metadata?: Record<string, unknown>;
}

/**
 * Validation execution summary block within ExecutionResult.
 * Truthfully reports validation status without inventing synthetic profiles.
 */
export interface ExecutionValidationSummary {
  status: 'VALIDATED' | 'UNVALIDATED' | 'FAILED';
  profile?: string;
  message?: string;
  checks?: Array<{ name: string; passed: boolean; message?: string }>;
}

/**
 * Standardized execution result produced by the Scientific Execution Engine.
 * Conforms to the locked Phase C target architecture.
 */
export interface ExecutionResult {
  /** Unique identifier of this execution run */
  execution_id: string;

  /** Module identifier executed */
  module_id: string;

  /** Exact resolved version of the module executed */
  module_version: string;

  /** Original inputs received prior to normalization */
  inputs: Record<string, { value: number | string | boolean; unit?: string }>;

  /** Canonical normalized input values ready for scientific evaluation */
  normalized_inputs: Record<string, { value: number; unit: string; original_unit?: string }>;

  /** Parameter values resolved and utilized in calculation */
  parameters: Record<string, unknown>;

  /** Parameter versions pinned for this execution (if available) */
  parameter_versions?: Record<string, string>;

  /** Optional parameter set identifier used in resolution */
  parameter_set_id?: string;

  /** Immutable snapshot of parameters resolved for this execution */
  parameter_snapshot?: ParameterSnapshot;

  /** Ordered list of executed engine paths/phases */
  execution_path: string[];

  /** Whether an algorithmic or parameter fallback branch was taken */
  fallback_used: boolean;

  /** Intermediate evaluation artifacts indexed by node/step name */
  intermediate_results: Record<string, unknown>;

  /** Standardized step-by-step scientific audit trace */
  trace: StandardTraceStep[];

  /** Final calculated outputs with verified units */
  outputs: Record<string, { value: number | string | boolean; unit?: string }>;

  /** Non-fatal warnings encountered during validation or computation */
  warnings: string[];

  /** Fatal or non-fatal error descriptions */
  errors: string[];

  /** Validation status block (truthfully reports UNVALIDATED if runtime validation engine is inactive) */
  validation?: ExecutionValidationSummary;

  /** Model-specific discrete-time state history (Phase C5) */
  state_history?: ModelStateHistoryEntry[];

  /** Start time of model simulation (Phase C5) */
  start_time?: number;

  /** Delta time step size (Phase C5) */
  dt?: number;

  /** Total executed simulation steps (Phase C5) */
  steps?: number;

  /** ISO 8601 timestamp of execution completion */
  timestamp: string;

  /** Cryptographic provenance identifier sealing this execution */
  provenance_id?: string;
}

/**
 * Parameter set item specification in a ParameterSet bundle.
 */
export interface ParameterSetItem {
  parameter_id: string;
  parameter_version?: string;
  value_override?: number | string | boolean | number[];
}

/**
 * ParameterSet bundle contract representing a curated or customized group of parameters.
 */
export interface ParameterSet {
  set_id: string;
  name: string;
  description: string;
  version: string;
  status: RegistryStatus;
  module_id?: string;
  parameters: Record<string, ParameterSetItem>;
  created_at: string;
  updated_at: string;
}

/**
 * Snapshot entry capturing exact identity, version, value, and metadata of a parameter used in execution.
 */
export interface ParameterSnapshotEntry {
  parameter_id: string;
  parameter_version: string;
  name: string;
  value: number | string | boolean | number[];
  unit?: string;
  reference_ids?: string[];
  status?: RegistryStatus;
  is_constant?: boolean;
}

/**
 * Immutable snapshot of all parameters resolved and frozen at execution start.
 */
export interface ParameterSnapshot {
  snapshot_id: string;
  timestamp: string;
  parameter_set_id?: string;
  entries: Record<string, ParameterSnapshotEntry>;
}

/**
 * Structured error codes for scientific module and parameter resolution.
 */
export type ResolverErrorCode = 
  | 'MODULE_NOT_FOUND'
  | 'MODULE_VERSION_NOT_FOUND'
  | 'MODULE_VERSION_NOT_EXECUTABLE'
  | 'MODULE_RESOLUTION_AMBIGUOUS'
  | 'PARAMETER_SET_NOT_FOUND'
  | 'PARAMETER_VERSION_NOT_FOUND'
  | 'PARAMETER_REQUIRED_MISSING'
  | 'PARAMETER_RESOLUTION_AMBIGUOUS';

/**
 * ScientificResolverError: Error class for Module and Parameter resolution failures.
 */
export class ScientificResolverError extends Error {
  readonly code: ResolverErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: ResolverErrorCode, message: string, details?: Record<string, unknown>) {
    super(`[${code}] ${message}`);
    this.name = 'ScientificResolverError';
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, ScientificResolverError.prototype);
  }
}

/**
 * Structured error codes for scientific algorithm execution.
 */
export type AlgorithmErrorCode = 
  | 'ALGORITHM_NOT_FOUND'
  | 'ALGORITHM_INVALID'
  | 'STEP_NOT_FOUND'
  | 'CONDITION_INVALID'
  | 'BRANCH_TARGET_INVALID'
  | 'FALLBACK_TARGET_INVALID'
  | 'FORMULA_REFERENCE_INVALID'
  | 'EXECUTION_CYCLE_DETECTED'
  | 'STEP_EXECUTION_FAILED'
  | 'NO_FALLBACK_DEFINED';

/**
 * ScientificAlgorithmError: Error class for Algorithm execution failures.
 */
export class ScientificAlgorithmError extends Error {
  readonly code: AlgorithmErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: AlgorithmErrorCode, message: string, details?: Record<string, unknown>) {
    super(`[${code}] ${message}`);
    this.name = 'ScientificAlgorithmError';
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, ScientificAlgorithmError.prototype);
  }
}

/**
 * Structured error codes for scientific dynamical model execution.
 */
export type ModelErrorCode =
  | 'MODEL_NOT_FOUND'
  | 'MODEL_INVALID'
  | 'INITIAL_STATE_INVALID'
  | 'STATE_VARIABLE_INVALID'
  | 'TRANSITION_INVALID'
  | 'MODEL_TRANSITION_FAILED'
  | 'MODEL_STEP_LIMIT_EXCEEDED'
  | 'MODEL_NUMERICAL_ERROR'
  | 'MODEL_TIME_CONFIGURATION_INVALID'
  | 'MODEL_VERSION_NOT_FOUND';

/**
 * ScientificModelError: Error class for Scientific Model discrete-time execution failures.
 */
export class ScientificModelError extends Error {
  readonly code: ModelErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: ModelErrorCode, message: string, details?: Record<string, unknown>) {
    super(`[${code}] ${message}`);
    this.name = 'ScientificModelError';
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, ScientificModelError.prototype);
  }
}

/**
 * Phase C6: Scientific Validation Engine Types and Contracts
 */

export type ValidationType =
  | 'STRUCTURAL'
  | 'MATHEMATICAL'
  | 'UNIT'
  | 'BOUNDARY'
  | 'EDGE_CASE'
  | 'REGRESSION'
  | 'REFERENCE_COMPARISON'
  | 'SENSITIVITY'
  | 'DATASET_VALIDATION';

export type ValidationStatus =
  | 'PASS'
  | 'FAIL'
  | 'WARNING'
  | 'UNESTABLISHED'
  | 'NOT_CONFIGURED';

export type ValidationSeverity = 'INFO' | 'WARNING' | 'ERROR';

export interface ValidationCheck {
  check_id: string;
  name: string;
  type: ValidationType;
  description?: string;
  configuration?: Record<string, unknown>;
  severity?: ValidationSeverity;
}

export interface ValidationProfile {
  validation_id: string;
  name: string;
  version: string;
  type?: ValidationType;
  description?: string;
  checks: ValidationCheck[];
  references?: string[];
  scope?: string;
  status?: RegistryStatus | string;
}

export interface ValidationCheckResult {
  check_id: string;
  name?: string;
  type: ValidationType;
  status: ValidationStatus;
  severity?: ValidationSeverity;
  expected?: unknown;
  observed?: unknown;
  message: string;
  evidence?: Record<string, unknown>;
}

export interface ValidationSummary {
  total: number;
  passed: number;
  failed: number;
  warnings: number;
  unestablished: number;
  not_configured: number;
}

export interface ValidationResult {
  validation_id: string;
  validation_version: string;
  status: ValidationStatus;
  checks: ValidationCheckResult[];
  summary: ValidationSummary;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export type ValidationErrorCode =
  | 'VALIDATION_PROFILE_INVALID'
  | 'VALIDATION_CHECK_INVALID'
  | 'EXECUTION_RESULT_INVALID'
  | 'VALIDATION_EXECUTION_FAILED';

export class ScientificValidationError extends Error {
  readonly code: ValidationErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: ValidationErrorCode, message: string, details?: Record<string, unknown>) {
    super(`[${code}] ${message}`);
    this.name = 'ScientificValidationError';
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, ScientificValidationError.prototype);
  }
}

/**
 * Phase C7: Batch Execution Engine Types and Contracts
 */

export type BatchErrorPolicy = 'FAIL_FAST' | 'CONTINUE_ON_ERROR';

export interface BatchRecord {
  record_id: string;
  inputs: Record<string, { value: unknown; unit?: string } | unknown>;
  metadata?: Record<string, unknown>;
}

export interface BatchExecutionRequest {
  batch_id: string;
  module_id: string;
  requested_version?: string;
  records: BatchRecord[];
  parameter_set_id?: string;
  dataset_version_id?: string;
  validation_profile?: ValidationProfile;
  configuration?: {
    max_records?: number;
    error_policy?: BatchErrorPolicy;
    [key: string]: unknown;
  };
  execution_context?: Record<string, unknown>;
  error_policy?: BatchErrorPolicy;
}

export type BatchRecordStatus = 'SUCCESS' | 'FAILED' | 'SKIPPED';

export interface BatchRecordResult {
  record_id: string;
  status: BatchRecordStatus;
  execution_id?: string;
  result?: ExecutionResult;
  validation?: ValidationResult;
  warnings: string[];
  errors: string[];
}

export type BatchStatus = 'COMPLETED' | 'COMPLETED_WITH_ERRORS' | 'FAILED';

export interface BatchExecutionSummary {
  total_records: number;
  successful_records: number;
  failed_records: number;
  skipped_records: number;
}

export interface BatchExecutionResult {
  batch_id: string;
  module_id: string;
  module_version: string;
  dataset_version_id?: string;
  parameter_set_id?: string;
  total_records: number;
  successful_records: number;
  failed_records: number;
  skipped_records: number;
  status: BatchStatus;
  records: BatchRecordResult[];
  summary: BatchExecutionSummary;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export type BatchErrorCode =
  | 'BATCH_INVALID_REQUEST'
  | 'BATCH_EMPTY_RECORD_ID'
  | 'BATCH_DUPLICATE_RECORD_ID'
  | 'BATCH_MODULE_NOT_FOUND'
  | 'BATCH_VERSION_RESOLUTION_FAILED'
  | 'BATCH_PARAMETER_RESOLUTION_FAILED'
  | 'BATCH_SIZE_LIMIT_EXCEEDED'
  | 'BATCH_RECORD_EXECUTION_FAILED'
  | 'BATCH_ABORTED';

export class ScientificBatchError extends Error {
  readonly code: BatchErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: BatchErrorCode, message: string, details?: Record<string, unknown>) {
    super(`[${code}] ${message}`);
    this.name = 'ScientificBatchError';
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, ScientificBatchError.prototype);
  }
}

/**
 * Phase C8: Provenance Persistence Layer Types and Contracts
 */

export interface ProvenanceIntegrity {
  algorithm: 'SHA-256';
  content_hash: string;
  signature?: string;
}

export interface ProvenanceRecord {
  provenance_id: string;
  execution_id: string;
  batch_id?: string;
  module_id: string;
  module_version: string;
  parameter_set_id?: string;
  parameter_versions?: Record<string, string>;
  parameter_snapshot?: ParameterSnapshot;
  dataset_version_id?: string;
  inputs: Record<string, { value: unknown; unit?: string } | unknown>;
  normalized_inputs: Record<string, { value: unknown; unit?: string }>;
  execution_path: string[];
  intermediate_results?: Record<string, unknown>;
  trace: StandardTraceStep[];
  outputs: Record<string, { value: number | string | boolean; unit?: string }>;
  validation?: ValidationResult | ExecutionValidationSummary;
  state_history?: ModelStateHistoryEntry[];
  execution_timestamp: string;
  created_at: string;
  integrity: ProvenanceIntegrity;
  metadata?: Record<string, unknown>;
}

export type ProvenanceVerificationStatus = 'VALID' | 'INVALID' | 'NOT_FOUND';

export interface ProvenanceVerificationResult {
  provenance_id: string;
  status: ProvenanceVerificationStatus;
  computed_hash?: string;
  stored_hash?: string;
  message?: string;
  verified_at: string;
}

export type ProvenanceAuditEventType =
  | 'PROVENANCE_CREATED'
  | 'PROVENANCE_RETRIEVED'
  | 'PROVENANCE_INTEGRITY_VERIFIED';

export interface ProvenanceAuditEvent {
  event_id: string;
  event_type: ProvenanceAuditEventType;
  provenance_id?: string;
  execution_id?: string;
  batch_id?: string;
  details?: Record<string, unknown>;
  timestamp: string;
}

export type ProvenanceErrorCode =
  | 'PROVENANCE_INVALID_PAYLOAD'
  | 'PROVENANCE_ALREADY_EXISTS'
  | 'PROVENANCE_NOT_FOUND'
  | 'PROVENANCE_TAMPERED'
  | 'PROVENANCE_CANONICALIZATION_FAILED';

export class ScientificProvenanceError extends Error {
  readonly code: ProvenanceErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: ProvenanceErrorCode, message: string, details?: Record<string, unknown>) {
    super(`[${code}] ${message}`);
    this.name = 'ScientificProvenanceError';
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, ScientificProvenanceError.prototype);
  }
}

/**
 * ============================================================================
 * PHASE D1: SCIENTIFIC DATA LAYER — DATASET CONTRACT
 * ============================================================================
 */

export type DatasetPurpose =
  | 'LEARNING'
  | 'RESEARCH'
  | 'SIMULATION'
  | 'VALIDATION'
  | 'OTHER';

export type DatasetSourceType =
  | 'PRIMARY_COLLECTION'
  | 'SECONDARY_DATA'
  | 'PUBLIC_DATASET'
  | 'SYNTHETIC'
  | 'IMPORTED'
  | 'OTHER';

export interface DatasetSource {
  type: DatasetSourceType;
  name?: string;
  description?: string;
  location?: string;
  reference?: string;
  accessed_at?: string;
}

export interface DatasetPopulation {
  description?: string;
  age_range?: { min?: number; max?: number; unit?: string } | string;
  sex_scope?: 'ALL' | 'FEMALE' | 'MALE' | 'OTHER' | string;
  geographic_scope?: string;
  sample_size?: number;
  inclusion_notes?: string;
  exclusion_notes?: string;
}

export interface DatasetContext {
  setting?: string;
  collection_method?: string;
  measurement_context?: string;
  clinical_context?: string;
  research_context?: string;
  notes?: string;
}

export interface DatasetTemporalScope {
  start_date?: string;
  end_date?: string;
  timezone?: string;
  description?: string;
}

export type DatasetSensitivity =
  | 'PUBLIC'
  | 'INTERNAL'
  | 'RESTRICTED'
  | 'SENSITIVE';

export type DatasetStatus =
  | 'DRAFT'
  | 'ACTIVE'
  | 'ARCHIVED';

export interface Dataset {
  dataset_id: string;
  name: string;
  description?: string;
  owner_id: string;
  project_id?: string;
  purpose: DatasetPurpose;
  source: DatasetSource;
  population?: DatasetPopulation;
  context?: DatasetContext;
  temporal_scope?: DatasetTemporalScope;
  sensitivity?: DatasetSensitivity;
  status: DatasetStatus;
  created_at: string;
  updated_at: string;
  metadata?: Record<string, unknown>;
}

export type DatasetErrorCode =
  | 'DATASET_INVALID_CONTRACT'
  | 'DATASET_EMPTY_ID'
  | 'DATASET_EMPTY_NAME'
  | 'DATASET_EMPTY_OWNER'
  | 'DATASET_INVALID_PURPOSE'
  | 'DATASET_INVALID_SOURCE'
  | 'DATASET_INVALID_STATUS'
  | 'DATASET_ALREADY_EXISTS'
  | 'DATASET_NOT_FOUND'
  | 'DATASET_IMMUTABLE_ID_VIOLATION';

export class ScientificDatasetError extends Error {
  readonly code: DatasetErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: DatasetErrorCode, message: string, details?: Record<string, unknown>) {
    super(`[${code}] ${message}`);
    this.name = 'ScientificDatasetError';
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, ScientificDatasetError.prototype);
  }
}

// ==========================================
// Scientific Data Layer — Phase D2: Dataset Versioning
// ==========================================

export type DatasetVersionStatus =
  | 'DRAFT'
  | 'SEALED'
  | 'ACTIVE'
  | 'DEPRECATED'
  | 'ARCHIVED';

export interface DatasetDataReference {
  storage_uri?: string;
  format?: 'CSV' | 'JSON' | 'PARQUET' | 'TSV' | 'EXCEL' | 'IN_MEMORY' | 'OTHER' | string;
  checksum?: string;
  record_count?: number;
  column_count?: number;
  location_notes?: string;
  [key: string]: unknown;
}

export interface DatasetVersion {
  version_id: string;
  dataset_id: string;
  version_number: number;
  version_tag?: string;
  parent_version_id?: string | null;
  status: DatasetVersionStatus;
  description?: string;
  created_at: string;
  created_by: string;
  checksum: string;
  data_reference?: DatasetDataReference;
  record_count?: number;
  column_count?: number;
  metadata?: Record<string, unknown>;
}

export type DatasetVersionErrorCode =
  | 'VERSION_INVALID_CONTRACT'
  | 'VERSION_EMPTY_ID'
  | 'VERSION_EMPTY_DATASET_ID'
  | 'VERSION_EMPTY_AUTHOR'
  | 'VERSION_INVALID_NUMBER'
  | 'VERSION_DUPLICATE_NUMBER'
  | 'VERSION_INVALID_STATUS'
  | 'VERSION_ALREADY_EXISTS'
  | 'VERSION_NOT_FOUND'
  | 'VERSION_DATASET_NOT_FOUND'
  | 'VERSION_PARENT_NOT_FOUND'
  | 'VERSION_PARENT_MISMATCH'
  | 'VERSION_CYCLIC_LINEAGE'
  | 'VERSION_IMMUTABLE_FIELD_VIOLATION'
  | 'VERSION_INTEGRITY_MISMATCH';

export class ScientificDatasetVersionError extends Error {
  readonly code: DatasetVersionErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: DatasetVersionErrorCode, message: string, details?: Record<string, unknown>) {
    super(`[${code}] ${message}`);
    this.name = 'ScientificDatasetVersionError';
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, ScientificDatasetVersionError.prototype);
  }
}

// ==========================================
// Scientific Data Layer — Phase D3: Variable Registry
// ==========================================

export type VariableDataType =
  | 'NUMBER'
  | 'INTEGER'
  | 'BOOLEAN'
  | 'STRING'
  | 'DATE'
  | 'DATETIME'
  | 'CATEGORICAL';

export type VariableSemanticType =
  | 'CONTINUOUS'
  | 'DISCRETE'
  | 'NOMINAL'
  | 'ORDINAL'
  | 'BINARY'
  | 'TEMPORAL';

export type VariableCategory =
  | 'ANTHROPOMETRY'
  | 'DEMOGRAPHIC'
  | 'PHYSIOLOGICAL'
  | 'NUTRITION'
  | 'LABORATORY'
  | 'ACTIVITY'
  | 'OTHER';

export type VariableMissingPolicy =
  | 'REQUIRED'
  | 'OPTIONAL'
  | 'IGNORE'
  | 'DEFAULT'
  | 'FALLBACK'
  | 'ERROR';

export type VariableStatus =
  | 'DRAFT'
  | 'ACTIVE'
  | 'DEPRECATED';

export interface VariableAllowedRange {
  min?: number;
  max?: number;
  min_inclusive?: boolean;
  max_inclusive?: boolean;
  warning_min?: number;
  warning_max?: number;
}

export interface Variable {
  variable_id: string;
  name: string;
  description: string;
  datatype: VariableDataType;
  unit?: string;
  dimension?: MeasurementType | string;
  semantic_type?: VariableSemanticType;
  category?: VariableCategory;
  required?: boolean;
  allowed_range?: VariableAllowedRange;
  categories?: string[];
  missing_policy?: VariableMissingPolicy;
  status: VariableStatus;
  created_at: string;
  updated_at: string;
  metadata?: Record<string, unknown>;
}

export type VariableErrorCode =
  | 'VARIABLE_INVALID_CONTRACT'
  | 'VARIABLE_EMPTY_ID'
  | 'VARIABLE_EMPTY_NAME'
  | 'VARIABLE_EMPTY_DESCRIPTION'
  | 'VARIABLE_INVALID_DATATYPE'
  | 'VARIABLE_INVALID_SEMANTIC_TYPE'
  | 'VARIABLE_INVALID_CATEGORY'
  | 'VARIABLE_INVALID_STATUS'
  | 'VARIABLE_INVALID_MISSING_POLICY'
  | 'VARIABLE_INVALID_UNIT'
  | 'VARIABLE_INVALID_DIMENSION'
  | 'VARIABLE_INCOMPATIBLE_UNIT_DIMENSION'
  | 'VARIABLE_INVALID_RANGE'
  | 'VARIABLE_ALREADY_EXISTS'
  | 'VARIABLE_NOT_FOUND'
  | 'VARIABLE_IMMUTABLE_ID_VIOLATION';

export class ScientificVariableError extends Error {
  readonly code: VariableErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: VariableErrorCode, message: string, details?: Record<string, unknown>) {
    super(`[${code}] ${message}`);
    this.name = 'ScientificVariableError';
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, ScientificVariableError.prototype);
  }
}

// ==========================================
// Scientific Data Layer — Phase D4: Variable Mapping
// ==========================================

export type VariableMappingMethod =
  | 'MANUAL'
  | 'IMPORTED'
  | 'SYSTEM_CONFIRMED'
  | 'SUGGESTED';

export type VariableMappingStatus =
  | 'DRAFT'
  | 'CONFIRMED'
  | 'REJECTED'
  | 'DEPRECATED';

export interface ColumnMetadata {
  name: string;
  datatype?: VariableDataType | string;
  unit?: string;
  dimension?: string;
  description?: string;
  sample_values?: unknown[];
}

export interface VariableMapping {
  mapping_id: string;
  dataset_version_id: string;
  source_column: string;
  variable_id: string;
  mapping_method: VariableMappingMethod;
  status: VariableMappingStatus;
  column_metadata?: ColumnMetadata;
  created_at: string;
  updated_at?: string;
  created_by: string;
  notes?: string;
  metadata?: Record<string, unknown>;
}

export type VariableMappingErrorCode =
  | 'MAPPING_INVALID_CONTRACT'
  | 'MAPPING_EMPTY_ID'
  | 'MAPPING_EMPTY_DATASET_VERSION_ID'
  | 'MAPPING_EMPTY_SOURCE_COLUMN'
  | 'MAPPING_EMPTY_VARIABLE_ID'
  | 'MAPPING_EMPTY_CREATED_BY'
  | 'MAPPING_INVALID_METHOD'
  | 'MAPPING_INVALID_STATUS'
  | 'MAPPING_VARIABLE_NOT_FOUND'
  | 'MAPPING_DATASET_VERSION_NOT_FOUND'
  | 'MAPPING_COLUMN_NOT_FOUND'
  | 'MAPPING_INCOMPATIBLE_UNIT'
  | 'MAPPING_INCOMPATIBLE_DATATYPE'
  | 'MAPPING_DUPLICATE_ENTRY'
  | 'MAPPING_COLUMN_CONFLICT'
  | 'MAPPING_NOT_FOUND'
  | 'MAPPING_IMMUTABLE_FIELD_VIOLATION';

export class ScientificVariableMappingError extends Error {
  readonly code: VariableMappingErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: VariableMappingErrorCode, message: string, details?: Record<string, unknown>) {
    super(`[${code}] ${message}`);
    this.name = 'ScientificVariableMappingError';
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, ScientificVariableMappingError.prototype);
  }
}

// ==========================================
// Scientific Data Layer — Phase D5: Data-State Pipeline
// ==========================================

export type DataState =
  | 'RAW'
  | 'WORKING_COPY'
  | 'CLEANED'
  | 'VALIDATED'
  | 'ANALYSIS_READY';

export interface DataArtifact {
  artifact_id: string;
  dataset_version_id: string;
  state: DataState;
  parent_artifact_id?: string | null;
  created_at: string;
  created_by: string;
  checksum: string;
  data_reference?: DatasetDataReference;
  record_count?: number;
  column_count?: number;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface StateTransition {
  transition_id: string;
  dataset_version_id: string;
  source_artifact_id: string;
  target_artifact_id: string;
  from_state: DataState;
  to_state: DataState;
  operation: string;
  created_by: string;
  created_at: string;
  parameters?: Record<string, unknown>;
  reason?: string;
  metadata?: Record<string, unknown>;
}

export type PipelineExecutionStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED';

export interface PipelineExecution {
  execution_id: string;
  dataset_version_id: string;
  source_artifact_id: string;
  target_artifact_id?: string;
  operation: string;
  configuration?: Record<string, unknown>;
  status: PipelineExecutionStatus;
  created_by: string;
  created_at: string;
  completed_at?: string;
  error?: string;
  warnings?: string[];
  provenance_id?: string;
  metadata?: Record<string, unknown>;
}

export type DataStateErrorCode =
  | 'DATA_STATE_INVALID_CONTRACT'
  | 'DATA_STATE_EMPTY_ID'
  | 'DATA_STATE_EMPTY_DATASET_VERSION_ID'
  | 'DATA_STATE_INVALID_STATE'
  | 'DATA_STATE_ILLEGAL_TRANSITION'
  | 'DATA_STATE_RAW_IMMUTABILITY_VIOLATION'
  | 'DATA_STATE_ARTIFACT_NOT_FOUND'
  | 'DATA_STATE_ARTIFACT_ALREADY_EXISTS'
  | 'DATA_STATE_DATASET_VERSION_NOT_FOUND'
  | 'DATA_STATE_PARENT_NOT_FOUND'
  | 'DATA_STATE_PARENT_MISMATCH'
  | 'DATA_STATE_CYCLIC_LINEAGE'
  | 'DATA_STATE_EXECUTION_NOT_FOUND'
  | 'DATA_STATE_EXECUTION_ALREADY_EXISTS'
  | 'DATA_STATE_INTEGRITY_MISMATCH';

export class ScientificDataStateError extends Error {
  readonly code: DataStateErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: DataStateErrorCode, message: string, details?: Record<string, unknown>) {
    super(`[${code}] ${message}`);
    this.name = 'ScientificDataStateError';
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, ScientificDataStateError.prototype);
  }
}

// ============================================================================
// PHASE D6 — DATA VALIDATION TYPES & CONTRACTS
// ============================================================================

export type DataValidationProfileStatus = 'ACTIVE' | 'DRAFT' | 'DEPRECATED';

export type DataValidationCheckType =
  | 'SCHEMA'
  | 'DATATYPE'
  | 'MISSINGNESS'
  | 'RANGE'
  | 'CATEGORY'
  | 'UNIT'
  | 'DUPLICATE'
  | 'NULLABILITY'
  | 'REQUIRED_VARIABLE'
  | 'CONSTRAINT';

export type DataValidationConstraintOperator =
  | 'EQ'
  | 'NEQ'
  | 'GT'
  | 'GTE'
  | 'LT'
  | 'LTE'
  | 'IN'
  | 'NOT_IN'
  | 'MATCHES_REGEX'
  | 'NON_EMPTY';

export interface DataValidationConstraintRule {
  field: string;
  operator: DataValidationConstraintOperator;
  value?: unknown;
  other_field?: string;
  regex_pattern?: string;
  message?: string;
}

export interface DataValidationCheckConfig {
  // Schema check
  expected_columns?: string[];
  disallow_unexpected_columns?: boolean;
  check_duplicate_columns?: boolean;

  // Datatype check
  expected_data_type?: VariableDataType | string;
  strict_type_check?: boolean;

  // Missingness check
  warning_missing_rate?: number;
  error_missing_rate?: number;
  missing_tokens?: string[];

  // Range check
  min?: number;
  max?: number;
  inclusive_min?: boolean;
  inclusive_max?: boolean;
  warning_min?: number;
  warning_max?: number;
  use_variable_registry_range?: boolean;

  // Category check
  allowed_categories?: (string | number)[];
  case_sensitive?: boolean;
  use_variable_registry_categories?: boolean;

  // Unit check
  expected_unit?: string;
  column_unit?: string;
  variable_unit?: string;
  check_dimension?: boolean;

  // Duplicate check
  key_columns?: string[];

  // Required variable check
  required_variable_ids?: string[];

  // Generic constraints
  constraints?: DataValidationConstraintRule[];

  // Sample limiting & general
  sample_limit?: number;
  [key: string]: unknown;
}

export interface DataValidationCheck {
  check_id: string;
  name: string;
  type: DataValidationCheckType;
  target: string; // column name, variable ID, or '*' / 'DATASET'
  configuration?: DataValidationCheckConfig;
  severity?: ValidationSeverity; // 'ERROR' | 'WARNING' | 'CRITICAL'
  enabled: boolean;
  description?: string;
}

export interface DataValidationProfile {
  profile_id: string;
  name: string;
  description: string;
  version: string;
  status: DataValidationProfileStatus;
  checks: DataValidationCheck[];
  created_at: string;
  created_by: string;
  metadata?: Record<string, unknown>;
}

export interface DataValidationViolation {
  row_index?: number;
  record_id?: string | number;
  column?: string;
  observed_value: unknown;
  expected_condition: string;
  message: string;
}

export interface DataValidationCheckResult {
  check_id: string;
  name: string;
  type: DataValidationCheckType;
  status: ValidationStatus;
  target: string;
  severity: ValidationSeverity;
  observed: unknown;
  expected: unknown;
  violation_count: number;
  sample_violations: DataValidationViolation[];
  message: string;
  metadata?: Record<string, unknown>;
}

export interface DataValidationResult {
  validation_id: string;
  dataset_version_id: string;
  artifact_id: string;
  validation_profile_id: string;
  validation_profile_version: string;
  status: ValidationStatus;
  started_at: string;
  completed_at: string;
  summary: ValidationSummary;
  checks: DataValidationCheckResult[];
  errors: string[];
  warnings: string[];
  created_by: string;
  provenance_id?: string;
  metadata?: Record<string, unknown>;
}

export type DataValidationErrorCode =
  | 'DATA_VALIDATION_INVALID_CONTRACT'
  | 'DATA_VALIDATION_EMPTY_ID'
  | 'DATA_VALIDATION_PROFILE_NOT_FOUND'
  | 'DATA_VALIDATION_PROFILE_ALREADY_EXISTS'
  | 'DATA_VALIDATION_PROFILE_IMMUTABLE'
  | 'DATA_VALIDATION_INVALID_PROFILE'
  | 'DATA_VALIDATION_INVALID_CHECK'
  | 'DATA_VALIDATION_ARTIFACT_NOT_FOUND'
  | 'DATA_VALIDATION_DATASET_VERSION_NOT_FOUND'
  | 'DATA_VALIDATION_VARIABLE_REGISTRY_NOT_FOUND'
  | 'DATA_VALIDATION_MAPPING_NOT_FOUND';

export class ScientificDataValidationError extends Error {
  readonly code: DataValidationErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: DataValidationErrorCode, message: string, details?: Record<string, unknown>) {
    super(`[${code}] ${message}`);
    this.name = 'ScientificDataValidationError';
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, ScientificDataValidationError.prototype);
  }
}

// ============================================================================
// PHASE D7 — DERIVED VARIABLE ENGINE TYPES & CONTRACTS
// ============================================================================

export type DerivedVariableModuleType = 'FORMULA' | 'ALGORITHM' | 'MODEL';

export type DerivedVariableStatus =
  | 'DRAFT'
  | 'EXPERIMENTAL'
  | 'VALIDATION'
  | 'VERIFIED'
  | 'DEPRECATED';

export interface DerivedVariableSourceMapping {
  source_variable_id: string; // The variable ID in Variable Registry (e.g. 'var_weight')
  module_input_name: string;  // The input parameter/variable name expected by the scientific module (e.g. 'weight')
  column_name?: string;       // Optional explicit source column in dataset
  unit?: string;              // Optional unit expected or provided
}

export interface DerivedVariableInputSpec {
  variable_id?: string;
  unit?: string;
  datatype?: DataType | string;
  required?: boolean;
  missing_policy?: MissingPolicy;
  description?: string;
}

export interface DerivedVariableInputContract {
  inputs: Record<string, DerivedVariableInputSpec>;
}

export interface DerivedVariableOutputContract {
  output_variable_id?: string;
  name?: string;
  unit: string;
  datatype: DataType | string;
  measurement_type?: MeasurementType;
  dimension?: string;
  description?: string;
}

export interface DerivedVariable {
  derived_variable_id: string;
  variable_id: string;
  name: string;
  description: string;
  dataset_version_id: string;
  source_variables: string[];
  source_mappings: DerivedVariableSourceMapping[];
  module_type: DerivedVariableModuleType;
  module_id: string;
  module_version: string;
  parameter_set_id?: string;
  parameter_versions?: Record<string, string>;
  parameter_snapshot?: ParameterSnapshot;
  input_contract: DerivedVariableInputContract;
  output_contract: DerivedVariableOutputContract;
  missing_policy: MissingPolicy;
  dependency_graph?: string[];
  status: RegistryStatus;
  created_at: string;
  created_by: string;
  provenance_reference?: string;
  metadata?: Record<string, unknown>;
}

export interface DerivedVariableRecordExecution {
  record_id: string | number;
  status: 'SUCCESS' | 'FAILED' | 'SKIPPED';
  output_value?: unknown;
  output_unit?: string;
  execution_result?: ExecutionResult;
  error?: string;
  warnings?: string[];
  fallback_used?: boolean;
}

export interface DerivedVariableBatchExecutionResult {
  derived_variable_id: string;
  dataset_version_id: string;
  source_artifact_id?: string;
  module_id: string;
  module_version: string;
  status: 'SUCCESS' | 'PARTIAL_SUCCESS' | 'FAILED';
  records: DerivedVariableRecordExecution[];
  summary: {
    total: number;
    successful: number;
    failed: number;
    skipped: number;
  };
  provenance_records?: ProvenanceRecord[];
  created_at: string;
}

export type DerivedVariableErrorCode =
  | 'DERIVED_VARIABLE_INVALID_CONTRACT'
  | 'DERIVED_VARIABLE_EMPTY_ID'
  | 'DERIVED_VARIABLE_EMPTY_VARIABLE_ID'
  | 'DERIVED_VARIABLE_EMPTY_DATASET_VERSION_ID'
  | 'DERIVED_VARIABLE_EMPTY_MODULE_ID'
  | 'DERIVED_VARIABLE_EMPTY_MODULE_VERSION'
  | 'DERIVED_VARIABLE_INVALID_MODULE_TYPE'
  | 'DERIVED_VARIABLE_INVALID_STATUS'
  | 'DERIVED_VARIABLE_INVALID_MISSING_POLICY'
  | 'DERIVED_VARIABLE_SOURCE_VARIABLES_EMPTY'
  | 'DERIVED_VARIABLE_ALREADY_EXISTS'
  | 'DERIVED_VARIABLE_NOT_FOUND'
  | 'DERIVED_VARIABLE_IMMUTABLE_VIOLATION'
  | 'DERIVED_VARIABLE_COLLISION'
  | 'DERIVED_VARIABLE_CYCLIC_DEPENDENCY'
  | 'DERIVED_VARIABLE_SELF_DEPENDENCY'
  | 'DERIVED_VARIABLE_UNRESOLVED_DEPENDENCY'
  | 'DERIVED_VARIABLE_DATASET_VERSION_MISMATCH'
  | 'DERIVED_VARIABLE_ARTIFACT_NOT_FOUND'
  | 'DERIVED_VARIABLE_MODULE_NOT_FOUND'
  | 'DERIVED_VARIABLE_MODULE_VERSION_NOT_FOUND'
  | 'DERIVED_VARIABLE_PARAMETER_NOT_FOUND'
  | 'DERIVED_VARIABLE_INCOMPATIBLE_UNIT'
  | 'DERIVED_VARIABLE_DIMENSION_MISMATCH'
  | 'DERIVED_VARIABLE_MISSING_INPUT'
  | 'DERIVED_VARIABLE_EXECUTION_FAILED';

export class ScientificDerivedVariableError extends Error {
  readonly code: DerivedVariableErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: DerivedVariableErrorCode, message: string, details?: Record<string, unknown>) {
    super(`[${code}] ${message}`);
    this.name = 'ScientificDerivedVariableError';
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, ScientificDerivedVariableError.prototype);
  }
}

// ============================================================================
// PHASE D8: DATASET → SCIENTIFIC EXECUTION CONTRACTS & TYPES
// ============================================================================

export type ValidationGatePolicy =
  | 'BLOCK_ON_ERROR'
  | 'BLOCK_ON_WARNING_OR_ERROR'
  | 'PERMISSIVE'
  | 'NOT_CONFIGURED';

export interface DatasetColumnMapping {
  source_column: string;
  module_input_name: string;
  variable_id?: string;
  column_unit?: string;
  target_unit?: string;
}

export interface DatasetMappingConfiguration {
  mapping_id?: string;
  column_mappings?: DatasetColumnMapping[];
  strict?: boolean;
}

export interface DatasetExecutionConfiguration {
  batch_policy: BatchErrorPolicy; // 'FAIL_FAST' | 'CONTINUE_ON_ERROR'
  max_records?: number;
  allow_unmapped_inputs?: boolean;
  missing_value_policy?: MissingPolicy;
}

export interface DatasetExecutionRequest {
  request_id?: string;
  dataset_version_id: string;
  data_artifact_id: string;
  module_id: string;
  module_version: string;
  parameter_set_id?: string;
  parameter_versions?: Record<string, string>;
  parameter_snapshot?: Record<string, unknown>;
  mapping_configuration: DatasetMappingConfiguration;
  validation_profile_id?: string;
  validation_gate_policy?: ValidationGatePolicy;
  execution_configuration: DatasetExecutionConfiguration;
  created_at?: string;
  created_by?: string;
  metadata?: Record<string, unknown>;
}

export interface ValidationGateResult {
  status: 'PASSED' | 'BLOCKED' | 'NOT_CONFIGURED' | 'WARNING_PERMITTED';
  policy: ValidationGatePolicy;
  profile_id?: string;
  error_count: number;
  warning_count: number;
  message?: string;
  evaluated_at: string;
  violations?: DataValidationViolation[];
}

export interface DatasetRecordExecutionResult {
  record_index: number;
  record_id: string | number;
  status: 'SUCCESS' | 'FAILED' | 'SKIPPED';
  execution_id?: string;
  execution_result?: ExecutionResult;
  assembled_inputs?: Record<string, unknown>;
  error?: string;
  warnings?: string[];
}

export interface DatasetResultSet {
  result_set_id: string;
  request_id?: string;
  dataset_version_id: string;
  data_artifact_id: string;
  module_id: string;
  module_version: string;
  parameter_set_id?: string;
  parameter_versions?: Record<string, string>;
  mapping_summary: {
    mapped_inputs_count: number;
    columns_used: string[];
  };
  validation_gate_result?: ValidationGateResult;
  execution_ids: string[];
  records: DatasetRecordExecutionResult[];
  summary: {
    total: number;
    successful: number;
    failed: number;
    skipped: number;
    duration_ms: number;
  };
  status: 'SUCCESS' | 'PARTIAL_SUCCESS' | 'FAILED' | 'BLOCKED';
  provenance_reference?: string;
  created_at: string;
  created_by: string;
  metadata?: Record<string, unknown>;
}

export type DatasetExecutionErrorCode =
  | 'DATASET_EXECUTION_INVALID_REQUEST'
  | 'DATASET_VERSION_NOT_FOUND'
  | 'DATA_ARTIFACT_NOT_FOUND'
  | 'DATA_ARTIFACT_CROSS_VERSION'
  | 'VARIABLE_MAPPING_NOT_FOUND'
  | 'VARIABLE_MAPPING_CONFLICT'
  | 'VARIABLE_MAPPING_AMBIGUOUS'
  | 'MODULE_NOT_FOUND'
  | 'MODULE_VERSION_NOT_FOUND'
  | 'INPUT_ASSEMBLY_ERROR'
  | 'UNIT_MISMATCH'
  | 'VALIDATION_GATE_BLOCKED'
  | 'SCIENTIFIC_EXECUTION_ERROR'
  | 'BATCH_EXECUTION_ERROR'
  | 'RESULT_SET_INVALID'
  | 'DATASET_EXECUTION_IMMUTABILITY_VIOLATION';

export class ScientificDatasetExecutionError extends Error {
  readonly code: DatasetExecutionErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: DatasetExecutionErrorCode, message: string, details?: Record<string, unknown>) {
    super(`[${code}] ${message}`);
    this.name = 'ScientificDatasetExecutionError';
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, ScientificDatasetExecutionError.prototype);
  }
}

// ==========================================
// Scientific Data Layer — Phase D9: Statistical Analysis Engine
// ==========================================

export * from './data/analysisContracts';

// ==========================================
// Scientific Data Layer — Phase D10: Inferential Statistics & Hypothesis Testing Engine
// ==========================================

export * from './data/inferentialContracts';

// ==========================================
// Scientific Data Layer — Phase D11: Regression & Predictive Modeling Engine
// ==========================================

export * from './data/regressionContracts';

// ==========================================
// Scientific Data Layer — Phase D12: Research Power & Sample Size Engine
// ==========================================

export * from './data/powerContracts';

// ==========================================
// Scientific Data Layer — Phase D13: Non-Parametric Analysis Engine
// ==========================================

export * from './data/nonParametricContracts';

// ==========================================
// Scientific Data Layer — Phase D14: Visualization & Research Reporting Engine
// ==========================================

export * from './data/visualizationContracts';
export * from './data/reportContracts';
