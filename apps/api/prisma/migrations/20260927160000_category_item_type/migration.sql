-- AlterTable
ALTER TABLE "medicine_categories" ADD COLUMN IF NOT EXISTS "item_type" TEXT NOT NULL DEFAULT 'MEDICINE';

-- CreateIndex
CREATE INDEX IF NOT EXISTS "medicine_categories_item_type_idx" ON "medicine_categories"("item_type");

-- Backfill medical supplies category if present
UPDATE "medicine_categories"
SET "item_type" = 'MEDICAL_SUPPLY'
WHERE lower(name) LIKE '%medical%supplies%';

-- AlterEnum (PostgreSQL 15+ supports IF NOT EXISTS)
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'IMPORT_CATEGORIES';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'IMPORT_MEDICINES';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PURGE_DATA';
