/**
 * NutriBodySim — Scientific Parameter Resolver
 * 
 * Phase C2: Module Resolver & Parameter Resolver
 * Resolves exact parameter versions, parameter sets, and builds immutable
 * execution snapshots to guarantee determinism and provenance integrity.
 * 
 * Pure Scientific Core component: Zero dependencies on DOM, React, Express, or Database.
 */

import {
  RegistryStatus,
  ScientificFormula,
  ScientificParameter,
  ParameterSet,
  ParameterSnapshot,
  ParameterSnapshotEntry,
  ScientificResolverError
} from '../types';
import { compareSemver, getStatusWeight } from './moduleResolver';

export interface ResolveParametersOptions {
  module: ScientificFormula;
  parameter_set_id?: string;
  parameter_overrides?: Record<string, number | string | boolean | number[]>;
  execution_context?: {
    allow_draft?: boolean;
    [key: string]: unknown;
  };
  available_parameters: ScientificParameter[];
  available_parameter_sets?: ParameterSet[];
}

export interface ResolvedParameters {
  parameter_set_id?: string;
  parameters: Record<string, number | string | boolean | number[]>;
  parameter_versions: Record<string, string>;
  snapshot: ParameterSnapshot;
  resolution_reason: string;
}

export class ParameterResolver {
  /**
   * Deterministically resolves parameters for a module execution and constructs an immutable snapshot.
   */
  static resolve(options: ResolveParametersOptions): ResolvedParameters {
    const {
      module,
      parameter_set_id,
      parameter_overrides,
      execution_context,
      available_parameters,
      available_parameter_sets = []
    } = options;

    const requiredParameterIds = module.parameter_ids || [];
    const resolvedValues: Record<string, number | string | boolean | number[]> = {};
    const resolvedVersions: Record<string, string> = {};
    const snapshotEntries: Record<string, ParameterSnapshotEntry> = {};

    let targetParameterSet: ParameterSet | undefined;
    if (parameter_set_id) {
      targetParameterSet = available_parameter_sets.find(s => s.set_id === parameter_set_id);
      if (!targetParameterSet) {
        throw new ScientificResolverError(
          'PARAMETER_SET_NOT_FOUND',
          `Parameter set "${parameter_set_id}" not found in registry.`,
          { parameter_set_id, available_sets: available_parameter_sets.map(s => s.set_id) }
        );
      }
    }

    for (const pId of requiredParameterIds) {
      const candidates = available_parameters.filter(p => p.parameter_id === pId);
      const setItem = targetParameterSet?.parameters?.[pId];

      let selectedParam: ScientificParameter | undefined;

      // 1. If parameter set specifies an exact version for this parameter
      if (setItem?.parameter_version) {
        const exactMatches = candidates.filter(p => p.version === setItem.parameter_version);
        if (exactMatches.length === 0) {
          throw new ScientificResolverError(
            'PARAMETER_VERSION_NOT_FOUND',
            `Parameter "${pId}" version "${setItem.parameter_version}" specified in parameter set "${parameter_set_id}" was not found.`,
            { parameter_id: pId, requested_version: setItem.parameter_version, parameter_set_id }
          );
        }
        if (exactMatches.length > 1) {
          throw new ScientificResolverError(
            'PARAMETER_RESOLUTION_AMBIGUOUS',
            `Ambiguous parameter resolution: multiple definitions of "${pId}" version "${setItem.parameter_version}" found.`,
            { parameter_id: pId, version: setItem.parameter_version }
          );
        }
        selectedParam = exactMatches[0];
      } else {
        // 2. Resolve default version for this parameter
        if (candidates.length === 0) {
          throw new ScientificResolverError(
            'PARAMETER_REQUIRED_MISSING',
            `Required parameter "${pId}" for module "${module.formula_id || module.module_id || 'unknown'}" not found in parameter pool.`,
            { parameter_id: pId, module_id: module.formula_id || module.module_id }
          );
        }

        const eligible = candidates.filter(p => {
          if (p.status === 'DEPRECATED') return false;
          if (p.status === 'DRAFT' && !execution_context?.allow_draft) return false;
          return true;
        });

        if (eligible.length === 0) {
          throw new ScientificResolverError(
            'PARAMETER_VERSION_NOT_FOUND',
            `No active executable version found for required parameter "${pId}". All available versions are DRAFT or DEPRECATED.`,
            { parameter_id: pId, candidates_count: candidates.length }
          );
        }

        const maxWeight = Math.max(...eligible.map(p => getStatusWeight(p.status)));
        const topTier = eligible.filter(p => getStatusWeight(p.status) === maxWeight);
        topTier.sort((a, b) => compareSemver(b.version, a.version));

        if (topTier.length > 1 && compareSemver(topTier[0].version, topTier[1].version) === 0) {
          throw new ScientificResolverError(
            'PARAMETER_RESOLUTION_AMBIGUOUS',
            `Ambiguous parameter resolution for "${pId}": multiple candidates in status "${topTier[0].status}" share identical version "${topTier[0].version}".`,
            { parameter_id: pId, candidates: topTier.map(c => ({ version: c.version, status: c.status })) }
          );
        }

        selectedParam = topTier[0];
      }

      // Determine final parameter value (precedence: direct override > parameter set value_override > resolved param value)
      let finalValue = selectedParam.value;
      if (setItem?.value_override !== undefined) {
        finalValue = setItem.value_override;
      }
      if (parameter_overrides && parameter_overrides[pId] !== undefined) {
        finalValue = parameter_overrides[pId];
      }

      resolvedValues[pId] = finalValue as number | string | boolean | number[];
      resolvedVersions[pId] = selectedParam.version || '1.0.0';

      // Build frozen snapshot entry
      const entry: ParameterSnapshotEntry = Object.freeze({
        parameter_id: pId,
        parameter_version: selectedParam.version || '1.0.0',
        name: selectedParam.name,
        value: finalValue as number | string | boolean | number[],
        unit: selectedParam.unit,
        reference_ids: selectedParam.reference_ids ? Object.freeze([...selectedParam.reference_ids]) as unknown as string[] : undefined,
        status: selectedParam.status,
        is_constant: selectedParam.is_constant
      });

      snapshotEntries[pId] = entry;
    }

    // Build immutable snapshot object
    const snapshot: ParameterSnapshot = Object.freeze({
      snapshot_id: `SNAP_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      timestamp: new Date().toISOString(),
      parameter_set_id,
      entries: Object.freeze(snapshotEntries)
    });

    const resolution_reason = parameter_set_id
      ? `Resolved via parameter set "${parameter_set_id}" with ${Object.keys(snapshotEntries).length} parameters.`
      : `Default parameter resolution: ${Object.keys(snapshotEntries).length} parameters resolved by lifecycle priority and semver.`;

    return {
      parameter_set_id,
      parameters: resolvedValues,
      parameter_versions: resolvedVersions,
      snapshot,
      resolution_reason
    };
  }
}

/**
 * Converts an immutable ParameterSnapshot into a dictionary of ScientificParameter objects
 * compatible with the AST CalculationEngine input contract.
 */
export function snapshotToScientificParameters(
  snapshot: ParameterSnapshot
): Record<string, ScientificParameter> {
  const result: Record<string, ScientificParameter> = {};
  for (const [pId, entry] of Object.entries(snapshot.entries)) {
    result[pId] = {
      parameter_id: entry.parameter_id,
      name: entry.name,
      description: `Parameter resolved from snapshot (version ${entry.parameter_version})`,
      value: entry.value,
      unit: entry.unit || '',
      version: entry.parameter_version,
      status: entry.status || 'VERIFIED',
      reference_ids: entry.reference_ids ? [...entry.reference_ids] : [],
      is_constant: entry.is_constant ?? true,
      created_at: snapshot.timestamp,
      updated_at: snapshot.timestamp
    };
  }
  return result;
}
