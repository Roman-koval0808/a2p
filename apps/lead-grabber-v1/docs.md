# Lead-Grabber — Complete API Reference

Every API endpoint in the project. Auth: “Session” = requires `app_session` cookie and `locals.user` with company unless noted.

---

## Index by path prefix

| Prefix                          | Endpoints                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/auth`                     | signup, login, refresh, otp/send, otp/verify, forgot-password, reset-password                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `/api/a2p`                      | communication-log, contacts, emails/incoming, threads, orchestrator/run_once                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `/api/area-codes`               | GET                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `/api/calls`                    | history, history/[contactId], log, pending, test                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `/api/call-tracking-categories` | GET, POST; [id] PATCH, DELETE                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `/api/communication-logs`       | GET, assign POST; [id] GET, assign PUT; by-comm-id/[commId] GET                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `/api/company-members`          | GET                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `/api/company-numbers`          | GET, POST; [id] PATCH, DELETE                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `/api/contacts`                 | GET, POST; [id] GET, PUT, DELETE                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `/api/dashboard`                | summary, recent-notifications                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `/api/debug-sse`                | GET                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `/api/email`                    | send, history, history/[contactId]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `/api/events`                   | GET (SSE), test GET                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `/api/fcm`                      | store-token POST                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `/api/invites`                  | GET; [id] DELETE, resend POST                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `/api/ivr`                      | flows GET, POST; flows/[id] GET, PATCH, DELETE; flows/[id]/rules GET, POST; flows/[flowId]/rules/[ruleId] GET, PATCH, DELETE                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `/api/me`                       | GET                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `/api/account`                 | DELETE                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `/api/messages`                 | GET, POST, PATCH; draft POST                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `/api/notifications`            | GET, PATCH; [id] GET, read PUT, reply POST; unread-count GET                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `/api/profiles`                 | GET, POST; [id] GET, PUT, DELETE                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `/api/push`                     | register-token POST, DELETE (?deviceId)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `/api/recording`                | [logId] GET                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `/api/representatives`          | GET; [id] GET, communication-logs GET                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `/api/schedule`                 | events GET, POST; events/[id] PUT, DELETE                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `/api/shortcuts`                | personal GET, POST; personal/[id] DELETE; team GET                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `/api/sip`                      | credentials GET                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `/api/sms`                      | send POST, history GET, history/[contactId] GET                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `/api/tasks`                    | GET, POST; [id] GET, PUT, DELETE                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `/api/telnyx`                   | POST (send SMS); test GET; dial POST; call-webhook GET, POST, PUT; webhook GET, POST, PUT, OPTIONS; webhook-backup GET, POST, PUT, OPTIONS; test-call GET, POST; test-call-end GET, POST; test-webhook GET, POST; answer-call POST; hangup POST; setup-company GET, POST; numbers/search GET; numbers/list GET; numbers/buy POST; numbers/update POST; numbers/orders GET; numbers/[phone_number_id] DELETE; porting/check POST; porting/orders GET, POST; porting/loa-configurations GET; verified-numbers GET, POST; verified-numbers/verify POST; ivr/gather POST; ivr/speak POST; ivr/bridge POST; ivr/flows GET, POST |
| `/api/upload`                   | avatar POST, ivr POST, logo POST                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `/api/webhooks`                 | inbound-email POST; telnyx POST; telnyx/incoming-call POST; telnyx/incoming-sms POST                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `/embed`                        | leadbox/[id] GET, leadform/[id] GET                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `/logout`                       | GET, POST                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

---

## 1. Auth

| Method | Path                | Auth    | Request               | Response                                                     |
| ------ | ------------------- | ------- | --------------------- | ------------------------------------------------------------ |
| POST   | `/api/auth/signup`  | No      | `{ email, password }` | `{ success, user, token }` or 400                            |
| POST   | `/api/auth/login`           | No      | `{ email, password }`        | `{ success, user, token }` + Set-Cookie `app_session` or 401 |
| POST   | `/api/auth/refresh`         | Session | —                            | `{ success, user, token }` + Set-Cookie `app_session` or 401 |
| POST   | `/api/auth/forgot-password` | No      | `{ email }`                  | `{ success, message }`                                       |
| POST   | `/api/auth/reset-password`  | No      | `{ token, id, newPassword }` | `{ success, message }` or 400                                |

**Canonical flow going forward**

- Mobile and API clients should use `POST /api/auth/login` (email + password).
- After login (or app restart with existing cookie), use `GET /api/me` to validate/restore the session user.
- Legacy docs that mention `/api/representative/login` and `/api/representative/verify` are outdated; those endpoints are not part of this API.

### OTP (passwordless / email verification)

OTP endpoints remain supported for web flows and signup verification.
Treat OTP login (`intent: "login"`) as optional/legacy for clients that still use it.

Codes are **5 digits**, expire in **10 minutes**, and are sent by email (Brevo).

| Method | Path                   | Auth | Request                   | Response                                         |
| ------ | ---------------------- | ---- | ------------------------- | ------------------------------------------------ |
| POST   | `/api/auth/otp/send`   | No   | `{ email, intent }`       | `{ success, message? }` or 400/404/500           |
| POST   | `/api/auth/otp/verify` | No   | `{ email, code, intent }` | `{ success, redirect? }` + Set-Cookie or 400/500 |

**Send**

- `email`: string, required.
- `intent`: `"login"` \| `"signup"`.
- **Login:** looks up user by email; if found, creates OTP for that user and sends email. Returns 404 if no user.
- **Signup:** body must also include `name`, `password` (min 8 chars). Creates OTP tied to email with signup payload; sends email. Returns 400 if user already exists or validation fails.

**Verify**

- `email`: string, required.
- `code`: string, 5-digit code (digits only).
- `intent`: `"login"` \| `"signup"`.
- **Login:** verifies code for the user record; on success sets session and returns `{ success: true, redirect: "/dashboard" }` with `Set-Cookie`.
- **Signup:** verifies code for the signup record (keyed by email); on success creates user from stored name/password hash, sets session, returns `{ success: true, redirect: "/create-company" }` with `Set-Cookie`.

### Password Reset

Standard flow:
1. User requests a reset link via `forgot-password`.
2. A unique token is generated, hashed, and stored in the `Otp` table (`collectionRef: "password-reset"`).
3. An email is sent to the user with a link to `/reset-password?token=<token>&id=<otp_id>`.
4. User submits the form on `/reset-password` which calls `POST /api/auth/reset-password`.

| Method | Path                        | Auth | Request                      | Response                |
| ------ | --------------------------- | ---- | ---------------------------- | ----------------------- |
| POST   | `/api/auth/forgot-password` | No   | `{ email }`                  | `{ success, message }`  |
| POST   | `/api/auth/reset-password`  | No   | `{ token, id, newPassword }` | `{ success, message } ` |

**Forgot Password Example**

Request:
```http
POST /api/auth/forgot-password
Content-Type: application/json

