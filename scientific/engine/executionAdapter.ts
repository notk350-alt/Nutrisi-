/**
 * NutriBodySim — Scientific Execution Engine Adapter
 * 
 * Phase C1: Execution Contract Foundation
 * Adapts legacy CalculationTrace and AST execution outputs to the standardized
 * Phase C contracts (ModuleRequest -> ExecutionResult) with zero regressions,
 * preserving existing numerical outputs, parameter handling, and AST semantics.
 * 
 * Pure Scientific Core component: Zero dependencies on DOM, React, Express, or Database.
 */

import {
  CalculationTrace,
  TraceStep,
  ModuleRequest,
  StandardTraceStep,
  ExecutionResult,
  ScientificFormula,
  ScientificAlgorithm,
  ScientificModel,
  ScientificParameter,
  ScientificVariable,
  ParameterSet,
  ParameterSnapshot,
  ScientificResolverError
} from '../types';
import { CalculationEngine } from './calculationEngine';
import { AlgorithmExecutor } from './algorithmExecutor';
import { ModelExecutor } from './modelExecutor';
import { ModuleResolver, ResolvedModule, ResolvableModule } from '../resolvers/moduleResolver';
import { ParameterResolver, ResolvedParameters, snapshotToScientificParameters } from '../resolvers/parameterResolver';

/**
 * Adapts an internal AST TraceStep to the standardized Phase C StandardTraceStep contract.
 * Preserves all underlying details in structured metadata.
 */
export function adaptTraceStepToStandard(step: TraceStep, index?: number): StandardTraceStep {
  const stepNumber = step.step ?? (index !== undefined ? index + 1 : 1);
  const operation = step.action || 'OPERATION';
  const step_id = `STEP_${stepNumber}_${operation.toLowerCase().replace(/[^a-z0-9_]/g, '_')}`;

  const traceStep: StandardTraceStep = {
    step_id,
    operation,
    timestamp: step.timestamp || new Date().toISOString()
  };

  if (step.intermediate_value !== undefined && step.intermediate_value !== null) {
    traceStep.output = step.intermediate_value;
  }

  if (step.unit) {
    traceStep.unit = step.unit;
  }

  if (step.detail) {
    traceStep.metadata = {
      step_number: stepNumber,
      detail: step.detail
    };
  }

  return traceStep;
}

export interface ExecutionResultResolutionMeta {
  parameter_set_id?: string;
  parameter_versions?: Record<string, string>;
  parameter_snapshot?: ParameterSnapshot;
  resolved_module_version?: string;
}

/**
 * Adapts a CalculationTrace produced by CalculationEngine into a formal ExecutionResult.
 * Accurately surfaces warnings, separates errors, maps intermediate artifacts, and preserves provenance.
 */
