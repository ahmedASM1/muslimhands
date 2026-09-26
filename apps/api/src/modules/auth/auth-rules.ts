import { UserStatus } from '@prisma/client';

export function isAuthenticatable(user: {
  status: string;
  passwordHash?: string | null;
  deletedAt?: Date | null;
}): boolean {
  return user.status === UserStatus.ACTIVE && Boolean(user.passwordHash) && !user.deletedAt;
}
