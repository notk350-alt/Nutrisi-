/**
 * NutriBodySim — Phase F2.2C.1: Execution Authorization Gate
 *
 * Strict authorization boundary between ExecutionPreview and future execution phases.
 *
 * Invariants:
 * 1. Zero statistical calculations, zero engine execution (D9–D13 untouched).
 * 2. Previewing does NOT authorize automatically (PREVIEW ≠ AUTHORIZATION).
 * 3. READY status in preview is a prerequisite, but authorization is explicit.
 * 4. Stale-preview protection: snapshot is strictly re-verified against current system state.
 * 5. Deeply immutable snapshot (deepFreeze).
 * 6. Deterministic SHA-256 authorization provenance hash.
 * 7. scientific_validity = 'NOT_ESTABLISHED' strictly preserved.
 */

import * as crypto from 'crypto';
import { canonicalizeJson } from '../provenance/provenancePersistence';
import { deepFreeze } from './dataStatePipeline';
import { ResearchProject, PlannedAnalysis } from './researchProjectContracts';
import { ExecutionPreview } from './executionPreviewContracts';
import { ExecutionPreviewValidator } from './executionPreviewValidator';
import { DatasetVersionStore, defaultDatasetVersionStore } from './datasetVersion';
import { DataArtifactStore, defaultDataArtifactStore } from './dataStatePipeline';
import { VariableStore, defaultVariableStore } from './variableRegistry';
import { VariableMappingStore, defaultVariableMappingStore } from './variableMapping';
import { ANALYSIS_MODULE_REGISTRY } from './analysisExecutionContracts';
import { ResearchProjectRegistry, defaultResearchProjectRegistry } from './researchProjectRegistry';

export type ExecutionAuthorizationStatus = 'AUTHORIZED' | 'REVOKED';

export type ExecutionAuthorizationErrorCode =
  | 'PREVIEW_NOT_FOUND'
  | 'PREVIEW_BLOCKED'
  | 'PREVIEW_STALE'
  | 'PREVIEW_CHECKSUM_MISMATCH'
  | 'PREVIEW_DATASET_MISMATCH'
  | 'PREVIEW_ARTIFACT_MISMATCH'
  | 'PREVIEW_ANALYSIS_VERSION_MISMATCH'
  | 'PREVIEW_MODULE_VERSION_MISMATCH'
  | 'PROJECT_NOT_EXECUTABLE'
  | 'PROJECT_FINALIZED'
  | 'PROJECT_ARCHIVED'
  | 'ANALYSIS_NOT_PLANNED'
  | 'AUTHORIZATION_UNAUTHORIZED_CALLER'
  | 'AUTHORIZATION_INVALID'
  | 'AUTHORIZATION_NOT_FOUND';

export class ScientificAuthorizationGateError extends Error {
  public readonly code: ExecutionAuthorizationErrorCode;
  public readonly details?: unknown;

  constructor(code: ExecutionAuthorizationErrorCode, message: string, details?: unknown) {
    super(`[${code}] ${message}`);
    this.name = 'ScientificAuthorizationGateError';
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, ScientificAuthorizationGateError.prototype);
  }
}

/**
 * Immutable ExecutionAuthorization Contract (Phase F2.2C.1)
 */
export interface ExecutionAuthorization {
  readonly authorization_id: string;
  readonly preview_id: string;
  readonly execution_request_id?: string;
  readonly project_id: string;
  readonly project_version: string;
  readonly analysis_id: string;
  readonly analysis_plan_version: string;
  readonly authorized_by: string;
  readonly authorized_at: string;
  readonly preview_provenance_hash: string;
  readonly authorization_hash: string;
  readonly status: ExecutionAuthorizationStatus;
  readonly scientific_validity: 'NOT_ESTABLISHED';
}

/**
 * Provenance payload for deterministic authorization hashing.
 */
export interface AuthorizationProvenancePayload {
  preview_id: string;
  execution_request_id?: string;
  project_id: string;
  project_version: string;
  analysis_id: string;
  analysis_plan_version: string;
  preview_provenance_hash: string;
  authorized_by: string;
  status: ExecutionAuthorizationStatus;
  scientific_validity: 'NOT_ESTABLISHED';
}

