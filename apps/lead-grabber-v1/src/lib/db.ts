import { PrismaClient } from 'clearsky-db-client';
import { env } from '$env/dynamic/private';

const globalForPrisma = globalThis as unknown as {
	prisma: PrismaClient | undefined;
};

function withPoolLimits(url: string): string {
	try {
		const u = new URL(url);
		// Cap the pool so a few dev servers / hot reloads don't exhaust the DB connection slots.
		u.searchParams.set('connection_limit', '10');
		u.searchParams.set('pool_timeout', '15');
		return u.toString();
	} catch {
		return url;
	}
}

export const prisma =
	globalForPrisma.prisma ??
	new PrismaClient({
		log: ['error', 'warn'],
		datasources: {
			db: {
				url: withPoolLimits(env.DATABASE_URL)
			}
		}
	});

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

