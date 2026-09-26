import type { Prisma, PrismaClient } from '@prisma/client';

type Tx = Prisma.TransactionClient | PrismaClient;

export async function nextDocumentNumber(
  tx: Tx,
  model: 'stockReceipt' | 'supplyRequest' | 'stockTransfer' | 'dispensingRecord' | 'beneficiary',
  prefix: string,
): Promise<string> {
  let count = 0;
  switch (model) {
    case 'stockReceipt':
      count = await tx.stockReceipt.count();
      break;
    case 'supplyRequest':
      count = await tx.supplyRequest.count();
      break;
    case 'stockTransfer':
      count = await tx.stockTransfer.count();
      break;
    case 'dispensingRecord':
      count = await tx.dispensingRecord.count();
      break;
    case 'beneficiary':
      count = await tx.beneficiary.count();
      break;
  }
  return `${prefix}-${String(count + 1).padStart(6, '0')}`;
}
