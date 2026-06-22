<script lang="ts">
	import HeaderClose from '$lib/components/header-close.svelte';
	import HeaderReminder from '$lib/components/header-reminder.svelte';
	import HeaderShuffle from '$lib/components/header-shuffle.svelte';
	import HeaderTag from '$lib/components/header-tag.svelte';
	import { Button } from '$lib/components/ui/button/index';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index';
	import {
		Bell,
		CheckCircle2,
		Images,
		MessageSquareText,
		Phone,
		Plus,
		Shuffle,
		Smile,
		Tag,
		UserPlus
	} from 'lucide-svelte';
	import { onMount } from 'svelte';

	import { toast } from 'svelte-sonner';
	import { goto } from '$app/navigation';
	import type { Message } from '$lib/types/message';

	let { data } = $props();
	let { user } = data;
	if (user == null) {
		goto('/login');
	}
	if (
		(user !== null && user?.company === null) ||
		(user?.company && typeof user.company === 'object' && !user.company.id)
	) {
		goto('/create-company');
	}

	// Add message data store
	let messages = $state<Message[]>([]);
	let selectedMessage = $state<{
		thread_id: string;
		[key: string]: any;
	} | null>(null);
	let showMessages = $state(true);
	let chatMessages = $state<
		{
			sender: string;
			message: string;
			phone?: string;
			email?: string;
			time: string;
			isYou: boolean;
			timestamp: string;
			type?: string;
			call_data?: { direction: string; duration: number; estimated_price?: number; summary?: string; call_control_id?: string };
		}[]
	>([]);

	// Add these state variables near the top with other state declarations
	let isLoadingMessages = $state(true);
	let isLoadingChat = $state(false);

	let draftValue = $state(`${user?.name || 'our team'} has gotten your message and he will be calling you in two minutes.`);
	let isSendingSms = $state(false);

	const hasUnansweredSms = $derived(
		selectedMessage &&
		chatMessages.length > 0 &&
		!chatMessages[chatMessages.length - 1].isYou
	);

	$effect(() => {
		if (selectedMessage) {
			const hasAgentReplies = chatMessages.some((m: any) => m.isYou);
			if (hasAgentReplies) {
				const userName = user?.name || 'our team';
				draftValue = `${userName} has gotten your message and he will be calling you in two minutes.`;
			} else if (selectedMessage.draftResponse) {
				draftValue = selectedMessage.draftResponse;
			} else {
				const userName = user?.name || 'our team';
				draftValue = `${userName} has gotten your message and he will be calling you in two minutes.`;
			}
		}
	});

	$effect(() => {
		if (chatMessages && messagesContainer) {
			setTimeout(() => {
				messagesContainer.scrollTop = messagesContainer.scrollHeight;
			}, 50);
		}
	});

	// Add this state variable with the other state declarations
	let companyMembers = $state<{ id: string; name: string }[]>([]);

	// Add a new state variable for initial load
	let initialLoad = $state(true);

	let selectedTab = $state('all');
	let filteredMessages = $state<typeof messages>([]);

	// Replace the existing filteredMessages with memoized version
	$effect(() => {
		const filterFn = (msg: any) => {
			switch (selectedTab) {
				case 'unassigned':
					return !msg.assigned_to;
				case 'me':
					return msg.assigned_to === user?.id;
				default:
					return true;
			}
		};

		const getLatestTime = (msg: any) => {
			const msgs = msg.messages;
			if (Array.isArray(msgs) && msgs.length > 0) {
				const last = msgs[msgs.length - 1];
				if (last && last.timestamp) {
					return new Date(last.timestamp).getTime();
				}
			}
			return new Date(msg.updated || msg.created).getTime();
		};

		filteredMessages = messages
			.filter(filterFn)
			.sort((a, b) => getLatestTime(b) - getLatestTime(a));
	});

	// Add pagination state
	let page = $state(1);
	const PER_PAGE = 20;
	let pollingInterval: ReturnType<typeof setInterval> | null = null;

	onMount(async () => {
		try {
			await loadMessages();
			await loadCompanyMembers();

			// Auto-select threadId from URL search params
			const urlParams = new URLSearchParams(window.location.search);
			const urlThreadId = urlParams.get('threadId');
			if (urlThreadId) {
				const foundMsg = messages.find((m) => m.thread_id === urlThreadId);
				if (foundMsg) {
					await selectMessage(foundMsg);
				} else {
					// Fetch and add to messages list if not found
					try {
						const response = await fetch(`/api/messages?threadId=${encodeURIComponent(urlThreadId)}`);
						if (response.ok) {
							const resJson = await response.json();
							if (resJson.data) {
								const formatted = formatMessage(resJson.data);
								messages = [formatted, ...messages];
								await selectMessage(formatted);
							}
						}
					} catch (err) {
						console.error('Error fetching specific thread from URL param:', err);
					}
				}
			}
		} catch (err) {
			console.error('Error in onMount:', err);
		}

		if (typeof window !== 'undefined') {
			window.addEventListener('sse-new-sms', handleRealtimeUpdate);
			window.addEventListener('sse-new-notification', handleRealtimeUpdate);
		}

		// Setup polling every 5 seconds as a fallback
		pollingInterval = setInterval(async () => {
			await loadMessages(true);
			if (selectedMessage) {
				await loadChatMessages(selectedMessage.thread_id);
			}
		}, 5000);

		return () => {
			if (typeof window !== 'undefined') {
				window.removeEventListener('sse-new-sms', handleRealtimeUpdate);
				window.removeEventListener('sse-new-notification', handleRealtimeUpdate);
			}
			if (pollingInterval) {
				clearInterval(pollingInterval);
			}
		};
	});

	async function handleRealtimeUpdate(e: Event) {
		const customEvent = e as CustomEvent;
		const detail = customEvent.detail;
		console.log('📡 Realtime update received in Inbox page:', detail);
		
		// Force refresh the messages list
		await loadMessages(true);

		// If the updated thread is currently selected, reload the chat messages
		const updatedThreadId = detail?.notification?.threadId || detail?.threadId || detail?.notification?.sourceIdentifier;
		if (selectedMessage && updatedThreadId && (selectedMessage.thread_id === updatedThreadId || updatedThreadId.includes(selectedMessage.thread_id) || selectedMessage.thread_id.includes(updatedThreadId))) {
			await loadChatMessages(selectedMessage.thread_id);
		}
	}

	// Add loadMessages function
	async function loadMessages(forceRefresh = false) {
		if (initialLoad) {
			isLoadingMessages = true;
		}

		try {
			if (!user?.company) {
				console.log('No company ID available');
				messages = [];
				isLoadingMessages = false;
				initialLoad = false;
				return;
			}

			if (forceRefresh) {
				page = 1;
			}

			const targetPage = forceRefresh ? 1 : page;
			const response = await fetch(`/api/messages?page=${targetPage}&perPage=${PER_PAGE}`);
			if (!response.ok) throw new Error('Failed to fetch messages');
			const resJson = await response.json();
			const items = resJson.data || [];

			// For initial load or forceRefresh, replace all messages. For pagination, append new ones (avoiding duplicates)
			if (initialLoad || forceRefresh) {
				messages = items.map(formatMessage);
			} else {
				// Only append messages that don't already exist
				const existingIds = new Set(messages.map((m) => m.id));
				const newMessages = items
					.filter((item: any) => !existingIds.has(item.id))
					.map(formatMessage);
				messages = [...messages, ...newMessages];
			}

			// Clean up selected message if it was deleted, or update its reference to trigger Svelte reactivity
			if (selectedMessage) {
				const updatedMsg = messages.find((m) => m.thread_id === selectedMessage.thread_id);
				if (updatedMsg) {
					selectedMessage = updatedMsg;
				} else {
					selectedMessage = null;
					chatMessages = [];
				}
			}

			// Update chat messages only if needed
			if (selectedMessage && initialLoad) {
				isLoadingChat = true;
				await loadChatMessages(selectedMessage.thread_id);
			}
		} catch (err) {
			console.error('Error loading messages:', err);
		} finally {
			isLoadingMessages = false;
			initialLoad = false;
		}
	}

	// Separate chat messages loading
	async function loadChatMessages(threadId: string) {
		try {
			const response = await fetch(`/api/messages?threadId=${encodeURIComponent(threadId)}`);
			if (!response.ok) throw new Error('Failed to fetch thread');
			const resJson = await response.json();
			const thread = resJson.data;

			if (!thread || !thread.messages || thread.messages.length === 0) {
				console.error('No messages found in thread');
				chatMessages = [];
				return;
			}

			// Parse messages if it's a string
			const messagesArray =
				typeof thread.messages === 'string'
					? JSON.parse(thread.messages)
					: Array.isArray(thread.messages)
						? thread.messages
						: [];

			chatMessages = messagesArray
				.map((msg: any) => ({
					sender: msg.is_agent_reply
						? msg.agent_name || 'Agent'
						: thread.customerName || 'Customer',
					message: msg.content,
					phone: thread.customerPhone,
					email: thread.customerEmail,
					time: new Date(msg.timestamp).toLocaleTimeString([], {
						hour: '2-digit',
						minute: '2-digit'
					}),
					isYou: msg.is_agent_reply,
					timestamp: msg.timestamp,
					type: msg.type,
					call_data: msg.call_data
				}))
				.sort(sortByTimestamp);
		} catch (err) {
			console.error('Error loading chat messages:', err);
			chatMessages = [];
		} finally {
			isLoadingChat = false;
		}
	}

	// Helper function to format message consistently
	function formatMessage(msg: any): Message & { name: string; message: string; time: string } {
		// Parse messages if it's a string
		const messagesArray =
			typeof msg.messages === 'string'
				? JSON.parse(msg.messages)
				: Array.isArray(msg.messages)
					? msg.messages
					: [];

		const lastMessage = messagesArray[messagesArray.length - 1];
		const customerName = msg.customerName || 'Unknown';
		const initials =
			customerName
				?.split(' ')
				.map((n: string) => n[0])
				.join('') || '??';
		const name = customerName;
		const messageText = lastMessage?.content || '';
		const time = new Date(lastMessage?.timestamp || msg.created).toLocaleTimeString([], {
			hour: '2-digit',
			minute: '2-digit'
		});
		const color = 'bg-primary';

		return {
			id: msg.id,
			thread_id: msg.threadId,
			customer_name: customerName,
			customer_phone: msg.customerPhone || null,
			customer_email: msg.customerEmail || null,
			company_id: msg.companyId || '',
			messages: messagesArray,
			status: msg.status || 'new',
			created: msg.created,
			updated: msg.updated || msg.created,
			assigned_to: msg.assignedToId,
			initials,
			color,
			urgency: msg.urgency,
			intent: msg.intent,
			draftResponse: msg.draftResponse,
			// Additional properties for UI display
			name,
			message: messageText,
			time
		};
	}

	// Update the sort function to use proper types (oldest first for chat timeline)
	function sortByTimestamp(a: { timestamp: string }, b: { timestamp: string }): number {
		return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
	}

	// Function to select a message and load its chat history
	async function selectMessage(msg: { thread_id: string; [key: string]: any }) {
		selectedMessage = msg;
		showMessages = true;
		isLoadingChat = true;

		try {
			await loadChatMessages(msg.thread_id);
		} catch (err) {
			console.error('Error loading chat history:', err);
			chatMessages = [];
		} finally {
			isLoadingChat = false;
		}
	}

	// Function to send a new message
	async function sendMessage(e: Event) {
		e.preventDefault(); // Prevent form submission
		const form = e.target as HTMLFormElement;
		const input = form.querySelector('input') as HTMLInputElement;
		const message = input.value.trim();

		if (!message || !selectedMessage) return;
		const targetThreadId = selectedMessage.thread_id;

		// Clear input immediately for better UX
		input.value = '';

		try {
			const threadResponse = await fetch(
				`/api/messages?threadId=${encodeURIComponent(targetThreadId)}`
			);
			if (!threadResponse.ok) throw new Error('Failed to fetch thread');
			const resJson = await threadResponse.json();
			const existingThread = resJson.data;

			if (!existingThread) {
				throw new Error('Thread not found');
			}

			// Parse existing messages
			const existingMessages =
				typeof existingThread.messages === 'string'
					? JSON.parse(existingThread.messages)
					: Array.isArray(existingThread.messages)
						? existingThread.messages
						: [];

			// First attempt to send via Telnyx if there's a phone number
			if (existingThread.customerPhone) {
				try {
					console.log('Sending SMS to:', existingThread.customerPhone);
					const telnyxResponse = await fetch('/api/telnyx', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({
							message,
							phoneNumber: existingThread.customerPhone,
							threadId: targetThreadId
						})
					});

					const telnyxResult = await telnyxResponse.json();
					if (!telnyxResult.success) {
						console.error('Failed to send SMS:', telnyxResult.error);
						toast.error('Failed to send SMS: ' + telnyxResult.error);
						return;
					}

					console.log('SMS sent successfully');
				} catch (telnyxError) {
					console.error('Error sending SMS:', telnyxError);
					toast.error('Failed to send SMS: Network error');
					return;
				}
			}

			// Update the database
			const updatedMessages = [
				...existingMessages,
				{
					content: message,
					timestamp: new Date().toISOString(),
					is_agent_reply: true,
					agent_id: user.id,
					agent_name: user.name
				}
			];

			const updateResponse = await fetch('/api/messages', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					id: existingThread.id,
					messages: updatedMessages,
					status: 'replied'
				})
			});

			if (!updateResponse.ok) throw new Error('Failed to update message');
			const updatedThread = await updateResponse.json();

			// Update the messages list with the new thread
			messages = messages.map((msg) =>
				msg.thread_id === updatedThread.threadId ? formatMessage(updatedThread) : msg
			);

			// Update chat messages only if still selected
			if (selectedMessage && selectedMessage.thread_id === targetThreadId) {
				await loadChatMessages(targetThreadId);
			}

			toast.success('Message sent successfully');
		} catch (err) {
			console.error('Error sending message:', err);
			toast.error('Failed to send message');
		}
	}

	async function sendDraftSms() {
		if (!selectedMessage) return;
		const targetThreadId = selectedMessage.thread_id;
		isSendingSms = true;
		try {
			const phone = selectedMessage.customer_phone;
			if (!phone) {
				toast.error('No phone number found for customer');
				return;
			}
			console.log('Sending draft SMS to:', phone);
			const telnyxResponse = await fetch('/api/telnyx', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					message: draftValue,
					phoneNumber: phone,
					threadId: targetThreadId
				})
			});

			const telnyxResult = await telnyxResponse.json();
			if (!telnyxResult.success) {
				toast.error('Failed to send SMS: ' + telnyxResult.error);
				return;
			}

			// Update the database locally
			const response = await fetch(
				`/api/messages?threadId=${encodeURIComponent(targetThreadId)}`
			);
			const resJson = await response.json();
			const existingThread = resJson.data;
			if (!existingThread) {
				throw new Error('Thread not found');
			}
			const existingMessages = typeof existingThread.messages === 'string'
				? JSON.parse(existingThread.messages)
				: existingThread.messages || [];

			const updatedMessages = [
				...existingMessages,
				{
					content: draftValue,
					timestamp: new Date().toISOString(),
					is_agent_reply: true,
					agent_id: user.id,
					agent_name: user.name
				}
			];

			await fetch('/api/messages', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					id: existingThread.id,
					messages: updatedMessages,
					status: 'replied'
				})
			});

			toast.success('Draft SMS sent successfully!');
			await loadMessages(true);
			
			// Only load chat messages if the thread is still selected
			if (selectedMessage && selectedMessage.thread_id === targetThreadId) {
				await loadChatMessages(targetThreadId);
			}
		} catch (err) {
			console.error('Error sending draft SMS:', err);
			toast.error('Failed to send draft SMS');
		} finally {
			isSendingSms = false;
		}
	}

	// Add this function to load company members
	async function loadCompanyMembers() {
		try {
			if (!user?.company) {
				console.log('No company ID available');
				return;
			}

			const response = await fetch('/api/company-members');
			if (!response.ok) throw new Error('Failed to fetch company members');
			const data = await response.json();
			const members = data.data || [];

			companyMembers = members.map((member: any) => ({
				id: member.user,
				name: member.expand?.user?.name || member.expand?.user?.email || 'Unknown'
			}));
		} catch (err) {
			console.error('Error loading company members:', err);
		}
	}

	// Add function to assign message
	async function assignMessage(messageId: string, userId: string) {
		try {
			const response = await fetch('/api/messages', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					id: messageId,
					assigned_to: userId,
					status: 'assigned'
				})
			});

			if (response.ok) {
				const updated = await response.json();
				// Update the specific message in place
				messages = messages.map((msg) => (msg.id === messageId ? formatMessage(updated) : msg));
				toast.success('Message assigned successfully');
			} else {
				throw new Error('Failed to assign message');
			}
		} catch (err) {
			console.error('Error assigning message:', err);
			toast.error('Failed to assign message');
		}
	}

	// Add function for quick self-assignment
	async function assignToMe(messageId: string) {
		if (!messageId) return;

		try {
			await fetch('/api/messages', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					id: messageId,
					assigned_to: user.id
				})
			});

			// Update the local messages array by modifying the specific message
			messages = messages.map((msg) =>
				msg.id === messageId ? { ...msg, assigned_to: user.id } : msg
			);

			toast.success('Message assigned to you');
		} catch (err) {
			console.error('Error assigning message:', err);
			toast.error('Failed to assign message');
		}
	}

	// Add function for assigning message to a member
	async function assignToMember(messageId: string, memberId: string) {
		if (!messageId || !memberId) return;

		try {
			const response = await fetch('/api/messages', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					id: messageId,
					assigned_to: memberId
				})
			});

			if (response.ok) {
				const updated = await response.json();
				// Update the specific message in place
				messages = messages.map((msg) => (msg.id === messageId ? formatMessage(updated) : msg));
				toast.success('Message assigned successfully');
			} else {
				throw new Error('Failed to assign message');
			}
		} catch (err) {
			console.error('Error assigning message:', err);
			toast.error('Failed to assign message');
		}
	}

	// Handle transfer (same as assign but for communication logs)
	async function handleTransferMessage(selectedAgentNames: string[]) {
		if (!selectedMessage || !companyMembers) return;

		// Map agent names back to member IDs
		const selectedMemberIds = companyMembers
			.filter((m) => selectedAgentNames.includes(m.name))
			.map((m) => m.id);

		if (selectedMemberIds.length === 0) {
			toast.error('No members selected');
			return;
		}

		try {
			// Update the message
			await fetch('/api/messages', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					id: selectedMessage.id,
					assigned_to: selectedMemberIds[0],
					status: 'assigned'
				})
			});

			// Note: Communication log updates would need a separate API endpoint
			// For now, we'll skip that part as it's not critical for basic functionality

			// Reload messages to reflect changes
			await loadMessages();
			toast.success('Message transferred successfully');
		} catch (error) {
			console.error('Error transferring message:', error);
			toast.error('Failed to transfer message');
		}
	}

	// Add infinite scroll
	let messagesContainer: HTMLElement;
	function handleScroll(e: Event) {
		const target = e.target as HTMLElement;
		if (target.scrollHeight - target.scrollTop === target.clientHeight && !isLoadingMessages) {
			page++;
			loadMessages();
		}
	}

	// Test helper: inject a fake call summary into the selected thread
	let isSimulatingCall = $state(false);
	async function simulateCallResult() {
		if (!selectedMessage) return;
		isSimulatingCall = true;
		try {
			const res = await fetch('/api/telnyx/test-call-summary', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					threadId: selectedMessage.thread_id,
					duration: 127,
					estimated_price: 100,
					summary: 'Agent said: "I will be there soon, price is $100"'
				})
			});
			if (res.ok) {
				toast.success('Call result simulated');
				await loadChatMessages(selectedMessage.thread_id);
			} else {
				toast.error('Simulation failed');
			}
		} catch (err) {
			toast.error('Simulation error');
		} finally {
			isSimulatingCall = false;
		}
	}
