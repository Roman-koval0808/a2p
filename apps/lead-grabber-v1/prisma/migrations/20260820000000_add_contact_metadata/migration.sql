-- Add a metadata bag to contacts so telemetry can persist the visitor fingerprints
-- that resolved into this profile (used to recognise/merge repeat visitors by device).
--
-- `ADD COLUMN ... DEFAULT '{}'` is a catalog-only change in Postgres; no table rewrite
-- and no lock beyond a brief ACCESS EXCLUSIVE on the catalog.

ALTER TABLE "contacts" ADD COLUMN "metadata" JSONB NOT NULL DEFAULT '{}';