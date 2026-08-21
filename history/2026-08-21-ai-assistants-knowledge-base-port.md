# 2026-08-21 Porting AI assistants + knowledge base + AI chat from the viewroom app

## Goal

> "so we moved /Users/n3rd/code/viewroom here, but we didnt move the knowledge base functionality
> and the ai chat, check, we need those"

Confirmed: the in-call chat (`ChatPanel`, `Chat.svelte`, `chatMessages` store, `mobile-chat-sheet`)
did come across in the earlier migration. **AI assistants, their knowledge base, and the AI chat
endpoint did not** — nothing under `ai-assistants`, `ai/chat` or `knowledge` existed in a2p.

## What made the port cheap, and what didn't

Already present in a2p, so not rebuilt: `ContentLibraryItem` (mapped to the same `content_library`
table the viewroom's knowledge base reads), the `openai` and `mammoth` packages, two Bunny upload
helpers, and `locals.user` auth. Both repos are Svelte 5 + shadcn.

The three things that made this a port rather than a copy:

- **Drizzle → Prisma.** The viewroom read assistants from PocketBase and content library from
  Drizzle; a2p has one Prisma database.
- **PocketBase `locals.pb` → `locals.user` + `resolveCompanyId`.**
- **Multi-tenancy.** The viewroom's `ai_assistants` table had no tenant column because that
  deployment's auth implied one. a2p is multi-tenant, so `companyId` is required and every query is
  scoped by it.

## Changed

**Schema** — new `AiAssistant` model and `prisma/migrations/20260821000000_add_ai_assistants/`.
`trainingFiles` holds `ContentLibraryItem` ids: the knowledge base reuses the existing content
library rather than introducing a second file store. **The migration is written but NOT applied** —
the a2p database is the shared Aiven instance production also uses, and applying it is the user's
call.

**New** — `src/lib/server/ai-assistants.ts` (upload + scoped lookups shared by the routes),
`/api/ai-assistants` (GET/POST), `/api/ai-assistants/[id]` (GET/PUT/DELETE),
`/api/ai-assistants/[id]/upload-training-file`, `/api/ai-assistants/[id]/remove-file`,
`/api/ai/chat`, and the two `(app)/ai-assistants` pages with their loaders.

## Deliberate departures from the original

These are not tidying; each fixes something that would have been a bug in a2p.

- **`/api/ai/chat` answers with Claude via `$lib/server/anthropic`, not OpenAI `gpt-3.5-turbo`.**
  a2p's entire AI layer is Claude (`claudeText`, `ANTHROPIC_AI_KEY`). Porting the OpenAI call
  verbatim would have added a second provider and a second key for one endpoint.
- **The chat's assistant lookup is scoped to the room's owning company.** The original matched any
  assistant whose `viewroomConnections` contained the room name. In a shared multi-tenant database
  that lets one tenant's room be answered out of another tenant's knowledge base. The route stays
  unauthenticated by design — viewroom visitors are anonymous — so this scoping is the only thing
  standing between tenants.
- **Knowledge-base context is capped** (60k chars total, 20k per file). The original pasted every
  training file into every request unbounded, and logged the entire assembled prompt.
- **`PUT /api/ai-assistants/[id]` uses an explicit allowlist.** The original spread every submitted
  form key straight onto the record, which would let a caller write arbitrary columns — including
  the tenant.
- **File detach prefers `fileId` over `fileIndex`.** Index-based removal is racy: two tabs removing
  different files both send positions computed against a list that has since shifted, and the wrong
  file is dropped. Index is still accepted for the ported UI.
- **Detaching a file does not delete the content-library row or the CDN object.** The file may be
  attached to another assistant.
- **The detail page's form actions call the shared helpers** instead of being a third copy of the
  upload logic. The viewroom's copy pushed raw `File` objects into the training-files column, which
  could never round-trip.
- **`Sidenav` dropped** — a2p's `(app)` layout already renders the sidebar.

## Verified

- `prisma validate` passes; the client regenerates with the new model.
- `svelte-check`: **940 errors / 225 warnings** against a 938 / 223 baseline — see below.
- The five API routes and both loaders typecheck clean; no errors are attributable to them.

## NOT verified

- **Nothing was run.** The migration is unapplied, so no assistant has ever been created, no file
  uploaded, and the chat endpoint has never answered a question. Every claim here is from reading
  and typechecking, not from executing.
- **2 svelte-check errors remain in the ported pages**, both `<Select.Root>`: a2p is on
  `bits-ui@1.0.0-next.71`, the viewroom on `^0.21.16`, and the Select API changed between them.
  a2p's own `room/[roomId]/info/+page.svelte` has the same pattern in its baseline. The selects will
  need a v0→v1 migration before the connection pickers work.
- **The vitest run came back 27 failed / 749 passed / 4 skipped against a 28 / 752 / 0 baseline.**
  The two deltas are `debug.test.ts` (assertion-free, only fails when it cannot reach the database)
  and the integration simulation failing at *suite* level with 4 skipped — the signature of a
  failing `beforeAll`. Both are DB-backed, and the shared Aiven instance ran out of connection slots
  repeatedly throughout this session. The port is additive and neither test imports any of it, but
  **I could not confirm on a clean tree because the database stayed unavailable**, so this is
  inference, not proof.
- **`pdfjs-dist` is imported dynamically and was never exercised.** The viewroom called
  `pdfjsLib.default.getDocument(buffer)`; that shape differs between pdfjs builds, so the port reads
  `getDocument` from either the namespace or `.default` and passes `{ data: Uint8Array }`. Untested.
- The list page's create form posts `system_prompt`, which the API accepts, but no UI field for it
  was verified to exist.

## Open

- The migration needs applying to the shared database before any of this runs.
- `BUNNY_STORAGE_ZONE_NAME` / `BUNNY_ACCESS_KEY` / `BUNNY_REGION` must be set in a2p's environment;
  `storeTrainingFile` logs and returns null without them rather than failing the request, so a
  misconfiguration shows up as "the file silently didn't attach".
