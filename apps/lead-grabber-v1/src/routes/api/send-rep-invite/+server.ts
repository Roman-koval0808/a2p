import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { TELNYX_API_KEY, TELNYX_MESSAGING_PROFILE_ID, TELNYX_PHONE_NUMBER } from '$env/static/private';

async function sendSMS(to: string, message: string): Promise<boolean> {
	if (!TELNYX_API_KEY) return false;
	try {
		const response = await fetch('https://api.telnyx.com/v2/messages', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${TELNYX_API_KEY}`
			},
			body: JSON.stringify({
				from: TELNYX_PHONE_NUMBER,
				to,
				text: message,
				messaging_profile_id: TELNYX_MESSAGING_PROFILE_ID
			})
		});
		return response.ok;
	} catch (e) {
		console.error('SMS send error:', e);
		return false;
	}
}

export const POST: RequestHandler = async ({ request }) => {
	try {
		const {
			rep_id,
			room_id,
			room_title,
			user_name,
			invite_url,
			send_methods = { sms: true, email: true }
		} = await request.json();

		if (!rep_id || !room_id || !invite_url) {
			return json({ error: 'Missing required fields' }, { status: 400 });
		}

		const rep_phone = request.headers.get('x-rep-phone');
		const rep_email = request.headers.get('x-rep-email');

		let smsSent = false;
		if (send_methods.sms && rep_phone) {
			const message = `You've been invited to assist in ${room_title || 'a view-room'} by ${user_name || 'a customer'}. Join here: ${invite_url}`;
			smsSent = await sendSMS(rep_phone, message);
		}

		let emailSent = false;
		if (send_methods.email && rep_email) {
			try {
				const { sendEmail } = await import('$lib/server/brevo');
				const emailSubject = `Invitation to Assist in ${room_title || 'View-Room'}`;
				const emailBody = `
            <p>Hello,</p>
            <p>You've been invited by ${user_name || 'a customer'} to assist in a view-room.</p>
            <p>Click the link below to join:</p>
            <p><a href="${invite_url}">${invite_url}</a></p>
            <p>Best regards,<br>View-Room Team</p>
          `;
				await sendEmail({
					to: [{ email: rep_email }],
					subject: emailSubject,
					htmlContent: emailBody
				});
				emailSent = true;
			} catch (emailError) {
				console.error('Email send error:', emailError);
			}
		}

		return json({
			success: true,
			message: 'Invite sent successfully',
			sms_sent: smsSent,
			email_sent: emailSent,
			notification_sent: false
		});
	} catch (error) {
		console.error('Error sending representative invite:', error);
		return json({ error: 'Internal server error' }, { status: 500 });
	}
};