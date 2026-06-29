<script lang="ts">
	import { Sparkles, Brain, Phone, Calendar, ArrowRight, DollarSign, ListTodo, Activity } from 'lucide-svelte';
	import { goto } from '$app/navigation';

	let { data } = $props<{ data: { logs: any[] } }>();

	function getUrgencyBadge(urgency: string) {
		const u = String(urgency).toLowerCase();
		if (u === 'high' || u === 'urgent' || u === 'red') {
			return 'bg-red-50 text-red-700 border-red-200';
		}
		if (u === 'medium' || u === 'mid' || u === 'blue') {
			return 'bg-blue-50 text-blue-700 border-blue-200';
		}
		return 'bg-green-50 text-green-700 border-green-200';
	}

	function getSentimentColor(sentiment: string) {
		const s = String(sentiment).toLowerCase();
		if (s.includes('neg') || s.includes('ang')) return 'text-red-600';
		if (s.includes('pos')) return 'text-emerald-600';
		return 'text-gray-600';
	}

	function formatDate(d: string) {
		return new Date(d).toLocaleString(undefined, {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}
</script>

<div class="min-h-screen bg-gray-50 p-6 font-sans">
	<div class="mb-6 flex items-center justify-between border-b border-gray-200 pb-5">
		<div>
			<h1 class="text-xl font-bold text-gray-800 flex items-center gap-2">
				<Brain class="h-5 w-5 text-indigo-500" />
				AI Summaries & Classifications
			</h1>
			<p class="text-xs text-gray-500 mt-1">Review AI extracted summaries, IVR routing, and classifications from voice calls.</p>
		</div>
	</div>

	{#if data.logs.length === 0}
		<div class="flex flex-col items-center justify-center p-12 bg-white rounded-lg border border-gray-200 text-gray-500 text-sm">
			<Sparkles class="h-8 w-8 text-gray-300 mb-3" />
			No recent call summaries or recordings available yet.
		</div>
	{:else}
		<div class="grid grid-cols-1 gap-6 md:grid-cols-2">
			{#each data.logs as log}
				<div class="bg-white rounded-xl border border-gray-200 p-5 shadow-sm hover:shadow-md transition-shadow flex flex-col gap-4">
					<div class="flex items-start justify-between">
						<div class="flex items-center gap-3">
							<div class="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 border border-indigo-100">
								<Phone class="h-5 w-5" />
							</div>
							<div>
								<h3 class="text-sm font-bold text-gray-800">{log.customerName || log.source}</h3>
								<div class="flex items-center gap-2 mt-1 text-[10px] text-gray-400 font-semibold uppercase">
									<Calendar class="h-3 w-3" />
									{formatDate(log.created)}
								</div>
							</div>
						</div>
						<div class="flex flex-col items-end gap-1.5">
							<span class="inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded border {getUrgencyBadge(log.urgency)}">
								{String(log.urgency).toUpperCase()} URGENCY
							</span>
							{#if log.ivrIntent}
								<span class="text-[11px] font-bold text-[#F54900]">
									IVR: {log.ivrIntent}
								</span>
							{/if}
						</div>
					</div>

					<div class="bg-slate-50 border border-slate-100 rounded-lg p-3 text-xs text-gray-700 leading-relaxed italic">
						"{log.summary}"
					</div>

					<div class="grid grid-cols-3 gap-3 border-t border-b border-gray-100 py-3">
						<div class="text-center border-r border-gray-100">
							<p class="text-[9px] text-gray-400 font-bold uppercase">Intent</p>
							<p class="text-xs font-bold text-gray-800 mt-1">{log.intent}</p>
						</div>
						<div class="text-center border-r border-gray-100">
							<p class="text-[9px] text-gray-400 font-bold uppercase">Sentiment</p>
							<p class="text-xs font-bold mt-1 {getSentimentColor(log.sentiment)}">{log.sentiment}</p>
						</div>
						<div class="text-center">
							<p class="text-[9px] text-gray-400 font-bold uppercase">Est. Value</p>
							<p class="text-xs font-bold text-emerald-600 mt-1">
								{log.estimatedPrice ? `$${log.estimatedPrice}` : '—'}
							</p>
						</div>
					</div>

					{#if log.actionItems && log.actionItems.length > 0}
						<div>
							<h4 class="text-[10px] text-gray-400 font-bold uppercase tracking-wider mb-2 flex items-center gap-1.5">
								<ListTodo class="h-3 w-3 text-gray-400" />
								Action Items
							</h4>
							<ul class="space-y-1">
								{#each log.actionItems as item}
									<li class="text-xs text-gray-600 flex items-start gap-1.5">
										<span class="text-indigo-500 font-bold mt-0.5">•</span>
										<span>{item}</span>
									</li>
								{/each}
							</ul>
						</div>
					{/if}

					<div class="mt-auto pt-3 border-t border-gray-100 flex justify-between items-center">
						<button 
							onclick={() => goto('/communication-log')}
							class="text-xs font-bold text-indigo-600 hover:text-indigo-700 flex items-center gap-1.5 hover:underline bg-transparent border-none p-0 cursor-pointer"
						>
							View in Communication Log
							<ArrowRight class="h-3.5 w-3.5" />
						</button>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
