# 2026-08-25 — Containers were overwriting the engagement (SMS split, part 2)

## Goal

> "so fixed? what I did was: *Hi there, I am a new customer named elise. I would like an
> appointment for my damaged roof* … then I said *elise here again, need a new appointment for my
> blocked drain*"
>
> "No, I mean before I submitted, and you fixed I did that, can you test using that again"

The user had reported one customer's two SMS messages landing on two different ENG codes. Earlier
in the session I fixed a caller-supplied `thread_id` defect in `logCommunication` and reported it
as fixed on the strength of a synthetic probe. The user asked me to actually replay their two
messages. It was **not** fixed.

## What the replay showed

Replayed both messages through the real webhook (`POST /api/telnyx/webhook`,
`message.received`) against a throwaway number, dev server, real DB, real AI.

Result: **2 engagements**, not 1. The second inbound message and its reply sat on a separate
thread id whose `assignReason` and `rulesVersion` were both null — meaning nothing in
`logCommunication` created it. That id turned out to be a **`CommContainer` id** (`#7825`).

Its `thread_merge` metadata contained the AI's own reasoning:

> "The new message is an exact match to the snippet in commRef #7825: *elise here again, need a
> new appointment for my blocked drain*. This is clearly the same conversation thread…"

The matcher had matched the message against the container holding **only that same message**, and
moved the log there.

## Root causes

Two separate defects, both outside the code I changed earlier.

**1. The self-echo guard was one-sided.**
`resolveContextContainer` drops the container the pipeline pre-creates for the arriving message.
It required *both* "opened at/after the comm log row" *and* "content is this message echoed back".
The time half is wrong per channel: on voice the container opens during the call (after the row),
but on SMS the ProfileDB pipeline opens it on `sms_received` ~20 s **before** `logCommunication`
writes the row. So on SMS the self-container fell on the wrong side of the cutoff, survived, and
was matched as a genuine earlier conversation.

There was already a passing regression test for this guard — its fixture put the container 20 s
*after* the message, which is the voice ordering. The SMS ordering was never covered.

**2. A container was being written into the engagement slot.**
`linkCommunicationLogToContainer` set `communicationThreadId = container.id`.
`communicationThreadId` is the **engagement** — and `communication-surface.ts` renders the ENG code
straight from it (`engCode(log.communicationThreadId)`). A container is one level down: a session,
minted per arriving message (`createContainerAtIntake` *always* creates, never reuses). So every
container link silently demoted an engagement into a session and produced a new ENG code.

This is the "same decision implemented in several places" pattern CLAUDE.md warns about: the
container matcher and the engagement rule are two independent conversation-grouping systems, and
the container one runs last and wins.

## Changed

- `src/lib/server/container/thread-resolver.ts`
  - Self-echo window is now symmetric (`SELF_ECHO_WINDOW_MS`, ±10 min) instead of "opened after".
    The echo test is what identifies a self-container; the window only exists so a customer who
    repeats themselves verbatim weeks later is not treated as an echo.
  - `linkCommunicationLogToContainer` no longer moves a log off a thread the engagement rule
    assigned. It detects one by `rulesVersion` being set (both `intake.ts` and `logCommunication`
    stamp it) and, for those, skips both the thread bridge and the `communicationThreadId` write.
    It still stamps `commContainerId` / `commRef` / `thread_merge`, so the cross-channel COM id
    keeps working — that id lives in metadata, not in the thread field.
- `src/lib/server/orchestrator.ts` — the cross-channel branch now mirrors whatever the link
  actually did (`relinked?.communicationThreadId`) instead of assuming the move happened.
  Without this the later persist writes the container id back over the engagement.
- `src/lib/server/container/thread-resolver.test.ts` — added the missing
  `communicationThread.findUnique` mock, plus two regressions: the SMS ordering (container opened
  *before* the row) and "leaves a thread the engagement rule assigned where it is".

## Verified

