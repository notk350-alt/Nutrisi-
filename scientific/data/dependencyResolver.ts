/**
 * Phase D7 — Scientific Data Layer: Dependency Resolver & Cycle Detection
 *
 * Implements deterministic dependency graph analysis, cycle detection (self, direct, indirect),
 * and topological sorting for derived variables.
 *
 * Core Invariants:
 * 1. Deterministic Resolution: Stable topological sort order with lexicographical tie-breaking.
 * 2. Strict Cycle Rejection: Detects A -> A, A -> B -> A, A -> B -> C -> A.
 * 3. Multi-dependency support: A -> B, A + B -> C, nested trees.
 * 4. Zero runtime code generation or dynamic execution.
 */

import {
  DerivedVariable,
  ScientificDerivedVariableError
} from '../types';

export interface DependencyGraphNode {
  derived_variable_id: string;
  variable_id: string;
  dependencies: string[]; // derived_variable_ids this node depends upon
}

export interface DependencyAnalysisResult {
  hasCycles: boolean;
  cycles: string[][];
  executionOrder: string[]; // derived_variable_ids in deterministic execution order
  graph: Record<string, string[]>; // derived_variable_id -> dependent derived_variable_ids
}

export class DependencyResolver {
  /**
   * Builds an explicit dependency graph from a collection of DerivedVariables.
   * Maps each DerivedVariable to the other DerivedVariables it depends on.
   */
  public static buildGraph(derivedVariables: DerivedVariable[]): Map<string, Set<string>> {
    // Index by derived_variable_id and by target variable_id
    const byDerivedId = new Map<string, DerivedVariable>();
    const byVarId = new Map<string, string>(); // variable_id -> derived_variable_id

    for (const dv of derivedVariables) {
      byDerivedId.set(dv.derived_variable_id, dv);
      // Map variable_id to derived_variable_id if produced by this derivation
      byVarId.set(dv.variable_id, dv.derived_variable_id);
    }

    const graph = new Map<string, Set<string>>(); // dvId -> Set of dvIds it depends upon

    for (const dv of derivedVariables) {
      const deps = new Set<string>();

      // 1. Direct self-dependency check on variable_id or derived_variable_id
      if (dv.source_variables && dv.source_variables.includes(dv.variable_id)) {
        throw new ScientificDerivedVariableError(
          'DERIVED_VARIABLE_SELF_DEPENDENCY',
          `Self-dependency detected: DerivedVariable "${dv.derived_variable_id}" depends on its own target variable "${dv.variable_id}".`,
          { derived_variable_id: dv.derived_variable_id, variable_id: dv.variable_id }
        );
      }

      if (dv.dependency_graph) {
        for (const explicitDep of dv.dependency_graph) {
          if (explicitDep === dv.derived_variable_id || explicitDep === dv.variable_id) {
            throw new ScientificDerivedVariableError(
              'DERIVED_VARIABLE_SELF_DEPENDENCY',
              `Self-dependency detected: DerivedVariable "${dv.derived_variable_id}" explicitly lists itself in dependency_graph.`,
              { derived_variable_id: dv.derived_variable_id }
            );
          }
        }
      }

      // 2. Resolve source_variables that are outputs of other derived variables
      for (const srcVar of dv.source_variables || []) {
        if (byVarId.has(srcVar)) {
          const supplierDvId = byVarId.get(srcVar)!;
          if (supplierDvId === dv.derived_variable_id) {
            throw new ScientificDerivedVariableError(
              'DERIVED_VARIABLE_SELF_DEPENDENCY',
              `Self-dependency detected: DerivedVariable "${dv.derived_variable_id}" depends on itself.`,
              { derived_variable_id: dv.derived_variable_id }
            );
          }
          deps.add(supplierDvId);
        }
      }

      // 3. Resolve explicit dependency_graph entries (which may be derived_variable_id or variable_id)
      if (dv.dependency_graph) {
        for (const depId of dv.dependency_graph) {
          if (byDerivedId.has(depId)) {
            deps.add(depId);
          } else if (byVarId.has(depId)) {
            deps.add(byVarId.get(depId)!);
          }
        }
      }

      graph.set(dv.derived_variable_id, deps);
    }

    return graph;
  }

  /**
   * Validates that the graph has no self or cyclic dependencies and returns the deterministic execution order.
   */
  public static resolveExecutionOrder(derivedVariables: DerivedVariable[]): string[] {
    const graph = this.buildGraph(derivedVariables);
    const sortedIds = Array.from(graph.keys()).sort();

    // Detect cycles using 3-color DFS
    const enum Color {
      WHITE = 0,
      GRAY = 1,
      BLACK = 2
    }

    const color = new Map<string, Color>();
    const parent = new Map<string, string | null>();

    for (const id of sortedIds) {
      color.set(id, Color.WHITE);
      parent.set(id, null);
    }

    const order: string[] = [];

    const dfs = (u: string, path: string[]) => {
      color.set(u, Color.GRAY);
      path.push(u);

      const neighbors = Array.from(graph.get(u) || []).sort();
      for (const v of neighbors) {
        if (v === u) {
          throw new ScientificDerivedVariableError(
            'DERIVED_VARIABLE_SELF_DEPENDENCY',
            `Self-dependency detected in "${u}".`,
            { cycle: [u, u] }
          );
        }

        const vColor = color.get(v) ?? Color.WHITE;
        if (vColor === Color.GRAY) {
          // Cycle detected!
          const cycleStartIndex = path.indexOf(v);
          const cyclePath = path.slice(cycleStartIndex).concat(v);
          throw new ScientificDerivedVariableError(
            'DERIVED_VARIABLE_CYCLIC_DEPENDENCY',
            `Cyclic dependency detected: ${cyclePath.join(' -> ')}.`,
            { cycle: cyclePath }
          );
        }

        if (vColor === Color.WHITE) {
          parent.set(v, u);
          dfs(v, path);
        }
      }

      color.set(u, Color.BLACK);
      path.pop();
      order.push(u);
    };

    for (const id of sortedIds) {
      if (color.get(id) === Color.WHITE) {
        dfs(id, []);
      }
    }

    // `order` currently has dependencies after dependents or vice versa:
    // When u depends on v, u -> v in our graph map (graph.get(u) contains v).
    // In DFS, v is finished before u is finished (or dfs goes u -> v -> finish v -> finish u).
    // Thus v enters order BEFORE u.
    // So order is [v, u], meaning v must be calculated before u!
    // This is already the correct topological execution order.
    return order;
  }

  /**
   * Full analysis of dependencies returning cycle info and execution plan.
   */
  public static analyze(derivedVariables: DerivedVariable[]): DependencyAnalysisResult {
    const graphMap = this.buildGraph(derivedVariables);
    const graphObj: Record<string, string[]> = {};
    for (const [k, v] of graphMap.entries()) {
      graphObj[k] = Array.from(v).sort();
    }

    try {
      const executionOrder = this.resolveExecutionOrder(derivedVariables);
      return {
        hasCycles: false,
        cycles: [],
        executionOrder,
        graph: graphObj
      };
    } catch (err) {
      if (err instanceof ScientificDerivedVariableError &&
         (err.code === 'DERIVED_VARIABLE_CYCLIC_DEPENDENCY' || err.code === 'DERIVED_VARIABLE_SELF_DEPENDENCY')) {
        const cycle = (err.details?.cycle as string[]) || [];
        return {
          hasCycles: true,
          cycles: cycle.length > 0 ? [cycle] : [],
          executionOrder: [],
          graph: graphObj
        };
      }
      throw err;
    }
  }
}
