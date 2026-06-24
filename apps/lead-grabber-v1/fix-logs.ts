import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function fixOrphans() {
  const orphans = await prisma.communicationLog.findMany({
    where: { communicationThreadId: null, type: 'voice' }
  });
  console.log('Found', orphans.length, 'orphaned voice logs');
  for (const log of orphans) {
    if (!log.customerId || !log.companyId) continue;
    let thread = await prisma.communicationThread.findFirst({
      where: { companyId: log.companyId, contactId: log.customerId, status: 'open' },
      orderBy: { updated: 'desc' }
    });
    if (!thread) {
      thread = await prisma.communicationThread.create({
        data: {
          companyId: log.companyId,
          contactId: log.customerId,
          status: 'open',
          summary: 'Voice Call'
        }
      });
    }
    await prisma.communicationLog.update({
      where: { id: log.id },
      data: { communicationThreadId: thread.id }
    });
    console.log('Fixed log', log.id);
  }
}
fixOrphans().catch(console.error).finally(() => prisma.$disconnect());
