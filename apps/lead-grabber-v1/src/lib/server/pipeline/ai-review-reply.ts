import { env } from '$env/dynamic/private';
import { claudeText } from '$lib/server/anthropic';

export interface ReviewReplyDraftInput {
	review_text: string;
	rating: number;
	customer_name?: string;
	praise_topics?: string[];
	complaint_topics?: string[];
	business_name?: string;
	tone?: string;
	max_words?: number;
}

export async function generateReviewReplyDraft(input: ReviewReplyDraftInput, mockMode: boolean): Promise<string> {
	const apiKey = env.ANTHROPIC_AI_KEY;
	if (mockMode || !apiKey) {
		return `Dear ${input.customer_name || 'Customer'},\n\nThank you for the thoughtful review. We are glad the work met your expectations, and we appreciate the note about communication before the appointment. We are improving our scheduling updates and would love to serve you again.\n- ${input.business_name || 'The Team'}`;
	}

	const tone = input.tone || 'professional_friendly';
	const maxWords = input.max_words || 150;

	const prompt = [
		`Write a reply to a customer review for ${input.business_name || 'the business'}.`,
		input.customer_name ? `The customer's name is ${input.customer_name}. Address them directly in the greeting.` : 'Address the customer as "Valued Customer" or similar.',
		`Tone: ${tone}.`,
		`Max length: ${maxWords} words.`,
		`Rating: ${input.rating}.`,
		input.praise_topics?.length ? `Praise topics: ${input.praise_topics.join(', ')}` : '',
		input.complaint_topics?.length ? `Complaint topics: ${input.complaint_topics.join(', ')}` : '',
		`Review text: ${input.review_text}`
	].filter(Boolean).join('\n');

	const outputText = await claudeText({
		apiKey,
		system: 'You are a helpful assistant that writes concise, professional business review replies.',
		messages: [{ role: 'user', content: prompt }],
		temperature: 0.3,
		maxTokens: 400
	});

	return (outputText || '').trim();
}
