/**
 * NutriBodySim — Shared Frontend and Engine Types
 */

export type UserRole = 'RegisteredUser' | 'Student' | 'Lecturer' | 'Researcher' | 'Admin';

export type Permission = 
  | 'VIEW' 
  | 'USE' 
  | 'CREATE' 
  | 'CLONE' 
  | 'EDIT' 
  | 'DELETE' 
  | 'SHARE' 
  | 'PUBLISH' 
  | 'VERIFY' 
  | 'ADMIN'
  | 'MANAGE_PRIVILEGED_ROLES';

export type AccountStatus = 'ACTIVE' | 'SUSPENDED' | 'DISABLED';
export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export type RequestedRole = 'Student' | 'Lecturer' | 'Researcher' | 'Admin';

export interface ExternalIdentity {
  provider: 'google' | 'local';
  provider_subject_id: string;
  user_id: string;
  email?: string;
  email_verified: boolean;
  linked_at: string;
}

export interface RoleRequest {
  request_id: string;
  user_id: string;
  requested_role: RequestedRole;
  approval_status: ApprovalStatus;
  institution?: string;
  justification?: string;
  created_at: string;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  review_reason?: string | null;
}

export interface User {
  id: string;
  user_id?: string;
  email: string;
  name: string;
  display_name?: string;
  role: UserRole;
  permissions: Permission[];
  organization?: string;
  institution?: string;
  avatar_url?: string;
  created_at: string;
  updated_at?: string;
  last_login_at: string;
  account_status?: AccountStatus;
  email_verified?: boolean;
  provider?: 'google' | 'local';
  provider_subject_id?: string;
  external_identities?: ExternalIdentity[];
  is_main_admin?: boolean;
}

export type ProjectType = 'Personal' | 'Academic' | 'Research' | 'Experiment' | 'Team' | 'Assignment';

