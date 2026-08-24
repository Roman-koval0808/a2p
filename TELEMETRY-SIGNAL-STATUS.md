# Telemetry — 24-hour work log and signal wiring status

Covers **2026-08-19 21:26 → 2026-08-20 20:53**: 21 commits across two repos (17 in `a2p`, 4 in
`clearsky-website`), then a census of all 102 catalog signals showing which ones something actually
emits.

Per-session reasoning, rejected approaches and "not verified" lists live in the `history/` entries
linked below. This file is the summary and the reference table.

---

## Before the three fixes — the foundation (18 commits)

The last three commits are the fixes described in detail below. They sit on top of roughly a day of
groundwork, which is what made the defects reachable in the first place.

**2026-08-19 evening — ViewRoom telemetry foundation** (9 commits,
[a](history/2026-08-19-viewroom-telemetry-signals.md) ·
[b](history/2026-08-19-viewroom-cross-session-tracking.md) ·
[c](history/2026-08-19-viewroom-comm-log-signal.md) ·
[d](history/2026-08-19-viewroom-comm-log-rename-fix.md))

The deterministic signal catalog, the attribution/batching client and the intake route were built,
under an explicit hard rule recorded at the time: **"never use profiledb, its abandoned, use
lead-grabber-v1."** ViewRoom joins and name submissions were then tracked, representatives excluded,
`tenantSlug` resolution fixed, and a stale call site (`triggerTelemetryNotification` →
`notifyTelemetry`) repaired — that rename is why comm logs had been silently empty. Finally a
`viewroom` communication type was threaded through the telemetry and orchestrator pipelines.

**2026-08-20 daytime — wiring the real surfaces** (9 commits,
[e](history/2026-08-20-signal-tracking-wiring.md) ·
[f](history/2026-08-20-2-viewroom-session-merge-fingerprints.md))

The marketing site got its own telemetry client, attribution module and tracker; signals were wired
into the site and the viewroom; fingerprints were persisted on contacts and surfaced in profile
debug details; canvas/CDN fingerprinting was replaced with a deterministic local FNV-1a hash after
it broke identity on Firefox; and both embed widgets were given fingerprint resolution. The room
page was also fixed to stop stripping `?fp=` from the URL, which had prevented site and viewroom
sessions from merging.

Everything below this point is the three defects found when that wiring was finally exercised
end-to-end.

---

## Part 1 — Embed signals never left the browser

**Symptom.** Site and viewroom signals landed. Every leadbox and leadform signal
(`callback_*`, `lg_*`, `form_*`) did not, despite the widgets logging `signal fired` for each one.

**Cause.** The embeds posted with `navigator.sendBeacon(url, new Blob([body], {type:'application/json'}))`.

- `sendBeacon` forces the request's credentials mode to `include` — not configurable.
- `application/json` is not a CORS-safelisted content type, so the beacon becomes a real CORS
  request with a preflight rather than a `no-cors` send.
- A *credentialed* preflight can never be satisfied by `Access-Control-Allow-Origin: *`, which is
  what the intake returns.

Chrome dropped every embed beacon before it left the browser. **`sendBeacon()` returns `true` even
when the request is dropped this way**, which is why the console log appeared while nothing was
sent. The marketing-site client never hit this because it uses `fetch(keepalive)`, whose credentials
mode defaults to `same-origin`.

Measured in a browser, same origin pair, same endpoint:

| Transport | Reached the database |
|---|---|
| `sendBeacon` + `application/json` (what the embeds used) | **No** — blocked at preflight |
| `sendBeacon` + `text/plain` | Yes (safelisted → `no-cors`, no preflight) |
| `fetch` + `keepalive` + `application/json` | Yes |

**Fix.** Both builders now use `fetch(..., {keepalive:true})`. `keepalive` survives page unload just
as a beacon does. A `sendBeacon` fallback remains for browsers without `fetch`, with a `text/plain`
body so it stays a simple request.

**Second defect, same area.** `upsertSessionCommLog` read `communicationLog.metadata.signals`,
appended, and wrote back. Two batches for the same visitor arriving together both read the
pre-existing array and the second clobbered the first — the signal stayed in `pipeline_events` but
vanished from the comm log, which is what the sales inbox and summary panel actually read. Fired 8
concurrent signals for one visitor: **3 of 8 survived**. Now serialised with
`pg_advisory_xact_lock` keyed on the visitor thread: 8 of 8. Verified by reverting only that file,
re-running, and restoring.

