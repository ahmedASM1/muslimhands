import { ForbiddenException } from '@nestjs/common';
import { hasPermission, PERMISSIONS, RoleCode, type AuthenticatedUser } from '@mh/shared';
import {
  isSuperAdmin,
  resolvePharmacyId,
} from '../../common/access/access';

export function canViewWarehouseReports(user: AuthenticatedUser): boolean {
  return (
    isSuperAdmin(user) ||
    hasPermission(user.permissions, PERMISSIONS.REPORTS_WAREHOUSE) ||
    hasPermission(user.permissions, PERMISSIONS.REPORT_VIEW)
  );
}

export function canViewPharmacyReports(user: AuthenticatedUser): boolean {
  return (
    isSuperAdmin(user) ||
    hasPermission(user.permissions, PERMISSIONS.REPORTS_PHARMACY) ||
    hasPermission(user.permissions, PERMISSIONS.REPORT_VIEW)
  );
}

export function canViewDispensingReports(user: AuthenticatedUser): boolean {
  return (
    isSuperAdmin(user) ||
    hasPermission(user.permissions, PERMISSIONS.REPORTS_DISPENSING) ||
    hasPermission(user.permissions, PERMISSIONS.REPORT_VIEW) ||
    hasPermission(user.permissions, PERMISSIONS.DISPENSING_HISTORY_VIEW)
  );
}

export function canExportReports(user: AuthenticatedUser): boolean {
  return (
    isSuperAdmin(user) ||
    hasPermission(user.permissions, PERMISSIONS.REPORT_EXPORT) ||
    hasPermission(user.permissions, PERMISSIONS.REPORTS_EXPORT)
  );
}

export function canViewBeneficiaryReports(user: AuthenticatedUser): boolean {
  if (
    user.roles.includes(RoleCode.WAREHOUSE_MANAGER) ||
    user.roles.includes(RoleCode.WAREHOUSE_STAFF)
  ) {
    return false;
  }
  return (
    isSuperAdmin(user) ||
    hasPermission(user.permissions, PERMISSIONS.BENEFICIARY_VIEW) ||
    hasPermission(user.permissions, PERMISSIONS.BENEFICIARIES_READ)
  );
}

export function assertCanViewBeneficiaryReports(user: AuthenticatedUser): void {
  if (!canViewBeneficiaryReports(user)) {
    throw new ForbiddenException('Not permitted to view beneficiary reports');
  }
}

export function assertCanExport(user: AuthenticatedUser): void {
  if (!canExportReports(user)) {
    throw new ForbiddenException('Not permitted to export reports');
  }
}

/** Enforce pharmacy scoping — never trust client pharmacyId for pharmacy-assigned users. */
export function scopedPharmacyId(
  user: AuthenticatedUser,
  requested?: string,
): string | undefined {
  return resolvePharmacyId(user, requested);
}

export function scopedWarehouseId(
  user: AuthenticatedUser,
  requested?: string,
): string | undefined {
  if (isSuperAdmin(user) || user.roles.includes(RoleCode.REPORT_VIEWER)) {
    return requested;
  }
  if (
    user.roles.includes(RoleCode.WAREHOUSE_MANAGER) ||
    user.roles.includes(RoleCode.WAREHOUSE_STAFF)
  ) {
    if (requested && user.warehouseId && requested !== user.warehouseId) {
      throw new ForbiddenException('Cannot access another warehouse');
    }
    return requested ?? user.warehouseId ?? undefined;
  }
  return requested;
}

export function includeBeneficiaryPii(user: AuthenticatedUser): boolean {
  return canViewBeneficiaryReports(user);
}
