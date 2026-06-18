<script lang="ts">
	import { Phone, Clock, Voicemail, Search, Mic, Delete, Plus } from 'lucide-svelte';
	import { toast } from 'svelte-sonner';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { normalizePhoneNumber } from '$lib/utils/phone';
	import { filterContacts } from '$lib/utils/contacts-filter';

	let { data } = $props();

	let phoneNumber = $state('');
	let isDialing = $state(false);
	let isCallActive = $state(false);
	let callId = $state('');
	let callStatus = $state('');
	let activeTab = $state('Phone');
	let searchQuery = $state('');

	// Optional client ID for tracking purposes
	let clientId = 'test-client';

	// Read phone number from URL params
	$effect(() => {
		const phoneParam = page.url.searchParams.get('phone');
		if (phoneParam) {
			dialInput = phoneParam;
			phoneNumber = phoneParam;
		}
	});

	async function initiateCall() {
		if (!phoneNumber || phoneNumber.length < 10) {
			toast.error('Please enter a valid phone number');
			return;
		}

		isDialing = true;
		callStatus = 'Dialing...';

		try {
			const response = await fetch('/api/telnyx/dial', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					to: phoneNumber,
					clientId: clientId
				})
			});

			const result = await response.json();

			if (result.success) {
				toast.success('Call initiated');
				callId = result.callId;
				isCallActive = true;
				callStatus = 'Connected';
			} else {
				toast.error('Failed to place call: ' + result.error);
				callStatus = 'Failed';
			}
		} catch (error) {
			console.error('Call error:', error);
			toast.error('Error placing call');
			callStatus = 'Error';
		} finally {
			isDialing = false;
		}
	}

	function hangup() {
		if (!callId) return;

		callStatus = 'Hanging up...';

		fetch('/api/telnyx/hangup', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ callId })
		})
			.then((response) => response.json())
			.then((result) => {
				if (result.success) {
					toast.success('Call ended');
				} else {
					toast.error('Failed to hang up: ' + result.error);
				}
			})
			.catch((error) => {
				console.error('Hangup error:', error);
				toast.error('Error hanging up call');
			})
			.finally(() => {
				isCallActive = false;
				callId = '';
				callStatus = '';
			});
	}

	const contacts = $derived(data.contacts);

	let dialInput = $state('');

	let contextMenuOpen = $state(false);
	let contextMenuX = $state(0);
	let contextMenuY = $state(0);
	let dialInputElement: HTMLInputElement | null = $state(null);

	function appendDialInput(d: string) {
		dialInput += d;
	}

	function deleteDialInput() {
		dialInput = dialInput.slice(0, -1);
	}

	function call() {
		phoneNumber = dialInput;
		initiateCall();
	}

	function handleContextMenu(e: MouseEvent) {
		e.preventDefault();
		contextMenuX = e.clientX;
		contextMenuY = e.clientY;
		contextMenuOpen = true;
	}

	function closeContextMenu() {
		contextMenuOpen = false;
	}

	function handleCreateNewContact() {
		closeContextMenu();
		const phoneParam = dialInput ? `?phone=${encodeURIComponent(dialInput)}` : '';
		goto(`/profiles/create${phoneParam}`);
	}

	function handleAddToExistingContact() {
		closeContextMenu();
		// TODO: Implement add to existing contact
		console.log('Add to existing contact:', dialInput);
	}

	function handleContactClick(contact: any) {
		if (contact.phone) {
			dialInput = normalizePhoneNumber(contact.phone);
		}
	}

	$effect(() => {
		if (contextMenuOpen) {
			const handleClickOutside = (e: MouseEvent) => {
				if (!(e.target as HTMLElement).closest('.context-menu')) {
					closeContextMenu();
				}
			};
			document.addEventListener('click', handleClickOutside);
			return () => document.removeEventListener('click', handleClickOutside);
		}
	});

	const filteredContacts = $derived(filterContacts(contacts, searchQuery));
</script>

