import { json, type RequestHandler } from '@sveltejs/kit';
import { prisma } from '$lib/db';
import { getRoomFull } from '$lib/server/viewroom';

function toContentItemForInfo(item: any): any {
	return {
		id: item.id,
		title: item.title ?? '',
		type: item.type ?? 'document',
		file: item.file ?? '',
		thumbnail: item.thumbnail ?? ''
	};
}

export async function GET({ params }) {
	try {
		const roomId = params.roomId;

		if (!roomId) {
			return json({ success: false, message: 'Room ID is required' }, { status: 400 });
		}

		const room = await getRoomFull(roomId);

		if (!room) {
			return json({ success: false, message: 'Room not found' }, { status: 404 });
		}

		const hostContentIds: string[] = room.host_content ?? [];
		const representativeContentIds: string[] = room.representative_content ?? [];

		let hostContentItems: any[] = [];
		let representativeContentItems: any[] = [];

		if (hostContentIds.length > 0) {
			const items = await prisma.contentLibraryItem.findMany({ where: { id: { in: hostContentIds } } });
			hostContentItems = items.map(toContentItemForInfo);
		}
		if (representativeContentIds.length > 0) {
			const items = await prisma.contentLibraryItem.findMany({ where: { id: { in: representativeContentIds } } });
			representativeContentItems = items.map(toContentItemForInfo);
		}

		return json({
			success: true,
			room: {
				id: room.id,
				title: room.title,
				owner_company: room.owner_company,
				is_active: room.is_active ?? true,
				representative: room.representative ?? [],
				scheduled: room.scheduled ?? false,
				schedule_time: room.schedule_time ?? null,
				host_content_active: room.host_content_active ?? {},
				representative_content_active: room.representative_content_active ?? {},
				hostContentItems,
				representativeContentItems
			},
			company: room.company
				? { id: room.company.id, name: room.company.name ?? null }
				: null
		});
	} catch (error) {
		console.error('Failed to fetch room info:', error);
		return json({ success: false, message: 'Failed to fetch room information' }, { status: 500 });
	}
}

export const PATCH: RequestHandler = async ({ request, params }) => {
	const roomId = params.roomId;
	if (!roomId) return json({ success: false, message: 'Room ID required' }, { status: 400 });
	try {
		const body = (await request.json().catch(() => ({}))) as Record<string, Record<string, boolean>>;
		const host_content_active = body.host_content_active;
		const representative_content_active = body.representative_content_active;
		if (!host_content_active && !representative_content_active) {
			return json({ success: false, message: 'No content active state provided' }, { status: 400 });
		}
		const existing = await prisma.viewRoom.findFirst({
			where: { OR: [{ id: roomId }, { roomId }] }
		});
		if (!existing) return json({ success: false, message: 'Room not found' }, { status: 404 });

		const current = (existing.contentActiveState as Record<string, Record<string, boolean>> | null) ?? {};
		const next = { ...current };
		if (host_content_active) next.host_content_active = host_content_active;
		if (representative_content_active) next.representative_content_active = representative_content_active;

		await prisma.viewRoom.update({ where: { id: existing.id }, data: { contentActiveState: next } });
		return json({ success: true });
	} catch (e) {
		console.error('PATCH room info:', e);
		return json({ success: false, message: 'Failed to update' }, { status: 500 });
	}
};

export const PUT: RequestHandler = async ({ request, locals, params }) => {
	if (!locals.user) {
		return new Response(JSON.stringify({ success: false, message: 'Unauthorized' }), { status: 401 });
	}

	const formData = await request.formData();
	const roomId = params.roomId;

	const getArray = (key: string): string[] => {
		const raw = formData.get(key);
		if (!raw) return [];
		return raw.toString().split(',').map((s) => s.trim()).filter(Boolean);
	};

	try {
		const room = await prisma.viewRoom.findFirst({
			where: { OR: [{ id: roomId }, { roomId }] }
		});
		if (!room) {
			return new Response(JSON.stringify({ success: false, message: 'Room not found' }), { status: 404 });
		}

		const title = formData.get('title') as string | null;
		const isActiveRaw = formData.get('is_active');
		const hostContent = getArray('host_content[]');
		const representativeContent = getArray('representative_content[]');
		const representative = getArray('representative[]');

		const pgUpdate: Record<string, any> = {};
		if (title !== null) pgUpdate.title = title;
		if (isActiveRaw !== null) pgUpdate.isActive = isActiveRaw === 'true';
		if (hostContent.length > 0) pgUpdate.hostContent = hostContent;
		if (representativeContent.length > 0) pgUpdate.representativeContent = representativeContent;
		if (representative.length > 0) pgUpdate.representative = representative;

		if (Object.keys(pgUpdate).length === 0) {
			return new Response(JSON.stringify({ success: false, message: 'No valid update data provided' }), { status: 400 });
		}

		await prisma.viewRoom.update({ where: { id: room.id }, data: pgUpdate });

		return new Response(JSON.stringify({ success: true, message: 'Room updated successfully' }), { status: 200 });
	} catch (error) {
		console.error('Error updating room:', error);
		return new Response(JSON.stringify({ success: false, message: 'Failed to update room' }), { status: 500 });
	}
};