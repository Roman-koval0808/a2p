<script lang="ts">
	import { createBubbler, stopPropagation } from 'svelte/legacy';

	const bubble = createBubbler();

	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const filters = [
		{ label: 'All', key: 'all' },
		{ label: 'Email', key: 'email' },
		{ label: 'SMS', key: 'sms' },
		{ label: 'Voice', key: 'voice' },
		{ label: 'Web', key: 'web' },
		{ label: 'Facebook', key: 'facebook' },
		{ label: 'Linkedin', key: 'linkedin' }
	];
	let selectedFilter = $state('all');
	let search = $state('');

	// Real communication logs for the current company, loaded server-side.
	const rows = $derived(data.rows ?? []);

	import {
		Mail,
		MessageSquare,
		Phone,
		Globe,
		Facebook,
		Linkedin,
		Icon,
		Search,
		Mic
	} from 'lucide-svelte';

	const iconMap: Record<string, typeof Mail> = {
		email: Mail,
		sms: MessageSquare,
		voice: Phone,
		web: Globe,
		facebook: Facebook,
		linkedin: Linkedin
	};

	function icon(type: string) {
		return iconMap[type] || null;
	}

	// Filtered and searched rows
	let filteredRows = $derived(rows.filter(
		(row) =>
			(selectedFilter === 'all' || row.type === selectedFilter) &&
			(row.date.toLowerCase().includes(search.toLowerCase()) ||
				row.type.toLowerCase().includes(search.toLowerCase()) ||
				row.source.toLowerCase().includes(search.toLowerCase()) ||
				row.endpoint.toLowerCase().includes(search.toLowerCase()) ||
				row.company.toLowerCase().includes(search.toLowerCase()) ||
				row.disposition.toLowerCase().includes(search.toLowerCase()))
	));

	let selectedLog: (typeof rows)[number] | null = $state(null);

	function openSummary(log: (typeof rows)[number]) {
		selectedLog = log;
	}
	function closeSummary() {
		selectedLog = null;
	}
</script>

<!-- Header -->
<div class="my-4 flex flex-col gap-2">
	<h1 class="text-2xl font-semibold">Communication Log</h1>
	<p class="text-base text-[#8a8fa7] text-muted-foreground">
		Instant updates to keep you informed and in control.
	</p>
</div>

