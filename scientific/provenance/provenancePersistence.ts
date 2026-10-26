/**
 * Phase C8 — Provenance Persistence Layer
 *
 * Implements deterministic provenance record creation, canonicalization,
 * cryptographic content integrity hashing (SHA-256), immutable persistence,
 * and tamper-detection verification.
 */

import * as crypto from 'crypto';
import {
  ExecutionResult,
  ProvenanceAuditEvent,
  ProvenanceIntegrity,
  ProvenanceRecord,
  ProvenanceVerificationResult,
  ScientificProvenanceError
} from '../types';

/**
 * Deterministic Canonical JSON serialization.
 * Ensures consistent key ordering across nested objects and deterministic array representation.
 */
export function canonicalizeJson(obj: unknown): string {
  if (obj === null || obj === undefined) {
    return 'null';
  }

  if (typeof obj === 'number') {
    if (!Number.isFinite(obj)) {
      return 'null';
    }
    // Normalize -0 to 0
    return Object.is(obj, -0) ? '0' : obj.toString();
  }

  if (typeof obj === 'boolean' || typeof obj === 'string') {
    return JSON.stringify(obj);
  }

  if (obj instanceof Date) {
    return JSON.stringify(obj.toISOString());
  }

  if (Array.isArray(obj)) {
    const items = obj.map((item) => canonicalizeJson(item));
    return `[${items.join(',')}]`;
  }

  if (typeof obj === 'object') {
    const keys = Object.keys(obj as Record<string, unknown>).sort();
    const entries: string[] = [];

    for (const key of keys) {
      const val = (obj as Record<string, unknown>)[key];
      // Exclude undefined object properties in standard canonical JSON fashion
      if (val !== undefined) {
        entries.push(`${JSON.stringify(key)}:${canonicalizeJson(val)}`);
      }
    }

    return `{${entries.join(',')}}`;
  }

  return 'null';
}

/**
 * Extracts the deterministic integrity payload from a ProvenanceRecord or ExecutionResult.
 * This payload explicitly encapsulates all scientific execution parameters, traces, inputs,
 * outputs, and validation outcomes while omitting storage timestamps or self-referential hash fields.
 */
export function extractIntegrityPayload(record: Partial<ProvenanceRecord>): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    module_id: record.module_id,
    module_version: record.module_version,
    execution_id: record.execution_id,
    inputs: record.inputs || {},
    normalized_inputs: record.normalized_inputs || {},
    execution_path: record.execution_path || [],
    trace: record.trace || [],
    outputs: record.outputs || {},
    execution_timestamp: record.execution_timestamp
  };

  if (record.batch_id !== undefined && record.batch_id !== null) {
    payload.batch_id = record.batch_id;
  }
  if (record.dataset_version_id !== undefined && record.dataset_version_id !== null) {
    payload.dataset_version_id = record.dataset_version_id;
  }
  if (record.parameter_set_id !== undefined && record.parameter_set_id !== null) {
    payload.parameter_set_id = record.parameter_set_id;
  }
  if (record.parameter_versions !== undefined && record.parameter_versions !== null) {
    payload.parameter_versions = record.parameter_versions;
  }
  if (record.parameter_snapshot !== undefined && record.parameter_snapshot !== null) {
    payload.parameter_snapshot = record.parameter_snapshot;
  }
  if (record.intermediate_results !== undefined && record.intermediate_results !== null) {
    payload.intermediate_results = record.intermediate_results;
  }
  if (record.validation !== undefined && record.validation !== null) {
    payload.validation = record.validation;
  }
  if (record.state_history !== undefined && record.state_history !== null) {
    payload.state_history = record.state_history;
  }

  return payload;
}

/**
 * Computes the SHA-256 cryptographic hash of a canonicalized payload.
 */
