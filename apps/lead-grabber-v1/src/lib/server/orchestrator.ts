import { prisma } from '$lib/db';
import { logCommunication } from '$lib/utils/communication-log';
import { toE164 } from '$lib/company-numbers';
import { UnifiedPipeline } from '$lib/server/pipeline/unified-pipeline';
// Mock function: checks if a requested datetime is likely within business hours (9-5 M-F)
function checkCalendarMock(datetimeStr: string): boolean {
	const lower = datetimeStr.toLowerCase();
	// Reject weekends
	if (lower.includes('saturday') || lower.includes('sunday')) return false;
	// Reject after-hours (6pm-11pm or 1am-8am)
	if (/[6-9]\s*pm|1[0-1]\s*pm|[1-8]\s*am/.test(lower)) return false;
	return true;
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
		include: { company: true, customer: true }
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

	// --- SCENARIO 1: BILLING (Accounts Receivable) ---
	// Trigger: Caller presses 1 (or intent is Billing) AND sub-intent is AR.
	if (digit === '1' || intent?.toLowerCase().includes('billing')) {
		if (sub_intent?.toLowerCase().includes('receivable') || sub_intent?.toLowerCase().includes('ar') || sub_intent?.toLowerCase().includes('balance')) {
			console.log('[Orchestrator] Detected Scenario 1: Billing / AR');
			
			const balance = customer.accountBalance;
			if (balance !== null && balance !== undefined) {
				draftedResponse = `Hi ${customer.name || 'there'}, this is ${company.name || 'our billing department'}. Your current outstanding balance is $${balance.toFixed(2)}. You can pay online at ${company.website || 'our portal'}. Let us know if you need help!`;
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

		// 2. Check calendar for availability (mocked: check if datetime is within 9-5)
		if (datetime) {
			const formattedDatetime = formatDatetime(datetime);
			const isAvailable = checkCalendarMock(datetime);
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
		const hour = now.getHours();
		const day = now.getDay(); // 0 is Sunday, 6 is Saturday
		const isWeekend = day === 0 || day === 6;
		const isAfterHours = hour < 9 || hour >= 17;
		const shouldDefer = isWeekend || isAfterHours;

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
