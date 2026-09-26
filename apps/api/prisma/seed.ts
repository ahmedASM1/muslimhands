import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { PERMISSION_DEFINITIONS, ROLE_DEFINITIONS, RoleCode } from '@mh/shared';

const prisma = new PrismaClient();

async function seedPermissions() {
  for (const permission of PERMISSION_DEFINITIONS) {
    await prisma.permission.upsert({
      where: { code: permission.code },
      update: {
        name: permission.name,
        description: permission.description,
        resource: permission.resource,
        action: permission.action,
      },
      create: {
        code: permission.code,
        name: permission.name,
        description: permission.description,
        resource: permission.resource,
        action: permission.action,
      },
    });
  }
}

async function seedRoles() {
  const permissions = await prisma.permission.findMany();
  const permissionByCode = new Map(permissions.map((item) => [item.code, item.id]));

  for (const role of ROLE_DEFINITIONS) {
    const saved = await prisma.role.upsert({
      where: { code: role.code },
      update: {
        name: role.name,
        description: role.description,
        isSystem: true,
      },
      create: {
        code: role.code,
        name: role.name,
        description: role.description,
        isSystem: true,
      },
    });

    const wantedIds: string[] = [];
    for (const permissionCode of role.permissions) {
      const permissionId = permissionByCode.get(permissionCode);
      if (!permissionId) {
        throw new Error(`Missing permission ${permissionCode}`);
      }
      wantedIds.push(permissionId);

      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: saved.id,
            permissionId,
          },
        },
        update: {},
        create: {
          roleId: saved.id,
          permissionId,
        },
      });
    }

    await prisma.rolePermission.deleteMany({
      where: {
        roleId: saved.id,
        permissionId: { notIn: wantedIds },
      },
    });
  }
}

async function seedUnits() {
  const units = [
    { code: 'TAB', name: 'Tablet', description: 'Solid oral tablet' },
    { code: 'CAP', name: 'Capsule', description: 'Solid oral capsule' },
    { code: 'BTL', name: 'Bottle', description: 'Liquid or multi-dose bottle' },
    { code: 'VIAL', name: 'Vial', description: 'Injectable vial' },
    { code: 'AMP', name: 'Ampoule', description: 'Single-use ampoule' },
    { code: 'TUBE', name: 'Tube', description: 'Cream or ointment tube' },
    { code: 'BOX', name: 'Box', description: 'Outer box' },
    { code: 'PACK', name: 'Pack', description: 'Pack of units' },
    { code: 'PIECE', name: 'Piece', description: 'Individual piece' },
    { code: 'UNIT', name: 'Unit', description: 'Generic unit' },
  ];

  for (const unit of units) {
    await prisma.unit.upsert({
      where: { code: unit.code },
      update: { name: unit.name, description: unit.description, isActive: true },
      create: unit,
    });
  }
}

async function seedOrganization() {
  return prisma.organization.upsert({
    where: { code: 'ORG-001' },
    update: { name: 'Medicine Distribution Organization' },
    create: {
      code: 'ORG-001',
      name: 'Medicine Distribution Organization',
    },
  });
}

async function seedLocations() {
  const organization = await seedOrganization();

  await prisma.warehouse.upsert({
    where: { code: 'WH-CENTRAL' },
    update: { name: 'Central Warehouse', organizationId: organization.id, location: 'Central depot' },
    create: {
      organizationId: organization.id,
      code: 'WH-CENTRAL',
      name: 'Central Warehouse',
      location: 'Central depot',
    },
  });

  await prisma.pharmacy.upsert({
    where: { code: 'PHA-001' },
    update: { name: 'Al-Amal Pharmacy', slug: 'al-amal', organizationId: organization.id },
    create: {
      organizationId: organization.id,
      code: 'PHA-001',
      slug: 'al-amal',
      name: 'Al-Amal Pharmacy',
      location: 'City Centre',
    },
  });

  await prisma.pharmacy.upsert({
    where: { code: 'PHA-002' },
    update: { name: 'Al-Noor Pharmacy', slug: 'al-noor', organizationId: organization.id },
    create: {
      organizationId: organization.id,
      code: 'PHA-002',
      slug: 'al-noor',
      name: 'Al-Noor Pharmacy',
      location: 'North District',
    },
  });
}

async function seedAdmin() {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;

  if (!email || !password) {
    console.warn('SEED_ADMIN_EMAIL or SEED_ADMIN_PASSWORD is not set; skipping admin user seed.');
    return;
  }

  const role = await prisma.role.findUnique({
    where: { code: RoleCode.SUPER_ADMIN },
  });

  if (!role) {
    throw new Error('SUPER_ADMIN role was not seeded');
  }

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const organization = await seedOrganization();

  const user = await prisma.user.upsert({
    where: { email: email.toLowerCase() },
    update: {
      firstName: 'System',
      lastName: 'Administrator',
      status: 'ACTIVE',
      deletedAt: null,
      organizationId: organization.id,
    },
    create: {
      email: email.toLowerCase(),
      passwordHash,
      firstName: 'System',
      lastName: 'Administrator',
      status: 'ACTIVE',
      organizationId: organization.id,
    },
  });

  await prisma.userRole.upsert({
    where: {
      userId_roleId: {
        userId: user.id,
        roleId: role.id,
      },
    },
    update: {},
    create: {
      userId: user.id,
      roleId: role.id,
    },
  });
}

