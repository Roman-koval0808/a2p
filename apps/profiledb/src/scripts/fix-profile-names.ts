import prisma from '../config/prisma';

export function isValidName(name: string): boolean {
  if (!name) return false;
  // If it's a phone number (just numbers, plus, hyphens, spaces, parens)
  const cleaned = name.replace(/[\s\-()]/g, '');
  if (/^\+?\d+$/.test(cleaned)) return false;
  // If it's just a number
  if (/^\d+$/.test(name)) return false;
  return true;
}

async function main() {
  console.log('Running profile name cleanup...');
  
  const profiles = await prisma.customerProfile.findMany({
    include: { events: { orderBy: { occurredAt: 'desc' } } }
  });

  for (const profile of profiles) {
    if (profile.name && !isValidName(profile.name)) {
      console.log(`Found polluted profile name: "${profile.name}" (ID: ${profile.id})`);
      
      // Look for a valid name in telemetry events
      let restoredName: string | null = null;
      for (const ev of profile.events) {
        const payload = (ev.payload as any) || {};
        const nameVal = payload.name || null;
        if (nameVal && isValidName(nameVal)) {
          restoredName = nameVal;
          break; // Events are sorted descending, so first valid name found is the most recent
        }
      }

      if (restoredName) {
        console.log(`  Restoring name to: "${restoredName}"`);
        await prisma.customerProfile.update({
          where: { id: profile.id },
          data: { name: restoredName }
        });
      } else {
        console.log(`  No valid name found in events. Setting to null.`);
        await prisma.customerProfile.update({
          where: { id: profile.id },
          data: { name: null }
        });
      }
    }
  }

  console.log('Cleanup finished!');
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