</script>

<div class="flex h-[90vh] flex-col gap-3 bg-gray-100 p-4">
	<div class="h1 text-2xl font-semibold">Inbox</div>

	<div class="flex h-[61px] w-full items-center justify-between rounded-lg bg-white px-8">
		<div class="flex items-center gap-14">
			<button
				class="text-xl font-normal leading-8 {selectedTab === 'all'
					? 'font-medium text-primary'
					: 'text-gray-600 hover:text-gray-900'}"
				onclick={() => (selectedTab = 'all')}
			>
				All
			</button>
			<button
				class="text-xl font-normal leading-8 {selectedTab === 'unassigned'
					? 'font-medium text-primary'
					: 'text-gray-600 hover:text-gray-900'}"
				onclick={() => (selectedTab = 'unassigned')}
			>
				Unassigned
			</button>
			<button
				class="text-xl font-normal leading-8 {selectedTab === 'me'
					? 'font-medium text-primary'
					: 'text-gray-600 hover:text-gray-900'}"
				onclick={() => (selectedTab = 'me')}
			>
				Me
			</button>
		</div>

		<div class="actions flex items-center gap-2">
			<HeaderTag />
			<HeaderShuffle {selectedMessage} {companyMembers} onTransfer={handleTransferMessage} />
			<HeaderReminder />
			<HeaderClose />
		</div>
	</div>

	<div class="flex min-h-0 flex-1 gap-5">
		<div class="flex w-1/2 flex-col rounded-xl bg-white">
			<div class="flex-1 overflow-y-auto" onscroll={handleScroll}>
				<div class="flex flex-col divide-y px-5">
					{#if initialLoad && isLoadingMessages}
						{#each Array(5) as _}
							<div class="flex items-center gap-4 py-4">
								<div class="flex-shrink-0">
									<div class="h-14 w-14 animate-pulse rounded-full bg-gray-200"></div>
								</div>
								<div class="flex-grow">
									<div class="flex items-center justify-between">
										<div class="h-4 w-24 animate-pulse rounded bg-gray-200"></div>
										<div class="h-4 w-16 animate-pulse rounded bg-gray-200"></div>
									</div>
									<div class="mt-2 h-4 w-3/4 animate-pulse rounded bg-gray-200"></div>
								</div>
							</div>
						{/each}
					{:else}
						{#each filteredMessages as msg (msg.id)}
							<div
								class="flex cursor-pointer items-center gap-4 py-4 hover:bg-gray-50"
								onclick={() => selectMessage(msg)}
							>
								<div class="flex-shrink-0">
									<div
										class="h-14 w-14 rounded-full {msg.color} flex items-center justify-center text-xl text-white"
									>
										{msg.initials}
									</div>
								</div>
								<div class="flex-grow">
									<div class="flex items-center gap-2">
										<h4 class="text-lg font-medium">{(msg as any).name}</h4>
										{#if msg.customer_phone}
											<button
												class="inline-flex items-center justify-center p-1 rounded-full bg-emerald-50 text-emerald-600 hover:bg-emerald-500 hover:text-white transition-all duration-200"
												title="Call Customer"
												onclick={(e) => {
													e.stopPropagation();
													goto(`/dialer?phone=${encodeURIComponent(msg.customer_phone)}&call=true`);
												}}
											>
												<Phone class="h-3.5 w-3.5" />
											</button>
										{/if}
										{#if msg.intent}
											{#if msg.intent === 'emergency'}
												<span class="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800 uppercase tracking-wider">Emergency</span>
											{:else if msg.intent === 'active'}
												<span class="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-800 uppercase tracking-wider">Active Project</span>
											{:else if msg.intent === 'comparison'}
												<span class="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800 uppercase tracking-wider">Comparison</span>
											{:else if msg.intent === 'research'}
												<span class="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 uppercase tracking-wider">Research</span>
											{:else}
												<span class="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-800 uppercase tracking-wider">{msg.intent}</span>
											{/if}
										{:else}
											{#if msg.urgency === 'red'}
												<span class="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">Urgent</span>
											{:else if msg.urgency === 'blue'}
												<span class="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">Medium</span>
											{:else if msg.urgency === 'yellow'}
												<span class="rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-800">Medium</span>
											{:else if msg.urgency === 'green'}
												<span class="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">Low</span>
											{:else if msg.urgency}
												<span class="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-800">{msg.urgency}</span>
											{/if}
										{/if}
									</div>
									<span class="font-medium">{(msg as any).time}</span>
								</div>
								<p class="line-clamp-2 font-light">{(msg as any).message}</p>
								{#if msg.assigned_to}
									<div class="mt-1 text-sm text-gray-500">
										Assigned to:
										<button
											class="text-blue-600 hover:text-blue-800 hover:underline"
											onclick={(e) => {
												e.stopPropagation();
												goto(`/users/${msg.assigned_to}`);
											}}
										>
											{companyMembers.find((m) => m.id === msg.assigned_to)?.name || 'Unknown'}
										</button>
									</div>
								{/if}
							</div>
						{/each}

						{#if filteredMessages.length === 0}
							<div class="py-8 text-center text-gray-500">
								{#if selectedTab === 'unassigned'}
									No unassigned messages
								{:else if selectedTab === 'me'}
									No messages assigned to you
								{:else}
									No messages found
								{/if}
							</div>
						{/if}
					{/if}
				</div>
			</div>
		</div>

		<div class="flex w-1/2 flex-col rounded-xl bg-white">
			<div class="flex-1 overflow-y-auto" bind:this={messagesContainer}>
				{#if selectedMessage && showMessages}
					{#if isLoadingChat}
						<div class="flex flex-col gap-4 p-4">
							{#each Array(3) as _}
								<div class="rounded-lg border border-dashed border-gray-200 p-4">
									<div class="mb-4 h-4 w-32 animate-pulse rounded bg-gray-200"></div>
									<div class="space-y-3">
										<div class="h-3 w-3/4 animate-pulse rounded bg-gray-200"></div>
										<div class="h-3 w-1/2 animate-pulse rounded bg-gray-200"></div>
										<div class="h-3 w-2/3 animate-pulse rounded bg-gray-200"></div>
									</div>
								</div>
							{/each}
						</div>
					{:else}
						<div class="flex-1 space-y-4 overflow-y-auto p-4">
							{#each chatMessages as message, i}
								{#if i === 0}
									<!-- Initial message with all details -->
									<div class="mb-6 rounded-lg bg-gray-50 p-4">
										<h3 class="mb-2 text-sm font-medium">Initial Message</h3>
										<div class="space-y-2 text-sm">
											<div><span class="text-gray-500">From:</span> {message.sender}</div>
											{#if message.phone}
												<div class="flex items-center gap-2">
													<span class="text-gray-500">Phone:</span>
													<span>{message.phone}</span>
													<a
														href="/dialer?phone={encodeURIComponent(message.phone)}&call=true"
														class="inline-flex items-center justify-center p-1 rounded-full bg-emerald-50 text-emerald-600 hover:bg-emerald-500 hover:text-white transition-all duration-200"
														title="Call Customer"
													>
														<Phone class="h-3.5 w-3.5" />
													</a>
												</div>
											{/if}
											{#if message.email}<div>
													<span class="text-gray-500">Email:</span>
													{message.email}
												</div>{/if}
											<div class="mt-3 rounded bg-white p-3">
												<span class="text-gray-500">Message:</span>
												<div class="mt-1">{message.message}</div>
											</div>
											<div class="mt-2 text-xs text-gray-500">{message.time}</div>
										</div>
									</div>
								{:else if message.type === 'call_summary'}
									<!-- Call summary card -->
									<div class="flex justify-center my-2">
										<div class="w-full max-w-[85%] rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 shadow-sm">
											<div class="flex items-center gap-2 mb-2">
												<div class="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500">
													<Phone class="h-3 w-3 text-white" />
												</div>
												<span class="text-xs font-semibold text-emerald-700 uppercase tracking-wider">Call Completed</span>
												<span class="ml-auto text-[10px] text-emerald-600 font-mono">{message.time}</span>
											</div>
											<div class="flex flex-wrap gap-3">
												{#if message.call_data?.duration}
													<div class="flex flex-col">
														<span class="text-[10px] text-emerald-600 uppercase font-semibold">Duration</span>
														<span class="text-sm font-bold text-emerald-800">
															{Math.floor(message.call_data.duration / 60)}:{String(message.call_data.duration % 60).padStart(2, '0')} min
														</span>
													</div>
												{/if}
												{#if message.call_data?.estimated_price}
													<div class="flex flex-col">
														<span class="text-[10px] text-emerald-600 uppercase font-semibold">Quoted Price</span>
														<span class="text-sm font-bold text-emerald-800">${message.call_data.estimated_price}</span>
													</div>
												{/if}
												{#if message.call_data?.direction}
													<div class="flex flex-col">
														<span class="text-[10px] text-emerald-600 uppercase font-semibold">Direction</span>
														<span class="text-sm font-bold text-emerald-800 capitalize">{message.call_data.direction}</span>
													</div>
												{/if}
											</div>
											{#if message.call_data?.summary}
												<p class="mt-2 text-xs text-emerald-700 italic border-t border-emerald-200 pt-2">{message.call_data.summary}</p>
											{/if}
										</div>
									</div>
								{:else}
									<!-- Regular chat message -->
									<div class="flex {message.isYou ? 'justify-end' : 'justify-start'}">
										<div
											class="max-w-[70%] {message.isYou
												? 'bg-primary text-white'
												: 'bg-gray-100'} rounded-lg p-3"
										>
											<div
												class="text-xs {message.isYou ? 'text-blue-100' : 'text-gray-500'} mb-1"
											>
												{message.sender}
											</div>
											<div class="text-sm">{message.message}</div>
											<div
												class="text-xs {message.isYou ? 'text-blue-100' : 'text-gray-500'} mt-1"
											>
												{message.time}
											</div>
										</div>
									</div>
								{/if}
							{/each}
						</div>
					{/if}
				{:else}
					<div class="flex h-full flex-1 items-center justify-center">
						<div class="text-center">
							<div class="mb-2">
								<MessageSquareText class="mx-auto h-16 w-16 opacity-50" />
							</div>
							<p>No conversation selected.</p>
						</div>
					</div>
				{/if}
			</div>

			<form
				class="border-t p-4"
				onsubmit={(e) => {
					e.preventDefault();
					sendMessage(e);
				}}
			>
				<div class="mb-4 flex items-center justify-between gap-4">
					<div class="flex gap-4">
						<button class="border-b-2 border-primary pb-2 text-primary">Message</button>
						<button class="pb-2">Note</button>
					</div>
					{#if selectedMessage}
						<button
							type="button"
							onclick={simulateCallResult}
							disabled={isSimulatingCall}
							title="Inject a fake call result card for testing"
							class="flex items-center gap-1.5 rounded-md border border-emerald-300 bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 transition-colors"
						>
							<Phone class="h-3 w-3" />
							{isSimulatingCall ? 'Simulating…' : 'Sim Call'}
						</button>
					{/if}
				</div>

				{#if hasUnansweredSms && selectedMessage && (selectedMessage.thread_id.startsWith('emergency-') || selectedMessage.intent === 'emergency' || selectedMessage.urgency === 'red')}
					<div class="mb-4 rounded-lg border border-sky-200 bg-sky-50/50 p-3 flex flex-col gap-2">
						<div class="text-[10px] text-sky-600 font-mono uppercase font-bold tracking-wider">Draft Response (Handshake)</div>
						{#if !selectedMessage.draftResponse && !chatMessages.some(m => m.isYou)}
							<div class="flex items-center gap-2 text-xs text-sky-600 font-medium py-2">
								<div class="h-4 w-4 animate-spin rounded-full border-2 border-sky-600 border-t-transparent"></div>
								<span>AI is drafting a helper response...</span>
							</div>
						{:else}
							<textarea
								bind:value={draftValue}
								class="w-full h-14 bg-white border border-sky-200 rounded p-1.5 text-slate-800 text-xs resize-none outline-none focus:border-sky-400 transition-colors"
							></textarea>
							<div class="flex justify-end">
								<Button
									type="button"
									class="bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white border-0 px-3 py-1.5 rounded text-[10px] font-bold cursor-pointer transition-colors"
									onclick={sendDraftSms}
									disabled={isSendingSms}
								>
									{isSendingSms ? 'Sending...' : 'Send Reply SMS'}
								</Button>
							</div>
						{/if}
					</div>
				{/if}

				<div class="w-full">
					<input
						type="text"
						placeholder="Type a message..."
						class="w-full flex-1 bg-transparent py-3 focus:outline-none"
						disabled={!selectedMessage}
					/>
				</div>
				<div class="flex gap-2">
					<div class="flex w-full items-center justify-between gap-2 rounded-lg">
						<div class="flex items-center gap-6">
							<Smile class="h-5 w-5" />
							<Images class="h-5 w-5" />
						</div>
						<Button
							type="submit"
							class="bg-primary px-6 text-sm font-semibold text-white hover:bg-blue-700"
							disabled={!selectedMessage}
						>
							SEND
						</Button>
					</div>
				</div>
			</form>
		</div>
	</div>
</div>
