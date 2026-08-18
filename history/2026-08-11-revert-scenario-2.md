# 2026-08-11 — Reverting scenario 2 (the callback loop)

## Goal

> "please just revert to before we started scenario 2, lots of things are broken"

Undo the mode-B / callback work, keep scenario 1 (recontact analysis), which had been confirmed
working in production earlier the same day.

## Changed

Reverted five commits with `git revert --no-commit`, landing exactly on `1e99617`:

| Commit | What it was |
|---|---|
| `f16e761` | `callback-attempts.ts` + sweep wiring + orchestrator hunk |
| `b64dfc4` | `actor` no longer hardcoded to CUSTOMER |
| `fb97752` | the mode-B `else if` branch in the orchestrator |
| `20e0437` | spelled-out numbers in `daysFromRawTimeframe` |
| `57d1304` | doc-only follow-up |

`callback-attempts.ts` and its 9 tests are gone; `orchestrator.ts`, `scheduled-intents-sweep.ts` and
`ai/scheduled-intent-parser.ts` are byte-identical to `1e99617` (verified with `git diff 1e99617 --`,
empty).

**Deliberately kept** — two commits by Roman that are not scenario 2 and were not reverted:
`935676e` (ecosystem config → dev mode) and `cfbea01` (simulation suffix on `providerEventId`, which
addresses the timer duplicate-key error). Confirmed still present in the tree.

**Tagged `backup-before-revert-scenario2`** at `cfbea01` before touching anything, so the reverted
work is recoverable in full — nothing was deleted, only reversed.

## Root cause of the revert

Not diagnosed. The user reported "lots of things are broken" without a specific failure, and asked
for a revert rather than a fix. **No investigation was done into what was actually broken**, so the
scenario-2 code is not known to be wrong — only unwanted in the tree right now. Whoever picks this
up should not assume the reverted commits contain the bug.

Two things were observed but never tied to a failure:

- The last live run (19:27) was executing a **build predating the parser fix**, so its
  `could not be dated` line was expected and not evidence of breakage.
- Repeated timer double-firing with `Unique constraint failed on (providerEventId)` — pre-existing,
  and `cfbea01` (kept) targets it.

## Rejected

- **`git checkout` / hard reset to `1e99617`.** It would have discarded `935676e` and `cfbea01` too,
  and rewritten history that was already pushed. `git revert` keeps both the work and the record.
- **Reverting `f16e761` selectively.** Its message mentions "link recontacts to original
  conversations", which sounds like scenario 1, but the whole commit was written after scenario 1
  was confirmed working, so reverting it whole returns to a state the user had actually seen work.

## Not verified

- **What was broken.** Nothing was reproduced, diagnosed, or fixed. The revert is a rollback, not a
  repair.
- **Scenario 1 in production after the revert.** It was confirmed working at `1e99617` earlier
  today, and its files are untouched, but it has not been re-tested since the revert.
- **The VPS.** The revert is local only; the running build still contains the scenario-2 code until
  someone deploys.

## Baseline after the revert

`28 failed / 489 passed` (517 total — 13 fewer, being the 9 callback-attempts and 4 parser tests
that were reverted). Same 8 failing files as before the session. Note the count is unstable across
runs (28–33) because some suites call the live Anthropic API with an invalid key — compare the
failing *file* list, not the number.
