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

---

# Part 3 — engagement logic on every channel, and the Session Summary blanks

## Goal

> "Will the same engagement logic work for calls? etc" → "good, now put it on every channel"
>
> "every channel should have … also journey and activity shortened … also see for every one, we
> should have a subtopic, should not be blank! source too!, use the same source in the comm logs …
> Stage too. Confidence too. where they apply!"
>
> "no I meant show the full message, no elipsis or shortening, full"

## Root causes

**The engagement rule was implemented four times.** Telemetry intake and `logCommunication` had it;
the Telnyx call webhook had two hand-rolled copies. Site 1 (`:1630`) approximated rule 2 but ordered
by `created` not `updated`, applied no inactivity window, took no advisory lock and stamped no
`assignReason`/`rulesVersion` — which also left voice threads movable by the container matcher,
since the Part 1 guard keys off `rulesVersion`. Site 2 (`recording.saved`) was an unconditional
`create`: **every recorded call opened a new engagement.** The `/test` page had two more direct
creates, so testing from `/test` never exercised production behaviour.

**Subtopic was blank on everything except web telemetry.** Classification only ran in
`intake.ts`, where a URL gives it away free. Anything arriving as text — SMS, email, voicemail
transcript — got nothing, so those engagements read "(General)".

**Stage / confidence / source were blank on outbound rows** because they are facts about the
conversation, not about one message. Only the customer's inbound messages produce them.

**Journey & Activity was clipped twice over.** The stored `summary` is
`draftedResponse.substring(0, 40) + '...'`, and my first attempt routed the drawer through
`journeyActivity` — which is deliberately the compact *table* label ("1 inbound SMS"). Wrong for a
drawer that exists to show what was said.

## Changed

- **`src/lib/server/telemetry/resolve-engagement.ts` (new)** — `resolveEngagementForContact(tx, …)`,
  the one implementation: advisory lock on the contact, full rule ladder, window, retire-on-lapse,
  `assignReason` + `rulesVersion`. For callers that write their own `CommunicationLog`.
- `src/routes/api/telnyx/call-webhook/+server.ts` — both voice sites now call it.
- `src/routes/(app)/test/+page.server.ts` — both creates now call it, so `/test` matches production.
- `src/lib/utils/communication-log.ts` —
  - **contact back-fill**: when no `customer_id` is supplied, match the party at the other end of
    the row (`destination` outbound, `source` inbound) against existing contacts by email or by the
    last 10 phone digits. Matched, never created — `source: 'callback-router'` is a label, not a
    person. Fixes all six orphan callers at once instead of six separate edits.
  - **subtopic classification** for inbound text via the existing ladder (page/payload →
    call-tracking category → Claude), run **outside** the transaction, skipping internal notices,
    and rolled up onto the engagement's `subtopics`.
- `src/lib/server/communication-surface.ts` — `applyEngagementFallbacks()`: fills an interaction's
  blank stage/subtopic/confidence/attribution from the most recent row in the same engagement that
  knows, preferring inbound. Invents nothing. `intentStatus` and `intentEmergency` are left alone —
  those are properties of the message ("where they apply").
- Both page loaders run it before pagination, so an outbound reply inherits from an inbound message
  on another page. No extra queries.
- `src/lib/components/session-summary-drawer.svelte` — Journey shows `content` **in full**
  (`white-space: pre-wrap`, no clamp); Narrative prefers `content` over the truncated `summary`;
  Source shows `comm.source`, the same value the comm-log column renders, with the attribution
  channel below it when it differs.

## Verified live

Two SMS from one number through the real webhook:

- **1 engagement** across both messages *and* the outbound dial row, `assignReason:
  active_open_thread`, `rulesVersion: engagement_resolution_v1`.
- Subtopics classified per message and rolled up: **`["drain", "bathroom"]`** — a subtopic change
  did not fork the engagement.
- "kitchen sink is backing up" classified as **`drain`**, not `kitchen` — the taxonomy prompt's
  intended behaviour.
