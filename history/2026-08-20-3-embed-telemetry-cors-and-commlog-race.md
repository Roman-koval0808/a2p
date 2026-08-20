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
