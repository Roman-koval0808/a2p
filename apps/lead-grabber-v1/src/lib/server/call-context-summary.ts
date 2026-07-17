/**
 * Internal call-context summary — the corrected ACT-CALL-005 (T3.5).
 *
 * An automatic recap of the customer's own words for the rep to read before they
 * call back. NOT approval-gated: it originates no customer-facing content, it only
 * restates what's already on file, so it needs no human review.
 */
export interface CallContext {
	customerName?: string | null;
	phone?: string | null;
	summary?: string | null;
	requestedAction?: string | null;
	emergencyType?: string | null;
	serviceRequested?: string | null;
	verbatim?: string | null;
}

export function buildCallContextSummary(ctx: CallContext): string {
	const lines: string[] = [];
	lines.push(
		`Call context — ${ctx.customerName?.trim() || 'Unknown caller'}${ctx.phone ? ` (${ctx.phone})` : ''}`
	);
	if (ctx.summary) lines.push(`Summary: ${ctx.summary}`);
	if (ctx.serviceRequested) lines.push(`Service: ${ctx.serviceRequested}`);
	if (ctx.emergencyType) lines.push(`Emergency type: ${ctx.emergencyType}`);
	if (ctx.requestedAction) lines.push(`They asked for: ${ctx.requestedAction}`);
	if (ctx.verbatim) lines.push(`In their words: "${ctx.verbatim.trim()}"`);
	return lines.join('\n');
}
