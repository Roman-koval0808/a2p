<script lang="ts">
	import {
		Search,
		Mail,
		MoreVertical,
		Mic,
		ArrowLeft,
		Download,
		Trash2,
		Reply,
		Phone,
		MessageSquare,
		User,
		Archive,
		Clock,
		Star,
		Smile,
		Forward,
		Paperclip,
		Link,
		ChevronDown,
		Sparkles,
		Image as ImageIcon
	} from 'lucide-svelte';
	import { goto } from '$app/navigation';
	import { toast } from 'svelte-sonner';

	type NotificationRow = {
		id: string;
		type: string;
		direction: string;
		sourceName: string | null;
		sourceIdentifier: string | null;
		messagePreview: string;
		content: string | null;
		read: boolean;
		threadId: string | null;
		messageId: string | null;
		createdAt: Date;
	};

	let { data } = $props();
	let notifications = $derived(data?.notifications ?? []) as NotificationRow[];
	let selectedFilter = $state('All');
	const filters = ['All', 'Email', 'SMS', 'Voice', 'Facebook', 'Web', 'Leadform', 'Leadbox'];
	let searchQuery = $state('');
	let selectedNotification = $state<NotificationRow | null>(null);

	let draftActive = $state(false);
	let draftText = $state('');

	async function triggerAiReply() {
		draftActive = true;
		draftText = 'Generating reply with OpenAI...';
		try {
			const res = await fetch('/api/notifications/draft', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					content: selectedNotification?.content ?? selectedNotification?.messagePreview ?? '',
					channel: selectedNotification?.type ?? 'email'
				})
			});
			const result = await res.json();
			if (result.draft) {
				draftText = result.draft;
			} else {
				draftText = `Hello ${selectedNotification?.sourceName?.split(' ')[0] ?? 'Sarah'},\n\nLet us know if you need any assistance!`;
			}
		} catch (err) {
			console.error(err);
			draftText = `Hello ${selectedNotification?.sourceName?.split(' ')[0] ?? 'Sarah'},\n\nLet us know how we can help.`;
		}
	}

	async function handleSend() {
		if (!selectedNotification) return;
		try {
			const res = await fetch(`/api/notifications/${selectedNotification.id}/reply`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					message: draftText,
					replyMethod: selectedNotification.type === 'sms' ? 'sms' : 'email'
				})
			});
			const result = await res.json();
			if (result.success) {
				toast.success('Reply sent successfully!');
				draftActive = false;
				selectedNotification = null;
				window.location.reload();
			} else {
				toast.error(result.error || 'Failed to send reply');
			}
		} catch (err) {
			console.error(err);
			toast.error('Failed to send reply');
		}
	}

	function formatTime(d: Date) {
		const date = typeof d === 'string' ? new Date(d) : d;
		return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
	}
	function formatDate(d: Date) {
		const date = typeof d === 'string' ? new Date(d) : d;
		return date.toLocaleDateString('en-US', {
			weekday: 'short',
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		});
	}

	function formatDetailedDate(d: Date) {
		const date = typeof d === 'string' ? new Date(d) : d;
		return date.toLocaleDateString('en-US', {
			month: 'long',
			day: '2-digit',
			year: 'numeric'
		}) + ' ' + date.toLocaleTimeString('en-US', {
			hour: 'numeric',
			minute: '2-digit',
			hour12: true
		});
	}

	function getInitials(name: string | null) {
		if (!name) return 'UN';
		return name
			.split(' ')
			.map((n) => n[0])
			.join('')
			.toUpperCase()
			.slice(0, 2);
	}

	function getAvatarColor(name: string | null) {
		if (!name) return '#555555';
		let hash = 0;
		for (let i = 0; i < name.length; i++) {
			hash = name.charCodeAt(i) + ((hash << 5) - hash);
		}
		const colors = [
			'#4C7E54', // Green from Sarah Lee
			'#2B6CB0', // Blue
			'#319795', // Teal
			'#4A5568', // Slate
			'#805AD5', // Purple
			'#DD6B20', // Orange
			'#3182CE'  // Light blue
		];
		return colors[Math.abs(hash) % colors.length];
	}

	let selectedNotifications = $state<Set<string>>(new Set());
	let selectAll = $state(false);

	function toggleSelectAll() {
		if (selectAll) {
			selectedNotifications = new Set();
		} else {
			selectedNotifications = new Set(notifications.map((n) => n.id));
		}
		selectAll = !selectAll;
	}

	function toggleNotification(id: string) {
		if (selectedNotifications.has(id)) {
			selectedNotifications.delete(id);
		} else {
			selectedNotifications.add(id);
		}
		selectedNotifications = new Set(selectedNotifications);
		selectAll = selectedNotifications.size === notifications.length;
	}

	const filteredNotifications = $derived(
		notifications.filter((n) => {
			const matchFilter =
				selectedFilter === 'All' || n.type.toLowerCase() === selectedFilter.toLowerCase();
			const matchSearch =
				!searchQuery.trim() ||
				(n.sourceName?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false) ||
				n.messagePreview.toLowerCase().includes(searchQuery.toLowerCase());
			return matchFilter && matchSearch;
		})
	);

	function handleNotificationClick(notification: NotificationRow) {
		selectedNotification = notification;
	}

	function handleReplyClick() {
		if (selectedNotification?.threadId) {
			goto(`/inbox?threadId=${encodeURIComponent(selectedNotification.threadId)}`);
		} else {
			goto(`/notifications/${selectedNotification?.id}/conversation`);
		}
	}

	function typeIcon(type: string) {
		switch (type) {
			case 'sms':
				return MessageSquare;
			case 'voice':
				return Phone;
			case 'email':
				return Mail;
			default:
				return Mail;
		}
	}

	// Realtime: layout subscribes globally and invalidates 'app:notifications'; this page just uses the data
