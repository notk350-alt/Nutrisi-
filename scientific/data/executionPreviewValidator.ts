/**
 * NutriBodySim — Phase F2.2B: Execution Preview Validator
 *
 * Deterministic, read-only preflight validator and ExecutionPreview builder.
 *
 * Invariants:
 * 1. Zero statistical calculations, zero engine execution (D9–D13 untouched).
 * 2. Status is strictly 'READY' or 'BLOCKED' (no execution or result statuses).
 * 3. Read-only snapshot: deepFreeze ensures zero mutations of project, variables, or datasets.
 * 4. Deterministic SHA-256 preview provenance digest.
 * 5. scientific_validity = 'NOT_ESTABLISHED' strictly preserved.
 * 6. No automatic inference of variables, hypotheses, objectives, or statistical models.
 */

import {
  DataArtifact,
  DatasetVersion,
  Variable
} from '../types';
import {
  deepFreeze,
  DataArtifactStore,
  defaultDataArtifactStore
} from './dataStatePipeline';
import {
  DatasetVersionStore,
  defaultDatasetVersionStore
} from './datasetVersion';
import {
  VariableStore,
  defaultVariableStore,
  VALID_VARIABLE_DATATYPES
} from './variableRegistry';
import {
  VariableMappingStore,
  defaultVariableMappingStore
} from './variableMapping';
import {
  ANALYSIS_MODULE_REGISTRY,
  AuthoritativeModuleIdentity
} from './analysisExecutionContracts';
import {
  ExecutionPreview,
  ExecutionPreviewErrorCode,
  ExecutionPreviewOptions,
  ExecutionPreviewReadinessStatus,
  ScientificExecutionPreviewError
} from './executionPreviewContracts';
import {
  computeExecutionPreviewProvenanceHash,
  ExecutionPreviewProvenancePayload
} from './executionPreviewProvenance';

