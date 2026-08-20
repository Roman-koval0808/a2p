// Deterministic telemetry intake for the lead-grabber pipeline.
//
// Receives a batch of signals from the browser tracker, resolves/creates the
// PipelineCustomerProfile, and persists each signal as a PipelineEvent + PipelineSignal.
// No AI is invoked anywhere in this path — signals are strictly deterministic by design.

import { prisma } from '$lib/db';
import { randomUUID } from 'crypto';
import { toE164 } from '$lib/utils/phone';
import { SIGNAL_CATALOG, humanizeSignal, type TelemetrySignal } from '$lib/telemetry/signals';
import type { Attribution } from '$lib/telemetry/attribution';

// ── Comm-log visibility ─────────────────────────────────────────────────────
// Which signals surface as a communication-log row (the a2p comm log / sales inbox).
//   'all'         — every signal becomes a row (full audit trail)
//   'high_intent' — only scoreDelta >= COMM_LOG_MIN_DELTA or an explicit
//                   call/emergency/lead-form/review category
//   'off'         — no comm-log rows (signals still score the profile)
//
// Flip this when you no longer want the noise: set TELEMETRY_COMM_LOG_MODE in env,
// or change the fallback below. Low-intent rows are written with `notify: false`, so
// even in 'all' mode they never trigger an email/notification — only the high-intent
// ones do.
const COMM_LOG_MODE: 'all' | 'high_intent' | 'off' =
	(process.env.TELEMETRY_COMM_LOG_MODE as 'all' | 'high_intent' | 'off') || 'all';
const COMM_LOG_MIN_DELTA = 15;
const COMM_LOG_CATEGORIES = new Set(['call_emergency', 'lead_form', 'reviews', 'viewroom']);

function isHighIntent(ev: { category: string; delta: number }): boolean {
	return COMM_LOG_CATEGORIES.has(ev.category) || ev.delta >= COMM_LOG_MIN_DELTA;
}

function shouldLogBatch(eventIds: { category: string; delta: number }[]): boolean {
	if (COMM_LOG_MODE === 'off') return false;
	if (COMM_LOG_MODE === 'all') return true;
	return eventIds.some((ev) => isHighIntent(ev));
}

export interface SignalBatch {
	tenantSlug?: string | null;
	companyId?: string | null;
	sessionId?: string | null;
	fingerprintId?: string | null;
	name?: string | null;
	email?: string | null;
	phone?: string | null;
	attribution?: Attribution | null;
	signals: TelemetrySignal[];
}

function normalizeEmail(email: string | null | undefined): string | null {
	const v = email?.trim().toLowerCase();
	return v || null;
}

async function resolveCompany(tenantSlug?: string | null, companyId?: string | null) {
	const candidate = companyId || tenantSlug;
	if (!candidate) return null;
	return prisma.company.findFirst({
		where: { OR: [{ id: candidate }, { emailSlug: candidate }] },
		select: { id: true, name: true }
	});
}

async function resolveProfile(
	db: any,
	companyId: string,
	input: { fingerprintId?: string | null; name?: string | null; email?: string | null; phone?: string | null }
) {
	const email = normalizeEmail(input.email);
	const phone = input.phone ? toE164(input.phone) : null;
	const fingerprintId = input.fingerprintId?.trim() || null;

	if (phone) {
		const existing = await db.pipelineCustomerProfile.findUnique({
			where: { companyId_phoneNumber: { companyId, phoneNumber: phone } }
		});
		if (existing) return existing;
	}
	if (email) {
		const existing = await db.pipelineCustomerProfile.findUnique({
			where: { companyId_email: { companyId, email } }
		});
		if (existing) return existing;
	}
	if (fingerprintId) {
		const existing = await db.pipelineCustomerProfile.findFirst({
			where: { companyId, externalId: fingerprintId }
		});
		if (existing) {
			// Returning visitor recognised by fingerprint: adopt the name they gave in the
			// viewroom when the profile does not have one yet.
			const nameVal = input.name?.trim() || null;
			if (nameVal && !existing.displayName) {
				return db.pipelineCustomerProfile.update({
					where: { id: existing.id },
					data: { displayName: nameVal }
				});
			}
			return existing;
		}
	}

	const attrs: Record<string, unknown> = { engagementScore: 0 };
	if (fingerprintId) attrs.fingerprintId = fingerprintId;

	return db.pipelineCustomerProfile.create({
		data: {
			companyId,
			externalId: fingerprintId,
			displayName: input.name?.trim() || null,
			email,
			phoneNumber: phone,
			attributes: attrs as any,
			status: 'unknown'
		}
	});
}

