import type { AuthenticatedUser } from '@mh/shared';

export interface RequestContext {
  ipAddress?: string;
  userAgent?: string;
}

export type RequestUser = AuthenticatedUser;
