/**
 * Phase D15 — Scientific Data Layer: Interpretation Profile & Rule Registry
 *
 * Implements centralized, audited governance for InterpretationProfiles and InterpretationRules.
 *
 * Governance Rules:
 * 1. Default lifecycle status is DRAFT.
 * 2. Status transitions follow strict lifecycle: DRAFT -> REVIEW -> APPROVED -> DEPRECATED.
 * 3. Moving to APPROVED requires governance metadata (approved_by, approved_at, source reference).
 * 4. All stored profiles and rules are defensively cloned and deep-frozen.
 */

import {
  GovernedInterpretationRule,
  GovernanceMetadata,
  InterpretationProfile,
  ProfileStatus,
  ScientificInterpretationError,
  validateInterpretationProfile,
  validateInterpretationRule
} from './interpretationContracts';
import { deepFreeze } from './dataStatePipeline';

export class InterpretationRegistry {
  private profiles = new Map<string, InterpretationProfile>();

  /**
   * Helper key generation for profile versioning.
   */
  private profileKey(profileId: string, version?: string): string {
    return version ? `${profileId}@${version}` : profileId;
  }

  /**
   * Registers a new InterpretationProfile.
   * New profiles must never automatically become APPROVED unless created with explicit governance metadata.
   */
  public registerProfile(profile: InterpretationProfile): void {
    validateInterpretationProfile(profile);

    // Validate rules within the profile
    if (profile.rules && profile.rules.length > 0) {
      for (const rule of profile.rules) {
        validateInterpretationRule(rule);
      }
    }

    const key = this.profileKey(profile.profile_id, profile.profile_version);
    const latestKey = profile.profile_id;

    // Defensive clone and freeze
    const cloned: InterpretationProfile = deepFreeze(JSON.parse(JSON.stringify(profile)));

    this.profiles.set(key, cloned);
    this.profiles.set(latestKey, cloned);
  }

  /**
   * Retrieves an InterpretationProfile by ID and optional version.
   */
  public getProfile(profileId: string, version?: string): InterpretationProfile | undefined {
    const key = this.profileKey(profileId, version);
    const profile = this.profiles.get(key);
    if (!profile) return undefined;
    // Return deep-frozen defensive clone
    return deepFreeze(JSON.parse(JSON.stringify(profile)));
  }

  /**
   * Lists all registered unique profiles (latest versions).
   */
  public listProfiles(): InterpretationProfile[] {
    const seen = new Set<string>();
    const list: InterpretationProfile[] = [];

    for (const [key, profile] of this.profiles.entries()) {
      if (!key.includes('@')) {
        if (!seen.has(profile.profile_id)) {
          seen.add(profile.profile_id);
          list.push(deepFreeze(JSON.parse(JSON.stringify(profile))));
        }
      }
    }

    return list.sort((a, b) => a.profile_id.localeCompare(b.profile_id));
  }

  /**
   * Updates lifecycle status of a profile following strict governance rules.
   */
  public updateProfileStatus(
    profileId: string,
    newStatus: ProfileStatus,
    governance?: GovernanceMetadata,
    version?: string
  ): InterpretationProfile {
    const existing = this.getProfile(profileId, version);
    if (!existing) {
      throw new ScientificInterpretationError(
        'INTERPRETATION_INVALID_PROFILE',
        `Profile '${profileId}' not found in registry`
      );
    }

    const currentStatus = existing.status;
    if (currentStatus === newStatus) {
      return existing;
    }

    // Lifecycle validation
    const validTransitions: Record<ProfileStatus, ProfileStatus[]> = {
      DRAFT: ['REVIEW', 'DEPRECATED'],
      REVIEW: ['APPROVED', 'DRAFT', 'DEPRECATED'],
      APPROVED: ['DEPRECATED'],
      DEPRECATED: []
    };

    if (!validTransitions[currentStatus].includes(newStatus)) {
      throw new ScientificInterpretationError(
        'INTERPRETATION_INVALID_LIFECYCLE_TRANSITION',
        `Cannot transition profile status from '${currentStatus}' to '${newStatus}'`
      );
    }

    // Approval requirement enforcement
    if (newStatus === 'APPROVED') {
      const approvedBy = governance?.approved_by ?? existing.governance_metadata?.approved_by;
      const approvedAt = governance?.approved_at ?? existing.governance_metadata?.approved_at;
      const sourceRef =
        governance?.source_reference ??
        existing.governance_metadata?.source_reference ??
        (existing.source_references && existing.source_references[0]?.citation);

      if (!approvedBy || !approvedAt || !sourceRef) {
        throw new ScientificInterpretationError(
          'INTERPRETATION_UNAPPROVED_PROFILE',
          'Transition to APPROVED requires governance metadata: approved_by, approved_at, and a verified source_reference'
        );
      }
    }

    const updatedProfile: InterpretationProfile = {
      ...existing,
      status: newStatus,
      updated_at: new Date().toISOString(),
      governance_metadata: {
        ...existing.governance_metadata,
        ...governance
      }
    };

    this.registerProfile(updatedProfile);
    return this.getProfile(profileId, version)!;
  }

  /**
   * Adds or updates a rule in a profile.
   */
  public addRuleToProfile(profileId: string, rule: GovernedInterpretationRule, version?: string): void {
    validateInterpretationRule(rule);
    const profile = this.getProfile(profileId, version);
    if (!profile) {
      throw new ScientificInterpretationError(
        'INTERPRETATION_INVALID_PROFILE',
        `Profile '${profileId}' not found`
      );
    }

    if (profile.status === 'DEPRECATED') {
      throw new ScientificInterpretationError(
        'INTERPRETATION_INVALID_PROFILE',
        `Cannot add rules to a DEPRECATED profile '${profileId}'`
      );
    }

    const existingRuleIndex = profile.rules.findIndex((r) => r.rule_id === rule.rule_id);
    const updatedRules = [...profile.rules];

    if (existingRuleIndex >= 0) {
      updatedRules[existingRuleIndex] = rule;
    } else {
      updatedRules.push(rule);
    }

    const updatedProfile: InterpretationProfile = {
      ...profile,
      rules: updatedRules,
      updated_at: new Date().toISOString()
    };

    this.registerProfile(updatedProfile);
  }

  /**
   * Retrieves all rules associated with a profile.
   */
  public getRulesForProfile(profileId: string, version?: string): GovernedInterpretationRule[] {
    const profile = this.getProfile(profileId, version);
    if (!profile) return [];
    return deepFreeze(JSON.parse(JSON.stringify(profile.rules)));
  }
}
