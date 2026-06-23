// scratch_check.ts
import { PrismaClient } from 'clearsky-db-client';
import * as dotenv from 'dotenv';
dotenv.config();

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL
    }
  }
});

async function main() {
  const logs = await prisma.communicationLog.findMany({
    orderBy: { created: 'desc' },
    take: 5,
    include: {
      communicationThread: true
    }
  });
  console.log(JSON.stringify(logs, null, 2));
}

main()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());
