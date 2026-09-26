import type { AuthenticatedUser } from '@mh/shared';

export function homePath(user: AuthenticatedUser | null) {
  if (!user) return '/login';
  if (user.homePath) return user.homePath;
  if (user.roles.includes('SUPER_ADMIN' as AuthenticatedUser['roles'][number])) return '/administration';
  if (user.roles.some((role) => role.startsWith('WAREHOUSE'))) return '/warehouse';
  if (user.roles.some((role) => role.startsWith('PHARMACY'))) {
    if (user.pharmacySlug) return `/pharmacies/${user.pharmacySlug}`;
    return '/pharmacy';
  }
  return '/reports';
}

export function pharmacyLoginPath(slug: string) {
  return `/pharmacies/${slug}/login`;
}
