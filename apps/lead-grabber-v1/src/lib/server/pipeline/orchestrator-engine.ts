import { prisma } from '$lib/db';
import { normalizeExecutionMode } from './execution-modes';

export interface SelectedAction {
	action_id: string;
	action_name: string;
	action_domain: string;
	is_primary: boolean;
	is_secondary: boolean;
	is_public_facing: boolean;
	execution_mode: string;
	owner: string;
}

export interface BlockedAction {
	action_id: string;
	action_name: string;
	block_reason: string;
	blocked_by: string;
}

export interface OrchestratorDecisionResult {
	event_id: string;
	decided: boolean;
	decision_id: string | null;
	dominant_signal: any | null;
	supporting_signals: any[];
	selected_actions: SelectedAction[];
	blocked_actions: BlockedAction[];
	no_decision_reason: string | null;
	log: OrchestratorLog;
	decision_record: any | null;
}

export class OrchestratorLog {
	event_id: string;
	steps: { status: string; message: string; timestamp: string; description?: string }[] = [];

	constructor(event_id: string) {
		this.event_id = event_id;
	}

	step(status: string, message: string, description?: string) {
		const timestamp = new Date().toISOString().replace('T', ' ').replace('Z', '');
		const statusIcon = status.includes('error') ? '🔴' : (status.includes('blocked') || status.includes('warning')) ? '🟡' : '🔵';
		
		console.log(`${statusIcon} [${timestamp}] Section 3 - ${status.toUpperCase()} : ${message}`);
		if (description) {
			console.log(`      → ${description}`);
		}
		
		this.steps.push({ status, message, timestamp, description });
	}
}

