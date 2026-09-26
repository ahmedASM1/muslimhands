import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction } from '@mh/shared';
import {
  DispensingStatus,
  LocationType,
  MovementReferenceType,
  MovementType,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../modules/audit/audit.service';
import { nextDocumentNumber } from './document-numbers';
import { DispensingAllocationService } from './dispensing-allocation.service';
import { InventoryService, type InventoryTx } from './inventory.service';

export type AdjustmentDirection = 'IN' | 'OUT';
export type AdjustmentReason = 'PHYSICAL_COUNT' | 'DAMAGE' | 'EXPIRED' | 'LOST' | 'CORRECTION';

export interface WarehouseStockMutationInput {
  warehouseId: string;
  medicineId: string;
  batchId: string;
  quantity: number;
  performedById: string;
  notes?: string;
}

/**
 * High-level warehouse inventory operations.
 * Reused later by transfers and dispensing — keep mutation logic here, not in controllers.
 */
export interface DispenseItemInput {
  medicineId: string;
  quantity: number;
}

export interface DispenseInput {
  pharmacyId: string;
  beneficiaryId: string;
  performedById: string;
  items: DispenseItemInput[];
  notes?: string;
  idempotencyKey?: string;
}

@Injectable()
export class InventoryTransactionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly audit: AuditService,
    private readonly allocation: DispensingAllocationService,
  ) {}

  async receiveStock(
    tx: InventoryTx,
    input: WarehouseStockMutationInput & { receiptId: string },
  ) {
    await this.assertMedicineAndBatch(tx, input.medicineId, input.batchId, {
      allowExpired: false,
      requireActiveMedicine: true,
    });
    if (input.quantity <= 0) {
      throw new BadRequestException('Receipt quantity must be greater than zero');
    }
    return this.inventory.apply(tx, {
      movementType: MovementType.RECEIPT,
      locationType: LocationType.WAREHOUSE,
      warehouseId: input.warehouseId,
      medicineId: input.medicineId,
      batchId: input.batchId,
      quantity: input.quantity,
      referenceType: MovementReferenceType.STOCK_RECEIPT,
      referenceId: input.receiptId,
      reason: input.notes,
      performedById: input.performedById,
    });
  }

  async adjustStock(input: WarehouseStockMutationInput & {
    direction: AdjustmentDirection;
    reason: AdjustmentReason;
  }) {
    if (input.quantity <= 0) {
      throw new BadRequestException('Adjustment quantity must be greater than zero');
    }

    return this.prisma.$transaction(async (tx) => {
      await this.assertMedicineAndBatch(tx, input.medicineId, input.batchId, {
        allowExpired: true,
        requireActiveMedicine: false,
      });

      const signed = input.direction === 'IN' ? input.quantity : -input.quantity;
      const movementType =
        input.direction === 'IN' ? MovementType.ADJUSTMENT_IN : MovementType.ADJUSTMENT_OUT;

      const balance = await this.inventory.apply(tx, {
        movementType,
        locationType: LocationType.WAREHOUSE,
        warehouseId: input.warehouseId,
        medicineId: input.medicineId,
        batchId: input.batchId,
        quantity: signed,
        referenceType: MovementReferenceType.ADJUSTMENT,
        reason: `${input.reason}${input.notes ? `: ${input.notes}` : ''}`,
        performedById: input.performedById,
      });

      await this.audit.record({
        userId: input.performedById,
        action: AuditAction.STOCK_ADJUSTMENT,
        entityType: 'WarehouseStock',
        entityId: `${input.warehouseId}:${input.batchId}`,
        newValues: {
          direction: input.direction,
          quantity: input.quantity,
          reason: input.reason,
          notes: input.notes,
          balanceAfter: balance,
        },
      });

      return { balanceAfter: balance, movementType, quantity: signed };
    });
  }

  async markDamaged(input: WarehouseStockMutationInput) {
    if (input.quantity <= 0) {
      throw new BadRequestException('Damaged quantity must be greater than zero');
    }
    if (!input.notes?.trim()) {
      throw new BadRequestException('Damage notes/reason are required');
    }

    return this.prisma.$transaction(async (tx) => {
      await this.assertMedicineAndBatch(tx, input.medicineId, input.batchId, {
        allowExpired: true,
        requireActiveMedicine: false,
      });

      const balance = await this.inventory.apply(tx, {
        movementType: MovementType.DAMAGE,
        locationType: LocationType.WAREHOUSE,
        warehouseId: input.warehouseId,
        medicineId: input.medicineId,
        batchId: input.batchId,
        quantity: -input.quantity,
        referenceType: MovementReferenceType.DAMAGE,
        reason: input.notes,
        performedById: input.performedById,
      });

      await this.audit.record({
        userId: input.performedById,
        action: AuditAction.MARK_DAMAGED,
        entityType: 'WarehouseStock',
        entityId: `${input.warehouseId}:${input.batchId}`,
        newValues: { quantity: input.quantity, notes: input.notes, balanceAfter: balance },
      });

      return { balanceAfter: balance };
    });
  }

  async markExpired(input: WarehouseStockMutationInput) {
    if (input.quantity <= 0) {
      throw new BadRequestException('Expired quantity must be greater than zero');
    }

    return this.prisma.$transaction(async (tx) => {
      await this.assertMedicineAndBatch(tx, input.medicineId, input.batchId, {
        allowExpired: true,
        requireActiveMedicine: false,
      });

      const balance = await this.inventory.apply(tx, {
        movementType: MovementType.EXPIRED,
        locationType: LocationType.WAREHOUSE,
        warehouseId: input.warehouseId,
        medicineId: input.medicineId,
        batchId: input.batchId,
        quantity: -input.quantity,
        referenceType: MovementReferenceType.EXPIRY,
        reason: input.notes ?? 'EXPIRED',
        performedById: input.performedById,
      });

      await this.audit.record({
        userId: input.performedById,
        action: AuditAction.MARK_EXPIRED,
        entityType: 'WarehouseStock',
        entityId: `${input.warehouseId}:${input.batchId}`,
        newValues: { quantity: input.quantity, notes: input.notes, balanceAfter: balance },
      });

      return { balanceAfter: balance };
    });
  }

  /**
   * Warehouse → pharmacy custody handoff step 1: deduct warehouse stock.
   * Must be called inside an outer transfer transaction.
   */
  async transferOut(
    tx: InventoryTx,
    input: WarehouseStockMutationInput & { transferId: string },
  ) {
    await this.assertMedicineAndBatch(tx, input.medicineId, input.batchId, {
      allowExpired: false,
      requireActiveMedicine: true,
    });
    if (input.quantity <= 0) {
      throw new BadRequestException('Transfer quantity must be greater than zero');
    }
    return this.inventory.apply(tx, {
      movementType: MovementType.TRANSFER_OUT,
      locationType: LocationType.WAREHOUSE,
      warehouseId: input.warehouseId,
      medicineId: input.medicineId,
      batchId: input.batchId,
      quantity: -input.quantity,
      referenceType: MovementReferenceType.STOCK_TRANSFER,
      referenceId: input.transferId,
      reason: input.notes,
      performedById: input.performedById,
    });
  }

  /**
   * Warehouse → pharmacy custody handoff step 2: increase pharmacy stock.
   * Must be called inside an outer transfer transaction.
   */
  async transferIn(
    tx: InventoryTx,
    input: {
      pharmacyId: string;
      medicineId: string;
      batchId: string;
      quantity: number;
      transferId: string;
      performedById: string;
      notes?: string;
    },
  ) {
    await this.assertMedicineAndBatch(tx, input.medicineId, input.batchId, {
      allowExpired: true,
      requireActiveMedicine: false,
    });
    if (input.quantity <= 0) {
      throw new BadRequestException('Transfer quantity must be greater than zero');
    }
    return this.inventory.apply(tx, {
      movementType: MovementType.TRANSFER_IN,
      locationType: LocationType.PHARMACY,
      pharmacyId: input.pharmacyId,
      medicineId: input.medicineId,
      batchId: input.batchId,
      quantity: input.quantity,
      referenceType: MovementReferenceType.STOCK_TRANSFER,
      referenceId: input.transferId,
      reason: input.notes,
      performedById: input.performedById,
    });
  }

  /**
   * Atomic free-of-charge pharmacy dispensing with FEFO allocation.
   * Must run as a single DB transaction: allocation + stock + movements + record + audit.
   */
  async dispense(input: DispenseInput) {
    if (!input.items?.length) {
      throw new BadRequestException('At least one medicine item is required');
    }

    const seen = new Set<string>();
    for (const item of input.items) {
      if (item.quantity <= 0) {
        throw new BadRequestException('Dispense quantity must be greater than zero');
      }
      if (seen.has(item.medicineId)) {
        throw new BadRequestException('Duplicate medicine in the same dispensing request');
      }
      seen.add(item.medicineId);
    }

    return this.prisma.$transaction(async (tx) => {
      if (input.idempotencyKey) {
        const existing = await tx.dispensingRecord.findFirst({
          where: {
            pharmacyId: input.pharmacyId,
            idempotencyKey: input.idempotencyKey,
          },
          include: {
            items: { include: { medicine: true, batch: true } },
            beneficiary: true,
            pharmacy: true,
            dispensedBy: { select: { id: true, firstName: true, lastName: true } },
          },
        });
        if (existing) {
          return existing;
        }
      }

      const beneficiary = await tx.beneficiary.findFirst({
        where: { id: input.beneficiaryId, deletedAt: null },
      });
      if (!beneficiary) {
        throw new NotFoundException('Beneficiary not found');
      }
      if (!beneficiary.isActive) {
        throw new BadRequestException('Inactive beneficiaries cannot receive medicine');
      }

      const pharmacy = await tx.pharmacy.findFirst({
        where: { id: input.pharmacyId, deletedAt: null, isActive: true },
      });
      if (!pharmacy) {
        throw new NotFoundException('Pharmacy not found');
      }

      const medicineIds = input.items.map((item) => item.medicineId);
      const medicines = await tx.medicine.findMany({
        where: { id: { in: medicineIds }, deletedAt: null },
      });
      if (medicines.length !== medicineIds.length) {
        throw new NotFoundException('One or more medicines were not found');
      }
      for (const medicine of medicines) {
        if (!medicine.isActive) {
          throw new BadRequestException(`Inactive medicines cannot be dispensed (${medicine.name})`);
        }
      }
      const medicineById = new Map(medicines.map((item) => [item.id, item]));

      // Pharmacy-level advisory lock serializes concurrent dispenses at the same pharmacy.
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`dispense:${input.pharmacyId}`}))
      `;

      const allocationsByMedicine = await this.allocation.allocateMany(
        tx,
        input.pharmacyId,
        input.items,
      );

      const recordNumber = await nextDocumentNumber(tx, 'dispensingRecord', 'DP');
      const created = await tx.dispensingRecord.create({
        data: {
          recordNumber,
          pharmacyId: input.pharmacyId,
          beneficiaryId: input.beneficiaryId,
          status: DispensingStatus.COMPLETED,
          notes: input.notes,
          idempotencyKey: input.idempotencyKey,
          dispensedById: input.performedById,
        },
      });

      for (const item of input.items) {
        const medicine = medicineById.get(item.medicineId)!;
        const allocations = allocationsByMedicine.get(item.medicineId) ?? [];
        for (const allocation of allocations) {
          await this.inventory.apply(tx, {
            movementType: MovementType.DISPENSE,
            locationType: LocationType.PHARMACY,
            pharmacyId: input.pharmacyId,
            medicineId: allocation.medicineId,
            batchId: allocation.batchId,
            quantity: -allocation.quantity,
            referenceType: MovementReferenceType.DISPENSING_RECORD,
            referenceId: created.id,
            reason: input.notes ?? null,
            performedById: input.performedById,
          });
          await tx.dispensingItem.create({
            data: {
              recordId: created.id,
              medicineId: allocation.medicineId,
              batchId: allocation.batchId,
              quantity: allocation.quantity,
              referenceValue: medicine.referenceValue,
            },
          });
        }
      }

      await tx.auditLog.create({
        data: {
          userId: input.performedById,
          action: AuditAction.CREATE_DISPENSING,
          entityType: 'DispensingRecord',
          entityId: created.id,
          newValues: {
            recordNumber,
            pharmacyId: input.pharmacyId,
            beneficiaryId: input.beneficiaryId,
            itemCount: input.items.length,
            totalQuantity: input.items.reduce((sum, row) => sum + row.quantity, 0),
          },
        },
      });
      await tx.auditLog.create({
        data: {
          userId: input.performedById,
          action: AuditAction.COMPLETE_DISPENSING,
          entityType: 'DispensingRecord',
          entityId: created.id,
          newValues: { status: DispensingStatus.COMPLETED, recordNumber },
        },
      });

      return tx.dispensingRecord.findUniqueOrThrow({
        where: { id: created.id },
        include: {
          items: { include: { medicine: true, batch: true } },
          beneficiary: true,
          pharmacy: true,
          dispensedBy: { select: { id: true, firstName: true, lastName: true } },
        },
      });
    });
  }

  private async assertMedicineAndBatch(
    tx: InventoryTx,
    medicineId: string,
    batchId: string,
    options: { allowExpired: boolean; requireActiveMedicine: boolean },
  ) {
    const medicine = await tx.medicine.findFirst({
      where: { id: medicineId, deletedAt: null },
    });
    if (!medicine) {
      throw new NotFoundException('Medicine not found');
    }
    if (options.requireActiveMedicine && !medicine.isActive) {
      throw new BadRequestException('Cannot use an inactive medicine');
    }

    const batch = await tx.medicineBatch.findUnique({ where: { id: batchId } });
    if (!batch) {
      throw new NotFoundException('Batch not found');
    }
    if (batch.medicineId !== medicineId) {
      throw new BadRequestException('Batch does not belong to the selected medicine');
    }

    if (!options.allowExpired) {
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      const expiry = new Date(batch.expiryDate);
      expiry.setUTCHours(0, 0, 0, 0);
      if (expiry < today) {
        throw new BadRequestException('Cannot use an expired batch');
      }
    }
  }
}
