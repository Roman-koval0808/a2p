# A2P Backend — API & System Documentation

> **Frontend integration:** For building the communication log UI against this backend (DB read-only, no REST for comm log), see [frontend-integration-a2p.md](./frontend-integration-a2p.md).

## 1. Overview

The A2P (Application-to-Person) backend is a **Python/Flask** stack that handles:

- **Voice** — Telnyx webhooks, IVR (billing/support), voicemail, transcription (OpenAI Whisper), KB/meeting logic
- **SMS** — Telnyx webhooks, KB replies, appointment scheduling over SMS, STOP/HELP
- **Email** — Gmail poll, OpenAI triage (summary, urgency, category), scheduling orchestration, reminders

All channels write to a shared **communication log** (`comm_events`) and **contacts** (`contacts`, `contact_identities`).  
Database: **PostgreSQL** or **SQLite** via raw SQL (no ORM).

---

## 2. Services & Ports

| Service   | Entry script   | Default port | Description                          |
| --------- | -------------- | ------------ | ------------------------------------ |
| **Calls** | `run_calls.py` | **5200**     | Telnyx voice webhook, IVR, voicemail |
| **SMS**   | `run_sms.py`   | **5300**     | Telnyx SMS webhook, KB, booking      |
| **Email** | `run_email.py` | **5100**     | Gmail poll, triage, threads, orch.   |

Ports are overridable via env: `SMS_PORT`, and for email `PORT` (see config). Calls service uses port **5200** in `run_calls.py`.

---

## 3. Endpoints (by service)

### 3.1 Calls service (port 5200)

Base URL (example): `http://localhost:5200`

| Method   | Path                     | Description                       |
| -------- | ------------------------ | --------------------------------- |
| **GET**  | `/health`                | Liveness. Returns `{"ok": true}`. |
| **POST** | `/webhooks/telnyx/voice` | Telnyx voice/call webhook.        |

**GET /health**

- **Response:** `200`, body `{"ok": true}`.

**POST /webhooks/telnyx/voice**

- **Content-Type:** `application/json`
- **Body:** Telnyx webhook payload (e.g. `data.id`, `data.event_type`, `data.payload` with `call_control_id`, `from`, `to`, `digits`, `recording_id`, `recording_urls`, etc.).
- **Behavior:** Deduplicated by `data.id`. Handles:
  - `call.initiated` — create contact, log comm event, create `voice_calls` row, answer call.
  - `call.answered` — IVR menu (1 = Billing, 2 = Support) or bridge to rep leg.
  - `call.gather.ended` / `call.dtmf.received` — route to billing/support number or voicemail when closed/no-answer.
  - `call.hangup` — update call status, optionally start voicemail on rep leg hangup.
  - `call.recording.saved` — download recording, transcribe (OpenAI Whisper), run KB/meeting logic, update `voice_calls`, append `comm_events`, insert into `notifications` (if table exists).
- **Response:** Always `200`; body e.g. `{"ok": true}`, optional keys: `dedup`, `ignored`, `unhandled`, `closed`, `note`.

---

### 3.2 SMS service (port 5300)

Base URL (example): `http://localhost:5300`

| Method   | Path                   | Description                       |
| -------- | ---------------------- | --------------------------------- |
| **GET**  | `/health`              | Liveness. Returns `{"ok": true}`. |
| **POST** | `/webhooks/telnyx/sms` | Telnyx SMS webhook.               |

**GET /health**

- **Response:** `200`, body `{"ok": true}`.

**POST /webhooks/telnyx/sms**

- **Content-Type:** `application/json`
- **Body:** Telnyx webhook payload. Only `event_type === "message.received"` and inbound direction are processed.
- **Behavior:** Deduplicated by `data.id`. For each inbound SMS:
  - Upsert contact by phone, insert into `sms_messages`, call `record_comm_event` (channel `sms`, direction `in`).
  - STOP/HELP/START handled; optional appointment flow (slots + book); otherwise KB reply and outbound `record_comm_event`.
- **Response:** `200`; body e.g. `{"ok": true}`, optional `dedup`, `ignored`, `note`.

---

### 3.3 Email service (port 5100)

Base URL (example): `http://localhost:5100`

