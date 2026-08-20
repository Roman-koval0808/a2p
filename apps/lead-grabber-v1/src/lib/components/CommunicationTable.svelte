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
		MessageCircle,
		Video,
		Reply,
		ChevronUp,
		ChevronDown
	} from 'lucide-svelte';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';

	export interface Communication {
		id: string;
		date: string;
		time: string;
		type?: 'email' | 'sms' | 'voice' | 'web' | 'facebook' | 'chatbot' | 'leadform' | 'leadbox' | 'viewroom';
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
		emailOpenedAt?: string | null;
		emailClickedAt?: string | null;
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
		onViewLogClick?: (comm: Communication) => void;
		onReplyClick?: (comm: Communication) => void;
		onConfirmClick?: (comm: Communication) => void;
		onProfileClick?: (comm: Communication) => void;
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
			'Leadbox',
			'Viewroom'
		]),
		searchQuery = $bindable(''),
		selectedAgentName = null,
		onSummaryClick,
		onActionClick,
		onAssignClick,
		onPipelineClick,
		onViewLogClick,
		onReplyClick,
		onConfirmClick,
		onProfileClick,
		showFilters = true,
		showSearch = true,
		showAssignButton = false
	}: Props = $props();

	let activeFilter = $state('All');
	let openOptionsMenu = $state<string | null>(null);
	let openDropdownId = $state<string | null>(null);

	let sortColumn = $state<string | null>('date');
	let sortDirection = $state<'asc' | 'desc'>('desc');

	function handleSort(column: string) {
		if (sortColumn === column) {
			sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
		} else {
			sortColumn = column;
			sortDirection = 'asc';
		}
	}

	// Live clock so the emergency SLA countdown ticks without a page reload.
	let nowMs = $state(Date.now());
	$effect(() => {
		const t = setInterval(() => (nowMs = Date.now()), 1000);
		return () => clearInterval(t);
	});

	/**
	 * SLA badge state for an emergency-dispatch row. null when the row has no SLA.
	 * `met` — a callback was placed in time · `breached` — past due, no callback · `pending` — counting down.
	 */
	function slaBadge(comm: any): { label: string; tone: string } | null {
		const m = comm?.raw?.metadata;
		if (!m?.is_emergency_dispatch || !m?.sla_due_at) return null;
		if (m.sla_status === 'met')
			return { label: 'SLA met', tone: 'bg-emerald-100 text-emerald-700' };
		const dueMs = new Date(m.sla_due_at).getTime();
		const remaining = dueMs - nowMs;
		if (remaining <= 0) return { label: 'SLA BREACHED', tone: 'bg-red-100 text-red-700' };
		const mm = Math.floor(remaining / 60000);
		const ss = Math.floor((remaining % 60000) / 1000);
		return {
			label: `SLA ${mm}:${String(ss).padStart(2, '0')}`,
			tone: remaining <= 120000 ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-700'
		};
	}

	/**
	 * Calendar Grace Period badge state for an in-progress verification.
	 */
	function calendarGraceBadge(comm: any): { label: string; tone: string } | null {
		const m = comm?.raw?.metadata;
		if (!m?.waiting_for_calendar || !m?.timer_due_at) return null;
		
		const dueMs = new Date(m.timer_due_at).getTime();
		const remaining = dueMs - nowMs;
		
		if (remaining <= 0) return { label: 'Verification Failed', tone: 'bg-red-100 text-red-700' };
		
		const mm = Math.floor(remaining / 60000);
		const ss = Math.floor((remaining % 60000) / 1000);
		return {
			label: `Verifying... ${mm}:${String(ss).padStart(2, '0')}`,
			tone: 'bg-indigo-100 text-indigo-700 border border-indigo-200'
		};
	}

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

		if (sortColumn) {
			filtered = [...filtered].sort((a, b) => {
				let aVal: any = a[sortColumn as keyof typeof a];
				let bVal: any = b[sortColumn as keyof typeof b];

				if (sortColumn === 'date') {
					const aTime = new Date(`${a.date} ${a.time || ''}`).getTime();
					const bTime = new Date(`${b.date} ${b.time || ''}`).getTime();
					if (!isNaN(aTime) && !isNaN(bTime)) {
						aVal = aTime;
						bVal = bTime;
					}
				} else if (sortColumn === 'type') {
					aVal = getTypeDisplay(a).toLowerCase();
					bVal = getTypeDisplay(b).toLowerCase();
				}

				if (aVal === null || aVal === undefined) aVal = '';
				if (bVal === null || bVal === undefined) bVal = '';

				if (typeof aVal === 'string' && typeof bVal === 'string') {
					const cmp = aVal.localeCompare(bVal);
					return sortDirection === 'asc' ? cmp : -cmp;
				}

				if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
				if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
				return 0;
			});
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
			case 'viewroom':
				return Video;
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

	async function fastForwardTimer(comm: Communication) {
		try {
			const res = await fetch(`/api/communication-logs/${comm.id}/fast-forward-timer`, {
				method: 'POST'
			});
			if (res.ok) {
				alert('Timer fast-forwarded successfully. Please refresh the page in a moment to see updates.');
			} else {
				const data = await res.json();
				alert(`Failed to fast forward: ${data.error || 'Unknown error'}`);
			}
		} catch (e: any) {
			alert(`Error: ${e.message}`);
		}
	}

	function handleActionClick(action: string, comm: any) {
		onActionClick?.(action, comm);
		openOptionsMenu = null;
		openDropdownId = null;
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
					<th class="w-8 px-3 py-3 text-left">
						<!-- Info icon -->
						<div class="flex h-5 w-5 items-center justify-center rounded-full bg-gray-500 text-white font-serif text-[10px] font-bold">i</div>
					</th>
					<th
						class="w-24 cursor-pointer whitespace-nowrap px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600 hover:bg-gray-200 transition-colors select-none"
						onclick={() => handleSort('date')}
					>
						<div class="flex items-center gap-1">
							Date
							{#if sortColumn === 'date'}
								{#if sortDirection === 'asc'}<ChevronUp class="h-3 w-3 text-gray-400" />{:else}<ChevronDown class="h-3 w-3 text-gray-400" />{/if}
							{/if}
						</div>
					</th>
					<th
						class="w-20 cursor-pointer whitespace-nowrap px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600 hover:bg-gray-200 transition-colors select-none"
						onclick={() => handleSort('type')}
					>
						<div class="flex items-center gap-1">
							Type
							{#if sortColumn === 'type'}
								{#if sortDirection === 'asc'}<ChevronUp class="h-3 w-3 text-gray-400" />{:else}<ChevronDown class="h-3 w-3 text-gray-400" />{/if}
							{/if}
						</div>
					</th>
					<th
						class="min-w-[120px] max-w-[160px] cursor-pointer whitespace-nowrap px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600 hover:bg-gray-200 transition-colors select-none"
						onclick={() => handleSort('source')}
					>
						<div class="flex items-center gap-1">
							Source
							{#if sortColumn === 'source'}
								{#if sortDirection === 'asc'}<ChevronUp class="h-3 w-3 text-gray-400" />{:else}<ChevronDown class="h-3 w-3 text-gray-400" />{/if}
							{/if}
						</div>
					</th>
					<th
						class="min-w-[120px] max-w-[180px] cursor-pointer whitespace-nowrap px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600 hover:bg-gray-200 transition-colors select-none"
						onclick={() => handleSort('endpoint')}
					>
						<div class="flex items-center gap-1">
							Endpoint
							{#if sortColumn === 'endpoint'}
								{#if sortDirection === 'asc'}<ChevronUp class="h-3 w-3 text-gray-400" />{:else}<ChevronDown class="h-3 w-3 text-gray-400" />{/if}
							{/if}
						</div>
					</th>
					<th
						class="min-w-[100px] max-w-[140px] cursor-pointer whitespace-nowrap px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600 hover:bg-gray-200 transition-colors select-none"
						onclick={() => handleSort('purpose')}
					>
						<div class="flex items-center gap-1">
							Purpose
							{#if sortColumn === 'purpose'}
								{#if sortDirection === 'asc'}<ChevronUp class="h-3 w-3 text-gray-400" />{:else}<ChevronDown class="h-3 w-3 text-gray-400" />{/if}
							{/if}
						</div>
					</th>
					<!-- Score column hidden to match mockup -->
					<!--
					<th
						class="w-20 whitespace-nowrap px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600"
					>
						Score
					</th>
					-->
					<th
						class="min-w-[180px] cursor-pointer whitespace-nowrap px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600 hover:bg-gray-200 transition-colors select-none"
						onclick={() => handleSort('summary')}
					>
						<div class="flex items-center gap-1">
							Summary
							{#if sortColumn === 'summary'}
								{#if sortDirection === 'asc'}<ChevronUp class="h-3 w-3 text-gray-400" />{:else}<ChevronDown class="h-3 w-3 text-gray-400" />{/if}
							{/if}
						</div>
					</th>
					<th
						class="w-28 cursor-pointer whitespace-nowrap px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600 hover:bg-gray-200 transition-colors select-none"
						onclick={() => handleSort('commId')}
					>
						<div class="flex items-center gap-1">
							Comm ID
							{#if sortColumn === 'commId'}
								{#if sortDirection === 'asc'}<ChevronUp class="h-3 w-3 text-gray-400" />{:else}<ChevronDown class="h-3 w-3 text-gray-400" />{/if}
							{/if}
						</div>
					</th>
					<!-- Pipeline column hidden to match mockup -->
					<!--
					<th
						class="w-24 whitespace-nowrap px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600"
					>
						Pipeline
					</th>
					-->
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
						<td colspan="9" class="px-3 py-8 text-center text-sm text-gray-500">
							No communications found
						</td>
					</tr>
				{:else}
					{#each filteredCommunications as comm}
						{@const commType = getTypeDisplay(comm)}
						{@const IconComponent = getTypeIcon(commType)}
						{@const contactDetail = comm.raw?.raw?.customer?.phone || comm.raw?.raw?.customer?.email || comm.raw?.raw?.communicationThread?.contact?.phone || comm.raw?.raw?.communicationThread?.contact?.email || comm.raw?.raw?.phoneNumber || (comm.direction === 'In' ? comm.raw?.raw?.source : comm.raw?.raw?.destination)}
						{@const dept = comm.raw?.metadata?.ivr_intent || comm.raw?.metadata?.intent}
						{@const hasEmail = Boolean(comm.type === 'email' || comm.typeIcon === 'email' || comm.raw?.payload?.email || comm.raw?.customerProfile?.email || (contactDetail && typeof contactDetail === 'string' && contactDetail.includes('@')) || (comm.source && comm.source.includes('@')))}
						<tr class="border-b border-gray-200 bg-white transition-colors hover:bg-gray-50/80">
							<td class="px-3 py-2.5 pt-4 align-top">
								<div
									class="h-4 w-4 shrink-0 rounded-full {getStatusColor(comm.status)}"
									title={comm.status}
								></div>
							</td>
							<td class="whitespace-nowrap px-3 py-2.5 text-sm text-gray-700">
								<div class="font-semibold text-gray-900">{comm.date}</div>
								<div class="text-xs text-gray-500 mt-0.5">{comm.time}</div>
							</td>
							<td class="whitespace-nowrap px-3 py-2.5">
								<div class="flex items-center gap-1.5 text-sm text-gray-700">
									<IconComponent class="h-4 w-4 shrink-0 text-gray-500" />
									<span class="font-medium">{comm.direction === 'Out' ? 'Out' : 'In'}</span>
								</div>
								{#if comm.type === 'email' && comm.emailOpenedAt}
									<div class="mt-0.5">
										<span
											class="inline-flex items-center rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-green-700"
											title="Opened: {new Date(comm.emailOpenedAt).toLocaleString()}"
										>
											Opened
										</span>
										{#if comm.emailClickedAt}
											<span
												class="ml-1 inline-flex items-center rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-blue-700"
											>
												Clicked
											</span>
										{/if}
									</div>
								{/if}
							</td>
							<td
								class="max-w-[160px] truncate px-3 py-2.5 text-sm text-gray-700"
							>
								{#if onProfileClick && comm.raw?.raw?.customer?.id}
									{@const profileId = comm.raw?.raw?.customer?.id}
									<button
										type="button"
										class="block max-w-full cursor-pointer truncate text-left font-semibold text-gray-900 hover:text-blue-600 hover:underline"
										title={comm.source}
										onclick={() => onProfileClick(comm)}
									>
										{comm.source || '—'}
									</button>
								{:else}
									<div class="font-semibold text-gray-900" title={comm.source}>{comm.source || '—'}</div>
								{/if}
								{#if contactDetail && contactDetail !== comm.source}
									<div class="text-xs text-gray-500 mt-0.5 truncate" title={contactDetail}>{contactDetail}</div>
								{/if}
							</td>
							<td class="max-w-[180px] px-3 py-2.5 text-sm text-gray-700">
								{#if comm.endpoint}
									<div class="font-medium text-gray-900 truncate" title={comm.endpoint}>{comm.endpoint}</div>
								{:else if showAssignButton && onAssignClick && !comm.raw?.isDropCall && comm.summary !== 'Dropped Call' && comm.commId && !comm.commId.startsWith('DROP-')}
									<div class="mt-0.5">
										<button
											type="button"
											class="text-left text-xs text-blue-600 underline hover:no-underline"
											onclick={() => onAssignClick(comm)}
										>
											Assign
										</button>
									</div>
								{/if}
								{#if comm.assignedMemberNames && comm.assignedMemberNames.length > 0}
									<div class="text-xs text-gray-500 mt-0.5 font-semibold text-gray-900" title={comm.assignedMemberNames.join(', ')}>
										{comm.assignedMemberNames.join(', ')}
									</div>
								{/if}
							</td>
							<td class="max-w-[140px] truncate px-3 py-2.5 text-sm text-gray-700">
								{#if comm.raw?.isDropCall}
									<span class="inline-flex items-center rounded bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">
										Dropped Call
									</span>
								{:else}
									<div class="flex flex-col items-start gap-1">
										{#if comm.purpose === 'Confirm' || comm.purpose === 'Confirm Email'}
											<button
												onclick={() => onConfirmClick ? onConfirmClick(comm) : onReplyClick?.(comm)}
												class="inline-block rounded bg-[#4A72B2] hover:bg-[#3b5d95] px-3.5 py-1 text-xs font-semibold text-white transition-colors"
											>
												{comm.purpose === 'Confirm Email' ? 'Confirm Email' : (comm.raw?.metadata?.confirm_action === 'call' ? 'Confirm call' : 'Confirm')}
											</button>
										{:else if comm.purpose}
											<span>{comm.purpose}</span>
										{:else}
											<span>—</span>
										{/if}
										{#if slaBadge(comm)}
											{@const sla = slaBadge(comm)}
											<span
												class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold leading-none {sla?.tone}"
												title="Emergency callback SLA — escalates if the tech doesn't call back in time"
											>
												🚨 {sla?.label}
											</span>
										{/if}
										{#if calendarGraceBadge(comm)}
											{@const cal = calendarGraceBadge(comm)}
											<span
												class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold leading-none {cal?.tone}"
												title="Waiting 15 minutes for calendar verification"
											>
												⏳ {cal?.label}
											</span>
											{#if cal?.label !== 'Verification Failed'}
												<button
													class="ml-1 inline-flex items-center justify-center rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-600 hover:bg-indigo-100 border border-indigo-200"
													title="Fast-forward timer for testing"
													onclick={(e) => { e.stopPropagation(); fastForwardTimer(comm); }}
												>
													⏭️ FF
												</button>
											{/if}
										{/if}
										{#if dept}
											<span class="inline-flex items-center rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700 leading-none">
												Dept: {dept}
											</span>
										{/if}
									</div>
								{/if}
							</td>
							<!-- Score hidden -->
							<!--
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
							-->
							<td class="max-w-[240px] px-3 py-2.5 text-sm">
								{#if comm.summary}
									<button
										type="button"
										class="text-blue-600 underline hover:no-underline font-semibold"
										onclick={() => handleSummaryClick(comm)}
									>
										Summary
									</button>
								{:else}
									<span class="text-gray-400">—</span>
								{/if}
							</td>
							<td
								class="max-w-[120px] truncate px-3 py-2.5 text-gray-700 text-sm"
								title={comm.commId ?? ''}
							>
								{#if comm.commId}
									<button
										type="button"
										class="text-left text-blue-600 hover:underline font-medium hover:text-blue-800"
										onclick={() => handleSummaryClick(comm)}
									>
										{comm.commId.startsWith('DROP-') ? comm.commId : 'COM-' + comm.commId.slice(-5).toUpperCase()}
									</button>
								{:else}
									<!-- No conversation anchor yet: threading resolves asynchronously, so showing a
									     code here would mint one that changes moments later. -->
									<span
										class="inline-flex items-center gap-1.5 text-gray-400 italic"
										title="Waiting for this message to be linked to a conversation"
									>
										<span class="h-1.5 w-1.5 animate-pulse rounded-full bg-gray-400"></span>
										Pending
									</span>
								{/if}
							</td>
							<!-- Pipeline hidden -->
							<!--
							<td class="whitespace-nowrap px-3 py-2.5">
								<div class="flex items-center gap-1.5">
									<button
										type="button"
										class="inline-flex items-center gap-1 rounded bg-indigo-50 px-2 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 transition-colors"
										onclick={() => onPipelineClick?.(comm)}
									>
										⚡ Pipeline
									</button>
									{#if onReplyClick}
										<button
											type="button"
											class="inline-flex items-center gap-1 rounded bg-sky-50 px-2 py-1 text-xs font-semibold text-sky-700 hover:bg-sky-100 transition-colors"
											onclick={() => onReplyClick(comm)}
										>
											<Reply class="h-3 w-3" /> Reply
										</button>
									{/if}
								</div>
							</td>
							-->
							<td class="px-3 py-2.5 text-right align-middle">
								<DropdownMenu.Root
									open={openDropdownId === comm.id}
									onOpenChange={(open) => {
										if (open) {
											openDropdownId = comm.id;
										} else if (openDropdownId === comm.id) {
											openDropdownId = null;
										}
									}}
								>
									<DropdownMenu.Trigger class="inline-flex h-7 w-7 items-center justify-center rounded-full border border-gray-400 hover:bg-gray-100">
										<span class="sr-only">Actions</span>
										<span class="flex gap-0.5">
											<span class="h-1 w-1 rounded-full bg-gray-500"></span>
											<span class="h-1 w-1 rounded-full bg-gray-500"></span>
											<span class="h-1 w-1 rounded-full bg-gray-500"></span>
										</span>
									</DropdownMenu.Trigger>
									<DropdownMenu.Content align="end" class="w-40">
										<DropdownMenu.Item onclick={() => handleActionClick('view', comm)}>
											View Details
										</DropdownMenu.Item>
										<DropdownMenu.Item onclick={() => onViewLogClick?.(comm)}>
											View Log
										</DropdownMenu.Item>
										<DropdownMenu.Item onclick={() => handleActionClick('call', comm)}>
											Call
										</DropdownMenu.Item>
										<DropdownMenu.Item onclick={() => handleActionClick('sms', comm)}>
											SMS
										</DropdownMenu.Item>
										{#if hasEmail}
										<DropdownMenu.Item class="text-red-600 focus:text-red-600 focus:bg-red-50" onclick={() => handleActionClick('email', comm)}>
											Email
										</DropdownMenu.Item>
										{/if}
									</DropdownMenu.Content>
								</DropdownMenu.Root>
							</td>
						</tr>
					{/each}
				{/if}
			</tbody>
		</table>
	</div>
</div>
