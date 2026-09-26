-- Phase 5: beneficiaries enhancements + dispensing FEFO support

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CREATE_DISPENSING';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'COMPLETE_DISPENSING';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CREATE_BENEFICIARY';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'UPDATE_BENEFICIARY';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ACTIVATE_BENEFICIARY';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'DEACTIVATE_BENEFICIARY';

ALTER TABLE "beneficiaries" ADD COLUMN IF NOT EXISTS "external_reference" TEXT;
ALTER TABLE "beneficiaries" ADD COLUMN IF NOT EXISTS "address" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "beneficiaries_external_reference_key"
  ON "beneficiaries"("external_reference");

CREATE INDEX IF NOT EXISTS "beneficiaries_beneficiary_number_idx"
  ON "beneficiaries"("beneficiary_number");

CREATE INDEX IF NOT EXISTS "beneficiaries_phone_idx"
  ON "beneficiaries"("phone");

CREATE INDEX IF NOT EXISTS "beneficiaries_external_reference_idx"
  ON "beneficiaries"("external_reference");

-- Dispensing: require beneficiary for operational records going forward.
-- Backfill anonymous seed rows with a placeholder beneficiary if needed.
DO $$
DECLARE
  anon_id UUID;
BEGIN
  IF EXISTS (
    SELECT 1 FROM "dispensing_records" WHERE "beneficiary_id" IS NULL
  ) THEN
    INSERT INTO "beneficiaries" ("id", "beneficiary_number", "name", "notes", "is_active", "created_at", "updated_at")
    VALUES (
      gen_random_uuid(),
      'BN-ANON-SEED',
      'Anonymous walk-in',
      'Auto-created for legacy anonymous dispensing rows',
      true,
      NOW(),
      NOW()
    )
    ON CONFLICT ("beneficiary_number") DO NOTHING;

    SELECT "id" INTO anon_id FROM "beneficiaries" WHERE "beneficiary_number" = 'BN-ANON-SEED';

    UPDATE "dispensing_records"
    SET "beneficiary_id" = anon_id
    WHERE "beneficiary_id" IS NULL;
  END IF;
END $$;

ALTER TABLE "dispensing_records" ALTER COLUMN "beneficiary_id" SET NOT NULL;

ALTER TABLE "dispensing_records" ADD COLUMN IF NOT EXISTS "idempotency_key" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "dispensing_records_pharmacy_id_idempotency_key_key"
  ON "dispensing_records"("pharmacy_id", "idempotency_key");

CREATE INDEX IF NOT EXISTS "dispensing_records_record_number_idx"
  ON "dispensing_records"("record_number");

ALTER TABLE "dispensing_items" ADD COLUMN IF NOT EXISTS "notes" TEXT;
