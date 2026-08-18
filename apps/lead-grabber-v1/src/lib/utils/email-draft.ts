// Helpers for turning an AI-drafted email into a real one.
//
// The draft prompts ask the model to open with a "Subject:" line, because the
// subject has to come from the same reasoning that wrote the body. The model
// often formats it as markdown — `**Subject: Re: Furnace Noise**` — and the old
// parser only matched a bare `Subject:` at the start of a line. When it missed:
// the subject line stayed in the body (customers received a literal
// "**Subject: ...**" as the first thing they read) and the real header fell back
// to "Email Follow-up".
//
// The body then went into a text/html part with its newlines intact, which HTML
// collapses — so a four-paragraph reply arrived as one run-on block.

/**
 * A subject line in any of the shapes the models actually emit:
 *   Subject: Re: X   |   **Subject: Re: X**   |   **Subject:** Re: X   |   ### Subject: Re: X
 * Emphasis can close after the label or after the whole line, so it is allowed
 * in both places.
 */
const SUBJECT_LINE =
	/^\s*(?:\*{1,3}|_{1,2}|#{1,6}\s*)?\s*subject\s*(?:\*{1,3}|_{1,2})?\s*:\s*(?:\*{1,3}|_{1,2})?\s*(.+?)\s*$/i;

/** Trailing markdown emphasis left on the captured subject text. */
const TRAILING_EMPHASIS = /(\*{1,3}|_{1,2})\s*$/;

export interface SplitDraft {
	/** The subject the model wrote, or null when it didn't write one. */
	subject: string | null;
	/** The reply itself, with the subject line and any leading blank lines removed. */
	body: string;
}

/**
 * Separate the "Subject:" line from an AI-drafted email.
 *
 * Only looks at the first few lines: a "Subject:" appearing deep in the body is
 * the customer quoting something, not the model labelling its own draft.
 */
export function splitDraftSubject(draft: string | null | undefined): SplitDraft {
	const text = (draft || '').replace(/\r\n/g, '\n');
	if (!text.trim()) return { subject: null, body: '' };

	const lines = text.split('\n');
	const searchDepth = Math.min(lines.length, 5);

	for (let i = 0; i < searchDepth; i++) {
		const line = lines[i];
		if (!line.trim()) continue;

		const match = line.match(SUBJECT_LINE);
		if (match) {
			const subject = match[1].replace(TRAILING_EMPHASIS, '').replace(/^["']|["']$/g, '').trim();
			const rest = [...lines.slice(0, i), ...lines.slice(i + 1)];
			return { subject: subject || null, body: rest.join('\n').replace(/^\s*\n+/, '').trim() };
		}

		// The first non-blank line isn't a subject — the model wrote straight into
		// the body, so there's nothing to strip.
		break;
	}

	return { subject: null, body: text.trim() };
}

const HTML_ESCAPES: Record<string, string> = {
	'&': '&amp;',
	'<': '&lt;',
	'>': '&gt;',
	'"': '&quot;',
	"'": '&#39;'
};

function escapeHtml(s: string): string {
	return s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

/**
 * Render a plain-text draft as HTML that preserves how it was written:
 * blank-line-separated paragraphs stay paragraphs, single newlines (a sign-off
 * under a "Best regards,") stay line breaks, and **bold** renders as bold rather
 * than as literal asterisks.
 *
 * Content that is already HTML is passed through untouched, so this is safe to
 * apply to drafts from any source.
 */
export function draftBodyToHtml(body: string | null | undefined): string {
	const text = (body || '').replace(/\r\n/g, '\n').trim();
	if (!text) return '';
	if (/<(p|br|div|table|html|a|strong|em|ul|ol)\b/i.test(text)) return text;

	return text
		.split(/\n{2,}/)
		.map((paragraph) => {
			const html = escapeHtml(paragraph.trim())
				.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
				.replace(/\n/g, '<br>');
			return `<p>${html}</p>`;
		})
		.join('\n');
}
