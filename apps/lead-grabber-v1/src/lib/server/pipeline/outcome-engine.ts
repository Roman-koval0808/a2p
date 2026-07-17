import { prisma } from '$lib/db';

export interface CreatedOutcome {
	outcome_id: string;
	event_id: string;
	decision_id: string;
	action_queue_id: string;
	execution_id: string;
	action_id: string;
	outcome_type: string;
	outcome_status: string;
	time_to_response_hours: number | null;
	approval_wait_hours: number | null;
	human_edited: boolean;
	posted_externally: boolean;
	do_not_count_as_success: boolean;
	details: any;
}

export interface BlockedContext {
	blocked_context_id: string;
	action_id: string;
	action_name?: string;
	outcome_type: 'blocked_preserved';
	outcome_status: 'blocked';
	do_not_count_as_success: true;
	posted_to_google: false;
	external_action_completed: false;
	blocked_reason: string;
}

export interface OutcomeResult {
	completed: boolean;
	outcome_records: CreatedOutcome[];
	blocked_context: BlockedContext[];
	out_pkg: any | null;
	handoff_status: 'ready_for_feedback' | 'failed';
	pipeline_status: 'outcome_ready' | 'outcome_failed';
	stop_reason: string | null;
	log: OutcomeLog;
}

export interface EligibleExecutionRecord {
	execution_id: string;
	action_queue_id: string;
	action_id: string;
	action_name?: string;
	execution_status: string;
	created_at?: Date | null;
	approval_package_id?: string | null;
	generated_output?: any;
}

export class OutcomeLog {
	decision_id: string;
	steps: { status: 'pass' | 'fail' | 'warn'; message: string; timestamp: string; description?: string }[] = [];

	constructor(decision_id: string) {
		this.decision_id = decision_id;
	}

	step(status: 'pass' | 'fail' | 'warn', message: string, description?: string) {
		const timestamp = new Date().toISOString().replace('T', ' ').replace('Z', '');
		const statusIcon = status === 'fail' ? '🔴' : status === 'warn' ? '🟡' : '🔵';
		console.log(`${statusIcon} [${timestamp}] Section 6 - ${status.toUpperCase()} : ${message}`);
		if (description) {
			console.log(`      → ${description}`);
		}
		this.steps.push({ status, message, timestamp, description });
	}
}

const RECORDABLE_STATUSES = [
	'draft_created',
	'automatic_internal_action_completed',
	'failed',
	'failed_permanently',
	'pending_manual_assignment'
];

// Actions that post publicly and must never be recorded as an outcome (audit-only).
// Kept as a single named constant so the rule isn't scattered as bare string literals.
const NON_RECORDABLE_ACTION_IDS = ['ACT-REV-002'];

function shortId(prefix: string) {
	return `${prefix}_${Math.random().toString(36).substring(2, 12)}`;
}

function calcHours(from: Date, to: Date): number {
	return (to.getTime() - from.getTime()) / (1000 * 60 * 60);
}

function parseGeneratedOutput(value: any): any {
	if (value === null || value === undefined) return null;
	if (typeof value === 'object') return value;
	if (typeof value !== 'string') return value;
	try {
		return JSON.parse(value);
	} catch {
		return { raw: value };
	}
}

async function receiveExecutionOutput(execOutPackage: any, eventId: string, log: OutcomeLog) {
	if (!execOutPackage) throw new Error('missing_exec_out_package');
	if (execOutPackage.section_5_status !== 'completed') throw new Error('section_5_not_completed');
	if (execOutPackage.handoff_status !== 'ready_for_outcome') throw new Error('invalid_handoff_status_for_outcome');

	const executionRecords = execOutPackage.execution_records || [];
	if (!Array.isArray(executionRecords) || executionRecords.length === 0) throw new Error('no_execution_records');

	if (execOutPackage.boundary_flags?.outcome_recorded === true) throw new Error('duplicate_outcome_prevented');
	if (execOutPackage.boundary_flags?.feedback_recorded === true) throw new Error('feedback_already_started');

	const executionIds = executionRecords.map((r: any) => r.execution_id).filter(Boolean);
	if (executionIds.length > 0) {
		const existing = await prisma.pipelineOutcome.findMany({
			where: {
				executionId: { in: executionIds }
			},
			select: { id: true, executionId: true }
		});

		if (existing.length > 0) {
			throw new Error('duplicate_outcome_prevented');
		}
	}

	log.step('pass', `${executionRecords.length} execution record(s) received`, 'Step 1 intake checks passed.');

	return {
		safe_to_continue: true,
		execution_records: executionRecords,
		blocked_audit_only: execOutPackage.blocked_audit_only || [],
		event_id: eventId || execOutPackage.source_event_id,
		decision_id: execOutPackage.source_orchestrator_decision_id,
		company_id: execOutPackage.company_id || null
	};
}

