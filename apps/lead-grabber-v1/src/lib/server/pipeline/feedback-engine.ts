import { prisma } from '$lib/db';

export interface FeedbackRecord {
	id: string;
	feedback_id: string;
	event_id: string;
	decision_id: string;
	action_queue_id: string;
	execution_id: string;
	outcome_id: string;
	action_id: string;
	signal_validity: string | null;
	decision_quality: string | null;
	action_execution_quality: string | null;
	outcome_result: string | null;
	human_review_state: string | null;
	tuning_candidates: any[];
	production_rules_changed: boolean;
	feedback_rules_snapshot_id: string | null;
	details: any;
	created_at: Date;
	updated_at: Date;
}

export interface FeedbackContextItem {
	feedback_context_id: string;
	event_id: string;
	decision_id: string;
	blocked_context_id: string;
	action_id: string;
	feedback_context_type: string;
	is_execution_failure: boolean;
	notes: string | null;
}

export interface FeedbackPackage {
	feedback_output_package_id: string;
	business_id: string;
	source_event_id: string;
	feedback_records: string[];
	feedback_context_items: string[];
	summary_states: {
		signal_validity: string;
		decision_quality: string;
		action_execution_quality: string;
		outcome_result: string;
		human_review_state: string;
		public_posting_state: string;
	};
	dashboard_states: {
		review_reply: string;
		complaint_theme: string;
		public_posting: string;
		overall: string;
	};
	reporting_boundary_check: {
		public_reply_posted: boolean;
		external_action_completed: boolean;
	};
	tuning_candidates: 'candidate_only';
	production_changes_applied: boolean;
	ready_for_reporting: true;
	handoff_status: 'workflow_loop_closed';
}

export interface FeedbackResult {
	completed: boolean;
	feedback_records: any[];
	context_items: any[];
	fb_pkg: FeedbackPackage | null;
	handoff_status: 'workflow_loop_closed' | 'failed';
	pipeline_status: 'feedback_complete' | 'feedback_failed';
	stop_reason: string | null;
	log: FeedbackLog;
}

export class FeedbackLog {
	decision_id: string;
	steps: { status: 'pass' | 'fail' | 'warn'; message: string; timestamp: string; description?: string }[] = [];

	constructor(decision_id: string) {
		this.decision_id = decision_id;
	}

	step(status: 'pass' | 'fail' | 'warn', message: string, description?: string) {
		const timestamp = new Date().toISOString().replace('T', ' ').replace('Z', '');
		const statusIcon = status === 'fail' ? '🔴' : status === 'warn' ? '🟡' : '🔵';
		console.log(`${statusIcon} [${timestamp}] Section 7 - ${status.toUpperCase()} : ${message}`);
		if (description) {
			console.log(`      → ${description}`);
		}
		this.steps.push({ status, message, timestamp, description });
	}
}

function shortId(prefix: string) {
	return `${prefix}_${Math.random().toString(36).substring(2, 12)}`;
}

async function receiveFeedbackInput(out_pkg: any, event_id: string, log: FeedbackLog) {
	const res = out_pkg?.section_6_completion_result || out_pkg;
	if (!res) throw new Error('missing_outcome_package');
	if (res.section_6_status !== 'completed') throw new Error('section_6_not_completed');
	if (res.handoff_status !== 'ready_for_feedback') throw new Error('invalid_handoff_status_for_feedback');
	
	const outcomes = res.outcome_records || [];
	if (outcomes.length === 0) throw new Error('no_outcome_records');

	if (res.boundary_flags?.feedback_recorded === true) {
		throw new Error('duplicate_feedback_prevented');
	}

	const outcomeIds = outcomes.map((o: any) => o.outcome_id).filter(Boolean);
	const existing = await prisma.pipelineFeedbackRecord.findMany({
		where: { outcomeId: { in: outcomeIds } },
		select: { feedbackId: true, outcomeId: true }
	});

	if (existing.length > 0) {
		throw new Error('duplicate_feedback_prevented');
	}

	log.step('pass', `Feedback intake opened. ${outcomes.length} outcome record(s) received.`, 'Step 1 intake checks passed.');

	return {
		safe_to_continue: true,
		outcome_records: outcomes,
		blocked_context: res.blocked_no_external_action_context || [],
		source_event_id: res.source_event_id || event_id,
		source_orchestrator_decision_id: res.source_orchestrator_decision_id,
		business_id: res.company_id || res.business_id
	};
}

