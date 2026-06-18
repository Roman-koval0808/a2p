import prisma from '../config/prisma';

async function main() {
  const profileId = '6455fed3-7c25-42c9-b684-15c7b548b6c6';
  
  const events = await prisma.telemetryEvent.findMany({
    where: { customerProfileId: profileId },
    orderBy: { occurredAt: 'asc' }
  });

  console.log(`Total events: ${events.length}`);
  events.forEach((ev, idx) => {
    const p = (ev.payload as any) || {};
    console.log(`Event #${idx + 1}: ${ev.eventType} at ${ev.occurredAt.toISOString()}`);
    console.log(`  Payload name: ${p.name}`);
    console.log(`  Payload email: ${p.email}`);
    console.log(`  Payload phone: ${p.phone}`);
    if (ev.eventType.includes('form') || ev.eventType.includes('submit')) {
      console.log(`  Full Payload:`, JSON.stringify(p, null, 2));
    }
  });
  
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
