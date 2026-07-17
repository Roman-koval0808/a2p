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

	// Helpers for processing events — REAL data only (no fabricated fallbacks).
	const payload = $derived(event?.payload || {});
	const pipelineLogs = $derived.by(() => {
		const logs = payload.pipeline_logs || event?.pipeline_logs || [];
		return Array.isArray(logs) ? logs : [];
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

	// AI Structured Protocol Data — REAL data only (returns null when not persisted).
	const aiProtocol = $derived.by(() => {
		let proto = payload.ai_protocol;
		if (!proto) return null;
		if (typeof proto === 'string') {
			try {
				proto = JSON.parse(proto);
			} catch (e) {
				return null;
			}
		}
		if (proto && (proto.fields_to_extract || proto.raw_response)) {
			return proto;
		}
		return null;
	});

	// Outcome Package Data — REAL data only (null when not persisted).
	const outcomeData = $derived(
		payload.decision || payload.execution || payload.outcome
			? {
					decision: payload.decision || {},
					execution: payload.execution || {},
					outcome: payload.outcome || {}
				}
			: null
	);

	// Feedback Package Data — REAL data only (null when not persisted).
	const feedbackData = $derived(payload.feedback || null);

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
		onkeydown={(e: KeyboardEvent) => e.key === 'Escape' && (open = false)}
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
							<div class="py-12 text-center italic text-gray-400">
								{pipelineLogs.length === 0
									? 'No pipeline execution recorded for this item.'
									: 'No logs recorded for this section.'}
							</div>
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

						{#if aiProtocol}
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
						{:else}
							<div class="py-12 text-center italic text-gray-400">No AI extraction protocol recorded for this item.</div>
						{/if}
					</div>
				{:else if activeTab === 'outcome'}
					<!-- Outcome package JSON view -->
					<div>
						<div class="mb-3 flex justify-between items-center">
							<span class="text-xs font-bold text-slate-600">Decision Execution & Outcome Payload</span>
							{#if outcomeData}
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
							{/if}
						</div>
						{#if outcomeData}
							<pre class="overflow-x-auto rounded-lg border border-slate-200 bg-slate-900 p-4 font-mono text-[11px] text-slate-200 leading-normal">{JSON.stringify(outcomeData, null, 2)}</pre>
						{:else}
							<div class="py-12 text-center italic text-gray-400">No outcome package recorded for this item.</div>
						{/if}
					</div>
				{:else if activeTab === 'feedback'}
					<!-- Feedback package JSON view -->
					<div>
						<div class="mb-3 flex justify-between items-center">
							<span class="text-xs font-bold text-slate-600">User overrides & Feedback metadata</span>
							{#if feedbackData}
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
							{/if}
						</div>
						{#if feedbackData}
							<pre class="overflow-x-auto rounded-lg border border-slate-200 bg-slate-900 p-4 font-mono text-[11px] text-slate-200 leading-normal">{JSON.stringify(feedbackData, null, 2)}</pre>
						{:else}
							<div class="py-12 text-center italic text-gray-400">No feedback package recorded for this item.</div>
						{/if}
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
