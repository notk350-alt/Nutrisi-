/**
 * NutriBodySim — Role Request Validation & Hierarchy Logic (MVS-B2.5A)
 *
 * Implements strict input validation, normalization, string sanitization,
 * duplicate check, and role hierarchy boundary enforcement for role elevation requests.
 */

import { UserRole, RequestedRole, AccountStatus, RoleRequest } from '../database/types';

export const ROLE_HIERARCHY: Record<UserRole, number> = {
  RegisteredUser: 0,
  Student: 1,
  Lecturer: 2,
  Researcher: 2,
  Admin: 3
};

const VALID_ROLE_MAP: Record<string, RequestedRole> = {
  STUDENT: 'Student',
  LECTURER: 'Lecturer',
  RESEARCHER: 'Researcher',
  ADMIN: 'Admin'
};

/**
 * Validates and normalizes user-submitted requested_role string.
 */
export function validateRequestedRole(input: unknown): {
  valid: boolean;
  role?: RequestedRole;
  error?: string;
} {
  if (typeof input !== 'string' || !input.trim()) {
    return {
      valid: false,
      error: 'requested_role is required and must be a non-empty string.'
    };
  }

  const normalized = input.trim().toUpperCase();
  const canonicalRole = VALID_ROLE_MAP[normalized];

  if (!canonicalRole) {
    return {
      valid: false,
      error: `Invalid requested_role '${input}'. Allowed roles: Student, Lecturer, Researcher, Admin.`
    };
  }

  return {
    valid: true,
    role: canonicalRole
  };
}

/**
 * Checks whether the user can request the target role relative to their current role.
 * - Rejects requesting the current role.
 * - Rejects requesting a strictly lower role.
 * - Rejects requests from Admins (highest rank).
 */
export function checkRoleEligibility(
  currentRole: UserRole,
  targetRole: RequestedRole,
  justification?: string
): { allowed: boolean; error?: string } {
  if (currentRole === targetRole) {
    return {
      allowed: false,
      error: `User already holds the requested role: ${targetRole}`
    };
  }

  if (currentRole === 'Admin') {
    return {
      allowed: false,
      error: 'Administrator accounts already hold the highest authority and cannot submit elevation requests.'
    };
  }

  const currentRank = ROLE_HIERARCHY[currentRole];
  if (currentRank === undefined) {
    return {
      allowed: false,
      error: `User possesses an unrecognized or corrupted role: '${currentRole}'. Promotion request denied.`
    };
  }
  const targetRank = ROLE_HIERARCHY[targetRole] ?? 0;

  if (targetRank < currentRank) {
    return {
      allowed: false,
      error: `Cannot request a role (${targetRole}) lower than current role (${currentRole}).`
    };
  }

  // Lateral transfer between peer academic roles (e.g. Lecturer <-> Researcher) requires justification
  if (targetRank === currentRank && (!justification || justification.trim().length === 0)) {
    return {
      allowed: false,
      error: `Lateral role change from ${currentRole} to ${targetRole} requires an explicit justification.`
    };
  }

  return { allowed: true };
}

/**
 * Sanitizes and validates an optional string field (e.g. institution, justification).
 * Strips HTML tags and unprintable control characters to prevent injection.
 */
export function sanitizeTextField(
  input: unknown,
  maxLength: number,
  fieldName: string
): { valid: boolean; sanitized?: string; error?: string } {
  if (input === undefined || input === null) {
    return { valid: true, sanitized: undefined };
  }

  if (typeof input !== 'string') {
    return {
      valid: false,
      error: `${fieldName} must be a string.`
    };
  }

  const trimmed = input.trim();
  if (trimmed === '') {
    return { valid: true, sanitized: undefined };
  }

  if (trimmed.length > maxLength) {
    return {
      valid: false,
      error: `${fieldName} exceeds maximum length of ${maxLength} characters.`
    };
  }

  // Strip HTML / script tags and control characters
  const sanitized = trimmed
    .replace(/<[^>]*>/g, '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .trim();

  return {
    valid: true,
    sanitized: sanitized.length > 0 ? sanitized : undefined
  };
}

/**
 * Checks whether user already has an active PENDING request for the target role.
 */
export function hasDuplicatePendingRequest(
  requests: RoleRequest[],
  userId: string,
  targetRole: RequestedRole
): RoleRequest | undefined {
  return requests.find(
    r => r.user_id === userId && r.approval_status === 'PENDING' && r.requested_role === targetRole
  );
}
