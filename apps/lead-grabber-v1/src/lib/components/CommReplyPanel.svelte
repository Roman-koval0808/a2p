<script lang="ts">
	import { Button } from '$lib/components/ui/button/index';
	import {
		Phone,
		X,
		MessageSquareText,
		Send,
		Paperclip,
		Link,
		ChevronDown,
		Smile,
		MoreVertical,
		Reply,
		Image as ImageIcon
	} from 'lucide-svelte';
	import { toast } from 'svelte-sonner';
	import { goto } from '$app/navigation';

	interface Props {
		open?: boolean;
		comm: any;
		user: any;
		onClose?: () => void;
	}

	let {
		open = $bindable(false),
		comm,
		user,
		onClose
	}: Props = $props();

	// Chat state
	let chatMessages = $state<
		{
			sender: string;
			message: string;
			time: string;
			isYou: boolean;
			timestamp: string;
			type?: string;
			call_data?: any;
		}[]
	>([]);
	let isLoadingChat = $state(false);
	let messageInput = $state('');
	let isSending = $state(false);
	let messagesContainer: HTMLElement;

	// Draft response state
	let draftValue = $state('');
	let isSendingDraft = $state(false);
	let draftInitialized = false;

	const lastMessage = $derived(chatMessages[chatMessages.length - 1] ?? null);
	const hasUnansweredSms = $derived(
		lastMessage !== null &&
		!lastMessage.isYou &&
		lastMessage.type !== 'call_summary'
	);

	// Derive contact info from the comm log entry
	const customerPhone = $derived(
		comm?.raw?.payload?.phone ||
			comm?.raw?.payload?.customer_phone ||
			comm?.raw?.customerProfile?.phone ||
			comm?.source ||
			null
	);
	const customerName = $derived(
		comm?.raw?.customerProfile?.name || comm?.source || 'Customer'
	);
	const threadId = $derived(
		comm?.raw?.payload?.threadId || comm?.raw?.threadId || customerPhone || null
	);

	// Load thread messages when comm changes, and poll on interval when open
	$effect(() => {
		if (open && comm) {
			draftInitialized = false;
			loadThread();
			const interval = setInterval(loadThread, 4000);
			return () => clearInterval(interval);
		}
	});

	// Scroll to bottom when messages change
	$effect(() => {
		if (chatMessages && messagesContainer) {
			setTimeout(() => {
				messagesContainer.scrollTop = messagesContainer.scrollHeight;
			}, 50);
		}
	});

	async function loadThread() {
		if (!threadId) {
			// No thread — build a single-message view from the comm log entry
			chatMessages = [
				{
					sender: customerName,
					message:
						comm?.raw?.payload?.body ||
						comm?.raw?.payload?.text ||
						comm?.raw?.payload?.voicemail_text ||
						comm?.summary ||
						'No content',
					time: comm?.time || '',
					isYou: false,
					timestamp: comm?.raw?.occurredAt || new Date().toISOString()
				}
			];
			return;
		}

		isLoadingChat = true;
		try {
			const response = await fetch(
				`/api/messages?threadId=${encodeURIComponent(threadId)}`
			);
			if (!response.ok) throw new Error('Failed to fetch thread');
			const resJson = await response.json();
			const thread = resJson.data;

			if (!thread || !thread.messages || thread.messages.length === 0) {
				chatMessages = [];
				return;
			}

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
						: thread.customerName || customerName,
					message: msg.content,
					time: new Date(msg.timestamp).toLocaleString([], {
						month: 'short',
						day: 'numeric',
						hour: '2-digit',
						minute: '2-digit'
					}),
					isYou: msg.is_agent_reply,
					timestamp: msg.timestamp,
					type: msg.type,
					call_data: msg.call_data
				}))
				.sort(
					(a: any, b: any) =>
						new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
				);

			// Set draftValue from thread if not initialized yet
			if (!draftInitialized) {
				const hasAgentReply = messagesArray.some((msg: any) => msg.is_agent_reply);
				const hasCallSummary = messagesArray.some((msg: any) => msg.type === 'call_summary');
				if (thread.draftResponse || comm.raw?.draftResponse || comm.summary) {
					draftValue = thread.draftResponse || comm.raw?.draftResponse || comm.summary;
				} else {
					draftValue = '';
				}
				draftInitialized = true;
			}
		} catch (err) {
			console.error('Error loading thread:', err);
			// Fall back to single comm entry
			chatMessages = [
				{
					sender: customerName,
					message: comm?.summary || 'No content',
					time: comm?.time || '',
					isYou: false,
					timestamp: comm?.raw?.occurredAt || new Date().toISOString()
				}
			];
			if (!draftInitialized) {
				draftValue = comm.raw?.draftResponse || comm.summary || '';
				draftInitialized = true;
			}
		} finally {
			isLoadingChat = false;
		}
	}

	async function sendMessage(e: Event) {
		e.preventDefault();
		const message = messageInput.trim();
		if (!message || !customerPhone) return;

		isSending = true;
		try {
			// Send via Telnyx
			const telnyxResponse = await fetch('/api/telnyx', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					message,
					phoneNumber: customerPhone,
					threadId: threadId || undefined
				})
			});

			const telnyxResult = await telnyxResponse.json();
			if (!telnyxResult.success) {
				toast.error('Failed to send SMS: ' + telnyxResult.error);
				return;
			}

			// If we have a threadId, update the thread
			if (threadId) {
				const threadResponse = await fetch(
					`/api/messages?threadId=${encodeURIComponent(threadId)}`
				);
				if (threadResponse.ok) {
					const resJson = await threadResponse.json();
					const existingThread = resJson.data;
					if (existingThread) {
						const existingMessages =
							typeof existingThread.messages === 'string'
								? JSON.parse(existingThread.messages)
								: existingThread.messages || [];

						await fetch('/api/messages', {
							method: 'PATCH',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({
								id: existingThread.id,
								messages: [
									...existingMessages,
									{
										content: message,
										timestamp: new Date().toISOString(),
										is_agent_reply: true,
										agent_id: user?.id,
										agent_name: user?.name
									}
								],
								status: 'replied'
							})
						});
					}
				}
			}

			// Add to local chat
			chatMessages = [
				...chatMessages,
				{
					sender: user?.name || 'You',
					message,
					time: new Date().toLocaleString([], {
						month: 'short',
						day: 'numeric',
						hour: '2-digit',
						minute: '2-digit'
					}),
					isYou: true,
					timestamp: new Date().toISOString()
				}
			];

			messageInput = '';
			toast.success('Message sent successfully');
		} catch (err) {
			console.error('Error sending message:', err);
			toast.error('Failed to send message');
		} finally {
			isSending = false;
		}
	}

	async function sendDraftSms() {
		if (!customerPhone || !draftValue.trim()) return;

		isSendingDraft = true;
		try {
			const telnyxResponse = await fetch('/api/telnyx', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					message: draftValue,
					phoneNumber: customerPhone,
					threadId: threadId || undefined
				})
			});

			const telnyxResult = await telnyxResponse.json();
			if (!telnyxResult.success) {
				toast.error('Failed to send SMS: ' + telnyxResult.error);
				return;
			}

			// Update thread if exists
			if (threadId) {
				const threadResponse = await fetch(
					`/api/messages?threadId=${encodeURIComponent(threadId)}`
				);
				if (threadResponse.ok) {
					const resJson = await threadResponse.json();
					const existingThread = resJson.data;
					if (existingThread) {
						const existingMessages =
							typeof existingThread.messages === 'string'
								? JSON.parse(existingThread.messages)
								: existingThread.messages || [];

						await fetch('/api/messages', {
							method: 'PATCH',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({
								id: existingThread.id,
								messages: [
									...existingMessages,
									{
										content: draftValue,
										timestamp: new Date().toISOString(),
										is_agent_reply: true,
										agent_id: user?.id,
										agent_name: user?.name
									}
								],
								status: 'replied'
							})
						});
					}
				}
			}

			// Add to local chat
			chatMessages = [
				...chatMessages,
				{
					sender: user?.name || 'You',
					message: draftValue,
					time: new Date().toLocaleString([], {
						month: 'short',
						day: 'numeric',
						hour: '2-digit',
						minute: '2-digit'
					}),
					isYou: true,
					timestamp: new Date().toISOString()
				}
			];

			toast.success('Draft SMS sent!');
			draftValue = '';
		} catch (err) {
			console.error('Error sending draft SMS:', err);
			toast.error('Failed to send draft SMS');
		} finally {
			isSendingDraft = false;
		}
	}

	function handleClose() {
		open = false;
		onClose?.();
	}

	function handleCallCustomer() {
		if (customerPhone) {
			goto(`/dialer?phone=${encodeURIComponent(customerPhone)}&call=true`);
		}
	}
