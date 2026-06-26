import { PrismaClient } from 'clearsky-db-client';
const prisma = new PrismaClient();

async function check() {
    const voiceLogs = await prisma.communicationLog.findMany({
        where: { type: 'voice' },
        orderBy: { created: 'desc' },
        take: 5
    });

    console.log("Found", voiceLogs.length, "voice logs:");
    voiceLogs.forEach(log => {
        console.log(`\nLog ID: ${log.id} | Type: ${log.type} | Direction: ${log.direction}`);
        console.log(`Source: ${log.source} | Destination: ${log.destination}`);
        console.log(`Content: "${log.content}"`);
    });

    const smsLogs = await prisma.communicationLog.findMany({
        where: { type: 'sms' },
        orderBy: { created: 'desc' },
        take: 5
    });

    console.log("\nFound", smsLogs.length, "sms logs:");
    smsLogs.forEach(log => {
        console.log(`\nLog ID: ${log.id} | Type: ${log.type} | Direction: ${log.direction}`);
        console.log(`Source: ${log.source} | Destination: ${log.destination}`);
        console.log(`Content: "${log.content}"`);
    });
    
    await prisma.$disconnect();
}

check();
