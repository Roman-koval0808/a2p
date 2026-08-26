Use these manual scenarios and send me the resulting log rows/screenshots.

**1. Organic Bing Web Visit**

Open the site from:

```text
https://your-site.example/services/drains?utm_source=bing&utm_medium=organic
```

Browse two pages, then wait or reload after the session completes.

Expected:

- Channel: `Web · IN`
- Source: `Bing Organic`
- Status: `behaviour_inferred`
- Not `Bing Paid Ads`
- Intent: likely `research` or `comparison`
- Anonymous profile: Tier `2B`

**2. Paid Google Visit**

Open:

```text
https://your-site.example/furnace-replacement?utm_source=google&utm_medium=cpc&utm_term=furnace%20replacement%20cost
```

Browse pricing and financing pages.

Expected:

- Source: `Google Paid Ads`
- Keyword preserved
- Status initially `ad_indicated`
- Intent likely `comparison`
- Subtopic: `furnace`
- One Session ID for the visit

**3. Returning Customer, Different Subtopic**

First interaction:

```text
I need help replacing my furnace.
```

Then, using the same phone number, send or call:

```text
I also need someone to clear a blocked drain.
```

Expected:

- Same Profile ID
- Same Engagement ID
- Two Session IDs if the interactions are separate
- Engagement subtopics include `furnace` and `drain`
- A new subtopic must not create a new Engagement

**4. Emergency Inbound Call**

Call the inbound business number and say:

```text
My pipe burst and water is flooding the basement right now.
```

Expected:

- Channel: `Voice · IN`
- Intent bucket: `emergency`
- It must not show `active + emergency`
- Emergency routing/dispatch starts
- Emergency subtopic should identify plumbing, pipe, or equivalent
- Profile should be Tier 1 if the caller number is usable
- SLA timer or emergency task is created

**5. Emergency SMS**

Send from a mobile number:

```text
Emergency. No heat since last night and the house is freezing. Please send someone.
```

Expected:

- Channel: `SMS · IN`
- Intent bucket: `emergency`
- Status: `declared`
- No separate competing urgency bucket
- Emergency route/task created
- Same phone number resolves to the same Profile on repeat messages

**6. Normal SMS Booking**

Send:

```text
Can someone come look at my water heater next Tuesday?
```

Expected:

- Channel: `SMS · IN`
- Intent: `active` or booking-equivalent operational purpose
- Not emergency
- Subtopic: `water_heater`
- Task or appointment workflow created
- Reply remains on SMS

**7. Landline / Phone-Only Contact**

Call from a landline and say:

```text
I would like to book an appointment for a furnace inspection.
```

Expected:

- Profile is Tier 2, not Tier 1
- No SMS is attempted
- Internal phone follow-up task is created
- No invalid `call` approval record is created

**8. Session Timeout**

Use the same browser tab and same visitor identity:

1. Browse `/furnace-replacement`.
2. Wait longer than the configured session timeout, normally 30 minutes.
3. Browse `/services/drains`.

Expected:

- Same Profile
- Same Engagement while within its engagement window
- Different Session IDs
- Engagement subtopics include both subjects

**9. Duplicate Webhook**

Send the exact same provider event twice with the same provider event ID.

Expected:

- One operational action only
- One notification only
- Duplicate raw event remains stored
- Duplicate communication entry is marked suppressed
- Suppression reason identifies duplicate provider ID or duplicate content

**10. Outbound Reply**

Have the system send an outbound SMS or email, then reply from the customer.

Expected:

- Outbound row has intent status `n/a`
- Reply is inbound and carries the customer intent
- Reply remains linked to the same Engagement when it clearly continues the same request
- No cross-channel reply is sent to a landline-only customer

For each test, send:

- Channel and source shown
- Profile ID and tier
- Engagement ID
- Session ID
- Intent bucket/status
- Subtopic
- Created task, timer, notification, or approval
- Any unexpected duplicate or missing row
