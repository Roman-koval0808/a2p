import { prisma } from '$lib/db';
import { generateReviewReplyDraft } from './ai-review-reply';

export interface ExecutionRecord {
	execution_id: string;
	execution_row_id: string;
	action_queue_id: string;
	action_id: string;
	action_name?: string;
	execution_mode: string;
	execution_status: string;
	requires_human_approval: boolean;
	approval_owner: string | null;
	approval_status: string | null;
	approval_package_id?: string | null;
	posted_externally: boolean;
	generated_output?: any;
	failure_reason?: string | null;
	retry_count?: number;
}

export interface ExecutionResult {
	executed: boolean;
	execution_records: ExecutionRecord[];
	blocked_audit_only: any[];
	approval_package_id: string | null;
	handoff_status: string;
	pipeline_status: string;
	stop_reason: string | null;
	execution_output_package?: any;
	log?: ExecutionLog;
}

export class ExecutionLog {
	decision_id: string;
	steps: { status: string; message: string; timestamp: string; description?: string }[] = [];

	constructor(decision_id: string) {
		this.decision_id = decision_id;
	}

	step(status: string, message: string, description?: string) {
		const timestamp = new Date().toISOString().replace('T', ' ').replace('Z', '');
		const statusIcon = status.includes('error') ? '🔴' : (status.includes('blocked') || status.includes('warning')) ? '🟡' : '🔵';
		console.log(`${statusIcon} [${timestamp}] Section 5 - ${status.toUpperCase()} : ${message}`);
		if (description) {
			console.log(`      → ${description}`);
		}
		this.steps.push({ status, message, timestamp, description });
	}
}

const KNOWN_MODES = ['approval_required', 'automatic', 'manual', 'observe_only'];
const VALID_QUEUE_STATUSES = ['pending_approval', 'ready_for_execution', 'pending'];

function isEmptyParams(params: any) {
	if (params === null || params === undefined) return true;
	if (typeof params !== 'object') return true;
	return Object.keys(params).length === 0;
}

function shortId(prefix: string) {
	return `${prefix}_${Math.random().toString(36).substring(2, 12)}`;
}

async function receiveQueueOutput(decisionId: string, eventId: string, log: ExecutionLog) {
	const decision = await prisma.pipelineDecision.findUnique({
		where: { decisionId },
		include: {
			event: { include: { enrichments: true, company: true } },
			actionQueue: true
		}
	});

	if (!decision) {
		log.step('error', `Decision not found: ${decisionId}`, 'Section 5 cannot start without a valid orchestrator decision.');
		return { error: 'decision_not_found' };
	}

	const queueRecords = (decision.actionQueue as any[])
		.filter((r: any) => r.executionLane !== 'blocked')
		.sort((a: any, b: any) => (a.createdAt?.getTime() || 0) - (b.createdAt?.getTime() || 0));

	if (queueRecords.length === 0) {
		log.step('warning', 'No queue records found for decision', 'Section 4 produced no actionable queue records for this decision.');
		return { error: 'no_queue_records' };
	}

	for (const record of queueRecords) {
		const existing = await prisma.pipelineExecution.findFirst({
			where: { actionQueueId: record.id }
		});
		if (existing) {
			log.step('error', `DUPLICATE GUARD: execution already exists for ${record.id}`, 'Duplicate execution prevention triggered.');
			return { error: 'duplicate_execution_prevented' };
		}
	}

	const blockedAuditOnly = (decision.blockedActionIds as any[]) || [];
	log.step('exec_intake_opened', `${queueRecords.length} records received. No duplicates found.`, 'Execution intake opened and validated.');

	return { queueRecords, blockedAuditOnly, decision, event: decision.event };
}

async function confirmEligibility(queueRecords: any[], log: ExecutionLog) {
	const eligible: any[] = [];
	const ineligible: any[] = [];

	for (const record of queueRecords) {
		const reasons: string[] = [];
		if (!record.actionId) reasons.push('missing_action_id');

		const libMatch = await prisma.pipelineActionLibrary.findUnique({
			where: { actionId: record.actionId }
		});
		if (!libMatch) reasons.push('action_id_not_in_library');

		const mode = record.executionLane;
		if (!KNOWN_MODES.includes(mode)) reasons.push('unknown_execution_mode');

		if (!VALID_QUEUE_STATUSES.includes(record.status)) reasons.push('invalid_queue_status_for_execution');

		if (isEmptyParams(record.parameters)) reasons.push('parameters_missing_or_empty');

		const existing = await prisma.pipelineExecution.findFirst({
			where: { actionQueueId: record.id }
		});
		if (existing) reasons.push('duplicate_execution_record');

		if (reasons.length > 0) {
			ineligible.push({ action_queue_id: record.id, reasons });
		} else {
			eligible.push(record);
			log.step('eligible', `${record.id} confirmed eligible`, 'Passed all eligibility checks for execution entry.');
		}
	}

	if (eligible.length === 0) {
		return { error: 'no_eligible_records', eligible, ineligible };
	}

	return { eligible, ineligible };
}

