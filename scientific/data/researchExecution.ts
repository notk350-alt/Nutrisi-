/**
 * Phase E — Scientific Data Layer: Research Execution & Deviation Engine
 *
 * Implements:
 * 1. Planned vs Executed Analysis Comparison
 * 2. Automated Plan Deviation Auditing
 * 3. Immutable Project Execution History
 *
 * Invariants:
 * - Never silently overwrite or mutate planned analyses
 * - Discrepancies generate structured PlanDeviation records
 * - Execution records are cryptographically sealed and deep-frozen
 * - Zero eval, zero dynamic code execution
 */

import { sha256Hex } from '../crypto';
import {
  createResearchProject,
  DeviationType,
  PlanDeviation,
  PlannedAnalysis,
  ProjectExecutionRecord,
  ProjectExecutionStatus,
  ResearchProject,
  ScientificProjectError
} from './researchProjectContracts';
import { canonicalizeJson } from '../provenance/provenancePersistence';
import { deepFreeze } from './dataStatePipeline';
import { ResearchProjectProvenance } from './researchProjectProvenance';

export interface ExecutedAnalysisInfo {
  analysis_id: string;
  analysis_type: string;
  input_variables: string[];
  alpha?: number;
  confidence_level?: number;
  configuration?: Record<string, unknown>;
  execution_reference?: string;
}

export interface RecordExecutionOptions {
  execution_id: string;
  analysis_plan_version?: string;
  engine_versions?: Record<string, string>;
  started_at: string;
  completed_at: string;
  status: ProjectExecutionStatus;
  executed_analyses: ExecutedAnalysisInfo[];
  result_references: string[];
  user: string;
  warnings?: string[];
}

export class ResearchExecutionEngine {
  public static readonly ENGINE_VERSION = '1.0.0';

  /**
   * Compares a planned analysis against an actual execution and detects deviations.
   */
  public static comparePlannedVsExecuted(
    planned: PlannedAnalysis,
    executed: ExecutedAnalysisInfo,
    user: string
  ): PlanDeviation | null {
    // 1. Method / Analysis Type Change
    if (planned.analysis_type !== executed.analysis_type) {
      return {
        deviation_id: `DEV_${planned.analysis_id}_${Date.now()}`,
        planned_analysis_id: planned.analysis_id,
        executed_analysis_id: executed.analysis_id,
        deviation_type: 'METHOD_CHANGE',
        reason: `Analysis type changed from planned '${planned.analysis_type}' to executed '${executed.analysis_type}'`,
        timestamp: new Date().toISOString(),
        user,
        resulting_execution_reference: executed.execution_reference
      };
    }

    // 2. Input Variables Change
    const plannedVars = [...planned.input_variables].sort();
    const executedVars = [...executed.input_variables].sort();
    if (
      plannedVars.length !== executedVars.length ||
      !plannedVars.every((v, i) => v === executedVars[i])
    ) {
      return {
        deviation_id: `DEV_${planned.analysis_id}_${Date.now()}`,
        planned_analysis_id: planned.analysis_id,
        executed_analysis_id: executed.analysis_id,
        deviation_type: 'VARIABLE_SUBSTITUTION',
        reason: `Input variables altered: planned [${plannedVars.join(', ')}], executed [${executedVars.join(', ')}]`,
        timestamp: new Date().toISOString(),
        user,
        resulting_execution_reference: executed.execution_reference
      };
    }

    // 3. Significance Threshold Alpha Change
    if (
      planned.alpha !== undefined &&
      executed.alpha !== undefined &&
      planned.alpha !== executed.alpha
    ) {
      return {
        deviation_id: `DEV_${planned.analysis_id}_${Date.now()}`,
        planned_analysis_id: planned.analysis_id,
        executed_analysis_id: executed.analysis_id,
        deviation_type: 'ALPHA_ADJUSTMENT',
        reason: `Significance level alpha changed from planned ${planned.alpha} to executed ${executed.alpha}`,
        timestamp: new Date().toISOString(),
        user,
        resulting_execution_reference: executed.execution_reference
      };
    }

    // 4. Configuration Mismatch
    if (planned.configuration && executed.configuration) {
      const plannedKeys = Object.keys(planned.configuration).sort();
      for (const key of plannedKeys) {
        if (
          executed.configuration[key] !== undefined &&
          executed.configuration[key] !== planned.configuration[key]
        ) {
          return {
            deviation_id: `DEV_${planned.analysis_id}_${Date.now()}`,
            planned_analysis_id: planned.analysis_id,
            executed_analysis_id: executed.analysis_id,
            deviation_type: 'PARAMETER_MISMATCH',
            reason: `Configuration parameter '${key}' changed from '${planned.configuration[key]}' to '${executed.configuration[key]}'`,
            timestamp: new Date().toISOString(),
            user,
            resulting_execution_reference: executed.execution_reference
          };
        }
      }
    }

    return null;
  }

