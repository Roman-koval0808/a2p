# ClearSky / A2P Mobile API — Developer Guide

> For the mobile app developer integrating the dialer, SMS, push and the
> communication log against the live backend. Full interactive docs at
> **`GET /docs`** (Swagger UI) and **`GET /docs/spec.json`** (OpenAPI 3.0,
> importable into Postman). A ready-made collection + environment live in
> [`../postman/`](../postman/).

> 🔒 **The docs pages are access-code protected.** Enter the shared code
> (`DOCS_ACCESS_CODE` — ask the backend owner) at `GET /docs-access` once;
> the cookie lasts 30 days. The `postman/clearsky-api.openapi.json` snapshot
> in the repo does not need the code.

---

## 1. Base URL & environment

- **Base URL:** `PUBLIC_BASE_URL` from the backend env (currently
  `http://localhost:3005` in dev; ask the backend owner for the public host).
- Everything lives under `/api/*` and returns JSON.

## 2. Authentication

Login and the mobile token flow:

1. `POST /api/auth/login` with `{ "email": "...", "password": "..." }`
   → response body includes `token` (JWT, 7 days) plus the user object.
2. For **every other request**, send the JWT as a header:
   ```
   Authorization: Bearer <token>
   ```
   (The backend also accepts the `app_session` cookie; mobile clients should
   use the Bearer header — supported by `hooks.server.ts`.)
3. `POST /api/auth/refresh` with the existing token re-issues a fresh token
   (7 days from now) — call it when your token is near expiry.
4. OTP flow (alternative): `POST /api/auth/otp/send` (`intent: login`) →
   email receives a 5-digit code → `POST /api/auth/otp/verify` with
   `{ email, code }` → token returned.

`GET /api/me` returns `{ id, name, email, company, role }` and confirms the
token works.

## 3. Test user (provided)

| | |
| --- | --- |
| Email | `test.mobile@clearsky.com` |
| Password | `ClearskyMobile2026!` |
| Company | Total Trade Solutions |
| **Assigned number (outbound caller ID)** | **`+17059985691`** (Telnyx, connection "A2P Mobile App") |
| Other company numbers | `+17059985374`, `+15513915091` (not Telnyx-owned — do not dial from them) |

`GET /api/sip/credentials` (Bearer) returns the dialer config:
`connectionId`, `callerIdName`, `callerIdNumber` (**+17059985691**), and a
short-lived `webrtcToken` for the Telnyx WebRTC SDK — the mobile app never
needs the Telnyx API key.

> ⚠️ **Dial from +17059985691 only.** Calls originating from the other
> company numbers fail at Telnyx with `D51 — unverified origination number`
> because they are not owned by this Telnyx account.

## 4. Canonical endpoints (use these)

### Calls / dialer
| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/sip/credentials` | WebRTC token + caller ID for the in-app dialer |
| POST | `/api/telnyx/dial` | `{ to, from?, clientId?, commId? }` → `{ callId, callLegId }` |
| POST | `/api/telnyx/hangup` | `{ callId }` (the `callId` from dial) |
| POST | `/api/telnyx/answer-call` | `{ callControlId }` — answer inbound calls |
| POST | `/api/telnyx/log-webrtc-call` | record a completed WebRTC call |
| GET | `/api/calls/history` · `/api/calls/history/{contactId}` | call log |
| GET | `/api/calls/pending` | calls awaiting follow-up |
| GET | `/api/recording/{logId}` | call recording (if available) |

### SMS
| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/sms/send` | `{ recipients[], message, fromNumber? }` |
| GET | `/api/sms/history` · `/api/sms/history/{contactId}` | SMS log |

### Conversations (unified view)
| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/communication-logs` | voice + sms + email in one feed |
| GET | `/api/communication-logs/by-comm-id/{commId}` | one thread |
| GET | `/api/communication-logs/{id}` · `.../{id}/assign` · `.../{id}/confirm` | detail/actions |
| GET | `/api/contacts` · `/api/contacts/{id}` | contacts (names, phones) |
| GET | `/api/messages` · `/api/messages/draft` | inbox threads (email-led) |

### Notifications & push
| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/push/register` | `{ deviceId, platform, fcmToken?, voipToken? }` — iOS/Android push+VoIP |
| POST | `/api/push/register-token` · `/api/push/unregister` | token variants |
| POST | `/api/fcm/store-token` | Android FCM token |
| GET | `/api/notifications` · `/api/notifications/unread-count` | feed + badge |
| PATCH | `/api/notifications` · `/api/notifications/{id}/read` · `/api/notifications/mark-all-read` | read state |

