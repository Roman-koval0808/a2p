# 2026-08-20 (3) — leadbox/leadform signals never reached the pipeline

## Goal

> "When a visitor interacts with the ClearSky leadbox widget (REQUEST A CALL flow) and the leadform
> widget (contact page), the signals `callback_open`, `callback_form_open`, `callback_submit` and
> `lg_open`, `lg_submit`, `form_submit`, `form_name_focus`, `form_email_focus`, `form_phone_focus`
> must land in the a2p telemetry pipeline and appear in the visitor's comm log / AI summary, same as
> site and viewroom signals which DO land."

The wiring was already in place from the previous session (commit `a98f034`) and still nothing
arrived. Site signals (`page_load`, `scroll_*`, `dwell_*`, `vr_*`) landed fine throughout.

## Root causes

Two independent bugs, both silent. Either one alone hides the signal.

### 1. `navigator.sendBeacon` + `application/json` is a credentialed cross-origin preflight

The embed builders posted with `navigator.sendBeacon(url, new Blob([body], {type:'application/json'}))`.

- `sendBeacon` forces the request's credentials mode to **`include`** — this is not optional and
  not configurable.
- `application/json` is **not** a CORS-safelisted content type, so the beacon becomes a real CORS
  request with a preflight rather than a `no-cors` send.
- A *credentialed* preflight can never be satisfied by `Access-Control-Allow-Origin: *`, which is
  what `src/routes/api/v1/telemetry/signals/+server.ts` returns.

Chrome therefore dropped every embed beacon before it left the browser, with
`net::ERR_FAILED` and:

> Response to preflight request doesn't pass access control check: the value of the
> 'Access-Control-Allow-Origin' header in the response must not be the wildcard '*' when the
> request's credentials mode is 'include'.

**`sendBeacon()` returns `true` even when the request is dropped this way.** That is why the widget
logged `[clearsky-telemetry] signal fired` for every signal while nothing was ever sent — the log
line proved the code ran, not that the request left the machine.

The marketing-site client (`clearsky-website/src/lib/telemetry/client.js`) never hit this because
it uses `fetch(..., {keepalive:true})`, whose credentials mode defaults to `same-origin`. That is
the whole reason site signals landed and embed signals did not, from identical-looking code.

Isolated in a browser against the live dev servers, same origin pair, same endpoint:

| transport | reached `pipeline_events` |
|---|---|
| `sendBeacon` + `application/json` Blob | **no** — blocked at preflight |
| `sendBeacon` + `text/plain` Blob | yes (safelisted → `no-cors`, no preflight) |
| `fetch` + `keepalive` + `application/json` | yes |

### 2. Lost update in the comm-log read-modify-write

`upsertSessionCommLog` in `src/lib/server/telemetry/intake.ts` read
`communicationLog.metadata.signals`, appended the incoming names, and wrote the array back. Two
batches for the same visitor arriving together both read the pre-existing array, and the second
write clobbered the first.

This is what the issue writeup called the "consecutive sendBeacon drop" and attributed to a browser
race. It is not a browser race and not specific to beacons — it is server-side, and it discards the
signal *after* it has been accepted. The signal stays in `pipeline_events`, so an intake-level check
says "accepted", while the comm log — which is what the sales inbox and the summary panel actually
read — silently loses it.

Measured directly, 8 signals fired as concurrent single-signal batches for one fingerprint:

- before the fix: 8 in `pipeline_events`, **3** in the comm log (5 lost)
- after the fix: 8 in `pipeline_events`, **8** in the comm log

## Changed

- **`src/lib/embed/leadbox-builder.ts`**, **`src/lib/embed/leadform-builder.ts`** — transport swapped
  to `fetch(..., {keepalive:true})`, matching the site client that was already proven to work against
  this endpoint. `keepalive` survives page unload just as a beacon does, so nothing is lost by
  dropping `sendBeacon` as the primary path. A `sendBeacon` fallback remains for browsers without
  `fetch`, but with a **`text/plain`** body so it stays a simple request and is actually delivered.
  The reasoning is written into the comment above the call — this is exactly the kind of thing that
  gets "cleaned up" back to `sendBeacon(json)` by someone who assumes beacons are strictly better.
- **`src/lib/embed/leadform-builder.ts`** — gained the `trackSignals()` batching helper the leadbox
  already had, and `lg_submit` + `form_submit` now go out in one request instead of two. Fewer
  concurrent batches per visitor is a real reduction in exposure to bug 2, independent of the lock.
