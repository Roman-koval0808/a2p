<script lang="ts">
	import {
		ChevronDown,
		Phone,
		MessageSquare,
		Mail,
		Image as ImageIcon,
		Copy,
		Filter,
		Download,
		SlidersHorizontal
	} from 'lucide-svelte';
	import { toast } from 'svelte-sonner';
	import AreaCodeSelector from '$lib/components/AreaCodeSelector.svelte';

	// Options for dynamic dropdowns (Telnyx-supported)
	const COUNTRY_OPTIONS = [
		{ label: 'United States +1', code: 'US' },
		{ label: 'Canada +1', code: 'CA' },
		{ label: 'United Kingdom +44', code: 'GB' },
		{ label: 'Australia +61', code: 'AU' },
		{ label: 'Ireland +353', code: 'IE' },
		{ label: 'France +33', code: 'FR' },
		{ label: 'Germany +49', code: 'DE' },
		{ label: 'Spain +34', code: 'ES' },
		{ label: 'Netherlands +31', code: 'NL' },
		{ label: 'Belgium +32', code: 'BE' }
	] as const;
	const FEATURE_OPTIONS = [
		{ value: '', label: 'Any features' },
		{ value: 'voice', label: 'Voice' },
		{ value: 'sms', label: 'SMS' },
		{ value: 'mms', label: 'MMS' },
		{ value: 'emergency', label: 'Emergency' }
	];
	const SEARCH_BY_OPTIONS = ['Area Code', 'Phone number (contains)'] as const;

	let activeTab = $state<'buy' | 'orders'>('buy');
	let country = $state('US');
	let features = $state('');
	let searchBy = $state<'Area Code' | 'Phone number (contains)'>('Area Code');
	let areaCode = $state('');
	let selectedNumbers = $state<Set<string>>(new Set());
	let phoneNumbers = $state<any[]>([]);
	let isLoading = $state(false);
	let cart = $state<Set<string>>(new Set());

	let numberOrders = $state<any[]>([]);

	function toggleNumber(number: string) {
		if (selectedNumbers.has(number)) {
			selectedNumbers.delete(number);
		} else {
			selectedNumbers.add(number);
		}
		selectedNumbers = selectedNumbers;
	}

	async function loadOrders() {
		try {
			const response = await fetch('/api/telnyx/numbers/orders');
			const result = await response.json();
			if (result.success) {
				numberOrders = result.orders;
			}
		} catch (error) {
			console.error('Error loading orders:', error);
		}
	}

	$effect(() => {
		if (activeTab === 'orders') {
			loadOrders();
		}
	});

	function handleAddToCart(number: string) {
		const newCart = new Set(cart);
		if (newCart.has(number)) {
			newCart.delete(number);
		} else {
			newCart.add(number);
		}
		cart = newCart;
		toast.success(newCart.has(number) ? 'Added to cart' : 'Removed from cart');
	}

	async function handleSearch() {
		const isAreaCode = searchBy === 'Area Code';
		if (!areaCode.trim()) {
			toast.error(isAreaCode ? 'Please enter an area code' : 'Enter digits to search by number');
			return;
		}

		isLoading = true;
		try {
			const params = new URLSearchParams({
				country_code: country
			});

			if (isAreaCode) {
				params.append('area_code', areaCode.trim());
			} else {
				params.append('phone_number', areaCode.trim());
			}

			if (features) {
				params.append('features', features);
			}

			const response = await fetch(`/api/telnyx/numbers/search?${params.toString()}`);
			const result = await response.json();

			if (result.success) {
				phoneNumbers = result.numbers;
				toast.success(`Found ${result.numbers.length} numbers`);
			} else {
				toast.error(result.error || 'Failed to search numbers');
				phoneNumbers = [];
			}
		} catch (error) {
			console.error('Search error:', error);
			toast.error('Error searching numbers');
			phoneNumbers = [];
		} finally {
			isLoading = false;
		}
	}

	async function handleBuySelected() {
		if (cart.size === 0) {
			toast.error('Please select numbers to buy');
			return;
		}

		isLoading = true;
		try {
			const response = await fetch('/api/telnyx/numbers/buy', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					phone_numbers: Array.from(cart)
				})
			});

			const result = await response.json();

			if (result.success) {
				toast.success(`Successfully purchased ${cart.size} number(s)`);
				cart = new Set();
				phoneNumbers = [];
				await loadOrders();
			} else {
				toast.error(result.error || 'Failed to purchase numbers');
			}
		} catch (error) {
			console.error('Buy error:', error);
			toast.error('Error purchasing numbers');
		} finally {
			isLoading = false;
		}
	}

	function copyOrderId(id: string) {
		navigator.clipboard.writeText(id);
		toast.success('Order ID copied to clipboard');
	}

	function truncateId(id: string): string {
		return id.substring(0, 12) + '...';
	}

	function handleFilters() {
		// TODO: Implement filters
		console.log('Filters clicked');
	}

	function handleExport() {
		// TODO: Implement export
		console.log('Export clicked');
	}
