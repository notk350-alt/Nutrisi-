export const REQUIRED_AUDIT_TRIGGER_NAMES = [
  'audit_logs_reject_mutation',
  'audit_logs_reject_truncate'
] as const;

export function isAuthorizedLocalPostgresTestUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    const loopback = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname);
    const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ''));
    return ['postgres:', 'postgresql:'].includes(url.protocol) && loopback && databaseName === 'nutribodysim_test';
  } catch {
    return false;
  }
}

export interface RuntimeRoleProbe {
  roleName: string;
  isSuperuser: boolean;
  canCreateRole: boolean;
  canCreateDatabase: boolean;
  canReplicate: boolean;
  canBypassRls: boolean;
  canCreateInPublic: boolean;
  isMemberOfOwner: boolean;
  canManagePublicObjects: boolean;
  canManageAuditTable: boolean;
  canReadAudit: boolean;
  canInsertAudit: boolean;
  canUpdateAudit: boolean;
  canDeleteAudit: boolean;
  canTruncateAudit: boolean;
  auditTriggers: Array<{
    name: string;
    enabled: boolean;
    securityDefiner: boolean;
    ownedByRuntime: boolean;
    functionConfig: string[];
  }>;
}

export function validateRuntimeRoleProbe(
  probe: RuntimeRoleProbe,
  expectedRole: string | undefined
): string[] {
  const errors: string[] = [];
  const expected = expectedRole?.trim();

  if (!expected) errors.push('DATABASE_RUNTIME_ROLE is required.');
  else if (probe.roleName !== expected) errors.push('Connected PostgreSQL role does not match DATABASE_RUNTIME_ROLE.');

  if (
    probe.isSuperuser ||
    probe.canCreateRole ||
    probe.canCreateDatabase ||
    probe.canReplicate ||
    probe.canBypassRls
  ) {
    errors.push('Connected PostgreSQL role has elevated cluster privileges.');
  }
  if (probe.canCreateInPublic) errors.push('Connected PostgreSQL role can create objects in public.');
  if (probe.isMemberOfOwner || probe.canManagePublicObjects || probe.canManageAuditTable) {
    errors.push('Connected PostgreSQL role owns or inherits ownership of protected objects.');
  }
  if (!probe.canReadAudit || !probe.canInsertAudit) {
    errors.push('Connected PostgreSQL role lacks required audit read/append privileges.');
  }
  if (probe.canUpdateAudit || probe.canDeleteAudit || probe.canTruncateAudit) {
    errors.push('Connected PostgreSQL role can mutate audit logs.');
  }

  const triggerMap = new Map(probe.auditTriggers.map(trigger => [trigger.name, trigger]));
  if (
    probe.auditTriggers.length !== REQUIRED_AUDIT_TRIGGER_NAMES.length ||
    REQUIRED_AUDIT_TRIGGER_NAMES.some(name => !triggerMap.has(name))
  ) {
    errors.push('Required audit triggers are missing or duplicated.');
  }

  for (const name of REQUIRED_AUDIT_TRIGGER_NAMES) {
    const trigger = triggerMap.get(name);
    if (!trigger) continue;
    if (!trigger.enabled) errors.push(`Required audit trigger ${name} is disabled.`);
    if (trigger.securityDefiner) errors.push(`Audit trigger function ${name} must use SECURITY INVOKER.`);
    if (trigger.ownedByRuntime) errors.push(`Audit trigger function ${name} must not be owned by the runtime role.`);
    if (!trigger.functionConfig.includes('search_path=pg_catalog')) {
      errors.push(`Audit trigger function ${name} must pin search_path to pg_catalog.`);
    }
  }

  return errors;
}