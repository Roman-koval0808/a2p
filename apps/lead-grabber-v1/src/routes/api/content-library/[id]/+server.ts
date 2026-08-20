import { json, type RequestHandler } from '@sveltejs/kit';
import { prisma } from '$lib/db';
import { resolveCompanyId } from '$lib/server/viewroom';

export const PUT: RequestHandler = async ({ request, locals, params }) => {
	if (!locals.user) {
		return new Response(JSON.stringify({ success: false, message: 'Unauthorized' }), { status: 401 });
	}
	const formData = await request.formData();
	const contentId = params.id as string;
	try {
		const item = await prisma.contentLibraryItem.findUnique({ where: { id: contentId } });
		if (!item) {
			return new Response(JSON.stringify({ success: false, message: 'Content not found' }), { status: 404 });
		}

		const companyId = resolveCompanyId(locals.user);
		if (!companyId || item.ownerCompanyId !== companyId) {
			return new Response(JSON.stringify({ success: false, message: 'Unauthorized' }), { status: 401 });
		}

		const active = formData.get('active');
		const title = formData.get('title');
		const description = formData.get('description');

		const updateData: any = {};
		if (active !== null) {
			updateData.active = active === 'true';
		}
		if (title !== null) updateData.title = title as string;
		if (description !== null) updateData.description = description as string;

		if (Object.keys(updateData).length === 0) {
			return new Response(JSON.stringify({ success: false, message: 'No valid update data provided' }), { status: 400 });
		}

		await prisma.contentLibraryItem.update({ where: { id: contentId }, data: updateData });
		return new Response(JSON.stringify({ success: true, message: 'Content updated successfully' }), { status: 200 });
	} catch (error) {
		console.error('Error updating content:', error);
		return new Response(JSON.stringify({ success: false, message: 'Failed to update content' }), { status: 500 });
	}
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) {
		return new Response(JSON.stringify({ success: false, message: 'Unauthorized' }), { status: 401 });
	}
	const contentId = params.id as string;
	try {
		const item = await prisma.contentLibraryItem.findUnique({ where: { id: contentId } });
		if (!item) {
			return new Response(JSON.stringify({ success: false, message: 'Content not found' }), { status: 404 });
		}

		const companyId = resolveCompanyId(locals.user);
		if (!companyId || item.ownerCompanyId !== companyId) {
			return new Response(JSON.stringify({ success: false, message: 'Unauthorized' }), { status: 401 });
		}

		// best-effort Bunny cleanup for file + thumbnail
		try {
			const { deleteFromBunny } = await import('$lib/server/bunny');
			if (item.file && item.file.includes('.b-cdn.net')) {
				await deleteFromBunny(item.file).catch(() => {});
			}
			if (item.thumbnail && item.thumbnail.includes('.b-cdn.net')) {
				await deleteFromBunny(item.thumbnail).catch(() => {});
			}
		} catch (e) {
			console.warn('bunny cleanup failed', e);
		}

		await prisma.contentLibraryItem.delete({ where: { id: contentId } });

		return new Response(JSON.stringify({ success: true, message: 'Content deleted successfully' }), { status: 200 });
	} catch (error) {
		console.error('Error deleting content:', error);
		return new Response(JSON.stringify({ success: false, message: 'Failed to delete content' }), { status: 500 });
	}
};