import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PipelineSimulator } from '../src/lib/server/pipeline-simulator';

const mockFetch = vi.fn();
const mockPrismaMessageFindFirst = vi.fn();
const mockPrismaMessageUpdate = vi.fn();
const mockPrismaMessageCreate = vi.fn();
const mockPrismaCompanyPhoneNumberFindUnique = vi.fn();
const mockCreateOrUpdateContact = vi.fn();
const mockLogCommunication = vi.fn();
const mockSendOwnerSmsAlert = vi.fn();

vi.mock('$env/static/private', () => ({
	TELNYX_API_KEY: 'test-telnyx-key'
}));

vi.mock('$env/static/public', () => ({
	PUBLIC_BASE_URL: 'https://app.test'
}));

vi.mock('$lib/db', () => ({
	prisma: {
		message: {
			findFirst: (...args: unknown[]) => mockPrismaMessageFindFirst(...args),
			update: (...args: unknown[]) => mockPrismaMessageUpdate(...args),
			create: (...args: unknown[]) => mockPrismaMessageCreate(...args)
		},
		companyPhoneNumber: {
			findUnique: (...args: unknown[]) => mockPrismaCompanyPhoneNumberFindUnique(...args)
		}
	}
}));

vi.mock('$lib/utils/contacts', () => ({
	createOrUpdateContact: (...args: unknown[]) => mockCreateOrUpdateContact(...args)
}));

vi.mock('$lib/utils/communication-log', () => ({
	logCommunication: (...args: unknown[]) => mockLogCommunication(...args)
}));

vi.mock('$lib/server/a2p-client', () => ({
	isA2pEnabled: () => false,
	forwardSmsWebhook: async () => ({ ok: true, status: 200 })
}));

vi.mock('$lib/server/sms-alert', () => ({
	sendOwnerSmsAlert: (...args: unknown[]) => mockSendOwnerSmsAlert(...args)
}));

beforeEach(() => {
	vi.stubGlobal('fetch', mockFetch);
	mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
	mockPrismaMessageFindFirst.mockResolvedValue(null);
	mockPrismaMessageUpdate.mockResolvedValue({});
	mockPrismaMessageCreate.mockResolvedValue({});
	mockPrismaCompanyPhoneNumberFindUnique.mockResolvedValue({ companyId: 'company-test' });
	mockCreateOrUpdateContact.mockResolvedValue({ id: 'contact-test' });
	mockLogCommunication.mockResolvedValue({});
	mockSendOwnerSmsAlert.mockResolvedValue({});
});

describe('SMS Name & Intent Extraction via AI Protocol', () => {
	it('extracts "Sam" and sets has_name: true for "sam here" under emergency context', async () => {
		const comment = 'Emergency!, sam here, My roof is leaking after the repair they did last week. I have called 5 times and no one answers. Water is coming into my kitchen right now!';
		const result = await PipelineSimulator.run({
			author_name: 'Anonymous',
			comment,
			mode: 'sms',
			sessionId: 'test-session',
			rating: 0
		});

		expect(result.success).toBe(true);
		const extraction = result.ai_protocol?.raw_response;
		expect(extraction).toBeDefined();
		expect(extraction.customer_name).toBe('Sam');
		expect(extraction.has_name).toBe(true);
		expect(extraction.contains_emergency_keywords).toBe(true);
		expect(extraction.sentiment).toBe('concerned');
		expect(extraction.requested_action).toBe('emergency_dispatch');
		expect(extraction.service_requested).toBe('Plumbing');
		expect(extraction.detected_keywords).toContain('Emergency');
		expect(extraction.detected_keywords).toContain('Water');
	});

	it('returns has_name: false and customer_name: null if no name is in the message', async () => {
		const comment = 'My roof is leaking water, please help immediately!';
		const result = await PipelineSimulator.run({
			author_name: 'Anonymous',
			comment,
			mode: 'sms',
			sessionId: 'test-session',
			rating: 0
		});

		expect(result.success).toBe(true);
		const extraction = result.ai_protocol?.raw_response;
		expect(extraction.customer_name).toBeNull();
		expect(extraction.has_name).toBe(false);
	});

	it('integrates with SvelteKit SMS webhook to save the AI-extracted name to the database', async () => {
		const payload = {
			data: {
				event_type: 'message.received',
				payload: {
					id: 'sms-evt-123',
					direction: 'inbound',
					from: '+15550001111',
					to: '+17059986143',
					text: 'Emergency!, sam here, My roof is leaking after the repair they did last week.'
				}
			}
		};

		const { POST } = await import('../src/routes/api/telnyx/webhook/+server');
		const res = await POST({
			request: new Request('http://localhost/api/telnyx/webhook', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload)
			})
		} as any);

		expect(res.status).toBe(200);

		// Verify database inserts/updates
		expect(mockPrismaMessageCreate).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					customerName: 'Sam',
					customerPhone: '+15550001111'
				})
			})
		);

		expect(mockCreateOrUpdateContact).toHaveBeenCalledWith(
			expect.objectContaining({
				name: 'Sam',
				phone: '+15550001111'
			})
		);
	});
});
