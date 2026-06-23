import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/db';

export const POST: RequestHandler = async ({ locals }) => {
	if (!locals.user || !locals.user.company) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const companyId = locals.user.company.id;

	try {
		// 1. Wipe local Prisma database
		await prisma.$transaction([
			prisma.message.deleteMany({ where: { companyId } }),
			prisma.contact.deleteMany({ where: { companyId } })
		]);

		// 2. Wipe ProfileDB (CDP) database
		const profileDbUrl = process.env.PROFILEDB_URL || 'http://localhost:6277';
		const profileDbRes = await fetch(`${profileDbUrl}/api/v1/tenants/${companyId}/clear`, {
			method: 'POST'
		});

		if (!profileDbRes.ok) {
			console.warn('ProfileDB wipe failed or returned non-ok status', await profileDbRes.text());
		}

		return json({ success: true, message: 'All company profiles and messages wiped successfully.' });
	} catch (error: any) {
		console.error('Error wiping company data:', error);
		return json({ error: 'Failed to wipe company data', details: error.message }, { status: 500 });
	}
};