- **`src/lib/server/telemetry/intake.ts`** — the thread upsert and comm-log read-modify-write moved
  inside a transaction guarded by `pg_advisory_xact_lock(hashtext(threadId))`. The lock is per
  visitor thread and released on commit, so unrelated visitors never contend.

No changes were needed in `clearsky-website`. The hardcoded production `leadform` src described in
the writeup had already been fixed to be environment-aware before this session; both `+layout.svelte`
and `contact/+page.svelte` resolve to `localhost:3005` in dev, and I confirmed the served scripts
carry `baseUrl = "http://localhost:3005/"` and the correct `companyId`.

## Verified

Driven through real Chrome (Playwright, `channel: 'chrome'`) against the running dev servers on
`:5173` and `:3005`, then read back from the database.

- All 8 embed signals reach `pipeline_events` **and** appear in the visitor's comm-log `content`:
  `callback_open`, `callback_form_open`, `callback_submit`, `lg_open`, `lg_submit`, `form_submit`,
  `form_name_focus`, `form_email_focus`, `form_phone_focus`.
- `callback_open` + `callback_form_open` arrive as **one** batched request (identical timestamps),
  as do `lg_submit` + `form_submit`.
- Leadbox and leadform signals for the same fingerprint fold into a single visitor thread —
  e.g. `vt_finalt1vty77`: `page load → callback open → callback form open → callback submit →
  lg open → page load → form email focus → form phone focus → lg submit → form submit`.
- No CORS errors in the console on any run after the change.
- Bug 2 was verified by reverting only `intake.ts`, re-running the concurrency test (5 of 8 lost),
  and restoring — the fix is necessary, not just correlated.
- **Baseline unchanged**: `npx vitest run` from `apps/lead-grabber-v1` → 28 failed / 752 passed
  (73 files), matching the documented baseline. `svelte-check` → 938 errors / 223 warnings, and I
  confirmed by stashing all three changed files and re-running that the clean tree reports the
  identical 938/223. None of the three files produce any svelte-check output.

## Rejected

- **Reflecting `Origin` and adding `Access-Control-Allow-Credentials: true`** to the intake so that
  `sendBeacon(json)` would work as written. It fixes the symptom, but it widens an unauthenticated
  public write endpoint to accept credentialed cross-origin requests from any origin, to buy nothing
  — the endpoint uses no cookies. Fixing the client transport costs less and gives up nothing.
- **Switching the embeds to `sendBeacon` with a `text/plain` body as the primary path.** It does
  work (verified in the table above), but it is fire-and-forget: no status, no failure signal. Using
  `fetch(keepalive)` means the embeds now take the same path as the site client, so there is one
  transport to reason about rather than two.
- **Dropping `sendBeacon` entirely.** Kept as a `fetch`-absent fallback only. Costs three lines.

## Not verified

- **Production.** Everything here was exercised against `localhost:5173` → `localhost:3005`. The fix
  is transport-level and origin-independent, so it should hold for `a2p.viewroom.ca`, but no
  production request was made. `PUBLIC_BASE_URL` must be correct in the production env for the
  embeds to post anywhere at all — that is unchanged behaviour and was not re-checked.
- **Firefox and Safari.** The writeup raised Firefox ETP as a possible factor. All browser
  verification here was Chrome. The CORS rule broken by bug 1 is spec-mandated, so Firefox was
  certainly dropping these beacons too, but I did not confirm the fix in Firefox, and I did not
  investigate whether ETP independently blocks anything in this path.
- **The `?t=1786992490061` cache-buster** hardcoded on the leadbox `<script src>` in
  `clearsky-website/src/routes/+layout.svelte` (the leadform uses `Date.now()`). The embed routes
  send `Cache-Control: no-store`, so this did not cause the bug and I left it alone — but a fixed
  URL on a cached script is a latent trap if those headers ever change.
- **One unexplained observation.** On the first run of the session the homepage leadbox script
  failed with `net::ERR_EMPTY_RESPONSE` and the widget did not render at all; it loaded normally on
  every subsequent run. Most likely a dev-server cold-compile hiccup, but I did not reproduce it or
  rule out a real intermittent failure in `/embed/leadbox/[id]`.
- **No automated test covers any of this.** Both fixes are verified by manual browser runs and
  direct DB reads, not by anything in `vitest`. The concurrency test for bug 2 was a throwaway
  script; it is not in the suite, so nothing stops the lock being removed.
