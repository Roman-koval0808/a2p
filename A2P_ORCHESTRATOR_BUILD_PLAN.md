# A2P Orchestrator — Build Plan (implementation-ready)

> **Source spec:** A2P Orchestrator Developer Specification v1.1
> **Target codebase:** `apps/lead-grabber-v1` (SvelteKit 2 + Svelte 5, Prisma/PostgreSQL, Telnyx Call Control + Messaging)
> **Audience:** an implementing agent (e.g. Gemini) building directly against this repo.
> **Do NOT touch:** `apps/profiledb` (redundant).

This document translates the spec into concrete work against the *actual* files in this repo:
which models to add, which existing services to reuse vs. extend, exact stage wiring, the
acceptance-test → test-file mapping, and a dependency-ordered build order. Read Part 0
(orientation) first; it is what keeps you from rebuilding things that already exist.

---

## PART 0 — CODEBASE ORIENTATION (read first)

### 0.1 Stack & conventions
- **Framework:** SvelteKit 2, Svelte 5 runes. Server code under `src/lib/server/**`, HTTP under `src/routes/api/**/+server.ts`.
- **DB:** Prisma → PostgreSQL. Schema at `apps/lead-grabber-v1/prisma/schema.prisma`. Client is generated into a **linked local package** `clearsky-db-client` (see `generator client { output = "../clearsky-db-client" }`). Import prisma via `import { prisma } from '$lib/db'`.
- **IDs:** every model uses `String @id @default(cuid())`. **Use cuid, not uuid**, for new models — it is the repo convention and `comm_id` only needs to be opaque/internal, which cuid satisfies. (The spec says "uuid"; treat that as "opaque internal id".)
- **Table naming:** `@@map("snake_case")`. Field naming: camelCase in Prisma, snake_case in DB is *not* used here — fields stay camelCase. Match surrounding style.
- **Enums:** the schema mixes Prisma enums (`CommunicationType`, `TaskStatus`) and bare `String` fields (all `Pipeline*` status fields). **New container/timer lifecycle fields use real Prisma enums** for DB-level safety; keep free-form status strings only where you extend an existing `Pipeline*` model that already uses strings.
- **Migrations:** hand-authored SQL under `prisma/migrations/<timestamp>_<name>/migration.sql` (see existing `20260215000000_clearsky_spec`). After editing schema: `pnpm --filter clearsky-demo db:generate` then `db:migrate` (dev) or apply SQL. Applying against the real DB requires `DATABASE_URL`; the implementer runs this, not the schema author.
- **Tests:** Vitest, colocated `*.test.ts`. Prisma is mocked with `vi.mock('$lib/db', …)`; env with `vi.mock('$env/static/private', …)` / `'$env/dynamic/private'`. See `src/lib/server/orchestrator.test.ts` for the canonical mocking pattern.
- **Background jobs:** guarded `setInterval` started once in `src/hooks.server.ts` (see the `__slaCronStarted` / `__cohort2CronStarted` guards). Each tick lazy-imports its worker and `.unref()`s the timer. Every cron also has a paired `POST /api/a2p/<x>/…` route as an external-cron alternative. **New sweeps follow this exact idiom.**
- **Dead code to ignore:** `src/lib/server/a2p-db.ts` and `a2p-client.ts` talk to a *retired external A2P backend* (`A2P_DATABASE_URL`, `AI_BASE_URL`), disabled by default. The orchestrator is now in-house; do not build on them.

### 0.2 The existing pipeline (Part 2 of the spec — "built and verified")
The eight-stage pipeline already exists as `Pipeline*` models + engines. Reuse it; do not fork it.

| Stage | Engine file (`src/lib/server/pipeline/`) | Prisma model(s) |
|---|---|---|
| 1 Intake | `unified-pipeline.ts` → `UnifiedPipeline.process(payload)` | `PipelineEvent` |
| 1a Identity | `profile-service.ts` → `resolveAndMergeLocalProfile(tx, …)` | `PipelineCustomerProfile` |
| 2 Signals | `signal-engine.ts`, `signal-rules.ts` | `PipelineSignal` |
| 3 Orchestrator | `orchestrator-engine.ts` | `PipelineDecision` |
| 4 Action Queue | `action-queue-engine.ts` | `PipelineActionQueue` |
| 5 Execution | `execution-engine.ts`, `execution-modes.ts` | `PipelineExecution`, `PipelineApprovalPackage` |
| 6 Outcome | `outcome-engine.ts` | `PipelineOutcome` |
| 7 Feedback | `feedback-engine.ts` | `PipelineFeedbackRecord` |
| 8 Network | `cohort2.ts`, `cohort2-sweep.ts` | `Cohort2Trajectory` |

`UnifiedPipeline.process(payload: PipelinePayload)` is the **Stage-1 entry point**. `PipelinePayload = { provider, eventType, externalId, companyId?, customerPhone?, customerEmail?, customerName?, sessionId?, textContent, rating?, occurredAt?, metadata? }`. `externalId` is the provider dedup key (→ `PipelineEvent.providerEventId @unique`). **This is how the timer service injects synthetic events** (Part 1.2 below).

### 0.3 Existing Telnyx / comms plumbing to reuse
| Concern | Files |
|---|---|
| Call Control base client | `src/lib/server/telnyx.ts` |
| Bridge / dial / whisper | `src/lib/server/telnyx-bridge.ts`, `emergency-routing.ts`, `internal-call-guard.ts` |
| Voice webhooks / IVR | `routes/api/telnyx/{call-webhook,webhook,answer-call,hangup}/+server.ts`, `routes/api/telnyx/ivr/{gather,speak,bridge}/+server.ts` |
| Click-to-call dial | `routes/api/telnyx/dial/+server.ts` |
| Call state store | `src/lib/server/call-state.ts` + `CallState` model |
| SMS send / consent / intent | `src/lib/server/{sms,sms-alert,consent,message-intent,reply-sanity,reply-skills,callback-ack}.ts`, `routes/api/sms/*` |
| Email | `src/lib/server/{brevo,company-sender,slots-email}.ts`, `email/bridge.ts`, `routes/api/email/*` |
| Calendar | `src/lib/server/{google-calendar,calendar,appointment-flow}.ts`, `GoogleCalendarConnection`, `Appointment`, `SlotHold`, `ScheduleEvent`, `routes/api/schedule/*` |
| Number lookup | Telnyx Verify/Lookup — skill `telnyx-verify-javascript`; wrap in a new `number-lookup.ts` (§1.3) |
| Push notifications | `src/lib/server/push/{firebase,incoming-call}.ts`, `UserDevice` |
| SLA sweep (narrow, existing) | `src/lib/server/sla-monitor.ts` + `hooks.server.ts` interval |
| Per-company config | `PipelineBusinessConfig` (`slaMinutes`, `slaResponseHours`, `officeHours`, `officeTimezone`, `maxRetries`, `smsAutoReplyAllowed`) |

