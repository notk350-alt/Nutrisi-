/**
 * NutriBodySim — Phase F2.2C.2: Authorized Execution Adapter
 *
 * Strict, typed bridge between ExecutionAuthorization and authoritative scientific execution modules.
 * Orchestrates dispatch preparation without executing statistical calculations or D9–D13 engines.
 *
 * Invariants:
 * 1. Zero statistical calculations, zero engine execution (D9–D13 untouched).
 * 2. ExecutionAuthorization is the sole entry boundary (rejects raw plans or raw previews).
 * 3. Rigorous verification of all 13 boundary invariants:
 *    - authorization exists
 *    - status === AUTHORIZED
 *    - authorization is immutable and unmutated
 *    - preview exists
 *    - preview is READY
 *    - preview is still current
 *    - preview provenance hash matches
 *    - project/version still matches
 *    - analysis plan/version still matches
 *    - dataset/version still matches
 *    - artifact/checksum still matches
 *    - module/version still matches
 *    - scientific_validity === NOT_ESTABLISHED
 * 4. Deeply immutable dispatch packet (deepFreeze).
 * 5. Deterministic SHA-256 provenance hash.
 */

import { sha256Hex } from '../crypto';
import { canonicalizeJson } from '../provenance/provenancePersistence';
import { deepFreeze } from './dataStatePipeline';
import { ResearchProject, PlannedAnalysis } from './researchProjectContracts';
import { ExecutionPreview } from './executionPreviewContracts';
import {
  ExecutionAuthorization,
  computeAuthorizationHash,
  AuthorizationProvenancePayload
} from './executionAuthorization';
import {
  ANALYSIS_MODULE_REGISTRY,
  AuthoritativeModuleIdentity
} from './analysisExecutionContracts';
import {
  AuthorizedAdapterErrorCode,
  AuthorizedDispatchStatus,
  AuthorizedExecutionDispatchResult,
  AuthorizedExecutionPacket,
  ScientificAuthorizedAdapterError,
  TargetModuleExecutionPayload
} from './authorizedExecutionAdapterContracts';
import { DatasetVersionStore, defaultDatasetVersionStore } from './datasetVersion';
import { DataArtifactStore, defaultDataArtifactStore } from './dataStatePipeline';
import { ResearchProjectRegistry, defaultResearchProjectRegistry } from './researchProjectRegistry';

export interface DispatchProvenancePayload {
  dispatch_id: string;
  authorization_id: string;
  authorization_hash: string;
  preview_id: string;
  preview_provenance_hash: string;
  project_id: string;
  project_version: string;
  analysis_id: string;
  analysis_plan_version: string;
  analysis_type: string;
  target_module_id: string;
  target_module_version: string;
  dataset_version_id: string;
  data_artifact_id: string;
  source_artifact_checksum: string;
  input_variable_ids: string[];
  dispatched_by: string;
  scientific_validity: 'NOT_ESTABLISHED';
}

/**
 * Computes deterministic SHA-256 provenance hash for an AuthorizedExecutionPacket payload.
 */
export function computeDispatchHash(payload: DispatchProvenancePayload): string {
  const normalized = {
    dispatch_id: payload.dispatch_id || '',
    authorization_id: payload.authorization_id || '',
    authorization_hash: payload.authorization_hash || '',
    preview_id: payload.preview_id || '',
    preview_provenance_hash: payload.preview_provenance_hash || '',
    project_id: payload.project_id || '',
    project_version: payload.project_version || '',
    analysis_id: payload.analysis_id || '',
    analysis_plan_version: payload.analysis_plan_version || '',
    analysis_type: payload.analysis_type || '',
    target_module_id: payload.target_module_id || '',
    target_module_version: payload.target_module_version || '',
    dataset_version_id: payload.dataset_version_id || '',
    data_artifact_id: payload.data_artifact_id || '',
    source_artifact_checksum: payload.source_artifact_checksum || '',
    input_variable_ids: [...(payload.input_variable_ids || [])].sort(),
    dispatched_by: (payload.dispatched_by || '').trim(),
    scientific_validity: 'NOT_ESTABLISHED' as const
  };

  const canonicalString = canonicalizeJson(normalized);
  return sha256Hex(canonicalString);
}

