import { PrismaClient } from 'clearsky-db-client';
const prisma = new PrismaClient();
async function main() {
	const records = await prisma.message.findMany();
	console.log('Messages in DB:', JSON.stringify(records, null, 2));
}
main().finally(() => prisma.$disconnect());
