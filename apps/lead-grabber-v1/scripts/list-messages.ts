import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
	const records = await prisma.message.findMany();
	console.log('Messages in DB:', records.map(r => ({ id: r.id, threadId: r.threadId, customerName: r.customerName })));
}
main().finally(() => prisma.$disconnect());