export interface PrepareDispatchOptions {
  authorization?: ExecutionAuthorization;
  preview?: ExecutionPreview;
  project?: ResearchProject;
  project_registry?: ResearchProjectRegistry;
  dataset_version_store?: DatasetVersionStore;
  data_artifact_store?: DataArtifactStore;
  custom_timestamp?: string;
  custom_dispatch_id?: string;
}

export class AuthorizedExecutionAdapter {
  /**
   * Adapts and validates an ExecutionAuthorization, returning a structured result.
   * If any check fails, returns BLOCKED status with specific error messages.
   */
  public static adaptAndValidate(options: PrepareDispatchOptions): AuthorizedExecutionDispatchResult {
    try {
      const packet = this.createDispatchPacket(options);
      return deepFreeze({
        status: 'READY' as const,
        dispatch_id: packet.dispatch_id,
        packet,
        errors: [],
        warnings: [],
        scientific_validity: 'NOT_ESTABLISHED' as const
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      return deepFreeze({
        status: 'BLOCKED' as const,
        errors: [errorMessage],
        warnings: [],
        scientific_validity: 'NOT_ESTABLISHED' as const
      });
    }
  }

  /**
   * Strict adapter dispatch packet builder.
   * Enforces all 13 verification rules and builds an immutable AuthorizedExecutionPacket.
   * Throws ScientificAuthorizedAdapterError if any rule is violated.
   */
  public static createDispatchPacket(options: PrepareDispatchOptions): AuthorizedExecutionPacket {
    const {
      authorization,
      preview,
      project: providedProject,
      project_registry = defaultResearchProjectRegistry,
      dataset_version_store = defaultDatasetVersionStore,
      data_artifact_store = defaultDataArtifactStore,
      custom_timestamp,
      custom_dispatch_id
    } = options;

    // 1. Authorization existence check
    if (!authorization || typeof authorization !== 'object') {
      throw new ScientificAuthorizedAdapterError(
        'AUTHORIZATION_REQUIRED',
        'ExecutionAuthorization is required to adapt for execution dispatch.'
      );
    }

    // 2. Authorization status check
    if (authorization.status !== 'AUTHORIZED') {
      throw new ScientificAuthorizedAdapterError(
        'AUTHORIZATION_NOT_AUTHORIZED',
        `Execution authorization status is '${authorization.status}', expected 'AUTHORIZED'.`
      );
    }

    // 3. Authorization immutability & unmutated check
    const expectedAuthPayload: AuthorizationProvenancePayload = {
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
    };
    const recomputedAuthHash = computeAuthorizationHash(expectedAuthPayload);
    if (authorization.authorization_hash !== recomputedAuthHash) {
      throw new ScientificAuthorizedAdapterError(
        'AUTHORIZATION_HASH_MISMATCH',
        'Authorization record has been mutated or has invalid hash integrity.'
      );
    }

    // 4. Preview existence check
    if (!preview || typeof preview !== 'object') {
      throw new ScientificAuthorizedAdapterError(
        'PREVIEW_REQUIRED',
        'ExecutionPreview is required to adapt for execution dispatch.'
      );
    }

    // 5. Preview readiness check
    if (preview.readiness_status !== 'READY') {
      throw new ScientificAuthorizedAdapterError(
        'PREVIEW_NOT_READY',
        `ExecutionPreview status is '${preview.readiness_status}', expected 'READY'.`
      );
    }

    if (preview.errors && preview.errors.length > 0) {
      throw new ScientificAuthorizedAdapterError(
        'PREVIEW_NOT_READY',
        `ExecutionPreview contains blocking errors: ${preview.errors.join('; ')}`
      );
    }

    // 6. Preview provenance hash presence & match
    if (!authorization.preview_provenance_hash || !preview.provenance_hash) {
      throw new ScientificAuthorizedAdapterError(
        'PREVIEW_PROVENANCE_MISMATCH',
        'Preview provenance hash is missing from authorization or preview.'
      );
    }
    if (authorization.preview_provenance_hash !== preview.provenance_hash) {
      throw new ScientificAuthorizedAdapterError(
        'PREVIEW_PROVENANCE_MISMATCH',
        `Preview provenance hash mismatch: authorization has '${authorization.preview_provenance_hash}', preview has '${preview.provenance_hash}'.`
      );
    }

    // Resolve project from option or registry
    const project = providedProject || project_registry.getProject(authorization.project_id);
    if (!project) {
      throw new ScientificAuthorizedAdapterError(
        'PROJECT_NOT_EXECUTABLE',
        `Project '${authorization.project_id}' not found in registry.`
      );
    }

    // 7. Project state checks
    if (project.status === 'FINALIZED') {
      throw new ScientificAuthorizedAdapterError(
        'PROJECT_FINALIZED',
        `Project '${project.project_id}' is FINALIZED and cannot be dispatched.`
      );
    }
    if (project.status === 'ARCHIVED') {
      throw new ScientificAuthorizedAdapterError(
        'PROJECT_ARCHIVED',
        `Project '${project.project_id}' is ARCHIVED and cannot be dispatched.`
      );
    }

    // 8. Project ID and version match
    if (project.project_id !== authorization.project_id || project.project_version !== authorization.project_version) {
      throw new ScientificAuthorizedAdapterError(
        'PROJECT_MISMATCH',
        `Project version mismatch: project is at v${project.project_version}, authorized for v${authorization.project_version}.`
      );
    }

    // 9. Analysis plan existence, status, and version match
    const plannedAnalysis: PlannedAnalysis | undefined = project.analysis_plan.find(
      p => p.analysis_id === authorization.analysis_id
    );
    if (!plannedAnalysis) {
      throw new ScientificAuthorizedAdapterError(
        'ANALYSIS_PLAN_MISMATCH',
        `Analysis plan '${authorization.analysis_id}' not found in project.`
      );
    }
    if (plannedAnalysis.status !== 'PLANNED') {
      throw new ScientificAuthorizedAdapterError(
        'ANALYSIS_NOT_PLANNED',
        `Analysis status is '${plannedAnalysis.status}', expected 'PLANNED'.`
      );
    }
    if (preview.analysis_plan_version !== authorization.analysis_plan_version) {
      throw new ScientificAuthorizedAdapterError(
        'ANALYSIS_PLAN_MISMATCH',
        `Analysis plan version mismatch: preview is at v${preview.analysis_plan_version}, authorized for v${authorization.analysis_plan_version}.`
      );
    }

    // 10. Dataset version match
    if (project.dataset_binding?.dataset_version_id !== preview.dataset_version_id) {
      throw new ScientificAuthorizedAdapterError(
        'DATASET_MISMATCH',
        `Dataset version binding changed: project bound to '${project.dataset_binding?.dataset_version_id}', preview bound to '${preview.dataset_version_id}'.`
      );
    }

    // Verify dataset version exists in store
    const datasetVersion = dataset_version_store.get(preview.dataset_version_id);
    if (!datasetVersion) {
      throw new ScientificAuthorizedAdapterError(
        'DATASET_MISMATCH',
        `DatasetVersion '${preview.dataset_version_id}' does not exist in store.`
      );
    }

    // 11. Artifact binding & checksum match
    if (project.dataset_binding?.data_artifact_id !== preview.data_artifact_id) {
      throw new ScientificAuthorizedAdapterError(
        'ARTIFACT_CHECKSUM_MISMATCH',
        `Artifact binding changed: project bound to '${project.dataset_binding?.data_artifact_id}', preview bound to '${preview.data_artifact_id}'.`
      );
    }

    const artifact = data_artifact_store.get(preview.data_artifact_id);
    if (!artifact) {
      throw new ScientificAuthorizedAdapterError(
        'ARTIFACT_CHECKSUM_MISMATCH',
        `DataArtifact '${preview.data_artifact_id}' does not exist in store.`
      );
    }
    if (artifact.checksum !== preview.source_artifact_checksum) {
      throw new ScientificAuthorizedAdapterError(
        'ARTIFACT_CHECKSUM_MISMATCH',
        `Artifact checksum mismatch: store has '${artifact.checksum}', preview has '${preview.source_artifact_checksum}'.`
      );
    }

    // 12. Module ID and version resolution match against authoritative registry
    const moduleLookupKey = (preview.analysis_type || '').toUpperCase();
    const resolvedModule: AuthoritativeModuleIdentity | undefined = ANALYSIS_MODULE_REGISTRY[moduleLookupKey];
    if (!resolvedModule) {
      throw new ScientificAuthorizedAdapterError(
        'MODULE_NOT_RESOLVED',
        `No authoritative scientific module registered for analysis type '${preview.analysis_type}'.`
      );
    }
    if (
      resolvedModule.module_id !== preview.resolved_module_id ||
      resolvedModule.module_version !== preview.resolved_module_version
    ) {
      throw new ScientificAuthorizedAdapterError(
        'MODULE_VERSION_MISMATCH',
        `Module identity mismatch: resolved '${resolvedModule.module_id}@${resolvedModule.module_version}', preview has '${preview.resolved_module_id}@${preview.resolved_module_version}'.`
      );
    }

    // 13. Scientific validity invariant
    if (
      authorization.scientific_validity !== 'NOT_ESTABLISHED' ||
      preview.scientific_validity !== 'NOT_ESTABLISHED'
    ) {
      throw new ScientificAuthorizedAdapterError(
        'SCIENTIFIC_VALIDITY_VIOLATION',
        'Scientific validity must remain strictly NOT_ESTABLISHED.'
      );
    }

    // All 13 checks passed! Now build the strongly typed target module execution payload.
    const dispatchedAt = custom_timestamp || new Date().toISOString();
    const dispatchId =
      custom_dispatch_id || `disp_${authorization.authorization_id}_${Date.now()}`;

    const targetPayload = this.buildTargetModulePayload(
      resolvedModule,
      preview,
      authorization,
      project,
      dispatchedAt
    );

    // Compute deterministic dispatch provenance hash
    const dispatchPayload: DispatchProvenancePayload = {
      dispatch_id: dispatchId,
      authorization_id: authorization.authorization_id,
      authorization_hash: authorization.authorization_hash,
      preview_id: preview.preview_id,
      preview_provenance_hash: preview.provenance_hash,
      project_id: authorization.project_id,
      project_version: authorization.project_version,
      analysis_id: authorization.analysis_id,
      analysis_plan_version: authorization.analysis_plan_version,
      analysis_type: preview.analysis_type,
      target_module_id: resolvedModule.module_id,
      target_module_version: resolvedModule.module_version,
      dataset_version_id: preview.dataset_version_id,
      data_artifact_id: preview.data_artifact_id,
      source_artifact_checksum: preview.source_artifact_checksum,
      input_variable_ids: [...preview.input_variable_ids],
      dispatched_by: authorization.authorized_by,
      scientific_validity: 'NOT_ESTABLISHED'
    };

    const dispatchHash = computeDispatchHash(dispatchPayload);

    const packet: AuthorizedExecutionPacket = {
      dispatch_id: dispatchId,
      authorization_id: authorization.authorization_id,
      preview_id: preview.preview_id,
      execution_request_id: authorization.execution_request_id || preview.execution_request_id,
      project_id: authorization.project_id,
      project_version: authorization.project_version,
      analysis_id: authorization.analysis_id,
      analysis_plan_version: authorization.analysis_plan_version,
      analysis_type: preview.analysis_type,
      target_module_id: resolvedModule.module_id,
      target_module_name: resolvedModule.module_name,
      target_module_version: resolvedModule.module_version,
      target_engine_version: resolvedModule.engine_version,
      dataset_version_id: preview.dataset_version_id,
      data_artifact_id: preview.data_artifact_id,
      source_artifact_checksum: preview.source_artifact_checksum,
      input_variable_ids: Object.freeze([...preview.input_variable_ids]),
      grouping_variable_ids: preview.grouping_variable_ids
        ? Object.freeze([...preview.grouping_variable_ids])
        : undefined,
      pairing_variable_ids: preview.pairing_variable_ids
        ? Object.freeze([...preview.pairing_variable_ids])
        : undefined,
      alpha: preview.alpha,
      confidence_level: preview.confidence_level,
      configuration: Object.freeze({ ...preview.configuration }),
      target_payload: targetPayload,
      authorization_hash: authorization.authorization_hash,
      preview_provenance_hash: preview.provenance_hash,
      dispatch_hash: dispatchHash,
      dispatched_at: dispatchedAt,
      dispatched_by: authorization.authorized_by,
      dispatch_status: 'READY',
      scientific_validity: 'NOT_ESTABLISHED'
    };

    return deepFreeze(packet);
  }

  /**
   * Verifies an existing AuthorizedExecutionPacket for deep integrity and provenance match.
   */
  public static verifyDispatchPacket(packet: AuthorizedExecutionPacket): boolean {
    if (!packet || typeof packet !== 'object') return false;
    if (packet.dispatch_status !== 'READY') return false;
    if (packet.scientific_validity !== 'NOT_ESTABLISHED') return false;

    const payload: DispatchProvenancePayload = {
      dispatch_id: packet.dispatch_id,
      authorization_id: packet.authorization_id,
      authorization_hash: packet.authorization_hash,
      preview_id: packet.preview_id,
      preview_provenance_hash: packet.preview_provenance_hash,
      project_id: packet.project_id,
      project_version: packet.project_version,
      analysis_id: packet.analysis_id,
      analysis_plan_version: packet.analysis_plan_version,
      analysis_type: packet.analysis_type,
      target_module_id: packet.target_module_id,
      target_module_version: packet.target_module_version,
      dataset_version_id: packet.dataset_version_id,
      data_artifact_id: packet.data_artifact_id,
      source_artifact_checksum: packet.source_artifact_checksum,
      input_variable_ids: [...packet.input_variable_ids],
      dispatched_by: packet.dispatched_by,
      scientific_validity: 'NOT_ESTABLISHED'
    };

    const recomputedHash = computeDispatchHash(payload);
    return packet.dispatch_hash === recomputedHash;
  }

  /**
   * Builds the strongly typed downstream request payload without executing any calculation.
   */
  private static buildTargetModulePayload(
    moduleIdentity: AuthoritativeModuleIdentity,
    preview: ExecutionPreview,
    authorization: ExecutionAuthorization,
    project: ResearchProject,
    dispatchedAt: string
  ): TargetModuleExecutionPayload {
    const analysisType = (preview.analysis_type || '').toUpperCase();

    switch (analysisType) {
      case 'DESCRIPTIVE': {
        return {
          type: 'D9_DESCRIPTIVE',
          payload: {
            analysis_id: preview.analysis_id,
            dataset_version_id: preview.dataset_version_id,
            data_artifact_id: preview.data_artifact_id,
            requested_variables: [...preview.input_variable_ids],
            analysis_type: 'DESCRIPTIVE_NUMERIC',
            grouping:
              preview.grouping_variable_ids && preview.grouping_variable_ids.length > 0
                ? { group_by_variables: [...preview.grouping_variable_ids] }
                : undefined,
            configuration: { ...preview.configuration },
            created_by: authorization.authorized_by,
            created_at: dispatchedAt
          }
        };
      }

      case 'INFERENTIAL': {
        const hypothesis =
          project.hypotheses?.find(h => h.hypothesis_id === preview.hypothesis_id) ||
          project.hypotheses?.[0];
        const hypothesisType =
          hypothesis?.direction === 'GREATER'
            ? 'GREATER_THAN'
            : hypothesis?.direction === 'LESS'
            ? 'LESS_THAN'
            : 'TWO_SIDED';

        return {
          type: 'D10_INFERENTIAL',
          payload: {
            analysis_id: preview.analysis_id,
            dataset_version_id: preview.dataset_version_id,
            data_artifact_id: preview.data_artifact_id,
            test_type: (preview.configuration?.test_type as any) || 'INDEPENDENT_TWO_SAMPLE_T_TEST',
            dependent_variable: preview.input_variable_ids[0] || '',
            independent_variables: preview.input_variable_ids.slice(1),
            grouping_variable: preview.grouping_variable_ids?.[0],
            paired_variable: preview.pairing_variable_ids?.[0],
            null_hypothesis: {
              statement: hypothesis?.null_hypothesis || 'Null Hypothesis: no difference or association'
            },
            alternative_hypothesis: {
              type: hypothesisType,
              statement: hypothesis?.alternative_hypothesis || 'Alternative Hypothesis'
            },
            alpha: preview.alpha ?? 0.05,
            confidence_level: preview.confidence_level ?? 0.95,
            configuration: { ...preview.configuration },
            created_by: authorization.authorized_by,
            created_at: dispatchedAt,
            engine_version: moduleIdentity.engine_version
          }
        };
      }

      case 'REGRESSION': {
        const indVars = preview.input_variable_ids.slice(1);
        const resolvedIndVars =
          indVars.length > 0
            ? indVars
            : preview.grouping_variable_ids && preview.grouping_variable_ids.length > 0
            ? [...preview.grouping_variable_ids]
            : [preview.input_variable_ids[0]];
        const rawModelType = preview.configuration?.model_type;
        const resolvedModelType =
          rawModelType === 'SIMPLE_LINEAR_REGRESSION' ||
          rawModelType === 'MULTIPLE_LINEAR_REGRESSION' ||
          rawModelType === 'LOGISTIC_REGRESSION'
            ? rawModelType
            : resolvedIndVars.length > 1
            ? 'MULTIPLE_LINEAR_REGRESSION'
            : 'SIMPLE_LINEAR_REGRESSION';

        return {
          type: 'D11_REGRESSION',
          payload: {
            model_id: preview.analysis_id,
            dataset_version_id: preview.dataset_version_id,
            data_artifact_id: preview.data_artifact_id,
            model_type: resolvedModelType,
            dependent_variable: (preview.configuration?.dependent_variable as string) || preview.input_variable_ids[0] || '',
            independent_variables: (preview.configuration?.independent_variables as string[]) || resolvedIndVars,
            configuration: { ...preview.configuration },
            created_by: authorization.authorized_by,
            created_at: dispatchedAt,
            engine_version: moduleIdentity.engine_version
          }
        };
      }

      case 'POWER':
      case 'POWER_ANALYSIS': {
        const rawType = preview.configuration?.power_analysis_type as string;
        const resolvedPowerType =
          rawType === 'TWO_SAMPLE_T_TEST' ? 'TWO_SAMPLE_MEAN' :
          rawType === 'ONE_SAMPLE_T_TEST' ? 'ONE_SAMPLE_MEAN' :
          rawType === 'PAIRED_T_TEST' ? 'PAIRED_MEAN' :
          (rawType as any) || 'TWO_SAMPLE_MEAN';

        return {
          type: 'D12_POWER',
          payload: {
            power_analysis_id: preview.analysis_id,
            analysis_type: resolvedPowerType,
            calculation_mode: (preview.configuration?.calculation_mode as any) || 'ACHIEVED_POWER',
            alpha: preview.alpha ?? 0.05,
            target_power: (preview.configuration?.target_power as number) ?? 0.8,
            effect_size: (preview.configuration?.effect_size as number) ?? 0.5,
            sample_size: (preview.configuration?.sample_size as number) ?? 64,
            configuration: { ...preview.configuration },
            created_by: authorization.authorized_by,
            created_at: dispatchedAt,
            engine_version: moduleIdentity.engine_version
          }
        };
      }

      case 'NONPARAMETRIC':
      case 'NON_PARAMETRIC': {
        const hypothesis =
          project.hypotheses?.find(h => h.hypothesis_id === preview.hypothesis_id) ||
          project.hypotheses?.[0];
        const hypothesisType =
          hypothesis?.direction === 'GREATER'
            ? 'GREATER_THAN'
            : hypothesis?.direction === 'LESS'
            ? 'LESS_THAN'
            : 'TWO_SIDED';

        return {
          type: 'D13_NON_PARAMETRIC',
          payload: {
            analysis_id: preview.analysis_id,
            dataset_version_id: preview.dataset_version_id,
            data_artifact_id: preview.data_artifact_id,
            test_type: (preview.configuration?.non_parametric_test_type as any) || 'MANN_WHITNEY_U',
            dependent_variable: preview.input_variable_ids[0] || '',
            independent_variables: preview.input_variable_ids.slice(1),
            grouping_variable: preview.grouping_variable_ids?.[0],
            group_a: (preview.configuration?.group_a as string) || undefined,
            group_b: (preview.configuration?.group_b as string) || undefined,
            paired_variable: preview.pairing_variable_ids?.[0],
            null_hypothesis: {
              statement: hypothesis?.null_hypothesis || 'Null Hypothesis: distributions are equal'
            },
            alternative_hypothesis: {
              type: hypothesisType,
              statement: hypothesis?.alternative_hypothesis || 'Alternative Hypothesis'
            },
            alpha: preview.alpha ?? 0.05,
            confidence_level: preview.confidence_level ?? 0.95,
            configuration: { ...preview.configuration },
            created_by: authorization.authorized_by,
            created_at: dispatchedAt,
            engine_version: moduleIdentity.engine_version
          }
        };
      }

      default:
        throw new ScientificAuthorizedAdapterError(
          'MODULE_NOT_RESOLVED',
          `Unsupported analysis type '${preview.analysis_type}' for target module payload generation.`
        );
    }
  }
}

/**
 * In-memory registry and store for immutable AuthorizedExecutionPacket records.
 */
export class AuthorizedExecutionDispatchStore {
  private packets = new Map<string, AuthorizedExecutionPacket>();

  public register(packet: AuthorizedExecutionPacket): AuthorizedExecutionPacket {
    if (!packet || !packet.dispatch_id) {
      throw new ScientificAuthorizedAdapterError(
        'DISPATCH_BLOCKED',
        'Cannot register invalid dispatch packet.'
      );
    }
    this.packets.set(packet.dispatch_id, packet);
    return packet;
  }

  public get(dispatchId: string): AuthorizedExecutionPacket | undefined {
    return this.packets.get(dispatchId);
  }

  public findByAnalysis(projectId: string, analysisId: string): AuthorizedExecutionPacket | undefined {
    for (const packet of this.packets.values()) {
      if (packet.project_id === projectId && packet.analysis_id === analysisId) {
        return packet;
      }
    }
    return undefined;
  }

  public findByAuthorization(authorizationId: string): AuthorizedExecutionPacket | undefined {
    for (const packet of this.packets.values()) {
      if (packet.authorization_id === authorizationId) {
        return packet;
      }
    }
    return undefined;
  }

  public list(): AuthorizedExecutionPacket[] {
    return Array.from(this.packets.values());
  }

  public clear(): void {
    this.packets.clear();
  }
}

export const defaultAuthorizedExecutionDispatchStore = new AuthorizedExecutionDispatchStore();
