import usAreaCodes from '$lib/data/area-codes-us.json';
import caAreaCodes from '$lib/data/area-codes-ca.json';

// area code → geographic location (city/region), from the bundled NANP data.
const AREA: Record<string, string> = {};
for (const a of [...(usAreaCodes as { code: string; location: string }[]), ...(caAreaCodes as { code: string; location: string }[])]) {
	AREA[a.code] = a.location;
}

export interface PhoneGeo {
	areaCode: string | null;
	prefix: string | null; // 3-digit exchange/prefix
	line: string | null; // 4-digit line number
	location: string | null; // city/region for the area code
}

/** Break a phone number into area code / prefix / line and resolve the area's location. */
export function phoneGeo(phone: string | null | undefined): PhoneGeo {
	const d = (phone || '').replace(/\D/g, '');
	const ten = d.length > 10 ? d.slice(-10) : d;
	if (ten.length < 10) return { areaCode: null, prefix: null, line: null, location: null };
	const areaCode = ten.slice(0, 3);
	return { areaCode, prefix: ten.slice(3, 6), line: ten.slice(6, 10), location: AREA[areaCode] ?? null };
}

/** Day of week for a timestamp (defaults to now). */
export function dayOfWeek(d: Date = new Date()): string {
	return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getDay()];
}

/**
 * Line type (mobile vs landline) + carrier via Telnyx Number Lookup, using the existing
 * TELNYX_API_KEY. Best-effort — returns nulls if the key is unset or the lookup fails.
 */
export async function lookupLineType(
	phone: string | null | undefined
): Promise<{ lineType: string | null; carrier: string | null }> {
	if (!phone) return { lineType: null, carrier: null };

	// Delegates to the shared cache rather than calling Telnyx itself. This used to be a second,
	// uncached lookup on every call — the same number billed twice, once for enrichment and once
	// for the tier decision, with the two free to disagree.
	//
	// Note the vocabulary is now the normalised one ('toll_free', not 'toll free'; 'unknown'
	// rather than null for a failed lookup), which is what the tier rule reads. This value is
	// metadata and display only — the tier itself comes from `getLineType`.
	const { getLineInfo } = await import('$lib/server/number-lookup');
	const info = await getLineInfo(phone);
	return { lineType: info.lineType, carrier: info.carrier };
}
