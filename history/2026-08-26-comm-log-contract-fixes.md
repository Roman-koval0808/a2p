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

---

## Simulator parity (2026-08-26)

> "so make the log take data like this and display them similar to this —
> `/Users/n3rd/code/fullsaasclearsky/design/a2p-simulator.html`"

Compared the simulator's row and drawer against ours. Four differences; three implemented, one
deliberately not.

### 1. The dot now encodes INTENT

The simulator colours it red = emergency, teal = active, blue = research/comparison, grey = n/a.
Ours encoded **direction** — inbound green, outbound red — which made every outbound message look
like a problem and repeated what the IN/OUT badge already said. Intent is the fact worth scanning a
column of dots for. (`statusDotClass` now takes the row.)

### 2. Returning-visitor lines — the biggest gap

The simulator says, in the Profile cell:

```
↩ Returning · 3rd session
continuing ENG-0002                     (or "new engagement ENG-0003")

↩ Likely returning · 2nd session · device match      (Tier 2B)
```

Ours could not say any of it. Added `loadReturnHistory()` — **one query per page**, not per row —
which walks that contact's rows oldest-first and produces a session ordinal per log and the first
log on each thread. `returnInfo` on the surface then carries `{returning, ordinal,
startedEngagement, deviceMatchOnly}`.

Two details worth keeping: sessions are counted by `sessionRef`, not by row, so several rows in one
visit do not read as several returns; and a Tier 2B match is only ever "**Likely** returning ·
device match", because a fingerprint is a device and not a person.

### 3. "How the engine derived this" in the drawer

The simulator's most useful panel: History, Channel + direction, Source (sets the prior), Message
read by AI, Intent verdict, Subject, Tier, Engagement, Score. Added to the Session Summary drawer,
each line read from data already on the row — a step with nothing behind it is dropped rather than
padded with a dash.

### 4. NOT done — the name in the "Who" line

The simulator renders `who = tier 1 or 2 ? profile.name : "Anonymous"`. The 31-row reference log
renders the identity-TIER descriptor there instead ("Identified — name + email/phone"), and the
user explicitly asked for the name to be reverted earlier the same day. The two source documents
disagree; the reference and the user's instruction agree with each other, so the descriptor stays.
**Flagged rather than changed.**

### Score before → after

The simulator shows `score 21 → 38`. Ours already shows `score 21` in the Journey detail from
`meta.scoreLive`, but **no before/after is stored anywhere** — `scoreDelta` is computed in
`orchestrator.ts:646` and `profiledb/telemetry.ts` and never persisted per row. Showing an arrow
would mean inventing one of the two numbers, so it was left alone. Adding it is a small storage
change if wanted.

### Verified

`svelte-check` **938 / 224**, unchanged. Suite **28 failed / 853 passed of 881** — the band.

### Not verified

- **Nothing rendered in a browser.** All three additions are template + loader changes checked only
  by `svelte-check`.
- `loadReturnHistory` fetches every log row for the contacts on the page. That is fine for a page of
  50 and unmeasured for a contact with thousands of rows; no limit or window is applied.
- The ordinal counts rows across all channels for a contact, which matches the simulator's model but
  was not checked against the spec's session definition for the voice/SMS case.
- The profile page inherits all of this through the shared table without its own mapping; not
  looked at.

---

## Returning-session ordinals were wrong (2026-08-26)

> "look at the returning sessions, some dont add up, and the counts too"

The reported sequence for one profile read **1st (no line) → 3rd → 5th → no line → 6th**: two
numbers missing, and a row in the middle of the run showing as a first touch.

### Two causes, both in `loadReturnHistory`

**1. It counted rows the log never displays.** The internal notices
(`Visitor "…" entered Active Project bucket!`) were counted as sessions. They are system writes, not
visits — the spec's session is "one continuous visit, call or active exchange" — so the visible
ordinals jumped over numbers belonging to rows nobody can see. Three notices in that profile's
history account for exactly the missing 2nd and 4th.

**2. It filtered on `customerId` alone.** A row attached to the engagement but with no customer FK —
the dial-ladder legs written by `emergency-dial.ts` are the common case — was absent from the map,
fell to the `?? 1` default, and rendered as a FIRST touch mid-run. The query now also matches
`communicationThread.contactId`, and the effective contact falls back to the engagement's.

A third, smaller fix: `returnInfo()` no longer defaults a missing entry to ordinal 1. It returns
null, so a row that was not counted claims nothing instead of claiming to be the first.

