-- ============================================================================
-- NutriBodySim — PostgreSQL Schema & DDL Specification (MVS-B2.5E.1B.3)
-- Target: PostgreSQL 15+ / Cloud SQL for PostgreSQL
--
-- ARCHITECTURAL PRINCIPLES:
-- 1. Exact ID Preservation: Primary keys retain existing domain identifiers
--    ('usr_*', 'proj_*', 'mat_*', 'ds_*', 'dsv_*', 'UNIT_*', 'VAR_*', 'PARAM_*', etc.)
-- 2. Type Precision: IEEE 754 DOUBLE PRECISION for floating-point bioenergetic values,
--    NUMERIC for exact scales, TIMESTAMPTZ (UTC) for temporal records, JSONB for dynamic AST/matrices.
-- 3. Strict Referencing: Clean dependency graph (0 circular dependencies).
-- 4. Evidence-Grounded Constraints: Only constraints proven by existing data and contracts
--    are enforced as hard checks; unresolved edge cases are tagged with [DECISION_PENDING].
-- 5. Zero dual-writer or runtime execution in this milestone (DESIGN ONLY).
-- ============================================================================

-- Enable required core extensions (if available in database environment)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "btree_gist";

-- ============================================================================
-- SECTION 1: INDEPENDENT SCIENTIFIC REGISTRY & STANDARDS
-- ============================================================================

