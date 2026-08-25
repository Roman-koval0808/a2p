# 2026-08-25 — engagement model: thread = episode, log = session, subtopics + per-subtopic score

## Goal

"Fix these" — implement the engagement model plan in the user's message (log column changes from
`design/LOG-CHANGES-FOR-ROMAN.md` + the Engagement/subtopic roadmap
`specs/ROADMAP-engagement-business-episode-FOR-ROMAN.md` + subtopic scoring). Authoritative model:
`specs/clearsky-communication-log-id-model.md`. Reference repo for docs/prototype:
`/Users/n3rd/code/fullsaasclearsky` (NOT part of this repo).

Two human decisions settled up front: **cap the total at 100** (not per-subtopic), and **skip the
ServiceTaxonomy table** (no seed, no classification table).

## Changed

- `prisma/schema.prisma` — `CommunicationThread` gained `subtopics Json @default("[]")`,
  `subtopicScores Json @default("{}")`, `engagementScore Int @default(0)`, `closedAt`,
  `assignReason`, `rulesVersion`. `CommunicationLog` gained `subtopic` + `sessionRef`.
  `PipelineEvent` gained `payload Json?`.
- `prisma/migrations/20260825000000_engagement_subtopic_model/migration.sql` — written by hand
  (matches the schema edits; camelCase columns, no `@map`). **Not applied** — see Not verified.
- `src/lib/server/telemetry/engagement.ts` (new) — pure, unit-tested logic: `resolveEngagementThread`
  (evidence-before-time), `engagementWindowDays` (longest-window-wins), `deriveIntentStatus`
  (source-aware), `subtopicFromUrl`/`subtopicFromSignals`/`resolveBatchSubtopic`,
  `accumulateSubtopicScores`/`rollupScore`/`capTotal`.
- `src/lib/server/telemetry/engagement.test.ts` (new) — 19 tests, all pass.
- `src/lib/server/telemetry/intake.ts` — the visit-split moved down a level. `upsertSessionCommLog`
  now: resolves ONE long-lived thread per engagement (contact's open thread → recent-within-window →
  new), opens a new `CommunicationLog` row per session (the 30-min `VISIT_GAP_MINUTES` now gates the
  log row, not the thread), records `assignReason`+`rulesVersion`, rolls up `subtopics`, accumulates
  `subtopicScores`, and writes `engagementScore = capTotal(rollup)` (cap on total = 100). Also now
  persists each signal's raw `payload` onto `PipelineEvent.payload`, and stamps `metadata.intentStatus`
  from `deriveIntentStatus`.
- `src/lib/utils/comm-id.ts` — added `idCode`/`prfCode`/`engCode`/`sesCode` (same FNV-1a hash).
- `src/routes/(app)/communication-log/+page.server.ts` — surfaces `channelSource`, `engagementId`,
  `sessionId`, `profileId`, `profileName`, `profileTier`, `threadSubtopics`,
  `threadSubtopicScores`, `threadEngagementScore`, `intentStatus`, `intentStage`; includes
  `callTrackingCategory`.
- `src/routes/(app)/communication-log/+page.svelte` — passes the new fields through to the table.
- `src/lib/components/CommunicationTable.svelte` — restructured to the prototype's exact look
  (`design/a2p-log-prototype.html`): column order (dot) · Date · Channel & Source (stacked) · Intent ·
  Profile ID · Who · Endpoint · Journey & Activity · Engagement ID (ENG over SES) · Summary · (•••).
  Ported the prototype's design system verbatim — Segoe UI, the `#1b2129/#8b95a0` ink/faint palette,
  emoji channel icons (🌐📞💬✉️🤖📘▶️📝), IN/OUT direction badges, stage pills
  (research/comparison/active/emergency), tier badges (T1 green / T2 gray / 2B amber), and the ⓘ
  column-protocol drawers. Styles are namespaced under `:global(.clog …)` so Svelte's class scoping
  doesn't break the runtime-generated `stage`/`tier`/`pill` modifier classes. Intent cell now shows
  subtopic + status·confidence; Source cell shows the keyword/query detail; Profile cell shows the
  tier "who" note ("Anonymous · fp_… — device only").
- `src/lib/components/session-summary-drawer.svelte` (new) — prototype-style Session Summary drawer
  (Narrative · Channel·Source·Endpoint · Intent AI interpretation · Journey & Activity · Status & next
  step). Wired in `communication-log/+page.svelte`: row/Summary/ENG click opens this drawer; the a2p
  `CommunicationSummaryDialog` (recording/tasks/drafts/confirm) stays reachable via the ••• "View
  Details" action.