{
  "email": "user@example.com"
}
```

Response (200 OK):
```json
{
  "success": true,
  "message": "If an account exists with this email, you will receive a reset link."
}
```

**Reset Password Example**

Request:
```http
POST /api/auth/reset-password
Content-Type: application/json

{
  "token": "4711142df351553bdf4ccffa4ea170818274cd952072bdc15ab541329518a8c0",
  "id": "cmn4a0w860000nm2yzrb3br6l",
  "newPassword": "new-secure-password"
}
```

Response (200 OK):
```json
{
  "success": true,
  "message": "Your password has been reset successfully."
}
```

_Note: Reset links expire in 1 hour. Resetting password rotates `tokenKey`, invalidating all existing sessions._

---

## 2. A2P

| Method | Path                             | Auth    | Request                                                                           | Response                                  |
| ------ | -------------------------------- | ------- | --------------------------------------------------------------------------------- | ----------------------------------------- |
| GET    | `/api/a2p/communication-log`     | Session | Query: limit, offset, contactId, channel, direction, internalTsFrom, internalTsTo | `{ logs }` or 503 if not configured       |
| GET    | `/api/a2p/contacts`              | Session | Query: limit                                                                      | `{ contacts }` or 503                     |
| GET    | `/api/a2p/emails/incoming`       | Session | —                                                                                 | `{ emails }` (proxy to A2P email service) |
| GET    | `/api/a2p/threads`               | Session | —                                                                                 | `{ threads }`                             |
| POST   | `/api/a2p/orchestrator/run_once` | Session | Body: `{ limit?: number }`                                                        | `{ ok, processed, watermark_ms }`         |

---

## 3. Area codes

| Method | Path              | Auth | Request                   | Response                          |
| ------ | ----------------- | ---- | ------------------------- | --------------------------------- |
| GET    | `/api/area-codes` | No   | Query: country (US \| CA) | `{ success, areaCodes, country }` |

---

## 4. Calls

| Method | Path                             | Auth    | Request                                                                                                                                           | Response                                                 |
| ------ | -------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| GET    | `/api/calls/history`             | Session | Query: page, limit                                                                                                                                | `{ success, data, pagination }` (voice logs)             |
| GET    | `/api/calls/history/[contactId]` | Session | Query: page, limit                                                                                                                                | `{ success, data, pagination }` (voice logs for contact) |
| POST   | `/api/calls/log`                 | Session | Body: contactId?, contactName?, contactNumber, direction, duration?, status?, callerIdName?, callerIdNumber?, telnyxCallId?, startedAt?, endedAt? | 201 `{ success, data, message }`                         |
| GET    | `/api/calls/pending`             | No      | —                                                                                                                                                 | `{ hasCall, call?: { id, name, phone, callId } }`        |
| DELETE | `/api/calls/pending`             | No      | Query: id (callId)                                                                                                                                | `{ success }`                                            |
| POST   | `/api/calls/test`                | No      | —                                                                                                                                                 | Adds a test pending call; `{ success, callId }`          |

---

## 5. Call tracking categories

| Method | Path                                 | Auth    | Request                       | Response                  |
| ------ | ------------------------------------ | ------- | ----------------------------- | ------------------------- |
| GET    | `/api/call-tracking-categories`      | Session | —                             | `{ success, categories }` |
| POST   | `/api/call-tracking-categories`      | Session | Body: `{ name, sortOrder? }`  | `{ success, category }`   |
| PATCH  | `/api/call-tracking-categories/[id]` | Session | Body: `{ name?, sortOrder? }` | `{ success, category }`   |
| DELETE | `/api/call-tracking-categories/[id]` | Session | —                             | `{ success }`             |

---

## 6. Communication logs

| Method | Path                                          | Auth    | Request                                                                                                       | Response                                                        |
| ------ | --------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| GET    | `/api/communication-logs`                     | Session | Query: page, limit, type (call\|sms\|email), direction, sort (newest\|oldest), search                         | `{ success, data, pagination }`                                 |
| POST   | `/api/communication-logs/assign`              | Session | Body: `{ logIds?, endpoint?, memberIds }` (memberIds required; either logIds or endpoint)                     | `{ success, updated, messagesUpdated?, message }`               |
| GET    | `/api/communication-logs/[id]`                | Session | —                                                                                                             | `{ success, data }` (single log with customer, assignedMembers) |
| PUT    | `/api/communication-logs/[id]/assign`         | Session | Body: `{ status, department?, assignedAgent? }` (status: unassigned \| assigned_to_dept \| assigned_to_agent) | `{ success, message }`                                          |
| GET    | `/api/communication-logs/by-comm-id/[commId]` | Session | —                                                                                                             | `{ success, data }` (array of { id, type, timestamp })          |

---

## 7. Company members

| Method | Path                   | Auth    | Request | Response                                         |
| ------ | ---------------------- | ------- | ------- | ------------------------------------------------ |
| GET    | `/api/company-members` | Session | —       | `{ success, data: [{ id, user, expand, role, status }] }` |

---

## 8. Company numbers

| Method | Path                        | Auth    | Request                                          | Response                                                     |
| ------ | --------------------------- | ------- | ------------------------------------------------ | ------------------------------------------------------------ |
| GET    | `/api/company-numbers`      | Session | —                                                | `{ success, numbers }` (with callFlow, callTrackingCategory) |
| POST   | `/api/company-numbers`      | Session | Body: `{ phoneNumber, telnyxPhoneNumberId? }`    | `{ success, number }`                                        |
| PATCH  | `/api/company-numbers/[id]` | Session | Body: `{ callFlowId?, callTrackingCategoryId? }` | `{ success, number }`                                        |
| DELETE | `/api/company-numbers/[id]` | Session | —                                                | `{ success }`                                                |

---

## 9. Contacts

| Method | Path                 | Auth    | Request                                                                  | Response                                             |
| ------ | -------------------- | ------- | ------------------------------------------------------------------------ | ---------------------------------------------------- |
| GET    | `/api/contacts`      | Session | Query: page, limit, search                                               | `{ success, data, pagination }` (spec contact shape) |
| POST   | `/api/contacts`      | Session | Body: name, phone, email?, company?, type?, avatarUrl? | `{ success, data }`; name and phone required         |
| GET    | `/api/contacts/[id]` | Session | —                                                                        | `{ success, data }`                                  |
| PUT    | `/api/contacts/[id]` | Session | Body: name?, phone?, email?, company?, type?, avatarUrl?                             | `{ success, data, message }`                         |
| DELETE | `/api/contacts/[id]` | Session | —                                                                        | `{ success, message }`                               |

---

## 10. Dashboard

| Method | Path                                  | Auth    | Request                  | Response                                                                                                                      |
| ------ | ------------------------------------- | ------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/dashboard/summary`              | Session | —                        | `{ success, data }` (totalCalls, totalSms, totalEmails, pendingAssignments, todaysEvents, unreadNotifications, totalContacts) |
| GET    | `/api/dashboard/recent-notifications` | Session | Query: limit (default 5) | `{ success, data }` (notifications array)                                                                                     |

