import { json } from '@sveltejs/kit';
import { prisma } from '$lib/db';
import { sweepTimers } from '$lib/server/timer/timer-service';

export async function POST({ params }) {
	const logId = params.id;
	
	try {
		const comm = await prisma.communicationLog.findUnique({
			where: { id: logId }
		});
		
		if (!comm || !comm.communicationThreadId) {
			return json({ error: 'Communication log or thread not found' }, { status: 404 });
		}
		
		const result = await prisma.pipelineTimer.updateMany({
			where: { 
				commId: comm.communicationThreadId,
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
