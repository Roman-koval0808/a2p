<script lang="ts">
	import {
		ArrowLeft,
		Download,
		Trash2,
		Reply,
		MoreVertical,
		Mail,
		User,
		Send,
		Type,
		Paperclip,
		Link,
		Image,
		Bold,
		Italic,
		Underline,
		AlignLeft,
		AlignCenter,
		AlignRight,
		AlignJustify,
		List,
		ListOrdered,
		Indent,
		Outdent,
		Undo,
		Redo,
		Smile,
		Lock,
		PenTool,
		ChevronDown
	} from 'lucide-svelte';
	import { goto } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import EmptyState from '$lib/components/EmptyState.svelte';

	interface ConversationMessage {
		id: string;
		sender: string;
		senderIsYou: boolean;
		message: string;
		date: string;
		time: string;
	}

	let { data } = $props();

	const selectedNotification = $derived(data.notification);

	let conversationMessages = $state<ConversationMessage[]>([]);
	let replyMessage = $state('');
	let sending = $state(false);
	let editorRef: HTMLDivElement | null = $state(null);
	let threadContainerRef: HTMLDivElement | null = $state(null);

	// Seed the thread from server data whenever it changes.
	$effect(() => {
		conversationMessages = data.messages.map((m) => ({ ...m }));
	});

	function formatRichText(command: string, value?: string) {
		document.execCommand(command, false, value);
		if (editorRef) {
			editorRef.focus();
		}
	}

	async function handleSend() {
		if (!editorRef || !selectedNotification || sending) return;

		const htmlContent = editorRef.innerHTML;
		const textContent = (editorRef.innerText || editorRef.textContent || '').trim();
		if (!textContent) return;

		const replyMethod = selectedNotification.type === 'sms' ? 'sms' : 'email';

		sending = true;
		try {
			const res = await fetch(`/api/notifications/${selectedNotification.id}/reply`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ message: textContent, replyMethod })
			});
			const result = await res.json().catch(() => ({}));

			if (!res.ok || !result.success) {
				toast.error(result.error || 'Failed to send reply');
				return;
			}

			const now = new Date();
			const newMessage: ConversationMessage = {
				id: Date.now().toString(),
				sender: 'You',
				senderIsYou: true,
				message: htmlContent,
				date: now.toLocaleDateString('en-US', {
					weekday: 'short',
					month: 'short',
					day: 'numeric',
					year: 'numeric'
				}),
				time: now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
			};
			conversationMessages = [...conversationMessages, newMessage];
			replyMessage = '';
			editorRef.innerHTML = '';
			toast.success('Reply sent successfully!');

			// Scroll to bottom after sending
			setTimeout(() => {
				if (threadContainerRef) {
					threadContainerRef.scrollTop = threadContainerRef.scrollHeight;
				}
			}, 0);
		} catch (err) {
			console.error('Failed to send reply:', err);
			toast.error('Failed to send reply');
		} finally {
			sending = false;
		}
	}

	function getInitials(name: string): string {
		return name
			.split(' ')
			.map((n) => n[0])
			.join('')
			.toUpperCase()
			.slice(0, 2);
	}

	function handleBack() {
		goto('/notifications');
	}
</script>

