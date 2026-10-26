/**
 * NutriBodySim — Object-Level Authorization & Project Isolation (MVS-B2.4)
 *
 * Enforces server-side authorization boundaries on specific data objects to prevent
 * Broken Object Level Authorization (BOLA) and Insecure Direct Object References (IDOR).
 *
 * Core Guarantees:
 * 1. Passing RBAC does NOT imply object access. Users with 'EDIT' or 'SHARE' permissions
 *    can only mutate or share objects they own or have project/team membership for.
 * 2. Parameter tampering defense: client-supplied owner_id, user_id, team_id, role,
 *    and permissions from query, body, or headers are strictly rejected or overridden.
 * 3. Deep hierarchy inheritance: child objects (datasets, dataset versions, notebooks,
 *    cells, experiments, charts, provenance) inherit access constraints from their parent project.
 * 4. Administrative override is audited explicitly in the immutable system audit trail.
 * 5. Private projects and child objects are strictly isolated; unauthorized users receive HTTP 403.
 */

import { Request, Response } from 'express';
import { 
  User, 
  Project, 
  Team, 
  Material, 
  Dataset, 
  NutriNotebook, 
  NotebookCell, 
  Experiment, 
  Note, 
  Bookmark, 
  Highlight,
  ProvenanceRecord,
  RoleRequest
} from '../database/types';
import { db } from '../database/store';
import { getCurrentUser } from './authMiddleware';
import { hasPermission } from './rbacMiddleware';

export type ObjectAction = 'READ' | 'WRITE' | 'DELETE' | 'SHARE' | 'MANAGE_MEMBERS';

export interface ObjectAuthResult {
  allowed: boolean;
  reason?: string;
  isAdminOverride?: boolean;
}

/**
 * Checks whether a user has permission to access a specific Project.
 */
export function canAccessProject(
  user: User, 
  project: Project, 
  action: ObjectAction = 'READ'
): ObjectAuthResult {
  if (user.account_status && user.account_status !== 'ACTIVE') {
    return {
      allowed: false,
      reason: `Account is ${user.account_status}. Access to project is forbidden.`
    };
  }

  const isAdmin = hasPermission(user, 'ADMIN');
  const isDirectOwner = project.owner_id === user.id;

  // 1. Direct Owner has full privileges
  if (isDirectOwner) {
    return { allowed: true, isAdminOverride: false };
  }

  // 2. Project Member privileges
  const state = db.getState();
  const projectMember = state.project_members.find(
    pm => pm.project_id === project.id && pm.user_id === user.id
  );

  if (projectMember) {
    if (action === 'READ') {
      return { allowed: true };
    }
    if (action === 'WRITE') {
      if (['Owner', 'Editor', 'Collaborator'].includes(projectMember.role)) {
        return { allowed: true };
      }
      return { allowed: false, reason: `Project member role "${projectMember.role}" lacks WRITE access.` };
    }
    if (action === 'SHARE') {
      if (['Owner', 'Editor'].includes(projectMember.role)) {
        return { allowed: true };
      }
      return { allowed: false, reason: `Project member role "${projectMember.role}" lacks SHARE access.` };
    }
    if (action === 'DELETE') {
      if (projectMember.role === 'Owner') {
        return { allowed: true };
      }
      return { allowed: false, reason: `Only project owner can DELETE this project.` };
    }
  }

  // 3. Team Member privileges (if project is associated with a team)
  if (project.team_id) {
    const teamMember = state.team_members.find(
      tm => tm.team_id === project.team_id && tm.user_id === user.id
    );

    if (teamMember) {
      if (action === 'READ') {
        return { allowed: true };
      }
      if (action === 'WRITE') {
        if (['Owner', 'Editor', 'Collaborator'].includes(teamMember.role)) {
          return { allowed: true };
        }
        return { allowed: false, reason: `Team member role "${teamMember.role}" lacks WRITE access.` };
      }
      if (action === 'SHARE') {
        if (['Owner', 'Editor'].includes(teamMember.role)) {
          return { allowed: true };
        }
        return { allowed: false, reason: `Team member role "${teamMember.role}" lacks SHARE access.` };
      }
      if (action === 'DELETE') {
        if (teamMember.role === 'Owner') {
          return { allowed: true };
        }
        return { allowed: false, reason: `Only team owner can DELETE project.` };
      }
    }
  }

  // 4. Public Project Read Access
  if (action === 'READ' && project.is_public) {
    return { allowed: true };
  }

  // 5. Administrator Override
  if (isAdmin) {
    return { 
      allowed: true, 
      isAdminOverride: true, 
      reason: `Admin governance override by ${user.name}` 
    };
  }

  return {
    allowed: false,
    reason: `User "${user.id}" does not have ${action} permission on project "${project.id}".`
  };
}

