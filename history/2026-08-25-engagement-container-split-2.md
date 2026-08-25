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
