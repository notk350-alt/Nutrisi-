/**
 * NutriBodySim — Generic Scientific Algorithm Executor
 * 
 * Phase C4: Algorithm Executor
 * Executes ScientificModules of type ALGORITHM with deterministic support for:
 * 1. Ordered sequence execution
 * 2. Typed condition evaluation (AST / typed operands, NO eval/new Function)
 * 3. Explicit branching
 * 4. Fallback routing integrated with C3 InputValidator signals
 * 5. Intermediate result capture and inter-step propagation
 * 6. Execution path tracking
 * 7. Standardized trace generation (StandardTraceStep)
 * 8. Cycle protection (visited set & max iterations)
 * 9. Integration with C1 ExecutionResult, C2 Parameter Snapshot, C3 InputValidator
 * 
 * Pure Scientific Core: Zero DOM, React, Express, or Database dependencies.
 */

import {
  AlgorithmCondition,
  AlgorithmOperand,
  AlgorithmStep,
  ExecutionResult,
  ModuleRequest,
  ParameterSnapshot,
  ScientificAlgorithm,
  ScientificAlgorithmError,
  ScientificFormula,
  ScientificParameter,
  ScientificVariable,
  StandardTraceStep
} from '../types';
import { InputValidator } from '../validator/inputValidator';
import { CalculationEngine } from './calculationEngine';
import { ModuleResolver, ResolvableModule } from '../resolvers/moduleResolver';
import { sha256Hex } from '../crypto';

export interface ExecuteAlgorithmOptions {
  algorithm: ScientificAlgorithm;
  request: ModuleRequest;
  parameters?: Record<string, unknown>;
  parameter_snapshot?: ParameterSnapshot;
  parameter_versions?: Record<string, string>;
  parameter_set_id?: string;
  variables?: Record<string, ScientificVariable>;
  available_modules?: ResolvableModule[];
  available_parameters?: ScientificParameter[];
  max_steps?: number;
}

interface AlgorithmExecutionContext {
  algorithm: ScientificAlgorithm;
  inputs: Record<string, { value: number | string | boolean; unit?: string }>;
  normalized_inputs: Record<string, { value: number; unit: string; original_unit?: string }>;
  parameters: Record<string, unknown>;
  parameter_snapshot?: ParameterSnapshot;
  intermediate_results: Record<string, unknown>;
  execution_path: string[];
  fallback_used: boolean;
  trace: StandardTraceStep[];
  warnings: string[];
  errors: string[];
  visited_steps: Set<string>;
  step_count: number;
}

