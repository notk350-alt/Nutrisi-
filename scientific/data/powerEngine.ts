/**
 * Phase D12 — Scientific Data Layer: Research Power & Sample Size Execution Engine
 *
 * Implements deterministic, auditable execution of research power analysis requests.
 * Manages mode determination, default parameters, provenance digest generation,
 * assumption tracking, and immutable result creation.
 */

import { computeProvenanceHash } from '../provenance/provenancePersistence';
import {
  computePowerMetrics,
  computeSensitivityGrid
} from './powerAnalysis';
import {
  createPowerResult,
  PowerCalculationMode,
  PowerExecutionStatus,
  ResearchPowerRequest,
  ResearchPowerResult,
  ScientificPowerError,
  validatePowerRequest
} from './powerContracts';

export const D12_ENGINE_VERSION = '1.0.0';

export class ResearchPowerEngine {
  /**
   * Main entry point to execute a ResearchPowerRequest.
   * Guarantees deterministic output, defensive cloning, deep freezing,
   * and complete cryptographic provenance.
   */
  public static execute(request: ResearchPowerRequest): ResearchPowerResult {
    const executedAt = new Date().toISOString();
    const engineVersion = request.engine_version || D12_ENGINE_VERSION;

    // Validate structural request parameters
    const validation = validatePowerRequest(request);
    if (!validation.valid) {
      return createPowerResult({
        power_analysis_id: request.power_analysis_id || 'UNKNOWN',
        analysis_type: request.analysis_type || 'ONE_SAMPLE_MEAN',
        calculation_mode: request.calculation_mode || 'SAMPLE_SIZE',
        status: 'INVALID_INPUT',
        alpha: request.alpha ?? 0.05,
        target_power: request.target_power ?? null,
        effect_size: request.effect_size ?? null,
        effect_size_type: request.effect_size_type ?? null,
        sample_size: request.sample_size ?? null,
        required_sample_size: null,
        achieved_power: null,
        minimum_detectable_effect: null,
        statistical_sample_size: null,
        attrition_adjusted_sample_size: null,
        group_sample_sizes: null,
        sensitivity_results: null,
        assumptions: [],
        warnings: validation.errors,
        numerical_status: 'INVALID_INPUT',
        provenance_hash: '',
        default_applied: false,
        executed_at: executedAt,
        engine_version: engineVersion
      });
    }

    let defaultApplied = false;
    let alpha = request.alpha;
    if (alpha === undefined) {
      alpha = 0.05;
      defaultApplied = true;
    }

    let targetPower = request.target_power;
    let effectSize = request.effect_size;
    let sampleSize = request.sample_size;

    // Determine calculation mode if unspecified
    let mode: PowerCalculationMode | undefined = request.calculation_mode;
    if (!mode) {
      if (sampleSize != null && effectSize != null) {
        mode = 'ACHIEVED_POWER';
      } else if (sampleSize != null && targetPower != null) {
        mode = 'MINIMUM_DETECTABLE_EFFECT';
      } else if ((targetPower != null || defaultApplied) && effectSize != null) {
        mode = 'SAMPLE_SIZE';
        if (targetPower === undefined) {
          targetPower = 0.8;
          defaultApplied = true;
        }
      }
    }

    if (!mode) {
      return createPowerResult({
        power_analysis_id: request.power_analysis_id,
        analysis_type: request.analysis_type,
        calculation_mode: 'SAMPLE_SIZE',
        status: 'INSUFFICIENT_PARAMETERS',
        alpha,
        target_power: targetPower ?? null,
        effect_size: effectSize ?? null,
        effect_size_type: request.effect_size_type ?? null,
        sample_size: sampleSize ?? null,
        required_sample_size: null,
        achieved_power: null,
        minimum_detectable_effect: null,
        statistical_sample_size: null,
        attrition_adjusted_sample_size: null,
        group_sample_sizes: null,
        sensitivity_results: null,
        assumptions: ['Insufficient parameters provided to infer calculation mode'],
        warnings: ['Provide at least two of (sample_size, effect_size, target_power)'],
        numerical_status: 'INSUFFICIENT_PARAMETERS',
        provenance_hash: '',
        default_applied: defaultApplied,
        executed_at: executedAt,
        engine_version: engineVersion
      });
    }

    // Default target_power for SAMPLE_SIZE or MINIMUM_DETECTABLE_EFFECT if missing
    if (mode === 'SAMPLE_SIZE' && targetPower == null) {
      targetPower = 0.8;
      defaultApplied = true;
    }

    const config = request.configuration || {};
    const dropoutRate = config.dropout_rate ?? 0;
    const allocationRatio = config.allocation_ratio ?? 1.0;
    const groups = config.groups ?? 3;
    const numPredictors = config.num_predictors ?? 1;
    const baselineProp = config.baseline_proportion ?? 0.5;

    try {
      const computedOutput = computePowerMetrics({
        analysis_type: request.analysis_type,
        mode,
        alpha,
        target_power: targetPower,
        effect_size: effectSize,
        sample_size: sampleSize,
        direction: request.direction ?? 'TWO_SIDED',
        allocation_ratio: allocationRatio,
        groups,
        dropout_rate: dropoutRate,
        num_predictors: numPredictors,
        baseline_proportion: baselineProp
      });

      // Sensitivity grid if requested
      let sensitivityResults = null;
      if (config.sensitivity_sample_sizes && Array.isArray(config.sensitivity_sample_sizes)) {
        sensitivityResults = computeSensitivityGrid(
          {
            analysis_type: request.analysis_type,
            mode,
            alpha,
            target_power: targetPower,
            effect_size: effectSize,
            sample_size: sampleSize,
            direction: request.direction ?? 'TWO_SIDED',
            allocation_ratio: allocationRatio,
            groups,
            dropout_rate: dropoutRate,
            num_predictors: numPredictors,
            baseline_proportion: baselineProp
          },
          config.sensitivity_sample_sizes
        );
      }

      // Build canonical provenance payload
      const provenancePayload = {
        power_analysis_id: request.power_analysis_id,
        analysis_type: request.analysis_type,
        calculation_mode: mode,
        alpha,
        target_power: targetPower ?? null,
        effect_size: effectSize ?? null,
        sample_size: sampleSize ?? null,
        direction: request.direction ?? 'TWO_SIDED',
        configuration: config,
        computed: {
          required_sample_size: computedOutput.required_sample_size,
          statistical_sample_size: computedOutput.statistical_sample_size,
          attrition_adjusted_sample_size: computedOutput.attrition_adjusted_sample_size,
          achieved_power: computedOutput.achieved_power,
          minimum_detectable_effect: computedOutput.minimum_detectable_effect,
          group_sample_sizes: computedOutput.group_sample_sizes,
          sensitivity_results: sensitivityResults
        },
        engine_version: engineVersion
      };

      const provenanceHash = computeProvenanceHash(provenancePayload);

      return createPowerResult({
        power_analysis_id: request.power_analysis_id,
        analysis_type: request.analysis_type,
        calculation_mode: mode,
        status: 'COMPLETED',
        alpha,
        target_power: targetPower ?? null,
        effect_size: effectSize ?? null,
        effect_size_type: request.effect_size_type ?? null,
        sample_size: sampleSize ?? null,
        required_sample_size: computedOutput.required_sample_size,
        achieved_power: computedOutput.achieved_power,
        minimum_detectable_effect: computedOutput.minimum_detectable_effect,
        statistical_sample_size: computedOutput.statistical_sample_size,
        attrition_adjusted_sample_size: computedOutput.attrition_adjusted_sample_size,
        group_sample_sizes: computedOutput.group_sample_sizes,
        sensitivity_results: sensitivityResults,
        assumptions: computedOutput.assumptions,
        warnings: computedOutput.warnings,
        numerical_status: 'SUCCESS',
        provenance_hash: provenanceHash,
        default_applied: defaultApplied,
        executed_at: executedAt,
        engine_version: engineVersion
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      return createPowerResult({
        power_analysis_id: request.power_analysis_id,
        analysis_type: request.analysis_type,
        calculation_mode: mode,
        status: 'NUMERICAL_ERROR',
        alpha,
        target_power: targetPower ?? null,
        effect_size: effectSize ?? null,
        effect_size_type: request.effect_size_type ?? null,
        sample_size: sampleSize ?? null,
        required_sample_size: null,
        achieved_power: null,
        minimum_detectable_effect: null,
        statistical_sample_size: null,
        attrition_adjusted_sample_size: null,
        group_sample_sizes: null,
        sensitivity_results: null,
        assumptions: [],
        warnings: [errorMessage],
        numerical_status: 'NUMERICAL_ERROR',
        provenance_hash: '',
        default_applied: defaultApplied,
        executed_at: executedAt,
        engine_version: engineVersion
      });
    }
  }
}
