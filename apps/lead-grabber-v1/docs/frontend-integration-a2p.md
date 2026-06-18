# Frontend integration guide: A2P backend

Use this when building the communication log (and any related UI) against the AI developer's backend. **Do not change anything on the server**; only read data and call existing HTTP endpoints where they exist.

---

## 1. What's on the server (read-only overview)

- **Database:** PostgreSQL 16, one database: `a2p_db`, user `a2p_user`, port `5432` on the VPS (often reached from your machine via SSH tunnel or a "connect from local" setup).
- **Connection string:**  
  `postgresql://a2p_user:<password>@localhost:5432/a2p_db`  
  When you're on the VPS, use `localhost:5432`. From your laptop, use an **SSH tunnel** so `localhost` points at the VPS Postgres:
  - Run: `ssh -L 5433:localhost:5432 root@<VPS_IP>` (keep it open).
  - Then use: `postgresql://a2p_user:<password>@localhost:5433/a2p_db` (port 5433 on your machine forwards to 5432 on the VPS).  
    The username in the URL is the **PostgreSQL role** (e.g. `a2p_user`), not the SSH user (`root`).
- **Backend apps:** Three separate Python (Flask) services:
  - **Calls:** `run_calls.py` → port **5200**
  - **SMS:** `run_sms.py` → port **5300**
  - **Email:** `run_email.py` → port **5100** (configurable via `PORT`)

There are **no** REST APIs for the communication log or contacts. The AI developer's approach: **frontend (or a small BFF) should read the data from the database.** The backend only writes into the DB.

---

## 2. How the frontend should get data

### Option A: Frontend (or BFF) talks to PostgreSQL (recommended by the AI dev)

- Your app (or a small backend-for-frontend on your side) connects to `a2p_db` with the connection string above (over SSH tunnel or VPN so `localhost:5432` is the VPS).
- You **only read** from the DB; you do not create tables or change schema.
- Use the tables below as the source of truth for:
  - **Communication log** → `comm_events` (and joins to `contacts` / `contact_identities`)
  - **Contacts** → `contacts` + `contact_identities`
  - Optional extra detail: `voice_calls`, `sms_messages`, `emails_incoming` (see below).

### Option B: Use the only existing REST APIs (email only)

- These exist on the **email service** only, port **5100** (replace `HOST` with the VPS host or tunnel):

| What you need            | Method | URL                                          | Notes                                            |
| ------------------------ | ------ | -------------------------------------------- | ------------------------------------------------ |
| List incoming emails     | GET    | `http://HOST:5100/api/emails/incoming`       | Last 200, with summary/urgency/category.         |
| List email threads       | GET    | `http://HOST:5100/api/threads`               | Last 200 threads (status, slots, contact_email). |
| Trigger email processing | POST   | `http://HOST:5100/api/orchestrator/run_once` | Optional body: `{"limit": 25}`.                  |

- There are **no** REST endpoints for:
  - Communication log (all channels)
  - Contacts
  - Voice calls
  - SMS messages

So for the **communication log page**, you must use the DB (Option A), not REST.

---

## 3. Database tables the frontend needs to know

### 3.1 Communication log (main table for the "log" page)

**Table: `comm_events`**

One row per event (inbound/outbound call, SMS, email). All channels write here.

| Column           | Type            | Meaning                                                                  |
| ---------------- | --------------- | ------------------------------------------------------------------------ |
| `id`             | bigint / serial | Primary key.                                                             |
| `channel`        | text            | `voice` \| `sms` \| `email`.                                             |
| `direction`      | text            | `in` \| `out`.                                                           |
| `contact_id`     | text            | UUID linking to `contacts.contact_id`.                                   |
| `identity_kind`  | text            | `phone` \| `email`.                                                      |
| `identity_value` | text            | Phone number or email address.                                           |
| `external_id`    | text            | External id (e.g. Telnyx message/call/recording id).                     |
| `thread_key`     | text            | Thread/conversation key (e.g. email thread_id, or phone number for SMS). |
| `subject`        | text            | Subject line or short title (e.g. "Inbound SMS", "Voicemail recorded").  |
| `body_text`      | text            | Main content: transcript (voice), message body (SMS), email body.        |
| `summary_gpt`    | text            | AI summary (often filled for email; can be empty for voice/SMS).         |
| `urgency_gpt`    | int             | 1–5 (used for email; voice/SMS may be fixed values).                     |
| `category_gpt`   | text            | Category from AI (email) or fixed (e.g. "SMS", "Voice").                 |
| `subcat_gpt`     | text            | Subcategory.                                                             |
| `internal_ts`    | bigint          | Timestamp in milliseconds (for ordering).                                |
| `created_at`     | timestamp       | Row creation time.                                                       |

**Example: "last 50 comm events" (what a log page might show)**

```sql
SELECT
  e.id,
  e.channel,
  e.direction,
  e.contact_id,
  e.identity_kind,
  e.identity_value,
  e.subject,
  e.body_text,
  e.summary_gpt,
  e.urgency_gpt,
  e.category_gpt,
  e.subcat_gpt,
  e.internal_ts,
  e.created_at,
  c.name AS contact_name,
  c.company AS contact_company
FROM comm_events e
LEFT JOIN contacts c ON c.contact_id = e.contact_id
ORDER BY e.internal_ts DESC
LIMIT 50;
```

Filtering examples:

