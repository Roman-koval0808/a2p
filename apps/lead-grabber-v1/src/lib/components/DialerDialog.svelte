<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';

	interface Props {
		open?: boolean;
		title?: string;
		/** Keys to show (default: 1-9, *, 0, #). Order: row-major. */
		keys?: string[];
		/** Keys that are already chosen elsewhere; shown disabled and not selectable. */
		disabledKeys?: string[];
		/** If true, dialog closes after one key is selected. Default true. */
		singleKey?: boolean;
		/** Called when a key is selected. */
		onSelect?: (key: string) => void;
	}

	const DEFAULT_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];

	let {
		open = $bindable(false),
		title = 'Select key',
		keys = DEFAULT_KEYS,
		disabledKeys = [],
		singleKey = true,
		onSelect
	}: Props = $props();

	function handleKey(k: string) {
		if (disabledKeys.includes(k)) return;
		onSelect?.(k);
		if (singleKey) open = false;
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="w-[min(320px,92vw)] sm:max-w-[320px]">
		<Dialog.Header>
			<Dialog.Title class="font-['Poppins'] text-lg font-semibold text-[#808080]"
				>{title}</Dialog.Title
			>
			<Dialog.Description class="font-['Poppins'] text-sm text-[#969696]">
				Tap a key to select it.
			</Dialog.Description>
		</Dialog.Header>
		<div class="grid grid-cols-3 gap-2 py-2">
			{#each keys as k}
				{@const disabled = disabledKeys.includes(k)}
				<button
					type="button"
					onclick={() => handleKey(k)}
					{disabled}
					class="flex h-12 items-center justify-center rounded-lg border font-['Poppins'] text-xl font-medium transition-colors {disabled
						? 'cursor-not-allowed border-[#e5e5e5] bg-[#f5f5f5] text-[#b0b0b0]'
						: 'border-[#969696] bg-white text-[#808080] hover:border-[#577AB7] hover:bg-[#ECF3FF] hover:text-[#577AB7] active:scale-95'}"
				>
					{k}
				</button>
			{/each}
		</div>
		<Dialog.Footer>
			<Dialog.Close
				class="h-9 rounded-md border border-[#969696] bg-white px-4 font-['Poppins'] text-sm text-[#808080] hover:bg-[#f5f5f5]"
			>
				Cancel
			</Dialog.Close>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