async function confirmOutcomeEntryEligibility(executionRecords: any[], blockedAuditOnly: any[], log: OutcomeLog) {
	const eligible: EligibleExecutionRecord[] = [];
	const ineligible: any[] = [];

	for (const rec of executionRecords) {
		const reasons: string[] = [];
		if (NON_RECORDABLE_ACTION_IDS.includes(rec.action_id)) reasons.push('blocked_action');
		if (!rec.execution_id) reasons.push('missing_execution_id');
		if (!RECORDABLE_STATUSES.includes(rec.execution_status)) reasons.push('non_recordable_status');
		if (!rec.action_queue_id) reasons.push('missing_queue_id');

		if (reasons.length > 0) {
			ineligible.push({ rec, reasons });
			log.step('warn', `Record ineligible: ${rec.execution_id || 'unknown'}`, reasons.join(', '));
			continue;
		}

		const executionRow = await prisma.pipelineExecution.findUnique({
			where: { actionExecutionId: rec.execution_id },
			select: {
				actionExecutionId: true,
				actionQueueId: true,
				actionId: true,
				executionStatus: true,
				createdAt: true,
				approvalPackages: {
					orderBy: { createdAt: 'desc' },
					take: 1,
					select: { approvalPackageId: true }
				},
				generatedOutput: true
			}
		});

		if (!executionRow) {
			ineligible.push({ rec, reasons: ['execution_not_found'] });
			log.step('warn', `Execution missing in DB: ${rec.execution_id}`, 'Skipping record because action_executions row was not found.');
			continue;
		}

		eligible.push({
			execution_id: executionRow.actionExecutionId,
			action_queue_id: executionRow.actionQueueId,
			action_id: executionRow.actionId,
			execution_status: executionRow.executionStatus,
			created_at: executionRow.createdAt,
			approval_package_id: executionRow.approvalPackages?.[0]?.approvalPackageId || null,
			generated_output: parseGeneratedOutput(executionRow.generatedOutput)
		});
	}

	if (eligible.length === 0) {
		throw new Error('no_eligible_records');
	}

	log.step('pass', `${eligible.length} execution record(s) eligible`, 'Step 2 eligibility checks complete.');
	return { eligible, ineligible, blocked_audit_only: blockedAuditOnly || [] };
}

function loadOutcomeRules(log: OutcomeLog) {
	const rules = {
		snapshot_id: `out_rules_snap_${Math.random().toString(36).substring(2, 12)}`,
		execution_to_outcome_map: {
			draft_created: {
				type: 'draft_created',
				status: 'waiting_for_approval',
				do_not_count: false
			},
			automatic_internal_action_completed: {
				type: 'completed',
				status: 'completed',
				do_not_count: false
			},
			failed_permanently: {
				type: 'failed',
				status: 'failed',
				do_not_count: true
			},
			failed: {
				type: 'failed',
				status: 'failed',
				do_not_count: true
			},
			pending_manual_assignment: {
				type: 'assigned',
				status: 'waiting',
				do_not_count: false
			}
		},
		blocked_outcome_type: 'blocked_preserved',
		blocked_outcome_status: 'blocked'
	};

	log.step('pass', `Rules snapshot loaded: ${rules.snapshot_id}`, 'Step 3 completed with frozen execution-to-outcome mapping.');
	return rules;
}

