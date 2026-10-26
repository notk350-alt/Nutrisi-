/**
 * NutriBodySim — Backend Database Entity Types & Schema Definitions
 */

import { 
  ScientificVariable, 
  ScientificUnit, 
  ScientificFormula, 
  ScientificAlgorithm, 
  ScientificModel, 
  ScientificParameter, 
  ScientificReference,
  CalculationTrace,
  InterpretationRule
} from '../../scientific/types';

export type UserRole = 'RegisteredUser' | 'Student' | 'Lecturer' | 'Researcher' | 'Admin';

export type AccountStatus = 'ACTIVE' | 'SUSPENDED' | 'DISABLED';

export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export type RequestedRole = 'Student' | 'Lecturer' | 'Researcher' | 'Admin';

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

export interface ExternalIdentity {
  provider: 'google' | 'local';
  provider_subject_id: string; // Stable provider subject identifier (e.g. Google 'sub')
  user_id: string;             // Relates to internal User.id
  email?: string;
  email_verified: boolean;
  linked_at: string;
}

export interface User {
  id: string;
  user_id?: string; // Stable internal identifier alias for id
  email: string;
  name: string;
  display_name?: string;
  role: UserRole;
  permissions: Permission[];
  organization?: string;
  avatar_url?: string;
  created_at: string;
  updated_at?: string;
  last_login_at: string;

  // MVS-B2.5A Identity & Account Lifecycle
  account_status?: AccountStatus;
  email_verified?: boolean;
  provider?: 'google' | 'local';
  provider_subject_id?: string;
  external_identities?: ExternalIdentity[];

