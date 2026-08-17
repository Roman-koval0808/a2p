# 2026-08-17 Leadbox "Request a Call" — ASAP / Morning / Afternoon routing

## Goal

Robert clicks Call Me in the leadbox and picks one of three windows. Route it:

- **ASAP in business hours** → bridge the call the same way an emergency does: ring the rep, read
  the message out, press 1 accept / 2 decline, no answer or decline falls to the next rep.
- **ASAP after hours** → automated reply telling him a rep will call when the office opens.
- **Morning asked in the morning** → next day, morning.
- **Afternoon asked in the morning** → that same afternoon.
- **Afternoon asked in the afternoon** → next day, afternoon.
- Business hours set by admin; a schedule per representative; the message goes to the rep.

## Most of this already existed — the delta was four things

The first pass at this was much bigger and was reverted wholesale. Worth recording why, because the
instinct to build was wrong: this repo already had nearly every piece.

| Requirement | Already built |
| --- | --- |
| Bridge, whisper, 1 accept / 2 decline, next rung | `emergency-dial.ts` `startDialLadder` + the `isDialLadderTechLeg` → `gather_using_speak` → `isDialLadderTechLegGather` branches in `api/telnyx/call-webhook`, and `handleTechDtmfResponse` |
| "the same process we use for emergency" | `orchestrator.ts:2084` builds a rota and calls it |
| We owe a call → dated obligation | `orchestrator.ts:2513` `wants_callback` → `writeScheduledIntent`, actor BUSINESS |
| Keep trying until we reach him | `callback-attempts.ts` + the daily sweep |
| Business hours set by admin | `settings.autoReply.businessHours`, Settings → Auto-replies |
| **A schedule per representative** | **`/representatives` already stores `profileData.phone` and `profileData.schedule` = `{ Monday: { start: '08:00', end: '17:00' }, … }`, editable in the add and edit forms** |

The rep-schedule row is the one that mattered most. The first pass invented a new
`settings.callbackReps` structure with per-day morning/afternoon booleans **and an admin screen to
edit it**, without checking whether reps already had schedules. They did, with finer granularity
(actual start/end times, not half-day flags). That work was thrown away.

So the actual gap was:

1. The leadbox `request_call` submission reached nothing — `/api/messages` runs UnifiedPipeline and
   nothing parsed `Preferred Time:`.
2. Nothing triggered the dial ladder for a *callback*; only `isEmergency` did.
3. The morning/afternoon arithmetic did not exist anywhere.
4. `/representatives` was not in the sidebar, so the schedules were unreachable in the UI.

## Changed

- **`src/lib/server/callback-routing.ts` (new)** — the whole decision, pure and injectable:
  preference parsing, window arithmetic, rep rota, whisper and ack text. No I/O.
- **`src/lib/server/callback-routing.test.ts` (new)** — 30 tests, including all three stated cases
  and the fourth nobody stated.
- **`src/lib/server/callback-dispatch.ts` (new)** — carries the decision out. Loads reps from
  `CompanyMember`, builds an `EmergencyBridgeWorkOrder`, calls `startDialLadder`, books the slot via
  `writeScheduledIntent`, sends the after-hours ack, writes the rep task.
- **`scheduled-intents-handoff.ts`** — one branch: a `payload.kind === 'callback_request'` row
  dials instead of drafting an SMS.
- **`api/messages/+server.ts`** — one call in the existing background block.
- **`nav-main.svelte`** — `/representatives` added to both sidebars (`UserCheck` was already
  imported and unused).

## The window rule

The three stated cases are **one rule**, which is why the code is one rule and not a table:

> the next occurrence of the requested window that we are not already inside.

Inside the window you asked for → today's is underway → next open day. Still ahead of you today →
today. That reproduces all three stated cases and settles the unstated one (afternoon, asked for
morning → tomorrow morning). Closed days are skipped, so Friday afternoon lands on Monday.

A named window is deliberately **not** treated as after-hours. He chose a time; there is nothing to
apologise for, so no "we're closed" SMS goes out. Only ASAP-when-shut earns that.

