<script lang="ts">
	import { goto } from '$app/navigation';
	import { Filter, Download } from 'lucide-svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';

	let activeTab = $state<'portOrders' | 'portOutRequest'>('portOrders');

	function handleNewPortRequest() {
		goto('/port-numbers/create');
	}

	function handleFilters() {
		// TODO: Open filters
		console.log('Filters');
	}

	function handleExport() {
		// TODO: Export data
		console.log('Export');
	}
</script>

<div class="min-h-screen bg-[#ECEEF3] p-4">
	<!-- Header -->
	<div class="mb-4 rounded-[3px] bg-white px-4 py-3">
		<h1 class="font-['Poppins'] text-[23px] font-semibold leading-[30px] text-[#747474]">
			Porting
		</h1>
	</div>

	<!-- Main Content Card -->
	<div class="rounded-lg bg-white p-6">
		<!-- Tabs and New Port Request Button -->
		<div class="mb-6 flex items-center justify-between border-b border-[#949494]">
			<div class="flex gap-6">
				<button
					class="relative pb-2 font-['Poppins'] text-lg font-medium leading-[21px] transition-colors {activeTab ===
					'portOrders'
						? 'text-[#577AB7]'
						: 'text-[#A0A0A0]'}"
					onclick={() => (activeTab = 'portOrders')}
				>
					Port Orders
					{#if activeTab === 'portOrders'}
						<div class="absolute bottom-0 left-0 h-[6px] w-[149px] bg-[#577AB7]"></div>
					{/if}
				</button>
				<button
					class="relative pb-2 font-['Poppins'] text-lg font-medium leading-[21px] transition-colors {activeTab ===
					'portOutRequest'
						? 'text-[#577AB7]'
						: 'text-[#A0A0A0]'}"
					onclick={() => (activeTab = 'portOutRequest')}
				>
					Port Out Request
					{#if activeTab === 'portOutRequest'}
						<div class="absolute bottom-0 left-0 h-[6px] w-[152px] bg-[#577AB7]"></div>
					{/if}
				</button>
			</div>
			<button
				onclick={handleNewPortRequest}
				class="h-[41px] rounded-[4px] bg-[#577AB7] px-4 font-['Poppins'] text-base font-medium leading-[19px] text-white transition-colors hover:bg-[#4a6ba5]"
			>
				New Port Request
			</button>
		</div>

		<!-- Table Container -->
		<div class="rounded-b border border-[#BEBEBE] bg-white">
			<!-- Filters and Export Buttons -->
			<div class="flex items-center justify-end gap-2 border-b border-[#949494] px-4 py-3">
				<button
					onclick={handleFilters}
					class="flex h-[35px] items-center gap-2 rounded-[3px] border-[0.5px] border-black bg-[#ECEFF3] px-3 font-['Poppins'] text-[13px] font-normal leading-[15px] text-[#757575] transition-colors hover:bg-[#E0E5EA]"
				>
					<Filter class="h-5 w-5" />
					Filters
				</button>
				<button
					onclick={handleExport}
					class="flex h-[35px] items-center gap-2 rounded-[3px] border-[0.5px] border-black bg-[#ECEFF3] px-3 font-['Poppins'] text-[13px] font-normal leading-[15px] text-[#757575] transition-colors hover:bg-[#E0E5EA]"
				>
					<Download class="h-5 w-5" />
					Export
				</button>
			</div>

			<!-- Table Headers -->
			<div class="border-b border-[rgba(193,193,193,0.96)] px-4 py-3">
				<div
					class="grid grid-cols-9 gap-4 font-['Poppins'] text-[15px] font-medium leading-[18px] text-[#757575]"
				>
					<div>Number</div>
					<div>Request #</div>
					<div>Customer Reference</div>
					<div>Porting Order ID</div>
					<div>Total TNs</div>
					<div>FOC Date</div>
					<div>End User</div>
					<div>Submitted At</div>
					<div>Losing Carrier</div>
				</div>
			</div>

			<EmptyState title="No Results Found" class="h-[400px]" />
		</div>
	</div>
</div>
