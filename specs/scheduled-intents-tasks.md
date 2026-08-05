# ClearSky Scheduled Intents — Implementation Task List

This document breaks down the implementation of **Scheduled Intents** (`specs/clearsky-scheduled-intents.md`) into modular, sequential tasks that can be executed and verified one by one.

---

## Section 1: Database Schema & Migration

- [ ] **Task 1.1: Add `ScheduledIntent` Model to Prisma Schema**
  - Edit `apps/lead-grabber-v1/prisma/schema.prisma`.
  - Add `ScheduledIntent` table with fields:
    - `id`: String (UUID / CUID primary key)
    - `clientId`: String (indexed)
    - `profileId`: String (indexed)
    - `intentType`: Enum / String (`SERVICE_RECALL`, `KEEP_IN_TOUCH`, `REVIEW_REQUEST`, `REP_INSTRUCTION`, `CUSTOMER_COMMITMENT_A`, `CUSTOMER_COMMITMENT_B`)
    - `dueAt`: DateTime (indexed)
    - `expiresAt`: DateTime?
    - `payload`: Json (stores exact quoted words, target date, channel, conversationId, topic, calculated target date)
    - `status`: Enum (`PENDING`, `DONE`, `SKIPPED`, `CANCELLED`, `EXPIRED`) (indexed)
    - `idempotencyKey`: String (unique)
    - `actor`: Enum / String (`CUSTOMER`, `BUSINESS`)
    - `createdAt`: DateTime (default now)
    - `updatedAt`: DateTime (updatedAt)
  - Add composite index on `(status, dueAt)`.

- [ ] **Task 1.2: Apply Database Migration**
  - Run database migration/push (`npx prisma db push` or migration script) against the primary database.
  - Verify table creation in local / staging environment.

---

## Section 2: AI Intent & Date Parsing Module

- [ ] **Task 2.1: Create Extraction Types & Prompt Interface**
  - File: `apps/lead-grabber-v1/src/lib/server/ai/scheduled-intent-parser.ts`
  - Define Zod schema / TypeScript interface for extraction output:
    - `hasFutureIntent`: boolean
    - `whatHeWants`: string
    - `rawTimeframe`: string (exact customer words, e.g. "a couple of weeks")
    - `calculatedTargetDate`: string (ISO date)
    - `confidence`: `'HIGH' | 'MEDIUM' | 'LOW'`
    - `actor`: `'CUSTOMER' | 'BUSINESS'` (Scenario A vs B)
    - `preferredChannel`: string | null
  
- [ ] **Task 2.2: Implement LLM Extraction Logic**
  - Integrate with `openai.ts` or `anthropic.ts` to process inbound message text.
  - Parse relative dates using customer timezone and message arrival timestamp (e.g. 4 Aug + 14 days = 18 Aug).
  - Enforce Confidence Threshold rule: if confidence is `LOW` or timeframe is vague ("sometime", "in the spring"), flag as non-schedulable so it routes as an agent manual call (e.g., Marcus scenario).

- [ ] **Task 2.3: Unit Tests for Intent Extraction**
  - File: `apps/lead-grabber-v1/src/lib/server/ai/scheduled-intent-parser.test.ts`
  - Test cases:
    - "I'll call you back in a couple of weeks" → `actor: CUSTOMER`, 14 days out, `confidence: HIGH`.
    - "Call me next Tuesday" → `actor: BUSINESS`, next Tuesday date, `confidence: HIGH`.
    - "Maybe sometime in the spring" → `confidence: LOW`, not auto-schedulable.

---

## Section 3: Instant Acknowledgment & CRM Dual-Record Creation

- [ ] **Task 3.1: Immediate Auto-Reply Sender (No Dates)**
  - File: `apps/lead-grabber-v1/src/lib/server/scheduled-intent-ack.ts`
  - Implement fixed, pre-approved acknowledgment template (e.g., *"Thanks [Name] — we'll look forward to hearing from you when you're back."*).
  - Ensure reply contains NO calculated dates or hallucinatable timeframes.
  - Mark auto-reply outbounds with flag preventing them from counting as "customer contact" (avoiding self-cancelling follow-ups).

- [ ] **Task 3.2: Dual-Record Persistence Writer**
  - File: `apps/lead-grabber-v1/src/lib/server/scheduled-intent-writer.ts`
  - Implement dual write function:
    1. **Total Trades CRM Note:** Write immutable factual record on customer profile ("Wants to discuss air conditioning. Said he'd call ~18 Aug").
    2. **ClearSky Schedule Row:** Write `ScheduledIntent` row with `dueAt` calculated as:
       - Scenario A (`actor == CUSTOMER`): `calculatedTargetDate` + 7 days grace period (e.g., 25 Aug).
       - Scenario B (`actor == BUSINESS`): `calculatedTargetDate` (exact date, e.g., 18 Aug).

