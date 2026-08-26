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

/**
 * Extracts the specific subject or item being quoted from customer text, reason, or summary.
 * E.g. "price estimate on a plumbing pipe renovation" -> "Plumbing pipe renovation"
 */
export function extractQuoteSubject(text: string | null | undefined): string | null {
	if (!text) return null;
	const cleaned = text.replace(/[\r\n]+/g, ' ').trim();

	const patterns = [
		/(?:quote|price estimate|estimate|bid|pricing|cost)\s+(?:for|on|about|regarding)\s+(?:a|an|the|our|some)?\s*([^.,;!?:()]+?)(?:\s+(?:but|with|and|so|before|after|which|that|for|as|in\s+order)\b|[.,;!?:()]|$)/i,
		/(?:wants|want|looking for|requesting|asking for|need|needs)\s+(?:a\s+quote\s+(?:for|on)|an\s+estimate\s+(?:for|on)|pricing\s+(?:for|on))\s+(?:a|an|the)?\s*([^.,;!?:()]+?)(?:\s+(?:but|with|and|so|before|after|which|that|for|as)\b|[.,;!?:()]|$)/i,
		/(?:quote|estimate|bid)\s+request\s+(?:for|on|about)\s+(?:a|an|the)?\s*([^.,;!?:()]+?)(?:\s+(?:but|with|and|so|before|after|which|that)\b|[.,;!?:()]|$)/i,
		/(?:interested in|inquiring about)\s+(?:a\s+quote\s+for|pricing\s+for)?\s*(?:a|an|the)?\s*([^.,;!?:()]+?)(?:\s+(?:quote|estimate|pricing)\b)/i
	];

	for (const pattern of patterns) {
		const match = cleaned.match(pattern);
		if (match && match[1]) {
			let subject = match[1].trim();
			// Strip leading fluff
			subject = subject.replace(/^(?:a|an|the|my|our|some|getting|getting\s+a)\s+/i, '');
			// Strip trailing filler words
			subject = subject.replace(/\s+(?:project|job|work|service|installed|done)$/i, (m) => m);
			// Validate length (between 3 and 50 characters, at most 6 words)
			const words = subject.split(/\s+/).filter(Boolean);
			if (subject.length >= 3 && subject.length <= 50 && words.length <= 6) {
				return subject.charAt(0).toUpperCase() + subject.slice(1);
			}
		}
	}
	return null;
}

/**
 * Turns a detailed AI reason or summary into a concise, human-readable intent description.
 */
export function extractConciseIntent(text: string | null | undefined): string | null {
	if (!text) return null;
	const t = text.trim();
	if (!t || t.startsWith('🔥') || t.startsWith('🚨')) return null;

	// Common inquiry patterns
	if (/hours|schedule|open|closing|when\s+are\s+you/i.test(t)) {
		return 'Inquiry: Business Hours';
	}
	if (/billing|invoice|payment|charge|balance|receipt/i.test(t)) {
		return 'Billing Inquiry';
	}
	if (/test\s*drive|vehicle|car\s+purchase/i.test(t)) {
		return 'Vehicle Purchase / Test Drive';
	}
	if (/callback|call\s*back/i.test(t)) {
		return 'Callback Request';
	}

	return null;
}

/**
 * Produces a human-readable, descriptive intent line for communication logs.
 * Never outputs a bare single word like "Quote", "Sales", "Support", "General", "Emergency".
 */