async function loadExecutionRules(companyId: string | null, actionIds: string[], log: ExecutionLog) {
	const actionLibraryRows = await prisma.pipelineActionLibrary.findMany({
		where: { actionId: { in: actionIds } }
	});

	let businessConfig = null;
	if (companyId) {
		businessConfig = await prisma.pipelineBusinessConfig.findUnique({
			where: { companyId }
		});
	}

	if (!businessConfig) {
		log.step('warning', `No business config for ${companyId}. Applying safe defaults.`, 'Fail-safe defaults ensure approval-first behavior.');
		businessConfig = {
			publicResponseRequiresApproval: true,
			brandTone: 'professional_friendly',
			maxRetries: 3,
			maxReplyLength: 150
		} as any;
	}

	const safetyRules = await prisma.pipelineSafetyRule.findMany({
		where: { active: true },
		orderBy: { severity: 'desc' }
	});

	const actionLibrary: Record<string, any> = {};
	for (const row of actionLibraryRows) {
		actionLibrary[row.actionId] = row;
	}

	const snapshot = {
		snapshot_id: `exec_rules_snap_${Math.random().toString(36).substring(2, 12)}`,
		company_id: companyId,
		action_library: actionLibrary,
		business_config: businessConfig,
		safety_rules: safetyRules,
		retry_policy: {
			max_retries: (businessConfig as any).maxRetries || 3,
			retry_delay_seconds: 30
		},
		failure_policy: 'fail_safe'
	};

	log.step('rules_snapshot_created', `Execution rules snapshot created: ${snapshot.snapshot_id}`, 'Frozen rules snapshot will be used for the rest of Section 5.');
	return snapshot;
}

async function createExecutionRecords(eligibleRecords: any[], decision: any, log: ExecutionLog) {
	const created: ExecutionRecord[] = [];

	await prisma.$transaction(async (tx: any) => {
		for (const record of eligibleRecords) {
			const execId = shortId('exec');
			const lane = record.executionLane;
			const requiresApproval = lane === 'approval_required';
			const approvalOwner = decision.owner || 'business_owner';
			const createdRow = await tx.pipelineExecution.create({
				data: {
					actionExecutionId: execId,
					actionQueueId: record.id,
					actionId: record.actionId,
					executionMode: lane,
					executionStatus: 'created_pending_route',
					approvalOwner: approvalOwner,
					approvalStatus: requiresApproval ? 'pending_approval' : null,
					requiresHumanApproval: requiresApproval,
					postedExternally: false,
					retryCount: 0
				}
			});

			created.push({
				execution_id: execId,
				execution_row_id: createdRow.id,
				action_queue_id: record.id,
				action_id: record.actionId,
				execution_mode: lane,
				execution_status: 'created_pending_route',
				requires_human_approval: requiresApproval,
				approval_owner: approvalOwner,
				approval_status: requiresApproval ? 'pending_approval' : null,
				posted_externally: false,
				retry_count: 0
			});

			log.step('execution_created', `${execId} created for ${record.id}`, 'Execution record created and staged for routing.');
		}
	}, { timeout: 15000 });

	return created;
}

function routeByExecutionMode(executionRecords: ExecutionRecord[], log: ExecutionLog) {
	const routingSummaryId = shortId('exec_route');
	const lanes: Record<string, ExecutionRecord[]> = {
		approval_required: [],
		automatic: [],
		manual: [],
		observe_only: []
	};

	for (const rec of executionRecords) {
		const mode = rec.execution_mode;
		if (lanes[mode]) {
			lanes[mode].push(rec);
			log.step('routed', `${rec.execution_id} routed to ${mode} lane`, 'Lane assignment complete. No execution performed yet.');
		} else {
			log.step('warning', `${rec.execution_id} has unknown mode: ${mode}`, 'Unknown execution mode logged and skipped.');
		}
	}

	log.step('routing_complete', `Routing complete. approval_required=${lanes.approval_required.length} automatic=${lanes.automatic.length} manual=${lanes.manual.length}`, 'All records assigned to their execution lanes.');
	return { routingSummaryId, lanes };
}

