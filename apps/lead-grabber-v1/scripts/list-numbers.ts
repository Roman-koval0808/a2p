import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
	const records = await prisma.companyPhoneNumber.findMany();
	console.log('Company Numbers in DB:', records);
}
main().finally(() => prisma.$disconnect());
