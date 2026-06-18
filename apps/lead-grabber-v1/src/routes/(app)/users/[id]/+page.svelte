<script lang="ts">
	import { goto } from '$app/navigation';
	import { formatDate } from '$lib/utils/date';
	import RoleBadge from '$lib/components/RoleBadge.svelte';
	import { Mail, Phone, MessageSquare } from 'lucide-svelte';

	let { data } = $props<{
		data: {
			user: {
				id: string;
				name: string;
				email: string;
				avatar?: string;
				created: string;
			};
			member: {
				id: string;
				role: string;
				joined_at: string;
			} | null;
			assignedMessages: any[];
			assignedLogs: any[];
		};
	}>();
</script>

<div class="flex h-[90vh] flex-col gap-4 bg-gray-100 p-4">
	<div class="rounded-xl bg-white p-6 shadow-sm">
		<button
			onclick={() => goto('/settings/company')}
			class="mb-4 flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800"
		>
			← Back to Team
		</button>

		<div class="flex items-start gap-6">
			<!-- Avatar -->
			<div class="flex-shrink-0">
				{#if data.user.avatar}
					<img
						src={data.user.avatar}
						alt={data.user.name}
						class="h-24 w-24 rounded-full object-cover"
					/>
				{:else}
					<div
						class="flex h-24 w-24 items-center justify-center rounded-full bg-gray-200 text-2xl font-semibold text-gray-600"
					>
						{data.user.name?.charAt(0).toUpperCase() || '?'}
					</div>
				{/if}
			</div>

			<!-- User Info -->
			<div class="flex-1">
				<div class="mb-4">
					<h1 class="mb-2 text-3xl font-semibold text-gray-900">{data.user.name}</h1>
					<p class="mb-1 text-gray-600">{data.user.email}</p>
					{#if data.member}
						<div class="mt-2">
							<RoleBadge role={data.member.role} />
						</div>
					{/if}
				</div>

				{#if data.member}
					<div class="grid grid-cols-2 gap-4 text-sm">
						{#if data.member.joined_at}
							<div>
								<span class="font-medium text-gray-700">Joined:</span>
								<span class="ml-2 text-gray-600">{formatDate(data.member.joined_at)}</span>
							</div>
						{/if}
						{#if data.user.created}
							<div>
								<span class="font-medium text-gray-700">Account Created:</span>
								<span class="ml-2 text-gray-600">{formatDate(data.user.created)}</span>
							</div>
						{/if}
					</div>
				{/if}
			</div>
		</div>
	</div>

	<!-- Assigned Messages -->
	<div class="rounded-xl bg-white p-6 shadow-sm">
		<h2 class="mb-4 text-xl font-semibold text-gray-900">
			Assigned Messages ({data.assignedMessages.length})
		</h2>
		{#if data.assignedMessages.length > 0}
			<div class="space-y-3">
				{#each data.assignedMessages as msg}
					<div class="border-b border-gray-200 pb-3 last:border-b-0 last:pb-0">
						<div class="flex items-center justify-between">
							<div class="flex-1">
								<h3 class="font-medium text-gray-900">
									{msg.customer_name || 'Unknown Customer'}
								</h3>
								<p class="mt-1 line-clamp-2 text-sm text-gray-600">
									{msg.messages?.[msg.messages.length - 1]?.content || 'No content'}
								</p>
							</div>
							<div class="text-right text-sm text-gray-500">
								{formatDate(msg.updated || msg.created)}
							</div>
						</div>
					</div>
				{/each}
			</div>
		{:else}
			<p class="text-gray-500">No messages assigned</p>
		{/if}
	</div>

	<!-- Assigned Communication Logs -->
	<div class="rounded-xl bg-white p-6 shadow-sm">
		<h2 class="mb-4 text-xl font-semibold text-gray-900">
			Assigned Communications ({data.assignedLogs.length})
		</h2>
		{#if data.assignedLogs.length > 0}
			<div class="space-y-3">
				{#each data.assignedLogs as log}
					<div class="border-b border-gray-200 pb-3 last:border-b-0 last:pb-0">
						<div class="flex items-center justify-between">
							<div class="flex flex-1 items-center gap-3">
								{#if log.type === 'email'}
									<Mail class="h-4 w-4 text-gray-500" />
								{:else if log.type === 'sms'}
									<MessageSquare class="h-4 w-4 text-gray-500" />
								{:else if log.type === 'voice'}
									<Phone class="h-4 w-4 text-gray-500" />
								{/if}
								<div class="flex-1">
									<div class="font-medium capitalize text-gray-900">
										{log.type} - {log.direction}
									</div>
									<div class="text-sm text-gray-600">
										{log.source} → {log.destination}
									</div>
								</div>
							</div>
							<div class="text-right text-sm text-gray-500">
								{formatDate(log.created)}
							</div>
						</div>
					</div>
				{/each}
			</div>
		{:else}
			<p class="text-gray-500">No communication logs assigned</p>
		{/if}
	</div>
</div>
