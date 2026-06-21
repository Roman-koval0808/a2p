import { PrismaClient } from 'clearsky-db-client';
const prisma = new PrismaClient();
async function main() {
	const records = await prisma.message.findMany();
	console.log('Messages in DB:', JSON.stringify(records, null, 2));

	const logs = await prisma.communicationLog.findMany();
	console.log('Communication Logs in DB:', JSON.stringify(logs, null, 2));

	const contacts = await prisma.contact.findMany();
	console.log('Contacts in DB:', JSON.stringify(contacts, null, 2));
}
main().finally(() => prisma.$disconnect());