export async function ingestSignalBatch(batch: SignalBatch): Promise<{ status: number; body: any }> {
	const { signals, attribution } = batch;

	if (!Array.isArray(signals) || signals.length === 0) {
		return { status: 400, body: { error: 'signals must be a non-empty array.' } };
	}

	const company = await resolveCompany(batch.tenantSlug, batch.companyId);
	if (!company) {
		return { status: 400, body: { error: 'tenantSlug/companyId did not resolve to a company.' } };
	}

	const accepted: string[] = [];
	const rejected: string[] = [];
	let scoreDelta = 0;

	const eventIds: { id: string; name: string; category: string; delta: number }[] = [];

	for (const sig of signals) {
		const def = SIGNAL_CATALOG[sig.name];
		if (!def) {
			rejected.push(sig.name);
			continue;
		}
		const id = randomUUID();
		eventIds.push({ id, name: def.name, category: def.category, delta: def.scoreDelta });
		scoreDelta += def.scoreDelta;
		accepted.push(def.name);
	}

	if (eventIds.length === 0) {
		return { status: 200, body: { success: true, accepted: [], rejected, eventCount: 0 } };
	}

	// Resolve the profile and persist events in ONE transaction so the profile the events
	// reference is always committed by the same connection that creates them.
	const { profileId, newEngagementScore } = await prisma.$transaction(async (tx: any) => {
		const profile = await resolveProfile(tx, company.id, {
			fingerprintId: batch.fingerprintId,
			name: batch.name,
			email: batch.email,
			phone: batch.phone
		});

		const attrs = (profile.attributes as Record<string, unknown>) || {};
		const currentScore = typeof attrs.engagementScore === 'number' ? attrs.engagementScore : 0;
		const newScore = Math.min(100, currentScore + scoreDelta);

		const now = new Date();
		for (const ev of eventIds) {
			await tx.pipelineEvent.create({
				data: {
					id: ev.id,
					eventId: `evt_${randomUUID()}`,
					provider: 'clearsky_pixel',
					providerEventName: ev.name,
					eventType: ev.name,
					networkCategory: ev.category === 'viewroom' ? 'Viewroom' : 'Web',
					companyId: company.id,
					customerProfileId: profile.id,
					occurredAt: now,
					receivedAt: now,
					unstructuredText: JSON.stringify({
						signal: ev.name,
						category: ev.category,
						scoreDelta: ev.delta,
						sessionId: batch.sessionId,
						fingerprintId: batch.fingerprintId,
						attribution
					}),
					requiresAiExtraction: false,
					aiExtractionCompleted: false,
					processingStatus: 'received',
					handoffEligible: false
				}
			});

			await tx.pipelineSignal.create({
				data: {
					eventId: ev.id,
					name: ev.name,
					bucket: ev.category,
					priority: 2,
					confidence: 1.0,
					status: 'candidate'
				}
			});
		}

		if (scoreDelta !== 0) {
			await tx.pipelineCustomerProfile.update({
				where: { id: profile.id },
				data: { attributes: { ...attrs, engagementScore: newScore } as any }
			});
		}

		return { profileId: profile.id, newEngagementScore: newScore };
	});

	const shouldLog = shouldLogBatch(eventIds);
	if (shouldLog) {
		await upsertSessionCommLog(company, profileId, batch, eventIds, newEngagementScore).catch(
			(err: any) => console.error('[telemetry] comm log write failed:', err?.message || err)
		);
	}

	return {
		status: 200,
		body: {
			success: true,
			accepted,
			rejected,
			eventCount: eventIds.length,
			profileId,
			scoreDelta,
			engagementScore: newEngagementScore
		}
	};
}

