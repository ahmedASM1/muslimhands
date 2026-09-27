import type { AuthenticatedUser } from '@mh/shared';

/** Role-scoped reports landing page (avoids pharmacy/warehouse bouncing to org overview). */
export function reportsHomePath(user: AuthenticatedUser | null | undefined): string {
  if (!user) return '/reports';
  if (user.roles.includes('SUPER_ADMIN' as AuthenticatedUser['roles'][number])) return '/reports';
  if (user.roles.some((role) => role.startsWith('WAREHOUSE'))) return '/warehouse/reports';
  if (user.roles.some((role) => role.startsWith('PHARMACY'))) return '/pharmacy/reports';
  return '/reports';
}
