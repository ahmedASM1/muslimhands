import { hasPermission, PERMISSIONS, ROLE_DEFINITIONS, RoleCode } from '@mh/shared';

function permissionsFor(role: RoleCode) {
  const definition = ROLE_DEFINITIONS.find((item) => item.code === role);
  if (!definition) {
    throw new Error(`Missing role ${role}`);
  }
  return definition.permissions;
}

describe('authorization matrix', () => {
  it('gives SUPER_ADMIN every permission', () => {
    const permissions = permissionsFor(RoleCode.SUPER_ADMIN);
    expect(hasPermission(permissions, PERMISSIONS.USERS_READ)).toBe(true);
    expect(hasPermission(permissions, PERMISSIONS.WAREHOUSE_STOCK_MANAGE)).toBe(true);
    expect(hasPermission(permissions, PERMISSIONS.DISPENSING_CREATE)).toBe(true);
    expect(hasPermission(permissions, PERMISSIONS.ROLE_MANAGE)).toBe(true);
  });

  it('allows warehouse manager warehouse operations and pharmacy visibility', () => {
    const permissions = permissionsFor(RoleCode.WAREHOUSE_MANAGER);
    expect(hasPermission(permissions, PERMISSIONS.WAREHOUSE_STOCK_VIEW)).toBe(true);
    expect(hasPermission(permissions, PERMISSIONS.RECEIPT_POST)).toBe(true);
    expect(hasPermission(permissions, PERMISSIONS.PHARMACY_VIEW)).toBe(true);
    expect(hasPermission(permissions, PERMISSIONS.REPORT_VIEW)).toBe(true);
    expect(hasPermission(permissions, PERMISSIONS.DISPENSING_CREATE)).toBe(false);
  });

  it('prevents pharmacy staff from mutating warehouse stock', () => {
    const permissions = permissionsFor(RoleCode.PHARMACY_STAFF);
    expect(hasPermission(permissions, PERMISSIONS.DISPENSING_CREATE)).toBe(true);
    expect(hasPermission(permissions, PERMISSIONS.WAREHOUSE_STOCK_MANAGE)).toBe(false);
    expect(hasPermission(permissions, PERMISSIONS.RECEIPTS_POST)).toBe(false);
    expect(hasPermission(permissions, PERMISSIONS.WAREHOUSE_STOCK_READ)).toBe(false);
  });

  it('prevents warehouse staff from modifying pharmacy dispensing', () => {
    const permissions = permissionsFor(RoleCode.WAREHOUSE_STAFF);
    expect(hasPermission(permissions, PERMISSIONS.RECEIPTS_POST)).toBe(true);
    expect(hasPermission(permissions, PERMISSIONS.DISPENSING_CREATE)).toBe(false);
    expect(hasPermission(permissions, PERMISSIONS.DISPENSING_CANCEL)).toBe(false);
  });

  it('gives report viewer dashboard and report access', () => {
    const permissions = permissionsFor(RoleCode.REPORT_VIEWER);
    expect(hasPermission(permissions, PERMISSIONS.DASHBOARD_VIEW)).toBe(true);
    expect(hasPermission(permissions, PERMISSIONS.REPORT_VIEW)).toBe(true);
    expect(hasPermission(permissions, PERMISSIONS.REPORT_EXPORT)).toBe(true);
    expect(hasPermission(permissions, PERMISSIONS.USER_CREATE)).toBe(false);
  });
});
