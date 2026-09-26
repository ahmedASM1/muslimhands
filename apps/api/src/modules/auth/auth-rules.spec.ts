import { UserStatus } from '@prisma/client';
import { isAuthenticatable } from './auth-rules';

describe('authentication eligibility', () => {
  it('allows only active users with a password hash', () => {
    expect(isAuthenticatable({ status: UserStatus.ACTIVE, passwordHash: 'hash' })).toBe(true);
  });

  it('rejects inactive users', () => {
    expect(isAuthenticatable({ status: UserStatus.INACTIVE, passwordHash: 'hash' })).toBe(false);
  });

  it('rejects invited, suspended, and locked users', () => {
    expect(isAuthenticatable({ status: UserStatus.INVITED, passwordHash: null })).toBe(false);
    expect(isAuthenticatable({ status: UserStatus.SUSPENDED, passwordHash: 'hash' })).toBe(false);
    expect(isAuthenticatable({ status: UserStatus.LOCKED, passwordHash: 'hash' })).toBe(false);
  });
});
