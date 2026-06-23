<script lang="ts">
	import { onMount } from 'svelte';
	import {
		Search,
		Mic,
		MapPin,
		Mail,
		Phone,
		ChevronDown,
		X,
		SquarePen,
		MessageSquare,
		Globe,
		Facebook,
		Bot,
		FileText,
		Trash2
	} from 'lucide-svelte';
	import { goto } from '$app/navigation';
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import CommunicationTable from '$lib/components/CommunicationTable.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import PipelineModal from '$lib/components/PipelineModal.svelte';
	import { toast } from 'svelte-sonner';

	interface Connection {
		id: string;
		name: string;
		address: string;
		landline: string;
		cell: string;
		email: string;
		smsPermission: boolean;
	}

	interface Profile {
		id: string;
		name: string;
		phone: string;
		email: string;
		address: string;
		landline: string;
		cell: string;
		smsPermission: boolean;
		connections: Connection[];
	}

	interface Communication {
		id: string;
		date: string;
		time: string;
		type: 'email' | 'sms' | 'voice' | 'web' | 'facebook' | 'chatbot' | 'leadform';
		direction: 'In' | 'Out';
		source: string;
		endpoint: string;
		purpose: string | null;
		summary: string | null;
		commId: string | null;
		status: 'red' | 'green' | 'blue';
	}

	interface CommSummary {
		commId: string;
		summaryLink: string;
	}

	let { data } = $props();

	let communications = $state<Communication[]>(data.communications || []);

	// Update when data changes
	$effect(() => {
		communications = data.communications || [];
	});

	onMount(() => {
		const interval = setInterval(() => {
			invalidateAll();
		}, 4000);
		return () => clearInterval(interval);
	});

	const commSummaries: CommSummary[] = [
		{ commId: 'COM-00124', summaryLink: 'Open Summary for COM- 000124' },
		{ commId: 'COM-00125', summaryLink: 'Open Summary for COM- 000125' },
		{ commId: 'COM-00126', summaryLink: 'Open Summary for COM- 000126' },
		{ commId: 'COM-00127', summaryLink: 'Open Summary for COM- 000127' },
		{ commId: 'COM-00128', summaryLink: 'Open Summary for COM- 000128' }
	];

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

	const profileId = $derived(page.params.id);
	const selectedProfile = $derived(
		data.profile
			? {
					id: data.profile.id,
					name: data.profile.name || 'Unknown',
					phone: data.profile.phone || '',
					email: data.profile.email || '',
					address: data.profile.address || '',
					landline: data.profile.landline || data.profile.phone || '',
					cell: data.profile.cell || data.profile.phone || '',
					smsPermission: data.profile.smsPermission ?? false,
					past_names: data.profile.past_names || [],
					connections: [], // Connections can be added later if needed
					clearPhone: data.profile.clearPhone || '—',
					clearEmail: data.profile.clearEmail || '—',
					scoreLive: data.profile.scoreLive || 0,
					tier: data.profile.tier || 'T3',
					isAnonymous: data.profile.isAnonymous ?? false
				}
			: null
	);

	let connectionsExpanded = $state(true);
	let selectedSummary = $state<Communication | null>(null);
	let showEditDialog = $state(false);
	let editForm = $state({ name: '', email: '', phone: '' });
	let pipelineDialogOpen = $state(false);
	let selectedPipelineEvent = $state<any>(null);
	let assignFormState = $state({ loading: false });

	function openEdit() {
		if (data.profile) {
			editForm = {
				name: data.profile.name ?? '',
				email: data.profile.email ?? '',
				phone: data.profile.phone ?? ''
			};
			showEditDialog = true;
		}
	}

	async function submitEdit() {
		const form = new FormData();
		form.set('name', editForm.name);
		form.set('email', editForm.email);
		form.set('phone', editForm.phone);
		const res = await fetch('?/updateProfile', { method: 'POST', body: form });
		if (res.ok) {
			showEditDialog = false;
			toast.success('Profile updated');
			await invalidateAll();
		} else {
			toast.error('Failed to update profile');
		}
	}

	async function assignRepresentative(e: Event) {
		const target = e.target as HTMLSelectElement;
		const representativeId = target.value;
		assignFormState.loading = true;
		
		const form = new FormData();
		form.set('representativeId', representativeId);
		
		try {
			const res = await fetch('?/assignRepresentative', { method: 'POST', body: form });
			if (res.ok) {
				toast.success('Representative assigned');
				await invalidateAll();
			} else {
				toast.error('Failed to assign representative');
			}
		} catch (err) {
			toast.error('Error assigning representative');
		} finally {
			assignFormState.loading = false;
		}
	}

	async function handleDelete() {
		if (!confirm('Are you sure you want to delete this profile?')) return;
		const res = await fetch('?/deleteProfile', { method: 'POST', body: new FormData() });
		if (res.ok) {
			toast.success('Profile deleted');
			goto('/profiles');
		} else {
			toast.error('Failed to delete profile');
		}
	}

	function handleSummaryClick(comm: Communication) {
		selectedSummary = comm;
	}

	function handleActionClick(action: string, comm: Communication) {
		console.log('Action:', action, 'for comm:', comm);
		// Handle actions like call, sms, email
	}

	function handlePipelineClick(comm: any) {
		selectedPipelineEvent = comm.raw;
		pipelineDialogOpen = true;
	}

	async function simulateOutboundCall(profileId: string, clearPhone: string) {
		if (!clearPhone || clearPhone === '—') {
			toast.error('Cannot call profile without a phone number.');
			return;
		}
		try {
			const res = await fetch('http://localhost:6277/api/v1/telemetry/events', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					tenantSlug: data.userCompanyId || 'clearsky-demo',
					eventType: 'call_initiated',
					phone: clearPhone,
					provider: 'telnyx_voice',
					payload: {
						detail: 'Outbound dispatch call: "We\'re on our way and it\'s $100/hr"',
						duration: 120,
						call_rate: '$100/hr',
						from: '+15513915091'
					}
				})
			});
			if (res.ok) {
				toast.success('Call recorded successfully!');
				await invalidateAll();
			} else {
				toast.error('Failed to record call.');
			}
		} catch (err) {
			console.error(err);
			toast.error('Error recording call.');
		}
	}

	async function simulateJobCompleted(profileId: string, clearPhone: string) {
		if (!clearPhone || clearPhone === '—') {
			toast.error('Cannot complete job for profile without a phone number.');
			return;
		}
		try {
			const res = await fetch('http://localhost:6277/api/v1/telemetry/events', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					tenantSlug: data.userCompanyId || 'clearsky-demo',
					eventType: 'job_completed',
					phone: clearPhone,
					provider: 'telnyx_voice',
					payload: {
						detail: 'Job Completed - Invoiced $250.00',
						revenue: 250.00,
						from: '+15513915091'
					}
				})
			});
			if (res.ok) {
				toast.success('Job marked completed! Review SMS request dispatched to ' + clearPhone);
				await invalidateAll();
			} else {
				toast.error('Failed to complete job.');
			}
		} catch (err) {
			console.error(err);
			toast.error('Error completing job.');
		}
	}
