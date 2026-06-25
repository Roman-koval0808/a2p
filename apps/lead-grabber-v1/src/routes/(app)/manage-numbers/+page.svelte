<script lang="ts">
	import {
		ChevronDown,
		Search,
		Trash2,
		Phone,
		MessageSquare,
		Mail,
		Image as ImageIcon,
		Play,
		FileText,
		Settings,
		User,
		Plus,
		Download,
		Copy,
		AlertTriangle
	} from 'lucide-svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import * as Dialog from '$lib/components/ui/dialog/index';
	import { Button } from '$lib/components/ui/button/index';

	let activeTab = $state<'myNumber' | 'messaging' | 'voice'>('myNumber');
	let messagingSubTab = $state<'numbers' | 'orders'>('numbers');
	let searchQuery = $state('');
	let verifiedSearchQuery = $state('');
	let selectedNumbers = $state<Set<string>>(new Set());
	let numbers = $state<any[]>([]);
	let verifiedNumbers = $state<any[]>([]);
	type CompanyNumber = {
		id: string;
		phoneNumber: string;
		connectionLabel?: string | null;
		callFlowId?: string | null;
		callFlow?: { id: string; title: string } | null;
		callTrackingCategoryId?: string | null;
		callTrackingCategory?: { id: string; name: string } | null;
	};
	let companyNumbers = $state<CompanyNumber[]>([]);
	let ivrFlows = $state<{ id: string; title: string }[]>([]);
	let callTrackingCategories = $state<{ id: string; name: string }[]>([]);
	let numberOrders = $state<any[]>([]);
	let isLoading = $state(false);
	let updatingFlowId = $state<string | null>(null);
	let numberToDelete = $state<{ id: string; number: string } | null>(null);
	let deleteDialogOpen = $state(false);
	let isDeleting = $state(false);

	// Mock data for numbers (fallback)
	const mockNumbers = [
		{
			number: '+1 705 243 8416',
			status: 'Active',
			connection: 'ClearSky Software',
			messagingProfile: 'ClearSky Software'
		},
		{
			number: '+1 705 243 8417',
			status: 'Active',
			connection: 'ClearSky Software',
			messagingProfile: 'ClearSky Software'
		},
		{
			number: '+1 705 243 8418',
			status: 'Active',
			connection: 'ClearSky Software',
			messagingProfile: '-'
		},
		{
			number: '+1 705 243 8419',
			status: 'Active',
			connection: 'ClearSky Software',
			messagingProfile: 'ClearSky Software'
		},
		{
			number: '+1 705 243 8420',
			status: 'Active',
			connection: 'ClearSky Software',
			messagingProfile: 'ClearSky Software'
		},
		{
			number: '+1 705 243 8421',
			status: 'Active',
			connection: 'ClearSky Software',
			messagingProfile: 'ClearSky Software'
		},
		{
			number: '+1 705 243 8422',
			status: 'Active',
			connection: 'ClearSky Software',
			messagingProfile: '-'
		},
		{
			number: '+1 705 243 8423',
			status: 'Active',
			connection: 'ClearSky Software',
			messagingProfile: 'ClearSky Software'
		},
		{
			number: '+1 705 243 8424',
			status: 'Active',
			connection: 'ClearSky Software',
			messagingProfile: 'ClearSky Software'
		},
		{
			number: '+1 705 243 8425',
			status: 'Active',
			connection: 'ClearSky Software',
			messagingProfile: 'ClearSky Software'
		},
		{
			number: '+1 705 243 8426',
			status: 'Active',
			connection: 'ClearSky Software',
			messagingProfile: '-'
		},
		{
			number: '+1 705 243 8427',
			status: 'Active',
			connection: 'ClearSky Software',
			messagingProfile: 'ClearSky Software'
		},
		{
			number: '+1 705 243 8428',
			status: 'Active',
			connection: 'ClearSky Software',
			messagingProfile: 'ClearSky Software'
		},
		{
			number: '+1 705 243 8429',
			status: 'Active',
			connection: 'ClearSky Software',
			messagingProfile: 'ClearSky Software'
		},
		{
			number: '+1 705 243 8430',
			status: 'Active',
			connection: 'ClearSky Software',
			messagingProfile: '-'
		}
	];

	function toggleNumber(number: string) {
		const newSelected = new Set(selectedNumbers);
		if (newSelected.has(number)) {
			newSelected.delete(number);
		} else {
			newSelected.add(number);
		}
		selectedNumbers = newSelected;
	}

	function toggleAllNumbers() {
		if (selectedNumbers.size === numbers.length) {
			selectedNumbers = new Set();
		} else {
			selectedNumbers = new Set(numbers.map((n) => n.number));
		}
	}

	function handleBuyNumbers() {
		goto('/buy-number');
	}

	function handleBulkUpdate() {
		// TODO: Implement bulk update
		console.log('Bulk update:', Array.from(selectedNumbers));
	}

	function handleExport() {
		// TODO: Implement export
		console.log('Export');
	}

	async function loadNumbers() {
		isLoading = true;
		try {
			const [listRes, companyRes, flowsRes, categoriesRes] = await Promise.all([
				fetch(
					`/api/telnyx/numbers/list?${new URLSearchParams(searchQuery ? { search: searchQuery } : {}).toString()}`
				),
				fetch('/api/company-numbers'),
				fetch('/api/ivr/flows'),
				fetch('/api/call-tracking-categories')
			]);
			const listResult = await listRes.json();
			const companyResult = await companyRes.json();
			const flowsResult = await flowsRes.json();
			const categoriesResult = await categoriesRes.json();
			if (listResult.success) numbers = listResult.numbers;
			else toast.error(listResult.error || 'Failed to load numbers');
			if (companyResult.success) companyNumbers = companyResult.numbers;
			if (flowsResult.flows)
				ivrFlows = flowsResult.flows.map((f: { id: string; title: string }) => ({
					id: f.id,
					title: f.title
				}));
			if (categoriesResult.success) callTrackingCategories = categoriesResult.categories;
		} catch (error) {
			console.error('Error loading numbers:', error);
			toast.error('Error loading numbers');
		} finally {
			isLoading = false;
		}
	}

	function isAssigned(phoneNumber: string): CompanyNumber | null {
		const n = phoneNumber.replace(/\D/g, '');
		const match = companyNumbers.find((c) => (c.phoneNumber || '').replace(/\D/g, '') === n);
		return match ?? null;
	}

	async function handleIvrFlowChange(cpId: string, callFlowId: string | null) {
		updatingFlowId = cpId;
		try {
			const res = await fetch(`/api/company-numbers/${cpId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ callFlowId: callFlowId || null })
			});
			const result = await res.json();
			if (result.success && result.number) {
				companyNumbers = companyNumbers.map((c) => (c.id === cpId ? result.number : c));
				toast.success(result.number.callFlowId ? 'IVR flow assigned' : 'IVR removed from number');
			} else {
				toast.error(result.error || 'Failed to update IVR');
			}
		} catch (e) {
			toast.error('Failed to update IVR flow');
		} finally {
			updatingFlowId = null;
		}
	}

	async function handleCategoryChange(cpId: string, callTrackingCategoryId: string | null) {
		try {
			const res = await fetch(`/api/company-numbers/${cpId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ callTrackingCategoryId: callTrackingCategoryId || null })
			});
			const result = await res.json();
			if (result.success && result.number) {
				companyNumbers = companyNumbers.map((c) => (c.id === cpId ? result.number : c));
				toast.success('Call tracking category updated');
			} else {
				toast.error(result.error || 'Failed to update category');
			}
		} catch (e) {
			toast.error('Failed to update category');
		}
	}

	async function loadVerifiedNumbers() {
		try {
			const params = new URLSearchParams();
			if (verifiedSearchQuery) {
				params.append('search', verifiedSearchQuery);
			}
			const response = await fetch(`/api/telnyx/verified-numbers?${params.toString()}`);
			const result = await response.json();
			if (result.success) {
				verifiedNumbers = result.numbers;
			}
		} catch (error) {
			console.error('Error loading verified numbers:', error);
		}
	}

	async function loadOrders() {
		try {
			const response = await fetch('/api/telnyx/numbers/orders');
			const result = await response.json();
			if (result.success) numberOrders = result.orders;
			else toast.error(result.error || 'Failed to load orders');
		} catch (error) {
			console.error('Error loading orders:', error);
			toast.error('Error loading orders');
		}
	}

	function truncateId(id: string) {
		if (!id) return '-';
		return id.length > 12 ? id.slice(0, 8) + '…' : id;
	}
	function copyOrderId(id: string) {
		navigator.clipboard.writeText(id);
		toast.success('Order ID copied');
	}

	async function handleConnectionChange(cpId: string, value: string) {
		try {
			const res = await fetch(`/api/company-numbers/${cpId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ connectionLabel: value || null })
			});
			const result = await res.json();
			if (result.success && result.number) {
				companyNumbers = companyNumbers.map((c) => (c.id === cpId ? result.number : c));
				toast.success('Connection updated');
			} else {
				toast.error(result.error || 'Failed to update connection');
			}
		} catch (e) {
			toast.error('Failed to update connection');
		}
	}

	$effect(() => {
		if (activeTab === 'myNumber') {
			loadNumbers();
		} else if (activeTab === 'messaging') {
			if (messagingSubTab === 'numbers') loadNumbers();
			else if (messagingSubTab === 'orders') loadOrders();
		} else if (activeTab === 'voice') {
			loadVerifiedNumbers();
		}
	});

	$effect(() => {
		if (activeTab === 'myNumber' && searchQuery) {
			const timeout = setTimeout(() => {
				loadNumbers();
			}, 500);
			return () => clearTimeout(timeout);
		}
	});

	$effect(() => {
		if (activeTab === 'voice' && verifiedSearchQuery) {
			const timeout = setTimeout(() => {
				loadVerifiedNumbers();
			}, 500);
			return () => clearTimeout(timeout);
		}
	});

	function openDeleteDialog(num: { id: string; number: string }) {
		numberToDelete = { id: num.id, number: num.number };
		deleteDialogOpen = true;
	}

	async function confirmDelete() {
		if (!numberToDelete) return;
		isDeleting = true;
		try {
			const response = await fetch(`/api/telnyx/numbers/${numberToDelete.id}`, {
				method: 'DELETE'
			});
			const result = await response.json();
			if (result.success) {
				toast.success('Number deleted');
				deleteDialogOpen = false;
				numberToDelete = null;
				await loadNumbers();
			} else {
				toast.error(result.error || 'Failed to delete number');
			}
		} catch (error) {
			console.error('Error deleting number:', error);
			toast.error('Error deleting number');
		} finally {
			isDeleting = false;
		}
	}
</script>

<div class="min-h-screen bg-gray-50 p-6 font-sans">
	{#if page.url.searchParams.get('buy_number_first') === '1'}
		<div
			class="mb-6 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 font-sans text-sm leading-[22px] text-amber-900 shadow-sm"
		>
			<strong>IVR requires a phone number.</strong> You must buy or assign at least one phone number
			to your company before using Call Flows (IVR). Buy or assign a number below, then return to IVR.
		</div>
	{/if}
	<!-- Header -->
	<div class="mb-6 flex items-center justify-between border-b border-gray-200 pb-5">
		<div>
			<h1 class="text-xl font-bold text-gray-800 font-sans">My Numbers</h1>
			<p class="text-xs text-gray-500 mt-1">Manage your active phone numbers, configure messaging profiles, assign IVR flows and set up call tracking.</p>
		</div>
	</div>

	<!-- Main Content Card -->
	<div class="rounded-lg bg-white p-6 border border-gray-200 shadow-sm">
		<!-- Tabs -->
		<div class="mb-6 border-b border-gray-200">
			<div class="-mb-px flex gap-6">
				<button
					class="relative pb-3 font-sans text-sm font-semibold transition-all {activeTab === 'myNumber' ? 'text-[#577AB7] border-b-2 border-[#577AB7]' : 'text-gray-400 hover:text-gray-600 border-b-2 border-transparent'}"
					onclick={() => (activeTab = 'myNumber')}
				>
					My Number
				</button>
				<button
					class="relative pb-3 font-sans text-sm font-semibold transition-all {activeTab === 'messaging' ? 'text-[#577AB7] border-b-2 border-[#577AB7]' : 'text-gray-400 hover:text-gray-600 border-b-2 border-transparent'}"
					onclick={() => (activeTab = 'messaging')}
				>
					Messaging
				</button>
				<button
					class="relative pb-3 font-sans text-sm font-semibold transition-all {activeTab === 'voice' ? 'text-[#577AB7] border-b-2 border-[#577AB7]' : 'text-gray-400 hover:text-gray-600 border-b-2 border-transparent'}"
					onclick={() => (activeTab = 'voice')}
				>
					Voice
				</button>
			</div>
		</div>

		{#if activeTab === 'messaging'}
			<!-- Hosted Messaging Numbers Content -->
			<div class="space-y-6">
				<!-- Title -->
				<div>
					<h2 class="font-sans text-lg font-bold text-gray-800">
						Hosted Messaging Numbers
					</h2>
					<p class="font-sans text-sm text-gray-500 mt-1">
						Hosted SMS allows you to enable SMS/MMS services on numbers that have existing voice
						services from another provider. The numbers could also be for landlines that
						traditionally have never had SMS capabilities.
					</p>
				</div>

				<!-- Sub-tabs and Create Button -->
				<div class="flex items-center justify-between border-b border-gray-200 pb-2">
					<div class="-mb-px flex gap-6">
						<button
							class="relative pb-2 font-sans text-sm font-semibold transition-all {messagingSubTab === 'numbers' ? 'text-[#577AB7] border-b-2 border-[#577AB7]' : 'text-gray-400 hover:text-gray-600 border-b-2 border-transparent'}"
							onclick={() => (messagingSubTab = 'numbers')}
						>
							Numbers
						</button>
						<button
							class="relative pb-2 font-sans text-sm font-semibold transition-all {messagingSubTab === 'orders' ? 'text-[#577AB7] border-b-2 border-[#577AB7]' : 'text-gray-400 hover:text-gray-600 border-b-2 border-transparent'}"
							onclick={() => (messagingSubTab = 'orders')}
						>
							Orders
						</button>
					</div>
					<button
						onclick={() => goto('/manage-numbers/create-order')}
						class="h-9 rounded-md bg-[#577AB7] px-4 font-sans text-sm font-medium text-white shadow-sm transition-colors hover:bg-[#4a6ba5]"
					>
						Create New Order
					</button>
				</div>

				<!-- Table Container -->
				<div class="rounded-lg border border-gray-200 bg-white overflow-hidden shadow-sm">
					{#if messagingSubTab === 'numbers'}
						<div class="border-b border-gray-200 bg-gray-50/50 px-4 py-3">
							<div
								class="grid grid-cols-4 gap-4 font-sans text-xs font-semibold uppercase tracking-wider text-gray-500"
							>
								<div>Number</div>
								<div>Messaging Profile</div>
								<div>Features</div>
								<div>Created At</div>
							</div>
						</div>
						{#if isLoading}
							<div class="flex h-[200px] items-center justify-center text-gray-400 font-sans">
								Loading...
							</div>
						{:else if numbers.length === 0}
							<div class="flex h-[200px] items-center justify-center">
								<p class="font-sans text-sm font-medium text-gray-400">
									No numbers found.
								</p>
							</div>
						{:else}
							<div class="divide-y divide-gray-100">
								{#each numbers as num}
									<div class="grid grid-cols-4 gap-4 px-4 py-3 hover:bg-gray-50/50 transition-colors items-center">
										<div class="font-sans text-sm font-medium text-gray-700">{num.number}</div>
										<div class="font-sans text-sm text-gray-500">
											{num.messagingProfile}
										</div>
										<div class="flex gap-1.5">
											{#if num.features?.sms}
												<span class="inline-flex items-center rounded-md bg-blue-50 px-1.5 py-0.5 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-700/10" title="SMS">
													<MessageSquare class="h-3 w-3 mr-0.5" /> SMS
												</span>
											{/if}
											{#if num.features?.voice}
												<span class="inline-flex items-center rounded-md bg-purple-50 px-1.5 py-0.5 text-xs font-medium text-purple-700 ring-1 ring-inset ring-purple-700/10" title="Voice">
													<Phone class="h-3 w-3 mr-0.5" /> Voice
												</span>
											{/if}
										</div>
										<div class="font-sans text-sm text-gray-400">-</div>
									</div>
								{/each}
							</div>
						{/if}
					{:else}
						<!-- Orders sub-tab -->
						<div class="max-h-[400px] overflow-x-auto overflow-y-auto">
							<table class="w-full min-w-[800px]">
								<thead class="sticky top-0 z-10 bg-gray-50 border-b border-gray-200">
									<tr>
										<th class="py-3 px-4 text-left font-sans text-xs font-semibold uppercase tracking-wider text-gray-500">Date</th>
										<th class="py-3 px-4 text-left font-sans text-xs font-semibold uppercase tracking-wider text-gray-500">Status</th>
										<th class="py-3 px-4 text-left font-sans text-xs font-semibold uppercase tracking-wider text-gray-500">Country</th>
										<th class="py-3 px-4 text-left font-sans text-xs font-semibold uppercase tracking-wider text-gray-500">Order ID</th>
										<th class="py-3 px-4 text-left font-sans text-xs font-semibold uppercase tracking-wider text-gray-500">SubOrder ID</th>
										<th class="py-3 px-4 text-left font-sans text-xs font-semibold uppercase tracking-wider text-gray-500">Actor</th>
										<th class="py-3 px-4 text-left font-sans text-xs font-semibold uppercase tracking-wider text-gray-500">Number Type</th>
									</tr>
								</thead>
								<tbody class="divide-y divide-gray-100">
									{#if numberOrders.length === 0}
										<tr>
											<td colspan="7" class="py-8 text-center font-sans text-sm text-gray-400">No orders found.</td>
										</tr>
									{:else}
										{#each numberOrders as order}
											<tr class="hover:bg-gray-50/50 transition-colors">
												<td class="py-3 px-4 font-sans text-sm text-gray-600">{order.date}</td>
												<td class="py-3 px-4">
													<div class="flex items-center gap-2">
														<span class="relative flex h-2 w-2">
															<span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
															<span class="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
														</span>
														<span class="font-sans text-sm font-medium text-gray-700">{order.status}</span>
													</div>
												</td>
												<td class="py-3 px-4 font-sans text-sm text-gray-500">{order.country}</td>
												<td class="py-3 px-4">
													<div class="flex items-center gap-2">
														<span class="font-mono text-xs text-gray-600">{truncateId(order.orderId)}</span>
														<button
															type="button"
															onclick={() => copyOrderId(order.orderId)}
															class="cursor-pointer text-gray-400 hover:text-gray-600 transition-colors"
														>
															<Copy class="h-3.5 w-3.5" />
														</button>
													</div>
												</td>
												<td class="py-3 px-4">
													<div class="flex items-center gap-2">
														<span class="font-mono text-xs text-gray-600">{truncateId(order.subOrderId)}</span>
														<button
															type="button"
															onclick={() => copyOrderId(order.subOrderId)}
															class="cursor-pointer text-gray-400 hover:text-gray-600 transition-colors"
														>
															<Copy class="h-3.5 w-3.5" />
														</button>
													</div>
												</td>
												<td class="py-3 px-4 font-sans text-sm text-gray-500">{order.actor}</td>
												<td class="py-3 px-4 font-sans text-sm text-gray-500">{order.numberType}</td>
											</tr>
										{/each}
									{/if}
								</tbody>
							</table>
						</div>
					{/if}
				</div>
			</div>
		{:else if activeTab === 'voice'}
			<!-- Verified Numbers Content -->
			<div class="space-y-6">
				<!-- Title -->
				<div>
					<h2 class="font-sans text-lg font-bold text-gray-800">
						Verified Numbers
					</h2>
					<p class="font-sans text-sm text-gray-500 mt-1">
						Verified Numbers enable you to use that number as a Calling Line Identity (CLI) on your
						outbound calls done through Telnyx.
					</p>
				</div>

				<!-- Search and Verify Button -->
				<div class="flex items-center gap-4">
					<div class="relative flex-1">
						<input
							type="text"
							bind:value={verifiedSearchQuery}
							placeholder="Search numbers starting with....."
							class="h-10 w-full rounded-md border border-gray-200 bg-white px-3 pr-10 font-sans text-sm text-gray-700 outline-none shadow-sm placeholder:text-gray-400 focus:border-[#577AB7] focus:ring-1 focus:ring-[#577AB7] transition-all"
						/>
						<Search
							class="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
						/>
					</div>
					<button
						onclick={() => goto('/manage-numbers/verify')}
						class="h-10 rounded-md bg-[#577AB7] px-4 font-sans text-sm font-medium text-white shadow-sm transition-colors hover:bg-[#4a6ba5]"
					>
						Verify Number
					</button>
				</div>

				<!-- Table Container -->
				<div class="rounded-lg border border-gray-200 bg-white overflow-hidden shadow-sm">
					<!-- Table Headers -->
					<div class="border-b border-gray-200 bg-gray-50/50 px-4 py-3">
						<div
							class="grid grid-cols-2 gap-4 font-sans text-xs font-semibold uppercase tracking-wider text-gray-500"
						>
							<div>Phone Number</div>
							<div>Verified At</div>
						</div>
					</div>

					<!-- Table Rows -->
					<div class="divide-y divide-gray-100">
						{#if verifiedNumbers.length === 0}
							<div class="px-4 py-8 text-center font-sans text-sm text-gray-400 bg-white">No verified numbers found.</div>
						{:else}
							{#each verifiedNumbers as verified}
								<div class="grid grid-cols-2 gap-4 px-4 py-3 hover:bg-gray-50/50 transition-colors items-center bg-white">
									<div class="font-sans text-sm font-medium text-gray-700">
										{verified.number}
									</div>
									<div class="flex items-center justify-between">
										<span
											class="font-sans text-sm text-gray-500"
										>
											{verified.verifiedAt}
										</span>
										<button class="text-gray-400 transition-colors hover:text-red-500 rounded-md p-1 hover:bg-gray-100">
											<Trash2 class="h-4 w-4" />
										</button>
									</div>
								</div>
							{/each}
						{/if}
					</div>
				</div>
			</div>
		{:else}
			<!-- Search and Buy Numbers Button -->
			<div class="mb-4 flex items-center gap-4">
				<div class="relative flex-1">
					<input
						type="text"
						bind:value={searchQuery}
						placeholder="Enter full or partial number (e.g. last 4 digits)"
						class="h-10 w-full rounded-md border border-gray-200 bg-white px-3 pr-10 font-sans text-sm text-gray-700 outline-none shadow-sm placeholder:text-gray-400 focus:border-[#577AB7] focus:ring-1 focus:ring-[#577AB7] transition-all"
					/>
					<Search
						class="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
					/>
				</div>
				<button
					onclick={handleBuyNumbers}
					class="h-10 rounded-md bg-[#577AB7] px-4 font-sans text-sm font-medium text-white shadow-sm transition-colors hover:bg-[#4a6ba5]"
				>
					Buy Numbers
				</button>
			</div>

			<!-- Filter Dropdowns and Action Buttons -->
			<div class="mb-4 flex flex-wrap items-center justify-between gap-4">
				<div class="flex flex-wrap items-center gap-2">
					<!-- Status -->
					<div class="relative">
						<select
							class="min-w-[90px] appearance-none rounded-md border border-gray-200 bg-white pl-3 pr-8 py-1.5 font-sans text-xs font-medium text-gray-600 outline-none shadow-sm focus:border-[#577AB7] focus:ring-1 focus:ring-[#577AB7] transition-all cursor-pointer"
						>
							<option>Status</option>
						</select>
						<ChevronDown
							class="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400"
						/>
					</div>

					<!-- Tags -->
					<div class="relative">
						<select
							class="min-w-[80px] appearance-none rounded-md border border-gray-200 bg-white pl-3 pr-8 py-1.5 font-sans text-xs font-medium text-gray-600 outline-none shadow-sm focus:border-[#577AB7] focus:ring-1 focus:ring-[#577AB7] transition-all cursor-pointer"
						>
							<option>Tags</option>
						</select>
						<ChevronDown
							class="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400"
						/>
					</div>

					<!-- Connection -->
					<div class="relative">
						<select
							class="min-w-[120px] appearance-none rounded-md border border-gray-200 bg-white pl-3 pr-8 py-1.5 font-sans text-xs font-medium text-gray-600 outline-none shadow-sm focus:border-[#577AB7] focus:ring-1 focus:ring-[#577AB7] transition-all cursor-pointer"
						>
							<option>Connection</option>
						</select>
						<ChevronDown
							class="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400"
						/>
					</div>

					<!-- Messaging Profile -->
					<div class="relative">
						<select
							class="min-w-[150px] appearance-none rounded-md border border-gray-200 bg-white pl-3 pr-8 py-1.5 font-sans text-xs font-medium text-gray-600 outline-none shadow-sm focus:border-[#577AB7] focus:ring-1 focus:ring-[#577AB7] transition-all cursor-pointer"
						>
							<option>Messaging Profile</option>
						</select>
						<ChevronDown
							class="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400"
						/>
					</div>

					<!-- Voice Billing Method -->
					<div class="relative">
						<select
							class="min-w-[160px] appearance-none rounded-md border border-gray-200 bg-white pl-3 pr-8 py-1.5 font-sans text-xs font-medium text-gray-600 outline-none shadow-sm focus:border-[#577AB7] focus:ring-1 focus:ring-[#577AB7] transition-all cursor-pointer"
						>
							<option>Voice Billing Method</option>
						</select>
						<ChevronDown
							class="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400"
						/>
					</div>

					<!-- Emergency Status -->
					<div class="relative">
						<select
							class="min-w-[150px] appearance-none rounded-md border border-gray-200 bg-white pl-3 pr-8 py-1.5 font-sans text-xs font-medium text-gray-600 outline-none shadow-sm focus:border-[#577AB7] focus:ring-1 focus:ring-[#577AB7] transition-all cursor-pointer"
						>
							<option>Emergency Status</option>
						</select>
						<ChevronDown
							class="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400"
						/>
					</div>

					<!-- Countries -->
					<div class="relative">
						<select
							class="min-w-[110px] appearance-none rounded-md border border-gray-200 bg-white pl-3 pr-8 py-1.5 font-sans text-xs font-medium text-gray-600 outline-none shadow-sm focus:border-[#577AB7] focus:ring-1 focus:ring-[#577AB7] transition-all cursor-pointer"
						>
							<option>Countries</option>
						</select>
						<ChevronDown
							class="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400"
						/>
					</div>
				</div>

				<div class="flex items-center gap-2">
					<button
						onclick={handleBulkUpdate}
						class="flex h-8 items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-3 font-sans text-xs font-semibold text-gray-600 shadow-sm transition-colors hover:bg-gray-100 hover:text-gray-900"
					>
						Bulk Update
					</button>
					<button
						onclick={handleExport}
						class="flex h-8 items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-3 font-sans text-xs font-semibold text-gray-600 shadow-sm transition-colors hover:bg-gray-100 hover:text-gray-900"
					>
						<Download class="h-3.5 w-3.5" />
						Export
					</button>
				</div>
			</div>

			<!-- Table -->
			<div class="rounded-lg border border-gray-200 bg-white overflow-hidden shadow-sm">
				<div class="max-h-[391px] overflow-x-auto overflow-y-auto">
					<table class="w-full min-w-[1069px]">
						<thead class="sticky top-0 z-10 bg-gray-50 border-b border-gray-200">
							<tr>
								<th class="py-3 pl-4 pr-3 text-left">
									<input
										type="checkbox"
										checked={selectedNumbers.size === numbers.length && numbers.length > 0}
										onchange={toggleAllNumbers}
										class="h-4 w-4 rounded border-gray-300 text-[#577AB7] focus:ring-[#577AB7]"
									/>
								</th>
								<th class="py-3 px-4 text-left font-sans text-xs font-semibold uppercase tracking-wider text-gray-500">
									Number
								</th>
								<th class="py-3 px-4 text-left font-sans text-xs font-semibold uppercase tracking-wider text-gray-500">
									Status
								</th>
								<th class="py-3 px-4 text-left font-sans text-xs font-semibold uppercase tracking-wider text-gray-500">
									Connection/Application
								</th>
								<th class="py-3 px-4 text-left font-sans text-xs font-semibold uppercase tracking-wider text-gray-500">
									Messaging Profile
								</th>
								<th class="py-3 px-4 text-left font-sans text-xs font-semibold uppercase tracking-wider text-gray-500">
									Services
								</th>
								<th class="py-3 px-4 text-left font-sans text-xs font-semibold uppercase tracking-wider text-gray-500">
									Tags
								</th>
								<th class="py-3 px-4 text-left font-sans text-xs font-semibold uppercase tracking-wider text-gray-500">
									IVR Flow
								</th>
								<th class="py-3 px-4 text-left font-sans text-xs font-semibold uppercase tracking-wider text-gray-500">
									Call tracking
								</th>
								<th class="py-3 px-4 text-left font-sans text-xs font-semibold uppercase tracking-wider text-gray-500">
									Action
								</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-gray-100 bg-white">
							{#if isLoading}
								<tr>
									<td colspan="10" class="py-8 text-center text-gray-400 font-sans text-sm"> Loading... </td>
								</tr>
							{:else if numbers.length === 0}
								<tr>
									<td colspan="10" class="py-8 text-center text-gray-400 font-sans text-sm"> No numbers found. </td>
								</tr>
							{:else}
								{#each numbers as num}
									{@const assigned = isAssigned(num.number)}
									<tr class="hover:bg-gray-50/50 transition-colors">
										<td class="py-3 pl-4 pr-3">
											<input
												type="checkbox"
												checked={selectedNumbers.has(num.number)}
												onchange={() => toggleNumber(num.number)}
												class="h-4 w-4 rounded border-gray-300 text-[#577AB7] focus:ring-[#577AB7]"
											/>
										</td>
										<td
											class="py-3 px-4 font-sans text-sm font-semibold text-gray-700"
										>
											{num.number}
										</td>
										<td class="py-3 px-4">
											<div class="flex items-center gap-2">
												<span class="relative flex h-2 w-2">
													<span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
													<span class="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
												</span>
												<span
													class="font-sans text-xs font-medium text-gray-600"
												>
													{num.status}
												</span>
											</div>
										</td>
										<td
											class="py-3 px-4"
										>
											{#if assigned}
												<div class="flex flex-col gap-1">
									
													<input
														type="text"
														class="min-w-[160px] rounded-md border border-gray-200 bg-white px-2 py-1 font-sans text-xs text-gray-700 outline-none focus:border-[#577AB7] focus:ring-1 focus:ring-[#577AB7] transition-all shadow-sm"
														value={assigned.connectionLabel ?? ''}
														placeholder="Enter connection"
														onblur={(e) => handleConnectionChange(assigned.id, e.currentTarget.value)}
													/>
												</div>
											{:else}
												<span class="text-gray-300">—</span>
											{/if}
										</td>
										<td
											class="py-3 px-4 font-sans text-sm text-gray-500"
										>
											{num.messagingProfile}
										</td>
										<td class="py-3 px-4">
											<div class="flex gap-1.5">
												{#if num.features?.sms}
													<span class="inline-flex items-center rounded-md bg-blue-50 px-1.5 py-0.5 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-700/10" title="SMS">
														<MessageSquare class="h-3 w-3 mr-0.5" /> SMS
													</span>
												{/if}
												{#if num.features?.voice}
													<span class="inline-flex items-center rounded-md bg-purple-50 px-1.5 py-0.5 text-xs font-medium text-purple-700 ring-1 ring-inset ring-purple-700/10" title="Voice">
														<Phone class="h-3 w-3 mr-0.5" /> Voice
													</span>
												{/if}
											</div>
										</td>
										<td class="py-3 px-4">
											<button class="text-gray-400 hover:text-[#577AB7] transition-colors rounded-md p-1 hover:bg-gray-100">
												<Plus class="h-4 w-4" />
											</button>
										</td>
										<td class="py-3 px-4">
											{#if assigned}
												<div class="relative inline-block">
													<select
														class="min-w-[140px] appearance-none rounded-md border border-gray-200 bg-white pl-2 pr-7 py-1 font-sans text-xs text-gray-700 outline-none disabled:opacity-50 shadow-sm focus:border-[#577AB7] focus:ring-1 focus:ring-[#577AB7] transition-all cursor-pointer"
														disabled={updatingFlowId === assigned.id}
														value={assigned.callFlowId ?? ''}
														onchange={(e) =>
															handleIvrFlowChange(
																assigned.id,
																(e.currentTarget.value || null) as string | null
															)}
													>
														<option value="">No IVR</option>
														{#each ivrFlows as flow}
															<option value={flow.id}>{flow.title}</option>
														{/each}
													</select>
													<ChevronDown class="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
												</div>
											{:else}
												<span class="text-gray-300">—</span>
											{/if}
										</td>
										<td class="py-3 px-4">
											{#if assigned}
												<div class="relative inline-block">
													<select
														class="min-w-[120px] appearance-none rounded-md border border-gray-200 bg-white pl-2 pr-7 py-1 font-sans text-xs text-gray-700 outline-none shadow-sm focus:border-[#577AB7] focus:ring-1 focus:ring-[#577AB7] transition-all cursor-pointer"
														value={assigned.callTrackingCategoryId ?? ''}
														onchange={(e) =>
															handleCategoryChange(
																assigned.id,
																(e.currentTarget.value || null) as string | null
															)}
													>
														<option value="">—</option>
														{#each callTrackingCategories as cat}
															<option value={cat.id}>{cat.name}</option>
														{/each}
													</select>
													<ChevronDown class="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
												</div>
											{:else}
												<span class="text-gray-300">—</span>
											{/if}
										</td>
										<td class="py-3 px-4">
											<button
												onclick={() => openDeleteDialog(num)}
												class="text-gray-400 transition-colors hover:text-red-500 rounded-md p-1 hover:bg-gray-100"
												aria-label="Delete"
											>
												<Trash2 class="h-4 w-4" />
											</button>
										</td>
									</tr>
								{/each}
							{/if}
						</tbody>
					</table>
				</div>
			</div>
		{/if}
	</div>

	<!-- Delete number danger dialog -->
	<Dialog.Root bind:open={deleteDialogOpen}>
		<Dialog.Portal>
			<Dialog.Overlay />
			<Dialog.Content class="max-w-md border-red-200 bg-white shadow-lg">
				<Dialog.Header>
					<Dialog.Title class="flex items-center gap-2 text-red-700">
						<AlertTriangle class="h-5 w-5 shrink-0" />
						Delete phone number
					</Dialog.Title>
					<Dialog.Description class="text-[#555]">
						{#if numberToDelete}
							You are about to delete <strong>{numberToDelete.number}</strong>. This action cannot
							be undone. You will need to pay for a new number, the deleted number cannot be
							recovered.
						{/if}
					</Dialog.Description>
				</Dialog.Header>
				<div class="flex justify-end gap-2 pt-4">
					<Button
						variant="outline"
						onclick={() => (deleteDialogOpen = false)}
						disabled={isDeleting}
					>
						Cancel
					</Button>
					<Button variant="destructive" onclick={confirmDelete} disabled={isDeleting}>
						{isDeleting ? 'Deleting…' : 'Delete number'}
					</Button>
				</div>
			</Dialog.Content>
		</Dialog.Portal>
	</Dialog.Root>
</div>
