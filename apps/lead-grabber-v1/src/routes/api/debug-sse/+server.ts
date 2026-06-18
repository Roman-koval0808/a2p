import { json } from '@sveltejs/kit';
import { broadcastCallEvent, getActiveSSEConnectionCount } from '$lib/utils/sse';
import { requireAuth } from '$lib/api/spec';

export const GET = async ({ locals, url }) => {
	const auth = requireAuth(locals);
	const companyId = url.searchParams.get('companyId') || auth?.companyId;

	if (!companyId) {
		return json({
			success: false,
			error: 'No companyId provided or found in session',
			code: 400
		}, { status: 400 });
	}

	const connectionCount = getActiveSSEConnectionCount();

	console.log(`📡 Debug SSE - Active connections: ${connectionCount} (Company: ${companyId})`);

	// Broadcast a test incoming call to this company
	broadcastCallEvent(companyId, {
		type: 'incoming_call',
		name: 'Debug Test Caller',
		phone: '+15551234567',
		callId: 'debug-test-' + Date.now()
	});

	return json({
		success: true,
		message: `Debug call event broadcasted to company ${companyId}`,
		connections: connectionCount,
		event: {
			type: 'incoming_call',
			name: 'Debug Test Caller',
			phone: '+15551234567'
		},
		instructions: [
			'1. Check browser console for SSE messages',
			'2. Call dialog should appear if SSE is working',
			'3. If no dialog, check browser Network tab for /api/events'
		]
	});
};
