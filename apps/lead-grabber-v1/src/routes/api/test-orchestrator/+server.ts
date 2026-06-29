import { json } from '@sveltejs/kit';
import { prisma } from '$lib/db';
import { process_orchestrator } from '$lib/server/orchestrator';

export async function GET({ url }) {
    const id = url.searchParams.get('id');
    if (!id) {
        const comms = await prisma.communicationLog.findMany({
            orderBy: { created: 'desc' },
            take: 5,
            select: { id: true, content: true, customerId: true, communicationThreadId: true }
        });
        return json({ comms });
    }
    
    await process_orchestrator(id, 'test');
    
    const updated = await prisma.communicationLog.findUnique({ where: { id } });
    return json({ updated });
}
