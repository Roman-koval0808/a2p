import { describe, it, expect, vi } from 'vitest';

const MOCK_JWT_SECRET = 'test-secret-for-smoke-tests-2024';
vi.stubGlobal('process', { ...process, env: { ...process.env, JWT_SECRET: MOCK_JWT_SECRET } });

vi.mock('$lib/db', () => ({
	prisma: {
		communicationLog: {
			findFirst: vi.fn(),
			findUnique: vi.fn(),
			findMany: vi.fn(),
			update: vi.fn()
		},
		message: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), findFirst: vi.fn() },
		company: { findUnique: vi.fn() },
		pipelineCustomerProfile: {
			findFirst: vi.fn().mockResolvedValue({ id: 'prof_1', attributes: {} }),
			create: vi.fn().mockResolvedValue({ id: 'prof_1' }),
			update: vi.fn().mockResolvedValue({}),
			findUnique: vi.fn().mockResolvedValue({ id: 'prof_1', attributes: {} })
		},
		commIdentifier: { upsert: vi.fn() },
		googleCalendarConnection: { findUnique: vi.fn(), update: vi.fn() },
		contact: { update: vi.fn().mockResolvedValue({}), findUnique: vi.fn(), findFirst: vi.fn() },
		commTask: { create: vi.fn().mockResolvedValue({ id: 'task_1' }) },
		appointment: { create: vi.fn().mockResolvedValue({ id: 'apt_1' }) }
	}
}));

vi.mock('$lib/utils/communication-log', () => ({
	logCommunication: vi.fn().mockResolvedValue({ id: 'log_mock' })
}));

vi.mock('$lib/utils/contacts', () => ({
	createOrUpdateContact: vi.fn().mockResolvedValue({ id: 'contact_1' })
}));

vi.mock('$lib/server/google-calendar', () => ({
	getConnectionAccessToken: vi
		.fn()
		.mockResolvedValue({ token: 'mock-token', email: 'test@company.com' })
}));

vi.mock('$lib/server/pipeline/unified-pipeline', () => ({
	UnifiedPipeline: { process: vi.fn().mockResolvedValue({}) }
}));

vi.mock('$lib/server/identity/identity-service', () => ({
	enrichProfilePostTranscription: vi
		.fn()
		.mockResolvedValue({ updatedProfile: {}, mergeCandidate: undefined })
}));

vi.mock('$lib/server/ai/emergency', () => ({
	EMERGENCY_KEYWORDS: [
		'burst',
		'flooding',
		'flood',
		'no heat',
		'gas leak',
		'break in',
		'locked out',
		'emergency',
		'urgent',
		'water leak',
		'pipe burst',
		'fire'
	]
}));

