import { Injectable } from '@nestjs/common';
import { RoleCode, type AuthenticatedUser } from '@mh/shared';
import { LocationType, SupplyRequestStatus, TransferStatus } from '@prisma/client';
import { expiryWarningDate, resolvePharmacyId } from '../../common/access/access';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async overview(user: AuthenticatedUser) {
    const pharmacyId = resolvePharmacyId(user);
    const isPharmacy =
      user.roles.includes(RoleCode.PHARMACY_MANAGER) ||
      user.roles.includes(RoleCode.PHARMACY_STAFF);
    const isWarehouse =
      user.roles.includes(RoleCode.SUPER_ADMIN) ||
      user.roles.includes(RoleCode.WAREHOUSE_MANAGER) ||
      user.roles.includes(RoleCode.WAREHOUSE_STAFF);

    if (isPharmacy || pharmacyId) {
      return this.pharmacyOverview(user, pharmacyId);
    }
    if (isWarehouse) {
      return this.warehouseOverview(user);
    }
    return this.generalOverview(user, pharmacyId);
  }

  private async warehouseOverview(user: AuthenticatedUser) {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const warning = expiryWarningDate(await this.settings.getExpiryWarningDays());

    const [
      medicines,
      warehouseStock,
      stockGroups,
      expiredLines,
      expiringSoonLines,
      pendingRequests,
      preparedTransfers,
      shippedTransfers,
      recentReceipts,
      recentMovements,
      recentRequests,
      recentTransfers,
    ] = await Promise.all([
      this.prisma.medicine.count({ where: { deletedAt: null, isActive: true } }),
      this.prisma.warehouseStock.aggregate({ _sum: { quantity: true }, _count: true }),
      this.prisma.warehouseStock.groupBy({ by: ['medicineId'], _sum: { quantity: true } }),
      this.prisma.warehouseStock.count({
        where: { quantity: { gt: 0 }, batch: { expiryDate: { lt: today } } },
      }),
      this.prisma.warehouseStock.count({
        where: {
          quantity: { gt: 0 },
          batch: { expiryDate: { gte: today, lte: warning } },
        },
      }),
      this.prisma.supplyRequest.count({
        where: { status: SupplyRequestStatus.SUBMITTED },
      }),
      this.prisma.stockTransfer.count({ where: { status: TransferStatus.PREPARED } }),
      this.prisma.stockTransfer.count({
        where: { status: { in: [TransferStatus.SHIPPED, TransferStatus.IN_TRANSIT] } },
      }),
      this.prisma.stockReceipt.findMany({
        take: 6,
        orderBy: { createdAt: 'desc' },
        include: {
          createdBy: { select: { firstName: true, lastName: true } },
          items: true,
        },
      }),
      this.prisma.stockMovement.findMany({
        take: 6,
        where: { locationType: LocationType.WAREHOUSE },
        orderBy: { occurredAt: 'desc' },
        include: {
          medicine: true,
          batch: true,
          performedBy: { select: { firstName: true, lastName: true } },
        },
      }),
      this.prisma.supplyRequest.findMany({
        take: 6,
        where: { status: SupplyRequestStatus.SUBMITTED },
        orderBy: { submittedAt: 'desc' },
        include: { pharmacy: true, items: true },
      }),
      this.prisma.stockTransfer.findMany({
        take: 6,
        where: {
          status: {
            in: [TransferStatus.PREPARED, TransferStatus.SHIPPED, TransferStatus.IN_TRANSIT],
          },
        },
        orderBy: { createdAt: 'desc' },
        include: { pharmacy: true },
      }),
    ]);

    const medicineMeta = await this.prisma.medicine.findMany({
      where: { id: { in: stockGroups.map((row) => row.medicineId) } },
      select: { id: true, minimumStock: true },
    });
    const minById = new Map(medicineMeta.map((item) => [item.id, item.minimumStock]));
    const lowStockMedicines = stockGroups.filter((row) => {
      const qty = row._sum.quantity ?? 0;
      return qty > 0 && qty <= (minById.get(row.medicineId) ?? 0);
    }).length;

    return {
      cards: {
        totalMedicines: medicines,
        totalWarehouseUnits: warehouseStock._sum.quantity ?? 0,
        lowStock: lowStockMedicines,
        expiringSoon: expiringSoonLines,
        expired: expiredLines,
        pendingSupplyRequests: pendingRequests,
        preparedTransfers,
        shippedAwaitingReceipt: shippedTransfers,
      },
      recentReceipts: recentReceipts.map((receipt) => ({
        id: receipt.id,
        receiptNumber: receipt.receiptNumber,
        status: receipt.status,
        totalUnits: receipt.items.reduce((sum, item) => sum + item.quantity, 0),
        createdAt: receipt.createdAt,
      })),
      recentMovements: recentMovements.map((movement) => ({
        id: movement.id,
        movementType: movement.movementType,
        quantity: movement.quantity,
        occurredAt: movement.occurredAt,
        medicine: movement.medicine,
        batch: movement.batch,
      })),
      recentRequests,
      recentTransfers,
      recentDispensing: [] as Array<{
        id: string;
        recordNumber: string;
        dispensingNumber: string;
        dispensedAt?: Date;
        beneficiaryNumber?: string;
        itemCount?: number;
      }>,
      emptyStock: (warehouseStock._sum.quantity ?? 0) === 0 && warehouseStock._count === 0,
      context: { role: user.roles.includes(RoleCode.SUPER_ADMIN) ? 'admin' : 'warehouse' },
    };
  }

  private async pharmacyOverview(user: AuthenticatedUser, pharmacyId?: string) {
    const id = pharmacyId ?? user.pharmacyId ?? undefined;
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const warning = expiryWarningDate(await this.settings.getExpiryWarningDays());
    const where = id ? { pharmacyId: id } : {};

    const [
      pharmacyStock,
      groups,
      expiringLines,
      expiredLines,
      pendingRequests,
      awaitingReceipt,
      todayDispensingCount,
      todayBeneficiaryGroups,
      recentRequests,
      recentTransfers,
      recentDispensing,
    ] = await Promise.all([
      this.prisma.pharmacyStock.aggregate({ where, _sum: { quantity: true }, _count: true }),
      this.prisma.pharmacyStock.groupBy({ by: ['medicineId'], where, _sum: { quantity: true } }),
      this.prisma.pharmacyStock.count({
        where: {
          ...where,
          quantity: { gt: 0 },
          batch: { expiryDate: { gte: today, lte: warning } },
        },
      }),
      this.prisma.pharmacyStock.count({
        where: { ...where, quantity: { gt: 0 }, batch: { expiryDate: { lt: today } } },
      }),
      this.prisma.supplyRequest.count({
        where: {
          ...(id ? { pharmacyId: id } : {}),
          status: {
            in: [
              SupplyRequestStatus.DRAFT,
              SupplyRequestStatus.SUBMITTED,
              SupplyRequestStatus.APPROVED,
            ],
          },
        },
      }),
      this.prisma.stockTransfer.count({
        where: {
          ...(id ? { pharmacyId: id } : {}),
          status: { in: [TransferStatus.SHIPPED, TransferStatus.IN_TRANSIT] },
        },
      }),
      this.prisma.dispensingRecord.count({
        where: {
          ...(id ? { pharmacyId: id } : {}),
          dispensedAt: { gte: today, lt: tomorrow },
        },
      }),
      this.prisma.dispensingRecord.groupBy({
        by: ['beneficiaryId'],
        where: {
          ...(id ? { pharmacyId: id } : {}),
          dispensedAt: { gte: today, lt: tomorrow },
        },
      }),
      this.prisma.supplyRequest.findMany({
        take: 6,
        where: id ? { pharmacyId: id } : {},
        orderBy: { createdAt: 'desc' },
        include: { items: true },
      }),
      this.prisma.stockTransfer.findMany({
        take: 6,
        where: {
          ...(id ? { pharmacyId: id } : {}),
          status: { in: [TransferStatus.SHIPPED, TransferStatus.IN_TRANSIT, TransferStatus.RECEIVED] },
        },
        orderBy: { createdAt: 'desc' },
        include: { warehouse: true, items: true },
      }),
      this.prisma.dispensingRecord.findMany({
        take: 6,
        where: id ? { pharmacyId: id } : {},
        orderBy: { dispensedAt: 'desc' },
        include: {
          beneficiary: { select: { beneficiaryNumber: true } },
          items: true,
        },
      }),
    ]);

    const medicines = await this.prisma.medicine.findMany({
      where: { id: { in: groups.map((row) => row.medicineId) } },
      select: { id: true, minimumStock: true },
    });
    const minById = new Map(medicines.map((item) => [item.id, item.minimumStock]));
    const lowStock = groups.filter((row) => {
      const qty = row._sum.quantity ?? 0;
      return qty > 0 && qty <= (minById.get(row.medicineId) ?? 0);
    }).length;

    return {
      cards: {
        todayDispensingCount,
        todayUniqueBeneficiaries: todayBeneficiaryGroups.length,
        lowStockMedicines: lowStock,
        expiringSoon: expiringLines,
        expired: expiredLines,
        pendingSupplyRequests: pendingRequests,
        incomingTransfers: awaitingReceipt,
        pharmacyStockUnits: pharmacyStock._sum.quantity ?? 0,
      },
      recentRequests,
      recentTransfers,
      recentDispensing: recentDispensing.map((row) => ({
        id: row.id,
        recordNumber: row.recordNumber,
        dispensingNumber: row.recordNumber,
        dispensedAt: row.dispensedAt,
        beneficiaryNumber: row.beneficiary?.beneficiaryNumber,
        itemCount: row.items.length,
      })),
      emptyStock: (pharmacyStock._sum.quantity ?? 0) === 0 && pharmacyStock._count === 0,
      context: { role: 'pharmacy' },
    };
  }

  private async generalOverview(user: AuthenticatedUser, pharmacyId?: string) {
    const warning = expiryWarningDate(await this.settings.getExpiryWarningDays());
    const [
      pharmacies,
      medicines,
      warehouseStock,
      pharmacyStock,
      pendingRequests,
      lowStockMedicines,
      recentTransfers,
    ] = await Promise.all([
      this.prisma.pharmacy.count({ where: { deletedAt: null } }),
      this.prisma.medicine.count({ where: { deletedAt: null, isActive: true } }),
      this.prisma.warehouseStock.aggregate({ _sum: { quantity: true } }),
      this.prisma.pharmacyStock.aggregate({
        where: pharmacyId ? { pharmacyId } : {},
        _sum: { quantity: true },
      }),
      this.prisma.supplyRequest.count({
        where: { status: SupplyRequestStatus.SUBMITTED },
      }),
      this.lowStockCount(pharmacyId),
      this.prisma.stockTransfer.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: { pharmacy: true, warehouse: true },
      }),
    ]);

    return {
      cards: {
        totalPharmacies: pharmacies,
        totalMedicines: medicines,
        warehouseStockQuantity: warehouseStock._sum.quantity ?? 0,
        pharmacyStockQuantity: pharmacyStock._sum.quantity ?? 0,
        pendingSupplyRequests: pendingRequests,
        lowStockMedicines,
        expiringBatches: await this.prisma.medicineBatch.count({
          where: { expiryDate: { lte: warning }, isActive: true },
        }),
      },
      recentTransfers,
      recentDispensing: [] as Array<{
        id: string;
        recordNumber: string;
        dispensingNumber?: string;
        dispensedAt?: Date;
        beneficiaryNumber?: string;
        itemCount?: number;
      }>,
      context: { role: 'admin' },
    };
  }

  private async lowStockCount(pharmacyId?: string) {
    if (pharmacyId) {
      const rows = await this.prisma.pharmacyStock.groupBy({
        by: ['medicineId'],
        where: { pharmacyId },
        _sum: { quantity: true },
      });
      const medicines = await this.prisma.medicine.findMany({
        where: { id: { in: rows.map((row) => row.medicineId) } },
        select: { id: true, minimumStock: true },
      });
      const minById = new Map(medicines.map((item) => [item.id, item.minimumStock]));
      return rows.filter((row) => (row._sum.quantity ?? 0) <= (minById.get(row.medicineId) ?? 0)).length;
    }

    const rows = await this.prisma.warehouseStock.groupBy({
      by: ['medicineId'],
      _sum: { quantity: true },
    });
    const medicines = await this.prisma.medicine.findMany({
      where: { id: { in: rows.map((row) => row.medicineId) } },
      select: { id: true, minimumStock: true },
    });
    const minById = new Map(medicines.map((item) => [item.id, item.minimumStock]));
    return rows.filter((row) => (row._sum.quantity ?? 0) <= (minById.get(row.medicineId) ?? 0)).length;
  }
}
