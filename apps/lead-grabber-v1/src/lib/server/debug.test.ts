import { describe, it } from 'vitest';
import { prisma } from '$lib/db';

describe('debug intents', () => {
  it('should list recent intents', async () => {
    const intents = await prisma.scheduledIntent.findMany({
      orderBy: { createdAt: 'desc' },
      take: 5
    });
    console.log("INTENTS:", JSON.stringify(intents, null, 2));
  });
});
