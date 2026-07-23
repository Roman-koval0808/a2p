/**
 * GET /api/sip/credentials
 *
 * Returns the authenticated user's SIP/WebRTC connection config.
 * Generates a short-lived Telnyx WebRTC token so the mobile app
 * never needs to store the API key or raw SIP credentials.
 *
 * Response shape:
 * {
 *   success: true,
 *   data: {
 *     connectionId: string,       // Telnyx connection/voice-app ID
 *     callerIdName: string,       // Display name for outbound calls
 *     callerIdNumber: string,     // E.164 number for outbound caller ID
 *     webrtcToken: string | null, // Short-lived JWT for Telnyx WebRTC SDK (null if credential not provisioned)
 *   }
 * }
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { TELNYX_API_KEY, TELNYX_CONNECTION_ID, TELNYX_PHONE_NUMBER } from '$env/static/private';
import { env } from '$env/dynamic/private';
import { requireAuth, unauthorized, specError } from '$lib/api/spec';
import { getFirstCompanyNumber } from '$lib/company-numbers';
import { prisma } from '$lib/db';

/**
 * Ask Telnyx to create a short-lived credential and return its JWT token.
 * Uses the Telephony Credentials API:
 *   POST /v2/telephony_credentials  →  credential_id
 *   POST /v2/telephony_credentials/{id}/token  →  JWT
 *
 * Returns null when credential creation is not supported for the
 * connection type (e.g. Call Control app without WebRTC enabled).
 */
async function generateWebRtcToken(connectionId: string): Promise<string | null> {
	try {
		// Step 1 – create a short-lived telephony credential bound to this connection
		const credRes = await fetch('https://api.telnyx.com/v2/telephony_credentials', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${TELNYX_API_KEY}`
			},
			body: JSON.stringify({
				connection_id: connectionId,
				name: `webrtc-${Date.now()}`
			})
		});

		if (!credRes.ok) {
			const body = await credRes.text().catch(() => '');
			console.warn(
				`[sip/credentials] Could not create telephony credential: ${credRes.status}. ` +
					`connection_id=${connectionId} — telephony_credentials require a Telnyx CREDENTIAL ` +
					`(SIP) connection, NOT a Call Control application. Set TELNYX_SIP_CONNECTION_ID to a ` +
					`Credential Connection id. ${body}`
			);
			return null;
		}

		const credData = await credRes.json();
		const credentialId: string | undefined = credData?.data?.id;
		if (!credentialId) return null;

		// Step 2 – exchange the credential for a short-lived JWT token
		const tokenRes = await fetch(
			`https://api.telnyx.com/v2/telephony_credentials/${encodeURIComponent(credentialId)}/token`,
			{
				method: 'POST',
				headers: { Authorization: `Bearer ${TELNYX_API_KEY}` }
			}
		);

		if (!tokenRes.ok) {
			console.warn('[sip/credentials] Could not generate token:', tokenRes.status);
			return null;
		}

		// The token endpoint returns the raw JWT as text
		return await tokenRes.text();
	} catch (err) {
		console.error('[sip/credentials] WebRTC token generation failed:', err);
		return null;
	}
}

export const GET: RequestHandler = async ({ locals }) => {
	const auth = requireAuth(locals);
	if (!auth) return unauthorized();

	// Resolve company's outbound number for caller ID
	const companyNumber = await getFirstCompanyNumber(prisma, auth.companyId);
	const callerIdNumber = companyNumber?.phoneNumber ?? TELNYX_PHONE_NUMBER;

	// Resolve a human-friendly caller ID name from the company
	const company = await prisma.company.findUnique({
		where: { id: auth.companyId },
		select: { name: true }
	});
	const callerIdName = company?.name ?? 'ClearSky';

	// WebRTC tokens must come from a CREDENTIAL (SIP) connection, not the Call Control app.
	// Use TELNYX_SIP_CONNECTION_ID when provided; otherwise fall back (and log the 422 above so the
	// misconfiguration is visible).
	const sipConnectionId = env.TELNYX_SIP_CONNECTION_ID?.trim() || TELNYX_CONNECTION_ID;
	const webrtcToken = await generateWebRtcToken(sipConnectionId);

	return json({
		success: true,
		data: {
			connectionId: sipConnectionId,
			callerIdName,
			callerIdNumber,
			webrtcToken
		}
	});
};
