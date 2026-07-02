import { prisma } from '$lib/db';
import { logCommunication } from '$lib/utils/communication-log';
import { toE164 } from '$lib/company-numbers';
import { classifyMessageIntent, bucketToCategory } from './message-intent';
import { checkCalendarAvailability, formatDatetime } from './calendar';
import { getBookingUrl, bookingLinkWith } from '$lib/utils/booking';
import { getBookingLinkIfConnected, getConnectionInfo, getCustomerAppointments } from './google-calendar';
import { ANTHROPIC_AI_KEY } from '$env/static/private';

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
		draftedResponse = `Hi ${customer.name || 'there'}, we received your urgent message and someone from ${company.name || 'our team'} will call you back right away.`;
	}

	// --- SCENARIO 1: BILLING (only when the MESSAGE is actually about billing) ---
	else if (messageCategory === 'billing') {
		{
			console.log('[Orchestrator] Detected Scenario 1: Billing');

			let balance = customer.accountBalance;
			if (balance === null || balance === undefined) {
				// The inbound webhook may have created a fresh contact for this caller while an
				// older/duplicate record holds the balance — and it may be stored in a different
				// phone format (e.g. "(905) 705-5234" vs "+19097055234"). Match the SAME person by
				// normalized digits (last 10), never by name (that could leak another's balance).
				const digitsOf = (p: string | null | undefined) => (p || '').replace(/\D/g, '').slice(-10);
				const callerDigits = digitsOf(customer.phone);
				if (callerDigits) {
					const candidates = await prisma.contact.findMany({
						where: { companyId: company.id, accountBalance: { not: null } },
						select: { id: true, phone: true, accountBalance: true }
					});
					const alt = candidates.find(
						(c) => c.id !== customer.id && digitsOf(c.phone) === callerDigits
					);
					if (alt) {
						balance = alt.accountBalance;
					}
				}
			}

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
				// Is the customer asking about their appointment history (past/next/a given day)?
				const asksAppointments =
					/\b(appointment|appt|last (time|appointment|visit)|when .*(was|were|is|are|scheduled|booked)|history|scheduled|booked|come out|came out|visit|next (appointment|appt|visit))\b/i.test(
						rawMessage
					);
				let appointments: { startISO: string; title: string; isPast: boolean }[] | undefined;
				if (asksAppointments) {
					const gconn = await getConnectionInfo(company.id);
					if (gconn.connected) {
						// Match by phone (the number they called/texted from — reliable), then email,
						// then name as a fuzzy fallback.
						appointments = await getCustomerAppointments(company.id, {
							phone: customer.phone || commLog.source,
							email: customer.email,
							name: customer.name
						});
					}
				}

				if (history.length > 0 || appointments !== undefined) {
					// Self-service link: pasted Appointment Schedule link, or our booking page when
					// Google Calendar is connected — the customer picks a slot from live availability.
					const bookingLink = getBookingUrl(company) || (await getBookingLinkIfConnected(company.id));
					const { draftConversationalReply } = await import('./conversation');
					const conv = await draftConversationalReply({
						message: commLog.content || rawMessage,
						history,
						companyName: company.name || 'us',
						customerName: customer.name || null,
						customerPhone: customer.phone || commLog.source,
						locations: (company as any).locations || [],
						accountBalance: customer.accountBalance ?? null,
						bookingUrl: bookingLink,
						appointments,
						apiKey: ANTHROPIC_AI_KEY
					});
					if (conv?.reply) {
						draftedResponse = conv.reply;
						console.log(
							appointments !== undefined
								? '[Orchestrator] Answered appointment-history question from the calendar.'
								: '[Orchestrator] Used conversational cross-channel reply (returning caller).'
						);
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
		// De-dup: Telnyx re-delivers/retries webhooks (and a sibling comm log can trigger us
		// too), which would otherwise create a second identical "Confirm" draft. If a pending
		// draft to this customer already exists, don't create another.
		const existingDraft = await prisma.communicationLog.findFirst({
			where: {
				companyId: company.id,
				type: 'sms',
				direction: 'outbound',
				status: 'pending_approval',
				destination: customerPhone,
				created: { gte: new Date(Date.now() - 10 * 60 * 1000) }
			}
		});
		if (existingDraft) {
			console.log('[Orchestrator] A pending draft already exists for this customer — skipping duplicate.');
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
