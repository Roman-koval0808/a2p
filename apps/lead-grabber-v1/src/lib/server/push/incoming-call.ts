import { prisma } from '$lib/db';
import { getFcmMessaging } from './firebase';

export type IncomingCallPushPayload = {
	companyId: string;
	callControlId: string;
	from: string;
	to: string;
	callerName: string;
};

/**
 * Notify active company members who registered an FCM token.
 * Intended as fire-and-forget from webhooks; logs errors, does not throw to callers.
 */
export async function notifyIncomingCallViaPush(payload: IncomingCallPushPayload): Promise<void> {
	const messaging = getFcmMessaging();
	if (!messaging) {
		return;
	}

	const members = await prisma.companyMember.findMany({
		where: { companyId: payload.companyId, status: 'active' },
		select: { userId: true }
	});
	const userIds = [...new Set(members.map((m) => m.userId))];
	if (!userIds.length) {
		return;
	}

	const devices = await prisma.userDevice.findMany({
		where: {
			userId: { in: userIds },
			fcmToken: { not: null }
		},
		select: { fcmToken: true }
	});
	const tokens = devices.map((d) => d.fcmToken as string).filter(Boolean);
	if (!tokens.length) {
		return;
	}

	const data: Record<string, string> = {
		type: 'incoming_call',
		callControlId: payload.callControlId,
		from: payload.from,
		to: payload.to,
		callerName: payload.callerName,
		companyId: payload.companyId
	};

	try {
		const res = await messaging.sendEachForMulticast({
			tokens,
			data,
			android: { priority: 'high' },
			apns: {
				headers: { 'apns-priority': '10' },
				payload: {
					aps: {
						'content-available': 1
					}
				}
			}
		});

		const deadTokens: string[] = [];
		res.responses.forEach((r, i) => {
			if (!r.success) {
				const code = r.error?.code ?? '';
				if (
					code === 'messaging/registration-token-not-registered' ||
					code === 'messaging/invalid-registration-token'
				) {
					const t = tokens[i];
					if (t) deadTokens.push(t);
				}
			}
		});
		if (deadTokens.length) {
			await prisma.userDevice.deleteMany({
				where: { fcmToken: { in: deadTokens } }
			});
		}
	} catch (e) {
		console.error('[push] FCM multicast failed:', e);
	}
}