async function confirmFeedbackEligibility(outcome_records: any[], log: FeedbackLog) {
	const RECORDABLE_STATUSES = ['waiting_for_approval', 'completed', 'failed', 'waiting'];
	const eligible: any[] = [];
	const context_only: any[] = [];

	for (const rec of outcome_records) {
		const reasons: string[] = [];
		if (rec.outcome_type === 'blocked_preserved') reasons.push('blocked_context_only');
		if (!rec.outcome_id) reasons.push('missing_outcome_id');
		if (!RECORDABLE_STATUSES.includes(rec.outcome_status)) reasons.push('non_recordable_status');
		if (!rec.execution_id) reasons.push('missing_execution_id');

		if (reasons.length === 0) {
			eligible.push(rec);
		} else {
			context_only.push({ rec, reasons });
			log.step('warn', `Outcome ineligible for record: ${rec.outcome_id || 'unknown'}`, reasons.join(', '));
		}
	}

	if (eligible.length === 0) {
		throw new Error('no_eligible_outcome_records');
	}

	log.step('pass', `${eligible.length} outcome record(s) eligible`, 'Step 2 eligibility checks complete.');
	return { eligible, context_only };
}

function loadFeedbackRules(log: FeedbackLog) {
	const rules = {
		snapshot_id: shortId('fb_rules_snap'),
		categories: [
			'signal_validity',
			'decision_quality',
			'action_execution_quality',
			'outcome_result',
			'human_review_state',
			'tuning_candidate',
			'reporting_value'
		],
		outcome_to_feedback_map: {
			'waiting_for_approval': {
				outcome_result: 'partial_completion',
				human_review_state: 'waiting_for_human_approval',
				do_not_mark_failed: true
			},
			'completed': {
				outcome_result: 'completed',
				human_review_state: 'not_applicable'
			},
			'failed': {
				outcome_result: 'failed',
				human_review_state: 'not_applicable'
			},
			'waiting': {
				outcome_result: 'waiting',
				human_review_state: 'not_applicable'
			}
		},
		boundary_rules: {
			automatic_rule_changes_allowed: false,
			uncontrolled_model_training_allowed: false,
			production_rules_changed_default: false
		}
	};

	log.step('pass', `Rules snapshot loaded: ${rules.snapshot_id}`, 'Step 3 completed with frozen evaluation mapping.');
	return rules;
}

async function createFeedbackRecords(
	eligibleRecords: any[], 
	source_event_id: string, 
	source_decision_id: string, 
	rulesSnapshot: any, 
	log: FeedbackLog
) {
	const created: any[] = [];

	await prisma.$transaction(async (tx: any) => {
		for (const rec of eligibleRecords) {
			const mapping = rulesSnapshot.outcome_to_feedback_map[rec.outcome_status];
			const feedback_id = shortId('fb');

			const fbRecord = await tx.pipelineFeedbackRecord.create({
				data: {
					feedbackId: feedback_id,
					eventId: source_event_id,
					decisionId: source_decision_id,
					actionQueueId: rec.action_queue_id,
					executionId: rec.execution_id,
					outcomeId: rec.outcome_id,
					actionId: rec.action_id,
					outcomeResult: mapping.outcome_result,
					humanReviewState: mapping.human_review_state,
					productionRulesChanged: false,
					tuningCandidates: [],
					details: {
						initial_mapping: mapping,
						outcome_snapshot: {
							type: rec.outcome_type,
							status: rec.outcome_status
						}
					}
				}
			});

			await tx.pipelineOutcome.update({
				where: { outcomeId: rec.outcome_id },
				data: { feedbackId: feedback_id }
			});

			created.push(fbRecord);
			log.step('pass', `Feedback record created: ${feedback_id}`, `Linked to outcome ${rec.outcome_id}`);
		}
	}, { timeout: 15000 });

	log.step('pass', `${created.length} feedback record(s) created in transaction`, 'Step 4 complete.');
	return created;
}

