import { PrismaClient } from 'clearsky-db-client';
import { env } from '$env/dynamic/private';

const globalForPrisma = globalThis as unknown as {
	prisma: PrismaClient | undefined;
};

export const prisma =
	globalForPrisma.prisma ??
	new PrismaClient({
		log: ['error', 'warn'],
		datasources: {
			db: {
				url: env.DATABASE_URL
			}
		}
	});

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

