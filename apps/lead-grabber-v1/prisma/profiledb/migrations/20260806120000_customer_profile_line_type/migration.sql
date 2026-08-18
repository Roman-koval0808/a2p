-- Telnyx line type for the hashed `phone` key (§4.3a).
-- Only a mobile line is exclusive to one person, so only a mobile earns Tier 1. The phone is
-- stored as a hash and cannot be classified after the fact, so this is captured at capture time.
-- NULL means "never classified" and is treated as unknown -> Tier 2. Never default upward.
ALTER TABLE "CustomerProfile" ADD COLUMN "lineType" TEXT;

-- Merging points the keys at the survivor and tombstones the loser; it never deletes. Old profile
-- IDs live on in cookies, conversation threads and task records, and a lookup on a retired ID has
-- to keep working by following this pointer to the surviving record.
ALTER TABLE "CustomerProfile" ADD COLUMN "mergedInto" TEXT;
CREATE INDEX "CustomerProfile_mergedInto_idx" ON "CustomerProfile"("mergedInto");
