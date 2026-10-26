/**
 * NutriBodySim — Scientific Data Validation Layer
 * 
 * Phase D6: Data Validation Engine & Profile Management
 * Validates actual dataset data against explicit, reproducible DataValidationProfiles.
 * 
 * Core Architectural Invariants:
 * 1. Software Test != Structural Validation != Data Validation != Scientific Validation.
 * 2. Pure Read-Only Evaluation: DatasetVersion, DataArtifact, and raw rows are NEVER mutated or auto-cleaned.
 * 3. Zero Scientific Invention: No hardcoded physiological/clinical boundaries or normal ranges;
 *    all limits and thresholds originate strictly from explicit profiles, variable registries, or configuration.
 * 4. Determinism & Security: Pure functions, reproducible results, zero eval(), zero new Function().
 * 5. Phase C ValidationEngine Integration: Seamless interoperability with Phase C validation infrastructure.
 */

import {
  DataArtifact,
  DataValidationCheck,
  DataValidationCheckConfig,
  DataValidationCheckResult,
  DataValidationCheckType,
  DataValidationConstraintOperator,
  DataValidationConstraintRule,
  DataValidationProfile,
  DataValidationProfileStatus,
  DataValidationResult,
  DataValidationViolation,
  DatasetVersion,
  ScientificDataValidationError,
  ValidationSeverity,
  ValidationStatus,
  ValidationSummary,
  Variable,
  VariableDataType
} from '../types';
import { UnitConverter } from '../units/unitConverter';
import { VariableStore, VariableStore as VariableRegistryStore } from './variableRegistry';
import { VariableMappingStore } from './variableMapping';

export { VariableRegistryStore };

// Deep freeze utility to ensure strict immutability
function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  Object.freeze(obj);
  for (const key of Object.keys(obj)) {
    const val = (obj as Record<string, unknown>)[key];
    if (val !== null && typeof val === 'object' && !Object.isFrozen(val)) {
      deepFreeze(val);
    }
  }
  return obj;
}

export const VALID_DATA_VALIDATION_CHECK_TYPES: readonly DataValidationCheckType[] = [
  'SCHEMA',
  'DATATYPE',
  'MISSINGNESS',
  'RANGE',
  'CATEGORY',
  'UNIT',
  'DUPLICATE',
  'NULLABILITY',
  'REQUIRED_VARIABLE',
  'CONSTRAINT'
] as const;

export const VALID_DATA_VALIDATION_PROFILE_STATUSES: readonly DataValidationProfileStatus[] = [
  'ACTIVE',
  'DRAFT',
  'DEPRECATED'
] as const;

export const VALID_CONSTRAINT_OPERATORS: readonly DataValidationConstraintOperator[] = [
  'EQ',
  'NEQ',
  'GT',
  'GTE',
  'LT',
  'LTE',
  'IN',
  'NOT_IN',
  'MATCHES_REGEX',
  'NON_EMPTY'
] as const;

// ============================================================================
// VALIDATION CONTRACT GUARDS
// ============================================================================

export class DataValidationValidator {
  static validateProfile(profile: unknown): asserts profile is DataValidationProfile {
    if (!profile || typeof profile !== 'object') {
      throw new ScientificDataValidationError(
        'DATA_VALIDATION_INVALID_CONTRACT',
        'DataValidationProfile must be a non-null object.'
      );
    }

    const p = profile as Record<string, unknown>;

    if (!p.profile_id || typeof p.profile_id !== 'string' || p.profile_id.trim() === '') {
      throw new ScientificDataValidationError(
        'DATA_VALIDATION_EMPTY_ID',
        'DataValidationProfile "profile_id" must be a non-empty string.'
      );
    }

    if (!p.name || typeof p.name !== 'string' || p.name.trim() === '') {
      throw new ScientificDataValidationError(
        'DATA_VALIDATION_INVALID_CONTRACT',
        'DataValidationProfile "name" must be a non-empty string.'
      );
    }

    if (!p.version || typeof p.version !== 'string' || p.version.trim() === '') {
      throw new ScientificDataValidationError(
        'DATA_VALIDATION_INVALID_CONTRACT',
        'DataValidationProfile "version" must be a non-empty string.'
      );
    }

    if (!VALID_DATA_VALIDATION_PROFILE_STATUSES.includes(p.status as DataValidationProfileStatus)) {
      throw new ScientificDataValidationError(
        'DATA_VALIDATION_INVALID_PROFILE',
        `DataValidationProfile "status" must be one of: ${VALID_DATA_VALIDATION_PROFILE_STATUSES.join(', ')}.`
      );
    }

    if (!Array.isArray(p.checks)) {
      throw new ScientificDataValidationError(
        'DATA_VALIDATION_INVALID_PROFILE',
        'DataValidationProfile "checks" must be an array.'
      );
    }

    for (const check of p.checks) {
      DataValidationValidator.validateCheck(check);
    }
  }

  static validateCheck(check: unknown): asserts check is DataValidationCheck {
    if (!check || typeof check !== 'object') {
      throw new ScientificDataValidationError(
        'DATA_VALIDATION_INVALID_CONTRACT',
        'DataValidationCheck must be a non-null object.'
      );
    }

    const c = check as Record<string, unknown>;

    if (!c.check_id || typeof c.check_id !== 'string' || c.check_id.trim() === '') {
      throw new ScientificDataValidationError(
        'DATA_VALIDATION_EMPTY_ID',
        'DataValidationCheck "check_id" must be a non-empty string.'
      );
    }

    if (!c.name || typeof c.name !== 'string' || c.name.trim() === '') {
      throw new ScientificDataValidationError(
        'DATA_VALIDATION_INVALID_CONTRACT',
        'DataValidationCheck "name" must be a non-empty string.'
      );
    }

    if (!VALID_DATA_VALIDATION_CHECK_TYPES.includes(c.type as DataValidationCheckType)) {
      throw new ScientificDataValidationError(
        'DATA_VALIDATION_INVALID_CHECK',
        `DataValidationCheck "type" must be one of: ${VALID_DATA_VALIDATION_CHECK_TYPES.join(', ')}.`
      );
    }

    if (typeof c.target !== 'string' || c.target.trim() === '') {
      throw new ScientificDataValidationError(
        'DATA_VALIDATION_INVALID_CHECK',
        'DataValidationCheck "target" must be a non-empty string.'
      );
    }

    if (typeof c.enabled !== 'boolean') {
      throw new ScientificDataValidationError(
        'DATA_VALIDATION_INVALID_CHECK',
        'DataValidationCheck "enabled" must be a boolean.'
      );
    }

    if (c.severity && !['ERROR', 'WARNING', 'CRITICAL', 'INFO'].includes(c.severity as string)) {
      throw new ScientificDataValidationError(
        'DATA_VALIDATION_INVALID_CHECK',
        'DataValidationCheck "severity" must be a valid ValidationSeverity.'
      );
    }
  }
}

