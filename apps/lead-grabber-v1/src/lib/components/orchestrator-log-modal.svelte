<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index';

	interface Props {
		open?: boolean;
		commId?: string;
		logs?: string[];
		details?: Record<string, any> | null;
	}
	let { open = $bindable(false), commId = '', logs = [], details = null }: Props = $props();

	function copyLogs() {
		try {
			navigator.clipboard?.writeText((logs || []).join('\n'));
		} catch {
			/* ignore */
		}
	}

	// The structured decision data the orchestrator recorded (shown above the raw log lines).
	const detailRows = $derived.by(() => {
		const d = details || {};
		const rows: [string, string][] = [];
		const push = (k: string, v: any) => {
			if (v !== undefined && v !== null && v !== '') rows.push([k, typeof v === 'object' ? JSON.stringify(v) : String(v)]);
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
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="!max-w-2xl overflow-hidden rounded bg-white p-0">
		<div class="flex max-h-[80vh] flex-col gap-4 overflow-y-auto p-6">
			<div class="flex items-center justify-between">
				<h2 class="text-lg font-semibold text-slate-900">
					Orchestrator Log{commId ? ` — ${commId}` : ''}
				</h2>
				<button
					onclick={copyLogs}
					class="rounded border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
				>
					Copy
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

			<div class="space-y-2">
				<div class="text-xs font-semibold uppercase tracking-wide text-slate-500">Orchestrator steps</div>
				<div
					class="max-h-[360px] overflow-y-auto rounded bg-slate-900 p-3 font-mono text-[11px] leading-relaxed text-slate-100"
				>
					{#if logs && logs.length}
						{#each logs as line}
							<div class="whitespace-pre-wrap {line.startsWith('⚠') ? 'text-red-300' : ''}">{line}</div>
						{/each}
					{:else}
						<div class="text-slate-400">No orchestrator logs recorded for this communication yet.</div>
					{/if}
				</div>
			</div>
		</div>
	</Dialog.Content>
</Dialog.Root>
