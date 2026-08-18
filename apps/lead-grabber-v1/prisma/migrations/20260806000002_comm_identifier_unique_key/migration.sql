-- One person, one record: an identifier points at exactly one profile.
--
-- Until now uniqueness was scoped to (customerProfileId, kind, value) — unique *within* a profile,
-- which permitted the same email address sitting on two profiles. That is precisely the duplicate
-- this is meant to make impossible, so the constraint moves to (companyId, kind, value): a second
-- profile claiming an identifier becomes a failed write rather than something found weeks later.
--
-- Existing data will contain violations. Those are the duplicates. We cannot create the index while
-- they exist, and we must not silently drop them, so each one is first recorded as a merge
-- candidate for a human to resolve — then the surplus rows are removed so the constraint can land.
-- No profile is deleted here and no history moves; only the redundant key rows go.

-- 1. Record every conflicting pair as a pending merge candidate.
--    The pair is stored ordered (least, greatest) to match the application's normalisation, so the
--    same duplicate can't be recorded twice under two orderings.
INSERT INTO "profile_merge_candidates" (
    "id", "companyId", "primaryProfileId", "duplicateProfileId", "reason", "status",
    "createdAt", "updatedAt"
)
SELECT
    gen_random_uuid()::text,
    a."companyId",
    LEAST(a."customerProfileId", b."customerProfileId"),
    GREATEST(a."customerProfileId", b."customerProfileId"),
    'identifier_collision (' || a."kind" || ') — found by the one-person-one-record backfill',
    'pending',
    NOW(),
    NOW()
FROM "comm_identifiers" a
JOIN "comm_identifiers" b
  ON a."companyId" = b."companyId"
 AND a."kind" = b."kind"
 AND a."value" = b."value"
 AND a."customerProfileId" <> b."customerProfileId"
WHERE a."customerProfileId" < b."customerProfileId"
GROUP BY a."companyId", a."kind",
         LEAST(a."customerProfileId", b."customerProfileId"),
         GREATEST(a."customerProfileId", b."customerProfileId")
ON CONFLICT ("companyId", "primaryProfileId", "duplicateProfileId") DO NOTHING;

-- 2. Keep the earliest row for each key and delete the rest. First seen wins, which matches
--    point-and-retire: the surviving key keeps pointing where it always did.
DELETE FROM "comm_identifiers" ci
USING "comm_identifiers" keep
WHERE ci."companyId" = keep."companyId"
  AND ci."kind" = keep."kind"
  AND ci."value" = keep."value"
  AND (
        keep."createdAt" < ci."createdAt"
     OR (keep."createdAt" = ci."createdAt" AND keep."id" < ci."id")
  );

-- 3. The rule, enforced by the database rather than by everyone remembering.
CREATE UNIQUE INDEX "comm_identifiers_companyId_kind_value_key"
    ON "comm_identifiers"("companyId", "kind", "value");