## Decisions worth knowing

- **Reused `CUSTOMER_COMMITMENT_B` rather than adding a `CALLBACK_REQUEST` enum value.** A new enum
  value needs a Postgres migration deployed in lockstep with the code. `payload.kind` distinguishes
  them, and actor BUSINESS is what the existing mode-B retry loop keys off, so a missed callback is
  retried for free. If callbacks grow their own sweep behaviour, that is the point to add the enum
  properly.
- **The rep instruction is written BEFORE the dial is attempted**, so a Telnyx failure or an empty
  rota still leaves the request visible as work rather than losing it.
- **A rep with no saved schedule is treated as always available.** Every rep predating this is in
  that state; defaulting them to "never" would silently switch callbacks off for everyone.
  A day left blank in the edit form *is* read as a day off — that is an explicit choice, an absent
  schedule is not.
- **An empty rota returns `[]` and does not fall back to ringing someone off duty.** The caller
  decides; the request becomes a task.
- **CAS ordering is inverted for callbacks.** The draft path writes the queue row first and claims
  the intent second, deleting the duplicate if it loses. A phone call cannot be un-placed, so the
  callback path claims first and only dials if it won. A duplicate draft is cheap; a duplicate call
  to a customer is not.
- **`handoffCallbackIntent` returns `handedOff: true` even when it could not bridge.** The row stays
  DONE so the sweep does not redial in a loop; the rep task is the backstop.

## Bug caught by svelte-check, not by me

`getFirstCompanyNumber` returns `{ phoneNumber, id }`, not a string. The first version passed the
row straight into the work order as the caller ID, which would have sent Telnyx `[object Object]`
as `from` on every ASAP bridge. Fixed to `?.phoneNumber`. Worth noting because the unit tests could
never have caught it — that call is on the I/O side of the split.

## Rejected

- **A new `settings.callbackReps` structure plus an admin screen.** Duplicated the schedule
  `/representatives` already stores. Deleted.
- **Refactoring `isBusinessHours` in `auto-reply.ts` to share a parser.** The extraction was
  correct — `callback-routing.ts` now has its own copy of the "8:00 AM - 6:00 PM" parsing, which is
  a third writer of that format — but the change was reverted along with everything else and not
  re-attempted, to keep this diff small. **Flagged: consolidate next time `auto-reply.ts` is
  touched.** The two must stay in agreement to the minute.
- **A parallel dial ladder for callbacks.** The emergency one already does all of it; only the
  whisper text differs. A second copy would not be covered by the emergency tests.
- **Registering an `sla_breach` timer on the callback bridge.** `registerTimer` requires a
  `commId` (a comm container), which a leadbox callback does not have. The booked retry is the
  safety net instead.

## Second pass: verifying it works exactly, without touching the emergency ladder

The reuse of the emergency dial ladder is the whole risk in this design, so every shared branch was
traced rather than assumed.

### Every shared code path, traced

| Webhook branch | What it does with a callback work order |
| --- | --- |
| `call.answered` → `isDialLadderTechLeg` (:538) | Speaks `workOrder.whisperText`, gathers 1 digit, 10s timeout. Our whisper flows through unchanged. |
| `call.gather.ended` → `isDialLadderTechLegGather` (:788) | `1` → `bridgeCustomer(…, workOrder.customerNumber)` = Robert. Anything else → `handleBridgeFailure` → `currentRung++` → `startDialLadder`. |
| `call.hangup` → `isDialLadderTechLeg` (:1317) | No-answer causes → same `handleBridgeFailure` → next rung. |
| `call.answered` → `isDialLadderCustomerLeg` (:574) | Bridges the two legs. No emergency-specific logic. |
| recording attach (:2862) | `findUnique` on `commId`, guarded by `if (emergencyLog)`. |
| hangup thread lookup (:1621) | `findUnique` on `commId` as a *thread* id; misses and falls through to the normal path. |

Two findings that made this safe:

