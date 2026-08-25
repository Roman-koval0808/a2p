import { describe, it, expect } from 'vitest';
import { channelForEventType } from './telemetry';

describe('channelForEventType — bucket promotions keep their real channel', () => {
	it('a voicemail promotion is voice, not viewroom', () => {
		// The reported bug: an emergency voicemail promoted the profile to Active and the log
		// showed "Viewroom IN" for a caller who never opened a viewroom.
		expect(channelForEventType('voicemail_received')).toBe('voice');
		expect(channelForEventType('call.dtmf.received')).toBe('voice');
	});

	it('an actual viewroom event is still viewroom', () => {
		expect(channelForEventType('vr_entry')).toBe('viewroom');
		expect(channelForEventType('viewroom_entered')).toBe('viewroom');
	});

	it('maps the other channels', () => {
		expect(channelForEventType('leadbox_submit')).toBe('leadbox');
		expect(channelForEventType('callback_submit')).toBe('leadbox');
		expect(channelForEventType('lg_submit')).toBe('leadform');
		expect(channelForEventType('sms_received')).toBe('sms');
		expect(channelForEventType('email_opened')).toBe('email');
		expect(channelForEventType('chat_open')).toBe('chatbot');
	});

	it('falls back to web for page signals and anything unknown', () => {
		expect(channelForEventType('page_load')).toBe('web');
		expect(channelForEventType('scroll_50')).toBe('web');
		expect(channelForEventType(null)).toBe('web');
	});
});
