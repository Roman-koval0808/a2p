import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/db';
import { requireAuth, unauthorized, pagination } from '$lib/api/spec';

function toSpecType(t: string) {
	if (t === 'voice') return 'call';
	if (t === 'sms' || t === 'email') return t;
	return 'call';
}

export const GET: RequestHandler = async ({ params, url, locals }) => {
	const auth = requireAuth(locals);
	if (!auth) return unauthorized();

	const member = await prisma.companyMember.findFirst({
		where: { userId: params.id, companyId: auth.companyId, status: 'active' }
	});
	if (!member) {
		return json({ success: false, error: 'Representative not found', code: 404 }, { status: 404 });
	}

	const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10));
	const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') ?? '20', 10)));
	const skip = (page - 1) * limit;

	const where = {
		companyId: auth.companyId,
		assignedMembers: { some: { userId: params.id } }
	};
	const [total, logs] = await Promise.all([
		prisma.communicationLog.count({ where }),
		prisma.communicationLog.findMany({
			where,
			skip,
			take: limit,
			orderBy: { created: 'desc' },
			include: {
				customer: { select: { name: true, phone: true, email: true, companyName: true } },
				assignedMembers: { include: { user: { select: { name: true } } } }
			}
		})
	]);

	const meta = (l: { metadata?: unknown }) => (l.metadata as Record<string, string>) ?? {};
	const data = logs.map((l) => {
		const m = meta(l);
		const firstAssigned = l.assignedMembers?.[0]?.user?.name ?? null;
		return {
			id: l.id,
			commId: m.commId ?? (l.communicationThreadId ? `COMM-${l.created.getFullYear()}-${l.communicationThreadId.slice(-6).toUpperCase()}` : `COMM-${l.created.getFullYear()}-${l.id.slice(-6).toUpperCase()}`),
			type: toSpecType(l.type),
			direction: l.direction,
			contactName: l.customer?.name ?? null,
			contactPhone: l.customer?.phone ?? l.destination ?? l.source,
			contactEmail: l.customer?.email ?? null,
			company: l.customer?.companyName ?? null,
			source: l.source,
			endpoint: l.destination,
			status: m.assignmentStatus ?? (firstAssigned ? 'assigned_to_agent' : 'unassigned'),
			department: m.department ?? null,
			assignedAgent: m.assignedAgent ?? firstAssigned,
			duration: l.duration ?? null,
			message: l.type === 'sms' ? l.content : null,
			subject: l.type === 'email' ? l.summary : null,
			ivrDetails: m.ivrDetails ?? null,
			timestamp: l.created.toISOString()
		};
	});

	return json({
		success: true,
		data,
		pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 }
	});
};
