# ClearSky Scheduled Intents Specification

**Locked 2026-07-31 and 2026-08-04 (Rory). Closes tracker #80.**

**Draft, 2026-08-04. Needs `clearsky-scheduled-intents.md` built first.**

---

## 1. Why This Is Needed

The system can only do things immediately. It has nowhere to write down "do this on the 25th." This is that place.

**On 4 August, Ray Charbonneau emails Total Trades:** *"I'd like to talk to you about air conditioners. I'm heading out of town for a couple of weeks; when I get back I'll give you a call."*

He's told us the plan. Nothing to do today. Something to do on the 25th if he goes quiet.

**Today there is nowhere to put that.** The database was checked:

| Table | Can it hold a future date? |
|---|---|
| The task queue | **No.** Every row means "do this now." |
| The outcomes table | **No.** It records what already happened. |
| The feedback table | **No.** Same — it looks backwards. |

The whole system runs one way: something arrives, we decide, we act, we measure, we stop. There's no way to say *"and again in six months."*

**That one gap explains three things that looked unrelated:**
1. Both nurturing engines are built as overnight scans, because scanning was the only option.
2. Bert's *"email him in six months"* instruction had nowhere to land.
3. Every part of the system that needs to do something later invented its own way of working out whether it was due yet — three different mechanisms for one idea.

Right now, Ray's sentence gets read for tone and then forgotten. Nobody's diarised anything. If Ray gets busy and doesn't ring back, it's gone — and nobody at Total Trades ever knew it existed.

There are three useful facts in his email: what he wants (air conditioning), when (a couple of weeks), and who's supposed to act (him).

**And note what it isn't.** Ray hasn't lost interest — his engagement score is beside the point. Our existing chase-up engine fires when somebody's interest fades. **This one fires when a date goes by in silence.**

---

## 2. Core Architecture: The Schedule Table

One table. Anything that finishes a conversation can write a row into it saying *"come back to this on this date."* Once a day, one job reads the rows that have come due.

```
Something finishes  →  writes a row: "check this on 25 Aug"
                              ↓
                  Once a day, one job reads what's due
                              ↓
              Each type runs its own check: still worth doing?
                              ↓
                  If yes → hand to the Orchestrator
                              ↓
       Safety rules → client settings → the agent's task queue
```

**The daily job never creates tasks directly.** It hands off to the Orchestrator, same as everything else. That matters because the Orchestrator is where the safety rules and each client's own settings get applied — anything that skips it is a second way into the agent's queue, and two ways always drift apart. **This adds no new door.** It changes what wakes the existing one up.

### Table Schema

| Field | What it's for |
|---|---|
| `client_id` | Which trades business — needed for their settings and their timezone. |
| `profile_id` | Which customer. |
| `intent_type` | What kind of thing this is — a service recall, a check-in, a review request. |
| `due_at` | When to look at it. |
| `expires_at` | After this, don't bother — see *"Some things go off"* below. |
| `payload` | The details: what the customer said, which conversation it belongs to. |
| `status` | `pending` · `done` · `skipped` · `cancelled` · `expired` |
| `idempotency_key` | Stops a double-run sending twice. |

### Each Type Does Its Own Checking

The table is deliberately stupid. It knows **when**, not **whether**.

When something comes due, the daily job asks that type's own rules whether it's still worth doing. Maintenance already knows to check whether the customer booked in already. Check-ins already know to check whether consent still stands.

**If the answer is no, the row is marked skipped and nothing reaches the agent.** Rejected work never appears in the queue at all, rather than appearing and being killed a second later. It also stops the daily job turning into one enormous function that has to know every rule in the business.

---

## 3. The Ray Walkthrough: One Thing to Remember, Not Two

**The obvious build is:** check on the 18th whether he's called, then chase him on the 25th if not.

**Don't.** Nothing needs to sit there watching.

There's **one entry**, due the 25th. The "watching" is a single question asked on the day: has Ray been in touch since the 4th? If he rang on the 16th, the answer is yes and nothing happens.

| | |
|---|---|
| **Due** | 25 August — the date he gave, plus a week. |
| **Expires** | 8 September — don't send this in October. |
| **Remembers** | Air conditioning · "a couple of weeks" · expects him ~18 Aug. |