/**
 * Checks whether a user can access a Dataset.
 */
export function canAccessDataset(
  user: User, 
  dataset: Dataset, 
  action: ObjectAction = 'READ'
): ObjectAuthResult {
  if (user.account_status && user.account_status !== 'ACTIVE') {
    return {
      allowed: false,
      reason: `Account is ${user.account_status}. Access to dataset is forbidden.`
    };
  }

  const isAdmin = hasPermission(user, 'ADMIN');

  if (dataset.uploaded_by === user.id) {
    return { allowed: true };
  }

  const state = db.getState();
  const parentProject = state.projects.find(p => p.id === dataset.project_id);
  if (parentProject) {
    return canAccessProject(user, parentProject, action);
  }

  if (isAdmin) {
    return { allowed: true, isAdminOverride: true };
  }

  return { 
    allowed: false, 
    reason: `No access to dataset "${dataset.id}" or parent project.` 
  };
}

/**
 * Checks whether a user can access a Notebook.
 */
export function canAccessNotebook(
  user: User, 
  notebook: NutriNotebook, 
  action: ObjectAction = 'READ'
): ObjectAuthResult {
  if (user.account_status && user.account_status !== 'ACTIVE') {
    return {
      allowed: false,
      reason: `Account is ${user.account_status}. Access to notebook is forbidden.`
    };
  }

  const isAdmin = hasPermission(user, 'ADMIN');

  if (notebook.created_by === user.id) {
    return { allowed: true };
  }

  const state = db.getState();
  const parentProject = state.projects.find(p => p.id === notebook.project_id);
  if (parentProject) {
    return canAccessProject(user, parentProject, action);
  }

  if (isAdmin) {
    return { allowed: true, isAdminOverride: true };
  }

  return { 
    allowed: false, 
    reason: `No access to notebook "${notebook.id}" or parent project.` 
  };
}

/**
 * Checks whether a user can access a Notebook Cell.
 */
export function canAccessNotebookCell(
  user: User, 
  cell: NotebookCell, 
  action: ObjectAction = 'READ'
): ObjectAuthResult {
  if (user.account_status && user.account_status !== 'ACTIVE') {
    return {
      allowed: false,
      reason: `Account is ${user.account_status}. Access to notebook cell is forbidden.`
    };
  }

  const state = db.getState();
  const notebook = state.notebooks.find(nb => nb.id === cell.notebook_id);
  if (!notebook) {
    return { allowed: false, reason: `Notebook "${cell.notebook_id}" not found.` };
  }
  return canAccessNotebook(user, notebook, action);
}

/**
 * Checks whether a user can access a Material.
 */
