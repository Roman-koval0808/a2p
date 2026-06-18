import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { TELNYX_API_KEY } from '$env/static/private';
import { prisma } from '$lib/db';
import { assignNumberToApp } from '$lib/server/telnyx';

export const POST: RequestHandler = async ({ request, locals }) => {
	try {
		const { phone_numbers } = await request.json();

		if (!phone_numbers || !Array.isArray(phone_numbers) || phone_numbers.length === 0) {
			return json(
				{
					success: false,
					error: 'phone_numbers array is required'
				},
				{ status: 400 }
			);
		}

		// Require authenticated user with a company (session cookie app_session must be sent for API calls)
		if (!locals.user) {
			return json(
				{
					success: false,
					error: 'Not logged in. Send the session cookie (app_session) for API requests.'
				},
				{ status: 401 }
			);
		}
		if (!locals.user.company?.id) {
			return json(
				{
					success: false,
					error:
						'No company. Create or join a company first (e.g. Create Company or accept an invite).'
				},
				{ status: 403 }
			);
		}

		const companyId = locals.user.company.id;

		// Create order for phone numbers
		const payload = {
			phone_numbers: phone_numbers.map((num: string) => ({
				phone_number: num
			}))
		};

		console.log('Telnyx buy request:', JSON.stringify(payload, null, 2));

		const response = await fetch('https://api.telnyx.com/v2/number_orders', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${TELNYX_API_KEY}`
			},
			body: JSON.stringify(payload)
		});

		const data = await response.json();

		console.log('Telnyx buy response:', response.status, JSON.stringify(data, null, 2));

		if (!response.ok) {
			console.error('Telnyx buy error:', data);
			return json(
				{
					success: false,
					error: data.errors?.[0]?.detail || 'Failed to purchase numbers'
				},
				{ status: response.status }
			);
		}

		const orderData = data.data;
		const purchasedNumbers = orderData?.phone_numbers || [];

		// Assign each number to messaging app and voice connection
		for (const numData of purchasedNumbers) {
			try {
				await assignNumberToApp(numData.id);
			} catch (e) {
				console.error(`Failed to assign ${numData.phone_number} to app/voice:`, e);
			}
		}

		// Store purchased numbers in database
		const createdNumbers = await Promise.all(
			purchasedNumbers.map(async (numData: any) => {
				const phoneNumber = numData.phone_number;
				const telnyxPhoneNumberId = numData.id;

				// Check if number already exists
				const existing = await prisma.companyPhoneNumber.findUnique({
					where: { phoneNumber }
				});

				if (existing) {
					console.log(`Number ${phoneNumber} already exists for company ${existing.companyId}`);
					return existing;
				}

				// Create new phone number record
				return await prisma.companyPhoneNumber.create({
					data: {
						companyId,
						phoneNumber,
						telnyxPhoneNumberId
					}
				});
			})
		);

		console.log(`Stored ${createdNumbers.length} numbers for company ${companyId}`);

		return json({
			success: true,
			order: orderData,
			orderId: orderData?.id,
			numbers: createdNumbers
		});
	} catch (error) {
		console.error('Error buying numbers:', error);
		return json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Unknown error'
			},
			{ status: 500 }
		);
	}
};
