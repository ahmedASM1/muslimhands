import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { hasPermission, PERMISSIONS, ROLE_DEFINITIONS, RoleCode, type AuthenticatedUser } from '@mh/shared';
import { assertCanMutateWarehouseStock } from '../../common/access/access';
import { SupplyRequestsService } from '../supply-requests/supply-requests.service';
import { TransfersService } from '../transfers/transfers.service';

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

describe('Phase 4B permissions', () => {
  it('allows pharmacy staff to create/submit supply requests and receive transfers', () => {
    const permissions = permissionsFor(RoleCode.PHARMACY_STAFF);
    expect(hasPermission(permissions, PERMISSIONS.SUPPLY_REQUEST_CREATE)).toBe(true);
    expect(hasPermission(permissions, PERMISSIONS.SUPPLY_REQUEST_SUBMIT)).toBe(true);
    expect(hasPermission(permissions, PERMISSIONS.TRANSFER_RECEIVE)).toBe(true);
    expect(hasPermission(permissions, PERMISSIONS.TRANSFER_SHIP)).toBe(false);
    expect(hasPermission(permissions, PERMISSIONS.SUPPLY_REQUEST_APPROVE)).toBe(false);
  });

  it('allows warehouse staff to prepare and ship transfers', () => {
    const permissions = permissionsFor(RoleCode.WAREHOUSE_STAFF);
    expect(hasPermission(permissions, PERMISSIONS.TRANSFER_CREATE)).toBe(true);
    expect(hasPermission(permissions, PERMISSIONS.TRANSFER_PREPARE)).toBe(true);
    expect(hasPermission(permissions, PERMISSIONS.TRANSFER_SHIP)).toBe(true);
    expect(hasPermission(permissions, PERMISSIONS.TRANSFER_RECEIVE)).toBe(false);
  });

  it('keeps pharmacy users from mutating warehouse stock', () => {
    expect(() => assertCanMutateWarehouseStock(authUser(RoleCode.PHARMACY_MANAGER))).toThrow(
      ForbiddenException,
    );
  });
});