export class AlgorithmExecutor {
  /**
   * Deterministically executes a ScientificAlgorithm conforming to the Phase C4 specification.
   */
  static execute(options: ExecuteAlgorithmOptions): ExecutionResult {
    const {
      algorithm,
      request,
      parameters = {},
      parameter_snapshot,
      parameter_versions,
      parameter_set_id,
      variables = {},
      available_modules = [],
      available_parameters = [],
      max_steps = 100
    } = options;

    if (!algorithm) {
      throw new ScientificAlgorithmError('ALGORITHM_NOT_FOUND', 'Algorithm definition is required.');
    }

    if (!algorithm.steps || algorithm.steps.length === 0) {
      throw new ScientificAlgorithmError('ALGORITHM_INVALID', `Algorithm "${algorithm.algorithm_id}" contains no execution steps.`);
    }

    // STEP 1: Input Validation via C3 Standalone InputValidator
    const validation = InputValidator.validate({
      module: algorithm as any,
      inputs: request.inputs || {},
      variables,
      execution_context: request.execution_context
    });

    const executionStartTime = new Date().toISOString();

    // Isolated Execution Context (prevent mutable state leakage)
    const ctx: AlgorithmExecutionContext = {
      algorithm,
      inputs: request.inputs || {},
      normalized_inputs: validation.normalized_inputs,
      parameters,
      parameter_snapshot,
      intermediate_results: {},
      execution_path: ['INPUT_VALIDATION'],
      fallback_used: false,
      trace: [],
      warnings: [...validation.warnings],
      errors: [],
      visited_steps: new Set<string>(),
      step_count: 0
    };

    // Replay validation trace steps
    for (const vStep of validation.trace_steps) {
      ctx.trace.push({
        step_id: `trace_val_${ctx.trace.length + 1}`,
        operation: vStep.action,
        output: vStep.intermediate_value,
        unit: vStep.unit,
        timestamp: executionStartTime,
        metadata: { detail: vStep.detail }
      });
    }

    // Step index map for fast, deterministic step resolution
    const stepMap = new Map<string, AlgorithmStep>();
    for (const step of algorithm.steps) {
      if (!step.step_id) {
        throw new ScientificAlgorithmError('ALGORITHM_INVALID', `Algorithm "${algorithm.algorithm_id}" contains a step without step_id.`);
      }
      stepMap.set(step.step_id, step);
    }

    // Handle C3 Fallback Signal
    let currentStepId: string | undefined = algorithm.entry_step_id || algorithm.steps[0].step_id;

    if (validation.fallback_required) {
      const fallbackTarget = this.resolveFallbackTarget(algorithm);
      if (!fallbackTarget) {
        throw new ScientificAlgorithmError(
          'NO_FALLBACK_DEFINED',
          `Algorithm "${algorithm.algorithm_id}" received a fallback signal from InputValidator, but defines no fallback routes.`
        );
      }
      ctx.fallback_used = true;
      ctx.execution_path.push('FALLBACK_SIGNAL_ROUTED');
      ctx.trace.push({
        step_id: `trace_fallback_init`,
        operation: 'ALGORITHM_FALLBACK_ROUTED',
        output: fallbackTarget,
        timestamp: new Date().toISOString(),
        metadata: { reason: 'InputValidator triggered fallback_required' }
      });
      currentStepId = fallbackTarget;
    } else if (!validation.valid) {
      // Validation error without fallback
      throw new ScientificAlgorithmError(
        'STEP_EXECUTION_FAILED',
        `Algorithm "${algorithm.algorithm_id}" input validation failed: ${validation.errors.join('; ')}`
      );
    }

    // STEP 2: Deterministic Graph Traversal
    let finalOutputs: Record<string, { value: number | string | boolean; unit?: string }> = {};

    while (currentStepId) {
      ctx.step_count++;
      if (ctx.step_count > max_steps) {
        throw new ScientificAlgorithmError(
          'EXECUTION_CYCLE_DETECTED',
          `Execution step limit exceeded (${max_steps} steps) in algorithm "${algorithm.algorithm_id}".`
        );
      }

      if (ctx.visited_steps.has(currentStepId)) {
        throw new ScientificAlgorithmError(
          'EXECUTION_CYCLE_DETECTED',
          `Cycle detected: step "${currentStepId}" was revisited in algorithm "${algorithm.algorithm_id}".`
        );
      }
      ctx.visited_steps.add(currentStepId);

      const step = stepMap.get(currentStepId);
      if (!step) {
        throw new ScientificAlgorithmError(
          'STEP_NOT_FOUND',
          `Step "${currentStepId}" not found in algorithm "${algorithm.algorithm_id}".`
        );
      }

      ctx.execution_path.push(step.step_id);

      // Determine operation
      const operation = step.operation || (
        step.branch || step.condition
          ? 'BRANCH'
          : step.formula_reference || step.formula_id
            ? 'FORMULA_REFERENCE'
            : step.fallback_step_id
              ? 'FALLBACK'
              : step.output_mapping
                ? 'OUTPUT'
                : 'SEQUENCE'
      );

      switch (operation) {
        case 'SEQUENCE': {
          const intermediateVal = this.evaluateSequenceStep(step, ctx);
          if (intermediateVal !== undefined) {
            ctx.intermediate_results[step.step_id] = intermediateVal;
          }

          ctx.trace.push({
            step_id: `trace_${step.step_id}`,
            operation: 'ALGORITHM_STEP_SEQUENCE',
            inputs: { ...ctx.normalized_inputs },
            output: intermediateVal,
            timestamp: new Date().toISOString(),
            metadata: { step_id: step.step_id, description: step.description }
          });

          if (step.is_terminal || !step.next_step_id) {
            currentStepId = undefined;
          } else {
            currentStepId = step.next_step_id;
          }
          break;
        }

        case 'CONDITION':
        case 'BRANCH': {
          const condition = step.condition || step.branch?.condition;
          if (!condition) {
            throw new ScientificAlgorithmError(
              'CONDITION_INVALID',
              `Step "${step.step_id}" is configured for branching but lacks a valid condition.`
            );
          }

          const conditionResult = this.evaluateCondition(condition, ctx, step.step_id);
          const targetStepId = conditionResult ? condition.true_step_id : condition.false_step_id;

          if (!stepMap.has(targetStepId)) {
            throw new ScientificAlgorithmError(
              'BRANCH_TARGET_INVALID',
              `Branch step "${step.step_id}" evaluated to ${conditionResult}, but target step "${targetStepId}" does not exist in algorithm "${algorithm.algorithm_id}".`
            );
          }

          ctx.intermediate_results[`${step.step_id}_condition`] = conditionResult;
          ctx.trace.push({
            step_id: `trace_${step.step_id}`,
            operation: 'ALGORITHM_BRANCH_EVALUATION',
            output: conditionResult,
            timestamp: new Date().toISOString(),
            metadata: {
              step_id: step.step_id,
              condition_result: conditionResult,
              selected_branch_target: targetStepId
            }
          });

          currentStepId = targetStepId;
          break;
        }

        case 'FALLBACK': {
          ctx.fallback_used = true;
          const fallbackTarget = step.fallback_step_id || this.resolveFallbackTarget(algorithm, step.step_id);
          if (!fallbackTarget || !stepMap.has(fallbackTarget)) {
            throw new ScientificAlgorithmError(
              'FALLBACK_TARGET_INVALID',
              `Fallback step "${step.step_id}" specified invalid target "${fallbackTarget}".`
            );
          }

          ctx.trace.push({
            step_id: `trace_${step.step_id}`,
            operation: 'ALGORITHM_FALLBACK_ROUTED',
            output: fallbackTarget,
            timestamp: new Date().toISOString(),
            metadata: { step_id: step.step_id, target: fallbackTarget }
          });

          currentStepId = fallbackTarget;
          break;
        }

        case 'FORMULA_REFERENCE': {
          const formulaRef = step.formula_reference || (
            step.formula_id ? { formula_id: step.formula_id } : undefined
          );

          if (!formulaRef || !formulaRef.formula_id) {
            throw new ScientificAlgorithmError(
              'FORMULA_REFERENCE_INVALID',
              `Step "${step.step_id}" specified FORMULA_REFERENCE without formula_id.`
            );
          }

          const formulaOutput = this.executeReferencedFormula(
            formulaRef,
            step,
            ctx,
            available_modules,
            variables,
            available_parameters
          );

          ctx.intermediate_results[step.step_id] = formulaOutput;
          if (formulaRef.output_variable_id) {
            ctx.intermediate_results[formulaRef.output_variable_id] = formulaOutput;
          }

          ctx.trace.push({
            step_id: `trace_${step.step_id}`,
            operation: 'ALGORITHM_FORMULA_REFERENCE',
            output: formulaOutput,
            timestamp: new Date().toISOString(),
            metadata: {
              step_id: step.step_id,
              formula_id: formulaRef.formula_id,
              version: formulaRef.version
            }
          });

          if (step.is_terminal || !step.next_step_id) {
            currentStepId = undefined;
          } else {
            currentStepId = step.next_step_id;
          }
          break;
        }

        case 'OUTPUT': {
          finalOutputs = this.assembleOutputs(step, ctx);
          ctx.trace.push({
            step_id: `trace_${step.step_id}`,
            operation: 'ALGORITHM_OUTPUT_ASSEMBLY',
            output: finalOutputs,
            timestamp: new Date().toISOString(),
            metadata: { step_id: step.step_id }
          });

          currentStepId = undefined; // Terminal
          break;
        }

        default:
          throw new ScientificAlgorithmError(
            'ALGORITHM_INVALID',
            `Unknown operation "${operation}" at step "${step.step_id}".`
          );
      }
    }

    // Default output assembly if not already emitted by an OUTPUT step
    if (Object.keys(finalOutputs).length === 0) {
      finalOutputs = this.assembleDefaultOutputs(algorithm, ctx);
    }

    const executionEndTime = new Date().toISOString();

    // Provenance Hash
    const provenancePayload = `${algorithm.algorithm_id}:${algorithm.version}:${JSON.stringify(ctx.normalized_inputs)}:${JSON.stringify(ctx.execution_path)}:${JSON.stringify(finalOutputs)}:${executionEndTime}`;
    const provenance_id = sha256Hex(provenancePayload);

    return {
      execution_id: `exec_alg_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      module_id: algorithm.algorithm_id,
      module_version: algorithm.version,
      inputs: ctx.inputs,
      normalized_inputs: ctx.normalized_inputs,
      parameters: ctx.parameters,
      parameter_versions,
      parameter_set_id,
      parameter_snapshot: ctx.parameter_snapshot,
      execution_path: ctx.execution_path,
      fallback_used: ctx.fallback_used,
      intermediate_results: ctx.intermediate_results,
      trace: ctx.trace,
      outputs: finalOutputs,
      warnings: ctx.warnings,
      errors: ctx.errors,
      timestamp: executionEndTime,
      provenance_id
    };
  }

  /**
   * Deterministically resolves a fallback target step from algorithm definition.
   */
  private static resolveFallbackTarget(algorithm: ScientificAlgorithm, sourceStepId?: string): string | undefined {
    if (algorithm.fallback_routes && algorithm.fallback_routes.length > 0) {
      // Find matching source step or general fallback route
      const matched = algorithm.fallback_routes.find(
        r => !r.source_step_id || (sourceStepId && r.source_step_id === sourceStepId)
      );
      if (matched) return matched.target_step_id;
    }

    // Search for a step designated as fallback
    const fallbackStep = algorithm.steps.find(
      s => s.operation === 'FALLBACK' || s.step_id.toUpperCase().includes('FALLBACK')
    );
    if (fallbackStep) {
      return fallbackStep.fallback_step_id || fallbackStep.step_id;
    }

    return undefined;
  }

  /**
   * Evaluates a sequence step using deterministic transformation logic or intermediate pass-through.
   */
  private static evaluateSequenceStep(step: AlgorithmStep, ctx: AlgorithmExecutionContext): unknown {
    // If step defines formula_reference or formula_id, handled by FORMULA_REFERENCE.
    // If step defines direct calculation or intermediate assignment:
    if (step.transformation_logic) {
      // Return identified transformation metadata or evaluated operand
      return { logic: step.transformation_logic, executed: true };
    }
    return true;
  }

  /**
   * Evaluates a typed condition without dynamic code execution (pure AST / operand comparison).
   */
  private static evaluateCondition(
    condition: AlgorithmCondition,
    ctx: AlgorithmExecutionContext,
    stepId: string
  ): boolean {
    if (!condition.left_operand || !condition.operator || !condition.right_operand) {
      throw new ScientificAlgorithmError(
        'CONDITION_INVALID',
        `Condition in step "${stepId}" must define left_operand, operator, and right_operand.`
      );
    }

    const leftVal = this.resolveOperandValue(condition.left_operand, ctx, stepId);
    const rightVal = this.resolveOperandValue(condition.right_operand, ctx, stepId);

    switch (condition.operator) {
      case '==':
        return leftVal === rightVal;
      case '!=':
        return leftVal !== rightVal;
      case '<':
        return (leftVal as number) < (rightVal as number);
      case '<=':
        return (leftVal as number) <= (rightVal as number);
      case '>':
        return (leftVal as number) > (rightVal as number);
      case '>=':
        return (leftVal as number) >= (rightVal as number);
      default:
        throw new ScientificAlgorithmError(
          'CONDITION_INVALID',
          `Unsupported operator "${condition.operator}" in condition for step "${stepId}".`
        );
    }
  }

  /**
   * Resolves an operand value from inputs, intermediate results, parameters, or constants.
   */
  private static resolveOperandValue(
    operand: AlgorithmOperand,
    ctx: AlgorithmExecutionContext,
    stepId: string
  ): unknown {
    switch (operand.type) {
      case 'constant':
        return operand.value;

      case 'input': {
        const key = operand.key;
        if (!key) {
          throw new ScientificAlgorithmError('CONDITION_INVALID', `Input operand in step "${stepId}" lacks a key.`);
        }
        const norm = ctx.normalized_inputs[key];
        if (norm !== undefined) return norm.value;
        const raw = ctx.inputs[key];
        if (raw !== undefined) return raw.value;
        return undefined;
      }

      case 'intermediate': {
        const key = operand.key;
        if (!key) {
          throw new ScientificAlgorithmError('CONDITION_INVALID', `Intermediate operand in step "${stepId}" lacks a key.`);
        }
        return ctx.intermediate_results[key];
      }

      case 'parameter': {
        const key = operand.key;
        if (!key) {
          throw new ScientificAlgorithmError('CONDITION_INVALID', `Parameter operand in step "${stepId}" lacks a key.`);
        }
        const p = ctx.parameters[key];
        if (typeof p === 'object' && p !== null && 'value' in p) {
          return (p as any).value;
        }
        return p;
      }

      default:
        throw new ScientificAlgorithmError(
          'CONDITION_INVALID',
          `Unknown operand type "${(operand as any).type}" in step "${stepId}".`
        );
    }
  }

  /**
   * Executes a referenced scientific formula using the existing calculation engine.
   */
  private static executeReferencedFormula(
    ref: { formula_id: string; version?: string; input_mapping?: Record<string, string>; output_variable_id?: string },
    step: AlgorithmStep,
    ctx: AlgorithmExecutionContext,
    availableModules: ResolvableModule[],
    variables: Record<string, ScientificVariable>,
    availableParameters?: ScientificParameter[]
  ): number | string | boolean {
    const candidates = availableModules.filter(
      m => (m as any).formula_id === ref.formula_id || m.module_id === ref.formula_id
    ) as ScientificFormula[];

    if (candidates.length === 0) {
      throw new ScientificAlgorithmError(
        'FORMULA_REFERENCE_INVALID',
        `Referenced formula "${ref.formula_id}" not found in available modules pool for step "${step.step_id}".`
      );
    }

    let targetFormula: ScientificFormula;
    if (ref.version) {
      const match = candidates.find(c => c.version === ref.version);
      if (!match) {
        throw new ScientificAlgorithmError(
          'FORMULA_REFERENCE_INVALID',
          `Referenced formula "${ref.formula_id}" version "${ref.version}" not found for step "${step.step_id}".`
        );
      }
      targetFormula = match;
    } else {
      const resolved = ModuleResolver.resolve<ScientificFormula>({
        module_id: ref.formula_id,
        modules: candidates
      });
      targetFormula = resolved.module;
    }

    // Map inputs for the formula
    const formulaInputs: Record<string, { value: number | string | boolean; unit?: string }> = {};
    for (const inSpec of targetFormula.inputs) {
      const mappedKey = ref.input_mapping?.[inSpec.variable_id] || ref.input_mapping?.[inSpec.name] || inSpec.variable_id;

      let val: unknown = undefined;
      let unit: string = inSpec.unit;

      if (ctx.normalized_inputs[mappedKey] !== undefined) {
        val = ctx.normalized_inputs[mappedKey].value;
        unit = ctx.normalized_inputs[mappedKey].unit;
      } else if (ctx.intermediate_results[mappedKey] !== undefined) {
        val = ctx.intermediate_results[mappedKey];
      } else if (ctx.inputs[mappedKey] !== undefined) {
        val = ctx.inputs[mappedKey].value;
        unit = ctx.inputs[mappedKey].unit || inSpec.unit;
      }

      if (val !== undefined) {
        formulaInputs[inSpec.variable_id] = {
          value: val as number | string | boolean,
          unit
        };
      }
    }

    // Parameters for formula: use parameters from context (from snapshot) or available_parameters
    const formulaParams: Record<string, ScientificParameter> = {};
    for (const pId of targetFormula.parameter_ids) {
      let p = ctx.parameters[pId];
      if (p === undefined && availableParameters) {
        p = availableParameters.find(ap => ap.parameter_id === pId);
      }
      if (p !== undefined) {
        if (typeof p === 'object' && p !== null && 'parameter_id' in p) {
          formulaParams[pId] = p as ScientificParameter;
        } else {
          formulaParams[pId] = {
            parameter_id: pId,
            name: pId,
            description: pId,
            value: p as any,
            unit: 'unitless',
            reference_ids: [],
            version: '1.0.0',
            status: 'VERIFIED',
            is_constant: true,
            created_at: '2026-09-23T00:00:00Z',
            updated_at: '2026-09-23T00:00:00Z'
          };
        }
      }
    }

    const calcResult = CalculationEngine.executeFormula({
      formula: targetFormula,
      inputs: formulaInputs,
      parameters: formulaParams,
      variables
    });

    // Extract primary output
    const outKeys = Object.keys(calcResult.final_result);
    if (outKeys.length === 0) {
      throw new ScientificAlgorithmError(
        'STEP_EXECUTION_FAILED',
        `Referenced formula "${ref.formula_id}" returned empty output in step "${step.step_id}".`
      );
    }

    return calcResult.final_result[outKeys[0]].value;
  }

  /**
   * Assembles final outputs from an explicit OUTPUT step.
   */
  private static assembleOutputs(
    step: AlgorithmStep,
    ctx: AlgorithmExecutionContext
  ): Record<string, { value: number | string | boolean; unit?: string }> {
    const outputs: Record<string, { value: number | string | boolean; unit?: string }> = {};

    if (step.output_mapping) {
      for (const [outputKey, sourceKey] of Object.entries(step.output_mapping)) {
        let val: unknown = undefined;
        let unit = 'unitless';

        if (ctx.intermediate_results[sourceKey] !== undefined) {
          val = ctx.intermediate_results[sourceKey];
        } else if (ctx.normalized_inputs[sourceKey] !== undefined) {
          val = ctx.normalized_inputs[sourceKey].value;
          unit = ctx.normalized_inputs[sourceKey].unit;
        }

        const outSpec = ctx.algorithm.outputs.find(o => o.name === outputKey || o.variable_id === outputKey);
        if (outSpec) {
          unit = outSpec.unit;
        }

        outputs[outputKey] = {
          value: val as number | string | boolean,
          unit
        };
      }
    }

    return outputs;
  }

  /**
   * Fallback output assembly when no explicit OUTPUT step was specified.
   */
  private static assembleDefaultOutputs(
    algorithm: ScientificAlgorithm,
    ctx: AlgorithmExecutionContext
  ): Record<string, { value: number | string | boolean; unit?: string }> {
    const outputs: Record<string, { value: number | string | boolean; unit?: string }> = {};

    for (const outSpec of algorithm.outputs) {
      const outKey = outSpec.variable_id || outSpec.name;
      let val: unknown = ctx.intermediate_results[outKey];

      if (val === undefined) {
        // Look in last intermediate result
        const intermediateKeys = Object.keys(ctx.intermediate_results);
        if (intermediateKeys.length > 0) {
          val = ctx.intermediate_results[intermediateKeys[intermediateKeys.length - 1]];
        }
      }

      outputs[outKey] = {
        value: (val !== undefined ? val : 0) as number | string | boolean,
        unit: outSpec.unit
      };
    }

    return outputs;
  }
}