async function executeAutomaticActions(
	automaticRecords: ExecutionRecord[],
	queueMap: Map<string, any>,
	rulesSnapshot: any,
	event: any,
	decision: any,
	log: ExecutionLog
) {
	const results: ExecutionRecord[] = [];

	for (const rec of automaticRecords) {
		const queueRow = queueMap.get(rec.action_queue_id);
		const params = queueRow?.parameters || {};
		const libRow = rulesSnapshot.action_library[rec.action_id] || {};
		const isPublic = !!libRow.isPublicFacing;
		const callsA2p = !!(libRow.callsA2p);

		if (isPublic) {
			log.step('error', `${rec.execution_id} failed safety gate. isPublicFacing is TRUE.`, 'Automatic execution blocked by safety gate.');
			await prisma.pipelineExecution.update({
				where: { id: rec.execution_row_id },
				data: { executionStatus: 'escalated_to_manual', updatedAt: new Date() }
			});
			await prisma.pipelineActionQueue.update({
				where: { id: rec.action_queue_id },
				data: { status: 'pending_manual', updatedAt: new Date() }
			});
			results.push({ ...rec, execution_status: 'escalated_to_manual' });
			continue;
		}

		try {
			if (rec.action_id === 'ACT-REV-004') {
				const logEntry = {
					action: 'log_review_complaint_theme',
					complaint_topics: params.complaint_topics || [],
					review_id: event?.eventId || null,
					event_id: event?.eventId || null,
					signal_name: params.signal_name || null,
					rating: params.rating || null,
					logged_internally: true,
					posted_externally: false
				};

				await prisma.pipelineExecution.update({
					where: { id: rec.execution_row_id },
					data: {
						executionStatus: 'automatic_internal_action_completed',
						generatedOutput: JSON.stringify(logEntry),
						updatedAt: new Date()
					}
				});

				if (event?.id) {
					const themes = (params.complaint_topics || []) as string[];
					for (const theme of themes) {
						await prisma.pipelineComplaintThemeLog.create({
							data: {
								eventId: event.id,
								execId: rec.execution_row_id,
								theme: theme
							}
						});
					}
				}

				await prisma.pipelineActionQueue.update({
					where: { id: rec.action_queue_id },
					data: { status: 'execution_completed', updatedAt: new Date() }
				});

				log.step('automatic_completed', `${rec.execution_id} ACT-REV-004 completed. Complaint theme logged. No external action.`, 'Automatic internal action completed safely.');
				results.push({
					...rec,
					execution_status: 'automatic_internal_action_completed',
					generated_output: logEntry
				});
			} else if (rec.action_id === 'ACT-A2P-002') {
				// REAL SMS Dispatch for Urgent Owner Notification
				const customerName = params.customer_name || event?.authorName || 'Valued Customer';
				const aiSummary = params.ai_summary || event?.enrichments?.[0]?.aiSummary || 'No summary available.';
				
				const priorityLabels: Record<number, string> = { 1: 'CRITICAL', 2: 'HIGH', 3: 'MEDIUM', 4: 'LOW', 5: 'INFO' };
				const priorityLevel = decision?.priority ?? 3;
				const urgencyText = priorityLabels[priorityLevel] || `P${priorityLevel}`;
				
				const smsText = `[ClearSky ${urgencyText} ALERT] 🚨\nCustomer: ${customerName}\nIssue: ${aiSummary}\n\nPlease check the dashboard for details.`;

				// Call sendOwnerSmsAlert
				const { sendOwnerSmsAlert } = await import('../sms-alert');
				await sendOwnerSmsAlert(event.companyId, smsText);

				const generatedOutput = {
					action: rec.action_id,
					target: 'business_owner',
					message: smsText,
					sms_text: smsText,
					posted_externally: false,
					simulated: false,
					dispatched_at: new Date().toISOString()
				};

				await prisma.pipelineExecution.update({
					where: { id: rec.execution_row_id },
					data: {
						executionStatus: 'automatic_internal_action_completed',
						generatedOutput: JSON.stringify(generatedOutput),
						updatedAt: new Date()
					}
				});

				await prisma.pipelineActionQueue.update({
					where: { id: rec.action_queue_id },
					data: { status: 'execution_completed', updatedAt: new Date() }
				});

				log.step('automatic_completed', `${rec.execution_id} ACT-A2P-002 completed. Sent SMS Alert to owner. Alert Text: "${smsText}"`, 'Automatic SMS alert sent successfully.');
				results.push({
					...rec,
					execution_status: 'automatic_internal_action_completed',
					generated_output: generatedOutput
				});
			} else if (rec.action_id.startsWith('ACT-A2P-')) {
				const customerName = params.customer_name || event?.authorName || 'Valued Customer';
				const aiSummary = params.ai_summary || event?.enrichments?.[0]?.aiSummary || 'No summary available.';
				
				const priorityLabels: Record<number, string> = { 1: 'CRITICAL', 2: 'HIGH', 3: 'MEDIUM', 4: 'LOW', 5: 'INFO' };
				const priorityLevel = decision?.priority ?? 3;
				const urgencyText = priorityLabels[priorityLevel] || `P${priorityLevel}`;
				
				const smsText = `[ClearSky ${urgencyText} ALERT] 🚨\nCustomer: ${customerName}\nIssue: ${aiSummary}\n\nPlease check the dashboard for details.`;

				const generatedOutput = {
					action: rec.action_id,
					target: params.target || 'business_owner',
					message: smsText,
					sms_text: smsText,
					posted_externally: false,
					simulated: true,
					dispatched_at: new Date().toISOString()
				};

				await prisma.pipelineExecution.update({
					where: { id: rec.execution_row_id },
					data: {
						executionStatus: 'automatic_internal_action_completed',
						generatedOutput: JSON.stringify(generatedOutput),
						updatedAt: new Date()
					}
				});

				await prisma.pipelineActionQueue.update({
					where: { id: rec.action_queue_id },
					data: { status: 'execution_completed', updatedAt: new Date() }
				});

				log.step('automatic_completed', `${rec.execution_id} ${rec.action_id} simulated. SMS Alert Text: "${smsText}"`, 'Automatic internal action simulated.');
				
				results.push({
					...rec,
					execution_status: 'automatic_internal_action_completed',
					generated_output: generatedOutput
				});
			} else {
				log.step('warning', `No automatic handler for action_id: ${rec.action_id}. Skipping.`, 'No internal handler registered for this action.');
				results.push(rec);
			}
		} catch (err: any) {
			const failureReason = err?.message || String(err);
			log.step('error', `${rec.execution_id} automatic execution failed: ${failureReason}`, 'Automatic execution error captured.');
			await prisma.pipelineExecution.update({
				where: { id: rec.execution_row_id },
				data: {
					executionStatus: 'failed',
					failureReason: failureReason,
					updatedAt: new Date()
				}
			});
			results.push({ ...rec, execution_status: 'failed', failure_reason: failureReason });
		}
	}

	return results;
}