The 18th is written down, but **nothing happens on it**. It's what the question on the 25th measures against, and it's what the message quotes back to him.

### Why the 25th and Not the 18th

The 18th is when you'd expect him. The 25th is when silence starts to mean something.

That's a week's grace — and it's the same week already used elsewhere in the system for people who've gone quiet, not a new number invented for this.

Probably it should stretch with the window — a week is generous on "next Tuesday" and thin on "in a couple of months". Fixed at a week for now.

### No Watching, Nothing Running in the Background

He rings on the 16th, nothing fires on the 25th. No watching, nothing running in the background. One entry. One check on the day.

---

## 4. Extraction: What We Ask the AI to Pull Out

The email's already being read. This is one more question on top of what's already happening — **not a new system**.

| Field | Example |
|---|---|
| **What he wants** | Air conditioning |
| **When** | "a couple of weeks" — his exact words |
| **We think that means** | 18 August |
| **How sure we are** | High |
| **Who acts** | Ray |
| **Which channel** | He didn't say |

**Keep his exact words.** "A couple of weeks" becoming 18 August is our interpretation, not a fact. Two reasons it matters:
1. If the follow-up lands badly, somebody needs to see what we assumed rather than only the date it produced.
2. The message quotes him, so the phrase has to survive anyway.

### Not Everything Can Be Turned Into a Date

| What they said | Can we? |
|---|---|
| "next Tuesday" | Yes |
| "a couple of weeks" | Yes — 14 days |
| "after the long weekend" | Yes, with a calendar |
| "in the spring" | Barely. It's a season |
| "sometime" / "I'll be in touch" | No |

If we're not confident, we don't schedule anything. It goes to the agent as a judgement call instead.

**A follow-up sent on a date we invented is worse than no follow-up — it tells the customer we weren't listening.**

Marcus is the standing example: he deferred to "spring" and his story is still open months later. That's what the not-confident path is for.

---

## 5. Do We Reply Straight Away?

