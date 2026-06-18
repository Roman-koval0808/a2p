import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetFcmMessaging = vi.fn();
const mockCompanyMemberFindMany = vi.fn();
const mockUserDeviceFindMany = vi.fn();
const mockUserDeviceDeleteMany = vi.fn();

vi.mock('./firebase', () => ({
	getFcmMessaging: () => mockGetFcmMessaging()
}));

vi.mock('$lib/db', () => ({
	prisma: {
		companyMember: {
			findMany: (...args: unknown[]) => mockCompanyMemberFindMany(...args)
		},
		userDevice: {
			findMany: (...args: unknown[]) => mockUserDeviceFindMany(...args),
			deleteMany: (...args: unknown[]) => mockUserDeviceDeleteMany(...args)
		}
	}
}));

import { notifyIncomingCallViaPush } from './incoming-call';

describe('notifyIncomingCallViaPush', () => {
	const payload = {
		companyId: 'co_1',
		callControlId: 'cc_abc',
		from: '+15550001111',
		to: '+15550002222',
		callerName: 'Test Caller'
	};

	beforeEach(() => {
		mockGetFcmMessaging.mockReset();
		mockCompanyMemberFindMany.mockReset();
		mockUserDeviceFindMany.mockReset();
		mockUserDeviceDeleteMany.mockReset();
	});

	it('returns immediately when FCM is not configured (getFcmMessaging returns null)', async () => {
		mockGetFcmMessaging.mockReturnValue(null);

		await notifyIncomingCallViaPush(payload);

		expect(mockCompanyMemberFindMany).not.toHaveBeenCalled();
		expect(mockUserDeviceFindMany).not.toHaveBeenCalled();
	});

	it('does not send when there are no active members', async () => {
		mockGetFcmMessaging.mockReturnValue({
			sendEachForMulticast: vi.fn()
		});
		mockCompanyMemberFindMany.mockResolvedValue([]);

		await notifyIncomingCallViaPush(payload);

		expect(mockCompanyMemberFindMany).toHaveBeenCalledWith({
			where: { companyId: 'co_1', status: 'active' },
			select: { userId: true }
		});
		expect(mockUserDeviceFindMany).not.toHaveBeenCalled();
	});

	it('does not send when members exist but no FCM tokens', async () => {
		const sendEachForMulticast = vi.fn();
		mockGetFcmMessaging.mockReturnValue({ sendEachForMulticast });
		mockCompanyMemberFindMany.mockResolvedValue([{ userId: 'u1' }, { userId: 'u2' }]);
		mockUserDeviceFindMany.mockResolvedValue([]);

		await notifyIncomingCallViaPush(payload);

		expect(mockUserDeviceFindMany).toHaveBeenCalledWith({
			where: { userId: { in: ['u1', 'u2'] }, fcmToken: { not: null } },
			select: { fcmToken: true }
		});
		expect(sendEachForMulticast).not.toHaveBeenCalled();
	});

	it('calls sendEachForMulticast with string data payload and prunes dead tokens', async () => {
		const sendEachForMulticast = vi.fn().mockResolvedValue({
			responses: [
				{ success: true },
				{
					success: false,
					error: { code: 'messaging/registration-token-not-registered' }
				},
				{
					success: false,
					error: { code: 'messaging/invalid-registration-token' }
				}
			]
		});
		mockGetFcmMessaging.mockReturnValue({ sendEachForMulticast });
		mockCompanyMemberFindMany.mockResolvedValue([{ userId: 'u1' }]);
		mockUserDeviceFindMany.mockResolvedValue([
			{ fcmToken: 'tok_good' },
			{ fcmToken: 'tok_dead1' },
			{ fcmToken: 'tok_dead2' }
		]);
		mockUserDeviceDeleteMany.mockResolvedValue({ count: 2 });

		await notifyIncomingCallViaPush(payload);

		expect(sendEachForMulticast).toHaveBeenCalledWith({
			tokens: ['tok_good', 'tok_dead1', 'tok_dead2'],
			data: {
				type: 'incoming_call',
				callControlId: 'cc_abc',
				from: '+15550001111',
				to: '+15550002222',
				callerName: 'Test Caller',
				companyId: 'co_1'
			},
			android: { priority: 'high' },
			apns: {
				headers: { 'apns-priority': '10' },
				payload: { aps: { 'content-available': 1 } }
			}
		});
		expect(mockUserDeviceDeleteMany).toHaveBeenCalledWith({
			where: { fcmToken: { in: ['tok_dead1', 'tok_dead2'] } }
		});
	});
});
