-- Phase 4B: supply requests, transfers (two-step ship/receive), pharmacy stock indexes

ALTER TYPE "TransferStatus" ADD VALUE IF NOT EXISTS 'SHIPPED';

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SUBMIT_SUPPLY_REQUEST';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CANCEL_SUPPLY_REQUEST';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PREPARE_TRANSFER';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SHIP_TRANSFER';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CANCEL_TRANSFER';

-- Pharmacy stock compound uniqueness + FEFO-friendly index
CREATE UNIQUE INDEX IF NOT EXISTS "pharmacy_stock_pharmacy_id_medicine_id_batch_id_key"
  ON "pharmacy_stock"("pharmacy_id", "medicine_id", "batch_id");

CREATE INDEX IF NOT EXISTS "pharmacy_stock_pharmacy_id_medicine_id_quantity_idx"
  ON "pharmacy_stock"("pharmacy_id", "medicine_id", "quantity");

CREATE INDEX IF NOT EXISTS "pharmacy_stock_batch_id_idx"
  ON "pharmacy_stock"("batch_id");

-- Transfer actor columns for draft → prepare → ship → receive
ALTER TABLE "stock_transfers" ADD COLUMN IF NOT EXISTS "created_by_id" UUID;
ALTER TABLE "stock_transfers" ADD COLUMN IF NOT EXISTS "shipped_by_id" UUID;

UPDATE "stock_transfers"
SET "created_by_id" = "prepared_by_id"
WHERE "created_by_id" IS NULL;

ALTER TABLE "stock_transfers" ALTER COLUMN "created_by_id" SET NOT NULL;
ALTER TABLE "stock_transfers" ALTER COLUMN "prepared_by_id" DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'stock_transfers_created_by_id_fkey'
  ) THEN
    ALTER TABLE "stock_transfers"
      ADD CONSTRAINT "stock_transfers_created_by_id_fkey"
      FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'stock_transfers_shipped_by_id_fkey'
  ) THEN
    ALTER TABLE "stock_transfers"
      ADD CONSTRAINT "stock_transfers_shipped_by_id_fkey"
      FOREIGN KEY ("shipped_by_id") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "stock_transfer_items" ADD COLUMN IF NOT EXISTS "notes" TEXT;
