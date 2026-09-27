-- AlterTable medicines: per-item expiry alert lead time
ALTER TABLE "medicines" ADD COLUMN IF NOT EXISTS "expiry_alert_value" INTEGER;
ALTER TABLE "medicines" ADD COLUMN IF NOT EXISTS "expiry_alert_unit" TEXT;
