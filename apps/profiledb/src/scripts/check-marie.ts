import prisma from '../config/prisma';

async function main() {
  const anonId = '28627917-1889-4115-afcf-06e95fa38afe';
  const marieId = '586e4790-946a-4411-ad8c-dcd3234759d7';

  console.log('=== CUSTOMER PROFILES ===');
  const anonProfile = await prisma.customerProfile.findUnique({
    where: { id: anonId },
    include: { fingerprints: true, events: true }
  });
  console.log('Anon Profile:', JSON.stringify(anonProfile, null, 2));

  const marieProfile = await prisma.customerProfile.findUnique({
    where: { id: marieId },
    include: { fingerprints: true, events: true }
  });
  console.log('Marie Profile:', JSON.stringify(marieProfile, null, 2));

  console.log('=== DEVICE FINGERPRINTS ===');
  const fingerprints = await prisma.deviceFingerprint.findMany();
  console.log('All Device Fingerprints:', JSON.stringify(fingerprints, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