async function prepareApprovalRequiredOutputs(
	approvalRecords: ExecutionRecord[],
	queueMap: Map<string, any>,
	rulesSnapshot: any,
	event: any,
	mockMode: boolean,
	log: ExecutionLog
) {
	const results: ExecutionRecord[] = [];

	for (const rec of approvalRecords) {
		const queueRow = queueMap.get(rec.action_queue_id);
		const params = queueRow?.parameters || {};
		const bizConfig = rulesSnapshot.business_config || {};
		const businessName = event?.company?.name || bizConfig.business_name || 'ClearSky';

		try {
			if (rec.action_id === 'ACT-REV-001') {
				const draftText = await generateReviewReplyDraft({
					review_text: params.review_text || event?.reviewText || '',
					rating: params.rating || event?.reviewRatingNumeric || 0,
					customer_name: params.customer_name || event?.authorName || 'Valued Customer',
					praise_topics: params.praise_topics || (event?.enrichments?.[0]?.aiPraiseTopics ? (typeof event.enrichments[0].aiPraiseTopics === 'string' ? JSON.parse(event.enrichments[0].aiPraiseTopics) : event.enrichments[0].aiPraiseTopics) : []),
					complaint_topics: params.complaint_topics || (event?.enrichments?.[0]?.aiComplaintTopics ? (typeof event.enrichments[0].aiComplaintTopics === 'string' ? JSON.parse(event.enrichments[0].aiComplaintTopics) : event.enrichments[0].aiComplaintTopics) : []),
					business_name: businessName,
					tone: bizConfig.brandTone || 'professional_friendly',
					max_words: bizConfig.maxReplyLength || 150
				}, mockMode);

				const generatedOutput = {
					draft_reply: draftText,
					source_review_id: event?.eventId || null,
					rating: params.rating || event?.reviewRatingNumeric || null,
					generated_by: mockMode ? 'mock' : 'ai_api',
					posted_externally: false,
					ready_for_approval: true
				};

				await prisma.pipelineExecution.update({
					where: { id: rec.execution_row_id },
					data: {
						executionStatus: 'draft_created',
						generatedOutput: JSON.stringify(generatedOutput),
						requiresHumanApproval: true,
						updatedAt: new Date()
					}
				});

				const approvalPkgId = shortId('approval_pkg');
				await prisma.pipelineApprovalPackage.create({
					data: {
						approvalPackageId: approvalPkgId,
						executionId: rec.execution_row_id,
						owner: rec.approval_owner || 'business_owner',
						status: 'pending_approval'
					}
				});

				await prisma.pipelineActionQueue.update({
					where: { id: rec.action_queue_id },
					data: { status: 'draft_ready_pending_approval', updatedAt: new Date() }
				});

				log.step('draft_created', `${rec.execution_id} draft created. Pending approval.`, 'Approval-required draft stored.');

				results.push({
					...rec,
					execution_status: 'draft_created',
					generated_output: generatedOutput,
					approval_package_id: approvalPkgId,
					posted_externally: false
				});
			} else if (rec.action_id === 'ACT-A2P-005') {
				// Draft Callback Script
				const customerName = params.customer_name || event?.authorName || 'Valued Customer';
				const aiSummary = params.ai_summary || event?.enrichments?.[0]?.aiSummary || 'No summary available.';
				const enrichment = event?.enrichments?.[0] || {};
				
				const isComplaint = enrichment.aiContainsProblem === true;
				const isPraise = enrichment.aiPraiseDetected === true && !isComplaint;
				
				let scriptText = '';
				if (isComplaint) {
					scriptText = `[CALLBACK SCRIPT - SUPPORT]\n\n"Hi ${customerName}, this is [Your Name] from ${businessName}. I'm calling regarding your recent message about: ${aiSummary.substring(0, 100)}... I'm so sorry for the frustration. How can we make this right?"`;
				} else if (isPraise) {
					scriptText = `[CALLBACK SCRIPT - PRAISE]\n\n"Hi ${customerName}, this is [Your Name] from ${businessName}. I'm calling just to personally thank you for the wonderful review you left! We really appreciate the feedback about ${enrichment.aiPrimaryPraiseTopic || 'our service'}. Is there anything else we can do for you?"`;
				} else {
					scriptText = `[CALLBACK SCRIPT - REVENUE]\n\n"Hi ${customerName}, this is [Your Name] from ${businessName}. I'm calling regarding your interest in ${enrichment.aiServiceMentioned || 'our services'}. I'd love to discuss the quote and details you requested. When is a good time to talk?"`;
				}

				const generatedOutput = {
					draft_reply: scriptText,
					script_text: scriptText,
					action: 'draft_callback_script',
					is_complaint: isComplaint,
					is_praise: isPraise,
					ready_for_approval: true
				};

				await prisma.pipelineExecution.update({
					where: { id: rec.execution_row_id },
					data: {
						executionStatus: 'draft_created',
						generatedOutput: JSON.stringify(generatedOutput),
						requiresHumanApproval: true,
						updatedAt: new Date()
					}
				});

				const approvalPkgId = shortId('approval_pkg_call');
				await prisma.pipelineApprovalPackage.create({
					data: {
						approvalPackageId: approvalPkgId,
						executionId: rec.execution_row_id,
						owner: rec.approval_owner || 'business_owner',
						status: 'pending_approval'
					}
				});

				await prisma.pipelineActionQueue.update({
					where: { id: rec.action_queue_id },
					data: { status: 'draft_ready_pending_approval', updatedAt: new Date() }
				});

				log.step('draft_created', `${rec.execution_id} Callback script drafted.`, 'Approval-required script stored.');

				results.push({
					...rec,
					execution_status: 'draft_created',
					generated_output: generatedOutput,
					approval_package_id: approvalPkgId
				});
			} else if (rec.action_id === 'ACT-A2P-007') {
				// SMS Followup Draft
				const customerName = params.customer_name || event?.authorName || 'Valued Customer';
				const enrichment = event?.enrichments?.[0] || {};
				
				const isComplaint = enrichment.aiContainsProblem === true;
				const isPraise = enrichment.aiPraiseDetected === true && !isComplaint;
				const isQuote = enrichment.aiContainsQuoteRequest === true;

				let smsText = '';
				if (isPraise) {
					smsText = `Hi ${customerName}, this is ${businessName}. Thank you so much for the kind words! We're thrilled you're happy with the work. Have a great day!`;
				} else if (isQuote) {
					smsText = `Hi ${customerName}, this is ${businessName}. We received your quote request and are putting the details together now. We'll call you shortly to discuss!`;
				} else if (isComplaint) {
					smsText = `Hi ${customerName}, this is ${businessName}. We are very sorry to hear about the issue you mentioned. Our manager is reviewing this now and will call you ASAP to resolve it.`;
				} else {
					smsText = `Hi ${customerName}, this is ${businessName}. We received your message and are looking into it right now. We'll follow up shortly!`;
				}

				const generatedOutput = {
					draft_reply: smsText,
					sms_text: smsText,
					action: 'send_sms_followup',
					tone: isPraise ? 'praise' : isQuote ? 'quote' : isComplaint ? 'support' : 'neutral',
					ready_for_approval: true
				};

				await prisma.pipelineExecution.update({
					where: { id: rec.execution_row_id },
					data: {
						executionStatus: 'draft_created',
						generatedOutput: JSON.stringify(generatedOutput),
						requiresHumanApproval: true,
						updatedAt: new Date()
					}
				});

				const approvalPkgId = shortId('approval_pkg_sms');
				await prisma.pipelineApprovalPackage.create({
					data: {
						approvalPackageId: approvalPkgId,
						executionId: rec.execution_row_id,
						owner: rec.approval_owner || 'business_owner',
						status: 'pending_approval'
					}
				});

				await prisma.pipelineActionQueue.update({
					where: { id: rec.action_queue_id },
					data: { status: 'draft_ready_pending_approval', updatedAt: new Date() }
				});

				log.step('draft_created', `${rec.execution_id} SMS follow-up drafted.`, 'Approval-required SMS stored.');

				results.push({
					...rec,
					execution_status: 'draft_created',
					generated_output: generatedOutput,
					approval_package_id: approvalPkgId
				});
			} else if (event?.provider === 'google_workspace_email') {
				// Email Reply Draft
				const customerName = params.customer_name || event?.authorName || 'Valued Customer';
				const enrichment = event?.enrichments?.[0] || {};

				const isComplaint = enrichment.aiContainsProblem === true;
				const isPraise = enrichment.aiPraiseDetected === true && !isComplaint;
				const isQuote = enrichment.aiContainsQuoteRequest === true;
				const aiSummary = params.ai_summary || enrichment.aiSummary || 'your recent message';

				let emailDraft = '';
				if (isComplaint) {
					emailDraft = `Subject: Re: Your Recent Experience with ${businessName}\n\nHi ${customerName},\n\nThank you for reaching out. I sincerely apologize for the issue you described regarding ${aiSummary}. We take every concern seriously and want to make this right.\n\nOur team is reviewing your message now, and someone will follow up with you shortly to resolve this.\n\nWarm regards,\n${businessName}`;
				} else if (isQuote) {
					emailDraft = `Subject: Re: Your Quote Request\n\nHi ${customerName},\n\nThank you for your interest in ${businessName}! We've received your request for ${enrichment.aiServiceMentioned || 'our services'} and are putting together the details now.\n\nWe'll have a full quote ready for you shortly and will follow up with a call or email.\n\nBest regards,\n${businessName}`;
				} else if (isPraise) {
					emailDraft = `Subject: Re: Thank You!\n\nHi ${customerName},\n\nThank you so much for your kind words — it truly means a lot to the whole team! We're thrilled that you had a great experience with ${enrichment.aiPrimaryPraiseTopic || businessName}.\n\nWe look forward to working with you again!\n\nWith gratitude,\n${businessName}`;
				} else {
					emailDraft = `Subject: Re: Your Message\n\nHi ${customerName},\n\nThank you for reaching out to ${businessName}. We've received your message and are looking into it right away.\n\nSomeone from our team will follow up with you shortly.\n\nBest regards,\n${businessName}`;
				}

				const generatedOutput = {
					draft_reply: emailDraft,
					email_draft: emailDraft,
					action: rec.action_id,
					tone: isPraise ? 'praise' : isQuote ? 'quote' : isComplaint ? 'support' : 'neutral',
					ready_for_approval: true
				};

				await prisma.pipelineExecution.update({
					where: { id: rec.execution_row_id },
					data: {
						executionStatus: 'draft_created',
						generatedOutput: JSON.stringify(generatedOutput),
						requiresHumanApproval: true,
						updatedAt: new Date()
					}
				});

				const approvalPkgId = shortId('approval_pkg_email');
				await prisma.pipelineApprovalPackage.create({
					data: {
						approvalPackageId: approvalPkgId,
						executionId: rec.execution_row_id,
						owner: rec.approval_owner || 'business_owner',
						status: 'pending_approval'
					}
				});

				await prisma.pipelineActionQueue.update({
					where: { id: rec.action_queue_id },
					data: { status: 'draft_ready_pending_approval', updatedAt: new Date() }
				});

				log.step('draft_created', `${rec.execution_id} Email reply drafted.`, 'Approval-required email draft stored.');

				results.push({
					...rec,
					execution_status: 'draft_created',
					generated_output: generatedOutput,
					approval_package_id: approvalPkgId
				});
			} else {
				results.push(rec);
			}
		} catch (err: any) {
			const failureReason = err?.message || String(err);
			log.step('error', `${rec.execution_id} draft generation failed: ${failureReason}`, 'Draft generation failed and recorded.');
			await prisma.pipelineExecution.update({
				where: { id: rec.execution_row_id },
				data: {
					executionStatus: 'failed',
					failureReason: failureReason,
					updatedAt: new Date()
				}
			});
			results.push({ ...rec, execution_status: 'failed', failure_reason: failureReason });
		}
	}

	return results;
}