Also regenerated `profiledb-client` (`prisma generate --schema=prisma/profiledb/schema.prisma`) — it
was missing from the workspace (only a `runtime/` dir), which was the source of the user's
`Cannot find module 'profiledb-client'` 500 on `/dashboard`. Pre-existing, not caused by this work.

## Root causes

- **The visit-split was at the wrong level.** 2026-08-20 made `CommunicationThread` split per browser
  tab (`vt_<fp>_<sessionId>`), so a thread *was* a session. Under the new model the thread is the
  engagement; the fix was a move, not a rewrite — thread selection switched to evidence-before-time,
  and the 30-min gap moved down to decide the log row.
- **Bug B (bare return forked a new engagement):** the old exact-subject match treated "no detectable
  subject" as "different subject" and opened a new thread. Rule 2 (contact's open thread, whatever the
  subtopic) fixes it — unknown ≠ different.
- **Bug A (`ad_indicated` for organic):** there was NO `ad_indicated` in this codebase (grep found
  zero references) — the "old fallback" lived in the reference/orchestrator, not here. So Bug A here is
  net-new: `deriveIntentStatus` now assigns `ad_indicated` only to a real paid-ad channel.

## Rejected

- **jsonb_set arithmetic in SQL** (plan §5 suggested it). I accumulated `subtopicScores` in JS inside
  the per-visitor advisory-lock transaction instead. The lock already serialises concurrent batches
  for a visitor, which is exactly what the SQL jsonb_set guard was protecting against; doing it in JS
  kept the rollup readable. Same justification the existing `metadata.signals` append already uses.

## Review findings (code review pass, then fixed)

1. **Rule #1 (explicit ref) never wired + latent crash.** `resolveEngagementThread`'s `explicitRef`
   branch returned a `ThreadResolution` with no `threadId`, and intake did `decision.threadId!`. It
   was never triggered (the web `SignalBatch` carries no explicit engagement/project/quote/case ref),
   but if wired it would feed `undefined` into the thread write. Fixed: intake now falls through to a
   fresh engagement when `decision.threadId` is absent, and the code notes rule #1 awaits an explicit-ref
   source. It is NOT wired in production — flagged, not claimed.
2. **Score divergence.** `meta.scoreLive` was set to the legacy contact score while
   `thread.engagementScore` was the per-subtopic rollup. Unified `scoreLive` to the rollup so the row
   and the engagement agree.
3. **Closed threads reused within window** — not a live bug: nothing sets
   `CommunicationThread.status = 'closed'` yet, and the reuse-within-window behaviour matches roadmap
   rule #3 as written. Revisit when open/close lifecycle lands.
4. **Plan-doc shape mismatch (subtopic = pair vs string[])** — moot: the removed `ENGAGEMENT-MODEL-PLAN.md`
   proposed a pair identity; the authoritative roadmap wants a plain `string[]`, which is implemented.

## Not verified

- ~~**The migration is written but NOT applied**~~ — **corrected 2026-08-25 (review):** all nine
  columns ARE live in the database. It was applied by `db push`, not `migrate` — there is no
  `_prisma_migrations` table in this database at all, so the SQL file is a record rather than
  something Prisma will ever run. A future `migrate deploy` would try to re-add existing columns.
- **The DB wiring in `upsertSessionCommLog` was not exercised against a live database.** The pure
  decision functions are unit-tested; the transaction itself (thread resolution queries, upsert, JSON
  rollup) is only type-checked, not run.
- **The UI was not opened in a browser.** Columns were restructured and type-checked (0 svelte-check
  errors in the touched files) but not visually verified against `design/a2p-log-prototype.html`.
- **`profileTier` is a heuristic** (email/cell → T1, name → T2, else T2B), NOT `tierForIdentifiers`
  with line-type lookup. It will disagree with the phone-side tier on landline callers.
- **`intentStage` is surfaced from `metadata.intentBucket`/`ai_intent.stage` only** — the full two-axis
  intent rework (emergency as a separate stored field) was NOT in this plan's scope; only source-aware
  status (Bug A) was asked for.

## Open decisions / deferred

1. **ServiceTaxonomy** — skipped by user request. No classification table exists; web subtopics come
   only from the URL map + signal payload fields.
2. **CallTrackingCategory → subtopic key** on the voice intake path — NOT done; I only surfaced the
   category *name* in the log's Source column fallback. Mapping it to a taxonomy key needs the (skipped)
   taxonomy.