`firstLogByThread` still considers every row, notices included — the question it answers is "did
this row open the engagement", and a notice can legitimately be the opener.

### Verified against the live data

The same profile that produced the report (7 rows, 3 notices, one dial-ladder leg with no customer
FK) now reads:

```
13:01:33 voice/inbound  ord=1   I need help replacing my furnace.
13:02:56 voice/inbound  [notice]
13:05:14 voice/inbound  ord=2   I also need someone to clear a blocked drain.
13:05:59 voice/inbound  [notice]
13:09:37 voice/inbound  ord=3   My pipe burst and water is flooding...
13:10:00 voice/outbound ord=4   System is automatically dialing tech...   (noFK — was missing)
13:10:04 voice/outbound ord=5   Outbound call not answered (45s ring)
13:10:29 voice/inbound  [notice]
```

Consecutive, no gaps, dial-ladder leg included.

`svelte-check` **938 / 224**. Suite **28–30 failed of 881** across runs — the band.

### Not verified

- **Not viewed in a browser**; the ordinals were checked by reproducing the computation against the
  database, not by reloading the page.
- Only one profile was checked. The SMS profile in the report (`PRF-B8LR2`, 2nd → 4th) was not
  re-examined; its gap has the same shape and the same cause is assumed, not confirmed.
- `isInternalNotice` now runs over every historical row for the contacts on a page, so the query
  selects `content` and `metadata` too. Heavier than before, still one query, unmeasured on a large
  contact.

---

## One SMS was producing three "sessions" (2026-08-26)

> "see a single sms with a dial ladder, see how the sessions worked"

A customer sent **one** inbound SMS. The log showed:

```
3:00 SMS IN            (first touch)
3:01 Dial ladder rung 1   ↩ Returning · 2nd session
3:01 Outbound Call        ↩ Returning · 3rd session
```

The customer had made contact exactly once. The other two rows were **us**: the dial ladder ringing
a technician, and the result of that call. Neither is the customer returning.

### Two corrections

**1. Staff-directed legs are not the customer's sessions.** New `isStaffDirected(log)` — a row is
the business talking to itself when it carries `workOrder`/`tech_name` (the dial-ladder rungs) or
`recipients` / `is_emergency_dispatch` / `is_escalation` (dispatch and its escalations). Confirmed
against the real row: `meta = { rung, commId, tech_name: 'Rory', workOrder: true }`, destination
`+19058499843` — a technician, not the customer. These belong in the log, but not in the count.

**2. "↩ Returning" is a claim about the CUSTOMER coming back.** An outbound leg is us reaching out,
so it now carries its session ordinal (the drawer still reports it) but never renders the returning
line. Only an inbound row past the first can say "Returning".

### Verified against the live data

The same thread that produced the report:

```
14:00:25 sms/inbound    [notice]
14:00:33 sms/inbound    ord=1        My pipe burst and water is flooding...
14:00:44 sms/inbound    [notice]
14:01:18 voice/outbound [staff leg]  System is automatically dialing tech...
14:01:21 voice/outbound [staff leg]  Outbound call not answered (44s ring)

customer sessions: 1 of 5 rows
```

One inbound SMS → one session, no false "Returning". Previously three.

### Also fixed — a failing test from the audit session

While re-baselining, `subtopic-labels.test.ts > describes furnace replacement instead of the generic
equipment label` was failing: `formatDescriptiveIntent` returned `Furnace · Sales Opportunity`
instead of `Furnace Replacement`. The rule was there but its regex read
`/replace|replacement|install|new furnace/`, and the natural phrasing — "I need help **replacing** my
furnace" — does not contain "replace". Changed to `/replac|install|new furnace/`. The test had been
written before the regex and had never passed.

### Verified

`svelte-check` **938 / 224**. Suite **27–28 failed of 881**, run from `apps/lead-grabber-v1`.

**A measurement error is worth recording**: several counts earlier in this session (23/607, 31/850)
were taken with the shell in the REPO ROOT, where `$lib` does not resolve and whole suites fail to
import — exactly what CLAUDE.md warns about. Those numbers were meaningless. Only counts taken from
`apps/lead-grabber-v1` should be compared.

### Not verified

- **Not viewed in a browser** — reproduced by running the same computation against the database.
- `isStaffDirected` keys on five metadata flags. Any other writer that rings staff without setting
  one of them would still be counted; the writers were not audited exhaustively.
- Outbound rows keep an ordinal that no longer appears anywhere in the table (only in the drawer's
  derivation panel). Harmless, but it means the ordinal and the visible "Nth session" can differ for
  outbound rows.
