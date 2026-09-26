import { ConflictException, BadRequestException } from '@nestjs/common';
import { DosageForm, hasPermission, PERMISSIONS, ROLE_DEFINITIONS, RoleCode } from '@mh/shared';
import { CategoriesService } from '../categories/categories.service';
import { MedicinesService } from '../medicines/medicines.service';
import { UnitsService } from '../units/units.service';
import { BatchesService } from '../batches/batches.service';

function permissionsFor(role: RoleCode) {
  return ROLE_DEFINITIONS.find((item) => item.code === role)!.permissions;
}

describe('catalog permissions', () => {
  it('allows warehouse and admin users to manage the catalog', () => {
    expect(hasPermission(permissionsFor(RoleCode.SUPER_ADMIN), PERMISSIONS.MEDICINES_CREATE)).toBe(true);
    expect(hasPermission(permissionsFor(RoleCode.WAREHOUSE_MANAGER), PERMISSIONS.MEDICINES_CREATE)).toBe(true);
    expect(hasPermission(permissionsFor(RoleCode.WAREHOUSE_MANAGER), PERMISSIONS.CATEGORIES_CREATE)).toBe(true);
  });

  it('prevents pharmacy staff from modifying the global catalog', () => {
    const permissions = permissionsFor(RoleCode.PHARMACY_STAFF);
    expect(hasPermission(permissions, PERMISSIONS.MEDICINES_READ)).toBe(true);
    expect(hasPermission(permissions, PERMISSIONS.MEDICINES_CREATE)).toBe(false);
    expect(hasPermission(permissions, PERMISSIONS.MEDICINES_UPDATE)).toBe(false);
    expect(hasPermission(permissions, PERMISSIONS.CATEGORIES_CREATE)).toBe(false);
  });
});

