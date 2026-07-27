import { json } from '@sveltejs/kit';
import { prisma } from '$lib/db';
import { sweepTimers } from '$lib/server/timer/timer-service';

export async function POST({ params }) {
	const logId = params.id;
	
	try {
		const comm = await prisma.communicationLog.findUnique({
			where: { id: logId }
		});
		
		if (!comm) {
			return json({ error: 'Communication log not found' }, { status: 404 });
		}
		
		// Timer commId could be the thread ID or the log ID itself
		const possibleIds = [comm.communicationThreadId, comm.id].filter(Boolean) as string[];
		
		const result = await prisma.pipelineTimer.updateMany({
			where: { 
				commId: { in: possibleIds },
				status: 'registered',
				type: 'calendar_grace'
			},
			data: {
				fireAt: new Date(Date.now() - 1000)
			}
		});
		
		if (result.count > 0) {
			// Trigger processing immediately
			await sweepTimers();
			return json({ success: true, message: 'Timer fast-forwarded and processed.' });
		} else {
			return json({ error: 'No active timer found for this thread' }, { status: 404 });
		}
	} catch (e: any) {
		console.error('[FastForwardTimer] Error:', e);
		return json({ error: e.message }, { status: 500 });
	}
}
