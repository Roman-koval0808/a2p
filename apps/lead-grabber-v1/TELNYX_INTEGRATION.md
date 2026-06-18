# Telnyx Billing Groups & Phone Number Ordering

This document explains how to use the Telnyx integration to create billing groups and order phone numbers for companies.

## Overview

The Telnyx integration ensures that:

1. **Billing groups are created with unique names** using the format: `company_name-company_id`
2. **Billing groups exist before ordering numbers** - the system will not proceed with orders if the billing group creation fails
3. **All phone numbers are automatically associated** with the company's billing group for cost tracking

## Setup

### 1. Environment Variables

Add your Telnyx API key to `.env`:

```env
TELNYX_API_KEY=your_telnyx_api_key_here
```

Get your API key from: [Telnyx Mission Control > API Keys](https://portal.telnyx.com/#/app/api-keys)

## Usage

### Option 1: Using the API Endpoint (Recommended)

#### Order Phone Numbers for a Company

```typescript
// POST /api/telnyx/setup-company
const response = await fetch('/api/telnyx/setup-company', {
	method: 'POST',
	headers: {
		'Content-Type': 'application/json'
	},
	body: JSON.stringify({
		companyId: 'cm5abc123',
		phoneCount: 10,
		country_iso: 'US', // Optional, default: 'US'
		phone_number_type: 'local', // Optional, default: 'local'
		area_code: '202', // Optional
		state: 'DC' // Optional
	})
});

const data = await response.json();
console.log(data);
// {
//   success: true,
//   billingGroup: {
//     id: "f5586561-8ff0-4291-a0ac-84fe544797bd",
//     name: "Acme Corporation-cm5abc123"
//   },
//   order: {
//     id: "order_123",
//     status: "pending",
//     orderingGroups: [...]
//   },
//   message: "Successfully ordered 10 phone number(s) for Acme Corporation"
// }
```

#### Get Billing Group Info & Phone Numbers

```typescript
// GET /api/telnyx/setup-company?companyId=cm5abc123
const response = await fetch('/api/telnyx/setup-company?companyId=cm5abc123');
const data = await response.json();
console.log(data);
// {
//   success: true,
//   billingGroup: {
//     id: "f5586561-8ff0-4291-a0ac-84fe544797bd",
//     name: "Acme Corporation-cm5abc123"
//   },
//   phoneNumbers: [
//     { id: "...", phoneNumber: "+12025551234", status: "active" },
//     { id: "...", phoneNumber: "+12025555678", status: "active" }
//   ],
//   totalNumbers: 2
// }
```

### Option 2: Using the Telnyx Module Directly

```typescript
import {
	setupCompanyPhoneNumbers,
	orderPhoneNumbers,
	ensureBillingGroup,
	listPhoneNumbersByBillingGroup
} from '$lib/server/telnyx';

// Example 1: Complete setup workflow (bulk order)
const result = await setupCompanyPhoneNumbers(
	'Acme Corporation', // Company name
	'cm5abc123', // Company ID
	10, // Number of phones to order
	{
		country_iso: 'US',
		phone_number_type: 'local',
		area_code: '202'
	}
);

console.log('Billing Group:', result.billingGroup);
console.log('Order:', result.order);

// Example 2: Order specific phone numbers
const order = await orderPhoneNumbers(
	['+12025551234', '+12025555678'], // Specific numbers
	'Acme Corporation',
	'cm5abc123'
);

// Example 3: Just ensure billing group exists
const billingGroup = await ensureBillingGroup('Acme Corporation', 'cm5abc123');

// Example 4: List all phone numbers in a billing group
const phoneNumbers = await listPhoneNumbersByBillingGroup(billingGroup.id);
```

## API Reference

### Core Functions

#### `ensureBillingGroup(companyName, companyId)`

- **Purpose**: Get or create a billing group for a company
- **Returns**: `BillingGroup` object
- **Behavior**:
  - Checks if billing group exists with name `companyName-companyId`
  - Creates it if it doesn't exist
  - Returns existing one if found
- **Safety**: Will NOT proceed with any operations if billing group creation fails

#### `setupCompanyPhoneNumbers(companyName, companyId, phoneCount, options)`

- **Purpose**: Complete workflow to setup phone numbers for a company
- **Parameters**:
  - `companyName`: Company name from database
  - `companyId`: Company ID from database
  - `phoneCount`: Number of phone numbers to order (1-100)
  - `options`: Optional configuration
    - `country_iso`: Country code (default: 'US')
    - `phone_number_type`: 'local' | 'toll_free' | 'national' | 'mobile' (default: 'local')
    - `area_code`: Preferred area code
    - `state`: State abbreviation
- **Returns**: `{ billingGroup, order }`
- **Safety**: Ensures billing group exists before ordering

#### `orderPhoneNumbers(phoneNumbers, companyName, companyId)`

- **Purpose**: Order specific phone numbers
- **Parameters**:
  - `phoneNumbers`: Array of phone numbers in E.164 format (e.g., `['+12025551234']`)
  - `companyName`: Company name
  - `companyId`: Company ID
- **Returns**: `PhoneNumberOrder` object
- **Safety**: Ensures billing group exists before ordering

#### `bulkOrderPhoneNumbers(orderingGroups, companyName, companyId)`

- **Purpose**: Bulk order phone numbers (Telnyx auto-selects)
- **Note**: Only works for US/CA
- **Safety**: Ensures billing group exists before ordering

## Phone Number Types

- **`local`**: Local phone numbers (default)
- **`toll_free`**: Toll-free numbers (800, 888, 877, etc.)
- **`national`**: National numbers
- **`mobile`**: Mobile numbers

## Error Handling

All functions throw errors if:

- Billing group creation fails
- API authentication fails
- Invalid parameters provided
- Telnyx API returns an error

Example error handling:

```typescript
try {
	const result = await setupCompanyPhoneNumbers('Acme Corp', 'cm5abc123', 10);
	console.log('Success:', result);
} catch (error) {
	console.error('Failed to setup phone numbers:', error.message);
	// Error: "Failed to create or retrieve billing group. Cannot proceed with order."
}
```

## Billing Group Name Format

Billing groups are created with the format: `{company_name}-{company_id}`

Examples:

- Company: "Acme Corporation", ID: "cm5abc123" → `Acme Corporation-cm5abc123`
- Company: "Bob's Burgers!", ID: "cm5xyz789" → `Bobs Burgers-cm5xyz789`

**Note**: Special characters are removed from company names for safety.

## Cost Tracking

All phone numbers ordered through this integration are automatically associated with the company's billing group. This allows you to:

1. Track costs per company in Telnyx Mission Control
2. Generate billing reports per company
3. Separate invoicing for different companies

## Workflow Integration Example

Here's how you might integrate this into your company creation flow:

```typescript
// src/routes/(app)/create-company/+page.server.ts
import { setupCompanyPhoneNumbers } from '$lib/server/telnyx';

export const actions = {
	createCompany: async ({ request, locals }) => {
		const formData = await request.form();
		const companyName = formData.get('name');

		// 1. Create company in database
		const company = await prisma.company.create({
			data: {
				name: companyName,
				ownerId: locals.user.id
			}
		});

		// 2. Setup phone numbers with Telnyx
		try {
			const result = await setupCompanyPhoneNumbers(
				company.name,
				company.id,
				5, // Order 5 phone numbers
				{ phone_number_type: 'local' }
			);

			// 3. Save phone numbers to database
			for (const orderGroup of result.order.ordering_groups) {
				// Phone numbers will be available once order is fulfilled
				// You may need to poll the order status or use webhooks
			}

			return { success: true, company, telnyxOrder: result.order };
		} catch (error) {
			console.error('Failed to setup Telnyx:', error);
			// Company is created, but phone number setup failed
			// You can retry later or notify the user
			return { success: true, company, telnyxError: error.message };
		}
	}
};
```

## Checking Order Status

Phone number orders may take a few moments to fulfill. Check order status:

```typescript
import { getNumberOrderStatus } from '$lib/server/telnyx';

const orderStatus = await getNumberOrderStatus('order_123');
console.log(orderStatus.status); // 'pending', 'success', 'failed'
```

## Resources

- [Telnyx Billing Groups API](https://developers.telnyx.com/docs/api/v2/billing/Billing-Groups)
- [Telnyx Number Orders API](https://developers.telnyx.com/docs/api/v2/numbers/Number-Orders)
- [Telnyx Bulk Number Orders API](https://developers.telnyx.com/docs/api/v2/numbers/Number-Order-Documents)
