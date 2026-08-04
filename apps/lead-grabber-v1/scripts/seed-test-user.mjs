#!/usr/bin/env node
/**
 * Create (or reset) a dedicated mobile test user with a company that has an
 * assigned phone number, so the mobile app can log in and use the dialer.
 *
 * The user is attached to the FIRST company that already owns at least one
 * company_phone_numbers row (pass --company <id> to pick a specific one).
 *
 * Usage:
 *   node scripts/seed-test-user.mjs
 *   TEST_USER_EMAIL=x TEST_USER_PASSWORD=y node scripts/seed-test-user.mjs
 *
 * Idempotent: re-running resets the password and re-links the company.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import bcrypt from 'bcryptjs';

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---- config -------------------------------------------------------------
const DEFAULT_EMAIL = 'test.mobile@clearsky.com';
const DEFAULT_PASSWORD = 'ClearskyMobile2026!';
const EMAIL = process.env.TEST_USER_EMAIL || DEFAULT_EMAIL;
const PASSWORD = process.env.TEST_USER_PASSWORD || DEFAULT_PASSWORD;
const NAME = process.env.TEST_USER_NAME || 'Mobile Test User';
const COMPANY_ID = process.env.TEST_COMPANY_ID || null; // optional override

// ---- load DATABASE_URL from .env ---------------------------------------
function loadEnv(file) {
	const out = {};
	try {
		for (const line of readFileSync(file, 'utf8').split('\n')) {
			const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
			if (!m) continue;
			let v = m[2].trim();
			if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
			if (v.startsWith("'") && v.endsWith("'")) v = v.slice(1, -1);
			out[m[1]] = v;
		}
	} catch {}
	return out;
}

const env = { ...loadEnv(join(APP_DIR, '.env')), ...loadEnv(join(APP_DIR, '.env.local')) };
const rawUrl = env.DATABASE_URL;
if (!rawUrl) {
	console.error('DATABASE_URL not found in .env / .env.local');
	process.exit(1);
}
const DATABASE_URL = rawUrl.split('?')[0];

// ---- main ---------------------------------------------------------------
const client = new pg.Client({
	connectionString: DATABASE_URL,
	ssl: { rejectUnauthorized: false }
});

await client.connect();

const t = async (sql, params) => (await client.query(sql, params)).rows;
const q1 = async (sql, params) => (await client.query(sql, params)).rows[0];

// 1. Find a company that already owns a phone number.
let companyId = COMPANY_ID;
let phoneNumber = null;

if (companyId) {
	phoneNumber = (
		await q1('select "phoneNumber" from company_phone_numbers where "companyId" = $1 order by created asc limit 1', [companyId])
	)?.phoneNumber ?? null;
} else {
	const row = await q1(
		`select cpn."companyId", cpn."phoneNumber"
		   from company_phone_numbers cpn
		  order by cpn.created asc
		  limit 1`
	);
	companyId = row?.companyId ?? null;
	phoneNumber = row?.phoneNumber ?? null;
}

if (!companyId) {
	console.error('No company with an assigned phone number found. Assign one first (POST /api/company-numbers).');
	process.exit(1);
}

const company = await q1('select id, name from companies where id = $1', [companyId]);

// 2. Upsert the user.
const passwordHash = await bcrypt.hash(PASSWORD, 10);
const existing = await q1('select id from users where email = $1', [EMAIL.toLowerCase()]);

let userId;
if (existing) {
	await client.query('update users set password = $1, "companyId" = $2, verified = true, "emailVisibility" = true, name = $3 where id = $4', [
		passwordHash,
		companyId,
		NAME,
		existing.id
	]);
	userId = existing.id;
	console.log(`[seed] Updated existing user ${EMAIL} (${userId})`);
} else {
	const row = await q1(
		`insert into users (id, email, password, "tokenKey", "emailVisibility", verified, name, "companyId", "platformRole", created, updated)
		 values (gen_random_uuid(), $1, $2, gen_random_uuid(), true, true, $3, $4, 'TENANT_USER', now(), now())
		 returning id`,
		[EMAIL.toLowerCase(), passwordHash, NAME, companyId]
	);
	userId = row.id;
	console.log(`[seed] Created user ${EMAIL} (${userId})`);
}

// 3. Ensure membership row (used for role resolution in GET /api/me).
await client.query(
	`insert into company_members (id, "userId", "companyId", role, status, created, updated)
	 values (gen_random_uuid(), $1, $2, 'admin', 'active', now(), now())
	 on conflict ("userId", "companyId") do update set role = 'admin', status = 'active', updated = now()`,
	[userId, companyId]
);

// 4. Reset the user's tokenKey so previously-issued JWTs are invalidated.
await client.query('update users set "tokenKey" = gen_random_uuid() where id = $1', [userId]);

await client.end();

console.log('\n================ MOBILE TEST USER ================');
console.log(`  Base URL : ${env.PUBLIC_BASE_URL || 'http://localhost:3005'}`);
console.log(`  Email    : ${EMAIL.toLowerCase()}`);
console.log(`  Password : ${PASSWORD}`);
console.log(`  Company  : ${company?.name ?? companyId} (${companyId})`);
console.log(`  Number   : ${phoneNumber ?? '(none assigned)'}  <- outbound caller ID`);
console.log('  Auth     : POST /api/auth/login  ->  Authorization: Bearer <token>');
console.log('==================================================');