function createFeedbackContextItems(blocked_context: any[], source_event_id: string, source_decision_id: string, log: FeedbackLog) {
	const created: FeedbackContextItem[] = [];
	if (!blocked_context || blocked_context.length === 0) return created;

	for (const item of blocked_context) {
		const feedback_context_id = shortId('fb_ctx');
		const blocked_context_id = item.blocked_context_id || `blocked_ref_${item.action_id}_${source_event_id}`;
		const fbCtx = {
			feedback_context_id,
			event_id: source_event_id,
			decision_id: source_decision_id,
			blocked_context_id,
			action_id: item.action_id,
			feedback_context_type: 'blocked_by_policy',
			is_execution_failure: false,
			notes: item.blocked_reason || 'Blocked by policy'
		};
		created.push(fbCtx);
		log.step('pass', `Feedback context item created: ${feedback_context_id}`, `For blocked action ${item.action_id}`);
	}

	log.step('pass', `${created.length} context item(s) created`, 'Step 4b complete.');
	return created;
}

function buildSignalValidityFeedback(record: any) {
	let validity = 'uncertain';
	let reason = 'Evaluation inconclusive';

	if (record.outcomeResult === 'completed' || record.outcomeResult === 'partial_completion') {
		validity = 'likely_valid';
		reason = 'Real actionable event identified. Actions were appropriate to signal type.';
	} else if (record.outcomeResult === 'failed') {
		validity = 'uncertain';
		reason = 'Execution failed, signal validity remains uncertain.';
	}

	return {
		signal_validity: validity,
		signal_validity_evaluation: {
			signal_validity: validity,
			reason,
			evaluated_at: new Date().toISOString()
		}
	};
}

function buildDecisionQualityFeedback(record: any) {
	let quality = 'reasonable_so_far';
	let reason = 'Decision matched signal type and enforced policies correctly.';

	if (record.outcomeResult === 'failed') {
		quality = 'questionable';
		reason = 'Decision resulted in an execution failure.';
	}

	return {
		decision_quality: quality,
		decision_quality_evaluation: {
			decision_quality: quality,
			reason,
			evaluated_at: new Date().toISOString()
		}
	};
}

function buildActionExecutionFeedback(record: any) {
	let quality = 'worked_as_expected';
	
	if (record.outcomeResult === 'partial_completion') {
		quality = 'worked_as_expected_so_far';
	} else if (record.outcomeResult === 'failed') {
		quality = 'did_not_work';
	}

	return {
		action_execution_quality: quality,
		action_execution_quality_evaluation: {
			action_execution_quality: quality,
			evaluated_at: new Date().toISOString()
		}
	};
}

function buildOutcomeResultFeedback(record: any) {
	return {
		outcome_result_evaluation: {
			outcome_result: record.outcomeResult,
			evaluated_at: new Date().toISOString()
		}
	};
}

function buildHumanReviewStateFeedback(record: any) {
	return {
		human_review_state_evaluation: {
			human_review_state: record.humanReviewState,
			evaluated_at: new Date().toISOString()
		}
	};
}

