/**
 * NutriBodySim — Scientific Module Resolver
 * 
 * Phase C2: Module Resolver & Parameter Resolver
 * Deterministically resolves a ScientificModule and its exact version
 * according to explicit lifecycle rules, preventing silent fallbacks and ambiguity.
 * 
 * Pure Scientific Core component: Zero dependencies on DOM, React, Express, or Database.
 */

import {
  RegistryStatus,
  ScientificAlgorithm,
  ScientificFormula,
  ScientificModel,
  ScientificResolverError
} from '../types';

export type ResolvableModule = ScientificFormula | ScientificAlgorithm | ScientificModel;

/**
 * Deterministic Semantic Version comparison helper.
 * Returns > 0 if v1 > v2, < 0 if v1 < v2, and 0 if equal.
 */
export function compareSemver(v1: string, v2: string): number {
  const parse = (v: string) => {
    const clean = v.trim().replace(/^v/, '');
    const parts = clean.split('-');
    const nums = parts[0].split('.').map(n => parseInt(n, 10) || 0);
    while (nums.length < 3) nums.push(0);
    return {
      major: nums[0],
      minor: nums[1],
      patch: nums[2],
      prerelease: parts[1] || undefined
    };
  };

  const p1 = parse(v1);
  const p2 = parse(v2);

  if (p1.major !== p2.major) return p1.major - p2.major;
  if (p1.minor !== p2.minor) return p1.minor - p2.minor;
  if (p1.patch !== p2.patch) return p1.patch - p2.patch;

  if (p1.prerelease && !p2.prerelease) return -1;
  if (!p1.prerelease && p2.prerelease) return 1;
  if (p1.prerelease && p2.prerelease) return p1.prerelease.localeCompare(p2.prerelease);

  return 0;
}

/**
 * Deterministic lifecycle tier weighting.
 * Locked order: VERIFIED (4) > VALIDATED/VALIDATION (3) > UNDER_REVIEW (2) > EXPERIMENTAL (1) > DRAFT (0) > DEPRECATED (-1)
 */
export function getStatusWeight(status: RegistryStatus): number {
  switch (status) {
    case 'VERIFIED':
      return 4;
    case 'VALIDATED':
    case 'VALIDATION':
      return 3;
    case 'UNDER_REVIEW':
      return 2;
    case 'EXPERIMENTAL':
      return 1;
    case 'DRAFT':
      return 0;
    case 'DEPRECATED':
      return -1;
    default:
      return 0;
  }
}

export interface ResolveModuleOptions<T extends ResolvableModule = ResolvableModule> {
  module_id: string;
  requested_version?: string;
  execution_context?: {
    allow_draft?: boolean;
    allow_deprecated?: boolean;
    [key: string]: unknown;
  };
  modules: T[];
}

export interface ResolvedModule<T extends ResolvableModule = ResolvableModule> {
  module_id: string;
  module_version: string;
  module: T;
  status: RegistryStatus;
  resolution_reason: string;
  is_historical_explicit?: boolean;
}

export class ModuleResolver {
  /**
   * Deterministically resolves a module from the provided module pool.
   * Throws ScientificResolverError on any missing module, missing version, lifecycle restriction, or ambiguity.
   */
  static resolve<T extends ResolvableModule = ResolvableModule>(
    options: ResolveModuleOptions<T>
  ): ResolvedModule<T> {
    const { module_id, requested_version, execution_context, modules } = options;

    if (!module_id) {
      throw new ScientificResolverError('MODULE_NOT_FOUND', 'Module ID is required for resolution.');
    }

    // Match by formula_id, algorithm_id, model_id, or module_id
    const candidates = modules.filter(
      m => (m as any).formula_id === module_id || (m as any).algorithm_id === module_id || (m as any).model_id === module_id || m.module_id === module_id
    );

    if (candidates.length === 0) {
      throw new ScientificResolverError(
        'MODULE_NOT_FOUND',
        `Module "${module_id}" not found in scientific registry.`,
        { module_id }
      );
    }

    // CASE A: Explicit requested_version provided
    if (requested_version !== undefined && requested_version.trim() !== '') {
      const exactMatches = candidates.filter(m => m.version === requested_version.trim());

      if (exactMatches.length === 0) {
        throw new ScientificResolverError(
          'MODULE_VERSION_NOT_FOUND',
          `Requested version "${requested_version}" for module "${module_id}" was not found. Available versions: ${candidates.map(c => c.version).join(', ')}.`,
          { module_id, requested_version, available_versions: candidates.map(c => c.version) }
        );
      }

      if (exactMatches.length > 1) {
        throw new ScientificResolverError(
          'MODULE_RESOLUTION_AMBIGUOUS',
          `Ambiguous resolution: multiple entries found for module "${module_id}" with version "${requested_version}".`,
          { module_id, requested_version, count: exactMatches.length }
        );
      }

      const match = exactMatches[0];

      // Check lifecycle rules
      if (match.status === 'DRAFT' && !execution_context?.allow_draft) {
        throw new ScientificResolverError(
          'MODULE_VERSION_NOT_EXECUTABLE',
          `Module "${module_id}" version "${requested_version}" has status DRAFT and cannot be executed in normal mode.`,
          { module_id, version: requested_version, status: match.status }
        );
      }

      if (match.status === 'DEPRECATED') {
        return {
          module_id,
          module_version: match.version,
          module: match,
          status: match.status,
          resolution_reason: 'Explicit historical version requested for deprecated module',
          is_historical_explicit: true
        };
      }

      return {
        module_id,
        module_version: match.version,
        module: match,
        status: match.status,
        resolution_reason: `Exact requested version "${match.version}" resolved.`,
        is_historical_explicit: false
      };
    }

    // CASE B: Unversioned request -> Deterministic default resolution
    // Exclude DRAFT and DEPRECATED from default selection
    const eligible = candidates.filter(m => {
      if (m.status === 'DEPRECATED') return false;
      if (m.status === 'DRAFT' && !execution_context?.allow_draft) return false;
      return true;
    });

    if (eligible.length === 0) {
      throw new ScientificResolverError(
        'MODULE_VERSION_NOT_EXECUTABLE',
        `No active executable version available for module "${module_id}". All available versions are DRAFT or DEPRECATED.`,
        { module_id, total_candidates: candidates.length }
      );
    }

    // Determine highest status weight
    const maxWeight = Math.max(...eligible.map(c => getStatusWeight(c.status)));
    const topTier = eligible.filter(c => getStatusWeight(c.status) === maxWeight);

    // Sort by semver descending
    topTier.sort((a, b) => compareSemver(b.version, a.version));

    // Check for ambiguity in top tier
    if (topTier.length > 1 && compareSemver(topTier[0].version, topTier[1].version) === 0) {
      throw new ScientificResolverError(
        'MODULE_RESOLUTION_AMBIGUOUS',
        `Ambiguous resolution for module "${module_id}": multiple candidates in status "${topTier[0].status}" share the identical semantic version "${topTier[0].version}".`,
        { module_id, candidates: topTier.map(c => ({ version: c.version, status: c.status })) }
      );
    }

    const winner = topTier[0];

    return {
      module_id,
      module_version: winner.version,
      module: winner,
      status: winner.status,
      resolution_reason: `Deterministic default resolution: highest lifecycle tier (${winner.status}) and highest semantic version (${winner.version}).`,
      is_historical_explicit: false
    };
  }
}
