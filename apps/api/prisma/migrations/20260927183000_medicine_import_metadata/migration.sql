-- AlterTable
ALTER TABLE "medicines" ADD COLUMN IF NOT EXISTS "import_metadata" JSONB;
