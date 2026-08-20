# 2026-08-20 Signal tracking wired into clearsky website + viewroom

## Goal

"write all signals I provided, the clearsky website is at /Users/n3rd/code/clearsky-website, so
using these should work as signals that show up in a2p communication logs with all scores and
signals correct … remember though, we tracked viewroom joining, but viewroom is in a2p itself, so
use these too: vr_entry · vr_name_focus · vr_phone_focus · vr_interest_select · vr_guestname ·
vr_repinvite · vr_tasks."

i.e. wire the deterministic signal pipeline into the actual marketing site and the a2p viewroom,
and make high-intent signals surface as a2p communication-log entries with a score.

## Changed

**clearsky-website (separate repo, Svelte 4 + SvelteKit):**
- `src/lib/telemetry/signals.js` — full signal catalog (same shape as a2p's `signals.ts`).
- `src/lib/telemetry/attribution.js` — 12-channel attribution (referrer + UTM).
- `src/lib/telemetry/client.js` — `TelemetryClient` singleton: fingerprint (localStorage + a canvas
  fallback), session id, `track()`, `identify()`, batching, `fetch(keepalive)` + `sendBeacon`.
- `src/lib/telemetry/tracker.js` — `initTracker()`: `page_load`, scroll `scroll_25/50/75/90`,
  `dwell_30/60/120`, plus a **delegated click listener** for `data-clearsky-signal` (+ optional
  `data-clearsky-payload` JSON) and a **delegated focusin listener** for `data-clearsky-focus`.
  Endpoint/tenant configurable via `VITE_A2P_BASE_URL` / `VITE_A2P_TENANT_SLUG` (dev default
  `http://localhost:3005`, tenant `cmkwntxej0004g1tiwmwbgazn`).
- `src/routes/+layout.svelte` — calls `initTracker()` in `onMount`.
- `src/lib/components/Navigation.svelte` — nav links → `svc_click` (payload `{service}`), "Contact
  Us" → `cta_call`, "Guarantee" → `hero_services_click`.
- `src/lib/components/Hero.svelte` — the sector visual link → `hero_cta_click`.

**a2p (lead-grabber-v1):**
- `src/routes/api/v1/telemetry/signals/+server.ts` — added CORS (`Access-Control-Allow-Origin: *`,
  OPTIONS handler) so the marketing site can POST cross-origin (mirrors `/api/messages`).
- `src/lib/server/telemetry/intake.ts` — `ingestSignalBatch` now also creates a **CommunicationLog**
  when the batch contains a high-intent signal (`scoreDelta >= 15` or category
  call_emergency/lead_form/reviews): resolves a `Contact` via `createOrUpdateContact` and writes via
  `logCommunication` with `type: 'web'` (or `'viewroom'`), carrying `scoreLive`, `scoreDelta` and the
  signal list in metadata. The engagement score now reads/writes `attributes.engagementScore` and is
  returned in the response.
- `src/routes/(app)/room/[roomId]/+page@.svelte` — imported `getTelemetry`; `trackViewroomJoin` now
  also fires `vr_entry` (with `identify({name})` when known), and `handleNameSubmitted` fires
  `vr_guestname`. The old `viewroom_entered`/`name_provided` posts are left intact.

## Root causes

- The signal catalog and intake existed but nothing emitted signals: the website had no tracker and
  the viewroom only fired the legacy `viewroom_entered`/`name_provided` profiledb events.
- The intake wrote `PipelineEvent`/`PipelineSignal` but never a `CommunicationLog`, so nothing ever
  surfaced in the a2p comm log.

## Rejected

- Forcing every one of the 102 catalogued signals onto the ClearSky corporate site — most are for
  tools (FotoJobber `fj_*`, Visualizer `viz_*`, ViewRoom `vr_*`) that are not on the marketing
  homepage. The declarative `data-clearsky-signal` mechanism lets any signal be attached as the real
  CTAs are finalised.
- Ripping out the working `viewroom_entered` → profiledb → comm-log path in this pass — too risky
  while it's live; the new `vr_*` signals are additive and feed the lead-grabber pipeline.

## Not verified

- No browser run of either codebase; signals were not observed end-to-end into a comm log.
- The `vr_entry`/`vr_guestname` fire-through and the website `page_load`/scroll/dwell were not
  exercised against a live a2p.
- `vr_name_focus`, `vr_phone_focus`, `vr_interest_select`, `vr_repinvite`, `vr_tasks` are defined in
  the catalog but not yet attached to specific room-page widgets (the name/phone/interest/rep/task
  UI hooks were not traced).

## Open decisions

- Which specific website elements map to `nav_book`, `nav_emergency`, `hero_call`, `callback_open`,
  etc. — the ClearSky corporate site has "Contact Us"/"Guarantee", not a home-services "Book"/"Call"
  nav, so those remain declarative until the CTAs are decided.
- Whether to fully retire `viewroom_entered`/`name_provided` + profiledb in favour of `vr_*` + the
  lead-grabber intake (the "never use profiledb" migration), and how to avoid double comm logs during
  the transition.
- The comm-log threshold (`scoreDelta >= 15` or category) is a first cut; tune it against real data.
