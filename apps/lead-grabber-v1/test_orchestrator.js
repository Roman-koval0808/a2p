import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function run() {
  const commId = 'cmqz7mlkw000tedgpvosro7xu';
  const commLog = await prisma.communicationLog.findUnique({
    where: { id: commId },
    include: { customer: true }
  });
  console.log('CommLog:', commLog);
  if (!commLog || !commLog.customerId) return;
  
  const recentComms = await prisma.communicationLog.findMany({
    where: {
      customerId: commLog.customerId,
      id: { not: commId },
      status: { in: ['completed', 'success'] },
      content: { not: null }
    },
    orderBy: { created: 'desc' },
    take: 5
  });
  console.log('Recent Comms:', recentComms.map(c => ({ id: c.id, content: c.content, thread: c.communicationThreadId })));
}
run().catch(console.error).finally(() => prisma.$disconnect());
