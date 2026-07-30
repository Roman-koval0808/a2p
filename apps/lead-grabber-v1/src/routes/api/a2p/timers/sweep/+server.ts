import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { sweepTimers } from '$lib/server/timer/timer-service';
import { syncCompanyEmails } from '$lib/server/email/gmail-sync';
import { prisma } from '$lib/db';

export const POST: RequestHandler = async () => {
	try {
		const result = await sweepTimers();
		
		// Also sweep emails for connected Google Accounts
		const connections = await prisma.googleCalendarConnection.findMany({
			where: { refreshToken: { not: null } },
			select: { companyId: true }
		});
		let emailSyncResults = [];
		for (const conn of connections) {
			try {
				const res = await syncCompanyEmails(conn.companyId);
				emailSyncResults.push({ companyId: conn.companyId, ...res });
			} catch (e) {
				console.error(`[timer-sweep] Failed to sync emails for ${conn.companyId}`, e);
			}
		}

		return json({ ok: true, result, emailSyncResults });
	} catch (error: any) {
		console.error('[API /api/a2p/timers/sweep] Error:', error);
		return json({ ok: false, error: error?.message || 'Timer sweep failed' }, { status: 500 });
	}
};
