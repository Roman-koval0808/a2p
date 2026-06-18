import { TELNYX_API_KEY, TELNYX_CONNECTION_ID, TELNYX_MESSAGING_PROFILE_ID } from '$env/static/private';
import { prisma } from '$lib/db';

const TELNYX_API_BASE = 'https://api.telnyx.com/v2';

const TELNYX_HEADERS = {
	'Content-Type': 'application/json',
	Authorization: `Bearer ${TELNYX_API_KEY}`
};

/** Id in URL: UUID as-is, E.164 encode the + */
function phoneIdToPath(id: string): string {
	return id.startsWith('+') ? encodeURIComponent(id) : id;
}

/** PATCH base phone number resource to set connection_id (voice app). UUID as-is; E.164 must be encoded. */
async function assignNumberVoice(phoneId: string): Promise<boolean> {
	const path = phoneId.startsWith('+') ? encodeURIComponent(phoneId) : phoneId;
	const url = `${TELNYX_API_BASE}/phone_numbers/${path}`;
	const res = await fetch(url, {
		method: 'PATCH',
		headers: TELNYX_HEADERS,
		body: JSON.stringify({ connection_id: String(TELNYX_CONNECTION_ID) })
	});
	if (!res.ok) {
		const errorBody = await res.json();
		console.error('Individual PATCH failed:', res.status, phoneId, errorBody);
	}
	return res.ok;
}

/** PATCH base phone number resource to set messaging_profile_id. */
async function assignNumberMessaging(phoneId: string): Promise<boolean> {
	if (!TELNYX_MESSAGING_PROFILE_ID) return true;
	const path = phoneId.startsWith('+') ? encodeURIComponent(phoneId) : phoneId;
	const url = `${TELNYX_API_BASE}/phone_numbers/${path}/messaging`;
	const res = await fetch(url, {
		method: 'PATCH',
		headers: TELNYX_HEADERS,
		body: JSON.stringify({ messaging_profile_id: String(TELNYX_MESSAGING_PROFILE_ID) })
	});
	if (!res.ok) {
		const errorBody = await res.json();
		console.error('Messaging PATCH failed:', res.status, phoneId, errorBody);
	}
	return res.ok;
}

/** Assign a Telnyx number to our voice connection and messaging profile. */
export async function assignNumberToApp(telnyxPhoneNumberId: string): Promise<void> {
	await Promise.all([assignNumberVoice(telnyxPhoneNumberId), assignNumberMessaging(telnyxPhoneNumberId)]);
}

interface TelnyxError {
	errors?: Array<{
		code?: string;
		title?: string;
		detail?: string;
		source?: {
			pointer?: string;
		};
	}>;
}

interface BillingGroup {
	id: string;
	name: string;
	created_at: string;
	updated_at: string;
	record_type: string;
}

interface PhoneNumberOrder {
	id: string;
	status: string;
	phone_numbers?: Array<{
		id: string;
		phone_number: string;
		status: string;
	}>;
	created_at: string;
	updated_at: string;
}

interface TelnyxPhoneNumber {
	id: string;
	phone_number: string;
	record_type: 'phone_number';
	connection_id: string | null;
	messaging_profile_id: string | null;
}

interface BulkNumberOrder {
	id: string;
	status: string;
	ordering_groups: Array<{
		country_iso: string;
		phone_number_type: string;
		count_requested: number;
		count_fulfilled?: number;
	}>;
	created_at: string;
	updated_at: string;
}

/**
 * Generate unique billing group name using company name and ID
 */
export function generateBillingGroupName(companyName: string, companyId: string): string {
	// Sanitize company name (remove special chars, limit length)
	const sanitizedName = companyName
		.replace(/[^a-zA-Z0-9\s-]/g, '')
		.trim()
		.substring(0, 50);

	return `${sanitizedName}-${companyId}`;
}

/**
 * Make authenticated request to Telnyx API
 */
async function telnyxRequest<T>(endpoint: string, options: RequestInit = {}): Promise<{ data: T }> {
	const url = `${TELNYX_API_BASE}${endpoint}`;

	const response = await fetch(url, {
		...options,
		headers: {
			Authorization: `Bearer ${TELNYX_API_KEY}`,
			'Content-Type': 'application/json',
			...options.headers
		}
	});

	const data = await response.json();

	if (!response.ok) {
		const error = data as TelnyxError;
		const errorMessage =
			error.errors?.[0]?.detail || error.errors?.[0]?.title || 'Unknown Telnyx API error';
		throw new Error(`Telnyx API Error: ${errorMessage}`);
	}

	return data;
}

