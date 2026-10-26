/**
 * Phase D1 — Scientific Data Layer: Dataset Contract
 *
 * Defines the typed Dataset entity, structural contract validator,
 * and isolated in-memory DatasetStore for dataset identities.
 *
 * Explicitly decoupled from:
 * - DatasetVersion (Phase D2)
 * - Row data / Data snapshots
 * - Variable Registry / Variable Mapping (Phase D3-D5)
 * - Derived Variable Engine (Phase D6)
 * - Scientific Execution / Module resolution
 */

import {
  Dataset,
  DatasetContext,
  DatasetErrorCode,
  DatasetPopulation,
  DatasetPurpose,
  DatasetSensitivity,
  DatasetSource,
  DatasetSourceType,
  DatasetStatus,
  DatasetTemporalScope,
  ScientificDatasetError
} from '../types';

export const VALID_DATASET_PURPOSES: ReadonlySet<DatasetPurpose> = new Set<DatasetPurpose>([
  'LEARNING',
  'RESEARCH',
  'SIMULATION',
  'VALIDATION',
  'OTHER'
]);

export const VALID_DATASET_SOURCE_TYPES: ReadonlySet<DatasetSourceType> = new Set<DatasetSourceType>([
  'PRIMARY_COLLECTION',
  'SECONDARY_DATA',
  'PUBLIC_DATASET',
  'SYNTHETIC',
  'IMPORTED',
  'OTHER'
]);

export const VALID_DATASET_STATUSES: ReadonlySet<DatasetStatus> = new Set<DatasetStatus>([
  'DRAFT',
  'ACTIVE',
  'ARCHIVED'
]);

export const VALID_DATASET_SENSITIVITIES: ReadonlySet<DatasetSensitivity> = new Set<DatasetSensitivity>([
  'PUBLIC',
  'INTERNAL',
  'RESTRICTED',
  'SENSITIVE'
]);

export interface DatasetValidationResult {
  isValid: boolean;
  errors: string[];
}

/**
 * Structural contract validator for Dataset entities.
 * Strictly verifies schema structure, enum values, and mandatory fields without
 * asserting clinical validity or scientific quality.
 */