Files: `src/lib/embed/leadbox-builder.ts`, `src/lib/embed/leadform-builder.ts`,
`src/lib/server/telemetry/intake.ts`.

---

## Part 2 — A submit forked a second profile

**Cause.** Narrower than "submits create a new profile", and it points at a different file than you
would expect. `resolveProfile` *did* return the fingerprint's profile — it wrote only `displayName`
and **silently dropped the phone and email**. The profile stayed unreachable by phone, so the next
phone-keyed touch matched nothing and forked a second record. The split surfaced one step *after*
the submit that caused it:

```
1. anonymous page_load (fingerprint F)  -> profile P
2. submit with name + phone + F         -> profile P   (same — already worked)
3. later touch keyed by that phone      -> NEW profile
```

Underneath that, the embeds **never sent identity at all** — their batches carried only
tenant/session/fingerprint/signals, and their `/api/messages` submit carried no fingerprint, so the
Contact side forked too.

This is a spec requirement, identity-tiers §4.3: *"a 2B or 2 promoting to Tier 1 keeps its
fingerprint, session ID, and full history; the identifier is layered on top."*

**Fix.** Promotion in place. Blanks are filled, never overwritten — overwriting a known phone with a
newer submission is how one person's record absorbs another's. Added `followMerges` so a lookup
landing on a tombstone resolves to the survivor, with the `mergedInto: null` guard in the query's
`WHERE`. Embeds gained `identify()`, called *before* the submit signal fires so the submit batch
itself carries the identity. All four `/api/messages` payloads now send the fingerprint, and the
route passes it to `createOrUpdateContact` — which already had fingerprint matching and was simply
never given the value.

**Deliberately not merged.** When a fingerprint profile and a phone/email profile both pre-exist,
they are *not* auto-fused: a device can be shared, and `merge-service.ts` is explicit that identity
resolution raises candidates for a human rather than auto-merging. The exclusive identifier wins the
lookup, both records stay live, and a merge candidate is raised.

Files: `src/lib/server/telemetry/intake.ts`, both embed builders,
`src/routes/api/messages/+server.ts`.

---

## Part 3 — Profiles page showed `0 /100` and `unclassified`

**Score.** Telemetry wrote the score to `PipelineCustomerProfile.attributes.engagementScore`; the
page reads `Contact.engagementScore`. Different tables, nothing copying across. Confirmed on live
data: a contact sat at `engagementScore = 0` while their comm log carried `scoreLive = 60`.
`Contact.engagementScore` had four existing writers (orchestrator, command-registry, track/click,
track/open) and telemetry was not one of them.

**Bucket.** Never wired into this pipeline at all. Three reference layers exist and none were
connected:

1. **Spec** — `ClearSky_Section5_Four_Intent_Buckets_Report__1_.md` §3.5: Research 9–34 ·
   Comparison 35–49 · Active 50–74 · Emergency = signal override at any score.
2. **Reference site** — `total-trades-solutions-site 2`, where every call is
   `firePixel(event, label, delta, bkt)` — a bucket per signal for all 98. It is a local HUD that
   only `console.log`s; a specification by example, not an integration.
3. **App** — `profiledb/eventRegistry.ts` holds `bucketSignal` per event and
   `scoring.service.ts` has `getNextBucket()`, an escalate-only ladder that deliberately never
   consults the score.

The gaps: `SIGNAL_CATALOG` had **no bucket field at all**; intake never called `getNextBucket`;
`intentBucket` lives on `CustomerProfile` in the **separate profiledb**; and the page hardcoded
`emergency | unclassified`. So `unclassified` was not a bug in what was built — nothing could have
set it.

**Fix.** Added `bucketSignal` to all 102 signals. `resolveContact` hoisted into the main path so the
score does not depend on `COMM_LOG_MODE` ('off' has always meant "no comm-log rows", never "stop
scoring"). Both writes are done in SQL rather than read-modify-write, for the same reason Part 1
needed a lock: `applyContactScore` uses `LEAST(100, GREATEST(0, ... + delta))`, and
`applyContactBucket` does the ladder comparison in the `WHERE` with `array_position`, so a row is
only ever overwritten by a strictly higher bucket.

**No `scoreDelta` changed** — verified mechanically against HEAD: 102 signals, zero delta changes,
none lost.

### How the bucket mapping was derived

- The site's bucket is **page-context dependent, not a property of the signal** (`page_load` carries
  all five buckets across the site). Where the site disagrees with itself the **lowest-priority**
  value is used: promotion is escalate-only and self-corrects upward, whereas over-classifying is
  sticky — no downgrade in-session, and Emergency never demotes at all.
