import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { TELNYX_API_KEY } from '$env/static/private';
 
// Bridges TWO EXISTING calls. Both must already be ANSWERED.
// `call_control_id`      = the leg you POST to (tech leg / leg A)
// `other_call_control_id` = the second leg to join (customer leg / leg B)
//
// Neither field is a phone number. Bridge does not dial. If you pass a
// phone number here, nothing gets called — that was the original bug.
export const POST: RequestHandler = async ({ request }) => {
    try {
        const { call_control_id, other_call_control_id } = await request.json();
 
        if (!call_control_id || !other_call_control_id) {
            return json(
                {
                    success: false,
                    error: 'call_control_id and other_call_control_id are required (both must be answered call legs, not phone numbers)'
                },
                { status: 400 }
            );
        }
 
        const response = await fetch(
            `https://api.telnyx.com/v2/calls/${call_control_id}/actions/bridge`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${TELNYX_API_KEY}`
                },
                // The body is the OTHER leg's call_control_id.
                body: JSON.stringify({ call_control_id: other_call_control_id })
            }
        );
 
        const data = await response.json();
 
        if (!response.ok) {
            console.error('Telnyx bridge error:', data);
            return json(
                { success: false, error: data.errors?.[0]?.detail || 'Failed to bridge call' },
                { status: response.status }
            );
        }
 
        // Bridge is now in progress. Recording should start when the
        // `call.bridged` webhook fires, not here.
        return json({ success: true, result: data.data });
    } catch (error) {
        console.error('Error bridging call:', error);
        return json(
            { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
            { status: 500 }
        );
    }
};
