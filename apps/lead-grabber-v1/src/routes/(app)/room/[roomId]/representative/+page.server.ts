import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getRepById, getRoomByRoomIdOrId } from '$lib/server/viewroom';

export const load: PageServerLoad = async ({ params, url }) => {
	const representativeId = url.searchParams.get('repid');

	if (representativeId) {
		try {
			const representative = await getRepById(representativeId);

			const room = await getRoomByRoomIdOrId(params.roomId);

			if (!room || !room.representative || !room.representative.includes(representativeId)) {
				return {
					error: 'You do not have permission to access this room.',
					representative: null,
					roomUrl: `/room/${params.roomId}`
				};
			}

			const roomUrl = new URL(`${url.origin}/room/${params.roomId}`);

			const extractParam = (paramName: string) => {
				let param = url.searchParams.get(paramName);
				if (param && param.includes('?')) {
					const match = param.match(new RegExp(`${paramName}=([^&]+)`));
					return match ? match[1] : null;
				}
				return param;
			};

			const repid = extractParam('repid') || representativeId;
			const uid = extractParam('uid');

			roomUrl.searchParams.set('repid', repid);
			if (uid) {
				roomUrl.searchParams.set('uid', uid);
			}

			return {
				representative: {
					id: representative.id,
					name: representative.name,
					email: representative.email
				},
				roomUrl: roomUrl.pathname + roomUrl.search,
				error: null
			};
		} catch (error) {
			console.error('Error handling representative access:', error);
			return {
				error: 'Invalid representative invitation.',
				representative: null,
				roomUrl: `/room/${params.roomId}`
			};
		}
	}

	return {
		error: 'No representative ID provided.',
		representative: null,
		roomUrl: `/room/${params.roomId}`
	};
};