function buildTuningCandidates() {
	const candidates = [
		{
			type: "signal_priority_review_if_repeated",
			reason: "Monitor if this signal type consistently produces this outcome result.",
			automatic_change: false
		},
		{
			type: "approval_workflow_efficiency",
			reason: "Review if waiting_for_human_approval state is resolved within SLA.",
			automatic_change: false
		}
	];

	return {
		tuning_candidates: candidates,
		tuning_candidates_identification: {
			candidates_count: candidates.length,
			production_rules_changed: false,
			evaluated_at: new Date().toISOString()
		}
	};
}

function buildFeedbackPackage(created_records: any[], context_items: any[], out_pkg: any, rules_snapshot: any): FeedbackPackage {
	const VALIDITY_RANK: Record<string, number> = {
		likely_valid: 0,
		uncertain: 1,
		invalid: 2
	};
	const signalValidity = created_records.reduce((worst, record) => {
		const rank = VALIDITY_RANK[record.signalValidity ?? 'uncertain'] ?? 1;
		return rank > (VALIDITY_RANK[worst] ?? 0) ? record.signalValidity : worst;
	}, 'likely_valid');

	const decisionQuality = created_records.some(record => record.decisionQuality === 'questionable')
		? 'questionable'
		: 'reasonable_so_far';

	const EXEC_RANK: Record<string, number> = {
		worked_as_expected: 0,
		worked_as_expected_so_far: 1,
		did_not_work: 2
	};
	const actionExecutionQuality = created_records.reduce((worst, record) => {
		const rank = EXEC_RANK[record.actionExecutionQuality ?? 'worked_as_expected_so_far'] ?? 1;
		return rank > (EXEC_RANK[worst] ?? 0) ? record.actionExecutionQuality : worst;
	}, 'worked_as_expected');

	const OUTCOME_RANK: Record<string, number> = {
		completed: 0,
		partial_completion: 1,
		failed: 2
	};
	const outcomeResult = created_records.reduce((worst, record) => {
		const rank = OUTCOME_RANK[record.outcomeResult ?? 'partial_completion'] ?? 1;
		return rank > (OUTCOME_RANK[worst] ?? 0) ? record.outcomeResult : worst;
	}, 'completed');

	const humanReviewState = created_records.some(record => record.humanReviewState === 'waiting_for_human_approval')
		? 'waiting_for_human_approval'
		: created_records.some(record => record.humanReviewState === 'approved')
		? 'approved'
		: created_records.some(record => record.humanReviewState === 'rejected')
		? 'rejected'
		: 'not_applicable';

	const publicPostingState = context_items.length > 0 ? 'blocked_by_policy' : 'not_applicable';

	const overallState = outcomeResult === 'failed'
		? 'failed'
		: outcomeResult === 'partial_completion'
		? 'partial_completion'
		: 'completed';

	const reviewReplyState = humanReviewState === 'waiting_for_human_approval'
		? 'waiting_for_approval'
		: humanReviewState === 'approved'
		? 'approved'
		: humanReviewState === 'rejected'
		? 'rejected'
		: 'not_applicable';

	return {
		feedback_output_package_id: shortId('fb_pkg'),
		business_id: out_pkg.business_id,
		source_event_id: out_pkg.source_event_id,
		feedback_records: created_records.map(r => r.feedbackId),
		feedback_context_items: context_items.map(r => r.feedback_context_id),
		summary_states: {
			signal_validity: signalValidity,
			decision_quality: decisionQuality,
			action_execution_quality: actionExecutionQuality,
			outcome_result: outcomeResult,
			human_review_state: humanReviewState,
			public_posting_state: publicPostingState
		},
		dashboard_states: {
			review_reply: reviewReplyState,
			complaint_theme: 'logged',
			public_posting: publicPostingState,
			overall: overallState
		},
		reporting_boundary_check: {
			public_reply_posted: false,
			external_action_completed: false
		},
		tuning_candidates: 'candidate_only',
		production_changes_applied: false,
		ready_for_reporting: true,
		handoff_status: 'workflow_loop_closed'
	};
}