function normalizeComplaintThemes(raw: any): string[] {
	if (!raw) return [];
	if (Array.isArray(raw)) return raw;
	if (typeof raw === 'string') return raw.split(',').map(s => s.trim()).filter(Boolean);
	return [];
}

function buildDetailsObject(rec: EligibleExecutionRecord, mapping: any, actionNameMap: Record<string, string>) {
	if (mapping.type === 'draft_created') {
		return {
			outcome_type: 'draft_created',
			outcome_status: 'waiting_for_approval',
			action_id: rec.action_id,
			action_name: actionNameMap[rec.action_id] || rec.action_name || rec.action_id,
			approval_required: true,
			approval_owner: 'consultant',
			approval_status: 'pending_approval',
			approval_package_id: rec.approval_package_id || null,
			draft_exists: Boolean(rec.generated_output?.draft_reply),
			posted_to_google: false,
			external_action_completed: false,
			ready_for_feedback_section: true
		};
	}

	if (mapping.type === 'completed') {
		const complaintThemes = normalizeComplaintThemes(rec.generated_output?.complaint_topics);
		return {
			outcome_type: 'completed',
			outcome_status: 'completed',
			action_id: rec.action_id,
			action_name: actionNameMap[rec.action_id] || rec.action_name || rec.action_id,
			internal_action_completed: true,
			complaint_themes: complaintThemes,
			posted_externally: false,
			approval_required: false,
			ready_for_feedback_section: true
		};
	}

	return {
		outcome_type: mapping.type,
		outcome_status: mapping.status,
		action_id: rec.action_id,
		posted_externally: false,
		ready_for_feedback_section: true
	};
}

async function createOutcomeRecords(
	eligibleRecords: EligibleExecutionRecord[],
	execOut: any,
	rulesSnapshot: any,
	actionNameMap: Record<string, string>,
	log: OutcomeLog
): Promise<CreatedOutcome[]> {
	const created: CreatedOutcome[] = [];

	await prisma.$transaction(async (tx: any) => {
		for (const rec of eligibleRecords) {
			const mapping = rulesSnapshot.execution_to_outcome_map[rec.execution_status];
			if (!mapping) {
				throw new Error(`missing_outcome_mapping_for_${rec.execution_status}`);
			}

			const outcome_id = shortId('out');
			const eventRow = await tx.pipelineEvent.findUnique({
				where: { id: execOut.source_event_id },
				select: { createdAt: true }
			});

			const eventCreatedAt = eventRow?.createdAt ?? null;
			const execCreatedAt = rec.created_at || null;

			const timeToResponse = eventCreatedAt && execCreatedAt ? calcHours(eventCreatedAt, execCreatedAt) : null;
			const approvalWait =
				mapping.status === 'waiting_for_approval' && execCreatedAt
					? calcHours(execCreatedAt, new Date())
					: null;

			// T0.5: action display name comes from PipelineActionLibrary, not a hardcoded map.
			log.step('pass', `Action name for ${rec.action_id} → "${actionNameMap[rec.action_id] || rec.action_id}" (from PipelineActionLibrary)`, 'Resolved from the library so it cannot drift from a hardcoded map.');

			const details = buildDetailsObject(rec, mapping, actionNameMap);

			await tx.pipelineOutcome.create({
				data: {
					outcomeId: outcome_id,
					eventId: execOut.source_event_id,
					decisionId: execOut.source_orchestrator_decision_id,
					actionQueueId: rec.action_queue_id,
					executionId: rec.execution_id,
					actionId: rec.action_id,
					outcomeType: mapping.type,
					outcomeStatus: mapping.status,
					timeToResponseHours: timeToResponse,
					approvalWaitHours: approvalWait,
					humanEdited: false,
					postedExternally: false,
					doNotCountAsSuccess: mapping.do_not_count,
					details
				}
			});

			created.push({
				outcome_id,
				event_id: execOut.source_event_id,
				decision_id: execOut.source_orchestrator_decision_id,
				action_queue_id: rec.action_queue_id,
				execution_id: rec.execution_id,
				action_id: rec.action_id,
				outcome_type: mapping.type,
				outcome_status: mapping.status,
				time_to_response_hours: timeToResponse,
				approval_wait_hours: approvalWait,
				human_edited: false,
				posted_externally: false,
				do_not_count_as_success: mapping.do_not_count,
				details
			});
		}
	}, { timeout: 15000 });

	log.step('pass', `${created.length} outcome record(s) inserted in single transaction`, 'Step 4-6 complete.');
	return created;
}