---

## 11. Debug / SSE

| Method | Path             | Auth | Request | Response                                                                                                                                             |
| ------ | ---------------- | ---- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/debug-sse` | No   | —       | Broadcasts test incoming_call event to SSE clients; `{ success, connections, event, instructions }` or `{ success: false, error }` if no connections |

---

## 12. Email

| Method | Path                             | Auth    | Request                                      | Response                                                                    |
| ------ | -------------------------------- | ------- | -------------------------------------------- | --------------------------------------------------------------------------- |
| POST   | `/api/email/send`                | Session | Body: recipients[], subject, body, fromName? | `{ success, data: { results }, message }` (sends via Brevo + logs comm log) |
| GET    | `/api/email/history`             | Session | Query: page, limit                           | `{ success, data, pagination }`                                             |
| GET    | `/api/email/history/[contactId]` | Session | Query: page, limit                           | `{ success, data, contact, pagination }`                                    |

Provider: Brevo (`BREVO_API_KEY` required). If not configured, `/api/email/send` returns `503`.

---

## 13. Events (SSE)

Real-time updates via Server-Sent Events.

| Method | Path               | Auth    | Request | Response                                                                                                        |
| ------ | ------------------ | ------- | ------- | --------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/events`      | Session | —       | **SSE stream**: `Content-Type: text/event-stream`; company-scoped; sends `connected`, then `heartbeat` every 30s |
| GET    | `/api/events/test` | Session | —       | Broadcasts test `incoming_call` to your company; `{ success, message }`                                          |

### SSE Format

All events follow the standard SSE format:
```
event: <event_name>
data: <json_payload>
```

