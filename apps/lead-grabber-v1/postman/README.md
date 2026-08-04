# Postman / OpenAPI

For the mobile app developer.

## Files

| File | Purpose |
| --- | --- |
| `clearsky-api.openapi.json` | **OpenAPI 3.0 spec (142 endpoints).** Import this into Postman (or Insomnia) and it becomes a collection. |
| `clearsky-api.postman_environment.json` | Environment variables (base URL, test credentials). Import via Postman → Environments → Import. |
| `../static/openapi.json` | Same spec, generated at build time. |
| Live OpenAPI URLs | `GET /docs/spec.json` (any mode) · `/openapi-spec.json` (dev) · `/openapi.json` (static build) |
| Interactive Swagger UI | `GET /docs` in a browser |

## How to import into Postman

1. Open Postman → **Import** → drag in `clearsky-api.openapi.json`.
2. Postman → **Environments** → **Import** → `clearsky-api.postman_environment.json`.
3. Select the **ClearSky Mobile** environment.
4. Under your collection, the **Authorization** header for protected routes is pre-configured —
   just set the `token` variable first by calling `POST /api/auth/login` with:
   ```json
   { "email": "{{test_user_email}}", "password": "{{test_user_password}}" }
   ```
   The response body contains the JWT. Copy it into the `token` environment variable
   (the spec uses `Authorization: Bearer {{token}}`).
5. Base URL: set `baseUrl` to the live backend. Default `http://localhost:3005`.

## Suggested flow to verify the dialer

1. `POST /api/auth/login` → save `token`.
2. `GET /api/sip/credentials` → returns `connectionId`, `callerIdNumber`, `webrtcToken`
   (use the token in the Telnyx WebRTC SDK).
3. `POST /api/telnyx/dial` with `{ "to": "{{testDestNumber}}" }` → returns `callId`.
4. `POST /api/telnyx/hangup` with `{ "callId": "..." }`.
5. `GET /api/communication-logs` → the call appears in the log.

## Regenerate

```bash
node scripts/gen-openapi.mjs   # rebuilds src/lib/api/*.generated.js
# dev server serves /openapi-spec.json; run once for static build: pnpm build
```