/**
 * NutriBodySim — Generic Calculation Engine & Auditable Trace Generator
 * 
 * Executes explicitly registered scientific modules (formulas, algorithms, models).
 * Does not contain hardcoded domain formulas.
 * Evaluates structured AST expressions, performs unit normalization, validates ranges,
 * logs full step-by-step trace, and produces mathematical human-readable explanation.
 */

import { 
  ScientificFormula, 
  ScientificParameter, 
  ScientificVariable, 
  CalculationTrace, 
  TraceStep, 
  ASTNode 
} from '../types';
import { convertUnit, findUnit } from '../units/unitConverter';
import { InputValidator } from '../validator/inputValidator';
import { sha256Hex } from '../crypto';

export interface CalculationInputPayload {
  formula: ScientificFormula;
  inputs: Record<string, { value: number | string | boolean; unit?: string }>;
  parameters?: Record<string, ScientificParameter>;
  variables?: Record<string, ScientificVariable>;
}

export class CalculationEngine {
  /**
   * Execute a scientific formula with full audit trail and step trace.
   */
  public static executeFormula(payload: CalculationInputPayload): CalculationTrace {
    const { formula, inputs, parameters = {}, variables = {} } = payload;
    const steps: TraceStep[] = [];
    let stepCount = 1;

    const addStep = (action: string, detail: string, intermediate?: number | string | boolean | null, unit?: string) => {
      steps.push({
        step: stepCount++,
        action,
        detail,
        intermediate_value: intermediate,
        unit,
        timestamp: new Date().toISOString()
      });
    };

    // STEP 1: Input receipt
    addStep(
      'INPUT_RECEIPT', 
      `Received calculation request for formula: [${formula.formula_id}] "${formula.name}" (version ${formula.version}, status: ${formula.status})`
    );

    const receivedMap: Record<string, { value: number | string; unit: string }> = {};
    for (const [key, val] of Object.entries(inputs)) {
      receivedMap[key] = {
        value: val.value as number | string,
        unit: val.unit || 'unitless'
      };
      addStep(
        'INPUT_REGISTERED',
        `Input "${key}": ${val.value} ${val.unit || '(no unit specified)'}`,
        val.value,
        val.unit
      );
    }

    // STEP 2 & 3: Input Validation, Unit Normalization, and Range Checking (Phase C3 InputValidator)
    const validation = InputValidator.validate({
      module: formula,
      inputs,
      variables
    });

    if (!validation.valid) {
      throw new Error(validation.errors[0]);
    }

    // Replay validation trace steps
    for (const step of validation.trace_steps) {
      addStep(step.action, step.detail, step.intermediate_value, step.unit);
    }

    const normalizedInputs: Record<string, { value: number; unit: string; original_unit: string }> = {};
    for (const [vId, nVal] of Object.entries(validation.normalized_inputs)) {
      normalizedInputs[vId] = {
        value: nVal.value,
        unit: nVal.unit,
        original_unit: nVal.original_unit || nVal.unit
      };
    }

    // STEP 4: Parameter Retrieval & Verification
    const resolvedParams: Record<string, { value: number | string; unit: string }> = {};
    for (const paramId of formula.parameter_ids) {
      const p = parameters[paramId];
      if (!p) {
        throw new Error(`Parameter Error: Required parameter "${paramId}" is not registered in the system.`);
      }
      resolvedParams[paramId] = {
        value: p.value as number | string,
        unit: p.unit
      };
      addStep(
        'PARAMETER_RESOLVED',
        `Resolved parameter [${p.parameter_id}] "${p.name}" = ${p.value} ${p.unit} (status: ${p.status})`,
        p.value as any,
        p.unit
      );
    }

    // STEP 5: Formula AST Execution
    addStep(
      'FORMULA_EXECUTION_START',
      `Evaluating formula expression: "${formula.expression_string}"`
    );

    const context = {
      inputs: normalizedInputs,
      parameters: resolvedParams,
      addStep
    };

    const evaluatedResult = CalculationEngine.evaluateAST(formula.expression_ast, context);

    addStep(
      'FORMULA_EXECUTION_COMPLETE',
      `Evaluated expression result: ${evaluatedResult}`,
      evaluatedResult,
      formula.outputs[0]?.unit || 'unitless'
    );

    // STEP 6: Final result preparation
    const finalResult: Record<string, { value: number | string; unit: string }> = {
      [formula.outputs[0]?.name || 'result']: {
        value: Number(evaluatedResult.toFixed(6)),
        unit: formula.outputs[0]?.unit || 'unitless'
      }
    };

    // STEP 7: Explanation generation
    const explanation = CalculationEngine.generateExplanation(formula, normalizedInputs, resolvedParams, evaluatedResult);

    // STEP 8: Cryptographic provenance hash
    const provenancePayload = JSON.stringify({
      formula_id: formula.formula_id,
      version: formula.version,
      inputs: normalizedInputs,
      parameters: resolvedParams,
      result: finalResult,
      timestamp: new Date().toISOString()
    });
    const provenance_hash = sha256Hex(provenancePayload);

    addStep(
      'PROVENANCE_SEALED',
      `Calculation audit trail sealed with SHA-256 hash: ${provenance_hash.slice(0, 16)}...`
    );

    return {
      calculation_id: `CALC_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      formula_or_model_id: formula.formula_id,
      version: formula.version,
      inputs_received: receivedMap,
      normalized_inputs: normalizedInputs,
      parameters_resolved: resolvedParams,
      steps,
      final_result: finalResult,
      explanation,
      provenance_hash,
      created_at: new Date().toISOString()
    };
  }

  /**
   * Recursive AST evaluator with step logging
   */
  private static evaluateAST(node: ASTNode, context: {
    inputs: Record<string, { value: number; unit: string }>;
    parameters: Record<string, { value: number | string; unit: string }>;
    addStep: (action: string, detail: string, val?: any, unit?: string) => void;
  }): number {
    switch (node.type) {
      case 'CONSTANT':
        return node.value;

      case 'VARIABLE': {
        const resolved = context.inputs[node.variable_id];
        if (resolved === undefined) {
          throw new Error(`Variable "${node.variable_id}" not found in normalized inputs.`);
        }
        return resolved.value;
      }

      case 'PARAMETER': {
        const resolved = context.parameters[node.parameter_id];
        if (resolved === undefined) {
          throw new Error(`Parameter "${node.parameter_id}" not found in resolved parameters.`);
        }
        const numVal = Number(resolved.value);
        if (isNaN(numVal)) {
          throw new Error(`Parameter "${node.parameter_id}" cannot be parsed as a numeric value.`);
        }
        return numVal;
      }

      case 'OPERATOR': {
        const evaluatedArgs = node.args.map(arg => CalculationEngine.evaluateAST(arg, context));
        let res: number;
        switch (node.op) {
          case 'ADD':
            res = evaluatedArgs.reduce((acc, curr) => acc + curr, 0);
            context.addStep('AST_OP', `Evaluated [ADD]: ${evaluatedArgs.join(' + ')} = ${res.toFixed(4)}`, res);
            return res;
          case 'SUBTRACT':
            res = evaluatedArgs.length === 1 ? -evaluatedArgs[0] : evaluatedArgs[0] - evaluatedArgs[1];
            context.addStep('AST_OP', `Evaluated [SUBTRACT]: ${evaluatedArgs.join(' - ')} = ${res.toFixed(4)}`, res);
            return res;
          case 'MULTIPLY':
            res = evaluatedArgs.reduce((acc, curr) => acc * curr, 1);
            context.addStep('AST_OP', `Evaluated [MULTIPLY]: ${evaluatedArgs.join(' * ')} = ${res.toFixed(4)}`, res);
            return res;
          case 'DIVIDE':
            if (evaluatedArgs[1] === 0) {
              throw new Error('Mathematical Error: Division by zero encountered.');
            }
            res = evaluatedArgs[0] / evaluatedArgs[1];
            context.addStep('AST_OP', `Evaluated [DIVIDE]: ${evaluatedArgs[0]} / ${evaluatedArgs[1]} = ${res.toFixed(4)}`, res);
            return res;
          case 'POWER':
            res = Math.pow(evaluatedArgs[0], evaluatedArgs[1]);
            context.addStep('AST_OP', `Evaluated [POWER]: ${evaluatedArgs[0]} ^ ${evaluatedArgs[1]} = ${res.toFixed(4)}`, res);
            return res;
          case 'SQRT':
            if (evaluatedArgs[0] < 0) {
              throw new Error('Mathematical Error: Square root of a negative number.');
            }
            res = Math.sqrt(evaluatedArgs[0]);
            context.addStep('AST_OP', `Evaluated [SQRT]: sqrt(${evaluatedArgs[0]}) = ${res.toFixed(4)}`, res);
            return res;
          case 'LOG':
            if (evaluatedArgs[0] <= 0) {
              throw new Error('Mathematical Error: Natural log of non-positive number.');
            }
            res = Math.log(evaluatedArgs[0]);
            context.addStep('AST_OP', `Evaluated [LOG]: ln(${evaluatedArgs[0]}) = ${res.toFixed(4)}`, res);
            return res;
          case 'EXP':
            res = Math.exp(evaluatedArgs[0]);
            context.addStep('AST_OP', `Evaluated [EXP]: exp(${evaluatedArgs[0]}) = ${res.toFixed(4)}`, res);
            return res;
          case 'ABS':
            res = Math.abs(evaluatedArgs[0]);
            return res;
          case 'MIN':
            res = Math.min(...evaluatedArgs);
            return res;
          case 'MAX':
            res = Math.max(...evaluatedArgs);
            return res;
          default:
            throw new Error(`Unsupported operator: ${(node as any).op}`);
        }
      }

      case 'CONDITION': {
        const leftVal = CalculationEngine.evaluateAST(node.condition.left, context);
        const rightVal = CalculationEngine.evaluateAST(node.condition.right, context);
        let conditionMet = false;
        switch (node.condition.op) {
          case '==': conditionMet = leftVal === rightVal; break;
          case '!=': conditionMet = leftVal !== rightVal; break;
          case '<': conditionMet = leftVal < rightVal; break;
          case '<=': conditionMet = leftVal <= rightVal; break;
          case '>': conditionMet = leftVal > rightVal; break;
          case '>=': conditionMet = leftVal >= rightVal; break;
        }
        context.addStep(
          'AST_CONDITION',
          `Condition test: ${leftVal} ${node.condition.op} ${rightVal} -> ${conditionMet ? 'TRUE' : 'FALSE'}`
        );
        return conditionMet
          ? CalculationEngine.evaluateAST(node.then_branch, context)
          : CalculationEngine.evaluateAST(node.else_branch, context);
      }

      default:
        throw new Error(`Unknown AST node type: ${(node as any).type}`);
    }
  }

  /**
   * Generates a fully traceable, human-readable scientific explanation.
   */
  private static generateExplanation(
    formula: ScientificFormula,
    inputs: Record<string, { value: number; unit: string; original_unit: string }>,
    params: Record<string, { value: number | string; unit: string }>,
    result: number
  ): string {
    const inputLines = Object.entries(inputs).map(([k, v]) => {
      const convNote = v.unit !== v.original_unit ? ` (converted from ${v.original_unit})` : '';
      return `• ${k}: ${v.value} ${v.unit}${convNote}`;
    }).join('\n');

    const paramLines = Object.entries(params).length > 0
      ? '\n\nConfigured Parameters:\n' + Object.entries(params).map(([k, v]) => `• ${k}: ${v.value} ${v.unit}`).join('\n')
      : '';

    const refNote = formula.reference_ids.length > 0 
      ? `\n\nAcademic References: [${formula.reference_ids.join(', ')}]` 
      : '';

    return `The calculation of "${formula.name}" (v${formula.version}) was executed using the registered expression:\n` +
      `Formula: ${formula.expression_string}\n\n` +
      `Normalized Inputs:\n${inputLines}` +
      `${paramLines}\n\n` +
      `Computed Output: ${result.toFixed(4)} ${formula.outputs[0]?.unit || 'unitless'}` +
      refNote;
  }
}
