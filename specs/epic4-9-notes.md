# Epics 4–9 — status notes

Legend: **DONE** (implemented) · **EXISTS** (already built, verified) · **DEFERRED** (scoped out, reason given) · **RECONCILE** (decision recorded).

## Epic 4 — Call bridging, recording & internal-call guard
- **T4.4 DONE** — internal/operational-call guard: `internal-call-guard.ts` (`isInternalCaller`) wired into `orchestrator.ts` right after the inbound check. Owner voicemail on a company line no longer classified as a customer emergency. *Limit:* catches company-registered numbers; a rep's personal cell needs a rep-phone registry (follow-up).
- **T4.3 EXISTS (partial)** — AMD already distinguishes machine vs human in `telnyx/webhook/call-webhook`; the machine branch plays TTS. Full outbound-leg transcribe→log-to-profile still a follow-up.
- **T4.2 DEFERRED** — IVR merge/bridge disclosure is a short prompt but only meaningful with the bridge, so it ships with T4.1.
- **T4.1 DEFERRED** — autocaller press-1-to-bridge is a sizable Telnyx call-control build; kept as the one large deferred item.

## Epic 5 — Appointments, calendar & scheduling
- **EXISTS** — Google Calendar free/busy, `getAvailableSlots`, `bookAppointment`, reschedule/cancel, and the self-service `/book/[companyId]` picker are already built (`google-calendar.ts`).
- **T5.1 DONE** — `Appointment` model added to persist a booking against a customer + transaction (booking itself still lives in Google Calendar).
- **T5.2 DEFERRED** — per-rep calendars: `GoogleCalendarConnection` is `companyId @unique`; going per-rep means relaxing that unique + updating the OAuth connect flow. `Appointment.representativeId` is in place for when it lands.
- **T5.5 follow-up** — notify-rep on self-service pick: small addition to the `/book` action.
- **T5.4 / T5.6 / T5.8 DEFERRED** — slots-by-email, slot-locking for concurrent claims, and multi-tech capacity coordination.
- **T5.7 RECONCILE** — "on my way" SMS → send via A2P (tracked, consent-gated) using the same `sendCallbackAck`/consent path, not a personal phone.

## Epic 6 — Transactions & job fulfillment
- **T6.1 DONE** — `Transaction` model (open→closed `status`, `totalAmount`, `depositAmount`, `balanceAmount`, `invoiceSentAt`, `paidAt`, `threadId`).
- **T6.2 DONE** — deposit captured via `Transaction.depositAmount`.
- **T6.3 DONE** — `jobCompletedAt` + seed action `ACT-A2P-008 log_job_completed`.
- **T6.4 DONE** — `invoiceSentAt`/`paidAt` + seed action `ACT-A2P-009 log_transaction_update`.
- **T6.5 DEFERRED** — supplier-delivery-received trigger.
- **T6.6 RECONCILE** — back-office PO / model number / supplier ordering is an explicit **non-goal** for ClearSky (RightFlush's own ops/accounting system).

## Epic 7 — Post-job growth
- **T7.1 DONE** — `ACT-REV-008 send_review_request` (GBP link) added to the library. *Note:* an automated review-request SMS already exists in `telemetry.ts` on `job_completed`; the library action is the pipeline-native, approval-gated version.
- **T7.2 DONE** — `ACT-REV-009 send_referral_request`.
- **T7.3 DONE** — `ACT-COM-004 post_job_checkin`.
- **T7.5 DONE** — `Cohort2Trajectory` model + `cohort2.ts` (`writeCohort2Trajectory`), fire-and-forget on job close.
- **T7.4 RECONCILE/DEFERRED** — Facebook reciprocal follow-back needs a Meta Graph API + `page.follows.added` webhook integration (not present); the reciprocal-only rule is the policy to implement when that integration lands.

## Epic 8 — Approval routing & threaded comms
- **T8.1 DONE** — financial-vs-non-financial routing: `orchestrator-engine.resolveOwner` now sends financially-named actions (quote/pricing/invoice/transaction/deposit/balance) to `business_owner` (Bert); relays stay with the consultant (Sarah).
- **T8.2 DONE (data)** — `Transaction.threadId` ties the order/arrival/reminder messages; `CommunicationThread` already threads messages.
- **T8.3 RECONCILE** — doc's `ACT-COM-001 send_follow_up_message` ≈ existing `ACT-A2P-007 send_sms_followup`; use the existing action rather than duplicating.

## Epic 9 — Library governance
- **T9.1 RECONCILE** — new actions follow the doc's names (`ACT-REV-008/009`, `ACT-COM-004`) layered onto the real `ACT-A2P-*`/`ACT-REV-*` scheme. A full namespace unification is a larger doc+code pass.
- **T9.2 partial** — simulator no longer hardcodes signal/action metadata (done in T0.4). The Action Library (`seed-pipeline.ts`) and Signal Library (`signal-rules.ts`) remain the two sources of truth.
- **T9.3 RECONCILE** — the booking/review subsystem (`orchestrator.ts`, `google-calendar.ts`, `/book`) stays a separate track from the `Pipeline*` Action Library for now; unifying them is a dedicated effort.

## Follow-up wiring (shared with Epic 3)
The new customer-facing actions (review/referral/check-in) and job-fulfillment logs are **event-triggered off job completion**, which needs a small job-fulfillment scheduler to invoke them — the same "connect step" as the callback-ack trigger and the SLA cron.
