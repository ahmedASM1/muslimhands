import { BadRequestException, Injectable } from '@nestjs/common';
import {
  LocationType,
  MovementReferenceType,
  MovementType,
  type Prisma,
  PrismaClient,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export type InventoryTx = Prisma.TransactionClient | PrismaClient;

export interface ApplyStockChangeInput {
  movementType: MovementType;
  locationType: LocationType;
  warehouseId?: string | null;
  pharmacyId?: string | null;
  medicineId: string;
  batchId: string;
  /** Signed quantity: positive = in, negative = out */
  quantity: number;
  referenceType?: MovementReferenceType | null;
  referenceId?: string | null;
  reason?: string | null;
  performedById?: string | null;
  occurredAt?: Date;
}

/**
 * Low-level atomic stock mutator.
 * Controllers must not call Prisma stock updates directly — use this service
 * (or InventoryTransactionService) so every change creates an immutable movement.
 */
@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  async apply(tx: InventoryTx, input: ApplyStockChangeInput): Promise<number> {
    if (input.quantity === 0) {
      throw new BadRequestException('Stock movement quantity cannot be zero');
    }

    if (input.locationType === LocationType.WAREHOUSE) {
      if (!input.warehouseId) {
        throw new BadRequestException('Warehouse is required for warehouse movements');
      }
      return this.applyWarehouse(tx, input);
    }

    if (!input.pharmacyId) {
      throw new BadRequestException('Pharmacy is required for pharmacy movements');
    }
    return this.applyPharmacy(tx, input);
  }

  private async applyWarehouse(tx: InventoryTx, input: ApplyStockChangeInput): Promise<number> {
    const warehouseId = input.warehouseId as string;

    // Transaction-scoped advisory lock prevents concurrent first-insert races
    // and double-outs that could drive quantity negative.
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(
        hashtext(${`wh:${warehouseId}:${input.batchId}`})
      )
    `;

    await tx.$queryRaw`
      SELECT id FROM warehouse_stock
      WHERE warehouse_id = ${warehouseId}::uuid AND batch_id = ${input.batchId}::uuid
      FOR UPDATE
    `;

    const existing = await tx.warehouseStock.findUnique({
      where: { warehouseId_batchId: { warehouseId, batchId: input.batchId } },
    });

    if (existing && existing.medicineId !== input.medicineId) {
      throw new BadRequestException('Stock medicine does not match the selected batch');
    }

    const nextQty = (existing?.quantity ?? 0) + input.quantity;
    if (nextQty < 0) {
      throw new BadRequestException('Insufficient warehouse stock');
    }

    if (existing) {
      await tx.warehouseStock.update({
        where: { id: existing.id },
        data: { quantity: nextQty },
      });
    } else {
      await tx.warehouseStock.create({
        data: {
          warehouseId,
          medicineId: input.medicineId,
          batchId: input.batchId,
          quantity: nextQty,
        },
      });
    }

    await tx.stockMovement.create({
      data: {
        movementType: input.movementType,
        locationType: LocationType.WAREHOUSE,
        warehouseId,
        medicineId: input.medicineId,
        batchId: input.batchId,
        quantity: input.quantity,
        balanceAfter: nextQty,
        referenceType: input.referenceType ?? null,
        referenceId: input.referenceId ?? null,
        reason: input.reason ?? null,
        performedById: input.performedById ?? null,
        occurredAt: input.occurredAt ?? new Date(),
      },
    });

    return nextQty;
  }

  private async applyPharmacy(tx: InventoryTx, input: ApplyStockChangeInput): Promise<number> {
    const pharmacyId = input.pharmacyId as string;

    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(
        hashtext(${`ph:${pharmacyId}:${input.batchId}`})
      )
    `;

    await tx.$queryRaw`
      SELECT id FROM pharmacy_stock
      WHERE pharmacy_id = ${pharmacyId}::uuid AND batch_id = ${input.batchId}::uuid
      FOR UPDATE
    `;

    const existing = await tx.pharmacyStock.findUnique({
      where: { pharmacyId_batchId: { pharmacyId, batchId: input.batchId } },
    });

    const nextQty = (existing?.quantity ?? 0) + input.quantity;
    if (nextQty < 0) {
      throw new BadRequestException('Insufficient pharmacy stock');
    }

    if (existing) {
      await tx.pharmacyStock.update({
        where: { id: existing.id },
        data: { quantity: nextQty },
      });
    } else {
      await tx.pharmacyStock.create({
        data: {
          pharmacyId,
          medicineId: input.medicineId,
          batchId: input.batchId,
          quantity: nextQty,
        },
      });
    }

    await tx.stockMovement.create({
      data: {
        movementType: input.movementType,
        locationType: LocationType.PHARMACY,
        pharmacyId,
        medicineId: input.medicineId,
        batchId: input.batchId,
        quantity: input.quantity,
        balanceAfter: nextQty,
        referenceType: input.referenceType ?? null,
        referenceId: input.referenceId ?? null,
        reason: input.reason ?? null,
        performedById: input.performedById ?? null,
        occurredAt: input.occurredAt ?? new Date(),
      },
    });

    return nextQty;
  }
}
