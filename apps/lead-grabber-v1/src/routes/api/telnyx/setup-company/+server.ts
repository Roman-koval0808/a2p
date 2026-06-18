import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/db';
import {
	setupCompanyPhoneNumbers,
	orderPhoneNumbers,
	ensureBillingGroup,
	listPhoneNumbersByBillingGroup
} from '$lib/server/telnyx';

/**
 * POST /api/telnyx/setup-company
 *
 * Setup phone numbers for a company
 *
 * Request body:
 * {
 *   companyId: string;
 *   phoneCount: number;
 *   country_iso?: string;  // Default: 'US'
 *   phone_number_type?: 'local' | 'toll_free' | 'national' | 'mobile';  // Default: 'local'
 *   area_code?: string;
 *   state?: string;
 * }
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	try {
		// Ensure user is authenticated
		if (!locals.user) {
			return json({ success: false, error: 'Unauthorized' }, { status: 401 });
		}

		const body = await request.json();
		const { companyId, phoneCount, country_iso, phone_number_type, area_code, state } = body;

		// Validate required fields
		if (!companyId || !phoneCount) {
			return json(
				{ success: false, error: 'Missing required fields: companyId, phoneCount' },
				{ status: 400 }
			);
		}

		if (phoneCount < 1 || phoneCount > 100) {
			return json(
				{ success: false, error: 'Phone count must be between 1 and 100' },
				{ status: 400 }
			);
		}

		// Get company from database
		const company = await prisma.company.findUnique({
			where: { id: companyId }
		});

		if (!company) {
			return json({ success: false, error: 'Company not found' }, { status: 404 });
		}

		// Verify user has access to this company
		const hasAccess = company.ownerId === locals.user.id || locals.user.companyId === companyId;

		if (!hasAccess) {
			return json(
				{ success: false, error: 'You do not have access to this company' },
				{ status: 403 }
			);
		}

		// Ensure company has a name
		if (!company.name) {
			return json(
				{ success: false, error: 'Company must have a name before ordering phone numbers' },
				{ status: 400 }
			);
		}

		// Setup phone numbers with Telnyx
		const result = await setupCompanyPhoneNumbers(company.name, company.id, phoneCount, {
			country_iso,
			phone_number_type,
			area_code,
			state
		});

		// Return success response
		return json({
			success: true,
			billingGroup: {
				id: result.billingGroup.id,
				name: result.billingGroup.name
			},
			order: {
				id: result.order.id,
				status: result.order.status,
				orderingGroups: result.order.ordering_groups
			},
			message: `Successfully ordered ${phoneCount} phone number(s) for ${company.name}`
		});
	} catch (err) {
		console.error('Error setting up company phone numbers:', err);
		return json(
			{
				success: false,
				error: err instanceof Error ? err.message : 'Failed to setup company phone numbers'
			},
			{ status: 500 }
		);
	}
};

/**
 * GET /api/telnyx/setup-company?companyId=xxx
 *
 * Get billing group and phone numbers for a company
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	try {
		// Ensure user is authenticated
		if (!locals.user) {
			return json({ success: false, error: 'Unauthorized' }, { status: 401 });
		}

		const companyId = url.searchParams.get('companyId');

		if (!companyId) {
			return json(
				{ success: false, error: 'Missing required parameter: companyId' },
				{ status: 400 }
			);
		}

		// Get company from database
		const company = await prisma.company.findUnique({
			where: { id: companyId }
		});

		if (!company) {
			return json({ success: false, error: 'Company not found' }, { status: 404 });
		}

		// Verify user has access to this company
		const hasAccess = company.ownerId === locals.user.id || locals.user.companyId === companyId;

		if (!hasAccess) {
			return json(
				{ success: false, error: 'You do not have access to this company' },
				{ status: 403 }
			);
		}

		if (!company.name) {
			return json({ success: false, error: 'Company must have a name' }, { status: 400 });
		}

		// Get or create billing group
		const billingGroup = await ensureBillingGroup(company.name, company.id);

		// Get phone numbers in billing group
		const phoneNumbers = await listPhoneNumbersByBillingGroup(billingGroup.id);

		return json({
			success: true,
			billingGroup: {
				id: billingGroup.id,
				name: billingGroup.name
			},
			phoneNumbers: phoneNumbers.map((pn) => ({
				id: pn.id,
				phoneNumber: pn.phone_number,
				status: pn.status
			})),
			totalNumbers: phoneNumbers.length
		});
	} catch (err) {
		console.error('Error getting company billing info:', err);
		return json(
			{
				success: false,
				error: err instanceof Error ? err.message : 'Failed to get company billing info'
			},
			{ status: 500 }
		);
	}
};
