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

<div class="min-h-screen bg-gray-50 p-6 font-sans">
	<!-- Header -->
	<div class="mb-6 flex items-center justify-between border-b border-gray-200 pb-5">
		<div>
			<h1 class="text-xl font-bold text-gray-800 font-sans">Porting</h1>
			<p class="text-xs text-gray-500 mt-1">Submit new port-in requests and check the status of existing porting orders.</p>
		</div>
	</div>

	<!-- Main Content Card -->
	<div class="rounded-lg bg-white p-6 border border-gray-200 shadow-sm">
		<!-- Tabs and New Port Request Button -->
		<div class="mb-6 flex items-center justify-between border-b border-gray-200">
			<div class="-mb-px flex gap-6">
				<button
					class="relative pb-3 font-sans text-sm font-semibold transition-all {activeTab === 'portOrders' ? 'text-[#577AB7] border-b-2 border-[#577AB7]' : 'text-gray-400 hover:text-gray-600 border-b-2 border-transparent'}"
					onclick={() => (activeTab = 'portOrders')}
				>
					Port Orders
				</button>
				<button
					class="relative pb-3 font-sans text-sm font-semibold transition-all {activeTab === 'portOutRequest' ? 'text-[#577AB7] border-b-2 border-[#577AB7]' : 'text-gray-400 hover:text-gray-600 border-b-2 border-transparent'}"
					onclick={() => (activeTab = 'portOutRequest')}
				>
					Port Out Request
				</button>
			</div>
			<button
				onclick={handleNewPortRequest}
				class="h-10 rounded-md bg-[#577AB7] px-4 font-sans text-sm font-medium text-white shadow-sm transition-colors hover:bg-[#4a6ba5]"
			>
				New Port Request
			</button>
		</div>

		<!-- Table Container -->
		<div class="rounded-lg border border-gray-200 bg-white overflow-hidden shadow-sm">
			<!-- Filters and Export Buttons -->
			<div class="flex items-center justify-end gap-2 border-b border-gray-200 px-4 py-3 bg-gray-50/50">
				<button
					onclick={handleFilters}
					class="flex h-8 items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 font-sans text-xs font-semibold text-gray-600 shadow-sm transition-colors hover:bg-gray-50 hover:text-gray-900"
				>
					<Filter class="h-3.5 w-3.5" />
					Filters
				</button>
				<button
					onclick={handleExport}
					class="flex h-8 items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 font-sans text-xs font-semibold text-gray-600 shadow-sm transition-colors hover:bg-gray-50 hover:text-gray-900"
				>
					<Download class="h-3.5 w-3.5" />
					Export
				</button>
			</div>

			<!-- Table Headers -->
			<div class="border-b border-gray-200 px-4 py-3 bg-gray-50/50">
				<div
					class="grid grid-cols-9 gap-4 font-sans text-xs font-semibold uppercase tracking-wider text-gray-500"
				>
					<div>Number</div>
					<div>Request #</div>
					<div>Customer Ref</div>
					<div>Port Order ID</div>
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
