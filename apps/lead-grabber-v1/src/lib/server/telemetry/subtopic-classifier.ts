import { ANTHROPIC_AI_KEY } from '$env/static/private';
import { claudeJSON, CLAUDE_FAST } from '$lib/server/anthropic';
import { prisma } from '$lib/db';
import { normalizeSubtopic, subtopicWindowDays } from './engagement';
import { SUBTOPIC_LABELS } from '$lib/utils/subtopic-labels';

/**
 * Works out what type of business an interaction was about, when the cheap deterministic paths
 * cannot.
 *
 * Order matters, and it is deliberately cheapest-first — the model is the last resort, not the
 * first:
 *
 *   1. the page address or a payload field   (engagement.ts, free, already runs on intake)
 *   2. the call tracking category            (free — the tracking number already means a service)
 *   3. Claude                                (paid, only for text we cannot otherwise read)
 *
 * The model is constrained to a fixed list of keys, so a tag means the same thing every time.
 * Free text would defeat the point of tagging at all.
 */

// ── The taxonomy ────────────────────────────────────────────────────────────
//
// Two levels, parent → children, matching the shape the model spec uses
// (Renovations → {Bathroom, Kitchen, Roof}). This is the default trade list; a company can
// override it (see companyTaxonomy) once per-contractor service lists exist. The windows come from
// SUBTOPIC_WINDOW_DAYS in engagement.ts rather than being restated here, so the two cannot drift.
// It is deliberately
// small — a taxonomy nobody maintains drifts into free text, which is the thing to avoid.

export interface TaxonomyEntry {
	key: string;
	label: string;
	parent?: string;
	/** How long an episode about this stays warm. Used by engagementWindowDays. */
	inactivityDays: number;
}

export const DEFAULT_TAXONOMY: TaxonomyEntry[] = [
	{ key: 'emergency', label: SUBTOPIC_LABELS['emergency'], inactivityDays: subtopicWindowDays('emergency') },
	{ key: 'plumbing', label: SUBTOPIC_LABELS['plumbing'], inactivityDays: subtopicWindowDays('plumbing') },
	{ key: 'drain', label: SUBTOPIC_LABELS['drain'], parent: 'plumbing', inactivityDays: subtopicWindowDays('drain') },
	{ key: 'water_heater', label: SUBTOPIC_LABELS['water_heater'], parent: 'plumbing', inactivityDays: subtopicWindowDays('water_heater') },
	{ key: 'hvac', label: SUBTOPIC_LABELS['hvac'], inactivityDays: subtopicWindowDays('hvac') },
	{ key: 'furnace', label: SUBTOPIC_LABELS['furnace'], parent: 'hvac', inactivityDays: subtopicWindowDays('furnace') },
	{ key: 'electrical', label: SUBTOPIC_LABELS['electrical'], inactivityDays: subtopicWindowDays('electrical') },
	{ key: 'renovation', label: SUBTOPIC_LABELS['renovation'], inactivityDays: subtopicWindowDays('renovation') },
	{ key: 'bathroom', label: SUBTOPIC_LABELS['bathroom'], parent: 'renovation', inactivityDays: subtopicWindowDays('bathroom') },
	{ key: 'kitchen', label: SUBTOPIC_LABELS['kitchen'], parent: 'renovation', inactivityDays: subtopicWindowDays('kitchen') },
	{ key: 'roof', label: SUBTOPIC_LABELS['roof'], parent: 'renovation', inactivityDays: subtopicWindowDays('roof') },
	{ key: 'quote', label: SUBTOPIC_LABELS['quote'], inactivityDays: subtopicWindowDays('quote') }
];

/**
 * A company's own service list, when it has one, else the default trades.
 * Stored on Company.settings.serviceTaxonomy so no new table is needed — the ServiceTaxonomy
 * model was deliberately skipped, and this keeps that decision reversible.
 */
