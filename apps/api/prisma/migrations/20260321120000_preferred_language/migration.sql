-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "PreferredLanguage" AS ENUM ('EN', 'AR');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable
ALTER TABLE "notification_preferences"
  ADD COLUMN IF NOT EXISTS "preferred_language" "PreferredLanguage" NOT NULL DEFAULT 'EN';