### Event Types

- **`connected`**: Sent immediately on connection.
- **`heartbeat`**: Sent every 30 seconds to keep the connection alive.
- **`new_notification`**: Sent whenever any new notification is created for the company.
- **`new_sms`**: Specialized event for inbound SMS messages.
- **`incoming_call`**: Specialized event for inbound voice calls.

### Examples

**`new_sms` event**
```
event: new_sms
data: {"type":"new_sms","notification":{"id":"notif_123","type":"sms","sourceName":"John Doe","messagePreview":"Hello there!","threadId":"..."}}
```

**`heartbeat` event**
```
event: heartbeat
data: {"type":"heartbeat"}
```

---

## 14. FCM

| Method | Path                   | Auth    | Request                                 | Response               |
| ------ | ---------------------- | ------- | --------------------------------------- | ---------------------- |
| POST   | `/api/fcm/store-token` | Session | Body: `{ token, platform?, deviceId? }` | `{ success, message }` |
| POST   | `/api/push/register-token` | Session | Body: `{ deviceId, platform: ios\|android\|web, fcmToken?, voipToken? }` (at least one token) | `{ success: true }` or 400/401 |
| DELETE | `/api/push/register-token` | Session | Query: `deviceId` | `{ success: true }` or 400/401 |

### VoIP / incoming-call push (implemented)

Incoming **call control** events are handled on **`POST /api/telnyx/call-webhook`** (not `/api/telnyx/webhook`, which is for SMS). On **`call.initiated`** for an inbound call to a company number, when `FIREBASE_SERVICE_ACCOUNT_JSON` is set the server sends an **FCM data** multicast (`type: incoming_call`, `callControlId`, `from`, `to`, `callerName`, `companyId`) to **active** company members who have an **`fcmToken`** in `user_devices`. Invalid tokens are removed. **`voipToken`** is stored for future APNs VoIP use; direct APNs VoIP is not sent yet.

**Logout:** `GET` or `POST` `/logout?deviceId=<same id as registration>` removes that row from `user_devices` before clearing the session (optional; mobile can also call `DELETE /api/push/register-token?deviceId=` while still authenticated).

---

## 15. Invites

| Method | Path                       | Auth    | Request                                    | Response                                                                             |
| ------ | -------------------------- | ------- | ------------------------------------------ | ------------------------------------------------------------------------------------ |
| GET    | `/api/invites`             | Session | Query: companyId (must match user company) | `{ invites }` or 403                                                                 |
| DELETE | `/api/invites/[id]`        | Session | —                                          | `{ success }` or 404                                                                 |
| POST   | `/api/invites/[id]/resend` | Session | —                                          | Resends invite email (prod) or logs link (dev); `{ success, inviteLink }` or 400/404 |

_Note: Invite creation has no REST endpoint in this list; it may be done via a page form action (e.g. settings/team or similar)._

---

## 16. IVR (app flows & rules)

| Method | Path                                     | Auth    | Request                                                                                                                                                              | Response                 |
| ------ | ---------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| GET    | `/api/ivr/flows`                         | Session | —                                                                                                                                                                    | `{ flows }` (with rules) |
| POST   | `/api/ivr/flows`                         | Session | Body: title, greetingAudioUrl?, queueHoldAudioUrl?, allUnavailableAudioUrl?, backupCellAudioUrl?, failoverConfig?                                                    | `{ flow }`               |
| GET    | `/api/ivr/flows/[id]`                    | Session | —                                                                                                                                                                    | `{ flow }`               |
| PATCH  | `/api/ivr/flows/[id]`                    | Session | Body: same fields as POST (partial)                                                                                                                                  | `{ flow }`               |
| DELETE | `/api/ivr/flows/[id]`                    | Session | —                                                                                                                                                                    | `{ ok: true }`           |
| GET    | `/api/ivr/flows/[id]/rules`              | Session | —                                                                                                                                                                    | `{ rules }`              |
| POST   | `/api/ivr/flows/[id]/rules`              | Session | Body: ruleTitle, schedule, promptsAudioUrl?, keyPrompts?, failoverCount?, failoverDelayMinutes?, failoverAudioUrl?, hangupAudioUrl?, leaveMessageOnHash?, backDigit? | `{ rule }`               |
| GET    | `/api/ivr/flows/[flowId]/rules/[ruleId]` | Session | —                                                                                                                                                                    | `{ rule }`               |
| PATCH  | `/api/ivr/flows/[flowId]/rules/[ruleId]` | Session | Body: same as rules POST (partial)                                                                                                                                   | `{ rule }`               |
| DELETE | `/api/ivr/flows/[flowId]/rules/[ruleId]` | Session | —                                                                                                                                                                    | `{ ok: true }`           |

---

## 17. Messages (inbox / leadbox)