/**
 * List all phone numbers from Telnyx account, handling pagination.
 */
export async function listAllTelnyxPhoneNumbers(): Promise<TelnyxPhoneNumber[]> {
	const allNumbers: TelnyxPhoneNumber[] = [];
	let page = 1;
	const size = 100; // Max size supported by Telnyx API

	while (true) {
		try {
			// Note: The structure of the response is { data: [...], meta: {...} }
			const response = await telnyxRequest<TelnyxPhoneNumber[]>(
				`/phone_numbers?page[number]=${page}&page[size]=${size}`
			);

			const { data } = response;

			if (!data || data.length === 0) {
				break; // No more numbers, exit loop
			}

			allNumbers.push(...data);

			// If we received fewer numbers than requested, it's the last page
			if (data.length < size) {
				break;
			}

			page++;
		} catch (error) {
			console.error(`Error fetching page ${page} of phone numbers from Telnyx:`, error);
			// Break on error to avoid infinite loop
			break;
		}
	}
	return allNumbers;
}

/**
 * List all billing groups
 */
export async function listBillingGroups(): Promise<BillingGroup[]> {
	const response = await telnyxRequest<BillingGroup[]>('/billing_groups', {
		method: 'GET'
	});
	return response.data;
}

/**
 * Find billing group by name
 */
export async function findBillingGroupByName(name: string): Promise<BillingGroup | null> {
	const billingGroups = await listBillingGroups();
	return billingGroups.find((bg) => bg.name === name) || null;
}

/**
 * Create a new billing group for a company
 * Returns the billing group ID
 */
export async function createBillingGroup(
	companyName: string,
	companyId: string
): Promise<BillingGroup> {
	const billingGroupName = generateBillingGroupName(companyName, companyId);

	// Check if billing group already exists
	const existing = await findBillingGroupByName(billingGroupName);
	if (existing) {
		console.log(`Billing group already exists: ${billingGroupName}`);
		return existing;
	}

	console.log(`Creating billing group: ${billingGroupName}`);

	const response = await telnyxRequest<BillingGroup>('/billing_groups', {
		method: 'POST',
		body: JSON.stringify({
			name: billingGroupName
		})
	});

	console.log(`✓ Billing group created: ${response.data.id}`);
	return response.data;
}

/**
 * Get or create billing group for a company
 * This ensures the billing group exists before proceeding
 */
export async function ensureBillingGroup(
	companyName: string,
	companyId: string
): Promise<BillingGroup> {
	const billingGroupName = generateBillingGroupName(companyName, companyId);

	// Try to find existing billing group first
	const existing = await findBillingGroupByName(billingGroupName);
	if (existing) {
		console.log(`Using existing billing group: ${billingGroupName} (${existing.id})`);
		return existing;
	}

	// Create new billing group if it doesn't exist
	return await createBillingGroup(companyName, companyId);
}

/**
 * Order specific phone numbers and associate with billing group
 * IMPORTANT: Ensures billing group exists before ordering
 */
export async function orderPhoneNumbers(
	phoneNumbers: string[],
	companyName: string,
	companyId: string
): Promise<PhoneNumberOrder> {
	// STEP 1: Ensure billing group exists
	const billingGroup = await ensureBillingGroup(companyName, companyId);

	if (!billingGroup || !billingGroup.id) {
		throw new Error('Failed to create or retrieve billing group. Cannot proceed with order.');
	}

	// STEP 2: Order numbers with billing group
	console.log(
		`Ordering ${phoneNumbers.length} phone number(s) for billing group ${billingGroup.id}`
	);

	const response = await telnyxRequest<PhoneNumberOrder>('/number_orders', {
		method: 'POST',
		body: JSON.stringify({
			phone_numbers: phoneNumbers.map((number) => ({
				phone_number: number,
				billing_group_id: billingGroup.id
			}))
		})
	});

	console.log(`✓ Number order created: ${response.data.id} (status: ${response.data.status})`);
	return response.data;
}

/**
 * Bulk order phone numbers (US/CA only)
 * Telnyx auto-selects available numbers
 * IMPORTANT: Ensures billing group exists before ordering
 */