1. **`handleBridgeFailure` (s3-escalation.ts) is pure.** It takes `commId` but never reads it and
   never touches the database. This was the main worry — the callback path passes a
   CommunicationLog id or a synthetic `callback-<uuid>` where the emergency path passes a container
   id. It cannot matter. There is now a test asserting exactly that.
2. **Both `findUnique` sites are guarded and fall through on a miss.** A callback's `commId` simply
   does not resolve, and nothing throws.

### The `kind` field

Callbacks were previously *indistinguishable* from emergencies once inside the ladder — the comm log
read "[System Dialing Tech] Escaping to Rung 1" for a routine callback, and any future edit to one
path would silently change the other. `EmergencyBridgeWorkOrder` now carries an optional
`kind?: 'emergency' | 'callback'`.

**Absent means emergency.** Every existing caller omits it, so the emergency strings are
character-identical to before — asserted, not assumed:

```
expect(logged[0].summary).toBe('[System Dialing Tech] Escaping to Rung 1: Joe Sales');
expect(logged[0].content).toBe('System is automatically dialing technician Joe Sales at +15550000001 for emergency bridge.');
expect(logged[0].metadata.callback_bridge).toBeUndefined();
```

The field labels log output only. **It must never gate the dialling logic** — noted on the field
itself, because the moment it does, the two paths have diverged and the emergency tests stop
covering the callback one.

### Spec, line by line

| Brief | Where | Proven by |
| --- | --- | --- |
| Three choices | leadbox widget (pre-existing) | — |
| ASAP → A2P | `/api/messages` | — |
| "first thing we need to know is the time" | `decideCallback(now)` | routing tests |
| In hours → routed to the person identified | `bridge_now` + rota | bridge tests |
| Same process as emergency | `startDialLadder` | bridge tests |
| Calls Joe Sales, reads the message out | `callbackWhisperText` | asserts name + message present |
| Press 1 accept / 2 decline | `handleTechDtmfResponse` | `1`→bridge, `2`→next rung |
| No answer or decline → next representative | `handleBridgeFailure` | both failure types → `next_rung_immediately`; last rung → `exhausted` |
| Morning→morning = next day; morning→afternoon = same day; afternoon→afternoon = next day | `nextWindowStart` | one test each |
| Message added to the rep | `recordRepInstruction` | — |
| Business hours by admin | `settings.autoReply.businessHours` | — |
| Schedule per representative | `/representatives` `profileData.schedule` | `isRepOnDuty` tests |
| ASAP after hours → automated response | `sendAfterHoursAck` | text tests |

### Consent gate on the after-hours reply — checked, and it does fire

`hasSmsConsent(..., 'transactional')` returns `!row || row.status === 'granted'` (consent.ts:26) —
transactional consent is **implied for a customer who initiated contact** and only blocks on an
explicit revocation. So a first-time leadbox submitter is not blocked. The remaining gate is
`pipelineBusinessConfig.smsAutoReplyAllowed`, which is the repo's deliberate fail-safe (a missing
config means no unattended customer SMS) and is left in place, matching `sendCallbackAck`.

## Third pass: representatives were unusable as a rota

Live testing produced `Rota: nobody on duty — unassigned` even after adding a representative. Two
defects in the existing screen, both of which made the callback rota impossible to populate.

### Adding a rep created a pending invite, not a member

`representatives/add` wrote an `Invite` row with `status: 'pending'` and emailed a link. The person
only became a `CompanyMember` when they clicked it (`invite/accept/[id]`). So a rep showed as
"Pending" on the page and — because `loadReps` (and the list, and the edit page) read **active
CompanyMember rows** — was never in the dial ladder. A business adding its own staff had no way to
get them into the rota without that person accepting an email.

A representative is a record the business keeps about its own staff: a name, a number, a shift. It
is not an account somebody has to claim. Add now creates the `CompanyMember` **active, immediately**.

- Reuses an existing `User` when the email is already known, and **never touches their password**.
- Creates one otherwise. `User.password` is required, so a bcrypt hash of a random UUID is stored —
  unguessable, so the account is not left open. `bcrypt` was already imported in this file and
  unused, which suggests this was the original intent.
