import { prisma } from '$lib/db';
import { verifyCsToken } from '$lib/server/email/tracking';

const PIXEL = Buffer.from(
	'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
	'base64'
);

export const GET = async ({ url }) => {
	const token = url.searchParams.get('t');
	if (!token) {
		return new Response(PIXEL, {
			headers: { 'Content-Type': 'image/gif', 'Cache-Control': 'no-cache, private' }
		});
	}

	const payload = await verifyCsToken(token);
	if (payload) {
		try {
			await prisma.contact.update({
				where: { id: payload.contactId },
				data: { engagementScore: { increment: 1 } }
			});
		} catch (err) {
			console.error('[track/open] Failed to update engagement:', err);
		}
		if (payload.commLogId) {
			try {
				await prisma.communicationLog.update({
					where: { id: payload.commLogId },
					data: { emailOpenedAt: new Date() }
				});
			} catch (err) {
				console.error('[track/open] Failed to update comm log:', err);
			}
		}
	}

	return new Response(PIXEL, {
		headers: {
			'Content-Type': 'image/gif',
			'Cache-Control': 'no-cache, private'
		}
	});
};
