<script lang="ts">
	import { PhoneOff } from 'lucide-svelte';

	let { data } = $props<{
		data: {
			logs: any[];
			totalCount: number;
			limit: number;
			page: number;
		};
	}>();

	const logs = $derived(data.logs || []);
</script>

<div class="flex h-full w-full flex-col bg-[#F3F4F6]">
	<div class="border-b border-gray-200 bg-white px-6 py-4">
		<h1 class="text-xl font-semibold text-gray-800 flex items-center gap-2">
			<PhoneOff class="h-5 w-5 text-gray-500" />
			Drop Calls
		</h1>
		<p class="text-sm text-gray-500 mt-1">
			Quick hang-ups without IVR interaction or voicemails. Unknown callers here are not added to your CRM.
		</p>
	</div>

	<div class="flex-1 overflow-auto p-6">
		<div class="rounded-lg border border-gray-200 bg-white shadow-sm">
			<div class="overflow-x-auto">
				<table class="w-full text-left text-sm">
					<thead class="border-b border-gray-200 bg-gray-50">
						<tr>
							<th class="px-6 py-3 font-medium text-gray-500">Date/Time</th>
							<th class="px-6 py-3 font-medium text-gray-500">Phone Number</th>
							<th class="px-6 py-3 font-medium text-gray-500">Duration</th>
							<th class="px-6 py-3 font-medium text-gray-500">Contact Status</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-gray-200">
						{#if logs.length === 0}
							<tr>
								<td colspan="4" class="px-6 py-8 text-center text-gray-500">
									No drop calls found.
								</td>
							</tr>
						{:else}
							{#each logs as log}
								<tr class="hover:bg-gray-50">
									<td class="px-6 py-4">
										{new Date(log.created).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
									</td>
									<td class="px-6 py-4 font-medium text-gray-900">
										{log.phoneNumber}
									</td>
									<td class="px-6 py-4 text-gray-500">
										{log.duration}s
									</td>
									<td class="px-6 py-4">
										{#if log.knownContact}
											<span class="inline-flex items-center rounded-full bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-700/10">
												Known Profile
											</span>
										{:else}
											<span class="inline-flex items-center rounded-full bg-gray-50 px-2 py-1 text-xs font-medium text-gray-600 ring-1 ring-inset ring-gray-500/10">
												Unknown
											</span>
										{/if}
									</td>
								</tr>
							{/each}
						{/if}
					</tbody>
				</table>
			</div>
		</div>
	</div>
</div>
