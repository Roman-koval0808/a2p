import { prisma } from '$lib/db';
import { hasSmsConsent } from './consent';
import { sendAutomatedSms } from './sms';
import { buildCallContextSummary } from './call-context-summary';

export interface CallbackAckResult {
	sent: boolean;
	reason?: string;
	message?: string;
	slaMinutes?: number;
	/** Internal rep-facing context recap (T3.5), for attaching to the callback task/alert. */
	repContext?: string;
}

/**
 * Pre-approved callback acknowledgement: "a representative will call you in X minutes." (T3.1)
 *
 * Fires WITHOUT a human approval click — it's a fixed, non-financial template — but is
 * still gated by business config (sms_auto_reply_allowed), transactional consent, and,
 * when configured, office hours. X is the business's sla_minutes.
 */
export async function sendCallbackAck(opts: {
	companyId: string;
	phone: string;
	customerName?: string | null;
	summary?: string | null;
	requestedAction?: string | null;
	brand?: string;
}): Promise<CallbackAckResult> {
	const phone = (opts.phone || '').replace(/[^\d+]/g, '');
	if (!phone) return { sent: false, reason: 'no_phone' };

	const config = await prisma.pipelineBusinessConfig.findUnique({
		where: { companyId: opts.companyId }
	});

	// Fail-safe: only auto-send when a config explicitly enables it. A missing config
	// (or smsAutoReplyAllowed=false) means no unattended customer SMS.
	if (!config?.smsAutoReplyAllowed) {
		return { sent: false, reason: 'sms_auto_reply_disabled' };
	}
	if (config?.officeHours && !isWithinOfficeHours(config.officeHours)) {
		return { sent: false, reason: 'outside_office_hours' };
	}
	if (!(await hasSmsConsent(opts.companyId, phone, 'transactional'))) {
		return { sent: false, reason: 'no_transactional_consent' };
	}

	const slaMinutes = config?.slaMinutes ?? 10;
	const name = opts.customerName?.trim() || 'there';
	const brand = opts.brand || 'RightFlush Plumbing';
	const message = `Hi ${name}, thanks for reaching out — a representative will call you back in ${slaMinutes} minutes. — ${brand}`;

	await sendAutomatedSms(phone, message);

	const repContext = buildCallContextSummary({
		customerName: opts.customerName,
		phone,
		summary: opts.summary,
		requestedAction: opts.requestedAction
	});

	return { sent: true, message, slaMinutes, repContext };
}

/** Minimal office-hours check against a structured { mon: { open, close, isOpen }, ... } map. */
function isWithinOfficeHours(officeHours: any): boolean {
	try {
		const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
		const now = new Date();
		const cfg = officeHours?.[days[now.getDay()]];
		if (!cfg) return true; // unconfigured day → don't block
		if (cfg.isOpen === false) return false;
		if (!cfg.open || !cfg.close) return true;
		const hhmm = now.getHours() * 60 + now.getMinutes();
		const [oh, om] = String(cfg.open).split(':').map(Number);
		const [ch, cm] = String(cfg.close).split(':').map(Number);
		return hhmm >= oh * 60 + om && hhmm <= ch * 60 + cm;
	} catch {
		return true;
	}
}