// One comm-log row per visitor session. All of a visitor's signals fold into a single
// communication thread (so they share one COM id), the row's summary is the latest signal,
// and the source is the fingerprint (or the profile name once they're recognised).
async function upsertSessionCommLog(
	company: { id: string; name: string | null },
	profileId: string,
	batch: SignalBatch,
	eventIds: { name: string; category: string; delta: number }[],
	engagementScore: number
) {
	const { createOrUpdateContact } = await import('$lib/utils/contacts');
	const { createNotification } = await import('$lib/utils/notifications');

	const name = batch.name?.trim() || null;
	const email = batch.email?.trim() || null;
	const phone = batch.phone?.trim() || null;
	const fingerprint = batch.fingerprintId?.trim() || null;
	const sessionId = batch.sessionId?.trim() || null;

	const contact = (name || email || phone)
		? await createOrUpdateContact({
				company_id: company.id,
				name: name || undefined,
				email: email || undefined,
				phone: phone || undefined
			})
		: null;

	// Persist the fingerprint(s) that resolved into this contact so the profile page can
	// show them and future visits can be recognised/merged by fingerprint.
	if (contact?.id && fingerprint) {
		const cMeta = ((contact as any).metadata as Record<string, any>) || {};
		const fps = Array.isArray(cMeta.fingerprints) ? cMeta.fingerprints : [];
		if (!fps.includes(fingerprint)) {
			await prisma.contact.update({
				where: { id: contact.id },
				data: { metadata: { ...cMeta, fingerprints: [...fps, fingerprint] } }
			});
		}
	}

	// Stable grouping key: the fingerprint identifies the user across page loads; fall back to the
	// session id when a visitor has no fingerprint.
	const sessionKey = fingerprint || sessionId;
	if (!sessionKey) return;

	const threadId = `vt_${sessionKey}`;
	const latest = eventIds[eventIds.length - 1];
	const type = latest.category === 'viewroom' ? 'viewroom' : 'web';
	const summary = humanizeSignal(latest.name);
	const source = name || fingerprint || email || phone || undefined;

	// Keep one thread per visitor so every signal shares the same COM id.
	await prisma.communicationThread.upsert({
		where: { id: threadId },
		create: {
			id: threadId,
			companyId: company.id,
			contactId: contact?.id ?? null,
			status: 'open',
			summary
		},
		update: { summary, contactId: contact?.id ?? undefined }
	});

	const existing = await prisma.communicationLog.findFirst({
		where: { companyId: company.id, communicationThreadId: threadId },
		orderBy: { created: 'desc' }
	});

	const incomingSignals = eventIds.map((e) => e.name);
	const meta = (existing?.metadata as Record<string, any>) || {};
	const signals = Array.isArray(meta.signals)
		? [...new Set([...meta.signals, ...incomingSignals])]
		: incomingSignals;
	const content = `Signals: ${signals.map(humanizeSignal).join(' → ')} · Engagement score ${engagementScore}`;

	// Notify once per session, the first time a high-intent signal arrives.
	const shouldNotify = eventIds.some((ev) => isHighIntent(ev)) && !meta.notified;
	const nextMeta = {
		...meta,
		latestSignal: latest.name,
		signals,
		scoreLive: engagementScore,
		source_signal: type,
		attribution: batch.attribution ?? meta.attribution,
		notified: !!meta.notified || shouldNotify
	};

	let logId: string;
	if (existing) {
		await prisma.communicationLog.update({
			where: { id: existing.id },
			data: {
				summary,
				content,
				source: source ?? existing.source,
				customerId: contact?.id ?? existing.customerId,
				metadata: nextMeta as any
			}
		});
		logId = existing.id;
	} else {
		const created = await prisma.communicationLog.create({
			data: {
				type,
				direction: 'inbound',
				status: 'success',
				source: source ?? null,
				destination: null,
				companyId: company.id,
				customerId: contact?.id ?? null,
				summary,
				content,
				communicationThreadId: threadId,
				metadata: { ...nextMeta, profileId } as any
			}
		});
		logId = created.id;
	}

	if (shouldNotify) {
		await createNotification({
			company_id: company.id,
			type: type as any,
			direction: 'inbound',
			source_name: name ?? fingerprint ?? undefined,
			source_identifier: fingerprint ?? undefined,
			message_preview: summary.slice(0, 120),
			content,
			communication_log_id: logId,
			thread_id: threadId
		} as any);
	}
}
