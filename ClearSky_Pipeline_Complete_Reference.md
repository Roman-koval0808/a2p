ClearSky AI Decision System — Complete Pipeline Reference   ·   All 8 Sections   ·   APEX Contracting   ·   workflow_loop_closed

**ClearSky AI Decision System**

Complete Pipeline Reference

*All 8 Sections — Design, Logic, Database, and Implementation*

| **Field** | **Value** |
| --- | --- |
| Stack | TypeScript · SvelteKit · Prisma · PostgreSQL · OpenAI |
| Demo Business | APEX Contracting — Northern Ontario |
| Demo Consultant | Sarah Jenkins |
| Demo Event | 1-star emergency GBP review — Margaret T. — leaking roof, 5 unanswered calls |
| Pipeline Status | Sections 1–7 built, wired, and verified. Section 8 (Network) specced 2026-07-19 and simulated in the prototype (`prototype/src/engine/growth/cohort2.ts`) — not yet wired to a live runner. |
| Sessions Complete | Sessions 1 through 6 (Sections 1–7). Section 8 added 2026-07-19. |

**CONFIDENTIAL — DEVELOPER HANDOFF**

# **1. Executive Overview**

ClearSky is an AI-powered decision system designed for Northern Ontario trades businesses. It connects every customer touchpoint — reviews, calls, messages, forms, and quotes — into a single intelligent pipeline that detects problems, selects the right response, executes approved actions, records what happened, and learns from results. When a job actually closes, a second, conditional process (Section 8) anonymizes what happened and contributes it to a cross-contractor learning network.

## **1.1 Platform Purpose**

ClearSky Business Platform helps local businesses grow by improving the full customer journey. It connects Discovery, Engagement, Conversion, and Growth into one system that increases visibility, strengthens customer interaction, captures more opportunities, and turns calls, messages, and inquiries into measurable revenue, booked work, and long-term business value.

## **1.2 The Locked Workflow**

| **Event  →  Signal  →  Orchestrator Decision  →  Action Queue + Parameters  →  Execution  →  Outcome  →  Feedback** |
| --- |

This 7-stage chain is locked and runs **once per event** — it starts at a single trigger (a review, a call, a form) and ends at `workflow_loop_closed`. **Section 8 is not an eighth step in this same per-event chain.** It's a separate, conditional process that reads *completed* pipeline runs — specifically the ones tied to a relationship that reaches a **terminal outcome, won or lost** — and writes an anonymized trajectory record to a cross-contractor network. Most individual pipeline runs (a review reply, a routine SMS) never reach Section 8 at all; only a relationship that actually resolves — booked-and-closed, or explicitly lost — does. See §10 for the full boundary.

## **1.3 Three Layers**

| **Layer** | **Name** | **What Happens Here** |
| --- | --- | --- |
| 1 | Network Layer | ClearSky connects, listens, and collects activity from all providers (GBP, phone, SMS, forms, email). |
| 2 | Intelligence Layer | ClearSky normalizes, interprets, detects Signals, applies rules, and decides what to do. |
| 3 | Execution Layer | ClearSky performs approved actions, tracks outcomes, and feeds results back for learning. |

## **1.4 All 8 Sections — Status**

| **Section** | **Name** | **Verified Output / Status** |
| --- | --- | --- |
| 1 | Event Intake | Event stored · handoff_eligible = true · AI extraction complete |
| 2 | Signal Detection | 3 signals matched · negative_review_risk dominant · SIG-TRUST-008 suppressed |
| 3 | Orchestrator Decision | Decision stored · ACT-REV-001 + ACT-REV-004 selected · ACT-REV-002 blocked |
| 4 | Action Queue + Parameters | 2 queue records created · all parameters resolved · qtrace created |
| 5 | Execution | Draft created (pending approval, NOT posted) · complaint theme logged automatically |
| 6 | Outcome | out_6001 (waiting_for_approval) · out_6002 (completed) · blocked_ctx preserved |
| 7 | Feedback | fb_pkg produced · all evaluations written · workflow_loop_closed |
| 8 | Network (Cohort 2 Growth Attribution) | Specced + prototype-simulated (`cohort2.ts`) — not wired to a live runner. Conditional: fires for a terminal relationship outcome — won *or* lost — not every event. |

## **1.5 Non-Negotiable System Boundaries**

| **ALWAYS** | **NEVER** |
| --- | --- |
| Public replies require human approval before posting | Automatically post to Google without approval |
| Every decision is auditable and traceable | Let AI make unilateral decisions without rules |
| Blocked actions are preserved for audit | Silently discard blocked actions |
| Record what IS — not what should be | Invent approval or posting that did not occur |
| Tuning candidates are review-only | Automatically change production rules or models |
| Every record traces back to source Event | Create orphaned records without traceability |
| Section 8 writes are anonymized and PII-redacted | Attach a Stream B (market-level) signal to an individual identity |
| Section 8 correlation output is confidence-gated by sample size | Report a keyword/rank-to-win-rate or -to-revenue number below the medium confidence threshold (50 matches) |
| Section 8 writes on wins *and* losses | Write only wins — a network that never sees a loss can't tell you what actually moves the needle |
| A lost Section 8 record always carries a `lossReason` | Write `outcomeResult: "lost"` with no reason, or a `lossReason` on a win |

# **2. Core Concepts and Definitions**

| **Term** | **What It Is** | **What It Is NOT** |
| --- | --- | --- |
| Event | ClearSky's cleaned, classified, matched, stored record of what happened. | Raw provider data. Not a Signal. Not an AI guess. |
| Signal | A structured, rule-matched indicator that something meaningful occurred. | A notification. Not an alert. Not an Action. |
| Orchestrator Decision | A deterministic, auditable selection of the best Action and execution mode. | An AI guess. Not a freeform recommendation. |
| Action | A specific approved task from the Action Library (e.g. ACT-REV-001). | An arbitrary command. Not freeform AI output. |
| Execution | The act of performing, preparing, or waiting on a queued Action. | Posting without approval. Never automatic for public actions. |
| Outcome | The structured record of what happened after Execution. | A log message. Not Feedback. Not a final success claim. |
| Feedback | Structured evaluation of what happened across the full pipeline. | Model retraining. Not automatic rule changes. |
| Trajectory Record | An anonymized, cross-contractor learning record written when a relationship reaches a terminal outcome — won or lost (Section 8). Scoped to one contractor per trade per market. | Not tied to every Event — only resolved relationships, wins and losses both. Not customer-facing. Not a revenue claim on its own. |

## **2.1 Network Category vs Signal Bucket**

| **Concept** | **Belongs To** | **Answers** | **Examples** |
| --- | --- | --- | --- |
| Network Category | Event | Where did the activity happen? | Trust, Communication, Conversion, Visibility |
| Signal Bucket | Signal | What does the activity mean? | Risk, Bottleneck, Opportunity, Performance, Competitive, Momentum |

# **3. Section 1 — Event Intake**

| **SEC 1** **Event Intake** | **This section answers:  ***What happened, and is this event clean enough to evaluate?* |
| --- | --- |
|  | **INPUT   **Raw provider payload (webhook, API fetch, form submission) |
|  | **OUTPUT  **Stored Event Object · handoff_eligible = true |

## **3.1 Purpose**

Section 1 is the entry point for all ClearSky activity. It transforms raw, unstructured provider data into a trusted, normalized, classified, and stored ClearSky Event Object. Everything downstream depends on Event Intake being correct. The Event boundary ends when Event stored + handoff_eligible = true. No Signal, Decision, Action, Execution, Outcome, or Feedback has occurred inside Section 1.

## **3.2 All 15 Steps**

