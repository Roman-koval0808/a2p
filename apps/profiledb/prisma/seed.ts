import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Reset database (optional but helpful for seeding cleanly)
  await prisma.telemetryEvent.deleteMany({});
  await prisma.deviceFingerprint.deleteMany({});
  await prisma.customerProfile.deleteMany({});
  await prisma.tenant.deleteMany({});

  // Seed Tenants
  const tenantA = await prisma.tenant.upsert({
    where: { slug: 'plumber-a' },
    update: {},
    create: {
      slug: 'plumber-a',
      name: 'Clearsky Plumbers',
    },
  });

  const tenantB = await prisma.tenant.upsert({
    where: { slug: 'plumber-b' },
    update: {},
    create: {
      slug: 'plumber-b',
      name: 'Flow Control Booking',
    },
  });

  // Seed Customer Profile (with a fixed UUID for easy out-of-the-box Swagger testing)
  const profileId = 'da39a3ee-5e6b-4b0d-9fae-e23111223344';
  const profile = await prisma.customerProfile.upsert({
    where: { id: profileId },
    update: {},
    create: {
      id: profileId,
      tenantId: tenantA.id,
      email: 'john.doe@example.com',
      phone: '+15550199',
      name: 'John Doe',
      scoreRaw: 85,
      scoreLive: 85,
      intentBucket: 'active',
      lastEventAt: new Date(),
    },
  });

  // Seed Device Fingerprint
  await prisma.deviceFingerprint.upsert({
    where: { fingerprintId: 'fp_abc123xyz' },
    update: {},
    create: {
      fingerprintId: 'fp_abc123xyz',
      customerProfileId: profile.id,
    },
  });

  // Seed Telemetry Events
  await prisma.telemetryEvent.create({
    data: {
      tenantId: tenantA.id,
      customerProfileId: profile.id,
      eventType: 'clearsky.web.click',
      pageUrl: '/pricing',
      referrer: 'https://google.com',
      scoreDelta: 15,
      payload: { buttonId: 'pricing_table_cta' },
      occurredAt: new Date(Date.now() - 3600000 * 2), // 2 hours ago
    },
  });

  await prisma.telemetryEvent.create({
    data: {
      tenantId: tenantA.id,
      customerProfileId: profile.id,
      eventType: 'clearsky.web.view',
      pageUrl: '/home',
      referrer: 'https://google.com',
      scoreDelta: 10,
      payload: {},
      occurredAt: new Date(Date.now() - 3600000 * 3), // 3 hours ago
    },
  });

  console.log('Seed completed successfully!');
  console.log('Tenants created:');
  console.log(`- ${tenantA.name} (${tenantA.slug})`);
  console.log(`- ${tenantB.name} (${tenantB.slug})`);
  console.log(`Profile created: John Doe (${profileId})`);
}

main()
  .catch((e) => {
    console.error('Error during seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
