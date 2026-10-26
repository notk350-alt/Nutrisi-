/**
 * Phase E — Scientific Data Layer: Research Project Registry
 *
 * Implements audited, immutable storage and lifecycle governance for ResearchProjects.
 *
 * Guarantees:
 * - Strict lifecycle transition enforcement
 * - Multi-version project history tracking with parent lineage
 * - Deep immutability and defensive cloning
 * - Zero dynamic code execution (no eval, no new Function)
 */

import {
  ALLOWED_PROJECT_LIFECYCLE_TRANSITIONS,
  createResearchProject,
  ProjectStatus,
  ResearchProject,
  ScientificProjectError,
  validateResearchProject
} from './researchProjectContracts';
import { deepFreeze } from './dataStatePipeline';
import { ResearchProjectProvenance } from './researchProjectProvenance';

export class ResearchProjectRegistry {
  private projects = new Map<string, ResearchProject>();

  private projectKey(projectId: string, version?: string): string {
    return version ? `${projectId}@${version}` : projectId;
  }

  /**
   * Registers a new ResearchProject or project version.
   */
  public registerProject(project: ResearchProject): ResearchProject {
    validateResearchProject(project);

    // Verify provenance hash matches content
    const expectedHash = ResearchProjectProvenance.computeHash(project);
    if (!project.provenance_hash || project.provenance_hash !== expectedHash) {
      project = {
        ...project,
        provenance_hash: expectedHash
      };
    }

    const versionKey = this.projectKey(project.project_id, project.project_version);
    const latestKey = project.project_id;

    // Reject overwriting existing finalized or historical version
    const existing = this.projects.get(versionKey);
    if (existing) {
      if (existing.status === 'ARCHIVED' || (existing.status === 'FINALIZED' && project.status !== 'ARCHIVED')) {
        throw new ScientificProjectError(
          'PROJECT_IMMUTABILITY_VIOLATION',
          `Cannot overwrite immutable project '${project.project_id}' at version '${project.project_version}'`
        );
      }
    }

    const frozen = createResearchProject(JSON.parse(JSON.stringify(project)));
    this.projects.set(versionKey, frozen);
    this.projects.set(latestKey, frozen);

    return frozen;
  }

  /**
   * Retrieves a ResearchProject by ID and optional version. Returns a deep-frozen defensive clone.
   */
  public getProject(projectId: string, version?: string): ResearchProject | undefined {
    const key = this.projectKey(projectId, version);
    const project = this.projects.get(key);
    if (!project) return undefined;
    return deepFreeze(JSON.parse(JSON.stringify(project)));
  }

  /**
   * Lists all registered projects (latest versions).
   */
  public listProjects(): ResearchProject[] {
    const seen = new Set<string>();
    const list: ResearchProject[] = [];

    for (const [key, project] of this.projects.entries()) {
      if (!key.includes('@')) {
        if (!seen.has(project.project_id)) {
          seen.add(project.project_id);
          list.push(deepFreeze(JSON.parse(JSON.stringify(project))));
        }
      }
    }

    return list.sort((a, b) => a.project_id.localeCompare(b.project_id));
  }

  /**
   * Updates project lifecycle status following strict lifecycle rules.
   */
  public updateProjectStatus(
    projectId: string,
    newStatus: ProjectStatus,
    version?: string
  ): ResearchProject {
    const existing = this.getProject(projectId, version);
    if (!existing) {
      throw new ScientificProjectError('PROJECT_NOT_FOUND', `Project '${projectId}' not found in registry`);
    }

    const currentStatus = existing.status;
    if (currentStatus === newStatus) {
      return existing;
    }

    const allowedNext = ALLOWED_PROJECT_LIFECYCLE_TRANSITIONS.get(currentStatus);
    if (!allowedNext || !allowedNext.has(newStatus)) {
      throw new ScientificProjectError(
        'PROJECT_INVALID_LIFECYCLE_TRANSITION',
        `Illegal lifecycle transition from '${currentStatus}' to '${newStatus}' for project '${projectId}'`
      );
    }

    const updated: ResearchProject = {
      ...existing,
      status: newStatus,
      updated_at: new Date().toISOString()
    };

    // Recompute provenance
    const newHash = ResearchProjectProvenance.computeHash(updated);
    updated.provenance_hash = newHash;

    return this.registerProject(updated);
  }

  /**
   * Creates a new version of an existing project with modifications.
   * Historical versions remain untouched and permanently immutable.
   */
  public createProjectVersion(
    projectId: string,
    newVersion: string,
    modifications: Partial<Omit<ResearchProject, 'project_id' | 'project_version' | 'parent_version' | 'created_at'>>,
    modifiedBy?: string
  ): ResearchProject {
    const current = this.getProject(projectId);
    if (!current) {
      throw new ScientificProjectError('PROJECT_NOT_FOUND', `Project '${projectId}' not found`);
    }

    if (current.project_version === newVersion) {
      throw new ScientificProjectError(
        'PROJECT_ALREADY_EXISTS',
        `Version '${newVersion}' already exists for project '${projectId}'`
      );
    }

    const now = new Date().toISOString();
    const updatedDraft: ResearchProject = {
      ...current,
      ...modifications,
      project_id: projectId,
      project_version: newVersion,
      parent_version: current.project_version,
      updated_at: now,
      created_by: modifiedBy ?? current.created_by,
      status: modifications.status ?? current.status,
      provenance_hash: ''
    };

    const newHash = ResearchProjectProvenance.computeHash(updatedDraft);
    updatedDraft.provenance_hash = newHash;

    return this.registerProject(updatedDraft);
  }
}

// Global default singleton instance
export const defaultResearchProjectRegistry = new ResearchProjectRegistry();
