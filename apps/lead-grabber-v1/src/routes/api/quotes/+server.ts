import { json, type RequestHandler } from '@sveltejs/kit';
import { prisma } from '$lib/db';
import { resolveCompanyId } from '$lib/server/viewroom';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		return json({ success: false, message: 'Unauthorized' }, { status: 401 });
	}

	const companyId = resolveCompanyId(locals.user);
	if (!companyId) {
		return json({ success: false, message: 'Unauthorized' }, { status: 401 });
	}

	try {
		const body = (await request.json()) as {
			first_name?: string;
			last_name?: string;
			phone?: string;
			email?: string;
			description?: string;
		};
		const quote = await prisma.viewroomQuote.create({
			data: {
				firstName: body.first_name ?? null,
				lastName: body.last_name ?? null,
				phone: body.phone ?? null,
				email: body.email ?? null,
				description: body.description ?? null,
				toCompanyId: companyId
			}
		});

		return json({
			success: true,
			quote: {
				id: quote.id,
				first_name: quote.firstName,
				last_name: quote.lastName,
				phone: quote.phone,
				email: quote.email,
				description: quote.description
			},
			ownerEmail: locals.user.email ?? null
		});
	} catch (e) {
		console.error('Error creating quote:', e);
		return json({ success: false, message: 'Failed to create quote' }, { status: 500 });
	}
};