</script>

{#if selectedProfile}
	<!-- Profile Detail View -->
	<div class="flex min-h-full w-full">
		<!-- Left Sidebar -->
		<div class="w-[380px] min-w-[380px] border-r border-[#bebebe] bg-[#F7F9FC] p-6 overflow-y-auto max-h-[calc(100vh-52px)]">
			<!-- Profile Name -->
			<div class="flex items-center gap-3 mb-4">
				<div class="w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg text-white bg-indigo-600">
					{selectedProfile.isAnonymous ? '?' : selectedProfile.name.charAt(0).toUpperCase()}
				</div>
				<div class="min-w-0 flex-1">
					<h1 class="font-sans text-xl font-bold leading-tight text-[#2d3748] truncate">
						{selectedProfile.isAnonymous ? (selectedProfile.clearPhone !== '—' ? 'Caller (' + selectedProfile.clearPhone + ')' : 'Anonymous Lead') : selectedProfile.name}
					</h1>
					<p class="text-[10px] text-[#718096] font-mono truncate">{selectedProfile.id}</p>
				</div>
			</div>

			<!-- Contact Info -->
			<div class="mb-5 space-y-2 bg-white rounded-lg p-3 border border-[#e2e8f0]">
				<div class="flex items-center text-sm">
					<span class="w-[82px] font-sans font-medium text-[#4a5568]">Phone:</span>
					<span class="font-mono text-[#2d3748]">{selectedProfile.clearPhone}</span>
				</div>
				<div class="flex items-center text-sm">
					<span class="w-[82px] font-sans font-medium text-[#4a5568]">Email:</span>
					<span class="font-mono text-[#2d3748] truncate">{selectedProfile.clearEmail}</span>
				</div>
				{#if selectedProfile.past_names && selectedProfile.past_names.length > 0}
					<div class="flex items-start text-sm pt-1 border-t border-[#edf2f7]">
						<span class="w-[82px] font-sans font-medium text-[#4a5568]">Past names:</span>
						<span class="font-sans text-[#718096]">{selectedProfile.past_names.join(', ')}</span>
					</div>
				{/if}
			</div>

			<!-- Engagement Cards Grid -->
			<div class="grid grid-cols-2 gap-3 mb-5">
				<div class="bg-white p-3 rounded-lg border border-[#e2e8f0] text-center shadow-sm">
					<span class="text-[9px] text-[#718096] uppercase font-bold tracking-wider">Live Score</span>
					<div class="text-2xl font-bold text-indigo-600 mt-1">
						{selectedProfile.scoreLive} <span class="text-xs text-[#a0aec0] font-normal">/100</span>
					</div>
				</div>
				<div class="bg-white p-3 rounded-lg border border-[#e2e8f0] text-center shadow-sm">
					<span class="text-[9px] text-[#718096] uppercase font-bold tracking-wider">Intent Level</span>
					<div class="text-lg font-bold text-teal-600 mt-1">
						{data.behavioralAnalysis?.intentLevel || 'Low'}
					</div>
				</div>
			</div>

			<!-- Behavioral Analysis Block -->
			<div class="bg-white rounded-lg p-4 border border-[#e2e8f0] mb-5 shadow-sm">
				<h3 class="text-xs font-bold text-[#4a5568] uppercase tracking-wider mb-2">Behavioral Analysis</h3>
				<p class="text-xs text-[#718096] leading-relaxed">
					{data.behavioralAnalysis?.interpretation || 'Monitor behavior events.'}
				</p>
			</div>

			<!-- Best Recommended Action -->
			<div class="bg-emerald-50 rounded-lg p-4 border border-emerald-200 mb-5 shadow-sm">
				<h3 class="text-[9px] font-bold text-emerald-800 uppercase tracking-wider mb-1">Best Recommended Action</h3>
				<div class="text-sm font-bold text-emerald-700">
					{data.behavioralAnalysis?.recAction || 'Monitor Behavior'}
				</div>
			</div>

			<!-- Identity resolution history -->
			<div class="bg-white rounded-lg border border-[#e2e8f0] overflow-hidden mb-5 shadow-sm">
				<div class="bg-[#edf2f7] px-3 py-2 border-b border-[#e2e8f0]">
					<h3 class="text-xs font-bold text-[#4a5568] uppercase tracking-wider">Identity History</h3>
				</div>
				<div class="p-3 max-h-[180px] overflow-y-auto space-y-3">
					{#if data.identityHistory && data.identityHistory.length > 0}
						{#each data.identityHistory.slice().reverse() as h}
							<div class="text-[11px] pb-2 border-b border-[#f7fafc] last:border-0 last:pb-0">
								<div class="flex justify-between items-center mb-1">
									<span class="font-bold text-[#4a5568]">{h.field} Update</span>
									<span class="text-[9px] text-[#a0aec0]">{new Date(h.timestamp).toLocaleDateString()}</span>
								</div>
								<div class="flex flex-wrap items-center text-[#718096]">
									{#if h.oldValue}
										<span class="line-through text-red-400 mr-1.5">{h.oldValue}</span>
										<span class="mr-1.5">&rarr;</span>
									{:else}
										<span class="text-emerald-500 font-semibold mr-1.5">[Set Initial]</span>
									{/if}
									<span class="font-bold text-[#2d3748]">{h.newValue}</span>
								</div>
							</div>
						{/each}
					{:else}
						<p class="text-xs italic text-[#a0aec0] text-center py-2">No resolution history.</p>
					{/if}
				</div>
			</div>

			<!-- Visitor Facts -->
			<div class="bg-white rounded-lg border border-[#e2e8f0] overflow-hidden mb-5 shadow-sm">
				<div class="bg-[#edf2f7] px-3 py-2 border-b border-[#e2e8f0]">
					<h3 class="text-xs font-bold text-[#4a5568] uppercase tracking-wider">Visitor Facts</h3>
				</div>
				<div class="divide-y divide-[#edf2f7] text-xs">
					<div class="px-3 py-2.5 flex justify-between">
						<span class="text-[#718096]">Viewed Service Pages</span>
						<span class="font-bold text-[#2d3748]">{data.behavioralFacts?.viewedService ? 'Yes' : 'No'}</span>
					</div>
					<div class="px-3 py-2.5 flex justify-between">
						<span class="text-[#718096]">Viewed Pricing Page</span>
						<span class="font-bold text-[#2d3748]">{data.behavioralFacts?.viewedPricing ? 'Yes' : 'No'}</span>
					</div>
					<div class="px-3 py-2.5 flex justify-between">
						<span class="text-[#718096]">Form Submitted</span>
						<span class="font-bold text-[#2d3748]">{data.behavioralFacts?.formSubmitted ? 'Yes' : 'No'}</span>
					</div>
				</div>
			</div>

			<!-- Representative Assignment (Super Admin Only) -->
			{#if data.userRole === 'admin' && data.representatives?.length > 0}
			<div class="bg-white rounded-lg border border-[#e2e8f0] overflow-hidden mb-5 shadow-sm">
				<div class="bg-[#edf2f7] px-3 py-2 border-b border-[#e2e8f0]">
					<h3 class="text-xs font-bold text-[#4a5568] uppercase tracking-wider">Assigned Representative</h3>
				</div>
				<div class="p-3">
					<select 
						class="w-full text-sm border-gray-300 rounded-md shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
						disabled={assignFormState.loading}
						onchange={assignRepresentative}
					>
						<option value="">Unassigned</option>
						{#each data.representatives as rep}
							<option value={rep.id} selected={data.profile?.representativeId === rep.id}>
								{rep.name}
							</option>
						{/each}
					</select>
				</div>
			</div>
			{/if}

			<!-- Interactive Demo Actions -->
			<div class="bg-white rounded-lg p-4 border border-[#e2e8f0] mb-5 shadow-sm">
				<h3 class="text-xs font-bold text-[#4a5568] uppercase tracking-wider mb-3">Interactive Demo Actions</h3>
				<div class="flex gap-2">
					<button 
						onclick={() => simulateOutboundCall(selectedProfile.id, selectedProfile.clearPhone)}
						class="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-xs py-2 px-3 rounded shadow-sm transition"
					>
						Fake Call
					</button>
					<button 
						onclick={() => simulateJobCompleted(selectedProfile.id, selectedProfile.clearPhone)}
						class="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs py-2 px-3 rounded shadow-sm transition"
					>
						Complete Job
					</button>
				</div>
			</div>

			<!-- Score Timeline Ledger -->
			<div class="bg-white rounded-lg border border-[#e2e8f0] overflow-hidden shadow-sm">
				<div class="bg-[#edf2f7] px-3 py-2 border-b border-[#e2e8f0]">
					<h3 class="text-xs font-bold text-[#4a5568] uppercase tracking-wider">Score Timeline Ledger</h3>
				</div>
				<div class="p-3 max-h-[260px] overflow-y-auto space-y-3">
					{#if data.historyEvents && data.historyEvents.length > 0}
						{#each data.historyEvents.slice().reverse() as pe}
							<div class="flex gap-2.5 items-start pb-2.5 border-b border-[#f7fafc] last:border-0 last:pb-0">
								<div class="w-6 h-6 rounded-full bg-[#edf2f7] flex items-center justify-center text-[10px] flex-shrink-0">
									{pe.eventType === 'voicemail_received' ? '🎙️' : (pe.eventType.includes('form') || pe.eventType.includes('submit') ? '📝' : '🖱️')}
								</div>
								<div class="flex-1 min-w-0">
									<div class="font-medium text-[#2d3748] text-[11px] leading-tight">
										{pe.payload?.detail || pe.payload?.textContent || pe.payload?.comment || pe.eventType}
									</div>
									<div class="text-[9px] text-[#a0aec0] mt-0.5">
										{new Date(pe.occurredAt).toLocaleString()} &bull; {pe.pageUrl || '/'}
									</div>
								</div>
								<div class="font-mono text-xs font-bold flex-shrink-0 {pe.scoreDelta > 0 ? 'text-emerald-600' : pe.scoreDelta < 0 ? 'text-red-500' : 'text-gray-400'}">
									{pe.scoreDelta > 0 ? '+' : ''}{pe.scoreDelta}
								</div>
							</div>
						{/each}
					{:else}
						<p class="text-xs italic text-[#a0aec0] text-center py-2">No events ledger.</p>
					{/if}
				</div>
			</div>
		</div>

		<!-- Main Content -->
		<div class="flex-1 bg-white p-6">
			<!-- Back button -->
			<button
				onclick={() => goto('/profiles')}
				class="mb-4 flex items-center gap-1 font-sans text-sm text-[#577AB7] hover:text-[#3d5a8a]"
			>
				← Back to Profiles
			</button>

			<!-- Top Section: Latest Comm ID & Action Buttons -->
			<div class="mb-6 flex w-fit gap-6">
				<!-- Latest Comm ID Card -->
				<div class="w-[870px] rounded-lg bg-white p-6 shadow-[0px_0px_4px_rgba(0,0,0,0.41)]">
					<h2 class="mb-4 font-sans text-base font-semibold leading-[21px] text-[#555555]">
						Latest Comm ID
					</h2>
					<div class="flex gap-24">
						<div>
							<h4 class="mb-3 font-sans text-xs font-semibold leading-[1.29] text-[#555555]">
								COMM ID
							</h4>
							<div class="space-y-3">
								{#each communications.slice(0, 5) as comm}
									<p class="font-sans text-sm font-normal leading-[1.29] text-[#555555]">
										{comm.id.slice(0, 15)}...
									</p>
								{:else}
									<p class="font-sans text-sm text-gray-400">No communications found</p>
								{/each}
							</div>
						</div>
						<div>
							<h4 class="mb-3 font-sans text-xs font-semibold leading-[1.29] text-[#555555]">
								SUMMARY
							</h4>
							<div class="space-y-3">
								{#each communications.slice(0, 5) as comm}
									<button
										type="button"
										onclick={() => handleSummaryClick(comm)}
										class="block text-left cursor-pointer font-sans text-sm font-normal leading-[1.29] text-[#0023D7] underline hover:text-[#001ba3]"
									>
										Open Summary for {comm.id.slice(0, 8)}... ({comm.type})
									</button>
								{:else}
									<p class="font-sans text-sm text-gray-400">—</p>
								{/each}
							</div>
						</div>
					</div>
				</div>

				<!-- Action Buttons Card -->
				<div class="w-[391px] rounded-lg bg-white p-4 shadow-[0px_0px_4px_rgba(0,0,0,0.25)]">
					<div class="grid grid-cols-2 gap-3">
						<button
							class="flex h-[63px] items-center justify-center gap-2 rounded-sm bg-[#577AB7] transition-colors hover:bg-[#4a6aa0]"
						>
							<Mail class="h-4 w-4 text-white" />
							<span class="font-sans text-xs font-semibold leading-[16px] text-white"
								>New Email</span
							>
						</button>
						<button
							class="flex h-[63px] items-center justify-center gap-2 rounded-sm bg-[#F2AE5E] transition-colors hover:bg-[#e09d4d]"
						>
							<Phone class="h-4 w-4 text-white" />
							<span class="font-sans text-xs font-semibold leading-[16px] text-white">New Call</span
							>
						</button>
						<button
							class="flex h-[63px] items-center justify-center gap-2 rounded-sm bg-[#B5C2DA] transition-colors hover:bg-[#a3b3cf]"
						>
							<svg
								class="h-5 w-5 text-[#577AB7]"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
							>
								<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
							</svg>
							<span class="font-sans text-xs font-semibold leading-[16px] text-[#577AB7]"
								>New SMS</span
							>
						</button>
						<button
							class="flex h-[63px] items-center justify-center gap-2 rounded-sm bg-[#B5C2DA] transition-colors hover:bg-[#a3b3cf]"
						>
							<SquarePen class="h-5 w-5 text-[#577AB7]" />
							<span class="font-sans text-xs font-semibold leading-[16px] text-[#577AB7]"
								>Add Task</span
							>
						</button>
					</div>
				</div>
			</div>

			<!-- Communications Container -->
			<div class="min-w-[1282px]">
				<CommunicationTable
					bind:communications
					{filters}
					onSummaryClick={handleSummaryClick}
					onActionClick={handleActionClick}
					onPipelineClick={handlePipelineClick}
				/>
			</div>
		</div>
	</div>

	<!-- Edit Profile Dialog -->
	<Dialog.Root bind:open={showEditDialog}>
		<Dialog.Content class="sm:max-w-[425px]">
			<Dialog.Header>
				<Dialog.Title>Edit Profile</Dialog.Title>
			</Dialog.Header>
			<div class="grid gap-4 py-4">
				<div class="grid gap-2">
					<Label for="edit-name">Name</Label>
					<Input id="edit-name" bind:value={editForm.name} />
				</div>
				<div class="grid gap-2">
					<Label for="edit-email">Email</Label>
					<Input id="edit-email" type="email" bind:value={editForm.email} />
				</div>
				<div class="grid gap-2">
					<Label for="edit-phone">Phone</Label>
					<Input id="edit-phone" type="tel" bind:value={editForm.phone} />
				</div>
			</div>
			<Dialog.Footer>
				<Button variant="outline" onclick={() => (showEditDialog = false)}>Cancel</Button>
				<Button onclick={submitEdit}>Save changes</Button>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>

	<!-- Summary Modal -->
	{#if selectedSummary}
		<div
			class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
			onclick={() => (selectedSummary = null)}
			role="button"
			tabindex="0"
			onkeydown={(e) => {
				if (e.key === 'Escape') selectedSummary = null;
			}}
		>
			{#if selectedSummary.type === 'voice' && selectedSummary.direction === 'In'}
				<!-- Incoming Call Modal -->
				<div
					class="relative h-[452px] w-[742px] rounded bg-white p-6 shadow-[0px_4px_4px_rgba(0,0,0,0.25)]"
					onclick={(e) => e.stopPropagation()}
				>
					<!-- Close button -->
					<button
						onclick={() => (selectedSummary = null)}
						class="absolute right-4 top-4 text-gray-500 hover:text-gray-700"
						aria-label="Close"
					>
						<X class="h-5 w-5" />
					</button>

					<!-- Header -->
					<div class="mb-4 flex items-start justify-between">
						<div>
							<p
								class="mb-1 font-sans text-lg font-semibold leading-[1.29] tracking-normal text-[rgba(86,86,86,0.88)]"
							>
								AI Summary:
							</p>
							<p
								class="font-sans text-lg font-normal leading-[1.29] tracking-normal text-[rgba(86,86,86,0.78)]"
							>
								{selectedSummary.date} | {selectedSummary.time}
							</p>
						</div>
						<div class="text-right">
							<p
								class="mb-1 font-sans text-lg font-bold leading-[1.29] tracking-normal text-[rgba(86,86,86,0.78)]"
							>
								Comm ID - {selectedSummary.commId || 'N/A'}
							</p>
							<p
								class="font-sans text-lg font-semibold leading-[1.29] tracking-normal text-[rgba(86,86,86,0.88)]"
							>
								Category: Sales
							</p>
							<p
								class="text-right font-sans text-lg font-semibold leading-[1.29] tracking-normal text-[rgba(86,86,86,0.88)]"
							>
								Sub-Category: Inquiry/Demo
							</p>
						</div>
					</div>

					<!-- Summary Section -->
					<div class="mb-4">
						<p
							class="mb-3 font-sans text-lg font-semibold leading-[1.29] tracking-normal text-[rgba(86,86,86,0.88)]"
						>
							Summary:
						</p>
						<div class="h-[133px] w-full rounded border-b border-[#BEBEBE] bg-[#F7F7F7] p-4">
							<p
								class="font-sans text-lg font-normal leading-[131%] tracking-normal text-[rgba(86,86,86,0.78)]"
							>
								Sarah Lee called regarding the new AI-powered roofing estimator. Mark explained the
								features and offered to send a demo link. and will send a appointment time fo early
								Friday morning.
							</p>
						</div>
					</div>

					<!-- Tasks -->
					<div class="space-y-2">
						<p
							class="font-sans text-lg font-normal leading-[1.29] tracking-normal text-[rgba(86,86,86,0.78)]"
						>
							1st Task: Check Mark's Schedule for opening Friday morning
						</p>
						<p
							class="font-sans text-lg font-normal leading-[1.29] tracking-normal text-[rgba(86,86,86,0.78)]"
						>
							2nd Task: Book appointment
						</p>
						<p
							class="font-sans text-lg font-normal leading-[1.29] tracking-normal text-[rgba(86,86,86,0.78)]"
						>
							3rd Task: Send email demo link and appointment time
						</p>
					</div>
				</div>
			{:else if selectedSummary.type === 'email'}
				<!-- Email Modal (Scaled Down) -->
				<div
					class="relative w-[600px] rounded bg-white p-5 shadow-[0px_4px_4px_rgba(0,0,0,0.25)]"
					onclick={(e) => e.stopPropagation()}
				>
					<!-- Close button -->
					<button
						onclick={() => (selectedSummary = null)}
						class="absolute right-4 top-4 text-gray-500 hover:text-gray-700"
						aria-label="Close"
					>
						<X class="h-5 w-5" />
					</button>

					<!-- Header -->
					<div class="mb-3 flex items-start justify-between">
						<div>
							<p
								class="mb-1 font-sans text-base font-semibold leading-[1.29] tracking-normal text-[rgba(86,86,86,0.88)]"
							>
								AI Summary:
							</p>
							<p
								class="font-sans text-base font-normal leading-[1.29] tracking-normal text-[rgba(86,86,86,0.78)]"
							>
								{selectedSummary.date} | {selectedSummary.time}
							</p>
						</div>
						<div class="text-right">
							<p
								class="mb-1 font-sans text-base font-bold leading-[1.29] tracking-normal text-[rgba(86,86,86,0.78)]"
							>
								Comm ID - {selectedSummary.commId || 'N/A'}
							</p>
							<p
								class="font-sans text-base font-semibold leading-[1.29] tracking-normal text-[rgba(86,86,86,0.88)]"
							>
								Category: Sales
							</p>
							<p
								class="text-right font-sans text-base font-semibold leading-[1.29] tracking-normal text-[rgba(86,86,86,0.88)]"
							>
								Sub-Category: Book/Demo
							</p>
						</div>
					</div>

					<!-- Summary Section -->
					<div class="mb-3">
						<p
							class="mb-2 font-sans text-base font-semibold leading-[1.29] tracking-normal text-[rgba(86,86,86,0.88)]"
						>
							Summary:
						</p>
						<div class="w-full rounded border-b border-[#BEBEBE] bg-[#F7F7F7] p-3">
							<div class="space-y-2">
								<div>
									<span
										class="font-sans text-sm font-normal leading-[141%] tracking-normal text-[rgba(86,86,86,0.78)]"
									>
										Email Address:
									</span>
									<span
										class="font-sans text-sm font-medium leading-[141%] tracking-normal text-[rgba(86,86,86,0.78)]"
									>
										sarahlee@gmail.com
									</span>
								</div>
								<div>
									<span
										class="font-sans text-sm font-normal leading-[141%] tracking-normal text-[rgba(86,86,86,0.78)]"
									>
										Subject Line:
									</span>
									<span
										class="font-sans text-sm font-medium leading-[141%] tracking-normal text-[rgba(86,86,86,0.78)]"
									>
										Demo Link and Appointment time
									</span>
								</div>
								<div>
									<span
										class="font-sans text-sm font-normal leading-[141%] tracking-normal text-[rgba(86,86,86,0.78)]"
									>
										Body:
									</span>
									<div class="mt-2 w-full rounded border-b border-[#BEBEBE] bg-[#FFFDFD] p-3">
										<p
											class="mb-2 font-sans text-sm font-medium leading-[141%] tracking-normal text-[rgba(86,86,86,0.78)]"
										>
											Hello Sarah,<br />
											As per our conversation see demo link and as we discuss i book a appointment at
											10am at the office.
										</p>
										<p
											class="mb-2 font-sans text-sm font-normal italic leading-[141%] tracking-normal text-[rgba(123,132,249,0.78)] underline"
										>
											httpss://demolink1344/csag.com
										</p>
										<p
											class="font-sans text-sm font-medium leading-[141%] tracking-normal text-[rgba(86,86,86,0.78)]"
										>
											Looking forward to see you<br />
											if you have any question just five me a shout
										</p>
									</div>
								</div>
							</div>
						</div>
					</div>

					<!-- Footer -->
					<div>
						<p
							class="font-sans text-base font-normal leading-[1.29] tracking-normal text-[rgba(86,86,86,0.78)]"
						>
							Task: AI has to update the CRM & Engagement Score
						</p>
					</div>
				</div>
			{:else}
				<!-- Default Modal for other types -->
				<div
					class="relative w-[600px] rounded bg-white p-5 shadow-[0px_4px_4px_rgba(0,0,0,0.25)]"
					onclick={(e) => e.stopPropagation()}
				>
					<button
						onclick={() => (selectedSummary = null)}
						class="absolute right-4 top-4 text-gray-500 hover:text-gray-700"
						aria-label="Close"
					>
						<X class="h-5 w-5" />
					</button>
					<div class="mb-3">
						<p
							class="mb-1 font-sans text-base font-semibold leading-[1.29] tracking-normal text-[rgba(86,86,86,0.88)]"
						>
							AI Summary:
						</p>
						<p
							class="font-sans text-base font-normal leading-[1.29] tracking-normal text-[rgba(86,86,86,0.78)]"
						>
							{selectedSummary.date} | {selectedSummary.time}
						</p>
					</div>
					<div class="mb-3 text-right">
						<p
							class="mb-1 font-sans text-base font-bold leading-[1.29] tracking-normal text-[rgba(86,86,86,0.78)]"
						>
							Comm ID - {selectedSummary.commId || 'N/A'}
						</p>
						<p
							class="font-sans text-base font-semibold leading-[1.29] tracking-normal text-[rgba(86,86,86,0.88)]"
						>
							Category: Sales
						</p>
					</div>
					<div class="w-full rounded border-b border-[#BEBEBE] bg-[#F7F7F7] p-3">
						<p
							class="font-sans text-sm font-normal leading-[131%] tracking-normal text-[rgba(86,86,86,0.78)]"
						>
							{selectedSummary.summary || 'No summary available.'}
						</p>
					</div>
				</div>
			{/if}
		</div>
	{/if}

	<!-- Pipeline Modal -->
	<PipelineModal bind:open={pipelineDialogOpen} eventData={selectedPipelineEvent} />
{:else}
	<EmptyState
		title="Profile not found"
		variant="compact"
		class="min-h-0"
		primaryAction={{ label: '← Back to Profiles', href: '/profiles' }}
	/>
{/if}
