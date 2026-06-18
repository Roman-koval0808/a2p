# AI Integration (Groq) – Implementation Summary

## Done

1. **Schema**

   - `MessageUrgency` enum: `green` (1–2), `blue` (3), `red` (4–5). Removed duplicate/yellow.
   - `Message` already has: `urgency`, `urgencyScore`, `sentiment`, `intent`, `draftResponse`, `aiSummary`.

2. **Groq AI service** (`src/lib/ai/groq.ts`)

   - `classifyMessage(content)` → urgency 1–5, sentiment (sales/support), intent (inquiry, booking, complaint, follow-up, etc.).
   - `summarizeMessage(content, threadContext?)` → short human-readable summary.
   - `draftResponse(latestMessage, threadContext, channel)` → draft reply (email/sms/chatbot); human-in-the-loop only.
   - `analyzeIncomingMessage(content, threadMessages?)` → runs classification + summarization for ingest.

3. **Backend**

   - **POST /api/messages** (leadbox/leadform): after create/update, runs `analyzeIncomingMessage` and persists urgency, urgencyScore, sentiment, intent, aiSummary.
   - **POST /api/messages/draft** (auth): body `{ id, channel? }` → generates draft, saves to `message.draftResponse`, returns `{ draft }`.
   - **PATCH /api/messages**: accepts `draft_response` to persist agent-edited draft.

4. **Frontend**

   - Inbox: urgency badge supports `blue` (Medium) in addition to green/red.
   - `src/lib/types/message.ts`: added `urgencyScore`, `sentiment`, `intent`, `aiSummary`, `draftResponse`; urgency type includes `blue`.

5. **Env**

   - `GROQ_API_KEY` in `.env.example` and `src/lib/types/env.d.ts`.

6. **Migration**
   - `prisma/migrations/20250128100000_fix_message_urgency_enum/migration.sql`: maps existing `yellow` → `blue`, then enum trimmed to green/blue/red.

## You need to

1. Set **GROQ_API_KEY** in `.env` (from Groq console).
2. Install deps and regenerate Prisma (if not already):
   - `pnpm install`
   - `pnpm exec prisma generate`
3. Run migration (if using migrations):
   - `pnpm exec prisma migrate dev`
   - Or `pnpm exec prisma db push` for dev-only.

## Optional next steps

- **UI**: In thread detail, show `aiSummary`, `sentiment`, `intent`; add “Get draft” button that calls `POST /api/messages/draft` and shows draft for confirm/edit/send.
- **Assignment / escalation**: Add `needsAssignment` or `escalationSuggested` from AI (e.g. in `metadata` or new columns) and surface in UI; humans still assign.
- **Background job**: Move AI analysis to a queue so POST returns immediately and analysis runs async (better latency for webhook callers).
