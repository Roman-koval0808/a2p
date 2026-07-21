// Last-line-of-defence checks on AI-drafted customer replies.
//
// Both reply paths (the agentic skills reply and the fact-based conversational fallback) send
// their output VERBATIM to a real customer by SMS/email. A model occasionally emits something
// unsendable — narrating its own tool limitations, or leaving a fill-in-the-blank for a human.
// Prompt rules reduce that but never eliminate it, so we also check the finished text and
// discard it, letting the caller fall back to a deterministic reply.

/**
 * The model narrating its own limitations/reasoning instead of writing the SMS, e.g.
 * "I need to clarify: the customer said YES ... I don't have a tool to actually create ...".
 */
export function looksLikeLeakedReasoning(text: string): boolean {
	return (
		/\b(I don'?t have (a )?tool|I need to clarify|Suggested reply|the customer said|I should not invent|as an AI|I cannot (actually|create)|I appreciate you providing|the tools I have|from scratch)\b/i.test(
			text
		) ||
		// The model describing what it cannot perceive. Seen live on a call with no transcript:
		// "I understand you've left a voicemail, but I'm not able to listen to recordings through
		// text." The customer does not care what the assistant can process — that is our problem.
		/\b(not able to (listen|hear|access|play)|can'?t (listen to|hear|access|play)|unable to (listen|hear|access)|through text|I'?m not sure what you need help with)\b/i.test(
			text
		)
	);
}

/**
 * Fill-in-the-blank text the model left for a human: "[booking link will be provided]",
 * "<insert time>", "{name}", "link: TBD". A customer SMS never legitimately contains these
 * (real URLs use no brackets), so any hit means the draft is a template, not a message.
 */
export function hasUnfilledPlaceholder(text: string): boolean {
	return (
		/\[[^\]]{2,}\]/.test(text) || // [booking link will be provided if you confirm]
		/\{[^}]{2,}\}/.test(text) || // {name}
		/<[a-z][^>]{2,}>/i.test(text) || // <insert link>
		/\b(TBD|to be provided|will be provided|insert link|your link here)\b/i.test(text)
	);
}

/**
 * An emergency reply claiming something we have not actually done or do not know: that a crew is
 * en route, or a specific appointment/arrival time. When this fires the caller should fall back to
 * the honest template ("someone will call you back right away").
 *
 * Real example this catches: "our team is on the way to you now … You have an appointment at
 * 4:00 PM today" — no crew had been sent (the dispatch action was still awaiting approval) and no
 * appointment existed; the model invented both.
 *
 * NOTE: scoped to the AI-drafted emergency reply. The curated emergency SMS templates legitimately
 * describe dispatch as part of the business process and are not run through this.
 */
export function claimsUnverifiedDispatchOrTime(text: string): boolean {
	const enRoute =
		/\b(on (the|our|its|their) way|en ?route|has been dispatched|have been dispatched|we'?ve dispatched|is heading (out|over)|are heading (out|over)|crew will be there|will be there shortly|arriving shortly)\b/i;
	const apptTime =
		/\b(you have an appointment|your appointment is|appointment at|be there (at|by)|arrive (at|by)|scheduled for)\b/i;
	return enRoute.test(text) || apptTime.test(text);
}

/** True when a drafted reply must NOT be sent as-is. */
export function isUnsendableDraft(text: string | null | undefined): boolean {
	const t = (text || '').trim();
	if (!t) return false;
	return looksLikeLeakedReasoning(t) || hasUnfilledPlaceholder(t);
}
