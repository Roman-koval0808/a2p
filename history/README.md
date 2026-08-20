# history/

One markdown file per AI-assisted working session. Written **by the agent, at the end of the
session**, before handing back.

## Why

Sessions produce changes across many files, and the reasoning behind them — which behaviour was a
bug and which was deliberate, what was tried and rejected, what is still unverified — lives only in
a chat transcript that nobody reads again. Six weeks later the code says *what*, git says *when*,
and nothing says *why this and not the obvious alternative*.

These files are the *why*. They are not changelogs; git already does that.

## Naming

```
history/YYYY-MM-DD-short-topic.md
```

e.g. `2026-08-10-identity-tiers-comm-ids.md`. Several sessions in one day get `-2`, `-3` suffixes.

## What each file must contain

Keep it honest and short. A wrong entry is worse than none.

| Section | What goes in it |
|---|---|
| **Goal** | What was asked, in the requester's words where possible |
| **Changed** | Files and what each change does — the reasoning, not the diff |
| **Root causes** | For each bug: the actual mechanism, not the symptom |
| **Rejected** | Approaches tried and abandoned, and why. Stops the next agent repeating them |
| **Not verified** | What has no test and was not exercised. **Never omit this section** |
| **Open decisions** | Anything needing a human — locked specs, product calls, spec conflicts |

## Rules

- **Write what actually happened**, including wrong turns. "I guarded three linkers one at a time
  before grepping for all four" is more useful than a tidy summary.
- **Never claim something works that you did not verify.** Say "tests pass" or "user confirmed in
  production" or "not verified" — those are three different things.
- **Record spec conflicts.** If the code and a doc in `specs/` disagree, say so and say which won.
- **Link to specs by section** (`clearsky-identity-tiers-canonical.md §4.3a`), not by description.
- Do not paste large diffs or logs. Reference file and line.
- [2026-08-11](2026-08-11-revert-scenario-2.md) — reverting the scenario 2 callback loop
- [2026-08-11 (2)](2026-08-11-scenario-2-callback-loop-2.md) — scenario 2 rebuilt: Joe's two clauses, the daily call, the comm id
- [2026-08-20 (3)](2026-08-20-3-embed-telemetry-cors-and-commlog-race.md) — embed signals: sendBeacon credentialed preflight, a comm-log lost update, promoting the fingerprint's profile on submit, and wiring score + intent bucket to the profiles page