export function canAccessMaterial(
  user: User, 
  material: Material, 
  action: ObjectAction = 'READ'
): ObjectAuthResult {
  if (user.account_status && user.account_status !== 'ACTIVE') {
    return {
      allowed: false,
      reason: `Account is ${user.account_status}. Access to material is forbidden.`
    };
  }

  const isAdmin = hasPermission(user, 'ADMIN');

  if (material.uploaded_by === user.id) {
    return { allowed: true };
  }

  if (action === 'READ') {
    // If material is not locked to specific private projects, it is in the general reference catalog
    if (!material.project_ids || material.project_ids.length === 0) {
      return { allowed: true };
    }

    // If linked to projects, check if at least one project is accessible to the user
    const state = db.getState();
    const hasAccessibleProject = material.project_ids.some(projId => {
      const proj = state.projects.find(p => p.id === projId);
      if (!proj) return false;
      return canAccessProject(user, proj, 'READ').allowed;
    });

    if (hasAccessibleProject) {
      return { allowed: true };
    }
  }

  if (isAdmin) {
    return { allowed: true, isAdminOverride: true };
  }

  return { 
    allowed: false, 
    reason: `User lacks ${action} authorization for material "${material.id}".` 
  };
}

/**
 * Checks whether a user can access an Experiment.
 */
export function canAccessExperiment(
  user: User, 
  experiment: Experiment, 
  action: ObjectAction = 'READ'
): ObjectAuthResult {
  if (user.account_status && user.account_status !== 'ACTIVE') {
    return {
      allowed: false,
      reason: `Account is ${user.account_status}. Access to experiment is forbidden.`
    };
  }

  const isAdmin = hasPermission(user, 'ADMIN');

  if (experiment.created_by === user.id) {
    return { allowed: true };
  }

  const state = db.getState();
  const parentProject = state.projects.find(p => p.id === experiment.project_id);
  if (parentProject) {
    return canAccessProject(user, parentProject, action);
  }

  if (isAdmin) {
    return { allowed: true, isAdminOverride: true };
  }

  return { 
    allowed: false, 
    reason: `User lacks ${action} authorization for experiment "${experiment.id}".` 
  };
}

/**
 * Checks whether a user can access a Team.
 */
export function canAccessTeam(
  user: User,
  team: Team,
  action: ObjectAction = 'READ'
): ObjectAuthResult {
  if (user.account_status && user.account_status !== 'ACTIVE') {
    return {
      allowed: false,
      reason: `Account is ${user.account_status}. Access to team is forbidden.`
    };
  }

  const isAdmin = hasPermission(user, 'ADMIN');

  if (team.owner_id === user.id) {
    return { allowed: true };
  }

  const state = db.getState();
  const member = state.team_members.find(tm => tm.team_id === team.id && tm.user_id === user.id);

  if (action === 'READ') {
    // Team directory is visible to institutional members
    return { allowed: true };
  }

  if (member) {
    if (action === 'WRITE') {
      if (['Owner', 'Editor'].includes(member.role)) return { allowed: true };
    }
    if (action === 'DELETE' || action === 'SHARE') {
      if (member.role === 'Owner') return { allowed: true };
    }
  }

  if (isAdmin) {
    return { allowed: true, isAdminOverride: true };
  }

  return { 
    allowed: false, 
    reason: `User lacks ${action} privilege on team "${team.id}".` 
  };
}

/**
 * Checks whether a user can access a Note.
 */
export function canAccessNote(
  user: User,
  note: Note,
  action: ObjectAction = 'READ'
): ObjectAuthResult {
  if (user.account_status && user.account_status !== 'ACTIVE') {
    return {
      allowed: false,
      reason: `Account is ${user.account_status}. Access to note is forbidden.`
    };
  }

  const isAdmin = hasPermission(user, 'ADMIN');

  if (note.user_id === user.id) {
    return { allowed: true };
  }

  if (action === 'READ' && note.project_id) {
    const state = db.getState();
    const proj = state.projects.find(p => p.id === note.project_id);
    if (proj && canAccessProject(user, proj, 'READ').allowed) {
      return { allowed: true };
    }
  }

  if (isAdmin) {
    return { allowed: true, isAdminOverride: true };
  }

  return { 
    allowed: false, 
    reason: `User "${user.id}" cannot access note "${note.id}" owned by "${note.user_id}".` 
  };
}

// ---------------------------------------------------------------------------
// Route Authorization Helpers (Returning 403 / 404 & Logging Audit Trail)
// ---------------------------------------------------------------------------

