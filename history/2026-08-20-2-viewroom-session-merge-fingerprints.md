# 2026-08-20 (2) Viewroom session merge + fingerprints on profile

## Goal

After the first end-to-end run, the viewroom session and the marketing-site session did **not**
merge even though the same fingerprint (`a24c60d6c9c2`) was seen in both. User's words:
"same should have that fingerprint and they should be merged!! we should have only 1 log … and in
the profile, in Debug details we should see under sam's debug details fingerprints: a24c60d6c9c2".

i.e. one comm log per visitor across site + viewroom, and the visitor's fingerprint(s) visible on
the profile page.

## Root causes

- **The room page strips `?fp=` from the URL.** The room's `run()` block rewrites the URL with a
  whitelist of params (`repid, uid, isHost, anonymous, hostUserId, anonymousUserId`) and **`fp` was
  not in it** (`+page@.svelte` ~line 2659). The sanitizer ran `history.replaceState` at component
  init, so by the time `trackViewroomJoin`/`handleNameSubmitted` created the telemetry singleton,
  `readFingerprint()` saw no `?fp=` and no localStorage (the async FingerprintJS fallback in the
  same page's `onMount` lost the race) → the client fell back to a random session id → thread
  `vt_sess_…` → a second profile and a second comm log.
- The embed itself was fine: it has no sanitizer, so `vr_name_focus` correctly carried
  `a24c60d6c9c2`. Only the embed → room handoff lost it.
- The "viewroom entry" label was just the humanised `vr_entry` (the old profiledb path was already
  gone); renamed to "vr entry" so it reads like the raw signal.

## Changed

**a2p (lead-grabber-v1):**
- `src/routes/(app)/room/[roomId]/+page@.svelte` — added `fp` to the URL-sanitizer whitelist so the
  fingerprint survives the `replaceState`. This is the merge fix.
- `src/lib/telemetry/signals.ts` — `humanizeSignal`: `vr_entry` now renders "vr entry".
- `prisma/schema.prisma` + `prisma/migrations/20260820000000_add_contact_metadata/migration.sql` —
  new `Contact.metadata Json @default("{}")` column (applied to the Aiven DB, client regenerated).
- `src/lib/utils/contacts.ts` —
  - `createOrUpdateContact` takes an optional `fingerprint`; after phone/email matching it also
    matches by `metadata.fingerprints` (`{ path: ['fingerprints'], array_contains: [fp] }`), so a
    returning device lands on the SAME contact even with no name/email/phone.
  - Fingerprint persistence lives here now: found **or** created contacts get the fingerprint
    appended to `metadata.fingerprints` (dedup) via `persistFingerprint`.
- `src/lib/server/telemetry/intake.ts` —
  - `resolveProfile`: when an existing profile is found by fingerprint and the batch now carries a
    name, set `displayName` if the profile has none (the profile gains "Sam" instead of staying
    blank).
  - `upsertSessionCommLog`:
    - passes `fingerprint` into `createOrUpdateContact`; the post-hoc
      `prisma.contact.update` fingerprint block was removed (the util does it).
    - **source fix**: fingerprint is a last-resort source only on CREATE; on UPDATE the row keeps
      `name ?? email ?? phone ?? existing.source` — an anonymous website batch must never clobber
      the name the visitor gave in the viewroom back to the fingerprint.
    - **signals now append without dedup** (capped at 80), so a returning visitor's repeated
      `vr_entry`/dwells are visible instead of being swallowed.
    - metadata gains `name` (first/current batch name per row) for the identity history.
- `src/routes/(app)/profiles/[id]/+page.server.ts` —
  - reads `contact.metadata.fingerprints` and returns it as `fingerprints`;
  - identity history: telemetry rows (`md.signals` or `source_signal` web/viewroom) no longer
    render the fingerprint as a `Phone` update; row name comes from `md.name` (falling back to
    `md.callerName`/contact name).
- `src/routes/(app)/profiles/[id]/+page.svelte` — Debug details renders a `Fingerprints` row
  (`a24c60d6c9c2`).

**Data fix (Aiven, one-off `scripts-merge-contacts.mjs`, then deleted):** the three duplicate
contacts from the Sam→Tim→Jimmy renames (`cmt1q6wsq…Sam`, `cmt1qu9l…Tim`, `cmt1qw582…Jimmy`,
all with `metadata.fingerprints=["a24c60d6c9c2"]`) were folded into Jimmy's contact: reassigned
FK rows (communicationLog.customerId, thread/container/task/transaction/appointment/cohort/
scheduledIntent refs), `pastNames=["Sam","Tim"]`, merged fingerprints, deleted the dupes. The
comm-log row `cmt1q68cx…` was healed: `source="Jimmy"`, `customerId=Jimmy`.

## Verified (user run after the merge fix)

One thread `vt_a24c60d6c9c2` across site/embed/room; name changes propagate onto the row; score
accumulates (capped 100); room batch arrives with the fingerprint. The profile's AI-Summary modal
shows live row content (the stale-looking snapshot the user saw was actually current at view time —
a late `dwell_30` beacon updated the row ~3 min after the page was viewed). Events confirmed in
`pipeline_events` (`unstructuredText::jsonb` — the column is TEXT, `provider='clearsky_pixel'`,
and one legacy `leadbox_submit` row is not JSON).

## Rejected

- Relying on FingerprintJS alone to be stable across origins — it is not deterministic across page
  loads/origins in practice (we saw `bacfd787f931` vs `a24c60d6c9c2`). The explicit `?fp=` handoff
  stays the source of truth.
- A multi-fingerprint identity-merge engine (dedupe/merge whole `PipelineCustomerProfile`s when two
  fingerprints turn out to be the same person). Out of scope for this pass; we store and display
  fingerprints now, merging logic can build on that later.

## Incident (later same day): invited guest merged into the owner's profile

User invited a guest ("Larry") and the guest's room session merged into the owner's thread
`vt_a24c60d6c9c2`, renaming the owner's contact (pastNames grew Sam/Tim/Jimmy/Tess, contact became
Larry). Root cause was **not** code: the user pasted the room's full URL (with `?fp=a24c60d6c9c2`)
into the guest's browser; the room reads `?fp=` first, so the guest inherited the owner's
fingerprint → same thread/contact → merged + renamed. Re-test with proper invite links (the Share
dialog strips `fp` via `cleanUrlPreserveUid`) produced clean separation:

