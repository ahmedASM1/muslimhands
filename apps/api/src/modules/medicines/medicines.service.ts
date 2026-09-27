import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, DosageForm as SharedDosageForm, normalizeCatalogItemType, catalogItemTypeLabel, CATALOG_ITEM_TYPE } from '@mh/shared';
import { DosageForm, Prisma } from '@prisma/client';
import { IsBooleanString, IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  generateSku,
  isValidBarcode,
  nextSkuCandidate,
  normalizeDosageForm,
  requiresStrength,
  unitCodeFromName,
  validateMedicineNumbers,
} from '../catalog/catalog-rules';
import { parseSpreadsheetRows, pickField } from '../catalog/spreadsheet-import';

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

  /** MEDICINE | MEDICAL_SUPPLY | custom category item type */
  @IsOptional()
  @IsString()
  itemType?: string;
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
      ...(query.itemType
        ? {
            category: {
              deletedAt: null,
              itemType: normalizeCatalogItemType(query.itemType),
            },
          }
        : {}),
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
    const category = await this.assertActiveCategory(data.categoryId);
    this.assertCreatePayload(data, category.itemType);
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

  async importFromFile(
    file: { buffer: Buffer; originalname: string },
    userId: string,
    options?: { defaultItemType?: string },
  ) {
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

    const defaultItemType = normalizeCatalogItemType(
      options?.defaultItemType || CATALOG_ITEM_TYPE.MEDICINE,
    );

    const categories = await this.prisma.medicineCategory.findMany({ where: { deletedAt: null } });
    const units = await this.prisma.unit.findMany();
    /** key: `${lowerName}::${itemType}` */
    const categoryByKey = new Map(
      categories.map((item) => [`${item.name.toLowerCase()}::${item.itemType}`, item]),
    );
    const categoryByName = new Map(categories.map((item) => [item.name.toLowerCase(), item]));
    const unitByCode = new Map(units.map((item) => [item.code.toLowerCase(), item]));
    const unitByName = new Map(units.map((item) => [item.name.toLowerCase(), item]));

    const created: string[] = [];
    const updated: string[] = [];
    const skipped: { row: number; reason: string }[] = [];
    let createdMedicines = 0;
    let createdSupplies = 0;
    let updatedMedicines = 0;
    let updatedSupplies = 0;

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index]!;
      const name = pickField(
        row,
        'name',
        'medicine',
        'medicine_name',
        'product',
        'product_name',
        'item',
        'item_name',
        'supply',
        'supply_name',
        'الاسم',
        'اسم_الدواء',
        'اسم_المستلزم',
      );
      if (!name || name.length < 2) {
        skipped.push({ row: index + 2, reason: 'Missing or short name' });
        continue;
      }

      const itemTypeRaw = pickField(
        row,
        'item_type',
        'itemtype',
        'type',
        'catalog_type',
        'product_type',
        'النوع',
        'نوع_الصنف',
        'نوع_العنصر',
      );
      const itemType = normalizeCatalogItemType(itemTypeRaw || defaultItemType);
      const isSupply = itemType !== CATALOG_ITEM_TYPE.MEDICINE;

      const categoryName = pickField(
        row,
        'category',
        'category_name',
        'التصنيف',
        'الفئة',
        'الصنف',
      );
      if (!categoryName) {
        skipped.push({ row: index + 2, reason: 'Category is required' });
        continue;
      }

      let category =
        categoryByKey.get(`${categoryName.toLowerCase()}::${itemType}`) ??
        (() => {
          const byName = categoryByName.get(categoryName.toLowerCase());
          return byName && byName.itemType === itemType ? byName : undefined;
        })();

      if (!category) {
        const sameName = categoryByName.get(categoryName.toLowerCase());
        if (sameName && sameName.itemType !== itemType) {
          const medicineCount = await this.prisma.medicine.count({
            where: { categoryId: sameName.id, deletedAt: null },
          });
          if (medicineCount === 0) {
            category = await this.prisma.medicineCategory.update({
              where: { id: sameName.id },
              data: { itemType, isActive: true, deletedAt: null },
            });
          } else {
            const typedName = `${categoryName} · ${catalogItemTypeLabel(itemType, 'en')}`;
            category =
              categoryByName.get(typedName.toLowerCase()) ??
              (await this.prisma.medicineCategory.create({
                data: { name: typedName, itemType },
              }));
          }
        } else {
          category = await this.prisma.medicineCategory.create({
            data: { name: categoryName, itemType },
          });
        }
        categoryByKey.set(`${category.name.toLowerCase()}::${category.itemType}`, category);
        categoryByName.set(category.name.toLowerCase(), category);
      }

      const unitRaw = pickField(row, 'unit', 'unit_code', 'unit_name', 'الوحدة', 'وحدة');
      let unit =
        (unitRaw ? unitByCode.get(unitRaw.toLowerCase()) : undefined) ??
        (unitRaw ? unitByName.get(unitRaw.toLowerCase()) : undefined);

      if (!unit && unitRaw) {
        let code = unitCodeFromName(unitRaw);
        let attempt = 1;
        while (unitByCode.has(code.toLowerCase()) || units.some((u) => u.code === code)) {
          attempt += 1;
          code = `${unitCodeFromName(unitRaw).slice(0, 20)}_${attempt}`.slice(0, 24);
        }
        unit = await this.prisma.unit.create({
          data: { code, name: unitRaw, isActive: true },
        });
        units.push(unit);
        unitByCode.set(unit.code.toLowerCase(), unit);
        unitByName.set(unit.name.toLowerCase(), unit);
      }

      if (!unit) {
        unit =
          units.find((item) => item.code === 'UNIT' || item.code === 'PIECE') ?? units[0];
      }
      if (!unit) {
        skipped.push({ row: index + 2, reason: 'Unit is required (no unit in file or system)' });
        continue;
      }

      const dosageFallback = isSupply ? DosageForm.OTHER : DosageForm.TABLET;
      const dosageForm = isSupply
        ? DosageForm.OTHER
        : normalizeDosageForm(
            pickField(row, 'dosage_form', 'dosageform', 'form', 'الشكل', 'الشكل_الصيدلاني'),
            dosageFallback,
          );

      const strength = isSupply
        ? undefined
        : pickField(row, 'strength', 'concentration', 'التركيز') || undefined;
      const sku = pickField(row, 'sku', 'code', 'الرمز') || undefined;
      const barcode = pickField(row, 'barcode', 'الباركود') || undefined;
      const genericName =
        pickField(row, 'generic_name', 'generic', 'الاسم_العلمي', 'الاسم العلمي') || undefined;
      const brandName = pickField(row, 'brand_name', 'brand', 'الاسم_التجاري') || undefined;
      const description = pickField(row, 'description', 'الوصف') || undefined;
      const minimumStock = Number(pickField(row, 'minimum_stock', 'min_stock', 'الحد_الأدنى') || '0') || 0;
      const reorderQuantity =
        Number(pickField(row, 'reorder_quantity', 'reorder', 'كمية_إعادة_الطلب') || '0') || 0;

      try {
        const existing = sku
          ? await this.prisma.medicine.findFirst({
              where: {
                OR: [{ sku: sku.toUpperCase() }, { name: { equals: name, mode: 'insensitive' } }],
                deletedAt: null,
              },
            })
          : await this.prisma.medicine.findFirst({
              where: { name: { equals: name, mode: 'insensitive' }, deletedAt: null },
            });

        if (existing) {
          await this.update(
            existing.id,
            {
              categoryId: category.id,
              unitId: unit.id,
              name,
              genericName,
              brandName,
              strength,
              dosageForm,
              sku: sku?.toUpperCase(),
              barcode,
              minimumStock,
              reorderQuantity,
              description,
              isActive: true,
            },
            userId,
          );
          updated.push(name);
          if (isSupply) updatedSupplies += 1;
          else updatedMedicines += 1;
        } else {
          await this.create(
            {
              categoryId: category.id,
              unitId: unit.id,
              name,
              genericName,
              brandName,
              strength,
              dosageForm,
              sku,
              barcode,
              minimumStock,
              reorderQuantity,
              description,
            },
            userId,
          );
          created.push(name);
          if (isSupply) createdSupplies += 1;
          else createdMedicines += 1;
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
      action: AuditAction.IMPORT_MEDICINES,
      entityType: 'Medicine',
      entityId: userId,
      newValues: {
        created: created.length,
        updated: updated.length,
        skipped: skipped.length,
        createdMedicines,
        createdSupplies,
        updatedMedicines,
        updatedSupplies,
        filename: file.originalname,
        defaultItemType,
      },
    });

    return {
      created: created.length,
      updated: updated.length,
      skipped: skipped.length,
      createdMedicines,
      createdSupplies,
      updatedMedicines,
      updatedSupplies,
      details: { created, updated, skipped },
    };
  }

  private assertCreatePayload(
    data: {
      name: string;
      strength?: string;
      dosageForm: DosageForm;
      minimumStock: number;
      reorderQuantity: number;
      referenceValue?: number;
    },
    itemType?: string | null,
  ) {
    if (!data.name?.trim()) {
      throw new BadRequestException('Name is required');
    }
    if (requiresStrength(data.dosageForm as SharedDosageForm, itemType) && !data.strength?.trim()) {
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
    return category;
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
