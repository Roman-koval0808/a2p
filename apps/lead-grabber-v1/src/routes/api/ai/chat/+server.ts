import { json, type RequestHandler } from '@sveltejs/kit';
import { ANTHROPIC_AI_KEY } from '$env/static/private';
import { prisma } from '$lib/db';
import { claudeText, type ClaudeMessage } from '$lib/server/anthropic';
import mammoth from 'mammoth';

/**
 * Knowledge-base chat for a viewroom, ported from the standalone viewroom app.
 *
 * Deliberate differences from the original:
 *   * It answers with Claude through `$lib/server/anthropic`, the AI layer the rest of a2p already
 *     uses, instead of calling OpenAI `gpt-3.5-turbo` directly. Porting the OpenAI call verbatim
 *     would have added a second provider and a second API key for one endpoint.
 *   * The assistant lookup is scoped to the room's owning company. The original matched any
 *     assistant whose `viewroomConnections` contained the room name, which in a multi-tenant
 *     database would let one tenant's room be answered from another tenant's knowledge base.
 *   * The extracted context is capped. An unbounded knowledge base would otherwise be pasted into
 *     every request until the model rejected it.
 *
 * This route is intentionally unauthenticated: visitors in a viewroom are anonymous. It is
 * therefore careful to read only the assistant attached to the room it was asked about.
 */

/** Total characters of knowledge-base text sent with a question. */
const MAX_CONTEXT_CHARS = 60_000;
/** Per-file cap, so one large document cannot crowd out every other file. */
const MAX_FILE_CHARS = 20_000;

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

async function extractText(
	fileRecord: { id: string; title: string; type: string; file: string },
	customFetch: typeof fetch
): Promise<string> {
	if (!fileRecord.file) return '';
	try {
		const res = await customFetch(fileRecord.file);
		if (!res.ok) {
			console.error(`[ai-chat] could not fetch ${fileRecord.title}: ${res.status}`);
			return '';
		}
		const buffer = await res.arrayBuffer();

		let text: string;
		if (fileRecord.type === 'application/pdf') {
			const pdfjsLib: any = await import('pdfjs-dist');
			const getDocument = pdfjsLib.getDocument ?? pdfjsLib.default?.getDocument;
			const doc = await getDocument({ data: new Uint8Array(buffer) }).promise;
			const pages: string[] = [];
			for (let i = 1; i <= doc.numPages; i++) {
				const content = await (await doc.getPage(i)).getTextContent();
				pages.push(content.items.map((item: any) => item.str ?? '').join(' '));
			}
			text = pages.join('\n');
		} else if (fileRecord.type === DOCX) {
			const { value } = await mammoth.extractRawText({ buffer: Buffer.from(buffer) });
			text = value;
		} else {
			text = new TextDecoder().decode(buffer);
		}
		return text.slice(0, MAX_FILE_CHARS);
	} catch (error) {
		console.error(`[ai-chat] failed to read ${fileRecord.id}:`, error);
		return '';
	}
}

const FALLBACK_PROMPT =
	"You are a helpful assistant. Answer the user's questions based on the context provided. " +
	"If the context does not contain the answer, say that you don't know.";

export const POST: RequestHandler = async ({ request, fetch }) => {
	const apiKey = ANTHROPIC_AI_KEY || process.env.ANTHROPIC_AI_KEY;
	if (!apiKey?.trim()) {
		console.error('[ai-chat] ANTHROPIC_AI_KEY is not set');
		return json({ error: 'AI is not configured' }, { status: 503 });
	}

	const { messages, roomId, roomName } = await request.json().catch(() => ({}) as any);
	if (!Array.isArray(messages) || messages.length === 0) {
		return json({ error: 'messages must be a non-empty array' }, { status: 400 });
	}

	let systemPrompt = FALLBACK_PROMPT;
	let context = '';

	// Resolve the room first so the assistant lookup can be scoped to its owner.
	const room = roomId
		? await prisma.viewRoom
				.findUnique({ where: { id: roomId }, select: { ownerCompanyId: true } })
				.catch(() => null)
		: null;

	const roomKey = roomName || roomId;
	if (roomKey) {
		const assistant = await prisma.aiAssistant.findFirst({
			where: {
				status: true,
				viewroomConnections: { has: roomKey },
				...(room?.ownerCompanyId ? { companyId: room.ownerCompanyId } : {})
			}
		});

		if (assistant) {
			systemPrompt =
				assistant.systemPrompt?.trim() ||
				`You are ${assistant.name}, a helpful assistant. Answer the user's questions based on ` +
					"the context provided. If the context does not contain the answer, say that you don't know.";

			if (assistant.trainingFiles.length) {
				const files = await prisma.contentLibraryItem.findMany({
					where: { id: { in: assistant.trainingFiles }, ownerCompanyId: assistant.companyId },
					select: { id: true, title: true, type: true, file: true }
				});
				for (const file of files) {
					if (context.length >= MAX_CONTEXT_CHARS) break;
					const text = await extractText(file, fetch);
					if (text) context += `\n\n--- ${file.title} ---\n${text}`;
				}
				context = context.slice(0, MAX_CONTEXT_CHARS);
			}
		}
	}

	const system = context
		? `${systemPrompt}\n\nHere is the context:\n${context}`
		: `${systemPrompt}\n\nNo reference material is available for this room.`;

	const history: ClaudeMessage[] = messages
		.filter((m: any) => m && typeof m.content === 'string' && m.content.trim())
		.map((m: any) => ({
			role: m.role === 'assistant' ? 'assistant' : 'user',
			content: m.content
		}));

	const reply = await claudeText({ apiKey, system, messages: history, maxTokens: 1024 });
	if (reply === null) {
		return json({ error: 'The assistant could not answer right now' }, { status: 502 });
	}

	// Shaped like a chat message so the ported UI can render it unchanged.
	return json({ role: 'assistant', content: reply });
};