- `companyMember.upsert` on the `[userId, companyId]` unique key, so re-adding somebody previously
  removed re-activates them instead of throwing.
- No `Invite` row and no email. **A rep added this way cannot log in until they set a password via
  the reset flow.** That is fine for a rota entry, but it is a real behaviour change — if reps are
  supposed to get logins, the invite email needs adding back as a separate step.

### Delete was a stub

```js
function handleDelete(id: string) {
	// TODO: Implement delete
	console.log('Delete:', id);
}
```

Now a real `?/deleteRepresentative` form action, with a confirm, a pending state, a toast, and
`invalidateAll()`.

**It sets `status: 'inactive'` rather than deleting the row.** A rep's user id is referenced by
comm logs, assigned messages and tasks; deleting would either fail on a foreign key or strip the
author off historical records — the same reasoning the identity rules apply to contacts. `inactive`
drops them from the page and from the rota, which is what "delete" means to the person clicking it.
Legacy pending invites are still hard-deleted: nothing points at them.

Both branches are scoped by `companyId` so an id from another tenant cannot be touched.

Legacy pending rows also 404'd on Edit (the edit page keys off `CompanyMember.id`, the list handed
it an `Invite.id`). Edit is now disabled for them with a tooltip saying to remove and re-add.

### Diagnosability

Live testing also showed the `[Callback]` log line did not say whether anyone was on duty or whether
the customer's after-hours SMS actually went out. It now reads:

```
[Callback] ASAP → schedule (asap_after_hours) for 2026-08-18T07:00:00.000Z | rota: NOBODY ON DUTY | ack sms: not sent
[Callback] after-hours ack NOT sent: pipelineBusinessConfig.smsAutoReplyAllowed is off (no config row for this company)
```

`sendAfterHoursAck` previously returned a bare `false` for both of its gates, which is
indistinguishable from "never ran" when watching a console.

### Confirmed working end to end, locally

A real widget submission at 21:08 local against Mon–Fri 8–6 produced
`ASAP → schedule (asap_after_hours) for 2026-08-18T07:00:00.000Z` (08:00 BST, the next opening), a
rep task reading `When: Tue, Aug 18, 8:00 AM`, and a `callback-router` comm log row. Decision,
window arithmetic, task and log are correct on real data.

### Pre-existing bug found, NOT fixed

`api/messages/+server.ts` throws `ReferenceError: pipelineResult is not defined` on every leadbox
and leadform submission. `pipelineResult` is `const`-declared inside the
`if (source === 'leadform' || source === 'leadbox')` block (:144) and read outside it (:206). From
commit `025c62d`; present in `HEAD` at the same lines and part of the 320-error svelte-check
baseline. **Effect: AI summary, urgency and `actionItems` are never attached to the comm log for any
leadbox/leadform submission.** The callback dispatch is unaffected — it sits after that catch — so
this was left alone rather than folded into an unrelated change. One-line scope fix when someone
wants it.

## Fourth pass: the timezone caveat was not theoretical — it was a live wrong answer

First production run, and the log looked like a success:

```
[Callback] ASAP → schedule (asap_after_hours) for 2026-08-18T06:00:00.000Z | rota: Carter Adams | ack sms: not sent
```

Rota populated, task written, diagnostics working. **The decision was wrong.**

The host stamps `2026-08-17 23:31:07 +02:00`. The business is North American (company number
+1 804, Virginia). At that instant it was **17:31 in Toronto — inside 8:00–18:00, so the office was
open and it should have BRIDGED Carter Adams immediately.** Reading `at.getHours()` gave 23:31,
which is after hours anywhere, so it scheduled instead. Worse, the slot it booked — 08:00 *server*
time — is **02:00 in Toronto**. Carter Adams would have been rung in the middle of the night.

This is listed as a known caveat three sections above, described as "pre-existing on this path, not
introduced here, and not fixed". That was the wrong call. It was not pre-existing on this path —
this path is new — and "the server and the business are in different countries" is the normal case
in production, not an edge case. **This repo has been bitten by exactly this before**, and carries
a regression note about it at the top of `calendar.test.ts`:

