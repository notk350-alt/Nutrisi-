/**
 * Phase D4 — Scientific Data Layer: Variable Mapping
 *
 * Connects DatasetVersion source columns to semantic Variable definitions
 * in the Variable Registry with explicit method tracking, lifecycle status,
 * unit & datatype compatibility checks, duplicate/conflict prevention,
 * and deterministic column/variable resolution.
 *
 * Explicitly decoupled from:
 * - D5 Data-State Pipeline
 * - D6 Data Validation Engine
 * - D7 Derived Variable Engine
 * - D8 Dataset Execution Binding
 * - Automatic heuristic column guessing in production
 */

import {
  ColumnMetadata,
  MeasurementType,
  ScientificVariableMappingError,
  Variable,
  VariableDataType,
  VariableMapping,
  VariableMappingErrorCode,
  VariableMappingMethod,
  VariableMappingStatus
} from '../types';
import { findUnit } from '../units/unitConverter';
import { DatasetVersionStore, defaultDatasetVersionStore } from './datasetVersion';
import { defaultVariableStore, VariableStore } from './variableRegistry';

export const VALID_MAPPING_METHODS: ReadonlySet<VariableMappingMethod> = new Set<VariableMappingMethod>([
  'MANUAL',
  'IMPORTED',
  'SYSTEM_CONFIRMED',
  'SUGGESTED'
]);

export const VALID_MAPPING_STATUSES: ReadonlySet<VariableMappingStatus> = new Set<VariableMappingStatus>([
  'DRAFT',
  'CONFIRMED',
  'REJECTED',
  'DEPRECATED'
]);

export interface VariableMappingValidationResult {
  isValid: boolean;
  errors: string[];
}

function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  Object.freeze(obj);
  for (const key of Object.keys(obj)) {
    const val = (obj as any)[key];
    if (val !== null && typeof val === 'object' && !Object.isFrozen(val)) {
      deepFreeze(val);
    }
  }
  return obj;
}

/**
 * Checks physical unit compatibility between column metadata and registered Variable.
 */
export function checkMappingUnitCompatibility(
  colUnit?: string,
  varUnit?: string,
  varDimension?: MeasurementType | string
): { isCompatible: boolean; error?: string } {
  if (!colUnit || !colUnit.trim()) {
    // If column doesn't specify unit, structural mapping is allowed
    return { isCompatible: true };
  }

  const colUnitDef = findUnit(colUnit);
  if (!colUnitDef) {
    return {
      isCompatible: false,
      error: `Column unit "${colUnit}" is not recognized in the Scientific Unit Registry.`
    };
  }

  // If variable has explicit unit
  if (varUnit && varUnit.trim()) {
    const varUnitDef = findUnit(varUnit);
    if (varUnitDef) {
      if (
        colUnitDef.measurement_type !== 'dimensionless' &&
        varUnitDef.measurement_type !== 'dimensionless' &&
        colUnitDef.measurement_type !== varUnitDef.measurement_type
      ) {
        return {
          isCompatible: false,
          error: `Incompatible units: Column unit "${colUnit}" (${colUnitDef.measurement_type}) does not match Variable unit "${varUnit}" (${varUnitDef.measurement_type}).`
        };
      }
    }
  }

  // If variable specifies physical dimension
  if (varDimension && varDimension.trim()) {
    const normVarDim = varDimension.toLowerCase();
    if (
      colUnitDef.measurement_type !== 'dimensionless' &&
      normVarDim !== 'dimensionless' &&
      colUnitDef.measurement_type !== normVarDim
    ) {
      return {
        isCompatible: false,
        error: `Incompatible dimension: Column unit "${colUnit}" has dimension "${colUnitDef.measurement_type}", but Variable specifies dimension "${varDimension}".`
      };
    }
  }

  return { isCompatible: true };
}

/**
 * Checks datatype compatibility between source column metadata and target Variable.
 */
