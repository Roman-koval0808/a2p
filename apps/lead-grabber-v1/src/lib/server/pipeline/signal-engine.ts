import { prisma } from '$lib/db';
import { GBP_REVIEW_RULES, TELNYX_SIGNAL_RULES, type SignalRule, type RuleCondition } from './signal-rules';

export class SignalEngine {
	static async evaluate(eventId: string, existingTrace: string[] = []) {
		const trace: string[] = [...existingTrace];
		// 1. Fetch Event and Enrichment
		const event = await prisma.pipelineEvent.findUnique({
			where: { id: eventId },
			include: { enrichments: true, company: true }
		});

		const log = (msg: string, data?: any) => {
			const timestamp = new Date().toISOString().replace('T', ' ').replace('Z', '');
			
			let statusIcon = '🔵';
			if (msg.startsWith('Rule ')) statusIcon = '🌸';
			if (msg.includes('Match Found')) statusIcon = '🎯';
			if (msg.includes('Family Group')) statusIcon = '📁';
			
			let entry = `${statusIcon} [${timestamp}] ${msg}`;
			if (data) {
				const dataStr = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
				entry += `\n   ╰─ Context: ${dataStr.replace(/\n/g, '\n   ')}`;
			}
			console.log(entry);
			trace.push(entry);
		};

		if (!event) {
			log(`🔴 [ERROR] Signal Engine: Event not found: ${eventId}`);
			return { success: false, error: 'Event not found', trace };
		}

		log(`[Step 10] Signal Detection: Loading the Signal Rule book specific to "${event.eventType}" events for ${event.provider}`);

		const enrichment = event.enrichments?.[0];
		if (!enrichment && event.requiresAiExtraction) {
			log(`[Signal Engine] Waiting for enrichment for Event: ${eventId}`);
			return { success: false, error: 'Enrichment not yet available', trace };
		}

		// 2. Select Rules based on Provider/Type
		let rules: SignalRule[] = [];
		let families: any[] = [];

		if (event.provider === 'google_business_profile' && event.eventType === 'review_received') {
			rules = GBP_REVIEW_RULES;
			families = [
				{ name: 'Rating Rules', emoji: '⭐', start: 1, end: 3 },
				{ name: 'Comment Rules', emoji: '💬', start: 4, end: 6 },
				{ name: 'Response Status Rules', emoji: '📬', start: 7, end: 9 },
				{ name: 'Pattern Rules', emoji: '📈', start: 10, end: 12 },
				{ name: 'Competitive Rules', emoji: '⚔️', start: 13, end: 14 },
				{ name: 'Marketing Rules', emoji: '📣', start: 15, end: 16 },
				{ name: 'Liability & Safety Rules', emoji: '⚖️', start: 17, end: 17 }
			];
		} else if ((event.provider && event.provider.includes('telnyx')) || event.provider === 'email_provider' || event.provider === 'google_workspace_email' || event.provider === 'contentradar' || event.eventType === 'faq_received' || event.eventType === 'sms_received') {
			rules = TELNYX_SIGNAL_RULES;
			families = [
				{ name: 'Communication Priority Rules', emoji: '📞', start: 1, end: rules.length }
			];
		} else {
			log(`[Step 10] Signal Detection: No rule book defined for provider: ${event.provider}`);
			return { success: true, signal_count: 0, trace };
		}

		// 3. Build Evaluation Context
		const context = await this.buildContext(event, enrichment);
		log(`[Step 11] Signal Evaluation: Testing event against ${rules.length} total rules...`);

		// 4. Evaluate Rules
		const signalsToCreate = [];

		let ruleIndex = 1;
		for (const family of families) {
			log(`--- ${family.emoji} Family Group: ${family.name} ---`);
			
			const familyRules = rules.slice(family.start - 1, family.end);
			
			for (const rule of familyRules) {
				if (!rule.active) {
					ruleIndex++;
					continue;
				}
				
				const { isMatch, reason } = this.evaluateRuleWithReason(rule, context);
				const statusIcon = isMatch ? '✅ MATCHED' : '⚪ SKIPPED';
				
				log(`Rule ${ruleIndex} {${rule.signal_rule_id}}: ${rule.signal_name} -> ${statusIcon}\n      → ${reason}`);

				if (isMatch) {
					signalsToCreate.push({
						name: rule.signal_name,
						bucket: rule.signal_bucket,
						priority: rule.default_priority,
						confidence: rule.default_confidence,
						signalRuleId: rule.signal_rule_id,
						eventId: event.id
					});
				}
				ruleIndex++;
			}
		}

		// 5. Persist Signals
		if (signalsToCreate.length > 0) {
			await prisma.pipelineSignal.createMany({
				data: signalsToCreate
			});
			log(`[Step 12] Final Count: Created ${signalsToCreate.length} Signal candidates.`);
		} else {
			log(`[Step 12] Final Count: No signals matched this event.`);
		}

		return { success: true, signal_count: signalsToCreate.length, trace };
	}

