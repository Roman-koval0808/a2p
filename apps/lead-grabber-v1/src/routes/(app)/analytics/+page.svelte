<script lang="ts">
	import { Phone, RefreshCw, Search, Tag, Plus, Trash2, Clock, TrendingUp } from 'lucide-svelte';
	import { goto } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import CallsOverTimeChart from '$lib/components/analytics/CallsOverTimeChart.svelte';
	import CategoryBarChart from '$lib/components/analytics/CategoryBarChart.svelte';
	import CallDetailDialog from '$lib/components/analytics/CallDetailDialog.svelte';

	const { data } = $props<{
		data: {
			period: string;
			start: string;
			end: string;
			categories: { id: string; name: string; sortOrder: number }[];
			companyNumbers: {
				id: string;
				phoneNumber: string;
				callTrackingCategoryId: string | null;
				callTrackingCategory: { id: string; name: string } | null;
			}[];
			voiceLogs: {
				id: string;
				direction: string;
				source: string | null;
				destination: string | null;
				created: Date;
				summary: string | null;
				content: string | null;
				duration: number | null;
				metadata: Record<string, unknown> | null;
				callTrackingCategory: { id: string; name: string } | null;
				customer: { id: string; name: string | null; phone: string | null } | null;
			}[];
			callsOverTime: { date: string; inbound: number; outbound: number }[];
			avgDurationSeconds: number | null;
			callsWithDuration: number;
			peakDay: { date: string; count: number } | null;
			stats: {
				inboundTotal: number;
				outboundTotal: number;
				totalCalls: number;
				byCategory: [string, { name: string; inbound: number; outbound: number; total: number }][];
			};
		};
	}>();

	let search = $state('');
	let newCategoryName = $state('');
	let addingCategory = $state(false);
	let selectedCall = $state<(typeof data.voiceLogs)[number] | null>(null);
	let callDetailOpen = $state(false);

	function setPeriod(p: string) {
		goto(`/analytics?period=${p}`, { replaceState: true });
	}

	async function addCategory() {
		const name = newCategoryName.trim();
		if (!name) return;
		addingCategory = true;
		try {
			const res = await fetch('/api/call-tracking-categories', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name })
			});
			const result = await res.json();
			if (result.success) {
				toast.success('Category added');
				newCategoryName = '';
				addingCategory = false;
				return goto('/analytics?period=' + (data.period || 'this_month'), { invalidateAll: true });
			}
			toast.error(result.error || 'Failed to add category');
		} catch (e) {
			toast.error('Failed to add category');
		}
		addingCategory = false;
	}

	async function deleteCategory(id: string) {
		if (!confirm('Remove this category? Numbers will become uncategorized.')) return;
		try {
			const res = await fetch(`/api/call-tracking-categories/${id}`, { method: 'DELETE' });
			const result = await res.json();
			if (result.success) {
				toast.success('Category removed');
				goto('/analytics?period=' + (data.period || 'this_month'), { invalidateAll: true });
			} else toast.error(result.error || 'Failed to delete');
		} catch {
			toast.error('Failed to delete category');
		}
	}

	async function assignCategoryToNumber(cpId: string, callTrackingCategoryId: string | null) {
		try {
			const res = await fetch(`/api/company-numbers/${cpId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ callTrackingCategoryId: callTrackingCategoryId || null })
			});
			const result = await res.json();
			if (result.success) {
				toast.success('Number category updated');
				goto('/analytics?period=' + (data.period || 'this_month'), { invalidateAll: true });
			} else toast.error(result.error || 'Failed to update');
		} catch {
			toast.error('Failed to update number');
		}
	}

	function formatDate(d: Date | string) {
		const x = typeof d === 'string' ? new Date(d) : d;
		return x.toLocaleDateString(undefined, {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function formatDuration(seconds: number) {
		if (seconds < 60) return `${Math.round(seconds)}s`;
		const m = Math.floor(seconds / 60);
		const s = Math.round(seconds % 60);
		return s > 0 ? `${m}m ${s}s` : `${m}m`;
	}

	function formatPeakDate(dateStr: string) {
		return new Date(dateStr + 'T12:00:00').toLocaleDateString(undefined, {
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		});
	}
</script>

<div class="min-h-screen bg-[#F5F7FF]">
	<div class="mx-auto max-w-7xl px-8 py-8">
		<h1 class="mb-6 text-2xl font-semibold text-gray-700">Analytics</h1>

		<div class="mb-6 flex flex-wrap items-center justify-between gap-6">
			<div class="flex items-center gap-2">
				<label for="analytics-period" class="text-sm text-gray-500">Date range:</label>
				<div class="relative">
					<select
						id="analytics-period"
						class="rounded border border-gray-300 bg-white px-3 py-2 font-medium text-[#577AB7] focus:outline-none focus:ring-2 focus:ring-[#577AB7]/30"
						value={data.period}
						onchange={(e) => setPeriod((e.currentTarget as HTMLSelectElement).value)}
					>
						<option value="this_month">This month</option>
						<option value="last_7">Last 7 days</option>
						<option value="last_30">Last 30 days</option>
					</select>
				</div>
			</div>
			<div class="flex w-96 flex-col">
				<div class="relative">
					<input
						class="w-full rounded border border-gray-300 bg-white py-2 pl-10 pr-4 text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#577AB7]/30"
						placeholder="Search"
						bind:value={search}
					/>
					<Search class="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
				</div>
			</div>
		</div>

		<!-- Call stats -->
		<div class="mb-8 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
			<div class="rounded-xl bg-white p-6 shadow">
				<div class="flex items-center justify-between text-sm font-medium text-gray-500">
					Total calls
					<RefreshCw class="h-5 w-5 text-gray-300" />
				</div>
				<div class="text-2xl font-bold text-[#577AB7]">
					{data.stats.totalCalls.toLocaleString()}
				</div>
				<p class="mt-1 text-xs text-gray-400">Voice in selected period</p>
			</div>
			<div class="rounded-xl bg-white p-6 shadow">
				<div class="flex items-center justify-between text-sm font-medium text-gray-500">
					Incoming calls
					<Phone class="h-5 w-5 text-gray-300" />
				</div>
				<div class="text-2xl font-bold text-[#577AB7]">
					{data.stats.inboundTotal.toLocaleString()}
				</div>
			</div>
			<div class="rounded-xl bg-white p-6 shadow">
				<div class="flex items-center justify-between text-sm font-medium text-gray-500">
					Outgoing calls
					<Phone class="h-5 w-5 text-gray-300" />
				</div>
				<div class="text-2xl font-bold text-[#577AB7]">
					{data.stats.outboundTotal.toLocaleString()}
				</div>
			</div>
			<div class="rounded-xl bg-white p-6 shadow">
				<div class="flex items-center justify-between text-sm font-medium text-gray-500">
					Avg call length
					<Clock class="h-5 w-5 text-gray-300" />
				</div>
				<div class="text-2xl font-bold text-[#577AB7]">
					{#if data.avgDurationSeconds != null}
						{formatDuration(data.avgDurationSeconds)}
					{:else}
						—
					{/if}
				</div>
				<p class="mt-1 text-xs text-gray-400">
					{#if data.callsWithDuration > 0}
						From {data.callsWithDuration} call{data.callsWithDuration === 1 ? '' : 's'} with duration
					{:else}
						No duration data yet
					{/if}
				</p>
			</div>
		</div>

		<!-- Charts row -->
		<div class="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
			<section class="rounded-xl bg-white p-6 shadow">
				<h2 class="mb-2 text-lg font-semibold text-gray-700">Calls over time</h2>
				{#if data.callsOverTime.length > 0}
					<CallsOverTimeChart data={data.callsOverTime} />
				{:else}
					<div class="flex flex-col items-center justify-center py-12 text-gray-400">
						<TrendingUp class="mb-2 h-12 w-12 opacity-50" />
						<p class="text-sm">No call data in this period.</p>
					</div>
				{/if}
			</section>
			<section class="rounded-xl bg-white p-6 shadow">
				<h2 class="mb-2 text-lg font-semibold text-gray-700">Calls by category</h2>
				<CategoryBarChart data={data.stats.byCategory} />
			</section>
		</div>

		{#if data.peakDay && data.peakDay.count > 0}
			<div
				class="mb-6 rounded-lg border border-[#577AB7]/20 bg-[#577AB7]/10 px-4 py-2 text-sm text-[#577AB7]"
			>
				<strong>Busiest day:</strong>
				{formatPeakDate(data.peakDay.date)} with {data.peakDay.count} call{data.peakDay.count === 1
					? ''
					: 's'}.
			</div>
		{/if}

		<!-- Call tracking by category -->
		<section class="mb-8 rounded-xl bg-white p-6 shadow">
			<h2 class="mb-4 flex items-center gap-2 text-lg font-semibold text-gray-700">
				<Tag class="h-5 w-5 text-[#577AB7]" />
				Call tracking by category
			</h2>
			<p class="mb-4 text-sm text-gray-500">
				Assign categories to numbers (e.g. "Facebook", "Customer Care"). Incoming and outgoing calls
				to that number are counted under the category.
			</p>

			<!-- Categories list + Add -->
			<div class="mb-6 flex flex-wrap items-center gap-3">
				{#each data.categories as cat}
					<div class="flex items-center gap-2 rounded-lg bg-gray-100 px-3 py-1.5">
						<span class="font-medium text-gray-700">{cat.name}</span>
						<button
							type="button"
							class="p-0.5 text-gray-400 hover:text-red-500"
							aria-label="Delete category"
							onclick={() => deleteCategory(cat.id)}
						>
							<Trash2 class="h-3.5 w-3.5" />
						</button>
					</div>
				{/each}
				<form
					class="flex gap-2"
					onsubmit={(e) => {
						e.preventDefault();
						addCategory();
					}}
				>
					<input
						type="text"
						class="rounded border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#577AB7]/30"
						placeholder="New category name"
						bind:value={newCategoryName}
						disabled={addingCategory}
					/>
					<button
						type="submit"
						class="flex items-center gap-1 rounded bg-[#577AB7] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#4a6ba5] disabled:opacity-50"
						disabled={addingCategory || !newCategoryName.trim()}
					>
						<Plus class="h-4 w-4" /> Add
					</button>
				</form>
			</div>

			<!-- Stats by category -->
			<div class="mb-6 overflow-x-auto">
				<table class="w-full text-sm">
					<thead>
						<tr class="border-b border-gray-200 text-left font-medium text-gray-500">
							<th class="pb-2 pr-4">Category</th>
							<th class="pb-2 pr-4">Inbound</th>
							<th class="pb-2 pr-4">Outbound</th>
							<th class="pb-2">Total</th>
						</tr>
					</thead>
					<tbody>
						{#each data.stats.byCategory as [, row]}
							<tr class="border-b border-gray-100">
								<td class="py-2 pr-4 font-medium text-gray-700">{row.name}</td>
								<td class="py-2 pr-4 text-gray-600">{row.inbound}</td>
								<td class="py-2 pr-4 text-gray-600">{row.outbound}</td>
								<td class="py-2 text-gray-600">{row.total}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>

			<!-- Numbers and their category -->
			<h3 class="mb-2 text-sm font-semibold text-gray-600">Assign category to number</h3>
			<div class="overflow-x-auto">
				<table class="w-full text-sm">
					<thead>
						<tr class="border-b border-gray-200 text-left font-medium text-gray-500">
							<th class="pb-2 pr-4">Number</th>
							<th class="pb-2">Category</th>
						</tr>
					</thead>
					<tbody>
						{#each data.companyNumbers as num}
							<tr class="border-b border-gray-100">
								<td class="py-2 pr-4 text-gray-700">{num.phoneNumber}</td>
								<td class="py-2">
									<select
										class="rounded border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-[#577AB7]/30"
										value={num.callTrackingCategoryId ?? ''}
										onchange={(e) =>
											assignCategoryToNumber(
												num.id,
												(e.currentTarget as HTMLSelectElement).value || null
											)}
									>
										<option value="">— None —</option>
										{#each data.categories as cat}
											<option value={cat.id}>{cat.name}</option>
										{/each}
									</select>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
				{#if data.companyNumbers.length === 0}
					<p class="py-4 text-sm text-gray-500">
						No phone numbers assigned. Assign numbers in <a
							href="/manage-numbers"
							class="text-[#577AB7] underline">Manage numbers</a
						>.
					</p>
				{/if}
			</div>
		</section>

		<!-- Recent voice calls -->
		<section class="rounded-xl bg-white p-6 shadow">
			<h2 class="mb-1 text-lg font-semibold text-gray-700">Recent calls</h2>
			<p class="mb-4 text-sm text-gray-500">Click a row to view details and recording.</p>
			<div class="overflow-x-auto">
				<table class="w-full text-sm">
					<thead>
						<tr class="border-b border-gray-200 text-left font-medium text-gray-500">
							<th class="pb-2 pr-4">Date</th>
							<th class="pb-2 pr-4">Direction</th>
							<th class="pb-2 pr-4">Category</th>
							<th class="pb-2 pr-4">From / To</th>
							<th class="pb-2">Contact</th>
						</tr>
					</thead>
					<tbody>
						{#each data.voiceLogs as log}
							<tr
								role="button"
								tabindex="0"
								class="cursor-pointer border-b border-gray-100 hover:bg-gray-50 focus:bg-gray-50 focus:outline-none"
								onclick={() => {
									selectedCall = log;
									callDetailOpen = true;
								}}
								onkeydown={(e) => {
									if (e.key === 'Enter' || e.key === ' ') {
										e.preventDefault();
										selectedCall = log;
										callDetailOpen = true;
									}
								}}
							>
								<td class="py-2 pr-4 text-gray-600">{formatDate(log.created)}</td>
								<td class="py-2 pr-4">
									<span
										class="rounded px-1.5 py-0.5 text-xs font-medium {log.direction === 'inbound'
											? 'bg-green-100 text-green-800'
											: 'bg-blue-100 text-blue-800'}"
									>
										{log.direction === 'inbound' ? 'In' : 'Out'}
									</span>
								</td>
								<td class="py-2 pr-4 text-gray-600">
									{log.callTrackingCategory?.name ?? '—'}
								</td>
								<td class="py-2 pr-4 text-gray-600">
									{log.direction === 'inbound' ? log.source : log.destination} →
									{log.direction === 'inbound' ? log.destination : log.source}
								</td>
								<td class="py-2 text-gray-600">
									{log.customer?.name || log.customer?.phone || '—'}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
				{#if data.voiceLogs.length === 0}
					<p class="py-6 text-center text-gray-500">No calls in this period.</p>
				{/if}
			</div>
		</section>

		<CallDetailDialog bind:open={callDetailOpen} call={selectedCall} />
	</div>
</div>
