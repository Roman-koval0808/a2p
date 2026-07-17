import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/db';
import { requireAuth, unauthorized } from '$lib/api/spec';

function toSpecType(t: string) {
	if (t === 'voice') return 'call';
	if (t === 'sms' || t === 'email') return t;
	return 'call';
}

function meta(l: { metadata?: unknown }) {
	return (l.metadata as Record<string, string>) ?? {};
}

export const GET: RequestHandler = async ({ params, locals }) => {
	const auth = requireAuth(locals);
	if (!auth) return unauthorized();

	const log = await prisma.communicationLog.findFirst({
		where: { id: params.id, companyId: auth.companyId },
		include: {
			customer: { select: { name: true, phone: true, email: true, companyName: true } },
			assignedMembers: { include: { user: { select: { name: true } } } }
		}
	});
	if (!log) {
		return json(
			{ success: false, error: 'Communication log not found', code: 404 },
			{ status: 404 }
		);
	}

	const m = meta(log);
	const firstAssigned = log.assignedMembers?.[0]?.user?.name ?? null;
	const status = m.assignmentStatus ?? (firstAssigned ? 'assigned_to_agent' : 'unassigned');
	const data = {
		id: log.id,
		commId: m.commId ?? (log.communicationThreadId ? `COMM-${log.created.getFullYear()}-${log.communicationThreadId.slice(-6).toUpperCase()}` : `COMM-${log.created.getFullYear()}-${log.id.slice(-6).toUpperCase()}`),
		type: toSpecType(log.type),
		direction: log.direction,
		contactName: log.customer?.name ?? null,
		contactPhone: log.customer?.phone ?? log.destination ?? log.source,
		contactEmail: log.customer?.email ?? null,
		company: log.customer?.companyName ?? null,
		source: log.source,
		endpoint: log.destination,
		status,
		department: m.department ?? null,
		assignedAgent: m.assignedAgent ?? firstAssigned,
		duration: log.duration ?? null,
		message: log.type === 'sms' ? log.content : null,
		subject: log.type === 'email' ? log.summary : null,
		ivrDetails: m.ivrDetails ?? null,
		timestamp: log.created.toISOString(),
		createdAt: log.created.toISOString(),
		updatedAt: log.updated.toISOString()
	};
	return json({ success: true, data });
};

// Edit a pending draft (content / email subject) before approval.
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const auth = requireAuth(locals);
	if (!auth) return unauthorized();
	const log = await prisma.communicationLog.findFirst({
		where: { id: params.id, companyId: auth.companyId }
	});
	if (!log) return json({ success: false, error: 'Communication log not found' }, { status: 404 });
	if (log.status !== 'pending_approval') {
		return json({ success: false, error: 'Only pending drafts can be edited' }, { status: 400 });
	}
	const body = await request.json().catch(() => ({}) as any);
	const data: Record<string, unknown> = {};
	if (typeof body.content === 'string') data.content = body.content;
	if (typeof body.subject === 'string') {
		const md = (log.metadata as Record<string, unknown>) || {};
		data.metadata = { ...md, subject: body.subject };
		if (log.type === 'email') data.summary = body.subject;
	}
	if (!Object.keys(data).length) {
		return json({ success: false, error: 'Nothing to update (content/subject)' }, { status: 400 });
	}
	const updated = await prisma.communicationLog.update({ where: { id: log.id }, data });
	return json({ success: true, data: { id: updated.id } });
};
