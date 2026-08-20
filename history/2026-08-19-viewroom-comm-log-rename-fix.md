# 2026-08-19 Viewroom comm log rename fix

## Goal

"so what I want is for the comm logs and tracking to work, dont use profiledb, use lead-grabber,
profiledb should not be used."

Handoff note from the previous agent: when `apps/lead-grabber-v1/src/lib/server/profiledb/telemetry.ts`
was rewritten to write the Communication Log directly to the main CRM Prisma client (instead of
HTTP-POSTing to a now-merged `http://localhost:5100` microservice), the notification function was
renamed `triggerTelemetryNotification` → `notifyTelemetry` but the call site was not updated. The
function therefore never ran, and Comm Logs stayed empty.

## Changed

- `apps/lead-grabber-v1/src/lib/server/profiledb/telemetry.ts:650` — the call site now invokes
  `notifyTelemetry` with the corrected argument order. The function was renamed (commit `e5c9a60`)
  from `triggerTelemetryNotification(tenantSlug, profile, eventType, pageUrl)` to
  `notifyTelemetry(tenantSlug, eventType, profile, pageUrl)` — both the name **and** the 2nd/3rd
  argument positions changed. The caller still used the old name and old order
  (`triggerTelemetryNotification(tenantSlug, updatedProfile, eventType, pageUrl)`), which was a
  runtime `ReferenceError` (the name no longer exists) that the pipeline's `try/catch` swallowed as
  a thrown 500 after the event/profile transaction had already committed. Fixed to
  `void notifyTelemetry(tenantSlug, eventType, updatedProfile, pageUrl)`.

## Root causes

- Rename + signature-reorder in `e5c9a60` without updating the single call site. `vite build`
  (esbuild) does not type-check, so `triggerTelemetryNotification` being an unknown name was never
  flagged; `svelte-check`'s ~330 baseline errors mask it too. The call sat inside the `try` block,
  so the error was caught, logged as "Pipeline error", and re-thrown — the event was already
  persisted but the Comm Log never got created.

## Rejected

- Fixing `apps/profiledb/src/controllers/telemetry.controller.ts` (the standalone profiledb app,
  which still has the old `triggerTelemetryNotification` + HTTP-POST-to-microservice shape). The
  user explicitly said profiledb should not be used; the live route
  `src/routes/api/v1/telemetry/events/+server.ts` imports `$lib/server/profiledb/telemetry` inside
  lead-grabber, so the lead-grabber copy is the one serving traffic.
- Re-pointing the whole telemetry pipeline from the profiledb schema (Tenant / CustomerProfile /
  TelemetryEvent / DeviceFingerprint on `PROFILEDB_DATABASE_URL`) onto the main CRM schema. That is
  a much larger change and not what the handoff described; the described bug was the rename only.
- Making `notifyTelemetry` resolve `companyId` defensively. The viewroom tracking already sends
  `data.owner_company` (the `Company.id` cuid from `toRoom`) as `tenantSlug`, and every other
  caller (`telnyx` webhooks, `messages`, `unified-pipeline`) also passes a company id — so
  `companyId: tenantSlug` satisfies the `communication_logs.companyId → companies.id` FK. Adding a
  lookup for the `'default-tenant'` / `'clearsky-demo'` fallbacks felt like over-engineering for a
  path that only matters when no company is resolvable.

## Not verified

- No end-to-end run: no viewroom was actually joined to confirm a `communication_logs` row is
  created and renders in the Comm Logs UI. The DB hosts (`DATABASE_URL` / `PROFILEDB_DATABASE_URL`)
  were not reachable in a prior session, and none were exercised here.
- That `isHighIntent` gates correctly: `viewroom_entered` is tagged `bucketSignal: 'active'`
  (`eventRegistry.ts:45`), so `getNextBucket` escalates to `active` and `isHighIntent` is true — but
  this was read from code, not observed in a live event.
- `companyId: tenantSlug` under the `'default-tenant'` / `'clearsky-demo'` fallback would violate
  the FK; not exercised.
- No test covers `notifyTelemetry`; the baseline `npx vitest run` (~28 failures) and `svelte-check`
  (~330 errors) were not re-run or compared.

## Open decisions

- Whether the standalone `apps/profiledb` app and its `PROFILEDB_DATABASE_URL` should eventually be
  fully retired in favour of the main CRM schema — the user's "profiledb should not be used" was
  scoped to the comm-log write here, but the whole CDP pipeline still lives on the separate profiledb
  schema.
