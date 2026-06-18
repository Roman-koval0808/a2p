import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/db';
import { requireAuth, unauthorized, specSuccess, specError, pagination } from '$lib/api/spec';

function toSpecTask(t: any) {
	return {
		id: t.id,
		title: t.title,
		description: t.description ?? '',
		status: t.status,
		dueDate: t.dueDate ? t.dueDate.toISOString() : null,
		contactId: t.contactId,
		assignedToId: t.assignedToId,
		createdAt: t.created.toISOString(),
		updatedAt: t.updated.toISOString(),
		contact: t.contact
			? {
					id: t.contact.id,
					name: t.contact.name,
					phone: t.contact.phone,
					email: t.contact.email
				}
			: null,
		assignedTo: t.assignedTo
			? {
					id: t.assignedTo.id,
					name: t.assignedTo.name,
					email: t.assignedTo.email
				}
			: null
	};
}

export const GET: RequestHandler = async ({ url, locals }) => {
	const auth = requireAuth(locals);
	if (!auth) return unauthorized();

	const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10));
	const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') ?? '20', 10)));
	const contactId = url.searchParams.get('contactId');
	const assignedToId = url.searchParams.get('assignedToId');
	const status = url.searchParams.get('status');
	const skip = (page - 1) * limit;

	const where: any = { companyId: auth.companyId };
	if (contactId) where.contactId = contactId;
	if (assignedToId) where.assignedToId = assignedToId;
	if (status) where.status = status;

	const [total, tasks] = await Promise.all([
		prisma.task.count({ where }),
		prisma.task.findMany({
			where,
			skip,
			take: limit,
			orderBy: { created: 'desc' },
			include: {
				contact: {
					select: {
						id: true,
						name: true,
						phone: true,
						email: true
					}
				},
				assignedTo: {
					select: {
						id: true,
						name: true,
						email: true
					}
				}
			}
		})
	]);

	return json({
		success: true,
		data: tasks.map(toSpecTask),
		pagination: pagination(page, limit, total)
	});
};

export const POST: RequestHandler = async ({ request, locals }) => {
	const auth = requireAuth(locals);
	if (!auth) return unauthorized();

	const body = await request.json().catch(() => ({}));
	const { title, description, contactId, dueDate, assignedTo } = body;
	let { status } = body;

	if (!title) {
		return specError('Title is required', 400);
	}

	const validStatuses = ['todo', 'in_progress', 'completed', 'cancelled'];
	if (status && !validStatuses.includes(status)) {
		status = 'todo';
	}

	try {
		const task = await prisma.task.create({
			data: {
				companyId: auth.companyId,
				title,
				description: description || null,
				contactId: contactId || null,
				assignedToId: assignedTo || null,
				status: status || 'todo',
				dueDate: dueDate ? new Date(dueDate) : null
			},
			include: {
				contact: {
					select: {
						id: true,
						name: true,
						phone: true,
						email: true
					}
				},
				assignedTo: {
					select: {
						id: true,
						name: true,
						email: true
					}
				}
			}
		});

		return json(
			{
				success: true,
				data: toSpecTask(task),
				message: 'Task created successfully'
			},
			{ status: 201 }
		);
	} catch (err: any) {
		return specError(err.message || 'Failed to create task');
	}
};
