import { Injectable, NotFoundException } from '@nestjs/common';
import type { AuthenticatedUser } from '@mh/shared';
import { LocationType, Prisma } from '@prisma/client';
import { IsBooleanString, IsOptional, IsUUID } from 'class-validator';
import { expiryStatus, expiryWarningDate, resolvePharmacyId } from '../../common/access/access';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

export class PharmacyStockQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  pharmacyId?: string;

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
export class PharmacyStockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async list(user: AuthenticatedUser, query: PharmacyStockQueryDto) {
    const pharmacyId = resolvePharmacyId(user, query.pharmacyId);
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const warning = expiryWarningDate(await this.settings.getExpiryWarningDays());

    const where: Prisma.PharmacyStockWhereInput = {
      ...(pharmacyId ? { pharmacyId } : {}),
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
      this.prisma.pharmacyStock.count({ where }),
      this.prisma.pharmacyStock.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: [{ medicine: { name: 'asc' } }, { batch: { expiryDate: 'asc' } }],
        include: {
          medicine: { include: { unit: true, category: true } },
          batch: true,
          pharmacy: true,
        },
      }),
    ]);

    const medicineIds = [...new Set(items.map((row) => row.medicineId))];
    const totals = medicineIds.length
      ? await this.prisma.pharmacyStock.groupBy({
          by: ['medicineId'],
          where: {
            medicineId: { in: medicineIds },
            ...(pharmacyId ? { pharmacyId } : {}),
          },
          _sum: { quantity: true },
        })
      : [];
    const totalByMedicine = new Map(totals.map((row) => [row.medicineId, row._sum.quantity ?? 0]));

    const lastMovements = medicineIds.length
      ? await this.prisma.stockMovement.findMany({
          where: {
            locationType: LocationType.PHARMACY,
            medicineId: { in: medicineIds },
            ...(pharmacyId ? { pharmacyId } : {}),
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
      return {
        ...row,
        expiryStatus: exp,
        medicineTotal,
        stockStatus: this.resolveStockStatus(
          row.quantity,
          medicineTotal,
          row.medicine.minimumStock,
          exp,
        ),
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

  async summary(user: AuthenticatedUser, pharmacyId?: string) {
    const id = resolvePharmacyId(user, pharmacyId);
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const warning = expiryWarningDate(await this.settings.getExpiryWarningDays());
    const where = id ? { pharmacyId: id } : {};

    const [aggregate, groups, expiredLines, expiringLines, pendingTransfers] = await Promise.all([
      this.prisma.pharmacyStock.aggregate({ where, _sum: { quantity: true }, _count: true }),
      this.prisma.pharmacyStock.groupBy({ by: ['medicineId'], where, _sum: { quantity: true } }),
      this.prisma.pharmacyStock.count({
        where: { ...where, quantity: { gt: 0 }, batch: { expiryDate: { lt: today } } },
      }),
      this.prisma.pharmacyStock.count({
        where: {
          ...where,
          quantity: { gt: 0 },
          batch: { expiryDate: { gte: today, lte: warning } },
        },
      }),
      this.prisma.stockTransfer.count({
        where: {
          ...(id ? { pharmacyId: id } : {}),
          status: { in: ['SHIPPED', 'IN_TRANSIT'] },
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
      totalUnits: aggregate._sum.quantity ?? 0,
      stockLines: aggregate._count,
      medicinesInStock: groups.filter((row) => (row._sum.quantity ?? 0) > 0).length,
      lowStockMedicines: lowStock,
      expiringSoonLines: expiringLines,
      expiredLines,
      awaitingReceipt: pendingTransfers,
    };
  }

  async medicineDetails(user: AuthenticatedUser, medicineId: string, pharmacyId?: string) {
    const id = resolvePharmacyId(user, pharmacyId);
    const medicine = await this.prisma.medicine.findFirst({
      where: { id: medicineId, deletedAt: null },
      include: { category: true, unit: true },
    });
    if (!medicine) throw new NotFoundException('Medicine not found');

    const batches = await this.prisma.pharmacyStock.findMany({
      where: { medicineId, ...(id ? { pharmacyId: id } : {}) },
      include: { batch: true, pharmacy: true },
      orderBy: { batch: { expiryDate: 'asc' } },
    });
    const totalQuantity = batches.reduce((sum, row) => sum + row.quantity, 0);
    const movements = await this.prisma.stockMovement.findMany({
      where: {
        medicineId,
        locationType: LocationType.PHARMACY,
        ...(id ? { pharmacyId: id } : {}),
      },
      orderBy: { occurredAt: 'desc' },
      take: 50,
      include: {
        batch: true,
        pharmacy: true,
        performedBy: { select: { firstName: true, lastName: true } },
      },
    });

    return {
      medicine,
      totalQuantity,
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

  /** FEFO-ready query for future dispensing — non-expired, qty > 0, earliest expiry first */
  async fefoBatches(user: AuthenticatedUser, medicineId: string, pharmacyId?: string) {
    const id = resolvePharmacyId(user, pharmacyId);
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    return this.prisma.pharmacyStock.findMany({
      where: {
        medicineId,
        ...(id ? { pharmacyId: id } : {}),
        quantity: { gt: 0 },
        batch: { expiryDate: { gte: today }, isActive: true },
      },
      include: { batch: true, medicine: true },
      orderBy: { batch: { expiryDate: 'asc' } },
    });
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
