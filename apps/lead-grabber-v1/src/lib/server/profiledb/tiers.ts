/**
 * Canonical identity tiers (Q2 Identity Tiers & Groups).
 *
 * Tier is stored as a free-text string on CustomerProfile; these constants are the
 * only values the app should assign, so the set can't drift across call sites.
 *
 *   Tier 2B — anonymous but engaged (past the 10-second floor), no identifier
 *   Tier 2A — a display name only, still no contact identifier
 *   Tier 1  — a contact identifier (email or phone) has been captured
 */
export const TIER = {
	ANON_ENGAGED: 'Tier 2B',
	ANON_NAMED: 'Tier 2A',
	IDENTIFIED: 'Tier 1'
} as const;

export type Tier = (typeof TIER)[keyof typeof TIER];

export const GROUP = {
	EMAIL: 2,
	PHONE: 3,
	NAME_ONLY: 4
} as const;

/**
 * The tier a profile should hold given the identifiers it now has. Capturing a
 * phone or email promotes an anonymous session straight to Tier 1.
 */
export function tierForIdentifiers(opts: {
	hasContact: boolean;
	hasName: boolean;
	currentTier?: string;
}): string {
	if (opts.hasContact) return TIER.IDENTIFIED;
	if (opts.hasName && opts.currentTier === TIER.ANON_ENGAGED) return TIER.ANON_NAMED;
	return opts.currentTier || TIER.ANON_ENGAGED;
}
