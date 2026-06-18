import { json } from '@sveltejs/kit';
import { broadcastCallEvent } from '$lib/utils/sse';
import { requireAuth, unauthorized } from '$lib/api/spec';

export const GET = async ({ locals }) => {
	const auth = requireAuth(locals);
	if (!auth) return unauthorized();

	// Test SSE broadcasting
	broadcastCallEvent(auth.companyId, {
		type: 'incoming_call',
		name: 'Test Caller',
		phone: '+15551234567',
		callId: 'test-manual-trigger'
	});

	return json({
		success: true,
		message: 'Test incoming call event broadcasted',
		instructions: 'Check your browser console and UI for the call dialog'
	});
};
