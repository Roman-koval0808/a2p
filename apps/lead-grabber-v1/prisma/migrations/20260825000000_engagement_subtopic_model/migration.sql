-- Engagement model: thread = business episode, log = session, per-subtopic scoring.
--
-- CommunicationThread gains the engagement fields:
--   * subtopics        — distinct roll-up of subtopic tags seen in this episode
--   * subtopicScores   — per-subtopic engagement-score deltas {"bathroom":30,"kitchen":20}
--   * engagementScore  — roll-up of subtopicScores, capped at 100 on the total
--   * closedAt         — when the episode closed (active = status != 'closed')
--   * assignReason     — why a session was assigned to this thread (resolution rule)
--   * rulesVersion     — which resolution ruleset decided it
--
-- CommunicationLog gains:
--   * subtopic  — the type of business for THIS session (nullable = unknown)
--   * sessionRef— the SES- identifier for the session (Session ID)
--
-- PipelineEvent gains `payload` so the raw signal payload (page URL, service, etc.)
-- is persisted instead of being discarded on intake — required for per-subtopic
-- attribution (§4.2) and any future backfill.

ALTER TABLE "communication_threads"
    ADD COLUMN "subtopics"       JSONB NOT NULL DEFAULT '[]',
    ADD COLUMN "subtopicScores"  JSONB NOT NULL DEFAULT '{}',
    ADD COLUMN "engagementScore" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "closedAt"        TIMESTAMP(3),
    ADD COLUMN "assignReason"    TEXT,
    ADD COLUMN "rulesVersion"    TEXT;

ALTER TABLE "communication_logs"
    ADD COLUMN "subtopic"   TEXT,
    ADD COLUMN "sessionRef" TEXT;

ALTER TABLE "pipeline_events"
    ADD COLUMN "payload" JSONB;