// ============================================================================
// PROFILE STORE & VERSIONING
// ============================================================================

export class DataValidationProfileStore {
  private profiles = new Map<string, Map<string, DataValidationProfile>>();

  /**
   * Registers a new DataValidationProfile. Profiles are immutable once registered.
   */
  create(profile: DataValidationProfile): DataValidationProfile {
    DataValidationValidator.validateProfile(profile);

    const versionMap = this.profiles.get(profile.profile_id) || new Map<string, DataValidationProfile>();

    if (versionMap.has(profile.version)) {
      throw new ScientificDataValidationError(
        'DATA_VALIDATION_PROFILE_ALREADY_EXISTS',
        `DataValidationProfile "${profile.profile_id}" version "${profile.version}" already exists.`
      );
    }

    const frozen = deepFreeze({
      ...profile,
      checks: profile.checks.map(c => ({
        ...c,
        configuration: c.configuration ? { ...c.configuration } : undefined
      })),
      created_at: profile.created_at || new Date().toISOString(),
      metadata: profile.metadata ? { ...profile.metadata } : {}
    });

    versionMap.set(profile.version, frozen);
    this.profiles.set(profile.profile_id, versionMap);

    return frozen;
  }

  /**
   * Retrieves a specific version of a profile, or the latest version if version is omitted.
   */
  get(profileId: string, version?: string): DataValidationProfile | null {
    const versionMap = this.profiles.get(profileId);
    if (!versionMap || versionMap.size === 0) return null;

    if (version) {
      return versionMap.get(version) || null;
    }

    // Default to the last registered version
    const all = Array.from(versionMap.values());
    return all[all.length - 1] || null;
  }

  /**
   * Lists all versions for a given profile ID.
   */
  listVersions(profileId: string): DataValidationProfile[] {
    const versionMap = this.profiles.get(profileId);
    if (!versionMap) return [];
    return Array.from(versionMap.values());
  }

  /**
   * Lists all latest versions across all profiles.
   */
  listAll(): DataValidationProfile[] {
    const results: DataValidationProfile[] = [];
    for (const [id] of this.profiles) {
      const latest = this.get(id);
      if (latest) results.push(latest);
    }
    return results;
  }

  /**
   * Creates a new version of an existing profile.
   */
  createNewVersion(
    profileId: string,
    newVersion: string,
    updates: Partial<Omit<DataValidationProfile, 'profile_id' | 'version'>>
  ): DataValidationProfile {
    const existing = this.get(profileId);
    if (!existing) {
      throw new ScientificDataValidationError(
        'DATA_VALIDATION_PROFILE_NOT_FOUND',
        `Cannot create new version. DataValidationProfile "${profileId}" not found.`
      );
    }

    const versionMap = this.profiles.get(profileId)!;
    if (versionMap.has(newVersion)) {
      throw new ScientificDataValidationError(
        'DATA_VALIDATION_PROFILE_ALREADY_EXISTS',
        `Version "${newVersion}" already exists for DataValidationProfile "${profileId}".`
      );
    }

    const newProfile: DataValidationProfile = {
      profile_id: profileId,
      name: updates.name ?? existing.name,
      description: updates.description ?? existing.description,
      version: newVersion,
      status: updates.status ?? 'ACTIVE',
      checks: updates.checks ? updates.checks : existing.checks,
      created_at: new Date().toISOString(),
      created_by: updates.created_by ?? existing.created_by,
      metadata: {
        ...(existing.metadata || {}),
        ...(updates.metadata || {}),
        previous_version: existing.version
      }
    };

    return this.create(newProfile);
  }

  /**
   * Deprecates a profile version.
   */
  deprecate(profileId: string, version: string): DataValidationProfile {
    const existing = this.get(profileId, version);
    if (!existing) {
      throw new ScientificDataValidationError(
        'DATA_VALIDATION_PROFILE_NOT_FOUND',
        `DataValidationProfile "${profileId}" version "${version}" not found.`
      );
    }

    const updated: DataValidationProfile = {
      ...existing,
      status: 'DEPRECATED',
      metadata: {
        ...(existing.metadata || {}),
        deprecated_at: new Date().toISOString()
      }
    };

    const versionMap = this.profiles.get(profileId)!;
    const frozen = deepFreeze(updated);
    versionMap.set(version, frozen);
    return frozen;
  }
}

// ============================================================================
// DATA VALIDATION ENGINE
// ============================================================================

export interface ColumnDefinition {
  name: string;
  data_type?: VariableDataType | string;
  unit?: string;
  is_nullable?: boolean;
}

export interface DataValidationOptions {
  dataset_version: DatasetVersion;
  artifact: DataArtifact;
  profile: DataValidationProfile;
  records?: Record<string, unknown>[];
  columns?: Array<ColumnDefinition | string>;
  variable_registry?: VariableStore;
  variable_mapping?: VariableMappingStore;
  custom_timestamp?: string;
  created_by?: string;
  provenance_id?: string;
  metadata?: Record<string, unknown>;
}

