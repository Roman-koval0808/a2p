import { json, type RequestHandler } from '@sveltejs/kit';
import { prisma } from '$lib/db';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const {
			title,
			representative_ids,
			schedule_time,
			customer_name,
			customer_email,
			customer_phone,
			room_id,
			additional_information,
			meeting_duration = 60,
			join_before_minutes = 15,
			host_content = [],
			representative_content = []
		} = await request.json();

		if (!title || !representative_ids || !schedule_time || !customer_name || !customer_email) {
			return json({ error: 'Missing required fields: title, representative_ids, schedule_time, customer_name, customer_email' }, { status: 400 });
		}

		const scheduleDate = new Date(schedule_time);
		const now = new Date();
		if (scheduleDate <= now) {
			return json({ error: 'Schedule time must be in the future' }, { status: 400 });
		}

		const firstRep = await prisma.companyMember.findUnique({
			where: { id: representative_ids[0] }
		});
		if (!firstRep) {
			return json({ error: 'Invalid representative ID' }, { status: 400 });
		}

		const ownerCompany = firstRep.companyId;
		if (!ownerCompany) {
			return json({ error: 'Representative must be associated with a company' }, { status: 400 });
		}

		const companyExists = await prisma.company.findUnique({ where: { id: ownerCompany } });
		if (!companyExists) {
			return json({ error: 'Company not found' }, { status: 404 });
		}

		const conflictingRooms = await prisma.viewRoom.findMany({
			where: { scheduled: true, scheduleTime: scheduleDate }
		});
		if (conflictingRooms.length > 0) {
			return json({ error: 'Time slot is already booked' }, { status: 409 });
		}

		const scheduledRoom = await prisma.viewRoom.create({
			data: {
				title,
				representative: representative_ids,
				scheduled: true,
				scheduleTime: scheduleDate,
				customerName: customer_name,
				customerEmail: customer_email,
				customerPhone: customer_phone,
				roomId: room_id,
				additionalInformation: additional_information,
				ownerCompanyId: ownerCompany,
				hostContent,
				representativeContent: representative_content,
				representativeId: representative_ids[0],
				isActive: true
			}
		});

		return json({
			success: true,
			message: 'Room scheduled successfully',
			scheduled_room: {
				id: scheduledRoom.id,
				room_id: scheduledRoom.roomId,
				title: scheduledRoom.title,
				representative: scheduledRoom.representative,
				scheduled: scheduledRoom.scheduled,
				schedule_time: scheduledRoom.scheduleTime,
				customer_name: scheduledRoom.customerName,
				customer_email: scheduledRoom.customerEmail,
				customer_phone: scheduledRoom.customerPhone,
				additional_information: scheduledRoom.additionalInformation,
				representative_id: scheduledRoom.representativeId,
				owner_company: scheduledRoom.ownerCompanyId
			}
		});
	} catch (error) {
		console.error('Error scheduling room:', error);
		return json({ error: 'Internal server error' }, { status: 500 });
	}
};

export const GET: RequestHandler = async ({ url }) => {
	try {
		const roomId = url.searchParams.get('room_id');
		const representativeId = url.searchParams.get('representative_id');
		const date = url.searchParams.get('date');

		const where: Record<string, any> = { scheduled: true };

		if (roomId) {
			where.roomId = roomId;
		}
		if (representativeId) {
			where.representativeId = representativeId;
		}
		if (date) {
			const startOfDay = new Date(date);
			startOfDay.setUTCHours(0, 0, 0, 0);
			const endOfDay = new Date(date);
			endOfDay.setUTCHours(23, 59, 59, 999);
			where.scheduleTime = { gte: startOfDay, lte: endOfDay };
		}

		const scheduledRoomsList = await prisma.viewRoom.findMany({
			where,
			orderBy: { scheduleTime: 'asc' }
		});

		return json({
			success: true,
			scheduled_rooms: scheduledRoomsList.map((r) => ({
				id: r.id,
				room_id: r.roomId,
				title: r.title,
				representative: r.representative,
				scheduled: r.scheduled,
				schedule_time: r.scheduleTime,
				customer_name: r.customerName,
				customer_email: r.customerEmail,
				customer_phone: r.customerPhone,
				additional_information: r.additionalInformation,
				representative_id: r.representativeId
			}))
		});
	} catch (error) {
		console.error('Error fetching scheduled rooms:', error);
		return json({ error: 'Internal server error' }, { status: 500 });
	}
};

export const PUT: RequestHandler = async ({ request, url }) => {
	try {
		const roomId = url.searchParams.get('room_id');
		if (!roomId) {
			return json({ error: 'Room ID is required' }, { status: 400 });
		}

		const updates = await request.json();
		const { id, createdAt, created, ...updateData } = updates;

		const fieldMap: Record<string, string> = {
			room_id: 'roomId',
			is_active: 'isActive',
			host_content: 'hostContent',
			representative_content: 'representativeContent',
			representative_id: 'representativeId',
			schedule_time: 'scheduleTime',
			customer_name: 'customerName',
			customer_email: 'customerEmail',
			customer_phone: 'customerPhone',
			additional_information: 'additionalInformation',
			owner_company: 'ownerCompanyId'
		};

		const data: Record<string, any> = {};
		for (const [key, value] of Object.entries(updateData)) {
			const mapped = fieldMap[key] ?? key;
			data[mapped] = value;
		}

		const updatedRoom = await prisma.viewRoom.updateMany({
			where: { roomId },
			data
		});

		if (updatedRoom.count === 0) {
			return json({ error: 'Scheduled room not found' }, { status: 404 });
		}

		return json({ success: true, message: 'Room updated successfully' });
	} catch (error) {
		console.error('Error updating scheduled room:', error);
		return json({ error: 'Internal server error' }, { status: 500 });
	}
};

export const DELETE: RequestHandler = async ({ url }) => {
	try {
		const roomId = url.searchParams.get('room_id');
		if (!roomId) {
			return json({ error: 'Room ID is required' }, { status: 400 });
		}

		const result = await prisma.viewRoom.deleteMany({ where: { roomId } });

		if (result.count === 0) {
			return json({ error: 'Scheduled room not found' }, { status: 404 });
		}

		return json({ success: true, message: 'Room deleted successfully' });
	} catch (error) {
		console.error('Error deleting scheduled room:', error);
		return json({ error: 'Internal server error' }, { status: 500 });
	}
};