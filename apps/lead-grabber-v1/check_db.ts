import { PrismaClient } from 'clearsky-db-client';
const prisma = new PrismaClient();

async function check() {
    const logs = await prisma.communicationLog.findMany({
        where: {
            source: { startsWith: '+1909' }
        },
        orderBy: { created: 'desc' },
        take: 3,
        include: {
            communicationThread: true
        }
    });

    console.log("Found", logs.length, "logs for test numbers:");
    
    logs.reverse().forEach(log => {
        console.log(`\nLog ID: ${log.id}`);
        console.log(`Content: "${log.content}"`);
        console.log(`Metadata Thread ID (UI): ${log.metadata?.thread_id}`);
        console.log(`Actual DB Thread ID (commId): ${log.communicationThreadId}`);
    });
    
    await prisma.$disconnect();
}

check();