export class DataValidationEngine {
  /**
   * Deterministically validates a dataset artifact against a DataValidationProfile.
   * Dataset, artifact, and registry inputs are treated as strictly read-only and never mutated.
   */
  static validate(options: DataValidationOptions): DataValidationResult {
    const {
      dataset_version,
      artifact,
      profile,
      records: explicitRecords,
      columns: explicitColumns,
      variable_registry,
      variable_mapping,
      custom_timestamp,
      created_by = 'SYSTEM_VALIDATOR',
      provenance_id,
      metadata = {}
    } = options;

    // 1. Guard check inputs
    if (!dataset_version || typeof dataset_version !== 'object') {
      throw new ScientificDataValidationError(
        'DATA_VALIDATION_DATASET_VERSION_NOT_FOUND',
        'DatasetVersion is undefined, null, or not an object.'
      );
    }

    if (!artifact || typeof artifact !== 'object') {
      throw new ScientificDataValidationError(
        'DATA_VALIDATION_ARTIFACT_NOT_FOUND',
        'DataArtifact is undefined, null, or not an object.'
      );
    }

    if (artifact.dataset_version_id !== dataset_version.version_id) {
      throw new ScientificDataValidationError(
        'DATA_VALIDATION_INVALID_CONTRACT',
        `Artifact dataset_version_id (${artifact.dataset_version_id}) does not match DatasetVersion version_id (${dataset_version.version_id}).`
      );
    }

    DataValidationValidator.validateProfile(profile);

    const startedAt = custom_timestamp || new Date().toISOString();

    // Extract records safely
    const records: Record<string, unknown>[] =
      explicitRecords ||
      (Array.isArray(artifact.data_reference) ? (artifact.data_reference as Record<string, unknown>[]) : []) ||
      (Array.isArray((artifact.data_reference as any)?.records) ? (artifact.data_reference as any).records : []) ||
      (Array.isArray(artifact.metadata?.records) ? (artifact.metadata.records as Record<string, unknown>[]) : []);

    // Extract columns safely
    let columns: ColumnDefinition[] = [];
    if (explicitColumns && explicitColumns.length > 0) {
      columns = explicitColumns.map(c => (typeof c === 'string' ? { name: c } : c));
    } else if (Array.isArray((dataset_version as any).columns) && (dataset_version as any).columns.length > 0) {
      columns = (dataset_version as any).columns.map((c: any) => (typeof c === 'string' ? { name: c } : c));
    } else if (Array.isArray(dataset_version.metadata?.columns) && (dataset_version.metadata.columns as any[]).length > 0) {
      columns = (dataset_version.metadata.columns as any[]).map((c: any) => (typeof c === 'string' ? { name: c } : c));
    } else if (records.length > 0) {
      columns = Object.keys(records[0]).map(name => ({ name }));
    }

    const checks = profile.checks || [];
    const checkResults: DataValidationCheckResult[] = [];
    const allErrors: string[] = [];
    const allWarnings: string[] = [];

    // 2. Evaluate enabled checks
    for (const check of checks) {
      if (!check.enabled) {
        checkResults.push({
          check_id: check.check_id,
          name: check.name,
          type: check.type,
          status: 'NOT_CONFIGURED',
          target: check.target,
          severity: check.severity || 'ERROR',
          observed: null,
          expected: 'Check disabled',
          violation_count: 0,
          sample_violations: [],
          message: `Check "${check.name}" is disabled.`,
          metadata: { enabled: false }
        });
        continue;
      }

      const result = DataValidationEngine.evaluateCheck(
        check,
        records,
        columns,
        dataset_version,
        variable_registry,
        variable_mapping
      );
      checkResults.push(result);

      if (result.status === 'FAIL') {
        allErrors.push(`[${check.check_id}] ${result.message}`);
      } else if (result.status === 'WARNING') {
        allWarnings.push(`[${check.check_id}] ${result.message}`);
      }
    }

    // 3. Compute summary
    const summary: ValidationSummary = {
      total: checkResults.length,
      passed: checkResults.filter(c => c.status === 'PASS').length,
      failed: checkResults.filter(c => c.status === 'FAIL').length,
      warnings: checkResults.filter(c => c.status === 'WARNING').length,
      unestablished: checkResults.filter(c => c.status === 'UNESTABLISHED').length,
      not_configured: checkResults.filter(c => c.status === 'NOT_CONFIGURED').length
    };

    // 4. Compute overall status
    let overallStatus: ValidationStatus = 'PASS';
    if (summary.failed > 0) {
      overallStatus = 'FAIL';
    } else if (summary.warnings > 0) {
      overallStatus = 'WARNING';
    } else if (summary.unestablished > 0) {
      overallStatus = 'UNESTABLISHED';
    } else if (summary.total === 0 || summary.not_configured === summary.total) {
      overallStatus = 'NOT_CONFIGURED';
    }

    const completedAt = custom_timestamp || new Date().toISOString();
    const validationId = `val_${artifact.artifact_id}_${profile.profile_id}_${profile.version}_${Date.now()}`;

    const validationResult: DataValidationResult = {
      validation_id: validationId,
      dataset_version_id: dataset_version.version_id,
      artifact_id: artifact.artifact_id,
      validation_profile_id: profile.profile_id,
      validation_profile_version: profile.version,
      status: overallStatus,
      started_at: startedAt,
      completed_at: completedAt,
      summary,
      checks: checkResults,
      errors: allErrors,
      warnings: allWarnings,
      created_by: created_by,
      provenance_id: provenance_id,
      metadata: {
        ...metadata,
        record_count: records.length,
        column_count: columns.length,
        scientific_validity: 'NOT_ESTABLISHED'
      }
    };

    return deepFreeze(validationResult);
  }

