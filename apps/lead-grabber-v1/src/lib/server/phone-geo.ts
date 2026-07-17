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
export async function lookupLineType(phone: string | null | undefined): Promise<{ lineType: string | null; carrier: string | null }> {
	const apiKey = process.env.TELNYX_API_KEY?.trim();
	const d = (phone || '').replace(/\D/g, '');
	if (!apiKey || d.length < 10) return { lineType: null, carrier: null };
	const e164 = d.length === 10 ? `+1${d}` : d.startsWith('1') ? `+${d}` : `+${d}`;
	try {
		const res = await fetch(
			`https://api.telnyx.com/v2/number_lookup/${encodeURIComponent(e164)}?type=carrier`,
			{ headers: { Authorization: `Bearer ${apiKey}` } }
		);
		if (!res.ok) return { lineType: null, carrier: null };
		const j = await res.json();
		const carrier = j?.data?.carrier;
		return { lineType: carrier?.type ?? null, carrier: carrier?.name ?? null };
	} catch {
		return { lineType: null, carrier: null };
	}
}
