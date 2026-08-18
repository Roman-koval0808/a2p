# 2026-08-10 — Identity tiers, one-person-one-record, COM id sharing

Sessions of 2026-08-07 and 2026-08-10, same thread of work. App: `apps/lead-grabber-v1`.

## Goal

Implement two locked specs:

- `specs/clearsky-identity-tiers-canonical.md` §4.3a — shared lines are Tier 2, never Tier 1
- `specs/clearsky-one-person-one-record.md` — one person, one record

Then a long tail of live-testing fixes, mostly around one customer's data leaking into another's.

## Changed

### Tier assignment (§4.3a)

- **`profiledb/tiers.ts`** — one `tierForIdentifiers()`. Mobile → Tier 1; landline, VoIP, toll-free,
  and *unclassified* → Tier 2; inbound SMS → Tier 1 without a lookup. Seven call sites previously
  decided this locally with `phone ? 'Tier 1' : …`; all now call the one function.
- **`number-lookup.ts`** — Telnyx `data.carrier.type` via `?type=carrier`. **Awaited before the
  tier is assigned** (was fire-and-forget). 1.5s cap enforced by `Promise.race` *and* an abort
  signal — the abort alone does nothing if the transport ignores it, which a test caught.
  Failures are **never cached**: the old code wrote `lineType: 'unknown'` permanently, so one
  Telnyx blip pinned a mobile caller to Tier 2 forever. New `number_lookups` cache table, 180-day
  TTL for portability.
- **`orchestrator.ts`** — §4.3 same-channel enforcement. A Tier 2 voice caller gets no SMS draft.
  Previously the orchestrator contained *zero* references to tier: it was computed, stored and
  displayed, but never gated an action.
- `phone-geo.ts` now delegates to the same cache — was a second, uncached Telnyx call per message.

### Identity keys (§4.4)

- **`utils/phone.ts` `toE164()`** — canonical E.164 for identity keys, distinct from
  `normalizePhoneNumber` (which only strips formatting for dialling, leaving `7052642251` and
  `+17052642251` as different strings). That was the likeliest cause of live duplicate contacts.
- **`profiledb/identity.service.ts`** — hashes canonical E.164, with a legacy-hash fallback that
  rewrites old rows on first touch. Without it the fix would itself have forked every existing
  record.
- **`telnyx/webhook/+server.ts`** — the outbound SMS draft was logged under a `${smsId}_draft`
  fingerprint. The fingerprint *is* the identity anchor, so this minted a throwaway profile per
  SMS which then had to be merged back. Now shares the inbound fingerprint;
  `externalEventId` keeps the suffix for event dedup.

### Merging — point and retire

- **`profiledb/identity.service.ts`** — the merge called `customerProfile.deleteMany` on the
  sources. Now sets `mergedInto`, and `resolveMergedProfile()` follows the trail so retired ids
  still resolve. Score is recomputed from the merged events' `scoreDelta` rather than summing the
  two totals (summing double-counts on overlap).
- **`orchestrator.ts` and `thread-link.ts`** — both contained a `prisma.contact.delete` reached
  from an *AI text match*. This was the source of the `communication_logs_customerId_fkey` and
  `comm_containers_contactId_fkey` violations in the logs. Both replaced with
  `recordMergeCandidate`.
- Schema: `CommIdentifier` gains `companyId` and `@@unique([companyId, kind, value])`; three
  migrations written (`20260806000000-2`). **The unique-index one is deliberately not applied** —
  it is the only migration that deletes rows.

### Commitment resolution

- **`intent-resolution.ts` (new)** — the single writer of `SKIPPED`. Guards live in the UPDATE's
  own `WHERE`, so no caller can bypass them: the row must belong to that profile; a promise cannot
  be closed by the communication that created it; the sweep additionally requires the date to have
  arrived (`requireDue`). Refusals log a stack trace naming the caller.
- Removed the eager resolver and all five call sites (see *Rejected*).

### COM id sharing — four writers, found one at a time

Symptom: two different customers' messages showing one `COM-…`.

1. `orchestrator.ts:1580` — `matchThreadOpenAI` matched on message **text across the whole
   company** and linked threads while explicitly logging *"profiles kept separate"*.