async function handleManualAssignments(manualRecords: ExecutionRecord[], queueMap: Map<string, any>, log: ExecutionLog) {
	if (manualRecords.length === 0) {
		log.step('manual_none', 'No manual lane records. Step 8 complete.', 'Manual lane empty.');
		return [];
	}

	const results: ExecutionRecord[] = [];
	for (const rec of manualRecords) {
		await prisma.pipelineExecution.update({
			where: { id: rec.execution_row_id },
			data: { executionStatus: 'pending_manual_assignment', updatedAt: new Date() }
		});

		await prisma.pipelineActionQueue.update({
			where: { id: rec.action_queue_id },
			data: { status: 'pending_manual', updatedAt: new Date() }
		});

		results.push({ ...rec, execution_status: 'pending_manual_assignment' });
		log.step('manual_assignment', `${rec.execution_id} requires manual action.`, 'Execution parked for human assignment.');
	}

	return results;
}

function handleObserveOnly(observeRecords: ExecutionRecord[], log: ExecutionLog) {
	if (observeRecords.length === 0) return [];
	for (const rec of observeRecords) {
		log.step('observe_only', `${rec.execution_id} routed to observe_only lane. No action taken.`, 'Observe-only lane recorded for audit.');
	}
	return observeRecords.map(r => ({ ...r, execution_status: 'observe_only' }));
}

