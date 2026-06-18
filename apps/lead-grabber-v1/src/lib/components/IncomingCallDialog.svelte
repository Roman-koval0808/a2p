<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index';
	import { X } from 'lucide-svelte';
	import { createEventDispatcher } from 'svelte';

	interface Props {
		open?: boolean;
		caller?: any;
	}

	let { open = $bindable(false), caller = { name: '', phone: '' } }: Props = $props();
	const dispatch = createEventDispatcher();

	function answer() {
		dispatch('answer');
	}
	function decline() {
		dispatch('decline');
	}
	function hold() {
		// For now, just decline the call - you can implement hold logic later
		dispatch('decline');
	}
	function transfer() {
		// For now, just decline the call - you can implement transfer logic later
		dispatch('decline');
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content
		class="flex w-full max-w-sm flex-col items-center gap-4 rounded-xl bg-white p-6 shadow-lg"
	>
		<button class="absolute right-3 top-3 text-gray-400 hover:text-gray-600" onclick={decline}>
			<X class="h-5 w-5" />
		</button>

		<div class="flex flex-col items-center gap-3">
			<!-- Gray avatar circle -->
			<div class="flex h-16 w-16 items-center justify-center rounded-full bg-gray-300">
				<div class="h-8 w-8 rounded-full bg-gray-400"></div>
			</div>

			<!-- Caller name with "is Calling..." -->
			<div class="text-center">
				<div class="text-lg font-medium text-gray-800">
					{caller.name || 'Unknown Caller'} is Calling...
				</div>
			</div>
		</div>

		<!-- 2x2 Button Grid -->
		<div class="mt-2 grid w-full grid-cols-2 gap-3">
			<!-- Top row: Answer and Hold -->
			<button
				class="rounded-lg bg-[#f6b253] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#f6b253]/80"
				onclick={answer}
			>
				Answer
			</button>
			<button
				class="rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-primary/80"
				onclick={hold}
			>
				Hold
			</button>

			<!-- Bottom row: Dismiss and Transfer -->
			<button
				class="rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-primary/80"
				onclick={decline}
			>
				Dismiss
			</button>
			<button
				class="rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-primary/80"
				onclick={transfer}
			>
				Transfer
			</button>
		</div>
	</Dialog.Content>
</Dialog.Root>
