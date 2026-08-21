-- AI assistants, ported from the standalone viewroom app.
--
-- Differences from the viewroom's `ai_assistants` table, both deliberate:
--   * `companyId` is required. The viewroom relied on its own deployment's auth and had no tenant
--     column; a2p is multi-tenant and every assistant query is scoped by company.
--   * ids are text/cuid to match the rest of this schema, not uuid.
--
-- `trainingFiles` holds `content_library` ids: the knowledge base reuses the existing content
-- library rather than adding a second file store, so no table is needed for it here.

CREATE TABLE "ai_assistants" (
    "id"                  TEXT NOT NULL,
    "companyId"           TEXT NOT NULL,
    "name"                TEXT NOT NULL,
    "systemPrompt"        TEXT,
    "viewroomConnections" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "trainingFiles"       TEXT[] DEFAULT ARRAY[]::TEXT[],
    "engagements"         JSONB,
    "status"              BOOLEAN NOT NULL DEFAULT true,
    "created"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated"             TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_assistants_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_assistants_companyId_idx" ON "ai_assistants"("companyId");

ALTER TABLE "ai_assistants"
    ADD CONSTRAINT "ai_assistants_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
