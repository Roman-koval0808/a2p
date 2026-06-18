<script lang="ts">
	import { goto } from '$app/navigation';
	import { ArrowLeft } from 'lucide-svelte';

	interface Rule {
		id: string;
		ruleTitle: string;
		schedule: Record<string, unknown>;
	}
	interface Flow {
		id: string;
		title: string;
		rules: Rule[];
	}

	let { data }: { data: { flow?: Flow } } = $props();
	let flow = $derived((data?.flow ?? null) as Flow | null);

	function scheduleSummary(schedule: Record<string, unknown>): string {
		if (!schedule) return 'No schedule';
		const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
		const parts = days
			.map((d) => {
				const v = schedule[d];
				if (v == null || v === 'closed') return null;
				if (typeof v === 'object' && v && 'start' in v && 'end' in v)
					return `${d} ${(v as { start: string }).start}-${(v as { end: string }).end}`;
				return `${d}`;
			})
			.filter(Boolean);
		return parts.length ? parts.join(', ') : 'Closed';
	}
</script>

<div class="min-h-screen bg-[#ECEEF3] p-4">
	<div class="mx-auto max-w-[900px] rounded-lg bg-white p-6">
		<div class="mb-6 flex items-center justify-between">
			<button
				onclick={() => goto('/ivr')}
				class="flex items-center gap-2 font-['Poppins'] text-base font-medium leading-[19px] text-[#757575] transition-colors hover:text-[#577AB7]"
			>
				<ArrowLeft class="h-4 w-4" />
				Back
			</button>
		</div>
		{#if flow}
			<h1 class="mb-6 font-['Poppins'] text-2xl font-bold text-[#777777]">{flow.title}</h1>
			<div class="mb-6">
				<h2 class="mb-3 font-['Poppins'] text-lg font-semibold text-[#808080]">Rules</h2>
				{#if flow.rules?.length}
					<ul class="space-y-3">
						{#each flow.rules as rule}
							<li
								class="flex items-center justify-between rounded border border-[#E0E0E0] bg-[#f9fafb] p-4"
							>
								<div>
									<span class="font-['Poppins'] font-semibold text-[#666]">{rule.ruleTitle}</span>
									<span class="ml-2 font-['Poppins'] text-sm text-[#808080]">
										{scheduleSummary(rule.schedule)}
									</span>
								</div>
								<button
									onclick={() => goto(`/ivr/${flow!.id}/rules/${rule.id}/edit`)}
									class="rounded bg-[#577AB7] px-4 py-2 font-['Poppins'] text-sm font-medium text-white transition-opacity hover:opacity-90"
								>
									Edit Rule
								</button>
							</li>
						{/each}
					</ul>
				{:else}
					<p class="font-['Poppins'] text-[#808080]">No rules yet.</p>
				{/if}
			</div>
			<div class="flex gap-3">
				<button
					onclick={() => goto(`/ivr/${flow.id}/edit`)}
					class="rounded bg-[#577AB7] px-4 py-2 font-['Poppins'] text-base font-semibold text-white transition-opacity hover:opacity-90"
				>
					Create New Set Rule
				</button>
				<button
					onclick={() => goto(`/ivr/${flow.id}/edit-flow`)}
					class="rounded border border-[#577AB7] bg-white px-4 py-2 font-['Poppins'] text-base font-semibold text-[#577AB7] transition-colors hover:bg-[#f0f4ff]"
				>
					Edit Flow Settings
				</button>
			</div>
		{/if}
	</div>
</div>
