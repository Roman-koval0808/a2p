import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/db';
import { syncCompanyEmails } from '$lib/server/email/gmail-sync';

/**
 * Sweep endpoint to sync emails from connected Google Accounts.
 * Intended to be called via cron job or external scheduler.
 */
export const POST: RequestHandler = async () => {
	try {
		console.log('[emails sweep] Starting Gmail sync sweep');
		
		const connections = await prisma.googleCalendarConnection.findMany({
			where: { refreshToken: { not: null } },
			select: { companyId: true }
		});

		const results = [];
		for (const conn of connections) {
			const res = await syncCompanyEmails(conn.companyId);
			results.push({ companyId: conn.companyId, ...res });
		}

		console.log('[emails sweep] Completed sweep', results);
		return json({ ok: true, results });
	} catch (error: any) {
		console.error('[emails sweep] Error:', error);
		return json({ ok: false, error: error?.message || 'Email sweep failed' }, { status: 500 });
	}
};