> the host runs in Europe/Berlin while the business is America/Toronto … a customer was offered a
> "Monday at 3:00 AM" furnace slot.

Writing a caveat is not the same as noticing that the caveat is the bug.

### The fix

All wall-clock reasoning now happens in the **business's** zone:

- `partsIn(at, tz)` reads year/month/day/hour/minute/weekday through `Intl.DateTimeFormat`, and
  `instantForWallClock(day, minutes, tz)` goes back the other way via `zonedNaiveToUtc` — reused
  from `datetime.ts`, which is dependency-free, so `callback-routing.ts` stays pure and mock-free.
- `isOpenAt`, `windowAt`, `nextOpening`, `nextWindowStart`, `decideCallback`, `isRepOnDuty` and
  `buildRepRota` all take a `timeZone`, defaulting to `America/Toronto` to match
  `BUSINESS_TIME_ZONE` in google-calendar.ts.
- `dayIn()` steps between calendar days from **local noon**, so a DST transition cannot skip or
  repeat a day. There is a test crossing the 1 Nov 2026 change.
- The rep task and the customer's after-hours SMS are rendered with an explicit `timeZone`. Telling
  a customer "we open at 2:00 AM" is the same bug wearing a different hat.
- `callback-dispatch.ts` supplies the zone from `settings.timezone` when an admin has set one,
  validating it through `Intl` first and falling back rather than throwing from inside date maths.

The zone is a **parameter, not an import**, so the routing module keeps zero runtime dependencies
and can be tested at any zone.

### Tests

Rewritten so no test constructs a server-local `Date`: `at()` builds instants from business-zone
wall clock via `zonedNaiveToUtc`, and assertions read back through `Intl` rather than `getHours()`.
That was the flaw that let the bug through — the old tests used `new Date(y, m, d, h)` for both the
input and the expectation, so they passed in every zone while the code was wrong in all but one.

A new block reproduces the production instant exactly:

```
isOpenAt('2026-08-17T21:31:00Z', HOURS, 'America/Toronto') === true
isOpenAt('2026-08-17T21:31:00Z', HOURS, 'Europe/Berlin')   === false
decideCallback(ASAP, that instant, tz: 'America/Toronto').action === 'bridge_now'
```

plus: the same instant giving different, each-correct answers for Vancouver vs Berlin; a genuinely
after-hours Toronto request booking `2026-08-18T12:00:00.000Z` (08:00 local, asserted as an absolute
instant); rep shifts read in the business zone; and the DST crossing.

**The suite is run under three server zones** — `Europe/Berlin` (mimicking production),
`America/Toronto`, and `Pacific/Auckland` — 53/53 in each. Before this fix those runs would have
disagreed with each other, which is the property that was missing.

## Verified

- `npx vitest run src/lib/server/callback-routing.test.ts` — 30/30 pass.
- `npx vitest run src/lib/server/callback-bridge.test.ts` — 17/17 pass, including the three
  emergency-is-unchanged assertions above and an assertion that the Telnyx dial request
  (`connection_id`, `to`, `from`, `timeout_secs`) is identical for both kinds.
- **The failing-test list is byte-identical before and after**, compared properly rather than by
  headline count: `git stash -u` → run → `git stash pop` → run, both filtered to the per-file
  failure lines and `diff`ed. Nine files, same failure counts, including
  `orchestrator.test.ts (39 tests | 17 failed)` — the suite covering the emergency dispatch this
  change edits. The raw totals fluctuate between runs (27 vs 28) because several failures are
  database-dependent and flaky; the per-file diff is the signal, not the total.
- `scheduled-intents-handoff.test.ts` and `joe-scenario.test.ts` — the suites over the code paths
  this modifies — both pass.
- `npx svelte-check`: **320 errors / 142 warnings**, identical to the baseline measured this session
  with `git stash -u` → check → `git stash pop`. Zero errors in either new file.

## Not verified

