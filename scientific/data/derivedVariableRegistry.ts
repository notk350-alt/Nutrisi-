/**
 * Phase D7 — Scientific Data Layer: Derived Variable Registry Store
 *
 * Implements an isolated, in-memory store for DerivedVariable definitions,
 * collision protection, version pinning enforcement, and execution plan resolution.
 *
 * Explicitly decoupled from:
 * - Scientific content / clinical boundaries
 * - AST calculations (delegated to Phase C)
 * - Automatic renaming or mutation
 */

import {
  DerivedVariable,
  DerivedVariableModuleType,
  RegistryStatus,
  ScientificDerivedVariableError
} from '../types';
import { findUnit } from '../units/unitConverter';
import { DatasetVersionStore, defaultDatasetVersionStore } from './datasetVersion';
import { defaultVariableStore, VariableStore } from './variableRegistry';
import { DependencyResolver } from './dependencyResolver';
import { areUnitsCompatible, deepFreeze, DerivedVariableValidator } from './derivedVariable';

export interface DerivedVariableFilter {
  dataset_version_id?: string;
  variable_id?: string;
  module_type?: DerivedVariableModuleType;
  status?: RegistryStatus;
  created_by?: string;
}

export class DerivedVariableStore {
  private derivedVariables: Map<string, DerivedVariable> = new Map();
  private datasetVersionStore?: DatasetVersionStore;
  private variableStore?: VariableStore;

  constructor(options?: {
    datasetVersionStore?: DatasetVersionStore;
    variableStore?: VariableStore;
  }) {
    this.datasetVersionStore = options?.datasetVersionStore;
    this.variableStore = options?.variableStore;
  }

  private deepClone<T>(obj: T): T {
    return JSON.parse(JSON.stringify(obj));
  }

  /**
   * Registers a new DerivedVariable in the store.
   * Enforces collision protection, immutability, and version binding.
   */
  public create(derivedVariable: DerivedVariable): DerivedVariable {
    DerivedVariableValidator.assertValid(derivedVariable);

    // 1. Check duplicate derived_variable_id
    if (this.derivedVariables.has(derivedVariable.derived_variable_id)) {
      throw new ScientificDerivedVariableError(
        'DERIVED_VARIABLE_ALREADY_EXISTS',
        `DerivedVariable with ID "${derivedVariable.derived_variable_id}" already exists.`
      );
    }

    // 2. Collision protection: Check duplicate variable_id within same dataset_version_id
    for (const existing of this.derivedVariables.values()) {
      if (
        existing.dataset_version_id === derivedVariable.dataset_version_id &&
        existing.variable_id === derivedVariable.variable_id
      ) {
        throw new ScientificDerivedVariableError(
          'DERIVED_VARIABLE_COLLISION',
          `Collision detected: Target variable "${derivedVariable.variable_id}" is already derived by "${existing.derived_variable_id}" in dataset version "${derivedVariable.dataset_version_id}". Auto-renaming is strictly forbidden.`
        );
      }
    }

    // 3. Verify dataset version exists if datasetVersionStore is attached
    if (this.datasetVersionStore) {
      const dv = this.datasetVersionStore.get(derivedVariable.dataset_version_id);
      if (!dv) {
        throw new ScientificDerivedVariableError(
          'DERIVED_VARIABLE_DATASET_VERSION_MISMATCH',
          `DatasetVersion "${derivedVariable.dataset_version_id}" not found in DatasetVersionStore.`
        );
      }
    }

    // 4. Verify source variables exist in variable registry if variableStore is attached
    if (this.variableStore) {
      for (const srcVarId of derivedVariable.source_variables) {
        // If it's another derived variable registered in this dataset version, that's allowed as a dependency
        const isDerived = Array.from(this.derivedVariables.values()).some(
          d => d.dataset_version_id === derivedVariable.dataset_version_id && d.variable_id === srcVarId
        );

        if (!isDerived && !this.variableStore.get(srcVarId)) {
          throw new ScientificDerivedVariableError(
            'DERIVED_VARIABLE_UNRESOLVED_DEPENDENCY',
            `Source variable "${srcVarId}" does not exist in the Variable Registry nor as a preceding derived variable.`
          );
        }
      }

      // 5. Verify unit compatibility between output_contract and registered variable if registered
      const targetVar = this.variableStore.get(derivedVariable.variable_id);
      if (targetVar) {
        if (targetVar.unit && derivedVariable.output_contract?.unit) {
          const compatible = areUnitsCompatible(targetVar.unit, derivedVariable.output_contract.unit);
          if (!compatible) {
            throw new ScientificDerivedVariableError(
              'DERIVED_VARIABLE_INCOMPATIBLE_UNIT',
              `Output contract unit "${derivedVariable.output_contract.unit}" is incompatible with registered variable "${targetVar.variable_id}" unit "${targetVar.unit}".`
            );
          }
        }
      }
    }

    const cloned = deepFreeze(this.deepClone(derivedVariable));
    this.derivedVariables.set(derivedVariable.derived_variable_id, cloned);
    return this.deepClone(cloned);
  }

  /**
   * Retrieves a DerivedVariable by derived_variable_id.
   */
  public get(derivedVariableId: string): DerivedVariable | undefined {
    const item = this.derivedVariables.get(derivedVariableId);
    return item ? this.deepClone(item) : undefined;
  }

  /**
   * Checks if a DerivedVariable exists by derived_variable_id.
   */
  public has(derivedVariableId: string): boolean {
    return this.derivedVariables.has(derivedVariableId);
  }

  /**
   * Lists derived variables matching an optional filter.
   */
  public list(filter?: DerivedVariableFilter): DerivedVariable[] {
    const results: DerivedVariable[] = [];

    for (const dv of this.derivedVariables.values()) {
      if (filter) {
        if (filter.dataset_version_id && dv.dataset_version_id !== filter.dataset_version_id) continue;
        if (filter.variable_id && dv.variable_id !== filter.variable_id) continue;
        if (filter.module_type && dv.module_type !== filter.module_type) continue;
        if (filter.status && dv.status !== filter.status) continue;
        if (filter.created_by && dv.created_by !== filter.created_by) continue;
      }
      results.push(this.deepClone(dv));
    }

    return results.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.derived_variable_id.localeCompare(b.derived_variable_id));
  }

  /**
   * Returns all derived variables for a specific dataset version.
   */
  public findByDatasetVersion(datasetVersionId: string): DerivedVariable[] {
    return this.list({ dataset_version_id: datasetVersionId });
  }

  /**
   * Resolves the deterministic execution plan (topologically sorted) for all derived variables
   * bound to a given dataset version.
   */
  public resolveExecutionPlan(datasetVersionId: string): DerivedVariable[] {
    const vars = this.findByDatasetVersion(datasetVersionId);
    if (vars.length === 0) return [];

    const order = DependencyResolver.resolveExecutionOrder(vars);
    const byId = new Map(vars.map(v => [v.derived_variable_id, v]));

    return order.map(id => byId.get(id)!).filter(Boolean);
  }

  /**
   * Clears the store (used for test isolation).
   */
  public clear(): void {
    this.derivedVariables.clear();
  }
}

export const defaultDerivedVariableStore = new DerivedVariableStore({
  datasetVersionStore: defaultDatasetVersionStore,
  variableStore: defaultVariableStore
});
