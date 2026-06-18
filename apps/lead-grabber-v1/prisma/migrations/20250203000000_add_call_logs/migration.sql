-- CreateTable (idempotent: only creates if not exists)
CREATE TABLE IF NOT EXISTS "call_logs" (
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

CREATE TABLE IF NOT EXISTS "call_recordings" (
    "id" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "recordingId" TEXT,
    "urls" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "call_recordings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "call_logs_callId_idx" ON "call_logs"("callId");
CREATE INDEX IF NOT EXISTS "call_logs_from_idx" ON "call_logs"("from");
CREATE INDEX IF NOT EXISTS "call_logs_to_idx" ON "call_logs"("to");
CREATE INDEX IF NOT EXISTS "call_recordings_callId_idx" ON "call_recordings"("callId");