<div class="min-h-screen bg-[#ECEEF3] p-0">
	<div class="p-4">
		<!-- Dialer Title Header -->
		<div class="mb-4 rounded-sm bg-white px-4 py-3">
			<h1 class="font-sans text-lg font-semibold leading-[1.29] text-[#747474]">Dialer</h1>
		</div>

		<!-- Top Row: Search + Tabs -->
		<div class="mb-4 flex w-full items-center justify-between gap-4">
			<!-- Search Bar -->
			<div class="flex h-12 w-1/2 items-center gap-2 rounded bg-white px-3">
				<Search class="h-5 w-5 text-[#577AB7]" />
				<input
					type="text"
					bind:value={searchQuery}
					placeholder="Search"
					class="flex-1 border-0 bg-transparent font-sans text-sm leading-[1.29] text-[rgba(120,120,120,0.54)] outline-none placeholder:text-[rgba(120,120,120,0.54)]"
				/>
				<Mic class="h-5 w-5 text-[#577AB7]" />
			</div>

			<!-- Navigation Tabs -->
			<div class="flex h-12 w-1/2 items-center gap-6 rounded bg-white px-6">
				<button
					class="flex items-center gap-1.5 font-sans text-sm leading-[1.29] tracking-normal transition-colors {activeTab ===
					'Phone'
						? 'font-medium text-[#565656]'
						: 'font-medium text-[#565656]'}"
					onclick={() => (activeTab = 'Phone')}
				>
					<Phone class="h-4 w-4 text-[#565656]" />
					Phone
				</button>
				<button
					class="flex items-center gap-1.5 font-sans text-sm leading-[1.29] tracking-normal transition-colors {activeTab ===
					'Calls'
						? 'font-medium text-[#565656]'
						: 'font-medium text-[#565656]'}"
					onclick={() => (activeTab = 'Calls')}
				>
					<Clock class="h-4 w-4 text-[#999999]" />
					Calls
				</button>
				<button
					class="flex items-center gap-1.5 font-sans text-sm leading-[1.29] tracking-normal transition-colors {activeTab ===
					'Voicemail'
						? 'font-medium text-[#565656]'
						: 'font-medium text-[#565656]'}"
					onclick={() => (activeTab = 'Voicemail')}
				>
					<Voicemail class="h-4 w-4 text-[#999999]" />
					Voicemail
				</button>
			</div>
		</div>

		<!-- Main Content Row -->
		<div class="flex w-full items-start justify-between gap-4">
			<!-- Left Panel: Contacts List -->
			<div class="h-[504px] w-1/2 rounded-lg bg-white p-4">
				<!-- Headers -->
				<div class="mb-3 flex font-sans text-sm leading-[1.29] tracking-normal">
					<div class="w-[180px] font-medium text-[#565656]">Name</div>
					<div class="flex-1 font-medium text-[#565656]">Phone</div>
				</div>

				<!-- Contacts List -->
				<div class="h-[calc(100%-40px)] space-y-2 overflow-y-auto">
					{#each filteredContacts as c}
						<div
							class="flex cursor-pointer items-center border-l-[3px] border-l-[#BEBEBE] bg-[#FAFAFA] py-3 pl-4 pr-3 transition-colors hover:bg-[#F0F0F0]"
							onclick={() => handleContactClick(c)}
							onkeydown={(e) => {
								if (e.key === 'Enter' || e.key === ' ') {
									e.preventDefault();
									handleContactClick(c);
								}
							}}
							role="button"
							tabindex="0"
						>
							<div
								class="w-[180px] font-sans text-sm leading-[1.29] tracking-normal text-[rgba(86,86,86,0.78)]"
							>
								{c.name}
							</div>
							<div
								class="flex-1 font-sans text-sm leading-[1.29] tracking-normal text-[rgba(86,86,86,0.78)]"
							>
								{c.phone}
							</div>
						</div>
					{/each}
				</div>
			</div>

			<!-- Right Panel: Dial Pad -->
			<div class="h-[504px] w-1/2 rounded-lg bg-white p-6">
				<!-- Input Field -->
				<div class="mb-6 text-center">
					<input
						bind:this={dialInputElement}
						type="text"
						bind:value={dialInput}
						placeholder="Enter a name or number"
						oncontextmenu={handleContextMenu}
						class="w-full border-0 border-b border-[#BEBEBE] bg-transparent pb-2 text-center font-sans text-2xl font-bold leading-[1.29] tracking-normal text-[rgba(86,86,86,0.78)] outline-none placeholder:text-[rgba(86,86,86,0.78)]"
					/>
				</div>

				<!-- Number Pad Container -->
				<div class="mx-auto mb-6 w-[280px]">
					<!-- Number Pad Grid -->
					<div class="grid grid-cols-3 gap-x-4 gap-y-6">
						{#each [[1, 2, 3], [4, 5, 6], [7, 8, 9], ['*', 0, '#']] as row}
							{#each row as digit}
								<button
									class="flex h-12 w-full items-center justify-center font-sans text-xl font-medium leading-[1.29] tracking-normal text-[#565656] transition hover:bg-gray-50"
									onclick={() => appendDialInput(digit.toString())}
									type="button"
								>
									{digit}
								</button>
							{/each}
						{/each}
					</div>

					<!-- Action Buttons: Plus, Call, Delete -->
					<div class="mt-6 grid grid-cols-3 gap-x-4">
						<!-- Plus Button -->
						<button
							class="flex h-12 w-full items-center justify-center font-sans text-xl font-medium leading-[1.29] tracking-normal text-[#565656] transition hover:bg-gray-50"
							type="button"
							onclick={() => appendDialInput('+')}
						>
							+
						</button>

						<!-- Call Button -->
						<button
							class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#24A103] transition hover:bg-[#1f8a02]"
							onclick={call}
							type="button"
						>
							<Phone class="h-5 w-5 text-white" />
						</button>

						<!-- Delete Button -->
						<button
							class="flex h-12 w-full items-center justify-center font-sans text-xl font-medium leading-[1.29] tracking-normal text-[#565656] transition hover:bg-gray-50"
							onclick={deleteDialInput}
							type="button"
							title="Delete"
						>
							<Delete class="h-5 w-5" />
						</button>
					</div>
				</div>
			</div>
		</div>
	</div>

	<!-- Context Menu -->
	{#if contextMenuOpen}
		<div
			class="context-menu fixed z-50 min-w-[180px] rounded-sm bg-[#F5F5F5] py-1 shadow-lg"
			style="left: {contextMenuX}px; top: {contextMenuY}px;"
			role="menu"
		>
			<button
				class="w-full px-4 py-2 text-left font-sans text-sm leading-[1.29] text-[#565656] hover:bg-[#E8E8E8]"
				onclick={handleCreateNewContact}
				role="menuitem"
			>
				Create New Contact
			</button>
			<div class="my-1 border-t border-[#D0D0D0]"></div>
			<button
				class="w-full px-4 py-2 text-left font-sans text-sm leading-[1.29] text-[#565656] hover:bg-[#E8E8E8]"
				onclick={handleAddToExistingContact}
				role="menuitem"
			>
				Add to Existing Contact
			</button>
		</div>
	{/if}
</div>
