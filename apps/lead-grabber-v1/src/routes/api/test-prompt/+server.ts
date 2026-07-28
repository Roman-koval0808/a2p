import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/db';
import { process_orchestrator } from '$lib/server/orchestrator';
import { analyzeCallLog } from '$lib/server/openai';

const DEFAULT_TRANSCRIPT =
	"Thank you for calling Total Trades. To connect you with the right department, press 1 for billing, press 2 for sales, press 3 for support. For billing, press 1. For sales, press 2. For support... Hello, hey Roman. Okay, so you are interested in buying the car and you want to take the other for test drive, right? Okay, so I'm going to... We have an offering at 10 o'clock on Tuesday, August 4th for test drive. So, let me book an appointment. I want your email as roman.gobalenco.0808 at our... Is it correct? Yeah, okay, so I'm going to send you an email and we are going to book you an appointment for Tuesday, August 4th at 10am. Okay, I look forward to talking to you. Alright, we will see how this works out.";

/**
 * Dry-run harness: inject a voicemail transcript into the pipeline WITHOUT a phone.
 *
 * The original version crashed (`prisma.customerProfile` is not a model, and it used snake_case
 * columns / a bad enum value). It also called process_orchestrator with EMPTY metadata, so the
 * sales branch had no datetime/email to act on and never drafted anything.
 *
 * This mirrors the real Telnyx call webhook: run analyzeCallLog(), persist datetime +
 * ai_extracted_email into metadata, THEN hand off to the orchestrator.
 *
 * Query params: ?transcript=... &digit=2 (2=sales,3=support,1=billing) &phone=+1705...
 */
export const GET: RequestHandler = async ({ url }) => {
	const transcript = url.searchParams.get('transcript') || DEFAULT_TRANSCRIPT;
	const ivrDigit = url.searchParams.get('digit') || '2'; // 2 = sales
	const customerPhone = url.searchParams.get('phone') || '+17055550123';

	const company = await prisma.company.findFirst();
	if (!company) {
		return json({ error: 'No company in DB. Seed a company first.' }, { status: 400 });
	}

	// CommunicationLog.customer is a Contact — reuse or create one for the caller.
	let contact = await prisma.contact.findFirst({
		where: { companyId: company.id, phone: customerPhone }
	});
	if (!contact) {
		contact = await prisma.contact.create({
			data: { companyId: company.id, name: 'Test Caller', phone: customerPhone }
		});
	}

	// A destination the orchestrator can resolve to the company (falls back to a literal E.164).
	const companyNumber = await prisma.companyPhoneNumber.findFirst({
		where: { companyId: company.id },
		select: { phoneNumber: true }
	});
	const destination = companyNumber?.phoneNumber || '+15555555555';

	try {
		// 1) Analyze exactly like the webhook, so metadata carries datetime + email + intent.
		const analysis = await analyzeCallLog(transcript);

		// 2) Persist the log with that metadata.
		const log = await prisma.communicationLog.create({
			data: {
				type: 'voice',
				direction: 'inbound',
				status: 'completed',
				source: customerPhone,
				destination,
				companyId: company.id,
				customerId: contact.id,
				summary: analysis.summary || 'Voicemail Received',
				content: transcript,
				duration: 60,
				metadata: {
					ivr_digit: ivrDigit,
					intent:
						ivrDigit === '2' ? 'sales' : ivrDigit === '3' ? 'support' : ivrDigit === '1' ? 'billing' : undefined,
					datetime: analysis.datetime || undefined,
					ai_extracted_email: analysis.ai_extracted_email || undefined,
					sub_intent: analysis.sub_intent || undefined,
					summary: analysis.summary || undefined
				}
			}
		});

		// 3) Run the orchestrator (drafts the email/SMS + tentative hold into the approval queue).
		await process_orchestrator(log.id, 'ai_ready');

		// 4) Surface the resulting draft so the caller can see it worked end-to-end.
		const container = await prisma.commContainer.findFirst({
			where: { companyId: company.id, contactId: contact.id, state: { not: 'closed' } },
			orderBy: { openedAt: 'desc' }
		});
		const drafts = container
			? await prisma.commApproval.findMany({
					where: { commId: container.id },
					orderBy: { createdAt: 'desc' },
					take: 3
				})
			: [];

		return json({
			success: true,
			logId: log.id,
			analysis: {
				datetime: analysis.datetime,
				ai_extracted_email: analysis.ai_extracted_email,
				sub_intent: analysis.sub_intent
			},
			container: container ? { commRef: container.commRef, threadType: container.threadType } : null,
			drafts: drafts.map((a) => ({
				id: a.id,
				draftType: a.draftType,
				state: a.state,
				contextPayload: a.contextPayload,
				preview: (a.draftContent || '').slice(0, 200)
			}))
		});
	} catch (e: any) {
		console.error('[Test Endpoint Error]', e);
		return json({ error: e.message || 'Error occurred' }, { status: 500 });
	}
};
