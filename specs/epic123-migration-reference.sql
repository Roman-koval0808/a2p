-- ============================================================================
-- Epics 1–3 schema changes — REFERENCE ONLY.
--
-- Preferred way to apply (lets Prisma generate the exact SQL from the schema diff):
--   MAIN DB:   npx prisma migrate dev --name epic123_identity_emergency_sla
--   PROFILEDB: npx prisma db push --schema=prisma/profiledb.schema.prisma
--
-- The statements below are what those commands produce, for review.
-- ============================================================================

-- ─── MAIN DB (prisma/schema.prisma → clearsky-db) ───────────────────────────

-- T2.1: always-populated emergency_type on the AI enrichment
ALTER TABLE "pipeline_enrichments" ADD COLUMN "aiEmergencyType" TEXT;

-- T3.3: minute-level SLA, transactional auto-reply toggle, structured office hours
ALTER TABLE "pipeline_business_configs" ADD COLUMN "slaMinutes" INTEGER NOT NULL DEFAULT 10;
ALTER TABLE "pipeline_business_configs" ADD COLUMN "smsAutoReplyAllowed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "pipeline_business_configs" ADD COLUMN "officeHours" JSONB;

-- T3.4: SLA-breach escalation stamp (avoids re-escalating the same item)
ALTER TABLE "pipeline_action_queue" ADD COLUMN "slaEscalatedAt" TIMESTAMP(3);

-- T3.2: SMS consent split by purpose (transactional vs marketing)
CREATE TABLE "sms_consents" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'granted',
    "source" TEXT,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "sms_consents_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "sms_consents_companyId_phone_purpose_key" ON "sms_consents"("companyId", "phone", "purpose");
CREATE INDEX "sms_consents_companyId_phone_idx" ON "sms_consents"("companyId", "phone");

-- ─── PROFILEDB (prisma/profiledb.schema.prisma → profiledb) ──────────────────

-- T1.4: thread linkage so an anonymous pixel session can be tied to its later message
ALTER TABLE "TelemetryEvent" ADD COLUMN "threadId" TEXT;
CREATE INDEX "TelemetryEvent_threadId_idx" ON "TelemetryEvent"("threadId");