- The single real-browser `callback_open` that landed at 18:28:45 before this session (profile
  `cmt1utewg001l5c1tpydf35bk`) is still unexplained. Under bug 1 it should have been blocked like
  every other embed beacon. I did not chase it.

## Open decisions

- The comm-log lock addresses concurrent batches for one visitor thread. `page_load` arriving from
  the site client while an embed batch is in flight is now serialised, but the two clients still
  hold **separate** session ids for one fingerprint, so a visitor's thread interleaves signals from
  two sessions. That is existing behaviour and looks intentional (the fingerprint is the grouping
  key, per `upsertSessionCommLog`), but it is worth a human confirming it is what the sales inbox
  should show.
- The `svelte-check` baseline in `CLAUDE.md` says ~330 errors; the tree reports 938 both with and
  without this session's changes. The documented number is stale and should be updated so the next
  agent's comparison means something.

---

# Part 2 — a submit must promote the fingerprint's profile, not fork a new one

## Goal

> "before we send anything from the leadbox or leadform it checks fingerprints and merges profiles,
> so it uses that same profile but just updates their name or phone etc with what they submitted
> from the leadbox/leadform. currently it uses a new profile for submits"

## Root cause

The symptom is real but the mechanism is narrower than "submits create a new profile", and getting
it wrong sends you to the wrong file. Reproduced against the running intake:

1. anonymous `page_load` with fingerprint `F` → profile `P` created
2. submit carrying identity **+ the same `F`** → resolved to **`P`** (correct!) and adopted the name
3. later touch keyed by that phone → **new profile** ✗

So `resolveProfile` already returned the fingerprint's profile — it just wrote **only
`displayName`** onto it and silently dropped the phone and email. `P` stayed unreachable by phone,
so the next phone-keyed touch matched nothing and forked a second record. The split surfaced one
step *after* the submit that caused it.

On top of that, in practice step 2 never even happened: **the embeds never sent identity at all.**
Their telemetry batches carried only `tenantSlug`/`sessionId`/`fingerprintId`/`signals`, and their
`/api/messages` submit carried no fingerprint — so the Contact side matched on phone/email only and
forked there too. Two independent halves of the same bug.

This is a spec requirement, not a preference — identity-tiers §4.3:

> Fingerprint + session ID are the identity thread for Tier 1, 2, and 2B … They are never discarded
> on upgrade: a 2B or 2 promoting to Tier 1 keeps its fingerprint, session ID, and full history;
> **the identifier is layered on top.**

## Changed

- **`src/lib/server/telemetry/intake.ts`** — `resolveProfile` rewritten to layer identity onto the
  record the fingerprint already resolved (promotion in place), and to return an unresolved
  `conflict` alongside the profile. Blanks are filled, never overwritten: a profile has one
  canonical name/phone/email, and clobbering a known value with a newer form submission is exactly
  how one person's record absorbs another's. Added `followMerges` so a lookup landing on a
  tombstone resolves to the survivor. The `mergedInto: null` guard is in the fingerprint query's
  `WHERE`, not an `if` above it.
- **`src/lib/embed/leadbox-builder.ts`**, **`src/lib/embed/leadform-builder.ts`** — gained
  `identity` + `identify()`, mirroring the site client, and every batch now carries
  `name`/`email`/`phone`. `identify()` is called **before** the submit signal fires, so the submit
  batch itself carries the identity rather than the batch after it. All four `/api/messages`
  payloads (leadbox subform, leadbox main form, leadbox channel-click, leadform) now include
  `fingerprint: resolveFingerprint()`.
- **`src/routes/api/messages/+server.ts`** — reads `body.fingerprint` and passes it to
  `createOrUpdateContact`, which already had fingerprint matching (Priority 3) and
  `persistFingerprint` — it was simply never given the value. The contact is now also resolved when
  a fingerprint is the *only* thing known, so an anonymous channel-click attaches to the visitor's
  existing contact instead of nothing.

## Rejected

- **Auto-merging the two profiles when a fingerprint profile and a phone/email profile both exist.**
  `merge-service.ts` is explicit that identity resolution never merges on its own — a device can be
  shared, and a bad auto-merge silently fuses two customers' histories irreversibly. The exclusive
  identifier wins the lookup, both records stay live, and `recordMergeCandidate` raises the pair for
  a human. `recordMergeCandidate` swallows its own errors by design, so candidate bookkeeping cannot
  break ingest.
- **Reusing `mergeProfiles()` from merge-service for the promotion path.** Promotion is not a merge —
  there is only ever one record involved. Calling a merge here would have created a tombstone for a
  profile that never existed separately.