	private static evaluateRuleWithReason(rule: SignalRule, context: any): { isMatch: boolean; reason: string } {
		const failures: string[] = [];
		const successes: string[] = [];

		for (const [field, condition] of Object.entries(rule.conditions)) {
			const actualValue = context[field];
			const { pass, detail } = this.checkCondition(field, condition, actualValue);
			
			if (pass) {
				successes.push(detail);
			} else {
				failures.push(detail);
			}
		}

		if (failures.length > 0) {
			return { isMatch: false, reason: failures[0] }; // Show first failure as the "Why Not"
		}

		return { isMatch: true, reason: successes.join(', ') };
	}

	private static checkCondition(field: string, condition: RuleCondition, actual: any): { pass: boolean; detail: string } {
		const { operator, value } = condition;
		const fieldName = field.replace('ai_context.', '').replace(/_/g, ' ');
		
		const formatVal = (v: any) => Array.isArray(v) ? `[${v.join(', ')}]` : v;

		let pass = false;
		let detail = '';

		const tryFloat = (v: any) => {
			if (v === null || v === undefined) return NaN;
			return parseFloat(v);
		};

		switch (operator) {
			case '=':
				pass = actual == value; // Loose equal for number/string compatibility
				detail = pass 
					? `${fieldName} is exactly ${value}` 
					: `${fieldName} ${actual} is not ${value}`;
				break;
			case '!=':
				pass = actual != value;
				detail = pass 
					? `${fieldName} is not ${value}` 
					: `${fieldName} is exactly ${value}`;
				break;
			case '>':
				pass = tryFloat(actual) > tryFloat(value);
				detail = pass 
					? `${fieldName} ${actual} is > ${value}` 
					: `${fieldName} ${actual} is not greater than ${value}`;
				break;
			case '>=':
				pass = tryFloat(actual) >= tryFloat(value);
				detail = pass 
					? `${fieldName} ${actual} is >= ${value}` 
					: `${fieldName} ${actual} is below threshold ${value}`;
				break;
			case '<':
				pass = tryFloat(actual) < tryFloat(value);
				detail = pass 
					? `${fieldName} ${actual} is < ${value}` 
					: `${fieldName} ${actual} is not less than ${value}`;
				break;
			case '<=':
				pass = tryFloat(actual) <= tryFloat(value);
				detail = pass 
					? `${fieldName} ${actual} is <= ${value}` 
					: `${fieldName} ${actual} is above risk threshold ${value}`;
				break;
			case 'contains':
				if (actual === null || actual === undefined) {
					pass = false;
					detail = `${fieldName} is missing`;
				} else if (typeof actual === 'string') {
					pass = actual.toLowerCase().includes(String(value).toLowerCase());
					detail = pass ? `${fieldName} contains "${value}"` : `${fieldName} does not contain "${value}"`;
				} else if (Array.isArray(actual)) {
					pass = actual.includes(value);
					detail = pass ? `${fieldName} contains ${value}` : `${fieldName} does not contain ${value}`;
				} else {
					pass = false;
					detail = `${fieldName} type mismatch for contains`;
				}
				break;
			case 'contains_any':
				if (actual === null || actual === undefined) {
					pass = false;
					detail = `${fieldName} data missing`;
				} else if (!Array.isArray(value)) {
					pass = false;
					detail = `operator requires list value`;
				} else {
					const actualList = Array.isArray(actual) ? actual.map(v => String(v).toLowerCase()) : [String(actual).toLowerCase()];
					const matches = value.filter((v: string) => 
						actualList.some((av: string) => av.includes(v.toLowerCase()))
					);
					pass = matches.length > 0;
					detail = pass 
						? `${fieldName} mentions ${matches.join(', ')}` 
						: `${fieldName} does not mention requested topics`;
				}
				break;
			case 'contains_all':
				if (!Array.isArray(actual)) {
					pass = false;
					detail = `${fieldName} is not a list`;
				} else if (!Array.isArray(value)) {
					pass = false;
					detail = `operator requires list value`;
				} else {
					const actualLower = actual.map(v => String(v).toLowerCase());
					pass = value.every(v => actualLower.includes(String(v).toLowerCase()));
					detail = pass ? `${fieldName} contains all requested` : `${fieldName} missing some topics`;
				}
				break;
			case 'in':
				pass = Array.isArray(value) && value.includes(actual);
				detail = pass ? `${fieldName} is in list` : `${fieldName} is not in allowed list`;
				break;
			case 'not_in':
				pass = Array.isArray(value) && !value.includes(actual);
				detail = pass ? `${fieldName} is not in list` : `${fieldName} is in restricted list`;
				break;
			case 'exists':
			case 'not_empty':
			case 'is_not_null':
				pass = actual !== null && actual !== undefined && (typeof actual === 'string' ? actual.length > 0 : true) && (Array.isArray(actual) ? actual.length > 0 : true);
				detail = pass ? `${fieldName} exists` : `${fieldName} is empty or missing`;
				break;
			case 'not_exists':
			case 'empty':
			case 'is_null':
				pass = actual === null || actual === undefined || (typeof actual === 'string' ? actual.length === 0 : false) || (Array.isArray(actual) ? actual.length === 0 : false);
				detail = pass ? `${fieldName} is empty or missing` : `${fieldName} has data`;
				break;
			default:
				detail = `Unknown operator ${operator}`;
		}

		return { pass, detail };
	}

