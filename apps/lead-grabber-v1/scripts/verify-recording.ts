import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
	const contactNumber = process.argv[2]; // caller (contact)
	const recordingUrl = process.argv[3];

	if (!contactNumber || !recordingUrl) {
		console.error('Usage: npx tsx scripts/verify-recording.ts <contact_phone> <audio_url>');
		console.error(
			'Example: npx tsx scripts/verify-recording.ts +7624728899 https://example.com/rec.mp3'
		);
		process.exit(1);
	}

	const callId = 'test-call-' + Date.now();

	// Get any company number (the line that "received" the call), or create company + number
	const existingCompanyNumber = await prisma.companyPhoneNumber.findFirst({
		include: { company: true }
	});

	let companyNumber: string;
	if (existingCompanyNumber) {
		companyNumber = existingCompanyNumber.phoneNumber;
		console.log(`Using existing company: ${existingCompanyNumber.company.name}`);
		console.log(`Company line (to): ${companyNumber}`);
		console.log(`Contact/caller (from): ${contactNumber}`);
		console.log(`Call ID: ${callId}`);
	} else {
		const user = await prisma.user.findFirst();
		if (!user) {
			console.error('No user found to own company. Please create a user first.');
			return;
		}
		const companyName = 'Test Company ' + Date.now();
		companyNumber = '+1555000' + Math.floor(Math.random() * 9000 + 1000);
		console.log(`Creating test data...`);
		console.log(`Company: ${companyName}`);
		console.log(`Company line (to): ${companyNumber}`);
		console.log(`Contact/caller (from): ${contactNumber}`);
		console.log(`Call ID: ${callId}`);

		const company = await prisma.company.create({
			data: { name: companyName, ownerId: user.id }
		});
		await prisma.companyPhoneNumber.create({
			data: { companyId: company.id, phoneNumber: companyNumber }
		});
	}

	// CallLog: inbound = from contact to company line
	await prisma.callLog.create({
		data: {
			callId,
			status: 'initiated',
			to: companyNumber,
			from: contactNumber,
			metadata: { direction: 'incoming' }
		}
	});

	console.log('\nData created!');
	console.log('Now run the following CURL command to simulate the webhook:');
	console.log('\n---------------------------------------------------------');
	console.log(`curl -X POST http://localhost:5173/api/telnyx/call-webhook \\
  -H "Content-Type: application/json" \\
  -d '{
    "call_control_id": "${callId}",
    "recording_id": "rec_${Date.now()}",
    "recording_urls": {
      "mp3": "${recordingUrl}"
    },
    "duration": 15,
    "event_type": "call.recording.saved"
  }'`);
	console.log('---------------------------------------------------------\n');
	console.log('After running the curl, check the DB for a new Contact and CommunicationLog:');
	console.log(`npx prisma studio`);
}

main()
	.catch((e) => {
		console.error(e);
		process.exit(1);
	})
	.finally(async () => {
		await prisma.$disconnect();
	});
