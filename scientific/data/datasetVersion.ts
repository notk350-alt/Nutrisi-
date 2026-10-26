/**
 * Phase D2 — Scientific Data Layer: Dataset Versioning
 *
 * Implements immutable DatasetVersion contract, deterministic content/metadata
 * integrity hashing (SHA-256), parent-version lineage tracking, validation,
 * and isolated in-memory DatasetVersionStore.
 *
 * Explicitly decoupled from:
 * - D3 Variable Registry
 * - D4 Variable Mapping
 * - D5 Data-State Pipeline
 * - D6 Data Validation Engine
 * - D7 Derived Variable Engine
 * - D8 Dataset Execution Binding
 * - Statistical/cleaning algorithms
 */

import * as crypto from 'crypto';
import {
  DatasetDataReference,
  DatasetVersion,
  DatasetVersionErrorCode,
  DatasetVersionStatus,
  ScientificDatasetVersionError
} from '../types';
import { canonicalizeJson } from '../provenance/provenancePersistence';
import { DatasetStore, defaultDatasetStore } from './datasetContract';

export const VALID_DATASET_VERSION_STATUSES: ReadonlySet<DatasetVersionStatus> = new Set<DatasetVersionStatus>([
  'DRAFT',
  'SEALED',
  'ACTIVE',
  'DEPRECATED',
  'ARCHIVED'
]);

export interface DatasetVersionValidationResult {
  isValid: boolean;
  errors: string[];
}

/**
 * Computes deterministic SHA-256 checksum for dataset version metadata & data reference.
 * Strictly verifies identity & integrity evidence without asserting scientific truth.
 */
