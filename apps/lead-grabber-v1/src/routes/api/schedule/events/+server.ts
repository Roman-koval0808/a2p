import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/db';
import { requireAuth, unauthorized } from '$lib/api/spec';

function toSpecEvent(e: {
	id: string;
	title: string;
	description: string | null;
	startTime: Date;
	endTime: Date;
	color: string | null;
}) {
	return {
		id: e.id,
		title: e.title,
		description: e.description ?? '',
		startTime: e.startTime.toISOString(),
		endTime: e.endTime.toISOString(),
		color: e.color ?? 'blue'
	};
}

export const GET: RequestHandler = async ({ url, locals }) => {
	const auth = requireAuth(locals);
	if (!auth) return unauthorized();

	const startDate = url.searchParams.get('startDate');
	const endDate = url.searchParams.get('endDate');
	const where: { companyId: string; startTime?: { gte?: Date; lte?: Date } } = {
		companyId: auth.companyId
	};
	if (startDate) {
		where.startTime = { ...where.startTime, gte: new Date(startDate) };
	}
	if (endDate) {
		where.startTime = { ...where.startTime, lte: new Date(endDate) };
	}

	const events = await prisma.scheduleEvent.findMany({
		where,
		orderBy: { startTime: 'asc' }
	});
	return json({ success: true, data: events.map(toSpecEvent) });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	const auth = requireAuth(locals);
	if (!auth) return unauthorized();

	const body = await request.json().catch(() => ({}));
	const title = typeof body.title === 'string' ? body.title.trim() : '';
	const description = typeof body.description === 'string' ? body.description.trim() : null;
	const startTime = body.startTime ? new Date(body.startTime) : null;
	const endTime = body.endTime ? new Date(body.endTime) : null;
	const color = ['blue', 'red', 'pink'].includes(body.color) ? body.color : 'blue';

	if (!title || !startTime || !endTime) {
		return json(
			{ success: false, error: 'title, startTime, and endTime are required', code: 400 },
			{ status: 400 }
		);
	}

	const event = await prisma.scheduleEvent.create({
		data: {
			companyId: auth.companyId,
			title,
			description: description ?? undefined,
			startTime,
			endTime,
			color
		}
	});
	return json(
		{ success: true, data: toSpecEvent(event), message: 'Event created successfully' },
		{ status: 201 }
	);
};
