import { prisma } from '$lib/db';
import { logCommunication } from '$lib/utils/communication-log';
import { toE164 } from '$lib/company-numbers';
import { extractCallbackNumber, normalizePhoneNumber } from '$lib/utils/phone';
import { decideRouting, isOffHours } from '$lib/server/emergency-routing';
import {
	classifyMessageIntent,
	bucketToCategory,
	looksLikeActiveEmergency
} from './message-intent';
import { deriveNextActionPlan } from './next-action';
import { splitDraftSubject } from '$lib/utils/email-draft';
import {
	checkCalendarAvailability,
	formatDatetime,
	describeLocations,
	describeDayHours,
	resolveNamedDays
} from './calendar';
import { getBookingUrl, bookingLinkWith } from '$lib/utils/booking';
import { resolveBalanceByPhone } from './balance';
import {
	getAvailableSlots,
	getBookingLinkIfConnected,
	getConnectionInfo,
	getCustomerAppointments,
	resolveReschedule,
	type RescheduleResult
} from './google-calendar';
import { ANTHROPIC_AI_KEY } from '$env/static/private';
import { isInternalCaller } from '$lib/server/internal-call-guard';
import { sendCallbackAck } from '$lib/server/callback-ack';
import {
	isAffirmative,
	proposeAppointment,
	findPendingProposal,
	bookProposedAppointment
} from '$lib/server/appointment-flow';
import { buildBalanceEmail, wantsEmailedBalance } from '$lib/server/billing-email';
import { phoneGeo, dayOfWeek, lookupLineType } from '$lib/server/phone-geo';
import { getLineType } from '$lib/server/number-lookup';
import { TIER, tierForIdentifiers } from '$lib/server/profiledb/tiers';
import { weatherForLocation } from '$lib/server/weather';

