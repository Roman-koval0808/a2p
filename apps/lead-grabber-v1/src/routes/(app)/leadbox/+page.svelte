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
			text: 'Call us now!',
			icon: 'MessageSquare',
			showIcon: true
		}
	);

	let primaryButton = $state(
		data.leadbox?.leadbox_data?.primaryButton ?? {
			text: 'TEXT US',
			icon: 'MessageSquare'
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

	function handleSecondaryButtonUpdate(data: { text: string; icon: any; showIcon: boolean }) {
		secondaryButton = data;
	}

	function handlePrimaryButtonUpdate(data: { text: string; icon: string }) {
		primaryButton = data;
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

	let iconSvgs = $state({});

	onMount(async () => {
		// Load all needed SVG icons
		const iconNames = [
			'MessageSquare',
			'Phone',
			'Play',
			'Mail',
			'Map',
			'Target',
			'Clock',
			'CreditCard',
			'Search'
		];
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
							logoImage
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
							<div class="h-28 items-center bg-[#3B5BDB] p-4 text-white">
								<p class="text-lg">Text with us.</p>
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
						<div class="mt-4 flex justify-end gap-2">
							<Button
								variant="custom"
								class="flex items-center gap-2 rounded-md bg-[#3B5BDB] px-6 text-white"
							>
								{secondaryButton.text}
								{#if secondaryButton.showIcon}
									{@html iconSvgs[secondaryButton.icon] || ''}
								{/if}
							</Button>
						</div>
					{/if}

					<div class="mt-7 flex justify-end gap-2">
						{#if primaryIconOnly}
							<Button
								variant="custom"
								class="flex h-14 w-14 items-center gap-2 rounded-full bg-[#3B5BDB] p-2 text-white"
								onclick={() => (leadBoxOpen = !leadBoxOpen)}
							>
								{@html iconSvgs[primaryButton.icon] || iconSvgs['MessageSquare'] || ''}
							</Button>
						{:else}
							<div class="relative flex flex-col items-center">
								<div
									class="absolute top-[-22px] z-10 flex h-14 w-full justify-center rounded-3xl bg-primary"
								>
									<p class="px-4 text-sm text-white">Questions?, just ask</p>
								</div>
								<Button
									variant="custom"
									class="z-20 flex h-14 items-center justify-center gap-2 rounded-full bg-white px-20 text-lg font-medium text-primary shadow-md"
									onclick={() => (leadBoxOpen = !leadBoxOpen)}
								>
									{primaryButton.text}
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