export interface Project {
  id: string;
  name: string;
  description: string;
  type: ProjectType;
  owner_id: string;
  team_id?: string;
  is_public: boolean;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface Team {
  id: string;
  name: string;
  description: string;
  owner_id: string;
  created_at: string;
  members?: { id: string; user_id: string; role: string; user?: User }[];
}

export type MaterialType = 'PDF' | 'TXT' | 'EPUB' | 'DOCX' | 'PPTX' | 'XLSX' | 'CSV' | 'IMAGE';

export interface Material {
  id: string;
  title: string;
  author: string;
  subject: string;
  type: MaterialType;
  description: string;
  year?: number;
  publisher?: string;
  language: string;
  source?: string;
  url?: string;
  license?: string;
  tags: string[];
  version: string;
  uploaded_by: string;
  file_path: string;
  file_size_bytes: number;
  mime_type: string;
  file_hash: string;
  project_ids: string[];
  created_at: string;
  updated_at: string;
}

export interface MaterialCollection {
  id: string;
  name: string;
  description: string;
  color?: string;
  material_ids: string[];
  created_by: string;
  created_at: string;
}

export interface Bookmark {
  id: string;
  user_id: string;
  material_id: string;
  page: number;
  title: string;
  created_at: string;
}

export interface Highlight {
  id: string;
  user_id: string;
  material_id: string;
  page: number;
  selected_text: string;
  color: string;
  location_meta?: string;
  created_at: string;
}

export interface Note {
  id: string;
  user_id: string;
  title: string;
  content: string;
  material_id?: string;
  page?: number;
  selected_text?: string;
  project_id?: string;
  experiment_id?: string;
  dataset_id?: string;
  calculation_id?: string;
  created_at: string;
  updated_at: string;
}

export interface ScientificUnit {
  unit_id: string;
  symbol: string;
  name: string;
  measurement_type: string;
  base_unit: string;
  to_base_multiplier: number;
  to_base_offset?: number;
}

export interface ScientificVariable {
  variable_id: string;
  name: string;
  label?: string;
  definition?: string;
  datatype?: string;
  unit: string;
  measurement_type: string;
  allowed_range?: { min?: number; max?: number; warning_min?: number; warning_max?: number };
  population?: string;
  source_reference?: string;
  version?: string;
  status?: string;
  created_at?: string;
}

export interface ScientificParameter {
  parameter_id: string;
  name: string;
  description: string;
  value: any;
  unit: string;
  valid_range?: { min?: number; max?: number };
  population?: string;
  reference_ids?: string[];
  version?: string;
  status?: string;
  is_constant?: boolean;
  created_at?: string;
}

export interface ScientificReference {
  reference_id: string;
  title: string;
  authors: string[];
  year: number;
  journal_or_publisher?: string;
  doi?: string;
  citation_key: string;
  abstract?: string;
}

export interface ScientificFormula {
  formula_id: string;
  name: string;
  description: string;
  version: string;
  status: string;
  inputs: { variable_id: string; name: string; unit: string; required?: boolean; default_value?: number; datatype?: string }[];
  outputs: { name: string; unit: string; datatype?: string; description?: string }[];
  parameter_ids: string[];
  expression_ast: any;
  expression_string: string;
  reference_ids: string[];
  assumptions: string[];
  limitations: string[];
  validation_status?: string;
}

export interface ScientificModel {
  model_id: string;
  name: string;
  description: string;
  version: string;
  status: string;
  is_verified: boolean;
  parent_model_id?: string;
  variable_ids: string[];
  formula_ids: string[];
  algorithm_ids?: string[];
  parameter_ids: string[];
  reference_ids: string[];
  assumptions: string[];
  changed_notes?: string;
  created_by?: string;
  created_at?: string;
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

export interface InterpretationRule {
  module_id: string;
  module_type: string;
  rule_id: string;
  name: string;
  description: string;
  version: string;
  status: string;
  target_variable_or_metric: string;
  unit: string;
  population?: string;
  reference_ids?: string[];
  thresholds: InterpretationThreshold[];
  created_by?: string;
  created_at: string;
  updated_at: string;
}

export interface TraceStep {
  step_number?: number;
  step?: number;
  action?: string;
  description?: string;
  formula_snippet?: string;
  detail?: string;
  intermediate_value?: any;
  output_value?: any;
  unit?: string;
  timestamp?: string;
}

export interface CalculationTrace {
  calculation_id: string;
  user_id?: string;
  project_id?: string;
  formula_or_model_id?: string;
  formula_id?: string;
  version?: string;
  inputs_received?: Record<string, { value: number | string; unit: string }>;
  normalized_inputs?: Record<string, { value: number; unit: string; original_unit?: string }>;
  parameters_resolved?: Record<string, { value: number | string; unit: string }>;
  steps: TraceStep[];
  output_value?: number;
  output_unit?: string;
  final_result?: Record<string, { value: number | string; unit: string }>;
  explanation?: string;
  natural_language_explanation?: string;
  provenance_hash: string;
  execution_duration_ms?: number;
  created_at: string;
}

export interface Dataset {
  id: string;
  project_id: string;
  name: string;
  description: string;
  source_file?: string;
  source_format?: string;
  current_version: string;
  created_at: string;
  updated_at: string;
}

export interface DatasetColumnMeta {
  name: string;
  detected_type?: 'number' | 'string' | 'boolean' | 'date';
  datatype?: 'number' | 'string' | 'boolean' | 'date';
  unit?: string;
  missing_count?: number;
  unique_count?: number;
}

export interface DatasetValidationReport {
  is_valid: boolean;
  row_count: number;
  column_count: number;
  missing_values_count: number;
  duplicate_rows_count: number;
  outliers_detected?: any[];
  outlier_count?: number;
  error_count?: number;
  warning_count?: number;
  warnings: string[];
}

export interface DatasetVersion {
  id: string;
  dataset_id: string;
  version_tag: string;
  parent_version_tag?: string;
  state?: 'RAW' | 'WORKING_COPY' | 'CLEANED' | 'VALIDATED' | 'ANALYSIS_READY';
  is_raw?: boolean;
  row_count?: number;
  column_count?: number;
  provenance_hash?: string;
  columns?: DatasetColumnMeta[];
  schema?: {
    columns: DatasetColumnMeta[];
  };
  data: Record<string, any>[];
  validation_report?: DatasetValidationReport;
  transformation_applied?: string;
  created_by?: string;
  created_at: string;
}

export interface StatisticsAnalysis {
  id: string;
  project_id?: string;
  dataset_version_id: string;
  title: string;
  analysis_type: string;
  target_columns: string[];
  method_justification?: any;
  results: Record<string, any>;
  provenance_hash: string;
  created_at: string;
}

export type NotebookCellType = 
  | 'TEXT' 
  | 'DATA' 
  | 'FORMULA' 
  | 'CODE' 
  | 'CHART' 
  | 'TABLE' 
  | 'EXPERIMENT' 
  | 'REFERENCE'
  | 'MARKDOWN'
  | 'FORMULA_RUN'
  | 'DATA_PREVIEW';

export interface NotebookCell {
  id: string;
  notebook_id: string;
  cell_type: NotebookCellType;
  order: number;
  title?: string;
  content: string;
  metadata?: any;
  config?: any;
  output?: any;
  execution_count?: number;
  last_executed_at?: string;
}

export interface NutriNotebook {
  id: string;
  project_id?: string;
  title: string;
  description?: string;
  created_by?: string;
  created_at: string;
}

export interface Experiment {
  id: string;
  project_id?: string;
  title: string;
  description?: string;
  hypothesis?: string;
  baseline_model_id: string;
  experimental_model_id: string;
  parameter_modifications?: {
    parameter_id: string;
    baseline_value: any;
    experimental_value: any;
    unit: string;
    rationale: string;
  }[];
  configuration?: any;
  results?: any;
  baseline_output?: Record<string, any>;
  experimental_output?: Record<string, any>;
  delta_summary?: string;
  status: string;
  provenance_hash: string;
  created_at: string;
}

export interface AuditLog {
  id: string;
  user_id: string;
  user_name?: string;
  action_type?: string;
  action?: string;
  entity_type: string;
  entity_id: string;
  details?: string;
  changes?: any;
  timestamp: string;
}

export interface ProvenanceRecord {
  id: string;
  project_id?: string;
  target_entity_type?: string;
  target_entity_id?: string;
  user_id?: string;
  dataset_version_id?: string;
  formula_version?: string;
  model_version?: string;
  operation?: string;
  executed_at?: string;
  provenance_hash: string;
  manifest?: Record<string, any>;
  reproducibility_manifest?: Record<string, any>;
  created_at?: string;
}