export class OrchestratorEngine {
	static async makeDecision(eventId: string, signalCandidates: any[], existingTrace: string[] = []): Promise<OrchestratorDecisionResult> {
		const log = new OrchestratorLog(eventId);
		log.step('orchestrator_started', `${signalCandidates.length} Signal candidate(s) received`, "The Decision Engine has received the validated signals from Phase 2 and is initializing the strategy selection process.");

		// Step 1 & 2: Receive and Confirm Eligibility
		if (signalCandidates.length === 0) {
			log.step('no_candidates', 'No Signal candidates. No decision.', "No signals were detected for this event, so no automated actions will be taken.");
			return this.noDecision(eventId, 'no_signal_candidates', log);
		}

		const event = await prisma.pipelineEvent.findUnique({
			where: { id: eventId },
			include: { enrichments: true }
		});

		if (!event) {
			log.step('error', `Event not found: ${eventId}`);
			return this.noDecision(eventId, 'event_not_found', log);
		}

		const companyId = event.companyId;
		if (!companyId) {
			log.step('error', 'Company ID missing from event');
			return this.noDecision(eventId, 'no_company_id', log);
		}

		if (!event.handoffEligible) {
			log.step('error', 'Event not handoff eligible');
			return this.noDecision(eventId, 'not_handoff_eligible', log);
		}

		const existingDecision = await prisma.pipelineDecision.findFirst({
			where: { eventId }
		});

		if (existingDecision) {
			log.step('error', 'Orchestrator decision already exists for this event');
			return this.noDecision(eventId, 'decision_already_exists', log);
		}

		log.step('event_loaded', `companyId=${companyId}`, `System successfully loaded the company profile and historical context for client ID: ${companyId}.`);

		// Step 3: Load Client Profile + Business Config
		let clientProfile = await prisma.pipelineOrchestratorProfile.findUnique({
			where: { companyId }
		});

		if (!clientProfile) {
			log.step('client_profile_not_found', 'Using defaults (automation_level=standard)', "No custom automation profile found; applying standard defaults (Human review for public tasks).");
			clientProfile = {
				automationLevel: 'standard',
				disabledSignalIds: [],
				domainExecutionModes: {},
				domainOwners: {},
				preferredReplyLength: 'medium',
				includeBusinessName: true,
				includeCallToAction: true
			} as any;
		} else {
			log.step('client_profile_loaded', `automation_level=${clientProfile.automationLevel}`, `Loaded the client's automation preferences. Current level: ${clientProfile.automationLevel.toUpperCase()}.`);
		}

		const businessConfig = await prisma.pipelineBusinessConfig.findUnique({
			where: { companyId }
		});

		if (!businessConfig) {
			log.step('error', 'Business configuration missing');
			return this.noDecision(eventId, 'business_config_missing', log);
		}

		const eventData = this.buildEventData(event, businessConfig);

		// Step 4: Load Safety Rules
		const safetyRules = await prisma.pipelineSafetyRule.findMany({
			where: { active: true },
			orderBy: { severity: 'desc' }
		});
		log.step('safety_rules_loaded', `${safetyRules.length} safety rules loaded.`, "Global safety blocks (like 'Never auto-post public replies') have been initialized and will override any client preferences.");

		// Step 5: Load Consultant Ownership
		let consultantOwnership: any = null;
		if (businessConfig.consultantId) {
			consultantOwnership = {
				consultant_id: businessConfig.consultantId,
				consultant_name: businessConfig.consultantName,
				consultant_review_required: businessConfig.consultantReviewRequired,
				primary_internal_owner: businessConfig.primaryInternalOwner,
				approval_route: businessConfig.approvalRoute,
				auto_notify_consultant: businessConfig.autoNotifyConsultant
			};
			eventData.consultant_ownership = consultantOwnership;
			log.step('consultant_ownership_loaded', `Consultant: ${consultantOwnership.consultant_name}`, `Identified ${consultantOwnership.consultant_name} as the primary consultant owner for this account.`);
		} else {
			log.step('no_consultant_assigned', 'Routing to business_owner as primary owner');
		}

		// Step 6: Load Orchestrator Rules + Action Mappings
		const orcRules = await prisma.pipelineOrchestratorRule.findMany({
			where: {
				active: true,
				isSafetyRule: false,
				OR: [
					{ companyId: null },
					{ companyId: companyId }
				]
			}
		});
		// Sort manually to ensure client rules override global
		orcRules.sort((a, b) => {
			if (a.companyId === companyId && b.companyId !== companyId) return -1;
			if (a.companyId !== companyId && b.companyId === companyId) return 1;
			return 0;
		});

		log.step('orchestrator_rules_loaded', `${orcRules.length} rule(s) loaded (scope: client + global)`);

		const signalIds = signalCandidates.map(c => c.signalRuleId).filter(Boolean) as string[];
		const actionMappingsRaw = await prisma.pipelineSignalActionMapping.findMany({
			where: {
				active: true,
				signalRuleId: { in: signalIds },
				OR: [
					{ companyId: null },
					{ companyId: companyId }
				]
			}
		});
		
		// Group mappings: If client has ANY mappings for a Signal, ignore globals for that Signal
		const actionMappings: Record<string, any[]> = {};
		const signalsWithClientMappings = new Set(
			actionMappingsRaw.filter(m => m.companyId === companyId).map(m => m.signalRuleId)
		);

		for (const mapping of actionMappingsRaw) {
			const hasClientOverride = signalsWithClientMappings.has(mapping.signalRuleId);
			
			// If this signal has client overrides, skip this mapping if it's a global one
			if (hasClientOverride && mapping.companyId === null) continue;
			
			if (!actionMappings[mapping.signalRuleId]) {
				actionMappings[mapping.signalRuleId] = [];
			}
			actionMappings[mapping.signalRuleId].push(mapping);
		}

		log.step('action_mappings_loaded', `${Object.keys(actionMappings).length} Signal-to-Action mapping groups loaded`);

		// Step 7: Apply Disabled Signal Filter
		const disabledSignals = (clientProfile.disabledSignalIds as string[]) || [];
		const activeCandidates = signalCandidates.filter(c => !disabledSignals.includes(c.signalRuleId));

		if (activeCandidates.length === 0) {
			log.step('signals_disabled_by_client', 'All candidates disabled by client profile');
			return this.noDecision(eventId, 'all_signals_disabled_by_client', log);
		}

		// Step 8: Rank Signal Candidates
		const BUCKET_WEIGHTS: Record<string, number> = {
			'Risk': 1, 'Bottleneck': 2, 'Opportunity': 3,
			'Performance': 4, 'Competitive': 5, 'Momentum': 6
		};

		const ranked = [...activeCandidates].sort((a, b) => {
			const pA = a.priority ?? 3;
			const pB = b.priority ?? 3;
			if (pA !== pB) return pA - pB;

			const wA = BUCKET_WEIGHTS[a.bucket] || 9;
			const wB = BUCKET_WEIGHTS[b.bucket] || 9;
			if (wA !== wB) return wA - wB;

			const cA = a.confidence || 0;
			const cB = b.confidence || 0;
			return cB - cA; // descending
		});

		// Step 9: Identify Dominant + Supporting Signals
		const dominant = ranked[0];
		const supporting = ranked.slice(1);

		log.step('dominant_signal_identified', `Dominant: ${dominant.name} [${dominant.signalRuleId}] (bucket=${dominant.bucket}, priority=${dominant.priority})`, `The system has identified "${dominant.name}" as the highest priority signal to address.`);
		if (supporting.length > 0) {
			log.step('supporting_signals_identified', `Supporting: ${supporting.map(s => `${s.name} [${s.signalRuleId}]`).join(', ')}`, "Additional context signals have been noted but will not drive the primary action choice.");
		}

		// Step 10: Apply Suppression Rules
		const suppressedSignalIds: string[] = [];
		for (const rule of orcRules) {
			if (rule.signalRuleId === dominant.signalRuleId && rule.suppressSignals) {
				const suppress = rule.suppressSignals as string[];
				suppressedSignalIds.push(...suppress);
			}
		}

		const filteredSupporting = supporting.filter(s => !suppressedSignalIds.includes(s.signalRuleId));
		
		// Mark suppressed signals in DB
		if (suppressedSignalIds.length > 0) {
			await prisma.pipelineSignal.updateMany({
				where: {
					eventId: eventId,
					signalRuleId: { in: suppressedSignalIds },
					status: 'candidate'
				},
				data: { status: 'suppressed' }
			});
			log.step('signals_suppressed', `Suppressed: ${suppressedSignalIds.join(', ')}`, "To prevent redundant alerts, the system has silenced these overlapping signals.");
		}

		// Step 11: Select Actions via Mappings
		let mappingsForDominant = actionMappings[dominant.signalRuleId] || [];
		
		// De-duplicate mappings to prevent multiple identical actions
		const seenActions = new Set();
		mappingsForDominant = mappingsForDominant.filter(m => {
			if (seenActions.has(m.actionId)) return false;
			seenActions.add(m.actionId);
			return true;
		});

		if (mappingsForDominant.length === 0) {
			log.step('error', `No action mappings for dominant signal: ${dominant.signalRuleId}`);
			return this.noDecision(eventId, 'no_action_mappings_for_dominant_signal', log);
		}

		log.step('actions_identified', `${mappingsForDominant.length} mapping(s) found: ${mappingsForDominant.map(m => m.actionId).join(', ')}`, `Found ${mappingsForDominant.length} specific tasks mapped to the dominant signal.`);

		const selectedActions: SelectedAction[] = [];
		for (const mapping of mappingsForDominant) {
			const actionLib = await prisma.pipelineActionLibrary.findUnique({
				where: { actionId: mapping.actionId }
			});

			if (!actionLib) {
				log.step('warning', `Action library record missing for ${mapping.actionId}`);
				continue;
			}

			// Step 12: Resolve Execution Mode + Owner
			const mode = this.resolveExecutionMode(
				actionLib,
				clientProfile,
				orcRules,
				eventData,
				dominant.signalRuleId,
				consultantOwnership
			);

			const owner = this.resolveOwner(
				actionLib,
				orcRules,
				dominant.signalRuleId,
				consultantOwnership,
				clientProfile
			);

			const selected = {
				action_id: actionLib.actionId,
				action_name: actionLib.name,
				action_domain: actionLib.domain,
				is_primary: mapping.isPrimary,
				is_secondary: mapping.isSecondary,
				is_public_facing: actionLib.isPublicFacing,
				execution_mode: mode,
				owner: owner
			};
			
			selectedActions.push(selected);
			log.step('action_selected', `${selected.action_id} (${selected.action_name}) -> mode=${selected.execution_mode}, owner=${selected.owner}`, `Strategically selected "${selected.action_name}" with a execution mode of ${selected.execution_mode.toUpperCase()}.`);
		}

		// Step 13: Apply Safety Rules (Final Pass)
		const finalActions: SelectedAction[] = [];
		const blockedActions: BlockedAction[] = [];

		// EMERGENCY BYPASS: If dominant signal is SIG-COMM-000, skip all safety blocks (SAF-000)
		const isEmergencyBypass = dominant.signalRuleId === 'SIG-COMM-000';

		for (const action of selectedActions) {
			const checkData = {
				...eventData,
				action_id: action.action_id,
				action_is_public_facing: action.is_public_facing,
				execution_mode: action.execution_mode,
				signal_rule_id: dominant.signalRuleId // For SAF-000 condition matching
			};

			let blocked = false;
			let blockReason = '';

			if (!isEmergencyBypass) {
				for (const rule of safetyRules) {
					if (this.evaluateConditions(rule.conditions, checkData)) {
						blocked = true;
						blockReason = rule.blockReason;
						break;
					}
				}
			} else {
				log.step('safety_bypass', 'Emergency Signal detected. Bypassing all safety checks.', 'Protocol SAF-000 enabled for critical response.');
			}

			if (blocked) {
				blockedActions.push({
					action_id: action.action_id,
					action_name: action.action_name,
					block_reason: blockReason,
					blocked_by: 'safety_rule'
				});
				log.step('action_blocked', `${action.action_id} blocked: ${blockReason}`);
			} else {
				finalActions.push(action);
			}
		}

		if (finalActions.length === 0) {
			log.step('all_actions_blocked', 'Every selected action was blocked by safety rules');
			return this.noDecision(eventId, 'all_actions_blocked', log);
		}

		// Step 14: Store Decision Record
		const decisionId = `dec_${Math.random().toString(36).substring(2, 12)}`;
		const primaryAction = finalActions.find(a => a.is_primary) || finalActions[0];
		
		// DEDUPLICATE IDs before saving to DB
		const deduplicatedActionIds = [...new Set(finalActions.map(a => a.action_id))];

		const decision = await prisma.pipelineDecision.create({
			data: {
				decisionId,
				eventId,
				dominantSignalId: dominant.id,
				supportingSignalIds: filteredSupporting.map(s => s.id),
				selectedActionIds: deduplicatedActionIds,
				blockedActionIds: blockedActions.map(a => ({ id: a.action_id, reason: a.block_reason })),
				executionMode: primaryAction.execution_mode,
				owner: primaryAction.owner,
				priority: dominant.priority,
				reason: `Dominant signal "${dominant.name}" triggered ${finalActions.length} action(s).`,
				businessConfigSnapshot: businessConfig as any,
				safetyChecksPassed: true,
				consultantReviewRequired: consultantOwnership?.consultant_review_required || false,
				consultantId: consultantOwnership?.consultant_id,
				approvalRoute: consultantOwnership?.approval_route,
			}
		});

		// Mark dominant signal as valid
		await prisma.pipelineSignal.update({
			where: { id: dominant.id },
			data: { status: 'valid' }
		});

		log.step('decision_stored', `Decision ${decisionId} saved for event ${eventId}. Actions: ${finalActions.length} ready, ${blockedActions.length} blocked.`, `Section 3 concludes. Strategy ${decisionId} is permanently recorded and handed off to Section 4.`);

		// Step 15: Return Result
		return {
			event_id: eventId,
			decided: true,
			decision_id: decisionId,
			dominant_signal: dominant,
			supporting_signals: filteredSupporting,
			selected_actions: finalActions,
			blocked_actions: blockedActions,
			no_decision_reason: null,
			log,
			decision_record: decision
		};
	}

