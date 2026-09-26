import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { hasPermission, PERMISSIONS, ROLE_DEFINITIONS, RoleCode, type AuthenticatedUser } from '@mh/shared';
import { assertCanMutateWarehouseStock } from '../../common/access/access';
import { InventoryService } from '../../common/inventory/inventory.service';
import { InventoryTransactionService } from '../../common/inventory/inventory-transaction.service';
import { ReceiptsService } from '../receipts/receipts.service';

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

describe('warehouse inventory permissions', () => {
  it('allows admin and warehouse manager to manage warehouse inventory', () => {
    expect(hasPermission(permissionsFor(RoleCode.SUPER_ADMIN), PERMISSIONS.RECEIPT_POST)).toBe(true);
    expect(hasPermission(permissionsFor(RoleCode.WAREHOUSE_MANAGER), PERMISSIONS.WAREHOUSE_STOCK_ADJUST)).toBe(true);
    expect(hasPermission(permissionsFor(RoleCode.WAREHOUSE_MANAGER), PERMISSIONS.STOCK_DAMAGE)).toBe(true);
    expect(hasPermission(permissionsFor(RoleCode.WAREHOUSE_MANAGER), PERMISSIONS.RECEIPT_CANCEL)).toBe(true);
  });

  it('allows warehouse staff to create and post receipts', () => {
    const permissions = permissionsFor(RoleCode.WAREHOUSE_STAFF);
    expect(hasPermission(permissions, PERMISSIONS.RECEIPT_CREATE)).toBe(true);
    expect(hasPermission(permissions, PERMISSIONS.RECEIPT_POST)).toBe(true);
    expect(hasPermission(permissions, PERMISSIONS.WAREHOUSE_STOCK_VIEW)).toBe(true);
  });

  it('does not grant pharmacy staff warehouse mutate permissions', () => {
    const permissions = permissionsFor(RoleCode.PHARMACY_STAFF);
    expect(hasPermission(permissions, PERMISSIONS.WAREHOUSE_STOCK_ADJUST)).toBe(false);
    expect(hasPermission(permissions, PERMISSIONS.RECEIPT_POST)).toBe(false);
    expect(hasPermission(permissions, PERMISSIONS.STOCK_DAMAGE)).toBe(false);
    expect(hasPermission(permissions, PERMISSIONS.STOCK_EXPIRE)).toBe(false);
  });

  it('blocks pharmacy users from mutating warehouse stock even with overlapping adjust codes', () => {
    expect(() => assertCanMutateWarehouseStock(authUser(RoleCode.PHARMACY_MANAGER))).toThrow(
      ForbiddenException,
    );
    expect(() => assertCanMutateWarehouseStock(authUser(RoleCode.WAREHOUSE_MANAGER))).not.toThrow();
  });
});