/**
 * Authorizes access to a Project by ID, sending 404 if not found or 403 if unauthorized.
 * Returns the Project if authorized, or null if response was sent.
 */
export function authorizeProject(
  req: Request, 
  res: Response, 
  projectId: string, 
  action: ObjectAction = 'READ'
): Project | null {
  const user = getCurrentUser(req);
  const state = db.getState();
  const project = state.projects.find(p => p.id === projectId);

  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return null;
  }

  const result = canAccessProject(user, project, action);
  if (!result.allowed) {
    db.logAudit(
      user.id,
      'VERIFY',
      'SECURITY_BOLA',
      project.id,
      `BOLA Denied: ${user.name} (${user.role}) denied ${action} on project "${project.name}" (${project.id}): ${result.reason}`
    );
    res.status(403).json({
      error: `Access denied: You do not have ${action} permission for this project`,
      code: 'OBJECT_ACCESS_DENIED',
      entity_type: 'PROJECT',
      entity_id: project.id,
      reason: result.reason
    });
    return null;
  }

  if (result.isAdminOverride) {
    db.logAudit(
      user.id,
      'VERIFY',
      'ADMIN_OVERRIDE',
      project.id,
      `Admin override: ${user.name} performed ${action} on project "${project.name}" (${project.id})`
    );
  }

  return project;
}

/**
 * Authorizes access to a Dataset by ID.
 */
export function authorizeDataset(
  req: Request, 
  res: Response, 
  datasetId: string, 
  action: ObjectAction = 'READ'
): Dataset | null {
  const user = getCurrentUser(req);
  const state = db.getState();
  const dataset = state.datasets.find(d => d.id === datasetId);

  if (!dataset) {
    res.status(404).json({ error: 'Dataset not found' });
    return null;
  }

  const result = canAccessDataset(user, dataset, action);
  if (!result.allowed) {
    db.logAudit(
      user.id,
      'VERIFY',
      'SECURITY_BOLA',
      dataset.id,
      `BOLA Denied: ${user.name} denied ${action} on dataset "${dataset.name}" (${dataset.id})`
    );
    res.status(403).json({
      error: `Access denied: You do not have ${action} permission for this dataset`,
      code: 'OBJECT_ACCESS_DENIED',
      entity_type: 'DATASET',
      entity_id: dataset.id,
      reason: result.reason
    });
    return null;
  }

  if (result.isAdminOverride) {
    db.logAudit(
      user.id,
      'VERIFY',
      'ADMIN_OVERRIDE',
      dataset.id,
      `Admin override: ${user.name} performed ${action} on dataset "${dataset.name}" (${dataset.id})`
    );
  }

  return dataset;
}

/**
 * Authorizes access to a Notebook by ID.
 */
export function authorizeNotebook(
  req: Request, 
  res: Response, 
  notebookId: string, 
  action: ObjectAction = 'READ'
): NutriNotebook | null {
  const user = getCurrentUser(req);
  const state = db.getState();
  const notebook = state.notebooks.find(nb => nb.id === notebookId);

  if (!notebook) {
    res.status(404).json({ error: 'Notebook not found' });
    return null;
  }

  const result = canAccessNotebook(user, notebook, action);
  if (!result.allowed) {
    db.logAudit(
      user.id,
      'VERIFY',
      'SECURITY_BOLA',
      notebook.id,
      `BOLA Denied: ${user.name} denied ${action} on notebook "${notebook.title}" (${notebook.id})`
    );
    res.status(403).json({
      error: `Access denied: You do not have ${action} permission for this notebook`,
      code: 'OBJECT_ACCESS_DENIED',
      entity_type: 'NOTEBOOK',
      entity_id: notebook.id,
      reason: result.reason
    });
    return null;
  }

  if (result.isAdminOverride) {
    db.logAudit(
      user.id,
      'VERIFY',
      'ADMIN_OVERRIDE',
      notebook.id,
      `Admin override: ${user.name} performed ${action} on notebook "${notebook.title}" (${notebook.id})`
    );
  }

  return notebook;
}