	private static noDecision(eventId: string, reason: string, log: OrchestratorLog): OrchestratorDecisionResult {
		return {
			event_id: eventId,
			decided: false,
			decision_id: null,
			dominant_signal: null,
			supporting_signals: [],
			selected_actions: [],
			blocked_actions: [],
			no_decision_reason: reason,
			log,
			decision_record: null
		};
	}

	private static buildEventData(event: any, config: any) {
		const enrichment = event.enrichments?.[0] || {};
		return {
			rating: event.reviewRatingNumeric,
			event_type: event.eventType,
			review_text: event.reviewText,
			ai_sentiment: enrichment.aiSentiment,
			ai_sentiment_score: enrichment.aiSentimentScore,
			ai_confidence_score: enrichment.aiConfidenceScore,
			ai_complaint_detected: enrichment.aiComplaintDetected,
			ai_praise_detected: enrichment.aiPraiseDetected,
			company_id: event.companyId,
			business_reply_exists: event.businessReplyExists,
			review_reply_policy: config.reviewReplyPolicy,
			public_response_requires_approval: config.publicResponseRequiresApproval
		};
	}

	private static resolveExecutionMode(action: any, profile: any, rules: any[], eventData: any, signalRuleId: string, consultant: any): string {
		// 2. Consultant forces approval on public-facing
		if (consultant?.consultant_review_required && action.isPublicFacing) {
			return 'approval_required';
		}

		// 3. Client rule override
		for (const rule of rules) {
			if (rule.signalRuleId === signalRuleId && rule.executionMode && rule.scope === 'client') {
				if (!rule.conditions || this.evaluateConditions(rule.conditions, eventData)) {
					return rule.executionMode;
				}
			}
		}

		// 4. Client domain mode
		const domainModes = (profile.domainExecutionModes as Record<string, string>) || {};
		if (domainModes[action.domain]) {
			return domainModes[action.domain];
		}

		// 5. Automation level
		if (profile.automationLevel === 'conservative') return 'approval_required';
		if (profile.automationLevel === 'aggressive') {
			return action.isPublicFacing ? 'approval_required' : 'automatic';
		}

		// 6. Action Library default (normalized so non-canonical modes like
		// 'automatic_immediate' resolve to a real, executable lane)
		return normalizeExecutionMode(action.defaultExecutionMode);
	}

