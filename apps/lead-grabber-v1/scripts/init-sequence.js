import { PrismaClient } from '../clearsky-db-client/index.js';
import dotenv from 'dotenv';

dotenv.config();

const dbUrl = (process.env.DATABASE_URL || '').replace('localhost', '127.0.0.1');

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: dbUrl
    }
  }
});

async function main() {
  try {
    await prisma.$executeRawUnsafe(`CREATE SEQUENCE IF NOT EXISTS comm_ref_seq START 4000;`);
    console.log('Successfully created sequence comm_ref_seq in PostgreSQL!');
  } catch (err) {
    console.error('Error creating sequence:', err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