export async function companyTaxonomy(companyId: string): Promise<TaxonomyEntry[]> {
	try {
		const company = await prisma.company.findUnique({
			where: { id: companyId },
			select: { settings: true }
		});
		const custom = (company?.settings as Record<string, any> | null)?.serviceTaxonomy;
		if (Array.isArray(custom) && custom.length) {
			return custom
				.filter((e) => e && typeof e.key === 'string')
				.map((e) => ({
					key: normalizeSubtopic(e.key) ?? e.key,
					label: String(e.label ?? e.key),
					parent: e.parent ? String(e.parent) : undefined,
					inactivityDays: Number(e.inactivityDays) > 0 ? Number(e.inactivityDays) : 90
				}));
		}
	} catch (err: any) {
		console.error('[subtopic] could not read the company taxonomy:', err?.message || err);
	}
	return DEFAULT_TAXONOMY;
}

// ── 2. Call tracking category — free ────────────────────────────────────────

/**
 * A tracking number already means a service ("the drain line"), so a call that came in on one is
 * classified without asking anybody. Matches on the key first, then the label, so a category
 * named "Drain Cleaning" still lands on `drain`.
 */
export function subtopicFromCategory(
	categoryName: string | null | undefined,
	taxonomy: TaxonomyEntry[]
): string | null {
	const name = (categoryName ?? '').trim().toLowerCase();
	if (!name) return null;

	const slug = normalizeSubtopic(name);
	const exact = taxonomy.find((t) => t.key === slug);
	if (exact) return exact.key;

	// Longest label first, so "water heater" wins over "heater" if both are present.
	const byLabel = [...taxonomy].sort((a, b) => b.label.length - a.label.length);
	for (const entry of byLabel) {
		const label = entry.label.toLowerCase();
		if (name.includes(label) || label.includes(name)) return entry.key;
	}
	for (const entry of byLabel) {
		if (name.includes(entry.key.replace(/_/g, ' '))) return entry.key;
	}
	return null;
}

/** Deterministic transcript seed used before the optional AI classifier. */
export function subtopicFromText(text: string | null | undefined): string | null {
	const value = (text ?? '').toLowerCase();
	if (/\bfurnace\b|no heat|heating system|air condition|\bhvac\b/.test(value)) return 'furnace';
	if (/blocked drain|clogged drain|\bdrain\b/.test(value)) return 'drain';
	if (/water heater|hot water tank/.test(value)) return 'water_heater';
	if (/\bplumb(?:ing|er)\b|burst pipe|leak(?:ing)? pipe/.test(value)) return 'plumbing';
	if (/\bbathroom\b/.test(value)) return 'bathroom';
	if (/\bkitchen\b/.test(value)) return 'kitchen';
	if (/\broof\b/.test(value)) return 'roof';
	if (/\belectrical\b|\bwiring\b/.test(value)) return 'electrical';
	return null;
}

// ── 3. Claude — the paid path ───────────────────────────────────────────────

export interface ClassifyInput {
	/** What the customer actually said or wrote — a voicemail transcript, an SMS, a form message. */
	text: string;
	/** Anything already known: the page they were on, the form's service field. */
	hints?: string[];
}

/**
 * Ask Claude which service this was about, constrained to the company's taxonomy.
 *
 * Returns null rather than guessing when the text does not say — an unknown tag is honest and is
 * scored separately; a wrong tag silently corrupts the per-subtopic scores and nobody notices.
 */
