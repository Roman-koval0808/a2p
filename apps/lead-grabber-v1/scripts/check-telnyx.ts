import fs from 'fs';
import path from 'path';

async function main() {
	const envPath = path.resolve(process.cwd(), '.env');
	let apiKey = '';

	if (fs.existsSync(envPath)) {
		const content = fs.readFileSync(envPath, 'utf-8');
		const match = content.match(/TELNYX_API_KEY=(.*)/);
		if (match) {
			apiKey = match[1].trim();
			// handle quotes if present
			if (
				(apiKey.startsWith('"') && apiKey.endsWith('"')) ||
				(apiKey.startsWith("'") && apiKey.endsWith("'"))
			) {
				apiKey = apiKey.slice(1, -1);
			}
		}
	}

	if (!apiKey) {
		console.error('No TELNYX_API_KEY found in .env');
		process.exit(1);
	}

	const headers = {
		'Content-Type': 'application/json',
		Authorization: `Bearer ${apiKey}`
	};

	const id = '2886555331876357739';
	const number = '+12016277128';

	console.log(`Checking ID: ${id}`);
	try {
		const res1 = await fetch(`https://api.telnyx.com/v2/phone_numbers/${id}`, { headers });
		console.log(`Status 1: ${res1.status}`);
		if (res1.status !== 200) {
			// console.log(await res1.text());
		} else {
			console.log('Found by ID');
		}
	} catch (e) {
		console.error('Error fetching 1:', e);
	}

	console.log(`Checking Number: ${number}`);
	try {
		const res2 = await fetch(
			`https://api.telnyx.com/v2/phone_numbers/${encodeURIComponent(number)}`,
			{ headers }
		);
		console.log(`Status 2: ${res2.status}`);
		if (res2.status !== 200) {
			console.log(await res2.text());
		} else {
			const data = await res2.json();
			console.log('Found by Number. ID:', data.data?.id);
			console.log('Connection ID:', data.data?.connection_id);
		}
	} catch (e) {
		console.error('Error fetching 2:', e);
	}
}

main();
