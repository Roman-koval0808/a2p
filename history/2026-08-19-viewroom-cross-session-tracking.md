# Goal
"when user joins the viewroom, show it in comm logs, it should count as a score, is it possible to use the fingerprint to recognize a user across calls and merge profiles?"
Like when a user does stuff in leadbox / leadform, their fingerprint is stored. When they join the room, it should recognize that same profile and add it to their score, and log it in comm logs instead of creating a new profile.

# Changed
`apps/lead-grabber-v1/src/routes/(app)/room/[roomId]/+page@.svelte`:
Added `trackViewroomJoin()` function which is called when the WebRTC connection is successfully established (`handleWebRTCCallback` under `play_started` and `publish_started`).
This function extracts the `fingerprintId` (from URL parameter `fp` or `localStorage.getItem('fingerprintId')`) and `sessionId` (`uniqueSessionId` in state).
It issues a POST request to `/api/v1/telemetry/events` with the payload `eventType: 'viewroom_entered'`.
This triggers the backend's `ingestTelemetryEvent` which uses `identity.service.ts` to `findOrCreateProfile` based on the fingerprint. Thus, if the same fingerprint exists from a leadbox interaction, the events are merged onto the existing profile, the score is incremented by 10 (as defined in `eventRegistry.ts` for `viewroom_entered`), and it's added to the comm logs (telemetry timeline).

# Root causes
N/A. This was a feature request to bring Viewroom into the same tracking ecosystem as Leadboxes and the marketing site.

# Rejected
Manually implementing profile merging or score incrementing from the viewroom API endpoint was rejected because the Profile DB's Telemetry pipeline already handles all of this natively as long as we pass `viewroom_entered` and `fingerprintId` to it.

# Not verified
Not verified if the `fingerprint` is accurately being passed into the Viewroom URL via `?fp=...` when users join from a Leadbox workflow. I checked `localStorage` in the Viewroom client just in case they share origins, but the actual fingerprint generation happens elsewhere.

# Open decisions
How the marketing site / Leadbox code actually propagates the `fingerprintId` to the viewroom URL (e.g. appending `&fp=xxx` to the `embedUrl`) still needs to be handled by the embedder or the tracking pixel if it hasn't been implemented yet.
