import { PrismaClient } from '../clearsky-db-client';

const prisma = new PrismaClient();

async function main() {
	console.log('🌱 Seeding pipeline reference data...');

	// 1. Get or create a default Company
	let company = await prisma.company.findFirst();
	if (!company) {
		console.log('No company found, creating a default seed company...');
		// Find any user to assign as owner
		let user = await prisma.user.findFirst();
		if (!user) {
			console.log('Creating a default user...');
			user = await prisma.user.create({
				data: {
					email: 'admin@clearsky.com',
					password: 'hashedpassword123', // placeholder
					name: 'Admin User',
					verified: true
				}
			});
		}
		company = await prisma.company.create({
			data: {
				name: 'ClearSky Contracting',
				ownerId: user.id
			}
		});
	}

	console.log(`Using company: ${company.name} (ID: ${company.id})`);

	// 2. Business Configuration
	await prisma.pipelineBusinessConfig.upsert({
		where: { companyId: company.id },
		update: {},
		create: {
			companyId: company.id,
			consultantId: 'cons_sarah_001',
			consultantName: 'Sarah Jenkins',
			consultantReviewRequired: true,
			primaryInternalOwner: 'consultant',
			approvalRoute: 'consultant_then_client',
			reviewReplyPolicy: 'draft_only',
			brandTone: 'professional'
		}
	});

	// 3. Client Orchestrator Profile
	await prisma.pipelineOrchestratorProfile.upsert({
		where: { companyId: company.id },
		update: {},
		create: {
			companyId: company.id,
			automationLevel: 'standard'
		}
	});

	// 4. Action Library
	const actions = [
		// REV Domain
		{
			actionId: 'ACT-REV-001',
			name: 'create_review_reply_draft',
			domain: 'REV',
			isPublicFacing: true,
			defaultExecutionMode: 'approval_required',
			defaultOwner: 'consultant',
			requiredParams: ['customer_name', 'rating', 'platform', 'brand_tone', 'review_text']
		},
		{
			actionId: 'ACT-REV-002',
			name: 'post_review_reply',
			domain: 'REV',
			isPublicFacing: true,
			defaultExecutionMode: 'approval_required',
			defaultOwner: 'consultant',
			requiredParams: ['customer_name', 'rating', 'platform']
		},
		{
			actionId: 'ACT-REV-004',
			name: 'log_review_complaint_theme',
			domain: 'REV',
			isPublicFacing: false,
			defaultExecutionMode: 'automatic',
			defaultOwner: 'system',
			requiredParams: ['ai_summary', 'sentiment', 'complaint_topics']
		},
		// A2P Domain
		{
			actionId: 'ACT-A2P-001',
			name: 'create_crm_lead',
			domain: 'A2P',
			isPublicFacing: false,
			defaultExecutionMode: 'automatic',
			defaultOwner: 'system',
			requiredParams: ['customer_name', 'phone_number', 'intent']
		},
		{
			actionId: 'ACT-A2P-002',
			name: 'alert_business_owner',
			domain: 'A2P',
			isPublicFacing: false,
			defaultExecutionMode: 'automatic',
			defaultOwner: 'system',
			requiredParams: ['customer_name', 'ai_summary', 'urgency_level']
		},
		{
			actionId: 'ACT-A2P-003',
			name: 'log_a2p_interaction',
			domain: 'A2P',
			isPublicFacing: false,
			defaultExecutionMode: 'automatic',
			defaultOwner: 'system',
			requiredParams: ['provider', 'event_type', 'ai_summary']
		},
		{
			actionId: 'ACT-A2P-004',
			name: 'create_emergency_dispatch_alert',
			domain: 'A2P',
			isPublicFacing: false,
			defaultExecutionMode: 'automatic_immediate',
			defaultOwner: 'system',
			requiredParams: ['customer_name', 'urgency_level', 'emergency_type']
		},
		{
			actionId: 'ACT-A2P-005',
			name: 'draft_callback_script',
			domain: 'A2P',
			isPublicFacing: false,
			defaultExecutionMode: 'approval_required',
			defaultOwner: 'consultant',
			requiredParams: ['customer_name', 'ai_summary']
		},
		{
			actionId: 'ACT-A2P-006',
			name: 'flag_churn_risk_in_profile',
			domain: 'A2P',
			isPublicFacing: false,
			defaultExecutionMode: 'automatic',
			defaultOwner: 'system',
			requiredParams: ['business_id', 'risk_score']
		},
		{
			actionId: 'ACT-A2P-007',
			name: 'send_sms_followup',
			domain: 'A2P',
			isPublicFacing: false,
			defaultExecutionMode: 'approval_required',
			defaultOwner: 'consultant',
			requiredParams: ['customer_name', 'phone_number']
		},
		// Epic 6 — job fulfillment (internal logging, automatic)
		{
			actionId: 'ACT-A2P-008',
			name: 'log_job_completed',
			domain: 'A2P',
			isPublicFacing: false,
			defaultExecutionMode: 'automatic',
			defaultOwner: 'system',
			requiredParams: ['transaction_id']
		},
		{
			actionId: 'ACT-A2P-009',
			name: 'log_transaction_update',
			domain: 'A2P',
			isPublicFacing: false,
			defaultExecutionMode: 'automatic',
			defaultOwner: 'system',
			requiredParams: ['transaction_id']
		},
		// Epic 7 — post-job growth (customer-facing, approval, Sarah's queue)
		{
			actionId: 'ACT-REV-008',
			name: 'send_review_request',
			domain: 'REV',
			isPublicFacing: true,
			defaultExecutionMode: 'approval_required',
			defaultOwner: 'consultant',
			requiredParams: ['customer_name', 'phone_number', 'gbp_link']
		},
		{
			actionId: 'ACT-REV-009',
			name: 'send_referral_request',
			domain: 'REV',
			isPublicFacing: true,
			defaultExecutionMode: 'approval_required',
			defaultOwner: 'consultant',
			requiredParams: ['customer_name', 'phone_number']
		},
		{
			actionId: 'ACT-COM-004',
			name: 'post_job_checkin',
			domain: 'COM',
			isPublicFacing: true,
			defaultExecutionMode: 'approval_required',
			defaultOwner: 'consultant',
			requiredParams: ['customer_name', 'phone_number']
		}
	];

	for (const action of actions) {
		await prisma.pipelineActionLibrary.upsert({
			where: { actionId: action.actionId },
			update: action,
			create: action
		});
	}

	// 5. Signal Action Mappings
	const mappings = [
		// A2P Domain Mappings
		{ signalRuleId: 'SIG-COMM-000', actionId: 'ACT-A2P-004', isPrimary: true, isSecondary: false },
		{ signalRuleId: 'SIG-COMM-000', actionId: 'ACT-A2P-002', isPrimary: false, isSecondary: true },
		{ signalRuleId: 'SIG-COMM-000', actionId: 'ACT-A2P-003', isPrimary: false, isSecondary: true },
		
		{ signalRuleId: 'SIG-COMM-001', actionId: 'ACT-A2P-002', isPrimary: true, isSecondary: false },
		{ signalRuleId: 'SIG-COMM-001', actionId: 'ACT-A2P-005', isPrimary: false, isSecondary: true },
		{ signalRuleId: 'SIG-COMM-001', actionId: 'ACT-A2P-003', isPrimary: false, isSecondary: true },

		{ signalRuleId: 'SIG-COMM-002', actionId: 'ACT-A2P-001', isPrimary: true, isSecondary: false },
		{ signalRuleId: 'SIG-COMM-002', actionId: 'ACT-A2P-003', isPrimary: false, isSecondary: true },

		{ signalRuleId: 'SIG-COMM-003', actionId: 'ACT-A2P-002', isPrimary: true, isSecondary: false },
		{ signalRuleId: 'SIG-COMM-003', actionId: 'ACT-A2P-006', isPrimary: false, isSecondary: true },
		{ signalRuleId: 'SIG-COMM-003', actionId: 'ACT-A2P-003', isPrimary: false, isSecondary: true },

		{ signalRuleId: 'SIG-COMM-004', actionId: 'ACT-A2P-005', isPrimary: true, isSecondary: false },
		{ signalRuleId: 'SIG-COMM-004', actionId: 'ACT-A2P-007', isPrimary: false, isSecondary: true },
		{ signalRuleId: 'SIG-COMM-004', actionId: 'ACT-A2P-003', isPrimary: false, isSecondary: true },

		{ signalRuleId: 'SIG-COMM-005', actionId: 'ACT-A2P-002', isPrimary: true, isSecondary: false },
		{ signalRuleId: 'SIG-COMM-005', actionId: 'ACT-A2P-003', isPrimary: false, isSecondary: true },

		{ signalRuleId: 'SIG-COMM-006', actionId: 'ACT-A2P-002', isPrimary: true, isSecondary: false },
		{ signalRuleId: 'SIG-COMM-006', actionId: 'ACT-A2P-006', isPrimary: false, isSecondary: true },
		{ signalRuleId: 'SIG-COMM-006', actionId: 'ACT-A2P-003', isPrimary: false, isSecondary: true },

		{ signalRuleId: 'SIG-COMM-007', actionId: 'ACT-A2P-003', isPrimary: true, isSecondary: false },

		// REV Domain Mappings
		{ signalRuleId: 'SIG-TRUST-001', actionId: 'ACT-REV-001', isPrimary: true, isSecondary: false },
		{ signalRuleId: 'SIG-TRUST-001', actionId: 'ACT-REV-004', isPrimary: false, isSecondary: true },
		
		{ signalRuleId: 'SIG-TRUST-002', actionId: 'ACT-REV-001', isPrimary: true, isSecondary: false },
		{ signalRuleId: 'SIG-TRUST-003', actionId: 'ACT-REV-001', isPrimary: true, isSecondary: false },
		
		{ signalRuleId: 'SIG-TRUST-004', actionId: 'ACT-REV-001', isPrimary: true, isSecondary: false },
		{ signalRuleId: 'SIG-TRUST-004', actionId: 'ACT-REV-004', isPrimary: false, isSecondary: true },
		
		{ signalRuleId: 'SIG-TRUST-005', actionId: 'ACT-REV-004', isPrimary: true, isSecondary: false },
		{ signalRuleId: 'SIG-TRUST-006', actionId: 'ACT-REV-001', isPrimary: true, isSecondary: false },
		{ signalRuleId: 'SIG-TRUST-007', actionId: 'ACT-REV-001', isPrimary: true, isSecondary: false },
		{ signalRuleId: 'SIG-TRUST-008', actionId: 'ACT-REV-001', isPrimary: true, isSecondary: false },
		{ signalRuleId: 'SIG-TRUST-009', actionId: 'ACT-REV-001', isPrimary: true, isSecondary: false },
		{ signalRuleId: 'SIG-TRUST-010', actionId: 'ACT-REV-004', isPrimary: true, isSecondary: false },
		{ signalRuleId: 'SIG-TRUST-011', actionId: 'ACT-REV-004', isPrimary: true, isSecondary: false },
		{ signalRuleId: 'SIG-TRUST-012', actionId: 'ACT-REV-004', isPrimary: true, isSecondary: false },
		{ signalRuleId: 'SIG-TRUST-013', actionId: 'ACT-REV-004', isPrimary: true, isSecondary: false },
		{ signalRuleId: 'SIG-TRUST-014', actionId: 'ACT-REV-004', isPrimary: true, isSecondary: false },
		{ signalRuleId: 'SIG-TRUST-015', actionId: 'ACT-REV-001', isPrimary: true, isSecondary: false },
		{ signalRuleId: 'SIG-TRUST-016', actionId: 'ACT-REV-001', isPrimary: true, isSecondary: false },
		
		{ signalRuleId: 'SIG-TRUST-017', actionId: 'ACT-REV-001', isPrimary: true, isSecondary: false },
		{ signalRuleId: 'SIG-TRUST-017', actionId: 'ACT-REV-004', isPrimary: false, isSecondary: true }
	];

	// Clean existing mappings first to avoid key conflicts
	await prisma.pipelineSignalActionMapping.deleteMany();

	for (const mapping of mappings) {
		await prisma.pipelineSignalActionMapping.create({
			data: mapping
		});
	}

	// 6. Safety Rules
	const safetyRules = [
		{
			ruleId: 'SAF-000',
			ruleName: 'Emergency actions bypass all safety blocks',
			conditions: {
				signalRuleId: { operator: '=', value: 'SIG-COMM-000' }
			},
			blockReason: 'null — never blocked',
			severity: 0
		},
		{
			ruleId: 'SAF-001',
			ruleName: 'Block automatic posting of public replies',
			conditions: {
				actionId: { operator: '=', value: 'ACT-REV-002' },
				executionMode: { operator: '=', value: 'automatic' }
			},
			blockReason: 'Safety policy prevents automatic public posting',
			severity: 10
		},
		{
			ruleId: 'SAF-002',
			ruleName: 'Block automatic execution of approval-required A2P actions',
			conditions: {
				actionId: { operator: 'in', value: ['ACT-A2P-005', 'ACT-A2P-007'] },
				executionMode: { operator: '=', value: 'automatic' }
			},
			blockReason: 'Callback scripts and SMS require human review',
			severity: 10
		},
		{
			ruleId: 'SAF-003',
			ruleName: 'Block SMS follow-up if caller not opted in',
			conditions: {
				actionId: { operator: '=', value: 'ACT-A2P-007' },
				smsOptedIn: { operator: '=', value: false }
			},
			blockReason: 'SMS opt-in not confirmed — ACT-A2P-007 suppressed',
			severity: 9
		},
		{
			ruleId: 'SAF-004',
			ruleName: 'Low confidence AI block',
			conditions: {
				aiConfidenceScore: { operator: '<', value: 0.75 },
				actionIsPublicFacing: { operator: '=', value: true }
			},
			blockReason: 'AI confidence too low for public-facing actions',
			severity: 8
		}
	];

	for (const rule of safetyRules) {
		await prisma.pipelineSafetyRule.upsert({
			where: { ruleId: rule.ruleId },
			update: rule,
			create: rule
		});
	}

	// 7. Orchestrator Rules
	const orchestratorRules = [
		{
			ruleId: 'ORC-REV-001',
			ruleName: 'Suppress Response Needed if Risk Detected',
			signalRuleId: 'SIG-TRUST-001',
			suppressSignals: ['SIG-TRUST-008'],
			scope: 'global'
		},
		{
			ruleId: 'ORC-A2P-001',
			ruleName: 'Emergency signal suppresses all other A2P signals',
			signalRuleId: 'SIG-COMM-000',
			suppressSignals: ['SIG-COMM-001', 'SIG-COMM-002', 'SIG-COMM-003', 'SIG-COMM-004', 'SIG-COMM-005', 'SIG-COMM-006', 'SIG-COMM-007'],
			scope: 'global'
		},
		{
			ruleId: 'ORC-A2P-002',
			ruleName: 'Churn risk suppresses general inquiry',
			signalRuleId: 'SIG-COMM-003',
			suppressSignals: ['SIG-COMM-007'],
			scope: 'global'
		}
	];

	for (const rule of orchestratorRules) {
		await prisma.pipelineOrchestratorRule.upsert({
			where: { ruleId: rule.ruleId },
			update: rule,
			create: rule
		});
	}

	console.log('✅ Seeding complete.');
}

main()
	.catch((e) => {
		console.error(e);
		process.exit(1);
	})
	.finally(async () => {
		await prisma.$disconnect();
	});
