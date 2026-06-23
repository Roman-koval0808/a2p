<script lang="ts">
	import { Button } from '$lib/components/ui/button/index';
	import { Phone, X, MessageSquareText, Send } from 'lucide-svelte';
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
		comm?.raw?.payload?.threadId || comm?.raw?.threadId || null
	);

	// Load thread messages when comm changes
	$effect(() => {
		if (open && comm) {
			loadThread();
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

	// Set default draft
	$effect(() => {
		if (open && comm && customerPhone) {
			const userName = user?.name || 'our team';
			draftValue = `${userName} has gotten your message and will be calling you shortly.`;
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
					time: new Date(msg.timestamp).toLocaleTimeString([], {
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
					time: new Date().toLocaleTimeString([], {
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
					time: new Date().toLocaleTimeString([], {
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
				<!-- Quick draft reply -->
				{#if !chatMessages.some((m) => m.isYou) && draftValue}
					<div class="mb-3 flex flex-col gap-2 rounded-lg border border-sky-200 bg-sky-50/50 p-3">
						<div class="text-[10px] font-bold uppercase tracking-wider font-mono text-sky-600">
							Quick Reply
						</div>
						<textarea
							bind:value={draftValue}
							class="h-14 w-full resize-none rounded border border-sky-200 bg-white p-1.5 text-xs text-slate-800 outline-none transition-colors focus:border-sky-400"
						></textarea>
						<div class="flex justify-end">
							<Button
								type="button"
								class="cursor-pointer rounded border-0 bg-sky-500 px-3 py-1.5 text-[10px] font-bold text-white transition-colors hover:bg-sky-600 disabled:opacity-50"
								onclick={sendDraftSms}
								disabled={isSendingDraft}
							>
								{isSendingDraft ? 'Sending...' : 'Send Quick Reply'}
							</Button>
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
