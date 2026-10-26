/**
 * Phase D8 — Scientific Data Layer: Dataset Validation Gate
 *
 * Evaluates configured DataValidationProfile on dataset artifacts before execution.
 *
 * Core Invariants:
 * 1. Semantic Decoupling: DATA VALIDATION PASS does not mean SCIENTIFIC VALIDITY ESTABLISHED.
 * 2. Zero Biological Thresholds: All checks originate strictly from configured profiles.
 * 3. Deterministic Gate Policies:
 *    - BLOCK_ON_ERROR: blocks on any validation error.
 *    - BLOCK_ON_WARNING_OR_ERROR: blocks on errors or warnings.
 *    - PERMISSIVE: evaluates and records violations, but allows execution.
 *    - NOT_CONFIGURED: explicit passthrough when no validation profile is configured.
 */

import {
  DataArtifact,
  DataValidationProfile,
  DatasetVersion,
  ScientificDatasetExecutionError,
  ValidationGatePolicy,
  ValidationGateResult
} from '../types';
import { DataValidationEngine, ValidationProfileStore } from './dataValidation';
import { VariableStore } from './variableRegistry';
import { VariableMappingStore } from './variableMapping';

export interface EvaluateValidationGateOptions {
  dataset_version: DatasetVersion;
  artifact: DataArtifact;
  records?: Record<string, unknown>[];
  profile_id?: string;
  profile?: DataValidationProfile;
  profile_store?: ValidationProfileStore;
  policy?: ValidationGatePolicy;
  variable_registry?: VariableStore;
  variable_mapping?: VariableMappingStore;
}

export class DatasetValidationGate {
  /**
   * Evaluates the data validation profile against the dataset artifact.
   * Dataset and artifact are strictly read-only and never mutated.
   */
  public static evaluate(options: EvaluateValidationGateOptions): ValidationGateResult {
    const {
      dataset_version,
      artifact,
      records,
      profile_id,
      profile: explicitProfile,
      profile_store,
      policy = 'BLOCK_ON_ERROR',
      variable_registry,
      variable_mapping
    } = options;

    const evaluatedAt = new Date().toISOString();

    // 1. If policy is NOT_CONFIGURED or no profile specified
    if (policy === 'NOT_CONFIGURED' || (!profile_id && !explicitProfile)) {
      return {
        status: 'NOT_CONFIGURED',
        policy: 'NOT_CONFIGURED',
        error_count: 0,
        warning_count: 0,
        message: 'No DataValidationProfile configured for this execution.',
        evaluated_at: evaluatedAt
      };
    }

    // 2. Resolve profile
    let profile = explicitProfile;
    if (!profile && profile_id && profile_store) {
      profile = profile_store.get(profile_id) || undefined;
      if (!profile) {
        throw new ScientificDatasetExecutionError(
          'VALIDATION_GATE_BLOCKED',
          `Configured DataValidationProfile "${profile_id}" not found in ValidationProfileStore.`
        );
      }
    }

    if (!profile) {
      throw new ScientificDatasetExecutionError(
        'VALIDATION_GATE_BLOCKED',
        `Validation gate profile "${profile_id}" could not be resolved (store not provided or profile missing).`
      );
    }

    // 3. Evaluate DataValidationEngine
    const valResult = DataValidationEngine.validate({
      dataset_version,
      artifact,
      profile,
      records,
      variable_registry,
      variable_mapping
    });

    const errorCount = valResult.summary.failed ?? (valResult.errors?.length || 0);
    const warningCount = valResult.summary.warnings ?? (valResult.warnings?.length || 0);
    const violations = valResult.checks.flatMap((c) => c.sample_violations || []);

    // 4. Apply Gate Policy
    if (errorCount > 0) {
      if (policy === 'BLOCK_ON_ERROR' || policy === 'BLOCK_ON_WARNING_OR_ERROR') {
        return {
          status: 'BLOCKED',
          policy,
          profile_id: profile.profile_id,
          error_count: errorCount,
          warning_count: warningCount,
          message: `Validation gate BLOCKED: Dataset artifact failed validation with ${errorCount} error(s).`,
          evaluated_at: evaluatedAt,
          violations
        };
      }
    }

    if (warningCount > 0 && policy === 'BLOCK_ON_WARNING_OR_ERROR') {
      return {
        status: 'BLOCKED',
        policy,
        profile_id: profile.profile_id,
        error_count: errorCount,
        warning_count: warningCount,
        message: `Validation gate BLOCKED: Dataset artifact contains ${warningCount} warning(s) under BLOCK_ON_WARNING_OR_ERROR policy.`,
        evaluated_at: evaluatedAt,
        violations
      };
    }

    if (errorCount > 0 || warningCount > 0) {
      return {
        status: 'WARNING_PERMITTED',
        policy,
        profile_id: profile.profile_id,
        error_count: errorCount,
        warning_count: warningCount,
        message: `Validation gate WARNING_PERMITTED: Dataset artifact contains ${errorCount} error(s) and ${warningCount} warning(s); execution allowed under policy "${policy}".`,
        evaluated_at: evaluatedAt,
        violations
      };
    }

    return {
      status: 'PASSED',
      policy,
      profile_id: profile.profile_id,
      error_count: 0,
      warning_count: 0,
      message: 'Validation gate PASSED: All profile checks satisfied.',
      evaluated_at: evaluatedAt
    };
  }

  /**
   * Asserts that a ValidationGateResult allows execution, throwing VALIDATION_GATE_BLOCKED if blocked.
   */
  public static assertAllowed(gateResult: ValidationGateResult): void {
    if (gateResult.status === 'BLOCKED') {
      throw new ScientificDatasetExecutionError(
        'VALIDATION_GATE_BLOCKED',
        gateResult.message || 'Execution blocked by data validation gate.',
        {
          profile_id: gateResult.profile_id,
          policy: gateResult.policy,
          error_count: gateResult.error_count,
          warning_count: gateResult.warning_count,
          violations: gateResult.violations
        }
      );
    }
  }
}
