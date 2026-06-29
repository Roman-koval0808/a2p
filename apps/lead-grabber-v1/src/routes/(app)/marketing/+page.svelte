<script lang="ts">
	import { Megaphone, Mail, MessageSquare, Plus, ArrowUpRight, BarChart3, Users, Send, Edit, Copy, Trash2 } from 'lucide-svelte';
	import { toast } from 'svelte-sonner';

	let campaigns = $state([
		{
			id: '1',
			name: 'Summer Plumbing & Inspection Promo',
			type: 'SMS Broadcast',
			status: 'Sent',
			sentAt: '2026-06-10',
			recipients: 420,
			clickRate: '18.4%',
			conversionRate: '4.2%'
		},
		{
			id: '2',
			name: 'Winterization Guide & Service Discount',
			type: 'Email Newsletter',
			status: 'Active (Scheduled)',
			sentAt: '2026-07-05',
			recipients: 1250,
			clickRate: '—',
			conversionRate: '—'
		},
		{
			id: '3',
			name: 'Urgent Roof Repair Follow-up Automation',
			type: 'Auto-Trigger Campaign',
			status: 'Running',
			sentAt: 'Continuous',
			recipients: 89,
			clickRate: '34.2%',
			conversionRate: '12.5%'
		}
	]);

	let showCreateModal = $state(false);
	let campName = $state('');
	let campType = $state('SMS Broadcast');
	let campContent = $state('');

	function handleCreate(e: Event) {
		e.preventDefault();
		if (!campName.trim()) return;

		const newCamp = {
			id: String(campaigns.length + 1),
			name: campName,
			type: campType,
			status: campType === 'Auto-Trigger Campaign' ? 'Running' : 'Active (Scheduled)',
			sentAt: campType === 'Auto-Trigger Campaign' ? 'Continuous' : new Date().toISOString().split('T')[0],
			recipients: 0,
			clickRate: '—',
			conversionRate: '—'
		};

		campaigns = [newCamp, ...campaigns];
		showCreateModal = false;
		campName = '';
		campContent = '';
		toast.success('Marketing campaign established successfully!');
	}

	function deleteCampaign(id: string) {
		campaigns = campaigns.filter(c => c.id !== id);
		toast.success('Campaign archived');
	}
</script>