export async function bulkOrderPhoneNumbers(
	orderingGroups: Array<{
		country_iso: string;
		phone_number_type: 'local' | 'toll_free' | 'national' | 'mobile';
		count_requested: number;
		area_code?: string;
		state?: string;
	}>,
	companyName: string,
	companyId: string
): Promise<BulkNumberOrder> {
	// STEP 1: Ensure billing group exists
	const billingGroup = await ensureBillingGroup(companyName, companyId);

	if (!billingGroup || !billingGroup.id) {
		throw new Error('Failed to create or retrieve billing group. Cannot proceed with bulk order.');
	}

	// STEP 2: Bulk order numbers with billing group
	const totalRequested = orderingGroups.reduce((sum, group) => sum + group.count_requested, 0);
	console.log(
		`Bulk ordering ${totalRequested} phone number(s) for billing group ${billingGroup.id}`
	);

	const response = await telnyxRequest<BulkNumberOrder>('/inexplicit_number_orders', {
		method: 'POST',
		body: JSON.stringify({
			ordering_groups: orderingGroups.map((group) => ({
				...group,
				billing_group_id: billingGroup.id
			}))
		})
	});

	console.log(`✓ Bulk order created: ${response.data.id} (status: ${response.data.status})`);
	return response.data;
}

/**
 * Get number order status
 */
export async function getNumberOrderStatus(orderId: string): Promise<PhoneNumberOrder> {
	const response = await telnyxRequest<PhoneNumberOrder>(`/number_orders/${orderId}`, {
		method: 'GET'
	});
	return response.data;
}

/**
 * List phone numbers in a billing group
 */
export async function listPhoneNumbersByBillingGroup(
	billingGroupId: string
): Promise<Array<{ id: string; phone_number: string; status: string }>> {
	const response = await telnyxRequest<Array<{ id: string; phone_number: string; status: string }>>(
		`/phone_numbers?filter[billing_group_id]=${billingGroupId}`,
		{ method: 'GET' }
	);
	return response.data;
}

/**
 * Complete workflow: Setup company phone numbers
 * 1. Creates/retrieves billing group
 * 2. Bulk orders phone numbers
 * 3. Returns billing group and order details
 */
export async function setupCompanyPhoneNumbers(
	companyName: string,
	companyId: string,
	phoneCount: number,
	options: {
		country_iso?: string;
		phone_number_type?: 'local' | 'toll_free' | 'national' | 'mobile';
		area_code?: string;
		state?: string;
	} = {}
): Promise<{
	billingGroup: BillingGroup;
	order: BulkNumberOrder;
}> {
	const { country_iso = 'US', phone_number_type = 'local', area_code, state } = options;

	// Step 1: Ensure billing group exists
	console.log(`Setting up ${phoneCount} phone numbers for ${companyName} (${companyId})`);
	const billingGroup = await ensureBillingGroup(companyName, companyId);

	// Step 2: Bulk order phone numbers
	const orderingGroups = [
		{
			country_iso,
			phone_number_type,
			count_requested: phoneCount,
			...(area_code && { area_code }),
			...(state && { state })
		}
	];

	const order = await bulkOrderPhoneNumbers(orderingGroups, companyName, companyId);

	console.log(`✓ Setup complete for ${companyName}`);
	console.log(`  Billing Group: ${billingGroup.id}`);
	console.log(`  Order ID: ${order.id}`);
	console.log(`  Status: ${order.status}`);

	return {
		billingGroup,
		order
	};
}

/**
 * Ensure all company numbers in our DB are assigned to the voice app (connection).
 * Voice only: PATCH /phone_numbers/{id}/voice with connection_id. Only touches company numbers in DB.
 */
/**
 * Batch update response from Telnyx
 */
interface BatchUpdateResponse {
	id: string;
	record_type: string;
	status: string;
}

/**
 * Batch update phone numbers to assign them to a voice connection.
 * This is an asynchronous operation - returns a job_id that can be polled for status.
 *
 * @param phoneNumbers - List of phone numbers in E.164 format (e.g., +15551234567)
 *                       OR list of Telnyx phone number IDs
 * @param connectionId - The voice connection/app ID to assign numbers to (defaults to TELNYX_CONNECTION_ID)
 * @returns The batch job details including job ID
 */
export async function batchUpdatePhoneNumbers(
	phoneNumbers: string[],
	connectionId: string = TELNYX_CONNECTION_ID
): Promise<BatchUpdateResponse> {
	if (phoneNumbers.length === 0) {
		throw new Error('No phone numbers provided for batch update');
	}

	console.log(
		`Batch updating ${phoneNumbers.length} phone number(s) to connection ${connectionId}`
	);

	const response = await fetch(`${TELNYX_API_BASE}/phone_numbers/update_batch`, {
		method: 'POST',
		headers: TELNYX_HEADERS,
		body: JSON.stringify({
			phone_numbers: phoneNumbers,
			connection_id: connectionId
		})
	});

	if (response.status === 202) {
		const data = await response.json();
		console.log(`✓ Batch update initiated! Job ID: ${data.data.id}`);
		return data.data as BatchUpdateResponse;
	}

	const errorData = await response.json();
	console.error('Batch update failed:', response.status, errorData);
	throw new Error(`Batch update failed: ${response.status} - ${JSON.stringify(errorData)}`);
}

