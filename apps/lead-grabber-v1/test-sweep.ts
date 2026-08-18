import { syncCompanyEmails } from './src/lib/server/email/gmail-sync';
import { prisma } from './src/lib/db';

async function run() {
  const connections = await prisma.googleCalendarConnection.findMany();
  console.log("Connections found:", connections.length);
  for (const conn of connections) {
    console.log("Syncing company:", conn.companyId);
    const res = await syncCompanyEmails(conn.companyId);
    console.log("Result:", res);
  }
}
run().catch(console.error);
