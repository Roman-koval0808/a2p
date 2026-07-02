<script lang="ts">
	import { onMount } from 'svelte';
	import { Search, Mic, ChevronDown, ChevronLeft, ChevronRight, Calendar } from 'lucide-svelte';
	import CommunicationTable from '$lib/components/CommunicationTable.svelte';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index';
	import CommunicationSummaryDialog from '$lib/components/communication-summary-dialog.svelte';
	import NotificationsDialog from '$lib/components/notifications/notifications-dialog.svelte';
	import PipelineModal from '$lib/components/PipelineModal.svelte';
	import CommReplyPanel from '$lib/components/CommReplyPanel.svelte';
	import AssignAgentDialog from '$lib/components/assign-agent-dialog.svelte';
	import BookingCalendarDialog from '$lib/components/booking-calendar-dialog.svelte';
	import { toast } from 'svelte-sonner';
	import { invalidate, invalidateAll, goto } from '$app/navigation';

	onMount(() => {
		const interval = setInterval(() => {
			// Pause the background refresh while the user is interacting with a dialog
			// or panel (e.g. typing a reply) so we don't disrupt input or clobber state.
			if (
				summaryDialogOpen ||
				replyPanelOpen ||
				assignDialogOpen ||
				pipelineDialogOpen ||
				notificationsDialogOpen ||
				bookingDialogOpen
			) {
				return;
			}
			// Only re-run this page's loader (it calls depends('app:communication-log')),
			// not every loader in the app as invalidateAll() would.
			invalidate('app:communication-log');
		}, 4000);
		return () => clearInterval(interval);
	});

	const PAGE_SIZES = [10, 20, 50, 100] as const;

	// First non-empty candidate, capitalized. Used so the summary dialog always shows a meaningful
	// Category / Sub-Category instead of a blank.
	function capLabel(...vals: any[]): string {
		for (const v of vals) {
			const s = (v ?? '').toString().trim();
			if (s) return s.charAt(0).toUpperCase() + s.slice(1);
		}
		return '';
	}

	const filters = [
		'All',
		'Email',
		'SMS',
		'Voice',
		'Web',
		'Facebook',
		'Chatbot',
		'Leadform',
		'Leadbox'
	];
	let searchQuery = $state('');
	let selectedAgentName = $state<string | null>(null);

	let summaryDialogOpen = $state(false);
	let selectedComm = $state<(typeof communications)[0] | null>(null);
	let notificationsDialogOpen = $state(false);
		let pipelineDialogOpen = $state(false);
	let selectedPipelineEvent = $state<any>(null);
	let selectedEndpoint = $state<string | null>(null);
	let selectedCommId = $state<string | null>(null);
	let assignDialogOpen = $state(false);
	let preSelectedAgents = $state<string[]>([]);
	
	// Reply panel state
	let replyPanelOpen = $state(false);
	let replyComm = $state<any>(null);
	let replyType = $state<'sms' | 'email'>('sms');

	// Booking calendar popup
	let bookingDialogOpen = $state(false);

	let { data } = $props<{
		data: {
			user?: { name?: string | null } | null;
			logs: any[];
			members?: Array<{ id: string; name: string; email: string; role: string }>;
			useA2pCommLog?: boolean;
			totalCount?: number | null;
			limit?: number;
			page?: number;
			bookingUrl?: string | null;
			googleCalendar?: { connected: boolean; email: string | null };
		};
	}>();
	const members = $derived(data.members ?? []);
	const limit = $derived(data.limit ?? 20);
	const page = $derived(data.page ?? 1);
	const totalCount = $derived(data.totalCount ?? null);
	const totalPages = $derived(
		totalCount != null ? Math.max(1, Math.ceil(totalCount / limit)) : null
	);
	const start = $derived((page - 1) * limit + 1);
	const end = $derived(
		totalCount != null
			? Math.min(page * limit, totalCount)
			: (page - 1) * limit + (data.logs?.length ?? 0)
	);
	const hasPrev = $derived(page > 1);
	const hasNext = $derived(
		totalPages != null ? page < totalPages : (data.logs?.length ?? 0) >= limit
	);

	const greeting = $derived.by(() => {
		const h = new Date().getHours();
		return h < 12 ? 'Good Morning' : h < 18 ? 'Good Afternoon' : 'Good Evening';
	});

	function goToPage(p: number, l?: number) {
		const params = new URLSearchParams();
		params.set('limit', String(l ?? limit));
		if (p > 1) params.set('page', String(p));
		goto(`/communication-log?${params.toString()}`);
	}

	// Transform API data to UI format
	let communications = $derived(
		data.logs?.map((log: any) => {
			const dateObj = new Date(log.created);
			const date = dateObj.toLocaleDateString('en-US', {
				month: 'short',
				day: '2-digit',
				year: 'numeric'
			});
			const time = dateObj.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

			// Get assigned member names from the pre-mapped property provided by +page.server.ts
			const assignedMemberNames = log.assignedMemberNames || [];

			// Urgency (1–5): high → red, mid → blue, low → green.
			// Prefer the numeric urgency_gpt from the a2p pipeline; fall back to the legacy
			// analyzeCallLog string urgency (low/medium/high) that voice & SMS logs store, so
			// those also get urgency coloring instead of always falling through to in/out.
			const meta = log.metadata || {};
			const legacyUrgency: Record<string, number> = { low: 2, medium: 3, high: 5 };
			const urgencyGpt =
				typeof meta.urgency_gpt === 'number'
					? meta.urgency_gpt
					: typeof meta.urgency === 'string'
						? (legacyUrgency[meta.urgency.toLowerCase()] ?? null)
						: null;

			// The IVR digit the caller pressed is a deliberate signal: 2 = Sales (an
			// opportunity to act on fast), 1 = Billing, 3 = Support. Flag Sales as an
			// opportunity (blue) even when the transcript urgency is low.
			const ivrDigit = meta.ivr_digit != null ? String(meta.ivr_digit) : '';
			const ivrIntentLower = (meta.ivr_intent ?? '').toString().toLowerCase();
			const isSalesIntent =
				ivrDigit === '2' || ivrIntentLower.includes('sales') || ivrIntentLower.includes('booking');

			let status: string;
			if (log.isDropCall || meta.drop_call) status = 'red';
			else if (meta.message_category === 'emergency') status = 'red';
			else if (urgencyGpt !== null && urgencyGpt >= 4) status = 'red';
			else if (urgencyGpt !== null && urgencyGpt >= 3) status = 'blue';
			else if (isSalesIntent) status = 'blue';
			else if (urgencyGpt !== null) status = 'green';
			else status = log.direction === 'inbound' ? 'in' : 'out';
			// Purpose: category_gpt or legacy intent/sentiment; prefix "Urgent " when urgency_gpt >= 4
			const cap = (s: string) =>
				(s ?? '').charAt(0).toUpperCase() + (s ?? '').slice(1).toLowerCase();
			const urgentPrefix = urgencyGpt !== null && urgencyGpt >= 4 ? 'Urgent ' : '';
			let purpose: string;
			if (log.isDropCall) {
				purpose = 'Dropped Call';
			} else if (meta.drop_call) {
				purpose = 'Missed Call';
			} else if (log.raw?.status === 'pending_approval') {
				purpose = 'Confirm';
			} else if (meta.message_category) {
				// The orchestrator reclassifies the call by what was actually said; show that.
				purpose =
					meta.message_category === 'emergency'
						? 'Urgent Support'
						: meta.message_category === 'sales'
							? 'Sales Opportunity'
							: cap(meta.message_category);
			} else if (meta.category_gpt) {
				purpose = urgentPrefix + cap(meta.category_gpt);
			} else if (meta.ivr_intent) {
				purpose = urgentPrefix + (isSalesIntent ? 'Sales Opportunity' : cap(meta.ivr_intent));
			} else if (meta.intent || meta.sentiment) {
				const word = meta.intent
					? cap(meta.intent)
					: meta.sentiment
						? cap(meta.sentiment)
						: 'General';
				purpose = urgentPrefix + word;
			} else {
				purpose = log.summary ? urgentPrefix + 'See Summary' : urgentPrefix + 'General';
			}

			return {
				date,
				time,
				type: log.direction === 'inbound' ? 'In' : 'Out',
				typeIcon: log.type,
				source: log.source,
				endpoint: log.destination,
				purpose,
				summary: log.summary || log.content || 'No content',
				commId: log.commId,
				id: log.id,
				status,
				assignedMemberNames,
				raw: log
			};
		}) || []
	);

	// Transform to CommunicationTable format
	let tableCommunications = $derived(
		communications.map((c: any) => ({
			id: c.id || c.raw?.id || '',
			date: c.date,
			time: c.time,
			type: c.typeIcon as any,
			typeIcon: c.typeIcon,
			direction: c.type as 'In' | 'Out',
			source: c.source,
			endpoint: c.endpoint,
			purpose: c.purpose,
			summary: c.summary,
			commId: c.commId,
			status: c.status as any,
			assignedMemberNames: c.assignedMemberNames,
			raw: c.raw
		}))
	);

	function handleSummaryClick(comm: any) {
		// Use the transformed comm object, not raw, so we have all the formatted fields
		selectedComm = comm;
		summaryDialogOpen = true;
	}

	function handleActionClick(action: string, comm: any) {
		if (action === 'sms' || action === 'reply' || action === 'email') {
			replyComm = comm;
			replyType = action === 'email' ? 'email' : 'sms';
			replyPanelOpen = true;
		} else if (action === 'call') {
			// comm.raw is the mapped log; comm.raw.source/destination have been remapped to a
			// display *name* for known contacts, so resolve the real phone number from the
			// underlying record (comm.raw.raw) instead.
			const log = comm.raw?.raw ?? comm.raw ?? {};
			const isInbound = (comm.raw?.direction ?? log.direction) === 'inbound';
			let phone =
				log.customer?.phone ||
				(isInbound ? log.source : log.destination) ||
				comm.raw?.payload?.phone ||
				comm.raw?.payload?.customer_phone ||
				comm.raw?.customerProfile?.phone ||
				'';

			// Guard against dialing a display name (no digits) that slipped through.
			if (phone && !/\d/.test(phone)) phone = '';

			if (phone) {
				goto(`/dialer?phone=${encodeURIComponent(phone)}&call=true`);
			} else {
				toast.error('No phone number available');
			}
		} else if (action === 'view') {
			handleSummaryClick(comm);
		} else {
			console.log('Action:', action, 'for comm:', comm);
		}
	}

	function handleReplyClick(comm: any) {
		replyComm = comm;
		replyPanelOpen = true;
	}

	function handleAssignClick(comm: any) {
		selectedEndpoint = comm.endpoint;
		selectedCommId = comm.id;
		preSelectedAgents = comm.assignedMemberNames || [];
		assignDialogOpen = true;
	}

	async function handleAssign(selectedAgents: string[]) {
		if (!selectedCommId) return;
		const loadingId = toast.loading('Assigning agent...');
		try {
			const agent = selectedAgents[0] ?? null;
			const res = await fetch(`/api/communication-logs/${selectedCommId}/assign`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					status: agent ? 'assigned_to_agent' : 'unassigned',
					assignedAgent: agent
				})
			});
			const result = await res.json();
			if (result.success) {
				toast.success('Agent assigned successfully', { id: loadingId });
				await invalidateAll();
			} else {
				toast.error(result.error || 'Failed to assign agent', { id: loadingId });
			}
		} catch (e) {
			console.error(e);
			toast.error('Failed to assign agent', { id: loadingId });
		}
	}

	function handlePipelineClick(comm: any) {
		selectedPipelineEvent = comm.raw;
		pipelineDialogOpen = true;
	}

	async function handleConfirmClick(comm: any) {
		const loadingId = toast.loading('Confirming communication...');
		try {
			const res = await fetch(`/api/communication-logs/${comm.id}/confirm`, {
				method: 'POST'
			});
			const result = await res.json();
			if (result.success) {
				toast.success('Communication confirmed and dispatched', { id: loadingId });
				await invalidateAll();
			} else {
				toast.error(result.error || 'Failed to confirm', { id: loadingId });
			}
		} catch (e) {
			console.error(e);
			toast.error('Failed to confirm communication', { id: loadingId });
		}
	}
