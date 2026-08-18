# 2026-08-18 Leadbox Text Us runs the SMS orchestrator pipeline

## Goal

"For the leadbox text us button, use the same exact pipeline as sms, so things like emergency will
run." A leadbox Text Us message was processed by `UnifiedPipeline` (the CDP pipeline) plus the
clock-based `dispatchTextMessageRequest`, but never hit `process_orchestrator` — the shared pipeline
the SMS webhook, the email sync and the call webhook all call — so an emergency ("water leaking in
the basement") was never classified or dispatched.

## Root cause

Two things kept the orchestrator off the leadbox path:

1. Nothing called `process_orchestrator` for leadbox messages.
2. `api/messages/+server.ts` stamped `metadata.orchestrator_processed = true` on the comm log inside
   its UnifiedPipeline block. The orchestrator reads that flag first (`orchestrator.ts:128`) and
   aborts when set — so even if it had been called, it would have skipped. The orchestrator sets the
   flag itself when it finishes (`orchestrator.ts:480`); the caller must not pre-set it.

## Changed

- **`src/routes/api/messages/+server.ts`** —
  - Removed the premature `orchestrator_processed: true` from the comm-log update.
  - After `dispatchTextMessageRequest` handles a Text Us message, it now runs the SMS tail-end
    pipeline: `analyzeCallLog` (stamps `intent`/`sub_intent`/`datetime`/`ai_extracted_email`/
    `urgency`/`sentiment` on the comm log) then `process_orchestrator(inboundLog.id, 'sms_ai_ready')`
    — the same trigger string the SMS webhook uses.

## What was deliberately NOT replicated

The SMS webhook also runs `PipelineSimulator.run` (CDP signal ingestion), the Scenario-4 booking
confirmation loop, and `draftConversationalReply` before the orchestrator. Those were left on the
leadbox's existing `UnifiedPipeline` + `dispatchTextMessageRequest` path rather than copied, because:

- emergency classification + dispatch lives in `process_orchestrator` (`looksLikeActiveEmergency`
  backstop at orchestrator.ts:228, emergency draft + owner alert), so that single call is what makes
  "emergency will run";
- copying the webhook's ~680-line background block would be exactly the duplication CLAUDE.md warns
  about, and risks diverging from the SMS path the change is meant to match.

If the leadbox text also needs the full CDP signal layer (`PipelineSimulator`) or the booking
confirmation loop, extract those from the webhook rather than re-implementing them here.

## Not verified

- No browser/Telnyx run. The orchestrator call is wired and type-checked (messages/+server.ts shows
  only its 3 pre-existing errors: 129, 136, 713), but an emergency leadbox text has not been observed
  dispatching end-to-end.
- The orchestrator's comm-log `type` is `'leadbox'` (not `'sms'`); `process_orchestrator` does not
  gate on type (the email/call callers use other triggers), but this is read off the code, not run.