| **Step** | **Name** | **What Happens** |
| --- | --- | --- |
| 1 | Raw Input Intake | Capture provider/source activity exactly as received. Create trace_id. |
| 2 | Provider Identification | Deterministically identify the provider (e.g. google_business_profile). |
| 3 | Provider Event Name Reading | Read provider event name (e.g. review.created). Provider language only — not ClearSky language. |
| 4 | Provider Event Registry Lookup | Map provider + provider_event to ClearSky event_type, Network Category, and schema rules. |
| 5 | ClearSky event_type Assignment | Assign official event_type (e.g. review_received). AI never assigns event_type. |
| 6 | Network Category Assignment | Assign Network Category (Trust, Communication, Conversion, Visibility, Growth, System). |
| 7 | Event Draft Creation | Create Event shell with event_id, trace_id, provider fields, status = event_draft_created. |
| 8 | AI Extraction | Extract structured meaning from unstructured content only (sentiment, topics, urgency, summary). AI only used here. |
| 9 | Payload Storage | Write raw_payload and normalized_payload. AI extraction must complete BEFORE the DB write. |
| 10 | Structured Field Normalization | Clean fields into ClearSky naming and formats (phone, email, rating, etc.). |
| 11 | Relationship Matching | Attach business_id, customer_id, market_id, consultant context deterministically. |
| 12 | Duplicate Detection | Use provider IDs, event IDs, timestamps, review IDs to block duplicate processing. |
| 13 | Processing Status Assignment | Set processing_status = ready_for_handoff_review after all checks pass. |
| 14 | Handoff Eligibility Decision | Evaluate all required checks. Set handoff_eligible = true or false with reason. |
| 15 | Final Event Boundary Lock-In | Event stored + handoff_eligible = true. Pipeline boundary locked. |

## **3.3 Deterministic vs AI-Assisted Logic**

| **Type** | **Examples** | **Rule** |
| --- | --- | --- |
| Deterministic | Provider ID, event_type, Network Category, relationship matching, duplicate detection | Always deterministic — no AI involvement |
| AI-Assisted | Sentiment, urgency, complaint topics, summary, confidence score | AI only fills a controlled extraction form from unstructured text |

## **3.4 APEX Working Example — Event Output**

| **event_id** | evt_7001 |
| --- | --- |
| **event_type** | review_received |
| **network_category** | Trust |
| **provider** | google_business_profile |
| **reviewer_name** | Margaret T. |
| **rating** | 1 |
| **handoff_eligible** | true |
| **ai_sentiment** | negative |
| **ai_complaint_topics** | poor communication, leaking roof, safety_violation |
| **ai_urgency** | high |

| **From** | **To** | **Handoff Flag** |
| --- | --- | --- |
| Raw Provider Payload | Section 2: Signal Detection | **handoff_eligible = true** |

# **4. Section 2 — Signal Detection**

| **SEC 2** **Signal Detection** | **This section answers:  ***Does this event mean something that ClearSky should act on?* |
| --- | --- |
|  | **INPUT   **Handoff-eligible Event Object from Section 1 |
|  | **OUTPUT  **Valid Signal candidate(s) · dominant Signal identified · ready_for_orchestrator |

## **4.1 Purpose**

Signal Detection evaluates the handoff-eligible Event against a library of configured Signal rules. Each rule defines conditions that must be met for that Signal to fire. Rules are evaluated deterministically — they are not reordered at runtime. The result is a ranked set of Signal candidates passed to the Orchestrator.

## **4.2 Signal Rule Families (review_received event type)**

| **Family** | **Signal Examples** | **Purpose** |
| --- | --- | --- |
| Rating Rules | SIG-TRUST-001 (negative_review_risk), SIG-TRUST-003 (positive_review_received) | Detect review rating thresholds |
| Comment Rules | SIG-TRUST-004 (positive_with_minor_issue), SIG-TRUST-005 (communication_issue) | Detect specific complaint or praise content in review text |
| Response Status | SIG-TRUST-007 (positive_reply_needed), SIG-TRUST-008 (negative_response_needed) | Detect time-based response requirements |
| Pattern Rules | SIG-TRUST-010 (repeated_bottleneck), SIG-TRUST-011 (rating_decline) | Detect recurring patterns across multiple events |
| Competitive Rules | SIG-TRUST-013 (velocity_gap), SIG-TRUST-014 (reputation_advantage) | Detect competitive intelligence signals |
| Marketing Rules | SIG-TRUST-015 (testimonial_candidate), SIG-TRUST-016 (service_proof_point) | Detect content suitable for marketing use |
| Liability & Safety | SIG-TRUST-017 (safety_compliance_risk_detected) | Detect safety or liability mentions |

## **4.3 Signal Bucket Priority**

| **Bucket** | **Meaning** | **Priority** |
| --- | --- | --- |
| Risk | Something bad happened or could happen. Act quickly. | 1 — Highest |
| Bottleneck | A process or communication failure is causing problems. | 2 |
| Opportunity | A positive event that can be leveraged for growth. | 3 |
| Performance | A quality or efficiency signal worth monitoring. | 4 |
| Competitive | A gap or advantage relative to competitors. | 5 |
| Momentum | A trend building positively or negatively. | 6 — Lowest |

## **4.4 APEX Signal Evaluation Results**

| **Signal ID** | **Name** | **Result** |
| --- | --- | --- |
| SIG-TRUST-001 | negative_review_risk | MATCHED — rating 1 is <= 2 |
| SIG-TRUST-005 | communication_experience_issue_detected | MATCHED — complaint topics includes communication, confidence 0.95 >= 0.8 |
| SIG-TRUST-017 | safety_compliance_risk_detected | MATCHED — complaint topics includes safety_violation, confidence 0.95 >= 0.8 |
| SIG-TRUST-008 | negative_review_response_needed | SKIPPED — elapsed hours 0.004 < 2 hour threshold |
| All others (13) | Various | SKIPPED — conditions not met |

| **From** | **To** | **Handoff Flag** |
| --- | --- | --- |
| Section 1 Event (handoff_eligible = true) | Section 3: Orchestrator Decision | **ready_for_orchestrator** |

# **5. Section 3 — Orchestrator Decision**

| **SEC 3** **Orchestrator Decision** | **This section answers:  ***Which Signal matters most, what Action should ClearSky take, and how should it be executed?* |
| --- | --- |
|  | **INPUT   **Valid Signal candidate(s) from Section 2 |
|  | **OUTPUT  **Auditable Decision record · selected Actions · execution modes · owner assignments |

## **5.1 Purpose**

The Orchestrator is the brain of ClearSky. It receives validated Signal candidates and applies a deterministic, rules-based decision process to select the dominant Signal, choose the correct Action(s), determine execution mode, validate required parameters, and create an auditable Orchestrator Decision record. The Orchestrator is not an AI recommendation engine — every decision step is rule-based and auditable.

## **5.2 All 12 Decision Steps**

| **Step** | **Name** | **What Happens** |
| --- | --- | --- |
| 1 | Receive Signal Candidates | Accept Signal Detection output package. Confirm no prior decision exists. |
| 2 | Confirm Entry Eligibility | Verify Signals are complete, ready_for_orchestrator, and not already processed. |
| 3 | Load Business Configuration | Load automation level, review reply policy, approval requirements, brand tone, SLA settings. |
| 4 | Check Safety and Compliance | Enforce global safety rules (e.g. never auto-post public replies). These override all other settings. |
| 5 | Rank Signal Candidates | Compare by priority, confidence score, Signal Bucket, and business impact factors. |
| 6 | Identify Dominant Signal | Select highest-ranked Signal as dominant. Preserve others as supporting context. |
| 7 | Suppress or Group Related Signals | Apply suppression rules. Remove redundant signals (e.g. SIG-TRUST-008 suppressed when SIG-TRUST-001 fires). |
| 8 | Map to Allowed Action IDs | Look up Signal-to-Action mappings in the Action Library. Apply safety and business config filters. |
| 9 | Select Action(s) and Execution Mode | Choose primary and secondary Actions. Set mode: automatic, approval_required, manual, blocked, or observe_only. |
| 10 | Validate Required Parameters | Confirm all required parameters exist before queue records are created. |
| 11 | Create Orchestrator Decision Record | Store the auditable decision: Signal, Actions, execution modes, owner, parameters, reason. |
| 12 | Prepare Output for Action Queue | Package decision for Section 4. Stop before any queue record is created. |

## **5.3 Execution Mode Reference**

| **Mode** | **What It Means** | **APEX Example** |
| --- | --- | --- |
| automatic | ClearSky executes without human review | Log complaint theme internally — ACT-REV-004 |
| approval_required | ClearSky prepares output; human must approve before posting | Create review reply draft — ACT-REV-001 |
| manual | A human must perform the action directly | Assign task to field technician |
| blocked | Action cannot run under current policy | Auto-post public reply — ACT-REV-002 (always blocked) |
| observe_only | Monitor and record; no action taken | Track keyword rank change |