export class ExecutionPreviewValidator {
  /**
   * Deterministically validates an execution candidate and returns an immutable ExecutionPreview snapshot.
   */
  public static generatePreview(options: ExecutionPreviewOptions): ExecutionPreview {
    const errors: string[] = [];
    const warnings: string[] = [];

    const datasetVersionStore = options.dataset_version_store || defaultDatasetVersionStore;
    const dataArtifactStore = options.data_artifact_store || defaultDataArtifactStore;
    const variableStore = options.variable_store || defaultVariableStore;
    const variableMappingStore = options.variable_mapping_store || defaultVariableMappingStore;

    // ----------------------------------------------------
    // A. Project Validation
    // ----------------------------------------------------
    if (!options.project || typeof options.project !== 'object') {
      errors.push('[PROJECT_NOT_FOUND] ResearchProject must be a valid object.');
      return this.buildBlockedFallback(options, errors, warnings);
    }

    const { project } = options;

    if (!project.project_id || typeof project.project_id !== 'string' || !project.project_id.trim()) {
      errors.push('[PROJECT_NOT_FOUND] Project ID is missing or invalid.');
    }

    if (!project.project_version || typeof project.project_version !== 'string') {
      errors.push('[PROJECT_VERSION_NOT_FOUND] Project version is missing or invalid.');
    } else if (options.project_version && options.project_version !== project.project_version) {
      errors.push(
        `[PROJECT_VERSION_NOT_FOUND] Requested project version '${options.project_version}' does not match project version '${project.project_version}'.`
      );
    }

    // Lifecycle Status Checks: Finalized or Archived projects cannot execute or preview execution
    if (project.status === 'FINALIZED') {
      errors.push(
        `[PROJECT_FINALIZED] Project '${project.project_id}' is FINALIZED. Finalized projects cannot execute analyses.`
      );
    }

    if (project.status === 'ARCHIVED') {
      errors.push(
        `[PROJECT_ARCHIVED] Project '${project.project_id}' is ARCHIVED. Archived projects cannot execute analyses.`
      );
    }

    // ----------------------------------------------------
    // B. Dataset Binding Validation & Inheritance
    // ----------------------------------------------------
    const binding = project.dataset_binding;
    let boundDatasetVersion: DatasetVersion | undefined;
    let boundArtifact: DataArtifact | undefined;

    if (!binding || !binding.dataset_version_id || !binding.data_artifact_id) {
      errors.push(
        '[DATASET_BINDING_MISMATCH] Project lacks active dataset binding. An active dataset version and artifact binding is required.'
      );
    } else {
      // 1. Dataset version exists in store
      boundDatasetVersion = datasetVersionStore.get(binding.dataset_version_id);
      if (!boundDatasetVersion) {
        errors.push(
          `[DATASET_BINDING_MISMATCH] Bound dataset version '${binding.dataset_version_id}' does not exist in DatasetVersionStore.`
        );
      }

      // 2. Data artifact exists in store
      boundArtifact = dataArtifactStore.get(binding.data_artifact_id);
      if (!boundArtifact) {
        errors.push(
          `[ARTIFACT_BINDING_MISMATCH] Bound data artifact '${binding.data_artifact_id}' does not exist in DataArtifactStore.`
        );
      } else {
        // 3. Artifact belongs to dataset version
        if (boundArtifact.dataset_version_id !== binding.dataset_version_id) {
          errors.push(
            `[ARTIFACT_BINDING_MISMATCH] DataArtifact '${boundArtifact.artifact_id}' belongs to dataset version '${boundArtifact.dataset_version_id}', expected '${binding.dataset_version_id}'.`
          );
        }

        // 4. Artifact checksum match
        if (binding.source_artifact_checksum && boundArtifact.checksum !== binding.source_artifact_checksum) {
          errors.push(
            `[CHECKSUM_MISMATCH] Artifact checksum mismatch: binding recorded '${binding.source_artifact_checksum}', artifact has '${boundArtifact.checksum}'.`
          );
        }

        // 5. Verify integrity against store record
        const check = dataArtifactStore.verifyChecksum(boundArtifact.artifact_id);
        if (!check.matches) {
          errors.push(
            `[CHECKSUM_MISMATCH] Artifact content checksum failure for '${boundArtifact.artifact_id}'.`
          );
        }

        // 6. Lineage integrity
        if (boundArtifact.parent_artifact_id) {
          const parent = dataArtifactStore.get(boundArtifact.parent_artifact_id);
          if (!parent) {
            errors.push(
              `[LINEAGE_INVALID] Parent artifact '${boundArtifact.parent_artifact_id}' in lineage chain not found.`
            );
          } else if (parent.dataset_version_id !== binding.dataset_version_id) {
            errors.push(
              `[LINEAGE_INVALID] Parent artifact '${parent.artifact_id}' belongs to version '${parent.dataset_version_id}', expected '${binding.dataset_version_id}'.`
            );
          }
        }
      }
    }

    // ----------------------------------------------------
    // C. Analysis Plan Validation
    // ----------------------------------------------------
    const targetAnalysisId = options.analysis_id?.trim() || options.analysis_plan?.analysis_id?.trim();
    if (!targetAnalysisId) {
      errors.push('[ANALYSIS_NOT_FOUND] Analysis ID is required.');
    }

    const planned = options.analysis_plan || project.analysis_plan?.find((a) => a.analysis_id === targetAnalysisId);
    if (!planned) {
      errors.push(
        `[ANALYSIS_NOT_FOUND] Analysis '${targetAnalysisId || 'UNKNOWN'}' not found in project's analysis plan.`
      );
    } else {
      // Analysis must strictly have status PLANNED
      if (planned.status !== 'PLANNED') {
        errors.push(
          `[ANALYSIS_NOT_PLANNED] Planned analysis '${planned.analysis_id}' has status '${planned.status}', expected 'PLANNED'.`
        );
      }

      // Check analysis plan version if specified
      if (options.analysis_plan_version && options.analysis_plan_version !== '1.0.0') {
        errors.push(
          `[ANALYSIS_VERSION_MISMATCH] Requested analysis plan version '${options.analysis_plan_version}' does not match available version '1.0.0'.`
        );
      }

      // ----------------------------------------------------
      // D. Objective Binding Validation
      // ----------------------------------------------------
      if (!planned.objective_id || typeof planned.objective_id !== 'string' || !planned.objective_id.trim()) {
        errors.push('[OBJECTIVE_NOT_FOUND] Planned analysis has no associated objective ID.');
      } else {
        const objectiveExists = project.objectives?.some(
          (o) => o.objective_id === planned.objective_id.trim()
        );
        if (!objectiveExists) {
          errors.push(
            `[OBJECTIVE_NOT_FOUND] Referenced objective '${planned.objective_id}' does not exist in project.`
          );
        }
      }

      // ----------------------------------------------------
      // E. Hypothesis Binding Validation
      // ----------------------------------------------------
      if (planned.hypothesis_id && planned.hypothesis_id.trim()) {
        const hypothesisExists = project.hypotheses?.some(
          (h) => h.hypothesis_id === planned.hypothesis_id!.trim()
        );
        if (!hypothesisExists) {
          errors.push(
            `[HYPOTHESIS_NOT_FOUND] Referenced hypothesis '${planned.hypothesis_id}' does not exist in project.`
          );
        }
      }

      // ----------------------------------------------------
      // F. Module Resolution (Identity resolution only; NO invocation)
      // ----------------------------------------------------
      const normalizedType = planned.analysis_type?.toUpperCase();
      const moduleIdentity = normalizedType ? ANALYSIS_MODULE_REGISTRY[normalizedType] : undefined;

      if (!normalizedType || !moduleIdentity) {
        errors.push(
          `[MODULE_NOT_FOUND] No authoritative scientific module found for analysis type '${planned.analysis_type}'.`
        );
      }

      // ----------------------------------------------------
      // G. Variables Validation & Mapping Consistency
      // ----------------------------------------------------
      const rawInputs = planned.input_variable_ids !== undefined
        ? planned.input_variable_ids
        : (planned.input_variables || []);
      const inputVariables = Array.isArray(rawInputs) ? rawInputs.map((v) => v.trim()).filter(Boolean) : [];

      if (inputVariables.length === 0) {
        errors.push(
          '[VARIABLE_NOT_FOUND] Analysis requires at least one input variable.'
        );
      }

      const allVariableIds: string[] = [...inputVariables];

      // Grouping variables
      const groupingVars: string[] = [];
      if (planned.grouping_variable_ids !== undefined && Array.isArray(planned.grouping_variable_ids)) {
        groupingVars.push(...planned.grouping_variable_ids.map((v) => v.trim()).filter(Boolean));
      } else if (planned.grouping_variable) {
        groupingVars.push(planned.grouping_variable.trim());
      }
      allVariableIds.push(...groupingVars);

      // Pairing variables
      const pairingVars: string[] = [];
      if (planned.pairing_variable_ids !== undefined && Array.isArray(planned.pairing_variable_ids)) {
        pairingVars.push(...planned.pairing_variable_ids.map((v) => v.trim()).filter(Boolean));
      } else if (planned.pairing_variable) {
        pairingVars.push(planned.pairing_variable.trim());
      }
      allVariableIds.push(...pairingVars);

      // Verify each variable against registry
      for (const varId of allVariableIds) {
        const registeredVar: Variable | undefined = variableStore.get(varId);
        if (!registeredVar) {
          errors.push(
            `[VARIABLE_NOT_FOUND] Variable '${varId}' is not registered in the Variable Registry.`
          );
        } else {
          // Schema / datatype compatibility check
          if (!registeredVar.datatype || !VALID_VARIABLE_DATATYPES.has(registeredVar.datatype.toUpperCase() as any)) {
            errors.push(
              `[VARIABLE_SCHEMA_MISMATCH] Variable '${varId}' has invalid or incompatible datatype '${registeredVar.datatype}'.`
            );
          }

          // If mapping store has mappings for this dataset version, verify mapping status
          if (binding?.dataset_version_id) {
            const resolution = variableMappingStore.resolveVariableToColumn(binding.dataset_version_id, varId);
            if (resolution.has_conflict) {
              errors.push(
                `[VARIABLE_MAPPING_INVALID] Ambiguous mapping: Multiple columns [${resolution.source_columns.join(', ')}] are CONFIRMED for variable '${varId}'.`
              );
            } else if (options.strict_variable_mapping && resolution.source_columns.length === 0) {
              errors.push(
                `[VARIABLE_MAPPING_INVALID] No confirmed column mapping found for variable '${varId}' in dataset version '${binding.dataset_version_id}'.`
              );
            }
          }
        }
      }

      // ----------------------------------------------------
      // H. Parameters Validation
      // ----------------------------------------------------
      let resolvedParamSetId: string | undefined;
      const configObj = planned.configuration && typeof planned.configuration === 'object' ? planned.configuration : {};
      const requestedParamSetId = (configObj as Record<string, unknown>).parameter_set_id;
      if (typeof requestedParamSetId === 'string' && requestedParamSetId.trim()) {
        const availableSets = options.available_parameter_sets || [];
        const foundSet = availableSets.find((s) => s.set_id === requestedParamSetId.trim());
        if (!foundSet) {
          errors.push(
            `[PARAMETER_VERSION_NOT_FOUND] Parameter set '${requestedParamSetId}' referenced in configuration not found in available parameter sets.`
          );
        } else {
          resolvedParamSetId = foundSet.set_id;
        }
      }

      // ----------------------------------------------------
      // I. Statistical Alpha & Confidence Level Validation
      // ----------------------------------------------------
      if (planned.alpha !== undefined && planned.alpha !== null) {
        if (typeof planned.alpha !== 'number' || isNaN(planned.alpha) || planned.alpha <= 0 || planned.alpha >= 1) {
          errors.push(
            '[INVALID_ALPHA] Alpha must be a valid probability strictly between 0 and 1 exclusive.'
          );
        }
      } else if (['INFERENTIAL', 'REGRESSION', 'POWER', 'POWER_ANALYSIS', 'NONPARAMETRIC', 'NON_PARAMETRIC'].includes(normalizedType)) {
        errors.push(
          `[INVALID_ALPHA] Alpha significance threshold is required for '${planned.analysis_type}' analysis.`
        );
      }

      if (planned.confidence_level !== undefined && planned.confidence_level !== null) {
        if (
          typeof planned.confidence_level !== 'number' ||
          isNaN(planned.confidence_level) ||
          planned.confidence_level <= 0 ||
          planned.confidence_level >= 1
        ) {
          errors.push(
            '[INVALID_CONFIDENCE_LEVEL] Confidence level must be a valid probability strictly between 0 and 1 exclusive.'
          );
        }
      }

      // ----------------------------------------------------
      // J. Configuration Security (No dynamic evaluation, functions, or eval)
      // ----------------------------------------------------
      if (planned.configuration && typeof planned.configuration === 'object') {
        const inspectConfig = (obj: Record<string, unknown>, path: string = '') => {
          for (const [k, v] of Object.entries(obj)) {
            const currentPath = path ? `${path}.${k}` : k;
            if (typeof v === 'function') {
              errors.push(
                `[INVALID_CONFIGURATION] Executable function found in configuration at '${currentPath}'. Configuration must remain purely declarative data.`
              );
            } else if (typeof v === 'string') {
              const forbiddenEval = new RegExp('\\b' + 'eval' + '\\s*\\(');
              const forbiddenNewFn = new RegExp('new\\s+' + 'Function' + '\\s*\\(');
              if (forbiddenEval.test(v) || forbiddenNewFn.test(v)) {
                errors.push(
                  `[INVALID_CONFIGURATION] Prohibited dynamic execution string found in configuration at '${currentPath}'.`
                );
              }
            } else if (v && typeof v === 'object' && !Array.isArray(v)) {
              inspectConfig(v as Record<string, unknown>, currentPath);
            }
          }
        };
        inspectConfig(planned.configuration);
      }
    }

    // ----------------------------------------------------
    // Readiness Assessment
    // ----------------------------------------------------
    const readinessStatus: ExecutionPreviewReadinessStatus = errors.length === 0 ? 'READY' : 'BLOCKED';

    const normalizedType = planned?.analysis_type?.toUpperCase() || 'UNKNOWN';
    const moduleIdentity: AuthoritativeModuleIdentity = ANALYSIS_MODULE_REGISTRY[normalizedType] || {
      module_id: 'UNRESOLVED_MODULE',
      module_name: 'Unresolved Scientific Module',
      module_version: '0.0.0',
      engine_version: '0.0.0'
    };

    const planVersion = options.analysis_plan_version || '1.0.0';
    const inputVarIds = planned
      ? (planned.input_variable_ids || planned.input_variables || []).map((v) => v.trim())
      : [];
    const groupingVarIds = planned?.grouping_variable_ids
      ? planned.grouping_variable_ids.map((v) => v.trim())
      : planned?.grouping_variable
        ? [planned.grouping_variable.trim()]
        : [];
    const pairingVarIds = planned?.pairing_variable_ids
      ? planned.pairing_variable_ids.map((v) => v.trim())
      : planned?.pairing_variable
        ? [planned.pairing_variable.trim()]
        : [];

    const configSafe: Record<string, unknown> = planned?.configuration
      ? JSON.parse(JSON.stringify(planned.configuration))
      : {};

    const provenancePayload: ExecutionPreviewProvenancePayload = {
      project_id: project.project_id,
      project_version: project.project_version,
      analysis_id: planned?.analysis_id || targetAnalysisId || 'UNKNOWN',
      analysis_plan_version: planVersion,
      dataset_version_id: binding?.dataset_version_id || '',
      data_artifact_id: binding?.data_artifact_id || '',
      source_artifact_checksum: binding?.source_artifact_checksum || boundArtifact?.checksum || '',
      analysis_type: planned?.analysis_type || 'UNKNOWN',
      objective_id: planned?.objective_id || '',
      hypothesis_id: planned?.hypothesis_id,
      input_variable_ids: inputVarIds,
      grouping_variable_ids: groupingVarIds,
      pairing_variable_ids: pairingVarIds,
      alpha: planned?.alpha,
      confidence_level: planned?.confidence_level,
      configuration: configSafe,
      resolved_module_id: moduleIdentity.module_id,
      resolved_module_version: moduleIdentity.module_version,
      readiness_status: readinessStatus,
      errors: [...errors],
      warnings: [...warnings],
      resolved_parameter_set_id: (configSafe as Record<string, unknown>).parameter_set_id as string | undefined,
      scientific_validity: 'NOT_ESTABLISHED'
    };

    const provenanceHash = computeExecutionPreviewProvenanceHash(provenancePayload);
    const previewId = `PREVIEW_${project.project_id}_${provenancePayload.analysis_id}_${provenanceHash.slice(0, 12)}`;
    const executionRequestId = options.execution_request?.execution_request_id ||
      (readinessStatus === 'READY'
        ? `EXREQ_${project.project_id}_${provenancePayload.analysis_id}_${provenanceHash.slice(0, 12)}`
        : undefined);

    const preview: ExecutionPreview = deepFreeze({
      preview_id: previewId,
      execution_request_id: executionRequestId,
      project_id: project.project_id,
      project_version: project.project_version,
      analysis_id: provenancePayload.analysis_id,
      analysis_plan_version: planVersion,
      analysis_type: planned?.analysis_type || 'UNKNOWN',
      objective_id: planned?.objective_id || '',
      hypothesis_id: planned?.hypothesis_id,
      dataset_version_id: provenancePayload.dataset_version_id,
      data_artifact_id: provenancePayload.data_artifact_id,
      source_artifact_checksum: provenancePayload.source_artifact_checksum,
      input_variable_ids: inputVarIds,
      grouping_variable_ids: groupingVarIds.length > 0 ? groupingVarIds : undefined,
      pairing_variable_ids: pairingVarIds.length > 0 ? pairingVarIds : undefined,
      alpha: planned?.alpha,
      confidence_level: planned?.confidence_level,
      configuration: configSafe,
      resolved_module_id: moduleIdentity.module_id,
      resolved_module_version: moduleIdentity.module_version,
      readiness_status: readinessStatus,
      errors: deepFreeze([...errors]),
      warnings: deepFreeze([...warnings]),
      provenance_hash: provenanceHash,
      scientific_validity: 'NOT_ESTABLISHED' as const,
      created_at: new Date().toISOString(),
      resolved_parameter_set_id: (configSafe as Record<string, unknown>).parameter_set_id as string | undefined
    });

    return preview;
  }