export function adaptCalculationTraceToExecutionResult(
  trace: CalculationTrace,
  request?: Partial<ModuleRequest>,
  meta?: ExecutionResultResolutionMeta
): ExecutionResult {
  const warnings: string[] = [];
  const intermediate_results: Record<string, unknown> = {};

  for (const step of trace.steps || []) {
    if (step.action === 'RANGE_WARNING' || step.action.includes('WARNING')) {
      warnings.push(step.detail);
    }
    if (step.intermediate_value !== undefined && step.intermediate_value !== null) {
      const stepKey = `step_${step.step}_${step.action.toLowerCase().replace(/[^a-z0-9_]/g, '_')}`;
      intermediate_results[stepKey] = step.intermediate_value;
    }
  }

  // Parameter versions and raw values
  const parameter_versions: Record<string, string> = { ...(meta?.parameter_versions || {}) };
  const rawParams: Record<string, unknown> = {};
  for (const [pId, pObj] of Object.entries(trace.parameters_resolved || {})) {
    rawParams[pId] = pObj.value;
    if (!parameter_versions[pId]) {
      parameter_versions[pId] = '1.0.0';
    }
  }

  // Convert trace steps to standardized contract
  const standardTrace: StandardTraceStep[] = (trace.steps || []).map((st, idx) =>
    adaptTraceStepToStandard(st, idx)
  );

  // Distinct execution path phases from trace
  const execution_path: string[] = Array.from(
    new Set((trace.steps || []).map(s => s.action))
  );

  // Preserve original inputs
  const originalInputs: Record<string, { value: number | string | boolean; unit?: string }> = {};
  if (request?.inputs) {
    Object.assign(originalInputs, request.inputs);
  } else if (trace.inputs_received) {
    for (const [k, v] of Object.entries(trace.inputs_received)) {
      originalInputs[k] = { value: v.value, unit: v.unit };
    }
  }

  // Preserve outputs
  const outputs: Record<string, { value: number | string | boolean; unit?: string }> = {};
  for (const [k, v] of Object.entries(trace.final_result || {})) {
    outputs[k] = { value: v.value, unit: v.unit };
  }

  return {
    execution_id: trace.calculation_id,
    module_id: trace.formula_or_model_id,
    module_version: meta?.resolved_module_version || trace.version || '1.0.0',
    inputs: originalInputs,
    normalized_inputs: trace.normalized_inputs || {},
    parameters: rawParams,
    parameter_versions: Object.keys(parameter_versions).length > 0 ? parameter_versions : undefined,
    parameter_set_id: meta?.parameter_set_id || request?.parameter_set_id,
    parameter_snapshot: meta?.parameter_snapshot,
    execution_path,
    fallback_used: false,
    intermediate_results,
    trace: standardTrace,
    outputs,
    warnings,
    errors: [],
    validation: {
      status: 'UNVALIDATED',
      message: 'Runtime ValidationEngine not yet active in Phase C1/C2'
    },
    timestamp: trace.created_at || new Date().toISOString(),
    provenance_id: trace.provenance_hash || undefined
  };
}

export interface ExecuteModulePipelineOptions {
  available_modules?: ResolvableModule[];
  available_parameters?: ScientificParameter[];
  available_parameter_sets?: ParameterSet[];
  parameter_overrides?: Record<string, number | string | boolean | number[]>;
  parameter_snapshot?: ParameterSnapshot;
  execution_id?: string;
}

/**
 * High-level execution entry point conforming to the target Phase C architecture:
 * ModuleRequest -> Module Resolver -> Parameter Resolver -> Scientific Execution -> ExecutionResult
 * 
 * Preserves 100% of backward compatibility with direct formula/parameter calls.
 */
