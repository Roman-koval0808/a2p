import { PrismaClient } from 'clearsky-db-client';
const prisma = new PrismaClient();
async function main() {
	const res = await prisma.message.deleteMany({});
	console.log('Deleted all inbox messages:', res.count);
}
main().finally(() => prisma.$disconnect());
