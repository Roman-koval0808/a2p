import OpenAI from 'openai';
import { env } from '$env/dynamic/private';
import { z } from 'zod';

export const ExtractionResultSchema = z.object({
	contains_problem: z.boolean().describe("True if the customer mentions a specific issue, complaint, or problem with service."),
	contains_quote_request: z.boolean().describe("True if the customer is asking for a price, quote, estimate, or bid."),
	contains_callback_request: z.boolean().describe("True if the customer explicitly asks to be called back or contacted via phone."),
	contains_emergency_keywords: z.boolean().describe("True if keywords like 'leak', 'flood', 'no power', 'dangerous', 'emergency' are present."),
	requested_contact_method: z.enum(['phone', 'email', 'text', 'none']).describe("The preferred contact method mentioned by the customer."),
	requested_action: z.string().describe("The primary action requested by the customer (e.g., 'phone_call', 'send_quote', 'complaint_resolution')."),
	detected_keywords: z.array(z.string()).describe("A list of relevant technical or business keywords found in the text."),
	service_requested: z.string().describe("The specific service mentioned (e.g., 'roof repair', 'electrical')."),
	sentiment: z.enum(['positive', 'neutral', 'negative']),
	praise_topics: z.array(z.string()),
	complaint_topics: z.array(z.string()),
	summary: z.string(),
	confidence_score: z.number().min(0).max(1),
	urgency_level: z.enum(['low', 'medium', 'high']).describe("Use booleans for decision logic. For extraction, set 'high' only if multiple urgency booleans are true."),
	customer_name: z.string().nullable().describe("The name of the customer if explicitly mentioned in message, e.g. 'sam' from 'sam here', otherwise null"),
	has_name: z.boolean().describe("True if customer name is explicitly mentioned, otherwise false")
});

export type ExtractionResult = z.infer<typeof ExtractionResultSchema>;

let _openai: OpenAI | null = null;
function getOpenAIClient(): OpenAI {
	const apiKey = env.OPENAI_API_KEY;
	if (!apiKey) throw new Error('Missing OPENAI_API_KEY');
	if (_openai) return _openai;
	_openai = new OpenAI({ apiKey, timeout: 12000, maxRetries: 0 });
	return _openai;
}

export const AI_EXTRACTION_PROTOCOL = {
	name: 'clearsky_extraction',
	description: 'Semantic parser for home services business facts.',
	fields_to_extract: {
		contains_problem: "boolean (True if issue/complaint mentioned)",
		contains_quote_request: "boolean (True if asking for price/estimate)",
		contains_callback_request: "boolean (True if explicitly asking for a phone call back)",
		contains_emergency_keywords: "boolean (True if words like leak, flood, dangerous present)",
		requested_contact_method: "string (phone, email, text, or none)",
		requested_action: "string (phone_call, send_quote, info_request, etc)",
		detected_keywords: "array (quote, call, leak, pricing, etc)",
		service_requested: "string (specific service mentioned)",
		sentiment: "string (positive, neutral, negative)",
		praise_topics: "array (concise praise phrases)",
		complaint_topics: "array (concise complaint phrases)",
		summary: "string (one-sentence summary)",
		confidence_score: "number (0 to 1)",
		customer_name: "string (the name of the customer if explicitly mentioned, otherwise null)",
		has_name: "boolean (true if customer name is explicitly mentioned, otherwise false)"
	}
};