	// T8.1: pricing/financial content is originated by the business owner (Bert),
	// not the consultant (Sarah). Actions that merely relay an already-set figure
	// aren't financially-named, so they still route to the consultant.
	private static isFinancialAction(action: any): boolean {
		if (action?.isFinancial === true) return true;
		const name = (action?.name || '').toLowerCase();
		return /quote|pricing|price|invoice|transaction|deposit|balance|estimate/.test(name);
	}

	private static resolveOwner(action: any, rules: any[], signalRuleId: string, consultant: any, profile: any): string {
		// T8.1: financial/pricing origination goes to the business owner.
		if (this.isFinancialAction(action)) return 'business_owner';

		// 1. Client rule override
		for (const rule of rules) {
			if (rule.signalRuleId === signalRuleId && rule.owner && rule.scope === 'client') {
				return rule.owner;
			}
		}

		// 2. Consultant primary owner (only for public-facing actions)
		if (consultant?.primary_internal_owner && action.isPublicFacing) {
			return consultant.primary_internal_owner;
		}

		// 3. Domain owner preference
		const domainOwners = (profile.domainOwners as Record<string, string>) || {};
		if (domainOwners[action.domain]) {
			return domainOwners[action.domain];
		}

		// 4. Action Library default
		return action.defaultOwner || 'system';
	}