async function handleStates(allResults: ExecutionRecord[], rulesSnapshot: any, log: ExecutionLog) {
	const maxRetries = rulesSnapshot.retry_policy?.max_retries || 3;
	const updated: ExecutionRecord[] = [];

	for (const rec of allResults) {
		const status = rec.execution_status;
		const execId = rec.execution_id;

		if (status === 'draft_created') {
			log.step('waiting_for_approval', `${execId} waiting for human approval.`, 'Draft parked at approval gate.');
			updated.push({ ...rec, execution_status: 'draft_created' });
		} else if (status === 'automatic_internal_action_completed') {
			log.step('completed', `${execId} completed successfully.`, 'Automatic execution complete.');
			updated.push({ ...rec, execution_status: 'automatic_internal_action_completed' });
		} else if (status === 'failed') {
			const retryCount = rec.retry_count || 0;
			if (retryCount < maxRetries) {
				const newCount = retryCount + 1;
				log.step('retry_pending', `${execId} retry ${newCount}/${maxRetries} scheduled.`, 'Retry scheduled.');
				updated.push({ ...rec, execution_status: 'retry_pending', retry_count: newCount });
			} else {
				log.step('error', `${execId} max retries reached. Failed permanently.`, 'Failure escalated.');
				updated.push({ ...rec, execution_status: 'failed_permanently' });
			}
		} else if (status === 'pending_manual_assignment') {
			log.step('pending_manual_assignment', `${execId} parked at manual assignment.`, 'Manual assignment pending.');
			updated.push(rec);
		} else {
			log.step('warning', `${execId} unknown state: ${status}`, 'Unknown state.');
			updated.push(rec);
		}
	}

	return updated;
}

