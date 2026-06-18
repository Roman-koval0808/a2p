<script lang="ts">
	import {
		Search,
		Mic,
		Mail,
		MessageSquare,
		Phone,
		Globe,
		Facebook,
		Bot,
		FileText,
		MessageCircle
	} from 'lucide-svelte';

	export interface Communication {
		id: string;
		date: string;
		time: string;
		type?: 'email' | 'sms' | 'voice' | 'web' | 'facebook' | 'chatbot' | 'leadform' | 'leadbox';
		typeIcon?: string;
		direction: 'In' | 'Out';
		source: string;
		endpoint: string;
		purpose: string | null;
		summary: string | null;
		commId: string | null;
		status: 'red' | 'green' | 'blue' | 'in' | 'out';
		assignedMemberNames?: string[];
		raw?: any;
	}

	interface Props {
		communications: Communication[];
		filters?: string[];
		searchQuery?: string;
		selectedAgentName?: string | null;
		onSummaryClick?: (comm: Communication) => void;
		onActionClick?: (action: string, comm: Communication) => void;
		onAssignClick?: (comm: Communication) => void;
		onPipelineClick?: (comm: Communication) => void;
		showFilters?: boolean;
		showSearch?: boolean;
		showAssignButton?: boolean;
	}

	let {
		communications = $bindable(),
		filters = $bindable([
			'All',
			'Email',
			'SMS',
			'Voice',
			'Web',
			'Facebook',
			'Chatbot',
			'Leadform',
			'Leadbox'
		]),
		searchQuery = $bindable(''),
		selectedAgentName = null,
		onSummaryClick,
		onActionClick,
		onAssignClick,
		onPipelineClick,
		showFilters = true,
		showSearch = true,
		showAssignButton = false
	}: Props = $props();

	let activeFilter = $state('All');
	let openOptionsMenu = $state<string | null>(null);

	const filteredCommunications = $derived.by(() => {
		let filtered = communications;
		if (activeFilter !== 'All') {
			const filterType = activeFilter.toLowerCase();
			filtered = filtered.filter((comm) => {
				const commType = (comm.type || comm.typeIcon || '').toLowerCase();
				return commType === filterType;
			});
		}
		const q = (searchQuery ?? '').trim();
		if (q) {
			const query = q.toLowerCase();
			filtered = filtered.filter(
				(comm) =>
					comm.source?.toLowerCase().includes(query) ||
					comm.endpoint?.toLowerCase().includes(query) ||
					comm.summary?.toLowerCase().includes(query) ||
					comm.commId?.toLowerCase().includes(query) ||
					comm.type?.toLowerCase().includes(query)
			);
		}
		if (selectedAgentName) {
			filtered = filtered.filter(
				(comm) => comm.assignedMemberNames?.includes(selectedAgentName) ?? false
			);
		}
		return filtered;
	});

	function getStatusColor(status: string) {
		switch (status) {
			case 'red':
				return 'bg-[#FB2C36]';
			case 'green':
				return 'bg-[#00C951]';
			case 'blue':
				return 'bg-[#0077FE]';
			case 'in':
				return 'bg-[#00C951]';
			case 'out':
				return 'bg-[#FB2C36]';
			default:
				return 'bg-gray-400';
		}
	}

	function getTypeIcon(type: string | undefined) {
		const t = type?.toLowerCase();
		switch (t) {
			case 'email':
				return Mail;
			case 'sms':
				return MessageSquare;
			case 'voice':
				return Phone;
			case 'web':
				return Globe;
			case 'facebook':
				return Facebook;
			case 'chatbot':
				return Bot;
			case 'leadform':
				return FileText;
			case 'leadbox':
				return MessageCircle;
			default:
				return Mail;
		}
	}

	function getTypeDisplay(comm: Communication) {
		return comm.type || comm.typeIcon || 'email';
	}

	function handleSummaryClick(comm: Communication) {
		onSummaryClick?.(comm);
	}

	function handleActionClick(action: string, comm: Communication) {
		onActionClick?.(action, comm);
		openOptionsMenu = null;
	}
</script>

