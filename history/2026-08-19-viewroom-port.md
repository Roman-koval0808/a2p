# 2026-08-19 Viewroom port into a2p

## Goal

Port the viewroom app (`/Users/n3rd/code/viewroom`) into a2p
(`apps/lead-grabber-v1`) on a2p's Prisma/Postgres stack with the exact same UI.
Explicit user rules: exact same UI; **no separate reps page** — use a2p's existing
reps page, add "invite rep to room" + "add rep content" to it; no locations /
settings / AI assistants; sidebar gets a "viewroom" dropdown → Content Library +
View Room List; "the entire room meeting etc needs to work".

## Changed

- **`apps/lead-grabber-v1/src/lib/server/viewroom/index.ts` (new)** — adapter layer
  mapping viewroom's Drizzle/PocketBase shapes onto a2p Prisma: `toRoom`,
  `toRepresentative`, `toContentItem`, `getRoomFull`, `getRoomByRoomIdOrId`,
  `getRepById`, `getRoomsForCompany`, `getCompanyReps`, `getCompanyContent`,
  `getContentById`, `resolveCompanyId` (`user.companyId ?? user.company?.id`),
  `convertSchedule`. Reps = `CompanyMember` + linked `User`. Fixes a
  `??`/`&&` precedence bug in `toRepresentative`'s name expression.
- **`src/routes/room/[roomId]/` (new, top-level, full-screen)** — the meeting room
  ported verbatim from viewroom: `+page.svelte` (3555 lines), `+page.server.ts`
  (authType pocketbase/representative/anonymous; scheduled gate `joinBeforeMinutes
  = 5`), `+layout.svelte`, `embed/`, `representative/`. `embed` `joinRoom` skips
  host-array update (a2p `ViewRoom` has no `host` column). Added a missing
  `import { toast } from 'svelte-sonner'` (latent viewroom bug).
- **`src/routes/(app)/room/` (new)** — room list + admin edit under a2p's sidebar.
  The `[roomId]/info` admin page lives here (was moved from top-level `room/
  [roomId]/info` to inherit the a2p layout); Sidenav removed, `mt-[6rem]`→`mt-6`.
  List/create dialog posts comma-joined `host_content[]` / `representative_content[]`
  / `representative[]` form fields, matching `api/room/manage`.
