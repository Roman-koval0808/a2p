import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPendingCall, removePendingCall } from '$lib/utils/callStore';

export const GET: RequestHandler = async () => {
	try {
		const pendingCall = getPendingCall();
		if (pendingCall) {
			return json({
				hasCall: true,
				call: {
					id: pendingCall.id,
					name: pendingCall.name,
					phone: pendingCall.phone,
					callId: pendingCall.callId
				}
			});
		}
		return json({ hasCall: false });
	} catch (err) {
		console.error('[api/calls/pending] GET error:', err);
		return json({ hasCall: false }, { status: 500 });
	}
};

export const DELETE: RequestHandler = async ({ url }) => {
	try {
		const callId = url.searchParams.get('id');
		if (callId) {
			const removed = removePendingCall(callId);
			return json({ success: removed });
		}
		return json({ success: false, error: 'Missing call ID' }, { status: 400 });
	} catch (err) {
		console.error('[api/calls/pending] DELETE error:', err);
		return json({ success: false, error: 'Server error' }, { status: 500 });
	}
};
