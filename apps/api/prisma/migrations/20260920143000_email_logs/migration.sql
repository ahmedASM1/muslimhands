-- Email delivery audit log (Resend / development provider)
CREATE TYPE "EmailLogStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED');

CREATE TABLE "email_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "message_id" TEXT,
    "type" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "status" "EmailLogStatus" NOT NULL DEFAULT 'QUEUED',
    "provider" TEXT NOT NULL DEFAULT 'RESEND',
    "notification_id" UUID,
    "user_id" UUID,
    "sent_at" TIMESTAMPTZ(6),
    "failed_at" TIMESTAMPTZ(6),
    "error_code" TEXT,
    "error_message" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "email_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "email_logs_notification_id_key" ON "email_logs"("notification_id");
CREATE INDEX "email_logs_status_idx" ON "email_logs"("status");
CREATE INDEX "email_logs_type_idx" ON "email_logs"("type");
CREATE INDEX "email_logs_user_id_idx" ON "email_logs"("user_id");
CREATE INDEX "email_logs_created_at_idx" ON "email_logs"("created_at");

ALTER TABLE "email_logs"
  ADD CONSTRAINT "email_logs_notification_id_fkey"
  FOREIGN KEY ("notification_id") REFERENCES "notifications"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "email_logs"
  ADD CONSTRAINT "email_logs_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