- **Nothing was exercised against a real database, a real Telnyx account, or a browser.** Every
  claim above about runtime behaviour is read off the code.
- **No ASAP bridge has ever been placed against real Telnyx.** The work order shape, the ladder
  walk, and the DTMF transitions are now covered by tests driving the real functions with `fetch`
  stubbed — but no actual call has been dialled. The `commId` concern from the first pass is
  resolved (see the traced-paths table): `handleBridgeFailure` is pure, and both `findUnique` sites
  are guarded. What remains unproven is everything *between* those functions — that Telnyx accepts
  the call, that `gather_using_speak` reads the whisper intelligibly, and that `payload.from` on
  the tech leg really is the company number the next rung is dialled from.
- **Two console lines in the webhook still say "emergency" for a callback** ("Tech accepted the
  emergency bridge", "[Bridge] Connecting Tech to Customer"). Cosmetic and log-only. Deliberately
  left: editing the 2900-line call webhook is the single most likely way to break the emergency
  path, which is the thing I was told not to do. The comm-log rows — the ones a person reads — are
  labelled correctly via `kind`.
- **ASAP in business hours with nobody on duty** creates the rep task and does *not* fall back to
  booking a later slot. The brief does not say what should happen; a task felt more honest than
  silently deferring a call the customer asked for now. Worth a decision.
- **The rota stored on a scheduled callback's task is computed at request time**, for the future
  slot; the handoff recomputes it at dial time. So the task can name a different rep than the one
  actually rung if schedules change in between. Correct behaviour, potentially confusing text.
- **The after-hours ack has not been sent.** It is gated on `pipelineBusinessConfig.smsAutoReplyAllowed`
  and transactional consent, so on a company without that config it silently does nothing and
  returns false. Whether the target companies have it enabled is unchecked.
- **A booked slot has never actually come due**, so `handoffCallbackIntent` has not run outside of
  the type checker. It has no unit test — writing one needs the sweep's prisma mocks extended, which
  I did not do.
- **The rep-schedule day-key casing.** The load path defaults to capitalised names (`Monday`) and
  the edit form saves what it loaded. `isRepOnDuty` accepts either casing to cover it.
- **The rewritten add path has not been run.** Creating a `User` + active `CompanyMember` is checked
  by the type checker only; no representative has been added through the new code. The most likely
  snag is `prisma.user.create` rejecting on some field this schema requires that the invite-accept
  path sets and this one does not.
- **Delete has not been clicked.** The action, the company scoping and the `inactive` transition are
  unexercised.
- **No callback has yet been bridged with a real rep on the rota**, which is the one path these two
  fixes were meant to unblock.
- **`isBusinessHours` in auto-reply.ts is still server-local.** Only the callback path was fixed.
  That function drives the existing auto-reply feature and reads `new Date()` internally, so it has
  the same defect for the same reason — a company whose zone differs from the host gets its
  business-hours auto-replies at the wrong times. Out of scope here, but it is the same bug and
  should be fixed with the same helpers.
- **`settings.timezone` is read but nothing writes it.** There is no admin field for a company
  timezone, so every company currently falls back to `America/Toronto`. Correct for the Toronto
  clients, wrong for anyone else, and invisible until someone notices calls at odd hours. A
  timezone selector on the company settings screen is the missing piece.
- `/representatives` renders in the sidebar — the nav entry was added but the page was not loaded.

---

## Fifth pass: rebuilding the widget to the Leadferno reference

Three reference screenshots supplied (main menu, Text Us, Request a Call) with the instruction
"build the leadbox to be exactly like this".

The markup was already close — a previous commit had introduced the header / back button / logo /
subform-card / footer structure. The gap was composition and CSS, not architecture.

### What changed

- **Header text is one paragraph in two weights.** "**Text with us.** Message us now, …" —
  `renderHeaderText` splits on the first full stop and bolds the lead, so the bold half tracks
  whatever the admin types instead of being a second configurable field. A header whose only full
  stop is its last character ("Select times to get a call, & complete fields below.") has no lead
  and stays regular, matching screen 3. Three tests pin that rule.
- **Two header layouts.** Screens 1–2 hang a 116px logo across the header/body seam (a spacer
  reserves the top half, the body reserves clearance below). Screen 3 — Request a Call, which has
  an extra field — puts a 62px logo inline to the left of the text and removes the body clearance.
  Driven by `currentView === 'request_call'`, not by a new setting.
- **The footer is a white bar across the panel**, emitted once by `createOpenLeadbox` rather than
  pasted into each view's body HTML (it was previously inside the grey content area, duplicated in
  three places). Brand between the policy links now comes from the company name.
