<script lang="ts">
	import { Button } from '$lib/components/ui/button/index';
	import * as Dialog from '$lib/components/ui/dialog/index';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Switch } from '$lib/components/ui/switch';
	import { getSvgIcon } from '$lib/utils/getSvgIcon';
	import { iconOptions } from '$lib/utils/iconOptions';
	import { onMount } from 'svelte';

	let { children,
		buttonText,
		showIcon = true,
		selectedIcon = 'Play',
		buttonColor = '#FF6B00',
		fontColor = '#ffffff',
		url = '',
		onSave
	} = $props<{
		buttonText: string;
		showIcon?: boolean;
		selectedIcon?: string;
		buttonColor?: string;
		fontColor?: string;
		url?: string;
		onSave: (data: { text: string; icon: string; showIcon: boolean; buttonColor?: string; fontColor?: string; url?: string }) => void;
	}>();

	let isOpen = $state(false);
	let editedText = $state(buttonText);
	let editedShowIcon = $state(showIcon);
	let editedIcon = $state(selectedIcon);
	let editedButtonColor = $state(buttonColor);
	let editedFontColor = $state(fontColor);
	let editedUrl = $state(url);

	const icons = iconOptions;

	let iconSvgs: Record<string, string> = $state({});

	onMount(async () => {
		for (const { icon } of icons) {
			iconSvgs[icon] = await getSvgIcon(icon);
		}
	});

	function handleSave() {
		onSave({
			text: editedText,
			icon: editedIcon,
			showIcon: editedShowIcon,
			buttonColor: editedButtonColor,
			fontColor: editedFontColor,
			url: editedUrl
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
			<Dialog.Title>Edit Secondary Button</Dialog.Title>
			<Dialog.Description>Customize the secondary button appearance.</Dialog.Description>
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
				<Label for="buttonUrl">Link / URL:</Label>
				<Input id="buttonUrl" bind:value={editedUrl} placeholder="https://..." />
			</div>

			<div class="grid grid-cols-2 gap-4">
				<div class="grid gap-2">
					<Label for="btn-bg-color">Background Color:</Label>
					<div class="flex items-center gap-2">
						<input id="btn-bg-color" type="color" bind:value={editedButtonColor} class="h-10 w-10 cursor-pointer rounded border border-gray-300 p-1" />
						<Input bind:value={editedButtonColor} class="uppercase" />
					</div>
				</div>
				<div class="grid gap-2">
					<Label for="btn-font-color">Font Color:</Label>
					<div class="flex items-center gap-2">
						<input id="btn-font-color" type="color" bind:value={editedFontColor} class="h-10 w-10 cursor-pointer rounded border border-gray-300 p-1" />
						<Input bind:value={editedFontColor} class="uppercase" />
					</div>
				</div>
			</div>

			<div class="flex items-center gap-2">
				<Label>Show Icon:</Label>
				<Switch checked={editedShowIcon} onCheckedChange={(v) => (editedShowIcon = v)} />
			</div>

			{#if editedShowIcon}
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
			{/if}
		</div>

		<Dialog.Footer>
			<Button onclick={() => (isOpen = false)} variant="outline">Cancel</Button>
			<Button onclick={handleSave}>Save changes</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
