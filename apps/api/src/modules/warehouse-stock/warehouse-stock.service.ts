import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { IsBooleanString, IsOptional, IsUUID } from 'class-validator';
import type { AuthenticatedUser } from '@mh/shared';
import { assertCanMutateWarehouseStock, expiryStatus, expiryWarningDate } from '../../common/access/access';
import {
  type AdjustmentDirection,
  type AdjustmentReason,
  InventoryTransactionService,
} from '../../common/inventory/inventory-transaction.service';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

export class WarehouseStockQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @IsOptional()
  @IsUUID()
  medicineId?: string;

  @IsOptional()
  @IsBooleanString()
  lowStock?: string;

  @IsOptional()
  @IsBooleanString()
  expired?: string;

  @IsOptional()
  @IsBooleanString()
  expiringSoon?: string;

  @IsOptional()
  @IsBooleanString()
  outOfStock?: string;
}

@Injectable()
export class WarehouseStockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventoryTx: InventoryTransactionService,
    private readonly settings: SettingsService,
  ) {}

  async list(query: WarehouseStockQueryDto) {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const warning = expiryWarningDate(await this.settings.getExpiryWarningDays());

    const where: Prisma.WarehouseStockWhereInput = {
      ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
      ...(query.medicineId ? { medicineId: query.medicineId } : {}),
      ...(query.search
        ? {
            OR: [
              { medicine: { name: { contains: query.search, mode: 'insensitive' } } },
              { medicine: { sku: { contains: query.search, mode: 'insensitive' } } },
              { batch: { batchNumber: { contains: query.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
      ...(query.expired === 'true' ? { batch: { expiryDate: { lt: today } } } : {}),
      ...(query.expiringSoon === 'true'
        ? { batch: { expiryDate: { gte: today, lte: warning } } }
        : {}),
      ...(query.outOfStock === 'true' ? { quantity: { lte: 0 } } : {}),
    };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.warehouseStock.count({ where }),
      this.prisma.warehouseStock.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: [{ medicine: { name: 'asc' } }, { batch: { expiryDate: 'asc' } }],
        include: {
          medicine: { include: { unit: true, category: true } },
          batch: true,
          warehouse: true,
        },
      }),
    ]);

    // Medicine-level totals for low-stock comparison (sum across batches)
    const medicineIds = [...new Set(items.map((row) => row.medicineId))];
    const totals = medicineIds.length
      ? await this.prisma.warehouseStock.groupBy({
          by: ['medicineId'],
          where: {
            medicineId: { in: medicineIds },
            ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
          },
          _sum: { quantity: true },
        })
      : [];
    const totalByMedicine = new Map(totals.map((row) => [row.medicineId, row._sum.quantity ?? 0]));

    const lastMovements = medicineIds.length
      ? await this.prisma.stockMovement.findMany({
          where: {
            locationType: 'WAREHOUSE',
            medicineId: { in: medicineIds },
            ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
          },
          orderBy: { occurredAt: 'desc' },
          distinct: ['medicineId', 'batchId'],
          select: {
            medicineId: true,
            batchId: true,
            occurredAt: true,
            movementType: true,
            quantity: true,
          },
        })
      : [];
    const lastByKey = new Map(
      lastMovements.map((row) => [`${row.medicineId}:${row.batchId}`, row]),
    );

    let mapped = items.map((row) => {
      const exp = expiryStatus(row.batch.expiryDate);
      const medicineTotal = totalByMedicine.get(row.medicineId) ?? 0;
      const stockStatus = this.resolveStockStatus(row.quantity, medicineTotal, row.medicine.minimumStock, exp);
      return {
        ...row,
        expiryStatus: exp,
        medicineTotal,
        stockStatus,
        lastMovement: lastByKey.get(`${row.medicineId}:${row.batchId}`) ?? null,
      };
    });

    if (query.lowStock === 'true') {
      mapped = mapped.filter(
        (row) => row.stockStatus === 'LOW_STOCK' || row.stockStatus === 'OUT_OF_STOCK',
      );
    }

    return {
      items: mapped,
      meta: {
        page: query.page,
        limit: query.limit,
        total: query.lowStock === 'true' ? mapped.length : total,
        totalPages: Math.ceil((query.lowStock === 'true' ? mapped.length : total) / query.limit),
      },
    };
  }

  async medicineDetails(medicineId: string, warehouseId?: string) {
    const medicine = await this.prisma.medicine.findFirst({
      where: { id: medicineId, deletedAt: null },
      include: { category: true, unit: true },
    });
    if (!medicine) {
      throw new NotFoundException('Medicine not found');
    }

    const batches = await this.prisma.warehouseStock.findMany({
      where: {
        medicineId,
        ...(warehouseId ? { warehouseId } : {}),
      },
      include: { batch: true, warehouse: true },
      orderBy: { batch: { expiryDate: 'asc' } },
    });

    const totalQuantity = batches.reduce((sum, row) => sum + row.quantity, 0);
    const movements = await this.prisma.stockMovement.findMany({
      where: {
        medicineId,
        locationType: 'WAREHOUSE',
        ...(warehouseId ? { warehouseId } : {}),
      },
      orderBy: { occurredAt: 'desc' },
      take: 50,
      include: {
        batch: true,
        warehouse: true,
        performedBy: { select: { firstName: true, lastName: true } },
      },
    });

    return {
      medicine,
      totalQuantity,
      stockStatus: this.resolveStockStatus(
        totalQuantity,
        totalQuantity,
        medicine.minimumStock,
        batches.some((row) => expiryStatus(row.batch.expiryDate) === 'EXPIRED')
          ? 'EXPIRED'
          : batches.some((row) => expiryStatus(row.batch.expiryDate) === 'EXPIRING_SOON')
            ? 'EXPIRING_SOON'
            : 'VALID',
      ),
      batches: batches.map((row) => ({
        ...row,
        expiryStatus: expiryStatus(row.batch.expiryDate),
        stockStatus: this.resolveStockStatus(
          row.quantity,
          totalQuantity,
          medicine.minimumStock,
          expiryStatus(row.batch.expiryDate),
        ),
      })),
      movements,
    };
  }

  async adjust(
    user: AuthenticatedUser,
    data: {
      warehouseId: string;
      medicineId: string;
      batchId: string;
      quantity: number;
      direction: AdjustmentDirection;
      reason: AdjustmentReason;
      notes?: string;
    },
  ) {
    assertCanMutateWarehouseStock(user);
    return this.inventoryTx.adjustStock({
      ...data,
      performedById: user.id,
    });
  }

  async markDamaged(
    user: AuthenticatedUser,
    data: {
      warehouseId: string;
      medicineId: string;
      batchId: string;
      quantity: number;
      notes: string;
    },
  ) {
    assertCanMutateWarehouseStock(user);
    if (!data.notes?.trim()) {
      throw new BadRequestException('Damage notes are required');
    }
    return this.inventoryTx.markDamaged({
      ...data,
      performedById: user.id,
    });
  }

  async markExpired(
    user: AuthenticatedUser,
    data: {
      warehouseId: string;
      medicineId: string;
      batchId: string;
      quantity: number;
      notes?: string;
    },
  ) {
    assertCanMutateWarehouseStock(user);
    return this.inventoryTx.markExpired({
      ...data,
      performedById: user.id,
    });
  }

  async summary(warehouseId?: string) {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const warning = expiryWarningDate(await this.settings.getExpiryWarningDays());
    const where = warehouseId ? { warehouseId } : {};

    const [aggregate, medicinesWithStock, expiredRows, expiringRows, outRows] = await Promise.all([
      this.prisma.warehouseStock.aggregate({ where, _sum: { quantity: true }, _count: true }),
      this.prisma.warehouseStock.groupBy({
        by: ['medicineId'],
        where,
        _sum: { quantity: true },
      }),
      this.prisma.warehouseStock.count({
        where: { ...where, batch: { expiryDate: { lt: today } }, quantity: { gt: 0 } },
      }),
      this.prisma.warehouseStock.count({
        where: {
          ...where,
          batch: { expiryDate: { gte: today, lte: warning } },
          quantity: { gt: 0 },
        },
      }),
      this.prisma.warehouseStock.count({ where: { ...where, quantity: { lte: 0 } } }),
    ]);

    const medicineMeta = await this.prisma.medicine.findMany({
      where: { id: { in: medicinesWithStock.map((row) => row.medicineId) } },
      select: { id: true, minimumStock: true },
    });
    const minById = new Map(medicineMeta.map((item) => [item.id, item.minimumStock]));
    const lowStock = medicinesWithStock.filter((row) => {
      const qty = row._sum.quantity ?? 0;
      return qty > 0 && qty <= (minById.get(row.medicineId) ?? 0);
    }).length;
    const outOfStockMedicines = medicinesWithStock.filter(
      (row) => (row._sum.quantity ?? 0) <= 0,
    ).length;

    return {
      totalUnits: aggregate._sum.quantity ?? 0,
      stockLines: aggregate._count,
      medicinesInStock: medicinesWithStock.filter((row) => (row._sum.quantity ?? 0) > 0).length,
      lowStockMedicines: lowStock,
      outOfStockMedicines,
      outOfStockLines: outRows,
      expiringSoonLines: expiringRows,
      expiredLines: expiredRows,
    };
  }

  private resolveStockStatus(
    batchQuantity: number,
    medicineTotal: number,
    minimumStock: number,
    expiry: 'VALID' | 'EXPIRING_SOON' | 'EXPIRED',
  ) {
    if (expiry === 'EXPIRED') return 'EXPIRED';
    if (batchQuantity <= 0 || medicineTotal <= 0) return 'OUT_OF_STOCK';
    if (expiry === 'EXPIRING_SOON') return 'EXPIRING_SOON';
    if (medicineTotal <= minimumStock) return 'LOW_STOCK';
    return 'IN_STOCK';
  }
}
