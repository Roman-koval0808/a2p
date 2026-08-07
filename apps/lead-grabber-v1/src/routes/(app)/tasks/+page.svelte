<script lang="ts">
	import {
		MoreHorizontal,
		Mail,
		Phone,
		Trash2,
		Edit,
		MessageSquare,
		Send,
		Calendar,
		Save,
		X,
		Clock
	} from 'lucide-svelte';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { slide } from 'svelte/transition';
	import { invalidateAll } from '$app/navigation';
	import { toast } from 'svelte-sonner';

	export let data;
	let { tasks } = data;
	let activeTab = 'ALL';
	let expandedTaskId: string | null = null;
	let editingIntentId: string | null = null;
	let editDraft: any = {};

	const tabs = ['ALL', 'Customer Requests', 'Owner Actions'];

	$: filteredTasks = tasks.filter((task: any) => {
		if (activeTab === 'ALL') return true;
		if (activeTab === 'Customer Requests') return task.origin === 'CR';
		if (activeTab === 'Owner Actions') return task.origin === 'OA';
		return true;
	});

	function toggleExpand(id: string) {
		if (expandedTaskId === id) {
			expandedTaskId = null;
			editingIntentId = null;
		} else {
			expandedTaskId = id;
		}
	}

	function startEdit(task: any) {
		if (task._kind !== 'scheduled_intent') return;
		editingIntentId = task.id;
		const r = task._raw;
		editDraft = {
			status: task.status,
			dueAt: r.dueAt ? new Date(r.dueAt).toISOString().slice(0, 16) : '',
			expiresAt: r.expiresAt ? new Date(r.expiresAt).toISOString().slice(0, 16) : ''
		};
	}

	function cancelEdit() {
		editingIntentId = null;
	}

	async function saveEdit(id: string) {
		const loadingId = toast.loading('Saving...');
		try {
			const body: any = {};
			if (editDraft.status && editDraft.status !== tasks.find((t) => t.id === id)?.status) {
				body.status = editDraft.status;
			}
			if (editDraft.dueAt) body.dueAt = new Date(editDraft.dueAt).toISOString();
			if (editDraft.expiresAt !== undefined) {
				body.expiresAt = editDraft.expiresAt ? new Date(editDraft.expiresAt).toISOString() : null;
			}
			const res = await fetch(`/api/a2p/schedule/${id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
			const result = await res.json();
			if (result.ok) {
				toast.success('Updated', { id: loadingId });
				editingIntentId = null;
				await invalidateAll();
			} else {
				toast.error(result.error || 'Failed', { id: loadingId });
			}
		} catch (e) {
			toast.error('Failed to update', { id: loadingId });
		}
	}

	async function quickCancel(id: string) {
		const loadingId = toast.loading('Cancelling...');
		try {
			const res = await fetch(`/api/a2p/schedule/${id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ status: 'CANCELLED' })
			});
			const result = await res.json();
			if (result.ok) {
				toast.success('Cancelled', { id: loadingId });
				await invalidateAll();
			} else {
				toast.error(result.error || 'Failed', { id: loadingId });
			}
		} catch (e) {
			toast.error('Failed', { id: loadingId });
		}
	}

	async function quickReschedule(id: string, currentDue: string) {
		const d = new Date(currentDue);
		d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
		const iso = d.toISOString().slice(0, 16);
		const input = window.prompt('New due date (YYYY-MM-DD HH:mm, local):', iso);
		if (!input) return;
		const dueAt = new Date(input);
		if (isNaN(dueAt.getTime())) {
			toast.error('Invalid date');
			return;
		}
		const loadingId = toast.loading('Rescheduling...');
		try {
			const res = await fetch(`/api/a2p/schedule/${id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ dueAt: dueAt.toISOString() })
			});
			const result = await res.json();
			if (result.ok) {
				toast.success('Rescheduled', { id: loadingId });
				await invalidateAll();
			} else {
				toast.error(result.error || 'Failed', { id: loadingId });
			}
		} catch (e) {
			toast.error('Failed', { id: loadingId });
		}
	}
</script>

<div class="flex h-full flex-col p-8">
	<div class="mb-8 text-center">
		<h1 class="text-xl font-medium text-gray-500 mb-2">List of tasks</h1>
		<h2 class="text-3xl font-bold tracking-tight">schedule list of taks to be completed</h2>
	</div>

	<div class="mb-6 flex justify-center gap-4">
		{#each tabs as tab}
			<button
				class="rounded-md border-2 px-6 py-2 text-sm font-semibold transition-colors
				{activeTab === tab
					? 'border-gray-800 bg-gray-200 text-gray-900'
					: 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'}"
				on:click={() => (activeTab = tab)}
			>
				{tab}
			</button>
		{/each}
	</div>

	<div class="rounded-md border bg-white overflow-hidden flex-1 overflow-y-auto">
		<table class="w-full text-left text-sm text-gray-700">
			<thead class="sticky top-0 bg-white shadow-sm font-semibold text-gray-900 border-b">
				<tr>
					<th class="px-4 py-3">Task ID</th>
					<th class="px-4 py-3">Date</th>
					<th class="px-4 py-3">origin</th>
					<th class="px-4 py-3">Channel</th>
					<th class="px-4 py-3">Client ID</th>
					<th class="px-4 py-3">Intent</th>
					<th class="px-4 py-3">comm id</th>
					<th class="px-4 py-3">Ref-id</th>
					<th class="px-4 py-3 text-center">summary</th>
				</tr>
			</thead>
			<tbody>
				{#each filteredTasks as task}
					<tr
						class="border-b transition-colors hover:bg-gray-50 cursor-pointer {expandedTaskId === task.id ? 'bg-gray-50' : ''}"
						on:click={() => toggleExpand(task.id)}
					>
						<td class="px-4 py-3 font-medium text-gray-900">
							{task._kind === 'scheduled_intent' ? `SI-${task.id.slice(-4)}` : `T-${task.id.slice(-4)}`}
						</td>
						<td class="px-4 py-3">
							<span class={task._kind === 'scheduled_intent' && task.status === 'PENDING'
								? 'text-red-600 font-semibold'
								: task.status === 'SKIPPED' || task.status === 'CANCELLED' || task.status === 'EXPIRED'
									? 'text-gray-400 line-through'
									: ''}>
								{task.date}
							</span>
							{#if task._kind === 'scheduled_intent'}
								<span class="ml-2 rounded px-1.5 py-0.5 text-xs font-semibold {task.status === 'PENDING' ? 'bg-blue-100 text-blue-800' : task.status === 'DONE' ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-200 text-gray-600'}">
									{task.status}
								</span>
							{/if}
						</td>
						<td class="px-4 py-3 font-medium">{task.origin}</td>
						<td class="px-4 py-3">
							<div class="flex items-center gap-2">
								{#if task.channelIcon === 'email'}
									<Mail class="h-4 w-4 text-gray-500" />
								{:else}
									<Phone class="h-4 w-4 text-gray-500" />
								{/if}
								{task.channel}
							</div>
						</td>
						<td class="px-4 py-3 font-mono text-sm">
							{#if task.profileHref}
								<a
									href={task.profileHref}
									class="text-blue-600 hover:underline"
									title={task.clientName}>{task.clientId}</a
								>
							{:else}
								{task.clientId}
							{/if}
						</td>
						<td class="px-4 py-3">{task.intent}</td>
						<td class="px-4 py-3 font-mono text-sm">{task.commId}</td>
						<td class="px-4 py-3 font-mono text-sm">{task.refId}</td>
						<td class="px-4 py-3 text-center">
							<DropdownMenu.Root>
								<DropdownMenu.Trigger class="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-gray-100 text-gray-500" on:click={(e) => e.stopPropagation()}>
									<MoreHorizontal class="h-5 w-5" />
								</DropdownMenu.Trigger>
								<DropdownMenu.Content align="end">
									{#if task._kind === 'scheduled_intent' && task.status === 'PENDING'}
										<DropdownMenu.Item on:click={(e) => { e.stopPropagation(); quickCancel(task.id); }}>
											<Trash2 class="mr-2 h-4 w-4" />
											Delete
										</DropdownMenu.Item>
									{/if}
									<DropdownMenu.Item on:click={(e) => { e.stopPropagation(); startEdit(task); }}>
										<Edit class="mr-2 h-4 w-4" />
										Edit
									</DropdownMenu.Item>
									<DropdownMenu.Item>
										<Phone class="mr-2 h-4 w-4" />
										Call
									</DropdownMenu.Item>
									<DropdownMenu.Item>
										<MessageSquare class="mr-2 h-4 w-4" />
										SMS
									</DropdownMenu.Item>
									<DropdownMenu.Item>
										<Send class="mr-2 h-4 w-4" />
										Email
									</DropdownMenu.Item>
								</DropdownMenu.Content>
							</DropdownMenu.Root>
						</td>
					</tr>

	{#if expandedTaskId === task.id}
						<tr>
							<td colspan="9" class="p-0 border-b-2 border-gray-800">
								<div transition:slide class="bg-gray-100 p-6 shadow-inner">
									<div class="mb-4 text-center">
										<h3 class="text-lg font-semibold text-gray-900">
											Task Summary {task._kind === 'scheduled_intent' ? `SI-${task.id.slice(-4)}` : `T-${task.id.slice(-4)}`}
										</h3>
									</div>

									{#if task._kind === 'scheduled_intent'}
										{@const raw = task._raw}
										<div class="mb-4 flex flex-wrap gap-4 text-sm font-medium text-gray-700">
											<span>comm id-{task.commId}</span>
											<span>Ref-id {task.refId.replace('id ', '')}</span>
											<span>{raw.intentType === 'CUSTOMER_COMMITMENT_A' ? 'Opportunity' : 'Service'}</span>
											<span>{raw.tier ?? 'Tier 2B'}</span>
										</div>
										<p class="font-medium text-gray-900 mb-2">
											Customer id {raw.profileId}
											{#if raw.profileHref}
												<a href={raw.profileHref} class="text-blue-600 hover:underline">{raw.clientName}</a>
											{:else}
												{raw.clientName}
											{/if}
										</p>
										<p class="font-medium text-gray-700 mb-2">
											Origin {raw.originalChannel === 'email' ? 'incoming email' : raw.originalChannel === 'voice' ? 'incoming Call' : `incoming ${raw.originalChannel}`}
										</p>
										<div class="rounded border border-gray-400 bg-white p-3 text-sm text-gray-800 shadow-sm mb-4">
											<div class="font-semibold mb-1">Date: {task.date}</div>
											<div>
												{raw.clientName} told us about <strong>{raw.whatHeWants || 'their request'}</strong>{raw.rawTimeframe ? ` — they said "${raw.rawTimeframe}"` : ''}. Created {new Date(raw.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} via {raw.originalChannel || 'email'}.
											</div>
										</div>

										{#if editingIntentId === task.id}
											<div class="mb-4 rounded border border-blue-300 bg-blue-50 p-4">
												<h4 class="font-semibold text-gray-900 mb-3">Edit Intent</h4>
												<div class="grid grid-cols-3 gap-4 mb-3">
													<div>
														<label class="block text-xs font-semibold text-gray-600 mb-1">Status</label>
														<select bind:value={editDraft.status} class="w-full rounded border border-gray-300 px-2 py-1.5 text-sm">
															<option value="PENDING">Pending</option>
															<option value="DONE">Done</option>
															<option value="SKIPPED">Skipped</option>
															<option value="CANCELLED">Cancelled</option>
															<option value="EXPIRED">Expired</option>
														</select>
													</div>
													<div>
														<label class="block text-xs font-semibold text-gray-600 mb-1">Due</label>
														<input type="datetime-local" bind:value={editDraft.dueAt} class="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
													</div>
													<div>
														<label class="block text-xs font-semibold text-gray-600 mb-1">Expires</label>
														<input type="datetime-local" bind:value={editDraft.expiresAt} class="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
													</div>
												</div>
												<div class="flex gap-2">
													<Button size="sm" on:click={() => saveEdit(task.id)}>
														<Save class="mr-2 h-4 w-4" /> Save
													</Button>
													<Button size="sm" variant="ghost" on:click={cancelEdit}>
														<X class="mr-2 h-4 w-4" /> Cancel
													</Button>
												</div>
											</div>
										{/if}

										<div>
											<h4 class="font-semibold text-gray-900 mb-2">Task Date:</h4>
											<div class="flex items-start justify-between">
												<div class="flex-1 pr-4 text-gray-800 font-medium">
													1. {task.date} {raw.actor === 'CUSTOMER' ? 'check if' : 'follow up with'} {raw.clientName} — {raw.whatHeWants || 'pending'} — comm {task.commId}
												</div>
												<div class="flex flex-col items-end gap-2">
													<div class="flex items-center gap-3 text-sm font-semibold">
														{#if task.status === 'PENDING'}
															<button class="hover:underline text-gray-700" on:click={(e) => { e.stopPropagation(); quickReschedule(task.id, raw.dueAt); }}>Reschedule</button>
															<button class="hover:underline text-red-600" on:click={(e) => { e.stopPropagation(); quickCancel(task.id); }}>Cancel</button>
														{/if}
														<button class="hover:underline text-gray-700" on:click={(e) => { e.stopPropagation(); startEdit(task); }}>Edit</button>
														<button class="hover:underline text-gray-700" on:click={(e) => { e.stopPropagation(); }}>Delete</button>
													</div>
													<Button class="bg-red-500 hover:bg-red-600 text-white font-semibold rounded text-sm px-6" on:click={(e) => { e.stopPropagation(); startEdit(task); }}>
														update task
													</Button>
												</div>
											</div>
										</div>
									{:else}
										<!-- Original Task expanded view -->
										<div class="mb-4 flex flex-wrap gap-4 text-sm font-medium text-gray-700">
											<span>comm id-{task.commId}</span>
											<span>Ref-id {task.refId.replace('id ', '')}</span>
											<span>{task.intent === 'opp' ? 'Opportunity' : 'Support'}</span>
										</div>
										<p class="font-medium text-gray-900 mb-2">
											Customer id {task.clientId}
											{#if task.profileHref}
												<a href={task.profileHref} class="text-blue-600 hover:underline">{task.clientName}</a>
											{:else}
												{task.clientName}
											{/if}
										</p>
										<p class="font-medium text-gray-700 mb-2">
											Origin {task.channel.includes('Ph') ? 'incoming Call' : 'incoming email'}
										</p>
										<div class="rounded border border-gray-400 bg-white p-3 text-sm text-gray-800 shadow-sm mb-4">
											<div class="font-semibold mb-1">Date: {task.date}</div>
											<div>
												{task.summary}
											</div>
										</div>

										<div>
											<h4 class="font-semibold text-gray-900 mb-2">Task Date:</h4>
											<div class="flex items-start justify-between">
												<div class="flex-1 pr-4 text-gray-800 font-medium">
													1. {task.date} {task.channel.includes('Ph') ? 'make outgoing call to' : 'send email refer to'} {task.clientId}, refer to comm {task.commId}, Ref-id {task.refId.replace('id ', '')}, customer id {task.clientId}
												</div>
												<div class="flex flex-col items-end gap-2">
													<div class="flex items-center gap-3 text-sm font-semibold">
														<button class="hover:underline text-gray-700">Edit</button>
														<button class="hover:underline text-gray-700">Delete</button>
													</div>
													<Button class="bg-red-500 hover:bg-red-600 text-white font-semibold rounded text-sm px-6">
														update task
													</Button>
												</div>
											</div>
										</div>
									{/if}
								</div>
							</td>
						</tr>
					{/if}
				{/each}

				{#if filteredTasks.length === 0}
					<tr>
						<td colspan="10" class="px-4 py-8 text-center text-gray-500">
							No tasks found.
						</td>
					</tr>
				{/if}
			</tbody>
		</table>
	</div>
</div>