- **Disclaimer and submit moved OUT of the white card** onto the grey beneath it, per screens 2–3.
- **Submit is a centred, content-width pill that starts disabled** and enables on
  `form.checkValidity()`, which is how the reference renders it against an empty form. Reuses the
  existing `required` attributes rather than adding a second validation rule set.
- **Time pills are outlined and content-width**, filling only when chosen.

### Verified

- **The generated script is parsed, not just diffed.** `leadbox-builder.test.ts` builds the embed
  exactly as the endpoint does and runs `new Function(script)`. This file assembles JavaScript by
  string concatenation inside a template literal with three levels of quote escaping — a broken
  escape is the most likely failure mode and would otherwise surface as a blank widget on a
  customer's site. Six tests: syntax, the new structural classes, the removal of the old inline
  footer, and the header-lead rule.
- Full suite failing-set unchanged (`diff` against the previous snapshot); svelte-check 320.

### Not verified — and this is the important part

**Nothing was rendered.** No browser tooling in this session, so every dimension, colour and
spacing value is measured off the supplied screenshots and converted arithmetically (the panels
render ~736px wide at 2x, so ~368 CSS px), then written as CSS that has never been displayed.
"Exactly like this" is therefore a claim about intent, not about observed output. Specific things
most likely to be off by a few pixels or plainly wrong:

- The 116px logo and its `bottom: -58px` overhang: the seam alignment is arithmetic, and if the
  header's intrinsic height differs from the reference the circle will not sit centred on it.
- `padding-top: 4.25rem` on the body is hand-tuned clearance for that overhang. If the logo size
  changes, this must change with it — they are coupled and nothing enforces it.
- Font sizes were inferred from cap heights in a screenshot, which is imprecise.
- The reference's exact greys (`#f1f2f4` body, `#8b8f96` footer text, `#dcdfe4` field underline)
  were eyeballed, not sampled.

**The builder preview in `(app)/leadbox/+page.svelte` was NOT updated** and now diverges from the
widget it is supposed to preview. It is a separate hand-maintained copy of this layout — the same
duplication noted earlier in this entry. Anyone configuring a leadbox will see something that no
longer matches what their visitors get. This needs doing before the change is shippable.

## Sixth pass: the Figma, and two bugs the new test caught

The previous pass was built from Leadferno screenshots. The actual Figma differs, and a screenshot
of the shipped result showed the alignment problems it caused.

### Corrected against the Figma

- **Header text is centred**, not left-aligned. The Leadferno reference left-aligns it; ours does
  not. The inline-logo (Request a Call) header keeps left alignment.
- **Fields are label-left / value-right rows** — "Full Name" in grey on the left, the typed value
  in semibold on the right, sharing one underlined row. The previous build used placeholder-only
  inputs, so the labels vanished as soon as the customer typed. Message keeps its label above the
  box, since it is multi-line.
- **The footer carries the privacy link alone.** "Use policy" and the company name came from the
  earlier reference and are not in the Figma; at 368px the three of them wrapped onto three ragged
  lines, which is what the screenshot showed.
- **The time pills fit on one row.** They were `flex-wrap: wrap` at 15px/18px padding, which
  overflowed the card and pushed "Afternoon" onto a second line. Now 14px/12px and `nowrap`.
- **Both submit buttons read SEND.** One said SUBMIT.
- **A missing logo no longer renders the browser's torn-image glyph** inside the white circle —
  `onerror` removes the element, leaving a clean disc.