/**
 * Computes deterministic SHA-256 provenance hash for an ExecutionAuthorization payload.
 */
export function computeAuthorizationHash(payload: AuthorizationProvenancePayload): string {
  const normalized = {
    preview_id: payload.preview_id || '',
    execution_request_id: payload.execution_request_id || null,
    project_id: payload.project_id || '',
    project_version: payload.project_version || '',
    analysis_id: payload.analysis_id || '',
    analysis_plan_version: payload.analysis_plan_version || '1.0.0',
    preview_provenance_hash: payload.preview_provenance_hash || '',
    authorized_by: (payload.authorized_by || '').trim(),
    status: payload.status,
    scientific_validity: 'NOT_ESTABLISHED' as const
  };

  const canonicalString = canonicalizeJson(normalized);
  return crypto.createHash('sha256').update(canonicalString, 'utf8').digest('hex');
}

export interface CreateAuthorizationOptions {
  preview?: ExecutionPreview;
  authorized_by?: string;
  project?: ResearchProject;
  project_registry?: ResearchProjectRegistry;
  dataset_version_store?: DatasetVersionStore;
  data_artifact_store?: DataArtifactStore;
  variable_store?: VariableStore;
  variable_mapping_store?: VariableMappingStore;
}

export interface ValidateAuthorizationResult {
  isValid: boolean;
  errors: string[];
}

/**
 * Authorization Validator & Gatekeeper Engine.
 */
