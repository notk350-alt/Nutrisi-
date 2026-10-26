/**
 * NutriBodySim — Role-Based Access Control (RBAC) & Hardened Privilege Enforcement (MVS-B2.5B.1)
 *
 * Enforces explicit, server-verified authorization policies based on verified session identity (req.user).
 *
 * Core Guarantees:
 * 1. Zero wildcard bypass: Role 'Admin' only has explicitly enumerated permissions in ROLE_DEFAULT_PERMISSIONS.
 * 2. Strict rejection of unknown, invalid, or corrupted permissions by default.
 * 3. Strict rejection of unknown, invalid, or corrupted roles by default.
 * 4. Inactive, suspended, or disabled accounts are stripped of active permissions.
 * 5. Privileged governance permission MANAGE_PRIVILEGED_ROLES is separated and NOT granted to regular Admin.
 * 6. Immune to client-supplied role, permission, or governance headers in request body/query/headers.
 * 7. Non-throwing audit trail logging of all authorization failures.
 */

import { Request, Response, NextFunction, RequestHandler } from 'express';
import { User, UserRole, Permission } from '../database/types';
import { db } from '../database/store';

/**
 * Closed set of recognized permissions in NutriBodySim.
 * Any permission outside this list is strictly rejected by default.
 */
export const VALID_PERMISSIONS: readonly Permission[] = [
  'VIEW',
  'USE',
  'CREATE',
  'CLONE',
  'EDIT',
  'DELETE',
  'SHARE',
  'PUBLISH',
  'VERIFY',
  'ADMIN',
  'MANAGE_PRIVILEGED_ROLES'
] as const;

/**
 * Closed set of recognized user roles.
 */
export const VALID_ROLES: readonly UserRole[] = [
  'RegisteredUser',
  'Student',
  'Lecturer',
  'Researcher',
  'Admin'
] as const;

/**
 * Canonical explicit default permissions per role.
 * Notice: 'Admin' has strictly enumerated operational permissions only.
 * 'MANAGE_PRIVILEGED_ROLES' is NOT granted to Admin.
 * 'RegisteredUser' is the unprivileged base role with ZERO default permissions.
 */
export const ROLE_DEFAULT_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  RegisteredUser: [],
  Student: ['VIEW', 'USE', 'CREATE', 'CLONE'],
  Lecturer: ['VIEW', 'USE', 'CREATE', 'CLONE', 'EDIT', 'SHARE', 'PUBLISH'],
  Researcher: ['VIEW', 'USE', 'CREATE', 'CLONE', 'EDIT', 'SHARE', 'PUBLISH'],
  Admin: ['VIEW', 'USE', 'CREATE', 'CLONE', 'EDIT', 'DELETE', 'SHARE', 'PUBLISH', 'VERIFY', 'ADMIN']
};

/**
 * Resolves the effective set of permissions for a user:
 * - Rejects unverified, corrupted, or unrecognized roles.
 * - Inactive or suspended accounts receive zero effective permissions.
 * - Combines explicit user permissions with role-level default permissions.
 * - Prevents client/unauthorized elevation to MANAGE_PRIVILEGED_ROLES without verified governance authority.
 */
export function getEffectivePermissions(user: User): Set<Permission> {
  if (!user || !user.role || !VALID_ROLES.includes(user.role)) {
    return new Set<Permission>();
  }
  if (user.account_status && user.account_status !== 'ACTIVE') {
    return new Set<Permission>();
  }

  const rolePerms = ROLE_DEFAULT_PERMISSIONS[user.role] || [];
  const perms = new Set<Permission>();

  for (const p of rolePerms) {
    if (VALID_PERMISSIONS.includes(p)) {
      perms.add(p);
    }
  }

  if (Array.isArray(user.permissions)) {
    for (const p of user.permissions) {
      if (VALID_PERMISSIONS.includes(p)) {
        // Privileged permission boundary:
        // MANAGE_PRIVILEGED_ROLES cannot be obtained via user.permissions
        // without verified governance authority (is_main_admin === true)
        if (p === 'MANAGE_PRIVILEGED_ROLES') {
          if (user.is_main_admin === true && user.role === 'Admin') {
            perms.add(p);
          }
        } else {
          perms.add(p);
        }
      }
    }
  }

  // Governance grant: verified active Main Administrator holding Admin role possesses MANAGE_PRIVILEGED_ROLES
  if (user.is_main_admin === true && user.role === 'Admin') {
    perms.add('MANAGE_PRIVILEGED_ROLES');
  }

  return perms;
}

