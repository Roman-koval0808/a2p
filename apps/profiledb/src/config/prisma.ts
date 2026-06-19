import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Export Prisma Client instance (refreshed)
export default prisma;
