/**
 * NutriBodySim — Phase F2.2A: Analysis Execution Preflight Validator
 *
 * Implements deterministic preflight validation bridging a PlannedAnalysis
 * in a ResearchProject to an immutable AnalysisExecutionRequest.
 *
 * Strict Architectural Guarantees:
 * 1. Zero statistical calculations, zero engine execution (D9–D13 remain untouched).
 * 2. Status is strictly READY or BLOCKED.
 * 3. Dataset binding is strictly inherited from ResearchProject; cross-version bindings are rejected.
 * 4. Variables verified against VariableRegistry without mutating it.
 * 5. Configuration strictly declarative; zero dynamic code execution.
 * 6. Deterministic SHA-256 provenance hashing.
 * 7. scientific_validity = 'NOT_ESTABLISHED' strictly preserved.
 */

import {
  DataArtifact,
  DatasetVersion
} from '../types';
import {
  DatasetBinding,
  PlannedAnalysis,
  ResearchProject
} from './researchProjectContracts';
import {
  DatasetVersionStore,
  defaultDatasetVersionStore
} from './datasetVersion';
import {
  DataArtifactStore,
  defaultDataArtifactStore,
  deepFreeze
} from './dataStatePipeline';
import {
  VariableStore,
  defaultVariableStore
} from './variableRegistry';
import {
  ANALYSIS_MODULE_REGISTRY,
  AnalysisExecutionErrorCode,
  AnalysisExecutionRequest,
  PreflightResult,
  ScientificExecutionBridgeError
} from './analysisExecutionContracts';
import {
  computeExecutionRequestProvenanceHash,
  AnalysisExecutionProvenancePayload
} from './analysisExecutionProvenance';

export interface PreflightOptions {
  project: ResearchProject;
  analysis_id: string;
  project_version?: string;
  analysis_plan_version?: string;
  dataset_version_store?: DatasetVersionStore;
  data_artifact_store?: DataArtifactStore;
  variable_store?: VariableStore;
}

export class AnalysisExecutionPreflight {
  /**
   * Deterministically validates whether a planned analysis in a ResearchProject
   * is structurally eligible for execution.
   */
  public static validate(options: PreflightOptions): PreflightResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    const datasetVersionStore = options.dataset_version_store || defaultDatasetVersionStore;
    const dataArtifactStore = options.data_artifact_store || defaultDataArtifactStore;
    const variableStore = options.variable_store || defaultVariableStore;

    // ----------------------------------------------------
    // A. Project Validation
    // ----------------------------------------------------
    if (!options.project || typeof options.project !== 'object') {
      return {
        status: 'BLOCKED',
        errors: ['[EXECUTION_PROJECT_NOT_FOUND] ResearchProject must be a valid object.'],
        warnings: [],
        scientific_validity: 'NOT_ESTABLISHED'
      };
    }

    const { project } = options;

    if (!project.project_id || typeof project.project_id !== 'string' || !project.project_id.trim()) {
      errors.push('[EXECUTION_PROJECT_NOT_FOUND] Project ID is missing or invalid.');
    }