- Bucket-promotion notices got `subtopic: null` — skipped, no model call spent.
- **`orphan rows: 0`.** The `voice/outbound` "Outbound call not answered (45s ring)" row, written by
  one of the six contactless callers, landed on the engagement. That is the back-fill working.

Suite **28 failed / 834 passed** (floor). `svelte-check` **938 / 224** — held, after a +1 regression
was traced (a `findUnique` where the old `create` guaranteed non-null) and fixed to
`findUniqueOrThrow`. The measurement was taken by stashing the two route files and re-running, not
by eyeballing.

## Not verified

- **No real inbound voice call.** Both call-webhook sites are changed and typecheck, but a live
  Telnyx call was never placed — only SMS and the outbound dial row exercised the path. The
  `recording.saved` branch in particular has never run with the new code.
- **The `/test` page changes were not run.**
- **The drawer was not opened in a browser.** Journey/Narrative/Source/Stage/Confidence were fixed
  in the data and the template; the rendered result is unconfirmed.
- **Cost.** Every inbound text message now makes a Claude call when the deterministic rungs miss.
  Notices are excluded and the model is `CLAUDE_FAST`, but nobody has measured the volume.
- **No backfill** for existing rows: subtopics only appear on messages written after this change.
- The contact back-fill matches on the last 10 digits, which would collide across countries sharing
  a 10-digit tail. Acceptable for the current single-region data; not safe in general.

---

# Part 4 — comm-log Intent and Profile columns (2026-08-26)

## Goal

Five changes from a screenshot: (1) Intent showed a bare tag ("Bathroom") instead of the actual
intent; (2) one row appeared to carry both an "Active" and an "Emergency" bucket; (3) show the
person's name instead of `PRF-####`; (4) spell out the tier instead of "T2"; (5) comment out the
urgency dot, keep the code.

## Changed

- **`src/lib/utils/subtopic-labels.ts` (new)** — `SUBTOPIC_LABELS` + `subtopicLabel()`. In `utils`,
  not beside the taxonomy, because SvelteKit will not bundle `$lib/server` into a component.
  `subtopic-classifier.ts` now reads its 12 taxonomy labels from here, so the two cannot drift.
- `CommunicationTable.svelte`
  - `intentLine()` — the subject in words ("Blocked drain", "Bathroom renovation") joined with the
    orchestrator's purpose when the purpose adds something. `purposeIsRedundant()` drops the second
    line when it would only repeat the first.
  - The emergency flag is no longer rendered with the `stage` pill class. It is a `.urgentflag`
    chip, visibly a flag rather than a second bucket.
  - Profile column leads with the name; the `PRF-####` code moves to the sub-line. An anonymous
    visitor has no name, so there the code still leads.
  - `tierLabel()` returns "Tier 1" / "Tier 2" / "Tier 2B".
  - The urgency dot cell is **commented out, not deleted** — `statusDotClass` and the `.dot` styles
    are untouched, and restoring one line brings it back.
- `communication-log/+page.svelte` passes `intentEmergency` through to the table.

## On "how do we have active and emergency on one log"

By design, and the rendering was lying about it. The spec's intent model is two-axis: `stage`
(research → comparison → active) is where the customer is in deciding; `emergency` is urgency and
is explicitly **not** a stage. A row can legitimately be both. Giving them the same pill class made
it read as a self-contradicting record.

Worth a second look though: in `readIntent`, when there is no explicit bucket the stage is
*derived* from the emergency (`emergency ? 'active' : null`). For a row like the screenshot's, the
two badges may be the same fact shown twice rather than two independent readings. Not investigated.

## Verified

`svelte-check` **938 / 224** — held exactly, after a `{@const}` placement error was caught and
fixed (Svelte requires them as immediate children of a block, not inside a `<td>`).

Test suite runs in a **27–29 failed** band with 4 skipped. The skips are
`integration-simulation.test.ts`, whose `beforeAll` hits the shared database and skips the file when
it cannot connect — environmental, unrelated to this work, and worth knowing that this suite
**writes to the live database**.

