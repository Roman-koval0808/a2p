# Scenario 1 (Barry / RightFlush) — Engineering Task List

Cross-reference of the **Scenario 1** customer-journey document against the **actual code** in
`apps/lead-grabber-v1`. Generated 2026-07-17.

## Reconciliation notes (read first)

- The document's spec files (`specs/*.md`, `ClearSky_A2P_Developer_Spec.md`, …) and its ID scheme
  (`ACT-CALL-*`, `ACT-COM-*`, `SIG-ENG-*`, `SIG-CONV-*`) **do not exist in this repo**. The real code
  uses `ACT-A2P-*` / `ACT-REV-*` (seeded in `prisma/seed-pipeline.ts`) and `SIG-COMM-*` / `SIG-TRUST-*`
  (`src/lib/server/pipeline/signal-rules.ts`), across **two databases** (`schema.prisma` +
  `profiledb.schema.prisma`).
- Some things the story flags as gaps are **already built** (pixel telemetry, Google-Calendar free/busy +
  self-service `/book/[companyId]`, the `pending_approval` approval queue). Others it treats as resolved are
  **actually absent** (SLA-breach escalation, consent model, transaction/job entities).
- Two decisions gate everything else: **(1)** which story is authoritative (Epic 9 settles the ID scheme),
  and **(2)** whether the booking/review subsystem (`orchestrator.ts`) unifies with the `Pipeline*` Action
  Library or stays a separate track.

**Tags:** `[BUG]` fix existing defect · `[BUILD]` net-new · `[WIRE]` connect existing-but-disconnected code ·
`[RECONCILE]` doc-vs-code mismatch to decide.

---

## Epic 0 — Fix defects already in the pipeline

- **T0.1 [BUG]** `ACT-A2P-004 create_emergency_dispatch_alert` seeded with `defaultExecutionMode: 'automatic_immediate'` (`prisma/seed-pipeline.ts:124`) — not in `KNOWN_MODES` (`execution-engine.ts:53`) and not a routing lane, so the emergency dispatch action can never execute. Add the mode to the known set + router, or change the seed value.
- **T0.2 [BUG]** Emergency signal maps to different actions per path: `SIG-COMM-000 → ACT-A2P-004` in the seed mapping (`seed-pipeline.ts:168`) vs `ACT-A2P-002` in the simulator fallback (`pipeline-simulator.ts:93`). Pick one authoritative mapping.
- **T0.3 [BUG]** `emergency_type` is a `requiredParam` on `ACT-A2P-004` but has no resolver in `resolveParameters` (`action-queue-engine.ts:152-179`) → always null. Add a resolver (depends on T2.1).
- **T0.4 [BUG]** `EMERGENCY_SERVICE` / `SIG-COMM-000` defined twice (`signal-rules.ts:346` + hardcoded `pipeline-simulator.ts:61`) — the real form of the doc's tracker #32 "defined twice, differently". De-duplicate into one authoritative definition.
- **T0.5 [BUG]** `outcome-engine.ts` hardcodes action-id literals (`ACT-REV-002`, name maps for `ACT-REV-001/004`, `outcome-engine.ts:242-245`) that must stay in sync with the library; derive from `PipelineActionLibrary`.
- **T0.6 [BUG]** Several library actions have no execution handler — e.g. `ACT-A2P-001 create_crm_lead` runs the generic *simulated* SMS branch and never writes a CRM record (`execution-engine.ts:384-424`). Implement real handlers per action.

## Epic 1 — Identity, tiers & pixel signals (Ch 1; tracker #31, #2)

