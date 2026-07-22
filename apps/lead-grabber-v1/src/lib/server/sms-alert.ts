import { TELNYX_API_KEY, TELNYX_MESSAGING_PROFILE_ID } from '$env/static/private';
import { PUBLIC_BASE_URL } from '$env/static/public';
import { normalizeUrl } from '$lib/utils';
import { normalizePhoneNumber } from '$lib/utils/phone';
import { prisma } from '$lib/db';

/**
 * Sends an SMS alert to all configured company phone numbers if SMS notifications are enabled.
 */
export async function sendOwnerSmsAlert(
	companyId: string,
	alertMessage: string,
	/**
	 * The number the triggering call/SMS arrived on. It is a GUARANTEED-valid Telnyx sender
	 * (Telnyx just routed traffic to it), whereas the first company_phone_numbers row can be a
	 * stale/ghost entry that exists in our DB but not in the Telnyx account — sending from which
	 * fails with "10004 Invalid source number" and the owner never gets the emergency alert.
	 */
	preferredFrom?: string | null
) {
	try {
		const company = await prisma.company.findUnique({
			where: { id: companyId },
			select: { settings: true, name: true }
		});

		if (!company) {
			console.error(`[sms-alert] Company not found: ${companyId}`);
			return;
		}

		let settings = company.settings;
		if (typeof settings === 'string') {
			try {
				settings = JSON.parse(settings);
			} catch {
				settings = null;
			}
		}

		const notifSettings = (settings as any)?.notifications;
		if (!notifSettings || !notifSettings.sms) {
			console.log(`[sms-alert] SMS alerts not enabled for company: ${company.name || companyId}`);
			return;
		}

		const phoneNumbers: any[] = notifSettings.phone_numbers || [];
		if (phoneNumbers.length === 0) {
			console.log(`[sms-alert] No phone numbers configured for SMS alerts: ${company.name || companyId}`);
			return;
		}

		// Only ever send FROM a number that is active in the Telnyx account — the exact set the
		// "Manage Numbers" screen shows. The company_phone_numbers table can hold ghost rows that
		// were deleted from Telnyx; sending from one fails with "10004 Invalid source number" and
		// the owner silently never gets the alert. resolveSmsSender returns null rather than a ghost.
		const { resolveSmsSender } = await import('./company-sender');
		const fromNumber = await resolveSmsSender(companyId, preferredFrom);
		if (!fromNumber) {
			console.error(
				`[sms-alert] No ACTIVE Telnyx sender number for company ${company.name || companyId} — alert not sent. Check Manage Numbers.`
			);
			return;
		}

		if (!fromNumber) {
			console.error(`[sms-alert] No sender phone number found for alerts (TELNYX_PHONE_NUMBER is not set)`);
			return;
		}

		console.log(`[sms-alert] Broadcasting alert for "${company.name}" to ${phoneNumbers.length} recipients...`);

		for (const phone of phoneNumbers) {
			const rawPhone = typeof phone === 'string' ? phone : phone.number;
			const name = typeof phone === 'object' && phone.name ? phone.name : '';
			
			const recipient = normalizePhoneNumber(rawPhone);
			if (!recipient) {
				console.warn(`[sms-alert] Invalid phone number skipped: "${rawPhone}"`);
				continue;
			}
			
			const personalizedMessage = name ? `Hey ${name},\n${alertMessage}` : alertMessage;

			try {
				const response = await fetch('https://api.telnyx.com/v2/messages', {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						Authorization: `Bearer ${TELNYX_API_KEY}`
					},
					body: JSON.stringify({
						from: fromNumber,
						to: recipient,
						text: personalizedMessage,
						messaging_profile_id: TELNYX_MESSAGING_PROFILE_ID,
						webhook_url: normalizeUrl(PUBLIC_BASE_URL, '/api/telnyx/webhook'),
						use_profile_webhooks: false,
						type: 'SMS'
					})
				});

				const responseText = await response.text();
				if (!response.ok) {
					console.error(`[sms-alert] Failed to send SMS to ${recipient}. Response:`, responseText);
				} else {
					console.log(`[sms-alert] Successfully sent SMS alert to ${recipient}`);
				}
			} catch (err) {
				console.error(`[sms-alert] Exception sending SMS to ${recipient}:`, err);
			}
		}
	} catch (error) {
		console.error(`[sms-alert] Error in sendOwnerSmsAlert:`, error);
	}
}