  /**
   * Dispatches evaluation to specialized check handlers.
   */
  private static evaluateCheck(
    check: DataValidationCheck,
    records: Record<string, unknown>[],
    columns: ColumnDefinition[],
    datasetVersion: DatasetVersion,
    variableRegistry?: VariableStore,
    variableMapping?: VariableMappingStore
  ): DataValidationCheckResult {
    const config: DataValidationCheckConfig = check.configuration || {};
    const severity: ValidationSeverity = check.severity || 'ERROR';

    switch (check.type) {
      case 'SCHEMA':
        return DataValidationEngine.evaluateSchemaCheck(check, columns, config, severity);

      case 'DATATYPE':
        return DataValidationEngine.evaluateDatatypeCheck(check, records, columns, config, severity);

      case 'MISSINGNESS':
        return DataValidationEngine.evaluateMissingnessCheck(check, records, config, severity);

      case 'RANGE':
        return DataValidationEngine.evaluateRangeCheck(check, records, datasetVersion, variableRegistry, variableMapping, config, severity);

      case 'CATEGORY':
        return DataValidationEngine.evaluateCategoryCheck(check, records, datasetVersion, variableRegistry, variableMapping, config, severity);

      case 'UNIT':
        return DataValidationEngine.evaluateUnitCheck(check, columns, variableRegistry, config, severity);

      case 'DUPLICATE':
        return DataValidationEngine.evaluateDuplicateCheck(check, records, config, severity);

      case 'NULLABILITY':
        return DataValidationEngine.evaluateNullabilityCheck(check, records, config, severity);

      case 'REQUIRED_VARIABLE':
        return DataValidationEngine.evaluateRequiredVariableCheck(check, datasetVersion, variableMapping, config, severity);

      case 'CONSTRAINT':
        return DataValidationEngine.evaluateConstraintCheck(check, records, config, severity);

      default:
        return {
          check_id: check.check_id,
          name: check.name,
          type: check.type,
          status: 'UNESTABLISHED',
          target: check.target,
          severity,
          observed: null,
          expected: null,
          violation_count: 0,
          sample_violations: [],
          message: `Unknown check type: ${check.type}`
        };
    }
  }

  // ==========================================================================
  // CHECK HANDLERS
  // ==========================================================================

  /**
   * 1. SCHEMA CHECK
   */
  private static evaluateSchemaCheck(
    check: DataValidationCheck,
    columns: ColumnDefinition[],
    config: DataValidationCheckConfig,
    severity: ValidationSeverity
  ): DataValidationCheckResult {
    const currentColumns = columns.map(c => c.name);
    const expectedColumns = config.expected_columns || [];
    const disallowUnexpected = config.disallow_unexpected_columns ?? false;
    const checkDuplicateCols = config.check_duplicate_columns ?? true;

    const violations: DataValidationViolation[] = [];

    // Check duplicate columns in dataset definition
    if (checkDuplicateCols) {
      const colCounts = new Map<string, number>();
      for (const col of currentColumns) {
        colCounts.set(col, (colCounts.get(col) || 0) + 1);
      }
      for (const [col, count] of colCounts) {
        if (count > 1) {
          violations.push({
            column: col,
            observed_value: count,
            expected_condition: 'Column names must be unique',
            message: `Duplicate column name "${col}" found ${count} times in schema.`
          });
        }
      }
    }

    // Check required expected columns
    for (const expCol of expectedColumns) {
      if (!currentColumns.includes(expCol)) {
        violations.push({
          column: expCol,
          observed_value: null,
          expected_condition: `Column "${expCol}" must exist in schema`,
          message: `Required column "${expCol}" is missing from dataset schema.`
        });
      }
    }

    // Check unexpected columns
    if (disallowUnexpected) {
      for (const curCol of currentColumns) {
        if (!expectedColumns.includes(curCol)) {
          violations.push({
            column: curCol,
            observed_value: curCol,
            expected_condition: `Column "${curCol}" is not in expected list`,
            message: `Unexpected column "${curCol}" found in dataset schema.`
          });
        }
      }
    }

    const sampleLimit = config.sample_limit ?? 20;
    const status: ValidationStatus = violations.length === 0 ? 'PASS' : severity === 'WARNING' ? 'WARNING' : 'FAIL';

    return {
      check_id: check.check_id,
      name: check.name,
      type: 'SCHEMA',
      status,
      target: check.target,
      severity,
      observed: { columns: currentColumns, column_count: currentColumns.length },
      expected: { expected_columns: expectedColumns, disallow_unexpected: disallowUnexpected },
      violation_count: violations.length,
      sample_violations: violations.slice(0, sampleLimit),
      message: violations.length === 0
        ? 'Schema validation passed successfully.'
        : `Schema validation found ${violations.length} violation(s).`
    };
  }

  /**
   * 2. DATATYPE CHECK
   */
  private static evaluateDatatypeCheck(
    check: DataValidationCheck,
    records: Record<string, unknown>[],
    columns: ColumnDefinition[],
    config: DataValidationCheckConfig,
    severity: ValidationSeverity
  ): DataValidationCheckResult {
    const colName = check.target;
    const colMeta = columns.find(c => c.name === colName);
    const expectedType = config.expected_data_type || colMeta?.data_type || 'STRING';
    const strictCheck = config.strict_type_check ?? false;

    const violations: DataValidationViolation[] = [];

    records.forEach((row, idx) => {
      const val = row[colName];
      if (val === null || val === undefined || val === '') return; // Handled by missingness/nullability

      let isValid = true;
      if (expectedType === 'INTEGER') {
        if (strictCheck) {
          isValid = typeof val === 'number' && Number.isInteger(val);
        } else {
          const num = typeof val === 'number' ? val : Number(val);
          isValid = !isNaN(num) && Number.isInteger(num);
        }
      } else if (expectedType === 'NUMBER') {
        if (strictCheck) {
          isValid = typeof val === 'number' && !isNaN(val);
        } else {
          const num = typeof val === 'number' ? val : Number(val);
          isValid = !isNaN(num);
        }
      } else if (expectedType === 'BOOLEAN') {
        if (strictCheck) {
          isValid = typeof val === 'boolean';
        } else {
          isValid = typeof val === 'boolean' || val === 'true' || val === 'false' || val === 1 || val === 0;
        }
      } else if (expectedType === 'DATE' || expectedType === 'DATETIME') {
        if (val instanceof Date) {
          isValid = !isNaN(val.getTime());
        } else if (typeof val === 'string') {
          isValid = !isNaN(Date.parse(val));
        } else {
          isValid = false;
        }
      } else if (expectedType === 'STRING') {
        isValid = typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean';
      }

      if (!isValid) {
        violations.push({
          row_index: idx,
          column: colName,
          observed_value: val,
          expected_condition: `Must be valid ${expectedType}`,
          message: `Row ${idx} column "${colName}" value "${String(val)}" does not conform to datatype ${expectedType}.`
        });
      }
    });

    const sampleLimit = config.sample_limit ?? 20;
    const status: ValidationStatus = violations.length === 0 ? 'PASS' : severity === 'WARNING' ? 'WARNING' : 'FAIL';

    return {
      check_id: check.check_id,
      name: check.name,
      type: 'DATATYPE',
      status,
      target: colName,
      severity,
      observed: { column: colName, total_records: records.length, non_conforming: violations.length },
      expected: { expected_type: expectedType, strict: strictCheck },
      violation_count: violations.length,
      sample_violations: violations.slice(0, sampleLimit),
      message: violations.length === 0
        ? `All values in column "${colName}" match expected datatype ${expectedType}.`
        : `Found ${violations.length} datatype violation(s) in column "${colName}".`
    };
  }

