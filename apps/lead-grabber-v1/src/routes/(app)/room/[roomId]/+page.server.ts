import { error, redirect } from '@sveltejs/kit';
import { getRoomFull, getRepById } from '$lib/server/viewroom';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, url, cookies }) => {
	const roomIdParam = params.roomId;

	const isNormalAuth = !!locals.user;
	const incomingUid = url.searchParams.get('uid') || '';
	const repIdParam = url.searchParams.get('repid') || '';

	let authType = 'none';
	let representativeName: string | null = null;

	if (isNormalAuth) {
		authType = 'pocketbase';
	} else if (repIdParam) {
		const rep = await getRepById(repIdParam).catch(() => null);
		if (rep) {
			authType = 'representative';
			representativeName = rep.name || `${rep.first_name || ''} ${rep.last_name || ''}`.trim() || 'Representative';
		} else {
			authType = 'anonymous';
		}
	} else {
		authType = 'anonymous';
	}

	try {
		const room = await getRoomFull(roomIdParam);

		if (!room) {
			throw error(404, 'Room not found');
		}

		const joinBeforeMinutes = 5;
		if (room.scheduled && room.schedule_time) {
			const scheduleTime = new Date(room.schedule_time);
			const currentTime = new Date();
			const timeDiffMinutes = (scheduleTime.getTime() - currentTime.getTime()) / (1000 * 60);

			if (timeDiffMinutes > joinBeforeMinutes) {
				return {
					error: true,
					scheduledMeeting: true,
					message: `This meeting is scheduled for ${scheduleTime.toLocaleString()}. Please return at that time.`,
					scheduledTime: scheduleTime,
					scheduledRoomId: room.id,
					join_before_minutes: joinBeforeMinutes,
					redirectTo: '/'
				};
			}
		}

		return {
			...room,
			user: locals.user
				? {
						id: locals.user.id,
						first_name: locals.user.name || 'User',
						last_name: '',
						name: locals.user.name || 'User',
						company: locals.user.company?.name || locals.user.companyId || 'Company User',
						email: locals.user.email
					}
				: null,
			viewroomUser: null,
			representativeName,
			authType,
			debug: {
				hasRepField: !!room.representative,
				repCount: room.representatives.length,
				isDrizzle: false
			}
		};
	} catch (err) {
		console.error('Error loading room:', err);
		return { error: true, message: 'Room not found', redirectTo: '/' };
	}
};