- `page_load` is **deliberately untagged** so it cannot promote. Its delta is 0 and a bounce must
  stay `unclassified` rather than being promoted by merely loading a page.
- `callback_open` / `callback_form_open` / `callback_submit` are mapped **`active`, not
  `emergency`** — a deliberate deviation. Those three fire on only two pages of the entire reference
  site (`rightflush-emergency.html`, `rightflush-burst-pipe-flooding.html`), so their `emergency`
  tag belongs to *those pages*, not to "a visitor requested a callback". On the ClearSky marketing
  site the leadbox "REQUEST A CALL" is a sales callback on ordinary pages; tagging it `emergency`
  would put every such visitor on a 15-minute A2P SLA in a bucket that never demotes.
  `hero_call_click` and `cta_call_click` deviated for the same reason.
- Only **two** signals map to `emergency` — `nav_emergency` and `emergency_cta`. The site tags even
  `emg_call` ("Emergency band: call") as `active`.
- Where the app's own `eventRegistry` already had an opinion it wins: three signals realigned
  (`dwell_60`, `dwell_120` → `comparison`; `form_submit` → `conversion`). The other seven
  overlapping signals already agreed.

**Result.** A real leadbox submit now renders **55/100, bucket `active`** where it produced
`0/100, unclassified` before.

Files: `src/lib/telemetry/signals.ts`, `src/lib/server/telemetry/intake.ts`,
`src/routes/(app)/profiles/+page.server.ts`.

---

## Commits — all 21 in the window

`a2p` is on `all-signals-fix`, `clearsky-website` on `main`. Both in sync with their remotes,
nothing unpushed.

| SHA | Time | Repo | What |
|---|---|---|---|
| `20e3483` | 08-19 21:26 | a2p | Cross-session identity tracking; guest room entry + name submission events |
| `60cae71` | 08-19 21:31 | a2p | Native fingerprint auto-generation, URL parameters |
| `c453f34` | 08-19 21:37 | a2p | Tutorial background images |
| `991cea1` | 08-19 21:53 | a2p | Room join + name submission telemetry for all user types |
| `4ded675` | 08-19 21:59 | a2p | Stop tracking representatives in room view / name submission |
| `c80baa4` | 08-19 22:13 | a2p | `tenantSlug` resolution: owner and user company fields, with fallback |
| `e5c9a60` | 08-19 22:32 | a2p | Rename `triggerTelemetryNotification` → `notifyTelemetry`, log via Prisma |
| `2996b7b` | 08-19 22:52 | a2p | Fix the `notifyTelemetry` call site (naming + argument order) |
| `f90db72` | 08-19 23:24 | a2p | `viewroom` communication type through telemetry + orchestrator |
| `06ac4f1` | 08-20 15:56 | a2p | Client-side telemetry: signal batching and intake tracking |
| `6a9e7f9` | 08-20 16:40 | a2p | Fingerprint retrieval, ignore demo dir, rename `vr_entry` |
| `7c9dc30` | 08-20 17:23 | website | Visitor telemetry + attribution, cross-origin session tracking |
| `108fdb4` | 08-20 17:50 | a2p | Persist fingerprints on contacts; show in profile debug details |
| `d7cff48` | 08-20 17:50 | website | Environment-aware URL resolution for leadbox |
| `789484e` | 08-20 19:00 | a2p | CDN-free local fingerprinting (cross-session, Firefox) |
| `075e329` | 08-20 19:00 | website | FNV-1a fingerprint hash, localStorage fallback |
| `a98f034` | 08-20 19:43 | a2p | Persistent fingerprinting in leadbox and leadform widgets |
| `f19ee06` | 08-20 19:43 | website | Dynamic leadform script URL for local dev |
| `cb935a5` | 08-20 20:04 | a2p | **Part 1** — embed telemetry CORS failure + comm-log race |
| `2848f88` | 08-20 20:46 | a2p | **Part 2** — cross-session profile merging and identity stitching |
| `34db76b` | 08-20 20:53 | a2p | **Part 3** — bucket/score persistence, profiles page reads stored bucket |