-- 1. Scientific Units of Measurement (Baseline: 33 records)
CREATE TABLE IF NOT EXISTS scientific_units (
    unit_id VARCHAR(64) PRIMARY KEY,
    symbol VARCHAR(32) NOT NULL UNIQUE,
    name VARCHAR(128) NOT NULL,
    measurement_type VARCHAR(64) NOT NULL,
    base_unit VARCHAR(32) NOT NULL,
    to_base_multiplier DOUBLE PRECISION NOT NULL,
    to_base_offset DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_units_measurement_type ON scientific_units (measurement_type);
CREATE INDEX IF NOT EXISTS idx_units_symbol ON scientific_units (symbol);

-- 2. Scientific Literature References & Citations (Baseline: 2 records)
CREATE TABLE IF NOT EXISTS scientific_references (
    reference_id VARCHAR(64) PRIMARY KEY,
    title TEXT NOT NULL,
    authors JSONB NOT NULL, -- Array of author strings: ["Vance, E.", "Brody, M."]
    year INTEGER NOT NULL CONSTRAINT scientific_references_year_check CHECK (year >= 1800 AND year <= 2100),
    journal_or_publisher TEXT NOT NULL,
    doi VARCHAR(128),
    citation_key VARCHAR(64) UNIQUE,
    abstract TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_scientific_references_year ON scientific_references (year);
CREATE INDEX IF NOT EXISTS idx_scientific_references_citation_key ON scientific_references (citation_key);

-- 3. Scientific Variables (Physiological & Anthropometric Registry) (Baseline: 6 records)
CREATE TABLE IF NOT EXISTS scientific_variables (
    variable_id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    label VARCHAR(128) NOT NULL,
    definition TEXT,
    datatype VARCHAR(32) NOT NULL CONSTRAINT scientific_variables_datatype_check CHECK (datatype IN ('number', 'integer', 'boolean', 'string', 'vector', 'matrix')),
    unit VARCHAR(32) NOT NULL REFERENCES scientific_units(symbol) ON DELETE RESTRICT,
    measurement_type VARCHAR(64) NOT NULL,
    allowed_range JSONB, -- { min, max, warning_min, warning_max }
    population VARCHAR(128),
    source_reference VARCHAR(64) REFERENCES scientific_references(reference_id) ON DELETE SET NULL,
    version VARCHAR(32) NOT NULL DEFAULT '1.0.0',
    status VARCHAR(32) NOT NULL DEFAULT 'EXPERIMENTAL' CONSTRAINT scientific_variables_status_check CHECK (status IN ('DRAFT', 'UNDER_REVIEW', 'VALIDATED', 'VALIDATION', 'VERIFIED', 'EXPERIMENTAL', 'DEPRECATED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_variables_measurement_type ON scientific_variables (measurement_type);
CREATE INDEX IF NOT EXISTS idx_variables_status ON scientific_variables (status);

-- 4. Scientific Parameters (Baseline: 4 records)
CREATE TABLE IF NOT EXISTS scientific_parameters (
    parameter_id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    description TEXT,
    value JSONB NOT NULL, -- Supports scalar numbers, arrays, or matrix coefficients
    unit VARCHAR(32) NOT NULL REFERENCES scientific_units(symbol) ON DELETE RESTRICT,
    valid_range JSONB, -- { min, max }
    version VARCHAR(32) NOT NULL DEFAULT '1.0.0',
    status VARCHAR(32) NOT NULL DEFAULT 'EXPERIMENTAL' CONSTRAINT scientific_parameters_status_check CHECK (status IN ('DRAFT', 'UNDER_REVIEW', 'VALIDATED', 'VALIDATION', 'VERIFIED', 'EXPERIMENTAL', 'DEPRECATED')),
    is_constant BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_parameters_status ON scientific_parameters (status);

-- Junction table: Parameter to Literature References (M:N)
CREATE TABLE IF NOT EXISTS scientific_parameter_references (
    parameter_id VARCHAR(64) NOT NULL REFERENCES scientific_parameters(parameter_id) ON DELETE CASCADE,
    reference_id VARCHAR(64) NOT NULL REFERENCES scientific_references(reference_id) ON DELETE CASCADE,
    PRIMARY KEY (parameter_id, reference_id)
);

-- 5. Scientific Mathematical Formulas & AST Registry (Baseline: 5 records)
CREATE TABLE IF NOT EXISTS scientific_formulas (
    formula_id VARCHAR(64) PRIMARY KEY,
    module_id VARCHAR(64),
    module_type VARCHAR(64) DEFAULT 'FORMULA',
    name VARCHAR(128) NOT NULL,
    description TEXT,
    version VARCHAR(32) NOT NULL DEFAULT '1.0.0',
    status VARCHAR(32) NOT NULL DEFAULT 'EXPERIMENTAL' CONSTRAINT scientific_formulas_status_check CHECK (status IN ('DRAFT', 'UNDER_REVIEW', 'VALIDATED', 'VALIDATION', 'VERIFIED', 'EXPERIMENTAL', 'DEPRECATED')),
    inputs JSONB NOT NULL DEFAULT '[]', -- Array of FormulaInputSpec: [{ variable_id, name, unit, default_value, required }]
    outputs JSONB NOT NULL DEFAULT '[]', -- Array of FormulaOutputSpec: [{ name, unit, description }]
    expression_ast JSONB NOT NULL, -- Strongly-typed AST node hierarchy (Pure JSONB)
    expression_string TEXT NOT NULL, -- Human-readable math string, e.g. "Weight / (Height ^ 2)"
    assumptions JSONB NOT NULL DEFAULT '[]', -- Array of strings
    limitations JSONB NOT NULL DEFAULT '[]', -- Array of strings
    validation_status VARCHAR(64) NOT NULL DEFAULT 'UNVERIFIED',
    created_by VARCHAR(64) NOT NULL DEFAULT 'SYSTEM',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_formulas_status ON scientific_formulas (status);
CREATE INDEX IF NOT EXISTS idx_formulas_validation_status ON scientific_formulas (validation_status);

-- Junction: Formula to Parameters (M:N)
CREATE TABLE IF NOT EXISTS scientific_formula_parameters (
    formula_id VARCHAR(64) NOT NULL REFERENCES scientific_formulas(formula_id) ON DELETE CASCADE,
    parameter_id VARCHAR(64) NOT NULL REFERENCES scientific_parameters(parameter_id) ON DELETE CASCADE,
    PRIMARY KEY (formula_id, parameter_id)
);

-- Junction: Formula to References (M:N)
CREATE TABLE IF NOT EXISTS scientific_formula_references (
    formula_id VARCHAR(64) NOT NULL REFERENCES scientific_formulas(formula_id) ON DELETE CASCADE,
    reference_id VARCHAR(64) NOT NULL REFERENCES scientific_references(reference_id) ON DELETE CASCADE,
    PRIMARY KEY (formula_id, reference_id)
);

-- 6. Scientific Computational Algorithms (Baseline: 0 records, typed schema)
CREATE TABLE IF NOT EXISTS scientific_algorithms (
    algorithm_id VARCHAR(64) PRIMARY KEY,
    module_id VARCHAR(64),
    module_type VARCHAR(64) DEFAULT 'ALGORITHM',
    name VARCHAR(128) NOT NULL,
    description TEXT,
    version VARCHAR(32) NOT NULL DEFAULT '1.0.0',
    status VARCHAR(32) NOT NULL DEFAULT 'EXPERIMENTAL' CONSTRAINT scientific_algorithms_status_check CHECK (status IN ('DRAFT', 'UNDER_REVIEW', 'VALIDATED', 'VALIDATION', 'VERIFIED', 'EXPERIMENTAL', 'DEPRECATED')),
    inputs JSONB NOT NULL DEFAULT '[]',
    outputs JSONB NOT NULL DEFAULT '[]',
    entry_step_id VARCHAR(64),
    steps JSONB NOT NULL DEFAULT '[]', -- Array of AlgorithmStep definitions
    fallback_routes JSONB DEFAULT '[]',
    assumptions JSONB DEFAULT '[]',
    limitations JSONB DEFAULT '[]',
    validation_status VARCHAR(64),
    created_by VARCHAR(64) NOT NULL DEFAULT 'SYSTEM',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Junction: Algorithm to Parameters (M:N)
CREATE TABLE IF NOT EXISTS scientific_algorithm_parameters (
    algorithm_id VARCHAR(64) NOT NULL REFERENCES scientific_algorithms(algorithm_id) ON DELETE CASCADE,
    parameter_id VARCHAR(64) NOT NULL REFERENCES scientific_parameters(parameter_id) ON DELETE CASCADE,
    PRIMARY KEY (algorithm_id, parameter_id)
);

-- Junction: Algorithm to References (M:N)
CREATE TABLE IF NOT EXISTS scientific_algorithm_references (
    algorithm_id VARCHAR(64) NOT NULL REFERENCES scientific_algorithms(algorithm_id) ON DELETE CASCADE,
    reference_id VARCHAR(64) NOT NULL REFERENCES scientific_references(reference_id) ON DELETE CASCADE,
    PRIMARY KEY (algorithm_id, reference_id)
);

-- 7. Scientific Composite Models (Baseline: 1 record)
CREATE TABLE IF NOT EXISTS scientific_models (
    model_id VARCHAR(64) PRIMARY KEY,
    module_id VARCHAR(64),
    module_type VARCHAR(64) DEFAULT 'MODEL',
    name VARCHAR(128) NOT NULL,
    description TEXT,
    version VARCHAR(32) NOT NULL DEFAULT '1.0.0',
    status VARCHAR(32) NOT NULL DEFAULT 'EXPERIMENTAL' CONSTRAINT scientific_models_status_check CHECK (status IN ('DRAFT', 'UNDER_REVIEW', 'VALIDATED', 'VALIDATION', 'VERIFIED', 'EXPERIMENTAL', 'DEPRECATED')),
    is_verified BOOLEAN NOT NULL DEFAULT FALSE,
    parent_model_id VARCHAR(64), -- Self-reference for experimental branches/clones
    assumptions JSONB NOT NULL DEFAULT '[]',
    validation_criteria TEXT,
    changed_notes TEXT,
    inputs JSONB DEFAULT '[]',
    outputs JSONB DEFAULT '[]',
    states JSONB DEFAULT '[]',
    time_config JSONB DEFAULT '{}',
    transitions JSONB DEFAULT '[]',
    created_by VARCHAR(64) NOT NULL DEFAULT 'SYSTEM',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_models_status ON scientific_models (status);

-- Junction tables for Scientific Model Composite Assembly (M:N)
CREATE TABLE IF NOT EXISTS scientific_model_variables (
    model_id VARCHAR(64) NOT NULL REFERENCES scientific_models(model_id) ON DELETE CASCADE,
    variable_id VARCHAR(64) NOT NULL REFERENCES scientific_variables(variable_id) ON DELETE CASCADE,
    PRIMARY KEY (model_id, variable_id)
);

CREATE TABLE IF NOT EXISTS scientific_model_formulas (
    model_id VARCHAR(64) NOT NULL REFERENCES scientific_models(model_id) ON DELETE CASCADE,
    formula_id VARCHAR(64) NOT NULL REFERENCES scientific_formulas(formula_id) ON DELETE CASCADE,
    PRIMARY KEY (model_id, formula_id)
);

CREATE TABLE IF NOT EXISTS scientific_model_algorithms (
    model_id VARCHAR(64) NOT NULL REFERENCES scientific_models(model_id) ON DELETE CASCADE,
    algorithm_id VARCHAR(64) NOT NULL REFERENCES scientific_algorithms(algorithm_id) ON DELETE CASCADE,
    PRIMARY KEY (model_id, algorithm_id)
);

CREATE TABLE IF NOT EXISTS scientific_model_parameters (
    model_id VARCHAR(64) NOT NULL REFERENCES scientific_models(model_id) ON DELETE CASCADE,
    parameter_id VARCHAR(64) NOT NULL REFERENCES scientific_parameters(parameter_id) ON DELETE CASCADE,
    PRIMARY KEY (model_id, parameter_id)
);

CREATE TABLE IF NOT EXISTS scientific_model_references (
    model_id VARCHAR(64) NOT NULL REFERENCES scientific_models(model_id) ON DELETE CASCADE,
    reference_id VARCHAR(64) NOT NULL REFERENCES scientific_references(reference_id) ON DELETE CASCADE,
    PRIMARY KEY (model_id, reference_id)
);

-- 8. Clinical & Evidence-Based Interpretation Rules (Baseline: 2 records)
CREATE TABLE IF NOT EXISTS scientific_interpretation_rules (
    rule_id VARCHAR(64) PRIMARY KEY,
    module_id VARCHAR(64) NOT NULL,
    module_type VARCHAR(64) NOT NULL DEFAULT 'INTERPRETATION',
    name VARCHAR(128) NOT NULL,
    description TEXT,
    version VARCHAR(32) NOT NULL DEFAULT '1.0.0',
    status VARCHAR(32) NOT NULL DEFAULT 'VERIFIED' CONSTRAINT scientific_interpretation_rules_status_check CHECK (status IN ('DRAFT', 'UNDER_REVIEW', 'VALIDATED', 'VALIDATION', 'VERIFIED', 'EXPERIMENTAL', 'DEPRECATED')),
    target_variable_or_metric VARCHAR(64) NOT NULL,
    unit VARCHAR(32) NOT NULL,
    population VARCHAR(128),
    thresholds JSONB NOT NULL, -- Array of InterpretationThreshold objects
    created_by VARCHAR(64) NOT NULL DEFAULT 'SYSTEM',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_interpretation_rules_target ON scientific_interpretation_rules (target_variable_or_metric);

CREATE TABLE IF NOT EXISTS scientific_interpretation_rule_references (
    rule_id VARCHAR(64) NOT NULL REFERENCES scientific_interpretation_rules(rule_id) ON DELETE CASCADE,
    reference_id VARCHAR(64) NOT NULL REFERENCES scientific_references(reference_id) ON DELETE CASCADE,
    PRIMARY KEY (rule_id, reference_id)
);


-- ============================================================================
-- SECTION 2: IDENTITY, AUTHENTICATION & GOVERNANCE
-- ============================================================================

-- 9. Users & Credentials (Baseline: 4 records)
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(64) PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    name VARCHAR(128) NOT NULL,
    display_name VARCHAR(128),
    role VARCHAR(32) NOT NULL CONSTRAINT users_role_check
        CHECK (role IN ('RegisteredUser', 'Student', 'Lecturer', 'Researcher', 'Admin')),
    permissions JSONB NOT NULL DEFAULT '[]', -- Array of permission strings
    organization VARCHAR(255),
    avatar_url TEXT,
    account_status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE' CONSTRAINT users_account_status_check CHECK (account_status IN ('ACTIVE', 'SUSPENDED', 'DISABLED')),
    email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    provider VARCHAR(32) NOT NULL DEFAULT 'local' CONSTRAINT users_provider_check CHECK (provider IN ('local', 'google')),
    provider_subject_id VARCHAR(255),
    is_main_admin BOOLEAN NOT NULL DEFAULT FALSE,
    governance_granted_at TIMESTAMPTZ,
    governance_granted_by VARCHAR(64),
    token_version INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_login_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);
CREATE INDEX IF NOT EXISTS idx_users_account_status ON users (account_status);
CREATE INDEX IF NOT EXISTS idx_users_provider_subject ON users (provider, provider_subject_id);

-- 10. External Federated Identities (OIDC) (Baseline: 0 records, typed schema)
CREATE TABLE IF NOT EXISTS external_identities (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider VARCHAR(32) NOT NULL CONSTRAINT external_identities_provider_check CHECK (provider IN ('google', 'local')),
    provider_subject_id VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    linked_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_external_identities_provider_subject UNIQUE (provider, provider_subject_id)
);

CREATE INDEX IF NOT EXISTS idx_external_identities_user_id ON external_identities (user_id);

-- 11. Role Elevation & Governance Requests (Baseline: 0 records, typed schema)
CREATE TABLE IF NOT EXISTS role_requests (
    request_id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    requested_role VARCHAR(32) NOT NULL CONSTRAINT role_requests_requested_role_check
        CHECK (requested_role IN ('Student', 'Lecturer', 'Researcher', 'Admin')),
    approval_status VARCHAR(32) NOT NULL DEFAULT 'PENDING' CONSTRAINT role_requests_approval_status_check CHECK (approval_status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
    institution VARCHAR(255),
    justification TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reviewed_by VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    review_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_role_requests_status ON role_requests (approval_status);
CREATE INDEX IF NOT EXISTS idx_role_requests_user ON role_requests (user_id);


-- ============================================================================
-- SECTION 3: COLLABORATION, TEAMS & PROJECTS
-- ============================================================================

-- 12. Teams (Baseline: 1 record)
CREATE TABLE IF NOT EXISTS teams (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    description TEXT,
    owner_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_teams_owner_id ON teams (owner_id);

-- 13. Team Memberships (Baseline: 3 records)
CREATE TABLE IF NOT EXISTS team_members (
    id VARCHAR(64) PRIMARY KEY,
    team_id VARCHAR(64) NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(32) NOT NULL CONSTRAINT team_members_role_check CHECK (role IN ('Owner', 'Editor', 'Collaborator', 'Viewer')),
    joined_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_team_members_team_user UNIQUE (team_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members (user_id);

-- 14. Projects (Baseline: 2 records)
CREATE TABLE IF NOT EXISTS projects (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    description TEXT,
    type VARCHAR(32) NOT NULL CONSTRAINT projects_type_check CHECK (type IN ('Personal', 'Academic', 'Research', 'Experiment', 'Team', 'Assignment')),
    owner_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    team_id VARCHAR(64) REFERENCES teams(id) ON DELETE SET NULL,
    is_public BOOLEAN NOT NULL DEFAULT FALSE,
    tags JSONB NOT NULL DEFAULT '[]', -- Array of text tags
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_projects_owner_id ON projects (owner_id);
CREATE INDEX IF NOT EXISTS idx_projects_team_id ON projects (team_id);
CREATE INDEX IF NOT EXISTS idx_projects_is_public ON projects (is_public);

-- 15. Project Memberships (Baseline: 4 records)
CREATE TABLE IF NOT EXISTS project_members (
    id VARCHAR(64) PRIMARY KEY,
    project_id VARCHAR(64) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(32) NOT NULL CONSTRAINT project_members_role_check CHECK (role IN ('Owner', 'Editor', 'Collaborator', 'Viewer')),
    joined_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_project_members_project_user UNIQUE (project_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members (user_id);


-- ============================================================================
-- SECTION 4: ACADEMIC MATERIALS, COLLECTIONS & STUDY ANNOTATIONS
-- ============================================================================

-- 16. Academic & Reference Materials (Baseline: 2 records)
CREATE TABLE IF NOT EXISTS materials (
    id VARCHAR(64) PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    author VARCHAR(255),
    subject VARCHAR(128),
    type VARCHAR(32) NOT NULL CONSTRAINT materials_type_check CHECK (type IN ('PDF', 'TXT', 'EPUB', 'DOCX', 'PPTX', 'XLSX', 'CSV', 'IMAGE')),
    description TEXT,
    year INTEGER CONSTRAINT materials_year_check CHECK (year >= 1800 AND year <= 2100),
    publisher VARCHAR(255),
    language VARCHAR(16) DEFAULT 'en',
    url TEXT,
    source VARCHAR(255),
    license VARCHAR(64),
    tags JSONB NOT NULL DEFAULT '[]',
    version VARCHAR(32) DEFAULT '1.0.0',
    uploaded_by VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    file_path TEXT NOT NULL,
    file_size_bytes BIGINT NOT NULL CONSTRAINT materials_file_size_bytes_check CHECK (file_size_bytes >= 0),
    mime_type VARCHAR(64) NOT NULL,
    file_hash VARCHAR(128),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_materials_uploaded_by ON materials (uploaded_by);
CREATE INDEX IF NOT EXISTS idx_materials_type ON materials (type);

-- Junction table: Material to Project linkage (M:N)
CREATE TABLE IF NOT EXISTS material_projects (
    material_id VARCHAR(64) NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
    project_id VARCHAR(64) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    PRIMARY KEY (material_id, project_id)
);

-- 17. Material Curated Collections (Baseline: 1 record)
CREATE TABLE IF NOT EXISTS material_collections (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    description TEXT,
    color VARCHAR(32),
    created_by VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Junction: Collection to Materials (M:N)
CREATE TABLE IF NOT EXISTS collection_materials (
    collection_id VARCHAR(64) NOT NULL REFERENCES material_collections(id) ON DELETE CASCADE,
    material_id VARCHAR(64) NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
    PRIMARY KEY (collection_id, material_id)
);

-- 18. Reading Progress Tracking (Baseline: 1 record)
CREATE TABLE IF NOT EXISTS reading_progress (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    material_id VARCHAR(64) NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
    last_page INTEGER NOT NULL DEFAULT 1,
    total_pages INTEGER NOT NULL DEFAULT 1,
    progress_pct DOUBLE PRECISION NOT NULL DEFAULT 0.0 CONSTRAINT reading_progress_progress_pct_check CHECK (progress_pct >= 0.0 AND progress_pct <= 100.0),
    scroll_position DOUBLE PRECISION DEFAULT 0.0,
    last_accessed TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_reading_progress_user_material UNIQUE (user_id, material_id)
);

CREATE INDEX IF NOT EXISTS idx_reading_progress_user ON reading_progress (user_id);

-- 19. Academic Bookmarks (Baseline: 1 record)
CREATE TABLE IF NOT EXISTS bookmarks (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    material_id VARCHAR(64) NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
    page INTEGER NOT NULL CONSTRAINT bookmarks_page_check CHECK (page >= 1),
    title VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_bookmarks_user_material ON bookmarks (user_id, material_id);

-- 20. Study Highlights (Baseline: 1 record)
CREATE TABLE IF NOT EXISTS highlights (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    material_id VARCHAR(64) NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
    page INTEGER NOT NULL CONSTRAINT highlights_page_check CHECK (page >= 1),
    selected_text TEXT NOT NULL,
    color VARCHAR(32) NOT NULL DEFAULT 'yellow',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_highlights_user_material ON highlights (user_id, material_id);

-- 21. Study & Research Notes (Baseline: 1 record)
CREATE TABLE IF NOT EXISTS notes (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    material_id VARCHAR(64) REFERENCES materials(id) ON DELETE CASCADE,
    page INTEGER,
    selected_text TEXT,
    project_id VARCHAR(64) REFERENCES projects(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_notes_user_project ON notes (user_id, project_id);
CREATE INDEX IF NOT EXISTS idx_notes_material ON notes (material_id);


-- ============================================================================
-- SECTION 5: DATASETS, VERSIONS & SCIENTIFIC ANALYSES
-- ============================================================================

-- 22. Clinical Datasets (Baseline: 1 record)
CREATE TABLE IF NOT EXISTS datasets (
    id VARCHAR(64) PRIMARY KEY,
    project_id VARCHAR(64) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name VARCHAR(128) NOT NULL,
    description TEXT,
    source_file VARCHAR(255) NOT NULL,
    uploaded_by VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    current_version VARCHAR(32) DEFAULT 'v1.0',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_datasets_project_id ON datasets (project_id);

-- 23. Immutable Dataset Versions (Baseline: 2 records)
CREATE TABLE IF NOT EXISTS dataset_versions (
    id VARCHAR(64) PRIMARY KEY,
    dataset_id VARCHAR(64) NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
    version_tag VARCHAR(32) NOT NULL, -- e.g. "v1.0", "v1.1"
    parent_version_tag VARCHAR(32),
    state VARCHAR(32) NOT NULL CONSTRAINT dataset_versions_state_check CHECK (state IN ('RAW', 'WORKING_COPY', 'CLEANED', 'VALIDATED', 'ANALYSIS_READY')),
    columns JSONB NOT NULL, -- Schema metadata: [{ name, detected_type, role, nullable }]
    data JSONB NOT NULL, -- Tabular payload: array of JSON rows [{ subject_id, sex, ... }]
    validation_report JSONB NOT NULL, -- { is_valid, row_count, column_count, null_counts, warnings }
    transformation_applied TEXT,
    created_by VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_dataset_versions_dataset_tag UNIQUE (dataset_id, version_tag)
);

CREATE INDEX IF NOT EXISTS idx_dataset_versions_dataset ON dataset_versions (dataset_id);
CREATE INDEX IF NOT EXISTS idx_dataset_versions_state ON dataset_versions (state);

-- 24. Inferential & Statistical Analyses (Baseline: 1 record)
CREATE TABLE IF NOT EXISTS statistics_analyses (
    id VARCHAR(64) PRIMARY KEY,
    project_id VARCHAR(64) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    dataset_version_id VARCHAR(64) NOT NULL REFERENCES dataset_versions(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    analysis_type VARCHAR(64) NOT NULL CONSTRAINT statistics_analyses_analysis_type_check CHECK (analysis_type IN (
        'DESCRIPTIVE', 'TWO_GROUP_COMPARISON', 'MULTIPLE_GROUP_ANOVA',
        'CORRELATION', 'LINEAR_REGRESSION', 'DIAGNOSTICS'
    )),
    target_columns JSONB NOT NULL, -- Array of column name strings: ["weight_kg", "rmr_measured"]
    grouping_column VARCHAR(64),
    method_justification TEXT NOT NULL,
    results JSONB NOT NULL, -- Rich statistical output dictionary
    provenance_hash VARCHAR(128) NOT NULL,
    created_by VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_statistics_analyses_project ON statistics_analyses (project_id);
CREATE INDEX IF NOT EXISTS idx_statistics_analyses_dataset_ver ON statistics_analyses (dataset_version_id);

-- 25. Visualization Charts (Baseline: 1 record)
CREATE TABLE IF NOT EXISTS charts (
    id VARCHAR(64) PRIMARY KEY,
    project_id VARCHAR(64) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    dataset_version_id VARCHAR(64) REFERENCES dataset_versions(id) ON DELETE SET NULL,
    analysis_id VARCHAR(64) REFERENCES statistics_analyses(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    chart_type VARCHAR(32) NOT NULL CONSTRAINT charts_chart_type_check CHECK (chart_type IN ('LINE', 'BAR', 'HISTOGRAM', 'SCATTER', 'BOX_PLOT')),
    x_field VARCHAR(64),
    y_field VARCHAR(64),
    group_by VARCHAR(64),
    config JSONB NOT NULL DEFAULT '{}', -- Axis titles, scales, visual color palettes
    created_by VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_charts_project ON charts (project_id);
CREATE INDEX IF NOT EXISTS idx_charts_analysis ON charts (analysis_id);


-- ============================================================================
-- SECTION 6: NOTEBOOKS, CODE EXECUTIONS & IN SILICO EXPERIMENTS
-- ============================================================================

-- 26. Computational Research Notebooks (Baseline: 1 record)
CREATE TABLE IF NOT EXISTS notebooks (
    id VARCHAR(64) PRIMARY KEY,
    project_id VARCHAR(64) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    created_by VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_notebooks_project ON notebooks (project_id);

-- 27. Notebook Cells (Baseline: 5 records)
CREATE TABLE IF NOT EXISTS notebook_cells (
    id VARCHAR(64) PRIMARY KEY,
    notebook_id VARCHAR(64) NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
    cell_type VARCHAR(32) NOT NULL CONSTRAINT notebook_cells_cell_type_check CHECK (cell_type IN ('TEXT', 'DATA', 'FORMULA', 'CODE', 'CHART', 'TABLE', 'EXPERIMENT', 'REFERENCE')),
    order_index INTEGER NOT NULL CONSTRAINT notebook_cells_order_index_check CHECK (order_index >= 0),
    title VARCHAR(255),
    content TEXT NOT NULL,
    metadata JSONB,
    CONSTRAINT uq_notebook_cells_order UNIQUE (notebook_id, order_index)
);

CREATE INDEX IF NOT EXISTS idx_notebook_cells_notebook ON notebook_cells (notebook_id);

-- 28. Isolated Code Execution Audit Logs (Baseline: 0 records, typed schema)
CREATE TABLE IF NOT EXISTS code_executions (
    id VARCHAR(64) PRIMARY KEY,
    project_id VARCHAR(64) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    language VARCHAR(32) NOT NULL CONSTRAINT code_executions_language_check CHECK (language IN ('PYTHON', 'R', 'SQL', 'JAVASCRIPT')),
    code TEXT NOT NULL,
    output TEXT NOT NULL,
    error TEXT,
    execution_time_ms INTEGER NOT NULL CONSTRAINT code_executions_execution_time_ms_check CHECK (execution_time_ms >= 0),
    environment_info TEXT NOT NULL,
    executed_by VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_code_executions_project ON code_executions (project_id);
CREATE INDEX IF NOT EXISTS idx_code_executions_user ON code_executions (executed_by);

-- 29. In Silico Controlled Experiments (Baseline: 1 record)
CREATE TABLE IF NOT EXISTS experiments (
    id VARCHAR(64) PRIMARY KEY,
    project_id VARCHAR(64) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    baseline_model_id VARCHAR(64) NOT NULL REFERENCES scientific_models(model_id) ON DELETE RESTRICT,
    -- [DECISION_PENDING]: experimental_model_id in baseline contains clone identifier ('MODEL_DEMO_ANTHROPOMETRY_V1_CLONE')
    -- which is not a static entry in scientific_models. Therefore, FK constraint is relaxed to TEXT pending clone registry formalization.
    experimental_model_id VARCHAR(64) NOT NULL,
    parameter_modifications JSONB NOT NULL, -- Array of parameter change specs [{ parameter_id, baseline_value, experimental_value }]
    baseline_output JSONB NOT NULL, -- Simulation result metrics
    experimental_output JSONB NOT NULL, -- Simulated clone result metrics
    delta_summary TEXT,
    status VARCHAR(32) NOT NULL DEFAULT 'COMPLETED' CONSTRAINT experiments_status_check CHECK (status IN ('DRAFT', 'RUNNING', 'COMPLETED', 'FAILED')),
    provenance_hash VARCHAR(128) NOT NULL,
    created_by VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_experiments_project ON experiments (project_id);
CREATE INDEX IF NOT EXISTS idx_experiments_baseline_model ON experiments (baseline_model_id);


-- ============================================================================
-- SECTION 7: PROVENANCE, AUDIT TRAIL & REPRODUCIBILITY
-- ============================================================================

-- 30. Immutable Provenance Records (Baseline: 1 record)
CREATE TABLE IF NOT EXISTS provenance_records (
    id VARCHAR(64) PRIMARY KEY,
    project_id VARCHAR(64) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    target_entity_type VARCHAR(64) NOT NULL,
    target_entity_id VARCHAR(64) NOT NULL,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    dataset_version_id VARCHAR(64) REFERENCES dataset_versions(id) ON DELETE SET NULL,
    model_version VARCHAR(32),
    parameter_version VARCHAR(32),
    environment_specs TEXT,
    provenance_hash VARCHAR(128) NOT NULL,
    reproducibility_manifest JSONB NOT NULL, -- Full deterministic manifest
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_provenance_records_project ON provenance_records (project_id);
CREATE INDEX IF NOT EXISTS idx_provenance_records_target ON provenance_records (target_entity_type, target_entity_id);
CREATE INDEX IF NOT EXISTS idx_provenance_records_hash ON provenance_records (provenance_hash);

-- 31. System Security & Operational Audit Logs (Baseline: 1 record)
CREATE TABLE IF NOT EXISTS audit_logs (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    user_name VARCHAR(128),
    action VARCHAR(64) NOT NULL,
    entity_type VARCHAR(64) NOT NULL,
    entity_id VARCHAR(64) NOT NULL,
    details TEXT NOT NULL,
    ip_address VARCHAR(64),
    timestamp TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs (action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs (timestamp);

-- 32. Scientific Calculation Execution Traces (Baseline: 0 records, typed schema)
CREATE TABLE IF NOT EXISTS scientific_calculations (
    calculation_id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    project_id VARCHAR(64) REFERENCES projects(id) ON DELETE SET NULL,
    formula_or_model_id VARCHAR(64) NOT NULL,
    version VARCHAR(32) NOT NULL DEFAULT '1.0.0',
    inputs_received JSONB NOT NULL,
    normalized_inputs JSONB NOT NULL,
    parameters_resolved JSONB NOT NULL,
    steps JSONB NOT NULL,
    final_result JSONB NOT NULL,
    explanation TEXT,
    provenance_hash VARCHAR(128) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_calculations_formula_model ON scientific_calculations (formula_or_model_id);
CREATE INDEX IF NOT EXISTS idx_calculations_user ON scientific_calculations (user_id);
CREATE INDEX IF NOT EXISTS idx_calculations_project ON scientific_calculations (project_id);
CREATE INDEX IF NOT EXISTS idx_calculations_hash ON scientific_calculations (provenance_hash);
