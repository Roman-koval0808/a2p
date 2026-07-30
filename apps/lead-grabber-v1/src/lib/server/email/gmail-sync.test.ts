import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fs/promises before importing the module
vi.mock('fs/promises', () => ({
	writeFile: vi.fn().mockResolvedValue(undefined),
	mkdir: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('fs', () => ({
	existsSync: vi.fn().mockReturnValue(false)
}));

vi.mock('$lib/db', () => ({
	prisma: {
		communicationLog: {
			findFirst: vi.fn(),
			findUnique: vi.fn(),
			findMany: vi.fn(),
			update: vi.fn()
		},
		message: {
			findUnique: vi.fn(),
			create: vi.fn(),
			update: vi.fn()
		},
		company: { findUnique: vi.fn() },
		pipelineCustomerProfile: {
			findFirst: vi.fn(),
			create: vi.fn(),
			update: vi.fn(),
			findUnique: vi.fn()
		},
		commIdentifier: { upsert: vi.fn() },
		googleCalendarConnection: { findUnique: vi.fn(), update: vi.fn() },
		contact: { update: vi.fn() }
	}
}));

vi.mock('$lib/utils/communication-log', () => ({
	logCommunication: vi.fn().mockResolvedValue({ id: 'log_1' })
}));

vi.mock('$lib/utils/contacts', () => ({
	createOrUpdateContact: vi.fn().mockResolvedValue({ id: 'contact_1' })
}));

vi.mock('../google-calendar', () => ({
	getConnectionAccessToken: vi.fn()
}));

vi.mock('$lib/server/pipeline/unified-pipeline', () => ({
	UnifiedPipeline: { process: vi.fn().mockResolvedValue({}) }
}));

vi.mock('$lib/server/identity/identity-service', () => ({
	enrichProfilePostTranscription: vi.fn().mockResolvedValue({ updatedProfile: {}, mergeCandidate: undefined })
}));

vi.mock('$env/static/private', () => ({
	OPEN_AI_KEY: 'test-key',
	ANTHROPIC_AI_KEY: 'test-key'
}));

import { extractAttachments, fetchAndSaveAttachment } from './gmail-sync';
import { writeFile, mkdir } from 'fs/promises';

describe('extractAttachments', () => {
	it('returns empty array for payload with no attachments', () => {
		const payload = {
			mimeType: 'text/plain',
			filename: '',
			body: { data: 'SGVsbG8=' }
		};
		expect(extractAttachments(payload)).toEqual([]);
	});

	it('returns empty array for null/undefined payload', () => {
		expect(extractAttachments(null)).toEqual([]);
		expect(extractAttachments(undefined)).toEqual([]);
	});

	it('extracts single attachment from top-level part', () => {
		const payload = {
			mimeType: 'image/png',
			filename: 'photo.png',
			body: { attachmentId: 'att_123', size: 1024 }
		};
		const result = extractAttachments(payload);
		expect(result).toHaveLength(1);
		expect(result[0]).toEqual({
			filename: 'photo.png',
			mimeType: 'image/png',
			attachmentId: 'att_123',
			size: 1024
		});
	});

	it('skips parts without attachmentId even if filename set', () => {
		const payload = {
			mimeType: 'text/plain',
			filename: 'notes.txt',
			body: { data: 'abc', attachmentId: undefined }
		};
		expect(extractAttachments(payload)).toEqual([]);
	});

	it('skips parts with attachmentId but no filename', () => {
		const payload = {
			mimeType: 'image/png',
			filename: '',
			body: { attachmentId: 'att_456', size: 2048 }
		};
		expect(extractAttachments(payload)).toEqual([]);
	});

	it('recursively extracts attachments from nested parts', () => {
		const payload = {
			mimeType: 'multipart/mixed',
			parts: [
				{ mimeType: 'text/plain', filename: '', body: { data: 'Hello' } },
				{
					mimeType: 'image/jpeg',
					filename: 'pic.jpg',
					body: { attachmentId: 'att_1', size: 500 }
				},
				{
					mimeType: 'multipart/related',
					parts: [
						{
							mimeType: 'application/pdf',
							filename: 'doc.pdf',
							body: { attachmentId: 'att_2', size: 10000 }
						}
					]
				}
			]
		};
		const result = extractAttachments(payload);
		expect(result).toHaveLength(2);
		expect(result[0].filename).toBe('pic.jpg');
		expect(result[1].filename).toBe('doc.pdf');
	});

	it('falls back to octet-stream when mimeType is missing', () => {
		const payload = {
			filename: 'file.bin',
			body: { attachmentId: 'att_789', size: 300 }
		};
		const result = extractAttachments(payload);
		expect(result[0].mimeType).toBe('application/octet-stream');
	});

	it('handles deeply nested 5-level multipart', () => {
		const makePart = (id: string, name: string, depth: number): any => {
			if (depth === 0) return { mimeType: 'image/png', filename: name, body: { attachmentId: id, size: 100 } };
			return { mimeType: 'multipart/mixed', parts: [makePart(id, name, depth - 1)] };
		};
		const payload = makePart('att_deep', 'deep.png', 5);
		const result = extractAttachments(payload);
		expect(result).toHaveLength(1);
		expect(result[0].attachmentId).toBe('att_deep');
	});
});

describe('fetchAndSaveAttachment', () => {
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('fetches attachment data and writes to disk', async () => {
		const mockData = Buffer.from('fake-image-data').toString('base64url');
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ data: mockData, size: 100 })
		});

		const result = await fetchAndSaveAttachment(
			'test-token', 'msg_1',
			{ filename: 'test.jpg', mimeType: 'image/jpeg', attachmentId: 'att_1' },
			'comm_log_1'
		);

		expect(result).toBe('/api/email-attachment/comm_log_1/test.jpg');
		expect(mkdir).toHaveBeenCalledWith(expect.stringContaining('static/uploads/email/comm_log_1'), { recursive: true });
		expect(writeFile).toHaveBeenCalledWith(
			expect.stringContaining('static/uploads/email/comm_log_1/test.jpg'),
			expect.any(Buffer)
		);
		expect(globalThis.fetch).toHaveBeenCalledWith(
			'https://gmail.googleapis.com/gmail/v1/users/me/messages/msg_1/attachments/att_1',
			expect.objectContaining({ headers: { Authorization: 'Bearer test-token' } })
		);
	});

	it('returns null on fetch failure', async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
		const result = await fetchAndSaveAttachment(
			'token', 'msg_1',
			{ filename: 'x.pdf', mimeType: 'application/pdf', attachmentId: 'att_missing' },
			'log_1'
		);
		expect(result).toBeNull();
		expect(writeFile).not.toHaveBeenCalled();
	});

	it('returns null when API returns no data', async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ size: 0 })
		});
		const result = await fetchAndSaveAttachment(
			'token', 'msg_1',
			{ filename: 'empty.pdf', mimeType: 'application/pdf', attachmentId: 'att_empty' },
			'log_1'
		);
		expect(result).toBeNull();
		expect(writeFile).not.toHaveBeenCalled();
	});

	it('encodes special characters in filename', async () => {
		const mockData = Buffer.from('data').toString('base64url');
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ data: mockData })
		});

		const result = await fetchAndSaveAttachment(
			'token', 'msg_1',
			{ filename: 'my file (2).jpg', mimeType: 'image/jpeg', attachmentId: 'att_spaces' },
			'log_1'
		);
		expect(result).toContain(encodeURIComponent('my file (2).jpg'));
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});
});
