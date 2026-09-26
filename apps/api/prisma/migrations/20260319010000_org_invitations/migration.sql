-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED');

ALTER TYPE "AuditAction" ADD VALUE 'CREATE_PHARMACY';
ALTER TYPE "AuditAction" ADD VALUE 'UPDATE_PHARMACY';
ALTER TYPE "AuditAction" ADD VALUE 'INVITE_USER';
ALTER TYPE "AuditAction" ADD VALUE 'ACCEPT_INVITATION';

ALTER TYPE "NotificationType" ADD VALUE 'OUT_OF_STOCK';
ALTER TYPE "NotificationType" ADD VALUE 'SUPPLY_REQUEST_SUBMITTED';
ALTER TYPE "NotificationType" ADD VALUE 'SUPPLY_REQUEST_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE 'SUPPLY_REQUEST_REJECTED';
ALTER TYPE "NotificationType" ADD VALUE 'TRANSFER_CREATED';
ALTER TYPE "NotificationType" ADD VALUE 'TRANSFER_RECEIVED';

ALTER TABLE "dispensing_items" ADD COLUMN "reference_value" DECIMAL(12,4);
ALTER TABLE "medicines" ADD COLUMN "reference_value" DECIMAL(12,4);

ALTER TABLE "pharmacies"
  ADD COLUMN "email" TEXT,
  ADD COLUMN "location" TEXT,
  ADD COLUMN "phone" TEXT,
  ADD COLUMN "slug" TEXT;

UPDATE "pharmacies" SET "slug" = lower(regexp_replace("code", '[^a-zA-Z0-9]+', '-', 'g')) WHERE "slug" IS NULL;
ALTER TABLE "pharmacies" ALTER COLUMN "slug" SET NOT NULL;
CREATE UNIQUE INDEX "pharmacies_slug_key" ON "pharmacies"("slug");

ALTER TABLE "users"
  ADD COLUMN "pharmacy_id" UUID,
  ADD COLUMN "warehouse_id" UUID,
  ALTER COLUMN "password_hash" DROP NOT NULL;

CREATE TABLE "invitations" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "role_id" UUID NOT NULL,
    "pharmacy_id" UUID,
    "warehouse_id" UUID,
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "invited_by_id" UUID NOT NULL,
    "accepted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "invitations_token_hash_key" ON "invitations"("token_hash");
CREATE INDEX "invitations_email_status_idx" ON "invitations"("email", "status");
CREATE INDEX "invitations_expires_at_idx" ON "invitations"("expires_at");
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens"("user_id");
CREATE INDEX "users_pharmacy_id_idx" ON "users"("pharmacy_id");
CREATE INDEX "users_warehouse_id_idx" ON "users"("warehouse_id");

ALTER TABLE "users" ADD CONSTRAINT "users_pharmacy_id_fkey" FOREIGN KEY ("pharmacy_id") REFERENCES "pharmacies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "users" ADD CONSTRAINT "users_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_pharmacy_id_fkey" FOREIGN KEY ("pharmacy_id") REFERENCES "pharmacies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_id_fkey" FOREIGN KEY ("invited_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