## **5.4 APEX Decision Output**

| **Dominant Signal** | negative_review_risk (SIG-TRUST-001) — bucket=Risk, priority=1 |
| --- | --- |
| **Supporting Signals** | safety_compliance_risk_detected, communication_experience_issue_detected |
| **Suppressed** | SIG-TRUST-008 — overlaps with dominant, suppressed to prevent duplicate action |
| **ACT-REV-001 Selected** | create_review_reply_draft — approval_required — owner: consultant |
| **ACT-REV-004 Selected** | log_review_complaint_theme — automatic — owner: system |
| **ACT-REV-002 Status** | post_review_reply — BLOCKED by Safety Rule ORC-004 — audit-only, no queue record |

| **From** | **To** | **Handoff Flag** |
| --- | --- | --- |
| Section 2 Signal Candidates | Section 4: Action Queue + Parameters | **prepared_for_action_queue** |

# **6. Section 4 — Action Queue + Parameters**

| **SEC 4** **Action Queue + Parameters** | **This section answers:  ***How does ClearSky turn the Orchestrator Decision into queue-ready work orders?* |
| --- | --- |
|  | **INPUT   **Orchestrator Decision output · selected Actions and execution modes |
|  | **OUTPUT  **Queue records · resolved parameters · lane assignments · queue trace (qtrace) |

## **6.1 Purpose**

Section 4 transforms the Orchestrator Decision into structured, parameterized work orders ready for Execution. It creates Action Queue records, resolves all required parameters from Event context, assigns execution lanes, applies approval metadata, creates an audit trace, and stops before any Action is executed. Blocked Actions (ACT-REV-002) are never queued — they remain audit-only.

## **6.2 All 12 Steps**

| **Step** | **Name** | **What Happens** |
| --- | --- | --- |
| 1 | Receive Orchestrator Decision | Accept official decision package. Confirm no queue records exist yet. |
| 2 | Confirm Entry Eligibility | Verify decision is prepared_for_action_queue. Check for no duplicates. |
| 3 | Load Action Library and Queue Rules | Load Action Library metadata, parameter schemas, SLA rules, approval policies. |
| 4 | Create Action Queue Record(s) | Create queue rows for eligible Actions. Blocked Actions are NOT queued. |
| 5 | Attach Validated Parameters | Resolve all required parameter values from Event context. Mark records parameter-complete. |
| 6 | Set Status, Priority, Owner, SLA | Set queue_status, priority, assigned_owner, approval_owner, due_time, escalation rules. |
| 7 | Apply Approval Workflow Requirements | Set approval metadata for approval_required Actions. Do not execute them. |
| 8 | Separate by Execution Lane | Classify records into: approval_required / automatic / manual / blocked / observe_only. |
| 9 | Validate Queue Readiness | Confirm all records are complete, safe, traceable, not duplicated. |
| 10 | Create Queue Audit Trace (qtrace) | Store traceability chain: Event → Signal → Decision → Action Queue. |
| 11 | Prepare Output for Execution | Build Section 4 output package for Section 5. |
| 12 | Stop Before Execution | Close Section 4. Nothing is executed, drafted, posted, or sent. |

## **6.3 Parameter Resolution — APEX**

| **Parameter** | **Resolved Value** | **Source** |
| --- | --- | --- |
| {customer_name} | Margaret T. | Event.reviewer_name |
| {rating} | 1 | Event.normalized.rating |
| {platform} | Google | Event.provider |
| {brand_tone} | professional | Business configuration |
| {review_text} | Emergency! My roof is leaking... | Event.normalized.review_text |
| {ai_summary} | Customer reports a leaking roof after a recent repair... | Event.ai_context.summary |
| {sentiment} | negative | Event.ai_context.sentiment |
| {complaint_topics} | poor communication, leaking roof, safety_violation | Event.ai_context.complaint_topics |

## **6.4 APEX Queue Records**

| **Queue Record** | **Action** | **Lane / Status** |
| --- | --- | --- |
| aq_3001 | ACT-REV-001 — create_review_reply_draft | approval_required · pending_approval · owner: consultant |
| aq_3002 | ACT-REV-004 — log_review_complaint_theme | automatic · ready_for_execution · owner: system |
| [no record created] | ACT-REV-002 — post_review_reply | blocked · audit-only · no queue record |

| **From** | **To** | **Handoff Flag** |
| --- | --- | --- |
| Section 3 Orchestrator Decision | Section 5: Execution | **ready_for_execution** |

# **7. Section 5 — Execution**

| **SEC 5** **Execution** | **This section answers:  ***How does ClearSky perform, prepare, or wait on the queued Action?* |
| --- | --- |
|  | **INPUT   **Action Queue records from Section 4 · resolved parameters |
|  | **OUTPUT  **Execution records · draft created · internal actions completed · approval package |

## **7.1 Purpose**

Section 5 performs the actual work. It receives queue-ready records, creates execution records, routes each to the correct lane, executes automatic internal actions, prepares approval-required outputs without posting externally, handles blocked and waiting states, updates statuses, and prepares the Execution output for Outcome recording.

## **7.2 All 12 Steps**

| **Step** | **Name** | **What Happens** |
| --- | --- | --- |
| 1 | Receive Queue Output | Accept Section 4 output. Confirm Execution has not started. Open exec_intake. |
| 2 | Confirm Eligibility | Validate each queue record: Action ID, execution mode, status, parameters, no duplicates. |
| 3 | Load Execution Rules and Handlers | Load action handlers, provider capabilities, approval rules, generation rules, retry and failure policies. |
| 4 | Create Execution Record(s) | Create exec rows for eligible queue records. Each links to queue record, decision, and event. |
| 5 | Route by Execution Mode | Assign each exec record to: approval_required / automatic / manual / blocked / retry / waiting lane. |
| 6 | Execute Automatic Internal Actions | Run automatic internal Actions (e.g. log complaint theme). No external posting. Mark completed. |
| 7 | Prepare Approval-Required Outputs | Generate draft output (AI review reply). Attach to exec record. Mark pending_approval. Do NOT post. |
| 8 | Handle Manual Assignments | Create or update manual tasks where a human must perform the work. (None in APEX example.) |
| 9 | Handle Blocked, Failed, Retry, Waiting | Process failure/retry/blocked states. ACT-REV-002 remains blocked audit-only. |
| 10 | Update Queue and Execution Status | Synchronize execution_status and queue_status for all records. |
| 11 | Prepare Execution Output for Outcome | Build exec_out package. Set handoff_status = ready_for_outcome. |
| 12 | Stop Before Outcome | Close Section 5. Outcome recording has not started. |

| **CRITICAL RULE: The review reply draft is NEVER automatically posted.** The draft is generated by AI and stored in Section 5 with posted_externally = false. It remains in this state until a human explicitly approves it. Safety Rule ORC-004 enforces this and cannot be overridden by any automation level setting. |
| --- |

## **7.3 APEX Execution Results**

| **Execution Record** | **Action** | **Result** |
| --- | --- | --- |
| exec_49dd96a471 | ACT-REV-001 — create_review_reply_draft | draft_created · posted_externally=false · pending approval · NOT sent to Google |
| exec_b8326526d5 | ACT-REV-004 — log_review_complaint_theme | automatic_internal_action_completed · complaint theme logged · no external action |
| [excluded] | ACT-REV-002 — post_review_reply | blocked · never entered Execution · preserved as audit-only |

| **From** | **To** | **Handoff Flag** |
| --- | --- | --- |
| Section 4 Action Queue | Section 6: Outcome | **ready_for_outcome** |

# **8. Section 6 — Outcome**

| **SEC 6** **Outcome** | **This section answers:  ***What actually happened after Execution, and how is the result recorded?* |
| --- | --- |
|  | **INPUT   **Execution output package from Section 5 · exec records |
|  | **OUTPUT  **Outcome records · blocked context · timing metrics · out_pkg |

## **8.1 Purpose**

Section 6 records the structured result of what happened in Execution. Every Outcome record links back to its source Event, Orchestrator Decision, Action Queue record, and Execution record. Section 6 records what IS — it does not assume what will happen next. Waiting for approval is a valid, complete Outcome state. Section 6 never performs Feedback learning.

## **8.2 All 12 Steps**

