# 2026-08-11 (2) — Scenario 2 rebuilt: Joe and the daily callback

## Goal

The scenario, in the user's words:

> Joe calls Total Trades on Aug 01st and says he would like to get a price on a new furnace, He
> also says I will be away for two weeks, and he wants Total Trades to call him when he gets back
> [...] Starting on Aug 13th each day we sweep all of the tasks that have been scheduled. So on Aug
> 13th we reach to him, if no answer, we try again on Aug 14th, we keep trying until we make
> contact. We need to recognize that reaching an answering service is not reaching him. Once we
> reach him we remove the condition that we need to call each day [...] Because this is a task set
> that is asking for a form of communication we should be able to tag the communication with the
> right comm id.

Follows [2026-08-11-revert-scenario-2.md](2026-08-11-revert-scenario-2.md), which reverted the
first attempt at this without ever diagnosing what was wrong with it. Second instruction, on being
shown a plan: *"just follow our text."*

## Root causes

Four separate mechanisms, only the first of which the reverted work had even tried to address.

### 1. Joe's sentence has two clauses and the schema has a field for one

This is the one that made mode B look built and do nothing.

`message-intent.ts` gives mode B a single timing field, `callback_when`. Joe's request and Joe's
date are in different clauses:

| Joe's clause | Field | Datable? |
|---|---|---|
| "call me when I get back" | `callback_when: "when I get back"` | **no** |
| "I'll be away for two weeks" | *no field at all* | would be 14d |

The reverted branch read `callback_when`, failed to date it, logged `could not be dated`, and
dropped the obligation. That log line is recorded in the previous entry as *"observed but never
tied to a failure"* — it was the failure.

Fixed with `resolveReturnWindow` in `ai/scheduled-intent-parser.ts`: pull the away-window straight
out of the customer's own text and date from that when `callback_when` will not resolve.
Deliberately narrow — it matches a stated absence ("away/gone/out of town for N", "back in N") and
nothing else, because a duration mentioned in passing ("making a noise for two weeks") is not a
return date.

### 2. "two weeks" resolved to 7 days

`daysFromRawTimeframe` runs the shared `TIMEFRAME_PATTERNS` table on longest-match, and
`\b(a )?week\b` matches inside "two weeks" → 7. The table's answer was returned *before* the
number-and-unit branch was ever reached.

Commit `20e0437`, reverted, restored spelled-out numbers as a *fallback* after the table — which
would not have fixed this. It would have moved "away for two weeks" from *undatable* to *one week*,
i.e. from no call to ringing Joe on 8 Aug while he was still away. Worse, and silent. The
number-and-unit match now competes on match length with the table.

### 3. The gate that skipped every mode-B row before the loop could run

`verifyDueIntent` check 1 skips a row when the customer has been in touch since it was written.
Correct for mode A — *he said he'd ring, he rang, done*. Wrong for mode B: Joe replying "thanks" to
the approved thank-you SMS discharges nothing, we still owe him the call. And the reverted mode-B
branch sat **after** this gate, so the rows were skipped before the daily calling could touch them.
Any scenario-B customer polite enough to reply cancelled their own callback.

Check 1 is now conditional on `actor !== 'BUSINESS'`. Checks 2–4 (booked / job moved on / opted
out) still apply to both: if he booked, there is nothing left to ring about. What discharges a
mode-B promise is a conversation, which is `haveWeReachedThem`'s job.

### 4. The drafts had no comm id

`handoffDueIntent` wrote its `pending_approval` draft as a free-standing log. Joe's 1 Aug call and
each daily attempt showed the rep a different code for one exchange, and a chain of attempts minted
a fresh one every morning. Now linked through `linkCommunicationLogToContainer` — the existing
canonical linker, not a fourth implementation — re-reading the container under both `companyId`
**and** `contactId` so a payload naming another customer's thread cannot be honoured.

## Changed

- **`ai/scheduled-intent-parser.ts`** — `resolveReturnWindow` (new, exported); length-competing
  number-and-unit match in `daysFromRawTimeframe`; `fortnight`.
- **`orchestrator.ts`** — the mode-B `else if` branch, restored and rewritten. It reads three
  sources for "when" in order (`callback_when` → return window → mode-A fields) and quotes his own
  phrase in `rawTimeframe`. This branch is the *only* path that creates a scenario-B row:
  `resolveNextActionOwner` returns `'customer'` only when `customer_will_initiate && !wants_callback`,
  so asking to be rung makes the owner `'business'`, `nextActionPlan.suspense` is never set, and the
  suspense block above is skipped entirely.
- **`callback-attempts.ts`** — restored. `haveWeReachedThem` (machine-detection flags checked
  *before* duration, so a long message left on a machine can never read as a conversation),
  `decideNextAttempt`, `canAutoDial` (unchanged from the reverted version — §3.5 was already
  right), and a new attempt trail: `readTrail` / `describeTrail`.
