import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction } from '@mh/shared';
import { Prisma, ReceiptStatus } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { InventoryTransactionService } from '../../common/inventory/inventory-transaction.service';
import { nextDocumentNumber } from '../../common/inventory/document-numbers';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

export class ReceiptQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(ReceiptStatus)
  status?: ReceiptStatus;

  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @IsOptional()
  @IsString()
  supplier?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}

export interface ReceiptItemInput {
  medicineId: string;
  batchId?: string;
  batchNumber?: string;
  manufacturingDate?: string;
  expiryDate?: string;
  quantity: number;
  unitCost?: number;
  notes?: string;
}

@Injectable()
export class ReceiptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventoryTx: InventoryTransactionService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ReceiptQueryDto) {
    const where: Prisma.StockReceiptWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
      ...(query.supplier
        ? { supplierName: { contains: query.supplier, mode: 'insensitive' } }
        : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
      ...(query.search
        ? {
            OR: [
              { receiptNumber: { contains: query.search, mode: 'insensitive' } },
              { supplierName: { contains: query.search, mode: 'insensitive' } },
              { supplierRef: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.stockReceipt.count({ where }),
      this.prisma.stockReceipt.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { createdAt: 'desc' },
        include: {
          warehouse: true,
          createdBy: { select: { firstName: true, lastName: true, email: true } },
          postedBy: { select: { firstName: true, lastName: true, email: true } },
          items: { include: { medicine: { include: { unit: true } }, batch: true } },
        },
      }),
    ]);

    return {
      items: items.map((receipt) => this.withTotals(receipt)),
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async get(id: string) {
    const receipt = await this.prisma.stockReceipt.findUnique({
      where: { id },
      include: {
        warehouse: true,
        createdBy: { select: { firstName: true, lastName: true, email: true } },
        postedBy: { select: { firstName: true, lastName: true, email: true } },
        items: { include: { medicine: { include: { unit: true } }, batch: true } },
      },
    });
    if (!receipt) {
      throw new NotFoundException('Receipt not found');
    }
    return this.withTotals(receipt);
  }

  async create(
    data: {
      warehouseId: string;
      receivedAt?: string;
      supplierName?: string;
      supplierRef?: string;
      notes?: string;
      items: ReceiptItemInput[];
    },
    userId: string,
  ) {
    if (!data.items?.length) {
      throw new BadRequestException('At least one receipt item is required');
    }

    const warehouse = await this.prisma.warehouse.findFirst({
      where: { id: data.warehouseId, deletedAt: null, isActive: true },
    });
    if (!warehouse) {
      throw new BadRequestException('Warehouse not found or inactive');
    }

    const receipt = await this.prisma.$transaction(async (tx) => {
      const receiptNumber = await nextDocumentNumber(tx, 'stockReceipt', 'REC');
      const created = await tx.stockReceipt.create({
        data: {
          receiptNumber,
          warehouseId: data.warehouseId,
          supplierName: data.supplierName?.trim() || null,
          supplierRef: data.supplierRef?.trim() || null,
          notes: data.notes?.trim() || null,
          receivedAt: data.receivedAt ? new Date(data.receivedAt) : null,
          createdById: userId,
          status: ReceiptStatus.DRAFT,
        },
      });

      for (const item of data.items) {
        await this.createItem(tx, created.id, item);
      }

      return created;
    });

    await this.audit.record({
      userId,
      action: AuditAction.CREATE_RECEIPT,
      entityType: 'StockReceipt',
      entityId: receipt.id,
      newValues: { receiptNumber: receipt.receiptNumber, itemCount: data.items.length },
    });

    return this.get(receipt.id);
  }

  async update(
    id: string,
    data: {
      receivedAt?: string;
      supplierName?: string;
      supplierRef?: string;
      notes?: string;
      items?: ReceiptItemInput[];
    },
    userId: string,
  ) {
    const existing = await this.prisma.stockReceipt.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Receipt not found');
    }
    if (existing.status !== ReceiptStatus.DRAFT) {
      throw new BadRequestException('Only draft receipts can be edited');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.stockReceipt.update({
        where: { id },
        data: {
          supplierName: data.supplierName?.trim(),
          supplierRef: data.supplierRef?.trim(),
          notes: data.notes?.trim(),
          receivedAt: data.receivedAt ? new Date(data.receivedAt) : undefined,
        },
      });

      if (data.items) {
        if (!data.items.length) {
          throw new BadRequestException('At least one receipt item is required');
        }
        await tx.stockReceiptItem.deleteMany({ where: { receiptId: id } });
        for (const item of data.items) {
          await this.createItem(tx, id, item);
        }
      }
    });

    await this.audit.record({
      userId,
      action: AuditAction.CREATE_RECEIPT,
      entityType: 'StockReceipt',
      entityId: id,
      newValues: { updated: true },
    });

    return this.get(id);
  }