| **Step** | **Name** | **What Happens** |
| --- | --- | --- |
| 1 | Receive Execution Output | Accept exec_out package. Confirm handoff_status = ready_for_outcome. Confirm Outcome not started. |
| 2 | Confirm Entry Eligibility | Validate each exec record: outcome not already created, status is recordable, all IDs present. |
| 3 | Load Outcome Types and Result Mapping | Load confirmed outcome_types, execution-to-outcome mapping, and rules snapshot. |
| 4 | Create Outcome Record(s) | Insert outcome rows in a single transaction. Each links to exec, queue, decision, and event. |
| 5 | Record Approval-Required Draft Outcome | out_6001: outcome_type=draft_created, outcome_status=waiting_for_approval, posted_to_google=false. |
| 6 | Record Automatic Internal Action Outcome | out_6002: outcome_type=completed, outcome_status=completed, internal_action_completed=true. |
| 7 | Preserve Blocked Context | Create blocked_outcome_context row for ACT-REV-002. Audit context only — not an Outcome record. |
| 8 | Calculate Timing Metrics | Record time_to_draft, time_to_log, waiting state, approval_wait_hours where available. |
| 9 | Update Queue and Execution References | Write outcome_id back to queue and execution records for bi-directional linking. |
| 10 | Validate Completeness and Traceability | Confirm every Outcome row traces back to Event, decision, queue, execution, and business. |
| 11 | Prepare Output for Feedback | Build out_pkg. Set handoff_status = ready_for_feedback. |
| 12 | Stop Before Feedback | Close Section 6. Feedback has not started. Production rules not changed. |

## **8.3 Outcome Type Reference**

| **Outcome Type** | **Meaning** | **Example** |
| --- | --- | --- |
| draft_created | A draft was created and is waiting for approval | Review reply draft — ACT-REV-001 |
| completed | An automatic internal action completed successfully | Complaint theme logged — ACT-REV-004 |
| approved | A draft was approved by a human | Business owner approves review reply |
| posted | An approved output was posted to an external platform | Review reply posted to Google |
| failed | The execution attempt failed | API error during draft generation |
| rejected | A draft was rejected by the approving human | Business owner rejects generated reply |
| no_action_taken | No action was taken | Pattern signal with no mapped action |

## **8.4 APEX Outcome Records**

| **Record** | **outcome_type** | **Notes** |
| --- | --- | --- |
| out_6001 — ACT-REV-001 | draft_created | waiting_for_approval · approval_required=true · posted_to_google=false |
| out_6002 — ACT-REV-004 | completed | completed · internal_action_completed=true |
| blocked_ctx_6001 — ACT-REV-002 | blocked_preserved | audit context only · not an Outcome record · is_execution_failure=false |

| **From** | **To** | **Handoff Flag** |
| --- | --- | --- |
| Section 5 Execution Records | Section 7: Feedback | **ready_for_feedback** |

# **9. Section 7 — Feedback**

| **SEC 7** **Feedback** | **This section answers:  ***What does the system learn about what happened, recorded without changing production rules?* |
| --- | --- |
|  | **INPUT   **Outcome output package from Section 6 · out_pkg |
|  | **OUTPUT  **Feedback records · context items · tuning candidates · fb_pkg · workflow_loop_closed |

## **9.1 Purpose**

Section 7 is the final section of the per-event pipeline. It evaluates Signal validity, Decision quality, Action and Execution quality, and Outcome results. It records the current human review state. It identifies tuning candidates. It packages everything into a Feedback output package for dashboards and future optimization. Then it stops. The full workflow loop is closed. Section 7 never approves, posts, changes rules, retrains models, or modifies historical records.

## **9.2 All 12 Steps**

| **Step** | **Name** | **What Happens** |
| --- | --- | --- |
| 1 | Receive Outcome Output | Accept out_pkg from Section 6. Confirm handoff_status = ready_for_feedback. Run duplicate guard. |
| 2 | Confirm Feedback Entry Eligibility | Eligible records go to feedback_records. Blocked context goes to feedback_context_items. |
| 3 | Load Feedback Categories and Rules | Build frozen rules snapshot with evaluation categories and outcome-to-feedback mapping. |
| 4 | Create Feedback Record(s) | Insert feedback_records in a single transaction. Write feedback_id back to outcomes. |
| 5 | Record Signal Validity Feedback | Was the Signal likely valid based on Outcome evidence? |
| 6 | Record Orchestrator Decision Feedback | Was the Decision reasonable given the Outcome? |
| 7 | Record Action and Execution Feedback | Did the Action and Execution work as expected? |
| 8 | Record Outcome Result Feedback | Map Outcome status to feedback outcome_result field. |
| 9 | Record Human Review State | Lock current human approval state. Never invent approval, rejection, or editing that has not occurred. |
| 10 | Identify Tuning Candidates | Record candidate-only improvement notes. All items have automatic_change = false. No production changes. |
| 11 | Prepare Feedback Output Package | Build fb_pkg with all summary states derived from actual records. Set reporting boundary flags. |
| 12 | Stop After Feedback Completion | Run boundary checks. Set handoff_status = workflow_loop_closed. Full pipeline loop closed. |

## **9.3 Evaluation Categories and States**

| **Category** | **Allowed Values** | **Derivation Rule** |
| --- | --- | --- |
| signal_validity | likely_valid · uncertain · invalid | Worst result across all feedback records wins |
| decision_quality | reasonable_so_far · questionable · not_applicable | If any record is questionable, summary is questionable |
| action_execution_quality | worked_as_expected · worked_as_expected_so_far · did_not_work | Worst result across all records wins |
| outcome_result | completed · partial_completion · failed · blocked_by_policy · waiting | Worst result across all records wins |
| human_review_state | waiting_for_human_approval · approved · rejected · edited · not_applicable | If any record is waiting, summary is waiting |

## **9.4 What Section 7 NEVER Does**

| **NEVER in Section 7** | **Why** |
| --- | --- |
| Approve, reject, or edit the draft | Human actions only — system never touches approval state |
| Post anything to Google | Only a human approval event can trigger posting |
| Change production rules or templates | All improvements are candidate_only until approved |
| Perform uncontrolled AI model training | Feedback records structured evaluation only |
| Modify historical Outcome records | Outcome records are immutable after creation |
| Create feedback_records row for blocked action | Blocked actions go to feedback_context_items only |
| Write to the Section 8 network | Feedback closes the per-event loop; Section 8 is a separate, conditional consumer of closed loops, not a step Section 7 triggers directly |

## **9.5 APEX Feedback Output Package**

| **signal_validity** | likely_valid |
| --- | --- |
| **decision_quality** | reasonable_so_far |
| **action_execution_quality** | worked_as_expected_so_far |
| **outcome_result** | partial_completion |
| **human_review_state** | waiting_for_human_approval |
| **public_posting_state** | blocked_by_policy |
| **overall dashboard state** | partial_completion |
| **production_rules_changed** | false |
| **handoff_status** | workflow_loop_closed |

**Note:** the APEX review-reply example above never resolves a sales relationship either way, won or lost — it's a Trust-category review response, not a Conversion-category sale. It correctly ends at `workflow_loop_closed` and never reaches Section 8. §10.7 below uses two different, worked examples instead — one win, one loss — for exactly this reason.

# **10. Section 8 — Network (Cohort 2 Growth Attribution)**

| **SEC 8** **Network** | **This section answers:  ***When a relationship reaches a terminal outcome — won or lost — what does it teach the cross-contractor network, and does it connect to what moved the needle (content, rank, keyword)?* |
| --- | --- |
|  | **INPUT   **A completed pipeline run (fb_pkg, `workflow_loop_closed`) where the underlying relationship reached a **terminal outcome — won or lost** — not every event · independently-collected Stream B keyword/rank data |
|  | **OUTPUT  **One `cohort2_trajectories` row (5 layers + outcome result + RankContext) · redacted transcript · queryable network aggregates, confidence-gated by real sample size |

## **10.1 Purpose**

