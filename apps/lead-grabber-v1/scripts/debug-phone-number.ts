import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config();

const prisma = new PrismaClient();
const TELNYX_API_KEY = process.env.TELNYX_API_KEY!;
const TELNYX_CONNECTION_ID = process.env.TELNYX_CONNECTION_ID!;

const TELNYX_API_BASE = 'https://api.telnyx.com/v2';

const TELNYX_HEADERS = {
	'Content-Type': 'application/json',
	Authorization: `Bearer ${TELNYX_API_KEY}`
};

async function debugPhoneNumber(phoneNumber: string) {
	console.log('\n=== Debugging Phone Number ===');
	console.log('Phone Number:', phoneNumber);
	console.log('Connection ID:', TELNYX_CONNECTION_ID);

	// 1. Check database record
	console.log('\n1. Checking database record...');
	const dbRecord = await prisma.companyPhoneNumber.findFirst({
		where: { phoneNumber },
		include: { company: true }
	});

	if (!dbRecord) {
		console.log('❌ Phone number not found in database');
		return;
	}

	console.log('✓ Database record found:');
	console.log('  - ID:', dbRecord.id);
	console.log('  - Phone Number:', dbRecord.phoneNumber);
	console.log('  - Telnyx ID:', dbRecord.telnyxPhoneNumberId);
	console.log('  - Company:', dbRecord.company.name);

	// 2. Try to fetch phone number from Telnyx using the stored ID
	if (dbRecord.telnyxPhoneNumberId) {
		console.log('\n2. Fetching from Telnyx using stored ID...');
		const telnyxId = dbRecord.telnyxPhoneNumberId;

		try {
			const res = await fetch(`${TELNYX_API_BASE}/phone_numbers/${telnyxId}`, {
				headers: TELNYX_HEADERS
			});

			if (res.ok) {
				const data = await res.json();
				console.log('✓ Phone number found in Telnyx:');
				console.log('  - ID:', data.data.id);
				console.log('  - Phone Number:', data.data.phone_number);
				console.log('  - Status:', data.data.status);
				console.log('  - Connection ID:', data.data.connection_id);
				console.log('  - Voice Settings:', JSON.stringify(data.data.voice, null, 2));
			} else {
				const errorBody = await res.json();
				console.log('❌ Failed to fetch using stored ID:', res.status);
				console.log('Error:', JSON.stringify(errorBody, null, 2));
			}
		} catch (error) {
			console.log('❌ Error fetching from Telnyx:', error);
		}
	}

	// 3. Try to fetch phone number from Telnyx using E.164
	console.log('\n3. Fetching from Telnyx using E.164...');
	const encodedPhone = encodeURIComponent(phoneNumber);

	try {
		const res = await fetch(`${TELNYX_API_BASE}/phone_numbers/${encodedPhone}`, {
			headers: TELNYX_HEADERS
		});

		if (res.ok) {
			const data = await res.json();
			console.log('✓ Phone number found in Telnyx:');
			console.log('  - ID:', data.data.id);
			console.log('  - Phone Number:', data.data.phone_number);
			console.log('  - Status:', data.data.status);
			console.log('  - Connection ID:', data.data.connection_id);
			console.log('  - Voice Settings:', JSON.stringify(data.data.voice, null, 2));

			// Update database with correct ID if different
			if (dbRecord.telnyxPhoneNumberId !== data.data.id) {
				console.log('\n⚠️  Stored ID differs from actual ID!');
				console.log('  - Stored:', dbRecord.telnyxPhoneNumberId);
				console.log('  - Actual:', data.data.id);
			}
		} else {
			const errorBody = await res.json();
			console.log('❌ Failed to fetch using E.164:', res.status);
			console.log('Error:', JSON.stringify(errorBody, null, 2));
		}
	} catch (error) {
		console.log('❌ Error fetching from Telnyx:', error);
	}

	// 4. Search for phone number in account
	console.log('\n4. Searching all phone numbers in account...');
	try {
		const res = await fetch(
			`${TELNYX_API_BASE}/phone_numbers?filter[phone_number]=${phoneNumber}`,
			{
				headers: TELNYX_HEADERS
			}
		);

		if (res.ok) {
			const data = await res.json();
			if (data.data && data.data.length > 0) {
				console.log(`✓ Found ${data.data.length} matching number(s):`);
				data.data.forEach((num: any, idx: number) => {
					console.log(`\n  Number ${idx + 1}:`);
					console.log('    - ID:', num.id);
					console.log('    - Phone Number:', num.phone_number);
					console.log('    - Status:', num.status);
					console.log('    - Connection ID:', num.connection_id);
					console.log('    - Voice Settings:', JSON.stringify(num.voice, null, 2));
				});
			} else {
				console.log('❌ No matching numbers found in account');
			}
		} else {
			const errorBody = await res.json();
			console.log('❌ Failed to search:', res.status);
			console.log('Error:', JSON.stringify(errorBody, null, 2));
		}
	} catch (error) {
		console.log('❌ Error searching Telnyx:', error);
	}

	// 5. Try to assign voice connection
	console.log('\n5. Attempting to assign voice connection...');
	const phoneId = dbRecord.telnyxPhoneNumberId || phoneNumber;
	const pathId = phoneId.startsWith('+') ? encodeURIComponent(phoneId) : phoneId;

	try {
		const res = await fetch(`${TELNYX_API_BASE}/phone_numbers/${pathId}/voice`, {
			method: 'PATCH',
			headers: TELNYX_HEADERS,
			body: JSON.stringify({ connection_id: String(TELNYX_CONNECTION_ID) })
		});

		if (res.ok) {
			const data = await res.json();
			console.log('✓ Successfully assigned voice connection!');
			console.log('Response:', JSON.stringify(data, null, 2));
		} else {
			const errorBody = await res.json();
			console.log('❌ Failed to assign voice connection:', res.status);
			console.log('Error:', JSON.stringify(errorBody, null, 2));
		}
	} catch (error) {
		console.log('❌ Error assigning voice:', error);
	}
}

// Get phone number from command line argument
const phoneNumber = process.argv[2] || '+12016277128';

debugPhoneNumber(phoneNumber)
	.then(() => {
		console.log('\n=== Debug Complete ===\n');
		process.exit(0);
	})
	.catch((error) => {
		console.error('Fatal error:', error);
		process.exit(1);
	});