export class ExecutionAuthorizationGate {
  /**
   * Authorizes an execution preview after rigorous re-check against current system state.
   * Throws ScientificAuthorizationGateError if any authorization rule fails.
   */
  public static createAuthorization(options: CreateAuthorizationOptions): ExecutionAuthorization {
    const { preview, authorized_by } = options;

    // 1. Preview existence
    if (!preview || typeof preview !== 'object') {
      throw new ScientificAuthorizationGateError(
        'PREVIEW_NOT_FOUND',
        'ExecutionPreview is required to create an execution authorization.'
      );
    }

    // 2. Preview status must be READY
    if (preview.readiness_status !== 'READY') {
      throw new ScientificAuthorizationGateError(
        'PREVIEW_BLOCKED',
        `Cannot authorize a BLOCKED preview. Preview has ${preview.errors?.length || 0} error(s).`,
        { errors: preview.errors }
      );
    }

    // 3. No blocking errors
    if (preview.errors && preview.errors.length > 0) {
      throw new ScientificAuthorizationGateError(
        'PREVIEW_BLOCKED',
        'Cannot authorize a preview with recorded preflight errors.',
        { errors: preview.errors }
      );
    }

    // 4. Preview provenance hash required
    if (!preview.provenance_hash || typeof preview.provenance_hash !== 'string' || !preview.provenance_hash.trim()) {
      throw new ScientificAuthorizationGateError(
        'PREVIEW_BLOCKED',
        'ExecutionPreview missing cryptographic provenance digest.'
      );
    }

    // 5. Scientific validity check
    if (preview.scientific_validity !== 'NOT_ESTABLISHED') {
      throw new ScientificAuthorizationGateError(
        'AUTHORIZATION_INVALID',
        `Scientific validity must strictly be 'NOT_ESTABLISHED', received '${preview.scientific_validity}'.`
      );
    }

    // 6. Authorized By required
    if (!authorized_by || typeof authorized_by !== 'string' || !authorized_by.trim()) {
      throw new ScientificAuthorizationGateError(
        'AUTHORIZATION_UNAUTHORIZED_CALLER',
        'Authorized by (authorizing researcher identity) is required and cannot be blank.'
      );
    }

    // 7. Resolve current project state
    const registry = options.project_registry || defaultResearchProjectRegistry;
    const currentProject = options.project || registry.getProject(preview.project_id);

    if (!currentProject) {
      throw new ScientificAuthorizationGateError(
        'PROJECT_NOT_EXECUTABLE',
        `Referenced research project '${preview.project_id}' not found in registry.`
      );
    }

    // 8. Lifecycle check: FINALIZED or ARCHIVED
    if (currentProject.status === 'FINALIZED') {
      throw new ScientificAuthorizationGateError(
        'PROJECT_FINALIZED',
        `Cannot authorize execution: Project '${currentProject.project_id}' is FINALIZED.`
      );
    }

    if (currentProject.status === 'ARCHIVED') {
      throw new ScientificAuthorizationGateError(
        'PROJECT_ARCHIVED',
        `Cannot authorize execution: Project '${currentProject.project_id}' is ARCHIVED.`
      );
    }

    // 9. Project version match
    if (currentProject.project_version !== preview.project_version) {
      throw new ScientificAuthorizationGateError(
        'PREVIEW_STALE',
        `Project version drift: Current project version '${currentProject.project_version}' does not match preview version '${preview.project_version}'.`
      );
    }

    // 10. Analysis plan in current project
    const currentPlan = currentProject.analysis_plan?.find((a) => a.analysis_id === preview.analysis_id);
    if (!currentPlan) {
      throw new ScientificAuthorizationGateError(
        'ANALYSIS_NOT_PLANNED',
        `Planned analysis '${preview.analysis_id}' no longer exists in project.`
      );
    }

    // 11. Analysis plan status must still be PLANNED
    if (currentPlan.status !== 'PLANNED') {
      throw new ScientificAuthorizationGateError(
        'ANALYSIS_NOT_PLANNED',
        `Planned analysis '${currentPlan.analysis_id}' status is '${currentPlan.status}', expected 'PLANNED'.`
      );
    }

    // 12. Analysis plan version match
    if (preview.analysis_plan_version && preview.analysis_plan_version !== '1.0.0') {
      throw new ScientificAuthorizationGateError(
        'PREVIEW_ANALYSIS_VERSION_MISMATCH',
        `Analysis plan version '${preview.analysis_plan_version}' does not match available version '1.0.0'.`
      );
    }

    // 13. Dataset binding match
    const currentBinding = currentProject.dataset_binding;
    if (!currentBinding || currentBinding.dataset_version_id !== preview.dataset_version_id) {
      throw new ScientificAuthorizationGateError(
        'PREVIEW_DATASET_MISMATCH',
        `Dataset version mismatch: Current project bound to '${currentBinding?.dataset_version_id || 'NONE'}', preview expects '${preview.dataset_version_id}'.`
      );
    }

    if (currentBinding.data_artifact_id !== preview.data_artifact_id) {
      throw new ScientificAuthorizationGateError(
        'PREVIEW_ARTIFACT_MISMATCH',
        `Data artifact mismatch: Current project bound to '${currentBinding.data_artifact_id}', preview expects '${preview.data_artifact_id}'.`
      );
    }

    // 14. Checksum match
    const artifactStore = options.data_artifact_store || defaultDataArtifactStore;
    const currentArtifact = artifactStore.get(currentBinding.data_artifact_id);
    if (!currentArtifact) {
      throw new ScientificAuthorizationGateError(
        'PREVIEW_ARTIFACT_MISMATCH',
        `Bound artifact '${currentBinding.data_artifact_id}' not found in DataArtifactStore.`
      );
    }

    if (currentArtifact.checksum !== preview.source_artifact_checksum ||
        currentBinding.source_artifact_checksum !== preview.source_artifact_checksum) {
      throw new ScientificAuthorizationGateError(
        'PREVIEW_CHECKSUM_MISMATCH',
        `Source artifact checksum mismatch: Current artifact checksum '${currentArtifact.checksum}' does not match preview '${preview.source_artifact_checksum}'.`
      );
    }

    // 15. Module ID and version match
    const normalizedType = currentPlan.analysis_type.toUpperCase();
    const currentModuleIdentity = ANALYSIS_MODULE_REGISTRY[normalizedType];
    if (!currentModuleIdentity ||
        currentModuleIdentity.module_id !== preview.resolved_module_id ||
        currentModuleIdentity.module_version !== preview.resolved_module_version) {
      throw new ScientificAuthorizationGateError(
        'PREVIEW_MODULE_VERSION_MISMATCH',
        `Scientific module mismatch: Expected module '${preview.resolved_module_id}' v${preview.resolved_module_version}, current resolved module is '${currentModuleIdentity?.module_id}' v${currentModuleIdentity?.module_version}.`
      );
    }

    // 16. Re-evaluate fresh preview provenance to ensure 100% freshness
    const freshPreview = ExecutionPreviewValidator.generatePreview({
      project: currentProject,
      analysis_id: preview.analysis_id,
      dataset_version_store: options.dataset_version_store || defaultDatasetVersionStore,
      data_artifact_store: artifactStore,
      variable_store: options.variable_store || defaultVariableStore,
      variable_mapping_store: options.variable_mapping_store || defaultVariableMappingStore
    });

    if (freshPreview.readiness_status !== 'READY') {
      throw new ScientificAuthorizationGateError(
        'PREVIEW_STALE',
        `System state drift: Fresh preview evaluation is no longer READY (${freshPreview.errors.join('; ')}).`
      );
    }

    if (freshPreview.provenance_hash !== preview.provenance_hash) {
      throw new ScientificAuthorizationGateError(
        'PREVIEW_STALE',
        `Preview provenance digest mismatch: Current system state hash '${freshPreview.provenance_hash}' differs from snapshot hash '${preview.provenance_hash}'.`
      );
    }

    // ----------------------------------------------------
    // Build Immutable Authorization Record
    // ----------------------------------------------------
    const provenancePayload: AuthorizationProvenancePayload = {
      preview_id: preview.preview_id,
      execution_request_id: preview.execution_request_id,
      project_id: preview.project_id,
      project_version: preview.project_version,
      analysis_id: preview.analysis_id,
      analysis_plan_version: preview.analysis_plan_version,
      preview_provenance_hash: preview.provenance_hash,
      authorized_by: authorized_by.trim(),
      status: 'AUTHORIZED',
      scientific_validity: 'NOT_ESTABLISHED'
    };

    const authorizationHash = computeAuthorizationHash(provenancePayload);
    const authorizationId = `AUTH_${preview.project_id}_${preview.analysis_id}_${authorizationHash.slice(0, 12)}`;

    const authorization: ExecutionAuthorization = deepFreeze({
      authorization_id: authorizationId,
      preview_id: preview.preview_id,
      execution_request_id: preview.execution_request_id,
      project_id: preview.project_id,
      project_version: preview.project_version,
      analysis_id: preview.analysis_id,
      analysis_plan_version: preview.analysis_plan_version,
      authorized_by: authorized_by.trim(),
      authorized_at: new Date().toISOString(),
      preview_provenance_hash: preview.provenance_hash,
      authorization_hash: authorizationHash,
      status: 'AUTHORIZED' as const,
      scientific_validity: 'NOT_ESTABLISHED' as const
    });

    return authorization;
  }