3. **AI session-close subtopic extraction** — not done (needs the taxonomy keys to constrain to).
4. **Backfill** — not done; existing `vt_*` threads are still sessions, not engagements. Two eras of
   meaning coexist in the log until backfill folds them.
5. **Score decay per subtopic** — not touched; still the per-profile formulas (defect #92 unpicked).
6. **Per-subtopic status** — confirmed deferred (no `thread_subtopic` join table).

## Baselines (before → after)

- `npx vitest run` from `apps/lead-grabber-v1`: **28 failed** before and after (771 passed now, +19
  new passing tests; the earlier "37 failed" was an inherited broken `profiledb-client`, fixed here by
  running `prisma generate --schema=prisma/profiledb/schema.prisma`).
- `npm run check` (svelte-check): **938 errors / 224 warnings** — matches the documented baseline
  (938/223); zero errors in the files touched this session.

---

# Review pass — three attribution gaps found and fixed

Reviewed the implementation against both 2026-08-25 docs plus the clarification that *interactions
and signals carry a subtopic where identifiable, and are recorded separately as unknown where not*.
Everything in the docs checked out except subtopic attribution, which had three defects.

## Root cause — the worked example could not have worked

`SUBTOPIC_PAYLOAD_FIELDS` was `['service','problem','interest','emergencyType']`. **`url` was not in
it**, but `page_load`'s payload is `['url','title']`. So for a web session no signal ever matched on
its own payload, and every signal fell back to the *same* `batch.attribution.landingUrl`.

Every signal in a batch therefore inherited one subtopic — the landing page. The worked example
(6 kitchen pages, then a bathroom quote, in ONE session → kitchen 20 / bathroom 30) collapses to a
single subtopic under that.

**The existing test suite could not catch this**: `matches the worked example: 20 bathroom +
30 kitchen = 50` fed `accumulateSubtopicScores` directly. The arithmetic was tested; the attribution
that produces those numbers never was.

## Fixed

- **`engagement.ts`** — new `subtopicForSignal(signal, fallbackUrl)` resolving most-specific first:
  a payload field naming the subject → **the page THIS signal fired on** → the session's landing
  page. Added `SUBTOPIC_URL_FIELDS` (`url`, `page`, `pathname`, `href`, `landingUrl`) and
  `pathnameOf`, which accepts both shapes emitters actually send — the site tracker sends
  `window.location.pathname`, the embeds send `window.location.href`.
- **`intake.ts`** — the subtopic is now resolved **once per event** where `eventIds` is built, and
  reused for both the interaction row and the score rollup (it was resolved twice, differently).
- **Rollup divergence.** `thread.subtopics` appended only the batch-level subtopic while
  `subtopicScores` gained every per-signal one, so the array and the map could disagree — a mixed
  session scored two subjects but listed one. The array is now built from the keys of
  `deltasBySubtopic`, excluding UNKNOWN.
- **Interactions now carry their subject.** `PipelineEvent.subtopic` (+ index) — previously
  attribution was transient, so you could see an engagement scored 30 on "bathroom" but not which
  interactions those were. Migration `20260825010000_pipeline_event_subtopic`, applied via
  `prisma db execute` (matching how this database is managed).
- **Vocabulary** — `unattributed` → `UNKNOWN_SUBTOPIC = 'unknown'`, matching the requirement's
  wording. UNKNOWN is scored separately and never listed as a subject.

## Verified

- 7 new tests (26 total in the file, all pass), covering what the old suite could not: a signal's own
  page beating the landing page, full hrefs vs pathnames, a named subject beating the page, fallback
  to landing, null when nothing identifies a subject, and the **worked example attributed end to
  end** — 6 kitchen pages + scroll/dwell/svc_click → kitchen 20, bathroom quote path → bathroom 28,
  one page-less signal → unknown 2, with the subject list agreeing with the scored keys.
- Baselines held: `npx vitest run` **28 failed / 778 passed** (28 baseline failures unchanged, +7 new
  passing); `svelte-check` **938 errors / 224 warnings**.

## Not verified

- **Not exercised against a live database.** The attribution and rollup are unit-tested; the
  transaction that writes `PipelineEvent.subtopic` and the thread rollup was type-checked only.
- **The URL→subtopic map is still a hardcoded regex list** in `engagement.ts`, not a taxonomy. That
  was the user's decision (ServiceTaxonomy skipped). It means subtopic keys are whatever those
  patterns emit, and a contractor whose services are not in that list gets `unknown` for everything.
- The UI was not opened in a browser this pass either.
