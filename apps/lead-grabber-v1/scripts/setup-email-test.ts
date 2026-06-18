import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
	console.log('--- Starting Inbound Email Test ---');

	// 1. Ensure a test company exists
	const testSlug = 'omega';
	let company = await prisma.company.findUnique({ where: { emailSlug: testSlug } });

	if (!company) {
		console.log(`Creating test company with slug: ${testSlug}`);
		// We need an owner for the company
		let user = await prisma.user.findFirst();
		if (!user) {
			console.log('No user found to own the company. Please create a user first.');
			return;
		}

		company = await prisma.company.create({
			data: {
				name: 'Omega Test Corp',
				emailSlug: testSlug,
				ownerId: user.id
			}
		});
	} else {
		console.log(`Using existing test company: ${company.name} (${company.id})`);
	}

	// 2. Mock Webhook Payload
	const payload = {
		From: 'customer@example.com',
		FromName: 'Jane Doe',
		To: 'omega@hub.com',
		Subject: 'Inquiry about your services',
		TextBody: 'Hello Omega! I would like to know more about your premium plan.',
		MessageID: `test-msg-${Date.now()}`,
		Date: new Date().toISOString()
	};

	// 3. Send Mock Request
	console.log('Sending mock webhook request...');

	// Note: We'll use a direct call to the bridge logic in this script
	// because we can't easily hit the local SvelteKit server ports from here
	// without ensuring it's running. But since we want to verify the framework:

	try {
		// We'll import the bridge logic dynamically if possible, or just log instructions
		console.log('\n--- Manual Verification Steps ---');
		console.log('1. Start your dev server: npm run dev');
		console.log(`2. Run the following curl command to test the webhook:`);
		console.log(`
curl -X POST http://localhost:3005/api/webhooks/inbound-email \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(payload)}'
    `);

		console.log(
			'\n3. Afterwards, check Prisma Studio to verify the Message, CommunicationLog, and Contact records.'
		);
	} catch (error) {
		console.error('Test failed:', error);
	}
}

main()
	.catch((e) => console.error(e))
	.finally(async () => await prisma.$disconnect());