  /**
   * 3. MISSINGNESS CHECK
   */
  private static evaluateMissingnessCheck(
    check: DataValidationCheck,
    records: Record<string, unknown>[],
    config: DataValidationCheckConfig,
    severity: ValidationSeverity
  ): DataValidationCheckResult {
    const colName = check.target;
    const missingTokens = config.missing_tokens || ['NA', 'N/A', 'null', 'NULL', '-', 'NaN'];
    const warnThreshold = config.warning_missing_rate ?? 0.05; // 5%
    const errorThreshold = config.error_missing_rate ?? 0.20; // 20%

    let missingCount = 0;
    const violations: DataValidationViolation[] = [];

    records.forEach((row, idx) => {
      const val = row[colName];
      let isMissing = false;

      if (val === null || val === undefined || val === '') {
        isMissing = true;
      } else if (typeof val === 'number' && isNaN(val)) {
        isMissing = true;
      } else if (typeof val === 'string' && missingTokens.includes(val.trim())) {
        isMissing = true;
      }

      if (isMissing) {
        missingCount++;
        violations.push({
          row_index: idx,
          column: colName,
          observed_value: val,
          expected_condition: 'Non-missing value',
          message: `Row ${idx} column "${colName}" has missing value.`
        });
      }
    });

    const totalCount = records.length;
    const missingRate = totalCount > 0 ? missingCount / totalCount : 0;

    let status: ValidationStatus = 'PASS';
    if (missingRate >= errorThreshold && severity !== 'WARNING') {
      status = 'FAIL';
    } else if (missingRate >= warnThreshold) {
      status = 'WARNING';
    }

    const sampleLimit = config.sample_limit ?? 20;

    return {
      check_id: check.check_id,
      name: check.name,
      type: 'MISSINGNESS',
      status,
      target: colName,
      severity,
      observed: { missing_count: missingCount, total_count: totalCount, missing_rate: missingRate },
      expected: { warning_threshold: warnThreshold, error_threshold: errorThreshold },
      violation_count: missingCount,
      sample_violations: violations.slice(0, sampleLimit),
      message: `Column "${colName}" missing rate is ${(missingRate * 100).toFixed(2)}% (${missingCount}/${totalCount}).`
    };
  }

  /**
   * 4. RANGE CHECK
   */
  private static evaluateRangeCheck(
    check: DataValidationCheck,
    records: Record<string, unknown>[],
    datasetVersion?: DatasetVersion,
    variableRegistry?: VariableStore,
    variableMapping?: VariableMappingStore,
    config?: DataValidationCheckConfig,
    severity: ValidationSeverity = 'ERROR'
  ): DataValidationCheckResult {
    let colName = check.target;
    let regVar: Variable | undefined = variableRegistry?.get(check.target);

    if (variableMapping && datasetVersion) {
      const mappings = variableMapping.findByVariable(check.target, { dataset_version_id: datasetVersion.version_id, status: 'CONFIRMED' });
      if (mappings.length > 0) {
        colName = mappings[0].source_column;
      } else {
        const colMappings = variableMapping.findBySourceColumn(datasetVersion.version_id, check.target);
        if (colMappings.length > 0 && !regVar) {
          regVar = variableRegistry?.get(colMappings[0].variable_id);
        }
      }
    }

    let min = config?.min;
    let max = config?.max;
    const inclusiveMin = config?.inclusive_min ?? true;
    const inclusiveMax = config?.inclusive_max ?? true;
    let warningMin = config?.warning_min;
    let warningMax = config?.warning_max;

    // Optional lookup from VariableRegistry
    if (config?.use_variable_registry_range && regVar) {
      if (regVar.allowed_range) {
        min = min ?? regVar.allowed_range.min;
        max = max ?? regVar.allowed_range.max;
        warningMin = warningMin ?? regVar.allowed_range.warning_min;
        warningMax = warningMax ?? regVar.allowed_range.warning_max;
      }
    }

    const violations: DataValidationViolation[] = [];
    let hasWarning = false;
    let hasError = false;

    records.forEach((row, idx) => {
      const rawVal = row[colName];
      if (rawVal === null || rawVal === undefined || rawVal === '') return;

      const num = typeof rawVal === 'number' ? rawVal : Number(rawVal);
      if (isNaN(num)) return; // Type mismatch handled by DATATYPE check

      // Check strict error range
      let isOutOfErrorRange = false;
      if (min !== undefined) {
        if (inclusiveMin ? num < min : num <= min) isOutOfErrorRange = true;
      }
      if (max !== undefined) {
        if (inclusiveMax ? num > max : num >= max) isOutOfErrorRange = true;
      }

      if (isOutOfErrorRange) {
        hasError = true;
        violations.push({
          row_index: idx,
          column: colName,
          observed_value: num,
          expected_condition: `Range [${min ?? '-∞'}, ${max ?? '+∞'}]`,
          message: `Row ${idx} value ${num} is outside allowed range [${min ?? '-∞'}, ${max ?? '+∞'}].`
        });
        return;
      }

      // Check warning range
      let isOutOfWarningRange = false;
      if (warningMin !== undefined && num < warningMin) isOutOfWarningRange = true;
      if (warningMax !== undefined && num > warningMax) isOutOfWarningRange = true;

      if (isOutOfWarningRange) {
        hasWarning = true;
        violations.push({
          row_index: idx,
          column: colName,
          observed_value: num,
          expected_condition: `Warning range [${warningMin ?? '-∞'}, ${warningMax ?? '+∞'}]`,
          message: `Row ${idx} value ${num} falls into warning range [${warningMin ?? '-∞'}, ${warningMax ?? '+∞'}].`
        });
      }
    });

    let status: ValidationStatus = 'PASS';
    if (hasError) {
      status = severity === 'WARNING' ? 'WARNING' : 'FAIL';
    } else if (hasWarning) {
      status = 'WARNING';
    }

    const sampleLimit = config?.sample_limit ?? 20;

    return {
      check_id: check.check_id,
      name: check.name,
      type: 'RANGE',
      status,
      target: colName,
      severity,
      observed: { column: colName, violations_count: violations.length },
      expected: { min, max, warning_min: warningMin, warning_max: warningMax },
      violation_count: violations.length,
      sample_violations: violations.slice(0, sampleLimit),
      message: violations.length === 0
        ? `All values in column "${colName}" are within range.`
        : `Found ${violations.length} range violation(s) in column "${colName}".`
    };
  }

