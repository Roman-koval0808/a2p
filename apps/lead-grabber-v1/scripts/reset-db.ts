import 'dotenv/config';
import { PrismaClient } from 'clearsky-db-client';
const prisma = new PrismaClient();

async function main() {
	console.log('🧹 Cleaning database...');
	
	const msgs = await prisma.message.deleteMany({});
	console.log(`✅ Deleted ${msgs.count} Messages`);
	
	const contacts = await prisma.contact.deleteMany({});
	console.log(`✅ Deleted ${contacts.count} Contacts`);
	
	console.log('Done!');
}

main()
	.catch((e) => {
		console.error(e);
		process.exit(1);
	})
	.finally(async () => {
		await prisma.$disconnect();
	});
