/**
 * Phase D12 — Scientific Data Layer: Research Power & Sample Size Contracts
 *
 * Defines strongly typed request/result contracts, configuration options,
 * execution statuses, and error classes for deterministic, auditable,
 * research power and sample size planning calculations.
 *
 * Strict Separation of Concerns:
 * 1. Mathematical / Statistical Power Planning (D12 Engine)
 * 2. Scientific Validation (NOT ESTABLISHED)
 * 3. Clinical / Diagnostic / Physiological Interpretation (Decoupled)
 */

import { deepFreeze } from './dataStatePipeline';

export type PowerAnalysisType =
  | 'ONE_SAMPLE_MEAN'
  | 'TWO_SAMPLE_MEAN'
  | 'PAIRED_MEAN'
  | 'ONE_PROPORTION'
  | 'TWO_PROPORTIONS'
  | 'CORRELATION'
  | 'ANOVA'
  | 'CHI_SQUARE'
  | 'LINEAR_REGRESSION'
  | 'LOGISTIC_REGRESSION';

export type PowerTestDirection = 'TWO_SIDED' | 'GREATER' | 'LESS';

export type EffectSizeType =
  | 'COHEN_D'
  | 'CORRELATION_R'
  | 'PROPORTION_DIFFERENCE'
  | 'COHEN_H'
  | 'ODDS_RATIO'
  | 'ANOVA_F_EFFECT'
  | 'REGRESSION_EFFECT'
  | 'CRAMERS_V';

export type PowerExecutionStatus =
  | 'COMPLETED'
  | 'INVALID_INPUT'
  | 'INSUFFICIENT_PARAMETERS'
  | 'UNSUPPORTED_ANALYSIS'
  | 'NUMERICAL_ERROR'
  | 'NON_CONVERGENCE'
  | 'ASSUMPTION_NOT_ESTABLISHED';

export type PowerCalculationMode =
  | 'SAMPLE_SIZE'
  | 'ACHIEVED_POWER'
  | 'MINIMUM_DETECTABLE_EFFECT';

export interface PowerAnalysisConfiguration {
  groups?: number;
  allocation_ratio?: number;
  dropout_rate?: number;
  confidence_level?: number;
  num_predictors?: number;
  degrees_of_freedom?: number;
  baseline_proportion?: number;
  sensitivity_sample_sizes?: number[];
  metadata?: Record<string, unknown>;
}

export interface ResearchPowerRequest {
  power_analysis_id: string;
  analysis_type: PowerAnalysisType;
  calculation_mode?: PowerCalculationMode;
  alpha?: number;
  target_power?: number;
  effect_size?: number;
  effect_size_type?: EffectSizeType;
  sample_size?: number;
  direction?: PowerTestDirection;
  configuration?: PowerAnalysisConfiguration;
  created_by?: string;
  created_at?: string;
  engine_version?: string;
}

export interface SensitivityResult {
  sample_size?: number;
  effect_size?: number;
  power?: number;
}

export interface ResearchPowerResult {
  power_analysis_id: string;
  analysis_type: PowerAnalysisType;
  calculation_mode: PowerCalculationMode;
  status: PowerExecutionStatus;
  alpha: number;
  target_power: number | null;
  effect_size: number | null;
  effect_size_type: EffectSizeType | null;
  sample_size: number | null;
  required_sample_size: number | null;
  achieved_power: number | null;
  minimum_detectable_effect: number | null;
  statistical_sample_size: number | null;
  attrition_adjusted_sample_size: number | null;
  group_sample_sizes: Record<string, number> | null;
  sensitivity_results: SensitivityResult[] | null;
  assumptions: string[];
  warnings: string[];
  numerical_status: string;
  provenance_hash: string;
  scientific_validity: 'NOT_ESTABLISHED';
  default_applied: boolean;
  executed_at: string;
  engine_version: string;
}

export type PowerErrorCode =
  | 'POWER_INVALID_INPUT'
  | 'POWER_INSUFFICIENT_PARAMETERS'
  | 'POWER_UNSUPPORTED_ANALYSIS'
  | 'POWER_NUMERICAL_ERROR'
  | 'POWER_NON_CONVERGENCE'
  | 'POWER_ASSUMPTION_NOT_ESTABLISHED';

export class ScientificPowerError extends Error {
  readonly code: PowerErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: PowerErrorCode, message: string, details?: Record<string, unknown>) {
    super(`[${code}] ${message}`);
    this.name = 'ScientificPowerError';
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, ScientificPowerError.prototype);
  }
}

/**
 * Validates a ResearchPowerRequest contract for structural correctness.
 */
export function validatePowerRequest(request: ResearchPowerRequest): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!request.power_analysis_id || typeof request.power_analysis_id !== 'string') {
    errors.push('power_analysis_id is required and must be a non-empty string');
  }

  const validTypes: PowerAnalysisType[] = [
    'ONE_SAMPLE_MEAN',
    'TWO_SAMPLE_MEAN',
    'PAIRED_MEAN',
    'ONE_PROPORTION',
    'TWO_PROPORTIONS',
    'CORRELATION',
    'ANOVA',
    'CHI_SQUARE',
    'LINEAR_REGRESSION',
    'LOGISTIC_REGRESSION'
  ];

  if (!validTypes.includes(request.analysis_type)) {
    errors.push(`analysis_type must be one of: ${validTypes.join(', ')}`);
  }

  if (request.alpha !== undefined) {
    if (typeof request.alpha !== 'number' || !Number.isFinite(request.alpha) || request.alpha <= 0 || request.alpha >= 1) {
      errors.push('alpha must be a finite number in the open interval (0, 1)');
    }
  }

  if (request.target_power !== undefined) {
    if (typeof request.target_power !== 'number' || !Number.isFinite(request.target_power) || request.target_power <= 0 || request.target_power >= 1) {
      errors.push('target_power must be a finite number in the open interval (0, 1)');
    }
  }

  if (request.sample_size !== undefined) {
    if (typeof request.sample_size !== 'number' || !Number.isFinite(request.sample_size) || request.sample_size <= 0) {
      errors.push('sample_size must be a positive finite number');
    }
  }

  if (request.configuration?.dropout_rate !== undefined) {
    const dr = request.configuration.dropout_rate;
    if (typeof dr !== 'number' || !Number.isFinite(dr) || dr < 0 || dr >= 1) {
      errors.push('dropout_rate must be a finite number in range [0, 1)');
    }
  }

  if (request.configuration?.allocation_ratio !== undefined) {
    const ar = request.configuration.allocation_ratio;
    if (typeof ar !== 'number' || !Number.isFinite(ar) || ar <= 0) {
      errors.push('allocation_ratio must be a positive finite number');
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Creates an immutable, deeply frozen ResearchPowerResult object.
 */
export function createPowerResult(
  data: Omit<ResearchPowerResult, 'scientific_validity'>
): ResearchPowerResult {
  const result: ResearchPowerResult = {
    ...data,
    scientific_validity: 'NOT_ESTABLISHED'
  };

  return deepFreeze(result);
}
