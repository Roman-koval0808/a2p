# Descriptive Communication Log Intent (2026-08-26)

## Goal

In communication logs, the Intent column was rendering single-word tags (e.g., `Quote`, `Sales`, `Support`, `General`) rather than descriptive, context-rich intent descriptions representing what the customer actually wants.

## Root Causes

1. **Bare tag fallbacks in loaders**:
   In `communication-log/+page.svelte` and `profiles/[id]/+page.server.ts`, the `purpose` variable computation extracted a single word `meta.intent` / `meta.sentiment` / `meta.category_gpt` (e.g. `'Quote'` or `'Sales'`) and collapsed it to one word.
2. **Missing `sub_intent` / service extraction**:
   Rich extraction fields like `meta.sub_intent` (`"Quote Request"`, `"Vehicle Purchase / Test Drive"`, `"General Inquiry"`), `meta.service_requested` (`"plumbing pipe renovation"`), and `ai_intent.reason` were ignored when building the intent display line.
3. **Subtopic classifier prompt**:
   `DEFAULT_TAXONOMY` included `quote` alongside specific trades. When a customer requested a quote for a specific trade (e.g., plumbing renovation quote), Claude sometimes selected `quote` rather than `plumbing` or `renovation`, losing the service trade details.

## Changed

- **`src/lib/utils/subtopic-labels.ts`**:
  - Added `formatDescriptiveIntent(comm)` to resolve full, human-readable intent descriptions:
    - Quote requests: Extracts the specific service/subject being quoted (e.g. `"Quote: Plumbing pipe renovation"`, `"Quote: Bathroom renovation"`, `"Quote: Central AC installation"`), never bare `"Quote"`.
    - Detailed `sub_intent`: Retains rich sub-intents (e.g. `"Vehicle Purchase / Test Drive"`, `"Billing Inquiry"`).
    - Emergency: Qualifies emergencies with the emergency type or trade (e.g. `"Emergency: Roof leak"`, `"Emergency: Blocked drain"`).
    - Booking / appointment: Labels as `"Booking: [Service]"` or `"Appointment Booking"`.
    - Inquiries: Distinguishes inquiries (e.g. `"Inquiry: Business Hours"`).
    - Dropped / missed calls: `"Dropped Call (12s)"`, `"Missed Call"`.
  - Added `extractQuoteSubject` to parse quote subjects from customer messages, summaries, and AI reason explanations.
  - Added `extractConciseIntent` to turn detailed reason strings into concise intent headers.
- **`src/lib/server/communication-surface.ts`**:
  - Added `intentDescription` to `CommunicationSurface` and mapped it in `communicationSurface(log)`.
  - Updated `applyEngagementFallbacks` to carry `intentDescription` from inbound records to outbound replies within the same engagement.
- **`src/lib/components/CommunicationTable.svelte`**:
  - Updated `intentLine(comm)` to utilize `comm.intentDescription || formatDescriptiveIntent(comm)`.
  - Updated `purposeIsRedundant()` to prevent repeating redundant single-word tags beneath the descriptive line.
- **`src/lib/components/session-summary-drawer.svelte`**:
  - Added full `Intent` row and AI `Reason` explanation under the Intent section in the drawer.
- **`src/routes/(app)/communication-log/+page.svelte` & `src/routes/(app)/profiles/[id]/+page.server.ts`**:
  - Updated `purpose` calculation to prioritize descriptive `sub_intent` over 1-word tag fallbacks.
- **`src/lib/server/telemetry/subtopic-classifier.ts`**:
  - Clarified in Claude's subtopic classification prompt that `"quote"` is an intent and to prefer the specific trade service being quoted when one is named.
- **`src/lib/utils/subtopic-labels.test.ts` (new)**:
  - Added unit test suite covering quote extraction, sub-intent formatting, booking, inquiries, emergencies, and ensuring single-word tags are not returned.

## Verified

- `pnpm vitest run src/lib/utils/subtopic-labels.test.ts src/lib/server/communication-surface.test.ts`: 53 tests passed (13 in `subtopic-labels.test.ts`, 40 in `communication-surface.test.ts`).
- `pnpm svelte-check --tsconfig ./tsconfig.json`: 938 errors / 224 warnings (matched baseline, 0 new errors or warnings).

## Not verified

- Live inbound Telnyx SMS in production with webhook delivery (tested via unit tests and database record fixtures).
