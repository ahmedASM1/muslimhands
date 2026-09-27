-- AlterTable
ALTER TABLE "medicine_categories" ADD COLUMN IF NOT EXISTS "item_type" TEXT NOT NULL DEFAULT 'MEDICINE';

-- CreateIndex
CREATE INDEX IF NOT EXISTS "medicine_categories_item_type_idx" ON "medicine_categories"("item_type");

-- Backfill medical supplies category if present
UPDATE "medicine_categories"
SET "item_type" = 'MEDICAL_SUPPLY'
WHERE lower(name) LIKE '%medical%supplies%' OR lower(name) LIKE '%مستلزم%';

-- AlterEnum
DO $$ BEGIN
  ALTER TYPE "AuditAction" ADD VALUE 'IMPORT_CATEGORIES';
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TYPE "AuditAction" ADD VALUE 'IMPORT_MEDICINES';
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TYPE "AuditAction" ADD VALUE 'PURGE_DATA';
EXCEPTION WHEN duplicate_object THEN null;
END $$;
