import { BadRequestException, Injectable } from '@nestjs/common';
import type { InventoryTx } from './inventory.service';

export interface BatchAllocation {
  stockId: string;
  batchId: string;
  medicineId: string;
  quantity: number;
  expiryDate: Date;
  batchNumber: string;
}

/**
 * FEFO (First Expire, First Out) allocation.
 * Locks eligible pharmacy stock rows and returns batch allocations.
 * Does NOT mutate stock — InventoryTransactionService applies changes.
 */
@Injectable()
export class DispensingAllocationService {
  async allocateMedicineStock(
    tx: InventoryTx,
    pharmacyId: string,
    medicineId: string,
    requestedQuantity: number,
  ): Promise<BatchAllocation[]> {
    if (requestedQuantity <= 0) {
      throw new BadRequestException('Dispense quantity must be greater than zero');
    }

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    // Lock all candidate rows for this medicine before reading quantities.
    await tx.$executeRaw`
      SELECT ps.id
      FROM pharmacy_stock ps
      INNER JOIN medicine_batches mb ON mb.id = ps.batch_id
      WHERE ps.pharmacy_id = ${pharmacyId}::uuid
        AND ps.medicine_id = ${medicineId}::uuid
        AND ps.quantity > 0
        AND mb.is_active = true
        AND mb.expiry_date >= ${today}::date
      ORDER BY mb.expiry_date ASC
      FOR UPDATE OF ps
    `;

    const stocks = await tx.pharmacyStock.findMany({
      where: {
        pharmacyId,
        medicineId,
        quantity: { gt: 0 },
        batch: {
          isActive: true,
          expiryDate: { gte: today },
        },
      },
      include: { batch: true },
      orderBy: { batch: { expiryDate: 'asc' } },
    });

    const available = stocks.reduce((sum, row) => sum + row.quantity, 0);
    if (available < requestedQuantity) {
      throw new BadRequestException(
        `Insufficient valid (non-expired) pharmacy stock. Available: ${available}, requested: ${requestedQuantity}`,
      );
    }

    let remaining = requestedQuantity;
    const allocations: BatchAllocation[] = [];

    for (const stock of stocks) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, stock.quantity);
      if (take <= 0) continue;
      allocations.push({
        stockId: stock.id,
        batchId: stock.batchId,
        medicineId: stock.medicineId,
        quantity: take,
        expiryDate: stock.batch.expiryDate,
        batchNumber: stock.batch.batchNumber,
      });
      remaining -= take;
    }

    if (remaining > 0) {
      throw new BadRequestException('Insufficient valid pharmacy stock after FEFO allocation');
    }

    return allocations;
  }

  async allocateMany(
    tx: InventoryTx,
    pharmacyId: string,
    items: Array<{ medicineId: string; quantity: number }>,
  ): Promise<Map<string, BatchAllocation[]>> {
    const result = new Map<string, BatchAllocation[]>();
    for (const item of items) {
      const allocations = await this.allocateMedicineStock(
        tx,
        pharmacyId,
        item.medicineId,
        item.quantity,
      );
      result.set(item.medicineId, allocations);
    }
    return result;
  }
}
