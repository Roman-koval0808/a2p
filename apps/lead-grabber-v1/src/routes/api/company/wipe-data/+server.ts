import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/db';
import { clearTenantTelemetry } from '$lib/server/profiledb/telemetry';

export const POST: RequestHandler = async ({ locals }) => {
	if (!locals.user || !locals.user.company) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const companyId = locals.user.company.id;

	try {
		// 1. Wipe local Prisma database
		await prisma.$transaction([
			prisma.communicationLog.deleteMany({ where: { companyId } }),
			prisma.communicationThread.deleteMany({ where: { companyId } }),
			prisma.message.deleteMany({ where: { companyId } }),
			prisma.contact.deleteMany({ where: { companyId } }),
			prisma.notification.deleteMany({ where: { companyId } })
		]);

		// 2. Wipe ProfileDB (CDP) database
		const result = await clearTenantTelemetry({ tenantSlug: companyId });

		if (!(result.status >= 200 && result.status < 300)) {
			console.warn('ProfileDB wipe failed or returned non-ok status', result.body);
		}

		return json({ success: true, message: 'All company profiles and messages wiped successfully.' });
	} catch (error: any) {
		console.error('Error wiping company data:', error);
		return json({ error: 'Failed to wipe company data', details: error.message }, { status: 500 });
	}
};