- **Raising the merge candidate inside the ingest transaction.** It uses the global `prisma` client
  on its own connection; doing it inside would extend the transaction and risk it failing the ingest
  that noticed the pair. It runs after commit.
- **Setting a `status` on promotion** (e.g. `unknown` → identified). No consumer of
  `PipelineCustomerProfile.status` exists in `src/`, and the only value written anywhere is
  `'merged'`. Inventing a tier value without a reader is speculative; left alone deliberately.

## Verified

Against the running intake, then read back from the database.

- The original 3-step repro now holds one record throughout: anonymous → submit → **phone-keyed
  touch → same profile** → email-keyed touch → same profile → anonymous-again → same profile.
  One `pipeline_customer_profile`, not two.
- **Conflict case** (a phone profile and a *separate* fingerprint profile both pre-exist, then a
  submit arrives carrying both): resolves to the phone profile, the fingerprint profile stays live
  and untouched (not merged, not deleted), and a `ProfileMergeCandidate` is raised `status=pending`.
- **Adoption case**: a profile identified by phone with no fingerprint adopts the device thread on
  the next batch, and a later anonymous fingerprint-only touch then lands on it.
- **Tombstone case**: a phone lookup landing on a `mergedInto` tombstone resolves to the survivor.
- **Full browser run** (Chrome, real leadbox REQUEST A CALL submit then leadform submit on
  `/contact`, same `?fp=`): the anonymous profile created at `page_load` ends with the submitted
  name, phone *and* email; the Contact matched by fingerprint carries the same three; and there is
  exactly **1** pipeline profile, **1** contact and **1** visitor thread for that person.
  `/api/messages` was observed sending the fingerprint on both submits.
- **Baseline unchanged**: vitest 28 failed / 752 passed; `svelte-check` 938 errors / 223 warnings.
  The three `api/messages` lines svelte-check reports are pre-existing (`destination: null`,
  `contact_company`) and shifted down by the three lines I added — the total is identical.

## Not verified

- **No automated test covers any of this.** The promotion, conflict, adoption and tombstone cases
  were each verified by throwaway scripts against the live dev intake, not by anything in `vitest`.
  `resolveProfile` is now the most consequential function in the file and has no spec test — this is
  the single biggest gap left, and `merge-service.test.ts` shows the pattern to follow.
- **Concurrency of the promotion itself.** Two simultaneous first-time submits carrying the same new
  phone could both pass the "no profile holds this phone" check and race on the
  `(companyId, phoneNumber)` unique. The comm-log advisory lock from Part 1 does not cover this — it
  is taken later and keyed on the thread, not the phone. I did not reproduce it and there is no
  retry/catch on `P2002` in the promotion path.
- **The `handleFormSubmit` (legacy `#clearsky-form`) path** got `identify()` and a fingerprint but
  fires no telemetry signal of its own, so its identity only reaches the intake if some *other*
  signal follows in the same session. I did not exercise that form in a browser at all.
- **Channel-click contacts.** Passing a fingerprint means `handleChannelClick` can now create a
  contact for a visitor who has given no name/phone/email, where previously it created none. That is
  intended, but I did not check what the sales inbox looks like with anonymous fingerprint-only
  contacts in it.
- Nothing here was run against production, and no existing production data was migrated — profiles
  already split by this bug stay split until someone merges them.

## Open decisions

- **Split profiles already in the database.** The fix is forward-only. Existing duplicate pairs
  (anonymous-with-fingerprint + identified-by-phone, same person) are not detected retroactively —
  no backfill raises merge candidates for them. Someone should decide whether to run one.
- **Fingerprint conflicts are now raised as merge candidates**, so if two people genuinely share a
  device the candidate queue will collect pairs that a human must dismiss. If that queue is not
  actually being worked, this change makes noise rather than value — worth confirming before it
  ships.

---

# Part 3 — score and intent bucket on the profiles page

## Goal

> "in profiles page `0 /100` is score, those signals should add up to the scores"
> "but intent bucket is also unclassified, is there any reference for those signals we implemented
> and how they affect intent bucket? check the app and total-trades-solutions-site 2"

## Root causes

Two separate disconnections, both "the value was written somewhere the page doesn't read".

### Score — written to a different table

