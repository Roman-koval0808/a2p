# ClearSky / RightFlush A2P — Changes Report (Epics 0–9 + Triggers)

**Scope:** implementation of the Scenario 1 (Barry) gap analysis against the live SvelteKit codebase (`apps/lead-grabber-v1`), including the connect-step triggers and a live verification pass.
**Branch:** `main`.
**Schema:** **applied to the production Aiven DB via `prisma db push`** (additive; confirmed present). profiledb is redundant (all logic now lives in lead-grabber / the main DB) so it was not touched.
**Verification:** TypeScript clean (**152 → 152, zero new errors**) **and** a live end-to-end run against the Aiven DB (results below).

---

## Headline

- The three "connect-step" triggers are now **wired and live-verified**: callback-ack, SLA sweep, and the job-fulfillment flow.
- All schema is **applied on Aiven** and confirmed (`transactions`, `appointments`, `cohort2_trajectories`, `sms_consents`, `slot_holds` tables; new columns present).
- A live self-test drove the job-fulfillment path end-to-end against the real DB, and **caught + fixed a real bug** (callback-ack now fails safe).
- Remaining work is only the items that genuinely need external credentials to run (autocaller live bridge, Facebook/Meta, interactive Google OAuth) — built and clearly flagged.

---

## Live verification (against the Aiven production DB)

A temporary self-test route drove the new code with isolated, cleaned-up test rows (no real SMS, no mutation of real rows), then was removed:

| Path | Result |
|---|---|
| **Job-fulfillment** (`completeJob`) | Transaction → `closed` with `jobCompletedAt` set; **3 approval drafts queued** (`ACT-REV-008`, `ACT-REV-009`, `ACT-COM-004`); **Cohort2 trajectory written**. All test rows cleaned up (0 left). ✅ |
| **SLA sweep** (`checkSlaBreaches` query) | Ran against the new `slaEscalatedAt` column; 0 overdue candidates currently (read-only in the test — escalation fires on real overdue items). ✅ |
| **Callback-ack gating** (`sendCallbackAck`) | Returns `{ sent: false, reason: 'sms_auto_reply_disabled' }` when no config enables it — **fails safe, no accidental SMS**. ✅ |
| **Consent read** (`hasSmsConsent`) | Transactional consent implied (reads the new `sms_consents` table). ✅ |
| **Server boot** | Dev server boots with all new modules + the in-process SLA cron; every module imports cleanly. ✅ |

**Bug caught by the live run:** callback-ack originally only blocked when a config row existed with the flag off; with no config row it would have sent. Fixed to require an explicit opt-in (`smsAutoReplyAllowed`), re-verified live.

---

## The three connect-step triggers (now wired)

| Trigger | How it fires | Files |
|---|---|---|
| **Callback-ack** (T3.1) | `classifyMessageIntent` now returns `wants_callback`; `process_orchestrator` calls `sendCallbackAck()` on an inbound callback request, deduped, gated by config/consent/office-hours. | `message-intent.ts`, `orchestrator.ts`, `callback-ack.ts`, `sms.ts` |
| **SLA sweep** (T3.4) | In-process interval in `hooks.server.ts` runs `checkSlaBreaches()` every 60s (lazy-imported so firebase stays off the request path). `POST /api/a2p/sla/check` remains as an external-cron alternative. | `hooks.server.ts`, `sla-monitor.ts`, `routes/api/a2p/sla/check` |
| **Job-fulfillment** (Epics 6/7) | `POST /api/a2p/jobs/complete` (authed) → `completeJob()` closes the transaction, queues review/referral/check-in drafts, writes Cohort2. | `job-fulfillment.ts`, `routes/api/a2p/jobs/complete` |

**Decoupling fix:** the SMS sender was extracted to `sms.ts` so main-DB modules no longer transitively import the redundant profiledb client (which has no configured URL and would crash on import).

---

## Deferred builds (per your "build confirmable, flag the rest")