## Not verified

- **Nothing was viewed in a browser.** All five changes are template/data changes checked by
  `svelte-check` only.
- `personName` falls back to `comm.source` for non-anonymous rows, which is a phone number when the
  contact has no name — better than a code, but not a name.
- The profiles page uses the same `CommunicationTable`, so it inherits all five changes; not
  looked at.

---

# Part 5 — Column 4 "Source", to the spec (2026-08-26)

## Goal

> "outgoing logs source should have the medium and source not the profile that its being sent to"
> … then, after a first attempt: "sorry, undo that, see examples of what it should be, from those
> think and make the best recommended decision" — with three prototype rows and
> `specs/clearsky-communication-log-id-model.md`.

## The wrong turn, and why

First attempt read "source" as `log.source` and put the sending phone number in the Source line,
reasoning from `c917e394`'s loader convention (outbound source = the company). That convention is
real, but it governs the **Endpoint**-style per-direction values, not Column 4. The model spec is
explicit:

> The identifiable origin, platform, campaign or referral that produced the interaction.
> **The Source is not the person — the person is the Profile.**

A bare phone number is not an origin. Reverted.

## What the spec and prototype actually say

Source is the **provider channel**, listed per medium (Web: Google Ads / Bing Organic / Referral /
LLM Referral / …; Phone: click-to-call / Google Business Profile / Tracking number / …; SMS and
Email likewise). The counterpart's number or address goes in the **detail line underneath**.

From `design/a2p-log-prototype.html` (the authoritative rows):

```
web   in    Bing Organic             query not provided
phone in    Google Business Profile  +1 705 555 0140 · mobile
phone in    Inbound Call             tracking number · +1 705 555 0155
sms   in    Inbound SMS              +1 705 555 0155 · mobile
email in    Inbound Email            rory@example.com
phone out   Rep-bound number         Dave R. · Sales
sms   out   Outbound SMS (A2P)       bound before send
email out   Outbound Email (A2P)     Postmark · track clicks
```

## Root cause

Only web rows ever had a Source. `sourceChannelLabel()` handled `attribution.channel` and then fell
back to `meta.source_signal`, which on a message row holds the MEDIUM — so an outbound SMS rendered
"SMS · OUT" above a Source reading "sms", restating the channel and saying nothing.

## Changed — `communication-surface.ts`

- `sourceChannelLabel(meta, log)` now resolves, in order: web attribution → token link
  (`Email link (cs_token)` / `SMS link (cs_token)`) → call-tracking category → per medium and
  direction (`Inbound SMS` / `Outbound SMS (A2P)`, `Inbound Email` / `Outbound Email (A2P)`,
  `Inbound Call` / `Rep-bound number`). `source_signal` survives only when it is not just the medium.
- `Rep-bound number` is claimed **only** when a person is actually attached (`userId`, `rep_name`,
  `tech_name`); otherwise "Outbound Call". The prototype's label asserts a named rep placed it, and
  that should not be asserted without one.
- `sourceChannelDetail(meta, log)` carries the specifics: the counterpart address/number inbound
  (prefixed `tracking number · ` when a tracking category applies), the rep outbound, falling back
  to the line it went out on.
- `COMMUNICATION_SURFACE_INCLUDE` now selects `user { name, email }` so the rep's name is available.

`applyEngagementFallbacks` keeps attribution inbound-only (from the first attempt, and still right):
inheriting it onto an outbound leg would claim we sent a message "from Google Ads".

## Verified

`svelte-check` **938 / 224**, unchanged. Tests in the usual **27–29 failed** band with 4
environmental skips.

## Not verified

- **Nothing seen in a browser**, and no row read back from the database — the shared Postgres was
  out of connection slots (`remaining connection slots are reserved for roles with the SUPERUSER
  attribute`). Conclusions are from the spec, the prototype and the code.