  /**
   * Records an execution event into the ResearchProject's history,
   * automatically performing plan vs executed audits and recording deviations.
   */
  public static recordExecution(
    project: ResearchProject,
    options: RecordExecutionOptions
  ): ResearchProject {
    if (project.status === 'FINALIZED' || project.status === 'ARCHIVED') {
      throw new ScientificProjectError(
        'PROJECT_IMMUTABILITY_VIOLATION',
        `Cannot execute analyses on project '${project.project_id}' in terminal status '${project.status}'`
      );
    }

    if (!project.dataset_binding) {
      throw new ScientificProjectError(
        'PROJECT_DATASET_NOT_FOUND',
        `Project '${project.project_id}' has no dataset bound for execution`
      );
    }

    const detectedDeviations: PlanDeviation[] = [];
    const updatedAnalysisPlan = [...project.analysis_plan];

    // Audit each executed analysis against planned analyses
    for (const executed of options.executed_analyses) {
      const plannedIndex = updatedAnalysisPlan.findIndex(
        (p) => p.analysis_id === executed.analysis_id
      );

      if (plannedIndex >= 0) {
        const planned = updatedAnalysisPlan[plannedIndex];
        const deviation = ResearchExecutionEngine.comparePlannedVsExecuted(
          planned,
          executed,
          options.user
        );

        if (deviation) {
          detectedDeviations.push(deviation);
          updatedAnalysisPlan[plannedIndex] = {
            ...planned,
            status: 'DEVIATED'
          };
        } else {
          updatedAnalysisPlan[plannedIndex] = {
            ...planned,
            status: 'EXECUTED'
          };
        }
      } else {
        // Unplanned analysis executed
        detectedDeviations.push({
          deviation_id: `DEV_UNPLANNED_${executed.analysis_id}_${Date.now()}`,
          planned_analysis_id: 'NONE',
          executed_analysis_id: executed.analysis_id,
          deviation_type: 'UNPLANNED_ANALYSIS',
          reason: `Executed analysis '${executed.analysis_id}' was not in the original analysis plan`,
          timestamp: new Date().toISOString(),
          user: options.user,
          resulting_execution_reference: executed.execution_reference
        });
      }
    }

    // Build Execution Provenance Payload
    const execProvenancePayload = {
      execution_id: options.execution_id,
      project_id: project.project_id,
      project_version: project.project_version,
      dataset_version_id: project.dataset_binding.dataset_version_id,
      data_artifact_id: project.dataset_binding.data_artifact_id,
      source_artifact_checksum: project.dataset_binding.source_artifact_checksum,
      analysis_plan_version: options.analysis_plan_version ?? project.project_version,
      engine_versions: options.engine_versions ?? { execution_engine: ResearchExecutionEngine.ENGINE_VERSION },
      started_at: options.started_at,
      completed_at: options.completed_at,
      status: options.status,
      executed_analyses: options.executed_analyses.map((e) => e.analysis_id).sort(),
      result_references: [...options.result_references].sort(),
      deviations: detectedDeviations.map((d) => d.deviation_id).sort(),
      warnings: options.warnings ? [...options.warnings].sort() : []
    };

    const execProvenanceHash = sha256Hex(canonicalizeJson(execProvenancePayload));

    const executionRecord: ProjectExecutionRecord = deepFreeze({
      execution_id: options.execution_id,
      project_id: project.project_id,
      project_version: project.project_version,
      dataset_version_id: project.dataset_binding.dataset_version_id,
      data_artifact_id: project.dataset_binding.data_artifact_id,
      source_artifact_checksum: project.dataset_binding.source_artifact_checksum,
      analysis_plan_version: options.analysis_plan_version ?? project.project_version,
      engine_versions: options.engine_versions ?? { execution_engine: ResearchExecutionEngine.ENGINE_VERSION },
      started_at: options.started_at,
      completed_at: options.completed_at,
      status: options.status,
      executed_analyses: options.executed_analyses.map((e) => e.analysis_id),
      result_references: options.result_references,
      deviations: detectedDeviations,
      warnings: options.warnings ?? [],
      provenance_hash: execProvenanceHash
    });

    const updatedDeviations = [...project.plan_deviations, ...detectedDeviations];
    const updatedHistory = [...project.execution_history, executionRecord];

    // Lifecycle status transition
    let newStatus = project.status;
    if (project.status === 'ANALYSIS_READY' || project.status === 'EXECUTING') {
      newStatus = 'ANALYZED';
    }

    const updatedDraft: ResearchProject = {
      ...project,
      status: newStatus,
      analysis_plan: updatedAnalysisPlan,
      plan_deviations: updatedDeviations,
      execution_history: updatedHistory,
      updated_at: new Date().toISOString(),
      provenance_hash: ''
    };

    const newProjectHash = ResearchProjectProvenance.computeHash(updatedDraft);
    updatedDraft.provenance_hash = newProjectHash;

    return createResearchProject(updatedDraft);
  }
}