- `vt_a24c60d6c9c2` owner (Sam / a24c60d6c9c2)
- `vt_sess_mt1spsx0s96t1m` guest "larry" (own contact/log/notification)
- `vt_sess_mt1sqadi0smr27` guest "Larry" (own contact/log/notification)
- `vt_000001f53bea` Firefox visitor with its own device fingerprint (own contact/log)

Notes:
- Guest batches without a fingerprint are session-based by design → each new session = new
  thread/contact (so "larry" vs "Larry" = 2 logs; unavoidable without an identifier).
- **Firefox blocks `openfpcdn.io` (CORS + Enhanced Tracking Protection)** → the room's FingerprintJS
  fallback never runs in Firefox, so guests there get no stable device identity. Open improvement:
  a CDN-free local fingerprint fallback.
- The owner's row created at 17:28 under the pre-restart (old) client still has `source` = the
  fingerprint; self-heals on the next named batch.

## Not verified

- No browser re-run of the source-preservation + signal-append + single-contact fixes yet (dev
  server must be restarted to reload the regenerated Prisma client). Expected next test: one
  contact (Jimmy) with `pastNames Sam/Tim`, the row's source stays "Jimmy" after anonymous site
  batches, repeated visit signals appear appended, Identity History shows Sam → Tim → Jimmy with
  no fingerprint-as-phone entries.
- `npx tsc --noEmit` still reports the same 310 pre-existing errors (verified identical with my
  changes stashed); `vite build` passes.

## Open decisions

- Whether to retire the room page's FingerprintJS fallback entirely now that the `?fp=` handoff is
  reliable, or keep it as a safety net for direct room links (no embed) — currently kept.
- Whether fingerprint-based merging should later also merge separate `PipelineCustomerProfile` rows
  (and their Contacts) when the same person is seen under two different fingerprints.
## 2026-08-20 — Firefox CDN-free local fingerprint fallback (IMPLEMENTED)