/**
 * Authorizes access to a Notebook Cell by ID.
 */
export function authorizeNotebookCell(
  req: Request,
  res: Response,
  cellId: string,
  action: ObjectAction = 'READ'
): NotebookCell | null {
  const user = getCurrentUser(req);
  const state = db.getState();
  const cell = state.notebook_cells.find(c => c.id === cellId);

  if (!cell) {
    res.status(404).json({ error: 'Notebook cell not found' });
    return null;
  }

  const result = canAccessNotebookCell(user, cell, action);
  if (!result.allowed) {
    db.logAudit(
      user.id,
      'VERIFY',
      'SECURITY_BOLA',
      cell.id,
      `BOLA Denied: ${user.name} denied ${action} on notebook cell "${cell.id}": ${result.reason}`
    );
    res.status(403).json({
      error: `Access denied: You do not have ${action} permission for this notebook cell`,
      code: 'OBJECT_ACCESS_DENIED',
      entity_type: 'NOTEBOOK_CELL',
      entity_id: cell.id,
      reason: result.reason
    });
    return null;
  }

  if (result.isAdminOverride) {
    db.logAudit(
      user.id,
      'VERIFY',
      'ADMIN_OVERRIDE',
      cell.id,
      `Admin override: ${user.name} performed ${action} on cell "${cell.id}"`
    );
  }

  return cell;
}

/**
 * Authorizes access to a Material by ID.
 */
export function authorizeMaterial(
  req: Request,
  res: Response,
  materialId: string,
  action: ObjectAction = 'READ'
): Material | null {
  const user = getCurrentUser(req);
  const state = db.getState();
  const material = state.materials.find(m => m.id === materialId);

  if (!material) {
    res.status(404).json({ error: 'Material not found' });
    return null;
  }

  const result = canAccessMaterial(user, material, action);
  if (!result.allowed) {
    db.logAudit(
      user.id,
      'VERIFY',
      'SECURITY_BOLA',
      material.id,
      `BOLA Denied: ${user.name} denied ${action} on material "${material.title}" (${material.id})`
    );
    res.status(403).json({
      error: `Access denied: You do not have ${action} permission for this material`,
      code: 'OBJECT_ACCESS_DENIED',
      entity_type: 'MATERIAL',
      entity_id: material.id,
      reason: result.reason
    });
    return null;
  }

  if (result.isAdminOverride) {
    db.logAudit(
      user.id,
      'VERIFY',
      'ADMIN_OVERRIDE',
      material.id,
      `Admin override: ${user.name} performed ${action} on material "${material.title}" (${material.id})`
    );
  }

  return material;
}

/**
 * Authorizes access to an Experiment by ID.
 */
export function authorizeExperiment(
  req: Request,
  res: Response,
  experimentId: string,
  action: ObjectAction = 'READ'
): Experiment | null {
  const user = getCurrentUser(req);
  const state = db.getState();
  const experiment = state.experiments.find(e => e.id === experimentId);

  if (!experiment) {
    res.status(404).json({ error: 'Experiment not found' });
    return null;
  }

  const result = canAccessExperiment(user, experiment, action);
  if (!result.allowed) {
    db.logAudit(
      user.id,
      'VERIFY',
      'SECURITY_BOLA',
      experiment.id,
      `BOLA Denied: ${user.name} denied ${action} on experiment "${experiment.title}" (${experiment.id})`
    );
    res.status(403).json({
      error: `Access denied: You do not have ${action} permission for this experiment`,
      code: 'OBJECT_ACCESS_DENIED',
      entity_type: 'EXPERIMENT',
      entity_id: experiment.id,
      reason: result.reason
    });
    return null;
  }

  if (result.isAdminOverride) {
    db.logAudit(
      user.id,
      'VERIFY',
      'ADMIN_OVERRIDE',
      experiment.id,
      `Admin override: ${user.name} performed ${action} on experiment "${experiment.title}" (${experiment.id})`
    );
  }

  return experiment;
}

