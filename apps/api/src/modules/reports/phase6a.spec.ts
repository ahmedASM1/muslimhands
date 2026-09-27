import { ForbiddenException } from '@nestjs/common';
import {
  AuditAction,
  hasPermission,
  PERMISSIONS,
  ROLE_DEFINITIONS,
  RoleCode,
  type AuthenticatedUser,
} from '@mh/shared';
import { exportCsv } from './exporters/csv.exporter';
import { exportExcel } from './exporters/excel.exporter';
import { exportPdf } from './exporters/pdf.exporter';
import {
  assertCanExport,
  assertCanViewBeneficiaryReports,
  canViewBeneficiaryReports,
  scopedPharmacyId,
} from './report-access';
import { daysUntilExpiry, parseInclusiveDateRange, startOfUtcDay } from './date-range';
import { estimatedValue, stockStatusLabel } from './types/report.types';
import { ReportsService } from './reports.service';

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

describe('Phase 6A report permissions', () => {
  it('grants report viewer read access without mutation permissions', () => {
    const permissions = permissionsFor(RoleCode.REPORT_VIEWER);
    expect(hasPermission(permissions, PERMISSIONS.REPORT_VIEW)).toBe(true);
    expect(hasPermission(permissions, PERMISSIONS.REPORT_EXPORT)).toBe(true);
    expect(hasPermission(permissions, PERMISSIONS.DISPENSING_CREATE)).toBe(false);
    expect(hasPermission(permissions, PERMISSIONS.BENEFICIARY_VIEW)).toBe(false);
  });

  it('blocks warehouse roles from beneficiary reports', () => {
    expect(canViewBeneficiaryReports(authUser(RoleCode.WAREHOUSE_MANAGER))).toBe(false);
    expect(() => assertCanViewBeneficiaryReports(authUser(RoleCode.WAREHOUSE_STAFF))).toThrow(
      ForbiddenException,
    );
  });

  it('enforces pharmacy isolation on scopedPharmacyId', () => {
    expect(() =>
      scopedPharmacyId(authUser(RoleCode.PHARMACY_STAFF, { pharmacyId: 'ph-1' }), 'ph-2'),
    ).toThrow(ForbiddenException);
    expect(scopedPharmacyId(authUser(RoleCode.PHARMACY_STAFF, { pharmacyId: 'ph-1' }), 'ph-1')).toBe(
      'ph-1',
    );
  });

  it('allows pharmacy manager export', () => {
    expect(() => assertCanExport(authUser(RoleCode.PHARMACY_MANAGER))).not.toThrow();
  });
});

describe('Phase 6A date range', () => {
  it('treats dateFrom/dateTo as inclusive UTC days', () => {
    const range = parseInclusiveDateRange({ dateFrom: '2026-03-01', dateTo: '2026-03-01' });
    expect(range.start.toISOString()).toBe('2026-03-01T00:00:00.000Z');
    expect(range.end.toISOString()).toBe('2026-03-01T23:59:59.999Z');
  });

  it('supports ALL period without clipping to 30 days', () => {
    const range = parseInclusiveDateRange({ period: 'ALL' });
    expect(range.label).toBe('all');
    expect(range.start.toISOString()).toBe('1970-01-01T00:00:00.000Z');
    expect(range.end.getUTCHours()).toBe(23);
  });

  it('computes days until expiry consistently', () => {
    const today = startOfUtcDay(new Date('2026-03-01T12:00:00Z'));
    expect(daysUntilExpiry(new Date('2026-03-11'), today)).toBe(10);
    expect(daysUntilExpiry(new Date('2026-02-28'), today)).toBe(-1);
  });
});

describe('Phase 6A estimated value + stock status', () => {
  it('returns null estimated value when unit value is null', () => {
    expect(estimatedValue(10, null)).toBeNull();
    expect(estimatedValue(10, 1.5)).toBe(15);
  });

  it('reuses existing low-stock threshold semantics', () => {
    expect(
      stockStatusLabel({
        quantity: 5,
        medicineTotal: 5,
        minimumStock: 10,
        expiry: 'VALID',
      }),
    ).toBe('LOW_STOCK');
  });
});

describe('Phase 6A exporters', () => {
  const payload = {
    reportType: 'dispensing',
    title: 'Dispensing report',
    generatedAt: new Date('2026-03-19T10:00:00Z'),
    filterSummary: 'period=30D',
    columns: [
      { key: 'medicine', header: 'Medicine' },
      { key: 'quantity', header: 'Quantity' },
      { key: 'notes', header: 'Notes' },
    ],
    rows: [
      { medicine: 'Paracetamol', quantity: 10, notes: 'ok' },
      { medicine: 'دواء تجريبي', quantity: 3, notes: 'Arabic, comma, "quoted"' },
    ],
  };

  it('exports UTF-8 CSV with BOM and escaped fields', () => {
    const buffer = exportCsv(payload);
    const text = buffer.toString('utf8');
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text).toContain('Medicine,Quantity,Notes');
    expect(text).toContain('دواء تجريبي');
    expect(text).toContain('"Arabic, comma, ""quoted"""');
  });

  it('exports Excel workbook bytes', async () => {
    const buffer = await exportExcel(payload);
    expect(buffer.byteLength).toBeGreaterThan(100);
    // XLSX files are zip containers starting with PK
    expect(buffer.subarray(0, 2).toString()).toBe('PK');
  });

  it('exports PDF bytes', async () => {
    const buffer = await exportPdf(payload);
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
    expect(buffer.byteLength).toBeGreaterThan(100);
  });
});

