<script lang="ts">
	import { Button } from '$lib/components/ui/button/index';
	import * as Dialog from '$lib/components/ui/dialog/index';
	import { CheckCircle2 } from 'lucide-svelte';
	import { toast } from 'svelte-sonner';

	let {
		selectedMessage = null,
		onClose = () => {}
	}: {
		selectedMessage: { id: string; thread_id: string; customerName?: string; [key: string]: any } | null;
		onClose?: (outcome: string, summary: string) => void;
	} = $props();

	let summaryText = $state('');
	let isClosing = $state(false);
	let dialogOpen = $state(false);

	async function closeThread(outcome: string) {
		if (!selectedMessage) return;
		isClosing = true;
		try {
			const res = await fetch('/api/messages', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					id: selectedMessage.id,
					status: 'closed',
					...(summaryText.trim() && { draft_response: summaryText.trim() })
				})
			});
			if (!res.ok) throw new Error('Failed to close thread');
			toast.success(`Thread closed as "${outcome}"`);
			dialogOpen = false;
			summaryText = '';
			onClose(outcome, summaryText);
		} catch (err) {
			console.error('Error closing thread:', err);
			toast.error('Failed to close conversation');
		} finally {
			isClosing = false;
		}
	}
</script>

<Dialog.Root bind:open={dialogOpen}>
	<Dialog.Trigger>
		<Button variant="ghost" class="hover:bg-transparent" disabled={!selectedMessage}>
			<CheckCircle2 class="text-3xl" size="33" />
		</Button>
	</Dialog.Trigger>
	<Dialog.Content class="!w-[682px] bg-dialog">
		<Dialog.Header class="flex flex-col gap-2">
			<Dialog.Title class="text-center text-2xl font-medium text-gray-700"
				>Close Conversation</Dialog.Title
			>
			<div class="text-center text-sm text-muted-foreground">
				Select one of the options below as to why this lead is being closed.
			</div>
			<div class="mt-1 text-center font-medium">{selectedMessage?.customerName || 'Customer'}</div>
		</Dialog.Header>

		<div class="mt-6">
			<div class="mb-2 text-gray-700">Conversation Summary:</div>
			<textarea
				bind:value={summaryText}
				placeholder="Summarize the Conversation"
				class="min-h-[120px] w-full rounded-lg border border-gray-200 bg-white p-4 text-gray-500 placeholder:text-gray-400"
			></textarea>
		</div>

		<div class="mt-6 flex justify-center gap-4">
			<button
				onclick={() => closeThread('won')}
				disabled={isClosing}
				class="rounded-lg bg-primary px-12 py-2.5 font-medium text-white hover:bg-primary/90 disabled:opacity-50"
			>
				{isClosing ? 'Closing...' : 'WON'}
			</button>
			<button
				onclick={() => closeThread('lost')}
				disabled={isClosing}
				class="rounded-lg border border-primary px-12 py-2.5 font-medium text-primary hover:bg-primary/5 disabled:opacity-50"
			>
				Lost
			</button>
			<button
				onclick={() => closeThread('other')}
				disabled={isClosing}
				class="rounded-lg border border-primary px-12 py-2.5 font-medium text-primary hover:bg-primary/5 disabled:opacity-50"
			>
				Other
			</button>
		</div>
	</Dialog.Content>
</Dialog.Root>
