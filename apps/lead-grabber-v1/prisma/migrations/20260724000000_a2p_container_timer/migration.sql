-- CreateSequence
CREATE SEQUENCE IF NOT EXISTS comm_ref_seq START 4000;

-- CreateEnum
CREATE TYPE "ContainerLifecycle" AS ENUM ('provisional', 'confirmed', 'merged');
CREATE TYPE "ContainerState" AS ENUM ('open', 'awaiting_reply', 'awaiting_approval', 'closed');
CREATE TYPE "ContainerResolution" AS ENUM ('resolved', 'timed_out', 'lost');
CREATE TYPE "ThreadType" AS ENUM ('emergency', 'sales', 'support', 'general');
CREATE TYPE "ClosurePolicy" AS ENUM ('auto', 'indefinite');
CREATE TYPE "EntryDirection" AS ENUM ('inbound', 'outbound');
CREATE TYPE "EntryChannel" AS ENUM ('voice', 'sms', 'email', 'form');
CREATE TYPE "PartyType" AS ENUM ('customer', 'rep', 'system');
CREATE TYPE "IdentityMethod" AS ENUM ('ani_exact', 'email_match', 'transcript_name', 'manual', 'none');
CREATE TYPE "TimerType" AS ENUM ('sla_breach', 'thread_inactivity', 'calendar_grace', 'hold_expiry', 'approval_deadline', 'promise_due', 'customer_retry');
CREATE TYPE "TimerStatus" AS ENUM ('registered', 'fired', 'cancelled', 'superseded');
CREATE TYPE "DraftType" AS ENUM ('email', 'sms');
CREATE TYPE "ApprovalState" AS ENUM ('pending', 'approved', 'rejected', 'expired');
CREATE TYPE "TaskCategory" AS ENUM ('customer_promise', 'internal_followup');
CREATE TYPE "CommTaskStatus" AS ENUM ('open', 'done', 'escalated', 'cancelled');