Section 8 is fundamentally different from Sections 1–7: it is not a per-event step, it's a **conditional, cross-event** process. Most pipeline runs (a review reply, a routine SMS reminder) end at Section 7 and never reach it. A trajectory gets written once the underlying customer relationship reaches a **terminal outcome — won (booked and paid) or lost** (declined, no-show, went quiet, chose a competitor) — **not wins only** (locked 2026-07-19, resolves tracker #52, reverses the earlier won-only design). A network that only ever sees wins is survivorship-biased — it can tell you what a win looks like after the fact, but not what actually moves the needle, since it never sees what a loss looks like for comparison. When either outcome happens, an anonymized record of the whole relationship (behaviour, demographics, sentiment, timing, interests, win/loss result, and rank context) travels to a cross-contractor network, scoped to one contractor per trade per market (locked decision §18, `cohort2.ts`). Separately, Stream B market-intelligence data (SERP position, GBP/Map-Pack rank, Local SEO score — never individual-attached) is collected on its own monthly cadence and linked in at the same time, for both wins and losses alike.

## **10.2 All 13 Steps**

| **Step** | **Name** | **What Happens** |
| --- | --- | --- |
| 1 | Receive Feedback Output | Accept fb_pkg only where the underlying relationship reached a terminal outcome — won (`Transaction.status = closed`, tracker #37–#40) or lost — not every `workflow_loop_closed`. |
| 2 | Confirm Entry Eligibility | Verify a trajectory hasn't already been written for this relationship, and that it has actually reached a terminal state. An open/in-progress relationship still doesn't qualify — resolved 2026-07-19: the tracker #52 question was won-only vs. won+lost, not whether in-progress deals count. |
| 3 | Assign Outcome Result | Set `outcomeResult = "won"` or `"lost"`. If lost, a `lossReason` is **required** — went quiet, chose a competitor, price objection, no-show, declined quote, timing not right, or other. Never written blank (tracker #52). |
| 4 | Load Trajectory Layer Definitions | Load the 5 documented layers (System C, `clearsky-layers-reference.md`) — Behavioural, Demographic, Language & Sentiment, Time & Trend, Interest & Affinity. |
| 5 | Assemble Behavioural Layer | Bucket, `score_live`, velocity, session count, tier, tools engaged, action taken. |
| 6 | Assemble Demographic Layer | Human-entered persona only, never AI-inferred: gender, age band, property type, household income, family status. |
| 7 | Assemble Language & Sentiment Layer | Sentiment, urgency, price sensitivity, objections, commitment/cancellation, competitor mentions — pulled from call/review transcript content. On a loss, this is often where the reason shows up in the customer's own words. |
| 8 | Assemble Time & Trend Layer | Touch timestamps, days in system, gap trend, score peak, bucket history, channel sequence, season, demand state. |
| 9 | Assemble Interest & Affinity Layer | Service affinity, project type, aesthetic, decision driver, research depth, channel preference, referral source. |
| 10 | Attach Rank Context | Join the nearest-in-time `cr_keyword_rank_snapshots` row(s) for this business via `cr_keyword_outcome_links` (tracker #74) — a reference, not a causal claim. Business-level Stream B data, never individual-attached. Applies to both wins and losses. |
| 11 | Redact and Attach Transcript | Strip names/phone/address from the call or review transcript, keep sentence structure (`redact()`, `cohort2.ts`). |
| 12 | Write to Network | Insert the `cohort2_trajectories` row — scoped to one contractor per trade per market. `closeValue` is 0 for a loss; it is never the quoted/at-stake value. |
| 13 | Open for Confidence-Gated Query | The record becomes queryable via `GET /cohort2/query` (any Layer 1–5 field) and `GET /cohort2/query?groupBy=keyword_rank_band`. High confidence ≥200 matches, medium ≥50, low returns "insufficient sample" for both **win rate** (computed won+lost together) and **average deal value** (computed won-only) — never a fabricated number. |

## **10.3 What Section 8 NEVER Does**

| **NEVER in Section 8** | **Why** |
| --- | --- |
| Write a trajectory for a relationship that's still open/in-progress | Trajectories require a terminal outcome — won or lost — not an in-progress lead. Resolved 2026-07-19: the open tracker #52 question was won-only vs. won+lost, not whether in-progress deals qualify — they still don't. |
| Write a "lost" record with no `lossReason`, or a "won" record with one | `buildCohort2Record` throws on either mismatch — the reason is required data, not an optional note (tracker #52). |
| Blend win and loss into one misleading average | `avgCloseValue` is computed over won records only; `winRate` is the separate, honest answer to "do we win more here" (tracker #52/#74). |
| Attach an individual identity to Stream B rank data | Stream B is locked to "never has an individual attached" (`clearsky-identity-tiers-canonical.md`) — the join in Step 10 is business-level, not customer-level, for wins and losses alike. |
| Report a keyword/rank-to-win-rate or -to-revenue number below 50 matches | `queryByRankBand` returns `winRate: null` and `avgCloseValue: null` below the medium confidence threshold — no rules-table fallback exists for this correlation the way locked fields have one. |
| Let demographic data be AI-inferred | Manually entered by whoever met the client — disclosure to the customer is still an open gap (Ch8 gap note). |
| Skip the PII redaction pass | Buildable but unspecced exactly what/what-confidence/who-reviews before a transcript leaves the business (Ch8 gap note). |

## **10.4 The 5 Trajectory Layers + Outcome + Rank Context**

| **Layer** | **Name** | **Captures** |
| --- | --- | --- |
| 1 | Behavioural | Bucket, `score_live`, velocity, session count, tier, tools engaged, action taken |
| 2 | Demographic (persona) | Gender, age band, property type, income, family status |
| 3 | Language & Sentiment | Sentiment, urgency, price sensitivity, objections, commitment/cancellation, competitor mentions |
| 4 | Time & Trend | Touch timestamps, days in system, gap trend, score peak/trajectory, bucket history, channel sequence, season, demand state |
| 5 | Interest & Affinity | Service affinity, project type, aesthetic, decision driver, research depth, channel preference, referral source |
| — | Rank Context *(cross-cutting, not a 6th layer — added 2026-07-19)* | Keyword, SERP position, Map-Pack position, Local SEO score, snapshot timestamp — all nullable, sourced from Stream B via `cr_keyword_outcome_links` |
| — | Outcome metadata *(cross-cutting, not a layer)* | `outcomeResult` (won/lost), `lossReason` (required when lost, null when won), `touchesToOutcome`, `closeValue` (0 for a loss) — won/lost split added 2026-07-19, resolves tracker #52 |

## **10.5 Stream B Instrumentation Behind This Section**

| **Piece** | **Mechanism** | **Status** |
| --- | --- | --- |
| 1. Raw signal tracking | `cr_keyword_rank_snapshots` — SERP/Map-Pack/Local-SEO reading per tracked keyword per business, **monthly minimum** cadence, not gated on a content event | Specced (`contentradar-db-setup.md` §5.2) |
| 2. Content → rank movement | ContentRadar's existing Attribution Intelligence Layer (`cr_signal_snapshots`/`cr_content_outcomes`, T=0/14/30/60/90), sharpened with a `target_keyword` field on `cr_content_events` | Already existed; sharpened 2026-07-19 |
| 3. Rank → relationship outcome (won or lost) | `cr_keyword_outcome_links` + `RankContext` field on every Cohort2 record | Specced + prototype-simulated (`cohort2.ts`) |
| Internal dashboard | SERP/Local SEO Impact Dashboard — ClearSky team only, content-vs-rank cause/effect review, collection-health monitoring | Specced (`contentradar-db-setup.md` §5.4), not built |

## **10.6 Confidence Tiers (same discipline as every other Cohort 2 query)**

| **Tier** | **Threshold** | **What It Means** |
| --- | --- | --- |
| High | ≥200 matches | Trustworthy enough to report directly |
| Medium | ≥50 matches | Reportable, treated as directional |
| Low | <50 matches | Locked fields fall back to the static rules table. **Win rate and rank-band deal-value have no rules-table fallback — both return `null`, not a number.** |

## **10.7 Worked Examples — a win and a loss**

APEX's review-reply example (§9.5) never reaches Section 8 — it's a Trust-category event, not a resolved sale relationship. This section uses two worked examples instead: the already-documented RightFlush win, and a new illustrative loss (no existing story has walked a relationship through to an actual loss yet — flagged as a gap below, not invented as if it were canon).

**Win — RightFlush, Denise (Ch8):**

| **Trigger** | Denise's kitchen reno job closes — job completed, balance collected, `Transaction.status = closed` |
| --- | --- |
| **Outcome** | `outcomeResult: "won"` · `lossReason: null` · `closeValue: 20000` |
| **Behavioural** | bucket: research → comparison → active (history) · tier: T1 · tools engaged: Visualizer, Lead Grabber |
| **Demographic** | Human-entered by the rep who met her — age band, property type, income, family status, gender |
| **Language & Sentiment** | Positive, low urgency at close, no objections logged |
| **Time & Trend** | 30 touches to outcome · channel sequence: blog → FAQ → email → call |
| **Interest & Affinity** | Kitchen renovation, referral source: none |
| **Rank Context** | Nearest `cr_keyword_rank_snapshots` reading for RightFlush's tracked keyword set at close (Map-Pack position, SERP position, Local SEO score) |

**Loss — illustrative, not from an existing chapter:**

| **Trigger** | A quoted water-heater replacement goes quiet — customer stops responding 9 days after the quote, no booking, no explicit decline |
| --- | --- |
| **Outcome** | `outcomeResult: "lost"` · `lossReason: "went_quiet"` · `closeValue: 0` |
| **Behavioural** | bucket: comparison (never reached active) · tier: T1 (phone captured at the quote request) · tools engaged: Estimator |
| **Demographic** | Human-entered at the on-site quote visit |
| **Language & Sentiment** | Neutral, price sensitivity: high, one logged objection ("need to think about it") |
| **Time & Trend** | 4 touches to outcome · channel sequence: organic → phone → on-site quote → silence |
| **Interest & Affinity** | Water heater replacement, referral source: none |
| **Rank Context** | Same mechanism as the win — nearest keyword rank snapshot at the point the relationship was marked lost |
| **Open gap** | The exact trigger for marking this "lost" (a rep manually declaring it dead, vs. an automatic timeout with no activity) isn't specced anywhere — see tracker #52. |

| **From** | **To** | **Handoff Flag** |
| --- | --- | --- |
| A completed pipeline run (Section 7 `workflow_loop_closed`) where the relationship reached a terminal outcome, won or lost | Cross-contractor network (System C) + SERP/Local SEO Impact Dashboard | **cohort2_write_complete** (not yet a formal enum value anywhere — naming proposed here) |

# **11. Database Schema Overview**

## **11.1 Migration Files — Run in Order**

| **File** | **Contents** | **Run Order** |
| --- | --- | --- |
| 001_initial_schema.sql | All core tables, views, and indexes for Sections 1–7 | 1 — Run once on fresh DB |
| 002_seed_rules.sql | Signal rules (17 SIG-TRUST-xxx), Action Library, Orchestrator rules, business config | 2 — After schema |
| 003_consultant_ownership.sql | Consultant ownership and assignment rules | 3 — After seed |
| 004_40_signals_seed.sql | Expanded 40-signal library seed data | 4 — After consultant |
| 005_outcome_prisma.sql | Prisma-compatible outcome fields and indexes | 5 — After core schema |
| 006_feedback.sql | feedback_records, feedback_context_items, feedback_id column on outcomes | 6 — Final migration for Sections 1–7 |
| *(separate schema domain)* `contentradar_schema.sql` | `cr_businesses`, `cr_keyword_rank_snapshots`, `cr_keyword_outcome_links`, `cohort2_trajectories`, and the rest of Section 8's tables | **Not part of the 001–006 chain above.** Section 8 lives in ContentRadar's own schema domain (`cr_` prefix), a separate system from the AI Decision System's Sections 1–7 tables — see `contentradar-db-setup.md`. |

## **11.2 Core Tables by Section**

| **Section** | **Table(s)** | **Key Fields** |
| --- | --- | --- |
| 1 — Event | events | event_id, event_type, network_category, business_id, handoff_eligible, ai_context JSONB, raw_payload, normalized_payload |
| 2 — Signal | signal_rules, signal_events | signal_rule_id, signal_name, signal_bucket, priority, confidence_score, event_id |
| 3 — Orchestrator | orchestrator_decisions | decision_id, dominant_signal_id, selected_actions JSONB, execution_mode, owner |
| 4 — Queue | action_queue | action_queue_id, action_id, execution_mode, queue_status, parameters JSONB, approval_owner, qtrace_id |
| 5 — Execution | **executions** *(corrected 2026-07-19 — was documented here as `action_executions`/`action_execution_id`; the real table per `001_initial_schema.sql` is `executions`, column `execution_id`, same bug already fixed in `ClearSky_Section6_Outcome_Developer_Reference.md`, tracker #73)* | execution_id, action_queue_id, execution_status, generated_output, posted_externally, approved_at |
| 6 — Outcome | outcomes, blocked_outcome_context | outcome_id, outcome_type, outcome_status, execution_id, time_to_response_hours, feedback_id |
| 7 — Feedback | feedback_records, feedback_context_items | feedback_id, signal_validity, decision_quality, outcome_result, human_review_state, tuning_candidates JSONB |
| 8 — Network | cohort2_trajectories, cr_keyword_rank_snapshots, cr_keyword_outcome_links | trajectory_id, business_id, behavioural/demographic/language_sentiment/time_trend/interest_affinity JSONB, rank_context JSONB, touches_to_convert, close_value, redacted_transcript |

## **11.3 Full Traceability Chain**

| **events → signal_events → orchestrator_decisions → action_queue → executions → outcomes → feedback_records → (conditional) cohort2_trajectories** |
| --- |

Note the last link is conditional, not universal — most `feedback_records` rows have no corresponding `cohort2_trajectories` row, because most events never resolve a sales relationship either way (won or lost).

# **12. TypeScript Implementation Reference**

## **12.1 Source File Map**

| **Section** | **File** | **Entry Point** |
| --- | --- | --- |
| 1 — Event | section-1-event.ts / section_1_event.py | processRawInput() |
| 2 — Signal | section-2-signal.ts / section_2_signal.py | detectSignals() |
| 3 — Orchestrator | orchestrator-engine.ts / section_3_orchestrator.py | OrchestratorEngine.processToDecision() |
| 4 — Queue | action-queue-engine.ts / section_4_queue.py | ActionQueueEngine.processToQueue() |
| 5 — Execution | section-5-execution.ts / section_5_execution.py | runExecution() |
| 6 — Outcome | section-6-outcome.ts / section_6_outcome.py | runOutcome() |
| 7 — Feedback | section-7-feedback.ts | runFeedback() |
| 8 — Network | `prototype/src/engine/growth/cohort2.ts` (prototype only — no live runner file exists yet) | `buildCohort2Record()`, `queryByRankBand()` |
| Pipeline | review-pipeline.ts | processGbpReview() |

## **12.2 Pipeline Chain — Steps 1–19**

Steps 1-15:  processRawInput()         → Event stored, handoff_eligible = true

Step  16a:   detectSignals()            → Signal candidates created

Step  16b:   OrchestratorEngine         → Decision stored

Step  16c:   ActionQueueEngine          → Queue records created

Step  17:    runExecution()             → exec records, AI draft generated

Step  18:    runOutcome()               → outcome records created

Step  19:    runFeedback()              → feedback records, workflow_loop_closed

Step  20 *(conditional, Section 8, not yet a live step — prototype only)*:   buildCohort2Record()  → trajectory written to network, for a won *or* lost relationship (not every event)

## **12.3 Section 7 Critical Implementation Rules**

- All Section 7 feedback_records INSERTs must be in a single prisma.$transaction — if either fails, both roll back.

- feedback_id must be written back to outcomes.feedback_id inside the same transaction (bi-directional linking).

- Steps 5–10 evaluations must be computed in memory first, then written in a single UPDATE per record — never sequential updates that spread stale details.

- production_rules_changed is hardcoded FALSE at every INSERT. It is never true in Section 7.

- feedback_records rows are NEVER created for blocked actions. Blocked actions go to feedback_context_items only.

- buildFeedbackPackage() derives all summary states from created_records fields — no hardcoded values.

## **12.4 Section 8 Critical Implementation Rules**

- `buildCohort2Record()` never fires from Section 7 output directly — it's gated on the relationship reaching a terminal outcome, not on `workflow_loop_closed` alone. A win is gated on `Transaction.status = closed`; a loss has **no equivalent tracked entity yet** — `Transaction` (`prototype/src/engine/growth/transaction.ts`) only ever gets instantiated for a won deal (it models post-sale fulfillment: deposit → install → balance), so nothing in the prototype currently represents an opportunity *before* it's won or lost. Calling `buildCohort2Record` with `outcomeResult: "lost"` is the only place a loss gets recorded at all right now — flagged as a new gap (tracker #52) rather than silently assumed to be handled.

- `buildCohort2Record()` throws if `outcomeResult` and `lossReason` don't agree (`lossReason` required when lost, must be null when won) — this is enforced at write time, not left as a convention.

- `queryByRankBand()` (and any future `GET /cohort2/query` implementation) must withhold both `winRate` and `avgCloseValue` below 50 matching records — returning a fabricated number below that threshold is the one thing tracker #74 was explicitly built to prevent. `avgCloseValue` is computed over won records only, never blended with the zero-value losses.

- Demographic fields are never AI-inferred — human entry only, same rule as Section 7's "never invent approval that hasn't occurred."

- Rank Context joins are business-level only (`business_id` + nearest-in-time snapshot) — never resolve or store an individual identity alongside Stream B data, for wins or losses alike.

# **13. End-to-End Working Example — APEX Contracting**

## **13.1 The Triggering Event**

| **Business** | APEX Contracting — Northern Ontario trades contractor |
| --- | --- |
| **Provider** | Google Business Profile |
| **Reviewer** | Margaret T. |
| **Rating** | 1 star |
| **Review Text** | Emergency! My roof is leaking after the repair they did last week. I have called 5 times and no one answers. Water is coming into my kitchen right now! |
| **AI Sentiment** | Negative |
| **AI Urgency** | High |
| **AI Complaint Topics** | poor communication, leaking roof, safety_violation |

## **13.2 Pipeline Summary — Section by Section**

| **Section** | **Key Decision** | **What Was Produced** |
| --- | --- | --- |
| **1 — Event** | review.created → review_received | evt_7001 stored · Trust category · handoff_eligible=true · AI: negative sentiment, communication+safety complaint, high urgency |
| **2 — Signal** | 3 signals fired | SIG-TRUST-001 dominant (Risk, priority 1) · SIG-TRUST-005 + SIG-TRUST-017 supporting · SIG-TRUST-008 skipped (< 2hr threshold) |
| **3 — Orchestrator** | Risk dominant, 2 actions | ACT-REV-001 approval_required + ACT-REV-004 automatic selected · ACT-REV-002 blocked by Safety Rule ORC-004 |
| **4 — Queue** | 2 records queued | aq_3001: ACT-REV-001 pending_approval · aq_3002: ACT-REV-004 ready_for_execution · 8 parameters resolved · qtrace created |
| **5 — Execution** | Draft + log completed | exec_49dd96a471: AI review reply draft · posted_externally=false · exec_b8326526d5: complaint theme logged · ACT-REV-002 excluded |
| **6 — Outcome** | 2 outcomes recorded | out_6001: draft_created · waiting_for_approval · out_6002: completed · blocked_ctx_6001 preserved as audit context |
| **7 — Feedback** | Loop closed | fb_7001 + fb_7002 created · signal=likely_valid · decision=reasonable_so_far · execution=worked_as_expected_so_far · human_review=waiting · workflow_loop_closed |
| **8 — Network** | **Does not fire** | This is a review-response event, not a resolved sales relationship (won or lost) — no `cohort2_trajectories` row is written. See §10.7 for worked examples (one win, one loss) that do reach Section 8. |

| **PENDING: Review Reply Awaiting Human Approval** The AI-generated review reply draft exists and is waiting for Sarah Jenkins (consultant) to approve, edit, or reject it. It has NOT been posted to Google. It will only be posted after explicit human approval. The complaint theme has been logged internally. No production rules have been changed. No AI model retraining has occurred. |
| --- |

# **14. Recommended Files to Download for New Project**

The following files should be downloaded from this project and added to the new project. The new project requires an understanding of the workflow that has already been developed.

## **14.1 Priority 1 — Must Have**

| **File** | **Contents** | **Why Needed** |
| --- | --- | --- |
| ClearSky_AI_Decision_System_Technical_Spec_1.pdf | Full system spec: Sections 1–7, data model, API surface, acceptance criteria | The authoritative reference for the per-event pipeline design |
| ClearSky_Section6_Outcome_Full_Documentation.md | Complete Section 6 developer docs: schema, Prisma, 12 steps, entry point, verification queries, common mistakes | The pattern all sections follow — new work must match this format |
| ClearSky_Section_7_Feedback_Expanded_Summary_and_Next_Prompt.docx | Section 7 design: all 12 steps, mini-steps, JSON examples, Q&A, lock-in questions | The locked design for the Feedback section just built |
| ClearSky_Section_6_Outcome_Summary_for_Section_7.docx | Section 6 completion output and handoff context for Section 7 | The handoff state that Section 7 was built against |
| ClearSky_Pipeline_Complete_Reference.md | This document — comprehensive reference for all 8 sections | First file to add to the new project |
| `prototype/src/engine/growth/cohort2.ts` | Section 8's prototype simulation — 5-layer trajectory model, RankContext, queryByRankBand | Only existing implementation of Section 8, even though it's prototype-only |
| `specs/clearsky-layers-reference.md` | System C — Cohort 2 Trajectory Layers, the canonical spec Section 8 is built against | Defines the 5 layers + Rank Context Section 8 assembles |
| `specs/contentradar/contentradar-db-setup.md` | §5.2/§5.4 — Stream B keyword-rank instrumentation and the SERP/Local SEO Impact Dashboard behind Section 8 | The schema Section 8's Rank Context step reads from |

## **14.2 Priority 2 — Section Handoff Documents**

| **File** | **Contents** | **Why Needed** |
| --- | --- | --- |
| ClearSky_Event_Sections_1_2_Updated_Handoff_for_Section_3.docx | Sections 1 and 2 locked design: Event mental model, raw input vs Event, Network Category vs Signal Bucket | Foundation of the entire pipeline — defines what an Event is |
| ClearSky_Section_1_Event_Intake_Working_Example_Summary.docx | Section 1 step-by-step working example: APEX review through all 15 intake steps to handoff-eligible Event | The canonical working example all later sections reference |
| ClearSky_Section_3_Orchestrator_Summary_and_Section_4_Prompt.docx | Section 3 locked design: all 12 steps, dominant Signal selection, Action mapping, decision record | Required to understand how decisions are made |
| ClearSky_Section_4_Action_Queue_Parameters_Summary_and_Section_5_Execution_Prompt.docx | Sections 4 and 5 design: queue creation, parameter resolution, execution lanes, draft generation boundary | Required to understand how work is queued and executed |
| ClearSky_Section_5_Execution_Summary_and_Section_6_Outcome_Prompt.docx | Section 5 completion output and Section 6 prompt: execution records, draft created state, outcome step list | The bridge between Execution and Outcome |
| `specs/clearsky-open-decisions-tracker.md` #74 | Full history of the Section 8 attribution decision — including the reversed "don't build yet" call | Explains *why* Section 8's revenue-correlation output is confidence-gated, not just that it is |

## **14.3 Priority 3 — Reference and History**

| **File** | **Contents** | **Why Needed** |
| --- | --- | --- |
| ClearSky_40_Signals_Prototype_Workbook_updated_parameters_1.xlsx | All 40 signals with parameters, thresholds, action mappings, and priority values | Required when adding new signals or modifying existing ones |
| ClearSky_Session2_Summary.docx | Session 2 summary: two critical bugs fixed, Section 3 verified, orchestrator decisions confirmed | Documents the verified decision engine state and known fixes |
| ClearSky_Section6_Outcome_Developer_Reference.docx | Section 6 developer reference with pseudocode, SQL, and implementation roadmap | Supplementary reference for the Outcome section implementation |

## **14.4 Priority 4 — Source Code and Schema Files**

| **File** | **Contents** |
| --- | --- |
| 001_initial_schema.sql | Complete database schema for Sections 1–7 including views and indexes |
| 002_seed_rules.sql | All signal rules, Action Library entries, Orchestrator rules, and business config |
| 003_consultant_ownership.sql | Consultant ownership and assignment configuration |
| 004_40_signals_seed.sql | Expanded 40-signal library seed data |
| 005_outcome_prisma.sql | Prisma-compatible outcome fields and indexes |
| schema_outcome_models.prisma | Prisma schema models for Outcome section |
| section_1_event.py | Python implementation of Section 1 Event Intake |
| section_2_signal.py | Python implementation of Section 2 Signal Detection |
| section_3_orchestrator.py | Python implementation of Section 3 Orchestrator Decision |
| condition_evaluator.py | Signal rule condition evaluator — reads conditions from DB and evaluates against Events |
| runner.py | Pipeline runner that chains all sections in sequence (Sections 1–7 only — no Section 8 runner exists) |
| main.py | FastAPI application entry point (port 8000) |
| database.py | PostgreSQL connection and query helpers |
| `contentradar_schema.sql` | Section 8's actual schema domain — `cr_` prefixed tables plus `cohort2_trajectories`, separate from the 001–006 migration chain above |

# **15. Copy-Paste Prompt for the New Project**

Use this prompt when starting the new project thread. It carries forward all locked design decisions, the full workflow, and the correct boundaries.

| **You are helping me continue the ClearSky AI Decision System after completing Sections 1–7 and specifying Section 8.** Do not rename the locked core workflow or introduce new layers unless I ask. **LOCKED PER-EVENT WORKFLOW:** *Event → Signal → Orchestrator Decision → Action Queue + Parameters → Execution → Outcome → Feedback* **SECTIONS 1–7 COMPLETE AND VERIFIED:** Section 1: Event Intake — Event stored, handoff_eligible = true, AI extraction complete Section 2: Signal Detection — 3 signals created, negative_review_risk dominant, SIG-TRUST-008 suppressed Section 3: Orchestrator Decision — ACT-REV-001 (approval_required) + ACT-REV-004 (automatic) + ACT-REV-002 (blocked) Section 4: Action Queue + Parameters — 2 queue records, all parameters resolved, qtrace created Section 5: Execution — draft_created (pending approval, NOT posted) + complaint theme logged automatically Section 6: Outcome — out_6001 (waiting_for_approval) + out_6002 (completed) + blocked_ctx preserved Section 7: Feedback — fb_pkg produced, workflow_loop_closed, production_rules_changed = false **SECTION 8 — SPECCED, PROTOTYPE-SIMULATED, NOT YET A LIVE RUNNER:** Conditional on a relationship reaching a terminal outcome — won OR lost, not just wins (locked 2026-07-19, resolves tracker #52) — not every event. Writes an anonymized 5-layer trajectory (Behavioural, Demographic, Language & Sentiment, Time & Trend, Interest & Affinity) plus outcomeResult/lossReason and a Rank Context annotation to a cross-contractor network, scoped to one contractor per trade per market. A lost record always carries a required lossReason; a won record never does. Win-rate/deal-value correlation output is confidence-gated (high ≥200, medium ≥50, low returns null — never a fabricated number); win rate is computed won+lost together, average deal value over wins only. **CRITICAL BOUNDARIES — ALWAYS ENFORCED:** The review reply draft has NOT been approved, edited, rejected, or posted. Do not assume it has. Do not perform uncontrolled AI model training. Do not automatically change rules, templates, mappings, or policies. All improvements are candidate_only unless explicitly approved. Do not attach an individual identity to Stream B (market-level) data, ever. Do not report a rank/keyword-to-win-rate or -to-revenue number below 50 matching samples. Do not write a lost record with no reason, or a won record with one. **STACK:  TypeScript · SvelteKit · Prisma · PostgreSQL · OpenAI** |
| --- |

# **16. Quick Reference**

## **16.1 Handoff Status Chain**

| **From Section** | **To Section** | **Handoff Flag** |
| --- | --- | --- |
| 1 — Event Intake | 2 — Signal Detection | handoff_eligible = true |
| 2 — Signal Detection | 3 — Orchestrator Decision | ready_for_orchestrator |
| 3 — Orchestrator Decision | 4 — Action Queue | prepared_for_action_queue |
| 4 — Action Queue | 5 — Execution | ready_for_execution |
| 5 — Execution | 6 — Outcome | ready_for_outcome |
| 6 — Outcome | 7 — Feedback | ready_for_feedback |
| 7 — Feedback | END OF PER-EVENT PIPELINE | workflow_loop_closed |
| 7 — Feedback *(conditional, only on a terminal outcome — won or lost)* | 8 — Network | *(no formal enum value yet — proposed `cohort2_write_complete`)* |

## **16.2 Action Library — Review Actions**

| **Action ID** | **Name** | **Execution Mode** |
| --- | --- | --- |
| ACT-REV-001 | create_review_reply_draft | approval_required — always (public-facing action) |
| ACT-REV-002 | post_review_reply | blocked — always (Safety Rule ORC-004 — auto-posting prohibited) |
| ACT-REV-004 | log_review_complaint_theme | automatic — internal only, no external posting |

## **16.3 DB Verification Queries — Section 7**

-- Feedback records with evaluation states

SELECT feedback_id, action_id, signal_validity, decision_quality,

       outcome_result, human_review_state, production_rules_changed

FROM feedback_records ORDER BY created_at DESC LIMIT 5;

-- MUST return 0 — production rules never changed in Section 7

SELECT COUNT(*) FROM feedback_records WHERE production_rules_changed = TRUE;

-- MUST return 0 — no feedback row for blocked actions

SELECT COUNT(*) FROM feedback_records WHERE action_id = 'ACT-REV-002';

-- feedback_id written back to outcomes

SELECT outcome_id, feedback_id FROM outcomes

WHERE feedback_id IS NOT NULL ORDER BY updated_at DESC LIMIT 5;

-- Full pipeline traceability audit — corrected 2026-07-19: real table is
-- `executions` with column `execution_id`, not `action_executions`/
-- `action_execution_id` (same class of bug already fixed in
-- ClearSky_Section6_Outcome_Developer_Reference.md, tracker #73)

SELECT fr.feedback_id, fr.signal_validity, fr.outcome_result,

       o.outcome_id, o.outcome_status,

       ex.execution_id, ev.reviewer_name, ev.rating

FROM feedback_records fr

JOIN outcomes o     ON fr.outcome_id = o.outcome_id

JOIN executions ex  ON fr.execution_id = ex.execution_id

JOIN events ev      ON fr.event_id = ev.event_id

ORDER BY fr.created_at;

## **16.4 DB Verification Queries — Section 8**

Note on the first query below: a "won" trajectory should trace back to a closed transaction; a "lost" one has **no transaction row at all by design** (per §12.4 — nothing represents an opportunity before it resolves, so a loss is never expected to join to `transactions`). The two outcome types need two different checks, not one.

-- MUST return 0 — every WON trajectory should trace back to a closed transaction

SELECT COUNT(*) FROM cohort2_trajectories t

JOIN businesses b ON t.business_id = b.id

WHERE t.outcome_result = 'won' AND NOT EXISTS (

  SELECT 1 FROM transactions tx

  WHERE tx.business_id = b.id AND tx.status = 'closed'

);

-- MUST return 0 — a lost trajectory always carries a reason; a won one never does

SELECT COUNT(*) FROM cohort2_trajectories

WHERE (outcome_result = 'lost' AND loss_reason IS NULL)

   OR (outcome_result = 'won' AND loss_reason IS NOT NULL);

-- MUST return 0 — Stream B rank snapshots never carry a customer/profile reference

SELECT COUNT(*) FROM cr_keyword_rank_snapshots WHERE profile_id IS NOT NULL;

-- Rank-band query sample sizes and win rate — anything below 50 should report
-- win_rate/avg_close_value = NULL from the application layer (queryByRankBand),
-- not from this raw query, which is a health check on the underlying volume only

SELECT rank_band, COUNT(*) AS sample_size,

       COUNT(*) FILTER (WHERE outcome_result = 'won') AS won_count,

       COUNT(*) FILTER (WHERE outcome_result = 'lost') AS lost_count

FROM cohort2_trajectories

GROUP BY rank_band

ORDER BY sample_size DESC;

*ClearSky AI Decision System — Complete Pipeline Reference — All 8 Sections*

APEX Contracting · Sarah Jenkins · Sessions 1–6 Complete (Sections 1–7) · Section 8 added 2026-07-19 · workflow_loop_closed

Page
