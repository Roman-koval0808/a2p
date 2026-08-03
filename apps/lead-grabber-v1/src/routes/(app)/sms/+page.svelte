<script lang="ts">
	import { MessageCircle, Send, Search, Clock, Trash2, ArrowUpRight, ArrowDownLeft } from 'lucide-svelte';
	import { toast } from 'svelte-sonner';
	import { page } from '$app/state';
	import { goto, invalidateAll } from '$app/navigation';
	import { normalizePhoneNumber } from '$lib/utils/phone';
	import { filterContacts } from '$lib/utils/contacts-filter';

	let { data } = $props();

	let activeTab = $state('SMS');
	let searchQuery = $state('');
	let recipient = $state('');
	let messageBody = $state('');
	let isSending = $state(false);

	const phoneNumbers = $derived(data.phoneNumbers || []);
	let selectedFromNumber = $state('');
	let contextMenuOpen = $state(false);
	let contextMenuX = $state(0);
	let contextMenuY = $state(0);
	let recipientElement: HTMLInputElement | null = $state(null);

	const contacts = $derived(data.contacts);

	function getDisplayName(m: any) {
		const contactNumber = m.direction === 'inbound' ? m.source : m.destination;
		if (!contactNumber) return m.customer?.name || 'Unknown';
		
		const normNum = normalizePhoneNumber(contactNumber);
		const profileMatch = contacts.find((c: any) => c.phone && normalizePhoneNumber(c.phone) === normNum);
		
		if (profileMatch?.name && profileMatch.name !== 'Anonymous Lead' && profileMatch.name !== 'Anonymous' && !profileMatch.name.startsWith('Caller (')) {
			return profileMatch.name;
		}
		
		if (m.customer?.name && m.customer.name !== 'Anonymous' && m.customer.name !== contactNumber) {
			return m.customer.name;
		}
		
		return contactNumber;
	}

	// Set initial selected number when phoneNumbers are loaded
	$effect(() => {
		if (phoneNumbers.length > 0 && !selectedFromNumber) {
			selectedFromNumber = phoneNumbers[0].phoneNumber;
		}
	});

	// Prefill recipient from URL params (?phone=)
	$effect(() => {
		const phoneParam = page.url.searchParams.get('phone');
		if (phoneParam) {
			recipient = phoneParam;
		}
	});

	const messages = $derived(data.messages || []);

	const filteredMessages = $derived(
		messages.filter((m: any) => {
			if (!searchQuery) return true;
			const query = searchQuery.toLowerCase();
			const source = (m.source || '').toLowerCase();
			const destination = (m.destination || '').toLowerCase();
			const name = getDisplayName(m).toLowerCase();
			return source.includes(query) || destination.includes(query) || name.includes(query);
		})
	);

	const filteredContacts = $derived(filterContacts(contacts, searchQuery));

	// SMS segment count (160 chars per segment for GSM-7)
	const messageLength = $derived(messageBody.length);
	const segments = $derived(Math.max(1, Math.ceil(messageLength / 160)));
	const charRemaining = $derived(160 - (messageLength % 160 || 160));

	function handleContactClick(contact: any) {
		if (contact.phone) {
			recipient = normalizePhoneNumber(contact.phone);
			recipientElement?.focus();
		}
	}

	function handleMessageClick(m: any) {
		const contactNumber = m.direction === 'inbound' ? m.source : m.destination;
		if (contactNumber) {
			recipient = normalizePhoneNumber(contactNumber);
		}
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
		const phoneParam = recipient ? `?phone=${encodeURIComponent(recipient)}` : '';
		goto(`/profiles/create${phoneParam}`);
	}

	function handleAddToExistingContact() {
		closeContextMenu();
		// TODO: Implement add to existing contact
		console.log('Add to existing contact:', recipient);
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

	async function sendSms() {
		if (!recipient || recipient.length < 10) {
			toast.error('Please enter a valid phone number');
			return;
		}
		if (!messageBody.trim()) {
			toast.error('Please enter a message');
			return;
		}

		isSending = true;
		try {
			const res = await fetch('/api/sms/send', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					recipients: [recipient],
					message: messageBody,
					fromNumber: selectedFromNumber
				})
			});
			const result = await res.json();

			if (result.success) {
				toast.success(`SMS sent to ${normalizePhoneNumber(recipient)}`);
				messageBody = '';
				await invalidateAll();
			} else {
				toast.error(result.error || 'Failed to send SMS');
			}
		} catch (err) {
			console.error('Send SMS error:', err);
			toast.error('Error sending SMS');
		} finally {
			isSending = false;
		}
	}

	async function handleDeleteLog(id: string) {
		if (!confirm('Are you sure you want to delete this log entry?')) return;

		const formData = new FormData();
		formData.append('id', id);

		try {
			const res = await fetch('?/deleteLog', {
				method: 'POST',
				body: formData
			});

			if (res.ok) {
				toast.success('Log entry deleted');
				await invalidateAll();
			} else {
				toast.error('Failed to delete log entry');
			}
		} catch (err) {
			console.error('Delete error:', err);
			toast.error('Error deleting log entry');
		}
	}