- The prototype's exact detail strings for outbound ("bound before send", "Postmark · track
  clicks") are **not** reproduced: they assert A2P binding and a specific ESP that this code does
  not actually know. The rep name or the sending line is shown instead. If those literal strings
  are wanted, the underlying facts need recording first.
- The spec's own open question — Channel/Source overlap for `QR`, `Website Form`, click-to-call —
  is flagged there as "not yet decided" and is untouched here.
- Chat/chatbot labels ("Inbound Chat" / "Outbound Chat") are invented: the spec's per-channel table
  does not list chat sources.

---

# Part 6 — "Rep-bound number · Dave R. · Sales": where the name comes from (2026-08-26)

## Goal

> "how do we determine the name and if the name is supposed to be there. read all the info buttons
> popup in the comm logs too"

## What the ⓘ protocols say

Read from `design/a2p-log-prototype.html` (`COLS`, rendered by `openCol()`):

- **Source**: "WHERE the interaction came from — the platform, campaign or referral. One of the 31
  provider channels." · "**Source is NOT the person — the person is the Profile.**"
- **Endpoint**: "WHERE it was received, sent or transferred — the touchpoint on OUR side." ·
  "**Ties to call-binding — which number or rep was involved.**"

## Is the name supposed to be there? Yes — with a caveat worth recording

"Source is not the person" guards against putting the **customer** there; that is the Profile
column's job. Dave R. is *our* rep, and on an outbound call the rep's own bound line genuinely is
where the call came from. So the name belongs.