- Replayed the user's exact two messages end to end after the fix: **1 contact, 1 engagement,
  1 distinct thread id across all 8 rows** (2 inbound, 2 outbound, 4 bucket-promotion notices).
- `thread-resolver.test.ts` 31/31.
- Full suite **28 failed / 830 passed** — the 28 floor, one better than the 29 seen earlier today
  (that one is flaky, not fixed by this work). `svelte-check` **938 errors / 224 warnings**,
  unchanged.

## Rejected

- **Fixing only the self-echo guard.** Tested by reasoning it through: with the self-container
  gone the matcher would have picked `#7824` (message 1's container) instead — a *different* id
  from the engagement thread the first message's rows are actually on. Still two ENG codes. The
  container-overwrites-engagement defect had to be fixed too.
- **Making the container path reuse an existing container instead of always creating one.**
  `createContainerAtIntake`'s always-create is cited as spec (§1.1.2, "container creation at
  intake, always"). Changing it would be changing a documented behaviour to fix a symptom.
  Keeping containers as sessions and leaving the engagement alone respects both models.
- **Guarding `db.communicationThread.findUnique` with `?.`** to survive the partial test mock —
  that would silently disable the protection wherever a client lacks the method. Added the mock
  instead.

## Not verified

- **Only the SMS path was exercised.** Voice and email also call
  `linkCommunicationLogToContainer` (`orchestrator.ts:897`, `scheduled-intents-handoff.ts:221`,
  `outbound-review.ts:273`, and `resolveAndLinkContext` from four routes). Those now preserve an
  engagement-assigned thread too, but none was replayed live. Worth checking that cross-channel
  COM id sharing (voice + email under one code) still displays correctly, since it now relies on
  `metadata.commRef` rather than a shared thread id for engagement-assigned rows.
- **No backfill.** Elise's original rows, and every earlier split, keep their old thread ids. The
  first replay's rows (`+15556655601`) are still split across two engagements in the DB.
- **The ENG code shown in the UI was not re-checked in the browser** after this change — only the
  database rows.
- Whether `resolveAndLinkContext` (the "universal entry point" for handlers that skip the
  orchestrator) has the same in-memory write-back problem as `orchestrator.ts` did. It calls the
  link function and does not appear to persist `communicationThreadId` itself, but I did not trace
  its callers.
- The two test-number contacts (`+15556655601`, `+15556655777`) are live rows in the company's
  data and were not cleaned up.

## Open decisions

- **Two grouping systems still coexist.** `CommContainer` (AI topic matching, per-message) and the
  engagement rule (identity + window). This change makes the engagement authoritative for
  `communicationThreadId` and leaves the container authoritative for the COM id. That is a
  judgement call about which spec wins, and it should be confirmed: the engagement roadmap is the
  newer document, but the container §1.1.2 behaviour is older and referenced by more tests.
- **Bucket-promotion notices are still generated on every signal.** The Elise replay produced four
  `Visitor "…" entered Active Project bucket!` rows for two real messages, each re-entering the
  orchestrator with `trigger: viewroom_entered` and spending an AI call analysing a system notice.
  They are filtered from the log view but not from the pipeline. Flagged twice now; not addressed.

---

# Part 2 — engagements now expire

## Goal

> "when do engagements expire?" … "please follow the docs and implement if it tells you they should
> expire"

## What the docs say

`ENGAGEMENT-MODEL-PLAN.md` Phase 1 defines the resolution ladder and, in its acceptance list:

> Same contact returns after the window → **new T2**.

It also defines active as `CommunicationThread.status != 'closed'` and says that needs no migration.
Both statements are in the doc; only the first was achievable, because **nothing in the codebase
ever sets a thread to `closed`** — verified by grepping every `communicationThread.update` /
`updateMany` / raw-SQL writer (the only status write, `confirm/+server.ts:372`, sets it back to
`open`), and by the database: zero closed threads. The two `status: 'closed'` writes in `src/` are
both on `Transaction`.

So rule 2 matched any thread of the contact regardless of age, rule 3's inactivity window was
unreachable, and engagements never ended. Note the pre-existing fallthrough reason was already
called `no_open_thread_or_window_lapsed` — the intent was there, the path was not.

The doc is not LOCKED and thread expiry is not in its "Blocked on a human" list, so this was
implemented rather than raised.

## Changed

- `src/lib/server/telemetry/engagement.ts` — rule 2 now requires the open thread to be **within its
  inactivity window** (longest among its subtopics) as well as not closed. When it has lapsed the
  resolution falls through to rule 3/4 and returns `closeThreadId` naming the stale thread.
- `src/lib/server/telemetry/intake.ts` and `src/lib/utils/communication-log.ts` — both writers act
  on `closeThreadId` by setting `status: 'closed'`. **Point-and-retire, never delete**: the log rows
  stay attached and the old engagement keeps its ENG code, it simply stops attracting new
  interactions. This also makes the stored data satisfy the doc's own `status != 'closed'`
  definition going forward.
- `src/lib/server/telemetry/engagement.test.ts` — four cases: an open thread lapsing past its
  window, a renovation (180 d) surviving well past a repair window, an emergency lapsing after
  7 days, and "no thread at all" not asking to retire anything.

Windows are unchanged (they were already correct): emergency 7 d; drain/plumbing/repair/water
heater/furnace/HVAC/electrical/support 30 d; billing 60 d; quote 90 d; renovations 180 d; default
30 d; longest-wins across an engagement's subtopics.

## Verified

- `scripts/verify-engagement-model.mjs` against the running dev server and real DB: **16 passed,
  0 failed**, including "a return after the window opens a NEW engagement".
- That check was **proved failing beforehand**, not assumed: rule 2 was temporarily reverted in
  place, the script re-run (`FAIL … vt_vfy… vs vt_vfy…` — same thread id both sides), then the fix
  restored and re-run to 16/16.
- Retirement confirmed in the database: 2 threads now `closed`, each still holding its 3 log rows.
- Suite **28 failed / 834 passed** (the 28 floor; +4 new tests). `svelte-check` **938 / 224**,
  unchanged.

## Rejected

- **A scheduled sweep that closes threads on inactivity.** It would satisfy the doc's literal
  definition, but makes the boundary depend on when the cron last ran, needs new infrastructure, and
  risks mass-closing threads on first run. Deciding at resolution time is stateless and exact; the
  status write then follows the decision instead of driving it.
- **Leaving `status != 'closed'` as the sole test and adding a closer elsewhere.** Same problem —
  correctness would depend on the closer having run.

## Not verified

- **No backfill.** Threads already dormant past their window stay `open` until the contact's next
  interaction, which is when they are retired. Nothing sweeps historical data.
- Only the telemetry path was exercised end to end. `logCommunication` has the identical retirement
  block and is covered by the unit tests, but no live SMS/voice/email replay crossed a window
  boundary (that needs an aged fixture on a contact, which the acceptance script only builds on the
  telemetry side).
- The UI was not checked for how a closed engagement renders — whether a retired ENG code is
  visually distinguishable from an active one is unknown.
- Whether 30/90/180 days are the right numbers is a product question; they were already in the code
  and were not revisited.

## Also observed — data loss, cause unknown

Between 22:03 and 23:10 today, **all Total Trade Solutions (`cmkwntxej…`) contacts, communication
logs and threads were deleted.** The table went from many rows to 3 contacts / 2 logs / 1 thread,
all belonging to Reco Company, whose 2,883 `CommContainer` rows are untouched.

The selective, single-company pattern matches `POST /api/company/wipe-data` (which deletes exactly
contacts, logs, threads, messages, notifications, containers and pipeline profiles, `where:
{ companyId }`). It was not the test suite — `wipe-data.test.ts` is fully mocked — and not the SMS
replays, which only wrote rows. **I do not know who or what triggered it.** Worth checking whether
that endpoint is reachable without a deliberate confirmation step.

The Part 1 fix had already been verified against the database before this happened, but those
evidence rows are gone.
