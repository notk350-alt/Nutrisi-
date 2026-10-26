/**
 * Phase E — Scientific Data Layer: Research Project Provenance
 *
 * Implements deterministic canonical provenance generation for ResearchProject.
 *
 * Guarantees:
 * - Deterministic SHA-256 cryptographic hash
 * - Sensitivity to any changes in questions, design, objectives, hypotheses,
 *   dataset bindings, variable roles, planned analyses, power plans, or result bindings
 * - Zero dynamic code execution (no eval, no new Function)
 */

import * as crypto from 'crypto';
import { canonicalizeJson } from '../provenance/provenancePersistence';
import { ResearchProject } from './researchProjectContracts';

export interface ProjectProvenancePayload {
  project_id: string;
  project_version: string;
  parent_version?: string | null;
  title: string;
  description: string;
  status: string;
  study_design: {
    design_type: string;
    description: string;
    blinding?: string;
    randomization?: boolean;
    temporal_direction?: string;
  };
  research_questions: Array<{
    question_id: string;
    question_text: string;
    priority: string;
    objective_ids: string[];
    status: string;
  }>;
  objectives: Array<{
    objective_id: string;
    type: string;
    description: string;
    target_variables?: string[];
  }>;
  hypotheses: Array<{
    hypothesis_id: string;
    question_id: string;
    objective_id: string;
    null_hypothesis: string;
    alternative_hypothesis: string;
    direction: string;
    planned_alpha?: number;
  }>;
  dataset_binding?: {
    dataset_version_id: string;
    data_artifact_id: string;
    source_artifact_checksum: string;
  };
  variable_plan: Array<{
    variable_id: string;
    role: string;
    transformation?: string;
  }>;
  analysis_plan: Array<{
    analysis_id: string;
    objective_id: string;
    hypothesis_id?: string;
    analysis_type: string;
    input_variables: string[];
    alpha?: number;
  }>;
  power_plan: Array<{
    analysis_id: string;
    target_power: number;
    alpha: number;
    effect_size: number;
    required_sample_size?: number;
  }>;
  plan_deviations: Array<{
    deviation_id: string;
    planned_analysis_id: string;
    executed_analysis_id?: string;
    deviation_type: string;
    reason: string;
  }>;
  result_bindings: {
    d9_results: string[];
    d10_results: string[];
    d11_results: string[];
    d12_results: string[];
    d13_results: string[];
  };
  visualization_bindings: string[];
  interpretation_bindings: {
    interpretation_ids: string[];
    profile_ids: string[];
    rule_ids: string[];
  };
  evidence_bindings: string[];
  report_bindings: string[];
  engine_version: string;
}

export class ResearchProjectProvenance {
  public static readonly ENGINE_VERSION = '1.0.0';

  /**
   * Constructs the deterministic canonical provenance payload from a project.
   */
  public static buildPayload(project: Omit<ResearchProject, 'provenance_hash'>): ProjectProvenancePayload {
    return {
      project_id: project.project_id,
      project_version: project.project_version,
      parent_version: project.parent_version ?? null,
      title: project.title,
      description: project.description,
      status: project.status,
      study_design: {
        design_type: project.study_design.design_type,
        description: project.study_design.description,
        blinding: project.study_design.blinding,
        randomization: project.study_design.randomization,
        temporal_direction: project.study_design.temporal_direction
      },
      research_questions: project.research_questions.map((q) => ({
        question_id: q.question_id,
        question_text: q.question_text,
        priority: q.priority,
        objective_ids: [...q.objective_ids].sort(),
        status: q.status
      })).sort((a, b) => a.question_id.localeCompare(b.question_id)),
      objectives: project.objectives.map((o) => ({
        objective_id: o.objective_id,
        type: o.type,
        description: o.description,
        target_variables: o.target_variables ? [...o.target_variables].sort() : []
      })).sort((a, b) => a.objective_id.localeCompare(b.objective_id)),
      hypotheses: project.hypotheses.map((h) => ({
        hypothesis_id: h.hypothesis_id,
        question_id: h.question_id,
        objective_id: h.objective_id,
        null_hypothesis: h.null_hypothesis,
        alternative_hypothesis: h.alternative_hypothesis,
        direction: h.direction,
        planned_alpha: h.planned_alpha
      })).sort((a, b) => a.hypothesis_id.localeCompare(b.hypothesis_id)),
      dataset_binding: project.dataset_binding ? {
        dataset_version_id: project.dataset_binding.dataset_version_id,
        data_artifact_id: project.dataset_binding.data_artifact_id,
        source_artifact_checksum: project.dataset_binding.source_artifact_checksum
      } : undefined,
      variable_plan: project.variable_plan.map((v) => ({
        variable_id: v.variable_id,
        role: v.role,
        transformation: v.transformation
      })).sort((a, b) => a.variable_id.localeCompare(b.variable_id)),
      analysis_plan: project.analysis_plan.map((a) => ({
        analysis_id: a.analysis_id,
        objective_id: a.objective_id,
        hypothesis_id: a.hypothesis_id,
        analysis_type: a.analysis_type,
        input_variables: [...a.input_variables].sort(),
        alpha: a.alpha
      })).sort((a, b) => a.analysis_id.localeCompare(b.analysis_id)),
      power_plan: project.power_plan.map((p) => ({
        analysis_id: p.analysis_id,
        target_power: p.target_power,
        alpha: p.alpha,
        effect_size: p.effect_size,
        required_sample_size: p.required_sample_size
      })).sort((a, b) => a.analysis_id.localeCompare(b.analysis_id)),
      plan_deviations: project.plan_deviations.map((d) => ({
        deviation_id: d.deviation_id,
        planned_analysis_id: d.planned_analysis_id,
        executed_analysis_id: d.executed_analysis_id,
        deviation_type: d.deviation_type,
        reason: d.reason
      })).sort((a, b) => a.deviation_id.localeCompare(b.deviation_id)),
      result_bindings: {
        d9_results: [...project.result_bindings.d9_results].sort(),
        d10_results: [...project.result_bindings.d10_results].sort(),
        d11_results: [...project.result_bindings.d11_results].sort(),
        d12_results: [...project.result_bindings.d12_results].sort(),
        d13_results: [...project.result_bindings.d13_results].sort()
      },
      visualization_bindings: [...project.visualization_bindings.visualization_ids].sort(),
      interpretation_bindings: {
        interpretation_ids: [...project.interpretation_bindings.interpretation_ids].sort(),
        profile_ids: [...project.interpretation_bindings.profile_ids].sort(),
        rule_ids: [...project.interpretation_bindings.rule_ids].sort()
      },
      evidence_bindings: [...project.evidence_bindings.evidence_trace_ids].sort(),
      report_bindings: [...project.report_bindings.report_ids].sort(),
      engine_version: project.engine_version ?? ResearchProjectProvenance.ENGINE_VERSION
    };
  }

  /**
   * Computes deterministic SHA-256 provenance hash.
   */
  public static computeHash(project: Omit<ResearchProject, 'provenance_hash'>): string {
    const payload = ResearchProjectProvenance.buildPayload(project);
    const canonical = canonicalizeJson(payload);
    return crypto.createHash('sha256').update(canonical).digest('hex');
  }
}
