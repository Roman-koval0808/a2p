/**
 * Signal Rules Definition for ClearSky
 * Based on Part 10: Signal Evaluation
 */

export interface RuleCondition {
	operator: '>=' | '<=' | '=' | '!=' | '>' | '<' | 'not_empty' | 'empty' | 'contains_any' | 'is_null' | 'is_not_null';
	value?: any;
}

export interface SignalRule {
	signal_rule_id: string;
	signal_name: string;
	event_type: string;
	provider?: string;
	network_category?: string;
	signal_bucket: string;
	active: boolean;
	conditions: Record<string, RuleCondition>;
	required_fields: string[];
	cooldown_hours?: number;
	default_priority: number;
	default_confidence: number;
	purpose?: string;
}

export const GBP_REVIEW_RULES: SignalRule[] = [
	// Rule Family Group 1: Review Rating Rules
	{
		signal_rule_id: 'SIG-TRUST-001',
		signal_name: 'negative_review_risk',
		event_type: 'review_received',
		provider: 'google_business_profile',
		network_category: 'Trust',
		signal_bucket: 'Risk',
		active: true,
		conditions: {
			'review_rating': { operator: '<=', value: 2 }
		},
		required_fields: ['review_rating'],
		default_priority: 1,
		default_confidence: 1.0,
		purpose: 'A 1-star or 2-star review may damage trust and should be reviewed quickly.'
	},
	{
		signal_rule_id: 'SIG-TRUST-002',
		signal_name: 'neutral_review_improvement_opportunity',
		event_type: 'review_received',
		provider: 'google_business_profile',
		network_category: 'Trust',
		signal_bucket: 'Opportunity',
		active: true,
		conditions: {
			'review_rating': { operator: '=', value: 3 }
		},
		required_fields: ['review_rating'],
		default_priority: 2,
		default_confidence: 1.0,
		purpose: 'A 3-star review may show a fixable customer experience issue.'
	},
	{
		signal_rule_id: 'SIG-TRUST-003',
		signal_name: 'positive_review_received',
		event_type: 'review_received',
		provider: 'google_business_profile',
		network_category: 'Trust',
		signal_bucket: 'Momentum',
		active: true,
		conditions: {
			'review_rating': { operator: '>=', value: 4 }
		},
		required_fields: ['review_rating'],
		default_priority: 3,
		default_confidence: 1.0,
		purpose: 'A 4-star or 5-star review adds trust momentum.'
	},

	// Rule Family Group 2: Review Comment Rules
	{
		signal_rule_id: 'SIG-TRUST-004',
		signal_name: 'positive_review_with_minor_issue',
		event_type: 'review_received',
		provider: 'google_business_profile',
		network_category: 'Trust',
		signal_bucket: 'Opportunity',
		active: true,
		conditions: {
			'review_rating': { operator: '>=', value: 4 },
			'ai_context.contains_problem': { operator: '=', value: true },
			'ai_context.confidence_score': { operator: '>=', value: 0.8 }
		},
		required_fields: ['business_id', 'review_rating', 'review_text', 'ai_context.contains_problem'],
		cooldown_hours: 24,
		default_priority: 3,
		default_confidence: 0.88,
		purpose: 'The customer is generally happy, but the review reveals a specific issue the business can improve.'
	},
	{
		signal_rule_id: 'SIG-TRUST-005',
		signal_name: 'communication_experience_issue_detected',
		event_type: 'review_received',
		provider: 'google_business_profile',
		network_category: 'Trust',
		signal_bucket: 'Bottleneck',
		active: true,
		conditions: {
			'ai_context.contains_problem': { operator: '=', value: true },
			'ai_context.complaint_topics': { 
				operator: 'contains_any', 
				value: ['communication', 'slow response', 'not called back', 'poor follow-up', 'appointment communication'] 
			},
			'ai_context.confidence_score': { operator: '>=', value: 0.8 }
		},
		required_fields: ['business_id', 'review_text', 'ai_context.contains_problem'],
		cooldown_hours: 72,
		default_priority: 2,
		default_confidence: 0.9,
		purpose: 'The review suggests a communication process issue specifically identified as a problem.'
	},
	{
		signal_rule_id: 'SIG-TRUST-006',
		signal_name: 'service_quality_praise_detected',
		event_type: 'review_received',
		provider: 'google_business_profile',
		network_category: 'Trust',
		signal_bucket: 'Momentum',
		active: true,
		conditions: {
			'ai_context.praise_topics': { operator: 'not_empty' },
			'ai_context.contains_problem': { operator: '=', value: false },
			'review_rating': { operator: '>=', value: 4 },
			'ai_context.confidence_score': { operator: '>=', value: 0.8 }
		},
		required_fields: ['review_rating', 'ai_context.praise_topics'],
		default_priority: 3,
		default_confidence: 0.9,
		purpose: 'The review contains positive language with no identified problems.'
	},

	// Rule Family Group 3: Response Status Rules
	{
		signal_rule_id: 'SIG-TRUST-007',
		signal_name: 'positive_review_reply_needed',
		event_type: 'review_received',
		provider: 'google_business_profile',
		network_category: 'Trust',
		signal_bucket: 'Opportunity',
		active: true,
		conditions: {
			'review_rating': { operator: '>=', value: 4 },
			'business_reply_completed': { operator: '=', value: false },
			'elapsed_hours': { operator: '>=', value: 24 }
		},
		required_fields: ['business_id', 'review_rating', 'business_reply_completed'],
		default_priority: 2,
		default_confidence: 0.9,
		purpose: 'A business should still respond to positive reviews to strengthen trust and show engagement.'
	},
	{
		signal_rule_id: 'SIG-TRUST-008',
		signal_name: 'negative_review_response_needed',
		event_type: 'review_received',
		provider: 'google_business_profile',
		network_category: 'Trust',
		signal_bucket: 'Risk',
		active: true,
		conditions: {
			'review_rating': { operator: '<=', value: 2 },
			'business_reply_completed': { operator: '=', value: false },
			'elapsed_hours': { operator: '>=', value: 2 }
		},
		required_fields: ['business_id', 'review_rating', 'business_reply_completed'],
		default_priority: 1,
		default_confidence: 0.9,
		purpose: 'Negative reviews need a faster response window.'
	},
	{
		signal_rule_id: 'SIG-TRUST-009',
		signal_name: 'mixed_review_reply_needed',
		event_type: 'review_received',
		provider: 'google_business_profile',
		network_category: 'Trust',
		signal_bucket: 'Opportunity',
		active: true,
		conditions: {
			'review_rating': { operator: '>=', value: 4 },
			'ai_context.contains_problem': { operator: '=', value: true },
			'business_reply_completed': { operator: '=', value: false },
			'elapsed_hours': { operator: '>=', value: 12 }
		},
		required_fields: ['business_id', 'review_rating', 'ai_context.contains_problem', 'business_reply_completed'],
		cooldown_hours: 48,
		default_priority: 2,
		default_confidence: 0.9,
		purpose: 'A mostly positive review with an identified problem is a chance to thank the customer and acknowledge the improvement area.'
	},

	// Rule Family Group 4: Pattern Rules Across Multiple Reviews
	{
		signal_rule_id: 'SIG-TRUST-010',
		signal_name: 'repeated_communication_bottleneck_detected',
		event_type: 'review_received',
		provider: 'google_business_profile',
		network_category: 'Trust',
		signal_bucket: 'Bottleneck',
		active: true,
		conditions: {
			'ai_context.complaint_topics': { 
				operator: 'contains_any', 
				value: ['communication', 'slow response', 'not called back', 'poor follow-up', 'appointment communication'] 
			},
			'count_reviews_with_communication_complaints_last_30_days': { operator: '>=', value: 3 }
		},
		required_fields: ['business_id', 'ai_context.complaint_topics'],
		default_priority: 1,
		default_confidence: 0.9,
		purpose: 'One communication complaint may be a minor issue. Three in 30 days may indicate a real process problem.'
	},
	{
		signal_rule_id: 'SIG-TRUST-011',
		signal_name: 'review_rating_decline_detected',
		event_type: 'review_received',
		provider: 'google_business_profile',
		network_category: 'Trust',
		signal_bucket: 'Performance',
		active: true,
		conditions: {
			'rating_drop_detected': { operator: '=', value: true }
		},
		required_fields: ['business_id'],
		default_priority: 1,
		default_confidence: 0.9,
		purpose: 'The business reputation may be weakening.'
	},
	{
		signal_rule_id: 'SIG-TRUST-012',
		signal_name: 'review_momentum_increasing',
		event_type: 'review_received',
		provider: 'google_business_profile',
		network_category: 'Trust',
		signal_bucket: 'Momentum',
		active: true,
		conditions: {
			'count_reviews_last_30_days': { operator: '>', value: 0 },
			'momentum_increasing': { operator: '=', value: true }
		},
		required_fields: ['business_id'],
		default_priority: 3,
		default_confidence: 0.9,
		purpose: 'The business is gaining trust momentum.'
	},

	// Rule Family Group 5: Competitive / Market Rules
	{
		signal_rule_id: 'SIG-TRUST-013',
		signal_name: 'review_velocity_competitive_gap',
		event_type: 'review_received',
		provider: 'google_business_profile',
		network_category: 'Trust',
		signal_bucket: 'Competitive',
		active: true,
		conditions: {
			'review_velocity_lagging': { operator: '=', value: true }
		},
		required_fields: ['business_id'],
		default_priority: 2,
		default_confidence: 0.85,
		purpose: 'The business may be falling behind competitors in review acquisition.'
	},
	{
		signal_rule_id: 'SIG-TRUST-014',
		signal_name: 'reputation_advantage_detected',
		event_type: 'review_received',
		provider: 'google_business_profile',
		network_category: 'Trust',
		signal_bucket: 'Competitive',
		active: true,
		conditions: {
			'reputation_advantage_detected': { operator: '=', value: true }
		},
		required_fields: ['business_id'],
		default_priority: 3,
		default_confidence: 0.85,
		purpose: 'The business may have a reputation advantage that can be used in marketing.'
	},

	// Rule Family Group 6: Content / Marketing Rules
	{
		signal_rule_id: 'SIG-TRUST-015',
		signal_name: 'testimonial_candidate_detected',
		event_type: 'review_received',
		provider: 'google_business_profile',
		network_category: 'Trust',
		signal_bucket: 'Opportunity',
		active: true,
		conditions: {
			'review_rating': { operator: '>=', value: 4 },
			'ai_context.praise_topics': { operator: 'not_empty' },
			'ai_context.complaint_topics': { operator: 'empty' },
			'ai_context.confidence_score': { operator: '>=', value: 0.85 }
		},
		required_fields: ['review_rating', 'ai_context.praise_topics', 'ai_context.complaint_topics'],
		default_priority: 3,
		default_confidence: 0.9,
		purpose: 'A strong positive review may be useful as a testimonial.'
	},
	{
		signal_rule_id: 'SIG-TRUST-016',
		signal_name: 'service_proof_point_detected',
		event_type: 'review_received',
		provider: 'google_business_profile',
		network_category: 'Trust',
		signal_bucket: 'Opportunity',
		active: true,
		conditions: {
			'ai_context.service_mentioned': { operator: 'is_not_null' },
			'review_rating': { operator: '>=', value: 4 },
			'ai_context.praise_topics': { operator: 'not_empty' }
		},
		required_fields: ['ai_context.service_mentioned', 'review_rating', 'ai_context.praise_topics'],
		default_priority: 3,
		default_confidence: 0.9,
		purpose: 'The review provides proof that the business performed well on a specific service.'
	},
	{
		signal_rule_id: 'SIG-TRUST-017',
		signal_name: 'safety_compliance_risk_detected',
		event_type: 'review_received',
		provider: 'google_business_profile',
		network_category: 'Trust',
		signal_bucket: 'Risk',
		active: true,
		conditions: {
			'ai_context.contains_emergency_keywords': { operator: '=', value: true },
			'ai_context.contains_problem': { operator: '=', value: true },
			'ai_context.confidence_score': { operator: '>=', value: 0.8 }
		},
		required_fields: ['business_id', 'review_text', 'ai_context.contains_emergency_keywords'],
		default_priority: 1,
		default_confidence: 0.9,
		purpose: 'The review mentions a safety concern or emergency situation which is a high-risk liability.'
	}
];

