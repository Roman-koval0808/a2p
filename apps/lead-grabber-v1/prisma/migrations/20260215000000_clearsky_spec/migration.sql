-- AlterTable: contacts - ClearSky spec fields
ALTER TABLE "contacts" ADD COLUMN "contactType" TEXT DEFAULT 'phone';
ALTER TABLE "contacts" ADD COLUMN "notes" TEXT;
ALTER TABLE "contacts" ADD COLUMN "companyName" TEXT;

-- CreateTable: schedule_events
CREATE TABLE "schedule_events" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "color" TEXT,
    "created" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "schedule_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "schedule_events_companyId_idx" ON "schedule_events"("companyId");
CREATE INDEX "schedule_events_companyId_startTime_idx" ON "schedule_events"("companyId", "startTime");

ALTER TABLE "schedule_events" ADD CONSTRAINT "schedule_events_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: shortcuts
CREATE TABLE "shortcuts" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT,
    "code" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "created" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shortcuts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "shortcuts_companyId_code_key" ON "shortcuts"("companyId", "code");
CREATE INDEX "shortcuts_companyId_idx" ON "shortcuts"("companyId");
CREATE INDEX "shortcuts_companyId_userId_idx" ON "shortcuts"("companyId", "userId");

ALTER TABLE "shortcuts" ADD CONSTRAINT "shortcuts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "shortcuts" ADD CONSTRAINT "shortcuts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: fcm_tokens
CREATE TABLE "fcm_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT,
    "deviceId" TEXT,
    "created" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fcm_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fcm_tokens_userId_deviceId_key" ON "fcm_tokens"("userId", "deviceId");
CREATE INDEX "fcm_tokens_userId_idx" ON "fcm_tokens"("userId");

ALTER TABLE "fcm_tokens" ADD CONSTRAINT "fcm_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