  /**
   * Helper fallback when project object is missing or invalid.
   */
  private static buildBlockedFallback(
    options: ExecutionPreviewOptions,
    errors: string[],
    warnings: string[]
  ): ExecutionPreview {
    const payload: ExecutionPreviewProvenancePayload = {
      project_id: options.project_id || 'UNKNOWN',
      project_version: options.project_version || 'UNKNOWN',
      analysis_id: options.analysis_id || 'UNKNOWN',
      analysis_plan_version: options.analysis_plan_version || '1.0.0',
      dataset_version_id: '',
      data_artifact_id: '',
      source_artifact_checksum: '',
      analysis_type: 'UNKNOWN',
      objective_id: '',
      input_variable_ids: [],
      configuration: {},
      resolved_module_id: 'UNRESOLVED_MODULE',
      resolved_module_version: '0.0.0',
      readiness_status: 'BLOCKED',
      errors: [...errors],
      warnings: [...warnings],
      scientific_validity: 'NOT_ESTABLISHED'
    };

    const hash = computeExecutionPreviewProvenanceHash(payload);

    return deepFreeze({
      preview_id: `PREVIEW_BLOCKED_${hash.slice(0, 12)}`,
      project_id: payload.project_id,
      project_version: payload.project_version,
      analysis_id: payload.analysis_id,
      analysis_plan_version: payload.analysis_plan_version,
      analysis_type: 'UNKNOWN',
      objective_id: '',
      dataset_version_id: '',
      data_artifact_id: '',
      source_artifact_checksum: '',
      input_variable_ids: [],
      configuration: {},
      resolved_module_id: 'UNRESOLVED_MODULE',
      resolved_module_version: '0.0.0',
      readiness_status: 'BLOCKED' as const,
      errors: deepFreeze([...errors]),
      warnings: deepFreeze([...warnings]),
      provenance_hash: hash,
      scientific_validity: 'NOT_ESTABLISHED' as const,
      created_at: new Date().toISOString()
    });
  }
}