async function updateStatuses(finalRecords: ExecutionRecord[], log: ExecutionLog) {
	const statusMap: Record<string, [string, string]> = {
		waiting_for_approval: ['draft_created', 'draft_ready_pending_approval'],
		draft_created: ['draft_created', 'draft_ready_pending_approval'],
		completed: ['automatic_internal_action_completed', 'execution_completed'],
		automatic_internal_action_completed: ['automatic_internal_action_completed', 'execution_completed'],
		retry_pending: ['retry_pending', 'retry_pending'],
		failed_permanently: ['failed', 'failed'],
		pending_manual_assignment: ['pending_manual_assignment', 'pending_manual'],
		observe_only: ['observe_only', 'observe_only']
	};

	for (const rec of finalRecords) {
		const state = rec.execution_status;
		const mapped = statusMap[state] || [state, state];
		const [execStatus, queueStatus] = mapped;

		await prisma.pipelineExecution.update({
			where: { id: rec.execution_row_id },
			data: {
				executionStatus: execStatus,
				retryCount: rec.retry_count ?? undefined,
				updatedAt: new Date()
			}
		});

		await prisma.pipelineActionQueue.update({
			where: { id: rec.action_queue_id },
			data: { status: queueStatus, updatedAt: new Date() }
		});

		log.step('status_updated', `${rec.execution_id} -> ${execStatus} | ${rec.action_queue_id} -> ${queueStatus}`, 'Statuses synced.');
	}
}