- **`src/routes/(app)/content-library/`, `.../[id]/edit/`, `.../video/[id]/`,
  `src/routes/(app)/upload/` (new)** — admin content pages; Bunny file URLs used
  directly (viewroom's `FILES_BASE`/`getFileUrl` layer removed).
- **`src/routes/api/` (new)** — `room/manage` (POST create, 10-char shortId),
  `room/[roomId]/info` (GET/PUT/PATCH; PATCH handles `content_active_state` JSON),
  `content-library` (GET), `content-library/[id]` (PUT/DELETE with Bunny cleanup),
  `upload/content` (POST, chunk reassembly + Bunny), `upload-chunk`, `combine-chunks`,
  `proxy-pdf`, `schedule-room`, `quotes` (writes `ViewroomQuote`), `send-note-email`,
  `send-quote-email`, `send-rep-invite` (no FCM, `notification_sent:false`; SMS via
  direct Telnyx fetch, rep contact via `x-rep-phone`/`x-rep-email` headers),
  `send-brevo-email` (copied), `stream/create|info|message|subscribe` (adapted auth).
  `send-*` email routes use a2p's `sendEmail` (Brevo, sender hardcoded "Lead
  Grabber") instead of viewroom's nodemailer.
- **`api/representatives` + `[id]`** — **merged** with a2p's existing endpoints
  (do not replace): returns `{success, data, representatives}`; `[id]` looks up by
  `{ OR: [{id}, {userId}] }` and returns both `data` and `representative`.
- **`src/routes/(app)/representatives/`** — wired the previously-mocked `rooms: []`
  to real `view_rooms` the rep is a member of (`room.representative.includes(rep.id)`),
  showing title + Created date + View button (matches viewroom UI). "Invite rep to
  room" and rep content assignment already live in the room flow (`invite-represen
  tative.svelte`, room create/edit dialogs) — not duplicated here.
- **`src/lib/components/nav-main.svelte`** — added a "Viewroom" dropdown (Content
  Library → `/content-library`, View Room List → `/room`) to both admin and tenant
  item lists.
- **`src/hooks.server.ts`** — `room/[roomId]`, `/embed`, `/representative` added to
  public routes.
- **`prisma/schema.prisma`** — added `ViewRoom`, `ContentLibraryItem`,
  `ViewroomQuote` models (quotes map to `viewroom_quotes`, created via targeted SQL
  because `prisma migrate`/`db push` are broken by pre-existing drift).
- **bits-ui 1.0 compatibility** — `Select.Value`→inline children, `Select.Label`→
  `Select.GroupHeading`, Item `selected` prop removed; `Thumb` exported from
  `ui/switch`; `ui/textarea` copied (a2p lacked it); `src/lib/store.js` created
  (`pickerOpen` — viewroom referenced a missing module).
- **`src/lib/utils.ts`** — restored a2p version via `git checkout` (it had been
  overwritten with viewroom's, losing `normalizeUrl` which `brevo.ts`/`getEmbedCode.ts`
  need) and appended `getRepInfo`.
- **`.env` / `.env.local`** — added `PUBLIC_SMTP_FROM=noreply@viewroom.ca`
  (required by `send-brevo-email`).

## Root causes

- **Reps page showed "No rooms connected"** — server load hardcoded `rooms: []`;
  no viewroom query was wired in. Fixed by fetching company `view_rooms` and
  filtering by `representative` membership.
- **`vite build` failed on overwritten `utils.ts`** — the initial copy brought
  viewroom's `utils.ts` over a2p's, breaking `normalizeUrl` consumers. Fixed by
  restoring a2p's file and appending the one viewroom helper a2p lacked.
- **Runtime `getUserFromToken` crash (`UserWhereUniqueInput` needs id/email/
  tokenKey)`** — only triggered by a malformed test JWT (empty claims), not an app
  bug; `jose` signing silently omits undefined claims.

## Rejected

- **New Prisma tables via `prisma migrate` / `db push`** — fails with pre-existing
  drift (P3006 shadow replay on `20260724000000_a2p_container_timer`,
  `comm_identifiers` unique). Applied `viewroom_quotes` DDL directly via psql.
- **Separate viewroom reps page** — explicitly forbidden by user; merged into a2p's.
- **Replacing a2p's `/api/representatives` shape with viewroom's** — a2p callers
  depend on `{success, data}` with `id=userId`; merged both shapes instead.
- **Top-level `room/[roomId]/info`** — moved under `(app)` so the admin editor gets
  the a2p sidebar (full-screen room page would not).

## Not verified

- **Live audio/video streaming** — AntMedia server not exercised end-to-end in this
  session; only the routes/pages load (200) and the WebRTC libs are wired.
- **Real Bunny upload** (`api/upload/content`, `upload-chunk`, `combine-chunks`)
  and **file proxy** (`proxy-pdf`) — not run with an actual file.
- **Email/SMS sending** (`send-note-email`, `send-quote-email`, `send-rep-invite`,
  Brevo) — routes load but no message was dispatched; SMTP creds and Brevo sender
  ("Lead Grabber") behaviour unverified.
- **Stream endpoints** (`stream/create` POST, `message`, `subscribe`) — GET 405s
  were the only check; no WebSocket/stream session run.
- **svelte-check** — ~976 errors across the repo; ported files carry the same
  loose typing (implicit any / never) as viewroom's originals (schedule-meeting
  ~194, room page ~174, etc.) plus pre-existing a2p errors. `vite build` passes;
  no per-file `tsc` gate exists.
- **Auth against the app's real DATABASE_URL** — that host (178.156.223.22:5432)
  refused connections from here; smoke tests ran against the Aiven DB with
  `DATABASE_URL` overridden and a manually-minted JWT (app has no `JWT_SECRET` in
  env, so the hardcoded fallback `'your-secret-key-change-in-production'` is
  active). A smoke-test room created in the Aiven DB was deleted after testing.
- **Room delete** — `api/room/[roomId]/info` has no DELETE handler; the UI path
  for deleting rooms from the list was not exercised.

## Open decisions

- No `JWT_SECRET` anywhere in `.env`/`.env.local` — the app signs/verifies with the
  hardcoded fallback. Production exposure risk; a2p-wide concern, not viewroom.
- The app's `DATABASE_URL` (178.156.223.22) is unreachable from this machine; the
  migration to Aiven (or the VPS) is unclear. Smoke tests used the Aiven DB.
- Room deletion UX: no API support found — verify the room list "Delete" still works
  or was omitted intentionally in the port.