export async function performAiExtraction(text: string): Promise<ExtractionResult & { _protocol?: any }> {
	let extraction: any = null;
	let useFallback = false;

	try {
		const openai = getOpenAIClient();
		if (!openai) {
			useFallback = true;
		} else {
			const systemPrompt = `You are a semantic parser for a home services business. Your job is to extract raw facts from customer messages (SMS, reviews, voicemails).
            
Do NOT make business decisions. Do NOT decide if something is 'Critical' or 'Important'. 
Instead, return specific booleans and factual fields based on the content of the message.

Fields:
- contains_problem: Is there a complaint or issue mentioned?
- contains_quote_request: Is the customer asking for pricing or an estimate?
- contains_callback_request: Does the customer want a phone call back?
- contains_emergency_keywords: Does the text contain words like leak, flood, dangerous, emergency, broken, fire, etc?
- requested_contact_method: What specific contact method did they ask for?
- requested_action: What is the single most important action the customer wants us to take?
- detected_keywords: List all important nouns/verbs related to business (e.g. quote, call, roof, leak, pricing). If the user mentions their name, include it here.
- customer_name: The name of the customer if explicitly mentioned in message, e.g. 'sam' from 'sam here', otherwise null.
- has_name: True if customer name is explicitly mentioned in message, otherwise false.

For 'complaint_topics' and 'praise_topics': Use concise phrases. 
CRITICAL: If the communication mentions ANY safety concerns or dangerous behavior, include 'safety_violation' in complaint_topics.

Urgency mapping (Internal hint): 
Set urgency_level to 'high' ONLY if contains_emergency_keywords is true OR (contains_quote_request is true AND contains_callback_request is true).`;

			const response = await openai.responses.parse({
				model: env.OPENAI_MODEL || 'gpt-4o-mini',
				input: [
					{ role: 'system', content: systemPrompt },
					{ role: 'user', content: text }
				],
				temperature: 0,
				text: {
					format: {
						type: 'json_schema',
						name: AI_EXTRACTION_PROTOCOL.name,
						strict: true,
						schema: {
							type: 'object',
							additionalProperties: false,
							required: [
								'contains_problem',
								'contains_quote_request',
								'contains_callback_request',
								'contains_emergency_keywords',
								'requested_contact_method',
								'requested_action',
								'detected_keywords',
								'service_requested',
								'sentiment',
								'praise_topics',
								'complaint_topics',
								'summary',
								'confidence_score',
								'urgency_level',
								'customer_name',
								'has_name'
							],
							properties: {
								contains_problem: { type: 'boolean' },
								contains_quote_request: { type: 'boolean' },
								contains_callback_request: { type: 'boolean' },
								contains_emergency_keywords: { type: 'boolean' },
								requested_contact_method: { type: 'string', enum: ['phone', 'email', 'text', 'none'] },
								requested_action: { type: 'string' },
								detected_keywords: { type: 'array', items: { type: 'string' } },
								service_requested: { type: 'string' },
								sentiment: { type: 'string', enum: ['positive', 'neutral', 'negative'] },
								praise_topics: { type: 'array', items: { type: 'string' } },
								complaint_topics: { type: 'array', items: { type: 'string' } },
								summary: { type: 'string' },
								confidence_score: { type: 'number' },
								urgency_level: { type: 'string', enum: ['low', 'medium', 'high'] },
								customer_name: { type: ['string', 'null'] },
								has_name: { type: 'boolean' }
							}
						}
					}
				}
			});

			const parsed = (response as any).output_parsed;
			extraction = ExtractionResultSchema.parse(parsed);
		}
	} catch (err) {
		console.warn('OpenAI extraction failed, falling back to heuristics:', err);
		useFallback = true;
	}

	if (useFallback || !extraction) {
		const lowerText = text.toLowerCase();
		const hasProblem =
			lowerText.includes('leak') ||
			lowerText.includes('died') ||
			lowerText.includes('slow') ||
			lowerText.includes('problem') ||
			lowerText.includes('complaint') ||
			lowerText.includes('mess');
		const hasQuote =
			lowerText.includes('quote') ||
			lowerText.includes('price') ||
			lowerText.includes('estimate') ||
			lowerText.includes('new roof') ||
			lowerText.includes('cost');
		const hasCallback =
			lowerText.includes('call me back') ||
			lowerText.includes('callback') ||
			lowerText.includes('phone');
		const hasEmergency =
			lowerText.includes('urgent') ||
			lowerText.includes('asap') ||
			lowerText.includes('emergency') ||
			lowerText.includes('water');

		// Helper function to extract name from text
		const extractNameFromText = (content: string): string | null => {
			if (!content) return null;
			const clauses = content.split(/[.,\/#!$%\^&\*;:{}=\-_`~()\n?]/);
			const patterns = [
				/(?:I'm|I am)\s+(?:new\s+customer,\s+)?([A-Za-z]+)/i,
				/this is\s+([a-zA-Z]+(?:\s+[a-zA-Z]+)?)/i,
				/my name is\s+([a-zA-Z]+(?:\s+[a-zA-Z]+)?)/i,
				/([a-zA-Z]+(?:\s+[a-zA-Z]+)?)\s+here/i,
				/([a-zA-Z]+(?:\s+[a-zA-Z]+)?)\s+speaking/i
			];
			const blacklist = ['a', 'the', 'an', 'some', 'someone', 'here', 'speaking', 'there', 'just', 'please', 'we', 'you', 'they', 'our', 'my', 'your', 'about', 'not', 'this', 'is', 'am', 'hello', 'hi', 'good', 'morning', 'afternoon', 'evening'];
			
			for (const clause of clauses) {
				const trimmedClause = clause.trim();
				for (const pattern of patterns) {
					const match = trimmedClause.match(pattern);
					if (match && match[1]) {
						const candidate = match[1].trim();
						const words = candidate.split(/\s+/);
						const validWords = words.filter(w => !blacklist.includes(w.toLowerCase()));
						if (validWords.length > 0) {
							return validWords.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
						}
					}
				}
			}
			return null;
		};

		const parsedName = extractNameFromText(text);

		extraction = {
			contains_problem: hasProblem,
			contains_quote_request: hasQuote,
			contains_callback_request: hasCallback,
			contains_emergency_keywords: hasEmergency,
			requested_contact_method: hasCallback ? 'phone' : 'none',
			requested_action: hasEmergency
				? 'emergency_dispatch'
				: hasQuote
					? 'send_quote'
					: 'info_request',
			detected_keywords: hasEmergency ? ['Emergency', 'Water'] : ['quote', 'call'],
			service_requested: hasEmergency ? 'Plumbing' : (hasQuote ? 'New Roof Quote' : 'Support'),
			sentiment: hasEmergency ? 'concerned' : (hasProblem
				? 'negative'
				: lowerText.includes('great') || lowerText.includes('incredible')
					? 'positive'
					: 'neutral'),
			praise_topics:
				lowerText.includes('great') || lowerText.includes('incredible')
					? ['service', 'quality']
					: [],
			complaint_topics: hasProblem ? ['communication'] : [],
			summary: text.slice(0, 100),
			confidence_score: 0.95,
			urgency_level: hasEmergency ? 'high' : hasQuote ? 'medium' : 'low',
			customer_name: parsedName,
			has_name: parsedName !== null
		};
	}

	return {
		...extraction,
		_protocol: {
			message: text,
			fields_to_extract: AI_EXTRACTION_PROTOCOL.fields_to_extract,
			raw_response: extraction
		}
	};
}
