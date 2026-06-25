import { prisma } from '$lib/db';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async ({ request, params, locals }) => {
	const user = locals.user;
	if (!user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	try {
		const memberId = params.id;
		const { role } = await request.json();

		const memberToUpdate = await prisma.companyMember.findUnique({
			where: { id: memberId }
		});

		if (!memberToUpdate) {
			return json({ error: 'Member not found' }, { status: 404 });
		}

		// Verify permissions: Must be owner/admin of that company, or platform staff
		const isPlatformStaff = user.platformRole === 'CLEARSKY_ADMIN';
		const currentUserMember = await prisma.companyMember.findFirst({
			where: { userId: user.id, companyId: memberToUpdate.companyId, status: 'active' }
		});
		
		const company = await prisma.company.findUnique({ where: { id: memberToUpdate.companyId } });
		const isAdmin = currentUserMember?.role === 'admin';
		const isOwner = company?.ownerId === user.id;

		if (!isAdmin && !isOwner && !isPlatformStaff) {
			return json({ error: 'Forbidden' }, { status: 403 });
		}

		if (memberToUpdate.role === 'owner') {
			return json({ error: 'Cannot modify owner role' }, { status: 400 });
		}

		const updated = await prisma.companyMember.update({
			where: { id: memberId },
			data: { role }
		});

		return json({ success: true, member: updated });
	} catch (err: any) {
		console.error('Error updating member:', err);
		return json({ error: err.message || 'Failed to update member' }, { status: 500 });
	}
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	const user = locals.user;
	if (!user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	try {
		const memberId = params.id;

		const memberToDelete = await prisma.companyMember.findUnique({
			where: { id: memberId }
		});

		if (!memberToDelete) {
			return json({ error: 'Member not found' }, { status: 404 });
		}

		// Verify permissions: Must be owner/admin of that company, or platform staff
		const isPlatformStaff = user.platformRole === 'CLEARSKY_ADMIN';
		const currentUserMember = await prisma.companyMember.findFirst({
			where: { userId: user.id, companyId: memberToDelete.companyId, status: 'active' }
		});
		
		const company = await prisma.company.findUnique({ where: { id: memberToDelete.companyId } });
		const isAdmin = currentUserMember?.role === 'admin';
		const isOwner = company?.ownerId === user.id;

		if (!isAdmin && !isOwner && !isPlatformStaff) {
			return json({ error: 'Forbidden' }, { status: 403 });
		}

		if (memberToDelete.role === 'owner') {
			return json({ error: 'Cannot remove company owner' }, { status: 400 });
		}

		await prisma.companyMember.delete({
			where: { id: memberId }
		});

		return json({ success: true });
	} catch (err: any) {
		console.error('Error deleting member:', err);
		return json({ error: err.message || 'Failed to delete member' }, { status: 500 });
	}
};
