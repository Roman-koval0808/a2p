import 'dotenv/config';
import { PrismaClient } from 'clearsky-db-client';

const prisma = new PrismaClient();

async function main() {
	const since = new Date('2026-08-03T20:00:00Z');

	console.log('=== communication_log (Aug 3, from 15:40Z) ===');
	const logs = await prisma.communicationLog.findMany({
		where: { created: { gte: new Date('2026-08-03T15:40:00Z') } },
		orderBy: { created: 'asc' },
		take: 40
	});
	for (const l of logs) {
		console.log(
			`[${l.created.toISOString()}] id=${l.id} type=${l.type} dir=${l.direction} status=${l.status} thread=${l.communicationThreadId || 'NULL'}`
		);
		console.log(`    from=${l.source} to=${l.destination} subj=${l.subject}`);
		const m = (l.metadata as Record<string, any>) || {};
		console.log(`    meta: commId=${m.commId || '∅'} commContainerId=${m.commContainerId || '∅'} commRef=${m.commRef || '∅'} outbound_reviewed=${m.outbound_reviewed ?? '∅'} thread_merge=${m.thread_merge ? 'yes' : '∅'} intent=${m.intent || m.sub_intent || '∅'}`);
	}

	console.log('\n=== comm_containers (recent) ===');
	const containers = await prisma.commContainer.findMany({
		orderBy: { openedAt: 'desc' },
		take: 10
	});
	for (const c of containers) {
		console.log(
			`id=${c.id} ref=${c.commRef} subject="${c.subject}" state=${c.state} lifecycle=${c.lifecycle} type=${c.threadType} contact=${c.contactId || 'NULL'} profile=${c.customerProfileId || 'NULL'} opened=${c.openedAt?.toISOString()}`
		);
	}

	console.log('\n=== comm_entries (recent) ===');
	const entries = await prisma.commEntry.findMany({
		orderBy: { occurredAt: 'desc' },
		take: 10
	});
	for (const e of entries) {
		console.log(
			`commId=${e.commId} dir=${e.direction} channel=${e.channel} from=${e.fromParty} to=${e.toParty} transcript="${(e.transcript || '').slice(0, 80)}"`
		);
	}

	console.log('\n=== identity tables ===');
	const profs = await prisma.pipelineCustomerProfile.findMany({
		where: { companyId: { in: [...new Set(logs.map((l) => l.companyId).filter(Boolean))] } },
		select: { id: true, companyId: true, firstName: true, lastName: true, displayName: true, phoneNumber: true, email: true, identifiers: true }
	});
	for (const p of profs) {
		console.log(`profile id=${p.id} comp=${p.companyId} name=${(p.displayName || `${p.firstName || ''} ${p.lastName || ''}`).trim() || '∅'} phone=${p.phoneNumber || '∅'} email=${p.email || '∅'} ids=${JSON.stringify((p.identifiers as any[])?.map((i: any) => ({ kind: i.kind, value: i.value })))}`);
	}
	const contacts = await prisma.contact.findMany({
		where: { companyId: { in: [...new Set(logs.map((l) => l.companyId).filter(Boolean))] } },
		select: { id: true, companyId: true, name: true, phone: true, email: true }
	});
	for (const c of contacts) {
		console.log(`contact id=${c.id} comp=${c.companyId} name=${c.name} phone=${c.phone} email=${c.email}`);
	}

	console.log('\n=== comm_tasks + timers (recent) ===');
	const tasks = await prisma.commTask.findMany({ orderBy: { createdAt: 'desc' }, take: 5 });
	for (const t of tasks) {
		console.log(`task id=${t.id} commId=${t.commId} cat=${t.category} owner=${t.ownerUserId} desc="${t.description}"`);
	}
	const timers = await prisma.pipelineTimer.findMany({ orderBy: { createdAt: 'desc' }, take: 5 });
	for (const t of timers) {
		console.log(`timer id=${t.id} commId=${t.commId} type=${t.type} fireAt=${t.fireAt?.toISOString()}`);
	}
}

main()
	.finally(() => prisma.$disconnect())
	.catch((e) => {
		console.error(e);
		process.exit(1);
	});
