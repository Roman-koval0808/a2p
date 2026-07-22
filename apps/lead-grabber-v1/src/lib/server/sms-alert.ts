import {
	TELNYX_API_KEY,
	TELNYX_PHONE_NUMBER,
	TELNYX_MESSAGING_PROFILE_ID
} from '$env/static/private';
import { PUBLIC_BASE_URL } from '$env/static/public';
import { normalizeUrl } from '$lib/utils';
import { normalizePhoneNumber } from '$lib/utils/phone';
import { prisma } from '$lib/db';

/**
 * Sends an SMS alert to all configured company phone numbers if SMS notifications are enabled.
 */
export async function sendOwnerSmsAlert(companyId: string, alertMessage: string) {
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

		// Find a verified sender number for the company
		const companyNumberObj = await prisma.companyPhoneNumber.findFirst({
			where: { companyId },
			select: { phoneNumber: true }
		});
		const fromNumber = companyNumberObj?.phoneNumber || TELNYX_PHONE_NUMBER;

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
