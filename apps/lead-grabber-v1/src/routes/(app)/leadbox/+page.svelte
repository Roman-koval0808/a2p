<script lang="ts">
	import { Button } from '$lib/components/ui/button/index';
	import * as Card from '$lib/components/ui/card/index';
	import { Switch } from '$lib/components/ui/switch/index';
	import { CodeXml, Edit, MessageSquare, Pen, Phone, Play, PlusCircle } from 'lucide-svelte';
	import EditChannelDialog from '$lib/components/EditChannelDialog.svelte';
	import EditSecondaryButtonDialog from '$lib/components/EditSecondaryButtonDialog.svelte';
	import EditPrimaryButtonDialog from '$lib/components/EditPrimaryButtonDialog.svelte';
	import { toast } from 'svelte-sonner';
	import { enhance } from '$app/forms';
	import { getLeadboxEmbedCode } from '$lib/utils/getEmbedCode.js';
	import * as Dialog from '$lib/components/ui/dialog/index';
	import { getFileUrl } from '$lib/utils/file-url';
	import { Copy, Check } from 'lucide-svelte';
	import { getSvgIcon } from '$lib/utils/getSvgIcon';
	import { iconOptions, iconNames } from '$lib/utils/iconOptions';
	import { onMount } from 'svelte';

	let { data } = $props();
	let user = data.user;
	console.log('user', user);

	// Initialize state from saved data or defaults
	let textOnly = $state(data.leadbox?.leadbox_data?.textOnly ?? true);
	let iconOnly = $state(data.leadbox?.leadbox_data?.iconOnly ?? false);
	let leadBoxOpen = $state(data.leadbox?.leadbox_data?.leadBoxOpen ?? true);
	let primaryIconOnly = $state(data.leadbox?.leadbox_data?.primaryIconOnly ?? false);

	// Add logo image state - use company logo as default if available
	function getDefaultLogo() {
		// If leadbox has a logo, use it
		if (data.leadbox?.leadbox_data?.logoImage) {
			const url = getFileUrl(data.leadbox.leadbox_data.logoImage);
			if (url) return url;
		}
		// Otherwise use company logo if available
		if (data.companyLogo) {
			const url = getFileUrl(data.companyLogo);
			if (url) return url;
		}
		// Fallback to default
		return '/img/gen-can-expo.png';
	}
	let logoImage = $state(getDefaultLogo());
	let logoImageFile: File | null = $state(null);

	let channels = $state(
		data.leadbox?.leadbox_data?.channels ?? [
			{
				name: 'Text',
				icon: MessageSquare,
				value: 'Text Us',
				url: 'sms://',
				target: '_blank',
				buttonColor: '#40C4AA',
				showIcon: true
			},
			{
				name: 'Call',
				icon: Phone,
				value: 'Request a Call',
				url: 'tel://',
				target: '_blank',
				buttonColor: '#3B5BDB',
				showIcon: true
			},
			{
				name: 'Watch',
				icon: Play,
				value: 'Watch a Demo',
				url: 'https://',
				target: '_blank',
				buttonColor: '#3B5BDB',
				showIcon: true
			}
		]
	);

	let secondaryButton = $state(
		data.leadbox?.leadbox_data?.secondaryButton ?? {
			text: 'WATCH A DEMO NOW',
			icon: 'Play',
			showIcon: true,
			buttonColor: '#FF6B00',
			fontColor: '#ffffff',
			url: ''
		}
	);

	let primaryButton = $state(
		data.leadbox?.leadbox_data?.primaryButton ?? {
			text: 'TEXT US',
			icon: 'Phone'
		}
	);

	let topBanner = $state(
		data.leadbox?.leadbox_data?.topBanner ?? {
			text: 'Text with us.',
			backgroundColor: '#3B5BDB',
			fontColor: '#ffffff',
			fontFamily: 'sans-serif'
		}
	);

	let closedState = $state(
		data.leadbox?.leadbox_data?.closedState ?? {
			bannerText: 'QUESTIONS? JUST ASK!',
			bannerBgColor: '#FF6B00',
			bannerFontColor: '#ffffff',
			buttonText: 'TEXT US',
			buttonBgColor: '#ffffff',
			buttonFontColor: '#222222',
			iconColor: '#FF6B00',
			icon: 'Phone'
		}
	);

	function handleChannelUpdate(index: number, updatedChannel: any) {
		const iconComponent = updatedChannel.icon;
		channels[index] = {
			...updatedChannel,
			icon: iconComponent,
			showIcon: updatedChannel.showIcon
		};
		channels = channels; // trigger reactivity
	}

	function handleSecondaryButtonUpdate(data: { text: string; icon: any; showIcon: boolean; buttonColor?: string; fontColor?: string; url?: string }) {
		secondaryButton = {
			...secondaryButton,
			...data
		};
	}

	function handlePrimaryButtonUpdate(data: { text: string; icon: string }) {
		primaryButton = data;
		if (closedState) {
			closedState.buttonText = data.text;
			closedState.icon = data.icon;
		}
	}

	// Add image upload handler
	async function handleImageUpload(event: Event) {
		const input = event.target as HTMLInputElement;
		if (!input.files?.length) return;

		const file = input.files[0];
		logoImageFile = file;

		try {
			// Upload file to server
			const formData = new FormData();
			formData.append('logo', file);
			formData.append('type', 'leadbox');

			const response = await fetch('/api/upload/logo', {
				method: 'POST',
				body: formData
			});

			if (!response.ok) {
				throw new Error('Upload failed');
			}

			const data = await response.json();
			if (data.url) {
				logoImage = data.url;
				toast.success('Logo uploaded successfully!');
			} else {
				toast.error('Error: Logo URL could not be generated');
			}
		} catch (err) {
			toast.error('Error uploading logo');
			console.error(err);
		}
	}

	let showEmbedDialog = $state(false);
	let copied = $state(false);

	function copyEmbedCode() {
		const embedCode = getLeadboxEmbedCode(data.leadbox?.id ?? '');
		navigator.clipboard.writeText(embedCode);
		copied = true;
		toast.success('Embed code copied to clipboard!');
		setTimeout(() => {
			copied = false;
		}, 2000);
	}

	let iconSvgs: Record<string, string> = $state({});

	onMount(async () => {
		// Load every icon the builder offers (see $lib/utils/iconOptions).
		for (const name of iconNames) {
			iconSvgs[name] = await getSvgIcon(name);
		}
	});
