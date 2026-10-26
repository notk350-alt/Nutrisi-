/**
 * NutriBodySim — Deterministic JSON to PostgreSQL Migration Engine (MVS-B2.5E.1B.5)
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { TargetSafetyGuard } from './targetSafetyGuard';

export type ConflictPolicy = 'fail-on-conflict' | 'skip-existing';

export interface MigrationOptions {
  sourcePath?: string;
  dryRun?: boolean;
  targetEnv?: string;
  databaseUrl?: string;
  targetClient?: any;
  conflictPolicy?: ConflictPolicy;
  reportOutputPath?: string;
  isTestMode?: boolean;
}

export interface ValidationIssue {
  severity: 'ERROR' | 'WARNING';
  collection: string;
  recordId: string;
  field?: string;
  message: string;
}

export interface MigrationAuditReport {
  timestamp: string;
  sourceFile: string;
  sourceSha256: string;
  sourceSizeBytes: number;
  dryRun: boolean;
  targetEnv: string;
  sanitizedTargetHost?: string;
  conflictPolicy: ConflictPolicy;
  totalSourceCollections: number;
  totalSourceRecords: number;
  totalTargetTables: number;
  totalPhysicalRowsPlanned: number;
  totalPhysicalRowsWritten: number;
  sourceCollectionCounts: Record<string, number>;
  targetTableCounts: Record<string, number>;
  issues: ValidationIssue[];
  status: 'DRY_RUN_PASSED' | 'MIGRATION_SUCCESS' | 'BLOCKED_TARGET_VERIFICATION' | 'FAILED';
  blockReason?: string;
  durationMs: number;
  metadata: {
    nodeVersion: string;
    targetEngine: string;
    dependencyWaves: number;
  };
}

export interface TableBatch {
  name: string;
  primaryKey: string[];
  columns: string[];
  rows: Record<string, any>[];
}

export interface MigrationWave {
  waveNumber: number;
  name: string;
  tables: TableBatch[];
}

export class JsonToPostgresMigrator {
  private readonly sourcePath: string;
  private readonly dryRun: boolean;
  private readonly targetEnv: string;
  private readonly databaseUrl?: string;
  private readonly targetClient?: any;
  private readonly conflictPolicy: ConflictPolicy;
  private readonly reportOutputPath?: string;
  private readonly isTestMode: boolean;

  constructor(options: MigrationOptions = {}) {
    this.sourcePath = options.sourcePath || path.resolve(process.cwd(), 'data', 'nutribodysim_db.json');
    this.dryRun = options.dryRun ?? true;
    this.targetEnv = options.targetEnv || 'dry-run';
    this.databaseUrl = options.databaseUrl || process.env.DATABASE_URL;
    this.targetClient = options.targetClient;
    this.conflictPolicy = options.conflictPolicy || 'fail-on-conflict';
    this.reportOutputPath = options.reportOutputPath;
    this.isTestMode = options.isTestMode ?? false;
  }

  public computeFileHash(filePath: string): { hash: string; size: number } {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Source database file does not exist at: ${filePath}`);
    }
    const buffer = fs.readFileSync(filePath);
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    return { hash, size: buffer.length };
  }

  public buildInsertQuery(tableName: string, columns: string[], primaryKey: string[]): string {
    const colString = columns.join(', ');
    const placeholderString = columns.map((_, i) => `$${i + 1}`).join(', ');

    let sql = `INSERT INTO ${tableName} (${colString}) VALUES (${placeholderString})`;
    if (this.conflictPolicy === 'skip-existing' && primaryKey.length > 0) {
      sql += ` ON CONFLICT (${primaryKey.join(', ')}) DO NOTHING`;
    }
    return sql;
  }

  public prepareWaves(sourceDb: Record<string, any[]>): { waves: MigrationWave[]; issues: ValidationIssue[]; sourceCollectionCounts: Record<string, number> } {
    const issues: ValidationIssue[] = [];
    const sourceCollectionCounts: Record<string, number> = {};

    for (const col of Object.keys(sourceDb)) {
      const items = Array.isArray(sourceDb[col]) ? sourceDb[col] : [];
      sourceCollectionCounts[col] = items.length;
    }

    const teamIds = new Set((sourceDb.teams || []).map((t: any) => t.id));
    const projectIds = new Set((sourceDb.projects || []).map((p: any) => p.id));
    const materialIds = new Set((sourceDb.materials || []).map((m: any) => m.id));
    const collectionIds = new Set((sourceDb.material_collections || []).map((c: any) => c.id));
    const referenceIds = new Set((sourceDb.references || []).map((r: any) => r.reference_id));
    const variableIds = new Set((sourceDb.variables || []).map((v: any) => v.variable_id));
    const parameterIds = new Set((sourceDb.parameters || []).map((p: any) => p.parameter_id));
    const formulaIds = new Set((sourceDb.formulas || []).map((f: any) => f.formula_id));
    const modelIds = new Set((sourceDb.models || []).map((m: any) => m.model_id));
    const algorithmIds = new Set((sourceDb.algorithms || []).map((a: any) => a.algorithm_id));

    // Wave 1
    const unitsTarget = (sourceDb.units || []).map((u: any) => ({
      unit_id: u.unit_id,
      symbol: u.symbol,
      name: u.name,
      measurement_type: u.measurement_type,
      base_unit: u.base_unit,
      to_base_multiplier: Number(u.to_base_multiplier),
      to_base_offset: Number(u.to_base_offset || 0.0),
      description: u.description || null,
      created_at: u.created_at || new Date().toISOString()
    }));

    const referencesTarget = (sourceDb.references || []).map((r: any) => ({
      reference_id: r.reference_id,
      title: r.title,
      authors: r.authors || [],
      year: Number(r.year),
      journal_or_publisher: r.journal_or_publisher,
      doi: r.doi || null,
      citation_key: r.citation_key || null,
      abstract: r.abstract || null,
      created_at: r.created_at || new Date().toISOString()
    }));

    const usersTarget = (sourceDb.users || []).map((u: any) => ({
      id: u.id,
      email: u.email.toLowerCase(),
      name: u.name,
      display_name: u.display_name || u.name,
      role: u.role,
      permissions: u.permissions || [],
      organization: u.organization || null,
      avatar_url: u.avatar_url || null,
      account_status: u.account_status || 'ACTIVE',
      email_verified: Boolean(u.email_verified),
      provider: u.provider || 'local',
      provider_subject_id: u.provider_subject_id || null,
      is_main_admin: Boolean(u.is_main_admin),
      governance_granted_at: u.governance_granted_at || null,
      governance_granted_by: u.governance_granted_by || null,
      token_version: Number(u.token_version ?? 0),
      created_at: u.created_at || new Date().toISOString(),
      updated_at: u.updated_at || new Date().toISOString(),
      last_login_at: u.last_login_at || null
    }));

    const externalIdentitiesTarget = (sourceDb.external_identities || []).map((ei: any) => ({
      id: ei.id,
      user_id: ei.user_id,
      provider: ei.provider,
      provider_subject_id: ei.provider_subject_id,
      email: ei.email || null,
      email_verified: Boolean(ei.email_verified),
      linked_at: ei.linked_at || new Date().toISOString()
    }));

    const roleRequestsTarget = (sourceDb.role_requests || []).map((rr: any) => ({
      id: rr.id,
      user_id: rr.user_id,
      requested_role: rr.requested_role,
      approval_status: rr.approval_status || 'PENDING',
      institution: rr.institution || null,
      justification: rr.justification || null,
      reviewed_by: rr.reviewed_by || null,
      reviewed_at: rr.reviewed_at || null,
      review_reason: rr.review_reason || null,
      created_at: rr.created_at || new Date().toISOString()
    }));

    const teamsTarget = (sourceDb.teams || []).map((t: any) => ({
      id: t.id,
      name: t.name,
      description: t.description || null,
      owner_id: t.owner_id,
      created_at: t.created_at || new Date().toISOString()
    }));

    // Wave 2
    const variablesTarget = (sourceDb.variables || []).map((v: any) => ({
      variable_id: v.variable_id,
      name: v.name,
      label: v.label,
      definition: v.definition || null,
      datatype: v.datatype,
      unit: v.unit,
      measurement_type: v.measurement_type,
      allowed_range: v.allowed_range || null,
      population: v.population || null,
      source_reference: referenceIds.has(v.source_reference) ? v.source_reference : null,
      version: v.version || '1.0.0',
      status: v.status || 'EXPERIMENTAL',
      created_at: v.created_at || new Date().toISOString(),
      updated_at: v.updated_at || new Date().toISOString()
    }));

    const projectsTarget = (sourceDb.projects || []).map((p: any) => ({
      id: p.id,
      name: p.name,
      description: p.description || null,
      type: p.type || 'Personal',
      owner_id: p.owner_id,
      team_id: teamIds.has(p.team_id) ? p.team_id : null,
      is_public: Boolean(p.is_public),
      tags: p.tags || [],
      created_at: p.created_at || new Date().toISOString(),
      updated_at: p.updated_at || new Date().toISOString()
    }));

    // Wave 3
    const parametersTarget = (sourceDb.parameters || []).map((p: any) => ({
      parameter_id: p.parameter_id,
      name: p.name,
      symbol: p.symbol,
      unit: p.unit,
      measurement_type: p.measurement_type,
      default_value: Number(p.default_value),
      allowed_range: p.allowed_range || null,
      description: p.description || null,
      source_reference: referenceIds.has(p.source_reference) ? p.source_reference : null,
      version: p.version || '1.0.0',
      created_at: p.created_at || new Date().toISOString(),
      updated_at: p.updated_at || new Date().toISOString()
    }));

    const paramRefsTarget: any[] = [];
    for (const p of sourceDb.parameters || []) {
      for (const rId of p.references || []) {
        if (referenceIds.has(rId)) {
          paramRefsTarget.push({ parameter_id: p.parameter_id, reference_id: rId });
        }
      }
    }

    const formulasTarget = (sourceDb.formulas || []).map((f: any) => ({
      formula_id: f.formula_id,
      name: f.name,
      equation_raw: f.equation_raw,
      ast: f.ast || null,
      inputs: f.inputs || [],
      outputs: f.outputs || [],
      description: f.description || null,
      version: f.version || '1.0.0',
      status: f.status || 'VERIFIED',
      created_at: f.created_at || new Date().toISOString(),
      updated_at: f.updated_at || new Date().toISOString()
    }));

    const formulaParamsTarget: any[] = [];
    const formulaRefsTarget: any[] = [];
    for (const f of sourceDb.formulas || []) {
      for (const pId of f.parameters || []) {
        if (parameterIds.has(pId)) formulaParamsTarget.push({ formula_id: f.formula_id, parameter_id: pId });
      }
      for (const rId of f.references || []) {
        if (referenceIds.has(rId)) formulaRefsTarget.push({ formula_id: f.formula_id, reference_id: rId });
      }
    }

    const teamMembersTarget = (sourceDb.team_members || []).map((tm: any) => ({
      id: tm.id,
      team_id: tm.team_id,
      user_id: tm.user_id,
      role: tm.role || 'Member',
      joined_at: tm.joined_at || new Date().toISOString()
    }));

    const projectMembersTarget = (sourceDb.project_members || []).map((pm: any) => ({
      id: pm.id,
      project_id: pm.project_id,
      user_id: pm.user_id,
      role: pm.role || 'Viewer',
      joined_at: pm.joined_at || new Date().toISOString()
    }));

    // Wave 4
    const algorithmsTarget = (sourceDb.algorithms || []).map((a: any) => ({
      algorithm_id: a.algorithm_id,
      name: a.name,
      description: a.description || null,
      steps: a.steps || [],
      fallback_routes: a.fallback_routes || [],
      computational_complexity: a.computational_complexity || null,
      version: a.version || '1.0.0',
      status: a.status || 'VERIFIED',
      created_at: a.created_at || new Date().toISOString(),
      updated_at: a.updated_at || new Date().toISOString()
    }));

    const algorithmParamsTarget: any[] = [];
    const algorithmRefsTarget: any[] = [];
    for (const a of sourceDb.algorithms || []) {
      for (const pId of a.parameters || []) {
        if (parameterIds.has(pId)) algorithmParamsTarget.push({ algorithm_id: a.algorithm_id, parameter_id: pId });
      }
      for (const rId of a.references || []) {
        if (referenceIds.has(rId)) algorithmRefsTarget.push({ algorithm_id: a.algorithm_id, reference_id: rId });
      }
    }

    const materialsTarget = (sourceDb.materials || []).map((m: any) => ({
      id: m.id,
      title: m.title,
      author: m.author,
      subject: m.subject,
      type: m.type,
      description: m.description || null,
      year: m.year ? Number(m.year) : null,
      publisher: m.publisher || null,
      language: m.language || 'en',
      isbn: m.isbn || null,
      doi: m.doi || null,
      file_path: m.file_path,
      file_size: Number(m.file_size || 0),
      mime_type: m.mime_type,
      page_count: m.page_count ? Number(m.page_count) : null,
      checksum_sha256: m.checksum_sha256,
      uploaded_by: m.uploaded_by,
      created_at: m.created_at || new Date().toISOString(),
      updated_at: m.updated_at || new Date().toISOString()
    }));

    const materialProjectsTarget: any[] = [];
    for (const m of sourceDb.materials || []) {
      for (const pId of m.project_ids || []) {
        if (projectIds.has(pId)) materialProjectsTarget.push({ material_id: m.id, project_id: pId });
      }
    }

    const collectionsTarget = (sourceDb.material_collections || []).map((c: any) => ({
      id: c.id,
      name: c.name,
      description: c.description || null,
      created_by: c.created_by,
      is_public: Boolean(c.is_public),
      created_at: c.created_at || new Date().toISOString(),
      updated_at: c.updated_at || new Date().toISOString()
    }));

    const collectionMaterialsTarget: any[] = [];
    for (const c of sourceDb.material_collections || []) {
      for (const mId of c.material_ids || []) {
        if (materialIds.has(mId)) collectionMaterialsTarget.push({ collection_id: c.id, material_id: mId });
      }
    }

    // Wave 5
    const modelsTarget = (sourceDb.models || []).map((m: any) => ({
      model_id: m.model_id,
      name: m.name,
      description: m.description || null,
      model_type: m.model_type || 'COMPARTMENTAL',
      state_variables: m.state_variables || [],
      time_config: m.time_config || {},
      transitions: m.transitions || [],
      version: m.version || '1.0.0',
      status: m.status || 'VERIFIED',
      created_at: m.created_at || new Date().toISOString(),
      updated_at: m.updated_at || new Date().toISOString()
    }));

    const modelVarsTarget: any[] = [];
    const modelFormulasTarget: any[] = [];
    const modelAlgorithmsTarget: any[] = [];
    const modelParamsTarget: any[] = [];
    const modelRefsTarget: any[] = [];

    for (const m of sourceDb.models || []) {
      for (const vId of m.variables || []) {
        if (variableIds.has(vId)) modelVarsTarget.push({ model_id: m.model_id, variable_id: vId });
      }
      for (const fId of m.formulas || []) {
        if (formulaIds.has(fId)) modelFormulasTarget.push({ model_id: m.model_id, formula_id: fId });
      }
      for (const aId of m.algorithms || []) {
        if (algorithmIds.has(aId)) modelAlgorithmsTarget.push({ model_id: m.model_id, algorithm_id: aId });
      }
      for (const pId of m.parameters || []) {
        if (parameterIds.has(pId)) modelParamsTarget.push({ model_id: m.model_id, parameter_id: pId });
      }
      for (const rId of m.references || []) {
        if (referenceIds.has(rId)) modelRefsTarget.push({ model_id: m.model_id, reference_id: rId });
      }
    }

    const datasetsTarget = (sourceDb.datasets || []).map((d: any) => ({
      id: d.id,
      project_id: d.project_id,
      name: d.name,
      description: d.description || null,
      file_format: d.file_format || 'CSV',
      created_by: d.created_by,
      created_at: d.created_at || new Date().toISOString(),
      updated_at: d.updated_at || new Date().toISOString()
    }));

    const readingProgressTarget = (sourceDb.reading_progress || []).map((rp: any) => ({
      id: rp.id,
      user_id: rp.user_id,
      material_id: rp.material_id,
      current_page: Number(rp.current_page || 1),
      total_pages: Number(rp.total_pages || 1),
      percentage: Number(rp.percentage || 0),
      last_read_at: rp.last_read_at || new Date().toISOString()
    }));

    const bookmarksTarget = (sourceDb.bookmarks || []).map((b: any) => ({
      id: b.id,
      user_id: b.user_id,
      material_id: b.material_id,
      page: Number(b.page),
      title: b.title || null,
      created_at: b.created_at || new Date().toISOString()
    }));

    const highlightsTarget = (sourceDb.highlights || []).map((h: any) => ({
      id: h.id,
      user_id: h.user_id,
      material_id: h.material_id,
      page: Number(h.page),
      text: h.text,
      color: h.color || 'yellow',
      comment: h.comment || null,
      created_at: h.created_at || new Date().toISOString()
    }));

    const notesTarget = (sourceDb.notes || []).map((n: any) => ({
      id: n.id,
      user_id: n.user_id,
      material_id: materialIds.has(n.material_id) ? n.material_id : null,
      project_id: projectIds.has(n.project_id) ? n.project_id : null,
      title: n.title,
      content: n.content,
      page: n.page ? Number(n.page) : null,
      tags: n.tags || [],
      created_at: n.created_at || new Date().toISOString(),
      updated_at: n.updated_at || new Date().toISOString()
    }));

    // Wave 6
    const rulesTarget = (sourceDb.interpretation_rules || []).map((ir: any) => ({
      rule_id: ir.rule_id,
      name: ir.name,
      target_entity_type: ir.target_entity_type,
      target_entity_id: ir.target_entity_id,
      condition_expression: ir.condition_expression,
      thresholds: ir.thresholds || [],
      recommendation: ir.recommendation,
      evidence_level: ir.evidence_level || 'B',
      version: ir.version || '1.0.0',
      created_at: ir.created_at || new Date().toISOString(),
      updated_at: ir.updated_at || new Date().toISOString()
    }));

    const ruleRefsTarget: any[] = [];
    for (const ir of sourceDb.interpretation_rules || []) {
      for (const rId of ir.references || []) {
        if (referenceIds.has(rId)) ruleRefsTarget.push({ rule_id: ir.rule_id, reference_id: rId });
      }
    }

    const datasetVersionsTarget = (sourceDb.dataset_versions || []).map((dv: any) => ({
      id: dv.id,
      dataset_id: dv.dataset_id,
      version_number: Number(dv.version_number),
      row_count: Number(dv.row_count || 0),
      columns: dv.columns || [],
      data: dv.data || [],
      validation_report: dv.validation_report || null,
      transformation_applied: dv.transformation_applied || null,
      created_by: dv.created_by,
      created_at: dv.created_at || new Date().toISOString()
    }));

    const statisticsAnalysesTarget = (sourceDb.statistics_analyses || []).map((sa: any) => ({
      id: sa.id,
      project_id: sa.project_id,
      dataset_version_id: sa.dataset_version_id,
      analysis_type: sa.analysis_type,
      parameters: sa.parameters || {},
      results: sa.results || {},
      created_by: sa.created_by,
      created_at: sa.created_at || new Date().toISOString()
    }));

    const chartsTarget = (sourceDb.charts || []).map((c: any) => ({
      id: c.id,
      project_id: c.project_id,
      dataset_version_id: c.dataset_version_id,
      analysis_id: c.analysis_id || null,
      title: c.title,
      chart_type: c.chart_type,
      x_field: c.x_field,
      y_field: c.y_field || null,
      group_by: c.group_by || null,
      config: c.config || {},
      created_by: c.created_by,
      created_at: c.created_at || new Date().toISOString()
    }));

    const notebooksTarget = (sourceDb.notebooks || []).map((nb: any) => ({
      id: nb.id,
      project_id: nb.project_id,
      title: nb.title,
      description: nb.description || null,
      created_by: nb.created_by,
      created_at: nb.created_at || new Date().toISOString(),
      updated_at: nb.updated_at || new Date().toISOString()
    }));

    // Wave 7
    const notebookCellsTarget = (sourceDb.notebook_cells || []).map((cell: any) => ({
      id: cell.id,
      notebook_id: cell.notebook_id,
      cell_type: cell.cell_type,
      order_index: Number(cell.order_index ?? cell.order ?? 0),
      title: cell.title || null,
      content: cell.content || ''
    }));

    const codeExecutionsTarget = (sourceDb.code_executions || []).map((ce: any) => ({
      id: ce.id,
      project_id: ce.project_id,
      language: ce.language,
      code: ce.code,
      output: ce.output || '',
      error: ce.error || null,
      execution_time_ms: Number(ce.execution_time_ms || 0),
      environment_info: ce.environment_info || 'isolated_node',
      executed_by: ce.executed_by,
      created_at: ce.created_at || new Date().toISOString()
    }));

    const experimentsTarget = (sourceDb.experiments || []).map((exp: any) => {
      if (!modelIds.has(exp.baseline_model_id)) {
        issues.push({
          severity: 'ERROR',
          collection: 'experiments',
          recordId: exp.id,
          field: 'baseline_model_id',
          message: `Baseline model '${exp.baseline_model_id}' does not exist in scientific_models.`
        });
      }
      if (!modelIds.has(exp.experimental_model_id)) {
        issues.push({
          severity: 'WARNING',
          collection: 'experiments',
          recordId: exp.id,
          field: 'experimental_model_id',
          message: `[DECISION_PENDING] Experimental model ID '${exp.experimental_model_id}' is a variant clone tag and does not exist in models. Preserved as text without direct FK.`
        });
      }
      return {
        id: exp.id,
        project_id: exp.project_id,
        title: exp.title,
        description: exp.description || null,
        baseline_model_id: exp.baseline_model_id,
        experimental_model_id: exp.experimental_model_id,
        parameter_modifications: exp.parameter_modifications || {},
        baseline_output: exp.baseline_output || {},
        experimental_output: exp.experimental_output || {},
        delta_summary: exp.delta_summary || null,
        status: exp.status || 'COMPLETED',
        provenance_hash: exp.provenance_hash || 'none',
        created_by: exp.created_by,
        created_at: exp.created_at || new Date().toISOString(),
        updated_at: exp.updated_at || new Date().toISOString()
      };
    });

    const calculationsTarget = (sourceDb.calculations || []).map((calc: any) => ({
      calculation_id: calc.calculation_id || calc.id,
      user_id: calc.user_id,
      formula_id: calc.formula_id,
      inputs: calc.inputs || {},
      result: Number(calc.result || 0),
      unit: calc.unit,
      execution_time_ms: Number(calc.execution_time_ms || 0),
      trace: calc.trace || {},
      created_at: calc.created_at || new Date().toISOString()
    }));

    const provenanceRecordsTarget = (sourceDb.provenance_records || []).map((pr: any) => ({
      id: pr.id,
      project_id: pr.project_id,
      target_entity_type: pr.target_entity_type,
      target_entity_id: pr.target_entity_id,
      user_id: pr.user_id,
      dataset_version_id: pr.dataset_version_id || null,
      formula_version: pr.formula_version || null,
      model_version: pr.model_version || null,
      parameter_version: pr.parameter_version || null,
      code_hash: pr.code_hash || null,
      input_signature: pr.input_signature || null,
      output_signature: pr.output_signature || null,
      timestamp: pr.timestamp || new Date().toISOString()
    }));

    const auditLogsTarget = (sourceDb.audit_logs || []).map((al: any) => ({
      id: al.id,
      user_id: al.user_id,
      user_name: al.user_name || 'System',
      action: al.action,
      entity_type: al.entity_type,
      entity_id: al.entity_id,
      details: typeof al.details === 'string' ? al.details : JSON.stringify(al.details || {}),
      ip_address: al.ip_address || null,
      timestamp: al.timestamp || new Date().toISOString()
    }));

    const waves: MigrationWave[] = [
      {
        waveNumber: 1,
        name: 'Master Standards & Root Identifiers',
        tables: [
          { name: 'scientific_units', primaryKey: ['unit_id'], columns: Object.keys(unitsTarget[0] || {}), rows: unitsTarget },
          { name: 'scientific_references', primaryKey: ['reference_id'], columns: Object.keys(referencesTarget[0] || {}), rows: referencesTarget },
          { name: 'users', primaryKey: ['id'], columns: Object.keys(usersTarget[0] || {}), rows: usersTarget },
          { name: 'external_identities', primaryKey: ['id'], columns: ['id', 'user_id', 'provider', 'provider_subject_id', 'email', 'email_verified', 'linked_at'], rows: externalIdentitiesTarget },
          { name: 'role_requests', primaryKey: ['id'], columns: ['id', 'user_id', 'requested_role', 'approval_status', 'institution', 'justification', 'reviewed_by', 'reviewed_at', 'review_reason', 'created_at'], rows: roleRequestsTarget },
          { name: 'teams', primaryKey: ['id'], columns: Object.keys(teamsTarget[0] || {}), rows: teamsTarget }
        ]
      },
      {
        waveNumber: 2,
        name: 'Variables & Projects',
        tables: [
          { name: 'scientific_variables', primaryKey: ['variable_id'], columns: Object.keys(variablesTarget[0] || {}), rows: variablesTarget },
          { name: 'projects', primaryKey: ['id'], columns: Object.keys(projectsTarget[0] || {}), rows: projectsTarget }
        ]
      },
      {
        waveNumber: 3,
        name: 'Parameters, Formulas & Memberships',
        tables: [
          { name: 'scientific_parameters', primaryKey: ['parameter_id'], columns: Object.keys(parametersTarget[0] || {}), rows: parametersTarget },
          { name: 'scientific_parameter_references', primaryKey: ['parameter_id', 'reference_id'], columns: ['parameter_id', 'reference_id'], rows: paramRefsTarget },
          { name: 'scientific_formulas', primaryKey: ['formula_id'], columns: Object.keys(formulasTarget[0] || {}), rows: formulasTarget },
          { name: 'scientific_formula_parameters', primaryKey: ['formula_id', 'parameter_id'], columns: ['formula_id', 'parameter_id'], rows: formulaParamsTarget },
          { name: 'scientific_formula_references', primaryKey: ['formula_id', 'reference_id'], columns: ['formula_id', 'reference_id'], rows: formulaRefsTarget },
          { name: 'team_members', primaryKey: ['id'], columns: Object.keys(teamMembersTarget[0] || {}), rows: teamMembersTarget },
          { name: 'project_members', primaryKey: ['id'], columns: Object.keys(projectMembersTarget[0] || {}), rows: projectMembersTarget }
        ]
      },
      {
        waveNumber: 4,
        name: 'Algorithms & Materials',
        tables: [
          { name: 'scientific_algorithms', primaryKey: ['algorithm_id'], columns: ['algorithm_id', 'name', 'description', 'steps', 'fallback_routes', 'computational_complexity', 'version', 'status', 'created_at', 'updated_at'], rows: algorithmsTarget },
          { name: 'scientific_algorithm_parameters', primaryKey: ['algorithm_id', 'parameter_id'], columns: ['algorithm_id', 'parameter_id'], rows: algorithmParamsTarget },
          { name: 'scientific_algorithm_references', primaryKey: ['algorithm_id', 'reference_id'], columns: ['algorithm_id', 'reference_id'], rows: algorithmRefsTarget },
          { name: 'materials', primaryKey: ['id'], columns: Object.keys(materialsTarget[0] || {}), rows: materialsTarget },
          { name: 'material_projects', primaryKey: ['material_id', 'project_id'], columns: ['material_id', 'project_id'], rows: materialProjectsTarget },
          { name: 'material_collections', primaryKey: ['id'], columns: Object.keys(collectionsTarget[0] || {}), rows: collectionsTarget },
          { name: 'collection_materials', primaryKey: ['collection_id', 'material_id'], columns: ['collection_id', 'material_id'], rows: collectionMaterialsTarget }
        ]
      },
      {
        waveNumber: 5,
        name: 'Models, Datasets & Reading Annotations',
        tables: [
          { name: 'scientific_models', primaryKey: ['model_id'], columns: Object.keys(modelsTarget[0] || {}), rows: modelsTarget },
          { name: 'scientific_model_variables', primaryKey: ['model_id', 'variable_id'], columns: ['model_id', 'variable_id'], rows: modelVarsTarget },
          { name: 'scientific_model_formulas', primaryKey: ['model_id', 'formula_id'], columns: ['model_id', 'formula_id'], rows: modelFormulasTarget },
          { name: 'scientific_model_algorithms', primaryKey: ['model_id', 'algorithm_id'], columns: ['model_id', 'algorithm_id'], rows: modelAlgorithmsTarget },
          { name: 'scientific_model_parameters', primaryKey: ['model_id', 'parameter_id'], columns: ['model_id', 'parameter_id'], rows: modelParamsTarget },
          { name: 'scientific_model_references', primaryKey: ['model_id', 'reference_id'], columns: ['model_id', 'reference_id'], rows: modelRefsTarget },
          { name: 'datasets', primaryKey: ['id'], columns: Object.keys(datasetsTarget[0] || {}), rows: datasetsTarget },
          { name: 'reading_progress', primaryKey: ['id'], columns: Object.keys(readingProgressTarget[0] || {}), rows: readingProgressTarget },
          { name: 'bookmarks', primaryKey: ['id'], columns: Object.keys(bookmarksTarget[0] || {}), rows: bookmarksTarget },
          { name: 'highlights', primaryKey: ['id'], columns: Object.keys(highlightsTarget[0] || {}), rows: highlightsTarget },
          { name: 'notes', primaryKey: ['id'], columns: Object.keys(notesTarget[0] || {}), rows: notesTarget }
        ]
      },
      {
        waveNumber: 6,
        name: 'Rules, Versions, Analyses, Charts & Notebooks',
        tables: [
          { name: 'scientific_interpretation_rules', primaryKey: ['rule_id'], columns: Object.keys(rulesTarget[0] || {}), rows: rulesTarget },
          { name: 'scientific_interpretation_rule_references', primaryKey: ['rule_id', 'reference_id'], columns: ['rule_id', 'reference_id'], rows: ruleRefsTarget },
          { name: 'dataset_versions', primaryKey: ['id'], columns: Object.keys(datasetVersionsTarget[0] || {}), rows: datasetVersionsTarget },
          { name: 'statistics_analyses', primaryKey: ['id'], columns: Object.keys(statisticsAnalysesTarget[0] || {}), rows: statisticsAnalysesTarget },
          { name: 'charts', primaryKey: ['id'], columns: Object.keys(chartsTarget[0] || {}), rows: chartsTarget },
          { name: 'notebooks', primaryKey: ['id'], columns: Object.keys(notebooksTarget[0] || {}), rows: notebooksTarget }
        ]
      },
      {
        waveNumber: 7,
        name: 'Cells, Executions, Experiments, Calculations & Audit',
        tables: [
          { name: 'notebook_cells', primaryKey: ['id'], columns: Object.keys(notebookCellsTarget[0] || {}), rows: notebookCellsTarget },
          { name: 'code_executions', primaryKey: ['id'], columns: ['id', 'project_id', 'language', 'code', 'output', 'error', 'execution_time_ms', 'environment_info', 'executed_by', 'created_at'], rows: codeExecutionsTarget },
          { name: 'experiments', primaryKey: ['id'], columns: Object.keys(experimentsTarget[0] || {}), rows: experimentsTarget },
          { name: 'scientific_calculations', primaryKey: ['calculation_id'], columns: ['calculation_id', 'user_id', 'formula_id', 'inputs', 'result', 'unit', 'execution_time_ms', 'trace', 'created_at'], rows: calculationsTarget },
          { name: 'provenance_records', primaryKey: ['id'], columns: Object.keys(provenanceRecordsTarget[0] || {}), rows: provenanceRecordsTarget },
          { name: 'audit_logs', primaryKey: ['id'], columns: Object.keys(auditLogsTarget[0] || {}), rows: auditLogsTarget }
        ]
      }
    ];

    return { waves, issues, sourceCollectionCounts };
  }

  public async execute(): Promise<MigrationAuditReport> {
    const startTime = Date.now();
    const { hash: sourceSha256, size: sourceSizeBytes } = this.computeFileHash(this.sourcePath);

    const rawContent = fs.readFileSync(this.sourcePath, 'utf-8');
    const sourceDb: Record<string, any[]> = JSON.parse(rawContent);

    const { waves, issues, sourceCollectionCounts } = this.prepareWaves(sourceDb);

    let totalSourceRecords = 0;
    for (const count of Object.values(sourceCollectionCounts)) {
      totalSourceRecords += count;
    }

    const targetTableCounts: Record<string, number> = {};
    let totalPhysicalRowsPlanned = 0;
    let totalTablesCount = 0;

    for (const wave of waves) {
      for (const table of wave.tables) {
        targetTableCounts[table.name] = table.rows.length;
        totalPhysicalRowsPlanned += table.rows.length;
        totalTablesCount++;
      }
    }

    const hasFatalErrors = issues.some((i) => i.severity === 'ERROR');

    // -------------------------------------------------------------------------
    // Execution Branch A: Dry-Run Mode
    // -------------------------------------------------------------------------
    if (this.dryRun) {
      const durationMs = Date.now() - startTime;
      const report: MigrationAuditReport = {
        timestamp: new Date().toISOString(),
        sourceFile: this.sourcePath,
        sourceSha256,
        sourceSizeBytes,
        dryRun: true,
        targetEnv: this.targetEnv,
        conflictPolicy: this.conflictPolicy,
        totalSourceCollections: Object.keys(sourceCollectionCounts).length,
        totalSourceRecords,
        totalTargetTables: totalTablesCount,
        totalPhysicalRowsPlanned,
        totalPhysicalRowsWritten: 0,
        sourceCollectionCounts,
        targetTableCounts,
        issues,
        status: hasFatalErrors ? 'FAILED' : 'DRY_RUN_PASSED',
        durationMs,
        metadata: {
          nodeVersion: process.version,
          targetEngine: 'PostgreSQL 15+ / Neon',
          dependencyWaves: waves.length
        }
      };

      if (this.reportOutputPath) {
        fs.mkdirSync(path.dirname(this.reportOutputPath), { recursive: true });
        fs.writeFileSync(this.reportOutputPath, JSON.stringify(report, null, 2), 'utf-8');
      }

      return report;
    }

    // -------------------------------------------------------------------------
    // Execution Branch B: Physical Migration (--execute)
    // -------------------------------------------------------------------------
    const guardResult = TargetSafetyGuard.validate({
      targetEnv: this.targetEnv,
      databaseUrl: this.databaseUrl,
      isTestMode: this.isTestMode
    });

    if (!guardResult.allowed) {
      const durationMs = Date.now() - startTime;
      const report: MigrationAuditReport = {
        timestamp: new Date().toISOString(),
        sourceFile: this.sourcePath,
        sourceSha256,
        sourceSizeBytes,
        dryRun: false,
        targetEnv: this.targetEnv,
        sanitizedTargetHost: guardResult.sanitizedHost,
        conflictPolicy: this.conflictPolicy,
        totalSourceCollections: Object.keys(sourceCollectionCounts).length,
        totalSourceRecords,
        totalTargetTables: totalTablesCount,
        totalPhysicalRowsPlanned,
        totalPhysicalRowsWritten: 0,
        sourceCollectionCounts,
        targetTableCounts,
        issues,
        status: 'BLOCKED_TARGET_VERIFICATION',
        blockReason: guardResult.reason,
        durationMs,
        metadata: {
          nodeVersion: process.version,
          targetEngine: 'PostgreSQL 15+ / Neon',
          dependencyWaves: waves.length
        }
      };

      if (this.reportOutputPath) {
        fs.mkdirSync(path.dirname(this.reportOutputPath), { recursive: true });
        fs.writeFileSync(this.reportOutputPath, JSON.stringify(report, null, 2), 'utf-8');
      }

      return report;
    }

    if (!this.targetClient) {
      const durationMs = Date.now() - startTime;
      const report: MigrationAuditReport = {
        timestamp: new Date().toISOString(),
        sourceFile: this.sourcePath,
        sourceSha256,
        sourceSizeBytes,
        dryRun: false,
        targetEnv: this.targetEnv,
        sanitizedTargetHost: guardResult.sanitizedHost,
        conflictPolicy: this.conflictPolicy,
        totalSourceCollections: Object.keys(sourceCollectionCounts).length,
        totalSourceRecords,
        totalTargetTables: totalTablesCount,
        totalPhysicalRowsPlanned,
        totalPhysicalRowsWritten: 0,
        sourceCollectionCounts,
        targetTableCounts,
        issues,
        status: 'BLOCKED_TARGET_VERIFICATION',
        blockReason: 'Physical execution blocked: No initialized database client provided to migrator.',
        durationMs,
        metadata: {
          nodeVersion: process.version,
          targetEngine: 'PostgreSQL 15+ / Neon',
          dependencyWaves: waves.length
        }
      };

      if (this.reportOutputPath) {
        fs.mkdirSync(path.dirname(this.reportOutputPath), { recursive: true });
        fs.writeFileSync(this.reportOutputPath, JSON.stringify(report, null, 2), 'utf-8');
      }

      return report;
    }

    let rowsWritten = 0;
    const client = typeof this.targetClient.connect === 'function'
      ? await this.targetClient.connect()
      : this.targetClient;

    try {
      await client.query('BEGIN');

      for (const wave of waves) {
        for (const table of wave.tables) {
          if (table.rows.length === 0) continue;

          const columns = table.columns.length > 0 ? table.columns : Object.keys(table.rows[0]);
          const querySql = this.buildInsertQuery(table.name, columns, table.primaryKey);

          for (const row of table.rows) {
            const values = columns.map((col) => {
              const val = row[col];
              if (val === undefined || val === null) return null;
              if (typeof val === 'object' && !(val instanceof Date)) {
                return JSON.stringify(val);
              }
              return val;
            });

            await client.query(querySql, values);
            rowsWritten++;
          }
        }
      }

      await client.query('COMMIT');

      const durationMs = Date.now() - startTime;
      const report: MigrationAuditReport = {
        timestamp: new Date().toISOString(),
        sourceFile: this.sourcePath,
        sourceSha256,
        sourceSizeBytes,
        dryRun: false,
        targetEnv: this.targetEnv,
        sanitizedTargetHost: guardResult.sanitizedHost,
        conflictPolicy: this.conflictPolicy,
        totalSourceCollections: Object.keys(sourceCollectionCounts).length,
        totalSourceRecords,
        totalTargetTables: totalTablesCount,
        totalPhysicalRowsPlanned,
        totalPhysicalRowsWritten: rowsWritten,
        sourceCollectionCounts,
        targetTableCounts,
        issues,
        status: 'MIGRATION_SUCCESS',
        durationMs,
        metadata: {
          nodeVersion: process.version,
          targetEngine: 'PostgreSQL 15+ / Neon',
          dependencyWaves: waves.length
        }
      };

      if (this.reportOutputPath) {
        fs.mkdirSync(path.dirname(this.reportOutputPath), { recursive: true });
        fs.writeFileSync(this.reportOutputPath, JSON.stringify(report, null, 2), 'utf-8');
      }

      return report;
    } catch (err: any) {
      try {
        await client.query('ROLLBACK');
      } catch {}

      const durationMs = Date.now() - startTime;
      const report: MigrationAuditReport = {
        timestamp: new Date().toISOString(),
        sourceFile: this.sourcePath,
        sourceSha256,
        sourceSizeBytes,
        dryRun: false,
        targetEnv: this.targetEnv,
        sanitizedTargetHost: guardResult.sanitizedHost,
        conflictPolicy: this.conflictPolicy,
        totalSourceCollections: Object.keys(sourceCollectionCounts).length,
        totalSourceRecords,
        totalTargetTables: totalTablesCount,
        totalPhysicalRowsPlanned,
        totalPhysicalRowsWritten: 0,
        sourceCollectionCounts,
        targetTableCounts,
        issues: [
          ...issues,
          {
            severity: 'ERROR',
            collection: 'DATABASE_MUTATION',
            recordId: 'TRANSACTION_ROLLBACK',
            message: `Migration transaction aborted: ${err?.message || String(err)}`
          }
        ],
        status: 'FAILED',
        blockReason: `Database transaction failure: ${err?.message || String(err)}`,
        durationMs,
        metadata: {
          nodeVersion: process.version,
          targetEngine: 'PostgreSQL 15+ / Neon',
          dependencyWaves: waves.length
        }
      };

      if (this.reportOutputPath) {
        fs.mkdirSync(path.dirname(this.reportOutputPath), { recursive: true });
        fs.writeFileSync(this.reportOutputPath, JSON.stringify(report, null, 2), 'utf-8');
      }

      throw err;
    } finally {
      if (typeof client.release === 'function') {
        client.release();
      }
    }
  }
}