- **T1.1 [BUILD]** Tier is free-text defaulting `"Tier 2B"` (`profiledb.schema.prisma:38`); `"Tier 1"` never declared. Constrain tiers and add promotion-to-Tier-1 on identifier capture.
- **T1.2 [BUILD]** Anonymous 2B → Tier 1 profile merge (doc's `POST /hub/profiles/merge`, `profileId:null`): merge the anonymous fingerprint session history chronologically onto the newly-identified profile. Fingerprint→profile mapping exists (`DeviceFingerprint`, `profiledb.schema.prisma:70`); the merge step does not.
- **T1.3 [BUILD]** Emergency-band dwell signal (tracker #31 / doc's `SIG-ENG-003`). Pixel deltas exist (`eventRegistry.ts:10`) but nothing fires from dwelling on the home-page emergency band pre-navigation. Add the event type + a signal rule.
- **T1.4 [BUILD]** `thread_id` linkage from telemetry/pixel events. Messages thread via `CommunicationThread`, but `TelemetryEvent`/`PipelineEvent` have no thread key — doc's `events.thread_id` mechanism is absent.
- **T1.5 [RECONCILE]** The "Lead Grabber" speak-now / email-me / "What's the job?" widget the doc narrates does not exist — real capture is Leadbox (`src/lib/embed/leadbox-builder.ts`) / Leadform (`src/lib/embed/leadform-builder.ts`); the "hidden job field" bug can't exist here. Decide: build the dual-mode widget, or map the story onto Leadbox/Leadform (RightFlush marketing site is not in this repo).

## Epic 2 — AI classification schema & emergency templates (Ch 2; tracker #33/#34)

- **T2.1 [BUILD]** Add an always-populated `emergency_type` (`no_hot_water`, `burst_pipe`, `gas_leak`, `sewage_backup`, `electrical_fire`, …). Absent today; only a boolean `contains_emergency_keywords` exists (`ai-extraction.ts:10`).
- **T2.2 [BUILD]** Shared typed emergency auto-reply template library. Templates are inline keyword if/else chains duplicated in `telemetry.ts:396-410` and `messages/+server.ts:403-419`. De-dup into one library.
- **T2.3 [BUILD]** Write missing `sewage_backup` and `electrical_fire_or_shock` templates as named types (tracker #33/#34) — today only partial keyword coverage, no dedicated fire template.
- **T2.4 [RECONCILE]** Three classifiers with divergent schemas (`openai.ts:8`, `ai-extraction.ts:6`, `message-intent.ts:79`); `analyzeCallLog` lacks the `critical` (emergency) urgency tier the others have. Unify the emergency + urgent-vs-emergency distinction.

## Epic 3 — Callback ack, consent & SLA (Ch 2; tracker #30)

- **T3.1 [BUILD]** Callback-ack auto-reply ("A representative will call you in X minutes") as a pre-approved template that fires without a click. Today the callback path is approval-gated: `ACT-A2P-005 draft_callback_script` is `approval_required` and re-blocked by safety rule SAF-002; `SIG-COMM-005 CALLBACK_REQUESTED` never auto-acks the customer. Make X configurable (doc locks 10 min).
- **T3.2 [BUILD]** Consent model + marketing-vs-transactional basis (tracker #30). Only `Contact.smsPermission` boolean exists — no opt-in/opt-out/STOP, no purpose distinction. Gate the transactional callback-ack on transactional consent.
- **T3.3 [BUILD]** Business config keys the orchestrator lacks: `sla_minutes` (SLA today is only `slaResponseHours=24` / a hardcoded 12h window), structured `office_hours`, `sms_auto_reply_allowed`. See `PipelineBusinessConfig` (`schema.prisma:989`).
- **T3.4 [BUILD]** SLA-breach escalation — entirely absent. `dueAt` is written but never read (`action-queue-engine.ts:79`). Build a breach detector (scheduler/worker) at `sla_minutes + 5` that checks Telnyx logs for outbound contact, then escalates via (a) SMS, (b) push, (c) autocaller to the rep. Core Ch 2 mechanism.
- **T3.5 [BUILD]** Internal call-context summary for the rep (doc's corrected `ACT-CALL-005` — automatic, not approval-gated). AI summaries exist as enrichment (`aiSummary`) but not as an automatic pre-callback action written to profile.

## Epic 4 — Call bridging, recording & internal-call guard (Ch 2, 3; tracker #42)

- **T4.1 [BUILD]** Autocaller press-1-to-bridge: connect rep→customer on keypress. No autocaller exists.
- **T4.2 [BUILD]** IVR merge/bridge disclosure ("I am merging your call with Bert… recorded"), on top of the generic recording notice.
- **T4.3 [WIRE]** Outbound-call-to-voicemail capture (tracker #42). AMD distinguishes machine vs human (`telnyx/webhook/+server.ts:1259-1307`) and plays TTS to a machine, but the human branch only logs — it never bridges (stub), and it's unconfirmed the outbound leg is transcribed + logged to profile. Complete record→transcribe→log-to-profile.
- **T4.4 [BUILD]** Internal/operational voicemail guard (Ch 3). No `is_internal` check exists — an owner leaving himself a voicemail ("order a heater, took a $500 deposit") is classified as a customer emergency and can trigger the auto emergency SMS (`orchestrator.ts:64` only checks direction). Add a source-number / internal-vs-customer guard.

## Epic 5 — Appointments, calendar & scheduling (Ch 2, 5, 6; tracker #41, #43)

- **T5.1 [WIRE]** Persist appointments in the DB. Booking exists only in Google Calendar (`google-calendar.ts:346`) + generic `ScheduleEvent`; no `Appointment/Booking` model ties an appointment to a customer profile.
- **T5.2 [BUILD]** Per-rep calendars. `GoogleCalendarConnection` is keyed per-company (`schema.prisma:171`); ACT-CALL-010/011/012 all read/write a rep's calendar.
- **T5.3 [BUILD]** Extract an appointment commitment from a call transcript → write to calendar + profile (doc's `ACT-CALL-010`). Booking today is SMS-booking-link driven, not transcript-mined.
- **T5.4 [BUILD]** Available-slots scheduling email (doc's `ACT-CALL-011`). Slots are offered only via SMS today (`orchestrator.ts:330`); no email flow lists slots.
- **T5.5 [WIRE]** Customer self-service slot selection → write rep calendar + notify rep (doc's `ACT-CALL-012`). Picker exists (`src/routes/book/[companyId]/+page.svelte`) and writes to Calendar, but no rep-notification and not a pipeline action.
- **T5.6 [BUILD]** Slot-locking / concurrent-claim conflict resolution (tracker #43) — undefined if two customers pick the same slot near-simultaneously.
- **T5.7 [RECONCILE]** Decide the "on my way" SMS channel: A2P (tracked, consent-gated) vs rep's personal phone (untracked) (tracker #41).
- **T5.8 [BUILD]** Broader technician-capacity / multi-tech coordination (still-open gap both stories hit). `getAvailableSlots` de-facto conflict-checks one calendar; no multi-tech capacity model.

## Epic 6 — Transactions & job fulfillment (Ch 3, 5; tracker #36–#40)

- **T6.1 [BUILD]** `Transaction`/`SalesOrder` model with open/closed status, deposit, balance, invoice (tracker #40). None exist — only `Contact.accountBalance` (`schema.prisma:329`).
- **T6.2 [BUILD]** Deposit logging to the customer profile (doc's `ACT-CALL-004` shape — `service_requested` + `$500 deposit`). `serviceRequested` enrichment exists; deposit/amount logging does not.
- **T6.3 [BUILD]** Job-completed event + action (tracker #38) — nothing logs a job finishing.
- **T6.4 [BUILD]** Invoice-sent / balance-collection / payment event (tracker #39).
- **T6.5 [BUILD]** Supplier-delivery-received trigger (tracker #37).
- **T6.6 [RECONCILE]** Document that back-office PO / model number / supplier ordering is an explicit non-goal for ClearSky (tracker #36) — split from the customer-touching writes above.

## Epic 7 — Post-job growth: review, referral, check-in, network (Ch 7; tracker #24)

- **T7.1 [BUILD]** Review-request action with GBP link, gated on job-completed (doc's `ACT-REV-008`; tracker #24). Action Library stops at `ACT-REV-004`; a review-request SMS exists in `telemetry.ts:451` but isn't in the library, isn't GBP-linked, and isn't job-completion-gated.
- **T7.2 [BUILD]** Referral-request action (sibling of #24) — distinct from review request; absent.
- **T7.3 [BUILD]** Post-job relationship check-in action (doc's `ACT-COM-004`) — no keep-in-touch mechanism exists.
- **T7.4 [BUILD/VERIFY]** Facebook reciprocal follow-back (`page.follows.added → automatic follow-back`, reciprocal-only). `facebook` is a `CommunicationType` but a follow-back webhook wasn't found — build/verify.
- **T7.5 [BUILD]** Cohort2 trajectory write on job close (`cohort2_trajectories`). Absent — no cohort/trajectory table; scoring fields are scattered.

## Epic 8 — Approval routing & threaded comms (Ch 4)

- **T8.1 [BUILD]** Financial-vs-non-financial approval routing (Bert originates pricing, Sarah relays). Only single-route consultant/owner routing exists via `approvalRoute` (`orchestrator-engine.ts:136`); no content classifier routes pricing vs non-pricing to different approvers.
- **T8.2 [BUILD]** Thread the three job status messages (order-confirmed / arrival / install-reminder) under one `thread_id` — depends on T1.4.
- **T8.3 [RECONCILE]** Doc's `ACT-COM-001 send_follow_up_message` ≈ existing `ACT-A2P-007 send_sms_followup` (`seed-pipeline.ts:146`); align naming/behavior rather than duplicating.

## Epic 9 — Library governance & reconciliation (tracker #32; cross-cutting)

- **T9.1 [RECONCILE]** Map the doc's `ACT-CALL-*` / `ACT-COM-*` / `SIG-ENG-*` / `SIG-CONV-*` namespace onto the real `ACT-A2P-*` / `SIG-COMM-*` scheme (or adopt new IDs) — pick one canonical scheme.
- **T9.2 [BUILD]** Single source of truth for the Action Library (only `seed-pipeline.ts` today) and Signal Library (`signal-rules.ts`); make the simulator read them instead of hardcoding (ties off T0.2/T0.4).
- **T9.3 [RECONCILE]** Booking/calendar/review mechanisms live in a separate orchestrator subsystem (`orchestrator.ts`, `conversation.ts`, `reply-skills.ts`, `/book`), not the `Pipeline*` Action Library. Decide whether to unify them or keep two tracks — affects most of Epics 5 & 7.
