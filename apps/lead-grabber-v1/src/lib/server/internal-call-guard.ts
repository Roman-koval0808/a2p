import { prisma } from '$lib/db';

function last10(p: string): string {
	return (p || '').replace(/[^\d]/g, '').slice(-10);
}

/**
 * Internal/operational-call guard (Epic 4, T4.4).
 *
 * True when the FROM number is one of the company's own lines — e.g. the owner
 * leaving himself an operational voicemail ("order a heater, took a $500 deposit").
 * Such calls must NOT be run through the customer-classification pipeline, or they
 * get scored as a customer emergency and can trigger an automated emergency SMS.
 *
 * Limitation: only catches company-registered numbers. Catching a rep's personal
 * cell needs a rep-phone registry (follow-up).
 */
export async function isInternalCaller(companyId: string, fromPhone: string): Promise<boolean> {
	const norm = last10(fromPhone);
	if (!norm) return false;
	const nums = await prisma.companyPhoneNumber.findMany({
		where: { companyId },
		select: { phoneNumber: true }
	});
	return nums.some((n) => last10(n.phoneNumber) === norm);
}