function buildBlockedContext(blockedAuditOnly: any[], log: OutcomeLog): BlockedContext[] {
	if (!Array.isArray(blockedAuditOnly) || blockedAuditOnly.length === 0) {
		log.step('pass', 'No blocked context items. Step 7 complete.', 'No blocked audit-only actions in this run.');
		return [];
	}

	const blocked = blockedAuditOnly.map((item: any) => ({
		blocked_context_id: shortId('blocked_ctx'),
		action_id: item.action_id || 'ACT-REV-002',
		action_name: item.action_name || 'post_review_reply',
		outcome_type: 'blocked_preserved' as const,
		outcome_status: 'blocked' as const,
		do_not_count_as_success: true as const,
		posted_to_google: false as const,
		external_action_completed: false as const,
		blocked_reason: item.reason || item.blocked_reason || 'Business policy requires human approval before posting publicly.'
	}));

	log.step('pass', `${blocked.length} blocked context record(s) preserved in out_pkg only`, 'Step 7 completed.');
	return blocked;
}

async function updateTimingMetrics(createdOutcomes: CreatedOutcome[], log: OutcomeLog) {
	for (const outcome of createdOutcomes) {
		if (outcome.time_to_response_hours === null) {
			log.step('warn', `${outcome.outcome_id} time_to_response_hours is null`, 'Missing timestamps prevented timing calculation.');
		}
		if (outcome.outcome_status === 'waiting_for_approval' && outcome.approval_wait_hours === null) {
			log.step('warn', `${outcome.outcome_id} approval_wait_hours is null for waiting record`, 'Approval wait clock could not be started.');
		}
	}
	log.step('pass', 'Timing metrics verified', 'Step 8 completed.');
}

async function updateReferences(createdOutcomes: CreatedOutcome[], log: OutcomeLog) {
	for (const outcome of createdOutcomes) {
		// Note: pipelineExecution doesn't have outcomeId in schema, so we skip updating it.
		await prisma.pipelineActionQueue.update({
			where: { id: outcome.action_queue_id },
			data: {
				status: 'outcome_recorded',
				updatedAt: new Date()
			}
		});
	}
	log.step('pass', 'Queue references updated', 'Step 9 completed.');
}

async function validateOutcomes(createdOutcomes: CreatedOutcome[], eventId: string, log: OutcomeLog) {
	for (const created of createdOutcomes) {
		const row = await prisma.pipelineOutcome.findUnique({
			where: { outcomeId: created.outcome_id }
		});

		if (!row) throw new Error(`outcome_not_found:${created.outcome_id}`);
		if (row.postedExternally === true) throw new Error('boundary_violation_posted_externally');
		if (!row.eventId || !row.decisionId || !row.actionQueueId || !row.executionId) throw new Error('missing_fk');
	}

	const blockedCount = await prisma.pipelineOutcome.count({
		where: {
			eventId: eventId,
			actionId: { in: NON_RECORDABLE_ACTION_IDS }
		}
	});

	if (blockedCount > 0) throw new Error('blocked_action_has_outcome_row');

	const feedbackCount = await prisma.pipelineFeedbackRecord.count({
		where: {
			eventId: eventId
		}
	});

	if (feedbackCount > 0) throw new Error('feedback_already_started');

	log.step('pass', 'Outcome validation checks passed', 'Step 10 traceability and boundary checks completed.');
}