</script>

{#if user.company && user.company !== ''}
	<div class="flex min-h-screen flex-col gap-3 bg-gray-100 p-4">
		<div class="flex w-full items-center justify-between py-2">
			<div class="h1 text-2xl font-semibold">Leadbox</div>
			<div class="flex items-center gap-2">
				<Button
					variant="outline"
					class="gap-2 rounded-lg border border-primary bg-transparent text-primary hover:text-white"
					onclick={() => (showEmbedDialog = true)}
				>
					<CodeXml class="h-4 w-4" />
					Get Embed Code
				</Button>
				<form
					method="POST"
					action="?/saveLeadbox"
					use:enhance={() => {
						return async ({ result }) => {
							if (result.type === 'success') {
								toast.success('Leadbox saved successfully!');
							} else {
								toast.error('Error saving leadbox');
							}
						};
					}}
				>
					<input
						type="hidden"
						name="leadboxData"
						value={JSON.stringify({
							textOnly,
							iconOnly,
							leadBoxOpen,
							primaryIconOnly,
							primaryButton,
							channels,
							secondaryButton,
							logoImage,
							topBanner,
							closedState
						})}
					/>

					<!-- Move the save button inside the form -->
					<div class="flex justify-start">
						<Button type="submit" class="bg-primary px-8 text-white">Save Changes</Button>
					</div>
				</form>
			</div>
		</div>
		<div class="flex gap-5">
			<!-- Left Section -->
			<div class="h-fit w-1/2 rounded-xl bg-white p-6">
				<div class="rounded-xl bg-white">
					<div class="mb-8 w-full">
						<h2 class="mb-2 flex items-center gap-2 text-xl font-semibold text-primary">
							Channels
							{#if channels.length < 4 && !textOnly}
								<Button variant="ghost" class="p-0 hover:bg-transparent">
									<PlusCircle class="h-6 w-6" />
								</Button>
							{/if}
						</h2>
						<p class="mb-4 text-sm text-gray-500">you can select up to 4 channels</p>

						<div class="mb-4 flex items-center gap-4">
							<span class="text-gray-700">Leadbox mode:</span>
							<span class="text-primary">Text Only</span>
							<Switch checked={!textOnly} onCheckedChange={(v) => (textOnly = !v)} />
							<span>Channels</span>
						</div>

						{#if !textOnly}
							<div class="flex flex-col gap-10">
								{#each channels as channel, i}
									<div class="flex items-center justify-between">
										<div class="flex items-center gap-7">
											<div
												class="flex h-9 w-9 items-center justify-center rounded-full bg-dialog font-medium text-black"
											>
												{i + 1}
											</div>
											<span>{channel.name}</span>
											<div class="rounded-lg bg-[#D9D9D9] px-4 py-1">{channel.value}</div>
										</div>
										<EditChannelDialog
											{channel}
											onSave={(updatedChannel) => handleChannelUpdate(i, updatedChannel)}
										>
											<Button variant="ghost" class="p-0 hover:bg-transparent">
												<Pen class="h-6 w-6" />
											</Button>
										</EditChannelDialog>
									</div>
								{/each}
							</div>
						{/if}
					</div>

					<div class="mb-8 w-full">
						<h2 class="mb-2 text-xl font-semibold text-primary">Buttons</h2>
						<p class="mb-4 text-sm text-gray-500">
							Customize the look and content in the contact buttons below the Leadbox
						</p>

						<div class="mb-4 flex w-full items-center justify-between gap-4">
							<div class="flex items-center gap-2">
								<span class="text-gray-700">Primary button:</span>
								<span>With text</span>
								<Switch checked={primaryIconOnly} onCheckedChange={(v) => (primaryIconOnly = v)} />
								<span class="text-primary">Icon only</span>
							</div>
							<EditPrimaryButtonDialog
								buttonText={primaryButton.text}
								selectedIcon={primaryButton.icon}
								onSave={handlePrimaryButtonUpdate}
							>
								<Button variant="ghost" class="p-0 hover:bg-transparent">
									<Pen class="h-6 w-6" />
								</Button>
							</EditPrimaryButtonDialog>
						</div>

						<div class="flex w-full items-center justify-between gap-4">
							<span class="text-gray-700">Secondary button</span>
							<EditSecondaryButtonDialog
								buttonText={secondaryButton.text}
								showIcon={secondaryButton.showIcon}
								selectedIcon={secondaryButton.icon}
								buttonColor={secondaryButton.buttonColor || '#FF6B00'}
								fontColor={secondaryButton.fontColor || '#ffffff'}
								url={secondaryButton.url || ''}
								onSave={handleSecondaryButtonUpdate}
							>
								<Button variant="ghost" class="p-0 hover:bg-transparent">
									<Pen class="h-6 w-6" />
								</Button>
							</EditSecondaryButtonDialog>
						</div>
					</div>

					<div class="mb-8 w-full">
						<h2 class="mb-2 text-xl font-semibold text-primary">Logo</h2>
						<p class="mb-4 text-sm text-gray-500">Upload your company logo</p>

						<div class="flex items-center gap-4">
							<img
								src={logoImage}
								alt="Company Logo"
								class="h-[82px] w-[164px] rounded border object-contain p-2"
							/>
							<label class="cursor-pointer">
								<input
									type="file"
									accept="image/*"
									class="hidden"
									onclick={(e) => e.stopPropagation()}
									onchange={handleImageUpload}
								/>
								<Button
									variant="outline"
									class="gap-2"
									onclick={(e) => {
										e.preventDefault();
										e.currentTarget.previousElementSibling?.click();
									}}
								>
									<Edit class="h-4 w-4" />
									Change Logo
								</Button>
							</label>
						</div>
					</div>

					<div class="mb-8 w-full">
						<h2 class="mb-2 text-xl font-semibold text-primary">Top Banner</h2>
						<p class="mb-4 text-sm text-gray-500">Customize the top banner of your leadbox</p>
						<div class="flex flex-col gap-4">
							<div class="flex flex-col gap-2">
								<label class="text-sm font-medium text-gray-700" for="banner-text">Text</label>
								<input
									id="banner-text"
									type="text"
									bind:value={topBanner.text}
									class="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
								/>
							</div>
							<div class="flex gap-4">
								<div class="flex flex-1 flex-col gap-2">
									<label class="text-sm font-medium text-gray-700" for="bg-color">Background Color</label>
									<div class="flex items-center gap-2">
										<input
											id="bg-color"
											type="color"
											bind:value={topBanner.backgroundColor}
											class="h-10 w-10 cursor-pointer rounded border border-gray-300 p-1"
										/>
										<input
											type="text"
											bind:value={topBanner.backgroundColor}
											class="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm uppercase focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
										/>
									</div>
								</div>
								<div class="flex flex-1 flex-col gap-2">
									<label class="text-sm font-medium text-gray-700" for="font-color">Font Color</label>
									<div class="flex items-center gap-2">
										<input
											id="font-color"
											type="color"
											bind:value={topBanner.fontColor}
											class="h-10 w-10 cursor-pointer rounded border border-gray-300 p-1"
										/>
										<input
											type="text"
											bind:value={topBanner.fontColor}
											class="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm uppercase focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
										/>
									</div>
								</div>
							</div>
							<div class="flex flex-col gap-2">
								<label class="text-sm font-medium text-gray-700" for="font-family">Font Style</label>
								<select
									id="font-family"
									bind:value={topBanner.fontFamily}
									class="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
								>
									<option value="sans-serif">Sans Serif</option>
									<option value="serif">Serif</option>
									<option value="monospace">Monospace</option>
									<option value="system-ui">System Default</option>
									<option value="Arial">Arial</option>
									<option value="Helvetica">Helvetica</option>
									<option value="Times New Roman">Times New Roman</option>
									<option value="Courier New">Courier New</option>
								</select>
							</div>
						</div>
					</div>

					<div class="mb-8 w-full">
						<h2 class="mb-2 text-xl font-semibold text-primary">Floating Widget (Closed)</h2>
						<p class="mb-4 text-sm text-gray-500">Customize the closed state floating button</p>
						<div class="flex flex-col gap-4">
							<div class="flex flex-col gap-2">
								<label class="text-sm font-medium text-gray-700" for="closed-banner-text">Top Banner Text</label>
								<input
									id="closed-banner-text"
									type="text"
									bind:value={closedState.bannerText}
									class="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
								/>
							</div>
							<div class="flex gap-4">
								<div class="flex flex-1 flex-col gap-2">
									<label class="text-sm font-medium text-gray-700" for="closed-banner-bg">Banner Background</label>
									<div class="flex items-center gap-2">
										<input id="closed-banner-bg" type="color" bind:value={closedState.bannerBgColor} class="h-10 w-10 cursor-pointer rounded border border-gray-300 p-1" />
										<input type="text" bind:value={closedState.bannerBgColor} class="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm uppercase focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary" />
									</div>
								</div>
								<div class="flex flex-1 flex-col gap-2">
									<label class="text-sm font-medium text-gray-700" for="closed-banner-font">Banner Font Color</label>
									<div class="flex items-center gap-2">
										<input id="closed-banner-font" type="color" bind:value={closedState.bannerFontColor} class="h-10 w-10 cursor-pointer rounded border border-gray-300 p-1" />
										<input type="text" bind:value={closedState.bannerFontColor} class="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm uppercase focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary" />
									</div>
								</div>
							</div>

							<div class="my-2 h-px w-full bg-gray-200"></div>

							<div class="flex flex-col gap-2">
								<label class="text-sm font-medium text-gray-700" for="closed-button-text">Button Text</label>
								<input
									id="closed-button-text"
									type="text"
									bind:value={closedState.buttonText}
									oninput={() => {
										primaryButton.text = closedState.buttonText;
									}}
									class="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
								/>
							</div>
							<div class="flex gap-4">
								<div class="flex flex-1 flex-col gap-2">
									<label class="text-sm font-medium text-gray-700" for="closed-button-bg">Button Background</label>
									<div class="flex items-center gap-2">
										<input id="closed-button-bg" type="color" bind:value={closedState.buttonBgColor} class="h-10 w-10 cursor-pointer rounded border border-gray-300 p-1" />
										<input type="text" bind:value={closedState.buttonBgColor} class="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm uppercase focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary" />
									</div>
								</div>
								<div class="flex flex-1 flex-col gap-2">
									<label class="text-sm font-medium text-gray-700" for="closed-button-font">Button Font Color</label>
									<div class="flex items-center gap-2">
										<input id="closed-button-font" type="color" bind:value={closedState.buttonFontColor} class="h-10 w-10 cursor-pointer rounded border border-gray-300 p-1" />
										<input type="text" bind:value={closedState.buttonFontColor} class="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm uppercase focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary" />
									</div>
								</div>
							</div>

							<div class="flex gap-4">
								<div class="flex flex-1 flex-col gap-2">
									<label class="text-sm font-medium text-gray-700" for="closed-icon-color">Icon Color</label>
									<div class="flex items-center gap-2">
										<input id="closed-icon-color" type="color" bind:value={closedState.iconColor} class="h-10 w-10 cursor-pointer rounded border border-gray-300 p-1" />
										<input type="text" bind:value={closedState.iconColor} class="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm uppercase focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary" />
									</div>
								</div>
								<div class="flex flex-1 flex-col gap-2">
									<label class="text-sm font-medium text-gray-700" for="closed-icon-type">Icon Style</label>
									<select
										id="closed-icon-type"
										bind:value={closedState.icon}
										onchange={() => {
											primaryButton.icon = closedState.icon;
										}}
										class="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary h-10"
									>
										{#each iconOptions as { icon, name }}
											<option value={icon}>{name}</option>
										{/each}
									</select>
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>

			<!-- Right Section - Preview -->
			<div class="relative min-h-[600px] w-1/2 rounded-xl bg-white p-6">
				<h2 class="mb-6 text-xl font-semibold">Leadbox Preview</h2>

				<div class="absolute bottom-4 right-4 origin-bottom-right" style="transform: scale(0.65);">
					{#if leadBoxOpen}
						<div
							class="relative mx-auto w-[517px] overflow-hidden border border-gray-200 bg-dialog"
						>
							<div
								class="h-28 items-center p-4"
								style="background-color: {topBanner.backgroundColor}; color: {topBanner.fontColor}; font-family: {topBanner.fontFamily};"
							>
								<p class="text-lg">{topBanner.text}</p>
							</div>

							<div class="relative flex flex-col gap-6 p-6">
								<div class="relative mb-4 flex justify-center">
									<img
										src={logoImage}
										alt="Company Logo"
										class="absolute top-[-40px] z-10 h-[82px] w-[164px] object-contain"
									/>
								</div>

								<div class="mt-12 space-y-3 bg-white px-5 pb-20 pt-4">
									{#if !textOnly}
										{#each channels as channel}
											<Button
												variant="custom"
												class="w-full rounded-full py-4 text-white hover:bg-{channel.buttonColor}/90"
												style={`background-color: ${channel.buttonColor};`}
											>
												{#if channel.showIcon}
													{@html iconSvgs[channel.icon] || ''}
												{/if}
												{#if !iconOnly}
													{channel.value}
												{/if}
											</Button>
										{/each}
									{/if}
									{#if textOnly}
										<div class="flex flex-col gap-2">
											<label class="text-gray-700" for="name">Name</label>
											<input
												type="text"
												class="rounded-none border border-y-0 border-b border-l-0 border-r-0 border-gray-200 border-b-black bg-transparent p-2 focus:outline-none focus:ring-0"
												name="name"
											/>
										</div>
										<div class="flex flex-col gap-2">
											<label class="text-gray-700" for="mobile">Mobile Number</label>
											<input
												type="text"
												class="rounded-none border border-y-0 border-b border-l-0 border-r-0 border-gray-200 border-b-black bg-transparent p-2 focus:outline-none focus:ring-0"
												name="mobile"
											/>
										</div>
										<div class="flex flex-col gap-2">
											<label class="text-gray-700" for="message">Message</label>
											<textarea
												class="rounded-none border border-y-0 border-b border-l-0 border-r-0 border-gray-200 border-b-black bg-transparent p-2 focus:outline-none focus:ring-0"
												name="message"
											></textarea>
										</div>
									{/if}
								</div>

								<div class="text-center text-xs text-gray-500">
									Use subject to terms • Lead&Terms
								</div>
							</div>
						</div>

						<!-- secondary button -->
						<div class="mt-4 flex justify-end">
							<Button
								variant="custom"
								class="flex h-14 items-center justify-between gap-4 rounded-full border-none px-8 text-lg font-extrabold uppercase tracking-wide text-white shadow-lg hover:opacity-95"
								style="background-color: {secondaryButton.buttonColor || '#FF6B00'}; color: {secondaryButton.fontColor || '#ffffff'}; border: none;"
							>
								<span>{secondaryButton.text}</span>
								{#if secondaryButton.showIcon}
									<div class="flex h-9 w-9 flex-shrink-0 items-center justify-center">
										<div class="flex translate-x-[1px] items-center justify-center [&>svg]:!h-7 [&>svg]:!w-7 [&>svg:not([stroke='none'])]:!stroke-current">
											{@html iconSvgs[secondaryButton.icon] || iconSvgs['Play'] || ''}
										</div>
									</div>
								{/if}
							</Button>
						</div>
					{/if}

					<div class="mt-4 flex flex-col items-end gap-4">
						{#if !leadBoxOpen && secondaryButton && secondaryButton.text}
							<!-- Secondary Button when Closed -->
							<Button
								variant="custom"
								class="flex h-14 items-center justify-between gap-4 rounded-full border-none px-8 text-lg font-extrabold uppercase tracking-wide text-white shadow-lg hover:opacity-95"
								style="background-color: {secondaryButton.buttonColor || '#FF6B00'}; color: {secondaryButton.fontColor || '#ffffff'}; border: none;"
							>
								<span>{secondaryButton.text}</span>
								{#if secondaryButton.showIcon}
									<div class="flex h-9 w-9 flex-shrink-0 items-center justify-center">
										<div class="flex translate-x-[1px] items-center justify-center [&>svg]:!h-7 [&>svg]:!w-7 [&>svg:not([stroke='none'])]:!stroke-current">
											{@html iconSvgs[secondaryButton.icon] || iconSvgs['Play'] || ''}
										</div>
									</div>
								{/if}
							</Button>
						{/if}

						{#if primaryIconOnly}
							<Button
								variant="custom"
								class="flex h-14 w-14 items-center justify-center rounded-full p-2 [&>svg]:!h-6 [&>svg]:!w-6 [&>svg:not([stroke='none'])]:!stroke-current"
								style="background-color: {closedState.buttonBgColor}; color: {closedState.iconColor}; border: 2px solid {closedState.iconColor};"
								onclick={() => (leadBoxOpen = !leadBoxOpen)}
							>
								{@html iconSvgs[closedState.icon] || iconSvgs['Phone'] || ''}
							</Button>
						{:else}
							<!-- The orange is ONE continuous shape: this wrapper carries the banner
							     colour, and the pill is a child sitting flush in its bottom. Its
							     rounded-b radius equals the pill's (38px = half of h-76), so the pill
							     covers the wrapper's bottom exactly and the only orange left showing is
							     the top band plus the pill's corner notches. Drawing the banner as a
							     separate strip above the pill cannot work - any width mismatch leaves its
							     square bottom corners stranded on white. min-w-max keeps long labels from
							     clipping, since neither child has an intrinsic width. -->
							<div
								class="flex w-fit min-w-max flex-col items-center overflow-hidden rounded-t-[36px] rounded-b-[38px]"
								style="background-color: {closedState.bannerBgColor || '#FF6B00'}; filter: drop-shadow(0 10px 20px rgba(0,0,0,0.12));"
							>
								<p class="m-0 w-full whitespace-nowrap px-8 pb-4 pt-3 text-center text-[14px] font-extrabold uppercase tracking-wide" style="color: {closedState.bannerFontColor || '#ffffff'};">
									{closedState.bannerText || 'QUESTIONS? JUST ASK!'}
								</p>

								<!-- Pill Button -->
								<Button
									variant="custom"
									class="flex h-[76px] w-full items-center justify-between gap-6 rounded-full pl-8 pr-1 hover:opacity-95"
									style="border: none; background-color: {closedState.buttonBgColor || '#ffffff'};"
									onclick={() => (leadBoxOpen = !leadBoxOpen)}
								>
									<span class="whitespace-nowrap text-[24px] font-extrabold tracking-[0.18em]" style="color: {closedState.buttonFontColor || '#222222'};">
										{closedState.buttonText || 'TEXT US'}
									</span>
									<div
										class="flex h-[68px] w-[68px] flex-shrink-0 items-center justify-center rounded-full [&>svg]:!h-8 [&>svg]:!w-8 [&>svg:not([stroke='none'])]:!stroke-current"
										style="background-color: {closedState.buttonBgColor || '#ffffff'}; border: 2.5px solid {closedState.iconColor || '#FF6B00'}; color: {closedState.iconColor || '#FF6B00'};"
									>
										{@html iconSvgs[closedState.icon] || iconSvgs['Phone'] || ''}
									</div>
								</Button>
							</div>
						{/if}
					</div>
				</div>
			</div>
		</div>
	</div>
{:else}
	<div class="flex h-[90vh] flex-col items-center justify-center gap-3 bg-gray-100 p-4">
		<div class="h1 text-2xl font-semibold">Leadbox</div>
		<p class="mb-4 text-sm text-gray-500">You need to create a company first</p>
		<Button href="/create-company" variant="custom" class="bg-primary px-8 text-white">
			Create Company
		</Button>
	</div>
{/if}

<Dialog.Root bind:open={showEmbedDialog}>
	<Dialog.Content class="sm:max-w-[70rem]">
		<Dialog.Header>
			<Dialog.Title>Embed Code</Dialog.Title>
			<Dialog.Description>
				Copy this code and paste it into your website where you want the leadbox to appear.
			</Dialog.Description>
		</Dialog.Header>

		<div class="relative mt-4">
			<pre class="overflow-x-auto rounded-lg bg-gray-50 p-4 text-sm">
        {#if data.leadbox?.id}
					{getLeadboxEmbedCode(data.leadbox?.id ?? '')}
				{:else}
					<p class="text-xl text-red-500">You need to save a leadbox first to get an embed code</p>
				{/if}
      </pre>

			<Button variant="outline" size="icon" class="absolute right-2 top-2" onclick={copyEmbedCode}>
				{#if copied}
					<Check class="h-4 w-4" />
				{:else}
					<Copy class="h-4 w-4" />
				{/if}
			</Button>
		</div>

		<Dialog.Footer>
			<Dialog.Close>
				<Button variant="outline">Close</Button>
			</Dialog.Close>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
