import { BadRequestException } from '@nestjs/common';
import { DispensingAllocationService } from '../../common/inventory/dispensing-allocation.service';
import { InventoryService } from '../../common/inventory/inventory.service';
import { InventoryTransactionService } from '../../common/inventory/inventory-transaction.service';

/**
 * In-memory stock ledger that exercises the real InventoryService.apply rules
 * (no negative stock, movements recorded) without a live database.
 */
function createLedger(medicineId = 'med-ome') {
  const warehouse = new Map<string, { id: string; warehouseId: string; medicineId: string; batchId: string; quantity: number }>();
  const pharmacy = new Map<string, { id: string; pharmacyId: string; medicineId: string; batchId: string; quantity: number }>();
  const movements: Array<Record<string, unknown>> = [];
  let idSeq = 1;

  const whKey = (warehouseId: string, batchId: string) => `${warehouseId}:${batchId}`;
  const phKey = (pharmacyId: string, batchId: string) => `${pharmacyId}:${batchId}`;

  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(undefined),
    $queryRaw: jest.fn().mockResolvedValue([]),
    medicine: {
      findFirst: jest.fn(async ({ where }: { where: { id: string } }) => ({
        id: where.id,
        isActive: true,
        deletedAt: null,
        name: 'Omeprazole',
      })),
    },
    medicineBatch: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => ({
        id: where.id,
        medicineId,
        expiryDate: new Date('2027-06-01'),
        isActive: true,
      })),
    },
    warehouseStock: {
      findUnique: jest.fn(async ({ where }: { where: { warehouseId_batchId: { warehouseId: string; batchId: string } } }) => {
        return warehouse.get(whKey(where.warehouseId_batchId.warehouseId, where.warehouseId_batchId.batchId)) ?? null;
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: { quantity: number } }) => {
        for (const [key, row] of warehouse) {
          if (row.id === where.id) {
            const next = { ...row, quantity: data.quantity };
            warehouse.set(key, next);
            return next;
          }
        }
        throw new Error('warehouse stock not found');
      }),
      create: jest.fn(async ({ data }: { data: { warehouseId: string; medicineId: string; batchId: string; quantity: number } }) => {
        const row = { id: `ws-${idSeq++}`, ...data };
        warehouse.set(whKey(data.warehouseId, data.batchId), row);
        return row;
      }),
    },
    pharmacyStock: {
      findUnique: jest.fn(async ({ where }: { where: { pharmacyId_batchId: { pharmacyId: string; batchId: string } } }) => {
        return pharmacy.get(phKey(where.pharmacyId_batchId.pharmacyId, where.pharmacyId_batchId.batchId)) ?? null;
      }),
      findMany: jest.fn(),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: { quantity: number } }) => {
        for (const [key, row] of pharmacy) {
          if (row.id === where.id) {
            const next = { ...row, quantity: data.quantity };
            pharmacy.set(key, next);
            return next;
          }
        }
        throw new Error('pharmacy stock not found');
      }),
      create: jest.fn(async ({ data }: { data: { pharmacyId: string; medicineId: string; batchId: string; quantity: number } }) => {
        const row = { id: `ps-${idSeq++}`, ...data };
        pharmacy.set(phKey(data.pharmacyId, data.batchId), row);
        return row;
      }),
    },
    stockMovement: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        movements.push(data);
        return { id: `mv-${movements.length}`, ...data };
      }),
    },
  };

  return {
    tx,
    warehouse,
    pharmacy,
    movements,
    whQty: (warehouseId: string, batchId: string) => warehouse.get(whKey(warehouseId, batchId))?.quantity ?? 0,
    phQty: (pharmacyId: string, batchId: string) => pharmacy.get(phKey(pharmacyId, batchId))?.quantity ?? 0,
    phTotal: (pharmacyId: string, medicineIdValue: string) =>
      [...pharmacy.values()]
        .filter((row) => row.pharmacyId === pharmacyId && row.medicineId === medicineIdValue)
        .reduce((sum, row) => sum + row.quantity, 0),
  };
}