</script>

<div class="flex w-full min-w-0 flex-col">
	<!-- Header: greeting, search, agent picker (same row) -->
	<div
		class="flex flex-wrap items-center justify-between gap-4 border-b border-gray-200 bg-white px-6 py-4"
	>
		<div class="flex items-center gap-4">
			<img src="/img/profile.png" alt="" class="h-12 w-12 rounded-full object-cover" />
			<div>
				<h2 class="text-lg font-semibold text-gray-900">
					{greeting}, {data.user?.name ?? 'User'}!
				</h2>
				<p class="text-sm text-gray-500">Simplify how you manage calls and messages.</p>
			</div>
		</div>
		<div class="flex flex-1 items-center justify-end gap-4">
			<div
				class="flex h-10 w-full min-w-[200px] max-w-sm items-center gap-2 rounded-lg border border-gray-300 bg-white px-3"
			>
				<Search class="h-4 w-4 shrink-0 text-gray-500" />
				<input
					type="text"
					bind:value={searchQuery}
					placeholder="Search communications..."
					class="min-w-0 flex-1 border-0 bg-transparent text-sm outline-none placeholder:text-gray-400"
				/>
				<Mic class="h-4 w-4 shrink-0 text-gray-500" />
			</div>
			<button
				type="button"
				onclick={() => (bookingDialogOpen = true)}
				class="flex h-10 items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
				title="Booking calendar"
			>
				<Calendar class="h-4 w-4 shrink-0 text-blue-600" />
				<span>Calendar</span>
				{#if !data.bookingUrl && !data.googleCalendar?.connected}
					<span class="h-2 w-2 rounded-full bg-yellow-400" title="Not set up"></span>
				{/if}
			</button>
			{#if members.length > 0}
				<DropdownMenu.Root>
					<DropdownMenu.Trigger
						class="ml-auto flex h-10 min-w-[140px] items-center justify-between gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
					>
						<span>Agents</span>
						<ChevronDown class="h-4 w-4 shrink-0 text-gray-500" />
					</DropdownMenu.Trigger>
					<DropdownMenu.Content
						class="max-h-[min(60vh,400px)] min-w-[180px] overflow-y-auto"
						align="end"
						side="bottom"
						sideOffset={6}
						collisionPadding={12}
					>
						<DropdownMenu.Item class="cursor-pointer" onSelect={() => (selectedAgentName = null)}>
							All agents
						</DropdownMenu.Item>
						<DropdownMenu.Separator />
						{#each members as member}
							<DropdownMenu.Item
								class="cursor-pointer hover:text-white"
								onSelect={() => (selectedAgentName = member.name)}
							>
								{member.name}
							</DropdownMenu.Item>
						{/each}
					</DropdownMenu.Content>
				</DropdownMenu.Root>
			{/if}
		</div>
	</div>

	<div class="flex min-w-0 flex-1 flex-col p-4">
		{#if !data.bookingUrl && !data.googleCalendar?.connected}
			<div
				class="mb-4 flex items-center gap-2 rounded-lg border border-yellow-300 bg-yellow-50 px-4 py-3 text-sm font-medium text-yellow-800"
			>
				<Calendar class="h-4 w-4 shrink-0" />
				<span>
					Booking calendar not set up — the AI can't book appointments yet.
					<a class="underline" href="/settings/company">Connect Google Calendar in Company settings.</a>
				</span>
			</div>
		{/if}
		<CommunicationTable
			communications={tableCommunications}
			{filters}
			bind:searchQuery
			{selectedAgentName}
			onSummaryClick={handleSummaryClick}
			onActionClick={handleActionClick}
			onAssignClick={handleAssignClick}
			onPipelineClick={handlePipelineClick}
			onReplyClick={handleReplyClick}
			onConfirmClick={handleConfirmClick}
			showAssignButton={true}
			showSearch={false}
		/>
		<!-- Pagination -->
		<div
			class="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 pt-4"
		>
			<div class="flex items-center gap-4">
				<span class="text-sm text-gray-600">Per page</span>
				<div class="flex gap-1">
					{#each PAGE_SIZES as size}
						<button
							type="button"
							class="rounded px-2.5 py-1 text-sm font-medium transition-colors {limit === size
								? 'bg-slate-900 text-white'
								: 'text-gray-600 hover:bg-gray-100'}"
							onclick={() => goToPage(1, size)}
						>
							{size}
						</button>
					{/each}
				</div>
			</div>
			<div class="flex items-center gap-3">
				{#if totalCount != null}
					<span class="text-sm text-gray-600">
						Showing {start}–{end} of {totalCount}
					</span>
				{:else}
					<span class="text-sm text-gray-600">
						Showing {start}–{end}
					</span>
				{/if}
				<div class="flex gap-1">
					<button
						type="button"
						class="rounded border border-gray-300 bg-white px-2.5 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:pointer-events-none disabled:opacity-50"
						disabled={!hasPrev}
						onclick={() => goToPage(page - 1)}
						aria-label="Previous page"
					>
						<ChevronLeft class="h-4 w-4" />
					</button>
					<button
						type="button"
						class="rounded border border-gray-300 bg-white px-2.5 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:pointer-events-none disabled:opacity-50"
						disabled={!hasNext}
						onclick={() => goToPage(page + 1)}
						aria-label="Next page"
					>
						<ChevronRight class="h-4 w-4" />
					</button>
				</div>
			</div>
		</div>
	</div>
</div>

{#if selectedComm}
	{@const meta = selectedComm.raw?.metadata ?? {}}
	{@const hasRecordingId = selectedComm.raw?.type === 'voice' && meta.recording_id}
	{@const recordingUrl = hasRecordingId
		? `/api/recording/${selectedComm.id || selectedComm.raw?.id}`
		: typeof meta.recording_urls === 'object' && meta.recording_urls !== null
			? (meta.recording_urls.mp3 ??
				meta.recording_urls.m4a ??
				Object.values(meta.recording_urls).find(
					(v) => typeof v === 'string' && v.startsWith('http')
				))
			: (meta.voicemail_url ?? null)}
	{@const ivrDigit = meta.ivr_digit != null ? String(meta.ivr_digit) : ''}
	{@const ivrIntentLabel = (meta.ivr_intent ?? '').toString()}
	{@const calledNumber = (selectedComm.raw?.raw?.destination ?? selectedComm.endpoint ?? '')
		.toString()
		.replace(/\s*\([^)]*\)\s*$/, '')
		.trim()}
	{@const leftMessage = Boolean(recordingUrl || meta.recording_id || meta.recording_urls)}
	{@const ivrPath =
		selectedComm.raw?.type === 'voice' && selectedComm.raw?.direction === 'inbound'
			? [
					calledNumber ? `Called ${calledNumber}` : null,
					ivrDigit
						? `Pressed ${ivrDigit}${ivrIntentLabel ? ` (${ivrIntentLabel})` : ''}`
						: ivrIntentLabel || null,
					leftMessage ? 'Voicemail left' : null
				]
					.filter(Boolean)
					.join(' · ') || null
			: null}
	<CommunicationSummaryDialog
		bind:open={summaryDialogOpen}
		commId={selectedComm.commId || selectedComm.raw?.id || ''}
		date={selectedComm.date}
		time={selectedComm.time}
		category={selectedComm.isDropCall
			? ''
			: capLabel(meta.message_category, meta.category_gpt, meta.intent, meta.sentiment) || 'General'}
		subCategory={selectedComm.isDropCall
			? ''
			: capLabel(meta.subcat_gpt, meta.sub_intent, meta.urgency) || 'General'}
		sourceLabel={selectedComm.raw?.type === 'email' ? 'Email Address' : 'Phone'}
		email={selectedComm.source ?? ''}
		subject={selectedComm.raw?.metadata?.subject || selectedComm.raw?.subject || 'No subject'}
		body={selectedComm.raw?.content || selectedComm.summary || ''}
		summary={selectedComm.summary}
		tasks={meta.actionItems ?? meta.tasks ?? []}
		{recordingUrl}
		estimatedPrice={meta.estimatedPrice ?? null}
		draftedMessage={selectedComm.raw?.draftResponse || selectedComm.raw?.payload?.draftResponse || selectedComm.raw?.payload?.draft_reply || null}
		department={meta.ivr_intent || meta.intent || null}
		{ivrPath}
	/>
{/if}

<NotificationsDialog bind:open={notificationsDialogOpen} />

<BookingCalendarDialog
	bind:open={bookingDialogOpen}
	bookingUrl={data.bookingUrl ?? ''}
	googleConnected={data.googleCalendar?.connected ?? false}
	googleEmail={data.googleCalendar?.email ?? null}
/>


<PipelineModal bind:open={pipelineDialogOpen} event={selectedPipelineEvent} />

<CommReplyPanel
	bind:open={replyPanelOpen}
	comm={replyComm}
	user={data.user}
	{replyType}
	onClose={() => {
		replyPanelOpen = false;
		replyComm = null;
	}}
/>

<AssignAgentDialog
	bind:open={assignDialogOpen}
	endpointName={selectedEndpoint || 'Conversation'}
	agents={members.map((m: { name: string }) => m.name)}
	preSelectedAgents={preSelectedAgents}
	onAssign={handleAssign}
/>