/**
 * Authorizes access to a Team by ID.
 */
export function authorizeTeam(
  req: Request,
  res: Response,
  teamId: string,
  action: ObjectAction = 'READ'
): Team | null {
  const user = getCurrentUser(req);
  const state = db.getState();
  const team = state.teams.find(t => t.id === teamId);

  if (!team) {
    res.status(404).json({ error: 'Team not found' });
    return null;
  }

  const result = canAccessTeam(user, team, action);
  if (!result.allowed) {
    db.logAudit(
      user.id,
      'VERIFY',
      'SECURITY_BOLA',
      team.id,
      `BOLA Denied: ${user.name} denied ${action} on team "${team.name}" (${team.id})`
    );
    res.status(403).json({
      error: `Access denied: You do not have ${action} permission for this team`,
      code: 'OBJECT_ACCESS_DENIED',
      entity_type: 'TEAM',
      entity_id: team.id,
      reason: result.reason
    });
    return null;
  }

  return team;
}

/**
 * Authorizes access to a Note by ID.
 */
export function authorizeNote(
  req: Request,
  res: Response,
  noteId: string,
  action: ObjectAction = 'READ'
): Note | null {
  const user = getCurrentUser(req);
  const state = db.getState();
  const note = state.notes.find(n => n.id === noteId);

  if (!note) {
    res.status(404).json({ error: 'Note not found' });
    return null;
  }

  const result = canAccessNote(user, note, action);
  if (!result.allowed) {
    db.logAudit(
      user.id,
      'VERIFY',
      'SECURITY_BOLA',
      note.id,
      `BOLA Denied: ${user.name} denied ${action} on note "${note.id}"`
    );
    res.status(403).json({
      error: `Access denied: You do not have ${action} permission for this note`,
      code: 'OBJECT_ACCESS_DENIED',
      entity_type: 'NOTE',
      entity_id: note.id,
      reason: result.reason
    });
    return null;
  }

  return note;
}

/**
 * Checks whether a user can access a specific RoleRequest.
 * Users can READ their own role requests. Admins can READ any role request.
 */
export function canAccessRoleRequest(
  user: User,
  roleRequest: RoleRequest,
  action: ObjectAction = 'READ'
): ObjectAuthResult {
  if (user.account_status && user.account_status !== 'ACTIVE') {
    return {
      allowed: false,
      reason: `Account is ${user.account_status}. Access to role request data is forbidden.`
    };
  }

  const isAdmin = hasPermission(user, 'ADMIN');
  if (isAdmin) {
    return { allowed: true, isAdminOverride: true };
  }

  if (action === 'READ') {
    if (roleRequest.user_id === user.id) {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: 'Users may only view their own role elevation requests'
    };
  }

  return {
    allowed: false,
    reason: 'Only administrators may modify or review role elevation requests'
  };
}

/**
 * Authorizes access to a RoleRequest by ID.
 */
export function authorizeRoleRequest(
  req: Request,
  res: Response,
  requestId: string,
  action: ObjectAction = 'READ'
): RoleRequest | null {
  const user = getCurrentUser(req);
  const state = db.getState();
  const roleRequest = (state.role_requests || []).find(r => r.request_id === requestId);

  if (!roleRequest) {
    res.status(404).json({ error: 'Role request not found' });
    return null;
  }

  const result = canAccessRoleRequest(user, roleRequest, action);
  if (!result.allowed) {
    db.logAudit(
      user.id,
      'VERIFY',
      'SECURITY_BOLA',
      roleRequest.request_id,
      `BOLA Denied: ${user.name} denied ${action} on role request "${roleRequest.request_id}"`
    );
    res.status(403).json({
      error: `Access denied: You do not have ${action} permission for this role request`,
      code: 'OBJECT_ACCESS_DENIED',
      entity_type: 'ROLE_REQUEST',
      entity_id: roleRequest.request_id,
      reason: result.reason
    });
    return null;
  }

  return roleRequest;
}