Net churn across the window: **a2p** 35 files, +2,727 / −64 · **clearsky-website** 10 files,
+647 / −10.

Only untracked file is this document.

---

## Verification and what is not covered

**Verified.** All 8 embed signals reach `pipeline_events` and the comm log; `callback_open` +
`callback_form_open` and `lg_submit` + `form_submit` each arrive as one batch; leadbox and leadform
signals for one fingerprint fold into a single visitor thread. Identity: one profile, one contact,
one thread across anonymous → submit → phone-keyed → email-keyed → anonymous-again. Bucket ladder
climbs correctly and the no-downgrade rule holds. Score accumulates in step with telemetry, 8
concurrent batches sum to exactly 97 with no lost updates, and caps at 100.

**Baselines unchanged throughout**: `npx vitest run` 28 failed / 752 passed;
`svelte-check` 938 errors / 223 warnings. (CLAUDE.md's "~330 svelte-check errors" is stale — the
clean tree reports 938 too.)

**Not covered.** No automated test asserts any of this — every fix was verified by browser runs and
throwaway scripts against the live dev intake, and the 102 bucket values are hand-derived with
nothing asserting them. Nothing was run against production. Firefox and Safari were not tested. The
profiles page itself was never rendered in a browser (it needs a login) — the data layer it reads
was verified instead. Existing contacts are **not backfilled**: everyone already in the database
keeps `0 /100` and `unclassified` until their next signal.

---

## Signal status — 25 of 102 wired

A signal is **Wired** if some emitter fires it, **Dormant** if it exists only as a catalog
definition. The intake accepts all 102 today and scores and buckets them correctly the moment
something fires them — the gap is entirely on the emitting side.

| Emitter | Wired |
|---|---:|
| Marketing site tracker (`clearsky-website/src/lib/telemetry/tracker.js`) | 13 |
| Leadbox / leadform embeds (`a2p/src/lib/embed/*-builder.ts`) | 9 |
| ViewRoom (`a2p` room pages and components) | 4 |
| **Total** (`form_phone_focus` fires from both site and embed) | **25** |

Fully uninstrumented categories: FotoJobber (14), Visualizer (9), Blog question boxes (6), FAQ (5),
Before/after & financing (3), Chat (3), Reviews (2).

*Δ is the score delta. Bucket is the `bucketSignal` added in Part 3 — what the signal argues for,
escalate-only; it never downgrades a visitor.*

### Passive — 8/8 wired

| Signal | Δ | Bucket | Status | Emitted by |
|---|---:|---|---|---|
| `page_load` | 0 | _(none)_ | **Wired** | Marketing site |
| `scroll_25` | 3 | research | **Wired** | Marketing site |
| `scroll_50` | 5 | research | **Wired** | Marketing site |
| `scroll_75` | 7 | comparison | **Wired** | Marketing site |
| `scroll_90` | 10 | comparison | **Wired** | Marketing site |
| `dwell_30` | 4 | research | **Wired** | Marketing site |
| `dwell_60` | 7 | comparison | **Wired** | Marketing site |
| `dwell_120` | 10 | comparison | **Wired** | Marketing site |

### Navigation & interest — 3/17 wired

| Signal | Δ | Bucket | Status | Emitted by |
|---|---:|---|---|---|
| `nav_book` | 12 | active | Dormant | — |
| `nav_emergency` | 15 | emergency | Dormant | — |
| `svc_click` | 8 | active | **Wired** | Marketing site |
| `svc_hover` | 4 | research | Dormant | — |
| `tool_click` | 8 | research | Dormant | — |
| `hero_cta_click` | 12 | active | **Wired** | Marketing site |
| `hero_services_click` | 8 | research | **Wired** | Marketing site |
| `related_click` | 6 | active | Dormant | — |
| `problem_click` | 10 | research | Dormant | — |
| `area_click` | 6 | research | Dormant | — |
| `area_card_click` | 8 | comparison | Dormant | — |
| `mkt_cta_click` | 8 | research | Dormant | — |
| `persona_pick` | 10 | research | Dormant | — |
| `gallery_filter` | 6 | research | Dormant | — |
| `blog_filter` | 4 | research | Dormant | — |
| `blog_post_open` | 8 | research | Dormant | — |
| `review_filter` | 6 | research | Dormant | — |