export const TELNYX_SIGNAL_RULES: SignalRule[] = [
	{
		signal_rule_id: 'SIG-COMM-000',
		signal_name: 'EMERGENCY_SERVICE',
		event_type: 'voicemail_received', // will match sms_received or voicemail_received semantically in evaluation
		provider: 'telnyx_voice',
		network_category: 'Communication',
		signal_bucket: 'Risk',
		active: true,
		conditions: {
			'ai_context.contains_emergency_keywords': { operator: '=', value: true }
		},
		required_fields: ['ai_context.contains_emergency_keywords'],
		default_priority: 1,
		default_confidence: 1.0,
		purpose: 'Critical emergency services requiring immediate dispatch bypass.'
	},
	{
		signal_rule_id: 'SIG-COMM-001',
		signal_name: 'HIGH_PRIORITY_CONTACT',
		event_type: 'voicemail_received',
		provider: 'telnyx_voice',
		network_category: 'Communication',
		signal_bucket: 'Risk',
		active: true,
		conditions: {
			'ai_context.contains_quote_request': { operator: '=', value: true },
			'ai_context.contains_callback_request': { operator: '=', value: true }
		},
		required_fields: ['ai_context.contains_quote_request', 'ai_context.contains_callback_request'],
		default_priority: 1,
		default_confidence: 0.95,
		purpose: 'Quote requests combined with callback requests are high-value leads requiring immediate response.'
	},
	{
		signal_rule_id: 'SIG-COMM-002',
		signal_name: 'NEW_QUOTE_REQUEST',
		event_type: 'voicemail_received',
		provider: 'telnyx_voice',
		network_category: 'Communication',
		signal_bucket: 'Opportunity',
		active: true,
		conditions: {
			'ai_context.contains_quote_request': { operator: '=', value: true }
		},
		required_fields: ['ai_context.contains_quote_request'],
		default_priority: 1,
		default_confidence: 0.9,
		purpose: 'Potential new business leads asking for pricing.'
	},
	{
		signal_rule_id: 'SIG-COMM-003',
		signal_name: 'CRITICAL_CHURN_RISK',
		event_type: 'voicemail_received',
		provider: 'telnyx_voice',
		network_category: 'Communication',
		signal_bucket: 'Risk',
		active: true,
		conditions: {
			'ai_context.contains_problem': { operator: '=', value: true },
			'ai_context.contains_callback_request': { operator: '=', value: true }
		},
		required_fields: ['ai_context.contains_problem', 'ai_context.contains_callback_request'],
		default_priority: 1,
		default_confidence: 0.85,
		purpose: 'Customers with problems who are explicitly asking for a call back are high churn risks.'
	},
	{
		signal_rule_id: 'SIG-COMM-004',
		signal_name: 'BOOKING_INQUIRY',
		event_type: 'voicemail_received',
		provider: 'telnyx_voice',
		network_category: 'Communication',
		signal_bucket: 'Momentum',
		active: true,
		conditions: {
			'ai_context.service_mentioned': { operator: 'is_not_null' },
			'ai_context.contains_quote_request': { operator: '=', value: false },
			'ai_context.requested_action': { operator: '!=', value: 'praise' },
			// The three conditions above are all negatives plus "a service was named", which the AI
			// fills in for ANY service-related message — including complaints and emergencies. An
			// active roof leak was therefore logged as a BOOKING_INQUIRY. A customer reporting a
			// failure is not enquiring about booking, so exclude problems and emergencies outright.
			'ai_context.contains_emergency_keywords': { operator: '=', value: false },
			'ai_context.contains_problem': { operator: '=', value: false }
		},
		required_fields: ['ai_context.service_mentioned'],
		default_priority: 1,
		default_confidence: 0.9,
		purpose:
			'Customers asking about specific services represent potential revenue. Excludes problem/emergency reports, which name a service but are not enquiries.'
	},
	{
		signal_rule_id: 'SIG-COMM-005',
		signal_name: 'CALLBACK_REQUESTED',
		event_type: 'voicemail_received',
		provider: 'telnyx_voice',
		network_category: 'Communication',
		signal_bucket: 'Bottleneck',
		active: true,
		conditions: {
			'ai_context.contains_callback_request': { operator: '=', value: true }
		},
		required_fields: ['ai_context.contains_callback_request'],
		default_priority: 1,
		default_confidence: 0.9,
		purpose: 'Any explicit request for a callback is a high-priority revenue opportunity.'
	},
	{
		signal_rule_id: 'SIG-COMM-006',
		signal_name: 'SERVICE_COMPLAINT',
		event_type: 'voicemail_received',
		provider: 'telnyx_voice',
		network_category: 'Communication',
		signal_bucket: 'Bottleneck',
		active: true,
		conditions: {
			'ai_context.contains_problem': { operator: '=', value: true }
		},
		required_fields: ['ai_context.contains_problem'],
		default_priority: 2,
		default_confidence: 0.85,
		purpose: 'General customer complaints detected semantically.'
	},
	{
		signal_rule_id: 'SIG-COMM-007',
		signal_name: 'GENERAL_MESSAGE',
		event_type: 'voicemail_received',
		provider: 'telnyx_voice',
		network_category: 'Communication',
		signal_bucket: 'Momentum',
		active: true,
		conditions: {
			'ai_context.contains_problem': { operator: '=', value: false },
			'ai_context.contains_quote_request': { operator: '=', value: false },
			'ai_context.contains_callback_request': { operator: '=', value: false }
		},
		required_fields: [],
		default_priority: 3,
		default_confidence: 0.9,
		purpose: 'Message doesn\'t contain specific high-priority facts.'
	}
];
