import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/db';
import { toE164 } from '$lib/company-numbers';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user?.company?.id) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}
	try {
		const numbers = await prisma.companyPhoneNumber.findMany({
			where: { companyId: locals.user.company.id },
			include: {
				callFlow: { select: { id: true, title: true } },
				callTrackingCategory: { select: { id: true, name: true } }
			},
			orderBy: { created: 'asc' }
		});
		return json({ success: true, numbers });
	} catch (e) {
		console.error('Company numbers list:', e);
		return json({ success: false, error: 'Failed to list numbers' }, { status: 500 });
	}
};

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user?.company?.id) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}
	try {
		const body = await request.json();
		const phoneNumber = toE164((body.phoneNumber as string) ?? '');
		const telnyxPhoneNumberId = body.telnyxPhoneNumberId as string | undefined;
		const connectionLabel = body.connectionLabel as string | undefined;
		if (!phoneNumber) {
			return json({ error: 'phoneNumber is required' }, { status: 400 });
		}
		const created = await prisma.companyPhoneNumber.create({
			data: {
				companyId: locals.user.company.id,
				phoneNumber,
				...(telnyxPhoneNumberId && { telnyxPhoneNumberId }),
				...(connectionLabel && { connectionLabel })
			}
		});
		return json({ success: true, number: created });
	} catch (e: unknown) {
		const msg =
			e && typeof e === 'object' && 'code' in e && (e as { code: string }).code === 'P2002'
				? 'This number is already assigned to a company'
				: 'Failed to assign number';
		console.error('Company numbers assign:', e);
		return json({ success: false, error: msg }, { status: 500 });
	}
};