export function computeProvenanceHash(payload: unknown): string {
  const canonical = canonicalizeJson(payload);
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export interface BuildProvenanceOptions {
  batch_id?: string;
  dataset_version_id?: string;
  metadata?: Record<string, unknown>;
  created_at?: string;
}

/**
 * Builds a sealed, typed ProvenanceRecord from an ExecutionResult.
 * Automatically updates `executionResult.provenance_id` with the generated provenance identifier.
 */
export function buildProvenanceRecord(
  executionResult: ExecutionResult,
  options?: BuildProvenanceOptions
): ProvenanceRecord {
  if (!executionResult || !executionResult.execution_id) {
    throw new ScientificProvenanceError(
      'PROVENANCE_INVALID_PAYLOAD',
      'ExecutionResult must contain a valid execution_id.'
    );
  }

  const executionTimestamp = executionResult.timestamp || new Date().toISOString();
  const createdAt = options?.created_at || new Date().toISOString();

  // Extract raw unsealed payload
  const draftRecord: Partial<ProvenanceRecord> = {
    execution_id: executionResult.execution_id,
    batch_id: options?.batch_id,
    module_id: executionResult.module_id,
    module_version: executionResult.module_version,
    parameter_set_id: executionResult.parameter_set_id,
    parameter_versions: executionResult.parameter_versions,
    parameter_snapshot: executionResult.parameter_snapshot,
    dataset_version_id: options?.dataset_version_id,
    inputs: executionResult.inputs,
    normalized_inputs: executionResult.normalized_inputs,
    execution_path: executionResult.execution_path,
    intermediate_results: executionResult.intermediate_results,
    trace: executionResult.trace,
    outputs: executionResult.outputs,
    validation: executionResult.validation,
    state_history: executionResult.state_history,
    execution_timestamp: executionTimestamp
  };

  const integrityPayload = extractIntegrityPayload(draftRecord);
  const contentHash = computeProvenanceHash(integrityPayload);
  const provenanceId = `prov_${contentHash}`;

  const integrity: ProvenanceIntegrity = {
    algorithm: 'SHA-256',
    content_hash: contentHash
  };

  const provenanceRecord: ProvenanceRecord = {
    provenance_id: provenanceId,
    execution_id: executionResult.execution_id,
    batch_id: options?.batch_id,
    module_id: executionResult.module_id,
    module_version: executionResult.module_version,
    parameter_set_id: executionResult.parameter_set_id,
    parameter_versions: executionResult.parameter_versions,
    parameter_snapshot: executionResult.parameter_snapshot,
    dataset_version_id: options?.dataset_version_id,
    inputs: executionResult.inputs,
    normalized_inputs: executionResult.normalized_inputs,
    execution_path: executionResult.execution_path,
    intermediate_results: executionResult.intermediate_results,
    trace: executionResult.trace,
    outputs: executionResult.outputs,
    validation: executionResult.validation,
    state_history: executionResult.state_history,
    execution_timestamp: executionTimestamp,
    created_at: createdAt,
    integrity,
    metadata: options?.metadata
  };

  // Seal the execution result with the provenance identity
  executionResult.provenance_id = provenanceId;

  return Object.freeze(provenanceRecord);
}

/**
 * Provenance Persistence Store.
 * In-memory repository with immutable guarantees, deep cloning, and audit logging.
 */
export class ProvenanceStore {
  private records: Map<string, ProvenanceRecord> = new Map();
  private executionIndex: Map<string, string> = new Map();
  private batchIndex: Map<string, Set<string>> = new Map();
  private auditLogs: ProvenanceAuditEvent[] = [];

  /**
   * Saves a ProvenanceRecord to the persistence store.
   * Enforces immutability: deep-clones record before saving.
   */
  public save(record: ProvenanceRecord): ProvenanceRecord {
    if (!record || !record.provenance_id) {
      throw new ScientificProvenanceError(
        'PROVENANCE_INVALID_PAYLOAD',
        'ProvenanceRecord must contain a valid provenance_id.'
      );
    }

    if (this.records.has(record.provenance_id)) {
      const existing = this.records.get(record.provenance_id)!;
      // If content hash matches, idempotent save is accepted
      if (existing.integrity.content_hash === record.integrity.content_hash) {
        return this.deepClone(existing);
      }
      throw new ScientificProvenanceError(
        'PROVENANCE_ALREADY_EXISTS',
        `A provenance record with ID ${record.provenance_id} already exists with different content.`
      );
    }

    const clonedRecord = Object.freeze(this.deepClone(record));
    this.records.set(record.provenance_id, clonedRecord);
    this.executionIndex.set(record.execution_id, record.provenance_id);

    if (record.batch_id) {
      if (!this.batchIndex.has(record.batch_id)) {
        this.batchIndex.set(record.batch_id, new Set());
      }
      this.batchIndex.get(record.batch_id)!.add(record.provenance_id);
    }

    this.recordAudit({
      event_id: `aud_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      event_type: 'PROVENANCE_CREATED',
      provenance_id: record.provenance_id,
      execution_id: record.execution_id,
      batch_id: record.batch_id,
      timestamp: new Date().toISOString()
    });

    return this.deepClone(clonedRecord);
  }

  /**
   * Retrieves a ProvenanceRecord by its provenance_id.
   * Returns a deep clone so external callers cannot mutate stored records.
   */
  public get(provenanceId: string): ProvenanceRecord | undefined {
    const record = this.records.get(provenanceId);
    if (!record) {
      return undefined;
    }

    this.recordAudit({
      event_id: `aud_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      event_type: 'PROVENANCE_RETRIEVED',
      provenance_id: provenanceId,
      execution_id: record.execution_id,
      batch_id: record.batch_id,
      timestamp: new Date().toISOString()
    });

    return this.deepClone(record);
  }

  /**
   * Retrieves a ProvenanceRecord by its execution_id.
   */
  public getByExecutionId(executionId: string): ProvenanceRecord | undefined {
    const provenanceId = this.executionIndex.get(executionId);
    if (!provenanceId) {
      return undefined;
    }
    return this.get(provenanceId);
  }

  /**
   * Lists all ProvenanceRecords associated with a given batch_id.
   */
  public listByBatchId(batchId: string): ProvenanceRecord[] {
    const provenanceIds = this.batchIndex.get(batchId);
    if (!provenanceIds) {
      return [];
    }

    const results: ProvenanceRecord[] = [];
    for (const pid of provenanceIds) {
      const record = this.get(pid);
      if (record) {
        results.push(record);
      }
    }
    return results;
  }

  /**
   * Verifies the cryptographic integrity of a stored provenance record.
   * Compares the stored hash with the recomputed hash over the canonical integrity payload.
   */
  public verifyIntegrity(provenanceId: string): ProvenanceVerificationResult {
    const record = this.records.get(provenanceId);
    const verifiedAt = new Date().toISOString();

    if (!record) {
      return {
        provenance_id: provenanceId,
        status: 'NOT_FOUND',
        message: `Provenance record ${provenanceId} not found in store.`,
        verified_at: verifiedAt
      };
    }

    const payload = extractIntegrityPayload(record);
    const computedHash = computeProvenanceHash(payload);
    const storedHash = record.integrity.content_hash;

    const isValid = computedHash === storedHash;

    this.recordAudit({
      event_id: `aud_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      event_type: 'PROVENANCE_INTEGRITY_VERIFIED',
      provenance_id: provenanceId,
      execution_id: record.execution_id,
      batch_id: record.batch_id,
      details: {
        is_valid: isValid,
        computed_hash: computedHash,
        stored_hash: storedHash
      },
      timestamp: verifiedAt
    });

    if (isValid) {
      return {
        provenance_id: provenanceId,
        status: 'VALID',
        computed_hash: computedHash,
        stored_hash: storedHash,
        message: 'Provenance cryptographic integrity confirmed (SHA-256 match).',
        verified_at: verifiedAt
      };
    }

    return {
      provenance_id: provenanceId,
      status: 'INVALID',
      computed_hash: computedHash,
      stored_hash: storedHash,
      message: 'Provenance content integrity violation: computed hash does not match stored content hash.',
      verified_at: verifiedAt
    };
  }

  /**
   * Retrieves recorded audit events.
   */
  public getAuditLogs(): ProvenanceAuditEvent[] {
    return this.deepClone(this.auditLogs);
  }

  /**
   * Clears the store and reset indexes (useful for test isolation).
   */
  public clear(): void {
    this.records.clear();
    this.executionIndex.clear();
    this.batchIndex.clear();
    this.auditLogs = [];
  }

  private recordAudit(event: ProvenanceAuditEvent): void {
    this.auditLogs.push(Object.freeze(event));
  }

  private deepClone<T>(val: T): T {
    if (val === undefined || val === null) {
      return val;
    }
    return JSON.parse(JSON.stringify(val));
  }
}

// Global default singleton instance for app-wide persistence
export const defaultProvenanceStore = new ProvenanceStore();
