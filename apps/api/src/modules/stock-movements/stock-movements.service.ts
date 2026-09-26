import { ForbiddenException, Injectable } from '@nestjs/common';
import { LocationType, MovementType, Prisma } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator';
import {
  isGlobalViewer,
  isSuperAdmin,
  resolvePharmacyId,
} from '../../common/access/access';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import type { RequestUser } from '../../common/types/authenticated-request';
import { PrismaService } from '../../prisma/prisma.service';

export class StockMovementQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(MovementType)
  movementType?: MovementType;

  @IsOptional()
  @IsUUID()
  medicineId?: string;

  @IsOptional()
  @IsUUID()
  batchId?: string;

  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @IsOptional()
  @IsUUID()
  pharmacyId?: string;

  @IsOptional()
  @IsEnum(LocationType)
  locationType?: LocationType;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}

@Injectable()
export class StockMovementsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: StockMovementQueryDto, user: RequestUser) {
    const pharmacyScoped =
      Boolean(user.pharmacyId) && !isGlobalViewer(user) && !isSuperAdmin(user);

    if (pharmacyScoped) {
      if (query.locationType === LocationType.WAREHOUSE) {
        throw new ForbiddenException('Cannot access warehouse stock movements');
      }
      if (query.pharmacyId && query.pharmacyId !== user.pharmacyId) {
        throw new ForbiddenException('Cannot access another pharmacy');
      }
    }

    const pharmacyId = pharmacyScoped
      ? user.pharmacyId!
      : resolvePharmacyId(user, query.pharmacyId);

    const locationType = pharmacyScoped
      ? LocationType.PHARMACY
      : query.locationType ?? LocationType.WAREHOUSE;

    const where: Prisma.StockMovementWhereInput = {
      ...(query.movementType ? { movementType: query.movementType } : {}),
      ...(query.medicineId ? { medicineId: query.medicineId } : {}),
      ...(query.batchId ? { batchId: query.batchId } : {}),
      ...(query.warehouseId && !pharmacyScoped ? { warehouseId: query.warehouseId } : {}),
      locationType,
      ...(pharmacyId ? { pharmacyId } : {}),
      ...(query.from || query.to
        ? {
            occurredAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
      ...(query.search
        ? {
            OR: [
              { medicine: { name: { contains: query.search, mode: 'insensitive' } } },
              { medicine: { sku: { contains: query.search, mode: 'insensitive' } } },
              { batch: { batchNumber: { contains: query.search, mode: 'insensitive' } } },
              { reason: { contains: query.search, mode: 'insensitive' } },
              { referenceType: { equals: query.search as never } },
            ],
          }
        : {}),
    };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.stockMovement.count({ where }),
      this.prisma.stockMovement.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { occurredAt: 'desc' },
        include: {
          medicine: { include: { unit: true } },
          batch: true,
          warehouse: true,
          pharmacy: true,
          performedBy: { select: { firstName: true, lastName: true, email: true } },
        },
      }),
    ]);

    return {
      items,
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }
}