| Method | Path                  | Auth      | Request                                                                                                              | Response                                                                            |
| ------ | --------------------- | --------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| GET    | `/api/messages`       | Session   | Query: page, perPage, threadId?                                                                                      | If threadId: single thread; else `{ success, data, pagination }` |
| POST   | `/api/messages`       | No (CORS) | Body: company_id, thread_id?, customer_name?, customer_phone?, customer_email?, message?, source? (leadbox/leadform) | Creates/updates message thread, AI analysis, contact, comm log; JSON with CORS      |
| PATCH  | `/api/messages`       | Session   | Body: id, ...updateData (status?, assignedToId?, etc.)                                                               | `{ success, message }` or 404                                                       |
| POST   | `/api/messages/draft` | Session   | Body: id (messageId), channel? (email\|sms\|chatbot)                                                                 | AI draft reply; `{ draft }` or 404/502                                              |

---

## 18. Notifications

| Method | Path                              | Auth    | Request                                                          | Response                                           |
| ------ | --------------------------------- | ------- | ---------------------------------------------------------------- | -------------------------------------------------- |
| GET    | `/api/notifications`              | Session | Query: page, perPage, type?, read? (true\|false)                 | `{ success, data, pagination }` |
| PATCH  | `/api/notifications`              | Session | Body: `{ id, read }`                                             | Updated notification                               |
| POST   | `/api/notifications/mark-all-read` | Session | —                                                                | `{ success, count, message }`                      |
| GET    | `/api/notifications/[id]`         | Session | —                                                                | `{ success, data }` (single notification)          |
| PUT    | `/api/notifications/[id]/read`    | Session | —                                                                | `{ success, message }` (marks read)                |
| POST   | `/api/notifications/[id]/reply`   | Session | Body: `{ message, replyMethod }` (replyMethod: sms\|email\|call) | Marks read; `{ success }` (stub: no actual send)   |
| GET    | `/api/notifications/unread-count` | Session | —                                                                | `{ success, data: { count } }`                     |

---

## 19. Profiles (contacts as profiles)

| Method | Path                 | Auth    | Request                                                 | Response                                                        |
| ------ | -------------------- | ------- | ------------------------------------------------------- | --------------------------------------------------------------- |
| GET    | `/api/profiles`      | Session | Query: page, limit, search                              | `{ success, data, pagination }` (contact rows as profile shape) |
| POST   | `/api/profiles`      | Session | Body: name, phone?, email?, company?, address?, notes?  | `{ success, data }`; name required                              |
| GET    | `/api/profiles/[id]` | Session | —                                                       | `{ success, data }`                                             |
| PUT    | `/api/profiles/[id]` | Session | Body: name?, phone?, email?, company?, address?, notes? | `{ success, data, message }`                                    |
| DELETE | `/api/profiles/[id]` | Session | —                                                       | `{ success, message }`                                          |

---

## 20. Recording

| Method | Path                     | Auth    | Request | Response                                                                                               |
| ------ | ------------------------ | ------- | ------- | ------------------------------------------------------------------------------------------------------ |
| GET    | `/api/recording/[logId]` | Session | —       | **Stream**: audio (mp3/wav) for voice log with metadata.recording_id; 404 if no recording or not voice |

---

## 21. Representatives (company members as reps)

| Method | Path                                           | Auth    | Request            | Response                                                            |
| ------ | ---------------------------------------------- | ------- | ------------------ | ------------------------------------------------------------------- |
| GET    | `/api/representatives`                         | Session | Query: search?     | `{ success, data }` (id, name, email, phone, department, avatarUrl) |
| GET    | `/api/representatives/[id]`                    | Session | —                  | `{ success, data }` (single rep)                                    |
| GET    | `/api/representatives/[id]/communication-logs` | Session | Query: page, limit | `{ success, data, pagination }` (logs assigned to this rep)         |

---

## 22. Schedule events

| Method | Path                        | Auth    | Request                                                                 | Response                                                                            |
| ------ | --------------------------- | ------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| GET    | `/api/schedule/events`      | Session | Query: startDate?, endDate?                                             | `{ success, data }` (events with id, title, description, startTime, endTime, color) |
| POST   | `/api/schedule/events`      | Session | Body: title, startTime, endTime, description?, color? (blue\|red\|pink) | 201 `{ success, data, message }`                                                    |
| PUT    | `/api/schedule/events/[id]` | Session | Body: title?, startTime?, endTime?, description?, color?                | `{ success, data, message }`                                                        |
| DELETE | `/api/schedule/events/[id]` | Session | —                                                                       | `{ success, message }`                                                              |

---

## 23. Shortcuts

| Method | Path                           | Auth    | Request                             | Response                                              |
| ------ | ------------------------------ | ------- | ----------------------------------- | ----------------------------------------------------- |
| GET    | `/api/shortcuts/personal`      | Session | —                                   | `{ success, data }` (id, code, message)               |
| POST   | `/api/shortcuts/personal`      | Session | Body: `{ message }` (max 255 chars) | 201 `{ success, data, message }` (auto code e.g. /21) |
| DELETE | `/api/shortcuts/personal/[id]` | Session | —                                   | `{ success, message }`                                |
| GET    | `/api/shortcuts/team`          | Session | —                                   | `{ success, data }` (team shortcuts: userId null)     |

---

## 24. SMS

| Method | Path                           | Auth    | Request                                  | Response                                                                   |
| ------ | ------------------------------ | ------- | ---------------------------------------- | -------------------------------------------------------------------------- |
| POST   | `/api/sms/send`                | Session | Body: recipients[], message, fromNumber? | `{ success, data: { results }, message, error? }` (Telnyx send + comm log) |
| GET    | `/api/sms/history`             | Session | Query: page, limit                       | `{ success, data, pagination }`                                            |
| GET    | `/api/sms/history/[contactId]` | Session | Query: page, limit                       | `{ success, data, contact, pagination }`                                   |