### Call & emergency — 4/14 wired

| Signal | Δ | Bucket | Status | Emitted by |
|---|---:|---|---|---|
| `hero_call` | 15 | active | Dormant | — |
| `hero_call_click` | 15 | active | Dormant | — |
| `cta_call` | 15 | active | **Wired** | Marketing site |
| `cta_call_click` | 15 | active | Dormant | — |
| `emergency_cta` | 20 | emergency | Dormant | — |
| `emg_call` | 20 | active | Dormant | — |
| `emg_type_click` | 18 | active | Dormant | — |
| `call_click_hero` | 15 | active | Dormant | — |
| `call_click_sidebar` | 15 | active | Dormant | — |
| `sidebar_call` | 15 | active | Dormant | — |
| `notsure_call` | 12 | active | Dormant | — |
| `callback_open` | 15 | active | **Wired** | Leadbox/leadform |
| `callback_form_open` | 15 | active | **Wired** | Leadbox/leadform |
| `callback_submit` | 25 | active | **Wired** | Leadbox/leadform |

### Lead & form — 6/13 wired

| Signal | Δ | Bucket | Status | Emitted by |
|---|---:|---|---|---|
| `lg_open` | 8 | active | **Wired** | Leadbox/leadform |
| `lg_submit` | 15 | active | **Wired** | Leadbox/leadform |
| `form_name_focus` | 6 | active | **Wired** | Leadbox/leadform |
| `form_email_focus` | 8 | active | **Wired** | Leadbox/leadform |
| `form_phone_focus` | 10 | active | **Wired** | Leadbox/leadform + Marketing site |
| `form_submit` | 20 | conversion | **Wired** | Leadbox/leadform |
| `apt_name_focus` | 6 | active | Dormant | — |
| `apt_phone_focus` | 10 | active | Dormant | — |
| `apt_service_select` | 10 | active | Dormant | — |
| `apt_submit` | 25 | active | Dormant | — |
| `cta_book` | 15 | active | Dormant | — |
| `spl_claim_click` | 10 | active | Dormant | — |
| `spl_apt_submit` | 25 | active | Dormant | — |

### FotoJobber — 0/14 wired

| Signal | Δ | Bucket | Status | Emitted by |
|---|---:|---|---|---|
| `fj_name_focus` | 6 | active | Dormant | — |
| `fj_phone_focus` | 10 | active | Dormant | — |
| `fj_note_focus` | 4 | active | Dormant | — |
| `fj_service_select` | 10 | active | Dormant | — |
| `fj_photo` | 8 | active | Dormant | — |
| `fj_photo_click` | 8 | active | Dormant | — |
| `fj_photo_upload` | 12 | active | Dormant | — |
| `fj_submit` | 25 | active | Dormant | — |
| `fj_voice_start` | 8 | active | Dormant | — |
| `fj_voice_stop` | 8 | active | Dormant | — |
| `fj_voice_transcribed` | 12 | active | Dormant | — |
| `fj_annotation_saved` | 10 | active | Dormant | — |
| `fj_access_granted` | 6 | active | Dormant | — |
| `fj_access_denied` | 6 | active | Dormant | — |

### Visualizer — 0/9 wired

| Signal | Δ | Bucket | Status | Emitted by |
|---|---:|---|---|---|
| `viz_fixture_select` | 8 | comparison | Dormant | — |
| `viz_style_select` | 8 | comparison | Dormant | — |
| `viz_transform` | 8 | active | Dormant | — |
| `viz_result` | 10 | active | Dormant | — |
| `viz_result_save` | 12 | active | Dormant | — |
| `viz_save_open` | 6 | active | Dormant | — |
| `viz_save_skip` | 6 | active | Dormant | — |
| `viz_photo_upload` | 12 | active | Dormant | — |
| `design_style_pick` | 8 | active | Dormant | — |

### ViewRoom — 4/8 wired

| Signal | Δ | Bucket | Status | Emitted by |
|---|---:|---|---|---|
| `vr_entry` | 10 | active | **Wired** | ViewRoom (a2p) |
| `vr_name_focus` | 6 | comparison | **Wired** | ViewRoom (a2p) |
| `vr_phone_focus` | 10 | active | Dormant | — |
| `vr_interest_select` | 10 | comparison | Dormant | — |
| `vr_guestname` | 8 | comparison | **Wired** | ViewRoom (a2p) |
| `vr_repinvite` | 12 | comparison | **Wired** | ViewRoom (a2p) |
| `vr_tasks` | 8 | comparison | Dormant | — |
| `vr_video_watch` | 6 | comparison | Dormant | — |

