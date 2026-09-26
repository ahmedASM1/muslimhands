import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, DosageForm as SharedDosageForm } from '@mh/shared';
import { DosageForm, Prisma } from '@prisma/client';
import { IsBooleanString, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  generateSku,
  isValidBarcode,
  nextSkuCandidate,
  requiresStrength,
  validateMedicineNumbers,
} from '../catalog/catalog-rules';

export class MedicineQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsEnum(DosageForm)
  dosageForm?: DosageForm;

  @IsOptional()
  @IsBooleanString()
  isActive?: string;
}

@Injectable()
export class MedicinesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: MedicineQueryDto) {
    const sortable: Record<string, Prisma.MedicineOrderByWithRelationInput> = {
      name: { name: query.sortOrder === 'desc' ? 'desc' : 'asc' },
      genericName: { genericName: query.sortOrder === 'desc' ? 'desc' : 'asc' },
      sku: { sku: query.sortOrder === 'desc' ? 'desc' : 'asc' },
      createdAt: { createdAt: query.sortOrder === 'desc' ? 'desc' : 'asc' },
      status: { isActive: query.sortOrder === 'desc' ? 'desc' : 'asc' },
    };
    const where: Prisma.MedicineWhereInput = {
      deletedAt: null,
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.dosageForm ? { dosageForm: query.dosageForm } : {}),
      ...(query.isActive !== undefined ? { isActive: query.isActive === 'true' } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { genericName: { contains: query.search, mode: 'insensitive' } },
              { brandName: { contains: query.search, mode: 'insensitive' } },
              { sku: { contains: query.search, mode: 'insensitive' } },
              { barcode: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.medicine.count({ where }),
      this.prisma.medicine.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: sortable[query.sortBy ?? 'name'] ?? { name: 'asc' },
        include: { category: true, unit: true },
      }),
    ]);

    return {
      items: items.map((item) => this.withStatus(item)),
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async get(id: string) {
    const medicine = await this.prisma.medicine.findFirst({
      where: { id, deletedAt: null },
      include: { category: true, unit: true, batches: { orderBy: { expiryDate: 'asc' } } },
    });
    if (!medicine) {
      throw new NotFoundException('Medicine not found');
    }
    return this.withStatus(medicine);
  }

  async create(
    data: {
      categoryId: string;
      unitId: string;
      name: string;
      genericName?: string;
      brandName?: string;
      strength?: string;
      dosageForm: DosageForm;
      sku?: string;
      barcode?: string;
      minimumStock: number;
      reorderQuantity: number;
      referenceValue?: number;
      description?: string;
    },
    userId: string,
  ) {
    this.assertCreatePayload(data);
    await this.assertActiveCategory(data.categoryId);
    await this.assertActiveUnit(data.unitId);
    const sku = await this.resolveSku(data.sku, data.name, data.strength);
    const barcode = this.normalizeBarcode(data.barcode);
    if (barcode) {
      await this.assertUniqueBarcode(barcode);
    }

    const medicine = await this.prisma.medicine.create({
      data: {
        categoryId: data.categoryId,
        unitId: data.unitId,
        name: data.name.trim(),
        genericName: data.genericName?.trim() || null,
        brandName: data.brandName?.trim() || null,
        strength: data.strength?.trim() || null,
        dosageForm: data.dosageForm,
        sku,
        barcode,
        minimumStock: data.minimumStock,
        reorderQuantity: data.reorderQuantity,
        referenceValue: data.referenceValue ?? null,
        description: data.description?.trim() || null,
      },
      include: { category: true, unit: true },
    });
    await this.audit.record({
      userId,
      action: AuditAction.CREATE_MEDICINE,
      entityType: 'Medicine',
      entityId: medicine.id,
      newValues: { ...data, sku, barcode },
    });
    return this.withStatus(medicine);
  }

  async update(
    id: string,
    data: {
      categoryId?: string;
      unitId?: string;
      name?: string;
      genericName?: string;
      brandName?: string;
      strength?: string;
      dosageForm?: DosageForm;
      sku?: string;
      barcode?: string;
      minimumStock?: number;
      reorderQuantity?: number;
      referenceValue?: number | null;
      description?: string;
      isActive?: boolean;
    },
    userId: string,
  ) {
    const existing = await this.prisma.medicine.findFirst({ where: { id, deletedAt: null } });
    if (!existing) {
      throw new NotFoundException('Medicine not found');
    }
    const numberError = validateMedicineNumbers(data);
    if (numberError) {
      throw new BadRequestException(numberError);
    }
    if (data.categoryId) {
      await this.assertActiveCategory(data.categoryId);
    }
    if (data.unitId) {
      await this.assertActiveUnit(data.unitId);
    }
    if (data.sku && data.sku.toUpperCase() !== existing.sku) {
      await this.assertUniqueSku(data.sku.toUpperCase());
    }
    const barcode = data.barcode === undefined ? undefined : this.normalizeBarcode(data.barcode);
    if (barcode && barcode !== existing.barcode) {
      await this.assertUniqueBarcode(barcode);
    }

    const updated = await this.prisma.medicine.update({
      where: { id },
      data: {
        categoryId: data.categoryId,
        unitId: data.unitId,
        name: data.name?.trim(),
        genericName: data.genericName?.trim(),
        brandName: data.brandName?.trim(),
        strength: data.strength?.trim(),
        dosageForm: data.dosageForm,
        sku: data.sku?.toUpperCase(),
        barcode,
        minimumStock: data.minimumStock,
        reorderQuantity: data.reorderQuantity,
        referenceValue: data.referenceValue,
        description: data.description?.trim(),
        isActive: data.isActive,
      },
      include: { category: true, unit: true },
    });
    await this.audit.record({
      userId,
      action: data.isActive === false ? AuditAction.DEACTIVATE_MEDICINE : AuditAction.UPDATE_MEDICINE,
      entityType: 'Medicine',
      entityId: id,
      oldValues: existing,
      newValues: data as object,
    });
    return this.withStatus(updated);
  }

  setStatus(id: string, isActive: boolean, userId: string) {
    return this.update(id, { isActive }, userId);
  }

  private assertCreatePayload(data: {
    name: string;
    strength?: string;
    dosageForm: DosageForm;
    minimumStock: number;
    reorderQuantity: number;
    referenceValue?: number;
  }) {
    if (!data.name?.trim()) {
      throw new BadRequestException('Name is required');
    }
    if (requiresStrength(data.dosageForm as SharedDosageForm) && !data.strength?.trim()) {
      throw new BadRequestException('Strength is required for this dosage form');
    }
    const numberError = validateMedicineNumbers(data);
    if (numberError) {
      throw new BadRequestException(numberError);
    }
  }

  private async assertActiveCategory(categoryId: string) {
    const category = await this.prisma.medicineCategory.findFirst({
      where: { id: categoryId, deletedAt: null },
    });
    if (!category) {
      throw new BadRequestException('Category not found');
    }
    if (!category.isActive) {
      throw new BadRequestException('Cannot use an inactive category');
    }
  }

  private async assertActiveUnit(unitId: string) {
    const unit = await this.prisma.unit.findUnique({ where: { id: unitId } });
    if (!unit) {
      throw new BadRequestException('Unit not found');
    }
    if (!unit.isActive) {
      throw new BadRequestException('Cannot use an inactive unit');
    }
  }

  private async resolveSku(sku: string | undefined, name: string, strength?: string) {
    const requested = sku?.trim().toUpperCase();
    if (requested) {
      await this.assertUniqueSku(requested);
      return requested;
    }
    const base = generateSku(name, strength);
    for (let attempt = 1; attempt <= 20; attempt += 1) {
      const candidate = nextSkuCandidate(base, attempt);
      const exists = await this.prisma.medicine.findUnique({ where: { sku: candidate } });
      if (!exists) {
        return candidate;
      }
    }
    return `${base}-${Date.now().toString().slice(-4)}`;
  }

  private async assertUniqueSku(sku: string) {
    const existing = await this.prisma.medicine.findUnique({ where: { sku } });
    if (existing) {
      throw new ConflictException('A medicine with this SKU already exists');
    }
  }

  private async assertUniqueBarcode(barcode: string) {
    const existing = await this.prisma.medicine.findFirst({ where: { barcode } });
    if (existing) {
      throw new ConflictException('A medicine with this barcode already exists');
    }
  }

  private normalizeBarcode(barcode?: string | null) {
    const value = barcode?.trim() || null;
    if (value && !isValidBarcode(value)) {
      throw new BadRequestException('Barcode must be 6-32 characters using letters, numbers, hyphen, or period');
    }
    return value;
  }

  private withStatus<T extends { isActive: boolean }>(item: T) {
    return { ...item, status: item.isActive ? 'ACTIVE' : 'INACTIVE' };
  }
}
