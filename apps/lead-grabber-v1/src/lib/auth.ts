import bcrypt from 'bcryptjs';
import * as jose from 'jose';
import { prisma } from './db';
import type { User, Company } from '@prisma/client';

type UserWithCompany = User & { company: Company | null };

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const secret = new TextEncoder().encode(JWT_SECRET);
const JWT_EXPIRES_IN = '7d'; // 7 days, matching PocketBase default

export async function hashPassword(password: string): Promise<string> {
	return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
	return bcrypt.compare(password, hash);
}

export async function generateToken(user: User): Promise<string> {
	return await new jose.SignJWT({
		id: user.id,
		email: user.email,
		tokenKey: user.tokenKey
	})
		.setProtectedHeader({ alg: 'HS256' })
		.setExpirationTime(JWT_EXPIRES_IN)
		.sign(secret);
}

export async function verifyToken(
	token: string
): Promise<{ id: string; email: string; tokenKey: string } | null> {
	try {
		const { payload } = await jose.jwtVerify(token, secret);
		return payload as { id: string; email: string; tokenKey: string };
	} catch (err) {
		console.error('JWT verify failed:', err);
		return null;
	}
}

// Cache for user lookups to reduce repeated queries
const userCache = new Map<string, { user: UserWithCompany | null; timestamp: number }>();
const USER_CACHE_MS = 5000; // Cache for 5 seconds

export function invalidateUserCache(userId: string) {
	userCache.delete(userId);
}

export async function getUserFromToken(token: string): Promise<UserWithCompany | null> {
	const payload = await verifyToken(token);
	if (!payload) return null;

	// Check cache first
	const cached = userCache.get(payload.id);
	const now = Date.now();
	if (cached && now - cached.timestamp < USER_CACHE_MS) {
		// Verify tokenKey still matches
		if (cached.user && cached.user.tokenKey === payload.tokenKey) {
			return cached.user;
		}
	}

	const user = await prisma.user.findUnique({
		where: { id: payload.id },
		include: {
			company: true
		}
	});

	// Verify tokenKey matches (for token invalidation)
	if (user && user.tokenKey !== payload.tokenKey) {
		userCache.set(payload.id, { user: null, timestamp: now });
		return null;
	}

	// Update cache
	userCache.set(payload.id, { user, timestamp: now });

	// Clean up old cache entries periodically
	if (userCache.size > 1000) {
		const entries = Array.from(userCache.entries());
		const toKeep = entries
			.filter(([_, value]) => now - value.timestamp < USER_CACHE_MS)
			.slice(-500);
		userCache.clear();
		toKeep.forEach(([key, value]) => userCache.set(key, value));
	}

	return user;
}

export function createSessionCookie(token: string): string {
	return `app_session=${token}; Path=/; HttpOnly=false; SameSite=Lax; Max-Age=${7 * 24 * 60 * 60}`;
}

export function parseSessionCookie(cookieHeader: string | null): string | null {
	if (!cookieHeader) return null;

	const cookies = cookieHeader.split(';').map((c) => c.trim());
	const sessionCookie = cookies.find((c) => c.startsWith('app_session='));
	if (!sessionCookie) return null;
	return sessionCookie.split('=')[1] || null;
}
