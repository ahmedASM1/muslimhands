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
  validateBatchDates,
  validateMedicineNumbers,
} from '../catalog/catalog-rules';
import { parseSpreadsheetRows, pickField, resolveRowItemType, extractUnknownColumns, collectUnknownColumnNames } from '../catalog/spreadsheet-import';
import { dosageFormFromUnitLabel, parseItemDescription } from '../catalog/catalog-item-parse';
import { renderExport } from '../reports/exporters';
import type { ExportFormat, ReportExportPayload } from '../reports/types/report.types';
import type { PackLevelInput } from '../../common/inventory/packaging';

const medicineInclude = {
  category: true,
  unit: true,
  packLevels: { orderBy: { sortOrder: 'asc' as const } },
} satisfies Prisma.MedicineInclude;

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
        include: medicineInclude,
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
      include: {
        ...medicineInclude,
        batches: { orderBy: { expiryDate: 'asc' } },
      },
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
      importMetadata?: Record<string, string> | null;
      packLevels?: PackLevelInput[];
      expiryAlertValue?: number | null;
      expiryAlertUnit?: 'DAYS' | 'WEEKS' | 'MONTHS' | null;
      initialBatch?: {
        batchNumber: string;
        manufacturingDate?: string;
        expiryDate: string;
      };
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
    const packLevels = this.normalizePackLevels(data.packLevels);
    const expiryLead = this.normalizeExpiryLead(data.expiryAlertValue, data.expiryAlertUnit);

    let initialBatchData: {
      batchNumber: string;
      manufacturingDate: Date | null;
      expiryDate: Date;
    } | null = null;
    if (data.initialBatch) {
      const batchNumber = data.initialBatch.batchNumber?.trim();
      if (!batchNumber) {
        throw new BadRequestException('initialBatch.batchNumber is required');
      }
      if (!data.initialBatch.expiryDate) {
        throw new BadRequestException('initialBatch.expiryDate is required');
      }
      const manufacturingDate = data.initialBatch.manufacturingDate
        ? new Date(data.initialBatch.manufacturingDate)
        : null;
      const expiryDate = new Date(data.initialBatch.expiryDate);
      const dateError = validateBatchDates(manufacturingDate, expiryDate);
      if (dateError) {
        throw new BadRequestException(dateError);
      }
      initialBatchData = { batchNumber, manufacturingDate, expiryDate };
    }

    const medicine = await this.prisma.$transaction(async (tx) => {
      const created = await tx.medicine.create({
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
          expiryAlertValue: expiryLead.value,
          expiryAlertUnit: expiryLead.unit,
          referenceValue: data.referenceValue ?? null,
          description: data.description?.trim() || null,
          importMetadata: data.importMetadata ?? undefined,
        },
      });
      if (packLevels.length) {
        await this.syncPackLevels(tx, created.id, packLevels);
      }
      if (initialBatchData) {
        await tx.medicineBatch.create({
          data: {
            medicineId: created.id,
            batchNumber: initialBatchData.batchNumber,
            manufacturingDate: initialBatchData.manufacturingDate,
            expiryDate: initialBatchData.expiryDate,
          },
        });
      }
      return tx.medicine.findUniqueOrThrow({
        where: { id: created.id },
        include: {
          ...medicineInclude,
          batches: { orderBy: { expiryDate: 'asc' } },
        },
      });
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
      importMetadata?: Record<string, string> | null;
      packLevels?: PackLevelInput[];
      expiryAlertValue?: number | null;
      expiryAlertUnit?: 'DAYS' | 'WEEKS' | 'MONTHS' | null;
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

    const mergedMetadata =
      data.importMetadata === undefined
        ? undefined
        : {
            ...((existing.importMetadata as Record<string, string> | null) ?? {}),
            ...(data.importMetadata ?? {}),
          };

    const packLevels =
      data.packLevels === undefined ? undefined : this.normalizePackLevels(data.packLevels);

    const expiryLead =
      data.expiryAlertValue !== undefined || data.expiryAlertUnit !== undefined
        ? this.normalizeExpiryLead(
            data.expiryAlertValue !== undefined ? data.expiryAlertValue : existing.expiryAlertValue,
            data.expiryAlertUnit !== undefined ? data.expiryAlertUnit : existing.expiryAlertUnit,
          )
        : undefined;

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.medicine.update({
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
          importMetadata: mergedMetadata === undefined ? undefined : mergedMetadata,
          ...(expiryLead
            ? { expiryAlertValue: expiryLead.value, expiryAlertUnit: expiryLead.unit }
            : {}),
        },
      });
      if (packLevels !== undefined) {
        await this.syncPackLevels(tx, id, packLevels);
      }
      return tx.medicine.findUniqueOrThrow({
        where: { id },
        include: medicineInclude,
      });
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

  private normalizeExpiryLead(
    value?: number | null,
    unit?: string | null,
  ): { value: number | null; unit: string | null } {
    if (value == null) {
      return { value: null, unit: null };
    }
    const amount = Math.floor(Number(value));
    if (!Number.isFinite(amount) || amount < 1) {
      throw new BadRequestException('expiryAlertValue must be >= 1');
    }
    const normalized = String(unit ?? 'DAYS').trim().toUpperCase();
    if (normalized !== 'DAYS' && normalized !== 'WEEKS' && normalized !== 'MONTHS') {
      throw new BadRequestException('expiryAlertUnit must be DAYS, WEEKS, or MONTHS');
    }
    return { value: amount, unit: normalized };
  }

  private normalizePackLevels(raw?: PackLevelInput[] | null): PackLevelInput[] {
    if (!raw?.length) return [];
    const seen = new Set<string>();
    const levels: PackLevelInput[] = [];
    for (let i = 0; i < raw.length; i += 1) {
      const item = raw[i]!;
      const code = String(item.code ?? '')
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9_]/g, '');
      const label = String(item.label ?? '').trim();
      const factorToBase = Math.floor(Number(item.factorToBase));
      if (!code || !label) {
        throw new BadRequestException('Pack level code and label are required');
      }
      if (!Number.isFinite(factorToBase) || factorToBase < 1) {
        throw new BadRequestException(`Pack level ${code} factorToBase must be >= 1`);
      }
      if (seen.has(code)) {
        throw new BadRequestException(`Duplicate pack level code: ${code}`);
      }
      seen.add(code);
      levels.push({
        code,
        label,
        factorToBase,
        sortOrder: item.sortOrder ?? i,
      });
    }
    return levels;
  }

  private async syncPackLevels(
    tx: Prisma.TransactionClient,
    medicineId: string,
    levels: PackLevelInput[],
  ) {
    await tx.medicinePackLevel.deleteMany({ where: { medicineId } });
    if (!levels.length) return;
    await tx.medicinePackLevel.createMany({
      data: levels.map((level, index) => ({
        medicineId,
        code: level.code,
        label: level.label,
        factorToBase: level.factorToBase,
        sortOrder: level.sortOrder ?? index,
      })),
    });
  }

  setStatus(id: string, isActive: boolean, userId: string) {
    return this.update(id, { isActive }, userId);
  }

  async importFromFile(
    file: { buffer: Buffer; originalname: string },
    userId: string,
    options?: { defaultItemType?: string; dryRun?: boolean },
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

    const dryRun = Boolean(options?.dryRun);
    const defaultItemType = normalizeCatalogItemType(
      options?.defaultItemType || CATALOG_ITEM_TYPE.MEDICINE,
    );
    const unknownColumns = collectUnknownColumnNames(rows);

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
    const previewRows: Array<{
      row: number;
      action: 'create' | 'update' | 'skip';
      name: string;
      itemType: string;
      category: string;
      unit: string;
      sheet?: string;
      reason?: string;
      extraColumns?: Record<string, string>;
    }> = [];
    const categoriesToCreate = new Set<string>();
    const unitsToCreate = new Set<string>();
    let createdMedicines = 0;
    let createdSupplies = 0;
    let updatedMedicines = 0;
    let updatedSupplies = 0;

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index]!;
      const sourceRow = Number(row._source_row || index + 2) || index + 2;

      const rawName = pickField(
        row,
        'name',
        'item_description',
        'medicine',
        'medicine_name',
        'product',
        'product_name',
        'item',
        'item_name',
        'supply',
        'supply_name',
        'description',
        'الاسم',
        'اسم_الدواء',
        'اسم_المستلزم',
        'وصف_الصنف',
      );
      if (!rawName || rawName.length < 2) {
        skipped.push({ row: sourceRow, reason: 'Missing or short name / item description' });
        previewRows.push({
          row: sourceRow,
          action: 'skip',
          name: rawName || '—',
          itemType: defaultItemType,
          category: '—',
          unit: '—',
          sheet: row._sheet,
          reason: 'Missing or short name / item description',
        });
        continue;
      }

      const parsed = parseItemDescription(rawName);
      const name = parsed.name || rawName;
      const itemType = resolveRowItemType(row, defaultItemType);
      const isSupply = itemType !== CATALOG_ITEM_TYPE.MEDICINE;

      const categoryName =
        pickField(row, 'category', 'category_name', 'التصنيف', 'الفئة', 'الصنف') ||
        (isSupply ? 'General Medical Supplies' : 'General Medicines');

      let category =
        categoryByKey.get(`${categoryName.toLowerCase()}::${itemType}`) ??
        (() => {
          const byName = categoryByName.get(categoryName.toLowerCase());
          return byName && byName.itemType === itemType ? byName : undefined;
        })();

      if (!category) {
        categoriesToCreate.add(`${categoryName} (${itemType})`);
        const sameName = categoryByName.get(categoryName.toLowerCase());
        if (sameName && sameName.itemType !== itemType) {
          const medicineCount = await this.prisma.medicine.count({
            where: { categoryId: sameName.id, deletedAt: null },
          });
          if (medicineCount === 0) {
            if (dryRun) {
              category = { ...sameName, itemType };
            } else {
              category = await this.prisma.medicineCategory.update({
                where: { id: sameName.id },
                data: { itemType, isActive: true, deletedAt: null },
              });
            }
          } else {
            const typedName = `${categoryName} · ${catalogItemTypeLabel(itemType, 'en')}`;
            const existingTyped = categoryByName.get(typedName.toLowerCase());
            if (existingTyped) {
              category = existingTyped;
            } else if (dryRun) {
              category = {
                id: `preview-cat-${typedName}`,
                name: typedName,
                itemType,
              } as (typeof categories)[number];
            } else {
              category = await this.prisma.medicineCategory.create({
                data: { name: typedName, itemType },
              });
            }
          }
        } else if (dryRun) {
          category = {
            id: `preview-cat-${categoryName}`,
            name: categoryName,
            itemType,
          } as (typeof categories)[number];
        } else {
          category = await this.prisma.medicineCategory.create({
            data: { name: categoryName, itemType },
          });
        }
        categoryByKey.set(`${category.name.toLowerCase()}::${category.itemType}`, category);
        categoryByName.set(category.name.toLowerCase(), category);
      }

      const unitRaw =
        pickField(row, 'unit', 'unit_code', 'unit_name', 'الوحدة', 'وحدة') ||
        parsed.unitHint ||
        '';
      let unit =
        (unitRaw ? unitByCode.get(unitRaw.toLowerCase()) : undefined) ??
        (unitRaw ? unitByName.get(unitRaw.toLowerCase()) : undefined);

      if (!unit && unitRaw) {
        unitsToCreate.add(unitRaw);
        if (dryRun) {
          unit = {
            id: `preview-unit-${unitRaw}`,
            code: unitCodeFromName(unitRaw),
            name: unitRaw,
          } as (typeof units)[number];
          unitByCode.set(unit.code.toLowerCase(), unit);
          unitByName.set(unit.name.toLowerCase(), unit);
        } else {
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
      }

      if (!unit) {
        unit =
          units.find((item) => item.code === 'UNIT' || item.code === 'PIECE') ??
          units.find((item) => item.name.toLowerCase() === 'unit') ??
          units[0];
      }
      if (!unit) {
        unitsToCreate.add('Unit');
        if (dryRun) {
          unit = { id: 'preview-unit-UNIT', code: 'UNIT', name: 'Unit' } as (typeof units)[number];
        } else {
          unit = await this.prisma.unit.create({
            data: { code: 'UNIT', name: 'Unit', isActive: true },
          });
          units.push(unit);
        }
        unitByCode.set('unit', unit);
        unitByName.set('unit', unit);
      }

      const dosageFromFile = pickField(
        row,
        'dosage_form',
        'dosageform',
        'form',
        'الشكل',
        'الشكل_الصيدلاني',
      );
      const dosageFallback: SharedDosageForm =
        parsed.dosageForm ??
        dosageFormFromUnitLabel(unitRaw) ??
        SharedDosageForm.OTHER;
      let dosageForm: DosageForm = isSupply
        ? DosageForm.OTHER
        : (normalizeDosageForm(dosageFromFile, dosageFallback) as DosageForm);

      const strength = isSupply
        ? undefined
        : pickField(row, 'strength', 'concentration', 'التركيز') || parsed.strength || undefined;

      // Import should not fail on free-text stock sheets that omit a clean strength value.
      if (
        !isSupply &&
        requiresStrength(dosageForm as SharedDosageForm, itemType) &&
        !strength?.trim()
      ) {
        dosageForm = DosageForm.OTHER;
      }

      const sku = pickField(row, 'sku', 'code', 'الرمز') || undefined;
      const barcode = pickField(row, 'barcode', 'الباركود') || undefined;
      const genericName =
        pickField(row, 'generic_name', 'generic', 'الاسم_العلمي', 'الاسم العلمي') ||
        parsed.genericName ||
        undefined;
      const brandName = pickField(row, 'brand_name', 'brand', 'الاسم_التجاري') || undefined;
      const description =
        pickField(row, 'notes', 'note', 'details', 'full_description', 'ملاحظات') ||
        parsed.description ||
        (rawName !== name ? rawName : undefined);
      const minimumStock =
        Number(pickField(row, 'minimum_stock', 'min_stock', 'الحد_الأدنى') || '0') || 0;
      const reorderQuantity =
        Number(pickField(row, 'reorder_quantity', 'reorder', 'كمية_إعادة_الطلب') || '0') || 0;

      const importMetadata: Record<string, string> = {
        ...extractUnknownColumns(row),
      };
      const previousStock = pickField(row, 'previous_stock_movement', 'previous_stock');
      const suppliedQty = pickField(row, 'supplied_qty', 'supplied');
      const remainingQty = pickField(row, 'remaining_qty', 'remaining');
      const totalDispensed = pickField(row, 'total_amount_dispensed');
      if (previousStock) importMetadata.previous_stock = previousStock;
      if (suppliedQty) importMetadata.supplied_qty = suppliedQty;
      if (remainingQty) importMetadata.remaining_qty = remainingQty;
      if (totalDispensed) importMetadata.total_dispensed = totalDispensed;
      if (row._sheet) importMetadata.source_sheet = row._sheet;

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

        const action = existing ? 'update' : 'create';
        previewRows.push({
          row: sourceRow,
          action,
          name,
          itemType,
          category: category.name,
          unit: unit.name,
          sheet: row._sheet,
          extraColumns: Object.keys(importMetadata).length ? importMetadata : undefined,
        });

        if (dryRun) {
          if (existing) {
            updated.push(name);
            if (isSupply) updatedSupplies += 1;
            else updatedMedicines += 1;
          } else {
            created.push(name);
            if (isSupply) createdSupplies += 1;
            else createdMedicines += 1;
          }
          continue;
        }

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
              importMetadata,
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
              importMetadata,
            },
            userId,
          );
          created.push(name);
          if (isSupply) createdSupplies += 1;
          else createdMedicines += 1;
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'Failed to save row';
        skipped.push({ row: sourceRow, reason });
        previewRows.push({
          row: sourceRow,
          action: 'skip',
          name,
          itemType,
          category: category.name,
          unit: unit.name,
          sheet: row._sheet,
          reason,
        });
      }
    }

    if (!dryRun) {
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
          unknownColumns,
          filename: file.originalname,
          defaultItemType,
        },
      });
    }

    return {
      dryRun,
      created: created.length,
      updated: updated.length,
      skipped: skipped.length,
      createdMedicines,
      createdSupplies,
      updatedMedicines,
      updatedSupplies,
      unknownColumns,
      categoriesToCreate: [...categoriesToCreate],
      unitsToCreate: [...unitsToCreate],
      previewRows: previewRows.slice(0, 200),
      details: { created, updated, skipped },
    };
  }

  async exportCatalog(
    query: MedicineQueryDto & { format?: string },
  ): Promise<{ buffer: Buffer; contentType: string; filename: string }> {
    const format = ((query.format ?? 'xlsx') as string).toLowerCase() as ExportFormat;
    if (!['csv', 'xlsx', 'pdf'].includes(format)) {
      throw new BadRequestException('format must be csv, xlsx, or pdf');
    }

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

    const items = await this.prisma.medicine.findMany({
      where,
      take: Math.min(Number(query.limit) || 5000, 10000),
      orderBy: { name: 'asc' },
      include: medicineInclude,
    });

    const metaKeys = new Set<string>();
    for (const item of items) {
      const meta = item.importMetadata as Record<string, unknown> | null;
      if (meta && typeof meta === 'object') {
        for (const key of Object.keys(meta)) metaKeys.add(key);
      }
    }
    const extraColumns = [...metaKeys].sort().slice(0, 12);

    const isSupply = query.itemType
      ? normalizeCatalogItemType(query.itemType) === CATALOG_ITEM_TYPE.MEDICAL_SUPPLY
      : false;
    const title = isSupply
      ? 'Medical Supplies Catalog'
      : query.itemType
        ? 'Medicines Catalog'
        : 'Full Catalog Export';

    const columns = [
      { key: 'name', header: 'Name' },
      { key: 'genericName', header: 'Generic name' },
      { key: 'brandName', header: 'Brand' },
      { key: 'strength', header: 'Strength' },
      { key: 'dosageForm', header: 'Dosage form' },
      { key: 'category', header: 'Category' },
      { key: 'itemType', header: 'Type' },
      { key: 'unit', header: 'Unit' },
      { key: 'sku', header: 'SKU' },
      { key: 'barcode', header: 'Barcode' },
      { key: 'minimumStock', header: 'Min stock' },
      { key: 'reorderQuantity', header: 'Reorder qty' },
      { key: 'status', header: 'Status' },
      { key: 'description', header: 'Description' },
      ...extraColumns.map((key) => ({ key: `extra_${key}`, header: key })),
    ];

    const rows = items.map((item) => {
      const meta = (item.importMetadata as Record<string, unknown> | null) ?? {};
      const base: Record<string, unknown> = {
        name: item.name,
        genericName: item.genericName ?? '',
        brandName: item.brandName ?? '',
        strength: item.strength ?? '',
        dosageForm: item.dosageForm,
        category: item.category?.name ?? '',
        itemType: item.category?.itemType ?? '',
        unit: item.unit?.name ?? '',
        sku: item.sku,
        barcode: item.barcode ?? '',
        minimumStock: item.minimumStock,
        reorderQuantity: item.reorderQuantity,
        status: item.isActive ? 'ACTIVE' : 'INACTIVE',
        description: item.description ?? '',
      };
      for (const key of extraColumns) {
        base[`extra_${key}`] = meta[key] == null ? '' : String(meta[key]);
      }
      return base;
    });

    const filters: string[] = [];
    if (query.itemType) filters.push(`type=${normalizeCatalogItemType(query.itemType)}`);
    if (query.search) filters.push(`search=${query.search}`);
    if (query.categoryId) filters.push(`category=${query.categoryId}`);
    if (query.dosageForm) filters.push(`form=${query.dosageForm}`);
    if (query.isActive !== undefined) filters.push(`active=${query.isActive}`);

    const payload: ReportExportPayload = {
      reportType: isSupply ? 'medical-supplies' : 'medicines',
      title,
      generatedAt: new Date(),
      filterSummary: filters.join(' · ') || 'All catalog items',
      columns,
      rows,
    };

    return renderExport(format, payload);
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