### Before/after & financing — 0/3 wired

| Signal | Δ | Bucket | Status | Emitted by |
|---|---:|---|---|---|
| `ba_slider_drag` | 6 | comparison | Dormant | — |
| `fin_plan_view` | 10 | comparison | Dormant | — |
| `financing_guide_download` | 12 | comparison | Dormant | — |

### Chat — 0/3 wired

| Signal | Δ | Bucket | Status | Emitted by |
|---|---:|---|---|---|
| `chat_open` | 8 | research | Dormant | — |
| `chat_question` | 12 | research | Dormant | — |
| `chat_q` | 12 | comparison | Dormant | — |

### FAQ — 0/5 wired

| Signal | Δ | Bucket | Status | Emitted by |
|---|---:|---|---|---|
| `faq_expand` | 4 | research | Dormant | — |
| `faq_search` | 6 | research | Dormant | — |
| `faq_click` | 6 | research | Dormant | — |
| `faq_question_submit` | 10 | research | Dormant | — |
| `faq_still_focus` | 6 | research | Dormant | — |

### Blog & question boxes — 0/6 wired

| Signal | Δ | Bucket | Status | Emitted by |
|---|---:|---|---|---|
| `blog_q_focus` | 6 | research | Dormant | — |
| `blog_question_submit` | 10 | research | Dormant | — |
| `post_q_focus` | 6 | research | Dormant | — |
| `post_question_submit` | 10 | research | Dormant | — |
| `sidebar_q_focus` | 6 | research | Dormant | — |
| `sidebar_question_submit` | 10 | research | Dormant | — |

### Reviews — 0/2 wired

| Signal | Δ | Bucket | Status | Emitted by |
|---|---:|---|---|---|
| `write_review` | 15 | comparison | Dormant | — |
| `write_review_nav` | 8 | comparison | Dormant | — |
---

## Gaps found while auditing, not fixed

**The intake discards every signal payload.** The catalog declares deterministic fields —
`guestName`, `videoId`, `repId`, `roomId`, `interest`, `task`, `service` — and the emitters send
them, but `intake.ts` never persists `payload`. The stored event records only signal, category,
delta, session, fingerprint and attribution; there are zero references to `payload` in the file.
Everything past the signal name is dropped. This directly blocks the ViewRoom requirement to capture
guest names, videos watched and rep invites.

**No signal exists for ViewRoom AI questions.** It is one of the five things ViewRoom is supposed to
capture. The nearest, `vr_tasks`, is a task payload and is itself dormant. This needs adding to the
catalog, not just wiring.

**`vr_video_watch` is missing from the circulated signal list.** That list names 7 ViewRoom signals
under a heading of 8; the eighth is `vr_video_watch` — the "videos watched" the same note asks for.
Every other name on that list matches the catalog exactly, and the catalog holds nothing the list
omits besides this one.

**Emergency will almost never fire from telemetry.** The reference site derives Emergency mostly
from *which page* a visitor is on, and the catalog has no page dimension. Only `nav_emergency` and
`emergency_cta` can promote to it, and both are dormant. The orchestrator's `message_category`
override remains the only live emergency path.

**Part 3 imports from `profiledb/`, which the team has declared abandoned.** The 2026-08-19 entry
records the hard rule *"never use profiledb, its abandoned, use lead-grabber-v1."* `intake.ts` now
does `import { getNextBucket } from '$lib/server/profiledb/scoring.service'`. That module is pure —
zero imports, zero Prisma references, no contact with the abandoned database — so the rule is not
being broken in substance. But it puts a live intake path behind a directory slated for deletion: if
`profiledb/` goes, the intake fails at import. Moving the ladder into
`$lib/server/telemetry/` would remove the dependency; it is a small copy of one function and its
`BUCKET_ORDER` array.

**Whether `callback_*` should be `emergency` after all** is a per-vertical product decision. For a
plumbing tenant the reference site says yes; for ClearSky's own marketing site it would put every
"Request a Call" visitor on a 15-minute SLA in a bucket that never demotes. It is currently
`active` — a one-word change in `signals.ts`. The catalog has no per-tenant dimension, which is the
deeper issue.
