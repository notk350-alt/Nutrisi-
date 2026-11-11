/**
 * NutriBodySim — Deterministic JSON to PostgreSQL Migration Engine (MVS-B2.5E.1B.5)
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type {
  AccountStatus,
  ApprovalStatus,
  MaterialType,
  NotebookCellType,
  ProjectType,
  RequestedRole,
  TeamRole,
  UserRole
} from '../types';
import type { ChartType } from '../schema/research';
import type { RegistryStatus, DataType } from '../../../scientific';
import { getTableName } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { schemaTableManifest } from '../schema';
import { TargetSafetyGuard } from './targetSafetyGuard';

export type ConflictPolicy = 'fail-on-conflict' | 'skip-existing';

export const MIGRATABLE_USER_ROLES = [
  'RegisteredUser',
  'Student',
  'Lecturer',
  'Researcher',
  'Admin'
] as const satisfies readonly UserRole[];

export const MIGRATABLE_REQUESTED_ROLES = [
  'Student',
  'Lecturer',
  'Researcher',
  'Admin'
] as const satisfies readonly RequestedRole[];

export const MIGRATABLE_TEAM_ROLES = [
  'Owner',
  'Editor',
  'Collaborator',
  'Viewer'
] as const satisfies readonly TeamRole[];

export const MIGRATABLE_ACCOUNT_STATUSES = [
  'ACTIVE',
  'SUSPENDED',
  'DISABLED'
] as const satisfies readonly AccountStatus[];

export const MIGRATABLE_APPROVAL_STATUSES = [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'CANCELLED'
] as const satisfies readonly ApprovalStatus[];

export const MIGRATABLE_PROJECT_TYPES = [
  'Personal',
  'Academic',
  'Research',
  'Experiment',
  'Team',
  'Assignment'
] as const satisfies readonly ProjectType[];

export const MIGRATABLE_MATERIAL_TYPES = [
  'PDF',
  'TXT',
  'EPUB',
  'DOCX',
  'PPTX',
  'XLSX',
  'CSV',
  'IMAGE'
] as const satisfies readonly MaterialType[];

export const MIGRATABLE_CHART_TYPES = [
  'LINE',
  'BAR',
  'HISTOGRAM',
  'SCATTER',
  'BOX_PLOT'
] as const satisfies readonly ChartType[];

export const MIGRATABLE_NOTEBOOK_CELL_TYPES = [
  'TEXT',
  'DATA',
  'FORMULA',
  'CODE',
  'CHART',
  'TABLE',
  'EXPERIMENT',
  'REFERENCE'
] as const satisfies readonly NotebookCellType[];

const MIGRATABLE_REGISTRY_STATUSES = [
  'DRAFT',
  'UNDER_REVIEW',
  'VALIDATED',
  'VALIDATION',
  'VERIFIED',
  'EXPERIMENTAL',
  'DEPRECATED'
] as const satisfies readonly RegistryStatus[];

const MIGRATABLE_VARIABLE_DATA_TYPES = [
  'number',
  'integer',
  'boolean',
  'string',
  'vector',
  'matrix'
] as const satisfies readonly DataType[];

const SOURCE_COLLECTIONS = [
  'users',
  'teams',
  'team_members',
  'projects',
  'project_members',
  'materials',
  'material_collections',
  'reading_progress',
  'bookmarks',
  'highlights',
  'notes',
  'units',
  'variables',
  'parameters',
  'formulas',
  'algorithms',
  'models',
  'references',
  'interpretation_rules',
  'calculations',
  'datasets',
  'dataset_versions',
  'statistics_analyses',
  'charts',
  'notebooks',
  'notebook_cells',
  'code_executions',
  'experiments',
  'audit_logs',
  'provenance_records',
  'role_requests',
  'external_identities'
] as const;

const REQUIRED_SOURCE_TIMESTAMPS = {
  audit_logs: ['timestamp'],
  provenance_records: ['created_at']
} as const;

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

const CHECK_VALUES: Record<string, readonly string[]> = {
  'users.role': MIGRATABLE_USER_ROLES,
  'users.account_status': MIGRATABLE_ACCOUNT_STATUSES,
  'users.provider': ['local', 'google'],
  'external_identities.provider': ['google', 'local'],
  'role_requests.requested_role': MIGRATABLE_REQUESTED_ROLES,
  'role_requests.approval_status': MIGRATABLE_APPROVAL_STATUSES,
  'team_members.role': MIGRATABLE_TEAM_ROLES,
  'project_members.role': MIGRATABLE_TEAM_ROLES,
  'projects.type': MIGRATABLE_PROJECT_TYPES,
  'materials.type': MIGRATABLE_MATERIAL_TYPES,
  'scientific_variables.datatype': MIGRATABLE_VARIABLE_DATA_TYPES,
  'scientific_variables.status': MIGRATABLE_REGISTRY_STATUSES,
  'scientific_parameters.status': MIGRATABLE_REGISTRY_STATUSES,
  'scientific_formulas.status': MIGRATABLE_REGISTRY_STATUSES,
  'scientific_algorithms.status': MIGRATABLE_REGISTRY_STATUSES,
  'scientific_models.status': MIGRATABLE_REGISTRY_STATUSES,
  'scientific_interpretation_rules.status': MIGRATABLE_REGISTRY_STATUSES,
  'dataset_versions.state': ['RAW', 'WORKING_COPY', 'CLEANED', 'VALIDATED', 'ANALYSIS_READY'],
  'statistics_analyses.analysis_type': [
    'DESCRIPTIVE',
    'TWO_GROUP_COMPARISON',
    'MULTIPLE_GROUP_ANOVA',
    'CORRELATION',
    'LINEAR_REGRESSION',
    'DIAGNOSTICS'
  ],
  'charts.chart_type': MIGRATABLE_CHART_TYPES,
  'notebook_cells.cell_type': MIGRATABLE_NOTEBOOK_CELL_TYPES,
  'code_executions.language': ['PYTHON', 'R', 'SQL', 'JAVASCRIPT'],
  'experiments.status': ['DRAFT', 'RUNNING', 'COMPLETED', 'FAILED']
};

const NUMERIC_CHECKS: Record<string, (value: number) => boolean> = {
  'scientific_references.year': (value) => value >= 1800 && value <= 2100,
  'materials.year': (value) => value >= 1800 && value <= 2100,
  'materials.file_size_bytes': (value) => value >= 0,
  'reading_progress.progress_pct': (value) => value >= 0 && value <= 100,
  'bookmarks.page': (value) => value >= 1,
  'highlights.page': (value) => value >= 1,
  'notebook_cells.order_index': (value) => value >= 0,
  'code_executions.execution_time_ms': (value) => value >= 0
};

function validatePreparedWaves(
  waves: MigrationWave[],
  issues: ValidationIssue[]
): void {
  const manifestTables = Object.values(schemaTableManifest).map((table) => getTableConfig(table));
  const schemaByName = new Map(manifestTables.map((config) => [config.name, config]));
  const batchByName = new Map<string, TableBatch>();
  const tableOrder = new Map<string, number>();
  let order = 0;

  for (const wave of waves) {
    for (const batch of wave.tables) {
      tableOrder.set(batch.name, order);
      order += 1;
      if (batchByName.has(batch.name)) {
        issues.push({
          severity: 'ERROR',
          collection: batch.name,
          recordId: 'SCHEMA',
          message: 'Table is mapped more than once.'
        });
        continue;
      }

      batchByName.set(batch.name, batch);
      const tableConfig = schemaByName.get(batch.name);
      if (!tableConfig) {
        issues.push({
          severity: 'ERROR',
          collection: batch.name,
          recordId: 'SCHEMA',
          message: 'Mapped table is not present in the Drizzle schema manifest.'
        });
        continue;
      }

      const schemaColumns = tableConfig.columns.map((column) => column.name);
      const payloadColumns = schemaColumns.filter((columnName) =>
        batch.rows.length === 0 || !batch.rows.every((row) => row[columnName] === undefined)
      );
      batch.columns = payloadColumns;
      for (const row of batch.rows) {
        for (const columnName of schemaColumns) {
          if (!payloadColumns.includes(columnName)) delete row[columnName];
        }
      }
      const schemaColumnSet = new Set(schemaColumns);
      const primaryKeyColumns = tableConfig.primaryKeys.length
        ? tableConfig.primaryKeys.flatMap((primaryKey) => primaryKey.columns.map((column) => column.name))
        : tableConfig.columns.filter((column) => column.primary).map((column) => column.name);

      if (
        primaryKeyColumns.length !== batch.primaryKey.length ||
        primaryKeyColumns.some((column) => !batch.primaryKey.includes(column))
      ) {
        issues.push({
          severity: 'ERROR',
          collection: batch.name,
          recordId: 'SCHEMA',
          field: 'primaryKey',
          message: `Migrator primary key [${batch.primaryKey.join(', ')}] does not match Drizzle primary key [${primaryKeyColumns.join(', ')}].`
        });
      }

      for (let index = 0; index < batch.rows.length; index += 1) {
        const row = batch.rows[index];
        const recordId = String(primaryKeyColumns.map((column) => row[column] ?? 'NULL').join(':') || index);
        const rowColumns = Object.keys(row);

        for (const column of rowColumns) {
          if (!schemaColumnSet.has(column)) {
            issues.push({
              severity: 'ERROR',
              collection: batch.name,
              recordId,
              field: column,
              message: 'Insert payload contains a column not defined in the Drizzle table.'
            });
          }
        }

        for (const column of tableConfig.columns) {
          if (!payloadColumns.includes(column.name)) {
            if (!column.hasDefault) {
              issues.push({
                severity: 'ERROR',
                collection: batch.name,
                recordId,
                field: column.name,
                message: 'Insert payload omits a column without a schema default.'
              });
            }
            continue;
          }

          const value = row[column.name];
          if (!Object.hasOwn(row, column.name) || value === undefined) {
            issues.push({
              severity: 'ERROR',
              collection: batch.name,
              recordId,
              field: column.name,
              message: 'Insert payload does not explicitly map this schema column.'
            });
            continue;
          }
          if (value === null) {
            if (column.notNull) {
              issues.push({
                severity: 'ERROR',
                collection: batch.name,
                recordId,
                field: column.name,
                message: 'Required schema column is null.'
              });
            }
            continue;
          }

          if (column.dataType === 'string') {
            if (typeof value !== 'string') {
              issues.push({
                severity: 'ERROR',
                collection: batch.name,
                recordId,
                field: column.name,
                message: 'Expected a string value.'
              });
            } else if (
              /^varchar\(\d+\)$/i.test(column.getSQLType()) &&
              value.length > Number(/^varchar\((\d+)\)$/i.exec(column.getSQLType())?.[1])
            ) {
              issues.push({
                severity: 'ERROR',
                collection: batch.name,
                recordId,
                field: column.name,
                message: `String length ${value.length} exceeds schema limit ${/^varchar\((\d+)\)$/i.exec(column.getSQLType())?.[1]}.`
              });
            }
          } else if (column.dataType === 'number') {
            if (typeof value !== 'number' || !Number.isFinite(value)) {
              issues.push({
                severity: 'ERROR',
                collection: batch.name,
                recordId,
                field: column.name,
                message: 'Expected a finite numeric value.'
              });
            } else if (column.columnType === 'PgInteger' && !Number.isInteger(value)) {
              issues.push({
                severity: 'ERROR',
                collection: batch.name,
                recordId,
                field: column.name,
                message: 'Expected an integer value.'
              });
            }
          } else if (column.dataType === 'boolean' && typeof value !== 'boolean') {
            issues.push({
              severity: 'ERROR',
              collection: batch.name,
              recordId,
              field: column.name,
              message: 'Expected a boolean value.'
            });
          } else if (column.dataType === 'date') {
            const date = value instanceof Date ? value : new Date(value);
            if (!(value instanceof Date || typeof value === 'string') || Number.isNaN(date.getTime())) {
              issues.push({
                severity: 'ERROR',
                collection: batch.name,
                recordId,
                field: column.name,
                message: 'Expected a valid timestamp value.'
              });
            }
          } else if (column.dataType === 'json') {
            try {
              JSON.stringify(value);
            } catch {
              issues.push({
                severity: 'ERROR',
                collection: batch.name,
                recordId,
                field: column.name,
                message: 'Value is not JSON serializable.'
              });
            }
          }

          const allowedValues = CHECK_VALUES[`${batch.name}.${column.name}`];
          if (allowedValues && !allowedValues.includes(value)) {
            issues.push({
              severity: 'ERROR',
              collection: batch.name,
              recordId,
              field: column.name,
              message: `Value '${String(value)}' is not accepted by the schema check constraint.`
            });
          }
          const numericCheck = NUMERIC_CHECKS[`${batch.name}.${column.name}`];
          if (typeof value === 'number' && numericCheck && !numericCheck(value)) {
            issues.push({
              severity: 'ERROR',
              collection: batch.name,
              recordId,
              field: column.name,
              message: 'Numeric value violates the schema check constraint.'
            });
          }
        }
      }

      const uniqueConstraints = [
        primaryKeyColumns,
        ...tableConfig.uniqueConstraints.map((constraint) => constraint.columns.map((column) => column.name)),
        ...tableConfig.columns.filter((column) => column.isUnique).map((column) => [column.name])
      ];
      for (const uniqueColumns of uniqueConstraints) {
        const seen = new Set<string>();
        for (const row of batch.rows) {
          const values = uniqueColumns.map((column) => row[column]);
          if (values.some((value) => value === null || value === undefined)) continue;
          const key = JSON.stringify(values);
          if (seen.has(key)) {
            issues.push({
              severity: 'ERROR',
              collection: batch.name,
              recordId: uniqueColumns.map((column) => String(row[column])).join(':'),
              field: uniqueColumns.join(','),
              message: 'Duplicate value violates a unique constraint.'
            });
          }
          seen.add(key);
        }
      }
    }
  }

  if (batchByName.size !== manifestTables.length) {
    const missingTables = manifestTables
      .map((config) => config.name)
      .filter((name) => !batchByName.has(name));
    issues.push({
      severity: 'ERROR',
      collection: 'migration',
      recordId: 'SCHEMA',
      field: 'tables',
      message: `Migrator maps ${batchByName.size} of ${manifestTables.length} Drizzle tables; missing: ${missingTables.join(', ') || 'none'}.`
    });
  }

  for (const batch of batchByName.values()) {
    const tableConfig = schemaByName.get(batch.name);
    if (!tableConfig) continue;

    for (const foreignKey of tableConfig.foreignKeys) {
      const reference = foreignKey.reference();
      const foreignTableName = getTableName(reference.foreignTable);
      const foreignBatch = batchByName.get(foreignTableName);
      const referencedColumns = reference.foreignColumns.map((column) => column.name);
      const referencingColumns = reference.columns.map((column) => column.name);
      const referencedKeys = new Set(
        (foreignBatch?.rows ?? []).map((row) => JSON.stringify(referencedColumns.map((column) => row[column])))
      );
      if (
        foreignBatch &&
        tableOrder.get(foreignTableName)! > tableOrder.get(batch.name)!
      ) {
        issues.push({
          severity: 'ERROR',
          collection: batch.name,
          recordId: 'SCHEMA',
          field: referencingColumns.join(','),
          message: `Foreign-key dependency on ${foreignTableName} is scheduled after its dependent table.`
        });
      }

      for (const row of batch.rows) {
        const values = referencingColumns.map((column) => row[column]);
        if (values.some((value) => value === null || value === undefined)) continue;
        if (!referencedKeys.has(JSON.stringify(values))) {
          issues.push({
            severity: 'ERROR',
            collection: batch.name,
            recordId: String(row[batch.primaryKey[0]] ?? 'UNKNOWN'),
            field: referencingColumns.join(','),
            message: `Foreign key reference does not resolve in ${foreignTableName}(${referencedColumns.join(', ')}).`
          });
        }
      }
    }
  }
}

function defaultIfUndefined<T>(value: T | undefined, fallback: T): T {
  return value === undefined ? fallback : value;
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
    this.databaseUrl = options.databaseUrl || process.env.MIGRATION_DATABASE_URL;
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

    if (!sourceDb || typeof sourceDb !== 'object' || Array.isArray(sourceDb)) {
      issues.push({
        severity: 'ERROR',
        collection: 'source',
        recordId: 'ROOT',
        message: 'Source JSON root must be an object containing the canonical collections.'
      });
      return { waves: [], issues, sourceCollectionCounts };
    }

    const sourceCollections = { ...sourceDb };
    const knownCollections = new Set<string>(SOURCE_COLLECTIONS);
    for (const collection of Object.keys(sourceCollections)) {
      if (!knownCollections.has(collection)) {
        issues.push({
          severity: 'ERROR',
          collection,
          recordId: 'SCHEMA',
          message: 'Source collection has no approved target mapping.'
        });
      }
    }
    for (const collection of SOURCE_COLLECTIONS) {
      if (!Array.isArray(sourceCollections[collection])) {
        issues.push({
          severity: 'ERROR',
          collection,
          recordId: 'SCHEMA',
          message: 'Canonical source collection is missing or is not an array.'
        });
        sourceCollections[collection] = [];
      }
      sourceCollectionCounts[collection] = sourceCollections[collection].length;
    }
    sourceDb = sourceCollections;

    for (const [collection, fields] of Object.entries(REQUIRED_SOURCE_TIMESTAMPS)) {
      for (const row of sourceDb[collection] || []) {
        for (const field of fields) {
          const value = row[field];
          if (typeof value !== 'string' || Number.isNaN(new Date(value).getTime())) {
            issues.push({
              severity: 'ERROR',
              collection,
              recordId: String(row.id ?? 'UNKNOWN'),
              field,
              message: 'Required historical timestamp is missing or invalid.'
            });
          }
        }
      }
    }

    const teamIds = new Set((sourceDb.teams || []).map((t: any) => t.id));
    const modelIds = new Set((sourceDb.models || []).map((m: any) => m.model_id));

    // Wave 1
    const unitsTarget = (sourceDb.units || []).map((u: any) => ({
      unit_id: u.unit_id,
      symbol: u.symbol,
      name: u.name,
      measurement_type: u.measurement_type,
      base_unit: u.base_unit,
      to_base_multiplier: u.to_base_multiplier,
      to_base_offset: defaultIfUndefined(u.to_base_offset, 0.0),
      description: u.description ?? null,
      created_at: u.created_at
    }));

    const referencesTarget = (sourceDb.references || []).map((r: any) => ({
      reference_id: r.reference_id,
      title: r.title,
      authors: defaultIfUndefined(r.authors, []),
      year: r.year,
      journal_or_publisher: r.journal_or_publisher,
      doi: r.doi ?? null,
      citation_key: r.citation_key ?? null,
      abstract: r.abstract ?? null,
      created_at: r.created_at
    }));

    const usersTarget = (sourceDb.users || []).map((u: any) => {
      if (!MIGRATABLE_USER_ROLES.includes(u.role)) {
        issues.push({
          severity: 'ERROR',
          collection: 'users',
          recordId: String(u.id || 'UNKNOWN'),
          field: 'role',
          message: `Unrecognized user role '${String(u.role)}'; migration requires an explicit canonical role.`
        });
      }

      return {
        id: u.id,
        email: u.email,
        name: u.name,
        display_name: defaultIfUndefined(u.display_name, u.name),
        role: u.role,
        permissions: defaultIfUndefined(u.permissions, []),
        organization: u.organization ?? null,
        avatar_url: u.avatar_url ?? null,
        account_status: defaultIfUndefined(u.account_status, 'ACTIVE'),
        email_verified: defaultIfUndefined(u.email_verified, false),
        provider: defaultIfUndefined(u.provider, 'local'),
        provider_subject_id: u.provider_subject_id ?? null,
        is_main_admin: defaultIfUndefined(u.is_main_admin, false),
        governance_granted_at: u.governance_granted_at ?? null,
        governance_granted_by: u.governance_granted_by ?? null,
        token_version: defaultIfUndefined(u.token_version, 0),
        created_at: u.created_at,
        updated_at: u.updated_at,
        last_login_at: u.last_login_at ?? null
      };
    });

    const externalIdentitiesTarget = (sourceDb.external_identities || []).map((ei: any) => ({
      id: ei.id,
      user_id: ei.user_id,
      provider: ei.provider,
      provider_subject_id: ei.provider_subject_id,
      email: ei.email ?? null,
      email_verified: defaultIfUndefined(ei.email_verified, false),
      linked_at: ei.linked_at
    }));

    const roleRequestsTarget = (sourceDb.role_requests || []).map((rr: any) => {
      if (!MIGRATABLE_REQUESTED_ROLES.includes(rr.requested_role)) {
        issues.push({
          severity: 'ERROR',
          collection: 'role_requests',
          recordId: String(rr.request_id ?? rr.id ?? 'UNKNOWN'),
          field: 'requested_role',
          message: `Unrecognized requested role '${String(rr.requested_role)}'; migration requires an explicit canonical role.`
        });
      }

      return {
        request_id: rr.request_id ?? rr.id,
        user_id: rr.user_id,
        requested_role: rr.requested_role,
        approval_status: defaultIfUndefined(rr.approval_status, 'PENDING'),
        institution: rr.institution ?? null,
        justification: rr.justification ?? null,
        reviewed_by: rr.reviewed_by ?? null,
        reviewed_at: rr.reviewed_at ?? null,
        review_reason: rr.review_reason ?? null,
        created_at: rr.created_at
      };
    });

    const teamsTarget = (sourceDb.teams || []).map((t: any) => ({
      id: t.id,
      name: t.name,
      description: t.description ?? null,
      owner_id: t.owner_id,
      created_at: t.created_at
    }));

    // Wave 2
    const variablesTarget = (sourceDb.variables || []).map((v: any) => ({
      variable_id: v.variable_id,
      name: v.name,
      label: v.label,
      definition: v.definition ?? null,
      datatype: v.datatype,
      unit: v.unit,
      measurement_type: v.measurement_type,
      allowed_range: v.allowed_range ?? null,
      population: v.population ?? null,
      source_reference: v.source_reference ?? null,
      version: defaultIfUndefined(v.version, '1.0.0'),
      status: defaultIfUndefined(v.status, 'EXPERIMENTAL'),
      created_at: v.created_at,
      updated_at: v.updated_at
    }));

    const projectsTarget = (sourceDb.projects || []).map((p: any) => ({
      id: p.id,
      name: p.name,
      description: p.description ?? null,
      type: defaultIfUndefined(p.type, 'Personal'),
      owner_id: p.owner_id,
      team_id: p.team_id ?? null,
      is_public: defaultIfUndefined(p.is_public, false),
      tags: defaultIfUndefined(p.tags, []),
      created_at: p.created_at,
      updated_at: p.updated_at
    }));

    // Wave 3
    const parametersTarget = (sourceDb.parameters || []).map((p: any) => ({
      parameter_id: p.parameter_id,
      name: p.name,
      description: p.description ?? null,
      value: p.value,
      unit: p.unit,
      valid_range: p.valid_range ?? null,
      version: defaultIfUndefined(p.version, '1.0.0'),
      status: defaultIfUndefined(p.status, 'EXPERIMENTAL'),
      is_constant: defaultIfUndefined(p.is_constant, false),
      created_at: p.created_at,
      updated_at: p.updated_at
    }));

    const paramRefsTarget: any[] = [];
    for (const p of sourceDb.parameters || []) {
      for (const rId of p.reference_ids || []) {
        paramRefsTarget.push({ parameter_id: p.parameter_id, reference_id: rId });
      }
    }

    const formulasTarget = (sourceDb.formulas || []).map((f: any) => ({
      formula_id: f.formula_id,
      module_id: f.module_id ?? null,
      module_type: defaultIfUndefined(f.module_type, 'FORMULA'),
      name: f.name,
      description: f.description ?? null,
      version: defaultIfUndefined(f.version, '1.0.0'),
      status: defaultIfUndefined(f.status, 'EXPERIMENTAL'),
      inputs: defaultIfUndefined(f.inputs, []),
      outputs: defaultIfUndefined(f.outputs, []),
      expression_ast: f.expression_ast,
      expression_string: f.expression_string,
      assumptions: defaultIfUndefined(f.assumptions, []),
      limitations: defaultIfUndefined(f.limitations, []),
      validation_status: defaultIfUndefined(f.validation_status, 'UNVERIFIED'),
      created_by: defaultIfUndefined(f.created_by, 'SYSTEM'),
      created_at: f.created_at,
      updated_at: f.updated_at
    }));

    const formulaParamsTarget: any[] = [];
    const formulaRefsTarget: any[] = [];
    for (const f of sourceDb.formulas || []) {
      for (const pId of f.parameter_ids || []) formulaParamsTarget.push({ formula_id: f.formula_id, parameter_id: pId });
      for (const rId of f.reference_ids || []) formulaRefsTarget.push({ formula_id: f.formula_id, reference_id: rId });
    }

    const teamMembersTarget = (sourceDb.team_members || []).map((tm: any) => {
      if (!MIGRATABLE_TEAM_ROLES.includes(tm.role)) {
        issues.push({
          severity: 'ERROR',
          collection: 'team_members',
          recordId: String(tm.id ?? 'UNKNOWN'),
          field: 'role',
          message: `Unrecognized team role '${String(tm.role)}'; migration requires an explicit canonical role.`
        });
      }

      return {
        id: tm.id,
        team_id: tm.team_id,
        user_id: tm.user_id,
        role: tm.role,
        joined_at: tm.joined_at
      };
    });

    const projectMembersTarget = (sourceDb.project_members || []).map((pm: any) => {
      if (!MIGRATABLE_TEAM_ROLES.includes(pm.role)) {
        issues.push({
          severity: 'ERROR',
          collection: 'project_members',
          recordId: String(pm.id ?? 'UNKNOWN'),
          field: 'role',
          message: `Unrecognized project role '${String(pm.role)}'; migration requires an explicit canonical role.`
        });
      }

      return {
        id: pm.id,
        project_id: pm.project_id,
        user_id: pm.user_id,
        role: pm.role,
        joined_at: pm.joined_at
      };
    });

    // Wave 4
    const algorithmsTarget = (sourceDb.algorithms || []).map((a: any) => ({
      algorithm_id: a.algorithm_id,
      module_id: a.module_id ?? null,
      module_type: defaultIfUndefined(a.module_type, 'ALGORITHM'),
      name: a.name,
      description: a.description ?? null,
      version: defaultIfUndefined(a.version, '1.0.0'),
      status: defaultIfUndefined(a.status, 'EXPERIMENTAL'),
      inputs: defaultIfUndefined(a.inputs, []),
      outputs: defaultIfUndefined(a.outputs, []),
      entry_step_id: a.entry_step_id ?? null,
      steps: defaultIfUndefined(a.steps, []),
      fallback_routes: defaultIfUndefined(a.fallback_routes, []),
      assumptions: defaultIfUndefined(a.assumptions, []),
      limitations: defaultIfUndefined(a.limitations, []),
      validation_status: a.validation_status ?? null,
      created_by: defaultIfUndefined(a.created_by, 'SYSTEM'),
      created_at: a.created_at,
      updated_at: a.updated_at
    }));

    const algorithmParamsTarget: any[] = [];
    const algorithmRefsTarget: any[] = [];
    for (const a of sourceDb.algorithms || []) {
      for (const pId of a.parameter_ids || []) algorithmParamsTarget.push({ algorithm_id: a.algorithm_id, parameter_id: pId });
      for (const rId of a.reference_ids || []) algorithmRefsTarget.push({ algorithm_id: a.algorithm_id, reference_id: rId });
    }

    const materialsTarget = (sourceDb.materials || []).map((m: any) => ({
      id: m.id,
      title: m.title,
      author: m.author,
      subject: m.subject,
      type: m.type,
      description: m.description ?? null,
      year: m.year ?? null,
      publisher: m.publisher ?? null,
      language: defaultIfUndefined(m.language, 'en'),
      source: m.source ?? null,
      url: m.url ?? null,
      license: m.license ?? null,
      tags: defaultIfUndefined(m.tags, []),
      version: defaultIfUndefined(m.version, '1.0.0'),
      uploaded_by: m.uploaded_by,
      file_path: m.file_path,
      file_size_bytes: m.file_size_bytes,
      mime_type: m.mime_type,
      file_hash: m.file_hash ?? null,
      created_at: m.created_at,
      updated_at: m.updated_at
    }));

    const materialProjectsTarget: any[] = [];
    for (const m of sourceDb.materials || []) {
      for (const pId of m.project_ids || []) {
        materialProjectsTarget.push({ material_id: m.id, project_id: pId });
      }
    }

    const collectionsTarget = (sourceDb.material_collections || []).map((c: any) => ({
      id: c.id,
      name: c.name,
      description: c.description ?? null,
      color: c.color ?? null,
      created_by: c.created_by,
      created_at: c.created_at
    }));

    const collectionMaterialsTarget: any[] = [];
    for (const c of sourceDb.material_collections || []) {
      for (const mId of c.material_ids || []) {
        collectionMaterialsTarget.push({ collection_id: c.id, material_id: mId });
      }
    }

    // Wave 5
    const modelsTarget = (sourceDb.models || []).map((m: any) => ({
      model_id: m.model_id,
      module_id: m.module_id ?? null,
      module_type: defaultIfUndefined(m.module_type, 'MODEL'),
      name: m.name,
      description: m.description ?? null,
      version: defaultIfUndefined(m.version, '1.0.0'),
      status: defaultIfUndefined(m.status, 'EXPERIMENTAL'),
      is_verified: defaultIfUndefined(m.is_verified, false),
      parent_model_id: m.parent_model_id ?? null,
      assumptions: defaultIfUndefined(m.assumptions, []),
      validation_criteria: m.validation_criteria ?? null,
      changed_notes: m.changed_notes ?? null,
      inputs: defaultIfUndefined(m.inputs, []),
      outputs: defaultIfUndefined(m.outputs, []),
      states: defaultIfUndefined(m.states, []),
      time_config: defaultIfUndefined(m.time_config, {}),
      transitions: defaultIfUndefined(m.transitions, []),
      created_by: defaultIfUndefined(m.created_by, 'SYSTEM'),
      created_at: m.created_at,
      updated_at: m.updated_at
    }));

    const modelVarsTarget: any[] = [];
    const modelFormulasTarget: any[] = [];
    const modelAlgorithmsTarget: any[] = [];
    const modelParamsTarget: any[] = [];
    const modelRefsTarget: any[] = [];

    for (const m of sourceDb.models || []) {
      for (const vId of m.variable_ids || []) {
        modelVarsTarget.push({ model_id: m.model_id, variable_id: vId });
      }
      for (const fId of m.formula_ids || []) {
        modelFormulasTarget.push({ model_id: m.model_id, formula_id: fId });
      }
      for (const aId of m.algorithm_ids || []) {
        modelAlgorithmsTarget.push({ model_id: m.model_id, algorithm_id: aId });
      }
      for (const pId of m.parameter_ids || []) {
        modelParamsTarget.push({ model_id: m.model_id, parameter_id: pId });
      }
      for (const rId of m.reference_ids || []) {
        modelRefsTarget.push({ model_id: m.model_id, reference_id: rId });
      }
    }

    const datasetsTarget = (sourceDb.datasets || []).map((d: any) => ({
      id: d.id,
      project_id: d.project_id,
      name: d.name,
      description: d.description ?? null,
      source_file: d.source_file,
      uploaded_by: d.uploaded_by,
      current_version: defaultIfUndefined(d.current_version, 'v1.0'),
      created_at: d.created_at,
      updated_at: d.updated_at
    }));

    const readingProgressTarget = (sourceDb.reading_progress || []).map((rp: any) => ({
      id: rp.id,
      user_id: rp.user_id,
      material_id: rp.material_id,
      last_page: defaultIfUndefined(rp.last_page, 1),
      total_pages: defaultIfUndefined(rp.total_pages, 1),
      progress_pct: defaultIfUndefined(rp.progress_pct, 0),
      scroll_position: rp.scroll_position ?? null,
      last_accessed: rp.last_accessed
    }));

    const bookmarksTarget = (sourceDb.bookmarks || []).map((b: any) => ({
      id: b.id,
      user_id: b.user_id,
      material_id: b.material_id,
      page: b.page,
      title: b.title ?? null,
      created_at: b.created_at
    }));

    const highlightsTarget = (sourceDb.highlights || []).map((h: any) => ({
      id: h.id,
      user_id: h.user_id,
      material_id: h.material_id,
      page: h.page,
      selected_text: h.selected_text,
      color: defaultIfUndefined(h.color, 'yellow'),
      created_at: h.created_at
    }));

    const notesTarget = (sourceDb.notes || []).map((n: any) => ({
      id: n.id,
      user_id: n.user_id,
      material_id: n.material_id ?? null,
      project_id: n.project_id ?? null,
      title: n.title,
      content: n.content,
      page: n.page ?? null,
      selected_text: n.selected_text ?? null,
      created_at: n.created_at,
      updated_at: n.updated_at
    }));

    // Wave 6
    const rulesTarget = (sourceDb.interpretation_rules || []).map((ir: any) => ({
      rule_id: ir.rule_id,
      module_id: defaultIfUndefined(ir.module_id, ir.rule_id),
      module_type: defaultIfUndefined(ir.module_type, 'INTERPRETATION'),
      name: ir.name,
      description: ir.description ?? null,
      version: defaultIfUndefined(ir.version, '1.0.0'),
      status: defaultIfUndefined(ir.status, 'VERIFIED'),
      target_variable_or_metric: ir.target_variable_or_metric,
      unit: ir.unit,
      population: ir.population ?? null,
      thresholds: defaultIfUndefined(ir.thresholds, []),
      created_by: defaultIfUndefined(ir.created_by, 'SYSTEM'),
      created_at: ir.created_at,
      updated_at: ir.updated_at
    }));

    const ruleRefsTarget: any[] = [];
    for (const ir of sourceDb.interpretation_rules || []) {
      for (const rId of ir.reference_ids || []) {
        ruleRefsTarget.push({ rule_id: ir.rule_id, reference_id: rId });
      }
    }

    const datasetVersionsTarget = (sourceDb.dataset_versions || []).map((dv: any) => ({
      id: dv.id,
      dataset_id: dv.dataset_id,
      version_tag: dv.version_tag,
      parent_version_tag: dv.parent_version_tag ?? null,
      state: dv.state,
      columns: dv.columns,
      data: dv.data,
      validation_report: dv.validation_report,
      transformation_applied: dv.transformation_applied ?? null,
      created_by: dv.created_by,
      created_at: dv.created_at
    }));

    const statisticsAnalysesTarget = (sourceDb.statistics_analyses || []).map((sa: any) => ({
      id: sa.id,
      project_id: sa.project_id,
      dataset_version_id: sa.dataset_version_id,
      title: sa.title,
      analysis_type: sa.analysis_type,
      target_columns: sa.target_columns,
      grouping_column: sa.grouping_column ?? null,
      method_justification: sa.method_justification,
      results: sa.results,
      provenance_hash: sa.provenance_hash,
      created_by: sa.created_by,
      created_at: sa.created_at
    }));

    const chartsTarget = (sourceDb.charts || []).map((c: any) => ({
      id: c.id,
      project_id: c.project_id,
      dataset_version_id: c.dataset_version_id,
      analysis_id: c.analysis_id ?? null,
      title: c.title,
      chart_type: c.chart_type,
      x_field: c.x_field,
      y_field: c.y_field ?? null,
      group_by: c.group_by ?? null,
      config: defaultIfUndefined(c.config, {}),
      created_by: c.created_by,
      created_at: c.created_at
    }));

    const notebooksTarget = (sourceDb.notebooks || []).map((nb: any) => ({
      id: nb.id,
      project_id: nb.project_id,
      title: nb.title,
      description: nb.description ?? null,
      created_by: nb.created_by,
      created_at: nb.created_at,
      updated_at: nb.updated_at
    }));

    // Wave 7
    const notebookCellsTarget = (sourceDb.notebook_cells || []).map((cell: any) => ({
      id: cell.id,
      notebook_id: cell.notebook_id,
      cell_type: cell.cell_type,
      order_index: defaultIfUndefined(cell.order_index, cell.order),
      title: cell.title ?? null,
      content: cell.content ?? '',
      metadata: cell.metadata ?? null
    }));

    const codeExecutionsTarget = (sourceDb.code_executions || []).map((ce: any) => ({
      id: ce.id,
      project_id: ce.project_id,
      language: ce.language,
      code: ce.code,
      output: defaultIfUndefined(ce.output, ''),
      error: ce.error ?? null,
      execution_time_ms: ce.execution_time_ms,
      environment_info: defaultIfUndefined(ce.environment_info, 'isolated_node'),
      executed_by: ce.executed_by,
      created_at: ce.created_at
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
      return {
        id: exp.id,
        project_id: exp.project_id,
        title: exp.title,
        description: exp.description ?? null,
        baseline_model_id: exp.baseline_model_id,
        experimental_model_id: exp.experimental_model_id,
        parameter_modifications: exp.parameter_modifications,
        baseline_output: exp.baseline_output,
        experimental_output: exp.experimental_output,
        delta_summary: exp.delta_summary ?? null,
        status: defaultIfUndefined(exp.status, 'COMPLETED'),
        provenance_hash: exp.provenance_hash,
        created_by: exp.created_by,
        created_at: exp.created_at,
        updated_at: exp.updated_at
      };
    });

    const calculationsTarget = (sourceDb.calculations || []).map((calc: any) => ({
      calculation_id: calc.calculation_id,
      user_id: calc.user_id,
      project_id: calc.project_id ?? null,
      formula_or_model_id: calc.formula_or_model_id,
      version: defaultIfUndefined(calc.version, '1.0.0'),
      inputs_received: calc.inputs_received,
      normalized_inputs: calc.normalized_inputs,
      parameters_resolved: calc.parameters_resolved,
      steps: calc.steps,
      final_result: calc.final_result,
      explanation: calc.explanation ?? null,
      provenance_hash: calc.provenance_hash,
      created_at: calc.created_at
    }));

    const provenanceRecordsTarget = (sourceDb.provenance_records || []).map((pr: any) => ({
      id: pr.id,
      project_id: pr.project_id,
      target_entity_type: pr.target_entity_type,
      target_entity_id: pr.target_entity_id,
      user_id: pr.user_id,
      dataset_version_id: pr.dataset_version_id ?? null,
      model_version: pr.model_version ?? null,
      parameter_version: pr.parameter_version ?? null,
      environment_specs: pr.environment_specs ?? null,
      provenance_hash: pr.provenance_hash,
      reproducibility_manifest: pr.reproducibility_manifest,
      created_at: pr.created_at
    }));

    const auditLogsTarget = (sourceDb.audit_logs || []).map((al: any) => ({
      id: al.id,
      user_id: al.user_id,
      user_name: al.user_name,
      action: al.action,
      entity_type: al.entity_type,
      entity_id: al.entity_id,
      details: typeof al.details === 'string' ? al.details : JSON.stringify(al.details),
      ip_address: al.ip_address ?? null,
      timestamp: al.timestamp
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
          { name: 'role_requests', primaryKey: ['request_id'], columns: ['request_id', 'user_id', 'requested_role', 'approval_status', 'institution', 'justification', 'created_at', 'reviewed_by', 'reviewed_at', 'review_reason'], rows: roleRequestsTarget },
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
          { name: 'scientific_algorithms', primaryKey: ['algorithm_id'], columns: ['algorithm_id', 'module_id', 'module_type', 'name', 'description', 'version', 'status', 'inputs', 'outputs', 'entry_step_id', 'steps', 'fallback_routes', 'assumptions', 'limitations', 'validation_status', 'created_by', 'created_at', 'updated_at'], rows: algorithmsTarget },
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
          { name: 'scientific_calculations', primaryKey: ['calculation_id'], columns: ['calculation_id', 'user_id', 'project_id', 'formula_or_model_id', 'version', 'inputs_received', 'normalized_inputs', 'parameters_resolved', 'steps', 'final_result', 'explanation', 'provenance_hash', 'created_at'], rows: calculationsTarget },
          { name: 'provenance_records', primaryKey: ['id'], columns: Object.keys(provenanceRecordsTarget[0] || {}), rows: provenanceRecordsTarget },
          { name: 'audit_logs', primaryKey: ['id'], columns: Object.keys(auditLogsTarget[0] || {}), rows: auditLogsTarget }
        ]
      }
    ];

    validatePreparedWaves(waves, issues);

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

    if (hasFatalErrors) {
      throw new Error('Migration blocked by fatal source validation errors.');
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
