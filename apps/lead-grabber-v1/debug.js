import { PrismaClient } from 'clearsky-db-client';
const prisma = new PrismaClient();
async function run() {
    const intents = await prisma.scheduledIntent.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5
    });
    console.log(JSON.stringify(intents, null, 2));
}
run();
