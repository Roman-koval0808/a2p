import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
	const number = '+12016277128';
	const record = await prisma.companyPhoneNumber.findFirst({
		where: { phoneNumber: number }
	});
	console.log('Record for +12016277128:', record);
}

main()
	.catch((e) => console.error(e))
	.finally(async () => {
		await prisma.$disconnect();
	});
