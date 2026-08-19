import { error, fail } from '@sveltejs/kit';
import type { Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getRoomByRoomIdOrId, getRoomFull } from '$lib/server/viewroom';

export const load: PageServerLoad = async ({ params }) => {
	try {
		const room = await getRoomFull(params.roomId);

		if (!room) {
			throw error(404, 'Room not found');
		}

		return {
			room,
			viewroomUser: null,
			authType: 'none',
			isViewroomAuthenticated: false,
			isAnonymous: true
		};
	} catch (err) {
		console.error('Error loading room data:', err);
		throw error(500, 'Failed to load room data');
	}
};

export const actions = {
	joinRoom: async (event) => {
		const formData = await event.request.formData();
		let anonymousUserId = formData.get('anonymousUserId')?.toString() || '';
		anonymousUserId = anonymousUserId.trim();
		const roomId = event.params.roomId;

		if (!roomId) {
			return fail(400, {
				errors: {
					anonymousUserId: 'Room ID is missing'
				}
			});
		}

		if (!anonymousUserId || anonymousUserId.length < 3) {
			return fail(400, {
				errors: {
					anonymousUserId: 'User ID must be at least 3 characters long'
				}
			});
		}

		if (anonymousUserId.length > 50) {
			return fail(400, {
				errors: {
					anonymousUserId: 'User ID must be less than 50 characters'
				}
			});
		}

		if (!/^[a-zA-Z0-9_-]+$/.test(anonymousUserId)) {
			return fail(400, {
				errors: {
					anonymousUserId: 'User ID can only contain letters, numbers, underscores, and hyphens'
				}
			});
		}

		const sanitizedUserId = anonymousUserId.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9-_]/g, '_');

		try {
			const room = await getRoomByRoomIdOrId(roomId);

			if (!room) {
				return fail(404, {
					errors: {
						anonymousUserId: 'Room not found'
					}
				});
			}

			return {
				roomId,
				anonymousUserId: sanitizedUserId,
				hostParams: `isHost=true&anonymous=true&hostUserId=${sanitizedUserId}`
			};
		} catch (err) {
			console.error('Error joining room:', err);
			return fail(500, {
				errors: {
					anonymousUserId: 'Failed to join room'
				}
			});
		}
	}
};