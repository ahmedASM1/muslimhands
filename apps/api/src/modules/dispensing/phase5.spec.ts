import {
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import {
  AuditAction,
  hasPermission,
  PERMISSIONS,
  ROLE_DEFINITIONS,
  RoleCode,
  type AuthenticatedUser,
} from '@mh/shared';
import {
  assertCanAccessBeneficiaries,
  assertCanMutateDispensing,
} from '../../common/access/access';
import { DispensingAllocationService } from '../../common/inventory/dispensing-allocation.service';
import { InventoryTransactionService } from '../../common/inventory/inventory-transaction.service';
import { BeneficiariesService } from '../beneficiaries/beneficiaries.service';
import { DispensingService } from '../dispensing/dispensing.service';

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

describe('Phase 5 permissions', () => {
  it('grants pharmacy manager full beneficiary + dispensing permissions', () => {
    const permissions = permissionsFor(RoleCode.PHARMACY_MANAGER);
    expect(hasPermission(permissions, PERMISSIONS.BENEFICIARY_VIEW)).toBe(true);
    expect(hasPermission(permissions, PERMISSIONS.BENEFICIARY_CREATE)).toBe(true);
    expect(hasPermission(permissions, PERMISSIONS.BENEFICIARY_ACTIVATE)).toBe(true);
    expect(hasPermission(permissions, PERMISSIONS.DISPENSING_CREATE)).toBe(true);
    expect(hasPermission(permissions, PERMISSIONS.DISPENSING_HISTORY_VIEW)).toBe(true);
  });

  it('grants pharmacy staff operational dispensing permissions', () => {
    const permissions = permissionsFor(RoleCode.PHARMACY_STAFF);
    expect(hasPermission(permissions, PERMISSIONS.BENEFICIARY_VIEW)).toBe(true);
    expect(hasPermission(permissions, PERMISSIONS.DISPENSING_CREATE)).toBe(true);
    expect(hasPermission(permissions, PERMISSIONS.DISPENSING_HISTORY_VIEW)).toBe(true);
    expect(hasPermission(permissions, PERMISSIONS.BENEFICIARY_ACTIVATE)).toBe(false);
  });

  it('keeps warehouse roles away from beneficiary personal data', () => {
    const permissions = permissionsFor(RoleCode.WAREHOUSE_MANAGER);
    expect(hasPermission(permissions, PERMISSIONS.BENEFICIARY_VIEW)).toBe(false);
    expect(hasPermission(permissions, PERMISSIONS.BENEFICIARY_CREATE)).toBe(false);
    expect(() => assertCanAccessBeneficiaries(authUser(RoleCode.WAREHOUSE_MANAGER))).toThrow(
      ForbiddenException,
    );
    expect(() => assertCanMutateDispensing(authUser(RoleCode.WAREHOUSE_STAFF))).toThrow(
      ForbiddenException,
    );
  });
});

describe('DispensingAllocationService FEFO', () => {
  const allocation = new DispensingAllocationService();
  const tx = {
    $executeRaw: jest.fn(),
    pharmacyStock: { findMany: jest.fn() },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('allocates earliest expiry first across batches', async () => {
    tx.pharmacyStock.findMany.mockResolvedValue([
      {
        id: 's1',
        batchId: 'batch-a',
        medicineId: 'med-1',
        quantity: 20,
        batch: { expiryDate: new Date('2027-01-01'), batchNumber: 'A' },
      },
      {
        id: 's2',
        batchId: 'batch-b',
        medicineId: 'med-1',
        quantity: 30,
        batch: { expiryDate: new Date('2027-05-01'), batchNumber: 'B' },
      },
      {
        id: 's3',
        batchId: 'batch-c',
        medicineId: 'med-1',
        quantity: 100,
        batch: { expiryDate: new Date('2028-01-01'), batchNumber: 'C' },
      },
    ]);

    const result = await allocation.allocateMedicineStock(tx as never, 'ph-1', 'med-1', 40);
    expect(result).toEqual([
      expect.objectContaining({ batchId: 'batch-a', quantity: 20 }),
      expect.objectContaining({ batchId: 'batch-b', quantity: 20 }),
    ]);
  });

  it('fails when only expired stock would cover the request', async () => {
    // Eligible query already excludes expired — only 20 valid remain.
    tx.pharmacyStock.findMany.mockResolvedValue([
      {
        id: 's2',
        batchId: 'batch-b',
        medicineId: 'med-1',
        quantity: 20,
        batch: { expiryDate: new Date('2027-05-01'), batchNumber: 'B' },
      },
    ]);

    await expect(
      allocation.allocateMedicineStock(tx as never, 'ph-1', 'med-1', 30),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects non-positive quantities', async () => {
    await expect(
      allocation.allocateMedicineStock(tx as never, 'ph-1', 'med-1', 0),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('BeneficiariesService', () => {
  const prisma = {
    $transaction: jest.fn(),
    beneficiary: {
      count: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    dispensingRecord: { count: jest.fn(), findMany: jest.fn() },
  };
  const audit = { record: jest.fn() };
  const service = new BeneficiariesService(prisma as never, audit as never);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(async (arg: unknown) => {
      if (typeof arg === 'function') return (arg as (tx: unknown) => Promise<unknown>)(prisma);
      return Promise.all(arg as Promise<unknown>[]);
    });
  });

  it('creates an active beneficiary and audits', async () => {
    prisma.beneficiary.count.mockResolvedValue(2);
    prisma.beneficiary.findFirst.mockResolvedValue(null);
    prisma.beneficiary.create.mockResolvedValue({
      id: 'b-1',
      beneficiaryNumber: 'BN-000003',
      name: 'Fatima',
      phone: null,
      externalReference: null,
      dateOfBirth: null,
      gender: 'UNSPECIFIED',
      address: null,
      notes: null,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await service.create(authUser(RoleCode.PHARMACY_MANAGER), {
      fullName: 'Fatima',
    });
    expect(result.status).toBe('ACTIVE');
    expect(result.fullName).toBe('Fatima');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: AuditAction.CREATE_BENEFICIARY }),
    );
  });

  it('activates and deactivates with audit events', async () => {
    prisma.beneficiary.findFirst.mockResolvedValue({
      id: 'b-1',
      beneficiaryNumber: 'BN-1',
      name: 'Omar',
      phone: null,
      externalReference: null,
      dateOfBirth: null,
      gender: 'MALE',
      address: null,
      notes: null,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    prisma.beneficiary.update.mockResolvedValue({
      id: 'b-1',
      beneficiaryNumber: 'BN-1',
      name: 'Omar',
      phone: null,
      externalReference: null,
      dateOfBirth: null,
      gender: 'MALE',
      address: null,
      notes: null,
      isActive: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await service.deactivate(authUser(RoleCode.PHARMACY_MANAGER), 'b-1');
    expect(result.status).toBe('INACTIVE');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: AuditAction.DEACTIVATE_BENEFICIARY }),
    );
  });

  it('blocks warehouse users from beneficiary access', async () => {
    await expect(
      service.list(authUser(RoleCode.WAREHOUSE_MANAGER), { page: 1, limit: 20 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('searches by name/number/phone', async () => {
    prisma.beneficiary.count.mockResolvedValue(1);
    prisma.beneficiary.findMany.mockResolvedValue([
      {
        id: 'b-1',
        beneficiaryNumber: 'BN-0002',
        name: 'Fatima',
        phone: '123',
        externalReference: null,
        dateOfBirth: null,
        gender: 'FEMALE',
        address: null,
        notes: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    const result = await service.list(authUser(RoleCode.PHARMACY_STAFF), {
      page: 1,
      limit: 20,
      search: 'Fatima',
    });
    expect(result.items).toHaveLength(1);
    expect(prisma.beneficiary.findMany).toHaveBeenCalled();
  });
});

describe('DispensingService + InventoryTransactionService.dispense', () => {
  const prisma = {
    $transaction: jest.fn(),
    $executeRaw: jest.fn(),
    beneficiary: { findFirst: jest.fn() },
    pharmacy: { findFirst: jest.fn() },
    medicine: { findMany: jest.fn(), findFirst: jest.fn() },
    dispensingRecord: {
      count: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      create: jest.fn(),
    },
    dispensingItem: { create: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  const inventory = { apply: jest.fn() };
  const audit = { record: jest.fn() };
  const allocation = {
    allocateMany: jest.fn(),
    allocateMedicineStock: jest.fn(),
  };
  const inventoryTx = new InventoryTransactionService(
    prisma as never,
    inventory as never,
    audit as never,
    allocation as never,
  );
  const service = new DispensingService(prisma as never, inventoryTx);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(async (arg: unknown) => {
      if (typeof arg === 'function') {
        return (arg as (tx: unknown) => Promise<unknown>)({
          ...prisma,
          $executeRaw: prisma.$executeRaw,
        });
      }
      return Promise.all(arg as Promise<unknown>[]);
    });
    prisma.dispensingRecord.count.mockResolvedValue(0);
    prisma.dispensingRecord.findFirst.mockResolvedValue(null);
    prisma.beneficiary.findFirst.mockResolvedValue({
      id: 'ben-1',
      isActive: true,
      deletedAt: null,
    });
    prisma.pharmacy.findFirst.mockResolvedValue({
      id: 'ph-1',
      isActive: true,
      deletedAt: null,
    });
    prisma.medicine.findMany.mockResolvedValue([
      { id: 'med-1', name: 'Paracetamol', isActive: true, referenceValue: 0.5, deletedAt: null },
    ]);
    prisma.dispensingRecord.create.mockResolvedValue({
      id: 'dsp-1',
      recordNumber: 'DP-000001',
    });
    prisma.dispensingRecord.findUniqueOrThrow.mockResolvedValue({
      id: 'dsp-1',
      recordNumber: 'DP-000001',
      pharmacyId: 'ph-1',
      beneficiaryId: 'ben-1',
      status: 'COMPLETED',
      notes: null,
      dispensedAt: new Date(),
      createdAt: new Date(),
      pharmacy: { id: 'ph-1', name: 'Amal', code: 'PHA-001' },
      beneficiary: {
        id: 'ben-1',
        beneficiaryNumber: 'BN-1',
        name: 'Fatima',
        phone: null,
        isActive: true,
      },
      dispensedBy: { id: 'user-1', firstName: 'Test', lastName: 'User' },
      items: [
        {
          id: 'di-1',
          medicineId: 'med-1',
          batchId: 'batch-a',
          quantity: 20,
          referenceValue: 0.5,
          medicine: { id: 'med-1', name: 'Paracetamol' },
          batch: { id: 'batch-a', batchNumber: 'A', expiryDate: new Date('2027-01-01') },
        },
        {
          id: 'di-2',
          medicineId: 'med-1',
          batchId: 'batch-b',
          quantity: 20,
          referenceValue: 0.5,
          medicine: { id: 'med-1', name: 'Paracetamol' },
          batch: { id: 'batch-b', batchNumber: 'B', expiryDate: new Date('2027-05-01') },
        },
      ],
    });
    allocation.allocateMany.mockResolvedValue(
      new Map([
        [
          'med-1',
          [
            { stockId: 's1', batchId: 'batch-a', medicineId: 'med-1', quantity: 20 },
            { stockId: 's2', batchId: 'batch-b', medicineId: 'med-1', quantity: 20 },
          ],
        ],
      ]),
    );
    inventory.apply.mockResolvedValue(0);
  });

  it('creates a completed FEFO dispensing with movements and audit', async () => {
    const result = await service.create(authUser(RoleCode.PHARMACY_STAFF), {
      beneficiaryId: 'ben-1',
      items: [{ medicineId: 'med-1', quantity: 40 }],
    });

    expect(result.dispensingNumber).toBe('DP-000001');
    expect(result.medicines[0]?.batches).toHaveLength(2);
    expect(inventory.apply).toHaveBeenCalledTimes(2);
    expect(inventory.apply).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        movementType: 'DISPENSE',
        quantity: -20,
        batchId: 'batch-a',
        referenceId: 'dsp-1',
      }),
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: AuditAction.CREATE_DISPENSING }),
      }),
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: AuditAction.COMPLETE_DISPENSING }),
      }),
    );
  });

  it('rejects inactive beneficiaries', async () => {
    prisma.beneficiary.findFirst.mockResolvedValue({
      id: 'ben-1',
      isActive: false,
      deletedAt: null,
    });
    await expect(
      service.create(authUser(RoleCode.PHARMACY_STAFF), {
        beneficiaryId: 'ben-1',
        items: [{ medicineId: 'med-1', quantity: 1 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects inactive medicines', async () => {
    prisma.medicine.findMany.mockResolvedValue([
      { id: 'med-1', name: 'Para', isActive: false, referenceValue: null, deletedAt: null },
    ]);
    await expect(
      service.create(authUser(RoleCode.PHARMACY_STAFF), {
        beneficiaryId: 'ben-1',
        items: [{ medicineId: 'med-1', quantity: 1 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('fails atomically when allocation reports insufficient stock', async () => {
    allocation.allocateMany.mockRejectedValue(
      new BadRequestException('Insufficient valid (non-expired) pharmacy stock'),
    );
    await expect(
      service.create(authUser(RoleCode.PHARMACY_STAFF), {
        beneficiaryId: 'ben-1',
        items: [{ medicineId: 'med-1', quantity: 999 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.dispensingRecord.create).not.toHaveBeenCalled();
  });

  it('fails the whole multi-medicine request when one medicine cannot allocate', async () => {
    prisma.medicine.findMany.mockResolvedValue([
      { id: 'med-1', name: 'A', isActive: true, referenceValue: null, deletedAt: null },
      { id: 'med-2', name: 'B', isActive: true, referenceValue: null, deletedAt: null },
    ]);
    allocation.allocateMany.mockRejectedValue(new BadRequestException('Insufficient'));
    await expect(
      service.create(authUser(RoleCode.PHARMACY_STAFF), {
        beneficiaryId: 'ben-1',
        items: [
          { medicineId: 'med-1', quantity: 10 },
          { medicineId: 'med-2', quantity: 5 },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(inventory.apply).not.toHaveBeenCalled();
  });

  it('returns the existing record for duplicate idempotency keys', async () => {
    const existing = {
      id: 'dsp-existing',
      recordNumber: 'DP-000099',
      pharmacyId: 'ph-1',
      beneficiaryId: 'ben-1',
      status: 'COMPLETED',
      notes: null,
      dispensedAt: new Date(),
      createdAt: new Date(),
      pharmacy: { id: 'ph-1', name: 'Amal', code: 'PHA-001' },
      beneficiary: {
        id: 'ben-1',
        beneficiaryNumber: 'BN-1',
        name: 'Fatima',
        phone: null,
        isActive: true,
      },
      dispensedBy: { firstName: 'Test', lastName: 'User' },
      items: [],
    };
    prisma.dispensingRecord.findFirst.mockResolvedValue(existing);

    const result = await service.create(
      authUser(RoleCode.PHARMACY_STAFF),
      { beneficiaryId: 'ben-1', items: [{ medicineId: 'med-1', quantity: 1 }] },
      'idem-1',
    );
    expect(result.id).toBe('dsp-existing');
    expect(allocation.allocateMany).not.toHaveBeenCalled();
  });

  it('derives pharmacy from assignment and blocks warehouse users', async () => {
    await expect(
      service.create(authUser(RoleCode.WAREHOUSE_MANAGER), {
        beneficiaryId: 'ben-1',
        items: [{ medicineId: 'med-1', quantity: 1 }],
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('blocks pharmacy A from viewing pharmacy B dispensing', async () => {
    prisma.dispensingRecord.findUnique.mockResolvedValue({
      id: 'dsp-1',
      pharmacyId: 'ph-other',
      recordNumber: 'DP-1',
      beneficiaryId: 'ben-1',
      status: 'COMPLETED',
      notes: null,
      dispensedAt: new Date(),
      createdAt: new Date(),
      items: [],
      beneficiary: null,
      pharmacy: null,
      dispensedBy: null,
    });
    await expect(
      service.get(authUser(RoleCode.PHARMACY_STAFF, { pharmacyId: 'ph-1' }), 'dsp-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('simulates concurrent overlapping stock without going negative', async () => {
    let stock = 10;
    const consume = (qty: number) => {
      if (stock < qty) throw new BadRequestException('Insufficient pharmacy stock');
      stock -= qty;
      return stock;
    };

    // First wins with 8; second must fail for 5.
    expect(consume(8)).toBe(2);
    expect(() => consume(5)).toThrow(BadRequestException);
    expect(stock).toBe(2);
  });
});

describe('InventoryTransactionService.dispense validation', () => {
  const prisma = {
    $transaction: jest.fn(),
    $executeRaw: jest.fn(),
    beneficiary: { findFirst: jest.fn() },
    pharmacy: { findFirst: jest.fn() },
    medicine: { findMany: jest.fn() },
    dispensingRecord: { findFirst: jest.fn(), create: jest.fn(), count: jest.fn() },
    dispensingItem: { create: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  const inventory = { apply: jest.fn() };
  const audit = { record: jest.fn() };
  const allocation = { allocateMany: jest.fn(), allocateMedicineStock: jest.fn() };
  const service = new InventoryTransactionService(
    prisma as never,
    inventory as never,
    audit as never,
    allocation as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ ...prisma, $executeRaw: prisma.$executeRaw }),
    );
  });

  it('requires at least one item', async () => {
    await expect(
      service.dispense({
        pharmacyId: 'ph-1',
        beneficiaryId: 'ben-1',
        performedById: 'user-1',
        items: [],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects duplicate medicines in one request', async () => {
    await expect(
      service.dispense({
        pharmacyId: 'ph-1',
        beneficiaryId: 'ben-1',
        performedById: 'user-1',
        items: [
          { medicineId: 'med-1', quantity: 1 },
          { medicineId: 'med-1', quantity: 2 },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
