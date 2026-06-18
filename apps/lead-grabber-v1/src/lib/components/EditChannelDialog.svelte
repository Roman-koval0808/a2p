<script lang="ts">
	import { Button } from '$lib/components/ui/button/index';
	import * as Dialog from '$lib/components/ui/dialog/index';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Switch } from '$lib/components/ui/switch';
	import { getSvgIcon } from '$lib/utils/getSvgIcon';
	import { onMount } from 'svelte';

	let { children, channel, onSave } = $props<{
		channel: {
			name: string;
			icon: any;
			value: string;
			url: string;
			target: string;
			buttonColor: string;
			showIcon?: boolean;
		};
		onSave: (channel: any) => void;
	}>();

	let isOpen = $state(false);
	let editedChannel = $state({ ...channel, showIcon: channel.showIcon ?? true });
	let showIcon = $state(editedChannel.showIcon);

	const icons = [
		{ icon: 'Phone', name: 'Phone' },
		{ icon: 'MessageSquare', name: 'Message' },
		{ icon: 'Play', name: 'Play' },
		{ icon: 'Mail', name: 'Mail' },
		{ icon: 'Map', name: 'Map' },
		{ icon: 'Target', name: 'Target' },
		{ icon: 'Clock', name: 'Clock' },
		{ icon: 'Calendar', name: 'Calendar' },
		{ icon: 'CreditCard', name: 'Card' },
		{ icon: 'Search', name: 'Search' }
	];

	let iconSvgs = $state({});

	onMount(async () => {
		for (const { icon } of icons) {
			iconSvgs[icon] = await getSvgIcon(icon);
		}
	});

	function isCurrentIcon(iconName: string) {
		return editedChannel.icon === iconName;
	}

	function handleSave() {
		const updatedChannel = {
			...editedChannel,
			showIcon: showIcon
		};
		onSave(updatedChannel);
		isOpen = false;
	}

	function selectIcon(iconName: string) {
		editedChannel = {
			...editedChannel,
			icon: iconName
		};
	}
</script>

<Dialog.Root bind:open={isOpen}>
	<Dialog.Trigger>
		{@render children?.()}
	</Dialog.Trigger>
	<Dialog.Content class="mx-auto max-w-lg rounded-lg bg-white p-6 shadow-lg">
		<Dialog.Header>
			<Dialog.Title class="text-center text-2xl font-semibold">Edit Channel</Dialog.Title>
			<Dialog.Description class="text-center text-gray-500">
				Customize your channel settings below.
			</Dialog.Description>
		</Dialog.Header>
		<div class="space-y-4">
			<div>
				<Label for="name" class="block text-sm font-medium text-gray-700">Channel type:</Label>
				<Input id="name" bind:value={editedChannel.name} class="mt-1 block w-full" />
			</div>

			<div>
				<Label for="value" class="block text-sm font-medium text-gray-700">Button text:</Label>
				<Input id="value" bind:value={editedChannel.value} class="mt-1 block w-full" />
			</div>

			<div>
				<Label for="url" class="block text-sm font-medium text-gray-700">URL:</Label>
				<Input id="url" bind:value={editedChannel.url} class="mt-1 block w-full" />
			</div>

			<div>
				<Label for="color" class="block text-sm font-medium text-gray-700">Button color:</Label>
				<div class="mt-1 flex items-center">
					<input
						type="color"
						id="color"
						bind:value={editedChannel.buttonColor}
						class="h-10 w-10 cursor-pointer rounded"
					/>
					<Input
						value={editedChannel.buttonColor.toUpperCase()}
						class="ml-2 w-full uppercase"
						readonly
					/>
				</div>
			</div>

			<div class="flex items-center">
				<Label class="text-sm font-medium text-gray-700">Show Icon:</Label>
				<Switch checked={showIcon} onCheckedChange={(v) => (showIcon = v)} class="ml-2" />
			</div>

			{#if showIcon}
				<div>
					<Label class="block text-sm font-medium text-gray-700">Select Icon:</Label>
					<div class="mt-2 grid grid-cols-5 gap-2">
						{#each icons as { icon, name }}
							<button
								type="button"
								class="flex items-center justify-center rounded-md border p-2 transition-colors hover:bg-gray-100 data-[state=selected]:bg-primary data-[state=selected]:text-white [&>svg]:stroke-black data-[state=selected]:[&>svg]:stroke-white"
								data-state={isCurrentIcon(icon) ? 'selected' : 'default'}
								onclick={() => selectIcon(icon)}
								aria-label={`Select ${name} icon`}
							>
								{@html iconSvgs[icon] || ''}
							</button>
						{/each}
					</div>
				</div>
			{/if}
		</div>
		<Dialog.Footer class="mt-4 flex justify-end space-x-2">
			<Button onclick={() => (isOpen = false)} variant="outline">Cancel</Button>
			<Button onclick={handleSave}>Save changes</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
