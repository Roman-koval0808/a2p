import { prisma } from '$lib/db';
import { logCommunication } from '$lib/utils/communication-log';
import { toE164 } from '$lib/company-numbers';
import { classifyMessageIntent, bucketToCategory } from './message-intent';
import { checkCalendarAvailability, formatDatetime, describeLocations, describeDayHours } from './calendar';
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

export async function process_orchestrator(commId: string, trigger: string) {
	console.log(`[Orchestrator] Processing commId: ${commId} with trigger: ${trigger}`);

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
		console.log('[Orchestrator] Missing commLog, company, or customer. Aborting.');
		return;
	}

	const metadata = (commLog.metadata as Record<string, any>) || {};
	const intent = metadata.intent || metadata.ivr_intent;
	const sub_intent = metadata.sub_intent;
	const datetime = metadata.datetime;
	const digit = metadata.ivr_digit;

	const customer = commLog.customer!;
	const company = commLog.company!;
	// destination may be annotated as "+1705… (Ext 1 - Billing)" — strip that before E.164,
	// otherwise the drafted SMS gets an invalid `from` and Telnyx rejects it ("Invalid source number").
	const cleanDestination = (commLog.destination || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
	const companyNumber = toE164(cleanDestination);
	const customerPhone = toE164(commLog.source || '');

	// Prevent drafting multiple SMS if already processed
	if (metadata.orchestrator_processed) {
		console.log('[Orchestrator] Already processed. Aborting.');
		return;
	}

	// Wait, is it inbound?
	if (commLog.direction !== 'inbound') {
		return;
	}

	// T4.4: skip operational/internal calls (e.g. the owner leaving himself a voicemail on
	// a company line) — classifying them as customer contacts would score a false emergency.
	if (commLog.companyId && commLog.source && (await isInternalCaller(commLog.companyId, commLog.source))) {
		console.log('[Orchestrator] Internal/operational caller — skipping customer classification.');
		return;
	}

	// --- Reclassify by the MESSAGE, not the IVR digit ---
	// The caller may press the wrong key (or the menu is limited — in the demo the greeting
	// routes billing AND sales to "1"). We follow what they actually SAID: classify the
	// transcript + AI summary, and if it doesn't match the digit's department, reclassify and
	// follow the message. An emergency always wins, whatever digit was pressed.
	const rawMessage = (commLog.content || metadata.summary || commLog.summary || '').toString();
	const digitCategory: 'billing' | 'sales' | 'support' | null =
		digit === '1' ? 'billing' : digit === '2' ? 'sales' : digit === '3' ? 'support' : null;

	// The AI classifier is the ONLY thing that decides the category — no keyword or digit
	// fallbacks. We always follow what the caller actually SAID. e.g. "book an appointment to
	// come down and pay my bill" -> booking (ask for a time), not a balance reply.
	const aiIntent = await classifyMessageIntent(rawMessage, ANTHROPIC_AI_KEY);
	let messageCategory: 'emergency' | 'billing' | 'sales' | 'support';
	if (aiIntent) {
		messageCategory = bucketToCategory(aiIntent);
		metadata.ai_intent = aiIntent;
		console.log(
			`[Orchestrator] AI intent: ${aiIntent.intent_bucket} (urgency ${aiIntent.urgency}, appt ${aiIntent.wants_appointment}, conf ${aiIntent.confidence}) -> ${messageCategory}`
		);
	} else {
		// Classification unavailable (empty message or AI error): route to a human, never guess.
		messageCategory = 'support';
		metadata.ai_intent = null;
		console.log('[Orchestrator] No AI classification available; routing to support for human review.');
	}

	const reclassified = !!(digitCategory && digitCategory !== messageCategory);
	if (reclassified) {
		console.log(
			`[Orchestrator] Reclassified: caller pressed ${digit} (${digitCategory}) but the message is "${messageCategory}" — following the message.`
		);
	}
	metadata.message_category = messageCategory;
	metadata.reclassified = reclassified;
	if (digitCategory) metadata.ivr_pressed_category = digitCategory;

	// T3.1: pre-approved callback acknowledgement ("a representative will call you in X minutes").
	// Fires without human approval, but sendCallbackAck gates it on config (sms_auto_reply_allowed),
	// transactional consent, and office hours. Deduped so a re-delivered webhook can't double-send.
	if (aiIntent?.wants_callback && !metadata.callback_ack_sent && commLog.companyId && customerPhone) {
		try {
			const ack = await sendCallbackAck({
				companyId: commLog.companyId,
				phone: customerPhone,
				customerName: customer.name || null,
				summary: commLog.summary || metadata.summary || null
			});
			if (ack.sent) {
				metadata.callback_ack_sent = true;
				console.log(`[Orchestrator] Callback ack sent (${ack.slaMinutes} min).`);
			} else {
				console.log(`[Orchestrator] Callback ack skipped: ${ack.reason}`);
			}
		} catch (err) {
			console.error('[Orchestrator] Callback ack failed:', err);
		}
	}

	// Claim this comm up-front so a retried or concurrent webhook (Telnyx can re-deliver
	// recording.saved) can't double-increment the engagement score or draft the SMS twice.
	// Marking before the work — not after — means a failed run won't auto-retry, which is
	// the right trade-off here: better to under-process than to double-charge engagement.
	// Mutating the local metadata too keeps later `{ ...metadata }` writes consistent.
	metadata.orchestrator_processed = true;
	try {
		await prisma.communicationLog.update({
			where: { id: commId },
			data: { metadata: { ...metadata } }
		});
	} catch (err) {
		console.error('[Orchestrator] Failed to claim comm for processing:', err);
		return;
	}

	let draftedResponse = '';

	console.log(`[Orchestrator] Debug -> digit: "${digit}", intent: "${intent}", sub_intent: "${sub_intent}"`);

	// Engagement score: a sales/booking message is a hot opportunity; an emergency is urgent
	// and high-value to retain. Billing (already a paying customer) and plain support don't move it.
	const scoreDelta = messageCategory === 'emergency' ? 25 : messageCategory === 'sales' ? 10 : 0;
	if (scoreDelta > 0) {
		await prisma.contact.update({
			where: { id: customer.id },
			data: { engagementScore: { increment: scoreDelta } }
		});
		console.log(`[Orchestrator] Engagement score +${scoreDelta} (${messageCategory}).`);
	}

	// --- EMERGENCY: always wins, regardless of the digit pressed ---
	if (messageCategory === 'emergency') {
		console.log('[Orchestrator] EMERGENCY detected from the message — overriding IVR routing.');
		const template = `Hi ${customer.name || 'there'}, we received your urgent message and someone from ${company.name || 'our team'} will call you back right away.`;
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
			console.error('[Orchestrator] Emergency reply failed, using template:', e);
			draftedResponse = template;
		}
	}

	// --- SCENARIO 1: BILLING (only when the MESSAGE is actually about billing) ---
	else if (messageCategory === 'billing') {
		{
			console.log('[Orchestrator] Detected Scenario 1: Billing');

			// Match the balance to the SAME person by phone (the number they actually called from),
			// covering a duplicate/older contact row or a different phone format. Never by name.
			const balance = await resolveBalanceByPhone(
				company.id,
				customer.phone || commLog.source,
				customer.accountBalance
			);

			if (balance !== null && balance !== undefined) {
				draftedResponse = `You currently owe $${balance.toFixed(2)}, Thank you for your business have a nice day.`;
			} else {
				draftedResponse = `Hi ${customer.name || 'there'}, we received your message regarding your account balance. An agent will review your account and reach out shortly.`;
			}
		}
	}

	// --- SCENARIO 2: SALES / BOOKING (message is about sales/booking) ---
	else if (messageCategory === 'sales') {
		console.log('[Orchestrator] Detected Scenario 2: Sales / Booking');

		// (Engagement score is bumped centrally above based on the reclassified category.)
		// Prefer a self-service booking link: a pasted Appointment Schedule link, or — when Google
		// Calendar is connected — our own booking page (shows live availability from her calendar,
		// customer self-picks, event is written back with a Meet link).
		const bookingLink = getBookingUrl(company) || (await getBookingLinkIfConnected(company.id));

		if (bookingLink) {
			console.log('[Orchestrator] Sending self-service booking link.');
			const link = bookingLinkWith(bookingLink, {
				time: datetime,
				name: customer.name,
				phone: customer.phone || commLog.source
			});
			draftedResponse = datetime
				? `Hi! Thanks for reaching out to ${company.name || 'us'}. ${formatDatetime(datetime)} works — just confirm it here: ${link}`
				: `Hi! Thanks for contacting ${company.name || 'us'}. Book a time that works for you here: ${link}`;
		} else if (datetime) {
			// No booking option configured — legacy text flow.
			const formattedDatetime = formatDatetime(datetime);
			const isAvailable = checkCalendarAvailability(datetime, company.locations || []);
			draftedResponse = isAvailable
				? `Hi! Thanks for reaching out to ${company.name || 'us'}. We see you'd like to book an appointment for ${formattedDatetime}. A representative will confirm this time with you shortly.`
				: `Hi! Thanks for reaching out to ${company.name || 'us'}. Unfortunately, ${formattedDatetime} is outside our normal business hours or unavailable. What other day or time works best for you?`;
		} else {
			draftedResponse = `Hi! Thanks for contacting ${company.name || 'us'}. We received your booking request. What day and time works best for you?`;
		}
	}

	// --- SUPPORT (default — and where reclassified non-billing/non-sales calls land) ---
	else {
		console.log('[Orchestrator] Detected Support request.');
		draftedResponse = `Hi ${customer.name || 'there'}, thanks for reaching out to ${company.name || 'us'}. We received your message and a support agent will get back to you shortly.`;
	}

	// If this caller has prior cross-channel history (past calls OR SMS), make the reply
	// conversational and context-aware — carrying the earlier thread into this new call —
	// instead of the first-touch scenario template above. (Emergencies keep the urgent template.)
	if (draftedResponse && messageCategory !== 'emergency') {
		try {
			const last10 = (p: string | null | undefined) => (p || '').replace(/\D/g, '').slice(-10);
			const callerDigits = last10(commLog.source);
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
							from: (l.direction === 'inbound' ? 'customer' : 'business') as 'customer' | 'business',
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
				const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

				// Reply whenever this is a returning caller, an explicit support message, or a
				// scheduling / account ask. The AI itself then decides which real data it needs.
				if (
					history.length > 0 ||
					messageCategory === 'support' ||
					asksReschedule ||
					asksAppointments ||
					asksAvailability
				) {
					const locations = (company as any).locations || [];
					// Self-service link: pasted Appointment Schedule link, or our booking page when
					// Google Calendar is connected — the customer picks a slot from live availability.
					const bookingLink = getBookingUrl(company) || (await getBookingLinkIfConnected(company.id));
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
							knownBalance: customer.accountBalance,
							apiKey: ANTHROPIC_AI_KEY
						});
					} catch (agErr) {
						console.error('[Orchestrator] Agentic reply failed; using fact-based fallback:', agErr);
					}

					if (draft) {
						draftedResponse = draft;
						console.log('[Orchestrator] Agentic skill reply.');
					} else {
						// FALLBACK: keyword-gated fact assembly → fact-based conversational reply.
						let appointments: { startISO: string; title: string; isPast: boolean }[] | undefined;
						let reschedule: RescheduleResult | undefined;
						let availableSlots: { label: string; slots: { label: string }[] }[] | undefined;
						let openHoursNote: string | null | undefined;
						if (asksReschedule && gconn.connected) {
							reschedule = await resolveReschedule(company.id, { message: rawMessage, ...ident });
						} else if (asksAvailability) {
							const named = dayNames.filter((d) => new RegExp(`\\b${d}\\b`, 'i').test(rawMessage));
							// Business-hours answer as a safety net (used when disconnected, or if the live
							// lookup fails / returns nothing) so an availability question is never unanswered.
							openHoursNote = describeDayHours(locations, named);
							if (gconn.connected) {
								try {
									const allSlots = await getAvailableSlots(company.id, { locations, days: 14 });
									const filtered =
										named.length > 0
											? allSlots.filter((d) => named.some((n) => new RegExp(`\\b${n}\\b`, 'i').test(d.label)))
											: allSlots.slice(0, 3);
									const nonEmpty = filtered.filter((d) => d.slots.length > 0);
									// Empty can mean "fully booked" OR "freeBusy hiccup" — don't over-claim.
									if (nonEmpty.length > 0) availableSlots = nonEmpty;
								} catch (slotErr) {
									console.warn('[Orchestrator] Live availability lookup failed; using business hours:', slotErr);
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
							console.log('[Orchestrator] Fact-based reply (fallback).');
						}
					}
				}
			}
		} catch (e) {
			console.error('[Orchestrator] Conversational override failed:', e);
		}
	}

	// --- 3. Post-Processing: Thread Similarity Matching ---
	// Match on the caller's phone (whichever leg is NOT the company number)
	const callerPhone = commLog.source || '';
	const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

	if (commLog.content && callerPhone) {
		const recentComms = await prisma.communicationLog.findMany({
			where: {
				companyId: commLog.companyId,
				id: { not: commId },
				status: { in: ['completed', 'success', 'pending_approval'] },
				content: { not: null },
				created: { gte: sevenDaysAgo },
				// Match ONLY the same caller's recent comms (their phone on either leg).
				// Do NOT match on the company number — it is on every business call and would
				// merge unrelated callers' conversations into one thread.
				OR: [{ source: callerPhone }, { destination: callerPhone }]
			},
			orderBy: { created: 'desc' },
			take: 10
		});

		let matchedThreadId: string | null = null;
		let matchReason = '';

		// Use OpenAI as the sole matching engine — pass unique comm IDs
		if (recentComms.length > 0 && commLog.content) {
			try {
				const { matchThreadOpenAI } = await import('./openai');
				const messagesForAi = recentComms
					.filter(c => c.content)
					.map(c => ({ id: c.id, content: c.content as string }));

				if (messagesForAi.length > 0) {
					console.log(`[Orchestrator] Asking OpenAI to match thread (${messagesForAi.length} candidates within 7 days)...`);
					const aiMatchedCommId = await matchThreadOpenAI(commLog.content, messagesForAi);
					if (aiMatchedCommId) {
						// Resolve the matched comm's thread ID (or use its own ID as the thread)
						const matchedComm = recentComms.find(c => c.id === aiMatchedCommId);
						if (matchedComm) {
							matchedThreadId = matchedComm.communicationThreadId || matchedComm.id;
							matchReason = 'OpenAI semantic match';
						}
					}
				}
			} catch (e) {
				console.error('[Orchestrator] OpenAI thread matching failed:', e);
			}
		}

		if (matchedThreadId) {
			console.log(`[Orchestrator] Found similar thread (${matchReason}). Linking current comm.`);

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
		}
	}

	// If we drafted a response, save it as pending_approval
	if (draftedResponse && companyNumber && customerPhone) {
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
			console.log(`[Orchestrator] A draft already exists for inbound ${commId} — skipping duplicate.`);
			return;
		}

		console.log(`[Orchestrator] Drafting SMS response: "${draftedResponse}"`);

		const now = new Date();
		let shouldDefer = false;
		if (company.locations && company.locations.length > 0) {
			const isAvailable = checkCalendarAvailability(now.toISOString(), company.locations);
			shouldDefer = !isAvailable;
		} else {
			const hour = now.getHours();
			const day = now.getDay(); // 0 is Sunday, 6 is Saturday
			const isWeekend = day === 0 || day === 6;
			const isAfterHours = hour < 9 || hour >= 17;
			shouldDefer = isWeekend || isAfterHours;
		}

		if (shouldDefer) {
			console.log('[Orchestrator] Outside business hours, flagging draft as deferred.');
		}
		
		try {
			await logCommunication({
				type: 'sms',
				direction: 'outbound',
				status: 'pending_approval',
				source: companyNumber,
				destination: customerPhone,
				company_id: company.id,
				customer_id: customer.id,
				summary: (shouldDefer ? '[DEFERRED] ' : '') + draftedResponse.substring(0, 40) + '...',
				content: draftedResponse,
				metadata: {
					thread_id: customerPhone,
					commId: commLog.communicationThreadId,
					is_draft: true,
					orchestrator_draft: true,
					trigger_comm_id: commId,
					deferred_after_hours: shouldDefer,
					// Inherit the conversation's classification so the draft's summary shows a
					// meaningful Category / Sub-Category instead of blanks.
					message_category: messageCategory || null,
					sentiment: aiIntent?.sentiment ?? null,
					urgency: aiIntent?.urgency ?? null,
					sub_intent: aiIntent?.intent_bucket ?? null
				}
			});
		} catch (err) {
			console.error('[Orchestrator] Failed to log pending SMS:', err);
		}
	} else if (intent?.toLowerCase() === 'emergency' || intent?.toLowerCase() === 'support') {
		console.log(`[Orchestrator] Acknowledging intent "${intent}". No extra response drafted as webhook handles emergencies or support is manual.`);
	} else {
		console.log(`[Orchestrator] No action taken for intent: ${intent}`);
	}

	// Always mark as processed
	try {
		await prisma.communicationLog.update({
			where: { id: commId },
			data: {
				metadata: {
					...metadata,
					orchestrator_processed: true
				}
			}
		});
	} catch (err) {
		console.error('[Orchestrator] Failed to mark as processed:', err);
	}

}