### 0.4 The gap this plan fills
Neither the `CommunicationThread`/`CommunicationLog` layer nor the `Pipeline*` layer implements the spec's **container contract** (`comm_ref`, `lifecycle: provisional|confirmed|merged`, `actions_suppressed`, join windows, ref aliasing, merge/split) or a **general timer service** (only the narrow `sla-monitor.ts` exists). **Everything in Parts 3–5 references these two.** They are Phase-1 items #1 and #2 and must be built first.

---

## PART 1 — SHARED INFRASTRUCTURE (build before any scenario)

### 1.1 Data model — new Prisma models

Append to `apps/lead-grabber-v1/prisma/schema.prisma`. All additive. Add the listed
**back-relations** to `Company`, `Contact`, `PipelineCustomerProfile` (Prisma requires both sides).

```prisma
// ---- Enums ----
enum ContainerLifecycle { provisional  confirmed  merged }
enum ContainerState     { open  awaiting_reply  awaiting_approval  closed }
enum ContainerResolution{ resolved  timed_out  lost }
enum ThreadType         { emergency  sales  support  general }
enum ClosurePolicy      { auto  indefinite }
enum EntryDirection     { inbound  outbound }
enum EntryChannel       { voice  sms  email  form }
enum PartyType          { customer  rep  system }
enum IdentityMethod     { ani_exact  email_match  transcript_name  manual  none }
enum TimerType          { sla_breach  thread_inactivity  calendar_grace  hold_expiry  approval_deadline  promise_due  customer_retry }
enum TimerStatus        { registered  fired  cancelled  superseded }
enum DraftType          { email  sms }
enum ApprovalState      { pending  approved  rejected  expired }
enum TaskCategory       { customer_promise  internal_followup }
enum CommTaskStatus     { open  done  escalated  cancelled }

// ---- Container: the comm_id ----
model CommContainer {
  id                       String   @id @default(cuid())   // comm_id (internal, never shown)
  commRef                  String   @unique                // "#4412" from comm_ref_seq
  companyId                String
  company                  Company  @relation(fields: [companyId], references: [id], onDelete: Cascade)
  customerProfileId        String?                         // spec person_id
  customerProfile          PipelineCustomerProfile? @relation(fields: [customerProfileId], references: [id], onDelete: SetNull)
  contactId                String?
  contact                  Contact? @relation(fields: [contactId], references: [id], onDelete: SetNull)

  subject                  String?                          // set at review
  threadType               ThreadType
  lifecycle                ContainerLifecycle   @default(provisional)
  state                    ContainerState       @default(open)
  resolution               ContainerResolution?
  mergedInto               String?                          // surviving comm_id
  actionsSuppressed        Boolean  @default(false)         // §1.1.4 intake gate
  slaDeadline              DateTime?
  closurePolicy            ClosurePolicy @default(auto)
  inactivityTimeoutSeconds Int                              // defaulted from threadType (§1.2)
  joinWindowSeconds        Int                              // defaulted from threadType (§1.1.4)
  previousThreadId         String?                          // out-of-grace reopen (§1.2)
  lastActivityAt           DateTime @default(now())
  openedAt                 DateTime @default(now())
  closedAt                 DateTime?
  createdAt                DateTime @default(now())
  updatedAt                DateTime @updatedAt

  entries    CommEntry[]
  timers     PipelineTimer[]
  commTasks  CommTask[]
  holds      CommHold[]
  approvals  CommApproval[]
  refAliases CommRefAlias[] @relation("AliasTarget")

  @@index([companyId])
  @@index([customerProfileId])
  @@index([companyId, threadType, state])
  @@index([companyId, lifecycle, state])   // open-threads view = lifecycle:confirmed, state != closed
  @@index([mergedInto])
  @@map("comm_containers")
}

// ---- Entry: immutable append-only communication ----
model CommEntry {
  id                 String        @id @default(cuid())
  commId             String
  container          CommContainer @relation(fields: [commId], references: [id], onDelete: Cascade)
  customerProfileId  String?
  direction          EntryDirection
  channel            EntryChannel
  fromParty          String
  toParty            String
  fromPartyType      PartyType
  toPartyType        PartyType
  occurredAt         DateTime      @default(now())
  recordingUrl       String?
  transcript         String?
  analysisJson       Json?
  dedupSuppressed    Boolean       @default(false)          // §1.1.4 / dedup: suppress ACTIONS never storage
  identityConfidence Float?
  identityMethod     IdentityMethod @default(none)
  // NOTE: customerFacing is DERIVED, never stored (§1.1.5):
  //   customerFacing = fromPartyType == customer || toPartyType == customer
  //   expose it via a helper, not a column.
  createdAt          DateTime      @default(now())

  @@index([commId, occurredAt])
  @@map("comm_entries")
}

// ---- Ref alias: losing ref redirects to survivor on merge (§1.1.1) ----
model CommRefAlias {
  id           String        @id @default(cuid())
  ref          String        @unique
  targetCommId String
  target       CommContainer @relation("AliasTarget", fields: [targetCommId], references: [id], onDelete: Cascade)
  note         String?
  createdAt    DateTime      @default(now())
  @@index([targetCommId])
  @@map("comm_ref_aliases")
}

// ---- Reassignment / merge / split audit log (§1.1.6) ----
model ThreadReassignmentLog {
  id         String   @id @default(cuid())
  recordId   String
  recordType String    // entry | task | hold | timer | approval | work_order
  fromCommId String?
  toCommId   String
  actor      String?
  reason     String?
  createdAt  DateTime @default(now())
  @@index([recordId])
  @@index([toCommId])
  @@map("thread_reassignment_logs")
}

// ---- Timer registry (§1.2) ----
model PipelineTimer {
  id           String        @id @default(cuid())
  commId       String
  container    CommContainer @relation(fields: [commId], references: [id], onDelete: Cascade)
  companyId    String?
  type         TimerType
  fireAt       DateTime
  status       TimerStatus   @default(registered)
  payload      Json?         @default("{}")
  fireEventKey String?       @unique                        // idempotency key for the synthetic event
  firedAt      DateTime?
  cancelledAt  DateTime?
  cancelReason String?
  createdAt    DateTime      @default(now())
  updatedAt    DateTime      @updatedAt
  @@index([status, fireAt])
  @@index([commId, type, status])
  @@map("pipeline_timers")
}

// ---- Task (spec §1.5) — new model, NOT the existing `Task` (which is UI-facing) ----
model CommTask {
  id             String          @id @default(cuid())
  commId         String
  container      CommContainer   @relation(fields: [commId], references: [id], onDelete: Cascade)
  sourceEntryId  String?                                    // provenance
  description    String
  ownerUserId    String                                     // a PERSON, never a team/queue (§1.5)
  due            DateTime                                   // never "soon"
  category       TaskCategory
  confidence     Float           @default(1.0)
  status         CommTaskStatus  @default(open)
  createdAt      DateTime        @default(now())
  updatedAt      DateTime        @updatedAt
  @@index([commId])
  @@index([ownerUserId, status])
  @@map("comm_tasks")
}

// ---- Tentative calendar hold (spec §Scenario 4 / §1.2 hold_expiry) ----
model CommHold {
  id             String        @id @default(cuid())
  commId         String
  container      CommContainer @relation(fields: [commId], references: [id], onDelete: Cascade)
  resourceIds    Json          @default("[]")               // salesperson + vehicle etc.
  startTime      DateTime
  endTime        DateTime?
  status         String        @default("tentative")        // tentative | booked | released
  holdExpiresAt  DateTime
  calendarEventId String?
  createdAt      DateTime      @default(now())
  updatedAt      DateTime      @updatedAt
  @@index([commId])
  @@index([status, holdExpiresAt])
  @@map("comm_holds")
}

// ---- Approval queue item (spec §1.4) ----
model CommApproval {
  id              String        @id @default(cuid())
  commId          String
  container       CommContainer @relation(fields: [commId], references: [id], onDelete: Cascade)
  draftType       DraftType
  draftContent    String
  contextPayload  Json          @default("{}")              // reconciliation data (§1.4)
  approvalDeadline DateTime
  state           ApprovalState @default(pending)
  approvedBy      String?
  rejectedReason  String?
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt
  @@index([commId])
  @@index([state, approvalDeadline])
  @@map("comm_approvals")
}
```

