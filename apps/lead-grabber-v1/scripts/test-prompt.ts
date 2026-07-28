import { prisma } from '../src/lib/db.js';
import { process_orchestrator } from '../src/lib/server/orchestrator.js';

async function testPrompt() {
	const transcript =
		"Thank you for calling Total Trades. To connect you with the right department, press 1 for billing, press 2 for sales, press 3 for support. For billing, press 1. For sales, press 2. For support... Hello, hey Roman. Okay, so you are interested in buying the car and you want to take the other for test drive, right? Okay, so I'm going to... We have an offering at 10 o'clock on Tuesday, August 4th for test drive. So, let me book an appointment. I want your email as roman.kovalenko.0808@outlook.com ... Is it correct? Yeah, okay, so I'm going to send you an email and we are going to book you an appointment for Tuesday, August 4th at 10am. Okay, I look forward to talking to you. Alright, we will see how this works out.";

	console.log('\n--- TESTING SALES VOICEMAIL BOOKING WITH YOUR PROMPT ---');
	console.log(`[Transcript]: "${transcript}"\n`);

	// We need a customer and company. We'll pick the first ones in the DB for the test.
	const company = await prisma.company.findFirst();
	const customer = await prisma.customerProfile.findFirst();

	if (!company || !customer) {
		console.log('No company or customer in DB. Please run this in a seeded environment.');
		return;
	}

	// 1. Create the communication log (simulating the call ending)
	const log = await prisma.communicationLog.create({
		data: {
			type: 'call',
			direction: 'inbound',
			status: 'completed',
			source: customer.phoneNumber,
			destination: '+15555555555', // dummy
			company_id: company.id,
			customer_id: customer.id,
			summary: 'Voicemail Received',
			content: transcript,
			duration: 60,
			sentiment: 'neutral'
		}
	});
	console.log(`[DB] Created CommunicationLog ID: ${log.id}`);

	// 2. Run the Orchestrator to trigger AI extraction and scenario processing
	console.log('[Orchestrator] Running full AI pipeline (this may take a few seconds)...');
	try {
		await process_orchestrator(log.id, 'ai_ready');
		console.log('\n✅ [Success] AI Orchestration finished.');
		console.log('Check your dashboard! You should see an Email Draft pending approval.');
		console.log('Approving it will now book it in Google Calendar.');
	} catch (e) {
		console.error('\n❌ [Error]', e);
	}
}

testPrompt()
	.then(() => {
		console.log('\nTest completed.');
		process.exit(0);
	})
	.catch(console.error);
