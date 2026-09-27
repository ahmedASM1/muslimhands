import type { LucideIcon } from 'lucide-react';
import {
  ArrowRightLeft,
  BarChart3,
  Bell,
  Boxes,
  Building2,
  ClipboardList,
  FileClock,
  History,
  LayoutDashboard,
  Package,
  PackageCheck,
  PackagePlus,
  Pill,
  Ruler,
  Settings,
  ShieldCheck,
  Tags,
  User,
  Users,
  UsersRound,
  Bandage,
} from 'lucide-react';
import type { AuthenticatedUser } from '@mh/shared';
import { hasPermission } from '@/lib/permissions';

const PERMISSIONS = {
  PHARMACIES_READ: 'pharmacies:read',
  WAREHOUSE_STOCK_READ: 'warehouse-stock:read',
  MEDICINES_READ: 'medicines:read',
  CATEGORIES_READ: 'categories:read',
  UNITS_READ: 'units:read',
  BATCHES_READ: 'batches:read',
  RECEIPTS_READ: 'receipts:read',
  SUPPLY_REQUESTS_READ: 'supply-requests:read',
  TRANSFERS_READ: 'transfers:read',
  DISPENSING_READ: 'dispensing:read',
  STOCK_MOVEMENTS_READ: 'stock-movements:read',
  BENEFICIARIES_READ: 'beneficiaries:read',
  REPORTS_WAREHOUSE: 'reports:warehouse',
  REPORTS_PHARMACY: 'reports:pharmacy',
  REPORT_VIEW: 'report:view',
  NOTIFICATIONS_READ: 'notifications:read',
  USERS_READ: 'users:read',
  ROLES_READ: 'roles:read',
  SETTINGS_READ: 'settings:read',
  AUDIT_LOGS_READ: 'audit-logs:read',
  DASHBOARD_VIEW: 'dashboard:view',
  WAREHOUSES_READ: 'warehouses:read',
} as const;

export interface NavItem {
  href: string;
  /** i18n key under nav.* */
  labelKey: string;
  permission?: string;
}

export interface NavSection {
  /** i18n key under nav.sections.* */
  titleKey: string;
  items: NavItem[];
}

const ICON_BY_HREF: Record<string, LucideIcon> = {
  '/administration': LayoutDashboard,
  '/warehouse': LayoutDashboard,
  '/pharmacy': LayoutDashboard,
  '/dashboard': LayoutDashboard,
  '/warehouse/stock': Boxes,
  '/pharmacy/stock': Boxes,
  '/warehouse/receipts': PackagePlus,
  '/warehouse/movements': History,
  '/warehouse/supply-requests': ClipboardList,
  '/pharmacy/supply-requests': ClipboardList,
  '/warehouse/transfers': ArrowRightLeft,
  '/pharmacy/transfers': ArrowRightLeft,
  '/pharmacy/dispensing': PackageCheck,
  '/pharmacy/dispensing-history': History,
  '/pharmacy/beneficiaries': UsersRound,
  '/reports': BarChart3,
  '/warehouse/reports': BarChart3,
  '/pharmacy/reports': BarChart3,
  '/notifications': Bell,
  '/administration/pharmacies': Building2,
  '/administration/warehouses': Boxes,
  '/administration/users': Users,
  '/administration/roles': ShieldCheck,
  '/administration/audit-logs': FileClock,
  '/administration/settings': Settings,
  '/settings': Settings,
  '/profile': User,
  '/inventory/medicines': Pill,
  '/inventory/medical-supplies': Bandage,
  '/inventory/categories': Tags,
  '/inventory/units': Ruler,
  '/inventory/batches': Package,
};

export function navIconFor(href: string): LucideIcon {
  return ICON_BY_HREF[href] ?? LayoutDashboard;
}

