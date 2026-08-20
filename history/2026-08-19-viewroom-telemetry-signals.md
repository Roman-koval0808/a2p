# 2026-08-19 Viewroom telemetry signal foundation

## Goal

"here are the signals we need for the viewroom: vr_entry · vr_name_focus · vr_phone_focus ·
vr_interest_select · vr_guestname · vr_repinvite · vr_tasks" — plus a full spec for a deterministic
telemetry pipeline (12 traffic sources, a 98-signal inventory, and an 8-step intake). "Begin by
writing the Frontend SvelteKit attribution/telemetry utilities to batch and send the data, followed
by the Backend Event Intake route to receive it." Hard rule: **"never use profiledb, its abandoned,
use lead-grabber-v1."**

## Changed

- **`src/lib/telemetry/signals.ts` (new)** — single source of truth for the signal catalog. Typed
  `SignalDef { name, category, scoreDelta, payloadFields }` for the full inventory (passive,
  navigation, call/emergency, lead/form, FotoJobber, Visualizer, ViewRoom, financing, chat, FAQ,
  blog, reviews), plus `VIEWROOM_SIGNALS`, `getSignal`, `isKnownSignal`, and the
  `TelemetrySignal`/`SignalPayload` types. Score deltas are deterministic and configurable.
- **`src/lib/telemetry/attribution.ts` (new)** — `resolveAttribution` maps referrer + UTM onto the
  12 channels (google_paid, bing_paid, organic_google, organic_bing, direct, referral, facebook_ad,
  youtube_paid, youtube_organic, llm_referral, qr_code, gbp_website_click) with no network calls.
- **`src/lib/telemetry/client.ts` (new)** — `TelemetryClient` singleton: session id + fingerprint
  (URL `fp` / localStorage), `track()`, `identify()`, batching (threshold + interval), `flush()`
  via `fetch(keepalive)` with re-queue on failure, and a `sendBeacon` unload flush. Unknown signal
  names are dropped.
- **`src/lib/server/telemetry/intake.ts` (new)** — deterministic intake (`ingestSignalBatch`):
  resolves the company (id or `emailSlug`), resolves/creates a `PipelineCustomerProfile` (phone →
  email → fingerprint/externalId → create), then writes one `PipelineEvent` + one `PipelineSignal`
  per signal in a transaction and increments `attributes.engagementScore`. **No AI anywhere.**
- **`src/routes/api/v1/telemetry/signals/+server.ts` (new)** — POST route that hands the body to
  `ingestSignalBatch`.

All of it writes to lead-grabber's `$lib/db` (`PipelineEvent` / `PipelineSignal` /
`PipelineCustomerProfile`). Nothing imports or touches `profiledb` / `PROFILEDB_DATABASE_URL`.

## Root causes

N/A — greenfield module. The existing `viewroom_entered` → profiledb → comm-log path was left
untouched and still works; this adds the deterministic signal pipeline the spec calls for alongside
it rather than replacing it in one jump.

## Rejected

- Storing signals through the old `ingestTelemetryEvent` (profiledb) — explicitly forbidden.
- Routing signals through `UnifiedPipeline` — it runs AI extraction and the full
  orchestrator/action-queue; the spec says signals are strictly deterministic and must bypass AI.
- Adding an `engagementScore` column to `PipelineCustomerProfile` — needs a migration (broken by
  drift); stored in `attributes.engagementScore` JSON instead.

## Not verified

- No browser run; `track()`/batch/beacon and the intake route were not exercised end-to-end.
- The `PipelineEvent`/`PipelineSignal` writes were not run against a live DB.
- Signal count: the spec says "98" but the listed inventory adds to 102 (I defined 8 ViewRoom
  signals including `vr_video_watch`, inferred from the "videos watched" note; the spec lists only
  7 ViewRoom names).

## Open decisions

- **Wiring the 8 ViewRoom hooks into the UI** — the `vr_*` signals are defined and `track()` is
  ready, but the room page still only fires the old `viewroom_entered`/`name_provided` events. The
  per-widget hooks (name/phone focus, interest select, guest name, rep invite, tasks, video watch)
  still need to be connected in `src/routes/(app)/room/[roomId]/+page@.svelte`.
- **Meeting Transcription Handoff (Part 3, step 5)** — the "if the user meets a rep, pipe the
  transcript to an LLM to generate tasks" block is not implemented. It belongs in a separate,
  AI-gated path (e.g. after a rep meeting ends), distinct from this deterministic intake.
- **BigQuery export** — the spec says "send all signals/attribution/ViewRoom data to BigQuery"; no
  export step exists yet.
- Whether `vr_entry` should eventually supersede `viewroom_entered` (rename/migration of the
  existing event) or coexist with it.