/**
 * Batch update phone numbers by Telnyx ID. Uses jobs/update_number_settings (filter + settings).
 */
export async function batchUpdatePhoneNumbersByIds(
	telnyxIds: string[],
	connectionId: string = TELNYX_CONNECTION_ID
): Promise<BatchUpdateResponse> {
	if (telnyxIds.length === 0) throw new Error('No phone number IDs provided');

	console.log(`Batch updating ${telnyxIds.length} ID(s) to connection ${connectionId}`);

	const response = await fetch(`${TELNYX_API_BASE}/phone_numbers/jobs/update_number_settings`, {
		method: 'POST',
		headers: TELNYX_HEADERS,
		body: JSON.stringify({
			filter: {
				id: { in: telnyxIds }
			},
			settings: {
				connection_id: connectionId
			}
		})
	});

	if (response.status === 202) {
		const data = await response.json();
		return data.data as BatchUpdateResponse;
	}

	const errorData = await response.json();
	throw new Error(`Batch update failed: ${response.status} - ${JSON.stringify(errorData)}`);
}

export async function ensureCompanyNumbersAssignedToApp(): Promise<{
	assigned: number;
	skipped: number;
	failed: number;
}> {
	// 1. Get all company numbers from DB with a valid telnyxPhoneNumberId
	const companyNumbers = await prisma.companyPhoneNumber.findMany({
		where: { telnyxPhoneNumberId: { not: null } },
		select: { phoneNumber: true, telnyxPhoneNumberId: true }
	});

	if (companyNumbers.length === 0) {
		console.log('No company numbers with telnyxPhoneNumberId found to check for assignment.');
		return { assigned: 0, skipped: 0, failed: 0 };
	}

	try {
		// 2. Get all phone numbers from Telnyx to check their current assignment
		const allTelnyxNumbers = await listAllTelnyxPhoneNumbers();

		// Create a map for quick lookup: phone_number -> { connectionId, messagingProfileId }
		const telnyxMap = new Map(
			allTelnyxNumbers.map((n) => [
				n.phone_number,
				{ connectionId: n.connection_id, messagingProfileId: n.messaging_profile_id }
			])
		);

		let assignedCount = 0;
		let skippedCount = 0;
		let failedCount = 0;

		for (const dbNumber of companyNumbers) {
			const phoneNumber = dbNumber.phoneNumber!;
			const id = dbNumber.telnyxPhoneNumberId!;
			const telnyxInfo = telnyxMap.get(phoneNumber);

			if (telnyxInfo) {
				let voiceChanged = false;
				let smsChanged = false;

				// Voice connection check
				if (telnyxInfo.connectionId !== TELNYX_CONNECTION_ID) {
					console.log(
						`[Telnyx Sync] Voice connection ID mismatch for ${phoneNumber}. Expected: ${TELNYX_CONNECTION_ID}, Got: ${telnyxInfo.connectionId}`
					);
					const ok = await assignNumberVoice(phoneNumber);
					if (ok) {
						voiceChanged = true;
					} else {
						failedCount++;
					}
				}

				// Messaging profile check
				if (TELNYX_MESSAGING_PROFILE_ID && telnyxInfo.messagingProfileId !== TELNYX_MESSAGING_PROFILE_ID) {
					console.log(
						`[Telnyx Sync] Messaging profile ID mismatch for ${phoneNumber}. Expected: ${TELNYX_MESSAGING_PROFILE_ID}, Got: ${telnyxInfo.messagingProfileId}`
					);
					const ok = await assignNumberMessaging(phoneNumber);
					if (ok) {
						smsChanged = true;
					} else {
						failedCount++;
					}
				}

				if (voiceChanged || smsChanged) {
					assignedCount++;
				} else {
					skippedCount++;
				}
			} else {
				console.warn(`[Telnyx Sync] Number ${phoneNumber} is in DB but not found in Telnyx account.`);
				skippedCount++;
			}
		}

		console.log(
			`[Telnyx Sync] Finished. Assigned/Updated: ${assignedCount}, Skipped: ${skippedCount}, Failed: ${failedCount}`
		);
		return { assigned: assignedCount, skipped: skippedCount, failed: failedCount };
	} catch (error) {
		console.error('Error in ensureCompanyNumbersAssignedToApp:', error);
		return { assigned: 0, skipped: 0, failed: companyNumbers.length };
	}
}