Problem recap: on Firefox, ETP blocks the `openfpcdn.io` FingerprintJS CDN (both the site's
dynamic import and the room's), so Firefox visitors got no stable shared identity — the site fell
back to a canvas-based hash that was NOT persisted (and ETP randomizes canvas reads anyway), and
the room fell back to session ids. Result: no site↔room merge in Firefox.

Real site (correction): the demo HUD at `total-trades-solutions-site 2/_clearsky-hud.js` is a
demo-only overlay (console + toast, no network). The REAL tracking lives in the repo OUTSIDE a2p:
`/Users/{user}/code/clearsky-website/src/lib/telemetry/client.js` + `TradesFeaturesSection.svelte`
(`withFp()` appends `?fp=` from `localStorage.fingerprintId` to the room embed iframe URL, port
5173).

What changed:
1. `apps/lead-grabber-v1/src/lib/telemetry/fingerprint.ts` (NEW): `localFingerprint()` — 12-hex,
   deterministic, CDN-free, canvas-free (Firefox ETP randomizes canvas). Two-lane 32-bit FNV-1a
   over userAgent|language|languages|platform|hardwareConcurrency|deviceMemory|screen w/h/
   colorDepth|timeZone|tzOffset. Plus `readFingerprint()`: `?fp=` → localStorage
   (`fingerprintId`/`fingerprint`/`fp`) → compute localFingerprint AND persist it under
   `fingerprintId`. Always returns synchronously — the room singleton now always has a stable id,
   no FPJS race.
2. `apps/lead-grabber-v1/src/lib/telemetry/client.ts`: uses the new `readFingerprint` import.
3. Room `+page@.svelte` onMount: openfpcdn import REMOVED. Now: if a stored fingerprint exists but
   the URL lacks `?fp=`, write it into the URL (reloads/shareURL keep identity). Guest via invite
   link gets their OWN device's local id (correct — no cross-device merge). The owner-paste
   scenario still uses the pasted `?fp=` (unchanged, by design).
4. `clearsky-website/src/lib/telemetry/client.js`: `generateFallbackFingerprint` replaced with the
   SAME algorithm (no canvas), and the FPJS catch now PERSISTS the fallback under
   `fingerprintId` — so Firefox site, embed and room all converge on one id. FPJS stays primary
   where it loads (Chrome keeps existing ids like `a24c60d6c9c2`).

Verify (user): restart a2p dev server + site dev server, then on Firefox: site → viewroom embed →
name entry; check one thread/contact in the a2p DB and the fingerprints row. Expected: a single
12-hex `fp_...`-free stable id in `metadata.fingerprints` for the Firefox device, shared by site
batches and room batches, and room reloads keep the same thread.

Verified: `vite build` passes in both apps; `tsc --noEmit` = 310 errors, identical with changes
stashed (no new errors).

## 2026-08-20 — Leadbox/leadform embed signal triggers (IMPLEMENTED)

Signal audit result: all 102 catalog signals are registered in BOTH catalogs
(site signals.js + a2p signals.ts), but only 16 had trigger code. Wired the next batch:

- `apps/lead-grabber-v1/src/lib/embed/leadbox-builder.ts` (visitor widget, embedded on every
  site page via +layout.svelte):
  - `callback_open` + `callback_form_open` fired together when the "REQUEST A CALL" view opens
    (switchLeadboxView → request_call).
  - `callback_submit` fired on request-call form submit with payload { preferredTime }.
- `apps/lead-grabber-v1/src/lib/embed/leadform-builder.ts` (contact page embed):
  - `lg_open` on widget render.
  - `form_name_focus` / `form_email_focus` / `form_phone_focus` via focusin delegation, once
    per field (maps name/email/phone inputs).
  - `lg_submit` + `form_submit` on submit.

Both generated scripts embed a compact telemetry helper mirroring the site/a2p clients:
same fingerprint resolution (?fp= → localStorage fingerprintId/fingerprint/fp → CDN-free
FNV-1a local fallback, persisted), resolved LAZILY per signal so a fingerprint written by the
site client after page load is picked up (no cross-thread race). Tenant = the widget's
companyId. Sends via sendBeacon (fallback fetch+keepalive).

NOT wired (no UI exists): apt_*, cta_book, spl_* — the site has no appointment form, booking
CTA or special-offer claim; "Book a 15 Minute Consult" is decorative demo text in
GuaranteeSection, not a form.

Verified: embed tests 16/16 pass (generated scripts parse via new Function), vite build
passes, tsc 310 (unchanged).

## 2026-08-20 — Debug: embed signals not showing + console logging (IMPLEMENTED)

Symptom: user opened localhost:5173, AI summary showed only site+room signals, no
leadbox/leadform signals. Added console.log to every signal emission (site client.js,
a2p client.ts, both embed trackSignal helpers) + `[clearsky-leadbox]/[clearsky-leadform]
script loaded v2` markers. Verified served script via curl (11/6 trackSignal refs) and
intake accepts all 8 embed signals (curl-tested each).

Root causes found:
1. `/contact` leadform embed src was HARDCODED to PRODUCTION
   (`https://a2p.viewroom.ca/embed/leadform/...`) — the user's contact-page form ran OLD
   code (which fires `leadform_submit`; that event landed at 18:27:00, traceId
   trc_wtf4mtv). Fixed to use localhost:3005 in dev + fresh cache-buster (Date.now()),
   mirroring the leadbox pattern.
2. `callback_open` landed (18:28:45, profile cmt1utewg) but the second consecutive
   sendBeacon (`callback_form_open`, fired microseconds later) was dropped by the browser
   (known rapid-sendBeacon race). Fixed by batching both into ONE beacon via new
   `trackSignals([...])` helper; single-signal `trackSignal()` now wraps it.

No re-embedding required — embed scripts are fetched fresh from the a2p server on every
page load (no-cache headers); the served script already contains the new code.

Verified: embed tests 16/16, both apps build, tsc 310 unchanged. (Note: curl smoke-tests
left synthetic rows in prod DB under fingerprints testfp12345678 / accepttest0001 + profile
cmt1utewg001l5c1tpydf35bk — candidate for cleanup.)
