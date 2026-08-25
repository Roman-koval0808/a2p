-- Attach the resolved subtopic to the interaction itself.
--
-- Subtopic attribution was previously computed transiently during the comm-log rollup, so the
-- aggregate existed but the individual interactions did not carry their subject — you could see
-- that an engagement scored 30 on "bathroom" but not which interactions those were.
--
-- NULL = no identifiable subject for that interaction. Those are scored separately under the
-- `unknown` key in CommunicationThread.subtopicScores and are never listed in `subtopics`.

ALTER TABLE "pipeline_events" ADD COLUMN "subtopic" TEXT;

CREATE INDEX "pipeline_events_subtopic_idx" ON "pipeline_events" ("subtopic");
