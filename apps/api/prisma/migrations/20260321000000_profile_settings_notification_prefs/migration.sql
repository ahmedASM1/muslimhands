-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'UPDATE_PROFILE';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CHANGE_PASSWORD';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'UPDATE_SETTINGS';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SEND_TEST_EMAIL';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'UPDATE_NOTIFICATION_PREFERENCES';

-- CreateTable
CREATE TABLE IF NOT EXISTS "notification_preferences" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "email_enabled" BOOLEAN NOT NULL DEFAULT true,
    "in_app_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "notification_preferences_user_id_key" ON "notification_preferences"("user_id");

DO $$ BEGIN
  ALTER TABLE "notification_preferences"
    ADD CONSTRAINT "notification_preferences_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
