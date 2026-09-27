import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, normalizeCatalogItemType, SYSTEM_CATALOG_ITEM_TYPES } from '@mh/shared';
import { IsBooleanString, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { parseSpreadsheetRows, pickField } from '../catalog/spreadsheet-import';

export class CategoryQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsBooleanString()
  isActive?: string;

  @IsOptional()
  @IsString()
  itemType?: string;
}

@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: CategoryQueryDto) {
    const where = {
      deletedAt: null,
      ...(query.isActive !== undefined ? { isActive: query.isActive === 'true' } : {}),
      ...(query.itemType ? { itemType: normalizeCatalogItemType(query.itemType) } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' as const } },
              { description: { contains: query.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.medicineCategory.count({ where }),
      this.prisma.medicineCategory.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { name: query.sortOrder === 'desc' ? 'desc' : 'asc' },
        include: { _count: { select: { medicines: true } } },
      }),
    ]);
    return {
      items: items.map((item) => this.withStatus(item)),
      meta: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) },
    };
  }

  async listItemTypes() {
    const custom = await this.prisma.medicineCategory.findMany({
      where: { deletedAt: null },
      distinct: ['itemType'],
      select: { itemType: true },
      orderBy: { itemType: 'asc' },
    });
    const systemCodes = new Set(SYSTEM_CATALOG_ITEM_TYPES.map((item: { code: string }) => item.code));
    const customTypes = custom
      .map((row) => row.itemType)
      .filter((code) => !systemCodes.has(code));

    return {
      system: SYSTEM_CATALOG_ITEM_TYPES.map((item: { code: string; labelEn: string; labelAr: string }) => ({
        code: item.code,
        labelEn: item.labelEn,
        labelAr: item.labelAr,
        isSystem: true,
      })),
      custom: customTypes.map((code) => ({
        code,
        labelEn: code.replaceAll('_', ' '),
        labelAr: code.replaceAll('_', ' '),
        isSystem: false,
      })),
    };
  }

  async get(id: string) {
    const category = await this.prisma.medicineCategory.findFirst({
      where: { id, deletedAt: null },
      include: { _count: { select: { medicines: true } } },
    });
    if (!category) {
      throw new NotFoundException('Category not found');
    }
    return this.withStatus(category);
  }

  async create(
    data: { name: string; description?: string; itemType?: string },
    userId: string,
  ) {
    const name = data.name.trim();
    const itemType = normalizeCatalogItemType(data.itemType);
    const existing = await this.prisma.medicineCategory.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
    });
    if (existing && !existing.deletedAt) {
      throw new ConflictException('A category with this name already exists');
    }

    const category = existing
      ? await this.prisma.medicineCategory.update({
          where: { id: existing.id },
          data: {
            name,
            description: data.description?.trim() || null,
            itemType,
            isActive: true,
            deletedAt: null,
          },
        })
      : await this.prisma.medicineCategory.create({
          data: {
            name,
            description: data.description?.trim() || null,
            itemType,
          },
        });

    await this.audit.record({
      userId,
      action: AuditAction.CREATE_CATEGORY,
      entityType: 'MedicineCategory',
      entityId: category.id,
      newValues: { name, description: data.description, itemType },
    });
    return this.withStatus(category);
  }

  async update(
    id: string,
    data: { name?: string; description?: string; itemType?: string; isActive?: boolean },
    userId: string,
  ) {
    const existing = await this.prisma.medicineCategory.findFirst({ where: { id, deletedAt: null } });
    if (!existing) {
      throw new NotFoundException('Category not found');
    }
    if (data.name && data.name.trim().toLowerCase() !== existing.name.toLowerCase()) {
      await this.assertUniqueName(data.name, id);
    }
    const updated = await this.prisma.medicineCategory.update({
      where: { id },
      data: {
        name: data.name?.trim(),
        description: data.description?.trim(),
        itemType: data.itemType !== undefined ? normalizeCatalogItemType(data.itemType) : undefined,
        isActive: data.isActive,
      },
    });
    await this.audit.record({
      userId,
      action: data.isActive === false ? AuditAction.DEACTIVATE_CATEGORY : AuditAction.UPDATE_CATEGORY,
      entityType: 'MedicineCategory',
      entityId: id,
      oldValues: existing,
      newValues: data,
    });
    return this.withStatus(updated);
  }

  setStatus(id: string, isActive: boolean, userId: string) {
    return this.update(id, { isActive }, userId);
  }

  async importFromFile(file: { buffer: Buffer; originalname: string }, userId: string) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Upload a CSV or Excel file');
    }

    let rows: Record<string, string>[];
    try {
      rows = await parseSpreadsheetRows(file.buffer, file.originalname);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Unable to parse file');
    }

    if (!rows.length) {
      throw new BadRequestException('No data rows found in the file');
    }

    const created: string[] = [];
    const updated: string[] = [];
    const skipped: { row: number; reason: string }[] = [];

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index]!;
      const name = pickField(row, 'name', 'category', 'category_name', 'الاسم');
      if (!name || name.length < 2) {
        skipped.push({ row: index + 2, reason: 'Missing or short name' });
        continue;
      }
      const description = pickField(row, 'description', 'desc', 'الوصف') || undefined;
      const itemType = normalizeCatalogItemType(
        pickField(row, 'item_type', 'itemtype', 'type', 'catalog_type', 'النوع') || 'MEDICINE',
      );

      try {
        const existing = await this.prisma.medicineCategory.findFirst({
          where: { name: { equals: name, mode: 'insensitive' } },
        });
        if (existing && !existing.deletedAt) {
          await this.prisma.medicineCategory.update({
            where: { id: existing.id },
            data: {
              description: description ?? existing.description,
              itemType,
              isActive: true,
            },
          });
          updated.push(name);
        } else if (existing) {
          await this.prisma.medicineCategory.update({
            where: { id: existing.id },
            data: {
              name,
              description: description ?? null,
              itemType,
              isActive: true,
              deletedAt: null,
            },
          });
          updated.push(name);
        } else {
          await this.prisma.medicineCategory.create({
            data: { name, description: description ?? null, itemType },
          });
          created.push(name);
        }
      } catch (error) {
        skipped.push({
          row: index + 2,
          reason: error instanceof Error ? error.message : 'Failed to save row',
        });
      }
    }

    await this.audit.record({
      userId,
      action: AuditAction.IMPORT_CATEGORIES,
      entityType: 'MedicineCategory',
      entityId: userId,
      newValues: {
        created: created.length,
        updated: updated.length,
        skipped: skipped.length,
        filename: file.originalname,
      },
    });

    return {
      created: created.length,
      updated: updated.length,
      skipped: skipped.length,
      details: { created, updated, skipped },
    };
  }

  private async assertUniqueName(name: string, excludeId?: string) {
    const existing = await this.prisma.medicineCategory.findFirst({
      where: {
        name: { equals: name.trim(), mode: 'insensitive' },
        deletedAt: null,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });
    if (existing) {
      throw new ConflictException('A category with this name already exists');
    }
  }

  private withStatus<T extends { isActive: boolean }>(item: T) {
    return { ...item, status: item.isActive ? 'ACTIVE' : 'INACTIVE' };
  }
}
