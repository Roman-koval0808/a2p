import { describe, it, expect } from 'vitest';
import { TIER, tierForIdentifiers, classifyLine, isTollFree, isExclusiveLine } from './tiers';

/**
 * §4.3a. The fault being guarded against: treating any caller ID as Tier 1 means everyone who uses
 * one office phone collapses into whichever person rang first — a single record accumulating
 * several people's history, scores and consent.
 */
describe('tierForIdentifiers — shared lines are Tier 2 (§4.3a)', () => {
	it('a mobile is Tier 1 — effectively one person', () => {
		expect(tierForIdentifiers({ hasPhone: true, lineType: 'mobile' })).toBe(TIER.IDENTIFIED);
	});

	it.each(['landline', 'voip', 'toll_free'] as const)(
		'%s is Tier 2 — it identifies a handset, not a person',
		(lineType) => {
			expect(tierForIdentifiers({ hasPhone: true, lineType })).toBe(TIER.SHARED_LINE);
		}
	);

	it('an unknown line type is Tier 2 — never default upward', () => {
		expect(tierForIdentifiers({ hasPhone: true, lineType: 'unknown' })).toBe(TIER.SHARED_LINE);
	});

	it('a phone with no line type resolved at all is Tier 2, not Tier 1', () => {
		// The regression: a missing lookup must not read as "no reason to doubt it".
		expect(tierForIdentifiers({ hasPhone: true })).toBe(TIER.SHARED_LINE);
	});

	it('an email is Tier 1 regardless of the line', () => {
		expect(tierForIdentifiers({ hasEmail: true, hasPhone: true, lineType: 'landline' })).toBe(
			TIER.IDENTIFIED
		);
	});

	it('inbound SMS stays Tier 1 — the sender is a mobile by definition', () => {
		expect(tierForIdentifiers({ hasPhone: true, inboundSms: true })).toBe(TIER.IDENTIFIED);
	});

	it('a name alone is Tier 2', () => {
		expect(tierForIdentifiers({ hasName: true })).toBe(TIER.ANON_NAMED);
	});

	it('nothing at all leaves an engaged anonymous visitor at 2B', () => {
		expect(tierForIdentifiers({ currentTier: TIER.ANON_ENGAGED })).toBe(TIER.ANON_ENGAGED);
	});

	it('a landline caller who later gives a mobile becomes Tier 1 — the whole point of the call', () => {
		const onTheCall = tierForIdentifiers({ hasPhone: true, lineType: 'landline' });
		expect(onTheCall).toBe(TIER.SHARED_LINE);

		const afterTheyGiveAnEmail = tierForIdentifiers({
			hasPhone: true,
			lineType: 'landline',
			hasEmail: true,
			currentTier: onTheCall
		});
		expect(afterTheyGiveAnEmail).toBe(TIER.IDENTIFIED);
	});

	it('Tier 1 is never given up once earned', () => {
		expect(tierForIdentifiers({ hasPhone: true, lineType: 'landline', currentTier: TIER.IDENTIFIED })).toBe(
			TIER.IDENTIFIED
		);
	});
});

describe('classifyLine', () => {
	it.each([
		['mobile', 'mobile'],
		['wireless', 'mobile'],
		['landline', 'landline'],
		['fixed line', 'landline'],
		['voip', 'voip'],
		['VoIP', 'voip'],
		['MOBILE', 'mobile'],
		['toll free', 'toll_free'],
		['toll-free', 'toll_free']
	])('maps Telnyx carrier.type "%s" to %s', (input, expected) => {
		expect(classifyLine(input)).toBe(expected);
	});

	it('treats an unrecognised or missing carrier type as unknown', () => {
		expect(classifyLine(undefined)).toBe('unknown');
		expect(classifyLine('')).toBe('unknown');
		expect(classifyLine('something-new')).toBe('unknown');
	});

	it('treats "other" as unknown — a 555 number has no carrier, so we do not know', () => {
		expect(classifyLine('other')).toBe('unknown');
	});

	it('overrides the carrier type for toll-free, which Telnyx reports as a landline', () => {
		expect(classifyLine('landline', '+18885551234')).toBe('toll_free');
	});
});

describe('isTollFree', () => {
	it.each(['+18005551234', '+18335551234', '+18445551234', '+18555551234', '+18665551234', '+18775551234', '+18885551234'])(
		'%s is toll-free',
		(n) => expect(isTollFree(n)).toBe(true)
	);

	it('does not mistake a geographic number for toll-free', () => {
		expect(isTollFree('+17052642251')).toBe(false);
		expect(isTollFree('+18015551234')).toBe(false); // 801 is Utah, not 800
	});
});

describe('isExclusiveLine', () => {
	it('only a mobile identifies one person', () => {
		expect(isExclusiveLine('mobile')).toBe(true);
		expect(isExclusiveLine('landline')).toBe(false);
		expect(isExclusiveLine('voip')).toBe(false);
		expect(isExclusiveLine('toll_free')).toBe(false);
		expect(isExclusiveLine('unknown')).toBe(false);
		expect(isExclusiveLine(undefined)).toBe(false);
	});
});