  async post(id: string, userId: string) {
    try {
      const posted = await this.prisma.$transaction(async (tx) => {
        // Lock the receipt row so concurrent posts cannot both succeed.
        const locked = await tx.$queryRaw<Array<{ id: string; status: ReceiptStatus }>>`
          SELECT id, status FROM stock_receipts WHERE id = ${id}::uuid FOR UPDATE
        `;
        if (!locked.length) {
          throw new NotFoundException('Receipt not found');
        }
        if (locked[0]!.status !== ReceiptStatus.DRAFT) {
          throw new ConflictException('Receipt has already been posted or cancelled');
        }

        const receipt = await tx.stockReceipt.findUnique({
          where: { id },
          include: { items: true },
        });
        if (!receipt) {
          throw new NotFoundException('Receipt not found');
        }
        if (!receipt.items.length) {
          throw new BadRequestException('Cannot post a receipt with no items');
        }

        for (const item of receipt.items) {
          await this.inventoryTx.receiveStock(tx, {
            warehouseId: receipt.warehouseId,
            medicineId: item.medicineId,
            batchId: item.batchId,
            quantity: item.quantity,
            receiptId: receipt.id,
            performedById: userId,
            notes: item.notes ?? undefined,
          });
        }

        return tx.stockReceipt.update({
          where: { id },
          data: {
            status: ReceiptStatus.POSTED,
            postedById: userId,
            postedAt: new Date(),
            receivedAt: receipt.receivedAt ?? new Date(),
          },
          include: {
            items: { include: { medicine: true, batch: true } },
            warehouse: true,
          },
        });
      });

      await this.audit.record({
        userId,
        action: AuditAction.POST_RECEIPT,
        entityType: 'StockReceipt',
        entityId: id,
      });

      return this.withTotals(posted);
    } catch (error) {
      if (error instanceof ConflictException) {
        throw error;
      }
      throw error;
    }
  }

  async cancel(id: string, userId: string) {
    const receipt = await this.prisma.stockReceipt.findUnique({ where: { id } });
    if (!receipt) {
      throw new NotFoundException('Receipt not found');
    }
    if (receipt.status !== ReceiptStatus.DRAFT) {
      throw new BadRequestException(
        'Posted receipts cannot be cancelled. Use a stock adjustment to correct inventory.',
      );
    }

    const cancelled = await this.prisma.stockReceipt.update({
      where: { id },
      data: { status: ReceiptStatus.CANCELLED },
    });

    await this.audit.record({
      userId,
      action: AuditAction.CANCEL_RECEIPT,
      entityType: 'StockReceipt',
      entityId: id,
    });

    return cancelled;
  }

  private async createItem(
    tx: Prisma.TransactionClient,
    receiptId: string,
    item: ReceiptItemInput,
  ) {
    if (item.quantity <= 0) {
      throw new BadRequestException('Item quantity must be greater than zero');
    }

    const medicine = await tx.medicine.findFirst({
      where: { id: item.medicineId, deletedAt: null },
    });
    if (!medicine) {
      throw new BadRequestException('Medicine not found');
    }
    if (!medicine.isActive) {
      throw new BadRequestException(`Medicine ${medicine.name} is inactive`);
    }

    let batchId = item.batchId;
    if (batchId) {
      const batch = await tx.medicineBatch.findUnique({ where: { id: batchId } });
      if (!batch) {
        throw new BadRequestException('Batch not found');
      }
      if (batch.medicineId !== item.medicineId) {
        throw new BadRequestException('Batch does not belong to the selected medicine');
      }
      this.assertNotExpired(batch.expiryDate);
    } else {
      if (!item.batchNumber?.trim() || !item.expiryDate) {
        throw new BadRequestException('batchId or batchNumber + expiryDate is required');
      }
      this.assertNotExpired(new Date(item.expiryDate));
      const batch = await tx.medicineBatch.upsert({
        where: {
          medicineId_batchNumber: {
            medicineId: item.medicineId,
            batchNumber: item.batchNumber.trim(),
          },
        },
        update: {
          manufacturingDate: item.manufacturingDate ? new Date(item.manufacturingDate) : undefined,
          expiryDate: new Date(item.expiryDate),
        },
        create: {
          medicineId: item.medicineId,
          batchNumber: item.batchNumber.trim(),
          manufacturingDate: item.manufacturingDate ? new Date(item.manufacturingDate) : null,
          expiryDate: new Date(item.expiryDate),
        },
      });
      batchId = batch.id;
    }

    await tx.stockReceiptItem.create({
      data: {
        receiptId,
        medicineId: item.medicineId,
        batchId,
        quantity: item.quantity,
        unitCost: item.unitCost ?? null,
        notes: item.notes?.trim() || null,
      },
    });
  }

  private assertNotExpired(expiryDate: Date) {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const expiry = new Date(expiryDate);
    expiry.setUTCHours(0, 0, 0, 0);
    if (expiry < today) {
      throw new BadRequestException('Cannot include an expired batch on a receipt');
    }
  }

  private withTotals<
    T extends {
      items: Array<{ quantity: number; unitCost?: unknown }>;
    },
  >(receipt: T) {
    const totalUnits = receipt.items.reduce((sum, item) => sum + item.quantity, 0);
    const estimatedCost = receipt.items.reduce((sum, item) => {
      const cost = item.unitCost == null ? 0 : Number(item.unitCost);
      return sum + cost * item.quantity;
    }, 0);
    return {
      ...receipt,
      itemCount: receipt.items.length,
      totalUnits,
      estimatedCost,
    };
  }
}
