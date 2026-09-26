import { RoleCode } from '../enums/index.js';

export function homePathForRoles(
  roles: readonly RoleCode[],
  options?: { pharmacySlug?: string | null },
): string {
  if (roles.includes(RoleCode.SUPER_ADMIN)) {
    return '/administration';
  }
  if (roles.includes(RoleCode.WAREHOUSE_MANAGER) || roles.includes(RoleCode.WAREHOUSE_STAFF)) {
    return '/warehouse';
  }
  if (roles.includes(RoleCode.PHARMACY_MANAGER) || roles.includes(RoleCode.PHARMACY_STAFF)) {
    if (options?.pharmacySlug) {
      return `/pharmacies/${options.pharmacySlug}`;
    }
    return '/pharmacy';
  }
  if (roles.includes(RoleCode.REPORT_VIEWER)) {
    return '/reports';
  }
  return '/dashboard';
}
