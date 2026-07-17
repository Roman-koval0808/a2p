import { request as httpsRequest } from 'https';

/**
 * Autocaller bridge (Epic 4, T4.1/T4.2). On an SLA breach the system can call the rep,
 * play a disclosure, and bridge them to the customer on keypress.
 *
 * ⚠️ Built but NOT runtime-confirmed from here: this issues live Telnyx Call Control
 * commands and needs a real in-progress call (call_control_id) + Telnyx credentials to
 * exercise. Wire it into the SLA-breach path once a rep call leg exists.
 */

// T4.2: disclosure played before the two parties are bridged.
export const MERGE_DISCLOSURE =
	'I am connecting you with a representative for quality assurance. This call is recorded.';

async function callControl(callControlId: string, action: string, body: Record<string, unknown>) {
	const apiKey = process.env.TELNYX_API_KEY?.trim();
	if (!apiKey) throw new Error('TELNYX_API_KEY not configured');
	const payload = JSON.stringify(body);
	const options = {
		hostname: 'api.telnyx.com',
		port: 443,
		path: `/v2/calls/${encodeURIComponent(callControlId)}/actions/${action}`,
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${apiKey}`,
			'Content-Length': Buffer.byteLength(payload)
		}
	};
	return new Promise<void>((resolve, reject) => {
		const req = httpsRequest(options, (res: any) => {
			let data = '';
			res.on('data', (c: any) => (data += c));
			res.on('end', () =>
				res.statusCode >= 200 && res.statusCode < 300
					? resolve()
					: reject(new Error(`Telnyx ${action} ${res.statusCode}: ${data}`))
			);
		});
		req.on('error', reject);
		req.write(payload);
		req.end();
	});
}

/** Speak the merge disclosure on the rep's call leg. */
export function speakDisclosure(callControlId: string) {
	return callControl(callControlId, 'speak', { payload: MERGE_DISCLOSURE, voice: 'female', language: 'en-US' });
}

/** Bridge the rep's call leg to the customer's number. */
export function bridgeRepToCustomer(callControlId: string, customerNumber: string) {
	return callControl(callControlId, 'transfer', { to: customerNumber });
}