/**
 * Checks whether a user has a specific permission.
 * - No wildcard bypass: Admin only holds explicit permissions.
 * - Unknown or invalid permissions return false by default.
 * - Unknown or invalid roles return false by default.
 * - Inactive/suspended accounts return false by default.
 */
export function hasPermission(user: User, permission: Permission): boolean {
  if (!user || !user.role || typeof permission !== 'string') {
    return false;
  }
  if (!VALID_PERMISSIONS.includes(permission as Permission)) {
    return false;
  }
  if (!VALID_ROLES.includes(user.role)) {
    return false;
  }
  if (user.account_status && user.account_status !== 'ACTIVE') {
    return false;
  }

  const effective = getEffectivePermissions(user);
  return effective.has(permission as Permission);
}

/**
 * Checks whether a user has all of the specified permissions.
 */
export function hasAllPermissions(user: User, permissions: Permission[]): boolean {
  if (!user || !Array.isArray(permissions) || permissions.length === 0) {
    return false;
  }
  return permissions.every(p => hasPermission(user, p));
}

/**
 * Checks whether a user has at least one of the specified permissions.
 */
export function hasAnyPermission(user: User, permissions: Permission[]): boolean {
  if (!user || !Array.isArray(permissions) || permissions.length === 0) {
    return false;
  }
  return permissions.some(p => hasPermission(user, p));
}

/**
 * Checks whether a user possesses one of the allowed roles.
 */
export function hasRole(user: User, ...allowedRoles: UserRole[]): boolean {
  if (!user || !user.role || !VALID_ROLES.includes(user.role)) {
    return false;
  }
  if (user.account_status && user.account_status !== 'ACTIVE') {
    return false;
  }
  return allowedRoles.includes(user.role);
}

/**
 * Express middleware requiring the authenticated user to possess ALL specified permissions.
 * If user lacks any required permission or is inactive, responds with HTTP 403 Forbidden.
 */
export function requirePermission(...permissions: Permission[]): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Authentication required. Missing verified user identity.',
        code: 'UNAUTHORIZED'
      });
    }

    if (req.user.account_status && req.user.account_status !== 'ACTIVE') {
      return res.status(403).json({
        error: `Account is ${req.user.account_status}. Access to this resource is forbidden.`,
        code: 'FORBIDDEN_ACCOUNT_STATUS',
        account_status: req.user.account_status
      });
    }

    const missing = permissions.filter(p => !hasPermission(req.user!, p));
    if (missing.length > 0) {
      try {
        db.logAudit(
          req.user.id,
          'LOGIN',
          'SECURITY_RBAC',
          req.path,
          `Permission denied: user ${req.user.name} (${req.user.role}) lacks permissions [${missing.join(', ')}] on ${req.method} ${req.path}`
        );
      } catch {}

      return res.status(403).json({
        error: `Forbidden: Insufficient permissions. Missing: [${missing.join(', ')}].`,
        code: 'FORBIDDEN',
        required_permissions: permissions,
        missing_permissions: missing,
        user_role: req.user.role
      });
    }

    return next();
  };
}

/**
 * Express middleware requiring the authenticated user to possess AT LEAST ONE of the specified permissions.
 */
export function requireAnyPermission(...permissions: Permission[]): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Authentication required. Missing verified user identity.',
        code: 'UNAUTHORIZED'
      });
    }

    if (req.user.account_status && req.user.account_status !== 'ACTIVE') {
      return res.status(403).json({
        error: `Account is ${req.user.account_status}. Access to this resource is forbidden.`,
        code: 'FORBIDDEN_ACCOUNT_STATUS',
        account_status: req.user.account_status
      });
    }

    if (!hasAnyPermission(req.user, permissions)) {
      try {
        db.logAudit(
          req.user.id,
          'LOGIN',
          'SECURITY_RBAC',
          req.path,
          `Permission denied: user ${req.user.name} (${req.user.role}) lacks any of permissions [${permissions.join(', ')}] on ${req.method} ${req.path}`
        );
      } catch {}

      return res.status(403).json({
        error: `Forbidden: Insufficient permissions. Requires at least one of: [${permissions.join(', ')}].`,
        code: 'FORBIDDEN',
        required_permissions: permissions,
        user_role: req.user.role
      });
    }

    return next();
  };
}

