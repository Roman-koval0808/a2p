import prisma from '../config/prisma';

async function main() {
  console.log('--- Database Audit ---');
  
  const tenants = await prisma.tenant.findMany();
  console.log('Tenants:', tenants);

  const profiles = await prisma.customerProfile.findMany({
    include: {
      fingerprints: true,
      events: true,
    }
  });

  console.log('\nProfiles Count:', profiles.length);
  profiles.forEach(p => {
    console.log(`\nProfile: ${p.id}`);
    console.log(`  Tenant: ${p.tenantId}`);
    console.log(`  Name: ${p.name}, Email: ${p.email}, Phone: ${p.phone}`);
    console.log(`  Score Raw/Live: ${p.scoreRaw}/${p.scoreLive}, Bucket: ${p.intentBucket}`);
    console.log(`  Last Event At: ${p.lastEventAt}`);
    console.log(`  Fingerprints (${p.fingerprints.length}):`, p.fingerprints.map(fp => fp.fingerprintId));
    console.log(`  Events (${p.events.length}):`, p.events.map(e => ({ id: e.id, type: e.eventType, page: e.pageUrl })));
  });
  
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
