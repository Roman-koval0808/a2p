/**
 * Shared, typed emergency auto-reply templates.
 *
 * Single source of truth for (a) classifying an emergency into a named type and
 * (b) the guidance message sent back to the customer. Previously this logic was
 * duplicated as inline keyword if/else chains in profiledb/telemetry.ts and
 * routes/api/messages/+server.ts (and a third coarse copy in the pipeline's
 * emergency_type resolver). They all import from here now.
 */

export type EmergencyType =
	| 'burst_pipe'
	| 'gas_leak'
	| 'sewage_backup'
	| 'electrical_fire'
	| 'no_hot_water'
	| 'roof_leak'
	| 'general_emergency';

interface TemplateDef {
	type: EmergencyType;
	/** Regex over lowercased text. Order matters — first match wins (see CLASSIFY_ORDER). */
	match: RegExp;
	/** Advice body. Placeholders: {name}, {eta}, {brand}. */
	advice: string;
}

// Evaluated in array order so more specific types win over generic ones
// (e.g. "gas leakage" must hit gas_leak before burst_pipe's "leak").
const TEMPLATES: TemplateDef[] = [
	{
		type: 'gas_leak',
		match: /\bgas\b|carbon monoxide|smell|odor|leakage/,
		advice:
			'Hi {name}, we received your urgent message about a potential gas issue. Please IMMEDIATELY evacuate the building, leave the doors open, and do not touch any electrical switches! A technician has been dispatched and will contact you in {eta}. — {brand}'
	},
	{
		type: 'sewage_backup',
		match: /sewage|sewer|septic|drain|backup|overflow|toilet/,
		advice:
			'Hi {name}, we received your urgent message about a sewage backup. Please avoid flushing toilets or running any water, and keep away from the affected area to prevent contamination! A plumber has been dispatched and will contact you in {eta}. — {brand}'
	},
	{
		type: 'electrical_fire',
		match: /power|electr|spark|wire|smoke|burning|\bfire\b|shock/,
		advice:
			'Hi {name}, we received your urgent message about an electrical issue. Please TURN OFF the main power breaker to the affected area immediately! An electrician has been dispatched and will contact you in {eta}. — {brand}'
	},
	{
		type: 'no_hot_water',
		match: /no hot water|hot water|water heater|\bheater\b|furnace|hvac|no heat|\bcold\b/,
		advice:
			'Hi {name}, we received your urgent message about the heating/hot-water failure. A technician has been dispatched and will contact you in {eta}. Please keep your phone available. — {brand}'
	},
	{
		type: 'roof_leak',
		match: /roof|ceiling|\bdrip\b|attic/,
		advice:
			'Hi {name}, we received your urgent message about a roof or ceiling leak. If safe, please place buckets under the drip and move valuables out of the area! A technician has been dispatched and will contact you in {eta}. — {brand}'
	},
	{
		type: 'burst_pipe',
		match: /burst|flood|\bpipe\b|leak|\bwater\b/,
		advice:
			'Hi {name}, we received your urgent message about the leak. Please TURN OFF your main water supply immediately to prevent further damage! A plumber has been dispatched and will contact you in {eta}. — {brand}'
	}
];

const GENERAL_ADVICE =
	'Hi {name}, we received your urgent message. A technician has been dispatched and will contact you in {eta}. Please keep your phone available. — {brand}';

export const EMERGENCY_TYPES: EmergencyType[] = [
	...TEMPLATES.map((t) => t.type),
	'general_emergency'
];

/** Classify free text into a named emergency type (keyword-based, first match wins). */
export function classifyEmergencyType(text: string | null | undefined): EmergencyType {
	if (!text) return 'general_emergency';
	const lower = text.toLowerCase();
	for (const t of TEMPLATES) {
		if (t.match.test(lower)) return t.type;
	}
	return 'general_emergency';
}

interface AdviceOptions {
	/** Explicit type (e.g. from AI). If omitted, `text` is classified. */
	type?: EmergencyType | null;
	text?: string | null;
	name?: string | null;
	/** e.g. "10 minutes"; defaults to "2-3 minutes". */
	eta?: string;
	brand?: string;
}

/** Build the customer-facing emergency advice message and the resolved type. */
export function emergencyAdvice(opts: AdviceOptions): { type: EmergencyType; message: string } {
	const type = opts.type ?? classifyEmergencyType(opts.text);
	const def = TEMPLATES.find((t) => t.type === type);
	const template = def?.advice ?? GENERAL_ADVICE;
	const message = template
		.replaceAll('{name}', opts.name?.trim() || 'there')
		.replaceAll('{eta}', opts.eta || '2-3 minutes')
		.replaceAll('{brand}', opts.brand || 'RightFlush Plumbing');
	return { type, message };
}