	private static async buildContext(event: any, enrichment: any) {
		const now = new Date();
		const occurredAt = event.occurredAt || event.receivedAt || now;
		const elapsedHours = (now.getTime() - occurredAt.getTime()) / (1000 * 60 * 60);

		// Basic fields
		const context: any = {
			'review_rating': event.reviewRatingNumeric,
			'business_reply_completed': event.businessReplyExists,
			'elapsed_hours': elapsedHours,
			'ai_context.complaint_topics': enrichment?.aiComplaintTopics ? (typeof enrichment.aiComplaintTopics === 'string' ? JSON.parse(enrichment.aiComplaintTopics) : enrichment.aiComplaintTopics) : [],
			'ai_context.praise_topics': enrichment?.aiPraiseTopics ? (typeof enrichment.aiPraiseTopics === 'string' ? JSON.parse(enrichment.aiPraiseTopics) : enrichment.aiPraiseTopics) : [],
			'ai_context.confidence_score': enrichment?.aiConfidenceScore || 0,
			'ai_context.service_mentioned': enrichment?.aiServiceMentioned || null,
			'ai_context.urgency_level': enrichment?.aiUrgencyLevel || null,
			'ai_context.intent': enrichment?.aiRequestedAction || null,
			'ai_context.complaint_detected': enrichment?.aiComplaintDetected || false,
			
			// New Deterministic Facts
			'ai_context.contains_problem': enrichment?.aiContainsProblem || false,
			'ai_context.contains_quote_request': enrichment?.aiContainsQuoteRequest || false,
			'ai_context.contains_callback_request': enrichment?.aiContainsCallbackRequest || false,
			'ai_context.contains_emergency_keywords': enrichment?.aiContainsEmergencyKeywords || false,
			'ai_context.requested_contact_method': enrichment?.aiRequestedContactMethod || 'none',
			'ai_context.requested_action': enrichment?.aiRequestedAction || null,
			'ai_context.sentiment': enrichment?.aiSentiment || null
		};

		// Aggregations (Historical Patterns)
		if (event.companyId) {
			const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
			const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
			const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

			// Count communication complaints in last 30 days
			// Since complaint_topics is stored as Json, we fetch and aggregate programmatically or with raw Prisma filters
			const last30Enrichments = await prisma.pipelineEnrichment.findMany({
				where: {
					event: {
						companyId: event.companyId,
						occurredAt: { gte: thirtyDaysAgo }
					}
				},
				select: {
					aiComplaintTopics: true
				}
			});

			let communicationComplaints = 0;
			for (const enr of last30Enrichments) {
				const topics = enr.aiComplaintTopics ? (typeof enr.aiComplaintTopics === 'string' ? JSON.parse(enr.aiComplaintTopics) : enr.aiComplaintTopics) : [];
				if (Array.isArray(topics) && topics.some((t: string) => String(t).toLowerCase().includes('communication'))) {
					communicationComplaints++;
				}
			}

			context['count_reviews_with_communication_complaints_last_30_days'] = communicationComplaints;

			// Average rating last 30 days
			const avgRating30 = await prisma.pipelineEvent.aggregate({
				where: {
					companyId: event.companyId,
					occurredAt: { gte: thirtyDaysAgo },
					eventType: 'review_received'
				},
				_avg: { reviewRatingNumeric: true }
			});
			const currentAvg = avgRating30._avg.reviewRatingNumeric || 0;
			context['average_review_rating_last_30_days'] = currentAvg;

			// Average rating previous 90 days
			const avgRating90 = await prisma.pipelineEvent.aggregate({
				where: {
					companyId: event.companyId,
					occurredAt: { gte: ninetyDaysAgo, lt: thirtyDaysAgo },
					eventType: 'review_received'
				},
				_avg: { reviewRatingNumeric: true }
			});
			const previousAvg = avgRating90._avg.reviewRatingNumeric || 0;
			context['average_review_rating_previous_90_days'] = previousAvg;

			// Rating drop detection
			context['rating_drop_detected'] = (previousAvg - currentAvg) >= 0.4 && previousAvg > 0;

			// Review counts for momentum
			const count30 = await prisma.pipelineEvent.count({
				where: {
					companyId: event.companyId,
					occurredAt: { gte: thirtyDaysAgo },
					eventType: 'review_received'
				}
			});
			const countPrev30 = await prisma.pipelineEvent.count({
				where: {
					companyId: event.companyId,
					occurredAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo },
					eventType: 'review_received'
				}
			});
			context['count_reviews_last_30_days'] = count30;
			context['count_reviews_previous_30_days'] = countPrev30;
			context['momentum_increasing'] = count30 > countPrev30 && currentAvg >= 4.5;

			// Competitive Placeholders (Mocked for now as we don't have competitor data table)
			context['review_velocity_lagging'] = false; // Need competitor data
			context['reputation_advantage_detected'] = false; // Need competitor data
		}

		return context;
	}
}