async function seedDemoUsers() {
  /**
   * DEVELOPMENT CREDENTIALS ONLY — never use these in production.
   * Password for every demo user: SEED_ADMIN_PASSWORD or ChangeMeNow!
   *
   * SUPER_ADMIN:           SEED_ADMIN_EMAIL (admin@localhost.local)
   * WAREHOUSE_MANAGER:     warehouse.manager@localhost.local  (Ali)
   * WAREHOUSE_STAFF:       warehouse.staff1@localhost.local
   * PHARMACY_MANAGER:      amal.manager@localhost.local       (Ahmed / Al-Amal)
   * PHARMACY_STAFF:        amal.staff1@localhost.local        (Mohammed / Al-Amal)
   * PHARMACY_STAFF:        amal.staff2@localhost.local        (Al-Amal)
   * PHARMACY_MANAGER:      noor.manager@localhost.local       (Al-Noor)
   * PHARMACY_STAFF:        noor.staff1@localhost.local        (Al-Noor)
   * REPORT_VIEWER:         reports.viewer@localhost.local
   */
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMeNow!';
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const organization = await seedOrganization();
  const warehouse = await prisma.warehouse.findUnique({ where: { code: 'WH-CENTRAL' } });
  const amal = await prisma.pharmacy.findUnique({ where: { code: 'PHA-001' } });
  const noor = await prisma.pharmacy.findUnique({ where: { code: 'PHA-002' } });
  const roles = await prisma.role.findMany();
  const role = (code: string) => roles.find((item) => item.code === code)?.id;
  if (!warehouse || !amal || !noor) return;

  const demoUsers = [
    {
      email: 'warehouse.manager@localhost.local',
      firstName: 'Ali',
      lastName: 'Hassan',
      role: RoleCode.WAREHOUSE_MANAGER,
      warehouseId: warehouse.id,
    },
    {
      email: 'warehouse.staff1@localhost.local',
      firstName: 'Omar',
      lastName: 'Saleh',
      role: RoleCode.WAREHOUSE_STAFF,
      warehouseId: warehouse.id,
    },
    {
      email: 'amal.manager@localhost.local',
      firstName: 'Ahmed',
      lastName: 'Al-Amal',
      role: RoleCode.PHARMACY_MANAGER,
      pharmacyId: amal.id,
    },
    {
      email: 'amal.staff1@localhost.local',
      firstName: 'Mohammed',
      lastName: 'Nabil',
      role: RoleCode.PHARMACY_STAFF,
      pharmacyId: amal.id,
    },
    {
      email: 'amal.staff2@localhost.local',
      firstName: 'Sara',
      lastName: 'Karim',
      role: RoleCode.PHARMACY_STAFF,
      pharmacyId: amal.id,
    },
    {
      email: 'noor.manager@localhost.local',
      firstName: 'Mona',
      lastName: 'Al-Noor',
      role: RoleCode.PHARMACY_MANAGER,
      pharmacyId: noor.id,
    },
    {
      email: 'noor.staff1@localhost.local',
      firstName: 'Khaled',
      lastName: 'Noor',
      role: RoleCode.PHARMACY_STAFF,
      pharmacyId: noor.id,
    },
    {
      email: 'reports.viewer@localhost.local',
      firstName: 'Rami',
      lastName: 'Viewer',
      role: RoleCode.REPORT_VIEWER,
      pharmacyId: undefined,
      warehouseId: undefined,
    },
  ];

  for (const item of demoUsers) {
    const roleId = role(item.role);
    if (!roleId) continue;
    const user = await prisma.user.upsert({
      where: { email: item.email },
      update: {
        firstName: item.firstName,
        lastName: item.lastName,
        status: 'ACTIVE',
        organizationId: organization.id,
        pharmacyId: item.pharmacyId ?? null,
        warehouseId: item.warehouseId ?? null,
      },
      create: {
        email: item.email,
        passwordHash,
        firstName: item.firstName,
        lastName: item.lastName,
        organizationId: organization.id,
        pharmacyId: item.pharmacyId ?? null,
        warehouseId: item.warehouseId ?? null,
      },
    });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId } },
      update: {},
      create: { userId: user.id, roleId },
    });
  }
}