    if (options.project_version && options.project_version !== project.project_version) {
      errors.push(
        `[EXECUTION_PROJECT_VERSION_MISMATCH] Requested project version '${options.project_version}' does not match project version '${project.project_version}'.`
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
        '[EXECUTION_DATASET_NOT_FOUND] Project lacks active dataset binding. An active dataset version and artifact binding is required.'
      );
    } else {
      // 1. Dataset version exists in store
      boundDatasetVersion = datasetVersionStore.get(binding.dataset_version_id);
      if (!boundDatasetVersion) {
        errors.push(
          `[EXECUTION_DATASET_NOT_FOUND] Bound dataset version '${binding.dataset_version_id}' does not exist in DatasetVersionStore.`
        );
      }

      // 2. Data artifact exists in store
      boundArtifact = dataArtifactStore.get(binding.data_artifact_id);
      if (!boundArtifact) {
        errors.push(
          `[EXECUTION_ARTIFACT_NOT_FOUND] Bound data artifact '${binding.data_artifact_id}' does not exist in DataArtifactStore.`
        );
      } else {
        // 3. Artifact belongs to dataset version
        if (boundArtifact.dataset_version_id !== binding.dataset_version_id) {
          errors.push(
            `[EXECUTION_ARTIFACT_VERSION_MISMATCH] DataArtifact '${boundArtifact.artifact_id}' belongs to dataset version '${boundArtifact.dataset_version_id}', expected '${binding.dataset_version_id}'.`
          );
        }

        // 4. Artifact checksum match
        if (binding.source_artifact_checksum && boundArtifact.checksum !== binding.source_artifact_checksum) {
          errors.push(
            `[EXECUTION_CHECKSUM_MISMATCH] Artifact checksum mismatch: binding recorded '${binding.source_artifact_checksum}', artifact has '${boundArtifact.checksum}'.`
          );
        }

        // 5. Verify integrity against store record
        const check = dataArtifactStore.verifyChecksum(boundArtifact.artifact_id);
        if (!check.matches) {
          errors.push(
            `[EXECUTION_CHECKSUM_MISMATCH] Artifact content checksum failure for '${boundArtifact.artifact_id}'.`
          );
        }

        // 6. Lineage integrity
        if (boundArtifact.parent_artifact_id) {
          const parent = dataArtifactStore.get(boundArtifact.parent_artifact_id);
          if (!parent) {
            errors.push(
              `[EXECUTION_INVALID_LINEAGE] Parent artifact '${boundArtifact.parent_artifact_id}' in lineage chain not found.`
            );
          } else if (parent.dataset_version_id !== binding.dataset_version_id) {
            errors.push(
              `[EXECUTION_INVALID_LINEAGE] Parent artifact '${parent.artifact_id}' belongs to version '${parent.dataset_version_id}', expected '${binding.dataset_version_id}'.`
            );
          }
        }
      }
    }

    // ----------------------------------------------------
    // C. Analysis Plan Validation
    // ----------------------------------------------------
    if (!options.analysis_id || typeof options.analysis_id !== 'string' || !options.analysis_id.trim()) {
      errors.push('[EXECUTION_ANALYSIS_NOT_FOUND] Analysis ID is required.');
    }

