/**
 * Phase D5 — Scientific Data Layer: Data-State Pipeline
 *
 * Implements explicit lifecycle state management:
 * RAW -> WORKING_COPY -> CLEANED -> VALIDATED -> ANALYSIS_READY
 *
 * Guarantees:
 * - RAW immutability (cannot be mutated or skipped)
 * - Immutable data artifacts with deterministic SHA-256 checksums
 * - Explicit recorded state transitions and provenance tracking
 * - Strict transition graph validation (prevents illegal state skipping)
 * - PipelineExecution tracking (PENDING, RUNNING, COMPLETED, FAILED)
 * - Tree lineage and branch support
 *
 * Explicitly decoupled from:
 * - Biological/clinical validation rules
 * - Data cleaning / outlier algorithms
 * - Automatic heuristic column guessing
 */

import { sha256Hex } from '../crypto';
import {
  DataArtifact,
  DataState,
  DataStateErrorCode,
  PipelineExecution,
  PipelineExecutionStatus,
  ScientificDataStateError,
  StateTransition
} from '../types';
import { canonicalizeJson } from '../provenance/provenancePersistence';
import { DatasetVersionStore, defaultDatasetVersionStore } from './datasetVersion';

export const VALID_DATA_STATES: ReadonlySet<DataState> = new Set<DataState>([
  'RAW',
  'WORKING_COPY',
  'CLEANED',
  'VALIDATED',
  'ANALYSIS_READY'
]);

export const VALID_PIPELINE_STATUSES: ReadonlySet<PipelineExecutionStatus> = new Set<PipelineExecutionStatus>([
  'PENDING',
  'RUNNING',
  'COMPLETED',
  'FAILED'
]);

/**
 * Explicit state transition rules.
 * State skipping (e.g. RAW -> CLEANED or RAW -> ANALYSIS_READY) is strictly forbidden.
 */
export const ALLOWED_STATE_TRANSITIONS: ReadonlyMap<DataState, ReadonlySet<DataState>> = new Map([
  ['RAW', new Set<DataState>(['WORKING_COPY'])],
  ['WORKING_COPY', new Set<DataState>(['WORKING_COPY', 'CLEANED'])],
  ['CLEANED', new Set<DataState>(['CLEANED', 'VALIDATED', 'WORKING_COPY'])],
  ['VALIDATED', new Set<DataState>(['VALIDATED', 'ANALYSIS_READY', 'WORKING_COPY', 'CLEANED'])],
  ['ANALYSIS_READY', new Set<DataState>(['WORKING_COPY', 'CLEANED'])]
]);

export interface DataStateValidationResult {
  isValid: boolean;
  errors: string[];
}