function buildOutcomePackage(createdOutcomes: CreatedOutcome[], blockedCtx: BlockedContext[], execOutPackage: any, log: OutcomeLog) {
	const out_pkg = {
		section_6_completion_result: {
			section: 'Section 6: Outcome',
			section_6_status: 'completed',
			outcome_output_package_id: shortId('out_pkg'),
			source_event_id: execOutPackage.source_event_id,
			source_orchestrator_decision_id: execOutPackage.source_orchestrator_decision_id,
			company_id: execOutPackage.company_id,
			outcome_records: createdOutcomes,
			blocked_no_external_action_context: blockedCtx,
			boundary_flags: {
				outcome_records_created: true,
				public_reply_posted: false,
				feedback_recorded: false,
				feedback_learning_performed: false
			},
			handoff_status: 'ready_for_feedback',
			next_section: 'Section 7: Feedback',
			section_stop_reason: 'Section 6 stops before Feedback begins.'
		}
	};

	log.step('pass', `out_pkg built: ${out_pkg.section_6_completion_result.outcome_output_package_id}`, 'Step 11 completed.');
	return out_pkg;
}

function stopBeforeFeedback(out_pkg: any, createdOutcomes: CreatedOutcome[], blockedCtx: BlockedContext[], log: OutcomeLog): OutcomeResult {
	if (out_pkg.section_6_completion_result.boundary_flags.public_reply_posted === true) {
		throw new Error('boundary_violation_posted_externally');
	}
	if (out_pkg.section_6_completion_result.boundary_flags.feedback_recorded === true) {
		throw new Error('boundary_violation_feedback_in_section_6');
	}

	log.step('pass', `Section 6 complete. outcome_records=${createdOutcomes.length}`, 'Step 12 boundary stop enforced.');

	return {
		completed: true,
		outcome_records: createdOutcomes,
		blocked_context: blockedCtx,
		out_pkg,
		handoff_status: 'ready_for_feedback',
		pipeline_status: 'outcome_ready',
		stop_reason: null,
		log
	};
}

export async function runOutcome(execOutPackage: any, eventId: string, decisionId: string, companyId: string | null): Promise<OutcomeResult> {
	const log = new OutcomeLog(decisionId);
	log.step('pass', `Section 6 started. decision_id=${decisionId}`, 'Outcome stage initialized.');

	try {
		const intake = await receiveExecutionOutput(execOutPackage, eventId, log);
		if (!intake.safe_to_continue) {
			return {
				completed: false,
				outcome_records: [],
				blocked_context: [],
				out_pkg: null,
				handoff_status: 'failed',
				pipeline_status: 'outcome_failed',
				stop_reason: 'outcome_intake_not_safe',
				log
			};
		}

		const eligibility = await confirmOutcomeEntryEligibility(intake.execution_records, intake.blocked_audit_only, log);
		const rules = loadOutcomeRules(log);

		// Action display names come from the library (single source of truth) rather
		// than a hardcoded map that must be kept in sync.
		const libraryRows = await prisma.pipelineActionLibrary.findMany({ select: { actionId: true, name: true } });
		const actionNameMap: Record<string, string> = {};
		for (const row of libraryRows) actionNameMap[row.actionId] = row.name;

		const resolvedExecOutPackage = {
			...execOutPackage,
			source_event_id: intake.event_id,
			source_orchestrator_decision_id: intake.decision_id || decisionId,
			company_id: intake.company_id || companyId
		};

		const createdOutcomes = await createOutcomeRecords(eligibility.eligible, resolvedExecOutPackage, rules, actionNameMap, log);
		const blockedCtx = buildBlockedContext(eligibility.blocked_audit_only, log);
		await updateTimingMetrics(createdOutcomes, log);
		await updateReferences(createdOutcomes, log);
		await validateOutcomes(createdOutcomes, intake.event_id, log);
		const out_pkg = buildOutcomePackage(createdOutcomes, blockedCtx, resolvedExecOutPackage, log);
		return stopBeforeFeedback(out_pkg, createdOutcomes, blockedCtx, log);
	} catch (err: any) {
		log.step('fail', `Section 6 fatal error: ${err?.message || err}`, 'Section 6 stopped due to fatal error.');
		return {
			completed: false,
			outcome_records: [],
			blocked_context: [],
			out_pkg: null,
			handoff_status: 'failed',
			pipeline_status: 'outcome_failed',
			stop_reason: err?.message || String(err),
			log
		};
	}
}
