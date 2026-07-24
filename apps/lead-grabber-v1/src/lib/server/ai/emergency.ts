export const EMERGENCY_KEYWORDS = [
	'burst',
	'flooding',
	'flood',
	'no heat',
	'no-heat',
	'gas',
	'gas leak',
	'sewage',
	'backing up',
	'water everywhere',
	'pipe burst',
	'leaking water',
	'fire',
	'carbon monoxide'
];

export interface EmergencyEvaluationResult {
	isEmergency: boolean;
	emergencySource: 'keyword' | 'ai' | 'both' | 'none' | 'processing_failure_default';
	keywordHits: string[];
	aiConfidence?: number;
	reasoning?: string;
}

export function evaluateEmergency(
	text: string | null | undefined,
	aiResult?: { isEmergency?: boolean; confidence?: number; reasoning?: string } | null,
	processingFailed = false
): EmergencyEvaluationResult {
	// Spec §1.8: Processing failure defaults to emergency
	if (processingFailed || text === null || text === undefined) {
		return {
			isEmergency: true,
			emergencySource: 'processing_failure_default',
			keywordHits: [],
			reasoning: 'Processing failure defaulted to emergency for safety'
		};
	}

	const textLower = text.toLowerCase();
	const keywordHits = EMERGENCY_KEYWORDS.filter((kw) => textLower.includes(kw));
	const keywordHit = keywordHits.length > 0;
	const aiHit = !!aiResult?.isEmergency;

	// Spec §1.8: emergency = keyword_hit OR ai_emergency. Never an average. Never AI overruling keyword.
	const isEmergency = keywordHit || aiHit;

	let emergencySource: EmergencyEvaluationResult['emergencySource'] = 'none';
	if (keywordHit && aiHit) {
		emergencySource = 'both';
	} else if (keywordHit) {
		emergencySource = 'keyword';
	} else if (aiHit) {
		emergencySource = 'ai';
	}

	return {
		isEmergency,
		emergencySource,
		keywordHits,
		aiConfidence: aiResult?.confidence,
		reasoning: aiResult?.reasoning
	};
}
