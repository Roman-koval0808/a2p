import { prisma } from '$lib/db';
import { verifyCsToken } from '$lib/server/email/tracking';

export const GET = async ({ url }) => {
	const token = url.searchParams.get('t');
	const target = url.searchParams.get('url');

	if (!target) {
		return new Response('Missing url parameter', { status: 400 });
	}

	if (token) {
		const payload = await verifyCsToken(token);
		if (payload) {
			try {
				await prisma.contact.update({
					where: { id: payload.contactId },
					data: { engagementScore: { increment: 3 } }
				});
			} catch (err) {
				console.error('[track/click] Failed to update engagement:', err);
			}
			if (payload.commLogId) {
				try {
					await prisma.communicationLog.update({
						where: { id: payload.commLogId },
						data: { emailClickedAt: new Date() }
					});
				} catch (err) {
					console.error('[track/click] Failed to update comm log:', err);
				}
			}
		}
	}

	const decoded = decodeURIComponent(target);
	return new Response(null, {
		status: 302,
		headers: { Location: decoded }
	});
};