**Back-relations to add** (both sides required):
- `Company`  → `commContainers CommContainer[]`
- `Contact`  → `commContainers CommContainer[]`
- `PipelineCustomerProfile` → `commContainers CommContainer[]`

**Person model note (§1.1):** the spec's `Person` maps to the existing `PipelineCustomerProfile`
(has `email`, `phoneNumber`, `companyId`, `metadata`). Extend it rather than adding a new table:
add `status String? @default("unknown")` (`unknown|prospect|client|former`), `smsConsent Boolean @default(false)`,
`consentSource String?`, `smsCapable Boolean?`, `mergedInto String?`, `lineType String?`, `carrier String?`,
`lookupDate DateTime?`. Model **identifiers as a collection** — add a `CommIdentifier` child model
(`{ id, customerProfileId, kind: phone|email, value, createdAt, @@unique([customerProfileId, kind, value]) }`)
so one profile can hold many numbers/emails (**phone is not a PK** — §1.1). Keep `phoneNumber`/`email` on the
profile as the "primary" convenience fields, but write every identifier into `CommIdentifier` too.

### 1.1a comm_ref sequence
Generate `comm_ref` from a Postgres sequence (concurrency-safe, no race). In the migration:
```sql
CREATE SEQUENCE IF NOT EXISTS comm_ref_seq START 4000;   -- start high so refs look "real"
```
Allocation in the service: `SELECT nextval('comm_ref_seq')` → format as `#${n}`. Never reuse/delete.

### 1.1b Container service — `src/lib/server/container/container-service.ts`
Pure-logic helpers must be independently unit-testable (mock prisma). Public API:

```ts
// Deterministic thread_type classification at intake (§1.1.4). NO LLM here.
classifyThreadType(input: { ivrOption?: number; keywordHit?: boolean; text?: string }): ThreadType
//   option 3 + emergency keyword => emergency; option 2 => sales; option 3 => support; else general.
//   Uses EMERGENCY_KEYWORDS from ai/emergency (§1.8).

joinWindowSecondsFor(t: ThreadType): number      // emergency 2h, support 3d, sales 14d, general 24h
inactivityTimeoutSecondsFor(t: ThreadType): number  // emergency short, sales long — see §1.2 table

// §1.1.2 — create container at intake, ALWAYS, before transcription. Allocates ref, applies
// the suppression gate, returns { container, actionsSuppressed, suppressedAgainstCommId? }.
createContainerAtIntake(tx, {
  companyId, customerProfileId, contactId?, threadType,
  now, // = call.start_time
}): Promise<{ container; actionsSuppressed; suppressedAgainstCommId?: string }>

// §1.1.4 — pure decision fn (unit-testable without DB):
shouldSuppressActions(args: {
  incomingType: ThreadType;
  openContainers: { threadType: ThreadType; openedAt: Date; joinWindowSeconds: number; state: ContainerState }[];
  now: Date;
}): { suppress: boolean; againstCommId?: string }
//   suppress iff an OPEN container of the SAME threadType exists within its joinWindow. Different
//   type never suppresses (this is what test 3-8 checks).

// §1.1.1 — ref resolution with redirect
resolveRef(companyId, ref): Promise<{ container; redirectedFrom?: string; note?: string } | null>

// §1.1.3 — review-time merge (subject-aware, decided AFTER analysis). Never auto-merge below threshold.
reviewMerge(tx, { loserCommId, survivorCommId, actor, reason, confidence }): Promise<void>
//   Repoints entries/tasks/holds/approvals/timers loser→survivor; logs each move in
//   ThreadReassignmentLog; marks loser lifecycle=merged, mergedInto=survivor; creates CommRefAlias
//   (loser.ref -> survivor, note "merged into <survivorRef> on <date>"). KEEP THE OLDER REF AS
//   SURVIVOR (§1.1.1) — if loser.ref is older, swap which is survivor. Never delete anything.

splitEntries(tx, { entryIds, fromCommId, toCommId, actor, reason }): Promise<void>  // reverse of merge

// §1.1.6 — single-record reassignment with audit
reassign(tx, { recordId, recordType, fromCommId, toCommId, actor, reason }): Promise<void>

// §1.1.5 — the "click a container" assembler
getContainerView(commId): Promise<{
  container; entries: []; tasks: []; holds: []; approvals: []; timers: [];  // timers/approvals INCLUDING pending
  state; resolution;
}>
```

**Invariant enforcement (I-11):** provide a single `createEntry`, `createTimer`, `createTask`,
`createHold`, `createApproval` wrapper that *requires* a non-null `commId` argument and throws if
missing. Route all creation through these. Add a lint/test that fails if any `prisma.commEntry.create`
etc. is called without a `commId` (test I-11).

