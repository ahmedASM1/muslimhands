-- Phase 6B: operational alerts + in-app notifications

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'EXPIRING_SOON';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'EXPIRED_STOCK';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PENDING_SUPPLY_REQUEST';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'TRANSFER_AWAITING_RECEIPT';

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'RUN_ALERT_EVALUATION';

DO $$ BEGIN
  CREATE TYPE "NotificationSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "severity" "NotificationSeverity" NOT NULL DEFAULT 'INFO';
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "location_type" "LocationType";
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "warehouse_id" UUID;
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "pharmacy_id" UUID;
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "dedupe_key" TEXT;
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "href" TEXT;
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW();
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "resolved_at" TIMESTAMPTZ(6);
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "expires_at" TIMESTAMPTZ(6);

DO $$ BEGIN
  ALTER TABLE "notifications"
    ADD CONSTRAINT "notifications_warehouse_id_fkey"
    FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "notifications"
    ADD CONSTRAINT "notifications_pharmacy_id_fkey"
    FOREIGN KEY ("pharmacy_id") REFERENCES "pharmacies"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "notifications_user_id_read_at_idx"
  ON "notifications"("user_id", "read_at");

CREATE INDEX IF NOT EXISTS "notifications_user_id_created_at_idx"
  ON "notifications"("user_id", "created_at");

CREATE INDEX IF NOT EXISTS "notifications_type_idx"
  ON "notifications"("type");

CREATE INDEX IF NOT EXISTS "notifications_dedupe_key_idx"
  ON "notifications"("dedupe_key");

CREATE INDEX IF NOT EXISTS "notifications_pharmacy_id_idx"
  ON "notifications"("pharmacy_id");

CREATE INDEX IF NOT EXISTS "notifications_warehouse_id_idx"
  ON "notifications"("warehouse_id");

CREATE INDEX IF NOT EXISTS "notifications_resolved_at_idx"
  ON "notifications"("resolved_at");

-- One active notification per user + dedupe key
CREATE UNIQUE INDEX IF NOT EXISTS "notifications_user_dedupe_active_uidx"
  ON "notifications"("user_id", "dedupe_key")
  WHERE "resolved_at" IS NULL AND "dedupe_key" IS NOT NULL;