---

## 25. SIP / WebRTC credentials

Returns the authenticated user's SIP/WebRTC connection config and a short-lived Telnyx WebRTC token. The mobile app should call this after login instead of storing any Telnyx keys or SIP credentials locally.

| Method | Path                   | Auth    | Request | Response                                                                         |
| ------ | ---------------------- | ------- | ------- | -------------------------------------------------------------------------------- |
| GET    | `/api/sip/credentials` | Session | —       | `{ success, data: { connectionId, callerIdName, callerIdNumber, webrtcToken } }` |

**Response fields:**

| Field            | Type           | Description                                                                                                   |
| ---------------- | -------------- | ------------------------------------------------------------------------------------------------------------- |
| `connectionId`   | string         | Telnyx voice-app / connection UUID                                                                            |
| `callerIdName`   | string         | Company name (display name for outbound calls)                                                                |
| `callerIdNumber` | string         | E.164 company phone number for caller ID                                                                      |
| `webrtcToken`    | string \| null | Short-lived JWT for Telnyx WebRTC SDK; `null` if credential creation is not supported for the connection type |

---

## 26. Telnyx — main

| Method  | Path                         | Auth               | Request                                                                           | Response                                                                                                                |
| ------- | ---------------------------- | ------------------ | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| POST    | `/api/telnyx`                | Session (optional) | Body: message, phoneNumber                                                        | Sends SMS via Telnyx (legacy/inbox); `{ success }` or error                                                             |
| GET     | `/api/telnyx/test`           | No                 | —                                                                                 | Tests Telnyx API key + messaging profile; `{ success, phoneNumber, hasApiKey, profileStatus, profileDetails?, error? }` |
| POST    | `/api/telnyx/dial`           | Session            | Body: to, from?, clientId?                                                        | Initiates outbound call; `{ success, callId, callLegId }` or 400/401/500                                                |
| GET     | `/api/telnyx/call-webhook`   | No                 | —                                                                                 | `{ success: true }`                                                                                                     |
| POST    | `/api/telnyx/call-webhook`   | No                 | Telnyx event payload                                                              | Handles voice (IVR, transfer, hangup, recording); 200                                                                   |
| PUT     | `/api/telnyx/call-webhook`   | No                 | Same as POST                                                                      | Same as POST                                                                                                            |
| GET     | `/api/telnyx/webhook`        | No                 | —                                                                                 | `{ success: true }`                                                                                                     |
| POST    | `/api/telnyx/webhook`        | No                 | Telnyx SMS webhook                                                                | Inbound SMS: A2P forward or local inbox/comm log; 200                                                                   |
| PUT     | `/api/telnyx/webhook`        | No                 | Same as POST                                                                      | Same as POST                                                                                                            |
| OPTIONS | `/api/telnyx/webhook`        | No                 | —                                                                                 | 200 (CORS)                                                                                                              |
| OPTIONS | `/api/telnyx/webhook-backup` | No                 | —                                                                                 | 200                                                                                                                     |
| GET     | `/api/telnyx/webhook-backup` | No                 | —                                                                                 | `{ success: true }`                                                                                                     |
| POST    | `/api/telnyx/webhook-backup` | No                 | Any JSON                                                                          | Logs and returns `{ success: true }` (Telnyx failover)                                                                  |
| PUT     | `/api/telnyx/webhook-backup` | No                 | Same as POST                                                                      | Same as POST                                                                                                            |
| GET     | `/api/telnyx/test-call`      | No                 | Query: to?                                                                        | Simulates incoming call to test IVR; returns description                                                                |
| POST    | `/api/telnyx/test-call`      | No                 | Body: `{ to }`                                                                    | Same                                                                                                                    |
| GET     | `/api/telnyx/test-call-end`  | No                 | Query: callId?                                                                    | Sends test call.hangup webhook to call-webhook                                                                          |
| POST    | `/api/telnyx/test-call-end`  | No                 | Body: `{ callId? }`                                                               | Same                                                                                                                    |
| GET     | `/api/telnyx/test-webhook`   | No                 | Query: from?, text?, to?                                                          | Sends test SMS webhook to /api/telnyx/webhook                                                                           |
| POST    | `/api/telnyx/test-webhook`   | No                 | Form: from, text, to                                                              | Same                                                                                                                    |
| POST    | `/api/telnyx/answer-call`    | No                 | Body: `{ callId }`                                                                | Telnyx answer + recording/AMD; `{ success }`                                                                            |
| POST    | `/api/telnyx/hangup`         | No                 | Body: `{ callId }`                                                                | Telnyx hangup; `{ success }`                                                                                            |
| GET     | `/api/telnyx/setup-company`  | Session            | Query: companyId                                                                  | `{ billingGroup, phoneNumbers }` or 401                                                                                 |
| POST    | `/api/telnyx/setup-company`  | Session            | Body: companyId, phoneCount, country_iso?, phone_number_type?, area_code?, state? | Bulk order numbers for company; `{ success, billingGroup, order, message }`                                             |