describe('CategoriesService', () => {
  const prisma = {
    medicineCategory: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
  };
  const audit = { record: jest.fn() };
  const service = new CategoriesService(prisma as never, audit as never);

  beforeEach(() => jest.clearAllMocks());

  it('creates a category', async () => {
    prisma.medicineCategory.findFirst.mockResolvedValue(null);
    prisma.medicineCategory.create.mockResolvedValue({ id: 'c1', name: 'Analgesics', isActive: true });
    const result = await service.create({ name: 'Analgesics' }, 'user-1');
    expect(result.status).toBe('ACTIVE');
    expect(audit.record).toHaveBeenCalled();
  });

  it('rejects a duplicate category name', async () => {
    prisma.medicineCategory.findFirst.mockResolvedValue({ id: 'c1', name: 'Analgesics' });
    await expect(service.create({ name: 'Analgesics' }, 'user-1')).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('UnitsService', () => {
  const prisma = {
    unit: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  };
  const audit = { record: jest.fn() };
  const service = new UnitsService(prisma as never, audit as never);

  beforeEach(() => jest.clearAllMocks());

  it('creates a unit', async () => {
    prisma.unit.findUnique.mockResolvedValue(null);
    prisma.unit.create.mockResolvedValue({ id: 'u1', code: 'TAB', name: 'Tablet', isActive: true });
    const result = await service.create({ code: 'TAB', name: 'Tablet' }, 'user-1');
    expect(result.code).toBe('TAB');
  });

  it('rejects a duplicate unit code', async () => {
    prisma.unit.findUnique.mockResolvedValue({ id: 'u1', code: 'TAB' });
    await expect(service.create({ code: 'TAB', name: 'Tablet' }, 'user-1')).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('MedicinesService', () => {
  const prisma = {
    medicine: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    medicineCategory: { findFirst: jest.fn() },
    unit: { findUnique: jest.fn() },
  };
  const audit = { record: jest.fn() };
  const service = new MedicinesService(prisma as never, audit as never);

  beforeEach(() => jest.clearAllMocks());

  it('creates a medicine when category and unit are active', async () => {
    prisma.medicineCategory.findFirst.mockResolvedValue({ id: 'c1', isActive: true });
    prisma.unit.findUnique.mockResolvedValue({ id: 'u1', isActive: true });
    prisma.medicine.findUnique.mockResolvedValue(null);
    prisma.medicine.findFirst.mockResolvedValue(null);
    prisma.medicine.create.mockResolvedValue({
      id: 'm1',
      name: 'Paracetamol 500mg Tablet',
      sku: 'PARA-500',
      isActive: true,
    });
    const result = await service.create(
      {
        categoryId: '11111111-1111-1111-1111-111111111111',
        unitId: '22222222-2222-2222-2222-222222222222',
        name: 'Paracetamol 500mg Tablet',
        strength: '500mg',
        dosageForm: DosageForm.TABLET,
        sku: 'PARA-500',
        minimumStock: 10,
        reorderQuantity: 50,
      },
      'user-1',
    );
    expect(result.sku).toBe('PARA-500');
  });

  it('rejects a duplicate SKU', async () => {
    prisma.medicineCategory.findFirst.mockResolvedValue({ id: 'c1', isActive: true });
    prisma.unit.findUnique.mockResolvedValue({ id: 'u1', isActive: true });
    prisma.medicine.findUnique.mockResolvedValue({ id: 'm1', sku: 'PARA-500' });
    await expect(
      service.create(
        {
          categoryId: '11111111-1111-1111-1111-111111111111',
          unitId: '22222222-2222-2222-2222-222222222222',
          name: 'Paracetamol 500mg Tablet',
          strength: '500mg',
          dosageForm: DosageForm.TABLET,
          sku: 'PARA-500',
          minimumStock: 10,
          reorderQuantity: 50,
        },
        'user-1',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects a duplicate barcode', async () => {
    prisma.medicineCategory.findFirst.mockResolvedValue({ id: 'c1', isActive: true });
    prisma.unit.findUnique.mockResolvedValue({ id: 'u1', isActive: true });
    prisma.medicine.findUnique.mockResolvedValue(null);
    prisma.medicine.findFirst.mockResolvedValue({ id: 'm2', barcode: '12345678' });
    await expect(
      service.create(
        {
          categoryId: '11111111-1111-1111-1111-111111111111',
          unitId: '22222222-2222-2222-2222-222222222222',
          name: 'Paracetamol 500mg Tablet',
          strength: '500mg',
          dosageForm: DosageForm.TABLET,
          sku: 'PARA-501',
          barcode: '12345678',
          minimumStock: 10,
          reorderQuantity: 50,
        },
        'user-1',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects an inactive category', async () => {
    prisma.medicineCategory.findFirst.mockResolvedValue({ id: 'c1', isActive: false });
    await expect(
      service.create(
        {
          categoryId: '11111111-1111-1111-1111-111111111111',
          unitId: '22222222-2222-2222-2222-222222222222',
          name: 'Paracetamol 500mg Tablet',
          strength: '500mg',
          dosageForm: DosageForm.TABLET,
          sku: 'PARA-502',
          minimumStock: 10,
          reorderQuantity: 50,
        },
        'user-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an inactive unit', async () => {
    prisma.medicineCategory.findFirst.mockResolvedValue({ id: 'c1', isActive: true });
    prisma.unit.findUnique.mockResolvedValue({ id: 'u1', isActive: false });
    await expect(
      service.create(
        {
          categoryId: '11111111-1111-1111-1111-111111111111',
          unitId: '22222222-2222-2222-2222-222222222222',
          name: 'Paracetamol 500mg Tablet',
          strength: '500mg',
          dosageForm: DosageForm.TABLET,
          sku: 'PARA-503',
          minimumStock: 10,
          reorderQuantity: 50,
        },
        'user-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('deactivates a medicine', async () => {
    prisma.medicine.findFirst.mockResolvedValue({ id: 'm1', sku: 'PARA-500', barcode: null, deletedAt: null });
    prisma.medicine.update.mockResolvedValue({ id: 'm1', isActive: false });
    const result = await service.setStatus('m1', false, 'user-1');
    expect(result.status).toBe('INACTIVE');
  });
});

describe('BatchesService', () => {
  const prisma = {
    medicine: { findFirst: jest.fn() },
    medicineBatch: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  };
  const audit = { record: jest.fn() };
  const service = new BatchesService(prisma as never, audit as never);

  beforeEach(() => jest.clearAllMocks());

  it('creates a batch', async () => {
    prisma.medicine.findFirst.mockResolvedValue({ id: 'm1' });
    prisma.medicineBatch.findUnique.mockResolvedValue(null);
    prisma.medicineBatch.create.mockResolvedValue({
      id: 'b1',
      batchNumber: 'P001',
      expiryDate: new Date('2028-01-31'),
    });
    const result = await service.create(
      { medicineId: 'm1', batchNumber: 'P001', expiryDate: '2028-01-31' },
      'user-1',
    );
    expect(result.batchNumber).toBe('P001');
  });

  it('rejects a duplicate batch number for the same medicine', async () => {
    prisma.medicine.findFirst.mockResolvedValue({ id: 'm1' });
    prisma.medicineBatch.findUnique.mockResolvedValue({ id: 'b1' });
    await expect(
      service.create({ medicineId: 'm1', batchNumber: 'P001', expiryDate: '2028-01-31' }, 'user-1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects manufacturing after expiry', async () => {
    prisma.medicine.findFirst.mockResolvedValue({ id: 'm1' });
    await expect(
      service.create(
        {
          medicineId: 'm1',
          batchNumber: 'P002',
          manufacturingDate: '2029-01-01',
          expiryDate: '2028-01-01',
        },
        'user-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
