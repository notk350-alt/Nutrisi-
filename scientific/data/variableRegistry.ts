/**
 * Phase D3 — Scientific Data Layer: Variable Registry
 *
 * Implements the typed Variable entity, structural contract validator,
 * unit and dimension compatibility validation (integrated with C1-C8 Unit Engine),
 * and an isolated in-memory VariableStore for semantic variable definitions.
 *
 * Explicitly decoupled from:
 * - D4 Variable Mapping (Dataset column bindings)
 * - D5 Data-State Pipeline
 * - D6 Data Validation Engine
 * - D7 Derived Variable Engine
 * - D8 Dataset Execution Binding
 * - ScientificModule AST calculators
 */

import {
  MeasurementType,
  ScientificVariableError,
  Variable,
  VariableAllowedRange,
  VariableCategory,
  VariableDataType,
  VariableErrorCode,
  VariableMissingPolicy,
  VariableSemanticType,
  VariableStatus
} from '../types';
import { findUnit } from '../units/unitConverter';

export const VALID_VARIABLE_DATATYPES: ReadonlySet<VariableDataType> = new Set<VariableDataType>([
  'NUMBER',
  'INTEGER',
  'BOOLEAN',
  'STRING',
  'DATE',
  'DATETIME',
  'CATEGORICAL'
]);

export const VALID_VARIABLE_SEMANTIC_TYPES: ReadonlySet<VariableSemanticType> = new Set<VariableSemanticType>([
  'CONTINUOUS',
  'DISCRETE',
  'NOMINAL',
  'ORDINAL',
  'BINARY',
  'TEMPORAL'
]);

export const VALID_VARIABLE_CATEGORIES: ReadonlySet<VariableCategory> = new Set<VariableCategory>([
  'ANTHROPOMETRY',
  'DEMOGRAPHIC',
  'PHYSIOLOGICAL',
  'NUTRITION',
  'LABORATORY',
  'ACTIVITY',
  'OTHER'
]);

export const VALID_VARIABLE_MISSING_POLICIES: ReadonlySet<VariableMissingPolicy> = new Set<VariableMissingPolicy>([
  'REQUIRED',
  'OPTIONAL',
  'IGNORE',
  'DEFAULT',
  'FALLBACK',
  'ERROR'
]);

export const VALID_VARIABLE_STATUSES: ReadonlySet<VariableStatus> = new Set<VariableStatus>([
  'DRAFT',
  'ACTIVE',
  'DEPRECATED'
]);

