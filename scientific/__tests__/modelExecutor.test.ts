/**
 * NutriBodySim — Model Executor Test Suite
 * 
 * Phase C5: Model Executor
 * 27 Mandatory Test Cases verifying stateful discrete-time system evolution,
 * state history immutability, time-step configuration, numerical safety,
 * isolation, deterministic behavior, and regression contracts across Phase C1-C4.
 */

import { describe, it, expect } from 'vitest';
import {
  ModelExecutor,
  executeModuleRequest,
  ModuleResolver,
  ParameterResolver,
  InputValidator,
  CalculationEngine,
  AlgorithmExecutor,
  ScientificModel,
  ScientificFormula,
  ScientificAlgorithm,
  ScientificParameter,
  ScientificVariable,
  ModuleRequest,
  ScientificModelError
} from '../index';

describe('Phase C5 — Model Executor Test Suite (27 Mandatory Tests)', () => {
  // Common synthetic model for infrastructure testing:
  // dx/dt = -k * x + u, or discrete X(t+dt) = X(t) * (1 - k*dt) + u*dt
  const standardSyntheticModel: ScientificModel = {
    module_id: 'MODEL_SYNTH_DECAY',
    module_type: 'MODEL',
    model_id: 'MODEL_SYNTH_DECAY',
    name: 'Synthetic First-Order Linear Decay',
    description: 'Infrastructure test model for discrete-time state transitions',
    version: '1.0.0',
    status: 'VERIFIED',
    is_verified: true,
    variable_ids: ['u_input'],
    parameter_ids: ['PARAM_K'],
    reference_ids: [],
    assumptions: ['Pure infrastructure simulation test'],
    inputs: [
      {
        variable_id: 'u_input',
        name: 'u_input',
        unit: 'unitless',
        datatype: 'number',
        required: false,
        default_value: 0
      }
    ],
    outputs: [
      {
        name: 'x_state',
        unit: 'mg',
        datatype: 'number'
      }
    ],
    states: [
      {
        state_id: 'x_state',
        name: 'State X',
        datatype: 'number',
        unit: 'mg',
        initial_value: 100
      }
    ],
    time_config: {
      start_time: 0,
      dt: 1,
      steps: 5,
      max_steps: 100
    },
    transitions: [
      {
        state_id: 'x_state',
        type: 'DERIVATIVE_EULER',
        // dx/dt = -PARAM_K * x_state + u_input
        expression_ast: {
          type: 'OPERATOR',
          op: 'ADD',
          args: [
            {
              type: 'OPERATOR',
              op: 'MULTIPLY',
              args: [
                { type: 'CONSTANT', value: -1 },
                {
                  type: 'OPERATOR',
                  op: 'MULTIPLY',
                  args: [
                    { type: 'PARAMETER', parameter_id: 'PARAM_K' },
                    { type: 'VARIABLE', variable_id: 'x_state' }
                  ]
                }
              ]
            },
            { type: 'VARIABLE', variable_id: 'u_input' }
          ]
        }
      }
    ],
    created_by: 'system',
    created_at: '2026-09-23T00:00:00Z',
    updated_at: '2026-09-23T00:00:00Z'
  };

  const standardParameters: Record<string, ScientificParameter> = {
    PARAM_K: {
      parameter_id: 'PARAM_K',
      name: 'Rate Constant k',
      description: 'Decay constant',
      value: 0.1,
      unit: '1/s',
      reference_ids: [],
      version: '1.0.0',
      status: 'VERIFIED',
      is_constant: true,
      created_at: '2026-09-23T00:00:00Z',
      updated_at: '2026-09-23T00:00:00Z'
    }
  };

  // ---------------------------------------------------------------------------
  // TEST 1 — Initial State Creation
  // ---------------------------------------------------------------------------
  it('Test 1: should correctly initialize state at step 0 with configured initial value', () => {
    const result = ModelExecutor.execute({
      model: standardSyntheticModel,
      request: {
        module_id: 'MODEL_SYNTH_DECAY',
        inputs: { u_input: { value: 0 } },
        configuration: { steps: 0 }
      },
      parameters: standardParameters
    });

    expect(result.state_history).toBeDefined();
    expect(result.state_history?.length).toBe(1);
    expect(result.state_history?.[0]).toEqual({
      step: 0,
      time: 0,
      state: { x_state: 100 }
    });
    expect(result.outputs['x_state'].value).toBe(100);
  });

  // ---------------------------------------------------------------------------
  // TEST 2 — One-Step Transition
  // ---------------------------------------------------------------------------
  it('Test 2: should compute single discrete-time step transition correctly', () => {
    // Initial x=100, k=0.1, dt=1, u=0. dx/dt = -0.1*100 = -10. x(1) = 100 + (-10)*1 = 90.
    const result = ModelExecutor.execute({
      model: standardSyntheticModel,
      request: {
        module_id: 'MODEL_SYNTH_DECAY',
        inputs: { u_input: { value: 0 } },
        configuration: { steps: 1, dt: 1, start_time: 0 }
      },
      parameters: standardParameters
    });

    expect(result.state_history?.length).toBe(2);
    expect(result.state_history?.[0].state.x_state).toBe(100);
    expect(result.state_history?.[1].state.x_state).toBe(90);
    expect(result.outputs['x_state'].value).toBe(90);
  });

  // ---------------------------------------------------------------------------
  // TEST 3 — Multi-Step Transition
  // ---------------------------------------------------------------------------
  it('Test 3: should evolve multi-step trajectory accurately over discrete steps', () => {
    // Step 0: x=100
    // Step 1: x = 100 - 10 = 90
    // Step 2: x = 90 - 0.1*90 = 81
    // Step 3: x = 81 - 0.1*81 = 72.9
    const result = ModelExecutor.execute({
      model: standardSyntheticModel,
      request: {
        module_id: 'MODEL_SYNTH_DECAY',
        inputs: { u_input: { value: 0 } },
        configuration: { steps: 3, dt: 1, start_time: 0 }
      },
      parameters: standardParameters
    });

    expect(result.state_history?.length).toBe(4);
    expect(result.state_history?.[0].state.x_state).toBe(100);
    expect(result.state_history?.[1].state.x_state).toBe(90);
    expect(result.state_history?.[2].state.x_state).toBe(81);
    expect(result.state_history?.[3].state.x_state).toBeCloseTo(72.9, 6);
  });

  // ---------------------------------------------------------------------------
  // TEST 4 — State History Immutability
  // ---------------------------------------------------------------------------
  it('Test 4: should ensure state history snapshots are immutable and preserve full historical trajectory', () => {
    const result = ModelExecutor.execute({
      model: standardSyntheticModel,
      request: {
        module_id: 'MODEL_SYNTH_DECAY',
        inputs: {},
        configuration: { steps: 2 }
      },
      parameters: standardParameters
    });

    const history = result.state_history!;
    expect(history.length).toBe(3);

    // Verify object freeze on state snapshots
    expect(Object.isFrozen(history[0].state)).toBe(true);
    expect(Object.isFrozen(history[1].state)).toBe(true);
    expect(Object.isFrozen(history[2].state)).toBe(true);

    // Attempting mutation should fail in strict mode or not alter previous steps
    expect(() => {
      (history[0].state as any).x_state = 999;
    }).toThrow();
  });

  // ---------------------------------------------------------------------------
  // TEST 5 — dt Handling
  // ---------------------------------------------------------------------------
  it('Test 5: should scale derivative state transitions proportionally to dt', () => {
    // Initial x=100, k=0.1.
    // If dt=0.5: dx/dt = -10 -> next x = 100 + (-10)*0.5 = 95.
    const result = ModelExecutor.execute({
      model: standardSyntheticModel,
      request: {
        module_id: 'MODEL_SYNTH_DECAY',
        inputs: {},
        configuration: { steps: 1, dt: 0.5, start_time: 0 }
      },
      parameters: standardParameters
    });

    expect(result.dt).toBe(0.5);
    expect(result.state_history?.[1].time).toBe(0.5);
    expect(result.state_history?.[1].state.x_state).toBe(95);
  });

  // ---------------------------------------------------------------------------
  // TEST 6 — start_time Handling
  // ---------------------------------------------------------------------------
  it('Test 6: should correctly offset simulation time from non-zero start_time', () => {
    const result = ModelExecutor.execute({
      model: standardSyntheticModel,
      request: {
        module_id: 'MODEL_SYNTH_DECAY',
        inputs: {},
        configuration: { steps: 2, dt: 2, start_time: 10 }
      },
      parameters: standardParameters
    });

    expect(result.start_time).toBe(10);
    expect(result.state_history?.[0].time).toBe(10);
    expect(result.state_history?.[1].time).toBe(12);
    expect(result.state_history?.[2].time).toBe(14);
    expect(result.outputs['final_time'].value).toBe(14);
  });

  // ---------------------------------------------------------------------------
  // TEST 7 — Step Count
  // ---------------------------------------------------------------------------
  it('Test 7: should execute exact requested step count and output total steps_executed', () => {
    const result = ModelExecutor.execute({
      model: standardSyntheticModel,
      request: {
        module_id: 'MODEL_SYNTH_DECAY',
        inputs: {},
        configuration: { steps: 4 }
      },
      parameters: standardParameters
    });

    expect(result.steps).toBe(4);
    expect(result.state_history?.length).toBe(5); // step 0 + 4 steps
    expect(result.outputs['steps_executed'].value).toBe(4);
  });

  // ---------------------------------------------------------------------------
  // TEST 8 — Deterministic Repeated Execution
  // ---------------------------------------------------------------------------
  it('Test 8: should produce identical state history and outputs given identical inputs and parameters', () => {
    const request: ModuleRequest = {
      module_id: 'MODEL_SYNTH_DECAY',
      inputs: { u_input: { value: 5 } },
      configuration: { steps: 3, dt: 1 }
    };

    const run1 = ModelExecutor.execute({
      model: standardSyntheticModel,
      request,
      parameters: standardParameters
    });

    const run2 = ModelExecutor.execute({
      model: standardSyntheticModel,
      request,
      parameters: standardParameters
    });

    expect(run1.state_history).toEqual(run2.state_history);
    expect(run1.outputs).toEqual(run2.outputs);
    expect(run1.execution_path).toEqual(run2.execution_path);
  });

  // ---------------------------------------------------------------------------
  // TEST 9 — Execution Isolation
  // ---------------------------------------------------------------------------
  it('Test 9: should isolate concurrent/sequential executions without shared state leakage', () => {
    const runA = ModelExecutor.execute({
      model: standardSyntheticModel,
      request: {
        module_id: 'MODEL_SYNTH_DECAY',
        inputs: {},
        configuration: { initial_state: { x_state: 200 }, steps: 2 }
      },
      parameters: standardParameters
    });

    const runB = ModelExecutor.execute({
      model: standardSyntheticModel,
      request: {
        module_id: 'MODEL_SYNTH_DECAY',
        inputs: {},
        configuration: { initial_state: { x_state: 50 }, steps: 2 }
      },
      parameters: standardParameters
    });

    expect(runA.state_history?.[0].state.x_state).toBe(200);
    expect(runB.state_history?.[0].state.x_state).toBe(50);
    expect(runA.outputs['x_state'].value).toBe(162); // 200 -> 180 -> 162
    expect(runB.outputs['x_state'].value).toBe(40.5); // 50 -> 45 -> 40.5
  });

  // ---------------------------------------------------------------------------
  // TEST 10 — Parameter Snapshot Usage
  // ---------------------------------------------------------------------------
  it('Test 10: should utilize frozen ParameterSnapshot without database lookups during runtime', () => {
    const snapshot = {
      snapshot_id: 'SNAP_TEST_001',
      timestamp: '2026-09-23T00:00:00Z',
      entries: {
        PARAM_K: {
          parameter_id: 'PARAM_K',
          parameter_version: '1.0.0',
          name: 'Decay Constant k',
          value: 0.2, // Snapshot overrides default 0.1
          unit: '1/s',
          is_constant: true
        }
      }
    };

    // With k=0.2, x(1) = 100 + (-0.2*100)*1 = 80
    const result = ModelExecutor.execute({
      model: standardSyntheticModel,
      request: {
        module_id: 'MODEL_SYNTH_DECAY',
        inputs: {},
        configuration: { steps: 1 }
      },
      parameter_snapshot: snapshot
    });

    expect(result.state_history?.[1].state.x_state).toBe(80);
    expect(result.parameter_snapshot).toBe(snapshot);
  });

  // ---------------------------------------------------------------------------
  // TEST 11 — Input Normalization
  // ---------------------------------------------------------------------------
  it('Test 11: should validate and normalize external inputs U(t) via InputValidator', () => {
    const vars: Record<string, ScientificVariable> = {
      u_input: {
        variable_id: 'u_input',
        name: 'u_input',
        label: 'Input Signal',
        definition: 'Input signal for simulation test',
        datatype: 'number',
        unit: 'unitless',
        measurement_type: 'dimensionless',
        version: '1.0.0',
        status: 'VERIFIED',
        created_at: '2026-09-23T00:00:00Z',
        updated_at: '2026-09-23T00:00:00Z'
      }
    };

    const result = ModelExecutor.execute({
      model: standardSyntheticModel,
      request: {
        module_id: 'MODEL_SYNTH_DECAY',
        inputs: { u_input: { value: 10, unit: 'unitless' } },
        configuration: { steps: 1 }
      },
      parameters: standardParameters,
      variables: vars
    });

    expect(result.normalized_inputs['u_input']).toBeDefined();
    expect(result.normalized_inputs['u_input'].value).toBe(10);
    // dx/dt = -0.1*100 + 10 = 0 -> x(1) = 100
    expect(result.state_history?.[1].state.x_state).toBe(100);
  });

  // ---------------------------------------------------------------------------
  // TEST 12 — Missing Initial State
  // ---------------------------------------------------------------------------
  it('Test 12: should throw INITIAL_STATE_INVALID when required initial state is absent', () => {
    const modelWithoutInitialValue: ScientificModel = {
      ...standardSyntheticModel,
      states: [
        {
          state_id: 'x_state',
          name: 'State X',
          datatype: 'number',
          unit: 'mg',
          initial_value: undefined as any
        }
      ]
    };

    expect(() => {
      ModelExecutor.execute({
        model: modelWithoutInitialValue,
        request: { module_id: 'MODEL_SYNTH_DECAY', inputs: {} },
        parameters: standardParameters
      });
    }).toThrow(ScientificModelError);

    try {
      ModelExecutor.execute({
        model: modelWithoutInitialValue,
        request: { module_id: 'MODEL_SYNTH_DECAY', inputs: {} },
        parameters: standardParameters
      });
    } catch (e: any) {
      expect(e.code).toBe('INITIAL_STATE_INVALID');
    }
  });

  // ---------------------------------------------------------------------------
  // TEST 13 — Invalid State Datatype
  // ---------------------------------------------------------------------------
  it('Test 13: should throw STATE_VARIABLE_INVALID if state variable specifies non-numeric datatype', () => {
    const modelWithInvalidDatatype: ScientificModel = {
      ...standardSyntheticModel,
      states: [
        {
          state_id: 'x_state',
          name: 'State X',
          datatype: 'string' as any,
          unit: 'mg',
          initial_value: 100
        }
      ]
    };

    expect(() => {
      ModelExecutor.execute({
        model: modelWithInvalidDatatype,
        request: { module_id: 'MODEL_SYNTH_DECAY', inputs: {} },
        parameters: standardParameters
      });
    }).toThrow(ScientificModelError);

    try {
      ModelExecutor.execute({
        model: modelWithInvalidDatatype,
        request: { module_id: 'MODEL_SYNTH_DECAY', inputs: {} },
        parameters: standardParameters
      });
    } catch (e: any) {
      expect(e.code).toBe('STATE_VARIABLE_INVALID');
    }
  });

  // ---------------------------------------------------------------------------
  // TEST 14 — Invalid State Dimension / Bounds
  // ---------------------------------------------------------------------------
  it('Test 14: should throw STATE_VARIABLE_INVALID if initial state violates defined bounds', () => {
    const boundedModel: ScientificModel = {
      ...standardSyntheticModel,
      states: [
        {
          state_id: 'x_state',
          name: 'State X',
          datatype: 'number',
          unit: 'mg',
          initial_value: -50,
          min: 0,
          max: 1000
        }
      ]
    };

    expect(() => {
      ModelExecutor.execute({
        model: boundedModel,
        request: { module_id: 'MODEL_SYNTH_DECAY', inputs: {} },
        parameters: standardParameters
      });
    }).toThrow(ScientificModelError);

    try {
      ModelExecutor.execute({
        model: boundedModel,
        request: { module_id: 'MODEL_SYNTH_DECAY', inputs: {} },
        parameters: standardParameters
      });
    } catch (e: any) {
      expect(e.code).toBe('STATE_VARIABLE_INVALID');
    }
  });

  // ---------------------------------------------------------------------------
  // TEST 15 — Invalid Transition Output
  // ---------------------------------------------------------------------------
  it('Test 15: should throw TRANSITION_INVALID when transition references unknown variable', () => {
    const invalidTransitionModel: ScientificModel = {
      ...standardSyntheticModel,
      transitions: [
        {
          state_id: 'x_state',
          type: 'EXPLICIT_UPDATE',
          expression_ast: {
            type: 'VARIABLE',
            variable_id: 'UNKNOWN_VARIABLE_XYZ'
          }
        }
      ]
    };

    expect(() => {
      ModelExecutor.execute({
        model: invalidTransitionModel,
        request: { module_id: 'MODEL_SYNTH_DECAY', inputs: {}, configuration: { steps: 1 } },
        parameters: standardParameters
      });
    }).toThrow(ScientificModelError);

    try {
      ModelExecutor.execute({
        model: invalidTransitionModel,
        request: { module_id: 'MODEL_SYNTH_DECAY', inputs: {}, configuration: { steps: 1 } },
        parameters: standardParameters
      });
    } catch (e: any) {
      expect(e.code).toBe('TRANSITION_INVALID');
    }
  });

  // ---------------------------------------------------------------------------
  // TEST 16 — NaN Detection
  // ---------------------------------------------------------------------------
  it('Test 16: should detect NaN in transition outputs and throw MODEL_NUMERICAL_ERROR without silent replacement', () => {
    const nanModel: ScientificModel = {
      ...standardSyntheticModel,
      transitions: [
        {
          state_id: 'x_state',
          type: 'EXPLICIT_UPDATE',
          // Sqrt of negative number -> NaN
          expression_ast: {
            type: 'OPERATOR',
            op: 'SQRT',
            args: [{ type: 'CONSTANT', value: -25 }]
          }
        }
      ]
    };

    expect(() => {
      ModelExecutor.execute({
        model: nanModel,
        request: { module_id: 'MODEL_SYNTH_DECAY', inputs: {}, configuration: { steps: 1 } },
        parameters: standardParameters
      });
    }).toThrow(ScientificModelError);

    try {
      ModelExecutor.execute({
        model: nanModel,
        request: { module_id: 'MODEL_SYNTH_DECAY', inputs: {}, configuration: { steps: 1 } },
        parameters: standardParameters
      });
    } catch (e: any) {
      expect(e.code).toBe('MODEL_NUMERICAL_ERROR');
    }
  });

  // ---------------------------------------------------------------------------
  // TEST 17 — Infinity Detection
  // ---------------------------------------------------------------------------
  it('Test 17: should detect Infinity / division by zero in transition and throw MODEL_NUMERICAL_ERROR', () => {
    const infModel: ScientificModel = {
      ...standardSyntheticModel,
      transitions: [
        {
          state_id: 'x_state',
          type: 'EXPLICIT_UPDATE',
          // Division by zero -> Infinity
          expression_ast: {
            type: 'OPERATOR',
            op: 'DIVIDE',
            args: [
              { type: 'CONSTANT', value: 100 },
              { type: 'CONSTANT', value: 0 }
            ]
          }
        }
      ]
    };

    expect(() => {
      ModelExecutor.execute({
        model: infModel,
        request: { module_id: 'MODEL_SYNTH_DECAY', inputs: {}, configuration: { steps: 1 } },
        parameters: standardParameters
      });
    }).toThrow(ScientificModelError);

    try {
      ModelExecutor.execute({
        model: infModel,
        request: { module_id: 'MODEL_SYNTH_DECAY', inputs: {}, configuration: { steps: 1 } },
        parameters: standardParameters
      });
    } catch (e: any) {
      expect(e.code).toBe('MODEL_NUMERICAL_ERROR');
    }
  });

  // ---------------------------------------------------------------------------
  // TEST 18 — Step Limit
  // ---------------------------------------------------------------------------
  it('Test 18: should enforce step limit safety guard and throw MODEL_STEP_LIMIT_EXCEEDED when exceeded', () => {
    expect(() => {
      ModelExecutor.execute({
        model: standardSyntheticModel, // max_steps: 100
        request: {
          module_id: 'MODEL_SYNTH_DECAY',
          inputs: {},
          configuration: { steps: 500 }
        },
        parameters: standardParameters
      });
    }).toThrow(ScientificModelError);

    try {
      ModelExecutor.execute({
        model: standardSyntheticModel,
        request: {
          module_id: 'MODEL_SYNTH_DECAY',
          inputs: {},
          configuration: { steps: 500 }
        },
        parameters: standardParameters
      });
    } catch (e: any) {
      expect(e.code).toBe('MODEL_STEP_LIMIT_EXCEEDED');
    }
  });

  // ---------------------------------------------------------------------------
  // TEST 19 — Execution Path Recording
  // ---------------------------------------------------------------------------
  it('Test 19: should accurately record discrete execution path chronologically', () => {
    const result = ModelExecutor.execute({
      model: standardSyntheticModel,
      request: {
        module_id: 'MODEL_SYNTH_DECAY',
        inputs: {},
        configuration: { steps: 3 }
      },
      parameters: standardParameters
    });

    expect(result.execution_path).toEqual([
      'MODEL_INIT',
      'STATE_0',
      'TRANSITION_1',
      'STATE_1',
      'TRANSITION_2',
      'STATE_2',
      'TRANSITION_3',
      'STATE_3'
    ]);
  });

  // ---------------------------------------------------------------------------
  // TEST 20 — Trace Generation
  // ---------------------------------------------------------------------------
  it('Test 20: should generate StandardTraceStep entries conforming to target Phase C architecture', () => {
    const result = ModelExecutor.execute({
      model: standardSyntheticModel,
      request: {
        module_id: 'MODEL_SYNTH_DECAY',
        inputs: {},
        configuration: { steps: 2, dt: 1, start_time: 0 }
      },
      parameters: standardParameters
    });

    expect(result.trace.length).toBe(3); // INIT + 2 TRANSITIONS
    expect(result.trace[0].operation).toBe('MODEL_INIT');
    expect(result.trace[1].operation).toBe('STATE_TRANSITION');
    expect(result.trace[1].step_id).toBe('TRANSITION_1');
    expect(result.trace[1].metadata?.step).toBe(1);
    expect(result.trace[1].metadata?.time).toBe(1);
    expect(result.trace[2].metadata?.step).toBe(2);
    expect(result.trace[2].metadata?.time).toBe(2);
  });

  // ---------------------------------------------------------------------------
  // TEST 21 — Exact Model Version Resolution
  // ---------------------------------------------------------------------------
  it('Test 21: should resolve exact model version via ModuleResolver and executeModuleRequest', () => {
    const v1Model: ScientificModel = { ...standardSyntheticModel, version: '1.0.0' };
    const v2Model: ScientificModel = {
      ...standardSyntheticModel,
      version: '2.0.0',
      states: [{ state_id: 'x_state', name: 'State X', datatype: 'number', unit: 'mg', initial_value: 500 }]
    };

    const resolvedV1 = ModuleResolver.resolve({
      module_id: 'MODEL_SYNTH_DECAY',
      requested_version: '1.0.0',
      modules: [v1Model, v2Model]
    });
    expect(resolvedV1.module_version).toBe('1.0.0');

    const result = executeModuleRequest(
      {
        module_id: 'MODEL_SYNTH_DECAY',
        requested_version: '2.0.0',
        inputs: {},
        configuration: { steps: 0 }
      },
      undefined,
      standardParameters,
      {},
      { available_modules: [v1Model, v2Model] }
    );

    expect(result.module_version).toBe('2.0.0');
    expect(result.outputs['x_state'].value).toBe(500);
  });

  // ---------------------------------------------------------------------------
  // TEST 22 — Model Not Found
  // ---------------------------------------------------------------------------
  it('Test 22: should throw MODULE_NOT_FOUND when requested model does not exist in registry', () => {
    expect(() => {
      executeModuleRequest(
        { module_id: 'NON_EXISTENT_MODEL_999', inputs: {} },
        undefined,
        {},
        {},
        { available_modules: [standardSyntheticModel] }
      );
    }).toThrow();
  });

  // ---------------------------------------------------------------------------
  // TEST 23 — Transition Failure
  // ---------------------------------------------------------------------------
  it('Test 23: should throw MODEL_TIME_CONFIGURATION_INVALID on negative or non-finite dt', () => {
    expect(() => {
      ModelExecutor.execute({
        model: standardSyntheticModel,
        request: {
          module_id: 'MODEL_SYNTH_DECAY',
          inputs: {},
          configuration: { dt: -1 }
        },
        parameters: standardParameters
      });
    }).toThrow(ScientificModelError);

    try {
      ModelExecutor.execute({
        model: standardSyntheticModel,
        request: {
          module_id: 'MODEL_SYNTH_DECAY',
          inputs: {},
          configuration: { dt: -1 }
        },
        parameters: standardParameters
      });
    } catch (e: any) {
      expect(e.code).toBe('MODEL_TIME_CONFIGURATION_INVALID');
    }
  });

  // ---------------------------------------------------------------------------
  // TEST 24 — Phase C1 Regression
  // ---------------------------------------------------------------------------
  it('Test 24 [C1 Regression]: should preserve legacy CalculationEngine formula execution and trace', () => {
    const testFormula: ScientificFormula = {
      formula_id: 'FORMULA_C1_REGRESSION',
      name: 'Linear Scaling',
      description: 'C1 regression verification',
      version: '1.0.0',
      status: 'VERIFIED',
      inputs: [{ variable_id: 'a', name: 'a', unit: 'cm', datatype: 'number', required: true }],
      outputs: [{ name: 'result', unit: 'cm', datatype: 'number' }],
      parameter_ids: [],
      expression_ast: {
        type: 'OPERATOR',
        op: 'MULTIPLY',
        args: [
          { type: 'VARIABLE', variable_id: 'a' },
          { type: 'CONSTANT', value: 2 }
        ]
      },
      expression_string: 'a * 2',
      reference_ids: [],
      assumptions: [],
      limitations: [],
      validation_status: 'VALIDATED',
      created_by: 'system',
      created_at: '2026-09-23T00:00:00Z',
      updated_at: '2026-09-23T00:00:00Z'
    };

    const trace = CalculationEngine.executeFormula({
      formula: testFormula,
      inputs: { a: { value: 15, unit: 'cm' } },
      parameters: {}
    });

    expect(trace.final_result['result'].value).toBe(30);
  });

  // ---------------------------------------------------------------------------
  // TEST 25 — Phase C2 Regression
  // ---------------------------------------------------------------------------
  it('Test 25 [C2 Regression]: should preserve ModuleResolver and ParameterResolver deterministic behavior', () => {
    const res = ModuleResolver.resolve({
      module_id: 'MODEL_SYNTH_DECAY',
      modules: [standardSyntheticModel]
    });
    expect(res.module_id).toBe('MODEL_SYNTH_DECAY');

    const paramsRes = ParameterResolver.resolve({
      module: standardSyntheticModel as any,
      available_parameters: Object.values(standardParameters)
    });
    expect(paramsRes.parameters['PARAM_K']).toBe(0.1);
    expect(paramsRes.snapshot).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // TEST 26 — Phase C3 Regression
  // ---------------------------------------------------------------------------
  it('Test 26 [C3 Regression]: should preserve standalone InputValidator range and unit validation', () => {
    const valResult = InputValidator.validate({
      module: {
        inputs: [
          { variable_id: 'x', name: 'x', unit: 'm', datatype: 'number', required: true }
        ]
      } as any,
      inputs: { x: { value: 5, unit: 'cm' } }
    });

    expect(valResult.valid).toBe(true);
    expect(valResult.normalized_inputs['x'].value).toBe(0.05);
  });

  // ---------------------------------------------------------------------------
  // TEST 27 — Phase C4 Regression
  // ---------------------------------------------------------------------------
  it('Test 27 [C4 Regression]: should preserve AlgorithmExecutor sequence, branching and fallback paths', () => {
    const alg: ScientificAlgorithm = {
      algorithm_id: 'ALG_C4_REGRESSION',
      name: 'Algorithm Regression Test',
      description: 'Verifies Phase C4 execution',
      version: '1.0.0',
      status: 'VERIFIED',
      inputs: [{ variable_id: 'val', name: 'val', unit: 'unitless', datatype: 'number', required: true }],
      outputs: [{ name: 'out', unit: 'unitless', datatype: 'number' }],
      parameter_ids: [],
      entry_step_id: 'STEP_1',
      steps: [
        { step_id: 'STEP_1', operation: 'SEQUENCE', next_step_id: 'STEP_OUT' },
        { step_id: 'STEP_OUT', operation: 'OUTPUT', is_terminal: true }
      ],
      reference_ids: [],
      created_by: 'system',
      created_at: '2026-09-23T00:00:00Z',
      updated_at: '2026-09-23T00:00:00Z'
    };

    const result = AlgorithmExecutor.execute({
      algorithm: alg,
      request: { module_id: 'ALG_C4_REGRESSION', inputs: { val: { value: 42 } } }
    });

    expect(result.execution_path).toEqual(['INPUT_VALIDATION', 'STEP_1', 'STEP_OUT']);
    expect(result.fallback_used).toBe(false);
  });
});
