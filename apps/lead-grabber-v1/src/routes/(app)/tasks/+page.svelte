<script lang="ts">
	import {
		MoreHorizontal,
		Mail,
		Phone,
		Trash2,
		Edit,
		MessageSquare,
		Send
	} from 'lucide-svelte';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { slide } from 'svelte/transition';

	export let data;
	
	let { tasks } = data;
	let activeTab = 'ALL';
	let expandedTaskId = null;

	const tabs = ['ALL', 'Customer Requests', 'Owner Actions'];

	$: filteredTasks = tasks.filter((task) => {
		if (activeTab === 'ALL') return true;
		if (activeTab === 'Customer Requests') return task.origin === 'CR';
		if (activeTab === 'Owner Actions') return task.origin === 'OA';
		return true;
	});

	function toggleExpand(id) {
		if (expandedTaskId === id) {
			expandedTaskId = null;
		} else {
			expandedTaskId = id;
		}
	}
</script>

<div class="flex h-full flex-col p-8">
	<!-- Header -->
	<div class="mb-8 text-center">
		<h1 class="text-xl font-medium text-gray-500 mb-2">List of tasks</h1>
		<h2 class="text-3xl font-bold tracking-tight">schedule list of taks to be completed</h2>
	</div>

	<!-- Tabs -->
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

	<!-- Table container -->
	<div class="rounded-md border bg-white overflow-hidden flex-1 overflow-y-auto">
		<table class="w-full text-left text-sm text-gray-700">
			<thead class="sticky top-0 bg-white shadow-sm font-semibold text-gray-900 border-b">
				<tr>
					<th class="px-4 py-3">Task ID</th>
					<th class="px-4 py-3">Date</th>
					<th class="px-4 py-3">origin</th>
					<th class="px-4 py-3">Channel</th>
					<th class="px-4 py-3">Client ID</th>
					<th class="px-4 py-3">Client Name</th>
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
						<td class="px-4 py-3 font-medium text-gray-900">T-{task.id.substring(task.id.length - 4)}</td>
						<td class="px-4 py-3">{task.date}</td>
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
						<td class="px-4 py-3">{task.clientId}</td>
						<td class="px-4 py-3 font-medium text-gray-900">{task.clientName}</td>
						<td class="px-4 py-3">{task.intent}</td>
						<td class="px-4 py-3">{task.commId}</td>
						<td class="px-4 py-3">{task.refId}</td>
						<td class="px-4 py-3 text-center">
							<DropdownMenu.Root>
								<DropdownMenu.Trigger asChild let:builder>
									<Button variant="ghost" size="icon" builders={[builder]} on:click={(e) => e.stopPropagation()}>
										<MoreHorizontal class="h-5 w-5" />
									</Button>
								</DropdownMenu.Trigger>
								<DropdownMenu.Content align="end">
									<DropdownMenu.Item>
										<Trash2 class="mr-2 h-4 w-4" />
										Delete
									</DropdownMenu.Item>
									<DropdownMenu.Item>
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
							<td colspan="10" class="p-0 border-b-2 border-gray-800">
								<div transition:slide class="bg-gray-100 p-6 shadow-inner">
									<div class="mb-4 flex items-center justify-between">
										<h3 class="text-lg font-semibold text-gray-900">Task Summary T-{task.id.substring(task.id.length - 4)}</h3>
										<div class="flex gap-4 text-sm font-medium text-gray-700">
											<span>comm {task.commId}</span>
											<span>Ref-{task.refId}</span>
											<span>Opportunity</span>
											<span>Tier 1</span>
										</div>
									</div>
									
									<div class="mb-4">
										<p class="font-medium text-gray-900 mb-1">Customer id {task.clientId} <span class="ml-4">{task.clientName}</span></p>
										<p class="font-medium text-gray-700 mb-2">Origin: {task.origin === 'CR' ? (task.channel.includes('Ph') ? 'incoming Call' : 'incoming email') : 'Owner Action'}</p>
										
										<div class="rounded border border-gray-300 bg-white p-3 text-sm text-gray-800 shadow-sm">
											<div class="font-semibold mb-1">Date: {new Date(task.fullDateString).toLocaleDateString('en-US', { month: 'long', day: 'numeric'})}</div>
											<div>
												{#if task.title.includes('Call') || task.description?.includes('Call')}
													{task.clientName} says "I would like to buy a furnace do you folks do financing?" Rep: "Yes we do, would you like to set up an appointment?" {task.clientName}: "I am busy this week give me a call in a week and we will set something up."
												{:else}
													I was looking at your website, I would like to get a quote on central air. I am heading out of town and will get in touch with you in 2 weeks.
												{/if}
											</div>
										</div>
									</div>

									<div>
										<h4 class="font-semibold text-gray-900 mb-2">Task Date:</h4>
										<div class="flex items-start justify-between">
											<div class="flex-1 pr-4 text-gray-800 font-medium">
												1. {task.date} {task.channel.includes('Ph') ? 'make outgoing call to' : 'send email refer to'} {task.clientId}, refer to comm {task.commId}, Ref-{task.refId}, customer id {task.clientId}
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

<style>
	/* Any page-specific overrides go here */
</style>