  /**
   * 5. CATEGORY CHECK
   */
  private static evaluateCategoryCheck(
    check: DataValidationCheck,
    records: Record<string, unknown>[],
    datasetVersion?: DatasetVersion,
    variableRegistry?: VariableStore,
    variableMapping?: VariableMappingStore,
    config?: DataValidationCheckConfig,
    severity: ValidationSeverity = 'ERROR'
  ): DataValidationCheckResult {
    let colName = check.target;
    let regVar: Variable | undefined = variableRegistry?.get(check.target);

    if (variableMapping && datasetVersion) {
      const mappings = variableMapping.findByVariable(check.target, { dataset_version_id: datasetVersion.version_id, status: 'CONFIRMED' });
      if (mappings.length > 0) {
        colName = mappings[0].source_column;
      } else {
        const colMappings = variableMapping.findBySourceColumn(datasetVersion.version_id, check.target);
        if (colMappings.length > 0 && !regVar) {
          regVar = variableRegistry?.get(colMappings[0].variable_id);
        }
      }
    }

    let allowed = config?.allowed_categories || [];
    const caseSensitive = config?.case_sensitive ?? true;

    if (config?.use_variable_registry_categories && regVar) {
      const cats = regVar.categories || (regVar as any).allowed_categories;
      if (cats && cats.length > 0) {
        allowed = cats;
      }
    }

    const normalizedAllowed = caseSensitive
      ? new Set(allowed.map(String))
      : new Set(allowed.map(a => String(a).toLowerCase()));

    const violations: DataValidationViolation[] = [];

    records.forEach((row, idx) => {
      const val = row[colName];
      if (val === null || val === undefined || val === '') return;

      const testStr = caseSensitive ? String(val) : String(val).toLowerCase();
      if (!normalizedAllowed.has(testStr)) {
        violations.push({
          row_index: idx,
          column: colName,
          observed_value: val,
          expected_condition: `One of: [${allowed.join(', ')}]`,
          message: `Row ${idx} value "${String(val)}" is not in allowed categories.`
        });
      }
    });

    const sampleLimit = config?.sample_limit ?? 20;
    const status: ValidationStatus = violations.length === 0 ? 'PASS' : severity === 'WARNING' ? 'WARNING' : 'FAIL';

    return {
      check_id: check.check_id,
      name: check.name,
      type: 'CATEGORY',
      status,
      target: colName,
      severity,
      observed: { column: colName, invalid_count: violations.length },
      expected: { allowed_categories: allowed, case_sensitive: caseSensitive },
      violation_count: violations.length,
      sample_violations: violations.slice(0, sampleLimit),
      message: violations.length === 0
        ? `All categories in column "${colName}" are valid.`
        : `Found ${violations.length} category violation(s) in column "${colName}".`
    };
  }

  /**
   * 6. UNIT CHECK
   */
  private static evaluateUnitCheck(
    check: DataValidationCheck,
    columns: ColumnDefinition[],
    variableRegistry?: VariableStore,
    config?: DataValidationCheckConfig,
    severity: ValidationSeverity = 'ERROR'
  ): DataValidationCheckResult {
    const target = check.target;
    const colMeta = columns.find(c => c.name === target);
    const columnUnit = config?.column_unit || colMeta?.unit || '';
    const expectedUnit = config?.expected_unit || '';
    const checkDimension = config?.check_dimension ?? true;

    const violations: DataValidationViolation[] = [];

    if (!columnUnit && expectedUnit) {
      violations.push({
        column: target,
        observed_value: null,
        expected_condition: `Unit "${expectedUnit}"`,
        message: `Column "${target}" has no unit specified (expected "${expectedUnit}").`
      });
    } else if (columnUnit && expectedUnit) {
      if (columnUnit === expectedUnit) {
        // Exact match
      } else {
        const canConvert = UnitConverter.canConvert(columnUnit, expectedUnit);
        if (!canConvert) {
          violations.push({
            column: target,
            observed_value: columnUnit,
            expected_condition: `Convertible to "${expectedUnit}"`,
            message: `Unit "${columnUnit}" is incompatible/cannot be converted to "${expectedUnit}".`
          });
        } else if (checkDimension) {
          const colDim = UnitConverter.getDimension(columnUnit);
          const expDim = UnitConverter.getDimension(expectedUnit);
          if (colDim !== expDim) {
            violations.push({
              column: target,
              observed_value: `${columnUnit} (${colDim || 'unknown'})`,
              expected_condition: `${expectedUnit} (${expDim || 'unknown'})`,
              message: `Dimension mismatch: "${columnUnit}" (${colDim}) vs "${expectedUnit}" (${expDim}).`
            });
          }
        }
      }
    }

    const sampleLimit = config?.sample_limit ?? 20;
    const status: ValidationStatus = violations.length === 0 ? 'PASS' : severity === 'WARNING' ? 'WARNING' : 'FAIL';

    return {
      check_id: check.check_id,
      name: check.name,
      type: 'UNIT',
      status,
      target,
      severity,
      observed: { column_unit: columnUnit },
      expected: { expected_unit: expectedUnit, check_dimension: checkDimension },
      violation_count: violations.length,
      sample_violations: violations.slice(0, sampleLimit),
      message: violations.length === 0
        ? `Unit for "${target}" is valid and dimensionally compatible.`
        : `Unit validation failed for "${target}": ${violations[0]?.message || 'Incompatible unit'}`
    };
  }