	private static evaluateConditions(conditions: any, data: any): boolean {
		if (!conditions) return true;
		if (typeof conditions !== 'object') return false;

		for (const [field, condition] of Object.entries(conditions as Record<string, any>)) {
			const actual = data[field];
			const { operator, value } = condition;

			switch (operator) {
				case '=': if (actual != value) return false; break;
				case '!=': if (actual == value) return false; break;
				case '>': if (actual <= value) return false; break;
				case '<': if (actual >= value) return false; break;
				case '>=': if (actual < value) return false; break;
				case '<=': if (actual > value) return false; break;
				case 'in': if (!Array.isArray(value) || !value.includes(actual)) return false; break;
				case 'not_in': if (!Array.isArray(value) || value.includes(actual)) return false; break;
				case 'contains': if (typeof actual !== 'string' || !actual.toLowerCase().includes(String(value).toLowerCase())) return false; break;
				case 'contains_any': 
					if (!Array.isArray(value)) return false;
					const actualList = Array.isArray(actual) ? actual : [String(actual)];
					const hasMatch = value.some(v => actualList.some(av => String(av).toLowerCase().includes(String(v).toLowerCase())));
					if (!hasMatch) return false;
					break;
				case 'is_null': if (actual !== null) return false; break;
				case 'is_not_null': if (actual === null) return false; break;
			}
		}
		return true;
	}
}