---

## 27. Telnyx — numbers

| Method | Path                                    | Auth    | Request                                                                                 | Response                                                                           |
| ------ | --------------------------------------- | ------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| GET    | `/api/telnyx/numbers/search`            | No      | Query: country_code?, area_code?, phone_number?, limit?, features? (comma)              | `{ success, numbers, meta }` (available numbers)                                   |
| GET    | `/api/telnyx/numbers/list`              | Session | Query: messaging_profile_id?, search?, companyOnly?                                     | `{ numbers }` (Telnyx account numbers)                                             |
| POST   | `/api/telnyx/numbers/buy`               | Session | Body: `{ phone_numbers: string[] }`                                                     | Order + assign + create CompanyPhoneNumber; `{ success, order, orderId, numbers }` |
| POST   | `/api/telnyx/numbers/update`            | No      | Body: phone_number_id, connection_id?, messaging_profile_id?, tags?, emergency_enabled? | Telnyx PATCH number; `{ success, number }`                                         |
| GET    | `/api/telnyx/numbers/orders`            | Session | Query: page, limit                                                                      | `{ success, orders, meta }` (orders containing company numbers)                    |
| DELETE | `/api/telnyx/numbers/[phone_number_id]` | No      | —                                                                                       | Telnyx DELETE number; `{ success }`                                                |

---

## 28. Telnyx — porting

| Method | Path                                     | Auth | Request                                                                                                                                                                                                                                                 | Response                                         |
| ------ | ---------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| POST   | `/api/telnyx/porting/check`              | No   | Body: `{ phone_numbers: string[] }`                                                                                                                                                                                                                     | `{ success, results }` (portable, carrier, etc.) |
| POST   | `/api/telnyx/porting/orders`             | No   | Body: phone_numbers[], end_user_name?, authorized_person_name?, account_number?, billing_telephone_number?, customer_reference?, pin_passcode?, customer_group_reference?, service_address?, requested_foc_date?, messaging_profile_id?, connection_id? | `{ success, order, orderId }`                    |
| GET    | `/api/telnyx/porting/orders`             | No   | Query: page, limit                                                                                                                                                                                                                                      | List porting orders; `{ success, orders }`       |
| GET    | `/api/telnyx/porting/loa-configurations` | No   | —                                                                                                                                                                                                                                                       | `{ success, configurations }`                    |

---

## 29. Telnyx — verified numbers

| Method | Path                                  | Auth | Request                                     | Response                                          |
| ------ | ------------------------------------- | ---- | ------------------------------------------- | ------------------------------------------------- |
| GET    | `/api/telnyx/verified-numbers`        | No   | Query: page?, limit?, search?               | `{ success, numbers, meta }`                      |
| POST   | `/api/telnyx/verified-numbers`        | No   | Body: `{ phone_number }`                    | Request verification; `{ success, verification }` |
| POST   | `/api/telnyx/verified-numbers/verify` | No   | Body: `{ phone_number, verification_code }` | Verify code; `{ success, verified }`              |

---

## 30. Telnyx — IVR (Call Control proxy)

| Method | Path                     | Auth | Request                                                                                                                                                    | Response                                                       |
| ------ | ------------------------ | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| POST   | `/api/telnyx/ivr/gather` | No   | Body: call_control_id, audio_url, invalid_audio_url?, timeout_millis?, minimum_digits?, maximum_digits?, terminating_digit?, finish_on_key?, client_state? | Telnyx gather_using_audio; `{ success, result }`               |
| POST   | `/api/telnyx/ivr/speak`  | No   | Body: call_control_id, text, voice?, language?                                                                                                             | Telnyx speak; `{ success, result }`                            |
| POST   | `/api/telnyx/ivr/bridge` | No   | Body: call_control_id, to, from?, timeout_secs?                                                                                                            | Telnyx bridge; `{ success, result }`                           |
| GET    | `/api/telnyx/ivr/flows`  | No   | —                                                                                                                                                          | `{ success, flows: [] }` (stub; real flows are /api/ivr/flows) |
| POST   | `/api/telnyx/ivr/flows`  | No   | Body: title, greeting_file?, schedule_rules?, failover_config?                                                                                             | Stub; returns mock flow id                                     |

---

## 31. Upload

| Method | Path                 | Auth    | Request                                 | Response                                      |
| ------ | -------------------- | ------- | --------------------------------------- | --------------------------------------------- |
| POST   | `/api/upload/ivr`    | Session | multipart: file (audio), type?          | `{ url }` (CDN URL); 10MB max; MP3, WAV, etc. |
| POST   | `/api/upload/logo`   | No      | multipart: logo (file), type? (company) | `{ url }` (file path)                         |
| POST   | `/api/upload/avatar` | Session | multipart: avatar (file)                | `{ success, data: { url }, message }`         |

---

## 32. Webhooks (inbound)