  /**
   * 7. DUPLICATE CHECK
   */
  private static evaluateDuplicateCheck(
    check: DataValidationCheck,
    records: Record<string, unknown>[],
    config?: DataValidationCheckConfig,
    severity: ValidationSeverity = 'ERROR'
  ): DataValidationCheckResult {
    const keyColumns = config?.key_columns || (check.target !== '*' && check.target !== 'DATASET' ? [check.target] : []);

    if (keyColumns.length === 0) {
      return {
        check_id: check.check_id,
        name: check.name,
        type: 'DUPLICATE',
        status: 'UNESTABLISHED',
        target: check.target,
        severity,
        observed: null,
        expected: 'Key columns configured',
        violation_count: 0,
        sample_violations: [],
        message: 'Duplicate check requires at least one key column in "key_columns" or "target".'
      };
    }

    const seenKeys = new Map<string, number>();
    const violations: DataValidationViolation[] = [];

    records.forEach((row, idx) => {
      const keyVal = keyColumns.map(k => String(row[k] ?? '')).join('::');
      if (seenKeys.has(keyVal)) {
        const firstIdx = seenKeys.get(keyVal)!;
        violations.push({
          row_index: idx,
          column: keyColumns.join('+'),
          observed_value: keyVal,
          expected_condition: 'Unique record key',
          message: `Duplicate key (${keyVal}) on row ${idx} duplicates row ${firstIdx}.`
        });
      } else {
        seenKeys.set(keyVal, idx);
      }
    });

    const sampleLimit = config?.sample_limit ?? 20;
    const status: ValidationStatus = violations.length === 0 ? 'PASS' : severity === 'WARNING' ? 'WARNING' : 'FAIL';

    return {
      check_id: check.check_id,
      name: check.name,
      type: 'DUPLICATE',
      status,
      target: keyColumns.join(', '),
      severity,
      observed: { total_records: records.length, duplicate_count: violations.length },
      expected: { unique_keys: keyColumns },
      violation_count: violations.length,
      sample_violations: violations.slice(0, sampleLimit),
      message: violations.length === 0
        ? `No duplicate keys found across [${keyColumns.join(', ')}].`
        : `Found ${violations.length} duplicate record(s) on key [${keyColumns.join(', ')}].`
    };
  }

  /**
   * 8. NULLABILITY CHECK
   */
  private static evaluateNullabilityCheck(
    check: DataValidationCheck,
    records: Record<string, unknown>[],
    config?: DataValidationCheckConfig,
    severity: ValidationSeverity = 'ERROR'
  ): DataValidationCheckResult {
    const colName = check.target;
    const violations: DataValidationViolation[] = [];

    records.forEach((row, idx) => {
      const val = row[colName];
      if (val === null || val === undefined || val === '') {
        violations.push({
          row_index: idx,
          column: colName,
          observed_value: val,
          expected_condition: 'Non-null value',
          message: `Row ${idx} column "${colName}" contains null/empty value.`
        });
      }
    });

    const sampleLimit = config?.sample_limit ?? 20;
    const status: ValidationStatus = violations.length === 0 ? 'PASS' : severity === 'WARNING' ? 'WARNING' : 'FAIL';

    return {
      check_id: check.check_id,
      name: check.name,
      type: 'NULLABILITY',
      status,
      target: colName,
      severity,
      observed: { column: colName, null_count: violations.length },
      expected: 'Non-null required',
      violation_count: violations.length,
      sample_violations: violations.slice(0, sampleLimit),
      message: violations.length === 0
        ? `Column "${colName}" has no null values.`
        : `Found ${violations.length} null value(s) in column "${colName}".`
    };
  }

