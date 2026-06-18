import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
	const res = await prisma.message.deleteMany({
		where: {
			NOT: {
				threadId: {
					startsWith: 'emergency-'
				}
			}
		}
	});
	console.log('Deleted mock messages:', res.count);
}
main().finally(() => prisma.$disconnect());
