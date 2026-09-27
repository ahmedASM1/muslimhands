import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, RoleCode, type AuthenticatedUser } from '@mh/shared';
import {
  NotificationSeverity,
  NotificationType,
  Prisma,
  SupplyRequestStatus,
  TransferStatus,
} from '@prisma/client';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { requirePharmacyId, resolvePharmacyId } from '../../common/access/access';
import { nextDocumentNumber } from '../../common/inventory/document-numbers';
import { InventoryTransactionService } from '../../common/inventory/inventory-transaction.service';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';

export class TransferQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  pharmacyId?: string;

  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @IsOptional()
  @IsEnum(TransferStatus)
  status?: TransferStatus;
}

export interface TransferItemInput {
  medicineId: string;
  batchId: string;
  quantity: number;
  notes?: string;
}

const SHIPPED_STATUSES: TransferStatus[] = [
  TransferStatus.SHIPPED,
  TransferStatus.IN_TRANSIT,
];

@Injectable()
export class TransfersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventoryTx: InventoryTransactionService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(user: AuthenticatedUser, query: TransferQueryDto) {
    const pharmacyId = this.scopePharmacyId(user, query.pharmacyId);
    const where: Prisma.StockTransferWhereInput = {
      ...(pharmacyId ? { pharmacyId } : {}),
      ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { transferNumber: { contains: query.search, mode: 'insensitive' } },
              { notes: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.stockTransfer.count({ where }),
      this.prisma.stockTransfer.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { createdAt: 'desc' },
        include: this.detailInclude(),
      }),
    ]);
    return {
      items,
      meta: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) },
    };
  }

  async get(id: string, user: AuthenticatedUser) {
    const transfer = await this.prisma.stockTransfer.findUnique({
      where: { id },
      include: this.detailInclude(),
    });
    if (!transfer) throw new NotFoundException('Transfer not found');
    this.assertCanView(user, transfer.pharmacyId);
    return transfer;
  }

  async create(
    user: AuthenticatedUser,
    data: {
      warehouseId: string;
      pharmacyId: string;
      supplyRequestId?: string;
      notes?: string;
      items: TransferItemInput[];
    },
  ) {
    this.assertWarehouseOperator(user);
    if (!data.items?.length) {
      throw new BadRequestException('At least one transfer item is required');
    }

    await this.assertLocations(data.warehouseId, data.pharmacyId);
    await this.validateItems(data.items);

    if (data.supplyRequestId) {
      await this.assertSupplyRequestLink(data.supplyRequestId, data.pharmacyId, data.items);
    }

    const transfer = await this.prisma.$transaction(async (tx) => {
      const transferNumber = await nextDocumentNumber(tx, 'stockTransfer', 'TR');
      return tx.stockTransfer.create({
        data: {
          transferNumber,
          warehouseId: data.warehouseId,
          pharmacyId: data.pharmacyId,
          supplyRequestId: data.supplyRequestId,
          notes: data.notes?.trim() || null,
          createdById: user.id,
          status: TransferStatus.DRAFT,
          items: {
            create: data.items.map((item) => ({
              medicineId: item.medicineId,
              batchId: item.batchId,
              quantity: item.quantity,
              notes: item.notes?.trim() || null,
            })),
          },
        },
        include: this.detailInclude(),
      });
    });

    await this.audit.record({
      userId: user.id,
      action: AuditAction.CREATE_TRANSFER,
      entityType: 'StockTransfer',
      entityId: transfer.id,
      newValues: { transferNumber: transfer.transferNumber },
    });

    return transfer;
  }

  async update(
    id: string,
    user: AuthenticatedUser,
    data: {
      notes?: string;
      items?: TransferItemInput[];
    },
  ) {
    this.assertWarehouseOperator(user);
    const existing = await this.prisma.stockTransfer.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Transfer not found');
    if (existing.status !== TransferStatus.DRAFT) {
      throw new BadRequestException('Only draft transfers can be edited');
    }

    if (data.items) {
      if (!data.items.length) {
        throw new BadRequestException('At least one transfer item is required');
      }
      await this.validateItems(data.items);
      if (existing.supplyRequestId) {
        await this.assertSupplyRequestLink(
          existing.supplyRequestId,
          existing.pharmacyId,
          data.items,
        );
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.stockTransfer.update({
        where: { id },
        data: { notes: data.notes?.trim() },
      });
      if (data.items) {
        await tx.stockTransferItem.deleteMany({ where: { transferId: id } });
        for (const item of data.items) {
          await tx.stockTransferItem.create({
            data: {
              transferId: id,
              medicineId: item.medicineId,
              batchId: item.batchId,
              quantity: item.quantity,
              notes: item.notes?.trim() || null,
            },
          });
        }
      }
    });

    return this.get(id, user);
  }

  async prepare(id: string, user: AuthenticatedUser) {
    this.assertWarehouseOperator(user);

    const prepared = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string; status: TransferStatus }>>`
        SELECT id, status FROM stock_transfers WHERE id = ${id}::uuid FOR UPDATE
      `;
      if (!locked.length) throw new NotFoundException('Transfer not found');
      if (locked[0]!.status !== TransferStatus.DRAFT) {
        throw new ConflictException('Transfer is not in DRAFT status');
      }

      const transfer = await tx.stockTransfer.findUnique({
        where: { id },
        include: { items: true },
      });
      if (!transfer?.items.length) {
        throw new BadRequestException('Cannot prepare a transfer with no items');
      }

      await this.validateItems(transfer.items, tx);

      return tx.stockTransfer.update({
        where: { id },
        data: {
          status: TransferStatus.PREPARED,
          preparedById: user.id,
          preparedAt: new Date(),
        },
        include: this.detailInclude(),
      });
    });

    await this.audit.record({
      userId: user.id,
      action: AuditAction.PREPARE_TRANSFER,
      entityType: 'StockTransfer',
      entityId: id,
    });

    return prepared;
  }

  async ship(id: string, user: AuthenticatedUser) {
    this.assertWarehouseOperator(user);

    const shipped = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string; status: TransferStatus }>>`
        SELECT id, status FROM stock_transfers WHERE id = ${id}::uuid FOR UPDATE
      `;
      if (!locked.length) throw new NotFoundException('Transfer not found');
      if (locked[0]!.status !== TransferStatus.PREPARED) {
        throw new ConflictException('Only prepared transfers can be shipped');
      }

      const transfer = await tx.stockTransfer.findUnique({
        where: { id },
        include: { items: true },
      });
      if (!transfer) throw new NotFoundException('Transfer not found');

      for (const item of transfer.items) {
        await this.inventoryTx.transferOut(tx, {
          warehouseId: transfer.warehouseId,
          medicineId: item.medicineId,
          batchId: item.batchId,
          quantity: item.quantity,
          transferId: transfer.id,
          performedById: user.id,
          notes: item.notes ?? undefined,
        });
      }

      if (transfer.supplyRequestId) {
        await this.applyFulfillment(tx, transfer.supplyRequestId, transfer.items);
      }

      return tx.stockTransfer.update({
        where: { id },
        data: {
          status: TransferStatus.SHIPPED,
          shippedById: user.id,
          dispatchedAt: new Date(),
        },
        include: this.detailInclude(),
      });
    });

    await this.audit.record({
      userId: user.id,
      action: AuditAction.SHIP_TRANSFER,
      entityType: 'StockTransfer',
      entityId: id,
    });

    await this.notifications.notifyRoles(
      [RoleCode.PHARMACY_MANAGER, RoleCode.PHARMACY_STAFF],
      {
        type: NotificationType.TRANSFER_AWAITING_RECEIPT,
        title: 'Transfer awaiting receipt',
        message: `Transfer ${shipped.transferNumber} is awaiting receipt at the pharmacy.`,
        entityType: 'StockTransfer',
        entityId: id,
        severity: NotificationSeverity.WARNING,
        dedupeKey: `TRANSFER_AWAITING_RECEIPT:${id}`,
        href: '/pharmacy/transfers',
        pharmacyId: shipped.pharmacyId,
        warehouseId: shipped.warehouseId,
      },
    );

    return shipped;
  }

  async receive(id: string, user: AuthenticatedUser) {
    const received = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string; status: TransferStatus; pharmacy_id: string }>>`
        SELECT id, status, pharmacy_id FROM stock_transfers WHERE id = ${id}::uuid FOR UPDATE
      `;
      if (!locked.length) throw new NotFoundException('Transfer not found');
      if (!SHIPPED_STATUSES.includes(locked[0]!.status)) {
        throw new ConflictException('Only shipped transfers can be received');
      }

      requirePharmacyId(user, locked[0]!.pharmacy_id);

      const transfer = await tx.stockTransfer.findUnique({
        where: { id },
        include: { items: true },
      });
      if (!transfer) throw new NotFoundException('Transfer not found');

      for (const item of transfer.items) {
        const remaining = item.quantity - item.receivedQty;
        if (remaining <= 0) continue;
        await this.inventoryTx.transferIn(tx, {
          pharmacyId: transfer.pharmacyId,
          medicineId: item.medicineId,
          batchId: item.batchId,
          quantity: remaining,
          transferId: transfer.id,
          performedById: user.id,
          notes: item.notes ?? undefined,
        });
        await tx.stockTransferItem.update({
          where: { id: item.id },
          data: { receivedQty: item.quantity },
        });
      }

      return tx.stockTransfer.update({
        where: { id },
        data: {
          status: TransferStatus.RECEIVED,
          receivedById: user.id,
          receivedAt: new Date(),
        },
        include: this.detailInclude(),
      });
    });

    await this.audit.record({
      userId: user.id,
      action: AuditAction.RECEIVE_TRANSFER,
      entityType: 'StockTransfer',
      entityId: id,
    });

    await this.notifications.resolveByDedupeKey(`TRANSFER_AWAITING_RECEIPT:${id}`);

    return received;
  }

  async cancel(id: string, user: AuthenticatedUser) {
    this.assertWarehouseOperator(user);

    const cancelled = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string; status: TransferStatus }>>`
        SELECT id, status FROM stock_transfers WHERE id = ${id}::uuid FOR UPDATE
      `;
      if (!locked.length) throw new NotFoundException('Transfer not found');
      const status = locked[0]!.status;
      if (status !== TransferStatus.DRAFT && status !== TransferStatus.PREPARED) {
        throw new BadRequestException('Shipped transfers cannot be cancelled');
      }

      return tx.stockTransfer.update({
        where: { id },
        data: { status: TransferStatus.CANCELLED },
        include: this.detailInclude(),
      });
    });

    await this.audit.record({
      userId: user.id,
      action: AuditAction.CANCEL_TRANSFER,
      entityType: 'StockTransfer',
      entityId: id,
    });

    return cancelled;
  }

  private detailInclude() {
    return {
      warehouse: true,
      pharmacy: true,
      supplyRequest: {
        include: { items: { include: { medicine: true } } },
      },
      createdBy: { select: { firstName: true, lastName: true } },
      preparedBy: { select: { firstName: true, lastName: true } },
      shippedBy: { select: { firstName: true, lastName: true } },
      receivedBy: { select: { firstName: true, lastName: true } },
      items: { include: { medicine: { include: { unit: true } }, batch: true } },
    } as const;
  }

  private scopePharmacyId(user: AuthenticatedUser, requested?: string) {
    if (
      user.roles.includes(RoleCode.SUPER_ADMIN) ||
      user.roles.includes(RoleCode.WAREHOUSE_MANAGER) ||
      user.roles.includes(RoleCode.WAREHOUSE_STAFF) ||
      user.roles.includes(RoleCode.REPORT_VIEWER)
    ) {
      return requested;
    }
    return resolvePharmacyId(user, requested);
  }

  private assertCanView(user: AuthenticatedUser, pharmacyId: string) {
    if (
      user.roles.includes(RoleCode.SUPER_ADMIN) ||
      user.roles.includes(RoleCode.WAREHOUSE_MANAGER) ||
      user.roles.includes(RoleCode.WAREHOUSE_STAFF) ||
      user.roles.includes(RoleCode.REPORT_VIEWER)
    ) {
      return;
    }
    requirePharmacyId(user, pharmacyId);
  }

  private assertWarehouseOperator(user: AuthenticatedUser) {
    if (
      user.roles.includes(RoleCode.SUPER_ADMIN) ||
      user.roles.includes(RoleCode.WAREHOUSE_MANAGER) ||
      user.roles.includes(RoleCode.WAREHOUSE_STAFF)
    ) {
      return;
    }
    throw new ForbiddenException('Only warehouse users can manage transfers');
  }

  private async assertLocations(warehouseId: string, pharmacyId: string) {
    const [warehouse, pharmacy] = await Promise.all([
      this.prisma.warehouse.findFirst({ where: { id: warehouseId, deletedAt: null, isActive: true } }),
      this.prisma.pharmacy.findFirst({ where: { id: pharmacyId, deletedAt: null, isActive: true } }),
    ]);
    if (!warehouse) throw new BadRequestException('Warehouse not found or inactive');
    if (!pharmacy) throw new BadRequestException('Pharmacy not found or inactive');
  }

  private async validateItems(
    items: Array<{ medicineId: string; batchId: string; quantity: number }>,
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx ?? this.prisma;
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    for (const item of items) {
      if (item.quantity <= 0) {
        throw new BadRequestException('Transfer quantity must be greater than zero');
      }
      const medicine = await client.medicine.findFirst({
        where: { id: item.medicineId, deletedAt: null },
      });
      if (!medicine) throw new BadRequestException('Medicine not found');
      if (!medicine.isActive) {
        throw new BadRequestException(`Medicine ${medicine.name} is inactive`);
      }
      const batch = await client.medicineBatch.findUnique({ where: { id: item.batchId } });
      if (!batch) throw new BadRequestException('Batch not found');
      if (batch.medicineId !== item.medicineId) {
        throw new BadRequestException('Batch does not belong to the selected medicine');
      }
      const expiry = new Date(batch.expiryDate);
      expiry.setUTCHours(0, 0, 0, 0);
      if (expiry < today) {
        throw new BadRequestException('Cannot transfer an expired batch');
      }
    }
  }

  private async assertSupplyRequestLink(
    supplyRequestId: string,
    pharmacyId: string,
    items: Array<{ medicineId: string; quantity: number }>,
  ) {
    const request = await this.prisma.supplyRequest.findUnique({
      where: { id: supplyRequestId },
      include: { items: true },
    });
    if (!request) throw new BadRequestException('Supply request not found');
    if (request.pharmacyId !== pharmacyId) {
      throw new BadRequestException('Supply request pharmacy does not match transfer destination');
    }
    if (
      request.status !== SupplyRequestStatus.APPROVED &&
      request.status !== SupplyRequestStatus.PARTIALLY_FULFILLED
    ) {
      throw new BadRequestException('Supply request must be approved before creating a transfer');
    }

    const totals = new Map<string, number>();
    for (const item of items) {
      totals.set(item.medicineId, (totals.get(item.medicineId) ?? 0) + item.quantity);
    }

    for (const [medicineId, qty] of totals) {
      const requestItem = request.items.find((row) => row.medicineId === medicineId);
      if (!requestItem) {
        throw new BadRequestException('Transfer medicine is not on the approved supply request');
      }
      const approved = requestItem.approvedQty ?? 0;
      const remaining = approved - requestItem.fulfilledQty;
      if (qty > remaining) {
        throw new BadRequestException(
          `Transfer quantity exceeds remaining approved quantity for medicine (${remaining} remaining)`,
        );
      }
    }
  }

  private async applyFulfillment(
    tx: Prisma.TransactionClient,
    supplyRequestId: string,
    items: Array<{ medicineId: string; quantity: number }>,
  ) {
    const request = await tx.supplyRequest.findUnique({
      where: { id: supplyRequestId },
      include: { items: true },
    });
    if (!request) return;

    for (const transferItem of items) {
      const requestItem = request.items.find((row) => row.medicineId === transferItem.medicineId);
      if (requestItem) {
        await tx.supplyRequestItem.update({
          where: { id: requestItem.id },
          data: { fulfilledQty: { increment: transferItem.quantity } },
        });
      }
    }

    const refreshed = await tx.supplyRequestItem.findMany({
      where: { requestId: request.id },
    });
    const fully = refreshed.every(
      (row) => row.fulfilledQty >= (row.approvedQty ?? row.requestedQty),
    );
    const any = refreshed.some((row) => row.fulfilledQty > 0);
    await tx.supplyRequest.update({
      where: { id: request.id },
      data: {
        status: fully
          ? SupplyRequestStatus.FULFILLED
          : any
            ? SupplyRequestStatus.PARTIALLY_FULFILLED
            : request.status,
      },
    });
  }
}