</script>

<div class="w-full min-w-0 overflow-x-auto p-4">
	{#if selectedNotification}
		<!-- Notification Detail View (Gmail-like UI) -->
		<div class="max-w-5xl bg-white border border-[#E0E0E0] rounded-lg shadow-sm">
			<!-- Top Action Bar -->
			<div class="flex h-14 items-center gap-6 border-b border-[#E0E0E0] px-6 text-gray-500">
				<button
					onclick={() => (selectedNotification = null)}
					class="p-1.5 hover:bg-gray-100 rounded-full transition-colors"
					aria-label="Back"
				>
					<ArrowLeft class="h-5 w-5" />
				</button>
				<div class="flex items-center gap-4">
					<button class="p-1.5 hover:bg-gray-100 rounded-full transition-colors" aria-label="Archive">
						<Archive class="h-5 w-5" />
					</button>
					<button class="p-1.5 hover:bg-gray-100 rounded-full transition-colors" aria-label="Delete">
						<Trash2 class="h-5 w-5" />
					</button>
					<button class="p-1.5 hover:bg-gray-100 rounded-full transition-colors" aria-label="Mark unread">
						<Mail class="h-5 w-5" />
					</button>
					<button class="p-1.5 hover:bg-gray-100 rounded-full transition-colors" aria-label="Snooze">
						<Clock class="h-5 w-5" />
					</button>
				</div>
			</div>

			<!-- Message Header -->
			<div class="px-6 pt-6 pb-4">
				<div class="flex items-start gap-4">
					<!-- Circular Avatar -->
					<div
						class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white font-semibold text-sm"
						style="background-color: {getAvatarColor(selectedNotification.sourceName)}"
					>
						{getInitials(selectedNotification.sourceName)}
					</div>

					<!-- Header Details -->
					<div class="flex-1 min-w-0">
						<div class="flex items-center justify-between flex-wrap gap-2">
							<div class="flex flex-col">
								<span class="font-sans text-sm font-semibold text-gray-900">
									{selectedNotification.sourceName ?? 'Unknown'}
								</span>
								<span class="font-sans text-xs text-gray-500 mt-0.5">
									to me, {selectedNotification.sourceIdentifier ?? 'recipient'}
								</span>
							</div>

							<!-- Timestamp & Message Actions -->
							<div class="flex items-center gap-4 text-gray-500">
								<span class="font-sans text-xs text-gray-500">
									{formatDetailedDate(selectedNotification.createdAt)}
								</span>
								<div class="flex items-center gap-2">
									<button class="p-1 hover:bg-gray-100 rounded-full transition-colors" aria-label="Star">
										<Star class="h-4 w-4" />
									</button>
									<button class="p-1 hover:bg-gray-100 rounded-full transition-colors" aria-label="Add emoji">
										<Smile class="h-4 w-4" />
									</button>
									<button
										onclick={handleReplyClick}
										class="p-1 hover:bg-gray-100 rounded-full transition-colors"
										aria-label="Reply"
									>
										<Reply class="h-4 w-4" />
									</button>
									<button class="p-1 hover:bg-gray-100 rounded-full transition-colors" aria-label="More options">
										<MoreVertical class="h-4 w-4" />
									</button>
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>

			<!-- Message Body -->
			<div class="px-14 pb-8">
				<div class="font-sans text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">
					{selectedNotification.content ?? selectedNotification.messagePreview}
				</div>

				<hr class="my-8 border-gray-200" />

				{#if draftActive}
					<!-- Reply Composer matching mockup -->
					<div class="flex gap-4 mt-6">
						<!-- User avatar on the left -->
						<div
							class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white font-semibold text-sm bg-[#516F90]"
						>
							{getInitials(data.user?.name ?? 'Mark Doe')}
						</div>

						<!-- Composer Card -->
						<div class="flex-1 border border-gray-300 rounded-2xl bg-white shadow-sm overflow-hidden">
							<!-- Header -->
							<div class="flex items-center gap-3 px-4 py-3 border-b border-gray-200">
								<Reply class="h-4 w-4 text-gray-500" />
								<span class="text-sm font-sans font-medium text-gray-800">
									{selectedNotification.sourceName ?? 'Sarah Lee'}
									{#if selectedNotification.sourceIdentifier}
										<span class="text-gray-500 font-normal">({selectedNotification.sourceIdentifier})</span>
									{/if}
								</span>
							</div>

							<!-- Body and Details -->
							<div class="p-6">
								<!-- Editable Text Area -->
								<textarea
									bind:value={draftText}
									class="w-full min-h-[120px] font-sans text-sm text-gray-800 leading-relaxed outline-none border-none resize-y"
								></textarea>
							</div>

							<!-- Footer Toolbar -->
							<div class="flex items-center justify-between px-4 py-3 bg-[#F2F4F7] border-t border-gray-200">
								<!-- Left side: Send button with dropdown -->
								<div class="flex items-center bg-[#0C58D1] rounded-full overflow-hidden shadow-sm">
									<button
										onclick={handleSend}
										class="px-5 py-2 text-sm font-medium text-white hover:bg-[#0b51c1] transition-colors"
									>
										Send
									</button>
									<div class="w-px h-5 bg-[#ffffff]/20"></div>
									<button
										class="p-2 text-white hover:bg-[#0b51c1] transition-colors flex items-center justify-center"
										aria-label="Send options"
									>
										<ChevronDown class="h-4 w-4" />
									</button>
								</div>

								<!-- Right side: Formatting / Attachments -->
								<div class="flex items-center gap-4 text-gray-500">
									<button class="text-sm font-semibold hover:text-gray-800 hover:bg-gray-200/50 px-2 py-1 rounded transition-all" aria-label="Format text">
										Aa
									</button>
									<button class="hover:text-gray-800 hover:bg-gray-200/50 p-1.5 rounded transition-all" aria-label="Attach file">
										<Paperclip class="h-4 w-4" />
									</button>
									<button class="hover:text-gray-800 hover:bg-gray-200/50 p-1.5 rounded transition-all" aria-label="Insert link">
										<Link class="h-4 w-4" />
									</button>
									<button class="hover:text-gray-800 hover:bg-gray-200/50 p-1.5 rounded transition-all" aria-label="Insert image">
										<ImageIcon class="h-4 w-4" />
									</button>
									<button class="hover:text-gray-800 hover:bg-gray-200/50 p-1.5 rounded transition-all" aria-label="More options">
										<MoreVertical class="h-4 w-4" />
									</button>
								</div>
							</div>
						</div>
					</div>
				{:else}
					<!-- Bottom Action Buttons (Mockup-matched Pills) -->
					<div class="flex flex-wrap gap-3">
						<button
							onclick={triggerAiReply}
							class="flex items-center gap-2 px-4 py-2 border border-black rounded-full hover:bg-gray-50 transition-colors text-sm font-medium text-black"
						>
							<Reply class="h-4 w-4" />
							Reply with AI
						</button>
						<button
							onclick={triggerAiReply}
							class="flex items-center gap-2 px-4 py-2 border border-black rounded-full hover:bg-gray-50 transition-colors text-sm font-medium text-black"
						>
							<Forward class="h-4 w-4" />
							Forward with AI
						</button>
						<button
							onclick={triggerAiReply}
							class="flex items-center gap-2 px-4 py-2 border border-black rounded-full hover:bg-gray-50 transition-colors text-sm font-medium text-black"
						>
							<Reply class="h-4 w-4" />
							Reply
						</button>
						<button
							onclick={triggerAiReply}
							class="flex items-center gap-2 px-4 py-2 border border-black rounded-full hover:bg-gray-50 transition-colors text-sm font-medium text-black"
						>
							<Forward class="h-4 w-4" />
							Forward
						</button>
					</div>
				{/if}
			</div>
		</div>
	{:else}
		<!-- Title -->
		<h1 class="mb-5 font-sans text-xl font-semibold leading-[1.29] text-[#747474]">
			Important Notifications
		</h1>

		<!-- Filters and Search -->
		<div class="mb-5 flex items-center justify-between gap-4">
			<!-- Filter Buttons -->
			<div class="flex items-center gap-2.5">
				{#each filters as filter}
					<button
						onclick={() => (selectedFilter = filter)}
						class="h-9 rounded-lg px-3.5 font-sans text-sm font-normal leading-[1.29] transition-colors {selectedFilter ===
						filter
							? 'bg-[#577AB7] text-white'
							: 'bg-[#D7DFEB] text-[#577AB7]'}"
					>
						{filter}
					</button>
				{/each}
				<button class="flex h-9 w-9 items-center justify-center rounded-lg bg-[#D7DFEB]">
					<MoreVertical class="w-4.5 h-4.5 text-[#577AB7]" />
				</button>
			</div>

			<!-- Search Bar -->
			<div
				class="relative flex h-9 max-w-lg flex-1 items-center gap-2.5 rounded-lg bg-white px-3.5"
			>
				<Search class="w-4.5 h-4.5 text-[#577AB7]" />
				<input
					type="text"
					bind:value={searchQuery}
					placeholder="Search"
					class="flex-1 font-sans text-sm font-normal leading-[1.29] text-[rgba(120,120,120,0.54)] outline-none placeholder:text-[rgba(120,120,120,0.54)]"
				/>
				<Mic class="h-4.5 w-4 text-[#577AB7]" />
			</div>
		</div>

		<!-- Table -->
		<div class="overflow-hidden rounded-lg border-[0.5px] border-[#9A9A9A] bg-white">
			<!-- Table Header -->
			<div
				class="flex h-12 items-center gap-3 rounded-t-lg border-b border-[#9A9A9A] bg-[#F3F3F3] px-4"
			>
				<input
					type="checkbox"
					checked={selectAll}
					onchange={toggleSelectAll}
					class="w-4.5 h-4.5 cursor-pointer rounded-sm border-[1.5px] border-[#4B4B4B] bg-[rgba(217,217,217,0.15)]"
				/>
				<div class="w-20 font-sans text-sm font-medium leading-[1.29] text-[#565656]">Type</div>
				<div class="w-36 font-sans text-sm font-medium leading-[1.29] text-[#565656]">Name</div>
				<div class="flex-1 font-sans text-sm font-medium leading-[1.29] text-[#565656]">
					Message
				</div>
				<div class="w-24 font-sans text-sm font-medium leading-[1.29] text-[#565656]">Time</div>
			</div>

			<!-- Table Body -->
			<div class="max-h-[550px] overflow-y-auto">
				{#if filteredNotifications.length === 0}
					<div class="flex h-24 items-center justify-center font-sans text-sm text-[#717171]">
						{searchQuery.trim() || selectedFilter !== 'All'
							? 'No matching notifications.'
							: 'No notifications yet. New messages and communication logs will appear here.'}
					</div>
				{:else}
					{#each filteredNotifications as notification, index}
						{@const Icon = typeIcon(notification.type)}
						<div
							role="button"
							tabindex="0"
							class="flex h-12 cursor-pointer items-center gap-3 border-b border-[#BEBEBE] px-4 transition-colors hover:bg-gray-50 {index ===
							filteredNotifications.length - 1
								? 'border-b-0'
								: ''} {index % 2 === 0 ? 'bg-white' : 'bg-[#F9F9F9]'}"
							onclick={() => handleNotificationClick(notification)}
							onkeydown={(e) => {
								if (e.key === 'Enter' || e.key === ' ') {
									e.preventDefault();
									handleNotificationClick(notification);
								}
							}}
						>
							<input
								type="checkbox"
								checked={selectedNotifications.has(notification.id)}
								onchange={() => toggleNotification(notification.id)}
								onclick={(e) => e.stopPropagation()}
								class="w-4.5 h-4.5 cursor-pointer rounded-sm border-[1.5px] border-[#919191] bg-[rgba(217,217,217,0.15)]"
							/>
							<div class="flex w-20 items-center">
								<Icon class="h-4 w-5 text-[#B7B7B7]" />
							</div>
							<div class="w-36 font-sans text-sm font-medium leading-[1.29] text-[#787878]">
								{notification.sourceName ?? 'Unknown'}
							</div>
							<div
								class="flex-1 truncate font-sans text-sm leading-[1.29] text-[#717171] {!notification.read
									? 'font-semibold'
									: 'font-normal'}"
							>
								{notification.messagePreview}
							</div>
							<div
								class="w-24 font-sans text-sm font-normal leading-[1.29] text-[rgba(86,86,86,0.78)]"
							>
								{formatTime(notification.createdAt)}
							</div>
						</div>
					{/each}
				{/if}
			</div>
		</div>
	{/if}
</div>