async function seedCatalogAndStock() {
  /**
   * DEVELOPMENT catalog only. These examples are not formulary recommendations.
   */
  const unit = async (code: string) =>
    (await prisma.unit.findUnique({ where: { code } }))!;
  const categoryNames = [
    'Analgesics',
    'Antibiotics',
    'Antihistamines',
    'Gastrointestinal',
    'Vitamins',
    'Cardiovascular',
    'Respiratory',
    'Medical Supplies',
  ];
  const categories = await Promise.all(
    categoryNames.map((name) =>
      prisma.medicineCategory.upsert({
        where: { name },
        update: { isActive: true },
        create: { name, description: `Development category: ${name}` },
      }),
    ),
  );

  const tab = await unit('TAB');
  const cap = await unit('CAP');
  const btl = await unit('BTL');
  const vial = await unit('VIAL');
  const tube = await unit('TUBE');
  const piece = await unit('PIECE');

  const medicines = [
    { name: 'Paracetamol 500mg Tablet', genericName: 'Paracetamol', strength: '500mg', dosageForm: 'TABLET' as const, sku: 'PARA-500', min: 100, reorder: 1000, category: 0, unit: tab, value: 0.1 },
    { name: 'Ibuprofen 400mg Tablet', genericName: 'Ibuprofen', strength: '400mg', dosageForm: 'TABLET' as const, sku: 'IBU-400', min: 80, reorder: 500, category: 0, unit: tab, value: 0.15 },
    { name: 'Amoxicillin 500mg Capsule', genericName: 'Amoxicillin', strength: '500mg', dosageForm: 'CAPSULE' as const, sku: 'AMOX-500', min: 60, reorder: 400, category: 1, unit: cap, value: 0.25 },
    { name: 'Azithromycin 250mg Tablet', genericName: 'Azithromycin', strength: '250mg', dosageForm: 'TABLET' as const, sku: 'AZI-250', min: 40, reorder: 200, category: 1, unit: tab, value: 0.4 },
    { name: 'Ceftriaxone 1g Vial', genericName: 'Ceftriaxone', strength: '1g', dosageForm: 'INJECTION' as const, sku: 'CEF-1G', min: 20, reorder: 80, category: 1, unit: vial, value: 1.2 },
    { name: 'Metronidazole 400mg Tablet', genericName: 'Metronidazole', strength: '400mg', dosageForm: 'TABLET' as const, sku: 'MET-400', min: 50, reorder: 300, category: 1, unit: tab, value: 0.12 },
    { name: 'Cetirizine 10mg Tablet', genericName: 'Cetirizine', strength: '10mg', dosageForm: 'TABLET' as const, sku: 'CET-10', min: 40, reorder: 200, category: 2, unit: tab, value: 0.08 },
    { name: 'Loratadine 10mg Tablet', genericName: 'Loratadine', strength: '10mg', dosageForm: 'TABLET' as const, sku: 'LOR-10', min: 40, reorder: 200, category: 2, unit: tab, value: 0.09 },
    { name: 'Omeprazole 20mg Capsule', genericName: 'Omeprazole', strength: '20mg', dosageForm: 'CAPSULE' as const, sku: 'OME-20', min: 50, reorder: 300, category: 3, unit: cap, value: 0.18 },
    { name: 'ORS Sachet', genericName: 'Oral Rehydration Salts', strength: '20.5g', dosageForm: 'POWDER' as const, sku: 'ORS-20', min: 100, reorder: 800, category: 3, unit: piece, value: 0.2 },
    { name: 'Vitamin C 500mg Tablet', genericName: 'Ascorbic acid', strength: '500mg', dosageForm: 'TABLET' as const, sku: 'VITC-500', min: 80, reorder: 400, category: 4, unit: tab, value: 0.05 },
    { name: 'Vitamin D3 1000 IU Tablet', genericName: 'Cholecalciferol', strength: '1000 IU', dosageForm: 'TABLET' as const, sku: 'VITD-1000', min: 40, reorder: 200, category: 4, unit: tab, value: 0.06 },
    { name: 'Folic Acid 5mg Tablet', genericName: 'Folic acid', strength: '5mg', dosageForm: 'TABLET' as const, sku: 'FOL-5', min: 60, reorder: 300, category: 4, unit: tab, value: 0.04 },
    { name: 'Iron + Folate Tablet', genericName: 'Ferrous sulfate', strength: '200mg', dosageForm: 'TABLET' as const, sku: 'IRON-200', min: 60, reorder: 300, category: 4, unit: tab, value: 0.07 },
    { name: 'Metformin 500mg Tablet', genericName: 'Metformin', strength: '500mg', dosageForm: 'TABLET' as const, sku: 'METF-500', min: 80, reorder: 400, category: 5, unit: tab, value: 0.05 },
    { name: 'Amlodipine 5mg Tablet', genericName: 'Amlodipine', strength: '5mg', dosageForm: 'TABLET' as const, sku: 'AMLO-5', min: 40, reorder: 200, category: 5, unit: tab, value: 0.07 },
    { name: 'Salbutamol 100mcg Inhaler', genericName: 'Salbutamol', strength: '100mcg', dosageForm: 'INHALER' as const, sku: 'SAL-100', min: 15, reorder: 40, category: 6, unit: btl, value: 2.5 },
    { name: 'Hydrocortisone Cream 1%', genericName: 'Hydrocortisone', strength: '1%', dosageForm: 'CREAM' as const, sku: 'HYD-1', min: 20, reorder: 60, category: 7, unit: tube, value: 0.9 },
  ];

  const created = [];
  for (const item of medicines) {
    created.push(
      await prisma.medicine.upsert({
        where: { sku: item.sku },
        update: {
          name: item.name,
          genericName: item.genericName,
          strength: item.strength,
          dosageForm: item.dosageForm,
          minimumStock: item.min,
          reorderQuantity: item.reorder,
          referenceValue: item.value,
          categoryId: categories[item.category]!.id,
          unitId: item.unit.id,
          isActive: true,
        },
        create: {
          name: item.name,
          genericName: item.genericName,
          strength: item.strength,
          dosageForm: item.dosageForm,
          sku: item.sku,
          minimumStock: item.min,
          reorderQuantity: item.reorder,
          referenceValue: item.value,
          categoryId: categories[item.category]!.id,
          unitId: item.unit.id,
        },
      }),
    );
  }

  for (const [index, medicine] of created.entries()) {
    // Friendly demo batch codes for key medicines (P001 / A001 / V001 style).
    const shortPrefix =
      medicine.sku === 'PARA-500'
        ? 'P'
        : medicine.sku === 'AMOX-500'
          ? 'A'
          : medicine.sku === 'VITD-1000'
            ? 'V'
            : medicine.sku.split('-')[0]!.slice(0, 3);
    const lots = [
      {
        batchNumber: medicine.sku === 'PARA-500' ? 'P001' : medicine.sku === 'AMOX-500' ? 'A001' : medicine.sku === 'VITD-1000' ? 'V001' : `${shortPrefix}001`,
        manufacturingDate: new Date('2025-06-01'),
        expiryDate: new Date('2028-09-30'),
      },
      {
        batchNumber: medicine.sku === 'PARA-500' ? 'P002' : medicine.sku === 'AMOX-500' ? 'A002' : medicine.sku === 'VITD-1000' ? 'V002' : `${shortPrefix}002`,
        manufacturingDate: new Date('2025-09-01'),
        expiryDate: new Date('2026-11-15'),
      },
      {
        batchNumber: medicine.sku === 'PARA-500' ? 'P003' : `${shortPrefix}003`,
        manufacturingDate: new Date('2024-01-01'),
        // Mix of expiring-soon and already-expired demo batches.
        expiryDate: new Date(index % 4 === 0 ? '2025-01-15' : index % 3 === 0 ? '2026-04-01' : '2028-01-31'),
      },
    ];
    for (const lot of lots) {
      await prisma.medicineBatch.upsert({
        where: { medicineId_batchNumber: { medicineId: medicine.id, batchNumber: lot.batchNumber } },
        update: lot,
        create: { medicineId: medicine.id, ...lot },
      });
    }
  }

  if ((await prisma.warehouseStock.count()) > 0) {
    return;
  }

  const warehouse = await prisma.warehouse.findUnique({ where: { code: 'WH-CENTRAL' } });
  const amal = await prisma.pharmacy.findUnique({ where: { code: 'PHA-001' } });
  const admin = await prisma.user.findFirst({ where: { email: process.env.SEED_ADMIN_EMAIL?.toLowerCase() } });
  if (!warehouse || !amal || !admin) return;

  const qtyBySku: Record<string, [number, number, number]> = {
    'PARA-500': [1000, 500, 40],
    'AMOX-500': [400, 120, 0],
    'VITD-1000': [250, 80, 15],
    'IBU-400': [90, 40, 0], // near/low stock vs min 80
    'SAL-100': [10, 0, 0], // low stock vs min 15
  };

  for (const [index, medicine] of created.entries()) {
    const batches = await prisma.medicineBatch.findMany({
      where: { medicineId: medicine.id },
      orderBy: { batchNumber: 'asc' },
    });
    const [q1, q2, q3] = qtyBySku[medicine.sku] ?? [800 + index * 20, 400, index % 4 === 0 ? 25 : 0];
    const quantities = [q1, q2, q3];
    for (const [batchIndex, batch] of batches.entries()) {
      const quantity = quantities[batchIndex] ?? 0;
      if (quantity <= 0 && batchIndex > 0) continue;
      await prisma.warehouseStock.create({
        data: {
          warehouseId: warehouse.id,
          medicineId: medicine.id,
          batchId: batch!.id,
          quantity: quantity > 0 ? quantity : batchIndex === 0 ? 50 : 0,
        },
      });
      if (quantity > 0 || batchIndex === 0) {
        await prisma.stockMovement.create({
          data: {
            movementType: 'RECEIPT',
            locationType: 'WAREHOUSE',
            warehouseId: warehouse.id,
            medicineId: medicine.id,
            batchId: batch!.id,
            quantity: quantity > 0 ? quantity : 50,
            balanceAfter: quantity > 0 ? quantity : 50,
            referenceType: 'STOCK_RECEIPT',
            performedById: admin.id,
            reason: 'Development seed receipt',
          },
        });
      }
    }

    const primary = batches[0];
    if (primary) {
      await prisma.pharmacyStock.create({
        data: {
          pharmacyId: amal.id,
          medicineId: medicine.id,
          batchId: primary.id,
          quantity: 80 + index * 5,
        },
      });
      await prisma.stockMovement.create({
        data: {
          movementType: 'TRANSFER_IN',
          locationType: 'PHARMACY',
          pharmacyId: amal.id,
          medicineId: medicine.id,
          batchId: primary.id,
          quantity: 80 + index * 5,
          balanceAfter: 80 + index * 5,
          performedById: admin.id,
        },
      });
    }
  }

  // Example adjustment / damage / expiry movements for audit trail demos.
  const para = created.find((item) => item.sku === 'PARA-500');
  if (para) {
    const p001 = await prisma.medicineBatch.findFirst({
      where: { medicineId: para.id, batchNumber: 'P001' },
    });
    const p003 = await prisma.medicineBatch.findFirst({
      where: { medicineId: para.id, batchNumber: 'P003' },
    });
    if (p001) {
      const stock = await prisma.warehouseStock.findUnique({
        where: { warehouseId_batchId: { warehouseId: warehouse.id, batchId: p001.id } },
      });
      if (stock && stock.quantity >= 20) {
        await prisma.warehouseStock.update({
          where: { id: stock.id },
          data: { quantity: stock.quantity - 20 },
        });
        await prisma.stockMovement.create({
          data: {
            movementType: 'DAMAGE',
            locationType: 'WAREHOUSE',
            warehouseId: warehouse.id,
            medicineId: para.id,
            batchId: p001.id,
            quantity: -20,
            balanceAfter: stock.quantity - 20,
            referenceType: 'DAMAGE',
            reason: 'Damaged packaging — development seed',
            performedById: admin.id,
          },
        });
      }
    }
    if (p003) {
      const stock = await prisma.warehouseStock.findUnique({
        where: { warehouseId_batchId: { warehouseId: warehouse.id, batchId: p003.id } },
      });
      if (stock && stock.quantity > 0) {
        await prisma.warehouseStock.update({
          where: { id: stock.id },
          data: { quantity: 0 },
        });
        await prisma.stockMovement.create({
          data: {
            movementType: 'EXPIRED',
            locationType: 'WAREHOUSE',
            warehouseId: warehouse.id,
            medicineId: para.id,
            batchId: p003.id,
            quantity: -stock.quantity,
            balanceAfter: 0,
            referenceType: 'EXPIRY',
            reason: 'Expired lot removed from available stock — development seed',
            performedById: admin.id,
          },
        });
      }
    }
  }

  const beneficiaries = [
    { beneficiaryNumber: 'BN-0001', name: 'Anonymous walk-in', notes: 'Development seed' },
    { beneficiaryNumber: 'BN-0002', name: 'Fatima Al-Hassan', phone: '+970500000001', gender: 'FEMALE' as const },
    { beneficiaryNumber: 'BN-0003', name: 'Omar Khalil', phone: '+970500000002', gender: 'MALE' as const },
    { beneficiaryNumber: 'BN-0004', name: 'Amina Saleh', phone: '+970500000003', externalReference: 'EXT-AMINA' },
    { beneficiaryNumber: 'BN-0005', name: 'Yusuf Nasser', phone: '+970500000004' },
    { beneficiaryNumber: 'BN-0006', name: 'Layla Mahmoud', phone: '+970500000005' },
    { beneficiaryNumber: 'BN-0007', name: 'Hassan Ibrahim', phone: '+970500000006' },
    {
      beneficiaryNumber: 'BN-0008',
      name: 'Inactive beneficiary',
      phone: '+970500000099',
      notes: 'Deactivated for development filtering',
      isActive: false,
    },
  ];

  for (const row of beneficiaries) {
    await prisma.beneficiary.upsert({
      where: { beneficiaryNumber: row.beneficiaryNumber },
      update: {
        name: row.name,
        phone: row.phone ?? null,
        notes: row.notes ?? null,
        isActive: row.isActive ?? true,
        externalReference: row.externalReference ?? null,
      },
      create: {
        beneficiaryNumber: row.beneficiaryNumber,
        name: row.name,
        phone: row.phone ?? null,
        notes: row.notes ?? null,
        isActive: row.isActive ?? true,
        gender: row.gender ?? 'UNSPECIFIED',
        externalReference: row.externalReference ?? null,
      },
    });
  }
}