</script>

<div class="min-h-screen bg-[#ECEEF3] p-0">
	<div class="p-4">
		<!-- SMS Drafter Title Header -->
		<div class="mb-4 rounded-sm bg-white px-4 py-3">
			<h1 class="font-sans text-lg font-semibold leading-[1.29] text-[#747474]">SMS Drafter</h1>
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
			</div>

			<!-- Navigation Tabs -->
			<div class="flex h-12 w-1/2 items-center gap-6 rounded bg-white px-6">
				<button
					class="flex items-center gap-1.5 font-sans text-sm leading-[1.29] tracking-normal transition-all pb-1 border-b-2 {activeTab === 'SMS' ? 'font-bold text-[#577AB7] border-[#577AB7]' : 'font-medium text-[#747474] border-transparent hover:text-[#565656]'}"
					onclick={() => (activeTab = 'SMS')}
				>
					<MessageCircle class="h-4 w-4 {activeTab === 'SMS' ? 'text-[#577AB7]' : 'text-[#999999]'}" />
					SMS
				</button>
				<button
					class="flex items-center gap-1.5 font-sans text-sm leading-[1.29] tracking-normal transition-all pb-1 border-b-2 {activeTab === 'History' ? 'font-bold text-[#577AB7] border-[#577AB7]' : 'font-medium text-[#747474] border-transparent hover:text-[#565656]'}"
					onclick={() => (activeTab = 'History')}
				>
					<Clock class="h-4 w-4 {activeTab === 'History' ? 'text-[#577AB7]' : 'text-[#999999]'}" />
					History
				</button>
			</div>
		</div>

		<!-- Main Content Row -->
		<div class="flex w-full items-start justify-between gap-4">
			<!-- Left Panel: Contacts or Message History -->
			<div class="h-[504px] w-1/2 rounded-lg bg-white p-4 flex flex-col">
				{#if activeTab === 'SMS'}
					<!-- Headers -->
					<div class="mb-3 flex font-sans text-sm leading-[1.29] tracking-normal">
						<div class="w-[180px] font-medium text-[#565656]">Name</div>
						<div class="flex-1 font-medium text-[#565656]">Phone</div>
					</div>

					<!-- Contacts List -->
					<div class="flex-1 space-y-2 overflow-y-auto">
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
								<div class="w-[180px] font-sans text-sm leading-[1.29] tracking-normal text-[rgba(86,86,86,0.78)] truncate pr-2">
									{c.name}
								</div>
								<div class="flex-1 font-sans text-sm leading-[1.29] tracking-normal text-[rgba(86,86,86,0.78)]">
									{c.phone}
								</div>
							</div>
						{/each}
						{#if filteredContacts.length === 0}
							<div class="text-center py-8 text-gray-400 text-sm font-sans">No contacts found.</div>
						{/if}
					</div>
				{:else if activeTab === 'History'}
					<!-- Message History List -->
					<div class="mb-3 flex font-sans text-xs uppercase tracking-wider text-gray-500 font-semibold px-2">
						<div class="w-[180px]">Contact</div>
						<div class="flex-1">Message</div>
						<div class="w-[120px]">Date/Time</div>
						<div class="w-[60px] text-right">Actions</div>
					</div>

					<div class="flex-1 space-y-2 overflow-y-auto pr-1">
						{#each filteredMessages as m}
							{@const contactNumber = m.direction === 'inbound' ? m.source : m.destination}
							{@const displayName = getDisplayName(m)}
							<div
								class="flex items-center border-l-[3px] {m.direction === 'inbound' ? 'border-l-teal-500' : 'border-l-indigo-500'} bg-[#FAFAFA] py-2.5 pl-4 pr-3 rounded-r-md transition-all hover:bg-[#F3F4F6] group cursor-pointer"
								onclick={() => handleMessageClick(m)}
								onkeydown={(e) => {
									if (e.key === 'Enter' || e.key === ' ') {
										e.preventDefault();
										handleMessageClick(m);
									}
								}}
								role="button"
								tabindex="0"
							>
								<!-- Contact (Name/Number & Direction) -->
								<div class="w-[180px] font-sans text-sm leading-[1.29] tracking-normal text-gray-700 truncate pr-2">
									<div class="font-semibold flex items-center gap-1.5 truncate">
										{#if m.direction === 'inbound'}
											<ArrowDownLeft class="h-3.5 w-3.5 text-teal-600" />
										{:else}
											<ArrowUpRight class="h-3.5 w-3.5 text-indigo-600" />
										{/if}
										<span class="truncate">{displayName}</span>
									</div>
									<div class="text-[11px] text-gray-400 mt-0.5 truncate pl-5">
										{contactNumber}
									</div>
								</div>

								<!-- Message Preview -->
								<div class="flex-1 font-sans text-sm text-gray-600 truncate pr-2">
									{(m.content || m.summary || '')}
								</div>

								<!-- Date/Time -->
								<div class="w-[120px] font-sans text-xs text-gray-400">
									{new Date(m.created).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}
								</div>

								<!-- Reply & Delete Buttons -->
								<div class="w-[60px] flex items-center justify-end gap-2 opacity-80 group-hover:opacity-100 transition-opacity">
									<button
										onclick={(e) => {
											e.stopPropagation();
											handleMessageClick(m);
											activeTab = 'SMS';
										}}
										class="p-1.5 rounded-full hover:bg-green-50 text-green-600 transition-colors"
										title="Reply"
									>
										<Send class="h-4 w-4" />
									</button>
									<button
										onclick={(e) => {
											e.stopPropagation();
											handleDeleteLog(m.id);
										}}
										class="p-1.5 rounded-full hover:bg-red-50 text-red-600 transition-colors"
										title="Delete Log"
									>
										<Trash2 class="h-4 w-4" />
									</button>
								</div>
							</div>
						{/each}
						{#if filteredMessages.length === 0}
							<div class="text-center py-8 text-gray-400 text-sm font-sans">No messages found.</div>
						{/if}
					</div>
				{/if}
			</div>

			<!-- Right Panel: Compose -->
			<div class="h-[504px] w-1/2 rounded-lg bg-white p-6 flex flex-col">
				<!-- Outbound Sender ID Selector -->
				<div class="mb-4 flex items-center justify-center gap-2">
					<span class="text-xs text-gray-500 font-sans">Send From:</span>
					<select
						bind:value={selectedFromNumber}
						class="rounded border border-[#BEBEBE] bg-white px-2 py-1 text-xs font-sans text-gray-700 outline-none"
					>
						{#each phoneNumbers as num}
							<option value={num.phoneNumber}>{num.phoneNumber} {num.connectionLabel ? `(${num.connectionLabel})` : ''}</option>
						{/each}
					</select>
				</div>

				<!-- Recipient Input -->
				<div class="mb-4 text-center">
					<input
						bind:this={recipientElement}
						type="text"
						bind:value={recipient}
						placeholder="Enter a name or number"
						oncontextmenu={handleContextMenu}
						class="w-full border-0 border-b border-[#BEBEBE] bg-transparent pb-2 text-center font-sans text-2xl font-bold leading-[1.29] tracking-normal text-[rgba(86,86,86,0.78)] outline-none placeholder:text-[rgba(86,86,86,0.78)]"
					/>
				</div>

				<!-- Message Body -->
				<div class="mb-3 flex-1 flex flex-col rounded border border-[#BEBEBE] bg-[#FAFAFA] p-3">
					<textarea
						bind:value={messageBody}
						placeholder="Type your message..."
						class="flex-1 w-full resize-none border-0 bg-transparent font-sans text-sm leading-[1.29] text-[rgba(86,86,86,0.78)] outline-none placeholder:text-[rgba(86,86,86,0.78)]"
					></textarea>
					<div class="mt-2 flex items-center justify-between border-t border-[#E5E5E5] pt-2 text-xs text-gray-400 font-sans">
						<span>{messageLength} / 160 chars · {segments} segment{segments > 1 ? 's' : ''}</span>
						<span class="text-[#577AB7]">{messageLength > 160 ? `${charRemaining} over last segment` : `${charRemaining} left`}</span>
					</div>
				</div>

				<!-- Send Button -->
				<button
					onclick={sendSms}
					disabled={isSending || !messageBody.trim()}
					class="mx-auto flex h-14 w-full items-center justify-center gap-2 rounded-full bg-[#24A103] transition hover:bg-[#1f8a02] disabled:opacity-40 disabled:cursor-not-allowed text-white font-sans font-semibold text-lg shadow-lg"
					type="button"
				>
					{#if isSending}
						<span class="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent"></span>
						Sending...
					{:else}
						<Send class="h-5 w-5" />
						Send SMS
					{/if}
				</button>
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
