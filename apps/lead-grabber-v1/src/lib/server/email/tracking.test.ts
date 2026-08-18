import { describe, it, expect } from 'vitest';
import { mintCsToken, verifyCsToken } from './tracking';

describe('email tracking (cs_token)', () => {
	it('mint and verify a valid token', async () => {
		const token = await mintCsToken('contact_abc', 'company_xyz');
		expect(token).toBeTruthy();
		expect(typeof token).toBe('string');

		const payload = await verifyCsToken(token);
		expect(payload).not.toBeNull();
		expect(payload!.contactId).toBe('contact_abc');
		expect(payload!.companyId).toBe('company_xyz');
	});

	it('rejects token with wrong purpose', async () => {
		const secret = new TextEncoder().encode(process.env.JWT_SECRET || 'your-secret-key-change-in-production');
		const { SignJWT } = await import('jose');
		const token = await new SignJWT({ contactId: 'c1', companyId: 'c2', purpose: 'auth' })
			.setProtectedHeader({ alg: 'HS256' })
			.setExpirationTime('1h')
			.sign(secret);
		const payload = await verifyCsToken(token);
		expect(payload).toBeNull();
	});

	it('rejects expired token', async () => {
		const secret = new TextEncoder().encode(process.env.JWT_SECRET || 'your-secret-key-change-in-production');
		const { SignJWT } = await import('jose');
		const token = await new SignJWT({ contactId: 'c1', companyId: 'c2', purpose: 'email_tracking' })
			.setProtectedHeader({ alg: 'HS256' })
			.setExpirationTime('0s')
			.sign(secret);
		await new Promise(r => setTimeout(r, 100));
		const payload = await verifyCsToken(token);
		expect(payload).toBeNull();
	});

	it('rejects garbage token', async () => {
		const payload = await verifyCsToken('not.a.token');
		expect(payload).toBeNull();
	});

	it('minted tokens are unique per call', async () => {
		const a = await mintCsToken('contact_abc', 'company_xyz');
		const b = await mintCsToken('contact_abc', 'company_xyz');
		expect(a).not.toBe(b);
	});
});
