-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('owner', 'admin', 'agent');

-- CreateEnum
CREATE TYPE "CompanyMemberRole" AS ENUM ('owner', 'admin', 'member');

-- CreateEnum
CREATE TYPE "CompanyMemberStatus" AS ENUM ('active', 'inactive', 'suspended');

-- CreateEnum
CREATE TYPE "CommunicationType" AS ENUM ('email', 'sms', 'voice', 'web', 'facebook', 'chatbot', 'leadform', 'leadbox');

-- CreateEnum
CREATE TYPE "CommunicationDirection" AS ENUM ('inbound', 'outbound');

-- CreateEnum
CREATE TYPE "CommunicationStatus" AS ENUM ('success', 'failed', 'pending', 'missed', 'completed');

-- CreateEnum
CREATE TYPE "InviteRole" AS ENUM ('admin', 'member');

-- CreateEnum
CREATE TYPE "InviteStatus" AS ENUM ('accepted', 'pending', 'declined');

-- CreateEnum
CREATE TYPE "LeadboxStatus" AS ENUM ('active', 'inactive');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('new', 'read', 'replied', 'assigned', 'closed');

-- CreateEnum
CREATE TYPE "MessageUrgency" AS ENUM ('green', 'blue', 'red');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "tokenKey" TEXT NOT NULL,
    "emailVisibility" BOOLEAN NOT NULL DEFAULT false,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "name" TEXT,
    "avatar" TEXT,
    "role" "UserRole",
    "companyId" TEXT,
    "created" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_superusers" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "tokenKey" TEXT NOT NULL,
    "emailVisibility" BOOLEAN NOT NULL DEFAULT false,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "created" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "_superusers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_authOrigins" (
    "id" TEXT NOT NULL,
    "collectionRef" TEXT NOT NULL,
    "recordRef" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "created" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "_authOrigins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_externalAuths" (
    "id" TEXT NOT NULL,
    "collectionRef" TEXT NOT NULL,
    "recordRef" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "created" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "_externalAuths_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_mfas" (
    "id" TEXT NOT NULL,
    "collectionRef" TEXT NOT NULL,
    "recordRef" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "created" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "_mfas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_otps" (
    "id" TEXT NOT NULL,
    "collectionRef" TEXT NOT NULL,
    "recordRef" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "sentTo" TEXT,
    "created" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "_otps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "companies" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "website" TEXT,
    "ownerId" TEXT NOT NULL,
    "settings" JSONB,
    "logo" TEXT,
    "emailSlug" TEXT,
    "created" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_phone_numbers" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "telnyxPhoneNumberId" TEXT,
    "created" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_phone_numbers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_flows" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "greetingAudioUrl" TEXT,
    "queueHoldAudioUrl" TEXT,
    "allUnavailableAudioUrl" TEXT,
    "backupCellAudioUrl" TEXT,
    "failoverConfig" JSONB,
    "created" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "call_flows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_flow_rules" (
    "id" TEXT NOT NULL,
    "callFlowId" TEXT NOT NULL,
    "ruleTitle" TEXT NOT NULL,
    "schedule" JSONB NOT NULL,
    "promptsAudioUrl" TEXT,
    "keyPrompts" JSONB NOT NULL,
    "failoverCount" INTEGER NOT NULL DEFAULT 2,
    "failoverDelayMinutes" INTEGER NOT NULL DEFAULT 2,
    "failoverAudioUrl" TEXT,
    "hangupAudioUrl" TEXT,
    "leaveMessageOnHash" BOOLEAN NOT NULL DEFAULT true,
    "created" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "call_flow_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "locations" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "city" TEXT,
    "phone" TEXT,
    "hours" JSONB,
    "created" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_members" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "role" "CompanyMemberRole" NOT NULL,
    "permissions" JSONB,
    "status" "CompanyMemberStatus" NOT NULL,
    "joinedAt" TIMESTAMP(3),
    "created" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "name" TEXT,
    "address" TEXT,
    "landline" TEXT,
    "cell" TEXT,
    "smsPermission" BOOLEAN NOT NULL DEFAULT false,
    "pastNames" JSONB,
    "created" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication_logs" (
    "id" TEXT NOT NULL,
    "type" "CommunicationType" NOT NULL,
    "direction" "CommunicationDirection" NOT NULL,
    "status" "CommunicationStatus" NOT NULL,
    "source" TEXT,
    "destination" TEXT,
    "customerId" TEXT,
    "companyId" TEXT NOT NULL,
    "userId" TEXT,
    "summary" TEXT,
    "content" TEXT,
    "duration" DOUBLE PRECISION,
    "metadata" JSONB,
    "created" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "communication_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_communication_log_assigned_members" (
    "communicationLogId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "_communication_log_assigned_members_pkey" PRIMARY KEY ("communicationLogId","userId")
);

-- CreateTable
CREATE TABLE "invites" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "companyId" TEXT,
    "invitedById" TEXT,
    "userId" TEXT,
    "role" "InviteRole",
    "status" "InviteStatus" NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "declinedAt" TIMESTAMP(3),
    "created" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leadboxes" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT,
    "status" "LeadboxStatus" NOT NULL,
    "leadboxData" JSONB,
    "created" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leadboxes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leadforms" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "formData" JSONB,
    "created" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leadforms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "logos" (
    "id" TEXT NOT NULL,
    "logo" TEXT,
    "created" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "logos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "customerName" TEXT,
    "customerEmail" TEXT,
    "customerPhone" TEXT,
    "assignedToId" TEXT,
    "status" "MessageStatus" NOT NULL,
    "urgency" "MessageUrgency",
    "urgencyScore" INTEGER,
    "sentiment" TEXT,
    "intent" TEXT,
    "draftResponse" TEXT,
    "aiSummary" TEXT,
    "messages" JSONB,
    "created" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_logs" (
    "id" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "to" TEXT,
    "from" TEXT,
    "duration" DOUBLE PRECISION,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "call_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_recordings" (
    "id" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "recordingId" TEXT,
    "urls" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "call_recordings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "type" "CommunicationType" NOT NULL,
    "direction" "CommunicationDirection" NOT NULL,
    "sourceName" TEXT,
    "sourceIdentifier" TEXT,
    "messagePreview" TEXT NOT NULL,
    "content" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "communicationLogId" TEXT,
    "messageId" TEXT,
    "threadId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_tokenKey_key" ON "users"("tokenKey");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_tokenKey_idx" ON "users"("tokenKey");

-- CreateIndex
CREATE UNIQUE INDEX "_superusers_email_key" ON "_superusers"("email");

-- CreateIndex
CREATE UNIQUE INDEX "_superusers_tokenKey_key" ON "_superusers"("tokenKey");

-- CreateIndex
CREATE INDEX "_superusers_email_idx" ON "_superusers"("email");

-- CreateIndex
CREATE INDEX "_superusers_tokenKey_idx" ON "_superusers"("tokenKey");

-- CreateIndex
CREATE UNIQUE INDEX "_authOrigins_collectionRef_recordRef_fingerprint_key" ON "_authOrigins"("collectionRef", "recordRef", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "_externalAuths_collectionRef_recordRef_provider_key" ON "_externalAuths"("collectionRef", "recordRef", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "_externalAuths_collectionRef_provider_providerId_key" ON "_externalAuths"("collectionRef", "provider", "providerId");

-- CreateIndex
CREATE INDEX "_mfas_collectionRef_recordRef_idx" ON "_mfas"("collectionRef", "recordRef");

-- CreateIndex
CREATE INDEX "_otps_collectionRef_recordRef_idx" ON "_otps"("collectionRef", "recordRef");

-- CreateIndex
CREATE UNIQUE INDEX "companies_emailSlug_key" ON "companies"("emailSlug");

-- CreateIndex
CREATE INDEX "company_phone_numbers_companyId_idx" ON "company_phone_numbers"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "company_phone_numbers_phoneNumber_key" ON "company_phone_numbers"("phoneNumber");

-- CreateIndex
CREATE INDEX "call_flows_companyId_idx" ON "call_flows"("companyId");

-- CreateIndex
CREATE INDEX "call_flow_rules_callFlowId_idx" ON "call_flow_rules"("callFlowId");

-- CreateIndex
CREATE INDEX "locations_companyId_idx" ON "locations"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "company_members_userId_companyId_key" ON "company_members"("userId", "companyId");

-- CreateIndex
CREATE INDEX "contacts_companyId_idx" ON "contacts"("companyId");

-- CreateIndex
CREATE INDEX "communication_logs_companyId_idx" ON "communication_logs"("companyId");

-- CreateIndex
CREATE INDEX "communication_logs_customerId_idx" ON "communication_logs"("customerId");

-- CreateIndex
CREATE INDEX "communication_logs_userId_idx" ON "communication_logs"("userId");

-- CreateIndex
CREATE INDEX "invites_companyId_idx" ON "invites"("companyId");

-- CreateIndex
CREATE INDEX "invites_email_idx" ON "invites"("email");

-- CreateIndex
CREATE INDEX "leadboxes_ownerId_idx" ON "leadboxes"("ownerId");

-- CreateIndex
CREATE INDEX "leadforms_ownerId_idx" ON "leadforms"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "messages_threadId_key" ON "messages"("threadId");

-- CreateIndex
CREATE INDEX "messages_companyId_idx" ON "messages"("companyId");

-- CreateIndex
CREATE INDEX "messages_assignedToId_idx" ON "messages"("assignedToId");

-- CreateIndex
CREATE INDEX "messages_status_idx" ON "messages"("status");

-- CreateIndex
CREATE INDEX "call_logs_callId_idx" ON "call_logs"("callId");

-- CreateIndex
CREATE INDEX "call_logs_from_idx" ON "call_logs"("from");

-- CreateIndex
CREATE INDEX "call_logs_to_idx" ON "call_logs"("to");

-- CreateIndex
CREATE INDEX "call_recordings_callId_idx" ON "call_recordings"("callId");

-- CreateIndex
CREATE INDEX "notifications_companyId_idx" ON "notifications"("companyId");

-- CreateIndex
CREATE INDEX "notifications_companyId_createdAt_idx" ON "notifications"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_read_idx" ON "notifications"("read");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_phone_numbers" ADD CONSTRAINT "company_phone_numbers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_flows" ADD CONSTRAINT "call_flows_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_flow_rules" ADD CONSTRAINT "call_flow_rules_callFlowId_fkey" FOREIGN KEY ("callFlowId") REFERENCES "call_flows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_members" ADD CONSTRAINT "company_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_members" ADD CONSTRAINT "company_members_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_logs" ADD CONSTRAINT "communication_logs_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_logs" ADD CONSTRAINT "communication_logs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_logs" ADD CONSTRAINT "communication_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_communication_log_assigned_members" ADD CONSTRAINT "_communication_log_assigned_members_communicationLogId_fkey" FOREIGN KEY ("communicationLogId") REFERENCES "communication_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_communication_log_assigned_members" ADD CONSTRAINT "_communication_log_assigned_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invites" ADD CONSTRAINT "invites_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invites" ADD CONSTRAINT "invites_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invites" ADD CONSTRAINT "invites_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leadboxes" ADD CONSTRAINT "leadboxes_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leadforms" ADD CONSTRAINT "leadforms_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

