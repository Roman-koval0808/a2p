import { prisma } from '$lib/db';

export type ConsentPurpose = 'transactional' | 'marketing';

function normalizePhone(phone: string): string {
	return (phone || '').trim().replace(/[^\d+]/g, '');
}

/**
 * Whether an SMS of the given purpose may be sent to `phone` for `companyId`.
 *
 * Transactional (callback-ack, emergency guidance, appointment reminders) is
 * implied when a customer initiates contact — allowed unless explicitly revoked.
 * Marketing requires an explicit granted opt-in record (tracker #30).
 */
export async function hasSmsConsent(
	companyId: string,
	phone: string,
	purpose: ConsentPurpose
): Promise<boolean> {
	const normPhone = normalizePhone(phone);
	if (!normPhone) return false;
	const row = await prisma.smsConsent.findUnique({
		where: { companyId_phone_purpose: { companyId, phone: normPhone, purpose } }
	});
	if (purpose === 'transactional') {
		return !row || row.status === 'granted';
	}
	return !!row && row.status === 'granted';
}

/** Record (or update) a consent decision. */
export async function recordSmsConsent(opts: {
	companyId: string;
	phone: string;
	purpose: ConsentPurpose;
	status?: 'granted' | 'revoked';
	source?: string;
}) {
	const normPhone = normalizePhone(opts.phone);
	const status = opts.status ?? 'granted';
	return prisma.smsConsent.upsert({
		where: {
			companyId_phone_purpose: { companyId: opts.companyId, phone: normPhone, purpose: opts.purpose }
		},
		update: { status, source: opts.source, revokedAt: status === 'revoked' ? new Date() : null },
		create: {
			companyId: opts.companyId,
			phone: normPhone,
			purpose: opts.purpose,
			status,
			source: opts.source
		}
	});
}