- **`scheduled-intents-sweep.ts`** — `runCallbackAttempt`; actor-aware check 1; expiry of a
  `BUSINESS` row reported as a SERVICE FAILURE with the attempt history; `reached` and
  `failedPromises` counters.
- **`scheduled-intents-handoff.ts`** — the COM id link.
- **`tests/joe-scenario.test.ts`** — new, 20 tests, the story walked day by day.

## Deliberate departures from spec

- **No attempt cap.** `clearsky-recontact-and-callback.md` §3.3 stops after N attempts and hands to
  a human; §6.2 (*the value of N*) was never answered by Rory. The instruction here is explicit —
  *"we keep trying until we make contact"* — so the text won. The bound is the promise's own
  `expiresAt` (7 days for mode B), and hitting it is reported as a broken promise, not as a loop
  running out of patience. **This needs Rory's sign-off or §3.3 needs amending.**
- **`MIN_CONNECT_SECONDS = 20` is still a guess.** §6.3 is open. It is a named constant with a
  warning comment, as before.
- **A non-voice reply does not discharge a mode-B promise.** Joe texting "I'm back" leaves the
  daily calling running until we actually speak. Defensible (§3.1 says *"until we actually speak to
  him"*) but it is a judgement I made, not one the text settles.

## Rejected

- **Re-landing the five reverted commits as-is.** Root causes 1–4 are all still present in that
  code; it would have reproduced the same silent nothing.
- **`b64dfc4`, the "BUSINESS actor fix".** It changed `actor: 'CUSTOMER'` to
  `aiIntent?.wants_callback ? 'BUSINESS' : 'CUSTOMER'` **inside the suspense block** — which only
  runs when `wants_callback` is false. Dead code. The hardcoded `'CUSTOMER'` at
  `orchestrator.ts:2481` is correct where it stands and was left alone.
- **Adding `fortnight` / spelled-out numbers to `TIMEFRAME_PATTERNS` in `next-action.ts`.** Shared
  with the suspense-date path that scenario 1 uses and that was confirmed working in production;
  changing mode-A dates to fix a mode-B bug is the trap CLAUDE.md warns about. Handled inside the
  parser instead.
- **Fixing the apparent double-grace in mode A.** `orchestrator.ts:2488` passes
  `nextActionPlan.suspense.dueAt` (already timeframe + grace) as `calculatedTargetDate`, and
  `writeScheduledIntent` then adds `CUSTOMER_ACTOR_GRACE_DAYS` again. That looks like 14 days of
  grace, not 7. **Not touched** — mode A is the confirmed-working path and this is a dated
  behaviour change. Flagged below.

## Not verified

- **Nothing has run against a real database or in production.** All 20 new tests mock Prisma at the
  client level. The sweep has not been run against Neon, and the VPS still runs the pre-revert
  build.
- **No real call was placed.** `haveWeReachedThem` reads `duration` and `metadata.machine_detection`
  / `answered_by` off `CommunicationLog`. **I did not confirm that the Telnyx voice path actually
  writes those fields**, or under those key names. If it doesn't, every attempt reads as
  not-reached and the loop runs until expiry. This is the single most likely thing to be wrong.
- **`resolveReturnWindow` was never run against real model output** — only against Joe's sentence as
  the user wrote it. Whether `callback_when` comes back as "when I get back" or as something the
  model has already half-resolved is unknown.
- **The COM id link is verified only through mocks.** `commContainer.findFirst` and
  `communicationThread.upsert` were asserted as called with the right arguments; no container was
  actually linked.
- **The thank-you SMS/email and Crispin's approval were not touched.** The previous entry lists
  that lane as already working; I did not re-test it, and the "no mobile and no email → send
  nothing" rule was exercised only through `canAutoDial`, not through the send path.
- **The double-grace suspicion in mode A** (see Rejected) is unconfirmed — I read it, did not test
  it, and did not change it.

## Baseline

| | Before | After |
|---|---|---|
| vitest | 28 failed / 489 passed (517), 8 files | 28 failed / **509** passed (537), **same 8 files** |
| svelte-check | ~330 errors | 330 errors, none in the touched files |

Baseline unchanged. The 20 new passing tests are `joe-scenario.test.ts`. `ray-scenario.test.ts`
(scenario 1) still passes — checked explicitly, since check 1 of `verifyDueIntent` is shared.

## Open decisions

| # | Question | Who |
|---|---|---|
| §6.2 | Attempt cap — the build now has none, contradicting §3.3 | **Rory** |
| §6.3 | What counts as reaching him; `MIN_CONNECT_SECONDS = 20` is a guess | **Rory** |
| §6.4 | One attempt a day, and at what hour? Currently "same time tomorrow" | **Open** |
| §6.1 | Does *unrelated* contact close a commitment? Untouched here | **Rory** |
| — | Does a non-voice reply discharge a mode-B promise? Currently no | **Rory** |
| — | Mode-A double grace at `orchestrator.ts:2488` — real, or intended? | **Rory** |