async function seedOperationalHistory() {
  const hasSeedDispensing = await prisma.dispensingRecord.findFirst({
    where: { recordNumber: { in: ['DSP-SEED-001', 'DSP-SEED-FEFO'] } },
  });
  const hasSeedRequests = await prisma.supplyRequest.findFirst({
    where: { requestNumber: { startsWith: 'SR-SEED' } },
  });
  if (hasSeedDispensing && hasSeedRequests) {
    return;
  }

  const warehouse = await prisma.warehouse.findUnique({ where: { code: 'WH-CENTRAL' } });
  const amal = await prisma.pharmacy.findUnique({ where: { code: 'PHA-001' } });
  const admin = await prisma.user.findFirst({ where: { email: process.env.SEED_ADMIN_EMAIL?.toLowerCase() } });
  const manager = await prisma.user.findUnique({ where: { email: 'amal.manager@localhost.local' } });
  const staff = await prisma.user.findUnique({ where: { email: 'amal.staff1@localhost.local' } });
  const warehouseManager = await prisma.user.findUnique({ where: { email: 'warehouse.manager@localhost.local' } });
  const medicines = await prisma.medicine.findMany({ take: 5, include: { batches: true } });
  if (!warehouse || !amal || !admin || !manager || medicines.length === 0) return;

  const first = medicines[0]!;
  const batch = first.batches[0];
  if (!batch) return;

  await prisma.stockReceipt.create({
    data: {
      receiptNumber: 'RCV-SEED-001',
      warehouseId: warehouse.id,
      supplierName: 'Development procurement',
      receivedAt: new Date(),
      status: 'POSTED',
      postedAt: new Date(),
      createdById: admin.id,
      postedById: admin.id,
      notes: 'Development seed receipt',
      items: {
        create: medicines.slice(0, 3).flatMap((medicine, index) =>
          medicine.batches[0]
            ? [
                {
                  medicineId: medicine.id,
                  batchId: medicine.batches[0].id,
                  quantity: 200 + index * 10,
                  unitCost: 0.1,
                },
              ]
            : [],
        ),
      },
    },
  });

  await prisma.supplyRequest.create({
    data: {
      requestNumber: 'SR-SEED-DRAFT',
      warehouseId: warehouse.id,
      pharmacyId: amal.id,
      createdById: manager.id,
      status: 'DRAFT',
      notes: 'Development draft request',
      items: {
        create: [{ medicineId: first.id, requestedQty: 150 }],
      },
    },
  });

  await prisma.supplyRequest.create({
    data: {
      requestNumber: 'SR-SEED-001',
      warehouseId: warehouse.id,
      pharmacyId: amal.id,
      createdById: manager.id,
      status: 'SUBMITTED',
      submittedAt: new Date(),
      notes: 'Development submitted request',
      items: {
        create: [{ medicineId: first.id, requestedQty: 200 }],
      },
    },
  });

  await prisma.supplyRequest.create({
    data: {
      requestNumber: 'SR-SEED-002',
      warehouseId: warehouse.id,
      pharmacyId: amal.id,
      createdById: manager.id,
      status: 'APPROVED',
      submittedAt: new Date(),
      reviewedAt: new Date(),
      reviewedById: warehouseManager?.id ?? admin.id,
      notes: 'Development approved request',
      items: {
        create: [
          {
            medicineId: medicines[1]?.id ?? first.id,
            requestedQty: 100,
            approvedQty: 80,
          },
        ],
      },
    },
  });

  await prisma.supplyRequest.create({
    data: {
      requestNumber: 'SR-SEED-003',
      warehouseId: warehouse.id,
      pharmacyId: amal.id,
      createdById: manager.id,
      status: 'REJECTED',
      submittedAt: new Date(),
      reviewedAt: new Date(),
      reviewedById: warehouseManager?.id ?? admin.id,
      rejectionReason: 'Insufficient warehouse allocation this week — development seed',
      notes: 'Development rejected request',
      items: {
        create: [{ medicineId: medicines[2]?.id ?? first.id, requestedQty: 60 }],
      },
    },
  });

  const creatorId = warehouseManager?.id ?? admin.id;
  const second = medicines[1];
  const secondBatch = second?.batches[0];

  await prisma.stockTransfer.create({
    data: {
      transferNumber: 'TR-SEED-DRAFT',
      warehouseId: warehouse.id,
      pharmacyId: amal.id,
      createdById: creatorId,
      status: 'DRAFT',
      notes: 'Development draft transfer',
      items: {
        create: [{ medicineId: first.id, batchId: batch.id, quantity: 25 }],
      },
    },
  });

  await prisma.stockTransfer.create({
    data: {
      transferNumber: 'TR-SEED-PREP',
      warehouseId: warehouse.id,
      pharmacyId: amal.id,
      createdById: creatorId,
      preparedById: creatorId,
      preparedAt: new Date(),
      status: 'PREPARED',
      notes: 'Development prepared transfer',
      items: {
        create: [
          {
            medicineId: second?.id ?? first.id,
            batchId: secondBatch?.id ?? batch.id,
            quantity: 20,
          },
        ],
      },
    },
  });

  await prisma.stockTransfer.create({
    data: {
      transferNumber: 'TR-SEED-SHIP',
      warehouseId: warehouse.id,
      pharmacyId: amal.id,
      createdById: creatorId,
      preparedById: creatorId,
      shippedById: creatorId,
      preparedAt: new Date(),
      dispatchedAt: new Date(),
      status: 'SHIPPED',
      notes: 'Development shipped transfer awaiting pharmacy receipt',
      items: {
        create: [{ medicineId: first.id, batchId: batch.id, quantity: 40 }],
      },
    },
  });

  // Simulate warehouse deduction for the shipped seed transfer without double-counting pharmacy until receive.
  const shippedStock = await prisma.warehouseStock.findUnique({
    where: { warehouseId_batchId: { warehouseId: warehouse.id, batchId: batch.id } },
  });
  if (shippedStock && shippedStock.quantity >= 40) {
    await prisma.warehouseStock.update({
      where: { id: shippedStock.id },
      data: { quantity: shippedStock.quantity - 40 },
    });
    await prisma.stockMovement.create({
      data: {
        movementType: 'TRANSFER_OUT',
        locationType: 'WAREHOUSE',
        warehouseId: warehouse.id,
        medicineId: first.id,
        batchId: batch.id,
        quantity: -40,
        balanceAfter: shippedStock.quantity - 40,
        referenceType: 'STOCK_TRANSFER',
        performedById: creatorId,
        reason: 'Development seed shipped transfer',
      },
    });
  }

  const beneficiary = await prisma.beneficiary.findUnique({
    where: { beneficiaryNumber: 'BN-0002' },
  });
  if (!beneficiary) return;

  // Ensure multi-batch pharmacy stock for FEFO seed dispensing (earliest expiry first).
  const fefoMedicine = medicines[0]!;
  const earlyBatch = fefoMedicine.batches.find((b) => b.batchNumber.includes('001')) ?? fefoMedicine.batches[0];
  const laterBatch = fefoMedicine.batches.find((b) => b.id !== earlyBatch?.id) ?? fefoMedicine.batches[1];
  if (earlyBatch && laterBatch) {
    for (const [batch, qty] of [
      [earlyBatch, 20],
      [laterBatch, 30],
    ] as const) {
      await prisma.pharmacyStock.upsert({
        where: {
          pharmacyId_batchId: { pharmacyId: amal.id, batchId: batch.id },
        },
        update: { quantity: Math.max(qty as number, 20) },
        create: {
          pharmacyId: amal.id,
          medicineId: fefoMedicine.id,
          batchId: batch.id,
          quantity: qty as number,
        },
      });
    }

    const existingFefo = await prisma.dispensingRecord.findUnique({
      where: { recordNumber: 'DSP-SEED-FEFO' },
    });
    if (!existingFefo) {
      await prisma.$transaction(async (tx) => {
        const takeEarly = 20;
        const takeLater = 20;
        const stockEarly = await tx.pharmacyStock.findUnique({
          where: { pharmacyId_batchId: { pharmacyId: amal.id, batchId: earlyBatch.id } },
        });
        const stockLater = await tx.pharmacyStock.findUnique({
          where: { pharmacyId_batchId: { pharmacyId: amal.id, batchId: laterBatch.id } },
        });
        if (!stockEarly || !stockLater || stockEarly.quantity < takeEarly || stockLater.quantity < takeLater) {
          return;
        }
        const afterEarly = await tx.pharmacyStock.update({
          where: { id: stockEarly.id },
          data: { quantity: { decrement: takeEarly } },
        });
        const afterLater = await tx.pharmacyStock.update({
          where: { id: stockLater.id },
          data: { quantity: { decrement: takeLater } },
        });
        const record = await tx.dispensingRecord.create({
          data: {
            recordNumber: 'DSP-SEED-FEFO',
            pharmacyId: amal.id,
            beneficiaryId: beneficiary.id,
            dispensedById: staff?.id ?? manager.id,
            notes: 'Development FEFO multi-batch dispensing',
            items: {
              create: [
                {
                  medicineId: fefoMedicine.id,
                  batchId: earlyBatch.id,
                  quantity: takeEarly,
                  referenceValue: fefoMedicine.referenceValue ?? 0.1,
                },
                {
                  medicineId: fefoMedicine.id,
                  batchId: laterBatch.id,
                  quantity: takeLater,
                  referenceValue: fefoMedicine.referenceValue ?? 0.1,
                },
              ],
            },
          },
        });
        await tx.stockMovement.createMany({
          data: [
            {
              movementType: 'DISPENSE',
              locationType: 'PHARMACY',
              pharmacyId: amal.id,
              medicineId: fefoMedicine.id,
              batchId: earlyBatch.id,
              quantity: -takeEarly,
              balanceAfter: afterEarly.quantity,
              performedById: staff?.id ?? manager.id,
              referenceType: 'DISPENSING_RECORD',
              referenceId: record.id,
            },
            {
              movementType: 'DISPENSE',
              locationType: 'PHARMACY',
              pharmacyId: amal.id,
              medicineId: fefoMedicine.id,
              batchId: laterBatch.id,
              quantity: -takeLater,
              balanceAfter: afterLater.quantity,
              performedById: staff?.id ?? manager.id,
              referenceType: 'DISPENSING_RECORD',
              referenceId: record.id,
            },
          ],
        });
      });
    }
  }

  const stock = await prisma.pharmacyStock.findFirst({
    where: { pharmacyId: amal.id, medicineId: first.id, quantity: { gt: 10 } },
  });
  if (stock) {
    const qty = 8;
    const existingSimple = await prisma.dispensingRecord.findUnique({
      where: { recordNumber: 'DSP-SEED-001' },
    });
    if (!existingSimple) {
      await prisma.$transaction(async (tx) => {
        const updated = await tx.pharmacyStock.update({
          where: { id: stock.id },
          data: { quantity: { decrement: qty } },
        });
        const record = await tx.dispensingRecord.create({
          data: {
            recordNumber: 'DSP-SEED-001',
            pharmacyId: amal.id,
            beneficiaryId: beneficiary.id,
            dispensedById: staff?.id ?? manager.id,
            notes: 'Development seed dispensing',
            items: {
              create: [
                {
                  medicineId: stock.medicineId,
                  batchId: stock.batchId,
                  quantity: qty,
                  referenceValue: 0.1,
                },
              ],
            },
          },
        });
        await tx.stockMovement.create({
          data: {
            movementType: 'DISPENSE',
            locationType: 'PHARMACY',
            pharmacyId: amal.id,
            medicineId: stock.medicineId,
            batchId: stock.batchId,
            quantity: -qty,
            balanceAfter: updated.quantity,
            performedById: staff?.id ?? manager.id,
            referenceType: 'DISPENSING_RECORD',
            referenceId: record.id,
          },
        });
      });
    }
  }

  const notifyUsers = [admin.id, manager.id, warehouseManager?.id].filter(Boolean) as string[];
  await prisma.notification.createMany({
    data: notifyUsers.flatMap((userId) => [
      {
        userId,
        type: 'LOW_STOCK',
        title: 'Low stock alert',
        message: 'Development seed: review medicines approaching minimum stock.',
      },
      {
        userId,
        type: 'SUPPLY_REQUEST_SUBMITTED',
        title: 'Supply request submitted',
        message: 'SR-SEED-001 is waiting for warehouse review.',
      },
    ]),
  });
}

