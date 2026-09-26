-- Warehouse stock compound uniqueness (medicine + batch within warehouse)
CREATE UNIQUE INDEX IF NOT EXISTS "warehouse_stock_warehouse_id_medicine_id_batch_id_key"
  ON "warehouse_stock"("warehouse_id", "medicine_id", "batch_id");

CREATE INDEX IF NOT EXISTS "warehouse_stock_batch_id_idx" ON "warehouse_stock"("batch_id");
CREATE INDEX IF NOT EXISTS "stock_receipts_received_at_idx" ON "stock_receipts"("received_at");

ALTER TABLE "stock_receipt_items" ADD COLUMN IF NOT EXISTS "notes" TEXT;

ALTER TYPE "MovementReferenceType" ADD VALUE IF NOT EXISTS 'DAMAGE';
ALTER TYPE "MovementReferenceType" ADD VALUE IF NOT EXISTS 'EXPIRY';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CANCEL_RECEIPT';
