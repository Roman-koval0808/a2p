import { describe, it, expect, vi, beforeEach } from 'vitest';
import { process_orchestrator } from './orchestrator';
import { prisma } from '$lib/db';
import { logCommunication } from '$lib/utils/communication-log';

// Mock dependencies
vi.mock('$lib/db', () => ({
    prisma: {
        communicationLog: {
            findUnique: vi.fn(),
            findFirst: vi.fn().mockResolvedValue(null), // draft de-dup lookup → none existing
            findMany: vi.fn().mockResolvedValue([]), // thread-matching lookup → none
            update: vi.fn(),
        },
        contact: {
            update: vi.fn(),
            findMany: vi.fn().mockResolvedValue([]), // balance alt-contact lookup → none
        }
    }
}));

vi.mock('$lib/utils/communication-log', () => ({
    logCommunication: vi.fn()
}));

vi.mock('$lib/company-numbers', () => ({
    toE164: (num: string) => num
}));

// Mock only the AI call; keep the real bucketToCategory mapping. Each test sets the intent
// the classifier returns, so routing is deterministic without hitting the network.
vi.mock('./message-intent', async (importActual) => {
    const actual = await importActual<typeof import('./message-intent')>();
    return { ...actual, classifyMessageIntent: vi.fn() };
});

vi.mock('$env/static/private', () => ({ OPEN_AI_KEY: 'test-key', ANTHROPIC_AI_KEY: 'test-key' }));

import { classifyMessageIntent } from './message-intent';

// Helper to build a full MessageIntent for the classifier mock.
const intent = (o: Partial<Record<string, unknown>>) => ({
    intent_bucket: 'inquiry',
    urgency: 'low',
    sentiment: 'neutral',
    wants_appointment: false,
    wants_balance: false,
    confidence: 0.9,
    needs_human_review: false,
    reason: '',
    ...o
});

