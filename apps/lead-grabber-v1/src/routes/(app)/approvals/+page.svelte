<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import { CheckCircle, XCircle, Edit, Mail, MessageSquare, Clock, User } from 'lucide-svelte';
	import type { PageData } from './$types';

	export let data: PageData;

	let editingId: string | null = null;
	let editContent: string = '';
	let isSubmitting = false;

	function formatTimeLeft(deadline: string | Date | null) {
		if (!deadline) return 'No deadline';
		const ms = new Date(deadline).getTime() - Date.now();
		if (ms < 0) return 'Expired';
		const mins = Math.floor(ms / 60000);
		if (mins > 60) return `${Math.floor(mins / 60)}h ${mins % 60}m left`;
		return `${mins}m left`;
	}

	function startEdit(approval: any) {
		editingId = approval.approval_id;
		editContent = approval.draft_content;
	}

	function cancelEdit() {
		editingId = null;
		editContent = '';
	}
</script>

<div class="space-y-6 pb-12">
	<div class="flex flex-col gap-1 border-b border-slate-100 pb-4">
		<h1 class="text-3xl font-extrabold tracking-tight text-slate-900 flex items-center gap-3">
			<CheckCircle class="h-8 w-8 text-primary" />
			Approval Queue
		</h1>
		<p class="text-slate-500 max-w-2xl">
			Review, edit, and approve AI-drafted responses before they are sent to customers.
		</p>
	</div>

	{#if data.approvals.length === 0}
		<div class="bg-slate-50 border border-slate-200 border-dashed rounded-2xl p-12 text-center flex flex-col items-center justify-center gap-3">
			<CheckCircle class="h-10 w-10 text-slate-300" />
			<h3 class="text-slate-700 font-bold">All caught up!</h3>
			<p class="text-slate-500 text-sm">There are no pending approvals in the queue right now.</p>
		</div>
	{:else}
		<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
			{#each data.approvals as item (item.approval_id)}
				<div class="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden flex flex-col">
					<!-- Header -->
					<div class="bg-slate-50 px-5 py-3 border-b border-slate-100 flex items-center justify-between">
						<div class="flex items-center gap-2">
							{#if item.draft_type === 'sms'}
								<MessageSquare class="h-4 w-4 text-emerald-600" />
								<span class="text-xs font-bold text-slate-700 uppercase">SMS Draft</span>
							{:else}
								<Mail class="h-4 w-4 text-blue-600" />
								<span class="text-xs font-bold text-slate-700 uppercase">Email Draft</span>
							{/if}
						</div>
						
						<div class="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full {new Date(item.approval_deadline).getTime() < Date.now() + 900000 ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'}">
							<Clock class="h-3 w-3" />
							{formatTimeLeft(item.approval_deadline)}
						</div>
					</div>

					<!-- Body -->
					<div class="p-5 flex-1 space-y-4">
						<div class="flex items-start gap-3 text-sm">
							<div class="mt-0.5 bg-slate-100 p-1.5 rounded-full text-slate-500">
								<User class="h-4 w-4" />
							</div>
							<div>
								<p class="font-bold text-slate-900">{item.container.person.name || 'Unknown Contact'}</p>
								<p class="text-slate-500 text-xs">Thread: {item.container.thread_type}</p>
							</div>
						</div>

						<div class="bg-slate-50 p-4 rounded-xl border border-slate-100 text-sm text-slate-700 relative group">
							{#if editingId === item.approval_id}
								<textarea
									bind:value={editContent}
									rows="5"
									class="w-full bg-white border border-slate-300 rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-primary text-sm resize-none"
								></textarea>
								<div class="flex justify-end gap-2 mt-2">
									<button type="button" class="text-xs text-slate-500 hover:text-slate-700 font-semibold px-2 py-1" on:click={cancelEdit}>Cancel</button>
								</div>
							{:else}
								<div class="whitespace-pre-wrap">{item.draft_content}</div>
								<button 
									type="button" 
									class="absolute top-2 right-2 p-1.5 bg-white border border-slate-200 rounded-lg text-slate-400 hover:text-primary shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"
									on:click={() => startEdit(item)}
								>
									<Edit class="h-3 w-3" />
								</button>
							{/if}
						</div>
					</div>

					<!-- Actions -->
					<div class="px-5 py-4 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between gap-3">
						<form
							method="POST"
							action="?/reject"
							use:enhance={() => {
								isSubmitting = true;
								return async ({ update, result }) => {
									isSubmitting = false;
									await update();
									if (result.type === 'success') toast.success('Draft rejected');
								};
							}}
						>
							<input type="hidden" name="approval_id" value={item.approval_id} />
							<button 
								type="submit" 
								disabled={isSubmitting}
								class="flex items-center gap-1.5 text-red-600 hover:bg-red-50 px-3 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
							>
								<XCircle class="h-4 w-4" />
								Reject
							</button>
						</form>

						<form
							method="POST"
							action="?/approve"
							use:enhance={() => {
								isSubmitting = true;
								return async ({ update, result }) => {
									isSubmitting = false;
									editingId = null;
									await update();
									if (result.type === 'success') toast.success('Draft approved and sent!');
								};
							}}
							class="flex-1"
						>
							<input type="hidden" name="approval_id" value={item.approval_id} />
							{#if editingId === item.approval_id}
								<input type="hidden" name="edited_content" value={editContent} />
							{/if}
							
							<button 
								type="submit" 
								disabled={isSubmitting}
								class="w-full flex justify-center items-center gap-2 bg-primary hover:bg-primary/95 text-white px-4 py-2 rounded-lg text-sm font-bold shadow-sm transition-colors disabled:opacity-50"
							>
								<CheckCircle class="h-4 w-4" />
								{editingId === item.approval_id ? 'Approve & Send Edit' : 'Approve & Send'}
							</button>
						</form>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