    const planned = project.analysis_plan?.find((a) => a.analysis_id === options.analysis_id?.trim());
    if (!planned) {
      errors.push(
        `[EXECUTION_ANALYSIS_NOT_FOUND] Analysis '${options.analysis_id}' not found in project's analysis plan.`
      );
    } else {
      // Status must strictly be PLANNED
      if (planned.status !== 'PLANNED') {
        errors.push(
          `[EXECUTION_ANALYSIS_NOT_PLANNED] Planned analysis '${planned.analysis_id}' has status '${planned.status}', expected 'PLANNED'.`
        );
      }

      // Analysis Type & Module Resolution
      const normalizedType = planned.analysis_type?.toUpperCase();
      const moduleIdentity = ANALYSIS_MODULE_REGISTRY[normalizedType];

      if (!normalizedType || !moduleIdentity) {
        errors.push(
          `[EXECUTION_INVALID_ANALYSIS_TYPE] Unsupported or unregistered analysis type '${planned.analysis_type}'.`
        );
      }

      // ----------------------------------------------------
      // D. Objective Binding Validation
      // ----------------------------------------------------
      if (!planned.objective_id || typeof planned.objective_id !== 'string' || !planned.objective_id.trim()) {
        errors.push('[EXECUTION_OBJECTIVE_NOT_FOUND] Planned analysis has no associated objective ID.');
      } else {
        const objectiveExists = project.objectives?.some(
          (o) => o.objective_id === planned.objective_id.trim()
        );
        if (!objectiveExists) {
          errors.push(
            `[EXECUTION_OBJECTIVE_NOT_FOUND] Referenced objective '${planned.objective_id}' does not exist in project.`
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
            `[EXECUTION_HYPOTHESIS_NOT_FOUND] Referenced hypothesis '${planned.hypothesis_id}' does not exist in project.`
          );
        }
      }

      // ----------------------------------------------------
      // F. Variables Validation
      // ----------------------------------------------------
      const rawInputs = (planned.input_variable_ids !== undefined)
        ? planned.input_variable_ids
        : (planned.input_variables || []);
      const inputVariables = Array.isArray(rawInputs) ? rawInputs.map((v) => v.trim()).filter(Boolean) : [];

      if (inputVariables.length === 0) {
        errors.push(
          '[EXECUTION_REQUIRED_INPUT_MISSING] Analysis requires at least one input variable.'
        );
      } else {
        for (const varId of inputVariables) {
          if (!variableStore.get(varId)) {
            errors.push(
              `[EXECUTION_VARIABLE_NOT_FOUND] Input variable '${varId}' is not registered in the Variable Registry.`
            );
          }
        }
      }

      // Grouping variables
      const groupingVars: string[] = [];
      if (planned.grouping_variable_ids !== undefined && Array.isArray(planned.grouping_variable_ids)) {
        groupingVars.push(...planned.grouping_variable_ids.map((v) => v.trim()).filter(Boolean));
      } else if (planned.grouping_variable) {
        groupingVars.push(planned.grouping_variable.trim());
      }

      for (const gVar of groupingVars) {
        if (!variableStore.get(gVar)) {
          errors.push(
            `[EXECUTION_VARIABLE_NOT_FOUND] Grouping variable '${gVar}' is not registered in the Variable Registry.`
          );
        }
      }

      // Pairing variables
      const pairingVars: string[] = [];
      if (planned.pairing_variable_ids !== undefined && Array.isArray(planned.pairing_variable_ids)) {
        pairingVars.push(...planned.pairing_variable_ids.map((v) => v.trim()).filter(Boolean));
      } else if (planned.pairing_variable) {
        pairingVars.push(planned.pairing_variable.trim());
      }

      for (const pVar of pairingVars) {
        if (!variableStore.get(pVar)) {
          errors.push(
            `[EXECUTION_VARIABLE_NOT_FOUND] Pairing variable '${pVar}' is not registered in the Variable Registry.`
          );
        }
      }

      // ----------------------------------------------------
      // G. Statistical Parameters Validation
      // ----------------------------------------------------
      if (planned.alpha !== undefined && planned.alpha !== null) {
        if (typeof planned.alpha !== 'number' || isNaN(planned.alpha) || planned.alpha <= 0 || planned.alpha >= 1) {
          errors.push(
            '[EXECUTION_INVALID_ALPHA] Alpha must be a valid probability strictly between 0 and 1 exclusive.'
          );
        }
      } else if (['INFERENTIAL', 'REGRESSION', 'POWER', 'POWER_ANALYSIS', 'NONPARAMETRIC', 'NON_PARAMETRIC'].includes(normalizedType)) {
        errors.push(
          `[EXECUTION_INVALID_ALPHA] Alpha significance threshold is required for '${planned.analysis_type}' analysis.`
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
            '[EXECUTION_INVALID_CONFIDENCE_LEVEL] Confidence level must be a valid probability strictly between 0 and 1 exclusive.'
          );
        }
      }

