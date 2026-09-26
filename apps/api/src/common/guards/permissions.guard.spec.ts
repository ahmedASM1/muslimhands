import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS, RoleCode, type AuthenticatedUser } from '@mh/shared';
import { PermissionsGuard } from './permissions.guard';

describe('PermissionsGuard', () => {
  const reflector = {
    getAllAndOverride: jest.fn(),
  } as unknown as Reflector;
  const guard = new PermissionsGuard(reflector);

  const user: AuthenticatedUser = {
    id: '1',
    name: 'Ahmed',
    email: 'ahmed@localhost.local',
    firstName: 'Ahmed',
    lastName: 'Al-Amal',
    role: RoleCode.PHARMACY_STAFF,
    roles: [RoleCode.PHARMACY_STAFF],
    permissions: [PERMISSIONS.PHARMACY_STOCK_READ, PERMISSIONS.DISPENSING_CREATE],
    homePath: '/pharmacy',
    organizationId: 'org',
    pharmacyId: 'pha-001',
    warehouseId: null,
    pharmacySlug: 'al-amal',
    organization: { id: 'org', name: 'ORG', code: 'ORG-001' },
    warehouse: null,
    pharmacy: { id: 'pha-001', name: 'Al-Amal', code: 'PHA-001', slug: 'al-amal' },
  };

  function context() {
    return {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    } as never;
  }

  it('returns 403 when a required permission is missing', () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue([PERMISSIONS.WAREHOUSE_STOCK_MANAGE]);
    expect(() => guard.canActivate(context())).toThrow(ForbiddenException);
  });

  it('allows a request when the user has the required permission', () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue([PERMISSIONS.DISPENSING_CREATE]);
    expect(guard.canActivate(context())).toBe(true);
  });

  it('allows equivalent permission aliases', () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue([PERMISSIONS.PHARMACY_STOCK_VIEW]);
    expect(guard.canActivate(context())).toBe(true);
  });
});
