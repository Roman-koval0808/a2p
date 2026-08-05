// ClearSky Scheduled Intents — contact channel fallback (spec §11).
//
// Don't assume it's email. A follow-up can start from an email, a phone call, a
// voicemail or a form, and each one leaves us holding something different.
// Priority, exactly as the spec table orders it:
//
//   1. Customer-requested channel — overrides everything below.
//   2. His mobile → text.
//   3. His email → email.
//   4. However he originally got in touch (when that gives us a usable target).
//   5. A shared office/home landline → NOT a message. A job for the agent to ring.
//      Every landline caller who never gave a mobile or an email lands here, so
//      this is not an edge case.
//   6. Nothing usable → unreachable, and the agent is told.

export type ContactChannel = 'sms' | 'email' | 'voice';
export type ResolvedChannelOutcome = ContactChannel | 'manual_call' | 'unreachable';

export interface ContactChannelInput {
	/** A channel the customer explicitly asked for ("call", "email", "text"). */
	requestedChannel?: string | null;
	/** The channel the customer originally used to contact us. */
	originalChannel?: 'email' | 'sms' | 'voice' | 'web' | null;
	/** Original-channel target, when we have it (their email address / number). */
	originalTarget?: string | null;
	mobile?: string | null;
	email?: string | null;
	/** A shared office/home landline — never a message, only a person can ring it. */
	landline?: string | null;
}

export interface ResolvedContactChannel {
	outcome: ResolvedChannelOutcome;
	/** The destination (email address / phone number), when the outcome has one. */
	target?: string;
	reason: string;
}

/** Map the customer's own words for a channel to our channel vocabulary. */
export function parseRequestedChannel(
	channel: string | null | undefined
): ContactChannel | null {
	const c = (channel || '').toLowerCase();
	if (/\b(call|phone|ring|talk)\b/.test(c)) return 'voice';
	if (/\b(text|sms|message)\b/.test(c)) return 'sms';
	if (/\b(email|mail|write)\b/.test(c)) return 'email';
	return null;
}

export function resolveContactChannel(input: ContactChannelInput): ResolvedContactChannel {
	// 1. A channel the customer asked for wins — overriding their channel is the same
	//    mistake as repeating an arrival time a person already gave him (§6).
	const requested = parseRequestedChannel(input.requestedChannel);
	if (requested === 'sms' && input.mobile) return { outcome: 'sms', target: input.mobile, reason: 'requested_channel' };
	if (requested === 'email' && input.email) return { outcome: 'email', target: input.email, reason: 'requested_channel' };
	if (requested === 'voice') {
		// They asked to be CALLED. A cell number can be called (or texted as a fallback);
		// a landline cannot be automated — that is a job for a person (§11).
		if (input.mobile) return { outcome: 'voice', target: input.mobile, reason: 'requested_channel' };
		if (input.landline) return { outcome: 'manual_call', target: input.landline, reason: 'requested_voice_landline' };
		// No number at all. "Call" is often the customer saying THEY will call us ("I'll call
		// you in a couple of weeks") rather than asking for a callback — don't lose him over
		// the literal word: reach him on the channel he actually used (§11 fallback).
		if (input.originalChannel === 'email' && input.originalTarget) {
			return { outcome: 'email', target: input.originalTarget, reason: 'original_channel_voice_unavailable' };
		}
		if (input.originalChannel === 'sms' && input.originalTarget) {
			return { outcome: 'sms', target: input.originalTarget, reason: 'original_channel_voice_unavailable' };
		}
		return { outcome: 'unreachable', reason: 'requested_voice_no_number' };
	}
	if (requested) return { outcome: 'unreachable', reason: `requested_channel_unavailable:${requested}` };

	// 2. His mobile → text.
	if (input.mobile) return { outcome: 'sms', target: input.mobile, reason: 'mobile' };

	// 3. His email → email.
	if (input.email) return { outcome: 'email', target: input.email, reason: 'email' };

	// 4. However he got in touch — it's where he expects to hear from us — but only
	//    when that actually leaves us a usable target.
	if (input.originalChannel === 'email' && input.originalTarget) {
		return { outcome: 'email', target: input.originalTarget, reason: 'original_channel' };
	}
	if (input.originalChannel === 'sms' && input.originalTarget) {
		return { outcome: 'sms', target: input.originalTarget, reason: 'original_channel' };
	}
	if (input.originalChannel === 'web' && input.originalTarget) {
		return { outcome: 'email', target: input.originalTarget, reason: 'original_channel' };
	}

	// 5. Only a shared office/home landline → a person rings, nothing automated.
	if (input.landline) return { outcome: 'manual_call', target: input.landline, reason: 'landline_only' };

	// 6. Nothing usable → mark unreachable and tell the agent.
	return { outcome: 'unreachable', reason: 'no_contact_info' };
}
