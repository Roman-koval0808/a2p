import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const comms = await prisma.communicationLog.findMany({
    orderBy: { created: 'desc' },
    take: 5
  });
  console.log(comms.map(c => ({ id: c.id, status: c.status, thread: c.communicationThreadId, customerId: c.customerId, content: c.content })));
}
main().catch(console.error).finally(() => prisma.$disconnect());