**No instant ack. Locked 5 August.** The instant ack ("Thanks Ray — we'll look forward
to hearing from you when you're back.") was built, then removed in real-world testing:
the Orchestrator already drafts a reply for every inbound message, so an ack plus a
draft was **two messages for one email**. The customer gets one reply — the Orchestrator's
drafted message, human-approved.

The reasons the ack existed still apply to the draft that replaces it:

**Our reply doesn't count as him being in touch.** Obvious once said, and easy to get
wrong — otherwise every follow-up cancels itself.

---

## 6. "We Act" vs. "They Act" — Two Different Situations

The extraction records who's supposed to act, and it changes everything downstream.

| | **A — He'll call** | **B — He asked us to** |
|---|---|---|
| **What it is** | An opportunity we're holding open | A request we're honouring |
| **We act on** | His date plus a week | His date. Nothing added |
| **If we miss it** | Opportunity gone quiet | We broke a promise |
| **Why we may contact him** | It's marketing | He asked |
| **How we contact him** | Whatever we've got | However he asked |

### Why B Gets No Extra Week

The week exists so silence can start to mean something before we chase anybody. There's no silence to interpret when he named the date and asked us to act on it. Waiting an extra week isn't patience, it's being late.

### Missing B Is a Different Kind of Failure

If A's date passes, nothing went wrong — a customer changed their mind, which they're allowed to do. If B's date passes and we never called, **we broke a promise.** That should raise an alarm, not sit quietly in a list as an opportunity nobody took.

### Channel

If he named a channel, use it. He says call — call, even if we've got his email and email is cheaper. Overriding a channel he asked for is the same mistake as repeating an arrival time a person already gave him: the automation contradicting something he heard himself.

### Permission

Permission is stronger in B, because he asked us to get in touch — that's not permission we assumed from a past sale. Still needs a proper legal answer on how a verbal request stands, how it's evidenced, and how long it lasts. Stronger, not unlimited.

---

## 7. Leaving Customers Alone While They're Mid-Commitment

**Locked 4 August.** While a customer has an open commitment, they're taken out of decay and out of every kind of nudging.

**Why this matters — back to Ray.** He said on the 4th he'd call in a couple of weeks. Meanwhile the system carries on doing what it always does: his engagement score drifts down a little each day he doesn't visit the site, and around day 10 he drops low enough to trigger an automatic *"haven't heard from you in a while"* email.

**We'd be chasing him inside the window he just told us about.** From Ray's side that reads as: they weren't listening. Which is the exact opposite of the point.

This isn't a new idea — it extends something already locked for appointments: *someone with a booking doesn't need chasing.*

### What Counts as an Open Commitment

- A booked appointment
- Something the customer said they'd do, with a date on it
- A job in progress
- A quote sitting with the customer

### What Stops

| | Stops? |
|---|---|
| Score decay | **Yes** — see below |
| Being demoted to a colder category | **Yes** |
| Automatic nurture emails | **Yes** |
| Keep-in-touch messages | **Yes** |
| **Service reminders** | **No** — see the exception |

### Decay: We Don't Count the Days He Told Us About

The score works on *how long since we heard from him*. **The committed window gets subtracted from that count.**

It's not a freeze on his record — it's a correction to the sum. And the reason matters: the score is supposed to measure interest, and **Ray telling us his plan is interest.** He isn't going cold, he's on holiday.

Left alone, three weeks of decay means he rings on the 20th and the system treats him as a stranger — having been told, in his own words, exactly when he'd be back.

Subtracting the window rather than freezing his record keeps it honest. Nothing is held open forever: the moment the commitment resolves, the clock runs normally again.

### The Exception: Things We Owe Him Still Go Out

**A service reminder still fires.** Ray's furnace warranty expiring has nothing to do with a conversation about air conditioning. Different obligation, real date, and it's part of an agreement he's paying for.

Same line already drawn elsewhere: someone declining marketing emails still gets their service reminders. **Marketing goes quiet; obligations don't.**

---

## 8. The Checks on the Trigger Date

On the 25th, we check:

| We check | If yes |
|---|---|
| Has Ray been in touch since the 4th? | Stop. He did what he said. |
| Has he booked anything? | Stop. |
| Has the job moved on, or been won? | Stop. |
| Has he opted out? | Stop. |
| None of the above | Now it's a task for the agent. |

He rings on the 16th, nothing fires on the 25th. No watching, nothing running in the background.

---

## 9. The Follow-Up Message

**A human approves it, and it can't be sent as part of a batch.** The draft is written
by the same Orlando AI that writes every other follow-up the business sends — from the
structured facts the customer gave us (what they wanted, when they said they'd get in
touch, and how). No template, no "just checking in": the AI gets the facts and writes
a brief, warm message specific to this customer. The human reviews it in the same
approval queue every other draft lands in.

No assumptions — the AI never invents why the customer hasn't responded or where they
are. It only works from the parameters: *customer name, topic, timeframe, who said
they'd act, channel.* A fallback structured cue appears when the AI is unavailable:
*"[Write a follow-up to Ray — they said they'd give us a call about air conditioning
in a couple of weeks.]"*

---

## 10. Two Records, Not One

**Locked 4 August.** Ray's email produces **two** entries, and they are not copies of each other.

| | **Total Trades' record** | **Ours** |
|---|---|---|
| Says | *"Wants to discuss air conditioning. Said he'd call around 18 Aug"* | *"25 Aug — has Ray been in touch?"* |
| It's a fact about | **Their customer** | **Our work** |
| Lives on | Ray's profile page | ClearSky's schedule |
| If we cancel our plan | **Stays.** He still said it | Gone |

**Why they can't be merged:** what Ray wrote is a fact — it happened, it's on record, and Total Trades is entitled to see it whether or not ClearSky ever does anything about it. Our entry is a *plan*, and plans get cancelled and rescheduled.

Merge them, and cancelling our own work quietly deletes Ray's words from Total Trades' view of their own pipeline.

### The Schedule Isn't the Agent's Queue

**Locked 4 August.** **The queue is today's work.** Nothing due on the 25th belongs in it on the 4th — there's nothing to do, and putting it there breaks the rule that the queue only carries things needing action now.

The schedule is a **separate list you open when you want it**: what's coming, by date, with the reason and the customer. Never pushed at anyone.

**This sharpens the visibility rule rather than breaking it.** *"The agent only sees what they need to be involved with"* is about what gets **pushed** at them. It was never about what they can **look up**.

