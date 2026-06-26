import { PrismaClient } from 'clearsky-db-client';
import { logCommunication } from './src/lib/utils/communication-log.js';

const prisma = new PrismaClient();

async function test() {
    const entry = {
        type: 'sms',
        direction: 'inbound',
        status: 'success',
        source: '+19095551234',
        destination: '+17059985691',
        company_id: 'cmkwntxej0004g1tiwmwbgazn', // Marie INC from previous logs
        customer_id: null,
        summary: 'Test summary',
        content: 'Test content',
        metadata: {
            thread_id: '+19095551234'
        }
    };

    const result = await logCommunication(entry as any);
    console.log("Resulting Log ID:", result.id);
    
    const dbLog = await prisma.communicationLog.findUnique({
        where: { id: result.id }
    });
    console.log("DB Thread ID:", dbLog?.communicationThreadId);
    
    await prisma.$disconnect();
}

test();
