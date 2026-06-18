import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
	const records = await prisma.companyPhoneNumber.findMany({
		select: {
			id: true,
			companyId: true,
			phoneNumber: true
		}
	});
	console.log('Company Numbers in DB (safe):', records);
}
main().finally(() => prisma.$disconnect());
