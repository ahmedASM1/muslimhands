-- Phase 6A: reporting support

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'EXPORT_REPORT';

-- Helpful indexes for common report filters (idempotent)
CREATE INDEX IF NOT EXISTS "stock_movements_occurred_at_movement_type_idx"
  ON "stock_movements"("occurred_at", "movement_type");

CREATE INDEX IF NOT EXISTS "dispensing_records_pharmacy_id_dispensed_at_idx"
  ON "dispensing_records"("pharmacy_id", "dispensed_at");

CREATE INDEX IF NOT EXISTS "stock_receipts_warehouse_id_created_at_idx"
  ON "stock_receipts"("warehouse_id", "created_at");

CREATE INDEX IF NOT EXISTS "stock_transfers_pharmacy_id_status_idx"
  ON "stock_transfers"("pharmacy_id", "status");
