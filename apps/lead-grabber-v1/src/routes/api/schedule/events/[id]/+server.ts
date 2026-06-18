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

export const PUT: RequestHandler = async ({ params, request, locals }) => {
	const auth = requireAuth(locals);
	if (!auth) return unauthorized();

	const event = await prisma.scheduleEvent.findFirst({
		where: { id: params.id, companyId: auth.companyId }
	});
	if (!event) {
		return json({ success: false, error: 'Event not found', code: 404 }, { status: 404 });
	}

	const body = await request.json().catch(() => ({}));
	const data: {
		title?: string;
		description?: string;
		startTime?: Date;
		endTime?: Date;
		color?: string;
	} = {};
	if (typeof body.title === 'string') data.title = body.title.trim();
	if (typeof body.description === 'string') data.description = body.description.trim();
	if (body.startTime) data.startTime = new Date(body.startTime);
	if (body.endTime) data.endTime = new Date(body.endTime);
	if (['blue', 'red', 'pink'].includes(body.color)) data.color = body.color;

	const updated = await prisma.scheduleEvent.update({
		where: { id: params.id },
		data
	});
	return json({
		success: true,
		data: toSpecEvent(updated),
		message: 'Event updated successfully'
	});
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	const auth = requireAuth(locals);
	if (!auth) return unauthorized();

	const event = await prisma.scheduleEvent.findFirst({
		where: { id: params.id, companyId: auth.companyId }
	});
	if (!event) {
		return json({ success: false, error: 'Event not found', code: 404 }, { status: 404 });
	}
	await prisma.scheduleEvent.delete({ where: { id: params.id } });
	return json({ success: true, message: 'Event deleted successfully' });
};