- By contact: `WHERE e.contact_id = $1`
- By channel: `WHERE e.channel = $1` (`voice` / `sms` / `email`)
- By direction: `WHERE e.direction = $1`
- By time: `WHERE e.internal_ts >= $1 AND e.internal_ts <= $2` (ms)

---

### 3.2 Contacts (who is calling / texting / emailing)

**Table: `contacts`**

| Column         | Type      | Meaning                                                            |
| -------------- | --------- | ------------------------------------------------------------------ |
| `contact_id`   | text (PK) | UUID. Stable; never changed for existing customers.                |
| `name`         | text      | Display name (updated from latest email/SMS/voice when available). |
| `company`      | text      | Company (same).                                                    |
| `notes`        | text      | Free text.                                                         |
| `created_at`   | timestamp | First time seen.                                                   |
| `updated_at`   | timestamp | Last update.                                                       |
| `last_seen_at` | timestamp | Last activity.                                                     |

**Table: `contact_identities`**

Links a contact to phone/email. One contact can have multiple identities (e.g. one email and one phone).

| Column       | Type      | Meaning                            |
| ------------ | --------- | ---------------------------------- |
| `contact_id` | text      | References `contacts.contact_id`.  |
| `kind`       | text      | `phone` \| `email`.                |
| `value`      | text      | Normalized phone or email.         |
| `is_primary` | int       | 0 or 1.                            |
| `created_at` | timestamp | When this identity was first seen. |

Important for the product logic:

- **New customer** → new `contact_id` and new row(s) in `contact_identities`.
- **Existing customer** → same `contact_id` and same `value`; only `contacts.updated_at`, `last_seen_at`, and optionally `name`/`company` are updated from the current request. So the frontend can rely on `contact_id` and `identity_value` as stable identifiers.

---

### 3.3 Optional: channel-specific detail

If you need more than what's in `comm_events`:

- **Voice:** `voice_calls` — e.g. `from_number`, `to_number`, `transcript`, `voicemail_url`, `voicemail_local_path`, `kb_answer`, `status`, `started_at`, `ended_at`. Join to log by `external_id` (e.g. call/recording id) or by `contact_id` + time.
- **SMS:** `sms_messages` — `from_number`, `to_number`, `body`, `direction`, `status`, `created_at`. Match to `comm_events` by `identity_value` (phone) and time or `external_id` (Telnyx message id).
- **Email:** `emails_incoming` / `emails_outgoing` — or use the REST APIs above instead of querying these tables.

You can build the main "communication log" experience from **only** `comm_events` + `contacts` (+ optionally `contact_identities` for listing phones/emails per contact).

---

## 4. How the communication log page is supposed to integrate

- **Data source:** The communication log is the **`comm_events`** table (plus contact names from `contacts`). There is no "communication log API" on the server; the frontend (or your BFF) **fetches from the DB**.
- **What the backend does:** When someone calls the number (**+17059985374**), sends an SMS to it, or emails **colabclearskysoftware@gmail.com**, the backend:
  - Creates or updates a contact (without changing customer ID or number).
  - Writes one or more rows into `comm_events` (and optionally into `voice_calls` / `sms_messages` / email tables).
- **What the frontend does:**
  - Connect to `a2p_db` (read-only) and run queries like the one above.
  - Show a list/timeline of events (e.g. last 50), with filters (contact, channel, direction, date range).
  - Optionally link each row to a contact detail view (using `contact_id` and `contacts` / `contact_identities`).
  - For "purpose" / "summary", use `subject`, `summary_gpt`, `category_gpt`, `subcat_gpt`, and `body_text` from `comm_events`.

So: **integration = your app reads `comm_events` (and contacts) from the same DB the backend writes to.** No REST API is provided for that; the intended way is DB read access.

---

## 5. Base URLs (when you do use HTTP)

If the frontend or your BFF calls the Python services by HTTP (e.g. for email lists or triggering processing), use the **host** of the VPS (or the tunnel) and these ports:

- **Calls:** `http://<VPS_OR_TUNNEL_HOST>:5200`
  - Only used for webhooks by Telnyx; frontend typically does not call this.
- **SMS:** `http://<VPS_OR_TUNNEL_HOST>:5300`
  - Same; webhooks only.
- **Email:** `http://<VPS_OR_TUNNEL_HOST>:5100`
  - Use this for:
    - `GET /api/emails/incoming`
    - `GET /api/threads`
    - `POST /api/orchestrator/run_once`

Health checks (optional):

- `GET http://<HOST>:5200/health` (calls)
- `GET http://<HOST>:5300/health` (SMS)
- `GET http://<HOST>:5100/healthz` (email + DB check)

---

## 6. Summary for the frontend

- **DB:** PostgreSQL 16, `a2p_db`, user `a2p_user`; connect read-only (e.g. via SSH tunnel to the VPS).
- **Communication log:** Read from table **`comm_events`**, join **`contacts`** (and optionally **`contact_identities`**). No REST API for the log; "fetching the data from the DB" is the intended way.
- **Contacts:** Same DB; **`contacts`** and **`contact_identities`**; `contact_id` and phone/email are stable for existing customers; only "related data" (name, company, last_seen) is updated.
- **REST:** Only for email: base URL `http://<HOST>:5100` → `/api/emails/incoming`, `/api/threads`, `/api/orchestrator/run_once`.
- **Test number / email:** +17059985374, colabclearskysoftware@gmail.com — all inbound to these go through the backend and end up in the DB and in `comm_events`.

When you access the server, only inspect (DB + services); the frontend should only read from the DB and call the existing email endpoints as above.