> **Pushed at you: only what needs doing now. Looked up: everything.**

Without that split, an agent can't answer *"why is this customer quiet?"* or *"what's coming next week?"* — and both are fair questions from someone accountable for how the client does.

---

## 11. Contact Channels and Fallbacks

Don't assume it's email. This kind of message can start from an email, a phone call, a voicemail or a form, and each one leaves us holding something different — sometimes nothing.

| What we've got | How we reach him |
|---|---|
| He asked for a specific channel | That one. It overrides everything below. |
| Only a weak identifier — a name, say | However he contacted us, and nothing else. |
| His mobile | Text. |
| His email | Email. |
| Only a shared office or home landline | Not a message — a job for the agent to ring. |
| Nothing usable | Mark it unreachable and tell the agent. |

**Default to however he got in touch.** It's where he expects to hear from us.

That landline row isn't a channel, it's a different kind of work. You can't automate ringing an office and asking for someone whose identity was never established — that needs a person. It's also the row most likely to be skipped in a build, because it looks like an edge case and isn't: **every landline caller who never gave a mobile or an email lands there.**

---

## 12. Some Things Go Off

A date that passes unserved isn't always still worth serving. A furnace reminder that missed October shouldn't turn up in March.

**Whatever writes the row sets the expiry, because only it knows the shelf life.** Expired rows are **marked, not deleted** — a pile of them is a signal that the daily job or the approval queue is falling behind.

---

## 13. What Moves Here, and What Doesn't

**Not everything can be scheduled, and pretending otherwise would be wrong.**

| Behaviour | Where it lives | Reason |
|---|---|---|
| Service reminders — equipment, plans, warranties | **Here** | The date is known when the job finishes. |
| Keep-in-touch messages | **Here** | Known at job completion. |
| Review requests | **Here** | Known at job completion. |
| *"Email him in six months"* — a rep's instruction | **Here** | He said the date out loud. |
| Seasonal reminders | **Here** | One row per customer, dates spread across the window — which turns the "don't dump 200 tasks on one morning" problem into simply choosing dates. |
| **Customers going cold** | **Stays a scan** | No date to write down. *"Fire when he loses interest"* isn't a date — it's worked out fresh each day from how his score has moved. |

**Why going cold can't be scheduled:** The nurture spec's claim that a nightly scan was unavoidable is **right for that case**; it was only wrong as a statement about everything else.

### Where This Sits Alongside the Others

| | Fires when |
|---|---|
| Chasing a lead who's gone quiet | Their interest fades |
| Service reminders | A service comes due |
| **This** | A date they named goes by in silence |

Same lane, same sending mechanism, completely different trigger. And this one needs no scoring model at all — it runs on something the customer said out loud.

---

## 14. What Doesn't Exist Yet

| Component | Status |
|---|---|
| Somewhere to write down "check this on the 25th" | **Not built.** Everything here needs it. |
| Pulling a customer's stated plan out of a message | **Doesn't exist.** We extract what the rep promised, never the customer. |
| The thing that actually sends a nudge | **Proposed, not built.** |
| Turning "a couple of weeks" into a date | **Doesn't exist.** |

---

## 15. Still to Decide

### From the Schedule Table Design

| # | Question | Leaning |
|---|---|---|
| 1 | Does the cold-customer scan run as one job with this, or separately? | **Separately.** Different queries, different failure modes — one slot, two steps. |
| 2 | Can an agent see and cancel something scheduled, or is it system-only? | Visible is cheap and probably right. |
| 3 | Does writing a row need the Orchestrator, or can any part of the system write one? | **Write freely.** A scheduled row isn't a task. The gate is when it fires. |
| 4 | How long to keep done and expired rows? | Undecided. They're history, not work. |

### From the Customer-Says-They'll-Be-In-Touch Flow

| # | Question |
|---|---|
| 5 | How confident we need to be in a date before scheduling anything. |
| 6 | Does the grace period stretch with the window, or stay a week? |
| 7 | If he rings on the 16th about something else entirely — a burst pipe — does that count as being in touch? He made contact; the air conditioning conversation never happened. |
| 8 | If the first message is ignored, do we try again? |
| 9 | He isn't fading, he's waiting — should that change how his score behaves? |
