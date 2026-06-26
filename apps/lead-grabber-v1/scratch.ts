import { PrismaClient } from './clearsky-db-client';
const prisma = new PrismaClient();
async function main() {
  const location = await prisma.location.findFirst();
  console.log(JSON.stringify(location, null, 2));
}
main().finally(() => prisma.$disconnect());
