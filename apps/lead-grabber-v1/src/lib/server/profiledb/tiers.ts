/**
 * Canonical identity tiers (MA v3 §4.2, §4.3a).
 *
 * Tier is stored as a free-text string on CustomerProfile; these constants are the
 * only values the app should assign, so the set can't drift across call sites.
 *
 *   Tier 2B — anonymous but engaged (past the 10-second floor), no identifier
 *   Tier 2  — a weak or *shared* identifier: a display name, or a phone line more
 *             than one person can pick up
 *   Tier 1  — an identifier exclusive to one person has been captured
 */
export const TIER = {
	ANON_ENGAGED: 'Tier 2B',
	ANON_NAMED: 'Tier 2',
	SHARED_LINE: 'Tier 2',
	IDENTIFIED: 'Tier 1'
} as const;

export type Tier = (typeof TIER)[keyof typeof TIER];

export const GROUP = {
	EMAIL: 2,
	PHONE: 3,
	NAME_ONLY: 4
} as const;

/**
 * Telnyx `data.carrier.type` values, plus the two states the wire never returns:
 * toll-free (derived from the NPA) and unknown (lookup slow, failed, or not yet run).
 */
export type LineType = 'mobile' | 'landline' | 'voip' | 'toll_free' | 'unknown';

const TOLL_FREE_NPA = new Set(['800', '833', '844', '855', '866', '877', '888']);

/** Toll-free is commercial by definition and never reaches one person. Telnyx reports it as
 *  landline, so it's derived from the number here rather than from the lookup. */
export function isTollFree(e164: string | null | undefined): boolean {
	if (!e164) return false;
	const digits = e164.replace(/\D/g, '');
	// NANP: 1 + NPA + NXX + line
	if (digits.length !== 11 || !digits.startsWith('1')) return false;
	return TOLL_FREE_NPA.has(digits.slice(1, 4));
}

/**
 * Map a Telnyx carrier type onto our line types, folding toll-free in from the number.
 * Anything we don't recognise is `unknown`, which is Tier 2 — see `tierForIdentifiers`.
 */
export function classifyLine(
	carrierType: string | null | undefined,
	e164?: string | null
): LineType {
	if (isTollFree(e164)) return 'toll_free';
	switch ((carrierType || '').trim().toLowerCase()) {
		case 'mobile':
		case 'wireless':
			return 'mobile';
		case 'landline':
		case 'fixed line':
			return 'landline';
		case 'voip':
			return 'voip';
		default:
			return 'unknown';
	}
}

/**
 * §4.3a: a phone number identifies a *line*, not a person. It only resolves an individual where
 * the line is exclusive to one — which in practice means a mobile.
 *
 * A failed or missing lookup is `unknown` and stays Tier 2. Never default upward: the cost of
 * guessing wrong is every caller from one office collapsing into whoever rang first.
 */
export function isExclusiveLine(lineType: LineType | null | undefined): boolean {
	return lineType === 'mobile';
}

export interface TierInput {
	/** An email address was captured. Exclusive to one person — always Tier 1. */
	hasEmail?: boolean;
	/** A phone number was captured, in any form. */
	hasPhone?: boolean;
	/** Line type for that phone, from Telnyx Number Lookup. Absent means not yet known → Tier 2. */
	lineType?: LineType | null;
	/**
	 * The event arrived as an inbound SMS. The sender is by definition a mobile handset, so no
	 * lookup is needed and the number is exclusive (§4.3a, "What this does not change").
	 */
	inboundSms?: boolean;
	hasName?: boolean;
	currentTier?: string;
}

/**
 * The tier a profile should hold given what we now know about it.
 *
 * The one place tiers are decided. Call sites pass what they observed and take the answer — a
 * local `phone ? 'Tier 1' : ...` anywhere else is the bug this exists to prevent.
 */
export function tierForIdentifiers(input: TierInput): string {
	const { hasEmail, hasPhone, lineType, inboundSms, hasName, currentTier } = input;

	// An exclusive identifier resolves a person on first contact.
	if (hasEmail) return TIER.IDENTIFIED;
	if (inboundSms) return TIER.IDENTIFIED;
	if (hasPhone && isExclusiveLine(lineType)) return TIER.IDENTIFIED;

	// Tier 1 is never given up: an exclusive identifier captured earlier still resolves this person,
	// whatever channel they turn up on next.
	if (currentTier === TIER.IDENTIFIED) return TIER.IDENTIFIED;

	// A shared line — landline, VoIP, toll-free — or a line we couldn't classify. We know a handset,
	// not a person, so same-channel response only (§4.3) until they give a mobile or an email.
	if (hasPhone) return TIER.SHARED_LINE;

	if (hasName) return TIER.ANON_NAMED;

	return currentTier || TIER.ANON_ENGAGED;
}

/**
 * The group code that goes with a tier decision. Email outranks phone, matching
 * `tierForIdentifiers` — same inputs, same precedence.
 */
export function groupForIdentifiers(input: TierInput): number {
	if (input.hasEmail) return GROUP.EMAIL;
	if (input.hasPhone || input.inboundSms) return GROUP.PHONE;
	return GROUP.NAME_ONLY;
}
