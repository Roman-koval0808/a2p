import { PrismaClient } from 'profiledb-client';
import { env } from '$env/dynamic/private';

// Second Prisma client — points at the ProfileDB (CDP) Postgres, which is a SEPARATE database
// from the main clearsky DB (src/lib/db.ts). Never share a client between them: both schemas
// define a `User` model and they live on different servers. Requires PROFILEDB_DATABASE_URL.
const globalForProfileDb = globalThis as unknown as {
	profileDb: PrismaClient | undefined;
};

export const profileDb =
	globalForProfileDb.profileDb ??
	new PrismaClient({
		log: ['error', 'warn'],
		datasources: {
			db: {
				url: env.PROFILEDB_DATABASE_URL
			}
		}
	});

if (process.env.NODE_ENV !== 'production') globalForProfileDb.profileDb = profileDb;
