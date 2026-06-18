<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import EmptyState from '$lib/components/EmptyState.svelte';

	interface Rule {
		id: string;
		ruleTitle: string;
		schedule: Record<string, { start?: string; end?: string } | string | null>;
	}
	interface Flow {
		id: string;
		title: string;
		rules: Rule[];
	}

	// Single source of truth: page.data from load (avoids prop/effect timing issues)
	type PageData = { flows?: Flow[] };
	let callFlows = $derived.by(() => {
		const p = page as unknown as { data?: PageData };
		return (p?.data?.flows ?? []) as Flow[];
	});
	let deletingId = $state<string | null>(null);

	function handleCreate() {
		goto('/ivr/create');
	}

	function handleView(id: string) {
		goto(`/ivr/${id}`);
	}

	function handleEdit(id: string) {
		goto(`/ivr/${id}/edit-flow`);
	}

	function handleCreateRule(flowId: string) {
		goto(`/ivr/${flowId}/edit`);
	}

	async function handleDelete(id: string) {
		if (deletingId) return;
		deletingId = id;
		try {
			const res = await fetch(`/api/ivr/flows/${id}`, { method: 'DELETE' });
			if (res.ok) {
				goto('/ivr', { invalidateAll: true });
			}
		} finally {
			deletingId = null;
		}
	}

	function scheduleSummary(schedule: Rule['schedule']): string {
		if (!schedule || typeof schedule !== 'object') return 'No schedule';
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

<div class="min-h-screen bg-[#ECEFF3] p-4">
	<!-- Main Content Card -->
	<div class="mx-auto max-w-[1370px] rounded-lg bg-white p-6">
		<!-- Header -->
		<div class="mb-6 flex items-center justify-between">
			<h1 class="font-['Poppins'] text-2xl font-bold leading-[28px] text-[#777777]">
				Call Flow List
			</h1>
			<button
				onclick={handleCreate}
				class="h-[37px] w-[193px] rounded-[4px] border border-[#577AB7] bg-[#577AB7] font-['Poppins'] text-base font-semibold leading-[19px] text-white transition-colors hover:bg-[#4a6ba5]"
			>
				Create new Call flow
			</button>
		</div>

		<!-- Call Flow Cards -->
		{#if callFlows.length === 0}
			<EmptyState
				title="No Call Flows Yet"
				description="Start by creating your own call flow and set up your rules."
				primaryAction={{ label: 'Create new Call flow', onclick: handleCreate }}
			/>
		{:else}
			<div class="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
				{#each callFlows as flow}
					<div
						class="flex flex-col rounded-xl bg-[#f1f4f8] p-6 shadow-[0_2px_4px_rgba(0,0,0,0.05)]"
					>
						<h2
							class="mb-5 font-['Poppins'] text-[1.75rem] font-semibold leading-normal text-[#666]"
						>
							{flow.title}
						</h2>

						{#if flow.rules?.length}
							<div class="mb-4 flex flex-wrap gap-2 leading-[1.4]">
								<span class="font-['Poppins'] text-[1.2rem] font-bold text-[#5c7cb8]">
									Active rule:
								</span>
								<span class="font-['Poppins'] text-[1.2rem] italic text-[#777]">
									{flow.rules[0].ruleTitle}
									<span class="not-italic"
										>({scheduleSummary(flow.rules[0].schedule as Rule['schedule'])})</span
									>
								</span>
							</div>
						{:else}
							<p class="mb-4 font-['Poppins'] text-[1rem] text-[#808080]">
								No rules yet. Add a schedule rule.
							</p>
						{/if}

						<div class="mt-auto flex flex-wrap gap-3">
							<button
								onclick={() => handleView(flow.id)}
								class="rounded px-5 py-1.5 font-['Poppins'] text-base font-semibold text-white transition-opacity hover:opacity-90"
								style="background-color: #6384c1;"
							>
								View Full Details
							</button>
							<button
								onclick={() => handleEdit(flow.id)}
								class="rounded px-5 py-1.5 font-['Poppins'] text-base font-semibold text-white transition-opacity hover:opacity-90"
								style="background-color: #6384c1;"
							>
								Edit
							</button>
							<button
								onclick={() => handleCreateRule(flow.id)}
								class="rounded px-5 py-1.5 font-['Poppins'] text-base font-semibold text-white transition-opacity hover:opacity-90"
								style="background-color: #577AB7;"
							>
								Create New Set Rule
							</button>
							<button
								onclick={() => handleDelete(flow.id)}
								disabled={deletingId === flow.id}
								class="rounded px-5 py-1.5 font-['Poppins'] text-base font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
								style="background-color: #d65b5b;"
							>
								{deletingId === flow.id ? 'Deleting…' : 'Delete'}
							</button>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>
