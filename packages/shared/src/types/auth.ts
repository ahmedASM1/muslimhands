import type { PermissionCode } from '../constants/permissions.js';
import type { RoleCode } from '../enums/index.js';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface OrganizationSummary {
  id: string;
  name: string;
  code: string;
}

export interface AssignmentSummary {
  id: string;
  name: string;
  code: string;
}

export interface PharmacyAssignmentSummary extends AssignmentSummary {
  slug: string;
}

export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string | null;
  role: RoleCode | null;
  roles: RoleCode[];
  permissions: PermissionCode[];
  homePath: string;
  organizationId: string | null;
  pharmacyId: string | null;
  warehouseId: string | null;
  pharmacySlug: string | null;
  organization: OrganizationSummary | null;
  warehouse: AssignmentSummary | null;
  pharmacy: PharmacyAssignmentSummary | null;
}

export interface AuthSession {
  user: AuthenticatedUser;
  tokens: AuthTokens;
}
