/**
 * Example script demonstrating Telnyx billing group and phone number ordering
 *
 * This script shows how to:
 * 1. Create a billing group for a company
 * 2. Order phone numbers associated with that billing group
 * 3. Retrieve billing group information
 *
 * Usage:
 *   node --loader ts-node/esm scripts/telnyx-example.ts
 */

import { prisma } from '../src/lib/db';
import {
	setupCompanyPhoneNumbers,
	ensureBillingGroup,
	listPhoneNumbersByBillingGroup,
	generateBillingGroupName
} from '../src/lib/server/telnyx';

async function main() {
	console.log('🚀 Telnyx Integration Example\n');

	// Example 1: Get a company from the database
	console.log('📋 Step 1: Fetching company from database...');
	const company = await prisma.company.findFirst({
		where: {
			name: { not: null }
		}
	});

	if (!company || !company.name) {
		console.error('❌ No company found with a name. Please create a company first.');
		process.exit(1);
	}

	console.log(`✓ Found company: ${company.name} (ID: ${company.id})\n`);

	// Example 2: Generate billing group name
	console.log('📋 Step 2: Generating billing group name...');
	const billingGroupName = generateBillingGroupName(company.name, company.id);
	console.log(`✓ Billing group name: ${billingGroupName}\n`);

	// Example 3: Ensure billing group exists
	console.log('📋 Step 3: Ensuring billing group exists...');
	try {
		const billingGroup = await ensureBillingGroup(company.name, company.id);
		console.log(`✓ Billing group ready:`);
		console.log(`  ID: ${billingGroup.id}`);
		console.log(`  Name: ${billingGroup.name}`);
		console.log(`  Created: ${billingGroup.created_at}\n`);

		// Example 4: List existing phone numbers
		console.log('📋 Step 4: Checking existing phone numbers...');
		const existingNumbers = await listPhoneNumbersByBillingGroup(billingGroup.id);
		console.log(`✓ Found ${existingNumbers.length} existing phone number(s):`);

		if (existingNumbers.length > 0) {
			existingNumbers.forEach((pn, index) => {
				console.log(`  ${index + 1}. ${pn.phone_number} (${pn.status})`);
			});
		} else {
			console.log('  (No phone numbers yet)');
		}
		console.log();

		// Example 5: Order new phone numbers (COMMENTED OUT - uncomment to actually order)
		/*
        console.log('📋 Step 5: Ordering new phone numbers...');
        console.log('⚠️  This will actually order phone numbers and charge your Telnyx account!');
        console.log('⚠️  Uncomment this section in the script to proceed.\n');
    	
        const result = await setupCompanyPhoneNumbers(
            company.name,
            company.id,
            5,  // Order 5 phone numbers
            {
                country_iso: 'US',
                phone_number_type: 'local',
                area_code: '202'  // Washington DC area code
            }
        );

        console.log(`✓ Order placed successfully:`);
        console.log(`  Order ID: ${result.order.id}`);
        console.log(`  Status: ${result.order.status}`);
        console.log(`  Requested: ${result.order.ordering_groups[0].count_requested} numbers`);
        console.log(`  Fulfilled: ${result.order.ordering_groups[0].count_fulfilled || 0} numbers\n`);

        console.log('💡 Note: Bulk orders may take a few moments to fulfill.');
        console.log('💡 Check order status in Telnyx Mission Control or use getNumberOrderStatus()');
        */

		console.log('\n✅ Example completed successfully!');
		console.log('\n📚 Next steps:');
		console.log('  1. Uncomment the ordering section to actually order phone numbers');
		console.log('  2. Check TELNYX_INTEGRATION.md for full documentation');
		console.log('  3. Use the API endpoint: POST /api/telnyx/setup-company');
	} catch (error) {
		console.error('\n❌ Error:', error instanceof Error ? error.message : error);
		console.error('\n💡 Make sure:');
		console.error('  1. TELNYX_API_KEY is set in your .env file');
		console.error('  2. Your Telnyx account has sufficient balance');
		console.error('  3. You have the necessary permissions');
		process.exit(1);
	}
}

// Run the example
main()
	.catch((error) => {
		console.error('Fatal error:', error);
		process.exit(1);
	})
	.finally(async () => {
		await prisma.$disconnect();
	});
