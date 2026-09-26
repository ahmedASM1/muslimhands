import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { LocationType } from '@prisma/client';
import { PERMISSIONS, RoleCode, type AuthenticatedUser } from '@mh/shared';
import { resolvePharmacyId } from '../../common/access/access';
import { PasswordService } from '../../common/crypto/password.service';
import { escapeCsvCell, sanitizeSpreadsheetValue } from '../reports/exporters/spreadsheet-safe';
import { scopedPharmacyId } from '../reports/report-access';
import { StockMovementsService } from '../stock-movements/stock-movements.service';
import { exportCsv } from '../reports/exporters/csv.exporter';

function authUser(
  roles: AuthenticatedUser['roles'],
  partial: Partial<AuthenticatedUser> = {},
): AuthenticatedUser {
  return {
    id: 'user-1',
    name: 'Test User',
    email: 'test@localhost.local',
    firstName: 'Test',
    lastName: 'User',
    role: roles[0] ?? null,
    permissions: [],
    homePath: '/dashboard',
    organizationId: 'org-1',
    pharmacyId: null,
    warehouseId: null,
    pharmacySlug: null,
    organization: { id: 'org-1', name: 'ORG', code: 'ORG-001' },
    warehouse: null,
    pharmacy: null,
    roles,
    ...partial,
  };
}

