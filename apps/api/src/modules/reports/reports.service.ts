import { ForbiddenException, Injectable } from '@nestjs/common';
import { AuditAction, type AuthenticatedUser } from '@mh/shared';
import {
  LocationType,
  Prisma,
  SupplyRequestStatus,
  TransferStatus,
} from '@prisma/client';
import { expiryStatus, expiryWarningDate } from '../../common/access/access';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';
import {
  assertCanExport,
  assertCanViewBeneficiaryReports,
  canViewDispensingReports,
  canViewPharmacyReports,
  canViewWarehouseReports,
  includeBeneficiaryPii,
  scopedPharmacyId,
  scopedWarehouseId,
} from './report-access';
import { daysUntilExpiry, parseInclusiveDateRange, todayUtc } from './date-range';
import type {
  BeneficiaryReportQueryDto,
  DispensingReportQueryDto,
  ReceiptReportQueryDto,
  ReportBaseQueryDto,
  StockMovementReportQueryDto,
  SupplyRequestReportQueryDto,
  TransferReportQueryDto,
} from './dto/report-query.dto';
import { renderExport } from './exporters';
import {
  estimatedValue,
  stockStatusLabel,
  type ExportFormat,
  type PaginatedReport,
  type ReportColumn,
  type ReportExportPayload,
} from './types/report.types';

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  // --- Overview / summaries -------------------------------------------

  async overview(user: AuthenticatedUser, query: ReportBaseQueryDto) {
    const range = parseInclusiveDateRange(query);
    const pharmacyId = scopedPharmacyId(user, query.pharmacyId);
    const warehouseId = scopedWarehouseId(user, query.warehouseId);
    const today = todayUtc();
    const warning = expiryWarningDate(await this.settings.getExpiryWarningDays());
    const canWh = canViewWarehouseReports(user);
    const canPh = canViewPharmacyReports(user);

    const whWhere = warehouseId ? { warehouseId } : {};
    const phWhere = pharmacyId ? { pharmacyId } : {};

    const [
      activeMedicines,
      warehouseUnits,
      pharmacyUnits,
      whGroups,
      phGroups,
      expiredWh,
      expiredPh,
      expiringWh,
      expiringPh,
      todayDispensing,
      todayBeneficiaries,
      pendingRequests,
      activeTransfers,
      shippedTransfers,
    ] = await Promise.all([
      this.prisma.medicine.count({ where: { deletedAt: null, isActive: true } }),
      canWh
        ? this.prisma.warehouseStock.aggregate({ where: whWhere, _sum: { quantity: true } })
        : Promise.resolve({ _sum: { quantity: null } }),
      canPh
        ? this.prisma.pharmacyStock.aggregate({ where: phWhere, _sum: { quantity: true } })
        : Promise.resolve({ _sum: { quantity: null } }),
      canWh
        ? this.prisma.warehouseStock.groupBy({ by: ['medicineId'], where: whWhere, _sum: { quantity: true } })
        : Promise.resolve([]),
      canPh
        ? this.prisma.pharmacyStock.groupBy({ by: ['medicineId'], where: phWhere, _sum: { quantity: true } })
        : Promise.resolve([]),
      canWh
        ? this.prisma.warehouseStock.count({
            where: { ...whWhere, quantity: { gt: 0 }, batch: { expiryDate: { lt: today } } },
          })
        : Promise.resolve(0),
      canPh
        ? this.prisma.pharmacyStock.count({
            where: { ...phWhere, quantity: { gt: 0 }, batch: { expiryDate: { lt: today } } },
          })
        : Promise.resolve(0),
      canWh
        ? this.prisma.warehouseStock.count({
            where: {
              ...whWhere,
              quantity: { gt: 0 },
              batch: { expiryDate: { gte: today, lte: warning } },
            },
          })
        : Promise.resolve(0),
      canPh
        ? this.prisma.pharmacyStock.count({
            where: {
              ...phWhere,
              quantity: { gt: 0 },
              batch: { expiryDate: { gte: today, lte: warning } },
            },
          })
        : Promise.resolve(0),
      canViewDispensingReports(user)
        ? this.prisma.dispensingRecord.count({
            where: {
              ...(pharmacyId ? { pharmacyId } : {}),
              dispensedAt: { gte: range.start, lte: range.end },
            },
          })
        : Promise.resolve(0),
      canViewDispensingReports(user)
        ? this.prisma.dispensingRecord.groupBy({
            by: ['beneficiaryId'],
            where: {
              ...(pharmacyId ? { pharmacyId } : {}),
              dispensedAt: { gte: range.start, lte: range.end },
            },
          })
        : Promise.resolve([]),
      this.prisma.supplyRequest.count({
        where: {
          ...(pharmacyId ? { pharmacyId } : {}),
          ...(warehouseId ? { warehouseId } : {}),
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
          ...(pharmacyId ? { pharmacyId } : {}),
          ...(warehouseId ? { warehouseId } : {}),
          status: { in: [TransferStatus.DRAFT, TransferStatus.PREPARED] },
        },
      }),
      this.prisma.stockTransfer.count({
        where: {
          ...(pharmacyId ? { pharmacyId } : {}),
          ...(warehouseId ? { warehouseId } : {}),
          status: { in: [TransferStatus.SHIPPED, TransferStatus.IN_TRANSIT] },
        },
      }),
    ]);

    const medicineIds = [
      ...new Set([...whGroups.map((r) => r.medicineId), ...phGroups.map((r) => r.medicineId)]),
    ];
    const medicines = medicineIds.length
      ? await this.prisma.medicine.findMany({
          where: { id: { in: medicineIds } },
          select: { id: true, minimumStock: true },
        })
      : [];
    const minById = new Map(medicines.map((m) => [m.id, m.minimumStock]));

    const lowWh = whGroups.filter((row) => {
      const qty = row._sum.quantity ?? 0;
      return qty > 0 && qty <= (minById.get(row.medicineId) ?? 0);
    }).length;
    const lowPh = phGroups.filter((row) => {
      const qty = row._sum.quantity ?? 0;
      return qty > 0 && qty <= (minById.get(row.medicineId) ?? 0);
    }).length;

    return {
      dateSemantics: {
        timezone: 'UTC',
        dateFromInclusive: true,
        dateToInclusive: true,
        period: range.label,
      },
      currentStock: {
        activeMedicines,
        warehouseStockUnits: warehouseUnits._sum.quantity ?? 0,
        pharmacyStockUnits: pharmacyUnits._sum.quantity ?? 0,
        lowStockMedicineCount: lowWh + lowPh,
        expiringSoonStockCount: expiringWh + expiringPh,
        expiredStockCount: expiredWh + expiredPh,
      },
      periodActivity: {
        periodLabel: range.label,
        dispensingCount: todayDispensing,
        uniqueBeneficiaries: Array.isArray(todayBeneficiaries) ? todayBeneficiaries.length : 0,
        pendingSupplyRequests: pendingRequests,
        activeTransfers,
        shippedAwaitingReceipt: shippedTransfers,
      },
    };
  }

  async inventorySummary(user: AuthenticatedUser, query: ReportBaseQueryDto) {
    const overview = await this.overview(user, query);
    const pharmacyId = scopedPharmacyId(user, query.pharmacyId);
    const warehouseId = scopedWarehouseId(user, query.warehouseId);
    const [activeBatches, whQty, phQty] = await Promise.all([
      this.prisma.medicineBatch.count({ where: { isActive: true } }),
      canViewWarehouseReports(user)
        ? this.prisma.warehouseStock.aggregate({
            where: warehouseId ? { warehouseId } : {},
            _sum: { quantity: true },
          })
        : Promise.resolve({ _sum: { quantity: 0 } }),
      canViewPharmacyReports(user)
        ? this.prisma.pharmacyStock.aggregate({
            where: pharmacyId ? { pharmacyId } : {},
            _sum: { quantity: true },
          })
        : Promise.resolve({ _sum: { quantity: 0 } }),
    ]);
    return {
      warehouseQuantity: whQty._sum.quantity ?? 0,
      pharmacyQuantity: phQty._sum.quantity ?? 0,
      lowStockCount: overview.currentStock.lowStockMedicineCount,
      expiringCount: overview.currentStock.expiringSoonStockCount,
      expiredCount: overview.currentStock.expiredStockCount,
      activeMedicines: overview.currentStock.activeMedicines,
      activeBatches,
    };
  }

  // --- Inventory (combined locations) ---------------------------------

  async inventory(user: AuthenticatedUser, query: ReportBaseQueryDto) {
    const includeWh = canViewWarehouseReports(user);
    const includePh = canViewPharmacyReports(user);
    if (!includeWh && !includePh) {
      throw new ForbiddenException('Not permitted to view inventory reports');
    }

    const pharmacyId = scopedPharmacyId(user, query.pharmacyId);
    const warehouseId = scopedWarehouseId(user, query.warehouseId);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const [whRows, phRows] = await Promise.all([
      includeWh && !pharmacyId
        ? this.fetchWarehouseStockRows(user, { ...query, warehouseId, page: 1, limit: 5000 })
        : Promise.resolve([] as Record<string, unknown>[]),
      includePh
        ? this.fetchPharmacyStockRows(user, { ...query, pharmacyId, page: 1, limit: 5000 })
        : Promise.resolve([] as Record<string, unknown>[]),
    ]);

    let merged = [...whRows, ...phRows];
    if (query.stockStatus) {
      merged = merged.filter((row) => row.stockStatus === query.stockStatus);
    }
    if (query.expiryStatus) {
      merged = merged.filter((row) => row.expiryStatus === query.expiryStatus);
    }
    if (query.search) {
      const q = query.search.toLowerCase();
      merged = merged.filter((row) =>
        [row.medicine, row.sku, row.batch, row.location]
          .map((v) => String(v ?? '').toLowerCase())
          .some((v) => v.includes(q)),
      );
    }

    const sortKey = query.sortBy ?? 'medicine';
    const dir = query.sortOrder === 'desc' ? -1 : 1;
    merged.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return av < bv ? -1 * dir : av > bv ? 1 * dir : 0;
    });

    const total = merged.length;
    const items = merged.slice((page - 1) * limit, page * limit);
    return this.page(items, page, limit, total);
  }

  async warehouseStock(user: AuthenticatedUser, query: ReportBaseQueryDto) {
    if (!canViewWarehouseReports(user)) {
      throw new ForbiddenException('Not permitted to view warehouse stock reports');
    }
    const warehouseId = scopedWarehouseId(user, query.warehouseId);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const rows = await this.fetchWarehouseStockRows(user, {
      ...query,
      warehouseId,
      page: 1,
      limit: 10000,
    });
    let filtered = rows;
    if (query.stockStatus) filtered = filtered.filter((r) => r.stockStatus === query.stockStatus);
    if (query.expiryStatus) filtered = filtered.filter((r) => r.expiryStatus === query.expiryStatus);
    const total = filtered.length;
    return this.page(filtered.slice((page - 1) * limit, page * limit), page, limit, total);
  }

  async pharmacyStock(user: AuthenticatedUser, query: ReportBaseQueryDto) {
    if (!canViewPharmacyReports(user)) {
      throw new ForbiddenException('Not permitted to view pharmacy stock reports');
    }
    const pharmacyId = scopedPharmacyId(user, query.pharmacyId);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const rows = await this.fetchPharmacyStockRows(user, {
      ...query,
      pharmacyId,
      page: 1,
      limit: 10000,
    });
    let filtered = rows;
    if (query.stockStatus) filtered = filtered.filter((r) => r.stockStatus === query.stockStatus);
    if (query.expiryStatus) filtered = filtered.filter((r) => r.expiryStatus === query.expiryStatus);
    const total = filtered.length;
    return this.page(filtered.slice((page - 1) * limit, page * limit), page, limit, total);
  }

  // --- Stock movements ------------------------------------------------

  async stockMovements(user: AuthenticatedUser, query: StockMovementReportQueryDto) {
    const range = parseInclusiveDateRange(query);
    const pharmacyId = scopedPharmacyId(user, query.pharmacyId);
    const warehouseId = scopedWarehouseId(user, query.warehouseId);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const canWh = canViewWarehouseReports(user);
    const canPh = canViewPharmacyReports(user);
    if (!canWh && !canPh) {
      throw new ForbiddenException('Not permitted to view stock movement reports');
    }

    const locationFilter: Prisma.StockMovementWhereInput = {};
    if (pharmacyId) {
      locationFilter.pharmacyId = pharmacyId;
      locationFilter.locationType = LocationType.PHARMACY;
    } else if (warehouseId) {
      locationFilter.warehouseId = warehouseId;
      locationFilter.locationType = LocationType.WAREHOUSE;
    } else if (canWh && !canPh) {
      locationFilter.locationType = LocationType.WAREHOUSE;
    } else if (canPh && !canWh) {
      locationFilter.locationType = LocationType.PHARMACY;
    }

    const where: Prisma.StockMovementWhereInput = {
      occurredAt: { gte: range.start, lte: range.end },
      ...locationFilter,
      ...(query.movementType ? { movementType: query.movementType as never } : {}),
      ...(query.medicineId ? { medicineId: query.medicineId } : {}),
      ...(query.batchId ? { batchId: query.batchId } : {}),
      ...(query.referenceType ? { referenceType: query.referenceType as never } : {}),
      ...(query.referenceId ? { referenceId: query.referenceId } : {}),
      ...(query.performedById ? { performedById: query.performedById } : {}),
      ...(query.search
        ? {
            OR: [
              { medicine: { name: { contains: query.search, mode: 'insensitive' } } },
              { medicine: { sku: { contains: query.search, mode: 'insensitive' } } },
              { batch: { batchNumber: { contains: query.search, mode: 'insensitive' } } },
              { reason: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.stockMovement.count({ where }),
      this.prisma.stockMovement.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { occurredAt: query.sortOrder === 'asc' ? 'asc' : 'desc' },
        include: {
          medicine: { select: { name: true, sku: true } },
          batch: { select: { batchNumber: true } },
          warehouse: { select: { name: true, code: true } },
          pharmacy: { select: { name: true, code: true } },
          performedBy: { select: { firstName: true, lastName: true } },
        },
      }),
    ]);

    const items = rows.map((row) => ({
      id: row.id,
      occurredAt: row.occurredAt,
      movementType: row.movementType,
      medicine: row.medicine.name,
      sku: row.medicine.sku,
      batch: row.batch.batchNumber,
      location:
        row.locationType === LocationType.WAREHOUSE
          ? row.warehouse?.name ?? 'Warehouse'
          : row.pharmacy?.name ?? 'Pharmacy',
      locationType: row.locationType,
      quantity: row.quantity,
      direction: row.quantity >= 0 ? 'IN' : 'OUT',
      balanceAfter: row.balanceAfter,
      referenceType: row.referenceType,
      referenceId: row.referenceId,
      performedBy: row.performedBy
        ? `${row.performedBy.firstName} ${row.performedBy.lastName}`.trim()
        : null,
      notes: row.reason,
    }));

    return this.page(items, page, limit, total);
  }

  // --- Receipts -------------------------------------------------------

  async receipts(user: AuthenticatedUser, query: ReceiptReportQueryDto) {
    if (!canViewWarehouseReports(user)) {
      throw new ForbiddenException('Not permitted to view receiving reports');
    }
    const range = parseInclusiveDateRange(query);
    const warehouseId = scopedWarehouseId(user, query.warehouseId);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.StockReceiptWhereInput = {
      AND: [
        {
          OR: [
            { receivedAt: { gte: range.start, lte: range.end } },
            {
              receivedAt: null,
              createdAt: { gte: range.start, lte: range.end },
            },
          ],
        },
        ...(warehouseId ? [{ warehouseId }] : []),
        ...(query.status ? [{ status: query.status as never }] : []),
        ...(query.receiptNumber
          ? [{ receiptNumber: { contains: query.receiptNumber, mode: 'insensitive' as const } }]
          : []),
        ...(query.search
          ? [
              {
                OR: [
                  { receiptNumber: { contains: query.search, mode: 'insensitive' as const } },
                  { supplierName: { contains: query.search, mode: 'insensitive' as const } },
                ],
              },
            ]
          : []),
        ...(query.medicineId || query.batchId
          ? [
              {
                items: {
                  some: {
                    ...(query.medicineId ? { medicineId: query.medicineId } : {}),
                    ...(query.batchId ? { batchId: query.batchId } : {}),
                  },
                },
              },
            ]
          : []),
      ],
    };

    const [total, receipts] = await this.prisma.$transaction([
      this.prisma.stockReceipt.count({ where }),
      this.prisma.stockReceipt.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { receivedAt: 'desc' },
        include: {
          warehouse: { select: { name: true, code: true } },
          createdBy: { select: { firstName: true, lastName: true } },
          postedBy: { select: { firstName: true, lastName: true } },
          items: {
            include: {
              medicine: { select: { name: true, sku: true } },
              batch: { select: { batchNumber: true } },
            },
          },
        },
      }),
    ]);

    const items = receipts.flatMap((receipt) =>
      receipt.items.map((item) => ({
        id: `${receipt.id}:${item.id}`,
        receiptNumber: receipt.receiptNumber,
        receiptDate: receipt.receivedAt,
        warehouse: receipt.warehouse.name,
        supplierReference: receipt.supplierName,
        medicine: item.medicine.name,
        sku: item.medicine.sku,
        batch: item.batch.batchNumber,
        quantity: item.quantity,
        status: receipt.status,
        createdBy: `${receipt.createdBy.firstName} ${receipt.createdBy.lastName}`.trim(),
        postedBy: receipt.postedBy
          ? `${receipt.postedBy.firstName} ${receipt.postedBy.lastName}`.trim()
          : null,
        postedDate: receipt.postedAt,
      })),
    );

    // Count is receipt-level for pagination; flatten for display within page.
    return this.page(items, page, limit, total);
  }

  // --- Supply requests ------------------------------------------------

  async supplyRequests(user: AuthenticatedUser, query: SupplyRequestReportQueryDto) {
    const range = parseInclusiveDateRange(query);
    const pharmacyId = scopedPharmacyId(user, query.pharmacyId);
    const warehouseId = scopedWarehouseId(user, query.warehouseId);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.SupplyRequestWhereInput = {
      createdAt: { gte: range.start, lte: range.end },
      ...(pharmacyId ? { pharmacyId } : {}),
      ...(warehouseId ? { warehouseId } : {}),
      ...(query.status ? { status: query.status as never } : {}),
      ...(query.requestNumber
        ? { requestNumber: { contains: query.requestNumber, mode: 'insensitive' } }
        : {}),
      ...(query.requestedById ? { createdById: query.requestedById } : {}),
      ...(query.medicineId
        ? { items: { some: { medicineId: query.medicineId } } }
        : {}),
      ...(query.search
        ? { requestNumber: { contains: query.search, mode: 'insensitive' } }
        : {}),
    };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.supplyRequest.count({ where }),
      this.prisma.supplyRequest.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          pharmacy: { select: { name: true, code: true } },
          createdBy: { select: { firstName: true, lastName: true } },
          reviewedBy: { select: { firstName: true, lastName: true } },
          items: {
            include: { medicine: { select: { name: true } } },
          },
        },
      }),
    ]);

    const items = rows.map((row) => ({
      id: row.id,
      requestNumber: row.requestNumber,
      pharmacy: row.pharmacy.name,
      createdDate: row.createdAt,
      submittedDate: row.submittedAt,
      status: row.status,
      requestedQuantities: row.items.map((i) => `${i.medicine.name}:${i.requestedQty}`).join('; '),
      approvedQuantities: row.items
        .map((i) => `${i.medicine.name}:${i.approvedQty ?? ''}`)
        .join('; '),
      requestedBy: `${row.createdBy.firstName} ${row.createdBy.lastName}`.trim(),
      reviewedBy: row.reviewedBy
        ? `${row.reviewedBy.firstName} ${row.reviewedBy.lastName}`.trim()
        : null,
      rejectionReason: row.rejectionReason,
    }));

    return this.page(items, page, limit, total);
  }

  // --- Transfers ------------------------------------------------------

  async transfers(user: AuthenticatedUser, query: TransferReportQueryDto) {
    const range = parseInclusiveDateRange(query);
    const pharmacyId = scopedPharmacyId(user, query.pharmacyId);
    const warehouseId = scopedWarehouseId(user, query.warehouseId);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.StockTransferWhereInput = {
      createdAt: { gte: range.start, lte: range.end },
      ...(pharmacyId ? { pharmacyId } : {}),
      ...(warehouseId ? { warehouseId } : {}),
      ...(query.status ? { status: query.status as never } : {}),
      ...(query.transferNumber
        ? { transferNumber: { contains: query.transferNumber, mode: 'insensitive' } }
        : {}),
      ...(query.medicineId || query.batchId
        ? {
            items: {
              some: {
                ...(query.medicineId ? { medicineId: query.medicineId } : {}),
                ...(query.batchId ? { batchId: query.batchId } : {}),
              },
            },
          }
        : {}),
      ...(query.search
        ? { transferNumber: { contains: query.search, mode: 'insensitive' } }
        : {}),
    };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.stockTransfer.count({ where }),
      this.prisma.stockTransfer.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          warehouse: { select: { name: true } },
          pharmacy: { select: { name: true } },
          supplyRequest: { select: { requestNumber: true } },
          createdBy: { select: { firstName: true, lastName: true } },
          shippedBy: { select: { firstName: true, lastName: true } },
          receivedBy: { select: { firstName: true, lastName: true } },
          items: {
            include: {
              medicine: { select: { name: true } },
              batch: { select: { batchNumber: true } },
            },
          },
        },
      }),
    ]);

    const items = rows.flatMap((row) =>
      row.items.map((item) => ({
        id: `${row.id}:${item.id}`,
        transferNumber: row.transferNumber,
        warehouse: row.warehouse.name,
        pharmacy: row.pharmacy.name,
        supplyRequest: row.supplyRequest?.requestNumber ?? null,
        status: row.status,
        createdDate: row.createdAt,
        preparedDate: row.preparedAt,
        shippedDate: row.dispatchedAt,
        receivedDate: row.receivedAt,
        medicine: item.medicine.name,
        batch: item.batch.batchNumber,
        quantity: item.quantity,
        createdBy: `${row.createdBy.firstName} ${row.createdBy.lastName}`.trim(),
        shippedBy: row.shippedBy
          ? `${row.shippedBy.firstName} ${row.shippedBy.lastName}`.trim()
          : null,
        receivedBy: row.receivedBy
          ? `${row.receivedBy.firstName} ${row.receivedBy.lastName}`.trim()
          : null,
        custodyNote:
          row.status === TransferStatus.SHIPPED || row.status === TransferStatus.IN_TRANSIT
            ? 'SHIPPED  not yet pharmacy stock'
            : row.status === TransferStatus.RECEIVED
              ? 'RECEIVED  pharmacy stock'
              : row.status,
      })),
    );

    return this.page(items, page, limit, total);
  }

  // --- Dispensing -----------------------------------------------------

  async dispensing(user: AuthenticatedUser, query: DispensingReportQueryDto) {
    if (!canViewDispensingReports(user)) {
      throw new ForbiddenException('Not permitted to view dispensing reports');
    }
    const range = parseInclusiveDateRange(query);
    const pharmacyId = scopedPharmacyId(user, query.pharmacyId);
    const showPii = includeBeneficiaryPii(user);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.DispensingRecordWhereInput = {
      dispensedAt: { gte: range.start, lte: range.end },
      ...(pharmacyId ? { pharmacyId } : {}),
      ...(query.beneficiaryId ? { beneficiaryId: query.beneficiaryId } : {}),
      ...(query.dispensedById ? { dispensedById: query.dispensedById } : {}),
      ...(query.dispensingNumber
        ? { recordNumber: { contains: query.dispensingNumber, mode: 'insensitive' } }
        : {}),
      ...(query.medicineId || query.batchId
        ? {
            items: {
              some: {
                ...(query.medicineId ? { medicineId: query.medicineId } : {}),
                ...(query.batchId ? { batchId: query.batchId } : {}),
              },
            },
          }
        : {}),
      ...(query.search
        ? {
            OR: [
              { recordNumber: { contains: query.search, mode: 'insensitive' } },
              ...(showPii
                ? [
                    { beneficiary: { name: { contains: query.search, mode: 'insensitive' as const } } },
                    {
                      beneficiary: {
                        beneficiaryNumber: { contains: query.search, mode: 'insensitive' as const },
                      },
                    },
                  ]
                : [
                    {
                      beneficiary: {
                        beneficiaryNumber: { contains: query.search, mode: 'insensitive' as const },
                      },
                    },
                  ]),
            ],
          }
        : {}),
    };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.dispensingRecord.count({ where }),
      this.prisma.dispensingRecord.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { dispensedAt: 'desc' },
        include: {
          pharmacy: { select: { name: true } },
          beneficiary: { select: { beneficiaryNumber: true, name: true } },
          dispensedBy: { select: { firstName: true, lastName: true } },
          items: {
            include: {
              medicine: { select: { name: true } },
              batch: { select: { batchNumber: true } },
            },
          },
        },
      }),
    ]);

    const items = rows.flatMap((row) =>
      row.items.map((item) => {
        const unit = item.referenceValue != null ? Number(item.referenceValue) : null;
        return {
          id: `${row.id}:${item.id}`,
          dispensingNumber: row.recordNumber,
          dispensedAt: row.dispensedAt,
          pharmacy: row.pharmacy.name,
          beneficiaryNumber: row.beneficiary.beneficiaryNumber,
          beneficiaryName: showPii ? row.beneficiary.name : null,
          medicine: item.medicine.name,
          batch: item.batch.batchNumber,
          quantity: item.quantity,
          estimatedUnitValue: unit,
          estimatedValue: estimatedValue(item.quantity, item.referenceValue),
          dispensedBy: `${row.dispensedBy.firstName} ${row.dispensedBy.lastName}`.trim(),
        };
      }),
    );

    return this.page(items, page, limit, total);
  }

  async dispensingSummary(user: AuthenticatedUser, query: DispensingReportQueryDto) {
    if (!canViewDispensingReports(user)) {
      throw new ForbiddenException('Not permitted to view dispensing reports');
    }
    const range = parseInclusiveDateRange(query);
    const pharmacyId = scopedPharmacyId(user, query.pharmacyId);
    const where: Prisma.DispensingRecordWhereInput = {
      dispensedAt: { gte: range.start, lte: range.end },
      ...(pharmacyId ? { pharmacyId } : {}),
    };

    const [transactions, qtyAgg, beneficiaries, medicineGroups, items] = await Promise.all([
      this.prisma.dispensingRecord.count({ where }),
      this.prisma.dispensingItem.aggregate({
        where: { record: where },
        _sum: { quantity: true },
      }),
      this.prisma.dispensingRecord.groupBy({ by: ['beneficiaryId'], where }),
      this.prisma.dispensingItem.groupBy({
        by: ['medicineId'],
        where: { record: where },
        _sum: { quantity: true },
      }),
      this.prisma.dispensingItem.findMany({
        where: { record: where },
        select: {
          quantity: true,
          referenceValue: true,
          medicineId: true,
          record: { select: { pharmacyId: true, dispensedAt: true, pharmacy: { select: { name: true } } } },
          medicine: { select: { name: true, categoryId: true, category: { select: { name: true } } } },
        },
      }),
    ]);

    let estimatedTotal: number | null = null;
    let hasValue = false;
    for (const item of items) {
      const v = estimatedValue(item.quantity, item.referenceValue);
      if (v != null) {
        hasValue = true;
        estimatedTotal = (estimatedTotal ?? 0) + v;
      }
    }

    const byDay = new Map<string, number>();
    const byPharmacy = new Map<string, number>();
    const byMedicine = new Map<string, number>();
    const byCategory = new Map<string, number>();

    for (const item of items) {
      const day = item.record.dispensedAt.toISOString().slice(0, 10);
      byDay.set(day, (byDay.get(day) ?? 0) + item.quantity);
      const ph = item.record.pharmacy.name;
      byPharmacy.set(ph, (byPharmacy.get(ph) ?? 0) + item.quantity);
      byMedicine.set(item.medicine.name, (byMedicine.get(item.medicine.name) ?? 0) + item.quantity);
      const cat = item.medicine.category?.name ?? 'Uncategorized';
      byCategory.set(cat, (byCategory.get(cat) ?? 0) + item.quantity);
    }

    return {
      period: range.label,
      totalDispensingTransactions: transactions,
      totalQuantitiesDispensed: qtyAgg._sum.quantity ?? 0,
      uniqueBeneficiaries: beneficiaries.length,
      medicinesDispensedCount: medicineGroups.length,
      estimatedTotalValue: hasValue ? estimatedTotal : null,
      byDay: [...byDay.entries()].map(([day, quantity]) => ({ day, quantity })),
      byPharmacy: [...byPharmacy.entries()].map(([pharmacy, quantity]) => ({ pharmacy, quantity })),
      byMedicine: [...byMedicine.entries()]
        .map(([medicine, quantity]) => ({ medicine, quantity }))
        .sort((a, b) => b.quantity - a.quantity)
        .slice(0, 20),
      byCategory: [...byCategory.entries()].map(([category, quantity]) => ({ category, quantity })),
    };
  }

  // --- Beneficiaries --------------------------------------------------

  async beneficiaries(user: AuthenticatedUser, query: BeneficiaryReportQueryDto) {
    assertCanViewBeneficiaryReports(user);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const pharmacyId = scopedPharmacyId(user, query.pharmacyId);
    const period = (query.period ?? '').toUpperCase();
    const range =
      period === 'ALL' && !query.dateFrom && !query.dateTo
        ? null
        : query.dateFrom || query.dateTo || (period && period !== 'ALL')
          ? parseInclusiveDateRange({
              period: query.period,
              dateFrom: query.dateFrom,
              dateTo: query.dateTo,
            })
          : null;

    const where: Prisma.BeneficiaryWhereInput = {
      deletedAt: null,
      ...(query.status === 'ACTIVE' ? { isActive: true } : {}),
      ...(query.status === 'INACTIVE' ? { isActive: false } : {}),
      ...(range ? { createdAt: { gte: range.start, lte: range.end } } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { beneficiaryNumber: { contains: query.search, mode: 'insensitive' } },
              { phone: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(pharmacyId
        ? { dispensingRecords: { some: { pharmacyId } } }
        : {}),
    };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.beneficiary.count({ where }),
      this.prisma.beneficiary.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          _count: { select: { dispensingRecords: true } },
          dispensingRecords: {
            orderBy: { dispensedAt: 'desc' },
            take: 1,
            select: { dispensedAt: true },
            ...(pharmacyId ? { where: { pharmacyId } } : {}),
          },
        },
      }),
    ]);

    const items = rows.map((row) => ({
      id: row.id,
      beneficiaryNumber: row.beneficiaryNumber,
      fullName: row.name,
      phone: row.phone,
      status: row.isActive ? 'ACTIVE' : 'INACTIVE',
      createdDate: row.createdAt,
      dispensingCount: row._count.dispensingRecords,
      lastDispensingDate: row.dispensingRecords[0]?.dispensedAt ?? null,
    }));

    return this.page(items, page, limit, total);
  }

  // --- Expiry ---------------------------------------------------------

  async expiry(user: AuthenticatedUser, query: ReportBaseQueryDto) {
    const today = todayUtc();
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const [wh, ph] = await Promise.all([
      canViewWarehouseReports(user)
        ? this.fetchWarehouseStockRows(user, { ...query, page: 1, limit: 10000 })
        : Promise.resolve([]),
      canViewPharmacyReports(user)
        ? this.fetchPharmacyStockRows(user, { ...query, page: 1, limit: 10000 })
        : Promise.resolve([]),
    ]);

    let rows = [...wh, ...ph]
      .filter((row) => Number(row.quantity) > 0)
      .map((row) => {
        const expiryDate = new Date(String(row.expiryDate));
        const status = expiryStatus(expiryDate);
        return {
          medicine: row.medicine,
          sku: row.sku,
          batch: row.batch,
          location: row.location,
          locationType: row.locationType,
          quantity: row.quantity,
          expiryDate,
          daysUntilExpiry: daysUntilExpiry(expiryDate, today),
          status,
        };
      });

    if (query.expiryStatus) {
      rows = rows.filter((r) => r.status === query.expiryStatus);
    }

    rows.sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);
    const total = rows.length;
    return this.page(rows.slice((page - 1) * limit, page * limit), page, limit, total);
  }

  // --- Low stock ------------------------------------------------------

  /**
   * LOW_STOCK uses existing medicine.minimumStock threshold:
   * total quantity for the medicine at the location <= minimumStock (and > 0).
   */
  async lowStock(user: AuthenticatedUser, query: ReportBaseQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const [wh, ph] = await Promise.all([
      canViewWarehouseReports(user)
        ? this.fetchWarehouseStockRows(user, { ...query, page: 1, limit: 10000 })
        : Promise.resolve([]),
      canViewPharmacyReports(user)
        ? this.fetchPharmacyStockRows(user, { ...query, page: 1, limit: 10000 })
        : Promise.resolve([]),
    ]);

    const byKey = new Map<
      string,
      {
        medicine: unknown;
        sku: unknown;
        location: unknown;
        locationType: unknown;
        unit: unknown;
        quantity: number;
        threshold: number;
      }
    >();

    for (const row of [...wh, ...ph]) {
      const key = `${row.locationType}:${row.location}:${row.medicineId}`;
      const existing = byKey.get(key);
      const qty = Number(row.quantity);
      if (existing) {
        existing.quantity += qty;
      } else {
        byKey.set(key, {
          medicine: row.medicine,
          sku: row.sku,
          location: row.location,
          locationType: row.locationType,
          unit: row.unit,
          quantity: qty,
          threshold: Number(row.minimumStock ?? 0),
        });
      }
    }

    const rows = [...byKey.values()]
      .filter((row) => row.quantity > 0 && row.quantity <= row.threshold)
      .map((row) => ({
        ...row,
        stockStatus: 'LOW_STOCK',
        thresholdNote: 'Based on medicine.minimumStock (existing catalog threshold)',
      }));

    const total = rows.length;
    return this.page(rows.slice((page - 1) * limit, page * limit), page, limit, total);
  }

  // --- Legacy period summaries (kept for existing UI during migration) -

  async warehousePeriod(period: string, from?: string, to?: string) {
    const range = parseInclusiveDateRange({ period, dateFrom: from, dateTo: to });
    const [opening, periodRows] = await Promise.all([
      this.sumByType({ occurredAt: { lt: range.start }, locationType: LocationType.WAREHOUSE }),
      this.sumByType({
        occurredAt: { gte: range.start, lte: range.end },
        locationType: LocationType.WAREHOUSE,
      }),
    ]);
    const openingStock = Object.values(opening).reduce((s, v) => s + v, 0);
    const closingStock = openingStock + Object.values(periodRows).reduce((s, v) => s + v, 0);
    return { period, start: range.start, end: range.end, openingStock, movements: periodRows, closingStock };
  }

  async pharmacyPeriod(period: string, pharmacyId?: string, from?: string, to?: string) {
    const range = parseInclusiveDateRange({ period, dateFrom: from, dateTo: to });
    const filter = {
      locationType: LocationType.PHARMACY,
      ...(pharmacyId ? { pharmacyId } : {}),
    };
    const [opening, periodRows] = await Promise.all([
      this.sumByType({ ...filter, occurredAt: { lt: range.start } }),
      this.sumByType({ ...filter, occurredAt: { gte: range.start, lte: range.end } }),
    ]);
    const openingStock = Object.values(opening).reduce((s, v) => s + v, 0);
    const closingStock = openingStock + Object.values(periodRows).reduce((s, v) => s + v, 0);
    return { period, start: range.start, end: range.end, openingStock, movements: periodRows, closingStock };
  }

  // --- Export ---------------------------------------------------------

  async export(
    user: AuthenticatedUser,
    reportType: string,
    format: ExportFormat,
    query: Record<string, unknown>,
  ) {
    assertCanExport(user);
    const limit = Math.min(Number(query.limit ?? 5000), 10000);
    const q = { ...query, page: 1, limit: limit };

    const { rows, columns, title, filterSummary } = await this.loadExportDataset(
      user,
      reportType,
      q,
    );

    const payload: ReportExportPayload = {
      reportType,
      title,
      generatedAt: new Date(),
      filterSummary,
      columns,
      rows,
    };

    await this.audit.record({
      userId: user.id,
      action: AuditAction.EXPORT_REPORT,
      entityType: 'Report',
      entityId: reportType,
      newValues: {
        reportType,
        format,
        filterSummary,
        rowCount: rows.length,
      },
    });

    return renderExport(format, payload);
  }

  private async loadExportDataset(
    user: AuthenticatedUser,
    reportType: string,
    query: Record<string, unknown>,
  ): Promise<{
    rows: Record<string, unknown>[];
    columns: ReportColumn[];
    title: string;
    filterSummary: string;
  }> {
    const filterSummary = Object.entries(query)
      .filter(([k, v]) => v != null && v !== '' && !['page', 'limit', 'format'].includes(k))
      .map(([k, v]) => `${k}=${v}`)
      .join(', ');

    const asPage = async <T extends Record<string, unknown>>(
      fn: () => Promise<PaginatedReport<T>>,
      title: string,
      columns: ReportColumn[],
    ) => {
      const result = await fn();
      return { rows: result.items, columns, title, filterSummary };
    };

    switch (reportType) {
      case 'inventory':
        return asPage(
          () => this.inventory(user, query as never),
          'Inventory report',
          this.cols([
            'medicine',
            'sku',
            'category',
            'batch',
            'expiryDate',
            'location',
            'locationType',
            'quantity',
            'unit',
            'stockStatus',
            'estimatedUnitValue',
            'estimatedStockValue',
          ]),
        );
      case 'warehouse-stock':
        return asPage(
          () => this.warehouseStock(user, query as never),
          'Warehouse stock report',
          this.cols([
            'medicine',
            'batch',
            'expiryDate',
            'quantity',
            'unit',
            'stockStatus',
            'estimatedUnitValue',
            'estimatedStockValue',
            'lastMovementDate',
          ]),
        );
      case 'pharmacy-stock':
        return asPage(
          () => this.pharmacyStock(user, query as never),
          'Pharmacy stock report',
          this.cols([
            'pharmacy',
            'medicine',
            'batch',
            'expiryDate',
            'quantity',
            'unit',
            'stockStatus',
            'estimatedUnitValue',
            'estimatedStockValue',
            'lastMovementDate',
          ]),
        );
      case 'stock-movements':
        return asPage(
          () => this.stockMovements(user, query as never),
          'Stock movements report',
          this.cols([
            'occurredAt',
            'movementType',
            'medicine',
            'batch',
            'location',
            'quantity',
            'direction',
            'referenceType',
            'performedBy',
            'notes',
          ]),
        );
      case 'receipts':
        return asPage(
          () => this.receipts(user, query as never),
          'Warehouse receiving report',
          this.cols([
            'receiptNumber',
            'receiptDate',
            'warehouse',
            'supplierReference',
            'medicine',
            'batch',
            'quantity',
            'status',
            'createdBy',
            'postedBy',
            'postedDate',
          ]),
        );
      case 'supply-requests':
        return asPage(
          () => this.supplyRequests(user, query as never),
          'Supply requests report',
          this.cols([
            'requestNumber',
            'pharmacy',
            'createdDate',
            'submittedDate',
            'status',
            'requestedQuantities',
            'approvedQuantities',
            'requestedBy',
            'reviewedBy',
            'rejectionReason',
          ]),
        );
      case 'transfers':
        return asPage(
          () => this.transfers(user, query as never),
          'Transfers report',
          this.cols([
            'transferNumber',
            'warehouse',
            'pharmacy',
            'status',
            'createdDate',
            'shippedDate',
            'receivedDate',
            'medicine',
            'batch',
            'quantity',
            'custodyNote',
          ]),
        );
      case 'dispensing':
        return asPage(
          () => this.dispensing(user, query as never),
          'Dispensing report',
          this.cols([
            'dispensingNumber',
            'dispensedAt',
            'pharmacy',
            'beneficiaryNumber',
            'beneficiaryName',
            'medicine',
            'batch',
            'quantity',
            'estimatedUnitValue',
            'estimatedValue',
            'dispensedBy',
          ]),
        );
      case 'beneficiaries':
        return asPage(
          () => this.beneficiaries(user, query as never),
          'Beneficiaries report',
          this.cols([
            'beneficiaryNumber',
            'fullName',
            'phone',
            'status',
            'createdDate',
            'dispensingCount',
            'lastDispensingDate',
          ]),
        );
      case 'expiry':
        return asPage(
          () => this.expiry(user, query as never),
          'Expiry report',
          this.cols([
            'medicine',
            'batch',
            'location',
            'locationType',
            'quantity',
            'expiryDate',
            'daysUntilExpiry',
            'status',
          ]),
        );
      case 'low-stock':
        return asPage(
          () => this.lowStock(user, query as never),
          'Low stock report',
          this.cols([
            'medicine',
            'location',
            'locationType',
            'quantity',
            'unit',
            'threshold',
            'stockStatus',
          ]),
        );
      default:
        throw new ForbiddenException(`Unknown report type: ${reportType}`);
    }
  }

  // --- helpers --------------------------------------------------------

  private cols(keys: string[]): ReportColumn[] {
    return keys.map((key) => ({
      key,
      header: key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()),
    }));
  }

  private page<T>(items: T[], page: number, limit: number, total: number): PaginatedReport<T> {
    return {
      items,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  private async fetchWarehouseStockRows(
    user: AuthenticatedUser,
    query: ReportBaseQueryDto & { warehouseId?: string },
  ): Promise<Record<string, unknown>[]> {
    const warehouseId = scopedWarehouseId(user, query.warehouseId);
    const today = todayUtc();
    const warning = expiryWarningDate(await this.settings.getExpiryWarningDays());

    const where: Prisma.WarehouseStockWhereInput = {
      ...(warehouseId ? { warehouseId } : {}),
      ...(query.medicineId ? { medicineId: query.medicineId } : {}),
      ...(query.batchId ? { batchId: query.batchId } : {}),
      ...(query.categoryId ? { medicine: { categoryId: query.categoryId } } : {}),
      ...(query.expiryStatus === 'EXPIRED' ? { batch: { expiryDate: { lt: today } } } : {}),
      ...(query.expiryStatus === 'EXPIRING_SOON'
        ? { batch: { expiryDate: { gte: today, lte: warning } } }
        : {}),
      ...(query.expiryStatus === 'VALID' ? { batch: { expiryDate: { gt: warning } } } : {}),
      ...(query.search
        ? {
            OR: [
              { medicine: { name: { contains: query.search, mode: 'insensitive' } } },
              { medicine: { sku: { contains: query.search, mode: 'insensitive' } } },
              { batch: { batchNumber: { contains: query.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const rows = await this.prisma.warehouseStock.findMany({
      where,
      take: query.limit ?? 5000,
      skip: ((query.page ?? 1) - 1) * (query.limit ?? 5000),
      include: {
        medicine: { include: { unit: true, category: true } },
        batch: true,
        warehouse: true,
      },
      orderBy: [{ medicine: { name: 'asc' } }, { batch: { expiryDate: 'asc' } }],
    });

    const medicineIds = [...new Set(rows.map((r) => r.medicineId))];
    const totals = await this.medicineTotals('WAREHOUSE', medicineIds, warehouseId);
    const lastMoves = await this.lastMovements(
      LocationType.WAREHOUSE,
      rows.map((r) => ({ medicineId: r.medicineId, batchId: r.batchId, locationId: r.warehouseId })),
    );

    return rows.map((row) => {
      const expiry = expiryStatus(row.batch.expiryDate);
      const medicineTotal = totals.get(row.medicineId) ?? 0;
      const unit = row.medicine.referenceValue != null ? Number(row.medicine.referenceValue) : null;
      return {
        id: row.id,
        medicineId: row.medicineId,
        medicine: row.medicine.name,
        sku: row.medicine.sku,
        category: row.medicine.category?.name ?? null,
        batch: row.batch.batchNumber,
        expiryDate: row.batch.expiryDate,
        location: row.warehouse.name,
        locationType: 'WAREHOUSE',
        quantity: row.quantity,
        unit: row.medicine.unit?.name ?? null,
        minimumStock: row.medicine.minimumStock,
        expiryStatus: expiry,
        stockStatus: stockStatusLabel({
          quantity: row.quantity,
          medicineTotal,
          minimumStock: row.medicine.minimumStock,
          expiry,
        }),
        estimatedUnitValue: unit,
        estimatedStockValue: estimatedValue(row.quantity, row.medicine.referenceValue),
        lastMovementDate:
          lastMoves.get(`${row.warehouseId}:${row.medicineId}:${row.batchId}`) ?? null,
      };
    });
  }

  private async fetchPharmacyStockRows(
    user: AuthenticatedUser,
    query: ReportBaseQueryDto & { pharmacyId?: string },
  ): Promise<Record<string, unknown>[]> {
    const pharmacyId = scopedPharmacyId(user, query.pharmacyId);
    const today = todayUtc();
    const warning = expiryWarningDate(await this.settings.getExpiryWarningDays());

    const where: Prisma.PharmacyStockWhereInput = {
      ...(pharmacyId ? { pharmacyId } : {}),
      ...(query.medicineId ? { medicineId: query.medicineId } : {}),
      ...(query.batchId ? { batchId: query.batchId } : {}),
      ...(query.categoryId ? { medicine: { categoryId: query.categoryId } } : {}),
      ...(query.expiryStatus === 'EXPIRED' ? { batch: { expiryDate: { lt: today } } } : {}),
      ...(query.expiryStatus === 'EXPIRING_SOON'
        ? { batch: { expiryDate: { gte: today, lte: warning } } }
        : {}),
      ...(query.expiryStatus === 'VALID' ? { batch: { expiryDate: { gt: warning } } } : {}),
      ...(query.search
        ? {
            OR: [
              { medicine: { name: { contains: query.search, mode: 'insensitive' } } },
              { medicine: { sku: { contains: query.search, mode: 'insensitive' } } },
              { batch: { batchNumber: { contains: query.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const rows = await this.prisma.pharmacyStock.findMany({
      where,
      take: query.limit ?? 5000,
      skip: ((query.page ?? 1) - 1) * (query.limit ?? 5000),
      include: {
        medicine: { include: { unit: true, category: true } },
        batch: true,
        pharmacy: true,
      },
      orderBy: [{ medicine: { name: 'asc' } }, { batch: { expiryDate: 'asc' } }],
    });

    const medicineIds = [...new Set(rows.map((r) => r.medicineId))];
    const totals = await this.medicineTotals('PHARMACY', medicineIds, pharmacyId);
    const lastMoves = await this.lastMovements(
      LocationType.PHARMACY,
      rows.map((r) => ({ medicineId: r.medicineId, batchId: r.batchId, locationId: r.pharmacyId })),
    );

    return rows.map((row) => {
      const expiry = expiryStatus(row.batch.expiryDate);
      const medicineTotal = totals.get(row.medicineId) ?? 0;
      const unit = row.medicine.referenceValue != null ? Number(row.medicine.referenceValue) : null;
      return {
        id: row.id,
        medicineId: row.medicineId,
        pharmacy: row.pharmacy.name,
        medicine: row.medicine.name,
        sku: row.medicine.sku,
        category: row.medicine.category?.name ?? null,
        batch: row.batch.batchNumber,
        expiryDate: row.batch.expiryDate,
        location: row.pharmacy.name,
        locationType: 'PHARMACY',
        quantity: row.quantity,
        unit: row.medicine.unit?.name ?? null,
        minimumStock: row.medicine.minimumStock,
        expiryStatus: expiry,
        stockStatus: stockStatusLabel({
          quantity: row.quantity,
          medicineTotal,
          minimumStock: row.medicine.minimumStock,
          expiry,
        }),
        estimatedUnitValue: unit,
        estimatedStockValue: estimatedValue(row.quantity, row.medicine.referenceValue),
        lastMovementDate:
          lastMoves.get(`${row.pharmacyId}:${row.medicineId}:${row.batchId}`) ?? null,
      };
    });
  }

  private async medicineTotals(
    location: 'WAREHOUSE' | 'PHARMACY',
    medicineIds: string[],
    locationId?: string,
  ) {
    if (!medicineIds.length) return new Map<string, number>();
    if (location === 'WAREHOUSE') {
      const groups = await this.prisma.warehouseStock.groupBy({
        by: ['medicineId'],
        where: {
          medicineId: { in: medicineIds },
          ...(locationId ? { warehouseId: locationId } : {}),
        },
        _sum: { quantity: true },
      });
      return new Map(groups.map((g) => [g.medicineId, g._sum.quantity ?? 0]));
    }
    const groups = await this.prisma.pharmacyStock.groupBy({
      by: ['medicineId'],
      where: {
        medicineId: { in: medicineIds },
        ...(locationId ? { pharmacyId: locationId } : {}),
      },
      _sum: { quantity: true },
    });
    return new Map(groups.map((g) => [g.medicineId, g._sum.quantity ?? 0]));
  }

  private async lastMovements(
    locationType: LocationType,
    keys: Array<{ medicineId: string; batchId: string; locationId: string }>,
  ) {
    const map = new Map<string, Date>();
    if (!keys.length) return map;

    // One query for recent movements, then pick latest per key in memory.
    const medicineIds = [...new Set(keys.map((k) => k.medicineId))];
    const movements = await this.prisma.stockMovement.findMany({
      where: {
        locationType,
        medicineId: { in: medicineIds },
      },
      select: {
        medicineId: true,
        batchId: true,
        warehouseId: true,
        pharmacyId: true,
        occurredAt: true,
      },
      orderBy: { occurredAt: 'desc' },
      take: 5000,
    });

    for (const m of movements) {
      const locationId =
        locationType === LocationType.WAREHOUSE ? m.warehouseId : m.pharmacyId;
      if (!locationId) continue;
      const key = `${locationId}:${m.medicineId}:${m.batchId}`;
      if (!map.has(key)) map.set(key, m.occurredAt);
    }
    return map;
  }

  private async sumByType(where: object) {
    const grouped = await this.prisma.stockMovement.groupBy({
      by: ['movementType'],
      where,
      _sum: { quantity: true },
    });
    const result: Record<string, number> = {};
    for (const row of grouped) {
      result[row.movementType] = row._sum.quantity ?? 0;
    }
    return result;
  }
}
