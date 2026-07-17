# Epic 0 — Pipeline defect fixes (branch `features`)

Six defects in the S1–S7 signal pipeline. Type-clean (152 → 152 TS errors, **no new**), no new test failures.

**Repro:** text the Telnyx number and watch the server logs —
`pm2 logs lead-grabber-v1 --raw --lines 400 | grep -E "Section [3-6]|ACT-A2P|emergency_type|fallback"`

Two texts that hit everything:
- **(A) Emergency:** `I am Sam, my basement is flooding and water is pouring into my kitchen — this is an emergency!`
- **(B) New lead:** `Hi, I'm John. Can I get a price quote to install a new water heater?`
(A) also sends a real owner-alert SMS — expected.

---

### T0.1 — Emergency dispatch could never fire
see 👉 _[screenshot: Section 4 + Section 5 for ACT-A2P-004]_
- **Before:** `ACT-A2P-004` (`create_emergency_dispatch_alert`) was seeded with `defaultExecutionMode: 'automatic_immediate'` — not a real lane. Execution eligibility rejected it as `unknown_execution_mode`, so the **primary emergency action silently never ran**.
- **Now:** modes normalize through a shared `execution-modes.ts` (`automatic_immediate → automatic`). Logs show `Section 4 … ACT-A2P-004 … default lane: AUTOMATIC` then `Section 5 … ACT-A2P-004 completed`.
- **Fixes:** emergencies actually dispatch instead of dropping the top-priority action on the floor.

### T0.2 — Emergency signal→action disagreed between paths
see 👉 _[screenshot: `🟠 [In-memory fallback] Primary action for SIG-COMM-000 = ACT-A2P-004`]_
- **Before:** the DB seed maps `SIG-COMM-000 → ACT-A2P-004` (primary), but the in-memory fallback hardcoded `ACT-A2P-002`. Same emergency, two different "primary" actions depending on code path.
- **Now:** the fallback emits `ACT-A2P-004`, matching the seed.
- **Fixes:** the mock/fallback can't disagree with production about what an emergency does.

### T0.3 — `emergency_type` was always null
see 👉 _[screenshot: `Section 4 … Resolved {emergency_type} -> burst_pipe`]_
- **Before:** `ACT-A2P-004` requires `emergency_type`, but no resolver existed → `Resolved {emergency_type} -> null`.
- **Now:** a resolver classifies it (prefers a future `aiEmergencyType`, else keyword-derives). Text "no hot water" → `-> no_hot_water`.
- **Fixes:** the dispatch alert carries a real category (`burst_pipe` / `gas_leak` / `no_hot_water` / …) instead of null.

### T0.4 — `EMERGENCY_SERVICE` / `SIG-COMM-000` defined twice
see 👉 _[screenshot: `🟠 [In-memory fallback] Signal SIG-COMM-000 → EMERGENCY_SERVICE/Risk/p1 (sourced from signal-rules.ts)`]_
- **Before:** the signal was defined in `signal-rules.ts` **and** hardcoded again in the simulator fallback — two sources that could drift.
- **Now:** the fallback derives name/bucket/priority from `signal-rules.ts`.
- **Fixes:** one source of truth for signal metadata.

### T0.5 — Outcome records hardcoded action names
see 👉 _[screenshot: `Section 6 … Action name for ACT-A2P-002 → "alert_business_owner" (from PipelineActionLibrary)`]_
- **Before:** `outcome-engine` had a 2-entry hardcoded name map (`ACT-REV-001`/`004`) and scattered `ACT-REV-002` literals; every other action fell back to its raw id, and the map could drift from the library.
- **Now:** names come from `PipelineActionLibrary`; the "never record" id is a single `NON_RECORDABLE_ACTION_IDS` constant.
- **Fixes:** outcome analytics show correct human-readable names, and there's nothing to keep in sync by hand.

### T0.6 — Actions that pretended to work
see 👉 _[screenshot: `Section 5 … ACT-A2P-001 completed. CRM: contact_created` + `ACT-A2P-004 completed. Emergency dispatch task …` + the new rows in `contacts`/`tasks`]_
- **Before:** `create_crm_lead` (ACT-A2P-001) and `create_emergency_dispatch_alert` (ACT-A2P-004) fell through to the generic branch that logged a **simulated** SMS and wrote nothing to the DB.
- **Now:** `ACT-A2P-001` upserts a real `Contact`; `ACT-A2P-004` creates a real dispatch `Task` (no duplicate owner SMS — `ACT-A2P-002` already handles that).
- **Fixes:** a new lead actually lands in the CRM and an emergency creates an actionable dispatch task, instead of a no-op that looked successful in the logs.

---

**Files:** `src/lib/server/pipeline/execution-modes.ts` (new), `execution-engine.ts`, `action-queue-engine.ts`, `orchestrator-engine.ts`, `outcome-engine.ts`, `pipeline-simulator.ts`.

**Still generic/simulated (follow-up):** `ACT-A2P-003` (log) and `ACT-A2P-006` (flag churn risk) — the T0.6 pattern is in place to give them real handlers next.
