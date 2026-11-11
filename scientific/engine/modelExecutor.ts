/**
 * NutriBodySim — Scientific Dynamical Model Executor
 * 
 * Phase C5: Model Executor
 * Deterministic discrete-time stateful simulation engine for ScientificModule of type MODEL.
 * Evaluates state trajectories X(t + dt) = F(X(t), U(t), θ) over discrete steps.
 * 
 * Pure Scientific Core component: Zero dependencies on DOM, React, Express, or Database.
 * Security: Pure deterministic AST evaluation. Zero eval(), zero new Function().
 */

import { sha256Hex } from '../crypto';
import {
  ASTNode,
  ExecutionResult,
  FormulaInputSpec,
  ModelStateHistoryEntry,
  ModelStateVariable,
  ModelTimeConfig,
  ModelTransitionDefinition,
  ModuleRequest,
  ParameterSnapshot,
  ParameterSnapshotEntry,
  ScientificFormula,
  ScientificAlgorithm,
  ScientificModel,
  ScientificModelError,
  ScientificParameter,
  ScientificVariable,
  StandardTraceStep
} from '../types';
import { InputValidator } from '../validator/inputValidator';

export interface ExecuteModelOptions {
  model: ScientificModel;
  request: ModuleRequest;
  parameters?: Record<string, ScientificParameter>;
  parameter_snapshot?: ParameterSnapshot;
  parameter_versions?: Record<string, string>;
  parameter_set_id?: string;
  variables?: Record<string, ScientificVariable>;
  available_modules?: Array<ScientificFormula | ScientificAlgorithm | ScientificModel>;
  available_parameters?: ScientificParameter[];
}

