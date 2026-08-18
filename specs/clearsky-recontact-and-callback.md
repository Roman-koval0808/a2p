# Stated Intent, Part 2 — What Happens When He Gets Back

**Issue 5. Companion to `clearsky-stated-intent-followup.md`, which covers everything up to the
moment the customer goes quiet. This covers what happens when he surfaces again — and the case
where the callback is ours to make.**

Drafted 2026-08-11. Not locked. Open questions in §6 need Rory.

---

## 0 · The two scenarios, in one line each

Joe rings on 1 Aug wanting a price on a furnace, and says he's away a fortnight.

- **Scenario A — "I'll get in touch."** He owns the next move. We wait, and chase only if he
  doesn't. Already built up to the point he calls back.
- **Scenario B — "Call me when I'm back."** We own it. We ring on the date and keep ringing until
  we actually speak to him. Barely built.

The single word that separates them — *I'll call you* versus *call me* — changes the timing, the
escalation, and who has failed if nothing happens. It is `who_initiates` in the extraction, and
`actor` on the schedule row.

---

## 1 · What already works

Do not rebuild any of this.

| | Where |
|---|---|
| Thank-you SMS/email, approved by Crispin before sending | approval-required lane |
| No mobile and no email → we send nothing | §4.3a tiers + same-channel rule |
| "Two weeks" → a dated row, his words stored verbatim | `writeScheduledIntent` |
| Scenario A waits an extra week; scenario B doesn't | `CUSTOMER_ACTOR_GRACE_DAYS`, applied only to `actor = CUSTOMER` |
| He gets in touch → the chase is cancelled | `resolveOwnCommitments`, on the inbound message |
| Another customer's message never cancels his | `intent-resolution.ts`, guards in the query |

**There is no daily sweep looking for him, and there should not be.** The row sits until its date.
If he calls on the 16th, the row closes the moment his message lands — not because anything was
watching, but because his own message resolves it. Both existing specs are emphatic on this point:
*"Nothing needs to sit there watching."*

---

## 2 · Scenario A — the gap is everything after he calls back

Today, when Joe's voicemail lands on 16 Aug, the system cancels the chase and stops. **Nobody is
told what he said.** The rep sees a closed row and an unlistened recording.

### 2.1 Ask why he got in touch

When an inbound message closes an open commitment, run a second extraction — not the generic one,
a specific comparison against **the call that created the promise**.

```json
{
  "related_to_original": true,
  "relatedness_confidence": 0.9,
  "wants": "appointment" | "callback" | "information" | "nothing",
  "information_requested": "sizing for a 2000 sq ft bungalow",
  "when": "2026-08-20" | null,
  "raw_timing_phrase": "sometime next week",
  "conditions": ["wants the price before committing"],
  "lost_interest": false,
  "postponed_to": null,
  "summary": "..."
}
```

`related_to_original` is the field that matters most, and it is also the one that decides an open
question — see §6.1.

The same extraction runs whether he left a voicemail, sent an SMS, emailed, or spoke to a rep. A
conversation with a human is not exempt: we still want a structured reading of what was agreed.

### 2.2 One conversation, one comm id

His 16 Aug call belongs to the 1 Aug conversation. Same customer, so linking is permitted — the
guards added on 2026-08-10 only block linking **across** customers.

The original call also needs a stable reference the rep can quote, distinct from the COM id of the
thread.

### 2.3 Tell the rep, and act on the answer

Every closure produces exactly one task carrying the summary. Which task depends on the reading:

| Reading | Task |
|---|---|
| Wants an appointment or a callback | **Contact Joe** — summary, what he asked for, his own words |
| Wants information | **Send information** — approval-required draft |
| Postponed | Task to note it **and a new commitment row on the new date** |
| Lost interest | **Closed — lost.** Summary to the rep. No further automation |
| Not related to the original | See §6.1 — undecided |

**Postponed must write a new row.** Otherwise the one thing holding Joe in the pipeline is gone and
he falls out silently. This is the easiest step to miss.

---

## 3 · Scenario B — we owe the call

`due_at` is his date with no grace, and that part works. The rest does not.

### 3.1 Ring him until we reach him

From 13 Aug, one attempt per day until contact. Each attempt either succeeds or schedules
tomorrow's — **a queue of dated attempts, not a loop and not a watcher.** Same shape as the
existing schedule rows.

### 3.2 An answering machine is not contact

The hard part. Telnyx reports that the call connected and for how long, but a twelve-second call is
either "not now, thanks" or his voicemail greeting.

Proposed rule, needs a number from Rory (§6.3): **answered, longer than N seconds, and not flagged
as machine-detected.** It will sometimes be wrong in both directions, which is why §3.3 exists.

### 3.3 Stop trying eventually

After N attempts (§6.2) it stops being automation and becomes a person's judgement. The row hands
off to the rep with the attempt history attached.

### 3.4 A missed scenario B is a failure, not an opportunity

If Joe's date passes and we never rang, **we** broke the promise. It escalates and is visible as a
service failure — it does not sit in a queue looking like an untaken lead.

### 3.5 Shared lines can't be auto-dialled

If Joe rang from a landline and never gave a mobile, we don't know which person in that house or
office to ask for. That is a **task for a human**, not an automated call. Every landline caller who
never gave an exclusive identifier lands here, and it is the row most likely to be skipped in a
build because it looks like an edge case.

---

## 4 · Sequencing

| | Work | Blocked by |
|---|---|---|
| 1 | Re-contact analysis + rep task + postpone re-scheduling (§2.1–2.3) | §6.1 only for the "unrelated" branch |
| 2 | Link the callback into the original conversation (§2.2) | — |
| 3 | Daily attempt queue (§3.1, §3.3, §3.4) | §6.2, §6.4 |
| 4 | Contact-vs-voicemail detection (§3.2) | §6.3 |

1 and 2 finish scenario A and need almost no decisions. 3 and 4 are scenario B and need all four.

---

## 5 · Acceptance criteria

1. An inbound message closing a commitment produces **exactly one** rep task carrying the
   customer's own words.
2. A message read as *postponed* writes a **new** commitment on the new date.
3. A message read as *lost interest* produces no further automated contact.
4. The callback and the original call share one comm id; the original keeps a quotable reference.
5. Scenario B makes **one attempt per day** from the stated date, and stops on real contact.
6. Voicemail does not count as contact.
7. Scenario B exhausting its attempts hands off to a human with the attempt history.
8. A missed scenario B is visible as a failure, not as a pending opportunity.
9. A landline caller with no exclusive identifier produces a **task**, never an automated dial.

---

## 6 · Do not decide these yourself

| # | Question | Status |
|---|---|---|
| 1 | **Does unrelated contact close the commitment?** Joe rings on the 16th about a burst pipe — he made contact, but not about the furnace. This is `clearsky-stated-intent-followup.md` §6.3, still open, and §2.1 above forces the issue | **Open — Rory** |
| 2 | How many attempts in scenario B before handing to a human? | **Open — Rory** |
| 3 | What counts as reaching him — answered plus how many seconds? | **Open — Rory** |
| 4 | Attempts per day, or a couple spread across the day? Which hours? | **Open** |
| 5 | If he postpones twice, is there a limit? | **Open** |
