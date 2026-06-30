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
});