describe('SupplyRequestsService', () => {
  const prisma = {
    $transaction: jest.fn(),
    warehouse: { findFirst: jest.fn() },
    medicine: { findMany: jest.fn() },
    supplyRequest: {
      count: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    supplyRequestItem: { deleteMany: jest.fn(), create: jest.fn(), update: jest.fn() },
  };
  const audit = { record: jest.fn() };
  const notifications = { notifyRole: jest.fn() };
  const service = new SupplyRequestsService(prisma as never, audit as never, notifications as never);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(async (arg: unknown) => {
      if (typeof arg === 'function') return (arg as (tx: unknown) => Promise<unknown>)(prisma);
      return Promise.all(arg as Promise<unknown>[]);
    });
  });

  it('creates a draft request for the assigned pharmacy', async () => {
    prisma.warehouse.findFirst.mockResolvedValue({ id: 'wh-1', isActive: true });
    prisma.medicine.findMany.mockResolvedValue([{ id: 'med-1', isActive: true, name: 'Para' }]);
    prisma.supplyRequest.create.mockResolvedValue({
      id: 'sr-1',
      requestNumber: 'SR-000001',
      status: 'DRAFT',
      items: [],
    });

    const result = await service.create(authUser(RoleCode.PHARMACY_MANAGER), {
      warehouseId: 'wh-1',
      items: [{ medicineId: 'med-1', requestedQty: 100 }],
    });

    expect(result.status).toBe('DRAFT');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CREATE_SUPPLY_REQUEST' }),
    );
  });

  it('rejects editing a submitted request', async () => {
    prisma.supplyRequest.findUnique.mockResolvedValue({
      id: 'sr-1',
      status: 'SUBMITTED',
      pharmacyId: 'ph-1',
    });
    await expect(
      service.update('sr-1', authUser(RoleCode.PHARMACY_MANAGER), { notes: 'x' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('submits a draft and audits', async () => {
    prisma.supplyRequest.findUnique.mockResolvedValue({
      id: 'sr-1',
      status: 'DRAFT',
      pharmacyId: 'ph-1',
      requestNumber: 'SR-1',
      items: [{ id: 'i1' }],
    });
    prisma.supplyRequest.update.mockResolvedValue({ id: 'sr-1', status: 'SUBMITTED', items: [] });
    await service.submit('sr-1', authUser(RoleCode.PHARMACY_MANAGER));
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SUBMIT_SUPPLY_REQUEST' }),
    );
  });

  it('rejects approval quantities above requested', async () => {
    prisma.supplyRequest.findUnique.mockResolvedValue({
      id: 'sr-1',
      status: 'SUBMITTED',
      items: [{ id: 'i1', requestedQty: 50, medicine: { isActive: true, name: 'Para' } }],
    });
    await expect(
      service.approve('sr-1', authUser(RoleCode.WAREHOUSE_MANAGER), {
        items: [{ id: 'i1', approvedQty: 80 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requires a rejection reason', async () => {
    prisma.supplyRequest.findUnique.mockResolvedValue({ id: 'sr-1', status: 'SUBMITTED' });
    await expect(
      service.reject('sr-1', authUser(RoleCode.WAREHOUSE_MANAGER), { rejectionReason: '' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('blocks pharmacy A from viewing pharmacy B request', async () => {
    prisma.supplyRequest.findUnique.mockResolvedValue({
      id: 'sr-1',
      pharmacyId: 'ph-other',
      items: [],
    });
    await expect(
      service.get('sr-1', authUser(RoleCode.PHARMACY_MANAGER, { pharmacyId: 'ph-1' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('TransfersService two-step custody', () => {
  const prisma = {
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
    warehouse: { findFirst: jest.fn() },
    pharmacy: { findFirst: jest.fn() },
    medicine: { findFirst: jest.fn() },
    medicineBatch: { findUnique: jest.fn() },
    supplyRequest: { findUnique: jest.fn() },
    supplyRequestItem: { findMany: jest.fn(), update: jest.fn() },
    stockTransfer: {
      count: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    stockTransferItem: { deleteMany: jest.fn(), create: jest.fn(), update: jest.fn() },
  };
  const inventoryTx = { transferOut: jest.fn(), transferIn: jest.fn() };
  const audit = { record: jest.fn() };
  const service = new TransfersService(prisma as never, inventoryTx as never, audit as never);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(async (arg: unknown) => {
      if (typeof arg === 'function') {
        return (arg as (tx: unknown) => Promise<unknown>)({
          ...prisma,
          $queryRaw: prisma.$queryRaw,
        });
      }
      return Promise.all(arg as Promise<unknown>[]);
    });
    prisma.warehouse.findFirst.mockResolvedValue({ id: 'wh-1', isActive: true });
    prisma.pharmacy.findFirst.mockResolvedValue({ id: 'ph-1', isActive: true });
    prisma.medicine.findFirst.mockResolvedValue({ id: 'med-1', isActive: true, name: 'Para', deletedAt: null });
    prisma.medicineBatch.findUnique.mockResolvedValue({
      id: 'batch-1',
      medicineId: 'med-1',
      expiryDate: new Date('2030-01-01'),
    });
  });

  it('creates a DRAFT transfer without mutating stock', async () => {
    prisma.stockTransfer.create.mockResolvedValue({
      id: 'tr-1',
      transferNumber: 'TR-000001',
      status: 'DRAFT',
      items: [],
    });
    await service.create(authUser(RoleCode.WAREHOUSE_MANAGER), {
      warehouseId: 'wh-1',
      pharmacyId: 'ph-1',
      items: [{ medicineId: 'med-1', batchId: 'batch-1', quantity: 10 }],
    });
    expect(inventoryTx.transferOut).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'CREATE_TRANSFER' }));
  });

  it('rejects expired batches on create', async () => {
    prisma.medicineBatch.findUnique.mockResolvedValue({
      id: 'batch-1',
      medicineId: 'med-1',
      expiryDate: new Date('2020-01-01'),
    });
    await expect(
      service.create(authUser(RoleCode.WAREHOUSE_MANAGER), {
        warehouseId: 'wh-1',
        pharmacyId: 'ph-1',
        items: [{ medicineId: 'med-1', batchId: 'batch-1', quantity: 10 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('ships a prepared transfer once and rejects a duplicate ship', async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([{ id: 'tr-1', status: 'PREPARED' }])
      .mockResolvedValueOnce([{ id: 'tr-1', status: 'SHIPPED' }]);
    prisma.stockTransfer.findUnique.mockResolvedValue({
      id: 'tr-1',
      warehouseId: 'wh-1',
      pharmacyId: 'ph-1',
      supplyRequestId: null,
      items: [{ id: 'ti-1', medicineId: 'med-1', batchId: 'batch-1', quantity: 10, notes: null }],
    });
    prisma.stockTransfer.update.mockResolvedValue({ id: 'tr-1', status: 'SHIPPED', items: [] });
    inventoryTx.transferOut.mockResolvedValue(90);

    await service.ship('tr-1', authUser(RoleCode.WAREHOUSE_MANAGER));
    expect(inventoryTx.transferOut).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'SHIP_TRANSFER' }));

    await expect(service.ship('tr-1', authUser(RoleCode.WAREHOUSE_MANAGER))).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(inventoryTx.transferOut).toHaveBeenCalledTimes(1);
  });

  it('receives a shipped transfer into pharmacy stock', async () => {
    prisma.$queryRaw.mockResolvedValue([
      { id: 'tr-1', status: 'SHIPPED', pharmacy_id: 'ph-1' },
    ]);
    prisma.stockTransfer.findUnique.mockResolvedValue({
      id: 'tr-1',
      pharmacyId: 'ph-1',
      items: [{ id: 'ti-1', medicineId: 'med-1', batchId: 'batch-1', quantity: 10, receivedQty: 0, notes: null }],
    });
    prisma.stockTransfer.update.mockResolvedValue({ id: 'tr-1', status: 'RECEIVED', items: [] });
    inventoryTx.transferIn.mockResolvedValue(10);

    await service.receive('tr-1', authUser(RoleCode.PHARMACY_MANAGER));
    expect(inventoryTx.transferIn).toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'RECEIVE_TRANSFER' }));
  });

  it('prevents pharmacy from receiving another pharmacy transfer', async () => {
    prisma.$queryRaw.mockResolvedValue([
      { id: 'tr-1', status: 'SHIPPED', pharmacy_id: 'ph-other' },
    ]);
    await expect(
      service.receive('tr-1', authUser(RoleCode.PHARMACY_MANAGER, { pharmacyId: 'ph-1' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('cancels only before shipping', async () => {
    prisma.$queryRaw.mockResolvedValue([{ id: 'tr-1', status: 'SHIPPED' }]);
    await expect(
      service.cancel('tr-1', authUser(RoleCode.WAREHOUSE_MANAGER)),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('enforces approved quantity remaining on linked supply request', async () => {
    prisma.supplyRequest.findUnique.mockResolvedValue({
      id: 'sr-1',
      pharmacyId: 'ph-1',
      status: 'APPROVED',
      items: [{ medicineId: 'med-1', approvedQty: 50, fulfilledQty: 40, requestedQty: 50 }],
    });
    await expect(
      service.create(authUser(RoleCode.WAREHOUSE_MANAGER), {
        warehouseId: 'wh-1',
        pharmacyId: 'ph-1',
        supplyRequestId: 'sr-1',
        items: [{ medicineId: 'med-1', batchId: 'batch-1', quantity: 20 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
