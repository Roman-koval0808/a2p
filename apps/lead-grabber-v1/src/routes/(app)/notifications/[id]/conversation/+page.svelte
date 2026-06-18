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
	import { page } from '$app/state';
	import EmptyState from '$lib/components/EmptyState.svelte';

	interface Notification {
		id: string;
		type: 'email' | 'sms' | 'voice' | 'facebook';
		name: string;
		message: string;
		time: string;
		isBold?: boolean;
		fullMessage?: string;
		date?: string;
		phone?: string;
	}

	interface ConversationMessage {
		id: string;
		sender: string;
		senderIsYou: boolean;
		message: string;
		date: string;
		time: string;
	}

	// Mock notifications data - in real app, fetch from server using $page.params.id
	const notifications: Notification[] = [
		{
			id: '1',
			type: 'email',
			name: 'Maria Lopez',
			message: '[Urgent] Interview – HR Position Please confirm your attendance...',
			time: '11:45 AM',
			isBold: true,
			fullMessage:
				'[Urgent] Interview – HR Position Please confirm your attendance for the interview scheduled on November 15, 2025 at 2:00 PM.',
			date: 'Fri, Oct 17, 2025'
		},
		{
			id: '2',
			type: 'email',
			name: 'Ella Santos',
			message: 'Demo Room Launch Webinar on Nov 2, 2025, at 10:00 AM. Join u...',
			time: '11:45 AM',
			isBold: true,
			fullMessage:
				'Demo Room Launch Webinar on Nov 2, 2025, at 10:00 AM. Join us for an exclusive preview of our new features.',
			date: 'Fri, Oct 17, 2025'
		},
		{
			id: '3',
			type: 'email',
			name: 'Angela Torres',
			message: 'Your dedicated support session is confirmed for Nov 6, 2025, a...',
			time: '11:45 AM',
			isBold: true,
			fullMessage:
				"Your dedicated support session is confirmed for Nov 6, 2025, at 3:00 PM. We'll discuss your microsite optimization.",
			date: 'Fri, Oct 17, 2025'
		},
		{
			id: '4',
			type: 'email',
			name: 'Jasmine Cruz',
			message: 'Your Supplier - is ready for review. Kindly check the layout and...',
			time: '11:45 AM',
			isBold: true,
			fullMessage:
				'Your Supplier - is ready for review. Kindly check the layout and provide your feedback by end of week.',
			date: 'Fri, Oct 17, 2025'
		},
		{
			id: '5',
			type: 'email',
			name: 'Sophie Lim',
			message: "Your current logo file is slightly outdated. If you'd like, upload a...",
			time: '11:45 AM',
			isBold: false,
			fullMessage:
				"Congratulations! Your Founder Benefit Package has been successfully activated. As one of our early partners, you're now entitled to 50% off banner advertising for five years and two hours of dedicated monthly support for your microsite. Thank you for being part of our early innovation phase — your input helps shape the platform's future.",
			date: 'Fri, Oct 17, 2025'
		},
		{
			id: '6',
			type: 'email',
			name: 'Liam Garcia',
			message: "HR Module setup on your microsite isn't complete yet. Please fi...",
			time: '11:45 AM',
			isBold: true,
			fullMessage:
				"HR Module setup on your microsite isn't complete yet. Please finish the configuration to enable all features.",
			date: 'Fri, Oct 17, 2025'
		},
		{
			id: '7',
			type: 'email',
			name: 'Kevin Tan',
			message: 'Just a quick reminder — the Microsite Deployment Report is due..',
			time: '11:45 AM',
			isBold: true,
			fullMessage:
				'Just a quick reminder — the Microsite Deployment Report is due by Friday. Please submit it at your earliest convenience.',
			date: 'Fri, Oct 17, 2025'
		},
		{
			id: '8',
			type: 'email',
			name: 'Ryan Kim',
			message: 'Prospector Microsite are now live. Please review the event and...',
			time: '11:45 AM',
			isBold: true,
			fullMessage:
				'Prospector Microsite are now live. Please review the event and provide feedback on the new features.',
			date: 'Fri, Oct 17, 2025'
		},
		{
			id: '9',
			type: 'email',
			name: 'HR Department',
			message: '[Urgent] Interview – HR Position Please confirm your attendance...',
			time: '11:45 AM',
			isBold: true,
			fullMessage:
				'[Urgent] Interview – HR Position Please confirm your attendance for the interview scheduled on November 15, 2025 at 2:00 PM.',
			date: 'Fri, Oct 17, 2025'
		},
		{
			id: '10',
			type: 'email',
			name: 'Nathan James',
			message: 'A new client has reached out regarding your AI Design & Demo...',
			time: '11:45 AM',
			isBold: false,
			fullMessage:
				"A new client has reached out regarding your AI Design & Demo Room. They're interested in scheduling a consultation.",
			date: 'Fri, Oct 17, 2025'
		},
		{
			id: '11',
			type: 'email',
			name: 'Daniel Cruz',
			message: 'Founder Benefit Package is now active. Enjoy 50% off banner a...',
			time: '11:45 AM',
			isBold: true,
			fullMessage:
				'Founder Benefit Package is now active. Enjoy 50% off banner advertising and exclusive monthly support sessions.',
			date: 'Fri, Oct 17, 2025'
		},
		{
			id: '12',
			type: 'email',
			name: 'Chloe Reyes',
			message: "We've upgraded the Viewroom feature to include note-taking...",
			time: '11:45 AM',
			isBold: false,
			fullMessage:
				"We've upgraded the Viewroom feature to include note-taking capabilities. Check it out and let us know what you think!",
			date: 'Fri, Oct 17, 2025'
		}
	];

	let conversationMessages = $state<ConversationMessage[]>([]);
	let replyMessage = $state('');
	let editorRef: HTMLDivElement | null = $state(null);
	let threadContainerRef: HTMLDivElement | null = $state(null);

	const notificationId = $derived(page.params.id);
	const selectedNotification = $derived(notifications.find((n) => n.id === notificationId) || null);

	$effect(() => {
		if (selectedNotification) {
			initializeConversation(selectedNotification);
		}
	});

	function initializeConversation(notification: Notification) {
		conversationMessages = [
			{
				id: '1',
				sender: notification.name,
				senderIsYou: false,
				message: notification.fullMessage || notification.message,
				date: notification.date || 'Fri, Oct 17, 2025',
				time: notification.time || '11:29 PM'
			}
		];
	}

	function formatRichText(command: string, value?: string) {
		document.execCommand(command, false, value);
		if (editorRef) {
			editorRef.focus();
		}
	}

	function handleSend() {
		if (editorRef && selectedNotification) {
			const textContent = editorRef.innerText || editorRef.textContent || '';
			if (textContent.trim()) {
				const newMessage: ConversationMessage = {
					id: Date.now().toString(),
					sender: 'You',
					senderIsYou: true,
					message: editorRef.innerHTML,
					date: new Date().toLocaleDateString('en-US', {
						weekday: 'short',
						month: 'short',
						day: 'numeric',
						year: 'numeric'
					}),
					time: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
				};
				conversationMessages = [...conversationMessages, newMessage];
				replyMessage = '';
				editorRef.innerHTML = '';

				// Scroll to bottom after sending
				setTimeout(() => {
					if (threadContainerRef) {
						threadContainerRef.scrollTop = threadContainerRef.scrollHeight;
					}
				}, 0);
			}
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
					{selectedNotification.name}
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
							Fri, November 5, 2025 – 9:00 AM
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
									{selectedNotification.name}
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
										class="flex h-9 items-center gap-2 rounded-lg bg-[#0C58D1] px-4 font-sans text-sm font-medium text-white transition-colors hover:bg-[#0C58D1]/90"
									>
										<Send class="h-4 w-4" />
										Send
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
