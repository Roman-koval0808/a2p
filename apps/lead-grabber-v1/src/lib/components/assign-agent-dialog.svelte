<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index';
	import { X } from 'lucide-svelte';

	interface Props {
		open?: boolean;
		endpointName?: string;
		agents?: string[];
		preSelectedAgents?: string[];
		onAssign?: (selectedAgents: string[]) => void;
	}

	let {
		open = $bindable(false),
		endpointName = 'Kurt Ravioli Builder',
		agents = ['Marcus George', 'Betty Mcgregor', 'Gregory Malonzo', 'Jared YU'],
		preSelectedAgents = [],
		onAssign
	}: Props = $props();

	let selectedAgents = $state<Set<string>>(new Set());

	function toggleAgent(agent: string) {
		if (selectedAgents.has(agent)) {
			selectedAgents.delete(agent);
		} else {
			selectedAgents.add(agent);
		}
		selectedAgents = new Set(selectedAgents);
	}

	function handleSelect() {
		if (onAssign) {
			onAssign(Array.from(selectedAgents));
		}
		open = false;
		selectedAgents = new Set();
	}

	function handleCancel() {
		open = false;
		selectedAgents = new Set();
	}

	// Initialize selected agents when dialog opens or preSelectedAgents changes
	$effect(() => {
		if (open && preSelectedAgents.length > 0) {
			selectedAgents = new Set(preSelectedAgents);
		} else if (!open) {
			selectedAgents = new Set();
		}
	});
</script>

<Dialog.Root bind:open>
	<Dialog.Content
		class="!h-[290px] !w-[462px] rounded-sm bg-white !p-0 shadow-[0px_4px_4px_rgba(0,0,0,0.25)] [&>button]:hidden"
	>
		<div class="relative flex h-full w-full flex-col p-6">
			<!-- Close Button -->
			<button
				class="absolute right-4 top-4 h-[17px] w-[17px] text-[#717171] transition-colors hover:text-[#3D3D3D]"
				onclick={() => (open = false)}
				aria-label="Close"
			>
				<X class="h-[17px] w-[17px]" />
			</button>

			<!-- Title -->
			<h2 class="mb-4 font-sans text-xl font-semibold leading-[24px] text-[#717171]">
				Assigning {endpointName} to:
			</h2>

			<!-- All Sales Agents Label -->
			<p class="mb-3 font-sans text-base font-medium italic leading-[19px] text-[#577AB7]">
				All Sales Agents:
			</p>

			<!-- Agent List -->
			<div class="mb-4 min-h-0 flex-1 overflow-y-auto">
				<div class="flex flex-col gap-3">
					{#each agents as agent}
						<label class="flex cursor-pointer items-center gap-3">
							<input
								type="checkbox"
								checked={selectedAgents.has(agent)}
								onchange={() => toggleAgent(agent)}
								class="h-[21px] w-[21px] cursor-pointer rounded-[2px] border-[1.4px] border-[#717171] accent-[#577AB7]"
							/>
							<span class="font-sans text-lg font-medium leading-[21px] text-[#717171]">
								{agent}
							</span>
						</label>
					{/each}
				</div>
			</div>

			<!-- Action Buttons -->
			<div class="flex flex-shrink-0 items-center justify-end gap-3">
				<button
					class="flex h-[33px] w-[77px] items-center justify-center rounded border border-[#577AB7] bg-white font-sans text-base font-medium leading-[19px] text-[#577AB7] transition-colors hover:bg-gray-50"
					onclick={handleCancel}
				>
					Cancel
				</button>
				<button
					class="flex h-[33px] w-[123px] items-center justify-center rounded bg-[#577AB7] font-sans text-base font-medium leading-[19px] text-white transition-colors hover:bg-[#577AB7]/90"
					onclick={handleSelect}
				>
					Select Agent
				</button>
			</div>
		</div>
	</Dialog.Content>
</Dialog.Root>