  /**
   * Validates whether an existing authorization remains structurally valid against current system state.
   */
  public static validateAuthorization(
    authorization: ExecutionAuthorization,
    options?: {
      project?: ResearchProject;
      project_registry?: ResearchProjectRegistry;
      data_artifact_store?: DataArtifactStore;
    }
  ): ValidateAuthorizationResult {
    const errors: string[] = [];

    if (!authorization || typeof authorization !== 'object') {
      return { isValid: false, errors: ['[AUTHORIZATION_INVALID] Authorization record must be a valid object.'] };
    }

    if (authorization.status !== 'AUTHORIZED') {
      errors.push(`[AUTHORIZATION_INVALID] Authorization status is '${authorization.status}', expected 'AUTHORIZED'.`);
    }

    // Verify hash integrity
    const expectedHash = computeAuthorizationHash({
      preview_id: authorization.preview_id,
      execution_request_id: authorization.execution_request_id,
      project_id: authorization.project_id,
      project_version: authorization.project_version,
      analysis_id: authorization.analysis_id,
      analysis_plan_version: authorization.analysis_plan_version,
      preview_provenance_hash: authorization.preview_provenance_hash,
      authorized_by: authorization.authorized_by,
      status: authorization.status,
      scientific_validity: authorization.scientific_validity
    });

    if (authorization.authorization_hash !== expectedHash) {
      errors.push('[AUTHORIZATION_INVALID] Authorization hash mismatch: Content has been tampered with or corrupted.');
    }

    // Verify project lifecycle state
    const registry = options?.project_registry || defaultResearchProjectRegistry;
    const project = options?.project || registry.getProject(authorization.project_id);

    if (!project) {
      errors.push(`[PROJECT_NOT_EXECUTABLE] Research project '${authorization.project_id}' not found.`);
    } else {
      if (project.status === 'FINALIZED') {
        errors.push(`[PROJECT_FINALIZED] Project '${project.project_id}' is FINALIZED.`);
      }
      if (project.status === 'ARCHIVED') {
        errors.push(`[PROJECT_ARCHIVED] Project '${project.project_id}' is ARCHIVED.`);
      }
      if (project.project_version !== authorization.project_version) {
        errors.push(`[PREVIEW_STALE] Project version '${project.project_version}' does not match authorized version '${authorization.project_version}'.`);
      }

      const plan = project.analysis_plan?.find((a) => a.analysis_id === authorization.analysis_id);
      if (!plan) {
        errors.push(`[ANALYSIS_NOT_PLANNED] Analysis '${authorization.analysis_id}' not found in project.`);
      } else if (plan.status !== 'PLANNED') {
        errors.push(`[ANALYSIS_NOT_PLANNED] Analysis plan status is '${plan.status}', expected 'PLANNED'.`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Helper predicate checking if an authorization is currently valid.
   */
  public static isAuthorizationValid(
    authorization: ExecutionAuthorization,
    options?: {
      project?: ResearchProject;
      project_registry?: ResearchProjectRegistry;
      data_artifact_store?: DataArtifactStore;
    }
  ): boolean {
    return this.validateAuthorization(authorization, options).isValid;
  }
}

/**
 * Isolated in-memory store for ExecutionAuthorization records.
 */
export class ExecutionAuthorizationStore {
  private authorizations: Map<string, ExecutionAuthorization> = new Map();

  public register(auth: ExecutionAuthorization): ExecutionAuthorization {
    this.authorizations.set(auth.authorization_id, auth);
    return auth;
  }

  public get(authorizationId: string): ExecutionAuthorization | undefined {
    return this.authorizations.get(authorizationId);
  }

  public findByAnalysis(projectId: string, analysisId: string): ExecutionAuthorization | undefined {
    for (const auth of this.authorizations.values()) {
      if (auth.project_id === projectId && auth.analysis_id === analysisId && auth.status === 'AUTHORIZED') {
        return auth;
      }
    }
    return undefined;
  }

  public list(): ExecutionAuthorization[] {
    return Array.from(this.authorizations.values());
  }

  public revoke(authorizationId: string): ExecutionAuthorization {
    const existing = this.authorizations.get(authorizationId);
    if (!existing) {
      throw new ScientificAuthorizationGateError(
        'AUTHORIZATION_NOT_FOUND',
        `Execution authorization '${authorizationId}' not found.`
      );
    }

    const revoked: ExecutionAuthorization = deepFreeze({
      ...existing,
      status: 'REVOKED' as const,
      authorization_hash: computeAuthorizationHash({
        preview_id: existing.preview_id,
        execution_request_id: existing.execution_request_id,
        project_id: existing.project_id,
        project_version: existing.project_version,
        analysis_id: existing.analysis_id,
        analysis_plan_version: existing.analysis_plan_version,
        preview_provenance_hash: existing.preview_provenance_hash,
        authorized_by: existing.authorized_by,
        status: 'REVOKED',
        scientific_validity: 'NOT_ESTABLISHED'
      })
    });

    this.authorizations.set(authorizationId, revoked);
    return revoked;
  }

  public clear(): void {
    this.authorizations.clear();
  }
}

export const defaultExecutionAuthorizationStore = new ExecutionAuthorizationStore();
