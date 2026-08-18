# 2026-08-18 Leadbox "Text Us" — business-hours routing and the rep task

## Goal

Robert clicks SEND in the leadbox **Text Us** sub-form. The message reaches `/api/messages`.
What should happen next, in the requester's words:

> the first thing we need to know is the time, if the text message is sent during business hours
> it will be routed to the person identified in the admin who is responsible for incoming text
> messages … if the text is after hours a auto mated response will be sent telling Robert Betts that
> the office is closed and his text will be returned in the morning. A message is sent to Joe Sales
> in his tasks things to do list.

Follow-up clarifications: "route to the person responsible for incoming texts" → "maybe it means
rep"; "message into Joe Sales' task list"; "same task for a customer in /tasks"; "fix so this works".

## What already existed

The "Request a Call" sibling of this was already built (`callback-dispatch.ts` +
`callback-routing.ts`, history 2026-08-17). Nearly everything this feature needs was already there:

| Requirement | Already built |
| --- | --- |
| Business hours set by admin | `settings.autoReply.businessHours`, Settings → Auto-replies |
| A schedule per representative | `/representatives` `profileData.schedule`, `buildRepRota` |
| The rep (on-duty) | `loadReps` (CompanyMember role member, active) + `isRepOnDuty` |
| Business-vs-server timezone | `isOpenAt` / `nextOpening` in `callback-routing.ts` |
| The auto-reply SMS | `sendAutomatedSms`, gated on `smsAutoReplyAllowed` + consent (`sendAfterHoursAck`) |
| The admin's office-closed wording | `settings.autoReply.afterHoursMessage` (default "…get in touch with you by {date}.") |

The gap was: nothing wired a plain **text** (as opposed to a callback) to the clock + rep. The
existing auto-reply util `getAutoReplyMessage` was dead code — grep showed it is only called from its
own test. So after-hours texts had no reply at all, and no text ever produced a rep task.

## Changed

- **`src/lib/server/text-message-routing.ts` (new)** — pure decision, mirrors the callback split.
  `decideTextMessage({ now, businessHours, timeZone })` → `route_to_rep` (open) or `after_hours`
  with the next opening. `officeClosedReply({ template, openAt, timeZone })` substitutes the
  `{date}` placeholder in the admin's after-hours message, rendered in the business zone.
- **`src/lib/server/text-message-dispatch.ts` (new)** — carries the decision out. Loads reps, builds
  the rota at "now" (open) or the next opening (shut), falls back to the first rep so a task still
  lands on a named person (Joe Sales) rather than nobody. During hours: assigns the Message to the
  rep (`assignedToId`) and writes a task. After hours: sends the office-closed SMS and writes a task
  due at the next opening.
- **`callback-dispatch.ts`** — only change is exporting `timeZoneFor` and `businessHoursFor` so the
  text dispatch reuses them instead of writing a third copy (CLAUDE.md: grep every writer first).
- **`api/messages/+server.ts`** — one `else` branch: when `dispatchCallbackRequest` declines a
  message (not a callback), call `dispatchTextMessageRequest`. Same background-block placement as the
  callback dispatch, never awaited by the SEND response.
- **`src/lib/server/text-message-routing.test.ts` (new)** — 9 tests.

## The task shape

The rep task is now `prisma.task.create` with `contactId`, `assignedToId` and
`communicationThreadId`, not the bare `{ companyId, title }` the callback's `recordRepInstruction`
still writes. That is the "same task for a customer in /tasks" point: with `contactId` set the task
shows `origin: 'CR'`, links to the customer profile, and lands on the rep's list via `assignedToId`.

## Decisions worth knowing

- **Guards**: `dispatchTextMessageRequest` declines a callback (owned by the callback flow), an empty
  message, and the `Channel clicked: …` tracking message `handleChannelClick` posts — the last would
  otherwise mint a spurious rep task for every widget click.
- **Gating the office-closed SMS** matches `sendAfterHoursAck`: `pipelineBusinessConfig.smsAutoReplyAllowed`
  plus transactional consent. It deliberately does NOT key off `settings.autoReply.textAutoReply` —
  that flag gates the (currently unwired) `getAutoReplyMessage` path, and the callback ack already
  set the convention that after-hours replies are gated on the business-config fail-safe instead.
- **Fallbacks**: no on-duty rep → `assignedToId: null`, task still created (visible, unassigned). No
  customer phone → no SMS, task still created. No next opening (all-closed week) → SMS degrades to
  "the next business day" and the task dueDate is `now`.

## Root causes

There was no single bug — the feature simply didn't exist for text. The reason it read as a bug is
that Request-a-Call (SEND on the other sub-form) worked end to end while Text Us silently only filed
a Message + comm log and never touched a rep or the customer's phone.

## Rejected

- **Adding the routing into `callback-routing.ts`.** It already carries the shared primitives
  (`isOpenAt`, `nextOpening`, `buildRepRota`); a text decision is one line on top of them, so a
  separate pure module keeps the call path and the text path distinguishable rather than overloading
  `decideCallback`.
- **Keying the office-closed reply off `getAutoReplyMessage`.** That function reads `new Date()`
  internally (the server-local timezone defect flagged in the 2026-08-17 entry) and is the dead-code
  path. Reading `settings.autoReply.afterHoursMessage` directly and substituting `{date}` with a
  business-zone `nextOpening` keeps the reply correct per-zone.
- **Writing a routing comm-log row** (the callback's `recordRepInstruction` does). The inbound
  leadbox log already exists; a second "text-router" row is diagnosability sugar, not a requirement,
  and I chose to keep the diff small. Revisit if the /tasks "comm id" for these tasks ever needs a
  link the `communicationThreadId` doesn't provide.

## Not verified

- **Nothing exercised against a real database, Telnyx, or a browser.** All runtime claims are read
  off the code. The dispatch half (`text-message-dispatch.ts`) has no unit test — it does I/O
  (`prisma`, `sendAutomatedSms`, `consent`), and the existing dispatch modules are tested via their
  pure counterparts, not directly.
- **No real office-closed SMS has been sent.** It is gated on `pipelineBusinessConfig.smsAutoReplyAllowed`,
  which the 2026-08-17 entry already flagged as unconfirmed for the target companies, and on
  transactional consent.
- **No task has been written through the new path.** `prisma.task.create` with `contactId`,
  `assignedToId` and `communicationThreadId` is type-checked only.
- **The rep assignment (`Message.assignedToId`) has not been exercised** — whether the SMS inbox
  actually surfaces a thread assigned to the rep is untested.
- **The legacy `textOnly` leadbox** (`handleFormSubmit`) also flows into this path and would be
  routed; only the `Channel clicked:` tracking and callbacks are excluded. Not verified in a browser.
- **svelte-check and the failing-test set are unchanged from the session baseline**: 320 errors /
  142 warnings, and 28 failing tests / 579 passing (579 includes my 9 new passing tests). I did not
  record a pre-change number before editing, so "unchanged" here is against the known repo baseline,
  not a byte-for-byte diff I produced.
- **The /tasks "Channel" column still renders a text task as "out" with an email icon** — that column
  only distinguishes call vs non-call and was left alone. A text message is not "outbound email", so
  this is cosmetic and pre-existing, but it will look wrong.
