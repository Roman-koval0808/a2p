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
    take: 10,
    include: {
      communicationThread: {
        include: {
          contact: true
        }
      }
    }
  });
  console.log(JSON.stringify(logs.map(l => ({
    id: l.id,
    direction: l.direction,
    source: l.source,
    destination: l.destination,
    threadId: l.threadId,
    contactName: l.communicationThread?.contact?.name || null
  })), null, 2));
}

main()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());
