<script lang="ts">
	import { subtopicLabel, formatDescriptiveIntent } from '$lib/utils/subtopic-labels';
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
		channelSource?: string | null;
		channelSourceDetail?: string | null;
		engagementId?: string | null;
		sessionId?: string | null;
		profileId?: string | null;
		profileName?: string | null;
		profileTier?: string | null;
		profileWho?: string | null;
		intentStatus?: string | null;
		intentStage?: string | null;
		intentSubtopic?: string | null;
		intentDescription?: string | null;
		intentEmergency?: boolean;
		intentConfidence?: string | null;
		threadSubtopics?: string[];
		isProcessing?: boolean;
		isInternalNotice?: boolean;
		journey?: { segments: { text: string; bold: boolean }[]; full: string };
		threadSubtopicScores?: Record<string, number> | null;
		threadEngagementScore?: number | null;
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
			'Web',
			'Voice',
			'SMS',
			'Email',
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
	let openDropdownId = $state<string | null>(null);

	let sortColumn = $state<string | null>('date');
	let sortDirection = $state<'asc' | 'desc'>('desc');

	// Column-protocol drawer (the ⓘ on each header).
	let openColKey = $state<string | null>(null);

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

	function slaBadge(comm: any): { label: string; tone: string } | null {
		const m = comm?.raw?.metadata;
		if (!m?.is_emergency_dispatch || !m?.sla_due_at) return null;
		if (m.sla_status === 'met') return { label: 'SLA met', tone: 'done' };
		const dueMs = new Date(m.sla_due_at).getTime();
		const remaining = dueMs - nowMs;
		if (remaining <= 0) return { label: 'SLA BREACHED', tone: 'block' };
		const mm = Math.floor(remaining / 60000);
		const ss = Math.floor((remaining % 60000) / 1000);
		return {
			label: `SLA ${mm}:${String(ss).padStart(2, '0')}`,
			tone: remaining <= 120000 ? 'wait' : 'sched'
		};
	}

	function calendarGraceBadge(comm: any): { label: string; tone: string } | null {
		const m = comm?.raw?.metadata;
		if (!m?.waiting_for_calendar || !m?.timer_due_at) return null;
		const dueMs = new Date(m.timer_due_at).getTime();
		const remaining = dueMs - nowMs;
		if (remaining <= 0) return { label: 'Verification Failed', tone: 'block' };
		const mm = Math.floor(remaining / 60000);
		const ss = Math.floor((remaining % 60000) / 1000);
		return { label: `Verifying... ${mm}:${String(ss).padStart(2, '0')}`, tone: 'prog' };
	}

	const filteredCommunications = $derived.by(() => {
		// Rows the AI pipeline has not finished interpreting are held back rather than shown with a
		// status that is about to change. An emergency leadbox first rendered green (the row's own
		// delivery status) and flipped to red seconds later when the pipeline set the urgency — the
		// row was not wrong, it was incomplete, and showing it as settled was the bug.
		let filtered = communications.filter(
			(comm) => !comm.isProcessing && !comm.isInternalNotice
		);
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
					aVal = channelLabel(a).toLowerCase();
					bVal = channelLabel(b).toLowerCase();
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

	const CHANNEL_ICONS: Record<string, string> = {
		email: '✉️',
		sms: '💬',
		voice: '📞',
		web: '🌐',
		facebook: '📘',
		chatbot: '🤖',
		leadform: '📝',
		leadbox: '💬',
		viewroom: '▶️'
	};

	const CHANNEL_LABELS: Record<string, string> = {
		email: 'Email',
		sms: 'SMS',
		voice: 'Voice',
		web: 'Web',
		facebook: 'Facebook',
		chatbot: 'Chatbot',
		leadform: 'Leadform',
		leadbox: 'Leadbox',
		viewroom: 'Viewroom'
	};

	function channelIcon(comm: Communication): string {
		const t = (comm.type || comm.typeIcon || '').toLowerCase();
		return CHANNEL_ICONS[t] || '🌐';
	}

	function channelLabel(comm: Communication): string {
		const t = (comm.type || comm.typeIcon || '').toLowerCase();
		return CHANNEL_LABELS[t] || comm.type || 'Web';
	}

	function statusDotClass(status: string): string {
		switch (status) {
			case 'red':
				return 'dot red';
			case 'green':
				return 'dot green';
			case 'blue':
				return 'dot blue';
			case 'in':
				return 'dot green';
			case 'out':
				return 'dot red';
			default:
				return 'dot';
		}
	}

	function tierClass(tier: string | null | undefined): string {
		const t = (tier ?? '').replace(/\s/g, '').toUpperCase();
		if (t === 'T1' || t === 'TIER1') return 't1';
		if (t === 'T2' || t === 'TIER2') return 't2';
		return 't2b';
	}

	// The badge used to read "T1" / "T2" / "2B", which means nothing unless you already know the
	// tier model. Spell it out.
	function tierLabel(tier: string | null | undefined): string {
		const t = (tier ?? '').replace(/\s/g, '').toUpperCase();
		if (t === 'T1' || t === 'TIER1') return 'Tier 1';
		if (t === 'T2' || t === 'TIER2') return 'Tier 2';
		return 'Tier 2B';
	}

	// What the customer actually wants, in descriptive words.
	//
	// Shows the rich descriptive intent (e.g. "Quote: Plumbing pipe renovation", "Quote: Bathroom renovation",
	// "Vehicle Purchase / Test Drive", "Inquiry: Business Hours", "Emergency: Roof leak") rather than
	// a bare single word like "Quote", "Sales", "Support", or "General".
	function intentLine(comm: any): string | null {
		return comm?.intentDescription || formatDescriptiveIntent(comm);
	}

	/** True when the purpose line would only repeat what the intent line already said. */
	function purposeIsRedundant(comm: any): boolean {
		const line = intentLine(comm);
		if (!line) return false;
		const purpose = (comm?.purpose ?? '').toString().trim();
		if (!purpose || purpose === 'Urgent Support' || purpose === 'Quote' || purpose === 'General' || purpose === 'See Summary') {
			return true;
		}
		return line.toLowerCase().includes(purpose.toLowerCase());
	}

	function stageClass(stage: string | null | undefined): string {
		switch ((stage ?? '').toLowerCase()) {
			case 'emergency':
				return 'emergency';
			case 'active':
				return 'active';
			case 'comparison':
				return 'comparison';
			case 'research':
				return 'research';
			default:
				return 'na';
		}
	}

	function cap(s: string | null | undefined): string {
		const v = (s ?? '').trim();
		if (!v) return '—';
		const lower = v.toLowerCase();
		const pretty: Record<string, string> = {
			water_heater: 'Water Heater',
			'water heater': 'Water Heater',
			hvac: 'HVAC',
			emergency: 'Emergency'
		};
		if (pretty[lower]) return pretty[lower];
		return v.charAt(0).toUpperCase() + v.slice(1);
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
		openDropdownId = null;
	}

	// ── Column protocols (the ⓘ drawers) ──────────────────────────────────────
	const COLS: Record<string, { title: string; what: string; src: string; logic: string[] }> = {
		date: {
			title: 'Date & Time',
			what: 'When the session started.',
			src: 'The timestamp of the first interaction in the session, stored ISO 8601 in UTC.',
			logic: [
				'A session opens on the first activity and this stamps it.',
				'Web: a NEW session opens only after the inactivity window (~30 min) — a return after that is a new session.',
				'Phone / SMS / Email: the session is bounded by that call or exchange.',
				'We record when the session STARTED, not last activity.'
			]
		},
		channel: {
			title: 'Channel & Source',
			what: 'One column, two stacked facts: the Channel (HOW it happened, on top) and the Source (WHERE it came from, underneath).',
			src: 'Channel = the transport (web pixel, Telnyx voice/SMS, email). Source = the origin: web referrer + UTM, the tracking number / caller ID / GBP for phone, or the origin address/campaign for email & SMS.',
			logic: [
				'CHANNEL (top) = the medium + direction: Web, Voice, SMS, Email, Facebook, Chatbot, Leadform · IN if we received it, OUT if we initiated it.',
				'SOURCE (under) = where it came from — one of the provider channels. Source is NOT the person (that is the Profile column).',
				'Source is the strongest EARLY clue to intent: it sets the intent prior (Google/Bing Search = high; social/video = low).'
			]
		},
		intent: {
			title: 'Intent',
			what: 'What the visitor is trying to do — a structure: buying stage + urgency + subtopic + status.',
			src: 'A prior from Channel + Source, refined by the Journey behaviour and signals, and read retrospectively at session close.',
			logic: [
				'Buying stage: research → comparison → active — escalate-only.',
				'Emergency is a SEPARATE urgency flag, not a stage.',
				'Status lifecycle: ad_indicated → behaviour_supported / inferred → declared → confirmed, or contradicted.',
				'The channel is only the opening hypothesis; the proof is the Journey + Signals.'
			]
		},
		profile: {
			title: 'Profile ID · Who',
			what: 'Our best current answer to WHO this is — the Profile the session resolves to.',
			src: 'The profile database: a device fingerprint while anonymous; a company or display name when partial; a named person with email/phone once an identifier is captured.',
			logic: [
				'Tier 2B: anonymous — a device only, not a person.',
				'Tier 2: a company or display name is known, but not the individual.',
				'Tier 1: identified — name + email/phone on file.',
				'It upgrades over time: 2B → 1 the moment a form, call, or token supplies an identifier.',
				'Source says where they came from; this says who they are — the Profile ID is the stable key everything hangs off.'
			]
		},
		endpoint: {
			title: 'Endpoint',
			what: 'WHERE it was received, sent or transferred — the touchpoint on OUR side.',
			src: 'Web: the landing-page URL. Phone: the number dialled plus the IVR/transfer path. Email/SMS: our inbox or number.',
			logic: [
				'A web endpoint = the landing page, which is strong Intent evidence.',
				'A phone endpoint can be a PATH, not a point: Main number → IVR → Sales → Voicemail.',
				'Ties to call-binding — which number or rep was involved.'
			]
		},
		journey: {
			title: 'Journey & Activity',
			what: 'The ordered interactions in the session (Journey) and the measurable behaviour (Activity).',
			src: 'Every interaction the pixel, telephony or email system logs within the session, and the signals each one generates.',
			logic: [
				'Session-bounded — the Journey never spans sessions; the Engagement is what crosses them.',
				'Journey contains Activities; Activities generate Signals; Signals feed scoring.',
				'Original interactions and observed signals are immutable.'
			]
		},
		eng: {
			title: 'Engagement ID',
			what: 'The business episode this session belongs to (with the Session ID beneath it).',
			src: 'Resolved when the session is logged, by the engagement-resolution rules — recorded with a reason and rules_version.',
			logic: [
				'Engagement = one business episode with the customer, which crosses sessions and channels.',
				'Resolution is evidence before time: explicit project/quote/case ref → active (open) engagement → most recent within the inactivity window → else a NEW engagement.',
				'A subtopic change never splits an engagement — it is recorded as a tag on it.',
				'Session ID (SES-) is permanent and is never rewritten, even on a merge.'
			]
		},
		summary: {
			title: 'Summary',
			what: 'The complete operational overview of the session — narrative, requests, tasks, actions, status, next step.',
			src: 'AI interpretation (meaning) + Orchestrator decisions, built on the Journey. Tasks and Actions live in their own tables; the Summary references them.',
			logic: [
				'AI interprets meaning; it does NOT decide the next step — the Orchestrator does.',
				'A presentation layer, versioned — not the authoritative record.',
				'Shows completed, scheduled, blocked and failed work — nothing hidden.'
			]
		}
	};

	function openCol(key: string) {
		openColKey = key;
	}

	function closeCol() {
		openColKey = null;
	}
</script>

<div class="clog">
	{#if showFilters}
		<div class="tabs">
			{#each filters as filter}
				{@const count =
					filter === 'All'
						? communications.length
						: communications.filter(
								(c) => (c.type || c.typeIcon || '').toLowerCase() === filter.toLowerCase()
							).length}
				<button
					type="button"
					class="tab {activeFilter === filter ? 'on' : ''}"
					onclick={() => (activeFilter = filter)}
				>
					{filter}<span class="n">{count}</span>
				</button>
			{/each}
		</div>
	{/if}

	<div class="scroll">
		<table>
			<thead>
				<tr>
					<th></th>
					<th class="sortable" onclick={() => handleSort('date')}>
						Date <button type="button" class="ci" onclick={(e) => { e.stopPropagation(); openCol('date'); }}>i</button>
					</th>
					<th class="sortable" onclick={() => handleSort('type')}>
						Channel &amp; Source <button type="button" class="ci" onclick={(e) => { e.stopPropagation(); openCol('channel'); }}>i</button>
					</th>
					<th>Intent <button type="button" class="ci" onclick={() => openCol('intent')}>i</button></th>
					<th>Profile ID · Who <button type="button" class="ci" onclick={() => openCol('profile')}>i</button></th>
					<th class="sortable" onclick={() => handleSort('endpoint')}>
						Endpoint <button type="button" class="ci" onclick={(e) => { e.stopPropagation(); openCol('endpoint'); }}>i</button>
					</th>
					<th>Journey &amp; Activity <button type="button" class="ci" onclick={() => openCol('journey')}>i</button></th>
					<th>Engagement ID <button type="button" class="ci" onclick={() => openCol('eng')}>i</button></th>
					<th class="sortable" onclick={() => handleSort('summary')}>
						Summary <button type="button" class="ci" onclick={(e) => { e.stopPropagation(); openCol('summary'); }}>i</button>
					</th>
					<th></th>
				</tr>
			</thead>
			<tbody>
				{#if filteredCommunications.length === 0}
					<tr>
						<td colspan="10" class="empty">No communications on this channel.</td>
					</tr>
				{:else}
					{#each filteredCommunications as comm}
						{@const tierCls = tierClass(comm.profileTier)}
						{@const isEmergency = comm.intentEmergency || comm.raw?.metadata?.message_category === 'emergency'}
						{@const signals = Array.isArray(comm.raw?.metadata?.signals) ? comm.raw.metadata.signals : []}
						{@const hasEmail = Boolean(comm.type === 'email' || comm.typeIcon === 'email' || comm.raw?.payload?.email || (comm.source && comm.source.includes('@')))}
						<tr class="row" onclick={() => handleSummaryClick(comm)}>
							<td><span class={statusDotClass(comm.status)}></span></td>
							<td class="date">
								<b>{comm.date}</b><span>{comm.time}</span>
							</td>
							<td>
								<div class="chan">
									<span class="cico">{channelIcon(comm)}</span>
									<div>
										<b>{channelLabel(comm)}</b>
										<span class="dir {comm.direction === 'Out' ? 'out' : 'in'}">{comm.direction === 'Out' ? 'OUT' : 'IN'}</span>
									</div>
								</div>
								<div class="src">
									<b>{comm.channelSource || '—'}</b>
									{#if comm.channelSourceDetail}
										<span>{comm.channelSourceDetail}</span>
									{/if}
								</div>
								{#if comm.type === 'email' && comm.emailOpenedAt}
									<span class="pill p-done">Opened</span>
									{#if comm.emailClickedAt}
										<span class="pill p-prog">Clicked</span>
									{/if}
								{/if}
							</td>
							<td>
								<!-- Two axes, shown as two DIFFERENT things.
								     Stage (research -> comparison -> active) is where the customer is in
								     deciding. Emergency is urgency, and is deliberately NOT a stage
								     (spec: two-axis intent). Rendering the emergency flag with the same
								     `stage` class made one row look like it held two buckets — "Active"
								     and "Emergency" side by side, as if the record contradicted itself.
								     It is one bucket plus one urgency flag, so the flag now reads as a
								     flag. -->
								{#if comm.raw?.isDropCall}
									<span class="stage emergency">dropped call</span>
								{:else if comm.intentStage}
									<span class="stage {stageClass(comm.intentStage)}">{comm.intentStage}</span>
								{/if}
								{#if isEmergency}
									<span class="urgentflag" title="Urgency, not a stage">🚨 Urgent</span>
								{/if}
								<!-- The intent line: what the customer actually wants, not the storage key.
								     "bathroom" was the tag; "Bathroom renovation" is the intent. -->
								{#if intentLine(comm)}
									<div class="sub intent">{intentLine(comm)}</div>
								{/if}
								{#if comm.intentStatus}
									<div class="stat">{comm.intentStatus}{comm.intentConfidence ? ` · ${comm.intentConfidence}` : ''}</div>
								{/if}
								{#if comm.purpose === 'Confirm' || comm.purpose === 'Confirm Email'}
									<button
										type="button"
										class="confirm"
										onclick={(e) => { e.stopPropagation(); onConfirmClick ? onConfirmClick(comm) : onReplyClick?.(comm); }}
									>
										{comm.purpose === 'Confirm Email' ? 'Confirm Email' : (comm.raw?.metadata?.confirm_action === 'call' ? 'Confirm call' : 'Confirm')}
									</button>
								{:else if comm.purpose && !purposeIsRedundant(comm)}
									<div class="sub">{comm.purpose}</div>
								{/if}
								{#if slaBadge(comm)}
									{@const sla = slaBadge(comm)}
									<span class="pill p-{sla?.tone}">🚨 {sla?.label}</span>
								{/if}
								{#if calendarGraceBadge(comm)}
									{@const cal = calendarGraceBadge(comm)}
									<span class="pill p-{cal?.tone}">⏳ {cal?.label}</span>
								{/if}
							</td>
							<td>
								<!-- The prototype's `profileCell()` leads with the code, not the name:
								       PRF-####  [T1]
								       Identified — name + email/phone
								     The column is "Profile ID · Who", and the "Who" is the identity-TIER
								     descriptor, not the person's name. Reverted to that shape on request
								     after a spell showing the name on top. -->
								{#if onProfileClick && comm.raw?.raw?.customer?.id}
									<button type="button" class="prof" onclick={(e) => { e.stopPropagation(); onProfileClick(comm); }}>
										<span class="mono profid">{comm.profileId ?? '—'}</span>
										<span class="tier {tierCls}">{tierLabel(comm.profileTier)}</span>
										<div class="fade">{comm.profileWho || comm.profileName || comm.source || '—'}</div>
									</button>
								{:else}
									<span class="mono profid">{comm.profileId ?? '—'}</span>
									<span class="tier {tierCls}">{tierLabel(comm.profileTier)}</span>
									<div class="fade">{comm.profileWho || comm.profileName || comm.source || '—'}</div>
								{/if}
							</td>
							<td>
								{#if comm.endpoint}
									<div class="endpoint">{comm.endpoint}</div>
								{:else if showAssignButton && onAssignClick && !comm.raw?.isDropCall && comm.commId && !comm.commId.startsWith('DROP-')}
									<button type="button" class="assign" onclick={(e) => { e.stopPropagation(); onAssignClick(comm); }}>Assign</button>
								{/if}
								{#if comm.assignedMemberNames && comm.assignedMemberNames.length > 0}
									<div class="fade">{comm.assignedMemberNames.join(', ')}</div>
								{/if}
							</td>
							<td class="jrn">
								{#if comm.journey?.segments?.length}
									<div>
										{#each comm.journey.segments as s}{#if s.bold}<b>{s.text}</b>{:else}{s.text}{/if}{/each}
									</div>
									{#if comm.journey.full}
										<div class="fade">{comm.journey.full}</div>
									{/if}
								{:else if signals.length > 0}
									{signals.slice(0, 6).join(' → ')}{signals.length > 6 ? ' …' : ''}
								{:else if comm.summary}
									{comm.summary}
								{:else}
									—
								{/if}
							</td>
							<td class="eng">
								{#if comm.engagementId}
									<button type="button" class="englink" onclick={(e) => { e.stopPropagation(); handleSummaryClick(comm); }}>{comm.engagementId}</button>
									<span>{comm.sessionId ?? '—'}</span>
								{:else}
									<span>Pending</span>
								{/if}
							</td>
							<td>
								{#if comm.summary}
									<button type="button" class="lnk" onclick={(e) => { e.stopPropagation(); handleSummaryClick(comm); }}>Summary</button>
								{:else}
									<span class="fade">—</span>
								{/if}
								{#if comm.threadSubtopics && comm.threadSubtopics.length > 0}
									<div class="sub">{comm.threadSubtopics.join(' · ')}</div>
								{/if}
							</td>
							<td>
								<DropdownMenu.Root
									open={openDropdownId === comm.id}
									onOpenChange={(open) => {
										if (open) openDropdownId = comm.id;
										else if (openDropdownId === comm.id) openDropdownId = null;
									}}
								>
									<DropdownMenu.Trigger class="more">
										<span class="sr-only">Actions</span>
										<span class="dots"><span></span><span></span><span></span></span>
									</DropdownMenu.Trigger>
									<DropdownMenu.Content align="end" class="w-40">
										<DropdownMenu.Item onclick={() => handleActionClick('view', comm)}>View Details</DropdownMenu.Item>
										<DropdownMenu.Item onclick={() => onViewLogClick?.(comm)}>View Log</DropdownMenu.Item>
										<DropdownMenu.Item onclick={() => handleActionClick('call', comm)}>Call</DropdownMenu.Item>
										<DropdownMenu.Item onclick={() => handleActionClick('sms', comm)}>SMS</DropdownMenu.Item>
										{#if hasEmail}
										<DropdownMenu.Item class="text-red-600 focus:text-red-600 focus:bg-red-50" onclick={() => handleActionClick('email', comm)}>Email</DropdownMenu.Item>
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

{#if openColKey}
	{@const col = COLS[openColKey]}
	<button type="button" class="clog-ov on" onclick={closeCol} aria-label="Close"></button>
	<div class="clog-draw on">
		<div class="dh">
			<button class="x" onclick={closeCol}>×</button>
			<h2>{col?.title ?? ''}</h2>
			<div class="meta">Column protocol &amp; logic — how this value is derived</div>
		</div>
		<div class="db">
			<div class="sec">What it is</div>
			<div class="narr">{col?.what ?? ''}</div>
			<div class="sec">Where the value comes from</div>
			<div class="proof">{col?.src ?? ''}</div>
			<div class="sec">How it's determined (the logic)</div>
			{#each col?.logic ?? [] as line}
				<div class="item">• {line}</div>
			{/each}
			<div class="sec">Reference</div>
			<div class="jrn">Full definition: <span class="mono">specs/clearsky-communication-log-id-model.md</span></div>
		</div>
	</div>
{/if}

<style>
	:global(.clog *) {
		box-sizing: border-box;
	}
	:global(.clog) {
		--ink: #1b2129;
		--soft: #5a6570;
		--faint: #8b95a0;
		--paper: #f4f6f8;
		--card: #fff;
		--line: #e3e7ec;
		--lsoft: #eef1f4;
		--slate: #2d4a63;
		--deep: #20374b;
		--blue: #2563eb;
		--green: #16a34a;
		--amber: #e8920c;
		--red: #cf3d3d;
		--purple: #6d28d9;
		--teal: #0d7f78;
		font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
		background: var(--card);
		border: 1px solid var(--line);
		border-radius: 14px;
		color: var(--ink);
		font-size: 14px;
		overflow: hidden;
	}
	:global(.clog .tabs) {
		display: flex;
		gap: 4px;
		padding: 14px 16px;
		border-bottom: 1px solid var(--line);
		flex-wrap: wrap;
	}
	:global(.clog .tab) {
		padding: 7px 14px;
		border-radius: 8px;
		border: none;
		background: none;
		cursor: pointer;
		font-size: 13px;
		font-weight: 600;
		color: var(--soft);
	}
	:global(.clog .tab.on) {
		background: var(--ink);
		color: #fff;
	}
	:global(.clog .tab:not(.on):hover) {
		background: var(--paper);
	}
	:global(.clog .tab .n) {
		opacity: 0.6;
		font-weight: 700;
		margin-left: 4px;
		font-size: 11px;
	}
	:global(.clog .ci) {
		display: inline-grid;
		place-items: center;
		width: 15px;
		height: 15px;
		border-radius: 50%;
		background: var(--blue);
		color: #fff;
		font-size: 10px;
		font-weight: 700;
		cursor: pointer;
		margin-left: 5px;
		vertical-align: middle;
		border: none;
		padding: 0;
	}
	:global(.clog .ci:hover) {
		background: var(--slate);
	}
	:global(.clog .mono),
	:global(.clog-draw .mono) {
		font-family: ui-monospace, monospace;
	}
	:global(.clog .scroll) {
		overflow-x: auto;
	}
	:global(.clog table) {
		width: 100%;
		border-collapse: collapse;
		min-width: 1180px;
	}
	:global(.clog th) {
		text-align: left;
		font-size: 10.5px;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--faint);
		font-weight: 700;
		padding: 12px 14px;
		border-bottom: 1px solid var(--line);
		white-space: nowrap;
	}
	:global(.clog th.sortable) {
		cursor: pointer;
	}
	:global(.clog th.sortable:hover) {
		background: #fafcff;
	}
	:global(.clog td) {
		padding: 13px 14px;
		border-bottom: 1px solid var(--lsoft);
		vertical-align: top;
	}
	:global(.clog tr.row) {
		cursor: pointer;
	}
	:global(.clog tr.row:hover) {
		background: #fafcff;
	}
	:global(.clog td.empty) {
		padding: 40px;
		text-align: center;
		color: var(--faint);
	}
	/* The person's name leads the Profile column; it should read as a name, not a code. */
	:global(.clog .pname) {
		font-weight: 600;
		color: #16324f;
		margin-right: 6px;
	}
	/* Urgency is not a stage, so it must not look like one of the stage pills. */
	:global(.clog .urgentflag) {
		display: inline-block;
		margin-left: 6px;
		padding: 1px 7px;
		border-radius: 999px;
		border: 1px solid #f3b4b4;
		background: #fff5f5;
		color: #b02a2a;
		font-size: 11px;
		font-weight: 600;
		white-space: nowrap;
	}
	:global(.clog .sub.intent) {
		font-weight: 600;
		color: #26384a;
	}
	:global(.clog .dot) {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: var(--green);
		display: inline-block;
	}
	:global(.clog .dot.red) {
		background: var(--red);
	}
	:global(.clog .dot.blue) {
		background: var(--blue);
	}
	:global(.clog .dot.green) {
		background: var(--green);
	}
	:global(.clog .date b) {
		display: block;
		font-size: 13px;
	}
	:global(.clog .date span) {
		color: var(--faint);
		font-size: 11.5px;
	}
	:global(.clog .chan) {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	:global(.clog .chan b) {
		font-size: 13px;
	}
	:global(.clog .cico) {
		width: 30px;
		height: 30px;
		border-radius: 8px;
		display: grid;
		place-items: center;
		font-size: 15px;
		background: var(--lsoft);
		flex-shrink: 0;
	}
	:global(.clog .dir) {
		font-size: 9.5px;
		font-weight: 700;
		letter-spacing: 0.04em;
		padding: 2px 6px;
		border-radius: 5px;
	}
	:global(.clog .dir.in) {
		background: #e6efe9;
		color: var(--green);
	}
	:global(.clog .dir.out) {
		background: #eef2fb;
		color: var(--blue);
	}
	:global(.clog .src b) {
		display: block;
		font-size: 13px;
		margin-top: 5px;
	}
	:global(.clog .src span) {
		color: var(--faint);
		font-size: 11.5px;
	}
	:global(.clog .stage) {
		font-size: 10.5px;
		font-weight: 700;
		padding: 3px 8px;
		border-radius: 6px;
		text-transform: capitalize;
		display: inline-block;
	}
	:global(.clog .stage.research) {
		background: #e8eefc;
		color: #1d4ed8;
	}
	:global(.clog .stage.comparison) {
		background: #f0eafc;
		color: var(--purple);
	}
	:global(.clog .stage.active) {
		background: #e6f4f1;
		color: var(--teal);
	}
	:global(.clog .stage.emergency) {
		background: #fbe9e9;
		color: var(--red);
	}
	:global(.clog .stage.na) {
		background: #eef1f4;
		color: var(--faint);
	}
	:global(.clog .sub) {
		font-size: 11px;
		color: var(--soft);
		margin-top: 3px;
	}
	:global(.clog .stat) {
		font-size: 9.5px;
		color: var(--faint);
		margin-top: 3px;
		font-family: ui-monospace, monospace;
	}
	:global(.clog .tier) {
		font-size: 9.5px;
		font-weight: 700;
		padding: 1px 6px;
		border-radius: 5px;
		margin-left: 5px;
	}
	:global(.clog .tier.t1) {
		background: #e6efe9;
		color: #2e6a4a;
	}
	:global(.clog .tier.t2) {
		background: #eef1f4;
		color: var(--soft);
	}
	:global(.clog .tier.t2b) {
		background: #fdf1dc;
		color: #7a5405;
	}
	:global(.clog .jrn) {
		font-size: 12px;
		color: var(--soft);
		line-height: 1.5;
	}
	:global(.clog .lnk) {
		color: var(--blue);
		font-weight: 600;
		text-decoration: none;
		cursor: pointer;
		background: none;
		border: none;
		padding: 0;
	}
	:global(.clog .lnk:hover) {
		text-decoration: underline;
	}
	:global(.clog .eng) {
		font-family: ui-monospace, monospace;
		font-size: 11.5px;
		color: var(--blue);
	}
	:global(.clog .eng span) {
		display: block;
		color: var(--faint);
		font-size: 10px;
		margin-top: 2px;
	}
	:global(.clog .englink) {
		font-family: ui-monospace, monospace;
		font-size: 11.5px;
		color: var(--blue);
		background: none;
		border: none;
		padding: 0;
		cursor: pointer;
	}
	:global(.clog .englink:hover) {
		text-decoration: underline;
	}
	:global(.clog .prof) {
		background: none;
		border: none;
		padding: 0;
		text-align: left;
		cursor: pointer;
	}
	:global(.clog .profid) {
		color: var(--blue);
		font-weight: 700;
	}
	:global(.clog .fade) {
		color: var(--faint);
		font-size: 11px;
		margin-top: 2px;
	}
	:global(.clog .endpoint) {
		font-weight: 600;
	}
	:global(.clog .assign) {
		text-align: left;
		font-size: 12px;
		color: var(--blue);
		text-decoration: underline;
		background: none;
		border: none;
		padding: 0;
		cursor: pointer;
	}
	:global(.clog .confirm) {
		display: inline-block;
		border-radius: 6px;
		background: #4a72b2;
		color: #fff;
		padding: 4px 10px;
		font-size: 11px;
		font-weight: 600;
		border: none;
		cursor: pointer;
		margin-top: 3px;
	}
	:global(.clog .pill) {
		font-size: 10px;
		font-weight: 700;
		padding: 2px 7px;
		border-radius: 20px;
		white-space: nowrap;
		display: inline-block;
		margin-top: 3px;
	}
	:global(.clog .p-done) {
		background: #e6f4ea;
		color: var(--green);
	}
	:global(.clog .p-wait) {
		background: #fdf1dc;
		color: var(--amber);
	}
	:global(.clog .p-block) {
		background: #fbe9e9;
		color: var(--red);
	}
	:global(.clog .p-sched) {
		background: #e8eefc;
		color: var(--blue);
	}
	:global(.clog .p-prog) {
		background: #f0eafc;
		color: var(--purple);
	}
	:global(.clog .more) {
		width: 30px;
		height: 30px;
		border-radius: 50%;
		border: 1px solid var(--line);
		background: var(--card);
		cursor: pointer;
		color: var(--soft);
		display: inline-grid;
		place-items: center;
	}
	:global(.clog .more:hover) {
		background: var(--paper);
	}
	:global(.clog .dots) {
		display: flex;
		gap: 3px;
	}
	:global(.clog .dots span) {
		width: 4px;
		height: 4px;
		border-radius: 50%;
		background: var(--soft);
	}
	:global(.clog .sr-only) {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	:global(.clog-ov) {
		position: fixed;
		inset: 0;
		background: rgba(16, 24, 40, 0.4);
		opacity: 0;
		pointer-events: none;
		transition: 0.2s;
		z-index: 50;
		border: none;
		padding: 0;
		cursor: pointer;
	}
	:global(.clog-ov.on) {
		opacity: 1;
		pointer-events: auto;
	}
	:global(.clog-draw) {
		position: fixed;
		top: 0;
		right: 0;
		height: 100%;
		width: 520px;
		max-width: 94vw;
		background: #fff;
		box-shadow: -8px 0 40px rgba(16, 24, 40, 0.2);
		transform: translateX(100%);
		transition: 0.25s;
		z-index: 51;
		overflow-y: auto;
	}
	:global(.clog-draw.on) {
		transform: translateX(0);
	}
	:global(.clog-draw .dh) {
		padding: 18px 22px;
		border-bottom: 1px solid var(--line);
		position: sticky;
		top: 0;
		background: #fff;
	}
	:global(.clog-draw .dh .x) {
		float: right;
		border: none;
		background: none;
		font-size: 22px;
		cursor: pointer;
		color: #8b95a0;
		line-height: 1;
	}
	:global(.clog-draw .dh h2) {
		margin: 0 0 3px;
		font-size: 17px;
	}
	:global(.clog-draw .dh .meta) {
		font-family: ui-monospace, monospace;
		font-size: 11.5px;
		color: #8b95a0;
	}
	:global(.clog-draw .db) {
		padding: 18px 22px;
	}
	:global(.clog-draw .sec) {
		font-size: 10.5px;
		letter-spacing: 0.07em;
		text-transform: uppercase;
		color: #8b95a0;
		font-weight: 700;
		margin: 20px 0 8px;
	}
	:global(.clog-draw .sec:first-child) {
		margin-top: 0;
	}
	:global(.clog-draw .narr) {
		background: #f4f6f8;
		border-radius: 10px;
		padding: 13px 15px;
		line-height: 1.6;
		font-size: 13.5px;
	}
	:global(.clog-draw .proof) {
		background: #f7fafc;
		border: 1px solid #e3e7ec;
		border-radius: 10px;
		padding: 12px 14px;
		font-size: 12.5px;
		line-height: 1.55;
	}
	:global(.clog-draw .item) {
		display: flex;
		gap: 10px;
		align-items: flex-start;
		padding: 9px 0;
		border-bottom: 1px solid #eef1f4;
		font-size: 13px;
	}
	:global(.clog-draw .jrn) {
		font-size: 12px;
		color: #5a6570;
		line-height: 1.5;
	}
</style>