| Method | Path                                 | Auth | Request                                                                                            | Response                                              |
| ------ | ------------------------------------ | ---- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| POST   | `/api/webhooks/inbound-email`        | No   | JSON: From/from, To/to, Subject/subject, TextBody/body, HtmlBody?, MessageID?, Date?, Attachments? | processInboundEmail; 201 `{ message, id }` or 202/500 |
| POST   | `/api/webhooks/telnyx`               | No   | Telnyx event payload (e.g. call.initiated)                                                         | `{ success, userId, userIds, companyId }`             |
| POST   | `/api/webhooks/telnyx/incoming-call` | No   | Telnyx voice payload                                                                               | Forwards to /api/telnyx/call-webhook                  |
| POST   | `/api/webhooks/telnyx/incoming-sms`  | No   | Telnyx SMS payload                                                                                 | Forwards to /api/telnyx/webhook                       |

---

## 33. Embed

| Method | Path                   | Auth | Request         | Response                                                                                            |
| ------ | ---------------------- | ---- | --------------- | --------------------------------------------------------------------------------------------------- |
| GET    | `/embed/leadbox/[id]`  | No   | id or "default" | **JavaScript** (Content-Type: application/javascript): leadbox script for company; 404 if not found |
| GET    | `/embed/leadform/[id]` | No   | id or "default" | **JavaScript**: leadform script; 404 if not found                                                   |

---

## 34. Logout

| Method | Path      | Auth | Request          | Response                                                          |
| ------ | --------- | ---- | ---------------- | ----------------------------------------------------------------- |
| GET    | `/logout` | No   | Query: redirect? | Clears app_session cookie; redirect 303 to redirect \|\| '/login' |
| POST   | `/logout` | No   | Query: redirect? | Same                                                              |

---

## 35. Current user

## 36. Account deletion

| Method | Path              | Auth    | Request | Response |
| ------ | ----------------- | ------- | ------- | -------- |
| DELETE | `/api/account`    | Session | —       | `{ success, message }` |

**Deletes the current authenticated user account.**

- Requires valid session (`app_session` cookie).
- Deletes user record and all associated data (contacts, logs, company membership, etc.).
- Logs out user and clears session cookie.
- Response: `{ success, message }` (message may indicate deletion status or errors).

**Example request:**

```http
DELETE /api/account
Cookie: app_session=<session-cookie>
```

**Example response:**

```json
{
	"success": true,
	"message": "Account deleted successfully."
}
```

| Method | Path      | Auth    | Request                     | Response                                                       |
| ------ | --------- | ------- | --------------------------- | -------------------------------------------------------------- |
| GET    | `/api/me` | Session | —                           | `{ success, data: { id, name, email, phone, company, role, avatar } }` |
| PUT    | `/api/me` | Session | `{ name?, email?, avatar? }` | `{ success, data: { ...updatedUser } }`                        |

Example request:

```http
PUT /api/me
Content-Type: application/json
Cookie: app_session=<session-cookie>

{
  "name": "Jane Doe",
  "email": "jane@acme.com"
}
```

Example request:

```http
GET /api/me
Cookie: app_session=<session-cookie>
```

Example response:

```json
{
	{
		"success": true,
		"data": {
			"id": "clx...",
			"name": "Jane Agent",
			"email": "jane@acme.com",
			"phone": null,
			"company": {
				"id": "cmp_123",
				"name": "Acme"
			},
			"role": "admin"
		}
	}

	---

	## 37. Tasks

	| Method | Path               | Auth    | Request                                                                    | Response                                             |
	| ------ | ------------------ | ------- | -------------------------------------------------------------------------- | ---------------------------------------------------- |
	| GET    | `/api/tasks`       | Session | Query: page, limit, contactId?, assignedToId?, status?                     | `{ success, data, pagination }`                      |
	| POST   | `/api/tasks`       | Session | Body: title, description?, contactId?, dueDate?, assignedTo?, status?      | 201 `{ success, data, message }`                     |
	| GET    | `/api/tasks/[id]`  | Session | —                                                                          | `{ success, data }` (spec task shape)                |
	| PUT    | `/api/tasks/[id]`  | Session | Body: title?, description?, contactId?, dueDate?, assignedTo?, status?     | `{ success, data, message }`                         |
	| DELETE | `/api/tasks/[id]`  | Session | —                                                                          | `{ success, message }`                               |

	**Spec task shape:**
	- `id`: string
	- `title`: string
	- `description`: string (can be empty)
	- `status`: string (`todo` \| `in_progress` \| `completed` \| `cancelled`)
	- `dueDate`: ISO-string \| null
	- `contactId`: string \| null
	- `assignedToId`: string \| null
	- `createdAt`: ISO-string
	- `updatedAt`: ISO-string
	- `contact`: object \| null (`{ id, name, phone, email }`)
	- `assignedTo`: object \| null (`{ id, name, email }`)

	---

	## Standard response shapes

- **specSuccess:** `{ success: true, data?, message? }`
- **specError/unauthorized:** `{ success: false, error, code? }` with status 401/400/404/500
- **pagination:** `{ page, limit, total, totalPages }`

---

## Form / page actions (not REST)

- **POST /signup** — Form: name, email, password, passwordConfirm. Redirects to /create-company; sets app_session.
- **POST /create-company** — Form: name, website?. Creates company, owner membership; returns `{ success, companyId }` or fail().

This file lists every `+server.ts` endpoint in the repo. For A2P backend (Python), IVR flow logic, and DB schema see `A2P-API-DOCUMENTATION.md` and `backend-api.md`.