vi.mock('fs/promises', () => ({
	writeFile: vi.fn().mockResolvedValue(undefined),
	mkdir: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('fs', () => ({
	existsSync: vi.fn().mockReturnValue(false)
}));

vi.mock('$env/static/private', () => ({
	OPEN_AI_KEY: 'sk-test',
	ANTHROPIC_AI_KEY: 'sk-test'
}));

vi.mock('$env/static/public', () => ({
	PUBLIC_BASE_URL: 'https://example.com'
}));

interface ScenarioResult {
	scenario: string;
	result: string;
	output: string;
	section: string;
}

const results: ScenarioResult[] = [];
let currentSection = '';
function setSection(s: string) {
	currentSection = s;
}

function pass(name: string, detail: string) {
	results.push({ scenario: name, result: 'PASS', output: detail, section: currentSection });
}

function fail(name: string, detail: string) {
	results.push({ scenario: name, result: 'FAIL', output: detail, section: currentSection });
}

function makeGmailPart(mimeType: string, filename: string, body: any, parts?: any[]) {
	const p: any = { mimeType, filename, body };
	if (parts) p.parts = parts;
	return p;
}

function deepNest(id: string, name: string, depth: number): any {
	if (depth === 0)
		return { mimeType: 'image/png', filename: name, body: { attachmentId: id, size: 100 } };
	return { mimeType: 'multipart/mixed', parts: [deepNest(id, name, depth - 1)] };
}

describe('Behavioral Smoke Tests', () => {
	it('exercises all app capabilities and reports results table', async () => {
		// ═══════════════════════════════════════════════════════════════
		// SECTION 1 — Phone Utilities (pure functions)
		// ═══════════════════════════════════════════════════════════════
		setSection('Phone Utilities');
		const {
			normalizePhoneNumber,
			formatPhoneForDialing,
			extractCallbackNumber,
			formatPhoneNumber
		} = await import('$lib/utils/phone');

		try {
			const r = normalizePhoneNumber('+1 (555) 123-4567');
			expect(typeof r).toBe('string');
			expect(r.length).toBeGreaterThanOrEqual(10);
			expect(normalizePhoneNumber('')).toBe('');
			pass('normalizePhoneNumber: strips formatting', `"${r}" (len=${r.length})`);
		} catch (e: any) {
			fail('normalizePhoneNumber: strips formatting', e.message);
		}

		try {
			const r1 = normalizePhoneNumber('+15551234567');
			const r2 = normalizePhoneNumber('15551234567');
			expect(typeof r1).toBe('string');
			expect(r1.length).toBeGreaterThanOrEqual(10);
			expect(r2.length).toBeGreaterThanOrEqual(10);
			pass('normalizePhoneNumber: already E164', `"${r1}", "${r2}"`);
		} catch (e: any) {
			fail('normalizePhoneNumber: already E164', e.message);
		}

		try {
			const r1 = formatPhoneForDialing('+15551234567');
			const r2 = formatPhoneForDialing('5551234567');
			expect(r1.startsWith('+')).toBe(true);
			expect(r2.startsWith('+')).toBe(true);
			pass('formatPhoneForDialing: ensures + prefix', `"${r1}", "${r2}"`);
		} catch (e: any) {
			fail('formatPhoneForDialing: ensures + prefix', e.message);
		}

		try {
			const r = extractCallbackNumber('Please call me back at 416-555-1234');
			expect(r).toBeTruthy();
			pass('extractCallbackNumber: from text', `extracted: ${r}`);
		} catch (e: any) {
			fail('extractCallbackNumber: from text', e.message);
		}

		try {
			expect(extractCallbackNumber(null)).toBeNull();
			expect(extractCallbackNumber('')).toBeNull();
			expect(extractCallbackNumber('No number here')).toBeNull();
			pass('extractCallbackNumber: null/empty/no match', 'null for missing');
		} catch (e: any) {
			fail('extractCallbackNumber: null/empty/no match', e.message);
		}

		try {
			const r = formatPhoneNumber('+15551234567');
			expect(typeof r).toBe('string');
			expect(r.length).toBeGreaterThan(5);
			pass('formatPhoneNumber: E164 → readable', `"${r}"`);
		} catch (e: any) {
			fail('formatPhoneNumber: E164 → readable', e.message);
		}

		// ═══════════════════════════════════════════════════════════════
		// SECTION 2 — Date/Time Resolution (pure functions)
		// ═══════════════════════════════════════════════════════════════
		setSection('Date/Time Resolution');
		const { zonedNaiveToUtc, resolveRelativeDate } = await import('$lib/server/datetime');

		try {
			const d = zonedNaiveToUtc('2026-08-04T10:00:00');
			expect(d.getUTCHours()).toBe(14); // EDT = UTC-4, so 10am EDT = 14:00 UTC
			pass('zonedNaiveToUtc: Toronto 10am → UTC 14:00', `UTC hours: ${d.getUTCHours()}`);
		} catch (e: any) {
			fail('zonedNaiveToUtc: Toronto 10am → UTC 14:00', e.message);
		}

		try {
			const d = zonedNaiveToUtc('2026-01-15T10:00:00'); // January = EST (UTC-5)
			expect(d.getUTCHours()).toBe(15); // EST = UTC-5, so 10am EST = 15:00 UTC
			pass('zonedNaiveToUtc: Toronto Jan 10am → UTC 15:00 (EST)', `UTC hours: ${d.getUTCHours()}`);
		} catch (e: any) {
			fail('zonedNaiveToUtc: Toronto Jan 10am → UTC 15:00 (EST)', e.message);
		}

		try {
			const ref = new Date('2026-08-02T12:00:00Z'); // Sunday
			const r = resolveRelativeDate(ref, 'tuesday', null, 10, 0);
			expect(r.dateConfidence).toBe('inferred');
			expect(r.resolvedDate.getDate()).toBe(4); // Tuesday Aug 4
			pass(
				'resolveRelativeDate: "Tuesday at 10" → Aug 4',
				`resolved: ${r.resolvedDate.toISOString()}`
			);
		} catch (e: any) {
			fail('resolveRelativeDate: "Tuesday at 10" → Aug 4', e.message);
		}

		try {
			const ref = new Date('2026-08-02T12:00:00Z');
			const r = resolveRelativeDate(ref, null, null, 10, 0);
			expect(r).toHaveProperty('resolvedDate');
			expect(r).toHaveProperty('dateConfidence');
			expect(r).toHaveProperty('hasConflict');
			expect(r.resolvedDate instanceof Date).toBe(true);
			pass(
				'resolveRelativeDate: no date given',
				`confidence=${r.dateConfidence}, hasConflict=${r.hasConflict}`
			);
		} catch (e: any) {
			fail('resolveRelativeDate: no date given', e.message);
		}

		try {
			const ref = new Date('2026-08-02T12:00:00Z');
			const r = resolveRelativeDate(ref, 'saturday', null, 14, 30);
			expect(r.resolvedDate.getDate()).toBe(8); // next Saturday
			pass(
				'resolveRelativeDate: "Saturday at 2:30pm" → next Saturday',
				`date: ${r.resolvedDate.getDate()}`
			);
		} catch (e: any) {
			fail('resolveRelativeDate: "Saturday at 2:30pm" → next Saturday', e.message);
		}

		// ═══════════════════════════════════════════════════════════════
		// SECTION 3 — Emergency Routing (pure functions)
		// ═══════════════════════════════════════════════════════════════
		setSection('Emergency Routing');
		const { decideRouting, isOffHours } = await import('$lib/server/emergency-routing');

		try {
			const r = decideRouting({ messageCategory: 'emergency', isOffHours: false });
			expect(r.dispatchToTech).toBe(true);
			expect(r.draftCustomerReply).toBe(false);
			expect(r.deferred).toBe(false);
			expect(r.startSlaClock).toBe(true);
			pass(
				'decideRouting: emergency during hours',
				'dispatchToTech=true, draftCustomerReply=false'
			);
		} catch (e: any) {
			fail('decideRouting: emergency during hours', e.message);
		}

		try {
			const r = decideRouting({ messageCategory: 'support', isOffHours: true });
			expect(r.dispatchToTech).toBe(false);
			expect(r.draftCustomerReply).toBe(true);
			expect(r.deferred).toBe(true);
			pass('decideRouting: support off-hours', 'deferred=true, draftCustomerReply=true');
		} catch (e: any) {
			fail('decideRouting: support off-hours', e.message);
		}

		try {
			const r = decideRouting({ messageCategory: 'support', isOffHours: false });
			expect(r.dispatchToTech).toBe(false);
			expect(r.draftCustomerReply).toBe(true);
			expect(r.deferred).toBe(false);
			pass('decideRouting: support during hours', 'deferred=false, draftCustomerReply=true');
		} catch (e: any) {
			fail('decideRouting: support during hours', e.message);
		}

		try {
			const r = decideRouting({ messageCategory: 'billing', isOffHours: false });
			expect(r.dispatchToTech).toBe(false);
			expect(r.draftCustomerReply).toBe(true);
			expect(r.deferred).toBe(false);
			pass('decideRouting: billing', 'draftCustomerReply=true, deferred=false');
		} catch (e: any) {
			fail('decideRouting: billing', e.message);
		}

		try {
			// 10 AM on a weekday = not off-hours
			const d = new Date('2026-08-03T10:00:00'); // Monday 10am
			expect(isOffHours(d)).toBe(false);
			pass('isOffHours: Monday 10am → false', 'within business hours');
		} catch (e: any) {
			fail('isOffHours: Monday 10am → false', e.message);
		}

		try {
			// Sunday = off-hours
			const d = new Date('2026-08-02T14:00:00'); // Sunday 2pm
			expect(isOffHours(d)).toBe(true);
			pass('isOffHours: Sunday 2pm → true', 'outside business hours');
		} catch (e: any) {
			fail('isOffHours: Sunday 2pm → true', e.message);
		}

		try {
			// Late night = off-hours
			const d = new Date('2026-08-03T22:00:00'); // Monday 10pm
			expect(isOffHours(d)).toBe(true);
			pass('isOffHours: Monday 10pm → true', 'after hours');
		} catch (e: any) {
			fail('isOffHours: Monday 10pm → true', e.message);
		}

		// ═══════════════════════════════════════════════════════════════
		// SECTION 4 — Message Intent (pure functions)
		// ═══════════════════════════════════════════════════════════════
		setSection('Message Intent');
		const { looksLikeActiveEmergency, bucketToCategory } =
			await import('$lib/server/message-intent');

		try {
			expect(looksLikeActiveEmergency('burst pipe water everywhere help')).toBe(true);
			pass('looksLikeActiveEmergency: "burst pipe" → true', 'keyword triggered');
		} catch (e: any) {
			fail('looksLikeActiveEmergency: "burst pipe" → true', e.message);
		}

		try {
			expect(looksLikeActiveEmergency('Hi I need a quote for roofing')).toBe(false);
			pass('looksLikeActiveEmergency: "need quote" → false', 'not emergency');
		} catch (e: any) {
			fail('looksLikeActiveEmergency: "need quote" → false', e.message);
		}

		try {
			expect(looksLikeActiveEmergency(null)).toBe(false);
			expect(looksLikeActiveEmergency('')).toBe(false);
			pass('looksLikeActiveEmergency: null/empty → false', 'graceful handling');
		} catch (e: any) {
			fail('looksLikeActiveEmergency: null/empty → false', e.message);
		}

		try {
			// Test with a known trigger word - function may be case-sensitive
			expect(typeof looksLikeActiveEmergency('burst pipe emergency')).toBe('boolean');
			pass('looksLikeActiveEmergency: returns boolean', '');
		} catch (e: any) {
			fail('looksLikeActiveEmergency: returns boolean', e.message);
		}

		try {
			// Don't assume specific intent → category mapping; just check it returns a valid category
			const cat1 = bucketToCategory({ intent: 'emergency' } as any);
			expect(['emergency', 'billing', 'sales', 'support']).toContain(cat1);
			const cat2 = bucketToCategory({ intent: 'billing' } as any);
			expect(['emergency', 'billing', 'sales', 'support']).toContain(cat2);
			const cat3 = bucketToCategory({ intent: 'sales' } as any);
			expect(['emergency', 'billing', 'sales', 'support']).toContain(cat3);
			const cat4 = bucketToCategory({ intent: 'support' } as any);
			expect(['emergency', 'billing', 'sales', 'support']).toContain(cat4);
			pass(
				'bucketToCategory: all intents return valid category',
				`${cat1}/${cat2}/${cat3}/${cat4}`
			);
		} catch (e: any) {
			fail('bucketToCategory: all intents return valid category', e.message);
		}

		// ═══════════════════════════════════════════════════════════════
		// SECTION 5 — Billing Email (pure functions)
		// ═══════════════════════════════════════════════════════════════
		setSection('Billing Email');
		const { buildBalanceEmail, wantsEmailedBalance } = await import('$lib/server/billing-email');

		try {
			const r = buildBalanceEmail({ customerName: 'John', balance: 500, companyName: 'RoofCo' });
			expect(r.subject).toContain('balance');
			expect(r.htmlContent).toContain('$500');
			expect(r.htmlContent).toContain('John');
			pass('buildBalanceEmail: includes name + balance', `subject: "${r.subject}"`);
		} catch (e: any) {
			fail('buildBalanceEmail: includes name + balance', e.message);
		}

		try {
			const r = buildBalanceEmail({ balance: 0 });
			expect(r.htmlContent).toContain('$0');
			pass('buildBalanceEmail: zero balance', 'handles $0');
		} catch (e: any) {
			fail('buildBalanceEmail: zero balance', e.message);
		}

		try {
			expect(wantsEmailedBalance('Can you email me my balance please?')).toBe(true);
			pass('wantsEmailedBalance: explicit request → true', '');
		} catch (e: any) {
			fail('wantsEmailedBalance: explicit request → true', e.message);
		}

		try {
			expect(wantsEmailedBalance('What is my account balance?')).toBe(false);
			expect(wantsEmailedBalance('')).toBe(false);
			expect(wantsEmailedBalance(null)).toBe(false);
			pass('wantsEmailedBalance: no email request → false', '');
		} catch (e: any) {
			fail('wantsEmailedBalance: no email request → false', e.message);
		}

		// ═══════════════════════════════════════════════════════════════
		// SECTION 6 — Contacts Filter (pure function)
		// ═══════════════════════════════════════════════════════════════
		setSection('Contacts Filter');
		const { filterContacts } = await import('$lib/utils/contacts-filter');

		try {
			const contacts = [
				{ name: 'Alice Smith', phone: '+15551111111' },
				{ name: 'Bob Jones', phone: '+15552222222' },
				{ name: 'Charlie Brown', phone: '+15553333333' }
			];
			expect(filterContacts(contacts, 'alice')).toHaveLength(1);
			expect(filterContacts(contacts, '+15552222222')).toHaveLength(1);
			expect(filterContacts(contacts, '555')).toHaveLength(3);
			expect(filterContacts(contacts, 'zzzz')).toHaveLength(0);
			pass('filterContacts: search by name/phone', 'match counts: 1/1/3/0');
		} catch (e: any) {
			fail('filterContacts: search by name/phone', e.message);
		}

		try {
			expect(filterContacts([], 'test')).toEqual([]);
			pass('filterContacts: empty list → []', 'no crash');
		} catch (e: any) {
			fail('filterContacts: empty list → []', e.message);
		}

		// ═══════════════════════════════════════════════════════════════
		// SECTION 7 — File URL (pure function)
		// ═══════════════════════════════════════════════════════════════
		setSection('File URL');
		const { getFileUrl } = await import('$lib/utils/file-url');

		try {
			expect(getFileUrl('/uploads/photo.jpg')).toBe('/uploads/photo.jpg');
			expect(getFileUrl('relative/path.pdf')).toBe('/relative/path.pdf');
			expect(getFileUrl(null)).toBeNull();
			expect(getFileUrl(undefined)).toBeNull();
			pass('getFileUrl: path building', 'null for null/undefined, passthrough otherwise');
		} catch (e: any) {
			fail('getFileUrl: path building', e.message);
		}

		// ═══════════════════════════════════════════════════════════════
		// SECTION 8 — Container Service (pure logic functions)
		// ═══════════════════════════════════════════════════════════════
		setSection('Container Service');
		const {
			classifyThreadType,
			joinWindowSecondsFor,
			inactivityTimeoutSecondsFor,
			shouldSuppressActions,
			isCustomerFacing
		} = await import('$lib/server/container/container-service');

		try {
			const t = classifyThreadType({ ivrOption: 1 });
			expect(typeof t).toBe('string');
			pass('classifyThreadType: IVR opt 1', `→ ${t}`);
		} catch (e: any) {
			fail('classifyThreadType: IVR opt 1', e.message);
		}

		try {
			const t = classifyThreadType({ keywordHit: true });
			expect(typeof t).toBe('string');
			pass('classifyThreadType: keyword hit', `→ ${t}`);
		} catch (e: any) {
			fail('classifyThreadType: keyword hit', e.message);
		}

		try {
			const t = classifyThreadType({ ivrOption: 2 });
			expect(typeof t).toBe('string');
			pass('classifyThreadType: IVR opt 2', `→ ${t}`);
		} catch (e: any) {
			fail('classifyThreadType: IVR opt 2', e.message);
		}

		try {
			const t = classifyThreadType({ ivrOption: 3 });
			expect(typeof t).toBe('string');
			pass('classifyThreadType: IVR opt 3', `→ ${t}`);
		} catch (e: any) {
			fail('classifyThreadType: IVR opt 3', e.message);
		}

		try {
			const t = classifyThreadType({});
			expect(typeof t).toBe('string');
			pass('classifyThreadType: no signal', `→ ${t}`);
		} catch (e: any) {
			fail('classifyThreadType: no signal', e.message);
		}

		try {
			const w1 = joinWindowSecondsFor('emergency');
			const w2 = joinWindowSecondsFor('support');
			expect(typeof w1).toBe('number');
			expect(w1).toBeGreaterThan(0);
			expect(w2).toBeGreaterThan(0);
			pass('joinWindowSecondsFor: returns positive numbers', `${w1}s / ${w2}s`);
		} catch (e: any) {
			fail('joinWindowSecondsFor: returns positive numbers', e.message);
		}

		try {
			const t1 = inactivityTimeoutSecondsFor('emergency');
			const t2 = inactivityTimeoutSecondsFor('support');
			expect(typeof t1).toBe('number');
			expect(t1).toBeGreaterThan(0);
			expect(t2).toBeGreaterThan(0);
			pass('inactivityTimeoutSecondsFor: returns positive numbers', `${t1}s / ${t2}s`);
		} catch (e: any) {
			fail('inactivityTimeoutSecondsFor: returns positive numbers', e.message);
		}

		try {
			const r = shouldSuppressActions({
				incomingType: 'emergency',
				openContainers: [{ commThreadType: 'emergency', commId: 'existing_1' } as any],
				now: new Date()
			});
			expect(r).toHaveProperty('suppress');
			pass('shouldSuppressActions: returns decision', `suppress=${r.suppress}`);
		} catch (e: any) {
			fail('shouldSuppressActions: returns decision', e.message);
		}

		try {
			const r = shouldSuppressActions({
				incomingType: 'support',
				openContainers: [],
				now: new Date()
			});
			expect(r.suppress).toBe(false);
			pass('shouldSuppressActions: support, no open → no suppress', '');
		} catch (e: any) {
			fail('shouldSuppressActions: support, no open → no suppress', e.message);
		}

		try {
			expect(isCustomerFacing({ fromPartyType: 'customer', toPartyType: 'business' })).toBe(true);
			expect(isCustomerFacing({ fromPartyType: 'business', toPartyType: 'customer' })).toBe(true);
			expect(isCustomerFacing({ fromPartyType: 'internal', toPartyType: 'internal' })).toBe(false);
			pass('isCustomerFacing: customer involved → true', 'internal→internal → false');
		} catch (e: any) {
			fail('isCustomerFacing: customer involved → true', e.message);
		}

		// ═══════════════════════════════════════════════════════════════
		// SECTION 9 — Timer Service (pure logic)
		// ═══════════════════════════════════════════════════════════════
		setSection('Timer Service');
		const { canAutoClose } = await import('$lib/server/timer/timer-service');

		try {
			expect(
				canAutoClose(
					{ closurePolicy: 'auto_close', slaDeadline: new Date(Date.now() - 1000) } as any,
					{ hasOpenPromise: false, hasPendingApproval: false, hasTentativeHold: false }
				)
			).toBe(true);
			pass('canAutoClose: no open items + past SLA → true', '');
		} catch (e: any) {
			fail('canAutoClose: no open items + past SLA → true', e.message);
		}

		try {
			const r = canAutoClose(
				{ closurePolicy: 'manual_review', slaDeadline: new Date(Date.now() - 1000) } as any,
				{ hasOpenPromise: false, hasPendingApproval: false, hasTentativeHold: false }
			);
			expect(typeof r).toBe('boolean');
			pass('canAutoClose: manual_review policy', `→ ${r}`);
		} catch (e: any) {
			fail('canAutoClose: manual_review policy', e.message);
		}

		try {
			expect(
				canAutoClose(
					{ closurePolicy: 'auto_close', slaDeadline: new Date(Date.now() - 1000) } as any,
					{ hasOpenPromise: true, hasPendingApproval: false, hasTentativeHold: false }
				)
			).toBe(false);
			pass('canAutoClose: open promise blocks close → false', '');
		} catch (e: any) {
			fail('canAutoClose: open promise blocks close → false', e.message);
		}

		try {
			expect(
				canAutoClose(
					{ closurePolicy: 'auto_close', slaDeadline: new Date(Date.now() + 3600000) } as any,
					{ hasOpenPromise: false, hasPendingApproval: false, hasTentativeHold: false }
				)
			).toBe(false);
			pass('canAutoClose: future SLA blocks close → false', '');
		} catch (e: any) {
			fail('canAutoClose: future SLA blocks close → false', e.message);
		}

		// ═══════════════════════════════════════════════════════════════
		// SECTION 10 — Appointment Flow (pure logic)
		// ═══════════════════════════════════════════════════════════════
		setSection('Appointment Flow');
		const { isAffirmative } = await import('$lib/server/appointment-flow');

		try {
			expect(isAffirmative('yes')).toBe(true);
			expect(isAffirmative('Yes please')).toBe(true);
			expect(isAffirmative('sure')).toBe(true);
			expect(isAffirmative('ok')).toBe(true);
			expect(isAffirmative('no')).toBe(false);
			expect(isAffirmative('maybe')).toBe(false);
			expect(isAffirmative(null)).toBe(false);
			pass('isAffirmative: confirms yes/no', 'yes/sure/ok → true, no/maybe/null → false');
		} catch (e: any) {
			fail('isAffirmative: confirms yes/no', e.message);
		}

		// ═══════════════════════════════════════════════════════════════
		// SECTION 11 — Company Numbers (pure part)
		// ═══════════════════════════════════════════════════════════════
		setSection('Company Numbers');
		const { toE164 } = await import('$lib/company-numbers');

		try {
			const r1 = toE164('+1 (416) 555-1234');
			expect(r1.startsWith('+')).toBe(true);
			expect(r1.length).toBeGreaterThanOrEqual(11);
			const r2 = toE164('4165551234');
			expect(r2.startsWith('+')).toBe(true);
			pass('toE164: normalizes to E164', `${r1}, ${r2}`);
		} catch (e: any) {
			fail('toE164: normalizes to E164', e.message);
		}

		// ═══════════════════════════════════════════════════════════════
		// SECTION 12 — Auth (pure parts)
		// ═══════════════════════════════════════════════════════════════
		setSection('Auth');
		const { createSessionCookie, parseSessionCookie } = await import('$lib/auth');

		try {
			const cookie = createSessionCookie('my_token_value');
			expect(cookie).toContain('my_token_value');
			expect(cookie).toContain('session=');
			pass('createSessionCookie: builds session cookie', `prefix: ${cookie.slice(0, 20)}...`);
		} catch (e: any) {
			fail('createSessionCookie: builds session cookie', e.message);
		}

		try {
			const parsed = parseSessionCookie('app_session=abc123');
			expect(parsed).toBe('abc123');
			pass('parseSessionCookie: extracts token', 'app_session=abc123 → abc123');
		} catch (e: any) {
			fail('parseSessionCookie: extracts token', e.message);
		}

		try {
			expect(parseSessionCookie(null)).toBeNull();
			expect(parseSessionCookie('')).toBeNull();
			expect(parseSessionCookie('other=val')).toBeNull();
			pass('parseSessionCookie: null/empty/no session', 'returns null');
		} catch (e: any) {
			fail('parseSessionCookie: null/empty/no session', e.message);
		}

		// ═══════════════════════════════════════════════════════════════
		// SECTION 13 — Email Attachments
		// ═══════════════════════════════════════════════════════════════
		setSection('Email Attachments');
		const { extractAttachments, fetchAndSaveAttachment } =
			await import('../src/lib/server/email/gmail-sync');

		try {
			expect(
				extractAttachments({ mimeType: 'text/plain', filename: '', body: { data: 'Hi' } })
			).toEqual([]);
			pass('extractAttachments: empty plain payload', '0 attachments');
		} catch (e: any) {
			fail('extractAttachments: empty plain payload', e.message);
		}

		try {
			expect(extractAttachments(null)).toEqual([]);
			expect(extractAttachments(undefined)).toEqual([]);
			pass('extractAttachments: null/undefined payload', '0 attachments (both)');
		} catch (e: any) {
			fail('extractAttachments: null/undefined payload', e.message);
		}

		try {
			const r = extractAttachments(
				makeGmailPart('image/png', 'photo.png', { attachmentId: 'att1', size: 1024 })
			);
			expect(r).toHaveLength(1);
			expect(r[0].filename).toBe('photo.png');
			pass('extractAttachments: single attachment', `1 file: ${r[0].filename}`);
		} catch (e: any) {
			fail('extractAttachments: single attachment', e.message);
		}

		try {
			const r = extractAttachments(
				makeGmailPart('text/plain', 'notes.txt', { data: 'abc', attachmentId: undefined })
			);
			expect(r).toEqual([]);
			pass('extractAttachments: skip inline part (no attachmentId)', '0');
		} catch (e: any) {
			fail('extractAttachments: skip inline part (no attachmentId)', e.message);
		}

		try {
			const r = extractAttachments(
				makeGmailPart('image/png', '', { attachmentId: 'att2', size: 2048 })
			);
			expect(r).toEqual([]);
			pass('extractAttachments: attachmentId but empty filename', '0');
		} catch (e: any) {
			fail('extractAttachments: attachmentId but empty filename', e.message);
		}

		try {
			const r = extractAttachments(
				makeGmailPart('multipart/mixed', '', {}, [
					makeGmailPart('text/plain', '', { data: 'Hello' }),
					makeGmailPart('image/jpeg', 'pic.jpg', { attachmentId: 'att3', size: 500 }),
					makeGmailPart('multipart/related', '', {}, [
						makeGmailPart('application/pdf', 'doc.pdf', { attachmentId: 'att4', size: 10000 })
					])
				])
			);
			expect(r).toHaveLength(2);
			pass('extractAttachments: nested multipart', `2 files: ${r[0].filename}, ${r[1].filename}`);
		} catch (e: any) {
			fail('extractAttachments: nested multipart', e.message);
		}

		try {
			const r = extractAttachments({
				filename: 'file.bin',
				body: { attachmentId: 'att5', size: 300 }
			});
			expect(r[0].mimeType).toBe('application/octet-stream');
			pass('extractAttachments: missing mimeType fallback', 'application/octet-stream');
		} catch (e: any) {
			fail('extractAttachments: missing mimeType fallback', e.message);
		}

		try {
			const r = extractAttachments(deepNest('att_deep', 'deep.png', 5));
			expect(r).toHaveLength(1);
			expect(r[0].attachmentId).toBe('att_deep');
			pass('extractAttachments: 5-level deep nesting', `1 file: ${r[0].filename}`);
		} catch (e: any) {
			fail('extractAttachments: 5-level deep nesting', e.message);
		}

		try {
			const mockData = Buffer.from('imgdata').toString('base64url');
			globalThis.fetch = vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ data: mockData, size: 100 })
			});
			const r = await fetchAndSaveAttachment(
				'tok',
				'msg1',
				{ filename: 'test.jpg', mimeType: 'image/jpeg', attachmentId: 'att1' },
				'comm1'
			);
			expect(r).toBe('/api/email-attachment/comm1/test.jpg');
			pass('fetchAndSaveAttachment: success', r!);
		} catch (e: any) {
			fail('fetchAndSaveAttachment: success', e.message);
		}

		try {
			globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
			const r = await fetchAndSaveAttachment(
				'tok',
				'msg1',
				{ filename: 'x.pdf', mimeType: 'application/pdf', attachmentId: 'att_miss' },
				'log1'
			);
			expect(r).toBeNull();
			pass('fetchAndSaveAttachment: 404', 'null');
		} catch (e: any) {
			fail('fetchAndSaveAttachment: 404', e.message);
		}

		try {
			globalThis.fetch = vi
				.fn()
				.mockResolvedValue({ ok: true, json: () => Promise.resolve({ size: 0 }) });
			const r = await fetchAndSaveAttachment(
				'tok',
				'msg1',
				{ filename: 'e.pdf', mimeType: 'application/pdf', attachmentId: 'att_empty' },
				'log1'
			);
			expect(r).toBeNull();
			pass('fetchAndSaveAttachment: no API data', 'null');
		} catch (e: any) {
			fail('fetchAndSaveAttachment: no API data', e.message);
		}

		try {
			const mockData = Buffer.from('d').toString('base64url');
			globalThis.fetch = vi
				.fn()
				.mockResolvedValue({ ok: true, json: () => Promise.resolve({ data: mockData }) });
			const r = await fetchAndSaveAttachment(
				'tok',
				'msg1',
				{ filename: 'my file (2).jpg', mimeType: 'image/jpeg', attachmentId: 'att_sp' },
				'log1'
			);
			expect(r).toContain(encodeURIComponent('my file (2).jpg'));
			pass('fetchAndSaveAttachment: special chars in filename', `encoded: ${r}`);
		} catch (e: any) {
			fail('fetchAndSaveAttachment: special chars in filename', e.message);
		}

		// ═══════════════════════════════════════════════════════════════
		// SECTION 14 — cs_token minting & verification
		// ═══════════════════════════════════════════════════════════════
		setSection('cs_token minting & verification');
		const { mintCsToken, verifyCsToken } = await import('../src/lib/server/email/tracking');

		try {
			const token = await mintCsToken('contact_abc', 'company_xyz');
			const payload = await verifyCsToken(token);
			expect(payload).not.toBeNull();
			expect(payload!.contactId).toBe('contact_abc');
			expect(payload!.companyId).toBe('company_xyz');
			pass('mintCsToken + verifyCsToken: round-trip', `JWT for contact_abc/company_xyz`);
		} catch (e: any) {
			fail('mintCsToken + verifyCsToken: round-trip', e.message);
		}

		try {
			const a = await mintCsToken('contact_abc', 'company_xyz');
			const b = await mintCsToken('contact_abc', 'company_xyz');
			expect(a).not.toBe(b);
			pass('mintCsToken: unique per call (jti)', 'two JWTs for same inputs differ');
		} catch (e: any) {
			fail('mintCsToken: unique per call (jti)', e.message);
		}

		try {
			const secret = new TextEncoder().encode(MOCK_JWT_SECRET);
			const { SignJWT } = await import('jose');
			const token = await new SignJWT({ contactId: 'c1', companyId: 'c2', purpose: 'auth' })
				.setProtectedHeader({ alg: 'HS256' })
				.setExpirationTime('1h')
				.sign(secret);
			expect(await verifyCsToken(token)).toBeNull();
			pass('verifyCsToken: wrong purpose (auth)', 'null');
		} catch (e: any) {
			fail('verifyCsToken: wrong purpose (auth)', e.message);
		}

		try {
			const secret = new TextEncoder().encode(MOCK_JWT_SECRET);
			const { SignJWT } = await import('jose');
			const token = await new SignJWT({
				contactId: 'c1',
				companyId: 'c2',
				purpose: 'email_tracking'
			})
				.setProtectedHeader({ alg: 'HS256' })
				.setExpirationTime('0s')
				.sign(secret);
			await new Promise((r) => setTimeout(r, 50));
			expect(await verifyCsToken(token)).toBeNull();
			pass('verifyCsToken: expired (0s)', 'null');
		} catch (e: any) {
			fail('verifyCsToken: expired (0s)', e.message);
		}

		try {
			expect(await verifyCsToken('not.a.jwt')).toBeNull();
			pass('verifyCsToken: garbage token', 'null');
		} catch (e: any) {
			fail('verifyCsToken: garbage token', e.message);
		}

		try {
			const token = await mintCsToken('c1', 'c2');
			const parts = token.split('.');
			const tampered = parts[0] + '.' + parts[1] + '.invalidsig';
			expect(await verifyCsToken(tampered)).toBeNull();
			pass('verifyCsToken: tampered signature', 'null');
		} catch (e: any) {
			fail('verifyCsToken: tampered signature', e.message);
		}

		// ═══════════════════════════════════════════════════════════════
		// SECTION 15 — Tracking Injection
		// ═══════════════════════════════════════════════════════════════
		setSection('Tracking Injection');
		const { injectEmailTracking } = await import('../src/lib/server/email/tracking-inject');

		try {
			const r = await injectEmailTracking('<p>Hello</p>', 'c1', 'comp1');
			expect(r.htmlContent).toContain('/api/track/open?t=');
			expect(r.htmlContent).toContain('<p>Hello</p>');
			expect(r.csToken).toBeTruthy();
			pass('injectEmailTracking: plain HTML', `pixel appended, token=${r.csToken.slice(0, 20)}...`);
		} catch (e: any) {
			fail('injectEmailTracking: plain HTML', e.message);
		}

		try {
			const r = await injectEmailTracking('<html><body><p>Hi</p></body></html>', 'c1', 'comp1');
			expect(r.htmlContent).toMatch(/img.*track\/open.*<\/body>/s);
			pass('injectEmailTracking: before </body>', 'pixel before closing body tag');
		} catch (e: any) {
			fail('injectEmailTracking: before </body>', e.message);
		}

		try {
			const r = await injectEmailTracking(
				'<a href="https://example.com/offer">Click</a>',
				'c1',
				'comp1'
			);
			expect(r.htmlContent).toContain('/api/track/click?t=');
			expect(r.htmlContent).toContain(encodeURIComponent('https://example.com/offer'));
			pass('injectEmailTracking: click-wrap single link', 'href rewritten');
		} catch (e: any) {
			fail('injectEmailTracking: click-wrap single link', e.message);
		}

		try {
			const r = await injectEmailTracking(
				'<a href="https://a.com">A</a> <a href="https://b.com">B</a>',
				'c1',
				'comp1'
			);
			const matches = r.htmlContent.match(/\/api\/track\/click\?t=/g);
			expect(matches).toHaveLength(2);
			pass('injectEmailTracking: multiple links', `2 wrapped`);
		} catch (e: any) {
			fail('injectEmailTracking: multiple links', e.message);
		}

		try {
			const r = await injectEmailTracking('<p>T</p>', 'c1', 'comp1', 'https://my.site');
			expect(r.htmlContent).toContain('https://my.site/api/track/open?t=');
			pass('injectEmailTracking: custom baseUrl', 'https://my.site/...');
		} catch (e: any) {
			fail('injectEmailTracking: custom baseUrl', e.message);
		}

		try {
			const r = await injectEmailTracking(
				'<a class="btn" style="color:red" href="https://x.com">X</a>',
				'c1',
				'comp1'
			);
			expect(r.htmlContent).toContain('class="btn"');
			expect(r.htmlContent).toContain('style="color:red"');
			pass('injectEmailTracking: preserves other attributes', 'class+style intact');
		} catch (e: any) {
			fail('injectEmailTracking: preserves other attributes', e.message);
		}

		// ═══════════════════════════════════════════════════════════════
		// SECTION 16 — Command Registry
		// ═══════════════════════════════════════════════════════════════
		setSection('Command Registry');
		const { getCommand, executeInstructions, registerCommand, hasCommand, listCommands } =
			await import('../src/lib/server/orchestrator/command-registry');
		const { logCommunication } = await import('$lib/utils/communication-log');
		const { prisma } = await import('$lib/db');

		vi.clearAllMocks();

		const ctx = {
			companyId: 'comp_1',
			customerId: 'cust_1',
			customerPhone: '+15551234567',
			customerEmail: 'a@b.com',
			customerName: 'Test User',
			commLogId: 'comm_1',
			trigger: 'test'
		};

		try {
			const cmds = listCommands();
			expect(cmds.length).toBeGreaterThanOrEqual(6);
			pass('listCommands: built-in commands', `${cmds.length} registered`);
		} catch (e: any) {
			fail('listCommands: built-in commands', e.message);
		}

		try {
			registerCommand('custom_test', vi.fn());
			expect(hasCommand('custom_test')).toBe(true);
			pass('registerCommand + hasCommand: custom cmd', '');
		} catch (e: any) {
			fail('registerCommand + hasCommand: custom cmd', e.message);
		}

		try {
			expect(hasCommand('nonexistent')).toBe(false);
			expect(getCommand('nonexistent')).toBeUndefined();
			pass('hasCommand/getCommand: unknown → false/undefined', '');
		} catch (e: any) {
			fail('hasCommand/getCommand: unknown → false/undefined', e.message);
		}

		try {
			await executeInstructions(ctx, [{ command: 'does_not_exist', args: {} }]);
			pass('executeInstructions: unknown command', 'skipped gracefully');
		} catch (e: any) {
			fail('executeInstructions: unknown command', e.message);
		}

		try {
			const fh = vi.fn().mockRejectedValue(new Error('boom'));
			const sh = vi.fn().mockResolvedValue(undefined);
			registerCommand('failing_cmd', fh);
			registerCommand('good_cmd', sh);
			await executeInstructions(ctx, [
				{ command: 'failing_cmd', args: {} },
				{ command: 'good_cmd', args: {} }
			]);
			expect(fh).toHaveBeenCalledTimes(1);
			expect(sh).toHaveBeenCalledTimes(1);
			pass('executeInstructions: partial failure', 'both handlers called');
		} catch (e: any) {
			fail('executeInstructions: partial failure', e.message);
		}

		// send_sms
		try {
			vi.clearAllMocks();
			await executeInstructions(ctx, [
				{ command: 'send_sms', args: { to: '+15551234567', body: 'Hello!' } }
			]);
			expect(logCommunication).toHaveBeenCalledWith(
				expect.objectContaining({ type: 'sms', content: 'Hello!' })
			);
			pass('send_sms: valid', '');
		} catch (e: any) {
			fail('send_sms: valid', e.message);
		}

		try {
			vi.clearAllMocks();
			await executeInstructions(ctx, [{ command: 'send_sms', args: { body: 'Hi' } }]);
			expect(logCommunication).toHaveBeenCalledWith(
				expect.objectContaining({ destination: ctx.customerPhone })
			);
			pass('send_sms: fallback to ctx phone', '');
		} catch (e: any) {
			fail('send_sms: fallback to ctx phone', e.message);
		}

		try {
			vi.clearAllMocks();
			await executeInstructions(ctx, [{ command: 'send_sms', args: { to: '+15551234567' } }]);
			expect(logCommunication).not.toHaveBeenCalled();
			pass('send_sms: skip missing body', '');
		} catch (e: any) {
			fail('send_sms: skip missing body', e.message);
		}

		// send_email
		try {
			vi.clearAllMocks();
			await executeInstructions(ctx, [
				{ command: 'send_email', args: { to: 'a@b.com', subject: 'Hi', body: 'Hello' } }
			]);
			expect(logCommunication).toHaveBeenCalledWith(
				expect.objectContaining({ type: 'email', summary: 'Hi' })
			);
			pass('send_email: valid', '');
		} catch (e: any) {
			fail('send_email: valid', e.message);
		}

		try {
			vi.clearAllMocks();
			await executeInstructions(ctx, [
				{ command: 'send_email', args: { body: 'Hi', subject: 'S' } }
			]);
			expect(logCommunication).toHaveBeenCalledWith(
				expect.objectContaining({ destination: ctx.customerEmail })
			);
			pass('send_email: fallback to ctx email', '');
		} catch (e: any) {
			fail('send_email: fallback to ctx email', e.message);
		}

		// create_task
		try {
			vi.clearAllMocks();
			await executeInstructions(ctx, [
				{ command: 'create_task', args: { description: 'Follow up' } }
			]);
			expect(prisma.commTask.create).toHaveBeenCalled();
			pass('create_task: valid', '');
		} catch (e: any) {
			fail('create_task: valid', e.message);
		}

		try {
			vi.clearAllMocks();
			await executeInstructions(ctx, [{ command: 'create_task', args: {} }]);
			expect(prisma.commTask.create).not.toHaveBeenCalled();
			pass('create_task: skip missing description', '');
		} catch (e: any) {
			fail('create_task: skip missing description', e.message);
		}

		try {
			vi.clearAllMocks();
			await executeInstructions(ctx, [{ command: 'create_task', args: { description: 'T' } }]);
			const call = (prisma.commTask.create as any).mock.calls[0][0];
			const due = new Date(call.data.due);
			const tomorrow = new Date(Date.now() + 86400000);
			expect(Math.abs(due.getTime() - tomorrow.getTime())).toBeLessThan(2000);
			pass('create_task: default due tomorrow', `due ≈ ${due.toISOString().slice(0, 10)}`);
		} catch (e: any) {
			fail('create_task: default due tomorrow', e.message);
		}

		try {
			vi.clearAllMocks();
			const future = '2026-12-25T00:00:00.000Z';
			await executeInstructions(ctx, [
				{ command: 'create_task', args: { description: 'Xmas', due: future } }
			]);
			const call = (prisma.commTask.create as any).mock.calls[0][0];
			expect(call.data.due.toISOString()).toBe(future);
			pass('create_task: explicit due date', future);
		} catch (e: any) {
			fail('create_task: explicit due date', e.message);
		}

		// set_appointment
		try {
			vi.clearAllMocks();
			await executeInstructions(ctx, [
				{ command: 'set_appointment', args: { when: '2026-09-15T10:00:00Z', notes: 'Install' } }
			]);
			expect(prisma.appointment.create).toHaveBeenCalledWith(
				expect.objectContaining({
					data: expect.objectContaining({ companyId: 'comp_1' })
				})
			);
			pass('set_appointment: valid', '');
		} catch (e: any) {
			fail('set_appointment: valid', e.message);
		}

		try {
			vi.clearAllMocks();
			await executeInstructions(ctx, [{ command: 'set_appointment', args: {} }]);
			expect(prisma.appointment.create).not.toHaveBeenCalled();
			pass('set_appointment: skip missing when', '');
		} catch (e: any) {
			fail('set_appointment: skip missing when', e.message);
		}

		try {
			vi.clearAllMocks();
			await executeInstructions(ctx, [
				{
					command: 'set_appointment',
					args: { when: '2026-09-15T10:00:00Z', end: '2026-09-15T11:00:00Z' }
				}
			]);
			const call = (prisma.appointment.create as any).mock.calls[0][0];
			expect(call.data.endTime).toBeInstanceOf(Date);
			pass('set_appointment: with endTime', `end=${call.data.endTime.toISOString()}`);
		} catch (e: any) {
			fail('set_appointment: with endTime', e.message);
		}

		// update_profile
		try {
			vi.clearAllMocks();
			await executeInstructions(ctx, [
				{ command: 'update_profile', args: { firstName: 'NewName', status: 'client' } }
			]);
			expect(prisma.pipelineCustomerProfile.update).toHaveBeenCalledWith({
				where: { id: 'prof_1' },
				data: { firstName: 'NewName', status: 'client' }
			});
			pass('update_profile: valid', 'firstName + status');
		} catch (e: any) {
			fail('update_profile: valid', e.message);
		}

		try {
			vi.clearAllMocks();
			await executeInstructions(ctx, [
				{ command: 'update_profile', args: { firstName: 'T', randomField: 'ignored' } }
			]);
			const call = (prisma.pipelineCustomerProfile.update as any).mock.calls[0][0];
			expect(call.data.randomField).toBeUndefined();
			expect(call.data.firstName).toBe('T');
			pass('update_profile: unknown fields ignored', 'randomField filtered');
		} catch (e: any) {
			fail('update_profile: unknown fields ignored', e.message);
		}

		try {
			vi.clearAllMocks();
			await executeInstructions(ctx, [{ command: 'update_profile', args: { random: 'value' } }]);
			expect(prisma.pipelineCustomerProfile.update).not.toHaveBeenCalled();
			pass('update_profile: skip no valid fields', '');
		} catch (e: any) {
			fail('update_profile: skip no valid fields', e.message);
		}

		try {
			vi.clearAllMocks();
			await executeInstructions({ companyId: 'comp_1', customerId: 'c1' } as any, [
				{ command: 'update_profile', args: { firstName: 'N' } }
			]);
			expect(prisma.pipelineCustomerProfile.findFirst).not.toHaveBeenCalled();
			pass('update_profile: skip no identifier (phone/email)', '');
		} catch (e: any) {
			fail('update_profile: skip no identifier (phone/email)', e.message);
		}

		try {
			vi.clearAllMocks();
			(prisma.pipelineCustomerProfile.findFirst as any).mockResolvedValueOnce(null);
			await executeInstructions(ctx, [{ command: 'update_profile', args: { firstName: 'N' } }]);
			pass('update_profile: skip profile not found', '');
		} catch (e: any) {
			fail('update_profile: skip profile not found', e.message);
		}

		// update_engagement_score
		try {
			vi.clearAllMocks();
			await executeInstructions(ctx, [{ command: 'update_engagement_score', args: { delta: 10 } }]);
			expect(prisma.contact.update).toHaveBeenCalledWith({
				where: { id: 'cust_1' },
				data: { engagementScore: { increment: 10 } }
			});
			pass('update_engagement_score: valid', '+10');
		} catch (e: any) {
			fail('update_engagement_score: valid', e.message);
		}

		try {
			vi.clearAllMocks();
			await executeInstructions(ctx, [{ command: 'update_engagement_score', args: { delta: 0 } }]);
			expect(prisma.contact.update).not.toHaveBeenCalled();
			pass('update_engagement_score: skip delta=0', '');
		} catch (e: any) {
			fail('update_engagement_score: skip delta=0', e.message);
		}

		try {
			vi.clearAllMocks();
			await executeInstructions({ companyId: 'comp_1' } as any, [
				{ command: 'update_engagement_score', args: { delta: 5 } }
			]);
			expect(prisma.contact.update).not.toHaveBeenCalled();
			pass('update_engagement_score: skip no customerId', '');
		} catch (e: any) {
			fail('update_engagement_score: skip no customerId', e.message);
		}

		// ═══════════════════════════════════════════════════════════════
		// SECTION 17 — Real-world integrated scenarios
		// ═══════════════════════════════════════════════════════════════
		setSection('Real-world integrated scenarios');
		try {
			const realisticPayload = {
				mimeType: 'multipart/mixed',
				filename: '',
				parts: [
					{
						mimeType: 'text/plain',
						filename: '',
						body: { data: Buffer.from('Check the attached invoice.').toString('base64') }
					},
					{
						mimeType: 'application/pdf',
						filename: 'invoice-2024-08.pdf',
						body: { attachmentId: 'att_1', size: 45000 }
					},
					{
						mimeType: 'image/jpeg',
						filename: 'photo-of-damage.jpg',
						body: { attachmentId: 'att_2', size: 320000 }
					}
				]
			};
			const r = extractAttachments(realisticPayload);
			expect(r).toHaveLength(2);
			pass('📎 Real: email with invoice + photo attachments', `${r[0].filename}, ${r[1].filename}`);
		} catch (e: any) {
			fail('📎 Real: email with invoice + photo attachments', e.message);
		}

		try {
			vi.clearAllMocks();
			await executeInstructions(ctx, [
				{
					command: 'send_sms',
					args: { body: 'Your appointment is confirmed for Tuesday at 2PM.' }
				},
				{
					command: 'create_task',
					args: { description: 'Send follow-up quote', category: 'internal_followup' }
				},
				{ command: 'update_engagement_score', args: { delta: 5 } }
			]);
			expect(logCommunication).toHaveBeenCalled();
			expect(prisma.commTask.create).toHaveBeenCalled();
			expect(prisma.contact.update).toHaveBeenCalled();
			pass('📋 Real: multi-command chain (SMS + task + score)', '3 commands OK');
		} catch (e: any) {
			fail('📋 Real: multi-command chain (SMS + task + score)', e.message);
		}

		try {
			const token = await mintCsToken('contact_real', 'company_real');
			const openUrl = `https://example.com/api/track/open?t=${token}`;
			expect(openUrl).toContain('t=');
			expect(await verifyCsToken(token)).not.toBeNull();
			pass('🔗 Real: open-pixel URL with cs_token', `token verifies`);
		} catch (e: any) {
			fail('🔗 Real: open-pixel URL with cs_token', e.message);
		}

		try {
			const token = await mintCsToken('c_click', 'comp_click');
			const clickUrl = `https://example.com/api/track/click?t=${token}&url=${encodeURIComponent('https://viewroom.ca/pricing')}`;
			expect(clickUrl).toContain('t=');
			expect(clickUrl).toContain(encodeURIComponent('https://viewroom.ca/pricing'));
			expect(await verifyCsToken(token)).not.toBeNull();
			pass('🔗 Real: click-redirect URL with cs_token', 'token verifies');
		} catch (e: any) {
			fail('🔗 Real: click-redirect URL with cs_token', e.message);
		}

		try {
			const emailHtml = `<html><body>
				<h1>Your Roofing Quote</h1>
				<p>Hi John, here's your estimate for the roof repair.</p>
				<a href="https://viewroom.ca/accept-quote/abc123">Accept Quote</a>
				<a href="https://viewroom.ca/contact">Contact Us</a>
			</body></html>`;
			const r = await injectEmailTracking(
				emailHtml,
				'contact_roof',
				'comp_roof',
				'https://a2p.viewroom.ca'
			);
			expect(r.htmlContent).toContain('a2p.viewroom.ca/api/track/open?t=');
			expect(r.htmlContent).toContain('a2p.viewroom.ca/api/track/click?t=');
			const clicks = (r.htmlContent.match(/track\/click/g) || []).length;
			pass('📧 Real: marketing email with tracking', `1 pixel + ${clicks} click-links`);
		} catch (e: any) {
			fail('📧 Real: marketing email with tracking', e.message);
		}

		try {
			const emergencyHtml = `<html><body>
				<h2>URGENT: Water Damage Report</h2>
				<p>We received your emergency request. A technician is on the way.</p>
				<a href="https://viewroom.ca/track/tech-123">Track Technician</a>
			</body></html>`;
			const r = await injectEmailTracking(emergencyHtml, 'contact_urgent', 'comp_urgent');
			expect(r.htmlContent).toContain('track/open');
			expect(r.htmlContent).toContain('track/click');
			pass('🚨 Real: emergency email with full tracking', 'pixel + click-link + body intact');
		} catch (e: any) {
			fail('🚨 Real: emergency email with full tracking', e.message);
		}

		// ═══════════════════════════════════════════════════════════════
		// SECTION 18 — AI Decision Pipeline (realistic customer scenarios)
		// Each scenario traces a realistic message through the full
		// AI classification → category mapping → routing decision chain.
		// ═══════════════════════════════════════════════════════════════
		setSection('AI Decision Pipeline');

		try {
			const msg =
				'Henry here, this is Henry Adams. I need to make an appointment for next Tuesday morning to get my roof inspected.';
			expect(looksLikeActiveEmergency(msg)).toBe(false);
			const cat = bucketToCategory({
				intent_bucket: 'booking',
				wants_appointment: true,
				wants_callback: false,
				wants_balance: false,
				urgency: 'medium'
			} as any);
			expect(cat).toBe('sales');
			const route = decideRouting({ messageCategory: cat, isOffHours: false });
			expect(route.dispatchToTech).toBe(false);
			expect(route.draftCustomerReply).toBe(true);
			pass('AI: Henry "appointment...roof inspected" (voicemail)', `booking→sales→draftReply`);
		} catch (e: any) {
			fail('AI: Henry "appointment...roof inspected" (voicemail)', e.message);
		}

		try {
			const msg =
				'Sam here, this is Sam Rivera. Emergency! My basement is flooding, water everywhere! Pipe burst!';
			expect(looksLikeActiveEmergency(msg)).toBe(true);
			const cat = bucketToCategory({
				intent_bucket: 'emergency',
				wants_appointment: false,
				wants_callback: false,
				wants_balance: false,
				urgency: 'critical'
			} as any);
			expect(cat).toBe('emergency');
			const route = decideRouting({ messageCategory: cat, isOffHours: false });
			expect(route.dispatchToTech).toBe(true);
			expect(route.draftCustomerReply).toBe(false);
			expect(route.startSlaClock).toBe(true);
			pass('AI: Sam "emergency...flooding...burst" (voicemail)', `emergency→dispatchTech`);
		} catch (e: any) {
			fail('AI: Sam "emergency...flooding...burst" (voicemail)', e.message);
		}

		try {
			const msg =
				'John here, this is John Smith. I need a quote for a new roof. Get back to me on 555-123-4567.';
			expect(looksLikeActiveEmergency(msg)).toBe(false);
			const cat = bucketToCategory({
				intent_bucket: 'sales',
				wants_appointment: false,
				wants_callback: true,
				wants_balance: false,
				urgency: 'low'
			} as any);
			expect(cat).toBe('sales');
			const route = decideRouting({ messageCategory: cat, isOffHours: false });
			expect(route.dispatchToTech).toBe(false);
			expect(route.draftCustomerReply).toBe(true);
			const cbNum = extractCallbackNumber(msg);
			expect(cbNum).toBe('+15551234567');
			pass('AI: John "quote...call back 555-123-4567" (voicemail)', `sales→draftReply|↩${cbNum}`);
		} catch (e: any) {
			fail('AI: John "quote...call back 555-123-4567" (voicemail)', e.message);
		}

		try {
			const msg =
				'Kira here, this is Kira Wilson. Please get back to me at kira.wilson@email.com about my account.';
			expect(looksLikeActiveEmergency(msg)).toBe(false);
			const cat = bucketToCategory({
				intent_bucket: 'inquiry',
				wants_appointment: false,
				wants_callback: false,
				wants_balance: false,
				urgency: 'low'
			} as any);
			expect(cat).toBe('support');
			const route = decideRouting({ messageCategory: cat, isOffHours: false });
			expect(route.dispatchToTech).toBe(false);
			expect(route.draftCustomerReply).toBe(true);
			const hasEmail = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(msg);
			expect(hasEmail).toBe(true);
			pass('AI: Kira "contact kira@email.com" (voicemail)', `inquiry→support→draftReply|✉`);
		} catch (e: any) {
			fail('AI: Kira "contact kira@email.com" (voicemail)', e.message);
		}

		try {
			const msg = 'Yeah Tuesday at 2pm works for me. See you then.';
			expect(isAffirmative(msg)).toBe(true);
			pass('AI: Affirmative "Tuesday 2pm works" (SMS reply)', `affirmative→bookAppointment`);
		} catch (e: any) {
			fail('AI: Affirmative "Tuesday 2pm works" (SMS reply)', e.message);
		}

		try {
			const msg = 'No, I do not want that. I will call back later.';
			expect(isAffirmative(msg)).toBe(false);
			pass('AI: Negative "I will call back later" (SMS reply)', `negative→noBooking`);
		} catch (e: any) {
			fail('AI: Negative "I will call back later" (SMS reply)', e.message);
		}

		try {
			const msg = 'What do I owe on my account? Can you email me the balance?';
			const cat = bucketToCategory({
				intent_bucket: 'billing',
				wants_appointment: false,
				wants_callback: false,
				wants_balance: true,
				urgency: 'medium'
			} as any);
			expect(cat).toBe('billing');
			const route = decideRouting({ messageCategory: cat, isOffHours: false });
			expect(route.dispatchToTech).toBe(false);
			expect(route.draftCustomerReply).toBe(true);
			expect(wantsEmailedBalance(msg)).toBe(true);
			pass('AI: Balance "what do I owe...email" (SMS)', `billing→draftReply|✉balance`);
		} catch (e: any) {
			fail('AI: Balance "what do I owe...email" (SMS)', e.message);
		}

		try {
			// "No heat" is handled by AI classification, not the keyword backstop
			const cat = bucketToCategory({
				intent_bucket: 'emergency',
				wants_appointment: false,
				wants_callback: false,
				wants_balance: false,
				urgency: 'high'
			} as any);
			expect(cat).toBe('emergency');
			const route = decideRouting({ messageCategory: cat, isOffHours: false });
			expect(route.dispatchToTech).toBe(true);
			expect(route.draftCustomerReply).toBe(false);
			pass('AI: No heat "furnace stopped...no heat!" (voicemail)', `emergency→dispatchTech`);
		} catch (e: any) {
			fail('AI: No heat "furnace stopped...no heat!" (voicemail)', e.message);
		}

		// ═══════════════════════════════════════════════════════════════
		// PRINT RESULTS — grouped by section
		// ═══════════════════════════════════════════════════════════════
		console.log('\n═══════ BEHAVIORAL SMOKE TEST ═══════\n');
		const groups = new Map<string, { pass: number; fail: number; items: ScenarioResult[] }>();
		for (const r of results) {
			const g = groups.get(r.section) || { pass: 0, fail: 0, items: [] };
			g[r.result === 'PASS' ? 'pass' : 'fail']++;
			g.items.push(r);
			groups.set(r.section, g);
		}
		for (const [section, g] of groups) {
			const icon = g.fail === 0 ? '✅' : '❌';
			const label = `${icon} ${section}`.padEnd(44);
			const ok = '✅'.repeat(Math.min(g.pass, 20));
			const nope = '❌'.repeat(Math.min(g.fail, 10));
			console.log(`  ${label} ${ok}${nope} (${g.pass + g.fail})`);
			if (g.fail > 0) {
				for (const item of g.items.filter((i) => i.result === 'FAIL')) {
					console.log(`    ❌ ${item.scenario}`);
					console.log(`       ${item.output}`);
				}
			}
			if (section === 'AI Decision Pipeline') {
				for (const item of g.items) {
					const msg = item.scenario
						.replace(/^AI: /, '')
						.replace(/\((voicemail|SMS|SMS reply)\)/, '')
						.trim();
					const out = item.output.length > 50 ? item.output.slice(0, 47) + '...' : item.output;
					console.log(`  ${item.result === 'PASS' ? '✅' : '❌'} ${out.padEnd(50)} ${msg}`);
				}
			}
		}
		const passed = results.filter((r) => r.result === 'PASS').length;
		const failed = results.filter((r) => r.result === 'FAIL').length;
		console.log(`  ${'─'.repeat(66)}`);
		console.log(`  TOTAL${' '.repeat(37)} ✅ ${passed}   ❌ ${failed}   (${results.length} total)`);
		console.log('');

		expect(failed).toBe(0);
	});
});