  /**
   * 9. REQUIRED VARIABLE CHECK
   */
  private static evaluateRequiredVariableCheck(
    check: DataValidationCheck,
    datasetVersion: DatasetVersion,
    variableMapping?: VariableMappingStore,
    config?: DataValidationCheckConfig,
    severity: ValidationSeverity = 'ERROR'
  ): DataValidationCheckResult {
    const requiredVarIds = config?.required_variable_ids || (check.target !== '*' ? [check.target] : []);
    const violations: DataValidationViolation[] = [];

    if (!variableMapping) {
      return {
        check_id: check.check_id,
        name: check.name,
        type: 'REQUIRED_VARIABLE',
        status: 'UNESTABLISHED',
        target: requiredVarIds.join(', '),
        severity,
        observed: null,
        expected: 'VariableMappingStore provided',
        violation_count: 0,
        sample_violations: [],
        message: 'VariableMappingStore is required to evaluate REQUIRED_VARIABLE check.'
      };
    }

    const mappings = variableMapping.findByDatasetVersion(datasetVersion.version_id, { status: 'CONFIRMED' });
    const confirmedVarIds = new Set(mappings.map(m => m.variable_id));

    for (const reqVarId of requiredVarIds) {
      if (!confirmedVarIds.has(reqVarId)) {
        violations.push({
          column: reqVarId,
          observed_value: null,
          expected_condition: `Confirmed mapping for variable "${reqVarId}"`,
          message: `Required variable "${reqVarId}" is not mapped or confirmed in dataset version "${datasetVersion.version_id}".`
        });
      }
    }

    const sampleLimit = config?.sample_limit ?? 20;
    const status: ValidationStatus = violations.length === 0 ? 'PASS' : severity === 'WARNING' ? 'WARNING' : 'FAIL';

    return {
      check_id: check.check_id,
      name: check.name,
      type: 'REQUIRED_VARIABLE',
      status,
      target: requiredVarIds.join(', '),
      severity,
      observed: { mapped_variables: Array.from(confirmedVarIds) },
      expected: { required_variables: requiredVarIds },
      violation_count: violations.length,
      sample_violations: violations.slice(0, sampleLimit),
      message: violations.length === 0
        ? `All required variables [${requiredVarIds.join(', ')}] are confirmed.`
        : `Missing ${violations.length} required variable mapping(s).`
    };
  }

  /**
   * 10. CONSTRAINT CHECK (Generic typed comparator rules, ZERO eval)
   */
  private static evaluateConstraintCheck(
    check: DataValidationCheck,
    records: Record<string, unknown>[],
    config?: DataValidationCheckConfig,
    severity: ValidationSeverity = 'ERROR'
  ): DataValidationCheckResult {
    const constraints: DataValidationConstraintRule[] = config?.constraints || [];
    const violations: DataValidationViolation[] = [];

    if (constraints.length === 0) {
      return {
        check_id: check.check_id,
        name: check.name,
        type: 'CONSTRAINT',
        status: 'NOT_CONFIGURED',
        target: check.target,
        severity,
        observed: null,
        expected: 'Constraints configured',
        violation_count: 0,
        sample_violations: [],
        message: 'No constraints configured.'
      };
    }

    records.forEach((row, idx) => {
      for (const rule of constraints) {
        const val = row[rule.field];
        if (val === null || val === undefined || val === '') continue; // Nulls skipped unless NON_EMPTY operator

        const compareVal = rule.other_field !== undefined ? row[rule.other_field] : rule.value;
        const satisfies = DataValidationEngine.evaluateConstraintRule(rule, val, compareVal);

        if (!satisfies) {
          violations.push({
            row_index: idx,
            column: rule.field,
            observed_value: val,
            expected_condition: rule.message || `${rule.field} ${rule.operator} ${String(compareVal)}`,
            message: `Row ${idx} failed constraint: ${rule.message || `${rule.field} (${val}) ${rule.operator} ${String(compareVal)}`}`
          });
        }
      }
    });

    const sampleLimit = config?.sample_limit ?? 20;
    const status: ValidationStatus = violations.length === 0 ? 'PASS' : severity === 'WARNING' ? 'WARNING' : 'FAIL';

    return {
      check_id: check.check_id,
      name: check.name,
      type: 'CONSTRAINT',
      status,
      target: check.target,
      severity,
      observed: { total_records: records.length, violations: violations.length },
      expected: { constraints_count: constraints.length },
      violation_count: violations.length,
      sample_violations: violations.slice(0, sampleLimit),
      message: violations.length === 0
        ? `All ${constraints.length} constraint(s) satisfied.`
        : `Found ${violations.length} constraint violation(s).`
    };
  }

  /**
   * Pure deterministic constraint evaluator without dynamic code execution
   */
  private static evaluateConstraintRule(
    rule: DataValidationConstraintRule,
    actualValue: unknown,
    compareValue: unknown
  ): boolean {
    const numActual = typeof actualValue === 'number' ? actualValue : Number(actualValue);
    const numCompare = typeof compareValue === 'number' ? compareValue : Number(compareValue);
    const isNumComparison = !isNaN(numActual) && !isNaN(numCompare);

    switch (rule.operator) {
      case 'EQ':
        return actualValue === compareValue || String(actualValue) === String(compareValue);

      case 'NEQ':
        return actualValue !== compareValue && String(actualValue) !== String(compareValue);

      case 'GT':
        return isNumComparison ? numActual > numCompare : String(actualValue) > String(compareValue);

      case 'GTE':
        return isNumComparison ? numActual >= numCompare : String(actualValue) >= String(compareValue);

      case 'LT':
        return isNumComparison ? numActual < numCompare : String(actualValue) < String(compareValue);

      case 'LTE':
        return isNumComparison ? numActual <= numCompare : String(actualValue) <= String(compareValue);

      case 'IN':
        if (Array.isArray(compareValue)) {
          return compareValue.includes(actualValue) || compareValue.map(String).includes(String(actualValue));
        }
        return false;

      case 'NOT_IN':
        if (Array.isArray(compareValue)) {
          return !compareValue.includes(actualValue) && !compareValue.map(String).includes(String(actualValue));
        }
        return true;

      case 'MATCHES_REGEX':
        if (rule.regex_pattern) {
          try {
            const regex = new RegExp(rule.regex_pattern);
            return regex.test(String(actualValue));
          } catch {
            return false;
          }
        }
        return false;

      case 'NON_EMPTY':
        return actualValue !== null && actualValue !== undefined && String(actualValue).trim() !== '';

      default:
        return false;
    }
  }
}

// ============================================================================
// CONVENIENCE BUILDER FUNCTIONS
// ============================================================================

export function createDataValidationProfile(
  profile: DataValidationProfile
): DataValidationProfile {
  DataValidationValidator.validateProfile(profile);
  return deepFreeze({ ...profile });
}

export function createDataValidationCheck(
  check: DataValidationCheck
): DataValidationCheck {
  DataValidationValidator.validateCheck(check);
  return deepFreeze({ ...check });
}

export { DataValidationProfileStore as ValidationProfileStore };