2. `orchestrator.ts:1709` — the CommContainer cross-channel resolver, which falls back to *every*
   open container in the company at `MIN_CONFIDENCE = 0.6` when the incoming identity has none.
3. `thread-link.ts:105` — the semantic `primary` match. Its guard also had a hole:
   `primary.customerId && customerId && …` skipped the check entirely when the incoming row's
   contact was unresolved — exactly the row that must not join a named customer's thread.
4. **`utils/communication-log.ts`** — the real one, and the last found. `logCommunication()`
   accepted a `thread_id` (or `metadata.commId`) from any caller and attached the log to it with
   **no ownership check**. This is the choke point all three channels use.

Also: the tasks board rendered its own COM id four different ways. It now derives it from the
communication log that created the intent (`payload.commLogId`, with `orch_suspense_<logId>` as
fallback), using the identical `commCode()` call the log page uses.

### Incidental

- `settings/company/+page.server.ts` — `console.log('members', members)` with `include: { user: true }`
  wrote **bcrypt hashes and session `tokenKey`s** to `pm2-out.log` on every page load, and shipped
  them to the browser. Removed; now selects only displayed fields. **Affected credentials should be
  rotated.**
- `vite.config.ts` — the OpenAPI generator now runs on `vite dev` only. It rescanned every API
  route on each production build to rewrite three committed files. Build 56s → 44s locally.

## Root causes worth remembering

- **A phone number identifies a line, not a person.** Portability means the number tells you
  nothing; it must be looked up.
- **Sharing a COM id asserts "same person".** Only identity may assert that. Every bug in this
  session was some component asserting it from *topic similarity* instead.
- **A guard in an `if` above the query can be bypassed; a guard in the `WHERE` cannot.** That is
  why `intent-resolution.ts` puts them in the query.

## Rejected

- **Removing the 7-day grace** (`CUSTOMER_ACTOR_GRACE_DAYS`). Asked for, implemented, reverted: it
  broke `ray-scenario.test.ts`, which encodes §3, and the grace window also drives decay
  protection. The real complaint was the *displayed* date; the tasks board now shows
  `calculatedTargetDate` (what the customer said) instead of `dueAt`.
- **Deleting the eager commitment resolver entirely.** Correct per both specs — *"Nothing needs to
  sit there watching"* — but it left nothing to close a promise when the customer actually rang
  back. Reinstated as `resolveOwnCommitments`, strictly profile-scoped.
- **A date-based guard on resolution** (`EARLY_FULFILMENT_DAYS`). Wrong: a customer ringing back
  early *is* keeping their promise. Identity scoping was the right axis, not time.
- **`apps/profiledb`** — mirrored the tier work there, then reverted on instruction. lead-grabber
  has reimplemented that service; `apps/profiledb` is legacy. Its Prisma migrations were moved to
  `apps/lead-grabber-v1/prisma/profiledb/`.

## Not verified

- **No test for the `logCommunication` ownership guard** — Prisma transaction, mocking not done.
  The single most important change tonight rests on reading, not a test.
- Cross-contact linking on **SMS** was never exercised live; only voice→email was.
- The sweep firing at `due_at` (all testing was pre-due).
- The `orch_suspense_<logId>` fallback for COM ids on intents predating `payload.commLogId`.
- Auto-merge on exact typed email match, `resolveMergedProfile`, and the legacy phone-hash healing.
- Existing rows keep their old thread ids and COM codes — these fixes stop new ones, they do not
  repair history.

## Open decisions

- **VoIP → Tier 2** (§4.3a, locked 2026-08-05). Consumer numbers on Google Voice/Bandwidth resolve
  as VoIP, so real customers get no automated reply until a mobile or email is captured. Query the
  `voip` + no-email share of contacts before deciding. Rory's call.
- **§6.3** — the build doc's own open question: should *unrelated* contact suppress a nudge?
  A customer restating a promise on a second channel currently counts as keeping it.
- **Two decision engines.** `PipelineSimulator` and `process_orchestrator` both analyse every
  message and both emit work — the duplicate-task complaint. Consolidating is a product call.
- **Migration `20260806000002`** (unique identifier index) is written but unapplied.

## Baseline at end of session

`28 failed / 476 passed` and `330 typecheck errors` — unchanged from the start. Both were already
failing before this work; they are not a safety net, and getting them green should precede any
refactor.
