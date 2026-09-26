-- Single-organization model. This is not multi-tenant isolation.
CREATE TABLE "organizations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "organizations_code_key" ON "organizations"("code");

INSERT INTO "organizations" ("id", "code", "name", "created_at", "updated_at")
VALUES (gen_random_uuid(), 'ORG-001', 'Medicine Distribution Organization', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

ALTER TABLE "warehouses" ADD COLUMN "location" TEXT;
ALTER TABLE "warehouses" ADD COLUMN "organization_id" UUID;
ALTER TABLE "pharmacies" ADD COLUMN "organization_id" UUID;
ALTER TABLE "users" ADD COLUMN "organization_id" UUID;

UPDATE "warehouses" SET "organization_id" = (SELECT "id" FROM "organizations" WHERE "code" = 'ORG-001');
UPDATE "pharmacies" SET "organization_id" = (SELECT "id" FROM "organizations" WHERE "code" = 'ORG-001');
UPDATE "users" SET "organization_id" = (SELECT "id" FROM "organizations" WHERE "code" = 'ORG-001');

ALTER TABLE "warehouses" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "pharmacies" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "users" ALTER COLUMN "organization_id" SET NOT NULL;

ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pharmacies" ADD CONSTRAINT "pharmacies_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "warehouses_organization_id_idx" ON "warehouses"("organization_id");
CREATE INDEX "pharmacies_organization_id_idx" ON "pharmacies"("organization_id");
CREATE INDEX "users_organization_id_idx" ON "users"("organization_id");