Telemetry writes the engagement score to `PipelineCustomerProfile.attributes.engagementScore`. The
profiles page reads `Contact.engagementScore` — a different table. Nothing ever copied one to the
other, so a visitor whose score came entirely from telemetry showed `0 /100` no matter how many
signals they fired. Confirmed on live data: contact "Davis Mcmahon" sat at `engagementScore = 0`
while their comm log carried `scoreLive = 60`.

`Contact.engagementScore` has four existing writers — `orchestrator.ts:650`,
`orchestrator/command-registry.ts:218`, `api/track/click`, `api/track/open` — and telemetry was
simply not one of them.

### Intent bucket — never wired into this pipeline at all

There are **three** reference layers for buckets, and none of them were connected to the telemetry
path:

1. **Spec** — `ClearSky_Section5_Four_Intent_Buckets_Report__1_.md` §3.5: Research 9–34 ·
   Comparison 35–49 · Active Project 50–74 · Emergency = signal override at any score. §4.1 is the
   no-downgrade rule within a session.
2. **Reference site** — `total-trades-solutions-site 2` (`_SIGNAL-INVENTORY.md`, 98 signals). Every
   call is `firePixel(event, label, delta, bkt)`, so the site carries a bucket per signal, for all
   nine of the signals we wired. It is a local HUD though — it keeps `_score`/`_bucket` in page
   variables and only `console.log`s them. It is a specification by example, not an integration.