/**
 * Express middleware requiring the authenticated user to hold one of the specified roles.
 */
export function requireRole(...allowedRoles: UserRole[]): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Authentication required. Missing verified user identity.',
        code: 'UNAUTHORIZED'
      });
    }

    if (req.user.account_status && req.user.account_status !== 'ACTIVE') {
      return res.status(403).json({
        error: `Account is ${req.user.account_status}. Access to this resource is forbidden.`,
        code: 'FORBIDDEN_ACCOUNT_STATUS',
        account_status: req.user.account_status
      });
    }

    if (!hasRole(req.user, ...allowedRoles)) {
      try {
        db.logAudit(
          req.user.id,
          'LOGIN',
          'SECURITY_RBAC',
          req.path,
          `Role denied: user ${req.user.name} (${req.user.role}) is not in allowed roles [${allowedRoles.join(', ')}] on ${req.method} ${req.path}`
        );
      } catch {}

      return res.status(403).json({
        error: `Forbidden: Role "${req.user.role}" is not authorized for this resource. Required one of: [${allowedRoles.join(', ')}].`,
        code: 'FORBIDDEN',
        allowed_roles: allowedRoles,
        user_role: req.user.role
      });
    }

    return next();
  };
}

/**
 * Express middleware requiring administrative privilege (explicit ADMIN permission on active account).
 */
export function requireAdmin(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Authentication required. Missing verified user identity.',
        code: 'UNAUTHORIZED'
      });
    }

    if (req.user.account_status && req.user.account_status !== 'ACTIVE') {
      return res.status(403).json({
        error: `Account is ${req.user.account_status}. Administrative access is forbidden.`,
        code: 'FORBIDDEN_ACCOUNT_STATUS',
        account_status: req.user.account_status
      });
    }

    if (!hasPermission(req.user, 'ADMIN')) {
      try {
        db.logAudit(
          req.user.id,
          'LOGIN',
          'SECURITY_RBAC',
          req.path,
          `Admin access denied: user ${req.user.name} (${req.user.role}) attempted administrative access on ${req.method} ${req.path}`
        );
      } catch {}

      return res.status(403).json({
        error: 'Forbidden: Administrative privilege required (ADMIN permission or Admin role).',
        code: 'FORBIDDEN',
        required_permission: 'ADMIN',
        user_role: req.user.role
      });
    }

    return next();
  };
}

/**
 * Express middleware requiring privileged governance permission (MANAGE_PRIVILEGED_ROLES).
 * Strictly requires the caller to hold verified MANAGE_PRIVILEGED_ROLES permission on an active account.
 */
export function requirePrivilegedRole(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Authentication required. Missing verified user identity.',
        code: 'UNAUTHORIZED'
      });
    }

    if (req.user.account_status && req.user.account_status !== 'ACTIVE') {
      return res.status(403).json({
        error: `Account is ${req.user.account_status}. Privileged governance access is forbidden.`,
        code: 'FORBIDDEN_ACCOUNT_STATUS',
        account_status: req.user.account_status
      });
    }

    if (!hasPermission(req.user, 'MANAGE_PRIVILEGED_ROLES')) {
      try {
        db.logAudit(
          req.user.id,
          'LOGIN',
          'SECURITY_RBAC',
          req.path,
          `Privileged role access denied: user ${req.user.name} (${req.user.role}) attempted privileged governance access on ${req.method} ${req.path}`
        );
      } catch {}

      return res.status(403).json({
        error: 'Forbidden: Main Administrator privilege required (MANAGE_PRIVILEGED_ROLES).',
        code: 'FORBIDDEN_PRIVILEGED_ROLE',
        required_permission: 'MANAGE_PRIVILEGED_ROLES',
        user_role: req.user.role
      });
    }

    return next();
  };
}

