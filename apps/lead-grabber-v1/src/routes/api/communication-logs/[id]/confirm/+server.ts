import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/db';
import { requireAuth, unauthorized } from '$lib/api/spec';

export const POST: RequestHandler = async ({ params, locals }) => {
	const auth = requireAuth(locals);
	if (!auth) return unauthorized();

	try {
		const log = await prisma.communicationLog.findFirst({
			where: { id: params.id, companyId: auth.companyId }
		});

		if (!log) {
			return json({ success: false, error: 'Communication log not found' }, { status: 404 });
		}

		if (log.status !== 'pending_approval') {
			return json({ success: false, error: 'Communication log is not pending approval' }, { status: 400 });
		}

		// Update the log status to completed (simulating dispatch)
		const updatedLog = await prisma.communicationLog.update({
			where: { id: log.id },
			data: { status: 'completed' } 
		});

		if (updatedLog.communicationThreadId) {
			await prisma.communicationThread.update({
				where: { id: updatedLog.communicationThreadId },
				data: { status: 'open' }
			});
		}

		return json({ success: true, data: updatedLog });
	} catch (error) {
		console.error('Error confirming communication log:', error);
		return json({ success: false, error: 'Internal server error' }, { status: 500 });
	}
};
