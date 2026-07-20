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
	return /\b(I don'?t have (a )?tool|I need to clarify|Suggested reply|the customer said|I should not invent|as an AI|I cannot (actually|create)|I appreciate you providing|the tools I have|from scratch)\b/i.test(
		text
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

/** True when a drafted reply must NOT be sent as-is. */
export function isUnsendableDraft(text: string | null | undefined): boolean {
	const t = (text || '').trim();
	if (!t) return false;
	return looksLikeLeakedReasoning(t) || hasUnfilledPlaceholder(t);
}
