import { PrismaClient } from '/Users/n3rd/code/projects/a2p/apps/lead-grabber-v1/clearsky-db-client/index.js';
import dotenv from 'dotenv';
import * as jose from 'jose';

dotenv.config({ path: '/Users/n3rd/code/projects/a2p/apps/lead-grabber-v1/.env' });

const dbUrl = (process.env.DATABASE_URL || '').replace('localhost', '127.0.0.1');

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: dbUrl
    }
  }
});

async function main() {
  const user = await prisma.user.findFirst({
    where: { email: 'n3rdydayo@gmail.com' }
  });
  if (!user) {
    throw new Error('User not found');
  }

  console.log('Found user:', user.email);

  const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
  const secret = new TextEncoder().encode(JWT_SECRET);
  const token = await new jose.SignJWT({
    id: user.id,
    email: user.email,
    tokenKey: user.tokenKey
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('7d')
    .sign(secret);

  console.log('Generated session token');

  const formData = new URLSearchParams();
  formData.append('caller', '+15550009999');
  formData.append('called', '+17059986143');
  formData.append('comment', 'Hi, this is John. I am calling to get a quote for a new water heater replacement. My budget is $1450. Can you guys help me?');

  console.log('Sending simulated call POST to SvelteKit dev server on port 3006...');
  const response = await fetch('http://127.0.0.1:3006/test?/triggerCall', {
    method: 'POST',
    headers: {
      'cookie': `app_session=${token}`,
      'content-type': 'application/x-www-form-urlencoded'
    },
    body: formData.toString()
  });

  console.log('Response Status:', response.status);
  console.log('Response Headers:', response.headers.get('content-type'));
  
  const resText = await response.text();
  if (response.status !== 200) {
    console.log('Response Body:', resText);
    return;
  }

  console.log('Waiting 3 seconds for async pipeline processing...');
  await new Promise(resolve => setTimeout(resolve, 3000));

  // Query communication log
  const commLog = await prisma.communicationLog.findFirst({
    where: { source: '+15550009999' },
    orderBy: { created: 'desc' }
  });

  console.log('Newest Communication Log:', commLog ? {
    id: commLog.id,
    type: commLog.type,
    summary: commLog.summary,
    content: commLog.content,
    metadata: commLog.metadata
  } : 'None');

  // Query contact
  const contact = await prisma.contact.findFirst({
    where: { phone: '+15550009999' }
  });
  console.log('Resolved Contact:', contact ? {
    id: contact.id,
    name: contact.name,
    phone: contact.phone
  } : 'None');
}

main().catch(console.error).finally(() => prisma.$disconnect());
