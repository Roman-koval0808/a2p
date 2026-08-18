-- Give comm_identifiers a company.
--
-- An identifier has to be unique to one person, but only *within a tenant* — two companies can
-- legitimately both know bert@x.com, and they are not the same record. The uniqueness rule
-- therefore needs a companyId to hang off, which this column supplies. The constraint itself is
-- added in the next migration, once the backfill below has run.

ALTER TABLE "comm_identifiers" ADD COLUMN "companyId" TEXT;

-- Backfill from the profile each identifier already belongs to.
UPDATE "comm_identifiers" ci
SET "companyId" = p."companyId"
FROM "pipeline_customer_profiles" p
WHERE ci."customerProfileId" = p."id";

-- Any row whose profile has vanished has nothing to point at and cannot be assigned a company.
DELETE FROM "comm_identifiers" WHERE "companyId" IS NULL;

ALTER TABLE "comm_identifiers" ALTER COLUMN "companyId" SET NOT NULL;

CREATE INDEX "comm_identifiers_companyId_idx" ON "comm_identifiers"("companyId");

ALTER TABLE "comm_identifiers"
  ADD CONSTRAINT "comm_identifiers_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
