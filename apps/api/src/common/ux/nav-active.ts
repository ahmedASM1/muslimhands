/** Mirrors web isNavItemActive for regression coverage. */
export function isNavItemActive(pathname: string, href: string) {
  if (pathname === href) return true;
  if (
    href === '/administration' ||
    href === '/warehouse' ||
    href === '/pharmacy' ||
    href === '/dashboard'
  ) {
    return false;
  }
  return pathname.startsWith(`${href}/`);
}