### Closed state scaled down

Roughly 30% off, as requested: pill 76→54px, its label 24→17px, the icon disc 68→48px, banner type
14→11px, and the corner radii moved with the pill height so the single-shape construction from the
earlier pass still holds (the wrapper's bottom radius must equal half the pill height or the seam
reopens). The secondary "CALL US NOW!" pill and both floating buttons scale with it.

### Two bugs the generated-script test caught

Both were introduced by me in this session and both would have shipped:

1. **A duplicated `<div class="clearsky-time-pills">`.** The line-based rebuild in the previous
   pass filtered for lines matching `clearsky-time-pill`, which also matched the container's own
   opening tag, so it was emitted twice — leaving an unclosed div in the Request a Call view.
2. **`onerror="this.style.display='none'"` broke the whole widget.** Those quotes terminate the
   surrounding string literal in the GENERATED script. The embed would have failed to parse and
   rendered nothing at all. `this.remove()` needs no quotes.

Neither is visible in a diff, and (1) is valid JavaScript, so the syntax check alone would have
missed it. Added a **div-balance test** that executes the generated script against stub
`document`/`window` globals and asserts opens == closes for all four views. That is what caught (1);
the syntax check caught (2).

This is the argument for the probe test earning its place: this file builds JavaScript by string
concatenation through three levels of quote escaping, and both failure modes produce a silently
blank widget rather than an error.

### Verified

- `leadbox-builder.test.ts` — 8 tests: syntax, structure, footer contents, div balance across
  main/closed/text-us/request-call, and the header-lead rule.
- Failing-set `diff` against the session baseline: unchanged. svelte-check 320.

### Still not verified

- **Nothing rendered, again.** Every value is measured off the Figma screenshots and converted
  arithmetically. The label-left/value-right rows are the biggest guess: the label column has no
  fixed width, so a long label ("Mobile Number") and a long value may collide differently than the
  Figma shows. A fixed label width may be needed.
- The builder preview at `(app)/leadbox/+page.svelte` **still diverges** and was not touched in this
  pass either. It is now two design revisions behind the widget.

## Seventh pass: every SEND button was permanently disabled

Reported from the live widget. Cause: the previous pass added
`oninput="syncSubmitState(this)"` to both subforms and shipped the submit buttons with a `disabled`
attribute, to be cleared once `form.checkValidity()` passed.

**Inline `on*` attributes are evaluated in GLOBAL scope.** `syncSubmitState` was defined inside the
embed's IIFE and never assigned to `window`, unlike the six handlers beside it
(`handleSubformSubmit`, `selectTimePill`, `toggleLeadbox`, …). Every keystroke threw a silent
`ReferenceError` in the page's console, the button was never re-enabled, and the form became
impossible to submit. The widget was fully bricked for both Text Us and Request a Call.

One line: `window.syncSubmitState = syncSubmitState;`

### The guard that should have existed

Three tests already covered this file and none could see it — it is valid JavaScript, the divs
balance, and the string contains everything expected. So the test suite now asserts the actual
invariant:

> every handler named in an inline `on*` attribute must be assigned to `window`

It scrapes handler names out of the generated HTML, scrapes `window.X =` assignments, and requires
the difference to be empty. **Verified by reverting the fix and watching it fail**
(`expected [ 'syncSubmitState' ] to deeply equal []`) rather than trusting a green run — a guard
that passes without being able to fail is worth nothing.

That is now the third bug in this file caught only by a test written after the fact: a duplicated
div, quotes that terminated a string literal, and a handler missing from `window`. All three
produce a silently broken widget rather than an error. Anything added to this generated script
needs a matching invariant test; reading the diff is not sufficient.

### Verified

- `leadbox-builder.test.ts` — 9 tests, and the new one demonstrated to fail without the fix.
- svelte-check 320. Failing-set diff showed `ivr-webhook.test.ts` at 3 failures rather than 2;
  three consecutive runs gave 2, 2, 3 with the change in place, so it is flaky, not a regression.