<!-- Filters & Search -->
<div class="flex flex-wrap items-center gap-4">
	<div class="flex flex-wrap gap-2">
		{#each filters as filter}
			<button
				class="rounded-lg border-none px-4 py-2 font-medium transition-colors
					{selectedFilter === filter.key
					? 'bg-primary text-white'
					: 'bg-[#e7eaf6] text-primary hover:bg-[#d6d9e6]'}"
				onclick={() => (selectedFilter = filter.key)}
			>
				{filter.label}
			</button>
		{/each}
	</div>
	<div class="ml-auto flex items-center justify-between rounded-xl bg-white px-3 py-1">
		<Search class="mr-2 text-primary" />
		<input
			type="text"
			placeholder="Search"
			bind:value={search}
			class="border-none bg-transparent px-2 py-2 text-base outline-none"
		/>
		<Mic class="mr-2 text-primary" />
	</div>
</div>

<!-- Table -->
<div class="mt-4 overflow-x-auto rounded-xl bg-[#f4f6fb] py-4">
	<!-- Apply min-w-[1000px] or max-content to force potential overflow -->
	<table class="w-full min-w-[1000px] border-collapse">
		<thead>
			<tr>
				<th class="bg-[#f4f6fb] px-2 py-3 text-left font-semibold text-[#8a8fa7]">Date</th>
				<th class="bg-[#f4f6fb] px-2 py-3 text-left font-semibold text-[#8a8fa7]">Type</th>
				<th class="bg-[#f4f6fb] px-2 py-3 text-left font-semibold text-[#8a8fa7]">Source ID</th>
				<th class="bg-[#f4f6fb] px-2 py-3 text-left font-semibold text-[#8a8fa7]">End Point</th>
				<th class="bg-[#f4f6fb] px-2 py-3 text-left font-semibold text-[#8a8fa7]">Ext.</th>
				<th class="bg-[#f4f6fb] px-2 py-3 text-left font-semibold text-[#8a8fa7]">Company</th>
				<th class="bg-[#f4f6fb] px-2 py-3 text-left font-semibold text-[#8a8fa7]">Disposition</th>
			</tr>
		</thead>
		<tbody>
			{#if filteredRows.length === 0}
				<tr class="bg-white">
					<td class="px-2 py-8 text-center text-[#8a8fa7]" colspan="7">
						No communications to show yet.
					</td>
				</tr>
			{/if}
			{#each filteredRows as row}
				<tr
					class="cursor-pointer border-b border-[#e7eaf6] bg-white transition last:border-b-0 hover:bg-[#f0f2f8]"
					onclick={() => openSummary(row)}
				>
					<td class="px-2 py-3">{row.date}</td>
					<td class="px-2 py-3">
						<div class="flex items-center gap-2">
							{#if icon(row.type)}
								{@const SvelteComponent = icon(row.type)}
								<SvelteComponent class="h-5 w-5 " />
							{/if}
							<span class="capitalize">{row.direction}</span>
						</div>
					</td>
					<td class="px-2 py-3">{row.source}</td>
					<td class="px-2 py-3">{row.endpoint}</td>
					<td class="px-2 py-3">{row.ext}</td>
					<td class="px-2 py-3">{row.company}</td>
					<td class="px-2 py-3">{row.disposition}</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>

{#if selectedLog}
	<!-- Overlay -->
	<div
		class="fixed inset-0 z-40 flex items-center justify-center bg-black/30"
		onclick={closeSummary}
	>
		<!-- Popup Card -->
		<div
			class="relative z-50 w-full max-w-lg rounded-xl bg-white p-6 shadow-xl"
			onclick={stopPropagation(bubble('click'))}
		>
			<button
				class="absolute right-3 top-3 text-gray-400 hover:text-gray-600"
				onclick={closeSummary}
				aria-label="Close"
			>
				&times;
			</button>
			<div class="mb-2 flex items-start justify-between">
				<div>
					<div class="text-sm font-semibold text-[#8a8fa7]">AI Summary:</div>
					<div class="mt-1 text-xs text-[#8a8fa7]">
						{selectedLog.date} | <span class="font-mono">{selectedLog.time}</span>
					</div>
				</div>
				<div class="text-right">
					<div class="text-xs font-semibold text-[#8a8fa7]">Comm ID - {selectedLog.commId}</div>
					<div class="text-xs">
						<span class="font-semibold text-[#8a8fa7]">Category:</span>
						<span class="text-gray-700">{selectedLog.category}</span>
					</div>
					<div class="text-xs">
						<span class="font-semibold text-[#8a8fa7]">Sub-Category:</span>
						<span class="text-gray-700">{selectedLog.subCategory}</span>
					</div>
				</div>
			</div>
			<div class="mb-1 mt-2 font-semibold text-[#8a8fa7]">Summary:</div>
			<div class="mb-3 rounded-md bg-[#f4f6fb] p-4 text-sm">
				<div>
					<span class="font-semibold text-[#8a8fa7]">
						{selectedLog.type === 'email' ? 'Email Address:' : 'Source:'}
					</span>
					<span class="font-mono">{selectedLog.email || '—'}</span>
				</div>
				<div>
					<span class="font-semibold text-[#8a8fa7]">Subject Line:</span>
					<span class="font-semibold">{selectedLog.subject}</span>
				</div>
				<div><span class="font-semibold text-[#8a8fa7]">Body:</span></div>
				<div class="mt-2 whitespace-pre-line rounded bg-white p-3">
					{#if selectedLog.body}
						{selectedLog.body}
					{:else}
						<span class="text-[#8a8fa7]">No message content available.</span>
					{/if}
				</div>
			</div>
			<div class="mt-2 text-sm">
				<span class="font-semibold text-[#8a8fa7]">Task:</span>
				<span class="font-semibold">{selectedLog.task || 'No follow-up task recorded.'}</span>
			</div>
		</div>
	</div>
{/if}