function adminNav(): NavSection[] {
  return [
    {
      titleKey: 'nav.sections.main',
      items: [{ href: '/administration', labelKey: 'nav.dashboard', permission: PERMISSIONS.DASHBOARD_VIEW }],
    },
    {
      titleKey: 'nav.sections.inventory',
      items: [
        { href: '/warehouse/stock', labelKey: 'nav.stock', permission: PERMISSIONS.WAREHOUSE_STOCK_READ },
        { href: '/warehouse/receipts', labelKey: 'nav.receipts', permission: PERMISSIONS.RECEIPTS_READ },
        { href: '/warehouse/movements', labelKey: 'nav.stockMovements', permission: PERMISSIONS.STOCK_MOVEMENTS_READ },
        { href: '/inventory/medicines', labelKey: 'nav.medicines', permission: PERMISSIONS.MEDICINES_READ },
        { href: '/inventory/medical-supplies', labelKey: 'nav.medicalSupplies', permission: PERMISSIONS.MEDICINES_READ },
        { href: '/inventory/batches', labelKey: 'nav.batches', permission: PERMISSIONS.BATCHES_READ },
        { href: '/inventory/categories', labelKey: 'nav.categories', permission: PERMISSIONS.CATEGORIES_READ },
        { href: '/inventory/units', labelKey: 'nav.units', permission: PERMISSIONS.UNITS_READ },
      ],
    },
    {
      titleKey: 'nav.sections.operations',
      items: [
        { href: '/warehouse/supply-requests', labelKey: 'nav.supplyRequests', permission: PERMISSIONS.SUPPLY_REQUESTS_READ },
        { href: '/warehouse/transfers', labelKey: 'nav.transfers', permission: PERMISSIONS.TRANSFERS_READ },
      ],
    },
    {
      titleKey: 'nav.sections.pharmacy',
      items: [
        { href: '/pharmacy/dispensing', labelKey: 'nav.dispensing', permission: PERMISSIONS.DISPENSING_READ },
        { href: '/pharmacy/beneficiaries', labelKey: 'nav.beneficiaries', permission: PERMISSIONS.BENEFICIARIES_READ },
      ],
    },
    {
      titleKey: 'nav.sections.reporting',
      items: [
        { href: '/reports', labelKey: 'nav.reports', permission: PERMISSIONS.REPORT_VIEW },
        { href: '/notifications', labelKey: 'nav.notifications', permission: PERMISSIONS.NOTIFICATIONS_READ },
      ],
    },
    {
      titleKey: 'nav.sections.administration',
      items: [
        { href: '/administration/pharmacies', labelKey: 'nav.pharmacies', permission: PERMISSIONS.PHARMACIES_READ },
        { href: '/administration/warehouses', labelKey: 'nav.warehouses', permission: PERMISSIONS.WAREHOUSES_READ },
        { href: '/administration/users', labelKey: 'nav.users', permission: PERMISSIONS.USERS_READ },
        { href: '/administration/roles', labelKey: 'nav.roles', permission: PERMISSIONS.ROLES_READ },
        { href: '/administration/audit-logs', labelKey: 'nav.auditLogs', permission: PERMISSIONS.AUDIT_LOGS_READ },
        { href: '/settings', labelKey: 'nav.settings', permission: PERMISSIONS.SETTINGS_READ },
        { href: '/profile', labelKey: 'nav.profile' },
      ],
    },
  ];
}

function warehouseNav(): NavSection[] {
  return [
    {
      titleKey: 'nav.sections.main',
      items: [{ href: '/warehouse', labelKey: 'nav.dashboard', permission: PERMISSIONS.DASHBOARD_VIEW }],
    },
    {
      titleKey: 'nav.sections.inventory',
      items: [
        { href: '/warehouse/stock', labelKey: 'nav.stock', permission: PERMISSIONS.WAREHOUSE_STOCK_READ },
        { href: '/warehouse/receipts', labelKey: 'nav.receipts', permission: PERMISSIONS.RECEIPTS_READ },
        { href: '/warehouse/movements', labelKey: 'nav.stockMovements', permission: PERMISSIONS.STOCK_MOVEMENTS_READ },
        { href: '/inventory/medicines', labelKey: 'nav.medicines', permission: PERMISSIONS.MEDICINES_READ },
        { href: '/inventory/medical-supplies', labelKey: 'nav.medicalSupplies', permission: PERMISSIONS.MEDICINES_READ },
        { href: '/inventory/batches', labelKey: 'nav.batches', permission: PERMISSIONS.BATCHES_READ },
      ],
    },
    {
      titleKey: 'nav.sections.operations',
      items: [
        { href: '/warehouse/supply-requests', labelKey: 'nav.supplyRequests', permission: PERMISSIONS.SUPPLY_REQUESTS_READ },
        { href: '/warehouse/transfers', labelKey: 'nav.transfers', permission: PERMISSIONS.TRANSFERS_READ },
      ],
    },
    {
      titleKey: 'nav.sections.reporting',
      items: [
        { href: '/warehouse/reports', labelKey: 'nav.reports', permission: PERMISSIONS.REPORTS_WAREHOUSE },
        { href: '/notifications', labelKey: 'nav.notifications', permission: PERMISSIONS.NOTIFICATIONS_READ },
        { href: '/settings', labelKey: 'nav.settings' },
        { href: '/profile', labelKey: 'nav.profile' },
      ],
    },
  ];
}

