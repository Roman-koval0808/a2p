# Communication log contract fixes

## Goal

Implement the documented Communication Log and Engagement model corrections, especially the single
emergency bucket, source-aware attribution, session boundaries, engagement references, duplicate
audit behavior, and scenario enum/resource mismatches.

## Changed

- `communication-surface.ts` and `CommunicationTable.svelte`: emergency now renders as the override
  bucket instead of as `active` plus a second emergency label; expanded the intent status vocabulary.
- `attribution.ts`: paid search/social classification now requires paid evidence, preventing Bing
  organic traffic from becoming `bing_paid`; added regression tests.
- `telemetry/intake.ts`: browser session IDs now respect the inactivity boundary; explicit engagement
  and reference fields are accepted, looked up against prior log metadata, and retained in metadata.
- `container-service.ts` and `thread-resolver.ts`: suppression and candidate lookup now include
  contact identity and reject stale candidates using a bounded window.
- `unified-pipeline.ts`: duplicate communication entries remain auditable and are marked suppressed
  with the reason and similarity score.
- `timer-service.ts`: inactivity timer firing now closes the container.
- `s1-meeting-confirm.ts` and `s4-sms-booking.ts`: removed an unsupported input and replaced the
  unsupported call approval type with an internal follow-up task; accepted legacy resource names.
- `call-webhook/+server.ts`: phone logs now seed subtopics from tracking categories and resolve the
  recorded transcript into a controlled subtopic, including patching a hangup-created row.
- `subtopic-classifier.ts`: added deterministic transcript seeds before the optional AI step, so
  explicit furnace/drain language cannot result in a blank subtopic when AI is unavailable.
- Tests were updated for the emergency override and explicit-reference behavior.

## Root causes

- The presentation layer still implemented the superseded two-axis emergency model even though the
  authoritative 2026-08-26 ruling made emergency the fourth buying bucket.
- Attribution used source names alone as paid evidence, making organic Bing unreachable.
- A provided browser session ID was treated as permanent instead of being bounded by inactivity.
- Intake created an auditable entry before duplicate classification but never marked that entry as
  suppressed.
- Container candidate queries did not consistently scope by all known identity types or age.

## Rejected

- No database migration was added. The required emergency/subtopic fields already exist, and the
  remaining fixes fit existing metadata and lifecycle fields.
- The separate container resolver was not deleted in this session because it serves a distinct
  COM/container compatibility path and requires a broader migration of all channel writers.
- The timer failure retry policy and full live emergency bridge were not guessed at; both need an
  explicit operational policy and provider integration test before changing production behavior.

## Not verified

- The full Vitest suite remains red: baseline was `842 passed, 29 failed, 4 skipped`; post-change
  execution was `848 passed, 30 failed, 4 skipped`. A later targeted run passed 79 tests. Failures are primarily existing mocked Prisma,
  Telnyx, datetime, orchestrator, and unavailable-database tests.
- `svelte-check` remains red with 937 errors and 224 warnings after the change. These are pre-existing
  application-wide type and Svelte migration errors; no changed-file-specific error was isolated.
- No live database migration or production webhook was exercised.
- Explicit project/quote/case/work-order lookup was not tested against a live Prisma JSON path.
- Manual Telnyx calls were not replayed in this workspace after the deterministic transcript change.
- Atomic SQL subtopic score updates, full 31-provider registry coverage, and real emergency bridge
  execution remain unfinished.

## Open decisions

- Reconcile the stale Fieldbook mapping that still says emergency is a separate flag with the current
  authoritative single-bucket model.
- Decide whether engagement subtopic rollups remain string keys or become engagement-local keyed
  records with ordinals.
- Define the canonical resolver boundary between `CommunicationThread` engagements and
  `CommContainer` conversation records.
- Define timer failure escalation/retry semantics and the provider-level emergency bridge contract.

---

## Continuation (2026-08-26, later session)

Picked up from `communication-log-model-code-audit-fixes.json`, which ended mid-task: the user had
reported "same exact thing" — voice calls still logging with a blank Subtopic — and then asked to
run the `/test` simulations. The session stopped before running them.

### Why the earlier fix appeared not to work

It did work, in the wrong place. The audit session wired the subtopic ladder into
`api/telnyx/call-webhook/+server.ts` (6 sites). **The user was testing from `/test`**, which writes
its own `CommunicationLog` row directly and set no `subtopic` at all — so every simulated call
landed blank no matter what the production path did.

This is the same trap recorded earlier in `2026-08-25-engagement-container-split-2.md` Part 3:
`/test` had its own writers and never exercised production behaviour.

### Second gap — nothing rolled the subtopic onto the ENGAGEMENT

`CommunicationLog.subtopic` was being set, but `CommunicationThread.subtopics` was only ever
updated by `logCommunication` and `intake.ts`. Both voice writers skipped it, so
`tests.md` scenario 3's expectation — "Engagement subtopics include `furnace` and `drain`" — could
not pass even once the row-level field was correct.

### Changed

- `telemetry/resolve-engagement.ts` — new `rollUpSubtopic(db, threadId, subtopic)`: idempotent,
  never throws (a rollup failure must not lose the call). One implementation, since this decision
  now has four writers.
- `routes/(app)/test/+page.server.ts` — the voice simulation resolves a subtopic through the same
  ladder as the webhook, writes it to the row, rolls it onto the engagement, and reports it in the
  on-screen log (`🏷️ Subtopic: …`).
- `api/telnyx/call-webhook/+server.ts` — rolls up at both recording sites.
- `utils/communication-log.ts` — its inline rollup replaced by the shared helper.

### Verified

- Scenario 3's two transcripts through the real ladder:
  `"I need help replacing my furnace."` → **furnace**, and
  `"I also need someone to clear a blocked drain."` → **drain**, both `deterministic` — i.e. the
  transcript seeds the audit session added resolve them without an AI call.
- `svelte-check` **938 / 224** (a +1 regression was introduced and fixed: `commThread` is not in
  scope on the hangup-update branch, so the rollup there uses the log's own thread id).
- Suite **28 failed / 853 passed of 881** — the audit session's new tests are included and the
  4 previous skips now run.

### Not verified

- **The `/test` simulations were still not run end to end.** The route requires an authenticated
  session (`locals.user`) and the only non-interactive route in is a Bearer token from
  `POST /api/auth/login`, which needs credentials. The classifier and the wiring are proven
  separately; the button has not been pressed.
- No live Telnyx call, so neither webhook rollup site has executed.
- Scenario 3's other expectations (same Profile ID, same Engagement ID, two Session IDs) are
  untested for the voice path in this session.
