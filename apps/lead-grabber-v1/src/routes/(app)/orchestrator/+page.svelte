<script lang="ts">
	import { 
		MessageSquareText, 
		Clock, 
		Activity, 
		CheckCircle, 
		AlertTriangle, 
		Phone,
		Mail,
		Timer,
		CheckSquare
	} from 'lucide-svelte';
	import { Button } from '$lib/components/ui/button';

	let { data } = $props();

	let activeTab = $state('threads');

	let containers = $derived(data.containers);
	let approvals = $derived(containers.flatMap((c: any) => c.approvals.map((a: any) => ({ ...a, commRef: c.commRef }))));
	let timers = $derived(containers.flatMap((c: any) => c.timers.map((t: any) => ({ ...t, commRef: c.commRef }))));
	let tasks = $derived(containers.flatMap((c: any) => c.commTasks.map((t: any) => ({ ...t, commRef: c.commRef }))));
</script>

<div class="flex h-full flex-col bg-background">
	<header class="flex shrink-0 items-center justify-between border-b px-6 py-4">
		<div class="flex items-center gap-3">
			<Activity class="h-6 w-6 text-primary" />
			<div>
				<h1 class="text-xl font-bold tracking-tight">A2P Orchestrator Dashboard</h1>
				<p class="text-sm text-muted-foreground">Monitor communication threads, timers, and approvals in real-time.</p>
			</div>
		</div>
		<Button variant="outline" onclick={() => location.reload()}>
			Refresh Data
		</Button>
	</header>

	<div class="flex-1 overflow-auto bg-muted/10 p-6">
		<div class="mb-6 flex space-x-2 border-b">
			<button class="px-4 py-2 border-b-2 transition-colors {activeTab === 'threads' ? 'border-primary font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'}" onclick={() => activeTab = 'threads'}>
				<div class="flex items-center gap-2"><MessageSquareText class="h-4 w-4" /> Threads ({containers.length})</div>
			</button>
			<button class="px-4 py-2 border-b-2 transition-colors {activeTab === 'approvals' ? 'border-primary font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'}" onclick={() => activeTab = 'approvals'}>
				<div class="flex items-center gap-2"><CheckCircle class="h-4 w-4" /> Approvals ({approvals.length})</div>
			</button>
			<button class="px-4 py-2 border-b-2 transition-colors {activeTab === 'tasks' ? 'border-primary font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'}" onclick={() => activeTab = 'tasks'}>
				<div class="flex items-center gap-2"><CheckSquare class="h-4 w-4" /> Tasks ({tasks.length})</div>
			</button>
			<button class="px-4 py-2 border-b-2 transition-colors {activeTab === 'timers' ? 'border-primary font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'}" onclick={() => activeTab = 'timers'}>
				<div class="flex items-center gap-2"><Timer class="h-4 w-4" /> Timers ({timers.length})</div>
			</button>
		</div>

		<div class="space-y-4">
			{#if activeTab === 'threads'}
				{#if containers.length === 0}
					<div class="text-center py-10 text-muted-foreground">No active threads. Make a test call to start one.</div>
				{/if}
				{#each containers as container}
					<div class="rounded-lg border bg-card text-card-foreground shadow-sm">
						<div class="flex flex-col space-y-1.5 p-6 border-b">
							<div class="flex items-center justify-between">
								<h3 class="text-lg font-semibold leading-none tracking-tight flex items-center gap-2">
									{container.threadType.toUpperCase()} Thread
									<span class="text-xs px-2 py-1 bg-muted rounded-full font-normal">{container.commRef}</span>
								</h3>
								<div class="flex gap-2">
									<span class="text-xs px-2 py-1 bg-blue-100 text-blue-800 rounded font-medium">{container.lifecycle}</span>
									<span class="text-xs px-2 py-1 bg-slate-100 text-slate-800 rounded font-medium">{container.state}</span>
								</div>
							</div>
							<p class="text-sm text-muted-foreground">Subject: {container.subject || 'No subject'}</p>
						</div>
						
						<div class="p-6 pt-4 grid grid-cols-1 md:grid-cols-2 gap-6">
							<div>
								<h4 class="font-medium mb-3 flex items-center gap-2"><MessageSquareText class="h-4 w-4 text-muted-foreground"/> Entries ({container.entries.length})</h4>
								<div class="space-y-3">
									{#each container.entries as entry}
										<div class="text-sm border rounded p-3 bg-muted/30">
											<div class="flex justify-between text-xs text-muted-foreground mb-1">
												<span class="font-medium text-foreground uppercase">{entry.channel} - {entry.direction}</span>
												<span>{new Date(entry.occurredAt).toLocaleString()}</span>
											</div>
											<div class="line-clamp-2">{entry.transcript || 'No transcript'}</div>
										</div>
									{/each}
								</div>
							</div>
							<div>
								<h4 class="font-medium mb-3 flex items-center gap-2"><Activity class="h-4 w-4 text-muted-foreground"/> State</h4>
								<div class="text-sm space-y-2">
									<div class="flex justify-between border-b pb-1">
										<span class="text-muted-foreground">SLA Deadline:</span>
										<span>{container.slaDeadline ? new Date(container.slaDeadline).toLocaleString() : 'None'}</span>
									</div>
									<div class="flex justify-between border-b pb-1">
										<span class="text-muted-foreground">Closure Policy:</span>
										<span>{container.closurePolicy}</span>
									</div>
									<div class="flex justify-between border-b pb-1">
										<span class="text-muted-foreground">Resolution:</span>
										<span>{container.resolution || 'Pending'}</span>
									</div>
								</div>
							</div>
						</div>
					</div>
				{/each}
			{:else if activeTab === 'approvals'}
				{#if approvals.length === 0}
					<div class="text-center py-10 text-muted-foreground">No pending approvals.</div>
				{/if}
				<div class="grid grid-cols-1 gap-4">
					{#each approvals as approval}
						<div class="border rounded-lg p-5 bg-card">
							<div class="flex justify-between mb-4">
								<div>
									<h4 class="font-semibold text-lg flex items-center gap-2">
										{#if approval.draftType === 'email'}
											<Mail class="h-4 w-4" />
										{:else}
											<Phone class="h-4 w-4" />
										{/if}
										{approval.draftType.toUpperCase()} Draft
									</h4>
									<p class="text-sm text-muted-foreground">Ref: {approval.commRef}</p>
								</div>
								<span class="px-3 py-1 bg-yellow-100 text-yellow-800 rounded-full text-xs font-semibold h-fit uppercase">{approval.state}</span>
							</div>
							<div class="bg-muted p-4 rounded text-sm mb-4 whitespace-pre-wrap font-mono">{approval.draftContent}</div>
							<div class="flex justify-end gap-2">
								<Button variant="outline" size="sm" class="border-red-200 text-red-600 hover:bg-red-50">Reject</Button>
								<Button size="sm" class="bg-green-600 hover:bg-green-700">Approve & Send</Button>
							</div>
						</div>
					{/each}
				</div>
			{:else if activeTab === 'tasks'}
				{#if tasks.length === 0}
					<div class="text-center py-10 text-muted-foreground">No tasks generated yet.</div>
				{/if}
				<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
					{#each tasks as task}
						<div class="border rounded-lg p-5 bg-card flex flex-col justify-between">
							<div>
								<div class="flex justify-between mb-2">
									<span class="text-xs font-medium uppercase tracking-wider text-primary">{task.category.replace('_', ' ')}</span>
									<span class="text-xs px-2 py-1 bg-slate-100 rounded font-medium">{task.status}</span>
								</div>
								<p class="font-medium mb-1">{task.description}</p>
								<p class="text-xs text-muted-foreground mb-4">Ref: {task.commRef}</p>
							</div>
							<div class="flex justify-between items-center text-xs text-muted-foreground border-t pt-3">
								<span>Due: {new Date(task.due).toLocaleString()}</span>
								<span>Conf: {Math.round(task.confidence * 100)}%</span>
							</div>
						</div>
					{/each}
				</div>
			{:else if activeTab === 'timers'}
				{#if timers.length === 0}
					<div class="text-center py-10 text-muted-foreground">No active timers.</div>
				{/if}
				<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
					{#each timers as timer}
						<div class="border rounded-lg p-4 bg-card">
							<div class="flex items-center gap-2 mb-2">
								<Timer class="h-4 w-4 text-muted-foreground" />
								<span class="font-semibold">{timer.type.replace('_', ' ').toUpperCase()}</span>
							</div>
							<div class="text-sm space-y-1 mb-3">
								<p><span class="text-muted-foreground">Status:</span> {timer.status}</p>
								<p><span class="text-muted-foreground">Fires:</span> {new Date(timer.fireAt).toLocaleString()}</p>
								<p><span class="text-muted-foreground">Ref:</span> {timer.commRef}</p>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</div>
</div>
