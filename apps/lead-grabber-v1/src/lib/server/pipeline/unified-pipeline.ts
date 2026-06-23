import { prisma } from '$lib/db';
import { performAiExtraction } from './ai-extraction';
import { SignalEngine } from './signal-engine';
import { OrchestratorEngine } from './orchestrator-engine';
import { ActionQueueEngine } from './action-queue-engine';
import { runExecution } from './execution-engine';
import { runOutcome } from './outcome-engine';
import { runFeedback } from './feedback-engine';
import { resolveAndMergeLocalProfile } from './profile-service';

export interface PipelinePayload {
	provider: string;
	eventType: string;
	externalId: string; // unique ID from provider (review_id, call_id, etc)
	companyId?: string;
	customerPhone?: string;
	customerEmail?: string;
	customerName?: string;
	sessionId?: string; // pixel session
	textContent: string;
	rating?: number;
	occurredAt?: Date;
	metadata?: any;
}

export class UnifiedPipeline {
	static async process(payload: PipelinePayload) {
		const receivedAt = new Date();
		const traceId = `trc_${Math.random().toString(36).substring(2, 9)}`;
		const pipelineSteps: string[] = [];

		const log = (msg: string, data?: any) => {
			const timestamp = new Date().toISOString().replace('T', ' ').replace('Z', '');
			const statusIcon = msg.includes('ERROR') ? '🔴' : (msg.includes('BLOCKED') || msg.includes('SUPPRESSED')) ? '🟡' : '🔵';
			
			let entry = `${statusIcon} [${timestamp}] ${msg}`;
			if (data) {
				const dataStr = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
				entry += `\n   ╰─ Context: ${dataStr.replace(/\n/g, '\n   ')}`;
			}
			
			console.log(entry);
			pipelineSteps.push(entry);
		};

		log(`--- [UNIFIED PIPELINE START] Provider: ${payload.provider} | Trace: ${traceId} ---`);

		try {
			// STEP 1: Identification & Mapping
			log(`[Step 1] Data received from ${payload.provider} for "${payload.customerName || 'Anonymous'}"`);
			
			// STEP 2: Business Resolution
			let company = null;
			if (payload.companyId) {
				company = await prisma.company.findUnique({ where: { id: payload.companyId } });
			} 
			
			if (!company) {
				company = await prisma.company.findFirst();
				if (company) {
					log(`[Step 3] Identification: Using fallback company: ${company.name} (${company.id})`);
				} else {
					log(`[Step 3] Identification: WARNING - No companies found in database!`);
				}
			}
			
			if (!company) {
				log(`[Step 2] Company resolution ERROR: Could not find any company`);
				return { success: false, error: 'company_not_found', trace: pipelineSteps.join('\n') };
			}
			log(`[Step 2] Company resolved: ${company.name} (${company.id})`);

			// STEP 3: Identity Resolution (Progressive Profile Binding)
			let customerProfile = null;
			const hasIdentity = !!(payload.customerPhone || payload.customerEmail || payload.customerName || payload.sessionId);

			if (hasIdentity && company) {
				log(`[Step 3] Identity Resolution: Resolving profile...`);
				customerProfile = await prisma.$transaction(async (tx: any) => {
					return await resolveAndMergeLocalProfile(tx, {
						companyId: company.id,
						email: payload.customerEmail,
						phone: payload.customerPhone,
						name: payload.customerName,
						sessionId: payload.sessionId
					});
				});
				log(`[Step 3] Identity Resolution Complete: profile ID ${customerProfile.id}`);
			} else {
				log(`[Step 3] Identity Resolution: SKIPPED (no phone, email, name, or session provided)`);
			}

			// STEP 4: Duplicate / Suppression Logic (Identity-Based & Content-Based)
			let isDuplicate = false;
			let isSuppressed = false;
			let suppressionReason = '';
			let similarityScore = 0;

			const isSimulation = payload.metadata?.is_simulation === true;
			const providerEventId = payload.externalId;
			const existingEvent = !isSimulation ? await prisma.pipelineEvent.findUnique({ where: { providerEventId } }) : null;
			
			if (existingEvent) {
				log(`[Step 4] Suppression: BLOCKED - Duplicate Provider Event ID ${providerEventId}`);
				isDuplicate = true;
				suppressionReason = 'duplicate_provider_id';
			}

			if (!isDuplicate && customerProfile) {
				// Content-based Duplicacy Check (window: 24 hours for similar content)
				if (payload.textContent && payload.textContent.length > 3) {
					const contentWindow = new Date(Date.now() - 24 * 60 * 60 * 1000);
					const recentEventsFromProfile = await prisma.pipelineEvent.findMany({
						where: {
							customerProfileId: customerProfile.id,
							createdAt: { gte: contentWindow },
							unstructuredText: { not: null }
						},
						orderBy: { createdAt: 'desc' },
						take: 10
					});

					const cleanNewContent = UnifiedPipeline.extractCoreContent(payload.textContent);

					for (const pastEvent of recentEventsFromProfile) {
						const pastText = pastEvent.unstructuredText || '';
						const cleanPastContent = UnifiedPipeline.extractCoreContent(pastText);
						
						const similarity = UnifiedPipeline.calculateSimilarity(cleanNewContent, cleanPastContent);
						
						if (similarity > 0.85) {
							log(`[Step 4] Suppression: BLOCKED - Duplicate content detected (${Math.round(similarity * 100)}% similarity) with event ${pastEvent.eventId}`);
							isDuplicate = true;
							similarityScore = similarity;
							suppressionReason = 'duplicate_content';
							break;
						}
					}
				}
			}

			if (!isDuplicate && !isSuppressed) {
				log(`[Step 4] Suppression: CLEAN - No previous record or similar content found`);
			}

			// STEP 5: AI Extraction (SKIP if duplicate)
			let aiResult = null;
			if (!isDuplicate && !isSuppressed) {
				if (payload.textContent && payload.textContent.length > 0) {
					log(`[Step 5] AI Extraction: Identifying sentiment, topics, and intent...`);
					try {
						const extractionInput = payload.rating 
							? `Rating: ${payload.rating} Stars\nContent: ${payload.textContent}`
							: payload.textContent;
						
						log(`[Step 5] AI Extraction: Sending text to AI for analysis...`, extractionInput);
						aiResult = await performAiExtraction(extractionInput);
						log(`[Step 5] AI Extraction Success:`, {
							problem: aiResult.contains_problem,
							quote: aiResult.contains_quote_request,
							callback: aiResult.contains_callback_request,
							emergency: aiResult.contains_emergency_keywords,
							contact: aiResult.requested_contact_method,
							sentiment: aiResult.sentiment,
							summary: aiResult.summary,
							service: aiResult.service_requested,
							confidence: aiResult.confidence_score,
							topics: [...aiResult.praise_topics, ...aiResult.complaint_topics]
						});
					} catch (err: any) {
						log(`[Step 5] AI extraction ERROR: ${err.message || err}`);
					}
				} else {
					log(`[Step 5] AI Extraction: SKIPPED (No content)`);
				}
			} else {
				log(`[Step 5] AI Extraction: SKIPPED (Event is duplicate/suppressed)`);
			}

			// STEP 6: Persistence
			log(`[Step 6] Storage: Saving event and marking as "Handoff Eligible"`);
			const eventInternalId = crypto.randomUUID();
			
			const event = await prisma.$transaction(async (tx: any) => {
				const evt = await tx.pipelineEvent.create({
					data: {
						id: eventInternalId,
						eventId: `evt_${Math.floor(Math.random() * 90000) + 10000}`,
						traceId: traceId,
						provider: payload.provider,
						providerEventName: payload.eventType,
						providerEventId: suppressionReason === 'duplicate_provider_id' ? `${payload.externalId}_dup_${Date.now()}` : payload.externalId,
						eventType: payload.eventType,
						networkCategory: payload.provider.includes('telnyx') ? 'Communication' : 'Trust',
						companyId: company?.id,
						customerProfileId: customerProfile?.id,
						authorName: payload.customerName || customerProfile?.displayName || null,
						reviewRatingNumeric: payload.rating || null,
						reviewText: payload.textContent,
						occurredAt: payload.occurredAt || receivedAt,
						receivedAt: receivedAt,
						unstructuredText: payload.metadata ? JSON.stringify(payload.metadata) : payload.textContent,
						requiresAiExtraction: !!aiResult,
						aiExtractionCompleted: !!aiResult,
						isDuplicate: isDuplicate,
						processingStatus: isDuplicate ? 'duplicate_blocked' : (isSuppressed ? 'identity_suppressed' : 'handoff_eligible'),
						handoffEligible: !isDuplicate && !isSuppressed
					}
				});

				if (aiResult) {
					await tx.pipelineEnrichment.create({
						data: {
							id: crypto.randomUUID(),
							eventId: eventInternalId,
							aiSentiment: aiResult.sentiment,
							aiSentimentScore: aiResult.confidence_score,
							aiPraiseDetected: aiResult.praise_topics.length > 0,
							aiComplaintDetected: aiResult.complaint_topics.length > 0,
							aiPraiseTopics: aiResult.praise_topics,
							aiComplaintTopics: aiResult.complaint_topics,
							aiPrimaryPraiseTopic: aiResult.praise_topics[0] || null,
							aiPrimaryComplaintTopic: aiResult.complaint_topics[0] || null,
							aiServiceMentioned: aiResult.service_requested,
							aiCustomerExperienceIssue: aiResult.contains_problem ? 'problem_detected' : null,
							aiUrgencyLevel: aiResult.urgency_level,
							aiSummary: aiResult.summary,
							aiConfidenceScore: aiResult.confidence_score,
							aiCustomerName: aiResult.customer_name,
							aiHasName: aiResult.has_name,

							// New Deterministic Facts
							aiContainsProblem: aiResult.contains_problem,
							aiContainsQuoteRequest: aiResult.contains_quote_request,
							aiContainsCallbackRequest: aiResult.contains_callback_request,
							aiContainsEmergencyKeywords: aiResult.contains_emergency_keywords,
							aiRequestedContactMethod: aiResult.requested_contact_method,
							aiRequestedAction: aiResult.requested_action,
							aiDetectedKeywords: aiResult.detected_keywords,

							sentiment: aiResult.sentiment,
							summary: aiResult.summary,
							urgencyLevel: aiResult.urgency_level,
							serviceRequested: aiResult.service_requested,
							confidenceScore: aiResult.confidence_score
						}
					});
				}
				return evt;
			});

			// STEP 7-16: Downstream Processing
			let finalTrace = pipelineSteps.join('\n');
			let evalResult: any = null;
			let decisionResult: any = null;
			let executionResult: any = null;
			let outcomeResult: any = null;
			let feedbackResult: any = null;
			let signalCandidates: any[] = [];

			if (!isDuplicate && !isSuppressed) {
				// STEP 7-9: Signal Engine
				evalResult = await SignalEngine.evaluate(event.id, pipelineSteps);
				const fullTrace = [...evalResult.trace];

				// STEP 10-12: Orchestrator Decision
				signalCandidates = await prisma.pipelineSignal.findMany({
					where: { eventId: event.id, status: 'candidate' }
				});
				
				decisionResult = await OrchestratorEngine.makeDecision(event.id, signalCandidates, evalResult.trace);
				
				if (decisionResult?.log?.steps?.length) {
					decisionResult.log.steps.forEach((s: any) => {
						const timestamp = s.timestamp;
						const statusIcon = s.status.includes('error') ? '🔴' : (s.status.includes('blocked') || s.status.includes('warning')) ? '🟡' : '🔵';
						fullTrace.push(`${statusIcon} [${timestamp}] Section 3 - ${s.status.toUpperCase()} : ${s.message}`);
					});
				}

				// STEP 13-16: Execution & Outcome
				if (decisionResult.decided && decisionResult.decision_id) {
					log(`[Step 13] Action Queue: Parameterizing work orders...`);
					const queueResult = await ActionQueueEngine.processToQueue(decisionResult.decision_id);
					
					queueResult.log.steps.forEach((s: any) => {
						const timestamp = s.timestamp;
						const statusIcon = s.status.includes('error') ? '🔴' : (s.status.includes('blocked') || s.status.includes('warning')) ? '🟡' : '🔵';
						fullTrace.push(`${statusIcon} [${timestamp}] Section 4 - ${s.status.toUpperCase()} : ${s.message}`);
					});

					log(`[Step 14] Execution: Running execution module...`);
					const mockMode = String(process.env.AI_MOCK_MODE || '').toLowerCase() === 'true';
					executionResult = await runExecution(
						decisionResult.decision_id,
						event.id,
						event.companyId,
						mockMode
					);

					if (executionResult?.log?.steps?.length) {
						executionResult.log.steps.forEach((s: any) => {
							const timestamp = s.timestamp;
							const statusIcon = s.status.includes('error') ? '🔴' : (s.status.includes('blocked') || s.status.includes('warning')) ? '🟡' : '🔵';
							fullTrace.push(`${statusIcon} [${timestamp}] Section 5 - ${s.status.toUpperCase()} : ${s.message}`);
						});
					}

					// Handoff to Outcome
					if (executionResult?.executed && executionResult?.handoff_status === 'ready_for_outcome') {
						outcomeResult = await runOutcome(
							executionResult.execution_output_package,
							event.id,
							decisionResult.decision_id,
							event.companyId
						);

						if (outcomeResult?.log?.steps?.length) {
							outcomeResult.log.steps.forEach((s: any) => {
								const timestamp = s.timestamp;
								const statusIcon = s.status.includes('fail') ? '🔴' : s.status.includes('warn') ? '🟡' : '🔵';
								fullTrace.push(`${statusIcon} [${timestamp}] Section 6 - ${s.status.toUpperCase()} : ${s.message}`);
							});
						}

						if (outcomeResult.completed) {
							feedbackResult = await runFeedback(
								outcomeResult.out_pkg,
								event.id,
								decisionResult.decision_id,
								event.companyId
							);

							if (feedbackResult?.log?.steps?.length) {
								feedbackResult.log.steps.forEach((s: any) => {
									const timestamp = s.timestamp;
									const statusIcon = s.status.includes('fail') ? '🔴' : s.status.includes('warn') ? '🟡' : '🔵';
									fullTrace.push(`${statusIcon} [${timestamp}] Section 7 - ${s.status.toUpperCase()} : ${s.message}`);
								});
							}
						}
					}
				}

				log(`--- [UNIFIED PIPELINE END] Trace: ${traceId} ---`);
				finalTrace = fullTrace.join('\n');
			} else {
				log(`[Step 7-16] Downstream Engine: SKIPPED (Event marked as duplicate or suppressed)`);
				log(`--- [UNIFIED PIPELINE END] Trace: ${traceId} ---`);
				finalTrace = pipelineSteps.join('\n');
			}

			// Persist logs to Event for historical replay
			try {
				await prisma.pipelineEvent.update({
					where: { id: eventInternalId },
					data: {
						unstructuredText: (payload.metadata ? JSON.stringify(payload.metadata) : payload.textContent) + '\n\n--- PIPELINE LOGS ---\n' + finalTrace
					}
				});
			} catch (e) {
				console.error('Failed to save pipeline logs to Event', e);
			}

			// Log to Svelte ProfileDB Telemetry Endpoint
			if (company && !isDuplicate && !isSuppressed) {
				try {
					let fingerprintId = payload.sessionId || `unified_${payload.externalId}`;
					let scoreDelta = 5;
					if (aiResult?.urgency_level === 'high' || aiResult?.contains_emergency_keywords === true) {
						scoreDelta = 15;
					} else if (payload.eventType.includes('voicemail') || payload.eventType.includes('call')) {
						scoreDelta = 15;
					} else if (payload.eventType.includes('sms')) {
						scoreDelta = 10;
					} else if (payload.eventType.includes('email')) {
						scoreDelta = 8;
					}

					const profiledbUrl = process.env.PROFILEDB_URL || 'http://localhost:6277';
					const res = await fetch(`${profiledbUrl}/api/v1/telemetry/events`, {
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
							'Authorization': 'Bearer clearsky_pixel_api_key'
						},
						body: JSON.stringify({
							tenantSlug: company?.id || payload.companyId || 'clearsky-demo',
							fingerprintId,
							eventType: payload.eventType,
							pageUrl: null,
							scoreDelta: scoreDelta,
							phone: payload.customerPhone || null,
							name: payload.customerName || (customerProfile?.displayName) || null,
							payload: {
								externalId: payload.externalId,
								provider: payload.provider,
								textContent: payload.textContent,
								rating: payload.rating,
								metadata: payload.metadata,
								pipeline_logs: finalTrace,
								signals: signalCandidates,
								enrichments: aiResult ? [aiResult] : [],
								decision: decisionResult?.decision_record || null,
								execution: executionResult?.execution_records || [],
								outcome: outcomeResult?.outcome_records || [],
								feedback: feedbackResult?.feedback_records || [],
								ai_protocol: aiResult?._protocol || null
							}
						})
					});

					if (res.ok) {
						log(`[CDP] Logged event to ProfileDB successfully.`);
					} else {
						console.error('[CDP] ProfileDB return error:', res.statusText);
					}
				} catch (cdpErr) {
					console.error('Failed to log event to ProfileDB:', cdpErr);
				}
			}

			if (isDuplicate || isSuppressed) {
				return { 
					success: true, 
					event_id: event.eventId, 
					is_duplicate: isDuplicate,
					is_suppressed: isSuppressed,
					processing_status: isDuplicate ? 'duplicate_blocked' : 'identity_suppressed',
					trace: finalTrace 
				};
			}

			// Map back to format expected by consumers (like demohtml and webhook)
			const mockDecisionOutput = {
				dominant_signal: decisionResult?.dominant_signal?.name || null,
				decision_id: decisionResult?.decision_id || null,
				execution_mode: decisionResult?.execution_mode || 'approval_required',
				action_queue: decisionResult?.selected_actions || [],
				trace: finalTrace
			};

			return { 
				success: true, 
				event_id: event.eventId, 
				decision_id: decisionResult?.decision_id || null,
				ai_protocol: aiResult?._protocol || null,
				execution: executionResult,
				outcome: outcomeResult,
				feedback: feedbackResult,
				decision: mockDecisionOutput,
				evaluation: evalResult,
				trace: finalTrace 
			};
		} catch (err: any) {
			log(`[Unified Pipeline Error] ${err.message || err}`);
			return { success: false, error: 'Internal processing error', trace: pipelineSteps.join('\n') };
		}
	}

	private static extractCoreContent(text: string): string {
		if (!text) return '';
		let cleanText = text;
		if (text.includes('--- PIPELINE LOGS ---')) {
			cleanText = text.split('--- PIPELINE LOGS ---')[0].trim();
		}
		if (cleanText.includes('Transcription:')) {
			const parts = cleanText.split('Transcription:');
			cleanText = parts[parts.length - 1];
		}
		return cleanText.trim();
	}

	private static calculateSimilarity(s1: string, s2: string): number {
		if (!s1 || !s2) return 0;
		const prepare = (s: string) => s.toLowerCase()
			.replace(/[^\w\s]/g, '')
			.split(/\s+/)
			.filter(v => v.length >= 2);
		
		const w1 = prepare(s1);
		const w2 = prepare(s2);
		
		if (w1.length === 0 || w2.length === 0) {
			return s1.trim().toLowerCase() === s2.trim().toLowerCase() ? 1.0 : 0;
		}

		const set2 = new Set(w2);
		const intersect = w1.filter(w => set2.has(w));
		return (intersect.length * 2) / (w1.length + w2.length);
	}
}
