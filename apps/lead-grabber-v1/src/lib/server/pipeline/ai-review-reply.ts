import { env } from '$env/dynamic/private';
import { claudeText } from '$lib/server/anthropic';

/**
 * Shared order-taker system prompt for approval-lane draft writers.
 *
 * The system is an ORDER TAKER, not a booking agent: it acknowledges what the
 * customer said and confirms the business is ready to help. It never asks
 * questions, never asks for availability, and never assumes more than the
 * customer said. All draft-writing handlers (review reply, callback script,
 * email reply) share this single source of truth.
 */
export function getOrderTakerSystemPrompt(businessName: string, brandTone: string): string {
	return `You are drafting a reply on behalf of ${businessName}.
Brand tone: ${brandTone}.

YOUR ROLE: You are an order taker, not a booking agent.

RULES:
- NEVER ask a question in the reply
- NEVER ask for availability, dates, or times
- NEVER ask the customer to do anything
- NEVER say 'We received your booking request' unless they booked
- NEVER assume more than what the customer said
- Keep the reply under 4 sentences
- Sound like a real person wrote this

The customer has already told you what they need.
Your reply confirms you heard them. Nothing more.`;
}

export interface ReviewReplyDraftInput {
	review_text: string;
	rating: number;
	customer_name?: string;
	praise_topics?: string[];
	complaint_topics?: string[];
	business_name?: string;
	tone?: string;
	max_words?: number;
	ai_summary?: string;
	platform?: string;
}

export async function generateReviewReplyDraft(
	input: ReviewReplyDraftInput,
	mockMode: boolean
): Promise<string> {
	const apiKey = env.ANTHROPIC_AI_KEY;
	if (mockMode || !apiKey) {
		return `Dear ${input.customer_name || 'Customer'},\n\nThank you for the thoughtful review. We are glad the work met your expectations, and we appreciate the note about communication before the appointment. We are improving our scheduling updates and would love to serve you again.\n- ${input.business_name || 'The Team'}`;
	}

	const tone = input.tone || 'professional_friendly';
	const maxWords = input.max_words || 150;
	const businessName = input.business_name || 'the business';

	const prompt = [
		`Write a public reply to a customer review for ${businessName}.`,
		input.customer_name
			? `The customer's name is ${input.customer_name}. Address them directly in the greeting.`
			: 'Address the customer as "Valued Customer" or similar.',
		input.platform ? `The review was left on ${input.platform}.` : '',
		`Rating: ${input.rating}.`,
		input.praise_topics?.length ? `Praise topics: ${input.praise_topics.join(', ')}` : '',
		input.complaint_topics?.length ? `Complaint topics: ${input.complaint_topics.join(', ')}` : '',
		input.ai_summary ? `AI summary of the review: ${input.ai_summary}` : '',
		`Review text: ${input.review_text}`,
		`Max length: ${maxWords} words.`
	]
		.filter(Boolean)
		.join('\n');

	const outputText = await claudeText({
		apiKey,
		system: getOrderTakerSystemPrompt(businessName, tone),
		messages: [{ role: 'user', content: prompt }],
		temperature: 0.3,
		maxTokens: 400
	});

	return (outputText || '').trim();
}