-- AlterTable
ALTER TABLE "pipeline_customer_profiles"
  ADD COLUMN "status" TEXT DEFAULT 'unknown',
  ADD COLUMN "smsConsent" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "consentSource" TEXT,
  ADD COLUMN "smsCapable" BOOLEAN,
  ADD COLUMN "mergedInto" TEXT,
  ADD COLUMN "lineType" TEXT,
  ADD COLUMN "carrier" TEXT,
  ADD COLUMN "lookupDate" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "comm_identifiers" (
    "id" TEXT NOT NULL,
    "customerProfileId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comm_identifiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comm_containers" (
    "id" TEXT NOT NULL,
    "commRef" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "customerProfileId" TEXT,
    "contactId" TEXT,
    "subject" TEXT,
    "threadType" "ThreadType" NOT NULL,
    "lifecycle" "ContainerLifecycle" NOT NULL DEFAULT 'provisional',
    "state" "ContainerState" NOT NULL DEFAULT 'open',
    "resolution" "ContainerResolution",
    "mergedInto" TEXT,
    "actionsSuppressed" BOOLEAN NOT NULL DEFAULT false,
    "slaDeadline" TIMESTAMP(3),
    "closurePolicy" "ClosurePolicy" NOT NULL DEFAULT 'auto',
    "inactivityTimeoutSeconds" INTEGER NOT NULL,
    "joinWindowSeconds" INTEGER NOT NULL,
    "previousThreadId" TEXT,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "comm_containers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comm_entries" (
    "id" TEXT NOT NULL,
    "commId" TEXT NOT NULL,
    "customerProfileId" TEXT,
    "direction" "EntryDirection" NOT NULL,
    "channel" "EntryChannel" NOT NULL,
    "fromParty" TEXT NOT NULL,
    "toParty" TEXT NOT NULL,
    "fromPartyType" "PartyType" NOT NULL,
    "toPartyType" "PartyType" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordingUrl" TEXT,
    "transcript" TEXT,
    "analysisJson" JSONB,
    "dedupSuppressed" BOOLEAN NOT NULL DEFAULT false,
    "identityConfidence" DOUBLE PRECISION,
    "identityMethod" "IdentityMethod" NOT NULL DEFAULT 'none',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comm_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comm_ref_aliases" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "targetCommId" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comm_ref_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "thread_reassignment_logs" (
    "id" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "recordType" TEXT NOT NULL,
    "fromCommId" TEXT,
    "toCommId" TEXT NOT NULL,
    "actor" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "thread_reassignment_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_timers" (
    "id" TEXT NOT NULL,
    "commId" TEXT NOT NULL,
    "companyId" TEXT,
    "type" "TimerType" NOT NULL,
    "fireAt" TIMESTAMP(3) NOT NULL,
    "status" "TimerStatus" NOT NULL DEFAULT 'registered',
    "payload" JSONB DEFAULT '{}',
    "fireEventKey" TEXT,
    "firedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pipeline_timers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comm_tasks" (
    "id" TEXT NOT NULL,
    "commId" TEXT NOT NULL,
    "sourceEntryId" TEXT,
    "description" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "due" TIMESTAMP(3) NOT NULL,
    "category" "TaskCategory" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "status" "CommTaskStatus" NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "comm_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comm_holds" (
    "id" TEXT NOT NULL,
    "commId" TEXT NOT NULL,
    "resourceIds" JSONB NOT NULL DEFAULT '[]',
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'tentative',
    "holdExpiresAt" TIMESTAMP(3) NOT NULL,
    "calendarEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "comm_holds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comm_approvals" (
    "id" TEXT NOT NULL,
    "commId" TEXT NOT NULL,
    "draftType" "DraftType" NOT NULL,
    "draftContent" TEXT NOT NULL,
    "contextPayload" JSONB NOT NULL DEFAULT '{}',
    "approvalDeadline" TIMESTAMP(3) NOT NULL,
    "state" "ApprovalState" NOT NULL DEFAULT 'pending',
    "approvedBy" TEXT,
    "rejectedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "comm_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "comm_identifiers_customerProfileId_kind_value_key" ON "comm_identifiers"("customerProfileId", "kind", "value");
CREATE INDEX "comm_identifiers_kind_value_idx" ON "comm_identifiers"("kind", "value");

-- CreateIndex
CREATE UNIQUE INDEX "comm_containers_commRef_key" ON "comm_containers"("commRef");
CREATE INDEX "comm_containers_companyId_idx" ON "comm_containers"("companyId");
CREATE INDEX "comm_containers_customerProfileId_idx" ON "comm_containers"("customerProfileId");
CREATE INDEX "comm_containers_companyId_threadType_state_idx" ON "comm_containers"("companyId", "threadType", "state");
CREATE INDEX "comm_containers_companyId_lifecycle_state_idx" ON "comm_containers"("companyId", "lifecycle", "state");
CREATE INDEX "comm_containers_mergedInto_idx" ON "comm_containers"("mergedInto");

-- CreateIndex
CREATE INDEX "comm_entries_commId_occurredAt_idx" ON "comm_entries"("commId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "comm_ref_aliases_ref_key" ON "comm_ref_aliases"("ref");
CREATE INDEX "comm_ref_aliases_targetCommId_idx" ON "comm_ref_aliases"("targetCommId");

-- CreateIndex
CREATE INDEX "thread_reassignment_logs_recordId_idx" ON "thread_reassignment_logs"("recordId");
CREATE INDEX "thread_reassignment_logs_toCommId_idx" ON "thread_reassignment_logs"("toCommId");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_timers_fireEventKey_key" ON "pipeline_timers"("fireEventKey");
CREATE INDEX "pipeline_timers_status_fireAt_idx" ON "pipeline_timers"("status", "fireAt");
CREATE INDEX "pipeline_timers_commId_type_status_idx" ON "pipeline_timers"("commId", "type", "status");

-- CreateIndex
CREATE INDEX "comm_tasks_commId_idx" ON "comm_tasks"("commId");
CREATE INDEX "comm_tasks_ownerUserId_status_idx" ON "comm_tasks"("ownerUserId", "status");

-- CreateIndex
CREATE INDEX "comm_holds_commId_idx" ON "comm_holds"("commId");
CREATE INDEX "comm_holds_status_holdExpiresAt_idx" ON "comm_holds"("status", "holdExpiresAt");

-- CreateIndex
CREATE INDEX "comm_approvals_commId_idx" ON "comm_approvals"("commId");
CREATE INDEX "comm_approvals_state_approvalDeadline_idx" ON "comm_approvals"("state", "approvalDeadline");

-- AddForeignKey
ALTER TABLE "comm_identifiers" ADD CONSTRAINT "comm_identifiers_customerProfileId_fkey" FOREIGN KEY ("customerProfileId") REFERENCES "pipeline_customer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comm_containers" ADD CONSTRAINT "comm_containers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "comm_containers" ADD CONSTRAINT "comm_containers_customerProfileId_fkey" FOREIGN KEY ("customerProfileId") REFERENCES "pipeline_customer_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "comm_containers" ADD CONSTRAINT "comm_containers_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comm_entries" ADD CONSTRAINT "comm_entries_commId_fkey" FOREIGN KEY ("commId") REFERENCES "comm_containers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comm_ref_aliases" ADD CONSTRAINT "comm_ref_aliases_targetCommId_fkey" FOREIGN KEY ("targetCommId") REFERENCES "comm_containers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_timers" ADD CONSTRAINT "pipeline_timers_commId_fkey" FOREIGN KEY ("commId") REFERENCES "comm_containers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comm_tasks" ADD CONSTRAINT "comm_tasks_commId_fkey" FOREIGN KEY ("commId") REFERENCES "comm_containers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comm_holds" ADD CONSTRAINT "comm_holds_commId_fkey" FOREIGN KEY ("commId") REFERENCES "comm_containers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comm_approvals" ADD CONSTRAINT "comm_approvals_commId_fkey" FOREIGN KEY ("commId") REFERENCES "comm_containers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