export function checkMappingDatatypeCompatibility(
  colType?: VariableDataType | string,
  varType?: VariableDataType
): { isCompatible: boolean; error?: string } {
  if (!colType || !varType) {
    return { isCompatible: true };
  }

  const normalizedColType = colType.toUpperCase();

  // Number / Integer
  if (varType === 'NUMBER' || varType === 'INTEGER') {
    if (normalizedColType === 'STRING' || normalizedColType === 'BOOLEAN' || normalizedColType === 'DATE') {
      return {
        isCompatible: false,
        error: `Incompatible datatype: Column datatype "${colType}" cannot map to numeric Variable datatype "${varType}".`
      };
    }
  }

  // Boolean
  if (varType === 'BOOLEAN') {
    if (normalizedColType === 'NUMBER' || normalizedColType === 'INTEGER' || normalizedColType === 'DATE') {
      return {
        isCompatible: false,
        error: `Incompatible datatype: Column datatype "${colType}" cannot map to boolean Variable.`
      };
    }
  }

  // Date / Datetime
  if (varType === 'DATE' || varType === 'DATETIME') {
    if (normalizedColType === 'BOOLEAN') {
      return {
        isCompatible: false,
        error: `Incompatible datatype: Column datatype "${colType}" cannot map to date/datetime Variable.`
      };
    }
  }

  return { isCompatible: true };
}

/**
 * Structural contract and integrity validator for VariableMapping.
 */
