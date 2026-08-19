import { json, type RequestHandler } from '@sveltejs/kit';
import { prisma } from '$lib/db';
import { resolveCompanyId } from '$lib/server/viewroom';

function generateShortId(length = 10): string {
	const characters = 'abcdefghijklmnopqrstuvwxyz0123456789';
	let result = '';
	for (let i = 0; i < length; i++) {
		result += characters.charAt(Math.floor(Math.random() * characters.length));
	}
	return result;
}

export const POST: RequestHandler = async ({ request, locals }) => {
	const companyId = locals.user ? resolveCompanyId(locals.user) : null;
	if (!locals.user || !companyId) {
		return json({ success: false, message: 'Unauthorized' }, { status: 401 });
	}

	const formData = await request.formData();
	const title = formData.get('title')?.toString();
	const isActive = formData.has('is_active');

	const hostContent = formData.get('host_content[]')?.toString().split(',').filter(Boolean) || [];
	const repContent = formData.get('representative_content[]')?.toString().split(',').filter(Boolean) || [];
	const representative = formData.get('representative[]')?.toString().split(',').filter(Boolean) || [];

	if (!title) {
		return json({ success: false, error: 'Title is required' }, { status: 400 });
	}

	try {
		let shortId = generateShortId(10);
		let existing = await prisma.viewRoom.findUnique({ where: { roomId: shortId } });
		while (existing) {
			shortId = generateShortId(10);
			existing = await prisma.viewRoom.findUnique({ where: { roomId: shortId } });
		}

		const roomRecord = await prisma.viewRoom.create({
			data: {
				roomId: shortId,
				title,
				isActive,
				hostContent,
				representativeContent: repContent,
				representative,
				ownerCompanyId: companyId
			}
		});

		return json(
			{
				success: true,
				room: {
					id: roomRecord.id,
					room_id: roomRecord.roomId,
					title: roomRecord.title,
					is_active: roomRecord.isActive,
					owner_company: roomRecord.ownerCompanyId,
					host_content: roomRecord.hostContent,
					representative_content: roomRecord.representativeContent,
					representative: roomRecord.representative
				}
			},
			{ status: 200 }
		);
	} catch (err: any) {
		console.error('Error creating room:', err);
		return json({ success: false, error: 'Failed to create room', message: err.message }, { status: 500 });
	}
};