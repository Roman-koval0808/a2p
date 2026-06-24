<script lang="ts">
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Building2, Users, ShieldAlert } from 'lucide-svelte';
	import { toast } from 'svelte-sonner';
	import { goto } from '$app/navigation';

	let { data } = $props();

	async function handleManage(companyId: string) {
		try {
			const res = await fetch('/api/me/switch-company', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ companyId })
			});
			if (res.ok) {
				toast.success('Switched to company context');
				goto('/dashboard').then(() => window.location.reload());
			} else {
				toast.error('Failed to switch company');
			}
		} catch (err) {
			toast.error('Failed to switch company');
		}
	}
</script>

<div class="flex flex-1 flex-col gap-6 p-8">
	<div>
		<h1 class="text-3xl font-bold tracking-tight text-gray-900">ClearSky Admin Dashboard</h1>
		<p class="text-gray-500">Platform overview and tenant management</p>
	</div>

	<div class="grid gap-6 md:grid-cols-3">
		<Card>
			<CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
				<CardTitle class="text-sm font-medium">Total Companies</CardTitle>
				<Building2 class="h-4 w-4 text-muted-foreground" />
			</CardHeader>
			<CardContent>
				<div class="text-2xl font-bold">{data.stats.totalCompanies}</div>
			</CardContent>
		</Card>

		<Card>
			<CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
				<CardTitle class="text-sm font-medium">Total Platform Users</CardTitle>
				<Users class="h-4 w-4 text-muted-foreground" />
			</CardHeader>
			<CardContent>
				<div class="text-2xl font-bold">{data.stats.totalUsers}</div>
			</CardContent>
		</Card>

		<Card>
			<CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
				<CardTitle class="text-sm font-medium">Support Staff</CardTitle>
				<ShieldAlert class="h-4 w-4 text-blue-500" />
			</CardHeader>
			<CardContent>
				<div class="text-2xl font-bold">{data.stats.supportStaff}</div>
				<p class="text-xs text-muted-foreground">ClearSky employees</p>
			</CardContent>
		</Card>
	</div>

	<div class="mt-4">
		<h2 class="mb-4 text-xl font-semibold">Tenants (Companies)</h2>
		<div class="rounded-md border bg-white">
			<table class="w-full text-left text-sm text-gray-500">
				<thead class="bg-gray-50 text-xs uppercase text-gray-700">
					<tr>
						<th class="px-6 py-3">Company Name</th>
						<th class="px-6 py-3">Owner</th>
						<th class="px-6 py-3">Team Size</th>
						<th class="px-6 py-3">Communications</th>
						<th class="px-6 py-3">Action</th>
					</tr>
				</thead>
				<tbody>
					{#each data.companies as company}
						<tr class="border-b bg-white">
							<td class="px-6 py-4 font-medium text-gray-900">{company.name || 'Unnamed'}</td>
							<td class="px-6 py-4">{company.owner?.name || company.owner?.email || 'N/A'}</td>
							<td class="px-6 py-4">{company._count.teamMembers} members</td>
							<td class="px-6 py-4">{company._count.communicationLogs} logs</td>
							<td class="px-6 py-4">
								<button class="font-medium text-blue-600 hover:underline" onclick={() => handleManage(company.id)}>Manage</button>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>
</div>