  // MVS-B2.5B Governance
  is_main_admin?: boolean;
  governance_granted_at?: string;
  governance_granted_by?: string;
  token_version?: number;
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

export type TeamRole = 'Owner' | 'Editor' | 'Collaborator' | 'Viewer';

export interface ProjectMember {
  id: string;
  project_id: string;
  user_id: string;
  role: TeamRole;
  joined_at: string;
}

export interface Team {
  id: string;
  name: string;
  description: string;
  owner_id: string;
  created_at: string;
}

export interface TeamMember {
  id: string;
  team_id: string;
  user_id: string;
  role: TeamRole;
  joined_at: string;
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
  project_ids: string[]; // Linked projects
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

export interface ReadingProgress {
  id: string;
  user_id: string;
  material_id: string;
  last_page: number;
  total_pages: number;
  progress_pct: number;
  scroll_position?: number;
  last_accessed: string;
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
  color: string; // 'yellow' | 'green' | 'blue' | 'pink'
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

export interface Dataset {
  id: string;
  project_id: string;
  name: string;
  description: string;
  source_file?: string;
  uploaded_by: string;
  current_version: string;
  created_at: string;
  updated_at: string;
}

export interface DatasetColumnMeta {
  name: string;
  detected_type: 'number' | 'string' | 'boolean' | 'date';
  unit?: string;
  variable_id?: string;
  missing_count: number;
  unique_count: number;
}

export interface DatasetValidationReport {
  is_valid: boolean;
  row_count: number;
  column_count: number;
  missing_values_count: number;
  duplicate_rows_count: number;
  outliers_detected: { column: string; row_index: number; value: any; reason: string }[];
  type_mismatches: { column: string; row_index: number; value: any; expected: string }[];
  warnings: string[];
}

export interface DatasetVersion {
  id: string;
  dataset_id: string;
  version_tag: string; // e.g. "v1.0", "v1.1"
  parent_version_tag?: string;
  state: 'RAW' | 'WORKING_COPY' | 'CLEANED' | 'VALIDATED' | 'ANALYSIS_READY';
  columns: DatasetColumnMeta[];
  data: Record<string, any>[];
  validation_report: DatasetValidationReport;
  transformation_applied?: string;
  created_by: string;
  created_at: string;
}

export interface StatisticsAnalysis {
  id: string;
  project_id: string;
  dataset_version_id: string;
  title: string;
  analysis_type: 'DESCRIPTIVE' | 'TWO_GROUP_COMPARISON' | 'MULTIPLE_GROUP_ANOVA' | 'CORRELATION' | 'LINEAR_REGRESSION' | 'DIAGNOSTICS';
  target_columns: string[];
  grouping_column?: string;
  method_justification: string;
  results: Record<string, any>;
  provenance_hash: string;
  created_by: string;
  created_at: string;
}

export interface ChartRecord {
  id: string;
  project_id: string;
  dataset_version_id: string;
  analysis_id?: string;
  title: string;
  chart_type: 'LINE' | 'BAR' | 'HISTOGRAM' | 'SCATTER' | 'BOX_PLOT';
  x_field: string;
  y_field?: string;
  group_by?: string;
  config: Record<string, any>;
  created_by: string;
  created_at: string;
}

export type NotebookCellType = 'TEXT' | 'DATA' | 'FORMULA' | 'CODE' | 'CHART' | 'TABLE' | 'EXPERIMENT' | 'REFERENCE';

export interface NotebookCell {
  id: string;
  notebook_id: string;
  cell_type: NotebookCellType;
  order: number;
  title?: string;
  content: string; // Markdown text, code, or JSON config
  metadata?: {
    material_id?: string;
    page?: number;
    selected_text?: string;
    dataset_version_id?: string;
    formula_id?: string;
    chart_id?: string;
    experiment_id?: string;
    reference_id?: string;
    execution_result?: any;
    last_executed?: string;
  };
}

export interface NutriNotebook {
  id: string;
  project_id: string;
  title: string;
  description: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface CodeExecutionRecord {
  id: string;
  project_id: string;
  language: 'PYTHON' | 'R' | 'SQL' | 'JAVASCRIPT';
  code: string;
  output: string;
  error?: string;
  execution_time_ms: number;
  environment_info: string;
  executed_by: string;
  created_at: string;
}

export interface Experiment {
  id: string;
  project_id: string;
  title: string;
  description: string;
  baseline_model_id: string;
  experimental_model_id: string;
  parameter_modifications: {
    parameter_id: string;
    baseline_value: any;
    experimental_value: any;
    unit: string;
    rationale: string;
  }[];
  baseline_output?: Record<string, any>;
  experimental_output?: Record<string, any>;
  delta_summary?: string;
  status: 'DRAFT' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  provenance_hash: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface AuditLog {
  id: string;
  user_id: string;
  user_name: string;
  action: 
    | 'CREATE' 
    | 'EDIT' 
    | 'CLONE' 
    | 'DELETE' 
    | 'SHARE' 
    | 'PUBLISH' 
    | 'VERIFY' 
    | 'EXECUTE' 
    | 'LOGIN' 
    | 'MAIN_ADMIN_BOOTSTRAP' 
    | 'ROLE_APPROVAL' 
    | 'USER_STATUS_CHANGE' 
    | 'SESSION_REVOCATION'
    | 'OIDC_ACCOUNT_PROVISION'
    | 'OIDC_IDENTITY_CONFLICT'
    | 'OIDC_INACTIVE_ACCESS_ATTEMPT'
    | 'OIDC_STORAGE_FAILURE'
    | 'OIDC_CLAIM_ANOMALY';
  entity_type: string;
  entity_id: string;
  details: string;
  ip_address?: string;
  timestamp: string;
  metadata?: Record<string, any>;
}

export interface ProvenanceRecord {
  id: string;
  project_id: string;
  target_entity_type: string;
  target_entity_id: string;
  user_id: string;
  dataset_version_id?: string;
  formula_version?: string;
  model_version?: string;
  parameter_version?: string;
  code_hash?: string;
  environment_specs: string;
  provenance_hash: string;
  reproducibility_manifest: Record<string, any>;
  created_at: string;
}
