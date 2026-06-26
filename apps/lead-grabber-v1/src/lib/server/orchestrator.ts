import { prisma } from '$lib/db';
import { logCommunication } from '$lib/utils/communication-log';
import { toE164 } from '$lib/company-numbers';
import { UnifiedPipeline } from '$lib/server/pipeline/unified-pipeline';
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

	// Strictly require explicit location availability - no fallbacks
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

	if (!commLog || !commLog.companyId || !commLog.customerId) {
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

	let draftedResponse = '';

	console.log(`[Orchestrator] Debug -> digit: "${digit}", intent: "${intent}", sub_intent: "${sub_intent}"`);

	// --- SCENARIO 1: BILLING ---
	// Trigger: Caller presses 1 (or intent is Billing). Always attempt balance lookup.
	if (digit === '1' || intent?.toLowerCase().includes('billing')) {
		{
			console.log('[Orchestrator] Detected Scenario 1: Billing');
			
			let balance = customer.accountBalance;
			if (balance === null || balance === undefined) {
				const crypto = await import('crypto');
				const hashedPhone = customer.phone ? crypto.createHash('sha256').update(customer.phone).digest('hex') : null;
				const altContact = await prisma.contact.findFirst({
					where: {
						companyId: company.id,
						accountBalance: { not: null },
						OR: [
							...(hashedPhone ? [{ phone: hashedPhone }] : []),
							...(customer.name ? [{ name: customer.name }] : [])
						]
					}
				});
				if (altContact) {
					balance = altContact.accountBalance;
				}
			}

			if (balance !== null && balance !== undefined) {
				draftedResponse = `You currently owe $${balance.toFixed(2)}, Thank you for your business have a nice day.`;
			} else {
				draftedResponse = `Hi ${customer.name || 'there'}, we received your message regarding your account balance. An agent will review your account and reach out shortly.`;
			}
		}
	}

	// --- SCENARIO 2: SALES (Booking Appointment) ---
	// Trigger: Caller presses 2 (or intent is Sales/Booking) AND requested datetime.
	else if (digit === '2' || intent?.toLowerCase().includes('sales') || intent?.toLowerCase().includes('booking')) {
		console.log('[Orchestrator] Detected Scenario 2: Sales / Booking');
		
		// 1. Increase engagement score
		await prisma.contact.update({
			where: { id: customer.id },
			data: { engagementScore: { increment: 10 } }
		});

		// 2. Check calendar for availability (mocked: check if datetime is within 9-5 or location hours)
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

	// If we drafted a response, save it as pending_approval
	if (draftedResponse && companyNumber && customerPhone) {
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

			// Mark as processed
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
			console.error('[Orchestrator] Failed to log pending SMS:', err);
		}
	} else {
		console.log('[Orchestrator] No action taken for this intent.');
	}

	// --- 3. Post-Processing: Thread Similarity Matching ---
	// Compare this commLog's transcript with recent comms for the same customer
	if (commLog.content) {
		const recentComms = await prisma.communicationLog.findMany({
			where: {
				customerId: customer.id,
				id: { not: commId },
				status: 'completed',
				content: { not: null }
			},
			orderBy: { created: 'desc' },
			take: 5
		});

		for (const pastComm of recentComms) {
			if (!pastComm.content) continue;
			const similarity = UnifiedPipeline.calculateSimilarity(commLog.content, pastComm.content);
			if (similarity >= 0.8) {
				console.log(`[Orchestrator] Found similar thread (${Math.round(similarity * 100)}% match). Merging threads.`);
				await prisma.communicationLog.update({
					where: { id: commId },
					data: { communicationThreadId: pastComm.communicationThreadId }
				});
				break;
			}
		}
	}
}