      // ----------------------------------------------------
      // H. Configuration Security Validation (Zero dynamic code, Zero functions)
      // ----------------------------------------------------
      if (planned.configuration && typeof planned.configuration === 'object') {
        const inspectConfig = (obj: Record<string, unknown>, path: string = '') => {
          for (const [k, v] of Object.entries(obj)) {
            const currentPath = path ? `${path}.${k}` : k;
            if (typeof v === 'function') {
              errors.push(
                `[EXECUTION_CONFIGURATION_INVALID] Executable function found in configuration at '${currentPath}'. Configuration must remain purely declarative data.`
              );
            } else if (typeof v === 'string') {
              // Reject code evaluation strings
              const forbiddenEval = new RegExp('\\b' + 'eval' + '\\s*\\(');
              const forbiddenNewFn = new RegExp('new\\s+' + 'Function' + '\\s*\\(');
              if (forbiddenEval.test(v) || forbiddenNewFn.test(v)) {
                errors.push(
                  `[EXECUTION_CONFIGURATION_INVALID] Prohibited dynamic execution string found in configuration at '${currentPath}'.`
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
    // Result Assembly
    // ----------------------------------------------------
    if (errors.length > 0 || !planned || !binding || !boundArtifact) {
      return {
        status: 'BLOCKED',
        errors,
        warnings,
        dataset_version_id: binding?.dataset_version_id,
        data_artifact_id: binding?.data_artifact_id,
        source_artifact_checksum: binding?.source_artifact_checksum,
        scientific_validity: 'NOT_ESTABLISHED'
      };
    }

    const normalizedType = planned.analysis_type.toUpperCase();
    const moduleIdentity = ANALYSIS_MODULE_REGISTRY[normalizedType]!;
    const planVersion = options.analysis_plan_version || '1.0.0';

    const inputVarIds = (planned.input_variable_ids || planned.input_variables || []).map((v) => v.trim());
    const groupingVarIds = planned.grouping_variable_ids 
      ? planned.grouping_variable_ids.map((v) => v.trim()) 
      : planned.grouping_variable 
        ? [planned.grouping_variable.trim()] 
        : [];
    const pairingVarIds = planned.pairing_variable_ids 
      ? planned.pairing_variable_ids.map((v) => v.trim()) 
      : planned.pairing_variable 
        ? [planned.pairing_variable.trim()] 
        : [];

    const provenancePayload: AnalysisExecutionProvenancePayload = {
      project_id: project.project_id,
      project_version: project.project_version,
      analysis_id: planned.analysis_id,
      analysis_plan_version: planVersion,
      dataset_version_id: binding.dataset_version_id,
      data_artifact_id: binding.data_artifact_id,
      source_artifact_checksum: binding.source_artifact_checksum,
      analysis_type: planned.analysis_type,
      objective_id: planned.objective_id,
      hypothesis_id: planned.hypothesis_id,
      input_variable_ids: inputVarIds,
      grouping_variable_ids: groupingVarIds,
      pairing_variable_ids: pairingVarIds,
      alpha: planned.alpha,
      confidence_level: planned.confidence_level,
      configuration: planned.configuration || {},
      resolved_module_id: moduleIdentity.module_id,
      resolved_module_version: moduleIdentity.module_version,
      scientific_validity: 'NOT_ESTABLISHED'
    };

    const provenanceHash = computeExecutionRequestProvenanceHash(provenancePayload);
    const executionRequestId = `EXREQ_${project.project_id}_${planned.analysis_id}_${provenanceHash.slice(0, 12)}`;

    const executionRequest: AnalysisExecutionRequest = deepFreeze({
      execution_request_id: executionRequestId,
      project_id: project.project_id,
      project_version: project.project_version,
      analysis_id: planned.analysis_id,
      analysis_plan_version: planVersion,
      dataset_version_id: binding.dataset_version_id,
      data_artifact_id: binding.data_artifact_id,
      source_artifact_checksum: binding.source_artifact_checksum,
      analysis_type: planned.analysis_type,
      objective_id: planned.objective_id,
      hypothesis_id: planned.hypothesis_id,
      input_variable_ids: inputVarIds,
      grouping_variable_ids: groupingVarIds.length > 0 ? groupingVarIds : undefined,
      pairing_variable_ids: pairingVarIds.length > 0 ? pairingVarIds : undefined,
      alpha: planned.alpha,
      confidence_level: planned.confidence_level,
      configuration: JSON.parse(JSON.stringify(planned.configuration || {})),
      requested_module_id: moduleIdentity.module_id,
      requested_module_version: moduleIdentity.module_version,
      status: 'READY' as const,
      created_at: new Date().toISOString(),
      provenance_hash: provenanceHash,
      scientific_validity: 'NOT_ESTABLISHED' as const
    });

    return {
      status: 'READY',
      execution_request_id: executionRequestId,
      errors: [],
      warnings,
      resolved_module_id: moduleIdentity.module_id,
      resolved_module_version: moduleIdentity.module_version,
      dataset_version_id: binding.dataset_version_id,
      data_artifact_id: binding.data_artifact_id,
      source_artifact_checksum: binding.source_artifact_checksum,
      provenance_hash: provenanceHash,
      scientific_validity: 'NOT_ESTABLISHED',
      request: executionRequest
    };
  }

  /**
   * Creates an immutable AnalysisExecutionRequest or throws a structured ScientificExecutionBridgeError if BLOCKED.
   */
  public static createExecutionRequest(options: PreflightOptions): AnalysisExecutionRequest {
    const result = AnalysisExecutionPreflight.validate(options);

    if (result.status === 'BLOCKED' || !result.request) {
      const primaryError = result.errors[0] || 'Execution request is blocked by preflight validation.';
      // Extract error code if present
      const match = primaryError.match(/^\[([A-Z_]+)\]/);
      const code = (match ? match[1] : 'EXECUTION_REQUIRED_INPUT_MISSING') as AnalysisExecutionErrorCode;
      throw new ScientificExecutionBridgeError(code, primaryError, { errors: result.errors });
    }

    return result.request;
  }
}