describe('ReportsService security + filtering', () => {
  const prisma = {
    medicine: { count: jest.fn(), findMany: jest.fn() },
    warehouseStock: {
      aggregate: jest.fn(),
      groupBy: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
    },
    pharmacyStock: {
      aggregate: jest.fn(),
      groupBy: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
    },
    medicineBatch: { count: jest.fn() },
    dispensingRecord: { count: jest.fn(), groupBy: jest.fn(), findMany: jest.fn() },
    dispensingItem: { aggregate: jest.fn(), groupBy: jest.fn(), findMany: jest.fn() },
    supplyRequest: { count: jest.fn(), findMany: jest.fn() },
    stockTransfer: { count: jest.fn(), findMany: jest.fn() },
    stockMovement: { count: jest.fn(), findMany: jest.fn(), groupBy: jest.fn() },
    stockReceipt: { count: jest.fn(), findMany: jest.fn() },
    beneficiary: { count: jest.fn(), findMany: jest.fn() },
    $transaction: jest.fn(),
  };
  const audit = { record: jest.fn() };
  const settings = { getExpiryWarningDays: jest.fn().mockResolvedValue(90) };
  const service = new ReportsService(prisma as never, audit as never, settings as never);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(async (arg: unknown) => {
      if (Array.isArray(arg)) return Promise.all(arg);
      if (typeof arg === 'function') return (arg as (tx: unknown) => Promise<unknown>)(prisma);
      return arg;
    });
  });

  it('blocks warehouse users from beneficiary report', async () => {
    await expect(
      service.beneficiaries(authUser(RoleCode.WAREHOUSE_MANAGER), { page: 1, limit: 20 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('scopes pharmacy stock to assigned pharmacy', async () => {
    await expect(
      service.pharmacyStock(authUser(RoleCode.PHARMACY_STAFF, { pharmacyId: 'ph-1' }), {
        page: 1,
        limit: 20,
        pharmacyId: 'ph-2',
      } as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects unauthorized pharmacy stock access attempt via export path', async () => {
    await expect(
      service.export(
        authUser(RoleCode.PHARMACY_STAFF, { pharmacyId: 'ph-1' }),
        'pharmacy-stock',
        'csv',
        { pharmacyId: 'ph-2' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('audits successful exports with EXPORT_REPORT', async () => {
    prisma.pharmacyStock.findMany.mockResolvedValue([]);
    prisma.pharmacyStock.groupBy.mockResolvedValue([]);
    prisma.stockMovement.findMany.mockResolvedValue([]);
    await service.export(authUser(RoleCode.PHARMACY_MANAGER), 'pharmacy-stock', 'csv', {});
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: AuditAction.EXPORT_REPORT }),
    );
  });

  it('filters stock movements by type and date', async () => {
    prisma.stockMovement.count.mockResolvedValue(1);
    prisma.stockMovement.findMany.mockResolvedValue([
      {
        id: 'm1',
        occurredAt: new Date('2026-03-10'),
        movementType: 'DISPENSE',
        quantity: -5,
        balanceAfter: 10,
        referenceType: 'DISPENSING_RECORD',
        referenceId: 'd1',
        reason: null,
        locationType: 'PHARMACY',
        medicine: { name: 'Para', sku: 'SKU' },
        batch: { batchNumber: 'B1' },
        warehouse: null,
        pharmacy: { name: 'Amal', code: 'PHA' },
        performedBy: { firstName: 'A', lastName: 'B' },
      },
    ]);
    prisma.$transaction.mockResolvedValue([
      1,
      [
        {
          id: 'm1',
          occurredAt: new Date('2026-03-10'),
          movementType: 'DISPENSE',
          quantity: -5,
          balanceAfter: 10,
          referenceType: 'DISPENSING_RECORD',
          referenceId: 'd1',
          reason: null,
          locationType: 'PHARMACY',
          medicine: { name: 'Para', sku: 'SKU' },
          batch: { batchNumber: 'B1' },
          warehouse: null,
          pharmacy: { name: 'Amal', code: 'PHA' },
          performedBy: { firstName: 'A', lastName: 'B' },
        },
      ],
    ]);

    const result = await service.stockMovements(authUser(RoleCode.PHARMACY_MANAGER), {
      page: 1,
      limit: 20,
      movementType: 'DISPENSE',
      dateFrom: '2026-03-01',
      dateTo: '2026-03-31',
    });
    expect(result.items[0]?.direction).toBe('OUT');
    expect(result.items[0]?.movementType).toBe('DISPENSE');
  });
});
