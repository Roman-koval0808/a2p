import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { addPendingCall } from '$lib/utils/callStore';

export const POST: RequestHandler = async () => {
	// Simulate an incoming call
	const callId = addPendingCall({
		name: 'Test Caller',
		phone: '+15551234567',
		callId: `test-${Date.now()}`
	});

	console.log('🧪 Created test call:', callId);

	return json({
		success: true,
		message: 'Test call created',
		callId
	});
};
