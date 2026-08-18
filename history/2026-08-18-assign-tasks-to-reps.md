# 2026-08-18 Assign tasks to representatives

## Goal

"Allow assigning tasks to reps" — on the /tasks list, pick which representative a task is assigned
to.

## What already existed

The backend could already do it: `PUT /api/tasks/[id]` accepts `assignedTo` (a User id) and writes
`Task.assignedToId`, and `GET /api/representatives` returns members with `id = userId`. Only the UI
was missing — the /tasks table had no assignee column and no control.

## Changed

- **`(app)/tasks/+page.server.ts`** — the mapped task now carries `assignedToId` / `assignedToName`
  (from the already-included `assignedTo` relation), and the load returns a `reps` list (active
  `CompanyMember` role `member`, oldest-first to match the routing rota) as `{ id: userId, name }`.
- **`(app)/tasks/+page.svelte`** — new "Assigned to" column. For real tasks (`_kind === 'task'`) it
  renders a `<select>` of reps ("Unassigned" + the rep list); changing it PUTs `/api/tasks/[id]` with
  `assignedTo` then `invalidateAll()`. Scheduled-intent rows show "—" (they aren't `Task` rows, so
  they can't be assigned through this endpoint). Expanded-row `colspan` bumped 9→10.

## Decisions worth knowing

- **Reused the existing `PUT /api/tasks/[id]` `assignedTo` field** rather than adding a new endpoint
  or a form action — the wire was already there, only the column was missing.
- **Reps only (role `member`), not every member.** Matches how `loadReps`/the routing rota define
  "a rep", so the assignment dropdown is the same people who'd be rung for a callback.
- **Scheduled intents are excluded.** They are a different record type (`ScheduledIntent`) and the
  `/api/tasks/[id]` endpoint operates on `Task`, so rendering an assign control there would 404.

## Not verified

- No browser run. The dropdown + PUT round-trip is type-checked only; the `PUT` endpoint itself was
  already exercised elsewhere but not through this new UI.
- The `on:click`/`on:change` handlers on the native `<select>` type-check cleanly; the "never" errors
  svelte-check reports in this file are all on the pre-existing `DropdownMenu.Trigger`/`Item` props.
