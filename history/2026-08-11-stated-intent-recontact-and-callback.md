# 2026-08-11 — Stated intent, part 2: what happens when he gets back

Issue 5, both scenarios. App: `apps/lead-grabber-v1`. Follows
[2026-08-10](2026-08-10-identity-tiers-comm-ids.md).

## Goal

Joe rings about a furnace and says he's away a fortnight.

- **Scenario A** — *"I'll get in touch."* He owns the next move.
- **Scenario B** — *"Call me when I'm back."* We own it.

Both were half-built: the promise was recorded, and then nothing useful happened with it.

## Changed

### The doc first

`specs/clearsky-recontact-and-callback.md` — written before any code, as Part 2 of
`clearsky-stated-intent-followup.md`, because the two scenarios turned out to be its §3a modes A
and B. Five open questions are recorded as **Rory's**, not guessed.

### Scenario A — why did he get back in touch

- **`recontact-analysis.ts` (new)** — compares the new message against the ORIGINAL promise:
  related · appointment/callback/information · when · conditions · lost interest · postponed. The
  generic per-message extraction cannot answer "is this about the call he made a fortnight ago"
  because it never sees that call.
- `outcomeFor()` gives one outcome per closure, with precedence that matters: lost interest beats
  postponement beats "wants nothing", and **no reading at all still surfaces to a human**.
- **The reason is written onto the promise**, not into a new task (user's call). The board shows
  "Skipped because …" beneath the original — one row telling the whole story.
- **Postponement writes a NEW commitment.** Without it, closing the old row drops the customer out
  of the pipeline silently. This is the branch most likely to be missed.

### Scenario B — the daily callback

- **`callback-attempts.ts` (new)** — ring on the date, then daily until we actually speak to them.
  A queue of dated attempts, not a watcher.
  - **An answering machine is not contact**: under `MIN_CONNECT_SECONDS` doesn't count, and
    Telnyx machine-detection overrides duration entirely.
  - Them ringing us also discharges it.
  - **It stops** after `MAX_ATTEMPTS` and hands to a human with the history.
  - `canAutoDial` (§3.5) — a shared line with no mobile or email is **never** auto-dialled. That is
    a task for a person; you cannot ring an office and ask for someone you never identified.

### Two bugs that made scenario B unreachable

1. **`actor` was hardcoded to `'CUSTOMER'`** at the scheduled-intent write. Mode B could never be
   created — a customer who asked us to ring got a row that waited for HIM to ring.
2. Fixing that exposed the real one: the whole write sits inside `if (nextActionPlan.suspense)`,
   and **suspense only exists when the next move belongs to the customer.** Once `wants_callback`
   flipped the owner to *business*, the block was skipped and **no row was created at all** —
   worse than the wrong row. Added a sibling `else if` branch that records the obligation with
   `actor: BUSINESS` (→ `CUSTOMER_COMMITMENT_B`, and `writeScheduledIntent` adds no grace for that
   actor), under its own `orch_callback_` idempotency key so the two modes cannot collide.
   The date comes from `callback_when` — the mode-B field — through the existing
   `resolveCalculatedTargetDate`, **not** from a new parser and not from a default interval: if his
   words cannot be dated we write nothing and say so, because ringing on a day he never named is
   worse than leaving the already-drafted callback task for a person. Scenario A's suspense branch
   is untouched.

### "two weeks" is not a date, apparently

Joe's live call at 19:10 produced `callback_when: "when I'm back (in two weeks)"` and then
`could not be dated — leaving it to the drafted task`. `daysFromRawTimeframe`'s phrase table has
*"a couple of weeks"* but not *"two weeks"*, and its numeric fallback regex only matched **digits**.
People say "two weeks" far more often than "2 weeks", so a real callback obligation was silently
not written. The fallback now accepts one–twelve spelled out. It runs after the phrase table, so
longest-match precedence ("a couple of weeks" ≠ "a week") is unchanged, and mode A's phrases already
resolved — this only turns nulls into dates. Four tests added.

### Also

- COM id: the callback is linked into the original conversation's container (§2.2), so one thread
  carries one COM id; `metadata.originalCommRef` gives the rep a quotable reference.
- Task board: shows the customer's name rather than a cuid; the reason renders under the promise.

## Root causes worth remembering

- **Dates from a model are not dates.** It returned `"middle of September"`, `new Date()` made that
  `Invalid Date`, Prisma rejected the row and the re-scheduled commitment was lost. Everything is
  `Date.parse`-validated now and the phrase is kept separately.
- **A gate written for one mode silently disables the other.** Both mode-B bugs were the same
  shape: code that only ever ran for mode A.

## Rejected

- **Closing a promise on ANY inbound contact.** Joe rang about a leaking tap; his furnace promise
  closed. Now only a message about THAT promise resolves it (`relatedToOriginal`). This answers
  §6.1, which the doc had left open — **it should go back to Rory as a decision made.**
- **A date guard on resolution** (`EARLY_FULFILMENT_DAYS`, added and removed the same session). A
  customer ringing back early IS keeping their promise. Identity was the right axis, not time.
- **Spawning a rep task per closure** — replaced by the reason on the row, at the user's request.

## Not verified

- **Mode B end to end.** The row now gets written; the daily loop, the voicemail threshold and the
  give-up path have unit tests but have never run against real calls.
- **`MAX_ATTEMPTS = 5` and `MIN_CONNECT_SECONDS = 20` are my proposals**, marked ⚠️ in the file.
  Both are open with Rory (§6.2, §6.3).
- The AI returning a real ISO date for a postponement — it returned a phrase on the one run we saw.
- Scenario A tests 1, 2, 3 and 5 confirmed in production by the user. Test 4 (postpone) confirmed
  only as far as the crash being fixed.
- **If the AI cannot read the message, the promise closes.** Deliberate — chasing someone who
  demonstrably has been in touch is the worse failure — but it is the opposite bias from the rest
  of this work, where uncertainty means don't act.

## Open decisions

- §6.2 attempts before handing over · §6.3 what counts as reaching them · §6.4 attempts per day
  and which hours · §6.5 a limit on repeated postponements.
- **VoIP → Tier 2** still unresolved from 2026-08-10, and it now also blocks auto-dialling: a VoIP
  caller with no email cannot be rung automatically at all.
- **Two decision engines.** `PipelineSimulator` and `process_orchestrator` gave *different* answers
  on one sentence — the pipeline said `emergency: true` for a leaking tap, the orchestrator said
  urgent-but-not-emergency. Same input, two verdicts. Consolidation is a product call.
- **Timer double-firing** (`Promise not kept for container #… — follow-up task created.` twice, with
  a `providerEventId` unique-constraint failure alongside a "Deduplication PASS"). Not investigated;
  it runs a full pipeline pass with AI calls on each fire, so it costs money.

## Baseline at end of session

`28 failed / 502 passed` (530 total — 4 new), `330 typecheck errors`. Unchanged from the start of
the session and from 2026-08-10; both predate this work.

**The failure count is not stable.** Consecutive runs of the same tree gave 28, 29 and 33. The set
of failing *files* is constant (8), and the variation is inside suites that call the live Anthropic
API with an invalid key. I chased a "29" as a regression before noticing. Compare the failing file
list, not the number.
