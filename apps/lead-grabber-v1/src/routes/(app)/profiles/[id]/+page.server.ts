import { prisma } from '$lib/db';
import {
	communicationSurface,
	applyEngagementFallbacks,
	loadLineTypes,
	COMMUNICATION_SURFACE_INCLUDE
} from '$lib/server/communication-surface';
import { redirect, error } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { commCode } from '$lib/utils/comm-id';
import { assignRepresentative } from '$lib/server/profiledb/profiles';
import { tierForIdentifiers, type LineType } from '$lib/server/profiledb/tiers';
import { toE164 } from '$lib/utils/phone';

export const load: PageServerLoad = async ({ params, locals }) => {
	const user = locals.user;

	if (!user) {
		throw redirect(303, '/login');
	}

	if (!user.company) {
		throw redirect(303, '/create-company');
	}

	const companyId = user.company.id;

	// Get user's role
	const companyMember = await prisma.companyMember.findFirst({
		where: {
			userId: user.id,
			companyId: user.company.id
		}
	});
	const userRole = companyMember?.role || 'member';

	// If super admin, fetch all representatives for assignment dropdown
	let representatives: any[] = [];
	if (userRole === 'admin') {
		const members = await prisma.companyMember.findMany({
			where: { companyId: user.company.id, role: 'member' },
			include: { user: true }
		});
		representatives = members.map((m) => ({
			id: m.user.id,
			name: m.user.name,
			email: m.user.email
		}));
	}

	try {
		// ProfileDB is redundant — this page is sourced entirely from the main database.
		// It previously read the score and history from ProfileDB, but the route param is a Contact
		// id (cuid) while ProfileDB keys profiles by uuid, so every lookup missed and the page fell
		// back to a stub with scoreLive 0 and an empty history. That is why scores and history did
		// not show.
		const dbContact = await prisma.contact.findFirst({
			where: { id: params.id, companyId }
		});
		if (!dbContact) {
			throw error(404, 'Profile not found');
		}

		// Fingerprints that resolved into this contact (telemetry persists them on the
		// contact when a session is attributed to it).
		const contactMeta = (dbContact.metadata as Record<string, any>) || {};
		const fingerprints: string[] = Array.isArray(contactMeta.fingerprints)
			? contactMeta.fingerprints
			: [];

		// The communication log IS this profile's history in the main database.
		const historySource = await prisma.communicationLog.findMany({
			where: { companyId, customerId: dbContact.id },
			orderBy: { created: 'asc' },
			take: 200
		});

		// Map comms into the event shape the identity/behaviour passes below already expect.
		const historyEvents: any[] = historySource.map((log) => {
			const md = (log.metadata as Record<string, any>) || {};
			const isEmail = log.type === 'email';
			// Telemetry rows (web/viewroom) are device signals, not phone calls/emails — their
			// source is a fingerprint, so they must never render as a phone number.
			const isTelemetry = Array.isArray(md.signals) || md.source_signal === 'web' || md.source_signal === 'viewroom';
			return {
				eventType: `${log.type}.${log.direction}`,
				occurredAt: log.created,
				pageUrl: md.pageUrl ?? null,
				name: md.name ?? md.callerName ?? dbContact.name ?? null,
				phone: isEmail || isTelemetry ? null : log.direction === 'inbound' ? log.source : log.destination,
				email: isEmail
					? log.direction === 'inbound'
						? log.source
						: log.destination
					: (dbContact.email ?? null),
				payload: { ...md, textContent: log.content ?? undefined }
			};
		});

		// Line type decides whether this contact's number can identify a person at all (§4.3a).
		// Read from the cache rather than looked up live — a profile page must not wait on Telnyx,
		// and an unclassified number simply stays Tier 2.
		let contactLineType: LineType | undefined;
		try {
			const e164 = toE164(dbContact.phone);
			if (e164) {
				const cached = await prisma.numberLookup.findUnique({
					where: { phoneNumber: e164 },
					select: { lineType: true }
				});
				contactLineType = (cached?.lineType as LineType) ?? undefined;
			}
		} catch (e: any) {
			console.error('[profile] could not read line type:', e?.message || e);
		}

		// The engagement score the orchestrator maintains on the Contact is the real score here.
		const cdpProfile: any = {
			id: dbContact.id,
			name: dbContact.name || 'Unknown Caller',
			phone: dbContact.phone || '',
			email: dbContact.email || '',
			clearPhone: dbContact.phone || '—',
			clearEmail: dbContact.email || '—',
			// A phone alone is not an exclusive identifier — a landline or VoIP number identifies a
			// shared handset, not a person, so it stays Tier 2 until a mobile or email turns up
			// (§4.3a). An unclassified number is treated the same way; never default upward.
			tier: tierForIdentifiers({
				hasEmail: !!dbContact.email,
				hasPhone: !!dbContact.phone,
				lineType: contactLineType,
				hasName: !!dbContact.name
			}),
			scoreLive: dbContact.engagementScore ?? 0,
			intentBucket: 'unclassified',
			isAnonymous: !dbContact.email && !dbContact.phone,
			lastSeen: dbContact.updated || new Date()
		};

		// 3. Compute Identity Resolution History
		const identityHistory: any[] = [];
		let currentName: string | null = null;
		let currentEmail: string | null = null;
		let currentPhone: string | null = null;

		let clearPhone = cdpProfile.clearPhone || '—';
		let clearEmail = cdpProfile.clearEmail || '—';

		historyEvents.forEach((ev: any) => {
			const payload = ev.payload || {};
			const emailVal =
				payload.email || payload.metadata?.email || payload.payload?.email || ev.email || null;
			let nameVal =
				payload.name || payload.metadata?.name || payload.payload?.name || ev.name || null;
			const phoneVal =
				payload.phone || payload.metadata?.phone || payload.payload?.phone || ev.phone || null;

			// Do not record "Unknown Caller" or Anonymous as valid identity updates
			if (nameVal === 'Unknown Caller' || nameVal === 'Anonymous') {
				nameVal = null;
			}

			if (phoneVal && phoneVal !== '—') {
				clearPhone = phoneVal;
			} else if (payload.textContent && clearPhone === '—') {
				const match = payload.textContent.match(/Voice Call from:\s*(\+?[\d\s\-()]+)/);
				if (match) clearPhone = match[1].trim();
			}
			if (emailVal && emailVal !== '—') {
				clearEmail = emailVal;
			}

			if (nameVal && nameVal !== currentName) {
				identityHistory.push({
					timestamp: ev.occurredAt,
					field: 'Name',
					oldValue: currentName,
					newValue: nameVal
				});
				currentName = nameVal;
			}
			if (emailVal && emailVal !== currentEmail) {
				identityHistory.push({
					timestamp: ev.occurredAt,
					field: 'Email',
					oldValue: currentEmail,
					newValue: emailVal
				});
				currentEmail = emailVal;
			}
			if (phoneVal && phoneVal !== currentPhone) {
				identityHistory.push({
					timestamp: ev.occurredAt,
					field: 'Phone',
					oldValue: currentPhone,
					newValue: phoneVal
				});
				currentPhone = phoneVal;
			}
		});

		// 4. Compute behavioral facts
		let viewedService = false;
		let viewedPricing = false;
		let formSubmitted = false;

		historyEvents.forEach((ev: any) => {
			if (ev.pageUrl && (ev.pageUrl.includes('pricing') || ev.eventType.includes('price'))) {
				viewedPricing = true;
			}
			if (
				ev.pageUrl &&
				(ev.pageUrl.includes('service') ||
					ev.eventType.includes('svc') ||
					ev.pageUrl.includes('bathroom') ||
					ev.pageUrl.includes('roof') ||
					ev.pageUrl.includes('hot-water') ||
					ev.pageUrl.includes('drain'))
			) {
				viewedService = true;
			}
			if (ev.eventType.includes('submit') || ev.eventType.includes('booked')) {
				formSubmitted = true;
			}
		});

		let intentLevel = 'Low';
		if (cdpProfile.intentBucket === 'emergency') intentLevel = 'Emergency';
		else if (cdpProfile.scoreLive >= 80) intentLevel = 'Very High';
		else if (cdpProfile.scoreLive >= 50 || (viewedService && viewedPricing)) intentLevel = 'High';
		else if (viewedService) intentLevel = 'Medium';

		let interpretation =
			'Monitor page views and visitor interaction logs to build a behavioral profile.';
		let recAction = 'Monitor Behavior';

		const isAnonymous = !clearEmail && !clearPhone;
		if (cdpProfile.intentBucket === 'emergency') {
			interpretation =
				'Active emergency situation detected. Urgent assistance required. Auto-dispatching technician.';
			recAction = 'Verify dispatch status';
		} else if (intentLevel === 'High' && !formSubmitted) {
			interpretation =
				"Visitor viewed service pages and pricing, showing strong buying intent but hasn't booked yet. Recommend showing a limited-time promo banner or exit intent discount.";
			recAction = 'Show 20% Promo Banner';
		} else if (formSubmitted) {
			interpretation =
				'Visitor successfully submitted a lead capture form. Follow-up workflow initiated.';
			recAction = 'Queue follow-up draft';
		} else if (intentLevel === 'Very High' && !isAnonymous) {
			interpretation =
				'High score + identified contact details. Trigger automated SMS outreach / email follow-up sequence immediately.';
			recAction = 'Notify owner / Dispatch SMS';
		}

		// 5. Query CommunicationLog for the table
		const dbLogs = await prisma.communicationLog.findMany({
			where: {
				companyId: locals.user.company.id,
				OR: [
					{ customerId: params.id },
					...(clearPhone !== '—' ? [{ source: clearPhone }, { destination: clearPhone }] : []),
					...(clearEmail !== '—' ? [{ source: clearEmail }, { destination: clearEmail }] : [])
				]
			},
			orderBy: { created: 'desc' },
			include: COMMUNICATION_SURFACE_INCLUDE
		});

		// Our own scheduled-intent rows (the §10 CRM note and the old ack log) are internal
		// bookkeeping, not conversation — keep them in the DB (the schedule card reads them)
		// but keep them out of the conversation table so one email shows as one conversation.
		const conversationLogs = dbLogs.filter((log) => {
			const md = (log.metadata as Record<string, any>) || {};
			return !(md.scheduled_intent_note === true || md.scheduled_intent_ack === true);
		});

		// File manager: every attachment stored on the contact's email logs (Bunny CDN URLs
		// from gmail-sync / bridge) collected into one list for the Files dialog.
		const files = conversationLogs
			.flatMap((log) => {
				const md = (log.metadata as Record<string, any>) || {};
				const atts = Array.isArray(md.attachments) ? md.attachments : [];
				return atts.map((a: any) => ({
					name: a.name ?? 'file',
					url: a.url ?? '',
					mime: a.mime ?? '',
					direction: log.direction,
					created: log.created.toISOString(),
					commId: commCode(log.communicationThreadId, md.commRef, log.created, Date.now(), log.id),
					summary: log.summary || ''
				}));
			})
			.sort((a, b) => b.created.localeCompare(a.created));

		const lineTypes = await loadLineTypes(prisma, conversationLogs);
		const comms = applyEngagementFallbacks(conversationLogs.map((log) => {
			// Same surface the communication-log page renders, from the same helper, so the shared
			// CommunicationTable shows identical cells on both pages.
			const surface = communicationSurface(log, lineTypes);
			const dateObj = new Date(log.created);
			const date = dateObj.toLocaleDateString('en-US', {
				month: 'short',
				day: '2-digit',
				year: 'numeric'
			});
			const time = dateObj.toLocaleTimeString('en-US', {
				hour: 'numeric',
				minute: '2-digit',
				hour12: true
			});

			const meta = (log.metadata as any) || {};
			const summary = log.summary || log.content || '';
			const cap = (s: string) =>
				(s ?? '').charAt(0).toUpperCase() + (s ?? '').slice(1).toLowerCase();

			let status = 'green';
			if (meta.drop_call || meta.message_category === 'emergency') status = 'red';
			else if (log.status === 'pending_approval') status = 'blue';
			else if (log.direction === 'inbound') status = 'in';
			else status = 'out';

			// Same purpose logic as the communication log
			let purpose = 'General';
			if (meta.drop_call) {
				purpose = 'Missed Call';
			} else if (log.status === 'pending_approval') {
				purpose = 'Confirm';
			} else if (meta.message_category) {
				purpose =
					meta.message_category === 'emergency'
						? 'Urgent Support'
						: meta.message_category === 'sales'
							? 'Sales Opportunity'
							: cap(meta.message_category);
			} else if (meta.category_gpt) {
				purpose = cap(meta.category_gpt);
			} else if (meta.ivr_intent) {
				purpose = cap(meta.ivr_intent);
			} else if (meta.sub_intent && !['general', 'sales', 'support', 'quote', 'opportunity'].includes(meta.sub_intent.toLowerCase())) {
				purpose = meta.sub_intent;
			} else if (meta.intent || meta.sentiment) {
				const raw = (meta.intent || meta.sentiment || '').toLowerCase();
				let word = cap(meta.intent || meta.sentiment);
				if (raw === 'quote') word = 'Quote Request';
				else if (raw === 'sales' || raw === 'opportunity') word = 'Sales Opportunity';
				else if (raw === 'support') word = 'Support Inquiry';
				purpose = word;
			} else if (summary) {
				purpose = 'See Summary';
			}

			// Random-looking per-THREAD COM ID (hash of the thread id, anchored on the message's own
			// id when unlinked) — related messages share it, a different context gets a new one.
			// Rows linked to a CommContainer display the container's commRef (cross-channel).
			const convoCode = commCode(log.communicationThreadId, meta.commRef, log.created, Date.now(), log.id);

			let endpoint = log.destination || locals.user.company.id;
			if (
				log.direction === 'outbound' &&
				meta.is_emergency_dispatch &&
				Array.isArray(meta.recipients)
			) {
				endpoint = meta.recipients.map((r: any) => r.name || r.number).join(', ');
			}

			return {
				id: log.id,
				date,
				time,
				type: log.type,
				direction: log.direction === 'inbound' ? 'In' : 'Out',
				source: log.source || 'Unknown',
				endpoint,
				purpose: purpose,
				summary: summary,
				commId: convoCode,
				status,
				emailOpenedAt: log.emailOpenedAt?.toISOString() ?? null,
				emailClickedAt: log.emailClickedAt?.toISOString() ?? null,
				raw: log,
				...surface
			};
		// Same engagement-level fill as the communication-log page, from the same helper, so the
		// two render identical cells.
		}));

		// ClearSky Scheduled Intents (spec §10): this customer's schedule — a separate
		// LOOK-UP list, deliberately not the agent queue ("the queue is today's work").
		// Agents can see what's coming and cancel/reschedule OUR plan; the customer's
		// words live on in the communication log above, untouched.
		const scheduledIntents = await prisma.scheduledIntent.findMany({
			where: { clientId: companyId, profileId: dbContact.id },
			orderBy: { dueAt: 'asc' },
			take: 20,
			select: {
				id: true,
				intentType: true,
				status: true,
				actor: true,
				dueAt: true,
				expiresAt: true,
				payload: true,
				createdAt: true
			}
		});

		return {
			profile: {
				...cdpProfile,
				clearPhone,
				clearEmail,
				past_names: identityHistory.filter((h) => h.field === 'Name').map((h) => h.newValue)
			},
			fingerprints,
			accountBalance: dbContact?.accountBalance ?? null,
			engagementScore: dbContact.engagementScore ?? 0,
			communications: comms,
			scheduledIntents,
			files,
			historyEvents,
			identityHistory,
			behavioralFacts: {
				viewedService,
				viewedPricing,
				formSubmitted
			},
			behavioralAnalysis: {
				intentLevel,
				interpretation,
				recAction
			},
			userRole,
			representatives,
			userCompanyId: locals.user.company.id
		};
	} catch (e) {
		if (e && typeof e === 'object' && 'status' in e && (e as { status: number }).status === 404) {
			throw e;
		}
		console.error('Error fetching profile:', e);
		throw error(500, 'Failed to fetch profile');
	}
};