export class VariableMappingValidator {
  public static validate(
    data: unknown,
    options?: {
      targetVariable?: Variable;
    }
  ): VariableMappingValidationResult {
    const errors: string[] = [];

    if (!data || typeof data !== 'object') {
      return {
        isValid: false,
        errors: ['VariableMapping payload must be a non-null object.']
      };
    }

    const m = data as Partial<VariableMapping>;

    // 1. mapping_id
    if (!m.mapping_id || typeof m.mapping_id !== 'string' || m.mapping_id.trim() === '') {
      errors.push('mapping_id is required and must be a non-empty string identifier.');
    }

    // 2. dataset_version_id
    if (
      !m.dataset_version_id ||
      typeof m.dataset_version_id !== 'string' ||
      m.dataset_version_id.trim() === ''
    ) {
      errors.push('dataset_version_id is required and must be a non-empty string identifier.');
    }

    // 3. source_column
    if (!m.source_column || typeof m.source_column !== 'string' || m.source_column.trim() === '') {
      errors.push('source_column is required and must be a non-empty column name.');
    }

    // 4. variable_id
    if (!m.variable_id || typeof m.variable_id !== 'string' || m.variable_id.trim() === '') {
      errors.push('variable_id is required and must be a non-empty variable identifier.');
    }

    // 5. mapping_method
    if (!m.mapping_method || !VALID_MAPPING_METHODS.has(m.mapping_method as VariableMappingMethod)) {
      errors.push(
        `mapping_method is required and must be one of: ${Array.from(VALID_MAPPING_METHODS).join(', ')}.`
      );
    }

    // 6. status
    if (!m.status || !VALID_MAPPING_STATUSES.has(m.status as VariableMappingStatus)) {
      errors.push(
        `status is required and must be one of: ${Array.from(VALID_MAPPING_STATUSES).join(', ')}.`
      );
    }

    // Rule: SUGGESTED method cannot be CONFIRMED without explicit human/system confirmation
    if (m.mapping_method === 'SUGGESTED' && m.status === 'CONFIRMED') {
      errors.push(
        'SUGGESTED mappings cannot have status "CONFIRMED". They must be reviewed and transitioned with an explicit confirmation method.'
      );
    }

    // 7. created_by
    if (!m.created_by || typeof m.created_by !== 'string' || m.created_by.trim() === '') {
      errors.push('created_by is required and must be a non-empty string identifier.');
    }

    // 8. created_at
    if (!m.created_at || typeof m.created_at !== 'string' || Number.isNaN(Date.parse(m.created_at))) {
      errors.push('created_at is required and must be a valid ISO 8601 timestamp string.');
    }

    // 9. updated_at (optional)
    if (m.updated_at !== undefined && (typeof m.updated_at !== 'string' || Number.isNaN(Date.parse(m.updated_at)))) {
      errors.push('updated_at, if provided, must be a valid ISO 8601 timestamp string.');
    }

    // 10. column_metadata & Unit/Datatype Compatibility
    if (m.column_metadata !== undefined) {
      if (typeof m.column_metadata !== 'object' || m.column_metadata === null) {
        errors.push('column_metadata, if provided, must be an object.');
      } else {
        const colMeta = m.column_metadata;
        if (options?.targetVariable) {
          // Check unit compatibility
          const unitCheck = checkMappingUnitCompatibility(
            colMeta.unit,
            options.targetVariable.unit,
            options.targetVariable.dimension
          );
          if (!unitCheck.isCompatible && unitCheck.error) {
            errors.push(unitCheck.error);
          }

          // Check datatype compatibility
          const dtCheck = checkMappingDatatypeCompatibility(colMeta.datatype, options.targetVariable.datatype);
          if (!dtCheck.isCompatible && dtCheck.error) {
            errors.push(dtCheck.error);
          }
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Asserts that data satisfies the VariableMapping contract.
   * Throws typed ScientificVariableMappingError on validation failure.
   */
  public static assertValid(
    data: unknown,
    options?: {
      targetVariable?: Variable;
    }
  ): asserts data is VariableMapping {
    const result = VariableMappingValidator.validate(data, options);
    if (!result.isValid) {
      const firstErr = result.errors[0] || 'Invalid VariableMapping contract.';
      let code: VariableMappingErrorCode = 'MAPPING_INVALID_CONTRACT';

      if (firstErr.includes('mapping_id')) code = 'MAPPING_EMPTY_ID';
      else if (firstErr.includes('dataset_version_id')) code = 'MAPPING_EMPTY_DATASET_VERSION_ID';
      else if (firstErr.includes('source_column')) code = 'MAPPING_EMPTY_SOURCE_COLUMN';
      else if (firstErr.includes('variable_id')) code = 'MAPPING_EMPTY_VARIABLE_ID';
      else if (firstErr.includes('mapping_method')) code = 'MAPPING_INVALID_METHOD';
      else if (firstErr.includes('status')) code = 'MAPPING_INVALID_STATUS';
      else if (firstErr.includes('created_by')) code = 'MAPPING_EMPTY_CREATED_BY';
      else if (firstErr.includes('Incompatible units') || firstErr.includes('Incompatible dimension')) {
        code = 'MAPPING_INCOMPATIBLE_UNIT';
      } else if (firstErr.includes('Incompatible datatype')) {
        code = 'MAPPING_INCOMPATIBLE_DATATYPE';
      }

      throw new ScientificVariableMappingError(code, firstErr, { errors: result.errors });
    }
  }
}

export interface CreateVariableMappingParams {
  mapping_id: string;
  dataset_version_id: string;
  source_column: string;
  variable_id: string;
  mapping_method: VariableMappingMethod;
  status?: VariableMappingStatus;
  column_metadata?: ColumnMetadata;
  created_at?: string;
  updated_at?: string;
  created_by: string;
  notes?: string;
  metadata?: Record<string, unknown>;
}

export interface VariableMappingFactoryOptions {
  variableStore?: VariableStore;
  versionStore?: DatasetVersionStore;
}

/**
 * Factory function to construct and validate a new VariableMapping entity.
 */
export function createVariableMapping(
  params: CreateVariableMappingParams,
  options?: VariableMappingFactoryOptions
): VariableMapping {
  let targetVar: Variable | undefined;

  // 1. Validate Variable existence if variableStore provided
  if (options?.variableStore) {
    targetVar = options.variableStore.get(params.variable_id);
    if (!targetVar) {
      throw new ScientificVariableMappingError(
        'MAPPING_VARIABLE_NOT_FOUND',
        `Target Variable "${params.variable_id}" does not exist in the Variable Registry.`
      );
    }
  }

  // 2. Validate DatasetVersion existence if versionStore provided
  if (options?.versionStore) {
    const version = options.versionStore.get(params.dataset_version_id);
    if (!version) {
      throw new ScientificVariableMappingError(
        'MAPPING_DATASET_VERSION_NOT_FOUND',
        `DatasetVersion "${params.dataset_version_id}" does not exist in DatasetVersionStore.`
      );
    }
  }

  const now = new Date().toISOString();
  const mapping: VariableMapping = {
    mapping_id: params.mapping_id,
    dataset_version_id: params.dataset_version_id,
    source_column: params.source_column,
    variable_id: params.variable_id,
    mapping_method: params.mapping_method,
    status: params.status || (params.mapping_method === 'SUGGESTED' ? 'DRAFT' : 'CONFIRMED'),
    column_metadata: params.column_metadata,
    created_at: params.created_at || now,
    updated_at: params.updated_at || params.created_at || now,
    created_by: params.created_by,
    notes: params.notes,
    metadata: params.metadata
  };

  VariableMappingValidator.assertValid(mapping, { targetVariable: targetVar });
  return deepFreeze(JSON.parse(JSON.stringify(mapping)));
}

export interface VariableMappingFilter {
  dataset_version_id?: string;
  source_column?: string;
  variable_id?: string;
  status?: VariableMappingStatus;
  mapping_method?: VariableMappingMethod;
  created_by?: string;
}

export interface VariableResolutionResult {
  variable_id: string;
  source_columns: string[];
  primary_column?: string;
  has_conflict: boolean;
  message?: string;
}

/**
 * In-memory repository for VariableMapping contracts.
 * Enforces one-source-column-to-one-confirmed-variable rule,
 * conflict and duplicate prevention, provenance auditing, and resolution.
 */
export class VariableMappingStore {
  private mappings: Map<string, VariableMapping> = new Map();
  private variableStore?: VariableStore;
  private versionStore?: DatasetVersionStore;

  constructor(options?: { variableStore?: VariableStore; versionStore?: DatasetVersionStore }) {
    this.variableStore = options?.variableStore;
    this.versionStore = options?.versionStore;
  }

  /**
   * Registers a new VariableMapping.
   */
  public create(mapping: VariableMapping): VariableMapping {
    let targetVar: Variable | undefined;

    // Check Variable existence
    if (this.variableStore) {
      targetVar = this.variableStore.get(mapping.variable_id);
      if (!targetVar) {
        throw new ScientificVariableMappingError(
          'MAPPING_VARIABLE_NOT_FOUND',
          `Cannot create mapping: Variable "${mapping.variable_id}" not found in Variable Registry.`
        );
      }
    }

    // Check DatasetVersion existence
    if (this.versionStore) {
      const v = this.versionStore.get(mapping.dataset_version_id);
      if (!v) {
        throw new ScientificVariableMappingError(
          'MAPPING_DATASET_VERSION_NOT_FOUND',
          `Cannot create mapping: DatasetVersion "${mapping.dataset_version_id}" not found in DatasetVersionStore.`
        );
      }
    }

    VariableMappingValidator.assertValid(mapping, { targetVariable: targetVar });

    // Check mapping_id uniqueness
    if (this.mappings.has(mapping.mapping_id)) {
      throw new ScientificVariableMappingError(
        'MAPPING_DUPLICATE_ENTRY',
        `VariableMapping with ID "${mapping.mapping_id}" already exists.`
      );
    }

    // Check duplicate & conflict rules within the same dataset_version
    for (const existing of this.mappings.values()) {
      if (existing.dataset_version_id === mapping.dataset_version_id) {
        // 1. Exact Duplicate check (same column + same variable + same active status)
        if (
          existing.source_column === mapping.source_column &&
          existing.variable_id === mapping.variable_id &&
          existing.status === mapping.status &&
          existing.status === 'CONFIRMED'
        ) {
          throw new ScientificVariableMappingError(
            'MAPPING_DUPLICATE_ENTRY',
            `A CONFIRMED mapping between column "${mapping.source_column}" and variable "${mapping.variable_id}" already exists for dataset version "${mapping.dataset_version_id}".`
          );
        }

        // 2. 1 Column -> 1 Confirmed Variable Conflict Rule:
        // If the new mapping is CONFIRMED and the column already has another CONFIRMED variable
        if (
          mapping.status === 'CONFIRMED' &&
          existing.status === 'CONFIRMED' &&
          existing.source_column === mapping.source_column &&
          existing.variable_id !== mapping.variable_id
        ) {
          throw new ScientificVariableMappingError(
            'MAPPING_COLUMN_CONFLICT',
            `Column "${mapping.source_column}" is already CONFIRMED to variable "${existing.variable_id}". Cannot map to "${mapping.variable_id}" concurrently.`
          );
        }
      }
    }

    const cloned = deepFreeze(this.deepClone(mapping));
    this.mappings.set(mapping.mapping_id, cloned);
    return this.deepClone(cloned);
  }

  /**
   * Retrieves a VariableMapping by its mapping_id.
   */
  public get(mappingId: string): VariableMapping | undefined {
    const m = this.mappings.get(mappingId);
    if (!m) {
      return undefined;
    }
    return this.deepClone(m);
  }

  /**
   * Updates only mutable status, notes, and metadata while protecting immutable keys.
   */
  public updateStatus(
    mappingId: string,
    newStatus: VariableMappingStatus,
    options?: { updated_by?: string; notes?: string; metadata?: Record<string, unknown> }
  ): VariableMapping {
    const existing = this.mappings.get(mappingId);
    if (!existing) {
      throw new ScientificVariableMappingError(
        'MAPPING_NOT_FOUND',
        `VariableMapping with ID "${mappingId}" was not found.`
      );
    }

    if (!VALID_MAPPING_STATUSES.has(newStatus)) {
      throw new ScientificVariableMappingError(
        'MAPPING_INVALID_STATUS',
        `Invalid status "${newStatus}". Must be one of: ${Array.from(VALID_MAPPING_STATUSES).join(', ')}.`
      );
    }

    // Check conflict if transitioning to CONFIRMED
    if (newStatus === 'CONFIRMED' && existing.status !== 'CONFIRMED') {
      for (const m of this.mappings.values()) {
        if (
          m.mapping_id !== mappingId &&
          m.dataset_version_id === existing.dataset_version_id &&
          m.source_column === existing.source_column &&
          m.status === 'CONFIRMED'
        ) {
          throw new ScientificVariableMappingError(
            'MAPPING_COLUMN_CONFLICT',
            `Cannot confirm mapping "${mappingId}": Column "${existing.source_column}" is already confirmed to variable "${m.variable_id}".`
          );
        }
      }
    }

    const updated: VariableMapping = {
      ...existing,
      status: newStatus,
      updated_at: new Date().toISOString(),
      notes: options?.notes !== undefined ? options.notes : existing.notes,
      metadata: options?.metadata !== undefined ? options.metadata : existing.metadata
    };

    let targetVar: Variable | undefined;
    if (this.variableStore) {
      targetVar = this.variableStore.get(updated.variable_id);
    }

    VariableMappingValidator.assertValid(updated, { targetVariable: targetVar });
    const cloned = deepFreeze(this.deepClone(updated));
    this.mappings.set(mappingId, cloned);
    return this.deepClone(cloned);
  }

  /**
   * Lists VariableMapping records matching an optional filter.
   */
  public list(filter?: VariableMappingFilter): VariableMapping[] {
    const results: VariableMapping[] = [];

    for (const m of this.mappings.values()) {
      if (filter) {
        if (filter.dataset_version_id && m.dataset_version_id !== filter.dataset_version_id) continue;
        if (filter.source_column && m.source_column !== filter.source_column) continue;
        if (filter.variable_id && m.variable_id !== filter.variable_id) continue;
        if (filter.status && m.status !== filter.status) continue;
        if (filter.mapping_method && m.mapping_method !== filter.mapping_method) continue;
        if (filter.created_by && m.created_by !== filter.created_by) continue;
      }
      results.push(this.deepClone(m));
    }

    return results.sort((a, b) => a.mapping_id.localeCompare(b.mapping_id));
  }

  /**
   * Finds mappings by dataset_version_id.
   */
  public findByDatasetVersion(
    datasetVersionId: string,
    filter?: { status?: VariableMappingStatus }
  ): VariableMapping[] {
    return this.list({ dataset_version_id: datasetVersionId, status: filter?.status });
  }

  /**
   * Finds mappings by source_column on a specific dataset_version.
   */
  public findBySourceColumn(datasetVersionId: string, sourceColumn: string): VariableMapping[] {
    return this.list({ dataset_version_id: datasetVersionId, source_column: sourceColumn });
  }

  /**
   * Finds mappings by variable_id across dataset versions.
   */
  public findByVariable(
    variableId: string,
    filter?: { dataset_version_id?: string; status?: VariableMappingStatus }
  ): VariableMapping[] {
    return this.list({
      variable_id: variableId,
      dataset_version_id: filter?.dataset_version_id,
      status: filter?.status
    });
  }

  /**
   * Resolves a source column on a dataset version to its confirmed Variable entity.
   */
  public resolveColumnToVariable(datasetVersionId: string, sourceColumn: string): Variable | undefined {
    const confirmedMappings = this.list({
      dataset_version_id: datasetVersionId,
      source_column: sourceColumn,
      status: 'CONFIRMED'
    });

    if (confirmedMappings.length === 0) {
      return undefined;
    }

    const confirmed = confirmedMappings[0];
    if (this.variableStore) {
      return this.variableStore.get(confirmed.variable_id);
    }

    // Fallback: minimal synthetic representation if store not injected
    return {
      variable_id: confirmed.variable_id,
      name: confirmed.variable_id,
      description: 'Resolved mapped variable',
      datatype: 'NUMBER',
      status: 'ACTIVE',
      created_at: confirmed.created_at,
      updated_at: confirmed.created_at
    };
  }

  /**
   * Resolves a Variable on a dataset version to its originating source column(s).
   * Flags conflict/ambiguity if multiple columns are confirmed for the same variable.
   */
  public resolveVariableToColumn(datasetVersionId: string, variableId: string): VariableResolutionResult {
    const confirmedMappings = this.list({
      dataset_version_id: datasetVersionId,
      variable_id: variableId,
      status: 'CONFIRMED'
    });

    const sourceCols = confirmedMappings.map((m) => m.source_column);

    if (sourceCols.length === 0) {
      return {
        variable_id: variableId,
        source_columns: [],
        has_conflict: false,
        message: `No CONFIRMED mapping found for variable "${variableId}" in dataset version "${datasetVersionId}".`
      };
    }

    if (sourceCols.length === 1) {
      return {
        variable_id: variableId,
        source_columns: sourceCols,
        primary_column: sourceCols[0],
        has_conflict: false
      };
    }

    return {
      variable_id: variableId,
      source_columns: sourceCols,
      primary_column: sourceCols[0],
      has_conflict: true,
      message: `Ambiguity detected: Multiple columns [${sourceCols.join(', ')}] are CONFIRMED for variable "${variableId}".`
    };
  }

  /**
   * Clears all stored mappings (for test isolation).
   */
  public clear(): void {
    this.mappings.clear();
  }

  private deepClone<T>(val: T): T {
    if (val === undefined || val === null) {
      return val;
    }
    return deepFreeze(JSON.parse(JSON.stringify(val)));
  }
}

// Global default singleton instance
export const defaultVariableMappingStore = new VariableMappingStore({
  variableStore: defaultVariableStore,
  versionStore: defaultDatasetVersionStore
});
