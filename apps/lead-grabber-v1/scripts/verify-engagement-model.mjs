/**
 * Manual acceptance check for the 2026-08-25 engagement-model work.
 *
 * Mirrors the roadmap's own acceptance tests, end to end through the real intake route and the
 * real database — the unit tests cover the decision functions in isolation, this covers the wiring.
 *
 *   pnpm dev                                   # in apps/lead-grabber-v1, another terminal
 *   node scripts/verify-engagement-model.mjs   # from apps/lead-grabber-v1
 *
 * Every fixture uses a throwaway fingerprint so nothing touches a real visitor's thread.
 */

import { PrismaClient } from 'clearsky-db-client';
import { readFileSync } from 'node:fs';

const BASE = process.env.A2P_BASE ?? 'http://localhost:3005';
const COMPANY = process.env.A2P_COMPANY ?? 'cmkwntxej0004g1tiwmwbgazn';

function databaseUrl() {
	if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
	for (const f of ['.env.local', '.env']) {
		try {
			const line = readFileSync(f, 'utf8').split('\n').find((l) => l.startsWith('DATABASE_URL='));
			if (line) return line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
		} catch {}
	}
	throw new Error('DATABASE_URL not found — set it or run from apps/lead-grabber-v1');
}

const url = databaseUrl() + (databaseUrl().includes('?') ? '&' : '?') + 'connection_limit=2&pool_timeout=30';
const prisma = new PrismaClient({ datasources: { db: { url } } });

let pass = 0;
let fail = 0;
function check(label, ok, detail = '') {
	if (ok) { pass++; console.log(`  PASS  ${label}`); }
	else { fail++; console.log(`  FAIL  ${label}${detail ? `\n          ${detail}` : ''}`); }
}

const fp = () => 'vfy' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

async function send(fingerprint, signals, extra = {}) {
	const res = await fetch(`${BASE}/api/v1/telemetry/signals`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			tenantSlug: COMPANY,
			sessionId: 'sess_' + Math.random().toString(36).slice(2),
			fingerprintId: fingerprint,
			signals: signals.map((s) =>
				typeof s === 'string'
					? { name: s, occurredAt: new Date().toISOString(), payload: {} }
					: { name: s.name, occurredAt: new Date().toISOString(), payload: s.payload ?? {} }
			),
			...extra
		})
	});
	if (!res.ok) throw new Error(`intake returned ${res.status}`);
	return res.json();
}

const threadsFor = (fingerprint) =>
	prisma.communicationLog.findMany({
		where: {
			companyId: COMPANY,
			OR: [
				{ communicationThreadId: `vt_${fingerprint}` },
				{ communicationThreadId: { startsWith: `vt_${fingerprint}_` } }
			]
		},
		include: { communicationThread: true },
		orderBy: { created: 'asc' }
	});

const threadOf = async (fingerprint) => {
	const rows = await threadsFor(fingerprint);
	return rows.length ? rows[rows.length - 1].communicationThread : null;
};

// ── §1 + Bug B — Engagement is a business episode ───────────────────────────
async function engagementIsAnEpisode() {
	console.log('\n§1  Engagement = business episode (+ Bug B)');
	const f = fp();

	await send(f, [{ name: 'page_load', payload: { url: '/furnace-repair' } }, 'scroll_25']);
	const t1 = await threadOf(f);
	check('a first session opens an engagement', !!t1?.id, `got ${t1?.id}`);

	// Different type of work, same contact — must NOT fork.
	await send(f, [{ name: 'page_load', payload: { url: '/services/drains' } }, 'svc_click']);
	const t2 = await threadOf(f);
	check('a different subtopic stays on the same engagement', t2?.id === t1?.id, `${t1?.id} vs ${t2?.id}`);

	const subs = Array.isArray(t2?.subtopics) ? t2.subtopics : [];
	check('both subtopics are rolled up', subs.includes('furnace') && subs.includes('drain'), `subtopics = ${JSON.stringify(subs)}`);

	// Bug B — a return with nothing identifying the subject must not fork either.
	await send(f, ['scroll_50']);
    const t3 = await threadOf(f);
	check('Bug B: a bare return with no subject stays on the engagement', t3?.id === t1?.id, `${t1?.id} vs ${t3?.id}`);

	check('the assignment records why it landed there', !!t3?.assignReason && !!t3?.rulesVersion,
		`assignReason=${t3?.assignReason} rulesVersion=${t3?.rulesVersion}`);

	// Window lapsed → a fresh episode.
	// `updated` is @updatedAt — Prisma overwrites any explicit value, so age the rows in raw SQL.
	const old = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);
	await prisma.$executeRawUnsafe(
		`UPDATE communication_threads SET updated = $1 WHERE id = $2`, old, t1.id);
	await prisma.$executeRawUnsafe(
		`UPDATE communication_logs SET updated = $1 WHERE "communicationThreadId" = $2`, old, t1.id);
	await send(f, [{ name: 'page_load', payload: { url: '/furnace-repair' } }]);
	const t4 = await threadOf(f);
	check('a return after the window opens a NEW engagement', t4?.id && t4.id !== t1.id, `${t1?.id} vs ${t4?.id}`);
	return f;
}

