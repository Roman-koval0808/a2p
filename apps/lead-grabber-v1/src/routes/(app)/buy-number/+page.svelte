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

<div class="min-h-screen bg-[#ECEEF3] p-4">
	<!-- Header -->
	<div class="mb-4 rounded-[3px] bg-white px-4 py-3">
		<h1 class="font-['Poppins'] text-[23px] font-semibold leading-[30px] text-[#747474]">
			Buy Numbers
		</h1>
	</div>

	<!-- Main Content Card -->
	<div class="rounded-lg bg-white p-6">
		<!-- Tabs -->
		<div class="mb-6 border-b border-[#949494]">
			<div class="flex gap-6">
				<button
					class="relative pb-2 font-['Poppins'] text-lg font-medium leading-[21px] transition-colors {activeTab ===
					'buy'
						? 'text-[#577AB7]'
						: 'text-[#A0A0A0]'}"
					onclick={() => (activeTab = 'buy')}
				>
					Buy Number
					{#if activeTab === 'buy'}
						<div class="absolute bottom-0 left-0 h-[6px] w-[122px] bg-[#577AB7]"></div>
					{/if}
				</button>
				<button
					class="relative pb-2 font-['Poppins'] text-lg font-medium leading-[21px] transition-colors {activeTab ===
					'orders'
						? 'text-[#577AB7]'
						: 'text-[#A0A0A0]'}"
					onclick={() => (activeTab = 'orders')}
				>
					Number Orders
					{#if activeTab === 'orders'}
						<div class="absolute bottom-0 left-0 h-[6px] w-[149px] bg-[#577AB7]"></div>
					{/if}
				</button>
			</div>
		</div>

		{#if activeTab === 'buy'}
			<!-- Filter Section -->
			<div class="mb-6 rounded-b border border-t-0 border-[#BEBEBE] p-6">
				<div class="mb-4 grid grid-cols-4 gap-4">
					<!-- Country -->
					<div class="flex flex-col gap-2">
						<div class="flex items-center gap-2">
							<label
								for="country"
								class="font-['Poppins'] text-base font-medium leading-[19px] text-[#757575]"
							>
								Country
							</label>
							<span
								class="font-['Poppins'] text-[15px] font-normal italic leading-[18px] text-[#4F4F4F]"
							>
								Required
							</span>
						</div>
						<div class="relative">
							<select
								id="country"
								bind:value={country}
								class="h-[47px] w-full appearance-none rounded-[2px] border border-[#969696] bg-white px-3 pr-10 font-['Poppins'] text-sm font-normal leading-[17px] text-[#808080] outline-none"
							>
								{#each COUNTRY_OPTIONS as opt}
									<option value={opt.code}>{opt.label}</option>
								{/each}
							</select>
							<ChevronDown
								class="pointer-events-none absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[#808080]"
							/>
						</div>
					</div>

					<!-- Features -->
					<div class="flex flex-col gap-2">
						<label
							for="features"
							class="font-['Poppins'] text-base font-medium leading-[19px] text-[#757575]"
						>
							Features
						</label>
						<div class="relative">
							<select
								id="features"
								bind:value={features}
								class="h-[47px] w-full appearance-none rounded-[2px] border border-[#969696] bg-white px-3 pr-10 font-['Poppins'] text-sm font-normal leading-[17px] text-[rgba(128,128,128,0.47)] outline-none"
							>
								{#each FEATURE_OPTIONS as opt}
									<option value={opt.value}>{opt.label}</option>
								{/each}
							</select>
							<ChevronDown
								class="pointer-events-none absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[#808080]"
							/>
						</div>
					</div>

					<!-- Search by -->
					<div class="flex flex-col gap-2">
						<label
							for="searchBy"
							class="font-['Poppins'] text-base font-medium leading-[19px] text-[#757575]"
						>
							Search by
						</label>
						<div class="relative">
							<select
								id="searchBy"
								bind:value={searchBy}
								class="h-[47px] w-full appearance-none rounded-[2px] border border-[#969696] bg-white px-3 pr-10 font-['Poppins'] text-sm font-normal leading-[17px] text-[#808080] outline-none"
							>
								{#each SEARCH_BY_OPTIONS as opt}
									<option value={opt}>{opt}</option>
								{/each}
							</select>
							<ChevronDown
								class="pointer-events-none absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[#808080]"
							/>
						</div>
					</div>

					<!-- Area Code or Number -->
					<div class="flex flex-col gap-2">
						<label
							for="areaCode"
							class="font-['Poppins'] text-base font-medium leading-[19px] text-[#757575]"
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
								class="h-[47px] w-full rounded-[2px] border border-[#969696] bg-white px-3 font-['Poppins'] text-sm font-normal leading-[17px] text-[#808080] outline-none placeholder:text-[rgba(128,128,128,0.47)]"
							/>
						{/if}
					</div>
				</div>

				<!-- Search Button -->
				<button
					onclick={handleSearch}
					disabled={isLoading}
					class="h-[36px] w-[157px] rounded-[6px] bg-[#577AB7] font-['Poppins'] text-[15px] font-medium leading-[18px] text-white transition-colors hover:bg-[#4a6ba5] disabled:opacity-50"
				>
					{isLoading ? 'Searching...' : 'Search Numbers'}
				</button>
				{#if cart.size > 0}
					<button
						onclick={handleBuySelected}
						disabled={isLoading}
						class="h-[36px] rounded-[6px] bg-green-600 px-4 font-['Poppins'] text-[15px] font-medium leading-[18px] text-white transition-colors hover:bg-green-700 disabled:opacity-50"
					>
						Buy {cart.size} Selected
					</button>
				{/if}
			</div>

			<!-- Results Table -->
			<div class="rounded-b border border-t-0 border-[#BEBEBE] p-6">
				<h2 class="mb-4 font-['Poppins'] text-lg font-semibold leading-[21px] text-[#777777]">
					Number Results
				</h2>

				<!-- Table -->
				<div class="max-h-[421px] overflow-y-auto">
					<table class="w-full">
						<thead class="sticky top-0 z-10 bg-white">
							<tr class="border-b border-[rgba(193,193,193,0.96)]">
								<th
									class="pb-3 text-left font-['Poppins'] text-[15px] font-semibold leading-[18px] text-[#757575]"
								>
									Number
								</th>
								<th
									class="pb-3 text-left font-['Poppins'] text-[15px] font-semibold leading-[18px] text-[#757575]"
								>
									Location/Rate Center
								</th>
								<th
									class="pb-3 text-left font-['Poppins'] text-[15px] font-semibold leading-[18px] text-[#757575]"
								>
									Number Type
								</th>
								<th
									class="pb-3 text-left font-['Poppins'] text-[15px] font-semibold leading-[18px] text-[#757575]"
								>
									Features
								</th>
								<th
									class="pb-3 text-left font-['Poppins'] text-[15px] font-semibold leading-[18px] text-[#757575]"
								>
									Upfront Price
								</th>
								<th
									class="pb-3 text-left font-['Poppins'] text-[15px] font-semibold leading-[18px] text-[#757575]"
								>
									Monthly Price
								</th>
								<th
									class="pb-3 text-left font-['Poppins'] text-[15px] font-semibold leading-[18px] text-[#757575]"
								>
								</th>
							</tr>
						</thead>
						<tbody>
							{#if isLoading}
								<tr>
									<td colspan="7" class="py-8 text-center text-gray-500"> Loading... </td>
								</tr>
							{:else if phoneNumbers.length === 0}
								<tr>
									<td colspan="7" class="py-8 text-center text-gray-500">
										No numbers found. Click "Search Numbers" to find available numbers.
									</td>
								</tr>
							{:else}
								{#each phoneNumbers as num, index}
									<tr class="border-b border-[rgba(193,193,193,0.4)]">
										<td class="py-3">
											<div class="flex items-center gap-3">
												<input
													type="checkbox"
													checked={cart.has(num.number)}
													onchange={() => handleAddToCart(num.number)}
													class="h-[18px] w-[17px] rounded-[1px] border-[0.8px] border-[#949494] bg-[rgba(217,217,217,0.08)]"
												/>
												<span
													class="font-['Poppins'] text-[13px] font-normal leading-[15px] text-[#808080]"
												>
													{num.number}
												</span>
											</div>
										</td>
										<td
											class="py-3 font-['Poppins'] text-[13px] font-normal leading-[15px] text-[#808080]"
										>
											{num.location}
										</td>
										<td
											class="py-3 font-['Poppins'] text-[13px] font-normal leading-[15px] text-[#808080]"
										>
											{num.type}
										</td>
										<td class="py-3">
											<div class="flex gap-2">
												<Phone class="h-4 w-4 text-[#577AB7]" />
												<MessageSquare class="h-4 w-4 text-[#577AB7]" />
												<Mail class="h-4 w-4 text-[#577AB7]" />
												<ImageIcon class="h-4 w-4 text-[#577AB7]" />
											</div>
										</td>
										<td
											class="py-3 font-['Poppins'] text-[13px] font-normal leading-[15px] text-[#808080]"
										>
											{num.upfront}
										</td>
										<td
											class="py-3 font-['Poppins'] text-[13px] font-normal leading-[15px] text-[#808080]"
										>
											{num.monthly}
										</td>
										<td class="py-3">
											<button
												onclick={() => handleAddToCart(num.number)}
												class="h-[26px] w-[95px] rounded-[6px] {cart.has(num.number)
													? 'bg-green-600'
													: 'bg-[#577AB7]'} font-['Poppins'] text-[13px] font-medium leading-[15px] text-white transition-colors hover:bg-[#4a6ba5]"
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
			<div class="rounded-b border border-t-0 border-[#BEBEBE] p-6">
				<!-- Filters and Export Buttons -->
				<div class="mb-4 flex justify-end gap-3">
					<button
						onclick={handleFilters}
						class="flex h-[28px] items-center gap-2 rounded-[3px] border-[0.5px] border-black bg-[#ECEFF3] px-3 font-['Poppins'] text-sm font-normal leading-[17px] text-[#757575] transition-colors hover:bg-[#E0E5EA]"
					>
						<SlidersHorizontal class="h-[18px] w-[18px]" />
						Filters
					</button>
					<button
						onclick={handleExport}
						class="flex h-[28px] items-center gap-2 rounded-[3px] border-[0.5px] border-black bg-[#ECEFF3] px-3 font-['Poppins'] text-sm font-normal leading-[17px] text-[#757575] transition-colors hover:bg-[#E0E5EA]"
					>
						<Download class="h-5 w-5" />
						Export
					</button>
				</div>

				<!-- Table -->
				<div
					class="max-h-[649px] overflow-x-auto overflow-y-auto rounded-b border border-[#BEBEBE]"
				>
					<table class="w-full min-w-[1069px]">
						<thead class="sticky top-0 z-10 bg-white">
							<tr class="border-b border-[rgba(193,193,193,0.96)]">
								<th
									class="pb-3 text-left font-['Poppins'] text-base font-semibold leading-[19px] text-[#757575]"
								>
									Date
								</th>
								<th
									class="pb-3 text-left font-['Poppins'] text-base font-semibold leading-[19px] text-[#757575]"
								>
									Status
								</th>
								<th
									class="pb-3 text-left font-['Poppins'] text-base font-semibold leading-[19px] text-[#757575]"
								>
									Country
								</th>
								<th
									class="pb-3 text-left font-['Poppins'] text-base font-semibold leading-[19px] text-[#757575]"
								>
									Order ID
								</th>
								<th
									class="pb-3 text-left font-['Poppins'] text-base font-semibold leading-[19px] text-[#757575]"
								>
									SubOrder ID
								</th>
								<th
									class="pb-3 text-left font-['Poppins'] text-base font-semibold leading-[19px] text-[#757575]"
								>
									Actor
								</th>
								<th
									class="pb-3 text-left font-['Poppins'] text-base font-semibold leading-[19px] text-[#757575]"
								>
									Number Typ
								</th>
							</tr>
						</thead>
						<tbody>
							{#if numberOrders.length === 0}
								<tr>
									<td colspan="7" class="py-8 text-center text-gray-500"> No orders found. </td>
								</tr>
							{:else}
								{#each numberOrders as order}
									<tr class="border-b border-[rgba(193,193,193,0.4)]">
										<td
											class="py-3 font-['Poppins'] text-[15px] font-normal leading-[23px] text-[#808080]"
										>
											{order.date}
										</td>
										<td class="py-3">
											<div class="flex items-center gap-2">
												<div class="h-[6px] w-[5px] rounded-full bg-[#04CB15]"></div>
												<span
													class="font-['Poppins'] text-[15px] font-normal leading-[23px] text-[#808080]"
												>
													{order.status}
												</span>
											</div>
										</td>
										<td
											class="py-3 font-['Poppins'] text-[15px] font-normal leading-[23px] text-[#808080]"
										>
											{order.country}
										</td>
										<td class="py-3">
											<div class="flex items-center gap-2">
												<span
													class="font-['Poppins'] text-[15px] font-normal leading-[23px] text-[#808080]"
												>
													{truncateId(order.orderId)}
												</span>
												<button
													onclick={() => copyOrderId(order.orderId)}
													class="cursor-pointer text-[#6C6C6C] hover:text-[#808080]"
												>
													<Copy class="h-4 w-4" />
												</button>
											</div>
										</td>
										<td class="py-3">
											<div class="flex items-center gap-2">
												<span
													class="font-['Poppins'] text-[15px] font-normal leading-[23px] text-[#808080]"
												>
													{truncateId(order.subOrderId)}
												</span>
												<button
													onclick={() => copyOrderId(order.subOrderId)}
													class="cursor-pointer text-[#6C6C6C] hover:text-[#808080]"
												>
													<Copy class="h-4 w-4" />
												</button>
											</div>
										</td>
										<td
											class="py-3 font-['Poppins'] text-[15px] font-normal leading-[23px] text-[#808080]"
										>
											{order.actor}
										</td>
										<td
											class="py-3 font-['Poppins'] text-[15px] font-normal leading-[23px] text-[#808080]"
										>
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
