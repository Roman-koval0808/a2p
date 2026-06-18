import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/db';
import { requireAuth, unauthorized, specSuccess, specError, notFound } from '$lib/api/spec';

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

export const GET: RequestHandler = async ({ params, locals }) => {
	const auth = requireAuth(locals);
	if (!auth) return unauthorized();

	const task = await prisma.task.findFirst({
		where: { id: params.id, companyId: auth.companyId },
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

	if (!task) return notFound('Task not found');
	return specSuccess(toSpecTask(task));
};

export const PUT: RequestHandler = async ({ params, request, locals }) => {
	const auth = requireAuth(locals);
	if (!auth) return unauthorized();

	const task = await prisma.task.findFirst({
		where: { id: params.id, companyId: auth.companyId }
	});

	if (!task) return notFound('Task not found');

	const body = await request.json().catch(() => ({}));
	const { title, description, contactId, dueDate, assignedTo, status } = body;

	const data: any = {};
	if (typeof title === 'string') data.title = title;
	if (typeof description === 'string') data.description = description;
	if (contactId !== undefined) data.contactId = contactId || null;
	if (assignedTo !== undefined) data.assignedToId = assignedTo || null;

	const validStatuses = ['todo', 'in_progress', 'completed', 'cancelled'];
	if (status !== undefined) {
		data.status = validStatuses.includes(status) ? status : 'todo';
	}

	if (dueDate !== undefined) data.dueDate = dueDate ? new Date(dueDate) : null;

	try {
		const updated = await prisma.task.update({
			where: { id: params.id },
			data,
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

		return specSuccess(toSpecTask(updated), 'Task updated successfully');
	} catch (err: any) {
		return specError(err.message || 'Failed to update task');
	}
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	const auth = requireAuth(locals);
	if (!auth) return unauthorized();

	const task = await prisma.task.findFirst({
		where: { id: params.id, companyId: auth.companyId }
	});

	if (!task) return notFound('Task not found');

	await prisma.task.delete({ where: { id: params.id } });
	return specSuccess(null, 'Task deleted successfully');
};