// ── §2 — subtopic storage, rollup and per-subtopic score ────────────────────
async function subtopicScoring() {
	console.log('\n§2  Subtopic tracking + per-subtopic score');
	const f = fp();

	// The worked example: kitchen browsing, then a bathroom quote, in one session.
	await send(f, [
		{ name: 'page_load', payload: { url: '/kitchen-remodel' } },
		{ name: 'scroll_50', payload: { url: '/kitchen-remodel' } },   // +5
		{ name: 'dwell_60', payload: { url: '/kitchen-remodel' } },    // +7
		{ name: 'svc_click', payload: { url: '/kitchen-remodel' } },   // +8
		{ name: 'page_load', payload: { url: '/bathroom-renovations' } },
		{ name: 'form_submit', payload: { url: '/bathroom-renovations' } }, // +20
		{ name: 'scroll_25', payload: {} }                              // +3, no subject
	]);

	const t = await threadOf(f);
	const scores = (t?.subtopicScores ?? {});
	const subs = Array.isArray(t?.subtopics) ? t.subtopics : [];

	check('kitchen and bathroom are scored separately', scores.kitchen > 0 && scores.bathroom > 0,
		`subtopicScores = ${JSON.stringify(scores)}`);
	// kitchen = scroll_50(5) + dwell_60(7) + svc_click(8) = 20; bathroom = form_submit(20) = 20.
	// They tie, which is correct — the assertion is that each subtopic gets exactly its own deltas.
	check('each subtopic carries exactly its own deltas', scores.kitchen === 20 && scores.bathroom === 20,
		`kitchen=${scores.kitchen} (expected 20) bathroom=${scores.bathroom} (expected 20)`);
	check('a signal with no identifiable subject is recorded separately as unknown',
		typeof scores.unknown === 'number', `subtopicScores = ${JSON.stringify(scores)}`);
	check('the subject list matches the scored keys and excludes unknown',
		subs.sort().join(',') === Object.keys(scores).filter((k) => k !== 'unknown').sort().join(','),
		`subtopics=${JSON.stringify(subs)} scoreKeys=${JSON.stringify(Object.keys(scores))}`);
	check('the engagement total is the sum, capped at 100',
		t?.engagementScore === Math.min(100, Object.values(scores).reduce((a, b) => a + b, 0)),
		`engagementScore=${t?.engagementScore} sum=${Object.values(scores).reduce((a, b) => a + b, 0)}`);

	// The interaction itself carries its subject.
	const evs = await prisma.pipelineEvent.findMany({
		where: { companyId: COMPANY, unstructuredText: { contains: f } },
		select: { eventType: true, subtopic: true }
	});
	const kitchenEvents = evs.filter((e) => e.subtopic === 'kitchen').length;
	const bathroomEvents = evs.filter((e) => e.subtopic === 'bathroom').length;
	check('interactions carry their own subtopic', kitchenEvents > 0 && bathroomEvents > 0,
		`kitchen=${kitchenEvents} bathroom=${bathroomEvents} of ${evs.length} events`);
	return f;
}

// ── §3 Bug A — source-aware intent status ───────────────────────────────────
async function intentStatus() {
	console.log('\n§3  Bug A — organic must not be ad_indicated');

	const organic = fp();
	await send(organic, [{ name: 'page_load', payload: { url: '/furnace-repair' } }, 'scroll_25'], {
		attribution: { channel: 'organic_google', landingUrl: '/furnace-repair' }
	});
	const oRows = await threadsFor(organic);
	const oStatus = oRows.at(-1)?.metadata?.intentStatus;
	check('organic browsing is NOT ad_indicated', oStatus !== 'ad_indicated', `intentStatus = ${oStatus}`);
	check('organic browsing is behaviour_inferred', oStatus === 'behaviour_inferred', `intentStatus = ${oStatus}`);

	const paid = fp();
	await send(paid, [{ name: 'page_load', payload: { url: '/furnace-repair' } }], {
		attribution: { channel: 'google_paid', keyword: 'furnace replacement cost', landingUrl: '/furnace-repair' }
	});
	const pRows = await threadsFor(paid);
	const pStatus = pRows.at(-1)?.metadata?.intentStatus;
	check('a real paid ad with no message IS ad_indicated', pStatus === 'ad_indicated', `intentStatus = ${pStatus}`);

	const declared = fp();
	await send(declared, [{ name: 'form_submit', payload: { url: '/contact' } }], {
		name: 'Test Person', phone: '+17055550' + String(Date.now()).slice(-3),
		attribution: { channel: 'google_paid', keyword: 'x' }
	});
	const dRows = await threadsFor(declared);
	const dStatus = dRows.at(-1)?.metadata?.intentStatus;
	check('a declared identity outranks the ad hypothesis', dStatus === 'declared', `intentStatus = ${dStatus}`);
}

async function main() {
	console.log(`Verifying against ${BASE} — company ${COMPANY}`);
	try {
		const f1 = await engagementIsAnEpisode();
		const f2 = await subtopicScoring();
		await intentStatus();
		console.log('\n─────────────────────────────────────────────');
		console.log(`  ${pass} passed, ${fail} failed`);
		console.log('\nNow look at these in the browser:');
		console.log(`  ${BASE}/communication-log      — columns, stacked Channel/Source, ENG over SES, Journey shapes`);
		console.log('  and the same rows on a profile page — they must render identically');
		console.log(`\nFixtures used (search the log for these): ${f1}, ${f2}`);
	} catch (err) {
		console.error('\nAborted:', err.message);
		fail++;
	} finally {
		await prisma.$disconnect();
		process.exit(fail ? 1 : 0);
	}
}

main();
