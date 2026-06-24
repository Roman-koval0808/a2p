<script lang="ts">
	import { 
		MessageSquareText, 
		AlertOctagon, 
		Activity, 
		Calendar, 
		Phone, 
		Mail, 
		ArrowRight, 
		UserCheck, 
		Users,
		Clock
	} from 'lucide-svelte';
	import { goto } from '$app/navigation';
	import { Button } from '$lib/components/ui/button';

	let { data } = $props<{
		data: {
			user: any;
			latestCommunications: any[];
			siteVisitors: any[];
			upcomingAppointments: any[];
			assignedLeads: any[];
			stats: {
				totalLeads: number;
				emergencyAlerts: number;
				activeProjects: number;
				appointments: number;
			};
		};
	}>();

	let selectedChannel = $state('sms');

	const filteredComms = $derived(
		data.latestCommunications.filter(c => {
			if (selectedChannel === 'sms') return c.type === 'sms';
			if (selectedChannel === 'email') return c.type === 'email';
			if (selectedChannel === 'phonecall') return c.type === 'voice';
			return true;
		})
	);

	function getStatusColor(status: string) {
		if (status === 'red') return 'bg-red-50 text-red-600 border border-red-200';
		if (status === 'blue') return 'bg-amber-50 text-amber-700 border border-amber-200';
		return 'bg-green-50 text-green-700 border border-green-200';
	}

	function formatDate(d: string | Date) {
		const dateObj = new Date(d);
		return dateObj.toLocaleDateString(undefined, {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function formatTime(d: string | Date) {
		return new Date(d).toLocaleTimeString(undefined, {
			hour: '2-digit',
			minute: '2-digit'
		});
	}
</script>

<div class="min-h-screen bg-gray-50 p-6 font-sans">
	<!-- Header -->
	<div class="mb-6 flex items-center justify-between border-b border-gray-200 pb-5">
		<div>
			<h1 class="text-xl font-bold text-gray-800">Dashboard</h1>
			<p class="text-xs text-gray-500 mt-1">Overview of latest communications, visitor metrics, and dispatch logs.</p>
		</div>
		<div class="text-xs text-gray-500 font-medium">
			Logged in as: <span class="text-gray-900 font-semibold">{data.user.name || data.user.email}</span>
		</div>
	</div>

	<!-- Stats Summary Grid (Flat Border Theme) -->
	<div class="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
		<!-- Total Leads -->
		<div class="rounded-lg bg-white p-5 border border-gray-200 flex items-center gap-4">
			<div class="flex h-10 w-10 items-center justify-center rounded bg-indigo-50 text-indigo-600 border border-indigo-100">
				<Users class="h-5 w-5" />
			</div>
			<div>
				<p class="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Total Leads</p>
				<h3 class="text-xl font-extrabold text-gray-800 mt-0.5">{data.stats.totalLeads}</h3>
			</div>
		</div>

		<!-- Emergency Alerts -->
		<div class="rounded-lg bg-white p-5 border border-gray-200 flex items-center gap-4">
			<div class="flex h-10 w-10 items-center justify-center rounded bg-red-50 text-red-600 border border-red-100">
				<AlertOctagon class="h-5 w-5" />
			</div>
			<div>
				<p class="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Emergency Alerts</p>
				<h3 class="text-xl font-extrabold text-gray-800 mt-0.5">{data.stats.emergencyAlerts}</h3>
			</div>
		</div>

		<!-- Active Projects -->
		<div class="rounded-lg bg-white p-5 border border-gray-200 flex items-center gap-4">
			<div class="flex h-10 w-10 items-center justify-center rounded bg-amber-50 text-amber-600 border border-amber-100">
				<Activity class="h-5 w-5" />
			</div>
			<div>
				<p class="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Active Projects</p>
				<h3 class="text-xl font-extrabold text-gray-800 mt-0.5">{data.stats.activeProjects}</h3>
			</div>
		</div>

		<!-- Upcoming Appointments -->
		<div class="rounded-lg bg-white p-5 border border-gray-200 flex items-center gap-4">
			<div class="flex h-10 w-10 items-center justify-center rounded bg-teal-50 text-teal-600 border border-teal-100">
				<Calendar class="h-5 w-5" />
			</div>
			<div>
				<p class="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Upcoming Events</p>
				<h3 class="text-xl font-extrabold text-gray-800 mt-0.5">{data.stats.appointments}</h3>
			</div>
		</div>
	</div>

	<!-- Main Dashboard Grid -->
	<div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
		<!-- Upper Left: Latest Communications -->
		<div class="flex flex-col rounded-lg bg-white p-5 border border-gray-200 min-h-[400px]">
			<div class="mb-4 flex items-center justify-between">
				<h2 class="text-sm font-bold text-gray-800 uppercase tracking-wider">Latest Communications</h2>
				<button class="text-xs font-semibold text-indigo-600 hover:underline" onclick={() => goto('/communication-log')}>
					View Log
				</button>
			</div>

			<!-- Communication Filter Tabs -->
			<div class="mb-4 flex items-center gap-2 rounded bg-gray-50 border border-gray-200 p-1">
				<button
					class="flex-1 py-1 text-xs font-semibold rounded transition-all {selectedChannel === 'sms' ? 'bg-white text-indigo-600 border border-gray-200 shadow-sm' : 'text-gray-500 hover:text-gray-700'}"
					onclick={() => (selectedChannel = 'sms')}
				>
					SMS
				</button>
				<button
					class="flex-1 py-1 text-xs font-semibold rounded transition-all {selectedChannel === 'email' ? 'bg-white text-indigo-600 border border-gray-200 shadow-sm' : 'text-gray-500 hover:text-gray-700'}"
					onclick={() => (selectedChannel = 'email')}
				>
					Email
				</button>
				<button
					class="flex-1 py-1 text-xs font-semibold rounded transition-all {selectedChannel === 'phonecall' ? 'bg-white text-indigo-600 border border-gray-200 shadow-sm' : 'text-gray-500 hover:text-gray-700'}"
					onclick={() => (selectedChannel = 'phonecall')}
				>
					Calls
				</button>
			</div>

			<!-- Logs List -->
			<div class="flex-1 overflow-y-auto space-y-1">
				{#each filteredComms as log}
					<div 
						role="button"
						tabindex="0"
						class="flex items-start justify-between border-b border-gray-100 pb-2.5 pt-1.5 hover:bg-gray-50 px-2 rounded transition-colors cursor-pointer"
						onclick={() => {
							const threadId = log.metadata?.thread_id;
							if (threadId) {
								goto(`/inbox?threadId=${encodeURIComponent(threadId)}`);
							} else {
								goto('/communication-log');
							}
						}}
						onkeydown={(e) => {
							if (e.key === 'Enter' || e.key === ' ') {
								goto(log.metadata?.thread_id ? `/inbox?threadId=${encodeURIComponent(log.metadata.thread_id)}` : '/communication-log');
							}
						}}
					>
						<div class="flex items-start gap-3">
							<div class="mt-0.5 flex h-7 w-7 items-center justify-center rounded bg-gray-50 border border-gray-100 text-gray-500">
								{#if log.type === 'sms'}
									<MessageSquareText class="h-3.5 w-3.5 text-indigo-500" />
								{:else if log.type === 'email'}
									<Mail class="h-3.5 w-3.5 text-emerald-500" />
								{:else}
									<Phone class="h-3.5 w-3.5 text-amber-500" />
								{/if}
							</div>
							<div class="flex flex-col min-w-0">
								<span class="text-xs font-bold text-gray-800 truncate">{log.source}</span>
								<span class="text-[11px] text-gray-500 line-clamp-1 mt-0.5">{log.summary}</span>
							</div>
						</div>
						<div class="flex flex-col items-end gap-1">
							<span class="text-[10px] text-gray-400 font-medium">{formatDate(log.created)}</span>
							<span class="inline-flex items-center text-[9px] font-bold px-1.5 py-0.2 rounded border {getStatusColor(log.status)}">
								{log.direction.toUpperCase()}
							</span>
						</div>
					</div>
				{/each}
				{#if filteredComms.length === 0}
					<div class="flex flex-col items-center justify-center h-full text-gray-400 text-xs py-12">
						No recent {selectedChannel} communications.
					</div>
				{/if}
			</div>
		</div>

		<!-- Upper Right: Site Visitors -->
		<div class="flex flex-col rounded-lg bg-white p-5 border border-gray-200 min-h-[400px]">
			<div class="mb-4 flex items-center justify-between">
				<h2 class="text-sm font-bold text-gray-800 uppercase tracking-wider">Site Visitors</h2>
				<button class="text-xs font-semibold text-indigo-600 hover:underline" onclick={() => goto('/profiles')}>
					View Profiles
				</button>
			</div>

			<div class="flex-1 overflow-y-auto space-y-2.5">
				{#each data.siteVisitors as visitor}
					{@const displayName = visitor.isAnonymous ? (visitor.clearPhone !== '—' ? 'Visitor (' + visitor.clearPhone + ')' : 'Anonymous Lead') : visitor.name}
					<div 
						role="button"
						tabindex="0"
						class="flex items-center justify-between border-b border-gray-100 pb-2.5 pt-1.5 hover:bg-gray-50 px-2 rounded transition-colors cursor-pointer"
						onclick={() => goto(`/profiles/${visitor.id}`)}
						onkeydown={(e) => {
							if (e.key === 'Enter' || e.key === ' ') {
								goto(`/profiles/${visitor.id}`);
							}
						}}
					>
						<div class="flex items-center gap-3">
							<div class="relative flex h-8 w-8 items-center justify-center rounded bg-gray-100 border border-gray-200 text-gray-600 text-xs font-bold">
								{displayName.charAt(0).toUpperCase()}
							</div>
							<div class="flex flex-col">
								<span class="text-xs font-bold text-gray-800">{displayName}</span>
								<div class="flex items-center gap-1.5 mt-0.5">
									{#if visitor.tier === 'T1'}
										<span class="text-[9px] font-mono font-bold px-1.5 py-0.2 rounded bg-blue-50 text-blue-700 border border-blue-200">Tier 1</span>
									{:else if visitor.tier === 'T2A'}
										<span class="text-[9px] font-mono font-bold px-1.5 py-0.2 rounded bg-purple-50 text-purple-700 border border-purple-200">Tier 2A</span>
									{:else}
										<span class="text-[9px] font-mono font-bold px-1.5 py-0.2 rounded bg-gray-50 text-gray-500 border border-gray-200">Tier 3</span>
									{/if}
									<span class="text-[10px] text-gray-400 font-semibold">{visitor.clearPhone !== '—' ? visitor.clearPhone : 'No Phone'}</span>
								</div>
							</div>
						</div>

						<div class="flex items-center gap-4">
							<div class="flex flex-col items-end">
								<span class="text-xs font-bold text-indigo-600">{visitor.scoreLive}<span class="text-[9px] text-gray-400">/100</span></span>
								{#if visitor.intentBucket === 'emergency'}
									<span class="text-[9px] font-bold text-red-600 bg-red-50 border border-red-200 px-1.5 py-0.2 rounded mt-0.5">EMERGENCY</span>
								{:else if visitor.intentBucket === 'active'}
									<span class="text-[9px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.2 rounded mt-0.5">ACTIVE</span>
								{:else}
									<span class="text-[9px] font-bold text-gray-400 bg-gray-50 border border-gray-200 px-1.5 py-0.2 rounded mt-0.5">GENERAL</span>
								{/if}
							</div>
							<ArrowRight class="h-3.5 w-3.5 text-gray-300" />
						</div>
					</div>
				{/each}
				{#if data.siteVisitors.length === 0}
					<div class="flex flex-col items-center justify-center h-full text-gray-400 text-xs py-12">
						No active visitors tracked yet.
					</div>
				{/if}
			</div>
		</div>

		<!-- Lower Left: Upcoming Appointments -->
		<div class="flex flex-col rounded-lg bg-white p-5 border border-gray-200 min-h-[350px]">
			<div class="mb-4 flex items-center justify-between">
				<h2 class="text-sm font-bold text-gray-800 uppercase tracking-wider">Upcoming Appointments</h2>
				<span class="text-xs font-semibold text-gray-400 uppercase tracking-wider">Schedule</span>
			</div>

			<div class="flex-1 overflow-y-auto space-y-3">
				{#each data.upcomingAppointments as apt}
					<div class="flex items-start gap-4 border-b border-gray-100 pb-3">
						<div class="flex flex-col items-center justify-center rounded bg-indigo-50 border border-indigo-100 text-indigo-700 w-11 h-11 flex-shrink-0">
							<span class="text-[9px] font-bold uppercase">{new Date(apt.startTime).toLocaleString(undefined, { month: 'short' })}</span>
							<span class="text-base font-extrabold">{new Date(apt.startTime).getDate()}</span>
						</div>
						<div class="flex-1 min-w-0">
							<h4 class="text-xs font-bold text-gray-800 truncate">{apt.title}</h4>
							<p class="text-[11px] text-gray-500 line-clamp-1 mt-0.5">{apt.description || 'No additional details.'}</p>
							<div class="flex items-center gap-2 mt-1">
								<span class="inline-flex items-center gap-1 text-[10px] font-semibold text-gray-400">
									<Clock class="h-3 w-3" />
									{formatTime(apt.startTime)} - {formatTime(apt.endTime)}
								</span>
								<span class="h-1.5 w-1.5 rounded-full" style="background-color: {apt.color === 'red' ? '#ef4444' : apt.color === 'pink' ? '#ec4899' : '#3b82f6'}"></span>
							</div>
						</div>
					</div>
				{/each}
			</div>
		</div>

		<!-- Lower Right: Assigned Leads -->
		<div class="flex flex-col rounded-lg bg-white p-5 border border-gray-200 min-h-[350px]">
			<div class="mb-4 flex items-center justify-between">
				<h2 class="text-sm font-bold text-gray-800 uppercase tracking-wider">Assigned To Me</h2>
				<button class="text-xs font-semibold text-indigo-600 hover:underline" onclick={() => goto('/inbox')}>
					Open Inbox
				</button>
			</div>

			{#if data.assignedLeads.some(l => l.status === 'assigned')}
				<div class="mb-3 rounded bg-amber-50 border border-amber-200 p-2 text-xs text-amber-700 flex items-center gap-2">
					<span class="relative flex h-2 w-2">
					  <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
					  <span class="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
					</span>
					You have new pending assignments!
				</div>
			{/if}

			<div class="flex-1 overflow-y-auto space-y-2.5">
				{#each data.assignedLeads as lead}
					<div 
						role="button"
						tabindex="0"
						class="flex items-center justify-between border-b border-gray-100 pb-2.5 pt-1.5 hover:bg-gray-50 px-2 rounded transition-colors cursor-pointer"
						onclick={() => goto(`/inbox?threadId=${encodeURIComponent(lead.threadId)}`)}
						onkeydown={(e) => {
							if (e.key === 'Enter' || e.key === ' ') {
								goto(`/inbox?threadId=${encodeURIComponent(lead.threadId)}`);
							}
						}}
					>
						<div class="flex items-center gap-3">
							<div class="flex h-8 w-8 items-center justify-center rounded bg-indigo-50 border border-indigo-100 text-indigo-600">
								<UserCheck class="h-4 w-4" />
							</div>
							<div class="flex flex-col">
								<span class="text-xs font-bold text-gray-800">{lead.customerName || 'Anonymous'}</span>
								<span class="text-[10px] text-gray-400 mt-0.5">Last active: {formatDate(lead.updated)}</span>
							</div>
						</div>
						
						<div class="flex items-center gap-3">
							{#if lead.status === 'assigned'}
								<span class="text-[9px] font-bold text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded animate-pulse">PENDING</span>
							{/if}
							{#if lead.urgency === 'red'}
								<span class="text-[9px] font-bold text-red-600 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded">URGENT</span>
							{:else}
								<span class="text-[9px] font-bold text-blue-600 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded">STANDARD</span>
							{/if}
							<ArrowRight class="h-3.5 w-3.5 text-gray-300" />
						</div>
					</div>
				{/each}
				{#if data.assignedLeads.length === 0}
					<div class="flex flex-col items-center justify-center h-full text-gray-400 text-xs py-12">
						No active leads assigned to you.
					</div>
				{/if}
			</div>
		</div>
	</div>
</div>
