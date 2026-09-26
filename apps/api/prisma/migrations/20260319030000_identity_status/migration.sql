ALTER TYPE "UserStatus" ADD VALUE IF NOT EXISTS 'INVITED';
ALTER TYPE "UserStatus" ADD VALUE IF NOT EXISTS 'SUSPENDED';

ALTER TABLE "invitations" ADD COLUMN IF NOT EXISTS "organization_id" UUID;
ALTER TABLE "invitations" ADD COLUMN IF NOT EXISTS "user_id" UUID;

UPDATE "invitations"
SET "organization_id" = (SELECT "id" FROM "organizations" ORDER BY "created_at" ASC LIMIT 1)
WHERE "organization_id" IS NULL;

ALTER TABLE "invitations" ALTER COLUMN "organization_id" SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invitations_organization_id_fkey'
  ) THEN
    ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organization_id_fkey"
      FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invitations_user_id_fkey'
  ) THEN
    ALTER TABLE "invitations" ADD CONSTRAINT "invitations_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "invitations_organization_id_idx" ON "invitations"("organization_id");
CREATE INDEX IF NOT EXISTS "invitations_user_id_idx" ON "invitations"("user_id");
