import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction } from '@mh/shared';
import { Prisma } from '@prisma/client';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { expiryStatus } from '../../common/access/access';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { validateBatchDates } from '../catalog/catalog-rules';

export class BatchQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  medicineId?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsEnum(['VALID', 'EXPIRING_SOON', 'EXPIRED'])
  expiryStatus?: 'VALID' | 'EXPIRING_SOON' | 'EXPIRED';
}

@Injectable()
export class BatchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: BatchQueryDto) {
    const where: Prisma.MedicineBatchWhereInput = {
      ...(query.medicineId ? { medicineId: query.medicineId } : {}),
      ...(query.categoryId ? { medicine: { categoryId: query.categoryId } } : {}),
      ...(query.search
        ? {
            OR: [
              { batchNumber: { contains: query.search, mode: 'insensitive' } },
              { medicine: { name: { contains: query.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    if (query.expiryStatus) {
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      const warning = new Date(today);
      warning.setUTCDate(warning.getUTCDate() + 90);
      if (query.expiryStatus === 'EXPIRED') {
        where.expiryDate = { lt: today };
      } else if (query.expiryStatus === 'EXPIRING_SOON') {
        where.expiryDate = { gte: today, lte: warning };
      } else {
        where.expiryDate = { gt: warning };
      }
    }

    const [total, items] = await this.prisma.$transaction([
      this.prisma.medicineBatch.count({ where }),
      this.prisma.medicineBatch.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { expiryDate: query.sortOrder === 'desc' ? 'desc' : 'asc' },
        include: {
          medicine: { select: { id: true, name: true, sku: true, category: { select: { id: true, name: true } } } },
        },
      }),
    ]);

    return {
      items: items.map((batch) => ({
        ...batch,
        expiryStatus: expiryStatus(batch.expiryDate),
      })),
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async get(id: string) {
    const batch = await this.prisma.medicineBatch.findUnique({
      where: { id },
      include: { medicine: { include: { category: true, unit: true } } },
    });
    if (!batch) {
      throw new NotFoundException('Batch not found');
    }
    return { ...batch, expiryStatus: expiryStatus(batch.expiryDate) };
  }

  async create(
    data: {
      medicineId: string;
      batchNumber: string;
      manufacturingDate?: string;
      expiryDate: string;
    },
    userId: string,
  ) {
    const medicine = await this.prisma.medicine.findFirst({
      where: { id: data.medicineId, deletedAt: null },
    });
    if (!medicine) {
      throw new BadRequestException('Medicine not found');
    }
    const manufacturingDate = data.manufacturingDate ? new Date(data.manufacturingDate) : null;
    const expiryDate = new Date(data.expiryDate);
    const dateError = validateBatchDates(manufacturingDate, expiryDate);
    if (dateError) {
      throw new BadRequestException(dateError);
    }
    await this.assertUniqueBatch(data.medicineId, data.batchNumber);

    const batch = await this.prisma.medicineBatch.create({
      data: {
        medicineId: data.medicineId,
        batchNumber: data.batchNumber.trim(),
        manufacturingDate,
        expiryDate,
      },
      include: { medicine: { select: { id: true, name: true, sku: true } } },
    });
    await this.audit.record({
      userId,
      action: AuditAction.CREATE_BATCH,
      entityType: 'MedicineBatch',
      entityId: batch.id,
      newValues: data,
    });
    return { ...batch, expiryStatus: expiryStatus(batch.expiryDate) };
  }

  async update(
    id: string,
    data: { batchNumber?: string; manufacturingDate?: string; expiryDate?: string },
    userId: string,
  ) {
    const existing = await this.prisma.medicineBatch.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Batch not found');
    }
    const manufacturingDate = data.manufacturingDate
      ? new Date(data.manufacturingDate)
      : existing.manufacturingDate;
    const expiryDate = data.expiryDate ? new Date(data.expiryDate) : existing.expiryDate;
    const dateError = validateBatchDates(manufacturingDate, expiryDate);
    if (dateError) {
      throw new BadRequestException(dateError);
    }
    if (data.batchNumber && data.batchNumber.trim() !== existing.batchNumber) {
      await this.assertUniqueBatch(existing.medicineId, data.batchNumber);
    }
    const updated = await this.prisma.medicineBatch.update({
      where: { id },
      data: {
        batchNumber: data.batchNumber?.trim(),
        manufacturingDate: data.manufacturingDate ? new Date(data.manufacturingDate) : undefined,
        expiryDate: data.expiryDate ? new Date(data.expiryDate) : undefined,
      },
      include: { medicine: { select: { id: true, name: true, sku: true } } },
    });
    await this.audit.record({
      userId,
      action: AuditAction.UPDATE_BATCH,
      entityType: 'MedicineBatch',
      entityId: id,
      oldValues: existing,
      newValues: data,
    });
    return { ...updated, expiryStatus: expiryStatus(updated.expiryDate) };
  }

  private async assertUniqueBatch(medicineId: string, batchNumber: string) {
    const existing = await this.prisma.medicineBatch.findUnique({
      where: { medicineId_batchNumber: { medicineId, batchNumber: batchNumber.trim() } },
    });
    if (existing) {
      throw new ConflictException('This medicine already has a batch with that number');
    }
  }
}