<div class="overflow-hidden rounded-lg border border-gray-300 bg-white">
	{#if showFilters}
		<div class="flex flex-wrap items-center gap-3 border-b border-gray-200 p-4">
			{#each filters as filter}
				<button
					type="button"
					class="rounded-md px-3 py-1.5 text-sm font-medium transition-colors {activeFilter ===
					filter
						? 'bg-slate-900 text-white'
						: 'text-gray-600 hover:bg-gray-100'}"
					onclick={() => (activeFilter = filter)}
				>
					{filter}
				</button>
			{/each}
		</div>
	{/if}

	<div class="overflow-x-auto">
		<table class="w-full min-w-[900px] border-collapse">
			<thead>
				<tr class="bg-gray-100">
					<th class="w-8 px-3 py-3 text-left"></th>
					<th
						class="w-24 whitespace-nowrap px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600"
					>
						Date
					</th>
					<th
						class="w-20 whitespace-nowrap px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600"
					>
						Type
					</th>
					<th
						class="min-w-[120px] max-w-[160px] whitespace-nowrap px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600"
					>
						Source
					</th>
					<th
						class="min-w-[120px] max-w-[180px] whitespace-nowrap px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600"
					>
						Endpoint
					</th>
					<th
						class="min-w-[100px] max-w-[140px] whitespace-nowrap px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600"
					>
						Purpose
					</th>
					<th
						class="w-20 whitespace-nowrap px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600"
					>
						Score
					</th>
					<th
						class="min-w-[180px] whitespace-nowrap px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600"
					>
						Summary
					</th>
					<th
						class="w-28 whitespace-nowrap px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600"
					>
						Comm ID
					</th>
					<th
						class="w-24 whitespace-nowrap px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600"
					>
						Pipeline
					</th>
					<th
						class="w-14 px-3 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-600"
					>
						Actions
					</th>
				</tr>
			</thead>
			<tbody>
				{#if filteredCommunications.length === 0}
					<tr>
						<td colspan="11" class="px-3 py-8 text-center text-sm text-gray-500">
							No communications found
						</td>
					</tr>
				{:else}
					{#each filteredCommunications as comm}
						{@const commType = getTypeDisplay(comm)}
						{@const IconComponent = getTypeIcon(commType)}
						<tr class="border-b border-gray-200 bg-white transition-colors hover:bg-gray-50/80">
							<td class="px-3 py-2.5 pt-4 align-top">
								<div
									class="h-4 w-4 shrink-0 rounded-full {getStatusColor(comm.status)}"
									title={comm.status}
								></div>
							</td>
							<td class="whitespace-nowrap px-3 py-2.5 text-sm text-gray-700">
								<div class="font-medium">{comm.date}</div>
								<div class="text-xs text-gray-500">{comm.time}</div>
							</td>
							<td class="whitespace-nowrap px-3 py-2.5">
								<div class="flex items-center gap-1.5 text-sm text-gray-700">
									<IconComponent class="h-4 w-4 shrink-0 text-gray-600" />
									<span class="font-medium">{comm.direction}</span>
								</div>
							</td>
							<td
								class="max-w-[160px] truncate px-3 py-2.5 text-sm text-gray-700"
								title={comm.source}
							>
								{comm.source || '—'}
							</td>
							<td class="max-w-[180px] px-3 py-2.5 text-sm text-gray-700">
								{#if showAssignButton && onAssignClick}
									<div class="flex flex-col gap-0.5">
										<span class="truncate" title={comm.endpoint}>{comm.endpoint || '—'}</span>
										<button
											type="button"
											class="text-left text-xs text-blue-600 underline hover:no-underline"
											onclick={() => onAssignClick(comm)}
										>
											Assign
										</button>
									</div>
								{:else}
									<span class="block truncate" title={comm.endpoint}>{comm.endpoint || '—'}</span>
								{/if}
							</td>
							<td class="max-w-[140px] truncate px-3 py-2.5 text-sm text-gray-700">
								{#if comm.purpose}
									{#if comm.purpose === 'Confirm'}
										<span
											class="inline-block rounded bg-[#577AB7] px-2 py-0.5 text-xs font-medium text-white"
										>
											Confirm
										</span>
									{:else}
										{comm.purpose}
									{/if}
								{:else}
									—
								{/if}
							</td>
							<td class="whitespace-nowrap px-3 py-2.5 text-sm">
								{#if comm.raw?.metadata?.score !== undefined}
									<span class="font-semibold text-slate-800">{comm.raw.metadata.score}</span>
									{#if comm.raw.metadata.scoreDelta}
										<span class="ml-1 text-xs font-semibold text-emerald-600">+{comm.raw.metadata.scoreDelta}</span>
									{/if}
								{:else}
									<span class="text-gray-400">—</span>
								{/if}
							</td>
							<td class="max-w-[240px] px-3 py-2.5 text-sm">
								{#if comm.summary}
									<button
										type="button"
										class="line-clamp-2 text-left text-blue-600 underline hover:no-underline"
										onclick={() => handleSummaryClick(comm)}
										title={comm.summary}
									>
										{comm.summary}
									</button>
								{:else}
									<span class="text-gray-400">—</span>
								{/if}
							</td>
							<td
								class="max-w-[120px] truncate px-3 py-2.5 font-mono text-xs text-gray-500"
								title={comm.commId ?? ''}
							>
								{comm.commId ? comm.commId.slice(0, 8) + '…' : '—'}
							</td>
							<td class="whitespace-nowrap px-3 py-2.5">
								<button
									type="button"
									class="inline-flex items-center gap-1 rounded bg-indigo-50 px-2 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 transition-colors"
									onclick={() => onPipelineClick?.(comm)}
								>
									⚡ Pipeline
								</button>
							</td>
							<td class="px-3 py-2.5 text-right align-top">
								<div class="relative inline-block">
									<button
										type="button"
										class="flex h-7 w-7 items-center justify-center rounded-full border border-gray-400 hover:bg-gray-100"
										aria-label="Actions"
										onclick={(e) => {
											e.stopPropagation();
											openOptionsMenu = openOptionsMenu === comm.id ? null : comm.id;
										}}
									>
										<span class="sr-only">Actions</span>
										<span class="flex gap-0.5">
											<span class="h-1 w-1 rounded-full bg-gray-500"></span>
											<span class="h-1 w-1 rounded-full bg-gray-500"></span>
											<span class="h-1 w-1 rounded-full bg-gray-500"></span>
										</span>
									</button>
									{#if openOptionsMenu === comm.id}
										<div
											class="absolute right-0 top-9 z-50 min-w-[160px] rounded-md border border-gray-200 bg-white py-1 shadow-lg"
											role="menu"
										>
											<button
												type="button"
												class="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
												onclick={() => handleActionClick('view', comm)}
											>
												View Details
											</button>
											<button
												type="button"
												class="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
												onclick={() => handleActionClick('call', comm)}
											>
												Call
											</button>
											<button
												type="button"
												class="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
												onclick={() => handleActionClick('sms', comm)}
											>
												SMS
											</button>
											<button
												type="button"
												class="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-gray-100"
												onclick={() => handleActionClick('email', comm)}
											>
												Email
											</button>
										</div>
									{/if}
								</div>
							</td>
						</tr>
					{/each}
				{/if}
			</tbody>
		</table>
	</div>
</div>
