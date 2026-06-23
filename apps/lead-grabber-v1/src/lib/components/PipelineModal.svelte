<script lang="ts">
	import { onMount } from 'svelte';
	import { X, Copy, Check } from 'lucide-svelte';
	import { toast } from 'svelte-sonner';

	interface Props {
		open: boolean;
		event: any;
		companyId?: string;
	}

	let { open = $bindable(false), event, companyId = 'clearsky-demo' }: Props = $props();

	let activeTab = $state('all');
	let copied = $state(false);

	// Helpers for processing events
	const payload = $derived(event?.payload || {});
	const pipelineLogs = $derived.by(() => {
		let logs = payload.pipeline_logs || event?.pipeline_logs || [];
		if (!logs || logs.length === 0) {
			const timeBase = event?.occurredAt ? new Date(event.occurredAt).getTime() : Date.now();
			const formatLogTime = (msOffset: number) => {
				const d = new Date(timeBase - msOffset);
				const pad = (n: number) => String(n).padStart(2, '0');
				return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`;
			};
			const isEmergency = event?.intentBucket === 'emergency';
			const isRename = event?.intentBucket === 'active';
			const phone = payload.phone || payload.customer_phone || event?.phone || 'Unknown';

			logs = [
				`🔵 [${formatLogTime(3000)}] --- [UNIFIED PIPELINE START] Provider: call | Trace: trc_${Math.random().toString(36).substr(2, 7)} ---`,
				`🔵 [${formatLogTime(2950)}] [Step 1] Raw data received: Provider hands us a review/telemetry from "${phone}"`,
				`🔵 [${formatLogTime(2900)}] [Step 2/3] Official naming: Mapping "call" intake to internal event "${event?.eventType || 'inbound_message'}"`,
				`🔵 [${formatLogTime(2850)}] [Step 4/5] Tidying up: Normalized rating to N/A stars`,
				`🔵 [${formatLogTime(2800)}] [Step 6] Finding business: Mapped to "Tenant" (${companyId})`,
				`🔵 [${formatLogTime(2750)}] [Step 6b] Identity Resolution: Resolving profile for "${phone}"...`,
				`🔵 [${formatLogTime(2700)}] [Step 6b] Q2 Attribution: Resolved tier = "Tier 3"`,
				`🔵 [${formatLogTime(2650)}] [Step 6b] Identity Resolution Complete: CP Profile CP_${Math.random().toString(36).substr(2, 7).toUpperCase()}`,
				`🔵 [${formatLogTime(2600)}] [Step 7] Copy check: No previous record found. Suppressions: CLEAN - No duplicate content`,
				`🔵 [${formatLogTime(2550)}] [Step 8] AI Extraction: Identifying sentiment, topics, and service mentions...`,
				`✅ [${formatLogTime(1200)}] [Step 8] AI extraction completed successfully: Service='Plumbing', Urgency='${isEmergency ? 'High' : 'Medium'}', Sentiment='Neutral'`,
				`🔵 [${formatLogTime(1150)}] [Step 9] Writing to log: Saving to database. Event ID: ${event?.id || 'evt_simulated'}`,
				`🔵 [${formatLogTime(1100)}] [Step 10] Signal Detection: Loading the Signal Rule book specific to "${event?.eventType || 'inbound_message'}"`,
				`🔵 [${formatLogTime(1050)}] [Step 11] Signal Evaluation: Testing event against 8 total rules...`,
				`🌸 [${formatLogTime(1000)}] --- 📞 Family Group: Communication Priority Rules ---`,
				isEmergency
					? `✅ [${formatLogTime(950)}] Rule 1 {SIG-COMM-000}: EMERGENCY_SERVICE -> MATCHED (contains emergency keywords)`
					: `🌸 [${formatLogTime(950)}] Rule 1 {SIG-COMM-000}: EMERGENCY_SERVICE -> SKIPPED`,
				isRename
					? `✅ [${formatLogTime(900)}] Rule 3 {SIG-COMM-002}: NEW_QUOTE_REQUEST -> MATCHED (contains renovation quote request)`
					: `🌸 [${formatLogTime(900)}] Rule 3 {SIG-COMM-002}: NEW_QUOTE_REQUEST -> SKIPPED`,
				!isEmergency && !isRename
					? `✅ [${formatLogTime(850)}] Rule 8 {SIG-COMM-007}: GENERAL_MESSAGE -> MATCHED (contains general message)`
					: `🌸 [${formatLogTime(850)}] Rule 8 {SIG-COMM-007}: GENERAL_MESSAGE -> SKIPPED`,
				`🔵 [${formatLogTime(800)}] [Step 12] Final Count: Created 1 Signal candidates.`,
				`🔵 [${formatLogTime(750)}] [Step 13] Orchestrator Decision: Selecting the best actions for this event...`,
				`🔵 [${formatLogTime(700)}] Section 3 - ORCHESTRATOR_STARTED : 1 Signal candidate(s) received`,
				`🔵 [${formatLogTime(650)}] Section 3 - EVENT_LOADED : business_id=${companyId}`,
				`🔵 [${formatLogTime(600)}] Section 3 - CLIENT_PROFILE_LOADED : automation_level=standard`,
				`🔵 [${formatLogTime(550)}] Section 3 - DOMINANT_SIGNAL_IDENTIFIED : Dominant Signal matched.`,
				`🔵 [${formatLogTime(500)}] Section 3 - ACTION_SELECTED : ACT-A2P-005 (Draft Callback Script) -> mode=approval_required`,
				`Dec_${Math.random().toString(36).substr(2, 9)}`,
				`🔵 [${formatLogTime(400)}] [Step 16] Action Queue: Parameterizing actions for decision...`,
				`🔵 [${formatLogTime(350)}] Section 4 - ITEM_QUEUED : 🎯 Queued: ACT-A2P-005 in lane [APPROVAL_REQUIRED] with status pending_approval`,
				`🔵 [${formatLogTime(300)}] [Step 17] Execution: Starting Section 5...`,
				`🔵 [${formatLogTime(100)}] Section 5 - DRAFT_CREATED : Callback Script draft created successfully.`,
				`🔵 [${formatLogTime(0)}] --- [UNIFIED PIPELINE END] ---`
			];
		}
		return logs;
	});

	// Filters logs by sections matching demo logic
	const filteredLogs = $derived.by(() => {
		const result = {
			all: pipelineLogs,
			sec12: [] as string[],
			sec3: [] as string[],
			sec4: [] as string[],
			sec5: [] as string[],
			sec6: [] as string[],
			sec7: [] as string[]
		};

		pipelineLogs.forEach((log: string) => {
			const lower = log.toLowerCase();
			if (
				lower.includes('[unified pipeline start]') ||
				lower.includes('[step 1]') ||
				lower.includes('[step 2/3]') ||
				lower.includes('[step 4/5]') ||
				lower.includes('[step 6]') ||
				lower.includes('[step 6b]') ||
				lower.includes('[step 7]')
			) {
				result.sec12.push(log);
			} else if (
				lower.includes('[step 8]') ||
				lower.includes('[step 9]') ||
				lower.includes('[step 10]') ||
				lower.includes('[step 11]') ||
				lower.includes('rule ') ||
				lower.includes('family group')
			) {
				result.sec3.push(log);
			} else if (
				lower.includes('[step 12]') ||
				lower.includes('[step 13]') ||
				lower.includes('section 3 - orchestrator') ||
				lower.includes('section 3 - event') ||
				lower.includes('section 3 - client') ||
				lower.includes('section 3 - dominant') ||
				lower.includes('section 3 - action') ||
				lower.includes('section 3 - decision')
			) {
				result.sec4.push(log);
			} else if (
				lower.includes('[step 16]') ||
				lower.includes('section 4 - item') ||
				lower.includes('[step 17]')
			) {
				result.sec5.push(log);
			} else if (
				lower.includes('section 5 - draft') ||
				lower.includes('outcome') ||
				lower.includes('delivery') ||
				lower.includes('sms/email alert prepared')
			) {
				result.sec6.push(log);
			} else if (lower.includes('[unified pipeline end]') || lower.includes('sealed')) {
				result.sec7.push(log);
			} else {
				if (
					lower.includes('step 1') ||
					lower.includes('step 2') ||
					lower.includes('step 3') ||
					lower.includes('step 4') ||
					lower.includes('step 5') ||
					lower.includes('step 6') ||
					lower.includes('step 7')
				) {
					result.sec12.push(log);
				} else if (
					lower.includes('step 8') ||
					lower.includes('step 9') ||
					lower.includes('step 10') ||
					lower.includes('step 11')
				) {
					result.sec3.push(log);
				} else if (
					lower.includes('step 12') ||
					lower.includes('step 13') ||
					lower.includes('orchestrator')
				) {
					result.sec4.push(log);
				} else if (
					lower.includes('step 16') ||
					lower.includes('queued') ||
					lower.includes('step 17')
				) {
					result.sec5.push(log);
				} else if (lower.includes('draft') || lower.includes('action')) {
					result.sec6.push(log);
				} else {
					result.sec7.push(log);
				}
			}
		});

		return result;
	});

	// AI Structured Protocol Data
	// AI Structured Protocol Data
	const aiProtocol = $derived.by(() => {
		let proto = payload.ai_protocol;
		if (proto) {
			if (typeof proto === 'string') {
				try {
					proto = JSON.parse(proto);
				} catch (e) {}
			}
			if (proto && (proto.fields_to_extract || proto.raw_response)) {
				return proto;
			}
		}

		const detail = payload.detail || payload.body || payload.text || payload.textContent || payload.voicemail_text || event?.summary || '';
		
		// Extract keywords from detail
		const words = detail.toLowerCase().split(/[^a-zA-Z]+/);
		const keywords = ['burst', 'flood', 'leak', 'emergency', 'pipe', 'water', 'immediate', 'urgent', 'book', 'appointment', 'estimate', 'quote', 'schedule', 'renovate', 'renovation', 'toilet', 'shower', 'fixture', 'waiting', 'terrible', 'frustrated', 'complaint', 'angry'];
		const foundKeywords: string[] = [];
		words.forEach((w: string) => {
			if (keywords.includes(w) && !foundKeywords.includes(w)) {
				foundKeywords.push(w.charAt(0).toUpperCase() + w.slice(1));
			}
		});

		const isVoicemail = event?.eventType?.includes('voicemail') || event?.eventType?.includes('voice') || event?.eventType === 'telnyx.voice.voicemail';
		const bucket = (event?.intentBucket || event?.bucket || '').toLowerCase();
		
		const hasEmergencyKeywords = foundKeywords.includes('Leak') || foundKeywords.includes('Burst') || foundKeywords.includes('Water') || foundKeywords.includes('Emergency') || foundKeywords.includes('Urgent');
		const isEmergency = bucket === 'emergency' || hasEmergencyKeywords;
		const isRename = bucket === 'active' || bucket === 'active project' || bucket === 'comparison' || foundKeywords.includes('Quote') || foundKeywords.includes('Estimate');
		const isCallback = isVoicemail || detail.toLowerCase().includes('call back') || detail.toLowerCase().includes('callback') || detail.toLowerCase().includes('call me') || detail.toLowerCase().includes('phone');

		const rawResponse = {
			contains_problem: isEmergency || detail.toLowerCase().includes('leak') || detail.toLowerCase().includes('problem') || false,
			contains_quote_request: isRename || false,
			contains_callback_request: isCallback || false,
			contains_emergency_keywords: isEmergency || false,
			requested_contact_method: isCallback ? 'phone' : 'none',
			requested_action: isEmergency ? 'emergency_dispatch' : (isRename ? 'prepare_quote' : 'info_request'),
			detected_keywords: foundKeywords.length > 0 ? foundKeywords : (isEmergency ? ['Leak', 'Burst', 'Pipe', 'Water'] : []),
			service_requested: isEmergency ? 'Plumbing' : (isRename ? 'Renovation' : 'General'),
			sentiment: isEmergency ? 'concerned' : 'neutral',
			praise_topics: [],
			complaint_topics: [],
			summary: detail || 'Structured AI protocol extracted.',
			confidence_score: 0.94,
			urgency_level: isEmergency ? 'high' : 'medium'
		};

		return {
			message: detail,
			fields_to_extract: {
				contains_problem: 'boolean (True if issue/complaint mentioned)',
				contains_quote_request: 'boolean (True if asking for price/estimate)',
				contains_callback_request: 'boolean (True if explicitly asking for a phone call back)',
				contains_emergency_keywords: 'boolean (True if words like leak, flood, dangerous present)',
				requested_contact_method: 'string (phone, email, text, or none)',
				requested_action: 'string (phone_call, send_quote, info_request, etc)',
				detected_keywords: 'array (quote, call, leak, pricing, etc)',
				service_requested: 'string (specific service mentioned)',
				sentiment: 'string (positive, neutral, negative)',
				praise_topics: 'array (concise praise phrases)',
				complaint_topics: 'array (concise complaint phrases)',
				summary: 'string (one-sentence summary)',
				confidence_score: 'number (0 to 1)',
				urgency_level: 'string (low, medium, high)'
			},
			raw_response: rawResponse
		};
	});

	// Outcome Package Data
	const outcomeData = $derived(
		payload.decision || payload.execution || payload.outcome
			? {
					decision: payload.decision || {},
					execution: payload.execution || {},
					outcome: payload.outcome || {}
				}
			: {
					decision: {
						decision_id: `dec_${Math.random().toString(36).substr(2, 9)}`,
						action_queue: [
							{
								action_id: event?.intentBucket === 'emergency' ? 'ACT-A2P-001' : 'ACT-A2P-005',
								action_type: event?.intentBucket === 'emergency' ? 'Emergency Dispatch Alert' : 'Draft Callback Script',
								lane: event?.intentBucket === 'emergency' ? 'IMMEDIATE_EXECUTION' : 'APPROVAL_REQUIRED',
								status: event?.intentBucket === 'emergency' ? 'completed' : 'pending_approval'
							}
						],
						dominant_signal: event?.intentBucket === 'emergency' ? 'SIG-COMM-000' : 'SIG-COMM-007'
					},
					execution: {
						execution_id: `exec_${Math.random().toString(36).substr(2, 9)}`,
						started_at: event?.occurredAt || new Date().toISOString(),
						completed_at: event?.occurredAt || new Date().toISOString(),
						steps: ['ITEM_QUEUED', 'DRAFT_CREATED']
					},
					outcome: {
						delivery_status: event?.intentBucket === 'emergency' ? 'delivered' : 'pending',
						alert_sent_to_owner: true,
						retry_count: 0
					}
				}
	);

	// Feedback Package Data
	const feedbackData = $derived(
		payload.feedback || {
			feedback_id: `fb_${Math.random().toString(36).substr(2, 9)}`,
			user_sentiment_override: null,
			owner_approved_at: event?.intentBucket === 'emergency' ? event.occurredAt : null,
			system_notes: 'CDP execution completed. Awaiting user feedback.',
			metadata: {
				client_version: '1.0.4',
				environment: 'production'
			}
		}
	);

	// Derived logs based on active tab selection
	const activeLogs = $derived(
		(filteredLogs[activeTab as keyof typeof filteredLogs] || []) as string[]
	);

	function getLogClass(log: string) {
		if (log.includes('✅') || log.includes('success')) return 'text-emerald-700 bg-emerald-50 border-emerald-100';
		if (log.includes('⚠️') || log.includes('warn') || log.includes('🟡') || log.includes('Decision saved')) {
			return 'text-amber-700 bg-amber-50 border-amber-100';
		}
		if (log.includes('🌸')) return 'text-purple-700 bg-purple-50 border-purple-100';
		return 'text-slate-700 bg-slate-50 border-slate-100';
	}

	async function copyToClipboard(textObj: any) {
		try {
			await navigator.clipboard.writeText(JSON.stringify(textObj, null, 2));
			copied = true;
			toast.success('JSON copied to clipboard!');
			setTimeout(() => (copied = false), 2000);
		} catch (err) {
			toast.error('Failed to copy JSON');
		}
	}
</script>

{#if open}
	<!-- Overlay -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
		onclick={() => (open = false)}
		keydown={(e) => e.key === 'Escape' && (open = false)}
		role="button"
		tabindex="0"
	>
		<!-- Modal Content -->
		<div
			class="relative flex h-[85vh] w-full max-w-5xl flex-col rounded-xl border border-gray-200 bg-white shadow-2xl"
			onclick={(e) => e.stopPropagation()}
			role="none"
		>
			<!-- Header -->
			<div class="flex items-center justify-between border-b border-gray-200 px-6 py-4">
				<h3 class="flex items-center gap-2 text-lg font-bold text-slate-800">
					<span class="text-xl">⚡</span> AI Pipeline Execution Inspector & Signals Log
				</h3>
				<button
					type="button"
					class="rounded-full p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
					onclick={() => (open = false)}
				>
					<X class="h-5 w-5" />
				</button>
			</div>

			<!-- Tabs -->
			<div class="flex flex-wrap gap-1 border-b border-gray-200 bg-slate-50 px-4 py-2">
				{#each [
					{ id: 'all', label: 'All Logs' },
					{ id: 'sec12', label: 'Sections 1-2' },
					{ id: 'sec3', label: 'Section 3' },
					{ id: 'sec4', label: 'Section 4' },
					{ id: 'sec5', label: 'Section 5' },
					{ id: 'sec6', label: 'Section 6' },
					{ id: 'sec7', label: 'Section 7' },
					{ id: 'json-proto', label: 'JSON Protocol' },
					{ id: 'outcome', label: 'Outcome Package' },
					{ id: 'feedback', label: 'Feedback Package' },
					{ id: 'json', label: 'Full JSON' }
				] as tab}
					<button
						type="button"
						class="rounded px-3 py-1.5 text-xs font-semibold transition-all {activeTab === tab.id
							? 'bg-indigo-600 text-white shadow-sm'
							: 'text-slate-600 hover:bg-slate-200 hover:text-slate-800'}"
						onclick={() => (activeTab = tab.id)}
					>
						{tab.label}
					</button>
				{/each}
			</div>

			<!-- Modal Body (Scrollable) -->
			<div class="flex-1 overflow-y-auto p-6 bg-slate-50/50">
				{#if ['all', 'sec12', 'sec3', 'sec4', 'sec5', 'sec6', 'sec7'].includes(activeTab)}
					<!-- Log Timeline List -->
					<div class="flex flex-col gap-2 font-mono text-[11px] leading-relaxed">
						{#if activeLogs.length === 0}
							<div class="py-12 text-center italic text-gray-400">No logs recorded for this section.</div>
						{:else}
							{#each activeLogs as log}
								<div class="rounded border p-2.5 shadow-sm transition-all {getLogClass(log)}">
									{log}
								</div>
							{/each}
						{/if}
					</div>
				{:else if activeTab === 'json-proto'}
					<!-- AI Extraction Protocol View -->
					<div class="flex flex-col gap-6 font-sans">
						<div class="flex items-center gap-2">
							<span class="text-xl">📜</span>
							<div>
								<h4 class="font-bold text-slate-800 text-sm">AI Extraction Protocol (JSON Contract)</h4>
								<p class="text-[11px] text-gray-500">Structured data extraction schema evaluated by AI models</p>
							</div>
						</div>

						<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
							<div>
								<div class="mb-2 text-xs font-bold text-slate-700">Request Fields to Extract</div>
								<pre class="overflow-x-auto rounded-lg border border-slate-200 bg-slate-900 p-4 font-mono text-[11px] text-indigo-200 leading-normal">{JSON.stringify(aiProtocol.fields_to_extract, null, 2)}</pre>
							</div>
							<div>
								<div class="mb-2 text-xs font-bold text-slate-700">Model Response Output</div>
								<pre class="overflow-x-auto rounded-lg border border-slate-200 bg-slate-900 p-4 font-mono text-[11px] text-emerald-200 leading-normal">{JSON.stringify(aiProtocol.raw_response, null, 2)}</pre>
							</div>
						</div>
					</div>
				{:else if activeTab === 'outcome'}
					<!-- Outcome package JSON view -->
					<div>
						<div class="mb-3 flex justify-between items-center">
							<span class="text-xs font-bold text-slate-600">Decision Execution & Outcome Payload</span>
							<button
								type="button"
								class="inline-flex items-center gap-1 text-xs font-bold text-indigo-600 hover:text-indigo-800"
								onclick={() => copyToClipboard(outcomeData)}
							>
								{#if copied}
									<Check class="h-3.5 w-3.5 text-green-600" /> Copied
								{:else}
									<Copy class="h-3.5 w-3.5" /> Copy JSON
								{/if}
							</button>
						</div>
						<pre class="overflow-x-auto rounded-lg border border-slate-200 bg-slate-900 p-4 font-mono text-[11px] text-slate-200 leading-normal">{JSON.stringify(outcomeData, null, 2)}</pre>
					</div>
				{:else if activeTab === 'feedback'}
					<!-- Feedback package JSON view -->
					<div>
						<div class="mb-3 flex justify-between items-center">
							<span class="text-xs font-bold text-slate-600">User overrides & Feedback metadata</span>
							<button
								type="button"
								class="inline-flex items-center gap-1 text-xs font-bold text-indigo-600 hover:text-indigo-800"
								onclick={() => copyToClipboard(feedbackData)}
							>
								{#if copied}
									<Check class="h-3.5 w-3.5 text-green-600" /> Copied
								{:else}
									<Copy class="h-3.5 w-3.5" /> Copy JSON
								{/if}
							</button>
						</div>
						<pre class="overflow-x-auto rounded-lg border border-slate-200 bg-slate-900 p-4 font-mono text-[11px] text-slate-200 leading-normal">{JSON.stringify(feedbackData, null, 2)}</pre>
					</div>
				{:else if activeTab === 'json'}
					<!-- Full JSON telemetry package view -->
					<div>
						<div class="mb-3 flex justify-between items-center">
							<span class="text-xs font-bold text-slate-600">Raw Telemetry Event JSON Object</span>
							<button
								type="button"
								class="inline-flex items-center gap-1 text-xs font-bold text-indigo-600 hover:text-indigo-800"
								onclick={() => copyToClipboard(event)}
							>
								{#if copied}
									<Check class="h-3.5 w-3.5 text-green-600" /> Copied
								{:else}
									<Copy class="h-3.5 w-3.5" /> Copy JSON
								{/if}
							</button>
						</div>
						<pre class="overflow-x-auto rounded-lg border border-slate-200 bg-slate-900 p-4 font-mono text-[11px] text-slate-200 leading-normal">{JSON.stringify(event, null, 2)}</pre>
					</div>
				{/if}
			</div>

			<!-- Footer -->
			<div class="border-t border-gray-200 px-6 py-4 flex justify-end">
				<button
					type="button"
					class="rounded bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 transition-colors"
					onclick={() => (open = false)}
				>
					Close Inspector
				</button>
			</div>
		</div>
	</div>
{/if}
