import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/db';
import { requireAuth, unauthorized, pagination } from '$lib/api/spec';

type CommType = 'call' | 'sms' | 'email';
type AssignmentStatus = 'unassigned' | 'assigned_to_dept' | 'assigned_to_agent';

function toSpecType(t: string): CommType {
	if (t === 'voice') return 'call';
	if (t === 'sms' || t === 'email') return t;
	return 'call';
}

function meta(l: { metadata?: unknown }) {
	return (
		(l.metadata as {
			commId?: string;
			assignmentStatus?: AssignmentStatus;
			department?: string;
			assignedAgent?: string;
			ivrDetails?: string;
		}) ?? {}
	);
}

function toSpecLog(l: {
	id: string;
	type: string;
	direction: string;
	source: string | null;
	destination: string | null;
	summary: string | null;
	content: string | null;
	duration: number | null;
	metadata: unknown;
	created: Date;
	customer?: {
		name: string | null;
		phone: string | null;
		email: string | null;
		companyName: string | null;
	} | null;
	assignedMembers?: { user: { name: string | null } }[];
}) {
	const m = meta(l);
	const firstAssigned = l.assignedMembers?.[0]?.user?.name ?? null;
	const status: AssignmentStatus =
		m.assignmentStatus ?? (firstAssigned ? 'assigned_to_agent' : 'unassigned');
	return {
		id: l.id,
		commId: m.commId ?? `COMM-${l.created.getFullYear()}-${l.id.slice(-6).toUpperCase()}`,
		type: toSpecType(l.type),
		direction: l.direction,
		contactName: l.customer?.name ?? null,
		contactPhone: l.customer?.phone ?? l.destination ?? l.source,
		contactEmail: l.customer?.email ?? null,
		company: l.customer?.companyName ?? null,
		source: l.source,
		endpoint: l.destination,
		status,
		department: m.department ?? null,
		assignedAgent: m.assignedAgent ?? firstAssigned,
		duration: l.duration ?? null,
		message: l.type === 'sms' ? l.content : null,
		subject: l.type === 'email' ? l.summary : null,
		ivrDetails: m.ivrDetails ?? null,
		timestamp: l.created.toISOString()
	};
}

export const GET: RequestHandler = async ({ url, locals }) => {
	const auth = requireAuth(locals);
	if (!auth) return unauthorized();

	const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10));
	const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') ?? '20', 10)));
	const type = url.searchParams.get('type'); // call | sms | email
	const direction = url.searchParams.get('direction');
	const status = url.searchParams.get('status');
	const sort = url.searchParams.get('sort') ?? 'newest';
	const search = (url.searchParams.get('search') ?? '').trim();
	const skip = (page - 1) * limit;

	const where: { companyId: string; type?: unknown; direction?: string } = {
		companyId: auth.companyId
	};
	if (type === 'call') where.type = 'voice';
	else if (type === 'sms') where.type = 'sms';
	else if (type === 'email') where.type = 'email';
	if (direction === 'inbound' || direction === 'outbound') where.direction = direction;
	// status filter (unassigned/assigned) would need metadata or join; skip for now or filter in app
	const orderBy = sort === 'oldest' ? { created: 'asc' as const } : { created: 'desc' as const };

	const [total, logs] = await Promise.all([
		prisma.communicationLog.count({ where }),
		prisma.communicationLog.findMany({
			where: search
				? {
						...where,
						OR: [
							{ summary: { contains: search, mode: 'insensitive' } },
							{ content: { contains: search, mode: 'insensitive' } },
							{ source: { contains: search, mode: 'insensitive' } },
							{ destination: { contains: search, mode: 'insensitive' } },
							{ customer: { name: { contains: search, mode: 'insensitive' } } }
						]
					}
				: where,
			skip,
			take: limit,
			orderBy,
			include: {
				customer: { select: { name: true, phone: true, email: true, companyName: true } },
				assignedMembers: { include: { user: { select: { name: true } } } }
			}
		})
	]);

	const data = logs.map((l) => toSpecLog(l));
	return json({ success: true, data, pagination: pagination(page, limit, total) });
};
