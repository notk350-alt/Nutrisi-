/**
 * NutriBodySim — Phase F2.2C.2: Authorized Execution Adapter Contracts
 *
 * Strongly typed declarative contracts for adapting an ExecutionAuthorization
 * into an immutable dispatch packet for the authoritative Scientific Execution Architecture.
 *
 * Invariants:
 * 1. Zero statistical calculation, zero D9–D13 engine invocation during adapter dispatch.
 * 2. ExecutionAuthorization is the sole authoritative gateway (no raw plans or previews allowed alone).
 * 3. All 13 pre-dispatch integrity checks must pass strictly.
 * 4. Deeply immutable output (deepFreeze).
 * 5. Deterministic SHA-256 dispatch provenance digest.
 * 6. scientific_validity = 'NOT_ESTABLISHED' strictly preserved.
 */

import { AnalysisRequest } from './analysisContracts';
import { InferentialAnalysisRequest } from './inferentialContracts';
import { RegressionModelRequest } from './regressionContracts';
import { ResearchPowerRequest } from './powerContracts';
import { NonParametricAnalysisRequest } from './nonParametricContracts';

export type AuthorizedDispatchStatus = 'READY' | 'BLOCKED';

export type AuthorizedAdapterErrorCode =
  | 'AUTHORIZATION_REQUIRED'
  | 'AUTHORIZATION_NOT_AUTHORIZED'
  | 'AUTHORIZATION_MUTATED'
  | 'AUTHORIZATION_HASH_MISMATCH'
  | 'PREVIEW_REQUIRED'
  | 'PREVIEW_NOT_READY'
  | 'PREVIEW_STALE'
  | 'PREVIEW_PROVENANCE_MISMATCH'
  | 'PROJECT_MISMATCH'
  | 'PROJECT_NOT_EXECUTABLE'
  | 'PROJECT_FINALIZED'
  | 'PROJECT_ARCHIVED'
  | 'ANALYSIS_PLAN_MISMATCH'
  | 'ANALYSIS_NOT_PLANNED'
  | 'DATASET_MISMATCH'
  | 'ARTIFACT_CHECKSUM_MISMATCH'
  | 'MODULE_NOT_RESOLVED'
  | 'MODULE_VERSION_MISMATCH'
  | 'SCIENTIFIC_VALIDITY_VIOLATION'
  | 'DISPATCH_BLOCKED'
  | 'DISPATCH_NOT_FOUND';

export class ScientificAuthorizedAdapterError extends Error {
  public readonly code: AuthorizedAdapterErrorCode;
  public readonly details?: unknown;

  constructor(code: AuthorizedAdapterErrorCode, message: string, details?: unknown) {
    super(`[${code}] ${message}`);
    this.name = 'ScientificAuthorizedAdapterError';
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, ScientificAuthorizedAdapterError.prototype);
  }
}

/**
 * Union of target module execution request payloads.
 * Represents the typed payload formulated for downstream scientific engines.
 */
export type TargetModuleExecutionPayload =
  | { type: 'D9_DESCRIPTIVE'; payload: AnalysisRequest }
  | { type: 'D10_INFERENTIAL'; payload: InferentialAnalysisRequest }
  | { type: 'D11_REGRESSION'; payload: RegressionModelRequest }
  | { type: 'D12_POWER'; payload: ResearchPowerRequest }
  | { type: 'D13_NON_PARAMETRIC'; payload: NonParametricAnalysisRequest };

/**
 * Immutable Authorized Execution Dispatch Packet contract.
 */
export interface AuthorizedExecutionPacket {
  readonly dispatch_id: string;
  readonly authorization_id: string;
  readonly preview_id: string;
  readonly execution_request_id?: string;
  readonly project_id: string;
  readonly project_version: string;
  readonly analysis_id: string;
  readonly analysis_plan_version: string;
  readonly analysis_type: string;
  readonly target_module_id: string;
  readonly target_module_name: string;
  readonly target_module_version: string;
  readonly target_engine_version: string;
  readonly dataset_version_id: string;
  readonly data_artifact_id: string;
  readonly source_artifact_checksum: string;
  readonly input_variable_ids: readonly string[];
  readonly grouping_variable_ids?: readonly string[];
  readonly pairing_variable_ids?: readonly string[];
  readonly alpha?: number;
  readonly confidence_level?: number;
  readonly configuration: Readonly<Record<string, unknown>>;
  readonly target_payload: TargetModuleExecutionPayload;
  readonly authorization_hash: string;
  readonly preview_provenance_hash: string;
  readonly dispatch_hash: string;
  readonly dispatched_at: string;
  readonly dispatched_by: string;
  readonly dispatch_status: AuthorizedDispatchStatus;
  readonly scientific_validity: 'NOT_ESTABLISHED';
}

/**
 * Result returned by the adapter validation and dispatch preparation.
 */
export interface AuthorizedExecutionDispatchResult {
  readonly status: AuthorizedDispatchStatus;
  readonly dispatch_id?: string;
  readonly packet?: AuthorizedExecutionPacket;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  readonly scientific_validity: 'NOT_ESTABLISHED';
}