export async function process_orchestrator(commId: string, trigger: string) {
	// Capture the orchestrator's own log lines so they persist on the comm (metadata.orchestrator_logs)
	// and can be surfaced in the UI ("View Log"). olog/oerr tee to the console AND this buffer.
	const orchestratorLogs: string[] = [];
	const fmt = (a: any[]) =>
		a.map((x) => (typeof x === 'string' ? x : x?.message || JSON.stringify(x))).join(' ');
	const olog = (...a: any[]) => {
		console.log(...a);
		orchestratorLogs.push(fmt(a));
	};
	const oerr = (...a: any[]) => {
		console.error(...a);
		orchestratorLogs.push('⚠ ' + fmt(a));
	};

	olog(`[Orchestrator] Processing commId: ${commId} with trigger: ${trigger}`);

	// Fetch the communication log
	const commLog = await prisma.communicationLog.findUnique({
		where: { id: commId },
		include: {
			company: {
				include: { locations: true }
			},
			customer: true
		}
	});

	if (
		!commLog ||
		!commLog.companyId ||
		!commLog.customerId ||
		!commLog.customer ||
		!commLog.company
	) {
		olog('[Orchestrator] Missing commLog, company, or customer. Aborting.');
		return;
	}

	const metadata = (commLog.metadata as Record<string, any>) || {};
	// Dialer (WebRTC softphone) OUTBOUND calls are the only outbound communications the
	// orchestrator acts on: their transcript is processed exactly like an inbound message
	// (booking draft + tasks + reply). All other outbound rows (emergency dial-ladder legs,
	// transfers, server dials) are operational — always skipped.
	const isDialerOutbound =
		commLog.direction === 'outbound' &&
		(metadata.dialer_outbound === true || metadata.webrtc_call === true);
	const intent = metadata.intent || metadata.ivr_intent;
	const sub_intent = metadata.sub_intent;
	const datetime = metadata.datetime;
	const digit = metadata.ivr_digit;

	const customer = commLog.customer!;
	const company = commLog.company!;
	// destination may be annotated as "+1705… (Ext 1 - Billing)" — strip that before E.164,
	// otherwise the drafted SMS gets an invalid `from` and Telnyx rejects it ("Invalid source number").
	const cleanDestination = (commLog.destination || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
	// Inbound logs are source=customer / destination=company; dialer outbound logs are the
	// reverse (source=company / destination=customer). Flip so the whole flow below — profile
	// lookup, SMS from/to, booking link, callback number — always sees the customer's number.
	const companyNumber = toE164(isDialerOutbound ? commLog.source || '' : cleanDestination);
	const customerPhone = toE164(isDialerOutbound ? commLog.destination || '' : commLog.source || '');

	// Company Gmail address (the account any email draft is sent FROM). Best-effort: if the
	// company hasn't connected Gmail, we fall back to the customer email so the UI still shows
	// something meaningful in the source column.
	let companyEmail: string | null = null;
	try {
		const connInfo = await getConnectionInfo(company.id);
		companyEmail = connInfo.email || null;
	} catch {
		/* best-effort */
	}

	let pipelineCustomerProfileId: string | undefined = metadata.customer_profile_id;
	if (!pipelineCustomerProfileId && customerPhone) {
		const profile = await prisma.pipelineCustomerProfile?.findFirst({
			where: { companyId: company.id, phoneNumber: customerPhone }
		});
		if (profile) pipelineCustomerProfileId = profile.id;
	}

	// Prevent drafting multiple SMS if already processed
	if (metadata.orchestrator_processed) {
		olog('[Orchestrator] Already processed. Aborting.');
		return;
	}

	// Wait, is it inbound (or a dialer outbound call the orchestrator may act on)?
	if (commLog.direction !== 'inbound' && !isDialerOutbound) {
		return;
	}

	// Inbound: skip inbound + dialer-outbound rows where the CUSTOMER side is one of the
	// company's own numbers. The customer side is source for inbound, destination for dialer
	// outbound (source is the company's own number there). T4.4: skip operational/internal
	// calls (e.g. the owner leaving himself a voicemail on a company line) — classifying them
	// as customer contacts would score a false emergency.
	if (
		commLog.companyId &&
		(await isInternalCaller(
			commLog.companyId,
			isDialerOutbound ? commLog.destination || '' : commLog.source || ''
		))
	) {
		olog('[Orchestrator] Internal/operational caller — skipping customer classification.');
		return;
	}

	// --- Reclassify by the MESSAGE, not the IVR digit ---
	// The caller may press the wrong key (or the menu is limited — in the demo the greeting
	// routes billing AND sales to "1"). We follow what they actually SAID: classify the
	// transcript + AI summary, and if it doesn't match the digit's department, reclassify and
	// follow the message. An emergency always wins, whatever digit was pressed.
	const rawMessage = (commLog.content || metadata.summary || commLog.summary || '').toString();
	// When a caller hangs up without leaving a voicemail (or transcription yields nothing) the call
	// webhook stores a PLACEHOLDER as the content — "Call completed (30s)", "Call recording
	// available (0s)". That is call metadata, not something the customer said. Treating it as a
	// message made the AI try to reply to it and narrate its own limitations instead:
	// "I understand you've left a voicemail, but I'm not able to listen to recordings through text."
	const hasCustomerMessage =
		!/^\s*call\s+(completed|recording available)\s*\(\d+s\)\s*$/i.test(rawMessage.trim()) &&
		rawMessage.trim().length > 0;
	const digitCategory: 'billing' | 'sales' | 'support' | null =
		digit === '1' ? 'billing' : digit === '2' ? 'sales' : digit === '3' ? 'support' : null;

	// Compile the structured caller metrics FIRST — IVR digit/department, call time + day of
	// week, phone geo (area code → city), mobile-vs-landline + carrier (Telnyx), and current
	// weather — so we can (a) hand them to the AI as context and (b) store them on the record.
	const callerContext: Record<string, unknown> = {};
	try {
		const callAt = commLog.created ? new Date(commLog.created) : new Date();
		const geo = phoneGeo(commLog.source);
		const day = dayOfWeek(callAt);
		const lt = await lookupLineType(commLog.source);
		const weather = await weatherForLocation(geo?.location);
		metadata.caller_geo = geo;
		metadata.call_day_of_week = day;
		metadata.line_type = lt.lineType;
		metadata.carrier = lt.carrier;
		metadata.weather = weather;
		olog(
			`[Orchestrator] Enrichment -> day ${day}; geo ${geo?.areaCode ?? '?'}/${geo?.location ?? '?'}; line ${lt.lineType}${lt.carrier ? ' (' + lt.carrier + ')' : ''}; weather ${weather ? `${weather.tempF}°F ${weather.description}` : 'n/a'}.`
		);
		Object.assign(callerContext, {
			ivr_digit: digit ?? null,
			ivr_department: intent ?? null,
			call_time: callAt.toISOString(),
			day_of_week: day,
			area_code: geo?.areaCode ?? null,
			city: geo?.location ?? null,
			line_type: lt.lineType,
			carrier: lt.carrier,
			weather: weather ? { tempF: weather.tempF, description: weather.description } : null
		});
	} catch (e) {
		oerr('[Orchestrator] caller enrichment failed:', e);
	}

	// The AI classifier decides the category — no keyword/digit fallbacks — but it now gets the
	// structured metrics above as context alongside the caller's actual words. e.g. "book an
	// appointment to come down and pay my bill" -> booking (ask for a time), not a balance reply.
	const aiIntent = await classifyMessageIntent(rawMessage, ANTHROPIC_AI_KEY, callerContext);
	let messageCategory: 'emergency' | 'billing' | 'sales' | 'support';
	if (aiIntent) {
		messageCategory = bucketToCategory(aiIntent);
		metadata.ai_intent = aiIntent;
		olog(
			`[Orchestrator] AI intent: ${aiIntent.intent_bucket} (urgency ${aiIntent.urgency}, appt ${aiIntent.wants_appointment}, balance ${aiIntent.wants_balance}, callback ${aiIntent.wants_callback}, conf ${aiIntent.confidence}) -> ${messageCategory}`
		);
		if (aiIntent.reason) olog(`[Orchestrator] AI reason: ${aiIntent.reason}`);
		if (aiIntent.needs_human_review)
			olog('[Orchestrator] AI flagged this for human review (low confidence / ambiguous).');
	} else {
		// Classification unavailable (empty message or AI error): route to a human, never guess.
		messageCategory = 'support';
		metadata.ai_intent = null;
		olog('[Orchestrator] No AI classification available; routing to support for human review.');
	}

	// Deterministic emergency backstop: never let an ACTIVE emergency (water coming in, gas, fire)
	// be routed to booking/sales/support because the AI weighed a scheduling mention over the
	// danger. This is exactly what happened to Brahma's roof leak ("water coming into my kitchen").
	if (messageCategory !== 'emergency' && looksLikeActiveEmergency(rawMessage)) {
		olog(
			`[Orchestrator] Emergency backstop: message describes an ACTIVE emergency but AI classified "${messageCategory}" — forcing emergency.`
		);
		messageCategory = 'emergency';
	}

	// Repeat Escalation backstop (Scenario 3): a frantic callback during an open emergency
	// ("it's getting worse!") must re-enter the emergency flow even if the AI didn't flag the
	// words.
	//
	// It is NOT enough that an open emergency container exists. This used to force EVERY later
	// message from that customer to emergency, so "schedule an appointment to check the new car"
	// dispatched a technician and whispered the previous call's roof-leak text at them. Two
	// conditions now have to hold:
	//   1. the new message itself carries an urgency signal — a calm booking request is not a
	//      frantic callback, whatever happened earlier; and
	//   2. the emergency is still recent. Containers are not auto-closed, so a breached one from
	//      this morning would otherwise poison every message for the rest of time.
	if (messageCategory !== 'emergency') {
		const complaints = Array.isArray(aiIntent?.complaints) ? aiIntent.complaints : [];
		const urgencySignal =
			aiIntent?.urgency === 'high' ||
			aiIntent?.urgency === 'critical' ||
			aiIntent?.intent_bucket === 'emergency' ||
			aiIntent?.sentiment === 'negative' ||
			complaints.length > 0 ||
			looksLikeActiveEmergency(rawMessage);

		if (!urgencySignal) {
			olog(
				`[Orchestrator] Scenario 3 backstop skipped: "${messageCategory}" message carries no urgency signal (urgency=${aiIntent?.urgency ?? 'n/a'}, sentiment=${aiIntent?.sentiment ?? 'n/a'}, complaints=${complaints.length}) — not treating it as an emergency callback.`
			);
		} else {
			const REPEAT_WINDOW_MS = 6 * 60 * 60 * 1000;
			const hasOpenEmergency = await prisma.commContainer.findFirst({
				where: {
					companyId: company.id,
					OR: [
						...(pipelineCustomerProfileId
							? [{ customerProfileId: pipelineCustomerProfileId }]
							: []),
						{ contactId: customer.id }
					],
					state: 'open',
					threadType: 'emergency',
					openedAt: { gte: new Date(Date.now() - REPEAT_WINDOW_MS) }
				}
			});
			if (hasOpenEmergency) {
				olog(
					`[Orchestrator] Scenario 3 backstop: urgent message during an open emergency. Forcing "${messageCategory}" to emergency.`
				);
				messageCategory = 'emergency';
			}
		}
	}

	// Scenario 1 backstop: if the caller explicitly pressed Support, but asked for a meeting,
	// keep it in the Support flow so the Calendar Verification logic can run, instead of hijacking it to Sales.
	if (digitCategory === 'support' && messageCategory === 'sales' && aiIntent?.wants_appointment) {
		olog(
			`[Orchestrator] Scenario 1 backstop: caller pressed Support but asked for a meeting. Keeping as Support.`
		);
		messageCategory = 'support';
	}

	const reclassified = !!(digitCategory && digitCategory !== messageCategory);
	if (reclassified) {
		olog(
			`[Orchestrator] Reclassified: caller pressed ${digit} (${digitCategory}) but the message is "${messageCategory}" — following the message.`
		);
	}
	metadata.message_category = messageCategory;
	metadata.reclassified = reclassified;
	if (digitCategory) metadata.ivr_pressed_category = digitCategory;

	// T3.1: pre-approved callback acknowledgement ("a representative will call you in X minutes").
	// Fires without human approval, but sendCallbackAck gates it on config (sms_auto_reply_allowed),
	// transactional consent, and office hours. Deduped so a re-delivered webhook can't double-send.
	if (
		aiIntent?.wants_callback &&
		!metadata.callback_ack_sent &&
		commLog.companyId &&
		customerPhone
	) {
		try {
			const ack = await sendCallbackAck({
				companyId: commLog.companyId,
				phone: customerPhone,
				customerName: customer.name || null,
				summary: commLog.summary || metadata.summary || null
			});
			if (ack.sent) {
				metadata.callback_ack_sent = true;
				olog(`[Orchestrator] Callback ack sent (${ack.slaMinutes} min).`);
			} else {
				olog(`[Orchestrator] Callback ack skipped: ${ack.reason}`);
			}
		} catch (err) {
			oerr('[Orchestrator] Callback ack failed:', err);
		}
	}

	// Claim this comm up-front so a retried or concurrent webhook (Telnyx can re-deliver
	// recording.saved) can't double-increment the engagement score or draft the SMS twice.
	// Marking before the work — not after — means a failed run won't auto-retry, which is
	// the right trade-off here: better to under-process than to double-charge engagement.
	// Mutating the local metadata too keeps later `{ ...metadata }` writes consistent.
	// --- §4.3 The Same-Channel Response Rule -------------------------------------------------
	//
	// A Tier 2 event is answered only on the channel it arrived on. We know which LINE rang, not
	// which person — so the one safe reply is back to the place the contact came from. Crossing to
	// SMS or email would be writing to whoever else shares that handset.
	//
	// Only an identifier exclusive to one person lifts the restriction: an email address, or a
	// phone on a mobile line (§4.3a). A landline or VoIP caller becomes Tier 1 the moment they
	// give us one — which is why capturing a mobile or an email on such a call is the whole job.
	const arrivalChannel: 'sms' | 'email' | 'voice' =
		commLog.type === 'sms' ? 'sms' : commLog.type === 'email' ? 'email' : 'voice';

	const callerLineType = customerPhone ? await getLineType(customerPhone) : undefined;
	const callerTier = tierForIdentifiers({
		hasEmail: !!customer.email,
		hasPhone: !!customerPhone,
		lineType: callerLineType,
		inboundSms: arrivalChannel === 'sms' && commLog.direction === 'inbound',
		hasName: !!customer.name
	});
	const sameChannelOnly = callerTier !== TIER.IDENTIFIED;

	if (sameChannelOnly) {
		olog(
			`[Orchestrator] ${callerTier} (line=${callerLineType ?? 'n/a'}) — same-channel only (§4.3): ` +
				`reply on ${arrivalChannel} and nothing else until they give a mobile or an email.`
		);
	}
	metadata.identity_tier = callerTier;
	metadata.same_channel_only = sameChannelOnly;

	// This customer just got in touch. Close the promises THEY made — strictly their own rows
	// (profileId equality), and never the one this very communication just created.
	if (commLog.direction === 'inbound' && customer?.id) {
		try {
			const { resolveOwnCommitments } = await import('./intent-resolution');
			const closed = await resolveOwnCommitments({
				companyId: commLog.companyId,
				profileId: customer.id,
				excludeIdempotencyKey: `orch_suspense_${commId}`
			});

			if (closed.length > 0) {
				olog(
					`[Orchestrator] ${closed.length} open commitment(s) closed — ${customer.id} got in touch.`
				);

				// Closing the chase is the easy half. The rep still needs to know WHAT he said —
				// otherwise all they see is a row going quiet and a recording nobody has heard
				// (clearsky-recontact-and-callback.md §2.1–2.3).
				try {
					const { analyseRecontact, outcomeFor } = await import('./recontact-analysis');
					const original = closed[0];
					const analysis = await analyseRecontact({
						apiKey: ANTHROPIC_AI_KEY,
						originalPromise: original.promise,
						originalTopic: original.topic,
						originalDate: original.promisedAt,
						newMessage: commLog.content || commLog.summary || '',
						receivedAt: commLog.created
					});
					const outcome = outcomeFor(analysis, customer.name || customerPhone || '');

					olog(
						`[Recontact] ${outcome.title}` +
							(analysis
								? ` (related=${analysis.relatedToOriginal}, wants=${analysis.wants})`
								: ' (no reading — surfaced for review)')
					);

					await prisma.task.create({
						data: {
							companyId: commLog.companyId,
							contactId: customer.id,
							communicationThreadId: commLog.communicationThreadId || null,
							title: outcome.title,
							description: analysis?.summary || commLog.summary || commLog.content || ''
						}
					});

					// He didn't cancel, he moved the date. Without a fresh row the only thing
					// holding him in the pipeline disappears the moment the old one closes.
					if (outcome.rescheduleTo) {
						const { writeScheduledIntent } = await import('./scheduled-intent-writer');
						await writeScheduledIntent({
							companyId: commLog.companyId,
							contactId: customer.id,
							profileId: customer.id,
							extraction: {
								hasFutureIntent: true,
								schedulable: true,
								actor: 'CUSTOMER',
								whatHeWants: original.topic || analysis?.summary || '',
								rawTimeframe: analysis?.rawTimingPhrase || 'postponed',
								timeframeDays: 0,
								exactDateIso: outcome.rescheduleTo,
								calculatedTargetDate: outcome.rescheduleTo,
								confidence: 'HIGH',
								preferredChannel: 'phone'
							},
							channel: commLog.type === 'sms' ? 'sms' : commLog.type === 'email' ? 'email' : 'voice',
							originalTarget: customerPhone || null,
							conversationId: original.conversationId,
							commLogId: commId,
							idempotencyKey: `recontact_postpone_${commId}`
						});
						olog(`[Recontact] Re-scheduled to ${outcome.rescheduleTo} — he postponed, not cancelled.`);
					}
				} catch (e: any) {
					oerr('[Recontact] Analysis failed (commitment still closed):', e);
				}
			}
		} catch (e: any) {
			oerr('[Orchestrator] Commitment resolution failed:', e);
		}
	}

	metadata.orchestrator_processed = true;
	try {
		await prisma.communicationLog.update({
			where: { id: commId },
			data: { metadata: { ...metadata } }
		});
	} catch (err) {
		oerr('[Orchestrator] Failed to claim comm for processing:', err);
		return;
	}

	// SCENARIO 2 confirm: if this inbound affirms a pending appointment proposal we sent this
	// caller, BOOK it now — create the calendar event, persist the Appointment, notify the rep.
	let bookedConfirmation: string | null = null;
	let mergedContainerId: string | null = null;
	if (isAffirmative(rawMessage) && commLog.companyId && customerPhone) {
		olog(
			`[Orchestrator] Affirmative reply detected — looking for a pending proposal for ${customerPhone}.`
		);
		const pending = await findPendingProposal(commLog.companyId, customerPhone);
		olog(
			pending
				? `[Orchestrator] Found pending proposal (comm ${pending.commId}) for ${pending.proposal.proposedLabel} — booking now.`
				: '[Orchestrator] No pending proposal found for this caller — treating as a normal message.'
		);
		if (pending) {
			// This is a booking confirmation, not a support ticket — label it Sales so the log
			// shows the right Category/Department (not "Support / <UNKNOWN>").
			messageCategory = 'sales';
			metadata.message_category = 'sales';
			metadata.ivr_intent = 'Sales';
			try {
				const result = await bookProposedAppointment({
					companyId: commLog.companyId,
					contactId: customer.id,
					contactName: customer.name,
					phone: customerPhone,
					proposal: pending.proposal,
					proposalCommId: pending.commId
				});
				bookedConfirmation = result.message;
				metadata.appointment_booked = {
					appointmentId: result.appointmentId,
					calendarEventId: result.calendarEventId,
					when: pending.proposal.proposedStartISO
				};
				olog(
					`[Orchestrator] Auto-booked appointment ${result.appointmentId} from affirmative reply.`
				);
			} catch (e) {
				// Never leave an affirmative reply to fall through to the generic/agentic path
				// (which can ramble). Confirm the time and flag it for manual calendar entry.
				oerr(
					'[Orchestrator] Auto-book failed; confirming anyway and flagging for manual entry:',
					e
				);
				bookedConfirmation = `You're all set — we've got you down for ${pending.proposal.proposedLabel}. See you then!`;
				metadata.appointment_booked = { manual: true, when: pending.proposal.proposedStartISO };
				metadata.needs_manual_calendar = true;
			}
		}
	}

	let draftedResponse = '';
	let draftChannel: 'sms' | 'email' =
		metadata.requested_contact_method === 'email' || commLog.type === 'email' ? 'email' : 'sms';

	// A shared-line caller cannot be moved onto another channel, however they asked. Their stated
	// preference is not evidence of who they are.
	if (sameChannelOnly && arrivalChannel !== 'voice' && draftChannel !== arrivalChannel) {
		olog(
			`[Orchestrator] Reply channel forced ${draftChannel} → ${arrivalChannel} (${callerTier}, §4.3).`
		);
		draftChannel = arrivalChannel;
	}
	let emailSubject = '';
	let proposedAppointment: any = null;
	let skipSafetyNet = false;
	let scenarioLocked = false; // a scenario produced a specific draft — don't let the conversational reply override it

	// --- SCENARIO 2b: proposal on a context-matched container ---
	// The customer replied on a channel/identity the phone-based lookup can't see (e.g. we
	// proposed a time by EMAIL, they text back "Monday works for the check."). Resolve the
	// container by context, find the pending proposal attached to it, and — because the reply
	// renegotiates the time — DRAFT the booking for approval instead of auto-booking. The draft
	// lands in the approval queue ("a draft to be sent"), not a self-serve booking link.
	if (!bookedConfirmation && isAffirmative(rawMessage) && commLog.companyId) {
		try {
			const { resolveContextContainer } = await import('./container/thread-resolver');
			const resolution = await resolveContextContainer({
				companyId: commLog.companyId,
				contactId: customer.id,
				customerProfileId: pipelineCustomerProfileId || null,
				phone: customerPhone || null,
				email: customer.email || null,
				channel: commLog.type === 'sms' ? 'sms' : commLog.type === 'email' ? 'email' : 'voice',
				direction: 'inbound',
				subject: commLog.summary || ((commLog.metadata as any)?.subject ?? null),
				content: (commLog.content || commLog.summary || '').slice(0, 4000),
				// The message's own arrival time: containers opened AFTER it (the pipeline pre-creates
				// one per message) cannot be conversations it continues.
				occurredAt: commLog.created,
				excludeCommIds: [metadata.commContainerId, metadata.commId].filter(Boolean) as string[],
				callerContactId: customer.id,
				callerCustomerProfileId: pipelineCustomerProfileId || null
			});
			if (resolution.matched && resolution.commId) {
				const viaContainer = await findPendingProposal(commLog.companyId, customerPhone || '', {
					containerId: resolution.commId
				});
				if (viaContainer) {
					messageCategory = 'sales';
					metadata.message_category = 'sales';
					metadata.ivr_intent = 'Sales';
					const replyDatetime = metadata.datetime || null;
					if (replyDatetime) {
						// The customer gave their own time — propose it and DRAFT the confirmation.
						const proposed = await proposeAppointment(commLog.companyId, replyDatetime, 60);
						const proposal = proposed.proposal || {
							requestedISO: replyDatetime,
							proposedStartISO: replyDatetime,
							proposedEndISO: replyDatetime,
							proposedLabel: replyDatetime,
							booked: false
						};
						proposedAppointment = proposal;
						draftedResponse = `You're all set — we've got you down for ${proposal.proposedLabel}. See you then!`;
						scenarioLocked = true;
						olog(
							`[Orchestrator] Scenario 2b: proposal found on container ${resolution.commId}; drafted ${proposal.proposedLabel} for approval.`
						);
					} else {
						// Plain "yes" — book the originally proposed time right away.
						const result = await bookProposedAppointment({
							companyId: commLog.companyId,
							contactId: customer.id,
							contactName: customer.name,
							phone: customerPhone,
							proposal: viaContainer.proposal,
							proposalCommId: viaContainer.commId
						});
						bookedConfirmation = result.message;
						metadata.appointment_booked = {
							appointmentId: result.appointmentId,
							calendarEventId: result.calendarEventId,
							when: viaContainer.proposal.proposedStartISO
						};
						scenarioLocked = true;
						draftedResponse = bookedConfirmation;
						olog(
							`[Orchestrator] Scenario 2b: auto-booked ${viaContainer.proposal.proposedLabel} via container ${resolution.commId}.`
						);
					}
				}
			}
		} catch (e) {
			oerr('[Orchestrator] Scenario 2b container proposal lookup failed:', e);
		}
	}

	olog(
		`[Orchestrator] Debug -> digit: "${digit}", intent: "${intent}", sub_intent: "${sub_intent}"`
	);

	// Engagement score: a sales/booking message is a hot opportunity; an emergency is urgent
	// and high-value to retain. Billing (already a paying customer) and plain support don't move it.
	const scoreDelta = messageCategory === 'emergency' ? 25 : messageCategory === 'sales' ? 10 : 0;
	if (scoreDelta > 0) {
		await prisma.contact.update({
			where: { id: customer.id },
			data: { engagementScore: { increment: scoreDelta } }
		});
		olog(`[Orchestrator] Engagement score +${scoreDelta} (${messageCategory}).`);
	}

	// --- BOOKED (Scenario 2 "yes"): short-circuit with the booking confirmation ---
	if (bookedConfirmation) {
		draftedResponse = bookedConfirmation;
		scenarioLocked = true; // it's confirmed — don't let the conversational override rewrite it
	}
	// --- NO CUSTOMER MESSAGE: they hung up before leaving a voicemail ---
	// There is nothing to reply TO, so we must not ask the AI to try. Acknowledge the missed call
	// honestly and invite them to say what they need — never pretend to have heard something.
	else if (!hasCustomerMessage) {
		olog(
			'[Orchestrator] No customer message (call metadata only) — using the missed-call acknowledgement.'
		);
		const dept = digitCategory ? ` about ${digitCategory}` : '';
		draftedResponse = `Hi${customer.name ? ` ${customer.name}` : ''}, sorry we missed your call${dept} just now. Reply here with what you need and we'll help, or we'll call you back shortly. — ${company.name || 'our team'}`;
		metadata.no_customer_message = true;
		scenarioLocked = true; // nothing for the conversational/agentic reply to work with
	}
	// --- EMERGENCY: always wins, regardless of the digit pressed ---
	else if (messageCategory === 'emergency') {
		olog('[Orchestrator] EMERGENCY detected from the message — overriding IVR routing.');
		// Fall back to the CURATED emergency copy (the same safety-reviewed library the automated
		// telemetry SMS uses) rather than a bare acknowledgement, so the customer still gets the
		// real mitigation advice — "turn off the main water supply", "move valuables and put a
		// bucket under the drip" — matched to the type of emergency they described.
		const { emergencyAdvice } = await import('./emergency-templates');
		const advice = emergencyAdvice({
			text: rawMessage,
			name: customer.name,
			brand: company.name || undefined
		});
		const template = advice.message;
		metadata.emergency_type = advice.type;
		olog(`[Orchestrator] Emergency type classified as "${advice.type}".`);
		try {
			// Urgent ack + a SAFE, business-flexible self-mitigation tip while help is on the way.
			const { draftConversationalReply } = await import('./conversation');
			const conv = await draftConversationalReply({
				message: rawMessage,
				history: [],
				companyName: company.name || 'us',
				customerName: customer.name || null,
				locations: (company as any).locations || [],
				emergency: true,
				apiKey: ANTHROPIC_AI_KEY
			});
			draftedResponse = conv?.reply || template;
		} catch (e) {
			oerr('[Orchestrator] Emergency reply failed, using template:', e);
			draftedResponse = template;
		}
	}

	// --- SCENARIO 1: BILLING (only when the MESSAGE is actually about billing) ---
	else if (messageCategory === 'billing') {
		olog('[Orchestrator] Detected Scenario 1: Billing');
		const balance = await resolveBalanceByPhone(
			company.id,
			customer.phone || commLog.source,
			customer.accountBalance
		);
		olog(
			`[Orchestrator] Balance resolved: ${
				balance === null || balance === undefined
					? 'none on file'
					: '$' + Number(balance).toFixed(2)
			}.`
		);
		// Only STATE the balance when the customer actually asks for it (or asks to be emailed it).
		// For other billing messages ("I'll come pay tomorrow"), fall through to a conversational ack
		// instead of parroting the balance back.
		const asksForBalance =
			!!aiIntent?.wants_balance ||
			wantsEmailedBalance(rawMessage) ||
			/\b(balance|owe|owing|how much|statement|invoice)\b/i.test(rawMessage);
		olog(
			`[Orchestrator] Billing: customer ${
				asksForBalance
					? 'is asking for their balance'
					: 'is not asking for the balance — replying conversationally'
			}.`
		);

		if (asksForBalance) {
			if (balance === null || balance === undefined || balance === 0) {
				// No balance on file / paid up — tell them, don't punt to "an agent will review".
				olog('[Orchestrator] Billing: no outstanding balance — informing the customer.');
				draftedResponse = `Hi ${customer.name || 'there'}, good news — you have no outstanding balance on your account. Thank you!`;
				scenarioLocked = true;
			} else if (customer.email && wantsEmailedBalance(rawMessage)) {
				olog('[Orchestrator] Billing: emailing the balance statement.');
				const em = buildBalanceEmail({
					customerName: customer.name,
					balance,
					companyName: company.name
				});
				draftedResponse = em.htmlContent;
				draftChannel = 'email';
				emailSubject = em.subject;
				scenarioLocked = true;
			} else {
				olog('[Orchestrator] Billing: texting the outstanding balance.');
				draftedResponse = `You currently owe $${balance.toFixed(2)}. Thank you for your business!`;
				scenarioLocked = true;
			}
		}
		// else: not a balance request — leave draftedResponse empty so the conversational reply
		// below acknowledges it naturally ("Great, see you tomorrow!").
	}

	// --- SCENARIO 2: SALES / BOOKING (message is about sales/booking) ---
	else if (messageCategory === 'sales' || String(metadata.ai_intent).toLowerCase() === 'sales') {
		olog(
			'[Orchestrator] Detected Scenario 2: Sales / Booking Request, initiating Confirmation Loop...'
		);
		scenarioLocked = true;
		// A booking draft may only be created from an EXPLICIT, parseable date the customer
		// named. Vague mentions ("sometime next week") or garbage strings fall through to the
		// "what day and time works best" reply below — never draft an appointment from a guess.
		const bookingDatetime = datetime ? new Date(datetime) : null;
		const hasExplicitDatetime = !!bookingDatetime && !isNaN(bookingDatetime.getTime());
		if (hasExplicitDatetime) {
			const { processSalesVoicemailBooking } = await import('./scenarios/s4-sms-booking');

			// Stubbed resources since this is a platform-agnostic setup
			const availableResources = {
				personnel: ['u_sales_owner'],
				assets: ['asset_1']
			};

			let hour = 10;
			let minute = 0;
			let transcriptWeekday = 'Wednesday';
			try {
				const dt = new Date(datetime);
				if (!isNaN(dt.getTime())) {
					hour = dt.getHours();
					minute = dt.getMinutes();
					transcriptWeekday = dt.toLocaleDateString('en-US', { weekday: 'long' });
				}
			} catch (e) {}

			let container = await prisma.commContainer.findFirst({
				where: {
					companyId: company.id,
					OR: [
						...(pipelineCustomerProfileId
							? [{ customerProfileId: pipelineCustomerProfileId }]
							: []),
						{ contactId: customer.id }
					],
					state: { not: 'closed' }
				},
				orderBy: { openedAt: 'desc' }
			});

			// Cross-channel continuation: run the AI resolver EVEN WHEN a local container exists — the
			// ProfileDB pipeline pre-creates a fresh container per message, so the findFirst above
			// almost always returns that new one. We exclude it so the AI can instead match an EARLIER
			// conversation on another channel/identity (we emailed studioblopp@…, they text back
			// "Monday works for the furnace") and link both legs into ONE comm id.
			try {
				const { resolveContextContainer } = await import('./container/thread-resolver');
				const res = await resolveContextContainer({
					companyId: company.id,
					contactId: customer.id,
					customerProfileId: pipelineCustomerProfileId || null,
					phone: customerPhone || null,
					email: customer.email || null,
					channel: commLog.type === 'sms' ? 'sms' : commLog.type === 'email' ? 'email' : 'voice',
					direction: 'inbound',
					subject: commLog.summary || ((commLog.metadata as any)?.subject ?? null),
					content: rawMessage,
					occurredAt: commLog.created,
					excludeCommIds: container ? [container.id] : [],
					callerContactId: customer.id,
					callerCustomerProfileId: pipelineCustomerProfileId || null
				});
				if (res.matched && res.commId && res.commId !== container?.id) {
					const matched = await prisma.commContainer.findUnique({ where: { id: res.commId } });
					if (matched) {
						container = matched;
						olog(
							`[Orchestrator] Booking linked to existing conversation ${matched.commRef} (${res.reason}).`
						);

						// The matcher just concluded this message and that container are the same
						// conversation — i.e. the same person behind two different identifiers. Feed
						// that into profile identity so the email profile and phone profile merge.
						try {
							const { bridgeIdentitiesForMatchedContainer } =
								await import('./container/identity-bridge');
							const bridged = await bridgeIdentitiesForMatchedContainer({
								companyId: company.id,
								containerId: matched.id,
								confidence: res.confidence,
								phone: customerPhone || null,
								email: customer.email || null,
								log: olog
							});
							if (!bridged.merged) olog(`[IdentityBridge] No merge: ${bridged.reason}.`);
						} catch (e) {
							oerr('[IdentityBridge] Profile merge failed (link kept):', e);
						}
					}
				} else {
					// Say WHY on every path — a silent no-match here is indistinguishable from the
					// resolver never running, which has cost real debugging time.
					olog(
						`[Orchestrator] Booking cross-channel: no link (${res.reason || 'no_reason'}); ` +
							`${res.candidates.length} candidate(s) considered` +
							(res.candidates.length ? `: ${res.candidates.map((c) => c.commRef).join(', ')}` : '')
					);
				}
			} catch (e) {
				oerr('[Orchestrator] cross-channel resolve failed:', e);
			}

			if (!container) {
				const { createContainerAtIntake } = await import('$lib/server/container/container-service');
				const createResult = await createContainerAtIntake(prisma, {
					companyId: company.id,
					customerProfileId: pipelineCustomerProfileId || null,
					contactId: customer.id,
					threadType: 'sales'
				});
				container = createResult.container;
			}
			// A container was either found or just created — the sales flow cannot proceed without
			// one (createContainerAtIntake always succeeds with a contact on file).
			container = container!;

			// Group the inbound message under the SAME container ref as the drafts, so the whole
			// conversation shares one comm id in the UI. Go through the shared linker rather than
			// writing the fields here: commCode() keys off metadata.commRef FIRST and only falls
			// back to the thread id, so a row linked without a commRef hashes the container's cuid
			// while the email leg hashes the commRef string — same container, two different COM ids.
			// This branch returns early below, so it must do its own linking.
			try {
				metadata.commId = container.id;
				metadata.commContainerId = container.id;
				metadata.commRef = container.commRef;

				const { linkCommunicationLogToContainer } = await import('./container/thread-resolver');
				await linkCommunicationLogToContainer(
					commLog.id,
					{ id: container.id, commRef: container.commRef },
					'booking_container_link',
					{ companyId: company.id, contactId: customer.id }
				);

				// Mirror the linker's audit trail in memory: the booking branch persists
				// `{ ...metadata }` further down, which would otherwise clobber it.
				metadata.thread_merge = {
					previousThreadId: commLog.communicationThreadId || null,
					mergedInto: container.id,
					mergedIntoRef: container.commRef,
					reason: 'booking_container_link',
					mergedAt: new Date().toISOString()
				};

				// Update our local reference so any fall-through logic uses the right ID
				commLog.communicationThreadId = container.id;
			} catch (e) {
				oerr('[Orchestrator] Failed to link inbound log to container:', e);
			}

			const bookingResult = await processSalesVoicemailBooking({
				commId: container.id,
				companyId: company.id,
				customerProfileId: pipelineCustomerProfileId || customer.id,
				customerPhone: customerPhone,
				isLandline: false,
				transcriptWeekday,
				hour,
				minute,
				productInterest: aiIntent?.sub_intent || 'product/service',
				callStartTime: new Date(),
				availableResources,
				requestedContactMethod: metadata.requested_contact_method as string | undefined,
				aiExtractedEmail: metadata.ai_extracted_email as string | undefined,
				now: new Date()
			});

			if (bookingResult.smsDrafted && bookingResult.approval) {
				const isEmailDraft = bookingResult.approval.draftType === 'email';
				// Pull the "Subject:" line out of the draft so the confirm step emails a real subject
				// (and not the generic "Booking Confirmation Approval" summary), and so the line
				// itself never ships as the first thing the customer reads.
				const bookingSplit = splitDraftSubject(bookingResult.approval.draftContent);
				const draftSubject = bookingSplit.subject || undefined;
				const bookingDraftBody = isEmailDraft
					? bookingSplit.body || bookingResult.approval.draftContent
					: bookingResult.approval.draftContent;
				await logCommunication({
					type: (bookingResult.approval.draftType || 'sms') as any,
					direction: 'outbound',
					status: 'pending_approval',
					thread_id: commLog.communicationThreadId || commId,
					// Source is the company's own Gmail address (who the email is FROM); the
					// destination is the customer's email (who it goes TO).
					source: isEmailDraft
						? companyEmail || metadata.ai_extracted_email || customer.email || customerPhone
						: companyNumber,
					destination: isEmailDraft
						? metadata.ai_extracted_email || customer.email || customerPhone
						: customerPhone,
					company_id: company.id,
					customer_id: customer.id,
					summary: draftSubject || 'Booking Confirmation Approval',
					content: bookingDraftBody,
					metadata: {
						// Real CommContainer id (NOT the thread id) so the confirm step can cancel the
						// hold_expiry timer, and the hold id so it can flip tentative → booked + create
						// the calendar event. Without these the /communication-log "Confirm" was a no-op.
						commId: container.id,
						// commCode() keys off commRef first and only falls back to the thread id, so
						// without these the draft hashes the container's cuid while the inbound leg
						// hashes the "#5233" ref — one container, two COM ids in the UI.
						commContainerId: container.id,
						commRef: container.commRef,
						holdId: bookingResult.hold?.id,
						proposedDate: bookingResult.hold?.startTime
							? new Date(bookingResult.hold.startTime).toISOString()
							: metadata.datetime || undefined,
						extractedEmail: isEmailDraft ? metadata.ai_extracted_email || undefined : undefined,
						subject: draftSubject,
						is_draft: true,
						orchestrator_draft: true,
						trigger_comm_id: commId,
						message_category: messageCategory || null
					}
				});
			}

			// Finalize the rep-facing side of the booking before exiting: the bottom-of-function
			// action items + create_task dispatch + metadata write would otherwise be skipped by
			// the early return, leaving the inbound message with no tasks and no orchestrator logs.
			const bookingTasks: string[] = Array.isArray(aiIntent?.action_items)
				? [...aiIntent.action_items]
				: [];
			if (bookingResult.explicitDateText) {
				bookingTasks.push(`Approve the ${bookingResult.explicitDateText} appointment`);
			}
			if (!bookingTasks.length) {
				bookingTasks.push(`Review and follow up with ${customer.name || 'the customer'}`);
			}
			metadata.actionItems = Array.from(new Set(bookingTasks));

			try {
				const { createTask } = await import('$lib/server/container/container-service');
				for (const item of metadata.actionItems) {
					await createTask(prisma, {
						commId: container.id,
						description: item,
						ownerUserId: 'u_sales_owner',
						due: new Date(Date.now() + 24 * 3600 * 1000),
						category: 'internal_followup'
					});
				}
				olog(
					`[Orchestrator] Created ${metadata.actionItems.length} booking task(s) on container ${container.id}.`
				);
			} catch (taskErr) {
				oerr('[Orchestrator] Failed to create booking tasks:', taskErr);
			}

			try {
				await prisma.communicationLog.update({
					where: { id: commId },
					data: {
						metadata: {
							...metadata,
							orchestrator_logs: orchestratorLogs,
							orchestrator_processed: true
						}
					}
				});
			} catch (err) {
				oerr('[Orchestrator] Failed to mark booking message as processed:', err);
			}

			return; // Exit early because the draft was logged
		} else {
			// Non-booking sales: always draft via Claude (order-taker prompt).
			// Never fall back to a hardcoded template — templates produce generic
			// "What day and time works best?" replies that don't match what the
			// customer actually said.
			if (ANTHROPIC_AI_KEY) {
				try {
					const { getOrderTakerSystemPrompt } = await import('./pipeline/ai-review-reply');
					const { claudeText } = await import('./anthropic');
					const isEmail = commLog.type === 'email';
					const prompt = isEmail
						? `Write a reply to this customer email on behalf of the business. Acknowledge what the customer said and confirm the business is ready to help. If the customer said they will call or follow up themselves, acknowledge that instead of asking for anything. Start the reply with a plain "Subject: ..." line — no markdown, no asterisks, no bold — then a blank line, then the message. Sign off with the business name.\n\nCustomer name: ${customer.displayName || customer.name || 'there'}\nEmail subject: ${commLog.summary || ''}\nOriginal email from customer:\n${rawMessage}`
						: `Write a short SMS reply to this customer message on behalf of the business. Acknowledge what the customer said and confirm the business is ready to help. If the customer said they will call or follow up themselves, acknowledge that instead of asking for anything.\n\nCustomer name: ${customer.displayName || customer.name || 'there'}\nOriginal message from customer:\n${rawMessage}`;

					const aiResponse = await claudeText({
						apiKey: ANTHROPIC_AI_KEY,
						system: getOrderTakerSystemPrompt(
							company.name || 'the business',
							'professional_friendly'
						),
						messages: [{ role: 'user', content: prompt }],
						temperature: 0.3,
						maxTokens: 400
					});
					if (aiResponse) {
						draftedResponse = aiResponse.trim();
					} else {
						olog('[Orchestrator] Claude returned null — using minimal contextual fallback.');
						draftedResponse = `Hi ${customer.displayName || customer.name || 'there'}, thanks for reaching out to ${company.name || 'us'}. We got your message and someone from our team will follow up with you shortly.`;
					}
				} catch (err) {
					oerr('[Orchestrator] Claude draft generation failed:', err);
					draftedResponse = `Hi ${customer.displayName || customer.name || 'there'}, thanks for reaching out to ${company.name || 'us'}. We got your message and someone from our team will follow up with you shortly.`;
				}
			} else {
				draftedResponse = `Hi ${customer.displayName || customer.name || 'there'}, thanks for reaching out to ${company.name || 'us'}. We got your message and someone from our team will follow up with you shortly.`;
			}
		}
	}

	// --- SUPPORT (default — and where reclassified non-billing/non-sales calls land) ---
	else {
		olog('[Orchestrator] Detected Support request.');
		// Contextual support draft via Claude — never hardcode a template here.
		if (ANTHROPIC_AI_KEY) {
			try {
				const { getOrderTakerSystemPrompt } = await import('./pipeline/ai-review-reply');
				const { claudeText } = await import('./anthropic');
				const isEmail = commLog.type === 'email';
				const supportPrompt = isEmail
					? `Write a reply to this customer support email on behalf of the business. Acknowledge what the customer said with empathy and confirm someone will follow up. If they described a complaint, show understanding without being defensive. Start the reply with a plain "Subject: ..." line — no markdown, no asterisks, no bold — then a blank line, then the message. Sign off with the business name.\n\nCustomer name: ${customer.name || 'there'}\nEmail subject: ${commLog.summary || ''}\nOriginal email from customer:\n${rawMessage}`
					: `Write a short SMS reply to this customer support message on behalf of the business. Acknowledge what the customer said with empathy and confirm someone will follow up. If they described a complaint, show understanding without being defensive.\n\nCustomer name: ${customer.name || 'there'}\nOriginal message from customer:\n${rawMessage}`;

				const aiResponse = await claudeText({
					apiKey: ANTHROPIC_AI_KEY,
					system: getOrderTakerSystemPrompt(
						company.name || 'the business',
						'professional_friendly'
					),
					messages: [{ role: 'user', content: supportPrompt }],
					temperature: 0.3,
					maxTokens: 400
				});
				draftedResponse = aiResponse
					? aiResponse.trim()
					: `Hi ${customer.name || 'there'}, thanks for reaching out to ${company.name || 'us'}. We got your message and someone from our team will follow up with you shortly.`;
			} catch (err) {
				oerr('[Orchestrator] Support Claude draft failed:', err);
				draftedResponse = `Hi ${customer.name || 'there'}, thanks for reaching out to ${company.name || 'us'}. We got your message and someone from our team will follow up with you shortly.`;
			}
		} else {
			draftedResponse = `Hi ${customer.name || 'there'}, thanks for reaching out to ${company.name || 'us'}. We got your message and someone from our team will follow up with you shortly.`;
		}

		// Scenario 1: Support Call Calendar Verification
		if (aiIntent?.wants_appointment) {
			olog(
				'[Orchestrator] Support call requested a meeting. Triggering Scenario 1 Verification...'
			);
			// Calendar verification needs an EXPLICIT datetime the customer named. Without one
			// (e.g. "I'd like to come in sometime") the hardcoded Wednesday/10:00 defaults would
			// check a made-up slot — fall through and ask for a day/time instead.
			const meetingDatetime = datetime ? new Date(datetime) : null;
			const hasExplicitMeetingDatetime = !!meetingDatetime && !isNaN(meetingDatetime.getTime());
			if (!hasExplicitMeetingDatetime) {
				olog(
					'[Orchestrator] Support meeting requested without an explicit datetime — asking for day/time.'
				);
				// No explicit datetime given — ask politely. This is the ONE case
				// where asking a question is valid (they asked for an appointment
				// but didn't say when).
				draftedResponse = `Hi ${customer.name || 'there'}, we'd love to get that set up for you! Could you let us know what day and time works best?`;
			} else {
				try {
					const { processSupportCallMeetingConfirmation } =
						await import('./scenarios/s1-meeting-confirm');

					let hour = 10;
					let minute = 0;
					let transcriptWeekday = 'Wednesday';
					if (datetime) {
						try {
							const dt = new Date(datetime);
							if (!isNaN(dt.getTime())) {
								hour = dt.getHours();
								minute = dt.getMinutes();
								transcriptWeekday = dt.toLocaleDateString('en-US', { weekday: 'long' });
							}
						} catch (e) {}
					}

					// Look for email in message (or rely on AI extraction)
					const emailMatch = rawMessage.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
					const targetEmail = emailMatch
						? emailMatch[0]
						: (aiIntent as any)?.email ||
							metadata.ai_extracted_email ||
							customer.email ||
							undefined;

					// Fetch ALL upcoming calendar events (don't pre-filter by customer, so we catch manually added events)
					const { getUpcomingAppointments } = await import('$lib/server/google-calendar');
					const rawAppts = await getUpcomingAppointments(company.id, 7);

					const realCalendarEntries = rawAppts.map((a) => ({
						id: a.id,
						title: a.summary || 'Appointment',
						startTime: new Date(a.start?.dateTime || a.start?.date),
						attendees: (a.attendees || []).map((att: any) => att.email)
					}));

					let supportContainer = await prisma.commContainer.findFirst({
						where: {
							companyId: company.id,
							OR: [
								...(pipelineCustomerProfileId
									? [{ customerProfileId: pipelineCustomerProfileId }]
									: []),
								{ contactId: customer.id }
							],
							state: { not: 'closed' }
						},
						orderBy: { openedAt: 'desc' }
					});

					// Cross-channel continuation: run even when a local container exists (the pipeline
					// pre-creates one per message), excluding it so the AI can match an EARLIER
					// conversation on another channel and link both legs into ONE comm id.
					try {
						const { resolveContextContainer } = await import('./container/thread-resolver');
						const res = await resolveContextContainer({
							companyId: company.id,
							contactId: customer.id,
							customerProfileId: pipelineCustomerProfileId || null,
							phone: customerPhone || null,
							email: customer.email || targetEmail || null,
							channel:
								commLog.type === 'sms' ? 'sms' : commLog.type === 'email' ? 'email' : 'voice',
							direction: 'inbound',
							subject: commLog.summary || ((commLog.metadata as any)?.subject ?? null),
							content: rawMessage,
							occurredAt: commLog.created,
							excludeCommIds: supportContainer ? [supportContainer.id] : [],
							callerContactId: customer.id,
							callerCustomerProfileId: pipelineCustomerProfileId || null
						});
						if (res.matched && res.commId && res.commId !== supportContainer?.id) {
							const matched = await prisma.commContainer.findUnique({ where: { id: res.commId } });
							if (matched) {
								supportContainer = matched;
								olog(
									`[Orchestrator] Support linked to existing conversation ${matched.commRef} (${res.reason}).`
								);

								// The matcher just concluded this message and that container are the same
								// conversation — i.e. the same person behind two different identifiers. Feed
								// that into profile identity so the email profile and phone profile merge.
								try {
									const { bridgeIdentitiesForMatchedContainer } =
										await import('./container/identity-bridge');
									const bridged = await bridgeIdentitiesForMatchedContainer({
										companyId: company.id,
										containerId: matched.id,
										confidence: res.confidence,
										phone: customerPhone || null,
										email: customer.email || null,
										log: olog
									});
									if (!bridged.merged) olog(`[IdentityBridge] No merge: ${bridged.reason}.`);
								} catch (e) {
									oerr('[IdentityBridge] Profile merge failed (link kept):', e);
								}
							}
						} else {
							olog(
								`[Orchestrator] Support cross-channel: no link (${res.reason || 'no_reason'}); ` +
									`${res.candidates.length} candidate(s) considered` +
									(res.candidates.length
										? `: ${res.candidates.map((c) => c.commRef).join(', ')}`
										: '')
							);
						}
					} catch (e) {
						oerr('[Orchestrator] cross-channel resolve failed:', e);
					}

					if (!supportContainer) {
						const { createContainerAtIntake } =
							await import('$lib/server/container/container-service');
						const createResult = await createContainerAtIntake(prisma, {
							companyId: company.id,
							customerProfileId: pipelineCustomerProfileId || null,
							contactId: customer.id,
							threadType: 'general'
						});
						supportContainer = createResult.container;
					}

					const result = await processSupportCallMeetingConfirmation({
						commId: supportContainer!.id,
						companyId: company.id,
						customerProfileId: pipelineCustomerProfileId || undefined,
						contactId: customer.id,
						customerName: customer.name || undefined,
						repEnteredEmail: undefined,
						aiExtractedEmail: targetEmail,
						transcriptWeekday,
						transcriptDateStr: undefined,
						transcriptHour: hour,
						transcriptMinute: minute,
						callStartTime: new Date(),
						calendarEntries: realCalendarEntries,
						hasMeetingSignal: true,
						now: new Date()
					});

					if (result.draftCreated && result.approval) {
						olog('[Orchestrator] Scenario 1: Calendar verified, drafting email.');
						draftChannel = 'email';
						if (targetEmail) {
							emailSubject = 'Meeting Confirmation';
							draftedResponse = result.approval.draftContent;
							scenarioLocked = true;
						}
					} else if (result.blocked) {
						olog(`[Orchestrator] Scenario 1 Verification Blocked: ${result.reason}`);
					} else if (result.inGracePeriod) {
						olog(`[Orchestrator] Scenario 1: Meeting not found, started grace period timer.`);

						await logCommunication({
							type: 'voice',
							direction: 'outbound',
							status: 'pending',
							source: 'System',
							destination: customer.name || customerPhone,
							company_id: company.id,
							customer_id: customer.id,
							summary: `Waiting for Calendar Verification (15m)`,
							content: `System checked calendar for ${transcriptWeekday} at ${hour}:${minute.toString().padStart(2, '0')} but found no matching event. Waiting 15 minutes for representative to add it before failing.`,
							metadata: {
								is_system_note: true,
								commId: commLog.communicationThreadId || commId,
								commContainerId: metadata.commContainerId || undefined,
								commRef: metadata.commRef || undefined,
								thread_id: customerPhone,
								message_category: 'support',
								waiting_for_calendar: true,
								timer_due_at: new Date(Date.now() + 15 * 60 * 1000).toISOString()
							}
						});

						// Don't draft a response yet, the timer will handle it
						draftedResponse = '';
						scenarioLocked = true;
						skipSafetyNet = true;
					}
				} catch (e) {
					oerr('[Orchestrator] Scenario 1 execution failed:', e);
				}
			}
		}
	}

	// If this caller has prior cross-channel history (past calls OR SMS), make the reply
	// conversational and context-aware — carrying the earlier thread into this new call —
	// instead of the first-touch scenario template above. (Emergencies keep the urgent template.)
	// Action items for the rep — the AI's suggestions plus scenario-specific tasks; never empty.
	// A booking confirmation supersedes the AI's generic "clarify the request" items — it's booked.
	// The AI's raw action_items are suggestions, not orders: they promise quotes we
	// have no specifications to price, and they chase customers who told us they
	// would make the next contact themselves. deriveNextActionPlan applies those
	// two rules before anything becomes a task.
	const nextActionPlan = deriveNextActionPlan(aiIntent, customer.name || 'the customer');
	metadata.next_action_owner = nextActionPlan.owner;
	metadata.intake_required = nextActionPlan.intakeRequired;
	for (const { task, reason } of nextActionPlan.dropped) {
		olog(`[Orchestrator] Dropped AI task "${task}" — ${reason}.`);
	}
	if (nextActionPlan.owner === 'customer') {
		olog(
			`[Orchestrator] Next move belongs to ${customer.name || 'the customer'} — holding, not chasing.`
		);
	}

	const tasks: string[] = metadata.appointment_booked ? [] : [...nextActionPlan.tasks];
	if (metadata.appointment_booked) {
		const when = (metadata.appointment_booked as any)?.when;
		const whenLabel = when ? formatDatetime(when) : 'booked';
		tasks.push(`Confirm the ${whenLabel} appointment with the assigned rep`);
		if ((metadata.appointment_booked as any)?.manual)
			tasks.push('Add the appointment to the calendar manually (calendar sync was unavailable)');
	}
	if (messageCategory === 'billing')
		tasks.push(`Review & send the account balance to ${customer.name || 'the customer'}`);
	if (proposedAppointment) tasks.push('Approve the proposed appointment time');
	// Only when they actually asked us to call — a customer who said "I'll call you"
	// gets a hold task from the plan above instead.
	if (aiIntent?.wants_callback && nextActionPlan.owner === 'business')
		tasks.push(`Call ${customer.name || 'the customer'} back`);
	if (!tasks.length) tasks.push(`Review and follow up with ${customer.name || 'the customer'}`);
	metadata.actionItems = Array.from(new Set(tasks));

	// If the customer asked to be CALLED (not texted), Confirm should place a call instead of
	// sending the drafted SMS. Dial the number they LEFT in the message if there is one — they may
	// be calling from a blocked/borrowed line — otherwise the number they contacted us from.
	if (aiIntent?.wants_callback) {
		// `commLog.source` is the channel they arrived on — an email address on the
		// email channel. Routing that to Confirm produced a "Confirm call" button
		// that could only ever fail ("No callback number available to dial") and
		// left the drafted reply unsent. Only switch Confirm to a call when we have
		// something actually dialable; otherwise Confirm keeps sending the draft.
		const candidate = extractCallbackNumber(rawMessage) || customerPhone || commLog.source || null;
		const normalized = candidate ? normalizePhoneNumber(candidate) : '';
		// normalizePhoneNumber only strips non-digits, so "sam123@x.com" would come
		// back as "123". Require a real subscriber-length number.
		const dialable = normalized.replace(/\D/g, '').length >= 10 ? normalized : null;
		if (dialable) {
			metadata.confirm_action = 'call';
			metadata.callback_number = dialable;
			olog(`[Orchestrator] Customer wants a callback — Confirm will CALL ${dialable}.`);
		} else {
			olog(
				`[Orchestrator] Customer wants a callback but left no phone number — Confirm will send the ${draftChannel} draft instead. A task covers the call.`
			);
		}
	}

	// Generate a conversational/agentic reply for anything that isn't a LOCKED scenario draft
	// (emergency template, billing balance/email, or a sales appointment proposal). This also
	// covers billing messages that aren't balance requests, e.g. "I'll come pay tomorrow".
	if (messageCategory !== 'emergency' && !scenarioLocked && !proposedAppointment) {
		olog('[Orchestrator] Generating a conversational reply (no locked scenario draft).');
		try {
			const last10 = (p: string | null | undefined) => (p || '').replace(/\D/g, '').slice(-10);
			// The caller's own number: source for inbound, destination for dialer outbound
			// (source is the company's number there).
			const callerDigits = last10(isDialerOutbound ? commLog.destination : commLog.source);
			if (callerDigits) {
				const recent = await prisma.communicationLog.findMany({
					where: {
						companyId: commLog.companyId,
						id: { not: commId },
						created: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
					},
					orderBy: { created: 'asc' },
					take: 100
				});
				const history = recent
					.filter(
						(l) => last10(l.source) === callerDigits || last10(l.destination) === callerDigits
					)
					.map((l) => {
						const m = (l.metadata as any) || {};
						const isVoice = l.type === 'voice';
						const body = isVoice ? l.content || l.summary || m.summary || '' : l.content || '';
						const prefix = isVoice ? (l.direction === 'inbound' ? '[Voicemail] ' : '[Call] ') : '';
						return {
							from: (l.direction === 'inbound' ? 'customer' : 'business') as
								| 'customer'
								| 'business',
							text: `${prefix}${body}`.trim()
						};
					})
					.filter((t) => t.text);
				// Reschedule request, or a plain appointment-history question?
				const asksReschedule =
					/reschedul/i.test(rawMessage) ||
					(/\b(move|change|switch|push)\b/i.test(rawMessage) &&
						/\b(appointment|appt|booking|it|that|time)\b/i.test(rawMessage));
				const asksAppointments =
					/\b(appointment|appt|last (time|appointment|visit)|when .*(was|were|is|are|scheduled|booked)|history|scheduled|booked|come out|came out|visit|next (appointment|appt|visit))\b/i.test(
						rawMessage
					);
				// "what times are you free/available/open on Monday?", "any availability Tuesday?"
				const asksAvailability =
					/\b(availab|what times|which times|what time.*(open|free|available)|when are you (open|free|available)|any (openings|slots|times)|free on|open on|slots? (on|for))\b/i.test(
						rawMessage
					);

				// Reply whenever this is a returning caller, an explicit support message, or a
				// scheduling / account ask. The AI itself then decides which real data it needs.
				// Always generate a contextual agentic reply for emails (even
				// first-contact), returning callers, support, and scheduling asks.
				// This overwrites any template that was set earlier with a reply
				// grounded in real data (appointments, account, availability).
				if (
					history.length > 0 ||
					messageCategory === 'support' ||
					commLog.type === 'email' ||
					asksReschedule ||
					asksAppointments ||
					asksAvailability
				) {
					const locations = (company as any).locations || [];
					// Self-service link: pasted Appointment Schedule link, or our booking page when
					// Google Calendar is connected — the customer picks a slot from live availability.
					const bookingLink =
						getBookingUrl(company) || (await getBookingLinkIfConnected(company.id));
					const gconn = await getConnectionInfo(company.id);
					// Match by phone (the number they called/texted from — reliable), then email, then name.
					const ident = {
						phone: customer.phone || commLog.source,
						email: customer.email,
						name: customer.name
					};

					// PRIMARY: let the AI complete the request itself using real data-lookup skills
					// (account summary, appointments, availability, reschedule, booking link, business
					// info). It calls only what the message needs and grounds the reply in the results.
					let draft: string | null = null;
					try {
						const { draftAgenticReply } = await import('./reply-skills');
						draft = await draftAgenticReply({
							companyId: company.id,
							companyName: company.name || 'us',
							locations,
							website: company.website,
							customerName: customer.name || null,
							customerPhone: customer.phone || commLog.source,
							customerEmail: customer.email,
							message: commLog.content || rawMessage,
							history,
							bookingUrl: bookingLink,
							connected: gconn.connected,
							knownBalance: await resolveBalanceByPhone(
								company.id,
								customer.phone || commLog.source,
								customer.accountBalance
							),
							apiKey: ANTHROPIC_AI_KEY
						});
					} catch (agErr) {
						oerr('[Orchestrator] Agentic reply failed; using fact-based fallback:', agErr);
					}

					if (draft) {
						draftedResponse = draft;
						olog('[Orchestrator] Agentic skill reply.');
					} else {
						// FALLBACK: keyword-gated fact assembly → fact-based conversational reply.
						let appointments: { startISO: string; title: string; isPast: boolean }[] | undefined;
						let reschedule: RescheduleResult | undefined;
						let availableSlots: { label: string; slots: { label: string }[] }[] | undefined;
						let openHoursNote: string | null | undefined;
						if (asksReschedule && gconn.connected) {
							reschedule = await resolveReschedule(company.id, { message: rawMessage, ...ident });
						} else if (asksAvailability) {
							// Resolve explicit weekdays AND relative words ("today"/"tomorrow") to concrete
							// weekday names, so "what time do you open tomorrow?" gets tomorrow's exact hours.
							const named = resolveNamedDays(rawMessage);
							// Business-hours answer as a safety net (used when disconnected, or if the live
							// lookup fails / returns nothing) so an availability question is never unanswered.
							openHoursNote = describeDayHours(locations, named);
							if (gconn.connected) {
								try {
									const allSlots = await getAvailableSlots(company.id, { locations, days: 14 });
									const filtered =
										named.length > 0
											? allSlots.filter((d) =>
													named.some((n) => new RegExp(`\\b${n}\\b`, 'i').test(d.label))
												)
											: allSlots.slice(0, 3);
									const nonEmpty = filtered.filter((d) => d.slots.length > 0);
									// Empty can mean "fully booked" OR "freeBusy hiccup" — don't over-claim.
									if (nonEmpty.length > 0) availableSlots = nonEmpty;
								} catch (slotErr) {
									console.warn(
										'[Orchestrator] Live availability lookup failed; using business hours:',
										slotErr
									);
								}
							}
						} else if (asksAppointments && gconn.connected) {
							appointments = await getCustomerAppointments(company.id, ident);
						}

						const { draftConversationalReply } = await import('./conversation');
						const conv = await draftConversationalReply({
							message: commLog.content || rawMessage,
							history,
							companyName: company.name || 'us',
							customerName: customer.name || null,
							customerPhone: customer.phone || commLog.source,
							locations,
							accountBalance: await resolveBalanceByPhone(
								company.id,
								customer.phone || commLog.source,
								customer.accountBalance
							),
							bookingUrl: bookingLink,
							appointments,
							reschedule,
							availableSlots,
							openHoursNote,
							businessInfo: {
								website: company.website,
								address: describeLocations(locations)
							},
							apiKey: ANTHROPIC_AI_KEY
						});
						if (conv?.reply) {
							draftedResponse = conv.reply;
							olog('[Orchestrator] Fact-based reply (fallback).');
						}
					}
				}
			}
		} catch (e) {
			oerr('[Orchestrator] Conversational override failed:', e);
		}
	}

	// Safety net: never leave a non-emergency inbound without a drafted reply.
	// Try Claude first so even the safety net produces a contextual response.
	if (!draftedResponse && messageCategory !== 'emergency' && !skipSafetyNet) {
		olog('[Orchestrator] No draft produced upstream — safety net generating contextual reply.');
		if (ANTHROPIC_AI_KEY) {
			try {
				const { getOrderTakerSystemPrompt } = await import('./pipeline/ai-review-reply');
				const { claudeText } = await import('./anthropic');
				const safetyPrompt =
					commLog.type === 'email'
						? `Write a brief reply to this customer email. Acknowledge what they said and confirm the business will follow up. Start the reply with a plain "Subject: ..." line — no markdown, no asterisks, no bold — then a blank line, then the message. Sign off with the business name.\n\nCustomer name: ${customer.name || 'there'}\nEmail subject: ${commLog.summary || ''}\nOriginal email:\n${rawMessage}`
						: `Write a brief SMS reply to this customer message. Acknowledge what they said and confirm the business will follow up.\n\nCustomer name: ${customer.name || 'there'}\nOriginal message:\n${rawMessage}`;
				const aiResponse = await claudeText({
					apiKey: ANTHROPIC_AI_KEY,
					system: getOrderTakerSystemPrompt(
						company.name || 'the business',
						'professional_friendly'
					),
					messages: [{ role: 'user', content: safetyPrompt }],
					temperature: 0.3,
					maxTokens: 400
				});
				if (aiResponse) {
					draftedResponse = aiResponse.trim();
				}
			} catch (err) {
				oerr('[Orchestrator] Safety net Claude draft failed:', err);
			}
		}
		if (!draftedResponse) {
			draftedResponse = `Hi ${customer.name || 'there'}, thanks for reaching out to ${company.name || 'us'}. We got your message and someone from our team will follow up with you shortly.`;
		}
	}

	// --- 3. Post-Processing: Thread Similarity Matching ---
	// Match on the caller's phone (whichever leg is NOT the company number)
	const callerPhone = commLog.source || '';
	const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 1-month thread-match window

	if (commLog.content && callerPhone) {
		const recentComms = await prisma.communicationLog.findMany({
			where: {
				companyId: commLog.companyId,
				id: { not: commId },
				status: { in: ['completed', 'success', 'pending_approval'] },
				content: { not: null },
				created: { gte: thirtyDaysAgo },
				// Match ONLY the same caller's recent comms (their phone on either leg).
				// Do NOT match on the company number — it is on every business call and would
				// merge unrelated callers' conversations into one thread.
				OR: [{ source: callerPhone }, { destination: callerPhone }]
			},
			orderBy: { created: 'desc' },
			take: 10
		});

		// An unidentified caller (fresh number, no phone on file anywhere) can never match
		// the same-phone query above. Fall back to the company's recent conversations and
		// let the semantic judge decide — "I told you I'll call previously" IS the email
		// that promised the call, even though the two messages never shared a phone number.
		if (recentComms.length === 0) {
			const companyRecent = await prisma.communicationLog.findMany({
				where: {
					companyId: commLog.companyId,
					id: { not: commId },
					status: { in: ['completed', 'success', 'pending_approval'] },
					content: { not: null },
					customerId: { not: null },
					created: { gte: thirtyDaysAgo }
				},
				orderBy: { created: 'desc' },
				take: 15
			});
			recentComms.push(...companyRecent);
		}

		let matchedThreadId: string | null = null;
		let matchReason = '';
		let matchedComm: {
			id: string;
			customerId: string | null;
			communicationThreadId: string | null;
		} | null = null;

		// Use OpenAI as the sole matching engine — pass unique comm IDs
		if (recentComms.length > 0 && commLog.content) {
			try {
				const { matchThreadOpenAI } = await import('./openai');
				const messagesForAi = recentComms
					.filter((c) => c.content)
					.map((c) => ({ id: c.id, content: c.content as string }));

				if (messagesForAi.length > 0) {
					olog(
						`[Orchestrator] Asking OpenAI to match thread (${messagesForAi.length} candidates within 7 days)...`
					);
					const aiMatchedCommId = await matchThreadOpenAI(commLog.content, messagesForAi);
					if (aiMatchedCommId) {
						// Resolve the matched comm's thread ID (or use its own ID as the thread)
						matchedComm = recentComms.find((c) => c.id === aiMatchedCommId) ?? null;

						// A thread is one person's conversation, and the COM id on it says so. This
						// matcher works on message TEXT across the whole company, so it will happily
						// pair two different customers who asked the same question — "Sam" and
						// "Bert" both enquiring about air conditioners a fortnight apart.
						//
						// Linking those shares one COM id between people we never merged. Identity
						// decides who shares a thread; wording does not. If the match belongs to a
						// different contact, keep the threads apart and flag the pair instead.
						if (matchedComm?.customerId && matchedComm.customerId !== commLog.customerId) {
							olog(
								`[Orchestrator] Thread match rejected — comm ${matchedComm.id} belongs to ` +
									`contact ${matchedComm.customerId}, not ${commLog.customerId}. Same topic is ` +
									`not the same person; threads kept separate.`
							);
							try {
								const { recordMergeCandidate } = await import('./identity/merge-service');
								await recordMergeCandidate({
									companyId: commLog.companyId,
									primaryProfileId: matchedComm.customerId,
									duplicateProfileId: commLog.customerId!,
									reason: 'thread_text_match',
									detectedFromCommId: matchedComm.id
								});
							} catch (e: any) {
								oerr('[Orchestrator] Failed to record merge candidate:', e);
							}
							matchedComm = null;
						}

						if (matchedComm) {
							// The matched comm may never have been put in a CommunicationThread
							// (its communicationThreadId is null). Using its id AS the thread id
							// violates the FK (communication_logs.communicationThreadId → communication_threads.id)
							// and aborts the whole orchestrator run. Create the thread row first.
							if (!matchedComm.communicationThreadId) {
								await prisma.communicationThread
									.create({
										data: {
											id: matchedComm.id,
											companyId: commLog.companyId,
											contactId: matchedComm.customerId,
											summary: (matchedComm as any)?.summary || null
										}
									})
									.catch(() => {});
							}
							matchedThreadId = matchedComm.communicationThreadId || matchedComm.id;
							matchReason = 'OpenAI semantic match';
						}
					}
				}
			} catch (e) {
				oerr('[Orchestrator] OpenAI thread matching failed:', e);
			}
		}

		if (matchedThreadId) {
			try {
				olog(`[Orchestrator] Found similar thread (${matchReason}). Linking current comm.`);

				const oldThreadId = commLog.communicationThreadId;

				// Only update the current comm — don't bulk-reassign old threads
				await prisma.communicationLog.update({
					where: { id: commId },
					data: {
						communicationThreadId: matchedThreadId,
						metadata: {
							...metadata,
							thread_merge: {
								previousThreadId: oldThreadId || null,
								mergedInto: matchedThreadId,
								reason: matchReason,
								mergedAt: new Date().toISOString()
							}
						}
					}
				});

				// Update in-memory so draft SMS gets the new thread ID
				commLog.communicationThreadId = matchedThreadId;
			} catch (e) {
				oerr('[Orchestrator] Thread link / identity bridge failed:', e);
			}
		}
	}

	// --- 3b. Universal conversation resolver (CommContainer) ---
	// Every message — inbound OR outbound, on ANY channel — goes through the same context check:
	// does it continue one of the company's open conversation containers (e.g. an email container
	// created by the outbound-review path, awaiting the customer's reply)? When matched, the entry
	// is appended to that container and the comm log is relinked so the whole conversation shares
	// the container's COM id, no matter which channel either side used.
	if (commLog.type === 'voice' || commLog.type === 'sms' || commLog.type === 'email') {
		try {
			const { resolveContextContainer, appendEntryToContainer, linkCommunicationLogToContainer } =
				await import('./container/thread-resolver');
			const resolution = await resolveContextContainer({
				companyId: commLog.companyId,
				contactId: customer.id,
				customerProfileId: pipelineCustomerProfileId || null,
				phone: customerPhone || null,
				email: customer.email || null,
				channel: commLog.type === 'sms' ? 'sms' : commLog.type === 'email' ? 'email' : 'voice',
				direction: commLog.direction === 'outbound' ? 'outbound' : 'inbound',
				subject: commLog.summary || ((commLog.metadata as any)?.subject ?? null),
				content: (commLog.content || commLog.summary || '').slice(0, 4000),
				summary: commLog.summary,
				occurredAt: commLog.created,
				// The booking/support flows create a container for THIS comm earlier in this
				// function — never let the matcher pick the comm's own container.
				excludeCommIds: [metadata.commContainerId, metadata.commId].filter(Boolean) as string[],
				callerContactId: customer.id,
				callerCustomerProfileId: pipelineCustomerProfileId || null
			});

			if (resolution.matched && resolution.commId && resolution.candidate) {
				const cand = resolution.candidate;
				const mergeReason = resolution.reason || 'context_continuation';

				// --- Never share a COM id across people we have not actually linked ------------
				//
				// The matcher falls back to EVERY open container in the company when the incoming
				// identity has none of its own, and an AI judges continuation at 0.6 confidence on
				// topic similarity. That is a guess about *subject matter*, not evidence about
				// *identity* — and two customers asking about air conditioners in the same
				// fortnight is not rare.
				//
				// Sharing a COM id asserts "same person". We only get to assert that on the
				// evidence an identity merge would need. If the container belongs to a different
				// contact that has not been merged with this one, record the possibility and leave
				// the conversations separate.
				const matchedContainer = await prisma.commContainer.findUnique({
					where: { id: resolution.commId },
					select: { contactId: true, customerProfileId: true }
				});
				const belongsToSomeoneElse =
					(!!matchedContainer?.contactId && matchedContainer.contactId !== customer.id) ||
					// Fallback: if the container has no contactId (pipeline-created) but has a
					// different customerProfileId, it still belongs to someone else.
					(!matchedContainer?.contactId &&
						!!matchedContainer?.customerProfileId &&
						!!pipelineCustomerProfileId &&
						matchedContainer.customerProfileId !== pipelineCustomerProfileId);

				if (belongsToSomeoneElse) {
					olog(
						`[Orchestrator] Cross-channel: NOT linking to ${cand.commRef} — it belongs to ` +
							`contact ${matchedContainer!.contactId}, which has not been merged with ` +
							`${customer.id}. A topic match is not proof of identity; raising a merge ` +
							`candidate instead.`
					);
					try {
						const { recordMergeCandidate } = await import('./identity/merge-service');
						await recordMergeCandidate({
							companyId: commLog.companyId,
							primaryProfileId: matchedContainer!.contactId!,
							duplicateProfileId: customer.id,
							reason: `context_match (${mergeReason})`.slice(0, 500),
							detectedFromCommId: resolution.commId
						});
					} catch (e: any) {
						oerr('[Orchestrator] Failed to record merge candidate:', e);
					}
				} else {
					await appendEntryToContainer(prisma, {
						commId: resolution.commId,
						direction: commLog.direction === 'outbound' ? 'outbound' : 'inbound',
						channel: commLog.type === 'sms' ? 'sms' : commLog.type === 'email' ? 'email' : 'voice',
						fromParty:
							commLog.direction === 'outbound'
								? companyNumber || commLog.source || 'unknown'
								: customerPhone || commLog.source || 'unknown',
						toParty:
							commLog.direction === 'outbound'
								? customerPhone || commLog.destination || 'unknown'
								: companyNumber || commLog.destination || 'unknown',
						fromPartyType: commLog.direction === 'outbound' ? 'rep' : 'customer',
						toPartyType: commLog.direction === 'outbound' ? 'customer' : 'system',
						transcript: commLog.content || commLog.summary || null,
						analysisJson: {
							intent: metadata.intent || null,
							sub_intent: metadata.sub_intent || null,
							summary: commLog.summary || null
						}
					});

					await linkCommunicationLogToContainer(
						commId,
						{ id: cand.id, commRef: cand.commRef },
						mergeReason,
						{ companyId: commLog.companyId, contactId: customer.id }
					);

					// Keep the in-memory metadata in sync so the final persist keeps the link fields
					// and any draft logged below shares the container's COM id.
					metadata.commContainerId = cand.id;
					metadata.commRef = cand.commRef;
					metadata.thread_merge = {
						previousThreadId: commLog.communicationThreadId || null,
						mergedInto: cand.id,
						mergedIntoRef: cand.commRef,
						reason: mergeReason,
						mergedAt: new Date().toISOString()
					};
					commLog.communicationThreadId = cand.id;
					mergedContainerId = cand.id;

					olog(
						`[Orchestrator] Cross-channel: linked ${commLog.type} (${commLog.direction}) to container ${cand.commRef} (${mergeReason})`
					);

					// Same conversation across channels means one person behind two identifiers —
					// merge their profiles too.
					try {
						const { bridgeIdentitiesForMatchedContainer } =
							await import('./container/identity-bridge');
						const bridged = await bridgeIdentitiesForMatchedContainer({
							companyId: commLog.companyId,
							containerId: cand.id,
							confidence: resolution.confidence,
							phone: customerPhone || null,
							email: customer.email || null,
							log: olog
						});
						if (!bridged.merged) olog(`[IdentityBridge] No merge: ${bridged.reason}.`);
					} catch (e) {
						oerr('[IdentityBridge] Profile merge failed (link kept):', e);
					}
				}
			} else if (resolution.reason) {
				olog(`[Orchestrator] Cross-channel: no container match (${resolution.reason})`);
			}
		} catch (e) {
			oerr('[Orchestrator] Cross-channel container matching failed:', e);
		}
	}

	// Detect if caller asked to be gotten back to via email or provided an email address
	const emailMatch = rawMessage.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
	const targetEmail = emailMatch
		? emailMatch[0]
		: metadata.ai_extracted_email || metadata.email || customer.email || null;
	const asksEmail =
		!!emailMatch ||
		/\b(email|send an? email|email me|reach me by email|get back to me at email|contact me by email)\b/i.test(
			rawMessage
		) ||
		(customer.email && wantsEmailedBalance(rawMessage));

	if (asksEmail && targetEmail) {
		draftChannel = 'email';
		if (!emailSubject) {
			emailSubject = `Follow-up regarding your request`;
		}
		// Save customer email if not set
		if (targetEmail && !customer.email) {
			try {
				await prisma.contact.update({
					where: { id: customer.id },
					data: { email: targetEmail }
				});
				customer.email = targetEmail;
			} catch (e) {}
		}
	}

	// Email draft: created when caller requested email follow-up or draftChannel === 'email' → approval queue.
	if (draftChannel === 'email' && (targetEmail || customer.email) && draftedResponse) {
		const destinationEmail = targetEmail || customer.email!;
		// The model writes its own "Subject:" line at the top of the draft. Lift it
		// into the subject so the row carries a real one (instead of the generic
		// "Email Follow-up") and the body reads as a reply, not as a labelled memo.
		const split = splitDraftSubject(draftedResponse);
		if (split.subject) emailSubject = split.subject;
		const draftBody = split.body || draftedResponse;
		try {
			await logCommunication({
				type: 'email',
				direction: 'outbound',
				status: 'pending_approval',
				thread_id: commLog.communicationThreadId || commId,
				destination: destinationEmail,
				// Source is the company's own Gmail address (who the email is FROM),
				// not the customer's address.
				source: companyEmail || destinationEmail,
				company_id: company.id,
				customer_id: customer.id,
				summary: emailSubject || 'Email Follow-up',
				content: draftBody,
				metadata: {
					subject: emailSubject,
					is_draft: true,
					orchestrator_draft: true,
					confirm_email: true,
					target_email: destinationEmail,
					trigger_comm_id: commId,
					commContainerId: metadata.commContainerId || undefined,
					commRef: metadata.commRef || undefined,
					message_category: messageCategory || null
				}
			});
			// Annotate the triggering call row so UI highlights requested email contact
			await prisma.communicationLog.update({
				where: { id: commId },
				data: {
					metadata: {
						...metadata,
						requested_email_contact: true,
						target_email: destinationEmail
					} as any
				}
			});
			olog(`[Orchestrator] Email draft to ${destinationEmail} queued for approval.`);
		} catch (err) {
			oerr('[Orchestrator] Failed to log pending email:', err);
		}
	}
	// §4.3: a shared-line caller who reached us by VOICE gets answered on that line — a call back,
	// nothing else. Texting the number would be writing to whichever colleague or family member
	// picks the handset up next, about a matter that isn't theirs. The reply is dropped rather
	// than re-routed, and the call still surfaces to a human through the normal queue.
	else if (draftedResponse && sameChannelOnly && arrivalChannel === 'voice') {
		olog(
			`[Orchestrator] SMS draft suppressed — ${callerTier} caller reached us by voice, so the ` +
				`only permitted reply is a call back to that line (§4.3). Capture a mobile or an ` +
				`email on the callback to lift this.`
		);
		metadata.suppressed_cross_channel_draft = 'voice_shared_line';
	}
	// If we drafted an SMS response, save it as pending_approval
	else if (draftedResponse && companyNumber && customerPhone) {
		// De-dup: Telnyx re-delivers/retries webhooks (and the SMS webhook drafts a reply AND
		// fires us for the SAME inbound), which would otherwise create a second identical draft.
		// We de-dup on the TRIGGERING inbound message (trigger_comm_id), NOT on the customer —
		// otherwise a genuine follow-up ("what times are you free Monday?") a minute after a
		// previous message gets silently dropped as a "duplicate". Only a draft that was raised
		// by THIS same inbound counts as a duplicate.
		const recentDrafts = await prisma.communicationLog.findMany({
			where: {
				companyId: company.id,
				type: 'sms',
				direction: 'outbound',
				status: 'pending_approval',
				destination: customerPhone,
				created: { gte: new Date(Date.now() - 10 * 60 * 1000) }
			},
			select: { metadata: true }
		});
		const isDuplicate = recentDrafts.some(
			(d) => (d.metadata as Record<string, any> | null)?.trigger_comm_id === commId
		);
		if (isDuplicate) {
			olog(`[Orchestrator] A draft already exists for inbound ${commId} — skipping duplicate.`);
			return;
		}

		olog(`[Orchestrator] Drafting SMS response: "${draftedResponse}"`);

		const now = new Date();
		let shouldDefer = false;
		if (company.locations && company.locations.length > 0) {
			const isAvailable = checkCalendarAvailability(now.toISOString(), company.locations);
			shouldDefer = !isAvailable;
		} else {
			shouldDefer = isOffHours(now);
		}

		if (shouldDefer) {
			olog('[Orchestrator] Outside business hours, flagging draft as deferred.');
		}

		// Route via the pure three-case decision (unit-tested in emergency-routing.test.ts).
		// Emergency → dispatch tech + SLA, no customer draft. Non-emergency → draft (deferred
		// off-hours). NB the old check (`urgency === 'high' || intent === 'emergency'`) missed real
		// emergencies: a burst pipe is urgency 'critical' (not 'high') and its `intent` is often
		// 'Support', so it drafted a "Confirm call" card instead of dispatching.
		const routing = decideRouting({ messageCategory, isOffHours: shouldDefer });
		const isEmergency = routing.dispatchToTech;

		try {
			// Only draft a customer-facing response if it's NOT an emergency, preventing the
			// confusing 3 AM "Confirm Response" card when auto-dispatch should handle it.
			if (!isEmergency) {
				// Normal fallback behavior for non-sales messages
				await logCommunication({
					type: 'sms',
					direction: 'outbound',
					status: 'pending_approval',
					thread_id: commLog.communicationThreadId || commId,
					source: companyNumber,
					destination: customerPhone,
					company_id: company.id,
					customer_id: customer.id,
					summary: (shouldDefer ? '[DEFERRED] ' : '') + draftedResponse.substring(0, 40) + '...',
					content: draftedResponse,
					metadata: {
						is_draft: true,
						orchestrator_draft: true,
						trigger_comm_id: commId,
						commContainerId: metadata.commContainerId || undefined,
						commRef: metadata.commRef || undefined,
						proposed_appointment: proposedAppointment || undefined,
						confirm_action: metadata.confirm_action || undefined,
						callback_number: metadata.callback_number || undefined,
						deferred_after_hours: shouldDefer,
						message_category: messageCategory || null,
						sentiment: aiIntent?.sentiment ?? null,
						urgency: aiIntent?.urgency ?? null,
						sub_intent: aiIntent?.intent_bucket ?? null
					}
				});
			}

			if (isEmergency) {
				// EMERGENCY AUTO-DISPATCH (Dial Ladder)
				// Determine tech rota from settings
				const companySettings = (company.settings || {}) as Record<string, any>;
				const smsNumbers = companySettings.notifications?.phone_numbers || [];
				const customerName = customer?.firstName || customer?.name || 'A customer';
				const callbackNumber = customerPhone;
				const { resolveSmsSender } = await import('./company-sender');
				const dispatchFrom =
					(await resolveSmsSender(company.id, companyNumber)) || companyNumber || undefined;
				let slaDueAt = new Date(Date.now() + 10 * 60 * 1000);

				const { startDialLadder } = await import('./emergency-dial');
				const rota: any[] = [];
				for (let i = 0; i < smsNumbers.length; i++) {
					const contactEntry = smsNumbers[i];
					const phoneNum = typeof contactEntry === 'string' ? contactEntry : contactEntry.number;
					const contactName =
						typeof contactEntry === 'object' && contactEntry.name
							? contactEntry.name
							: `Tech ${i + 1}`;
					if (phoneNum) {
						rota.push({ userId: `u_tech${i}`, name: contactName, phone: phoneNum, rung: i + 1 });
					}
				}

				let dispatched = rota.length;
				let workOrder: any = null;
				let isRepeatEscalation = false;
				if (rota.length === 0) {
					oerr(
						'[Orchestrator] EMERGENCY but no on-call numbers configured (Settings → notifications.phone_numbers) — nobody was alerted.'
					);
				} else {
					// Check for an existing open emergency container (Scenario 3: Repeat Escalation)
					let openEmergencyContainer = await prisma.commContainer.findFirst({
						where: {
							companyId: company.id,
							OR: [
								...(pipelineCustomerProfileId
									? [{ customerProfileId: pipelineCustomerProfileId }]
									: []),
								{ contactId: customer.id }
							],
							state: 'open',
							threadType: 'emergency'
						},
						orderBy: { openedAt: 'desc' }
					});

					const existingWorkOrder = openEmergencyContainer?.metadata
						? (openEmergencyContainer.metadata as Record<string, any>).active_work_order
						: null;

					if (openEmergencyContainer && existingWorkOrder) {
						isRepeatEscalation = true;
						olog(
							`[Orchestrator] Found open emergency container ${openEmergencyContainer.id}, handling repeat escalation...`
						);
						const { processSecondEmergencyVoicemail } = await import('./scenarios/s3-escalation');

						// Inherit the original SLA deadline so it doesn't reset on a frantic callback!
						slaDueAt = new Date(existingWorkOrder.slaDeadline);

						// Get the previous transcript
						const firstEntry = await prisma.commEntry.findFirst({
							where: { commId: openEmergencyContainer.id, direction: 'inbound', channel: 'voice' },
							orderBy: { occurredAt: 'asc' }
						});

						const result = await processSecondEmergencyVoicemail({
							companyId: company.id,
							customerProfileId: pipelineCustomerProfileId || customer.id,
							customerPhone: customerPhone,
							firstTranscript: firstEntry?.transcript || '',
							secondTranscript: rawMessage,
							firstCallbackNum: existingWorkOrder.customerNumber,
							secondCallbackNum: callbackNumber,
							existingContainer: openEmergencyContainer,
							workOrder: existingWorkOrder,
							now: new Date()
						});

						workOrder = result.updatedWorkOrder;
						olog(
							`[Orchestrator] Processed repeat voicemail. Escalating to rung ${workOrder.currentRung}.`
						);
					} else {
						// Scenario 2: Standard Emergency
						olog(
							`[Orchestrator] No open emergency container found. Creating new emergency container.`
						);
						const { createContainerAtIntake } =
							await import('$lib/server/container/container-service');
						const createResult = await createContainerAtIntake(prisma, {
							companyId: company.id,
							customerProfileId: pipelineCustomerProfileId || null,
							contactId: customer.id,
							threadType: 'emergency'
						});
						openEmergencyContainer = createResult.container;

						workOrder = {
							commId: commLog.communicationThreadId || commId,
							personId: customer.id,
							customerNumber: callbackNumber,
							dialLadder: rota,
							currentRung: 1,
							maxAttemptsPerRung: 1,
							whisperText: `Emergency call, ${customerName}, ${rawMessage.substring(0, 50)}. Press 1 to connect, press 2 to decline.`,
							emergencySummary: rawMessage.substring(0, 50),
							slaDeadline: slaDueAt,
							escalationPolicy: 'ladder_with_dtmf'
						};
					}

					await startDialLadder(workOrder, dispatchFrom || companyNumber || '');
					olog(
						`[Orchestrator] EMERGENCY auto-dispatched to ${dispatched} on-call number(s) from ${dispatchFrom} — callback ${callbackNumber} via Dial Ladder.`
					);

					try {
						if (openEmergencyContainer) {
							await prisma.commContainer.update({
								where: { id: openEmergencyContainer.id },
								data: {
									slaDeadline: slaDueAt,
									metadata: { active_work_order: workOrder } as any
								}
							});
							olog(
								`[Orchestrator] SLA+WorkOrder synced to CommContainer ${openEmergencyContainer.id}.`
							);
						}
					} catch (e) {
						oerr('[Orchestrator] Failed to sync SLA and workOrder to CommContainer:', e);
					}
				}

				metadata.emergency_dispatched = dispatched;
				metadata.emergency_callback_number = callbackNumber;

				// ONE communication-log record for the whole dispatch (not one per recipient), so the a2p
				// Communication Log shows a SINGLE emergency-dispatch row carrying the SLA countdown.
				if (dispatched > 0) {
					if (isRepeatEscalation) {
						await logCommunication({
							type: 'voice',
							direction: 'outbound',
							status: 'completed',
							thread_id: commLog.communicationThreadId || commId,
							source: dispatchFrom || companyNumber,
							destination: rota.map((r) => r.phone).join(', '),
							company_id: company.id,
							customer_id: customer.id,
							summary: `Escalation: emergency dispatch advanced to rung ${workOrder?.currentRung}`,
							content: `System advanced dial ladder for repeat call. Whisper text: "${workOrder?.whisperText || 'Emergency dispatch'}"`,
							metadata: {
								is_escalation: true,
								recipients: rota,
								callback_number: callbackNumber,
								trigger_comm_id: commId,
								message_category: 'emergency',
								sla_due_at: slaDueAt.toISOString()
							}
						}).catch((e) =>
							oerr('[Orchestrator] Emergency escalation logged but failed to save record:', e)
						);
						olog('[Orchestrator] Logged escalation row (no duplicate SLA timer created).');
					} else {
						await logCommunication({
							type: 'voice',
							direction: 'outbound',
							status: 'completed',
							thread_id: commLog.communicationThreadId || commId,
							source: dispatchFrom || companyNumber,
							destination: rota.map((r) => r.phone).join(', '),
							company_id: company.id,
							customer_id: customer.id,
							summary: `Emergency dispatch to ${dispatched} on-call number(s) — call ${callbackNumber}`,
							content: `System dispatched dial ladder. Whisper text: "${workOrder?.whisperText || 'Emergency dispatch'}"`,
							metadata: {
								is_emergency_dispatch: true,
								emergency_dispatch: true,
								recipients: rota,
								recipient_count: dispatched,
								callback_number: callbackNumber,
								trigger_comm_id: commId,
								// Thread this dispatch into the customer's conversation (the inbound emergency
								// call's thread) so the inbound call, this alert, and the callback all connect.
								message_category: 'emergency',
								sla_minutes: 10,
								sla_due_at: slaDueAt.toISOString(),
								sla_status: 'pending'
							}
						}).catch((e) =>
							oerr('[Orchestrator] Emergency SMS sent but failed to log the record:', e)
						);
					}
				}

				// --- SLA BREACH TRACKER ---
				// Create a 10-minute countdown task for the technician callback. The SLA monitor
				// watches PipelineActionQueue. Because process_orchestrator bypasses the PipelineDecision
				// engine, we must synthesize the Event/Decision records to hook into the existing SLA.
				if (dispatched > 0) {
					const fakeId = `emg_${Math.random().toString(36).substring(2, 9)}`;
					await prisma.pipelineEvent
						.create({
							data: {
								eventId: `evt_${fakeId}`,
								traceId: `trc_${fakeId}`,
								provider: 'orchestrator_emergency',
								providerEventName: 'emergency_dispatch',
								providerEventId: commId,
								eventType: 'emergency_alert',
								networkCategory: 'Communication',
								companyId: company.id,
								processingStatus: 'handoff_eligible',
								handoffEligible: true,
								unstructuredText: `Emergency auto-dispatch to ${dispatched} owner(s). Callback: ${callbackNumber}`,
								decisions: {
									create: {
										decisionId: `dec_${fakeId}`,
										executionMode: 'automatic',
										owner: 'system',
										priority: 1,
										reason: 'Emergency auto-dispatch'
									}
								}
							},
							include: { decisions: true }
						})
						.then(async (evt) => {
							const dec = evt.decisions[0];
							await prisma.pipelineActionQueue.create({
								data: {
									queueTraceId: `q_${fakeId}`,
									decisionId: dec.id,
									actionId: 'ACT-A2P-004',
									executionLane: 'approval_required', // Force it to sit in the OPEN queue for the SLA monitor
									status: 'ready_for_execution',
									dueAt: slaDueAt, // SAME deadline shown on the dispatch record above
									parameters: {
										phone_number: callbackNumber,
										emergency_type: 'automated_dispatch',
										callback_number: callbackNumber
									}
								}
							});
							olog(
								`[Orchestrator] 10-minute SLA callback task created for emergency (q_${fakeId}).`
							);
						})
						.catch((e) => {
							oerr('[Orchestrator] Failed to insert SLA tracking records for emergency:', e);
						});
				} // end if (dispatched > 0)

				metadata.emergency_callback_number = callbackNumber;
			}
		} catch (err) {
			oerr('[Orchestrator] Failed to log pending SMS:', err);
		}
	} else if (intent?.toLowerCase() === 'emergency' || intent?.toLowerCase() === 'support') {
		olog(
			`[Orchestrator] Acknowledging intent "${intent}". No extra response drafted as webhook handles emergencies or support is manual.`
		);
	} else {
		olog(`[Orchestrator] No action taken for intent: ${intent}`);
	}

	// Command registry: dispatch any instructions from the AI intent
	try {
		const { executeInstructions } = await import('./orchestrator/command-registry');
		const instructions: { command: string; args: Record<string, unknown> }[] = [];
		if (aiIntent) {
			if (aiIntent.wants_appointment && metadata.datetime) {
				instructions.push({
					command: 'set_appointment',
					args: { when: metadata.datetime, notes: rawMessage.slice(0, 200) }
				});
			}
			if (aiIntent.wants_callback) {
				instructions.push({
					command: 'update_engagement_score',
					args: { delta: 5 }
				});
			}
			// The vetted plan, not the raw AI suggestions — see deriveNextActionPlan.
			// The hold task is the customer's own commitment, so it is filed as a
			// customer_promise: that category is what keeps the container open and
			// what the suspense timer watches.
			for (const item of metadata.actionItems as string[]) {
				// The hold task is created below instead, where its id can be handed to
				// the suspense timer that watches whether the customer actually returns.
				if (nextActionPlan.suspense && item === nextActionPlan.tasks[0]) continue;
				instructions.push({
					command: 'create_task',
					args: { description: item, category: 'internal_followup' }
				});
			}
		}
		if (instructions.length > 0) {
			olog(`[Orchestrator] Dispatching ${instructions.length} command(s) via registry.`);
			await executeInstructions(
				{
					companyId: company.id,
					customerId: customer?.id,
					customerPhone: customerPhone || undefined,
					customerEmail: customer?.email || undefined,
					customerName: customer?.name || undefined,
					commLogId: commId,
					trigger,
					// Only meaningful while the call is still up (mid-call triggers). Post-hangup the leg
					// is dead and any call-control command fails harmlessly inside executeInstructions.
					callControlId: (metadata.call_control_id as string) || undefined
				},
				instructions
			);
		}
	} catch (cmdErr) {
		oerr('[Orchestrator] Command dispatch error:', cmdErr);
	}

	// ── Suspense state: the customer owns the next move ─────────────────────────
	// "I'll call you when I get back in a couple of weeks" must not sit in the
	// active pipeline (it clutters the rep's day with something they must not act
	// on) and must not be closed either (that silently loses the lead). Park the
	// promise as a customer_promise task and set a timer past the window they
	// named. If they come back before it fires the task is closed and the timer
	// cancels itself; if they don't, it produces a follow-up.
	if (nextActionPlan.suspense) {
		try {
			const containerId =
				(metadata.commContainerId as string) ||
				(
					await prisma.commContainer.findFirst({
						where: {
							companyId: company.id,
							state: { not: 'closed' },
							...(customer?.id ? { contactId: customer.id } : {})
						},
						orderBy: { lastActivityAt: 'desc' },
						select: { id: true }
					})
				)?.id;

			if (!containerId) {
				olog('[Orchestrator] No container to park the customer promise on — skipped.');
			} else {
				const { createTask } = await import('$lib/server/container/container-service');
				const promiseTask = await createTask(prisma, {
					commId: containerId,
					description: nextActionPlan.tasks[0],
					ownerUserId: 'system',
					due: nextActionPlan.suspense.dueAt,
					category: 'customer_promise'
				});

				const { registerTimer } = await import('$lib/server/timer/timer-service');
				await registerTimer(prisma, {
					commId: containerId,
					companyId: company.id,
					type: 'promise_due',
					fireAt: nextActionPlan.suspense.dueAt,
					supersedeSameType: true,
					payload: {
						taskId: promiseTask.id,
						contactId: customer?.id || null,
						promisedAt: new Date().toISOString(),
						timeframeDays: nextActionPlan.suspense.timeframeDays,
						followUpDescription: nextActionPlan.suspense.description
					}
				});

				metadata.suspense_until = nextActionPlan.suspense.dueAt.toISOString();
				olog(
					`[Orchestrator] Customer promise parked. Suspense check ${nextActionPlan.suspense.dueAt.toISOString()} (${nextActionPlan.suspense.timeframeDays}d + grace).`
				);

				// Write a ScheduledIntent row so the profile's "Pending Actions" card shows
				// this customer commitment. The container task + timer handle internal ops;
				// the scheduledIntent drives the profile UI and the resolve-on-return flow.
				// This runs universally for all channels.
				if (customer?.id) {
					try {
						const { writeScheduledIntent } = await import('$lib/server/scheduled-intent-writer');
						const channelType =
							commLog.type === 'sms' ? 'sms' : commLog.type === 'email' ? 'email' : 'voice';
						const written = await writeScheduledIntent({
							companyId: company.id,
							contactId: customer.id,
							profileId: customer.id,
							extraction: {
								hasFutureIntent: true,
								schedulable: true,
								actor: 'CUSTOMER',
								whatHeWants: aiIntent?.reason || nextActionPlan.suspense.description,
								rawTimeframe:
									aiIntent?.customer_initiate_timeframe ||
									`${nextActionPlan.suspense.timeframeDays} days`,
								timeframeDays: nextActionPlan.suspense.timeframeDays,
								exactDateIso: aiIntent?.customer_initiate_exact_datetime || null,
								calculatedTargetDate: nextActionPlan.suspense.dueAt.toISOString(),
								confidence: 'HIGH',
								preferredChannel: aiIntent?.customer_initiate_method || 'phone'
							},
							channel: channelType,
							originalTarget: customerPhone || null,
							conversationId: containerId,
							commLogId: commId,
							idempotencyKey: `orch_suspense_${commId}`
						});
						if (written.recorded) {
							olog(
								`[Orchestrator] ScheduledIntent ${written.scheduledIntentId?.slice(0, 8)} created (due ${written.dueAt}).`
							);
						} else {
							olog(`[Orchestrator] ScheduledIntent not recorded: ${written.reason}`);
						}
					} catch (siErr) {
						oerr('[Orchestrator] ScheduledIntent write failed (non-fatal):', siErr);
					}
				}
			}
		} catch (suspenseErr) {
			oerr('[Orchestrator] Failed to register the customer-promise suspense:', suspenseErr);
		}
	}

	// Always mark as processed
	try {
		await prisma.communicationLog.update({
			where: { id: commId },
			data: {
				metadata: {
					...metadata,
					orchestrator_logs: orchestratorLogs,
					orchestrator_processed: true
				}
			}
		});
	} catch (err) {
		oerr('[Orchestrator] Failed to mark as processed:', err);
	}
}
