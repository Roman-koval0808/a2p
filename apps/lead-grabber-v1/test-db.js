const { PrismaClient } = require("./node_modules/@prisma/client");
const prisma = new PrismaClient();
prisma.message.findMany().then(m => {
  console.log("Messages:");
  m.forEach(x => console.log(x.id, x.threadId, JSON.stringify(x.messages).substring(0, 50)));
}).catch(e => console.error(e)).finally(() => prisma.$disconnect());