export interface VariableValidationResult {
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
 * Structural contract validator for Variable entities.
 * Verifies identity, datatypes, unit & dimension compatibility, ranges, and policies.
 */
export class VariableValidator {
  public static validate(data: unknown): VariableValidationResult {
    const errors: string[] = [];

    if (!data || typeof data !== 'object') {
      return {
        isValid: false,
        errors: ['Variable payload must be a non-null object.']
      };
    }

    const v = data as Partial<Variable>;

    // 1. variable_id check
    if (!v.variable_id || typeof v.variable_id !== 'string' || v.variable_id.trim() === '') {
      errors.push('variable_id is required and must be a non-empty string identifier.');
    }

    // 2. name check
    if (!v.name || typeof v.name !== 'string' || v.name.trim() === '') {
      errors.push('name is required and must be a non-empty human-readable string.');
    }

    // 3. description check
    if (typeof v.description !== 'string' || v.description.trim() === '') {
      errors.push('description is required and must be a non-empty string defining the semantic meaning.');
    }

    // 4. datatype check
    if (!v.datatype || !VALID_VARIABLE_DATATYPES.has(v.datatype as VariableDataType)) {
      errors.push(
        `datatype is required and must be one of: ${Array.from(VALID_VARIABLE_DATATYPES).join(', ')}.`
      );
    }

    // 5. status check
    if (!v.status || !VALID_VARIABLE_STATUSES.has(v.status as VariableStatus)) {
      errors.push(
        `status is required and must be one of: ${Array.from(VALID_VARIABLE_STATUSES).join(', ')}.`
      );
    }

    // 6. semantic_type check (optional)
    if (
      v.semantic_type !== undefined &&
      !VALID_VARIABLE_SEMANTIC_TYPES.has(v.semantic_type as VariableSemanticType)
    ) {
      errors.push(
        `semantic_type, if provided, must be one of: ${Array.from(VALID_VARIABLE_SEMANTIC_TYPES).join(', ')}.`
      );
    }

    // 7. category check (optional)
    if (v.category !== undefined && !VALID_VARIABLE_CATEGORIES.has(v.category as VariableCategory)) {
      errors.push(
        `category, if provided, must be one of: ${Array.from(VALID_VARIABLE_CATEGORIES).join(', ')}.`
      );
    }

    // 8. missing_policy check (optional)
    if (
      v.missing_policy !== undefined &&
      !VALID_VARIABLE_MISSING_POLICIES.has(v.missing_policy as VariableMissingPolicy)
    ) {
      errors.push(
        `missing_policy, if provided, must be one of: ${Array.from(VALID_VARIABLE_MISSING_POLICIES).join(', ')}.`
      );
    }

    // 9. Unit & Dimension Validation (Integrated with Scientific Unit Engine)
    let resolvedUnitDimension: MeasurementType | undefined;
    if (v.unit !== undefined && typeof v.unit === 'string' && v.unit.trim() !== '') {
      const found = findUnit(v.unit);
      if (!found) {
        errors.push(`unit "${v.unit}" is not recognized in the Scientific Unit Registry.`);
      } else {
        resolvedUnitDimension = found.measurement_type;
      }
    }

    // If both unit and dimension are supplied, assert physical compatibility
    if (v.dimension !== undefined && typeof v.dimension === 'string' && v.dimension.trim() !== '') {
      const normDimension = v.dimension.toLowerCase();
      if (resolvedUnitDimension && resolvedUnitDimension !== 'dimensionless' && normDimension !== 'dimensionless') {
        if (resolvedUnitDimension !== normDimension) {
          errors.push(
            `Incompatible unit and dimension: unit "${v.unit}" has dimension "${resolvedUnitDimension}", but variable specifies dimension "${v.dimension}".`
          );
        }
      }
    }

    // 10. allowed_range check (optional)
    if (v.allowed_range !== undefined) {
      if (typeof v.allowed_range !== 'object' || v.allowed_range === null) {
        errors.push('allowed_range, if provided, must be an object.');
      } else {
        const range = v.allowed_range as VariableAllowedRange;
        if (range.min !== undefined && typeof range.min !== 'number') {
          errors.push('allowed_range.min, if provided, must be a number.');
        }
        if (range.max !== undefined && typeof range.max !== 'number') {
          errors.push('allowed_range.max, if provided, must be a number.');
        }
        if (
          range.min !== undefined &&
          range.max !== undefined &&
          typeof range.min === 'number' &&
          typeof range.max === 'number'
        ) {
          if (range.min > range.max) {
            errors.push(
              `allowed_range contract violation: min (${range.min}) must be less than or equal to max (${range.max}).`
            );
          }
        }
        if (
          range.warning_min !== undefined &&
          range.warning_max !== undefined &&
          typeof range.warning_min === 'number' &&
          typeof range.warning_max === 'number'
        ) {
          if (range.warning_min > range.warning_max) {
            errors.push(
              `allowed_range contract violation: warning_min (${range.warning_min}) must be less than or equal to warning_max (${range.warning_max}).`
            );
          }
        }
      }
    }

    // 11. categories check (optional for CATEGORICAL)
    if (v.categories !== undefined) {
      if (!Array.isArray(v.categories) || !v.categories.every((c) => typeof c === 'string')) {
        errors.push('categories, if provided, must be an array of strings.');
      }
    }

    // 12. timestamp checks
    if (!v.created_at || typeof v.created_at !== 'string' || Number.isNaN(Date.parse(v.created_at))) {
      errors.push('created_at is required and must be a valid ISO 8601 timestamp string.');
    }
    if (!v.updated_at || typeof v.updated_at !== 'string' || Number.isNaN(Date.parse(v.updated_at))) {
      errors.push('updated_at is required and must be a valid ISO 8601 timestamp string.');
    }

    // 13. metadata check (optional)
    if (v.metadata !== undefined && (typeof v.metadata !== 'object' || v.metadata === null)) {
      errors.push('metadata, if provided, must be an object.');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Asserts that data satisfies the Variable contract.
   * Throws typed ScientificVariableError on validation failure.
   */
  public static assertValid(data: unknown): asserts data is Variable {
    const result = VariableValidator.validate(data);
    if (!result.isValid) {
      const firstErr = result.errors[0] || 'Invalid Variable contract.';
      let code: VariableErrorCode = 'VARIABLE_INVALID_CONTRACT';

      if (firstErr.includes('variable_id')) code = 'VARIABLE_EMPTY_ID';
      else if (firstErr.includes('name')) code = 'VARIABLE_EMPTY_NAME';
      else if (firstErr.includes('description')) code = 'VARIABLE_EMPTY_DESCRIPTION';
      else if (firstErr.includes('datatype')) code = 'VARIABLE_INVALID_DATATYPE';
      else if (firstErr.includes('status')) code = 'VARIABLE_INVALID_STATUS';
      else if (firstErr.includes('semantic_type')) code = 'VARIABLE_INVALID_SEMANTIC_TYPE';
      else if (firstErr.includes('category')) code = 'VARIABLE_INVALID_CATEGORY';
      else if (firstErr.includes('missing_policy')) code = 'VARIABLE_INVALID_MISSING_POLICY';
      else if (firstErr.includes('Incompatible unit and dimension')) code = 'VARIABLE_INCOMPATIBLE_UNIT_DIMENSION';
      else if (firstErr.includes('not recognized in the Scientific Unit Registry')) code = 'VARIABLE_INVALID_UNIT';
      else if (firstErr.includes('allowed_range')) code = 'VARIABLE_INVALID_RANGE';

      throw new ScientificVariableError(code, firstErr, { errors: result.errors });
    }
  }
}

export const VariableContractValidator = VariableValidator;

export interface CreateVariableParams {
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
  status?: VariableStatus;
  created_at?: string;
  updated_at?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Factory function to construct and validate a new Variable entity.
 */
export function createVariable(params: CreateVariableParams): Variable {
  const now = new Date().toISOString();
  const variable: Variable = {
    variable_id: params.variable_id,
    name: params.name,
    description: params.description,
    datatype: params.datatype,
    unit: params.unit,
    dimension: params.dimension,
    semantic_type: params.semantic_type,
    category: params.category,
    required: params.required,
    allowed_range: params.allowed_range,
    categories: params.categories,
    missing_policy: params.missing_policy,
    status: params.status || 'ACTIVE',
    created_at: params.created_at || now,
    updated_at: params.updated_at || params.created_at || now,
    metadata: params.metadata
  };

  VariableValidator.assertValid(variable);
  return deepFreeze(JSON.parse(JSON.stringify(variable)));
}

export interface VariableFilter {
  datatype?: VariableDataType;
  category?: VariableCategory;
  dimension?: string;
  status?: VariableStatus;
  semantic_type?: VariableSemanticType;
}

/**
 * In-memory repository for Variable entities.
 * Guarantees immutable identity, duplicate protection, deterministic retrieval,
 * and complete independence from datasets and scientific calculators.
 */
export class VariableStore {
  private variables: Map<string, Variable> = new Map();

  /**
   * Registers a new Variable entity in the registry.
   */
  public create(variable: Variable): Variable {
    VariableValidator.assertValid(variable);

    if (this.variables.has(variable.variable_id)) {
      throw new ScientificVariableError(
        'VARIABLE_ALREADY_EXISTS',
        `Variable with ID "${variable.variable_id}" already exists in the registry.`
      );
    }

    const cloned = deepFreeze(this.deepClone(variable));
    this.variables.set(variable.variable_id, cloned);
    return this.deepClone(cloned);
  }

  /**
   * Retrieves a Variable by its unique variable_id.
   */
  public get(variableId: string): Variable | undefined {
    const v = this.variables.get(variableId);
    if (!v) {
      return undefined;
    }
    return this.deepClone(v);
  }

  /**
   * Updates mutable metadata of an existing Variable.
   * Strictly prohibits altering immutable variable_id and created_at.
   */
  public update(
    variableId: string,
    updates: Partial<Omit<Variable, 'variable_id' | 'created_at'>> & {
      variable_id?: string;
      created_at?: string;
    }
  ): Variable {
    const existing = this.variables.get(variableId);
    if (!existing) {
      throw new ScientificVariableError(
        'VARIABLE_NOT_FOUND',
        `Variable with ID "${variableId}" was not found in the registry.`
      );
    }

    if (updates.variable_id !== undefined && updates.variable_id !== variableId) {
      throw new ScientificVariableError(
        'VARIABLE_IMMUTABLE_ID_VIOLATION',
        `variable_id is immutable. Attempted to change from "${variableId}" to "${updates.variable_id}".`
      );
    }

    const updatedVariable: Variable = {
      ...existing,
      ...updates,
      variable_id: existing.variable_id,
      created_at: existing.created_at,
      updated_at: new Date().toISOString()
    };

    VariableValidator.assertValid(updatedVariable);

    const cloned = deepFreeze(this.deepClone(updatedVariable));
    this.variables.set(variableId, cloned);
    return this.deepClone(cloned);
  }

  /**
   * Lists variables matching an optional filter, sorted deterministically by variable_id ascending.
   */
  public list(filter?: VariableFilter): Variable[] {
    const results: Variable[] = [];

    for (const v of this.variables.values()) {
      if (filter) {
        if (filter.datatype && v.datatype !== filter.datatype) continue;
        if (filter.category && v.category !== filter.category) continue;
        if (filter.status && v.status !== filter.status) continue;
        if (filter.semantic_type && v.semantic_type !== filter.semantic_type) continue;
        if (filter.dimension) {
          const targetDim = filter.dimension.toLowerCase();
          const varDim = v.dimension?.toLowerCase();
          if (varDim !== targetDim) continue;
        }
      }
      results.push(this.deepClone(v));
    }

    return results.sort((a, b) => a.variable_id.localeCompare(b.variable_id));
  }

  /**
   * Finds variables whose name contains the search query (case-insensitive).
   */
  public findByName(query: string): Variable[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return this.list().filter((v) => v.name.toLowerCase().includes(q));
  }

  /**
   * Finds variables by category.
   */
  public findByCategory(category: VariableCategory): Variable[] {
    return this.list({ category });
  }

  /**
   * Finds variables by dimension / measurement type.
   */
  public findByDimension(dimension: string): Variable[] {
    return this.list({ dimension });
  }

  /**
   * Clears the store (for test isolation).
   */
  public clear(): void {
    this.variables.clear();
  }

  private deepClone<T>(val: T): T {
    if (val === undefined || val === null) {
      return val;
    }
    return deepFreeze(JSON.parse(JSON.stringify(val)));
  }
}

// Global default singleton instance
export const defaultVariableStore = new VariableStore();
export { VariableStore as VariableRegistryStore };