</script>

{#if open && comm}
	<!-- Backdrop -->
	<button
		type="button"
		class="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm transition-opacity"
		onclick={handleClose}
		aria-label="Close panel"
	></button>

	<!-- Slide-out panel -->
	<div
		class="fixed right-0 top-0 z-50 flex h-full w-full max-w-[520px] flex-col bg-white shadow-2xl transition-transform duration-300"
	>
		<!-- Header -->
		<div class="flex items-center justify-between border-b border-gray-200 px-5 py-4">
			<div class="flex items-center gap-3">
				<div
					class="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-sm font-semibold text-white"
				>
					{customerName
						?.split(' ')
						.map((n: string) => n[0])
						.join('')
						.slice(0, 2) || '?'}
				</div>
				<div>
					<h3 class="text-sm font-semibold text-gray-900">{customerName}</h3>
					{#if customerPhone}
						<div class="flex items-center gap-2">
							<span class="text-xs text-gray-500">{customerPhone}</span>
							<button
								type="button"
								class="inline-flex items-center justify-center rounded-full bg-emerald-50 p-1 text-emerald-600 transition-all duration-200 hover:bg-emerald-500 hover:text-white"
								title="Call Customer"
								onclick={handleCallCustomer}
							>
								<Phone class="h-3 w-3" />
							</button>
						</div>
					{/if}
				</div>
			</div>
			<button
				type="button"
				class="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
				onclick={handleClose}
			>
				<X class="h-5 w-5" />
			</button>
		</div>

		<!-- Chat messages area -->
		<div class="flex-1 overflow-y-auto" bind:this={messagesContainer}>
			{#if isLoadingChat}
				<div class="flex flex-col gap-4 p-4">
					{#each Array(3) as _}
						<div class="rounded-lg border border-dashed border-gray-200 p-4">
							<div class="mb-4 h-4 w-32 animate-pulse rounded bg-gray-200"></div>
							<div class="space-y-3">
								<div class="h-3 w-3/4 animate-pulse rounded bg-gray-200"></div>
								<div class="h-3 w-1/2 animate-pulse rounded bg-gray-200"></div>
							</div>
						</div>
					{/each}
				</div>
			{:else if chatMessages.length === 0}
				<div class="flex h-full items-center justify-center">
					<div class="text-center">
						<MessageSquareText class="mx-auto mb-2 h-12 w-12 opacity-30" />
						<p class="text-sm text-gray-400">No messages in this thread</p>
					</div>
				</div>
			{:else}
				<div class="space-y-3 p-4">
					{#each chatMessages as message, i}
						{#if message.type === 'call_summary'}
							<!-- Call summary card -->
							<div class="flex justify-center my-2">
								<div
									class="w-full max-w-[85%] rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 shadow-sm"
								>
									<div class="mb-2 flex items-center gap-2">
										<div
											class="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500"
										>
											<Phone class="h-3 w-3 text-white" />
										</div>
										<span
											class="text-xs font-semibold uppercase tracking-wider text-emerald-700"
											>Call Completed</span
										>
										<span class="ml-auto font-mono text-[10px] text-emerald-600"
											>{message.time}</span
										>
									</div>
									{#if message.call_data?.duration}
										<div class="text-xs text-emerald-700">
											Duration: {Math.floor(message.call_data.duration / 60)}:{String(
												message.call_data.duration % 60
											).padStart(2, '0')} min
										</div>
									{/if}
									{#if message.call_data?.summary}
										<p
											class="mt-2 border-t border-emerald-200 pt-2 text-xs italic text-emerald-700"
										>
											{message.call_data.summary}
										</p>
									{/if}
								</div>
							</div>
						{:else}
							<!-- Regular chat bubble -->
							<div class="flex {message.isYou ? 'justify-end' : 'justify-start'}">
								<div
									class="max-w-[75%] {message.isYou
										? 'bg-primary text-white'
										: 'bg-gray-100'} rounded-lg p-3"
								>
									<div
										class="mb-1 text-xs {message.isYou
											? 'text-blue-100'
											: 'text-gray-500'}"
									>
										{message.sender}
									</div>
									<div class="text-sm">{message.message}</div>
									<div
										class="mt-1 text-xs {message.isYou
											? 'text-blue-100'
											: 'text-gray-500'}"
									>
										{message.time}
									</div>
								</div>
							</div>
						{/if}
					{/each}
				</div>
			{/if}
		</div>

		<!-- Reply area -->
		<div class="border-t border-gray-200 p-4">
			{#if customerPhone}
				<!-- Quick draft reply (Mockup-matched Gmail Card) -->
				{#if draftValue}
					<div class="mb-4 flex gap-3 border border-gray-200 rounded-xl bg-white shadow-sm overflow-hidden p-4">
						<!-- User avatar on the left -->
						<div
							class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white font-semibold text-xs bg-[#516F90]"
						>
							{getInitials(user?.name ?? 'Mark Doe')}
						</div>

						<!-- Composer Card -->
						<div class="flex-1 min-w-0">
							<!-- Header -->
							<div class="flex items-center gap-2 pb-2 border-b border-gray-100 mb-3">
								<Reply class="h-3.5 w-3.5 text-gray-500" />
								<span class="text-xs font-sans font-medium text-gray-700">
									{customerName}
									{#if customerPhone}
										<span class="text-gray-500 font-normal">({customerPhone})</span>
									{/if}
								</span>
							</div>

							<!-- Body and Details -->
							<div>
								<!-- Editable Text Area -->
								<textarea
									bind:value={draftValue}
									class="w-full min-h-[100px] font-sans text-xs text-gray-800 leading-relaxed outline-none border-none resize-y"
								></textarea>

								<!-- Structured Appointment Details -->
								<div class="mt-4 pt-3 border-t border-gray-100 space-y-1.5 text-xs text-gray-600">
									<div><span class="font-bold text-gray-700">Agent:</span> {user?.name ?? 'Mark Doe'}</div>
									<div><span class="font-bold text-gray-700">Appointment:</span> 2:30pm - 3:15pm</div>
									<div><span class="font-bold text-gray-700">Location:</span> 123 Pine St N Timmins Ontario</div>
									<div><span class="font-bold text-gray-700">Purpose:</span> Test Drive</div>
									<div class="flex items-center gap-2 mt-3">
										<span class="font-bold text-gray-700 font-sans">Confirm Appointment:</span>
										<button 
											type="button"
											onclick={sendDraftSms}
											class="bg-[#4CAF50] hover:bg-[#43A047] text-white text-[10px] font-semibold px-2 py-0.5 rounded transition-colors shadow-sm"
										>
											Yes
										</button>
										<button 
											type="button"
											onclick={handleClose}
											class="bg-[#F44336] hover:bg-[#E53935] text-white text-[10px] font-semibold px-2 py-0.5 rounded transition-colors shadow-sm"
										>
											No
										</button>
									</div>
								</div>
							</div>

							<!-- Footer Toolbar -->
							<div class="flex items-center justify-between mt-4 pt-3 border-t border-gray-100">
								<!-- Left side: Send button with dropdown -->
								<div class="flex items-center bg-[#0C58D1] rounded-full overflow-hidden shadow-sm">
									<button
										type="button"
										onclick={sendDraftSms}
										disabled={isSendingDraft}
										class="px-4 py-1.5 text-xs font-medium text-white hover:bg-[#0b51c1] transition-colors"
									>
										{isSendingDraft ? 'Sending...' : 'Send'}
									</button>
									<div class="w-px h-4 bg-[#ffffff]/20"></div>
									<button
										type="button"
										class="p-1.5 text-white hover:bg-[#0b51c1] transition-colors flex items-center justify-center"
										aria-label="Send options"
									>
										<ChevronDown class="h-3 w-3" />
									</button>
								</div>

								<!-- Right side: Formatting / Attachments -->
								<div class="flex items-center gap-3 text-gray-500">
									<button type="button" class="text-xs font-semibold hover:text-gray-800 hover:bg-gray-100 px-1.5 py-0.5 rounded transition-all" aria-label="Format text">
										Aa
									</button>
									<button type="button" class="hover:text-gray-800 hover:bg-gray-100 p-1 rounded transition-all" aria-label="Attach file">
										<Paperclip class="h-3.5 w-3.5" />
									</button>
									<button type="button" class="hover:text-gray-800 hover:bg-gray-100 p-1 rounded transition-all" aria-label="Insert link">
										<Link class="h-3.5 w-3.5" />
									</button>
									<button type="button" class="hover:text-gray-800 hover:bg-gray-100 p-1 rounded transition-all" aria-label="Insert image">
										<ImageIcon class="h-3.5 w-3.5" />
									</button>
									<button type="button" class="hover:text-gray-800 hover:bg-gray-100 p-1 rounded transition-all" aria-label="More options">
										<MoreVertical class="h-3.5 w-3.5" />
									</button>
								</div>
							</div>
						</div>
					</div>
				{/if}

				<!-- Message input -->
				<form
					onsubmit={sendMessage}
					class="flex items-center gap-2"
				>
					<input
						type="text"
						bind:value={messageInput}
						placeholder="Type a message..."
						class="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm outline-none transition-colors focus:border-primary"
						disabled={isSending}
					/>
					<Button
						type="submit"
						class="bg-primary px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
						disabled={isSending || !messageInput.trim()}
					>
						<Send class="h-4 w-4" />
					</Button>
				</form>
			{:else}
				<div class="rounded-lg bg-gray-50 p-3 text-center text-xs text-gray-500">
					No phone number available for this contact. SMS reply is not available.
				</div>
			{/if}
		</div>
	</div>
{/if}