export function executeModuleRequest(
  request: ModuleRequest,
  module?: ResolvableModule,
  parameters: Record<string, ScientificParameter> = {},
  variables: Record<string, ScientificVariable> = {},
  options?: ExecuteModulePipelineOptions
): ExecutionResult {
  if (!request.module_id) {
    throw new ScientificResolverError('MODULE_NOT_FOUND', 'ModuleRequest Error: "module_id" is required.');
  }

  let resolvedTargetModule: ResolvableModule;
  let resolvedModuleMeta: ResolvedModule | undefined;

  if (module) {
    // Direct module provided (backward compatibility)
    const modId = (module as any).formula_id || (module as any).algorithm_id || module.module_id;
    if (request.module_id !== modId) {
      throw new Error(
        `Module Mismatch: Request module_id "${request.module_id}" does not match target module "${modId}".`
      );
    }

    if (request.requested_version && module.version !== request.requested_version) {
      throw new ScientificResolverError(
        'MODULE_VERSION_NOT_FOUND',
        `Requested version "${request.requested_version}" does not match module version "${module.version}".`
      );
    }

    resolvedTargetModule = module;
  } else if (options?.available_modules) {
    // Resolve module dynamically via ModuleResolver
    resolvedModuleMeta = ModuleResolver.resolve({
      module_id: request.module_id,
      requested_version: request.requested_version,
      execution_context: request.execution_context,
      modules: options.available_modules
    });
    resolvedTargetModule = resolvedModuleMeta.module;
  } else {
    throw new ScientificResolverError(
      'MODULE_NOT_FOUND',
      `Cannot execute module "${request.module_id}": neither direct module nor available_modules registry provided.`
    );
  }

  // Resolve parameters
  let effectiveParameters: Record<string, ScientificParameter> = { ...parameters };
  let resolvedParamsMeta: ResolvedParameters | undefined;

  if (options?.parameter_snapshot) {
    effectiveParameters = snapshotToScientificParameters(options.parameter_snapshot);
  } else if (options?.available_parameters && options.available_parameters.length > 0) {
    resolvedParamsMeta = ParameterResolver.resolve({
      module: resolvedTargetModule as any,
      parameter_set_id: request.parameter_set_id,
      parameter_overrides: options.parameter_overrides,
      execution_context: request.execution_context,
      available_parameters: options.available_parameters,
      available_parameter_sets: options.available_parameter_sets
    });
    effectiveParameters = snapshotToScientificParameters(resolvedParamsMeta.snapshot);
  } else if (request.parameter_set_id && options?.available_parameter_sets) {
    resolvedParamsMeta = ParameterResolver.resolve({
      module: resolvedTargetModule as any,
      parameter_set_id: request.parameter_set_id,
      parameter_overrides: options?.parameter_overrides,
      execution_context: request.execution_context,
      available_parameters: Object.values(parameters),
      available_parameter_sets: options.available_parameter_sets
    });
    effectiveParameters = snapshotToScientificParameters(resolvedParamsMeta.snapshot);
  }

  const effectiveSnapshot = options?.parameter_snapshot || resolvedParamsMeta?.snapshot;

  const isModel = (resolvedTargetModule as any).model_id !== undefined ||
    ((resolvedTargetModule as any).states !== undefined && Array.isArray((resolvedTargetModule as any).states));

  if (isModel) {
    return ModelExecutor.execute({
      model: resolvedTargetModule as ScientificModel,
      request,
      parameters: effectiveParameters,
      parameter_snapshot: effectiveSnapshot,
      parameter_versions: resolvedParamsMeta?.parameter_versions,
      parameter_set_id: resolvedParamsMeta?.parameter_set_id || request.parameter_set_id,
      variables,
      available_modules: options?.available_modules,
      available_parameters: options?.available_parameters
    });
  }

  const isAlgorithm = (resolvedTargetModule as any).algorithm_id !== undefined ||
    ((resolvedTargetModule as any).steps !== undefined && !(resolvedTargetModule as any).ast);

  if (isAlgorithm) {
    return AlgorithmExecutor.execute({
      algorithm: resolvedTargetModule as ScientificAlgorithm,
      request,
      parameters: effectiveParameters,
      parameter_snapshot: effectiveSnapshot,
      parameter_versions: resolvedParamsMeta?.parameter_versions,
      parameter_set_id: resolvedParamsMeta?.parameter_set_id || request.parameter_set_id,
      variables,
      available_modules: options?.available_modules,
      available_parameters: options?.available_parameters
    });
  }

  // Execute using deterministic AST CalculationEngine
  const calcTrace = CalculationEngine.executeFormula({
    formula: resolvedTargetModule as ScientificFormula,
    inputs: request.inputs,
    parameters: effectiveParameters,
    variables
  });

  // Adapt to standardized ExecutionResult
  return adaptCalculationTraceToExecutionResult(calcTrace, request, {
    parameter_set_id: resolvedParamsMeta?.parameter_set_id || request.parameter_set_id,
    parameter_versions: resolvedParamsMeta?.parameter_versions,
    parameter_snapshot: effectiveSnapshot,
    resolved_module_version: resolvedModuleMeta?.module_version || resolvedTargetModule.version
  });
}
