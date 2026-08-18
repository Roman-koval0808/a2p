# 2026-08-18 Remember the last route across logout/login

## Goal

"When I get logged out, remember my last route" — an unauthenticated visit to a protected page
should land on the login screen carrying where I was, and after logging in I should return there
instead of always landing on `/dashboard`.

## Changed

- **`src/lib/utils/safe-redirect.ts` (new)** — `safeNext(value)`: validates a `?next=` value before
  it is ever used as a redirect target. Root-relative only, rejects protocol-relative (`//`), rejects
  auth pages (`/login`, `/logout`, `/signup`) so the redirect cannot loop. This is the open-redirect
  guard.
- **`src/hooks.server.ts`** — after resolving (and clearing) the session, an unauthenticated
  **browser** request (`Accept: text/html`) to a protected route now throws
  `redirect(303, /login?next=<pathname+search>)`. API routes and public routes are untouched. This
  centralises the redirect: the per-page `throw redirect(303, '/login')` calls in the individual
  `load` functions never run for an unauthenticated user because the hook fires first, so I did not
  have to touch every page.
- **`(auth)/login/+page.server.ts`** — the password action reads `next` from `url.searchParams` and
  lands the user there instead of the role default. `next` wins over `/dashboard`/`/clearsky-admin`.
- **`api/auth/otp/verify/+server.ts`** — the OTP login path accepts `next` in the body and returns it
  as `redirect`, matching the password path.
- **`(auth)/login/+page.svelte`** — `verifyOtp` forwards `next` from the URL into the verify call.
- **`src/lib/utils/safe-redirect.test.ts` (new)** — 4 tests.

## Decisions worth knowing

- **The redirect lives in the hook, not the page loads.** There are many `load` functions that each
  `throw redirect(303, '/login')`. Editing them all would spread one decision across a dozen files
  (the exact anti-pattern CLAUDE.md warns about). The hook is the single writer; the page-level
  redirects are now dead code for the unauthenticated case and only still fire for the
  logged-in-but-no-company → `/create-company` case, which the hook correctly does not intercept.
- **`next` wins over the role default.** A CLEARSKY_ADMIN who was on a tenant page returns to it
  rather than `/clearsky-admin`. If admins are expected to always land on `/clearsky-admin`, that is
  a product call, not implemented.
- **API callers are not redirected.** `!isApiRoute` plus the `Accept: text/html` check means a
  bearer-token client gets a 401 from the endpoint, not an HTML 303.

## Not verified

- **No browser run.** The hook redirect, the `next` round-trip through the password form action, and
  the OTP path are all read off the code.
- **The `Accept`-header guard has not been exercised** against SvelteKit's client-side data requests
  (`x-sveltekit-load`) — those do not carry `text/html` in `Accept` in every version, so a
  client-side navigation after session expiry may or may not take the redirect path. If it does not,
  the fallback is the existing per-page `redirect('/login')`, which just loses the `next` param.
- **`safeNext` does not restrict to known routes**, only to safe path shape — an arbitrary `/foo`
  still redirects to `/foo` and then the hook would bounce it back to login (404/redirect), which is
  acceptable but not tested end to end.
- svelte-check unchanged at 320 errors / 142 warnings; the three errors the diff touched
  (`generateToken` type mismatch in login + otp-verify, the Prisma client mismatch in hooks) are
  pre-existing and only moved line numbers.
EOF