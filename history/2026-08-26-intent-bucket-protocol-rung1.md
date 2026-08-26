# Intent Bucket Protocol — Rung 1 (Emergency), implemented

## Goal

> "check /Users/n3rd/code/fullsaasclearsky — last 3 commits, the git repo has been updated,
> implement what was updated"

The three commits (`9f064fe`, `adbd1eb`, `6113932`) add
`specs/clearsky-intent-bucket-protocol.md` and cross-reference it from the ID model.
**Rung 1 · Emergency is LOCKED 2026-08-26 (Rory).** Rungs 2–4 (Active / Comparison / Research) are
explicitly DRAFT and were **not** implemented.

## What the spec locks

```
emergency = (critical & damaging)  AND  (must be fixed right away)
            OR a danger-to-life hazard
```

- **The customer sets the urgency**, not us. A burst pipe they want booked next month is a real
  job on a lower rung — not an emergency, and not a dispatch.
- **"Saying the word 'emergency' does not make it one."** The content examples (leak, no heat,
  flooding) are what the AI interprets under Route B — **not a keyword match**.
- **Two routes only:** A, the customer's own structured declaration; B, an AI read of unstructured
  content. **Clicking our emergency-tagged ad is neither** — it is our framing, so it raises a
  source prior and records an unconverted ad click, and never sets the bucket.
- **Life-safety override:** `gas_leak · fire_or_smoke · electrical_shock · carbon_monoxide` force
  emergency regardless of stated timing, because on an unattended channel no rep is there to talk
  the customer round.
- **One bucket per session**, `emergency → active → comparison → research`, escalate-only, settled
  retrospectively at close.

## Changed

- **`src/lib/server/intent/emergency-protocol.ts` (new)** — the spec's reference implementation:
  `IntentBucket`, `IntentStatus` (now including `confirmed` / `contradicted`),
  `LIFE_SAFETY_HAZARDS`, `EmergencyAiRead`, `classifyEmergencyFromContent`,
  `classifyEmergencyFromDeclaration`, `emergencyAdPrior`, `rollUpSessionBucket`. Plus
  `readEmergencyFromContent()` — the spec's extraction prompt verbatim, enum-constrained, with the
  hazard value re-checked against the locked list on the way back.
- **`orchestrator.ts`** — Route B is now the emergency **determinant**. It escalates a non-emergency
  category when the two conditions hold, and — the part that actually changes behaviour — it
  **overrules the AI's coarse bucket when they do not**. The full result, the raw read and a
  `rulesVersion` are written to `metadata.emergency_protocol` as the audit trail the spec asks for
  ("the JSON also records why — including why something was not an emergency").
- **`CommunicationTable.svelte`** — the `🚨 Urgent` chip no longer renders beside an emergency
  stage. The protocol makes emergency the fourth OVERRIDE bucket ("a session reads as exactly one
  bucket"), superseding the two-axis model that chip belonged to. It survives only for a row
  flagged emergency by a writer that never set a stage.

## The keyword heuristic was kept, and demoted

`looksLikeActiveEmergency()` is now a **fallback for when Route B cannot run** (no API key, model
error), not the determinant. Deleting it would mean losing a real emergency whenever the model is
unavailable, which is the worse failure. Its behaviour is unchanged; only its precedence moved.

## Verified

- 13 unit tests covering **every row of the spec's own "Worked results" table**, plus the rules
  behind it (low confidence → `declared` not `confirmed`; "why not" recorded; the hazard list
  locked; rollup escalate-only).
- **Route B against the real model, 5/5**:

```
OK  EMERGENCY · confirmed · critical & damaging (active flood, immediate structural damage)
OK  not       · declared  · damaging but not urgent — timing: Next month (customer away)
OK  not       · declared  · urgent but not damaging (time-pressured buying)
OK  EMERGENCY · confirmed · life-safety override: gas_leak — regardless of timing
OK  not       · declared  · neither critical/damaging nor urgent
```

  The last case is `"This is an emergency! I would like a quote for a new bathroom."` — the exact
  thing the spec forbids treating as one.

- `svelte-check` **938 / 224**, unchanged. Suite **27 failed / 867 passed of 894** (13 new tests),
  run from `apps/lead-grabber-v1`.

## Not verified

- **No live call, SMS or email was put through the orchestrator** with this in place. The protocol
  module is proven against the model directly; the wiring into `process_orchestrator` is proven
  only by type-check and the existing suite.
- **The override path is the risky one.** Route B can now DOWNGRADE a message the AI called an
  emergency. That is what the spec requires, but it means a model misread suppresses a dispatch —
  and no live emergency was replayed to see it behave.
- **Route A is implemented but not wired.** Nothing in the codebase currently emits an
  `emergency_service_selection` signal; the form/tool/booking flows were not audited for where it
  should come from.
- **`emergencyAdPrior` is implemented but not wired.** No caller records an emergency-ad click as a
  source prior or an unconverted click.
- **`rollUpSessionBucket` is not wired** — session-close rollup still happens where it did before;
  this is the spec's function, unused so far.
- Rungs 2–4 are DRAFT in the spec and untouched here, so `active`/`comparison`/`research` are still
  assigned by the pre-existing logic.
