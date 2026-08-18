# 2026-08-18 Custom TimePicker component (first used in the rep schedule)

## Goal

"Create a custom time picker that we will use in this app, first use it in the rep page, with guards
against invalid times, good ux."

The rep schedule (add + edit) previously used two native `<input type="time">` fields per day, with
no validation at all — a user could save an end time before the start time, and the native control
varies by browser.

## Changed

- **`src/lib/utils/time.ts` (new)** — the single source of truth for the `HH:MM` (24h) format the
  schedule stores: `isValidTime24`, `parseTime24`, `toTime24`, `formatTime12`, `compareTimes`. `''`
  means "day off", which `isRepOnDuty` and the callback rota already treat as off.
- **`src/lib/utils/time.test.ts` (new)** — 6 tests covering the boundaries (12 AM/PM, 00:00/23:59,
  malformed/out-of-range rejection).
- **`src/lib/components/TimePicker.svelte` (new)** — a bindable `value` (`$bindable`) in `HH:MM` or
  `''`, rendered as a trigger button (12-hour display, e.g. "8:00 AM") opening a popover: AM/PM
  segmented toggle, hour grid (1–12), minute grid (5-min steps), and a clear (×) that sets the day
  off. Props: `placeholder`, `disabled`, `invalid` (red border), `ariaLabel`. Escape and the
  backdrop close it. The picker can only emit valid times — that is the core guard.
- **`representatives/add/+page.svelte`** and **`representatives/[id]/edit/+page.svelte`** — replaced
  the native inputs with `TimePicker`, added `invalidRange(day)` (invalid only when both bounds are
  set and `end <= start`), and an inline red summary listing the offending days.

## Decisions worth knowing

- **The value contract is the existing one.** No new format was invented; the picker speaks the same
  `HH:MM` / `''` the schedule already stored, so `loadReps`/`buildRepRota`/`isRepOnDuty` needed no
  change. `''` (cleared) is deliberately *valid* — it is "day off", not "missing".
- **The guard is range-only.** A single empty bound is not an error; only a fully-specified range
  whose end is not after its start is flagged. This mirrors `isRepOnDuty`, which treats a blank day
  as off rather than broken.
- **Minutes are 5-minute steps.** If the current value has a non-5 minute (e.g. `08:03`, imported
  from the old native input), that minute is added to the list so it stays visible and selectable
  rather than silently snapping on open.

## Not verified

- **Nothing rendered.** The component is type-checked and passed the Svelte autofixer, but no
  browser was opened: popover positioning, Escape handling, backdrop click-out and the 12/24 display
  are unproven at runtime.
- **Only the rep pages use it so far.** The component is generic but untested in any other context.
- The 4 svelte-check errors that appeared this session are in `src/lib/server/timer/timer-service.ts`
  (`@prisma/client` missing `TimerType`/`TimerStatus`), a file this change does not touch — pre-existing.
  The touched files add zero errors; only the pre-existing `data` initial-value-capture warnings on
  the edit page remain.

---

## Follow-up: block saving when the schedule is not proper

Reported: the red "End time must be after start time" warning showed, but the rep still saved.

### Fix

- **`invalidScheduleDays`** in `$lib/utils/time.ts` is now the single validator, and it is stricter
  than the page-local `invalidRange` it replaced: a day is invalid when a time is malformed, when
  only one bound is set (half-filled), or when end <= start. Fully empty (day off) remains valid.
  The earlier "range-only" note above is superseded.
- **Client** (`representatives/add` + `[id]/edit`): the submit button is `disabled` while any day is
  invalid, and `use:enhance` cancels the submit (correct `({ cancel })` outer signature).
- **Server** (`add/+page.server.ts` + `[id]/edit/+page.server.ts`): both actions run
  `invalidScheduleDays` and return `fail(400)` with the offending days, so a bypassed client still
  cannot persist a bad schedule. This is the real gate.

### Not verified

- No browser run. The disabled-button + enhance-cancel + server-400 triple is type-checked and the
  validator is unit-tested (10/10), but the end-to-end "cannot save" behaviour is not exercised.

---

## Follow-up: use the TimePicker on the auto-reply hours screen

`(app)/settings/auto-replies` had its own hand-rolled time picker (a Clock button opening a popover
of `<select>` start/end + AM/PM, with an Apply button). Replaced it with two `TimePicker` instances
per day.

The auto-reply business hours are stored as a combined `"8:00 AM - 6:00 PM"` string (`hours`), not
the rep schedule's separate `start`/`end`. Rather than change that format (which `callback-routing`'s
`parseHoursRange` and `isOpenAt` read), `time.ts` gained `parseRange12` / `formatRange12` (and
`parseTime12`) to convert, and the page stores each day as `{ isOpen, start, end }` in 24h `HH:MM`
while serialising back to `{ isOpen, hours }` in the hidden input. So the persisted shape is
unchanged; only the editor uses the shared component.

Not browser-verified; `time.test.ts` is 13/13 and the touched page adds no svelte-check errors (the
`+page.server.ts:90` Json error and the `data` capture warnings are pre-existing).
