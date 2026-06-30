import { prisma } from '$lib/db';
import { logCommunication } from '$lib/utils/communication-log';
import { toE164 } from '$lib/company-numbers';
// Checks if a requested datetime is within business hours of any location, fallback to 9-5 M-F
function checkCalendarAvailability(datetimeStr: string, locations: any[]): boolean {
	const lower = datetimeStr.toLowerCase();
    
	let reqDay: string | null = null;
	let reqHour24 = -1;

	const d = new Date(datetimeStr);
	if (!isNaN(d.getTime())) {
		const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thurs', 'Fri', 'Sat'];
		reqDay = days[d.getDay()];
		reqHour24 = d.getHours();
	} else {
		if (lower.includes('mon')) reqDay = 'Mon';
		else if (lower.includes('tue')) reqDay = 'Tue';
		else if (lower.includes('wed')) reqDay = 'Wed';
		else if (lower.includes('thu')) reqDay = 'Thurs';
		else if (lower.includes('fri')) reqDay = 'Fri';
		else if (lower.includes('sat')) reqDay = 'Sat';
		else if (lower.includes('sun')) reqDay = 'Sun';

		const amMatch = lower.match(/(\d{1,2})(?:\:\d{2})?\s*am/);
		const pmMatch = lower.match(/(\d{1,2})(?:\:\d{2})?\s*pm/);
		
		if (amMatch) {
			let h = parseInt(amMatch[1]);
			if (h === 12) h = 0;
			reqHour24 = h;
		} else if (pmMatch) {
			let h = parseInt(pmMatch[1]);
			if (h < 12) h += 12;
			reqHour24 = h;
		} else {
			const milMatch = lower.match(/(\d{1,2})\:\d{2}/);
			if (milMatch) {
				reqHour24 = parseInt(milMatch[1]);
			}
		}
	}

	if (locations && locations.length > 0 && reqDay) {
		let isAvailableInAnyLocation = false;
		
		for (const loc of locations) {
			const hoursObj = loc.hours || {};
			const dayHours = hoursObj[reqDay];
			
			if (!dayHours || dayHours.toLowerCase() === 'closed') {
				continue;
			}

			if (reqHour24 !== -1) {
				const locMatch = dayHours.toLowerCase().match(/(\d{1,2})(?:\:\d{2})?\s*(am|pm)\s*-\s*(\d{1,2})(?:\:\d{2})?\s*(am|pm)/);
				if (locMatch) {
					let startH = parseInt(locMatch[1]);
					if (locMatch[2] === 'pm' && startH < 12) startH += 12;
					if (locMatch[2] === 'am' && startH === 12) startH = 0;

					let endH = parseInt(locMatch[3]);
					if (locMatch[4] === 'pm' && endH < 12) endH += 12;
					if (locMatch[4] === 'am' && endH === 12) endH = 0;

					if (reqHour24 >= startH && reqHour24 < endH) {
						isAvailableInAnyLocation = true;
						break;
					}
				} else {
					// Fallback to true if hours string exists but is not parsable
					isAvailableInAnyLocation = true;
					break;
				}
			} else {
				// No hour specified, but location is open on this day
				isAvailableInAnyLocation = true;
				break;
			}
		}

		return isAvailableInAnyLocation;
	}

	// No location hours configured: fall back to standard business hours (9-5, Mon-Fri)
	// so booking still works for companies that haven't set up locations yet. This mirrors
	// the after-hours deferral fallback below.
	if (reqDay) {
		if (reqDay === 'Sat' || reqDay === 'Sun') return false;
		if (reqHour24 === -1) return true; // weekday, no specific time requested
		return reqHour24 >= 9 && reqHour24 < 17;
	}

	// Couldn't determine the requested day → don't claim availability.
	return false;
}

// Formats an ISO string (e.g. 2023-10-25T14:00:00) into a readable date/time. Leaves relative strings alone.
function formatDatetime(datetimeStr: string): string {
    const d = new Date(datetimeStr);
    if (!isNaN(d.getTime()) && datetimeStr.includes('T')) {
        return d.toLocaleString('en-US', {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
        }).replace(/, 20\d\d/, ''); // optionally strip the year for casual SMS
    }
    return datetimeStr;
}

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
	const companyNumber = toE164(commLog.destination || '');
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
	const messageText = `${commLog.content || ''} ${commLog.summary || metadata.summary || ''}`
		.toLowerCase()
		.trim();
	const urgencyStr = (metadata.urgency ?? '').toString().toLowerCase();
	const hasAny = (kw: string[]) => kw.some((k) => messageText.includes(k));
	const EMERGENCY_KW = ['emergency', 'urgent', 'burst', 'flood', 'leak', 'gas leak', 'fire', 'no water', 'no heat', 'right away', 'immediately', 'asap'];
	const BILLING_KW = ['balance', 'owe', 'invoice', 'my bill', 'pay my bill', 'account balance', 'outstanding', 'how much do i'];
	const SALES_KW = ['appointment', 'book', 'schedule', 'quote', 'estimate', 'interested in', 'pricing', 'install'];

	const digitCategory: 'billing' | 'sales' | 'support' | null =
		digit === '1' ? 'billing' : digit === '2' ? 'sales' : digit === '3' ? 'support' : null;

	// Classify by what they actually SAID. Only when there's no usable message do we fall
	// back to the digit they pressed.
	const hasMessage = messageText.length > 3;
	let messageCategory: 'emergency' | 'billing' | 'sales' | 'support';
	if (urgencyStr === 'high' || hasAny(EMERGENCY_KW)) messageCategory = 'emergency';
	else if (hasAny(BILLING_KW)) messageCategory = 'billing';
	else if (hasAny(SALES_KW)) messageCategory = 'sales';
	else if (hasMessage) messageCategory = 'support';
	else messageCategory = digitCategory ?? 'support';

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
		// Check calendar for availability (mocked: check if datetime is within 9-5 or location hours)
		if (datetime) {
			const formattedDatetime = formatDatetime(datetime);
			const isAvailable = checkCalendarAvailability(datetime, company.locations || []);
			if (isAvailable) {
				draftedResponse = `Hi! Thanks for reaching out to ${company.name || 'us'}. We see you'd like to book an appointment for ${formattedDatetime}. A representative will confirm this time with you shortly.`;
			} else {
				draftedResponse = `Hi! Thanks for reaching out to ${company.name || 'us'}. Unfortunately, ${formattedDatetime} is outside our normal business hours or unavailable. What other day or time works best for you?`;
			}
		} else {
			draftedResponse = `Hi! Thanks for contacting ${company.name || 'us'}. We received your booking request. What day and time works best for you?`;
		}
	}

	// --- SUPPORT (default — and where reclassified non-billing/non-sales calls land) ---
	else {
		console.log('[Orchestrator] Detected Support request.');
		draftedResponse = `Hi ${customer.name || 'there'}, thanks for reaching out to ${company.name || 'us'}. We received your message and a support agent will get back to you shortly.`;
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
					deferred_after_hours: shouldDefer
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
