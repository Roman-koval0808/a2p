# 2026-08-19 Viewroom comm log signal + profile

## Goal

Follow-up to the rename fix. The viewroom comm log now lands, but it is wrong in four ways the
user called out explicitly:

- "source should show user profile, seems we are attaching web to this, viewroom should have its
  own signal" — the log was `type: 'web'` and `source: 'Viewroom / Telemetry'` (no contact linked).
- "commid never resolved" — the log had no `communicationThreadId`, so the COM id anchored on the
  bare log id.
- "I dont think it even ran through the orchestrator, it should and create a user profile. It didnt
  create a profile" — no `Contact` was created in the main CRM.

## Changed

- **`prisma/schema.prisma`** — added `viewroom` to the `CommunicationType` enum.
- **`prisma/migrations/20260819000000_add_viewroom_communication_type/migration.sql` (new)** —
  `ALTER TYPE "CommunicationType" ADD VALUE 'viewroom';` (additive; `prisma migrate` is broken by
  pre-existing drift, so this is applied manually).
- **`src/lib/utils/communication-log.ts`** — added `'viewroom'` to the local `CommunicationType`
  union.
- **`src/lib/components/CommunicationTable.svelte`** — `viewroom` icon (`Video`), type union, and a
  "Viewroom" filter chip so the new type renders and filters like the others.
- **`src/lib/server/profiledb/telemetry.ts` `notifyTelemetry` (rewritten)** — no longer does a raw
  `communicationLog.create`. Now: resolves the `Company` from `tenantSlug` (id, falling back to
  `emailSlug`); `createOrUpdateContact` from the visitor's name/email/phone; `logCommunication` with
  `type: 'viewroom'`, `customer_id` linked, and a `communicationThread` created (so the COM id
  resolves); then fires `process_orchestrator(log.id, 'viewroom_entered')`. Signature grew an
  `identifiers` param carrying the raw name/email/phone.
- **caller in `ingestTelemetryEvent`** — passes `{ name, email, phone }` (raw, from `reqBody`).
  Note: the profiledb profile's `email`/`phone` are sha256 hashes and the name is only persisted
  when an email/phone is present (`identity.service.ts` early-returns), so the raw request fields
  are the only usable identifiers.
- **`src/routes/(app)/room/[roomId]/+page@.svelte`** — `trackViewroomJoin` now sends
  `name: name || $anonymousUser || ''` on `viewroom_entered`, so the visitor's name is available
  when the comm log is created (the embed/`?anonymousUserId=` name was otherwise lost).
- **`.env.local`** — split the corrupted line 39 where `PUBLIC_ANT_MEDIA_URL` had been glued onto
  `PROFILEDB_DATABASE_URL` (no newline), which silently broke the local profiledb connection and
  made every local telemetry ingest fail. (Local-only, gitignored; recorded here for the record.)

## Root causes

- The comm log was written by `mainPrisma.communicationLog.create` directly, bypassing
  `logCommunication`, so it had no thread, no contact, and used the generic `web` type.
- The visitor's name never reached the comm log: `viewroom_entered` didn't include it, and the
  profiledb layer doesn't persist a name-only identifier.

## Rejected

- Reusing an existing type (`web`/`chatbot`) for viewroom — user explicitly wants its own signal.
- Migrating via `prisma migrate`/`db push` — broken by pre-existing drift (P3006 shadow replay),
  so the enum value is added by a standalone SQL migration.

## Not verified

- **The enum migration has not been applied to any database** — `ALTER TYPE "CommunicationType"
  ADD VALUE 'viewroom';` must be run on the target DB before `type: 'viewroom'` inserts succeed,
  otherwise the insert fails with "invalid input value for enum".
- No live viewroom join was exercised; no confirmation that a `Contact` is created, the source
  column shows the name, or the COM id now resolves to a shared thread.
- `process_orchestrator` on a "Visitor entered" message — side effects (draft replies, tasks,
  emergency misclassification) not observed. It aborts for anonymous visitors (no `customerId`).
- The profiledb name-persistence quirk (`identity.service.ts` line 170 early-return) was not
  changed; the name is passed raw instead.

## Open decisions

- Whether the full orchestrator should run on a viewroom *visit* event at all. It is a
  message-oriented pipeline (intent → draft reply → tasks/dispatch); a viewroom join is closer to a
  leadbox form submission, which does **not** run `process_orchestrator` — it only runs the
  `UnifiedPipeline` AI summary. I kept the orchestrator call because the user asked for it, but it
  may be worth replacing with `UnifiedPipeline.process` (matching leadbox) or dropping it, to avoid
  drafting a "reply" to a visitor who never messaged us.