export function deepFreeze<T>(obj: T): T {
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
 * Computes deterministic SHA-256 integrity checksum for a DataArtifact.
 */
export function computeDataArtifactChecksum(
  artifact: Omit<DataArtifact, 'checksum'> | Partial<DataArtifact>
): string {
  const payload = {
    artifact_id: artifact.artifact_id,
    dataset_version_id: artifact.dataset_version_id,
    state: artifact.state,
    parent_artifact_id: artifact.parent_artifact_id || null,
    created_at: artifact.created_at,
    created_by: artifact.created_by,
    data_reference: artifact.data_reference || null,
    record_count: artifact.record_count ?? null,
    column_count: artifact.column_count ?? null,
    description: artifact.description || null,
    metadata: artifact.metadata || null
  };

  const canonical = canonicalizeJson(payload);
  return sha256Hex(canonical);
}

/**
 * Structural validator for DataArtifact entities.
 */
export class DataArtifactValidator {
  public static validate(data: unknown): DataStateValidationResult {
    const errors: string[] = [];

    if (!data || typeof data !== 'object') {
      return {
        isValid: false,
        errors: ['DataArtifact payload must be a non-null object.']
      };
    }

    const a = data as Partial<DataArtifact>;

    // 1. artifact_id
    if (!a.artifact_id || typeof a.artifact_id !== 'string' || a.artifact_id.trim() === '') {
      errors.push('artifact_id is required and must be a non-empty string identifier.');
    }

    // 2. dataset_version_id
    if (!a.dataset_version_id || typeof a.dataset_version_id !== 'string' || a.dataset_version_id.trim() === '') {
      errors.push('dataset_version_id is required and must be a non-empty string identifier.');
    }

    // 3. state
    if (!a.state || !VALID_DATA_STATES.has(a.state as DataState)) {
      errors.push(
        `state is required and must be one of: ${Array.from(VALID_DATA_STATES).join(', ')}.`
      );
    }

    // 4. parent_artifact_id rule
    // RAW artifacts must not have a parent_artifact_id
    if (a.state === 'RAW' && a.parent_artifact_id) {
      errors.push('RAW artifacts must have null or undefined parent_artifact_id as initial lineage root.');
    }

    // Non-RAW artifacts should have a parent_artifact_id
    if (a.state && a.state !== 'RAW' && (!a.parent_artifact_id || typeof a.parent_artifact_id !== 'string')) {
      errors.push(`Non-RAW artifact (state: ${a.state}) requires a valid parent_artifact_id string.`);
    }

    // 5. created_by
    if (!a.created_by || typeof a.created_by !== 'string' || a.created_by.trim() === '') {
      errors.push('created_by is required and must be a non-empty string identifier.');
    }

    // 6. created_at
    if (!a.created_at || typeof a.created_at !== 'string' || Number.isNaN(Date.parse(a.created_at))) {
      errors.push('created_at is required and must be a valid ISO 8601 timestamp string.');
    }

    // 7. checksum
    if (!a.checksum || typeof a.checksum !== 'string' || !/^[a-f0-9]{64}$/i.test(a.checksum)) {
      errors.push('checksum is required and must be a 64-character hexadecimal SHA-256 string.');
    }

    // 8. record_count (optional)
    if (
      a.record_count !== undefined &&
      (typeof a.record_count !== 'number' || !Number.isInteger(a.record_count) || a.record_count < 0)
    ) {
      errors.push('record_count, if provided, must be an integer >= 0.');
    }

    // 9. column_count (optional)
    if (
      a.column_count !== undefined &&
      (typeof a.column_count !== 'number' || !Number.isInteger(a.column_count) || a.column_count < 0)
    ) {
      errors.push('column_count, if provided, must be an integer >= 0.');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  public static assertValid(data: unknown): asserts data is DataArtifact {
    const result = DataArtifactValidator.validate(data);
    if (!result.isValid) {
      const firstErr = result.errors[0] || 'Invalid DataArtifact contract.';
      let code: DataStateErrorCode = 'DATA_STATE_INVALID_CONTRACT';

      if (firstErr.includes('artifact_id')) code = 'DATA_STATE_EMPTY_ID';
      else if (firstErr.includes('dataset_version_id')) code = 'DATA_STATE_EMPTY_DATASET_VERSION_ID';
      else if (firstErr.includes('state')) code = 'DATA_STATE_INVALID_STATE';

      throw new ScientificDataStateError(code, firstErr, { errors: result.errors });
    }
  }
}

/**
 * Structural validator for StateTransition records.
 */
export class StateTransitionValidator {
  public static validate(data: unknown): DataStateValidationResult {
    const errors: string[] = [];

    if (!data || typeof data !== 'object') {
      return {
        isValid: false,
        errors: ['StateTransition payload must be a non-null object.']
      };
    }

    const t = data as Partial<StateTransition>;

    if (!t.transition_id || typeof t.transition_id !== 'string' || t.transition_id.trim() === '') {
      errors.push('transition_id is required and must be a non-empty string identifier.');
    }

    if (!t.dataset_version_id || typeof t.dataset_version_id !== 'string' || t.dataset_version_id.trim() === '') {
      errors.push('dataset_version_id is required and must be a non-empty string identifier.');
    }

    if (!t.source_artifact_id || typeof t.source_artifact_id !== 'string' || t.source_artifact_id.trim() === '') {
      errors.push('source_artifact_id is required and must be a non-empty string identifier.');
    }

    if (!t.target_artifact_id || typeof t.target_artifact_id !== 'string' || t.target_artifact_id.trim() === '') {
      errors.push('target_artifact_id is required and must be a non-empty string identifier.');
    }

    if (!t.from_state || !VALID_DATA_STATES.has(t.from_state as DataState)) {
      errors.push(`from_state is required and must be a valid DataState.`);
    }

    if (!t.to_state || !VALID_DATA_STATES.has(t.to_state as DataState)) {
      errors.push(`to_state is required and must be a valid DataState.`);
    }

    if (!t.operation || typeof t.operation !== 'string' || t.operation.trim() === '') {
      errors.push('operation is required and must be a non-empty string describing the pipeline action.');
    }

    if (!t.created_by || typeof t.created_by !== 'string' || t.created_by.trim() === '') {
      errors.push('created_by is required and must be a non-empty string identifier.');
    }

    if (!t.created_at || typeof t.created_at !== 'string' || Number.isNaN(Date.parse(t.created_at))) {
      errors.push('created_at is required and must be a valid ISO 8601 timestamp string.');
    }

    // Verify transition legality according to ALLOWED_STATE_TRANSITIONS
    if (t.from_state && t.to_state) {
      const allowedNext = ALLOWED_STATE_TRANSITIONS.get(t.from_state);
      if (!allowedNext || !allowedNext.has(t.to_state)) {
        errors.push(
          `Illegal state transition from "${t.from_state}" to "${t.to_state}". Permitted transitions: ${Array.from(allowedNext || []).join(', ')}.`
        );
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  public static assertValid(data: unknown): asserts data is StateTransition {
    const result = StateTransitionValidator.validate(data);
    if (!result.isValid) {
      const firstErr = result.errors[0] || 'Invalid StateTransition contract.';
      let code: DataStateErrorCode = 'DATA_STATE_INVALID_CONTRACT';

      if (firstErr.includes('Illegal state transition')) {
        code = 'DATA_STATE_ILLEGAL_TRANSITION';
      }

      throw new ScientificDataStateError(code, firstErr, { errors: result.errors });
    }
  }
}

/**
 * Structural validator for PipelineExecution records.
 */
export class PipelineExecutionValidator {
  public static validate(data: unknown): DataStateValidationResult {
    const errors: string[] = [];

    if (!data || typeof data !== 'object') {
      return {
        isValid: false,
        errors: ['PipelineExecution payload must be a non-null object.']
      };
    }

    const e = data as Partial<PipelineExecution>;

    if (!e.execution_id || typeof e.execution_id !== 'string' || e.execution_id.trim() === '') {
      errors.push('execution_id is required and must be a non-empty string identifier.');
    }

    if (!e.dataset_version_id || typeof e.dataset_version_id !== 'string' || e.dataset_version_id.trim() === '') {
      errors.push('dataset_version_id is required and must be a non-empty string identifier.');
    }

    if (!e.source_artifact_id || typeof e.source_artifact_id !== 'string' || e.source_artifact_id.trim() === '') {
      errors.push('source_artifact_id is required and must be a non-empty string identifier.');
    }

    if (!e.operation || typeof e.operation !== 'string' || e.operation.trim() === '') {
      errors.push('operation is required and must be a non-empty string.');
    }

    if (!e.status || !VALID_PIPELINE_STATUSES.has(e.status as PipelineExecutionStatus)) {
      errors.push(`status is required and must be one of: ${Array.from(VALID_PIPELINE_STATUSES).join(', ')}.`);
    }

    if (!e.created_by || typeof e.created_by !== 'string' || e.created_by.trim() === '') {
      errors.push('created_by is required and must be a non-empty string identifier.');
    }

    if (!e.created_at || typeof e.created_at !== 'string' || Number.isNaN(Date.parse(e.created_at))) {
      errors.push('created_at is required and must be a valid ISO 8601 timestamp string.');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  public static assertValid(data: unknown): asserts data is PipelineExecution {
    const result = PipelineExecutionValidator.validate(data);
    if (!result.isValid) {
      throw new ScientificDataStateError('DATA_STATE_INVALID_CONTRACT', result.errors[0] || 'Invalid execution.');
    }
  }
}

export interface CreateDataArtifactParams {
  artifact_id: string;
  dataset_version_id: string;
  state: DataState;
  parent_artifact_id?: string | null;
  created_at?: string;
  created_by: string;
  checksum?: string;
  data_reference?: DataArtifact['data_reference'];
  record_count?: number;
  column_count?: number;
  description?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Factory function to construct and validate a DataArtifact.
 */
export function createDataArtifact(
  params: CreateDataArtifactParams,
  options?: { versionStore?: DatasetVersionStore; artifactStore?: DataArtifactStore }
): DataArtifact {
  // Validate dataset version existence if versionStore provided
  if (options?.versionStore) {
    const v = options.versionStore.get(params.dataset_version_id);
    if (!v) {
      throw new ScientificDataStateError(
        'DATA_STATE_DATASET_VERSION_NOT_FOUND',
        `DatasetVersion "${params.dataset_version_id}" not found in DatasetVersionStore.`
      );
    }
  }

  // Validate parent artifact if parent_artifact_id and artifactStore provided
  if (params.parent_artifact_id && options?.artifactStore) {
    const parent = options.artifactStore.get(params.parent_artifact_id);
    if (!parent) {
      throw new ScientificDataStateError(
        'DATA_STATE_PARENT_NOT_FOUND',
        `Parent artifact "${params.parent_artifact_id}" not found in DataArtifactStore.`
      );
    }
    if (parent.dataset_version_id !== params.dataset_version_id) {
      throw new ScientificDataStateError(
        'DATA_STATE_PARENT_MISMATCH',
        `Parent artifact "${params.parent_artifact_id}" belongs to dataset version "${parent.dataset_version_id}", expected "${params.dataset_version_id}".`
      );
    }
  }

  const now = new Date().toISOString();
  const raw: Omit<DataArtifact, 'checksum'> = {
    artifact_id: params.artifact_id,
    dataset_version_id: params.dataset_version_id,
    state: params.state,
    parent_artifact_id: params.parent_artifact_id || null,
    created_at: params.created_at || now,
    created_by: params.created_by,
    data_reference: params.data_reference,
    record_count: params.record_count,
    column_count: params.column_count,
    description: params.description,
    metadata: params.metadata
  };

  const computedChecksum = computeDataArtifactChecksum(raw);

  if (params.checksum && params.checksum !== computedChecksum) {
    throw new ScientificDataStateError(
      'DATA_STATE_INTEGRITY_MISMATCH',
      `Provided checksum "${params.checksum}" does not match computed checksum "${computedChecksum}".`
    );
  }

  const artifact: DataArtifact = {
    ...raw,
    checksum: params.checksum || computedChecksum
  };

  DataArtifactValidator.assertValid(artifact);
  return deepFreeze(JSON.parse(JSON.stringify(artifact)));
}

export interface DataArtifactFilter {
  dataset_version_id?: string;
  state?: DataState;
  parent_artifact_id?: string | null;
  created_by?: string;
}

export interface DataArtifactLineageNode {
  artifact: DataArtifact;
  children: DataArtifactLineageNode[];
}

/**
 * In-memory repository for DataArtifact entities.
 * Strictly guarantees RAW immutability, lineage tracking, and deterministic retrieval.
 */
export class DataArtifactStore {
  private artifacts: Map<string, DataArtifact> = new Map();
  private versionStore?: DatasetVersionStore;

  constructor(options?: { versionStore?: DatasetVersionStore }) {
    this.versionStore = options?.versionStore;
  }

  /**
   * Registers a new DataArtifact in the store.
   */
  public create(artifact: DataArtifact): DataArtifact {
    DataArtifactValidator.assertValid(artifact);

    if (this.artifacts.has(artifact.artifact_id)) {
      throw new ScientificDataStateError(
        'DATA_STATE_ARTIFACT_ALREADY_EXISTS',
        `DataArtifact with ID "${artifact.artifact_id}" already exists.`
      );
    }

    if (this.versionStore) {
      const v = this.versionStore.get(artifact.dataset_version_id);
      if (!v) {
        throw new ScientificDataStateError(
          'DATA_STATE_DATASET_VERSION_NOT_FOUND',
          `DatasetVersion "${artifact.dataset_version_id}" not found in DatasetVersionStore.`
        );
      }
    }

    // Parent verification & cycle check
    if (artifact.parent_artifact_id) {
      if (artifact.parent_artifact_id === artifact.artifact_id) {
        throw new ScientificDataStateError(
          'DATA_STATE_CYCLIC_LINEAGE',
          `DataArtifact "${artifact.artifact_id}" cannot be its own parent.`
        );
      }

      const parent = this.artifacts.get(artifact.parent_artifact_id);
      if (!parent) {
        throw new ScientificDataStateError(
          'DATA_STATE_PARENT_NOT_FOUND',
          `Parent artifact "${artifact.parent_artifact_id}" not found in store.`
        );
      }

      if (parent.dataset_version_id !== artifact.dataset_version_id) {
        throw new ScientificDataStateError(
          'DATA_STATE_PARENT_MISMATCH',
          `Parent artifact belongs to version "${parent.dataset_version_id}", expected "${artifact.dataset_version_id}".`
        );
      }

      // Cycle traversal guard
      let currParentId: string | null | undefined = parent.parent_artifact_id;
      const visited = new Set<string>([artifact.artifact_id, artifact.parent_artifact_id]);
      while (currParentId) {
        if (visited.has(currParentId)) {
          throw new ScientificDataStateError(
            'DATA_STATE_CYCLIC_LINEAGE',
            `Cycle detected in artifact lineage involving "${currParentId}".`
          );
        }
        visited.add(currParentId);
        const next = this.artifacts.get(currParentId);
        currParentId = next?.parent_artifact_id;
      }
    }

    const cloned = deepFreeze(this.deepClone(artifact));
    this.artifacts.set(artifact.artifact_id, cloned);
    return this.deepClone(cloned);
  }

  /**
   * Retrieves an artifact by its artifact_id.
   */
  public get(artifactId: string): DataArtifact | undefined {
    const a = this.artifacts.get(artifactId);
    if (!a) {
      return undefined;
    }
    return this.deepClone(a);
  }

  /**
   * Lists artifacts matching an optional filter, deterministically ordered by created_at ascending.
   */
  public list(filter?: DataArtifactFilter): DataArtifact[] {
    const list: DataArtifact[] = [];

    for (const a of this.artifacts.values()) {
      if (filter) {
        if (filter.dataset_version_id && a.dataset_version_id !== filter.dataset_version_id) continue;
        if (filter.state && a.state !== filter.state) continue;
        if (filter.created_by && a.created_by !== filter.created_by) continue;
        if (filter.parent_artifact_id !== undefined && a.parent_artifact_id !== filter.parent_artifact_id) continue;
      }
      list.push(this.deepClone(a));
    }

    return list.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.artifact_id.localeCompare(b.artifact_id));
  }

  /**
   * Finds all artifacts for a given dataset_version_id.
   */
  public findByDatasetVersion(datasetVersionId: string, filter?: { state?: DataState }): DataArtifact[] {
    return this.list({ dataset_version_id: datasetVersionId, state: filter?.state });
  }

  /**
   * Returns ordered ancestry chain from child to root [parent, grandparent, ..., RAW root].
   */
  public getAncestry(artifactId: string): DataArtifact[] {
    const ancestry: DataArtifact[] = [];
    const visited = new Set<string>();

    let current = this.artifacts.get(artifactId);
    if (!current) {
      throw new ScientificDataStateError(
        'DATA_STATE_ARTIFACT_NOT_FOUND',
        `DataArtifact with ID "${artifactId}" not found.`
      );
    }

    let parentId = current.parent_artifact_id;
    while (parentId) {
      if (visited.has(parentId)) break;
      visited.add(parentId);
      const parent = this.artifacts.get(parentId);
      if (!parent) break;
      ancestry.push(this.deepClone(parent));
      parentId = parent.parent_artifact_id;
    }

    return ancestry;
  }

  /**
   * Builds the hierarchical tree of artifacts for a dataset version.
   */
  public getLineageTree(datasetVersionId: string): DataArtifactLineageNode[] {
    const artifacts = this.findByDatasetVersion(datasetVersionId);
    const nodeMap = new Map<string, DataArtifactLineageNode>();

    for (const a of artifacts) {
      nodeMap.set(a.artifact_id, {
        artifact: a,
        children: []
      });
    }

    const roots: DataArtifactLineageNode[] = [];

    for (const a of artifacts) {
      const node = nodeMap.get(a.artifact_id)!;
      if (a.parent_artifact_id && nodeMap.has(a.parent_artifact_id)) {
        const parentNode = nodeMap.get(a.parent_artifact_id)!;
        parentNode.children.push(node);
      } else {
        roots.push(node);
      }
    }

    return roots;
  }

  /**
   * Verifies stored checksum against on-the-fly recomputation.
   */
  public verifyChecksum(artifactId: string): {
    matches: boolean;
    storedChecksum: string;
    computedChecksum: string;
  } {
    const artifact = this.artifacts.get(artifactId);
    if (!artifact) {
      throw new ScientificDataStateError(
        'DATA_STATE_ARTIFACT_NOT_FOUND',
        `DataArtifact "${artifactId}" not found.`
      );
    }

    const computedChecksum = computeDataArtifactChecksum(artifact);
    return {
      matches: artifact.checksum === computedChecksum,
      storedChecksum: artifact.checksum,
      computedChecksum
    };
  }

  /**
   * Clears the store (for test isolation).
   */
  public clear(): void {
    this.artifacts.clear();
  }

  private deepClone<T>(val: T): T {
    if (val === undefined || val === null) {
      return val;
    }
    return deepFreeze(JSON.parse(JSON.stringify(val)));
  }
}

export interface StateTransitionFilter {
  dataset_version_id?: string;
  source_artifact_id?: string;
  target_artifact_id?: string;
  from_state?: DataState;
  to_state?: DataState;
  operation?: string;
}

/**
 * In-memory repository for StateTransition records.
 */
export class StateTransitionStore {
  private transitions: Map<string, StateTransition> = new Map();

  public create(transition: StateTransition): StateTransition {
    StateTransitionValidator.assertValid(transition);

    if (this.transitions.has(transition.transition_id)) {
      throw new ScientificDataStateError(
        'DATA_STATE_INVALID_CONTRACT',
        `StateTransition with ID "${transition.transition_id}" already exists.`
      );
    }

    const cloned = deepFreeze(this.deepClone(transition));
    this.transitions.set(transition.transition_id, cloned);
    return this.deepClone(cloned);
  }

  public get(transitionId: string): StateTransition | undefined {
    const t = this.transitions.get(transitionId);
    if (!t) return undefined;
    return this.deepClone(t);
  }

  public list(filter?: StateTransitionFilter): StateTransition[] {
    const results: StateTransition[] = [];
    for (const t of this.transitions.values()) {
      if (filter) {
        if (filter.dataset_version_id && t.dataset_version_id !== filter.dataset_version_id) continue;
        if (filter.source_artifact_id && t.source_artifact_id !== filter.source_artifact_id) continue;
        if (filter.target_artifact_id && t.target_artifact_id !== filter.target_artifact_id) continue;
        if (filter.from_state && t.from_state !== filter.from_state) continue;
        if (filter.to_state && t.to_state !== filter.to_state) continue;
        if (filter.operation && t.operation !== filter.operation) continue;
      }
      results.push(this.deepClone(t));
    }
    return results.sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  public findByDatasetVersion(datasetVersionId: string): StateTransition[] {
    return this.list({ dataset_version_id: datasetVersionId });
  }

  public findByArtifact(artifactId: string): StateTransition[] {
    return this.list().filter(
      (t) => t.source_artifact_id === artifactId || t.target_artifact_id === artifactId
    );
  }

  public clear(): void {
    this.transitions.clear();
  }

  private deepClone<T>(val: T): T {
    if (val === undefined || val === null) return val;
    return deepFreeze(JSON.parse(JSON.stringify(val)));
  }
}

export interface PipelineExecutionFilter {
  dataset_version_id?: string;
  source_artifact_id?: string;
  status?: PipelineExecutionStatus;
  operation?: string;
}

/**
 * In-memory repository for PipelineExecution tracking.
 */
export class PipelineExecutionStore {
  private executions: Map<string, PipelineExecution> = new Map();

  public create(execution: PipelineExecution): PipelineExecution {
    PipelineExecutionValidator.assertValid(execution);

    if (this.executions.has(execution.execution_id)) {
      throw new ScientificDataStateError(
        'DATA_STATE_EXECUTION_ALREADY_EXISTS',
        `PipelineExecution with ID "${execution.execution_id}" already exists.`
      );
    }

    const cloned = deepFreeze(this.deepClone(execution));
    this.executions.set(execution.execution_id, cloned);
    return this.deepClone(cloned);
  }

  public get(executionId: string): PipelineExecution | undefined {
    const e = this.executions.get(executionId);
    if (!e) return undefined;
    return this.deepClone(e);
  }

  public updateStatus(
    executionId: string,
    status: PipelineExecutionStatus,
    options?: {
      target_artifact_id?: string;
      completed_at?: string;
      error?: string;
      warnings?: string[];
      metadata?: Record<string, unknown>;
    }
  ): PipelineExecution {
    const existing = this.executions.get(executionId);
    if (!existing) {
      throw new ScientificDataStateError(
        'DATA_STATE_EXECUTION_NOT_FOUND',
        `PipelineExecution "${executionId}" not found.`
      );
    }

    if (!VALID_PIPELINE_STATUSES.has(status)) {
      throw new ScientificDataStateError(
        'DATA_STATE_INVALID_CONTRACT',
        `Invalid execution status "${status}".`
      );
    }

    const updated: PipelineExecution = {
      ...existing,
      status,
      target_artifact_id: options?.target_artifact_id !== undefined ? options.target_artifact_id : existing.target_artifact_id,
      completed_at: options?.completed_at || (status === 'COMPLETED' || status === 'FAILED' ? new Date().toISOString() : existing.completed_at),
      error: options?.error !== undefined ? options.error : existing.error,
      warnings: options?.warnings !== undefined ? options.warnings : existing.warnings,
      metadata: options?.metadata !== undefined ? options.metadata : existing.metadata
    };

    PipelineExecutionValidator.assertValid(updated);
    const cloned = deepFreeze(this.deepClone(updated));
    this.executions.set(executionId, cloned);
    return this.deepClone(cloned);
  }

  public list(filter?: PipelineExecutionFilter): PipelineExecution[] {
    const results: PipelineExecution[] = [];
    for (const e of this.executions.values()) {
      if (filter) {
        if (filter.dataset_version_id && e.dataset_version_id !== filter.dataset_version_id) continue;
        if (filter.source_artifact_id && e.source_artifact_id !== filter.source_artifact_id) continue;
        if (filter.status && e.status !== filter.status) continue;
        if (filter.operation && e.operation !== filter.operation) continue;
      }
      results.push(this.deepClone(e));
    }
    return results.sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  public findByDatasetVersion(datasetVersionId: string): PipelineExecution[] {
    return this.list({ dataset_version_id: datasetVersionId });
  }

  public clear(): void {
    this.executions.clear();
  }

  private deepClone<T>(val: T): T {
    if (val === undefined || val === null) return val;
    return deepFreeze(JSON.parse(JSON.stringify(val)));
  }
}

/**
 * High-level pipeline coordinator tying together DataArtifacts, StateTransitions, and PipelineExecutions.
 */
export class DataStatePipeline {
  readonly artifactStore: DataArtifactStore;
  readonly transitionStore: StateTransitionStore;
  readonly executionStore: PipelineExecutionStore;
  readonly versionStore?: DatasetVersionStore;

  constructor(options?: {
    artifactStore?: DataArtifactStore;
    transitionStore?: StateTransitionStore;
    executionStore?: PipelineExecutionStore;
    versionStore?: DatasetVersionStore;
  }) {
    this.versionStore = options?.versionStore || defaultDatasetVersionStore;
    this.artifactStore = options?.artifactStore || new DataArtifactStore({ versionStore: this.versionStore });
    this.transitionStore = options?.transitionStore || new StateTransitionStore();
    this.executionStore = options?.executionStore || new PipelineExecutionStore();
  }

  /**
   * Initializes the root RAW artifact for a dataset version.
   */
  public initializeRawArtifact(params: {
    artifact_id: string;
    dataset_version_id: string;
    created_by: string;
    data_reference?: DataArtifact['data_reference'];
    record_count?: number;
    column_count?: number;
    description?: string;
    metadata?: Record<string, unknown>;
  }): DataArtifact {
    const artifact = createDataArtifact(
      {
        ...params,
        state: 'RAW',
        parent_artifact_id: null
      },
      { versionStore: this.versionStore }
    );

    return this.artifactStore.create(artifact);
  }

  /**
   * Executes and records an explicit state transition from a source artifact to a target artifact.
   */
  public executeTransition(params: {
    transition_id: string;
    execution_id: string;
    dataset_version_id: string;
    source_artifact_id: string;
    target_artifact_id: string;
    to_state: DataState;
    operation: string;
    created_by: string;
    parameters?: Record<string, unknown>;
    reason?: string;
    target_record_count?: number;
    target_column_count?: number;
    target_data_reference?: DataArtifact['data_reference'];
    target_description?: string;
    target_metadata?: Record<string, unknown>;
  }): {
    transition: StateTransition;
    execution: PipelineExecution;
    targetArtifact: DataArtifact;
  } {
    const sourceArtifact = this.artifactStore.get(params.source_artifact_id);
    if (!sourceArtifact) {
      throw new ScientificDataStateError(
        'DATA_STATE_ARTIFACT_NOT_FOUND',
        `Source artifact "${params.source_artifact_id}" not found in DataArtifactStore.`
      );
    }

    if (sourceArtifact.dataset_version_id !== params.dataset_version_id) {
      throw new ScientificDataStateError(
        'DATA_STATE_PARENT_MISMATCH',
        `Source artifact belongs to dataset version "${sourceArtifact.dataset_version_id}", expected "${params.dataset_version_id}".`
      );
    }

    // 1. Record execution as RUNNING
    const execution = this.executionStore.create({
      execution_id: params.execution_id,
      dataset_version_id: params.dataset_version_id,
      source_artifact_id: params.source_artifact_id,
      operation: params.operation,
      configuration: params.parameters,
      status: 'RUNNING',
      created_by: params.created_by,
      created_at: new Date().toISOString()
    });

    try {
      // 2. Create Target Artifact
      const targetArtifact = createDataArtifact(
        {
          artifact_id: params.target_artifact_id,
          dataset_version_id: params.dataset_version_id,
          state: params.to_state,
          parent_artifact_id: params.source_artifact_id,
          created_by: params.created_by,
          record_count: params.target_record_count ?? sourceArtifact.record_count,
          column_count: params.target_column_count ?? sourceArtifact.column_count,
          data_reference: params.target_data_reference ?? sourceArtifact.data_reference,
          description: params.target_description,
          metadata: params.target_metadata
        },
        { versionStore: this.versionStore, artifactStore: this.artifactStore }
      );

      const savedTarget = this.artifactStore.create(targetArtifact);

      // 3. Record StateTransition
      const transition = this.transitionStore.create({
        transition_id: params.transition_id,
        dataset_version_id: params.dataset_version_id,
        source_artifact_id: params.source_artifact_id,
        target_artifact_id: params.target_artifact_id,
        from_state: sourceArtifact.state,
        to_state: params.to_state,
        operation: params.operation,
        created_by: params.created_by,
        created_at: new Date().toISOString(),
        parameters: params.parameters,
        reason: params.reason
      });

      // 4. Update Execution to COMPLETED
      const completedExecution = this.executionStore.updateStatus(execution.execution_id, 'COMPLETED', {
        target_artifact_id: savedTarget.artifact_id,
        completed_at: new Date().toISOString()
      });

      return {
        transition,
        execution: completedExecution,
        targetArtifact: savedTarget
      };
    } catch (err: any) {
      this.executionStore.updateStatus(execution.execution_id, 'FAILED', {
        error: err.message || 'State transition failed.',
        completed_at: new Date().toISOString()
      });
      throw err;
    }
  }

  /**
   * Resets all stores (for test isolation).
   */
  public clear(): void {
    this.artifactStore.clear();
    this.transitionStore.clear();
    this.executionStore.clear();
  }
}

// Global default instances
export const defaultDataArtifactStore = new DataArtifactStore({ versionStore: defaultDatasetVersionStore });
export const defaultStateTransitionStore = new StateTransitionStore();
export const defaultPipelineExecutionStore = new PipelineExecutionStore();
export const defaultDataStatePipeline = new DataStatePipeline({
  artifactStore: defaultDataArtifactStore,
  transitionStore: defaultStateTransitionStore,
  executionStore: defaultPipelineExecutionStore,
  versionStore: defaultDatasetVersionStore
});
