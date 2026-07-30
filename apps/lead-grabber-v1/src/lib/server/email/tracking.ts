import * as jose from 'jose';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const secret = new TextEncoder().encode(JWT_SECRET);

export interface CsTokenPayload {
	contactId: string;
	companyId: string;
}

export async function mintCsToken(contactId: string, companyId: string): Promise<string> {
	return await new jose.SignJWT({ contactId, companyId, purpose: 'email_tracking' })
		.setProtectedHeader({ alg: 'HS256' })
		.setExpirationTime('30d')
		.sign(secret);
}

export async function verifyCsToken(token: string): Promise<CsTokenPayload | null> {
	try {
		const { payload } = await jose.jwtVerify(token, secret);
		if ((payload as any).purpose !== 'email_tracking') return null;
		return {
			contactId: (payload as any).contactId as string,
			companyId: (payload as any).companyId as string
		};
	} catch {
		return null;
	}
}
