import { prisma } from '$lib/db';
import { env } from '$env/dynamic/private';
import { toE164 } from '$lib/utils/phone';
import { classifyLine, isTollFree, type LineType } from '$lib/server/profiledb/tiers';

/**
 * Telnyx Number Lookup — the line type behind a phone number.
 *
 * §4.3a makes this mandatory: a tier cannot be assigned to an inbound call until we know whether
 * the line is exclusive to one person. In North America the number itself tells you nothing,
 * because portability lets a mobile carry an old landline prefix and the reverse.
 *
 * `?type=carrier` is required — without it the API returns LRN only and no line type.
 */

/** Telnyx is on the critical path of a live call, so it gets a short leash. */
const LOOKUP_TIMEOUT_MS = 1500;

/** Numbers get ported. A classification older than this is re-checked. */
const NUMBER_LOOKUP_TTL_DAYS = 180;

export interface NumberLookupResult {
	phoneNumber: string;
	lineType: LineType;
	carrier?: string;
	raw?: any;
}

function isStale(lookedUpAt: Date): boolean {
	const ageMs = Date.now() - lookedUpAt.getTime();
	return ageMs > NUMBER_LOOKUP_TTL_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * Ask Telnyx directly. Resolves to null on timeout, transport error, non-2xx, or missing API key —
 * every one of which the caller must treat as `unknown`, never as an upgrade.
 */
async function fetchLineType(e164: string): Promise<NumberLookupResult | null> {
	const apiKey = env.TELNYX_API_KEY;
	if (!apiKey) {
		console.warn('[NumberLookup] TELNYX_API_KEY not set — cannot classify line');
		return null;
	}

	const controller = new AbortController();
	let timer: ReturnType<typeof setTimeout> | undefined;

	// The abort signal releases the socket; the race enforces the deadline. Both, because the
	// deadline is the part we actually promise — a tier decision on a live call cannot be held
	// open waiting for a transport that declines to abort.
	const deadline = new Promise<null>((resolve) => {
		timer = setTimeout(() => {
			controller.abort();
			resolve(null);
		}, LOOKUP_TIMEOUT_MS);
	});

	try {
		const res = await Promise.race([
			fetch(`https://api.telnyx.com/v2/number_lookup/${encodeURIComponent(e164)}?type=carrier`, {
				headers: {
					Authorization: `Bearer ${apiKey}`,
					'Content-Type': 'application/json'
				},
				signal: controller.signal
			}),
			deadline
		]);

		if (!res) {
			console.warn(`[NumberLookup] Lookup exceeded ${LOOKUP_TIMEOUT_MS}ms for ${e164}`);
			return null;
		}

		if (!res.ok) {
			console.warn(`[NumberLookup] Telnyx returned ${res.status} for ${e164}`);
			return null;
		}

		const json = await res.json();
		const data = json?.data || {};
		const carrier = data.carrier || {};
		const lineType = classifyLine(carrier.type, e164);

		// A 200 that doesn't classify is still not knowledge — don't cache it as one.
		if (lineType === 'unknown') {
			console.warn(`[NumberLookup] Unrecognised carrier.type "${carrier.type}" for ${e164}`);
			return null;
		}

		return { phoneNumber: e164, lineType, carrier: carrier.name || undefined, raw: data };
	} catch (err) {
		// AbortError on timeout, TypeError on transport failure. Same outcome either way.
		console.warn(`[NumberLookup] Lookup failed or timed out for ${e164}:`, err);
		return null;
	} finally {
		clearTimeout(timer);
	}
}

/**
 * The line type for a number, cached. Returns `'unknown'` when it can't be established — the
 * caller must map that to Tier 2 (§4.3a: never default upward).
 *
 * Failures are deliberately not cached, so one slow Telnyx response doesn't permanently hold a
 * mobile caller at Tier 2; the next call re-tries.
 */
export async function getLineType(phone: string, tx?: any): Promise<LineType> {
	return (await getLineInfo(phone, tx)).lineType;
}

/**
 * As `getLineType`, but also returns the carrier name — for enrichment and display. Shares the one
 * cache, so asking for the carrier costs nothing beyond the lookup the tier decision already needs.
 */
export async function getLineInfo(
	phone: string,
	tx?: any
): Promise<{ lineType: LineType; carrier: string | null }> {
	const e164 = toE164(phone);
	if (!e164) return { lineType: 'unknown', carrier: null };

	// Toll-free is derivable from the NPA, and Telnyx reports it as a landline anyway. Free answer.
	if (isTollFree(e164)) return { lineType: 'toll_free', carrier: null };

	const db = tx || prisma;

	try {
		const cached = await db.numberLookup.findUnique({ where: { phoneNumber: e164 } });
		if (cached && !isStale(cached.lookedUpAt)) {
			return { lineType: cached.lineType as LineType, carrier: cached.carrier ?? null };
		}
	} catch (err) {
		// A cache read failing must not take the call path down with it — fall through to Telnyx.
		console.warn('[NumberLookup] Cache read failed:', err);
	}

	const result = await fetchLineType(e164);
	if (!result) return { lineType: 'unknown', carrier: null };

	try {
		await db.numberLookup.upsert({
			where: { phoneNumber: e164 },
			create: {
				phoneNumber: e164,
				lineType: result.lineType,
				carrier: result.carrier,
				raw: result.raw
			},
			update: {
				lineType: result.lineType,
				carrier: result.carrier,
				raw: result.raw,
				lookedUpAt: new Date()
			}
		});
	} catch (err) {
		// We have the answer; failing to memoise it costs money, not correctness.
		console.warn('[NumberLookup] Cache write failed:', err);
	}

	return { lineType: result.lineType, carrier: result.carrier ?? null };
}

/**
 * As `getLineType`, but also stamps the classification onto the company's profile for that number
 * so the profile carries its own line type for display and downstream tier decisions.
 */
export async function lookupNumberCached(
	companyId: string,
	phoneNumber: string,
	tx?: any
): Promise<NumberLookupResult | null> {
	if (!phoneNumber) return null;
	const db = tx || prisma;
	const e164 = toE164(phoneNumber);
	if (!e164) return null;

	const lineType = await getLineType(phoneNumber, tx);

	try {
		const cached = await db.numberLookup.findUnique({ where: { phoneNumber: e164 } });
		const carrier = cached?.carrier ?? undefined;

		// Only write a classification we actually established. `unknown` is the absence of an
		// answer, and persisting it would make the next call believe the number was already checked.
		if (lineType !== 'unknown') {
			await db.pipelineCustomerProfile.updateMany({
				where: { companyId, phoneNumber: e164 },
				data: { lineType, carrier, lookupDate: new Date() }
			});
		}

		return { phoneNumber: e164, lineType, carrier };
	} catch (err) {
		console.warn('[NumberLookup] Failed to stamp profile with line type:', err);
		return { phoneNumber: e164, lineType };
	}
}