The tension is that the Endpoint protocol also claims rep-binding ("which number or rep was
involved"), and the prototype's row puts the customer's number in Endpoint (`→ +1 705 555 0155`)
and the rep in the Source detail. Both readings are defensible; the prototype's own rows are the
tie-breaker and they were followed.

## How the name is determined here

| Source of the name | Where it comes from | Available today |
|---|---|---|
| `log.userId` → `User.name` | the human who initiated the row | only `sms/send` set it |
| `meta.rep_name` | not written anywhere yet | no |
| `meta.tech_name` | `emergency-dial.ts` — a *technician*, not a rep | yes |

Two corrections to Part 5 came out of this:

1. **A dial-ladder leg is not a rep-bound call.** It is the SYSTEM ringing our own on-call staff;
   the person at the far end is a technician and the customer is not involved. Part 5 let
   `tech_name` produce "Rep-bound number", which was wrong. It now reads **"Dial ladder (system)"**
   with the rung as detail, and the technician's name stays in Endpoint where the loader already
   puts it (`tech_name (rung N)`).
2. **"Rep-bound number" is claimed only when a human actually initiated the row** — `userId` or
   `rep_name`. An orchestrator-placed call has neither and reads "Outbound Call".

## Changed

- `communication-surface.ts` — the two corrections above.
- `src/routes/api/telnyx/dial/+server.ts` — this is the click-to-call route, i.e. the prototype's
  exact scenario, and it recorded the rep as `metadata.placed_by` only. With no relation to follow,
  every rep-placed call read "Outbound Call". It now also sets `user_id`, which the surface's
  `user { name, email }` include resolves to a name.

## The "· Sales" suffix — not implemented, deliberately

The prototype's suffix is a **team**. This schema has no team field: `UserRole` is
`owner | admin | agent`, which is permissions, not a department. The IVR `intentName`
("Sales", "Support") is a genuine routing label but only exists on rows that carried one, so it is
appended when present and omitted otherwise. Inventing a department would be worse than a bare name.

## Verified

`svelte-check` **938 / 224**, unchanged. Tests **27–29 failed** band, 4 environmental skips.

## Not verified

- **Nothing viewed in a browser and no row read back** — the shared Postgres was still refusing
  connections.
- **Existing rows will not show a rep.** They carry `metadata.placed_by` (an id) but no `userId`,
  and no backfill was written. Only calls placed after this change resolve to a name.
- Whether `meta.intentName` is actually present on outbound rep calls was not checked — it is read
  opportunistically, so its absence is silent.

---

# Part 7 — Source showed a bare number; and what the doc did NOT ask for (2026-08-26)

## The bare number

`+15556655443` was showing as the Source. Cause: Part 3 changed the **drawer** to render
`comm.source || comm.channelSource`, before the model spec had been read. Part 5 reverted that
reasoning in the **table** but left the drawer untouched — a half-revert.

The drawer now renders `channelSource` with `channelSourceDetail` beneath, identical to the table,
so a bare number can only ever appear as the detail line. Which is what the spec and the prototype
both say:

> Source is NOT the person — the person is the Profile.

Fixed in `session-summary-drawer.svelte`.

## What the doc did NOT ask for

Two changes made on 2026-08-26 came from the user, not from the spec or the prototype. Recording
which is which so a later reader does not "fix" the code back to the doc by mistake, or assume the
doc justified them.

The prototype's `profileCell()` is unambiguous:

```js
`<span class="mono" …>${pid}</span> <span class="tier t1">T1</span>
 <div class="fade">Identified — name + email/phone</div>`
```

- **`PRF-####` leads the cell.** The person's *name* appears nowhere in it — the column is
  "Profile ID · Who", and the "Who" is the identity-tier descriptor ("Identified — name +
  email/phone"), not the person's literal name. The profile ⓘ reinforces it: "the Profile ID is
  the stable key everything hangs off."
  → **Part 4 put the name on top and demoted `PRF-####` to the sub-line. That was a user request
  and is a deliberate divergence from the prototype.**
- **The tier badge reads `T1` / `T2` / `2B`.**
  → **Part 4 spelled these out as "Tier 1" / "Tier 2" / "Tier 2B". Also a user request, also a
  divergence.**

Neither was reverted — both were asked for explicitly. Flagged, not changed, per the CLAUDE.md rule
about saying which won and why when code and spec disagree.

## Verified

`svelte-check` **938 / 224**, unchanged.

## Not verified

- Still nothing viewed in a browser; the shared Postgres was still refusing connections.

---

# Part 8 — Profile name reverted; identity tier corrected to §4.3a (2026-08-26)

## 1. Name reverted

Part 4 put the person's name above `PRF-####`. Reverted on request to the prototype's
`profileCell()` shape: code, tier badge, then the tier descriptor. ("Tier 1" spelled out is kept —
that was a separate request and was not withdrawn.)

## 2. "Name / company only — person not confirmed" on every row

The screenshot showing this was the **prototype** (`PRF-1009…PRF-1017` is its
`"PRF-"+String(1000+i)`; our codes are hashes — `PRF-GFDW6`). There, that string is hardcoded for
every T2 row. But checking our own code against the spec found two real bugs anyway.

The tier was one expression:

```ts
const tier = customer?.email || customer?.cell ? 'T1' : customer?.name ? 'T2' : 'T2B';
```

**Bug 1 — a phone-only contact fell through to 2B.** No email, no cell, no name → "Anonymous ·
fp_… — device only", for a record holding a phone number. Per the spec, Tier 2B is "**zero
identifiers**"; a phone number is a weak identifier, which is Tier 2. Contacts created from an
inbound SMS land exactly here.

**Bug 2 — every Tier 2 read the same reason.** The descriptor was a constant, so a record with a
phone number and no name still said "Name / company only".

## What §4.3a actually requires (LOCKED 2026-08-05)

> A phone number identifies a **line**, not a person. It only resolves an individual where the line
> is exclusive to one.

| Line type | Tier |
|---|---|
| Mobile | 1 |
| Landline (residential or business), VoIP, toll-free | 2 |
| **Lookup unavailable or failed** | **2 — never default upward** |

So a phone-only contact whose line was never classified being Tier 2 is **correct**. The label was
the lie, not the tier.

## Changed — `communication-surface.ts`

- `identityTier(customer, lineTypes)` replaces the inline expression: email → T1; `cell` → T1;
  `phone` classified `mobile` → T1; any other number → **T2 (not 2B)**; name only → T2; nothing →
  2B.
- `profileWho()` now gives the reason: "Line type unconfirmed — not resolved to one person
  (§4.3a)", or "voip line — shared, not one person (§4.3a)", or the original "Name / company only"
  where there genuinely is no number.
- `loadLineTypes(prisma, logs)` + `lineTypeKey()` — `NumberLookup` (written by
  `number-lookup.ts`) is the authority, and `Contact` has no `lineType` column, so the tier had no
  way to consult it. Now batch-loaded: **one query per page**, matched on the last 10 digits.
- Both loaders pass the map into `communicationSurface`.

## Verified

`svelte-check` **938 / 224**, unchanged. Suite run twice: **27** and **28** failed — the usual band.
(An intervening run showed 30; re-running twice confirmed flake, not a regression.)
`tiers.test.ts` 33/33.

## Not verified

- **Nothing viewed in a browser**, and no row read back — Postgres still refusing connections.
- **No number-lookup backfill.** Existing contacts have no `NumberLookup` row until something
  triggers a lookup, so they stay Tier 2 with "Line type unconfirmed". That is spec-correct but
  means the visible change for existing data is the *wording*, not the tier.
- Nothing in the comm-log path *triggers* a lookup; §4.3a Consequence 1 ("a tier cannot be assigned
  to an inbound call until the line type is known") is still not enforced at intake. Reading the
  cache is not the same as populating it.
- `identityTier` has no unit test of its own.

---

# Part 9 — the Who line has only three strings; dot restored (2026-08-26)

## The reference settles it

The full 31-row reference log shows exactly three "Who" descriptors, and no others:

```
T1   Identified — name + email/phone
T2   Name / company only — person not confirmed
2B   Anonymous · fp_… — device only
```

Part 8 invented a fourth — "Line type unconfirmed — not resolved to one person (§4.3a)". That is
not in the reference, and a spec section number has no business in an operator's log. Reverted to
the three.

**Where the line type actually belongs: the Source detail.** The reference shows it there —

```
Voice IN  Google Business Profile   +1 705 555 0140 · mobile   → PRF-1012 T1
SMS   IN  Inbound SMS               +1 705 555 0155 · mobile   → PRF-1016 T1
```

— qualifying the number, which is exactly what it does. Moved there
(`sourceChannelDetail` now appends `· mobile` / `· voip` when a `NumberLookup` row exists).

## Why a row reads Tier 2

Two separate causes, and only the first was a bug:

1. The wording was wrong (above).
2. The tier itself is **correct**: that contact has a phone number, no email, no `cell`, and no
   `NumberLookup` row. §4.3a says an unclassified line is Tier 2 and must **never default upward**.

The reference's Voice/SMS rows are T1 precisely because their line type IS known to be mobile — the
`· mobile` in their Source detail is the evidence. So the way to make those rows T1 here is to
actually perform the lookup. `number-lookup.ts` can do it; **nothing in the message path calls it**.
That gap is unchanged and is the real remaining work.

The Part 8 `identityTier()` fix stands: a phone-only contact is Tier 2, not Tier 2B. The reference
agrees — 2B is "Anonymous · fp_… — device only", which is not a record holding a phone number.

## Also

Urgency dot uncommented, as asked.

## Verified

`svelte-check` **938 / 224**, unchanged. `tiers.test.ts` 33/33. Full suite across four runs:
**27 / 28 / 29 / 30** failed — all in DB- and AI-dependent suites (`integration-simulation`,
`ivr-webhook`, `sms-extraction`, `behavioral-smoke`, `s1-meeting-confirm`, orchestrator thread
matching). None touch the identity or source helpers. The band is wider than the "28 floor" recorded
in CLAUDE.md and is worth re-baselining.

## Not verified

- **Nothing viewed in a browser**; no DB read (a check was declined, and the shared Postgres had
  been refusing connections before that).
- No `NumberLookup` row exists for any existing contact, so `· mobile` will not appear on real rows
  until lookups are performed.
