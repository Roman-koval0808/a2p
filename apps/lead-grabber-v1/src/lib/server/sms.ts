import { request as httpsRequest } from 'https';

/**
 * Send an SMS via Telnyx. No DB dependency — extracted so main-DB modules
 * (callback-ack, etc.) don't transitively import the redundant profiledb client.
 */
export async function sendAutomatedSms(to: string, body: string): Promise<void> {
	const telnyxApiKey = process.env.TELNYX_API_KEY?.trim();
	const telnyxFrom = process.env.TELNYX_PHONE_NUMBER?.trim();
	const messagingProfileId = process.env.TELNYX_MESSAGING_PROFILE_ID?.trim();

	if (!telnyxApiKey || !telnyxFrom) {
		console.warn('[Automated SMS Skip] Telnyx credentials not configured in environment.');
		return;
	}

	const cleanedPhone = to.replace(/[^\d+]/g, '');
	const payloadData = JSON.stringify({
		from: telnyxFrom,
		to: cleanedPhone,
		text: body,
		messaging_profile_id: messagingProfileId || undefined
	});

	const options = {
		hostname: 'api.telnyx.com',
		port: 443,
		path: '/v2/messages',
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${telnyxApiKey}`,
			'Content-Length': Buffer.byteLength(payloadData)
		}
	};

	return new Promise((resolve, reject) => {
		const req = httpsRequest(options, (response: any) => {
			let data = '';
			response.on('data', (chunk: any) => {
				data += chunk;
			});
			response.on('end', () => {
				if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
					console.log(`[Automated SMS Sent] to ${cleanedPhone} successfully.`);
					resolve();
				} else {
					console.error(`[Automated SMS Telnyx Error] Status: ${response.statusCode}, Response: ${data}`);
					reject(new Error(`Telnyx API error: ${data}`));
				}
			});
		});
		req.on('error', (err: any) => {
			console.error('[Automated SMS Request Error]', err.message);
			reject(err);
		});
		req.write(payloadData);
		req.end();
	});
}
