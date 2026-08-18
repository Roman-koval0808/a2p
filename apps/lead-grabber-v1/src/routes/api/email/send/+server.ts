import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAuth, unauthorized } from '$lib/api/spec';
import { logCommunication } from '$lib/utils/communication-log';
import { sendEmail as sendBrevoEmail } from '$lib/server/brevo';
import { BREVO_API_KEY } from '$env/static/private';

export const POST: RequestHandler = async ({ request, locals }) => {
	const auth = requireAuth(locals);
	if (!auth) return unauthorized();

	const body = await request.json().catch(() => ({}));
	const recipients = Array.isArray(body.recipients) ? body.recipients : [];
	const subject = typeof body.subject === 'string' ? body.subject : '';
	const bodyText = typeof body.body === 'string' ? body.body : '';
	const fromName = typeof body.fromName === 'string' ? body.fromName : '';

	if (!recipients.length || !subject || !bodyText) {
		return json(
			{ success: false, error: 'recipients, subject, and body are required', code: 400 },
			{ status: 400 }
		);
	}

	if (!BREVO_API_KEY) {
		return json(
			{ success: false, error: 'Email provider is not configured', code: 503 },
			{ status: 503 }
		);
	}

	const escapedBody = bodyText
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/\n/g, '<br/>');
	const htmlContent = `${fromName ? `<p><strong>From:</strong> ${fromName}</p>` : ''}<div>${escapedBody}</div>`;

	const results: { recipient: string; emailId: string; status: string; error?: string }[] = [];
	for (const to of recipients) {
		const emailId = `email_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
		try {
			await sendBrevoEmail({
				to: [{ email: to }],
				subject,
				htmlContent
			});

			await logCommunication({
				type: 'email',
				direction: 'outbound',
				status: 'success',
				source: fromName || undefined,
				destination: to,
				company_id: auth.companyId,
				summary: subject,
				content: bodyText,
				metadata: { emailId, subject }
			}).then((log) => {
				// Universal context check (outbound): an ad-hoc email that continues a conversation
				// (reply to a call/SMS/text) should reuse that conversation's shared COM id.
				if (log?.id) {
					Promise.resolve().then(async () => {
						try {
							const { resolveAndLinkContext } =
								await import('$lib/server/container/thread-resolver');
							const linked = await resolveAndLinkContext(log.id);
							console.log(
								`[Email Send] Context check: ${linked.resolved ? `linked to ${linked.commRef}` : `no link (${linked.reason})`}`
							);
						} catch (e) {
							console.error('[Email Send] Context check failed:', e);
						}
					});
				}
			});
			results.push({ recipient: to, emailId, status: 'sent' });
		} catch (err) {
			const error = err instanceof Error ? err.message : String(err);
			await logCommunication({
				type: 'email',
				direction: 'outbound',
				status: 'failed',
				source: fromName || undefined,
				destination: to,
				company_id: auth.companyId,
				summary: subject,
				content: bodyText,
				metadata: { emailId, subject, error }
			});
			results.push({ recipient: to, emailId, status: 'failed', error });
		}
	}

	const failed = results.filter((r) => r.status === 'failed').length;
	return json({
		success: failed === 0,
		data: { results },
		message:
			failed === 0
				? `Email sent to ${results.length} recipient(s)`
				: `Failed to send to ${failed} recipient(s)`
	});
};