**Suppression gate wiring (§1.1.4 / I-8):** `createContainerAtIntake` always creates the container +
ref (even when suppressing). When `shouldSuppressActions` returns `suppress:true`, set
`actionsSuppressed=true` and **do not** register a bridge/SLA/dial-ladder timer; instead route the
signal into the existing container's escalation (append a synthetic signal to the open container —
see Scenario 3).

### 1.2 Timer service — `src/lib/server/timer/timer-service.ts`

The single most important shared component. **A breach is the absence of an event; the timer manufactures the event.**

```ts
registerTimer(tx, { commId, companyId?, type: TimerType, fireAt: Date, payload?, supersedeSameType?: boolean }): Promise<PipelineTimer>
//   if supersedeSameType, mark any existing registered timer of same (commId,type) status=superseded.
cancelTimer(id, reason): Promise<void>        // when the obligation is met before fire
cancelTimersForContainer(commId, type?, reason): Promise<void>

sweepTimers(now = new Date()): Promise<{ due: number; fired: number; skipped: number }>
```

**Sweep algorithm** (runs every 30s):
1. `findMany({ where: { status: 'registered', fireAt: { lte: now } }, take: 200, orderBy: fireAt })`.
2. For each timer, **evaluate its condition** (below). If the obligation was met, mark `cancelled` (reason `condition_met`) — do **not** fire.
3. If unmet: build a synthetic `PipelinePayload` and call `UnifiedPipeline.process(payload)` with
   `provider: 'timer'`, `eventType: 'timer.<type>'`, `externalId: timer.fireEventKey` (allocate a stable
   key on registration = `tmr_<id>` so redelivery is idempotent), `companyId`, `metadata: { comm_id, timer_type, ...payload }`,
   `textContent: '<synthetic escalation for #ref>'`. Then mark timer `status='fired', firedAt=now`.
4. Wrap each timer in try/catch; one failure must not abort the sweep (log + continue). Idempotency via
   `fireEventKey @unique` + `PipelineEvent.providerEventId @unique` means a re-run cannot double-fire.

**Condition evaluators** (per type — "if unmet, fire"):
| Type | Unmet (fires) when | On fire (downstream) |
|---|---|---|
| `sla_breach` | no successful bridge on container by `slaDeadline` | advance escalation ladder (Scenario 2/3) |
| `thread_inactivity` | `lastActivityAt` older than `inactivityTimeoutSeconds` **AND closure guards pass** | close thread |
| `calendar_grace` | calendar still has no matching entry (Scenario 1 re-check) | alert owner |
| `hold_expiry` | `CommHold.status == 'tentative'` still | release slot + human task (Scenario 4) |
| `approval_deadline` | `CommApproval.state == 'pending'` still | escalate: notify again, then notify someone else |
| `promise_due` | matching `CommTask(category=customer_promise).status == 'open'` | escalate like SLA |
| `customer_retry` | customer still not reached | retry dial (Scenario 3) |

**Closure guards (MANDATORY — §1.2).** `thread_inactivity` must NOT close if any is true:
active `slaDeadline` in future; an open `CommTask` with `category=customer_promise`; a `CommApproval`
in `pending`; a `CommHold` in `tentative`; `closurePolicy == 'indefinite'`. Implement as a pure
`canAutoClose(container, {hasOpenPromise, hasPendingApproval, hasTentativeHold}): boolean` for unit testing.

**Reopen policy (§1.2):** define `GRACE_WINDOW` per threadType. Customer reply within grace → reopen
same container (`state=open`, clear `resolution`, bump `lastActivityAt`). Beyond grace → new container
with `previousThreadId = oldCommId`.

**I-7 (build-fails guard):** add a test asserting that every non-terminal `ContainerState`
(`open`, `awaiting_reply`, `awaiting_approval`) has at least one registered timer, and a runtime
assertion in the state-transition helper (`setContainerState`) that refuses to move a container into a
non-terminal state without registering/confirming a governing timer. Terminal = `closed`.

**Wiring:** in `src/hooks.server.ts`, add a third guarded interval mirroring `__slaCronStarted`:
```ts
const timerCron = globalThis as any;
if (!timerCron.__timerSweepStarted) {
  timerCron.__timerSweepStarted = true;
  const t = setInterval(async () => {
    try { const { sweepTimers } = await import('$lib/server/timer/timer-service'); await sweepTimers(); }
    catch (e:any) { console.error('[Timer sweep] failed:', e?.message||e); }
  }, 30_000);
  t.unref?.();
}
```
Add `POST /api/a2p/timers/sweep/+server.ts` as the external-cron alternative (same pattern as
`/api/a2p/sla/check`). **Migrate `sla-monitor.ts` to register a `sla_breach` timer** instead of its
bespoke `dueAt` scan (keep the old sweep working during transition, then retire it).

### 1.3 Identity resolution — Stage 1a, before transcription
Reuse `resolveAndMergeLocalProfile(tx, {companyId, email, phone, name, sessionId})` in
`pipeline/profile-service.ts` as the base, and add a thin `identity/identity-service.ts` implementing the
spec's ANI-first ladder and the **merge-candidate (never auto-merge)** rules:

- **Step 1 ANI match** (call arrival): exact 1 → attach high confidence; exact many → attach most-recently-active + flag review; none → create thin profile (phone+timestamp) immediately. **Never block the pipeline.** Record `identityConfidence` + `identityMethod` on the `CommEntry`.
- **Step 2 number lookup (cached)** — new `src/lib/server/number-lookup.ts` wrapping Telnyx Number Lookup (skill `telnyx-verify-javascript`, `type=carrier`). Query **once per number**, store `lineType/carrier/lookupDate` on the profile, never re-query. **Must never block or gate** — wrap in a timeout (~2s) and proceed on timeout (test I-6).
- **Step 3 enrichment (post-transcription)** — extract name/email from transcript, enrich thin profile. Email-matches-existing-different-phone → **merge candidate** (surface, do NOT auto-merge — I-3). Transcript-name-matches-existing → **merge candidate only** (I-3). Nothing matches → keep new (I-2).
- **Edge cases:** withheld caller ID → `identitySource: transcript_only` flag (I-4). Shared business line → many people per number (CommIdentifier collection). Known client from new phone → ANI miss → thin profile → transcript match → merge candidate.

Merge candidates are surfaced (not applied): write a `CommMergeCandidate` row or flag on the profile
for human confirmation. Same "bias toward standalone" asymmetry as container merge.