function prepareExecutionOutput(
	finalRecords: ExecutionRecord[],
	blockedAuditOnly: any[],
	approvalPackageId: string | null,
	eventId: string,
	decisionId: string,
	companyId: string | null,
	log: ExecutionLog,
	snapshotId: string | null,
	routingSummaryId: string | null
) {
	const outputPackageId = shortId('exec_out');

	const output = {
		section: 'Section 5: Execution',
		section_5_status: 'completed',
		execution_output_package_id: outputPackageId,
		execution_intake_id: 'exec_intake_5000',
		execution_rules_snapshot_id: snapshotId,
		routing_summary_id: routingSummaryId,
		source_event_id: eventId,
		source_orchestrator_decision_id: decisionId,
		company_id: companyId,
		execution_records: finalRecords,
		blocked_audit_only: blockedAuditOnly,
		approval_package_id: approvalPackageId,
		boundary_flags: {
			execution_records_created: true,
			automatic_internal_action_completed: true,
			approval_required_output_prepared: true,
			public_reply_posted: false,
			outcome_recorded: false,
			feedback_recorded: false
		},
		handoff_status: 'ready_for_outcome',
		next_section: 'Section 6: Outcome',
		section_stop_reason: 'Section 5 stops before Outcome recording begins.'
	};

	log.step('exec_out_built', `exec_out package built: ${outputPackageId}. handoff_status = ready_for_outcome.`, 'Execution output prepared.');
	return output;
}

function stopBeforeOutcome(execOutPackage: any, finalRecords: ExecutionRecord[], blockedAuditOnly: any[], approvalPackageId: string | null) {
	return {
		executed: true,
		execution_records: finalRecords,
		blocked_audit_only: blockedAuditOnly,
		approval_package_id: approvalPackageId,
		handoff_status: 'ready_for_outcome',
		pipeline_status: 'execution_ready',
		stop_reason: null,
		execution_output_package: execOutPackage
	} as ExecutionResult;
}

export async function runExecution(decisionId: string, eventId: string, companyId: string | null, mockMode: boolean): Promise<ExecutionResult> {
	const log = new ExecutionLog(decisionId);
	log.step('started', `Section 5 started. decision_id=${decisionId}`, 'Execution stage initialized.');

	try {
		const intake = await receiveQueueOutput(decisionId, eventId, log);
		if ((intake as any).error) {
			return {
				executed: false,
				execution_records: [],
				blocked_audit_only: [],
				approval_package_id: null,
				handoff_status: 'failed',
				pipeline_status: 'error',
				stop_reason: (intake as any).error,
				log
			};
		}

		const { queueRecords, blockedAuditOnly, decision, event } = intake as any;
		const queueMap = new Map<string, any>(queueRecords.map((r: any) => [r.id, r]));

		const eligibility = await confirmEligibility(queueRecords, log);
		if ((eligibility as any).error) {
			return {
				executed: false,
				execution_records: [],
				blocked_audit_only: blockedAuditOnly,
				approval_package_id: null,
				handoff_status: 'failed',
				pipeline_status: 'error',
				stop_reason: (eligibility as any).error,
				log
			};
		}

		const { eligible } = eligibility as any;
		const actionIds = eligible.map((r: any) => r.actionId);
		const rules = await loadExecutionRules(companyId || event?.companyId || null, actionIds, log);

		const createdRecords = await createExecutionRecords(eligible, decision, log);
		const routing = routeByExecutionMode(createdRecords, log);
		const autoResults = await executeAutomaticActions(routing.lanes.automatic, queueMap, rules, event, decision, log);
		const approvalResults = await prepareApprovalRequiredOutputs(routing.lanes.approval_required, queueMap, rules, event, mockMode, log);
		const manualResults = await handleManualAssignments(routing.lanes.manual, queueMap, log);
		const observeResults = handleObserveOnly(routing.lanes.observe_only, log);

		const allResults = [...autoResults, ...approvalResults, ...manualResults, ...observeResults];
		const finalRecords = await handleStates(allResults, rules, log);
		await updateStatuses(finalRecords, log);

		const approvalPkg = await prisma.pipelineApprovalPackage.findFirst({
			where: { executionId: { in: finalRecords.map(r => r.execution_row_id) } },
			orderBy: { createdAt: 'desc' }
		});

		const execOut = prepareExecutionOutput(
			finalRecords,
			blockedAuditOnly,
			approvalPkg?.approvalPackageId || null,
			eventId,
			decisionId,
			companyId || event?.companyId || null,
			log,
			rules.snapshot_id,
			routing.routingSummaryId
		);

		const finalResult = stopBeforeOutcome(execOut, finalRecords, blockedAuditOnly, approvalPkg?.approvalPackageId || null);
		finalResult.log = log;
		return finalResult;
	} catch (err: any) {
		log.step('error', `Section 5 fatal error: ${err?.message || err}`, 'Section 5 stopped due to fatal error.');
		return {
			executed: false,
			execution_records: [],
			blocked_audit_only: [],
			approval_package_id: null,
			handoff_status: 'failed',
			pipeline_status: 'error',
			stop_reason: err?.message || String(err),
			log
		};
	}
}
