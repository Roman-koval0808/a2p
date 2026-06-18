<script lang="ts">
	import { Button } from '$lib/components/ui/button/index';
	import * as Dialog from '$lib/components/ui/dialog/index';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { getSvgIcon } from '$lib/utils/getSvgIcon';
	import { onMount } from 'svelte';

	let { children,
		buttonText,
		selectedIcon = 'MessageSquare',
		onSave
	} = $props<{
		buttonText: string;
		selectedIcon?: string;
		onSave: (data: { text: string; icon: string }) => void;
	}>();

	let isOpen = $state(false);
	let editedText = $state(buttonText);
	let editedIcon = $state(selectedIcon);

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

	function handleSave() {
		onSave({
			text: editedText,
			icon: editedIcon
		});
		isOpen = false;
	}

	function selectIcon(iconName: string) {
		editedIcon = iconName;
	}

	function isCurrentIcon(iconName: string) {
		return editedIcon === iconName;
	}
</script>

<Dialog.Root bind:open={isOpen}>
	<Dialog.Trigger>
		{@render children?.()}
	</Dialog.Trigger>
	<Dialog.Content class="w-[600px]">
		<Dialog.Header>
			<Dialog.Title>Edit Primary Button</Dialog.Title>
			<Dialog.Description>Customize the primary button appearance.</Dialog.Description>
		</Dialog.Header>

		<div class="grid gap-4 py-4">
			<div class="grid gap-2">
				<Label for="buttonText">Button text:</Label>
				<div class="flex items-center gap-2">
					<Input id="buttonText" bind:value={editedText} maxlength={20} />
					<span class="text-sm text-muted-foreground">
						{editedText.length} / 20
					</span>
				</div>
			</div>

			<div class="grid gap-2">
				<Label>Select Icon:</Label>
				<div class="grid grid-cols-5 gap-2">
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
		</div>

		<Dialog.Footer>
			<Button onclick={() => (isOpen = false)} variant="outline">Cancel</Button>
			<Button onclick={handleSave}>Save changes</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