| Method   | Path                         | Description                                           |
| -------- | ---------------------------- | ----------------------------------------------------- |
| **GET**  | `/healthz`                   | Liveness + DB check.                                  |
| **GET**  | `/api/emails/incoming`       | List last 200 incoming emails (from DB).              |
| **GET**  | `/api/threads`               | List last 200 email threads.                          |
| **POST** | `/api/orchestrator/run_once` | Run orchestrator once (process unprocessed incoming). |

**GET /healthz**

- **Response:** `200` and `{"ok": true}` if DB is reachable; `500` and `{"ok": false, "error": "..."}` on failure.

**GET /api/emails/incoming**

- **Response:** `200`, JSON:
  - `emails`: array of objects:
    - `msg_id`, `thread_id`, `from`, `to`, `subject`, `snippet`
    - `summary`, `urgency` (int, default 2), `category`, `subcat`
    - `internal_ts` (ms), `created_at`
  - Up to 200 rows, ordered by `internal_ts DESC`.

**GET /api/threads**

- **Response:** `200`, JSON:
  - `threads`: array of objects:
    - `thread_id`, `status`, `proposed_slots` (array of ISO strings), `selected_slot_iso`, `calendar_event_id`, `contact_email`, `updated_at`
  - Up to 200 rows, ordered by `updated_at DESC`.

**POST /api/orchestrator/run_once**

- **Content-Type:** `application/json` (optional)
- **Body (optional):** `{ "limit": 25 }` — max number of unprocessed incoming emails to process in this run.
- **Response:** `200`, JSON: `{"ok": true, "processed": <n>, "watermark_ms": <ts>}`.

---

## 4. Database

- **Connection:** Configured via `DATABASE_URL` (e.g. `postgresql://a2p_user:***@localhost:5432/a2p_db` or `sqlite:///a2p_comm.db`).
- **Access:** Direct SQL via `a2p.db.DB` (no REST API for generic DB access). Email service exposes only the endpoints above.

### 4.1 Shared (profiles)

**contacts**

| Column       | Type      | Description |
| ------------ | --------- | ----------- |
| contact_id   | TEXT PK   | UUID.       |
| name         | TEXT      |             |
| company      | TEXT      |             |
| notes        | TEXT      |             |
| created_at   | TIMESTAMP |             |
| updated_at   | TIMESTAMP |             |
| last_seen_at | TIMESTAMP |             |

**contact_identities**

| Column     | Type      | Description                |
| ---------- | --------- | -------------------------- |
| contact_id | TEXT      | FK to contacts.            |
| kind       | TEXT      | `email` or `phone`.        |
| value      | TEXT      | Normalized email or phone. |
| is_primary | INTEGER   | 0/1.                       |
| created_at | TIMESTAMP |                            |

- Unique on `(kind, value)`.

**comm_events** (communication log)

| Column         | Type      | Description                                     |
| -------------- | --------- | ----------------------------------------------- |
| id             | PK        | Auto.                                           |
| channel        | TEXT      | `voice`, `sms`, `email`.                        |
| direction      | TEXT      | `in`, `out`.                                    |
| contact_id     | TEXT      |                                                 |
| identity_kind  | TEXT      | `phone`, `email`.                               |
| identity_value | TEXT      |                                                 |
| external_id    | TEXT      | e.g. Telnyx message/call/recording id.          |
| thread_key     | TEXT      | e.g. thread_id (email), phone, call_control_id. |
| subject        | TEXT      |                                                 |
| body_text      | TEXT      | Content/transcript.                             |
| summary_gpt    | TEXT      | AI summary (email set; voice/sms often empty).  |
| urgency_gpt    | INTEGER   | 1–5 (email from triage).                        |
| category_gpt   | TEXT      |                                                 |
| subcat_gpt     | TEXT      |                                                 |
| internal_ts    | BIGINT    | ms.                                             |
| created_at     | TIMESTAMP |                                                 |

- Indexes: `(contact_id, internal_ts)`, `(thread_key, internal_ts)`.

### 4.2 Voice (calls)

**voice_calls**

