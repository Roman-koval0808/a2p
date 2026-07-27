import { PrismaClient } from './clearsky-db-client';

const prisma = new PrismaClient();

async function run() {
  console.log('Resetting and Fast-forwarding timers...');
  
  const result = await prisma.pipelineTimer.updateMany({
    where: { 
      type: 'calendar_grace'
    },
    data: { 
      status: 'registered',
      fireAt: new Date(Date.now() - 1000) 
    }
  });

  console.log(`Fast-forwarded ${result.count} timers.`);
}

run()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
