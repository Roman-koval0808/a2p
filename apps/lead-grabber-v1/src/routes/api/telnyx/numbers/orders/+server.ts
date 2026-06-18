import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { TELNYX_API_KEY } from '$env/static/private';
import { prisma } from '$lib/db';

export const GET: RequestHandler = async ({ url, locals }) => {
	try {
		if (!locals.user) {
			return json({ success: false, error: 'Not logged in' }, { status: 401 });
		}
		if (!locals.user.company?.id) {
			return json({ success: false, error: 'No company' }, { status: 403 });
		}

		const companyId = locals.user.company.id;
		const companyNumbers = await prisma.companyPhoneNumber.findMany({
			where: { companyId },
			select: { phoneNumber: true }
		});
		const companyNumberSet = new Set(companyNumbers.map((n) => n.phoneNumber));

		const page = url.searchParams.get('page') || '1';
		const limit = url.searchParams.get('limit') || '20';

		const params = new URLSearchParams({
			'page[number]': page,
			'page[size]': limit
		});

		const response = await fetch(`https://api.telnyx.com/v2/number_orders?${params.toString()}`, {
			method: 'GET',
			headers: {
				Authorization: `Bearer ${TELNYX_API_KEY}`
			}
		});

		const data = await response.json();

		if (!response.ok) {
			console.error('Telnyx orders error:', data);
			return json(
				{
					success: false,
					error: data.errors?.[0]?.detail || 'Failed to fetch orders'
				},
				{ status: response.status }
			);
		}

		// Only include orders that contain at least one number belonging to this company
		const allOrders = data.data || [];
		const ordersForCompany = allOrders.filter((order: any) => {
			const nums = order.phone_numbers ?? [];
			return nums.some((p: { phone_number?: string }) => companyNumberSet.has(p.phone_number));
		});

		// Transform Telnyx response
		const orders =
			ordersForCompany.map((order: any) => ({
				orderId: order.id,
				subOrderId: order.sub_order_id || order.id,
				date: new Date(order.created_at).toLocaleString(),
				status: order.status || 'Unknown',
				country:
					order.phone_numbers?.[0]?.phone_number?.substring(0, 2) === '+1'
						? 'United States'
						: 'Canada',
				actor: order.record_type || 'system',
				numberType: order.phone_numbers?.[0]?.phone_number_type || 'Local'
			})) || [];

		return json({
			success: true,
			orders,
			meta: data.meta
		});
	} catch (error) {
		console.error('Error fetching orders:', error);
		return json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Unknown error'
			},
			{ status: 500 }
		);
	}
};