export function formatDescriptiveIntent(comm: any): string | null {
	if (!comm) return null;
	const meta = comm.raw?.metadata || comm.metadata || {};
	const ai = meta.ai_intent || {};

	// 1. Dropped call / Missed call
	if (comm.raw?.isDropCall || comm.isDropCall) {
		const dur = meta.duration ? ` (${Math.round(meta.duration)}s)` : '';
		return `Dropped Call${dur}`;
	}
	if (meta.drop_call) return 'Missed Call';

	// 2. Pending approval confirmations
	if (comm.purpose === 'Confirm Email' || comm.purpose === 'Confirm') {
		return comm.purpose === 'Confirm Email' ? 'Confirm Email' : 'Confirm Call';
	}

	// 3. Extract key pieces of evidence
	const rawSubtopic =
		(comm.intentSubtopic || comm.subtopic || comm.raw?.subtopic || meta.subtopic || '')
			.toString()
			.trim()
			.toLowerCase() || null;
	const subjectLabel = subtopicLabel(rawSubtopic);
	const serviceRequested = (
		meta.service_requested ||
		ai.service ||
		meta.service ||
		''
	)
		.toString()
		.trim();
	const subIntent = (meta.sub_intent || '').toString().trim();
	const emergencyType = (meta.emergency_type || '').toString().trim();
	const purpose = (comm.purpose || '').toString().trim();
	const messageCategory = (meta.message_category || '').toString().trim().toLowerCase();
	const categoryGpt = (meta.category_gpt || '').toString().trim().toLowerCase();
	const ivrIntent = (meta.ivr_intent || '').toString().trim();
	const intentTag = (meta.intent || '').toString().trim().toLowerCase();
	const aiReason = (ai.reason || '').toString().trim();
	const content = (comm.raw?.content || comm.content || '').toString().trim();
	const summary = (comm.summary || comm.raw?.summary || '').toString().trim();

	// Check if this is a quote / estimate request
	const isQuote =
		rawSubtopic === 'quote' ||
		intentTag === 'quote' ||
		subIntent.toLowerCase().includes('quote') ||
		subIntent.toLowerCase().includes('estimate') ||
		categoryGpt === 'quote' ||
		messageCategory === 'quote' ||
		purpose.toLowerCase().includes('quote') ||
		meta.contains_quote_request === true ||
		ai.purpose === 'quote' ||
		ai.opportunity === 'quote' ||
		/quote|estimate|bid|pricing|how\s+much/i.test(content || summary);

	// Check if this is an emergency
	const isEmergency =
		comm.intentEmergency ||
		messageCategory === 'emergency' ||
		categoryGpt === 'emergency' ||
		intentTag === 'emergency' ||
		purpose === 'Urgent Support' ||
		ai.urgency === 'critical' ||
		!!emergencyType;

	// Check if this is a booking / appointment
	const isBooking =
		ai.purpose === 'booking' ||
		ai.wants_appointment === true ||
		subIntent.toLowerCase().includes('booking') ||
		subIntent.toLowerCase().includes('test drive') ||
		subIntent.toLowerCase().includes('appointment') ||
		/book|appointment|schedule/i.test(content || summary);

	// --- A. Emergency handling ---
	if (isEmergency) {
		if (emergencyType) {
			const cleanType = emergencyType.replace(/[_-]+/g, ' ');
			return `Emergency: ${cleanType.charAt(0).toUpperCase() + cleanType.slice(1)}`;
		}
		if (
			subjectLabel &&
			subjectLabel !== 'Emergency call-out' &&
			subjectLabel !== 'Quote request' &&
			subjectLabel !== 'Not stated'
		) {
			return `Emergency: ${subjectLabel}`;
		}
		if (serviceRequested) {
			return `Emergency: ${serviceRequested.charAt(0).toUpperCase() + serviceRequested.slice(1)}`;
		}
		return 'Emergency Service Call';
	}

	// --- B. Quote handling ---
	if (isQuote) {
		// Specific service or product requested for the quote
		if (serviceRequested && !serviceRequested.toLowerCase().includes('quote')) {
			return `Quote: ${serviceRequested.charAt(0).toUpperCase() + serviceRequested.slice(1)}`;
		}
		if (
			subjectLabel &&
			subjectLabel !== 'Quote request' &&
			subjectLabel !== 'Emergency call-out' &&
			subjectLabel !== 'Not stated'
		) {
			return `Quote: ${subjectLabel}`;
		}
		if (
			subIntent &&
			subIntent.toLowerCase() !== 'quote' &&
			subIntent.toLowerCase() !== 'quote request' &&
			subIntent.toLowerCase() !== 'sales' &&
			subIntent.toLowerCase() !== 'opportunity'
		) {
			const cleanSub = subIntent.replace(/^quote\s*[:-]?\s*/i, '');
			return `Quote: ${cleanSub.charAt(0).toUpperCase() + cleanSub.slice(1)}`;
		}
		// Try to extract quote subject from reason, summary, or content
		const quoteSubject = extractQuoteSubject(aiReason || summary || content);
		if (quoteSubject) {
			return `Quote: ${quoteSubject}`;
		}
		return 'Quote Request';
	}

	// --- C. Detailed sub_intent & Concise intent extraction ---
	const concise = extractConciseIntent(aiReason || summary || content);
	if (concise) return concise;

	if (
		subIntent &&
		subIntent.toLowerCase() !== 'general' &&
		subIntent.toLowerCase() !== 'sales' &&
		subIntent.toLowerCase() !== 'support' &&
		subIntent.toLowerCase() !== 'quote' &&
		subIntent.toLowerCase() !== 'opportunity'
	) {
		return subIntent;
	}

	// --- D. Booking handling ---
	if (isBooking) {
		if (subjectLabel && subjectLabel !== 'Not stated' && subjectLabel !== 'Quote request') {
			return `Booking: ${subjectLabel}`;
		}
		if (serviceRequested) {
			return `Booking: ${serviceRequested.charAt(0).toUpperCase() + serviceRequested.slice(1)}`;
		}
		return 'Appointment Booking';
	}

	// --- E. Subject + Purpose combining ---
	if (subjectLabel && subjectLabel !== 'Not stated' && subjectLabel !== 'Quote request') {
		const purposeAdds =
			purpose &&
			purpose !== 'General' &&
			purpose !== 'See Summary' &&
			purpose !== 'Urgent Support' &&
			purpose !== 'Quote' &&
			purpose !== 'Sales' &&
			purpose !== 'Support' &&
			purpose.toLowerCase() !== subjectLabel.toLowerCase();
		if (purposeAdds) {
			return `${subjectLabel} · ${purpose}`;
		}
		return subjectLabel;
	}

	// --- F. Service requested / category / IVR intent fallback ---
	if (serviceRequested) {
		return serviceRequested.charAt(0).toUpperCase() + serviceRequested.slice(1);
	}
	if (ivrIntent && ivrIntent.toLowerCase() !== 'unknown' && ivrIntent.toLowerCase() !== 'direct') {
		return `Inquiry: ${ivrIntent.charAt(0).toUpperCase() + ivrIntent.slice(1)}`;
	}

	// --- G. Clean up generic purpose ---
	if (
		purpose &&
		purpose !== 'General' &&
		purpose !== 'See Summary' &&
		purpose !== 'Quote' &&
		purpose !== 'Sales' &&
		purpose !== 'Support'
	) {
		return purpose;
	}

	if (messageCategory === 'sales' || intentTag === 'sales' || intentTag === 'opportunity') return 'Sales Opportunity';
	if (messageCategory === 'support' || intentTag === 'support') return 'Support Inquiry';
	if (messageCategory === 'billing' || intentTag === 'billing') return 'Billing Inquiry';

	if (summary && summary.length < 50 && !summary.startsWith('🔥') && !summary.startsWith('🚨')) {
		return summary;
	}

	return 'General Inquiry';
}