export class ModelExecutor {
  /**
   * Deterministically executes a ScientificModel across configured discrete time steps.
   */
  static execute(options: ExecuteModelOptions): ExecutionResult {
    const {
      model,
      request,
      parameters = {},
      parameter_snapshot,
      parameter_versions,
      parameter_set_id,
      variables = {}
    } = options;

    // 1. MODEL INTEGRITY CHECK
    if (!model || typeof model !== 'object') {
      throw new ScientificModelError('MODEL_NOT_FOUND', 'Model definition is undefined or invalid.');
    }

    const modelId = model.model_id || model.module_id;
    if (!modelId) {
      throw new ScientificModelError('MODEL_INVALID', 'ScientificModel is missing a required model_id.');
    }

    if (!model.states || !Array.isArray(model.states) || model.states.length === 0) {
      throw new ScientificModelError('MODEL_INVALID', `ScientificModel "${modelId}" does not define any state variables.`);
    }

    // 2. TIME / STEP CONFIGURATION RESOLUTION & VALIDATION
    const config = request.configuration || {};
    const timeConfig: Partial<ModelTimeConfig> = model.time_config || {};

    const rawStartTime = config.start_time !== undefined ? config.start_time : (timeConfig.start_time !== undefined ? timeConfig.start_time : 0);
    const rawDt = config.dt !== undefined ? config.dt : (timeConfig.dt !== undefined ? timeConfig.dt : 1);
    const rawSteps = config.steps !== undefined ? config.steps : (timeConfig.steps !== undefined ? timeConfig.steps : 1);
    const rawMaxSteps = timeConfig.max_steps !== undefined ? timeConfig.max_steps : (config.max_steps !== undefined ? (config.max_steps as number) : 1000);

    const startTime = Number(rawStartTime);
    const dt = Number(rawDt);
    const steps = Number(rawSteps);
    const maxSteps = Number(rawMaxSteps);

    // Validate start_time
    if (typeof startTime !== 'number' || isNaN(startTime) || !isFinite(startTime)) {
      throw new ScientificModelError(
        'MODEL_TIME_CONFIGURATION_INVALID',
        `Invalid start_time: "${rawStartTime}". Must be a finite number.`
      );
    }

    // Validate dt
    if (typeof dt !== 'number' || isNaN(dt) || !isFinite(dt) || dt <= 0) {
      throw new ScientificModelError(
        'MODEL_TIME_CONFIGURATION_INVALID',
        `Invalid dt: "${rawDt}". dt must be a positive finite number greater than zero.`
      );
    }

    // Validate steps
    if (typeof steps !== 'number' || isNaN(steps) || !Number.isInteger(steps) || steps < 0) {
      throw new ScientificModelError(
        'MODEL_TIME_CONFIGURATION_INVALID',
        `Invalid steps: "${rawSteps}". steps must be a non-negative integer.`
      );
    }

    // Validate safety step limit
    if (steps > maxSteps) {
      throw new ScientificModelError(
        'MODEL_STEP_LIMIT_EXCEEDED',
        `Requested step count (${steps}) exceeds the model safety limit (${maxSteps}).`,
        { steps, max_steps: maxSteps }
      );
    }

    // 3. INPUT VALIDATION VIA C3 INPUT VALIDATOR
    const inputSpecs: FormulaInputSpec[] = model.inputs || [];
    const validationResult = InputValidator.validate({
      module: {
        formula_id: modelId,
        name: model.name,
        inputs: inputSpecs,
        outputs: model.outputs || [],
        parameter_ids: model.parameter_ids || [],
        version: model.version,
        status: model.status,
        description: model.description || '',
        expression_ast: { type: 'CONSTANT', value: 0 },
        expression_string: '',
        reference_ids: model.reference_ids || [],
        assumptions: model.assumptions || [],
        limitations: [],
        validation_status: 'VALIDATED',
        created_by: model.created_by || 'system',
        created_at: model.created_at || '2026-09-23T00:00:00Z',
        updated_at: model.updated_at || '2026-09-23T00:00:00Z'
      },
      inputs: request.inputs,
      variables,
      execution_context: request.execution_context
    });

    if (!validationResult.valid) {
      throw new ScientificModelError(
        'MODEL_INVALID',
        validationResult.errors[0] || 'Model input validation failed.'
      );
    }

    // 4. PARAMETER VERIFICATION & FROZEN SNAPSHOT PREPARATION
    const effectiveParams: Record<string, { value: number; unit: string }> = {};
    const requiredParamIds = model.parameter_ids || [];

    for (const paramId of requiredParamIds) {
      let paramVal: unknown;
      let paramUnit = '';

      if (parameter_snapshot && parameter_snapshot.entries[paramId]) {
        paramVal = parameter_snapshot.entries[paramId].value;
        paramUnit = parameter_snapshot.entries[paramId].unit || '';
      } else if (parameters[paramId]) {
        paramVal = parameters[paramId].value;
        paramUnit = parameters[paramId].unit || '';
      }

      if (paramVal === undefined || paramVal === null) {
        throw new ScientificModelError(
          'MODEL_INVALID',
          `Required parameter "${paramId}" is not resolved or missing from snapshot.`
        );
      }

      const numParam = Number(paramVal);
      if (isNaN(numParam) || !isFinite(numParam)) {
        throw new ScientificModelError(
          'MODEL_NUMERICAL_ERROR',
          `Parameter "${paramId}" value "${paramVal}" is not a valid finite number.`
        );
      }

      effectiveParams[paramId] = { value: numParam, unit: paramUnit };
    }

    // 5. INITIAL STATE CREATION & VALIDATION
    const stateHistory: ModelStateHistoryEntry[] = [];
    const executionPath: string[] = ['MODEL_INIT'];
    const trace: StandardTraceStep[] = [];
    const state0: Record<string, number> = {};

    for (const stateDef of model.states) {
      const stateId = stateDef.state_id || stateDef.name;
      if (!stateId) {
        throw new ScientificModelError('STATE_VARIABLE_INVALID', 'A state variable definition is missing state_id.');
      }

      if (stateDef.datatype && stateDef.datatype !== 'number') {
        throw new ScientificModelError(
          'STATE_VARIABLE_INVALID',
          `State variable "${stateId}" specifies unsupported datatype "${stateDef.datatype}". Discrete dynamical models require numeric state variables.`
        );
      }

      // Initial value resolution order:
      // 1. Explicit configuration override (config.initial_state[stateId])
      // 2. Request inputs by exact stateId
      // 3. Request inputs by initial_stateId or stateId_0
      // 4. Model definition default stateDef.initial_value
      let rawInit: unknown = undefined;

      if (config.initial_state && typeof config.initial_state === 'object' && (config.initial_state as any)[stateId] !== undefined) {
        rawInit = (config.initial_state as any)[stateId];
      } else if (request.inputs && request.inputs[stateId]?.value !== undefined) {
        rawInit = request.inputs[stateId].value;
      } else if (request.inputs && request.inputs[`initial_${stateId}`]?.value !== undefined) {
        rawInit = request.inputs[`initial_${stateId}`].value;
      } else if (request.inputs && request.inputs[`${stateId}_0`]?.value !== undefined) {
        rawInit = request.inputs[`${stateId}_0`].value;
      } else if (stateDef.initial_value !== undefined) {
        rawInit = stateDef.initial_value;
      }

      if (rawInit === undefined || rawInit === null) {
        throw new ScientificModelError(
          'INITIAL_STATE_INVALID',
          `Initial state value for state variable "${stateId}" is missing or undefined.`
        );
      }

      if (typeof rawInit === 'string' && isNaN(Number(rawInit))) {
        throw new ScientificModelError(
          'INITIAL_STATE_INVALID',
          `Initial value for state "${stateId}" is not a valid number: "${rawInit}".`
        );
      }

      const numInit = Number(rawInit);

      if (isNaN(numInit)) {
        throw new ScientificModelError(
          'INITIAL_STATE_INVALID',
          `Initial value for state variable "${stateId}" evaluated to NaN.`
        );
      }

      if (!isFinite(numInit)) {
        throw new ScientificModelError(
          'INITIAL_STATE_INVALID',
          `Initial value for state variable "${stateId}" evaluated to Infinity.`
        );
      }

      // Check range boundaries if configured
      if (stateDef.min !== undefined && numInit < stateDef.min) {
        throw new ScientificModelError(
          'STATE_VARIABLE_INVALID',
          `Initial value ${numInit} for state "${stateId}" violates minimum bound ${stateDef.min}.`
        );
      }
      if (stateDef.max !== undefined && numInit > stateDef.max) {
        throw new ScientificModelError(
          'STATE_VARIABLE_INVALID',
          `Initial value ${numInit} for state "${stateId}" violates maximum bound ${stateDef.max}.`
        );
      }

      state0[stateId] = numInit;
    }

    const immutableState0 = Object.freeze({ ...state0 });

    stateHistory.push({
      step: 0,
      time: startTime,
      state: immutableState0
    });

    executionPath.push('STATE_0');

    trace.push({
      step_id: 'MODEL_INIT',
      operation: 'MODEL_INIT',
      inputs: {
        start_time: startTime,
        dt,
        steps,
        initial_state: immutableState0
      },
      output: immutableState0,
      timestamp: '2026-09-23T00:00:00.000Z',
      metadata: {
        step: 0,
        time: startTime,
        state: immutableState0
      }
    });

    // 6. DISCRETE TIME STATE EVOLUTION
    const transitionsMap: Record<string, ModelTransitionDefinition> = {};
    if (model.transitions && Array.isArray(model.transitions)) {
      for (const trans of model.transitions) {
        transitionsMap[trans.state_id] = trans;
      }
    }

    for (let currentStepIndex = 0; currentStepIndex < steps; currentStepIndex++) {
      const nextStepIndex = currentStepIndex + 1;
      const currentTime = startTime + currentStepIndex * dt;
      const nextTime = startTime + nextStepIndex * dt;

      const prevState = stateHistory[currentStepIndex].state;
      const nextState: Record<string, number> = {};

      const modelStates: ModelStateVariable[] = model.states || [];
      for (const stateDef of modelStates) {
        const stateId = stateDef.state_id || stateDef.name;
        const transition = transitionsMap[stateId];

        if (transition) {
          if (!transition.expression_ast) {
            throw new ScientificModelError(
              'TRANSITION_INVALID',
              `Transition for state variable "${stateId}" is missing required expression_ast.`
            );
          }

          let evalOutput: number;
          try {
            evalOutput = ModelExecutor.evaluateAST(transition.expression_ast, {
              state: prevState,
              inputs: validationResult.normalized_inputs,
              parameters: effectiveParams,
              currentTime,
              currentStep: currentStepIndex,
              dt
            });
          } catch (err: any) {
            if (err instanceof ScientificModelError) {
              throw err;
            }
            throw new ScientificModelError(
              'MODEL_TRANSITION_FAILED',
              `State transition calculation failed for variable "${stateId}" at step ${nextStepIndex} (t = ${currentTime}): ${err.message || String(err)}`
            );
          }

          if (typeof evalOutput !== 'number' || isNaN(evalOutput)) {
            throw new ScientificModelError(
              'MODEL_NUMERICAL_ERROR',
              `Transition for state "${stateId}" at step ${nextStepIndex} evaluated to NaN.`
            );
          }

          if (!isFinite(evalOutput)) {
            throw new ScientificModelError(
              'MODEL_NUMERICAL_ERROR',
              `Transition for state "${stateId}" at step ${nextStepIndex} evaluated to Infinity.`
            );
          }

          const transType = transition.type || 'EXPLICIT_UPDATE';
          let computedNextVal: number;

          if (transType === 'DERIVATIVE_EULER') {
            // Euler forward step: X(t + dt) = X(t) + dX/dt * dt
            computedNextVal = prevState[stateId] + evalOutput * dt;
          } else {
            // EXPLICIT_UPDATE or AST_EXPRESSION: X(t + dt) = evaluated result
            computedNextVal = evalOutput;
          }

          if (typeof computedNextVal !== 'number' || isNaN(computedNextVal)) {
            throw new ScientificModelError(
              'MODEL_NUMERICAL_ERROR',
              `State evolution for "${stateId}" at step ${nextStepIndex} resulted in NaN.`
            );
          }

          if (!isFinite(computedNextVal)) {
            throw new ScientificModelError(
              'MODEL_NUMERICAL_ERROR',
              `State evolution for "${stateId}" at step ${nextStepIndex} resulted in Infinity.`
            );
          }

          nextState[stateId] = computedNextVal;
        } else {
          // No transition defined for this state variable -> value persists
          nextState[stateId] = prevState[stateId];
        }
      }

      const immutableNextState = Object.freeze({ ...nextState });

      stateHistory.push({
        step: nextStepIndex,
        time: nextTime,
        state: immutableNextState
      });

      executionPath.push(`TRANSITION_${nextStepIndex}`, `STATE_${nextStepIndex}`);

      trace.push({
        step_id: `TRANSITION_${nextStepIndex}`,
        operation: 'STATE_TRANSITION',
        inputs: {
          step: currentStepIndex,
          time: currentTime,
          dt,
          prev_state: prevState
        },
        output: immutableNextState,
        timestamp: '2026-09-23T00:00:00.000Z',
        metadata: {
          step: nextStepIndex,
          time: nextTime,
          state: immutableNextState
        }
      });
    }

    // 7. FINAL OUTPUT ASSEMBLY
    const finalState = stateHistory[stateHistory.length - 1].state;
    const outputs: Record<string, { value: number | string | boolean; unit?: string }> = {};

    for (const stateDef of model.states) {
      const stateId = stateDef.state_id || stateDef.name;
      outputs[stateId] = {
        value: finalState[stateId],
        unit: stateDef.unit || 'unitless'
      };
    }

    outputs['final_time'] = {
      value: startTime + steps * dt,
      unit: 's'
    };
    outputs['steps_executed'] = {
      value: steps,
      unit: 'steps'
    };

    // 8. CRYPTOGRAPHIC PROVENANCE SEAL
    const provenancePayload = JSON.stringify({
      model_id: modelId,
      version: model.version,
      start_time: startTime,
      dt,
      steps,
      initial_state: immutableState0,
      final_state: finalState,
      parameters: effectiveParams
    });
    const provenance_id = sha256Hex(provenancePayload);

    return {
      execution_id: `EXEC_MODEL_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      module_id: modelId,
      module_version: model.version,
      inputs: request.inputs,
      normalized_inputs: validationResult.normalized_inputs,
      parameters: effectiveParams,
      parameter_versions,
      parameter_set_id,
      parameter_snapshot,
      execution_path: executionPath,
      fallback_used: false,
      intermediate_results: {
        state_history: stateHistory,
        final_state: finalState
      },
      trace,
      outputs,
      warnings: validationResult.warnings,
      errors: [],
      validation: {
        status: 'UNVALIDATED',
        profile: 'STANDARD',
        message: 'Model stateful discrete-time execution complete.'
      },
      state_history: stateHistory,
      start_time: startTime,
      dt,
      steps,
      timestamp: new Date().toISOString(),
      provenance_id
    };
  }

  /**
   * Pure deterministic AST evaluator for state transitions.
   * Resolves:
   * - State variables from current state X(t)
   * - Inputs from normalized inputs U(t)
   * - Parameters from resolved parameters θ
   * - Simulation context (t, dt, step)
   * Security: Zero eval(), zero new Function().
   */
  private static evaluateAST(
    node: ASTNode,
    context: {
      state: Record<string, number>;
      inputs: Record<string, { value: number; unit: string }>;
      parameters: Record<string, { value: number; unit: string }>;
      currentTime: number;
      currentStep: number;
      dt: number;
    }
  ): number {
    switch (node.type) {
      case 'CONSTANT':
        return node.value;

      case 'VARIABLE': {
        const vId = node.variable_id;

        // 1. Check state variables
        if (context.state[vId] !== undefined) {
          return context.state[vId];
        }

        // 2. Check normalized inputs
        if (context.inputs[vId] !== undefined) {
          return context.inputs[vId].value;
        }

        // 3. Check parameters
        if (context.parameters[vId] !== undefined) {
          return context.parameters[vId].value;
        }

        // 4. Check simulation context variables
        if (vId === 't' || vId === 'time') {
          return context.currentTime;
        }
        if (vId === 'dt' || vId === 'delta_t') {
          return context.dt;
        }
        if (vId === 'step') {
          return context.currentStep;
        }

        throw new ScientificModelError(
          'TRANSITION_INVALID',
          `Variable identifier "${vId}" in transition AST was not found in state, inputs, parameters, or time context.`
        );
      }

      case 'PARAMETER': {
        const pId = node.parameter_id;
        const resolved = context.parameters[pId];
        if (resolved === undefined) {
          throw new ScientificModelError(
            'TRANSITION_INVALID',
            `Parameter identifier "${pId}" in transition AST was not found in resolved parameters.`
          );
        }
        const numVal = Number(resolved.value);
        if (isNaN(numVal) || !isFinite(numVal)) {
          throw new ScientificModelError(
            'MODEL_NUMERICAL_ERROR',
            `Parameter "${pId}" value is not a finite number.`
          );
        }
        return numVal;
      }

      case 'OPERATOR': {
        const evaluatedArgs = (node.args || []).map(arg =>
          ModelExecutor.evaluateAST(arg, context)
        );

        switch (node.op) {
          case 'ADD':
            return evaluatedArgs.reduce((acc, curr) => acc + curr, 0);

          case 'SUBTRACT':
            return evaluatedArgs.length === 1 ? -evaluatedArgs[0] : evaluatedArgs[0] - evaluatedArgs[1];

          case 'MULTIPLY':
            return evaluatedArgs.reduce((acc, curr) => acc * curr, 1);

          case 'DIVIDE': {
            if (evaluatedArgs.length < 2) {
              throw new ScientificModelError('TRANSITION_INVALID', 'DIVIDE operator requires two arguments.');
            }
            if (evaluatedArgs[1] === 0) {
              throw new ScientificModelError('MODEL_NUMERICAL_ERROR', 'Division by zero encountered in model transition.');
            }
            const res = evaluatedArgs[0] / evaluatedArgs[1];
            if (isNaN(res) || !isFinite(res)) {
              throw new ScientificModelError('MODEL_NUMERICAL_ERROR', 'DIVIDE operation resulted in non-finite value.');
            }
            return res;
          }

          case 'POWER': {
            if (evaluatedArgs.length < 2) {
              throw new ScientificModelError('TRANSITION_INVALID', 'POWER operator requires two arguments.');
            }
            const res = Math.pow(evaluatedArgs[0], evaluatedArgs[1]);
            if (isNaN(res) || !isFinite(res)) {
              throw new ScientificModelError('MODEL_NUMERICAL_ERROR', 'POWER operation resulted in non-finite value.');
            }
            return res;
          }

          case 'SQRT': {
            if (evaluatedArgs[0] < 0) {
              throw new ScientificModelError('MODEL_NUMERICAL_ERROR', 'Square root of a negative number in transition.');
            }
            const res = Math.sqrt(evaluatedArgs[0]);
            if (isNaN(res)) {
              throw new ScientificModelError('MODEL_NUMERICAL_ERROR', 'SQRT operation resulted in NaN.');
            }
            return res;
          }

          case 'LOG': {
            if (evaluatedArgs[0] <= 0) {
              throw new ScientificModelError('MODEL_NUMERICAL_ERROR', 'Logarithm of non-positive number in transition.');
            }
            const res = Math.log(evaluatedArgs[0]);
            if (isNaN(res) || !isFinite(res)) {
              throw new ScientificModelError('MODEL_NUMERICAL_ERROR', 'LOG operation resulted in non-finite value.');
            }
            return res;
          }

          case 'EXP': {
            const res = Math.exp(evaluatedArgs[0]);
            if (isNaN(res) || !isFinite(res)) {
              throw new ScientificModelError('MODEL_NUMERICAL_ERROR', 'EXP operation resulted in non-finite value.');
            }
            return res;
          }

          case 'ABS':
            return Math.abs(evaluatedArgs[0]);

          case 'MIN':
            return Math.min(...evaluatedArgs);

          case 'MAX':
            return Math.max(...evaluatedArgs);

          default:
            throw new ScientificModelError(
              'TRANSITION_INVALID',
              `Unsupported AST operator "${(node as any).op}" in model transition.`
            );
        }
      }

      default:
        throw new ScientificModelError(
          'TRANSITION_INVALID',
          `Unknown AST node type "${(node as any).type}" in model transition.`
        );
    }
  }
}