/**
 * Al-Noor demo inventory via warehouse → ship (TRANSFER_OUT) → receive (TRANSFER_IN).
 * Does NOT invent PharmacyStock without corresponding transfer movements.
 * Idempotent via transfer number TR-SEED-NOOR-DEMO.
 */
async function seedAlNoorReceivedTransfer() {
  const existing = await prisma.stockTransfer.findUnique({
    where: { transferNumber: 'TR-SEED-NOOR-DEMO' },
  });
  if (existing) return;

  const warehouse = await prisma.warehouse.findUnique({ where: { code: 'WH-CENTRAL' } });
  const noor = await prisma.pharmacy.findUnique({ where: { code: 'PHA-002' } });
  const admin = await prisma.user.findFirst({
    where: { email: process.env.SEED_ADMIN_EMAIL?.toLowerCase() },
  });
  const warehouseManager = await prisma.user.findUnique({
    where: { email: 'warehouse.manager@localhost.local' },
  });
  const noorStaff = await prisma.user.findUnique({
    where: { email: 'noor.staff1@localhost.local' },
  });
  if (!warehouse || !noor || !admin) return;

  const actorId = warehouseManager?.id ?? admin.id;
  const receiverId = noorStaff?.id ?? admin.id;
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  /** Single-batch demo targets (SKU → quantity). */
  const singleTargets: Record<string, number> = {
    'AMOX-500': 50,
    'IBU-400': 60,
    'METF-500': 50,
    'LOR-10': 40,
    'CET-10': 40,
    'AMLO-5': 40,
    'FOL-5': 50,
    'IRON-200': 40,
    'MET-400': 40,
  };

  /** FEFO multi-batch targets: earliest expiry first, then later. */
  const fefoTargets: Record<string, [number, number]> = {
    'PARA-500': [20, 80], // total 100
    'OME-20': [20, 30], // total 50
    'AZI-250': [20, 20], // total 40
  };

  const allSkus = [...new Set([...Object.keys(singleTargets), ...Object.keys(fefoTargets)])];
  const medicines = await prisma.medicine.findMany({
    where: { sku: { in: allSkus } },
    include: {
      batches: {
        where: { isActive: true },
        orderBy: { expiryDate: 'asc' },
      },
    },
  });

  async function ensureWarehouseQty(
    medicineId: string,
    batchId: string,
    needed: number,
  ): Promise<void> {
    const whStock = await prisma.warehouseStock.findUnique({
      where: { warehouseId_batchId: { warehouseId: warehouse!.id, batchId } },
    });
    if (whStock && whStock.quantity >= needed) return;

    const topUp = needed - (whStock?.quantity ?? 0);
    if (whStock) {
      await prisma.warehouseStock.update({
        where: { id: whStock.id },
        data: { quantity: { increment: topUp } },
      });
    } else {
      await prisma.warehouseStock.create({
        data: {
          warehouseId: warehouse!.id,
          medicineId,
          batchId,
          quantity: needed,
        },
      });
    }
    await prisma.stockMovement.create({
      data: {
        movementType: 'RECEIPT',
        locationType: 'WAREHOUSE',
        warehouseId: warehouse!.id,
        medicineId,
        batchId,
        quantity: topUp,
        balanceAfter: (whStock?.quantity ?? 0) + topUp,
        referenceType: 'STOCK_RECEIPT',
        performedById: actorId,
        reason: 'Development seed top-up for Al-Noor demo transfer',
      },
    });
  }

  async function ensureFefoBatches(medicine: {
    id: string;
    sku: string;
    batches: Array<{ id: string; batchNumber: string; expiryDate: Date; isActive: boolean }>;
  }) {
    const valid = medicine.batches
      .filter((b) => b.expiryDate >= today)
      .sort((a, b) => a.expiryDate.getTime() - b.expiryDate.getTime());

    let early = valid[0];
    let later = valid.find(
      (b) => early && b.id !== early.id && b.expiryDate.getTime() > early.expiryDate.getTime(),
    );

    if (!early) {
      early = await prisma.medicineBatch.upsert({
        where: {
          medicineId_batchNumber: {
            medicineId: medicine.id,
            batchNumber: `${medicine.sku}-FEFO-A`,
          },
        },
        update: { expiryDate: new Date('2026-11-01'), isActive: true },
        create: {
          medicineId: medicine.id,
          batchNumber: `${medicine.sku}-FEFO-A`,
          manufacturingDate: new Date('2025-06-01'),
          expiryDate: new Date('2026-11-01'),
          isActive: true,
        },
      });
    }
    if (!later) {
      later = await prisma.medicineBatch.upsert({
        where: {
          medicineId_batchNumber: {
            medicineId: medicine.id,
            batchNumber: `${medicine.sku}-FEFO-B`,
          },
        },
        update: { expiryDate: new Date('2027-05-01'), isActive: true },
        create: {
          medicineId: medicine.id,
          batchNumber: `${medicine.sku}-FEFO-B`,
          manufacturingDate: new Date('2025-09-01'),
          expiryDate: new Date('2027-05-01'),
          isActive: true,
        },
      });
    }
    return { early, later };
  }

  const transferItems: Array<{ medicineId: string; batchId: string; quantity: number }> = [];

  for (const medicine of medicines) {
    const fefo = fefoTargets[medicine.sku];
    if (fefo) {
      const { early, later } = await ensureFefoBatches(medicine);
      const [earlyQty, laterQty] = fefo;

      for (const [batch, qty] of [
        [early, earlyQty],
        [later, laterQty],
      ] as const) {
        const current = await prisma.pharmacyStock.findUnique({
          where: { pharmacyId_batchId: { pharmacyId: noor.id, batchId: batch.id } },
        });
        const need = Math.max(0, qty - (current?.quantity ?? 0));
        if (need <= 0) continue;
        await ensureWarehouseQty(medicine.id, batch.id, need);
        transferItems.push({ medicineId: medicine.id, batchId: batch.id, quantity: need });
      }
      continue;
    }

    const target = singleTargets[medicine.sku];
    if (!target) continue;
    const batch =
      medicine.batches.find((b) => b.expiryDate >= today) ??
      (
        await ensureFefoBatches(medicine)
      ).later;

    const currentTotal = await prisma.pharmacyStock.aggregate({
      where: {
        pharmacyId: noor.id,
        medicineId: medicine.id,
        quantity: { gt: 0 },
        batch: { isActive: true, expiryDate: { gte: today } },
      },
      _sum: { quantity: true },
    });
    const need = Math.max(0, target - (currentTotal._sum.quantity ?? 0));
    if (need <= 0) continue;
    await ensureWarehouseQty(medicine.id, batch.id, need);
    transferItems.push({ medicineId: medicine.id, batchId: batch.id, quantity: need });
  }

  // Keep prior OME/AZI seed transferable if only TR-SEED-NOOR-RCV ran with higher qty —
  // still ensure FEFO later batch exists for those SKUs via the loop above.

  if (transferItems.length === 0) {
    // Targets already met (e.g. prior TR-SEED-NOOR-RCV). Record marker transfer.
    await prisma.stockTransfer.create({
      data: {
        transferNumber: 'TR-SEED-NOOR-DEMO',
        warehouseId: warehouse.id,
        pharmacyId: noor.id,
        createdById: actorId,
        preparedById: actorId,
        shippedById: actorId,
        receivedById: receiverId,
        preparedAt: new Date(),
        dispatchedAt: new Date(),
        receivedAt: new Date(),
        status: 'RECEIVED',
        notes: 'Development: Al-Noor demo targets already satisfied — marker only',
      },
    });
    return;
  }

  const transfer = await prisma.stockTransfer.create({
    data: {
      transferNumber: 'TR-SEED-NOOR-DEMO',
      warehouseId: warehouse.id,
      pharmacyId: noor.id,
      createdById: actorId,
      preparedById: actorId,
      shippedById: actorId,
      receivedById: receiverId,
      preparedAt: new Date(),
      dispatchedAt: new Date(),
      receivedAt: new Date(),
      status: 'RECEIVED',
      notes: 'Development: Al-Noor demo stock via ship + receive (FEFO-ready)',
      items: {
        create: transferItems.map((item) => ({
          medicineId: item.medicineId,
          batchId: item.batchId,
          quantity: item.quantity,
          receivedQty: item.quantity,
        })),
      },
    },
  });

  for (const item of transferItems) {
    const whBefore = await prisma.warehouseStock.findUnique({
      where: { warehouseId_batchId: { warehouseId: warehouse.id, batchId: item.batchId } },
    });
    if (!whBefore || whBefore.quantity < item.quantity) {
      throw new Error(`Insufficient warehouse stock for Al-Noor demo batch ${item.batchId}`);
    }
    const whAfter = await prisma.warehouseStock.update({
      where: { id: whBefore.id },
      data: { quantity: { decrement: item.quantity } },
    });
    await prisma.stockMovement.create({
      data: {
        movementType: 'TRANSFER_OUT',
        locationType: 'WAREHOUSE',
        warehouseId: warehouse.id,
        medicineId: item.medicineId,
        batchId: item.batchId,
        quantity: -item.quantity,
        balanceAfter: whAfter.quantity,
        referenceType: 'STOCK_TRANSFER',
        referenceId: transfer.id,
        performedById: actorId,
        reason: 'Development seed ship to Al-Noor (demo)',
      },
    });

    const phAfter = await prisma.pharmacyStock.upsert({
      where: { pharmacyId_batchId: { pharmacyId: noor.id, batchId: item.batchId } },
      update: { quantity: { increment: item.quantity } },
      create: {
        pharmacyId: noor.id,
        medicineId: item.medicineId,
        batchId: item.batchId,
        quantity: item.quantity,
      },
    });
    await prisma.stockMovement.create({
      data: {
        movementType: 'TRANSFER_IN',
        locationType: 'PHARMACY',
        pharmacyId: noor.id,
        medicineId: item.medicineId,
        batchId: item.batchId,
        quantity: item.quantity,
        balanceAfter: phAfter.quantity,
        referenceType: 'STOCK_TRANSFER',
        referenceId: transfer.id,
        performedById: receiverId,
        reason: 'Development seed receive at Al-Noor (demo)',
      },
    });
  }

  // Leave one SHIPPED (not received) transfer so Al-Noor can practice receive.
  const awaiting = await prisma.stockTransfer.findUnique({
    where: { transferNumber: 'TR-SEED-NOOR-SHIP' },
  });
  if (!awaiting && transferItems[0]) {
    const item = transferItems[0];
    const shipOnlyQty = 20;
    await ensureWarehouseQty(item.medicineId, item.batchId, shipOnlyQty);
    const whBefore = await prisma.warehouseStock.findUnique({
      where: { warehouseId_batchId: { warehouseId: warehouse.id, batchId: item.batchId } },
    });
    if (whBefore && whBefore.quantity >= shipOnlyQty) {
      const shipped = await prisma.stockTransfer.create({
        data: {
          transferNumber: 'TR-SEED-NOOR-SHIP',
          warehouseId: warehouse.id,
          pharmacyId: noor.id,
          createdById: actorId,
          preparedById: actorId,
          shippedById: actorId,
          preparedAt: new Date(),
          dispatchedAt: new Date(),
          status: 'SHIPPED',
          notes: 'Development: Al-Noor shipped transfer awaiting pharmacy receipt',
          items: {
            create: [
              {
                medicineId: item.medicineId,
                batchId: item.batchId,
                quantity: shipOnlyQty,
                receivedQty: 0,
              },
            ],
          },
        },
      });
      const whAfter = await prisma.warehouseStock.update({
        where: { id: whBefore.id },
        data: { quantity: { decrement: shipOnlyQty } },
      });
      await prisma.stockMovement.create({
        data: {
          movementType: 'TRANSFER_OUT',
          locationType: 'WAREHOUSE',
          warehouseId: warehouse.id,
          medicineId: item.medicineId,
          batchId: item.batchId,
          quantity: -shipOnlyQty,
          balanceAfter: whAfter.quantity,
          referenceType: 'STOCK_TRANSFER',
          referenceId: shipped.id,
          performedById: actorId,
          reason: 'Development seed ship awaiting Al-Noor receipt',
        },
      });
    }
  }
}

async function main() {
  await seedPermissions();
  await seedRoles();
  await seedUnits();
  await seedLocations();
  await seedAdmin();
  await seedDemoUsers();
  await seedCatalogAndStock();
  await seedOperationalHistory();
  await seedAlNoorReceivedTransfer();
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