describe('InventoryService negative stock protection', () => {
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(undefined),
    $queryRaw: jest.fn().mockResolvedValue([]),
    warehouseStock: {
      findUnique: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    stockMovement: {
      create: jest.fn(),
    },
  };
  const service = new InventoryService({} as never);

  beforeEach(() => jest.clearAllMocks());

  it('rejects outbound quantity that would drive stock negative', async () => {
    tx.warehouseStock.findUnique.mockResolvedValue({
      id: 'ws-1',
      warehouseId: 'wh-1',
      medicineId: 'med-1',
      batchId: 'batch-1',
      quantity: 10,
    });

    await expect(
      service.apply(tx as never, {
        movementType: 'ADJUSTMENT_OUT' as never,
        locationType: 'WAREHOUSE' as never,
        warehouseId: 'wh-1',
        medicineId: 'med-1',
        batchId: 'batch-1',
        quantity: -20,
        performedById: 'user-1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(tx.warehouseStock.update).not.toHaveBeenCalled();
    expect(tx.stockMovement.create).not.toHaveBeenCalled();
  });

  it('applies inbound receipt and creates a movement', async () => {
    tx.warehouseStock.findUnique.mockResolvedValue(null);
    tx.warehouseStock.create.mockResolvedValue({ id: 'ws-1', quantity: 100 });
    tx.stockMovement.create.mockResolvedValue({ id: 'mv-1' });

    const balance = await service.apply(tx as never, {
      movementType: 'RECEIPT' as never,
      locationType: 'WAREHOUSE' as never,
      warehouseId: 'wh-1',
      medicineId: 'med-1',
      batchId: 'batch-1',
      quantity: 100,
      referenceType: 'STOCK_RECEIPT' as never,
      referenceId: 'rec-1',
      performedById: 'user-1',
    });

    expect(balance).toBe(100);
    expect(tx.warehouseStock.create).toHaveBeenCalled();
    expect(tx.stockMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          quantity: 100,
          movementType: 'RECEIPT',
        }),
      }),
    );
  });

  it('simulates concurrency: second outbound fails after first reduces stock', async () => {
    let quantity = 100;
    tx.warehouseStock.findUnique.mockImplementation(async () => ({
      id: 'ws-1',
      warehouseId: 'wh-1',
      medicineId: 'med-1',
      batchId: 'batch-1',
      quantity,
    }));
    tx.warehouseStock.update.mockImplementation(async ({ data }: { data: { quantity: number } }) => {
      quantity = data.quantity;
      return { id: 'ws-1', quantity };
    });
    tx.stockMovement.create.mockResolvedValue({ id: 'mv' });

    await service.apply(tx as never, {
      movementType: 'ADJUSTMENT_OUT' as never,
      locationType: 'WAREHOUSE' as never,
      warehouseId: 'wh-1',
      medicineId: 'med-1',
      batchId: 'batch-1',
      quantity: -80,
      performedById: 'user-a',
    });

    await expect(
      service.apply(tx as never, {
        movementType: 'ADJUSTMENT_OUT' as never,
        locationType: 'WAREHOUSE' as never,
        warehouseId: 'wh-1',
        medicineId: 'med-1',
        batchId: 'batch-1',
        quantity: -50,
        performedById: 'user-b',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(quantity).toBe(20);
  });
});

describe('InventoryTransactionService', () => {
  const prisma = {
    $transaction: jest.fn(),
    medicine: { findFirst: jest.fn() },
    medicineBatch: { findUnique: jest.fn() },
  };
  const inventory = { apply: jest.fn() };
  const audit = { record: jest.fn() };
  const service = new InventoryTransactionService(prisma as never, inventory as never, audit as never, {
    allocateMany: jest.fn(),
    allocateMedicineStock: jest.fn(),
  } as never);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma));
    prisma.medicine.findFirst.mockResolvedValue({ id: 'med-1', isActive: true, deletedAt: null });
    prisma.medicineBatch.findUnique.mockResolvedValue({
      id: 'batch-1',
      medicineId: 'med-1',
      expiryDate: new Date('2030-01-01'),
    });
  });

  it('creates ADJUSTMENT_OUT with negative signed quantity', async () => {
    inventory.apply.mockResolvedValue(80);
    const result = await service.adjustStock({
      warehouseId: 'wh-1',
      medicineId: 'med-1',
      batchId: 'batch-1',
      quantity: 20,
      direction: 'OUT',
      reason: 'PHYSICAL_COUNT',
      performedById: 'user-1',
    });
    expect(result.quantity).toBe(-20);
    expect(inventory.apply).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ quantity: -20, movementType: 'ADJUSTMENT_OUT' }),
    );
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'STOCK_ADJUSTMENT' }));
  });

  it('creates DAMAGE movement and audit', async () => {
    inventory.apply.mockResolvedValue(90);
    await service.markDamaged({
      warehouseId: 'wh-1',
      medicineId: 'med-1',
      batchId: 'batch-1',
      quantity: 10,
      notes: 'Broken seals',
      performedById: 'user-1',
    });
    expect(inventory.apply).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ quantity: -10, movementType: 'DAMAGE' }),
    );
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'MARK_DAMAGED' }));
  });

  it('creates EXPIRED movement and audit', async () => {
    inventory.apply.mockResolvedValue(0);
    await service.markExpired({
      warehouseId: 'wh-1',
      medicineId: 'med-1',
      batchId: 'batch-1',
      quantity: 50,
      notes: 'Past expiry',
      performedById: 'user-1',
    });
    expect(inventory.apply).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ quantity: -50, movementType: 'EXPIRED' }),
    );
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'MARK_EXPIRED' }));
  });

  it('rejects receive of expired batch', async () => {
    prisma.medicineBatch.findUnique.mockResolvedValue({
      id: 'batch-1',
      medicineId: 'med-1',
      expiryDate: new Date('2020-01-01'),
    });
    await expect(
      service.receiveStock(prisma as never, {
        warehouseId: 'wh-1',
        medicineId: 'med-1',
        batchId: 'batch-1',
        quantity: 10,
        receiptId: 'rec-1',
        performedById: 'user-1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects batch belonging to another medicine', async () => {
    prisma.medicineBatch.findUnique.mockResolvedValue({
      id: 'batch-1',
      medicineId: 'other-med',
      expiryDate: new Date('2030-01-01'),
    });
    await expect(
      service.receiveStock(prisma as never, {
        warehouseId: 'wh-1',
        medicineId: 'med-1',
        batchId: 'batch-1',
        quantity: 10,
        receiptId: 'rec-1',
        performedById: 'user-1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('ReceiptsService', () => {
  const prisma = {
    $transaction: jest.fn(),
    warehouse: { findFirst: jest.fn() },
    stockReceipt: {
      count: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    stockReceiptItem: { create: jest.fn(), deleteMany: jest.fn() },
    medicine: { findFirst: jest.fn() },
    medicineBatch: { findUnique: jest.fn(), upsert: jest.fn() },
    $queryRaw: jest.fn(),
  };
  const inventoryTx = { receiveStock: jest.fn() };
  const audit = { record: jest.fn() };
  const service = new ReceiptsService(prisma as never, inventoryTx as never, audit as never);

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
  });

  it('creates a draft receipt without changing stock', async () => {
    prisma.warehouse.findFirst.mockResolvedValue({ id: 'wh-1', isActive: true, deletedAt: null });
    prisma.stockReceipt.count.mockResolvedValue(0);
    prisma.stockReceipt.create.mockResolvedValue({ id: 'rec-1', receiptNumber: 'REC-000001' });
    prisma.medicine.findFirst.mockResolvedValue({ id: 'med-1', name: 'Para', isActive: true, deletedAt: null });
    prisma.medicineBatch.findUnique.mockResolvedValue({
      id: 'batch-1',
      medicineId: 'med-1',
      expiryDate: new Date('2030-01-01'),
    });
    prisma.stockReceiptItem.create.mockResolvedValue({ id: 'item-1' });
    prisma.stockReceipt.findUnique.mockResolvedValue({
      id: 'rec-1',
      receiptNumber: 'REC-000001',
      status: 'DRAFT',
      items: [{ quantity: 100, unitCost: null }],
      warehouse: { id: 'wh-1' },
      createdBy: { firstName: 'A', lastName: 'B', email: 'a@b.c' },
      postedBy: null,
    });

    const result = await service.create(
      {
        warehouseId: 'wh-1',
        items: [{ medicineId: 'med-1', batchId: 'batch-1', quantity: 100 }],
      },
      'user-1',
    );

    expect(result.status).toBe('DRAFT');
    expect(inventoryTx.receiveStock).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'CREATE_RECEIPT' }));
  });

  it('posts a draft receipt once and rejects a second post', async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([{ id: 'rec-1', status: 'DRAFT' }])
      .mockResolvedValueOnce([{ id: 'rec-1', status: 'POSTED' }]);
    prisma.stockReceipt.findUnique.mockResolvedValue({
      id: 'rec-1',
      warehouseId: 'wh-1',
      receivedAt: null,
      items: [{ medicineId: 'med-1', batchId: 'batch-1', quantity: 50, notes: null }],
    });
    inventoryTx.receiveStock.mockResolvedValue(150);
    prisma.stockReceipt.update.mockResolvedValue({
      id: 'rec-1',
      status: 'POSTED',
      items: [{ quantity: 50 }],
      warehouse: { id: 'wh-1' },
    });

    await service.post('rec-1', 'user-1');
    expect(inventoryTx.receiveStock).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'POST_RECEIPT' }));

    await expect(service.post('rec-1', 'user-1')).rejects.toBeInstanceOf(ConflictException);
    expect(inventoryTx.receiveStock).toHaveBeenCalledTimes(1);
  });

  it('cancels draft receipts and audits the cancel', async () => {
    prisma.stockReceipt.findUnique.mockResolvedValue({ id: 'rec-1', status: 'DRAFT' });
    prisma.stockReceipt.update.mockResolvedValue({ id: 'rec-1', status: 'CANCELLED' });
    await service.cancel('rec-1', 'user-1');
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'CANCEL_RECEIPT' }));
  });

  it('refuses to cancel a posted receipt', async () => {
    prisma.stockReceipt.findUnique.mockResolvedValue({ id: 'rec-1', status: 'POSTED' });
    await expect(service.cancel('rec-1', 'user-1')).rejects.toBeInstanceOf(BadRequestException);
  });
});
