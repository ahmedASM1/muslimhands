import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { RoleCode, type AuthenticatedUser } from '@mh/shared';

export function isGlobalViewer(user: AuthenticatedUser): boolean {
  return (
    user.roles.includes(RoleCode.SUPER_ADMIN) ||
    user.roles.includes(RoleCode.WAREHOUSE_MANAGER) ||
    user.roles.includes(RoleCode.WAREHOUSE_STAFF) ||
    user.roles.includes(RoleCode.REPORT_VIEWER)
  );
}

export function isSuperAdmin(user: AuthenticatedUser): boolean {
  return user.roles.includes(RoleCode.SUPER_ADMIN);
}

export function primaryRole(user: Pick<AuthenticatedUser, 'roles'>): RoleCode | null {
  return user.roles[0] ?? null;
}

export function resolvePharmacyId(user: AuthenticatedUser, requested?: string): string | undefined {
  if (isGlobalViewer(user) || isSuperAdmin(user)) {
    return requested;
  }

  if (!user.pharmacyId) {
    throw new ForbiddenException('No pharmacy assignment');
  }

  if (requested && requested !== user.pharmacyId) {
    throw new ForbiddenException('Cannot access another pharmacy');
  }

  return user.pharmacyId;
}

export function requirePharmacyId(user: AuthenticatedUser, requested?: string): string {
  const id = resolvePharmacyId(user, requested);
  if (!id) {
    throw new ForbiddenException('Pharmacy context is required');
  }
  return id;
}

export function canAccessPharmacy(user: AuthenticatedUser, pharmacyId: string): boolean {
  if (isSuperAdmin(user) || isGlobalViewer(user)) {
    return true;
  }
  return Boolean(user.pharmacyId && user.pharmacyId === pharmacyId);
}

export function assertCanMutateWarehouseStock(user: AuthenticatedUser): void {
  if (isSuperAdmin(user)) {
    return;
  }
  if (user.roles.includes(RoleCode.PHARMACY_MANAGER) || user.roles.includes(RoleCode.PHARMACY_STAFF)) {
    throw new ForbiddenException('Pharmacy users cannot modify warehouse stock');
  }
}

export function assertCanMutateDispensing(user: AuthenticatedUser): void {
  if (isSuperAdmin(user)) {
    return;
  }
  if (user.roles.includes(RoleCode.WAREHOUSE_MANAGER) || user.roles.includes(RoleCode.WAREHOUSE_STAFF)) {
    throw new ForbiddenException('Warehouse users cannot modify pharmacy dispensing');
  }
  if (
    !user.roles.includes(RoleCode.PHARMACY_MANAGER) &&
    !user.roles.includes(RoleCode.PHARMACY_STAFF)
  ) {
    throw new ForbiddenException('Only pharmacy staff can dispense medicine');
  }
}

/** Warehouse roles must not receive beneficiary personal data by default. */
export function assertCanAccessBeneficiaries(user: AuthenticatedUser): void {
  if (isSuperAdmin(user)) {
    return;
  }
  if (user.roles.includes(RoleCode.WAREHOUSE_MANAGER) || user.roles.includes(RoleCode.WAREHOUSE_STAFF)) {
    throw new ForbiddenException('Warehouse users cannot access beneficiary records');
  }
}

export function assignmentForRole(
  roleCode: RoleCode,
  pharmacyId?: string | null,
  warehouseId?: string | null,
): { pharmacyId: string | null; warehouseId: string | null } {
  if (roleCode === RoleCode.WAREHOUSE_MANAGER || roleCode === RoleCode.WAREHOUSE_STAFF) {
    if (!warehouseId) {
      throw new BadRequestException('Warehouse assignment is required for this role');
    }
    return { pharmacyId: null, warehouseId };
  }

  if (roleCode === RoleCode.PHARMACY_MANAGER || roleCode === RoleCode.PHARMACY_STAFF) {
    if (!pharmacyId) {
      throw new BadRequestException('Pharmacy assignment is required for this role');
    }
    return { pharmacyId, warehouseId: null };
  }

  return {
    pharmacyId: pharmacyId ?? null,
    warehouseId: warehouseId ?? null,
  };
}

export function expiryWarningDate(days = 90): Date {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

export function expiryStatus(
  expiryDate: Date,
  warningDays = 90,
): 'VALID' | 'EXPIRING_SOON' | 'EXPIRED' {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const expiry = new Date(expiryDate);
  expiry.setUTCHours(0, 0, 0, 0);
  if (expiry < today) {
    return 'EXPIRED';
  }
  if (expiry <= expiryWarningDate(warningDays)) {
    return 'EXPIRING_SOON';
  }
  return 'VALID';
}