### 1.4 Approval queue — `CommApproval` (§1.1) + service `src/lib/server/approval/approval-service.ts`
Execution never auto-posts customer-facing content (existing rule; also enforced by
`PipelineExecution.requiresHumanApproval`). Every customer-facing draft:
1. `createApproval({commId, draftType, draftContent, contextPayload, approvalDeadline})`.
2. Register an `approval_deadline` timer (mandatory — §1.4). On breach: notify owner again, then escalate to a second person.
3. **`contextPayload` is a reconciliation, not a proofread:** `{ transcriptCaptured, systemHas, contactDetail: { value, source: 'rep_entered'|'ai_extracted'|'both_agree' }, flags: [] }`. The approval UI renders these side-by-side, then the draft.
4. States: `pending → approved | rejected | expired`. On approve → send + log a customer-facing `CommEntry`. On expire (timer) → escalate.

### 1.5 Task model — `CommTask` (§1.1) + extraction in `pipeline/ai-extraction.ts`
- `owner` = a **User id** (person), never a team; `due` = a **timestamp**, never "soon". Schema enforces both non-null.
- Two categories: `customer_promise` (registers a `promise_due` timer, escalates on breach like SLA) and `internal_followup` (no customer consequence).
- **Conservative extraction:** the extraction prompt must make "no tasks" a valid, easy output and the schema must permit `[]`. Tasks below a confidence threshold go to a **review queue** (`status` stays out of a person's list; flag for triage), not directly assigned.

### 1.6 Telnyx integration patterns (apply throughout)
- **Server-side dial only.** App POSTs `{rep_id, comm_id}` or `{rep_id, to_number}` → orchestrator places call via `POST /v2/calls`. Existing `routes/api/telnyx/dial/+server.ts` is the seam; ensure it accepts `comm_id` and always sets `client_state`.
- **Dial order:** internal party first, customer second. Never dial customer before a confirmed human on the internal leg (DTMF — Scenario 2).
- **`client_state`** = base64 JSON `{ comm_id, person_id, leg, priority }` on **every** originated call and `record_start`. Without it, `call.recording.saved` cannot be threaded.
- **Recording:** `record_start channels:dual` on every bridged call; start recording **after** any whisper; play a recording disclosure to the customer at/before bridge.
- **Recording URL expiry (10 min):** fetch synchronously off the `call.recording.saved` webhook; if deferring, download+store first. Idempotency key = `recording_id` (existing `CallRecording @@unique([callId, recordingId])` already supports this). Use `command_id` on outbound commands to prevent duplicate dials on retry.
- **Transcription:** wrap behind **one config value + one function** — `src/lib/server/transcription.ts` → `transcribe(fileUrl, {lang}): Promise<{segments, text}>`. Default engine `deepgram/nova-3` via the OpenAI-compatible endpoint `https://api.telnyx.com/v2/ai/audio/transcriptions` (`response_format=verbose_json`, `model_config={smart_format,diarize,punctuate}`). French volume → swap to `openai/whisper-large-v3-turbo` via config, no code change. **Speaker labelling:** dual-channel → channel 0 = internal, channel 1 = customer; label **before** the LLM sees it.
- **SMS capability — do not gate on lookup (§1.6):** landline → skip SMS→fallback; mobile/VoIP/unknown → send + watch delivery receipt; no confirmation in ~30s → fallback; update `smsCapable` from the *delivery outcome*. Never let lookup block/delay a bridge.
- **A2P compliance:** honor `STOP/UNSTOP/HELP` at platform level **before any AI parsing** (existing `consent.ts` + `SmsConsent`, `smsAutoReplyAllowed`). Transactional reply to a voicemail ≠ marketing consent. Verify 10DLC campaign covers the use case (skill `telnyx-10dlc-javascript`).
- **Email:** Telnyx doesn't send email — existing sender is Brevo (`brevo.ts`/`company-sender.ts`). Ensure SPF/DKIM/DMARC on the sending domain; log `sent` and `delivered` as separate facts.

### 1.7 Date/time handling — `src/lib/server/datetime.ts` (new, pure, heavily unit-tested)
- Resolve relative dates against **`call.start_time`**, never processing time.
- Store **UTC**, display **America/Toronto**.
- **Weekday/date consistency check:** if transcript has weekday + date that disagree ("Tuesday August 5th" when the 5th is Wednesday) → do not book, do not guess, **flag** (test 1-2).
- **Bare weekday** ("Tuesday at 10", no date) → resolve to next occurrence, mark `date_confidence: inferred`, and put the **full explicit date** in the outbound message (the confirmation is the disambiguation — test 4-2).

### 1.8 AI analysis contract — `src/lib/server/ai/emergency.ts` + extraction schemas
- **Emergency is a deterministic floor:** `emergency = keyword_hit || ai_emergency`. Never an average, never AI overruling the keyword. Export `EMERGENCY_KEYWORDS` incl. regional realities: `burst, flooding, no heat, gas, sewage, backing up, water everywhere`. Log `emergency_source: keyword|ai|both`.
- **Confidence mandatory** on every extracted field; below threshold → human review, never silent action.
- **Null must be easy:** every extraction schema permits "nothing found" (empty array / null).
- **Processing failure defaults to emergency:** STT empty/timeout, expired URL, LLM timeout, unparseable JSON → default **emergency + route to human**. Never resolve a failure to "no action."

---

## PART 2 — PIPELINE STAGE ADDITIONS (extend existing engines, don't fork)

| Stage | File to extend | Additions |
|---|---|---|
| 1 Intake | `unified-pipeline.ts` | Call identity resolution (§1.3) first; **create container at intake** via `createContainerAtIntake` before transcription; number lookup cached; dedup suppresses **actions**, never storage (`dedupSuppressed` on entry, `actionsSuppressed` on container). |
| 2 Signals | `signal-engine.ts`, `signal-rules.ts` | Add per-scenario signals (listed below). `promise_made` fires **independently** of other extractions. |
| 3 Orchestrator | `orchestrator-engine.ts` | All gates **deterministic**; any gate failure **blocks + routes to human**. |
| 4 Action Queue | `action-queue-engine.ts` | Every work order carries `comm_id, person_id, confidence, deadline`. |
| 5 Execution | `execution-engine.ts` | Never auto-post customer-facing; every failure branch defined (Part 4). |
| 6 Outcome | `outcome-engine.ts` | **Provisional vs final** — provisional at dispatch, final only when the loop closes. Feedback scores only final. |
| 7 Feedback | `feedback-engine.ts` | Scores final outcomes only; flags tuning candidates, does not mutate rules. |
| 8 Network | `cohort2.ts` / `cohort2-sweep.ts` | Fires on **won OR lost**; timeout-without-resolution is a **loss**. Ship **extracted features only** (job type, urgency, response time, win/loss, price band) — never transcripts/summaries. (Already largely present in `Cohort2Trajectory` — verify the loss-on-timeout path is wired via the `thread_inactivity`/SLA timers.) |

---

## PART 3 — SCENARIOS (thin implementations on Part 1)

Each scenario section lists: **files to touch**, **stage logic**, **timers registered**, **signals**, **work-order shape**, and the **tests it must pass**. Build only after Part 1 is green.

### Scenario 1 — Answered support call → meeting scheduled → email confirmation
**Files:** `routes/api/telnyx/call-webhook`, `ivr/bridge`, `pipeline/ai-extraction.ts`, `google-calendar.ts`, `calendar.ts`, `appointment-flow.ts`, new `scenarios/s1-meeting-confirm.ts`.

- **Stage 1:** IVR option 3 → forward to owner cell; identity (§1.3); `record_start channels:dual`, `client_state` carries `comm_id`; recording disclosure before bridge; on `call.recording.saved` fetch immediately (10-min); transcribe (ch0=owner, ch1=customer, label first); resolve relative dates vs `call.start_time`.
- **Stage 2 signals:** `meeting_scheduled`, `email_captured`, `promise_made` (fires independently), `contact_detail_update`.
- **Stage 3 — calendar is a VERIFICATION target, not creation.** Search owner's **real working calendar** for a hold matching: start within ±30 min of proposed slot; title/attendees contain customer name/company; attendee email matches captured address. **Score** it — do not demand exact timestamp match.
  - **Race condition (critical, test 1-4c):** T+0 run check, store result, **no action**. Found → draft. Not found → register a `calendar_grace` timer (15 min, configurable), **do not alert**. At T+15 re-check: found → proceed silently; missing → **now** alert (test 1-4d).
  - **Three outcomes:** found+time matches → draft; found+time differs → **block**, show both times (test 1-4b); no entry after grace → **block**, alert with one-click create.
  - **Remaining gates (block on fail):** weekday/date consistency (test 1-2); email confidence below threshold (test 1-3, and rep-entered vs AI-extracted disagreement); calendar conflict on slot → block, don't double-book (test 1-6).
- **Stage 4 work order:** `{ comm_id, person_id, proposed_datetime_utc, display_timezone, email_address, email_source, calendar_entry_status: found|created_tentative|conflict|mismatch, conflicts[], confidence, requires_approval: true, approval_deadline }`.
- **Stage 5:** calendar entry stays **tentative** until email approved+sent; update profile with confirmed email (separate logged action); draft → `CommApproval` → notify owner; on approve → send, flip calendar to confirmed, log customer-facing `CommEntry`; on reject → return for edit or discard-with-reason.
- **Stage 6:** provisional at draft; **final only when email sent + accepted by receiving server**.
- **Email capture (highest-risk):** rep-entered value is authoritative — build the field; AI extraction is a **cross-check** (agree → high confidence; disagree → flag); validate syntax + MX before sending; process note: rep reads address back on call.
- **Tests:** 1-1, 1-2, 1-3, 1-4a/b/c/d, 1-5 (approval deadline escalates), 1-6, 1-7 (ordinary call invents nothing). **Insist on 1-4c and 1-7.**

### Scenario 2 — Emergency voicemail → auto-bridge to technician
**Files:** `emergency-routing.ts`, `telnyx-bridge.ts`, `internal-call-guard.ts`, `routes/api/telnyx/{call-webhook,ivr/gather,ivr/speak,ivr/bridge}`, `sms.ts`, new `scenarios/s2-emergency-bridge.ts`.

- **The critical rule — never bridge to an unconfirmed human.** Dial tech; on `answer`, whisper "Emergency call, <name>, <summary>, logged <n> min ago. Press 1 to connect, 2 to decline." **Only on DTMF 1 dial customer.** No keypress in ~10s → treat as no-answer → next rung. (Voicemail can't press 1 — tests 2-2, 2-3.)
- **Stage 1:** IVR opt 3 → no answer → **Telnyx-side** voicemail prompt + recording (verify timeout enforced by Telnyx, not carrier voicemail — Part 4 failure). Identity (thin profile if unknown). **Transcribe immediately** (latency-critical). Keyword check **in parallel** with AI (§1.8). Callback number: prefer ANI; if spoken differs, use ANI + flag.
- **Stage 2 signals:** `emergency_confirmed`, `callback_requested`, `callback_number_captured`, `property_access_issue`.
- **Stage 3:** on-duty tech? empty/misconfigured rota → escalate to owner immediately (don't dial a void). Build dial ladder primary→backup→on-call→**owner (last rung must answer)**. Send customer immediate SMS "We received your emergency message. A technician is calling you now." (log customer-facing; apply §1.6 SMS policy; never let lookup block the bridge).
- **Stage 4 work order:** `{ comm_id, person_id, customer_number, dial_ladder[], current_rung, max_attempts_per_rung, whisper_text, emergency_summary, sla_deadline, escalation_policy }`.
- **Stage 5 bridge:** dial tech (leg A) `client_state=comm_id`, answer timeout **15s** (beat carrier voicemail); whisper+DTMF; on confirm dial customer (leg B); bridge; `record_start` after whisper `channels:dual`; disclosure at bridge; **log bridge timestamp** (true response-time metric).
- **Stage 6 — task list (where value lands):** apply §1.5 in full; each task has description, owner (person), due, `source_entry_id`, status; `customer_promise` → `promise_due` timer.
- **Stage 7 metrics:** voicemail→bridge time (`recording.saved` → bridge ts); track which rung answered and rung-1 decline rate.
- **Timers:** `sla_breach` (governs the outer loop), `customer_retry` (Scenario 3 path), `promise_due` (per extracted promise).
- **Tests:** 2-1…2-8. **2-8** (routine non-emergency does NOT trigger bridge) determines whether techs keep answering.

### Scenario 3 — Bridge fails → duplicate voicemail → escalate to backup
**Files:** all of Scenario 2 + `scenarios/s3-escalation.ts`; container suppression gate; timer condition evaluators.

- **Correction 1 — "duplicate" ≠ "discarded".** Second voicemail is a **duplicate thread, not a duplicate event.** Must be true: no new *thread* (i.e. no confirmed standalone, no second bridge, no second SLA clock) **but** the recording IS stored, transcribed, appended. **Rule: dedup suppresses actions, never storage.** Run a delta vs the first transcript; severity increase or callback-number change is a **new signal** that must reach the tech.
- **Correction 2 — callback during open SLA is an escalation trigger.** Second call → skip remaining wait, go to backup **now**. Third call → owner's phone rings. (Repeat contact **shortens** the ladder; never resets/ignores it.)
- **Correction 3 — two timing loops (unify):**
  - **Inner loop (seconds):** primary → 15s no-answer/decline → backup → on-call → owner (~1 min total). Implement via the DTMF ladder + short answer timeouts.
  - **Outer loop (minutes):** if the whole inner ladder fails, retry at **90s, 3 min, 6 min** (`customer_retry` timers). The **10-min SLA is the hard deadline**, not the retry interval; at minute 10 with no bridge → call owner directly, stop being automated.
- **Five distinct bridge failures (never one flag):** (1) tech didn't answer → next rung; (2) answered no DTMF (voicemail) → next rung, log voicemail-suspected; (3) tech confirmed, **customer** didn't answer → **retry customer**, notify tech (reachability, not staffing — likely this scenario); (4) both answered, bridge cmd failed → retry immediately, alert if repeated; (5) bridged, dropped <30s → **not a resolution**, clock continues. Model as an enum on the attempt log.
- **Stage 1:** ANI → existing profile; **new container + ref created as normal** (the 2nd VM is a distinct communication). **Suppression gate fires** (same person + open **emergency** container inside 2h → `actionsSuppressed=true`); no 2nd bridge, no 2nd SLA clock; signal routes into existing container's escalation. Store + transcribe + delta. **At review, merge** folds this container into the original; its ref becomes an alias.
- **Stage 2 signals:** `repeat_contact_during_open_sla`, `severity_change`, `callback_number_changed`, `customer_self_mitigation`.
- **Stage 3:** no new thread, no new clock; advance ladder one rung; notify already-dialed tech; if callback number changed, use new + flag.
- **Stage 5:** retry from **backup** rung (not primary); same whisper+DTMF with updated delta text; recording dual-channel, same `comm_id`.
- **Stage 6:** one resolution regardless of attempt count; **log every attempt** (rung, ts, failure type); response time from the **FIRST** voicemail (retries must not flatter the metric).
- **Tests:** 3-1, 3-1b, 3-2, 3-3, 3-4, 3-5, 3-6, 3-7 (2nd VM after close → new thread), **3-8** (same number, non-emergency subject during open emergency → classified sales/support → suppression does NOT fire → stands alone; the `threadType` gate makes this pass).

### Scenario 4 — Sales voicemail → SMS confirmation loop → tentative hold
**Files:** `message-intent.ts`, `reply-sanity.ts`, `sms.ts`, `routes/api/sms/*`, `CommHold`, `appointment-flow.ts`, new `scenarios/s4-sms-booking.ts`.

- **Correction 1 — "Tuesday at 10:00" is not a date.** Apply §1.7: resolve to next occurrence, `date_confidence: inferred`, put full explicit date in SMS ("Tuesday, August 4th at 10:00 am") — the confirmation disambiguates (test 4-2).
- **Correction 2 — holds expire.** Every `CommHold` has `holdExpiresAt`; register a `hold_expiry` timer (default 2h next-day, longer further out). On expiry: release slot + human follow-up task. Closure guard: a container with a tentative hold never auto-closes (test 4-8 is this vs. approval deadline — two timers racing).
- **Correction 3 — replies are not yes/no.** Parse into intent enum (reuse `message-intent.ts`): `confirm` (yes/y/confirmed/👍 → book), `counter_propose` ("can we do 11" / "does Wednesday work" → **human**, hold NOT released/rebooked — test 4-4), `decline` (no/cancel → release hold, close), `question` ("how much is the Civic" → **human**, not a confirmation — test 4-7), `opt_out` (STOP → platform-level before AI, release hold, notify human — test 4-6), `unparseable` → human. **Never let AI negotiate a reschedule.** If no reply: **do not** auto-send a second SMS — one nudge before hold expiry at most, then a human calls.
- **Correction 4 — sales messaging, not transactional.** Apply §1.6 A2P in full; verify 10DLC campaign covers sales.
- **Stage 1:** VM recorded/transcribed; identity on ANI; number lookup cached (mobile confirmed); **no email → SMS is the only channel** — flag it (constrains fallbacks).
- **Stage 2 signals:** `appointment_requested`, `vehicle_interest`, `test_drive_requested` (has prerequisites: valid licence, insurance, vehicle on lot — belong in the confirmation), `date_ambiguous`, `no_email_on_file`.
- **Stage 3 gates:** resolve weekday→date (flag inferred); **availability check on the real resource** (salesperson AND vehicle — don't double-book a vehicle); slot open → tentative hold w/ expiry; slot taken → **do NOT send confirmation**, create human task to call with alternatives (named owner + due — test 4-3); draft SMS → approval queue.
- **Stage 4 work order:** `{ comm_id, person_id, proposed_datetime_utc, date_confidence, resource_ids[], hold_id, hold_expires_at, sms_draft, requires_approval: true, approval_deadline, awaiting_reply_until }`.
- **Stage 5:** hold tentative; SMS draft → approval → notify (approval deadline applies); on approve → send + log customer-facing entry; register **pending-reply watcher** keyed `comm_id + customer number`; inbound SMS webhook → match → parse intent → act; on confirm → hold `booked`, calendar confirmed; on expiry no reply → release + human task. **Reply matching:** on customer number + **most recent pending** confirmation; **two pending for one number → do not guess, route to human** (test 4-9).
- **Stage 6:** provisional at SMS sent; final on confirm/decline/expiry. **Three terminal states: booked, declined, no_response.** `no_response` is a **lost lead → Section 8 loss**, must not vanish as an admin timeout.
- **Timers:** `hold_expiry`, `approval_deadline`, pending-reply watcher (`customer_retry`/`awaiting_reply_until`).
- **Tests:** 4-1…4-10. **4-8** = hold_expiry vs approval_deadline racing (must not approve a confirmation for a released slot); **4-10** landline → phone-call task, not silent failure.

---

## PART 4 — CROSS-CUTTING FAILURE HANDLING (read before any scenario code)

**Generating rule — derive, don't enumerate.** Every step fails three ways: (1) didn't happen
(call failed, SMS undelivered, API 500); (2) too slow (no response in window); (3) happened **wrongly**
(voicemail answered instead of human, transcript garbled, low-confidence). **Category 3 is the dangerous
one — it looks like success.**

**Two hard rules:**
1. **Fail toward the human, never toward silence.** Every unhandled branch/timeout/low-confidence result terminates at a person's phone ringing.
2. **Every escalation ladder ends at an owner, not a queue** — a last rung that will definitely answer.

**Implementation:** build the **case state machine** as the backbone. States: `new, analyzed, notified,
contact_attempted, contact_made, dispatched, awaiting_reply, awaiting_approval, closed, escalated, failed`
(map onto `CommContainer.state` + a per-scenario sub-state in `analysisJson`). Every **non-terminal
state has a timeout timer with a defined escalation** — this is exactly what §1.2 + I-7 enforce. Every
non-terminal state without a timer is a bug (the I-7 test).

**Failure catalogue to cover** (each → escalate+notify, never silent):
- *Inbound call:* hangs up pre-message → still an event (callback rule); no callback number → check ANI-withheld before assuming reachable; 2s of noise → empty transcript must NOT resolve to "not emergency"; carrier voicemail intercepts forward → message lands where orchestrator never sees it (verify Telnyx-side timeout).
- *Transcription/analysis:* STT empty/timeout/expired URL, LLM failure/timeout/unparseable JSON, low confidence → **all default to emergency + human**.
- *SMS to internal party:* delivery failure → escalate immediately (don't wait out SLA); delivered-never-read → that's what the SLA is for; phone off → same as unread; no rep on duty → verify before relying.
- *Outbound/bridge:* customer no-answer → not a resolution (retry schedule); busy/voicemail → an attempt not contact; wrong number transcribed → `contact_made: false`; drop <30s → below floor; rep calls from personal phone → no recording exists (reconciliation path).
- *Recording/threading:* `record_start` failed silently; transcript returns but can't be threaded.
- *Business continuity:* orchestrator down = single point of failure at the worst moment → **break-glass**: app surfaces raw number with "call directly", queues a note to log once service returns; define reconciliation for out-of-system calls.
- *Privacy:* Canada single-party consent covers interception; PIPEDA expects customer informed → automated disclosure line before bridge. Reps use the dialer for non-job calls too — decide a "don't log this" path and be upfront. (Flag to whoever handles compliance; not legal advice.)

**Validation method (do this, don't imagine contingencies):** write the happy path, instrument every
state transition with a timeout + failure branch defaulting to "escalate+notify", then run **failure
injection** — kill the AI response, expire the URL, mark the SMS undelivered, have the tech ignore the
alert. The gaps found that way are the real ones.

---

## PART 5 — ACCEPTANCE TESTS (the deliverable) → test-file mapping

A scenario is not done until its tests pass. Colocate Vitest files; mock prisma per `orchestrator.test.ts`.

| Group | Test file | Covers |
|---|---|---|
| Infrastructure | `src/lib/server/container/container-service.test.ts` | I-1…I-5 (identity), I-8…I-13 (container/ref/merge/suppression) |
| Timer | `src/lib/server/timer/timer-service.test.ts` | I-7 (non-terminal state ⇒ timer, or build fails), closure guards, sweep idempotency |
| Number lookup | `src/lib/server/number-lookup.test.ts` | I-6 (timeout ⇒ proceed) |
| Datetime | `src/lib/server/datetime.test.ts` | 1-2, 4-2 (weekday/date, bare weekday) |
| Scenario 1 | `src/lib/server/scenarios/s1-meeting-confirm.test.ts` | 1-1…1-7 (insist 1-4c, 1-7) |
| Scenario 2 | `src/lib/server/scenarios/s2-emergency-bridge.test.ts` | 2-1…2-8 (insist 2-8) |
| Scenario 3 | `src/lib/server/scenarios/s3-escalation.test.ts` | 3-1…3-8 (insist 3-8) |
| Scenario 4 | `src/lib/server/scenarios/s4-sms-booking.test.ts` | 4-1…4-10 (insist 4-8) |

**Highest-value / most-skipped tests — do not skip:** I-7, I-11, 1-4c, 1-7, 2-8, 3-8, 4-8.
Full test descriptions and expected outcomes are the tables in the source spec Part 5; each row above
maps 1:1 to those.

---

## PART 6 — BUILD ORDER (dependency-ordered; do NOT build scenarios first)

### Phase 1 — Platform (blocks everything)
1. **Schema + migration:** add all §1.1 models/enums + back-relations + `comm_ref_seq`. Run `db:generate`, write `prisma/migrations/<ts>_a2p_container_timer/migration.sql`. `prisma validate` clean.
2. **Timer service** (§1.2): `timer-service.ts` + condition evaluators + closure guards + `hooks.server.ts` interval + `POST /api/a2p/timers/sweep`. Tests: I-7, closure guards, idempotency.
3. **Container model** (§1.1) **in full:** `container-service.ts` — intake assignment, ref alloc, **suppression gate**, review-time merge, **ref aliasing**, split, reassignment audit, `createEntry/Task/Hold/Approval/Timer` orphan-guard wrappers. Tests: I-8…I-13, I-11 orphan guard.
4. **Identity resolution + cached number lookup** (§1.3): `identity-service.ts` + `number-lookup.ts`. Tests: I-1…I-6.
5. **Telnyx patterns** (§1.6): ensure `dial` route takes `comm_id` + sets `client_state`; `transcription.ts` engine-abstraction wrapper; recording fetch-off-webhook + idempotency; `datetime.ts` (§1.7); `ai/emergency.ts` deterministic floor (§1.8).
6. **Approval queue** (§1.4) + **Task model** (§1.5) services.

### Phase 2 — Scenarios (each fully tested before the next)
7. **Scenario 2** first (emergency bridge) — it exercises the most infra (ladder, DTMF, timers, tasks). Then **Scenario 3** (escalation + suppression + merge) reuses S2. Then **Scenario 1** (calendar verification + approval). Then **Scenario 4** (SMS loop + holds).
   Rationale: S3 depends on S2; S1 and S4 are independent but share approval/calendar/datetime infra.

### Phase 3 — Cross-cutting
8. **Case state machine** (Part 4) formalized over `CommContainer.state`; failure-injection test suite; business-continuity break-glass path; Section 8 loss-on-timeout wiring verified.

### Environment / config to confirm before Phase 1
`DATABASE_URL` (migrations), `TELNYX_API_KEY` + connection/app ids, Telnyx Number Lookup access, transcription
endpoint key (Telnyx AI), Brevo email creds + domain SPF/DKIM/DMARC, Firebase creds (push), 10DLC campaign ids
(sales vs customer-care), `officeTimezone`/`officeHours` per company (`PipelineBusinessConfig`).

### Open assumptions (flag if wrong)
- `comm_id` = cuid (opaque internal), not literal UUID — matches repo convention.
- Spec `Person` maps onto extended `PipelineCustomerProfile` + new `CommIdentifier`, not a new `Person` table.
- New `CommTask`/`CommHold`/`CommApproval` are the spec's action records; the existing `Task`/`SlotHold`/
  `PipelineApprovalPackage` stay for their current UI/pipeline uses (bridge later if consolidation is wanted).
- Grace/inactivity/join constants use the spec's stated values; store on the container so they're overridable.
```