<div class="min-h-screen bg-gray-50 p-6 font-sans">
	<!-- Header -->
	<div class="mb-6 flex items-center justify-between border-b border-gray-200 pb-5">
		<div>
			<h1 class="text-xl font-bold text-gray-800 flex items-center gap-2">
				<Megaphone class="h-5 w-5 text-indigo-500" />
				Marketing Campaigns
			</h1>
			<p class="text-xs text-gray-500 mt-1">Design outbound campaigns, manage templates, and monitor response and conversion rates.</p>
		</div>
		<button
			onclick={() => showCreateModal = true}
			class="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs py-2 px-3 rounded shadow-sm transition"
		>
			<Plus class="h-4 w-4" />
			Launch Campaign
		</button>
	</div>

	<!-- Stats Summary Grid -->
	<div class="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
		<div class="bg-white p-5 rounded-lg border border-gray-200 flex items-center gap-4">
			<div class="flex h-10 w-10 items-center justify-center rounded bg-indigo-50 text-indigo-600 border border-indigo-100">
				<Users class="h-5 w-5" />
			</div>
			<div>
				<p class="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Total Marketing Contacts</p>
				<h3 class="text-xl font-extrabold text-gray-800 mt-0.5">1,820</h3>
			</div>
		</div>

		<div class="bg-white p-5 rounded-lg border border-gray-200 flex items-center gap-4">
			<div class="flex h-10 w-10 items-center justify-center rounded bg-emerald-50 text-emerald-600 border border-emerald-100">
				<BarChart3 class="h-5 w-5" />
			</div>
			<div>
				<p class="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Average CTR</p>
				<h3 class="text-xl font-extrabold text-gray-800 mt-0.5">26.3%</h3>
			</div>
		</div>

		<div class="bg-white p-5 rounded-lg border border-gray-200 flex items-center gap-4">
			<div class="flex h-10 w-10 items-center justify-center rounded bg-amber-50 text-amber-600 border border-amber-100">
				<Megaphone class="h-5 w-5" />
			</div>
			<div>
				<p class="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Avg. Conversion Rate</p>
				<h3 class="text-xl font-extrabold text-gray-800 mt-0.5">8.3%</h3>
			</div>
		</div>
	</div>

	<!-- Campaigns List -->
	<div class="bg-white rounded-lg border border-gray-200 overflow-hidden shadow-sm">
		<div class="bg-gray-50 px-5 py-3 border-b border-gray-200 flex items-center justify-between">
			<h2 class="text-xs font-bold text-gray-700 uppercase tracking-wider">Outbound Campaigns</h2>
		</div>

		<table class="w-full text-left text-sm text-gray-500">
			<thead class="bg-gray-50 text-xs uppercase text-gray-700">
				<tr>
					<th class="px-6 py-3">Campaign Details</th>
					<th class="px-6 py-3">Type</th>
					<th class="px-6 py-3">Recipients</th>
					<th class="px-6 py-3">Click-through Rate</th>
					<th class="px-6 py-3">Conversion Rate</th>
					<th class="px-6 py-3">Status</th>
					<th class="px-6 py-3 text-right">Actions</th>
				</tr>
			</thead>
			<tbody>
				{#each campaigns as camp}
					<tr class="border-b bg-white hover:bg-gray-50/50 transition-colors">
						<td class="px-6 py-4">
							<div class="font-bold text-gray-900 line-clamp-1">{camp.name}</div>
							<div class="text-[10px] text-gray-400 mt-1">Initiated: {camp.sentAt}</div>
						</td>
						<td class="px-6 py-4 whitespace-nowrap text-xs text-gray-700 font-medium">
							<span class="inline-flex items-center gap-1">
								{#if camp.type.includes('SMS')}
									<MessageSquare class="h-3.5 w-3.5 text-indigo-500" />
								{:else if camp.type.includes('Email')}
									<Mail class="h-3.5 w-3.5 text-emerald-500" />
								{:else}
									<Megaphone class="h-3.5 w-3.5 text-amber-500" />
								{/if}
								{camp.type}
							</span>
						</td>
						<td class="px-6 py-4 whitespace-nowrap text-xs font-bold text-gray-800">{camp.recipients}</td>
						<td class="px-6 py-4 whitespace-nowrap text-xs text-gray-700 font-mono">{camp.clickRate}</td>
						<td class="px-6 py-4 whitespace-nowrap text-xs text-gray-700 font-mono">{camp.conversionRate}</td>
						<td class="px-6 py-4 whitespace-nowrap">
							<span class="inline-flex items-center text-[9px] font-extrabold px-2 py-0.5 rounded border
								{camp.status === 'Sent' ? 'bg-gray-100 text-gray-700 border-gray-200' : 
								 camp.status === 'Running' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-blue-50 text-blue-700 border-blue-200'}">
								{camp.status.toUpperCase()}
							</span>
						</td>
						<td class="px-6 py-4 whitespace-nowrap text-right">
							<div class="flex items-center justify-end gap-3">
								<button 
									onclick={() => toast.info('Reviewing campaign reports.')}
									class="text-gray-400 hover:text-indigo-600 transition" 
									title="Edit"
								>
									<Edit class="h-4 w-4" />
								</button>
								<button 
									onclick={() => deleteCampaign(camp.id)}
									class="text-gray-400 hover:text-red-600 transition" 
									title="Archive"
								>
									<Trash2 class="h-4 w-4" />
								</button>
							</div>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>

	<!-- Create Modal Mockup -->
	{#if showCreateModal}
		<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
			<div class="bg-white rounded-xl shadow-xl border w-full max-w-md p-6 animate-in fade-in zoom-in duration-200">
				<h3 class="text-base font-bold text-gray-900 mb-4 flex items-center gap-2">
					<Megaphone class="h-5 w-5 text-indigo-500" />
					Establish Marketing Campaign
				</h3>

				<form onsubmit={handleCreate} class="space-y-4">
					<div class="space-y-1">
						<label for="camp-name" class="text-xs font-bold text-gray-500 uppercase">Campaign Name</label>
						<input
							id="camp-name"
							type="text"
							bind:value={campName}
							required
							placeholder="e.g. Winter Pipe Protection Offer"
							class="w-full text-sm border-gray-200 border rounded-lg p-2.5 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
						/>
					</div>

					<div class="space-y-1">
						<label for="camp-type" class="text-xs font-bold text-gray-500 uppercase">Channel Type</label>
						<select
							id="camp-type"
							bind:value={campType}
							class="w-full text-sm border-gray-200 border rounded-lg p-2.5 bg-white focus:outline-none"
						>
							<option>SMS Broadcast</option>
							<option>Email Newsletter</option>
							<option>Auto-Trigger Campaign</option>
						</select>
					</div>

					<div class="space-y-1">
						<label for="camp-content" class="text-xs font-bold text-gray-500 uppercase">Marketing Message / Body</label>
						<textarea
							id="camp-content"
							rows="4"
							bind:value={campContent}
							required
							placeholder="Type your message copy here..."
							class="w-full text-sm border-gray-200 border rounded-lg p-2.5 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary resize-none"
						></textarea>
					</div>

					<div class="flex items-center justify-end gap-3 pt-2">
						<button
							type="button"
							onclick={() => showCreateModal = false}
							class="text-xs font-semibold text-gray-500 hover:text-gray-700 py-2 px-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition"
						>
							Cancel
						</button>
						<button
							type="submit"
							class="text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 py-2 px-4 rounded-lg shadow-sm transition"
						>
							Establish Campaign
						</button>
					</div>
				</form>
			</div>
		</div>
	{/if}
</div>
