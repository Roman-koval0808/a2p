/**
 * Temporarily assign a Telnyx number to the app (voice connection) and optionally to a company.
 *
 * Usage:
 *   npx tsx scripts/assign-number-temp.ts +15551234567
 *   npx tsx scripts/assign-number-temp.ts +15551234567 <companyId>
 *
 * - First arg: phone number (E.164 or raw, e.g. +15551234567 or 5551234567).
 * - Second arg (optional): company ID. If provided, the number is added/updated in
 *   company_phone_numbers for that company (callFlowId left null = temporary).
 *   If omitted, only Telnyx voice connection is assigned (calls hit webhook but
 *   routing by number will need the number in DB elsewhere).
 *
 * Requires: TELNYX_API_KEY, TELNYX_CONNECTION_ID, DATABASE_URL (if companyId used).
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PrismaClient } from '@prisma/client';

// Load .env from project root (no dotenv dependency)
try {
	const envPath = resolve(process.cwd(), '.env');
	const content = readFileSync(envPath, 'utf8');
	for (const line of content.split('\n')) {
		const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
		if (m && process.env[m[1]] === undefined) {
			process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
		}
	}
} catch {
	// .env missing or unreadable; rely on existing env
}

const prisma = new PrismaClient();
const TELNYX_API_KEY = process.env.TELNYX_API_KEY!;
const TELNYX_CONNECTION_ID = process.env.TELNYX_CONNECTION_ID!;
const TELNYX_API_BASE = 'https://api.telnyx.com/v2';
const TELNYX_HEADERS = {
	'Content-Type': 'application/json',
	Authorization: `Bearer ${TELNYX_API_KEY}`
};

function toE164(raw: string): string {
	const digits = raw.trim().replace(/\D/g, '');
	if (digits.length === 10 && !raw.trim().startsWith('+')) return `+1${digits}`;
	if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
	return digits ? `+${digits}` : '';
}

async function findTelnyxNumber(
	e164: string
): Promise<{ id: string; phone_number: string } | null> {
	const res = await fetch(
		`${TELNYX_API_BASE}/phone_numbers?filter[phone_number]=${encodeURIComponent(e164)}`,
		{ headers: TELNYX_HEADERS }
	);
	if (!res.ok) {
		const err = await res.json();
		throw new Error(`Telnyx list failed: ${res.status} ${JSON.stringify(err)}`);
	}
	const data = await res.json();
	const list = data.data ?? [];
	if (list.length === 0) return null;
	return { id: list[0].id, phone_number: list[0].phone_number };
}

async function assignVoiceConnection(phoneIdOrE164: string): Promise<void> {
	const path = phoneIdOrE164.startsWith('+') ? encodeURIComponent(phoneIdOrE164) : phoneIdOrE164;
	const res = await fetch(`${TELNYX_API_BASE}/phone_numbers/${path}`, {
		method: 'PATCH',
		headers: TELNYX_HEADERS,
		body: JSON.stringify({ connection_id: String(TELNYX_CONNECTION_ID) })
	});
	if (!res.ok) {
		const err = await res.json();
		throw new Error(`Telnyx PATCH failed: ${res.status} ${JSON.stringify(err)}`);
	}
}

async function main() {
	const rawNumber = process.argv[2];
	const companyId = process.argv[3] ?? process.env.TEMP_ASSIGN_COMPANY_ID ?? null;

	if (!rawNumber) {
		console.error('Usage: npx tsx scripts/assign-number-temp.ts <phoneNumber> [companyId]');
		process.exit(1);
	}
	if (!TELNYX_API_KEY || !TELNYX_CONNECTION_ID) {
		console.error('Set TELNYX_API_KEY and TELNYX_CONNECTION_ID in .env');
		process.exit(1);
	}
	if (companyId && !process.env.DATABASE_URL) {
		console.error('DATABASE_URL required when assigning to a company');
		process.exit(1);
	}

	const e164 = toE164(rawNumber);
	if (!e164) {
		console.error('Invalid phone number');
		process.exit(1);
	}
	console.log('Phone (E.164):', e164);
	console.log('Connection ID:', TELNYX_CONNECTION_ID);

	const telnyx = await findTelnyxNumber(e164);
	if (!telnyx) {
		console.error('Number not found in your Telnyx account. Buy or port it first.');
		process.exit(1);
	}
	console.log('Telnyx ID:', telnyx.id);

	await assignVoiceConnection(telnyx.id);
	console.log('Voice connection assigned.');

	if (companyId) {
		const company = await prisma.company.findUnique({
			where: { id: companyId },
			select: { id: true, name: true }
		});
		if (!company) {
			console.error('Company not found:', companyId);
			process.exit(1);
		}
		await prisma.companyPhoneNumber.upsert({
			where: { phoneNumber: e164 },
			create: {
				companyId: company.id,
				phoneNumber: e164,
				telnyxPhoneNumberId: telnyx.id,
				callFlowId: null
			},
			update: {
				companyId: company.id,
				telnyxPhoneNumberId: telnyx.id,
				callFlowId: null
			}
		});
		console.log(
			`Number linked to company: ${company.name} (${company.id}). callFlowId = null (temporary).`
		);
	}

	console.log('Done.');
}

main()
	.then(() => process.exit(0))
	.catch((e) => {
		console.error(e);
		process.exit(1);
	});