### Account / company
| Method | Path | Notes |
| --- | --- | --- |
| GET/PUT | `/api/me` | profile (update name/email/avatar) |
| POST | `/api/me/switch-company` | switch active company |
| GET | `/api/account` | account info |
| GET/POST | `/api/company-numbers` | assigned numbers (POST = assign E.164 number) |
| GET | `/api/company` · `/api/company-members` · `/api/company-members/{id}` | company + team |

## 5. Route conflicts — which path to use

Some details are reachable at **multiple paths** (legacy/duplicate trees).
Mobile app: use the **canonical** ones; ignore the rest.

| Concept | ✅ Canonical (use) | ⚠️ Duplicate / legacy (ignore for mobile) |
| --- | --- | --- |
| Communication log | `/api/communication-logs*` | `/api/a2p/communication-log`, `/api/calls/history`, `/api/sms/history`, `/api/email/history`, `/api/email/history/{contactId}`, `/api/v1/tenants/{tenantSlug}/profiles/...` (profiledb mirror) |
| Inbox/messages | `/api/messages*` | `/api/notifications` (different concept: alerts), `/api/events` (SSE-ish) |
| Notifications | `/api/notifications*` | `/api/dashboard/recent-notifications` |
| Outbound calls | `/api/telnyx/dial` | `/api/telnyx/test-call`, `/api/telnyx/ivr/bridge`, `/api/telnyx/ivr/*` (IVR internals) |
| Call logging | `/api/telnyx/log-webrtc-call` | `/api/calls/log`, `/api/telnyx/test-call-summary`, `/api/telnyx/test-call-end` |
| SMS send | `/api/sms/send` | `/api/v1/telemetry/send-sms` (profiledb) |
| Webhooks (server-only!) | — | `/api/telnyx/webhook`, `/api/telnyx/call-webhook`, `/api/telnyx/webhook-backup`, `/api/webhooks/telnyx/*`, `/api/webhooks/inbound-email`, `/api/webhooks/facebook` — Telnyx/Google call these, **not** the app |
| Telnyx admin | `/api/telnyx/numbers/list` | `/api/telnyx/numbers/buy`, `/api/telnyx/numbers/search`, `/api/telnyx/numbers/orders`, `/api/telnyx/numbers/update`, `/api/telnyx/numbers/{id}`, `/api/telnyx/porting/*`, `/api/telnyx/setup-company`, `/api/telnyx/verified-numbers*` |
| Pipeline (internal) | — | `/api/a2p/*`, `/api/orchestrator/*`, `/api/profiles/*`, `/api/representatives/*`, `/api/schedule/*`, `/api/tasks/*`, `/api/shortcuts/*`, `/api/ivr/*`, `/api/area-codes`, `/api/call-tracking-categories*` |

## 6. WebSocket / realtime

- `GET /api/debug-sse` — SSE debug stream for call events (not a product API).

## 7. Smoke test (curl)

```bash
BASE=http://localhost:3005
EMAIL=test.mobile@clearsky.com
PASS=ClearskyMobile2026!

TOKEN=$(curl -s -X POST $BASE/api/auth/login \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" | jq -r .token)

curl -s $BASE/api/me -H "Authorization: Bearer $TOKEN"           # profile
curl -s $BASE/api/sip/credentials -H "Authorization: Bearer $TOKEN"  # webrtc token + caller id
curl -s -X POST $BASE/api/telnyx/dial -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"to":"+17058068653"}'   # dial -> { callId }
curl -s $BASE/api/communication-logs -H "Authorization: Bearer $TOKEN"  # the call appears here
```

## 8. Known backend notes

- `GET /api/me` currently returns `phone: null` — the user row has no phone;
  the **company number** (`/api/company-numbers`) is the real outbound caller ID.
- Inbound calls to the company's Telnyx number arrive via webhooks
  (`/api/webhooks/telnyx/incoming-call`) and are matched to the rep through
  call-control; the mobile app receives them via push (VoIP token in
  `/api/push/register`).
