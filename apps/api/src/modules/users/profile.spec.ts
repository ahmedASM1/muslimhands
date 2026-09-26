import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { AuditAction, ROLE_DEFINITIONS, RoleCode, type AuthenticatedUser } from '@mh/shared';
import { UsersService } from './users.service';
import { AuthService } from '../auth/auth.service';

function permissionsFor(role: RoleCode) {
  return ROLE_DEFINITIONS.find((item) => item.code === role)!.permissions;
}

function authUser(role: RoleCode, overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id: 'user-1',
    name: 'Test User',
    email: 'test@localhost.local',
    firstName: 'Test',
    lastName: 'User',
    phone: null,
    role,
    roles: [role],
    permissions: [...permissionsFor(role)],
    homePath: '/',
    organizationId: 'org-1',
    pharmacyId: role.startsWith('PHARMACY') ? 'ph-1' : null,
    warehouseId: role.startsWith('WAREHOUSE') ? 'wh-1' : null,
    pharmacySlug: null,
    organization: null,
    warehouse: null,
    pharmacy: null,
    ...overrides,
  };
}

describe('UsersService profile (me)', () => {
  const prisma = {
    user: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    notificationPreference: {
      upsert: jest.fn(),
    },
  };
  const passwords = { hash: jest.fn(), verify: jest.fn() };
  const service = new UsersService(prisma as never, passwords as never);

  beforeEach(() => jest.clearAllMocks());

  it('returns the authenticated user profile', async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: 'user-1',
      email: 'staff@localhost.local',
      firstName: 'Ahmed',
      lastName: 'Saleh',
      phone: '700',
      status: 'ACTIVE',
      organizationId: 'org-1',
      pharmacyId: 'ph-1',
      warehouseId: null,
      lastLoginAt: null,
      createdAt: new Date(),
      organization: { id: 'org-1', name: 'Org', code: 'ORG' },
      pharmacy: { id: 'ph-1', name: 'Al-Noor', code: 'PHA-002', slug: 'al-noor' },
      warehouse: null,
      userRoles: [{ role: { code: 'PHARMACY_STAFF', name: 'Pharmacy Staff' } }],
    });

    const result = await service.getMe('user-1');
    expect(result.firstName).toBe('Ahmed');
    expect(result.phone).toBe('700');
    expect(result.email).toBe('staff@localhost.local');
  });

  it('updates only allowed profile fields', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'user-1', deletedAt: null });
    prisma.user.update.mockResolvedValue({
      id: 'user-1',
      email: 'staff@localhost.local',
      firstName: 'New',
      lastName: 'Name',
      phone: '711',
      status: 'ACTIVE',
      organizationId: 'org-1',
      pharmacyId: 'ph-1',
      warehouseId: null,
      lastLoginAt: null,
      createdAt: new Date(),
      organization: null,
      pharmacy: null,
      warehouse: null,
      userRoles: [{ role: { code: 'PHARMACY_STAFF', name: 'Staff' } }],
    });

    const result = await service.updateMe('user-1', {
      firstName: 'New',
      lastName: 'Name',
      phone: '711',
    });
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          firstName: 'New',
          lastName: 'Name',
          phone: '711',
        }),
      }),
    );
    expect(result.firstName).toBe('New');
  });

  it('upserts notification preferences without affecting security emails', async () => {
    prisma.notificationPreference.upsert.mockResolvedValue({
      emailEnabled: false,
      inAppEnabled: true,
    });
    const prefs = await service.updateNotificationPreferences('user-1', { emailEnabled: false });
    expect(prefs.emailEnabled).toBe(false);
    expect(prefs.securityEmailsAlwaysOn).toBe(true);
  });
});

describe('AuthService.changePassword', () => {
  const prisma = {
    user: { findFirst: jest.fn(), update: jest.fn() },
    refreshToken: { updateMany: jest.fn(), create: jest.fn() },
    $transaction: jest.fn(async (ops: unknown) => ops),
  };
  const passwords = {
    hash: jest.fn(async () => 'hashed-new'),
    verify: jest.fn(),
  };
  const jwt = { signAsync: jest.fn() };
  const audit = { record: jest.fn() };
  const config = {
    get: jest.fn((key: string) => {
      if (key === 'jwt.accessSecret') return 'secret';
      if (key === 'jwt.accessExpiresIn') return '15m';
      if (key === 'jwt.issuer') return 'mh';
      if (key === 'jwt.audience') return 'mh';
      if (key === 'jwt.refreshExpiresInDays') return 7;
      if (key === 'nodeEnv') return 'test';
      if (key === 'appUrl') return 'http://localhost:3010';
      return undefined;
    }),
  };
  const mailer = { sendPasswordResetEmail: jest.fn() };
  const users = {} as UsersService;
  const service = new AuthService(
    users as never,
    passwords as never,
    jwt as never,
    prisma as never,
    audit as never,
    config as never,
    mailer as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(async (ops: unknown) => {
      if (Array.isArray(ops)) return Promise.all(ops);
      return ops;
    });
    prisma.user.update.mockResolvedValue({});
    prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });
  });

  it('changes password when current password is valid and revokes sessions', async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: 'user-1',
      passwordHash: 'old-hash',
      deletedAt: null,
      status: 'ACTIVE',
    });
    passwords.verify.mockResolvedValue(true);

    const result = await service.changePassword('user-1', 'OldPass123', 'NewPass123', {
      ipAddress: '127.0.0.1',
      userAgent: 'test',
    });

    expect(result.requireReLogin).toBe(true);
    expect(passwords.hash).toHaveBeenCalledWith('NewPass123');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: AuditAction.CHANGE_PASSWORD }),
    );
    expect(prisma.refreshToken.updateMany).toHaveBeenCalled();
  });

  it('rejects incorrect current password', async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: 'user-1',
      passwordHash: 'old-hash',
      deletedAt: null,
      status: 'ACTIVE',
    });
    passwords.verify.mockResolvedValue(false);

    await expect(
      service.changePassword('user-1', 'wrong', 'NewPass123', {
        ipAddress: undefined,
        userAgent: undefined,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects identical new password', async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: 'user-1',
      passwordHash: 'old-hash',
      deletedAt: null,
      status: 'ACTIVE',
    });
    passwords.verify.mockResolvedValue(true);

    await expect(
      service.changePassword('user-1', 'SamePass1', 'SamePass1', {
        ipAddress: undefined,
        userAgent: undefined,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('profile authorization surface', () => {
  it('does not require users:update for self profile endpoints', () => {
    const staff = authUser(RoleCode.PHARMACY_STAFF);
    expect(staff.permissions.includes('users:update' as never)).toBe(false);
  });
});
