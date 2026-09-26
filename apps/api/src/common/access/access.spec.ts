import { ForbiddenException } from '@nestjs/common';
import { PERMISSIONS, RoleCode, type AuthenticatedUser } from '@mh/shared';
import {
  assertCanAccessBeneficiaries,
  assertCanMutateDispensing,
  assertCanMutateWarehouseStock,
  canAccessPharmacy,
  resolvePharmacyId,
} from './access';

function user(partial: Partial<AuthenticatedUser> & { roles: AuthenticatedUser['roles'] }): AuthenticatedUser {
  return {
    id: 'user-1',
    name: 'Test User',
    email: 'test@localhost.local',
    firstName: 'Test',
    lastName: 'User',
    role: partial.roles[0] ?? null,
    permissions: [],
    homePath: '/dashboard',
    organizationId: 'org-1',
    pharmacyId: null,
    warehouseId: null,
    pharmacySlug: null,
    organization: { id: 'org-1', name: 'ORG', code: 'ORG-001' },
    warehouse: null,
    pharmacy: null,
    ...partial,
  };
}

describe('resource-level pharmacy access', () => {
  const amal = 'pha-001';
  const noor = 'pha-002';

  it('allows pharmacy staff to access their assigned pharmacy', () => {
    const staff = user({
      roles: [RoleCode.PHARMACY_STAFF],
      pharmacyId: amal,
      permissions: [PERMISSIONS.PHARMACY_STOCK_READ],
    });
    expect(resolvePharmacyId(staff, amal)).toBe(amal);
    expect(canAccessPharmacy(staff, amal)).toBe(true);
  });

  it('denies pharmacy staff access to another pharmacy', () => {
    const staff = user({
      roles: [RoleCode.PHARMACY_STAFF],
      pharmacyId: amal,
    });
    expect(canAccessPharmacy(staff, noor)).toBe(false);
    expect(() => resolvePharmacyId(staff, noor)).toThrow(ForbiddenException);
  });

  it('allows pharmacy manager only for the assigned pharmacy', () => {
    const manager = user({
      roles: [RoleCode.PHARMACY_MANAGER],
      pharmacyId: amal,
    });
    expect(resolvePharmacyId(manager, amal)).toBe(amal);
    expect(() => resolvePharmacyId(manager, noor)).toThrow(ForbiddenException);
  });

  it('allows warehouse manager to view any requested pharmacy', () => {
    const manager = user({
      roles: [RoleCode.WAREHOUSE_MANAGER],
      warehouseId: 'wh-central',
    });
    expect(resolvePharmacyId(manager, noor)).toBe(noor);
    expect(canAccessPharmacy(manager, noor)).toBe(true);
  });

  it('allows SUPER_ADMIN to access every pharmacy', () => {
    const admin = user({ roles: [RoleCode.SUPER_ADMIN] });
    expect(resolvePharmacyId(admin, noor)).toBe(noor);
    expect(canAccessPharmacy(admin, amal)).toBe(true);
  });
});

describe('cross-department mutations', () => {
  it('blocks pharmacy staff from warehouse stock mutations', () => {
    const staff = user({ roles: [RoleCode.PHARMACY_STAFF], pharmacyId: 'pha-001' });
    expect(() => assertCanMutateWarehouseStock(staff)).toThrow(ForbiddenException);
  });

  it('blocks warehouse staff from pharmacy dispensing mutations', () => {
    const staff = user({ roles: [RoleCode.WAREHOUSE_STAFF], warehouseId: 'wh-central' });
    expect(() => assertCanMutateDispensing(staff)).toThrow(ForbiddenException);
  });

  it('blocks warehouse staff from beneficiary personal data', () => {
    const staff = user({ roles: [RoleCode.WAREHOUSE_MANAGER], warehouseId: 'wh-central' });
    expect(() => assertCanAccessBeneficiaries(staff)).toThrow(ForbiddenException);
  });

  it('allows warehouse staff to mutate warehouse stock', () => {
    const staff = user({ roles: [RoleCode.WAREHOUSE_STAFF], warehouseId: 'wh-central' });
    expect(() => assertCanMutateWarehouseStock(staff)).not.toThrow();
  });
});
