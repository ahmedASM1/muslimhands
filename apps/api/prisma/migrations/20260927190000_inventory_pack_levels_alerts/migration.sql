-- CreateTable
CREATE TABLE IF NOT EXISTS "medicine_pack_levels" (
    "id" UUID NOT NULL,
    "medicine_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "factor_to_base" INTEGER NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "medicine_pack_levels_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "medicine_pack_levels_medicine_id_code_key" ON "medicine_pack_levels"("medicine_id", "code");
CREATE INDEX IF NOT EXISTS "medicine_pack_levels_medicine_id_idx" ON "medicine_pack_levels"("medicine_id");

ALTER TABLE "medicine_pack_levels"
  DROP CONSTRAINT IF EXISTS "medicine_pack_levels_medicine_id_fkey";
ALTER TABLE "medicine_pack_levels"
  ADD CONSTRAINT "medicine_pack_levels_medicine_id_fkey"
  FOREIGN KEY ("medicine_id") REFERENCES "medicines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable stock_receipt_items
ALTER TABLE "stock_receipt_items" ADD COLUMN IF NOT EXISTS "pack_breakdown" JSONB;

-- AlterTable notification_preferences
ALTER TABLE "notification_preferences" ADD COLUMN IF NOT EXISTS "email_low_stock" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "notification_preferences" ADD COLUMN IF NOT EXISTS "email_expiring_soon" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "notification_preferences" ADD COLUMN IF NOT EXISTS "email_expired_stock" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "notification_preferences" ADD COLUMN IF NOT EXISTS "expiry_alert_value" INTEGER;
ALTER TABLE "notification_preferences" ADD COLUMN IF NOT EXISTS "expiry_alert_unit" TEXT;