describe('Transfer → receive → FEFO dispense lifecycle', () => {
  const inventory = new InventoryService({} as never);
  const allocation = new DispensingAllocationService();
  const audit = { record: jest.fn() };

  const WH = 'wh-al-noor-test';
  const PH = 'ph-al-noor';
  const MED = 'med-ome';
  const BATCH_A = 'batch-early';
  const BATCH_B = 'batch-later';
  const USER = 'user-1';

  it('receipt → ship → pharmacy still 0 → receive → dispense FEFO → insufficient fails atomically', async () => {
    const ledger = createLedger(MED);
    const { tx } = ledger;

    const inventoryTx = new InventoryTransactionService(
      { $transaction: async (fn: (client: unknown) => Promise<unknown>) => fn(tx) } as never,
      inventory,
      audit as never,
      allocation,
    );

    // 1–2. Warehouse receives 10 units on batch A (single-batch happy path first).
    await inventoryTx.receiveStock(tx as never, {
      warehouseId: WH,
      medicineId: MED,
      batchId: BATCH_A,
      quantity: 10,
      receiptId: 'rcv-1',
      performedById: USER,
    });
    expect(ledger.whQty(WH, BATCH_A)).toBe(10);

    // 3–6. Ship (TRANSFER_OUT): warehouse 0, pharmacy still 0 until receive.
    await inventoryTx.transferOut(tx as never, {
      warehouseId: WH,
      medicineId: MED,
      batchId: BATCH_A,
      quantity: 10,
      transferId: 'tr-1',
      performedById: USER,
    });
    expect(ledger.whQty(WH, BATCH_A)).toBe(0);
    expect(ledger.phQty(PH, BATCH_A)).toBe(0);

    // 7–8. Receive (TRANSFER_IN): pharmacy becomes 10.
    await inventoryTx.transferIn(tx as never, {
      pharmacyId: PH,
      medicineId: MED,
      batchId: BATCH_A,
      quantity: 10,
      transferId: 'tr-1',
      performedById: USER,
    });
    expect(ledger.phQty(PH, BATCH_A)).toBe(10);

    // Wire FEFO allocation against ledger pharmacy rows.
    tx.pharmacyStock.findMany.mockImplementation(async ({ where }: { where: { pharmacyId: string; medicineId: string } }) => {
      return [...ledger.pharmacy.values()]
        .filter(
          (row) =>
            row.pharmacyId === where.pharmacyId &&
            row.medicineId === where.medicineId &&
            row.quantity > 0,
        )
        .map((row) => ({
          ...row,
          batch: {
            batchNumber: row.batchId === BATCH_A ? 'A' : 'B',
            expiryDate: row.batchId === BATCH_A ? new Date('2026-10-01') : new Date('2027-02-01'),
            isActive: true,
          },
        }))
        .sort(
          (a, b) =>
            a.batch.expiryDate.getTime() - b.batch.expiryDate.getTime(),
        );
    });

    // 9–12. Dispense 3 via InventoryService (DISPENSE) — pharmacy → 7, movement created.
    const allocations = await allocation.allocateMedicineStock(tx as never, PH, MED, 3);
    expect(allocations).toEqual([expect.objectContaining({ batchId: BATCH_A, quantity: 3 })]);
    for (const alloc of allocations) {
      await inventory.apply(tx as never, {
        movementType: 'DISPENSE' as never,
        locationType: 'PHARMACY' as never,
        pharmacyId: PH,
        medicineId: MED,
        batchId: alloc.batchId,
        quantity: -alloc.quantity,
        referenceType: 'DISPENSING_RECORD' as never,
        referenceId: 'dsp-1',
        performedById: USER,
      });
    }
    expect(ledger.phQty(PH, BATCH_A)).toBe(7);
    expect(ledger.movements.some((m) => m.movementType === 'DISPENSE' && m.quantity === -3)).toBe(true);

    // Reset pharmacy to multi-batch FEFO scenario: A=5 early, B=10 later.
    const stockA = [...ledger.pharmacy.values()].find((r) => r.batchId === BATCH_A)!;
    await tx.pharmacyStock.update({ where: { id: stockA.id }, data: { quantity: 5 } });
    await inventoryTx.transferIn(tx as never, {
      pharmacyId: PH,
      medicineId: MED,
      batchId: BATCH_B,
      quantity: 10,
      transferId: 'tr-fefo',
      performedById: USER,
    });
    expect(ledger.phTotal(PH, MED)).toBe(15);

    // FEFO request 7 → A:5 + B:2, final pharmacy stock 8.
    const fefo = await allocation.allocateMedicineStock(tx as never, PH, MED, 7);
    expect(fefo).toEqual([
      expect.objectContaining({ batchId: BATCH_A, quantity: 5 }),
      expect.objectContaining({ batchId: BATCH_B, quantity: 2 }),
    ]);
    for (const alloc of fefo) {
      await inventory.apply(tx as never, {
        movementType: 'DISPENSE' as never,
        locationType: 'PHARMACY' as never,
        pharmacyId: PH,
        medicineId: MED,
        batchId: alloc.batchId,
        quantity: -alloc.quantity,
        referenceType: 'DISPENSING_RECORD' as never,
        referenceId: 'dsp-fefo',
        performedById: USER,
      });
    }
    expect(ledger.phQty(PH, BATCH_A)).toBe(0);
    expect(ledger.phQty(PH, BATCH_B)).toBe(8);
    expect(ledger.phTotal(PH, MED)).toBe(8);

    // Request > valid stock: fails atomically — no partial deduction, no DISPENSE for this attempt.
    const beforeMovements = ledger.movements.length;
    const beforeTotal = ledger.phTotal(PH, MED);
    await expect(
      allocation.allocateMedicineStock(tx as never, PH, MED, 999),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(ledger.phTotal(PH, MED)).toBe(beforeTotal);
    expect(ledger.movements.length).toBe(beforeMovements);
  });
});
