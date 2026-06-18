import { getApps, initializeApp, cert, type ServiceAccount } from 'firebase-admin/app';
import { getMessaging, type Messaging } from 'firebase-admin/messaging';
import { env } from '$env/dynamic/private';

let messagingSingleton: Messaging | null | undefined;

function parseServiceAccount(raw: string): ServiceAccount {
	const t = raw.trim();
	if (t.startsWith('{')) {
		return JSON.parse(t) as ServiceAccount;
	}
	try {
		const decoded = Buffer.from(t, 'base64').toString('utf8');
		return JSON.parse(decoded) as ServiceAccount;
	} catch {
		throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON must be JSON or base64-encoded JSON');
	}
}

export function isFcmConfigured(): boolean {
	return Boolean(env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim());
}

/** Returns Firebase Messaging or null if not configured. Never throws on missing env. */
export function getFcmMessaging(): Messaging | null {
	if (!isFcmConfigured()) {
		return null;
	}
	if (messagingSingleton !== undefined) {
		return messagingSingleton;
	}
	try {
		if (!getApps().length) {
			const cred = parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT_JSON!);
			initializeApp({ credential: cert(cred) });
		}
		messagingSingleton = getMessaging(getApps()[0]!);
		return messagingSingleton;
	} catch (e) {
		console.error('[push] Firebase init failed (check FIREBASE_SERVICE_ACCOUNT_JSON):', e);
		messagingSingleton = null;
		return null;
	}
}