describe('process_orchestrator', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should draft SMS with balance for Scenario 1 (Billing)', async () => {
        // Arrange
        const mockCommLog = {
            id: 'mock_id',
            direction: 'inbound',
            companyId: 'company_id',
            customerId: 'customer_id',
            source: '+15551234567',
            destination: '+18005550000',
            metadata: {
                ivr_digit: '1',
                sub_intent: 'Accounts Receivable'
            },
            company: { id: 'company_id', name: 'TestCo', website: 'testco.com' },
            customer: { id: 'customer_id', name: 'John', accountBalance: 1130.00 }
        };
        (prisma.communicationLog.findUnique as any).mockResolvedValue(mockCommLog);
        (logCommunication as any).mockResolvedValue(true);

        (classifyMessageIntent as any).mockResolvedValue(
            intent({ intent_bucket: 'billing', wants_balance: true })
        );

        // Act
        await process_orchestrator('mock_id', 'ai_ready');

        // Assert
        expect(logCommunication).toHaveBeenCalledWith(expect.objectContaining({
            type: 'sms',
            status: 'pending_approval',
            content: expect.stringContaining('1130.00'),
            metadata: expect.objectContaining({ orchestrator_draft: true })
        }));
        expect(prisma.communicationLog.update).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 'mock_id' },
            data: expect.objectContaining({
                metadata: expect.objectContaining({ orchestrator_processed: true })
            })
        }));
    });

    it('should increase engagement score and draft confirmation for Scenario 2 (Sales)', async () => {
        // Arrange
        const mockCommLog = {
            id: 'mock_id2',
            direction: 'inbound',
            companyId: 'company_id',
            customerId: 'customer_id',
            source: '+15551234567',
            destination: '+18005550000',
            metadata: {
                ivr_digit: '2',
                datetime: 'July 1 at 2pm'
            },
            company: { id: 'company_id', name: 'TestCo' },
            customer: { id: 'customer_id', name: 'Jane' }
        };
        (prisma.communicationLog.findUnique as any).mockResolvedValue(mockCommLog);

        (classifyMessageIntent as any).mockResolvedValue(
            intent({ intent_bucket: 'booking', wants_appointment: true })
        );

        // Act
        await process_orchestrator('mock_id2', 'ai_ready');

        // Assert
        expect(prisma.contact.update).toHaveBeenCalledWith({
            where: { id: 'customer_id' },
            data: { engagementScore: { increment: 10 } }
        });
        expect(logCommunication).toHaveBeenCalledWith(expect.objectContaining({
            type: 'sms',
            status: 'pending_approval',
            content: expect.stringContaining('July 1 at 2pm')
        }));
    });

    it('should be idempotent and abort if already processed', async () => {
        // Arrange
        const mockCommLog = {
            id: 'mock_id3',
            direction: 'inbound',
            companyId: 'company_id',
            customerId: 'customer_id',
            metadata: {
                orchestrator_processed: true
            },
            company: {},
            customer: {}
        };
        (prisma.communicationLog.findUnique as any).mockResolvedValue(mockCommLog);

        // Act
        await process_orchestrator('mock_id3', 'ai_ready');

        // Assert
        expect(prisma.contact.update).not.toHaveBeenCalled();
        expect(logCommunication).not.toHaveBeenCalled();
    });

    it('should follow the message and reclassify: pressed Billing but message is support -> no balance reply', async () => {
        // Arrange: caller pressed 1 (Billing) but the voicemail is a support request.
        const mockCommLog = {
            id: 'mock_id4',
            direction: 'inbound',
            companyId: 'company_id',
            customerId: 'customer_id',
            source: '+15551234567',
            destination: '+18005550000',
            content: 'Hello, I need some support with my roof.',
            metadata: { ivr_digit: '1' },
            company: { id: 'company_id', name: 'TestCo' },
            // A balance IS set — it must NOT be used, because the message isn't about billing.
            customer: { id: 'customer_id', name: 'Roof Guy', phone: '+15551234567', accountBalance: 1130.0 }
        };
        (prisma.communicationLog.findUnique as any).mockResolvedValue(mockCommLog);
        (logCommunication as any).mockResolvedValue(true);

        (classifyMessageIntent as any).mockResolvedValue(intent({ intent_bucket: 'inquiry' }));

        // Act
        await process_orchestrator('mock_id4', 'ai_ready');

        // Assert: drafted a support reply, not a balance reply; engagement untouched.
        const smsCall = (logCommunication as any).mock.calls.find((c: any[]) => c[0]?.type === 'sms');
        expect(smsCall).toBeTruthy();
        expect(smsCall[0].content).not.toContain('1130');
        expect(smsCall[0].content.toLowerCase()).toContain('support');
        expect(prisma.contact.update).not.toHaveBeenCalled();
    });

    it('should follow the message and classify as sales/booking when message requests an appointment to pay a bill', async () => {
        // Arrange
        const mockCommLog = {
            id: 'mock_id5',
            direction: 'inbound',
            companyId: 'company_id',
            customerId: 'customer_id',
            source: '+15551234567',
            destination: '+18005550000',
            content: 'I want to book an appointment to come down and pay my bill.',
            metadata: { ivr_digit: '1' },
            company: { id: 'company_id', name: 'TestCo' },
            customer: { id: 'customer_id', name: 'John', accountBalance: 1130.0 }
        };
        (prisma.communicationLog.findUnique as any).mockResolvedValue(mockCommLog);
        (logCommunication as any).mockResolvedValue(true);

        (classifyMessageIntent as any).mockResolvedValue(
            intent({ intent_bucket: 'booking', wants_appointment: true, wants_balance: true })
        );

        // Act
        await process_orchestrator('mock_id5', 'ai_ready');

        // Assert: drafted a sales/booking reply (asking what day and time works best)
        expect(logCommunication).toHaveBeenCalledWith(expect.objectContaining({
            type: 'sms',
            status: 'pending_approval',
            content: expect.stringContaining('What day and time works best for you?'),
            metadata: expect.objectContaining({
                orchestrator_draft: true,
                trigger_comm_id: 'mock_id5'
            })
        }));
        expect(prisma.contact.update).toHaveBeenCalledWith({
            where: { id: 'customer_id' },
            data: { engagementScore: { increment: 10 } }
        });
    });
});
