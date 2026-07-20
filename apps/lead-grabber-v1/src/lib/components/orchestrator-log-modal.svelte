<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index';

	interface Props {
		open?: boolean;
		commId?: string;
		logs?: string[];
		details?: Record<string, any> | null;
	}
	let { open = $bindable(false), commId = '', logs = [], details = null }: Props = $props();

	// The 8 pipeline sections, per ClearSky_Pipeline_Complete_Reference.md §1.4.
	const SECTIONS: { n: number; name: string; blurb: string }[] = [
		{ n: 1, name: 'Event Intake', blurb: 'Ingest → company → identity → suppression → AI extraction → storage' },
		{ n: 2, name: 'Signal Detection', blurb: 'Event tested against the signal rule book' },
		{ n: 3, name: 'Orchestrator Decision', blurb: 'Dominant signal → execution mode → actions selected/blocked' },
		{ n: 4, name: 'Action Queue + Parameters', blurb: 'Work orders created, parameters resolved' },
		{ n: 5, name: 'Execution', blurb: 'Actions run — public replies stay pending approval' },
		{ n: 6, name: 'Outcome', blurb: 'Terminal state recorded per queued action' },
		{ n: 7, name: 'Feedback', blurb: 'Evaluations written, workflow loop closed' },
		{ n: 8, name: 'Network (Cohort 2)', blurb: 'Growth attribution — only on a terminal win/loss' }
	];

	/** Which section a raw log line belongs to (null = not a pipeline line). */
	function sectionFor(line: string): number | null {
		const s = line.trim();
		const explicit = s.match(/Section\s+([1-8])\s*[-:]/);
		if (explicit) return Number(explicit[1]);
		const step = s.match(/\[Step\s+(\d+)\]/);
		if (step) {
			const n = Number(step[1]);
			if (n <= 9) return 1;
			if (n <= 12) return 2;
			if (n === 13) return 4;
			if (n === 14) return 5;
			return null;
		}
		if (/Family Group|Rule\s+\d+\s*\{SIG-/i.test(s)) return 2;
		// START/END are pipeline-level boundaries, not part of any one section.
		return null;
	}

	// A continuation line ("      → System successfully loaded…") belongs to the line above it.
	const isContinuation = (line: string) => /^\s+(→|╰─|·|\})/.test(line) || /^\s{4,}\S/.test(line);

	const pipelineLines = $derived(
		Array.isArray(details?.pipeline_logs) ? (details!.pipeline_logs as string[]) : []
	);
	/** Trace id from the pipeline START marker, surfaced in the header for cross-referencing logs. */
	const traceId = $derived.by(() => {
		for (const l of pipelineLines) {
			const m = l.match(/Trace:\s*(trc_\S+)/);
			if (m) return m[1].replace(/-+$/, '');
		}
		return '';
	});

	const orchestratorLines = $derived.by(() => {
		const fromDetails = Array.isArray(details?.orchestrator_logs)
			? (details!.orchestrator_logs as string[])
			: [];
		// Callers pass `logs` as pipeline+orchestrator already merged, so filter the pipeline lines
		// back out — otherwise every section line is re-printed here too.
		const pipelineSet = new Set(pipelineLines);
		const merged = [...fromDetails];
		for (const l of logs || []) if (!pipelineSet.has(l) && !merged.includes(l)) merged.push(l);
		return merged;
	});

	const grouped = $derived.by(() => {
		const buckets = new Map<number, string[]>();
		const other: string[] = [];
		let last: number | null = null;
		for (const line of pipelineLines) {
			let sec = sectionFor(line);
			if (sec === null && isContinuation(line) && last !== null) sec = last;
			if (sec === null) {
				other.push(line);
				continue;
			}
			last = sec;
			if (!buckets.has(sec)) buckets.set(sec, []);
			buckets.get(sec)!.push(line);
		}
		return { buckets, other };
	});

	function level(line: string): 'error' | 'warn' | 'ok' | 'info' {
		if (/🔴|\bERROR\b|\bFAILED\b|^⚠/.test(line)) return 'error';
		if (/⚠|\bSKIPPED\b|\bBLOCKED\b|\bSUPPRESSED\b|NOT_FOUND/.test(line)) return 'warn';
		if (/✅|\bMATCHED\b|\bSUCCESS\b|\bCOMPLETE[D]?\b|\bPASS\b/i.test(line)) return 'ok';
		return 'info';
	}

	/** Drop the emoji + timestamp prefix so the message itself leads. */
	function clean(line: string): string {
		return line
			.replace(/^[\s]*[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]+\s*/u, '')
			.replace(/^\[\d{4}-\d{2}-\d{2}[ T][^\]]*\]\s*/, '')
			.trimEnd();
	}

	function statusOf(n: number): { label: string; tone: string } {
		const lines = grouped.buckets.get(n) ?? [];
		if (!lines.length) {
			return n === 8
				? { label: 'Prototype — not wired', tone: 'bg-slate-100 text-slate-500' }
				: { label: 'Not reached', tone: 'bg-slate-100 text-slate-500' };
		}
		if (lines.some((l) => level(l) === 'error'))
			return { label: 'Error', tone: 'bg-red-100 text-red-700' };
		return { label: `${lines.length} ${lines.length === 1 ? 'line' : 'lines'}`, tone: 'bg-emerald-100 text-emerald-700' };
	}

	function copyLogs() {
		const parts: string[] = [`Communication ${commId || '—'}`, ''];
		for (const s of SECTIONS) {
			const lines = grouped.buckets.get(s.n) ?? [];
			parts.push(`── Section ${s.n}: ${s.name} — ${statusOf(s.n).label} ──`);
			parts.push(lines.length ? lines.join('\n') : '(no activity recorded)');
			parts.push('');
		}
		if (grouped.other.length) parts.push('── Other ──', grouped.other.join('\n'), '');
		if (orchestratorLines.length) parts.push('── Reply orchestrator ──', orchestratorLines.join('\n'));
		try {
			navigator.clipboard?.writeText(parts.join('\n'));
		} catch {
			/* ignore */
		}
	}

	// The structured decision data the orchestrator recorded (shown above the section trace).
	const detailRows = $derived.by(() => {
		const d = details || {};
		const rows: [string, string][] = [];
		const push = (k: string, v: any) => {
			if (v !== undefined && v !== null && v !== '')
				rows.push([k, typeof v === 'object' ? JSON.stringify(v) : String(v)]);
		};
		push('Category', d.message_category);
		push('Reclassified', d.reclassified);
		push('IVR digit', d.ivr_digit);
		push('IVR department', d.ivr_intent ?? d.ivr_department);
		push('Day of week', d.call_day_of_week);
		push('Line type', d.line_type);
		push('Carrier', d.carrier);
		if (d.caller_geo) push('Geo', `${d.caller_geo.areaCode ?? ''} ${d.caller_geo.location ?? ''}`.trim());
		if (d.weather) push('Weather', `${d.weather.tempF ?? '?'}°F ${d.weather.description ?? ''}`.trim());
		if (d.ai_intent) {
			push('Sentiment', d.ai_intent.sentiment);
			push('Urgency', d.ai_intent.urgency);
			push('Opportunity', d.ai_intent.opportunity);
			if (Array.isArray(d.ai_intent.complaints) && d.ai_intent.complaints.length)
				push('Complaints', d.ai_intent.complaints.join('; '));
			push('Confidence', d.ai_intent.confidence);
		}
		if (d.appointment_booked) push('Appointment booked', JSON.stringify(d.appointment_booked));
		if (d.callback_ack_sent) push('Callback ack', 'sent');
		return rows;
	});

	const toneClass: Record<string, string> = {
		error: 'text-red-600',
		warn: 'text-amber-600',
		ok: 'text-emerald-700',
		info: 'text-slate-700'
	};
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="!max-w-4xl overflow-hidden rounded bg-white p-0">
		<div class="flex max-h-[85vh] flex-col gap-4 overflow-y-auto p-6">
			<div class="flex items-center justify-between">
				<div>
					<h2 class="text-lg font-semibold text-slate-900">
						Pipeline Log{commId ? ` — ${commId}` : ''}
					</h2>
					<p class="text-xs text-slate-500">
					All 8 ClearSky pipeline sections for this communication{#if traceId}
						· <span class="font-mono">{traceId}</span>{/if}
				</p>
				</div>
				<button
					onclick={copyLogs}
					class="rounded border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
				>
					Copy all
				</button>
			</div>

			{#if detailRows.length}
				<div class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded bg-slate-50 p-3 text-sm">
					{#each detailRows as [k, v]}
						<div class="text-slate-500">{k}</div>
						<div class="break-words font-medium text-slate-800">{v}</div>
					{/each}
				</div>
			{/if}

			<!-- The 8 sections, always all shown: an empty one tells you where the pipeline stopped. -->
			<div class="flex flex-col gap-2">
				{#each SECTIONS as s}
					{@const lines = grouped.buckets.get(s.n) ?? []}
					{@const status = statusOf(s.n)}
					<details open={lines.length > 0} class="rounded border border-slate-200">
						<summary
							class="flex cursor-pointer list-none items-center gap-3 rounded bg-slate-50 px-3 py-2 hover:bg-slate-100"
						>
							<span
								class="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-slate-700 text-[11px] font-semibold text-white"
							>
								{s.n}
							</span>
							<span class="min-w-0 flex-1">
								<span class="block text-sm font-semibold text-slate-800">{s.name}</span>
								<span class="block text-[11px] leading-tight text-slate-500">{s.blurb}</span>
							</span>
							<span class="flex-shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium {status.tone}">
								{status.label}
							</span>
						</summary>
						{#if lines.length}
							<div class="max-h-[300px] overflow-y-auto border-t border-slate-200 bg-white px-3 py-2">
								{#each lines as line}
									<div
										class="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed {toneClass[
											level(line)
										]}"
									>
										{clean(line)}
									</div>
								{/each}
							</div>
						{:else}
							<div class="border-t border-slate-200 px-3 py-2 text-[11px] italic text-slate-400">
								{s.n === 8
									? 'Specced and prototype-simulated (cohort2.ts) — not wired to a live runner. Only fires on a terminal win/loss.'
									: 'No activity recorded — the pipeline did not reach this section for this event.'}
							</div>
						{/if}
					</details>
				{/each}
			</div>

			{#if grouped.other.length}
				<details class="rounded border border-slate-200">
					<summary
						class="cursor-pointer list-none rounded bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
					>
						Other trace ({grouped.other.length})
					</summary>
					<div class="max-h-[240px] overflow-y-auto border-t border-slate-200 px-3 py-2">
						{#each grouped.other as line}
							<div
								class="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed {toneClass[
									level(line)
								]}"
							>
								{clean(line)}
							</div>
						{/each}
					</div>
				</details>
			{/if}

			<!-- The reply orchestrator (process_orchestrator) runs after the pipeline — kept separate. -->
			<div class="space-y-2">
				<div class="text-xs font-semibold uppercase tracking-wide text-slate-500">
					Reply orchestrator
				</div>
				<div
					class="max-h-[300px] overflow-y-auto rounded bg-slate-900 p-3 font-mono text-[11px] leading-relaxed text-slate-100"
				>
					{#if orchestratorLines.length}
						{#each orchestratorLines as line}
							<div class="whitespace-pre-wrap break-words {line.startsWith('⚠') ? 'text-red-300' : ''}">
								{line}
							</div>
						{/each}
					{:else}
						<div class="text-slate-400">
							No reply-orchestrator steps recorded (these are stored on the inbound message).
						</div>
					{/if}
				</div>
			</div>
		</div>
	</Dialog.Content>
</Dialog.Root>
