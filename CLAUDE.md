# a2p — working notes for AI agents

## Write a history entry at the end of every session

**Before handing back, write `history/YYYY-MM-DD-short-topic.md`.** Read
[history/README.md](history/README.md) for the required sections and rules, and an existing entry
for the expected depth.

This is not optional and not a changelog — git already records what changed. The entry records the
*reasoning*: which behaviour was a bug and which was deliberate, what you tried and rejected, and
**what you did not verify**.

Three rules that matter more than the rest:

1. **Never claim something works that you did not verify.** "Tests pass", "user confirmed in
   production" and "not verified" are three different statements. Use the true one.
2. **Record the wrong turns.** An approach you abandoned, and why, saves the next agent from
   repeating it. Several fixes in this repo were reverted after they broke a spec test.
3. **Always include the "Not verified" section**, even when it is long.

Update the entry as you go on a long session rather than reconstructing it at the end.

## Specs are the source of truth, and some are locked

`specs/` holds the product decisions. Where a doc says **LOCKED** with a date and a name, do not
change that behaviour to fix a symptom — raise it. Examples that have already bitten:

- `clearsky-identity-tiers-canonical.md` §4.3a — shared lines are Tier 2 (locked 2026-08-05)
- `clearsky-one-person-one-record.md` — merging is point-and-retire, never delete
- Scheduled intents §3 — the 7-day customer grace, encoded in `ray-scenario.test.ts`

If code and spec disagree, say which won and why in the history entry.

## The test baseline is not green

`npx vitest run` from `apps/lead-grabber-v1` currently fails ~28 tests, and `svelte-check` reports
~330 errors. Both predate current work. **Record the numbers before you start and compare after** —
"baseline unchanged" is the only signal available until someone fixes them.

Run tests from `apps/lead-grabber-v1`, never the repo root: `$lib` aliases don't resolve at the
root and every suite fails misleadingly.

## Before changing a behaviour that appears in several places

Grep for **every** writer first, then change them together. This repo has repeatedly had the same
decision implemented three or four times in different files — thread linking, phone normalisation,
COM id rendering, intent resolution. Fixing the one a log points at leaves the others live, and the
bug appears to come back.

## Identity rules, learned the hard way

- **Sharing a COM id asserts "these are the same person."** Only an exclusive identifier may assert
  that — never topic or text similarity, however confident the model is.
- **Never delete a profile or contact to resolve a duplicate.** Point the keys at the survivor and
  set `mergedInto`. Deleting caused foreign-key failures across comm logs and containers.
- **Put identity guards in the query's `WHERE`, not in an `if` above it** — see
  `src/lib/server/intent-resolution.ts`.