3. **App** — `profiledb/eventRegistry.ts` holds `bucketSignal` per event and
   `profiledb/scoring.service.ts` has `getNextBucket()`, an escalate-only ladder that deliberately
   never consults the score ("getNextBucket must read the event's own bucketSignal and climb the
   fixed ladder — never recompute from a score band", developer brief P1.3).

The gaps: `SIGNAL_CATALOG` had **no bucket field at all**; `intake.ts` never called `getNextBucket`
or touched `intentBucket`; `intentBucket` lives on `CustomerProfile` in the **separate profiledb
database** while telemetry writes the main DB; and only 11 of the catalog's 102 signals exist in
`eventRegistry` (of our nine, only `form_submit`). The profiles page hardcoded
`emergency | unclassified` — its own comment says the real CDP bucket "is not stored in this
database". So `unclassified` was not a bug in what we built; the bucket dimension was never wired
in, and nothing we implemented could have set it.

## Changed

- **`src/lib/telemetry/signals.ts`** — added `BucketSignal` type and a `bucketSignal` field, and
  populated all 102 entries. **No `scoreDelta` changed** (verified mechanically against HEAD: 102
  signals, zero delta changes, none lost).
- **`src/lib/server/telemetry/intake.ts`** — `resolveContact` hoisted out of `upsertSessionCommLog`
  into the main path, because the score must not depend on `COMM_LOG_MODE` ('off' has always meant
  "no comm-log rows", never "stop scoring"). Added `applyContactScore` and `applyContactBucket`.
- **`src/routes/(app)/profiles/+page.server.ts`** — reads the stored bucket instead of hardcoding
  `unclassified`. The orchestrator's emergency classification still overrides at any score (§3.1).

Both writes are done in SQL rather than read-modify-write, for the same reason Part 1 needed a lock:
`applyContactScore` uses `LEAST(100, GREATEST(0, COALESCE(...) + delta))`, and `applyContactBucket`
does the ladder comparison in the `WHERE` with `array_position`, so a row is only ever overwritten
by a strictly higher bucket. Two batches landing together cannot demote each other.

## How the bucket mapping was derived

Extracted every `firePixel(...)` call from the reference site (115 distinct signal/bucket pairs),
then:

- **The site's bucket is page-context dependent, not a property of the signal.** `page_load` is
  tagged with all five buckets across the site; `dwell_30` with three. A static table in the catalog
  cannot reproduce that, so where the site disagrees with itself the **lowest-priority** value is
  used: promotion is escalate-only and self-corrects upward, whereas over-classifying is sticky
  (no downgrade in-session, and Emergency never demotes at all).
- **`page_load` is deliberately left untagged** so it cannot promote. Its delta is 0 and a bounce
  must stay `unclassified` rather than being promoted to `research` by merely loading a page.
- **`callback_open` / `callback_form_open` / `callback_submit` are mapped `active`, not `emergency`,
  and this is a deliberate deviation from a naive reading of the site.** Those three fire on only
  two pages in the entire site — `rightflush-emergency.html` and `rightflush-burst-pipe-flooding.html`
  — so their `emergency` tag belongs to *those pages*, not to "a visitor requested a callback". On
  the ClearSky marketing site the leadbox "REQUEST A CALL" is a sales callback on ordinary pages;
  tagging it `emergency` would put every such visitor on a 15-minute A2P SLA in a bucket that never
  demotes. `hero_call_click` and `cta_call_click` were deviated for the same reason.
- Only **two** signals map to `emergency` — `nav_emergency` and `emergency_cta` — the two the site
  tags unambiguously. Note the site tags even `emg_call` ("Emergency band: call") as `active`.
- Where the app's own `eventRegistry` already had an opinion it wins over my derivation: three
  signals were realigned to it (`dwell_60`, `dwell_120` → `comparison`; `form_submit` →
  `conversion`). The other seven overlapping signals already agreed.

Final distribution: 53 active · 29 research · 17 comparison · 2 emergency · 1 untagged.

## Verified

- **Ladder, against the running intake**: bare `page_load` leaves the visitor `unclassified`;
  `scroll_25` → research; `svc_click` → active; `nav_emergency` → emergency.
- **No-downgrade**: after reaching `active`, firing `scroll_25` and `dwell_30` (both research)
  leaves the bucket at `active`.
- **Score**: accumulates in step with the telemetry score (3 → 7 → 22 across three signals); 8
  concurrent batches for one visitor sum to exactly 97 with no lost updates; 180 points of signal
  caps at 100.
- **Full browser run** (real leadbox REQUEST A CALL submit): the visitor the page renders now shows
  name "Bucket Verify", **55/100**, bucket **active**, from
  `page_load → callback_open → callback_form_open → callback_submit`. Before this change the same
  flow produced `0/100` and `unclassified`.
- **Baseline unchanged**: vitest 28 failed / 752 passed (three consecutive runs);
  `svelte-check` 938 errors / 223 warnings; none of the three changed files produce any
  svelte-check output.

## Rejected

- **Wiring the main pipeline into profiledb** so `CustomerProfile.intentBucket` becomes the real
  source of truth. Architecturally the "right" answer and what the page's original comment implies,
  but it is a cross-database change with an identity-mapping and migration problem attached. Raised
  with the user, who chose the contained option.
- **Aligning our score deltas to the reference site.** Five of the nine disagree (`callback_open`
  15 vs 12, `callback_submit` 25 vs 20, `form_name_focus` 6 vs 8, `form_email_focus` 8 vs 12,
  `form_phone_focus` 10 vs 12). Deltas are a locked product decision and changing them shifts every
  existing visitor's score. Raised with the user, who chose to leave them.
- **Deriving the bucket from the score band** (e.g. `score >= 50 → active`). Explicitly forbidden by
  the developer brief P1.3 and by `getNextBucket`'s own contract. The page had already been burned
  by a `score >= 20 ? 'active' : 'research'` mapping, which is why it was left `unclassified`.
- **Setting the bucket on the pipeline profile as well as the Contact.** The page reads the Contact;
  writing both invites them to disagree with no rule about which wins.

## Not verified

- **No automated test covers any of Part 3** — the ladder, no-downgrade, score accumulation,
  concurrency and cap were all verified by throwaway scripts against the live dev intake. The
  bucket mapping in `signals.ts` is 102 hand-derived values with nothing asserting any of them.
- **The profiles page was never rendered in a browser.** It requires a logged-in session; I verified
  the data layer it reads (`Contact.engagementScore`, `Contact.metadata.intentBucket`) rather than
  the rendered page. The detail page at `profiles/[id]` reads the same two fields and was not
  exercised at all.
- **Emergency will rarely fire from telemetry.** The reference site derives Emergency mostly from
  *which page* the visitor is on, and the catalog has no page dimension — so in practice only
  `nav_emergency` and `emergency_cta` can promote to it. The orchestrator's `message_category`
  override remains the real emergency path. Whether that is acceptable is a product question I did
  not resolve.
- **Existing contacts are not backfilled.** Everyone already in the database keeps `0 /100` and
  `unclassified` until their next signal. The scores exist in comm-log `metadata.scoreLive` and
  could be backfilled; I did not, and did not ask.
- **Cross-session demotion is not implemented here.** `evaluateDemotion`/`DEMOTION_RULES` exist in
  `scoring.service` and operate on profiledb; nothing decays or demotes the Contact-side bucket, so
  a visitor who reaches `active` stays there indefinitely.
- **A misdiagnosis worth recording**: mid-session the suite showed 29 failures instead of 28, with
  `debug.test.ts` failing, and reverting my changes appeared to fix it — I said it was confirmed to
  be my change. It was not. The error was
  `Too many database connections opened: FATAL: remaining connection slots are reserved`, i.e. the
  shared Aiven instance exhausted by my own browser and script runs. Three consecutive clean runs
  with the changes in place confirmed 28/752. The lesson: read the failure text before trusting a
  revert/restore correlation on a shared database.

## Open decisions

- Whether `callback_*` should be `emergency` after all. For a plumbing tenant the reference site
  says yes; for ClearSky's own marketing site it would put every "Request a Call" visitor on a
  15-minute SLA in a bucket that never demotes. It is currently `active` — a one-word change in
  `signals.ts` if the product decision goes the other way. **This is per-vertical, and the catalog
  has no per-tenant dimension**, which is the deeper issue.
- Whether the bucket belongs on the Contact at all, or whether profiledb should own it and the main
  DB read through. The current state means two systems can hold different buckets for one person.

---

# Part 4 — one log per visit, and a regression from Part 1

## Goal

> "It bunches all signals in one, when user leaves a websiste, and comes back, split in both logs"

## Changed — visit splitting

`upsertSessionCommLog` keyed the thread on `vt_${fingerprint}`, so every visit a device ever made
grew the same row forever. It now opens a new row when the visitor returns after a gap.

**The boundary is server-side inactivity, not the client's `sessionId`.** That was the trap: the
sessionId is regenerated on every *script load*, and three separate scripts run on one page — the
site tracker, the leadbox and the leadform each mint their own. Observed on production in one page
view: `sess_mt2x79w8npbkhd`, `sess_mt2x7bmtixo8px`, `sess_mt2x7bnf2gjogb`. Keying on it would have
produced three rows per page view instead of one row per visit.

So a visit is "same visitor, last seen within `VISIT_GAP_MINUTES`" (default 30, the usual
web-analytics gap, overridable by env). `updated` is `@updatedAt`, so it tracks the last signal
rather than the row's birth — a visitor active for an hour stays in one visit.

Thread ids are now `vt_<key>_<visit>`; the lookup matches both that and the bare legacy `vt_<key>`
so rows written before this change stay reachable instead of being orphaned.

**The advisory lock moved from the thread to the visitor.** Which thread a batch belongs to is now
decided *inside* the lock; locking on the thread would have let two concurrent batches each decide
the visit had lapsed and open two rows for one visit.

Identity is untouched: one profile and one contact across visits, with the score and bucket
carrying over. Only the comm log splits — which is the intended separation, one person with many
visits.

## Root cause — a regression I introduced in Part 1

While testing the split I found signals going missing from the comm log again, **intermittently**:
one run in three dropped a signal, always a different one, while `pipeline_events` kept all of them.

Part 1 wrapped the comm-log read-modify-write in an interactive transaction to take the advisory
lock. **Prisma's interactive transactions default to a 5-second limit.** That is not enough here:
the database is ~155ms away, the transaction runs six or more statements, and a batch may also wait
on the connection pool and on the advisory lock. When it overruns, Prisma aborts the transaction —
and because the comm-log write is deliberately non-fatal (`.catch` → `console.error`), the signal
silently vanishes from the comm log while still being in `pipeline_events`.

That is the same *symptom* Part 1 set out to fix, reintroduced by the mechanism of the fix, and
made intermittent rather than deterministic — which is worse, because it looks like flakiness.

Both interactive transactions now pass `TX_OPTS = { timeout: 20_000, maxWait: 15_000 }`.

## Verified

- **No drops**: 4 consecutive runs of a 5-signal sequence, all 5 present every time. Before the
  timeout fix the same test dropped a signal in 1 of 3 runs.
- **Visit split**: three signals with three different sessionIds land in one row; after ageing the
  row past the gap, two further signals open a second row. Two rows, correct contents.
- **Identity unaffected**: 1 profile, 1 contact across both visits; score and bucket carry over.
- **Baseline unchanged**: vitest 28 failed / 752 passed; `svelte-check` reports nothing for
  `intake.ts`.

## Not verified

- **The 30-minute gap is a guess at the product intent.** It is the analytics convention and is
  env-overridable, but nobody has confirmed it is the right boundary for this business.
- **No automated test covers visit splitting or the timeout.** Both were verified by scripts against
  the live dev intake. Nothing stops the timeout being dropped again, and a 20s ceiling is still a
  ceiling — under heavier load the same silent drop returns.
- **Existing rows are not migrated.** Every visitor's history to date stays in its one bare
  `vt_<key>` row; the split only applies from the next visit onward.
- **The underlying slowness is untouched.** The intake makes ~30 sequential round trips at ~155ms
  each, so a signal takes 4–7s against the dev server. Raising the timeout stops the abort but does
  not make it fast, and the earlier finding stands: a submit fired just before the visitor leaves
  can still be lost. Making the route respond before doing its database work is the real fix and was
  not done.
- The `.catch` that swallows comm-log failures is still there. It is correct that telemetry must not
  break the request, but it means the next failure of this class will also be silent — only a
  `console.error` on the server marks it.

---

# Part 5 — the visit boundary is the browser tab, not a timer

## Goal

> "it should happen the exact moment the user closes and reopens. I tried, closed a tab and opened
> and they still got grouped"

Part 4 split visits on a 30-minute inactivity gap. That was the wrong boundary: closing and
reopening a tab takes seconds, so it stayed inside the window and kept appending to the same row.

## Changed

**A visit is now one browser tab**, expressed with `sessionStorage` — it is per-tab, survives
navigation and reload, and is destroyed when the tab closes. That is exactly the requested
semantics, and unlike a timer it is deterministic: reopening produces a different id and the next
signal opens a new row immediately, with no clock involved.

All four emitters now resolve their `sessionId` from the same `sessionStorage` key
(`clearsky_session`), first one to run creating it:

- `clearsky-website/src/lib/telemetry/client.js` (site tracker)
- `a2p/src/lib/telemetry/client.ts` (viewroom)
- `a2p/src/lib/embed/leadbox-builder.ts`
- `a2p/src/lib/embed/leadform-builder.ts`

Sharing the key matters as much as the storage choice. Three ClearSky scripts load separately on a
single page and each previously minted its own id — observed on production in one page view:
`sess_mt2x79w8npbkhd`, `sess_mt2x7bmtixo8px`, `sess_mt2x7bnf2gjogb`. Keying the comm log on a
per-script id would produce three rows per page view.

`intake.ts` now keys the thread on `vt_<visitor>_<sessionId>` when a session id is present. The
Part 4 inactivity gap survives only as a fallback for batches that arrive **without** one (storage
blocked in private mode, or a cached pre-sessionStorage script); without it those would collapse
into one endless row again.

## Deployment hazard — both repos must ship together

The server now trusts `sessionId` as the visit key. If the a2p embeds ship with tab-scoped ids
while the marketing site still runs the old per-load `randomSessionId()`, the site tracker will send
a **new id on every page load** and the visitor will get a new comm-log row per page view — worse
fragmentation than the bug being fixed. Deploy `clearsky-website` and `a2p` together. The embed
scripts are served `no-store` with a cache-buster so they refresh immediately; the site client is
bundled, so the site build is the atomic unit.

## NOT VERIFIED — this is the important part of this entry

**The tab-split behaviour was never confirmed end to end.** The signals were posted through the
running intake, but every attempt to read the comm log back failed with

```
Too many database connections opened: FATAL: remaining connection slots are reserved
```

The shared Aiven instance has `max_connections = 20`; the dev server's pool alone is capped at 10
(`withPoolLimits` in `src/lib/db.ts`), and the remaining slots stayed exhausted across six retries
over ~50 seconds and several later attempts. So for Part 5 there is:

- no confirmation that two tabs produce two rows,
- no confirmation that one tab's signals still group into one row,
- no confirmation that returning to the first tab rejoins its original row.

What *is* confirmed: the code typechecks, `svelte-check` reports nothing for any of the four changed
files, and the tree baseline is unchanged (938 errors / 223 warnings). The Part 4 gap-based split
*was* verified before this change, so the thread-creation machinery around it works; only the new
key selection is untested.

Anyone picking this up should re-run the check: post signals with two different `sessionId`s and the
same `fingerprintId`, then confirm two `vt_<fp>_<sessionId>` rows exist and that reusing the first
session id appends to the first row rather than creating a third.

## Also unresolved

- **Connection-slot exhaustion is now a recurring blocker**, not a one-off. It has interrupted work
  three times today and previously produced a phantom test failure that I misdiagnosed as a code
  regression. 20 slots against a dev server holding 10 leaves almost no headroom for scripts, and
  Vite hot-reloads appear to accumulate clients despite the `globalForPrisma` cache. Restarting the
  dev server releases its pool; the real fix is a smaller `connection_limit` or a pooler.
- The intake is still ~30 sequential round trips at ~155ms. Nothing in Part 5 changes that.