<div class="w-full min-w-0 p-4">
	{#if selectedNotification}
		<!-- Conversation View -->
		<div class="flex h-[calc(100vh-200px)] w-[1117px] flex-col rounded-sm bg-white">
			<!-- Header -->
			<div
				class="flex h-[61px] w-[1117px] flex-shrink-0 items-center gap-4 rounded-sm border-b border-[#E0E0E0] bg-white px-4"
			>
				<button
					onclick={handleBack}
					class="h-[18px] w-[36px] text-[#7D7D7D] transition-colors hover:text-[#555555]"
					aria-label="Back"
				>
					<ArrowLeft class="h-[18px] w-[36px]" />
				</button>
				<h1 class="font-sans text-2xl font-semibold leading-[1.29] text-[#747474]">
					{selectedNotification.sourceName}
				</h1>
			</div>

			<!-- Content -->
			<div class="flex min-h-0 w-[1117px] flex-1 flex-col rounded-sm bg-white">
				<!-- Metadata Bar -->
				<div
					class="flex flex-shrink-0 items-center justify-between border-b border-[#E0E0E0] px-6 py-4"
				>
					<div class="flex items-center gap-3">
						<Mail class="h-5 w-5 text-[#848484]" />
						<span class="font-sans text-sm font-medium leading-[26px] text-[#717171]">
							{selectedNotification.headerDate}
						</span>
					</div>
					<div class="flex items-center gap-4">
						<button
							class="h-4 w-4 text-[#848484] transition-colors hover:text-[#555555]"
							aria-label="Download"
						>
							<Download class="h-4 w-4" />
						</button>
						<button
							class="h-4 w-4 text-[#848484] transition-colors hover:text-[#555555]"
							aria-label="Delete"
						>
							<Trash2 class="h-4 w-4" />
						</button>
						<button
							class="h-4 w-4 text-[#848484] transition-colors hover:text-[#555555]"
							aria-label="Reply"
						>
							<Reply class="h-4 w-4" />
						</button>
						<button
							class="h-4 w-4 text-[#848484] transition-colors hover:text-[#555555]"
							aria-label="More"
						>
							<MoreVertical class="h-4 w-4" />
						</button>
					</div>
				</div>

				<!-- Conversation Thread -->
				<div bind:this={threadContainerRef} class="min-h-0 flex-1 overflow-y-auto px-6 py-4">
					{#each conversationMessages as msg}
						<div class="mb-6 flex items-start gap-3">
							<!-- Avatar -->
							<div
								class="h-[34px] w-[34px] rounded-full {msg.senderIsYou
									? 'bg-[#7D7D7D]'
									: 'bg-[#E0E0E0]'} flex flex-shrink-0 items-center justify-center"
							>
								{#if msg.senderIsYou}
									<User class="h-5 w-5 text-white" />
								{:else}
									<span class="font-sans text-xs font-semibold text-[#848484]">
										{getInitials(msg.sender)}
									</span>
								{/if}
							</div>

							<!-- Message Content -->
							<div class="min-w-0 flex-1">
								<div class="mb-2 flex items-center gap-3">
									<span
										class="font-sans text-sm font-medium leading-[1.29] tracking-normal text-[#696969]"
									>
										{msg.sender}
									</span>
									<span class="font-sans text-sm font-normal leading-[26px] text-[#717171]">
										{msg.date} – {msg.time}
									</span>
								</div>
								<div class="min-h-[60px] w-full rounded-sm bg-[#F9F9F9] p-4">
									<div
										class="whitespace-pre-wrap font-sans text-sm font-normal leading-[26px] text-[#717171]"
									>
										{@html msg.message}
									</div>
								</div>
							</div>
						</div>
					{/each}
				</div>

				<!-- Reply Composer -->
				<div class="flex-shrink-0 border-t border-[#E0E0E0] px-6 py-4">
					<div class="flex gap-4">
						<!-- Profile Icon -->
						<div
							class="flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-full bg-[#7D7D7D]"
						>
							<User class="h-5 w-5 text-white" />
						</div>

						<!-- Composer Box -->
						<div class="relative flex-1 rounded-sm border border-[#E0E0E0] bg-white">
							<!-- Recipient Header -->
							<div class="flex items-center gap-2 border-b border-[#E0E0E0] px-4 py-2">
								<ArrowLeft class="h-4 w-4 text-[#848484]" />
								<Reply class="h-4 w-4 text-[#848484]" />
								<span class="font-sans text-sm font-medium text-[#848484]">
									{selectedNotification.sourceName}
								</span>
							</div>

							<!-- Rich Text Editor -->
							<div class="relative">
								<div
									bind:this={editorRef}
									contenteditable="true"
									class="min-h-[120px] p-4 font-sans text-sm font-normal leading-[26px] text-[#717171] outline-none"
									oninput={(e) => {
										const html = e.currentTarget.innerHTML;
										if (html === '<div><br></div>' || html === '<br>' || html === '<div></div>') {
											replyMessage = '';
											if (editorRef) {
												editorRef.innerHTML = '';
											}
										} else {
											replyMessage = html;
										}
									}}
								></div>
								{#if !replyMessage || replyMessage === '<div><br></div>' || replyMessage === '<br>' || replyMessage === '<div></div>'}
									<div
										class="pointer-events-none absolute left-4 top-4 font-sans text-sm font-normal leading-[26px] text-gray-400"
									>
										Type your message here...
									</div>
								{/if}
							</div>

							<!-- Rich Text Formatting Toolbar -->
							<div
								class="flex flex-wrap items-center gap-2 border-t border-[#E0E0E0] bg-[#F9F9F9] px-4 py-2"
							>
								<button
									onclick={() => formatRichText('undo')}
									class="rounded p-1.5 hover:bg-gray-200"
									aria-label="Undo"
								>
									<Undo class="h-4 w-4 text-[#717171]" />
								</button>
								<button
									onclick={() => formatRichText('redo')}
									class="rounded p-1.5 hover:bg-gray-200"
									aria-label="Redo"
								>
									<Redo class="h-4 w-4 text-[#717171]" />
								</button>
								<div class="h-4 w-px bg-[#E0E0E0]"></div>
								<button
									class="flex items-center gap-1 rounded px-2 py-1 text-xs text-[#717171] hover:bg-gray-200"
								>
									Sans Serif <ChevronDown class="h-3 w-3" />
								</button>
								<div class="h-4 w-px bg-[#E0E0E0]"></div>
								<button
									class="flex items-center gap-1 rounded px-2 py-1 text-xs text-[#717171] hover:bg-gray-200"
								>
									TT <ChevronDown class="h-3 w-3" />
								</button>
								<button
									onclick={() => formatRichText('bold')}
									class="rounded p-1.5 font-bold hover:bg-gray-200"
									aria-label="Bold"
								>
									<Bold class="h-4 w-4 text-[#717171]" />
								</button>
								<button
									onclick={() => formatRichText('italic')}
									class="rounded p-1.5 italic hover:bg-gray-200"
									aria-label="Italic"
								>
									<Italic class="h-4 w-4 text-[#717171]" />
								</button>
								<button
									onclick={() => formatRichText('underline')}
									class="rounded p-1.5 underline hover:bg-gray-200"
									aria-label="Underline"
								>
									<Underline class="h-4 w-4 text-[#717171]" />
								</button>
								<button
									class="flex items-center gap-1 rounded p-1.5 hover:bg-gray-200"
									aria-label="Text Color"
								>
									<span class="text-xs text-[#717171]">A</span>
									<ChevronDown class="h-3 w-3" />
								</button>
								<button
									onclick={() => formatRichText('justifyLeft')}
									class="rounded p-1.5 hover:bg-gray-200"
									aria-label="Align Left"
								>
									<AlignLeft class="h-4 w-4 text-[#717171]" />
								</button>
								<button
									onclick={() => formatRichText('justifyCenter')}
									class="rounded p-1.5 hover:bg-gray-200"
									aria-label="Align Center"
								>
									<AlignCenter class="h-4 w-4 text-[#717171]" />
								</button>
								<button
									onclick={() => formatRichText('justifyRight')}
									class="rounded p-1.5 hover:bg-gray-200"
									aria-label="Align Right"
								>
									<AlignRight class="h-4 w-4 text-[#717171]" />
								</button>
								<button
									onclick={() => formatRichText('justifyFull')}
									class="rounded p-1.5 hover:bg-gray-200"
									aria-label="Justify"
								>
									<AlignJustify class="h-4 w-4 text-[#717171]" />
								</button>
								<button
									onclick={() => formatRichText('insertOrderedList')}
									class="rounded p-1.5 hover:bg-gray-200"
									aria-label="Numbered List"
								>
									<ListOrdered class="h-4 w-4 text-[#717171]" />
								</button>
								<button
									onclick={() => formatRichText('insertUnorderedList')}
									class="rounded p-1.5 hover:bg-gray-200"
									aria-label="Bullet List"
								>
									<List class="h-4 w-4 text-[#717171]" />
								</button>
								<button
									onclick={() => formatRichText('outdent')}
									class="rounded p-1.5 hover:bg-gray-200"
									aria-label="Decrease Indent"
								>
									<Outdent class="h-4 w-4 text-[#717171]" />
								</button>
								<button
									onclick={() => formatRichText('indent')}
									class="rounded p-1.5 hover:bg-gray-200"
									aria-label="Increase Indent"
								>
									<Indent class="h-4 w-4 text-[#717171]" />
								</button>
							</div>

							<!-- Action Toolbar -->
							<div
								class="flex items-center justify-between border-t border-[#E0E0E0] bg-white px-4 py-2"
							>
								<div class="flex items-center gap-2">
									<button
										onclick={handleSend}
										disabled={sending}
										class="flex h-9 items-center gap-2 rounded-lg bg-[#0C58D1] px-4 font-sans text-sm font-medium text-white transition-colors hover:bg-[#0C58D1]/90 disabled:cursor-not-allowed disabled:opacity-60"
									>
										<Send class="h-4 w-4" />
										{sending ? 'Sending...' : 'Send'}
									</button>
									<button class="flex h-8 w-8 items-center justify-center rounded bg-[#0C58D1]">
										<ChevronDown class="h-4 w-4 text-white" />
									</button>
									<button class="rounded p-1.5 hover:bg-gray-100" aria-label="AI">
										<span class="text-lg">*</span>
									</button>
									<button class="rounded p-1.5 hover:bg-gray-100" aria-label="Text Case">
										<Type class="h-4 w-4 text-[#717171]" />
									</button>
									<button class="rounded p-1.5 hover:bg-gray-100" aria-label="Attach">
										<Paperclip class="h-4 w-4 text-[#717171]" />
									</button>
									<button class="rounded p-1.5 hover:bg-gray-100" aria-label="Link">
										<Link class="h-4 w-4 text-[#717171]" />
									</button>
									<button class="rounded p-1.5 hover:bg-gray-100" aria-label="Emoji">
										<Smile class="h-4 w-4 text-[#717171]" />
									</button>
									<button class="rounded p-1.5 hover:bg-gray-100" aria-label="Drive">
										<Image class="h-4 w-4 text-[#717171]" />
									</button>
									<button class="rounded p-1.5 hover:bg-gray-100" aria-label="Image">
										<Image class="h-4 w-4 text-[#717171]" />
									</button>
									<button class="rounded p-1.5 hover:bg-gray-100" aria-label="Lock">
										<Lock class="h-4 w-4 text-[#717171]" />
									</button>
									<button class="rounded p-1.5 hover:bg-gray-100" aria-label="Pen">
										<PenTool class="h-4 w-4 text-[#717171]" />
									</button>
									<button class="rounded p-1.5 hover:bg-gray-100" aria-label="More">
										<MoreVertical class="h-4 w-4 text-[#717171]" />
									</button>
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	{:else}
		<EmptyState
			title="Notification not found"
			variant="compact"
			class="min-h-0"
			primaryAction={{ label: 'Go back', onclick: handleBack }}
		/>
	{/if}
</div>