export class DatasetContractValidator {
  public static validate(data: unknown): DatasetValidationResult {
    const errors: string[] = [];

    if (!data || typeof data !== 'object') {
      return {
        isValid: false,
        errors: ['Dataset payload must be a non-null object.']
      };
    }

    const ds = data as Partial<Dataset>;

    // 1. dataset_id check
    if (!ds.dataset_id || typeof ds.dataset_id !== 'string' || ds.dataset_id.trim() === '') {
      errors.push('dataset_id is required and must be a non-empty string.');
    }

    // 2. name check
    if (!ds.name || typeof ds.name !== 'string' || ds.name.trim() === '') {
      errors.push('name is required and must be a non-empty human-readable string.');
    }

    // 3. owner_id check
    if (!ds.owner_id || typeof ds.owner_id !== 'string' || ds.owner_id.trim() === '') {
      errors.push('owner_id is required and must be a non-empty string identifier.');
    }

    // 4. purpose check
    if (!ds.purpose || !VALID_DATASET_PURPOSES.has(ds.purpose as DatasetPurpose)) {
      errors.push(
        `purpose is required and must be one of: ${Array.from(VALID_DATASET_PURPOSES).join(', ')}.`
      );
    }

    // 5. source check
    if (!ds.source || typeof ds.source !== 'object') {
      errors.push('source is required and must be a valid DatasetSource object.');
    } else {
      const src = ds.source as Partial<DatasetSource>;
      if (!src.type || !VALID_DATASET_SOURCE_TYPES.has(src.type as DatasetSourceType)) {
        errors.push(
          `source.type is required and must be one of: ${Array.from(VALID_DATASET_SOURCE_TYPES).join(', ')}.`
        );
      }
    }

    // 6. status check
    if (!ds.status || !VALID_DATASET_STATUSES.has(ds.status as DatasetStatus)) {
      errors.push(
        `status is required and must be one of: ${Array.from(VALID_DATASET_STATUSES).join(', ')}.`
      );
    }

    // 7. sensitivity check (optional)
    if (ds.sensitivity !== undefined && !VALID_DATASET_SENSITIVITIES.has(ds.sensitivity as DatasetSensitivity)) {
      errors.push(
        `sensitivity, if provided, must be one of: ${Array.from(VALID_DATASET_SENSITIVITIES).join(', ')}.`
      );
    }

    // 8. timestamp checks
    if (!ds.created_at || typeof ds.created_at !== 'string' || Number.isNaN(Date.parse(ds.created_at))) {
      errors.push('created_at is required and must be a valid ISO 8601 timestamp string.');
    }

    if (!ds.updated_at || typeof ds.updated_at !== 'string' || Number.isNaN(Date.parse(ds.updated_at))) {
      errors.push('updated_at is required and must be a valid ISO 8601 timestamp string.');
    }

    // 9. population check (optional)
    if (ds.population !== undefined && (typeof ds.population !== 'object' || ds.population === null)) {
      errors.push('population, if provided, must be an object.');
    }

    // 10. context check (optional)
    if (ds.context !== undefined && (typeof ds.context !== 'object' || ds.context === null)) {
      errors.push('context, if provided, must be an object.');
    }

    // 11. temporal_scope check (optional)
    if (ds.temporal_scope !== undefined && (typeof ds.temporal_scope !== 'object' || ds.temporal_scope === null)) {
      errors.push('temporal_scope, if provided, must be an object.');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Asserts that the provided data satisfies the Dataset contract.
   * Throws typed ScientificDatasetError on validation failure.
   */
  public static assertValid(data: unknown): asserts data is Dataset {
    const result = DatasetContractValidator.validate(data);
    if (!result.isValid) {
      const firstErr = result.errors[0] || 'Invalid Dataset contract.';
      let code: DatasetErrorCode = 'DATASET_INVALID_CONTRACT';

      if (firstErr.includes('dataset_id')) code = 'DATASET_EMPTY_ID';
      else if (firstErr.includes('name')) code = 'DATASET_EMPTY_NAME';
      else if (firstErr.includes('owner_id')) code = 'DATASET_EMPTY_OWNER';
      else if (firstErr.includes('purpose')) code = 'DATASET_INVALID_PURPOSE';
      else if (firstErr.includes('source')) code = 'DATASET_INVALID_SOURCE';
      else if (firstErr.includes('status')) code = 'DATASET_INVALID_STATUS';

      throw new ScientificDatasetError(code, firstErr, { errors: result.errors });
    }
  }
}

export interface CreateDatasetParams {
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
  status?: DatasetStatus;
  created_at?: string;
  updated_at?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Factory function to construct and validate a new Dataset entity.
 */
export function createDataset(params: CreateDatasetParams): Dataset {
  const now = new Date().toISOString();
  const dataset: Dataset = {
    dataset_id: params.dataset_id,
    name: params.name,
    description: params.description,
    owner_id: params.owner_id,
    project_id: params.project_id,
    purpose: params.purpose,
    source: params.source,
    population: params.population,
    context: params.context,
    temporal_scope: params.temporal_scope,
    sensitivity: params.sensitivity,
    status: params.status || 'DRAFT',
    created_at: params.created_at || now,
    updated_at: params.updated_at || params.created_at || now,
    metadata: params.metadata
  };

  DatasetContractValidator.assertValid(dataset);
  return Object.freeze(JSON.parse(JSON.stringify(dataset)));
}

export interface DatasetFilter {
  owner_id?: string;
  project_id?: string;
  status?: DatasetStatus;
  purpose?: DatasetPurpose;
}

/**
 * In-memory store for Dataset entity identities.
 * Ensures isolation, deep cloning on operations, and immutable dataset_id preservation.
 */
export class DatasetStore {
  private datasets: Map<string, Dataset> = new Map();

  /**
   * Registers a new Dataset entity.
   */
  public create(dataset: Dataset): Dataset {
    DatasetContractValidator.assertValid(dataset);

    if (this.datasets.has(dataset.dataset_id)) {
      throw new ScientificDatasetError(
        'DATASET_ALREADY_EXISTS',
        `Dataset with ID "${dataset.dataset_id}" already exists.`
      );
    }

    const cloned = Object.freeze(this.deepClone(dataset));
    this.datasets.set(dataset.dataset_id, cloned);
    return this.deepClone(cloned);
  }

  /**
   * Retrieves a Dataset entity by its dataset_id.
   */
  public get(datasetId: string): Dataset | undefined {
    const ds = this.datasets.get(datasetId);
    if (!ds) {
      return undefined;
    }
    return this.deepClone(ds);
  }

  /**
   * Updates metadata of an existing Dataset entity.
   * Prohibits mutating immutable dataset_id and created_at.
   */
  public update(
    datasetId: string,
    updates: Partial<Omit<Dataset, 'dataset_id' | 'created_at'>> & { dataset_id?: string; created_at?: string }
  ): Dataset {
    const existing = this.datasets.get(datasetId);
    if (!existing) {
      throw new ScientificDatasetError(
        'DATASET_NOT_FOUND',
        `Dataset with ID "${datasetId}" was not found.`
      );
    }

    if (updates.dataset_id !== undefined && updates.dataset_id !== datasetId) {
      throw new ScientificDatasetError(
        'DATASET_IMMUTABLE_ID_VIOLATION',
        `dataset_id is immutable. Attempted to change from "${datasetId}" to "${updates.dataset_id}".`
      );
    }

    const updatedDataset: Dataset = {
      ...existing,
      ...updates,
      dataset_id: existing.dataset_id,
      created_at: existing.created_at,
      updated_at: new Date().toISOString()
    };

    DatasetContractValidator.assertValid(updatedDataset);

    const cloned = Object.freeze(this.deepClone(updatedDataset));
    this.datasets.set(datasetId, cloned);
    return this.deepClone(cloned);
  }

  /**
   * Lists Dataset entities matching an optional filter.
   */
  public list(filter?: DatasetFilter): Dataset[] {
    const results: Dataset[] = [];

    for (const ds of this.datasets.values()) {
      if (filter) {
        if (filter.owner_id && ds.owner_id !== filter.owner_id) continue;
        if (filter.project_id && ds.project_id !== filter.project_id) continue;
        if (filter.status && ds.status !== filter.status) continue;
        if (filter.purpose && ds.purpose !== filter.purpose) continue;
      }
      results.push(this.deepClone(ds));
    }

    return results;
  }

  /**
   * Resets the store (for test isolation).
   */
  public clear(): void {
    this.datasets.clear();
  }

  private deepClone<T>(val: T): T {
    if (val === undefined || val === null) {
      return val;
    }
    return JSON.parse(JSON.stringify(val));
  }
}

// Global default instance
export const defaultDatasetStore = new DatasetStore();