export function computeDatasetVersionChecksum(
  versionData: Omit<DatasetVersion, 'checksum'> | Partial<DatasetVersion>
): string {
  const payload = {
    version_id: versionData.version_id,
    dataset_id: versionData.dataset_id,
    version_number: versionData.version_number,
    version_tag: versionData.version_tag || null,
    parent_version_id: versionData.parent_version_id || null,
    created_at: versionData.created_at,
    created_by: versionData.created_by,
    data_reference: versionData.data_reference || null,
    record_count: versionData.record_count ?? null,
    column_count: versionData.column_count ?? null,
    metadata: versionData.metadata || null
  };

  const canonical = canonicalizeJson(payload);
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/**
 * Structural contract validator for DatasetVersion entities.
 */
export class DatasetVersionValidator {
  public static validate(data: unknown): DatasetVersionValidationResult {
    const errors: string[] = [];

    if (!data || typeof data !== 'object') {
      return {
        isValid: false,
        errors: ['DatasetVersion payload must be a non-null object.']
      };
    }

    const v = data as Partial<DatasetVersion>;

    // 1. version_id
    if (!v.version_id || typeof v.version_id !== 'string' || v.version_id.trim() === '') {
      errors.push('version_id is required and must be a non-empty string.');
    }

    // 2. dataset_id
    if (!v.dataset_id || typeof v.dataset_id !== 'string' || v.dataset_id.trim() === '') {
      errors.push('dataset_id is required and must be a non-empty string.');
    }

    // 3. version_number
    if (
      v.version_number === undefined ||
      typeof v.version_number !== 'number' ||
      !Number.isInteger(v.version_number) ||
      v.version_number <= 0
    ) {
      errors.push('version_number is required and must be a positive integer (>= 1).');
    }

    // 4. status
    if (!v.status || !VALID_DATASET_VERSION_STATUSES.has(v.status as DatasetVersionStatus)) {
      errors.push(
        `status is required and must be one of: ${Array.from(VALID_DATASET_VERSION_STATUSES).join(', ')}.`
      );
    }

    // 5. created_by
    if (!v.created_by || typeof v.created_by !== 'string' || v.created_by.trim() === '') {
      errors.push('created_by is required and must be a non-empty string identifier.');
    }

    // 6. created_at
    if (!v.created_at || typeof v.created_at !== 'string' || Number.isNaN(Date.parse(v.created_at))) {
      errors.push('created_at is required and must be a valid ISO 8601 timestamp string.');
    }

    // 7. checksum
    if (!v.checksum || typeof v.checksum !== 'string' || !/^[a-f0-9]{64}$/i.test(v.checksum)) {
      errors.push('checksum is required and must be a 64-character hexadecimal SHA-256 string.');
    }

    // 8. parent_version_id (optional, string or null)
    if (
      v.parent_version_id !== undefined &&
      v.parent_version_id !== null &&
      (typeof v.parent_version_id !== 'string' || v.parent_version_id.trim() === '')
    ) {
      errors.push('parent_version_id, if provided, must be a non-empty string or null.');
    }

    // 9. record_count (optional, non-negative integer)
    if (
      v.record_count !== undefined &&
      (typeof v.record_count !== 'number' || !Number.isInteger(v.record_count) || v.record_count < 0)
    ) {
      errors.push('record_count, if provided, must be an integer >= 0.');
    }

    // 10. column_count (optional, non-negative integer)
    if (
      v.column_count !== undefined &&
      (typeof v.column_count !== 'number' || !Number.isInteger(v.column_count) || v.column_count < 0)
    ) {
      errors.push('column_count, if provided, must be an integer >= 0.');
    }

    // 11. data_reference (optional object)
    if (v.data_reference !== undefined && (typeof v.data_reference !== 'object' || v.data_reference === null)) {
      errors.push('data_reference, if provided, must be an object.');
    }

    // 12. metadata (optional object)
    if (v.metadata !== undefined && (typeof v.metadata !== 'object' || v.metadata === null)) {
      errors.push('metadata, if provided, must be an object.');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Asserts that data satisfies the DatasetVersion contract.
   */
  public static assertValid(data: unknown): asserts data is DatasetVersion {
    const result = DatasetVersionValidator.validate(data);
    if (!result.isValid) {
      const firstErr = result.errors[0] || 'Invalid DatasetVersion contract.';
      let code: DatasetVersionErrorCode = 'VERSION_INVALID_CONTRACT';

      if (firstErr.includes('version_id')) code = 'VERSION_EMPTY_ID';
      else if (firstErr.includes('dataset_id')) code = 'VERSION_EMPTY_DATASET_ID';
      else if (firstErr.includes('version_number')) code = 'VERSION_INVALID_NUMBER';
      else if (firstErr.includes('status')) code = 'VERSION_INVALID_STATUS';
      else if (firstErr.includes('created_by')) code = 'VERSION_EMPTY_AUTHOR';

      throw new ScientificDatasetVersionError(code, firstErr, { errors: result.errors });
    }
  }
}

export interface CreateDatasetVersionParams {
  version_id: string;
  dataset_id: string;
  version_number?: number;
  version_tag?: string;
  parent_version_id?: string | null;
  status?: DatasetVersionStatus;
  description?: string;
  created_at?: string;
  created_by: string;
  checksum?: string;
  data_reference?: DatasetDataReference;
  record_count?: number;
  column_count?: number;
  metadata?: Record<string, unknown>;
}

export interface DatasetVersionFactoryOptions {
  datasetStore?: DatasetStore;
  versionStore?: DatasetVersionStore;
}

/**
 * Factory function to construct and validate a new DatasetVersion entity.
 */
export function createDatasetVersion(
  params: CreateDatasetVersionParams,
  options?: DatasetVersionFactoryOptions
): DatasetVersion {
  const datasetStore = options?.datasetStore;
  const versionStore = options?.versionStore;

  // Validate dataset existence if datasetStore provided
  if (datasetStore) {
    const dataset = datasetStore.get(params.dataset_id);
    if (!dataset) {
      throw new ScientificDatasetVersionError(
        'VERSION_DATASET_NOT_FOUND',
        `Cannot create version: parent dataset "${params.dataset_id}" does not exist in DatasetStore.`
      );
    }
  }

  // Validate parent version existence & dataset match if parent_version_id and versionStore provided
  if (params.parent_version_id && versionStore) {
    const parentVersion = versionStore.get(params.parent_version_id);
    if (!parentVersion) {
      throw new ScientificDatasetVersionError(
        'VERSION_PARENT_NOT_FOUND',
        `Parent version "${params.parent_version_id}" was not found in DatasetVersionStore.`
      );
    }
    if (parentVersion.dataset_id !== params.dataset_id) {
      throw new ScientificDatasetVersionError(
        'VERSION_PARENT_MISMATCH',
        `Parent version "${params.parent_version_id}" belongs to dataset "${parentVersion.dataset_id}", expected "${params.dataset_id}".`
      );
    }
  }

  // Determine version number
  let versionNumber = params.version_number;
  if (versionNumber === undefined && versionStore) {
    const existing = versionStore.listByDataset(params.dataset_id);
    const maxNum = existing.reduce((max, v) => (v.version_number > max ? v.version_number : max), 0);
    versionNumber = maxNum + 1;
  } else if (versionNumber === undefined) {
    versionNumber = 1;
  }

  const now = new Date().toISOString();
  const rawVersion: Omit<DatasetVersion, 'checksum'> = {
    version_id: params.version_id,
    dataset_id: params.dataset_id,
    version_number: versionNumber,
    version_tag: params.version_tag,
    parent_version_id: params.parent_version_id || null,
    status: params.status || 'SEALED',
    description: params.description,
    created_at: params.created_at || now,
    created_by: params.created_by,
    data_reference: params.data_reference,
    record_count: params.record_count,
    column_count: params.column_count,
    metadata: params.metadata
  };

  const calculatedChecksum = computeDatasetVersionChecksum(rawVersion);

  if (params.checksum && params.checksum !== calculatedChecksum) {
    throw new ScientificDatasetVersionError(
      'VERSION_INTEGRITY_MISMATCH',
      `Provided checksum "${params.checksum}" does not match computed checksum "${calculatedChecksum}".`
    );
  }

  const version: DatasetVersion = {
    ...rawVersion,
    checksum: params.checksum || calculatedChecksum
  };

  DatasetVersionValidator.assertValid(version);
  return Object.freeze(JSON.parse(JSON.stringify(version)));
}

export interface DatasetVersionFilter {
  dataset_id?: string;
  status?: DatasetVersionStatus;
  created_by?: string;
  parent_version_id?: string | null;
}

export interface DatasetVersionLineageNode {
  version: DatasetVersion;
  children: DatasetVersionLineageNode[];
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
 * In-memory repository for DatasetVersion entities.
 * Enforces immutability, parent-lineage validation, cycle prevention, and isolation.
 */
export class DatasetVersionStore {
  private versions: Map<string, DatasetVersion> = new Map();
  private datasetStore?: DatasetStore;

  constructor(datasetStore?: DatasetStore) {
    this.datasetStore = datasetStore;
  }

  /**
   * Registers a new DatasetVersion entity.
   */
  public create(version: DatasetVersion): DatasetVersion {
    DatasetVersionValidator.assertValid(version);

    if (this.versions.has(version.version_id)) {
      throw new ScientificDatasetVersionError(
        'VERSION_ALREADY_EXISTS',
        `DatasetVersion with ID "${version.version_id}" already exists.`
      );
    }

    // Verify parent dataset if datasetStore is configured
    if (this.datasetStore) {
      const ds = this.datasetStore.get(version.dataset_id);
      if (!ds) {
        throw new ScientificDatasetVersionError(
          'VERSION_DATASET_NOT_FOUND',
          `Parent dataset "${version.dataset_id}" does not exist in DatasetStore.`
        );
      }
    }

    // Verify duplicate version_number for the same dataset
    for (const existing of this.versions.values()) {
      if (
        existing.dataset_id === version.dataset_id &&
        existing.version_number === version.version_number
      ) {
        throw new ScientificDatasetVersionError(
          'VERSION_DUPLICATE_NUMBER',
          `Dataset "${version.dataset_id}" already has a version numbered ${version.version_number} (ID: "${existing.version_id}").`
        );
      }
    }

    // Verify parent_version_id if specified
    if (version.parent_version_id) {
      if (version.parent_version_id === version.version_id) {
        throw new ScientificDatasetVersionError(
          'VERSION_CYCLIC_LINEAGE',
          `DatasetVersion "${version.version_id}" cannot be its own parent.`
        );
      }

      const parent = this.versions.get(version.parent_version_id);
      if (!parent) {
        throw new ScientificDatasetVersionError(
          'VERSION_PARENT_NOT_FOUND',
          `Parent version "${version.parent_version_id}" was not found in DatasetVersionStore.`
        );
      }

      if (parent.dataset_id !== version.dataset_id) {
        throw new ScientificDatasetVersionError(
          'VERSION_PARENT_MISMATCH',
          `Parent version "${version.parent_version_id}" belongs to dataset "${parent.dataset_id}", expected "${version.dataset_id}".`
        );
      }

      // Check for cycles in ancestry
      let currParentId: string | null | undefined = parent.parent_version_id;
      const visited = new Set<string>([version.version_id, version.parent_version_id]);
      while (currParentId) {
        if (visited.has(currParentId)) {
          throw new ScientificDatasetVersionError(
            'VERSION_CYCLIC_LINEAGE',
            `Cycle detected in version lineage involving version "${currParentId}".`
          );
        }
        visited.add(currParentId);
        const nextParent = this.versions.get(currParentId);
        currParentId = nextParent?.parent_version_id;
      }
    }

    const cloned = Object.freeze(this.deepClone(version));
    this.versions.set(version.version_id, cloned);
    return this.deepClone(cloned);
  }

  /**
   * Retrieves a DatasetVersion by its version_id.
   */
  public get(versionId: string): DatasetVersion | undefined {
    const v = this.versions.get(versionId);
    if (!v) {
      return undefined;
    }
    return this.deepClone(v);
  }

  /**
   * Retrieves a DatasetVersion by dataset_id and version_number.
   */
  public getByDatasetAndNumber(datasetId: string, versionNumber: number): DatasetVersion | undefined {
    for (const v of this.versions.values()) {
      if (v.dataset_id === datasetId && v.version_number === versionNumber) {
        return this.deepClone(v);
      }
    }
    return undefined;
  }

  /**
   * Lists all versions for a given dataset_id, ordered by version_number ascending.
   */
  public listByDataset(datasetId: string, filter?: Omit<DatasetVersionFilter, 'dataset_id'>): DatasetVersion[] {
    const list: DatasetVersion[] = [];

    for (const v of this.versions.values()) {
      if (v.dataset_id !== datasetId) continue;
      if (filter) {
        if (filter.status && v.status !== filter.status) continue;
        if (filter.created_by && v.created_by !== filter.created_by) continue;
        if (filter.parent_version_id !== undefined && v.parent_version_id !== filter.parent_version_id) continue;
      }
      list.push(this.deepClone(v));
    }

    return list.sort((a, b) => a.version_number - b.version_number);
  }

  /**
   * Lists DatasetVersion entities matching an optional filter.
   */
  public list(filter?: DatasetVersionFilter): DatasetVersion[] {
    const list: DatasetVersion[] = [];

    for (const v of this.versions.values()) {
      if (filter) {
        if (filter.dataset_id && v.dataset_id !== filter.dataset_id) continue;
        if (filter.status && v.status !== filter.status) continue;
        if (filter.created_by && v.created_by !== filter.created_by) continue;
        if (filter.parent_version_id !== undefined && v.parent_version_id !== filter.parent_version_id) continue;
      }
      list.push(this.deepClone(v));
    }

    return list.sort((a, b) => a.version_number - b.version_number);
  }

  /**
   * Updates only mutable lifecycle status and description of a version.
   * Strictly prevents modifying immutable fields: version_id, dataset_id,
   * version_number, parent_version_id, created_at, created_by, checksum, data_reference.
   */
  public updateStatus(
    versionId: string,
    newStatus: DatasetVersionStatus,
    description?: string
  ): DatasetVersion {
    const existing = this.versions.get(versionId);
    if (!existing) {
      throw new ScientificDatasetVersionError(
        'VERSION_NOT_FOUND',
        `DatasetVersion with ID "${versionId}" was not found.`
      );
    }

    if (!VALID_DATASET_VERSION_STATUSES.has(newStatus)) {
      throw new ScientificDatasetVersionError(
        'VERSION_INVALID_STATUS',
        `Invalid status "${newStatus}". Must be one of: ${Array.from(VALID_DATASET_VERSION_STATUSES).join(', ')}.`
      );
    }

    const updated: DatasetVersion = {
      ...existing,
      status: newStatus,
      description: description !== undefined ? description : existing.description
    };

    DatasetVersionValidator.assertValid(updated);
    const cloned = Object.freeze(this.deepClone(updated));
    this.versions.set(versionId, cloned);
    return this.deepClone(cloned);
  }

  /**
   * Retrieves ordered lineage ancestry chain [parent, grandparent, ..., root].
   */
  public getAncestry(versionId: string): DatasetVersion[] {
    const ancestry: DatasetVersion[] = [];
    const visited = new Set<string>();

    let current = this.versions.get(versionId);
    if (!current) {
      throw new ScientificDatasetVersionError(
        'VERSION_NOT_FOUND',
        `DatasetVersion with ID "${versionId}" was not found.`
      );
    }

    let parentId = current.parent_version_id;
    while (parentId) {
      if (visited.has(parentId)) {
        break; // Cycle guard
      }
      visited.add(parentId);
      const parent = this.versions.get(parentId);
      if (!parent) {
        break;
      }
      ancestry.push(this.deepClone(parent));
      parentId = parent.parent_version_id;
    }

    return ancestry;
  }

  /**
   * Builds full hierarchical lineage tree of all versions belonging to a dataset.
   */
  public getLineageTree(datasetId: string): DatasetVersionLineageNode[] {
    const datasetVersions = this.listByDataset(datasetId);
    const versionMap = new Map<string, DatasetVersionLineageNode>();

    for (const v of datasetVersions) {
      versionMap.set(v.version_id, {
        version: v,
        children: []
      });
    }

    const roots: DatasetVersionLineageNode[] = [];

    for (const v of datasetVersions) {
      const node = versionMap.get(v.version_id)!;
      if (v.parent_version_id && versionMap.has(v.parent_version_id)) {
        const parentNode = versionMap.get(v.parent_version_id)!;
        parentNode.children.push(node);
      } else {
        roots.push(node);
      }
    }

    return roots;
  }

  /**
   * Verifies that the stored checksum matches on-the-fly recomputation.
   */
  public verifyChecksum(versionId: string): {
    matches: boolean;
    storedChecksum: string;
    computedChecksum: string;
  } {
    const version = this.versions.get(versionId);
    if (!version) {
      throw new ScientificDatasetVersionError(
        'VERSION_NOT_FOUND',
        `DatasetVersion with ID "${versionId}" was not found.`
      );
    }

    const computedChecksum = computeDatasetVersionChecksum(version);
    return {
      matches: version.checksum === computedChecksum,
      storedChecksum: version.checksum,
      computedChecksum
    };
  }

  /**
   * Clears the store (for test isolation).
   */
  public clear(): void {
    this.versions.clear();
  }

  private deepClone<T>(val: T): T {
    if (val === undefined || val === null) {
      return val;
    }
    return deepFreeze(JSON.parse(JSON.stringify(val)));
  }
}

// Global default instance linked to default dataset store
export const defaultDatasetVersionStore = new DatasetVersionStore(defaultDatasetStore);

export const DatasetVersionContractValidator = DatasetVersionValidator;