</script>

<div class="min-h-screen bg-gray-50 p-6 font-sans">
	<!-- Header -->
	<div class="mb-6 flex items-center justify-between border-b border-gray-200 pb-5">
		<div>
			<h1 class="text-xl font-bold text-gray-800 font-sans font-sans">Buy Numbers</h1>
			<p class="text-xs text-gray-500 mt-1">Search and purchase direct inward dialing (DID) numbers from Telnyx.</p>
		</div>
	</div>

	<!-- Main Content Card -->
	<div class="rounded-lg bg-white p-6 border border-gray-200 shadow-sm">
		<!-- Tabs -->
		<div class="mb-6 border-b border-gray-200">
			<div class="-mb-px flex gap-6">
				<button
					class="relative pb-3 font-sans text-sm font-semibold transition-all {activeTab === 'buy' ? 'text-[#577AB7] border-b-2 border-[#577AB7]' : 'text-gray-400 hover:text-gray-600 border-b-2 border-transparent'}"
					onclick={() => (activeTab = 'buy')}
				>
					Buy Number
				</button>
				<button
					class="relative pb-3 font-sans text-sm font-semibold transition-all {activeTab === 'orders' ? 'text-[#577AB7] border-b-2 border-[#577AB7]' : 'text-gray-400 hover:text-gray-600 border-b-2 border-transparent'}"
					onclick={() => (activeTab = 'orders')}
				>
					Number Orders
				</button>
			</div>
		</div>

		{#if activeTab === 'buy'}
			<!-- Filter Section -->
			<div class="mb-6 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
				<div class="mb-4 grid grid-cols-1 md:grid-cols-4 gap-4">
					<!-- Country -->
					<div class="flex flex-col gap-2">
						<div class="flex items-center gap-2">
							<label
								for="country"
								class="font-sans text-sm font-semibold text-gray-700"
							>
								Country
							</label>
							<span
								class="font-sans text-xs font-semibold text-red-500"
							>
								* Required
							</span>
						</div>
						<div class="relative">
							<select
								id="country"
								bind:value={country}
								class="h-10 w-full appearance-none rounded-md border border-gray-200 bg-white pl-3 pr-9 font-sans text-sm text-gray-700 outline-none shadow-sm focus:border-[#577AB7] focus:ring-1 focus:ring-[#577AB7] transition-all cursor-pointer"
							>
								{#each COUNTRY_OPTIONS as opt}
									<option value={opt.code}>{opt.label}</option>
								{/each}
							</select>
							<ChevronDown
								class="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
							/>
						</div>
					</div>

					<!-- Features -->
					<div class="flex flex-col gap-2">
						<label
							for="features"
							class="font-sans text-sm font-semibold text-gray-700"
						>
							Features
						</label>
						<div class="relative">
							<select
								id="features"
								bind:value={features}
								class="h-10 w-full appearance-none rounded-md border border-gray-200 bg-white pl-3 pr-9 font-sans text-sm text-gray-700 outline-none shadow-sm focus:border-[#577AB7] focus:ring-1 focus:ring-[#577AB7] transition-all cursor-pointer"
							>
								{#each FEATURE_OPTIONS as opt}
									<option value={opt.value}>{opt.label}</option>
								{/each}
							</select>
							<ChevronDown
								class="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
							/>
						</div>
					</div>

					<!-- Search by -->
					<div class="flex flex-col gap-2">
						<label
							for="searchBy"
							class="font-sans text-sm font-semibold text-gray-700"
						>
							Search by
						</label>
						<div class="relative">
							<select
								id="searchBy"
								bind:value={searchBy}
								class="h-10 w-full appearance-none rounded-md border border-gray-200 bg-white pl-3 pr-9 font-sans text-sm text-gray-700 outline-none shadow-sm focus:border-[#577AB7] focus:ring-1 focus:ring-[#577AB7] transition-all cursor-pointer"
							>
								{#each SEARCH_BY_OPTIONS as opt}
									<option value={opt}>{opt}</option>
								{/each}
							</select>
							<ChevronDown
								class="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
							/>
						</div>
					</div>

					<!-- Area Code or Number -->
					<div class="flex flex-col gap-2">
						<label
							for="areaCode"
							class="font-sans text-sm font-semibold text-gray-700"
						>
							{searchBy === 'Area Code' ? 'Area Code' : 'Digits (contains)'}
						</label>
						{#if searchBy === 'Area Code'}
							<AreaCodeSelector
								bind:value={areaCode}
								{country}
								placeholder="Select or search area code..."
							/>
						{:else}
							<input
								id="areaCode"
								type="text"
								bind:value={areaCode}
								placeholder="e.g. 562"
								inputmode="numeric"
								pattern="[0-9]*"
								class="h-10 w-full rounded-md border border-gray-200 bg-white px-3 font-sans text-sm text-gray-700 outline-none placeholder:text-gray-400 focus:border-[#577AB7] focus:ring-1 focus:ring-[#577AB7] transition-all shadow-sm"
							/>
						{/if}
					</div>
				</div>

				<!-- Search & Buy Buttons -->
				<div class="flex gap-2">
					<button
						onclick={handleSearch}
						disabled={isLoading}
						class="h-9 rounded-md bg-[#577AB7] px-4 font-sans text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#4a6ba5] disabled:opacity-50"
					>
						{isLoading ? 'Searching...' : 'Search Numbers'}
					</button>
					{#if cart.size > 0}
						<button
							onclick={handleBuySelected}
							disabled={isLoading}
							class="h-9 rounded-md bg-green-600 px-4 font-sans text-sm font-semibold text-white shadow-sm transition-colors hover:bg-green-700 disabled:opacity-50"
						>
							Buy {cart.size} Selected
						</button>
					{/if}
				</div>
			</div>

			<!-- Results Table -->
			<div class="rounded-lg border border-gray-200 bg-white p-6 shadow-sm mt-6">
				<h2 class="mb-4 font-sans text-md font-bold text-gray-800">
					Number Results
				</h2>

				<!-- Table -->
				<div class="max-h-[421px] overflow-y-auto rounded-lg border border-gray-200">
					<table class="w-full">
						<thead class="sticky top-0 z-10 bg-gray-50 border-b border-gray-200">
							<tr>
								<th class="py-3 px-4 text-left font-sans text-xs font-semibold uppercase tracking-wider text-gray-500">
									Number
								</th>
								<th class="py-3 px-4 text-left font-sans text-xs font-semibold uppercase tracking-wider text-gray-500">
									Location/Rate Center
								</th>
								<th class="py-3 px-4 text-left font-sans text-xs font-semibold uppercase tracking-wider text-gray-500">
									Number Type
								</th>
								<th class="py-3 px-4 text-left font-sans text-xs font-semibold uppercase tracking-wider text-gray-500">
									Features
								</th>
								<th class="py-3 px-4 text-left font-sans text-xs font-semibold uppercase tracking-wider text-gray-500">
									Upfront Price
								</th>
								<th class="py-3 px-4 text-left font-sans text-xs font-semibold uppercase tracking-wider text-gray-500">
									Monthly Price
								</th>
								<th class="py-3 px-4 text-left">
								</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-gray-100 bg-white">
							{#if isLoading}
								<tr>
									<td colspan="7" class="py-8 text-center text-gray-400 font-sans text-sm"> Loading... </td>
								</tr>
							{:else if phoneNumbers.length === 0}
								<tr>
									<td colspan="7" class="py-8 text-center text-gray-400 font-sans text-sm">
										No numbers found. Click "Search Numbers" to find available numbers.
									</td>
								</tr>
							{:else}
								{#each phoneNumbers as num, index}
									<tr class="hover:bg-gray-50/50 transition-colors">
										<td class="py-3 px-4">
											<div class="flex items-center gap-3">
												<input
													type="checkbox"
													checked={cart.has(num.number)}
													onchange={() => handleAddToCart(num.number)}
													class="h-4 w-4 rounded border-gray-300 text-[#577AB7] focus:ring-[#577AB7]"
												/>
												<span class="font-sans text-sm font-semibold text-gray-700">
													{num.number}
												</span>
											</div>
										</td>
										<td class="py-3 px-4 font-sans text-sm text-gray-600">
											{num.location}
										</td>
										<td class="py-3 px-4 font-sans text-sm text-gray-500">
											{num.type}
										</td>
										<td class="py-3 px-4">
											<div class="flex gap-1.5">
												{#if num.features?.sms}
													<span class="inline-flex items-center rounded-md bg-blue-50 px-1.5 py-0.5 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-700/10" title="SMS">
														SMS
													</span>
												{/if}
												{#if num.features?.voice}
													<span class="inline-flex items-center rounded-md bg-purple-50 px-1.5 py-0.5 text-xs font-medium text-purple-700 ring-1 ring-inset ring-purple-700/10" title="Voice">
														Voice
													</span>
												{/if}
											</div>
										</td>
										<td class="py-3 px-4 font-sans text-sm text-gray-600">
											{num.upfront}
										</td>
										<td class="py-3 px-4 font-sans text-sm text-gray-600">
											{num.monthly}
										</td>
										<td class="py-3 px-4">
											<button
												onclick={() => handleAddToCart(num.number)}
												class="h-8 px-3 rounded-md transition-colors font-sans text-xs font-semibold shadow-sm {cart.has(num.number)
													? 'bg-green-50 text-green-700 hover:bg-green-100 ring-1 ring-inset ring-green-600/20'
													: 'bg-[#577AB7] text-white hover:bg-[#4a6ba5]'}"
											>
												{cart.has(num.number) ? 'In Cart' : 'Add to Cart'}
											</button>
										</td>
									</tr>
								{/each}
							{/if}
						</tbody>
					</table>
				</div>
			</div>
		{:else}
			<!-- Number Orders Tab Content -->
			<div class="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
				<!-- Filters and Export Buttons -->
				<div class="mb-4 flex justify-end gap-2">
					<button
						onclick={handleFilters}
						class="flex h-8 items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-3 font-sans text-xs font-semibold text-gray-600 shadow-sm transition-colors hover:bg-gray-100 hover:text-gray-900"
					>
						<SlidersHorizontal class="h-3.5 w-3.5" />
						Filters
					</button>
					<button
						onclick={handleExport}
						class="flex h-8 items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-3 font-sans text-xs font-semibold text-gray-600 shadow-sm transition-colors hover:bg-gray-100 hover:text-gray-900"
					>
						<Download class="h-3.5 w-3.5" />
						Export
					</button>
				</div>

				<!-- Table -->
				<div
					class="max-h-[649px] overflow-x-auto overflow-y-auto rounded-lg border border-gray-200"
				>
					<table class="w-full min-w-[1069px]">
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
						<tbody class="divide-y divide-gray-100 bg-white">
							{#if numberOrders.length === 0}
								<tr>
									<td colspan="7" class="py-8 text-center text-gray-400 font-sans text-sm"> No orders found. </td>
								</tr>
							{:else}
								{#each numberOrders as order}
									<tr class="hover:bg-gray-50/50 transition-colors">
										<td class="py-3 px-4 font-sans text-sm text-gray-600">
											{order.date}
										</td>
										<td class="py-3 px-4">
											<div class="flex items-center gap-2">
												<span class="relative flex h-2 w-2">
													<span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
													<span class="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
												</span>
												<span class="font-sans text-sm font-medium text-gray-700">
													{order.status}
												</span>
											</div>
										</td>
										<td class="py-3 px-4 font-sans text-sm text-gray-500">
											{order.country}
										</td>
										<td class="py-3 px-4">
											<div class="flex items-center gap-2">
												<span class="font-mono text-xs text-gray-600">
													{truncateId(order.orderId)}
												</span>
												<button
													onclick={() => copyOrderId(order.orderId)}
													class="cursor-pointer text-gray-400 hover:text-gray-600 transition-colors"
												>
													<Copy class="h-3.5 w-3.5" />
												</button>
											</div>
										</td>
										<td class="py-3 px-4">
											<div class="flex items-center gap-2">
												<span class="font-mono text-xs text-gray-600">
													{truncateId(order.subOrderId)}
												</span>
												<button
													onclick={() => copyOrderId(order.subOrderId)}
													class="cursor-pointer text-gray-400 hover:text-gray-600 transition-colors"
												>
													<Copy class="h-3.5 w-3.5" />
												</button>
											</div>
										</td>
										<td class="py-3 px-4 font-sans text-sm text-gray-500">
											{order.actor}
										</td>
										<td class="py-3 px-4 font-sans text-sm text-gray-500">
											{order.numberType}
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
</div>
