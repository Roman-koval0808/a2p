import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/db';
import { process_orchestrator } from '$lib/server/orchestrator';

export const GET: RequestHandler = async () => {
	const transcript = "Thank you for calling Total Trades. To connect you with the right department, press 1 for billing, press 2 for sales, press 3 for support. For billing, press 1. For sales, press 2. For support... Hello, hey Roman. Okay, so you are interested in buying the car and you want to take the other for test drive, right? Okay, so I'm going to... We have an offering at 10 o'clock on Tuesday, August 4th for test drive. So, let me book an appointment. I want your email as roman.gobalenco.0808 at our... Is it correct? Yeah, okay, so I'm going to send you an email and we are going to book you an appointment for Tuesday, August 4th at 10am. Okay, I look forward to talking to you. Alright, we will see how this works out.";
	
	const company = await prisma.company.findFirst();
	const customer = await prisma.customerProfile.findFirst();

	if (!company || !customer) {
		return json({ error: 'No company or customer in DB. Please run in a seeded environment.' }, { status: 400 });
	}

	try {
		// 1. Create the communication log
		const log = await prisma.communicationLog.create({
			data: {
				type: 'call',
				direction: 'inbound',
				status: 'completed',
				source: customer.phoneNumber,
				destination: '+15555555555',
				company_id: company.id,
				customer_id: customer.id,
				summary: 'Voicemail Received',
				content: transcript,
				duration: 60,
				sentiment: 'neutral'
			}
		});

		// 2. Run the Orchestrator (we don't await this completely so the response is faster, 
		// but since this is a test endpoint we can await it to show success)
		await process_orchestrator(log.id, 'ai_ready');

		return json({ 
			success: true, 
			message: 'Test prompt injected successfully and Orchestrator has run!',
			logId: log.id 
		});
	} catch (e: any) {
		console.error('[Test Endpoint Error]', e);
		return json({ error: e.message || 'Error occurred' }, { status: 500 });
	}
};