export async function classifySubtopicWithAI(
	input: ClassifyInput,
	taxonomy: TaxonomyEntry[]
): Promise<{ subtopic: string | null; confidence: 'low' | 'medium' | 'high' }> {
	const apiKey = ANTHROPIC_AI_KEY || process.env.ANTHROPIC_AI_KEY;
	if (!apiKey) {
		console.warn('[subtopic] ANTHROPIC_AI_KEY is not set — AI classification skipped');
		return { subtopic: null, confidence: 'low' };
	}

	const text = (input.text ?? '').trim();
	if (text.length < 4) return { subtopic: null, confidence: 'low' };

	const allowed = taxonomy.map((t) => t.key);
	const menu = taxonomy
		.map((t) => `  ${t.key} — ${t.label}${t.parent ? ` (part of ${t.parent})` : ''}`)
		.join('\n');

	const result = await claudeJSON<{
		subtopic: string | null;
		confidence: 'low' | 'medium' | 'high';
	}>({
		apiKey,
		model: CLAUDE_FAST,
		system:
			'You label a customer interaction with the trade service it is about, for a home-services ' +
			'contractor.\n\n' +
			'Rules:\n' +
			'- Choose exactly one key from the list, or null.\n' +
			'- Return null when the text does not clearly say which service. A wrong label is worse ' +
			'than no label: it is added to the customer record and scored.\n' +
			'- Label what the customer WANTS, not words that merely appear. "My kitchen tap is ' +
			'dripping" is plumbing, not a kitchen renovation.\n' +
			'- Prefer the most specific key that fits (furnace over hvac, bathroom over renovation).\n' +
			'- "emergency" describes urgency, not a trade. Only use it when no trade is identifiable ' +
			'and the text is plainly an emergency.\n' +
			'- "quote" is an intent, not a trade. Prefer the specific trade being quoted (e.g. plumbing, renovation, roof, etc.) whenever one is mentioned.',
		user:
			`Available services:\n${menu}\n\n` +
			(input.hints?.length ? `Context already known: ${input.hints.join(' · ')}\n\n` : '') +
			`Interaction:\n"""\n${text.slice(0, 4000)}\n"""`,
		schema: {
			type: 'object',
			properties: {
				subtopic: {
					type: ['string', 'null'],
					enum: [...allowed, null],
					description: 'The service key, or null if the text does not clearly say.'
				},
				confidence: { type: 'string', enum: ['low', 'medium', 'high'] }
			},
			required: ['subtopic', 'confidence'],
			additionalProperties: false
		},
		toolName: 'label_subtopic',
		temperature: 0,
		maxTokens: 256
	});

	if (!result) return { subtopic: null, confidence: 'low' };

	// Never trust the model past the allow-list, even with an enum in the schema.
	const key = result.subtopic ? normalizeSubtopic(result.subtopic) : null;
	if (!key || !allowed.includes(key)) return { subtopic: null, confidence: 'low' };

	// A low-confidence label is worth less than an honest unknown.
	if (result.confidence === 'low') return { subtopic: null, confidence: 'low' };

	return { subtopic: key, confidence: result.confidence };
}

/**
 * The whole ladder, cheapest rung first. `deterministic` is whatever intake already worked out
 * from the page address or payload — if that hit, nothing else runs and nothing is spent.
 */
export async function resolveSubtopic(args: {
	companyId: string;
	deterministic?: string | null;
	callTrackingCategory?: string | null;
	text?: string | null;
	hints?: string[];
}): Promise<{ subtopic: string | null; source: 'deterministic' | 'category' | 'ai' | 'unknown' }> {
	if (args.deterministic) return { subtopic: args.deterministic, source: 'deterministic' };

	const taxonomy = await companyTaxonomy(args.companyId);

	const fromCategory = subtopicFromCategory(args.callTrackingCategory, taxonomy);
	if (fromCategory) return { subtopic: fromCategory, source: 'category' };

	const fromText = subtopicFromText(args.text);
	if (fromText && taxonomy.some((entry) => entry.key === fromText)) {
		return { subtopic: fromText, source: 'deterministic' };
	}

	if (args.text && args.text.trim().length >= 4) {
		const ai = await classifySubtopicWithAI({ text: args.text, hints: args.hints }, taxonomy);
		if (ai.subtopic) return { subtopic: ai.subtopic, source: 'ai' };
	}

	return { subtopic: null, source: 'unknown' };
}
