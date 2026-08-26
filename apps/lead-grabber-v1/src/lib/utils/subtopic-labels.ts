/**
 * Human labels for subtopic keys.
 *
 * The keys are storage ("drain", "water_heater"); these are what a person reads. The Intent column
 * used to print the raw key capitalised, so a bathroom renovation enquiry rendered as just
 * "Bathroom" — the tag, not what the customer actually wanted.
 *
 * Lives in `utils` rather than beside the taxonomy in `$lib/server/telemetry/`, because SvelteKit
 * refuses to bundle anything under `$lib/server` into a component. The server-side taxonomy in
 * `subtopic-classifier.ts` reads its labels from here so the two cannot drift.
 */
export const SUBTOPIC_LABELS: Record<string, string> = {
	emergency: 'Emergency call-out',
	plumbing: 'Plumbing',
	drain: 'Blocked drain',
	water_heater: 'Water heater',
	hvac: 'Heating & cooling',
	furnace: 'Furnace',
	electrical: 'Electrical',
	renovation: 'Renovation',
	bathroom: 'Bathroom renovation',
	kitchen: 'Kitchen renovation',
	roof: 'Roofing',
	quote: 'Quote request',
	billing: 'Billing',
	support: 'Support',
	repair: 'Repair',
	unknown: 'Not stated'
};

/** The readable label for a subtopic key, falling back to the key itself made presentable. */
export function subtopicLabel(key: string | null | undefined): string | null {
	if (!key) return null;
	const k = key.toLowerCase().trim();
	if (SUBTOPIC_LABELS[k]) return SUBTOPIC_LABELS[k];
	const words = k.replace(/[_-]+/g, ' ').trim();
	return words ? words.charAt(0).toUpperCase() + words.slice(1) : null;
}
