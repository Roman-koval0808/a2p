# Communication log — what to fix

Scope: the two 2026-08-25 notes (log column changes, and the Engagement/subtopic roadmap) plus the
subtopic-scoring requirement. Nothing else.

Delivery order follows the roadmap's own phases.

---

## Phase 0 — the log columns (doc 1)

Restructure `(app)/communication-log` to the prototype's layout:

| # | Column | Holds |
|---|---|---|
| 1 | (dot) | row status |
| 2 | Date | session start date + time |
| 3 | **Channel & Source** | two facts stacked in one cell |
| 4 | Intent | stage + emergency + status + confidence |
| 5 | **Profile ID · Who** | `PRF-####`, tier badge, best "who" label |
| 6 | Endpoint | where it was received/sent/transferred |
| 7 | Journey & Activity | this session's sequence + signals |
| 8 | **Engagement ID** | `ENG-####` on top, `SES-####` underneath |
| 9 | Summary | opens the Request → Task → Action drawer |
| 10 | (•••) | row actions |

Three structural changes:

- **Channel & Source merge into one stacked cell.** Top = Channel + direction (`🌐 Web IN`), under =
  Source (`Google Paid Ads`). One combined ⓘ on the heading explains both. **Source is not the
  person** — the person is the Profile column.
- **Engagement ID carries Session ID beneath it** — reflects Profile → Engagement → Session →
  Interaction.
- **Column reorder** to the sequence above.

`Profile ID · Who` is ahead of the model spec (the spec's 7-column list doesn't enumerate it yet).
Build it, but flag it rather than treating the spec as wrong.

Reference: `design/a2p-log-prototype.html`, commits `9e04c59`, `c1f075b`.

---

## Phase 1 — Engagement = business episode, + Bug B

`CommunicationThread` is the engagement container. **No schema change for the boundary rule** — the
change is resolution logic: when a new `CommunicationLog` arrives, decide which thread it belongs to.

```
1. Explicit engagement / project / quote / case / work-order reference  -> use it
2. Else the contact's ACTIVE (open) thread — WHATEVER the subtopic      -> reuse it
3. Else the contact's most recent thread within the inactivity window   -> reuse it
4. Else                                                                 -> new thread
```

**Never open a new thread because the subtopic changed.**

- `active/open` = `CommunicationThread.status != 'closed'` — already exists
  (`prisma/schema.prisma:383-384`), no migration.
- **Inactivity window:** per type of business, but a thread can span several — keep it open for the
  **longest** window among its subtopics. A quick-repair window must not close an active renovation
  episode early.
- Record `assignReason` + `rulesVersion` on every assignment.

**One correction to make here.** `upsertSessionCommLog` (`intake.ts:447`) currently builds
`vt_<fp>_<sessionId>` threads **per browser tab**, with a 30-min fallback (`:503`, `:509-519`). That
makes a thread a session, which this rule inverts. The thread becomes long-lived; the per-visit
boundary moves down to the `CommunicationLog` row (the Session). The 30-min logic is not deleted —
it moves one level down.

**Bug B** — a bare return with no detectable subject ("General") failed exact-subject match and
forked a new engagement. Rule 2 fixes it: active outranks new, and unknown ≠ different. Same code
path, no separate work.

### Acceptance (mirrors the simulator)

- Known contact books furnace work → T1.
- Same contact calls about a drain → **still T1**, `subtopics = [furnace, drain]`.
- Same contact returns after the window → new T2.
- Return with no detectable subject → still T1.

---

## Phase 2 — Bug A, source-aware intent status

`ad_indicated` must mean a real paid-ad click. The old fallback gave it to any no-message arrival,
so organic search wrongly showed `ad_indicated`.

| Situation | Status |
|---|---|
| outbound | n/a |
| message / identity / review | `declared` |
| paid ad, no message | `ad_indicated` |
| browsed pages, no message | `behaviour_inferred` |
| just landed, no behaviour | `source_indicated` |

Ladder: `ad_indicated → behaviour_inferred/supported → declared → confirmed` (or `contradicted`).

---

## Phase 3 — subtopic storage + rollup (Layer A)

```prisma
model CommunicationLog {
  subtopic   String?   // type of business for THIS interaction (nullable)
}

model CommunicationThread {
  subtopics  Json  @default("[]")   // distinct rollup for this episode
}
```

Mirrors `aiPraiseTopics` / `aiComplaintTopics` (`schema.prisma:688-689`), already `Json @default("[]")`.

On log insert: if `subtopic` is set and not already in `thread.subtopics`, append it.
Migration + `prisma generate` + the rollup line. That is all of Layer A.

### Subtopic identity

Subtopics are identified **within** the engagement — `ENG-000102` → `subtopic1 Kitchen renovation
id0001`, `subtopic2 Bathroom renovation id0002`. So the rollup entry is a pair (key + per-engagement
ordinal id), not a bare string.

### Per-subtopic engagement score

Worked example: 6 pages / 30 signals on kitchen, then 3 pages / 20 signals asking for a bathroom
quote, one session → **total 50, kitchen 20, bathroom 30**.

- Each signal is attributed to a subtopic at fire time; unattributable signals go to a `null` bucket
  rather than being dropped.
- Deltas accumulate per subtopic on the thread; the engagement total is the rollup.
- Keep the write atomic in SQL (`jsonb_set` with the arithmetic in the statement). A JSON
  read-modify-write is the same lost-update shape that dropped comm-log signals on 2026-08-20.

**Note the cap.** `applyContactScore` currently does `LEAST(100, …)` (`intake.ts:410`) on a single
number. The worked example (20 + 30 = 50) reads as a plain sum, so the cap belongs on the total —
confirm before building, because it changes what existing scores mean.

**Attribution needs the signal payload**, and `intake.ts` currently discards it (zero `payload`
references). Persist it as part of this phase or web signals cannot be attributed to a subtopic.

---

## Phase 4 — classification (Layer B, the real cost)

A tag is only useful if it means the same thing every time.

- **Taxonomy — business decision, not free text.** A per-contractor list of the tasks that contractor
  performs: HVAC, Plumbing, Electrical, Renovations → {Bathroom, Kitchen, Roof}, Water-heater,
  Drain, … Per-company rows, two levels (parent + child).
- **Free seed for calls:** `CallTrackingCategory` (`schema.prisma:200`) already maps a tracking
  number → a category; use it as the subtopic for phone calls, no AI.
- **Web:** URL → taxonomy-key map (`/services/drains`, `/bathroom-renovations`). This is what makes
  per-subtopic scoring deterministic.
- **Extraction:** add subtopic to the AI session-close interpretation, reusing the topic-extraction
  machinery already used for review praise/complaint topics. Constrain output to the company's keys.
- **Eval pass:** a small labelled set to confirm consistency before anything trusts the tags.

---

## Phase 5 — display (Layer C)

Show `thread.subtopics` in the log/thread UI, as the simulator's profile panel does:
`ENG-0001 · Furnace, Plumbing · score 40`. With per-subtopic scores available, show the split.

---

## Deferred (confirmed no for v1)

Per-subtopic status / job-lines — "won furnace / lost drain" needs a `thread_subtopic` join table
with its own status lifecycle. Add only when the data shows it is needed.

---

## Blocked on a human

1. **The taxonomy content** — the actual per-contractor service list. Blocks phase 4.
2. **The score cap** — per subtopic, on the total, or uncapped. Blocks phase 3.