export const actions: Actions = {
	updateProfile: async ({ request, params, locals }) => {
		const user = locals.user;
		if (!user?.company) return { success: false };
		const form = await request.formData();
		const id = params.id;
		const name = form.get('name')?.toString() ?? null;
		const email = form.get('email')?.toString() ?? null;
		const phone = form.get('phone')?.toString() ?? null;
		try {
			await prisma.contact.updateMany({
				where: { id, companyId: user.company.id },
				data: { name, email, phone, updated: new Date() }
			});
			return { success: true };
		} catch (e) {
			console.error('Error updating profile:', e);
			return { success: false };
		}
	},

	deleteProfile: async ({ params, locals }) => {
		const user = locals.user;
		if (!user?.company) return { success: false };
		try {
			// Our schedule rows are plans filed under this profile — they die with it.
			await prisma.scheduledIntent.deleteMany({
				where: { clientId: user.company.id, profileId: params.id }
			});
			await prisma.contact.deleteMany({
				where: { id: params.id, companyId: user.company.id }
			});
			return { success: true };
		} catch (e) {
			console.error('Error deleting profile:', e);
			return { success: false };
		}
	},
	assignRepresentative: async ({ request, params, locals }) => {
		const user = locals.user;
		if (!user?.company) return { success: false };

		// Verify user is an admin
		const companyMember = await prisma.companyMember.findFirst({
			where: { userId: user.id, companyId: user.company.id }
		});
		if (companyMember?.role !== 'admin') return { success: false, error: 'Unauthorized' };

		const form = await request.formData();
		const representativeId = form.get('representativeId')?.toString() || null;
		const id = params.id;

		try {
			const result = await assignRepresentative(user.company.id, id, representativeId);

			if (result.status >= 200 && result.status < 300) {
				return { success: true };
			} else {
				console.error('Failed to assign representative in ProfileDB');
				return { success: false, error: 'Failed to assign representative' };
			}
		} catch (e) {
			console.error('Error assigning representative:', e);
			return { success: false, error: 'Failed to assign representative' };
		}
	}
};