---

## Section 4: Open Commitments & Score Decay Protection

- [ ] **Task 4.1: Open Commitment Evaluator**
  - File: `apps/lead-grabber-v1/src/lib/server/open-commitments.ts`
  - Create helper function `hasOpenCommitment(profileId)` that checks:
    - Active booked appointments.
    - Pending `ScheduledIntent` records with valid future `dueAt`.
    - In-progress jobs or outstanding quotes.

- [ ] **Task 4.2: Modify Engagement Score Decay Logic**
  - File: `apps/lead-grabber-v1/src/lib/server/cohort2-sweep.ts` (or score decay module)
  - Update idle time calculation: subtract the committed window duration from total inactive days rather than completely wiping record.
  - Suppress automatic cold category demotion during commitment window.

- [ ] **Task 4.3: Marketing & Nurture Suppression**
  - Gate automated nurture emails and keep-in-touch sweeps against `hasOpenCommitment()`.
  - **Exemption:** Ensure mandatory service reminders (furnace warranties, paid maintenance obligations) continue to fire regardless of open commitments.

---

## Section 5: Daily Schedule Runner & Intent Verification Sweep

- [ ] **Task 5.1: Create Scheduled Intents Sweep Engine**
  - File: `apps/lead-grabber-v1/src/lib/server/scheduled-intents-sweep.ts`
  - Query all pending intents where `dueAt <= now()` and `status == 'PENDING'`.

- [ ] **Task 5.2: Implement Type-Specific Verification Checks**
  - For each due intent, verify:
    1. Has customer contacted us since creation date?
    2. Has an appointment been booked?
    3. Has the job moved forward / won?
    4. Has customer opted out?
  - If **YES** to any: update status to `SKIPPED`. Do NOT pass to agent queue.
  - If expired (`expiresAt <= now()`): update status to `EXPIRED`. Log expiration metric.

- [ ] **Task 5.3: Hook Sweep into Daily Cron**
  - Register sweep in `apps/lead-grabber-v1/src/src/hooks.server.ts` or dedicated cron endpoint `/api/a2p/schedule/sweep`.

---

## Section 6: Orchestrator Handoff & Channel Routing

- [ ] **Task 6.1: Orchestrator Handoff Bridge**
  - Pass verified due intents to `apps/lead-grabber-v1/src/lib/server/orchestrator.ts`.
  - Ensure intent passes through business rules, office hours, and safety gating before landing in agent queue.

- [ ] **Task 6.2: Personalised Agent Draft Generator**
  - Format agent follow-up message using saved exact customer quote (e.g., *"You mentioned you'd be away a couple of weeks and would give us a call about air conditioning when you were back — thought I'd save you the job..."*).
  - Prohibit generic batch messaging.

- [ ] **Task 6.3: Channel Fallback Resolver**
  - File: `apps/lead-grabber-v1/src/lib/server/contact-channel-resolver.ts`
  - Implement channel priority fallback:
    1. Customer-requested channel.
    2. Original contact channel.
    3. Mobile (SMS).
    4. Email.
    5. Shared/Office landline -> convert to Manual Call task for agent.
    6. No contact info -> mark `UNREACHABLE` & notify agent.

---

## Section 7: Agent Schedule UI & Lookup Views

- [ ] **Task 7.1: Schedule API Endpoint**
  - Create GET `/api/a2p/schedule` endpoint filtering by `clientId`, `profileId`, `status`, and date range.
  - Keep separate from current task queue (`/api/a2p/tasks`).

- [ ] **Task 7.2: Customer Profile Schedule Component**
  - Add "Upcoming Scheduled Intents" list view on customer profile page.
  - Allow agents to view coming items and cancel/reschedule if necessary without mutating CRM history.

---

## Section 8: End-to-End Testing & Verification

- [ ] **Task 8.1: Simulation & Scenario Verification Script**
  - File: `apps/lead-grabber-v1/src/lib/server/tests/ray-scenario.test.ts`
  - End-to-end test walking through Ray Charbonneau scenario:
    1. Inbound email on Aug 4 ("AC call in couple of weeks").
    2. Verify immediate date-free reply sent.
    3. Verify CRM profile note created & Schedule row created for Aug 25 (Expires Sep 8).
    4. Fast-forward time to Aug 10: verify score decay paused & nurture emails suppressed.
    5. Fast-forward to Aug 16 (Ray calls): verify Aug 25 intent marks as `SKIPPED`.
    6. Alternate run: Ray doesn't call by Aug 25 -> verify sweep triggers Orchestrator and queues agent task quoting Ray's exact phrase.