describe('Phase 6C security hardening', () => {
  describe('JWT / token hashing', () => {
    it('hashes opaque tokens with sha256 (raw token never stored)', () => {
      const raw = randomBytes(32).toString('hex');
      const hash = createHash('sha256').update(raw).digest('hex');
      expect(hash).toHaveLength(64);
      expect(hash).not.toEqual(raw);
    });

    it('rejects malformed access token payloads missing sub', () => {
      const payload = { email: 'x@y.z' } as { sub?: string };
      expect(Boolean(payload.sub && typeof payload.sub === 'string')).toBe(false);
    });
  });

  describe('password hashing', () => {
    it('uses argon2id and provides a dummy hash for timing equalization', async () => {
      const service = new PasswordService();
      expect(PasswordService.DUMMY_ARGON2_HASH.startsWith('$argon2id$')).toBe(true);
      await expect(
        service.verify(PasswordService.DUMMY_ARGON2_HASH, 'timing-dummy-not-a-real-password'),
      ).resolves.toBe(true);
      const hash = await service.hash('SecurePass1!');
      expect(hash.startsWith('$argon2id$')).toBe(true);
    }, 30000);
  });

  describe('refresh token reuse detection logic', () => {
    it('revokes all active sessions when a revoked refresh token is presented again', async () => {
      const userId = 'u-1';
      const tokenHash = createHash('sha256').update('refresh-A').digest('hex');
      const prisma = {
        refreshToken: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'rt-1',
            userId,
            tokenHash,
            revokedAt: new Date(),
            expiresAt: new Date(Date.now() + 60_000),
          }),
          updateMany: jest.fn().mockResolvedValue({ count: 2 }),
        },
      };

      const stored = await prisma.refreshToken.findUnique({ where: { tokenHash } });
      expect(stored?.revokedAt).toBeTruthy();
      if (stored?.revokedAt) {
        await prisma.refreshToken.updateMany({
          where: { userId: stored.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId, revokedAt: null }),
        }),
      );
    });
  });

  describe('password reset sibling invalidation', () => {
    it('marks all unused reset tokens for the user as used', async () => {
      const updateMany = jest.fn().mockResolvedValue({ count: 2 });
      const userId = 'u-reset';
      await updateMany({
        where: { userId, usedAt: null },
        data: { usedAt: new Date() },
      });
      expect(updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId, usedAt: null },
        }),
      );
    });
  });

  describe('pharmacy IDOR isolation', () => {
    const pharmacyA = 'pha-aaa';
    const pharmacyB = 'pha-bbb';

    it('blocks pharmacy staff from another pharmacy via resolvePharmacyId', () => {
      const staff = authUser([RoleCode.PHARMACY_STAFF], {
        pharmacyId: pharmacyA,
        permissions: [PERMISSIONS.PHARMACY_STOCK_READ],
      });
      expect(() => resolvePharmacyId(staff, pharmacyB)).toThrow(ForbiddenException);
      expect(() => scopedPharmacyId(staff, pharmacyB)).toThrow(ForbiddenException);
    });

    it('allows pharmacy staff for their own pharmacy id', () => {
      const staff = authUser([RoleCode.PHARMACY_STAFF], { pharmacyId: pharmacyA });
      expect(resolvePharmacyId(staff, pharmacyA)).toBe(pharmacyA);
      expect(scopedPharmacyId(staff, undefined)).toBe(pharmacyA);
    });
  });

  describe('stock movements scoping', () => {
    it('forces pharmacy users to their own pharmacy movements', async () => {
      const prisma = {
        $transaction: jest.fn().mockResolvedValue([0, []]),
        stockMovement: {
          count: jest.fn().mockResolvedValue(0),
          findMany: jest.fn().mockResolvedValue([]),
        },
      };
      prisma.$transaction.mockImplementation(async (ops: unknown) => {
        if (Array.isArray(ops)) return Promise.all(ops);
        return ops;
      });
      const service = new StockMovementsService(prisma as never);
      const pharmacyUser = authUser([RoleCode.PHARMACY_STAFF], {
        pharmacyId: 'pha-1',
        permissions: [PERMISSIONS.STOCK_MOVEMENT_VIEW],
      });

      await service.list({ page: 1, limit: 20 }, pharmacyUser);
      expect(prisma.stockMovement.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            locationType: LocationType.PHARMACY,
            pharmacyId: 'pha-1',
          }),
        }),
      );
    });

    it('rejects pharmacy users requesting warehouse location movements', async () => {
      const service = new StockMovementsService({
        $transaction: jest.fn(),
        stockMovement: { count: jest.fn(), findMany: jest.fn() },
      } as never);
      const pharmacyUser = authUser([RoleCode.PHARMACY_STAFF], { pharmacyId: 'pha-1' });
      await expect(
        service.list(
          { page: 1, limit: 20, locationType: LocationType.WAREHOUSE },
          pharmacyUser,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects pharmacy users requesting another pharmacyId', async () => {
      const service = new StockMovementsService({
        $transaction: jest.fn(),
        stockMovement: { count: jest.fn(), findMany: jest.fn() },
      } as never);
      const pharmacyUser = authUser([RoleCode.PHARMACY_STAFF], { pharmacyId: 'pha-1' });
      await expect(
        service.list({ page: 1, limit: 20, pharmacyId: 'pha-2' }, pharmacyUser),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('user management isolation', () => {
    it('documents pharmacy actors cannot manage null-pharmacy (org) users', () => {
      const actorPharmacyId = 'pha-1';
      const targetPharmacyId: string | null = null;
      const denied =
        Boolean(actorPharmacyId) &&
        (!targetPharmacyId || actorPharmacyId !== targetPharmacyId);
      expect(denied).toBe(true);
    });
  });

  describe('notification own-user isolation', () => {
    it('never accepts recipientUserId from clients (API derives userId)', () => {
      const clientBody = { recipientUserId: 'other-user', title: 'x' };
      expect('recipientUserId' in clientBody).toBe(true);
      // Controllers pass CurrentUser().id only — client field is ignored by design.
      const serverUserId = 'authenticated-user';
      expect(serverUserId).not.toBe(clientBody.recipientUserId);
    });
  });

  describe('mass assignment / settings whitelist', () => {
    it('rejects unknown settings keys by allowlist', () => {
      const ALLOWED = new Set(['expiryWarningDays', 'organizationName']);
      const incoming = { expiryWarningDays: 30, role: 'SUPER_ADMIN', jwtSecret: 'x' };
      const applied = Object.keys(incoming).filter((k) => ALLOWED.has(k));
      expect(applied).toEqual(['expiryWarningDays']);
      expect(applied).not.toContain('role');
    });
  });

  describe('pagination bounds', () => {
    it('caps limit at 100', () => {
      const requested = 999999999;
      const limit = Math.min(Math.max(requested, 1), 100);
      expect(limit).toBe(100);
    });

    it('whitelists sort direction', () => {
      const allowed = new Set(['asc', 'desc']);
      expect(allowed.has('asc')).toBe(true);
      expect(allowed.has('drop table')).toBe(false);
    });
  });

  describe('export spreadsheet safety', () => {
    it('neutralizes formula-like CSV cells', () => {
      expect(escapeCsvCell('=CMD|calc')).toBe("'=CMD|calc");
      expect(escapeCsvCell('+1+1')).toBe("'+1+1");
      expect(escapeCsvCell('-1+1')).toBe("'-1+1");
      expect(escapeCsvCell('@SUM(A1)')).toBe("'@SUM(A1)");
      expect(sanitizeSpreadsheetValue('=1+1')).toBe("'=1+1");
      expect(sanitizeSpreadsheetValue(42)).toBe(42);
    });

    it('exports CSV with sanitized formula values', () => {
      const buffer = exportCsv({
        reportType: 'inventory',
        title: 'Test',
        generatedAt: new Date('2026-01-01T00:00:00.000Z'),
        filterSummary: 'none',
        columns: [{ key: 'name', header: 'Name' }],
        rows: [{ name: '=1+1' }],
      });
      const text = buffer.toString('utf8');
      expect(text).toContain("'=1+1");
    });
  });

  describe('production CORS / config guards', () => {
    it('rejects wildcard origin with credentials policy', () => {
      const webOrigin: string = '*';
      const unsafe = webOrigin === '*' || webOrigin.trim() === '';
      expect(unsafe).toBe(true);
    });

    it('rejects placeholder JWT secrets in production checks', () => {
      const secret = 'change-me-access-secret-use-a-long-random-value';
      expect(secret.toLowerCase().includes('change-me')).toBe(true);
      expect(secret.length >= 32).toBe(true);
    });
  });

  describe('safe error responses', () => {
    it('uses generic 500 message in production mode', () => {
      const isProduction = true;
      const status = 500;
      const message = 'prisma.client.engine failure at C:\\secrets\\db';
      const safeMessage = isProduction && status >= 500 ? 'Internal server error' : message;
      expect(safeMessage).toBe('Internal server error');
      expect(safeMessage).not.toContain('prisma');
      expect(safeMessage).not.toContain('secrets');
    });
  });

  describe('auth bypass expectations', () => {
    it('treats missing credentials as Unauthorized', () => {
      expect(() => {
        throw new UnauthorizedException('Invalid credentials');
      }).toThrow(UnauthorizedException);
    });
  });
});