function stopAfterFeedback(fb_pkg: FeedbackPackage, created_records: any[], log: FeedbackLog): FeedbackResult {
	if (fb_pkg.production_changes_applied === true) {
		throw new Error('boundary_violation_production_rules_changed_in_section_7');
	}
	if (fb_pkg.reporting_boundary_check.public_reply_posted === true) {
		throw new Error('boundary_violation_posted_in_section_7');
	}

	log.step('pass', `Section 7 complete. feedback_records=${created_records.length}`, 'Step 12 boundary stop enforced. Full loop closed.');

	return {
		completed: true,
		feedback_records: created_records,
		context_items: [],
		fb_pkg,
		handoff_status: 'workflow_loop_closed',
		pipeline_status: 'feedback_complete',
		stop_reason: null,
		log
	};
}

export async function runFeedback(out_pkg: any, event_id: string, decision_id: string, business_id: string | null): Promise<FeedbackResult> {
	const log = new FeedbackLog(decision_id);
	log.step('pass', `Section 7 started. decision_id=${decision_id}`, 'Feedback stage initialized.');

	try {
		// Step 1
		const intake = await receiveFeedbackInput(out_pkg, event_id, log);
		
		// Step 2
		const eligibility = await confirmFeedbackEligibility(intake.outcome_records, log);
		
		// Step 3
		const rules = loadFeedbackRules(log);
		
		// Step 4
		const createdRecords = await createFeedbackRecords(
			eligibility.eligible, 
			intake.source_event_id, 
			intake.source_orchestrator_decision_id, 
			rules, 
			log
		);
		
		// Step 4b
		const contextItems = createFeedbackContextItems(
			intake.blocked_context, 
			intake.source_event_id, 
			intake.source_orchestrator_decision_id, 
			log
		);
		
		// Steps 5-10: evaluations
		for (const record of createdRecords) {
			const signalValidity = buildSignalValidityFeedback(record);
			const decisionQuality = buildDecisionQualityFeedback(record);
			const actionExecution = buildActionExecutionFeedback(record);
			const outcomeResultEvaluation = buildOutcomeResultFeedback(record);
			const humanReviewState = buildHumanReviewStateFeedback(record);
			const tuning = buildTuningCandidates();

			await prisma.pipelineFeedbackRecord.update({
				where: { feedbackId: record.feedbackId },
				data: {
					signalValidity: signalValidity.signal_validity,
					decisionQuality: decisionQuality.decision_quality,
					actionExecutionQuality: actionExecution.action_execution_quality,
					tuningCandidates: tuning.tuning_candidates,
					details: {
						...record.details,
						...signalValidity,
						...decisionQuality,
						...actionExecution,
						...outcomeResultEvaluation,
						...humanReviewState,
						tuning_candidates_identification: tuning.tuning_candidates_identification
					}
				}
			});

			log.step(
				'pass',
				`Evaluations written for ${record.feedbackId}`,
				`signal=${signalValidity.signal_validity} decision=${decisionQuality.decision_quality} execution=${actionExecution.action_execution_quality} tuning=${tuning.tuning_candidates.length} candidates`
			);
		}
		
		// Refresh records to get latest state for pkg
		const finalRecords = await prisma.pipelineFeedbackRecord.findMany({
			where: { feedbackId: { in: createdRecords.map(r => r.feedbackId) } }
		});

		// Step 11
		const fbPkg = buildFeedbackPackage(finalRecords, contextItems, intake, rules);
		
		// Step 12
		const result = stopAfterFeedback(fbPkg, finalRecords, log);
		result.context_items = contextItems;
		return result;

	} catch (err: any) {
		log.step('fail', `Section 7 fatal error: ${err?.message || err}`, 'Section 7 stopped due to fatal error.');
		return {
			completed: false,
			feedback_records: [],
			context_items: [],
			fb_pkg: null,
			handoff_status: 'failed',
			pipeline_status: 'feedback_failed',
			stop_reason: err?.message || String(err),
			log
		};
	}
}
