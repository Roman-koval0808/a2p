<script lang="ts">
	import { Button } from '$lib/components/ui/button/index';
	import * as Dialog from '$lib/components/ui/dialog/index';
	import { CheckCircle2 } from 'lucide-svelte';
</script>

<Dialog.Root>
	<Dialog.Trigger>
		<Button variant="ghost" class="hover:bg-transparent">
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
			<div class="mt-1 text-center font-medium">Rory</div>
		</Dialog.Header>

		<div class="mt-6">
			<div class="mb-2 text-gray-700">Conversation Summary:</div>
			<textarea
				placeholder="Summarize the Conversation"
				class="min-h-[120px] w-full rounded-lg border border-gray-200 bg-white p-4 text-gray-500 placeholder:text-gray-400"
			></textarea>
		</div>

		<div class="mt-6 flex justify-center gap-4">
			<button class="rounded-lg bg-primary px-12 py-2.5 font-medium text-white hover:bg-primary/90">
				WON
			</button>
			<button
				class="rounded-lg border border-primary px-12 py-2.5 font-medium text-primary hover:bg-primary/5"
			>
				Last
			</button>
			<button
				class="rounded-lg border border-primary px-12 py-2.5 font-medium text-primary hover:bg-primary/5"
			>
				Other
			</button>
		</div>
	</Dialog.Content>
</Dialog.Root>
