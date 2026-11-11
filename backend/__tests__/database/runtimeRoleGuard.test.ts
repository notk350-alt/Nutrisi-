import { describe, expect, it } from 'vitest';
import {
  isAuthorizedLocalPostgresTestUrl,
  validateRuntimeRoleProbe,
  type RuntimeRoleProbe
} from '../../database/runtimeRoleGuard';

const safeProbe: RuntimeRoleProbe = {
  roleName: 'nutribodysim_app',
  isSuperuser: false,
  canCreateRole: false,
  canCreateDatabase: false,
  canReplicate: false,
  canBypassRls: false,
  canCreateInPublic: false,
  isMemberOfOwner: false,
  canManagePublicObjects: false,
  canManageAuditTable: false,
  canReadAudit: true,
  canInsertAudit: true,
  canUpdateAudit: false,
  canDeleteAudit: false,
  canTruncateAudit: false,
  auditTriggers: [
    {
      name: 'audit_logs_reject_mutation',
      enabled: true,
      securityDefiner: false,
      ownedByRuntime: false,
      functionConfig: ['search_path=pg_catalog']
    },
    {
      name: 'audit_logs_reject_truncate',
      enabled: true,
      securityDefiner: false,
      ownedByRuntime: false,
      functionConfig: ['search_path=pg_catalog']
    }
  ]
};

describe('PostgreSQL runtime role guard', () => {
  it('only authorizes the dedicated loopback PostgreSQL integration-test database', () => {
    expect(isAuthorizedLocalPostgresTestUrl('postgresql://app@127.0.0.1:5432/nutribodysim_test')).toBe(true);
    expect(isAuthorizedLocalPostgresTestUrl('postgresql://app@db.example/nutribodysim_test')).toBe(false);
    expect(isAuthorizedLocalPostgresTestUrl('postgresql://app@127.0.0.1/nutribodysim')).toBe(false);
    expect(isAuthorizedLocalPostgresTestUrl('invalid')).toBe(false);
  });

  it('accepts a restricted runtime principal with protected audit triggers', () => {
    expect(validateRuntimeRoleProbe(safeProbe, 'nutribodysim_app')).toEqual([]);
  });

  it('requires an explicitly configured expected role and rejects identity mismatch', () => {
    expect(validateRuntimeRoleProbe(safeProbe, undefined)).toContain('DATABASE_RUNTIME_ROLE is required.');
    expect(validateRuntimeRoleProbe(safeProbe, 'another_role')).toContain(
      'Connected PostgreSQL role does not match DATABASE_RUNTIME_ROLE.'
    );
  });

  it.each([
    ['superuser', { isSuperuser: true }],
    ['role creation', { canCreateRole: true }],
    ['database creation', { canCreateDatabase: true }],
    ['replication', { canReplicate: true }],
    ['RLS bypass', { canBypassRls: true }],
    ['schema creation', { canCreateInPublic: true }],
    ['owner membership', { isMemberOfOwner: true }],
    ['public object ownership', { canManagePublicObjects: true }],
    ['audit table ownership', { canManageAuditTable: true }],
    ['audit update', { canUpdateAudit: true }],
    ['audit delete', { canDeleteAudit: true }],
    ['audit truncate', { canTruncateAudit: true }]
  ])('rejects elevated %s privileges', (_name, update) => {
    const probe = { ...safeProbe, ...update } as RuntimeRoleProbe;
    expect(validateRuntimeRoleProbe(probe, 'nutribodysim_app').length).toBeGreaterThan(0);
  });

  it('requires audit read and append but never grants mutation privileges', () => {
    expect(validateRuntimeRoleProbe({ ...safeProbe, canReadAudit: false }, 'nutribodysim_app')).toContain(
      'Connected PostgreSQL role lacks required audit read/append privileges.'
    );
    expect(validateRuntimeRoleProbe({ ...safeProbe, canInsertAudit: false }, 'nutribodysim_app')).toContain(
      'Connected PostgreSQL role lacks required audit read/append privileges.'
    );
  });

  it('rejects disabled, missing, security-definer, misowned, or unsafe-path triggers', () => {
    const scenarios = [
      { enabled: false },
      { securityDefiner: true },
      { ownedByRuntime: true },
      { functionConfig: ['search_path=public'] }
    ];
    for (const update of scenarios) {
      const probe = {
        ...safeProbe,
        auditTriggers: [{ ...safeProbe.auditTriggers[0], ...update }, safeProbe.auditTriggers[1]]
      };
      expect(validateRuntimeRoleProbe(probe, 'nutribodysim_app').length).toBeGreaterThan(0);
    }
    expect(validateRuntimeRoleProbe({ ...safeProbe, auditTriggers: [] }, 'nutribodysim_app')).toContain(
      'Required audit triggers are missing or duplicated.'
    );
  });
});