| Item | Status |
|---|---|
| Supplier-delivery trigger (T6.5) | **Built + confirmable** — `POST /api/a2p/supplier/delivery` queues the arrival-notice draft. |
| Per-rep calendar field (T5.2) | **Built (additive)** — `GoogleCalendarConnection.representativeId`; full per-rep still needs the `companyId` unique relaxed + OAuth-per-rep. |
| Slot-locking (T5.6) | **Built** — `SlotHold` model (applied on Aiven); needs wiring into the `/book` pick step. |
| Slots-by-email (T5.4) | **Built, needs live creds** — `slots-email.ts` composes the message; needs a connected Google Calendar + email transport to actually send. |
| Autocaller bridge (T4.1/T4.2) | **Built, needs live Telnyx** — `telnyx-bridge.ts` (speak-disclosure + transfer/bridge Call Control commands); needs a real in-progress call to exercise. |
| Facebook follow-back (T7.4) | **Built, needs Meta creds** — `routes/api/webhooks/facebook` (verify handshake + reciprocal-only follow-back); needs a Meta app + Page token. |
| Multi-tech capacity (T5.8) | **Deferred** — depends on per-rep calendars first. |

---

## Epics 0–9 summary (unchanged work from the earlier pass)

| Epic | Theme | Outcome |
|---|---|---|
| 0 | Pipeline defect fixes | 6/6 fixed (emergency dispatch executes, real CRM/Task writes, emergency_type, dedup, library-derived names) |
| 1 | Identity, tiers & pixel signals | Tier promotion + merge already existed; dwell event + threadId added — **note: these live in the now-redundant profiledb layer** |
| 2 | AI classification & emergency templates | emergency_type field + emit; shared typed templates (de-duped 2 call sites); critical urgency tier |
| 3 | Callback ack, consent & SLA | consent model, business config, callback-ack + SLA monitor — **now wired + verified** |
| 4 | Call handling & internal-call guard | internal-call guard wired; autocaller built (needs live Telnyx) |
| 5 | Appointments & calendar | core already built; Appointment + SlotHold + per-rep field added; slots-email built |
| 6 | Transactions & job fulfillment | Transaction model + job/invoice actions + supplier-delivery — **completeJob verified** |
| 7 | Post-job growth | review/referral/check-in actions + Cohort2 — **verified**; Facebook built (needs Meta creds) |
| 8 | Approval routing | financial-vs-non-financial owner routing |
| 9 | Library governance | reconcile decisions recorded |

Detailed per-task breakdown: `specs/epic4-9-notes.md`. Epic-0 before/after with terminal evidence: `specs/epic0-dev-notes.md`.

---

## Data-model changes (all applied on Aiven)

- `PipelineEnrichment.aiEmergencyType`
- `PipelineBusinessConfig.slaMinutes`, `.smsAutoReplyAllowed`, `.officeHours`
- `PipelineActionQueue.slaEscalatedAt`
- `GoogleCalendarConnection.representativeId`
- New tables: `SmsConsent`, `Transaction`, `Appointment`, `Cohort2Trajectory`, `SlotHold`
- (profiledb `TelemetryEvent.threadId` — code-complete but NOT applied; profiledb is redundant/unconfigured)

---

## New / changed files (this pass)

**New modules:** `sms.ts`, `job-fulfillment.ts`, `telnyx-bridge.ts`, `slots-email.ts` (server) · `routes/api/a2p/jobs/complete`, `routes/api/a2p/supplier/delivery`, `routes/api/webhooks/facebook` (routes).
**Wiring:** `message-intent.ts` (`wants_callback`), `orchestrator.ts` (callback-ack call), `hooks.server.ts` (SLA cron), `callback-ack.ts` (decoupled sender + fail-safe fix), `schema.prisma` (`representativeId`, `SlotHold`).

*(Earlier pass, already committed on `main`: Epics 0–9 backend/schema — `execution-modes.ts`, `emergency-templates.ts`, `consent.ts`, `callback-ack.ts`, `call-context-summary.ts`, `sla-monitor.ts`, `internal-call-guard.ts`, `cohort2.ts`, `tiers.ts`, plus the pipeline + schema edits.)*

---

## What's left

1. **External-credential builds** (built, need your infra to run): autocaller live bridge, Facebook/Meta follow-back, interactive Google OAuth for per-rep calendars.
2. **Optional polish:** wire `SlotHold` into the `/book` pick step; enable `smsAutoReplyAllowed` + set `slaMinutes` per business to turn on the callback-ack in production; point an external cron at `/api/a2p/sla/check` if you prefer it over the in-process sweep.
3. **profiledb** telemetry-layer changes (Epic 1 dwell/threadId) are code-complete but sit in the redundant layer — no action unless that layer is revived.

This pass's changes are currently **uncommitted** on `main` (the earlier Epics 0–9 pass is already committed).