| Column                   | Type        |
| ------------------------ | ----------- |
| id                       | PK          |
| inbound_call_control_id  | TEXT UNIQUE |
| outbound_call_control_id | TEXT        |
| from_number, to_number   | TEXT        |
| dept                     | TEXT        |
| status                   | TEXT        |
| started_at, ended_at     | TIMESTAMP   |
| voicemail_recording_id   | TEXT        |
| voicemail_url            | TEXT        |
| voicemail_local_path     | TEXT        |
| transcript               | TEXT        |
| kb_answer                | TEXT        |
| answer_token             | TEXT        |

**answer_pages**

| Column     | Type      |
| ---------- | --------- |
| token      | TEXT PK   |
| contact_id | TEXT      |
| channel    | TEXT      |
| question   | TEXT      |
| answer     | TEXT      |
| created_at | TIMESTAMP |

### 4.3 Telnyx dedup

**telnyx_events**

| Column      | Type      |
| ----------- | --------- |
| id          | TEXT PK   |
| event_type  | TEXT      |
| received_at | TIMESTAMP |

### 4.4 SMS

**sms_messages**

| Column                 | Type      |
| ---------------------- | --------- |
| id                     | PK        |
| telnyx_message_id      | TEXT      |
| direction              | TEXT      |
| from_number, to_number | TEXT      |
| body                   | TEXT      |
| status                 | TEXT      |
| created_at             | TIMESTAMP |

**sms_sessions** — per-phone state for booking flow.

**sms_optouts** — STOP/START; `phone` PK, `opted_out` (0/1).

### 4.5 Email

**emails_incoming** — msg_id, thread_id, from_email, to_email, subject, snippet, body_text, summary_gpt, urgency_gpt, category_gpt, subcat_gpt, internal_ts, created_at.

**emails_outgoing** — same shape for sent mail.

**email_threads** — thread_id PK, status, last_inbound_msg_id, proposed_slots_json, selected_slot_iso, calendar_event_id, contact_email, updated_at.

**processed_incoming** — msg_id PK, processed_at (watermark for orchestrator).

**orchestrator_state** — k/v (e.g. `last_processed_internal_ts`).

**reminders** — thread_id, to_email, send_at_ms, status, related_event_id, created_at.

---

## 5. Environment (main)

- **Database:** `DATABASE_URL` (PostgreSQL or SQLite).
- **Telnyx:** `TELNYX_API_KEY`, `TELNYX_CONNECTION_ID`, `BILLING_FORWARD_TO`, `SUPPORT_FORWARD_TO`; optional `TELNYX_PUBLIC_KEY`, `TELNYX_SMS_FROM`.
- **OpenAI:** `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_TRIAGE_MODEL`, `KB_VECTOR_STORE_ID`.
- **Google:** `GOOGLE_TOKEN_PATH`, `GOOGLE_CREDENTIALS_PATH`, `CALENDAR_ID` / `GCAL_CALENDAR_ID`.
- **Calls:** `RECORDINGS_DIR`, `CALLS_PORT` (not used in `run_calls.py`; script uses 5200), `VOICEMAIL_*`, `BUSINESS_TZ`, `BUSINESS_HOURS_*`.
- **SMS:** `SMS_PORT` (default 5300), `TELNYX_SMS_FROM`.
- **Email:** `PORT` (default 5100), `EMAIL_POLL_QUERY`, `EMAIL_POLL_SECS`, `ORCH_POLL_SECS`, `REMINDER_POLL_SECS`, etc.

---

## 6. Summary: backend-only endpoints

| Service | Method | Endpoint                     | Purpose               |
| ------- | ------ | ---------------------------- | --------------------- |
| Calls   | GET    | `/health`                    | Health                |
| Calls   | POST   | `/webhooks/telnyx/voice`     | Telnyx voice webhook  |
| SMS     | GET    | `/health`                    | Health                |
| SMS     | POST   | `/webhooks/telnyx/sms`       | Telnyx SMS webhook    |
| Email   | GET    | `/healthz`                   | Health + DB           |
| Email   | GET    | `/api/emails/incoming`       | List incoming emails  |
| Email   | GET    | `/api/threads`               | List email threads    |
| Email   | POST   | `/api/orchestrator/run_once` | Run orchestrator once |

There are **no** other backend endpoints in this codebase (no `/api/communication-logs`, no `/api/recording/...`, no `/api/messages`). The communication log is the **`comm_events`** table; consumers read it directly from the database or would need new endpoints to be added.
