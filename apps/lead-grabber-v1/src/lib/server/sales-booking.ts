import { prisma } from '$lib/db';
import { resolveAndMergeLocalProfile } from '$lib/server/pipeline/profile-service';
import { processSalesVoicemailBooking } from '$lib/server/scenarios/s4-sms-booking';

/**
 * Scenario 4 live wiring: connects the sales branch of process_orchestrator to the tested SMS
 * booking module. The module writes a CommHold + CommApproval + hold_expiry timer keyed by a
 * container id, so it MUST be given a real CommContainer id — the orchestrator previously passed a
 * CommunicationLog id, which is not a `comm_containers` FK and threw. This resolves the customer's
 * open container (created at intake by the voice bridge), links the Contact so the inbound-SMS reply
 * matcher can find it by phone, and calls the module with the correct commId.
 */
export async function runSalesVoicemailBooking(
	input: {
		companyId: string;
		customerPhone: string;
		contactId?: string | null;
		customerName?: string | null;
		isLandline?: boolean;
		transcript: string;
		datetimeIso?: string | null;
		vehicleInterest?: string;
		callStartTime: Date;
		availableResources: { salespeople: string[]; vehicles: string[] };
		now?: Date;
	},
	tx?: any
): Promise<{ ran: boolean; reason?: string; smsDrafted?: boolean; approval?: any; commId?: string }> {
	const db = tx || prisma;

	let customerProfileId: string | null = null;
	try {
		const profile = await resolveAndMergeLocalProfile(db, {
			companyId: input.companyId,
			phone: input.customerPhone,
			name: input.customerName || undefined
		});
		customerProfileId = profile?.id ?? null;
	} catch {
		customerProfileId = null;
	}

	// Find the customer's open container (bridge-created). Prefer sales/general over emergency.
	let container: any = null;
	if (customerProfileId) {
		const containers = await db.commContainer.findMany({
			where: { companyId: input.companyId, customerProfileId, state: { not: 'closed' } },
			orderBy: { openedAt: 'desc' }
		});
		container =
			containers.find((c: any) => c.threadType === 'sales' || c.threadType === 'general') ||
			containers[0] ||
			null;
	}
	if (!container) return { ran: false, reason: 'no_container' };

	// Link the Contact so the inbound-SMS reply matcher (which matches by phone) can find it.
	if (input.contactId && container.contactId !== input.contactId) {
		try {
			await db.commContainer.update({ where: { id: container.id }, data: { contactId: input.contactId } });
		} catch {
			/* non-fatal */
		}
	}

	const target = input.datetimeIso ? new Date(input.datetimeIso) : undefined;
	const res = await processSalesVoicemailBooking({
		commId: container.id,
		companyId: input.companyId,
		customerProfileId: customerProfileId || undefined,
		customerPhone: input.customerPhone,
		isLandline: input.isLandline,
		datetimeStr: input.datetimeIso ? input.datetimeIso.slice(0, 10) : undefined,
		hour: target?.getUTCHours(),
		minute: target?.getUTCMinutes(),
		vehicleInterest: input.vehicleInterest,
		callStartTime: input.callStartTime,
		availableResources: input.availableResources,
		now: input.now
	});

	return {
		ran: true,
		smsDrafted: !!(res as any).smsDrafted,
		approval: (res as any).approval,
		commId: container.id,
		reason: (res as any).slotAvailable === false ? 'slot_unavailable' : undefined
	};
}