function pharmacyNav(): NavSection[] {
  return [
    {
      titleKey: 'nav.sections.main',
      items: [{ href: '/pharmacy', labelKey: 'nav.dashboard', permission: PERMISSIONS.DASHBOARD_VIEW }],
    },
    {
      titleKey: 'nav.sections.inventory',
      items: [
        { href: '/pharmacy/stock', labelKey: 'nav.stock', permission: PERMISSIONS.PHARMACIES_READ },
        { href: '/pharmacy/supply-requests', labelKey: 'nav.supplyRequests', permission: PERMISSIONS.SUPPLY_REQUESTS_READ },
        { href: '/pharmacy/transfers', labelKey: 'nav.transfers', permission: PERMISSIONS.TRANSFERS_READ },
      ],
    },
    {
      titleKey: 'nav.sections.pharmacy',
      items: [
        { href: '/pharmacy/dispensing', labelKey: 'nav.dispensing', permission: PERMISSIONS.DISPENSING_READ },
        { href: '/pharmacy/dispensing-history', labelKey: 'nav.history', permission: PERMISSIONS.DISPENSING_READ },
        { href: '/pharmacy/beneficiaries', labelKey: 'nav.beneficiaries', permission: PERMISSIONS.BENEFICIARIES_READ },
      ],
    },
    {
      titleKey: 'nav.sections.reporting',
      items: [
        { href: '/pharmacy/reports', labelKey: 'nav.reports', permission: PERMISSIONS.REPORTS_PHARMACY },
        { href: '/notifications', labelKey: 'nav.notifications', permission: PERMISSIONS.NOTIFICATIONS_READ },
        { href: '/settings', labelKey: 'nav.settings' },
        { href: '/profile', labelKey: 'nav.profile' },
      ],
    },
  ];
}

function reportNav(): NavSection[] {
  return [
    {
      titleKey: 'nav.sections.main',
      items: [
        { href: '/dashboard', labelKey: 'nav.dashboard', permission: PERMISSIONS.DASHBOARD_VIEW },
        { href: '/reports', labelKey: 'nav.reports', permission: PERMISSIONS.REPORT_VIEW },
        { href: '/notifications', labelKey: 'nav.notifications', permission: PERMISSIONS.NOTIFICATIONS_READ },
        { href: '/settings', labelKey: 'nav.settings' },
        { href: '/profile', labelKey: 'nav.profile' },
      ],
    },
  ];
}

export function navigationFor(user: AuthenticatedUser | null): NavSection[] {
  if (!user) return [];
  if (user.roles.includes('SUPER_ADMIN' as AuthenticatedUser['roles'][number])) return adminNav();
  if (user.roles.some((role) => role.startsWith('WAREHOUSE'))) return warehouseNav();
  if (user.roles.some((role) => role.startsWith('PHARMACY'))) return pharmacyNav();
  return reportNav();
}

export function filterNav(sections: NavSection[], user: AuthenticatedUser | null) {
  return sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => !item.permission || hasPermission(user, item.permission)),
    }))
    .filter((section) => section.items.length > 0);
}

export function isNavItemActive(pathname: string, href: string) {
  if (pathname === href) return true;
  if (href === '/administration' || href === '/warehouse' || href === '/pharmacy' || href === '/dashboard') {
    return false;
  }
  return pathname.startsWith(`${href}/`);
}
